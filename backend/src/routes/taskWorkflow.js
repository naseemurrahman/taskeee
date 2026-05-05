'use strict';

const express = require('express');
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');

const router = express.Router();
const MANAGER_ROLES = ['supervisor', 'manager', 'hr', 'director', 'admin'];

router.use(authenticate);

function orgId(req) { return req.user.org_id || req.user.orgId; }
function userId(req) { return req.user.id; }
function safeLimit(v, fallback = 50, max = 200) {
  const n = parseInt(String(v || fallback), 10);
  return Math.min(max, Math.max(1, Number.isFinite(n) ? n : fallback));
}
function normalizeIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.map(String).filter(Boolean))].slice(0, 500) : [];
}

async function ensureSchema() {
  await query(`CREATE TABLE IF NOT EXISTS task_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    title TEXT NOT NULL,
    task_description TEXT,
    priority TEXT DEFAULT 'medium',
    category_id UUID,
    project_id UUID,
    default_assignee UUID REFERENCES users(id) ON DELETE SET NULL,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    recurrence JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_templates_org ON task_templates(org_id, is_active, updated_at DESC)`);

  await query(`CREATE TABLE IF NOT EXISTS task_checklist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_checklist_task ON task_checklist_items(task_id, position, created_at)`);

  await query(`CREATE TABLE IF NOT EXISTS task_saved_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_task_saved_views_user ON task_saved_views(org_id, user_id, updated_at DESC)`);

  await query(`CREATE TABLE IF NOT EXISTS recurring_task_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES task_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    cadence TEXT NOT NULL DEFAULT 'weekly',
    interval_count INTEGER NOT NULL DEFAULT 1,
    next_run_at TIMESTAMPTZ NOT NULL,
    timezone TEXT DEFAULT 'UTC',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_recurring_task_rules_due ON recurring_task_rules(org_id, is_active, next_run_at)`);

  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS template_id UUID`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_rule_id UUID`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ`);
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS restored_by UUID REFERENCES users(id) ON DELETE SET NULL`);
}

function nextRunFrom(cadence, intervalCount, from = new Date()) {
  const d = new Date(from);
  const interval = Math.max(1, Number(intervalCount || 1));
  if (cadence === 'daily') d.setDate(d.getDate() + interval);
  else if (cadence === 'monthly') d.setMonth(d.getMonth() + interval);
  else d.setDate(d.getDate() + interval * 7);
  return d.toISOString();
}

async function logTimeline(taskId, actorId, eventType, note, metadata = {}) {
  try {
    await query(
      `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
       VALUES ($1, $2, 'user', $3, $4, $5)`,
      [taskId, actorId, eventType, note, JSON.stringify(metadata)]
    );
  } catch (_) {}
}

router.get('/templates', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(
      `SELECT * FROM task_templates WHERE org_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT $2`,
      [orgId(req), safeLimit(req.query.limit, 50)]
    );
    res.json({ templates: rows });
  } catch (err) { next(err); }
});

router.post('/templates', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const name = String(b.name || b.title || '').trim();
    const title = String(b.title || b.name || '').trim();
    if (!name || !title) return res.status(400).json({ error: 'name and title are required' });
    const { rows } = await query(
      `INSERT INTO task_templates (org_id, name, description, title, task_description, priority, category_id, project_id, default_assignee, checklist, recurrence, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [orgId(req), name, b.description || null, title, b.taskDescription || b.task_description || null, b.priority || 'medium', b.categoryId || null, b.projectId || null, b.defaultAssignee || null, JSON.stringify(b.checklist || []), JSON.stringify(b.recurrence || {}), userId(req)]
    );
    res.status(201).json({ template: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/templates/:id', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE task_templates
          SET name = COALESCE($3, name), description = COALESCE($4, description), title = COALESCE($5, title),
              task_description = COALESCE($6, task_description), priority = COALESCE($7, priority),
              category_id = COALESCE($8, category_id), project_id = COALESCE($9, project_id),
              default_assignee = COALESCE($10, default_assignee), checklist = COALESCE($11, checklist),
              recurrence = COALESCE($12, recurrence), updated_at = NOW()
        WHERE id = $1 AND org_id = $2 AND is_active = TRUE
        RETURNING *`,
      [req.params.id, orgId(req), b.name || null, b.description || null, b.title || null, b.taskDescription || b.task_description || null, b.priority || null, b.categoryId || null, b.projectId || null, b.defaultAssignee || null, b.checklist ? JSON.stringify(b.checklist) : null, b.recurrence ? JSON.stringify(b.recurrence) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/templates/:id', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    await query(`UPDATE task_templates SET is_active = FALSE, updated_at = NOW() WHERE id = $1 AND org_id = $2`, [req.params.id, orgId(req)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/templates/:id/create-task', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(`SELECT * FROM task_templates WHERE id = $1 AND org_id = $2 AND is_active = TRUE`, [req.params.id, orgId(req)]);
    const tpl = rows[0];
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    const b = req.body || {};
    const task = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO tasks (org_id, title, description, status, priority, assigned_to, assigned_by, category_id, project_id, due_date, template_id)
         VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [orgId(req), b.title || tpl.title, b.description || tpl.task_description || null, b.priority || tpl.priority || 'medium', b.assignedTo || tpl.default_assignee || null, userId(req), b.categoryId || tpl.category_id || null, b.projectId || tpl.project_id || null, b.dueDate || null, tpl.id]
      );
      const created = ins.rows[0];
      const items = Array.isArray(tpl.checklist) ? tpl.checklist : [];
      for (let i = 0; i < items.length; i++) {
        const title = typeof items[i] === 'string' ? items[i] : items[i]?.title;
        if (title) await client.query(`INSERT INTO task_checklist_items (task_id, title, position, created_by) VALUES ($1,$2,$3,$4)`, [created.id, title, i, userId(req)]);
      }
      return created;
    });
    await logTimeline(task.id, userId(req), 'task_created_from_template', `Created from template ${tpl.name}`, { templateId: tpl.id });
    res.status(201).json({ task });
  } catch (err) { next(err); }
});

