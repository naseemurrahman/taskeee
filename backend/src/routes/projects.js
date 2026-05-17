const express = require('express');
const { logAudit } = require('../services/auditService');
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
let taskCategoryColumns = null;
let taskCategoryColumnsTs = 0; // timestamp of last fetch
let projectColumns = null;
let taskColumns = null;

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
  const now = Date.now();
  // Re-fetch every 60s so newly-added columns (e.g. status from migration 028) are picked up
  if (taskCategoryColumns && (now - taskCategoryColumnsTs) < 60_000) return taskCategoryColumns;
  taskCategoryColumns = await getColumns('task_categories');
  taskCategoryColumnsTs = now;
  return taskCategoryColumns;
}

async function getProjectColumns() {
  if (projectColumns) return projectColumns;
  projectColumns = await getColumns('projects');
  return projectColumns;
}

async function getTaskColumns() {
  if (taskColumns) return taskColumns;
  taskColumns = await getColumns('tasks');
  return taskColumns;
}

async function resolveProjectStore() {
  const tables = await getTableNames();
  // Canonical projects are the source of truth. Keep task_categories only as
  // a legacy fallback when the canonical projects table is absent.
  if (tables.has('projects')) return 'projects';
  if (tables.has('task_categories')) return 'task_categories';
  return null;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  if (!orgId) return null;
  return String(orgId);
}

async function countActiveProjectTasks(orgId, projectId) {
  try {
    const { rows } = await query(`SELECT active_project_task_count($1::uuid, $2::uuid)::int AS cnt`, [orgId, projectId]);
    if (rows[0]?.cnt != null) return parseInt(rows[0].cnt, 10) || 0;
  } catch {
    // Function may not exist until migrations run. Fall back to schema-aware SQL below.
  }

  const tables = await getTableNames();
  const taskCols = await getTaskColumns();
  const relationParts = [];
  if (taskCols.has('category_id')) relationParts.push('t.category_id = $2');
  if (taskCols.has('project_id')) relationParts.push('t.project_id = $2');
  if (tables.has('project_tasks')) relationParts.push('EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id = $2)');
  if (!relationParts.length) return 0;

  const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
  if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
  if (taskCols.has('status')) conditions.push(`COALESCE(t.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`);

  const { rows } = await query(
    `SELECT COUNT(DISTINCT t.id)::int AS cnt FROM tasks t WHERE ${conditions.join(' AND ')}`,
    [orgId, projectId]
  );
  return parseInt(rows[0]?.cnt || 0, 10);
}

async function recordProjectOverride({ orgId, actorUserId, projectId, activeTaskCount, reason }) {
  try {
    await query(
      `INSERT INTO governance_overrides (org_id, actor_user_id, entity_type, entity_id, action, reason, metadata)
       VALUES ($1, $2, 'project', $3, 'project.complete.override', $4, $5::jsonb)`,
      [orgId, actorUserId, projectId, reason, JSON.stringify({ activeTaskCount })]
    );
  } catch {
    // Governance override table can be absent before migrations run. Audit still records intent.
  }
}

