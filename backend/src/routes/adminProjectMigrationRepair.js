'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { logAuditEvent } = require('../services/auditService');

const router = express.Router();
router.use(authenticate, requireAnyRole('admin', 'director'));

function orgId(req) {
  return req.user.org_id || req.user.orgId;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function tableExists(tableName) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columns(tableName) {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

function taskDeletedGuard(taskCols, alias = 't') {
  return taskCols.has('deleted_at') ? `AND ${alias}.deleted_at IS NULL` : '';
}

function deriveProjectStatus(row) {
  if (row.is_active === false) return 'completed';
  const status = String(row.status || '').trim().toLowerCase();
  return ['active', 'paused', 'completed', 'archived'].includes(status) ? status : 'active';
}

async function legacyCategoriesWithoutCanonicalMatch(tx, oid, categoryCols) {
  const description = categoryCols.has('description') ? 'tc.description' : 'NULL::text AS description';
  const status = categoryCols.has('status') ? 'tc.status' : 'NULL::text AS status';
  const isActive = categoryCols.has('is_active') ? 'tc.is_active' : 'TRUE AS is_active';
  const createdAt = categoryCols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at';
  const { rows } = await tx.query(
    `SELECT tc.id::text AS id,
            tc.name,
            ${description},
            ${status},
            ${isActive},
            ${createdAt}
       FROM task_categories tc
      WHERE tc.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM projects p
           WHERE p.org_id = tc.org_id
             AND (p.id::text = tc.id::text OR LOWER(TRIM(p.name)) = LOWER(TRIM(tc.name)))
        )
      ORDER BY ${categoryCols.has('created_at') ? 'tc.created_at DESC NULLS LAST' : 'tc.name ASC'}`,
    [oid]
  );
  return rows;
}

async function createCanonicalProjectForCategory(tx, { oid, category, projectCols, actorUserId }) {
  const id = isUuid(category.id) ? category.id : randomUUID();
  const fields = ['id', 'org_id', 'name'];
  const values = [id, oid, category.name || `Legacy Project ${id.slice(0, 8)}`];

  if (projectCols.has('description')) {
    fields.push('description');
    values.push(category.description || null);
  }
  if (projectCols.has('status')) {
    fields.push('status');
    values.push(deriveProjectStatus(category));
  }
  if (projectCols.has('created_by')) {
    fields.push('created_by');
    values.push(actorUserId || null);
  }
  if (projectCols.has('updated_by')) {
    fields.push('updated_by');
    values.push(actorUserId || null);
  }
  if (projectCols.has('created_at')) {
    fields.push('created_at');
    values.push(category.created_at || new Date());
  }
  if (projectCols.has('updated_at')) {
    fields.push('updated_at');
    values.push(new Date());
  }
  if (projectCols.has('metadata')) {
    fields.push('metadata');
    values.push(JSON.stringify({ source: 'admin_project_migration_repair', legacy_category_id: category.id, legacy_category_name: category.name }));
  }

  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  const { rowCount } = await tx.query(
    `INSERT INTO projects (${fields.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (id) DO NOTHING`,
    values
  );
  return { id, created: rowCount > 0 };
}

async function backfillMissingTaskProjectIds(tx, oid, taskCols) {
  if (!taskCols.has('org_id') || !taskCols.has('category_id') || !taskCols.has('project_id')) {
    return { rows: 0, tasks: [] };
  }
  const updatedAt = taskCols.has('updated_at') ? ', updated_at = NOW()' : '';
  const titleSelect = taskCols.has('title') ? 't.title' : 't.id::text AS title';
  const deleted = taskDeletedGuard(taskCols, 't');
  const { rows } = await tx.query(
    `WITH category_project AS (
       SELECT DISTINCT ON (tc.id)
              tc.id AS category_id,
              p.id AS project_id
         FROM task_categories tc
         JOIN projects p ON p.org_id = tc.org_id
          AND (p.id::text = tc.id::text OR LOWER(TRIM(p.name)) = LOWER(TRIM(tc.name)))
        WHERE tc.org_id = $1
        ORDER BY tc.id,
                 CASE WHEN p.id::text = tc.id::text THEN 0 ELSE 1 END,
                 p.created_at DESC NULLS LAST
     ), updated AS (
       UPDATE tasks t
          SET project_id = cp.project_id${updatedAt}
         FROM category_project cp
        WHERE t.org_id = $1
          AND t.category_id = cp.category_id
          AND t.project_id IS NULL
          ${deleted}
        RETURNING t.id, ${titleSelect}, t.category_id, t.project_id
     )
     SELECT * FROM updated
     ORDER BY title ASC
     LIMIT 100`,
    [oid]
  );
  return { rows: rows.length, tasks: rows };
}

router.post('/project-migration-repair', async (req, res, next) => {
  try {
    const oid = orgId(req);
    if (!oid) return res.status(400).json({ error: 'Organization ID not found in session' });

    const hasProjects = await tableExists('projects');
    const hasCategories = await tableExists('task_categories');
    const hasTasks = await tableExists('tasks');
    if (!hasProjects || !hasCategories || !hasTasks) {
      return res.status(409).json({
        error: 'Project migration repair requires projects, task_categories, and tasks tables.',
        code: 'PROJECT_MIGRATION_SCHEMA_INCOMPLETE',
        tables: { projects: hasProjects, task_categories: hasCategories, tasks: hasTasks },
      });
    }

    const projectCols = await columns('projects');
    const categoryCols = await columns('task_categories');
    const taskCols = await columns('tasks');
    const requiredProject = ['id', 'org_id', 'name'];
    const requiredCategory = ['id', 'org_id', 'name'];
    const requiredTask = ['id', 'org_id', 'category_id', 'project_id'];
    const missing = {
      projects: requiredProject.filter((col) => !projectCols.has(col)),
      task_categories: requiredCategory.filter((col) => !categoryCols.has(col)),
      tasks: requiredTask.filter((col) => !taskCols.has(col)),
    };
    if (missing.projects.length || missing.task_categories.length || missing.tasks.length) {
      return res.status(409).json({ error: 'Project migration repair is missing required columns.', code: 'PROJECT_MIGRATION_COLUMNS_MISSING', missing });
    }

    const repair = await withTransaction(async (tx) => {
      const legacyOnly = await legacyCategoriesWithoutCanonicalMatch(tx, oid, categoryCols);
      const createdProjects = [];
      const existingProjects = [];
      for (const category of legacyOnly) {
        const result = await createCanonicalProjectForCategory(tx, { oid, category, projectCols, actorUserId: req.user.id });
        if (result.created) createdProjects.push({ legacyCategoryId: category.id, projectId: result.id, name: category.name });
        else existingProjects.push({ legacyCategoryId: category.id, projectId: result.id, name: category.name });
      }

      const backfill = await backfillMissingTaskProjectIds(tx, oid, taskCols);
      return { legacyCategoriesFound: legacyOnly.length, createdProjects, existingProjects, backfilledTasks: backfill };
    });

    await logAuditEvent({
      req,
      action: 'project_migration_repair_run',
      entityType: 'admin_ops',
      metadata: {
        legacyCategoriesFound: repair.legacyCategoriesFound,
        createdProjectCount: repair.createdProjects.length,
        backfilledTaskCount: repair.backfilledTasks.rows,
      },
    });

    return res.json({ ok: true, orgId: oid, repair, timestamp: new Date().toISOString() });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
