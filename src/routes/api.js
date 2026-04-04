// src/routes/api.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const { fetchTerms } = require("../checker");
const { runChecks } = require("../scheduler");
const { requireAuth } = require("./auth");

router.get("/terms", async (req, res) => {
  try {
    const terms = await fetchTerms();
    res.json({ terms });
  } catch(e) {
    res.status(500).json({ error: "Could not fetch terms" });
  }
});

// POST /api/watch - requires auth
router.post("/watch", requireAuth, (req, res) => {
  const { subject, catalogNumber, classNumber, term, termLabel } = req.body;
  if (!subject || !catalogNumber || !classNumber || !term)
    return res.status(400).json({ error: "Missing required fields" });
  if (!/^\d{4,6}$/.test(classNumber))
    return res.status(400).json({ error: "Class number must be 4-6 digits" });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.phone) return res.status(400).json({ error: "Please add a phone number to your account first", needsPhone: true });

  const existing = db.prepare("SELECT id FROM watchers WHERE user_id=? AND class_number=? AND term=? AND active=1")
    .get(user.id, classNumber, term);
  if (existing) return res.status(409).json({ error: "You are already watching this class" });

  const count = db.prepare("SELECT COUNT(*) as cnt FROM watchers WHERE user_id=? AND active=1").get(user.id);
  const maxWatches = user.max_watches || 1;

  if (count.cnt >= maxWatches) {
    return res.status(429).json({
      error: maxWatches === 1
        ? "Free plan allows 1 class. Upgrade to Bronze, Silver, or Gold to watch more!"
        : `Your plan allows ${maxWatches} classes. Upgrade for more!`,
      upgrade: true
    });
  }

  const result = db.prepare(`
    INSERT INTO watchers (user_id, phone, subject, catalog_number, class_number, term, term_label, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(user.id, user.phone, subject.toUpperCase(), catalogNumber, classNumber, term, termLabel || term);

  setTimeout(runChecks, 1000);
  res.json({ success: true, id: result.lastInsertRowid, message: `Watching ${subject.toUpperCase()} ${catalogNumber}!` });
});

// GET /api/watches - get user's watches
router.get("/watches", requireAuth, (req, res) => {
  const watchers = db.prepare(`
    SELECT id, subject, catalog_number, class_number, term, term_label,
           class_title, status, enroll_total, enroll_cap, last_checked, created_at
    FROM watchers WHERE user_id=? AND active=1 ORDER BY created_at DESC
  `).all(req.user.id);
  const user = db.prepare("SELECT max_watches, plan FROM users WHERE id=?").get(req.user.id);
  res.json({ watchers, maxWatches: user?.max_watches || 1, plan: user?.plan || "free" });
});

// DELETE /api/watch/:id
router.delete("/watch/:id", requireAuth, (req, res) => {
  const result = db.prepare("UPDATE watchers SET active=0 WHERE id=? AND user_id=?")
    .run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: "Watcher not found" });
  res.json({ success: true });
});

// GET /api/stats
router.get("/stats", (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) as total_watching,
    (SELECT COUNT(*) FROM notifications) as total_alerts_sent
    FROM watchers WHERE active=1
  `).get();
  res.json(stats);
});

module.exports = router;