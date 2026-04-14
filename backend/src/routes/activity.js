const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');

async function getScopedTargetUserIds(user) {
  const orgId = user.org_id ?? user.orgId;
  let targetUserIds = [user.id];

  if (isOrgWideRole(user.role)) {
    const { rows: orgUsers } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE`,
      [orgId]
    );
    targetUserIds = orgUsers.map(r => r.id);
  } else if (['supervisor', 'manager'].includes(user.role)) {
    const { rows: subs } = await query(
      `SELECT user_id FROM get_subordinate_ids($1)`,
      [user.id]
    );
    targetUserIds = [user.id, ...subs.map(r => r.user_id)];
  }

  return targetUserIds;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const targetUserIds = await getScopedTargetUserIds(req.user);
    const { days = 30, type = '' } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 300);

    const params = [orgId, targetUserIds];
    const conditions = ['org_id = $1', 'user_id = ANY($2)'];
    let p = 3;

    if (type) {
      conditions.push(`activity_type = $${p++}`);
      params.push(type);
    }

    if (days && Number.isFinite(parseInt(days, 10))) {
      conditions.push(`created_at >= NOW() - ($${p++}::int * INTERVAL '1 day')`);
      params.push(parseInt(days, 10));
    }

    const { rows: logs } = await query(`
      SELECT id, org_id, user_id, task_id, activity_type, metadata, created_at
      FROM user_activity_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${p}
    `, [...params, limit]);

    const userIds = [...new Set(logs.map(item => item.user_id).filter(Boolean))];
    const taskIds = [...new Set(logs.map(item => item.task_id).filter(Boolean))];

    const [usersRes, tasksRes] = await Promise.all([
      userIds.length
        ? query(`SELECT id, full_name, role FROM users WHERE org_id = $1 AND id = ANY($2)`, [orgId, userIds])
        : Promise.resolve({ rows: [] }),
      taskIds.length
        ? query(`SELECT id, title, status FROM tasks WHERE org_id = $1 AND id = ANY($2)`, [orgId, taskIds])
        : Promise.resolve({ rows: [] })
    ]);

    const userMap = Object.fromEntries(usersRes.rows.map(u => [u.id, u]));
    const taskMap = Object.fromEntries(tasksRes.rows.map(t => [t.id, t]));

    res.json({
      logs: logs.map(item => ({
        ...item,
        user_name: userMap[item.user_id]?.full_name || 'Unknown',
        user_role: userMap[item.user_id]?.role || null,
        task_title: item.task_id ? (taskMap[item.task_id]?.title || 'Task') : null,
        task_status: item.task_id ? (taskMap[item.task_id]?.status || null) : null
      }))
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
