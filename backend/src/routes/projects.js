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

async function resolveOrgId(req) {
  return await orgIdForSessionUser(req);
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    const { rows } = await query(
      `SELECT id, name, description, icon, color, is_active, created_at
       FROM task_categories
       WHERE org_id = $1::uuid AND is_active = TRUE
       ORDER BY created_at DESC`,
      [String(orgId)]
    );
    res.json({ projects: rows });
  } catch (err) {
    next(err);
  }
});

/** Detail for drawer/modal: people on tasks, assigners, recent discussion, counts */
router.get('/:projectId', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    const projectId = String(req.params.projectId || '').trim();

    const { rows: projRows } = await query(
      `SELECT id, name, description, icon, color, is_active, created_at
       FROM task_categories
       WHERE org_id = $1::uuid AND id = $2::uuid`,
      [String(orgId), projectId]
    );
    if (!projRows.length) return res.status(404).json({ error: 'Project not found' });

    const [
      { rows: statusRows },
      { rows: workerRows },
      { rows: leaderRows },
      { rows: threadRows },
      { rows: deadlineRows },
      { rows: assigneeRows },
    ] = await Promise.all([
      query(
        `SELECT status, COUNT(*)::int AS n
         FROM tasks
         WHERE org_id = $1::uuid AND category_id = $2::uuid
         GROUP BY status`,
        [String(orgId), projectId]
      ),
      query(
        `SELECT DISTINCT u.id, u.full_name, u.email
         FROM tasks t
         JOIN users u ON u.id = t.assigned_to
         WHERE t.org_id = $1::uuid AND t.category_id = $2::uuid AND t.assigned_to IS NOT NULL
         ORDER BY u.full_name NULLS LAST`,
        [String(orgId), projectId]
      ),
      query(
        `SELECT DISTINCT u.id, u.full_name, u.email
         FROM tasks t
         JOIN users u ON u.id = t.assigned_by
         WHERE t.org_id = $1::uuid AND t.category_id = $2::uuid AND t.assigned_by IS NOT NULL
         ORDER BY u.full_name NULLS LAST`,
        [String(orgId), projectId]
      ),
      query(
        `SELECT m.id, m.body, m.created_at, m.task_id,
                u.full_name AS sender_name,
                t.title AS task_title
         FROM task_messages m
         JOIN tasks t ON t.id = m.task_id AND t.org_id = m.org_id
         JOIN users u ON u.id = m.sender_id
         WHERE m.org_id = $1::uuid AND t.category_id = $2::uuid
         ORDER BY m.created_at DESC
         LIMIT 25`,
        [String(orgId), projectId]
      ),
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
           COUNT(*) FILTER (
             WHERE due_date IS NOT NULL
             AND due_date <= (CURRENT_TIMESTAMP + INTERVAL '7 days')
             AND status NOT IN ('completed','manager_approved')
           )::int AS due_within_7d,
           MIN(due_date) FILTER (
             WHERE due_date IS NOT NULL
             AND status NOT IN ('completed','manager_approved')
           ) AS next_due_at,
           MAX(due_date) FILTER (WHERE due_date IS NOT NULL) AS latest_due_at
         FROM tasks
         WHERE org_id = $1::uuid AND category_id = $2::uuid`,
        [String(orgId), projectId]
      ),
      query(
        `SELECT
           u.id,
           u.full_name,
           COUNT(*)::int AS total_tasks,
           COUNT(*) FILTER (WHERE t.status IN ('completed','manager_approved'))::int AS completed,
           COUNT(*) FILTER (WHERE t.status = 'overdue')::int AS overdue_n,
           COUNT(*) FILTER (
             WHERE t.status NOT IN ('completed','manager_approved','overdue')
           )::int AS active
         FROM tasks t
         JOIN users u ON u.id = t.assigned_to
         WHERE t.org_id = $1::uuid AND t.category_id = $2::uuid AND t.assigned_to IS NOT NULL
         GROUP BY u.id, u.full_name
         ORDER BY total_tasks DESC, u.full_name NULLS LAST`,
        [String(orgId), projectId]
      ),
    ]);

    const byStatus = {};
    for (const r of statusRows) byStatus[r.status] = r.n;

    const d0 = deadlineRows[0] || {};
    const deadlineSummary = {
      overdueCount: d0.overdue_count || 0,
      dueWithin7Days: d0.due_within_7d || 0,
      nextDueAt: d0.next_due_at || null,
      latestDueAt: d0.latest_due_at || null,
    };

    const assigneeMetrics = assigneeRows.map((r) => {
      const total = r.total_tasks || 0;
      const completed = r.completed || 0;
      const overdueN = r.overdue_n || 0;
      const base = total ? Math.round((completed / total) * 100) : 0;
      const performanceScore = Math.max(0, Math.min(100, base - overdueN * 4));
      return {
        id: r.id,
        name: r.full_name,
        active: r.active || 0,
        completed,
        overdue: overdueN,
        totalTasks: total,
        performanceScore,
      };
    });

    res.json({
      project: projRows[0],
      taskCounts: { byStatus, total: statusRows.reduce((s, r) => s + r.n, 0) },
      workers: workerRows,
      leaders: leaderRows,
      recentThreads: threadRows,
      deadlineSummary,
      assigneeMetrics,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    const icon = String(req.body?.icon || '').trim() || null;
    const color = normalizeColor(req.body?.color);

    if (!name || name.length < 2) return res.status(400).json({ error: 'Project name is required' });
    if (name.length > 100) return res.status(400).json({ error: 'Project name is too long' });

    const { rows } = await query(
      `INSERT INTO task_categories (org_id, name, description, icon, color, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, description, icon, color, is_active, created_at`,
      [String(orgId), name, description, icon, color]
    );
    await logUserActivity({
      orgId: String(orgId),
      userId: req.user.id,
      activityType: 'project_created',
      metadata: { projectId: rows[0].id, projectName: name },
    });
    await notifyOrgLeaders(String(orgId), {
      type: 'project_created',
      title: 'New project created',
      body: name,
      data: { projectId: rows[0].id },
      excludeUserId: req.user.id,
    });
    res.status(201).json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (orgId == null || orgId === '') {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    const projectId = req.params.projectId;
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    const icon = req.body?.icon != null ? String(req.body.icon).trim() : null;
    const color = req.body?.color != null ? normalizeColor(req.body.color) : null;
    const isActive = req.body?.is_active != null ? Boolean(req.body.is_active) : null;

    const fields = [];
    const params = [];
    let p = 1;

    if (name != null) { fields.push(`name = $${p++}`); params.push(name); }
    if (description != null) { fields.push(`description = $${p++}`); params.push(description || null); }
    if (icon != null) { fields.push(`icon = $${p++}`); params.push(icon || null); }
    if (color != null || req.body?.color === '') { fields.push(`color = $${p++}`); params.push(color); }
    if (isActive != null) { fields.push(`is_active = $${p++}`); params.push(isActive); }

    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

    params.push(orgId);
    params.push(projectId);

    const { rows } = await query(
      `UPDATE task_categories
       SET ${fields.join(', ')}
       WHERE org_id = $${p++} AND id = $${p++}
       RETURNING id, name, description, icon, color, is_active, created_at`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    await logUserActivity({
      orgId: String(orgId),
      userId: req.user.id,
      activityType: 'project_updated',
      metadata: { projectId: rows[0].id, projectName: rows[0].name },
    });
    await notifyOrgLeaders(String(orgId), {
      type: 'project_updated',
      title: 'Project updated',
      body: rows[0].name,
      data: { projectId: rows[0].id },
      excludeUserId: req.user.id,
    });
    res.json({ project: rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

