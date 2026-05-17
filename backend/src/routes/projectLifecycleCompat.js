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
  const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tableName]);
  const cols = new Set(rows.map((r) => String(r.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function tableExists(tableName) {
  const { rows } = await query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`, [tableName]);
  return rows.length > 0;
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

function unresolvedTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

function preflightTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
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

function relationSql({ taskCols, hasProjectTasks, ptCols, textArray = true, taskAlias = 't' }) {
  const value = textArray ? 'ANY($2::text[])' : '$2::text';
  const parts = [];
  if (taskCols.has('category_id')) parts.push(`${taskAlias}.category_id::text = ${value}`);
  if (taskCols.has('project_id')) parts.push(`${taskAlias}.project_id::text = ${value}`);
  if (hasProjectTasks && ptCols.has('task_id') && ptCols.has('project_id')) {
    const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
    parts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = ${taskAlias}.id AND pt.project_id::text = ${value}${ptOrgGuard})`);
  }
  return parts;
}

async function relationContext() {
  const taskCols = await getColumns('tasks');
  const hasProjectTasks = await tableExists('project_tasks');
  const ptCols = hasProjectTasks ? await getColumns('project_tasks') : new Set();
  return { taskCols, hasProjectTasks, ptCols };
}

async function findCanonicalProject(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((value) => value.toLowerCase());
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
    if (['42P01', '42703'].includes(err.code)) return null;
    throw err;
  }
}

