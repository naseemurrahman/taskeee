const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { logUserActivity } = require('../services/activityService');
const { notifyOrgLeaders } = require('../services/notificationService');
const { orgIdForSessionUser } = require('../utils/orgContext');

function normalizeColor(color) {
  if (!color) return null;
  const s = String(color).trim();
  if (!s) return null;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

function isPersonalProjectRole(role) {
  return ['employee', 'technician'].includes(String(role || '').toLowerCase());
}

let tablesCache = null;
let taskCategoryColumns = null;
let projectColumns = null;

async function getTableNames() {
  if (tablesCache) return tablesCache;
  const { rows } = await query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'`
  );
  tablesCache = new Set(rows.map((r) => String(r.table_name)));
  return tablesCache;
}

async function getColumns(tableName) {
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return new Set(rows.map((r) => String(r.column_name)));
}

async function getTaskCategoryColumns() {
  if (taskCategoryColumns) return taskCategoryColumns;
  taskCategoryColumns = await getColumns('task_categories');
  return taskCategoryColumns;
}

async function getProjectColumns() {
  if (projectColumns) return projectColumns;
  projectColumns = await getColumns('projects');
  return projectColumns;
}

async function resolveProjectStore() {
  const tables = await getTableNames();
  if (tables.has('task_categories')) return 'task_categories';
  if (tables.has('projects')) return 'projects';
  return null;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  if (!orgId) return null;
  return String(orgId);
}

function categorySelectSql(cols) {
  return `
    SELECT tc.id,
           tc.name,
           tc.description,
           ${cols.has('icon') ? 'tc.icon' : 'NULL::text AS icon'},
           ${cols.has('color') ? 'tc.color' : 'NULL::text AS color'},
           ${cols.has('status') ? 'tc.status' : (cols.has('is_active') ? "CASE WHEN tc.is_active THEN 'active' ELSE 'completed' END" : "'active'") + ' AS status'},
           ${cols.has('is_active') ? 'tc.is_active' : 'TRUE AS is_active'},
           tc.created_at,
           COUNT(t.id)::int AS task_count
      FROM task_categories tc
      LEFT JOIN tasks t ON t.category_id = tc.id AND t.deleted_at IS NULL
  `;
}

function legacyProjectSelectSql() {
  return `
    SELECT p.id,
           p.name,
           p.description,
           NULL::text AS icon,
           NULL::text AS color,
           COALESCE(p.status, 'active') AS status,
           TRUE AS is_active,
           p.created_at,
           COUNT(t.id)::int AS task_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
  `;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.json({ projects: [] });

    const store = await resolveProjectStore();
    if (!store) return res.json({ projects: [] });

    const personalOnly = isPersonalProjectRole(req.user?.role);

    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      const where = ['tc.org_id = $1'];
      const params = [orgId];
      if (cols.has('is_active')) where.push('tc.is_active = TRUE');
      if (personalOnly) {
        params.push(req.user.id);
        where.push(`EXISTS (
          SELECT 1 FROM tasks myt
           WHERE myt.category_id = tc.id
             AND myt.org_id = tc.org_id
             AND myt.assigned_to = $${params.length}
             AND myt.deleted_at IS NULL
        )`);
      }
      const { rows } = await query(
        `${categorySelectSql(cols)} WHERE ${where.join(' AND ')} GROUP BY tc.id ORDER BY tc.created_at DESC`,
        params
      );
      return res.json({ projects: rows });
    }

    const cols = await getProjectColumns();
    const where = ['p.org_id = $1'];
    const params = [orgId];
    if (cols.has('status')) where.push(`p.status <> 'archived'`);
    if (personalOnly) {
      params.push(req.user.id);
      where.push(`EXISTS (
        SELECT 1 FROM tasks myt
         WHERE myt.project_id = p.id
           AND myt.org_id = p.org_id
           AND myt.assigned_to = $${params.length}
           AND myt.deleted_at IS NULL
      )`);
    }
    const { rows } = await query(
      `${legacyProjectSelectSql()} WHERE ${where.join(' AND ')} GROUP BY p.id ORDER BY p.created_at DESC`,
      params
    );
    return res.json({ projects: rows });
  } catch (err) {
    console.error('GET /projects error:', err.message);
    next(err);
  }
});

router.get('/:projectId', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });
    const projectId = String(req.params.projectId || '').trim();
    const personalOnly = isPersonalProjectRole(req.user?.role);

    const store = await resolveProjectStore();
    if (!store) return res.status(404).json({ error: 'Project not found' });

    let projRows = [];
    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      const params = [orgId, projectId];
      const personalSql = personalOnly ? ` AND EXISTS (SELECT 1 FROM tasks myt WHERE myt.category_id = tc.id AND myt.org_id = tc.org_id AND myt.assigned_to = $3 AND myt.deleted_at IS NULL)` : '';
      if (personalOnly) params.push(req.user.id);
      ({ rows: projRows } = await query(`${categorySelectSql(cols)} WHERE tc.org_id = $1 AND tc.id = $2${personalSql} GROUP BY tc.id`, params));
    } else {
      const params = [orgId, projectId];
      const personalSql = personalOnly ? ` AND EXISTS (SELECT 1 FROM tasks myt WHERE myt.project_id = p.id AND myt.org_id = p.org_id AND myt.assigned_to = $3 AND myt.deleted_at IS NULL)` : '';
      if (personalOnly) params.push(req.user.id);
      ({ rows: projRows } = await query(`${legacyProjectSelectSql()} WHERE p.org_id = $1 AND p.id = $2${personalSql} GROUP BY p.id`, params));
    }

    if (!projRows.length) return res.status(404).json({ error: 'Project not found' });

    res.json({
      project: projRows[0],
      taskCounts: { byStatus: {}, total: projRows[0].task_count || 0 },
      workers: [],
      leaders: [],
      recentThreads: [],
      deadlineSummary: { overdueCount: 0, dueWithin7Days: 0, nextDueAt: null, latestDueAt: null },
      assigneeMetrics: [],
    });
  } catch (err) {
    console.error('GET /projects/:id error:', err.message);
    next(err);
  }
});

