'use strict';

const express = require('express');
const { query } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { emitNotification } = require('../services/notificationService');
const { logUserActivity } = require('../services/activityService');

const router = express.Router();
const columnsCache = new Map();

async function getColumns(tableName) {
  if (columnsCache.has(tableName)) return columnsCache.get(tableName);
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const cols = new Set(rows.map(r => String(r.column_name)));
  columnsCache.set(tableName, cols);
  return cols;
}

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId ? String(orgId) : null;
}

async function canonicalProjectExists(orgId, projectId) {
  if (!projectId) return false;
  try {
    const { rows } = await query(
      `SELECT id FROM projects WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [projectId, orgId]
    );
    return rows.length > 0;
  } catch (err) {
    if (err.code === '42P01') return false;
    throw err;
  }
}

async function categoryExists(orgId, categoryId) {
  if (!categoryId) return false;
  try {
    const { rows } = await query(
      `SELECT id FROM task_categories WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [categoryId, orgId]
    );
    return rows.length > 0;
  } catch (err) {
    if (err.code === '42P01') return false;
    throw err;
  }
}

router.get('/assignable-users', authenticate, async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const params = [orgId];
    let p = 2;
    const conditions = [
      'u.org_id = $1',
      'COALESCE(u.is_active, TRUE) = TRUE',
      `NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id AND e.org_id = $1 AND COALESCE(e.status, 'active') <> 'active')`,
    ];
    if (req.query.department && req.query.department !== 'all') {
      conditions.push(`u.department = $${p++}`);
      params.push(req.query.department);
    }
    if (!isOrgWideRole(req.user.role)) {
      try {
        const { rows: subs } = await query(`SELECT user_id FROM get_subordinate_ids($1)`, [req.user.id]);
        const ids = [req.user.id, ...subs.map((r) => r.user_id).filter(Boolean)];
        conditions.push(`u.id = ANY($${p++})`);
        params.push(ids);
      } catch {
        conditions.push(`u.id = $${p++}`);
        params.push(req.user.id);
      }
    }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.role, u.department, u.employee_code FROM users u WHERE ${conditions.join(' AND ')} ORDER BY u.full_name ASC NULLS LAST, u.email ASC`,
      params
    );
    return res.json({ users: rows.map((u) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: u.role, department: u.department, employeeCode: u.employee_code })) });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const projectId = String(req.body?.projectId || req.body?.project_id || '').trim();
    if (!projectId) return next();

    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const taskCols = await getColumns('tasks');
    if (!taskCols.has('project_id')) return next();
    if (!(await canonicalProjectExists(orgId, projectId))) return next();

    const title = String(req.body?.title || '').trim();
    const assignedTo = String(req.body?.assignedTo || req.body?.assigned_to || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    const priority = String(req.body?.priority || 'medium').trim().toLowerCase();
    const dueDate = req.body?.dueDate || req.body?.due_date || null;
    const categoryId = String(req.body?.categoryId || req.body?.category_id || '').trim();

    if (!title || title.length < 2) return res.status(400).json({ error: 'Title must be at least 2 characters' });
    if (!assignedTo) return res.status(400).json({ error: 'Please select an employee to assign this task to.' });

    const { rows: userCheck } = await query(`SELECT id FROM users WHERE id = $1 AND org_id = $2 AND COALESCE(is_active, TRUE) = TRUE`, [assignedTo, orgId]);
    if (!userCheck.length) return res.status(400).json({ error: 'Referenced resource not found: User not found or inactive' });

    const insertCols = [];
    const insertVals = [];
    const push = (col, val, required = false) => {
      if (required || taskCols.has(col)) { insertCols.push(col); insertVals.push(val); }
    };

    push('org_id', orgId, true);
    push('title', title, true);
    push('status', 'pending', true);
    push('project_id', projectId);
    if (categoryId && categoryId !== projectId && taskCols.has('category_id') && await categoryExists(orgId, categoryId)) push('category_id', categoryId);
    push('description', description);
    push('assigned_to', assignedTo);
    push('assigned_by', req.user.id);
    push('priority', priority || 'medium');
    push('due_date', dueDate || null);
    push('metadata', JSON.stringify({ approval_index: 0, project_source: 'projects' }));

    const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO tasks (${insertCols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      insertVals
    );
    const task = rows[0];

    res.status(201).json({ task });

    (async () => {
      try {
        await emitNotification(assignedTo, { type: 'task_assigned', title: 'New task assigned', body: title, data: { taskId: task.id, projectId } });
        await logUserActivity({ orgId, userId: req.user.id, taskId: task.id, activityType: 'task_created', metadata: { assignedTo, projectId, canonicalProject: true } });
      } catch { /* non-critical */ }
    })();
  } catch (err) { next(err); }
});

module.exports = router;
