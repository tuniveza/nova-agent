// The studio's bookings as busy time for Quests (and music time).
//
// With ACUITY_SOURCE=api or feed, Nova Agent keeps a copy of what's in Acuity for the next few
// weeks in data/bookings.json: each booking (not the cancelled ones) and each time blocked off in
// Acuity counts as taken time, so quests and music time are planned around sessions. With "api"
// it's read through Acuity's API; with "feed" from Acuity's private calendar feed (on Nova Bot),
// which has the bookings but no blocked times and no cancelled bookings. The copy is
// refreshed every 10 minutes, and as soon as Nova Bot says something changed in Acuity (its
// answer to "any jobs?" carries bookingsChanged, the time of Acuity's last change; see jobs.ts),
// then everything is re-planned. So a booking made in Acuity shows here within about a minute.
//
// Only what the planner needs is kept: ids, times, the session type and whether it's cancelled.
// No names, emails or phone numbers are written to disk.
//
// If Acuity (or Nova Bot) can't be reached, the last copy is kept and the trace says so. The
// plan never fails because of it: replan() only ever reads this file.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { listAppointments, listBlocks, listFeedBookings } from "../acuity-api";
import { config } from "../config";
import { trace } from "../trace";
import { currentMusic, nowMinutes, replan } from "./plan";
import { notifyMusicMoved } from "./reminders";
import { fromMin, type Busy, type MusicSlot } from "./scheduler";
import { readStamp } from "./store";

export interface BookingsCopy {
  fetchedAt: string; // when it was last read from Acuity (UTC ISO; "" = never)
  from: string; // the UK dates it covers
  to: string;
  seen: string; // the last "changed in Acuity" time it was refreshed for (UTC ISO)
  appointments: { id: number; start: string; end: string; type: string; canceled: boolean }[];
  blocks: { id: number; start: string; end: string }[];
}

const file = `${config.paths.dataDir}bookings.json`;
const EVERY_MS = 10 * 60 * 1000;
// One day back (a session still going) to 22 days ahead (music time looks 21 days ahead)
const DAYS_BACK = 1;
const DAYS_AHEAD = 22;

// Bookings are read for Quests with Acuity's API or its calendar feed (not the browser)
const readsBookings = () => config.acuitySource === "api" || config.acuitySource === "feed";

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

// Bookings (not cancelled) and Acuity's blocked times, as the planner's UK wall-clock times
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
  for (const b of c.blocks) add(b.start, b.end, "Blocked in Acuity");
  return busy;
}

// The last "changed in Acuity" time Nova Agent has caught up with (sent with each "any jobs?")
export function bookingsSeen(): string {
  readBookings();
  return seen;
}

// Nova Bot's answer said when Acuity last changed: if that's newer than what we've seen,
// fetch the bookings again and re-plan. (Noted as seen straight away, so the worker's wait
// isn't cut short again and again; if the fetch fails the 10-minute refresh catches up.)
export function bookingsChanged(changed: unknown): Promise<boolean> | null {
  if (typeof changed !== "string" || !changed) return null;
  const at = Date.parse(changed);
  if (!Number.isFinite(at)) return null;
  const was = Date.parse(bookingsSeen());
  if (Number.isFinite(was) && at <= was) return null;
  seen = changed;
  if (!readsBookings()) return null; // (browser mode: bookings aren't read this way)
  trace("input", "info", "Bookings changed in Acuity: refreshing them and re-planning");
  return refreshBookings("a change in Acuity");
}

// Wait for a refresh under way (tests, and anything that needs the fresh copy)
export const bookingsIdle = async (): Promise<void> => {
  if (running) await running;
};

// Read the next few weeks from Acuity, keep the copy, and re-plan if anything changed.
// Never throws: a problem is said in the trace and the last copy is kept.
export function refreshBookings(why = "the regular refresh"): Promise<boolean> {
  if (!readsBookings() || !config.agentNovaKey) return Promise.resolve(false);
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
    // The calendar feed has the bookings only (never cancelled ones, never blocked times)
    const [appointments, blocks] =
      config.acuitySource === "feed"
        ? [(await listFeedBookings(from, to)).map((a) => ({ ...a, canceled: false })), []]
        : await Promise.all([listAppointments(from, to), listBlocks(from, to)]);
    next = {
      fetchedAt: new Date().toISOString(),
      from,
      to,
      seen,
      appointments: appointments.map((a) => ({ id: a.id, start: a.start, end: a.end, type: String(a.type ?? "").slice(0, 120), canceled: a.canceled === true })),
      blocks: blocks.map((b) => ({ id: b.id, start: b.start, end: b.end })),
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
  trace("task", "info", `Studio bookings refreshed (${why}): ${next.appointments.filter((a) => !a.canceled).length} booking(s), ${next.blocks.length} blocked time(s) ${from} to ${to}. Re-planning.`);
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
  if (!readsBookings()) return;
  if (!config.agentNovaKey) {
    console.log("Not reading studio bookings for Quests: set AGENT_NOVA_KEY in .env.");
    return;
  }
  void refreshBookings("start-up");
  setInterval(() => void refreshBookings(), EVERY_MS).unref();
}
