# Architecture decisions log

Append-only log of non-trivial decisions. Each entry: date, context, decision, consequence.

---

## 2026-06-19 — Tier-3 reasoning model

**Context.** Cloudflare Workers AI now hosts both `@cf/qwen/qwq-32b` and
`@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`. Both emit `<think>` chain-of-thought.

**Decision.** Use `deepseek-r1-distill-qwen-32b` as the heavy tier. It's slightly more
verbose in its reasoning (better UX for "explain why") and its function-calling support
is unreliable, so the message handler downgrades to the balanced tier (`llama-3.3-70b-fp8-fast`)
for tool-using rounds.

**Consequence.** The first round of a "heavy" conversation is pure reasoning text;
subsequent rounds that require tools use Llama 70B. Users get the best of both.

---

## 2026-06-19 — Streaming with tool-calling

**Context.** SSE streams from Workers AI don't reliably include the `tool_calls` field
mid-stream; they arrive as a final structured response.

**Decision.** Stream the *first* round (cheap UX), then if tool calls were emitted,
switch to non-streaming for follow-up rounds so we can parse `tool_calls` cleanly.

**Consequence.** First-token latency stays low for ordinary chats; tool-using
conversations look like a brief pause + a final answer, which is acceptable.

---

## 2026-06-19 — Account pool persistence in KV, not D1

**Context.** Pool state (per-account cooldowns) is read on every request and updated on
every Workers AI call.

**Decision.** Store in KV at `pool:state:v1`, 7-day TTL. KV's eventual consistency
is fine here — at worst we briefly call an account that just hit its quota and
immediately rotate to the next one.

**Consequence.** Zero extra D1 writes on the hot path.

---

## 2026-06-19 — Long-term memory storage shape

**Context.** Phase 5 requires per-user durable facts retrieved by semantic
similarity. The candidates were:
  (a) D1 with embeddings stored as BLOB,
  (b) D1 with embeddings stored as JSON-stringified float arrays,
  (c) Vectorize (Cloudflare's vector DB).

**Decision.** Option (b). Vectorize is great but adds a binding and a separate
quota; for the realistic N ≲ a few hundred facts per user, in-Worker cosine
similarity over JSON-parsed vectors is fast enough and keeps the deploy
self-contained (one D1, no extra service).

**Consequence.** Fact ingestion is `INSERT` + JSON.stringify of a 1024-d float
array (~10 KB). Recall is one indexed `SELECT … WHERE user_id` over the most
recent 500 rows, then in-memory cosine. We cap at 200 facts/user with FIFO
pruning to keep recall snappy.

---

## 2026-06-19 — Llama-Guard fail policy

**Context.** Moderation has to fail in *some* direction when the guard model
itself errors (network, quota, parse).

**Decision.**
  - Input check **fails OPEN**: a broken guard shouldn't lock the user out of
    their assistant on a transient hiccup. The downstream chat model still
    has its own safety training.
  - Output check **fails CLOSED**: if we can't verify the reply is safe, drop
    it and show a polite refusal. Sending a possibly-bad reply is worse than
    sending nothing.

**Consequence.** Two thin wrappers (`moderateInput`, `moderateOutput`) with
opposite catch-policies, both in `src/features/moderation.ts`. The system
remains usable when the guard model is unreachable while the user-facing
blast radius of a misclassification stays small.

---

## 2026-06-19 — Bot-to-bot "/relay" is a hint, not a transport

**Context.** Telegram explicitly forbids bot↔bot DMs. The roadmap asks for a
`/relay` command demonstrating bot-to-bot communication.

**Decision.** Treat `/relay @other_bot <text>` as a relay *in the current
chat*: post a message in this chat that @-mentions the target bot with
`<text>` as its content. It works as advertised when both bots share a
group/channel and is a no-op DM elsewhere — which matches what the platform
actually allows.

**Consequence.** Zero magic, zero broken expectations. Users who want true
bot-to-bot pipelines build them via a shared group, which is the supported
pattern.
