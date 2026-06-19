// JSON-Schema tool definitions exposed to the LLM. Anything in this list can be
// called autonomously by the model (subject to the allow-list / permission check
// in `executor.ts`). To grant the model freedom over a new Bot API method, just
// add it here.

import type { ChatTool } from "../ai/chat.js";

const T = (name: string, description: string, parameters: object): ChatTool => ({
  type: "function",
  function: { name, description, parameters },
});

const obj = (props: Record<string, object>, required: string[] = []) => ({
  type: "object",
  additionalProperties: true, // allow the model to pass extra Bot API fields
  properties: props,
  required,
});
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: object, description?: string) => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

export const TOOLS: ChatTool[] = [
  // ─── Messaging ─────────────────────────────────────────────────────────────
  T(
    "send_message",
    "Send a text message. Supports parse_mode='HTML'. Use this for normal replies; for streaming replies you don't need to call this — the framework handles them. Use this only for additional messages.",
    obj(
      {
        chat_id: num("Telegram chat id"),
        text: str("Message text. HTML allowed if parse_mode='HTML'."),
        parse_mode: str("Optional: 'HTML' or 'MarkdownV2'"),
        reply_to_message_id: num("Optional message to reply to"),
        message_effect_id: str("Optional Telegram message effect id (e.g. fireworks)"),
        disable_notification: bool("Send silently"),
      },
      ["chat_id", "text"]
    )
  ),
  T(
    "edit_message_text",
    "Edit a message previously sent by the bot.",
    obj(
      {
        chat_id: num(),
        message_id: num(),
        text: str(),
        parse_mode: str(),
      },
      ["chat_id", "message_id", "text"]
    )
  ),
  T(
    "delete_message",
    "Delete a message. Only allowed for the bot's own messages, or in chats where the bot is an admin.",
    obj({ chat_id: num(), message_id: num() }, ["chat_id", "message_id"])
  ),
  T(
    "copy_message",
    "Copy a message from one chat to another.",
    obj(
      {
        chat_id: num("destination"),
        from_chat_id: num("source"),
        message_id: num(),
      },
      ["chat_id", "from_chat_id", "message_id"]
    )
  ),
  T(
    "forward_message",
    "Forward a message (keeps the original author header).",
    obj(
      {
        chat_id: num("destination"),
        from_chat_id: num("source"),
        message_id: num(),
      },
      ["chat_id", "from_chat_id", "message_id"]
    )
  ),
  T(
    "pin_chat_message",
    "Pin a message in the chat.",
    obj(
      {
        chat_id: num(),
        message_id: num(),
        disable_notification: bool(),
      },
      ["chat_id", "message_id"]
    )
  ),

  // ─── Reactions & effects (Premium Emoji included) ──────────────────────────
  T(
    "set_message_reaction",
    "React to a message with one emoji. Standard emoji via `emoji`, or premium/custom via `custom_emoji_id`.",
    obj(
      {
        chat_id: num(),
        message_id: num(),
        emoji: str("Standard reaction emoji, e.g. '🔥'"),
        custom_emoji_id: str("Custom (premium) emoji id"),
        is_big: bool("Use the big animated variant"),
      },
      ["chat_id", "message_id"]
    )
  ),
  T(
    "send_chat_action",
    "Show a 'typing…' or 'uploading photo…' status to the user.",
    obj(
      {
        chat_id: num(),
        action: str("One of: typing, upload_photo, record_video, upload_video, record_voice, upload_voice, upload_document, choose_sticker, find_location, record_video_note, upload_video_note"),
      },
      ["chat_id", "action"]
    )
  ),

  // ─── Media ─────────────────────────────────────────────────────────────────
  T(
    "send_dice",
    "Send an animated emoji (🎲 🎯 🏀 ⚽ 🎳 🎰).",
    obj(
      {
        chat_id: num(),
        emoji: str("One of 🎲 🎯 🏀 ⚽ 🎳 🎰"),
      },
      ["chat_id"]
    )
  ),

  // ─── Polls ─────────────────────────────────────────────────────────────────
  T(
    "send_poll",
    "Send a poll to a chat.",
    obj(
      {
        chat_id: num(),
        question: str(),
        options: arr({ type: "string" }, "2–12 options"),
        is_anonymous: bool(),
        type: str("'regular' or 'quiz'"),
        correct_option_id: num("For quiz polls: index of the correct answer"),
        explanation: str("For quiz polls"),
        allows_multiple_answers: bool(),
      },
      ["chat_id", "question", "options"]
    )
  ),

  // ─── Generation tools (delegated to our AI layer, not Bot API) ─────────────
  T(
    "generate_image",
    "Generate an image from a text prompt using FLUX.1 schnell, then send it to the chat.",
    obj(
      {
        chat_id: num(),
        prompt: str("Detailed image description (English works best)"),
        caption: str("Optional caption"),
      },
      ["chat_id", "prompt"]
    )
  ),
  T(
    "text_to_speech",
    "Synthesize speech with MeloTTS and send it as a voice message.",
    obj(
      {
        chat_id: num(),
        text: str(),
        lang: str("en, es, fr, zh, jp, kr — default en"),
      },
      ["chat_id", "text"]
    )
  ),

  // ─── Chat administration (gated server-side) ───────────────────────────────
  T(
    "ban_chat_member",
    "Ban a member from a chat. Requires bot to be admin. Owner-only when targeting non-owner users for safety.",
    obj({ chat_id: num(), user_id: num(), until_date: num() }, ["chat_id", "user_id"])
  ),
  T(
    "restrict_chat_member",
    "Restrict a member. `permissions` is a Telegram ChatPermissions object.",
    obj(
      {
        chat_id: num(),
        user_id: num(),
        permissions: { type: "object", additionalProperties: true },
        until_date: num(),
      },
      ["chat_id", "user_id", "permissions"]
    )
  ),
  T(
    "promote_chat_member",
    "Promote/demote a member. All admin-right booleans are optional.",
    obj({ chat_id: num(), user_id: num() }, ["chat_id", "user_id"])
  ),

  // ─── Payments (Stars) ──────────────────────────────────────────────────────
  T(
    "create_stars_invoice",
    "Send a Telegram Stars invoice. Currency is fixed to XTR; provider_token is empty for Stars.",
    obj(
      {
        chat_id: num(),
        title: str(),
        description: str(),
        payload: str("Internal payload (we'll prefix it with 'stars:')"),
        prices: arr(
          obj({ label: str(), amount: num("Stars amount (integer)") }, ["label", "amount"]),
          "One or more LabeledPrice entries"
        ),
      },
      ["chat_id", "title", "description", "payload", "prices"]
    )
  ),

  // ─── Reminders & memory ────────────────────────────────────────────────────
  T(
    "schedule_reminder",
    "Schedule a reminder for the current user. `when` is an ISO-8601 timestamp or a relative spec like '2h', '30m', 'tomorrow 9am'.",
    obj({ when: str(), text: str() }, ["when", "text"])
  ),
  T(
    "remember_fact",
    "Save a short fact about the user to long-term memory (embedding-indexed).",
    obj({ fact: str("≤ 200 chars") }, ["fact"])
  ),
];

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));
