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
// Variables already set in the shell win over the file.
const envFile = `${projectRoot}.env`;
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function readText(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  // The studio's timezone: "today", timed jobs and the times Nova Agent shows are worked out in it
  timezone: readText("STUDIO_TIMEZONE", "Europe/London"),

  // The AI
  anthropicApiKey: readText("ANTHROPIC_API_KEY"),
  novaModel: readText("NOVA_MODEL"),

  // Nova Bot's worker. Nova Agent checks in with it (quest taps from Portal, booking changes),
  // reads the studio's bookings and sends alerts to staff phones through it.
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

  // How many sessions Novabot may book for one website visitor a day:
  // a number, or "unlimited". Sent to the worker each time Nova Agent checks in.
  bookingsPerVisitorPerDay: readText("BOOKINGS_PER_VISITOR_PER_DAY", "2"),

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

  paths: {
    dataDir,
    staff: `${dataDir}staff.json`,
    screenshots: `${dataDir}screenshots/`,
  },
};
