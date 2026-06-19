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

/** Check an assistant reply. Fails CLOSED. */
export async function moderateOutput(env: Env, text: string): Promise<ModerationResult> {
  if (!text.trim()) return { safe: true };
  try {
    return await classify(env, "assistant", text);
  } catch (e) {
    log.warn("moderation: output check failed (closed)", {
      err: e instanceof Error ? e.message : String(e),
    });
    return { safe: false, categories: "GUARD_ERROR" };
  }
}

/** Friendly user-facing refusal. */
export const REFUSAL_TEXT =
  "I can't help with that — it crosses my safety rules. " +
  "If this was unintended, rephrase or ask something else and I'm happy to continue. 🌿";
