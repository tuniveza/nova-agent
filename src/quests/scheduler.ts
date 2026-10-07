// The Nova Quest planner: places every open quest at a time, hour by hour.
//
// No AI here, on purpose: the same quests and the same free time always give
// the same plan, and it's quick enough to re-plan on every change. The AI
// (planner.ts, chat.ts) decides WHAT the quests are; this decides WHEN.
//
// How it chooses:
//   1. Free time = each day from wake (+ a start-up) to sleep (- a wind-down),
//      minus everything already taken: calendar entries, blocked time, quests
//      pinned to a time, and the quest in progress.
//   2. Quests go in most-urgent first: the least slack (time from when it may
//      start to its deadline, less its length) weighted by priority, and never
//      before the quests they depend on.
//   3. Each one takes the earliest slot that fits its travel + its work, in the
//      part of the day it suits if it has one, on a day that isn't already full,
//      before its deadline if at all possible (otherwise it's flagged at risk).
//   4. After each quest comes a buffer, or a proper break after a long one.
//      Quick quests (under 5 minutes) go back to back, to the minute.
// Times are naive local minutes (UK wall-clock), so "09:00" is always 09:00.
// They can be fractions of a minute: a 30-second quest is 0.5.

import type { Quest, Rhythm } from "./store";

// An ongoing quest's session is due by the end of its window (that day, that week, or before the next interval)
const sessionDue = (q: Quest, from: number) =>
  q.every === "interval" ? from + q.everyMinutes : Math.floor(from / 1440) * 1440 + (q.every === "week" ? 7 : 1) * 1440;

export interface Busy {
  start: string;
  end: string;
  label: string;
}
export interface Placement {
  start: string;
  end: string;
  travelStart: string;
  atRisk: boolean;
}
export interface PlanResult {
  placed: Map<string, Placement>;
  unplaced: Map<string, string>; // quest id -> why
}

const DAY = 1440;
const WEIGHT = { critical: 4, high: 2, normal: 1, low: 0.5 } as const;

export const toMin = (stamp: string): number => {
  const [d, t = "00:00"] = stamp.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi, se = 0] = t.split(":").map(Number);
  return Date.UTC(y, mo - 1, da, h, mi, se) / 60000;
};
// "2026-10-09T14:00", or with seconds when it isn't on the minute ("2026-10-09T14:00:30")
export const fromMin = (m: number): string => {
  const iso = new Date(Math.round(m * 60) * 1000).toISOString();
  return iso.slice(17, 19) === "00" ? iso.slice(0, 16) : iso.slice(0, 19);
};
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const roundUp = (m: number, step = 5) => Math.ceil(m / step - 1e-9) * step;
const QUICK = 5; // quests shorter than this many minutes go back to back

type Interval = [number, number];

// Remove [a, b) from a sorted list of free intervals
function subtract(free: Interval[], a: number, b: number): Interval[] {
  const out: Interval[] = [];
  for (const [s, e] of free) {
    if (b <= s || a >= e) out.push([s, e]);
    else {
      if (a > s) out.push([s, a]);
      if (b < e) out.push([b, e]);
    }
  }
  return out;
}

// Each day's waking window, from today for `horizonDays`
function dayWindows(rhythm: Rhythm, now: number): { day: number; from: number; to: number }[] {
  const today = Math.floor(now / DAY) * DAY;
  const wake = hm(rhythm.wake);
  let sleep = hm(rhythm.sleep);
  if (sleep <= wake) sleep += DAY; // going to bed after midnight
  const out = [];
  // Start a day early, in case it's after midnight and yesterday's evening is still going
  for (let d = -1; d < rhythm.horizonDays; d++) {
    const day = today + d * DAY;
    // Days off have no quest time at all
    if (rhythm.daysOff?.includes(new Date(day * 60000).getUTCDay())) continue;
    const from = day + wake + rhythm.startUpMinutes;
    const to = day + sleep - rhythm.windDownMinutes;
    if (to > from && to > now) out.push({ day, from, to });
  }
  return out;
}

function partOfDay(rhythm: Rhythm, day: number, part: Quest["timeOfDay"]): Interval {
  const wake = day + hm(rhythm.wake);
  let sleep = day + hm(rhythm.sleep);
  if (sleep <= wake) sleep += DAY;
  if (part === "morning") return [wake, day + 12 * 60];
  if (part === "afternoon") return [day + 12 * 60, day + 17 * 60];
  if (part === "evening") return [day + 17 * 60, sleep];
  return [wake, sleep];
}

