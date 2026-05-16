'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');

const projects = express.Router();
const tasks = express.Router();
const hris = express.Router();

let tablesCache = null;
const columnsCache = new Map();

async function getTableNames() {
  if (tablesCache) return tablesCache;
  const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  tablesCache = new Set(rows.map((r) => String(r.table_name)));
  return tablesCache;
}

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const cols = new Set(rows.map((r) => String(r.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId != null && orgId !== '' ? String(orgId) : null;
}

function normalizedRole(req) {
  return String(req.user?.role || '').toLowerCase();
}

function isPersonalRole(role) {
  return ['employee', 'technician'].includes(String(role || '').toLowerCase());
}

async function resolveProjectStore() {
  const tables = await getTableNames();
  if (tables.has('task_categories')) return 'task_categories';
  if (tables.has('projects')) return 'projects';
  return null;
}

function projectStatusExpression(alias, cols) {
  if (cols.has('status') && cols.has('is_active')) {
    return `COALESCE(${alias}.status, CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END, 'active')`;
  }
  if (cols.has('status')) return `COALESCE(${alias}.status, 'active')`;
  if (cols.has('is_active')) return `CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END`;
  return `'active'`;
}

function projectIsActiveExpression(alias, cols) {
  if (cols.has('status')) return `${projectStatusExpression(alias, cols)} = 'active'`;
  if (cols.has('is_active')) return `${alias}.is_active = TRUE`;
  return 'TRUE';
}

function taskCompletionProgressSql() {
  return `COALESCE(ROUND(100.0 * COUNT(DISTINCT CASE WHEN COALESCE(t.status,'pending') IN ('completed','manager_approved') THEN t.id END) / NULLIF(COUNT(DISTINCT t.id), 0)), 0)::int AS progress`;
}

function activeTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled','on_hold')`;
}

function nonTerminalTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

function addTaskUpdateMetadata({ taskCols, setParts, params, metadata, alias = '' }) {
  if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
  if (taskCols.has('metadata')) {
    params.push(JSON.stringify(metadata));
    const prefix = alias ? `${alias}.` : '';
    setParts.push(`metadata = COALESCE(${prefix}metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`);
  }
}

async function projectTaskRelationParts(taskCols, projectParam = '$2', taskAlias = 't') {
  const tables = await getTableNames();
  const parts = [];
  if (taskCols.has('category_id')) parts.push(`${taskAlias}.category_id = ${projectParam}`);
  if (taskCols.has('project_id')) parts.push(`${taskAlias}.project_id = ${projectParam}`);
  if (tables.has('project_tasks')) parts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = ${taskAlias}.id AND pt.project_id = ${projectParam})`);
  return parts;
}

async function countActiveProjectTasks(orgId, projectId) {
  const taskCols = await getColumns('tasks');
  const relationParts = await projectTaskRelationParts(taskCols, '$2', 't');
  if (!relationParts.length) return 0;
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`, activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await query(
    `SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`,
    [orgId, projectId]
  );
  return parseInt(rows[0]?.cnt || 0, 10);
}

async function listActiveProjectTasks(orgId, projectId) {
  const taskCols = await getColumns('tasks');
  const relationParts = await projectTaskRelationParts(taskCols, '$2', 't');
  if (!relationParts.length) return [];
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`, activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const assigneeJoin = taskCols.has('assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : '';
  const assigneeName = taskCols.has('assigned_to') ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name` : `'Unassigned' AS assignee_name`;
  const { rows } = await query(
    `SELECT t.id, t.title, COALESCE(t.status,'pending') AS status,
            ${taskCols.has('priority') ? 't.priority' : 'NULL::text AS priority'},
            ${taskCols.has('due_date') ? 't.due_date' : 'NULL::timestamptz AS due_date'},
            ${assigneeName}
       FROM tasks t
       ${assigneeJoin}
      WHERE ${conditions.join(' AND ')}
      ORDER BY t.created_at DESC
      LIMIT 100`,
    [orgId, projectId]
  );
  return rows;
}