async function findLegacyCategory(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((value) => value.toLowerCase());
  try {
    const cols = await getColumns('task_categories');
    if (!cols.size) return null;
    const { rows } = await tx.query(
      `SELECT tc.id::text AS id,
              tc.name,
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
    if (['42P01', '42703'].includes(err.code)) return null;
    throw err;
  }
}

async function inferSeedFromRelations(tx, orgId, identifiers, fallbackName) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const ctx = await relationContext();
  const parts = relationSql({ ...ctx, textArray: true });
  if (!parts.length) return null;
  const conditions = ['t.org_id = $1', `(${parts.join(' OR ')})`];
  if (ctx.taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  if (ctx.taskCols.has('status')) conditions.push(preflightTaskCondition('t'));
  const order = ['COUNT(t.id) DESC'];
  if (ctx.taskCols.has('updated_at')) order.push('MAX(t.updated_at) DESC NULLS LAST');
  if (ctx.taskCols.has('created_at')) order.push('MAX(t.created_at) DESC NULLS LAST');
  const { rows } = await tx.query(
    `SELECT COALESCE(NULLIF($3::text, ''), NULLIF($4::text, ''), 'Recovered Project') AS name,
            NOW() AS created_at,
            'active'::text AS status,
            $4::text AS id,
            $4::text AS legacy_relation_id
       FROM tasks t
      WHERE ${conditions.join(' AND ')}
      GROUP BY 1, 4
      ORDER BY ${order.join(', ')}
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
  const canonicalId = isLikelyUuid(seed.id) ? seed.id : randomUUID();
  const fields = ['id', 'org_id', 'name'];
  const values = [canonicalId, orgId, seed.name || seed.id || 'Recovered Project'];
  if (cols.has('description')) { fields.push('description'); values.push(seed.description || null); }
  if (cols.has('status')) { fields.push('status'); values.push(seed.status || 'active'); }
  if (cols.has('created_by')) { fields.push('created_by'); values.push(actorUserId || null); }
  if (cols.has('updated_by')) { fields.push('updated_by'); values.push(actorUserId || null); }
  if (cols.has('created_at')) { fields.push('created_at'); values.push(seed.created_at || new Date()); }
  if (cols.has('updated_at')) { fields.push('updated_at'); values.push(new Date()); }
  if (cols.has('metadata')) {
    fields.push('metadata');
    values.push(JSON.stringify({ recovered_from: 'project_lifecycle_compat', legacy_id: seed.id, legacy_name: seed.name, legacy_relation_id: seed.legacy_relation_id || seed.id }));
  }
  await tx.query(`INSERT INTO projects (${fields.join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`, values);
  return findCanonicalProject(tx, orgId, [canonicalId, seed.id, seed.name]);
}

async function backfillTaskProjectIds(tx, orgId, canonicalId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return;
  const ctx = await relationContext();
  if (!ctx.taskCols.has('project_id')) return;
  const parts = relationSql({ ...ctx, textArray: true, taskAlias: 'tasks' });
  if (!parts.length) return;
  const conditions = ['org_id = $1', `(${parts.join(' OR ')})`];
  if (ctx.taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await tx.query(
    `UPDATE tasks SET project_id = $3${ctx.taskCols.has('updated_at') ? ', updated_at = NOW()' : ''} WHERE ${conditions.join(' AND ')}`,
    [orgId, exact, canonicalId]
  );
}

async function mirrorLegacyProjectStatus(tx, orgId, identifiers, status) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length || !(await tableExists('task_categories'))) return 0;

  await tx.query(`ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);
  columnsCache.delete('task_categories');
  const cols = await getColumns('task_categories');
  if (!cols.has('status')) return 0;

  const lower = exact.map((value) => value.toLowerCase());
  const setParts = ['status = $3'];
  const params = [orgId, exact, status];
  if (cols.has('updated_at')) setParts.push('updated_at = NOW()');

  const { rowCount } = await tx.query(
    `UPDATE task_categories
        SET ${setParts.join(', ')}
      WHERE org_id = $1
        AND (id::text = ANY($2::text[]) OR LOWER(name) = ANY($4::text[]))`,
    [...params, lower]
  );
  return rowCount || 0;
}

async function resolveOrRepairProject(tx, { orgId, identifiers, projectName, actorUserId }) {
  await ensureLifecycleSchema(tx);
  let project = await findCanonicalProject(tx, orgId, identifiers);
  let seed = null;
  let resolvedFrom = 'projects';
  if (!project) {
    seed = await findLegacyCategory(tx, orgId, identifiers) || await inferSeedFromRelations(tx, orgId, identifiers, projectName);
    project = await ensureCanonicalProject(tx, orgId, seed, actorUserId);
    resolvedFrom = seed ? 'preflight_or_lifecycle_relation_backfill' : 'unresolved';
  }
  if (!project) return null;
  const relationIdentifiers = normalizeIdentifiers([project.id, project.name, ...identifiers, seed?.id, seed?.legacy_relation_id, seed?.name]);
  await backfillTaskProjectIds(tx, orgId, project.id, relationIdentifiers);
  return { project, resolvedFrom, relationIdentifiers };
}

async function countActiveTasks(tx, orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', activeTaskCondition('t')];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await tx.query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return Number(rows[0]?.cnt || 0);
}

async function countUnresolvedTasksForCompletion(tx, orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', unresolvedTaskCondition('t')];
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

router.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });
    const projectId = String(req.params.projectId || '').trim();
    const projectName = String(req.query?.project_name || req.query?.projectName || '').trim();
    const identifiers = normalizeIdentifiers([projectId, projectName]);
    const ctx = await relationContext();
    const parts = relationSql({ ...ctx, textArray: true });
    if (!parts.length) return res.json({ tasks: [] });
    const conditions = ['t.org_id = $1', `(${parts.join(' OR ')})`];
    if (ctx.taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (ctx.taskCols.has('status')) conditions.push(preflightTaskCondition('t'));
    const assigneeJoin = ctx.taskCols.has('assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : '';
    const assigneeSel = ctx.taskCols.has('assigned_to') ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name` : `'Unassigned' AS assignee_name`;
    const prioritySel = ctx.taskCols.has('priority') ? 't.priority' : 'NULL::text AS priority';
    const dueSel = ctx.taskCols.has('due_date') ? 't.due_date' : 'NULL::timestamptz AS due_date';
    const orderBy = ctx.taskCols.has('created_at') ? 't.created_at DESC' : 't.id DESC';
    const { rows } = await query(
      `SELECT t.id, t.title, COALESCE(t.status,'pending') AS status, ${prioritySel}, ${dueSel}, ${assigneeSel}
         FROM tasks t ${assigneeJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT 50`,
      [orgId, identifiers]
    );
    let repair = null;
    if (rows.length > 0) {
      repair = await withTransaction((tx) => resolveOrRepairProject(tx, { orgId, identifiers, projectName, actorUserId: req.user.id })).catch(() => null);
    }
    return res.json({ tasks: rows, meta: { projectId, projectName, canonicalProjectId: repair?.project?.id || null, canonicalProjectName: repair?.project?.name || null, resolvedFrom: repair?.resolvedFrom || null } });
  } catch (err) { next(err); }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
  if (!status) return next();
  if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const projectId = String(req.params.projectId || '').trim();
    const projectName = String(req.body?.project_name || req.body?.projectName || req.body?.name || '').trim();
    const identifiers = normalizeIdentifiers([projectId, projectName]);
    const result = await withTransaction(async (tx) => {
      const resolved = await resolveOrRepairProject(tx, { orgId, identifiers, projectName, actorUserId: req.user.id });
      if (!resolved?.project) throw Object.assign(new Error('Project was not found by lifecycle/preflight resolver.'), { statusCode: 404, code: 'PROJECT_NOT_MIGRATED', identifiers });
      const activeTaskCount = await countActiveTasks(tx, orgId, resolved.project.id);
      if (status === 'completed') {
        const unresolvedTaskCount = await countUnresolvedTasksForCompletion(tx, orgId, resolved.project.id);
        if (unresolvedTaskCount > 0) {
          throw Object.assign(new Error(`Complete or cancel ${unresolvedTaskCount} task(s) before completing this project.`), {
            statusCode: 409,
            code: 'PROJECT_HAS_UNRESOLVED_TASKS',
            activeTaskCount: unresolvedTaskCount,
          });
        }
      }
      const cols = await getColumns('projects');
      const setParts = ['status = $1'];
      const params = [status];
      if (cols.has('updated_by')) { params.push(req.user.id); setParts.push(`updated_by = $${params.length}`); }
      if (cols.has('updated_at')) setParts.push('updated_at = NOW()');
      params.push(orgId, resolved.project.id);
      const { rows } = await tx.query(
        `UPDATE projects SET ${setParts.join(', ')} WHERE org_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at, 'projects'::text AS source_store`,
        params
      );
      const mirroredLegacyRows = await mirrorLegacyProjectStatus(tx, orgId, resolved.relationIdentifiers, status);
      await mutateTasksForStatus(tx, orgId, resolved.project.id, status, req.user.id);
      return { project: rows[0] || resolved.project, activeTaskCount, resolvedFrom: resolved.resolvedFrom, mirroredLegacyRows };
    });
    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId: result.project.id, projectName: result.project.name, newStatus: status, activeTaskCount: result.activeTaskCount, resolvedFrom: result.resolvedFrom, mirroredLegacyRows: result.mirroredLegacyRows } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: result.project.id, metadata: { projectName: result.project.name, newStatus: status, activeTaskCount: result.activeTaskCount, resolvedFrom: result.resolvedFrom, mirroredLegacyRows: result.mirroredLegacyRows, requestedProjectId: projectId, requestedProjectName: projectName }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }
    return res.json({ project: result.project, affectedActiveTasks: result.activeTaskCount, canonicalProjectId: result.project.id, requestedProjectId: projectId, requestedProjectName: projectName, resolvedFrom: result.resolvedFrom, mirroredLegacyRows: result.mirroredLegacyRows });
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
