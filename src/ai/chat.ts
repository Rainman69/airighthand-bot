// Chat completions over the Cloudflare Workers AI pool.
// Supports streaming (Server-Sent Events) and non-streaming responses, plus the
// OpenAI-style function-calling envelope that Llama 3.3 70B and Hermes 2 Pro
// understand.

import type { Env } from "../env.js";
import { CHAT_MODELS, type Tier } from "./models.js";
import { callModel } from "./pool.js";

export type Role = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  /** For tool replies: name of the tool that produced this content. */
  name?: string;
  /** For tool replies: id of the tool call we're answering. */
  tool_call_id?: string;
  /** For assistant turns that requested tool calls. */
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object; // JSON Schema
  };
}

export interface ChatOptions {
  tier: Tier;
  messages: ChatMessage[];
  tools?: ChatTool[];
  /** Cap the model's output. Defaults to 1024. */
  max_tokens?: number;
  temperature?: number;
}

export interface ChatResult {
  text: string;
  tool_calls?: ToolCall[];
}

/** Non-streaming chat completion. */
export async function chatComplete(env: Env, opts: ChatOptions): Promise<ChatResult> {
  const model = CHAT_MODELS[opts.tier];
  const body: Record<string, unknown> = {
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.tools && opts.tools.length) body.tools = opts.tools;

  const { response } = await callModel(env, model, body);
  const json = (await response.json()) as {
    result?: {
      // Llama / instruct models return OpenAI-style choices[].message.content.
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: ToolCall[] | null };
      }>;
      // DeepSeek-R1 (and the older `response` field) — single string.
      response?: string;
      tool_calls?: ToolCall[];
    };
  };
  const r = json.result ?? {};
  const choice = r.choices?.[0]?.message;
  const text = choice?.content ?? r.response ?? "";
  const tool_calls =
    (choice?.tool_calls && choice.tool_calls.length ? choice.tool_calls : undefined) ??
    r.tool_calls;
  return { text, tool_calls };
}

/** Streaming chat completion. Yields text deltas. */
export async function* chatStream(
  env: Env,
  opts: ChatOptions
): AsyncGenerator<string, void, void> {
  const model = CHAT_MODELS[opts.tier];
  const body: Record<string, unknown> = {
    messages: opts.messages,
    stream: true,
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.tools && opts.tools.length) body.tools = opts.tools;

  const { response } = await callModel(env, model, body, { stream: true });
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by blank lines.
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";

    for (const ev of events) {
      const dataLine = ev
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload) as {
          // OpenAI-style chunk used by Llama instruct models on CF.
          choices?: Array<{ delta?: { content?: string | null } }>;
          // Legacy / DeepSeek-style chunk.
          response?: unknown;
        };
        const delta = obj.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length) {
          yield delta;
          continue;
        }
        const fallback = obj.response;
        if (typeof fallback === "string" && fallback.length) {
          yield fallback;
        } else if (typeof fallback === "number") {
          // CF sometimes coerces digit-only tokens to numbers; preserve them.
          yield String(fallback);
        }
      } catch {
        // ignore malformed line
      }
    }
  }
}
