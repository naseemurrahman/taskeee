const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole, canManage, isOrgWideRole } = require('../middleware/auth');
const { validateTaskCreate, validateStatusUpdate } = require('../middleware/validators');
const { emitNotification } = require('../services/notificationService');
const { logUserActivity } = require('../services/activityService');
const { triggerAITaskReview } = require('../services/aiService');

const _tableColsCache = new Map();
async function getTableColumns(tableName) {
  if (_tableColsCache.has(tableName)) return _tableColsCache.get(tableName);
  try {
    const { rows } = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`,
      [tableName]
    );
    const set = new Set((rows || []).map((r) => String(r.column_name)));
    _tableColsCache.set(tableName, set);
    return set;
  } catch {
    return new Set();
  }
}

async function assertCanViewTask(req, task) {
  const u = req.user;
  if (isOrgWideRole(u.role)) return true;
  if (task.assigned_to === u.id || task.assigned_by === u.id) return true;
  const { rows } = await query(
    `SELECT 1 FROM get_subordinate_ids($1) WHERE user_id = $2 LIMIT 1`,
    [u.id, task.assigned_to]
  );
  return rows.length > 0;
}

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

function normalizeRecurrence(recurrence, dueDate) {
  if (!recurrence) return null;
  const interval = Math.max(1, parseInt(recurrence.interval || 1, 10));
  return {
    type: recurrence.type,
    interval,
    endsAt: recurrence.endsAt || null,
    anchorDate: recurrence.anchorDate || dueDate || null
  };
}

function computeNextRunAt(baseDate, recurrence) {
  if (!baseDate || !recurrence?.type) return null;
  const next = new Date(baseDate);
  const interval = Math.max(1, parseInt(recurrence.interval || 1, 10));
  if (recurrence.type === 'daily') next.setDate(next.getDate() + interval);
  if (recurrence.type === 'weekly') next.setDate(next.getDate() + (interval * 7));
  if (recurrence.type === 'monthly') next.setMonth(next.getMonth() + interval);
  if (recurrence.endsAt) {
    const endsAt = new Date(recurrence.endsAt);
    if (!Number.isNaN(endsAt.getTime()) && next > endsAt) return null;
  }
  return next;
}

async function getDependencyMaps(taskId) {
  const [blockingRes, dependentRes] = await Promise.all([
    query(`
      SELECT td.*, t.title AS depends_on_title, t.status AS depends_on_status
      FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_task_id
      WHERE td.task_id = $1
      ORDER BY td.created_at ASC
    `, [taskId]),
    query(`
      SELECT td.*, t.title AS task_title, t.status AS task_status
      FROM task_dependencies td
      JOIN tasks t ON t.id = td.task_id
      WHERE td.depends_on_task_id = $1
      ORDER BY td.created_at ASC
    `, [taskId])
  ]);
  return { blocking: blockingRes.rows, dependents: dependentRes.rows };
}

async function getIncompleteBlockingDependencies(taskId) {
  const { rows } = await query(`
    SELECT td.depends_on_task_id, t.title, t.status
    FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_task_id
    WHERE td.task_id = $1
      AND td.dependency_type = 'blocks'
      AND t.status NOT IN ('completed', 'manager_approved')
  `, [taskId]);
  return rows;
}

async function updateTaskMetadata(taskId, metadata) {
  const { rows } = await query(
    `UPDATE tasks SET metadata = $1 WHERE id = $2 RETURNING metadata`,
    [JSON.stringify(metadata || {}), taskId]
  );
  return rows[0]?.metadata || metadata;
}

function buildApprovalState(task) {
  const flow = Array.isArray(task.approval_flow) ? task.approval_flow : [];
  const metadata = task.metadata || {};
  const currentStep = parseInt(metadata.approval_index || 0, 10);
  return {
    flow,
    currentStep,
    nextRole: flow[currentStep] || null,
    completedSteps: currentStep,
    totalSteps: flow.length
  };
}

async function createRecurringFollowUp(client, task) {
  const recurrence = normalizeRecurrence(task.recurrence, task.due_date);
  if (!recurrence) return null;
  const nextRunAt = computeNextRunAt(task.due_date || task.next_run_at || task.created_at, recurrence);
  if (!nextRunAt) return null;

  const parentTaskId = task.parent_task_id || task.id;
  const metadata = { ...(task.metadata || {}), generated_from_task_id: task.id };
  const { rows } = await client.query(`
    INSERT INTO tasks (
      org_id, title, description, category_id, assigned_to, assigned_by, status,
      priority, due_date, location, notes, recurrence, metadata, parent_task_id, next_run_at, approval_flow
    )
    VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    task.org_id, task.title, task.description, task.category_id, task.assigned_to, task.assigned_by,
    task.priority, nextRunAt.toISOString(), task.location, task.notes,
    recurrence ? JSON.stringify(recurrence) : null,
    JSON.stringify(metadata),
    parentTaskId,
    nextRunAt.toISOString(),
    JSON.stringify(task.approval_flow || [])
  ]);

  await client.query(`
    INSERT INTO task_timeline (task_id, actor_type, event_type, to_status, note, metadata)
    VALUES ($1, 'system', 'recurring_task_generated', 'pending', $2, $3)
  `, [
    rows[0].id,
    `Recurring follow-up generated from ${task.title}`,
    JSON.stringify({ sourceTaskId: task.id, parentTaskId })
  ]);

  return rows[0];
}

