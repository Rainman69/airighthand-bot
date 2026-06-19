// Inline mode handler — `@AiRightHand_bot <query>` in any chat.

import type { Bot } from "grammy";
import type { Env } from "../env.js";
import { chatComplete } from "../ai/chat.js";
import { redact } from "../utils/secrets.js";

export function registerInline(bot: Bot, env: Env) {
  bot.on("inline_query", async (ctx) => {
    const q = ctx.inlineQuery.query.trim();
    if (!q) {
      await ctx.answerInlineQuery([], { cache_time: 5 });
      return;
    }

    // Short cache so repeated typing doesn't hammer the model.
    const cacheKey = "inline:" + q.toLowerCase().slice(0, 120);
    const cached = await env.KV.get(cacheKey);
    let answer = cached;
    if (!answer) {
      const r = await chatComplete(env, {
        tier: "fast",
        messages: [
          { role: "system", content: "Answer in <= 3 short sentences. Plain text only." },
          { role: "user", content: q },
        ],
        max_tokens: 200,
      });
      answer = redact(r.text || "(no answer)");
      await env.KV.put(cacheKey, answer, { expirationTtl: 300 });
    }

    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "ans",
          title: "💡 " + q.slice(0, 64),
          description: answer.slice(0, 200),
          input_message_content: { message_text: answer.slice(0, 4000) },
        },
      ],
      { cache_time: 30 }
    );
  });
}
