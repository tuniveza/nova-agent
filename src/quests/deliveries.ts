// Deliveries: every Nova Quest ping, from scheduled to delivered, kept in
// data/nova.db so it survives restarts.
//
//   scheduled → sent → delivered        a phone took it (the worker says phones > 0)
//                    ↘ retrying         turned away, unreachable or no phone: tried again
//                         ↘ expired     still not through when it stopped being worth
//                                       sending (its ttl): given up on, and said so
//   acknowledged                         the session was marked done (by hand or a tap)
//   covered                              one of several sessions told about in a single
//                                        ping ("missed 10:30, 11:00 and 11:30"): it goes
//                                        as far as that ping does
//
// Each ping has a key, so it's sent once however often it's asked for:
// quest id + session start + kind ("water|2026-10-07T10:30|starting").
// The planner asks `sessionDelivery()` before it moves a repeat past a session:
// a session with no record, or one still on its way, isn't used up.
// Every attempt is logged (the `attempts` table) with what went wrong.

import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config";
import { trace } from "../trace";

export type DeliveryState = "scheduled" | "sent" | "retrying" | "delivered" | "expired" | "acknowledged" | "covered";

export interface Delivery {
  key: string;
  questId: string;
  session: string; // the session's start ("" for notices that aren't about a session)
  kind: string;
  state: DeliveryState;
  attempts: number;
  phones: number;
  lastError: string;
  created: number; // ms
  delivered: number | null;
}

export interface Attempt {
  key: string;
  at: number;
  ok: boolean;
  status: number | null;
  phones: number;
  error: string;
}

// What's sent to the worker's /hub/notify
export interface Push {
  title: string;
  message: string;
  source: "quest" | "mission";
  kind: string;
  tag: string;
  ttl: number; // seconds it's worth delivering
  urgent: boolean;
  keep: boolean;
}

// Waits between tries: 15 s, 30 s, 1 min, 2 min, then every 5 min (until the ttl runs out)
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
// A "sent" that never came back (the process stopped mid-send) is tried again after this
const STUCK_MS = 60_000;
// Session records are kept a month; pulse beats (many a minute) a day
const KEEP_MS = 31 * 86_400_000;
const KEEP_PULSES_MS = 86_400_000;

