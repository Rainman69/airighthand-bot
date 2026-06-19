// Vision: ask Llama 3.2 11B Vision a question about an image.

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callModel } from "./pool.js";

export interface VisionOptions {
  imageBytes: Uint8Array;
  prompt: string;
  max_tokens?: number;
}

export async function describeImage(env: Env, opts: VisionOptions): Promise<string> {
  const body = {
    image: Array.from(opts.imageBytes),
    prompt: opts.prompt,
    max_tokens: opts.max_tokens ?? 512,
  };
  const { response } = await callModel(env, MULTIMODAL.vision, body);
  const j = (await response.json()) as { result?: { description?: string; response?: string } };
  return j.result?.description ?? j.result?.response ?? "";
}
