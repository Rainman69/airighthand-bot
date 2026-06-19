// Multi-account Cloudflare Workers AI pool.
//
// We load N accounts from CF_ACCOUNTS_JSON and route every model call to one of
// them, automatically rotating away from accounts that hit the free-tier neuron
// limit (HTTP 429 / "neurons exhausted").
//
// State is persisted in KV under `pool:state` so it survives across requests:
//   { accounts: { [id]: { disabled_until, fail, ok } } }
//
// IMPORTANT: this module never logs the account token. Only the prefix of the
// account id is emitted (and only to the structured logger, which is secret-
// redacted as well).

import type { Env, CfAccount } from "../env.js";
import { parseAccounts } from "../env.js";
import { redact } from "../utils/secrets.js";

interface AccountState {
  disabled_until: number; // epoch ms
  fail: number;
  ok: number;
  cooldown_ms: number; // current backoff
}

interface PoolState {
  accounts: Record<string, AccountState>;
}

const STATE_KEY = "pool:state:v1";
const BASE_COOLDOWN = 5 * 60 * 1000; // 5 min
const MAX_COOLDOWN = 24 * 60 * 60 * 1000; // 24 h

async function loadState(env: Env): Promise<PoolState> {
  const raw = await env.KV.get(STATE_KEY, "json");
  if (raw && typeof raw === "object") return raw as PoolState;
  return { accounts: {} };
}

async function saveState(env: Env, s: PoolState): Promise<void> {
  await env.KV.put(STATE_KEY, JSON.stringify(s), { expirationTtl: 60 * 60 * 24 * 7 });
}

function ensure(state: PoolState, id: string): AccountState {
  if (!state.accounts[id]) {
    state.accounts[id] = { disabled_until: 0, fail: 0, ok: 0, cooldown_ms: BASE_COOLDOWN };
  }
  return state.accounts[id];
}

function pickOrder(accounts: CfAccount[], state: PoolState): CfAccount[] {
  const now = Date.now();
  const eligible = accounts.filter((a) => (state.accounts[a.id]?.disabled_until ?? 0) <= now);
  // Best first: lowest failure ratio, then highest ok count.
  eligible.sort((a, b) => {
    const sa = ensure(state, a.id);
    const sb = ensure(state, b.id);
    const ra = sa.fail / Math.max(1, sa.fail + sa.ok);
    const rb = sb.fail / Math.max(1, sb.fail + sb.ok);
    if (ra !== rb) return ra - rb;
    return sb.ok - sa.ok;
  });
  // Fall back to ALL accounts (even cooled-down ones) if everything is disabled —
  // better to try and possibly fail than to refuse the user.
  if (eligible.length === 0) return [...accounts];
  return eligible;
}

/** Quota-style errors that should trigger long cooldown. */
function isQuota(status: number, body: string): boolean {
  if (status === 429) return true;
  const b = body.toLowerCase();
  return (
    b.includes("neuron") &&
    (b.includes("exhaust") || b.includes("limit") || b.includes("exceed"))
  );
}

export interface CallOptions {
  /** When true and the model supports it, request `stream: true` and return a Response. */
  stream?: boolean;
  /** Extra headers (rare). */
  headers?: Record<string, string>;
}

export interface CallResult {
  /** Raw response (consumer parses JSON or reads stream). */
  response: Response;
  /** Which account served this call. Kept internal — never sent to users. */
  accountId: string;
}

/**
 * Call a Workers AI model through the pool. Body is the JSON payload Cloudflare
 * expects for that model (e.g. `{messages, stream}` for chat, `{prompt}` for flux).
 */
export async function callModel(
  env: Env,
  model: string,
  body: unknown,
  opts: CallOptions = {}
): Promise<CallResult> {
  const accounts = parseAccounts(env);
  if (accounts.length === 0) throw new Error("No Cloudflare accounts configured");

  const state = await loadState(env);
  const order = pickOrder(accounts, state);

  let lastErr: { status: number; text: string; accountId: string } | null = null;

  for (const acc of order) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${acc.id}/ai/run/${model}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${acc.token}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    };

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      const st = ensure(state, acc.id);
      st.fail++;
      lastErr = { status: 0, text: String(e), accountId: acc.id };
      continue;
    }

    if (res.ok) {
      const st = ensure(state, acc.id);
      st.ok++;
      st.cooldown_ms = BASE_COOLDOWN; // reset backoff on success
      await saveState(env, state);
      return { response: res, accountId: acc.id };
    }

    // Read error body once (small for non-stream responses; we only retry non-stream
    // on the fast path — stream errors are rare and we keep the same logic).
    const errText = await res.text().catch(() => "");
    const st = ensure(state, acc.id);
    st.fail++;

    if (isQuota(res.status, errText)) {
      st.cooldown_ms = Math.min(MAX_COOLDOWN, (st.cooldown_ms || BASE_COOLDOWN) * 2);
      st.disabled_until = Date.now() + st.cooldown_ms;
    } else if (res.status >= 500) {
      // transient — short cooldown
      st.disabled_until = Date.now() + 30_000;
    }
    lastErr = { status: res.status, text: errText, accountId: acc.id };
    // continue to next account
  }

  await saveState(env, state);
  const safe = lastErr
    ? `Workers AI request failed across ${order.length} account(s): HTTP ${lastErr.status}`
    : "Workers AI request failed";
  throw new Error(redact(safe));
}

/** Convenience: parse a non-streaming JSON response. */
export async function callJSON<T = unknown>(
  env: Env,
  model: string,
  body: unknown
): Promise<T> {
  const { response } = await callModel(env, model, body, { stream: false });
  return (await response.json()) as T;
}
