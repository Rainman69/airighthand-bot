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
