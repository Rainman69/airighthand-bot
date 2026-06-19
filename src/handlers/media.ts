// Handles incoming photos and voice notes — runs them through Vision / Whisper
// and then feeds the transcript/description into the regular chat flow.

import type { Context } from "grammy";
import type { Env } from "../env.js";
import { BotApi } from "../telegram/api.js";
import { describeImage } from "../ai/vision.js";
import { transcribe } from "../ai/audio.js";
import { renderForTelegram } from "../utils/markdown.js";
import { redact } from "../utils/secrets.js";

export async function handlePhoto(ctx: Context, env: Env): Promise<void> {
  const photos = ctx.message?.photo;
  if (!photos?.length) return;
  const best = photos[photos.length - 1];
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});

  const api = BotApi.fromEnv(env);
  try {
    const bytes = await api.download(best.file_id);
    const prompt = (ctx.message?.caption || "Describe this image in detail.").slice(0, 800);
    const desc = await describeImage(env, { imageBytes: bytes, prompt });
    await ctx.reply(renderForTelegram(redact(desc || "(no description)")), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply("⚠️ Vision failed: " + redact(e instanceof Error ? e.message : String(e)));
  }
}

export async function handleVoice(ctx: Context, env: Env): Promise<void> {
  const v = ctx.message?.voice || ctx.message?.audio;
  if (!v) return;
  const api = BotApi.fromEnv(env);
  await ctx.api.sendChatAction(ctx.chat!.id, "typing").catch(() => {});
  try {
    const bytes = await api.download(v.file_id);
    const text = await transcribe(env, bytes);
    if (!text) return void (await ctx.reply("(could not transcribe)"));
    await ctx.reply(`📝 <i>${renderForTelegram(text)}</i>`, { parse_mode: "HTML" });
    // Re-inject as a normal text message so the chat handler answers it.
    // We import lazily to avoid circular deps.
    const { handleText } = await import("./message.js");
    // Synthesize a virtual context message.
    (ctx.message as any).text = text;
    await handleText(ctx, env);
  } catch (e) {
    await ctx.reply("⚠️ STT failed: " + redact(e instanceof Error ? e.message : String(e)));
  }
}
