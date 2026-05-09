/**
 * permissions.js — Single source of truth for all role-based access control.
 * Used by backend route guards. Frontend mirror is at frontend/src/lib/permissions.ts
 *
 * Role hierarchy (ascending authority):
 *   employee → technician → supervisor → manager → hr → director → admin
 */

const ROLE_RANK = {
  employee: 10, technician: 15, supervisor: 20,
  manager: 30, hr: 40, director: 50, admin: 60,
};

const TASK_TRANSITIONS = {
  // source_status → allowed_target_statuses per role
  pending:            { employee: ['in_progress'], supervisor: ['in_progress','cancelled'], manager: ['in_progress','cancelled'], hr: ['in_progress','cancelled','completed'], director: '*', admin: '*' },
  in_progress:        { employee: ['submitted'], supervisor: ['submitted','completed','cancelled'], manager: ['submitted','completed','cancelled'], hr: ['submitted','completed','cancelled'], director: '*', admin: '*' },
  submitted:          { employee: [], supervisor: ['ai_reviewing','manager_approved','manager_rejected','in_progress'], manager: ['manager_approved','manager_rejected','in_progress'], hr: ['manager_approved','manager_rejected'], director: '*', admin: '*' },
  ai_reviewing:       { employee: [], supervisor: ['manager_approved','manager_rejected'], manager: ['manager_approved','manager_rejected'], hr: ['manager_approved','manager_rejected'], director: '*', admin: '*' },
  ai_approved:        { employee: [], supervisor: ['manager_approved','manager_rejected'], manager: ['manager_approved','manager_rejected'], hr: ['manager_approved'], director: '*', admin: '*' },
  ai_rejected:        { employee: ['in_progress'], supervisor: ['in_progress','submitted'], manager: ['in_progress','submitted'], hr: ['in_progress'], director: '*', admin: '*' },
  manager_approved:   { employee: ['completed'], supervisor: ['completed'], manager: ['completed'], hr: ['completed'], director: '*', admin: '*' },
  manager_rejected:   { employee: ['in_progress'], supervisor: ['in_progress'], manager: ['in_progress'], hr: ['in_progress'], director: '*', admin: '*' },
  completed:          { employee: [], supervisor: [], manager: ['in_progress'], hr: ['in_progress'], director: '*', admin: '*' },
  overdue:            { employee: ['in_progress'], supervisor: ['in_progress','cancelled'], manager: ['in_progress','cancelled'], hr: ['in_progress','cancelled'], director: '*', admin: '*' },
  cancelled:          { employee: [], supervisor: [], manager: ['pending'], hr: ['pending'], director: '*', admin: '*' },
};

/**
 * Permission matrix — each entry defines:
 *   minRole: minimum role required (inclusive)
 *   exact: only these roles allowed (overrides minRole if present)
 *   deny: explicitly denied roles
 */
