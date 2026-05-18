'use strict';

const { query } = require('../utils/db');
const { filterNonTerminatedUserIds } = require('../utils/employeeVisibility');

const COMPLETED = ['completed', 'manager_approved'];
const CLOSED = ['completed', 'manager_approved', 'cancelled'];
const ORG_WIDE_ROLES = new Set(['admin', 'director', 'hr']);

const columnsCache = new Map();
const tableCache = new Map();

function roleOf(user) {
  return String(user?.role || '').trim().toLowerCase();
}

function orgIdOf(user) {
  return user?.org_id || user?.orgId || null;
}

function intParam(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function tableExists(tableName) {
  if (tableCache.has(tableName)) return tableCache.get(tableName);
  try {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [tableName]
    );
    const exists = !!rows[0]?.exists;
    tableCache.set(tableName, exists);
    return exists;
  } catch (_err) {
    tableCache.set(tableName, false);
    return false;
  }
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

  if (filters.employeeId) {
    return filterNonTerminatedUserIds(orgId, [filters.employeeId], { requireActive: true });
  }

  if (ORG_WIDE_ROLES.has(roleOf(user))) {
    return filterNonTerminatedUserIds(orgId, null, { requireActive: true });
  }

  return filterNonTerminatedUserIds(orgId, [user.id].filter(Boolean), { requireActive: true });
}

async function baseScope(user, filters = {}, alias = 't', options = {}) {
  const taskCols = await getColumns('tasks');
  const orgId = orgIdOf(user);
  const ids = await targetUserIds(user, filters);
  const values = [];
  const clauses = [];
  const days = intParam(filters.days, 30, 365);

  if (orgId && taskCols.has('org_id')) {
    values.push(orgId);
    clauses.push(`${alias}.org_id = $${values.length}`);
  }

  if (taskCols.has('assigned_to')) {
    if (!ids.length) clauses.push('FALSE');
    else {
      values.push(ids);
      clauses.push(`${alias}.assigned_to = ANY($${values.length})`);
    }
  }

  if (filters.projectId && taskCols.has('project_id')) {
    values.push(filters.projectId);
    clauses.push(`${alias}.project_id = $${values.length}`);
  } else if (filters.projectId && taskCols.has('category_id')) {
    values.push(filters.projectId);
    clauses.push(`${alias}.category_id = $${values.length}`);
  }

  const dateColumn = options.dateColumn || 'created_at';
  if (options.applyDate !== false && taskCols.has(dateColumn)) {
    if (filters.from) {
      values.push(filters.from);
      clauses.push(`${alias}.${dateColumn} >= $${values.length}`);
    } else {
      values.push(String(days));
      clauses.push(`${alias}.${dateColumn} >= NOW() - ($${values.length}::text || ' days')::interval`);
    }

    if (filters.to) {
      values.push(filters.to);
      clauses.push(`${alias}.${dateColumn} <= $${values.length}`);
    }
  }

  return { taskCols, values, clauses, ids, days, where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '' };
}

async function projectDimension(taskCols, alias = 't') {
  if (taskCols.has('project_id') && await tableExists('projects')) {
    return {
      joins: `LEFT JOIN projects p_analytics ON p_analytics.id = ${alias}.project_id${taskCols.has('org_id') ? ` AND p_analytics.org_id = ${alias}.org_id` : ''}`,
      idExpr: `COALESCE(${alias}.project_id::text, 'unassigned')`,
      nameExpr: `COALESCE(p_analytics.name, 'Unassigned project')`,
      statusExpr: `COALESCE(p_analytics.status, 'active')`,
    };
  }

  if (taskCols.has('category_id') && await tableExists('task_categories')) {
    return {
      joins: `LEFT JOIN task_categories c_analytics ON c_analytics.id = ${alias}.category_id${taskCols.has('org_id') ? ` AND c_analytics.org_id = ${alias}.org_id` : ''}`,
      idExpr: `COALESCE(${alias}.category_id::text, 'uncategorized')`,
      nameExpr: `COALESCE(c_analytics.name, 'Uncategorized')`,
      statusExpr: `'active'`,
    };
  }

  if (taskCols.has('category_name')) {
    return {
      joins: '',
      idExpr: `COALESCE(NULLIF(${alias}.category_name, ''), 'uncategorized')`,
      nameExpr: `COALESCE(NULLIF(${alias}.category_name, ''), 'Uncategorized')`,
      statusExpr: `'active'`,
    };
  }

  if (taskCols.has('category')) {
    return {
      joins: '',
      idExpr: `COALESCE(NULLIF(${alias}.category, ''), 'uncategorized')`,
      nameExpr: `COALESCE(NULLIF(${alias}.category, ''), 'Uncategorized')`,
      statusExpr: `'active'`,
    };
  }

  return {
    joins: '',
    idExpr: `'all'`,
    nameExpr: `'All tasks'`,
    statusExpr: `'active'`,
  };
}

