const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { cacheDel } = require('../utils/redis');
const { authenticate } = require('../middleware/auth');
const { validateLogin } = require('../middleware/validators');
const { authRateLimiter, passwordResetLimiter } = require('../middleware/security');
const { logUserActivity } = require('../services/activityService');
const EmailService = require('../services/emailService');
const { authenticator } = require('otplib');
const { sha256Hex, randomToken, encryptString, decryptString } = require('../utils/crypto');

const SUBSCRIPTION_PLANS = {
  basic: {
    key: 'basic',
    name: 'Basic',
    billingModel: 'per_user_month',
    minPriceUsd: 3,
    maxPriceUsd: 5,
    defaultPriceUsd: 4,
    features: ['Core task management', 'Team collaboration', 'Standard reports']
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    billingModel: 'per_user_month',
    minPriceUsd: 8,
    maxPriceUsd: 12,
    defaultPriceUsd: 10,
    features: ['Everything in Basic', 'AI automations', 'Advanced analytics']
  },
  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    billingModel: 'custom',
    minPriceUsd: null,
    maxPriceUsd: null,
    defaultPriceUsd: null,
    features: ['Custom integrations', 'Priority support', 'Enterprise governance']
  }
};

// Initialize email service
const emailService = new EmailService();

function normalizePlan(plan) {
  const key = String(plan || '').trim().toLowerCase();
  if (key === 'business') return 'pro';
  if (['basic', 'pro', 'enterprise'].includes(key)) return key;
  return null;
}

function parseOrgSettings(settings) {
  if (!settings) return {};
  if (typeof settings === 'object') return settings;
  try { return JSON.parse(settings); } catch { return {}; }
}

function getSubscriptionAccess(org) {
  const planFromOrg = normalizePlan(org?.plan) || 'basic';
  const settings = parseOrgSettings(org?.settings);
  const subscription = settings.subscription || null;
  if (!subscription) {
    return {
      allowed: !!planFromOrg,
      reason: null,
      plan: planFromOrg,
      subscription: {
        status: 'active',
        billingModel: 'per_user_month',
        source: 'org_plan_fallback'
      }
    };
  }
  const status = String(subscription.status || 'inactive').toLowerCase();
  const allowed = ['active', 'trialing'].includes(status);
  return {
    allowed,
    reason: allowed ? null : `Subscription is ${status}`,
    plan: normalizePlan(subscription.plan) || planFromOrg,
    subscription
  };
}

function signAccessToken(userId, orgId, role) {
  return jwt.sign({ userId, orgId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ userId, jti: uuidv4() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '30d'
  });
}

