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
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ tasks: [], users: [], reports: [], notifications: [], projects: [] });

    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedTargetUserIds(req.user);
    const like = `%${q}%`;

    const [tasksRes, usersRes, reportsRes, notifRes, projectsRes] = await Promise.all([
      query(`
        SELECT
          t.id, t.title, t.status, t.priority, t.assigned_to,
          u.full_name AS assigned_to_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.org_id = $1
          AND t.assigned_to = ANY($2)
          AND (
            t.title ILIKE $3 OR
            COALESCE(t.description, '') ILIKE $3 OR
            COALESCE(t.location, '') ILIKE $3 OR
            COALESCE(t.status, '') ILIKE $3
          )
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT 8
      `, [orgId, scopedIds, like]),
      query(`
        SELECT id, full_name, email, role, department
        FROM users
        WHERE org_id = $1
          AND is_active = TRUE
          AND (
            full_name ILIKE $2 OR
            email ILIKE $2 OR
            COALESCE(department, '') ILIKE $2
          )
        ORDER BY full_name ASC
        LIMIT 6
      `, [orgId, like]),
      query(`
        SELECT id, report_type, scope_type, created_at
        FROM reports
        WHERE generated_for = $1
          AND (
            COALESCE(report_type, '') ILIKE $2 OR
            COALESCE(scope_type, '') ILIKE $2
          )
        ORDER BY created_at DESC
        LIMIT 6
      `, [req.user.id, like]),
      query(`
        SELECT id, type, title, body, created_at, is_read
        FROM notifications
        WHERE user_id = $1
          AND (
            COALESCE(title, '') ILIKE $2 OR
            COALESCE(body, '') ILIKE $2 OR
            COALESCE(type, '') ILIKE $2
          )
        ORDER BY created_at DESC
        LIMIT 6
      `, [req.user.id, like]),
      query(`
        SELECT id, name, description, color
        FROM task_categories
        WHERE org_id = $1 AND is_active = TRUE
          AND (
            name ILIKE $2 OR
            COALESCE(description, '') ILIKE $2
          )
        ORDER BY name ASC
        LIMIT 8
      `, [orgId, like])
    ]);

    res.json({
      tasks: tasksRes.rows,
      users: usersRes.rows,
      reports: reportsRes.rows,
      notifications: notifRes.rows,
      projects: projectsRes.rows
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
