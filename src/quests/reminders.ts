// Reminders and check-ins for Quests, checked every 10 seconds:
//   - a few minutes before a quest starts (or before leaving, if there's travel)
//   - a check-in when it should be finished: done? need more time? move it?
//   - a quest left unanswered an hour after its end is moved to a new time
//   - the morning plan when the day starts, and a wrap-up before winding down
// Each one goes to the open Nova Agent page (a pop-up and a sound) and, if the
// rhythm says so, to the staff phones through Nova Bot. Phone pings go
// through deliveries.ts: sent once each, checked, retried, and logged.
// Each goes to its owner only: their phones (unless the quest picked phones), their open page,
// worked out with their rhythm; the morning plan and wrap-up are each person's own quests.

import { config } from "../config";
import { trace } from "../trace";
import { deliver, retryDue, whenGivenUp } from "./deliveries";
import { replan, nowMinutes } from "./plan";
import { describeLength } from "./lengths";
import { isPulse } from "./pulses";
import { fromMin, toMin } from "./scheduler";
import { questEvents, readQuests, rhythmFor, writeQuests, type Quest, type QuestData } from "./store";
import { ownerOf } from "../person";
import { pcOwnerId } from "../staff";

export interface QuestNotice {
  // missed: a session that passed without a ping (Nova Agent was off); undelivered: a ping the phones never got
  // music: a studio booking change moved today's or tomorrow's music time
  kind: "starting" | "leave" | "checkin" | "moved" | "briefing" | "wrapup" | "mission" | "pulse" | "missed" | "undelivered" | "music";
  title: string;
  message: string;
  questId?: string;
  owner?: string; // whose it is (staff id): only their page shows it
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
  missed: { ttl: 3600, urgent: false },
  undelivered: { ttl: 3600, urgent: false },
  music: { ttl: 3 * 3600, urgent: false },
};

// Whose a notice is: its quest's or mission's owner, else the one given, else the PC's person
function ownerFor(n: Pick<QuestNotice, "questId" | "owner">, data: QuestData): string {
  if (n.owner) return n.owner;
  const q = n.questId ? data.quests.find((x) => x.id === n.questId) : undefined;
  if (q) return ownerOf(q);
  const m = n.questId?.startsWith("mission-") ? data.missions.find((x) => `mission-${x.id}` === n.questId) : undefined;
  return m ? ownerOf(m) : pcOwnerId();
}

// Show a notice on the page and send it to the phones, once: `session` is what
// it's about (a session's start, a day), so asking twice sends nothing new.
// `covers`: other sessions the same notice tells about.
function notify(n: Omit<QuestNotice, "time">, push: boolean, session = fromMin(nowMinutes()), covers?: string[]): boolean {
  const source = n.kind === "mission" ? "mission" : "quest";
  const data = readQuests();
  const owner = ownerFor(n, data);
  // To the owner's phones too, labelled as Quest or Mission.
  // Pulses replace each other on the phone and stay out of Portal's Alerts list
  // Only the phones the quest picked; none picked: the owner's phones (Nova Bot finds them;
  // "owner" means the PC doesn't know who it works for yet, so Nova Bot uses the studio owner's)
  const phones = n.questId ? data.quests.find((q) => q.id === n.questId)?.phones ?? [] : [];
  const phone = push && n.kind !== "undelivered" ? { title: n.title, message: n.message, source, kind: n.kind, tag: n.questId || n.kind, ...PHONE[n.kind], keep: n.kind !== "pulse", ...(phones.length ? { phones } : {}), ...(owner && owner !== "owner" ? { owner } : {}) } as const : null;
  // Notices that aren't about one quest (the morning plan) are kept apart per person
  const about = n.questId || (owner === pcOwnerId() ? n.kind : `${n.kind}-${owner}`);
  n = { ...n, owner };
  if (!deliver({ questId: about, session, kind: n.kind, push: phone, covers })) return false;
  if (n.kind === "pulse") {
    // A quick ping: not kept in the notices list or the trace
    questEvents.emit("notice", { ...n, time: new Date().toISOString() });
    return true;
  }
  const notice = { ...n, time: new Date().toISOString() };
  recent.push(notice);
  if (recent.length > 50) recent.shift();
  questEvents.emit("notice", notice);
  trace("task", "info", `Nova ${source === "mission" ? "Mission" : "Quest"}: ${n.title}: ${n.message}`);
  return true;
}