// POST /api/v1/auth/login
router.post('/login', authRateLimiter, validateLogin, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await query(
      `SELECT id, org_id, email, password_hash, full_name, role, is_active, email_verified, mfa_enabled
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const user = rows[0];
    console.log('Login attempt - User found:', !!user);
    console.log('Login attempt - User data:', user ? { email: user.email, hasPasswordHash: !!user.password_hash, isActive: user.is_active, emailVerified: user.email_verified } : null);
    
    if (!user) {
      console.log('Login failed - User not found');
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Check email verification - skip in demo mode
    if (!user.email_verified && process.env.NODE_ENV !== 'production') {
      console.log('Demo mode - Auto-verifying email for user:', user.email);
      // Auto-verify email in demo mode
      await query(
        `UPDATE users SET email_verified = TRUE WHERE id = $1`,
        [user.id]
      );
      user.email_verified = true;
    } else if (!user.email_verified) {
      console.log('Login failed - Email not verified');
      return res.status(401).json({
        error: 'Please verify your email address before logging in. Check your inbox for the verification link.'
      });
    }
    
    console.log('Login attempt - Comparing password...');
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    console.log('Login attempt - Password match:', passwordMatch);
    
    if (!passwordMatch) {
      console.log('Login failed - Password mismatch');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.is_active)
      return res.status(403).json({ error: 'Account deactivated' });

    const { rows: orgRows } = await query(
      `SELECT id, name, slug, plan, settings, is_active FROM organizations WHERE id = $1`,
      [user.org_id]
    );
    const org = orgRows[0];
    if (!org || org.is_active === false) {
      return res.status(403).json({ error: 'Organization is inactive' });
    }

    const subscriptionAccess = getSubscriptionAccess(org);
    if (!subscriptionAccess.allowed) {
      return res.status(402).json({
        error: 'Active subscription required before login',
        details: subscriptionAccess.reason,
        organization: { id: org.id, name: org.name, slug: org.slug },
        subscription: subscriptionAccess.subscription
      });
    }

    if (user.mfa_enabled) {
      const challenge = randomToken(32);
      const challengeHash = sha256Hex(challenge);
      await query(
        `INSERT INTO mfa_challenges (user_id, challenge_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
        [user.id, challengeHash]
      );
      return res.json({
        mfaRequired: true,
        mfaToken: challenge,
        user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, orgId: user.org_id }
      });
    }

    const accessToken = signAccessToken(user.id, user.org_id, user.role);
    const refreshToken = signRefreshToken(user.id);
    const tokenHash = require('crypto')
      .createHash('sha256').update(refreshToken).digest('hex');

    // Store refresh token - don't fail login if this fails
    try {
      await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
        [user.id, tokenHash]
      );
    } catch (tokenErr) {
      console.warn('Could not store refresh token (table may not exist):', tokenErr.message);
    }

    // Update last login
    try {
      await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    } catch (updateErr) {
      console.warn('Could not update last_login_at:', updateErr.message);
    }
    await logUserActivity({
      orgId: user.org_id,
      userId: user.id,
      activityType: 'login',
      metadata: { channel: 'web' }
    });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        orgId: user.org_id
      },
      subscription: {
        plan: subscriptionAccess.plan,
        ...subscriptionAccess.subscription
      }
    });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/mfa/verify
