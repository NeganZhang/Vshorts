const { Router } = require('express');
const express = require('express');
const db = require('../db');

const router = Router();

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

/**
 * Stripe Webhook Handler
 *
 * IMPORTANT: This route uses express.raw() for body parsing (not JSON).
 * It must be mounted BEFORE express.json() or with its own body parser.
 *
 * Handles the following events:
 *   - checkout.session.completed  → Create/upgrade subscription
 *   - customer.subscription.updated → Sync plan changes, cancellations
 *   - customer.subscription.deleted → Mark subscription as canceled
 *   - invoice.payment_failed       → Mark subscription as past_due
 *   - invoice.payment_succeeded    → Reactivate if was past_due
 */
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  let event;

  // ─── Verify webhook signature ────────────────
  if (WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
  } else {
    // Dev mode: trust raw body (no signature verification)
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    console.warn('⚠ Stripe webhook running without signature verification (dev mode)');
  }

  console.log(`Stripe webhook: ${event.type} [${event.id}]`);

  try {
    switch (event.type) {
      // ─── Checkout completed ────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        const stripeSubId = session.subscription;

        if (!userId || !plan) {
          console.error('Webhook: missing metadata in checkout session', session.id);
          break;
        }

        // Fetch subscription details from Stripe
        const sub = await stripe.subscriptions.retrieve(stripeSubId);

        upsertSubscription(userId, {
          stripe_sub_id: stripeSubId,
          plan,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
        });

        console.log(`Subscription created: user=${userId} plan=${plan} sub=${stripeSubId}`);
        break;
      }

      // ─── Subscription updated ──────────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = getUserByStripeCustomer(sub.customer);
        if (!userId) {
          console.error('Webhook: no user found for customer', sub.customer);
          break;
        }

        // Determine plan from price
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = getPlanByPriceId(priceId) || 'pro';

        upsertSubscription(userId, {
          stripe_sub_id: sub.id,
          plan,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end ? 1 : 0,
        });

        console.log(`Subscription updated: user=${userId} status=${sub.status} plan=${plan}`);
        break;
      }

      // ─── Subscription deleted / canceled ───────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = getUserByStripeCustomer(sub.customer);
        if (!userId) break;

        db.prepare(
          "UPDATE subscriptions SET status = 'canceled', plan = 'free', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
        ).run(userId);

        console.log(`Subscription canceled: user=${userId}`);
        break;
      }

      // ─── Payment failed ────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId = getUserByStripeCustomer(invoice.customer);
        if (!userId) break;

        db.prepare(
          "UPDATE subscriptions SET status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?"
        ).run(userId);

        console.log(`Payment failed: user=${userId}`);
        break;
      }

      // ─── Payment succeeded (renewal) ───────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason !== 'subscription_cycle') break;

        const userId = getUserByStripeCustomer(invoice.customer);
        if (!userId) break;

        // Reactivate if was past_due
        db.prepare(
          "UPDATE subscriptions SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'past_due'"
        ).run(userId);

        console.log(`Payment succeeded (renewal): user=${userId}`);
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event.type}`);
    }
  } catch (err) {
    console.error(`Webhook handler error for ${event.type}:`, err);
    // Still return 200 to prevent Stripe retries on app errors
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
});

// ─── Helper functions ──────────────────────────

function upsertSubscription(userId, data) {
  const existing = db.prepare('SELECT id FROM subscriptions WHERE user_id = ?').get(userId);

  if (existing) {
    db.prepare(`UPDATE subscriptions SET
      stripe_sub_id = ?, plan = ?, status = ?, current_period_end = ?,
      cancel_at_period_end = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?`
    ).run(data.stripe_sub_id, data.plan, data.status, data.current_period_end,
      data.cancel_at_period_end, userId);
  } else {
    const id = require('uuid').v4().slice(0, 16).replace(/-/g, '');
    db.prepare(`INSERT INTO subscriptions
      (id, user_id, stripe_sub_id, plan, status, current_period_end, cancel_at_period_end)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, data.stripe_sub_id, data.plan, data.status,
      data.current_period_end, data.cancel_at_period_end);
  }
}

function getUserByStripeCustomer(stripeCustomerId) {
  const user = db.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .get(stripeCustomerId);
  return user?.id || null;
}

function getPlanByPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  if (priceId === process.env.STRIPE_UNLIMITED_PRICE_ID) return 'unlimited';
  return null;
}

module.exports = router;
