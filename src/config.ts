// All settings live here, read once from .env (and the real environment).
// The rest of the code imports `config` and never touches process.env directly.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// Paths are worked out from this file's location, so the program behaves the
// same no matter which folder you start it from.
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
// Where Nova Agent keeps its data. NOVA_DATA_DIR points a second copy (a preview,
// or screenshots with sample data) somewhere else, so it never touches the real data.
const dataDir = process.env.NOVA_DATA_DIR ? process.env.NOVA_DATA_DIR.replace(/\/?$/, "/") : fileURLToPath(new URL("../data/", import.meta.url));

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

// One of a few words; anything else falls back to the default (and says so)
function readChoice<T extends string>(name: string, choices: readonly T[], fallback: T): T {
  const value = readText(name).toLowerCase();
  if ((choices as readonly string[]).includes(value)) return value as T;
  if (value !== "") console.warn(`[config] Didn't understand ${name}="${value}", using ${fallback}.`);
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
  workerUrl: readText("NOVA_WORKER_URL", "https://nova.novacane.co.uk"),
  agentNovaKey: readText("AGENT_NOVA_KEY"),
  // Who's using this Nova Agent, for Index's memory (their own staff facts) and its
  // Nova Agent badge. Nothing to set: it's found automatically (src/staff.ts). Setting
  // NOVA_STAFF_ID to a Portal id is only an override.
  staffId: readText("NOVA_STAFF_ID").toLowerCase(),
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
  // 1: the pages stay on this computer instead of opening Nova Agent online (for when the internet is down)
  localUi: readText("NOVA_LOCAL_UI") === "1",
  // 1: this Nova Agent runs on the server (the VPS, Nova Bot's vps/agent-*.sh), not the studio PC:
  // no desktop notifications, + Shell is the server's shell, the Fixer restarts nova-agent.service
  onServer: readText("NOVA_ON_SERVER") === "1",
  // On the studio PC: this file says Nova Agent runs on the server now, so the PC's copy stays off
  // (written by Nova Bot's vps/agent-switch.sh, removed by vps/agent-switch-back.sh)
  onServerMarker: readText("NOVA_ON_SERVER_MARKER", `${homedir()}/.config/nova/agent-on-server`),

  headless: readYesNo("HEADLESS", true),
  dryRun: readYesNo("DRY_RUN", true),

  // When cancelling, tick Acuity's "Send email to client" (Acuity's own default).
  notifyClients: readYesNo("NOTIFY_CLIENTS", true),

  // Where Agent reads the studio's bookings from: "api" (Acuity's API, through Nova Bot's
  // worker: quick, and no browser opens), "feed" (Acuity's private calendar feed, through Nova
  // Bot: works on every Acuity plan, including those without the API; read-only) or "browser"
  // (Acuity's admin pages in the background browser, as before). Anything else is "api". Agent
  // can't change a booking itself: with "api" it proposes a change and an admin approves it in
  // Portal → Approvals; with "feed" and "browser" it can only look.
  acuitySource: readChoice("ACUITY_SOURCE", ["api", "feed", "browser"] as const, "api"),

  paths: {
    dataDir,
    session: `${dataDir}session.json`,
    selectors: `${dataDir}selectors.json`,
    staff: `${dataDir}staff.json`,
    health: `${dataDir}health.json`,
    screenshots: `${dataDir}screenshots/`,
  },
};
