'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

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

async function tableExists(tableName) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
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

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

function activePreflightCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

async function findLegacyCategory(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((v) => v.toLowerCase());
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

async function findCanonicalProject(tx, orgId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return null;
  const lower = exact.map((v) => v.toLowerCase());
  try {
    const { rows } = await tx.query(
      `SELECT id, name FROM projects
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

async function ensureCanonicalProject(tx, orgId, seed, actorUserId) {
  if (!seed) return null;
  const existing = await findCanonicalProject(tx, orgId, [seed.id, seed.name]);
  if (existing) return existing;
  const cols = await getColumns('projects');
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
    values.push(JSON.stringify({
      recovered_from: 'active_task_preflight',
      legacy_id: seed.id,
      legacy_name: seed.name,
      legacy_relation_id: seed.legacy_relation_id || seed.id,
    }));
  }
  await tx.query(
    `INSERT INTO projects (${fields.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    values
  );
  return findCanonicalProject(tx, orgId, [canonicalId, seed.id, seed.name]);
}

async function backfillTaskProjectIds(tx, orgId, canonicalId, identifiers) {
  const exact = normalizeIdentifiers(identifiers);
  if (!exact.length) return;
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id')) return;
  const relationParts = ['project_id::text = ANY($2::text[])'];
  if (taskCols.has('category_id')) relationParts.push('category_id::text = ANY($2::text[])');
  const projectTasksExists = await tableExists('project_tasks');
  if (projectTasksExists) {
    const ptCols = await getColumns('project_tasks');
    if (ptCols.has('task_id') && ptCols.has('project_id')) {
      const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
      relationParts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = tasks.id AND pt.project_id::text = ANY($2::text[])${ptOrgGuard})`);
    }
  }
  const conditions = ['org_id = $1', `(${relationParts.join(' OR ')})`];
  if (taskCols.has('deleted_at')) conditions.push('deleted_at IS NULL');
  await tx.query(
    `UPDATE tasks SET project_id = $3${taskCols.has('updated_at') ? ', updated_at = NOW()' : ''}
      WHERE ${conditions.join(' AND ')}`,
    [orgId, exact, canonicalId]
  );
}

async function repairCanonicalRelationForPreflight({ orgId, projectId, projectName, actorUserId }) {
  const identifiers = normalizeIdentifiers([projectId, projectName]);
  if (!identifiers.length) return null;
  return withTransaction(async (tx) => {
    await ensureLifecycleSchema(tx);
    let seed = await findCanonicalProject(tx, orgId, identifiers);
    if (seed) {
      await backfillTaskProjectIds(tx, orgId, seed.id, identifiers);
      return { canonicalProjectId: seed.id, canonicalProjectName: seed.name, resolvedFrom: 'projects' };
    }
    seed = await findLegacyCategory(tx, orgId, identifiers);
    if (!seed) {
      seed = {
        id: projectId,
        name: projectName || projectId,
        description: null,
        created_at: new Date(),
        status: 'active',
        legacy_relation_id: projectId,
      };
    }
    const project = await ensureCanonicalProject(tx, orgId, seed, actorUserId);
    if (!project) return null;
    await backfillTaskProjectIds(tx, orgId, project.id, [project.id, project.name, ...identifiers, seed.id, seed.legacy_relation_id, seed.name]);
    return { canonicalProjectId: project.id, canonicalProjectName: project.name, resolvedFrom: 'active_task_preflight_backfill' };
  });
}

router.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });
    const projectId = String(req.params.projectId || '').trim();
    const projectName = String(req.query?.project_name || req.query?.projectName || '').trim();
    const identifiers = normalizeIdentifiers([projectId, projectName]);
    const taskCols = await getColumns('tasks');
    const relationParts = [];
    if (taskCols.has('category_id')) relationParts.push('t.category_id::text = ANY($2::text[])');
    if (taskCols.has('project_id')) relationParts.push('t.project_id::text = ANY($2::text[])');
    const projectTasksExists = await tableExists('project_tasks');
    if (projectTasksExists) {
      const ptCols = await getColumns('project_tasks');
      if (ptCols.has('task_id') && ptCols.has('project_id')) {
        const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
        relationParts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id::text = ANY($2::text[])${ptOrgGuard})`);
      }
    }
    if (!relationParts.length) return res.json({ tasks: [] });

    const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
    if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (taskCols.has('status')) conditions.push(activePreflightCondition('t'));
    const assigneeJoin = taskCols.has('assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : '';
    const assigneeSel = taskCols.has('assigned_to') ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name` : `'Unassigned' AS assignee_name`;
    const prioritySel = taskCols.has('priority') ? 't.priority' : 'NULL::text AS priority';
    const dueSel = taskCols.has('due_date') ? 't.due_date' : 'NULL::timestamptz AS due_date';
    const orderBy = taskCols.has('created_at') ? 't.created_at DESC' : 't.id DESC';

    const { rows } = await query(
      `SELECT t.id, t.title, COALESCE(t.status,'pending') AS status,
              ${prioritySel}, ${dueSel}, ${assigneeSel}
         FROM tasks t
         ${assigneeJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT 50`,
      [orgId, identifiers]
    );

    let repair = null;
    if (rows.length > 0) {
      try {
        repair = await repairCanonicalRelationForPreflight({ orgId, projectId, projectName, actorUserId: req.user.id });
      } catch {
        // Active-task preview must stay available even if repair fails; lifecycle PATCH has its own guard.
      }
    }

    return res.json({ tasks: rows, meta: { projectId, projectName, ...repair } });
  } catch (err) { next(err); }
});

module.exports = router;
