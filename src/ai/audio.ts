// Speech-to-text (Whisper) and text-to-speech (MeloTTS) via Workers AI.

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callModel } from "./pool.js";

/** Transcribe a voice/audio file. `bytes` should be the raw OGG/MP3/WAV body. */
export async function transcribe(env: Env, bytes: Uint8Array): Promise<string> {
  // Whisper on CF accepts a JSON body with `audio` as an array of bytes.
  const body = { audio: Array.from(bytes) };
  const { response } = await callModel(env, MULTIMODAL.stt, body);
  const j = (await response.json()) as { result?: { text?: string } };
  return j.result?.text ?? "";
}

export interface TtsOptions {
  text: string;
  /** MeloTTS supports en, es, fr, zh, ja, ko. Defaults to en. */
  lang?: "en" | "es" | "fr" | "zh" | "jp" | "kr";
}

/** Synthesize speech, returning MP3 bytes ready for sendVoice/sendAudio. */
export async function synthesize(env: Env, opts: TtsOptions): Promise<Uint8Array> {
  const { response } = await callModel(env, MULTIMODAL.tts, {
    prompt: opts.text,
    lang: opts.lang ?? "en",
  });
  const ct = response.headers.get("content-type") || "";
  if (ct.startsWith("audio/")) {
    return new Uint8Array(await response.arrayBuffer());
  }
  // JSON fallback shape: { result: { audio: "<base64 mp3>" } }
  const j = (await response.json()) as { result?: { audio?: string } };
  const b64 = j.result?.audio;
  if (!b64) throw new Error("TTS returned no audio");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
