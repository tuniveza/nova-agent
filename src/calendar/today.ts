// Today's calendar in a few lines, for Agent's what_now: the studio's own events and the ones from
// Google Calendar (synced into this calendar), never Nova Agent's plan (quests and music time are
// what_now's own). Times in UK time.

import { noteOccurrences, readCalendar } from "./store";

const isPlan = (id: string) => /^(quest|block|mile)-/.test(id);

export function todayCalendar(at = new Date()): string[] {
  const day = at.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return readCalendar()
    .notes.filter((n) => !isPlan(n.id))
    .flatMap((n) => noteOccurrences(n, day, day))
    .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
    .slice(0, 20)
    .map((n) => `${n.allDay ? "All day" : `${n.start.slice(11, 16)}–${n.end.slice(11, 16)}`} · ${n.title || "(no title)"}${/^gp?-/.test(n.id) ? " (from Google Calendar)" : ""}${n.location ? ` · ${n.location}` : ""}${n.meetUrl ? ` · Google Meet: ${n.meetUrl}` : ""}`);
}
