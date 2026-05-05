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

function normalizeWhatsAppTo(toE164) {
  const to = String(toE164 || '').replace(/\D/g, '');
  return to || null;
}

function getWhatsAppTemplateName(type) {
  const key = String(type || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (!key) return null;
  return process.env[`WHATSAPP_TEMPLATE_${key}`] || null;
}

function buildTemplateComponents({ title, body, parameters }) {
  const values = Array.isArray(parameters) && parameters.length
    ? parameters
    : [title, body].filter(Boolean);

  if (!values.length) return undefined;

  return [{
    type: 'body',
    parameters: values.slice(0, 10).map((value) => ({
      type: 'text',
      text: String(value || '').slice(0, 1024),
    })),
  }];
}

async function postWhatsAppMessage(payload) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) return { skipped: true };

  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';
  const url = `https://graph.facebook.com/${graphVersion}/${phoneId}/messages`;

  const { data } = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return { sent: true, provider: data };
}

/**
 * Meta WhatsApp Cloud API.
 *
 * Production supports approved templates by setting env vars such as:
 *   WHATSAPP_USE_TEMPLATES=true
 *   WHATSAPP_TEMPLATE_LANGUAGE=en_US
 *   WHATSAPP_TEMPLATE_TASK_ASSIGNED=task_assigned
 *   WHATSAPP_TEMPLATE_TASK_OVERDUE=task_overdue
 *
 * If no matching template is configured, it falls back to text messages for
 * testing/diagnostics.
 */
async function sendWhatsApp({ toE164, body, type = null, title = null, templateName = null, templateParameters = null, language = null }) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId || !toE164) {
    logger.debug(`WhatsApp skipped: ${body?.slice(0, 40)}`);
    return { skipped: true };
  }

  const to = normalizeWhatsAppTo(toE164);
  if (!to) {
    logger.debug('WhatsApp skipped: recipient phone number is empty after normalization');
    return { skipped: true };
  }

  const useTemplates = String(process.env.WHATSAPP_USE_TEMPLATES || '').toLowerCase() === 'true';
  const resolvedTemplate = templateName || getWhatsAppTemplateName(type);

  if (useTemplates && resolvedTemplate) {
    const components = buildTemplateComponents({ title, body, parameters: templateParameters });
    return postWhatsAppMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: resolvedTemplate,
        language: { code: language || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US' },
        ...(components ? { components } : {}),
      },
    });
  }

  await postWhatsAppMessage({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: String(body || '').slice(0, 4096) },
  });

  return { sent: true, mode: 'text' };
}

module.exports = { sendEmail, sendWhatsApp };
