'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');

const ROLES = ['manager', 'hr', 'director', 'admin'];
const TRIGGERS = new Set(['task.created','task.updated','task.overdue','project.completed','employee.offboarded','schedule']);

function safeJson(value, fallback) { return value && typeof value === 'object' ? value : fallback; }

router.use(authenticate, requireAnyRole(...ROLES));

router.get('/rules', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const { rows } = await query(`SELECT * FROM automation_rules WHERE org_id = $1 ORDER BY updated_at DESC NULLS LAST, created_at DESC`, [orgId]);
    res.json({ rules: rows });
  } catch (err) { next(err); }
});

router.post('/rules', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const name = String(req.body?.name || '').trim();
    const trigger = String(req.body?.trigger_type || req.body?.triggerType || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Rule name is required' });
    if (!TRIGGERS.has(trigger)) return res.status(400).json({ error: 'Unsupported trigger_type' });
    const { rows } = await query(
      `INSERT INTO automation_rules (org_id, name, description, trigger_type, conditions, actions, schedule_cron, is_enabled, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$9) RETURNING *`,
      [orgId, name, req.body?.description || null, trigger, JSON.stringify(safeJson(req.body?.conditions, {})), JSON.stringify(Array.isArray(req.body?.actions) ? req.body.actions : []), req.body?.schedule_cron || req.body?.scheduleCron || null, req.body?.is_enabled !== false, req.user.id]
    );
    await logAudit({ orgId, actorUserId: req.user.id, action: 'automation.rule.create', entityType: 'automation_rule', entityId: rows[0].id, metadata: { trigger }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ rule: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/rules/:id', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const sets = [];
    const vals = [];
    function set(col, val) { vals.push(val); sets.push(`${col} = $${vals.length}`); }
    if (typeof req.body?.name === 'string') set('name', req.body.name.trim());
    if (typeof req.body?.description === 'string') set('description', req.body.description.trim() || null);
    if (typeof req.body?.trigger_type === 'string' || typeof req.body?.triggerType === 'string') {
      const trigger = String(req.body.trigger_type || req.body.triggerType).trim();
      if (!TRIGGERS.has(trigger)) return res.status(400).json({ error: 'Unsupported trigger_type' });
      set('trigger_type', trigger);
    }
    if (req.body?.conditions) set('conditions', JSON.stringify(safeJson(req.body.conditions, {})));
    if (req.body?.actions) set('actions', JSON.stringify(Array.isArray(req.body.actions) ? req.body.actions : []));
    if ('schedule_cron' in req.body || 'scheduleCron' in req.body) set('schedule_cron', req.body.schedule_cron || req.body.scheduleCron || null);
    if (typeof req.body?.is_enabled === 'boolean') set('is_enabled', req.body.is_enabled);
    set('updated_by', req.user.id);
    set('updated_at', new Date().toISOString());
    vals.push(orgId, req.params.id);
    const { rows } = await query(`UPDATE automation_rules SET ${sets.join(', ')} WHERE org_id = $${vals.length - 1} AND id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
    await logAudit({ orgId, actorUserId: req.user.id, action: 'automation.rule.update', entityType: 'automation_rule', entityId: rows[0].id, metadata: { enabled: rows[0].is_enabled }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ rule: rows[0] });
  } catch (err) { next(err); }
});

router.get('/executions', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const { rows } = await query(`SELECT ae.*, ar.name AS rule_name FROM automation_executions ae LEFT JOIN automation_rules ar ON ar.id = ae.rule_id WHERE ae.org_id = $1 ORDER BY ae.started_at DESC LIMIT $2`, [orgId, limit]);
    res.json({ executions: rows });
  } catch (err) { next(err); }
});

module.exports = router;
