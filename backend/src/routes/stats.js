'use strict';
/**
 * GET /api/v1/stats
 *
 * Lightweight org-level stats endpoint used by the dashboard header,
 * sidebar quick-stats, and any widget that needs a fast count summary
 * without loading the full performance summary.
 *
 * Returns counts scoped to the caller's role:
 *   - Admin/HR/Director: org-wide
 *   - Manager/Supervisor: subtree
 *   - Employee: self only
 */
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');

async function getScopedIds(user) {
  const orgId = user.org_id ?? user.orgId;
  if (isOrgWideRole(user.role)) {
    const { rows } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE`, [orgId]
    );
    return rows.map(r => r.id);
  }
  if (['supervisor', 'manager', 'director'].includes(user.role)) {
    const { rows } = await query(
      `SELECT user_id FROM get_subordinate_ids($1)`, [user.id]
    );
    return [user.id, ...rows.map(r => r.user_id)];
  }
  return [user.id];
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedIds(req.user);

    const [taskStats, userStats, pendingApprovals] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int                                              AS total,
          COUNT(*) FILTER (WHERE status = 'in_progress')::int       AS in_progress,
          COUNT(*) FILTER (WHERE status = 'completed'
                             OR  status = 'manager_approved')::int  AS completed,
          COUNT(*) FILTER (WHERE status = 'overdue')::int           AS overdue,
          COUNT(*) FILTER (WHERE status = 'submitted')::int         AS submitted,
          COUNT(*) FILTER (WHERE status = 'pending')::int           AS pending,
          COUNT(*) FILTER (
            WHERE due_date IS NOT NULL
              AND due_date::date = CURRENT_DATE
              AND status NOT IN ('completed','manager_approved','overdue')
          )::int AS due_today
        FROM tasks
        WHERE org_id = $1
          AND assigned_to = ANY($2)
      `, [orgId, scopedIds]),

      isOrgWideRole(req.user.role) ? query(`
        SELECT
          COUNT(*)::int                                      AS total,
          COUNT(*) FILTER (WHERE is_active = TRUE)::int     AS active,
          COUNT(*) FILTER (WHERE role = 'employee')::int    AS employees,
          COUNT(*) FILTER (WHERE role IN ('manager','supervisor','director'))::int AS managers
        FROM users WHERE org_id = $1
      `, [orgId]) : Promise.resolve({ rows: [null] }),

      query(`
        SELECT COUNT(*)::int AS count
        FROM tasks
        WHERE org_id = $1
          AND status = 'submitted'
          AND assigned_to = ANY($2)
      `, [orgId, scopedIds]),
    ]);

    const tasks = taskStats.rows[0] || {};
    const users = userStats.rows[0] || null;

    res.json({
      tasks: {
        total:       tasks.total       ?? 0,
        in_progress: tasks.in_progress ?? 0,
        completed:   tasks.completed   ?? 0,
        overdue:     tasks.overdue     ?? 0,
        submitted:   tasks.submitted   ?? 0,
        pending:     tasks.pending     ?? 0,
        due_today:   tasks.due_today   ?? 0,
      },
      users: users ? {
        total:    users.total    ?? 0,
        active:   users.active   ?? 0,
        employees:users.employees?? 0,
        managers: users.managers ?? 0,
      } : null,
      pending_approvals: pendingApprovals.rows[0]?.count ?? 0,
      scope: isOrgWideRole(req.user.role) ? 'org' : 'team',
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /stats/dashboard — comprehensive real-time dashboard data
router.get('/dashboard', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedIds(req.user);
    if (!scopedIds.length) return res.json({ tasks: {}, trend: [], projects: [], leaderboard: [], priority: {}, velocity: [], heatmap: [] });

    // 1. Overall task counts
    const { rows: [taskCounts] } = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='in_progress')::int AS in_progress,
        COUNT(*) FILTER (WHERE status='submitted')::int AS submitted,
        COUNT(*) FILTER (WHERE status IN ('completed','manager_approved'))::int AS completed,
        COUNT(*) FILTER (WHERE status='overdue')::int AS overdue,
        COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled,
        ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('completed','manager_approved')) / NULLIF(COUNT(*),0),1)::float AS completion_rate,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date::date = CURRENT_DATE AND status NOT IN ('completed','manager_approved'))::int AS due_today,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date::date <= CURRENT_DATE + 7 AND status NOT IN ('completed','manager_approved'))::int AS due_week
      FROM tasks WHERE org_id=$1 AND assigned_to=ANY($2)
    `, [orgId, scopedIds]);

    // 2. Daily activity trend (last 30 days)
    // Created, completed, and overdue have different natural date sources.
    // This query builds a calendar first, then counts each metric against its correct day:
    // - created: created_at::date
    // - completed: completed_at::date when present, otherwise updated_at::date for approved/completed tasks
    // - overdue: due_date::date for currently overdue tasks
    const { rows: trend } = await query(`
      WITH days AS (
        SELECT generate_series(CURRENT_DATE - INTERVAL '29 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
      )
      SELECT
        d.day::text AS day,
        TO_CHAR(d.day, 'Mon DD') AS label,
        COUNT(t.id) FILTER (WHERE t.created_at::date = d.day)::int AS created,
        COUNT(t.id) FILTER (
          WHERE t.status IN ('completed','manager_approved')
            AND COALESCE(t.completed_at, t.updated_at)::date = d.day
        )::int AS completed,
        COUNT(t.id) FILTER (
          WHERE t.status = 'overdue'
            AND t.due_date IS NOT NULL
            AND t.due_date::date = d.day
        )::int AS overdue
      FROM days d
      LEFT JOIN tasks t
        ON t.org_id = $1
       AND t.assigned_to = ANY($2)
       AND (
          t.created_at::date = d.day
          OR COALESCE(t.completed_at, t.updated_at)::date = d.day
          OR (t.due_date IS NOT NULL AND t.due_date::date = d.day)
       )
      GROUP BY d.day
      ORDER BY d.day
    `, [orgId, scopedIds]);

    // 3. Project progress
    const { rows: projRows } = await query(`
      SELECT
        c.id, c.name, c.color,
        COUNT(t.id)::int AS total,
        COUNT(t.id) FILTER (WHERE t.status IN ('completed','manager_approved'))::int AS completed,
        COUNT(t.id) FILTER (WHERE t.status='overdue')::int AS overdue,
        COUNT(t.id) FILTER (WHERE t.status='in_progress')::int AS in_progress,
        COUNT(t.id) FILTER (WHERE t.status='pending')::int AS pending,
        MIN(t.due_date)::text AS earliest_due,
        MAX(t.due_date)::text AS latest_due,
        c.created_at::text AS start_date
      FROM task_categories c
      LEFT JOIN tasks t ON t.category_id = c.id AND t.org_id = c.org_id AND t.assigned_to = ANY($2)
      WHERE c.org_id=$1
      GROUP BY c.id, c.name, c.color, c.created_at
      ORDER BY c.created_at DESC
      LIMIT 12
    `, [orgId, scopedIds]);

    const projects = projRows.map(p => ({
      ...p,
      progress: p.total ? Math.round((p.completed / p.total) * 100) : 0,
    }));

    // 4. Leaderboard with completion rates
    const { rows: lbRows } = await query(`
      SELECT
        u.id, u.full_name AS name, u.department, u.role,
        COUNT(t.id)::int AS total,
        COUNT(t.id) FILTER (WHERE t.status IN ('completed','manager_approved'))::int AS completed,
        COUNT(t.id) FILTER (WHERE t.status='overdue')::int AS overdue,
        COUNT(t.id) FILTER (WHERE t.status='in_progress')::int AS in_progress,
        ROUND(100.0 * COUNT(t.id) FILTER (WHERE t.status IN ('completed','manager_approved')) / NULLIF(COUNT(t.id),0),1)::float AS completion_rate
      FROM users u
      LEFT JOIN tasks t ON t.assigned_to = u.id AND t.org_id = u.org_id
      WHERE u.org_id=$1 AND u.id=ANY($2) AND u.is_active=TRUE
      GROUP BY u.id, u.full_name, u.department, u.role
      ORDER BY completion_rate DESC NULLS LAST, total DESC
      LIMIT 10
    `, [orgId, scopedIds]);

    const leaderboard = lbRows.map(r => {
      const overdueRatio = r.total ? (r.overdue / r.total) * 100 : 0;
      const score = Math.max(0, Math.min(100, Math.round(
        (r.completion_rate || 0) * 0.6 - overdueRatio * 0.4
      )));
      return { ...r, score };
    });

    // 5. Priority breakdown
    const { rows: prioRows } = await query(`
      SELECT priority, COUNT(*)::int AS count
      FROM tasks WHERE org_id=$1 AND assigned_to=ANY($2) AND priority IS NOT NULL
      GROUP BY priority
    `, [orgId, scopedIds]);
    const priority = Object.fromEntries(prioRows.map(r => [r.priority, r.count]));

    // 6. Weekly velocity (last 8 weeks)
    const { rows: velRows } = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'Mon DD') AS week,
        DATE_TRUNC('week', created_at)::text AS week_start,
        COUNT(*)::int AS created,
        COUNT(*) FILTER (WHERE status IN ('completed','manager_approved'))::int AS completed
      FROM tasks
      WHERE org_id=$1 AND assigned_to=ANY($2)
        AND created_at >= NOW() - INTERVAL '8 weeks'
      GROUP BY week, week_start ORDER BY week_start
    `, [orgId, scopedIds]);

    // 7. Status by project (for stacked chart)
    const { rows: statusByProjRows } = await query(`
      SELECT c.name AS project, t.status, COUNT(*)::int AS count
      FROM tasks t
      JOIN task_categories c ON c.id = t.category_id
      WHERE t.org_id=$1 AND t.assigned_to=ANY($2) AND t.category_id IS NOT NULL
      GROUP BY c.name, t.status
      LIMIT 100
    `, [orgId, scopedIds]);

    const projStatusMap = {};
    for (const r of statusByProjRows) {
      if (!projStatusMap[r.project]) projStatusMap[r.project] = { project: r.project };
      projStatusMap[r.project][r.status] = r.count;
    }
    const projectStatusChart = Object.values(projStatusMap).slice(0, 8);

    res.json({
      tasks: taskCounts || {},
      trend,
      projects,
      leaderboard,
      priority,
      velocity: velRows,
      projectStatusChart,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

module.exports = router;
