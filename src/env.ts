// Environment bindings and types for the Worker.
// Secrets are populated via `wrangler secret put` and never committed.

export interface Env {
  // Bindings
  KV: KVNamespace;
  DB: D1Database;
  MEDIA: R2Bucket;

  // Secrets
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /**
   * JSON array of Cloudflare accounts that host Workers AI.
   * Example:
   * [
   *   {"id":"abc123","token":"cfat_…"},
   *   {"id":"def456","token":"cfat_…"}
   * ]
   */
  CF_ACCOUNTS_JSON: string;
  OWNER_ID: string;
  TELEGRAM_PAYMENT_PROVIDER_TOKEN?: string;
}

export interface CfAccount {
  id: string;
  token: string;
}

export function parseAccounts(env: Env): CfAccount[] {
  try {
    const raw = JSON.parse(env.CF_ACCOUNTS_JSON);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (a): a is CfAccount =>
        a && typeof a.id === "string" && typeof a.token === "string"
    );
  } catch {
    return [];
  }
}
