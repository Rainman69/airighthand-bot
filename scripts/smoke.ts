// Tiny smoke test against the deployed Worker.
// Run with: WORKER_URL=https://… node --import=tsx scripts/smoke.ts
//
// We don't ship a full test runner — Cloudflare's `wrangler dev` is the iteration
// loop and Telegram is the integration target. This script just checks the
// health endpoint and the webhook rejection path.

const url = process.env.WORKER_URL;
if (!url) {
  console.error("Set WORKER_URL");
  process.exit(1);
}

const health = await fetch(url).then((r) => r.text());
console.log("GET /  ->", health);

const forbidden = await fetch(url + "/webhook", { method: "POST" });
console.log("POST /webhook (no secret)  ->", forbidden.status);
if (forbidden.status !== 403) {
  console.error("Expected 403 from /webhook without secret token");
  process.exit(2);
}

console.log("✅ smoke OK");
