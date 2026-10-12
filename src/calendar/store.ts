// Calendar, kept by Nova Agent.
//
// The calendar app itself lives in ../../calendar (the nova-calendar repo, as a
// git submodule). On its own it saves in the browser; inside Nova Agent it
// saves here instead (data/calendar.json), so Nova Agent's chat and the
// calendar page always see the same note cards and day cards.
//
// The data has exactly the shape the calendar app uses, so the app needs no
// changes: { version, notes: [...], days: [...], prefs: { theme, author } },
// plus `rev`, which goes up by one with every save (see page.ts).

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { sendAlert } from "../alerts";
import { config } from "../config";
import { trace } from "../trace";
import { cleanRepeat, describeRepeat, occurrences, type Repeat } from "../../web/calendar/js/recur.js";

export interface NoteCard {
  id: string;
  title: string;
  body: string;
  author: string;
  start: string; // "2026-10-09T14:00" (local time)
  end: string;
  art: { seed: number; subject: string };
  created: string;
  updated: string;
  // The Calendar panel's extras (all optional; older cards have none)
  allDay?: boolean;
  location?: string;
  color?: string;
  reminders?: number[]; // minutes before (phones are reminded by Nova Bot)
  phones?: string[]; // which phones get them (Nova Bot's phone ids; none = the studio owner's)
  repeat?: Repeat; // see web/calendar/js/recur.js
  exdates?: string[]; // dates taken out of a repeating series
  meet?: boolean; // "Google Meet" ticked: Google makes a Meet link when the calendar syncs
  meetUrl?: string; // the link Google made (https://meet.google.com/…)
}

export interface DayCard {
  id: string;
  date: string; // "2026-10-31"
  preset: string;
  title: string;
  aesthetic: string;
  theme: string;
  info: string;
  location: string;
  tags: string[];
  repeat: "none" | "yearly";
  artSalt: string;
  created: string;
  updated: string;
}

export interface CalendarData {
  version: 1;
  rev: number; // goes up with every save
  notes: NoteCard[];
  days: DayCard[];
  prefs: { theme: string; author: string };
}

export const PRESETS = ["custom", "birthday", "anniversary", "trip", "session", "release", "launch", "halloween", "bonfire", "christmas", "newyear", "valentines", "pancake", "stpatricks", "mothers", "easter", "fathers", "solstice", "equinox", "meteor", "fullmoon", "winter"] as const;
export const AESTHETICS = ["nebula", "supernova", "orbit", "constellation", "eclipse", "aurora", "celestial"] as const;
export const THEMES = ["app", "novacane", "solar", "pulsar", "aurora", "eclipse", "quasar"] as const;

const file = `${config.paths.dataDir}calendar.json`;
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isStamp = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const now = () => new Date().toISOString();

// Tells the open calendar page to refresh when Nova Agent changes something
export const calendarEvents = new EventEmitter();

function cleanNote(n: any): NoteCard | null {
  if (!n || typeof n !== "object" || !isStamp(n.start)) return null;
  const start = n.start.slice(0, 16);
  const end = isStamp(n.end) && n.end.slice(0, 16) >= start ? n.end.slice(0, 16) : start;
  return {
    id: text(n.id, 64) || randomUUID(),
    title: text(n.title, 120),
    body: text(n.body, 5000),
    author: text(n.author, 60),
    start,
    end,
    art: { seed: Number(n.art?.seed) >>> 0 || Math.floor(Math.random() * 2 ** 32), subject: text(n.art?.subject, 30) || "auto" },
    created: text(n.created, 40) || now(),
    updated: text(n.updated, 40) || text(n.created, 40) || now(),
    ...noteExtras(n),
  };
}

