// Raw Telegram Bot API client — used by the tool executor so the LLM can call
// any method, even ones we haven't wrapped explicitly.

import type { Env } from "../env.js";
import { redact } from "../utils/secrets.js";

export class BotApi {
  private base: string;
  constructor(token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  static fromEnv(env: Env): BotApi {
    return new BotApi(env.TELEGRAM_BOT_TOKEN);
  }

  /** Generic call — used by the tool executor. */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) {
      throw new Error(redact(`Telegram ${method} failed: ${j.description ?? "unknown"}`));
    }
    return j.result as T;
  }

  /** Multipart upload — used for sending generated images / audio. */
  async upload<T = unknown>(
    method: string,
    fields: Record<string, string | number | boolean>,
    files: Record<string, { bytes: Uint8Array; filename: string; type: string }>
  ): Promise<T> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    for (const [k, f] of Object.entries(files)) {
      fd.append(k, new Blob([f.bytes], { type: f.type }), f.filename);
    }
    const res = await fetch(`${this.base}/${method}`, { method: "POST", body: fd });
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) {
      throw new Error(redact(`Telegram ${method} upload failed: ${j.description ?? "unknown"}`));
    }
    return j.result as T;
  }

  /** Download a file by file_id. */
  async download(fileId: string): Promise<Uint8Array> {
    const file = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const url = `https://api.telegram.org/file/bot${this.base.split("/bot")[1]}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
