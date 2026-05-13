'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { emitNotification } = require('../services/notificationService');
const { logAudit } = require('../services/auditService');

const DECIDERS = ['manager', 'hr', 'director', 'admin'];

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

router.use(authenticate);

router.get('/', requireAnyRole(...DECIDERS), async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const status = String(req.query.status || 'pending').toLowerCase();
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const params = [orgId];
    let where = 'ar.org_id = $1';
    if (status !== 'all') { params.push(status); where += ` AND ar.status = $${params.length}`; }
    params.push(limit);
    const { rows } = await query(
      `SELECT ar.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
         FROM approval_requests ar
         LEFT JOIN users u ON u.id = ar.requested_by
         LEFT JOIN users d ON d.id = ar.decided_by
        WHERE ${where}
        ORDER BY ar.created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ approvals: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const entityType = String(req.body?.entityType || req.body?.entity_type || '').trim().toLowerCase();
    const action = String(req.body?.action || '').trim().toLowerCase();
    if (!entityType || !action) return res.status(400).json({ error: 'entityType and action are required' });
    const entityId = req.body?.entityId || req.body?.entity_id || null;
    if (entityId && !isUuid(entityId)) return res.status(400).json({ error: 'Invalid entity id' });
    const reason = String(req.body?.reason || '').trim();
    const dueAt = req.body?.dueAt || req.body?.due_at || null;

    const { rows } = await query(
      `INSERT INTO approval_requests (org_id, entity_type, entity_id, action, requested_by, reason, due_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING *`,
      [orgId, entityType, entityId, action, req.user.id, reason || null, dueAt, JSON.stringify(req.body?.metadata || {})]
    );

    const { rows: approvers } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND role = ANY($2::text[]) AND COALESCE(is_active, TRUE) = TRUE`,
      [orgId, ['director', 'admin']]
    );
    await Promise.all(approvers.map(a => emitNotification(a.id, { type: 'approval_requested', title: 'Approval requested', body: `${action} · ${entityType}`, data: { approvalId: rows[0].id, entityType, entityId } }).catch(() => null)));
    await logAudit({ orgId, actorUserId: req.user.id, action: 'approval.request', entityType: 'approval_request', entityId: rows[0].id, metadata: { action: rows[0].action, target: entityType, targetId: entityId }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ approval: rows[0] });
  } catch (err) { next(err); }
});

async function decide(req, res, next, status) {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid approval id' });
    const note = String(req.body?.note || req.body?.decision_note || '').trim() || null;
    const { rows } = await query(
      `UPDATE approval_requests
          SET status = $1, decided_by = $2, decision_note = $3, decided_at = NOW()
        WHERE id = $4 AND org_id = $5 AND status = 'pending'
        RETURNING *`,
      [status, req.user.id, note, req.params.id, orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pending approval not found' });
    const approval = rows[0];
    if (approval.requested_by) await emitNotification(approval.requested_by, { type: `approval_${status}`, title: `Approval ${status}`, body: `${approval.action} · ${approval.entity_type}`, data: { approvalId: approval.id } }).catch(() => null);
    await logAudit({ orgId, actorUserId: req.user.id, action: `approval.${status}`, entityType: 'approval_request', entityId: approval.id, metadata: { note, target: approval.entity_type, targetId: approval.entity_id }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ approval });
  } catch (err) { next(err); }
}

router.post('/:id/approve', requireAnyRole(...DECIDERS), (req, res, next) => decide(req, res, next, 'approved'));
router.post('/:id/reject', requireAnyRole(...DECIDERS), (req, res, next) => decide(req, res, next, 'rejected'));

module.exports = router;
