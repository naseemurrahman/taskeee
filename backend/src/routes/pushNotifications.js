'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { orgIdForSessionUser } = require('../utils/orgContext');
const { logAudit } = require('../services/auditService');

router.use(authenticate);

router.get('/vapid-public-key', (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null, enabled: !!process.env.VAPID_PUBLIC_KEY });
});

router.post('/subscriptions', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const endpoint = String(req.body?.endpoint || '').trim();
    const keys = req.body?.keys || {};
    if (!endpoint || !keys.p256dh || !keys.auth) return res.status(400).json({ error: 'Valid push subscription is required' });
    const { rows } = await query(
      `INSERT INTO push_subscriptions (org_id, user_id, endpoint, p256dh, auth, user_agent, is_active, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW())
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, is_active = TRUE, last_seen_at = NOW()
       RETURNING id, endpoint, is_active, last_seen_at`,
      [orgId, req.user.id, endpoint, keys.p256dh, keys.auth, req.headers['user-agent'] || null]
    );
    await logAudit({ orgId, actorUserId: req.user.id, action: 'push_subscription.upsert', entityType: 'push_subscription', entityId: rows[0].id, metadata: { endpoint }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.status(201).json({ subscription: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/subscriptions', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const endpoint = String(req.body?.endpoint || req.query.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    const { rows } = await query(
      `UPDATE push_subscriptions SET is_active = FALSE WHERE org_id = $1 AND user_id = $2 AND endpoint = $3 RETURNING id`,
      [orgId, req.user.id, endpoint]
    );
    res.json({ disabled: rows.length });
  } catch (err) { next(err); }
});

router.get('/digest-preferences', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const { rows } = await query(
      `SELECT * FROM notification_digest_preferences WHERE org_id = $1 AND user_id = $2`,
      [orgId, req.user.id]
    );
    res.json({ preferences: rows[0] || { frequency: 'daily', delivery_hour: 8, channels: ['in_app'], is_enabled: true } });
  } catch (err) { next(err); }
});

router.put('/digest-preferences', async (req, res, next) => {
  try {
    const orgId = await orgIdForSessionUser(req);
    const frequency = String(req.body?.frequency || 'daily').toLowerCase();
    if (!['off', 'daily', 'weekly'].includes(frequency)) return res.status(400).json({ error: 'Invalid frequency' });
    const deliveryHour = Math.max(0, Math.min(23, parseInt(String(req.body?.delivery_hour ?? req.body?.deliveryHour ?? 8), 10) || 8));
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String).filter(Boolean) : ['in_app'];
    const { rows } = await query(
      `INSERT INTO notification_digest_preferences (org_id, user_id, frequency, delivery_hour, channels, include_overdue, include_due_today, include_mentions, is_enabled, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET frequency = EXCLUDED.frequency, delivery_hour = EXCLUDED.delivery_hour, channels = EXCLUDED.channels,
                     include_overdue = EXCLUDED.include_overdue, include_due_today = EXCLUDED.include_due_today,
                     include_mentions = EXCLUDED.include_mentions, is_enabled = EXCLUDED.is_enabled, updated_at = NOW()
       RETURNING *`,
      [orgId, req.user.id, frequency, deliveryHour, channels, req.body?.include_overdue !== false, req.body?.include_due_today !== false, req.body?.include_mentions !== false, req.body?.is_enabled !== false && frequency !== 'off']
    );
    await logAudit({ orgId, actorUserId: req.user.id, action: 'notification_digest.update_preferences', entityType: 'notification_digest_preferences', entityId: req.user.id, metadata: { frequency, deliveryHour, channels }, ip: req.ip, userAgent: req.headers['user-agent'] || null });
    res.json({ preferences: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
