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

function normalizedRole(req) {
  return String(req.user?.role || '').toLowerCase();
}

function isPersonalProjectRole(role) {
  return ['employee', 'technician'].includes(String(role || '').toLowerCase());
}

function projectScopeForRole(role) {
  if (isPersonalProjectRole(role)) return 'assigned_projects_only';
  if (['admin', 'director', 'hr', 'manager', 'supervisor'].includes(String(role || '').toLowerCase())) return 'organization_projects';
  return 'assigned_projects_only';
}

let tablesCache = null;
const columnsCache = new Map();

async function getTableNames() {
  if (tablesCache) return tablesCache;
  const { rows } = await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  tablesCache = new Set(rows.map((r) => String(r.table_name)));
  return tablesCache;
}

async function tableExists(tableName) {
  const tables = await getTableNames();
  return tables.has(tableName);
}

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

async function resolveProjectStore() {
  const tables = await getTableNames();
  if (tables.has('projects')) return 'projects';
  if (tables.has('task_categories')) return 'task_categories';
  return null;
}

function projectStatusSelect(alias = 'p') {
  return `COALESCE(NULLIF(${alias}.status, ''), 'active') AS status`;
}

function projectActiveSelect(alias = 'p') {
  return `(COALESCE(NULLIF(${alias}.status, ''), 'active') = 'active') AS is_active`;
}

function legacyStatusSelect(cols, alias = 'tc') {
  if (cols.has('is_active') && cols.has('status')) {
    return `CASE WHEN ${alias}.is_active = FALSE THEN 'completed' ELSE COALESCE(NULLIF(${alias}.status, ''), 'active') END AS status`;
  }
  if (cols.has('is_active')) return `CASE WHEN ${alias}.is_active THEN 'active' ELSE 'completed' END AS status`;
  if (cols.has('status')) return `COALESCE(NULLIF(${alias}.status, ''), 'active') AS status`;
  return `'active' AS status`;
}

function legacyActiveSelect(cols, alias = 'tc') {
  if (cols.has('is_active') && cols.has('status')) {
    return `(${alias}.is_active = TRUE AND COALESCE(NULLIF(${alias}.status, ''), 'active') = 'active') AS is_active`;
  }
  if (cols.has('is_active')) return `${alias}.is_active AS is_active`;
  if (cols.has('status')) return `(COALESCE(NULLIF(${alias}.status, ''), 'active') = 'active') AS is_active`;
  return `TRUE AS is_active`;
}

function taskDeletedGuard(cols, alias = 't') {
  return cols.has('deleted_at') ? `AND ${alias}.deleted_at IS NULL` : '';
}

function taskCreatedOrder(cols, alias = 't') {
  return cols.has('created_at') ? `${alias}.created_at DESC` : `${alias}.id DESC`;
}

function projectSelectSql({ taskCols, personalOnly = false, userParam = null, idFilter = false }) {
  const scopedTaskJoin = personalOnly && userParam ? `AND t.assigned_to = $${userParam}` : '';
  return `
    SELECT p.id,
           p.name,
           p.description,
           NULL::text AS icon,
           NULL::text AS color,
           ${projectStatusSelect('p')},
           ${projectActiveSelect('p')},
           p.created_at,
           COUNT(t.id)::int AS task_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id ${taskDeletedGuard(taskCols, 't')} ${scopedTaskJoin}
     WHERE p.org_id = $1
       ${idFilter ? 'AND p.id = $2' : ''}
       AND COALESCE(NULLIF(p.status, ''), 'active') <> 'archived'
  `;
}

