'use strict';
/**
 * Startup environment check.
 * Logs clear warnings for missing optional services so Railway logs
 * make it obvious what needs to be configured.
 */
const logger = require('./logger');

const CHECKS = [
  {
    group: 'Email (SMTP)',
    vars: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    impact: 'Task assignment, approval, and overdue emails will NOT be sent.',
    docsHint: 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in Railway Variables.',
  },
  {
    group: 'WhatsApp Cloud API',
    vars: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
    impact: 'WhatsApp notifications will NOT be sent.',
    docsHint: 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Railway Variables.',
  },
  {
    group: 'Stripe Billing',
    vars: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_BASIC'],
    impact: 'Billing checkout will fail silently for all users.',
    docsHint: 'Set STRIPE_SECRET_KEY, STRIPE_PRICE_BASIC, STRIPE_PRICE_PRO, STRIPE_PRICE_ENTERPRISE.',
  },
];

function runEnvCheck() {
  let anyMissing = false;

  for (const check of CHECKS) {
    const missing = check.vars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      anyMissing = true;
      logger.warn(`[env] ⚠  ${check.group} not configured`);
      logger.warn(`[env]    Missing: ${missing.join(', ')}`);
      logger.warn(`[env]    Impact:  ${check.impact}`);
      logger.warn(`[env]    Fix:     ${check.docsHint}`);
    } else {
      logger.info(`[env] ✓  ${check.group} configured`);
    }
  }

  if (anyMissing) {
    logger.warn('[env] ─────────────────────────────────────────────────────');
    logger.warn('[env] Add the missing variables in your Railway dashboard:');
    logger.warn('[env] Settings → Variables → Add Variable');
    logger.warn('[env] The server will still start — affected features degrade gracefully.');
    logger.warn('[env] ─────────────────────────────────────────────────────');
  }
}

module.exports = { runEnvCheck };
