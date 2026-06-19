// D1 schema bootstrap and convenience helpers.
//
// We use a single migrating `init()` call at the start of the request lifecycle
// (idempotent CREATE TABLE IF NOT EXISTS). For larger schemas, switch to proper
// migrations via `wrangler d1 migrations`.

import type { Env } from "../env.js";

let initialised = false;

export async function initDB(env: Env): Promise<void> {
  if (initialised) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
      user_id     INTEGER PRIMARY KEY,
      username    TEXT,
      lang        TEXT,
      model_pin   TEXT,    -- 'fast'|'balanced'|'heavy'|'auto'
      is_pro      INTEGER DEFAULT 0,
      pro_until   INTEGER,
      created_at  INTEGER,
      requests    INTEGER DEFAULT 0
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      chat_id     INTEGER NOT NULL,
      role        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      created_at  INTEGER NOT NULL
    )`),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_history_user_time ON history(user_id, created_at)`
    ),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      chat_id     INTEGER NOT NULL,
      due_at      INTEGER NOT NULL,
      text        TEXT    NOT NULL,
      done        INTEGER DEFAULT 0
    )`),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(done, due_at)`
    ),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS memory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      fact        TEXT    NOT NULL,
      embedding   BLOB,
      created_at  INTEGER NOT NULL
    )`),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(user_id)`
    ),
  ]);
  // SQLite has no `ADD COLUMN IF NOT EXISTS`; we do it per-column and swallow
  // the "duplicate column" error so repeated boots are idempotent.
  await addColumnIfMissing(env, "users", "last_tier", "TEXT");
  initialised = true;
}

async function addColumnIfMissing(
  env: Env,
  table: string,
  column: string,
  type: string
): Promise<void> {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch {
    // Column already exists — fine.
  }
}

export interface UserRow {
  user_id: number;
  username: string | null;
  lang: string | null;
  model_pin: "fast" | "balanced" | "heavy" | "auto" | null;
  is_pro: number;
  pro_until: number | null;
  created_at: number | null;
  requests: number;
  last_tier: "fast" | "balanced" | "heavy" | null;
}

export async function getOrCreateUser(
  env: Env,
  user_id: number,
  username?: string,
  lang?: string
): Promise<UserRow> {
  await initDB(env);
  const existing = await env.DB.prepare(
    "SELECT * FROM users WHERE user_id = ?1"
  )
    .bind(user_id)
    .first<UserRow>();
  if (existing) return existing;

  await env.DB.prepare(
    "INSERT INTO users (user_id, username, lang, model_pin, created_at) VALUES (?1, ?2, ?3, 'auto', ?4)"
  )
    .bind(user_id, username ?? null, lang ?? null, Date.now())
    .run();
  return {
    user_id,
    username: username ?? null,
    lang: lang ?? null,
    model_pin: "auto",
    is_pro: 0,
    pro_until: null,
    created_at: Date.now(),
    requests: 0,
    last_tier: null,
  };
}

export async function setLastTier(
  env: Env,
  user_id: number,
  tier: "fast" | "balanced" | "heavy"
): Promise<void> {
  await env.DB.prepare("UPDATE users SET last_tier = ?1 WHERE user_id = ?2")
    .bind(tier, user_id)
    .run();
}

export async function bumpRequestCount(env: Env, user_id: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET requests = COALESCE(requests, 0) + 1 WHERE user_id = ?1"
  )
    .bind(user_id)
    .run();
}

export async function setUserModelPin(
  env: Env,
  user_id: number,
  pin: "fast" | "balanced" | "heavy" | "auto"
): Promise<void> {
  await env.DB.prepare("UPDATE users SET model_pin = ?1 WHERE user_id = ?2")
    .bind(pin, user_id)
    .run();
}

export async function appendHistory(
  env: Env,
  user_id: number,
  chat_id: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO history (user_id, chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(user_id, chat_id, role, content, Date.now())
    .run();
}

export async function getRecentHistory(
  env: Env,
  user_id: number,
  limit = 20
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const r = await env.DB.prepare(
    `SELECT role, content FROM history
       WHERE user_id = ?1
       ORDER BY id DESC
       LIMIT ?2`
  )
    .bind(user_id, limit)
    .all<{ role: "user" | "assistant"; content: string }>();
  return (r.results ?? []).reverse();
}

export async function dueReminders(env: Env, now: number) {
  await initDB(env);
  return env.DB.prepare(
    `SELECT id, user_id, chat_id, text FROM reminders
       WHERE done = 0 AND due_at <= ?1
       ORDER BY due_at ASC LIMIT 50`
  )
    .bind(now)
    .all<{ id: number; user_id: number; chat_id: number; text: string }>();
}

export async function markReminderDone(env: Env, id: number) {
  await env.DB.prepare("UPDATE reminders SET done = 1 WHERE id = ?1").bind(id).run();
}
