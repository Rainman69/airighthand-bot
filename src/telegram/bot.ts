// grammY bot construction. Returns a bot instance wired with all handlers.

import { Bot } from "grammy";
import type { Env } from "../env.js";
import { registerCommands } from "../handlers/commands.js";
import { handleText } from "../handlers/message.js";
import { handlePhoto, handleVoice } from "../handlers/media.js";
import { registerInline } from "../handlers/inline.js";
import { registerPayments } from "../handlers/payments.js";
import { log } from "../utils/log.js";
import { redact } from "../utils/secrets.js";

export function buildBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  registerCommands(bot, env);
  registerInline(bot, env);
  registerPayments(bot, env);

  // Photo handler (images sent directly or as replies).
  bot.on(":photo", (ctx) => handlePhoto(ctx, env));

  // Voice / audio handler.
  bot.on([":voice", ":audio"], (ctx) => handleVoice(ctx, env));

  // Default text handler — runs for any text that wasn't a command.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/")) return next();
    await handleText(ctx, env);
  });

  // Handle edited messages the same as new messages (so edits get responses).
  bot.on("edited_message:text", async (ctx) => {
    const text = ctx.editedMessage?.text;
    if (!text || text.startsWith("/")) return;
    // Re-use the normal text handler with the edited message as context.
    // We swap message for editedMessage so handleText reads the right content.
    (ctx as any).message = ctx.editedMessage;
    await handleText(ctx as any, env);
  });

  bot.catch((err) => {
    log.error("bot error", {
      err: redact(err.error instanceof Error ? err.error.message : String(err.error)),
    });
  });

  return bot;
}
