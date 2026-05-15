'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logUserActivity } = require('../services/activityService');

const router = express.Router();
const columnsCache = new Map();

const VALID_STATUSES = new Set([
  'pending',
  'in_progress',
  'submitted',
  'manager_approved',
  'manager_rejected',
  'completed',
  'overdue',
  'cancelled',
  'on_hold',
]);

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

function projectStatusExpression(alias, cols) {
  if (cols.has('status') && cols.has('is_active')) return `COALESCE(${alias}.status, CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END, 'active')`;
  if (cols.has('status')) return `COALESCE(${alias}.status, 'active')`;
  if (cols.has('is_active')) return `CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END`;
  return `'active'`;
}

async function getTask(orgId, taskId) {
  const cols = await getColumns('tasks');
  const fields = ['id', 'org_id'];
  for (const optional of ['title', 'status', 'assigned_to', 'category_id', 'project_id']) {
    if (cols.has(optional)) fields.push(optional);
  }
  const { rows } = await query(
    `SELECT ${fields.join(', ')} FROM tasks WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [taskId, orgId]
  );
  return { task: rows[0] || null, cols };
}

async function getTaskProjectStatus(task, taskCols, orgId) {
  if (taskCols.has('project_id') && task.project_id) {
    const cols = await getColumns('projects').catch(() => new Set());
    if (cols.size) {
      const statusExpr = projectStatusExpression('p', cols);
      const { rows } = await query(
        `SELECT p.id, p.name, ${statusExpr} AS status FROM projects p WHERE p.org_id = $1 AND p.id = $2 LIMIT 1`,
        [orgId, task.project_id]
      );
      if (rows.length) return rows[0];
    }
  }

  if (taskCols.has('category_id') && task.category_id) {
    const cols = await getColumns('task_categories').catch(() => new Set());
    if (cols.size) {
      const statusExpr = projectStatusExpression('tc', cols);
      const { rows } = await query(
        `SELECT tc.id, tc.name, ${statusExpr} AS status FROM task_categories tc WHERE tc.org_id = $1 AND tc.id = $2 LIMIT 1`,
        [orgId, task.category_id]
      );
      if (rows.length) return rows[0];
    }
  }

  return null;
}

async function assertAssigneeAvailable(orgId, userId) {
  if (!userId) return { ok: true };
  const { rows } = await query(
    `SELECT u.id,
            COALESCE(u.is_active, TRUE) AS user_active,
            NOT EXISTS (
              SELECT 1
                FROM employees e
               WHERE e.user_id = u.id
                 AND e.org_id = $2
                 AND COALESCE(e.status, 'active') <> 'active'
            ) AS employee_active
       FROM users u
      WHERE u.id = $1 AND u.org_id = $2
      LIMIT 1`,
    [userId, orgId]
  );
  if (!rows.length) return { ok: false, status: 400, error: 'Referenced assignee was not found.' };
  if (!rows[0].user_active || !rows[0].employee_active) return { ok: false, status: 409, error: 'This employee is inactive or terminated and cannot continue active task workflow.' };
  return { ok: true };
}

function allowedForRole({ role, fromStatus, toStatus, task, userId }) {
  if (['admin', 'director'].includes(role)) return true;
  if (['manager', 'supervisor', 'hr'].includes(role)) return true;
  if (['employee', 'technician'].includes(role)) {
    if (task.assigned_to && String(task.assigned_to) !== String(userId)) return false;
    const allowed = {
      pending: ['in_progress'],
      overdue: ['in_progress'],
      in_progress: ['submitted', 'pending'],
      submitted: ['in_progress'],
      manager_approved: ['completed'],
      manager_rejected: ['in_progress'],
    };
    return (allowed[fromStatus] || []).includes(toStatus);
  }
  return false;
}

async function writeTimeline({ taskId, actorId, fromStatus, toStatus, note }) {
  try {
    const cols = await getColumns('task_timeline');
    if (!cols.size) return;
    const fields = ['task_id', 'actor_type', 'event_type'];
    const values = [taskId, 'user', 'status_changed'];
    if (cols.has('actor_id')) { fields.push('actor_id'); values.push(actorId); }
    if (cols.has('from_status')) { fields.push('from_status'); values.push(fromStatus); }
    if (cols.has('to_status')) { fields.push('to_status'); values.push(toStatus); }
    if (cols.has('note')) { fields.push('note'); values.push(note || null); }
    const ph = values.map((_, i) => `$${i + 1}`).join(', ');
    await query(`INSERT INTO task_timeline (${fields.join(', ')}) VALUES (${ph})`, values);
  } catch { /* non-critical */ }
}

async function updateStatus(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const status = String(req.body?.status || '').trim().toLowerCase();
    const note = req.body?.note || null;
    if (!VALID_STATUSES.has(status)) return res.status(400).json({ error: `Invalid status: ${status}` });

    const { task, cols: taskCols } = await getTask(orgId, req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const fromStatus = task.status || 'pending';

    const role = String(req.user?.role || '').toLowerCase();
    if (!allowedForRole({ role, fromStatus, toStatus: status, task, userId: req.user.id })) {
      return res.status(403).json({ error: `Your role cannot transition this task from ${fromStatus} to ${status}.` });
    }

    const project = await getTaskProjectStatus(task, taskCols, orgId);
    if (project && project.status !== 'active') {
      const allowedPausedMoves = new Set(['on_hold', 'cancelled']);
      if (!(project.status === 'paused' && allowedPausedMoves.has(status))) {
        return res.status(409).json({ error: `Task status cannot be changed while project "${project.name || project.id}" is ${project.status}. Reactivate the project first.`, code: 'PROJECT_NOT_ACTIVE', projectId: project.id, projectStatus: project.status });
      }
    }

    if (['pending', 'in_progress', 'submitted', 'completed', 'manager_approved'].includes(status)) {
      const availability = await assertAssigneeAvailable(orgId, task.assigned_to);
      if (!availability.ok) return res.status(availability.status).json({ error: availability.error });
    }

    const setParts = ['status = $1'];
    const params = [status, task.id, orgId];
    if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
    if (status === 'in_progress' && taskCols.has('started_at')) setParts.push('started_at = NOW()');
    if (status === 'submitted' && taskCols.has('submitted_at')) setParts.push('submitted_at = NOW()');
    if (status === 'completed' && taskCols.has('completed_at')) setParts.push('completed_at = NOW()');

    const { rows } = await query(
      `UPDATE tasks SET ${setParts.join(', ')} WHERE id = $2 AND org_id = $3 RETURNING id, status`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });

    await writeTimeline({ taskId: task.id, actorId: req.user.id, fromStatus, toStatus: status, note });
    try {
      await logUserActivity({ orgId, userId: req.user.id, taskId: task.id, activityType: 'task_status_changed', metadata: { fromStatus, toStatus: status, schemaCompat: true } });
    } catch { /* non-critical */ }

    return res.json({ ok: true, message: 'Status updated', taskId: task.id, status, previous: fromStatus });
  } catch (err) { next(err); }
}

router.post('/:id/set-status', authenticate, updateStatus);
router.patch('/:id/status', authenticate, updateStatus);
router.patch('/:id/board-status', authenticate, updateStatus);

module.exports = router;
