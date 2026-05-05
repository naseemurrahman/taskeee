const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logUserActivity } = require('../services/activityService');
const { emitNotification } = require('../services/notificationService');

let initialized = false;
let taskColumnsCache = null;

async function ensureTemplateTable() {
  if (initialized) return;
  await query(`
    CREATE TABLE IF NOT EXISTS task_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      task_title TEXT NOT NULL,
      task_description TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      category_id UUID NULL,
      default_due_days INTEGER NULL,
      checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID NULL,
      updated_by UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_templates_org_created ON task_templates(org_id, created_at DESC)`);
  initialized = true;
}

async function getTaskColumns() {
  if (taskColumnsCache) return taskColumnsCache;
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks'`
  );
  taskColumnsCache = new Set(rows.map(r => String(r.column_name)));
  return taskColumnsCache;
}

function parseChecklist(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .map((item, index) => {
      if (typeof item === 'string') return { title: item.trim(), order: index + 1 };
      return { title: String(item?.title || '').trim(), order: Number(item?.order || index + 1) || index + 1 };
    })
    .filter(item => item.title.length > 0)
    .slice(0, 50);
}

function validatePriority(priority) {
  const p = String(priority || 'medium').trim().toLowerCase();
  return ['low', 'medium', 'high', 'critical'].includes(p) ? p : 'medium';
}

function safeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 0 || n > 365) return null;
  return n;
}

