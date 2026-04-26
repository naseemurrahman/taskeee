const express = require('express');
const router = express.Router({ mergeParams: true });
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');
const { emitNotification } = require('../services/notificationService');
const { logUserActivity } = require('../services/activityService');
const { orgIdForSessionUser } = require('../utils/orgContext');

async function assertTaskChatAccess(req, taskId) {
  const orgId = await orgIdForSessionUser(req);
  if (!orgId) return { ok: false, task: null };
  const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [taskId, orgId]);
  if (!rows.length) return { ok: false, task: null };
  const task = rows[0];
  const u = req.user;
  let legacyEmployeeIds = [];
  try {
    const { rows: empRows } = await query(
      `SELECT id FROM employees
       WHERE org_id = $1
         AND (user_id = $2 OR (work_email IS NOT NULL AND LOWER(work_email) = LOWER($3)))`,
      [orgId, u.id, u.email || '']
    );
    legacyEmployeeIds = empRows.map(r => r.id);
  } catch {
    legacyEmployeeIds = [];
  }
  if (isOrgWideRole(u.role)) return { ok: true, task };
  if (legacyEmployeeIds.includes(task.assigned_to)) return { ok: true, task };
  if (task.assigned_to === u.id || task.assigned_by === u.id) return { ok: true, task };
  const { rows: sub } = await query(
    `SELECT 1 FROM get_subordinate_ids($1) WHERE user_id = $2 LIMIT 1`,
    [u.id, task.assigned_to]
  );
  if (sub.length) return { ok: true, task };
  return { ok: false, task };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const a = await assertTaskChatAccess(req, taskId);
    if (!a.ok) return res.status(403).json({ error: 'Access denied' });
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `SELECT m.*, u.full_name AS sender_name
       FROM task_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.task_id = $1 AND m.org_id = $2
       ORDER BY m.created_at ASC`,
      [taskId, orgId]
    );
    res.json({ messages: rows });
  } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { body: text } = req.body;
    if (!text || String(text).trim().length < 1)
      return res.status(400).json({ error: 'Message body required' });
    if (String(text).length > 8000) return res.status(400).json({ error: 'Message too long' });

    const a = await assertTaskChatAccess(req, taskId);
    if (!a.ok) return res.status(403).json({ error: 'Access denied' });

    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const { rows } = await query(`
      INSERT INTO task_messages (task_id, org_id, sender_id, body)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [taskId, orgId, req.user.id, String(text).trim()]);

    await logUserActivity({
      orgId,
      userId: req.user.id,
      taskId,
      activityType: 'task_comment_added',
      metadata: { length: String(text).trim().length }
    });

    const mentionMatches = [...new Set((String(text).match(/@([a-zA-Z0-9._-]+)/g) || []).map(m => m.slice(1).toLowerCase()))];
    if (mentionMatches.length) {
      const { rows: orgUsers } = await query(`SELECT id, full_name, email FROM users WHERE org_id = $1`, [orgId]);
      for (const user of orgUsers) {
        const handle = String((user.full_name || user.email || '').toLowerCase()).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
        if (mentionMatches.includes(handle) && user.id !== req.user.id) {
          await emitNotification(user.id, {
            type: 'task_mention',
            title: 'You were mentioned in a task comment',
            body: a.task.title,
            data: { taskId }
          });
        }
      }
    }

    const task = a.task;
    const snippet = String(text).trim().slice(0, 160);
    const notifyIds = new Set();
    if (task.assigned_to && task.assigned_to !== req.user.id) notifyIds.add(task.assigned_to);
    if (task.assigned_by && task.assigned_by !== req.user.id) notifyIds.add(task.assigned_by);
    for (const uid of notifyIds) {
      await emitNotification(uid, {
        type: 'task_message',
        title: 'New message on a task',
        body: `${task.title}: ${snippet}`,
        data: { taskId }
      });
    }

    try {
      const { app } = require('../server');
      const io = app.get('io');
      if (task.assigned_to && task.assigned_to !== req.user.id) {
        io.to(`user:${task.assigned_to}`).emit('task_message', { taskId, message: rows[0] });
      }
      if (task.assigned_by && task.assigned_by !== req.user.id) {
        io.to(`user:${task.assigned_by}`).emit('task_message', { taskId, message: rows[0] });
      }
      io.to(`task:${taskId}`).emit('task_message', { taskId, message: rows[0] });
    } catch { /* */ }

    res.status(201).json({ message: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
