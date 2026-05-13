'use strict';

const ROLE_HIERARCHY = Object.freeze([
  'employee',
  'technician',
  'supervisor',
  'manager',
  'hr',
  'director',
  'admin',
]);

const MANAGEMENT_ROLES = Object.freeze(new Set(['supervisor', 'manager', 'hr', 'director', 'admin']));
const ORG_WIDE_ROLES = Object.freeze(new Set(['hr', 'director', 'admin']));
const PERSONAL_ONLY_ROLES = Object.freeze(new Set(['employee', 'technician']));

const ROLE_PERMISSIONS = Object.freeze({
  employee: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:self',
    'timeoff:create:self',
    'search:own',
  ],
  technician: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:self',
    'timeoff:create:self',
    'search:own',
  ],
  supervisor: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:self',
    'tasks:read:team',
    'tasks:create',
    'tasks:update:team',
    'tasks:delete:team',
    'projects:read:team',
    'employees:read:team',
    'search:team',
  ],
  manager: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:self',
    'tasks:read:team',
    'tasks:create',
    'tasks:update:team',
    'tasks:delete:team',
    'tasks:bulk:update',
    'projects:read:org',
    'projects:create',
    'projects:update',
    'employees:read:team',
    'users:create:team',
    'search:team',
  ],
  hr: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:org',
    'tasks:create',
    'tasks:update:org',
    'tasks:delete:org',
    'tasks:bulk:update',
    'projects:read:org',
    'projects:create',
    'projects:update',
    'employees:read:org',
    'employees:read:sensitive',
    'employees:create',
    'employees:update',
    'employees:delete',
    'users:read:org',
    'users:create:org',
    'timeoff:manage',
    'search:org',
    'search:people:org',
  ],
  director: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:org',
    'tasks:create',
    'tasks:update:org',
    'tasks:delete:org',
    'tasks:bulk:update',
    'projects:read:org',
    'projects:create',
    'projects:update',
    'employees:read:org',
    'employees:read:sensitive',
    'employees:create',
    'employees:update',
    'employees:delete',
    'users:read:org',
    'users:create:org',
    'reports:read:org',
    'audit:read',
    'timeoff:manage',
    'search:org',
    'search:people:org',
    'ai:govern',
  ],
  admin: [
    'profile:read:self',
    'profile:update:self',
    'tasks:read:org',
    'tasks:create',
    'tasks:update:org',
    'tasks:delete:org',
    'tasks:bulk:update',
    'projects:read:org',
    'projects:create',
    'projects:update',
    'employees:read:org',
    'employees:read:sensitive',
    'employees:create',
    'employees:update',
    'employees:delete',
    'users:read:org',
    'users:create:org',
    'users:manage',
    'reports:read:org',
    'audit:read',
    'settings:read',
    'settings:write',
    'integrations:manage',
    'billing:manage',
    'timeoff:manage',
    'search:org',
    'search:people:org',
    'ai:govern',
    'rbac:manage',
  ],
});

const SENSITIVE_USER_FIELDS = Object.freeze(new Set([
  'mfa_secret_enc',
  'password_hash',
  'temp_password',
  'temp_password_expires',
  'notification_prefs',
  'phone_e164',
  'whatsapp_e164',
]));

const SENSITIVE_EMPLOYEE_FIELDS = Object.freeze(new Set([
  'compensation',
  'metadata',
  'phone_e164',
  'personal_email',
  'national_id',
  'iqama_id',
  'bank_account',
  'salary',
]));

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function roleLevel(role) {
  return ROLE_HIERARCHY.indexOf(normalizeRole(role));
}

function roleAtLeast(role, minimumRole) {
  const current = roleLevel(role);
  const minimum = roleLevel(minimumRole);
  return current >= 0 && minimum >= 0 && current >= minimum;
}

function permissionsForRole(role) {
  return new Set(ROLE_PERMISSIONS[normalizeRole(role)] || []);
}

function hasPermission(role, permission) {
  return permissionsForRole(role).has(permission);
}

function hasAnyPermission(role, permissions) {
  return (permissions || []).some((permission) => hasPermission(role, permission));
}

function isOrgWideRole(role) {
  return ORG_WIDE_ROLES.has(normalizeRole(role));
}

function isManagementRole(role) {
  return MANAGEMENT_ROLES.has(normalizeRole(role));
}

function isPersonalOnlyRole(role) {
  return PERSONAL_ONLY_ROLES.has(normalizeRole(role));
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!hasAnyPermission(role, permissions)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'RBAC_PERMISSION_DENIED',
        required: permissions,
      });
    }
    return next();
  };
}

function sanitizeFields(row, blockedFields) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const field of blockedFields) delete out[field];
  return out;
}

function sanitizeUserForActor(row, actor) {
  const isSelf = row?.id && actor?.id && String(row.id) === String(actor.id);
  const canReadOrgUsers = hasPermission(actor?.role, 'users:read:org');
  if (isSelf || canReadOrgUsers) return { ...row };
  return sanitizeFields(row, SENSITIVE_USER_FIELDS);
}

function sanitizeEmployeeForActor(row, actor) {
  const canReadSensitive = hasPermission(actor?.role, 'employees:read:sensitive');
  if (canReadSensitive) return { ...row };
  return sanitizeFields(row, SENSITIVE_EMPLOYEE_FIELDS);
}

function actorScopeLabel(actor) {
  const role = normalizeRole(actor?.role);
  if (isOrgWideRole(role)) return 'org';
  if (['manager', 'supervisor'].includes(role)) return 'team';
  return 'self';
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  MANAGEMENT_ROLES,
  ORG_WIDE_ROLES,
  PERSONAL_ONLY_ROLES,
  SENSITIVE_USER_FIELDS,
  SENSITIVE_EMPLOYEE_FIELDS,
  normalizeRole,
  roleLevel,
  roleAtLeast,
  permissionsForRole,
  hasPermission,
  hasAnyPermission,
  isOrgWideRole,
  isManagementRole,
  isPersonalOnlyRole,
  requirePermission,
  sanitizeUserForActor,
  sanitizeEmployeeForActor,
  actorScopeLabel,
};