const COLORS = ["rose", "violet", "blue", "teal", "green", "amber", "orange", "red", "grey"];
// The Calendar panel's extras, kept only when set (so older cards stay as they were)
function noteExtras(n: any): Partial<NoteCard> {
  const out: Partial<NoteCard> = {};
  if (n.allDay === true) out.allDay = true;
  if (text(n.location, 160)) out.location = text(n.location, 160);
  if (COLORS.includes(n.color)) out.color = n.color;
  if (Array.isArray(n.reminders)) {
    const r = [...new Set(n.reminders.map(Number).filter((m: number) => Number.isInteger(m) && m >= 0 && m <= 40320))].slice(0, 5) as number[];
    if (r.length) out.reminders = r.sort((a, b) => a - b);
  }
  if (Array.isArray(n.phones)) {
    const p = [...new Set(n.phones.filter((x: unknown) => typeof x === "string" && /^[0-9a-f]{12}$/.test(x)))].slice(0, 10) as string[];
    if (p.length) out.phones = p;
  }
  if (n.meet === true) out.meet = true;
  if (typeof n.meetUrl === "string" && /^https:\/\/meet\.google\.com\/[\w-]{3,60}$/.test(n.meetUrl)) out.meetUrl = n.meetUrl;
  const repeat = cleanRepeat(n.repeat);
  if (repeat) {
    out.repeat = repeat;
    out.exdates = Array.isArray(n.exdates) ? [...new Set(n.exdates.filter(isDate) as string[])].slice(0, 500) : [];
  }
  return out;
}

// Each time a note card happens between two dates (a repeating one, every time; others once)
export function noteOccurrences(n: NoteCard, from: string, to: string): NoteCard[] {
  return occurrences(n, from, to).map((o) => ({ ...n, start: o.start, end: o.end }));
}
export { describeRepeat };

function cleanDay(d: any): DayCard | null {
  if (!d || typeof d !== "object" || !isDate(d.date)) return null;
  return {
    id: text(d.id, 64) || randomUUID(),
    date: d.date,
    preset: text(d.preset, 40) || "custom",
    title: text(d.title, 80),
    aesthetic: text(d.aesthetic, 30) || "nebula",
    theme: text(d.theme, 30) || "app",
    info: text(d.info, 4000),
    location: text(d.location, 120),
    tags: Array.isArray(d.tags) ? d.tags.map((t: unknown) => text(t, 30)).filter(Boolean).slice(0, 12) : [],
    repeat: d.repeat === "yearly" ? "yearly" : "none",
    artSalt: text(d.artSalt, 40),
    created: text(d.created, 40) || now(),
    updated: text(d.updated, 40) || now(),
  };
}

export function normalise(raw: any): CalendarData {
  return {
    version: 1,
    rev: Number.isInteger(raw?.rev) && raw.rev >= 0 ? raw.rev : 0,
    notes: (Array.isArray(raw?.notes) ? raw.notes : []).map(cleanNote).filter(Boolean) as NoteCard[],
    days: (Array.isArray(raw?.days) ? raw.days : []).map(cleanDay).filter(Boolean) as DayCard[],
    prefs: { theme: text(raw?.prefs?.theme, 30) || "novacane", author: text(raw?.prefs?.author, 60) },
  };
}

