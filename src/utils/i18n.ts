// Minimal localisation for welcome and help strings.
// Everything else is auto-translated by the model based on the user's language.

type Locale = "en" | "fa";

interface Strings {
  welcome: string;
  help: string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    welcome: `<b>👋 Welcome to AiRightHand</b>

I'm your AI assistant on Telegram — smart chat, image generation, voice messages, reminders, translations, and more.

<b>Try me:</b>
• Just <i>chat</i> with me — I pick the right model automatically
• <code>/image a cozy cabin in the mountains</code>
• <code>/tts Hello world</code>
• <code>/remind 30m drink water</code>
• <code>/secretary on</code> — personal secretary mode
• <code>/help</code> — full command list`,

    help: `<b>Commands</b>

<b>💬 Chat</b>
• Send any text — I reply with streaming live updates
• Send a photo — I describe it or answer questions about it
• Send a voice note — I transcribe and respond

<b>🧠 Models</b>
• /model fast — quick replies
• /model balanced — best all-rounder
• /model heavy — deep reasoning with visible thinking
• /model auto — let me choose (default)

<b>🎨 Media</b>
• /image &lt;prompt&gt; — generate an image
• /tts &lt;text&gt; — speak it aloud
• /translate &lt;lang&gt;: &lt;text&gt; — translate (reply with /translate &lt;lang&gt;)

<b>📋 Secretary</b>
• /secretary on/off — personal secretary mode
• /todos — view your task list
• /done &lt;n&gt; — mark task complete
• /actions — extract action items from recent chat
• /remind &lt;when&gt; &lt;text&gt; — e.g. "/remind 2h call mom"
• /reminders — list pending reminders
• /summarize — summarize this conversation
• /poll &lt;question&gt; | opt1 | opt2 — quick poll

<b>🧠 Memory</b>
• /recall [topic] — what I remember about you
• /forget — wipe my long-term memory of you

<b>🔧 Owner only</b>
• /stats — usage and AI pool status`,
  },

  fa: {
    welcome: `<b>👋 به AiRightHand خوش آمدید</b>

دستیار هوش مصنوعی شما در تلگرام — چت هوشمند، تولید تصویر، پیام صوتی، یادآور، ترجمه و بیشتر.

<b>امتحان کنید:</b>
• فقط <i>چت</i> کنید — مدل مناسب را خودکار انتخاب می‌کنم
• <code>/image a cozy cabin in the mountains</code>
• <code>/tts سلام دنیا</code>
• <code>/remind 30m آب بنوش</code>
• <code>/secretary on</code> — حالت منشی شخصی
• <code>/help</code> — فهرست کامل دستورات`,

    help: `<b>دستورات</b>

<b>💬 چت</b>
• هر متنی بفرستید — پاسخ زنده با استریم
• عکس بفرستید — توصیف می‌کنم / پاسخ می‌دهم
• پیام صوتی بفرستید — متن + جواب

<b>🧠 مدل‌ها</b>
• /model fast — سریع
• /model balanced — همه‌منظوره
• /model heavy — استدلال عمیق
• /model auto — انتخاب خودکار

<b>🎨 رسانه</b>
• /image &lt;توضیح&gt; — تولید تصویر
• /tts &lt;متن&gt; — تبدیل به صدا
• /translate &lt;زبان&gt;: &lt;متن&gt; — ترجمه

<b>📋 منشی</b>
• /secretary on/off — حالت منشی شخصی
• /todos — لیست وظایف
• /done &lt;شماره&gt; — انجام شد
• /actions — استخراج اقدامات از مکالمه
• /remind &lt;زمان&gt; &lt;متن&gt; — مثلا "/remind 2h زنگ بزن"
• /reminders — یادآورهای در انتظار
• /summarize — خلاصه مکالمه
• /poll &lt;سوال&gt; | گزینه ۱ | گزینه ۲ — نظرسنجی

<b>🧠 حافظه</b>
• /recall [موضوع] — چیزی که از شما می‌دانم
• /forget — پاک کردن حافظه بلندمدت

<b>🔧 فقط مالک</b>
• /stats — آمار استفاده`,
  },
};

export function pickLocale(code?: string | null): Locale {
  if (!code) return "en";
  const c = code.toLowerCase();
  if (c.startsWith("fa") || c === "ir") return "fa";
  return "en";
}

export function localize(code: string | undefined | null, key: keyof Strings): string {
  return STRINGS[pickLocale(code)][key];
}
