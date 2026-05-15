'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');
const { emitNotification } = require('../services/notificationService');

const router = express.Router();

const MANAGEMENT_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];
const MAX_BULK_REASSIGN = 200;
const VALID_TASK_STATUSES = new Set(['pending','in_progress','submitted','manager_approved','manager_rejected','completed','overdue','cancelled','on_hold']);

const columnsCache = new Map();

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
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

function nonTerminalTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

function reassignmentNeededCondition(alias = 't') {
  return `(
    COALESCE(${alias}.status, 'pending') = 'on_hold'
    OR ${alias}.assigned_to IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM users old_u
       WHERE old_u.id = ${alias}.assigned_to
         AND old_u.org_id = ${alias}.org_id
         AND COALESCE(old_u.is_active, TRUE) = TRUE
    )
    OR EXISTS (
      SELECT 1
        FROM employees e
       WHERE e.user_id = ${alias}.assigned_to
         AND e.org_id = ${alias}.org_id
         AND COALESCE(e.status, 'active') <> 'active'
    )
  )`;
}

function deletedGuard(taskCols, alias = 't') {
  return taskCols.has('deleted_at') ? `${alias}.deleted_at IS NULL` : 'TRUE';
}

function projectStatusExpression(alias, cols) {
  if (cols.has('status') && cols.has('is_active')) return `COALESCE(${alias}.status, CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END, 'active')`;
  if (cols.has('status')) return `COALESCE(${alias}.status, 'active')`;
  if (cols.has('is_active')) return `CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END`;
  return `'active'`;
}

async function getTaskForStatus(orgId, taskId) {
  const taskCols = await getColumns('tasks');
  const fields = ['id', 'org_id'];
  for (const field of ['title', 'status', 'assigned_to', 'category_id', 'project_id']) {
    if (taskCols.has(field)) fields.push(field);
  }
  const { rows } = await query(`SELECT ${fields.join(', ')} FROM tasks WHERE id = $1 AND org_id = $2 LIMIT 1`, [taskId, orgId]);
  return { task: rows[0] || null, taskCols };
}

async function getTaskProjectStatus(task, taskCols, orgId) {
  if (taskCols.has('project_id') && task.project_id) {
    const projectCols = await getColumns('projects').catch(() => new Set());
    if (projectCols.size) {
      const statusExpr = projectStatusExpression('p', projectCols);
      const { rows } = await query(`SELECT p.id, p.name, ${statusExpr} AS status FROM projects p WHERE p.org_id = $1 AND p.id = $2 LIMIT 1`, [orgId, task.project_id]);
      if (rows.length) return rows[0];
    }
  }
  if (taskCols.has('category_id') && task.category_id) {
    const categoryCols = await getColumns('task_categories').catch(() => new Set());
    if (categoryCols.size) {
      const statusExpr = projectStatusExpression('tc', categoryCols);
      const { rows } = await query(`SELECT tc.id, tc.name, ${statusExpr} AS status FROM task_categories tc WHERE tc.org_id = $1 AND tc.id = $2 LIMIT 1`, [orgId, task.category_id]);
      if (rows.length) return rows[0];
    }
  }
  return null;
}

