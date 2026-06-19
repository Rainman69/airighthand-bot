// Secretary-style features: conversation summarisation, note-taking, and chat-admin helpers.
//
// User-facing commands live in `handlers/commands.ts`; this module provides
// reusable building blocks they (and the LLM via tools) can call.

import type { Env } from "../env.js";
import { chatComplete } from "../ai/chat.js";
import { getRecentHistory } from "../storage/d1.js";
import { BotApi } from "../telegram/api.js";
import { redact } from "../utils/secrets.js";
import { log } from "../utils/log.js";

// ── Conversation summarisation ───────────────────────────────────────────────

/** Summarise the last N turns of a user's conversation history. */
export async function summarizeRecent(
  env: Env,
  userId: number,
  turns = 40
): Promise<string> {
  const hist = await getRecentHistory(env, userId, turns);
  if (!hist.length) return "Nothing to summarise yet — send me some messages first!";

  const transcript = hist
    .map((h) => `${h.role.toUpperCase()}: ${redact(h.content).slice(0, 800)}`)
    .join("\n\n");

  try {
    const r = await chatComplete(env, {
      tier: "balanced",
      messages: [
        {
          role: "system",
          content:
            "You produce concise, readable summaries of a user's chat with an AI assistant. " +
            "Output 5–8 bullets covering: topics discussed, decisions/answers given, open questions, and action items. " +
            "Keep it under 1500 characters. Plain text, one bullet per line starting with '• '. " +
            "Don't mention the user in third person — write naturally as if talking to them.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 600,
      temperature: 0.3,
    });
    return r.text.trim() || "Could not produce a summary.";
  } catch (e) {
    log.warn("summarize failed", { err: e instanceof Error ? e.message : String(e) });
    return "⚠️ Summarisation failed — please try again.";
  }
}

// ── Secretary mode ───────────────────────────────────────────────────────────
//
// Secretary mode lets the bot act as a personal secretary for the user:
// - Remembers tasks/to-dos (stored in D1 as memory facts tagged [TODO])
// - Drafts messages, emails, or any text on demand
// - Summarises conversation history
// - Manages reminders
// - Extracts action items from recent chat
//
// It is enabled per-user and stored in KV.

const SEC_KEY = (userId: number) => `secretary:on:${userId}`;

/** Enable/disable secretary mode for a user. */
export async function setSecretaryMode(
  env: Env,
  userId: number,
  on: boolean
): Promise<void> {
  if (on) {
    await env.KV.put(SEC_KEY(userId), "1", { expirationTtl: 60 * 60 * 24 * 90 });
  } else {
    await env.KV.delete(SEC_KEY(userId));
  }
}

/** Check whether secretary mode is active for a user. */
export async function isSecretaryMode(env: Env, userId: number): Promise<boolean> {
  const v = await env.KV.get(SEC_KEY(userId));
  return v === "1";
}

/** Pull open TODO items from the user's memory (tagged with [TODO]). */
export async function listTodos(env: Env, userId: number): Promise<string[]> {
  const r = await env.DB.prepare(
    "SELECT fact FROM memory WHERE user_id = ?1 AND fact LIKE '[TODO]%' ORDER BY id ASC"
  )
    .bind(userId)
    .all<{ fact: string }>();
  return (r.results ?? []).map((row) => row.fact.replace(/^\[TODO\]\s*/, ""));
}

/** Mark a TODO done (deletes the matching memory row). */
export async function completeTodo(
  env: Env,
  userId: number,
  index: number
): Promise<boolean> {
  const todos = await listTodos(env, userId);
  const item = todos[index - 1]; // 1-based
  if (!item) return false;
  await env.DB.prepare(
    "DELETE FROM memory WHERE user_id = ?1 AND fact = ?2"
  )
    .bind(userId, `[TODO] ${item}`)
    .run();
  return true;
}

/** Extract action items from the most recent conversation turns. */
export async function extractActionItems(
  env: Env,
  userId: number
): Promise<string> {
  const hist = await getRecentHistory(env, userId, 20);
  if (!hist.length) return "No recent conversation to analyse.";

  const transcript = hist
    .map((h) => `${h.role.toUpperCase()}: ${redact(h.content).slice(0, 600)}`)
    .join("\n\n");

  try {
    const r = await chatComplete(env, {
      tier: "balanced",
      messages: [
        {
          role: "system",
          content:
            "Extract actionable tasks and commitments from this conversation. " +
            "List only concrete action items (things someone needs to do). " +
            "Format: one item per line, starting with '✅ '. Max 10 items. " +
            "If there are none, say 'No action items found.'",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });
    return r.text.trim() || "No action items found.";
  } catch (e) {
    log.warn("extractActionItems failed", { err: e instanceof Error ? e.message : String(e) });
    return "⚠️ Could not extract action items — please try again.";
  }
}

// ── Bot-admin helpers ─────────────────────────────────────────────────────────

/**
 * Check whether the bot is an administrator in `chat_id`. Used to decide
 * whether to expose chat-admin tools to the model.
 */
export async function botIsAdmin(env: Env, chatId: number): Promise<boolean> {
  try {
    const api = BotApi.fromEnv(env);
    const me = await api.call<{ id: number }>("getMe");
    const member = await api.call<{ status: string }>("getChatMember", {
      chat_id: chatId,
      user_id: me.id,
    });
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}