function categorySelectSql(cols, personalOnly = false, userIdParam = null) {
  const scopedTaskJoin = personalOnly && userIdParam
    ? `AND t.assigned_to = $${userIdParam}`
    : '';
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
      LEFT JOIN tasks t ON t.category_id = tc.id AND t.deleted_at IS NULL ${scopedTaskJoin}
  `;
}

function legacyProjectSelectSql(personalOnly = false, userIdParam = null) {
  const scopedTaskJoin = personalOnly && userIdParam
    ? `AND t.assigned_to = $${userIdParam}`
    : '';
  return `
    SELECT p.id,
           p.name,
           p.description,
           NULL::text AS icon,
           NULL::text AS color,
           COALESCE(p.status, 'active') AS status,
           (COALESCE(p.status, 'active') = 'active') AS is_active,
           p.created_at,
           COUNT(t.id)::int AS task_count
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL ${scopedTaskJoin}
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

    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      const where = ['tc.org_id = $1'];
      const params = [orgId];
      if (cols.has('is_active')) where.push('tc.is_active = TRUE');
      let userParam = null;
      if (personalOnly) {
        params.push(req.user.id);
        userParam = params.length;
        where.push(`EXISTS (
          SELECT 1 FROM tasks myt
           WHERE myt.category_id = tc.id
             AND myt.org_id = tc.org_id
             AND myt.assigned_to = $${userParam}
             AND myt.deleted_at IS NULL
        )`);
      }
      const { rows } = await query(
        `${categorySelectSql(cols, personalOnly, userParam)} WHERE ${where.join(' AND ')} GROUP BY tc.id ORDER BY tc.created_at DESC`,
        params
      );
      return res.json({ projects: rows, meta: { scope, role, store, personalOnly } });
    }

    const cols = await getProjectColumns();
    const where = ['p.org_id = $1'];
    const params = [orgId];
    if (cols.has('status')) where.push(`p.status <> 'archived'`);
    let userParam = null;
    if (personalOnly) {
      params.push(req.user.id);
      userParam = params.length;
      where.push(`EXISTS (
        SELECT 1 FROM tasks myt
         WHERE myt.project_id = p.id
           AND myt.org_id = p.org_id
           AND myt.assigned_to = $${userParam}
           AND myt.deleted_at IS NULL
      )`);
    }
    const { rows } = await query(
      `${legacyProjectSelectSql(personalOnly, userParam)} WHERE ${where.join(' AND ')} GROUP BY p.id ORDER BY p.created_at DESC`,
      params
    );
    return res.json({ projects: rows, meta: { scope, role, store, personalOnly } });
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
    const role = normalizedRole(req);
    const personalOnly = isPersonalProjectRole(role);

    const store = await resolveProjectStore();
    if (!store) return res.status(404).json({ error: 'Project not found' });

    let projRows = [];
    if (store === 'task_categories') {
      const cols = await getTaskCategoryColumns();
      const params = [orgId, projectId];
      const personalSql = personalOnly ? ` AND EXISTS (SELECT 1 FROM tasks myt WHERE myt.category_id = tc.id AND myt.org_id = tc.org_id AND myt.assigned_to = $3 AND myt.deleted_at IS NULL)` : '';
      if (personalOnly) params.push(req.user.id);
      ({ rows: projRows } = await query(`${categorySelectSql(cols, personalOnly, personalOnly ? 3 : null)} WHERE tc.org_id = $1 AND tc.id = $2${personalSql} GROUP BY tc.id`, params));
    } else {
      const params = [orgId, projectId];
      const personalSql = personalOnly ? ` AND EXISTS (SELECT 1 FROM tasks myt WHERE myt.project_id = p.id AND myt.org_id = p.org_id AND myt.assigned_to = $3 AND myt.deleted_at IS NULL)` : '';
      if (personalOnly) params.push(req.user.id);
      ({ rows: projRows } = await query(`${legacyProjectSelectSql(personalOnly, personalOnly ? 3 : null)} WHERE p.org_id = $1 AND p.id = $2${personalSql} GROUP BY p.id`, params));
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
         RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at`,
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

// GET /:projectId/active-tasks — list active tasks for this project (for status-change popups)
router.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });
    const projectId = String(req.params.projectId || '').trim();
    const taskCols = await getTaskColumns();
    const tables = await getTableNames();

    const relationParts = [];
    if (taskCols.has('category_id')) relationParts.push('t.category_id = $2');
    if (taskCols.has('project_id')) relationParts.push('t.project_id = $2');
    if (tables.has('project_tasks')) relationParts.push('EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = t.id AND pt.project_id = $2)');
    if (!relationParts.length) return res.json({ tasks: [] });

    const conditions = ['t.org_id = $1', `(${relationParts.join(' OR ')})`];
    if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (taskCols.has('status')) conditions.push(`COALESCE(t.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`);

    const assigneeJoin = taskCols.has('assigned_to')
      ? `LEFT JOIN users u ON u.id = t.assigned_to`
      : '';
    const assigneeSel = taskCols.has('assigned_to')
      ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name`
      : `'Unassigned' AS assignee_name`;

    const { rows } = await query(
      `SELECT t.id, t.title, COALESCE(t.status,'pending') AS status,
              t.priority, t.due_date, ${assigneeSel}
         FROM tasks t
         ${assigneeJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.created_at DESC
        LIMIT 50`,
      [orgId, projectId]
    );
    return res.json({ tasks: rows });
  } catch (err) { next(err); }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Project not found' });
    const projectId = String(req.params.projectId || '').trim();
    const requestedStatus = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : null;

    // ── Paused guard: warn if active tasks still exist ───────────────────────
    if (requestedStatus === 'paused') {
      const activeCount = await countActiveProjectTasks(orgId, projectId);
      const force = req.body.force_pause === true;
      if (activeCount > 0 && !force) {
        return res.status(409).json({
          error: `This project has ${activeCount} active task(s). Pausing will halt all progress.`,
          code: 'PROJECT_HAS_ACTIVE_TASKS',
          activeTaskCount: activeCount,
          hint: 'Pass force_pause:true to proceed, or complete/cancel active tasks first.',
        });
      }
    }

    // ── Completion guard: block if active tasks still exist ──────────────────
    if (requestedStatus === 'completed') {
      const activeCount = await countActiveProjectTasks(orgId, projectId);
      const override = req.body.override_completion === true;

      if (activeCount > 0 && !override) {
        return res.status(409).json({
          error: `Cannot complete project: ${activeCount} active task(s) still in progress.`,
          code: 'PROJECT_HAS_ACTIVE_TASKS',
          activeTaskCount: activeCount,
          hint: 'Complete or cancel all tasks first, or pass override_completion:true with a reason (director/admin only).',
        });
      }

      if (activeCount > 0 && override) {
        if (!['director', 'admin'].includes(req.user.role)) {
          return res.status(403).json({ error: 'Only Director or Admin can override project completion with active tasks.' });
        }
        const reason = String(req.body.override_reason || req.body.reason || '').trim();
        if (reason.length < 8) return res.status(400).json({ error: 'override_reason is required and must be at least 8 characters.' });
        await recordProjectOverride({ orgId, actorUserId: req.user.id, projectId, activeTaskCount: activeCount, reason });
        await logAudit({
          orgId,
          actorUserId: req.user.id,
          action: 'project.complete.override',
          entityType: 'project',
          entityId: projectId,
          metadata: { activeTaskCount: activeCount, reason },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || null,
        });
      }
    }

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
      if (requestedStatus) {
        const allowed = new Set(['active', 'paused', 'completed']);
        const status = requestedStatus;
        if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
        // Ensure the status column exists (migration 028/029 adds it)
        // Add it unconditionally — if column missing, DB will error with a clear message
        if (cols.has('status')) {
          values.push(status); sets.push(`status = $${values.length}`);
        } else {
          // Column not detected yet — try adding it on the fly
          try {
            await query(`ALTER TABLE task_categories ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);
            values.push(status); sets.push(`status = $${values.length}`);
          } catch { /* ignore */ }
        }
        if (cols.has('is_active')) { values.push(status === 'active'); sets.push(`is_active = $${values.length}`); }
      }

      if (!sets.length) {
        // If nothing to set (no recognized columns), still mark as success with a no-op
        return res.json({ project: { id: projectId, status: requestedStatus || 'active' } });
      }
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
      // Log status change for task_categories path
      if (requestedStatus) {
        try {
          await logUserActivity({ orgId, userId: req.user.id, activityType: 'project_status_changed', metadata: { projectId, projectName: rows[0]?.name, newStatus: requestedStatus } });
          await logAudit({ orgId, actorUserId: req.user.id, action: 'project.status.changed', entityType: 'project', entityId: projectId, metadata: { newStatus: requestedStatus, projectName: rows[0]?.name }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
        } catch { /* non-critical */ }
      }

      // When project is paused, mark all active tasks as on_hold
      // When project is re-activated, restore on_hold tasks to pending
      if (requestedStatus === 'paused') {
        try {
          const taskCols = await getTaskColumns();
          if (taskCols.has('status') && taskCols.has('category_id')) {
            await query(
              `UPDATE tasks SET status = 'on_hold'
               WHERE org_id = $1 AND category_id = $2
               AND status NOT IN ('completed','manager_approved','cancelled','on_hold')
               AND deleted_at IS NULL`,
              [orgId, projectId]
            );
          }
        } catch { /* non-critical — tasks table may use different schema */ }
      } else if (requestedStatus === 'active') {
        try {
          const taskCols = await getTaskColumns();
          if (taskCols.has('status') && taskCols.has('category_id')) {
            await query(
              `UPDATE tasks SET status = 'pending'
               WHERE org_id = $1 AND category_id = $2
               AND status = 'on_hold'
               AND deleted_at IS NULL`,
              [orgId, projectId]
            );
          }
        } catch { /* non-critical */ }
      }

      return res.json({ project: rows[0] });
    }

    const cols = await getProjectColumns();
    if (cols.has('status') && typeof req.body?.is_active === 'boolean') {
      values.push(req.body.is_active ? 'active' : 'archived');
      sets.push(`status = $${values.length}`);
    }
    if (cols.has('status') && requestedStatus) {
      const allowed = new Set(['active', 'paused', 'completed']);
      const status = requestedStatus;
      if (!allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
      values.push(status);
      sets.push(`status = $${values.length}`);
    }

    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });
    values.push(orgId, projectId);

    const { rows } = await query(
      `UPDATE projects SET ${sets.join(', ')}
        WHERE org_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id, name, description, NULL::text AS icon, NULL::text AS color, COALESCE(status, 'active') AS status, (COALESCE(status, 'active') = 'active') AS is_active, created_at`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Project not found' });

    // ── Log status changes ──────────────────────────────────────────────────
    if (requestedStatus) {
      try {
        await logUserActivity({
          orgId,
          userId: req.user.id,
          activityType: 'project_status_changed',
          metadata: { projectId, projectName: rows[0]?.name, newStatus: requestedStatus },
        });
        await logAudit({
          orgId,
          actorUserId: req.user.id,
          action: 'project.status.changed',
          entityType: 'project',
          entityId: projectId,
          metadata: { newStatus: requestedStatus, projectName: rows[0]?.name },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || null,
        });
      } catch { /* non-critical */ }
    }

    return res.json({ project: rows[0] });
  } catch (err) {
    console.error('PATCH /projects error:', err.message);
    next(err);
  }
});

module.exports = router;