// A damaged calendar.json is never read as empty (the next save would make that
// for good): it's put aside and the last good copy (calendar.json.bak) is used.
export function readCalendar(): CalendarData {
  if (!existsSync(file)) return normalise({});
  try {
    return normalise(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    const aside = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(file, aside);
    let good: CalendarData;
    try {
      good = normalise(JSON.parse(readFileSync(`${file}.bak`, "utf8")));
    } catch {
      throw new Error(`calendar.json is damaged (${(error as Error).message}) and there's no good copy to go back to. It's kept as ${aside}.`);
    }
    writeFileSync(`${file}.tmp`, JSON.stringify(good, null, 2));
    renameSync(`${file}.tmp`, file);
    trace("task", "error", `calendar.json was damaged: went back to the last good copy. The damaged one is kept as ${aside}.`);
    void sendAlert("Calendar: calendar.json was damaged", `Nova Agent went back to the last good copy; the most recent change may need doing again. The damaged file is kept as ${aside}.`);
    return good;
  }
}

// The last few saved versions, by revision, so a save from a page that loaded an
// older one can be merged with what changed since (page.ts)
const recentRevs = new Map<number, CalendarData>();
export function calendarAtRev(rev: number): CalendarData | undefined {
  const known = recentRevs.get(rev);
  if (known) return structuredClone(known);
  // Nothing saved since it was loaded (e.g. just after a restart): that's the file as it is
  const current = readCalendar();
  return current.rev === rev ? current : undefined;
}

// Save safely (write a copy, then swap it in), as the next revision. `fromAgent`
// refreshes the open calendar page; changes made on the page itself don't need that.
export function writeCalendar(data: CalendarData, fromAgent = false): number {
  const before = readCalendar();
  if (!recentRevs.has(before.rev)) recentRevs.set(before.rev, before);
  const clean = { ...normalise(data), rev: before.rev + 1 };
  const json = JSON.stringify(clean, null, 2);
  writeFileSync(`${file}.tmp`, json);
  renameSync(`${file}.tmp`, file);
  writeFileSync(`${file}.bak.tmp`, json);
  renameSync(`${file}.bak.tmp`, `${file}.bak`);
  recentRevs.set(clean.rev, structuredClone(clean));
  for (const rev of recentRevs.keys()) if (rev < clean.rev - 50) recentRevs.delete(rev);
  if (fromAgent) calendarEvents.emit("change");
  return clean.rev;
}

function change<T>(fn: (data: CalendarData) => T): T {
  const data = readCalendar();
  const result = fn(data);
  writeCalendar(data, true);
  return result;
}

// ---- What the chat's tools do ----

// Note cards that touch a date range, and day cards in it (yearly ones included)
export function listRange(from: string, to: string) {
  const data = readCalendar();
  // A repeating note card shows each time it happens (same id: changing it changes the series)
  const notes = data.notes.flatMap((n) => noteOccurrences(n, from, to)).sort((a, b) => a.start.localeCompare(b.start));
  const days = data.days.filter((d) => {
    if (d.date >= from && d.date <= to) return true;
    if (d.repeat !== "yearly" || d.date > to) return false;
    // A yearly day card shows every year on the same month and day
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const on = `${y}${d.date.slice(4)}`;
      if (on >= from && on <= to && on >= d.date) return true;
    }
    return false;
  });
  return { notes, days };
}

export function addNote(input: { title: string; body?: string; author?: string; start: string; end?: string } & Partial<NoteCard>): NoteCard {
  return change((data) => {
    const note = cleanNote({ ...input, author: input.author || data.prefs.author, created: now(), updated: now() });
    if (!note) throw new Error("A note card needs a start time like 2026-10-09T14:00.");
    data.notes.push(note);
    return note;
  });
}

export function updateNote(id: string, changes: Partial<NoteCard>): NoteCard {
  return change((data) => {
    const i = data.notes.findIndex((n) => n.id === id);
    if (i < 0) throw new Error(`No note card with id ${id}.`);
    const note = cleanNote({ ...data.notes[i], ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), updated: now() });
    if (!note) throw new Error("That start time isn't valid.");
    data.notes[i] = note;
    return note;
  });
}

export function removeNote(id: string): NoteCard {
  return change((data) => {
    const note = data.notes.find((n) => n.id === id);
    if (!note) throw new Error(`No note card with id ${id}.`);
    data.notes = data.notes.filter((n) => n.id !== id);
    return note;
  });
}

export function addDay(input: Partial<DayCard> & { date: string }): DayCard {
  return change((data) => {
    // One day card per date: adding to a date that has one updates it
    const existing = data.days.findIndex((d) => d.date === input.date);
    const day = cleanDay({ ...(existing >= 0 ? data.days[existing] : {}), ...input, artSalt: input.artSalt || randomUUID().slice(0, 8), updated: now() });
    if (!day) throw new Error("A day card needs a date like 2026-10-31.");
    if (existing >= 0) data.days[existing] = day;
    else data.days.push(day);
    return day;
  });
}

export function updateDay(id: string, changes: Partial<DayCard>): DayCard {
  return change((data) => {
    const i = data.days.findIndex((d) => d.id === id);
    if (i < 0) throw new Error(`No day card with id ${id}.`);
    const day = cleanDay({ ...data.days[i], ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), id, updated: now() });
    if (!day) throw new Error("That date isn't valid.");
    data.days[i] = day;
    return day;
  });
}

export function removeDay(id: string): DayCard {
  return change((data) => {
    const day = data.days.find((d) => d.id === id);
    if (!day) throw new Error(`No day card with id ${id}.`);
    data.days = data.days.filter((d) => d.id !== id);
    return day;
  });
}
