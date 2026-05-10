'use strict';

const { authenticate } = require('./auth');

/**
 * Role sets for task access control.
 * admin, director, hr, manager, supervisor can all create/manage tasks.
 * employee and technician are restricted to their own assigned tasks.
 */
const MANAGEMENT_ROLES   = new Set(['supervisor', 'manager', 'hr', 'director', 'admin']);
const PERSONAL_ONLY_ROLES = new Set(['employee', 'technician']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isPersonalTaskQuery(req) {
  return String(req.query?.mine || '').toLowerCase() === 'true';
}

function isCollectionGet(req) {
  return req.method === 'GET' && (req.path === '/' || req.path === '');
}

function isManagementWrite(req) {
  if (req.method === 'POST' && (req.path === '/' || req.path === '/create-simple' || req.path === '/bulk/status')) return true;
  if (req.method === 'DELETE') return true;
  return false;
}

/**
 * enforceTaskCollectionAccess — runs AFTER authenticate so req.user is populated.
 * Mounting order in server.js must be:
 *   app.use('/api/v1/tasks', authenticate, enforceTaskCollectionAccess)
 * NOT:
 *   app.use('/api/v1/tasks', enforceTaskCollectionAccess)   ← old broken order
 */
function enforceTaskCollectionAccess(req, res, next) {
  // If authenticate hasn't run yet (shouldn't happen with correct mount order)
  // fall through so the route's own authenticate() can handle 401.
  if (!req.user) return next();

  const role = normalizeRole(req.user.role);

  if (isCollectionGet(req)) {
    if (PERSONAL_ONLY_ROLES.has(role) && !isPersonalTaskQuery(req)) {
      return res.status(403).json({
        error: 'Use My Tasks for personal task access. Full task management is restricted to supervisors and above.',
        code: 'TASK_MANAGEMENT_VIEW_FORBIDDEN',
      });
    }
    return next();
  }

  if (isManagementWrite(req) && !MANAGEMENT_ROLES.has(role)) {
    return res.status(403).json({
      error: 'Task management action is restricted to supervisors and above.',
      code: 'TASK_MANAGEMENT_ACTION_FORBIDDEN',
    });
  }

  return next();
}

module.exports = {
  authenticate,
  enforceTaskCollectionAccess,
};
