// Nova Hub's Quests tab: Nova Agent sends its plan (missions, quests, pulses)
// to Nova Bot's worker whenever it changes (and every minute, so "now" moves
// on), and carries out the taps made in Nova Hub (Done, Start, Not now...).
// Taps also arrive with each job check (jobs.ts), so they land within a second.

import { config } from "../config";
import { trace } from "../trace";
import { applyQuestTap, questState, type QuestTap } from "./actions";
import { questEvents } from "./store";

let soon: NodeJS.Timeout | undefined;
let lastProblem = "";

// What the phone needs (recent and open quests only, to keep it small)
function snapshot() {
  const st = questState();
  const cutoff = st.now.slice(0, 10);
  const quests = st.quests.filter((q) => q.status === "todo" || q.status === "doing" || (q.start && q.start.slice(0, 10) >= cutoff));
  const slim = (q: (typeof st.quests)[number]) => {
    const { notes, remindedFor, checkedFor, created, updated, completed, ...rest } = q;
    return rest;
  };
  return {
    now: st.now,
    rhythm: { wake: st.rhythm.wake, sleep: st.rhythm.sleep, paceLimits: st.rhythm.paceLimits },
    missions: st.missions.map(({ request, ...m }) => m),
    quests: quests.map(slim),
    current: st.current && slim(st.current),
    next: st.next.map(slim),
    pulses: st.pulses.map(slim),
  };
}

export function applyQuestTaps(taps: unknown): void {
  if (!Array.isArray(taps)) return;
  for (const t of taps as QuestTap[]) {
    try {
      const title = applyQuestTap(t);
      trace("input", "ok", `Nova Hub: ${t.action} “${title}”`);
    } catch (error) {
      trace("input", "warn", `Nova Hub tap couldn't be done: ${(error as Error).message}`);
    }
  }
}

async function send(): Promise<void> {
  if (!config.agentNovaKey) return;
  try {
    const response = await fetch(`${config.workerUrl}/hub/agent/quests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify({ state: snapshot() }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`the worker answered ${response.status}`);
    const { actions } = (await response.json()) as { actions?: unknown };
    applyQuestTaps(actions);
    lastProblem = "";
  } catch (error) {
    const problem = (error as Error).message;
    if (problem !== lastProblem) trace("task", "warn", `Couldn't send the plan to Nova Hub: ${problem}`);
    lastProblem = problem;
  }
}

export function startHubSync(): void {
  const later = () => {
    clearTimeout(soon);
    soon = setTimeout(send, 1500);
  };
  questEvents.on("changed", later);
  setTimeout(send, 3000);
  setInterval(send, 60_000);
}