// A ping the phones never got, in time to be any use: said on the page, not lost
whenGivenUp((d, push) => {
  const at = d.session.length >= 16 ? ` (${hm(d.session)})` : "";
  notify({ kind: "undelivered", title: `Didn't reach your phone: ${push.title}`, message: `Tried ${d.attempts} time${d.attempts === 1 ? "" : "s"}${at}. Last problem: ${d.lastError}`, questId: d.questId }, false, d.session);
});

// One beat of a pulse (see pulses.ts): a quick ping, not kept in the notices list
export function pulseBeat(q: Quest, push: boolean, beat: string): void {
  notify({ kind: "pulse", title: q.title, message: `${describeLength(q)}${q.deadline ? ` · until ${q.deadline.slice(11, 16)}` : ""}`, questId: q.id }, push, beat);
}

// Sessions of a repeat that passed without a ping (Nova Agent was off, or the PC
// asleep): one late ping that says so, standing for all of them
export function remindLate(q: Quest, sessions: string[], push: boolean): void {
  if (!sessions.length) return;
  const times = sessions.map(hm);
  const list = times.length > 4 ? `${times.slice(0, 3).join(", ")} and ${times.length - 3} more` : times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0];
  notify({ kind: "missed", title: `Missed: ${q.title}`, message: `${sessions.length === 1 ? "The session" : "Sessions"} due at ${list} went by without a reminder. The next one is lined up.`, questId: q.id }, push, sessions[0], sessions.slice(1));
}

// Mission news (planned, complete): on the page and, if the rhythm says so, the phones
export function notifyMission(what: "planned" | "complete", title: string, message: string, missionId: string): void {
  const data = readQuests();
  const m = data.missions.find((x) => x.id === missionId);
  notify({ kind: "mission", title, message, questId: `mission-${missionId}` }, rhythmFor(data, m ? ownerOf(m) : pcOwnerId(), pcOwnerId()).phonePush, `${what}@${fromMin(nowMinutes())}`);
}

// A booking change moved today's or tomorrow's music time: one calm notice, said once
// (`key` is what moved, so the same move is never told twice)
export function notifyMusicMoved(lines: string[], key: string): void {
  notify({ kind: "music", title: "Music time moved", message: `${lines.join(" · ")} (a studio booking is on then). Calendar shows the new time.`, questId: "music" }, readQuests().rhythm.phonePush, key);
}

export const recentNotices = () => [...recent];

// The plan for one day, in words
export function dayPlanText(quests: Quest[], day: string): string {
  const today = quests.filter((q) => q.start.startsWith(day) && q.status !== "skipped").sort((a, b) => a.start.localeCompare(b.start));
  if (!today.length) return "Nothing planned. A free day.";
  return today.map((q) => `${hm(q.start)} ${q.status === "done" ? "✓ " : ""}${q.title}`).join(" · ");
}