router.post('/mfa/verify', authRateLimiter, async (req, res, next) => {
  try {
    const { mfaToken, code, recoveryCode } = req.body || {};
    if (!mfaToken || typeof mfaToken !== 'string') {
      return res.status(400).json({ error: 'mfaToken is required' });
    }
    if ((!code || typeof code !== 'string') && (!recoveryCode || typeof recoveryCode !== 'string')) {
      return res.status(400).json({ error: 'code or recoveryCode is required' });
    }

    const challengeHash = sha256Hex(mfaToken);
    const { rows: chRows } = await query(
      `SELECT * FROM mfa_challenges
       WHERE challenge_hash = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
      [challengeHash]
    );
    const ch = chRows[0];
    if (!ch) return res.status(401).json({ error: 'MFA challenge expired' });

    const { rows: userRows } = await query(
      `SELECT id, org_id, email, full_name, role, is_active, email_verified, mfa_enabled, mfa_secret_enc
       FROM users WHERE id = $1`,
      [ch.user_id]
    );
    const user = userRows[0];
    if (!user || !user.is_active) return res.status(401).json({ error: 'User not found' });
    if (!user.email_verified) return res.status(401).json({ error: 'Email not verified' });
    if (!user.mfa_enabled) return res.status(400).json({ error: 'MFA is not enabled for this account' });

    let ok = false;
    if (code) {
      const secret = decryptString(user.mfa_secret_enc, 'MFA_ENCRYPTION_KEY');
      authenticator.options = { window: 1 };
      ok = authenticator.check(String(code).replace(/\s+/g, ''), secret);
    } else if (recoveryCode) {
      const rcHash = sha256Hex(String(recoveryCode).replace(/\s+/g, '').toLowerCase());
      const { rowCount } = await query(
        `UPDATE mfa_recovery_codes
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND code_hash = $2`,
        [user.id, rcHash]
      );
      ok = rowCount > 0;
    }

    if (!ok) return res.status(401).json({ error: 'Invalid MFA code' });

    await query(`UPDATE mfa_challenges SET consumed_at = NOW() WHERE id = $1`, [ch.id]);
    await query(`UPDATE users SET mfa_last_used_at = NOW() WHERE id = $1`, [user.id]);

    const { rows: orgRows } = await query(
      `SELECT id, name, slug, plan, settings, is_active FROM organizations WHERE id = $1`,
      [user.org_id]
    );
    const org = orgRows[0];
    if (!org || org.is_active === false) {
      return res.status(403).json({ error: 'Organization is inactive' });
    }
    const subscriptionAccess = getSubscriptionAccess(org);
    if (!subscriptionAccess.allowed) {
      return res.status(402).json({
        error: 'Active subscription required before login',
        details: subscriptionAccess.reason,
        organization: { id: org.id, name: org.name, slug: org.slug },
        subscription: subscriptionAccess.subscription
      });
    }

    const accessToken = signAccessToken(user.id, user.org_id, user.role);
    const refreshToken = signRefreshToken(user.id);
    const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, tokenHash]
    );
    await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, orgId: user.org_id },
      subscription: { plan: subscriptionAccess.plan, ...subscriptionAccess.subscription }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/mfa/enroll/start
router.post('/mfa/enroll/start', authenticate, async (req, res, next) => {
  try {
    const issuer = process.env.MFA_ISSUER || 'TaskFlow Pro';
    const accountName = req.user.email;
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(accountName, issuer, secret);
    // Store secret temporarily in memory of client; confirm endpoint will persist encrypted secret.
    res.json({ issuer, accountName, secret, otpauthUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/mfa/enroll/confirm
router.post('/mfa/enroll/confirm', authenticate, async (req, res, next) => {
  try {
    const { secret, code } = req.body || {};
    if (!secret || typeof secret !== 'string') return res.status(400).json({ error: 'secret is required' });
    if (!code || typeof code !== 'string') return res.status(400).json({ error: 'code is required' });

    authenticator.options = { window: 1 };
    const ok = authenticator.check(String(code).replace(/\s+/g, ''), secret);
    if (!ok) return res.status(401).json({ error: 'Invalid MFA code' });

    const enc = encryptString(secret, 'MFA_ENCRYPTION_KEY');
    await query(
      `UPDATE users
       SET mfa_enabled = TRUE,
           mfa_secret_enc = $1,
           mfa_enrolled_at = NOW()
       WHERE id = $2`,
      [enc, req.user.id]
    );

    // Generate 10 one-time recovery codes; store hashed
    const codes = Array.from({ length: 10 }).map(() => randomToken(10));
    for (const c of codes) {
      await query(
        `INSERT INTO mfa_recovery_codes (user_id, code_hash)
         VALUES ($1, $2)`,
        [req.user.id, sha256Hex(String(c).toLowerCase())]
      );
    }

    res.json({ message: 'MFA enabled', recoveryCodes: codes });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/subscription/plans
router.get('/subscription/plans', async (_req, res) => {
  res.json({
    billingModel: 'per_user_month',
    currency: 'USD',
    plans: Object.values(SUBSCRIPTION_PLANS)
  });
});

// POST /api/v1/auth/forgot-password
router.post('/forgot-password', passwordResetLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    
    console.log('Forgot password attempt - Email:', email);
    
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    const normalizedEmail = String(email).toLowerCase().trim();
    
    // Check if user exists
    const { rows } = await query(
      `SELECT id, email, full_name FROM users WHERE email = $1`,
      [normalizedEmail]
    );
    
    const user = rows[0];
    console.log('Forgot password - User found:', !!user);
    
    if (!user) {
      // For security, don't reveal if email exists or not
      return res.json({ 
        message: 'If an account with this email exists, a password reset link has been sent.' 
      });
    }

    const resetToken = randomToken(32);
    const resetTokenHash = sha256Hex(resetToken);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, resetTokenHash]
    );

    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const resetLink = `${origin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(resetToken)}`;
    console.log('Forgot password - Reset link generated');
    
    // Send password reset email
    try {
      const resetEmailHtml = emailService.getPasswordResetEmailTemplate(
        user.full_name,
        resetLink
      );
      
      const emailResult = await emailService.sendEmail(
        normalizedEmail,
        'Reset Your Password - TaskFlow Pro',
        resetEmailHtml
      );
      
      if (emailResult.success) {
        console.log('Password reset email sent to:', normalizedEmail);
        res.json({ 
          message: 'Password reset link has been sent to your email.'
        });
      } else {
        console.error('Failed to send password reset email:', emailResult.error);
        res.json({ 
          message: 'Password reset link has been sent to your email.'
        });
      }
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError);
      res.json({ 
        message: 'Password reset link has been sent to your email.'
      });
    }
    
  } catch (err) {
    console.error('Forgot password error:', err);
    next(err);
  }
});

// POST /api/v1/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    
    console.log('Reset password attempt - Token provided:', !!token);
    
    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }
    
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const tokenHash = sha256Hex(token);
    const { rows } = await query(
      `SELECT * FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    const rec = rows[0];
    if (!rec) return res.status(400).json({ error: 'Reset link is invalid or expired' });

    const hash = await bcrypt.hash(String(password), 12);
    await withTransaction(async (client) => {
      await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rec.user_id]);
      await client.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [rec.id]);
      await client.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [rec.user_id]);
    });
    await cacheDel(`user:${rec.user_id}`);

    res.json({ message: 'Password has been reset successfully.' });
    
  } catch (err) {
    console.error('Reset password error:', err);
    next(err);
  }
});

