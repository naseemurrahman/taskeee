const jwt = require('jsonwebtoken');
const { query, isDemo } = require('../utils/db');
const { cacheGet, cacheSet } = require('../utils/redis');

// Higher index = more authority (for requireRole min-level checks)
const ROLE_HIERARCHY = ['employee', 'supervisor', 'manager', 'hr', 'director', 'admin'];

function getRoleLevel(role) {
  return ROLE_HIERARCHY.indexOf(role);
}

/** Roles that can see all users/tasks in the org (read-only HR + exec). */
const ORG_WIDE_ROLES = new Set(['hr', 'director', 'admin']);

function isOrgWideRole(role) {
  return ORG_WIDE_ROLES.has(role);
}

// ─── Verify JWT and attach user to req ────────────────────────────────────
async function authenticate(req, res, next) {
  const demo = typeof isDemo === 'function' ? isDemo() : false;
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });

    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const cacheKey = `user:${decoded.userId}`;
    // In-memory demo DB changes every request; never trust Redis user cache for demo mode.
    let user = demo ? null : await cacheGet(cacheKey);

    if (!user) {
      const { rows } = await query(
        `SELECT id, org_id, email, full_name, role, manager_id, is_active
         FROM users WHERE id = $1`,
        [decoded.userId]
      );
      if (!rows.length) return res.status(401).json({ error: 'User not found' });
      user = rows[0];
      if (!demo) await cacheSet(cacheKey, user, 300);
    }

    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token expired' });
    if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError')
      return res.status(401).json({ error: 'Invalid token' });
    return next(err);
  }
}

// ─── Require minimum role level (hierarchy) ────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    const userLevel = getRoleLevel(req.user.role);
    const required = Math.min(...roles.map(getRoleLevel));
    if (userLevel < required)
      return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

/** One-of explicit roles (not hierarchical). */
function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function sameOrg(req, res, next) {
  const orgId = req.params.orgId || req.body.orgId;
  if (orgId && orgId !== req.user.org_id)
    return res.status(403).json({ error: 'Cross-organization access denied' });
  next();
}

async function canManage(req, res, next) {
  // Org-wide roles (admin, hr, director) can manage any user
  if (isOrgWideRole(req.user.role)) return next();
  // Managers can also assign tasks to anyone in their org without strict hierarchy
  if (['manager', 'supervisor'].includes(req.user.role)) return next();

  const targetUserId = req.params.userId || req.body.assignedTo;
  if (!targetUserId) return next();
  if (targetUserId === req.user.id) return next();

  const { rows } = await query(
    `SELECT user_id FROM get_subordinate_ids($1) WHERE user_id = $2`,
    [req.user.id, targetUserId]
  );

  if (!rows.length)
    return res.status(403).json({ error: 'You can only manage your direct reports' });

  next();
}

module.exports = {
  authenticate,
  requireRole,
  requireAnyRole,
  sameOrg,
  canManage,
  getRoleLevel,
  ROLE_HIERARCHY,
  isOrgWideRole,
};