function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}


// GET /tasks - hierarchy + HR org-wide
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, priority, page = 1, limit = 20, userId, board, mine } = req.query;
    const offset = (page - 1) * limit;
    const user = req.user;
    const orgId = user.org_id ?? user.orgId;
    let targetUserIds = await getScopedTargetUserIds(user);

    /** Employees are always scoped to their own tasks, regardless of query params. */
    if (user.role === 'employee') {
      targetUserIds = [user.id];
    } else if (String(mine || '') === 'true') {
      /** Only tasks assigned to the signed-in user (My Tasks page for managers/supervisors). */
      targetUserIds = [user.id];
    } else if (userId && targetUserIds.includes(userId)) {
      targetUserIds = [userId];
    }

    const conditions = [`t.assigned_to = ANY($1)`, `t.org_id = $2`];
    const params = [targetUserIds, orgId];
    let p = 3;

    if (status) { conditions.push(`t.status = $${p++}`); params.push(status); }
    if (priority) { conditions.push(`t.priority = $${p++}`); params.push(priority); }

    const { rows: tasks } = await query(`
      SELECT
        t.*,
        u_assigned.full_name AS assigned_to_name,
        u_assigned.email AS assigned_to_email,
        u_by.full_name AS assigned_by_name,
        cat.name AS category_name,
        cat.color AS category_color,
        COUNT(DISTINCT tp.id) AS photo_count,
        COUNT(DISTINCT tm.id) AS message_count,
        COUNT(*) OVER() AS total_count
      FROM tasks t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_by ON u_by.id = t.assigned_by
      LEFT JOIN task_categories cat ON cat.id = t.category_id
      LEFT JOIN task_photos tp ON tp.task_id = t.id
      LEFT JOIN task_messages tm ON tm.task_id = t.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY t.id, u_assigned.full_name, u_assigned.email, u_by.full_name, cat.name, cat.color
      ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
      LIMIT $${p++} OFFSET $${p++}
    `, [...params, parseInt(limit, 10), offset]);

    const taskIds = tasks.map(t => t.id);
    let dependencyCounts = {};
    if (taskIds.length) {
      const { rows } = await query(`
        SELECT task_id, COUNT(*)::int AS c
        FROM task_dependencies
        WHERE task_id = ANY($1)
        GROUP BY task_id
      `, [taskIds]);
      dependencyCounts = Object.fromEntries(rows.map(r => [r.task_id, r.c]));
    }

    const normalizedTasks = tasks.map(task => {
      const normalized = {
        ...task,
        recurrence: parseJsonField(task.recurrence, null),
        metadata: parseJsonField(task.metadata, {}),
        approval_flow: parseJsonField(task.approval_flow, []),
        dependency_count: dependencyCounts[task.id] || 0
      };
      normalized.approval_state = buildApprovalState(normalized);
      return normalized;
    });

    const total = normalizedTasks[0]?.total_count || 0;
    if (board === 'true') {
      const columns = ['pending', 'in_progress', 'submitted', 'manager_approved', 'completed', 'overdue'];
      const boardData = Object.fromEntries(columns.map(col => [col, normalizedTasks.filter(t => t.status === col)]));
      return res.json({ board: boardData, tasks: normalizedTasks });
    }

    res.json({
      tasks: normalizedTasks,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: parseInt(total, 10),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('=== TASK CREATION DETAILED ERROR ===');
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    console.error('User:', req.user);
    console.error('=== END ERROR DETAILS ==='); next(err); }
});

// GET /tasks/departments - Get available departments
router.get('/departments', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    const orgId = user.org_id ?? user.orgId;
    
    const { rows } = await query(`
      SELECT DISTINCT department
      FROM users 
      WHERE org_id = $1 AND is_active = TRUE AND department IS NOT NULL AND department != ''
      ORDER BY department ASC
    `, [orgId]);
    
    res.json({
      departments: rows.map(row => row.department)
    });
  } catch (error) {
    next(error);
  }
});

