// The Fixer, from the ground up (16 October 2026): only the three strict rules (src/fixer/strict.ts),
// checked on all of Nova Agent every 5 minutes on the server (and when an admin taps Check now).
// Nothing else: no hourly checks, no quests, no prepared fixes, no approvals. What the Fixer had
// before was put aside, not deleted: data/fixer.json became data/fixer-before-2026-10-16.json.
//
//   GET  /fixer-api/state                  the rules, the last run's problems, the last day's runs
//   GET  /fixer-api/shots/:run/:file.png   a picture of a screen with its problems marked
//   POST /actions/fixer/check              check now
//
// Admins only (src/fixer/routes.ts actorFor: the studio PC's own page, or an admin online).

import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import cron from "node-cron";
import { config } from "../config";
import { trace } from "../trace";
import { actorFor } from "./routes";
import { type Run, runCommand } from "./runner";
import { STRICT_RULES, STRICT_SIZES, freshShotsDir, strictCounts, strictProblems, type StrictRule, type StrictRun } from "./strict";

export const STRICT_EVERY_MIN = 5;
const HISTORY = (24 * 60) / STRICT_EVERY_MIN; // (a day of runs)
const RUN_LIMIT_MS = 4.5 * 60_000;

export type StrictSummary = { at: string; counts: Record<StrictRule, number>; screens: number; ms: number; error?: string };
export type StrictStore = { last: (StrictRun & { id: string }) | null; history: StrictSummary[]; error?: string };

const runId = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

export class StrictFixer {
  running = false;
  startedAt = "";
  constructor(
    private file: string,
    private shotsRoot: string,
    private deps: { run: Run; base: () => string; session: (a: "start" | "end") => Promise<{ token: string; cookie: string } | null>; now: () => Date; cwd: string; log: (line: string) => void },
  ) {}

  read(): StrictStore {
    try {
      const j = JSON.parse(readFileSync(this.file, "utf8"));
      return { last: j.last || null, history: Array.isArray(j.history) ? j.history : [], ...(j.error ? { error: j.error } : {}) };
    } catch {
      return { last: null, history: [] };
    }
  }
  private write(s: StrictStore) {
    writeFileSync(this.file + ".tmp", JSON.stringify(s));
    renameSync(this.file + ".tmp", this.file);
  }