async function assertTaskAssigneeAvailable(orgId, userId) {
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

function canTransitionTask({ role, fromStatus, toStatus, task, userId }) {
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

async function writeStatusTimeline({ taskId, actorId, fromStatus, toStatus, note }) {
  try {
    const tlCols = await getColumns('task_timeline');
    if (!tlCols.size) return;
    const fields = ['task_id', 'actor_type', 'event_type'];
    const values = [taskId, 'user', 'status_changed'];
    if (tlCols.has('actor_id')) { fields.push('actor_id'); values.push(actorId); }
    if (tlCols.has('from_status')) { fields.push('from_status'); values.push(fromStatus); }
    if (tlCols.has('to_status')) { fields.push('to_status'); values.push(toStatus); }
    if (tlCols.has('note')) { fields.push('note'); values.push(note || null); }
    const ph = values.map((_, i) => `$${i + 1}`).join(', ');
    await query(`INSERT INTO task_timeline (${fields.join(', ')}) VALUES (${ph})`, values);
  } catch { /* timeline is non-critical */ }
}

async function updateTaskStatusCompat(req, res, next) {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    if (!VALID_TASK_STATUSES.has(nextStatus)) return res.status(400).json({ error: `Invalid status: ${nextStatus}` });

    const { task, taskCols } = await getTaskForStatus(orgId, req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const fromStatus = task.status || 'pending';
    const role = String(req.user?.role || '').toLowerCase();
    if (!canTransitionTask({ role, fromStatus, toStatus: nextStatus, task, userId: req.user.id })) {
      return res.status(403).json({ error: `Your role cannot transition this task from ${fromStatus} to ${nextStatus}.` });
    }

    const project = await getTaskProjectStatus(task, taskCols, orgId);
    if (project && project.status !== 'active') {
      const allowedPausedMoves = new Set(['on_hold', 'cancelled']);
      if (!(project.status === 'paused' && allowedPausedMoves.has(nextStatus))) {
        return res.status(409).json({ error: `Task status cannot be changed while project "${project.name || project.id}" is ${project.status}. Reactivate the project first.`, code: 'PROJECT_NOT_ACTIVE', projectId: project.id, projectStatus: project.status });
      }
    }

    if (['pending', 'in_progress', 'submitted', 'completed', 'manager_approved'].includes(nextStatus)) {
      const availability = await assertTaskAssigneeAvailable(orgId, task.assigned_to);
      if (!availability.ok) return res.status(availability.status).json({ error: availability.error });
    }

    const setParts = ['status = $1'];
    const params = [nextStatus, task.id, orgId];
    if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
    if (nextStatus === 'in_progress' && taskCols.has('started_at')) setParts.push('started_at = NOW()');
    if (nextStatus === 'submitted' && taskCols.has('submitted_at')) setParts.push('submitted_at = NOW()');
    if (nextStatus === 'completed' && taskCols.has('completed_at')) setParts.push('completed_at = NOW()');

    const { rows } = await query(`UPDATE tasks SET ${setParts.join(', ')} WHERE id = $2 AND org_id = $3 RETURNING id, status`, params);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });

    await writeStatusTimeline({ taskId: task.id, actorId: req.user.id, fromStatus, toStatus: nextStatus, note: req.body?.note || null });
    try {
      await logUserActivity({ orgId, userId: req.user.id, taskId: task.id, activityType: 'task_status_changed', metadata: { fromStatus, toStatus: nextStatus, schemaCompat: true } });
    } catch { /* non-critical */ }

    return res.json({ ok: true, message: 'Status updated', taskId: task.id, status: nextStatus, previous: fromStatus });
  } catch (err) { next(err); }
}

router.post('/:id/set-status', authenticate, updateTaskStatusCompat);
router.patch('/:id/status', authenticate, updateTaskStatusCompat);
router.patch('/:id/board-status', authenticate, updateTaskStatusCompat);

async function getScopedUserIds(req) {
  if (isOrgWideRole(req.user.role)) return null;
  const ids = new Set([req.user.id]);
  try {
    const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
    for (const row of rows || []) if (row.user_id) ids.add(row.user_id);
  } catch {
    // Legacy DBs may not have get_subordinate_ids. Fall back to self-only instead of org-wide.
  }
  return Array.from(ids);
}

async function buildScope(req, params, alias = 't') {
  const scopedUserIds = await getScopedUserIds(req);
  if (!scopedUserIds) return { clause: 'TRUE', scopedUserIds: null };
  params.push(scopedUserIds);
  return { clause: `(${alias}.assigned_to IS NULL OR ${alias}.assigned_to = ANY($${params.length}))`, scopedUserIds };
}

async function assertAssigneeInScope(req, assignedTo) {
  const scopedUserIds = await getScopedUserIds(req);
  if (!scopedUserIds) return { ok: true };
  if (scopedUserIds.includes(assignedTo)) return { ok: true };
  return { ok: false, status: 403, error: 'Selected assignee is outside your reporting scope.' };
}

async function assertAssignableUser({ orgId, userId }) {
  if (!userId || typeof userId !== 'string') {
    return { ok: false, status: 400, error: 'assigned_to is required.' };
  }
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

  if (!rows.length) return { ok: false, status: 404, error: 'Assignee not found.' };
  if (!rows[0].user_active || !rows[0].employee_active) {
    return { ok: false, status: 409, error: 'Selected assignee is inactive or unavailable.' };
  }
  return { ok: true };
}

async function countReassignmentTasks(req, orgId) {
  const taskCols = await getColumns('tasks');
  const params = [orgId];
  const scope = await buildScope(req, params, 't');
  const { rows } = await query(
    `SELECT COUNT(DISTINCT t.id)::int AS count
       FROM tasks t
      WHERE t.org_id = $1
        AND ${deletedGuard(taskCols, 't')}
        AND ${nonTerminalTaskCondition('t')}
        AND ${reassignmentNeededCondition('t')}
        AND ${scope.clause}`,
    params
  );
  return Number(rows[0]?.count || 0);
}

router.get('/reassignment-needed/count', authenticate, requireAnyRole(...MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const count = await countReassignmentTasks(req, orgId);
    return res.json({ count });
  } catch (err) { next(err); }
});

