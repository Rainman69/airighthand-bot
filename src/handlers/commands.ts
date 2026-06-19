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
import {
  summarizeRecent,
  setSecretaryMode,
  isSecretaryMode,
  listTodos,
  completeTodo,
  extractActionItems,
} from "../features/secretary.js";
import { recallRelevant } from "../features/memory.js";
import { localize } from "../utils/i18n.js";

export function registerCommands(bot: Bot, env: Env) {
  // ── /start ────────────────────────────────────────────────────────────────
  bot.command("start", async (ctx) => {
    if (ctx.from) {
      await getOrCreateUser(env, ctx.from.id, ctx.from.username, ctx.from.language_code);
    }
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

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.command("help", (ctx) =>
    ctx.reply(localize(ctx.from?.language_code, "help"), { parse_mode: "HTML" })
  );

  // ── /ping ─────────────────────────────────────────────────────────────────
  bot.command("ping", (ctx) => ctx.reply("🏓 pong"));

  // ── /model ────────────────────────────────────────────────────────────────
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
    if (!ctx.from) return;
    await setUserModelPin(env, ctx.from.id, arg as (typeof valid)[number]);
    await ctx.reply(`✅ Model set to <b>${arg}</b>.`, { parse_mode: "HTML" });
  });

  // ── /image ────────────────────────────────────────────────────────────────
  bot.command("image", async (ctx) => {
    const prompt = (ctx.match || "").toString().trim();
    if (!prompt) {
      return ctx.reply("Usage: <code>/image &lt;description&gt;</code>", { parse_mode: "HTML" });
    }
    await ctx.api.sendChatAction(ctx.chat.id, "upload_photo").catch(() => {});
    try {
      const bytes = await generateImage(env, { prompt });
      await ctx.replyWithPhoto(new InputFile(bytes, "image.png"), {
        caption: prompt.length > 200 ? prompt.slice(0, 200) + "…" : prompt,
      });
    } catch (e) {
      await ctx.reply(
        "⚠️ Image generation failed: " + redact(e instanceof Error ? e.message : String(e))
      );
    }
  });

  // ── /tts ──────────────────────────────────────────────────────────────────
  bot.command("tts", async (ctx) => {
    const text = (ctx.match || "").toString().trim();
    if (!text) {
      return ctx.reply("Usage: <code>/tts &lt;text to speak&gt;</code>", { parse_mode: "HTML" });
    }
    await ctx.api.sendChatAction(ctx.chat.id, "record_voice").catch(() => {});
    try {
      const bytes = await synthesize(env, { text });
      const api = BotApi.fromEnv(env);
      await api.upload(
        "sendVoice",
        { chat_id: ctx.chat.id },
        { voice: { bytes, filename: "voice.mp3", type: "audio/mpeg" } }
      );
    } catch (e) {
      await ctx.reply(
        "⚠️ TTS failed: " + redact(e instanceof Error ? e.message : String(e))
      );
    }
  });

  // ── /translate ────────────────────────────────────────────────────────────
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

    const colon = arg.match(/^([a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?)\s*:\s*([\s\S]+)$/);
    const spaced = arg.match(/^([a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?)\s+([\s\S]+)$/);

    if (colon) {
      target = colon[1];
      text = colon[2].trim();
    } else if (repliedText && /^[a-zA-Z]{2,3}(?:[-_][a-zA-Z]{2,4})?$/.test(arg)) {
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

  // ── /remind ───────────────────────────────────────────────────────────────
  bot.command("remind", async (ctx) => {
    const arg = (ctx.match || "").toString().trim();
    const m = arg.match(/^(\S+)\s+(.+)/);
    if (!m) {
      return ctx.reply(
        "Usage: <code>/remind &lt;when&gt; &lt;text&gt;</code>\nExamples:\n" +
          "• <code>/remind 30m drink water</code>\n" +
          "• <code>/remind 2h call mom</code>\n" +
          "• <code>/remind tomorrow 9am stand-up</code>",
        { parse_mode: "HTML" }
      );
    }
    const when = m[1];
    const text = m[2];
    const ts = parseWhen(when);
    if (!ts) {
      return ctx.reply(
        "Couldn't parse time <code>" + when + "</code>.\n" +
          "Use formats like: <code>30m</code>, <code>2h</code>, <code>1d</code>, <code>tomorrow 9am</code>",
        { parse_mode: "HTML" }
      );
    }
    if (!ctx.from) return;
    await env.DB.prepare(
      "INSERT INTO reminders (user_id, chat_id, due_at, text) VALUES (?1, ?2, ?3, ?4)"
    )
      .bind(ctx.from.id, ctx.chat.id, ts, text)
      .run();
    await ctx.reply(
      `⏰ Reminder set!\n<b>When:</b> ${new Date(ts).toUTCString()}\n<b>What:</b> ${text.replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;")}`,
      { parse_mode: "HTML" }
    );
  });

  // ── /reminders ────────────────────────────────────────────────────────────
  bot.command("reminders", async (ctx) => {
    if (!ctx.from) return;
    const r = await env.DB.prepare(
      "SELECT id, due_at, text FROM reminders WHERE user_id = ?1 AND done = 0 ORDER BY due_at ASC LIMIT 10"
    )
      .bind(ctx.from.id)
      .all<{ id: number; due_at: number; text: string }>();
    const rows = r.results ?? [];
    if (!rows.length) {
      return ctx.reply("You have no pending reminders.");
    }
    const list = rows
      .map((row, i) => {
        const dt = new Date(row.due_at).toUTCString();
        const safe = row.text.replace(/[<>&]/g, (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;");
        return `${i + 1}. ⏰ <b>${safe}</b>\n   📅 ${dt}`;
      })
      .join("\n\n");
    await ctx.reply(`<b>Your pending reminders:</b>\n\n${list}`, { parse_mode: "HTML" });
  });

  // ── /summarize ────────────────────────────────────────────────────────────
  bot.command("summarize", async (ctx) => {
    if (!ctx.from) return;
    await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    const text = await summarizeRecent(env, ctx.from.id, 40);
    await ctx.reply(renderForTelegram(text), { parse_mode: "HTML" });
  });

  // ── /recall ───────────────────────────────────────────────────────────────
  bot.command("recall", async (ctx) => {
    if (!ctx.from) return;
    const q = (ctx.match || "").toString().trim();
    const facts = q
      ? await recallRelevant(env, ctx.from.id, q, 8)
      : (
          await env.DB.prepare(
            "SELECT fact FROM memory WHERE user_id = ?1 AND fact NOT LIKE '[TODO]%' ORDER BY id DESC LIMIT 10"
          )
            .bind(ctx.from.id)
            .all<{ fact: string }>()
        ).results?.map((r) => r.fact) ?? [];
    if (!facts.length) {
      return ctx.reply("I don't remember anything specific about you yet.");
    }
    await ctx.reply(
      "<b>🧠 What I remember:</b>\n" + facts.map((f) => "• " + f).join("\n"),
      { parse_mode: "HTML" }
    );
  });

  // ── /forget ───────────────────────────────────────────────────────────────
  bot.command("forget", async (ctx) => {
    if (!ctx.from) return;
    await env.DB.prepare("DELETE FROM memory WHERE user_id = ?1")
      .bind(ctx.from.id)
      .run();
    await ctx.reply("🧽 All long-term memory about you has been erased.");
  });

  // ── /secretary ────────────────────────────────────────────────────────────
  //
  // Secretary mode: the bot behaves as a personal secretary.
  // /secretary on  — enable
  // /secretary off — disable
  // /secretary     — show status + secretary-specific commands
  bot.command("secretary", async (ctx) => {
    if (!ctx.from) return;
    const arg = (ctx.match || "").toString().trim().toLowerCase();

    if (arg === "on") {
      await setSecretaryMode(env, ctx.from.id, true);
      await ctx.reply(
        "📋 <b>Secretary mode ON</b>\n\n" +
          "I'll act as your personal secretary. You can:\n" +
          "• <b>Add tasks:</b> \"add task: review the report\"\n" +
          "• <b>List tasks:</b> /todos\n" +
          "• <b>Done:</b> /done &lt;number&gt;\n" +
          "• <b>Action items:</b> /actions\n" +
          "• <b>Summarize:</b> /summarize\n" +
          "• <b>Reminders:</b> /remind &lt;when&gt; &lt;text&gt;\n\n" +
          "Type <code>/secretary off</code> to go back to normal mode.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (arg === "off") {
      await setSecretaryMode(env, ctx.from.id, false);
      await ctx.reply(
        "Secretary mode disabled. I'm back to normal AI assistant mode.\n" +
          "Type <code>/secretary on</code> to re-enable.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // No arg — show current status
    const on = await isSecretaryMode(env, ctx.from.id);
    const todos = await listTodos(env, ctx.from.id);
    const todoCount = todos.length;

    await ctx.reply(
      `<b>📋 Secretary Mode</b>\n` +
        `Status: ${on ? "✅ <b>ON</b>" : "⭕ <b>OFF</b>"}\n` +
        (todoCount ? `Open tasks: <b>${todoCount}</b>\n` : "") +
        `\n` +
        `<code>/secretary on</code> — enable\n` +
        `<code>/secretary off</code> — disable\n` +
        `<code>/todos</code> — list your tasks\n` +
        `<code>/done &lt;n&gt;</code> — mark task done\n` +
        `<code>/actions</code> — extract action items\n` +
        `<code>/summarize</code> — summarize chat`,
      { parse_mode: "HTML" }
    );
  });

  // ── /todos ────────────────────────────────────────────────────────────────
  bot.command("todos", async (ctx) => {
    if (!ctx.from) return;
    const todos = await listTodos(env, ctx.from.id);
    if (!todos.length) {
      return ctx.reply("✅ No open tasks! Use <code>/secretary on</code> and ask me to add tasks for you.", {
        parse_mode: "HTML",
      });
    }
    const list = todos.map((t, i) => `${i + 1}. ${t}`).join("\n");
    await ctx.reply(
      `<b>📋 Your tasks (${todos.length}):</b>\n\n${list}\n\n` +
        `Use <code>/done &lt;number&gt;</code> to mark one complete.`,
      { parse_mode: "HTML" }
    );
  });

  // ── /done ─────────────────────────────────────────────────────────────────
  bot.command("done", async (ctx) => {
    if (!ctx.from) return;
    const n = parseInt((ctx.match || "").toString().trim(), 10);
    if (isNaN(n) || n < 1) {
      return ctx.reply(
        "Usage: <code>/done &lt;task number&gt;</code>\nSee your tasks with <code>/todos</code>.",
        { parse_mode: "HTML" }
      );
    }
    const ok = await completeTodo(env, ctx.from.id, n);
    if (!ok) {
      return ctx.reply(`No task #${n} found. Use <code>/todos</code> to see your list.`, {
        parse_mode: "HTML",
      });
    }
    await ctx.reply(`✅ Task #${n} marked as done!`);
  });

  // ── /actions ──────────────────────────────────────────────────────────────
  bot.command("actions", async (ctx) => {
    if (!ctx.from) return;
    await ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    const result = await extractActionItems(env, ctx.from.id);
    await ctx.reply(renderForTelegram(result), { parse_mode: "HTML" });
  });

  // ── /poll ─────────────────────────────────────────────────────────────────
  bot.command("poll", async (ctx) => {
    const arg = (ctx.match || "").toString();
    const parts = arg.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) {
      return ctx.reply(
        "Usage: <code>/poll question | option1 | option2 | ...</code>",
        { parse_mode: "HTML" }
      );
    }
    const [question, ...options] = parts;
    if (options.length > 10) {
      return ctx.reply("Maximum 10 options allowed.", { parse_mode: "HTML" });
    }
    await ctx.api.sendPoll(ctx.chat.id, question, options.map((text) => ({ text })), {
      is_anonymous: false,
    });
  });

  // ── /stats (owner only) ───────────────────────────────────────────────────
  bot.command("stats", async (ctx) => {
    if (String(ctx.from?.id) !== env.OWNER_ID) return ctx.reply("Owner only.");
    const totalUsers = await env.DB.prepare("SELECT COUNT(*) as c FROM users").first<{ c: number }>();
    const totalMsgs = await env.DB.prepare("SELECT COUNT(*) as c FROM history").first<{ c: number }>();
    const remind = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM reminders WHERE done=0"
    ).first<{ c: number }>();
    const facts = await env.DB.prepare("SELECT COUNT(*) as c FROM memory").first<{ c: number }>();

    const poolRaw = (await env.KV.get("pool:state:v1", "json")) as
      | { accounts?: Record<string, { ok: number; fail: number; disabled_until: number }> }
      | null;

    const now = Date.now();
    const poolSummary = poolRaw?.accounts
      ? Object.entries(poolRaw.accounts)
          .map(
            ([id, s]) =>
              `• ${id.slice(0, 6)}… ok=${s.ok} fail=${s.fail}` +
              (s.disabled_until > now
                ? ` (cooldown ${Math.round((s.disabled_until - now) / 1000)}s)`
                : "")
          )
          .join("\n")
      : "(no pool state yet)";

    await ctx.reply(
      `<b>📊 Stats</b>\n` +
        `users: <b>${totalUsers?.c ?? 0}</b>\n` +
        `messages: <b>${totalMsgs?.c ?? 0}</b>\n` +
        `memories: <b>${facts?.c ?? 0}</b>\n` +
        `pending reminders: <b>${remind?.c ?? 0}</b>\n\n` +
        `<b>AI pool</b>\n<code>${poolSummary}</code>`,
      { parse_mode: "HTML" }
    );
  });

  // ── Inline button callbacks ───────────────────────────────────────────────
  bot.callbackQuery(/^model:(fast|balanced|heavy|auto)$/, async (ctx) => {
    const pin = ctx.match![1] as "fast" | "balanced" | "heavy" | "auto";
    if (ctx.from) await setUserModelPin(env, ctx.from.id, pin);
    await ctx.answerCallbackQuery({ text: `Model set to: ${pin}` });
  });

  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(localize(ctx.from?.language_code, "help"), { parse_mode: "HTML" });
  });
}

// Re-export for any other handlers that want them.
export { transcribe, describeImage, dispatchDueReminders };
