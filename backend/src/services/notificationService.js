// src/services/notificationService.js
const { query } = require('../utils/db');
const logger = require('../utils/logger');
const { sendEmail, sendWhatsApp } = require('./notificationChannels');

const DEDUPE_WINDOW_MINUTES = parseInt(process.env.NOTIFICATION_DEDUPE_WINDOW_MINUTES || '60', 10);

async function getUserContact(userId) {
  try {
    const { rows } = await query(
      `SELECT email, full_name, phone_e164, whatsapp_e164, notification_prefs
       FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

function isNotifEnabled(prefs, type) {
  if (!prefs || typeof prefs !== 'object') return true;
  if (prefs[type] === false) return false;
  return true;
}

function normalizePrefs(rawPrefs) {
  if (!rawPrefs) return {};
  if (typeof rawPrefs === 'object') return rawPrefs;
  try { return JSON.parse(rawPrefs); } catch { return {}; }
}

function normalizeDedupePart(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').slice(0, 96);
}

function buildDedupeKey(type, title, data = {}) {
  if (data && typeof data === 'object') {
    if (data.dedupeKey) return normalizeDedupePart(data.dedupeKey);
    const taskId = data.taskId || data.task_id;
    if (taskId) return `${normalizeDedupePart(type)}:task:${normalizeDedupePart(taskId)}`;
  }
  const t = normalizeDedupePart(type);
  const ttl = normalizeDedupePart(title);
  return t && ttl ? `${t}:title:${ttl}` : null;
}

async function insertOrGroupNotification(userId, { type, title, body, data = {}, dedupeKey }) {
  const key = dedupeKey || buildDedupeKey(type, title, data);

  if (key) {
    try {
      const { rows } = await query(
        `SELECT id, group_count
           FROM notifications
          WHERE user_id = $1
            AND dedupe_key = $2
            AND created_at >= NOW() - ($3::int * INTERVAL '1 minute')
          ORDER BY created_at DESC
          LIMIT 1`,
        [userId, key, DEDUPE_WINDOW_MINUTES]
      );
      const existing = rows[0];
      if (existing?.id) {
        const updated = await query(
          `UPDATE notifications
              SET title = $2,
                  body = $3,
                  data = $4,
                  is_read = CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read'
                  ) THEN FALSE ELSE COALESCE(is_read, FALSE) END,
                  group_count = COALESCE(group_count, 1) + 1,
                  last_grouped_at = NOW(),
                  updated_at = NOW()
            WHERE id = $1
            RETURNING id, group_count`,
          [existing.id, title, body, JSON.stringify({ ...(data || {}), grouped: true })]
        );
        return { id: updated.rows?.[0]?.id || existing.id, grouped: true, groupCount: updated.rows?.[0]?.group_count || existing.group_count + 1, dedupeKey: key };
      }
    } catch (err) {
      logger.warn(`Notification dedupe lookup failed: ${err.message}`);
    }
  }

  try {
    const inserted = await query(
      `INSERT INTO notifications (user_id, type, title, body, data, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, group_count`,
      [userId, type, title, body, JSON.stringify(data), key]
    );
    return { id: inserted.rows?.[0]?.id || null, grouped: false, groupCount: inserted.rows?.[0]?.group_count || 1, dedupeKey: key };
  } catch (err) {
    // Legacy schema fallback if dedupe columns are not present yet.
    const inserted = await query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, type, title, body, JSON.stringify(data)]
    );
    return { id: inserted.rows?.[0]?.id || null, grouped: false, groupCount: 1, dedupeKey: null };
  }
}

async function logDelivery(userId, notifType, channel, status, errorMsg = null, notificationId = null, retryOf = null) {
  try {
    await query(
      `INSERT INTO notification_delivery_log (user_id, notif_type, channel, status, error_msg, notification_id, retry_of)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, notifType, channel, status, errorMsg, notificationId, retryOf]
    );
  } catch {
    try {
      await query(
        `INSERT INTO notification_delivery_log (user_id, notif_type, channel, status, error_msg)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, notifType, channel, status, errorMsg]
      );
    } catch { /* silent */ }
  }
}

async function deliverNotificationChannels(userId, notificationId, { type, title, body }) {
  let emailSent = false;
  let whatsappSent = false;
  const deliveryErrors = [];

  const contact = await getUserContact(userId);
  if (!contact) return { emailSent, whatsappSent, deliveryErrors };

  const prefs = normalizePrefs(contact.notification_prefs);
  const channels = prefs.channels || {};
  const emailEnabled = channels.email !== false;
  const waEnabled = channels.whatsapp !== false;
  const typeEnabled = isNotifEnabled(prefs, type);

  if (!typeEnabled) {
    logger.debug(`Notification suppressed by user pref: ${type} for user ${userId}`);
    return { emailSent, whatsappSent, deliveryErrors };
  }

  const text = `${title}\n${body || ''}`.trim();

  if (emailEnabled && contact.email) {
    const result = await sendEmail({
      to: contact.email,
      subject: `[TaskFlow] ${title}`,
      text,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
          <div style="background:#161920;border-radius:12px;padding:24px">
            <h2 style="color:#e2ab41;margin:0 0 8px">${title}</h2>
            <p style="color:#cbd5e1;margin:0;line-height:1.6">${String(body || '').replace(/\n/g,'<br>')}</p>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center">TaskFlow Pro</p>
        </div>
      `
    }).catch(e => ({ error: e.message }));

    emailSent = !!result?.sent;
    await logDelivery(userId, type, 'email', result?.skipped ? 'skipped' : result?.error ? 'failed' : 'sent', result?.error || null, notificationId);
    if (result?.error) {
      deliveryErrors.push(`email: ${result.error}`);
      logger.warn(`Email failed for ${userId}: ${result.error}`);
    }
  }

  if (waEnabled && (contact.whatsapp_e164 || contact.phone_e164)) {
    const result = await sendWhatsApp({
      toE164: contact.whatsapp_e164 || contact.phone_e164,
      body: text
    }).catch(e => ({ error: e.message }));

    whatsappSent = !!result?.sent;
    await logDelivery(userId, type, 'whatsapp', result?.skipped ? 'skipped' : result?.error ? 'failed' : 'sent', result?.error || null, notificationId);
    if (result?.error) {
      deliveryErrors.push(`whatsapp: ${result.error}`);
      logger.warn(`WhatsApp failed for ${userId}: ${result.error}`);
    }
  }

  return { emailSent, whatsappSent, deliveryErrors };
}

