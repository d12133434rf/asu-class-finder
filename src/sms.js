// src/sms.js - Twilio SMS notifications
const twilio = require("twilio");

let client = null;

function getClient() {
  if (!client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token || sid.startsWith("AC_")) {
      console.warn("[SMS] Twilio not configured — SMS disabled");
      return null;
    }
    client = twilio(sid, token);
  }
  return client;
}

async function sendOpenAlert(watcher) {
  const c = getClient();
  if (!c) {
    console.log(`[SMS] Would text ${watcher.phone}: ${watcher.subject} ${watcher.catalog_number} is OPEN!`);
    return false;
  }

  const spotsLeft = (watcher.enroll_cap || 0) - (watcher.enroll_total || 0);
  const message = [
    `🎯 SeatSniper: ${watcher.subject} ${watcher.catalog_number} just opened!`,
    `${spotsLeft} seat${spotsLeft !== 1 ? "s" : ""} available`,
    `Class #${watcher.class_number} · ${watcher.term_label}`,
    `Register now: my.asu.edu`
  ].join("\n");

  try {
    await c.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: watcher.phone
    });
    console.log(`[SMS] Sent to ${watcher.phone} for ${watcher.subject} ${watcher.catalog_number}`);
    return true;
  } catch(e) {
    console.error(`[SMS] Failed to send to ${watcher.phone}:`, e.message);
    return false;
  }
}

module.exports = { sendOpenAlert };
