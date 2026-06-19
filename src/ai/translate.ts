// Direct translation via Cloudflare Workers AI's m2m100-1.2b model.
//
// m2m100 supports many-to-many translation between ~100 languages without
// going through English. Using it directly is far cheaper (in neurons) than
// asking a chat-tier LLM to translate, so /translate routes here instead of
// through chat.ts.
//
// API shape (Cloudflare): POST /ai/run/@cf/meta/m2m100-1.2b
//   body: { text: string, source_lang?: string, target_lang: string }
//   200:  { result: { translated_text: string } }

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callJSON } from "./pool.js";

export interface TranslateOptions {
  text: string;
  /** ISO 639-1 / m2m100 code. Optional — m2m100 auto-detects if omitted. */
  source?: string;
  /** ISO 639-1 / m2m100 code. Defaults to "english". */
  target?: string;
}

interface TranslateResponse {
  result?: { translated_text?: string };
}

/**
 * Map common short codes (e.g. "fa", "en-US", "zh-CN") to the language names
 * m2m100 expects. Returns the original code if no mapping is known — m2m100
 * is usually forgiving with ISO codes.
 */
export function normalizeLang(code: string | undefined | null): string {
  if (!code) return "english";
  const c = code.trim().toLowerCase().split(/[-_]/)[0];
  const map: Record<string, string> = {
    en: "english",
    fa: "persian",
    ir: "persian",
    ar: "arabic",
    fr: "french",
    de: "german",
    es: "spanish",
    pt: "portuguese",
    it: "italian",
    ru: "russian",
    tr: "turkish",
    zh: "chinese",
    ja: "japanese",
    ko: "korean",
    hi: "hindi",
    ur: "urdu",
    nl: "dutch",
    pl: "polish",
    uk: "ukrainian",
    sv: "swedish",
    fi: "finnish",
    no: "norwegian",
    da: "danish",
    el: "greek",
    he: "hebrew",
    cs: "czech",
    hu: "hungarian",
    ro: "romanian",
    bg: "bulgarian",
    vi: "vietnamese",
    th: "thai",
    id: "indonesian",
    ms: "malay",
    bn: "bengali",
    ta: "tamil",
    az: "azerbaijani",
    ka: "georgian",
    hy: "armenian",
    kk: "kazakh",
    uz: "uzbek",
    af: "afrikaans",
    sw: "swahili",
  };
  return map[c] ?? c;
}

/**
 * Translate `opts.text` with m2m100. Throws on transport / API errors so the
 * caller can render a redacted message to the user.
 */
export async function translate(env: Env, opts: TranslateOptions): Promise<string> {
  const text = opts.text.trim();
  if (!text) return "";
  const body: Record<string, string> = {
    text,
    target_lang: normalizeLang(opts.target ?? "en"),
  };
  if (opts.source) body.source_lang = normalizeLang(opts.source);

  const r = await callJSON<TranslateResponse>(env, MULTIMODAL.translate, body);
  return r.result?.translated_text ?? "";
}
