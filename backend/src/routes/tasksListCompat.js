'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');

const _cols = new Map();
const _tables = new Map();

async function getTableColumns(tableName) {
  const cached = _cols.get(tableName);
  if (cached) return cached;
  try {
    const { rows } = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const set = new Set((rows || []).map(r => String(r.column_name)));
    _cols.set(tableName, set);
    return set;
  } catch {
    return new Set();
  }
}

async function tableExists(tableName) {
  if (_tables.has(tableName)) return _tables.get(tableName);
  try {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [tableName]
    );
    const exists = !!rows[0]?.exists;
    _tables.set(tableName, exists);
    return exists;
  } catch {
    return false;
  }
}

function asPositiveInt(value, fallback, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

async function ownTargetIds(user, orgId) {
  const ids = [user.id];
  if (!(await tableExists('employees'))) return ids;
  try {
    const employeeCols = await getTableColumns('employees');
    const where = ['org_id = $1'];
    const params = [orgId];
    let p = 2;
    const identity = [];
    if (employeeCols.has('user_id')) {
      identity.push(`user_id = $${p++}`);
      params.push(user.id);
    }
    if (employeeCols.has('work_email')) {
      identity.push(`LOWER(work_email) = LOWER($${p++})`);
      params.push(user.email || '');
    }
    if (!identity.length) return ids;
    where.push(`(${identity.join(' OR ')})`);
    const { rows } = await query(
      `SELECT id FROM employees WHERE ${where.join(' AND ')}`,
      params
    );
    for (const row of rows || []) {
      if (row?.id && !ids.includes(row.id)) ids.push(row.id);
    }
  } catch {
    // Ignore employee mapping failures. User id remains enough for modern rows.
  }
  return ids;
}

async function scopedTargetIds(user, orgId, mine, userId) {
  const role = String(user.role || '').toLowerCase();
  if (role === 'employee' || role === 'technician' || String(mine || '') === 'true') {
    return ownTargetIds(user, orgId);
  }

  if (isOrgWideRole(role)) {
    try {
      const { rows } = await query(
        `SELECT id FROM users WHERE org_id = $1 AND COALESCE(is_active, TRUE) = TRUE`,
        [orgId]
      );
      const ids = rows.map(r => r.id);
      if (userId && ids.includes(userId)) return [userId];
      return ids.length ? ids : [user.id];
    } catch {
      return [user.id];
    }
  }

  const ids = [user.id];
  try {
    const { rows } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [user.id]);
    for (const row of rows || []) if (row?.user_id && !ids.includes(row.user_id)) ids.push(row.user_id);
  } catch {
    // Function may not exist in smaller Railway schemas.
  }
  if (userId && ids.includes(userId)) return [userId];
  return ids;
}

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function buildApprovalState(task) {
  const flow = Array.isArray(task.approval_flow) ? task.approval_flow : [];
  const metadata = task.metadata || {};
  const currentStep = Number.parseInt(metadata.approval_index || 0, 10) || 0;
  return { flow, currentStep, nextRole: flow[currentStep] || null, completedSteps: currentStep, totalSteps: flow.length };
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const taskCols = await getTableColumns('tasks');
    if (!taskCols.has('assigned_to') || !taskCols.has('org_id')) {
      return res.json({ tasks: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } });
    }

    const page = asPositiveInt(req.query.page, 1, 100000);
    const limit = asPositiveInt(req.query.limit, 50, 200);
    const offset = (page - 1) * limit;
    const role = String(req.user.role || '').toLowerCase();
    const mine = role === 'employee' || role === 'technician' ? 'true' : req.query.mine;
    const targetIds = await scopedTargetIds(req.user, orgId, mine, req.query.userId);

    const params = [targetIds, orgId];
    let p = 3;
    const conditions = ['t.assigned_to = ANY($1)', 't.org_id = $2'];
    if (taskCols.has('deleted_at')) conditions.push('t.deleted_at IS NULL');
    if (req.query.status && taskCols.has('status')) { conditions.push(`t.status = $${p++}`); params.push(req.query.status); }
    if (req.query.priority && taskCols.has('priority')) { conditions.push(`t.priority = $${p++}`); params.push(req.query.priority); }
    if (req.query.search && taskCols.has('title')) {
      const searchConditions = [`t.title ILIKE $${p}`];
      if (taskCols.has('description')) searchConditions.push(`t.description ILIKE $${p}`);
      conditions.push(`(${searchConditions.join(' OR ')})`);
      params.push(`%${String(req.query.search).trim()}%`);
      p++;
    }

    const hasUsers = await tableExists('users');
    const hasTaskMessages = await tableExists('task_messages');
    const hasTaskPhotos = await tableExists('task_photos');
    const hasTaskCategories = await tableExists('task_categories');
    const hasCategoryId = taskCols.has('category_id');

    const joins = [];
    const selectExtras = [];
    const groupBy = ['t.id'];
    if (hasUsers) {
      joins.push('LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to');
      if (taskCols.has('assigned_by')) joins.push('LEFT JOIN users u_by ON u_by.id = t.assigned_by');
      selectExtras.push('u_assigned.full_name AS assigned_to_name');
      selectExtras.push('u_assigned.email AS assigned_to_email');
      selectExtras.push(taskCols.has('assigned_by') ? 'u_by.full_name AS assigned_by_name' : 'NULL::text AS assigned_by_name');
      groupBy.push('u_assigned.full_name', 'u_assigned.email');
      if (taskCols.has('assigned_by')) groupBy.push('u_by.full_name');
    } else {
      selectExtras.push('NULL::text AS assigned_to_name', 'NULL::text AS assigned_to_email', 'NULL::text AS assigned_by_name');
    }

    if (hasTaskCategories && hasCategoryId) {
      joins.push('LEFT JOIN task_categories cat ON cat.id = t.category_id');
      selectExtras.push('cat.name AS category_name', 'cat.color AS category_color');
      groupBy.push('cat.name', 'cat.color');
    } else {
      selectExtras.push('NULL::text AS category_name', 'NULL::text AS category_color');
    }

    if (hasTaskPhotos) {
      joins.push('LEFT JOIN task_photos tp ON tp.task_id = t.id');
      selectExtras.push('COUNT(DISTINCT tp.id)::int AS photo_count');
    } else {
      selectExtras.push('0::int AS photo_count');
    }
    if (hasTaskMessages) {
      joins.push('LEFT JOIN task_messages tm ON tm.task_id = t.id');
      selectExtras.push('COUNT(DISTINCT tm.id)::int AS message_count');
    } else {
      selectExtras.push('0::int AS message_count');
    }

    const orderParts = [];
    if (taskCols.has('due_date')) orderParts.push('t.due_date ASC NULLS LAST');
    if (taskCols.has('created_at')) orderParts.push('t.created_at DESC');
    orderParts.push('t.id DESC');

    const { rows } = await query(`
      SELECT
        t.*,
        ${selectExtras.join(',\n        ')},
        COUNT(*) OVER()::int AS total_count
      FROM tasks t
      ${joins.join('\n      ')}
      WHERE ${conditions.join(' AND ')}
      GROUP BY ${groupBy.join(', ')}
      ORDER BY ${orderParts.join(', ')}
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, limit, offset]);

    let dependencyCounts = {};
    if (rows.length && await tableExists('task_dependencies')) {
      try {
        const ids = rows.map(t => t.id);
        const { rows: depRows } = await query(
          `SELECT task_id, COUNT(*)::int AS c FROM task_dependencies WHERE task_id = ANY($1) GROUP BY task_id`,
          [ids]
        );
        dependencyCounts = Object.fromEntries(depRows.map(r => [r.task_id, r.c]));
      } catch {
        dependencyCounts = {};
      }
    }

    const tasks = rows.map(row => {
      const task = {
        ...row,
        recurrence: parseJsonField(row.recurrence, null),
        metadata: parseJsonField(row.metadata, {}),
        approval_flow: parseJsonField(row.approval_flow, []),
        dependency_count: dependencyCounts[row.id] || 0,
      };
      task.approval_state = buildApprovalState(task);
      return task;
    });

    const total = Number(tasks[0]?.total_count || 0);
    if (String(req.query.board || '') === 'true') {
      const columns = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue'];
      return res.json({ board: Object.fromEntries(columns.map(col => [col, tasks.filter(t => t.status === col)])), tasks });
    }

    return res.json({
      tasks,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Compat task list failed:', err?.message || err);
    return next(err);
  }
});

module.exports = router;
