// routes/users.js  – OWASP A01 (Broken Access), A03 (Injection), A04 (Insecure Design)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { validateUserCreate, validateManagerUserCreate, validateUserUpdate } = require('../middleware/validators');
const { cacheDel, cacheDelPattern } = require('../utils/redis');
const { logUserActivity } = require('../services/activityService');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { normalizeStoredAvatarUrl } = require('../utils/avatarUrl');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

let s3 = null;
let PutObjectCommand = null;
if (process.env.S3_BUCKET && process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID) {
  try {
    const { S3Client, PutObjectCommand: PutCommand } = require('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: process.env.AWS_REGION,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
    PutObjectCommand = PutCommand;
  } catch {
    s3 = null;
    PutObjectCommand = null;
  }
}

async function getSeatLimitForOrg(orgId) {
  const { rows } = await query(
    `SELECT seats
     FROM stripe_subscriptions
     WHERE org_id = $1 AND status IN ('active', 'trialing')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [orgId]
  );
  return rows[0]?.seats ?? null;
}

async function assertSeatsAvailable(orgId) {
  const seats = await getSeatLimitForOrg(orgId);
  if (seats == null) return { enforced: false };
  const { rows } = await query(
    `SELECT COUNT(*)::int AS c FROM users WHERE org_id = $1 AND is_active = TRUE`,
    [orgId]
  );
  const used = rows[0]?.c || 0;
  if (used >= seats) {
    const err = Object.assign(new Error('Seat limit reached'), { status: 402 });
    err.public = { error: 'Seat limit reached. Upgrade your plan to add more users.' };
    throw err;
  }
  return { enforced: true, seats, used };
}

function runMiddlewareChain(chain, req, res, next) {
  let i = 0;
  const run = (err) => {
    if (err) return next(err);
    if (i >= chain.length) return next();
    const fn = chain[i++];
    fn(req, res, run);
  };
  run();
}

function validateAvatarPayload(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('avatarUrl must be a string');
  const trimmed = value.trim();
  if (trimmed.length > 3_600_000) throw new Error('avatarUrl is too large');
  if (/^https?:\/\//i.test(trimmed)) return normalizeStoredAvatarUrl(trimmed);
  if (!/^data:image\/(png|jpe?g);base64,/i.test(trimmed)) {
    throw new Error('Only PNG or JPEG images are allowed (data URL or http(s) link)');
  }
  return normalizeStoredAvatarUrl(trimmed);
}

/** Avatar-only update — register before GET /:id so /:id never shadows this path */
router.patch('/:id/avatar', authenticate, async (req, res, next) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!UUID_RE.test(rawId)) return res.status(400).json({ error: 'Invalid user id' });
    const sessionUserId = String(req.user.id || '').trim();
    if (rawId.toLowerCase() !== sessionUserId.toLowerCase()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let avatarUrl = req.body?.avatarUrl ?? req.body?.avatar_url;
    try {
      avatarUrl = validateAvatarPayload(avatarUrl);
    } catch (e) {
      return res.status(422).json({ error: e.message });
    }

    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }

    let { rows } = await query(
      `UPDATE users SET avatar_url = $1
       WHERE id = $2::uuid AND org_id = $3::uuid
       RETURNING id, email, full_name, role, department, avatar_url`,
      [avatarUrl, rawId, orgId]
    );

    if (!rows.length) {
      ({ rows } = await query(
        `UPDATE users SET avatar_url = $1
         WHERE id = $2::uuid
         RETURNING id, email, full_name, role, department, avatar_url`,
        [avatarUrl, rawId]
      ));
    }

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const userOut = rows[0];
    if (userOut.avatar_url) userOut.avatar_url = normalizeStoredAvatarUrl(userOut.avatar_url);

    await cacheDel(`user:${rawId}`);
    await cacheDelPattern(`user:${rawId}`);
    await logUserActivity({
      orgId: String(orgId),
      userId: req.user.id,
      activityType: 'profile_avatar_updated',
      metadata: { targetUserId: rawId },
    });

    res.json({ user: userOut });
  } catch (err) {
    next(err);
  }
});

/** Avatar binary upload — stores in S3 when configured, otherwise local disk */
router.post('/:id/avatar/upload', authenticate, avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!UUID_RE.test(rawId)) return res.status(400).json({ error: 'Invalid user id' });
    const sessionUserId = String(req.user.id || '').trim();
    if (rawId.toLowerCase() !== sessionUserId.toLowerCase()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (!req.file) return res.status(400).json({ error: 'avatar file is required' });

    const mime = String(req.file.mimetype || '').toLowerCase();
    const isAllowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mime);
    if (!isAllowed) return res.status(422).json({ error: 'Only PNG, JPEG, or WEBP are allowed' });

    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }

    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const fileName = `avatar_${rawId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    let avatarUrl;

    if (s3 && PutObjectCommand && process.env.S3_BUCKET) {
      const key = `orgs/${orgId}/avatars/${fileName}`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: mime,
      }));
      if (process.env.S3_PUBLIC_BASE_URL) avatarUrl = `${process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
      else avatarUrl = `s3://${process.env.S3_BUCKET}/${key}`;
    } else {
      const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
      fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, fileName), req.file.buffer);
      avatarUrl = `/uploads/avatars/${fileName}`;
    }

    const { rows } = await query(
      `UPDATE users SET avatar_url = $1 WHERE id = $2::uuid AND org_id = $3::uuid
       RETURNING id, email, full_name, role, department, avatar_url`,
      [avatarUrl, rawId, String(orgId)]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    await cacheDel(`user:${rawId}`);
    await cacheDelPattern(`user:${rawId}`);
    return res.json({ user: rows[0], avatarUrl });
  } catch (err) {
    next(err);
  }
});

