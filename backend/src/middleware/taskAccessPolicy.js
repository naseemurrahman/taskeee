'use strict';

const { authenticate } = require('./auth');
const { hasAnyPermission, isPersonalOnlyRole } = require('../security/rbac');

function isPersonalTaskQuery(req) {
  return String(req.query?.mine || '').toLowerCase() === 'true';
}

function isCollectionGet(req) {
  return req.method === 'GET' && (req.path === '/' || req.path === '');
}

function isBulkStatusWrite(req) {
  return req.method === 'POST' && req.path === '/bulk/status';
}

function isTaskCreate(req) {
  return req.method === 'POST' && (req.path === '/' || req.path === '/create-simple');
}

function isTaskDelete(req) {
  return req.method === 'DELETE';
}

/**
 * enforceTaskCollectionAccess — runs AFTER authenticate so req.user is populated.
 */
function enforceTaskCollectionAccess(req, res, next) {
  if (!req.user) return next();

  const role = req.user.role;

  if (isCollectionGet(req)) {
    if (isPersonalOnlyRole(role) && !isPersonalTaskQuery(req)) {
      return res.status(403).json({
        error: 'Use My Tasks for personal task access. Full task management is restricted to supervisors and above.',
        code: 'TASK_MANAGEMENT_VIEW_FORBIDDEN',
      });
    }
    return next();
  }

  if (isTaskCreate(req) && !hasAnyPermission(role, ['tasks:create'])) {
    return res.status(403).json({
      error: 'Task creation is restricted to supervisors and above.',
      code: 'TASK_CREATE_FORBIDDEN',
    });
  }

  if (isBulkStatusWrite(req) && !hasAnyPermission(role, ['tasks:bulk:update'])) {
    return res.status(403).json({
      error: 'Bulk task updates are restricted to managers and above.',
      code: 'TASK_BULK_UPDATE_FORBIDDEN',
    });
  }

  if (isTaskDelete(req) && !hasAnyPermission(role, ['tasks:delete:team', 'tasks:delete:org'])) {
    return res.status(403).json({
      error: 'Task deletion is restricted to managers and above.',
      code: 'TASK_DELETE_FORBIDDEN',
    });
  }

  return next();
}

module.exports = {
  authenticate,
  enforceTaskCollectionAccess,
};
