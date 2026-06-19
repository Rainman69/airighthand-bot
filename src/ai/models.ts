// Central catalog of every Cloudflare Workers AI model we use, plus the
// "tier router" that picks the right text model for a given request.

export type Tier = "fast" | "balanced" | "heavy";

export const CHAT_MODELS: Record<Tier, string> = {
  // Cheapest, fastest — Llama 3.1 8B FP8 fast variant.
  fast: "@cf/meta/llama-3.1-8b-instruct-fast",
  // Real 70B brain at FP8 speed. Supports function-calling natively.
  balanced: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  // Reasoning model — surfaces a <think>…</think> chain-of-thought we
  // render as an expandable HTML <blockquote expandable>.
  heavy: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
};

export const MULTIMODAL = {
  imageGen: "@cf/black-forest-labs/flux-1-schnell",
  vision: "@cf/meta/llama-3.2-11b-vision-instruct",
  stt: "@cf/openai/whisper-large-v3-turbo",
  tts: "@cf/myshell-ai/melotts",
  embed: "@cf/baai/bge-m3",
  guard: "@cf/meta/llama-guard-3-8b",
  translate: "@cf/meta/m2m100-1.2b",
} as const;

/** Heuristic tier router used when the user hasn't pinned one with /model. */
export function routeTier(
  text: string,
  opts?: { userPin?: Tier | "auto"; historyTier?: Tier }
): Tier {
  if (opts?.userPin && opts.userPin !== "auto") return opts.userPin;

  const t = text.trim();
  const len = t.length;
  const lower = t.toLowerCase();

  const heavyHints =
    /\b(analy[sz]e|reason|prove|debug|refactor|architecture|design|optimi[sz]e|explain why|step by step|chain of thought|complex|theorem|derive)\b/i.test(
      lower
    ) ||
    /```|def\s+\w+\(|class\s+\w+|function\s+\w+\(|select\s+.+\s+from/i.test(t) ||
    len > 1200;

  const balancedHints =
    len > 280 ||
    /\b(why|how|compare|summari[sz]e|translate|plan|outline|draft|write)\b/i.test(
      lower
    );

  if (heavyHints) return "heavy";
  if (balancedHints) return "balanced";

  // Once we've escalated, don't drop back to fast within the same chat unless the new
  // message is trivially short.
  if (opts?.historyTier === "heavy" && len > 60) return "heavy";
  if (opts?.historyTier === "balanced" && len > 120) return "balanced";

  return "fast";
}
