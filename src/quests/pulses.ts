// Pulses: ongoing quests that repeat faster than every 5 minutes ("drink water
// every 2 seconds", "stretch every minute").
//
// They don't take slots in the plan (there would be thousands); each one runs
// on its own exact timer instead, from when it was added (or its earliest time)
// until its deadline, only while you're awake. Every beat pings the Nova Agent
// page and, if the rhythm says so, the Nova Hub phones, where each beat replaces
// the last notification instead of piling up.

import { trace } from "../trace";
import { nowMinutes } from "./plan";
import { pulseBeat } from "./reminders";
import { fromMin, toMin } from "./scheduler";
import { questEvents, readQuests, writeQuests, type Quest, type Rhythm } from "./store";

export const PULSE_BELOW_MINUTES = 5;
export const isPulse = (q: Pick<Quest, "ongoing" | "every" | "everyMinutes">) => q.ongoing && q.every === "interval" && q.everyMinutes < PULSE_BELOW_MINUTES;

const timers = new Map<string, NodeJS.Timeout>();
// "Now" to the millisecond, in the planner's UK wall-clock minutes (one reading of the clock)
const exactNow = () => {
  const at = new Date();
  return nowMinutes(at) + at.getMilliseconds() / 60000;
};
// The last beat each pulse rang, so a beat never rings twice
const lastBeat = new Map<string, number>();
const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

// Is this moment within waking hours (wake to sleep, sleep after midnight allowed)?
function awake(r: Rhythm, at: number): boolean {
  const t = ((at % 1440) + 1440) % 1440;
  const wake = hm(r.wake);
  const sleep = hm(r.sleep);
  return sleep > wake ? t >= wake && t < sleep : t >= wake || t < sleep;
}
// The next wake-up after `at`
function nextWake(r: Rhythm, at: number): number {
  const day = Math.floor(at / 1440) * 1440;
  const wake = day + hm(r.wake);
  return wake > at ? wake : wake + 1440;
}

// The next beat at or after `from`: anchor + k × interval, while awake
function nextBeat(q: Quest, r: Rhythm, from: number): number | null {
  const anchor = toMin(q.earliest);
  const every = q.everyMinutes;
  // Beats land on exact milliseconds (so 2/60 of a minute adds up without drifting)
  const ms = (m: number) => Math.round(m * 60000) / 60000;
  let beat = ms(from <= anchor ? anchor : anchor + Math.ceil((from - anchor) / every - 1e-9) * every);
  if (!awake(r, beat)) {
    const wake = nextWake(r, beat);
    beat = ms(anchor + Math.ceil((wake - anchor) / every - 1e-9) * every);
  }
  // A beat on the deadline itself doesn't ring
  if (q.deadline && beat >= toMin(q.deadline) - 1e-7) return null;
  return beat;
}

function schedule(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const data = readQuests();
  const paused = new Set(data.missions.filter((m) => m.status !== "active").map((m) => m.id));
  const now = exactNow();
  let changed = false;
  for (const q of data.quests) {
    if (!isPulse(q) || q.status === "done" || q.status === "skipped" || paused.has(q.missionId)) continue;
    // Pulses count from when they were added, unless they were given a start
    if (!q.earliest) {
      q.earliest = fromMin(Math.ceil(now * 60) / 60);
      changed = true;
    }
    const beat = nextBeat(q, data.rhythm, now);
    if (beat === null) {
      // Past its deadline: finished
      q.status = "done";
      q.completed = new Date().toISOString();
      changed = true;
      continue;
    }
    const id = q.id;
    timers.set(id, setTimeout(() => fire(id, beat), Math.max(0, (beat - exactNow()) * 60000)));
  }
  if (changed) writeQuests(data); // this re-schedules, through "changed"
}

function fire(id: string, beat: number): void {
  try {
    const data = readQuests();
    const q = data.quests.find((x) => x.id === id);
    if (!q || !isPulse(q) || q.status === "done" || q.status === "skipped") return;
    if (beat > (lastBeat.get(id) ?? -Infinity) + 1e-6) {
      lastBeat.set(id, beat);
      pulseBeat(q, data.rhythm.phonePush);
    }
    // The next one (no saving: nothing in the plan changes on a beat)
    const next = nextBeat(q, data.rhythm, beat + q.everyMinutes / 2);
    if (next === null) {
      schedule(); // its deadline has come: schedule() marks it done
      return;
    }
    timers.set(id, setTimeout(() => fire(id, next), Math.max(0, (next - exactNow()) * 60000)));
  } catch (error) {
    trace("task", "warn", `Nova Quest pulse: ${(error as Error).message}`);
  }
}

let started = false;
export function startPulses(): void {
  if (started) return;
  started = true;
  let soon: NodeJS.Timeout | undefined;
  const later = () => {
    clearTimeout(soon);
    soon = setTimeout(schedule, 200);
  };
  questEvents.on("changed", later);
  schedule();
}
