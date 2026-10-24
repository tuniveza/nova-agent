// The studio's bookings as busy time for Quests (and music time).
//
// Nova Agent keeps a copy of the studio's bookings for the next few weeks in data/bookings.json,
// read from Nova Bot's bookings feed (studio-bookings.ts: Nova Bot's own booking system, the
// bookings on the studio's Google Calendar). Each booking counts as taken time, so quests and
// music time are planned around sessions. The copy is refreshed every 10 minutes, and as soon as
// Nova Bot says the bookings changed (its answer to "any jobs?" carries bookingsChanged, the time
// of the last change; see jobs.ts), then everything is re-planned. So a new booking shows here
// within about a minute.
//
// Only what the planner needs is kept: ids, times and the session type.
// No names, emails or phone numbers are written to disk.
//
// If Nova Bot can't be reached, the last copy is kept and the trace says so. The
// plan never fails because of it: replan() only ever reads this file.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { listStudioBookings } from "../studio-bookings";
import { config } from "../config";
import { trace } from "../trace";
import { currentMusic, nowMinutes, replan } from "./plan";
import { notifyMusicMoved } from "./reminders";
import { fromMin, type Busy, type MusicSlot } from "./scheduler";
import { readStamp } from "./store";

export interface BookingsCopy {
  fetchedAt: string; // when it was last read from Nova Bot (UTC ISO; "" = never)
  from: string; // the UK dates it covers
  to: string;
  seen: string; // the last "bookings changed" time it was refreshed for (UTC ISO)
  appointments: { id: number | string; start: string; end: string; type: string; canceled: boolean }[];
  // (older copies also held times blocked off in the old booking system: still read, never written)
  blocks: { id: number | string; start: string; end: string }[];
}

const file = `${config.paths.dataDir}bookings.json`;
const EVERY_MS = 10 * 60 * 1000;
// One day back (a session still going) to 22 days ahead (music time looks 21 days ahead)
const DAYS_BACK = 1;
const DAYS_AHEAD = 22;

const empty = (): BookingsCopy => ({ fetchedAt: "", from: "", to: "", seen: "", appointments: [], blocks: [] });
let copy: BookingsCopy | null = null;
let seen = "";
let running: Promise<boolean> | null = null;
let lastProblem = "";

// The last copy (empty if there's none yet, or it can't be read)
export function readBookings(): BookingsCopy {
  if (copy) return copy;
  copy = empty();
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      copy = {
        ...empty(),
        ...raw,
        appointments: Array.isArray(raw.appointments) ? raw.appointments : [],
        blocks: Array.isArray(raw.blocks) ? raw.blocks : [],
      };
    }
  } catch (error) {
    trace("task", "warn", `Couldn't read the copy of the studio's bookings (${(error as Error).message}); it's fetched again shortly.`);
  }
  seen = seen || copy!.seen;
  return copy!;
}