async function mutateProjectTasksForStatus({ orgId, projectId, status, actorUserId }) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status')) return;
  const relationParts = await projectTaskRelationParts(taskCols, '$2', 't');
  if (!relationParts.length) return;

  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');

  if (status === 'paused') {
    const params = [orgId, projectId, 'on_hold'];
    const setParts = ['status = $3'];
    addTaskUpdateMetadata({ taskCols, setParts, params, alias: 't', metadata: { hold_reason: 'project_paused', hold_project_id: projectId, held_by: actorUserId, held_at: new Date().toISOString() } });
    await query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
    return;
  }

  if (status === 'active') {
    const activeAssigneeGuard = taskCols.has('assigned_to')
      ? `(t.assigned_to IS NULL OR EXISTS (SELECT 1 FROM users au WHERE au.id = t.assigned_to AND au.org_id = $1 AND COALESCE(au.is_active, TRUE) = TRUE))`
      : 'TRUE';
    const params = [orgId, projectId, 'pending'];
    const setParts = ['status = $3'];
    addTaskUpdateMetadata({ taskCols, setParts, params, alias: 't', metadata: { hold_reason: null, resumed_project_id: projectId, resumed_by: actorUserId, resumed_at: new Date().toISOString() } });
    await query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(`COALESCE(t.status,'pending') = 'on_hold'`, activeAssigneeGuard).join(' AND ')}`, params);
    return;
  }

  if (status === 'completed') {
    const params = [orgId, projectId, 'cancelled'];
    const setParts = ['status = $3'];
    addTaskUpdateMetadata({ taskCols, setParts, params, alias: 't', metadata: { cancelled_reason: 'project_completed', cancelled_project_id: projectId, cancelled_by: actorUserId, cancelled_at: new Date().toISOString() } });
    await query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }
}

async function getProjectStatusById(orgId, projectId) {
  const store = await resolveProjectStore();
  if (!store) return null;
  if (store === 'task_categories') {
    const cols = await getColumns('task_categories');
    const statusExpr = projectStatusExpression('tc', cols);
    const { rows } = await query(`SELECT tc.id, tc.name, ${statusExpr} AS status FROM task_categories tc WHERE tc.org_id = $1 AND tc.id = $2 LIMIT 1`, [orgId, projectId]);
    return rows[0] || null;
  }
  const cols = await getColumns('projects');
  const statusExpr = projectStatusExpression('p', cols);
  const { rows } = await query(`SELECT p.id, p.name, ${statusExpr} AS status FROM projects p WHERE p.org_id = $1 AND p.id = $2 LIMIT 1`, [orgId, projectId]);
  return rows[0] || null;
}

async function getTaskProjectStatus(task, orgId) {
  if (!task.project_id) return null;
  const cols = await getColumns('projects').catch(() => new Set());
  if (!cols.size) return null;
  const statusExpr = projectStatusExpression('p', cols);
  const { rows } = await query(`SELECT p.id, p.name, ${statusExpr} AS status FROM projects p WHERE p.org_id = $1 AND p.id = $2 LIMIT 1`, [orgId, task.project_id]);
  return rows[0] || null;
}

async function assertAssignableUser({ orgId, userId }) {
  if (!userId) return null;
  const { rows } = await query(
    `SELECT u.id,
            COALESCE(u.is_active, TRUE) AS user_active,
            NOT EXISTS (
              SELECT 1 FROM employees e
               WHERE e.user_id = u.id
                 AND e.org_id = $2
                 AND COALESCE(e.status, 'active') <> 'active'
            ) AS employee_active
       FROM users u
      WHERE u.id = $1 AND u.org_id = $2
      LIMIT 1`,
    [userId, orgId]
  );
  if (!rows.length) return { ok: false, status: 400, error: 'Referenced resource not found: user not found.' };
  if (!rows[0].user_active || !rows[0].employee_active) {
    return { ok: false, status: 409, error: 'This employee is inactive or terminated and cannot receive new task assignments.' };
  }
  return { ok: true };
}

async function assertProjectAcceptsNewTasks({ orgId, projectId }) {
  if (!projectId) return { ok: true };
  const project = await getProjectStatusById(orgId, projectId);
  if (!project) return { ok: true };
  if (project.status !== 'active') return { ok: false, status: 409, error: `Cannot assign tasks to ${project.status} project "${project.name || project.id}". Reactivate the project first.` };
  return { ok: true };
}

function sendGuard(res, result) {
  if (result?.ok === false) return res.status(result.status || 400).json({ error: result.error });
  return null;
}

projects.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const role = normalizedRole(req);
    const personalOnly = isPersonalRole(role);
    if (!orgId) return res.json({ projects: [], meta: { role, scope: 'none' } });

    const store = await resolveProjectStore();
    if (!store) return res.json({ projects: [], meta: { role, store: null } });

    if (store === 'task_categories') {
      const cols = await getColumns('task_categories');
      const statusExpr = projectStatusExpression('tc', cols);
      const isActiveExpr = projectIsActiveExpression('tc', cols);
      const params = [orgId];
      const where = ['tc.org_id = $1'];
      let scopedJoin = '';
      if (personalOnly) {
        params.push(req.user.id);
        scopedJoin = `AND t.assigned_to = $${params.length}`;
        where.push(`EXISTS (SELECT 1 FROM tasks myt WHERE myt.category_id = tc.id AND myt.org_id = tc.org_id AND myt.assigned_to = $${params.length} AND myt.deleted_at IS NULL)`);
      }
      const { rows } = await query(
        `SELECT tc.id, tc.name, tc.description,
                ${cols.has('icon') ? 'tc.icon' : 'NULL::text AS icon'},
                ${cols.has('color') ? 'tc.color' : 'NULL::text AS color'},
                ${statusExpr} AS status,
                ${isActiveExpr} AS is_active,
                tc.created_at,
                COUNT(DISTINCT t.id)::int AS task_count,
                ${taskCompletionProgressSql()}
           FROM task_categories tc
           LEFT JOIN tasks t ON t.category_id = tc.id AND t.deleted_at IS NULL ${scopedJoin}
          WHERE ${where.join(' AND ')}
          GROUP BY tc.id
          ORDER BY tc.created_at DESC`,
        params
      );
      return res.json({ projects: rows, meta: { role, store, personalOnly } });
    }

    const cols = await getColumns('projects');
    const statusExpr = projectStatusExpression('p', cols);
    const params = [orgId];
    const where = ['p.org_id = $1'];
    if (cols.has('status')) where.push(`COALESCE(p.status, 'active') <> 'archived'`);
    let scopedJoin = '';
    if (personalOnly) {
      params.push(req.user.id);
      scopedJoin = `AND t.assigned_to = $${params.length}`;
      where.push(`EXISTS (SELECT 1 FROM tasks myt WHERE myt.project_id = p.id AND myt.org_id = p.org_id AND myt.assigned_to = $${params.length} AND myt.deleted_at IS NULL)`);
    }
    const { rows } = await query(
      `SELECT p.id, p.name, p.description, NULL::text AS icon, NULL::text AS color,
              ${statusExpr} AS status,
              (${statusExpr} = 'active') AS is_active,
              p.created_at,
              COUNT(DISTINCT t.id)::int AS task_count,
              ${taskCompletionProgressSql()}
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL ${scopedJoin}
        WHERE ${where.join(' AND ')}
        GROUP BY p.id
        ORDER BY p.created_at DESC`,
      params
    );
    return res.json({ projects: rows, meta: { role, store, personalOnly } });
  } catch (err) { next(err); }
});

projects.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });
    const rows = await listActiveProjectTasks(orgId, String(req.params.projectId || '').trim());
    return res.json({ tasks: rows });
  } catch (err) { next(err); }
});

projects.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });
    const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
    if (!requestedStatus) return next();
    if (!['active', 'paused', 'completed'].includes(requestedStatus)) return res.status(400).json({ error: 'Invalid status' });

    const projectId = String(req.params.projectId || '').trim();
    const activeCount = await countActiveProjectTasks(orgId, projectId);
    if (requestedStatus === 'completed' && activeCount > 0 && req.body.override_completion !== true) {
      return res.status(409).json({ error: `Cannot complete project: ${activeCount} active task(s) still require resolution.`, code: 'PROJECT_HAS_ACTIVE_TASKS', activeTaskCount: activeCount });
    }
    if (requestedStatus === 'completed' && activeCount > 0) {
      if (!['admin', 'director'].includes(normalizedRole(req))) return res.status(403).json({ error: 'Only Admin or Director can override completion with active tasks.' });
      const reason = String(req.body.override_reason || req.body.reason || '').trim();
      if (reason.length < 8) return res.status(400).json({ error: 'override_reason is required and must be at least 8 characters.' });
    }

    const store = await resolveProjectStore();
    if (!store) return res.status(404).json({ error: 'Project not found' });
    let rows;
    if (store === 'task_categories') {
      const cols = await getColumns('task_categories');
      if (!cols.has('status')) {
        await query(`ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);
        columnsCache.delete('task_categories');
      }
      const nextCols = await getColumns('task_categories');
      const sets = ['status = $1'];
      const params = [requestedStatus];
      if (nextCols.has('is_active')) {
        params.push(requestedStatus === 'active');
        sets.push(`is_active = $${params.length}`);
      }
      params.push(orgId, projectId);
      ({ rows } = await query(
        `UPDATE task_categories SET ${sets.join(', ')} WHERE org_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, description,
                   ${nextCols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                   ${nextCols.has('color') ? 'color' : 'NULL::text AS color'},
                   ${nextCols.has('status') ? 'status' : `'${requestedStatus}'`} AS status,
                   ${nextCols.has('is_active') ? 'is_active' : `(status = 'active')`} AS is_active,
                   created_at`,
        params
      ));
    } else {
      const cols = await getColumns('projects');
      if (!cols.has('status')) return res.status(500).json({ error: 'projects.status column is required for status changes.' });
      ({ rows } = await query(
        `UPDATE projects SET status = $1 WHERE org_id = $2 AND id = $3
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at`,
        [requestedStatus, orgId, projectId]
      ));
    }

    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    await mutateProjectTasksForStatus({ orgId, projectId, status: requestedStatus, actorUserId: req.user.id });
    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId, projectName: rows[0]?.name, newStatus: requestedStatus, activeTaskCount: activeCount } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: projectId, metadata: { newStatus: requestedStatus, projectName: rows[0]?.name, activeTaskCount: activeCount }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }
    return res.json({ project: rows[0], affectedActiveTasks: activeCount });
  } catch (err) { next(err); }
});

