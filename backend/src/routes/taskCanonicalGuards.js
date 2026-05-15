'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logUserActivity } = require('../services/activityService');

const router = express.Router();
const VALID_STATUS = new Set(['pending','in_progress','submitted','manager_approved','manager_rejected','completed','overdue','cancelled','on_hold']);
const ACTIVE_WORKFLOW = new Set(['pending','in_progress','submitted','completed','manager_approved']);
const columnsCache = new Map();

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

async function assertAssigneeAvailable(orgId, userId) {
  if (!userId) return { ok: true };
  const { rows } = await query(
    `SELECT u.id
       FROM users u
      WHERE u.id = $1
        AND u.org_id = $2
        AND COALESCE(u.is_active, TRUE) = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM employees e
           WHERE e.user_id = u.id
             AND e.org_id = $2
             AND COALESCE(e.status, 'active') <> 'active'
        )
      LIMIT 1`,
    [userId, orgId]
  );
  if (!rows.length) return { ok: false, status: 409, error: 'This employee is inactive or terminated and cannot continue active task workflow.' };
  return { ok: true };
}

async function getProject(orgId, projectId) {
  if (!projectId) return null;
  try {
    const { rows } = await query(
      `SELECT id, name, COALESCE(status, 'active') AS status
         FROM projects
        WHERE id = $1 AND org_id = $2
        LIMIT 1`,
      [projectId, orgId]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return null;
    throw err;
  }
}

function canTransition({ role, fromStatus, toStatus, task, userId }) {
  if (['admin', 'director', 'manager', 'supervisor', 'hr'].includes(role)) return true;
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

router.get('/assignable-users', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const params = [orgId];
    let p = 2;
    const conditions = [
      'u.org_id = $1',
      'COALESCE(u.is_active, TRUE) = TRUE',
      `NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.org_id = $1 AND COALESCE(e.status, 'active') <> 'active')`,
    ];
    if (req.query.department && req.query.department !== 'all') {
      conditions.push(`u.department = $${p++}`);
      params.push(req.query.department);
    }
    if (!isOrgWideRole(req.user.role)) {
      try {
        const { rows: subs } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
        const ids = [req.user.id, ...subs.map((r) => r.user_id).filter(Boolean)];
        conditions.push(`u.id = ANY($${p++})`);
        params.push(ids);
      } catch {
        conditions.push(`u.id = $${p++}`);
        params.push(req.user.id);
      }
    }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department, u.employee_code
         FROM users u
        WHERE ${conditions.join(' AND ')}
        ORDER BY u.full_name ASC NULLS LAST, u.email ASC`,
      params
    );
    return res.json({ users: rows.map((u) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: u.role, department: u.department, employeeCode: u.employee_code })) });
  } catch (err) { next(err); }
});

async function updateStatus(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!VALID_STATUS.has(nextStatus)) return res.status(400).json({ error: `Invalid status: ${nextStatus}` });

    const taskCols = await getColumns('tasks');
    const fields = ['id', 'org_id'];
    for (const field of ['status', 'assigned_to', 'project_id']) if (taskCols.has(field)) fields.push(field);
    const { rows } = await query(`SELECT ${fields.join(', ')} FROM tasks WHERE id = $1 AND org_id = $2 LIMIT 1`, [req.params.id, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = rows[0];
    const fromStatus = task.status || 'pending';

    const role = String(req.user?.role || '').toLowerCase();
    if (!canTransition({ role, fromStatus, toStatus: nextStatus, task, userId: req.user.id })) {
      return res.status(403).json({ error: `Your role cannot transition this task from ${fromStatus} to ${nextStatus}.` });
    }

    const project = await getProject(orgId, task.project_id);
    if (project && project.status !== 'active') {
      const allowedPausedMove = project.status === 'paused' && ['on_hold', 'cancelled'].includes(nextStatus);
      if (!allowedPausedMove) return res.status(409).json({ error: `Task status cannot be changed while project "${project.name || project.id}" is ${project.status}. Reactivate the project first.`, code: 'PROJECT_NOT_ACTIVE', projectId: project.id, projectStatus: project.status });
    }

    if (ACTIVE_WORKFLOW.has(nextStatus)) {
      const available = await assertAssigneeAvailable(orgId, task.assigned_to);
      if (!available.ok) return res.status(available.status).json({ error: available.error });
    }

    const setParts = ['status = $1'];
    const params = [nextStatus, task.id, orgId];
    if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
    if (nextStatus === 'in_progress' && taskCols.has('started_at')) setParts.push('started_at = NOW()');
    if (nextStatus === 'submitted' && taskCols.has('submitted_at')) setParts.push('submitted_at = NOW()');
    if (nextStatus === 'completed' && taskCols.has('completed_at')) setParts.push('completed_at = NOW()');
    const result = await query(`UPDATE tasks SET ${setParts.join(', ')} WHERE id = $2 AND org_id = $3 RETURNING id, status`, params);

    try {
      await logUserActivity({ orgId, userId: req.user.id, taskId: task.id, activityType: 'task_status_changed', metadata: { fromStatus, toStatus: nextStatus, canonicalProjectOnly: true } });
    } catch { /* non-critical */ }
    return res.json({ ok: true, message: 'Status updated', taskId: result.rows[0].id, status: result.rows[0].status, previous: fromStatus });
  } catch (err) { next(err); }
}

router.post('/:id/set-status', authenticate, updateStatus);
router.patch('/:id/status', authenticate, updateStatus);
router.patch('/:id/board-status', authenticate, updateStatus);

module.exports = router;
