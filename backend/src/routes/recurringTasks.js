const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logUserActivity } = require('../services/activityService');
const { emitNotification } = require('../services/notificationService');

let initialized = false;
let taskColumnsCache = null;

async function ensureRecurringTable() {
  if (initialized) return;
  await query(`
    CREATE TABLE IF NOT EXISTS recurring_task_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      template_id UUID NOT NULL,
      assigned_to UUID NOT NULL,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'weekly',
      interval_count INTEGER NOT NULL DEFAULT 1,
      start_date DATE NOT NULL DEFAULT CURRENT_DATE,
      next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      end_date DATE NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_generated_at TIMESTAMPTZ NULL,
      generated_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by UUID NULL,
      updated_by UUID NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_recurring_task_rules_org_next ON recurring_task_rules(org_id, is_active, next_run_at)`);
  initialized = true;
}

async function getTaskColumns() {
  if (taskColumnsCache) return taskColumnsCache;
  const { rows } = await query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks'`);
  taskColumnsCache = new Set(rows.map(r => String(r.column_name)));
  return taskColumnsCache;
}

function parseChecklist(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((item, index) => {
    if (typeof item === 'string') return { title: item.trim(), order: index + 1 };
    return { title: String(item?.title || '').trim(), order: Number(item?.order || index + 1) || index + 1 };
  }).filter(item => item.title.length > 0).slice(0, 50);
}

function validateFrequency(value) {
  const f = String(value || 'weekly').toLowerCase().trim();
  return ['daily', 'weekly', 'monthly'].includes(f) ? f : 'weekly';
}

function validatePriority(priority) {
  const p = String(priority || 'medium').trim().toLowerCase();
  return ['low', 'medium', 'high', 'critical'].includes(p) ? p : 'medium';
}

function safeInterval(value) {
  const n = Number.parseInt(String(value || '1'), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 24) return 24;
  return n;
}

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function combineDateStart(dateOnly) {
  const d = toDateOnly(dateOnly) || new Date().toISOString().slice(0, 10);
  return new Date(`${d}T08:00:00.000Z`);
}

function addInterval(date, frequency, intervalCount) {
  const d = new Date(date);
  if (frequency === 'daily') d.setUTCDate(d.getUTCDate() + intervalCount);
  else if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + intervalCount);
  else d.setUTCDate(d.getUTCDate() + (7 * intervalCount));
  return d;
}

function dueDateFromDays(days, baseDate) {
  if (days === null || days === undefined || days === '') return null;
  const n = Number.parseInt(String(days), 10);
  if (!Number.isFinite(n)) return null;
  const d = new Date(baseDate || Date.now());
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.min(365, n)));
  return d.toISOString().slice(0, 10);
}

function nextRunFromRule(rule, fromDate) {
  return addInterval(fromDate || rule.next_run_at || new Date(), rule.frequency, Number(rule.interval_count || 1));
}

async function loadTemplate(orgId, templateId) {
  const { rows } = await query(`SELECT * FROM task_templates WHERE org_id = $1 AND id = $2`, [orgId, templateId]);
  return rows[0] || null;
}

