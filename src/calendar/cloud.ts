// Calendar, kept the same here and on Nova Bot.
//
// Nova Bot holds the studio's calendar (D1), so the Calendar panel works from anywhere,
// even with this PC off. Nova Agent keeps its own copy here (data/calendar.json, see
// store.ts) because its chat and planner read it all the time; this keeps the two the same:
// every so often, and soon after anything changes here, it sends what changed here and takes
// what changed there (POST /nova-agent/calendar). The latest change wins on both sides.
//
// What it last sent is remembered (data/calendar-cloud.json: a fingerprint per item), so
// only real changes go, and an item that disappears here is deleted there too.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { config } from "../config";
import { trace } from "../trace";
import { calendarEvents, readCalendar, writeCalendar, type CalendarData, type DayCard, type NoteCard } from "./store";

type Item = (NoteCard & { kind: "event" }) | (DayCard & { kind: "day" });
type Gone = { id: string; kind: string; deleted: true; updated: string };
type State = { rev: number; sent: Record<string, string> };

const stateFile = `${config.paths.dataDir}calendar-cloud.json`;
const EVERY_MS = 20_000;
const SOON_MS = 1500;

function readState(): State {
  try {
    const s = JSON.parse(readFileSync(stateFile, "utf8"));
    return { rev: Number(s.rev) || 0, sent: s.sent && typeof s.sent === "object" ? s.sent : {} };
  } catch {
    return { rev: 0, sent: {} };
  }
}
function saveState(s: State) {
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(s));
  renameSync(`${stateFile}.tmp`, stateFile);
}

// What an item is, apart from when it was saved (so re-saving the same thing isn't a change)
// (keys in a fixed order at every level, so the same content always gives the same print)
const stable = (v: any): any =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
function fingerprint(item: object): string {
  const { updated, created, rev, ...rest } = item as any;
  return createHash("sha1").update(JSON.stringify(stable(rest))).digest("hex");
}

export function itemsOf(data: CalendarData): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const n of data.notes) out.set(n.id, { ...n, kind: "event" });
  for (const d of data.days) out.set(d.id, { ...d, kind: "day" });
  return out;
}

// Put Nova Bot's changes into the local copy. A local change that's newer and not sent yet stays.
export function applyRemote(data: CalendarData, remote: (Item | Gone)[], state: State): boolean {
  const local = itemsOf(data);
  let changed = false;
  for (const r of remote) {
    const mine = local.get(r.id);
    const unsent = mine && state.sent[r.id] !== fingerprint(mine);
    if (mine && unsent && mine.updated > r.updated) continue;
    if ("deleted" in r && r.deleted) {
      delete state.sent[r.id];
      if (!mine) continue;
      data.notes = data.notes.filter((n) => n.id !== r.id);
      data.days = data.days.filter((d) => d.id !== r.id);
      local.delete(r.id);
      changed = true;
      continue;
    }
    const item = r as Item;
    const print = fingerprint(item);
    state.sent[item.id] = print;
    if (mine && fingerprint(mine) === print) continue;
    const { kind, ...rest } = item as any;
    if (kind === "day") {
      data.notes = data.notes.filter((n) => n.id !== item.id);
      const i = data.days.findIndex((d) => d.id === item.id);
      if (i >= 0) data.days[i] = rest;
      else data.days.push(rest);
    } else {
      data.days = data.days.filter((d) => d.id !== item.id);
      const i = data.notes.findIndex((n) => n.id === item.id);
      if (i >= 0) data.notes[i] = rest;
      else data.notes.push(rest);
    }
    local.set(item.id, item);
    changed = true;
  }
  return changed;
}

let running: Promise<void> | null = null;
let again = false;
let lastProblem = "";

// One round: send what changed here, take what changed there
export async function syncCalendarNow(): Promise<void> {
  if (!config.agentNovaKey) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      const state = readState();
      const local = itemsOf(readCalendar());
      const prints = new Map<string, string>();
      const upserts: Item[] = [];
      for (const [id, item] of local) {
        const print = fingerprint(item);
        prints.set(id, print);
        if (state.sent[id] !== print) upserts.push(item);
      }
      const deletes = Object.keys(state.sent)
        .filter((id) => !local.has(id))
        .map((id) => ({ id, updated: new Date().toISOString() }));
      const res = await fetch(`${config.workerUrl}/nova-agent/calendar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.agentNovaKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ since: state.rev, upserts, deletes }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Nova Bot said ${res.status}`);
      const reply = (await res.json()) as { rev: number; items: (Item | Gone)[]; rejected: (Item | Gone)[] };
      // Sent: remembered as sent (unless Nova Bot had something newer: that comes back below)
      for (const item of upserts) state.sent[item.id] = prints.get(item.id)!;
      for (const d of deletes) delete state.sent[d.id];
      // Read again: something may have changed here while the request was out
      const data = readCalendar();
      const changed = applyRemote(data, [...(reply.rejected || []), ...(reply.items || [])], state);
      state.rev = Math.max(state.rev, Number(reply.rev) || 0);
      if (changed) writeCalendar(data, true);
      saveState(state);
      if (lastProblem) trace("task", "ok", "Calendar is in step with Nova Bot again");
      lastProblem = "";
      if (upserts.length || deletes.length || changed) {
        trace("task", "ok", `Calendar synced with Nova Bot: ${upserts.length} sent, ${deletes.length} deleted, ${reply.items.length} received`);
      }
    } catch (error) {
      const problem = (error as Error).message;
      if (problem !== lastProblem) trace("task", "warn", `Calendar couldn't sync with Nova Bot: ${problem} (it keeps trying)`);
      lastProblem = problem;
    } finally {
      running = null;
      if (again) {
        again = false;
        void syncCalendarNow();
      }
    }
  })();
  return running;
}

let started = false;
// Keep syncing: now, soon after each change here, and every 20 seconds
export function startCalendarCloud(): void {
  if (started || !config.agentNovaKey) return;
  started = true;
  let soon: NodeJS.Timeout | undefined;
  calendarEvents.on("change", () => {
    clearTimeout(soon);
    soon = setTimeout(() => void syncCalendarNow(), SOON_MS);
  });
  setInterval(() => void syncCalendarNow(), EVERY_MS).unref();
  void syncCalendarNow();
  trace("task", "ok", "Calendar: kept in step with Nova Bot (works from anywhere)");
}

// Exists for tests
export const _internal = { fingerprint, readState, saveState, stateFile: () => stateFile, exists: () => existsSync(stateFile) };
