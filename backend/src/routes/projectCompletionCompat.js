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
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const cols = new Map(rows.map((row) => [String(row.column_name), row]));
  columnsCache.set(tableName, cols);
  return cols;
}

async function tableExists(tableName) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
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

function unresolvedTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

async function ensureSchema(tx) {
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
  await tx.query(`CREATE INDEX IF NOT EXISTS idx_tasks_org_project ON tasks(org_id, project_id)`);
  columnsCache.delete('projects');
  columnsCache.delete('tasks');
}

async function findCanonicalProject(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((value) => value.toLowerCase());
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

async function findLegacyCategory(tx, orgId, identifiers) {
  if (!(await tableExists('task_categories'))) return null;
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((value) => value.toLowerCase());
  const cols = await getColumns('task_categories');
  if (!cols.has('id') || !cols.has('org_id') || !cols.has('name')) return null;
  const { rows } = await tx.query(
    `SELECT tc.id::text AS id,
            tc.name,
            ${cols.has('description') ? 'tc.description' : 'NULL::text AS description'},
            ${cols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at'},
            'active'::text AS status,
            tc.id::text AS legacy_relation_id
       FROM task_categories tc
      WHERE tc.org_id = $1
        AND (tc.id::text = ANY($2::text[]) OR LOWER(tc.name) = ANY($3::text[]))
      ORDER BY CASE WHEN tc.id::text = ANY($2::text[]) THEN 0 ELSE 1 END
      LIMIT 1`,
    [orgId, exact, lower]
  );
  return rows[0] || null;
}

async function ensureCanonicalProject(tx, orgId, seed, actorUserId) {
  if (!seed) return null;
  const existing = await findCanonicalProject(tx, orgId, [seed.id, seed.name]);
  if (existing) return existing;
  const cols = await getColumns('projects');
  const canonicalId = isLikelyUuid(seed.id) ? seed.id : randomUUID();
  const fields = ['id', 'org_id', 'name'];
  const values = [canonicalId, orgId, seed.name || seed.id || 'Recovered Project'];
  if (cols.has('description')) { fields.push('description'); values.push(seed.description || null); }
  if (cols.has('status')) { fields.push('status'); values.push('active'); }
  if (cols.has('created_by')) { fields.push('created_by'); values.push(actorUserId || null); }
  if (cols.has('updated_by')) { fields.push('updated_by'); values.push(actorUserId || null); }
  if (cols.has('created_at')) { fields.push('created_at'); values.push(seed.created_at || new Date()); }
  if (cols.has('updated_at')) { fields.push('updated_at'); values.push(new Date()); }
  if (cols.has('metadata')) {
    fields.push('metadata');
    values.push(JSON.stringify({ recovered_from: 'project_completion_compat', legacy_id: seed.id, legacy_name: seed.name }));
  }
  await tx.query(
    `INSERT INTO projects (${fields.join(', ')}) VALUES (${values.map((_, idx) => `$${idx + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    values
  );
  return findCanonicalProject(tx, orgId, [canonicalId, seed.id, seed.name]);
}

async function relationContext() {
  const taskCols = await getColumns('tasks');
  const hasProjectTasks = await tableExists('project_tasks');
  const ptCols = hasProjectTasks ? await getColumns('project_tasks') : new Map();
  return { taskCols, hasProjectTasks, ptCols };
}

function relationParts(ctx, alias = 't') {
  const parts = [];
  if (ctx.taskCols.has('project_id')) parts.push(`${alias}.project_id::text = ANY($2::text[])`);
  if (ctx.taskCols.has('category_id')) parts.push(`${alias}.category_id::text = ANY($2::text[])`);
  if (ctx.hasProjectTasks && ctx.ptCols.has('task_id') && ctx.ptCols.has('project_id')) {
    const ptOrgGuard = ctx.ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
    parts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = ${alias}.id AND pt.project_id::text = ANY($2::text[])${ptOrgGuard})`);
  }
  return parts;
}

async function backfillTaskProjectIds(tx, orgId, canonicalId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return;
  const ctx = await relationContext();
  if (!ctx.taskCols.has('project_id')) return;
  const parts = relationParts(ctx, 'tasks');
  if (!parts.length) return;
  const conditions = ['org_id = $1', `(${parts.join(' OR ')})`];
  if (ctx.taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await tx.query(
    `UPDATE tasks SET project_id = $3${ctx.taskCols.has('updated_at') ? ', updated_at = NOW()' : ''} WHERE ${conditions.join(' AND ')}`,
    [orgId, exact, canonicalId]
  );
}

async function countUnresolvedTasks(tx, orgId, projectId) {
  const cols = await getColumns('tasks');
  if (!cols.has('project_id') || !cols.has('status')) return 0;
  const conditions = ['t.org_id = $1', 't.project_id = $2', unresolvedTaskCondition('t')];
  if (cols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await tx.query(
    `SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`,
    [orgId, projectId]
  );
  return Number(rows[0]?.cnt || 0);
}

async function safeMirrorLegacyStatus(tx, orgId, identifiers, status) {
  try {
    if (!(await tableExists('task_categories'))) return { rows: 0, skipped: false };
    const exact = normalizeIdentifiers(identifiers);
    if (!exact.length) return { rows: 0, skipped: false };
    const cols = await getColumns('task_categories');
    if (!cols.has('status')) return { rows: 0, skipped: true, reason: 'missing_status_column' };
    const col = cols.get('status');
    const type = String(col?.data_type || '').toLowerCase();
    if (!['character varying', 'text', 'character', 'user-defined'].includes(type)) {
      return { rows: 0, skipped: true, reason: `unsupported_status_type:${type || 'unknown'}` };
    }
    const lower = exact.map((value) => value.toLowerCase());
    const updateCols = ['status = $3'];
    if (cols.has('updated_at')) updateCols.push('updated_at = NOW()');
    const { rowCount } = await tx.query(
      `UPDATE task_categories
          SET ${updateCols.join(', ')}
        WHERE org_id = $1
          AND (id::text = ANY($2::text[]) OR LOWER(name) = ANY($4::text[]))`,
      [orgId, exact, status, lower]
    );
    return { rows: rowCount || 0, skipped: false };
  } catch (err) {
    return { rows: 0, skipped: true, reason: err.code || err.message || 'legacy_mirror_failed' };
  }
}

async function resolveProject(tx, { orgId, identifiers, actorUserId }) {
  await ensureSchema(tx);
  let project = await findCanonicalProject(tx, orgId, identifiers);
  let seed = null;
  if (!project) {
    seed = await findLegacyCategory(tx, orgId, identifiers);
    project = await ensureCanonicalProject(tx, orgId, seed, actorUserId);
  }
  if (!project) return null;
  const relationIdentifiers = normalizeIdentifiers([project.id, project.name, ...identifiers, seed?.id, seed?.legacy_relation_id, seed?.name]);
  await backfillTaskProjectIds(tx, orgId, project.id, relationIdentifiers);
  return { project, relationIdentifiers, resolvedFrom: seed ? 'legacy_category_backfill' : 'projects' };
}

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
  if (status !== 'completed') return next();

  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const requestedProjectId = String(req.params.projectId || '').trim();
    const requestedProjectName = String(req.body?.project_name || req.body?.projectName || req.body?.name || '').trim();
    const identifiers = normalizeIdentifiers([requestedProjectId, requestedProjectName]);

    const result = await withTransaction(async (tx) => {
      const resolved = await resolveProject(tx, { orgId, identifiers, actorUserId: req.user.id });
      if (!resolved?.project) {
        throw Object.assign(new Error('Project was not found by canonical or legacy project identity.'), { statusCode: 404, code: 'PROJECT_NOT_MIGRATED' });
      }

      const unresolvedTaskCount = await countUnresolvedTasks(tx, orgId, resolved.project.id);
      if (unresolvedTaskCount > 0) {
        throw Object.assign(new Error(`Complete or cancel ${unresolvedTaskCount} task(s) before completing this project.`), {
          statusCode: 409,
          code: 'PROJECT_HAS_UNRESOLVED_TASKS',
          activeTaskCount: unresolvedTaskCount,
        });
      }

      const projectCols = await getColumns('projects');
      const setParts = ['status = $1'];
      const params = ['completed'];
      if (projectCols.has('updated_by')) { params.push(req.user.id); setParts.push(`updated_by = $${params.length}`); }
      if (projectCols.has('updated_at')) setParts.push('updated_at = NOW()');
      params.push(orgId, resolved.project.id);
      const { rows } = await tx.query(
        `UPDATE projects
            SET ${setParts.join(', ')}
          WHERE org_id = $${params.length - 1} AND id = $${params.length}
          RETURNING id, name, description, NULL::text AS icon, NULL::text AS color,
                    COALESCE(status, 'active') AS status,
                    (COALESCE(status, 'active') = 'active') AS is_active,
                    ${projectCols.has('created_at') ? 'created_at' : 'NOW() AS created_at'},
                    'projects'::text AS source_store`,
        params
      );
      if (!rows.length) throw Object.assign(new Error('Project not found'), { statusCode: 404 });

      const legacyMirror = await safeMirrorLegacyStatus(tx, orgId, resolved.relationIdentifiers, 'completed');
      return { project: rows[0], unresolvedTaskCount, legacyMirror, resolvedFrom: resolved.resolvedFrom };
    });

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId: result.project.id, projectName: result.project.name, newStatus: 'completed', unresolvedTaskCount: result.unresolvedTaskCount, legacyMirror: result.legacyMirror, resolvedFrom: result.resolvedFrom } });
      await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: result.project.id, metadata: { projectName: result.project.name, newStatus: 'completed', legacyMirror: result.legacyMirror, requestedProjectId, requestedProjectName, resolvedFrom: result.resolvedFrom }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    } catch { /* non-critical */ }

    return res.json({ project: result.project, affectedActiveTasks: 0, canonicalProjectId: result.project.id, requestedProjectId, requestedProjectName, resolvedFrom: result.resolvedFrom, legacyMirror: result.legacyMirror });
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