// POST /api/v1/auth/verify-email
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;
    
    console.log('Email verification attempt - Token provided:', !!token);
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    
    const tokenHash = sha256Hex(token);
    const { rows } = await query(
      `SELECT * FROM email_verification_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    const rec = rows[0];
    if (!rec) return res.status(400).json({ error: 'Verification link is invalid or expired' });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE users SET email_verified = TRUE WHERE id = $1`,
        [rec.user_id]
      );
      await client.query(
        `UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`,
        [rec.id]
      );
    });

    res.json({ message: 'Email verified successfully. You can now sign in.' });
    
  } catch (err) {
    console.error('Email verification error:', err);
    next(err);
  }
});

// POST /api/v1/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    console.log('Signup attempt - Request body:', req.body);
    
    const {
      fullName,
      email,
      password,
      organizationName,
      organizationSlug,
      plan,
      seats
    } = req.body || {};
    
    console.log('Signup attempt - Parsed data:', { fullName, email, organizationName, organizationSlug, plan, seats });

    const normalizedPlan = normalizePlan(plan);
    if (!normalizedPlan) {
      return res.status(400).json({ error: 'Valid plan is required: basic, pro, enterprise' });
    }
    if (!fullName || String(fullName).trim().length < 2) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!organizationName || String(organizationName).trim().length < 2) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    if (!organizationSlug || !/^[a-z0-9-]{3,50}$/.test(String(organizationSlug).toLowerCase())) {
      return res.status(400).json({ error: 'Organization slug must be 3-50 lowercase letters, numbers, or hyphens' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const slug = String(organizationSlug).toLowerCase().trim();

    const requestedSeats = Math.max(1, parseInt(seats || 1, 10));
    const planConfig = SUBSCRIPTION_PLANS[normalizedPlan];
    const perUserPrice = planConfig.defaultPriceUsd;
    const monthlyAmountUsd = perUserPrice ? perUserPrice * requestedSeats : null;

    const { rows: existingUserRows } = await query(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
    if (existingUserRows.length) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const signupResult = await withTransaction(async (client) => {
      const subscription = {
        status: 'active',
        plan: normalizedPlan,
        billingModel: planConfig.billingModel,
        perUserPriceUsd: perUserPrice,
        seats: requestedSeats,
        monthlyAmountUsd,
        currency: 'USD',
        startedAt: new Date().toISOString()
      };

      const orgSettings = JSON.stringify({ subscription });
      const { rows: orgRows } = await client.query(
        `INSERT INTO organizations (name, slug, plan, settings, is_active)
         VALUES ($1, $2, $3, $4::jsonb, true)
         RETURNING id, name, slug, plan, settings, created_at`,
        [String(organizationName).trim(), slug, normalizedPlan, orgSettings]
      );
      const organization = orgRows[0];

      const { rows: userRows } = await client.query(
        `INSERT INTO users (org_id, email, password_hash, full_name, role, is_active, email_verified)
         VALUES ($1, $2, $3, $4, 'admin', true, true)
         RETURNING id, org_id, email, full_name, role, email_verified`,
        [organization.id, normalizedEmail, passwordHash, String(fullName).trim()]
      );
      const user = userRows[0];

      try {
        await client.query(
          `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
           VALUES ($1, $2, 'owner', true, NOW(), $2)
           ON CONFLICT (org_id, user_id) DO UPDATE SET is_active = true, joined_at = NOW()`,
          [organization.id, user.id]
        );
      } catch (err) {
        // If migration is not present, do not block signup flow.
        if (err.code !== '42P01') throw err;
      }

      return { organization, user, subscription };
    });

    const accessToken = signAccessToken(signupResult.user.id, signupResult.user.org_id, signupResult.user.role);
    const refreshToken = signRefreshToken(signupResult.user.id);
    const tokenHash = require('crypto').createHash('sha256').update(refreshToken).digest('hex');

    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [signupResult.user.id, tokenHash]
    );

    await logUserActivity({
      orgId: signupResult.user.org_id,
      userId: signupResult.user.id,
      activityType: 'signup',
      metadata: {
        plan: normalizedPlan,
        seats: requestedSeats,
        monthlyAmountUsd
      }
    });

    // Generate + store email verification token (24h) - optional, don't fail signup
    try {
      const verificationToken = randomToken(32);
      const verificationTokenHash = sha256Hex(verificationToken);
      await query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
        [signupResult.user.id, verificationTokenHash]
      );
    } catch (tokenErr) {
      console.error('Could not store verification token (table may not exist):', tokenErr.message);
    }

    const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    const verificationLink = `${origin.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(verificationToken)}`;

    // Send verification email - don't fail signup if email fails
    try {
      const verificationEmailHtml = emailService.getVerificationEmailTemplate(
        signupResult.user.full_name,
        verificationLink
      );
      
      await emailService.sendEmail(
        signupResult.user.email,
        'Verify Your Email Address - TaskFlow Pro',
        verificationEmailHtml
      );
      
      console.log('Verification email sent to:', signupResult.user.email);
    } catch (emailError) {
      console.error('Failed to send verification email (SMTP may not be configured):', emailError.message);
    }

    res.status(201).json({
      message: 'Account created successfully! You can now login.',
      user: {
        id: signupResult.user.id,
        email: signupResult.user.email,
        fullName: signupResult.user.full_name,
        emailVerified: true
      }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Organization slug already exists' });
    }
    next(err);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokenHash = require('crypto')
      .createHash('sha256').update(refreshToken).digest('hex');

    const { rows } = await query(
      `SELECT rt.*, u.org_id, u.role FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked = FALSE AND rt.expires_at > NOW()`,
      [tokenHash]
    );

    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const { user_id, org_id, role } = rows[0];
    const newAccessToken = signAccessToken(user_id, org_id, role);

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Invalid refresh token' });
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = require('crypto')
        .createHash('sha256').update(refreshToken).digest('hex');
      await query(`UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1`, [tokenHash]);
    }
    await cacheDel(`user:${req.user.id}`);
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
});

// POST /api/v1/auth/change-password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'Valid passwords required (min 8 chars)' });

    const { rows } = await query(
      `SELECT password_hash FROM users WHERE id = $1`, [req.user.id]
    );

    if (!await bcrypt.compare(currentPassword, rows[0].password_hash))
      return res.status(401).json({ error: 'Current password incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user.id]);

    // Revoke all refresh tokens for security
    await query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1`, [req.user.id]);
    await cacheDel(`user:${req.user.id}`);

    await logUserActivity({
      orgId: req.user.org_id ?? req.user.orgId,
      userId: req.user.id,
      activityType: 'password_changed',
      metadata: {},
    });

    res.json({ message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
