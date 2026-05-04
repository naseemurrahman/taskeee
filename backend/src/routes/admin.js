'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { emitNotification } = require('../services/notificationService');
const { sendEmail, sendWhatsApp } = require('../services/notificationChannels');

router.use(authenticate, requireAnyRole('admin', 'director'));

function serviceStatus() {
  const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  return {
    email: {
      configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM),
      missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter((v) => !process.env[v]),
    },
    whatsapp: {
      configured: !!(whatsappToken && process.env.WHATSAPP_PHONE_NUMBER_ID),
      missing: [
        ...(whatsappToken ? [] : ['WHATSAPP_ACCESS_TOKEN']),
        ...(!process.env.WHATSAPP_PHONE_NUMBER_ID ? ['WHATSAPP_PHONE_NUMBER_ID'] : []),
      ],
    },
    stripe: {
      configured: !!process.env.STRIPE_SECRET_KEY,
      missing: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_BASIC', 'STRIPE_PRICE_PRO'].filter((v) => !process.env[v]),
    },
    database: {
      configured: !!process.env.DATABASE_URL,
      missing: ['DATABASE_URL'].filter((v) => !process.env[v]),
    },
    redis: {
      configured: !!process.env.REDIS_URL,
      missing: ['REDIS_URL'].filter((v) => !process.env[v]),
    },
    s3: {
      configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET),
      missing: ['AWS_ACCESS_KEY_ID', 'S3_BUCKET'].filter((v) => !process.env[v]),
    },
  };
}

router.get('/env-status', (_req, res) => {
  const services = serviceStatus();
  const required = ['email', 'whatsapp', 'database', 'redis'];
  const ok = required.every((key) => services[key]?.configured);
  res.json({ ok, services, timestamp: new Date().toISOString() });
});

router.get('/system-health', async (_req, res) => {
  const checks = {
    db: { ok: false, latencyMs: null, error: null },
    redis: { ok: false, configured: !!process.env.REDIS_URL, latencyMs: null, error: null },
  };

  const dbStart = Date.now();
  try {
    await query('SELECT 1');
    checks.db.ok = true;
  } catch (err) {
    checks.db.error = err.message;
  } finally {
    checks.db.latencyMs = Date.now() - dbStart;
  }

  const redisStart = Date.now();
  try {
    const { getRedis } = require('../utils/redis');
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks.redis.ok = true;
    }
  } catch (err) {
    checks.redis.error = err.message;
  } finally {
    checks.redis.latencyMs = Date.now() - redisStart;
  }

  let lastNotificationDelivery = null;
  try {
    const { rows } = await query(
      `SELECT user_id, notif_type, channel, status, error_msg, sent_at
         FROM notification_delivery_log
        ORDER BY sent_at DESC
        LIMIT 1`
    );
    lastNotificationDelivery = rows[0] || null;
  } catch { /* optional table */ }

  res.json({
    ok: checks.db.ok,
    uptime: Math.floor(process.uptime()),
    nodeEnv: process.env.NODE_ENV || 'development',
    services: serviceStatus(),
    checks,
    lastNotificationDelivery,
    timestamp: new Date().toISOString(),
  });
});

router.get('/notification-delivery-log', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const { rows } = await query(
      `SELECT l.id, l.user_id, u.email, u.full_name, l.notif_type, l.channel, l.status, l.error_msg, l.sent_at
         FROM notification_delivery_log l
         LEFT JOIN users u ON u.id = l.user_id
        ORDER BY l.sent_at DESC
        LIMIT $1`,
      [limit]
    );
    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

router.post('/test-notification', async (req, res, next) => {
  try {
    const targetUserId = req.body?.userId || req.user.id;
    const title = String(req.body?.title || 'Test notification');
    const body = String(req.body?.body || 'This is a test notification from the admin diagnostics panel.');

    await emitNotification(targetUserId, {
      type: 'admin_test',
      title,
      body,
      data: { sentBy: req.user.id, source: 'admin_test_notification' },
    });

    res.json({ ok: true, message: 'Test notification queued', userId: targetUserId });
  } catch (err) {
    next(err);
  }
});

router.post('/test-email', async (req, res, next) => {
  try {
    let to = req.body?.to;
    if (!to) {
      const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]);
      to = rows[0]?.email;
    }
    if (!to) return res.status(400).json({ error: 'Recipient email is required' });

    const result = await sendEmail({
      to,
      subject: req.body?.subject || 'TaskFlow test email',
      text: req.body?.text || 'This is a test email from TaskFlow admin diagnostics.',
      html: `<p>${String(req.body?.text || 'This is a test email from TaskFlow admin diagnostics.').replace(/</g, '&lt;')}</p>`,
    });

    res.json({ ok: !result?.skipped, result });
  } catch (err) {
    next(err);
  }
});

router.post('/test-whatsapp', async (req, res, next) => {
  try {
    let toE164 = req.body?.toE164 || req.body?.to;
    if (!toE164) {
      const { rows } = await query('SELECT whatsapp_e164, phone_e164 FROM users WHERE id = $1', [req.user.id]);
      toE164 = rows[0]?.whatsapp_e164 || rows[0]?.phone_e164;
    }
    if (!toE164) return res.status(400).json({ error: 'Recipient WhatsApp number is required' });

    const result = await sendWhatsApp({
      toE164,
      body: req.body?.body || 'This is a test WhatsApp notification from TaskFlow.',
    });

    res.json({ ok: !result?.skipped, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
