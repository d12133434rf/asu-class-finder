// src/routes/api.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
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

router.post("/watch", requireAuth, async (req, res) => {
  const { subject, catalogNumber, classNumber, term, termLabel } = req.body;
  if (!subject || !catalogNumber || !classNumber || !term)
    return res.status(400).json({ error: "Missing required fields" });
  if (!/^\d{4,6}$/.test(classNumber))
    return res.status(400).json({ error: "Class number must be 4-6 digits" });

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.phone) return res.status(400).json({ error: "Please add a phone number to your account first", needsPhone: true });

    const existing = await pool.query(
      "SELECT id FROM watchers WHERE user_id=$1 AND class_number=$2 AND term=$3 AND active=1",
      [user.id, classNumber, term]
    );
    if (existing.rows.length) return res.status(409).json({ error: "You are already watching this class" });

    const countResult = await pool.query("SELECT COUNT(*) as cnt FROM watchers WHERE user_id=$1 AND active=1", [user.id]);
    const count = parseInt(countResult.rows[0].cnt);
    const maxWatches = user.max_watches || 0;

    if (maxWatches === 0) return res.status(429).json({ error: "Please subscribe to a plan to start watching classes.", upgrade: true });
    if (count >= maxWatches) return res.status(429).json({ error: `Your plan allows ${maxWatches} class${maxWatches !== 1 ? "es" : ""}. Upgrade for more!`, upgrade: true });

    const result = await pool.query(
      "INSERT INTO watchers (user_id, phone, subject, catalog_number, class_number, term, term_label, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id",
      [user.id, user.phone, subject.toUpperCase(), catalogNumber, classNumber, term, termLabel || term]
    );

    setTimeout(runChecks, 1000);
    res.json({ success: true, id: result.rows[0].id, message: `Watching ${subject.toUpperCase()} ${catalogNumber}!` });
  } catch(e) {
    console.error("[API] Watch error:", e.message);
    res.status(500).json({ error: "Failed to add watch" });
  }
});

router.get("/watches", requireAuth, async (req, res) => {
  try {
    const watchers = await pool.query(
      "SELECT id, subject, catalog_number, class_number, term, term_label, class_title, status, enroll_total, enroll_cap, last_checked, created_at FROM watchers WHERE user_id=$1 AND active=1 ORDER BY created_at DESC",
      [req.user.id]
    );
    const userResult = await pool.query("SELECT max_watches, plan FROM users WHERE id=$1", [req.user.id]);
    const user = userResult.rows[0];
    res.json({ watchers: watchers.rows, maxWatches: user?.max_watches || 0, plan: user?.plan || "free" });
  } catch(e) {
    res.status(500).json({ error: "Failed to get watches" });
  }
});

router.delete("/watch/:id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query("UPDATE watchers SET active=0 WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Watcher not found" });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: "Failed to remove watch" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as total_watching, (SELECT COUNT(*) FROM notifications) as total_alerts_sent FROM watchers WHERE active=1"
    );
    res.json(result.rows[0]);
  } catch(e) {
    res.json({ total_watching: 0, total_alerts_sent: 0 });
  }
});

module.exports = router;
