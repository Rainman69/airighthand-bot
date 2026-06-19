// Smoke test against the deployed Worker.
//
//   WORKER_URL=https://airighthand.<sub>.workers.dev \
//   OWNER_ID=6954322783 \
//   node --import=tsx scripts/smoke.ts
//
// We don't ship a full test runner — Cloudflare's `wrangler dev` is the
// iteration loop and Telegram is the integration target. This script just
// validates that the public surface area behaves correctly.
//
// Checks:
//   1. GET /                       → 200 "AiRightHand is awake."
//   2. POST /webhook               → 403 (missing secret token)
//   3. POST /webhook (wrong token) → 403
//   4. POST /admin/set-webhook     → 403 (missing owner header)
//   5. GET /does-not-exist         → 404 from Hono

const url = process.env.WORKER_URL;
if (!url) {
  console.error("Set WORKER_URL");
  process.exit(1);
}

const base = url.replace(/\/$/, "");
let failed = 0;

function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) {
    console.log(`✅ ${name}`);
  } else {
    console.log(`❌ ${name}`, detail);
    failed++;
  }
}

// 1) Health
{
  const r = await fetch(base + "/");
  const body = await r.text();
  check("GET / responds 200", r.status === 200, `status=${r.status}`);
  check("GET / body mentions AiRightHand", body.includes("AiRightHand"), body);
}

// 2) Webhook without secret
{
  const r = await fetch(base + "/webhook", { method: "POST", body: "{}" });
  check("POST /webhook (no secret) → 403", r.status === 403, `status=${r.status}`);
}

// 3) Webhook with wrong secret
{
  const r = await fetch(base + "/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-telegram-bot-api-secret-token": "definitely-wrong",
    },
    body: "{}",
  });
  check("POST /webhook (wrong secret) → 403", r.status === 403, `status=${r.status}`);
}

// 4) Admin set-webhook without owner header
{
  const r = await fetch(base + "/admin/set-webhook?url=https://example.com/webhook", {
    method: "POST",
  });
  check("POST /admin/set-webhook (no owner) → 403", r.status === 403, `status=${r.status}`);
}

// 5) Unknown path
{
  const r = await fetch(base + "/__nope__");
  check("GET /__nope__ → 404", r.status === 404, `status=${r.status}`);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(2);
}
console.log("\n✨ all smoke checks passed");
