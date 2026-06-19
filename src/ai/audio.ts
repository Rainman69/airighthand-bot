// Speech-to-text (Whisper) and text-to-speech (MeloTTS) via Workers AI.

import type { Env } from "../env.js";
import { MULTIMODAL } from "./models.js";
import { callModel } from "./pool.js";

/** Transcribe a voice/audio file. `bytes` should be the raw OGG/MP3/WAV body. */
export async function transcribe(env: Env, bytes: Uint8Array): Promise<string> {
  // whisper-large-v3-turbo on CF accepts a JSON body with `audio` as a base64
  // string. (The older whisper-tiny endpoint accepted byte arrays; the turbo
  // variant explicitly rejects array input and requires base64.)
  const audio = bytesToBase64(bytes);
  const { response } = await callModel(env, MULTIMODAL.stt, { audio });
  const j = (await response.json()) as { result?: { text?: string } };
  return j.result?.text ?? "";
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked conversion to avoid call-stack overflow on long audio.
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  return btoa(bin);
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