async function emitNotification(userId, { type, title, body, data = {}, dedupeKey = null }) {
  if (!userId) return;

  try {
    const inserted = await insertOrGroupNotification(userId, { type, title, body, data, dedupeKey });
    const notificationId = inserted.id;

    try {
      const { app } = require('../server');
      const io = app.get('io');
      if (io) io.to(`user:${userId}`).emit('notification', {
        id: notificationId,
        type,
        title,
        body,
        data,
        grouped: inserted.grouped,
        group_count: inserted.groupCount,
      });
    } catch { /* optional */ }

    // If this is grouped, do not repeatedly send email/WhatsApp for the same reminder burst.
    if (inserted.grouped) {
      logger.debug(`Notification grouped for user ${userId}: ${type}`);
      return;
    }

    const { emailSent, whatsappSent, deliveryErrors } = await deliverNotificationChannels(userId, notificationId, { type, title, body });

    if (notificationId) {
      try {
        await query(
          `UPDATE notifications
              SET email_sent = COALESCE($2, email_sent),
                  whatsapp_sent = COALESCE($3, whatsapp_sent),
                  delivery_error = NULLIF($4, '')
            WHERE id = $1`,
          [notificationId, emailSent, whatsappSent, deliveryErrors.join('; ')]
        );
      } catch { /* older schemas may not have these columns yet */ }
    }

    logger.debug(`Notification emitted to user ${userId}: ${type}`);
  } catch (err) {
    logger.error(`Failed to send notification to ${userId}:`, err.message);
  }
}

async function retryNotificationDelivery(logId, channel = null) {
  const { rows } = await query(
    `SELECT l.*, n.title, n.body, n.type AS notification_type
       FROM notification_delivery_log l
       LEFT JOIN notifications n ON n.id = l.notification_id
      WHERE l.id = $1
      LIMIT 1`,
    [logId]
  );
  const log = rows[0];
  if (!log) throw new Error('Delivery log not found');

  const selectedChannel = channel || log.channel;
  const contact = await getUserContact(log.user_id);
  if (!contact) throw new Error('User contact not found');

  const title = log.title || log.notif_type || 'TaskFlow notification';
  const body = log.body || '';
  const text = `${title}\n${body}`.trim();
  let result;

  if (selectedChannel === 'email') {
    if (!contact.email) throw new Error('User has no email address');
    result = await sendEmail({ to: contact.email, subject: `[TaskFlow] ${title}`, text, html: `<p>${String(body || title).replace(/</g, '&lt;')}</p>` });
  } else if (selectedChannel === 'whatsapp') {
    const toE164 = contact.whatsapp_e164 || contact.phone_e164;
    if (!toE164) throw new Error('User has no WhatsApp/phone number');
    result = await sendWhatsApp({ toE164, body: text });
  } else {
    throw new Error('Unsupported retry channel');
  }

  await logDelivery(
    log.user_id,
    log.notif_type,
    selectedChannel,
    result?.skipped ? 'skipped' : result?.error ? 'failed' : 'sent',
    result?.error || null,
    log.notification_id || null,
    log.id
  );

  if (result?.error) throw new Error(result.error);
  return result;
}

async function notifyOrgLeaders(orgId, { type, title, body, data = {}, excludeUserId = null }) {
  if (!orgId || !type) return;
  try {
    const { rows } = await query(
      `SELECT id FROM users
       WHERE org_id = $1 AND role IN ('director','admin') AND is_active = TRUE
       LIMIT 30`,
      [orgId]
    );
    for (const r of rows) {
      if (excludeUserId && r.id === excludeUserId) continue;
      await emitNotification(r.id, { type, title, body, data });
    }
  } catch (err) {
    logger.warn(`notifyOrgLeaders failed: ${err.message}`);
  }
}

module.exports = { emitNotification, getUserContact, notifyOrgLeaders, retryNotificationDelivery };