router.get('/saved-views', async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(`SELECT * FROM task_saved_views WHERE org_id = $1 AND user_id = $2 ORDER BY is_default DESC, updated_at DESC`, [orgId(req), userId(req)]);
    res.json({ views: rows });
  } catch (err) { next(err); }
});

router.post('/saved-views', async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'name is required' });
    const created = await withTransaction(async (client) => {
      if (b.isDefault) await client.query(`UPDATE task_saved_views SET is_default = FALSE WHERE org_id = $1 AND user_id = $2`, [orgId(req), userId(req)]);
      const { rows } = await client.query(
        `INSERT INTO task_saved_views (org_id, user_id, name, filters, columns, is_default)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [orgId(req), userId(req), String(b.name).trim(), JSON.stringify(b.filters || {}), JSON.stringify(b.columns || []), !!b.isDefault]
      );
      return rows[0];
    });
    res.status(201).json({ view: created });
  } catch (err) { next(err); }
});

router.delete('/saved-views/:id', async (req, res, next) => {
  try {
    await ensureSchema();
    await query(`DELETE FROM task_saved_views WHERE id = $1 AND org_id = $2 AND user_id = $3`, [req.params.id, orgId(req), userId(req)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:taskId/checklist', async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(`SELECT c.* FROM task_checklist_items c JOIN tasks t ON t.id = c.task_id WHERE c.task_id = $1 AND t.org_id = $2 ORDER BY c.position, c.created_at`, [req.params.taskId, orgId(req)]);
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/:taskId/checklist', async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });
    const { rows } = await query(
      `INSERT INTO task_checklist_items (task_id, title, position, created_by)
       SELECT $1, $3, COALESCE($4, 0), $5 FROM tasks WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [req.params.taskId, orgId(req), title, b.position || 0, userId(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    await logTimeline(req.params.taskId, userId(req), 'checklist_item_added', `Checklist item added: ${title}`);
    res.status(201).json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:taskId/checklist/:itemId', async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE task_checklist_items c
          SET title = COALESCE($5, c.title), is_done = COALESCE($6, c.is_done), position = COALESCE($7, c.position), updated_at = NOW()
         FROM tasks t
        WHERE c.id = $1 AND c.task_id = $2 AND t.id = c.task_id AND t.org_id = $3
        RETURNING c.*`,
      [req.params.itemId, req.params.taskId, orgId(req), userId(req), b.title || null, typeof b.isDone === 'boolean' ? b.isDone : null, Number.isFinite(Number(b.position)) ? Number(b.position) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Checklist item not found' });
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:taskId/checklist/:itemId', async (req, res, next) => {
  try {
    await ensureSchema();
    await query(`DELETE FROM task_checklist_items c USING tasks t WHERE c.id = $1 AND c.task_id = $2 AND t.id = c.task_id AND t.org_id = $3`, [req.params.itemId, req.params.taskId, orgId(req)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/recurring-rules', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(`SELECT * FROM recurring_task_rules WHERE org_id = $1 ORDER BY is_active DESC, next_run_at ASC LIMIT $2`, [orgId(req), safeLimit(req.query.limit, 50)]);
    res.json({ rules: rows });
  } catch (err) { next(err); }
});

router.post('/recurring-rules', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      `INSERT INTO recurring_task_rules (org_id, template_id, name, cadence, interval_count, next_run_at, timezone, payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [orgId(req), b.templateId || null, name, b.cadence || 'weekly', Math.max(1, Number(b.intervalCount || 1)), b.nextRunAt || new Date().toISOString(), b.timezone || 'UTC', JSON.stringify(b.payload || {}), userId(req)]
    );
    res.status(201).json({ rule: rows[0] });
  } catch (err) { next(err); }
});

router.post('/recurring-rules/run-due', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows: rules } = await query(`SELECT * FROM recurring_task_rules WHERE org_id = $1 AND is_active = TRUE AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT 50`, [orgId(req)]);
    const created = [];
    await withTransaction(async (client) => {
      for (const r of rules) {
        const payload = r.payload || {};
        let tpl = null;
        if (r.template_id) {
          const t = await client.query(`SELECT * FROM task_templates WHERE id = $1 AND org_id = $2`, [r.template_id, orgId(req)]);
          tpl = t.rows[0] || null;
        }
        const title = payload.title || tpl?.title || r.name;
        const ins = await client.query(
          `INSERT INTO tasks (org_id, title, description, status, priority, assigned_to, assigned_by, category_id, project_id, due_date, template_id, recurring_rule_id)
           VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [orgId(req), title, payload.description || tpl?.task_description || null, payload.priority || tpl?.priority || 'medium', payload.assignedTo || tpl?.default_assignee || null, r.created_by || userId(req), payload.categoryId || tpl?.category_id || null, payload.projectId || tpl?.project_id || null, payload.dueDate || null, tpl?.id || null, r.id]
        );
        created.push(ins.rows[0]);
        await client.query(`UPDATE recurring_task_rules SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW() WHERE id = $1`, [r.id, nextRunFrom(r.cadence, r.interval_count)]);
      }
    });
    res.json({ ok: true, processed: rules.length, created });
  } catch (err) { next(err); }
});

router.post('/bulk', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const ids = normalizeIds(req.body?.ids);
    const patch = req.body?.patch || {};
    if (!ids.length) return res.status(400).json({ error: 'ids are required' });
    const allowed = ['assignedTo', 'priority', 'dueDate', 'projectId', 'categoryId'];
    if (!allowed.some(k => Object.prototype.hasOwnProperty.call(patch, k))) return res.status(400).json({ error: 'No supported bulk patch fields supplied' });
    const sets = [];
    const params = [orgId(req), ids];
    const add = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };
    if ('assignedTo' in patch) add('assigned_to', patch.assignedTo || null);
    if ('priority' in patch) add('priority', patch.priority || null);
    if ('dueDate' in patch) add('due_date', patch.dueDate || null);
    if ('projectId' in patch) add('project_id', patch.projectId || null);
    if ('categoryId' in patch) add('category_id', patch.categoryId || null);
    const { rows } = await query(
      `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
        WHERE org_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
        RETURNING id, title, assigned_to, priority, due_date, project_id, category_id`,
      params
    );
    for (const t of rows) await logTimeline(t.id, userId(req), 'bulk_task_updated', 'Bulk task fields updated', { patch });
    res.json({ ok: true, requested: ids.length, updated: rows.length, tasks: rows });
  } catch (err) { next(err); }
});

router.post('/:id/restore', requireAnyRole(...MANAGER_ROLES), async (req, res, next) => {
  try {
    await ensureSchema();
    const { rows } = await query(
      `UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, restored_at = NOW(), restored_by = $3, updated_at = NOW()
        WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, orgId(req), userId(req)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    await logTimeline(req.params.id, userId(req), 'task_restored', 'Task restored');
    res.json({ task: rows[0] });
  } catch (err) { next(err); }
});

router.get('/:id/timeline', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT tl.*, u.full_name AS actor_name, u.email AS actor_email
         FROM task_timeline tl
         JOIN tasks t ON t.id = tl.task_id AND t.org_id = $2
         LEFT JOIN users u ON u.id = tl.actor_id
        WHERE tl.task_id = $1
        ORDER BY tl.created_at DESC
        LIMIT $3`,
      [req.params.id, orgId(req), safeLimit(req.query.limit, 100)]
    );
    res.json({ timeline: rows });
  } catch (err) { next(err); }
});

module.exports = router;
