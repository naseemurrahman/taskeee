'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logUserActivity } = require('../services/activityService');
const { notifyOrgLeaders } = require('../services/notificationService');

const router = express.Router();

let tablesCache = null;
let columnsCache = new Map();

async function tableExists(tableName) {
  if (!tablesCache) {
    const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    tablesCache = new Set(rows.map(r => String(r.table_name)));
  }
  return tablesCache.has(tableName);
}

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

async function hasCanonicalProjects() {
  if (!(await tableExists('projects'))) return false;
  const cols = await getColumns('projects');
  return cols.has('id') && cols.has('org_id') && cols.has('name');
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

function normalizedRole(req) {
  return String(req.user?.role || '').toLowerCase();
}

function isPersonalRole(role) {
  return ['employee', 'technician'].includes(String(role || '').toLowerCase());
}

function projectSelectSql({ personalOnly = false, userParam = null, idFilter = false }) {
  const scopedTaskJoin = personalOnly && userParam ? `AND t.assigned_to = $${userParam}` : '';
  const idWhere = idFilter ? 'AND p.id = $2' : '';
  return `
    SELECT p.id,
           p.name,
           p.description,
           NULL::text AS icon,
           NULL::text AS color,
           COALESCE(p.status, 'active') AS status,
           (COALESCE(p.status, 'active') = 'active') AS is_active,
           p.created_at,
           COUNT(t.id)::int AS task_count,
           'projects'::text AS source_store
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL ${scopedTaskJoin}
     WHERE p.org_id = $1
       ${idWhere}
       AND COALESCE(p.status, 'active') <> 'archived'
  `;
}

async function canonicalProjectCount(orgId) {
  const { rows } = await query(`SELECT COUNT(*)::int AS cnt FROM projects WHERE org_id = $1`, [orgId]);
  return Number(rows[0]?.cnt || 0);
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId || !(await hasCanonicalProjects())) return next();

    const count = await canonicalProjectCount(orgId);
    if (count <= 0) return next();

    const role = normalizedRole(req);
    const personalOnly = isPersonalRole(role);
    const params = [orgId];
    let userParam = null;
    let personalFilter = '';
    if (personalOnly) {
      params.push(req.user.id);
      userParam = params.length;
      personalFilter = ` AND EXISTS (
        SELECT 1 FROM tasks myt
         WHERE myt.project_id = p.id
           AND myt.org_id = p.org_id
           AND myt.assigned_to = $${userParam}
           AND myt.deleted_at IS NULL
      )`;
    }

    const { rows } = await query(
      `${projectSelectSql({ personalOnly, userParam })}${personalFilter} GROUP BY p.id ORDER BY p.created_at DESC`,
      params
    );
    return res.json({ projects: rows, meta: { scope: personalOnly ? 'assigned_projects_only' : 'organization_projects', role, store: 'projects', canonical: true, personalOnly } });
  } catch (err) { next(err); }
});

router.get('/:projectId', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId || !(await hasCanonicalProjects())) return next();

    const role = normalizedRole(req);
    const personalOnly = isPersonalRole(role);
    const params = [orgId, req.params.projectId];
    let userParam = null;
    let personalFilter = '';
    if (personalOnly) {
      params.push(req.user.id);
      userParam = params.length;
      personalFilter = ` AND EXISTS (
        SELECT 1 FROM tasks myt
         WHERE myt.project_id = p.id
           AND myt.org_id = p.org_id
           AND myt.assigned_to = $${userParam}
           AND myt.deleted_at IS NULL
      )`;
    }

    const { rows } = await query(
      `${projectSelectSql({ personalOnly, userParam, idFilter: true })}${personalFilter} GROUP BY p.id`,
      params
    );
    if (!rows.length) return next();
    return res.json({ project: rows[0], taskCounts: { byStatus: {}, total: rows[0].task_count || 0 }, workers: [], leaders: [], recentThreads: [], deadlineSummary: { overdueCount: 0, dueWithin7Days: 0, nextDueAt: null, latestDueAt: null }, assigneeMetrics: [] });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId || !(await hasCanonicalProjects())) return next();

    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    if (!name || name.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    if (name.length > 100) return res.status(400).json({ error: 'Project name is too long (max 100)' });

    const cols = await getColumns('projects');
    const insertColumns = ['id', 'org_id', 'name', 'description'];
    const values = [randomUUID(), orgId, name, description];
    if (cols.has('status')) { insertColumns.push('status'); values.push('active'); }
    if (cols.has('created_by')) { insertColumns.push('created_by'); values.push(req.user.id); }
    if (cols.has('updated_by')) { insertColumns.push('updated_by'); values.push(req.user.id); }
    if (cols.has('metadata')) { insertColumns.push('metadata'); values.push(JSON.stringify({ source: 'canonical_projects' })); }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO projects (${insertColumns.join(', ')}) VALUES (${placeholders})
       RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at, 'projects'::text AS source_store`,
      values
    );
    const created = rows[0];

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_created', metadata: { projectId: created.id, projectName: name, canonical: true } });
      await notifyOrgLeaders(orgId, { type: 'project_created', title: 'New project created', body: name, data: { projectId: created.id }, excludeUserId: req.user.id });
    } catch { /* non-critical */ }

    return res.status(201).json({ project: created });
  } catch (err) { next(err); }
});

module.exports = router;
