// Reminders and check-ins for Nova Quests, checked every 10 seconds:
//   - a few minutes before a quest starts (or before leaving, if there's travel)
//   - a check-in when it should be finished: done? need more time? move it?
//   - a quest left unanswered an hour after its end is moved to a new time
//   - the morning plan when the day starts, and a wrap-up before winding down
// Each one goes to the open Nova Agent page (a pop-up and a sound) and, if the
// rhythm says so, to the Nova Hub phones through Nova Bot.

import { config } from "../config";
import { trace } from "../trace";
import { replan, nowMinutes } from "./plan";
import { describeLength } from "./lengths";
import { isPulse } from "./pulses";
import { fromMin, toMin } from "./scheduler";
import { questEvents, readQuests, writeQuests, type Quest } from "./store";

export interface QuestNotice {
  kind: "starting" | "leave" | "checkin" | "moved" | "briefing" | "wrapup" | "mission" | "pulse";
  title: string;
  message: string;
  questId?: string;
  time: string;
}

const recent: QuestNotice[] = [];
const hm = (stamp: string) => (stamp.length > 16 ? stamp.slice(11, 19) : stamp.slice(11, 16));

// How long each kind is worth delivering to a phone (a late "up next" is no use), and which must be answered
const PHONE: Record<QuestNotice["kind"], { ttl: number; urgent: boolean }> = {
  starting: { ttl: 1800, urgent: false },
  leave: { ttl: 1800, urgent: true },
  checkin: { ttl: 3600, urgent: true },
  moved: { ttl: 3600, urgent: false },
  briefing: { ttl: 4 * 3600, urgent: false },
  wrapup: { ttl: 2 * 3600, urgent: false },
  mission: { ttl: 86400, urgent: false },
  pulse: { ttl: 60, urgent: false },
};