// GET /tasks/assignable-users - Get users that can be assigned tasks
router.get('/assignable-users', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    const orgId = user.org_id ?? user.orgId;
    const { department } = req.query;
    
    let queryText = `
      SELECT 
        u.id, 
        u.full_name, 
        u.email, 
        u.role, 
        u.department,
        u.employee_code
      FROM users u
      WHERE u.org_id = $1 AND u.is_active = TRUE
    `;
    
    let params = [orgId];
    let paramIndex = 2;
    
    // Filter by department if provided
    if (department && department !== 'all') {
      queryText += ` AND u.department = $${paramIndex++}`;
      params.push(department);
    }
    
    // If not org-wide role, only show self and subordinates
    if (!isOrgWideRole(user.role)) {
      const { rows: subs } = await query(
        `SELECT user_id FROM get_subordinate_ids($1)`,
        [user.id]
      );
      const ids = [user.id, ...subs.map(r => r.user_id)];
      queryText += ` AND u.id = ANY($${paramIndex++})`;
      params.push(ids);
    }
    
    queryText += ` ORDER BY u.full_name ASC`;
    
    const { rows } = await query(queryText, params);
    
    res.json({
      users: rows.map(user => ({
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        department: user.department,
        employeeCode: user.employee_code
      }))
    });
  } catch (error) {
    next(error);
  }
});

// GET /tasks/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        t.*,
        u_assigned.full_name AS assigned_to_name,
        u_by.full_name AS assigned_by_name,
        cat.name AS category_name,
        cat.ai_threshold
      FROM tasks t
      LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
      LEFT JOIN users u_by ON u_by.id = t.assigned_by
      LEFT JOIN task_categories cat ON cat.id = t.category_id
      WHERE t.id = $1 AND t.org_id = $2
    `, [req.params.id, req.user.org_id ?? req.user.orgId]);

    if (!rows.length) return res.status(404).json({ error: 'Task not found' });

    const task = {
      ...rows[0],
      recurrence: parseJsonField(rows[0].recurrence, null),
      metadata: parseJsonField(rows[0].metadata, {}),
      approval_flow: parseJsonField(rows[0].approval_flow, [])
    };
    if (!(await assertCanViewTask(req, task)))
      return res.status(403).json({ error: 'Access denied' });

    const [timelineRes, photosRes, deps, subtasksRes] = await Promise.all([
      query(`
        SELECT tl.*, u.full_name AS actor_name
        FROM task_timeline tl
        LEFT JOIN users u ON u.id = tl.actor_id
        WHERE tl.task_id = $1 ORDER BY tl.created_at ASC
      `, [req.params.id]),
      query(`
        SELECT tp.*, u.full_name AS uploaded_by_name
        FROM task_photos tp
        LEFT JOIN users u ON u.id = tp.uploaded_by
        WHERE tp.task_id = $1 ORDER BY tp.created_at DESC
      `, [req.params.id]),
      getDependencyMaps(req.params.id),
      query(`
        SELECT t.*, u.full_name AS assigned_to_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.parent_task_id = $1 AND t.org_id = $2
        ORDER BY t.created_at ASC
      `, [req.params.id, req.user.org_id ?? req.user.orgId])
    ]);

    res.json({
      task,
      timeline: timelineRes.rows,
      photos: photosRes.rows,
      dependencies: deps.blocking,
      dependents: deps.dependents,
      approvalState: buildApprovalState(task),
      subtasks: subtasksRes.rows.map(item => ({
        ...item,
        recurrence: parseJsonField(item.recurrence, null),
        metadata: parseJsonField(item.metadata, {}),
        approval_flow: parseJsonField(item.approval_flow, [])
      }))
    });
  } catch (err) { next(err); }
});

// POST /tasks
router.post('/', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), validateTaskCreate, canManage, async (req, res, next) => {
  try {
    const {
      title, description, assignedTo, categoryId,
      priority = 'medium', dueDate, location, notes,
      recurrence, dependencyIds = [], parentTaskId = null, approvalFlow = [],
      department
    } = req.body;

    const orgId = req.user.org_id ?? req.user.orgId;
    const taskCols = await getTableColumns('tasks');
    const normalizedRecurrence = normalizeRecurrence(recurrence, dueDate);
    const nextRunAt = normalizedRecurrence ? computeNextRunAt(dueDate || new Date().toISOString(), normalizedRecurrence) : null;

    console.log('Task creation request validation:');
    console.log('Title:', title);
    console.log('Assigned to:', assignedTo);
    console.log('Category ID:', categoryId);
    console.log('Priority:', priority);
    
    if (!title) return res.status(400).json({ error: 'Title is required' });
    
    // Validate assigned_to user exists
    if (assignedTo) {
      const { rows: userCheck } = await query('SELECT id FROM users WHERE id = $1', [assignedTo]);
      if (userCheck.length === 0) {
        return res.status(400).json({ error: 'Referenced resource not found: User not found' });
      }
    }
    
    // Validate category/project reference if provided. In mixed legacy deployments,
    // /projects may be backed by a legacy projects table while tasks still uses
    // category_id. If not found, gracefully drop the reference instead of failing
    // task creation.
    let resolvedCategoryId = categoryId || null;
    if (categoryId) {
      let found = false;
      try {
        const { rows: categoryCheck } = await query(
          'SELECT id FROM task_categories WHERE id = $1 AND org_id = $2',
          [categoryId, orgId]
        );
        found = categoryCheck.length > 0;
      } catch (err) {
        if (err.code !== '42P01') throw err;
      }
      if (!found) {
        try {
          const { rows: legacyProjectCheck } = await query(
            'SELECT id FROM projects WHERE id = $1 AND org_id = $2',
            [categoryId, orgId]
          );
          found = legacyProjectCheck.length > 0;
        } catch (err) {
          if (err.code !== '42P01') throw err;
        }
      }
      if (!found) resolvedCategoryId = null;
    }

    const task = await withTransaction(async (client) => {
      const insertCols = [];
      const insertVals = [];
      const pushCol = (col, val) => {
        if (!taskCols.size || taskCols.has(col)) { insertCols.push(col); insertVals.push(val); }
      };

      pushCol('org_id', orgId);
      pushCol('title', title);
      pushCol('description', description || null);
      pushCol('assigned_to', assignedTo || null);
      pushCol('assigned_by', req.user.id);
      pushCol('category_id', resolvedCategoryId || null);
      pushCol('priority', priority || 'medium');
      pushCol('due_date', dueDate || null);
      pushCol('location', location || null);
      pushCol('notes', notes || null);
      pushCol('recurrence', normalizedRecurrence ? JSON.stringify(normalizedRecurrence) : null);
      pushCol('metadata', JSON.stringify({ approval_index: 0 }));
      pushCol('parent_task_id', parentTaskId || null);
      pushCol('next_run_at', nextRunAt ? nextRunAt.toISOString() : null);
      pushCol('approval_flow', JSON.stringify(approvalFlow || []));
      pushCol('status', 'pending');

      const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await client.query(
        `INSERT INTO tasks (${insertCols.join(', ')})
         VALUES (${placeholders})
         RETURNING *`,
        insertVals
      );

      if (dependencyIds.length) {
        for (const dependencyId of dependencyIds) {
          await client.query(`
            INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type, created_by)
            VALUES ($1, $2, 'blocks', $3)
            ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
          `, [rows[0].id, dependencyId, req.user.id]);
        }
      }

      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, to_status, note, metadata)
        VALUES ($1, $2, 'user', 'task_created', 'pending', $3, $4)
      `, [
        rows[0].id,
        req.user.id,
        `Task assigned by ${req.user.full_name}`,
        JSON.stringify({ dependencyCount: dependencyIds.length, recurring: !!normalizedRecurrence, approvalFlow })
      ]);

      return rows[0];
    });

    // Only send notifications if task is assigned to someone
    if (assignedTo) {
      await emitNotification(assignedTo, {
        type: 'task_assigned',
        title: 'New task assigned',
        body: title,
        data: { taskId: task.id }
      });

      const { rows: assigneeMeta } = await query(
        `SELECT manager_id FROM users WHERE id = $1 AND org_id = $2`,
        [assignedTo, orgId]
      );
      const mgrId = assigneeMeta[0]?.manager_id;
      if (mgrId && mgrId !== req.user.id && mgrId !== assignedTo) {
        await emitNotification(mgrId, {
          type: 'task_assigned_report',
          title: 'Your direct report was assigned a task',
          body: title,
          data: { taskId: task.id, assigneeId: assignedTo }
        });
      }
    }

    await logUserActivity({
      orgId,
      userId: req.user.id,
      taskId: task.id,
      activityType: 'task_created',
      metadata: { assignedTo, dependencyCount: dependencyIds.length }
    });

    res.status(201).json({ task: { ...task, recurrence: normalizedRecurrence, approval_flow: approvalFlow } });
  } catch (err) { next(err); }
});