export function planQuests(options: { rhythm: Rhythm; quests: Quest[]; busy: Busy[]; now: number }): PlanResult {
  const { rhythm, quests, busy } = options;
  // Planned work starts a few minutes from now; quick quests (and repeats) can start right away.
  // With the pace limits off, everything can start right away, to the second, back to back.
  const paced = rhythm.paceLimits !== false;
  const exactNow = options.now;
  const now = paced ? roundUp(options.now + 5) : Math.ceil(options.now * 60) / 60;
  const placed = new Map<string, Placement>();
  const unplaced = new Map<string, string>();
  const byId = new Map(quests.map((q) => [q.id, q]));

  // 1. Free time
  const windows = dayWindows(rhythm, now);
  let free: Interval[] = windows.map((w) => [Math.max(w.from, exactNow), w.to] as Interval).filter(([s, e]) => e > s);
  const load = new Map<number, number>(); // minutes of quests per day
  const addLoad = (start: number, minutes: number) => {
    const day = windows.find((w) => start >= w.from - 6 * 60 && start < w.to)?.day ?? Math.floor(start / DAY) * DAY;
    load.set(day, (load.get(day) ?? 0) + minutes);
    return day;
  };
  for (const b of busy) free = subtract(free, toMin(b.start), toMin(b.end));
  // Quests that keep their time: pinned ones, and the one in progress
  for (const q of quests) {
    if (q.status === "done" || q.status === "skipped") continue;
    const keep = q.fixedStart ? toMin(q.fixedStart) : q.status === "doing" && q.start ? toMin(q.start) : null;
    if (keep === null) continue;
    const travelStart = keep - (q.fixedStart ? q.travelMinutes : 0);
    const end = keep + q.minutes;
    free = subtract(free, travelStart, end + rhythm.bufferMinutes);
    addLoad(keep, q.minutes);
    placed.set(q.id, { start: fromMin(keep), end: fromMin(end), travelStart: fromMin(travelStart), atRisk: Boolean(q.deadline && end > toMin(q.deadline)) });
  }

  // 2. The order: most urgent first (hours until the deadline, divided by how much it matters)
  const open = quests.filter((q) => (q.status === "todo" || (q.status === "doing" && !q.start)) && !placed.has(q.id));
  const horizonEnd = windows.length ? windows[windows.length - 1].to : now + rhythm.horizonDays * DAY;
  const due = (q: Quest) => {
    const own = q.deadline ? toMin(q.deadline) : Infinity;
    return q.ongoing ? Math.min(own, sessionDue(q, Math.max(now, q.earliest ? toMin(q.earliest) : 0))) : own;
  };
  // Urgency is the slack a quest has: the time between when it may start and its
  // deadline, less its own length (so a quest that can only happen on one day
  // isn't crowded out by work due weeks later), divided by how much it matters
  const urgency = (q: Quest) => {
    const d = due(q);
    const from = Math.max(now, q.earliest ? toMin(q.earliest) : 0);
    const hours = Number.isFinite(d) ? Math.max(1 / 60, (d - from - q.minutes) / 60) : (horizonEnd - now) / 60 + 24;
    return hours / WEIGHT[q.priority];
  };
  const isDone = (id: string) => {
    const d = byId.get(id);
    return !d || d.status === "done" || d.status === "skipped";
  };
  const waiting = new Set(open.map((q) => q.id));

  // 3. Place them one by one
  while (waiting.size) {
    const ready = [...waiting]
      .map((id) => byId.get(id)!)
      .filter((q) => q.dependsOn.every((d) => isDone(d) || placed.has(d) || !waiting.has(d) && !byId.has(d)))
      .sort((a, b) => urgency(a) - urgency(b) || a.created.localeCompare(b.created));
    if (!ready.length) {
      // What's left is waiting on itself (a loop) or on something that can't be placed
      for (const id of waiting) unplaced.set(id, "It depends on a quest that can't be planned yet.");
      break;
    }
    const q = ready[0];
    waiting.delete(q.id);

    const afterDeps = Math.max(0, ...q.dependsOn.map((d) => (placed.has(d) ? toMin(placed.get(d)!.end) : 0)));
    const quick = q.minutes < QUICK;
    const notBefore = Math.max(quick ? exactNow : now, q.earliest ? toMin(q.earliest) : 0, afterDeps);
    const deadline = due(q);
    const need = q.travelMinutes + q.minutes;
    const rest = !paced ? 0 : quick ? 0 : q.minutes >= rhythm.breakAfterMinutes ? Math.max(rhythm.breakMinutes, rhythm.bufferMinutes) : rhythm.bufferMinutes;
    const cap = rhythm.maxQuestHoursPerDay * 60;

    const tryFit = (part: Quest["timeOfDay"], by: number): number | null => {
      for (const [s, e] of free) {
        const w = windows.find((x) => s >= x.from && s < x.to) ?? windows.find((x) => e > x.from && s < x.to);
        if (!w) continue;
        if ((load.get(w.day) ?? 0) + q.minutes > cap) continue;
        const [ps, pe] = partOfDay(rhythm, w.day, part);
        // Repeats keep their exact times (to the second); other quick quests start on the minute
        const step = !paced || (quick && q.ongoing && q.every === "interval") ? 1 / 60 : quick ? 1 : 5;
        const start = roundUp(Math.max(s, notBefore, part === "any" ? s : ps), step);
        if (start >= e || (part !== "any" && start >= pe)) continue;
        if (start + need > e) continue;
        if (start + need > by) continue;
        return start;
      }
      return null;
    };
    let slot: number | null = null;
    if (q.timeOfDay !== "any") slot = tryFit(q.timeOfDay, deadline);
    if (slot === null) slot = tryFit("any", deadline);
    if (slot === null && q.timeOfDay !== "any") slot = tryFit(q.timeOfDay, Infinity);
    if (slot === null) slot = tryFit("any", Infinity);
    if (slot === null) {
      unplaced.set(
        q.id,
        q.minutes > cap
          ? `It's longer than the most quest time in a day (${rhythm.maxQuestHoursPerDay} h): ${q.ongoing ? "shorten its sessions" : "split it into smaller quests"}.`
          : !free.some(([s, e]) => e - s >= need)
            ? "It's longer than any free stretch: split it into smaller quests."
            : "There's no free time for it in the planning window.",
      );
      continue;
    }
    const start = slot + q.travelMinutes;
    const end = start + q.minutes;
    free = subtract(free, slot, end + rest);
    addLoad(start, q.minutes);
    placed.set(q.id, { start: fromMin(start), end: fromMin(end), travelStart: fromMin(slot), atRisk: end > deadline });
  }
  return { placed, unplaced };
}
