// routes/organizations.js
const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireRole, requireAnyRole } = require('../middleware/auth');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// GET /organizations/me – current org info
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, slug, plan, settings, created_at FROM organizations WHERE id = $1`,
      [req.user.org_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: rows[0] });
  } catch (err) { next(err); }
});

// GET /organizations – list all organizations user has access to
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT 
        o.id, o.name, o.slug, o.plan, o.settings, o.created_at,
        om.role as membership_role,
        om.is_active as membership_active,
        om.joined_at,
        CASE WHEN o.id = $1 THEN true ELSE false END as is_current
      FROM organizations o
      INNER JOIN organization_members om ON o.id = om.org_id
      WHERE om.user_id = $1 AND om.is_active = true
      ORDER BY is_current DESC, joined_at DESC
    `, [req.user.id]);
    
    res.json({ organizations: rows });
  } catch (err) { next(err); }
});

// POST /organizations – create new org (super-admin or public registration)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { name, slug, plan = 'starter' } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Name and slug required' });
    
    // slug sanitization: only lowercase alphanumeric + hyphens
    if (!/^[a-z0-9-]{3,50}$/.test(slug))
      return res.status(400).json({ error: 'Slug must be 3-50 lowercase alphanumeric chars or hyphens' });

    await withTransaction(async (client) => {
      // Create organization
      const { rows: orgRows } = await client.query(
        `INSERT INTO organizations (name, slug, plan) VALUES ($1, $2, $3) RETURNING id, name, slug, plan, created_at`,
        [name.trim(), slug.toLowerCase(), plan]
      );
      
      const org = orgRows[0];
      
      // Add creator as owner
      await client.query(
        `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
         VALUES ($1, $2, 'owner', true, NOW(), $2)`,
        [org.id, req.user.id]
      );
      
      // Update user's current organization
      await client.query(
        `UPDATE users SET org_id = $1 WHERE id = $2`,
        [org.id, req.user.id]
      );
      
      return org;
    });
    
    res.status(201).json({ 
      message: 'Organization created successfully',
      organization: { name, slug, plan }
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Slug already taken' });
    next(err);
  }
});

// PATCH /organizations/me – update org settings (admin only)
router.patch('/me', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name, settings } = req.body;
    const updates = [];
    const params = [];
    let p = 1;
    if (name) { updates.push(`name = $${p++}`); params.push(name.trim()); }
    if (settings) { updates.push(`settings = $${p++}`); params.push(JSON.stringify(settings)); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.org_id);
    const { rows } = await query(
      `UPDATE organizations SET ${updates.join(', ')} WHERE id = $${p} RETURNING id, name, settings`,
      params
    );
    res.json({ organization: rows[0] });
  } catch (err) { next(err); }
});

// POST /organizations/onboarding/complete - mark onboarding completed and save setup payload
router.post('/onboarding/complete', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const payload = req.body?.onboarding || {};
    const { rows } = await query(
      `UPDATE organizations
       SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb
       WHERE id = $2
       RETURNING id, name, slug, plan, settings`,
      [JSON.stringify({
        onboardingCompleted: true,
        onboardingCompletedAt: new Date().toISOString(),
        onboarding: payload,
      }), orgId]
    );
    return res.json({ organization: rows[0] });
  } catch (err) { next(err); }
});

// POST /organizations/switch – switch to a different organization
router.post('/switch', authenticate, async (req, res, next) => {
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ error: 'Organization ID required' });
    
    // Verify user has access to the organization
    const { rows } = await query(`
      SELECT om.role, o.name, o.slug
      FROM organization_members om
      INNER JOIN organizations o ON om.org_id = o.id
      WHERE om.user_id = $1 AND om.org_id = $2 AND om.is_active = true
    `, [req.user.id, orgId]);
    
    if (!rows.length) {
      return res.status(403).json({ error: 'Access denied to this organization' });
    }
    
    // Update user's current organization
    await query(
      `UPDATE users SET org_id = $1 WHERE id = $2`,
      [orgId, req.user.id]
    );
    
    res.json({ 
      message: 'Switched successfully',
      organization: {
        id: orgId,
        name: rows[0].name,
        slug: rows[0].slug,
        role: rows[0].role
      }
    });
  } catch (err) { next(err); }
});

// GET /organizations/:id/members – list organization members
router.get('/:id/members', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify user has access to view members
    const { rows: accessRows } = await query(`
      SELECT role FROM organization_members 
      WHERE user_id = $1 AND org_id = $2 AND is_active = true
    `, [req.user.id, id]);
    
    if (!accessRows.length) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const userRole = accessRows[0].role;
    const canViewAll = ['owner', 'admin', 'manager'].includes(userRole);
    
    let memberQuery = `
      SELECT 
        om.id as membership_id,
        om.role as membership_role,
        om.is_active as membership_active,
        om.joined_at,
        om.invited_by,
        u.id,
        u.full_name,
        u.email,
        u.role as system_role,
        u.is_active as user_active,
        inviter.full_name as invited_by_name
      FROM organization_members om
      INNER JOIN users u ON om.user_id = u.id
      LEFT JOIN users inviter ON om.invited_by = inviter.id
      WHERE om.org_id = $1
    `;
    
    const params = [id];
    
    // Non-admins can only see active members
    if (!canViewAll) {
      memberQuery += ' AND om.is_active = true AND u.is_active = true';
    }
    
    memberQuery += ' ORDER BY om.joined_at DESC';
    
    const { rows } = await query(memberQuery, params);
    
    res.json({ 
      members: rows,
      can_manage: ['owner', 'admin'].includes(userRole)
    });
  } catch (err) { next(err); }
});