async function createTaskFromRule(client, orgId, rule, template, actorId, runDate) {
  const taskCols = await getTaskColumns();
  const checklist = parseChecklist(template.checklist_items);
  const priority = validatePriority(template.priority);
  const title = String(template.task_title || template.name || rule.name).trim();
  const description = String(template.task_description || '').trim() || null;
  const dueDate = dueDateFromDays(template.default_due_days, runDate);
  const categoryId = template.category_id || null;

  const cols = ['org_id', 'title', 'status', 'priority', 'assigned_by', 'assigned_to'];
  const vals = [orgId, title, 'pending', priority, actorId || rule.created_by, rule.assigned_to];
  if (taskCols.has('description')) { cols.push('description'); vals.push(description); }
  if (taskCols.has('due_date')) { cols.push('due_date'); vals.push(dueDate); }
  if (taskCols.has('category_id')) { cols.push('category_id'); vals.push(categoryId); }
  if (taskCols.has('metadata')) {
    cols.push('metadata');
    vals.push(JSON.stringify({ recurring_rule_id: rule.id, template_id: template.id, template_name: template.name, generated_at: new Date().toISOString(), checklist }));
  }

  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${ph}) RETURNING *`, vals);
  const parent = rows[0];

  if (checklist.length && taskCols.has('parent_task_id')) {
    for (const item of checklist) {
      const subCols = ['org_id', 'title', 'status', 'priority', 'assigned_by', 'assigned_to', 'parent_task_id'];
      const subVals = [orgId, item.title, 'pending', priority, actorId || rule.created_by, rule.assigned_to, parent.id];
      if (taskCols.has('description')) { subCols.push('description'); subVals.push(`Recurring checklist item from ${template.name}`); }
      if (taskCols.has('due_date')) { subCols.push('due_date'); subVals.push(dueDate); }
      if (taskCols.has('category_id')) { subCols.push('category_id'); subVals.push(categoryId); }
      if (taskCols.has('metadata')) { subCols.push('metadata'); subVals.push(JSON.stringify({ recurring_rule_id: rule.id, template_id: template.id, checklist_item: true, checklist_order: item.order })); }
      const subPh = subVals.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(`INSERT INTO tasks (${subCols.join(', ')}) VALUES (${subPh})`, subVals);
    }
  }

  try {
    await client.query(
      `INSERT INTO task_timeline (task_id, actor_id, actor_type, event_type, note, metadata)
       VALUES ($1,$2,'system','recurring_task_generated',$3,$4)`,
      [parent.id, actorId || rule.created_by, `Generated from recurring rule ${rule.name}`, JSON.stringify({ ruleId: rule.id, templateId: template.id, checklistCount: checklist.length })]
    );
  } catch (_) {}

  return { task: parent, checklistCreated: taskCols.has('parent_task_id') ? checklist.length : 0 };
}

async function generateDueRules(orgId, actorId, onlyRuleId = null) {
  await ensureRecurringTable();
  const params = [orgId];
  let extra = '';
  if (onlyRuleId) { params.push(onlyRuleId); extra = ` AND r.id = $${params.length}`; }
  const { rows: rules } = await query(
    `SELECT r.*, tt.name AS template_name
       FROM recurring_task_rules r
       JOIN task_templates tt ON tt.id = r.template_id AND tt.org_id = r.org_id
      WHERE r.org_id = $1 AND r.is_active = TRUE AND r.next_run_at <= NOW()
        AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
        ${extra}
      ORDER BY r.next_run_at ASC
      LIMIT 50`,
    params
  );

  const generated = [];
  for (const rule of rules) {
    const template = await loadTemplate(orgId, rule.template_id);
    if (!template) continue;
    const runDate = new Date(rule.next_run_at || Date.now());
    const nextRun = nextRunFromRule(rule, runDate);
    const result = await withTransaction(async (client) => {
      const created = await createTaskFromRule(client, orgId, rule, template, actorId, runDate);
      await client.query(
        `UPDATE recurring_task_rules
            SET last_generated_at = NOW(), generated_count = generated_count + 1,
                next_run_at = $1, updated_at = NOW(), updated_by = $2
          WHERE org_id = $3 AND id = $4`,
        [nextRun.toISOString(), actorId || rule.created_by, orgId, rule.id]
      );
      return created;
    });
    generated.push({ ruleId: rule.id, taskId: result.task.id, checklistCreated: result.checklistCreated, nextRunAt: nextRun.toISOString() });
    emitNotification(rule.assigned_to, { type: 'task_assigned', title: 'Recurring task generated', body: result.task.title, data: { taskId: result.task.id, recurringRuleId: rule.id } }).catch(() => null);
    await logUserActivity({ orgId, userId: actorId || rule.created_by, taskId: result.task.id, activityType: 'recurring_task_generated', metadata: { ruleId: rule.id, templateId: template.id } }).catch(() => null);
  }
  return generated;
}

router.get('/', authenticate, async (req, res, next) => {
  try {
    await ensureRecurringTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(
      `SELECT r.*, tt.name AS template_name, tt.task_title, u.full_name AS assignee_name, u.email AS assignee_email
         FROM recurring_task_rules r
         LEFT JOIN task_templates tt ON tt.id = r.template_id AND tt.org_id = r.org_id
         LEFT JOIN users u ON u.id = r.assigned_to
        WHERE r.org_id = $1
        ORDER BY r.is_active DESC, r.next_run_at ASC, r.created_at DESC`,
      [orgId]
    );
    res.json({ rules: rows });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureRecurringTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const templateId = String(req.body?.templateId || req.body?.template_id || '').trim();
    const assignedTo = String(req.body?.assignedTo || req.body?.assigned_to || '').trim();
    const template = templateId ? await loadTemplate(orgId, templateId) : null;
    if (!template) return res.status(400).json({ error: 'Select a valid task template' });
    if (!assignedTo) return res.status(400).json({ error: 'Select an assignee' });

    const name = String(req.body?.name || template.name || 'Recurring task').trim();
    const frequency = validateFrequency(req.body?.frequency);
    const intervalCount = safeInterval(req.body?.intervalCount || req.body?.interval_count);
    const startDate = toDateOnly(req.body?.startDate || req.body?.start_date) || new Date().toISOString().slice(0, 10);
    const nextRunAt = combineDateStart(startDate);
    const endDate = toDateOnly(req.body?.endDate || req.body?.end_date);

    const { rows } = await query(
      `INSERT INTO recurring_task_rules (
         org_id, template_id, assigned_to, name, frequency, interval_count,
         start_date, next_run_at, end_date, metadata, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [orgId, templateId, assignedTo, name, frequency, intervalCount, startDate, nextRunAt.toISOString(), endDate, JSON.stringify({ version: 1 }), req.user.id]
    );
    await logUserActivity({ orgId, userId: req.user.id, activityType: 'recurring_rule_created', metadata: { ruleId: rows[0].id, templateId } }).catch(() => null);
    res.status(201).json({ rule: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureRecurringTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });

    const { rows: existingRows } = await query(`SELECT * FROM recurring_task_rules WHERE org_id = $1 AND id = $2`, [orgId, req.params.id]);
    if (!existingRows.length) return res.status(404).json({ error: 'Recurring rule not found' });
    const existing = existingRows[0];

    const name = req.body?.name !== undefined ? String(req.body.name || '').trim() : existing.name;
    const frequency = req.body?.frequency !== undefined ? validateFrequency(req.body.frequency) : existing.frequency;
    const intervalCount = req.body?.intervalCount !== undefined || req.body?.interval_count !== undefined ? safeInterval(req.body.intervalCount || req.body.interval_count) : existing.interval_count;
    const startDate = req.body?.startDate !== undefined || req.body?.start_date !== undefined ? (toDateOnly(req.body.startDate || req.body.start_date) || existing.start_date) : existing.start_date;
    const endDate = req.body?.endDate !== undefined || req.body?.end_date !== undefined ? toDateOnly(req.body.endDate || req.body.end_date) : existing.end_date;
    const isActive = req.body?.isActive !== undefined ? !!req.body.isActive : (req.body?.is_active !== undefined ? !!req.body.is_active : existing.is_active);
    const nextRunAt = req.body?.nextRunAt || req.body?.next_run_at ? new Date(req.body.nextRunAt || req.body.next_run_at) : new Date(existing.next_run_at);
    if (!name || name.length < 2) return res.status(400).json({ error: 'Rule name must be at least 2 characters' });

    const { rows } = await query(
      `UPDATE recurring_task_rules
          SET name=$1, frequency=$2, interval_count=$3, start_date=$4, end_date=$5,
              is_active=$6, next_run_at=$7, updated_by=$8, updated_at=NOW()
        WHERE org_id=$9 AND id=$10
        RETURNING *`,
      [name, frequency, intervalCount, startDate, endDate, isActive, Number.isNaN(nextRunAt.getTime()) ? existing.next_run_at : nextRunAt.toISOString(), req.user.id, orgId, req.params.id]
    );
    await logUserActivity({ orgId, userId: req.user.id, activityType: 'recurring_rule_updated', metadata: { ruleId: req.params.id } }).catch(() => null);
    res.json({ rule: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    await ensureRecurringTable();
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { rows } = await query(`DELETE FROM recurring_task_rules WHERE org_id=$1 AND id=$2 RETURNING id, name`, [orgId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Recurring rule not found' });
    await logUserActivity({ orgId, userId: req.user.id, activityType: 'recurring_rule_deleted', metadata: { ruleId: rows[0].id, name: rows[0].name } }).catch(() => null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/generate-due', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const generated = await generateDueRules(orgId, req.user.id, req.body?.ruleId || req.body?.rule_id || null);
    res.json({ generated, count: generated.length });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.generateDueRules = generateDueRules;