router.get('/:id/dependencies', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    if (!(await assertCanViewTask(req, rows[0]))) return res.status(403).json({ error: 'Access denied' });
    const deps = await getDependencyMaps(req.params.id);
    res.json(deps);
  } catch (err) { next(err); }
});

router.post('/:id/dependencies', authenticate, requireAnyRole('supervisor', 'manager', 'director', 'admin'), async (req, res, next) => {
  try {
    const { dependencyId, dependencyType = 'blocks' } = req.body;
    if (!dependencyId) return res.status(400).json({ error: 'dependencyId is required' });

    const { rows: taskRows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!taskRows.length) return res.status(404).json({ error: 'Task not found' });
    const task = taskRows[0];
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });

    const { rows: depRows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [dependencyId, req.user.org_id ?? req.user.orgId]);
    if (!depRows.length) return res.status(404).json({ error: 'Dependency task not found' });

    await query(`
      INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type, created_by)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
    `, [req.params.id, dependencyId, dependencyType, req.user.id]);

    await query(`
      INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
      VALUES ($1, $2, 'user', 'dependency_added', $3, $4)
    `, [req.params.id, req.user.id, 'Task dependency linked', JSON.stringify({ dependencyId, dependencyType })]);

    res.status(201).json({ message: 'Dependency added' });
  } catch (err) { next(err); }
});

