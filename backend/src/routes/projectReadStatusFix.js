'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
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

function normalize(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
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
    return `CASE WHEN tc.is_active = FALSE THEN 'completed' ELSE COALESCE(NULLIF(tc.status, ''), 'active') END AS status`;
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

async function findProjectForCompletion(tx, orgId, identifiers) {
  const exact = normalize(identifiers);
  const lower = exact.map((value) => value.toLowerCase());
  if (!exact.length) return null;

  let { rows } = await tx.query(
    `SELECT p.id, p.name
       FROM projects p
      WHERE p.org_id = $1
        AND (p.id::text = ANY($2::text[]) OR LOWER(TRIM(p.name)) = ANY($3::text[]))
      ORDER BY CASE WHEN p.id::text = ANY($2::text[]) THEN 0 ELSE 1 END
      LIMIT 1
      FOR UPDATE`,
    [orgId, exact, lower]
  );
  if (rows[0]) return rows[0];

  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id') || !taskCols.has('category_id')) return null;

  ({ rows } = await tx.query(
    `SELECT p.id, p.name
       FROM projects p
       JOIN tasks t ON t.project_id = p.id AND t.org_id = p.org_id
      WHERE p.org_id = $1
        AND t.category_id::text = ANY($2::text[])
        ${taskCols.has('deleted_at') ? 'AND t.deleted_at IS NULL' : ''}
      GROUP BY p.id, p.name
      ORDER BY COUNT(t.id) DESC
      LIMIT 1
      FOR UPDATE`,
    [orgId, exact]
  ));
  return rows[0] || null;
}

async function countOpenProjectTasks(tx, orgId, projectId) {
  const taskCols = await getColumns('tasks');
  if (!taskCols.has('project_id') || !taskCols.has('status')) return 0;
  const conditions = [
    't.org_id = $1',
    't.project_id = $2',
    `COALESCE(t.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`,
  ];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  const { rows } = await tx.query(`SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`, [orgId, projectId]);
  return Number(rows[0]?.cnt || 0);
}

async function mirrorLegacyInactiveBestEffort(orgId, project, identifiers) {
  try {
    if (!(await tableExists('task_categories'))) return { rows: 0, skipped: false };
    const categoryCols = await getColumns('task_categories');
    if (!categoryCols.has('is_active')) return { rows: 0, skipped: true, reason: 'missing_is_active' };

    const taskCols = await getColumns('tasks');
    const exact = normalize([project.id, project.name, ...identifiers]);
    const lower = exact.map((value) => value.toLowerCase());
    const relation = taskCols.has('project_id') && taskCols.has('category_id')
      ? `OR EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.org_id = tc.org_id
              AND t.project_id = $4
              AND t.category_id = tc.id
              ${taskCols.has('deleted_at') ? 'AND t.deleted_at IS NULL' : ''}
         )`
      : '';
    const setParts = ['is_active = FALSE'];
    if (categoryCols.has('updated_at')) setParts.push('updated_at = NOW()');
    const { rowCount } = await query(
      `UPDATE task_categories tc
          SET ${setParts.join(', ')}
        WHERE tc.org_id = $1
          AND (tc.id::text = ANY($2::text[]) OR LOWER(TRIM(tc.name)) = ANY($3::text[]) ${relation})`,
      [orgId, exact, lower, project.id]
    );
    return { rows: rowCount || 0, skipped: false };
  } catch (err) {
    return { rows: 0, skipped: true, reason: err.code || err.message || 'legacy_inactive_mirror_failed' };
  }
}

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
  if (requestedStatus !== 'completed') return next();

  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const requestedProjectId = String(req.params.projectId || '').trim();
    const requestedProjectName = String(req.body?.project_name || req.body?.projectName || req.body?.name || '').trim();
    const identifiers = normalize([requestedProjectId, requestedProjectName]);

    const result = await withTransaction(async (tx) => {
      const project = await findProjectForCompletion(tx, orgId, identifiers);
      if (!project) throw Object.assign(new Error('Project was not found by canonical id/name or task relation.'), { statusCode: 404, code: 'PROJECT_NOT_FOUND' });

      const openTasks = await countOpenProjectTasks(tx, orgId, project.id);
      if (openTasks > 0) {
        throw Object.assign(new Error(`Complete or cancel ${openTasks} task(s) before completing this project.`), { statusCode: 409, code: 'PROJECT_HAS_UNRESOLVED_TASKS', activeTaskCount: openTasks });
      }

      const projectCols = await getColumns('projects');
      const setParts = ['status = $1'];
      const params = ['completed'];
      if (projectCols.has('updated_by')) { params.push(req.user.id); setParts.push(`updated_by = $${params.length}`); }
      if (projectCols.has('updated_at')) setParts.push('updated_at = NOW()');
      params.push(orgId, project.id);

      const { rows } = await tx.query(
        `UPDATE projects
            SET ${setParts.join(', ')}
          WHERE org_id = $${params.length - 1} AND id = $${params.length}
          RETURNING id, name, description, NULL::text AS icon, NULL::text AS color,
                    COALESCE(NULLIF(status, ''), 'active') AS status,
                    (COALESCE(NULLIF(status, ''), 'active') = 'active') AS is_active,
                    ${projectCols.has('created_at') ? 'created_at' : 'NOW() AS created_at'},
                    'projects'::text AS source_store`,
        params
      );
      return rows[0];
    });

    const legacyMirror = await mirrorLegacyInactiveBestEffort(orgId, result, identifiers);
    return res.json({ project: result, affectedActiveTasks: 0, canonicalProjectId: result.id, requestedProjectId, requestedProjectName, legacyMirror });
  } catch (err) {
    if (err.statusCode) {
      const body = { error: err.message, code: err.code };
      if (typeof err.activeTaskCount === 'number') body.activeTaskCount = err.activeTaskCount;
      return res.status(err.statusCode).json(body);
    }
    return next(err);
  }
});

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

    return res.json({ projects: [...canonicalRows, ...legacyRows], meta: { store: 'authoritative_project_status_read', canonical: true, includesLegacy: legacyRows.length > 0 } });
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
