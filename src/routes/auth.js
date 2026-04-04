// src/routes/auth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "seatsniper-secret-change-in-prod";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(auth.replace("Bearer ", ""), JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

router.post("/register", async (req, res) => {
  const { email, password, name, phone } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "Name, email and password required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "An account with this email already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password, name, phone) VALUES ($1, $2, $3, $4) RETURNING *",
      [email.toLowerCase(), hashed, name, phone || null]
    );
    const user = result.rows[0];
    res.json({ token: generateToken(user), user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
  } catch(e) {
    console.error("[Auth] Register error:", e.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user || !user.password) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    res.json({ token: generateToken(user), user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
  } catch(e) {
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: "No credential provided" });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: "Google auth not configured" });

  try {
    const { OAuth2Client } = require("google-auth-library");
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const { sub: googleId, email, name } = ticket.getPayload();

    let result = await pool.query("SELECT * FROM users WHERE google_id=$1 OR email=$2", [googleId, email.toLowerCase()]);
    let user = result.rows[0];

    if (!user) {
      result = await pool.query(
        "INSERT INTO users (email, google_id, name) VALUES ($1, $2, $3) RETURNING *",
        [email.toLowerCase(), googleId, name]
      );
      user = result.rows[0];
    } else if (!user.google_id) {
      await pool.query("UPDATE users SET google_id=$1 WHERE id=$2", [googleId, user.id]);
    }

    res.json({ token: generateToken(user), user: { id: user.id, email: user.email, name: user.name, plan: user.plan, phone: user.phone } });
  } catch(e) {
    console.error("[Auth] Google error:", e.message);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, name, phone, plan, subscription_status, max_watches FROM users WHERE id=$1",
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "User not found" });
    res.json({ user: result.rows[0] });
  } catch(e) {
    res.status(500).json({ error: "Failed to get user" });
  }
});

router.patch("/phone", requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 ? `+${digits}` : null;
  if (!normalized) return res.status(400).json({ error: "Invalid phone number" });

  await pool.query("UPDATE users SET phone=$1 WHERE id=$2", [normalized, req.user.id]);
  res.json({ success: true, phone: normalized });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
