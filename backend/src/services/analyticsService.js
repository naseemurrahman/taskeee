const { query } = require('../utils/db');
const { filterNonTerminatedUserIds } = require('../utils/employeeVisibility');

const COMPLETED_STATUSES = ['completed', 'manager_approved'];
const ORG_WIDE_ANALYTICS_ROLES = new Set(['hr', 'director', 'admin']);

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function userOrgId(user) {
  return user?.org_id || user?.orgId || null;
}

function hasOrgWideAnalytics(user) {
  return ORG_WIDE_ANALYTICS_ROLES.has(normalizeRole(user?.role));
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function getTaskColumns() {
  const { rows } = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks'`
  );
  return new Set(rows.map((row) => row.column_name));
}

async function tableExists(tableName) {
  try {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [tableName]
    );
    return !!rows[0]?.exists;
  } catch {
    return false;
  }
}

async function getOwnTargetIds(user) {
  const ids = [user.id].filter(Boolean);
  const orgId = userOrgId(user);
  if (!orgId || !(await tableExists('employees'))) return filterNonTerminatedUserIds(orgId, ids, { requireActive: true });
  try {
    const { rows } = await query(
      `SELECT id
       FROM employees
       WHERE org_id = $1
         AND LOWER(COALESCE(status, 'active')) <> 'terminated'
         AND (
           user_id = $2
           OR (work_email IS NOT NULL AND LOWER(work_email) = LOWER($3))
         )`,
      [orgId, user.id, user.email || '']
    );
    for (const row of rows || []) {
      if (row?.id && !ids.includes(row.id)) ids.push(row.id);
    }
  } catch {
    // Legacy employee mapping is optional.
  }
  return filterNonTerminatedUserIds(orgId, ids, { requireActive: true });
}

async function analyticsTargetIds(user, filters = {}) {
  const orgId = userOrgId(user);
  const role = normalizeRole(user?.role);

  if (!orgId) return [user.id].filter(Boolean);

  if (hasOrgWideAnalytics(user)) {
    if (filters.employeeId) {
      return filterNonTerminatedUserIds(orgId, [filters.employeeId], { requireActive: true });
    }
    try {
      const ids = await filterNonTerminatedUserIds(orgId, null, { requireActive: true });
      return ids.length ? ids : [user.id];
    } catch {
      return [user.id].filter(Boolean);
    }
  }

  if (['employee', 'technician', 'supervisor', 'manager'].includes(role)) {
    return await getOwnTargetIds(user);
  }

  return filterNonTerminatedUserIds(orgId, [user.id], { requireActive: true });
}

function buildDateClause(params, column) {
  const clauses = [];
  if (!column) return clauses;
  if (params.from) {
    clauses.push(`${column} >= $${params.values.length + 1}`);
    params.values.push(params.from);
  }
  if (params.to) {
    clauses.push(`${column} <= $${params.values.length + 1}`);
    params.values.push(params.to);
  }
  return clauses;
}

async function buildOrgScope(user, filters = {}, columns, columnPrefix = 't', options = {}) {
  const orgColumn = columns.has('org_id') ? `${columnPrefix}.org_id` : null;
  const dateColumnName = options.dateColumn || 'created_at';
  const dateColumn = columns.has(dateColumnName) ? `${columnPrefix}.${dateColumnName}` : null;
  const params = {
    values: [],
    clauses: [],
    from: filters.from,
    to: filters.to,
  };

  const orgId = userOrgId(user);
  if (orgColumn && orgId) {
    params.values.push(orgId);
    params.clauses.push(`${orgColumn} = $${params.values.length}`);
  }

  if (columns.has('assigned_to')) {
    const targetIds = await analyticsTargetIds(user, filters);
    if (targetIds.length) {
      params.clauses.push(`${columnPrefix}.assigned_to = ANY($${params.values.length + 1})`);
      params.values.push(targetIds);
    } else {
      params.clauses.push('FALSE');
    }
  }

  if (filters.projectId && columns.has('project_id')) {
    params.clauses.push(`${columnPrefix}.project_id = $${params.values.length + 1}`);
    params.values.push(filters.projectId);
  }

  if (options.includeExplicitDateFilters !== false) {
    params.clauses.push(...buildDateClause(params, dateColumn));
  }
  return params;
}

