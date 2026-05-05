'use strict';

const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');

const MANAGER_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical', 'urgent']);

router.use(authenticate, requireAnyRole(...MANAGER_ROLES));

function orgId(req) { return req.user.org_id || req.user.orgId; }
function uniqIds(ids) { return Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))].slice(0, 250) : []; }
function safeText(v, max = 5000) { return String(v || '').trim().slice(0, max); }

async function addTimeline(client, taskId, req, eventType, note, metadata = {}) {
  try {
    await client.query(
      `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
       VALUES ($1, $2, 'user', $3, $4, $5)`,
      [taskId, req.user.id, eventType, note, JSON.stringify(metadata)]
    );
  } catch (_) {}
}

async function ensureWorkflowSchema() {
  await query(`CREATE TABLE IF NOT EXISTS task_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    title TEXT NOT NULL,
    task_description TEXT,
    priority TEXT DEFAULT 'medium',
    category_id UUID NULL,
    project_id UUID NULL,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    recurrence_rule JSONB,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_templates_org ON task_templates(org_id, created_at DESC)`);
  await query(`CREATE TABLE IF NOT EXISTS saved_task_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_saved_task_views_user ON saved_task_views(user_id, created_at DESC)`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule JSONB`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES task_templates(id) ON DELETE SET NULL`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS restored_by UUID REFERENCES users(id) ON DELETE SET NULL`);
}

router.get('/templates', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const { rows } = await query(`SELECT * FROM task_templates WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100`, [orgId(req)]);
    res.json({ templates: rows });
  } catch (err) { next(err); }
});

router.post('/templates', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const name = safeText(req.body?.name, 160);
    const title = safeText(req.body?.title || name, 240);
    if (!name || !title) return res.status(400).json({ error: 'Template name and title are required' });
    const checklist = Array.isArray(req.body?.checklist) ? req.body.checklist : [];
    const recurrenceRule = req.body?.recurrenceRule || req.body?.recurrence_rule || null;
    const priority = PRIORITIES.has(String(req.body?.priority || '').toLowerCase()) ? String(req.body.priority).toLowerCase() : 'medium';
    const { rows } = await query(
      `INSERT INTO task_templates (org_id, name, description, title, task_description, priority, category_id, project_id, checklist, recurrence_rule, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [orgId(req), name, safeText(req.body?.description), title, safeText(req.body?.task_description || req.body?.taskDescription), priority, req.body?.category_id || null, req.body?.project_id || null, JSON.stringify(checklist), recurrenceRule ? JSON.stringify(recurrenceRule) : null, req.user.id]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) { next(err); }
});

router.post('/templates/:id/create-task', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const { rows } = await query(`SELECT * FROM task_templates WHERE id = $1 AND org_id = $2`, [req.params.id, orgId(req)]);
    const tpl = rows[0];
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    const title = safeText(req.body?.title || tpl.title, 240);
    const assignedTo = req.body?.assigned_to || req.body?.assignedTo || null;
    const dueDate = req.body?.due_date || req.body?.dueDate || null;
    const inserted = await query(
      `INSERT INTO tasks (org_id, title, description, priority, category_id, project_id, assigned_to, due_date, checklist, recurrence_rule, template_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [orgId(req), title, req.body?.description || tpl.task_description, tpl.priority || 'medium', tpl.category_id, tpl.project_id, assignedTo, dueDate, JSON.stringify(tpl.checklist || []), tpl.recurrence_rule ? JSON.stringify(tpl.recurrence_rule) : null, tpl.id, req.user.id]
    );
    res.status(201).json({ task: inserted.rows[0] });
  } catch (err) { next(err); }
});

router.get('/views', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const { rows } = await query(`SELECT * FROM saved_task_views WHERE org_id = $1 AND user_id = $2 ORDER BY is_default DESC, created_at DESC`, [orgId(req), req.user.id]);
    res.json({ views: rows });
  } catch (err) { next(err); }
});

router.post('/views', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const name = safeText(req.body?.name, 120);
    if (!name) return res.status(400).json({ error: 'View name is required' });
    const filters = req.body?.filters && typeof req.body.filters === 'object' ? req.body.filters : {};
    const { rows } = await query(
      `INSERT INTO saved_task_views (org_id, user_id, name, filters, is_default) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [orgId(req), req.user.id, name, JSON.stringify(filters), !!req.body?.is_default]
    );
    res.status(201).json({ view: rows[0] });
  } catch (err) { next(err); }
});