function notify(n: Omit<QuestNotice, "time">, push: boolean) {
  const notice = { ...n, time: new Date().toISOString() };
  recent.push(notice);
  if (recent.length > 50) recent.shift();
  questEvents.emit("notice", notice);
  const source = n.kind === "mission" ? "mission" : "quest";
  trace("task", "info", `Nova ${source === "mission" ? "Mission" : "Quest"}: ${n.title}: ${n.message}`);
  // To the Nova Hub phones too, labelled as Nova Quest or Nova Mission
  if (push && config.agentNovaKey) {
    fetch(`${config.workerUrl}/hub/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      // Pulses replace each other on the phone and stay out of Nova Hub's Alerts list
      body: JSON.stringify({ title: n.title, message: n.message, source, kind: n.kind, tag: n.questId || n.kind, ...PHONE[n.kind], keep: n.kind !== "pulse" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
}

// One beat of a pulse (see pulses.ts): a quick ping, not kept in the notices list
export function pulseBeat(q: Quest, push: boolean): void {
  const n = { kind: "pulse" as const, title: q.title, message: `${describeLength(q)}${q.deadline ? ` · until ${q.deadline.slice(11, 16)}` : ""}`, questId: q.id };
  questEvents.emit("notice", { ...n, time: new Date().toISOString() });
  if (push && config.agentNovaKey) {
    fetch(`${config.workerUrl}/hub/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify({ title: n.title, message: n.message, source: "quest", kind: "pulse", tag: q.id, ...PHONE.pulse, keep: false }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
}

// Mission news (planned, complete): on the page and, if the rhythm says so, the phones
export function notifyMission(_what: "planned" | "complete", title: string, message: string, missionId: string): void {
  notify({ kind: "mission", title, message, questId: `mission-${missionId}` }, readQuests().rhythm.phonePush);
}

export const recentNotices = () => [...recent];

// The plan for one day, in words
export function dayPlanText(quests: Quest[], day: string): string {
  const today = quests.filter((q) => q.start.startsWith(day) && q.status !== "skipped").sort((a, b) => a.start.localeCompare(b.start));
  if (!today.length) return "Nothing planned. A free day.";
  return today.map((q) => `${hm(q.start)} ${q.status === "done" ? "✓ " : ""}${q.title}`).join(" · ");
}

function tick() {
  const data = readQuests();
  const r = data.rhythm;
  const now = nowMinutes();
  const today = fromMin(now).slice(0, 10);
  let changed = false;
  let needsReplan = false;

  for (const q of data.quests) {
    if (!q.start || q.status === "done" || q.status === "skipped" || isPulse(q)) continue;
    const start = toMin(q.start);
    const leave = toMin(q.travelStart || q.start);
    const end = toMin(q.end);
    // Before it starts (or before setting off); quick quests and repeats ping right on time instead
    const quick = q.minutes < 5 && !q.travelMinutes;
    const lead = quick ? 0 : r.remindMinutesBefore;
    if (q.status === "todo" && q.remindedFor !== q.start && now >= leave - lead && now < Math.max(end, start + 2)) {
      q.remindedFor = q.start;
      changed = true;
      if (q.travelMinutes && now < start) {
        notify({ kind: "leave", title: `Time to head out: ${q.title}`, message: `Leave by ${hm(q.travelStart)} to be at ${q.location || "the next place"} for ${hm(q.start)} (${q.travelMinutes} min travel).`, questId: q.id }, r.phonePush);
      } else {
        notify({ kind: "starting", title: quick ? `Now: ${q.title}` : `Up next at ${hm(q.start)}: ${q.title}`, message: `${describeLength(q)}${q.ongoing && q.sessions ? ` (session ${q.sessions + 1})` : ""}${q.location ? ` at ${q.location}` : ""}. Ready when you are.`, questId: q.id }, r.phonePush);
      }
    }
    // When it should be done (repeats just move on to their next time)
    const repeat = q.ongoing && q.every === "interval";
    if (repeat && now >= end) needsReplan = true;
    if (r.checkIns && !repeat && q.checkedFor !== q.end && now >= end) {
      q.checkedFor = q.end;
      changed = true;
      notify({ kind: "checkin", title: q.ongoing ? `Session done? “${q.title}”` : `Did you finish “${q.title}”?`, message: q.ongoing ? "Mark the session done and the next one is lined up, or give it more time." : "Mark it done, give it more time, or move it.", questId: q.id }, r.phonePush);
    }
    // Unanswered an hour later: find it a new time
    if (q.status === "todo" && !q.fixedStart && now >= end + 60) needsReplan = true;
  }

  // The morning plan and the evening wrap-up
  if (r.dailyBriefing) {
    const wake = toMin(`${today}T${r.wake}`);
    if (data.lastBriefing !== today && now >= wake && now < wake + 4 * 60) {
      data.lastBriefing = today;
      changed = true;
      const atRisk = data.quests.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length;
      notify({ kind: "briefing", title: "Good morning ✦ Today's quests", message: `${dayPlanText(data.quests, today)}${atRisk ? ` · ${atRisk} quest${atRisk === 1 ? " is" : "s are"} at risk of missing a deadline` : ""}` }, r.phonePush);
    }
    let sleep = toMin(`${today}T${r.sleep}`);
    if (r.sleep <= r.wake) sleep += 1440;
    const wrap = sleep - r.windDownMinutes - 15;
    if (data.lastWrapUp !== today && now >= wrap && now < sleep) {
      data.lastWrapUp = today;
      changed = true;
      const done = data.quests.filter((q) => q.start.startsWith(today) && q.status === "done").length;
      const left = data.quests.filter((q) => q.start.startsWith(today) && q.status === "todo").length;
      notify({ kind: "wrapup", title: "Winding down ✦ How did today go?", message: `${done} quest${done === 1 ? "" : "s"} done${left ? `, ${left} still open: tell me what happened and I'll move them` : ". Brilliant"}. Tomorrow: ${dayPlanText(data.quests, fromMin(now + 1440).slice(0, 10))}` }, r.phonePush);
    }
  }

  if (changed) writeQuests(data);
  if (needsReplan) {
    const before = new Map(data.quests.map((q) => [q.id, q.start]));
    const result = replan();
    for (const q of result.data.quests) {
      const was = before.get(q.id);
      if (was && was !== q.start && q.status === "todo" && !q.ongoing) {
        notify({ kind: "moved", title: `Moved “${q.title}”`, message: q.start ? `It didn't get done, so it's now ${new Date(toMin(q.start) * 60000).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} at ${hm(q.start)}.` : "It didn't get done and there's no free time for it yet. Shall we make room?", questId: q.id }, r.phonePush);
      }
    }
  }
}

let timer: NodeJS.Timeout | undefined;
export function startQuestReminders(): void {
  if (timer) return;
  const run = () => {
    try {
      tick();
    } catch (error) {
      trace("task", "warn", `Nova Quest reminders: ${(error as Error).message}`);
    }
  };
  setTimeout(run, 5_000);
  // Every 10 seconds, so quests of seconds (and quick repeats) ping on time
  timer = setInterval(run, 10_000);
  console.log("Nova Quest reminders: on");
}
