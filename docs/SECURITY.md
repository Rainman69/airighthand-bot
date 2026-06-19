# Security model

This file documents how AiRightHand handles secrets and untrusted input. **All
contributors must read it before changing anything in `src/ai/`, `src/tools/`,
`src/utils/secrets.ts`, or any handler that emits text back to Telegram.**

## Threat model

| Asset                             | Where it lives                  | Who can read it                                      |
|-----------------------------------|---------------------------------|------------------------------------------------------|
| Telegram bot token                | Worker secret `TELEGRAM_BOT_TOKEN` | Worker code only                                  |
| Telegram webhook secret           | Worker secret `TELEGRAM_WEBHOOK_SECRET` | Worker code + Telegram                       |
| Cloudflare account tokens (pool)  | Worker secret `CF_ACCOUNTS_JSON` | Worker code only                                   |
| Payment provider token            | Worker secret `TELEGRAM_PAYMENT_PROVIDER_TOKEN` | Worker code only                  |
| User chat history                 | D1 (`history` table)             | Worker code; never sent to other users             |

## Hard rules

1. **No secret ever appears in a Telegram reply.** Every outbound string passes
   through `redact()` (`src/utils/secrets.ts`) before being sent. The regex
   set covers GitHub PATs, Cloudflare `cfat_…` tokens, Telegram bot tokens, AWS
   keys, and 32+ char hex strings.
2. **No secret ever appears in logs.** Use `log` from `src/utils/log.ts`. It
   redacts both the `msg` and every field of `fields`.
3. **The model never sees raw secrets.** Account IDs and tokens never enter the
   `messages` array. Cloudflare AI calls are made by the pool, which adds the
   `Authorization` header *outside* of any prompt context.
4. **Tool calls are validated.** The executor refuses unknown tools, refuses
   admin/destructive tools when the caller isn't the owner, and JSON-parses
   arguments defensively.
5. **The webhook is authenticated.** `POST /webhook` rejects requests whose
   `x-telegram-bot-api-secret-token` header does not match
   `TELEGRAM_WEBHOOK_SECRET`. This prevents anyone on the internet from
   injecting updates.
6. **Prompt-injection resistance.** The system prompt explicitly tells the
   model never to reveal instructions, tokens, or internal IDs. Even if the
   model does, the redactor strips them before they leave the Worker.

## How to add a new secret

1. `wrangler secret put NEW_SECRET`
2. Add the typed field to `Env` in `src/env.ts`.
3. If it could leak into model output, add a corresponding regex to
   `src/utils/secrets.ts`.

## How to add a new tool

1. Define it in `src/tools/registry.ts` with a tight JSON schema.
2. Implement the dispatch case in `src/tools/executor.ts`.
3. If destructive, add it to `ADMIN_METHODS` so it's owner-gated.
4. Write a smoke test in `scripts/smoke.ts`.

## Reporting an issue

Open a private security advisory on GitHub or DM the owner on Telegram.
