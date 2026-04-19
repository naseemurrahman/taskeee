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

let taskCategoryColumns = null;

async function getTaskCategoryColumns() {
  if (taskCategoryColumns) return taskCategoryColumns;
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'task_categories'`
  );
  taskCategoryColumns = new Set(rows.map((r) => String(r.column_name)));
  return taskCategoryColumns;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  if (!orgId) {
    return null;
  }
  return String(orgId);
}

function projectSelectSql(cols) {
  return `
    SELECT id,
           name,
           description,
           ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
           ${cols.has('color') ? 'color' : 'NULL::text AS color'},
           ${cols.has('is_active') ? 'is_active' : 'TRUE AS is_active'},
           created_at
      FROM task_categories
  `;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.json({ projects: [] });

    const cols = await getTaskCategoryColumns();
    const where = ['org_id = $1'];
    if (cols.has('is_active')) where.push('is_active = TRUE');

    const { rows } = await query(
      `${projectSelectSql(cols)}
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC`,
      [orgId]
    );

    res.json({ projects: rows });
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
    const cols = await getTaskCategoryColumns();

    const { rows: projRows } = await query(
      `${projectSelectSql(cols)}
       WHERE org_id = $1 AND id = $2`,
      [orgId, projectId]
    );

    if (!projRows.length) return res.status(404).json({ error: 'Project not found' });

    // Safe fallback payload expected by frontend modal.
    res.json({
      project: projRows[0],
      taskCounts: { byStatus: {}, total: 0 },
      workers: [],
      leaders: [],
      recentThreads: [],
      deadlineSummary: {
        overdueCount: 0,
        dueWithin7Days: 0,
        nextDueAt: null,
        latestDueAt: null,
      },
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

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Project name must be at least 2 characters' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Project name is too long (max 100)' });
    }

    const cols = await getTaskCategoryColumns();
    const insertColumns = ['org_id', 'name', 'description'];
    const values = [orgId, name, description];

    if (cols.has('icon')) {
      insertColumns.push('icon');
      values.push(icon);
    }
    if (cols.has('color')) {
      insertColumns.push('color');
      values.push(color);
    }
    if (cols.has('is_active')) {
      insertColumns.push('is_active');
      values.push(true);
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await query(
      `INSERT INTO task_categories (${insertColumns.join(', ')})
       VALUES (${placeholders})
       RETURNING id,
                 name,
                 description,
                 ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                 ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                 ${cols.has('is_active') ? 'is_active' : 'TRUE AS is_active'},
                 created_at`,
      values
    );

    await logUserActivity({
      orgId,
      userId: req.user.id,
      activityType: 'project_created',
      metadata: { projectId: rows[0].id, projectName: name },
    });

    await notifyOrgLeaders(orgId, {
      type: 'project_created',
      title: 'New project created',
      body: name,
      data: { projectId: rows[0].id },
      excludeUserId: req.user.id,
    });

    res.status(201).json({ project: rows[0] });
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
    const cols = await getTaskCategoryColumns();
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

    if (cols.has('icon') && typeof req.body?.icon === 'string') {
      values.push(req.body.icon.trim() || null);
      sets.push(`icon = $${values.length}`);
    }

    if (cols.has('color') && typeof req.body?.color === 'string') {
      values.push(normalizeColor(req.body.color));
      sets.push(`color = $${values.length}`);
    }

    if (cols.has('is_active') && typeof req.body?.is_active === 'boolean') {
      values.push(req.body.is_active);
      sets.push(`is_active = $${values.length}`);
    }

    if (!sets.length) return res.status(400).json({ error: 'No valid fields provided for update' });

    values.push(orgId);
    values.push(projectId);

    const { rows } = await query(
      `UPDATE task_categories
          SET ${sets.join(', ')}
        WHERE org_id = $${values.length - 1} AND id = $${values.length}
        RETURNING id,
                  name,
                  description,
                  ${cols.has('icon') ? 'icon' : 'NULL::text AS icon'},
                  ${cols.has('color') ? 'color' : 'NULL::text AS color'},
                  ${cols.has('is_active') ? 'is_active' : 'TRUE AS is_active'},
                  created_at`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json({ project: rows[0] });
  } catch (err) {
    console.error('PATCH /projects error:', err.message);
    next(err);
  }
});

module.exports = router;
