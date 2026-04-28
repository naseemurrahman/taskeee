const { query } = require('../utils/db');

const COMPLETED_STATUSES = ['completed', 'manager_approved'];

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

function col(columns, name, fallbackSql = 'NULL') {
  return columns.has(name) ? name : fallbackSql;
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

function buildOrgScope(user, filters = {}, columns, columnPrefix = 't') {
  const orgColumn = columns.has('org_id') ? `${columnPrefix}.org_id` : null;
  const createdAtColumn = columns.has('created_at') ? `${columnPrefix}.created_at` : null;
  const params = {
    values: [],
    clauses: [],
    from: filters.from,
    to: filters.to,
  };

  if (orgColumn && user?.org_id) {
    params.values.push(user.org_id);
    params.clauses.push(`${orgColumn} = $${params.values.length}`);
  }

  if (filters.employeeId && columns.has('assigned_to')) {
    params.clauses.push(`${columnPrefix}.assigned_to = $${params.values.length + 1}`);
    params.values.push(filters.employeeId);
  }

  if (filters.projectId && columns.has('project_id')) {
    params.clauses.push(`${columnPrefix}.project_id = $${params.values.length + 1}`);
    params.values.push(filters.projectId);
  }

  params.clauses.push(...buildDateClause(params, createdAtColumn));
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
  const scope = buildOrgScope(user, filters, columns);
  const statusCol = columns.has('status') ? 'status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 'due_date' : 'NULL::timestamp';
  const completedAtCol = columns.has('completed_at') ? 'completed_at' : 'NULL::timestamp';
  const createdAtCol = columns.has('created_at') ? 'created_at' : 'NULL::timestamp';
  const assignedToCol = columns.has('assigned_to') ? 'assigned_to' : 'NULL';
  const confidenceCol = columns.has('ai_confidence_score') ? 'ai_confidence_score' : 'NULL::numeric';

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
  const scope = buildOrgScope(user, filters, columns);
  const statusCol = columns.has('status') ? 'status' : `'unknown'`;
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
  const scope = buildOrgScope(user, filters, columns);
  if (columns.has('created_at')) {
    scope.clauses.push(`t.created_at >= NOW() - ($${scope.values.length + 1}::text || ' days')::interval`);
    scope.values.push(String(days));
  }
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : 'NULL::timestamp';
  const dayExpr = columns.has('created_at') ? `date_trunc('day', t.created_at)::date` : `CURRENT_DATE`;

  const { rows } = await query(
    `SELECT ${dayExpr} AS day,
            COUNT(*)::int AS created,
            COUNT(*) FILTER (WHERE ${statusCol} = ANY($${scope.values.length + 1}))::int AS completed,
            COUNT(*) FILTER (WHERE ${dueCol} < NOW() AND ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY 1 ASC`,
    [...scope.values, COMPLETED_STATUSES]
  );
  return { points: rows };
}

async function getEmployeePerformance(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = buildOrgScope(user, filters, columns);
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : 'NULL::timestamp';
  const join = userTaskJoin(columns);
  const where = user?.org_id ? 'WHERE u.org_id = $1' : '';
  const values = user?.org_id ? [user.org_id, COMPLETED_STATUSES] : [COMPLETED_STATUSES];
  const statusParam = values.length;

  const { rows } = await query(
    `SELECT u.id AS employee_id,
            u.full_name AS employee_name,
            COUNT(t.id)::int AS assigned,
            COUNT(t.id) FILTER (WHERE ${statusCol} = ANY($${statusParam}))::int AS completed,
            COUNT(t.id) FILTER (WHERE ${dueCol} < NOW() AND ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM users u
     LEFT JOIN tasks t ON ${join}
     ${where}
     GROUP BY u.id, u.full_name
     ORDER BY completed DESC, overdue ASC, assigned DESC
     LIMIT 100`,
    values
  );
  void scope;
  return { employees: rows };
}

async function getAiValidation(user, filters = {}) {
  const columns = await getTaskColumns();
  const scope = buildOrgScope(user, filters, columns);
  const validationCol = columns.has('ai_validation_status')
    ? 'ai_validation_status'
    : columns.has('manual_review_status')
      ? 'manual_review_status'
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
  const scope = buildOrgScope(user, filters, columns);
  const confidenceCol = columns.has('ai_confidence_score') ? 'ai_confidence_score' : 'NULL::numeric';
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
  const where = user?.org_id ? 'WHERE u.org_id = $1' : '';
  const values = user?.org_id ? [user.org_id] : [];
  void filters;

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
  const scope = buildOrgScope(user, filters, columns);
  if (columns.has('completed_at')) scope.clauses.push('t.completed_at IS NOT NULL');
  const categoryCol = columns.has('category') ? 't.category' : `'uncategorized'`;
  const completedAtCol = columns.has('completed_at') ? 't.completed_at' : 'NULL::timestamp';
  const createdAtCol = columns.has('created_at') ? 't.created_at' : 'NULL::timestamp';
  const { rows } = await query(
    `SELECT COALESCE(${categoryCol}, 'uncategorized') AS category,
            COALESCE(AVG(EXTRACT(EPOCH FROM (${completedAtCol} - ${createdAtCol})) / 3600), 0)::numeric(10,2) AS avg_hours,
            COUNT(*)::int AS completed_count
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY avg_hours DESC`,
    scope.values
  );
  return { categories: rows };
}

async function getOverdueTrend(user, filters = {}) {
  const columns = await getTaskColumns();
  const days = parsePositiveInt(filters.days, 30, 365);
  const scope = buildOrgScope(user, filters, columns);
  if (columns.has('due_date')) {
    scope.clauses.push(`t.due_date >= NOW() - ($${scope.values.length + 1}::text || ' days')::interval`);
    scope.values.push(String(days));
  }
  const statusCol = columns.has('status') ? 't.status' : `'unknown'`;
  const dueCol = columns.has('due_date') ? 't.due_date' : 'NULL::timestamp';
  const dayExpr = columns.has('due_date') ? `date_trunc('day', t.due_date)::date` : `CURRENT_DATE`;

  const { rows } = await query(
    `SELECT ${dayExpr} AS day,
            COUNT(*) FILTER (WHERE ${dueCol} < NOW() AND ${statusCol} NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY 1 ASC`,
    scope.values
  );
  return { points: rows };
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
};
