const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');

async function getScopedAssigneeFilter(user) {
  const orgId = user.org_id ?? user.orgId;
  let assigneeFilter = [];
  if (isOrgWideRole(user.role)) {
    let { rows } = await query(`SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE`, [orgId]);
    if (!rows.length) ({ rows } = await query(`SELECT id FROM users WHERE org_id = $1`, [orgId]));
    assigneeFilter = rows.map(r => r.id);
  } else {
    const { rows: subs } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [user.id]);
    assigneeFilter = [user.id, ...subs.map(r => r.user_id)];
  }
  return assigneeFilter;
}

function calculateScore({ total, completed, overdue, rejected, onTimeCompleted }) {
  const t = Number(total) || 0;
  const c = Number(completed) || 0;
  const o = Number(overdue) || 0;
  const r = Number(rejected) || 0;
  const ot = Number(onTimeCompleted) || 0;
  
  if (!t) return 0;
  const completionRate = c / t;
  const onTimeRate = c ? ot / c : 0;
  const rejectionRate = r / t;
  const overdueRate = o / t;
  const raw = (completionRate * 55) + (onTimeRate * 35) - (rejectionRate * 20) - (overdueRate * 10);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

router.get('/summary', authenticate, requireAnyRole('hr', 'manager', 'supervisor', 'director', 'admin'), async (req, res, next) => {
  try {
    const u = req.user;
    const orgId = u.org_id ?? u.orgId;
    const assigneeFilter = await getScopedAssigneeFilter(u);

    if (!assigneeFilter.length) {
      return res.json({
        scope: isOrgWideRole(u.role) ? 'organization' : 'team',
        totalTasks: 0,
        byStatus: {},
        userCount: 0,
        byAssignee: {},
        assigneeLeaderboard: [],
        workload: { averageOpenTasks: 0, overloaded: [], underutilized: [] },
        teamPerformanceScore: 0
      });
    }

    const { rows: statusRows } = await query(
      `SELECT status, COUNT(*)::int AS c FROM tasks
       WHERE org_id = $1 AND assigned_to = ANY($2)
       GROUP BY status`,
      [orgId, assigneeFilter]
    );

    const byStatus = {};
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = r.c;
      total += r.c;
    }

    const { rows: taskRows } = await query(
      `SELECT id, assigned_to, status, due_date, completed_at
       FROM tasks WHERE org_id = $1 AND assigned_to = ANY($2)`,
      [orgId, assigneeFilter]
    );

    const byAssignee = {};
    const byAssigneeStatus = {};
    for (const r of taskRows) {
      const k = String(r.assigned_to);
      if (!byAssignee[k]) byAssignee[k] = { total: 0, completed: 0, active: 0, overdue: 0, rejected: 0, onTimeCompleted: 0 };
      byAssignee[k].total++;
      if (r.status === 'completed') {
        byAssignee[k].completed++;
        if (!r.due_date || !r.completed_at || new Date(r.completed_at) <= new Date(r.due_date)) {
          byAssignee[k].onTimeCompleted++;
        }
      }
      if (['pending', 'in_progress', 'submitted', 'ai_reviewing'].includes(r.status)) byAssignee[k].active++;
      if (r.status === 'overdue') byAssignee[k].overdue++;
      if (['ai_rejected', 'manager_rejected'].includes(r.status)) byAssignee[k].rejected++;
      if (!byAssigneeStatus[k]) byAssigneeStatus[k] = {};
      byAssigneeStatus[k][r.status] = (byAssigneeStatus[k][r.status] || 0) + 1;
    }

    const { rows: nameRows } = await query(
      `SELECT id, full_name, department, role, last_login_at FROM users WHERE org_id = $1 AND id = ANY($2)`,
      [orgId, assigneeFilter]
    );
    const idToUser = Object.fromEntries(nameRows.map(r => [String(r.id), r]));

    const activityRows = await query(
      `SELECT user_id, activity_type, created_at
       FROM user_activity_logs
       WHERE org_id = $1 AND user_id = ANY($2)
         AND created_at >= NOW() - INTERVAL '14 days'
       ORDER BY created_at DESC`,
      [orgId, assigneeFilter]
    );
    const activityByUser = {};
    for (const row of activityRows.rows) {
      const key = String(row.user_id);
      if (!activityByUser[key]) activityByUser[key] = [];
      activityByUser[key].push(row);
    }

    const leaderboard = Object.entries(byAssignee)
      .map(([userId, v]) => {
        const uid = String(userId);
        const userMeta = idToUser[uid] || {};
        const score = calculateScore(v);
        const recentActivity = activityByUser[uid] || [];
        return {
          userId: uid,
          name: userMeta.full_name || 'Unknown',
          department: userMeta.department || null,
          role: userMeta.role || null,
          lastLoginAt: userMeta.last_login_at || null,
          lastActivityAt: recentActivity[0]?.created_at || userMeta.last_login_at || null,
          ...v,
          statusBreakdown: byAssigneeStatus[uid] || {},
          completionRate: v.total ? Math.round((v.completed / v.total) * 100) : 0,
          onTimeRate: v.completed ? Math.round((v.onTimeCompleted / v.completed) * 100) : 0,
          performanceScore: score,
          activityCount14d: recentActivity.length
        };
      })
      .sort((a, b) => (b.performanceScore - a.performanceScore) || (b.total - a.total));

    const openLoads = leaderboard.map(x => x.active);
    const avgOpen = openLoads.length ? openLoads.reduce((s, n) => s + n, 0) / openLoads.length : 0;
    const overloaded = leaderboard.filter(x => x.active > Math.max(3, Math.ceil(avgOpen + 2)));
    const underutilized = leaderboard.filter(x => x.active < Math.max(0, Math.floor(avgOpen - 2)));
    const teamPerformanceScore = leaderboard.length
      ? Math.round(leaderboard.reduce((s, x) => s + x.performanceScore, 0) / leaderboard.length)
      : 0;

    res.json({
      scope: isOrgWideRole(u.role) ? 'organization' : 'team',
      totalTasks: total,
      byStatus,
      userCount: assigneeFilter.length,
      byAssignee,
      assigneeLeaderboard: leaderboard,
      workload: {
        averageOpenTasks: Number(avgOpen.toFixed(1)),
        overloaded: overloaded.map(x => ({ userId: x.userId, name: x.name, active: x.active, performanceScore: x.performanceScore })),
        underutilized: underutilized.map(x => ({ userId: x.userId, name: x.name, active: x.active, performanceScore: x.performanceScore }))
      },
      teamPerformanceScore
    });
  } catch (err) { next(err); }
});

router.get('/activity', authenticate, requireAnyRole('hr', 'manager', 'supervisor', 'director', 'admin'), async (req, res, next) => {
  try {
    const u = req.user;
    const orgId = u.org_id ?? u.orgId;
    const assigneeFilter = await getScopedAssigneeFilter(u);
    const { rows } = await query(
      `SELECT user_id, activity_type, task_id, metadata, created_at
       FROM user_activity_logs
       WHERE org_id = $1 AND user_id = ANY($2)
       ORDER BY created_at DESC
       LIMIT 200`,
      [orgId, assigneeFilter]
    );
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

module.exports = router;
