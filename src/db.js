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

// Convert ? placeholders to $1, $2... for PostgreSQL
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Convert CURRENT_TIMESTAMP and other SQLite-isms
function convertSql(sql) {
  return convertPlaceholders(sql)
    .replace(/CURRENT_TIMESTAMP/g, "NOW()")
    .replace(/datetime\('now',\s*'([^']+)'\)/g, (_, interval) => {
      const match = interval.match(/([+-]\d+)\s+(\w+)/);
      if (match) return `NOW() + INTERVAL '${match[1]} ${match[2]}'`;
      return "NOW()";
    })
    .replace(/INSERT OR IGNORE/g, "INSERT")
    .replace(/ON CONFLICT\(([^)]+)\) DO UPDATE SET/g, "ON CONFLICT($1) DO UPDATE SET");
}

// Synchronous-looking API that returns promises
function prepare(sql) {
  const pgSql = convertSql(sql);
  return {
    run(...params) {
      return pool.query(pgSql, params).then(r => ({
        lastInsertRowid: r.rows[0]?.id,
        changes: r.rowCount
      }));
    },
    get(...params) {
      return pool.query(pgSql, params).then(r => r.rows[0] || null);
    },
    all(...params) {
      return pool.query(pgSql, params).then(r => r.rows);
    }
  };
}

initDb();

module.exports = pool;
module.exports.prepare = prepare;
module.exports.exec = (sql) => pool.query(sql);
module.exports.query = (sql, params) => pool.query(sql, params);
