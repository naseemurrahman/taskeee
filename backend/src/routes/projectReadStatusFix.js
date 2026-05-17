'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const router = express.Router();

async function tableExists(tableName) {
  const { rows } = await query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function getColumns(tableName) {
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(rows.map((row) => String(row.column_name)));
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

function canonicalProjectSelect(taskCols, idFilter = false) {
  const deletedGuard = taskCols.has('deleted_at') ? 'AND t.deleted_at IS NULL' : '';
  return `
    SELECT p.id,
           p.name,
           p.description,
           NULL::text AS icon,
           NULL::text AS color,
           COALESCE(NULLIF(p.status, ''), 'active') AS status,
           (COALESCE(NULLIF(p.status, ''), 'active') = 'active') AS is_active,
           p.created_at,
           COUNT(t.id)::int AS task_count,
           'projects'::text AS source_store
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id ${deletedGuard}
     WHERE p.org_id = $1
       ${idFilter ? 'AND p.id::text = $2::text' : ''}
       AND COALESCE(NULLIF(p.status, ''), 'active') <> 'archived'
  `;
}

function legacyStatusExpression(categoryCols) {
  if (categoryCols.has('is_active') && categoryCols.has('status')) {
    return `CASE
      WHEN tc.is_active = FALSE THEN 'completed'
      ELSE COALESCE(NULLIF(tc.status, ''), 'active')
    END AS status`;
  }
  if (categoryCols.has('is_active')) return `CASE WHEN tc.is_active THEN 'active' ELSE 'completed' END AS status`;
  if (categoryCols.has('status')) return `COALESCE(NULLIF(tc.status, ''), 'active') AS status`;
  return `'active' AS status`;
}

function legacyActiveExpression(categoryCols) {
  if (categoryCols.has('is_active') && categoryCols.has('status')) {
    return `(tc.is_active = TRUE AND COALESCE(NULLIF(tc.status, ''), 'active') = 'active') AS is_active`;
  }
  if (categoryCols.has('is_active')) return `tc.is_active AS is_active`;
  if (categoryCols.has('status')) return `(COALESCE(NULLIF(tc.status, ''), 'active') = 'active') AS is_active`;
  return `TRUE AS is_active`;
}

function legacyProjectSelect(categoryCols, taskCols) {
  const deletedGuard = taskCols.has('deleted_at') ? 'AND t.deleted_at IS NULL' : '';
  const description = categoryCols.has('description') ? 'tc.description' : 'NULL::text AS description';
  const icon = categoryCols.has('icon') ? 'tc.icon' : 'NULL::text AS icon';
  const color = categoryCols.has('color') ? 'tc.color' : 'NULL::text AS color';
  const createdAt = categoryCols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at';
  const taskMapExclusion = taskCols.has('category_id') && taskCols.has('project_id')
    ? `OR EXISTS (
         SELECT 1 FROM tasks mt
          WHERE mt.org_id = tc.org_id
            AND mt.category_id = tc.id
            AND mt.project_id = p.id
            ${taskCols.has('deleted_at') ? 'AND mt.deleted_at IS NULL' : ''}
       )`
    : '';

  return `
    SELECT tc.id,
           tc.name,
           ${description},
           ${icon},
           ${color},
           ${legacyStatusExpression(categoryCols)},
           ${legacyActiveExpression(categoryCols)},
           ${createdAt},
           COUNT(t.id)::int AS task_count,
           'task_categories'::text AS source_store
      FROM task_categories tc
      LEFT JOIN tasks t ON t.category_id = tc.id ${deletedGuard}
     WHERE tc.org_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM projects p
          WHERE p.org_id = tc.org_id
            AND COALESCE(NULLIF(p.status, ''), 'active') <> 'archived'
            AND (
              p.id::text = tc.id::text
              OR LOWER(TRIM(p.name)) = LOWER(TRIM(tc.name))
              ${taskMapExclusion}
            )
       )
  `;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId || !(await tableExists('projects'))) return next();

    const projectCols = await getColumns('projects');
    const taskCols = await getColumns('tasks');
    if (!projectCols.has('id') || !projectCols.has('org_id') || !projectCols.has('name')) return next();

    const { rows: canonicalRows } = await query(
      `${canonicalProjectSelect(taskCols)} GROUP BY p.id ORDER BY p.created_at DESC`,
      [orgId]
    );

    let legacyRows = [];
    if (await tableExists('task_categories')) {
      const categoryCols = await getColumns('task_categories');
      const { rows } = await query(
        `${legacyProjectSelect(categoryCols, taskCols)} GROUP BY tc.id ORDER BY ${categoryCols.has('created_at') ? 'tc.created_at' : 'tc.id'} DESC`,
        [orgId]
      );
      legacyRows = rows;
    }

    return res.json({
      projects: [...canonicalRows, ...legacyRows],
      meta: { store: 'authoritative_project_status_read', canonical: true, includesLegacy: legacyRows.length > 0 },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/:projectId', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId || !(await tableExists('projects'))) return next();

    const taskCols = await getColumns('tasks');
    const { rows } = await query(
      `${canonicalProjectSelect(taskCols, true)} GROUP BY p.id`,
      [orgId, String(req.params.projectId || '')]
    );
    if (!rows.length) return next();

    return res.json({
      project: rows[0],
      taskCounts: { byStatus: {}, total: rows[0].task_count || 0 },
      workers: [],
      leaders: [],
      recentThreads: [],
      deadlineSummary: { overdueCount: 0, dueWithin7Days: 0, nextDueAt: null, latestDueAt: null },
      assigneeMetrics: [],
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
