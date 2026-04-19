'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');

async function getScopedTargetUserIds(user) {
  const orgId = user.org_id ?? user.orgId;
  let targetUserIds = [user.id];
  if (isOrgWideRole(user.role)) {
    const { rows } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND is_active = TRUE`,
      [orgId]
    );
    targetUserIds = rows.map(r => r.id);
  } else if (['supervisor', 'manager', 'director'].includes(user.role)) {
    const { rows } = await query(
      `SELECT user_id FROM get_subordinate_ids($1)`,
      [user.id]
    );
    targetUserIds = [user.id, ...rows.map(r => r.user_id)];
  }
  return targetUserIds;
}

/**
 * GET /api/v1/search?q=<query>[&type=tasks|users|reports|notifications|projects][&limit=10]
 *
 * Upgrades over original:
 * - Optional `type` filter to search only one category (faster)
 * - Optional `limit` param (max 20)
 * - Returns `meta` with total counts and query echo
 * - Tasks include due_date and project name for richer display
 * - Users include avatar_url for avatars in search results
 * - Result objects include `_type` field for client-side routing
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const typeFilter = String(req.query.type || '').toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || '8', 10)));

    if (q.length < 2) {
      return res.json({
        tasks: [], users: [], reports: [], notifications: [], projects: [],
        meta: { query: q, total: 0, took_ms: 0 }
      });
    }

    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedTargetUserIds(req.user);
    const like = `%${q}%`;
    const startMs = Date.now();

    const shouldFetch = (type) => !typeFilter || typeFilter === type;

    const [tasksRes, usersRes, reportsRes, notifRes, projectsRes] = await Promise.all([
      shouldFetch('tasks') ? query(`
        SELECT
          t.id, t.title, t.status, t.priority, t.assigned_to,
          t.due_date, t.created_at,
          u.full_name AS assigned_to_name,
          c.name AS project_name,
          'task' AS _type
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        LEFT JOIN task_categories c ON c.id = t.category_id
        WHERE t.org_id = $1
          AND t.assigned_to = ANY($2)
          AND (
            t.title ILIKE $3 OR
            COALESCE(t.description, '') ILIKE $3 OR
            COALESCE(t.status, '') ILIKE $3 OR
            COALESCE(t.priority, '') ILIKE $3
          )
        ORDER BY
          CASE WHEN t.title ILIKE $3 THEN 0 ELSE 1 END,
          t.updated_at DESC NULLS LAST
        LIMIT $4
      `, [orgId, scopedIds, like, limit]) : { rows: [] },

      shouldFetch('users') ? query(`
        SELECT id, full_name, email, role, department, avatar_url, 'user' AS _type
        FROM users
        WHERE org_id = $1
          AND is_active = TRUE
          AND (
            full_name ILIKE $2 OR
            email ILIKE $2 OR
            COALESCE(department, '') ILIKE $2 OR
            COALESCE(role, '') ILIKE $2
          )
        ORDER BY
          CASE WHEN full_name ILIKE $2 THEN 0 ELSE 1 END,
          full_name ASC
        LIMIT $3
      `, [orgId, like, Math.ceil(limit * 0.75)]) : { rows: [] },

      shouldFetch('reports') ? query(`
        SELECT id, report_type, scope_type, created_at, 'report' AS _type
        FROM reports
        WHERE generated_for = $1
          AND (
            COALESCE(report_type, '') ILIKE $2 OR
            COALESCE(scope_type, '') ILIKE $2
          )
        ORDER BY created_at DESC
        LIMIT $3
      `, [req.user.id, like, Math.ceil(limit * 0.75)]) : { rows: [] },

      shouldFetch('notifications') ? query(`
        SELECT id, type, title, body, created_at, is_read, 'notification' AS _type
        FROM notifications
        WHERE user_id = $1
          AND (
            COALESCE(title, '') ILIKE $2 OR
            COALESCE(body, '') ILIKE $2 OR
            COALESCE(type, '') ILIKE $2
          )
        ORDER BY created_at DESC
        LIMIT $3
      `, [req.user.id, like, Math.ceil(limit * 0.75)]) : { rows: [] },

      shouldFetch('projects') ? query(`
        SELECT id, name, description, color, is_active, 'project' AS _type
        FROM task_categories
        WHERE org_id = $1 AND is_active = TRUE
          AND (
            name ILIKE $2 OR
            COALESCE(description, '') ILIKE $2
          )
        ORDER BY
          CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
          name ASC
        LIMIT $3
      `, [orgId, like, limit]) : { rows: [] },
    ]);

    const tasks = tasksRes.rows;
    const users = usersRes.rows;
    const reports = reportsRes.rows;
    const notifications = notifRes.rows;
    const projects = projectsRes.rows;
    const total = tasks.length + users.length + reports.length + notifications.length + projects.length;

    res.json({
      tasks,
      users,
      reports,
      notifications,
      projects,
      meta: {
        query: q,
        type: typeFilter || 'all',
        total,
        took_ms: Date.now() - startMs,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
