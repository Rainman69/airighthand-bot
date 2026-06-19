// UI helpers for reactions, premium emoji, chat actions and message effects.

import type { BotApi } from "./api.js";

export const CHAT_ACTIONS = [
  "typing",
  "upload_photo",
  "record_video",
  "upload_video",
  "record_voice",
  "upload_voice",
  "upload_document",
  "choose_sticker",
  "find_location",
  "record_video_note",
  "upload_video_note",
] as const;

export type ChatAction = (typeof CHAT_ACTIONS)[number];

export async function sendAction(api: BotApi, chat_id: number, action: ChatAction) {
  return api.call("sendChatAction", { chat_id, action });
}

/** Set a single emoji reaction. Standard or custom (premium). */
export async function react(
  api: BotApi,
  chat_id: number,
  message_id: number,
  reaction: { emoji?: string; custom_emoji_id?: string },
  is_big = false
) {
  const r =
    reaction.custom_emoji_id != null
      ? { type: "custom_emoji", custom_emoji_id: reaction.custom_emoji_id }
      : { type: "emoji", emoji: reaction.emoji ?? "👍" };
  return api.call("setMessageReaction", {
    chat_id,
    message_id,
    reaction: [r],
    is_big,
  });
}

/**
 * Message effect IDs ("balloons", "fireworks", "confetti", "thumbs up",
 * "heart", "poop"). Values from Telegram's published effect catalog.
 */
export const EFFECT_IDS = {
  fire: "5104841245755180586",
  thumbs_up: "5107584321108051014",
  thumbs_down: "5104858069142078462",
  heart: "5044134455711629726",
  confetti: "5046509860389126442",
  poop: "5046589136895476101",
} as const;

export type EffectName = keyof typeof EFFECT_IDS;
