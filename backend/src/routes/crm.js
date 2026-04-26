const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../utils/db');
const { authenticate, requireAnyRole, isOrgWideRole } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');
const { orgIdForSessionUser } = require('../utils/orgContext');

async function resolveOrgId(req) {
  const orgId = await orgIdForSessionUser(req);
  return orgId != null && orgId !== '' ? String(orgId) : null;
}

function scoreLead(lead) {
  let score = 0;
  if (lead.email) score += 30;
  if (lead.phone_e164) score += 20;
  if (lead.source) score += 15;
  if (lead.status === 'qualified') score += 35;
  return Math.min(100, score);
}

// Pipelines
router.get('/pipelines', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const [pRes, sRes] = await Promise.all([
      query(`SELECT * FROM crm_pipelines WHERE org_id = $1 ORDER BY is_default DESC, created_at ASC`, [orgId]),
      query(`SELECT * FROM crm_pipeline_stages WHERE org_id = $1 ORDER BY position ASC`, [orgId]),
    ]);
    res.json({ pipelines: pRes.rows, stages: sRes.rows });
  } catch (err) { next(err); }
});

router.post('/pipelines/default', authenticate, requireAnyRole('manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const created = await withTransaction(async (client) => {
      const { rows: pRows } = await client.query(
        `INSERT INTO crm_pipelines (org_id, name, is_default) VALUES ($1, 'Sales', TRUE)
         ON CONFLICT (org_id, name) DO UPDATE SET is_default = TRUE
         RETURNING *`,
        [orgId]
      );
      const pipeline = pRows[0];
      await client.query(`UPDATE crm_pipelines SET is_default = FALSE WHERE org_id = $1 AND id <> $2`, [orgId, pipeline.id]);

      const defaults = [
        { name: 'New', position: 1, color: '#f4ca57' },
        { name: 'Qualified', position: 2, color: '#10b981' },
        { name: 'Proposal', position: 3, color: '#60a5fa' },
        { name: 'Negotiation', position: 4, color: '#a78bfa' },
        { name: 'Won', position: 5, color: '#22c55e' },
        { name: 'Lost', position: 6, color: '#ef4444' },
      ];
      for (const st of defaults) {
        await client.query(
          `INSERT INTO crm_pipeline_stages (org_id, pipeline_id, name, position, color)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (pipeline_id, name) DO NOTHING`,
          [orgId, pipeline.id, st.name, st.position, st.color]
        );
      }
      const { rows: stages } = await client.query(
        `SELECT * FROM crm_pipeline_stages WHERE pipeline_id = $1 ORDER BY position ASC`,
        [pipeline.id]
      );
      return { pipeline, stages };
    });

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'crm.pipeline.ensure_default',
      entityType: 'crm_pipeline',
      entityId: created.pipeline.id,
      metadata: { name: created.pipeline.name },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// Leads
router.get('/leads', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { status, search, page = 1, limit = 50 } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 50, 100);
    const offset = ((parseInt(page, 10) || 1) - 1) * safeLimit;

    const params = [orgId];
    const conditions = ['l.org_id = $1'];
    let p = 2;
    if (status) { conditions.push(`l.status = $${p++}`); params.push(String(status)); }
    if (search) {
      conditions.push(`(COALESCE(l.full_name,'') ILIKE $${p} OR COALESCE(l.email,'') ILIKE $${p} OR COALESCE(l.source,'') ILIKE $${p})`);
      params.push(`%${String(search)}%`);
      p++;
    }

    if (!isOrgWideRole(req.user.role)) {
      conditions.push(`(l.owner_user_id = $${p++} OR l.owner_user_id IS NULL)`);
      params.push(req.user.id);
    }

    const { rows } = await query(
      `SELECT l.*, a.name AS account_name, u.full_name AS owner_name, COUNT(*) OVER() AS total_count
       FROM crm_leads l
       LEFT JOIN crm_accounts a ON a.id = l.account_id
       LEFT JOIN users u ON u.id = l.owner_user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.updated_at DESC
       LIMIT $${p++} OFFSET $${p++}`,
      [...params, safeLimit, offset]
    );
    res.json({ leads: rows, total: parseInt(rows[0]?.total_count || 0, 10) });
  } catch (err) { next(err); }
});