router.patch('/:id/priority', authenticate, async (req, res, next) => {
  try {
    const { priority } = req.body || {};
    if (!['low', 'medium', 'high', 'critical'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority value' });
    }

    const { rows } = await query(
      `SELECT * FROM tasks WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user.org_id ?? req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = {
      ...rows[0],
      recurrence: parseJsonField(rows[0].recurrence, null),
      metadata: parseJsonField(rows[0].metadata, {}),
      approval_flow: parseJsonField(rows[0].approval_flow, [])
    };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    if (task.priority === priority) return res.json({ message: 'Priority unchanged', taskId: task.id, priority });

    await withTransaction(async (client) => {
      await client.query(`UPDATE tasks SET priority = $1 WHERE id = $2`, [priority, task.id]);
      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
        VALUES ($1, $2, 'user', 'priority_changed', $3, $4)
      `, [
        task.id,
        req.user.id,
        `Priority changed from ${task.priority} to ${priority}`,
        JSON.stringify({ fromPriority: task.priority, toPriority: priority })
      ]);
    });

    await logUserActivity({
      orgId: req.user.org_id ?? req.user.orgId,
      userId: req.user.id,
      taskId: task.id,
      activityType: 'task_priority_changed',
      metadata: { fromPriority: task.priority, toPriority: priority }
    });

    res.json({ message: 'Priority updated', taskId: task.id, priority });
  } catch (err) { next(err); }
});

router.post('/:id/subtasks', authenticate, async (req, res, next) => {
  try {
    const { title, assignedTo, dueDate, priority = 'medium' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'Subtask title is required' });
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Parent task not found' });
    const parent = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, parent))) return res.status(403).json({ error: 'Access denied' });

    const { rows: created } = await query(`
      INSERT INTO tasks (
        org_id, title, description, assigned_to, assigned_by, category_id, priority,
        due_date, location, notes, recurrence, metadata, parent_task_id, next_run_at, approval_flow, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending')
      RETURNING *
    `, [
      parent.org_id,
      title,
      null,
      assignedTo || parent.assigned_to,
      req.user.id,
      parent.category_id,
      priority,
      dueDate || parent.due_date,
      parent.location || null,
      null,
      null,
      JSON.stringify({ source: 'subtask' }),
      parent.id,
      null,
      JSON.stringify([])
    ]);

    await query(`
      INSERT INTO task_dependencies (task_id, depends_on_task_id, dependency_type, created_by)
      VALUES ($1, $2, 'subtask', $3)
      ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
    `, [created[0].id, parent.id, req.user.id]);

    await query(`
      INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
      VALUES ($1, $2, 'user', 'subtask_created', $3, $4)
    `, [parent.id, req.user.id, 'Subtask added', JSON.stringify({ subtaskId: created[0].id, title })]);

    res.status(201).json({ subtask: created[0] });
  } catch (err) { next(err); }
});

router.post('/:id/checklist', authenticate, async (req, res, next) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Checklist text is required' });
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    const checklist = Array.isArray(task.metadata.checklist) ? task.metadata.checklist : [];
    const item = { id: `chk_${Date.now()}`, text: String(text).trim(), done: false, createdBy: req.user.id, createdAt: new Date().toISOString() };
    const metadata = { ...task.metadata, checklist: [...checklist, item] };
    await updateTaskMetadata(task.id, metadata);
    await query(`INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note) VALUES ($1,$2,'user','checklist_added',$3)`, [task.id, req.user.id, item.text]);
    res.status(201).json({ checklist: metadata.checklist, item });
  } catch (err) { next(err); }
});

router.patch('/:id/checklist/:itemId', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    const checklist = Array.isArray(task.metadata.checklist) ? task.metadata.checklist : [];
    const nextChecklist = checklist.map(item => String(item.id) === String(req.params.itemId)
      ? { ...item, ...(req.body.text !== undefined ? { text: String(req.body.text).trim() } : {}), ...(req.body.done !== undefined ? { done: !!req.body.done, completedAt: req.body.done ? new Date().toISOString() : null } : {}) }
      : item);
    const metadata = { ...task.metadata, checklist: nextChecklist };
    await updateTaskMetadata(task.id, metadata);
    await query(`INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata) VALUES ($1,$2,'user','checklist_updated',$3,$4)`, [
      task.id,
      req.user.id,
      'Checklist item updated',
      JSON.stringify({ itemId: req.params.itemId, done: req.body.done })
    ]);
    res.json({ checklist: metadata.checklist });
  } catch (err) { next(err); }
});

router.delete('/:id/checklist/:itemId', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    const checklist = Array.isArray(task.metadata.checklist) ? task.metadata.checklist : [];
    const metadata = { ...task.metadata, checklist: checklist.filter(item => String(item.id) !== String(req.params.itemId)) };
    await updateTaskMetadata(task.id, metadata);
    res.json({ checklist: metadata.checklist });
  } catch (err) { next(err); }
});

router.post('/:id/time/start', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    if (task.metadata.activeTimer?.startedAt) return res.status(400).json({ error: 'Timer already running' });
    const metadata = { ...task.metadata, activeTimer: { userId: req.user.id, startedAt: new Date().toISOString() }, timeEntries: Array.isArray(task.metadata.timeEntries) ? task.metadata.timeEntries : [] };
    await updateTaskMetadata(task.id, metadata);
    await query(`INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note) VALUES ($1,$2,'user','timer_started',$3)`, [task.id, req.user.id, 'Time tracking started']);
    res.json({ activeTimer: metadata.activeTimer, timeEntries: metadata.timeEntries });
  } catch (err) { next(err); }
});

