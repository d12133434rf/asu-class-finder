// src/scheduler.js - Runs class checks every minute
const cron = require("node-cron");
const db = require("./db");
const { checkClass } = require("./checker");
const { sendOpenAlert } = require("./sms");

let isRunning = false;

async function runChecks() {
  if (isRunning) return;
  isRunning = true;

  try {
    // Get all active watchers
    const watchers = db.prepare(`
      SELECT * FROM watchers WHERE active = 1
    `).all();

    if (watchers.length === 0) return;

    console.log(`[Scheduler] Checking ${watchers.length} class(es)...`);

    for (const watcher of watchers) {
      try {
        const result = await checkClass(watcher.class_number, watcher.term);

        const now = new Date().toISOString();

        if (!result.found) {
          db.prepare(`UPDATE watchers SET status='not_found', last_checked=? WHERE id=?`)
            .run(now, watcher.id);
          continue;
        }

        const wasOpen = watcher.status === "open";
        const isNowOpen = result.isOpen;
        const newStatus = isNowOpen ? "open" : "closed";

        db.prepare(`
          UPDATE watchers
          SET status=?, enroll_total=?, enroll_cap=?, last_checked=?,
              class_title=COALESCE(NULLIF(class_title,''), ?)
          WHERE id=?
        `).run(newStatus, result.enrollTotal, result.enrollCap, now, result.title || "", watcher.id);

        // Send SMS if class just opened (and hasn't been notified recently)
        if (isNowOpen && !wasOpen) {
          // Check if we already notified within the last hour
          const recentNotif = db.prepare(`
            SELECT id FROM notifications
            WHERE watcher_id = ? AND sent_at > datetime('now', '-1 hour')
          `).get(watcher.id);

          if (!recentNotif) {
            const updatedWatcher = { ...watcher, ...result, status: newStatus };
            const sent = await sendOpenAlert(updatedWatcher);
            if (sent) {
              db.prepare(`INSERT INTO notifications (watcher_id, message) VALUES (?, ?)`)
                .run(watcher.id, `Class opened: ${result.enrollCap - result.enrollTotal} spots`);
              db.prepare(`UPDATE watchers SET notified_at=? WHERE id=?`).run(now, watcher.id);
            }
          }
        }

      } catch(e) {
        console.error(`[Scheduler] Error checking #${watcher.class_number}:`, e.message);
        if (e.message !== "AUTH_REQUIRED") {
          db.prepare(`UPDATE watchers SET status='error', last_checked=? WHERE id=?`)
            .run(new Date().toISOString(), watcher.id);
        }
      }

      // Small delay between requests to be nice to ASU's servers
      await new Promise(r => setTimeout(r, 500));
    }

  } finally {
    isRunning = false;
  }
}

function start() {
  const interval = process.env.CHECK_INTERVAL_MINUTES || "1";
  console.log(`[Scheduler] Starting — checking every ${interval} minute(s)`);

  // Run immediately on start
  runChecks();

  // Then on schedule
  cron.schedule(`*/${interval} * * * *`, runChecks);
}

module.exports = { start, runChecks };
