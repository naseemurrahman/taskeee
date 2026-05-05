'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { emitNotification, retryNotificationDelivery } = require('../services/notificationService');
const { sendEmail, sendWhatsApp } = require('../services/notificationChannels');
const { logAuditEvent, ensureAuditSchema } = require('../services/auditService');

router.use(authenticate, requireAnyRole('admin', 'director'));

function serviceStatus() {
  const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  return {
    email: { configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM), missing: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter((v) => !process.env[v]) },
    whatsapp: { configured: !!(whatsappToken && process.env.WHATSAPP_PHONE_NUMBER_ID), missing: [...(whatsappToken ? [] : ['WHATSAPP_ACCESS_TOKEN']), ...(!process.env.WHATSAPP_PHONE_NUMBER_ID ? ['WHATSAPP_PHONE_NUMBER_ID'] : [])] },
    stripe: { configured: !!process.env.STRIPE_SECRET_KEY, missing: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_BASIC', 'STRIPE_PRICE_PRO'].filter((v) => !process.env[v]) },
    database: { configured: !!process.env.DATABASE_URL, missing: ['DATABASE_URL'].filter((v) => !process.env[v]) },
    redis: { configured: !!process.env.REDIS_URL, missing: ['REDIS_URL'].filter((v) => !process.env[v]) },
    s3: { configured: !!(process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET), missing: ['AWS_ACCESS_KEY_ID', 'S3_BUCKET'].filter((v) => !process.env[v]) },
    security: { configured: !!(process.env.JWT_SECRET && process.env.JWT_REFRESH_SECRET && process.env.MFA_ENCRYPTION_KEY), missing: ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MFA_ENCRYPTION_KEY'].filter((v) => !process.env[v]) },
  };
}

function csvEscape(value) {
  if (value == null) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sendCsv(res, filename, rows) {
  const keys = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => csvEscape(r[k])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
function orgId(req) { return req.user.org_id || req.user.orgId; }

router.get('/env-status', (_req, res) => {
  const services = serviceStatus();
  const required = ['email', 'whatsapp', 'database', 'redis', 'security'];
  const ok = required.every((key) => services[key]?.configured);
  const checklist = [
    { key: 'database', label: 'Database URL configured', ok: services.database.configured, severity: 'critical' },
    { key: 'redis', label: 'Redis URL configured', ok: services.redis.configured, severity: 'high' },
    { key: 'security', label: 'JWT + MFA secrets configured', ok: services.security.configured, severity: 'critical' },
    { key: 'email', label: 'SMTP email configured', ok: services.email.configured, severity: 'high' },
    { key: 'whatsapp', label: 'WhatsApp Cloud API configured', ok: services.whatsapp.configured, severity: 'medium' },
    { key: 's3', label: 'S3/object storage configured', ok: services.s3.configured, severity: 'medium' },
  ];
  res.json({ ok, services, checklist, timestamp: new Date().toISOString() });
});

router.get('/system-health', async (_req, res) => {
  const checks = { db: { ok: false, latencyMs: null, error: null }, redis: { ok: false, configured: !!process.env.REDIS_URL, latencyMs: null, error: null } };
  const dbStart = Date.now();
  try { await query('SELECT 1'); checks.db.ok = true; } catch (err) { checks.db.error = err.message; } finally { checks.db.latencyMs = Date.now() - dbStart; }
  const redisStart = Date.now();
  try { const { getRedis } = require('../utils/redis'); const redis = getRedis(); if (redis) { await redis.ping(); checks.redis.ok = true; } } catch (err) { checks.redis.error = err.message; } finally { checks.redis.latencyMs = Date.now() - redisStart; }
  let lastNotificationDelivery = null;
  try { const { rows } = await query(`SELECT user_id, notif_type, channel, status, error_msg, sent_at FROM notification_delivery_log ORDER BY sent_at DESC LIMIT 1`); lastNotificationDelivery = rows[0] || null; } catch {}
  res.json({ ok: checks.db.ok, uptime: Math.floor(process.uptime()), nodeEnv: process.env.NODE_ENV || 'development', services: serviceStatus(), checks, lastNotificationDelivery, timestamp: new Date().toISOString() });
});

router.post('/health/run-checks', async (req, res) => {
  const started = Date.now();
  const results = [];
  async function check(name, fn) {
    const s = Date.now();
    try { const details = await fn(); results.push({ name, ok: true, latencyMs: Date.now() - s, details }); }
    catch (err) { results.push({ name, ok: false, latencyMs: Date.now() - s, error: err.message }); }
  }
  await check('database', async () => { await query('SELECT 1'); return 'connected'; });
  await check('audit_schema', async () => { await ensureAuditSchema(); return 'ready'; });
  await check('notification_log', async () => { await query(`SELECT COUNT(*)::int AS count FROM notification_delivery_log`); return 'ready'; });
  await check('redis', async () => { const { getRedis } = require('../utils/redis'); const r = getRedis(); if (!r) throw new Error('Redis client unavailable'); await r.ping(); return 'connected'; });
  await logAuditEvent({ req, action: 'admin_health_checks_run', entityType: 'admin_ops', metadata: { results } });
  res.json({ ok: results.every((r) => r.ok), durationMs: Date.now() - started, results, timestamp: new Date().toISOString() });
});

router.get('/readiness-checklist', (_req, res) => {
  const services = serviceStatus();
  const items = [
    { area: 'Security', item: 'JWT_SECRET configured', ok: !services.security.missing.includes('JWT_SECRET'), required: true },
    { area: 'Security', item: 'JWT_REFRESH_SECRET configured', ok: !services.security.missing.includes('JWT_REFRESH_SECRET'), required: true },
    { area: 'Security', item: 'MFA_ENCRYPTION_KEY configured', ok: !services.security.missing.includes('MFA_ENCRYPTION_KEY'), required: true },
    { area: 'Database', item: 'DATABASE_URL configured', ok: services.database.configured, required: true },
    { area: 'Cache', item: 'REDIS_URL configured', ok: services.redis.configured, required: true },
    { area: 'Email', item: 'SMTP configured', ok: services.email.configured, required: true },
    { area: 'WhatsApp', item: 'WhatsApp credentials configured', ok: services.whatsapp.configured, required: false },
    { area: 'Storage', item: 'S3/avatar storage configured', ok: services.s3.configured, required: false },
    { area: 'Billing', item: 'Stripe configured', ok: services.stripe.configured, required: false },
  ];
  res.json({ ok: items.filter((i) => i.required).every((i) => i.ok), items, timestamp: new Date().toISOString() });
});

router.get('/backup-validation', async (req, res) => {
  const tables = ['users', 'tasks', 'notifications', 'audit_logs', 'notification_delivery_log', 'organizations'];
  const result = { ok: true, tables: [], timestamp: new Date().toISOString() };
  for (const table of tables) {
    try {
      const { rows } = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
      result.tables.push({ table, ok: true, rowCount: rows[0]?.count ?? 0 });
    } catch (err) {
      result.ok = false; result.tables.push({ table, ok: false, error: err.message });
    }
  }
  try { await query('SELECT 1'); result.restoreDrill = { ok: true, note: 'DB read test passed. Full restore requires Railway backup restore outside app runtime.' }; }
  catch (err) { result.ok = false; result.restoreDrill = { ok: false, error: err.message }; }
  await logAuditEvent({ req, action: 'backup_validation_run', entityType: 'backup', metadata: result });
  res.json(result);
});

router.get('/exports/:kind.csv', async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    const oid = orgId(req);
    let rows;
    if (kind === 'tasks') {
      ({ rows } = await query(`SELECT id, title, status, priority, assigned_to, due_date, created_at, updated_at FROM tasks WHERE org_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 5000`, [oid]));
    } else if (kind === 'users') {
      ({ rows } = await query(`SELECT id, email, full_name, role, department, is_active, created_at, last_login_at FROM users WHERE org_id = $1 ORDER BY created_at DESC LIMIT 5000`, [oid]));
    } else if (kind === 'audit') {
      await ensureAuditSchema();
      ({ rows } = await query(`SELECT id, actor_user_id, action, entity_type, entity_id, metadata, ip::text AS ip, created_at FROM audit_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 5000`, [oid]));
    } else {
      return res.status(400).json({ error: 'Unsupported export kind' });
    }
    await logAuditEvent({ req, action: `export_${kind}_csv`, entityType: 'export', metadata: { rowCount: rows.length } });
    sendCsv(res, `${kind}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  } catch (err) { next(err); }
});

router.get('/notification-delivery-log', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const status = String(req.query.status || '').trim();
    const channel = String(req.query.channel || '').trim();
    const params = [];
    const where = [];
    if (status) { params.push(status); where.push(`l.status = $${params.length}`); }
    if (channel) { params.push(channel); where.push(`l.channel = $${params.length}`); }
    params.push(limit);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await query(`SELECT l.id, l.notification_id, l.retry_of, l.user_id, u.email, u.full_name, l.notif_type, l.channel, l.status, l.error_msg, l.sent_at FROM notification_delivery_log l LEFT JOIN users u ON u.id = l.user_id ${whereSql} ORDER BY l.sent_at DESC LIMIT $${params.length}`, params);
    res.json({ rows });
  } catch (err) { next(err); }
});

router.post('/notification-delivery-log/:id/retry', async (req, res) => {
  try {
    const result = await retryNotificationDelivery(req.params.id, req.body?.channel || null);
    await logAuditEvent({ req, action: 'notification_delivery_retry', entityType: 'notification_delivery_log', entityId: req.params.id, metadata: { channel: req.body?.channel || null } });
    res.json({ ok: true, result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message || 'Retry failed' }); }
});

router.post('/test-notification', async (req, res, next) => {
  try {
    const targetUserId = req.body?.userId || req.user.id;
    const title = String(req.body?.title || 'Test notification');
    const body = String(req.body?.body || 'This is a test notification from the admin diagnostics panel.');
    await emitNotification(targetUserId, { type: 'admin_test', title, body, data: { sentBy: req.user.id, source: 'admin_test_notification', dedupeKey: `admin_test:${targetUserId}` } });
    await logAuditEvent({ req, action: 'admin_test_notification_sent', entityType: 'notification', entityId: targetUserId, metadata: { title } });
    res.json({ ok: true, message: 'Test notification queued', userId: targetUserId });
  } catch (err) { next(err); }
});

router.post('/test-email', async (req, res, next) => {
  try {
    let to = req.body?.to;
    if (!to) { const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]); to = rows[0]?.email; }
    if (!to) return res.status(400).json({ error: 'Recipient email is required' });
    const result = await sendEmail({ to, subject: req.body?.subject || 'TaskFlow test email', text: req.body?.text || 'This is a test email from TaskFlow admin diagnostics.', html: `<p>${String(req.body?.text || 'This is a test email from TaskFlow admin diagnostics.').replace(/</g, '&lt;')}</p>` });
    await logAuditEvent({ req, action: 'admin_test_email_sent', entityType: 'email', metadata: { to, result } });
    res.json({ ok: !result?.skipped, result });
  } catch (err) { next(err); }
});

router.post('/test-whatsapp', async (req, res, next) => {
  try {
    let toE164 = req.body?.toE164 || req.body?.to;
    if (!toE164) { const { rows } = await query('SELECT whatsapp_e164, phone_e164 FROM users WHERE id = $1', [req.user.id]); toE164 = rows[0]?.whatsapp_e164 || rows[0]?.phone_e164; }
    if (!toE164) return res.status(400).json({ error: 'Recipient WhatsApp number is required' });
    const result = await sendWhatsApp({ toE164, body: req.body?.body || 'This is a test WhatsApp notification from TaskFlow.' });
    await logAuditEvent({ req, action: 'admin_test_whatsapp_sent', entityType: 'whatsapp', metadata: { toE164: String(toE164).replace(/\d(?=\d{4})/g, '*'), result } });
    res.json({ ok: !result?.skipped, result });
  } catch (err) { next(err); }
});

module.exports = router;