router.post('/:id/time/stop', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = { ...rows[0], metadata: parseJsonField(rows[0].metadata, {}) };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    const active = task.metadata.activeTimer;
    if (!active?.startedAt) return res.status(400).json({ error: 'No active timer' });
    const startedAt = new Date(active.startedAt);
    const stoppedAt = new Date();
    const durationMs = Math.max(0, stoppedAt.getTime() - startedAt.getTime());
    const entry = {
      id: `time_${Date.now()}`,
      userId: req.user.id,
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      durationMs,
      note: String((req.body && req.body.note) || '').trim() || null
    };
    const entries = Array.isArray(task.metadata.timeEntries) ? task.metadata.timeEntries : [];
    const metadata = { ...task.metadata, activeTimer: null, timeEntries: [...entries, entry] };
    await updateTaskMetadata(task.id, metadata);
    await query(`INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata) VALUES ($1,$2,'user','timer_stopped',$3,$4)`, [
      task.id,
      req.user.id,
      'Time tracking stopped',
      JSON.stringify({ durationMs })
    ]);
    await logUserActivity({
      orgId: req.user.org_id ?? req.user.orgId,
      userId: req.user.id,
      taskId: task.id,
      activityType: 'task_time_logged',
      metadata: { durationMs }
    });
    res.json({ activeTimer: null, timeEntries: metadata.timeEntries, entry });
  } catch (err) { next(err); }
});


