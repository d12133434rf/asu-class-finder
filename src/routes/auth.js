// src/routes/auth.js
const express = require("express");
// Brevo HTTP API helper
async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": process.env.BREVO_API_KEY
    },
    body: JSON.stringify({
      sender: { name: "SeatSniper ASU", email: "asuseatsniper@gmail.com" },
      to: [{ email: to }],
      subject,
      htmlContent: html
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}
const fetch = require("node-fetch");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "seatsniper-secret-change-in-prod";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const APP_URL = process.env.APP_URL || "https://asu-class-finder-production.up.railway.app";

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
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
    const existing = await pool.query("SELECT id, email_verified FROM users WHERE email=$1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "An account with this email already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const verifyToken = crypto.randomBytes(32).toString("hex");
    const result = await pool.query(
      "INSERT INTO users (email, password, name, phone, verify_token, email_verified) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
      [email.toLowerCase(), hashed, name, phone || null, verifyToken]
    ).catch(async () => {
      // Add columns if they don't exist
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false");
      return pool.query(
        "INSERT INTO users (email, password, name, phone, verify_token, email_verified) VALUES ($1, $2, $3, $4, $5, false) RETURNING *",
        [email.toLowerCase(), hashed, name, phone || null, verifyToken]
      );
    });
    const user = result.rows[0];

    // Send verification email via Resend
    const verifyUrl = `${APP_URL}/verify-email.html?token=${verifyToken}`;
    try {
      await sendEmail(
        email.toLowerCase(),
        "Verify your SeatSniper ASU email",
        `<h2>Welcome to SeatSniper, ${name}!</h2><p>Click the link below to verify your email address:</p><p><a href="${verifyUrl}" style="background:#FFC627;color:#5C0F28;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">VERIFY EMAIL</a></p><p>Or copy this link: ${verifyUrl}</p><p>This link expires in 24 hours.</p><p>— SeatSniper ASU</p>`
      );
      console.log(`[Auth] Verification email sent to ${email}`);
    } catch(emailErr) {
      console.error("[Auth] Failed to send verification email:", emailErr.message);
    }

    res.json({ success: true, message: "Account created! Please check your email to verify your account before logging in." });
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
    if (user.email_verified === false) return res.status(401).json({ error: "Please verify your email before logging in. Check your inbox for the verification link.", needsVerify: true });
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
      result = await pool.query("INSERT INTO users (email, google_id, name) VALUES ($1, $2, $3) RETURNING *", [email.toLowerCase(), googleId, name]);
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
    const result = await pool.query("SELECT id, email, name, phone, plan, subscription_status, max_watches FROM users WHERE id=$1", [req.user.id]);
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

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const result = await pool.query("SELECT id, name FROM users WHERE email=$1", [email.toLowerCase()]);
    const user = result.rows[0];

    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true, message: "If that email exists, a reset link has been sent." });

    // Generate reset token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token in DB (add columns if needed)
    await pool.query(
      "UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3",
      [token, expires, user.id]
    ).catch(async () => {
      // Columns don't exist yet, create them
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT");
      await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP");
      await pool.query("UPDATE users SET reset_token=$1, reset_token_expires=$2 WHERE id=$3", [token, expires, user.id]);
    });

    const resetUrl = `${APP_URL}/reset-password.html?token=${token}`;

    // Send email via EmailJS REST API
    // Send reset email via Resend
    console.log(`[Auth] Sending reset email to ${email}`);
    await sendEmail(
      email.toLowerCase(),
      "Reset your SeatSniper ASU password",
      `<h2>Password Reset</h2><p>Hi ${user.name || "there"},</p><p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}" style="background:#FFC627;color:#5C0F28;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">RESET PASSWORD</a></p><p>Or copy this link: ${resetUrl}</p><p>If you didn't request this, ignore this email.</p><p>— SeatSniper ASU</p>`
    );
    console.log(`[Auth] Reset email sent successfully`);
    res.json({ success: true, message: "If that email exists, a reset link has been sent." });
  } catch(e) {
    console.error("[Auth] Forgot password error:", e.message);
    res.status(500).json({ error: "Failed to send reset email" });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and password required" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE reset_token=$1 AND reset_token_expires > NOW()",
      [token]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });

    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE users SET password=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2",
      [hashed, user.id]
    );

    res.json({ success: true, message: "Password reset successfully! You can now log in." });
  } catch(e) {
    console.error("[Auth] Reset password error:", e.message);
    res.status(500).json({ error: "Failed to reset password" });
  }
});


// GET /api/auth/verify-email
router.get("/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token required" });
  try {
    const result = await pool.query("SELECT id FROM users WHERE verify_token=$1", [token]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Invalid or expired verification link." });
    await pool.query("UPDATE users SET email_verified=true, verify_token=NULL WHERE id=$1", [user.id]);
    res.json({ success: true, message: "Email verified! You can now log in." });
  } catch(e) {
    res.status(500).json({ error: "Verification failed" });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
