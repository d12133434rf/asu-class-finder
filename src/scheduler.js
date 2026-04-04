// src/scheduler.js
const cron = require("node-cron");
const pool = require("./db");
const { checkClass } = require("./checker");
const { sendOpenAlert } = require("./sms");

let isRunning = false;

async function runChecks() {
  if (isRunning) return;
  isRunning = true;
  try {
    const result = await pool.query("SELECT * FROM watchers WHERE active=1");
    const watchers = result.rows;
    if (!watchers.length) return;
    console.log(`[Scheduler] Checking ${watchers.length} class(es)...`);

    for (const watcher of watchers) {
      try {
        const res = await checkClass(watcher.class_number, watcher.term);
        const now = new Date();

        if (!res.found) {
          await pool.query("UPDATE watchers SET status='not_found', last_checked=$1 WHERE id=$2", [now, watcher.id]);
          continue;
        }

        const wasOpen = watcher.status === "open";
        const newStatus = res.isOpen ? "open" : "closed";

        await pool.query(
          "UPDATE watchers SET status=$1, enroll_total=$2, enroll_cap=$3, last_checked=$4 WHERE id=$5",
          [newStatus, res.enrollTotal, res.enrollCap, now, watcher.id]
        );

        if (res.isOpen && !wasOpen) {
          const recentNotif = await pool.query(
            "SELECT id FROM notifications WHERE watcher_id=$1 AND sent_at > NOW() - INTERVAL '1 hour'",
            [watcher.id]
          );
          if (!recentNotif.rows.length) {
            const sent = await sendOpenAlert({ ...watcher, ...res, status: newStatus });
            if (sent) {
              await pool.query("INSERT INTO notifications (watcher_id, message) VALUES ($1, $2)", [watcher.id, `Class opened: ${res.enrollCap - res.enrollTotal} spots`]);
              await pool.query("UPDATE watchers SET notified_at=$1 WHERE id=$2", [now, watcher.id]);
            }
          }
        }
      } catch(e) {
        console.error(`[Scheduler] Error for #${watcher.class_number}:`, e.message);
        if (e.message !== "AUTH_REQUIRED") {
          await pool.query("UPDATE watchers SET status='error', last_checked=$1 WHERE id=$2", [new Date(), watcher.id]);
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    await pool.query("SELECT NOW()"); // keep connection alive
  } finally {
    isRunning = false;
  }
}

function start() {
  const interval = process.env.CHECK_INTERVAL_MINUTES || "1";
  console.log(`[Scheduler] Starting — checking every ${interval} minute(s)`);
  runChecks();
  cron.schedule(`*/${interval} * * * *`, runChecks);
}

module.exports = { start, runChecks };
