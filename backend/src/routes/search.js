'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');
const logger = require('../utils/logger');

async function safeQuery(label, sql, params) {
  try {
    return await query(sql, params);
  } catch (err) {
    // Global search should degrade gracefully. One missing/older table must not make
    // the whole search bar look broken.
    logger.warn(`Global search ${label} query skipped: ${err.message}`);
    return { rows: [] };
  }
}

async function getScopedTargetUserIds(user) {
  const orgId = user.org_id ?? user.orgId;
  let targetUserIds = [user.id];

  if (isOrgWideRole(user.role)) {
    const { rows } = await safeQuery(
      'scope:org-users',
      `SELECT id FROM users WHERE org_id = $1 AND COALESCE(is_active, TRUE) = TRUE`,
      [orgId]
    );
    targetUserIds = rows.map(r => r.id);
  } else if (['supervisor', 'manager', 'director'].includes(String(user.role || '').toLowerCase())) {
    const { rows } = await safeQuery(
      'scope:subordinates',
      `SELECT user_id FROM get_subordinate_ids($1)`,
      [user.id]
    );
    targetUserIds = [user.id, ...rows.map(r => r.user_id)];
  }

  return targetUserIds.length ? targetUserIds : [user.id];
}

function makeFlatResults({ tasks, users, reports, notifications, projects }) {
  return [
    ...tasks.map((r) => ({ id: r.id, type: 'task', title: r.title, subtitle: [r.status, r.priority].filter(Boolean).join(' · '), url: `/app/tasks`, raw: r })),
    ...users.map((r) => ({ id: r.id, type: 'user', title: r.full_name || r.email, subtitle: [r.role, r.department].filter(Boolean).join(' · '), url: `/app/hr/employees`, raw: r })),
    ...projects.map((r) => ({ id: r.id, type: 'project', title: r.name, subtitle: 'Project', url: `/app/projects`, raw: r })),
    ...reports.map((r) => ({ id: r.id, type: 'report', title: r.report_type || 'Report', subtitle: r.scope_type || '', url: `/app/reports`, raw: r })),
    ...notifications.map((r) => ({ id: r.id, type: 'notification', title: r.title, subtitle: r.body || r.type, url: `/app/dashboard`, raw: r })),
  ];
}

/**
 * GET /api/v1/search?q=<query>[&type=tasks|users|reports|notifications|projects][&limit=10]
 */
router.get(['/', '/global'], authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const typeFilter = String(req.query.type || '').toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || '8', 10)));

    if (q.length < 2) {
      return res.json({
        tasks: [], users: [], reports: [], notifications: [], projects: [], results: [],
        meta: { query: q, total: 0, took_ms: 0 }
      });
    }

    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedTargetUserIds(req.user);
    const like = `%${q}%`;
    const startMs = Date.now();
    const shouldFetch = (type) => !typeFilter || typeFilter === type || typeFilter === type.replace(/s$/, '');

    const [tasksRes, usersRes, reportsRes, notifRes, projectsRes] = await Promise.all([
      shouldFetch('tasks') ? safeQuery('tasks', `
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
          AND COALESCE(t.deleted_at IS NULL, TRUE)
          AND (
            $2::uuid[] IS NULL OR
            cardinality($2::uuid[]) = 0 OR
            t.assigned_to = ANY($2::uuid[]) OR
            $5::boolean = TRUE
          )
          AND (
            t.title ILIKE $3 OR
            COALESCE(t.description, '') ILIKE $3 OR
            COALESCE(t.status, '') ILIKE $3 OR
            COALESCE(t.priority, '') ILIKE $3
          )
        ORDER BY
          CASE WHEN t.title ILIKE $3 THEN 0 ELSE 1 END,
          t.updated_at DESC NULLS LAST,
          t.created_at DESC NULLS LAST
        LIMIT $4
      `, [orgId, scopedIds, like, limit, isOrgWideRole(req.user.role)]) : { rows: [] },

      shouldFetch('users') ? safeQuery('users', `
        SELECT id, full_name, email, role, department, avatar_url, 'user' AS _type
        FROM users
        WHERE org_id = $1
          AND COALESCE(is_active, TRUE) = TRUE
          AND (
            COALESCE(full_name, '') ILIKE $2 OR
            COALESCE(email, '') ILIKE $2 OR
            COALESCE(department, '') ILIKE $2 OR
            COALESCE(role, '') ILIKE $2
          )
        ORDER BY
          CASE WHEN COALESCE(full_name, '') ILIKE $2 THEN 0 ELSE 1 END,
          full_name ASC NULLS LAST,
          email ASC
        LIMIT $3
      `, [orgId, like, Math.ceil(limit * 0.75)]) : { rows: [] },

      shouldFetch('reports') ? safeQuery('reports', `
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

      shouldFetch('notifications') ? safeQuery('notifications', `
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

      shouldFetch('projects') ? safeQuery('projects', `
        SELECT id, name, description, color, is_active, 'project' AS _type
        FROM task_categories
        WHERE org_id = $1
          AND COALESCE(is_active, TRUE) = TRUE
          AND (
            COALESCE(name, '') ILIKE $2 OR
            COALESCE(description, '') ILIKE $2
          )
        ORDER BY
          CASE WHEN COALESCE(name, '') ILIKE $2 THEN 0 ELSE 1 END,
          name ASC
        LIMIT $3
      `, [orgId, like, limit]) : { rows: [] },
    ]);

    const tasks = tasksRes.rows || [];
    const users = usersRes.rows || [];
    const reports = reportsRes.rows || [];
    const notifications = notifRes.rows || [];
    const projects = projectsRes.rows || [];
    const results = makeFlatResults({ tasks, users, reports, notifications, projects });
    const total = results.length;

    res.json({
      tasks,
      users,
      reports,
      notifications,
      projects,
      results,
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
