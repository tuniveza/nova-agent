// The Fixer inside Nova Agent's service: the real commands, browser, phones and quests behind
// src/fixer/fixer.ts, its schedule (hourly checks; audio levels once a day), and carrying on after
// a restart.
//
// Where things are (each can be changed in the environment):
//   FIXER_NA_DIR       Nova Agent's main folder        ~/an/pj/ns/na  (the service runs from here)
//   FIXER_NB_DIR       Nova Bot's main folder          ~/an/pj/ns/nb/novacane-worker
//   FIXER_RELEASE_DIR  Nova Agent's clean release copy ~/an/pj/ns/na-release
//   FIXER_JOBS_DIR     one folder per job              ~/an/pj/ns/fixer-jobs
//   FIXER_CLAUDE       Claude Code                     ~/.local/bin/claude
//   FIXER_DRY=1        inert: checks may run, nothing is prepared, merged or deployed

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import cron from "node-cron";
import { config } from "../config";
import { relayLink } from "../relay";
import { readQuests } from "../quests/store";
import { trace } from "../trace";
import { Fixer, SERVER_RESTART, type Paths } from "./fixer";
import { healthFindings } from "./health";
import { buildProbes, runProbes } from "./probes";
import { cleanEnv, runCommand } from "./runner";
import { FixerStore } from "./store";
import { sweep } from "./sweep";

const home = homedir();
export const fixerDry = process.env.FIXER_DRY === "1";
export const fixerPaths: Paths = {
  naMain: process.env.FIXER_NA_DIR || join(home, "an/pj/ns/na"),
  nbMain: process.env.FIXER_NB_DIR || join(home, "an/pj/ns/nb/novacane-worker"),
  release: process.env.FIXER_RELEASE_DIR || join(home, "an/pj/ns/na-release"),
  jobsDir: process.env.FIXER_JOBS_DIR || join(home, "an/pj/ns/fixer-jobs"),
  shotsDir: `${config.paths.dataDir}fixer-shots/`,
  claudeBin: process.env.FIXER_CLAUDE || join(home, ".local/bin/claude"),
};

// On the server, Claude Code is signed in once by an admin over ssh (vps/README.md in Nova Bot):
// until then, a fix can't be prepared and the Fixer says so plainly
export function claudeProblem(onServer = config.onServer, bin = fixerPaths.claudeBin, home_ = home): string {
  if (!onServer) return "";
  if (!existsSync(bin)) return "Claude Code isn't installed on the server yet (vps/agent-setup.sh in Nova Bot installs it).";
  if (!existsSync(join(home_, ".claude", ".credentials.json"))) return "Claude Code isn't signed in on the server. An admin signs it in once: ssh root@185.185.126.195, then sudo -iu nova-agent claude, then /login.";
  return "";
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

// A job's copy of Nova Agent, running for its screenshots and sweep: inert (FIXER_DRY), no key,
// a pretend Nova Bot, its own empty data, pages kept local. Stopped by its own process id.
async function startServer(dir: string) {
  const port = await freePort();
  const data = mkdtempSync(join(tmpdir(), "fixer-job-data-"));
  const child = spawn("npx", ["tsx", "src/visualizer/server.ts"], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
    env: { ...cleanEnv(), FIXER_DRY: "1", NOVA_DATA_DIR: data + "/", VISUALIZER_PORT: String(port), NOVA_LOCAL_UI: "1", AGENT_NOVA_KEY: "", NOVA_WORKER_URL: "https://worker.test", DRY_RUN: "true" },
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {}
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    rmSync(data, { recursive: true, force: true });
  };
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/app-version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { base, stop };
    } catch {}
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error("The job's copy of Nova Agent didn't start.");
}

// A calm ping to the admins' phones (Nova Bot sends "fixer" pings to admins only)
async function notify(title: string, message: string, tag: string) {
  trace("task", "info", `Fixer: ${title}: ${message}`);
  if (!config.agentNovaKey) return;
  try {
    await fetch(`${config.workerUrl}/nova-agent/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify({ title, message, source: "fixer", kind: "fixer", tag, ttl: 12 * 3600, urgent: false }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {}
}

let fixer: Fixer | null = null;
export const currentFixer = () => fixer;

export function startFixer(): Fixer {
  const pcBase = `http://127.0.0.1:${config.visualizerPort}`;
  fixer = new Fixer(
    new FixerStore(`${config.paths.dataDir}fixer.json`),
    fixerPaths,
    {
      run: runCommand,
      sweep,
      health: (restartsSeen) =>
        healthFindings({
          pcBase,
          workerUrl: config.workerUrl,
          dataDir: config.paths.dataDir,
          linkUp: () => (config.agentNovaKey ? relayLink.up : null),
          run: runCommand,
          restartsSeen,
          underSystemd: Boolean(process.env.INVOCATION_ID),
          onServer: config.onServer,
        }),
      probes: () =>
        runProbes(
          buildProbes({ fetch, run: runCommand, naDir: fixerPaths.naMain, dataDir: config.paths.dataDir, pcBase, onServer: Boolean(config.onServer), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }),
          { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
        ),
      notify,
      quests: () => readQuests().quests,
      startServer,
      now: () => new Date(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      log: (line) => trace("task", "info", line),
    },
    { dry: fixerDry, pcBase, restart: config.onServer ? SERVER_RESTART : undefined, claudeProblem },
  );
  const f = fixer;
  // Every hour at :07 (when hourly checks are on); the audio levels with the first check each day
  cron.schedule("7 * * * *", () => void f.hourly().catch((err) => trace("task", "error", `Fixer check crashed: ${(err as Error).message}`)), { timezone: config.timezone });
  // Carry on with anything a restart interrupted (a change being checked after going live)
  setTimeout(() => void f.resume().catch((err) => trace("task", "error", `Fixer couldn't resume: ${(err as Error).message}`)), 5000).unref();
  console.log(`Fixer: hourly checks at :07${fixerDry ? " (inert: FIXER_DRY=1, nothing is prepared, merged or deployed)" : ""}`);
  return f;
}