function taskExprs(taskCols, alias = 't') {
  return {
    id: taskCols.has('id') ? `${alias}.id` : 'NULL',
    title: taskCols.has('title') ? `${alias}.title` : `'Untitled task'`,
    status: taskCols.has('status') ? `${alias}.status` : `'unknown'`,
    priority: taskCols.has('priority') ? `LOWER(COALESCE(${alias}.priority, 'unspecified'))` : `'unspecified'`,
    createdAt: taskCols.has('created_at') ? `${alias}.created_at` : 'NOW()',
    updatedAt: taskCols.has('updated_at') ? `${alias}.updated_at` : (taskCols.has('created_at') ? `${alias}.created_at` : 'NOW()'),
    completedAt: taskCols.has('completed_at') ? `${alias}.completed_at` : (taskCols.has('updated_at') ? `${alias}.updated_at` : (taskCols.has('created_at') ? `${alias}.created_at` : 'NOW()')),
    dueDate: taskCols.has('due_date') ? `${alias}.due_date` : 'NULL::timestamp',
    assignedTo: taskCols.has('assigned_to') ? `${alias}.assigned_to` : 'NULL',
  };
}

async function getProjectSummary(user, filters = {}) {
  const scope = await baseScope(user, filters, 't');
  const dim = await projectDimension(scope.taskCols, 't');
  const expr = taskExprs(scope.taskCols, 't');

  const { rows } = await query(
    `SELECT
       ${dim.idExpr} AS project_id,
       ${dim.nameExpr} AS project_name,
       ${dim.statusExpr} AS project_status,
       COUNT(*)::int AS total_tasks,
       COUNT(*) FILTER (WHERE ${expr.status} = ANY($${scope.values.length + 1}))::int AS completed_tasks,
       COUNT(*) FILTER (WHERE ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled'))::int AS open_tasks,
       COUNT(*) FILTER (WHERE ${expr.dueDate} < NOW() AND ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled'))::int AS overdue_tasks,
       COUNT(*) FILTER (WHERE ${expr.priority} IN ('high', 'critical', 'urgent'))::int AS high_priority_tasks,
       MIN(${expr.dueDate})::text AS earliest_due_date,
       MAX(${expr.dueDate})::text AS latest_due_date,
       ROUND(100.0 * COUNT(*) FILTER (WHERE ${expr.status} = ANY($${scope.values.length + 1})) / NULLIF(COUNT(*), 0), 1)::float AS completion_rate
     FROM tasks t
     ${dim.joins}
     ${scope.where}
     GROUP BY 1, 2, 3
     ORDER BY open_tasks DESC, overdue_tasks DESC, total_tasks DESC, project_name ASC
     LIMIT 50`,
    [...scope.values, COMPLETED]
  );

  return { projects: rows };
}

