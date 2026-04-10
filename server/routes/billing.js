const { Router } = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = Router();

// ─── Stripe setup ──────────────────────────────
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

// ─── Plan definitions ──────────────────────────
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    limits: { projects: 2, scriptsPerDay: 5, scenes: 4, clipsPerProject: 3, exports: 1 },
  },
  pro: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_PRICE_ID, // Set in .env
    price: 1900, // $19/month in cents
    limits: { projects: 20, scriptsPerDay: 50, scenes: 8, clipsPerProject: 20, exports: 50 },
  },
  unlimited: {
    name: 'Unlimited',
    priceId: process.env.STRIPE_UNLIMITED_PRICE_ID, // Set in .env
    price: 4900, // $49/month in cents
    limits: { projects: -1, scriptsPerDay: -1, scenes: 8, clipsPerProject: -1, exports: -1 },
  },
};

// ─── Get current subscription & plans ──────────
router.get('/subscription', authRequired, (req, res) => {
  const sub = db.prepare(
    'SELECT * FROM subscriptions WHERE user_id = ?'
  ).get(req.user.id);

  res.json({
    subscription: sub || { plan: 'free', status: 'active' },
    plans: Object.entries(PLANS).map(([key, val]) => ({
      id: key,
      name: val.name,
      price: val.price,
      limits: val.limits,
    })),
  });
});

// ─── Create Stripe Checkout Session ────────────
router.post('/checkout', authRequired, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured — add STRIPE_SECRET_KEY to .env' });
  }

  const { plan } = req.body;
  if (!plan || !PLANS[plan] || plan === 'free') {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  const planDef = PLANS[plan];
  if (!planDef.priceId) {
    return res.status(400).json({ error: 'Price ID not configured for this plan' });
  }

  try {
    // Get or create Stripe customer
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
        .run(customerId, user.id);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: planDef.priceId, quantity: 1 }],
      success_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro&checkout=success`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro&checkout=cancel`,
      metadata: { userId: req.user.id, plan },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ─── Create Stripe Customer Portal Session ─────
router.post('/portal', authRequired, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${req.headers.origin || 'http://localhost:3000'}/index.html#skip-intro`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe portal error:', err);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ─── Usage/limits check ────────────────────────
router.get('/usage', authRequired, (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
  const plan = sub?.plan || 'free';
  const limits = PLANS[plan]?.limits || PLANS.free.limits;

  const projectCount = db.prepare(
    'SELECT COUNT(*) as c FROM projects WHERE user_id = ?'
  ).get(req.user.id).c;

  // Scripts generated today
  const today = new Date().toISOString().slice(0, 10);
  const scriptsToday = db.prepare(
    "SELECT COUNT(*) as c FROM scripts s JOIN projects p ON s.project_id = p.id WHERE p.user_id = ? AND s.created_at >= ?"
  ).get(req.user.id, today).c;

  res.json({
    plan,
    limits,
    usage: {
      projects: projectCount,
      scriptsToday,
    },
  });
});

module.exports = { router, PLANS };
