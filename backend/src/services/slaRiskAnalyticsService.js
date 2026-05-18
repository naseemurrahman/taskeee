'use strict';

const { query } = require('../utils/db');
const { filterNonTerminatedUserIds } = require('../utils/employeeVisibility');

const CLOSED = ['completed', 'manager_approved', 'cancelled'];
const ORG_WIDE_ROLES = new Set(['admin', 'director', 'hr']);
const columnsCache = new Map();

function orgIdOf(user) {
  return user?.org_id || user?.orgId || null;
}

function roleOf(user) {
  return String(user?.role || '').trim().toLowerCase();
}

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  try {
    const { rows } = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const cols = new Set((rows || []).map((row) => String(row.column_name)));
    columnsCache.set(tableName, cols);
    return cols;
  } catch (_err) {
    const cols = new Set();
    columnsCache.set(tableName, cols);
    return cols;
  }
}

async function targetUserIds(user, filters = {}) {
  const orgId = orgIdOf(user);
  if (!orgId) return [];
  if (filters.employeeId) return filterNonTerminatedUserIds(orgId, [filters.employeeId], { requireActive: true });
  if (ORG_WIDE_ROLES.has(roleOf(user))) return filterNonTerminatedUserIds(orgId, null, { requireActive: true });
  return filterNonTerminatedUserIds(orgId, [user.id].filter(Boolean), { requireActive: true });
}

function exprs(cols) {
  return {
    id: cols.has('id') ? 't.id' : 'NULL',
    title: cols.has('title') ? 't.title' : `'Untitled task'`,
    status: cols.has('status') ? 't.status' : `'unknown'`,
    priority: cols.has('priority') ? `LOWER(COALESCE(t.priority, 'unspecified'))` : `'unspecified'`,
    createdAt: cols.has('created_at') ? 't.created_at' : 'NOW()',
    updatedAt: cols.has('updated_at') ? 't.updated_at' : cols.has('created_at') ? 't.created_at' : 'NOW()',
    dueDate: cols.has('due_date') ? 't.due_date' : 'NULL::timestamp',
    assignedTo: cols.has('assigned_to') ? 't.assigned_to' : 'NULL',
  };
}

async function getSlaRisk(user, filters = {}) {
  const cols = await getColumns('tasks');
  const orgId = orgIdOf(user);
  const ids = await targetUserIds(user, filters);
  const e = exprs(cols);
  const values = [];
  const clauses = [];

  if (orgId && cols.has('org_id')) {
    values.push(orgId);
    clauses.push(`t.org_id = $${values.length}`);
  }

  if (cols.has('assigned_to')) {
    if (!ids.length) clauses.push('FALSE');
    else {
      values.push(ids);
      clauses.push(`t.assigned_to = ANY($${values.length})`);
    }
  }

  if (filters.projectId && cols.has('project_id')) {
    values.push(filters.projectId);
    clauses.push(`t.project_id = $${values.length}`);
  } else if (filters.projectId && cols.has('category_id')) {
    values.push(filters.projectId);
    clauses.push(`t.category_id = $${values.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const summaryValues = [...values, CLOSED];
  const closedParam = summaryValues.length;
  const due = e.dueDate;
  const riskScore = `LEAST(100,
    (CASE WHEN ${due} < NOW() THEN 45 ELSE 0 END) +
    (CASE WHEN ${due} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' THEN 25 ELSE 0 END) +
    (CASE WHEN ${e.priority} IN ('urgent', 'critical') THEN 35 WHEN ${e.priority} = 'high' THEN 20 ELSE 0 END) +
    (CASE WHEN ${e.status} = 'pending' AND ${e.createdAt} < NOW() - INTERVAL '3 days' THEN 20 ELSE 0 END) +
    (CASE WHEN ${e.status} IN ('submitted', 'ai_reviewing') THEN 12 ELSE 0 END)
  )`;

  const { rows: summaryRows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ${e.status} <> ALL($${closedParam}))::int AS open_tasks,
       COUNT(*) FILTER (WHERE ${due} < NOW() AND ${e.status} <> ALL($${closedParam}))::int AS overdue_tasks,
       COUNT(*) FILTER (WHERE ${due} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' AND ${e.status} <> ALL($${closedParam}))::int AS due_soon_72h,
       COUNT(*) FILTER (WHERE ${e.priority} IN ('urgent', 'critical') AND ${e.status} <> ALL($${closedParam}))::int AS critical_priority_open,
       COUNT(*) FILTER (WHERE ${e.status} = 'pending' AND ${e.createdAt} < NOW() - INTERVAL '3 days')::int AS stalled_pending,
       COUNT(*) FILTER (WHERE ${e.status} IN ('submitted', 'ai_reviewing'))::int AS review_backlog
     FROM tasks t
     ${where}`,
    summaryValues
  );

  const assignedJoin = cols.has('assigned_to')
    ? `LEFT JOIN users u ON u.id = ${e.assignedTo}${cols.has('org_id') ? ' AND u.org_id = t.org_id' : ''}`
    : '';

  const { rows: taskRows } = await query(
    `SELECT *
     FROM (
       SELECT
         ${e.id} AS task_id,
         ${e.title} AS title,
         ${e.status} AS status,
         ${e.priority} AS priority,
         ${e.createdAt}::text AS created_at,
         ${e.updatedAt}::text AS updated_at,
         ${e.dueDate}::text AS due_date,
         ${cols.has('assigned_to') ? 'COALESCE(u.full_name, \'Unassigned\')' : `'Unassigned'`} AS assigned_to_name,
         ${riskScore}::int AS risk_score,
         CASE
           WHEN ${due} < NOW() THEN 'Overdue deadline'
           WHEN ${e.priority} IN ('urgent', 'critical') THEN 'Urgent or critical priority'
           WHEN ${e.status} = 'pending' AND ${e.createdAt} < NOW() - INTERVAL '3 days' THEN 'Stalled pending task'
           WHEN ${e.status} IN ('submitted', 'ai_reviewing') THEN 'Review backlog'
           WHEN ${due} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' THEN 'Due within 72 hours'
           ELSE 'Operational risk signal'
         END AS risk_reason
       FROM tasks t
       ${assignedJoin}
       ${where}
     ) risk_tasks
     WHERE risk_score > 0
     ORDER BY risk_score DESC, due_date ASC NULLS LAST, priority DESC
     LIMIT 25`,
    values
  );

  return {
    summary: summaryRows[0] || {
      open_tasks: 0,
      overdue_tasks: 0,
      due_soon_72h: 0,
      critical_priority_open: 0,
      stalled_pending: 0,
      review_backlog: 0,
    },
    tasks: taskRows,
  };
}

module.exports = { getSlaRisk };