router.post('/leads', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const fullName = String(req.body?.fullName || '').trim() || null;
    const email = String(req.body?.email || '').trim() || null;
    const phoneE164 = String(req.body?.phoneE164 || '').trim() || null;
    const source = String(req.body?.source || '').trim() || null;
    const ownerUserId = req.body?.ownerUserId || req.user.id;

    const { rows } = await query(
      `INSERT INTO crm_leads (org_id, owner_user_id, full_name, email, phone_e164, source)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [orgId, ownerUserId, fullName, email, phoneE164, source]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'crm.lead.create',
      entityType: 'crm_lead',
      entityId: rows[0].id,
      metadata: { fullName, email, source },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    const lead = rows[0];
    const leadScore = scoreLead(lead);
    await query(`UPDATE crm_leads SET lead_score = $1 WHERE id = $2`, [leadScore, lead.id]);
    res.status(201).json({ lead: { ...lead, lead_score: leadScore } });
  } catch (err) { next(err); }
});

router.post('/leads/:id/convert', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const leadId = req.params.id;
    const converted = await withTransaction(async (client) => {
      const { rows: leadRows } = await client.query(`SELECT * FROM crm_leads WHERE id = $1 AND org_id = $2 FOR UPDATE`, [leadId, orgId]);
      if (!leadRows.length) return null;
      const lead = leadRows[0];
      if (lead.converted_deal_id) return { already: true, dealId: lead.converted_deal_id };

      const { rows: pipelineRows } = await client.query(`SELECT id FROM crm_pipelines WHERE org_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`, [orgId]);
      if (!pipelineRows.length) throw new Error('No pipeline configured');
      const pipelineId = pipelineRows[0].id;
      const { rows: stageRows } = await client.query(`SELECT id FROM crm_pipeline_stages WHERE pipeline_id = $1 ORDER BY position ASC LIMIT 1`, [pipelineId]);
      const stageId = stageRows[0]?.id;
      if (!stageId) throw new Error('No pipeline stage configured');

      const { rows: dealRows } = await client.query(
        `INSERT INTO crm_deals (org_id, pipeline_id, stage_id, owner_user_id, title, value_currency)
         VALUES ($1,$2,$3,$4,$5,'USD') RETURNING *`,
        [orgId, pipelineId, stageId, lead.owner_user_id || req.user.id, lead.full_name || lead.email || 'Converted lead']
      );
      const deal = dealRows[0];
      await client.query(
        `UPDATE crm_leads
         SET status = 'converted', converted_at = NOW(), converted_deal_id = $1, lead_score = COALESCE(lead_score, $2)
         WHERE id = $3`,
        [deal.id, scoreLead(lead), leadId]
      );
      return { already: false, deal };
    });
    if (!converted) return res.status(404).json({ error: 'Lead not found' });
    return res.json(converted);
  } catch (err) { next(err); }
});

// Deals
router.get('/deals', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { pipelineId } = req.query;
    const params = [orgId];
    const conditions = ['d.org_id = $1'];
    let p = 2;
    if (pipelineId) { conditions.push(`d.pipeline_id = $${p++}`); params.push(pipelineId); }
    if (!isOrgWideRole(req.user.role)) {
      conditions.push(`(d.owner_user_id = $${p++} OR d.owner_user_id IS NULL)`);
      params.push(req.user.id);
    }
    const { rows } = await query(
      `SELECT d.*, a.name AS account_name, u.full_name AS owner_name, s.name AS stage_name, s.position AS stage_position, s.color AS stage_color
       FROM crm_deals d
       LEFT JOIN crm_accounts a ON a.id = d.account_id
       LEFT JOIN users u ON u.id = d.owner_user_id
       LEFT JOIN crm_pipeline_stages s ON s.id = d.stage_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.updated_at DESC
       LIMIT 400`,
      params
    );
    res.json({ deals: rows });
  } catch (err) { next(err); }
});

router.post('/deals', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const pipelineId = req.body?.pipelineId;
    const stageId = req.body?.stageId;
    const title = String(req.body?.title || '').trim();
    const valueAmount = req.body?.valueAmount != null ? Number(req.body.valueAmount) : null;
    const valueCurrency = String(req.body?.valueCurrency || 'USD').trim() || 'USD';
    const ownerUserId = req.body?.ownerUserId || req.user.id;

    if (!pipelineId || !stageId) return res.status(400).json({ error: 'pipelineId and stageId are required' });
    if (!title || title.length < 2) return res.status(400).json({ error: 'title is required' });

    const { rows } = await query(
      `INSERT INTO crm_deals (org_id, pipeline_id, stage_id, owner_user_id, title, value_amount, value_currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [orgId, pipelineId, stageId, ownerUserId, title, valueAmount, valueCurrency]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'crm.deal.create',
      entityType: 'crm_deal',
      entityId: rows[0].id,
      metadata: { title, valueAmount, valueCurrency },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.status(201).json({ deal: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/deals/:id/stage', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const id = req.params.id;
    const stageId = req.body?.stageId;
    if (!stageId) return res.status(400).json({ error: 'stageId is required' });

    const { rows } = await query(
      `UPDATE crm_deals
       SET stage_id = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3
       RETURNING *`,
      [stageId, id, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Deal not found' });

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'crm.deal.move_stage',
      entityType: 'crm_deal',
      entityId: id,
      metadata: { stageId },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.json({ deal: rows[0] });
  } catch (err) { next(err); }
});

// Activities
router.get('/activities', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const { entityType, entityId } = req.query;
    if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId are required' });
    const { rows } = await query(
      `SELECT a.*, u.full_name AS actor_name
       FROM crm_activities a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.org_id = $1 AND a.entity_type = $2 AND a.entity_id = $3
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [orgId, String(entityType), entityId]
    );
    res.json({ activities: rows });
  } catch (err) { next(err); }
});

router.post('/activities', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await resolveOrgId(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const entityType = String(req.body?.entityType || '').trim();
    const entityId = req.body?.entityId;
    const activityType = String(req.body?.activityType || '').trim();
    const body = String(req.body?.body || '').trim() || null;
    if (!entityType || !entityId || !activityType) return res.status(400).json({ error: 'entityType, entityId, activityType required' });

    const { rows } = await query(
      `INSERT INTO crm_activities (org_id, actor_user_id, entity_type, entity_id, activity_type, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [orgId, req.user.id, entityType, entityId, activityType, body]
    );

    await logAudit({
      orgId,
      actorUserId: req.user.id,
      action: 'crm.activity.create',
      entityType: 'crm_activity',
      entityId: rows[0].id,
      metadata: { entityType, entityId, activityType },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null
    });

    res.status(201).json({ activity: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;

