// Everything you can do with missions and quests. The chat's tools and the
// page's buttons both use these, so they always behave the same. Every change
// re-plans, so the schedule stays optimised after each one.

import { randomUUID } from "node:crypto";
import { replan, nowMinutes } from "./plan";
import { nextSession, splitLong } from "./lengths";
import { notifyMission, recentNotices } from "./reminders";
import { fromMin, toMin } from "./scheduler";
import { cleanQuest, readQuests, writeQuests, type Block, type Mission, type Quest, type QuestData, type Rhythm } from "./store";

const stamp = () => fromMin(nowMinutes());

function find<T extends { id: string }>(list: T[], id: string, what: string): T {
  const item = list.find((x) => x.id === id || x.id.startsWith(id));
  if (!item) throw new Error(`No ${what} with id ${id}.`);
  return item;
}

function missionProgress(data: QuestData, m: Mission) {
  const qs = data.quests.filter((q) => q.missionId === m.id);
  const done = qs.filter((q) => q.status === "done").length;
  const counted = qs.filter((q) => q.status !== "skipped").length;
  return { total: counted, done, atRisk: qs.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length, minutesLeft: qs.filter((q) => q.status === "todo" || q.status === "doing").reduce((n, q) => n + q.minutes, 0) };
}

// Everything the page needs, in one go
export function questState() {
  const data = readQuests();
  const now = nowMinutes();
  const nowStamp = fromMin(now);
  const open = data.quests.filter((q) => q.status === "todo" || q.status === "doing");
  const doing = data.quests.find((q) => q.status === "doing") || open.find((q) => q.start && q.start <= nowStamp && q.end > nowStamp) || null;
  const next = open.filter((q) => q.start && q.start > nowStamp && q.id !== doing?.id).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
  return {
    now: nowStamp,
    rhythm: data.rhythm,
    missions: data.missions.map((m) => ({ ...m, progress: missionProgress(data, m) })),
    quests: data.quests,
    blocks: data.blocks,
    current: doing,
    next,
    overdue: open.filter((q) => q.start && toMin(q.end) < now && q.status === "todo"),
    unplanned: open.filter((q) => !q.start),
    notices: recentNotices().slice(-10),
  };
}

// For an ongoing quest, "done" finishes this session and lines up the next one;
// `finish` ends the quest for good.
export function setQuestStatus(id: string, status: Quest["status"], finish = false): Quest {
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  if (q.ongoing && status === "done" && !finish) {
    const sessionStart = q.start || fromMin(nowMinutes());
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

export function addQuest(input: Partial<Quest>): Quest {
  const data = readQuests();
  const q = cleanQuest({ ...input, id: randomUUID(), status: "todo" });
  // A long quest becomes sessions; the last one keeps the id
  data.quests.push(...splitLong(q, data.rhythm));
  writeQuests(data);
  replan();
  return readQuests().quests.find((x) => x.id === q.id)!;
}

export function updateQuest(id: string, changes: Partial<Quest>): Quest {
  const data = readQuests();
  const q = find(data.quests, id, "quest");
  const merged = cleanQuest({ ...q, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), id: q.id, updated: new Date().toISOString() });
  if (changes.fixedStart !== undefined || changes.minutes !== undefined) merged.remindedFor = merged.checkedFor = "";
  // Made longer than a session: it becomes sessions (the last one keeps the id)
  data.quests.splice(data.quests.indexOf(q), 1, ...splitLong(merged, data.rhythm));
  writeQuests(data);
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

export function removeMission(id: string): Mission {
  const data = readQuests();
  const m = find(data.missions, id, "mission");
  data.missions = data.missions.filter((x) => x.id !== m.id);
  data.quests = data.quests.filter((q) => q.missionId !== m.id);
  writeQuests(data);
  replan();
  return m;
}

export function addBlock(start: string, end: string, reason: string): Block {
  const data = readQuests();
  if (!(end > start)) throw new Error("The end has to be after the start.");
  const block = { id: randomUUID(), start, end, reason: reason || "Busy" };
  data.blocks.push(block);
  // Quests pinned inside it lose their pin, so they can move
  for (const q of data.quests) if (q.fixedStart && q.fixedStart >= start && q.fixedStart < end && q.status === "todo") q.fixedStart = "";
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

export function setRhythm(changes: Partial<Rhythm>): Rhythm {
  const data = readQuests();
  data.rhythm = { ...data.rhythm, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) } as Rhythm;
  writeQuests(data);
  return replan().data.rhythm;
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