function dueDateFromDays(days) {
  const n = safeInt(days);
  if (n == null) return null;
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function normalizeTemplate(row) {
  return {
    ...row,
    checklist_items: Array.isArray(row.checklist_items) ? row.checklist_items : parseChecklist(row.checklist_items),
    metadata: row.metadata || {},
  };
}

async function loadTemplate(orgId, templateId) {
  const { rows } = await query(
    `SELECT * FROM task_templates WHERE org_id = $1 AND id = $2`,
    [orgId, templateId]
  );
  return rows[0] ? normalizeTemplate(rows[0]) : null;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    await ensureTemplateTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `SELECT tt.*, u.full_name AS created_by_name
         FROM task_templates tt
         LEFT JOIN users u ON u.id = tt.created_by
        WHERE tt.org_id = $1
        ORDER BY tt.updated_at DESC, tt.created_at DESC`,
      [orgId]
    );
    res.json({ templates: rows.map(normalizeTemplate) });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureTemplateTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const name = String(req.body?.name || '').trim();
    const taskTitle = String(req.body?.taskTitle || req.body?.task_title || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Template name must be at least 2 characters' });
    if (taskTitle.length < 2) return res.status(400).json({ error: 'Task title must be at least 2 characters' });

    const description = String(req.body?.description || '').trim() || null;
    const taskDescription = String(req.body?.taskDescription || req.body?.task_description || '').trim() || null;
    const priority = validatePriority(req.body?.priority);
    const categoryId = req.body?.categoryId || req.body?.category_id || null;
    const defaultDueDays = safeInt(req.body?.defaultDueDays ?? req.body?.default_due_days);
    const checklist = parseChecklist(req.body?.checklistItems || req.body?.checklist_items);

    const { rows } = await query(
      `INSERT INTO task_templates (
         org_id, name, description, task_title, task_description, priority, category_id,
         default_due_days, checklist_items, metadata, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [orgId, name, description, taskTitle, taskDescription, priority, categoryId, defaultDueDays, JSON.stringify(checklist), JSON.stringify({ version: 1 }), req.user.id]
    );

    await logUserActivity({ orgId, userId: req.user.id, activityType: 'task_template_created', metadata: { templateId: rows[0].id, name } }).catch(() => null);
    res.status(201).json({ template: normalizeTemplate(rows[0]) });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureTemplateTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const existing = await loadTemplate(orgId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });

    const requestedTaskTitle = req.body?.taskTitle ?? req.body?.task_title;
    const requestedTaskDescription = req.body?.taskDescription ?? req.body?.task_description;
    const requestedCategoryId = req.body?.categoryId ?? req.body?.category_id;
    const requestedDefaultDueDays = req.body?.defaultDueDays ?? req.body?.default_due_days;
    const requestedChecklist = req.body?.checklistItems ?? req.body?.checklist_items;

    const name = req.body?.name !== undefined ? String(req.body.name || '').trim() : existing.name;
    const taskTitle = requestedTaskTitle !== undefined ? String(requestedTaskTitle || '').trim() : existing.task_title;
    if (name.length < 2) return res.status(400).json({ error: 'Template name must be at least 2 characters' });
    if (taskTitle.length < 2) return res.status(400).json({ error: 'Task title must be at least 2 characters' });

    const description = req.body?.description !== undefined ? String(req.body.description || '').trim() || null : existing.description;
    const taskDescription = requestedTaskDescription !== undefined ? String(requestedTaskDescription || '').trim() || null : existing.task_description;
    const priority = req.body?.priority !== undefined ? validatePriority(req.body.priority) : existing.priority;
    const categoryId = requestedCategoryId !== undefined ? (requestedCategoryId || null) : existing.category_id;
    const defaultDueDays = requestedDefaultDueDays !== undefined ? safeInt(requestedDefaultDueDays) : existing.default_due_days;
    const checklist = requestedChecklist !== undefined ? parseChecklist(requestedChecklist) : existing.checklist_items;

    const { rows } = await query(
      `UPDATE task_templates
          SET name = $1, description = $2, task_title = $3, task_description = $4,
              priority = $5, category_id = $6, default_due_days = $7,
              checklist_items = $8, updated_by = $9, updated_at = NOW()
        WHERE org_id = $10 AND id = $11
        RETURNING *`,
      [name, description, taskTitle, taskDescription, priority, categoryId, defaultDueDays, JSON.stringify(checklist), req.user.id, orgId, req.params.id]
    );

    await logUserActivity({ orgId, userId: req.user.id, activityType: 'task_template_updated', metadata: { templateId: req.params.id, name } }).catch(() => null);
    res.json({ template: normalizeTemplate(rows[0]) });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureTemplateTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `DELETE FROM task_templates WHERE org_id = $1 AND id = $2 RETURNING id, name`,
      [orgId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    await logUserActivity({ orgId, userId: req.user.id, activityType: 'task_template_deleted', metadata: { templateId: rows[0].id, name: rows[0].name } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/create-task', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureTemplateTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const template = await loadTemplate(orgId, req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const assignedTo = String(req.body?.assignedTo || req.body?.assigned_to || '').trim();
    if (!assignedTo) return res.status(400).json({ error: 'Select an assignee before creating a task from template' });

    const title = String(req.body?.title || template.task_title).trim();
    const description = String(req.body?.description ?? template.task_description ?? '').trim() || null;
    const priority = validatePriority(req.body?.priority || template.priority);
    const dueDate = String(req.body?.dueDate || req.body?.due_date || dueDateFromDays(template.default_due_days) || '').trim() || null;
    const categoryId = req.body?.categoryId || req.body?.category_id || template.category_id || null;
    const checklist = parseChecklist(template.checklist_items);
    const taskCols = await getTaskColumns();

    const created = await withTransaction(async (client) => {
      const cols = ['org_id', 'title', 'status', 'priority', 'assigned_by', 'assigned_to'];
      const vals = [orgId, title, 'pending', priority, req.user.id, assignedTo];
      if (taskCols.has('description')) { cols.push('description'); vals.push(description); }
      if (taskCols.has('due_date')) { cols.push('due_date'); vals.push(dueDate); }
      if (taskCols.has('category_id')) { cols.push('category_id'); vals.push(categoryId); }
      if (taskCols.has('metadata')) { cols.push('metadata'); vals.push(JSON.stringify({ template_id: template.id, template_name: template.name, checklist })); }

      const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await client.query(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${ph}) RETURNING *`, vals);
      const parent = rows[0];

      if (checklist.length && taskCols.has('parent_task_id')) {
        for (const item of checklist) {
          const subCols = ['org_id', 'title', 'status', 'priority', 'assigned_by', 'assigned_to', 'parent_task_id'];
          const subVals = [orgId, item.title, 'pending', priority, req.user.id, assignedTo, parent.id];
          if (taskCols.has('description')) { subCols.push('description'); subVals.push(`Checklist item from template: ${template.name}`); }
          if (taskCols.has('due_date')) { subCols.push('due_date'); subVals.push(dueDate); }
          if (taskCols.has('category_id')) { subCols.push('category_id'); subVals.push(categoryId); }
          if (taskCols.has('metadata')) { subCols.push('metadata'); subVals.push(JSON.stringify({ template_id: template.id, checklist_item: true, checklist_order: item.order })); }
          const subPh = subVals.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(`INSERT INTO tasks (${subCols.join(', ')}) VALUES (${subPh})`, subVals);
        }
      }

      try {
        await client.query(
          `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
           VALUES ($1,$2,'user','task_created_from_template',$3,$4)`,
          [parent.id, req.user.id, `Task created from template ${template.name}`, JSON.stringify({ templateId: template.id, checklistCount: checklist.length })]
        );
      } catch (_) {}
      return parent;
    });

    emitNotification(assignedTo, { type: 'task_assigned', title: 'New task assigned', body: title, data: { taskId: created.id } }).catch(() => null);
    await logUserActivity({ orgId, userId: req.user.id, taskId: created.id, activityType: 'task_created_from_template', metadata: { templateId: template.id, checklistCount: checklist.length } }).catch(() => null);
    res.status(201).json({ task: created, checklistCreated: taskCols.has('parent_task_id') ? checklist.length : 0 });
  } catch (err) { next(err); }
});

module.exports = router;
