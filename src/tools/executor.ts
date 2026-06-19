// Safe tool executor. The LLM emits `tool_calls`; we validate, gate, and run
// them, then feed the result back into the conversation as a `role: "tool"`
// message.

import type { Env } from "../env.js";
import type { ToolCall } from "../ai/chat.js";
import { BotApi } from "../telegram/api.js";
import { TOOL_NAMES } from "./registry.js";
import { generateImage } from "../ai/image.js";
import { synthesize } from "../ai/audio.js";
import { log } from "../utils/log.js";
import { redact } from "../utils/secrets.js";

export interface ExecCtx {
  env: Env;
  api: BotApi;
  /** Telegram user id of the caller. */
  userId: number;
  /** Default chat id (where the original message came from). */
  chatId: number;
  /** Original message id of the user's message (used as default reply target). */
  messageId?: number;
  /** Whether this user is the bot owner. */
  isOwner: boolean;
}

const ADMIN_METHODS = new Set([
  "ban_chat_member",
  "restrict_chat_member",
  "promote_chat_member",
  "delete_message", // when target isn't bot's own — checked separately
]);

interface Result {
  /** Stringified JSON to feed back to the model. */
  content: string;
  /** Side effect already happened (true unless we refused). */
  ok: boolean;
}

export async function executeTool(ctx: ExecCtx, call: ToolCall): Promise<Result> {
  const name = call.function.name;
  if (!TOOL_NAMES.has(name)) {
    return { ok: false, content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch {
    return { ok: false, content: JSON.stringify({ error: "Invalid JSON arguments" }) };
  }

  // Default chat_id to the current chat if omitted
  if (args.chat_id == null) args.chat_id = ctx.chatId;

  // Owner-gate destructive admin operations.
  if (ADMIN_METHODS.has(name) && !ctx.isOwner) {
    return {
      ok: false,
      content: JSON.stringify({ error: "Admin tool requires owner privileges." }),
    };
  }

  try {
    const result = await dispatch(ctx, name, args);
    return { ok: true, content: JSON.stringify({ ok: true, result: trim(result) }) };
  } catch (e) {
    const msg = redact(e instanceof Error ? e.message : String(e));
    log.warn("tool failed", { tool: name, err: msg });
    return { ok: false, content: JSON.stringify({ ok: false, error: msg }) };
  }
}

function trim(v: unknown): unknown {
  // Avoid stuffing huge objects back into the prompt.
  const s = JSON.stringify(v);
  if (!s || s.length < 800) return v;
  return s.slice(0, 800) + "…";
}

async function dispatch(
  ctx: ExecCtx,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const { api, env } = ctx;
  switch (name) {
    case "send_message":
      return api.call("sendMessage", { parse_mode: "HTML", ...args });
    case "edit_message_text":
      return api.call("editMessageText", { parse_mode: "HTML", ...args });
    case "delete_message":
      return api.call("deleteMessage", args);
    case "copy_message":
      return api.call("copyMessage", args);
    case "forward_message":
      return api.call("forwardMessage", args);
    case "pin_chat_message":
      return api.call("pinChatMessage", args);

    case "set_message_reaction": {
      const r =
        args.custom_emoji_id != null
          ? { type: "custom_emoji", custom_emoji_id: args.custom_emoji_id }
          : { type: "emoji", emoji: (args.emoji as string) ?? "👍" };
      return api.call("setMessageReaction", {
        chat_id: args.chat_id,
        message_id: args.message_id ?? ctx.messageId,
        reaction: [r],
        is_big: args.is_big ?? false,
      });
    }

    case "send_chat_action":
      return api.call("sendChatAction", args);

    case "send_dice":
      return api.call("sendDice", args);

    case "send_poll":
      return api.call("sendPoll", args);

    case "generate_image": {
      const bytes = await generateImage(env, { prompt: args.prompt as string });
      return api.upload(
        "sendPhoto",
        {
          chat_id: args.chat_id as number,
          caption: (args.caption as string) ?? "",
        },
        { photo: { bytes, filename: "image.png", type: "image/png" } }
      );
    }

    case "text_to_speech": {
      const bytes = await synthesize(env, {
        text: args.text as string,
        lang: (args.lang as "en") ?? "en",
      });
      return api.upload(
        "sendVoice",
        { chat_id: args.chat_id as number },
        { voice: { bytes, filename: "voice.mp3", type: "audio/mpeg" } }
      );
    }

    case "ban_chat_member":
      return api.call("banChatMember", args);
    case "restrict_chat_member":
      return api.call("restrictChatMember", args);
    case "promote_chat_member":
      return api.call("promoteChatMember", args);

    case "create_stars_invoice":
      return api.call("sendInvoice", {
        chat_id: args.chat_id,
        title: args.title,
        description: args.description,
        payload: `stars:${args.payload ?? "tip"}`,
        provider_token: "", // empty for Telegram Stars
        currency: "XTR",
        prices: args.prices,
      });

    case "schedule_reminder": {
      const ts = parseWhen(args.when as string);
      if (!ts) throw new Error("Could not parse 'when'");
      await env.DB.prepare(
        "INSERT INTO reminders (user_id, chat_id, due_at, text) VALUES (?1, ?2, ?3, ?4)"
      )
        .bind(ctx.userId, ctx.chatId, ts, args.text)
        .run();
      return { scheduled_for: new Date(ts).toISOString() };
    }

    case "remember_fact": {
      await env.DB.prepare(
        "INSERT INTO memory (user_id, fact, created_at) VALUES (?1, ?2, ?3)"
      )
        .bind(ctx.userId, args.fact, Date.now())
        .run();
      return { saved: true };
    }
  }
  throw new Error("Unimplemented tool: " + name);
}

/** Very lightweight 'in 2h' / 'in 30m' / ISO date parser. */
function parseWhen(s: string): number | null {
  s = s.trim().toLowerCase();
  const m = s.match(/^(?:in\s+)?(\d+)\s*(s|sec|m|min|h|hr|d|day)/);
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
  const d = Date.parse(s);
  if (!isNaN(d)) return d;
  return null;
}
