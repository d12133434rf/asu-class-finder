// src/routes/api.js - REST API endpoints
const express = require("express");
const router = express.Router();
const db = require("../db");
const { fetchTerms } = require("../checker");
const { runChecks } = require("../scheduler");

// Normalize phone number to E.164
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// GET /api/terms - get available ASU terms
router.get("/terms", async (req, res) => {
  try {
    const terms = await fetchTerms();
    res.json({ terms });
  } catch(e) {
    res.status(500).json({ error: "Could not fetch terms" });
  }
});

// POST /api/watch - add a class to watch
router.post("/watch", (req, res) => {
  const { phone, subject, catalogNumber, classNumber, term, termLabel } = req.body;

  if (!phone || !subject || !catalogNumber || !classNumber || !term) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(400).json({ error: "Invalid phone number. Use a 10-digit US number." });
  }

  if (!/^\d{4,6}$/.test(classNumber)) {
    return res.status(400).json({ error: "Class number must be 4-6 digits" });
  }

  // Check for duplicate
  const existing = db.prepare(`
    SELECT id FROM watchers
    WHERE phone=? AND class_number=? AND term=? AND active=1
  `).get(normalizedPhone, classNumber, term);

  if (existing) {
    return res.status(409).json({ error: "You are already watching this class" });
  }

  // Check per-phone limit (max 5 active watches)
  const count = db.prepare(`
    SELECT COUNT(*) as cnt FROM watchers WHERE phone=? AND active=1
  `).get(normalizedPhone);

  if (count.cnt >= 5) {
    return res.status(429).json({ error: "Maximum 5 classes per phone number" });
  }

  const result = db.prepare(`
    INSERT INTO watchers (phone, subject, catalog_number, class_number, term, term_label, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(normalizedPhone, subject.toUpperCase(), catalogNumber, classNumber, term, termLabel || term);

  // Trigger an immediate check
  setTimeout(runChecks, 1000);

  res.json({
    success: true,
    id: result.lastInsertRowid,
    message: `Watching ${subject.toUpperCase()} ${catalogNumber} — we'll text ${normalizedPhone} when it opens!`
  });
});

// GET /api/status/:phone - get all watches for a phone number
router.get("/status/:phone", (req, res) => {
  const normalizedPhone = normalizePhone(req.params.phone);
  if (!normalizedPhone) return res.status(400).json({ error: "Invalid phone" });

  const watchers = db.prepare(`
    SELECT id, subject, catalog_number, class_number, term, term_label,
           class_title, status, enroll_total, enroll_cap, last_checked, notified_at, created_at
    FROM watchers WHERE phone=? AND active=1
    ORDER BY created_at DESC
  `).all(normalizedPhone);

  res.json({ watchers });
});

// DELETE /api/watch/:id - stop watching a class
router.delete("/watch/:id", (req, res) => {
  const { phone } = req.body;
  const normalizedPhone = normalizePhone(phone || "");

  if (!normalizedPhone) return res.status(400).json({ error: "Phone required" });

  const result = db.prepare(`
    UPDATE watchers SET active=0 WHERE id=? AND phone=?
  `).run(req.params.id, normalizedPhone);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Watcher not found" });
  }

  res.json({ success: true });
});

// GET /api/stats - public stats for homepage
router.get("/stats", (req, res) => {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_watching,
      SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as currently_open,
      (SELECT COUNT(*) FROM notifications) as total_alerts_sent
    FROM watchers WHERE active=1
  `).get();

  res.json(stats);
});

module.exports = router;
