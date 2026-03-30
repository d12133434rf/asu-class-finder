// src/db.js - SQLite database setup
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/seatsniper.db");

// Ensure data directory exists
const fs = require("fs");
const dataDir = path.join(__dirname, "../data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS watchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    last_checked DATETIME,
    notified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watcher_id INTEGER NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    message TEXT,
    FOREIGN KEY(watcher_id) REFERENCES watchers(id)
  );
`);

module.exports = db;
