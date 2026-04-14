const axios = require('axios');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return null;
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
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
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: text || subject,
    html: html || `<p>${(text || subject).replace(/</g, '')}</p>`
  });
  return { sent: true };
}

/**
 * Meta WhatsApp Cloud API
 * Requires WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 */
async function sendWhatsApp({ toE164, body }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !toE164) {
    logger.debug(`WhatsApp skipped: ${body?.slice(0, 40)}`);
    return { skipped: true };
  }
  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  await axios.post(url, {
    messaging_product: 'whatsapp',
    to: String(toE164).replace(/\D/g, ''),
    type: 'text',
    text: { body: body.slice(0, 4096) }
  }, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return { sent: true };
}

module.exports = { sendEmail, sendWhatsApp };
