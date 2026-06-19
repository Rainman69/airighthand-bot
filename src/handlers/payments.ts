// Telegram Stars payment flow handlers.

import type { Bot } from "grammy";
import type { Env } from "../env.js";

export function registerPayments(bot: Bot, env: Env) {
  bot.on("pre_checkout_query", async (ctx) => {
    // Always approve — we built the invoice ourselves.
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on(":successful_payment", async (ctx) => {
    const payload = ctx.message?.successful_payment?.invoice_payload || "";
    const userId = ctx.from?.id;
    if (!userId) return;

    if (payload.startsWith("stars:pro")) {
      const until = Date.now() + 30 * 24 * 3600 * 1000;
      await env.DB.prepare(
        "UPDATE users SET is_pro = 1, pro_until = ?1 WHERE user_id = ?2"
      )
        .bind(until, userId)
        .run();
      await ctx.reply(
        "✨ <b>Welcome to AiRightHand Pro!</b>\nThanks for the support. Your perks are active for 30 days.",
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.reply("⭐ Thanks for the tip!");
    }
  });
}
