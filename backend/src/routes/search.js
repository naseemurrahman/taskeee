'use strict';
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { hasPermission, hasAnyPermission, isOrgWideRole, actorScopeLabel } = require('../security/rbac');
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
  } else if (hasPermission(user.role, 'search:team')) {
    const { rows } = await safeQuery(
      'scope:subordinates',
      `SELECT user_id FROM get_subordinate_ids($1)`,
      [user.id]
    );
    targetUserIds = [user.id, ...rows.map(r => r.user_id)];
  }

  return targetUserIds.length ? targetUserIds : [user.id];
}

function visibleKnowledgeScopes(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return ['org', 'management', 'hr', 'admin'];
  if (r === 'director' || r === 'hr') return ['org', 'management', 'hr'];
  if (r === 'manager' || r === 'supervisor') return ['org', 'management'];
  return ['org'];
}

function makeFlatResults({ tasks, users, reports, notifications, projects, attachments, knowledge }) {
  return [
    ...tasks.map((r) => ({ id: r.id, type: 'task', title: r.title, subtitle: [r.status, r.priority].filter(Boolean).join(' · '), url: `/app/tasks`, raw: r })),
    ...users.map((r) => ({ id: r.id, type: 'user', title: r.full_name || r.email, subtitle: [r.role, r.department].filter(Boolean).join(' · '), url: `/app/hr/employees`, raw: r })),
    ...projects.map((r) => ({ id: r.id, type: 'project', title: r.name, subtitle: 'Project', url: `/app/projects`, raw: r })),
    ...reports.map((r) => ({ id: r.id, type: 'report', title: r.report_type || 'Report', subtitle: r.scope_type || '', url: `/app/reports`, raw: r })),
    ...notifications.map((r) => ({ id: r.id, type: 'notification', title: r.title, subtitle: r.body || r.type, url: `/app/dashboard`, raw: r })),
    ...attachments.map((r) => ({ id: r.id, type: 'attachment', title: r.original_filename || 'Attachment', subtitle: [r.task_title, r.mime_type, r.scan_status].filter(Boolean).join(' · '), url: `/app/tasks`, raw: r })),
    ...knowledge.map((r) => ({ id: r.id, type: 'knowledge', title: r.title, subtitle: [r.category, (r.tags || []).join(', ')].filter(Boolean).join(' · '), url: `/app/knowledge-base/${r.id}`, raw: r })),
  ];
}

/**
 * GET /api/v1/search?q=<query>[&type=tasks|users|reports|notifications|projects|attachments|knowledge][&limit=10]
 */
