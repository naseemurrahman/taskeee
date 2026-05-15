'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');

const projects = express.Router();
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

function projectStatusExpression(alias, cols) {
  if (cols.has('status') && cols.has('is_active')) return `COALESCE(${alias}.status, CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END, 'active')`;
  if (cols.has('status')) return `COALESCE(${alias}.status, 'active')`;
  if (cols.has('is_active')) return `CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END`;
  return `'active'`;
}

function projectIsActiveExpression(alias, cols) {
  if (cols.has('status')) return `${projectStatusExpression(alias, cols)} = 'active'`;
  if (cols.has('is_active')) return `${alias}.is_active = TRUE`;
  return 'TRUE';
}

function activeTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled','on_hold')`;
}

function nonTerminalTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

function addTaskMetadataSet({ taskCols, setParts, params, metadata, alias = '' }) {
  if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
  if (taskCols.has('metadata')) {
    params.push(JSON.stringify(metadata));
    const prefix = alias ? `${alias}.` : '';
    setParts.push(`metadata = COALESCE(${prefix}metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`);
  }
}

async function resolveProjectStore() {
  const tables = await getTableNames();
  if (tables.has('task_categories')) return 'task_categories';
  if (tables.has('projects')) return 'projects';
  return null;
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
  const { rows } = await query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return parseInt(rows[0]?.cnt || 0, 10);
}

async function mutateProjectTasksForStatusTx({ tx, orgId, projectId, status, actorUserId }) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status')) return;
  const relationParts = await projectTaskRelationParts(taskCols, '$2', 't');
  if (!relationParts.length) return;
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');

  if (status === 'paused') {
    const params = [orgId, projectId, 'on_hold'];
    const setParts = ['status = $3'];
    addTaskMetadataSet({ taskCols, setParts, params, alias: 't', metadata: { hold_reason: 'project_paused', hold_project_id: projectId, held_by: actorUserId, held_at: new Date().toISOString() } });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }

  if (status === 'active') {
    const activeAssigneeGuard = taskCols.has('assigned_to')
      ? `(t.assigned_to IS NULL OR EXISTS (SELECT 1 FROM users au WHERE au.id = t.assigned_to AND au.org_id = $1 AND COALESCE(au.is_active, TRUE) = TRUE))`
      : 'TRUE';
    const params = [orgId, projectId, 'pending'];
    const setParts = ['status = $3'];
    addTaskMetadataSet({ taskCols, setParts, params, alias: 't', metadata: { hold_reason: null, resumed_project_id: projectId, resumed_by: actorUserId, resumed_at: new Date().toISOString() } });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(`COALESCE(t.status,'pending') = 'on_hold'`, activeAssigneeGuard).join(' AND ')}`, params);
  }

  if (status === 'completed') {
    const params = [orgId, projectId, 'cancelled'];
    const setParts = ['status = $3'];
    addTaskMetadataSet({ taskCols, setParts, params, alias: 't', metadata: { cancelled_reason: 'project_completed', cancelled_project_id: projectId, cancelled_by: actorUserId, cancelled_at: new Date().toISOString() } });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }
}

projects.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
    if (!requestedStatus) return next();
    if (!['active', 'paused', 'completed'].includes(requestedStatus)) return res.status(400).json({ error: 'Invalid status' });

    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });
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

    const project = await withTransaction(async (tx) => {
      let rows;
      if (store === 'task_categories') {
        const cols = await getColumns('task_categories');
        if (!cols.has('status')) {
          await tx.query(`ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);
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
        ({ rows } = await tx.query(
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
        if (!cols.has('status')) throw Object.assign(new Error('projects.status column is required for status changes.'), { statusCode: 500 });
        ({ rows } = await tx.query(
          `UPDATE projects SET status = $1 WHERE org_id = $2 AND id = $3
           RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at`,
          [requestedStatus, orgId, projectId]
        ));
      }
      if (!rows.length) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
      await mutateProjectTasksForStatusTx({ tx, orgId, projectId, status: requestedStatus, actorUserId: req.user.id });
      return rows[0];
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId, projectName: project?.name, newStatus: requestedStatus, activeTaskCount: activeCount, transactional: true } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: projectId, metadata: { newStatus: requestedStatus, projectName: project?.name, activeTaskCount: activeCount, transactional: true }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ project, affectedActiveTasks: activeCount });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

