// src/routes/stripe.js
const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const db = require("../db");
const { requireAuth } = require("./auth");

const PLANS = {
  bronze: { priceId: process.env.STRIPE_BRONZE_PRICE, name: "Bronze", maxWatches: 1 },
  silver: { priceId: process.env.STRIPE_SILVER_PRICE, name: "Silver", maxWatches: 3 },
  gold:   { priceId: process.env.STRIPE_GOLD_PRICE,   name: "Gold",   maxWatches: 999 }
};

// POST /api/subscription/checkout - requires auth
router.post("/checkout", requireAuth, async (req, res) => {
  const { plan } = req.body;
  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: "Invalid plan" });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: String(user.id) }
      });
      customerId = customer.id;
      db.prepare("UPDATE users SET stripe_customer_id=? WHERE id=?").run(customerId, user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: planInfo.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"}/dashboard?success=true`,
      cancel_url: `${process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"}/pricing`,
      metadata: { userId: String(user.id), plan }
    });

    res.json({ url: session.url });
  } catch(e) {
    console.error("[Stripe] Error:", e.message);
    res.status(500).json({ error: "Could not create checkout session" });
  }
});

// POST /api/subscription/portal
router.post("/portal", requireAuth, async (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user?.stripe_customer_id) return res.status(404).json({ error: "No subscription found" });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"}/dashboard`
    });
    res.json({ url: session.url });
  } catch(e) {
    res.status(500).json({ error: "Could not open billing portal" });
  }
});

// POST /api/subscription/webhook
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = process.env.STRIPE_WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
      : JSON.parse(req.body);
  } catch(e) {
    return res.status(400).send("Webhook error");
  }

  const maxMap = { bronze: 1, silver: 3, gold: 999 };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const plan = session.metadata?.plan;
    if (userId && plan) {
      db.prepare(`
        UPDATE users SET plan=?, subscription_status='active',
        stripe_subscription_id=?, max_watches=? WHERE id=?
      `).run(plan, session.subscription, maxMap[plan] || 1, userId);
      console.log(`[Stripe] User ${userId} subscribed to ${plan}`);
    }
  }

  if (event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
    const customerId = event.data.object.customer;
    db.prepare(`UPDATE users SET plan='free', subscription_status='inactive', max_watches=1 WHERE stripe_customer_id=?`)
      .run(customerId);
    console.log(`[Stripe] Subscription ended for ${customerId}`);
  }

  res.json({ received: true });
});

module.exports = router;