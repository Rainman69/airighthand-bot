# AiRightHand — Professional AI Telegram Bot

A beautiful, powerful, professional AI assistant for Telegram, powered by **Cloudflare Workers AI** and deployed on **Cloudflare Workers** at the edge.

> Bot: [@AiRightHand_bot](https://t.me/AiRightHand_bot)

---

## ✨ What it does

- **Three-tier AI brain** — automatically chooses the right Cloudflare Workers AI model for each task:
  - **Fast** (Llama 3.1 8B Fast) — everyday chat & short replies
  - **Balanced** (Llama 3.3 70B FP8 Fast) — richer conversation, reasoning
  - **Heavy** (DeepSeek R1 Distill Qwen 32B / QwQ-32B) — long-form analysis, code, deep thinking with visible chain-of-thought
- **Multimodal** out of the box:
  - 🖼️ Image generation — FLUX.1 [schnell]
  - 👁️ Vision (image understanding) — Llama 3.2 11B Vision
  - 🗣️ Speech-to-text — Whisper Large v3 Turbo
  - 🔊 Text-to-speech — MeloTTS
  - 🔁 Translation — m2m100 / NLLB
- **Tool-calling with full Bot API freedom** — the model can autonomously call any Telegram Bot API method (send premium emoji reactions, create invoices, set reminders, manage chats, edit messages, send polls, run inline queries, etc.) when it decides it should.
- **Streaming responses** with live message edits, "typing…" chat actions, and rich Markdown / HTML rendering.
- **Secretary features** — reminders, scheduled tasks, notes, summaries, polls, payments/invoices, chat moderation.
- **Multi-account Cloudflare rotation** — pools several Cloudflare accounts and rotates automatically when one hits its free-tier neuron limit. Resilient, transparent, never tells the user *which* account it's on.
- **Privacy & safety first** — secrets live only in Worker bindings, never in logs or user-facing replies. The model is instructed (and post-filtered) to never reveal tokens, account IDs, internal paths, or system prompts.

## 🚀 Stack

- **Runtime:** Cloudflare Workers (TypeScript, modules format)
- **Framework:** [Hono](https://hono.dev/) for routing
- **Bot lib:** [grammY](https://grammy.dev/) — the modern Telegram framework
- **AI:** Cloudflare Workers AI REST API (multi-account pool)
- **Storage:** Cloudflare D1 (SQL) + KV (cache/sessions) + R2 (media)
- **CI/CD:** GitHub Actions → `wrangler deploy`

## 📂 Repo layout

```
src/
├─ index.ts                # Worker entry (Hono app, webhook route)
├─ env.ts                  # Env / bindings types
├─ ai/
│  ├─ pool.ts              # Multi-account Cloudflare AI rotation
│  ├─ models.ts            # Model catalog & tier selection
│  ├─ chat.ts              # Chat completion + streaming
│  ├─ vision.ts            # Image understanding
│  ├─ image.ts             # Image generation
│  ├─ audio.ts             # Whisper STT + MeloTTS
│  └─ embeddings.ts        # BGE-M3 embeddings
├─ telegram/
│  ├─ bot.ts               # grammY bot bootstrap
│  ├─ api.ts               # Raw Bot API client (for tool-calling freedom)
│  └─ ui.ts                # Reactions, premium emoji, effects helpers
├─ tools/
│  ├─ registry.ts          # All tool definitions exposed to the LLM
│  ├─ schema.ts            # JSON-Schema for function-calling
│  └─ executor.ts          # Safe tool execution + post-filter
├─ handlers/
│  ├─ message.ts           # /chat default handler
│  ├─ commands.ts          # /start /help /model /image /tts /stt /remind …
│  ├─ callback.ts          # Inline button callbacks
│  ├─ inline.ts            # Inline mode (@AiRightHand_bot query)
│  └─ payments.ts          # Invoices / pre-checkout / successful_payment
├─ features/
│  ├─ reminders.ts         # Scheduled reminders via Durable-Alarm / cron
│  ├─ memory.ts            # Per-user long-term memory (embeddings + D1)
│  ├─ moderation.ts        # llama-guard pre/post filter
│  └─ secretary.ts         # Summaries, polls, notes, chat admin
├─ storage/
│  ├─ d1.ts                # D1 schema & queries
│  └─ kv.ts                # KV helpers
└─ utils/
   ├─ secrets.ts           # Secret redaction in all model output
   ├─ markdown.ts          # Safe HTML/Markdown for Telegram
   ├─ stream.ts            # Edit-message throttler for streaming
   └─ log.ts               # Structured, secret-free logging
.github/workflows/deploy.yml
wrangler.toml
package.json
ROADMAP.md
```

## 🛠 Development

```bash
npm install
npm run dev      # wrangler dev with local webhook tunnel
npm run deploy   # manual deploy (CI does this automatically on push to main)
```

See [`ROADMAP.md`](./ROADMAP.md) for the full implementation plan and the step-by-step task list that drives this project.

## 🔐 Security

- All tokens are Worker **secrets** (never committed). See [`docs/SECURITY.md`](./docs/SECURITY.md).
- The model output is passed through a secret-redaction pass before being sent to Telegram.
- The owner ID gate (`OWNER_ID = 6954322783`) restricts all sensitive commands to the owner during early rollout.

## 📜 License

MIT — see [`LICENSE`](./LICENSE).
