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
  const cols = new Set(rows.map((r) => String(r.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
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

function activeTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled','on_hold')`;
}

async function findCanonicalProject(tx, orgId, ids) {
  const exact = normalizeIdentifiers(ids);
  if (!exact.length) return null;
  const lower = exact.map((v) => v.toLowerCase());
  try {
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
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function findLegacyCategory(tx, orgId, ids) {
  const exact = normalizeIdentifiers(ids);
  if (!exact.length) return null;
  const lower = exact.map((v) => v.toLowerCase());
  try {
    const cols = await getColumns('task_categories');
    if (!cols.size) return null;
    const { rows } = await tx.query(
      `SELECT tc.id, tc.org_id, tc.name,
              ${cols.has('description') ? 'tc.description' : 'NULL::text AS description'},
              ${cols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at'},
              ${cols.has('status') ? "COALESCE(tc.status, 'active')" : "'active'"} AS status
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

async function inferProjectSeedFromTasks(tx, orgId, ids, fallbackName) {
  const exact = normalizeIdentifiers(ids);
  if (!exact.length) return null;
  const taskCols = await getColumns('tasks');
  const idParts = [];
  const relationParts = [];
  if (taskCols.has('category_id')) {
    idParts.push('t.category_id');
    relationParts.push('t.category_id::text = ANY($2::text[])');
  }
  if (taskCols.has('project_id')) {
    idParts.push('t.project_id');
    relationParts.push('t.project_id::text = ANY($2::text[])');
  }
  if (!idParts.length || !relationParts.length) return null;
  const idExpr = idParts.length === 1 ? idParts[0] : `COALESCE(${idParts.join(', ')})`;
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`, `${idExpr} IS NOT NULL`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await tx.query(
    `SELECT ${idExpr} AS id,
            t.org_id,
            COALESCE(NULLIF($3::text, ''), NULLIF($4::text, ''), 'Recovered Project') AS name,
            NULL::text AS description,
            NOW() AS created_at,
            'active'::text AS status
       FROM tasks t
      WHERE ${conditions.join(' AND ')}
      GROUP BY ${idExpr}, t.org_id
      ORDER BY COUNT(t.id) DESC, MAX(t.updated_at) DESC NULLS LAST, MAX(t.created_at) DESC NULLS LAST
      LIMIT 1`,
    [orgId, exact, fallbackName || '', exact[0] || '']
  );
  return rows[0] || null;
}

async function ensureCanonicalProject(tx, orgId, seed, actorUserId) {
  if (!seed) return null;
  const existing = await findCanonicalProject(tx, orgId, [seed.id, seed.name]);
  if (existing) return existing;
  const cols = await getColumns('projects');
  if (!cols.has('id') || !cols.has('org_id') || !cols.has('name')) return null;
  const fields = ['id', 'org_id', 'name'];
  const values = [seed.id, orgId, seed.name];
  if (cols.has('description')) { fields.push('description'); values.push(seed.description || null); }
  if (cols.has('status')) { fields.push('status'); values.push(seed.status || 'active'); }
  if (cols.has('created_by')) { fields.push('created_by'); values.push(actorUserId || null); }
  if (cols.has('updated_by')) { fields.push('updated_by'); values.push(actorUserId || null); }
  if (cols.has('created_at')) { fields.push('created_at'); values.push(seed.created_at || new Date()); }
  if (cols.has('updated_at')) { fields.push('updated_at'); values.push(new Date()); }
  if (cols.has('metadata')) { fields.push('metadata'); values.push(JSON.stringify({ recovered_from: 'legacy_project_lifecycle_compat', legacy_id: seed.id, legacy_name: seed.name })); }
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await tx.query(`INSERT INTO projects (${fields.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values);
  return findCanonicalProject(tx, orgId, [seed.id, seed.name]);
}

async function backfillTaskProjectIds(tx, orgId, canonicalId, ids) {
  const exact = normalizeIdentifiers([canonicalId, ...(ids || [])]);
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id')) return;
  const relationParts = ['project_id::text = ANY($2::text[])'];
  if (taskCols.has('category_id')) relationParts.push('category_id::text = ANY($2::text[])');
  const conditions = ['org_id = $1', `(${relationParts.join(' OR ')} OR project_id IS NULL)`];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await tx.query(
    `UPDATE tasks
        SET project_id = $3${taskCols.has('updated_at') ? ', updated_at = NOW()' : ''}
      WHERE ${conditions.join(' AND ')}`,
    [orgId, exact, canonicalId]
  );
}

async function countActiveTasks(tx, orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await tx.query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return Number(rows[0]?.cnt || 0);
}

async function mutateTasksForStatus(tx, orgId, projectId, status, actorUserId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id') || !taskCols.has('status')) return;
  const base = ['t.org_id = $1', 't.project_id = $2'];
  if (taskCols.has('deleted_at')) base.push('t.deleted_at IS NULL');
  const metadata = (obj, params, setParts) => {
    if (taskCols.has('updated_at')) setParts.push('updated_at = NOW()');
    if (taskCols.has('metadata')) { params.push(JSON.stringify(obj)); setParts.push(`metadata = COALESCE(t.metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`); }
  };
  if (status === 'paused') {
    const params = [orgId, projectId, 'on_hold'];
    const setParts = ['status = $3'];
    metadata({ hold_reason: 'project_paused', hold_project_id: projectId, held_by: actorUserId, held_at: new Date().toISOString() }, params, setParts);
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${base.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  } else if (status === 'active') {
    const params = [orgId, projectId, 'pending'];
    const setParts = ['status = $3'];
    metadata({ hold_reason: null, resumed_project_id: projectId, resumed_by: actorUserId, resumed_at: new Date().toISOString() }, params, setParts);
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${base.concat("COALESCE(t.status,'pending') = 'on_hold'").join(' AND ')}`, params);
  } else if (status === 'completed') {
    const params = [orgId, projectId, 'cancelled'];
    const setParts = ['status = $3'];
    metadata({ cancelled_reason: 'project_completed', cancelled_project_id: projectId, cancelled_by: actorUserId, cancelled_at: new Date().toISOString() }, params, setParts);
    await tx.query(`UPDATE tasks t SET ${setParts.join(', ')} WHERE ${base.concat(activeTaskCondition('t')).join(' AND ')}`, params);
  }
}

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
  if (!status) return next();
  if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const requestedProjectId = String(req.params.projectId || '').trim();
    const requestedProjectName = String(req.body?.project_name || req.body?.projectName || req.body?.name || '').trim();
    const identifiers = normalizeIdentifiers([requestedProjectId, requestedProjectName]);

    const result = await withTransaction(async (tx) => {
      let project = await findCanonicalProject(tx, orgId, identifiers);
      let resolvedFrom = 'projects';
      if (!project) {
        const seed = await findLegacyCategory(tx, orgId, identifiers) || await inferProjectSeedFromTasks(tx, orgId, identifiers, requestedProjectName);
        project = await ensureCanonicalProject(tx, orgId, seed, req.user.id);
        resolvedFrom = seed ? 'legacy_or_task_relation_backfill' : 'unresolved';
      }
      if (!project) {
        throw Object.assign(new Error('Project was not found in canonical projects, legacy categories, or task relations.'), { statusCode: 404, code: 'PROJECT_NOT_MIGRATED', identifiers });
      }
      await backfillTaskProjectIds(tx, orgId, project.id, identifiers);
      const activeTaskCount = await countActiveTasks(tx, orgId, project.id);
      if (status === 'completed' && activeTaskCount > 0 && req.body.override_completion !== true) {
        throw Object.assign(new Error(`Cannot complete project: ${activeTaskCount} active task(s) still require resolution.`), { statusCode: 409, code: 'PROJECT_HAS_ACTIVE_TASKS', activeTaskCount });
      }
      if (status === 'completed' && activeTaskCount > 0) {
        const role = String(req.user?.role || '').toLowerCase();
        if (!['admin', 'director'].includes(role)) throw Object.assign(new Error('Only Admin or Director can override completion with active tasks.'), { statusCode: 403 });
        const reason = String(req.body.override_reason || req.body.reason || '').trim();
        if (reason.length < 8) throw Object.assign(new Error('override_reason is required and must be at least 8 characters.'), { statusCode: 400 });
      }
      const cols = await getColumns('projects');
      const setParts = ['status = $1'];
      const params = [status];
      if (cols.has('updated_by')) { params.push(req.user.id); setParts.push(`updated_by = $${params.length}`); }
      if (cols.has('updated_at')) setParts.push('updated_at = NOW()');
      params.push(orgId, project.id);
      const { rows } = await tx.query(
        `UPDATE projects SET ${setParts.join(', ')} WHERE org_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at, 'projects'::text AS source_store`,
        params
      );
      await mutateTasksForStatus(tx, orgId, project.id, status, req.user.id);
      return { project: rows[0] || project, activeTaskCount, resolvedFrom };
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId: result.project.id, projectName: result.project.name, newStatus: status, activeTaskCount: result.activeTaskCount, resolvedFrom: result.resolvedFrom } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: result.project.id, metadata: { projectName: result.project.name, newStatus: status, activeTaskCount: result.activeTaskCount, resolvedFrom: result.resolvedFrom, requestedProjectId, requestedProjectName }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ project: result.project, affectedActiveTasks: result.activeTaskCount, canonicalProjectId: result.project.id, requestedProjectId, requestedProjectName, resolvedFrom: result.resolvedFrom });
  } catch (err) {
    if (err.statusCode) {
      const body = { error: err.message };
      if (err.code) body.code = err.code;
      if (err.identifiers) body.identifiers = err.identifiers;
      if (typeof err.activeTaskCount === 'number') body.activeTaskCount = err.activeTaskCount;
      return res.status(err.statusCode).json(body);
    }
    next(err);
  }
});

module.exports = router;
