'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');

const router = express.Router();
const columnsCache = new Map();

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const cols = new Set(rows.map(r => String(r.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

function activeTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled','on_hold')`;
}

async function projectExists(orgId, projectId) {
  try {
    const { rows } = await query(`SELECT id, name FROM projects WHERE id = $1 AND org_id = $2 LIMIT 1`, [projectId, orgId]);
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function countActiveTasks(orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('project_id')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return Number(rows[0]?.cnt || 0);
}

async function mutateTasksForStatus(tx, { orgId, projectId, status, actorUserId }) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('project_id')) return;
  const conditions = ['t.org_id = $1', 't.project_id = $2'];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');

  const updateMetadata = (params, setParts, metadata) => {
    if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
    if (taskCols.has('metadata')) {
      params.push(JSON.stringify(metadata));
      setParts.push(`metadata = COALESCE(t.metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`);
    }
  };

  if (status === 'paused') {
    const params = [orgId, projectId, 'on_hold'];
    const setParts = ['status = $3'];
    updateMetadata(params, setParts, { hold_reason: 'project_paused', hold_project_id: projectId, held_by: actorUserId, held_at: new Date().toISOString() });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }

  if (status === 'active') {
    const params = [orgId, projectId, 'pending'];
    const setParts = ['status = $3'];
    const activeAssigneeGuard = taskCols.has('assigned_to')
      ? `(t.assigned_to IS NULL OR EXISTS (SELECT 1 FROM users au WHERE au.id = t.assigned_to AND au.org_id = $1 AND COALESCE(au.is_active, TRUE) = TRUE))`
      : 'TRUE';
    updateMetadata(params, setParts, { hold_reason: null, resumed_project_id: projectId, resumed_by: actorUserId, resumed_at: new Date().toISOString() });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(`COALESCE(t.status,'pending') = 'on_hold'`, activeAssigneeGuard).join(' AND ')}`, params);
  }

  if (status === 'completed') {
    const params = [orgId, projectId, 'cancelled'];
    const setParts = ['status = $3'];
    updateMetadata(params, setParts, { cancelled_reason: 'project_completed', cancelled_project_id: projectId, cancelled_by: actorUserId, cancelled_at: new Date().toISOString() });
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${conditions.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }
}

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
    if (!requestedStatus) return next();
    if (!['active', 'paused', 'completed'].includes(requestedStatus)) return res.status(400).json({ error: 'Invalid status' });

    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const projectId = String(req.params.projectId || '').trim();
    const existing = await projectExists(orgId, projectId);
    if (!existing) return res.status(404).json({ error: 'Project not found in canonical projects table.' });

    const activeTaskCount = await countActiveTasks(orgId, projectId);
    if (requestedStatus === 'completed' && activeTaskCount > 0 && req.body.override_completion !== true) {
      return res.status(409).json({ error: `Cannot complete project: ${activeTaskCount} active task(s) still require resolution.`, code: 'PROJECT_HAS_ACTIVE_TASKS', activeTaskCount });
    }
    if (requestedStatus === 'completed' && activeTaskCount > 0) {
      const role = String(req.user?.role || '').toLowerCase();
      if (!['admin', 'director'].includes(role)) return res.status(403).json({ error: 'Only Admin or Director can override completion with active tasks.' });
      const reason = String(req.body.override_reason || req.body.reason || '').trim();
      if (reason.length < 8) return res.status(400).json({ error: 'override_reason is required and must be at least 8 characters.' });
    }

    const project = await withTransaction(async (tx) => {
      const cols = await getColumns('projects');
      if (!cols.has('status')) throw Object.assign(new Error('projects.status column is required for status changes.'), { statusCode: 500 });
      const setParts = ['status = $1'];
      const params = [requestedStatus];
      if (cols.has('updated_by')) { params.push(req.user.id); setParts.push(`updated_by = $${params.length}`); }
      if (cols.has('updated_at')) setParts.push('updated_at = NOW()');
      params.push(orgId, projectId);
      const { rows } = await tx.query(
        `UPDATE projects SET ${setParts.join(', ')} WHERE org_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at, 'projects'::text AS source_store`,
        params
      );
      if (!rows.length) throw Object.assign(new Error('Project not found'), { statusCode: 404 });
      await mutateTasksForStatus(tx, { orgId, projectId, status: requestedStatus, actorUserId: req.user.id });
      return rows[0];
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId, projectName: project.name, newStatus: requestedStatus, activeTaskCount, canonical: true } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: projectId, metadata: { newStatus: requestedStatus, projectName: project.name, activeTaskCount, canonical: true, override_reason: req.body.override_reason || req.body.reason || null }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ project, affectedActiveTasks: activeTaskCount });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
