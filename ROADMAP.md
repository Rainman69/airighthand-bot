# Roadmap — AiRightHand Bot

> **Audience:** this document is written for any developer (human or AI coding agent) picking up the project. Read it top to bottom before touching code. Each phase has concrete, verifiable acceptance criteria.

> **Style rules for contributors**
> - Do **not** add any "built by ..." attribution to source files, commits, the README, or generated bot replies. The product is **AiRightHand**, nothing else.
> - Every PR must be created and merged using the repository owner's PAT. No third-party identity in commits.
> - Never log, echo, or expose secrets — see Phase 2 *Security guardrails*.

---

## 0. Project pitch (one paragraph)

A Telegram bot that talks like a senior assistant. It uses Cloudflare Workers AI for everything — chat, vision, image generation, speech-to-text, text-to-speech, embeddings — across a **pool of Cloudflare accounts** so we never hit the free-tier neuron cap. The model has tool-calling access to the *entire* Telegram Bot API, so when a user says "send me a premium-emoji reaction" or "create an invoice for 5 stars," the model can just do it. Everything runs at the edge on a single Cloudflare Worker.

---

## 1. Models we use (Cloudflare Workers AI)

Picked from <https://developers.cloudflare.com/workers-ai/models/>. All free-tier eligible.

### Text / chat — three tiers
| Tier      | Model ID                                          | Why                                                      |
|-----------|---------------------------------------------------|----------------------------------------------------------|
| **fast**     | `@cf/meta/llama-3.1-8b-instruct-fast`             | Cheapest neurons, sub-second replies, good for casual chat |
| **balanced** | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`        | Real 70B brain at FP8 speed, supports function-calling  |
| **heavy**    | `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`    | Reasoning model — visible `<think>` chain-of-thought for hard analysis & code |

A **router** (in `src/ai/models.ts`) picks the tier per request based on:
- explicit user override (`/model fast|balanced|heavy`)
- message length & presence of code / math / "analyze" / "reason" keywords
- whether the conversation already escalated to a heavier tier

### Multimodal
| Task                    | Model                                                | Notes                                  |
|-------------------------|------------------------------------------------------|----------------------------------------|
| Image generation        | `@cf/black-forest-labs/flux-1-schnell`               | 4-step FLUX, 1024×1024, very fast      |
| Image understanding     | `@cf/meta/llama-3.2-11b-vision-instruct`             | Pass photo + question                  |
| Speech-to-text          | `@cf/openai/whisper-large-v3-turbo`                  | Voice notes & audio files              |
| Text-to-speech          | `@cf/myshell-ai/melotts`                             | Returns MP3, multi-lingual             |
| Embeddings              | `@cf/baai/bge-m3`                                    | For long-term memory & semantic search |
| Safety                  | `@cf/meta/llama-guard-3-8b`                          | Pre/post filter for unsafe content     |
| Translation (fallback)  | `@cf/meta/m2m100-1.2b`                               | Quick translation when needed          |

The catalog is centralised in `src/ai/models.ts` so swapping a model is a one-line change.

---

## 2. Architecture

```
Telegram ── webhook ──► Cloudflare Worker (Hono + grammY)
                        │
                        ├── AI Pool ──► Cloudflare Workers AI (account 1..N, round-robin + quota-aware)
                        │
                        ├── Tools  ──► Telegram Bot API  (model can call any method)
                        │              ├── send/edit/delete messages
                        │              ├── reactions (incl. premium emoji)
                        │              ├── invoices & payments
                        │              ├── polls, dice, chat actions
                        │              ├── inline queries / answer
                        │              └── chat admin (restrict/promote/pin/…)
                        │
                        ├── D1   ──► users, chats, memory, reminders, usage, accounts_state
                        ├── KV   ──► short-term session, rate-limit, account-cooldown
                        └── R2   ──► generated images / audio cache