router.post('/', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID not found in session' });

    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    const icon = String(req.body?.icon || '').trim() || null;
    const color = normalizeColor(req.body?.color);

    if (!name || name.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    if (name.length > 100) return res.status(400).json({ error: 'Project name is too long (max 100)' });

    const store = await resolveProjectStore();
    if (!store) return res.status(500).json({ error: 'Projects storage table is missing' });

    let created;
    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      const insertColumns = ['org_id', 'name', 'description'];
      const values = [orgId, name, description];
      if (cols.has('icon')) { insertColumns.push('icon'); values.push(icon); }
      if (cols.has('color')) { insertColumns.push('color'); values.push(color); }
      if (cols.has('is_active')) { insertColumns.push('is_active'); values.push(true); }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await query(
        `INSERT INTO task_categories (${insertColumns.join(', ')})
         VALUES (${placeholders})
         RETURNING id, name, description,
                   ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                   ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                   ${cols.has('status') ? 'status' : (cols.has('is_active') ? "CASE WHEN is_active THEN 'active' ELSE 'completed' END" : "'active'") + ' AS status'},
                   ${cols.has('is_active') ? 'is_active' : 'TRUE AS is_active'},
                   created_at`,
        values
      );
      created = rows[0];
    } else {
      const cols = await getProjectColumns();
      const insertColumns = ['org_id', 'name', 'description'];
      const values = [orgId, name, description];
      if (cols.has('status')) { insertColumns.push('status'); values.push('active'); }
      if (cols.has('created_by')) { insertColumns.push('created_by'); values.push(req.user.id); }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await query(
        `INSERT INTO projects (${insertColumns.join(', ')})
         VALUES (${placeholders})
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, TRUE AS is_active, created_at`,
        values
      );
      created = rows[0];
    }

    await logUserActivity({
      orgId,
      userId: req.user.id,
      activityType: 'project_created',
      metadata: { projectId: created.id, projectName: name },
    });

    await notifyOrgLeaders(orgId, {
      type: 'project_created',
      title: 'New project created',
      body: name,
      data: { projectId: created.id },
      excludeUserId: req.user.id,
    });

    res.status(201).json({ project: created });
  } catch (err) {
    console.error('POST /projects error:', err.message);
    next(err);
  }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });
    const projectId = String(req.params.projectId || '').trim();

    const store = await resolveProjectStore();
    if (!store) return res.status(404).json({ error: 'Project not found' });

    const sets = [];
    const values = [];

    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters' });
      if (name.length > 100) return res.status(400).json({ error: 'Project name is too long (max 100)' });
      values.push(name);
      sets.push(`name = $${values.length}`);
    }

    if (typeof req.body?.description === 'string') {
      values.push(req.body.description.trim() || null);
      sets.push(`description = $${values.length}`);
    }

    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      if (cols.has('icon') && typeof req.body?.icon === 'string') { values.push(req.body.icon.trim() || null); sets.push(`icon = $${values.length}`); }
      if (cols.has('color') && typeof req.body?.color === 'string') { values.push(normalizeColor(req.body.color)); sets.push(`color = $${values.length}`); }
      if (cols.has('is_active') && typeof req.body?.is_active === 'boolean') { values.push(req.body.is_active); sets.push(`is_active = $${values.length}`); }
      if (typeof req.body?.status === 'string') {
        const allowed = new Set(['active', 'paused', 'completed']);
        const status = req.body.status.trim().toLowerCase();
        if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
        if (cols.has('status')) { values.push(status); sets.push(`status = $${values.length}`); }
        if (cols.has('is_active')) { values.push(status === 'active'); sets.push(`is_active = $${values.length}`); }
      }

      if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });
      values.push(orgId, projectId);

      const { rows } = await query(
        `UPDATE task_categories SET ${sets.join(', ')}
          WHERE org_id = $${values.length - 1} AND id = $${values.length}
          RETURNING id, name, description,
                    ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                    ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                    ${cols.has('status') ? 'status' : (cols.has('is_active') ? "CASE WHEN is_active THEN 'active' ELSE 'completed' END" : "'active'") + ' AS status'},
                    ${cols.has('is_active') ? 'is_active' : 'TRUE AS is_active'},
                    created_at`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      return res.json({ project: rows[0] });
    }

    const cols = await getProjectColumns();
    if (cols.has('status') && typeof req.body?.is_active === 'boolean') {
      values.push(req.body.is_active ? 'active' : 'archived');
      sets.push(`status = $${values.length}`);
    }
    if (cols.has('status') && typeof req.body?.status === 'string') {
      const allowed = new Set(['active', 'paused', 'completed']);
      const status = req.body.status.trim().toLowerCase();
      if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
      values.push(status);
      sets.push(`status = $${values.length}`);
    }

    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });
    values.push(orgId, projectId);

    const { rows } = await query(
      `UPDATE projects SET ${sets.join(', ')}
        WHERE org_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, TRUE AS is_active, created_at`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    return res.json({ project: rows[0] });
  } catch (err) {
    console.error('PATCH /projects error:', err.message);
    next(err);
  }
});

module.exports = router;
