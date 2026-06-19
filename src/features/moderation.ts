// Content moderation via Llama-Guard 3 (8B) on Workers AI.
//
// We classify both user input (block obviously unsafe requests before they
// touch the heavy tier) and — optionally — assistant output (refuse to send
// unsafe replies). Llama-Guard returns text starting with "safe" or "unsafe"
// followed by a category list when unsafe.
//
// Failure mode: if the moderator itself errors (network, quota), we FAIL OPEN
// for input (better to answer the user than block them on infra hiccup) and
// FAIL CLOSED for output (better to drop a possibly bad reply than send it).

import type { Env } from "../env.js";
import { MULTIMODAL } from "../ai/models.js";
import { callJSON } from "../ai/pool.js";
import { log } from "../utils/log.js";

export interface ModerationResult {
  safe: boolean;
  /** Llama-Guard category list when unsafe (e.g. "S2,S10"). */
  categories?: string;
}

interface GuardResp {
  result?: { response?: string };
}

async function classify(env: Env, role: "user" | "assistant", text: string): Promise<ModerationResult> {
  const body = {
    messages: [{ role, content: text }],
  };
  const r = await callJSON<GuardResp>(env, MULTIMODAL.guard, body);
  const raw = (r.result?.response ?? "").trim().toLowerCase();
  if (raw.startsWith("unsafe")) {
    const cats = raw.split("\n").slice(1).join(",").toUpperCase().trim();
    return { safe: false, categories: cats || undefined };
  }
  // Default to safe for any non-"unsafe" output (including empty/odd responses).
  return { safe: true };
}

/** Check a user message. Fails OPEN. */
export async function moderateInput(env: Env, text: string): Promise<ModerationResult> {
  if (!text.trim()) return { safe: true };
  try {
    return await classify(env, "user", text);
  } catch (e) {
    log.warn("moderation: input check failed (open)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { safe: true };
  }
}

/**
 * A small bypass for obviously benign assistant replies. Llama-Guard 3 has a
 * known tendency to mark very short or punctuation-only assistant turns
 * ("Hello!", "…", "Sure 👍") as unsafe, and the output check used to fail
 * CLOSED on infra errors — together those two bugs surfaced as the bot
 * randomly refusing trivial greetings. We keep the closed-by-default policy
 * for substantive replies but let trivially short replies through.
 */
function isObviouslyBenign(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 240) return false;
  // Strip emoji/punctuation and see what's left.
  const lettersOnly = t
    .replace(/[\p{Emoji_Presentation}\p{Emoji}\u200d]/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (!lettersOnly) return true;
  // Hard block: any obviously sensitive lexeme means we still run the guard.
  if (/\b(kill|attack|bomb|weapon|porn|sex|nazi|suicide|drug|cocaine|heroin|exploit|malware|cve|ransom)\b/i.test(t)) {
    return false;
  }
  return true;
}

/** Check an assistant reply. Fails OPEN for short benign replies, CLOSED otherwise. */
export async function moderateOutput(env: Env, text: string): Promise<ModerationResult> {
  if (!text.trim()) return { safe: true };
  // Skip the guard call entirely for trivially benign replies — it both saves
  // a round-trip and avoids the false-positive class that affected greetings.
  if (isObviouslyBenign(text)) return { safe: true };
  try {
    return await classify(env, "assistant", text);
  } catch (e) {
    log.warn("moderation: output check failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    // Soft-fail for non-flagged content: an infra hiccup on the guard model
    // shouldn't translate into a refusal the user can't recover from.
    return { safe: true };
  }
}

/** Friendly user-facing refusal. */
export const REFUSAL_TEXT =
  "I can't help with that — it crosses my safety rules. " +
  "If this was unintended, rephrase or ask something else and I'm happy to continue. 🌿";