function writeBookings(next: BookingsCopy): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${file}.tmp`, file);
  copy = next;
}

// Bookings (not cancelled), as the planner's UK wall-clock times
export function bookingsBusy(): Busy[] {
  const c = readBookings();
  const busy: Busy[] = [];
  const add = (start: string, end: string, label: string) => {
    try {
      const s = readStamp(start);
      const e = readStamp(end);
      if (s && e && e > s) busy.push({ start: s, end: e, label });
    } catch {
      // A time that can't be read is left out (never stops the plan)
    }
  };
  for (const a of c.appointments) if (!a.canceled) add(a.start, a.end, `Studio booking · ${a.type || "session"}`);
  for (const b of c.blocks) add(b.start, b.end, "Blocked off");
  return busy;
}

// The last "bookings changed" time Nova Agent has caught up with (sent with each "any jobs?")
export function bookingsSeen(): string {
  readBookings();
  return seen;
}

// Nova Bot's answer said when the bookings last changed: if that's newer than what we've seen,
// fetch the bookings again and re-plan. (Noted as seen straight away, so the worker's wait
// isn't cut short again and again; if the fetch fails the 10-minute refresh catches up.)
export function bookingsChanged(changed: unknown): Promise<boolean> | null {
  if (typeof changed !== "string" || !changed) return null;
  const at = Date.parse(changed);
  if (!Number.isFinite(at)) return null;
  const was = Date.parse(bookingsSeen());
  if (Number.isFinite(was) && at <= was) return null;
  seen = changed;
  trace("input", "info", "The studio's bookings changed: refreshing them and re-planning");
  return refreshBookings("a booking change");
}

// Wait for a refresh under way (tests, and anything that needs the fresh copy)
export const bookingsIdle = async (): Promise<void> => {
  if (running) await running;
};

// Read the next few weeks from Nova Bot, keep the copy, and re-plan if anything changed.
// Never throws: a problem is said in the trace and the last copy is kept.
export function refreshBookings(why = "the regular refresh"): Promise<boolean> {
  if (!config.agentNovaKey) return Promise.resolve(false);
  if (running) return running;
  running = (async () => {
    try {
      return await refresh(why);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function refresh(why: string): Promise<boolean> {
  const now = nowMinutes();
  const today = Math.floor(now / 1440) * 1440;
  const from = fromMin(today - DAYS_BACK * 1440).slice(0, 10);
  const to = fromMin(today + DAYS_AHEAD * 1440).slice(0, 10);
  const before = readBookings();
  let next: BookingsCopy;
  try {
    // The feed has the bookings that stand (never cancelled ones)
    const appointments = await listStudioBookings(from, to);
    next = {
      fetchedAt: new Date().toISOString(),
      from,
      to,
      seen,
      appointments: appointments.map((a) => ({ id: a.id, start: a.start, end: a.end, type: String(a.type ?? "").slice(0, 120), canceled: false })),
      blocks: [],
    };
  } catch (error) {
    const problem = (error as Error).message.replace(/\.?$/, ".");
    const kept = before.fetchedAt ? `the copy from ${new Date(before.fetchedAt).toLocaleString("en-GB", { timeZone: config.timezone, weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "no bookings (there's no copy yet)";
    if (problem !== lastProblem) trace("task", "warn", `Couldn't refresh the studio's bookings (${why}): ${problem} Quests keep planning around ${kept}.`);
    lastProblem = problem;
    return false;
  }
  lastProblem = "";
  const sameBusy = JSON.stringify([before.appointments, before.blocks]) === JSON.stringify([next.appointments, next.blocks]);
  try {
    writeBookings(next);
  } catch (error) {
    trace("task", "warn", `Couldn't save the copy of the studio's bookings: ${(error as Error).message}`);
    copy = next;
  }
  if (sameBusy && before.fetchedAt) return true;
  trace("task", "info", `Studio bookings refreshed (${why}): ${next.appointments.length} booking(s) ${from} to ${to}. Re-planning.`);
  // Music time today and tomorrow before and after, to say (once, calmly) if a booking moved it
  const musicBefore = currentMusic();
  try {
    replan();
  } catch (error) {
    trace("task", "warn", `Couldn't re-plan after the bookings changed: ${(error as Error).message}`);
    return true;
  }
  if (before.fetchedAt) tellMusicMoves(musicBefore, currentMusic(), today);
  return true;
}

// One calm notice when a booking change moved today's or tomorrow's music time
function tellMusicMoves(before: MusicSlot[], after: MusicSlot[], today: number): void {
  const days = [fromMin(today).slice(0, 10), fromMin(today + 1440).slice(0, 10)];
  const lines: string[] = [];
  for (const [i, day] of days.entries()) {
    const was = before.find((m) => m.day === day);
    const now = after.find((m) => m.day === day);
    if (!was || was.start === now?.start) continue;
    const name = i === 0 ? "Today" : "Tomorrow";
    lines.push(now ? `${name} ${was.start.slice(11, 16)} → ${now.start.slice(11, 16)}` : `${name} ${was.start.slice(11, 16)}: no free time left for it`);
  }
  if (lines.length) notifyMusicMoved(lines, `${days[0]}|${lines.join("|")}`);
}

// Every 10 minutes (and once now), in the background
export function startBookingRefresh(): void {
  if (!config.agentNovaKey) {
    console.log("Not reading studio bookings for Quests: set AGENT_NOVA_KEY in .env.");
    return;
  }
  void refreshBookings("start-up");
  setInterval(() => void refreshBookings(), EVERY_MS).unref();
}