// PATCH /tasks/:id/rename - Rename a task title (manager+)
router.patch('/:id/rename', authenticate, requireAnyRole('supervisor','manager','hr','director','admin'), async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const { id } = req.params;
    const { title } = req.body;
    if (!title || String(title).trim().length < 1) return res.status(400).json({ error: 'Title required' });
    const newTitle = String(title).trim().slice(0, 255);
    const { rows } = await query(
      `UPDATE tasks SET title = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id, title`,
      [newTitle, id, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /tasks/:id/status
router.patch('/:id/status', authenticate, validateStatusUpdate, async (req, res, next) => {
  try {
    if (req.user.role === 'hr')
      return res.status(403).json({ error: 'HR role cannot change task status' });

    const { status, note } = req.body;
    const allowedTransitions = {
      // Assignee: every listed `from` status must have an array (possibly empty) or PATCH returns 400.
      employee: {
        pending: ['in_progress'],
        overdue: ['in_progress'],
        in_progress: ['submitted', 'pending'],
        submitted: ['in_progress'],
        ai_reviewing: [],
        ai_approved: ['completed', 'in_progress'],
        ai_rejected: ['pending', 'in_progress'],
        completed: ['pending', 'in_progress'],
        manager_approved: ['completed'],
        manager_rejected: ['in_progress'],
        cancelled: ['pending'],
      },
      // Supervisors and managers: board-style moves + manual overrides (My Tasks, escalations).
      supervisor: {
        pending: ['in_progress'],
        overdue: ['in_progress', 'completed', 'pending'],
        in_progress: ['submitted', 'completed', 'pending'],
        ai_reviewing: ['submitted', 'ai_approved', 'ai_rejected', 'completed'],
        ai_approved: ['completed', 'submitted'],
        ai_rejected: ['pending', 'in_progress', 'submitted'],
        submitted: ['manager_approved', 'manager_rejected', 'completed', 'ai_reviewing'],
        manager_approved: ['completed'],
        manager_rejected: ['pending', 'in_progress'],
        completed: ['pending', 'in_progress'],
        cancelled: ['pending'],
      },
      manager: {
        pending: ['in_progress'],
        overdue: ['in_progress', 'completed', 'pending'],
        in_progress: ['submitted', 'completed', 'pending'],
        ai_reviewing: ['submitted', 'ai_approved', 'ai_rejected', 'completed'],
        ai_approved: ['completed', 'submitted'],
        ai_rejected: ['pending', 'in_progress', 'submitted'],
        submitted: ['manager_approved', 'manager_rejected', 'completed', 'ai_reviewing'],
        manager_approved: ['completed'],
        manager_rejected: ['pending', 'in_progress'],
        completed: ['pending', 'in_progress'],
        cancelled: ['pending'],
      },
      hr: {},
      director: ['*'],
      admin: ['*']
    };

    const { rows } = await query(
      `SELECT * FROM tasks WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.user.org_id ?? req.user.orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });

    const task = {
      ...rows[0],
      recurrence: parseJsonField(rows[0].recurrence, null),
      metadata: parseJsonField(rows[0].metadata, {}),
      approval_flow: parseJsonField(rows[0].approval_flow, [])
    };
    const role = req.user.role;
    const allowed = allowedTransitions[role];

    if (['in_progress', 'submitted', 'completed'].includes(status)) {
      const blocking = await getIncompleteBlockingDependencies(task.id);
      if (blocking.length) {
        return res.status(400).json({
          error: 'Task is blocked by incomplete dependencies',
          blockers: blocking
        });
      }
    }

    const boardStatuses = new Set(['pending', 'in_progress', 'completed', 'overdue']);
    const boardRoleBypass = ['supervisor', 'manager', 'director', 'admin'].includes(role) && boardStatuses.has(status);

    if (!['director', 'admin'].includes(role) && !boardRoleBypass) {
      if (typeof allowed === 'object' && !Array.isArray(allowed)) {
        if (!allowed[task.status]?.includes(status)) {
          return res.status(400).json({ error: `Cannot transition from ${task.status} to ${status}` });
        }
      }
    }

    const timestampField = status === 'in_progress' ? ', started_at = NOW()'
      : status === 'submitted' ? ', submitted_at = NOW()'
      : status === 'completed' ? ', completed_at = NOW()'
      : '';

    let generatedTask = null;
    await withTransaction(async (client) => {
      await client.query(`
        UPDATE tasks SET status = $1, rejection_reason = $3${timestampField}
        WHERE id = $2
      `, [status, task.id, status.includes('rejected') ? note : null]);

      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, from_status, to_status, note)
        VALUES ($1, $2, 'user', 'status_changed', $3, $4, $5)
      `, [task.id, req.user.id, task.status, status, note]);

      if (status === 'completed') {
        generatedTask = await createRecurringFollowUp(client, task);
      }
    });

    await logUserActivity({
      orgId: req.user.org_id ?? req.user.orgId,
      userId: req.user.id,
      taskId: task.id,
      activityType: 'task_status_changed',
      metadata: { fromStatus: task.status, toStatus: status }
    });

    if (['manager_approved', 'manager_rejected', 'completed'].includes(status)) {
      await emitNotification(task.assigned_to, {
        type: `task_${status}`,
        title: `Task ${status.replace('_', ' ')}`,
        body: task.title,
        data: { taskId: task.id }
      });
    }
    if (generatedTask) {
      await emitNotification(task.assigned_to, {
        type: 'task_recurring_generated',
        title: 'Recurring task generated',
        body: generatedTask.title,
        data: { taskId: generatedTask.id, sourceTaskId: task.id }
      });
    }

    res.json({ message: 'Status updated', taskId: task.id, status, generatedTask });
  } catch (err) { next(err); }
});

// PATCH /tasks/:id/details - update due date and assignee (manager+)
router.patch('/:id/details', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const orgId = req.user.org_id ?? req.user.orgId;
    const { assignedTo, dueDate } = req.body || {};

    const { rows: existingRows } = await query(
      `SELECT id, org_id, title, assigned_to, due_date FROM tasks WHERE id = $1 AND org_id = $2`,
      [taskId, orgId]
    );
    if (!existingRows.length) return res.status(404).json({ error: 'Task not found' });
    const task = existingRows[0];

    const updates = [];
    const params = [];
    let p = 1;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assignedTo')) {
      if (assignedTo) {
        const { rows: u } = await query(
          `SELECT id FROM users WHERE id = $1 AND org_id = $2 AND is_active = TRUE LIMIT 1`,
          [assignedTo, orgId]
        );
        if (!u.length) return res.status(400).json({ error: 'Invalid assignee for this organization' });
      }
      updates.push(`assigned_to = $${p++}`);
      params.push(assignedTo || null);
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate')) {
      const normalizedDueDate = dueDate ? new Date(dueDate) : null;
      if (dueDate && Number.isNaN(normalizedDueDate?.getTime())) {
        return res.status(400).json({ error: 'Invalid due date' });
      }
      updates.push(`due_date = $${p++}`);
      params.push(normalizedDueDate ? normalizedDueDate.toISOString() : null);
    }

    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });
    updates.push(`updated_at = NOW()`);
    params.push(taskId, orgId);

    const { rows: updatedRows } = await query(
      `UPDATE tasks
          SET ${updates.join(', ')}
        WHERE id = $${p++} AND org_id = $${p++}
      RETURNING *`,
      params
    );
    const updated = updatedRows[0];

    const timelineNotes = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assignedTo') && String(task.assigned_to || '') !== String(updated.assigned_to || '')) {
      timelineNotes.push('assignee_updated');
      await query(
        `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
         VALUES ($1,$2,'user','assignee_updated',$3,$4)`,
        [taskId, req.user.id, 'Task assignee changed', JSON.stringify({ from: task.assigned_to, to: updated.assigned_to })]
      );
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'dueDate') && String(task.due_date || '') !== String(updated.due_date || '')) {
      timelineNotes.push('due_date_updated');
      await query(
        `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
         VALUES ($1,$2,'user','due_date_updated',$3,$4)`,
        [taskId, req.user.id, 'Task due date changed', JSON.stringify({ from: task.due_date, to: updated.due_date })]
      );
    }

    const { rows: joinedRows } = await query(
      `SELECT t.*, u.full_name AS assigned_to_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.id = $1 AND t.org_id = $2`,
      [taskId, orgId]
    );

    res.json({ task: joinedRows[0], updatedFields: timelineNotes });
  } catch (err) {
    next(err);
  }
});