tasks.get('/assignable-users', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { department } = req.query;
    const params = [orgId];
    let p = 2;
    const conditions = ['u.org_id = $1', 'COALESCE(u.is_active, TRUE) = TRUE', `NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.org_id = $1 AND COALESCE(e.status, 'active') <> 'active')`];
    if (department && department !== 'all') {
      conditions.push(`u.department = $${p++}`);
      params.push(department);
    }
    if (!isOrgWideRole(req.user.role)) {
      try {
        const { rows: subs } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
        const ids = [req.user.id, ...subs.map((r) => r.user_id)];
        conditions.push(`u.id = ANY($${p++})`);
        params.push(ids);
      } catch { /* legacy DB: keep org scope */ }
    }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department, u.employee_code FROM users u WHERE ${conditions.join(' AND ')} ORDER BY u.full_name ASC NULLS LAST, u.email ASC`,
      params
    );
    return res.json({ users: rows.map((u) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: u.role, department: u.department, employeeCode: u.employee_code })) });
  } catch (err) { next(err); }
});

tasks.get('/reassignment-needed', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `SELECT t.*, u.full_name AS assigned_to_name, u.email AS assigned_to_email, cat.name AS category_name, cat.color AS category_color
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN task_categories cat ON cat.id = t.category_id
        WHERE t.org_id = $1
          AND t.deleted_at IS NULL
          AND ${nonTerminalTaskCondition('t')}
          AND (COALESCE(t.status, 'pending') = 'on_hold' OR COALESCE(u.is_active, FALSE) = FALSE OR EXISTS (SELECT 1 FROM employees e WHERE e.user_id = t.assigned_to AND e.org_id = $1 AND COALESCE(e.status, 'active') <> 'active'))
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT 200`,
      [orgId]
    );
    return res.json({ tasks: rows });
  } catch (err) { next(err); }
});

async function preflightTaskCreate(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const assignedTo = req.body?.assignedTo || req.body?.assigned_to || null;
    const projectId = req.body?.projectId || req.body?.project_id || null;
    const assignable = await assertAssignableUser({ orgId, userId: assignedTo });
    if (sendGuard(res, assignable)) return;
    const projectAllowed = await assertProjectAcceptsNewTasks({ orgId, projectId });
    if (sendGuard(res, projectAllowed)) return;
    return next();
  } catch (err) { next(err); }
}

tasks.post('/', authenticate, preflightTaskCreate);
tasks.post('/create-simple', authenticate, preflightTaskCreate);

async function preflightTaskAssignment(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'assignedTo') || Object.prototype.hasOwnProperty.call(body, 'assigned_to')) {
      const assignable = await assertAssignableUser({ orgId, userId: body.assignedTo || body.assigned_to || null });
      if (sendGuard(res, assignable)) return;
    }
    const projectId = body.projectId || body.project_id || null;
    if (projectId) {
      const projectAllowed = await assertProjectAcceptsNewTasks({ orgId, projectId });
      if (sendGuard(res, projectAllowed)) return;
    }
    return next();
  } catch (err) { next(err); }
}

tasks.patch('/:id/details', authenticate, preflightTaskAssignment);
tasks.patch('/:id', authenticate, preflightTaskAssignment);

async function preflightTaskStatusChange(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const targetStatus = String(req.body?.status || '').trim().toLowerCase();
    const { rows } = await query(`SELECT id, org_id, status, assigned_to, project_id FROM tasks WHERE id = $1 AND org_id = $2 LIMIT 1`, [req.params.id, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    const project = await getTaskProjectStatus(task, orgId);
    if (project && project.status !== 'active') {
      const allowedPausedMoves = new Set(['on_hold', 'cancelled']);
      if (project.status === 'paused' && allowedPausedMoves.has(targetStatus)) return next();
      return res.status(409).json({ error: `Task status cannot be changed while project "${project.name || project.id}" is ${project.status}. Reactivate the project first.`, code: 'PROJECT_NOT_ACTIVE', projectId: project.id, projectStatus: project.status });
    }
    if (['pending', 'in_progress', 'submitted', 'completed', 'manager_approved'].includes(targetStatus)) {
      const assignable = await assertAssignableUser({ orgId, userId: task.assigned_to });
      if (sendGuard(res, assignable)) return;
    }
    return next();
  } catch (err) { next(err); }
}

tasks.patch('/:id/status', authenticate, preflightTaskStatusChange);
tasks.patch('/:id/board-status', authenticate, preflightTaskStatusChange);
tasks.post('/:id/set-status', authenticate, preflightTaskStatusChange);

async function quarantineEmployeeTasks({ orgId, employeeUserId, actorUserId, reason }) {
  if (!employeeUserId) return;
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('assigned_to')) return;
  const params = [orgId, employeeUserId];
  const setParts = [`status = 'on_hold'`];
  addTaskUpdateMetadata({ taskCols, setParts, params, metadata: { reassignment_required: true, reassignment_reason: reason, held_by: actorUserId, held_at: new Date().toISOString() } });
  const conditions = [`org_id = $1`, `assigned_to = $2`, nonTerminalTaskCondition('tasks')];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await query(`UPDATE tasks SET ${setParts.join(', ')} WHERE ${conditions.join(' AND ')}`, params);
}

async function restoreEmployeeTasks({ orgId, employeeUserId, actorUserId }) {
  if (!employeeUserId) return;
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('assigned_to')) return;
  const params = [orgId, employeeUserId];
  const setParts = [`status = 'pending'`];
  addTaskUpdateMetadata({ taskCols, setParts, params, metadata: { reassignment_required: false, restored_by: actorUserId, restored_at: new Date().toISOString() } });
  const conditions = [`org_id = $1`, `assigned_to = $2`, `status = 'on_hold'`];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await query(`UPDATE tasks SET ${setParts.join(', ')} WHERE ${conditions.join(' AND ')}`, params);
}

hris.patch('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    if (typeof req.body?.status !== 'string') return next();
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const status = req.body.status.trim().toLowerCase();
    if (!['active', 'inactive', 'terminated', 'suspended', 'on_leave'].includes(status)) return res.status(400).json({ error: 'Invalid employee status' });
    const { rows } = await query(`UPDATE employees SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING *`, [status, req.params.id, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });
    const employee = rows[0];
    if (employee.user_id) {
      await query(`UPDATE users SET is_active = $1 WHERE id = $2 AND org_id = $3`, [status === 'active', employee.user_id, orgId]);
      if (status === 'active') await restoreEmployeeTasks({ orgId, employeeUserId: employee.user_id, actorUserId: req.user.id });
      else await quarantineEmployeeTasks({ orgId, employeeUserId: employee.user_id, actorUserId: req.user.id, reason: `employee_${status}` });
    }
    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'employee_status_changed', metadata: { employeeId: employee.id, employeeName: employee.full_name, newStatus: status } });
      await logAudit({ orgId, actorUserId: req.user.id, action: `hris.employee.status.${status}`, entityType: 'employee', entityId: employee.id, metadata: { employeeName: employee.full_name, newStatus: status }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }
    return res.json({ employee });
  } catch (err) { next(err); }
});

hris.delete('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(`SELECT e.*, u.role FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND e.org_id = $2`, [req.params.id, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Employee not found' });
    const employee = rows[0];
    if (employee.role === 'admin') return res.status(403).json({ error: 'Cannot delete an admin user.' });
    if (employee.user_id) {
      await quarantineEmployeeTasks({ orgId, employeeUserId: employee.user_id, actorUserId: req.user.id, reason: 'employee_deleted' });
      await query(`UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id = $2`, [employee.user_id, orgId]);
    }
    await query(`DELETE FROM employees WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'employee_terminated', metadata: { employeeId: req.params.id, employeeName: employee.full_name } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'hris.employee.terminated', entityType: 'employee', entityId: req.params.id, metadata: { employeeName: employee.full_name }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }
    return res.json({ success: true, message: 'Employee deleted, account deactivated, and active tasks moved to reassignment hold.' });
  } catch (err) { next(err); }
});

module.exports = { projects, tasks, hris };
