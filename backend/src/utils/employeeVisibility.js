'use strict';

const { query } = require('./db');

const tableColumnsCache = new Map();

async function getTableColumns(tableName) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName);
  try {
    const { rows } = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const cols = new Set((rows || []).map((r) => String(r.column_name)));
    tableColumnsCache.set(tableName, cols);
    return cols;
  } catch (_err) {
    const cols = new Set();
    tableColumnsCache.set(tableName, cols);
    return cols;
  }
}

async function safeSubordinateUserIds(userId) {
  if (!userId) return [];
  try {
    const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [userId]);
    return (rows || []).map((r) => r.user_id).filter(Boolean);
  } catch (_err) {
    return [];
  }
}

async function employeeVisibilitySql(alias = 'u') {
  const empCols = await getTableColumns('employees');
  const canJoinEmployee = empCols.has('user_id') && empCols.has('status');
  if (!canJoinEmployee) return { join: '', condition: '' };

  const orgJoin = empCols.has('org_id')
    ? ` AND e_visibility.org_id = ${alias}.org_id`
    : empCols.has('organization_id')
      ? ` AND e_visibility.organization_id = ${alias}.org_id`
      : '';

  return {
    join: `LEFT JOIN employees e_visibility ON e_visibility.user_id = ${alias}.id${orgJoin}`,
    condition: `AND LOWER(COALESCE(e_visibility.status, 'active')) <> 'terminated'`,
  };
}

async function filterNonTerminatedUserIds(orgId, candidateIds = null, options = {}) {
  if (!orgId) return [];
  const { requireActive = true } = options;
  const { join, condition } = await employeeVisibilitySql('u');
  const params = [orgId];
  const clauses = ['u.org_id = $1'];

  if (requireActive) clauses.push('COALESCE(u.is_active, TRUE) = TRUE');
  if (Array.isArray(candidateIds)) {
    const ids = candidateIds.filter(Boolean);
    if (!ids.length) return [];
    params.push(ids);
    clauses.push(`u.id = ANY($${params.length})`);
  }

  const { rows } = await query(
    `SELECT DISTINCT u.id
       FROM users u
       ${join}
      WHERE ${clauses.join(' AND ')}
        ${condition}
      ORDER BY u.id`,
    params
  );
  return (rows || []).map((r) => r.id).filter(Boolean);
}

async function scopedNonTerminatedUserIds(user, options = {}) {
  const orgId = user?.org_id ?? user?.orgId;
  const role = String(user?.role || '').toLowerCase();
  const orgWideRoles = new Set(options.orgWideRoles || ['admin', 'director', 'hr']);
  const managerRoles = new Set(options.managerRoles || ['supervisor', 'manager', 'director']);
  const requireActive = options.requireActive !== false;

  if (!orgId || !user?.id) return [];
  if (orgWideRoles.has(role)) return filterNonTerminatedUserIds(orgId, null, { requireActive });

  if (managerRoles.has(role)) {
    const subordinateIds = await safeSubordinateUserIds(user.id);
    return filterNonTerminatedUserIds(orgId, [user.id, ...subordinateIds], { requireActive });
  }

  return filterNonTerminatedUserIds(orgId, [user.id], { requireActive });
}

module.exports = {
  getTableColumns,
  employeeVisibilitySql,
  filterNonTerminatedUserIds,
  scopedNonTerminatedUserIds,
  safeSubordinateUserIds,
};
