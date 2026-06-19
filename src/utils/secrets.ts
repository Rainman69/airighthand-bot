// Redact anything that looks like a credential from a string before it leaves
// the Worker (to Telegram, to logs, anywhere).
//
// We intentionally over-match — false positives only hurt readability, but a
// false negative leaks a secret.

const PATTERNS: RegExp[] = [
  // GitHub PATs
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgho_[A-Za-z0-9]{20,}\b/g,
  /\bghs_[A-Za-z0-9]{20,}\b/g,
  /\bghu_[A-Za-z0-9]{20,}\b/g,
  // Cloudflare API tokens
  /\bcfat_[A-Za-z0-9]{20,}\b/g,
  // Telegram bot tokens   (digits:35chars)
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g,
  // Generic long hex (CF account IDs, secret keys)  — only when 32+ hex chars
  /\b[a-f0-9]{32,}\b/g,
  // AWS-style access keys
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
];

export function redact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

/** Walk arbitrary JSON and redact all string leaves. */
export function redactDeep<T>(v: T): T {
  if (v == null) return v;
  if (typeof v === "string") return redact(v) as unknown as T;
  if (Array.isArray(v)) return v.map(redactDeep) as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) out[k] = redactDeep(val);
    return out as T;
  }
  return v;
}