function legacySelectSql({ categoryCols, taskCols, personalOnly = false, userParam = null, idFilter = false }) {
  const scopedTaskJoin = personalOnly && userParam ? `AND t.assigned_to = $${userParam}` : '';
  const description = categoryCols.has('description') ? 'tc.description' : 'NULL::text AS description';
  const icon = categoryCols.has('icon') ? 'tc.icon' : 'NULL::text AS icon';
  const color = categoryCols.has('color') ? 'tc.color' : 'NULL::text AS color';
  const createdAt = categoryCols.has('created_at') ? 'tc.created_at' : 'NOW() AS created_at';
  return `
    SELECT tc.id,
           tc.name,
           ${description},
           ${icon},
           ${color},
           ${legacyStatusSelect(categoryCols, 'tc')},
           ${legacyActiveSelect(categoryCols, 'tc')},
           ${createdAt},
           COUNT(t.id)::int AS task_count
      FROM task_categories tc
      LEFT JOIN tasks t ON t.category_id = tc.id ${taskDeletedGuard(taskCols, 't')} ${scopedTaskJoin}
     WHERE tc.org_id = $1
       ${idFilter ? 'AND tc.id = $2' : ''}
  `;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const role = normalizedRole(req);
    const personalOnly = isPersonalProjectRole(role);
    const scope = projectScopeForRole(role);
    if (!orgId) return res.json({ projects: [], meta: { scope, role } });

    const store = await resolveProjectStore();
    if (!store) return res.json({ projects: [], meta: { scope, role, store: null } });

    const taskCols = await getColumns('tasks');
    const params = [orgId];
    let userParam = null;
    let personalFilter = '';

    if (personalOnly) {
      params.push(req.user.id);
      userParam = params.length;
    }

    if (store === 'projects') {
      if (personalOnly) {
        personalFilter = ` AND EXISTS (
          SELECT 1 FROM tasks myt
           WHERE myt.project_id = p.id
             AND myt.org_id = p.org_id
             AND myt.assigned_to = $${userParam}
             ${taskDeletedGuard(taskCols, 'myt')}
        )`;
      }
      const { rows } = await query(
        `${projectSelectSql({ taskCols, personalOnly, userParam })}${personalFilter} GROUP BY p.id ORDER BY p.created_at DESC`,
        params
      );
      return res.json({ projects: rows, meta: { scope, role, store, personalOnly, fallback: true } });
    }

    const categoryCols = await getColumns('task_categories');
    if (personalOnly) {
      personalFilter = ` AND EXISTS (
        SELECT 1 FROM tasks myt
         WHERE myt.category_id = tc.id
           AND myt.org_id = tc.org_id
           AND myt.assigned_to = $${userParam}
           ${taskDeletedGuard(taskCols, 'myt')}
      )`;
    }
    const { rows } = await query(
      `${legacySelectSql({ categoryCols, taskCols, personalOnly, userParam })}${personalFilter} GROUP BY tc.id ORDER BY ${categoryCols.has('created_at') ? 'tc.created_at' : 'tc.id'} DESC`,
      params
    );
    return res.json({ projects: rows, meta: { scope, role, store, personalOnly, fallback: true } });
  } catch (err) {
    console.error('GET /projects fallback error:', err.message);
    next(err);
  }
});

router.get('/:projectId', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });

    const store = await resolveProjectStore();
    if (!store) return res.status(404).json({ error: 'Project not found' });

    const projectId = String(req.params.projectId || '').trim();
    const role = normalizedRole(req);
    const personalOnly = isPersonalProjectRole(role);
    const taskCols = await getColumns('tasks');
    const params = [orgId, projectId];
    let userParam = null;
    let personalFilter = '';

    if (personalOnly) {
      params.push(req.user.id);
      userParam = params.length;
    }

    let rows = [];
    if (store === 'projects') {
      if (personalOnly) {
        personalFilter = ` AND EXISTS (
          SELECT 1 FROM tasks myt
           WHERE myt.project_id = p.id
             AND myt.org_id = p.org_id
             AND myt.assigned_to = $${userParam}
             ${taskDeletedGuard(taskCols, 'myt')}
        )`;
      }
      ({ rows } = await query(`${projectSelectSql({ taskCols, personalOnly, userParam, idFilter: true })}${personalFilter} GROUP BY p.id`, params));
    } else {
      const categoryCols = await getColumns('task_categories');
      if (personalOnly) {
        personalFilter = ` AND EXISTS (
          SELECT 1 FROM tasks myt
           WHERE myt.category_id = tc.id
             AND myt.org_id = tc.org_id
             AND myt.assigned_to = $${userParam}
             ${taskDeletedGuard(taskCols, 'myt')}
        )`;
      }
      ({ rows } = await query(`${legacySelectSql({ categoryCols, taskCols, personalOnly, userParam, idFilter: true })}${personalFilter} GROUP BY tc.id`, params));
    }

    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    return res.json({ project: rows[0], taskCounts: { byStatus: {}, total: rows[0].task_count || 0 }, workers: [], leaders: [], recentThreads: [], deadlineSummary: { overdueCount: 0, dueWithin7Days: 0, nextDueAt: null, latestDueAt: null }, assigneeMetrics: [] });
  } catch (err) {
    console.error('GET /projects/:id fallback error:', err.message);
    next(err);
  }
});

