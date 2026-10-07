// Re-planning: run the planner over everything open, save the times, and show
// the plan in Nova Calendar (each planned quest, each blocked time and each
// mission milestone becomes a note card there, kept in step automatically).

import { readCalendar, writeCalendar, type NoteCard } from "../calendar/store";
import { config } from "../config";
import { fromMin, planQuests, toMin, type Busy } from "./scheduler";
import { nextSession } from "./lengths";
import { isPulse } from "./pulses";
import { readQuests, writeQuests, type QuestData } from "./store";

const QUEST_NOTE = "quest-";
const BLOCK_NOTE = "block-";
const MILESTONE_NOTE = "mile-";
const isOurNote = (id: string) => id.startsWith(QUEST_NOTE) || id.startsWith(BLOCK_NOTE) || id.startsWith(MILESTONE_NOTE);
// However far ahead the rhythm says to plan, a mission's work is planned as far as its deadlines (up to a year)
const MAX_HORIZON_DAYS = 370;

// "Now" as UK wall-clock minutes (the planner's time), to the second
export function nowMinutes(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return toMin(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`);
}

// Calendar entries the person made themselves count as taken time
function calendarBusy(): Busy[] {
  return readCalendar()
    .notes.filter((n) => !isOurNote(n.id) && n.end > n.start)
    .map((n) => ({ start: n.start, end: n.end, label: n.title }));
}

// Plan everything again. Returns a short summary of what changed.
export function replan(data: QuestData = readQuests()): { data: QuestData; atRisk: number; unplaced: { id: string; title: string; why: string }[] } {
  const now = nowMinutes();
  for (const q of data.quests) {
    if (!q.ongoing || isPulse(q) || q.status === "done" || q.status === "skipped") continue;
    // An ongoing quest stops by itself at its deadline
    if (q.deadline && toMin(q.deadline) <= now) {
      q.status = "done";
      q.completed = new Date().toISOString();
      continue;
    }
    // A repeat whose time has passed moves on to its next slot (it isn't piled up)
    if (q.every === "interval" && q.status === "todo" && q.start && toMin(q.end) <= now) {
      q.missed += 1;
      q.earliest = nextSession("interval", q.start, q.everyMinutes, now);
      q.start = q.end = q.travelStart = q.fixedStart = "";
      q.remindedFor = q.checkedFor = "";
      if (q.deadline && q.earliest >= q.deadline) q.status = "done";
    }
  }
  // Anything not finished whose time has well passed goes back in the pot
  for (const q of data.quests) {
    if (q.status === "todo" && q.start && !q.fixedStart && toMin(q.end) + 60 < now) {
      q.missed += 1;
      q.start = q.end = q.travelStart = "";
    }
  }
  // Quests of paused or finished missions wait
  const paused = new Set(data.missions.filter((m) => m.status !== "active").map((m) => m.id));
  // Pulses run on their own timers (pulses.ts), not in the plan
  const planning = data.quests.filter((q) => !paused.has(q.missionId) && !isPulse(q));
  const busy: Busy[] = [...calendarBusy(), ...data.blocks.map((b) => ({ start: b.start, end: b.end, label: b.reason }))];
  const furthest = Math.max(0, ...planning.filter((q) => q.status === "todo" || q.status === "doing").map((q) => Math.max(q.deadline ? toMin(q.deadline) : 0, q.earliest ? toMin(q.earliest) + 1440 : 0)));
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(data.rhythm.horizonDays, Math.ceil((furthest - now) / 1440) + 1));
  const result = planQuests({ rhythm: { ...data.rhythm, horizonDays }, quests: planning, busy, now });

  const unplaced: { id: string; title: string; why: string }[] = [];
  for (const q of data.quests) {
    if (q.status === "done" || q.status === "skipped") continue;
    if (isPulse(q)) {
      q.start = q.end = q.travelStart = "";
      q.atRisk = false;
      continue;
    }
    if (paused.has(q.missionId)) {
      if (q.status === "todo") q.start = q.end = q.travelStart = "";
      continue;
    }
    const p = result.placed.get(q.id);
    if (p) {
      q.start = p.start;
      q.end = p.end;
      q.travelStart = p.travelStart;
      q.atRisk = p.atRisk;
    } else if (result.unplaced.has(q.id)) {
      q.start = q.end = q.travelStart = "";
      q.atRisk = true;
      unplaced.push({ id: q.id, title: q.title, why: result.unplaced.get(q.id)! });
    }
  }
  writeQuests(data);
  syncCalendar(data);
  return { data, atRisk: data.quests.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length, unplaced };
}

// Keep Nova Calendar showing the plan: one note card per planned quest and per blocked time
export function syncCalendar(data: QuestData): void {
  const cal = readCalendar();
  const missions = new Map(data.missions.map((m) => [m.id, m]));
  const seed = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const ours: NoteCard[] = [];
  for (const q of data.quests) {
    if (!q.start || q.status === "skipped") continue;
    const mission = missions.get(q.missionId);
    // The calendar works to the minute: a quest of seconds still shows as a minute
    const start = q.start.slice(0, 16);
    const end = q.end.slice(0, 16) > start ? q.end.slice(0, 16) : fromMin(toMin(start) + 1);
    ours.push({
      id: `${QUEST_NOTE}${q.id}`,
      title: `${q.status === "done" ? "✓" : q.atRisk ? "⚠" : q.ongoing ? "∞" : "✦"} ${q.title}`.slice(0, 120),
      body: [mission ? `Nova Mission: ${mission.title}` : "Nova Quest", q.location ? `At ${q.location}${q.travelMinutes ? ` (${q.travelMinutes} min travel first)` : ""}` : "", q.notes].filter(Boolean).join("\n"),
      author: "Nova Quest",
      start,
      end,
      art: { seed: seed(q.id), subject: "auto" },
      created: q.created,
      updated: q.updated,
    });
  }
  // Each mission's milestones, as short cards at their time (they don't count as busy)
  for (const m of data.missions) {
    for (const ms of m.milestones) {
      ours.push({ id: `${MILESTONE_NOTE}${ms.id}`, title: `${ms.done ? "✓" : "◆"} ${ms.title}`.slice(0, 120), body: [`Nova Mission milestone: ${m.title}`, ms.track ? `Track: ${ms.track}` : ""].filter(Boolean).join("\n"), author: "Nova Mission", start: ms.at.slice(0, 16), end: fromMin(toMin(ms.at) + 15), art: { seed: seed(ms.id), subject: "auto" }, created: m.created, updated: m.updated });
    }
  }
  for (const b of data.blocks) {
    ours.push({ id: `${BLOCK_NOTE}${b.id}`, title: `Busy · ${b.reason}`.slice(0, 120), body: "Blocked out in Nova Agent", author: "Nova Agent", start: b.start, end: b.end, art: { seed: seed(b.id), subject: "auto" }, created: b.start, updated: b.start });
  }
  const others = cal.notes.filter((n) => !isOurNote(n.id));
  const before = JSON.stringify(cal.notes.filter((n) => isOurNote(n.id)).map((n) => [n.id, n.title, n.start, n.end, n.body]).sort());
  const after = JSON.stringify(ours.map((n) => [n.id, n.title, n.start, n.end, n.body]).sort());
  if (before === after) return; // nothing to change, so the calendar doesn't flicker
  cal.notes = [...others, ...ours];
  writeCalendar(cal, true);
}
