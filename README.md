# AiRightHand — AI Telegram Bot

A powerful AI assistant for Telegram, powered by **Cloudflare Workers AI** and deployed at the edge on Cloudflare Workers.

> Bot: [@AiRightHand_bot](https://t.me/AiRightHand_bot)

---

## ✨ Features

- **Three-tier AI brain** — picks the right model automatically:
  - **Fast** (Llama 3.1 8B) — everyday chat & quick replies
  - **Balanced** (Llama 3.3 70B FP8) — richer conversation & reasoning
  - **Heavy** (DeepSeek R1 32B) — deep analysis, code, and visible chain-of-thought
- **Multimodal:**
  - 🖼️ Image generation — FLUX.1 schnell
  - 👁️ Vision — Llama 3.2 11B Vision
  - 🗣️ Speech-to-text — Whisper Large v3 Turbo
  - 🔊 Text-to-speech — MeloTTS
  - 🔁 Translation — m2m100
- **Tool-calling** — the model can autonomously call Telegram Bot API methods (reactions, polls, dice, invoices, reminders, memory management, etc.)
- **Streaming responses** — live message edits with "typing…" status
- **Secretary mode** — personal task management, reminders, action item extraction, summaries
- **Long-term memory** — per-user embedding-indexed memory with BGE-M3
- **Group chat support** — responds to @mentions and replies in groups
- **Multi-account AI rotation** — pools multiple Cloudflare accounts, rotates automatically on rate limits
- **Privacy & safety** — secrets never appear in logs or replies; Llama-Guard moderation on all I/O

## 🚀 Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **Framework:** [Hono](https://hono.dev/)
- **Bot lib:** [grammY](https://grammy.dev/)
- **AI:** Cloudflare Workers AI (multi-account pool)
- **Storage:** Cloudflare D1 (SQL) + KV (cache/sessions)
- **CI/CD:** GitHub Actions → `wrangler deploy`

## 📂 Project layout

```
src/
├─ index.ts                # Worker entry (Hono app, webhook route)
├─ env.ts                  # Environment / bindings types
├─ ai/
│  ├─ pool.ts              # Multi-account Cloudflare AI rotation
│  ├─ models.ts            # Model catalog & tier selection
│  ├─ chat.ts              # Chat completion + streaming
│  ├─ vision.ts            # Image understanding
│  ├─ image.ts             # Image generation
│  ├─ audio.ts             # Whisper STT + MeloTTS
│  ├─ embeddings.ts        # BGE-M3 embeddings
│  └─ translate.ts         # m2m100 translation
├─ telegram/
│  ├─ bot.ts               # grammY bot bootstrap
│  ├─ api.ts               # Raw Bot API client
│  └─ ui.ts                # Reactions, effects helpers
├─ tools/
│  ├─ registry.ts          # Tool definitions exposed to the LLM
│  └─ executor.ts          # Safe tool execution
├─ handlers/
│  ├─ message.ts           # Default text handler
│  ├─ commands.ts          # All command handlers
│  ├─ media.ts             # Photo + voice handlers
│  ├─ inline.ts            # Inline mode
│  └─ payments.ts          # Telegram Stars payments
├─ features/
│  ├─ reminders.ts         # Scheduled reminders (cron)
│  ├─ memory.ts            # Per-user long-term memory
│  ├─ moderation.ts        # Llama-Guard content filter
│  └─ secretary.ts         # Secretary mode, todos, summaries
├─ storage/
│  └─ d1.ts                # D1 schema & queries
└─ utils/
   ├─ secrets.ts           # Secret redaction
   ├─ markdown.ts          # HTML/Markdown for Telegram
   ├─ stream.ts            # Streaming message editor
   ├─ log.ts               # Structured logging
   ├─ toolcalls.ts         # Tool-call JSON extraction
   └─ i18n.ts              # Localisation (en/fa)
.github/workflows/deploy.yml
wrangler.toml
```

## 🛠 Development

```bash
npm install
npm run dev      # wrangler dev
npm run deploy   # manual deploy
```

## 🔐 Secrets

Set with `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random hex string for webhook validation |
| `CF_ACCOUNTS_JSON` | JSON array: `[{"id":"…","token":"…"}, …]` |
| `OWNER_ID` | Telegram user ID of the bot owner |

## 📜 License

MIT — see [`LICENSE`](./LICENSE).
