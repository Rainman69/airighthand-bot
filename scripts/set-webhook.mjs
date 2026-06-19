#!/usr/bin/env node
// Register the Telegram webhook against the deployed Worker.
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WORKER_URL=https://… node scripts/set-webhook.mjs

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const worker = process.env.WORKER_URL;

if (!token || !secret || !worker) {
  console.error("Missing TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / WORKER_URL");
  process.exit(1);
}

const url = `${worker.replace(/\/$/, "")}/webhook`;
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: [
      "message",
      "edited_message",
      "callback_query",
      "inline_query",
      "pre_checkout_query",
      "message_reaction",
    ],
    drop_pending_updates: false,
  }),
});
console.log(res.status, await res.text());
