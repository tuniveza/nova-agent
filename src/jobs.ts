// Collecting jobs from Novabot.
//
// Novabot's worker queues two kinds of job for Nova Agent:
//   - "book":   a customer asked Novabot to book a session for them
//   - "change": staff asked (in Nova Hub) to change a booking's session type,
//               price or paid status, which Acuity's API can't do
// Nova Agent keeps asking the worker "any jobs for me?" (also saying
// whether it's live or rehearsing, so Novabot only offers to book while it's
// live), does the job in Acuity's admin pages, and reports back; the worker
// then sends staff phones a notification with the result.
//
// Nova Agent only ever calls out to the worker, so it can run on any
// computer: nothing on the internet needs to reach it.

import { applyQuestTaps } from "./quests/hubsync";
import { z } from "zod";
import type { ActionResult } from "./acuity/types";
import { config } from "./config";
import { bookTask, extrasTask } from "./tasks";
import { trace } from "./trace";

// What a job from the worker must look like. Anything else is refused.
const ChangeJob = z.object({
  id: z.number().int(),
  kind: z.literal("change"),
  appointmentId: z.number().int().positive(),
  clientName: z.string().min(1).max(200),
  changes: z
    .object({
      type: z.string().max(150).optional(),
      price: z.string().regex(/^\d{1,5}(\.\d{1,2})?$/).optional(),
      paid: z.boolean().optional(),
    })
    .strict(),
});

const BookJob = z.object({
  id: z.number().int(),
  kind: z.literal("book"),
  clientName: z.string().min(1).max(200),
  details: z.object({
    type: z.string().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    email: z.string().email().max(200),
    phone: z.string().max(40).optional(),
  }),
});

const Job = z.discriminatedUnion("kind", [ChangeJob, BookJob]);

// How long the worker may hold each "any jobs?" call open (its limit is 20)
const WAIT_SECONDS = 20;

let busy = false;
let lastProblem = "";

export function startCollectingJobs(): void {
  if (!config.agentNovaKey) {
    console.log("Not collecting jobs from Novabot: set AGENT_NOVA_KEY in .env (the same as the worker's secret).");
    return;
  }
  console.log(`Collecting jobs from ${config.workerUrl} (waiting up to ${WAIT_SECONDS}s per call for a job)`);
  void collectForever();
}

// Ask for a job, do it, ask again. The worker holds each "any jobs?" call open
// until a job comes in (up to WAIT_SECONDS), so a booking starts within about
// a second of being queued. If the worker answers straight away with nothing
// (an older worker that doesn't wait, or a problem), pause JOBS_EVERY_SECONDS
// before asking again so it isn't asked non-stop.
async function collectForever(): Promise<never> {
  for (;;) {
    const started = Date.now();
    const outcome = await checkForJob();
    const answeredAtOnce = Date.now() - started < 2_000;
    if (outcome === "problem" || (outcome === "none" && answeredAtOnce)) await sleep(config.jobsEverySeconds * 1000);
  }
}

async function checkForJob(): Promise<"job" | "none" | "problem"> {
  if (busy) return "none";
  busy = true;
  try {
    const { job, questActions } = (await callWorker(
      "/hub/agent/next",
      { dryRun: config.dryRun, bookingsPerVisitor: config.bookingsPerVisitorPerDay, wait: WAIT_SECONDS },
      (WAIT_SECONDS + 15) * 1000,
    )) as { job: unknown; questActions?: unknown };
    lastProblem = "";
    // Taps from Nova Hub's Quests tab come along with the job check
    applyQuestTaps(questActions);
    if (!job) return "none";
    await doJob(job);
    return "job";
  } catch (error) {
    // Say so once, not every time
    const problem = (error as Error).message;
    if (problem !== lastProblem) trace("input", "warn", `Couldn't check Novabot for jobs: ${problem}`);
    lastProblem = problem;
    return "problem";
  } finally {
    busy = false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function doJob(raw: unknown): Promise<void> {
  const parsed = Job.safeParse(raw);
  if (!parsed.success) {
    const id = (raw as { id?: unknown })?.id;
    trace("input", "error", "Novabot sent a job Nova Agent doesn't understand; refused", raw);
    if (typeof id === "number") await report(id, { ok: false, dryRun: false, message: "Nova Agent didn't understand this job, so nothing was changed." });
    return;
  }

  const job = parsed.data;
  let result: ActionResult;
  try {
    if (job.kind === "book") {
      trace("input", "start", `Job #${job.id} from Novabot: book ${job.details.type} for ${job.clientName} on ${job.details.date} at ${job.details.time}`, job.details);
      result = await bookTask(job.details);
    } else {
      trace("input", "start", `Job #${job.id} from Nova Hub: change ${job.clientName}'s booking #${job.appointmentId}`, job.changes);
      result = await extrasTask(String(job.appointmentId), job.clientName, job.changes);
    }
  } catch (error) {
    result = { ok: false, dryRun: false, message: `${(error as Error).message} Nothing was changed.` };
  }
  await report(job.id, result);
}

// Tell the worker how it went. A dry run counts as "not done", so staff
// aren't told something changed when it didn't.
async function report(id: number, result: ActionResult): Promise<void> {
  const message = result.dryRun ? `Rehearsal only (Nova Agent's DRY_RUN is on), so nothing was changed. ${result.message}` : result.message;
  try {
    await callWorker("/hub/agent/result", { id, ok: result.ok && !result.dryRun, message });
    trace("input", result.ok && !result.dryRun ? "ok" : "warn", `Reported job #${id} back to Novabot: ${message}`);
  } catch (error) {
    trace("input", "error", `Couldn't report job #${id} back to Novabot: ${(error as Error).message}`);
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
