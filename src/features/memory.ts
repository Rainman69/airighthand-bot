// Per-user long-term memory.
//
// Strategy:
//   - After every assistant turn, ask a cheap (fast) model to distil 0–3 short
//     facts about the user from the latest exchange ("the user lives in Tehran",
//     "the user prefers concise replies", …). Anything generic ("user said hi")
//     is rejected.
//   - Each fact is embedded with BGE-M3 and stored in D1's `memory` table.
//   - On every new request, embed the user's question, run a cosine top-k
//     against the user's stored memories (in-memory — N is small per user),
//     and prepend the best 3–5 hits to the system prompt.
//
// The `memory` table is created by `storage/d1.ts`. The `embedding` column
// stores JSON-stringified float arrays — D1 BLOBs are awkward to read across
// Workers boundaries and at N≲10⁴ per user JSON is fast enough.
//
// Privacy: memories belong to a single Telegram user_id. They're never shown
// to anyone else, and `redact()` runs on the recalled text before it lands in
// the prompt — defence in depth against the user pasting tokens into chat.

import type { Env } from "../env.js";
import { embed, cosine } from "../ai/embeddings.js";
import { chatComplete } from "../ai/chat.js";
import { redact } from "../utils/secrets.js";
import { log } from "../utils/log.js";

const MAX_FACTS_PER_USER = 200;
const RECALL_K = 5;
const RECALL_MIN_SIM = 0.45;

interface MemoryRow {
  id: number;
  fact: string;
  embedding: string | null; // JSON-stringified number[]
  created_at: number;
}

/** Save a fact verbatim (used by the `remember_fact` tool). */
export async function rememberFact(
  env: Env,
  userId: number,
  fact: string
): Promise<void> {
  const clean = redact(fact).trim().slice(0, 300);
  if (!clean) return;

  let embJson: string | null = null;
  try {
    const [vec] = await embed(env, [clean]);
    if (vec && vec.length) embJson = JSON.stringify(vec);
  } catch (e) {
    log.warn("memory: embed failed (storing without vector)", {
      err: e instanceof Error ? e.message : String(e),
    });
  }

  await env.DB.prepare(
    "INSERT INTO memory (user_id, fact, embedding, created_at) VALUES (?1, ?2, ?3, ?4)"
  )
    .bind(userId, clean, embJson, Date.now())
    .run();

  await pruneOldest(env, userId);
}

/** Top-K most relevant facts for the user's current question, by cosine sim. */
export async function recallRelevant(
  env: Env,
  userId: number,
  query: string,
  k = RECALL_K
): Promise<string[]> {
  if (!query.trim()) return [];

  let qVec: number[] | null = null;
  try {
    const [v] = await embed(env, [query]);
    if (v && v.length) qVec = v;
  } catch (e) {
    log.warn("memory: query embed failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
  if (!qVec) return [];

  const r = await env.DB.prepare(
    "SELECT id, fact, embedding, created_at FROM memory WHERE user_id = ?1 ORDER BY id DESC LIMIT 500"
  )
    .bind(userId)
    .all<MemoryRow>();

  const scored: { fact: string; score: number }[] = [];
  for (const row of r.results ?? []) {
    if (!row.embedding) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding) as number[];
    } catch {
      continue;
    }
    if (vec.length !== qVec.length) continue;
    const s = cosine(qVec, vec);
    if (s >= RECALL_MIN_SIM) scored.push({ fact: row.fact, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((x) => redact(x.fact));
}

/**
 * After an assistant turn, ask the fast tier to extract 0–3 durable user facts.
 * Returns the count distilled (for logging). Best-effort: failure is silent.
 */
export async function distilFacts(
  env: Env,
  userId: number,
  userText: string,
  assistantText: string
): Promise<number> {
  // Quick gate: skip on tiny exchanges — nothing to remember.
  if (userText.length < 20 && assistantText.length < 20) return 0;

  const prompt = `You extract durable, *useful* facts about the user from a single chat exchange.

Return a JSON array of 0 to 3 short strings (≤ 120 chars each). Each must be:
- ABOUT THE USER (their name, location, role, preferences, projects, goals, ongoing tasks)
- DURABLE (true in a week, not "user said hi")
- SPECIFIC ("the user is learning Rust" not "user is a programmer")

If nothing qualifies, return [].

Exchange:
USER: ${userText.slice(0, 1200)}
ASSISTANT: ${assistantText.slice(0, 1200)}

JSON only, no prose.`;

  let raw = "";
  try {
    const r = await chatComplete(env, {
      tier: "fast",
      messages: [
        { role: "system", content: "You output ONLY a JSON array of strings." },
        { role: "user", content: prompt },
      ],
      max_tokens: 200,
      temperature: 0.2,
    });
    raw = r.text;
  } catch (e) {
    log.warn("memory: distil failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }

  const facts = parseFactsList(raw);
  let saved = 0;
  for (const fact of facts) {
    if (await isDuplicate(env, userId, fact)) continue;
    await rememberFact(env, userId, fact);
    saved++;
  }
  if (saved) log.info("memory: distilled facts", { userId, saved });
  return saved;
}

/** Extract the first JSON array of strings from arbitrary model output. */
function parseFactsList(raw: string): string[] {
  if (!raw) return [];
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter((s) => s.length >= 5 && s.length <= 200)
      .slice(0, 3);
  } catch {
    return [];
  }
}

/** Cheap pre-check to avoid re-saving the same fact twice. */
async function isDuplicate(
  env: Env,
  userId: number,
  fact: string
): Promise<boolean> {
  const lower = fact.toLowerCase();
  const r = await env.DB.prepare(
    "SELECT fact FROM memory WHERE user_id = ?1 ORDER BY id DESC LIMIT 50"
  )
    .bind(userId)
    .all<{ fact: string }>();
  for (const row of r.results ?? []) {
    if (row.fact.toLowerCase() === lower) return true;
  }
  return false;
}

/** Cap how many memories we keep per user so storage and recall stay snappy. */
async function pruneOldest(env: Env, userId: number): Promise<void> {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM memory WHERE user_id = ?1"
  )
    .bind(userId)
    .first<{ c: number }>();
  const c = count?.c ?? 0;
  if (c <= MAX_FACTS_PER_USER) return;
  const drop = c - MAX_FACTS_PER_USER;
  await env.DB.prepare(
    `DELETE FROM memory WHERE id IN (
       SELECT id FROM memory WHERE user_id = ?1 ORDER BY id ASC LIMIT ?2
     )`
  )
    .bind(userId, drop)
    .run();
}

/** Render the recall block we prepend to the system prompt. */
export function buildMemoryBlock(facts: string[]): string {
  if (!facts.length) return "";
  const list = facts.map((f) => `- ${f}`).join("\n");
  return `Known facts about this user (recalled from prior conversations; use them naturally, don't enumerate them back):\n${list}`;
}
