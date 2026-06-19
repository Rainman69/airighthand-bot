// Minimal localisation. Right now we ship English + Persian (fa) for the
// welcome and help strings — everything else is auto-translated by the model
// based on the user's input language.
//
// To add a locale: add another entry to STRINGS and (optionally) extend
// `pickLocale` if the language_code mapping isn't already obvious.

type Locale = "en" | "fa";

interface Strings {
  welcome: string;
  help: string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    welcome: `<b>👋 Welcome to AiRightHand</b>

I'm your AI right hand on Telegram — quick replies, deep analysis, image generation, voice, reminders, and more.

<b>Try:</b>
• Just <i>chat</i> with me — I pick the right model automatically.
• <code>/image a cozy reading nook at golden hour</code>
• <code>/tts Hello world</code>
• <code>/remind 30m drink water</code>
• <code>/model fast | balanced | heavy | auto</code>
• <code>/help</code> — full menu

<i>Powered by Cloudflare Workers AI.</i>`,
    help: `<b>Commands</b>

<b>Chat</b>
• Send any text — I'll reply (streaming).
• Send a photo — I'll describe it / answer questions about it.
• Send a voice note — I'll transcribe and respond.

<b>Models</b>
• /model fast — quick replies
• /model balanced — best all-rounder (default for longer prompts)
• /model heavy — deep reasoning with visible thinking
• /model auto — let me choose

<b>Media</b>
• /image &lt;prompt&gt; — generate an image
• /tts &lt;text&gt; — speak it
• /translate &lt;lang&gt;: &lt;text&gt; — fast m2m100 translation (or reply with /translate &lt;lang&gt;)
• Reply to a voice/audio — I'll transcribe + answer

<b>Secretary</b>
• /remind &lt;when&gt; &lt;text&gt; — e.g. "/remind 2h call mom"
• /summarize — summarize this conversation
• /poll &lt;question&gt; | opt1 | opt2 | ... — quick poll
• /recall [topic] — what I remember about you
• /forget — wipe my long-term memory of you
• /relay @other_bot &lt;text&gt; — relay a message to another bot
• /buy — support with Telegram Stars ⭐

<b>Owner only</b>
• /stats — usage and account-pool status`,
  },

  fa: {
    welcome: `<b>👋 به AiRightHand خوش آمدید</b>

من دستیار هوش مصنوعی شما در تلگرام هستم — پاسخ‌های سریع، تحلیل عمیق، تولید تصویر، تبدیل صدا و یادآور.

<b>امتحان کنید:</b>
• فقط با من <i>چت</i> کنید — مدل مناسب را خودکار انتخاب می‌کنم.
• <code>/image a cozy reading nook at golden hour</code>
• <code>/tts سلام دنیا</code>
• <code>/remind 30m آب بنوش</code>
• <code>/model fast | balanced | heavy | auto</code>
• <code>/help</code> — منوی کامل

<i>قدرت‌گرفته از Cloudflare Workers AI.</i>`,
    help: `<b>فرمان‌ها</b>

<b>چت</b>
• هر متنی بفرستید — پاسخ خواهم داد (با جریان زنده).
• عکس بفرستید — توصیف می‌کنم / به سوالات درباره‌اش پاسخ می‌دهم.
• پیام صوتی بفرستید — متن می‌کنم و پاسخ می‌دهم.

<b>مدل‌ها</b>
• /model fast — پاسخ سریع
• /model balanced — همه‌منظوره
• /model heavy — استدلال عمیق با نمایش فکر
• /model auto — انتخاب خودکار

<b>رسانه</b>
• /image &lt;متن&gt; — تولید تصویر
• /tts &lt;متن&gt; — تبدیل به صدا
• /translate &lt;زبان&gt;: &lt;متن&gt; — ترجمه سریع با m2m100 (یا پاسخ با /translate &lt;زبان&gt;)
• پاسخ به پیام صوتی — متن + جواب

<b>منشی</b>
• /remind &lt;زمان&gt; &lt;متن&gt; — مثلا "/remind 2h زنگ بزن مامان"
• /summarize — خلاصه مکالمه
• /poll &lt;سوال&gt; | گزینه ۱ | گزینه ۲ | ...
• /recall [موضوع] — چیزی که از شما به یاد دارم
• /forget — پاک کردن حافظه بلندمدت
• /relay @other_bot &lt;متن&gt; — ارسال پیام به ربات دیگر
• /buy — حمایت با Stars تلگرام ⭐

<b>فقط مالک</b>
• /stats — وضعیت استفاده و آکانت‌های هوش مصنوعی`,
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