let db: DatabaseSync | undefined;
function open(): DatabaseSync {
  if (db) return db;
  mkdirSync(config.paths.dataDir, { recursive: true });
  db = new DatabaseSync(`${config.paths.dataDir}nova.db`);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS deliveries (
      key TEXT PRIMARY KEY,
      quest_id TEXT NOT NULL,
      session TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      push TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      phones INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created INTEGER NOT NULL,
      next_try INTEGER,
      sent INTEGER,
      delivered INTEGER,
      covered_by TEXT
    );
    CREATE INDEX IF NOT EXISTS deliveries_session ON deliveries (quest_id, session);
    CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries (state, next_try);
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      at INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      status INTEGER,
      phones INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS attempts_key ON attempts (key);
    CREATE TABLE IF NOT EXISTS applied_taps (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    );
  `);
  // Anything left mid-send when the process stopped goes back in the queue
  db.prepare("UPDATE deliveries SET state = 'retrying', next_try = ? WHERE state IN ('scheduled', 'sent')").run(Date.now());
  return db;
}

// For tests (and a clean shutdown)
export function closeDeliveries(): void {
  db?.close();
  db = undefined;
}

const row = (r: any): Delivery => ({ key: r.key, questId: r.quest_id, session: r.session, kind: r.kind, state: r.state, attempts: r.attempts, phones: r.phones, lastError: r.last_error, created: r.created, delivered: r.delivered ?? null });

export const deliveryKey = (questId: string, session: string, kind: string) => `${questId}|${session}|${kind}`;

// Called when a ping couldn't be delivered in time (set by reminders.ts, so the page hears of it)
let onGiveUp: (d: Delivery, push: Push) => void = () => {};
export function whenGivenUp(fn: (d: Delivery, push: Push) => void): void {
  onGiveUp = fn;
}

// Send a ping once. Returns false if this key was already sent (or is on its way).
// `push: null` is a page-only notice (phones off): delivered as soon as it's shown.
// `covers`: other sessions the same ping tells about (they go as far as it does).
export function deliver(n: { questId: string; session: string; kind: string; push: Push | null; covers?: string[] }): boolean {
  const d = open();
  const key = deliveryKey(n.questId, n.session, n.kind);
  const now = Date.now();
  const added = d.prepare("INSERT OR IGNORE INTO deliveries (key, quest_id, session, kind, state, push, created, delivered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(key, n.questId, n.session, n.kind, n.push ? "scheduled" : "delivered", n.push ? JSON.stringify(n.push) : null, now, n.push ? null : now);
  if (!added.changes) return false;
  const cover = d.prepare("INSERT OR IGNORE INTO deliveries (key, quest_id, session, kind, state, created, covered_by) VALUES (?, ?, ?, ?, 'covered', ?, ?)");
  for (const session of n.covers ?? []) cover.run(deliveryKey(n.questId, session, n.kind), n.questId, session, n.kind, now, key);
  if (n.push) void attempt(key);
  return true;
}

// One try at getting a ping to the phones, through Nova Bot's worker
async function attempt(key: string): Promise<void> {
  const d = open();
  const r = d.prepare("SELECT * FROM deliveries WHERE key = ?").get(key) as any;
  if (!r || !r.push) return;
  const push = JSON.parse(r.push) as Push;
  d.prepare("UPDATE deliveries SET state = 'sent', sent = ?, attempts = attempts + 1 WHERE key = ?").run(Date.now(), key);
  let status: number | null = null;
  let phones = 0;
  let error = "";
  try {
    if (!config.agentNovaKey) throw new Error("AGENT_NOVA_KEY isn't set");
    const response = await fetch(`${config.workerUrl}/hub/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify(push),
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
    if (!response.ok) throw new Error(`the worker answered ${response.status}`);
    phones = Number(((await response.json()) as { phones?: unknown }).phones) || 0;
    if (phones < 1) throw new Error("no phone took it (is Nova Hub subscribed on a phone?)");
  } catch (e) {
    error = (e as Error).message || String(e);
  }
  const at = Date.now();
  if (db !== d) return; // closed meanwhile (a restart): the next start picks it up
  d.prepare("INSERT INTO attempts (key, at, ok, status, phones, error) VALUES (?, ?, ?, ?, ?, ?)").run(key, at, error ? 0 : 1, status, phones, error);
  if (!error) {
    d.prepare("UPDATE deliveries SET state = 'delivered', delivered = ?, phones = ?, last_error = '', next_try = NULL WHERE key = ? AND state = 'sent'").run(at, phones, key);
    return;
  }
  const wait = BACKOFF_MS[Math.min(r.attempts, BACKOFF_MS.length - 1)];
  d.prepare("UPDATE deliveries SET state = 'retrying', last_error = ?, next_try = ? WHERE key = ? AND state = 'sent'").run(error, at + wait, key);
  if (r.attempts === 0) trace("task", "warn", `Nova Quest ping “${push.title}” didn't reach the phones: ${error}. Trying again.`);
}

// Try again whatever's due (run by the reminders tick); give up on what's gone stale
export function retryDue(): void {
  const d = open();
  const now = Date.now();
  d.prepare("UPDATE deliveries SET state = 'retrying', next_try = ? WHERE state = 'sent' AND sent < ?").run(now, now - STUCK_MS);
  for (const r of d.prepare("SELECT * FROM deliveries WHERE state = 'retrying' AND next_try <= ?").all(now) as any[]) {
    const push = JSON.parse(r.push) as Push;
    if (now >= r.created + push.ttl * 1000) {
      d.prepare("UPDATE deliveries SET state = 'expired', next_try = NULL WHERE key = ?").run(r.key);
      trace("task", "error", `Nova Quest ping “${push.title}” never reached the phones (${r.attempts} tries, last: ${r.last_error}). Given up.`);
      onGiveUp(row({ ...r, state: "expired" }), push);
      continue;
    }
    void attempt(r.key);
  }
  d.prepare("DELETE FROM deliveries WHERE created < ? OR (kind = 'pulse' AND created < ?)").run(now - KEEP_MS, now - KEEP_PULSES_MS);
  d.prepare("DELETE FROM attempts WHERE at < ?").run(now - KEEP_MS);
}

