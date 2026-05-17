'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const router = express.Router();
const columnsCache = new Map();
const tablesCache = new Map();

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const { rows } = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const cols = new Set(rows.map((row) => String(row.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function tableExists(tableName) {
  if (tablesCache.has(tableName)) return tablesCache.get(tableName);
  const { rows } = await query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
      LIMIT 1`,
    [tableName]
  );
  const exists = rows.length > 0;
  tablesCache.set(tableName, exists);
  return exists;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

function normalizeIdentifiers(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function preflightTaskCondition(alias = 't') {
  return `COALESCE(${alias}.status, 'pending') NOT IN ('completed','manager_approved','cancelled')`;
}

async function relationContext() {
  const taskCols = await getColumns('tasks');
  const hasProjectTasks = await tableExists('project_tasks');
  const ptCols = hasProjectTasks ? await getColumns('project_tasks') : new Set();
  return { taskCols, hasProjectTasks, ptCols };
}

function relationSql({ taskCols, hasProjectTasks, ptCols, taskAlias = 't' }) {
  const parts = [];
  if (taskCols.has('project_id')) parts.push(`${taskAlias}.project_id::text = ANY($2::text[])`);
  if (taskCols.has('category_id')) parts.push(`${taskAlias}.category_id::text = ANY($2::text[])`);
  if (hasProjectTasks && ptCols.has('task_id') && ptCols.has('project_id')) {
    const ptOrgGuard = ptCols.has('org_id') ? ' AND pt.org_id = $1' : '';
    parts.push(`EXISTS (SELECT 1 FROM project_tasks pt WHERE pt.task_id = ${taskAlias}.id AND pt.project_id::text = ANY($2::text[])${ptOrgGuard})`);
  }
  return parts;
}

// Compatibility preflight only. Lifecycle writes are handled by the first-mounted
// safe completion route and the canonical lifecycle route. Do not add PATCH logic here.
router.get('/:projectId/active-tasks', authenticate, requireAnyRole('admin', 'director', 'hr', 'manager'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(404).json({ error: 'Not found' });

    const projectId = String(req.params.projectId || '').trim();
    const projectName = String(req.query?.project_name || req.query?.projectName || '').trim();
    const identifiers = normalizeIdentifiers([projectId, projectName]);
    if (!identifiers.length) return res.json({ tasks: [] });

    const ctx = await relationContext();
    const parts = relationSql(ctx);
    if (!parts.length) return res.json({ tasks: [] });

    const conditions = ['t.org_id = $1', `(${parts.join(' OR ')})`];
    if (ctx.taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (ctx.taskCols.has('status')) conditions.push(preflightTaskCondition('t'));

    const assigneeJoin = ctx.taskCols.has('assigned_to') ? 'LEFT JOIN users u ON u.id = t.assigned_to' : '';
    const assigneeSel = ctx.taskCols.has('assigned_to') ? `COALESCE(u.full_name, u.email, 'Unassigned') AS assignee_name` : `'Unassigned' AS assignee_name`;
    const prioritySel = ctx.taskCols.has('priority') ? 't.priority' : 'NULL::text AS priority';
    const dueSel = ctx.taskCols.has('due_date') ? 't.due_date' : 'NULL::timestamptz AS due_date';
    const orderBy = ctx.taskCols.has('created_at') ? 't.created_at DESC' : 't.id DESC';

    const { rows } = await query(
      `SELECT t.id,
              ${ctx.taskCols.has('title') ? 't.title' : 't.id::text AS title'},
              ${ctx.taskCols.has('status') ? "COALESCE(t.status,'pending') AS status" : "'pending'::text AS status"},
              ${prioritySel},
              ${dueSel},
              ${assigneeSel}
         FROM tasks t
         ${assigneeJoin}
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT 50`,
      [orgId, identifiers]
    );

    return res.json({ tasks: rows, meta: { projectId, projectName, compatibilityPreflightOnly: true } });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
