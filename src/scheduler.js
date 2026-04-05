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

    // Group watchers by unique class_number + term combination
    const classMap = new Map();
    for (const watcher of watchers) {
      const key = `${watcher.class_number}_${watcher.term}`;
      if (!classMap.has(key)) {
        classMap.set(key, { classNumber: watcher.class_number, term: watcher.term, watchers: [] });
      }
      classMap.get(key).watchers.push(watcher);
    }

    const uniqueClasses = Array.from(classMap.values());
    console.log(`[Scheduler] Checking ${uniqueClasses.length} unique class(es) for ${watchers.length} watcher(s)...`);

    for (const { classNumber, term, watchers: classWatchers } of uniqueClasses) {
      try {
        const res = await checkClass(classNumber, term);
        const now = new Date();
        const newStatus = res.found ? (res.isOpen ? "open" : "closed") : "not_found";

        // Update ALL watchers of this class at once
        await pool.query(
          `UPDATE watchers SET status=$1, enroll_total=$2, enroll_cap=$3, last_checked=$4 
           WHERE class_number=$5 AND term=$6 AND active=1`,
          [newStatus, res.enrollTotal || null, res.enrollCap || null, now, classNumber, term]
        );

        // Notify watchers if class just opened
        if (res.isOpen) {
          for (const watcher of classWatchers) {
            // Only notify if watcher wasn't already open
            if (watcher.status !== "open") {
              const recentNotif = await pool.query(
                "SELECT id FROM notifications WHERE watcher_id=$1 AND sent_at > NOW() - INTERVAL '1 hour'",
                [watcher.id]
              );
              if (!recentNotif.rows.length) {
                const sent = await sendOpenAlert({ ...watcher, ...res, status: newStatus });
                if (sent) {
                  await pool.query("INSERT INTO notifications (watcher_id, message) VALUES ($1, $2)", 
                    [watcher.id, `Class opened: ${res.enrollCap - res.enrollTotal} spots`]);
                  await pool.query("UPDATE watchers SET notified_at=$1 WHERE id=$2", [now, watcher.id]);
                }
              }
            }
          }
        }
      } catch(e) {
        console.error(`[Scheduler] Error for #${classNumber}:`, e.message);
        if (e.message !== "AUTH_REQUIRED") {
          await pool.query(
            "UPDATE watchers SET status='error', last_checked=$1 WHERE class_number=$2 AND term=$3 AND active=1",
            [new Date(), classNumber, term]
          );
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