async function getProjectTrend(user, filters = {}) {
  const scope = await baseScope(user, filters, 't', { applyDate: false });
  const dim = await projectDimension(scope.taskCols, 't');
  const expr = taskExprs(scope.taskCols, 't');
  const values = [...scope.values, COMPLETED, String(scope.days)];
  const completedParam = scope.values.length + 1;
  const daysParam = scope.values.length + 2;

  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - (($${daysParam}::int - 1) * INTERVAL '1 day'), CURRENT_DATE, INTERVAL '1 day')::date AS day
     ), scoped_tasks AS (
       SELECT
         t.*,
         ${dim.idExpr} AS project_id,
         ${dim.nameExpr} AS project_name
       FROM tasks t
       ${dim.joins}
       ${scope.where}
     ), top_projects AS (
       SELECT project_id, project_name, COUNT(*) AS total
       FROM scoped_tasks
       GROUP BY project_id, project_name
       ORDER BY total DESC, project_name ASC
       LIMIT 8
     ), events AS (
       SELECT date_trunc('day', ${expr.createdAt})::date AS day, project_id, project_name, 1::int AS created, 0::int AS completed, 0::int AS overdue
       FROM scoped_tasks
       WHERE ${expr.createdAt} IS NOT NULL
       UNION ALL
       SELECT date_trunc('day', ${expr.completedAt})::date AS day, project_id, project_name, 0, 1, 0
       FROM scoped_tasks
       WHERE ${expr.status} = ANY($${completedParam}) AND ${expr.completedAt} IS NOT NULL
       UNION ALL
       SELECT date_trunc('day', ${expr.dueDate})::date AS day, project_id, project_name, 0, 0, 1
       FROM scoped_tasks
       WHERE ${expr.dueDate} IS NOT NULL
         AND ${expr.dueDate} < NOW()
         AND ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled')
     )
     SELECT
       d.day::text AS day,
       p.project_id,
       p.project_name,
       COALESCE(SUM(e.created), 0)::int AS created,
       COALESCE(SUM(e.completed), 0)::int AS completed,
       COALESCE(SUM(e.overdue), 0)::int AS overdue
     FROM days d
     CROSS JOIN top_projects p
     LEFT JOIN events e ON e.day = d.day AND e.project_id = p.project_id
     GROUP BY d.day, p.project_id, p.project_name
     ORDER BY d.day ASC, p.project_name ASC`,
    values
  );

  return { points: rows };
}

async function getDepartmentPerformance(user, filters = {}) {
  const taskCols = await getColumns('tasks');
  const userCols = await getColumns('users');
  const orgId = orgIdOf(user);
  const ids = await targetUserIds(user, filters);
  const expr = taskExprs(taskCols, 't');
  const values = [];
  const where = [];

  if (orgId) {
    values.push(orgId);
    where.push(`u.org_id = $${values.length}`);
  }

  if (!ids.length) where.push('FALSE');
  else {
    values.push(ids);
    where.push(`u.id = ANY($${values.length})`);
  }

  values.push(COMPLETED);
  const completedParam = values.length;
  values.push(String(intParam(filters.days, 30, 365)));
  const daysParam = values.length;
  const dateClause = taskCols.has('created_at') ? `AND t.created_at >= NOW() - ($${daysParam}::text || ' days')::interval` : '';
  const departmentExpr = userCols.has('department') ? `COALESCE(NULLIF(u.department, ''), 'Unassigned')` : `'Unassigned'`;
  const join = taskCols.has('assigned_to')
    ? `t.assigned_to = u.id${taskCols.has('org_id') ? ' AND t.org_id = u.org_id' : ''} ${dateClause}`
    : 'FALSE';

  const { rows } = await query(
    `SELECT
       ${departmentExpr} AS department,
       COUNT(DISTINCT u.id)::int AS employee_count,
       COUNT(t.id)::int AS assigned_tasks,
       COUNT(t.id) FILTER (WHERE ${expr.status} = ANY($${completedParam}))::int AS completed_tasks,
       COUNT(t.id) FILTER (WHERE ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled'))::int AS open_tasks,
       COUNT(t.id) FILTER (WHERE ${expr.dueDate} < NOW() AND ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled'))::int AS overdue_tasks,
       ROUND(100.0 * COUNT(t.id) FILTER (WHERE ${expr.status} = ANY($${completedParam})) / NULLIF(COUNT(t.id), 0), 1)::float AS completion_rate,
       ROUND(COUNT(t.id) FILTER (WHERE ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled'))::numeric / NULLIF(COUNT(DISTINCT u.id), 0), 1)::float AS avg_open_tasks
     FROM users u
     LEFT JOIN tasks t ON ${join}
     WHERE ${where.join(' AND ')}
     GROUP BY 1
     ORDER BY open_tasks DESC, overdue_tasks DESC, assigned_tasks DESC, department ASC`,
    values
  );

  return { departments: rows };
}

async function getEmployeeTrend(user, filters = {}) {
  const taskCols = await getColumns('tasks');
  const orgId = orgIdOf(user);
  const ids = await targetUserIds(user, filters);
  const expr = taskExprs(taskCols, 't');
  const days = intParam(filters.days, 30, 365);
  const values = [];
  const userWhere = [];
  if (orgId) {
    values.push(orgId);
    userWhere.push(`u.org_id = $${values.length}`);
  }
  if (!ids.length) userWhere.push('FALSE');
  else {
    values.push(ids);
    userWhere.push(`u.id = ANY($${values.length})`);
  }
  values.push(COMPLETED);
  const completedParam = values.length;
  values.push(String(days));
  const daysParam = values.length;

  const join = taskCols.has('assigned_to')
    ? `t.assigned_to = e.employee_id${taskCols.has('org_id') ? ' AND t.org_id = e.org_id' : ''}`
    : 'FALSE';

  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - (($${daysParam}::int - 1) * INTERVAL '1 day'), CURRENT_DATE, INTERVAL '1 day')::date AS day
     ), employees AS (
       SELECT u.id AS employee_id, u.org_id, u.full_name AS employee_name
       FROM users u
       WHERE ${userWhere.join(' AND ')}
       ORDER BY u.full_name ASC
       LIMIT 12
     ), employee_tasks AS (
       SELECT t.*, e.employee_id, e.employee_name
       FROM employees e
       LEFT JOIN tasks t ON ${join}
     ), events AS (
       SELECT date_trunc('day', ${expr.createdAt})::date AS day, employee_id, employee_name, 1::int AS assigned, 0::int AS completed, 0::int AS overdue
       FROM employee_tasks t
       WHERE ${expr.id} IS NOT NULL AND ${expr.createdAt} IS NOT NULL
       UNION ALL
       SELECT date_trunc('day', ${expr.completedAt})::date AS day, employee_id, employee_name, 0, 1, 0
       FROM employee_tasks t
       WHERE ${expr.id} IS NOT NULL AND ${expr.status} = ANY($${completedParam}) AND ${expr.completedAt} IS NOT NULL
       UNION ALL
       SELECT date_trunc('day', ${expr.dueDate})::date AS day, employee_id, employee_name, 0, 0, 1
       FROM employee_tasks t
       WHERE ${expr.id} IS NOT NULL
         AND ${expr.dueDate} IS NOT NULL
         AND ${expr.dueDate} < NOW()
         AND ${expr.status} NOT IN ('completed', 'manager_approved', 'cancelled')
     )
     SELECT
       d.day::text AS day,
       e.employee_id,
       e.employee_name,
       COALESCE(SUM(events.assigned), 0)::int AS assigned,
       COALESCE(SUM(events.completed), 0)::int AS completed,
       COALESCE(SUM(events.overdue), 0)::int AS overdue
     FROM days d
     CROSS JOIN employees e
     LEFT JOIN events ON events.day = d.day AND events.employee_id = e.employee_id
     GROUP BY d.day, e.employee_id, e.employee_name
     ORDER BY d.day ASC, e.employee_name ASC`,
    values
  );

  return { points: rows };
}

async function getSlaRisk(user, filters = {}) {
  const scope = await baseScope(user, filters, 't', { applyDate: false });
  const expr = taskExprs(scope.taskCols, 't');
  const nowDue = scope.taskCols.has('due_date') ? expr.dueDate : 'NULL::timestamp';
  const assignedJoin = scope.taskCols.has('assigned_to') ? `LEFT JOIN users u ON u.id = ${expr.assignedTo}${scope.taskCols.has('org_id') ? ' AND u.org_id = t.org_id' : ''}` : '';
  const values = [...scope.values];
  values.push(CLOSED);
  const closedParam = values.length;

  const titleSelect = `${expr.title} AS title`;
  const riskScore = `LEAST(100,
    (CASE WHEN ${nowDue} < NOW() THEN 45 ELSE 0 END) +
    (CASE WHEN ${nowDue} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' THEN 25 ELSE 0 END) +
    (CASE WHEN ${expr.priority} IN ('urgent', 'critical') THEN 35 WHEN ${expr.priority} = 'high' THEN 20 ELSE 0 END) +
    (CASE WHEN ${expr.status} = 'pending' AND ${expr.createdAt} < NOW() - INTERVAL '3 days' THEN 20 ELSE 0 END) +
    (CASE WHEN ${expr.status} IN ('submitted', 'ai_reviewing') THEN 12 ELSE 0 END)
  )`;

  const { rows: summaryRows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ${expr.status} <> ALL($${closedParam}))::int AS open_tasks,
       COUNT(*) FILTER (WHERE ${nowDue} < NOW() AND ${expr.status} <> ALL($${closedParam}))::int AS overdue_tasks,
       COUNT(*) FILTER (WHERE ${nowDue} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' AND ${expr.status} <> ALL($${closedParam}))::int AS due_soon_72h,
       COUNT(*) FILTER (WHERE ${expr.priority} IN ('urgent', 'critical') AND ${expr.status} <> ALL($${closedParam}))::int AS critical_priority_open,
       COUNT(*) FILTER (WHERE ${expr.status} = 'pending' AND ${expr.createdAt} < NOW() - INTERVAL '3 days')::int AS stalled_pending,
       COUNT(*) FILTER (WHERE ${expr.status} IN ('submitted', 'ai_reviewing'))::int AS review_backlog
     FROM tasks t
     ${scope.where}`,
    values
  );

  const { rows: riskRows } = await query(
    `SELECT
       ${expr.id} AS task_id,
       ${titleSelect},
       ${expr.status} AS status,
       ${expr.priority} AS priority,
       ${expr.createdAt}::text AS created_at,
       ${expr.updatedAt}::text AS updated_at,
       ${expr.dueDate}::text AS due_date,
       ${scope.taskCols.has('assigned_to') ? 'COALESCE(u.full_name, \'Unassigned\')' : `'Unassigned'`} AS assigned_to_name,
       ${riskScore}::int AS risk_score,
       CASE
         WHEN ${nowDue} < NOW() THEN 'Overdue deadline'
         WHEN ${expr.priority} IN ('urgent', 'critical') THEN 'Urgent or critical priority'
         WHEN ${expr.status} = 'pending' AND ${expr.createdAt} < NOW() - INTERVAL '3 days' THEN 'Stalled pending task'
         WHEN ${expr.status} IN ('submitted', 'ai_reviewing') THEN 'Review backlog'
         WHEN ${nowDue} BETWEEN NOW() AND NOW() + INTERVAL '72 hours' THEN 'Due within 72 hours'
         ELSE 'Operational risk signal'
       END AS risk_reason
     FROM tasks t
     ${assignedJoin}
     ${scope.where}
     HAVING ${riskScore} > 0
     ORDER BY risk_score DESC, due_date ASC NULLS LAST, priority DESC
     LIMIT 25`,
    scope.values
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
    tasks: riskRows,
  };
}

module.exports = {
  getProjectSummary,
  getProjectTrend,
  getDepartmentPerformance,
  getEmployeeTrend,
  getSlaRisk,
};