  // One run: the check as its own low-priority process (nice), signed in as the looks account (Nova
  // Bot makes it for this and it can only look); a run still going means the next one's skipped
  async check(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    const started = this.deps.now();
    this.startedAt = started.toISOString();
    const tmp = mkdtempSync(join(tmpdir(), "fixer-strict-"));
    const out = join(tmp, "run.json");
    const id = runId(started);
    let session: { token: string; cookie: string } | null = null;
    try {
      const shots = freshShotsDir(this.shotsRoot, id);
      session = await this.deps.session("start").catch(() => null);
      const r = await this.deps.run("nice", ["-n", "10", "npx", "--no-install", "tsx", "scripts/fixer-strict.ts", this.deps.base(), "--out", out, "--shots", shots], {
        cwd: this.deps.cwd,
        timeoutMs: RUN_LIMIT_MS,
        clean: true,
        env: session ? { LOOKS_COOKIE: session.token, LOOKS_COOKIE_NAME: session.cookie } : {},
      });
      if (!existsSync(out)) throw new Error(`The check stopped: ${r.out.trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
      const run = JSON.parse(readFileSync(out, "utf8")) as StrictRun;
      const s = this.read();
      const summary: StrictSummary = { at: run.finishedAt, counts: strictCounts(run), screens: run.screens.length, ms: Date.parse(run.finishedAt) - Date.parse(run.startedAt) };
      this.write({ last: { ...run, id }, history: [...s.history, summary].slice(-HISTORY) });
      const c = summary.counts;
      this.deps.log(`Fixer: ${run.screens.length} screens checked: ${c.offscreen} off the screen, ${c.onescreen} not one screen, ${c.oneline} onto the next line`);
      return true;
    } catch (err) {
      const message = (err as Error).message;
      const s = this.read();
      this.write({ ...s, history: [...s.history, { at: this.deps.now().toISOString(), counts: { offscreen: 0, onescreen: 0, oneline: 0 }, screens: 0, ms: 0, error: message }].slice(-HISTORY), error: message });
      this.deps.log(`Fixer: the check couldn't run: ${message}`);
      return false;
    } finally {
      if (session) await this.deps.session("end").catch(() => null);
      rmSync(tmp, { recursive: true, force: true });
      this.running = false;
      this.startedAt = "";
    }
  }

  state() {
    const s = this.read();
    const problems = strictProblems(s.last);
    const counts = strictCounts(s.last);
    const lastAt = s.last?.finishedAt || null;
    return {
      rules: STRICT_RULES.map((r) => ({ ...r, problems: counts[r.id] })),
      every: STRICT_EVERY_MIN,
      sizes: STRICT_SIZES.map((z) => ({ size: `${z.w}×${z.h}`, kind: z.kind })),
      running: this.running,
      runningSince: this.startedAt || null,
      last: s.last ? { id: s.last.id, at: lastAt, base: s.last.base, signedIn: s.last.signedIn, screens: s.last.screens.length, places: [...new Set(s.last.screens.map((x) => x.place))], errors: s.last.screens.filter((x) => x.error).map((x) => ({ place: x.place, size: `${x.width}×${x.height}`, error: x.error })) } : null,
      problems,
      // How many parts the screens fixed on their own as they drew (web/shared/rules.js), in the last check
      // (Missions and the Manual are Nova Agent's own page again: counted once, with Agent)
      fixed: (s.last?.screens || []).filter((x) => x.place !== "Missions" && x.place !== "Manual").reduce((n, x) => n + (x.fixed || 0), 0),
      history: s.history.slice(-48),
      error: s.error && (!s.history.length || s.history[s.history.length - 1].error) ? s.error : null,
    };
  }

  shotFile(id: string, file: string): string | null {
    if (!/^\d{8}-\d{6}$/.test(id) || !/^[\w-]+\.png$/.test(file)) return null;
    const p = join(this.shotsRoot, id, file);
    return existsSync(p) ? p : null;
  }
}

// The old Fixer's data, put aside once (kept, never deleted)
export function retireOldFixer(dataDir: string, now = new Date()): string | null {
  const old = join(dataDir, "fixer.json");
  if (!existsSync(old)) return null;
  const to = join(dataDir, `fixer-before-${now.toISOString().slice(0, 10)}.json`);
  renameSync(old, existsSync(to) ? `${to}.${Date.now()}` : to);
  return to;
}

// The looks account's session (Nova Bot's src/looks-account.js: it can only look), for one run
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

let strict: StrictFixer | null = null;
export const currentStrictFixer = () => strict;

export function startStrictFixer(): StrictFixer {
  const dataDir = config.paths.dataDir;
  const put = retireOldFixer(dataDir);
  if (put) trace("task", "info", `Fixer: started again from the ground up; what it had before is kept in ${put}`);
  const pcBase = `http://127.0.0.1:${config.visualizerPort}`;
  strict = new StrictFixer(join(dataDir, "fixer-strict.json"), join(dataDir, "fixer-shots", "strict"), {
    run: runCommand,
    // On the server: the live site, as everyone sees it; on a PC: its own copy
    base: () => (config.onServer ? config.workerUrl : pcBase),
    session: (a) => (config.onServer ? looksSession(a) : Promise.resolve(null)),
    now: () => new Date(),
    cwd: process.cwd(),
    log: (line) => trace("task", "info", line),
  });
  const f = strict;
  if (config.onServer) cron.schedule(`*/${STRICT_EVERY_MIN} * * * *`, () => void f.check().catch((err) => trace("task", "error", `Fixer crashed: ${(err as Error).message}`)), { timezone: config.timezone });
  console.log(`Fixer: the three strict rules${config.onServer ? `, checked every ${STRICT_EVERY_MIN} minutes` : " (Check now on its page)"}`);
  return f;
}

export function registerStrictRoutes(app: Hono, fixer: () => StrictFixer | null): void {
  const guard = (c: any): StrictFixer | Response => {
    if (!actorFor(c.req.raw)) return c.json({ ok: false, message: "The Fixer is for admins." }, 403);
    return fixer() || c.json({ ok: false, message: "The Fixer isn't running." }, 503);
  };
  app.get("/fixer-api/state", (c) => {
    const f = guard(c);
    return f instanceof Response ? f : c.json(f.state(), 200, { "Cache-Control": "no-store" });
  });
  app.get("/fixer-api/shots/:id/:file", (c) => {
    const f = guard(c);
    if (f instanceof Response) return f;
    const file = f.shotFile(c.req.param("id"), c.req.param("file"));
    if (!file) return c.text("Not found", 404);
    return c.body(readFileSync(file) as any, 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
  });
  app.post("/actions/fixer/check", (c) => {
    const f = guard(c);
    if (f instanceof Response) return f;
    if (f.running) return c.json({ ok: true, result: { started: false, running: true } });
    void f.check().catch(() => {});
    return c.json({ ok: true, result: { started: true } }, 200, { "Cache-Control": "no-store" });
  });
}