router.post('/bulk/update', async (req, res, next) => {
  try {
    const ids = uniqIds(req.body?.ids);
    if (!ids.length) return res.status(400).json({ error: 'At least one task id is required' });
    const updates = [];
    const params = [];
    function set(col, val) { params.push(val); updates.push(`${col} = $${params.length}`); }
    if (req.body?.assigned_to !== undefined) set('assigned_to', req.body.assigned_to || null);
    if (req.body?.priority !== undefined) {
      const p = String(req.body.priority || '').toLowerCase();
      if (!PRIORITIES.has(p)) return res.status(400).json({ error: 'Valid priority is required' });
      set('priority', p);
    }
    if (req.body?.due_date !== undefined) set('due_date', req.body.due_date || null);
    if (req.body?.project_id !== undefined) set('project_id', req.body.project_id || null);
    if (req.body?.category_id !== undefined) set('category_id', req.body.category_id || null);
    if (!updates.length) return res.status(400).json({ error: 'No supported update fields provided' });
    set('updated_at', new Date().toISOString());
    params.push(orgId(req)); const orgParam = params.length;
    params.push(ids); const idsParam = params.length;
    const updated = await query(
      `UPDATE tasks SET ${updates.join(', ')} WHERE org_id = $${orgParam} AND id = ANY($${idsParam}::uuid[]) AND deleted_at IS NULL RETURNING id, title, status, priority, assigned_to, due_date, project_id, category_id`,
      params
    );
    try {
      await withTransaction(async (client) => {
        for (const t of updated.rows) await addTimeline(client, t.id, req, 'bulk_updated', 'Task updated by bulk action', { fields: Object.keys(req.body || {}).filter(k => k !== 'ids') });
      });
    } catch (_) {}
    res.json({ ok: true, requested: ids.length, updated: updated.rowCount, tasks: updated.rows });
  } catch (err) { next(err); }
});

router.patch('/:id/checklist', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const checklist = Array.isArray(req.body?.checklist) ? req.body.checklist : [];
    const { rows } = await query(`UPDATE tasks SET checklist = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 AND deleted_at IS NULL RETURNING id, checklist`, [JSON.stringify(checklist), req.params.id, orgId(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id/recurrence', async (req, res, next) => {
  try {
    await ensureWorkflowSchema();
    const recurrenceRule = req.body?.recurrenceRule || req.body?.recurrence_rule || null;
    const { rows } = await query(`UPDATE tasks SET recurrence_rule = $1, next_run_at = COALESCE($2, next_run_at), updated_at = NOW() WHERE id = $3 AND org_id = $4 AND deleted_at IS NULL RETURNING id, recurrence_rule, next_run_at`, [recurrenceRule ? JSON.stringify(recurrenceRule) : null, req.body?.next_run_at || req.body?.nextRunAt || null, req.params.id, orgId(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: rows[0] });
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const { rows } = await query(`UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, restored_at = NOW(), restored_by = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING id, title, deleted_at, restored_at`, [req.user.id, req.params.id, orgId(req)]);
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, task: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id/timeline', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT tt.*, u.full_name AS actor_name, u.email AS actor_email
         FROM task_timeline tt
         LEFT JOIN users u ON u.id = tt.actor_id
         JOIN tasks t ON t.id = tt.task_id AND t.org_id = $2
        WHERE tt.task_id = $1
        ORDER BY tt.created_at DESC
        LIMIT 100`,
      [req.params.id, orgId(req)]
    );
    res.json({ events: rows });
  } catch (err) { next(err); }
});

module.exports = router;