// GET /users – scoped to org; HR/director/admin see org-wide; managers see subtree
router.get('/', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    const offset = (parseInt(page) - 1) * Math.min(parseInt(limit), 100);

    const orgId = req.user.org_id ?? req.user.orgId;
    const params = [orgId];
    let conditions = ['u.org_id = $1', 'u.is_active = TRUE'];
    let p = 2;

    if (!isOrgWideRole(req.user.role)) {
      const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
      const ids = [req.user.id, ...rows.map(r => r.user_id)];
      conditions.push(`u.id = ANY($${p++})`);
      params.push(ids);
    }

    if (role) { conditions.push(`u.role = $${p++}`); params.push(role); }
    if (search) { conditions.push(`(u.full_name ILIKE $${p} OR u.email ILIKE $${p})`); params.push(`%${search}%`); p++; }

    const { rows } = await query(`
      SELECT u.id, u.email, u.full_name, u.role, u.department, u.employee_code,
             u.manager_id, m.full_name AS manager_name, u.created_at, u.last_login_at, u.avatar_url,
             COUNT(*) OVER() AS total_count
      FROM users u
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY u.full_name ASC
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, Math.min(parseInt(limit), 100), offset]);

    res.json({ users: rows, total: parseInt(rows[0]?.total_count || 0) });
  } catch (err) { next(err); }
});

// GET /users/:id
// GET /users/profile — returns the currently authenticated user's own profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const sessionUserId = String(req.user.id || '').trim();
    const profileSql = `
      SELECT u.id, u.email, u.full_name, u.role, u.department, u.employee_code,
             u.manager_id, m.full_name AS manager_name, u.last_login_at, u.created_at,
             u.org_id, u.avatar_url, u.phone_e164, u.whatsapp_e164,
             u.notification_prefs, u.mfa_enabled
      FROM users u LEFT JOIN users m ON m.id = u.manager_id`;
    const { rows } = await query(`${profileSql} WHERE u.id = $1::uuid`, [sessionUserId]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    if (user.avatar_url) user.avatar_url = normalizeStoredAvatarUrl(user.avatar_url);
    res.json({ user });
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const rawId = String(req.params.id || '').trim();
    if (!UUID_RE.test(rawId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }

    const sessionUserId = String(req.user.id);
    const isSelf = rawId.toLowerCase() === sessionUserId.toLowerCase();
    const isPrivileged = isOrgWideRole(req.user.role);

    if (!isSelf && !isPrivileged) {
      const { rows: sub } = await query(
        `SELECT 1 FROM get_subordinate_ids($1) WHERE user_id = $2::uuid LIMIT 1`,
        [req.user.id, rawId]
      );
      if (!sub.length) return res.status(403).json({ error: 'Access denied' });
    }

    const profileSql = `
      SELECT u.id, u.email, u.full_name, u.role, u.department, u.employee_code,
             u.manager_id, m.full_name AS manager_name, u.last_login_at, u.created_at,
             u.org_id, u.avatar_url, u.phone_e164, u.whatsapp_e164,
             u.notification_prefs, u.mfa_enabled
      FROM users u LEFT JOIN users m ON m.id = u.manager_id`;

    let { rows } = await query(
      `${profileSql}
      WHERE u.id = $1::uuid AND u.org_id = $2::uuid`,
      [rawId, String(orgId)]
    );

    // Self-profile: if org in JWT/cache drifted from DB row, still return the user
    if (!rows.length && isSelf) {
      ({ rows } = await query(`${profileSql} WHERE u.id = $1::uuid`, [rawId]));
    }

    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    if (user.avatar_url) user.avatar_url = normalizeStoredAvatarUrl(user.avatar_url);
    res.json({ user });
  } catch (err) { next(err); }
});

// POST /users – director/admin (full); manager (employee/supervisor under self)
router.post('/', authenticate, (req, res, next) => {
  if (!['director', 'admin', 'manager'].includes(req.user.role))
    return res.status(403).json({ error: 'Insufficient permissions' });
  const chain = ['director', 'admin'].includes(req.user.role) ? validateUserCreate : validateManagerUserCreate;
  runMiddlewareChain(chain, req, res, next);
}, async (req, res, next) => {
  try {
    await assertSeatsAvailable(req.user.org_id ?? req.user.orgId);
    const { email, password, fullName, role, managerId, department, employeeCode } = req.body;
    
    const orgId = req.user.org_id ?? req.user.orgId;
    const emailLower = email.toLowerCase().trim();

    // Check if user already exists with this email
    const { rows: existingUsers } = await query(
      `SELECT id, email FROM users WHERE LOWER(email) = $1 AND org_id = $2`,
      [emailLower, orgId]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        error: 'User with this email already exists. Check the Directory or Employees page.',
        existingUserId: existingUsers[0].id
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let newUser;
    if (['director', 'admin'].includes(req.user.role)) {
      const { rows } = await query(`
        INSERT INTO users (org_id, email, password_hash, full_name, role, manager_id, department, employee_code)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, email, full_name, role, department, created_at
      `, [orgId, emailLower, passwordHash, fullName, role, managerId || null, department || null, employeeCode || null]);
      newUser = rows[0];
    } else {
      const { rows } = await query(`
        INSERT INTO users (org_id, email, password_hash, full_name, role, manager_id, department, employee_code)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, email, full_name, role, department, created_at
      `, [orgId, emailLower, passwordHash, fullName, role, req.user.id, department || null, employeeCode || null]);
      newUser = rows[0];
    }

    // Auto-create basic employee record for the new user
    try {
      await query(`
        INSERT INTO employees (org_id, user_id, full_name, department, work_email, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        ON CONFLICT (user_id) DO NOTHING
      `, [orgId, newUser.id, fullName, department || null, emailLower]);
      console.log(`Auto-created employee record for user: ${emailLower}`);
    } catch (empErr) {
      console.warn('Failed to auto-create employee record:', empErr.message);
      // Don't fail the user creation if employee creation fails
    }

    await logUserActivity({
      orgId,
      userId: req.user.id,
      activityType: 'user_added',
      metadata: { newUserId: newUser.id, email: newUser.email, role: newUser.role },
    });

    res.status(201).json({ 
      user: newUser,
      message: 'User created successfully. Employee record created automatically.'
    });
  } catch (err) { 
    if (err.code === '23505') { // PostgreSQL unique violation
      return res.status(409).json({ error: 'User with this email already exists.' });
    }
    next(err); 
  }
});

// PATCH /users/:id
router.patch('/:id', authenticate, ...validateUserUpdate, async (req, res, next) => {
  try {
    const isSelf = String(req.params.id || '').toLowerCase() === String(req.user.id || '').toLowerCase();
    const isAdmin = req.user.role === 'admin';
    const isDirector = req.user.role === 'director';

    if (!isSelf && !isAdmin && !isDirector)
      return res.status(403).json({ error: 'Access denied' });

    if (req.body.avatarUrl !== undefined) {
      try {
        req.body.avatarUrl = validateAvatarPayload(req.body.avatarUrl);
      } catch (e) {
        return res.status(422).json({ error: e.message });
      }
    }

    const allowed = isSelf
      ? ['fullName', 'department', 'avatarUrl', 'phoneE164', 'whatsappE164', 'notificationPrefs']
      : ['fullName', 'role', 'managerId', 'department', 'employeeCode', 'isActive'];

    const updates = [];
    const params = [];
    let p = 1;
    const fieldMap = {
      fullName: 'full_name',
      managerId: 'manager_id',
      employeeCode: 'employee_code',
      isActive: 'is_active',
      avatarUrl: 'avatar_url',
      phoneE164: 'phone_e164',
      whatsappE164: 'whatsapp_e164',
      notificationPrefs: 'notification_prefs',
    };

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const col = fieldMap[key] || key.replace(/([A-Z])/g, '_$1').toLowerCase();
        updates.push(`${col} = $${p++}`);
        params.push(req.body[key]);
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    const orgId = await orgIdForSessionUser(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }

    params.push(String(req.params.id), orgId);

    const { rows } = await query(`
      UPDATE users SET ${updates.join(', ')}
      WHERE id = $${p++}::uuid AND org_id = $${p}::uuid
      RETURNING id, email, full_name, role, department, avatar_url
    `, params);

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const out = rows[0];
    if (out.avatar_url) out.avatar_url = normalizeStoredAvatarUrl(out.avatar_url);

    await cacheDel(`user:${req.params.id}`);
    await cacheDelPattern(`user:${req.params.id}`);

    if (req.body.avatarUrl !== undefined) {
      await logUserActivity({
        orgId: String(orgId),
        userId: req.user.id,
        activityType: 'profile_avatar_updated',
        metadata: { targetUserId: req.params.id },
      });
    }

    if (req.body.fullName !== undefined || req.body.department !== undefined) {
      await logUserActivity({
        orgId: String(orgId),
        userId: req.user.id,
        activityType: 'profile_updated',
        metadata: { targetUserId: req.params.id, fields: Object.keys(req.body).filter((k) => ['fullName', 'department'].includes(k)) },
      });
    }

    res.json({ user: out });
  } catch (err) { next(err); }
});

module.exports = router;