// POST /organizations/:id/invite – invite user to organization
router.post('/:id/invite', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, role = 'member' } = req.body;
    
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    // Verify user can invite members
    const { rows: accessRows } = await query(`
      SELECT role FROM organization_members 
      WHERE user_id = $1 AND org_id = $2 AND is_active = true
    `, [req.user.id, id]);
    
    if (!accessRows.length || !['owner', 'admin', 'manager'].includes(accessRows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions to invite members' });
    }
    
    // Check if user already exists
    const { rows: existingUsers } = await query(
      `SELECT id, full_name FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    
    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    await withTransaction(async (client) => {
      if (existingUsers.length > 0) {
        // User exists, add them directly to organization
        const existingUser = existingUsers[0];
        
        // Check if already a member
        const { rows: memberCheck } = await client.query(
          `SELECT id FROM organization_members WHERE user_id = $1 AND org_id = $2`,
          [existingUser.id, id]
        );
        
        if (memberCheck.length > 0) {
          // Reactivate existing membership
          await client.query(
            `UPDATE organization_members SET is_active = true, joined_at = NOW() WHERE user_id = $1 AND org_id = $2`,
            [existingUser.id, id]
          );
        } else {
          // Add new membership
          await client.query(
            `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at, invited_by)
             VALUES ($1, $2, $3, true, NOW(), $4)`,
            [id, existingUser.id, role, req.user.id]
          );
        }
      } else {
        // User doesn't exist, create invitation
        await client.query(
          `INSERT INTO organization_invitations (org_id, email, role, token, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, email.toLowerCase(), role, inviteToken, req.user.id, expiresAt]
        );
      }
    });
    
    res.json({ 
      message: existingUsers.length > 0 ? 'User added to organization' : 'Invitation sent',
      user_exists: existingUsers.length > 0
    });
  } catch (err) { next(err); }
});

// POST /organizations/accept-invite – accept organization invitation
router.post('/accept-invite', async (req, res, next) => {
  try {
    const { token, fullName, password } = req.body;
    
    if (!token) return res.status(400).json({ error: 'Token is required' });
    
    // Find and validate invitation
    const { rows: inviteRows } = await query(`
      SELECT 
        oi.id, oi.org_id, oi.email, oi.role, oi.expires_at,
        o.name as org_name, o.slug as org_slug
      FROM organization_invitations oi
      INNER JOIN organizations o ON oi.org_id = o.id
      WHERE oi.token = $1 AND oi.expires_at > NOW() AND oi.accepted_at IS NULL
    `, [token]);
    
    if (!inviteRows.length) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }
    
    const invitation = inviteRows[0];
    
    await withTransaction(async (client) => {
      let userId;
      
      // Find or create user
      const { rows: userRows } = await client.query(
        `SELECT id FROM users WHERE email = $1`,
        [invitation.email]
      );
      
      if (userRows.length > 0) {
        userId = userRows[0].id;
      } else {
        // Create new user
        if (!fullName || !password) {
          throw new Error('Full name and password are required for new users');
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const { rows: newUserRows } = await client.query(
          `INSERT INTO users (full_name, email, password_hash, role, is_active, org_id)
           VALUES ($1, $2, $3, 'employee', true, $4) RETURNING id`,
          [fullName, invitation.email, hashedPassword, invitation.org_id]
        );
        userId = newUserRows[0].id;
      }
      
      // Add to organization
      await client.query(
        `INSERT INTO organization_members (org_id, user_id, role, is_active, joined_at)
         VALUES ($1, $2, $3, true, NOW())
         ON CONFLICT (org_id, user_id) DO UPDATE SET
         is_active = true, joined_at = NOW()`,
        [invitation.org_id, userId, invitation.role]
      );
      
      // Mark invitation as accepted
      await client.query(
        `UPDATE organization_invitations SET accepted_at = NOW(), accepted_by = $1 WHERE id = $2`,
        [userId, invitation.id]
      );
      
      // Update user's current organization if they don't have one
      await client.query(
        `UPDATE users SET org_id = $1 WHERE id = $2 AND org_id IS NULL`,
        [invitation.org_id, userId]
      );
    });
    
    res.json({ 
      message: 'Invitation accepted successfully',
      organization: {
        name: invitation.org_name,
        slug: invitation.org_slug
      }
    });
  } catch (err) { next(err); }
});

// DELETE /organizations/:id/members/:userId – remove member from organization
router.delete('/:id/members/:userId', authenticate, async (req, res, next) => {
  try {
    const { id, userId } = req.params;
    
    // Verify user can remove members
    const { rows: accessRows } = await query(`
      SELECT role FROM organization_members 
      WHERE user_id = $1 AND org_id = $2 AND is_active = true
    `, [req.user.id, id]);
    
    if (!accessRows.length || !['owner', 'admin'].includes(accessRows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    // Cannot remove the owner
    const { rows: targetRows } = await query(
      `SELECT role FROM organization_members WHERE user_id = $1 AND org_id = $2`,
      [userId, id]
    );
    
    if (!targetRows.length) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    if (targetRows[0].role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove organization owner' });
    }
    
    // Deactivate membership
    await query(
      `UPDATE organization_members SET is_active = false WHERE user_id = $1 AND org_id = $2`,
      [userId, id]
    );
    
    res.json({ message: 'Member removed successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