router.get('/reassignment-needed', authenticate, requireAnyRole(...MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const taskCols = await getColumns('tasks');
    const params = [orgId];
    const scope = await buildScope(req, params, 't');
    const { rows } = await query(
      `SELECT t.*, u.full_name AS assigned_to_name, u.email AS assigned_to_email,
              cat.name AS category_name, cat.color AS category_color
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         LEFT JOIN task_categories cat ON cat.id = t.category_id
        WHERE t.org_id = $1
          AND ${deletedGuard(taskCols, 't')}
          AND ${nonTerminalTaskCondition('t')}
          AND ${reassignmentNeededCondition('t')}
          AND ${scope.clause}
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT 200`,
      params
    );
    return res.json({ tasks: rows, scoped: !!scope.scopedUserIds });
  } catch (err) { next(err); }
});

async function notifyReassignment({ orgId, actorUserId, assignedTo, tasks }) {
  if (!assignedTo || !Array.isArray(tasks) || !tasks.length) return;
  try {
    const sample = tasks.slice(0, 3).map((t) => t.title || t.id).join(', ');
    await emitNotification(assignedTo, {
      type: 'task.reassigned',
      title: tasks.length === 1 ? 'Task reassigned to you' : `${tasks.length} tasks reassigned to you`,
      body: tasks.length === 1 ? `${tasks[0].title || 'A task'} is now assigned to you.` : `Tasks reassigned to you: ${sample}${tasks.length > 3 ? ', …' : ''}`,
      data: {
        orgId,
        taskIds: tasks.map((t) => t.id),
        reassignedBy: actorUserId,
        deliveryChannels: ['in_app', 'push'],
        dedupeKey: `reassign:${assignedTo}:${Date.now()}`,
      },
      dedupeKey: `reassign:${assignedTo}:${Date.now()}`,
    });
  } catch { /* notification failure must not block reassignment */ }
}

router.post('/reassign', authenticate, requireAnyRole(...MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const taskIds = Array.isArray(req.body?.taskIds)
      ? req.body.taskIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const assignedTo = String(req.body?.assigned_to || req.body?.assignedTo || '').trim();
    const nextStatus = String(req.body?.status || 'pending').trim().toLowerCase();

    if (!taskIds.length) return res.status(400).json({ error: 'taskIds must contain at least one task id.' });
    if (taskIds.length > MAX_BULK_REASSIGN) return res.status(400).json({ error: `Cannot reassign more than ${MAX_BULK_REASSIGN} tasks at once.` });
    if (!['pending', 'on_hold'].includes(nextStatus)) return res.status(400).json({ error: 'status must be pending or on_hold.' });

    const assigneeScope = await assertAssigneeInScope(req, assignedTo);
    if (!assigneeScope.ok) return res.status(assigneeScope.status).json({ error: assigneeScope.error });

    const assignable = await assertAssignableUser({ orgId, userId: assignedTo });
    if (!assignable.ok) return res.status(assignable.status).json({ error: assignable.error });

    const taskCols = await getColumns('tasks');
    if (!taskCols.has('assigned_to')) return res.status(500).json({ error: 'tasks.assigned_to column is required for reassignment.' });

    const updated = await withTransaction(async (tx) => {
      const params = [orgId, taskIds, assignedTo, nextStatus];
      const scope = await buildScope(req, params, 't');
      const setParts = ['assigned_to = $3', 'status = $4'];
      if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
      if (taskCols.has('metadata')) {
        params.push(JSON.stringify({ reassignment_required: false, reassigned_by: req.user.id, reassigned_at: new Date().toISOString(), reassignment_target: assignedTo }));
        setParts.push(`metadata = COALESCE(metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`);
      }

      const { rows } = await tx.query(
        `UPDATE tasks t
            SET ${setParts.join(', ')}
          WHERE t.org_id = $1
            AND t.id = ANY($2::uuid[])
            AND ${deletedGuard(taskCols, 't')}
            AND ${nonTerminalTaskCondition('t')}
            AND ${reassignmentNeededCondition('t')}
            AND ${scope.clause}
          RETURNING t.id, t.title, t.status, t.assigned_to`,
        params
      );
      return rows;
    });

    if (!updated.length) {
      return res.status(409).json({ error: 'No eligible in-scope reassignment tasks were updated.', updated: [] });
    }

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'tasks_reassigned', metadata: { taskIds: updated.map((t) => t.id), assignedTo, count: updated.length, scoped: !isOrgWideRole(req.user.role) } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'tasks.bulk_reassigned', entityType: 'task', entityId: updated[0]?.id || null, metadata: { taskIds: updated.map((t) => t.id), assignedTo, status: nextStatus, count: updated.length, scoped: !isOrgWideRole(req.user.role) }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
      await notifyReassignment({ orgId, actorUserId: req.user.id, assignedTo, tasks: updated });
    } catch { /* non-critical */ }

    return res.json({ updatedCount: updated.length, tasks: updated });
  } catch (err) { next(err); }
});

module.exports = router;
