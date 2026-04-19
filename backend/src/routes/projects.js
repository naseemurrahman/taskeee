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
  const orgId = await orgIdForSessionUser(req);
  if (!orgId) {
    throw new Error('Organization ID not found in session');
  }
  return String(orgId);
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);

    const { rows } = await query(
      `SELECT id, name, description, icon, color, is_active, created_at
       FROM task_categories
       WHERE org_id = $1::uuid AND is_active = TRUE
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
    const projectId = String(req.params.projectId || '').trim();

    const { rows: projRows } = await query(
      `SELECT id, name, description, icon, color, is_active, created_at
       FROM task_categories
       WHERE org_id = $1::uuid AND id = $2::uuid`,
      [orgId, projectId]
    );

    if (!projRows.length) return res.status(404).json({ error: 'Project not found' });

    // ... (your existing detail queries remain the same - I kept them unchanged for now)

    const [
      { rows: statusRows },
      { rows: workerRows },
      { rows: leaderRows },
      { rows: threadRows },
      { rows: deadlineRows },
      { rows: assigneeRows },
    ] = await Promise.all([ /* your existing Promise.all block */ ]);

    // ... (rest of your response formatting remains the same)

    res.json({
      project: projRows[0],
      taskCounts: { 
        byStatus: statusRows.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {}),
        total: statusRows.reduce((s, r) => s + r.n, 0)
      },
      workers: workerRows,
      leaders: leaderRows,
      recentThreads: threadRows,
      deadlineSummary: {
        overdueCount: deadlineRows[0]?.overdue_count || 0,
        dueWithin7Days: deadlineRows[0]?.due_within_7d || 0,
        nextDueAt: deadlineRows[0]?.next_due_at || null,
        latestDueAt: deadlineRows[0]?.latest_due_at || null,
      },
      assigneeMetrics: assigneeRows.map(r => ({
        id: r.id,
        name: r.full_name,
        active: r.active || 0,
        completed: r.completed || 0,
        overdue: r.overdue_n || 0,
        totalTasks: r.total_tasks || 0,
        performanceScore: Math.max(0, Math.min(100, 
          r.total_tasks ? Math.round((r.completed / r.total_tasks) * 100) - (r.overdue_n || 0) * 4 : 0
        ))
      }))
    });
  } catch (err) {
    console.error('GET /projects/:id error:', err.message);
    next(err);
  }
});

router.post('/', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);

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

    const { rows } = await query(
      `INSERT INTO task_categories (org_id, name, description, icon, color, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, description, icon, color, is_active, created_at`,
      [orgId, name, description, icon, color]
    );

    // Log activity and notify
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
    if (err.message.includes('Invalid field referenced') || err.code === 'P2009') {
      return res.status(400).json({ 
        error: "Invalid field referenced in query. Database schema mismatch detected." 
      });
    }
    next(err);
  }
});

router.patch('/:projectId', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    const projectId = String(req.params.projectId || '').trim();

    // ... (your existing patch logic - unchanged for now, but wrapped safely)

    // (Keep your current patch code here - I didn't change it to avoid breaking updates)

    res.json({ project: rows[0] });
  } catch (err) {
    console.error('PATCH /projects error:', err.message);
    next(err);
  }
});

module.exports = router;
