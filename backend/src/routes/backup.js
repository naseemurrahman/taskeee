const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');

async function getScopedUserIds(user) {
  const orgId = user.org_id ?? user.orgId;
  if (isOrgWideRole(user.role)) {
    const { rows } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE`,
      [orgId]
    );
    return rows.map((row) => row.id);
  }

  if (['supervisor', 'manager'].includes(user.role)) {
    const { rows } = await query(
      `SELECT user_id FROM get_subordinate_ids($1)`,
      [user.id]
    );
    return [user.id, ...rows.map((row) => row.user_id)];
  }

  return [user.id];
}

router.get('/export', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedUserIds = await getScopedUserIds(req.user);

    const [orgRes, usersRes, tasksRes, reportsRes, notificationsRes, integrationsRes, activityRes] = await Promise.all([
      query(
        `SELECT id, name, slug, plan, settings, created_at
         FROM organizations
         WHERE id = $1`,
        [orgId]
      ),
      query(
        `SELECT id, full_name, email, role, department, manager_id, employee_code, is_active, created_at
         FROM users
         WHERE org_id = $1 AND id = ANY($2)
         ORDER BY created_at DESC`,
        [orgId, scopedUserIds]
      ),
      query(
        `SELECT id, title, description, status, priority, assigned_to, assigned_by, due_date, created_at, updated_at, recurrence, metadata, parent_task_id
         FROM tasks
         WHERE org_id = $1 AND (assigned_to = ANY($2) OR assigned_by = $3)
         ORDER BY created_at DESC`,
        [orgId, scopedUserIds, req.user.id]
      ),
      query(
        `SELECT id, report_type, scope_type, metadata, created_at
         FROM reports
         WHERE org_id = $1
         ORDER BY created_at DESC`,
        [orgId]
      ),
      query(
        `SELECT n.id, n.user_id, n.title, n.body, n.type, n.is_read, n.created_at
         FROM notifications n
         WHERE n.user_id = ANY($1)
         ORDER BY n.created_at DESC`,
        [scopedUserIds]
      ),
      query(
        `SELECT id, integration_type, provider, config, is_active, created_at, last_sync_at, user_id
         FROM integrations_instances
         WHERE org_id = $1
         ORDER BY created_at DESC`,
        [orgId]
      ),
      query(
        `SELECT id, user_id, task_id, activity_type, metadata, created_at
         FROM user_activity_logs
         WHERE org_id = $1 AND user_id = ANY($2)
         ORDER BY created_at DESC
         LIMIT 1000`,
        [orgId, scopedUserIds]
      )
    ]);

    const snapshot = {
      exported_at: new Date().toISOString(),
      exported_by: {
        id: req.user.id,
        name: req.user.full_name,
        role: req.user.role
      },
      organization: orgRes.rows[0] || null,
      counts: {
        users: usersRes.rows.length,
        tasks: tasksRes.rows.length,
        reports: reportsRes.rows.length,
        notifications: notificationsRes.rows.length,
        integrations: integrationsRes.rows.length,
        activity_logs: activityRes.rows.length
      },
      users: usersRes.rows,
      tasks: tasksRes.rows,
      reports: reportsRes.rows,
      notifications: notificationsRes.rows,
      integrations: integrationsRes.rows,
      activity_logs: activityRes.rows
    };

    res.json({ snapshot });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
