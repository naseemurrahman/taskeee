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
