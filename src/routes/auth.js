// src/routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { OAuth2Client } = require("google-auth-library");

const JWT_SECRET = process.env.JWT_SECRET || "seatsniper-secret-change-in-prod";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

// Middleware to verify JWT
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const decoded = jwt.verify(auth.replace("Bearer ", ""), JWT_SECRET);
    req.user = decoded;
    next();
  } catch(e) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, name, phone } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "Name, email and password required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const existing = db.prepare("SELECT id FROM users WHERE email=?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  const hashed = await bcrypt.hash(password, 10);
  const result = db.prepare(`
    INSERT INTO users (email, password, name, phone) VALUES (?, ?, ?, ?)
  `).run(email.toLowerCase(), hashed, name, phone || null);

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email.toLowerCase());
  if (!user || !user.password) return res.status(401).json({ error: "Invalid email or password" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
});

// POST /api/auth/google
router.post("/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "No credential provided" });
  if (!googleClient) return res.status(500).json({ error: "Google auth not configured" });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name } = payload;

    let user = db.prepare("SELECT * FROM users WHERE google_id=? OR email=?").get(googleId, email.toLowerCase());

    if (!user) {
      const result = db.prepare(`
        INSERT INTO users (email, google_id, name) VALUES (?, ?, ?)
      `).run(email.toLowerCase(), googleId, name);
      user = db.prepare("SELECT * FROM users WHERE id=?").get(result.lastInsertRowid);
    } else if (!user.google_id) {
      db.prepare("UPDATE users SET google_id=? WHERE id=?").run(googleId, user.id);
    }

    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
  } catch(e) {
    console.error("[Auth] Google error:", e.message);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, email, name, phone, plan, subscription_status, max_watches FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

// PATCH /api/auth/phone - update phone number
router.patch("/phone", requireAuth, (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : null;
  if (!normalized) return res.status(400).json({ error: "Invalid phone number" });
  db.prepare("UPDATE users SET phone=? WHERE id=?").run(normalized, req.user.id);
  res.json({ success: true, phone: normalized });
});

module.exports = router;
module.exports.requireAuth = requireAuth;