router.get(['/', '/global'], authenticate, async (req, res, next) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const typeFilter = String(req.query.type || '').toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || '8', 10)));

    if (q.length < 2) {
      return res.json({
        tasks: [], users: [], reports: [], notifications: [], projects: [], attachments: [], knowledge: [], results: [],
        meta: { query: q, total: 0, took_ms: 0, scope: actorScopeLabel(req.user) }
      });
    }

    const orgId = req.user.org_id ?? req.user.orgId;
    const scopedIds = await getScopedTargetUserIds(req.user);
    const like = `%${q}%`;
    const tsQuery = q.split(/\s+/).filter(Boolean).join(' & ');
    const startMs = Date.now();
    const shouldFetch = (type) => !typeFilter || typeFilter === type || typeFilter === type.replace(/s$/, '');
    const canSearchPeopleOrg = hasPermission(req.user.role, 'search:people:org');
    const canSearchPeopleTeam = hasPermission(req.user.role, 'search:team');
    const canSearchProjectsOrg = hasAnyPermission(req.user.role, ['projects:read:org', 'projects:update']);
    const canSearchReports = hasPermission(req.user.role, 'reports:read:org');
    const knowledgeScopes = visibleKnowledgeScopes(req.user.role);

    const [tasksRes, usersRes, reportsRes, notifRes, projectsRes, attachRes, knowledgeRes] = await Promise.all([
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
            t.assigned_to = ANY($2::uuid[]) OR
            t.assigned_by = ANY($2::uuid[]) OR
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

      shouldFetch('users') && (canSearchPeopleOrg || canSearchPeopleTeam) ? safeQuery('users', `
        SELECT id, full_name, email, role, department, avatar_url, 'user' AS _type
        FROM users
        WHERE org_id = $1
          AND COALESCE(is_active, TRUE) = TRUE
          AND ($4::boolean = TRUE OR id = ANY($5::uuid[]))
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
      `, [orgId, like, Math.ceil(limit * 0.75), canSearchPeopleOrg, scopedIds]) : { rows: [] },

      shouldFetch('reports') && canSearchReports ? safeQuery('reports', `
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

      shouldFetch('projects') && canSearchProjectsOrg ? safeQuery('projects', `
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

      shouldFetch('attachments') || shouldFetch('files') ? safeQuery('attachments', `
        SELECT sa.id, sa.task_id, sa.uploaded_by, sa.original_filename, sa.mime_type,
               sa.tags, sa.description, sa.scan_status, sa.created_at, sa.task_title,
               'attachment' AS _type
          FROM searchable_attachments sa
          JOIN tasks t ON t.id = sa.task_id
         WHERE sa.org_id = $1
           AND COALESCE(sa.scan_status, 'pending') <> 'quarantined'
           AND (
             t.assigned_to = ANY($2::uuid[]) OR
             t.assigned_by = ANY($2::uuid[]) OR
             sa.uploaded_by = $5 OR
             $6::boolean = TRUE
           )
           AND (
             sa.original_filename ILIKE $3 OR
             COALESCE(sa.description, '') ILIKE $3 OR
             COALESCE(array_to_string(sa.tags, ' '), '') ILIKE $3 OR
             COALESCE(sa.task_title, '') ILIKE $3 OR
             sa.search_vector @@ to_tsquery('simple', $7)
           )
         ORDER BY sa.created_at DESC
         LIMIT $4
      `, [orgId, scopedIds, like, limit, req.user.id, isOrgWideRole(req.user.role), tsQuery || q]) : { rows: [] },

      shouldFetch('knowledge') || shouldFetch('docs') ? safeQuery('knowledge', `
        SELECT ka.id, ka.title, ka.summary, ka.category, ka.tags, ka.visibility, ka.updated_at,
               'knowledge' AS _type
          FROM knowledge_articles ka
         WHERE ka.org_id = $1
           AND ka.is_published = TRUE
           AND ka.visibility = ANY($5::text[])
           AND (
             ka.title ILIKE $2 OR
             COALESCE(ka.summary, '') ILIKE $2 OR
             COALESCE(ka.content, '') ILIKE $2 OR
             COALESCE(array_to_string(ka.tags, ' '), '') ILIKE $2
           )
         ORDER BY
           CASE WHEN ka.title ILIKE $2 THEN 0 ELSE 1 END,
           ka.updated_at DESC
         LIMIT $3
      `, [orgId, like, limit, req.user.id, knowledgeScopes]) : { rows: [] },
    ]);

    const tasks = tasksRes.rows || [];
    const users = usersRes.rows || [];
    const reports = reportsRes.rows || [];
    const notifications = notifRes.rows || [];
    const projects = projectsRes.rows || [];
    const attachments = attachRes.rows || [];
    const knowledge = knowledgeRes.rows || [];
    const results = makeFlatResults({ tasks, users, reports, notifications, projects, attachments, knowledge });
    const total = results.length;

    res.json({
      tasks,
      users,
      reports,
      notifications,
      projects,
      attachments,
      knowledge,
      results,
      meta: {
        query: q,
        type: typeFilter || 'all',
        total,
        took_ms: Date.now() - startMs,
        scope: actorScopeLabel(req.user),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
