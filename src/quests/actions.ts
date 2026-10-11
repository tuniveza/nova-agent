// Everything you can do with missions and quests. The chat's tools and the
// page's buttons both use these, so they always behave the same. Every change
// re-plans, so the schedule stays optimised after each one.

import { randomUUID } from "node:crypto";
import { replan, nowMinutes } from "./plan";
import { acknowledge, firstTimeForTap } from "./deliveries";
import { nextSession, splitLong } from "./lengths";
import { isPulse } from "./pulses";
import { notifyMission, recentNotices } from "./reminders";
import { fromMin, toMin } from "./scheduler";
import { cleanQuest, cleanRhythm, EVERY, MODES, PRIORITIES, readQuests, readStamp, rhythmFor, TIMES_OF_DAY, writeQuests, type Block, type Mission, type Quest, type QuestData, type QuestMode, type Rhythm } from "./store";
import { ownerOf, personName } from "../person";
import { pcOwnerId } from "../staff";

const stamp = () => fromMin(nowMinutes());

// By id, or by the start of one if only one id starts that way (Claude often shortens them)
function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  if (!id) throw new Error(`Which ${what}? No id was given.`);
  const exact = list.find((x) => x.id === id);
  if (exact) return exact;
  const starts = list.filter((x) => x.id.startsWith(id));
  if (starts.length > 1) throw new Error(`More than one ${what} has an id starting ${id}: ${starts.map((x) => x.id).join(", ")}.`);
  if (!starts.length) throw new Error(`No ${what} with id ${id}.`);
  return starts[0];
}

function missionProgress(data: QuestData, m: Mission) {
  const qs = data.quests.filter((q) => q.missionId === m.id);
  const done = qs.filter((q) => q.status === "done").length;
  const counted = qs.filter((q) => q.status !== "skipped").length;
  // Each workstream's share, and the next milestone still to reach
  const tracks = m.tracks.map((t) => {
    const mine = qs.filter((q) => q.track === t.name && q.status !== "skipped");
    return { ...t, done: mine.filter((q) => q.status === "done").length, total: mine.length };
  });
  const nextMilestone = m.milestones.find((x) => !x.done) ?? null;
  return { total: counted, done, atRisk: qs.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length, minutesLeft: qs.filter((q) => q.status === "todo" || q.status === "doing").reduce((n, q) => n + q.minutes, 0), tracks, nextMilestone };
}

// Everything the page needs, in one go
// A tap from Portal's Quests tab (passed on by Nova Bot's worker)
export interface QuestTap {
  kind: "quest" | "mission";
  id: string;
  action: string;
  minutes?: number;
  tapId?: string; // the same tap handed over twice counts once
  session?: string; // the session (start) it was tapped on
  mode?: string; // for "mode": how it's going now (MODES)
  by?: string; // who tapped (their staff id; taps from before this change don't say)
  admin?: boolean; // ...and whether they're an admin
}
export function applyQuestTap(t: QuestTap): string {
  if (t.tapId && !firstTimeForTap(t.tapId)) {
    const item = t.kind === "mission" ? readQuests().missions.find((m) => m.id === t.id) : readQuests().quests.find((q) => q.id === t.id);
    return `${item?.title ?? t.id} (already counted)`;
  }
  // Staff tap their own quests and missions (admins anyone's)
  if (t.by && !t.admin) {
    const data = readQuests();
    const item = t.kind === "mission" ? find(data.missions, t.id, "mission") : find(data.quests, t.id, "quest");
    if (!mayChange(item, { id: t.by, everyone: false })) throw new Error(`“${item.title}” isn't theirs to change`);
  }
  if (t.kind === "mission") {
    if (t.action === "pause") return updateMission(t.id, { status: "paused" }).title;
    if (t.action === "resume") return updateMission(t.id, { status: "active" }).title;
    throw new Error(`Missions can't "${t.action}"`);
  }
  const done = (q: Quest) => q.title;
  if (t.action === "done") return done(setQuestStatus(t.id, "done", false, t.session));
  if (t.action === "finish") return done(setQuestStatus(t.id, "done", true));
  if (t.action === "start") return done(setQuestStatus(t.id, "doing"));
  if (t.action === "skip") return done(setQuestStatus(t.id, "skipped"));
  if (t.action === "reopen") return done(setQuestStatus(t.id, "todo"));
  if (t.action === "snooze") return done(snoozeQuest(t.id, Math.max(1, Number(t.minutes) || 15)));
  if (t.action === "mode") return done(setQuestMode(t.id, String(t.mode || "")));
  throw new Error(`Quests can't "${t.action}"`);
}

