const axios = require('axios');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let mailer = null;

function cleanSmtpPassword(value) {
  // Google app passwords are often copied as "xxxx xxxx xxxx xxxx".
  // SMTP auth expects the compact 16-character value.
  return typeof value === 'string' ? value.replace(/\s+/g, '') : value;
}

function getMailer() {
  if (mailer) return mailer;

  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const user = process.env.SMTP_USER;
  const pass = cleanSmtpPassword(process.env.SMTP_PASS);

  if (!host || !from) return null;

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  mailer = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  return mailer;
}

async function sendEmail({ to, subject, text, html }) {
  const t = getMailer();
  if (!t || !to) {
    logger.debug(`Email skipped (no SMTP or no recipient): ${subject}`);
    return { skipped: true };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: text || subject,
    html: html || `<p>${String(text || subject).replace(/</g, '&lt;')}</p>`,
  });

  return { sent: true };
}

/**
 * Meta WhatsApp Cloud API.
 * Supports both the legacy WHATSAPP_TOKEN env name and the current
 * WHATSAPP_ACCESS_TOKEN name used in Railway.
 */
async function sendWhatsApp({ toE164, body }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId || !toE164) {
    logger.debug(`WhatsApp skipped: ${body?.slice(0, 40)}`);
    return { skipped: true };
  }

  const to = String(toE164).replace(/\D/g, '');
  if (!to) {
    logger.debug('WhatsApp skipped: recipient phone number is empty after normalization');
    return { skipped: true };
  }

  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`;

  await axios.post(url, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: String(body || '').slice(0, 4096) },
  }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return { sent: true };
}

module.exports = { sendEmail, sendWhatsApp };
