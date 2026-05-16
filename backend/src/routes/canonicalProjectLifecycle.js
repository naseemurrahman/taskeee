'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');
const { logUserActivity } = require('../services/activityService');
const { emitNotification, notifyOrgLeaders } = require('../services/notificationService');

const router = express.Router();
const columnsCache = new Map();
const PROJECT_LIFECYCLE_NOTIFICATION_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.PROJECT_LIFECYCLE_NOTIFICATION_CONCURRENCY || '10', 10) || 10
);

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

function normalizeIdentifiers(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function lowerIdentifiers(values) {
  return normalizeIdentifiers(values).map((value) => value.toLowerCase());
}

async function lockCanonicalProjectByIdentifier(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = lowerIdentifiers(exact);
  const { rows } = await tx.query(
    `SELECT id, name
       FROM projects
      WHERE org_id = $1
        AND (id::text = ANY($2::text[]) OR LOWER(name) = ANY($3::text[]))
      ORDER BY CASE WHEN id::text = ANY($2::text[]) THEN 0 ELSE 1 END
      LIMIT 1
      FOR UPDATE`,
    [orgId, exact, lower]
  );
  return rows[0] || null;
}

async function getLegacyCategoryForProjectIdentifier(tx, orgId, identifiers) {
  try {
    const exact = normalizeIdentifiers(identifiers);
    if (!exact.length) return null;
    const lower = lowerIdentifiers(exact);
    const cols = await getColumns('task_categories');
    if (!cols.size) return null;
    const selectParts = [
      'tc.id',
      'tc.org_id',
      'tc.name',
      cols.has('description') ? 'tc.description' : 'NULL::text AS description',
      cols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at',
      cols.has('status') ? "COALESCE(tc.status, 'active') AS status" : "'active' AS status",
      cols.has('is_active') ? 'COALESCE(tc.is_active, TRUE) AS is_active' : 'TRUE AS is_active',
    ];
    const { rows } = await tx.query(
      `SELECT ${selectParts.join(', ')}
         FROM task_categories tc
        WHERE tc.org_id = $1
          AND (tc.id::text = ANY($2::text[]) OR LOWER(tc.name) = ANY($3::text[]))
        ORDER BY CASE WHEN tc.id::text = ANY($2::text[]) THEN 0 ELSE 1 END
        LIMIT 1`,
      [orgId, exact, lower]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function backfillCanonicalProjectFromLegacyCategory(tx, orgId, identifiers, actorUserId) {
  const legacy = await getLegacyCategoryForProjectIdentifier(tx, orgId, identifiers);
  if (!legacy) return null;

  const projectCols = await getColumns('projects');
  if (!projectCols.has('id') || !projectCols.has('org_id') || !projectCols.has('name')) return null;

  const status = legacy.status || (legacy.is_active ? 'active' : 'completed');
  const fields = ['id', 'org_id', 'name'];
  const values = [legacy.id, orgId, legacy.name];
  if (projectCols.has('description')) { fields.push('description'); values.push(legacy.description || null); }
  if (projectCols.has('status')) { fields.push('status'); values.push(status); }
  if (projectCols.has('created_by')) { fields.push('created_by'); values.push(actorUserId || null); }
  if (projectCols.has('updated_by')) { fields.push('updated_by'); values.push(actorUserId || null); }
  if (projectCols.has('created_at')) { fields.push('created_at'); values.push(legacy.created_at || new Date()); }
  if (projectCols.has('updated_at')) { fields.push('updated_at'); values.push(new Date()); }
  if (projectCols.has('metadata')) {
    fields.push('metadata');
    values.push(JSON.stringify({ legacy_task_category_id: legacy.id, legacy_task_category_name: legacy.name, backfilled_from: 'task_categories', backfilled_by_route: 'canonicalProjectLifecycle' }));
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await tx.query(
    `INSERT INTO projects (${fields.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO NOTHING`,
    values
  );

  const locked = await lockCanonicalProjectByIdentifier(tx, orgId, [legacy.id, legacy.name]);
  if (!locked) return null;

  const taskCols = await getColumns('tasks');
  if (taskCols.has('project_id') && taskCols.has('category_id')) {
    const conditions = ['org_id = $1', 'category_id = $2', '(project_id IS NULL OR project_id = $3)'];
    if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
    await tx.query(
      `UPDATE tasks
          SET project_id = $3${taskCols.has('updated_at') ? ', updated_at = NOW()' : ''}
        WHERE ${conditions.join(' AND ')}`,
      [orgId, legacy.id, locked.id]
    );
  }

  return locked;
}

async function lockProjectForLifecycle(tx, orgId, identifiers, actorUserId) {
  try {
    const candidateIdentifiers = normalizeIdentifiers(identifiers);
    const existing = await lockCanonicalProjectByIdentifier(tx, orgId, candidateIdentifiers);
    if (existing) return { project: existing, requestedProjectId: candidateIdentifiers[0], canonicalProjectId: existing.id, resolvedFrom: 'projects' };
    const backfilled = await backfillCanonicalProjectFromLegacyCategory(tx, orgId, candidateIdentifiers, actorUserId);
    if (backfilled) return { project: backfilled, requestedProjectId: candidateIdentifiers[0], canonicalProjectId: backfilled.id, resolvedFrom: 'task_categories_backfill' };
    return null;
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function countActiveTasksWithClient(client, orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('status') || !taskCols.has('project_id')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await client.query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return Number(rows[0]?.cnt || 0);
}

async function getProjectTaskAssignees(orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id') || !taskCols.has('assigned_to')) return [];
  const conditions = ['org_id = $1', 'project_id = $2', 'assigned_to IS NOT NULL'];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  const { rows } = await query(
    `SELECT DISTINCT assigned_to AS user_id
       FROM tasks
      WHERE ${conditions.join(' AND ')}
      ORDER BY assigned_to`,
    [orgId, projectId]
  );
  return rows.map(r => r.user_id).filter(Boolean);
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      if (!item) continue;
      try { await worker(item); } catch { /* non-critical */ }
    }
  });
  await Promise.all(workers);
}

function lifecycleNotificationPayload(project, status, activeTaskCount) {
  const projectName = project.name || project.id;
  if (status === 'paused') {
    return {
      type: 'project_paused',
      title: 'Project paused',
      body: `${projectName} was paused. Active project tasks have been placed on hold.`,
      dedupeKey: `project_paused:project:${project.id}`,
    };
  }
  if (status === 'active') {
    return {
      type: 'project_reactivated',
      title: 'Project reactivated',
      body: `${projectName} was reactivated. Eligible held tasks can continue.`,
      dedupeKey: `project_reactivated:project:${project.id}`,
    };
  }
  return {
    type: 'project_completed',
    title: 'Project completed',
    body: `${projectName} was completed. ${activeTaskCount || 0} active task(s) were resolved by the lifecycle change.`,
    dedupeKey: `project_completed:project:${project.id}`,
  };
}

async function notifyProjectLifecycle({ orgId, project, status, actorUserId, activeTaskCount, overrideReason }) {
  try {
    const base = lifecycleNotificationPayload(project, status, activeTaskCount);
    const data = {
      projectId: project.id,
      projectName: project.name,
      projectStatus: status,
      activeTaskCount,
      actorUserId,
      overrideReason: overrideReason || null,
      dedupeKey: base.dedupeKey,
    };

    await notifyOrgLeaders(orgId, {
      type: base.type,
      title: base.title,
      body: base.body,
      data,
      excludeUserId: actorUserId,
    });

    const assignees = await getProjectTaskAssignees(orgId, project.id);
    const recipients = assignees.filter(userId => !(actorUserId && String(userId) === String(actorUserId)));
    await runWithConcurrency(recipients, PROJECT_LIFECYCLE_NOTIFICATION_CONCURRENCY, async (userId) => {
      await emitNotification(userId, {
        type: base.type,
        title: base.title,
        body: base.body,
        data,
        dedupeKey: base.dedupeKey,
      });
    });
  } catch {
    // Notifications are secondary; lifecycle mutation has already succeeded.
  }
}

function scheduleProjectLifecycleNotifications(payload) {
  setImmediate(() => {
    notifyProjectLifecycle(payload).catch(() => {});
  });
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
    const requestedProjectId = String(req.params.projectId || '').trim();
    const requestedProjectName = String(req.body?.project_name || req.body?.projectName || req.body?.name || '').trim();
    const overrideReason = req.body.override_reason || req.body.reason || null;

    const result = await withTransaction(async (tx) => {
      const locked = await lockProjectForLifecycle(tx, orgId, [requestedProjectId, requestedProjectName], req.user.id);
      if (!locked) throw Object.assign(new Error('Project was not found by id or name in canonical projects or legacy project categories. Run the project backfill SQL and retry.'), { statusCode: 404, code: 'PROJECT_NOT_MIGRATED' });
      const projectId = locked.canonicalProjectId;
      const existing = locked.project;

      const activeTaskCount = await countActiveTasksWithClient(tx, orgId, projectId);
      if (requestedStatus === 'completed' && activeTaskCount > 0 && req.body.override_completion !== true) {
        throw Object.assign(new Error(`Cannot complete project: ${activeTaskCount} active task(s) still require resolution.`), {
          statusCode: 409,
          code: 'PROJECT_HAS_ACTIVE_TASKS',
          activeTaskCount,
        });
      }
      if (requestedStatus === 'completed' && activeTaskCount > 0) {
        const role = String(req.user?.role || '').toLowerCase();
        if (!['admin', 'director'].includes(role)) throw Object.assign(new Error('Only Admin or Director can override completion with active tasks.'), { statusCode: 403 });
        const reason = String(overrideReason || '').trim();
        if (reason.length < 8) throw Object.assign(new Error('override_reason is required and must be at least 8 characters.'), { statusCode: 400 });
      }

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
      return { project: rows[0] || existing, activeTaskCount, requestedProjectId: locked.requestedProjectId, canonicalProjectId: projectId, resolvedFrom: locked.resolvedFrom };
    });

    const { project, activeTaskCount, requestedProjectId: resolvedRequestedProjectId, canonicalProjectId, resolvedFrom } = result;
    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId: canonicalProjectId, requestedProjectId: resolvedRequestedProjectId, requestedProjectName, projectName: project.name, newStatus: requestedStatus, activeTaskCount, canonical: true, resolvedFrom } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: canonicalProjectId, metadata: { requestedProjectId: resolvedRequestedProjectId, requestedProjectName, newStatus: requestedStatus, projectName: project.name, activeTaskCount, canonical: true, resolvedFrom, override_reason: overrideReason }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    scheduleProjectLifecycleNotifications({ orgId, project, status: requestedStatus, actorUserId: req.user.id, activeTaskCount, overrideReason });

    return res.json({ project, affectedActiveTasks: activeTaskCount, requestedProjectId: resolvedRequestedProjectId, requestedProjectName, canonicalProjectId, resolvedFrom });
  } catch (err) {
    if (err.statusCode) {
      const body = { error: err.message };
      if (err.code) body.code = err.code;
      if (typeof err.activeTaskCount === 'number') body.activeTaskCount = err.activeTaskCount;
      return res.status(err.statusCode).json(body);
    }
    next(err);
  }
});

module.exports = router;