```

### 2.1 Multi-account Cloudflare AI rotation

- Accounts are loaded from the Worker secret `CF_ACCOUNTS_JSON`, **never** hard-coded.
- The pool keeps an in-memory + KV-persisted record per account: `{ disabled_until, last_429_at, success_count, failure_count }`.
- Selection algorithm:
  1. Filter out accounts whose `disabled_until > now`.
  2. Prefer the account with the lowest recent failure rate, ties broken by least-recently-used.
  3. On a 429 / quota error → mark that account `disabled_until = now + cooldown` (start at 5 min, exponential up to 24 h) and immediately retry on the next account.
  4. On any other 5xx → short cooldown (30 s) and retry up to `len(accounts)` times.
- Selection is **fully transparent** to the user. The bot never reveals which account was used.

### 2.2 Tool-calling = "Bot API freedom"

- Every Telegram Bot API method is exposed to the LLM as a JSON-schema tool in `src/tools/registry.ts`.
- We use grammY's typed Bot API as the executor, so the model literally calls e.g. `setMessageReaction({ chat_id, message_id, reaction: [{ type: "custom_emoji", custom_emoji_id }] })`.
- The model can chain tool calls (think → call → observe → call → finish).
- Safety:
  - Tool calls are gated by an **allow-list** of methods + an **argument validator**.
  - Destructive admin methods (`banChatMember`, `restrictChatMember`, `deleteMessage` of other users, …) require either (a) the caller is `OWNER_ID` or (b) the bot is a chat admin and the target is not the owner.
  - Payments use `provider_token` from secrets; the model can *propose* an invoice but the final `sendInvoice` is built by our handler using server-side values.

### 2.3 Security guardrails

| Threat                                         | Mitigation                                                                                |
|------------------------------------------------|-------------------------------------------------------------------------------------------|
| Token leaks via model output                   | `utils/secrets.ts` redacts any string that looks like a CF token / GH PAT / bot token / API key before sending to Telegram. |
| Prompt injection extracting the system prompt  | System prompt is split: a *private* policy block is **never** put inside the user-visible context. We re-check every model output and refuse if it echoes any private block. |
| Unbounded spend                                | Per-user daily request quota in D1 + global daily neuron budget tracker.                  |
| Unauthorised admin actions                     | OWNER_ID check + role check in `tools/executor.ts`.                                       |
| Logs containing secrets                        | `utils/log.ts` runs every log line through the same redactor.                             |

---

## 3. Phased implementation plan

> **Definition of done for each phase:** code compiles (`tsc --noEmit`), `wrangler deploy --dry-run` succeeds, and the acceptance checklist passes.

### Phase 1 — Skeleton (✅ done in initial commit)
- [x] Repo, README, ROADMAP, MIT licence.
- [x] `package.json`, `tsconfig.json`, `wrangler.toml` with KV / D1 / R2 / AI bindings.
- [x] Hono Worker with `GET /` health and `POST /webhook` skeleton.
- [x] grammY bot wired with `/start`, `/help`, `/ping`.
- [x] GitHub Actions deploy on push to `main`.

**Acceptance:** webhook URL responds 200, `/start` replies with welcome card.

### Phase 2 — AI pool & chat
- [x] `src/ai/pool.ts` with multi-account selection + cooldown state in KV.
- [x] `src/ai/chat.ts` — `chatComplete({tier, messages, stream})` returns either full string or `AsyncIterable<string>` (SSE parsed from CF's `stream:true`).
- [x] `src/handlers/message.ts` — default text handler:
  - Save chat history in D1 (last 20 turns).
  - Pick tier via `models.routeTier(text, history)`. **History tier persisted per user in `users.last_tier`** so escalation to heavy/balanced is sticky within a session.
  - Stream the answer back, editing the placeholder message every ~900 ms, throttled to respect Telegram's 1 edit/sec/chat rule.
- [x] `/model fast|balanced|heavy|auto` command persists per-user choice in D1.

**Acceptance:** sending a long question produces a streamed, live-editing reply; `/model heavy` shows the `<think>` block formatted as an expandable HTML `<blockquote expandable>`.

### Phase 3 — Tool-calling (Bot API freedom)
- [x] `src/tools/registry.ts` — JSON-schema for ~20 most useful Bot API methods (send/edit/delete, reactions incl. premium custom_emoji_id, invoice, poll, copy, forward, pin, chat actions, dice, ban/restrict/promote, plus `generate_image`, `text_to_speech`, `schedule_reminder`, `remember_fact`).
- [x] `src/tools/executor.ts` — allow-list, argument validation, permission check (`ADMIN_METHODS` set + owner gate), then `bot.api.raw[method](args)` via our `BotApi.call`.
- [x] `src/ai/chat.ts` — when the model emits `tool_calls`, execute them and feed the result back into the loop (max 4 iterations).
- [x] System prompt teaches the model when to use which tool and to **prefer** rich UX: premium emoji reactions, chat effects, formatted HTML.

**Acceptance:** asking "react to my message with a 🔥 premium emoji and reply with a poll asking my favourite colour" results in (a) a reaction set on the user's message, (b) a poll sent, (c) a short confirmation text.

### Phase 4 — Multimodal
- [x] `/image <prompt>` → flux-1-schnell → `sendPhoto`. (R2 cache: optional optimisation, deferred.)
- [x] Photo upload → vision model → describe / answer follow-up questions.
- [x] Voice / audio upload → whisper → transcript → continue conversation as if typed.
- [x] `/tts <text>` or model tool `text_to_speech` → MeloTTS → `sendVoice`.
- [ ] `/translate` uses m2m100 directly (cheap) instead of the chat tier.

**Acceptance:** all four media flows work end-to-end.

### Phase 5 — Secretary
- [x] `src/features/reminders.ts` — `/remind 2h buy milk` stores in D1; a cron trigger (`* * * * *`) wakes the Worker and dispatches due reminders.
- [x] `src/features/memory.ts` — at the end of every conversation turn, distil 0–3 facts about the user, embed with BGE-M3, store in D1. On each new request, retrieve top-k relevant memories and prepend to the system prompt. Surfaced to users via `/recall` and `/forget`.
- [x] `src/features/secretary.ts` — `summarizeRecent()` (used by `/summarize`), `/poll`, `botIsAdmin()` helper.
- [x] Chat admin tools gated server-side (owner check + `botIsAdmin` helper available for richer probes).

**Acceptance:** reminders fire within ±60 s; the bot proactively references prior facts ("you mentioned you live in Tehran…").

### Phase 6 — Payments & inline
- [x] `/buy` opens an invoice (Telegram Stars, `currency: "XTR"`), pre-checkout query handler approves, `successful_payment` grants the user a 30-day "Pro" flag in D1.
- [x] Inline mode: `@AiRightHand_bot <query>` returns a fast-tier answer (cached 5 min in KV) suitable for share-in-any-chat.
- [x] Bot-to-bot communication: `/relay @other_bot <text>` posts a message in the current chat addressed to another bot (Telegram doesn't allow bot↔bot DMs; the relay assumes both bots share a group).

**Acceptance:** a successful Stars payment grants Pro; inline queries return cached results in <500 ms.

### Phase 7 — Polish
- [x] Localisation (English + Persian to start; auto-detect via `from.language_code`). See `src/utils/i18n.ts`.
- [x] `/stats` for the owner: per-account pool state, user counts (incl. Pro), message count, memory count, pending reminders.
- [x] Llama-Guard moderation on every text request — fails *open* on input check errors, fails *closed* on output check errors. Refusal text in `features/moderation.ts`.
- [x] Smoke-test suite in `scripts/smoke.ts` covering health, webhook auth, admin-endpoint auth, and 404.

---

## 4. Cloudflare resources to create (manual, one-time)

For the **primary** account only (the others are AI-only):

```bash
# Replace ACCOUNT_ID with the primary one in your Wrangler login.
wrangler kv namespace create AIRH_KV
wrangler kv namespace create AIRH_KV --preview
wrangler d1 create airighthand
wrangler r2 bucket create airighthand-media
```

Then fill the IDs into `wrangler.toml` (already templated).

**Secrets** to set with `wrangler secret put`:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (random 32-byte hex, used as `secret_token` for setWebhook)
- `CF_ACCOUNTS_JSON` — JSON array `[{"id":"…","token":"…"}, …]`
- `OWNER_ID` — `6954322783`
- `TELEGRAM_PAYMENT_PROVIDER_TOKEN` — optional, for fiat payments (Stars need nothing)

---

## 5. GitHub Actions auto-deploy

`.github/workflows/deploy.yml` runs on every push to `main`:
1. `npm ci`
2. `npm run build` (just `tsc --noEmit`)
3. `wrangler deploy` using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets (the **primary** CF account — that's where the Worker lives; other accounts are used at runtime only for AI calls).
4. POST `setWebhook` to Telegram with the new URL.

Required repository secrets:
- `CLOUDFLARE_API_TOKEN` — token of the **primary** CF account, must have *Workers Scripts: Edit* + *Workers AI: Read* + *Account Settings: Read*.
- `CLOUDFLARE_ACCOUNT_ID` — the primary account's ID.
- `TELEGRAM_BOT_TOKEN` — used to call `setWebhook` after deploy.

> **The CI never has access to the secondary CF account credentials.** Those are stored only as Worker secrets via `wrangler secret put CF_ACCOUNTS_JSON`. This keeps blast radius tight.

---

## 6. Step-by-step for an AI agent picking this up

1. **Read** `README.md` and this file end-to-end.
2. `npm install`, then run `npm run typecheck`. Fix any drift.
3. Locate the next unchecked box in section 3 and implement it.
4. After implementing, write/extend the smoke test in `scripts/smoke.ts`.
5. Commit with a focused message (`feat(ai): multi-account pool with KV cooldown`).
6. Push to `main` — CI will deploy automatically.
7. Tick the box in this file in the same PR/commit.

That's it. Stay inside the architecture above; if you need to deviate, write the reason at the top of `docs/DECISIONS.md`.
