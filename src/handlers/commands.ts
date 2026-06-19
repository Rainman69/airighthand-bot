// Command handlers: /start /help /model /image /tts /remind /summarize /stats etc.

import type { Bot, Context } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import type { Env } from "../env.js";
import { setUserModelPin, getOrCreateUser, getRecentHistory, appendHistory, dueReminders, markReminderDone } from "../storage/d1.js";
import { generateImage } from "../ai/image.js";
import { synthesize, transcribe } from "../ai/audio.js";
import { describeImage } from "../ai/vision.js";
import { chatComplete } from "../ai/chat.js";
import { BotApi } from "../telegram/api.js";
import { renderForTelegram } from "../utils/markdown.js";
import { redact } from "../utils/secrets.js";

const WELCOME = `<b>👋 Welcome to AiRightHand</b>

I'm your AI right hand on Telegram — quick replies, deep analysis, image generation, voice, reminders, and more.

<b>Try:</b>
• Just <i>chat</i> with me — I pick the right model automatically.
• <code>/image a cozy reading nook at golden hour</code>
• <code>/tts Hello world</code>
• <code>/remind 30m drink water</code>
• <code>/model fast | balanced | heavy | auto</code>
• <code>/help</code> — full menu

<i>Powered by Cloudflare Workers AI.</i>`;

const HELP = `<b>Commands</b>

<b>Chat</b>
• Send any text — I'll reply (streaming).
• Send a photo — I'll describe it / answer questions about it.
• Send a voice note — I'll transcribe and respond.

<b>Models</b>
• /model fast — quick replies
• /model balanced — best all-rounder (default for longer prompts)
• /model heavy — deep reasoning with visible thinking
• /model auto — let me choose

<b>Media</b>
• /image &lt;prompt&gt; — generate an image
• /tts &lt;text&gt; — speak it
• Reply to a voice/audio with /transcribe — get text

<b>Secretary</b>
• /remind &lt;when&gt; &lt;text&gt; — e.g. "/remind 2h call mom"
• /summarize — summarize this conversation
• /poll &lt;question&gt; | opt1 | opt2 | ... — quick poll
• /buy — support with Telegram Stars ⭐

<b>Owner only</b>
• /stats — usage and account-pool status`;

export function registerCommands(bot: Bot, env: Env) {
  bot.command("start", async (ctx) => {
    if (ctx.from) await getOrCreateUser(env, ctx.from.id, ctx.from.username, ctx.from.language_code);
    await ctx.reply(WELCOME, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("⚡ Fast", "model:fast")
        .text("⚖️ Balanced", "model:balanced")
        .text("🧠 Heavy", "model:heavy")
        .row()
        .text("ℹ️ Help", "help"),
    });
  });

  bot.command("help", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
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
    const hist = await getRecentHistory(env, ctx.from!.id, 40);
    if (!hist.length) return ctx.reply("Nothing to summarize yet.");
    const r = await chatComplete(env, {
      tier: "balanced",
      messages: [
        { role: "system", content: "Summarize the following conversation in 5–8 bullet points. Be precise." },
        { role: "user", content: hist.map((h) => `${h.role}: ${h.content}`).join("\n\n") },
      ],
    });
    await ctx.reply(renderForTelegram(r.text || "(empty)"), { parse_mode: "HTML" });
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
    const poolRaw = await env.KV.get("pool:state:v1", "json");
    await ctx.reply(
      `<b>📊 Stats</b>\n` +
        `users: <b>${totalUsers?.c ?? 0}</b>\n` +
        `messages: <b>${totalMsgs?.c ?? 0}</b>\n` +
        `pending reminders: <b>${remind?.c ?? 0}</b>\n\n` +
        `<b>AI pool</b>\n<code>${JSON.stringify(poolRaw, null, 2).slice(0, 1500)}</code>`,
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
    await ctx.reply(HELP, { parse_mode: "HTML" });
  });
}

/** Dispatch reminders from cron. */
export async function dispatchDueReminders(env: Env) {
  const r = await dueReminders(env, Date.now());
  if (!r.results?.length) return;
  const api = BotApi.fromEnv(env);
  for (const row of r.results) {
    try {
      await api.call("sendMessage", {
        chat_id: row.chat_id,
        text: `⏰ <b>Reminder:</b> ${row.text}`,
        parse_mode: "HTML",
      });
      await markReminderDone(env, row.id);
    } catch {
      // skip on failure; will retry next minute
    }
  }
}

function parseWhen(s: string): number | null {
  s = s.trim().toLowerCase();
  const m = s.match(/^(\d+)(s|sec|m|min|h|hr|d|day)$/);
  if (m) {
    const n = Number(m[1]);
    const u = m[2];
    const mul = u.startsWith("s") ? 1000 : u.startsWith("m") ? 60_000 : u.startsWith("h") ? 3_600_000 : 86_400_000;
    return Date.now() + n * mul;
  }
  const d = Date.parse(s);
  return isNaN(d) ? null : d;
}

// Re-export for index.ts so cron handler can import from a single place.
export { transcribe, describeImage };
