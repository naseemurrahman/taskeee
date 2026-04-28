const { query } = require('../utils/db');

const COMPLETED_STATUSES = ['completed', 'manager_approved'];

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function buildDateClause(params, column = 'created_at') {
  const clauses = [];
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

function buildOrgScope(user, filters = {}, columnPrefix = 't') {
  const params = {
    values: [user.org_id],
    clauses: [`${columnPrefix}.org_id = $1`],
    from: filters.from,
    to: filters.to,
  };

  if (filters.employeeId) {
    params.clauses.push(`${columnPrefix}.assigned_to = $${params.values.length + 1}`);
    params.values.push(filters.employeeId);
  }

  if (filters.projectId) {
    params.clauses.push(`${columnPrefix}.project_id = $${params.values.length + 1}`);
    params.values.push(filters.projectId);
  }

  params.clauses.push(...buildDateClause(params, `${columnPrefix}.created_at`));
  return params;
}

function whereSql(params) {
  return params.clauses.length ? `WHERE ${params.clauses.join(' AND ')}` : '';
}

async function getSummary(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total_tasks,
       COUNT(*) FILTER (WHERE status = ANY($${scope.values.length + 1}))::int AS completed_tasks,
       COUNT(*) FILTER (WHERE status NOT IN ('completed', 'manager_approved'))::int AS pending_tasks,
       COUNT(*) FILTER (WHERE due_date < NOW() AND status NOT IN ('completed', 'manager_approved'))::int AS overdue_tasks,
       COUNT(DISTINCT assigned_to)::int AS active_employees,
       COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 3600) FILTER (WHERE completed_at IS NOT NULL), 0)::numeric(10,2) AS avg_completion_hours,
       COALESCE(AVG(ai_confidence_score) FILTER (WHERE ai_confidence_score IS NOT NULL), 0)::numeric(10,2) AS avg_ai_confidence
     FROM tasks t
     ${whereSql(scope)}`,
    [...scope.values, COMPLETED_STATUSES]
  );

  return rows[0] || {};
}

async function getTaskStatus(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY COALESCE(status, 'unknown')
     ORDER BY count DESC`,
    scope.values
  );
  return { statuses: rows };
}

async function getTasksOverTime(user, filters = {}) {
  const days = parsePositiveInt(filters.days, 30, 365);
  const scope = buildOrgScope(user, filters);
  scope.clauses.push(`t.created_at >= NOW() - ($${scope.values.length + 1}::text || ' days')::interval`);
  scope.values.push(String(days));

  const { rows } = await query(
    `SELECT date_trunc('day', t.created_at)::date AS day,
            COUNT(*)::int AS created,
            COUNT(*) FILTER (WHERE t.status = ANY($${scope.values.length + 1}))::int AS completed,
            COUNT(*) FILTER (WHERE t.due_date < NOW() AND t.status NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM tasks t
     ${whereSql(scope)}
     GROUP BY 1
     ORDER BY 1 ASC`,
    [...scope.values, COMPLETED_STATUSES]
  );
  return { points: rows };
}

async function getEmployeePerformance(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT u.id AS employee_id,
            u.full_name AS employee_name,
            COUNT(t.id)::int AS assigned,
            COUNT(t.id) FILTER (WHERE t.status = ANY($${scope.values.length + 1}))::int AS completed,
            COUNT(t.id) FILTER (WHERE t.due_date < NOW() AND t.status NOT IN ('completed', 'manager_approved'))::int AS overdue
     FROM users u
     LEFT JOIN tasks t ON t.assigned_to = u.id AND t.org_id = u.org_id
     ${whereSql(scope).replace(/WHERE t\.org_id = \$1/, 'WHERE u.org_id = $1')}
     GROUP BY u.id, u.full_name
     ORDER BY completed DESC, overdue ASC, assigned DESC
     LIMIT 100`,
    [...scope.values, COMPLETED_STATUSES]
  );
  return { employees: rows };
}

async function getAiValidation(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT COALESCE(ai_validation_status, manual_review_status, 'unknown') AS status,
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
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE ai_confidence_score < 0.4)::int AS low,
       COUNT(*) FILTER (WHERE ai_confidence_score >= 0.4 AND ai_confidence_score < 0.75)::int AS medium,
       COUNT(*) FILTER (WHERE ai_confidence_score >= 0.75)::int AS high,
       COALESCE(AVG(ai_confidence_score), 0)::numeric(10,2) AS average
     FROM tasks t
     ${whereSql(scope)}`,
    scope.values
  );
  return rows[0] || { low: 0, medium: 0, high: 0, average: 0 };
}

async function getWorkload(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  const { rows } = await query(
    `SELECT u.id AS employee_id,
            u.full_name AS employee_name,
            COUNT(t.id) FILTER (WHERE t.status NOT IN ('completed', 'manager_approved'))::int AS open_tasks,
            COUNT(t.id)::int AS total_tasks
     FROM users u
     LEFT JOIN tasks t ON t.assigned_to = u.id AND t.org_id = u.org_id
     ${whereSql(scope).replace(/WHERE t\.org_id = \$1/, 'WHERE u.org_id = $1')}
     GROUP BY u.id, u.full_name
     ORDER BY open_tasks DESC, total_tasks DESC
     LIMIT 100`,
    scope.values
  );
  return { employees: rows };
}

async function getCompletionTime(user, filters = {}) {
  const scope = buildOrgScope(user, filters);
  scope.clauses.push('t.completed_at IS NOT NULL');
  const { rows } = await query(
    `SELECT COALESCE(t.category, 'uncategorized') AS category,
            COALESCE(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600), 0)::numeric(10,2) AS avg_hours,
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
  const days = parsePositiveInt(filters.days, 30, 365);
  const scope = buildOrgScope(user, filters);
  scope.clauses.push(`t.due_date >= NOW() - ($${scope.values.length + 1}::text || ' days')::interval`);
  scope.values.push(String(days));

  const { rows } = await query(
    `SELECT date_trunc('day', t.due_date)::date AS day,
            COUNT(*) FILTER (WHERE t.due_date < NOW() AND t.status NOT IN ('completed', 'manager_approved'))::int AS overdue
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
