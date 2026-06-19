// Secretary-style features: conversation summarisation and chat-admin probing.
//
// The user-facing /summarize and /poll commands live in `handlers/commands.ts`;
// this module provides reusable building blocks they (and the LLM via tools)
// can call.

import type { Env } from "../env.js";
import { chatComplete } from "../ai/chat.js";
import { getRecentHistory } from "../storage/d1.js";
import { BotApi } from "../telegram/api.js";
import { redact } from "../utils/secrets.js";

/** Summarise the last N turns of a user's conversation history. */
export async function summarizeRecent(
  env: Env,
  userId: number,
  turns = 40
): Promise<string> {
  const hist = await getRecentHistory(env, userId, turns);
  if (!hist.length) return "(nothing to summarise yet)";

  const transcript = hist
    .map((h) => `${h.role.toUpperCase()}: ${redact(h.content).slice(0, 800)}`)
    .join("\n\n");

  const r = await chatComplete(env, {
    tier: "balanced",
    messages: [
      {
        role: "system",
        content:
          "You produce concise meeting-style summaries of a single user's chat with an AI assistant. " +
          "Output 5–8 bullets capturing: topics discussed, decisions/answers, open questions, action items. " +
          "Keep it under 1500 characters. Plain text, one bullet per line, starting with '• '.",
      },
      { role: "user", content: transcript },
    ],
    max_tokens: 600,
    temperature: 0.3,
  });
  return r.text || "(empty summary)";
}

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
