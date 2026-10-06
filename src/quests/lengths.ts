// Quest lengths, from a second to forever.
//
//   - Anything up to a session (3 hours, or less if the day's limit is lower)
//     is one quest, placed to the second if it needs it.
//   - Anything longer is split into sessions: "Mix the album (part 2 of 6)",
//     each waiting for the one before, all with the same deadline.
//   - An ongoing quest never ends: it has a session every day, weekday or week,
//     or at any interval ("every 30 minutes", "every 10 seconds"), and finishing
//     a session lines up the next one, until it's ended (or its deadline passes).

import { randomUUID } from "node:crypto";
import { fromMin, toMin } from "./scheduler";
import { MAX_SESSION_MINUTES, type Every, type Quest, type Rhythm } from "./store";

// The longest one sitting can be
export const sessionLimit = (rhythm: Rhythm) => Math.min(MAX_SESSION_MINUTES, rhythm.maxQuestHoursPerDay * 60);

// "30 s", "2 min 30 s", "45 min", "1 h 30 min", "3 days 4 h"; ongoing ones: "∞ · 30 min a day"
export function describeLength(q: Pick<Quest, "minutes" | "ongoing" | "every" | "everyMinutes">): string {
  const one = plain(q.minutes);
  if (!q.ongoing) return one;
  return `∞ · ${one} ${q.every === "interval" ? `every ${plain(q.everyMinutes)}` : q.every === "week" ? "a week" : q.every === "weekday" ? "each weekday" : "a day"}`;
}
function plain(minutes: number): string {
  const secs = Math.round(minutes * 60);
  if (secs < 60) return `${secs} s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 48) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d} days ${hh} h` : `${d} days`;
}

// Split a quest that's longer than a session into parts. The last part keeps
// the quest's id, so anything waiting for the quest waits for all of it.
export function splitLong(q: Quest, rhythm: Rhythm): Quest[] {
  const limit = sessionLimit(rhythm);
  if (q.ongoing || q.minutes <= limit) return [q];
  const count = Math.ceil(q.minutes / limit);
  // Even parts, to the nearest 5 minutes (the last one takes what's left)
  const each = Math.max(5, Math.round(q.minutes / count / 5) * 5);
  const ids = Array.from({ length: count }, (_, i) => (i === count - 1 ? q.id : randomUUID()));
  return ids.map((id, i) => ({
    ...q,
    id,
    title: `${q.title} (part ${i + 1} of ${count})`.slice(0, 140),
    minutes: i === count - 1 ? Math.max(1 / 60, Math.round((q.minutes - each * (count - 1)) * 60) / 60) : each,
    dependsOn: i === 0 ? q.dependsOn : [ids[i - 1]],
    // Only the first part can be pinned to a time
    fixedStart: i === 0 ? q.fixedStart : "",
  }));
}

// After an ongoing quest's session, when the next one may start (never in the past)
export function nextSession(every: Every, sessionStart: string, everyMinutes = 60, now = -Infinity): string {
  if (every === "interval") {
    let next = toMin(sessionStart) + everyMinutes;
    // Fell behind: skip to the next slot from now, keeping the rhythm
    if (next < now) next += Math.ceil((now - next) / everyMinutes) * everyMinutes;
    return fromMin(next);
  }
  const day = Math.floor(toMin(sessionStart) / 1440) * 1440;
  let next = day + (every === "week" ? 7 : 1) * 1440;
  if (every === "weekday") while ([0, 6].includes(new Date(next * 60000).getUTCDay())) next += 1440;
  return fromMin(next);
}
