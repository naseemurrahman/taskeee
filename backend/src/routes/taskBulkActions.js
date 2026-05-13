const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { logUserActivity } = require('../services/activityService');

const MANAGER_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];
const ALLOWED_STATUSES = new Set([
  'pending',
  'in_progress',
  'submitted',
  'manager_approved',
  'manager_rejected',
  'completed',
  'overdue',
  'cancelled',
]);

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  return ALLOWED_STATUSES.has(value) ? value : null;
}

async function getDependencyColumn() {
  try {
    const { rows } = await query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'task_dependencies'
          AND column_name IN ('depends_on_task_id', 'depends_on_id')
        ORDER BY CASE column_name WHEN 'depends_on_task_id' THEN 0 ELSE 1 END
        LIMIT 1`
    );
    return rows[0]?.column_name || null;
  } catch {
    return null;
  }
}

async function findBlockedBulkDeletes(taskIds, orgId) {
  const dependsCol = await getDependencyColumn();
  if (!dependsCol) return [];

  const { rows } = await query(
    `SELECT DISTINCT t.id, t.title
       FROM tasks t
       JOIN task_dependencies td ON td.${dependsCol} = t.id
       JOIN tasks dependent ON dependent.id = td.task_id
      WHERE t.id = ANY($1::uuid[])
        AND t.org_id = $2
        AND dependent.org_id = $2
        AND td.task_id <> ALL($1::uuid[])
        AND COALESCE(td.dependency_type, 'blocks') = 'blocks'
        AND dependent.deleted_at IS NULL
        AND COALESCE(dependent.status, 'pending') NOT IN ('completed', 'manager_approved', 'cancelled')`,
    [taskIds, orgId]
  );
  return rows;
}

async function updateOneTaskStatus({ req, taskId, status, client = null }) {
  const db = client || { query };
  const orgId = req.user.org_id ?? req.user.orgId;

  const { rows } = await db.query(
    `UPDATE tasks
        SET status = $1,
            updated_at = COALESCE(NOW(), updated_at)
      WHERE id = $2
        AND org_id = $3
        AND deleted_at IS NULL
      RETURNING id, title, status, assigned_to, org_id`,
    [status, taskId, orgId]
  );

  const task = rows[0];
  if (!task) return null;

  try {
    await db.query(
      `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, to_status, note)
       VALUES ($1, $2, 'user', 'status_changed', $3, $4)`,
      [task.id, req.user.id, status, `Status changed to ${status.replace(/_/g, ' ')}`]
    );
  } catch (_) {
    // Timeline schema can differ in legacy deployments. Do not block status updates.
  }

  return task;
}

// Compatibility route for the frontend bulk action bar.
// The UI historically called PATCH /tasks/:id/status while the reliable inline path
// used POST /tasks/:id/set-status. This keeps both paths working.
router.patch('/:id/status', authenticate, requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const status = normalizeStatus(req.body?.status);
    if (!status) return res.status(400).json({ error: 'Valid status is required' });

    const task = await updateOneTaskStatus({ req, taskId: req.params.id, status });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    try {
      await logUserActivity({
        orgId: task.org_id,
        userId: req.user.id,
        taskId: task.id,
        activityType: 'task_status_changed',
        metadata: { status, source: 'bulk_or_compat_route' },
      });
    } catch (_) {}

    res.json({ ok: true, task });
  } catch (err) {
    next(err);
  }
});

// Efficient bulk route for future frontend use.
router.post('/bulk/status', authenticate, requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const status = normalizeStatus(req.body?.status);
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(String).filter(Boolean))].slice(0, 200)
      : [];

    if (!status) return res.status(400).json({ error: 'Valid status is required' });
    if (!ids.length) return res.status(400).json({ error: 'At least one task id is required' });

    const updated = [];
    await withTransaction(async (client) => {
      for (const id of ids) {
        const task = await updateOneTaskStatus({ req, taskId: id, status, client });
        if (task) updated.push(task);
      }
    });

    res.json({ ok: true, requested: ids.length, updated: updated.length, tasks: updated });
  } catch (err) {
    next(err);
  }
});

// ─── Bulk soft-delete ─────────────────────────────────────────────────────────
// DELETE /api/v1/tasks/bulk/delete
// Body: { taskIds: string[] }
// Requires manager+ role. Soft-deletes (sets deleted_at) all matching tasks
// in the org. Returns count of deleted tasks.
router.delete('/bulk/delete', authenticate, requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const orgId   = req.user.org_id ?? req.user.orgId;
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds.map(String).filter(Boolean) : [];
    if (!taskIds.length) return res.status(400).json({ error: 'taskIds array is required and must not be empty.' });
    if (taskIds.length > 100) return res.status(400).json({ error: 'Cannot bulk delete more than 100 tasks at once.' });

    const blocked = await findBlockedBulkDeletes(taskIds, orgId).catch(() => []);
    if (blocked.length) {
      return res.status(409).json({
        error: 'Some tasks cannot be deleted because active tasks depend on them.',
        blocked: blocked.map(t => ({ id: t.id, title: t.title })),
      });
    }

    const { rows } = await query(
      `UPDATE tasks SET deleted_at = NOW(), deleted_by = $3
       WHERE id = ANY($1::uuid[]) AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [taskIds, orgId, req.user.id]
    );

    // Audit log (fire and forget)
    ;(async () => {
      try {
        const { logAudit } = require('../services/auditService');
        await logAudit({
          orgId,
          actorUserId: req.user.id,
          action: 'task.bulk_delete',
          entityType: 'task',
          metadata: { requestedTaskIds: taskIds, deletedTaskIds: rows.map(r => r.id), count: rows.length },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || null,
        });
      } catch {}
    })();

    return res.json({ requested: taskIds.length, deleted: rows.length, ids: rows.map(r => r.id) });
  } catch (err) { next(err); }
});

