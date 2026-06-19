// Command handlers: /start /help /model /image /tts /remind /summarize /stats etc.

import type { Bot } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import type { Env } from "../env.js";
import { setUserModelPin, getOrCreateUser } from "../storage/d1.js";
import { generateImage } from "../ai/image.js";
import { synthesize, transcribe } from "../ai/audio.js";
import { describeImage } from "../ai/vision.js";
import { translate, normalizeLang } from "../ai/translate.js";
import { BotApi } from "../telegram/api.js";
import { renderForTelegram } from "../utils/markdown.js";
import { redact } from "../utils/secrets.js";
import { parseWhen, dispatchDueReminders } from "../features/reminders.js";
import { summarizeRecent } from "../features/secretary.js";
import { recallRelevant } from "../features/memory.js";
import { localize } from "../utils/i18n.js";

// Welcome / help strings live in src/utils/i18n.ts under the keys "welcome" and "help".

export function registerCommands(bot: Bot, env: Env) {
  bot.command("start", async (ctx) => {
    if (ctx.from) await getOrCreateUser(env, ctx.from.id, ctx.from.username, ctx.from.language_code);
    await ctx.reply(localize(ctx.from?.language_code, "welcome"), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("⚡ Fast", "model:fast")
        .text("⚖️ Balanced", "model:balanced")
        .text("🧠 Heavy", "model:heavy")
        .row()
        .text("ℹ️ Help", "help"),
    });
  });

  bot.command("help", (ctx) =>
    ctx.reply(localize(ctx.from?.language_code, "help"), { parse_mode: "HTML" })
  );
  bot.command("ping", (ctx) => ctx.reply("🏓 pong"));

  bot.command("model", async (ctx) => {
    const arg = (ctx.match || "").toString().trim().toLowerCase();
    const valid = ["fast", "balanced", "heavy", "auto"] as const;
    if (!valid.includes(arg as (typeof valid)[number])) {
      await ctx.reply(
        "Usage: <code>/model fast|balanced|heavy|auto</code>",
        { parse_mode: "HTML" }
      );
      return;
    }
    await setUserModelPin(env, ctx.from!.id, arg as (typeof valid)[number]);
    await ctx.reply(`✅ Model set to <b>${arg}</b>.`, { parse_mode: "HTML" });
  });

  bot.command("image", async (ctx) => {
    const prompt = (ctx.match || "").toString().trim();
    if (!prompt) return ctx.reply("Usage: <code>/image a description</code>", { parse_mode: "HTML" });
    await ctx.api.sendChatAction(ctx.chat.id, "upload_photo").catch(() => {});
    try {
      const bytes = await generateImage(env, { prompt });
      await ctx.replyWithPhoto(new InputFile(bytes, "image.png"), {
        caption: prompt.length > 200 ? prompt.slice(0, 200) + "…" : prompt,
      });
    } catch (e) {
      await ctx.reply("⚠️ Image generation failed: " + redact(e instanceof Error ? e.message : String(e)));
    }
  });

  bot.command("tts", async (ctx) => {
    const text = (ctx.match || "").toString().trim();
    if (!text) return ctx.reply("Usage: <code>/tts text to speak</code>", { parse_mode: "HTML" });
    await ctx.api.sendChatAction(ctx.chat.id, "record_voice").catch(() => {});
    try {
      const bytes = await synthesize(env, { text });
      const api = BotApi.fromEnv(env);
      await api.upload("sendVoice", { chat_id: ctx.chat.id }, {
        voice: { bytes, filename: "voice.mp3", type: "audio/mpeg" },
      });
    } catch (e) {
      await ctx.reply("⚠️ TTS failed: " + redact(e instanceof Error ? e.message : String(e)));
    }
  });

  // /translate — direct m2m100 translation (cheaper than going through the chat tier).
  //
  // Accepted shapes:
  //   /translate to fa: Hello world
  //   /translate fa: Hello world
  //   /translate fa Hello world
  //   /translate Hello world           → translates to English (or user's locale if English)
  //   /translate [lang]                → as a reply: translates the replied-to message
  bot.command("translate", async (ctx) => {
    let arg = (ctx.match || "").toString().trim();
    const repliedText =
      ctx.message?.reply_to_message?.text ??
      ctx.message?.reply_to_message?.caption ??
      "";

    // Strip a leading "to " for natural phrasing.
    arg = arg.replace(/^to\s+/i, "");

    let target: string | undefined;
    let text = "";

    // Try "code: rest" or "code rest"
    const colon = arg.match(/^([a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?)\s*:\s*([\s\S]+)$/);
    const spaced = arg.match(/^([a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?)\s+([\s\S]+)$/);

    if (colon) {
      target = colon[1];
      text = colon[2].trim();
    } else if (repliedText && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?$/.test(arg)) {
      // Reply mode: argument is just a language code.
      target = arg;
      text = repliedText;
    } else if (spaced && repliedText.length === 0) {
      target = spaced[1];
      text = spaced[2].trim();
    } else if (arg) {
      text = arg;
    } else if (repliedText) {
      text = repliedText;
    }

    if (!text) {
      return ctx.reply(
        "Usage: <code>/translate &lt;lang&gt;: text</code>\n" +
          "Examples:\n" +
          "• <code>/translate fa: Hello world</code>\n" +
          "• <code>/translate to en: سلام دنیا</code>\n" +
          "• Reply to a message with <code>/translate fa</code>",
        { parse_mode: "HTML" }
      );
    }

    // Default target: English, unless the user's interface is English — then default to Persian
    // as a sensible "other" direction. The user can always specify explicitly.
    if (!target) {
      target = (ctx.from?.language_code ?? "").toLowerCase().startsWith("en") ? "fa" : "en";
    }

    await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    try {
      const out = await translate(env, { text, target });
      if (!out) return ctx.reply("⚠️ Translation returned no text.");
      const targetLabel = normalizeLang(target);
      await ctx.reply(
        `🌐 <b>${targetLabel}</b>\n${out.replace(/[<>&]/g, (c) =>
          c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
        )}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      await ctx.reply(
        "⚠️ Translation failed: " + redact(e instanceof Error ? e.message : String(e))
      );
    }
  });

  bot.command("remind", async (ctx) => {
    const arg = (ctx.match || "").toString().trim();
    const m = arg.match(/^(\S+)\s+(.+)/);
    if (!m) return ctx.reply("Usage: <code>/remind 30m drink water</code>", { parse_mode: "HTML" });
    const when = m[1];
    const text = m[2];
    const ts = parseWhen(when);
    if (!ts) return ctx.reply("Couldn't parse <code>" + when + "</code>", { parse_mode: "HTML" });
    await env.DB.prepare(
      "INSERT INTO reminders (user_id, chat_id, due_at, text) VALUES (?1, ?2, ?3, ?4)"
    ).bind(ctx.from!.id, ctx.chat.id, ts, text).run();
    await ctx.reply(`⏰ Reminder set for <b>${new Date(ts).toUTCString()}</b>.`, { parse_mode: "HTML" });
  });

  bot.command("summarize", async (ctx) => {
    const text = await summarizeRecent(env, ctx.from!.id, 40);
    await ctx.reply(renderForTelegram(text), { parse_mode: "HTML" });
  });

  bot.command("recall", async (ctx) => {
    const q = (ctx.match || "").toString().trim();
    const facts = q
      ? await recallRelevant(env, ctx.from!.id, q, 8)
      : (await env.DB.prepare(
          "SELECT fact FROM memory WHERE user_id = ?1 ORDER BY id DESC LIMIT 10"
        )
          .bind(ctx.from!.id)
          .all<{ fact: string }>()).results?.map((r) => r.fact) ?? [];
    if (!facts.length) return ctx.reply("I don't remember anything specific about you yet.");
    await ctx.reply(
      "<b>🧠 What I remember:</b>\n" + facts.map((f) => "• " + f).join("\n"),
      { parse_mode: "HTML" }
    );
  });

  bot.command("forget", async (ctx) => {
    await env.DB.prepare("DELETE FROM memory WHERE user_id = ?1")
      .bind(ctx.from!.id)
      .run();
    await ctx.reply("🧽 All long-term memory about you has been erased.");
  });

  // /relay @other_bot some text — copy `text` to a chat where both bots are present.
  // Bot-to-bot DMs aren't allowed by Telegram, so this expects to be used inside
  // a group/channel the user has added both bots to; the relay is just a normal
  // sendMessage to the current chat that @-mentions the target bot.
  bot.command("relay", async (ctx) => {
    const arg = (ctx.match || "").toString().trim();
    const m = arg.match(/^(@\w{3,})\s+([\s\S]+)/);
    if (!m) return ctx.reply("Usage: <code>/relay @target_bot your message</code>", { parse_mode: "HTML" });
    const target = m[1];
    const text = m[2];
    await ctx.reply(`${target} ${text}`, {
      reply_parameters: { message_id: ctx.message!.message_id },
    });
  });

  bot.command("poll", async (ctx) => {
    const arg = (ctx.match || "").toString();
    const parts = arg.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) {
      return ctx.reply("Usage: <code>/poll question | option1 | option2 | ...</code>", { parse_mode: "HTML" });
    }
    const [question, ...options] = parts;
    await ctx.api.sendPoll(ctx.chat.id, question, options.map((text) => ({ text })), {
      is_anonymous: false,
    });
  });

  bot.command("buy", async (ctx) => {
    await ctx.api.sendInvoice(
      ctx.chat.id,
      "AiRightHand Pro — 1 month",
      "Higher rate limits, priority access to the heavy reasoning model, and early features.",
      "stars:pro:1m",
      "XTR",
      [{ label: "Pro – 1 month", amount: 50 }]
    );
  });

  bot.command("stats", async (ctx) => {
    if (String(ctx.from?.id) !== env.OWNER_ID) return ctx.reply("Owner only.");
    const totalUsers = await env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    const totalMsgs = await env.DB.prepare("SELECT COUNT(*) as c FROM history").first<{ c: number }>();
    const remind = await env.DB.prepare("SELECT COUNT(*) as c FROM reminders WHERE done=0").first<{ c: number }>();
    const facts = await env.DB.prepare("SELECT COUNT(*) as c FROM memory").first<{ c: number }>();
    const proUsers = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM users WHERE is_pro = 1 AND (pro_until IS NULL OR pro_until > ?1)"
    )
      .bind(Date.now())
      .first<{ c: number }>();
    const poolRaw = (await env.KV.get("pool:state:v1", "json")) as
      | { accounts?: Record<string, { ok: number; fail: number; disabled_until: number }> }
      | null;

    const now = Date.now();
    const poolSummary = poolRaw?.accounts
      ? Object.entries(poolRaw.accounts)
          .map(
            ([id, s]) =>
              `• ${id.slice(0, 6)}… ok=${s.ok} fail=${s.fail}` +
              (s.disabled_until > now ? ` (cooldown ${Math.round((s.disabled_until - now) / 1000)}s)` : "")
          )
          .join("\n")
      : "(no pool state yet)";

    await ctx.reply(
      `<b>📊 Stats</b>\n` +
        `users: <b>${totalUsers?.c ?? 0}</b> (pro: ${proUsers?.c ?? 0})\n` +
        `messages: <b>${totalMsgs?.c ?? 0}</b>\n` +
        `memories: <b>${facts?.c ?? 0}</b>\n` +
        `pending reminders: <b>${remind?.c ?? 0}</b>\n\n` +
        `<b>AI pool</b>\n<code>${poolSummary}</code>`,
      { parse_mode: "HTML" }
    );
  });

  bot.callbackQuery(/^model:(fast|balanced|heavy|auto)$/, async (ctx) => {
    const pin = ctx.match![1] as "fast" | "balanced" | "heavy" | "auto";
    await setUserModelPin(env, ctx.from.id, pin);
    await ctx.answerCallbackQuery({ text: `Model: ${pin}` });
  });

  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(localize(ctx.from?.language_code, "help"), { parse_mode: "HTML" });
  });
}

// Re-export for any other handlers that want them.
export { transcribe, describeImage, dispatchDueReminders };
