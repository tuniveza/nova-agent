// Quests ⇄ Google Tasks, from this PC's side (Nova Bot keeps the "Nova quests" list: its
// src/google/tasks.js). Every 10 minutes the PC's person's quests are sent: open ones, and ones
// finished in the last week (so a task gets ticked off). Repeating quests stay out: a task list
// can't hold "every day". Quests ticked off in Google Tasks come back as done here.

import { syncTasks, type TaskQuest } from "../google";
import { trace } from "../trace";
import { pcOwnerId } from "../staff";
import { readQuests } from "./store";
import { setQuestStatus } from "./actions";

const EVERY_MS = 10 * 60_000;
const WEEK_MS = 7 * 86400_000;

export function questsForTasks(now = Date.now()): TaskQuest[] {
  const data = readQuests();
  const pc = pcOwnerId();
  return data.quests
    .filter((q) => (q.owner === "" || q.owner === pc) && !q.ongoing && q.status !== "skipped")
    .filter((q) => q.status !== "done" || (q.completed && now - Date.parse(q.completed) < WEEK_MS))
    .map((q) => ({
      id: q.id,
      title: q.title,
      notes: [q.notes, q.start ? `Planned ${new Date(q.start).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} (Nova Agent)` : ""].filter(Boolean).join("\n").slice(0, 2000),
      due: (q.deadline || q.start || "").slice(0, 10) || null,
      done: q.status === "done",
    }));
}

export async function tasksOnce(): Promise<number> {
  const result = await syncTasks(questsForTasks());
  if (!result || result.skipped) return 0;
  let done = 0;
  for (const id of result.completed ?? []) {
    try {
      const q = readQuests().quests.find((x) => x.id === id);
      if (q && q.status !== "done") {
        setQuestStatus(id, "done", true);
        done++;
      }
    } catch (error) {
      trace("task", "warn", `Google Tasks: a quest ticked off there couldn't be marked done: ${(error as Error).message}`);
    }
  }
  if (done) trace("task", "ok", `Google Tasks: ${done} quest${done === 1 ? "" : "s"} ticked off there, marked done here`);
  return done;
}

let timer: NodeJS.Timeout | null = null;
export function startTasksSync(): void {
  if (timer) return;
  const run = () => void tasksOnce().catch((error) => trace("task", "warn", `Google Tasks didn't sync: ${(error as Error).message}`));
  setTimeout(run, 60_000).unref?.();
  timer = setInterval(run, EVERY_MS);
  timer.unref?.();
}
