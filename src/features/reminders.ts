// Reminder dispatcher — woken by the cron trigger every minute.
//
// Reminders are inserted by:
//   - the `/remind <when> <text>` command (`handlers/commands.ts`)
//   - the `schedule_reminder` tool when the LLM calls it
//
// This module owns the *dispatch* side: pull due reminders, send the message,
// mark them done. Insertion lives next to its callers because it's a one-liner.

import type { Env } from "../env.js";
import { dueReminders, markReminderDone } from "../storage/d1.js";
import { BotApi } from "../telegram/api.js";
import { log } from "../utils/log.js";
import { redact } from "../utils/secrets.js";

/** Send all reminders whose `due_at <= now`. Safe to call repeatedly. */
export async function dispatchDueReminders(env: Env): Promise<void> {
  const r = await dueReminders(env, Date.now());
  const rows = r.results ?? [];
  if (!rows.length) return;

  const api = BotApi.fromEnv(env);
  for (const row of rows) {
    try {
      await api.call("sendMessage", {
        chat_id: row.chat_id,
        text: `⏰ <b>Reminder:</b> ${escapeHtml(row.text)}`,
        parse_mode: "HTML",
      });
      await markReminderDone(env, row.id);
    } catch (e) {
      // Don't mark done — we'll retry next minute. But log so we notice
      // permanent failures (chat blocked the bot, etc.).
      log.warn("reminder dispatch failed", {
        id: row.id,
        chat_id: row.chat_id,
        err: redact(e instanceof Error ? e.message : String(e)),
      });
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
  );
}

/** Tiny duration / ISO-date parser used by both the command and the tool. */
export function parseWhen(s: string): number | null {
  const trimmed = s.trim().toLowerCase();
  // "30m", "in 2h", "1d", "45 min"
  const m = trimmed.match(/^(?:in\s+)?(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const mul =
      unit.startsWith("s") ? 1000 :
      unit.startsWith("m") ? 60_000 :
      unit.startsWith("h") ? 3_600_000 :
      86_400_000;
    return Date.now() + n * mul;
  }
  // "tomorrow 9am" — keep this best-effort; Date.parse handles many ISO forms.
  if (/^tomorrow\b/.test(trimmed)) {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    // If a time was specified, try to parse it.
    const t = trimmed.replace(/^tomorrow\s*/, "").trim();
    if (t) {
      const parsed = Date.parse(`${next.toDateString()} ${t}`);
      if (!isNaN(parsed)) return parsed;
    }
    return next.getTime();
  }
  const d = Date.parse(s);
  return isNaN(d) ? null : d;
}
