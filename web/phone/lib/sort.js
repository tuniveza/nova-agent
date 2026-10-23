// (The phone version's own copy of quests/js/sort.js, 23 Oct 2026: the same rules as the computer version, kept here so the phone app stands on its own. Change both together.)
// How the Quests panel sorts, groups and picks (no page code here, so tests can check it).
// Quests are Nova Quests' own (src/quests/store.ts); times are UK wall-clock stamps "2026-10-14T15:00".
import { ukNow } from "./parse.js";

const RANK = { critical: 0, high: 1, normal: 2, low: 3 };
const open = (q) => q.status === "todo" || q.status === "doing";
const dayOf = (stamp) => String(stamp || "").slice(0, 10);
export const todayStamp = (now = new Date()) => {
  const t = ukNow(now);
  return `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}T${String(t.h).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;
};

// The person's own order first (dragged: 1, 2, 3...), then by time, then by priority, then newest
export function compare(a, b) {
  const ao = a.order || 0, bo = b.order || 0;
  if (ao && bo && ao !== bo) return ao - bo;
  if (ao && !bo) return -1;
  if (bo && !ao) return 1;
  const at = a.start || a.fixedStart || a.deadline || "", bt = b.start || b.fixedStart || b.deadline || "";
  if (at && bt && at !== bt) return at < bt ? -1 : 1;
  if (at && !bt) return -1;
  if (bt && !at) return 1;
  const pr = (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2);
  if (pr) return pr;
  return String(b.created || "").localeCompare(String(a.created || ""));
}

// Search: title, notes, tags ("#mix" for a tag only) and steps
export function matches(q, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [q.title, q.notes, ...(q.steps || []).map((s) => s.text), q.location].join(" ").toLowerCase();
  const tags = (q.tags || []).map((t) => t.toLowerCase());
  return words.every((w) => (w.startsWith("#") ? tags.includes(w.slice(1)) : hay.includes(w) || tags.includes(w)));
}

// The list, in plain groups: Now (started or on right now), Overdue, Today, Upcoming, Any time, Done
export function sections(quests, now = todayStamp()) {
  const today = dayOf(now);
  const groups = { now: [], overdue: [], today: [], upcoming: [], anytime: [], done: [] };
  for (const q of quests) {
    if (!open(q)) {
      if (q.status === "done") groups.done.push(q);
      continue;
    }
    const when = q.start || q.fixedStart || "";
    if (q.status === "doing" || (q.start && q.start <= now && q.end > now)) groups.now.push(q);
    else if ((q.end && q.end < now && q.status === "todo") || (q.deadline && q.deadline < now)) groups.overdue.push(q);
    else if (when && dayOf(when) === today) groups.today.push(q);
    else if (when) groups.upcoming.push(q);
    else if (q.deadline && dayOf(q.deadline) === today) groups.today.push(q);
    else groups.anytime.push(q);
  }
  for (const k of Object.keys(groups)) groups[k].sort(k === "done" ? (a, b) => String(b.completed || b.updated || "").localeCompare(String(a.completed || a.updated || "")) : compare);
  groups.done = groups.done.slice(0, 30);
  return groups;
}

// Focus: the one thing to do now, then what's after it. Started first, then what's on right now,
// overdue, the next planned, then anything else by the person's order and priority.
export function focusList(quests, now = todayStamp()) {
  const g = sections(quests, now);
  const byPriority = (a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || compare(a, b);
  const doing = g.now.filter((q) => q.status === "doing");
  const onNow = g.now.filter((q) => q.status !== "doing");
  return [...doing, ...onNow, ...[...g.overdue].sort(byPriority), ...g.today, ...g.upcoming.slice(0, 5), ...[...g.anytime].sort(byPriority)];
}

// Board: one column per mode, in the order people use them
export const BOARD_MODES = ["waiting", "soon", "working", "nearly", "longer", "questions", "done"];
export function columns(quests) {
  const cols = Object.fromEntries(BOARD_MODES.map((m) => [m, []]));
  for (const q of quests) {
    if (q.status === "skipped") continue;
    const mode = q.status === "done" ? "done" : BOARD_MODES.includes(q.mode) ? q.mode : q.status === "doing" ? "working" : "waiting";
    cols[mode].push(q);
  }
  for (const m of BOARD_MODES) cols[m].sort(m === "done" ? (a, b) => String(b.completed || "").localeCompare(String(a.completed || "")) : compare);
  cols.done = cols.done.slice(0, 20);
  return cols;
}

// Today and the days after: each day's quests by time (ones with no time yet in `unplaced`)
export function days(quests, now = todayStamp(), ahead = 7) {
  const today = dayOf(now);
  const out = new Map();
  const unplaced = [];
  for (const q of quests) {
    if (!open(q) && !(q.status === "done" && dayOf(q.start) === today)) continue;
    const when = q.start || q.fixedStart;
    if (!when) {
      if (open(q)) unplaced.push(q);
      continue;
    }
    const d = dayOf(when);
    if (d < today) {
      if (open(q)) (out.get(today) || out.set(today, []).get(today)).push(q); // late: shown today
      continue;
    }
    const diff = Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
    if (diff > ahead) continue;
    (out.get(d) || out.set(d, []).get(d)).push(q);
  }
  const list = [...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, qs]) => ({ day, quests: qs.sort((a, b) => String(a.start || a.fixedStart).localeCompare(String(b.start || b.fixedStart))) }));
  if (!list.length || list[0].day !== today) list.unshift({ day: today, quests: [] });
  return { list, unplaced: unplaced.sort(compare) };
}

// Days in a row (up to today) with at least one quest done; today not done yet doesn't break it
export function streak(quests, now = new Date()) {
  const doneDays = new Set();
  for (const q of quests) {
    if (q.status !== "done" || !q.completed) continue;
    const t = ukNow(new Date(q.completed));
    doneDays.add(`${t.y}-${t.m}-${t.d}`);
  }
  const t = ukNow(now);
  let day = new Date(Date.UTC(t.y, t.m - 1, t.d));
  const key = (d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const doneToday = doneDays.has(key(day));
  if (!doneToday) day = new Date(day.getTime() - 864e5);
  let n = 0;
  while (doneDays.has(key(day))) {
    n++;
    day = new Date(day.getTime() - 864e5);
  }
  return { days: n, doneToday };
}

// Tags in use, most used first
export function tagsInUse(quests) {
  const counts = new Map();
  for (const q of quests) if (open(q)) for (const t of q.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