async function mutateEmployeeTasksTx({ tx, orgId, employeeUserId, actorUserId, action, reason }) {
  if (!employeeUserId) return;
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('assigned_to')) return;
  const params = [orgId, employeeUserId];
  const setParts = [action === 'restore' ? `status = 'pending'` : `status = 'on_hold'`];
  const metadata = action === 'restore'
    ? { reassignment_required: false, restored_by: actorUserId, restored_at: new Date().toISOString() }
    : { reassignment_required: true, reassignment_reason: reason, held_by: actorUserId, held_at: new Date().toISOString() };
  addTaskMetadataSet({ taskCols, setParts, params, metadata });
  const conditions = [`org_id = $1`, `assigned_to = $2`, action === 'restore' ? `status = 'on_hold'` : nonTerminalTaskCondition('tasks')];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await tx.query(`UPDATE tasks SET ${setParts.join(', ')} WHERE ${conditions.join(' AND ')}`, params);
}

hris.patch('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    if (typeof req.body?.status !== 'string') return next();
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const status = req.body.status.trim().toLowerCase();
    if (!['active', 'inactive', 'terminated', 'suspended', 'on_leave'].includes(status)) return res.status(400).json({ error: 'Invalid employee status' });

    const employee = await withTransaction(async (tx) => {
      const { rows } = await tx.query(`UPDATE employees SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING *`, [status, req.params.id, orgId]);
      if (!rows.length) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
      const row = rows[0];
      if (row.user_id) {
        await tx.query(`UPDATE users SET is_active = $1 WHERE id = $2 AND org_id = $3`, [status === 'active', row.user_id, orgId]);
        await mutateEmployeeTasksTx({ tx, orgId, employeeUserId: row.user_id, actorUserId: req.user.id, action: status === 'active' ? 'restore' : 'quarantine', reason: `employee_${status}` });
      }
      return row;
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'employee_status_changed', metadata: { employeeId: employee.id, employeeName: employee.full_name, newStatus: status, transactional: true } });
      await logAudit({ orgId, actorUserId: req.user.id, action: `hris.employee.status.${status}`, entityType: 'employee', entityId: employee.id, metadata: { employeeName: employee.full_name, newStatus: status, transactional: true }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ employee });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

hris.delete('/employees/:id', authenticate, requireAnyRole('hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const employee = await withTransaction(async (tx) => {
      const { rows } = await tx.query(`SELECT e.*, u.role FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1 AND e.org_id = $2`, [req.params.id, orgId]);
      if (!rows.length) throw Object.assign(new Error('Employee not found'), { statusCode: 404 });
      const row = rows[0];
      if (row.role === 'admin') throw Object.assign(new Error('Cannot delete an admin user.'), { statusCode: 403 });
      if (row.user_id) {
        await mutateEmployeeTasksTx({ tx, orgId, employeeUserId: row.user_id, actorUserId: req.user.id, action: 'quarantine', reason: 'employee_deleted' });
        await tx.query(`UPDATE users SET is_active = FALSE WHERE id = $1 AND org_id = $2`, [row.user_id, orgId]);
      }
      await tx.query(`DELETE FROM employees WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
      return row;
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'employee_terminated', metadata: { employeeId: req.params.id, employeeName: employee.full_name, transactional: true } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'hris.employee.terminated', entityType: 'employee', entityId: req.params.id, metadata: { employeeName: employee.full_name, transactional: true }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ success: true, message: 'Employee deleted, account deactivated, and active tasks moved to reassignment hold.' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

module.exports = { projects, hris };