router.post('/', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(400).json({ error: 'Organization ID not found in session' });

    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    const color = normalizeColor(req.body?.color);
    const icon = String(req.body?.icon || '').trim() || null;
    if (!name || name.length < 2) return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    if (name.length > 100) return res.status(400).json({ error: 'Project name is too long (max 100)' });

    const store = await resolveProjectStore();
    if (!store) return res.status(500).json({ error: 'Projects storage table is missing' });

    let created;
    if (store === 'projects') {
      const cols = await getColumns('projects');
      const fields = ['org_id', 'name', 'description'];
      const values = [orgId, name, description];
      if (cols.has('status')) { fields.push('status'); values.push('active'); }
      if (cols.has('created_by')) { fields.push('created_by'); values.push(req.user.id); }
      if (cols.has('updated_by')) { fields.push('updated_by'); values.push(req.user.id); }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await query(
        `INSERT INTO projects (${fields.join(', ')}) VALUES (${placeholders})
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, ${projectStatusSelect('projects')}, ${projectActiveSelect('projects')}, created_at`,
        values
      );
      created = rows[0];
    } else {
      const cols = await getColumns('task_categories');
      const fields = ['org_id', 'name', 'description'];
      const values = [orgId, name, description];
      if (cols.has('icon')) { fields.push('icon'); values.push(icon); }
      if (cols.has('color')) { fields.push('color'); values.push(color); }
      if (cols.has('is_active')) { fields.push('is_active'); values.push(true); }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await query(
        `INSERT INTO task_categories (${fields.join(', ')}) VALUES (${placeholders})
         RETURNING id, name, description,
                   ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                   ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                   ${legacyStatusSelect(cols, 'task_categories')},
                   ${legacyActiveSelect(cols, 'task_categories')},
                   ${cols.has('created_at') ? 'created_at' : 'NOW() AS created_at'}`,
        values
      );
      created = rows[0];
    }

    try {
      await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_created', metadata: { projectId: created.id, projectName: name, fallback: true } });
      await notifyOrgLeaders(orgId, { type: 'project_created', title: 'New project created', body: name, data: { projectId: created.id }, excludeUserId: req.user.id });
    } catch { /* non-critical */ }

    return res.status(201).json({ project: created });
  } catch (err) {
    console.error('POST /projects fallback error:', err.message);
    next(err);
  }
});

router.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });
    const projectId = String(req.params.projectId || '').trim();
    const taskCols = await getColumns('tasks');
    const tables = await getTableNames();

    const relationParts = [];
    if (taskCols.has('category_id')) relationParts.push('t.category_id::text = $2::text');
    if (taskCols.has('project_id')) relationParts.push('t.project_id::text = $2::text');
    if (tables.has('project_tasks')) relationParts.push('EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id::text = $2::text)');
    if (!relationParts.length) return res.json({ tasks: [] });

    const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
    if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (taskCols.has('status')) conditions.push(`COALESCE(t.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`);

    const assigneeJoin = taskCols.has('assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : '';
    const assigneeSel = taskCols.has('assigned_to') ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name` : `'Unassigned' AS assignee_name`;
    const titleSel = taskCols.has('title') ? 't.title' : 't.id::text AS title';
    const prioritySel = taskCols.has('priority') ? 't.priority' : 'NULL::text AS priority';
    const dueSel = taskCols.has('due_date') ? 't.due_date' : 'NULL::timestamptz AS due_date';
    const statusSel = taskCols.has('status') ? `COALESCE(t.status,'pending') AS status` : `'pending'::text AS status`;

    const { rows } = await query(
      `SELECT t.id, ${titleSel}, ${statusSel}, ${prioritySel}, ${dueSel}, ${assigneeSel}
         FROM tasks t
         ${assigneeJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${taskCreatedOrder(taskCols, 't')}
        LIMIT 50`,
      [orgId, projectId]
    );
    return res.json({ tasks: rows, meta: { fallback: true } });
  } catch (err) {
    next(err);
  }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;
    if (requestedStatus || typeof req.body?.is_active === 'boolean') {
      return res.status(409).json({
        error: 'Project lifecycle changes must use the canonical lifecycle route.',
        code: 'PROJECT_LIFECYCLE_ROUTE_REMOVED',
      });
    }

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
      values.push(name); sets.push(`name = $${values.length}`);
    }
    if (typeof req.body?.description === 'string') {
      values.push(req.body.description.trim() || null); sets.push(`description = $${values.length}`);
    }

    if (store === 'projects') {
      const cols = await getColumns('projects');
      if (cols.has('updated_by')) { values.push(req.user.id); sets.push(`updated_by = $${values.length}`); }
      if (cols.has('updated_at')) sets.push('updated_at = NOW()');
      if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });
      values.push(orgId, projectId);
      const { rows } = await query(
        `UPDATE projects SET ${sets.join(', ')}
          WHERE org_id = $${values.length - 1} AND id = $${values.length}
          RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, ${projectStatusSelect('projects')}, ${projectActiveSelect('projects')}, created_at`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Project not found' });
      return res.json({ project: rows[0] });
    }

    const cols = await getColumns('task_categories');
    if (cols.has('icon') && typeof req.body?.icon === 'string') { values.push(req.body.icon.trim() || null); sets.push(`icon = $${values.length}`); }
    if (cols.has('color') && typeof req.body?.color === 'string') { values.push(normalizeColor(req.body.color)); sets.push(`color = $${values.length}`); }
    if (cols.has('updated_at')) sets.push('updated_at = NOW()');
    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });
    values.push(orgId, projectId);
    const { rows } = await query(
      `UPDATE task_categories SET ${sets.join(', ')}
        WHERE org_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id, name, description,
                  ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                  ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                  ${legacyStatusSelect(cols, 'task_categories')},
                  ${legacyActiveSelect(cols, 'task_categories')},
                  ${cols.has('created_at') ? 'created_at' : 'NOW() AS created_at'}`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    return res.json({ project: rows[0] });
  } catch (err) {
    console.error('PATCH /projects fallback error:', err.message);
    next(err);
  }
});

module.exports = router;