// Who's looking, and at what: their own (the default), or everyone's (`everyone`, for admins and
// the PC). `notes`: their own plus quests tied to a note (Notes keeps a shared note's quests in
// step for whoever has it open).
export interface Viewer {
  id: string;
  everyone?: boolean;
  notes?: boolean;
}
type Owned = { owner?: string; link?: string };
const sees = (x: Owned, v?: Viewer) => !v || v.everyone || ownerOf(x) === v.id || (v.notes === true && String(x.link || "").startsWith("note:"));
// May this person change it? Their own; an admin (or the PC) anyone's; a quest tied to a note
// whoever edits the note.
export function mayChange(x: Owned, p: { id: string; everyone: boolean }): boolean {
  return p.everyone || ownerOf(x) === p.id || String(x.link || "").startsWith("note:");
}
// Owners resolved ("" becomes the PC's person) and named, for the pages
const named = <T extends { owner: string }>(x: T): T & { ownerName: string } => {
  const owner = ownerOf(x);
  return { ...x, owner, ownerName: personName(owner) };
};

// Everything the page needs, in one go: everyone's (no viewer: Portal's copy, the PC's own
// bookkeeping), or what one person sees
export function questState(viewer?: Viewer) {
  const data = readQuests();
  const now = nowMinutes();
  const nowStamp = fromMin(now);
  const quests = data.quests.filter((q) => sees(q, viewer));
  // "Now" and "next" are the viewer's own, even looking at everyone's
  const own = viewer ? quests.filter((q) => ownerOf(q) === viewer.id) : quests;
  const open = quests.filter((q) => q.status === "todo" || q.status === "doing");
  const openOwn = own.filter((q) => q.status === "todo" || q.status === "doing");
  const doing = own.find((q) => q.status === "doing") || openOwn.find((q) => q.start && q.start <= nowStamp && q.end > nowStamp) || null;
  const next = openOwn.filter((q) => !isPulse(q) && q.start && q.start > nowStamp && q.id !== doing?.id).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  return {
    now: nowStamp,
    rhythm: viewer ? rhythmFor(data, viewer.id, pcOwnerId()) : data.rhythm,
    missions: data.missions.filter((m) => sees(m, viewer && { ...viewer, notes: false })).map((m) => named({ ...m, progress: missionProgress(data, m) })),
    quests: quests.map(named),
    blocks: data.blocks.filter((b) => sees(b, viewer && { ...viewer, notes: false })).map(named),
    current: doing && named(doing),
    next: next.map(named),
    overdue: open.filter((q) => q.start && toMin(q.end) < now && q.status === "todo").map(named),
    unplanned: open.filter((q) => !q.start && !isPulse(q)).map(named),
    pulses: open.filter(isPulse).map(named),
    notices: recentNotices()
      .filter((n) => !viewer || !n.owner || n.owner === viewer.id || viewer.everyone)
      .slice(-10),
  };
}