function whereSql(params) {
  return params.clauses.length ? `WHERE ${params.clauses.join(' AND ')}` : '';
}

function userTaskJoin(columns) {
  const conditions = [];
  if (columns.has('assigned_to')) conditions.push('t.assigned_to = u.id');
  if (columns.has('org_id')) conditions.push('t.org_id = u.org_id');
  return conditions.length ? conditions.join(' AND ') : 'FALSE';
}

async function getSummary(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : 'NULL::timestamp';
  const completedAtCol = columns.has('completed_at') ? 't.completed_at' : 'NULL::timestamp';
  const createdAtCol = columns.has('created_at') ? 't.created_at' : 'NULL::timestamp';
  const assignedToCol = columns.has('assigned_to') ? 't.assigned_to' : 'NULL';
  const confidenceCol = columns.has('ai_confidence_score') ? 't.ai_confidence_score' : 'NULL::numeric';

  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total_tasks,
       COUNT(*) FILTER (WHERE ${statusCol} = ANY($${scope.values.length + 1}))::int AS completed_tasks,
       COUNT(*) FILTER (WHERE ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS pending_tasks,
       COUNT(*) FILTER (WHERE ${dueCol} < NOW() AND ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS overdue_tasks,
       COUNT(DISTINCT ${assignedToCol})::int AS active_employees,
       COALESCE(AVG(EXTRACT(EPOCH FROM (${completedAtCol} - ${createdAtCol})) / 3600) FILTER (WHERE ${completedAtCol} IS NOT NULL), 0)::numeric(10,2) AS avg_completion_hours,
       COALESCE(AVG(${confidenceCol}) FILTER (WHERE ${confidenceCol} IS NOT NULL), 0)::numeric(10,2) AS avg_ai_confidence
     FROM tasks t
     ${whereSql(scope)}`,
    [...scope.values, COMPLETED_STATUSES]
  );

  return rows[0] || {};
}

async function getTaskStatus(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const { rows } = await query(
    `SELECT COALESCE(${statusCol}, 'unknown') AS status, COUNT(*)::int AS count
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY COALESCE(${statusCol}, 'unknown')
     ORDER BY count DESC`,
    scope.values
  );
  return { statuses: rows };
}

async function getTasksOverTime(user, filters = {}) {
  const columns = await getTaskColumns();
  const days = parsePositiveInt(filters.days, 30, 365);
  const scope = await buildOrgScope(user, filters, columns, 't', { includeExplicitDateFilters: false });

  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const createdCol = columns.has('created_at') ? 't.created_at' : 'NOW()';
  const completedCol = columns.has('completed_at') ? 't.completed_at' : columns.has('updated_at') ? 't.updated_at' : createdCol;
  const overdueDateCol = columns.has('due_date') ? 't.due_date' : createdCol;
  const dayStart = filters.from ? `${filters.from}` : null;
  const dayEnd = filters.to ? `${filters.to}` : null;

  const values = [...scope.values, COMPLETED_STATUSES, String(days)];
  const completedStatusParam = scope.values.length + 1;
  const daysParam = scope.values.length + 2;
  let dateWindowSql = `d.day >= CURRENT_DATE - (($${daysParam}::int - 1) * INTERVAL '1 day') AND d.day <= CURRENT_DATE`;
  if (dayStart) {
    values.push(dayStart);
    dateWindowSql = `d.day >= $${values.length}::date`;
    if (dayEnd) {
      values.push(dayEnd);
      dateWindowSql += ` AND d.day <= $${values.length}::date`;
    } else {
      dateWindowSql += ` AND d.day <= CURRENT_DATE`;
    }
  } else if (dayEnd) {
    values.push(dayEnd);
    dateWindowSql = `d.day >= ($${values.length}::date - (($${daysParam}::int - 1) * INTERVAL '1 day'))::date AND d.day <= $${values.length}::date`;
  }

  const taskWhere = whereSql(scope);
  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series(
         CASE
           WHEN $${daysParam}::int > 0 THEN CURRENT_DATE - (($${daysParam}::int - 1) * INTERVAL '1 day')
           ELSE CURRENT_DATE
         END,
         CURRENT_DATE,
         INTERVAL '1 day'
       )::date AS day
     ), scoped_tasks AS (
       SELECT t.* FROM tasks t ${taskWhere}
     ), created AS (
       SELECT date_trunc('day', ${createdCol})::date AS day, COUNT(*)::int AS created
       FROM scoped_tasks t
       WHERE ${createdCol} IS NOT NULL
       GROUP BY 1
     ), completed AS (
       SELECT date_trunc('day', ${completedCol})::date AS day, COUNT(*)::int AS completed
       FROM scoped_tasks t
       WHERE ${statusCol} = ANY($${completedStatusParam}) AND ${completedCol} IS NOT NULL
       GROUP BY 1
     ), overdue AS (
       SELECT date_trunc('day', ${overdueDateCol})::date AS day, COUNT(*)::int AS overdue
       FROM scoped_tasks t
       WHERE ${overdueDateCol} IS NOT NULL
         AND ${overdueDateCol} < NOW()
         AND ${statusCol} NOT IN ('completed', 'manager_approved')
       GROUP BY 1
     )
     SELECT
       d.day::text AS day,
       COALESCE(c.created, 0)::int AS created,
       COALESCE(cm.completed, 0)::int AS completed,
       COALESCE(o.overdue, 0)::int AS overdue
     FROM days d
     LEFT JOIN created c ON c.day = d.day
     LEFT JOIN completed cm ON cm.day = d.day
     LEFT JOIN overdue o ON o.day = d.day
     WHERE ${dateWindowSql}
     ORDER BY d.day ASC`,
    values
  );
  return { points: rows };
}

async function getEmployeePerformance(user, filters = {}) {
  const columns = await getTaskColumns();
  const days = parsePositiveInt(filters.days, 30, 365);
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : 'NULL::timestamp';
  const createdCol = columns.has('created_at') ? 't.created_at' : 'NOW()';
  const join = userTaskJoin(columns);
  const orgId = userOrgId(user);
  const values = [];
  const whereParts = [];
  if (orgId) {
    values.push(orgId);
    whereParts.push(`u.org_id = $${values.length}`);
  }

  const ids = await analyticsTargetIds(user, filters);
  if (ids.length) {
    values.push(ids);
    whereParts.push(`u.id = ANY($${values.length})`);
  } else {
    whereParts.push('FALSE');
  }

  values.push(COMPLETED_STATUSES);
  const statusParam = values.length;
  values.push(String(days));
  const daysParam = values.length;
  const dateClause = columns.has('created_at') ? `AND ${createdCol} >= NOW() - ($${daysParam}::text || ' days')::interval` : '';
  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT u.id AS employee_id,
            u.full_name AS employee_name,
            COUNT(t.id)::int AS assigned,
            COUNT(t.id) FILTER (WHERE ${statusCol} = ANY($${statusParam}))::int AS completed,
            COUNT(t.id) FILTER (WHERE ${dueCol} < NOW() AND ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM users u
     LEFT JOIN tasks t ON ${join} ${dateClause}
     ${where}
     GROUP BY u.id, u.full_name
     ORDER BY completed DESC, overdue ASC, assigned DESC
     LIMIT 100`,
    values
  );
  return { employees: rows };
}

async function getAiValidation(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const validationCol = columns.has('ai_validation_status')
    ? 't.ai_validation_status'
    : columns.has('manual_review_status')
      ? 't.manual_review_status'
      : `'unknown'`;
  const { rows } = await query(
    `SELECT COALESCE(${validationCol}, 'unknown') AS status,
            COUNT(*)::int AS count
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY count DESC`,
    scope.values
  );
  return { statuses: rows };
}

async function getAiConfidence(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const confidenceCol = columns.has('ai_confidence_score') ? 't.ai_confidence_score' : 'NULL::numeric';
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ${confidenceCol} < 0.4)::int AS low,
       COUNT(*) FILTER (WHERE ${confidenceCol} >= 0.4 AND ${confidenceCol} < 0.75)::int AS medium,
       COUNT(*) FILTER (WHERE ${confidenceCol} >= 0.75)::int AS high,
       COALESCE(AVG(${confidenceCol}), 0)::numeric(10,2) AS average
     FROM tasks t
     ${whereSql(scope)}`,
    scope.values
  );
  return rows[0] || { low: 0, medium: 0, high: 0, average: 0 };
}

async function getWorkload(user, filters = {}) {
  const columns = await getTaskColumns();
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const join = userTaskJoin(columns);
  const orgId = userOrgId(user);
  const values = [];
  const whereParts = [];
  if (orgId) {
    values.push(orgId);
    whereParts.push(`u.org_id = $${values.length}`);
  }

  const ids = await analyticsTargetIds(user, filters);
  if (ids.length) {
    values.push(ids);
    whereParts.push(`u.id = ANY($${values.length})`);
  } else {
    whereParts.push('FALSE');
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT u.id AS employee_id,
            u.full_name AS employee_name,
            COUNT(t.id) FILTER (WHERE ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS open_tasks,
            COUNT(t.id)::int AS total_tasks
     FROM users u
     LEFT JOIN tasks t ON ${join}
     ${where}
     GROUP BY u.id, u.full_name
     ORDER BY open_tasks DESC, total_tasks DESC
     LIMIT 100`,
    values
  );
  return { employees: rows };
}

async function getCompletionTime(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const completedAtCol = columns.has('completed_at') ? 't.completed_at' : 'NULL::timestamp';
  const createdAtCol = columns.has('created_at') ? 't.created_at' : 'NULL::timestamp';
  const categoryExpr = columns.has('category')
    ? 't.category'
    : columns.has('category_name')
      ? 't.category_name'
      : columns.has('category_id')
        ? 'COALESCE(c.name, \'uncategorized\')'
        : `'uncategorized'`;
  const joinCategory = columns.has('category_id') ? 'LEFT JOIN task_categories c ON c.id = t.category_id AND c.org_id = t.org_id' : '';
  if (columns.has('completed_at')) scope.clauses.push('t.completed_at IS NOT NULL');
  const { rows } = await query(
    `SELECT COALESCE(${categoryExpr}, 'uncategorized') AS category,
            COALESCE(AVG(EXTRACT(EPOCH FROM (${completedAtCol} - ${createdAtCol})) / 3600), 0)::numeric(10,2) AS avg_hours,
            COUNT(*)::int AS completed_count
     FROM tasks t
     ${joinCategory}
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY completed_count DESC, avg_hours DESC`,
    scope.values
  );
  return { categories: rows };
}

async function getOverdueTrend(user, filters = {}) {
  const columns = await getTaskColumns();
  const days = parsePositiveInt(filters.days, 30, 365);
  const scope = await buildOrgScope(user, filters, columns, 't', { includeExplicitDateFilters: false });
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : null;
  const values = [...scope.values, String(days)];
  const daysParam = scope.values.length + 1;

  if (!dueCol) {
    const { rows } = await query(
      `SELECT generate_series(CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'), CURRENT_DATE, INTERVAL '1 day')::date::text AS day,
              0::int AS overdue`,
      [String(days)]
    );
    return { points: rows };
  }

  const { rows } = await query(
    `WITH days AS (
       SELECT generate_series(CURRENT_DATE - (($${daysParam}::int - 1) * INTERVAL '1 day'), CURRENT_DATE, INTERVAL '1 day')::date AS day
     ), scoped_tasks AS (
       SELECT t.* FROM tasks t ${whereSql(scope)}
     ), overdue AS (
       SELECT date_trunc('day', ${dueCol})::date AS day, COUNT(*)::int AS overdue
       FROM scoped_tasks t
       WHERE ${dueCol} IS NOT NULL
         AND ${dueCol} < NOW()
         AND ${statusCol} NOT IN ('completed', 'manager_approved')
       GROUP BY 1
     )
     SELECT d.day::text AS day, COALESCE(o.overdue, 0)::int AS overdue
     FROM days d
     LEFT JOIN overdue o ON o.day = d.day
     ORDER BY d.day ASC`,
    values
  );
  return { points: rows };
}

async function getPriorityBreakdown(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = await buildOrgScope(user, filters, columns);
  const priorityCol = columns.has('priority') ? 'LOWER(COALESCE(t.priority, \'unspecified\'))' : `'unspecified'`;
  const { rows } = await query(
    `SELECT ${priorityCol} AS priority, COUNT(*)::int AS count
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY count DESC`,
    scope.values
  );
  return { priorities: rows };
}

module.exports = {
  getSummary,
  getTaskStatus,
  getTasksOverTime,
  getEmployeePerformance,
  getAiValidation,
  getAiConfidence,
  getWorkload,
  getCompletionTime,
  getOverdueTrend,
  getPriorityBreakdown,
};
