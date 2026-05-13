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

module.exports = router;

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

    // Check dependency: block if any task is depended upon by non-deleted tasks
    const { rows: blocked } = await query(
      `SELECT t.id, t.title FROM tasks t
       JOIN task_dependencies td ON td.depends_on_id = t.id
       WHERE t.id = ANY($1::uuid[]) AND t.org_id = $2
         AND td.task_id NOT IN (SELECT unnest($1::uuid[]))
         AND (SELECT deleted_at FROM tasks WHERE id = td.task_id) IS NULL`,
      [taskIds, orgId]
    ).catch(() => ({ rows: [] }));

    if (blocked.length) {
      return res.status(409).json({
        error: 'Some tasks cannot be deleted because other tasks depend on them.',
        blocked: blocked.map(t => ({ id: t.id, title: t.title })),
      });
    }

    const { rows } = await query(
      `UPDATE tasks SET deleted_at = NOW()
       WHERE id = ANY($1::uuid[]) AND org_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [taskIds, orgId]
    );

    // Audit log (fire and forget)
    ;(async () => {
      try {
        const { logAudit } = require('../services/auditService');
        await logAudit({ orgId, actorUserId: req.user.id, action: 'task.bulk_delete', entityType: 'task', metadata: { taskIds: rows.map(r => r.id), count: rows.length } });
      } catch {}
    })();

    return res.json({ deleted: rows.length, ids: rows.map(r => r.id) });
  } catch (err) { next(err); }
});

// ─── List archived (soft-deleted) tasks ──────────────────────────────────────
// GET /api/v1/tasks/bulk/archived
// Returns tasks where deleted_at IS NOT NULL for this org (manager+).
router.get('/archived', authenticate, requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const page  = Math.max(1, parseInt(String(req.query.page  || '1'),  10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const offset = (page - 1) * limit;

    const { rows } = await query(
      `SELECT t.id, t.title, t.status, t.priority, t.deleted_at,
              u.full_name AS deleted_by_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.org_id = $1 AND t.deleted_at IS NOT NULL
       ORDER BY t.deleted_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );

    return res.json({ archived: rows, page, limit });
  } catch (err) { next(err); }
});

// ─── Restore archived task ────────────────────────────────────────────────────
// POST /api/v1/tasks/bulk/restore/:taskId
router.post('/restore/:taskId', authenticate, requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const orgId  = req.user.org_id ?? req.user.orgId;
    const taskId = String(req.params.taskId || '');
    const { rows } = await query(
      `UPDATE tasks SET deleted_at = NULL WHERE id = $1 AND org_id = $2 AND deleted_at IS NOT NULL RETURNING id, title`,
      [taskId, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Archived task not found.' });
    return res.json({ restored: rows[0] });
  } catch (err) { next(err); }
});