// For an ongoing quest, "done" finishes this session and lines up the next one;
// `finish` ends the quest for good. `forSession` (from a Portal tap): the
// session it was tapped on; if that one's already done, nothing changes.
export function setQuestStatus(id: string, status: Quest["status"], finish = false, forSession?: string): Quest {
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  if (forSession !== undefined && q.ongoing && status === "done" && !finish && !isPulse(q) && q.start !== forSession) return q;
  // A pulse just counts it (it keeps its own beat)
  if (isPulse(q) && status === "done" && !finish) {
    q.sessions += 1;
    q.updated = new Date().toISOString();
    writeQuests(data);
    return q;
  }
  if (q.ongoing && status === "done" && !finish) {
    const sessionStart = q.start || fromMin(nowMinutes());
    // Marked done: that settles the session, ping or no ping
    acknowledge(q.id, q.start);
    q.sessions += 1;
    q.completed = new Date().toISOString();
    q.status = "todo";
    q.earliest = nextSession(q.every, sessionStart, q.everyMinutes, nowMinutes());
    q.start = q.end = q.travelStart = q.fixedStart = "";
    q.remindedFor = q.checkedFor = "";
    // Past its deadline: that was the last session
    if (q.deadline && q.earliest >= q.deadline) q.status = "done";
    q.updated = q.completed;
    writeQuests(data);
    replan();
    return readQuests().quests.find((x) => x.id === q.id)!;
  }
  q.status = status;
  q.updated = new Date().toISOString();
  // The mode follows: done is Done, started is Working On It (unless it already says how it's going)
  if (status === "done") q.mode = "done";
  if (status === "doing" && !["working", "nearly", "longer"].includes(q.mode)) q.mode = "working";
  if (status === "todo" && ["done", "working", "nearly", "longer"].includes(q.mode)) q.mode = "waiting";
  if (status === "done") q.completed = q.updated;
  if (status === "doing") {
    // Started now: it takes its time from here (the rest of the day moves around it)
    const now = nowMinutes();
    q.start = fromMin(now);
    q.end = fromMin(now + q.minutes);
    q.travelStart = q.start;
  }
  if (status === "done") {
    // Finished early (or before its planned time): it took place up to now, and its slot is freed
    const now = nowMinutes();
    if (!q.start || toMin(q.start) > now) {
      q.start = fromMin(now - q.minutes);
      q.travelStart = q.start;
    }
    if (toMin(q.end || q.start) > now || !q.end) q.end = fromMin(now);
  }
  if (status === "todo") q.start = q.end = q.travelStart = "";
  // Finishing every quest finishes the mission
  const mission = data.missions.find((m) => m.id === q.missionId);
  if (mission && mission.status !== "done" && data.quests.filter((x) => x.missionId === mission.id).every((x) => x.status === "done" || x.status === "skipped")) {
    mission.status = "done";
    const count = data.quests.filter((x) => x.missionId === mission.id && x.status === "done").length;
    notifyMission("complete", `Mission complete ✦ ${mission.title}`, `All ${count} quest${count === 1 ? "" : "s"} done. Brilliant work.`, mission.id);
  }
  writeQuests(data);
  replan();
  return readQuests().quests.find((x) => x.id === q.id)!;
}

// How it's going (Notes, the front page, Portal): the mode, and the status it means.
// Done finishes it; Working On It, Nearly Finished and Taking longer than expected start it;
// Waiting, Soon and Questions put it back to be done.
export function setQuestMode(id: string, mode: string): Quest {
  if (!(MODES as readonly string[]).includes(mode)) throw new Error(`The mode must be one of: ${MODES.join(", ")}.`);
  const m = mode as QuestMode;
  const q = find(readQuests().quests, id, "quest");
  const started = m === "working" || m === "nearly" || m === "longer";
  if (m === "done" && q.status !== "done") setQuestStatus(q.id, "done", true);
  else if (started && q.status !== "doing") setQuestStatus(q.id, "doing");
  else if (!started && m !== "done" && (q.status === "doing" || q.status === "done")) setQuestStatus(q.id, "todo");
  const data = readQuests();
  const saved = data.quests.find((x) => x.id === q.id)!;
  saved.mode = m;
  saved.updated = saved.edited = new Date().toISOString();
  writeQuests(data);
  return saved;
}

// Not now: try again in `minutes` (or more time if it's under way)
export function snoozeQuest(id: string, minutes = 15): Quest {
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  if (q.status === "doing") {
    q.minutes += minutes;
    q.end = fromMin(toMin(q.end) + minutes);
  } else {
    q.earliest = fromMin(nowMinutes() + minutes);
    q.fixedStart = "";
    q.start = q.end = q.travelStart = "";
    q.remindedFor = "";
  }
  q.updated = new Date().toISOString();
  writeQuests(data);
  replan();
  return readQuests().quests.find((x) => x.id === q.id)!;
}

