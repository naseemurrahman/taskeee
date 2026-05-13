'use strict';

const logger = require('../utils/logger');
const { query } = require('../utils/db');
let webpush = null;
try { webpush = require('web-push'); } catch { webpush = null; }

function isConfigured() {
  return !!(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

function configureWebPush() {
  if (!isConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || process.env.CLIENT_ORIGIN || 'mailto:admin@taskee.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return true;
}

async function logDelivery(userId, notifType, status, errorMsg = null, notificationId = null) {
  try {
    await query(
      `INSERT INTO notification_delivery_log (user_id, notif_type, channel, status, error_msg, notification_id)
       VALUES ($1, $2, 'push', $3, $4, $5)`,
      [userId, notifType, status, errorMsg, notificationId]
    );
  } catch {}
}

async function deliverBrowserPush(userId, notificationId, notification) {
  if (!isConfigured()) return { sent: 0, failed: 0, skipped: true, reason: 'web_push_not_configured' };
  configureWebPush();
  const { rows } = await query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const payload = JSON.stringify({
    title: notification.title || 'TASKEE notification',
    body: notification.body || '',
    type: notification.type || 'notification',
    data: notification.data || {},
    notificationId,
    url: notification.data?.url || '/app/dashboard',
  });
  let sent = 0;
  let failed = 0;
  for (const sub of rows) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
      sent++;
      await logDelivery(userId, notification.type, 'sent', null, notificationId);
    } catch (err) {
      failed++;
      const code = err?.statusCode || err?.status;
      const msg = String(err?.body || err?.message || 'push failed').slice(0, 500);
      await logDelivery(userId, notification.type, 'failed', msg, notificationId);
      if (code === 404 || code === 410) {
        await query(`UPDATE push_subscriptions SET is_active = FALSE WHERE endpoint = $1`, [sub.endpoint]).catch(() => null);
      }
      logger.warn(`Browser push failed for user ${userId}: ${msg}`);
    }
  }
  return { sent, failed, skipped: false };
}

module.exports = { isConfigured, configureWebPush, deliverBrowserPush };