const PERMISSIONS = {
  // Task operations
  'task.create':          { minRole: 'supervisor' },
  'task.read.own':        { minRole: 'employee' },
  'task.read.team':       { minRole: 'supervisor' },
  'task.read.org':        { minRole: 'hr' },
  'task.update.own':      { minRole: 'employee' },
  'task.update.any':      { minRole: 'supervisor' },
  'task.delete':          { minRole: 'manager' },
  'task.assign':          { minRole: 'supervisor' },
  'task.bulk_assign':     { minRole: 'supervisor' },
  'task.approve':         { minRole: 'manager' },
  'task.override_status': { minRole: 'director' },
  'task.bulk_delete':     { minRole: 'manager' },

  // Comment/file
  'task.comment':         { minRole: 'employee' },
  'task.upload_file':     { minRole: 'employee' },
  'task.upload_file.any': { minRole: 'supervisor' },

  // Analytics
  'analytics.own':        { minRole: 'employee' },
  'analytics.team':       { minRole: 'manager' },
  'analytics.org':        { minRole: 'hr' },

  // User management
  'user.create':          { minRole: 'hr' },
  'user.update.own':      { minRole: 'employee' },
  'user.update.any':      { minRole: 'hr' },
  'user.delete':          { minRole: 'admin' },
  'user.read.org':        { minRole: 'supervisor' },

  // Reports
  'report.generate':      { minRole: 'manager' },
  'report.read.own':      { minRole: 'employee' },
  'report.read.org':      { minRole: 'hr' },

  // Projects
  'project.create':       { minRole: 'supervisor' },
  'project.update':       { minRole: 'supervisor' },
  'project.delete':       { minRole: 'manager' },

  // HR/time-off
  'timeoff.request':      { minRole: 'employee' },
  'timeoff.approve':      { minRole: 'manager' },
  'timeoff.read.org':     { minRole: 'hr' },

  // AI
  'ai.chat':              { minRole: 'employee' },
  'ai.recommendations':   { minRole: 'manager' },

  // Admin
  'admin.settings':       { minRole: 'admin' },
  'admin.billing':        { minRole: 'admin' },
  'admin.audit':          { minRole: 'hr' },
};

function getRank(role) {
  return ROLE_RANK[String(role || '').toLowerCase().trim()] ?? 0;
}

/**
 * Check if a role has permission for an action.
 * @param {string} role - User's role
 * @param {string} permission - Permission key from PERMISSIONS
 * @returns {{ allowed: boolean, reason: string }}
 */
function checkPermission(role, permission) {
  const norm = String(role || '').toLowerCase().trim();
  const rule = PERMISSIONS[permission];

  if (!rule) {
    return { allowed: false, reason: `Unknown permission: ${permission}` };
  }

  if (rule.deny && rule.deny.includes(norm)) {
    return { allowed: false, reason: `Role '${norm}' is explicitly denied '${permission}'` };
  }

  if (rule.exact) {
    const ok = rule.exact.includes(norm);
    return { allowed: ok, reason: ok ? 'ok' : `Role '${norm}' not in allowed set for '${permission}'` };
  }

  if (rule.minRole) {
    const ok = getRank(norm) >= getRank(rule.minRole);
    return { allowed: ok, reason: ok ? 'ok' : `Role '${norm}' below minimum '${rule.minRole}' for '${permission}'` };
  }

  return { allowed: false, reason: 'No rule matched' };
}

/**
 * Express middleware — deny request if role lacks permission.
 * Usage: router.post('/tasks', requirePermission('task.create'), handler)
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { allowed, reason } = checkPermission(req.user.role, permission);
    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden', reason, permission });
    }
    next();
  };
}

/**
 * Get allowed target statuses for a task transition.
 * Returns '*' means any status (director/admin).
 */
function getAllowedTransitions(fromStatus, role) {
  const norm = String(role || '').toLowerCase().trim();
  const map = TASK_TRANSITIONS[fromStatus];
  if (!map) return [];
  const allowed = map[norm] ?? [];
  if (allowed === '*') return Object.keys(TASK_TRANSITIONS); // all statuses
  // Fall up the hierarchy: if no exact match, check one level up
  if (allowed.length === 0) {
    const levels = ['employee', 'technician', 'supervisor', 'manager', 'hr', 'director', 'admin'];
    const idx = levels.indexOf(norm);
    for (let i = idx - 1; i >= 0; i--) {
      const inherited = map[levels[i]];
      if (inherited && inherited.length > 0) return inherited;
    }
  }
  return allowed;
}

function canTransition(fromStatus, toStatus, role) {
  const allowed = getAllowedTransitions(fromStatus, role);
  if (allowed === '*' || allowed.includes('*')) return true;
  return Array.isArray(allowed) && allowed.includes(toStatus);
}

module.exports = {
  PERMISSIONS, TASK_TRANSITIONS, ROLE_RANK,
  checkPermission, requirePermission,
  getAllowedTransitions, canTransition, getRank,
};
