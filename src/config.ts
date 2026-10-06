// All settings live here, read once from .env (and the real environment).
// The rest of the code imports `config` and never touches process.env directly.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Paths are worked out from this file's location, so the program behaves the
// same no matter which folder you start it from.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));

// Node can read .env files by itself (no extra package needed).
// Variables already set in the shell win over the file, which is what lets
// `npm run login` force HEADLESS=false.
const envFile = `${projectRoot}.env`;
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function readText(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

// Anything we don't clearly recognise falls back to the default. This matters
// for DRY_RUN: a typo like "DRY_RUN=flase" must keep us in the safe mode.
function readYesNo(name: string, fallback: boolean): boolean {
  const value = readText(name).toLowerCase();
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  if (value !== "") {
    console.warn(`[config] Didn't understand ${name}="${value}", using ${fallback}.`);
  }
  return fallback;
}

export const config = {
  // Acuity login (used for automatic re-login in a later phase)
  acuityEmail: readText("ACUITY_EMAIL"),
  acuityPassword: readText("ACUITY_PASSWORD"),

  // The admin page we open to check we're logged in.
  acuityAdminUrl: readText(
    "ACUITY_ADMIN_URL",
    "https://secure.acuityscheduling.com/appointments.php",
  ),

  // The business's timezone. All times on Acuity's admin pages are in it,
  // and "today" is worked out in it.
  timezone: readText("ACUITY_TIMEZONE", "Europe/London"),

  // LLM (used from Phase 2)
  anthropicApiKey: readText("ANTHROPIC_API_KEY"),
  novaModel: readText("NOVA_MODEL"),

  // Novabot's Cloudflare Worker. Nova Agent collects jobs from it (what
  // Acuity's API can't do) and sends alerts to staff phones through it.
  // AGENT_NOVA_KEY must match the worker's AGENT_NOVA_KEY secret.
  workerUrl: readText("NOVA_WORKER_URL", "https://novacane-worker.novacane-studio.workers.dev"),
  agentNovaKey: readText("AGENT_NOVA_KEY"),
  // Who's using this Nova Agent, for Nova Index's memory (their own staff facts).
  // One id per person (e.g. "tuniveza"), so each person's rhythm and habits stay apart.
  staffId: readText("NOVA_STAFF_ID", "owner").toLowerCase(),
  // How long to wait before asking again when the worker answers straight
  // away (an older worker, or a problem). A worker that holds the call open
  // until a job comes in is asked again immediately.
  jobsEverySeconds: Number(readText("JOBS_EVERY_SECONDS", "10")),

  // The longest pause before each click or typed box, in milliseconds (each
  // pause is between a third of this and all of it). 0 = go flat out.
  actionPauseMs: Number(readText("ACTION_PAUSE_MS", "150")),

  // How many sessions Novabot may book for one website visitor a day:
  // a number, or "unlimited". Sent to the worker each time Nova Agent checks in.
  bookingsPerVisitorPerDay: readText("BOOKINGS_PER_VISITOR_PER_DAY", "2"),

  // When the daily read-only healthcheck runs (cron format, business timezone).
  healthcheckSchedule: readText("HEALTHCHECK_CRON", "0 6 * * *"),

  // The local visualizer page (npm run visualizer)
  visualizerPort: Number(readText("VISUALIZER_PORT", "4545")),

  headless: readYesNo("HEADLESS", true),
  dryRun: readYesNo("DRY_RUN", true),

  // When cancelling, tick Acuity's "Send email to client" (Acuity's own default).
  notifyClients: readYesNo("NOTIFY_CLIENTS", true),

  paths: {
    dataDir,
    session: `${dataDir}session.json`,
    selectors: `${dataDir}selectors.json`,
    health: `${dataDir}health.json`,
    screenshots: `${dataDir}screenshots/`,
  },
};
