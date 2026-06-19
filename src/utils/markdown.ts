// Minimal helpers to make model output safe for Telegram's HTML parse mode.
//
// We prefer HTML over MarkdownV2 because Telegram's HTML is more forgiving and
// supports niceties (expandable blockquote, <tg-spoiler>, <code lang="…">).

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
 * Render model output to Telegram-safe HTML.
 *
 * Handles:
 * - <think>…</think> blocks (DeepSeek R1) → expandable blockquotes
 * - Fenced code blocks → <pre><code>
 * - **bold** → <b>
 * - *italic* / _italic_ → <i>
 * - `inline code` → <code>
 * - ### Headings → <b>
 * - Everything else is HTML-escaped
 */
export function renderForTelegram(raw: string): string {
  let s = raw;

  // 1) Pull <think> blocks aside.
  const thinks: string[] = [];
  s = s.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, body) => {
    thinks.push(body);
    return `\u0000THINK${thinks.length - 1}\u0000`;
  });

  // 2) Pull fenced code blocks aside.
  const codes: { lang: string; body: string }[] = [];
  s = s.replace(/```([a-zA-Z0-9_+\-.]*)\n?([\s\S]*?)```/g, (_m, lang, body) => {
    codes.push({ lang: lang || "", body });
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  // 3) Pull inline code aside.
  const inlineCodes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, body) => {
    inlineCodes.push(body);
    return `\u0000ICODE${inlineCodes.length - 1}\u0000`;
  });

  // 4) HTML-escape everything remaining.
  s = htmlEscape(s);

  // 5) Convert markdown-style bold/italic (after escaping to avoid double-processing).
  // Bold: **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  s = s.replace(/__(.+?)__/g, "<b>$1</b>");
  // Italic: *text* or _text_ (but not **bold** which we already handled)
  s = s.replace(/\*([^*\n]+?)\*/g, "<i>$1</i>");
  s = s.replace(/_([^_\n]+?)_/g, "<i>$1</i>");
  // Headings (# ## ### etc.) → bold
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // 6) Re-inject think blocks as expandable blockquotes.
  s = s.replace(/\u0000THINK(\d+)\u0000/g, (_m, i) => {
    const body = htmlEscape((thinks[Number(i)] ?? "").trim());
    return `<blockquote expandable>💭 ${body}</blockquote>`;
  });

  // 7) Re-inject code blocks.
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => {
    const c = codes[Number(i)];
    if (!c) return "";
    const body = htmlEscape(c.body.replace(/\n$/, ""));
    if (c.lang) return `<pre><code class="language-${htmlEscape(c.lang)}">${body}</code></pre>`;
    return `<pre>${body}</pre>`;
  });

  // 8) Re-inject inline code.
  s = s.replace(/\u0000ICODE(\d+)\u0000/g, (_m, i) => {
    const body = htmlEscape(inlineCodes[Number(i)] ?? "");
    return `<code>${body}</code>`;
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
      if (buf) parts.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) parts.push(buf);
  return parts.filter((p) => p.trim());
}
