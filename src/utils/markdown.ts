// Minimal helpers to make model output safe for Telegram's HTML parse mode.
//
// We prefer HTML over MarkdownV2 because Telegram's HTML is more forgiving and
// supports useful niceties (expandable blockquote, <tg-spoiler>, <code lang="…">).

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
};

/** Escape arbitrary text so it can be embedded as HTML text content. */
export function htmlEscape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESC[c]);
}

/**
 * Render `<think>…</think>` blocks emitted by reasoning models (DeepSeek R1,
 * QwQ) as expandable HTML blockquotes; render fenced code blocks as <pre><code>.
 *
 * Everything else is escaped. We deliberately avoid bold/italic/etc. parsing —
 * Telegram clients render the plain text just fine, and we don't want to ship
 * a full Markdown parser.
 */
export function renderForTelegram(raw: string): string {
  let s = raw;

  // 1) Pull <think> blocks aside so their contents aren't escaped twice.
  const thinks: string[] = [];
  s = s.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, body) => {
    thinks.push(body);
    return `\u0000THINK${thinks.length - 1}\u0000`;
  });

  // 2) Pull fenced code blocks aside.
  const codes: { lang: string; body: string }[] = [];
  s = s.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_m, lang, body) => {
    codes.push({ lang: lang || "", body });
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  // 3) Escape everything else.
  s = htmlEscape(s);

  // 4) Re-inject think blocks as expandable blockquotes.
  s = s.replace(/\u0000THINK(\d+)\u0000/g, (_m, i) => {
    const body = htmlEscape((thinks[Number(i)] ?? "").trim());
    return `<blockquote expandable>💭 ${body}</blockquote>`;
  });

  // 5) Re-inject code blocks.
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => {
    const c = codes[Number(i)];
    if (!c) return "";
    const body = htmlEscape(c.body.replace(/\n$/, ""));
    if (c.lang) return `<pre><code class="language-${htmlEscape(c.lang)}">${body}</code></pre>`;
    return `<pre>${body}</pre>`;
  });

  return s;
}

/** Telegram messages cap at 4096 chars. Chunk safely on newlines when possible. */
export function chunkForTelegram(s: string, limit = 4000): string[] {
  if (s.length <= limit) return [s];
  const parts: string[] = [];
  let buf = "";
  for (const line of s.split("\n")) {
    if (buf.length + line.length + 1 > limit) {
      parts.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) parts.push(buf);
  return parts;
}
