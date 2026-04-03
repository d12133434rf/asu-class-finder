// src/routes/api.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { fetchTerms } = require("../checker");
const { runChecks } = require("../scheduler");

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function getMaxWatches(phone) {
  try {
    const sub = db.prepare("SELECT max_watches, status FROM subscriptions WHERE phone=?").get(phone);
    if (sub && sub.status === "active") return sub.max_watches;
  } catch(e) {}
  return 1; // free tier = 1 watch
}

router.get("/terms", async (req, res) => {
  try {
    const terms = await fetchTerms();
    res.json({ terms });
  } catch(e) {
    res.status(500).json({ error: "Could not fetch terms" });
  }
});

router.post("/watch", (req, res) => {
  const { phone, subject, catalogNumber, classNumber, term, termLabel } = req.body;
  if (!phone || !subject || !catalogNumber || !classNumber || !term)
    return res.status(400).json({ error: "Missing required fields" });

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone number" });
  if (!/^\d{4,6}$/.test(classNumber)) return res.status(400).json({ error: "Class number must be 4-6 digits" });

  const existing = db.prepare("SELECT id FROM watchers WHERE phone=? AND class_number=? AND term=? AND active=1").get(normalizedPhone, classNumber, term);
  if (existing) return res.status(409).json({ error: "You are already watching this class" });

  const count = db.prepare("SELECT COUNT(*) as cnt FROM watchers WHERE phone=? AND active=1").get(normalizedPhone);
  const maxWatches = getMaxWatches(normalizedPhone);

  if (count.cnt >= maxWatches) {
    if (maxWatches === 1) {
      return res.status(429).json({ error: "Free plan allows 1 class. Upgrade to watch more!", upgrade: true });
    }
    return res.status(429).json({ error: `Your plan allows ${maxWatches} classes. Upgrade for more!`, upgrade: true });
  }

  const result = db.prepare(`
    INSERT INTO watchers (phone, subject, catalog_number, class_number, term, term_label, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(normalizedPhone, subject.toUpperCase(), catalogNumber, classNumber, term, termLabel || term);

  setTimeout(runChecks, 1000);

  res.json({
    success: true,
    id: result.lastInsertRowid,
    message: `Watching ${subject.toUpperCase()} ${catalogNumber} — we'll text ${normalizedPhone} when it opens!`
  });
});

router.get("/status/:phone", (req, res) => {
  const normalizedPhone = normalizePhone(req.params.phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone" });

  const watchers = db.prepare(`
    SELECT id, subject, catalog_number, class_number, term, term_label,
           class_title, status, enroll_total, enroll_cap, last_checked, created_at
    FROM watchers WHERE phone=? AND active=1 ORDER BY created_at DESC
  `).all(normalizedPhone);

  const maxWatches = getMaxWatches(normalizedPhone);
  res.json({ watchers, maxWatches });
});

router.delete("/watch/:id", (req, res) => {
  const { phone } = req.body;
  const normalizedPhone = normalizePhone(phone || "");
  if (!normalizedPhone) return res.status(400).json({ error: "Phone required" });

  const result = db.prepare("UPDATE watchers SET active=0 WHERE id=? AND phone=?").run(req.params.id, normalizedPhone);
  if (result.changes === 0) return res.status(404).json({ error: "Watcher not found" });
  res.json({ success: true });
});

router.get("/stats", (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) as total_watching,
    (SELECT COUNT(*) FROM notifications) as total_alerts_sent
    FROM watchers WHERE active=1
  `).get();
  res.json(stats);
});

module.exports = router;