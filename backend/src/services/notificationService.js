// src/services/notificationService.js
const { query } = require('../utils/db');
const logger = require('../utils/logger');
const { sendEmail, sendWhatsApp } = require('./notificationChannels');

/**
 * Fetch user contact + notification preferences from DB.
 */
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

/**
 * Check if a specific notification type is enabled for a user.
 * Falls back to true (opt-in by default) if prefs are missing.
 */
function isNotifEnabled(prefs, type) {
  if (!prefs || typeof prefs !== 'object') return true;
  if (prefs[type] === false) return false;
  return true;
}

/**
 * Log a delivery attempt to notification_delivery_log.
 * Fails silently — never block the main notification path.
 */
async function logDelivery(userId, notifType, channel, status, errorMsg = null) {
  try {
    await query(
      `INSERT INTO notification_delivery_log (user_id, notif_type, channel, status, error_msg)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, notifType, channel, status, errorMsg]
    );
  } catch { /* silent */ }
}

/**
 * Core notification emitter.
 * 1. Inserts DB notification record
 * 2. Pushes via WebSocket (real-time)
 * 3. Sends email if user has it enabled + SMTP configured
 * 4. Sends WhatsApp if user has it enabled + WHATSAPP_TOKEN configured
 * 5. Logs every delivery attempt
 */
async function emitNotification(userId, { type, title, body, data = {} }) {
  if (!userId) return;
  try {
    // 1. DB record
    await query(`
      INSERT INTO notifications (user_id, type, title, body, data)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, type, title, body, JSON.stringify(data)]);

    // 2. WebSocket push (real-time, non-blocking)
    try {
      const { app } = require('../server');
      const io = app.get('io');
      if (io) io.to(`user:${userId}`).emit('notification', { type, title, body, data });
    } catch { /* optional */ }

    // 3 & 4. Email + WhatsApp (respect user prefs)
    const contact = await getUserContact(userId);
    if (!contact) return;

    const prefs = contact.notification_prefs || {};
    const channels = prefs.channels || {};
    const emailEnabled  = channels.email     !== false; // default true
    const waEnabled     = channels.whatsapp  === true;  // default false (opt-in)
    const typeEnabled   = isNotifEnabled(prefs, type);

    if (!typeEnabled) {
      logger.debug(`Notification suppressed by user pref: ${type} for user ${userId}`);
      return;
    }

    const text = `${title}\n${body || ''}`.trim();

    // Email
    if (emailEnabled && contact.email) {
      const result = await sendEmail({
        to: contact.email,
        subject: `[TaskFlow] ${title}`,
        text,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <div style="background:#161920;border-radius:12px;padding:24px">
              <h2 style="color:#e2ab41;margin:0 0 8px">${title}</h2>
              <p style="color:#cbd5e1;margin:0;line-height:1.6">${(body || '').replace(/\n/g,'<br>')}</p>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-top:16px;text-align:center">
              TaskFlow Pro · <a href="#" style="color:#e2ab41">Manage notifications</a>
            </p>
          </div>
        `
      }).catch(e => ({ error: e.message }));

      await logDelivery(
        userId, type, 'email',
        result?.skipped ? 'skipped' : result?.error ? 'failed' : 'sent',
        result?.error || null
      );
      if (result?.error) logger.warn(`Email failed for ${userId}: ${result.error}`);
    }

    // WhatsApp
    if (waEnabled && (contact.whatsapp_e164 || contact.phone_e164)) {
      const result = await sendWhatsApp({
        toE164: contact.whatsapp_e164 || contact.phone_e164,
        body: text
      }).catch(e => ({ error: e.message }));

      await logDelivery(
        userId, type, 'whatsapp',
        result?.skipped ? 'skipped' : result?.error ? 'failed' : 'sent',
        result?.error || null
      );
      if (result?.error) logger.warn(`WhatsApp failed for ${userId}: ${result.error}`);
    }

    logger.debug(`Notification emitted to user ${userId}: ${type}`);
  } catch (err) {
    logger.error(`Failed to send notification to ${userId}:`, err.message);
  }
}

/** Notify all directors/admins in an org. Capped at 30 to avoid bursts. */
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

module.exports = { emitNotification, getUserContact, notifyOrgLeaders };