// `owner`: whose it is (the person who asked; "" = the PC's person). An owner in `input` (from a
// page) is never taken: only the server says who's asking.
export function addQuest(input: Partial<Quest>, owner = ""): Quest {
  const data = readQuests();
  // Tied to something that already has its quest (a shared note open in two places): that one
  if (input.link) {
    const twin = data.quests.find((x) => x.link && x.link === input.link);
    if (twin) return twin;
  }
  const q = cleanQuest({ ...input, owner, id: randomUUID(), status: "todo", mode: (MODES as readonly string[]).includes(input.mode as string) && !["done", "working", "nearly", "longer"].includes(input.mode as string) ? input.mode : "waiting" });
  // A long quest becomes sessions; the last one keeps the id
  data.quests.push(...splitLong(q, rhythmFor(data, ownerOf(q), pcOwnerId())));
  writeQuests(data);
  replan();
  return readQuests().quests.find((x) => x.id === q.id)!;
}

// What can be changed on a quest, and what each must be. An edit that doesn't
// fit is refused with the reason, never quietly cut short or left out.
const EDITABLE: Record<string, (v: any) => unknown> = {
  title: (v) => words(v, 140, "The title", true),
  notes: (v) => words(v, 2000, "The notes"),
  location: (v) => words(v, 160, "The place"),
  track: (v) => words(v, 40, "The track"),
  minutes: (v) => amount(v, "How long it takes", 1 / 60, 1_000_000),
  everyMinutes: (v) => amount(v, "How often it repeats", 1 / 60, 1_000_000),
  travelMinutes: (v) => (Number.isInteger(v) && v >= 0 && v <= 300 ? v : bad("Travel time must be 0 to 300 minutes.")),
  ongoing: (v) => (typeof v === "boolean" ? v : bad("Ongoing must be yes or no.")),
  every: (v) => oneOf(v, EVERY, "How often"),
  priority: (v) => oneOf(v, PRIORITIES, "The priority"),
  timeOfDay: (v) => oneOf(v, TIMES_OF_DAY, "The time of day"),
  deadline: (v) => readStamp(v, "23:59"),
  earliest: (v) => readStamp(v, "00:00"),
  fixedStart: (v) => readStamp(v, "09:00"),
  from: (v) => words(v, 80, "Where it's from"),
  link: (v) => words(v, 160, "What it's tied to"),
  phones: (v) => (Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === "string" && /^[0-9a-f]{12}$/.test(x)) ? [...new Set(v)] : bad("Phones must be a list of up to 10 phone ids.")),
  dependsOn: (v) => (Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === "string" && x.length <= 64) ? v : bad("Depends on must be a list of up to 20 quest ids.")),
};
function bad(message: string): never {
  throw new Error(message);
}
const words = (v: unknown, max: number, what: string, needed = false) =>
  typeof v !== "string" ? bad(`${what} must be text.`) : v.length > max ? bad(`${what} is too long (${v.length} characters; up to ${max}).`) : needed && !v.trim() ? bad(`${what} can't be empty.`) : v;
const amount = (v: unknown, what: string, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 60) / 60 : bad(`${what} must be a number of minutes from a second up.`));
const oneOf = (v: unknown, options: readonly string[], what: string) => (options.includes(v as string) ? v : bad(`${what} must be one of: ${options.join(", ")}.`));

// The changes, checked: unknown fields, unreadable times and values that don't fit throw
function checkedChanges(changes: Record<string, unknown>): Partial<Quest> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const check = EDITABLE[key];
    if (!check) throw new Error(`"${key}" can't be changed here.`);
    out[key] = check(value);
  }
  return out as Partial<Quest>;
}

export function updateQuest(id: string, changes: Partial<Quest>): Quest {
  // A new mode (and the status it means) has its own way in
  const { mode, ...rest } = changes as Partial<Quest> & { mode?: string };
  if (mode !== undefined) {
    const q = setQuestMode(id, mode);
    return Object.keys(rest).length ? updateQuest(q.id, rest) : q;
  }
  const wanted = checkedChanges(changes);
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  const at = new Date().toISOString();
  const merged = cleanQuest({ ...q, ...wanted, id: q.id, updated: at, edited: at });
  if (wanted.fixedStart !== undefined || wanted.minutes !== undefined) merged.remindedFor = merged.checkedFor = "";
  // A repeat given a new interval: its next session counts from the last one at the new spacing
  if (wanted.everyMinutes !== undefined && wanted.everyMinutes !== q.everyMinutes && q.ongoing && q.every === "interval" && q.status === "todo" && !q.fixedStart && q.earliest && q.sessions + q.missed > 0) {
    merged.earliest = fromMin(toMin(q.earliest) - q.everyMinutes + wanted.everyMinutes);
    merged.start = merged.end = merged.travelStart = "";
  }
  // Made longer than a session: it becomes sessions (the last one keeps the id)
  const rhythm = rhythmFor(data, ownerOf(q), pcOwnerId());
  data.quests.splice(data.quests.indexOf(q), 1, ...splitLong(merged, rhythm));
  writeQuests(data);
  // Saved as asked? Read back from the file (before re-planning moves anything on).
  // A session split keeps the id; its length is then per session.
  const saved = readQuests().quests.find((x) => x.id === q.id);
  if (!saved) throw new Error(`The change to “${q.title}” didn't save: the quest is gone.`);
  for (const [key, value] of Object.entries(wanted)) {
    if (key === "minutes" && splitLong(merged, rhythm).length > 1) continue;
    if (JSON.stringify((saved as any)[key]) !== JSON.stringify(value)) throw new Error(`The change to “${q.title}” didn't save (${key}). Try again, or tell me if it keeps happening.`);
  }
  replan();
  return readQuests().quests.find((x) => x.id === q.id)!;
}

