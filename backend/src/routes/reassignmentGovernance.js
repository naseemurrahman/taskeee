'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');

const router = express.Router();

const MANAGEMENT_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];
const MAX_BULK_REASSIGN = 200;

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

async function countReassignmentTasks(orgId) {
  const taskCols = await getColumns('tasks');
  const { rows } = await query(
    `SELECT COUNT(DISTINCT t.id)::int AS count
       FROM tasks t
      WHERE t.org_id = $1
        AND ${deletedGuard(taskCols, 't')}
        AND ${nonTerminalTaskCondition('t')}
        AND ${reassignmentNeededCondition('t')}`,
    [orgId]
  );
  return Number(rows[0]?.count || 0);
}

router.get('/reassignment-needed/count', authenticate, requireAnyRole(...MANAGEMENT_ROLES), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const count = await countReassignmentTasks(orgId);
    return res.json({ count });
  } catch (err) { next(err); }
});

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

    const assignable = await assertAssignableUser({ orgId, userId: assignedTo });
    if (!assignable.ok) return res.status(assignable.status).json({ error: assignable.error });

    const taskCols = await getColumns('tasks');
    if (!taskCols.has('assigned_to')) return res.status(500).json({ error: 'tasks.assigned_to column is required for reassignment.' });

    const updated = await withTransaction(async (tx) => {
      const params = [orgId, taskIds, assignedTo, nextStatus];
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
          RETURNING t.id, t.title, t.status, t.assigned_to`,
        params
      );
      return rows;
    });

    if (!updated.length) {
      return res.status(409).json({ error: 'No eligible reassignment tasks were updated.', updated: [] });
    }

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'tasks_reassigned', metadata: { taskIds: updated.map((t) => t.id), assignedTo, count: updated.length } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'tasks.bulk_reassigned', entityType: 'task', entityId: updated[0]?.id || null, metadata: { taskIds: updated.map((t) => t.id), assignedTo, status: nextStatus, count: updated.length }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ updatedCount: updated.length, tasks: updated });
  } catch (err) { next(err); }
});

module.exports = router;
