// Defensive helpers for handling tool-call JSON that leaks into the assistant's
// visible text.
//
// Some Workers AI chat models (notably the `fast` Llama 3.1 8B instruct
// variant) don't reliably emit OpenAI-style `tool_calls`; instead they dump
// the function-call object as a raw JSON string inside the assistant's
// `content`, e.g.:
//
//   {"type": "function", "name": "send_message",
//    "parameters": {"text": "Hello!", "chat_id": "123456789"}}
//
// If we naively forward that to Telegram, the user sees the JSON instead of
// the answer. Worse: the moderator then sees structured "tool call" text and
// can refuse it. We never want that. This module:
//
//   1) Detects whether a chunk of text looks like a tool-call JSON object.
//   2) Extracts any embedded tool-call objects (top-level OR inside larger text).
//   3) Returns the cleaned, user-facing text plus the extracted calls so the
//      caller can choose to execute them or just discard.
//
// We are intentionally conservative: only obvious tool-call shapes are parsed.
// Plain code blocks containing JSON are left alone.

import type { ToolCall } from "../ai/chat.js";

export interface ParsedLeak {
  /** Text with the leaked tool-call JSON removed. */
  text: string;
  /** Calls reconstructed in OpenAI format so they can be fed to executeTool. */
  calls: ToolCall[];
}

/**
 * Loose check: does the trimmed text look like it's mostly a JSON object
 * describing a function call? Used to decide whether to suppress streaming
 * edits while the buffer is still ambiguous.
 */
export function looksLikeToolCallJSON(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  // Cheap signal: the words we expect to see together.
  const hasFn = /\"(name|function|tool_calls|tool_call|parameters|arguments)\"\s*:/.test(t);
  const hasType = /\"type\"\s*:\s*\"function\"/.test(t);
  return hasFn || hasType;
}

/**
 * Scan `raw` for tool-call shaped JSON objects and return them along with the
 * remaining user-facing text. Handles three shapes we've seen in the wild:
 *
 *   A) `{ "type": "function", "name": "...", "parameters": {...} }`
 *   B) `{ "name": "...", "arguments": "..." | {...} }`
 *   C) `{ "tool_calls": [ {...}, {...} ] }`
 *
 * The objects may appear inside ```json fenced blocks or as bare top-level
 * JSON. They may be repeated. Anything between/around them is preserved.
 */
export function extractToolCalls(raw: string): ParsedLeak {
  if (!raw) return { text: raw, calls: [] };

  const calls: ToolCall[] = [];
  let cleaned = raw;

  // 1) Strip ```json fences first, so the inner JSON becomes scannable as a
  //    top-level object.
  cleaned = cleaned.replace(
    /```(?:json)?\s*([\s\S]*?)```/gi,
    (m, body: string) => {
      const inner = body.trim();
      if (looksLikeToolCallJSON(inner)) {
        const found = scanJsonObjects(inner);
        for (const obj of found.objects) addCall(calls, obj);
        return found.remainder.trim().length ? found.remainder : "";
      }
      return m; // not a tool-call fence — keep as-is
    }
  );

  // 2) Now scan top-level JSON objects (greedy, balanced-brace).
  const scan = scanJsonObjects(cleaned);
  for (const obj of scan.objects) addCall(calls, obj);
  cleaned = scan.remainder;

  // 3) Collapse the leftover whitespace.
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return { text: cleaned, calls };
}

interface Scanned {
  objects: unknown[];
  remainder: string;
}

/**
 * Walk `s` and pull out every balanced `{...}` that, once parsed, smells like a
 * tool-call object. Everything else is preserved in `remainder` in original
 * order.
 */
function scanJsonObjects(s: string): Scanned {
  const objects: unknown[] = [];
  let remainder = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch !== "{") {
      remainder += ch;
      i++;
      continue;
    }
    // Try to find a matching closing brace.
    const end = findMatchingBrace(s, i);
    if (end < 0) {
      remainder += s.slice(i);
      break;
    }
    const candidate = s.slice(i, end + 1);
    if (looksLikeToolCallJSON(candidate)) {
      try {
        const parsed = JSON.parse(candidate);
        if (isToolCallShape(parsed)) {
          objects.push(parsed);
          i = end + 1;
          continue;
        }
      } catch {
        // not valid JSON — fall through
      }
    }
    remainder += s[i];
    i++;
  }
  return { objects, remainder };
}

function findMatchingBrace(s: string, start: number): number {
  let depth = 0;
  let inStr: false | '"' | "'" = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        esc = true;
      } else if (c === inStr) {
        inStr = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c as '"' | "'";
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isToolCallShape(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.tool_calls)) return true;
  if (typeof o.name === "string" && (o.parameters || o.arguments)) return true;
  if (o.type === "function" && o.function && typeof (o.function as any).name === "string") return true;
  if (o.type === "function" && typeof o.name === "string") return true;
  return false;
}

function addCall(out: ToolCall[], raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const o = raw as Record<string, unknown>;

  // Shape C: { tool_calls: [ ... ] }
  if (Array.isArray(o.tool_calls)) {
    for (const c of o.tool_calls) addCall(out, c);
    return;
  }

  // Shape A / OpenAI nested: { type: "function", function: { name, arguments } }
  if (o.type === "function" && o.function && typeof (o.function as any).name === "string") {
    const fn = o.function as { name: string; arguments?: unknown };
    out.push({
      id: typeof o.id === "string" ? (o.id as string) : `leak_${out.length + 1}`,
      type: "function",
      function: {
        name: fn.name,
        arguments: normalizeArgs(fn.arguments),
      },
    });
    return;
  }

  // Shape A flat: { type: "function", name, parameters }
  // Shape B: { name, parameters | arguments }
  if (typeof o.name === "string") {
    const args = o.parameters ?? o.arguments ?? {};
    out.push({
      id: `leak_${out.length + 1}`,
      type: "function",
      function: {
        name: o.name,
        arguments: normalizeArgs(args),
      },
    });
  }
}

function normalizeArgs(a: unknown): string {
  if (a == null) return "{}";
  if (typeof a === "string") {
    // Some models stringify the args twice.
    try {
      const inner = JSON.parse(a);
      if (inner && typeof inner === "object") return JSON.stringify(inner);
    } catch {
      // not JSON — return as object with `_raw`
      return JSON.stringify({ _raw: a });
    }
    return a;
  }
  if (typeof a === "object") return JSON.stringify(a);
  return JSON.stringify({ value: a });
}