// Where a session's ping has got to: the furthest-on of its pings ("starting", "leave", "missed")
const RANK: Record<DeliveryState, number> = { covered: 0, scheduled: 1, sent: 1, retrying: 1, expired: 2, delivered: 3, acknowledged: 4 };
export function sessionDelivery(questId: string, session: string): Delivery | null {
  const d = open();
  const rows = (d.prepare("SELECT * FROM deliveries WHERE quest_id = ? AND session = ? AND kind IN ('starting', 'leave', 'missed')").all(questId, session) as any[]).map((r) => {
    // A covered session is as far on as the ping that covers it
    const by = r.covered_by && (d.prepare("SELECT state, delivered FROM deliveries WHERE key = ?").get(r.covered_by) as any);
    return row(by ? { ...r, state: by.state, delivered: by.delivered } : r);
  });
  return rows.sort((a, b) => RANK[b.state] - RANK[a.state])[0] ?? null;
}
// Has this session been dealt with (delivered, given up on visibly, or marked done)?
export const sessionSettled = (d: Delivery | null) => !!d && RANK[d.state] >= 2;

// The session was marked done: that settles it, whether or not a ping got through
export function acknowledge(questId: string, session: string): void {
  if (!session) return;
  const d = open();
  const now = Date.now();
  const updated = d.prepare("UPDATE deliveries SET state = 'acknowledged', next_try = NULL, covered_by = NULL WHERE quest_id = ? AND session = ? AND kind IN ('starting', 'leave', 'missed')").run(questId, session);
  if (!updated.changes) d.prepare("INSERT OR IGNORE INTO deliveries (key, quest_id, session, kind, state, created) VALUES (?, ?, ?, 'starting', 'acknowledged', ?)").run(deliveryKey(questId, session, "starting"), questId, session, now);
}

// Nova Hub taps carry an id: true the first time one is seen, false after (a tap
// can be handed over twice; it must only count once)
export function firstTimeForTap(id: string): boolean {
  const d = open();
  d.prepare("DELETE FROM applied_taps WHERE at < ?").run(Date.now() - KEEP_MS);
  return d.prepare("INSERT OR IGNORE INTO applied_taps (id, at) VALUES (?, ?)").run(id, Date.now()).changes > 0;
}

// The log of tries, oldest first (for one quest, or all)
export function attempts(questId?: string): Attempt[] {
  const rows = questId
    ? open().prepare("SELECT a.* FROM attempts a JOIN deliveries d ON d.key = a.key WHERE d.quest_id = ? ORDER BY a.id").all(questId)
    : open().prepare("SELECT * FROM attempts ORDER BY id").all();
  return (rows as any[]).map((a) => ({ key: a.key, at: a.at, ok: !!a.ok, status: a.status ?? null, phones: a.phones, error: a.error }));
}

// For a health page: what's waiting, and when a ping last got through
export function deliveryHealth(): { waiting: number; expiredToday: number; lastDelivered: number | null } {
  const d = open();
  const waiting = (d.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE state IN ('scheduled', 'sent', 'retrying')").get() as any).n;
  const expiredToday = (d.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE state = 'expired' AND created > ?").get(Date.now() - 86_400_000) as any).n;
  const last = (d.prepare("SELECT MAX(delivered) AS t FROM deliveries WHERE state = 'delivered'").get() as any).t;
  return { waiting, expiredToday, lastDelivered: last ?? null };
}