export function removeQuest(id: string): Quest {
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  data.quests = data.quests.filter((x) => x.id !== q.id).map((x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== q.id) }));
  writeQuests(data);
  replan();
  return q;
}

export function updateMission(id: string, changes: Partial<Pick<Mission, "title" | "status" | "deadline" | "summary">>): Mission {
  const data = readQuests();
  const m = find(data.missions, id, "mission");
  Object.assign(m, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), { updated: new Date().toISOString() });
  writeQuests(data);
  replan();
  return m;
}

// Tick a milestone off (or untick it)
export function setMilestone(missionId: string, milestoneId: string, done: boolean): Mission {
  const data = readQuests();
  const m = find(data.missions, missionId, "mission");
  const ms = find(m.milestones, milestoneId, "milestone");
  ms.done = done;
  m.updated = new Date().toISOString();
  writeQuests(data);
  replan();
  return m;
}

export function removeMission(id: string): Mission {
  const data = readQuests();
  const m = find(data.missions, id, "mission");
  data.missions = data.missions.filter((x) => x.id !== m.id);
  data.quests = data.quests.filter((q) => q.missionId !== m.id);
  writeQuests(data);
  replan();
  return m;
}

// A blocked time is one person's (`owner`; "" = the PC's person): only their quests move for it
export function addBlock(start: string, end: string, reason: string, owner = ""): Block {
  const data = readQuests();
  if (!(end > start)) throw new Error("The end has to be after the start.");
  const block = { id: randomUUID(), owner, start, end, reason: reason || "Busy" };
  data.blocks.push(block);
  // Their quests pinned inside it lose their pin, so they can move
  const whose = ownerOf(block);
  for (const q of data.quests) if (q.fixedStart && q.fixedStart >= start && q.fixedStart < end && q.status === "todo" && ownerOf(q) === whose) q.fixedStart = "";
  writeQuests(data);
  replan();
  return block;
}

export function removeBlock(id: string): Block {
  const data = readQuests();
  const b = find(data.blocks, id, "blocked time");
  data.blocks = data.blocks.filter((x) => x.id !== b.id);
  writeQuests(data);
  replan();
  return b;
}

// `owner`: whose rhythm (none, or the PC's person: the main one; anyone else gets their own,
// starting from the main one)
export function setRhythm(changes: Partial<Rhythm>, owner = ""): Rhythm {
  const data = readQuests();
  const wanted = Object.fromEntries(Object.entries(changes ?? {}).filter(([, v]) => v !== undefined));
  const pc = pcOwnerId();
  if (!owner || owner === pc) data.rhythm = { ...data.rhythm, ...wanted } as Rhythm;
  else data.rhythms[owner] = cleanRhythm({ ...rhythmFor(data, owner, pc), ...wanted });
  writeQuests(data);
  return rhythmFor(replan().data, owner || pc, pc);
}

// Old blocked times tidy themselves away
export function tidyBlocks(): void {
  const data = readQuests();
  const cutoff = fromMin(nowMinutes() - 7 * 1440);
  const keep = data.blocks.filter((b) => b.end >= cutoff);
  if (keep.length !== data.blocks.length) {
    data.blocks = keep;
    writeQuests(data);
  }
}
