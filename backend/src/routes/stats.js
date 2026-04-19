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

module.exports = router;