async function listArchivedTasks(req, res, next) {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const page  = Math.max(1, parseInt(String(req.query.page  || '1'),  10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT t.id, t.title, t.status, t.priority, t.deleted_at,
              u.full_name AS assigned_to_name,
              deleted_by.full_name AS deleted_by_name,
              COUNT(*) OVER() AS total_count
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN users deleted_by ON deleted_by.id = t.deleted_by
       WHERE t.org_id = $1 AND t.deleted_at IS NOT NULL
       ORDER BY t.deleted_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );

    return res.json({
      archived: rows,
      page,
      limit,
      total: parseInt(rows[0]?.total_count || 0, 10),
    });
  } catch (err) { next(err); }
}

async function restoreArchivedTask(req, res, next) {
  try {
    const orgId  = req.user.org_id ?? req.user.orgId;
    const taskId = String(req.params.taskId || '');
    const { rows } = await query(
      `UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, restored_at = NOW(), restored_by = $3
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NOT NULL
       RETURNING id, title`,
      [taskId, orgId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Archived task not found.' });

    ;(async () => {
      try {
        const { logAudit } = require('../services/auditService');
        await logAudit({
          orgId,
          actorUserId: req.user.id,
          action: 'task.restore',
          entityType: 'task',
          entityId: rows[0].id,
          metadata: { title: rows[0].title },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || null,
        });
      } catch {}
    })();

    return res.json({ restored: rows[0] });
  } catch (err) { next(err); }
}

// Canonical bulk archive routes.
router.get('/bulk/archived', authenticate, requireAnyRole(...MANAGER_ROLES), listArchivedTasks);
router.post('/bulk/restore/:taskId', authenticate, requireAnyRole(...MANAGER_ROLES), restoreArchivedTask);

// Legacy aliases kept for compatibility with any deployed frontend bundle that
// used the old non-/bulk route accidentally exposed by the first implementation.
router.get('/archived', authenticate, requireAnyRole(...MANAGER_ROLES), listArchivedTasks);
router.post('/restore/:taskId', authenticate, requireAnyRole(...MANAGER_ROLES), restoreArchivedTask);

module.exports = router;
