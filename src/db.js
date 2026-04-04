// src/db.js - PostgreSQL via Supabase
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        google_id TEXT UNIQUE,
        name TEXT,
        phone TEXT,
        plan TEXT DEFAULT 'free',
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        subscription_status TEXT DEFAULT 'free',
        max_watches INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS watchers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        phone TEXT NOT NULL,
        subject TEXT NOT NULL,
        catalog_number TEXT NOT NULL,
        class_number TEXT NOT NULL,
        term TEXT NOT NULL,
        term_label TEXT NOT NULL,
        class_title TEXT,
        status TEXT DEFAULT 'pending',
        enroll_total INTEGER,
        enroll_cap INTEGER,
        last_checked TIMESTAMP,
        notified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        watcher_id INTEGER NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW(),
        message TEXT
      );
    `);
    console.log("[DB] PostgreSQL tables ready");
  } catch(e) {
    console.error("[DB] Init error:", e.message);
  }
}

initDb();

module.exports = pool;
