const Stripe = require('stripe');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw Object.assign(new Error('Stripe is not configured'), { status: 503 });
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

function getPriceIdForPlan(planKey) {
  const key = String(planKey || '').toLowerCase().trim();
  if (key === 'basic') return process.env.STRIPE_PRICE_BASIC;
  if (key === 'pro') return process.env.STRIPE_PRICE_PRO;
  if (key === 'enterprise') return process.env.STRIPE_PRICE_ENTERPRISE;
  return null;
}

module.exports = {
  getStripe,
  getPriceIdForPlan,
};

