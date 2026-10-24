// Checking in with Nova Bot.
//
// Nova Agent keeps asking Nova Bot's worker "anything for me?" (POST /nova-agent/next). Each
// answer can carry:
//   - questActions: taps in Portal's Quests tab, applied here (quests/portalsync.ts)
//   - bookingsChanged: when the studio's bookings last changed. Each "any jobs?" also says when
//     Nova Agent last caught up (bookingsSeen); when the answer is newer, the bookings are read
//     again and Quests re-planned (quests/bookings.ts), so a new booking shows in Nova Agent
//     within about a minute.
//   - job: Nova Agent no longer books or changes bookings itself (the studio's bookings are Nova
//     Bot's own now, made on its /book page and kept on the studio's Google Calendar). A job that
//     still arrives is reported back as not done, so staff hear about it and nothing changes.
//
// Nova Agent only ever calls out to the worker, so it can run on any
// computer: nothing on the internet needs to reach it.

import { applyQuestTaps } from "./quests/portalsync";
import { bookingsChanged, bookingsSeen } from "./quests/bookings";
import { config } from "./config";
import { trace } from "./trace";

// How long the worker may hold each "any jobs?" call open (its limit is 20)
const WAIT_SECONDS = 20;

let busy = false;
let lastProblem = "";

export function startCollectingJobs(): void {
  if (!config.agentNovaKey) {
    console.log("Not checking in with Nova Bot: set AGENT_NOVA_KEY in .env (the same as the worker's secret).");
    return;
  }
  console.log(`Checking in with ${config.workerUrl} (waiting up to ${WAIT_SECONDS}s per call)`);
  void collectForever();
}

// Ask, act, ask again. The worker holds each call open until there's news (up to
// WAIT_SECONDS). If it answers straight away with nothing, pause before asking again so it
// isn't asked non-stop.
async function collectForever(): Promise<never> {
  for (;;) {
    const started = Date.now();
    const outcome = await checkForJob();
    const answeredAtOnce = Date.now() - started < 2_000;
    if (outcome === "problem" || (outcome === "none" && answeredAtOnce)) await sleep(config.jobsEverySeconds * 1000);
  }
}

export async function checkForJob(): Promise<"job" | "none" | "problem"> {
  if (busy) return "none";
  busy = true;
  try {
    const { job, questActions, bookingsChanged: changed } = (await callWorker(
      "/nova-agent/next",
      // dryRun: true tells Nova Bot not to hand Nova Agent any booking to make (it can't any more)
      { dryRun: true, bookingsPerVisitor: config.bookingsPerVisitorPerDay, wait: WAIT_SECONDS, bookingsSeen: bookingsSeen() },
      (WAIT_SECONDS + 15) * 1000,
    )) as { job: unknown; questActions?: unknown; bookingsChanged?: unknown };
    lastProblem = "";
    // Taps from Portal's Quests tab come along with the check-in
    applyQuestTaps(questActions);
    // The studio's bookings changed: read them again and re-plan (in the background)
    void bookingsChanged(changed);
    if (!job) return "none";
    await turnDown(job);
    return "job";
  } catch (error) {
    // Say so once, not every time
    const problem = (error as Error).message;
    if (problem !== lastProblem) trace("input", "warn", `Couldn't check in with Nova Bot: ${problem}`);
    lastProblem = problem;
    return "problem";
  } finally {
    busy = false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A booking job (from before the studio's own booking system): say it wasn't done
async function turnDown(raw: unknown): Promise<void> {
  const id = (raw as { id?: unknown })?.id;
  trace("input", "warn", "Nova Bot sent a booking job; Nova Agent doesn't make or change bookings any more, so nothing was changed", raw);
  if (typeof id !== "number") return;
  const message = "Nothing was changed: Nova Agent doesn't make or change bookings any more. Make or change it in Portal → Calendar or the studio's Google Calendar.";
  try {
    await callWorker("/nova-agent/result", { id, ok: false, message });
  } catch (error) {
    trace("input", "error", `Couldn't report job #${id} back to Nova Bot: ${(error as Error).message}`);
  }
}

async function callWorker(path: string, body: unknown = {}, timeoutMs = 15_000): Promise<unknown> {
  const response = await fetch(config.workerUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`the worker answered ${response.status}`);
  return response.json();
}
