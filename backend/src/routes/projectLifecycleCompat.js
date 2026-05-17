'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
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

async function ensureLifecycleSchema(tx) {
  await tx.query(`CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY,
    org_id uuid NULL,
    name text NULL,
    description text NULL,
    status varchar(20) NOT NULL DEFAULT 'active',
    created_by uuid NULL,
    updated_by uuid NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    updated_at timestamptz NOT NULL DEFAULT NOW()
  )`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id uuid NULL`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS name text NULL`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text NULL`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active'`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by uuid NULL`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by uuid NULL`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW()`);
  await tx.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()`);
  await tx.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid NULL`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects(org_id, status)`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_projects_org_name ON projects(org_id, lower(name))`);
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_tasks_org_project ON tasks(org_id, project_id)`);
  columnsCache.delete('projects');
  columnsCache.delete('tasks');
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

function isLikelyUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function activeTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled','on_hold')`;
}

function preflightActiveTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

function quotedIdExpr(taskCols) {
  const parts = [];
  if (taskCols.has('category_id')) parts.push('t.category_id::text');
  if (taskCols.has('project_id')) parts.push('t.project_id::text');
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`;
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
    if (err.code === '42P01' || err.code === '42703') return null;
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
      `SELECT tc.id::text AS id, tc.org_id, tc.name,
              ${cols.has('description') ? 'tc.description' : 'NULL::text AS description'},
              ${cols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at'},
              ${cols.has('status') ? "COALESCE(tc.status, 'active')" : "'active'"} AS status,
              tc.id::text AS legacy_relation_id
         FROM task_categories tc
        WHERE tc.org_id = $1
          AND (tc.id::text = ANY($2::text[]) OR LOWER(tc.name) = ANY($3::text[]))
        ORDER BY CASE WHEN tc.id::text = ANY($2::text[]) THEN 0 ELSE 1 END
        LIMIT 1`,
      [orgId, exact, lower]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return null;
    throw err;
  }
}

async function inferProjectSeedFromTasks(tx, orgId, ids, fallbackName) {
  const exact = normalizeIdentifiers(ids);
  if (!exact.length) return null;
  const taskCols = await getColumns('tasks');
  const idExpr = quotedIdExpr(taskCols);
  if (!idExpr) return null;
  const relationParts = [];
  if (taskCols.has('category_id')) relationParts.push('t.category_id::text = ANY($2::text[])');
  if (taskCols.has('project_id')) relationParts.push('t.project_id::text = ANY($2::text[])');
  if (!relationParts.length) return null;
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`, `${idExpr} IS NOT NULL`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const orderParts = ['COUNT(t.id) DESC'];
  if (taskCols.has('updated_at')) orderParts.push('MAX(t.updated_at) DESC NULLS LAST');
  if (taskCols.has('created_at')) orderParts.push('MAX(t.created_at) DESC NULLS LAST');
  const { rows } = await tx.query(
    `SELECT ${idExpr} AS id,
            t.org_id,
            COALESCE(NULLIF($3::text, ''), NULLIF($4::text, ''), 'Recovered Project') AS name,
            NULL::text AS description,
            NOW() AS created_at,
            'active'::text AS status,
            ${idExpr} AS legacy_relation_id
       FROM tasks t
      WHERE ${conditions.join(' AND ')}
      GROUP BY ${idExpr}, t.org_id
      ORDER BY ${orderParts.join(', ')}
      LIMIT 1`,
    [orgId, exact, fallbackName || '', exact[0] || '']
  );
  return rows[0] || null;
}

async function inferProjectSeedFromBridge(tx, orgId, ids, fallbackName) {
  const exact = normalizeIdentifiers(ids);
  if (!exact.length) return null;
  const ptCols = await getColumns('project_tasks');
  if (!ptCols.has('project_id') || !ptCols.has('task_id')) return null;
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('id')) return null;

  const conditions = ['pt.project_id::text = ANY($2::text[])'];
  if (ptCols.has('org_id')) conditions.push('pt.org_id = $1');
  if (taskCols.has('org_id')) conditions.push('t.org_id = $1');
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const orderParts = ['COUNT(t.id) DESC'];
  if (taskCols.has('updated_at')) orderParts.push('MAX(t.updated_at) DESC NULLS LAST');
  if (taskCols.has('created_at')) orderParts.push('MAX(t.created_at) DESC NULLS LAST');
  const orgSelect = taskCols.has('org_id') ? 't.org_id' : (ptCols.has('org_id') ? 'pt.org_id' : '$1::uuid');

  try {
    const { rows } = await tx.query(
      `SELECT pt.project_id::text AS id,
              ${orgSelect} AS org_id,
              COALESCE(NULLIF($3::text, ''), NULLIF($4::text, ''), 'Recovered Project') AS name,
              NULL::text AS description,
              NOW() AS created_at,
              'active'::text AS status,
              pt.project_id::text AS legacy_relation_id
         FROM project_tasks pt
         JOIN tasks t ON t.id = pt.task_id
        WHERE ${conditions.join(' AND ')}
        GROUP BY pt.project_id, ${orgSelect}
        ORDER BY ${orderParts.join(', ')}
        LIMIT 1`,
      [orgId, exact, fallbackName || '', exact[0] || '']
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return null;
    throw err;
  }
}

async function inferProjectSeedFromActiveTaskLookup(tx, orgId, ids, fallbackName) {
  const exact = normalizeIdentifiers(ids);
  const requestedId = exact[0];
  if (!requestedId) return null;
  const taskCols = await getColumns('tasks');
  const relationParts = [];
  if (taskCols.has('category_id')) relationParts.push('t.category_id = $2');
  if (taskCols.has('project_id')) relationParts.push('t.project_id = $2');
  const ptCols = await getColumns('project_tasks');
  if (ptCols.has('project_id') && ptCols.has('task_id')) {
    const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
    relationParts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id = $2${ptOrgGuard})`);
  }
  if (!relationParts.length) return null;
  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  if (taskCols.has('status')) conditions.push(preflightActiveTaskCondition('t'));

  try {
    const { rows } = await tx.query(
      `SELECT COUNT(DISTINCT t.id)::int AS cnt
         FROM tasks t
        WHERE ${conditions.join(' AND ')}`,
      [orgId, requestedId]
    );
    if (Number(rows[0]?.cnt || 0) <= 0) return null;
    return {
      id: requestedId,
      org_id: orgId,
      name: fallbackName || requestedId,
      description: null,
      created_at: new Date(),
      status: 'active',
      legacy_relation_id: requestedId,
    };
  } catch (err) {
    // This fallback deliberately mirrors the legacy active-tasks route. If a
    // specific database casts the incoming id differently, ignore the failed
    // probe and let the normal controlled 404 path respond.
    if (['22P02', '42883', '42P01', '42703'].includes(err.code)) return null;
    throw err;
  }
}

async function ensureCanonicalProject(tx, orgId, seed, actorUserId) {
  if (!seed) return null;
  const existing = await findCanonicalProject(tx, orgId, [seed.id, seed.name]);
  if (existing) return existing;

  const cols = await getColumns('projects');
  if (!cols.has('id') || !cols.has('org_id') || !cols.has('name')) return null;

  const canonicalId = isLikelyUuid(seed.id) ? seed.id : randomUUID();
  const fields = ['id', 'org_id', 'name'];
  const values = [canonicalId, orgId, seed.name];
  if (cols.has('description')) { fields.push('description'); values.push(seed.description || null); }
  if (cols.has('status')) { fields.push('status'); values.push(seed.status || 'active'); }
  if (cols.has('created_by')) { fields.push('created_by'); values.push(actorUserId || null); }
  if (cols.has('updated_by')) { fields.push('updated_by'); values.push(actorUserId || null); }
  if (cols.has('created_at')) { fields.push('created_at'); values.push(seed.created_at || new Date()); }
  if (cols.has('updated_at')) { fields.push('updated_at'); values.push(new Date()); }
  if (cols.has('metadata')) {
    fields.push('metadata');
    values.push(JSON.stringify({
      recovered_from: 'legacy_project_lifecycle_compat',
      legacy_id: seed.id,
      legacy_name: seed.name,
      legacy_relation_id: seed.legacy_relation_id || seed.id,
    }));
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  await tx.query(`INSERT INTO projects (${fields.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`, values);
  return findCanonicalProject(tx, orgId, [canonicalId, seed.name]);
}

async function backfillTaskProjectIds(tx, orgId, canonicalId, ids) {
  const exact = normalizeIdentifiers(ids);
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id') || !exact.length) return;

  const relationParts = ['project_id::text = ANY($2::text[])'];
  if (taskCols.has('category_id')) relationParts.push('category_id::text = ANY($2::text[])');
  const ptCols = await getColumns('project_tasks');
  if (ptCols.has('project_id') && ptCols.has('task_id')) {
    const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
    relationParts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = tasks.id AND pt.project_id::text = ANY($2::text[])${ptOrgGuard})`);
  }
  const conditions = ['org_id = $1', `(${relationParts.join(' OR ')})`];
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
    if (taskCols.has('metadata')) {
      params.push(JSON.stringify(obj));
      setParts.push(`metadata = COALESCE(t.metadata::jsonb, '{}'::jsonb) || $${params.length}::jsonb`);
    }
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
      await ensureLifecycleSchema(tx);
      let project = await findCanonicalProject(tx, orgId, identifiers);
      let resolvedFrom = 'projects';
      let seed = null;
      if (!project) {
        seed = await findLegacyCategory(tx, orgId, identifiers)
          || await inferProjectSeedFromTasks(tx, orgId, identifiers, requestedProjectName)
          || await inferProjectSeedFromBridge(tx, orgId, identifiers, requestedProjectName)
          || await inferProjectSeedFromActiveTaskLookup(tx, orgId, identifiers, requestedProjectName);
        project = await ensureCanonicalProject(tx, orgId, seed, req.user.id);
        resolvedFrom = seed ? 'legacy_task_bridge_or_active_lookup_backfill' : 'unresolved';
      }
      if (!project) {
        throw Object.assign(new Error('Project was not found by the same resolver used for active-task preflight.'), { statusCode: 404, code: 'PROJECT_NOT_MIGRATED', identifiers });
      }

      const relationIdentifiers = normalizeIdentifiers([project.id, project.name, ...(identifiers || []), seed?.id, seed?.legacy_relation_id, seed?.name]);
      await backfillTaskProjectIds(tx, orgId, project.id, relationIdentifiers);
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
