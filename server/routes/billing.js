const { Router } = require('express');
const data = require('../data');
const { authRequired } = require('../middleware/auth');

const router = Router();

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (STRIPE_SECRET) stripe = require('stripe')(STRIPE_SECRET);

const PLANS = {
  free: { name: 'Free', price: 0, limits: { projects: 2, scriptsPerDay: 5, scenes: 4, clipsPerProject: 3, exports: 1 } },
  pro: { name: 'Pro', priceId: process.env.STRIPE_PRO_PRICE_ID, price: 1900, limits: { projects: 20, scriptsPerDay: 50, scenes: 8, clipsPerProject: 20, exports: 50 } },
  unlimited: { name: 'Unlimited', priceId: process.env.STRIPE_UNLIMITED_PRICE_ID, price: 4900, limits: { projects: -1, scriptsPerDay: -1, scenes: 8, clipsPerProject: -1, exports: -1 } },
};

router.get('/subscription', authRequired, async (req, res, next) => {
  try {
    const sub = await data.billing.getSubscription(req.user.id);
    res.json({
      subscription: sub || { plan: 'free', status: 'active' },
      plans: Object.entries(PLANS).map(([key, val]) => ({ id: key, name: val.name, price: val.price, limits: val.limits })),
    });
  } catch (e) { next(e); }
});

router.post('/checkout', authRequired, async (req, res, next) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured — add STRIPE_SECRET_KEY to .env' });
  const { plan } = req.body;
  if (!plan || !PLANS[plan] || plan === 'free') return res.status(400).json({ error: 'Invalid plan' });
  const planDef = PLANS[plan];
  if (!planDef.priceId) return res.status(400).json({ error: 'Price ID not configured for this plan' });

  try {
    const profile = await data.billing.getProfile(req.user.id);
    let customerId = profile && profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: profile && profile.email, metadata: { userId: req.user.id } });
      customerId = customer.id;
      await data.billing.setStripeCustomer(req.user.id, customerId);
    }
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: planDef.priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro&checkout=success`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro&checkout=cancel`,
      metadata: { userId: req.user.id, plan },
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) { console.error('Stripe checkout error:', err); res.status(500).json({ error: 'Failed to create checkout session' }); }
});

router.post('/portal', authRequired, async (req, res, next) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const profile = await data.billing.getProfile(req.user.id);
    if (!profile || !profile.stripe_customer_id) return res.status(400).json({ error: 'No billing account found' });
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro`,
    });
    res.json({ url: session.url });
  } catch (err) { console.error('Stripe portal error:', err); res.status(500).json({ error: 'Failed to create portal session' }); }
});

router.get('/usage', authRequired, async (req, res, next) => {
  try {
    const sub = await data.billing.getSubscription(req.user.id);
    const plan = (sub && sub.plan) || 'free';
    const limits = (PLANS[plan] && PLANS[plan].limits) || PLANS.free.limits;
    const today = new Date().toISOString().slice(0, 10);
    const [projects, scriptsToday] = await Promise.all([
      data.billing.countProjects(req.user.id),
      data.billing.scriptsSince(req.user.id, today),
    ]);
    res.json({ plan, limits, usage: { projects, scriptsToday } });
  } catch (e) { next(e); }
});

module.exports = { router, PLANS };
