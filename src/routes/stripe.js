// src/routes/stripe.js
const express = require("express");
const router = express.Router();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const db = require("../db");

const PLANS = {
  bronze: { priceId: process.env.STRIPE_BRONZE_PRICE, name: "Bronze", maxWatches: 1 },
  silver: { priceId: process.env.STRIPE_SILVER_PRICE, name: "Silver", maxWatches: 3 },
  gold:   { priceId: process.env.STRIPE_GOLD_PRICE,   name: "Gold",   maxWatches: 999 }
};

// Add subscriptions table if not exists
const db2 = require("../db");
db2.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    plan TEXT DEFAULT 'free',
    status TEXT DEFAULT 'inactive',
    max_watches INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function getSubscription(phone) {
  return db.prepare("SELECT * FROM subscriptions WHERE phone=?").get(phone) || { plan: "free", max_watches: 1, status: "free" };
}

// GET /api/subscription/:phone
router.get("/:phone", (req, res) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) return res.status(400).json({ error: "Invalid phone" });
  const sub = getSubscription(phone);
  res.json({ plan: sub.plan, status: sub.status, maxWatches: sub.max_watches });
});

// POST /api/subscription/checkout - create Stripe checkout session
router.post("/checkout", async (req, res) => {
  const { phone, plan } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone" });

  const planInfo = PLANS[plan];
  if (!planInfo) return res.status(400).json({ error: "Invalid plan" });

  try {
    // Get or create Stripe customer
    let sub = db.prepare("SELECT * FROM subscriptions WHERE phone=?").get(normalizedPhone);
    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({ phone: normalizedPhone, metadata: { phone: normalizedPhone } });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: planInfo.priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"}/success?session_id={CHECKOUT_SESSION_ID}&phone=${encodeURIComponent(normalizedPhone)}`,
      cancel_url: `${process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"}/?canceled=true`,
      metadata: { phone: normalizedPhone, plan }
    });

    res.json({ url: session.url });
  } catch(e) {
    console.error("[Stripe] Checkout error:", e.message);
    res.status(500).json({ error: "Could not create checkout session" });
  }
});

// POST /api/subscription/webhook - Stripe webhook
router.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
  } catch(e) {
    // If no webhook secret set, parse body directly (dev mode)
    try { event = JSON.parse(req.body); } catch(e2) {
      return res.status(400).send("Webhook error");
    }
  }

  const maxWatchesForPlan = { bronze: 1, silver: 3, gold: 999 };

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const phone = session.metadata?.phone;
    const plan = session.metadata?.plan;
    if (phone && plan) {
      const max = maxWatchesForPlan[plan] || 1;
      db.prepare(`
        INSERT INTO subscriptions (phone, stripe_customer_id, stripe_subscription_id, plan, status, max_watches)
        VALUES (?, ?, ?, ?, 'active', ?)
        ON CONFLICT(phone) DO UPDATE SET
          stripe_customer_id=excluded.stripe_customer_id,
          stripe_subscription_id=excluded.stripe_subscription_id,
          plan=excluded.plan, status='active', max_watches=excluded.max_watches,
          updated_at=CURRENT_TIMESTAMP
      `).run(phone, session.customer, session.subscription, plan, max);
      console.log(`[Stripe] ✅ ${phone} subscribed to ${plan}`);
    }
  }

  if (event.type === "customer.subscription.deleted" || event.type === "invoice.payment_failed") {
    const obj = event.data.object;
    const customerId = obj.customer;
    db.prepare(`UPDATE subscriptions SET status='inactive', plan='free', max_watches=1 WHERE stripe_customer_id=?`).run(customerId);
    console.log(`[Stripe] ❌ Subscription cancelled for customer ${customerId}`);
  }

  res.json({ received: true });
});

// POST /api/subscription/portal - customer portal to manage billing
router.post("/portal", async (req, res) => {
  const { phone } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone" });

  const sub = db.prepare("SELECT * FROM subscriptions WHERE phone=?").get(normalizedPhone);
  if (!sub?.stripe_customer_id) return res.status(404).json({ error: "No subscription found" });

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: process.env.APP_URL || "https://asu-class-finder-production.up.railway.app"
    });
    res.json({ url: session.url });
  } catch(e) {
    res.status(500).json({ error: "Could not open billing portal" });
  }
});

module.exports = router;
module.exports.getSubscription = getSubscription;
module.exports.normalizePhone = normalizePhone;