function tick() {
  // Pings still on their way: try again, or give up (visibly) on stale ones
  retryDue();
  const data = readQuests();
  const pc = pcOwnerId();
  // Each quest's owner's rhythm (their reminders, check-ins and phones settings)
  const rhythmOf = (q: Quest) => rhythmFor(data, ownerOf(q), pc);
  const now = nowMinutes();
  const today = fromMin(now).slice(0, 10);
  let changed = false;
  let needsReplan = false;

  for (const q of data.quests) {
    if (!q.start || q.status === "done" || q.status === "skipped" || isPulse(q)) continue;
    const r = rhythmOf(q);
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
        notify({ kind: "leave", title: `Time to head out: ${q.title}`, message: `Leave by ${hm(q.travelStart)} to be at ${q.location || "the next place"} for ${hm(q.start)} (${q.travelMinutes} min travel).`, questId: q.id }, r.phonePush, q.start);
      } else {
        notify({ kind: "starting", title: quick ? `Now: ${q.title}` : `Up next at ${hm(q.start)}: ${q.title}`, message: `${describeLength(q)}${q.ongoing && q.sessions ? ` (session ${q.sessions + 1})` : ""}${q.location ? ` at ${q.location}` : ""}. Ready when you are.`, questId: q.id }, r.phonePush, q.start);
      }
    }
    // When it should be done (repeats just move on to their next time)
    const repeat = q.ongoing && q.every === "interval";
    if (repeat && now >= end) needsReplan = true;
    if (r.checkIns && !repeat && q.checkedFor !== q.end && now >= end) {
      q.checkedFor = q.end;
      changed = true;
      notify({ kind: "checkin", title: q.ongoing ? `Session done? “${q.title}”` : `Did you finish “${q.title}”?`, message: q.ongoing ? "Mark the session done and the next one is lined up, or give it more time." : "Mark it done, give it more time, or move it.", questId: q.id }, r.phonePush, q.end);
    }
    // Unanswered an hour later: find it a new time
    if (q.status === "todo" && !q.fixedStart && now >= end + 60) needsReplan = true;
  }

  // The morning plan and the evening wrap-up: each person's own quests, at their own times
  // (the PC's person always; anyone else once they have quests)
  const owners = new Set([pc, ...data.quests.map(ownerOf)]);
  for (const owner of owners) {
    const r = rhythmFor(data, owner, pc);
    if (!r.dailyBriefing) continue;
    const theirs = data.quests.filter((q) => ownerOf(q) === owner);
    const mark = owner === pc ? { briefing: data.lastBriefing, wrapUp: data.lastWrapUp } : (data.briefed[owner] ?? { briefing: "", wrapUp: "" });
    const wake = toMin(`${today}T${r.wake}`);
    if (mark.briefing !== today && now >= wake && now < wake + 4 * 60) {
      mark.briefing = today;
      changed = true;
      const atRisk = theirs.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length;
      notify({ kind: "briefing", title: "Good morning ✦ Today's quests", message: `${dayPlanText(theirs, today)}${atRisk ? ` · ${atRisk} quest${atRisk === 1 ? " is" : "s are"} at risk of missing a deadline` : ""}`, owner }, r.phonePush, today);
    }
    let sleep = toMin(`${today}T${r.sleep}`);
    if (r.sleep <= r.wake) sleep += 1440;
    const wrap = sleep - r.windDownMinutes - 15;
    if (mark.wrapUp !== today && now >= wrap && now < sleep) {
      mark.wrapUp = today;
      changed = true;
      const done = theirs.filter((q) => q.start.startsWith(today) && q.status === "done").length;
      const left = theirs.filter((q) => q.start.startsWith(today) && q.status === "todo").length;
      notify({ kind: "wrapup", title: "Winding down ✦ How did today go?", message: `${done} quest${done === 1 ? "" : "s"} done${left ? `, ${left} still open: tell me what happened and I'll move them` : ". Brilliant"}. Tomorrow: ${dayPlanText(theirs, fromMin(now + 1440).slice(0, 10))}`, owner }, r.phonePush, today);
    }
    if (owner === pc) {
      data.lastBriefing = mark.briefing;
      data.lastWrapUp = mark.wrapUp;
    } else if (mark.briefing || mark.wrapUp) data.briefed[owner] = mark;
  }

  if (changed) writeQuests(data);
  if (needsReplan) {
    const before = new Map(data.quests.map((q) => [q.id, q.start]));
    const result = replan();
    for (const q of result.data.quests) {
      const was = before.get(q.id);
      if (was && was !== q.start && q.status === "todo" && !q.ongoing) {
        notify({ kind: "moved", title: `Moved “${q.title}”`, message: q.start ? `It didn't get done, so it's now ${new Date(toMin(q.start) * 60000).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })} at ${hm(q.start)}.` : "It didn't get done and there's no free time for it yet. Shall we make room?", questId: q.id }, rhythmOf(q).phonePush, `${was}>${q.start}`);
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
      trace("task", "warn", `Quest reminders: ${(error as Error).message}`);
    }
  };
  setTimeout(run, 5_000);
  // Every 10 seconds, so quests of seconds (and quick repeats) ping on time
  timer = setInterval(run, 10_000);
  console.log("Quest reminders: on");
}
