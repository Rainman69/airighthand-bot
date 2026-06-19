// Cloudflare Worker entry point.
//
// Routes:
//   GET  /                            — health check
//   POST /webhook                     — Telegram webhook (validates secret token)
//   POST /admin/set-webhook?url=…     — owner-only utility (header X-Owner-Token)
//
// Cron trigger (every minute) — dispatches due reminders.

import { Hono } from "hono";
import { webhookCallback } from "grammy";
import type { Env } from "./env.js";
import { buildBot } from "./telegram/bot.js";
import { dispatchDueReminders } from "./features/reminders.js";
import { initDB } from "./storage/d1.js";
import { log } from "./utils/log.js";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("AiRightHand is awake. 🤖"));

app.post("/webhook", async (c) => {
  // Telegram secret-token check (set when calling setWebhook).
  const provided = c.req.header("x-telegram-bot-api-secret-token");
  if (provided !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text("forbidden", 403);
  }
  await initDB(c.env);
  const bot = buildBot(c.env);
  const handle = webhookCallback(bot, "hono");
  return handle(c);
});

/**
 * Owner-only convenience endpoint to (re)register the webhook with Telegram.
 * Call: curl -X POST -H "x-owner-id: <OWNER_ID>" "$WORKER/admin/set-webhook?url=https://…/webhook"
 */
app.post("/admin/set-webhook", async (c) => {
  if (c.req.header("x-owner-id") !== c.env.OWNER_ID) return c.text("forbidden", 403);
  const url = c.req.query("url");
  if (!url) return c.text("missing url", 400);
  const r = await fetch(
    `https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: c.env.TELEGRAM_WEBHOOK_SECRET,
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
    }
  );
  return c.text(await r.text(), r.status as 200);
});

export default {
  fetch: app.fetch,
  async scheduled(_ev: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await initDB(env);
      await dispatchDueReminders(env);
    } catch (e) {
      log.error("cron failed", { err: e instanceof Error ? e.message : String(e) });
    }
  },
};