// POST /tasks/:id/ai-review — submit a task for AI approval (text-based)
router.post('/:id/ai-review', authenticate, async (req, res, next) => {
  try {
    const orgId = req.user.org_id ?? req.user.orgId;
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });

    const task = rows[0];
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });

    // Only the assignee can request AI review for their own submitted work.
    if (task.assigned_to !== req.user.id) return res.status(403).json({ error: 'Only the assignee can request AI review' });
    if (task.status !== 'submitted') return res.status(400).json({ error: 'Only submitted tasks can be sent for AI review' });

    await withTransaction(async (client) => {
      await client.query(`UPDATE tasks SET status = 'ai_reviewing' WHERE id = $1`, [task.id]);
      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, from_status, to_status, note)
        VALUES ($1, $2, 'user', 'ai_task_review_requested', $3, 'ai_reviewing', 'Task submitted for AI review')
      `, [task.id, req.user.id, task.status]);
    });

    triggerAITaskReview(task.id).catch(() => null);
    res.json({ message: 'AI review started', taskId: task.id, status: 'ai_reviewing' });
  } catch (err) { next(err); }
});

router.post('/:id/approve', authenticate, requireAnyRole('supervisor', 'manager', 'director', 'admin'), async (req, res, next) => {
  try {
    const { note } = req.body || {};
    const { rows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!rows.length) return res.status(404).json({ error: 'Task not found' });
    const task = {
      ...rows[0],
      recurrence: parseJsonField(rows[0].recurrence, null),
      metadata: parseJsonField(rows[0].metadata, {}),
      approval_flow: parseJsonField(rows[0].approval_flow, [])
    };
    if (!(await assertCanViewTask(req, task))) return res.status(403).json({ error: 'Access denied' });
    if (task.status !== 'submitted') return res.status(400).json({ error: 'Only submitted tasks can enter approval flow' });

    const flow = task.approval_flow.length ? task.approval_flow : ['supervisor', 'manager'];
    const approvalIndex = parseInt(task.metadata.approval_index || 0, 10);
    const expectedRole = flow[Math.min(approvalIndex, flow.length - 1)];
    if (!['director', 'admin'].includes(req.user.role) && req.user.role !== expectedRole) {
      return res.status(403).json({ error: `Current approval step requires role: ${expectedRole}` });
    }

    const nextIndex = approvalIndex + 1;
    const finished = nextIndex >= flow.length;
    const nextMetadata = { ...task.metadata, approval_index: nextIndex, last_approved_by: req.user.id };

    await withTransaction(async (client) => {
      await client.query(`
        UPDATE tasks
        SET metadata = $1, status = $2${finished ? ', completed_at = NOW()' : ''}
        WHERE id = $3
      `, [JSON.stringify(nextMetadata), finished ? 'completed' : 'submitted', task.id]);

      await client.query(`
        INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, from_status, to_status, note, metadata)
        VALUES ($1, $2, 'user', $3, $4, $5, $6, $7)
      `, [
        task.id,
        req.user.id,
        finished ? 'approval_flow_completed' : 'approval_step_completed',
        task.status,
        finished ? 'completed' : 'submitted',
        note || `Approved by ${req.user.role}`,
        JSON.stringify({ approvalIndex, nextIndex, flow })
      ]);
    });

    await emitNotification(task.assigned_to, {
      type: finished ? 'task_completed' : 'task_approval_progress',
      title: finished ? 'Task fully approved' : 'Task advanced in approval flow',
      body: task.title,
      data: { taskId: task.id, step: nextIndex, total: flow.length }
    });

    res.json({
      message: finished ? 'Task fully approved' : 'Approval step recorded',
      taskId: task.id,
      completed: finished,
      approvalState: {
        flow,
        currentStep: nextIndex,
        totalSteps: flow.length,
        nextRole: finished ? null : flow[nextIndex]
      }
    });
  } catch (err) { next(err); }
});

router.get('/:id/timeline', authenticate, async (req, res, next) => {
  try {
    const { rows: taskRows } = await query(`SELECT * FROM tasks WHERE id = $1 AND org_id = $2`, [req.params.id, req.user.org_id ?? req.user.orgId]);
    if (!taskRows.length) return res.status(404).json({ error: 'Task not found' });
    if (!(await assertCanViewTask(req, taskRows[0]))) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await query(`
      SELECT tl.*, u.full_name AS actor_name, u.role AS actor_role
      FROM task_timeline tl
      LEFT JOIN users u ON u.id = tl.actor_id
      WHERE tl.task_id = $1
      ORDER BY tl.created_at ASC
    `, [req.params.id]);

    res.json({ timeline: rows });
  } catch (err) { next(err); }
});

module.exports = router;
