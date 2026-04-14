// src/services/notificationService.js (backend)
const { query } = require('../utils/db');
const logger = require('../utils/logger');
const { sendEmail, sendWhatsApp } = require('./notificationChannels');

async function getUserContact(userId) {
  try {
    const { rows } = await query(
      `SELECT email, full_name, phone_e164, whatsapp_e164 FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

/**
 * Create a DB notification, WebSocket push, email, and WhatsApp (when configured).
 */
async function emitNotification(userId, { type, title, body, data = {} }) {
  try {
    await query(`
      INSERT INTO notifications (user_id, type, title, body, data)
      VALUES ($1, $2, $3, $4, $5)
    `, [userId, type, title, body, JSON.stringify(data)]);

    try {
      const { app } = require('../server');
      const io = app.get('io');
      if (io) {
        io.to(`user:${userId}`).emit('notification', { type, title, body, data });
      }
    } catch { /* optional */ }

    const contact = await getUserContact(userId);
    const text = `${title}\n${body || ''}`;

    await sendEmail({
      to: contact?.email,
      subject: `[TaskFlow] ${title}`,
      text
    }).catch(e => logger.warn('Email send failed: ' + e.message));

    await sendWhatsApp({
      toE164: contact?.whatsapp_e164 || contact?.phone_e164,
      body: text
    }).catch(e => logger.warn('WhatsApp send failed: ' + e.message));

    logger.debug(`Notification sent to user ${userId}: ${type}`);
  } catch (err) {
    logger.error(`Failed to send notification to ${userId}:`, err.message);
  }
}

/** Notify directors and admins in an org (e.g. project lifecycle). Capped to avoid bursts. */
async function notifyOrgLeaders(orgId, { type, title, body, data = {}, excludeUserId = null }) {
  if (!orgId || !type) return;
  try {
    const { rows } = await query(
      `SELECT id FROM users WHERE org_id = $1 AND role IN ('director','admin') AND is_active = TRUE LIMIT 30`,
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
