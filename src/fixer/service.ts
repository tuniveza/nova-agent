// The Fixer inside Nova Agent's service: the real commands, browser, phones and quests behind
// src/fixer/fixer.ts, its schedule (hourly checks; audio levels once a day; the looks check every
// hour and after each deploy; the edges check, nothing out of sight, every 15 minutes), and carrying
// on after a restart.
//
// Where things are (each can be changed in the environment):
//   FIXER_NA_DIR       Nova Agent's main folder        ~/an/pj/ns/na  (the service runs from here)
//   FIXER_NB_DIR       Nova Bot's main folder          ~/an/pj/ns/nb/novacane-worker
//   FIXER_RELEASE_DIR  Nova Agent's clean release copy ~/an/pj/ns/na-release
//   FIXER_JOBS_DIR     one folder per job              ~/an/pj/ns/fixer-jobs
//   FIXER_CLAUDE       Claude Code                     ~/.local/bin/claude
//   FIXER_DRY=1        inert: checks may run, nothing is prepared, merged or deployed

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import cron from "node-cron";
import { config } from "../config";
import { relayLink } from "../relay";
import { readQuests } from "../quests/store";
import { trace } from "../trace";
import { Fixer, type LooksRun, SERVER_RESTART, type Paths } from "./fixer";
import type { LooksScreen } from "./looks";
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

// The looks check (src/fixer/looks.ts), as its own process with low priority (nice), so Nova Agent
// itself never waits for it. On the live site it's signed in as the looks account, which Nova Bot
// makes for this one check and deletes after (its src/looks-account.js: it can only look). The
// session's token goes to the check in its environment, never on a command line or in a log.
async function looksSession(action: "start" | "end"): Promise<{ token: string; cookie: string } | null> {
  if (!config.agentNovaKey) return null;
  try {
    const res = await fetch(`${config.workerUrl}/nova-agent/looks-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok || action === "end") return null;
    const j = (await res.json()) as { token?: string; cookie?: string };
    return j.token ? { token: j.token, cookie: j.cookie || "nova_session" } : null;
  } catch {
    return null;
  }
}
export async function runLooksCheck(o: LooksRun, run = runCommand): Promise<LooksScreen[]> {
  const live = !o.base;
  const base = o.base || config.workerUrl;
  const tmp = mkdtempSync(join(tmpdir(), "fixer-looks-"));
  const out = join(tmp, "looks.json");
  const args = ["-n", "10", "npx", "--no-install", "tsx", "scripts/fixer-looks.ts", base, "--out", out, "--shots", o.shotsDir];
  if (o.prefix) args.push("--prefix", o.prefix);
  if (o.sizes?.length) args.push("--sizes", o.sizes.map(([w, h]) => `${w}x${h}`).join(","));
  if (o.panels?.length) args.push("--panels", o.panels.join(","));
  if (o.mockPortal) args.push("--mock-portal");
  if (o.shootAll) args.push("--shoot-all");
  if (o.edges) args.push("--edges", "--resize-to", (o.resizeTo || []).map(([w, h]) => `${w}x${h}`).join(","));
  const session = live && o.auth !== "out" ? await looksSession("start") : null;
  args.push("--auth", session ? o.auth || "both" : "out");
  try {
    const r = await run("nice", args, { cwd: fixerPaths.naMain, timeoutMs: o.timeoutMs || 45 * 60_000, clean: true, env: session ? { LOOKS_COOKIE: session.token, LOOKS_COOKIE_NAME: session.cookie } : {} });
    if (!existsSync(out)) throw new Error(`The looks check stopped: ${r.out.trim().split("\n").slice(-3).join(" ").slice(0, 400)}`);
    return (JSON.parse(readFileSync(out, "utf8")) as { screens: LooksScreen[] }).screens;
  } finally {
    if (session) await looksSession("end");
    rmSync(tmp, { recursive: true, force: true });
  }
}

// After each deploy (the live pages' X-Nova-Build changes), the looks check runs again
async function liveBuild(): Promise<string> {
  try {
    const res = await fetch(`${config.workerUrl}/agent/`, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return res.headers.get("x-nova-build") || "";
  } catch {
    return "";
  }
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
      looks: (o) => runLooksCheck(o),
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
          buildProbes({ fetch, run: runCommand, naDir: fixerPaths.naMain, dataDir: config.paths.dataDir, pcBase, onServer: Boolean(config.onServer), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), botBase: config.workerUrl, agentKey: config.agentNovaKey || undefined }),
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
  // The looks check after each deploy (a few minutes after the new build shows up, when nothing
  // else is being checked)
  if (config.onServer) {
    let seen = "";
    let changedAt = 0;
    setInterval(() => {
      void (async () => {
        const build = await liveBuild();
        if (!build) return;
        if (!seen) return void (seen = build);
        if (build !== seen && !changedAt) changedAt = Date.now();
        if (!changedAt || Date.now() - changedAt < 3 * 60_000 || f.busy || !f.store.read().settings.looksChecks) return;
        seen = build;
        changedAt = 0;
        await f.check("looks");
      })().catch((err) => trace("task", "error", `Fixer looks check crashed: ${(err as Error).message}`));
    }, 60_000).unref();
  }
  // The edges check every 15 minutes (nothing out of sight; three sizes a run, every size each hour),
  // when looks checks are on. It runs beside the hourly check: it has its own guard
  cron.schedule("2,17,32,47 * * * *", () => {
    if (!f.store.read().settings.looksChecks) return;
    void f.check("edges").catch((err) => trace("task", "error", `Fixer edges check crashed: ${(err as Error).message}`));
  }, { timezone: config.timezone });
  // Carry on with anything a restart interrupted (a change being checked after going live)
  setTimeout(() => void f.resume().catch((err) => trace("task", "error", `Fixer couldn't resume: ${(err as Error).message}`)), 5000).unref();
  console.log(`Fixer: hourly checks at :07, the looks check after them and after each deploy, the edges check every 15 minutes${fixerDry ? " (inert: FIXER_DRY=1, nothing is prepared, merged or deployed)" : ""}`);
  return f;
}
