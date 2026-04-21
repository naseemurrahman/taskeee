const express = require('express');
const router = express.Router();
const { authenticate, requireAnyRole } = require('../middleware/auth');
const { query } = require('../utils/db');
const { getStripe } = require('../services/stripeService');
const { orgIdForSessionUser } = require('../utils/orgContext');

async function orgIdOf(req) {
  const fromContext = await orgIdForSessionUser(req);
  if (fromContext) return fromContext;
  const fallback = req.user.org_id ?? req.user.orgId;
  return fallback ? String(fallback) : null;
}

async function getStripeCustomerId(orgId) {
  const { rows } = await query(`SELECT stripe_customer_id FROM stripe_customers WHERE org_id = $1`, [orgId]);
  return rows[0]?.stripe_customer_id || null;
}

async function getActiveUserCount(orgId) {
  const { rows } = await query(`SELECT COUNT(*)::int AS c FROM users WHERE org_id = $1 AND is_active = TRUE`, [orgId]);
  return rows[0]?.c || 0;
}

async function getCurrentSubscription(orgId) {
  const { rows } = await query(
    `SELECT org_id, stripe_subscription_id, status, plan_key, seats, current_period_end, cancel_at_period_end, updated_at
     FROM stripe_subscriptions
     WHERE org_id = $1
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [orgId]
  );
  return rows[0] || null;
}

router.get('/summary', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdOf(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const [sub, usersUsed] = await Promise.all([getCurrentSubscription(orgId), getActiveUserCount(orgId)]);

    const subscription = sub
      ? {
          status: sub.status,
          plan: sub.plan_key,
          seats: sub.seats,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          currentPeriodEnd: sub.current_period_end,
          stripeSubscriptionId: sub.stripe_subscription_id,
        }
      : null;

    res.json({
      subscription,
      usage: { usersUsed },
    });
  } catch (err) { next(err); }
});

router.get('/invoices', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdOf(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const stripeCustomerId = await getStripeCustomerId(orgId);
    if (!stripeCustomerId) return res.json({ invoices: [] });

    let stripe;
    try {
      stripe = getStripe();
    } catch (_) {
      // Stripe not configured — return empty list rather than 500
      return res.json({ invoices: [] });
    }

    const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 10 });
    const normalized = (invoices.data || []).map(inv => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      amountDue: (inv.amount_due || 0) / 100,
      amountPaid: (inv.amount_paid || 0) / 100,
      currency: inv.currency,
      created: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      hostedInvoiceUrl: inv.hosted_invoice_url || null,
      invoicePdf: inv.invoice_pdf || null,
    }));
    res.json({ invoices: normalized });
  } catch (err) { next(err); }
});

router.get('/usage', authenticate, requireAnyRole('supervisor', 'manager', 'hr', 'director', 'admin'), async (req, res, next) => {
  try {
    const orgId = await orgIdOf(req);
    if (!orgId) return res.status(401).json({ error: 'Session expired — please sign in again.' });
    const [sub, usersUsed] = await Promise.all([getCurrentSubscription(orgId), getActiveUserCount(orgId)]);
    const seats = sub?.seats ?? null;
    res.json({
      usage: {
        usersUsed,
        seats,
        usersRemaining: seats != null ? Math.max(0, seats - usersUsed) : null,
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;

