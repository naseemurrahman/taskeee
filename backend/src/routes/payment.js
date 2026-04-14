const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../utils/db');
const { getStripe, getPriceIdForPlan } = require('../services/stripeService');

function parseOrgSettings(settings) {
  if (!settings) return {};
  if (typeof settings === 'object') return settings;
  try { return JSON.parse(settings); } catch { return {}; }
}

router.post('/checkout-session', authenticate, async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { plan, seats } = req.body || {};
    const planKey = String(plan || '').toLowerCase().trim();
    const qty = Math.max(1, parseInt(seats || 1, 10));

    const priceId = getPriceIdForPlan(planKey);
    if (!priceId) return res.status(400).json({ error: 'Invalid plan selected' });

    const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

    const { rows: orgRows } = await query(
      `SELECT id, name, settings FROM organizations WHERE id = $1`,
      [req.user.org_id]
    );
    const org = orgRows[0];
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { rows: custRows } = await query(
      `SELECT stripe_customer_id FROM stripe_customers WHERE org_id = $1`,
      [req.user.org_id]
    );
    let stripeCustomerId = custRows[0]?.stripe_customer_id || null;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: org.name || req.user.full_name,
        metadata: { orgId: req.user.org_id, createdBy: req.user.id }
      });
      stripeCustomerId = customer.id;
      await query(
        `INSERT INTO stripe_customers (org_id, created_by, stripe_customer_id, email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, email = EXCLUDED.email`,
        [req.user.org_id, req.user.id, stripeCustomerId, req.user.email]
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: qty }],
      allow_promotion_codes: true,
      success_url: `${origin}/app/billing?success=1`,
      cancel_url: `${origin}/app/billing?canceled=1`,
      subscription_data: { metadata: { orgId: req.user.org_id, planKey, seats: String(qty) } }
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.post('/portal', authenticate, async (req, res, next) => {
  try {
    const stripe = getStripe();
    const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

    const { rows } = await query(
      `SELECT stripe_customer_id FROM stripe_customers WHERE org_id = $1`,
      [req.user.org_id]
    );
    const stripeCustomerId = rows[0]?.stripe_customer_id;
    if (!stripeCustomerId) return res.status(404).json({ error: 'Billing customer not found' });

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${origin}/app/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(500).send('Webhook not configured');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const orgId = sub.metadata?.orgId;
      const planKey = sub.metadata?.planKey || null;
      const seats = sub.items?.data?.[0]?.quantity || parseInt(sub.metadata?.seats || '1', 10);

      if (orgId) {
        await query(
          `INSERT INTO stripe_subscriptions (org_id, stripe_subscription_id, status, plan_key, seats, current_period_end, cancel_at_period_end, updated_at)
           VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, NOW())
           ON CONFLICT (stripe_subscription_id) DO UPDATE
             SET status = EXCLUDED.status,
                 plan_key = EXCLUDED.plan_key,
                 seats = EXCLUDED.seats,
                 current_period_end = EXCLUDED.current_period_end,
                 cancel_at_period_end = EXCLUDED.cancel_at_period_end,
                 updated_at = NOW()`,
          [orgId, sub.id, sub.status, planKey, seats, sub.current_period_end, sub.cancel_at_period_end]
        );

        const { rows: orgRows } = await query(`SELECT settings FROM organizations WHERE id = $1`, [orgId]);
        const settings = parseOrgSettings(orgRows[0]?.settings);
        settings.subscription = {
          status: sub.status,
          plan: planKey,
          seats,
          billingModel: 'per_user_month',
          source: 'stripe',
          stripeSubscriptionId: sub.id,
          currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        };
        await query(`UPDATE organizations SET settings = $1::jsonb WHERE id = $2`, [JSON.stringify(settings), orgId]);
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const orgId = sub.metadata?.orgId;
      if (orgId) {
        await query(
          `UPDATE stripe_subscriptions
           SET status = 'canceled', cancel_at_period_end = TRUE, updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
