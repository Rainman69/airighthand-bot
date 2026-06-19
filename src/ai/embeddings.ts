// BGE-M3 embeddings — used by the long-term memory feature.

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callJSON } from "./pool.js";

interface EmbedResponse {
  result?: { data?: number[][] };
}

export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await callJSON<EmbedResponse>(env, MULTIMODAL.embed, { text: texts });
  return r.result?.data ?? [];
}

/** Cosine similarity helper (assumes both vectors same length). */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
