'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');

const MANAGEMENT_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function ensureTimeTrackingSchema() {
  await query(`CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at TIMESTAMPTZ,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (stopped_at IS NULL OR stopped_at >= started_at)
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_time_entries_org_started ON time_entries(org_id, started_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_time_entries_user_started ON time_entries(user_id, started_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_time_entries_task_started ON time_entries(task_id, started_at DESC)`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_one_running_timer ON time_entries(user_id) WHERE stopped_at IS NULL`);
}

async function getScopedUserIds(user, orgId) {
  if (isOrgWideRole(user.role)) {
    const { rows } = await query(`SELECT id FROM users WHERE org_id = $1 AND COALESCE(is_active, TRUE) = TRUE`, [orgId]);
    return rows.map(r => r.id);
  }
  if (['manager', 'supervisor'].includes(String(user.role || '').toLowerCase())) {
    try {
      const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [user.id]);
      return [user.id, ...rows.map(r => r.user_id)];
    } catch {
      return [user.id];
    }
  }
  return [user.id];
}

async function assertTaskAccess(req, taskId, orgId) {
  if (!taskId) return true;
  if (!isUuid(taskId)) return false;
  const { rows } = await query(
    `SELECT id, assigned_to, assigned_by FROM tasks WHERE id = $1 AND org_id = $2 AND COALESCE(deleted_at IS NULL, TRUE)`,
    [taskId, orgId]
  );
  const task = rows[0];
  if (!task) return false;
  if (isOrgWideRole(req.user.role)) return true;
  if (task.assigned_to === req.user.id || task.assigned_by === req.user.id) return true;
  try {
    const { rows: sub } = await query(`SELECT 1 FROM get_subordinate_ids($1) WHERE user_id = $2 LIMIT 1`, [req.user.id, task.assigned_to]);
    return sub.length > 0;
  } catch {
    return false;
  }
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    await ensureTimeTrackingSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const offset = (page - 1) * limit;
    const scopedIds = await getScopedUserIds(req.user, orgId);
    const requestedUserId = String(req.query.userId || '').trim();
    const taskId = String(req.query.taskId || '').trim();

    const conditions = ['te.org_id = $1', 'te.user_id = ANY($2::uuid[])'];
    const params = [orgId, scopedIds];
    let p = 3;

    if (requestedUserId) {
      if (!isUuid(requestedUserId) || !scopedIds.includes(requestedUserId)) return res.status(403).json({ error: 'User is outside your time-entry scope' });
      conditions.push(`te.user_id = $${p++}`);
      params.push(requestedUserId);
    }
    if (taskId) {
      if (!isUuid(taskId)) return res.status(400).json({ error: 'Invalid taskId' });
      conditions.push(`te.task_id = $${p++}`);
      params.push(taskId);
    }

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT te.*, u.full_name AS user_name, t.title AS task_title,
              EXTRACT(EPOCH FROM (COALESCE(te.stopped_at, NOW()) - te.started_at))::int AS duration_seconds,
              COUNT(*) OVER() AS total_count
         FROM time_entries te
         LEFT JOIN users u ON u.id = te.user_id
         LEFT JOIN tasks t ON t.id = te.task_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY te.started_at DESC
        LIMIT $${p++} OFFSET $${p++}`,
      params
    );

    res.json({ entries: rows, page, limit, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

router.get('/summary', authenticate, requireAnyRole(...MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    await ensureTimeTrackingSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const days = Math.min(365, Math.max(1, parseInt(String(req.query.days || '30'), 10)));
    const scopedIds = await getScopedUserIds(req.user, orgId);

    const { rows } = await query(
      `SELECT u.id AS user_id,
              u.full_name AS user_name,
              COUNT(te.id)::int AS entry_count,
              SUM(EXTRACT(EPOCH FROM (COALESCE(te.stopped_at, NOW()) - te.started_at)))::int AS total_seconds,
              COUNT(DISTINCT te.task_id)::int AS task_count
         FROM users u
         LEFT JOIN time_entries te
           ON te.user_id = u.id
          AND te.org_id = $1
          AND te.started_at >= NOW() - ($3::int * INTERVAL '1 day')
        WHERE u.org_id = $1
          AND u.id = ANY($2::uuid[])
          AND COALESCE(u.is_active, TRUE) = TRUE
        GROUP BY u.id, u.full_name
        ORDER BY total_seconds DESC NULLS LAST, u.full_name ASC`,
      [orgId, scopedIds, days]
    );

    res.json({ days, users: rows });
  } catch (err) { next(err); }
});

router.post('/start', authenticate, async (req, res, next) => {
  try {
    await ensureTimeTrackingSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const taskId = req.body?.taskId || req.body?.task_id || null;
    if (taskId && !(await assertTaskAccess(req, taskId, orgId))) return res.status(403).json({ error: 'Task is outside your scope' });

    const { rows: existing } = await query(
      `SELECT id FROM time_entries WHERE org_id = $1 AND user_id = $2 AND stopped_at IS NULL LIMIT 1`,
      [orgId, req.user.id]
    );
    if (existing[0]) return res.status(409).json({ error: 'A timer is already running', entryId: existing[0].id });

    const { rows } = await query(
      `INSERT INTO time_entries (org_id, task_id, user_id, notes, source, created_by)
       VALUES ($1, $2, $3, $4, 'timer', $3)
       RETURNING *`,
      [orgId, taskId || null, req.user.id, String(req.body?.notes || '').trim() || null]
    );

    await logAudit({ orgId, actorUserId: req.user.id, action: 'time_entry.start', entityType: 'time_entry', entityId: rows[0].id, metadata: { taskId: taskId || null }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ entry: rows[0] });
  } catch (err) { next(err); }
});

router.post('/stop', authenticate, async (req, res, next) => {
  try {
    await ensureTimeTrackingSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const entryId = String(req.body?.entryId || req.body?.entry_id || '').trim();
    const params = entryId ? [orgId, req.user.id, entryId] : [orgId, req.user.id];
    const sql = entryId
      ? `UPDATE time_entries SET stopped_at = NOW(), notes = COALESCE($4, notes), updated_by = $2, updated_at = NOW()
          WHERE org_id = $1 AND user_id = $2 AND id = $3 AND stopped_at IS NULL RETURNING *`
      : `UPDATE time_entries SET stopped_at = NOW(), notes = COALESCE($3, notes), updated_by = $2, updated_at = NOW()
          WHERE org_id = $1 AND user_id = $2 AND stopped_at IS NULL RETURNING *`;
    params.push(String(req.body?.notes || '').trim() || null);

    const { rows } = await query(sql, params);
    if (!rows.length) return res.status(404).json({ error: 'Running timer not found' });

    await logAudit({ orgId, actorUserId: req.user.id, action: 'time_entry.stop', entityType: 'time_entry', entityId: rows[0].id, metadata: { taskId: rows[0].task_id }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ entry: rows[0] });
  } catch (err) { next(err); }
});

router.post('/', authenticate, async (req, res, next) => {
  try {
    await ensureTimeTrackingSchema();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const taskId = req.body?.taskId || req.body?.task_id || null;
    if (taskId && !(await assertTaskAccess(req, taskId, orgId))) return res.status(403).json({ error: 'Task is outside your scope' });
    const startedAt = req.body?.startedAt || req.body?.started_at;
    const stoppedAt = req.body?.stoppedAt || req.body?.stopped_at;
    if (!startedAt || !stoppedAt) return res.status(400).json({ error: 'startedAt and stoppedAt are required' });

    const { rows } = await query(
      `INSERT INTO time_entries (org_id, task_id, user_id, started_at, stopped_at, notes, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$3)
       RETURNING *`,
      [orgId, taskId || null, req.user.id, startedAt, stoppedAt, String(req.body?.notes || '').trim() || null]
    );

    await logAudit({ orgId, actorUserId: req.user.id, action: 'time_entry.create', entityType: 'time_entry', entityId: rows[0].id, metadata: { taskId: taskId || null }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ entry: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
