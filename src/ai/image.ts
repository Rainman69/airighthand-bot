// Image generation via FLUX.1 [schnell] on Workers AI.
//
// Cloudflare returns either:
//   - JSON {"result": {"image": "<base64>"}}
//   - or raw PNG bytes (newer FLUX endpoint)
// We support both.

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callModel } from "./pool.js";

export interface ImageOptions {
  prompt: string;
  /** 1–8 for schnell, default 4. */
  steps?: number;
}

/** Returns a Uint8Array containing PNG (or JPEG) bytes ready for sendPhoto. */
export async function generateImage(env: Env, opts: ImageOptions): Promise<Uint8Array> {
  const { response } = await callModel(env, MULTIMODAL.imageGen, {
    prompt: opts.prompt,
    steps: opts.steps ?? 4,
  });

  const ct = response.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    return new Uint8Array(await response.arrayBuffer());
  }
  // JSON fallback
  const j = (await response.json()) as { result?: { image?: string } };
  const b64 = j.result?.image;
  if (!b64) throw new Error("Image generation returned no data");
  return base64ToBytes(b64);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
