// The Fixer: Nova Agent's caretaker.
//
//   Checks      every hour (scripted, no AI): both projects' tests and Nova Agent's typecheck, a
//               sweep of every panel at phone and desktop width, and health (the PC's server, the
//               online link, Nova Bot, restarts, disk space, data files); once a day, the audio
//               levels. Problems become issues (one per fingerprint), cleared when they're gone.
//   Preparing   for an issue or a fixer quest (by itself for new issues, if that's switched on):
//               one job at a time, a daily cap and a time limit. Each job gets its own git
//               worktrees and branch; Claude Code makes the change there (src/fixer/claude.ts),
//               the Fixer commits it on that branch, runs the tests, typecheck and sweep there,
//               and takes before/after screenshots. The result is an approval card.
//   Approving   NOTHING goes live without an admin tapping Approve. Only approve() can mint the
//               approval that land() needs; land() merges into main, deploys, restarts Nova Agent
//               if its server changed, and checks again. If things got worse, it undoes the change
//               by itself (the one thing it does without a tap) and says so.
//
// With FIXER_DRY=1 it's inert: checks may run, but nothing is prepared, merged or deployed.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { briefText, claudeArgs, readAnswer } from "./claude";
import { commandFindings } from "./health";
import { affectedScreens, type Finding, isBlip, isTrivial, mergeIssues, offLimits, recommend, SCREENS, sensitiveLines, shouldRollBack, suggestions, type Suggestion } from "./rules";
import type { Run } from "./runner";
import type { Sweep } from "./sweep";
import { addActivity, type Card, type Check, cleanQuest, cleanSettings, type FileChange, type FixerData, type FixerQuest, FixerStore, type Issue, type Job, type QuestKind, type Settings } from "./store";

export interface Paths {
  naMain: string; // ~/an/pj/ns/na: Nova Agent's main (the service runs from here)
  nbMain: string; // ~/an/pj/ns/nb/novacane-worker: Nova Bot's main (deploys from here)
  release: string; // ~/an/pj/ns/na-release: Nova Agent's main, clean, for Nova Bot's build
  jobsDir: string; // ~/an/pj/ns/fixer-jobs: one folder per job
  shotsDir: string; // data/fixer-shots: before/after pictures
  claudeBin: string; // ~/.local/bin/claude
}

export interface QuestLike {
  id: string;
  title: string;
  notes: string;
  from: string;
  status: string;
  priority: string;
}

export interface Deps {
  run: Run;
  sweep: Sweep;
  health: (restartsSeen: number) => Promise<{ findings: Finding[]; restarts: number }>;
  notify: (title: string, message: string, tag: string) => Promise<void>;
  quests: () => QuestLike[];
  startServer: (dir: string) => Promise<{ base: string; stop: () => Promise<void> }>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface Actor {
  name: string;
  admin: boolean;
  via: "pc" | "online";
}

// ---- Approvals: only approve() makes one, and land() won't move without it ----
export interface Approval {
  readonly jobId: string;
  readonly by: string;
  readonly via: string;
  readonly at: string;
}
const minted = new WeakSet<object>();
function mintApproval(jobId: string, actor: Actor, at: Date): Approval {
  const a: Approval = Object.freeze({ jobId, by: actor.name, via: actor.via, at: at.toISOString() });
  minted.add(a);
  return a;
}
export function isApproval(a: unknown, jobId: string): a is Approval {
  return !!a && typeof a === "object" && minted.has(a) && (a as Approval).jobId === jobId;
}

const ukDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const COAUTHOR = "Co-Authored-By: Claude <noreply@anthropic.com>";
const LIVE: Job["status"][] = ["approved", "landing", "restarting", "verifying", "rolling-back"];
// Fixes that are closed when their problem goes away (not ones being prepared or going live)
const CLOSABLE: Job["status"][] = ["queued", "ready", "failed", "blocked"];
// Nova Bot blips: checked again this many times, this far apart (about two minutes in all)
const BLIP_TRIES = 3;
const BLIP_WAIT_MS = 40_000;

export class Fixer {
  private running: string | null = null; // the job being prepared
  private checking = false;
  private landing: Promise<unknown> = Promise.resolve();

  constructor(
    readonly store: FixerStore,
    readonly paths: Paths,
    readonly deps: Deps,
    readonly opts: { dry: boolean; pcBase: string },
  ) {}

  private now() {
    return this.deps.now();
  }
  private note(data: FixerData, kind: Parameters<typeof addActivity>[2], line: string) {
    addActivity(data, this.now(), kind, line);
    this.deps.log(`Fixer: ${line}`);
  }
  private git(cwd: string, args: string[], timeoutMs = 120_000) {
    return this.deps.run("git", ["-C", cwd, ...args], { cwd, timeoutMs });
  }
  private saveJob(job: Job, change: Partial<Job> = {}) {
    Object.assign(job, change, { updated: this.now().toISOString() });
    this.store.update((d) => {
      const i = d.jobs.findIndex((j) => j.id === job.id);
      if (i >= 0) d.jobs[i] = job;
      else d.jobs.push(job);
    });
  }
  private job(id: string): Job {
    const job = this.store.read().jobs.find((j) => j.id === id);
    if (!job) throw new Error("There's no such fix.");
    return job;
  }
  private today(data: FixerData) {
    const date = ukDate(this.now());
    if (data.day.date !== date) data.day = { date, prepared: 0 };
    return data.day;
  }

  // ================= What the page shows =================
  state() {
    const data = this.store.read();
    const day = this.today(data);
    const view = (j: Job) => ({ ...j, card: j.card ? { ...j.card, diff: "" } : null });
    const byNew = (a: Job, b: Job) => b.updated.localeCompare(a.updated);
    return {
      dry: this.opts.dry,
      settings: data.settings,
      running: this.running,
      checking: this.checking,
      lastCheck: data.lastCheck,
      today: { prepared: day.prepared, cap: data.settings.dailyCap },
      issues: [...data.issues].sort((a, b) => (a.severity === b.severity ? b.lastSeen.localeCompare(a.lastSeen) : a.severity === "serious" ? -1 : 1)),
      quests: [...data.quests].sort((a, b) => b.updated.localeCompare(a.updated)),
      suggestions: this.suggestions(data),
      needsYou: data.jobs.filter((j) => j.status === "ready").sort(byNew).map(view),
      working: data.jobs.filter((j) => ["queued", "preparing", "checking", "blocked", ...LIVE].includes(j.status)).sort(byNew).map(view),
      done: data.jobs.filter((j) => ["done", "rolled-back", "undone", "rejected", "failed", "closed"].includes(j.status)).sort(byNew).slice(0, 60).map(view),
      activity: [...data.activity].reverse().slice(0, 150),
    };
  }
  jobDetails(id: string) {
    return this.job(id);
  }
  shotFile(id: string, file: string): string | null {
    if (!/^[\w-]+$/.test(id) || !/^[\w-]+\.png$/.test(file)) return null;
    const path = join(this.paths.shotsDir, id, file);
    return existsSync(path) ? path : null;
  }
  private suggestions(data: FixerData): Suggestion[] {
    let quests: QuestLike[] = [];
    try {
      quests = this.deps.quests();
    } catch {}
    return suggestions(quests, data.adopted, data.dismissed);
  }

  // ================= Settings, fixer quests, suggestions =================
  setSettings(change: Partial<Settings>, actor: Actor): Settings {
    requireAdmin(actor);
    return this.store.update((d) => {
      const before = d.settings;
      d.settings = cleanSettings({ ...d.settings, ...change });
      const said: string[] = [];
      if (before.hourlyChecks !== d.settings.hourlyChecks) said.push(`hourly checks ${d.settings.hourlyChecks ? "on" : "off"}`);
      if (before.autoPrepare !== d.settings.autoPrepare) said.push(`prepare fixes by itself ${d.settings.autoPrepare ? "on" : "off"}`);
      if (before.dailyCap !== d.settings.dailyCap) said.push(`daily cap ${d.settings.dailyCap}`);
      if (before.timeLimitMinutes !== d.settings.timeLimitMinutes) said.push(`time limit ${d.settings.timeLimitMinutes} min`);
      if (said.length) this.note(d, "settings", `${actor.name}: ${said.join(", ")}`);
      return d.settings;
    });
  }

  addQuest(input: { title?: unknown; details?: unknown; kind?: unknown; priority?: unknown; start?: unknown }, actor: Actor): FixerQuest {
    requireAdmin(actor);
    const at = this.now().toISOString();
    const quest = cleanQuest({ ...input, id: randomUUID(), from: "", status: "open", by: actor.name, created: at, updated: at });
    if (!quest) throw new Error("Give the fixer quest a title.");
    this.store.update((d) => {
      d.quests.push(quest);
      this.note(d, "quest", `${actor.name} added a fixer quest: ${quest.title}`);
    });
    if (input.start === true) this.prepareQuest(quest.id, actor);
    return quest;
  }

  updateQuest(id: string, change: { title?: unknown; details?: unknown; kind?: unknown; priority?: unknown; status?: unknown }, actor: Actor): FixerQuest {
    requireAdmin(actor);
    return this.store.update((d) => {
      const i = d.quests.findIndex((q) => q.id === id);
      if (i < 0) throw new Error("There's no such fixer quest.");
      const next = cleanQuest({ ...d.quests[i], ...pick(change, ["title", "details", "kind", "priority", "status"]), updated: this.now().toISOString() });
      if (!next) throw new Error("A fixer quest needs a title.");
      d.quests[i] = next;
      return next;
    });
  }

  removeQuest(id: string, actor: Actor): void {
    requireAdmin(actor);
    this.store.update((d) => {
      const q = d.quests.find((x) => x.id === id);
      if (!q) throw new Error("There's no such fixer quest.");
      d.quests = d.quests.filter((x) => x.id !== id);
      this.note(d, "quest", `${actor.name} removed the fixer quest “${q.title}”`);
    });
  }

  adopt(questId: string, actor: Actor): FixerQuest {
    requireAdmin(actor);
    const data = this.store.read();
    const s = this.suggestions(data).find((x) => x.questId === questId);
    if (!s) throw new Error("That quest isn't a suggestion any more.");
    const at = this.now().toISOString();
    const quest = cleanQuest({ id: randomUUID(), title: s.title, details: [s.details, s.from ? `(From ${s.from})` : ""].filter(Boolean).join("\n\n"), kind: s.kind, priority: s.priority, from: `quest:${s.questId}`, status: "open", by: actor.name, created: at, updated: at })!;
    this.store.update((d) => {
      d.adopted.push(questId);
      d.quests.push(quest);
      this.note(d, "quest", `${actor.name} adopted “${quest.title}” as a fixer quest`);
    });
    return quest;
  }

  dismiss(questId: string, actor: Actor): void {
    requireAdmin(actor);
    this.store.update((d) => {
      if (!d.dismissed.includes(questId)) d.dismissed.push(questId);
    });
  }

  // ================= Checks =================
  // full: the hourly check (tests, typecheck, sweep, health). Otherwise the quick one (sweep and
  // health), used just before and after a change goes live.
  async check(kind: "full" | "quick" | "audio" = "full"): Promise<{ findings: Finding[]; fresh: Issue[] }> {
    if (this.checking && kind !== "quick") return { findings: [], fresh: [] };
    if (kind !== "quick") this.checking = true;
    const started = Date.now();
    const findings: Finding[] = [];
    const areas: Issue["area"][] = [];
    try {
      if (kind === "full") {
        areas.push("tests", "typecheck");
        const na = await this.deps.run("npx", ["vitest", "run"], { cwd: this.paths.naMain, timeoutMs: 15 * 60_000, env: testEnv(), clean: true });
        findings.push(...commandFindings("tests", "na", na.code, na.out));
        const tsc = await this.deps.run("npx", ["tsc", "--noEmit"], { cwd: this.paths.naMain, timeoutMs: 5 * 60_000, clean: true });
        findings.push(...commandFindings("typecheck", "na", tsc.code, tsc.out));
        const nb = await this.deps.run("npx", ["vitest", "run"], { cwd: this.paths.nbMain, timeoutMs: 15 * 60_000, env: testEnv(), clean: true });
        findings.push(...commandFindings("tests", "nb", nb.code, nb.out));
      }
      if (kind === "audio") {
        areas.push("audio");
        const a = await this.deps.run("node", ["scripts/audio-levels.mjs"], { cwd: this.paths.naMain, timeoutMs: 20 * 60_000, clean: true });
        findings.push(...commandFindings("audio", "na", a.code, a.out));
        this.store.update((d) => void (d.lastAudio = ukDate(this.now())));
      } else {
        areas.push("sweep", "health");
        const swept = await this.deps.sweep(this.opts.pcBase).catch((err) => ({ findings: [{ fingerprint: "sweep:browser", area: "sweep" as const, severity: "serious" as const, title: "The sweep couldn't run", detail: String((err as Error).message) }], shots: [] }));
        findings.push(...swept.findings);
        const restartsSeen = this.store.read().restarts;
        const h = await this.deps.health(restartsSeen);
        findings.push(...h.findings);
        if (h.restarts !== restartsSeen) this.store.update((d) => void (d.restarts = h.restarts));
        await this.recheckBlips(findings);
      }
      const merged = this.store.update((d) => {
        const m = mergeIssues(d.issues, findings, areas, this.now());
        d.issues = m.issues;
        if (kind !== "audio") d.lastCheck = kind === "full" ? { at: this.now().toISOString(), took: Date.now() - started, serious: m.issues.filter((i) => i.severity === "serious").length, minor: m.issues.filter((i) => i.severity === "minor").length } : d.lastCheck;
        for (const i of m.fresh) this.note(d, "issue", `New ${i.severity === "serious" ? "serious problem" : "small problem"}: ${i.title}`);
        for (const i of m.cleared) this.note(d, "issue", `Gone: ${i.title}`);
        this.closeGoneJobs(d);
        if (kind === "full") this.note(d, "check", `Hourly check: ${m.issues.length ? `${m.issues.length} open problem${m.issues.length === 1 ? "" : "s"}` : "all clear"}`);
        return m;
      });
      if (kind !== "quick") await this.afterCheck(merged.fresh);
      return { findings, fresh: merged.fresh };
    } finally {
      if (kind !== "quick") this.checking = false;
    }
  }

  // Nova Bot blips: a problem that looks like Nova Bot (or the link to it) not answering for a moment
  // is checked again, a few times over a couple of minutes, and only counts if it's there every time.
  // Health is asked again; the sweep looks again only at the panels where it was seen.
  private async recheckBlips(findings: Finding[]) {
    for (let attempt = 0; attempt < BLIP_TRIES && findings.some(isBlip); attempt++) {
      await this.deps.sleep(BLIP_WAIT_MS);
      const again: Finding[] = [];
      const h = await this.deps.health(this.store.read().restarts).catch(() => ({ findings: [] as Finding[], restarts: 0 }));
      again.push(...h.findings);
      const panels = new Set(findings.filter((f) => f.area === "sweep" && isBlip(f)).flatMap((f) => f.panels || (f.panel ? [f.panel] : [])));
      if (panels.size) {
        const screens = SCREENS.filter((x) => panels.has(x.path)).map((x) => ({ name: x.name, path: x.path }));
        const swept = await this.deps.sweep(this.opts.pcBase, { screens }).catch(() => ({ findings: [] as Finding[], shots: [] }));
        again.push(...swept.findings);
      }
      const still = new Set(again.filter(isBlip).map((f) => f.fingerprint));
      for (let i = findings.length - 1; i >= 0; i--) if (isBlip(findings[i]) && !still.has(findings[i].fingerprint)) findings.splice(i, 1);
    }
  }

  // A fix whose problem has gone (fixed another way, or it was only a blip) is closed, instead of
  // sitting "blocked" or "waiting" for a problem that isn't there any more
  private closeGoneJobs(d: FixerData) {
    const open = new Set(d.issues.map((i) => i.id));
    for (const job of d.jobs) {
      if (job.target.type !== "issue" || open.has(job.target.id) || !CLOSABLE.includes(job.status)) continue;
      Object.assign(job, { status: "closed", error: "Its problem went away by itself (fixed another way, or it was only a moment when Nova Bot didn't answer). Nothing was changed.", finishedAt: this.now().toISOString(), updated: this.now().toISOString() });
      this.note(d, "job", `Closed (the problem's gone): ${job.target.title}`);
      const copy = { ...job };
      queueMicrotask(() => void this.cleanUp(copy).catch(() => {}));
    }
  }

  // New serious problems: one calm ping each, ever. New problems: a fix prepared, if that's on.
  private async afterCheck(fresh: Issue[]) {
    const data = this.store.read();
    const tell = fresh.filter((i) => i.severity === "serious" && !i.notified);
    if (tell.length) {
      this.store.update((d) => d.issues.forEach((i) => tell.some((t) => t.id === i.id) && (i.notified = true)));
      const first = tell[0];
      await this.deps.notify(tell.length === 1 ? "Found a problem" : `Found ${tell.length} problems`, `${short(first.title, 200)}${tell.length > 1 ? ` (and ${tell.length - 1} more)` : ""}. ${data.settings.autoPrepare && !this.opts.dry ? "A fix is being prepared; it waits for your approval." : "Open the Fixer to look."}`, `issue-${first.id}`);
    }
    // (Not for health problems or blips: a network, disk or Nova Bot outage isn't something code changes fix)
    if (data.settings.autoPrepare && !this.opts.dry) for (const i of fresh.filter((x) => x.area !== "health" && !x.blip)) this.enqueue({ type: "issue", id: i.id }, null);
  }

  async hourly(): Promise<void> {
    const data = this.store.read();
    if (!data.settings.hourlyChecks) return;
    await this.check("full");
    if (this.store.read().lastAudio !== ukDate(this.now())) await this.check("audio");
  }

  // ================= Preparing a fix =================
  prepareIssue(issueId: string, actor: Actor): Job {
    requireAdmin(actor);
    return this.enqueue({ type: "issue", id: issueId }, actor);
  }
  prepareQuest(questId: string, actor: Actor): Job {
    requireAdmin(actor);
    return this.enqueue({ type: "quest", id: questId }, actor);
  }

  private enqueue(t: { type: "issue" | "quest"; id: string }, actor: Actor | null): Job {
    if (this.opts.dry) throw new Error("The Fixer is inert here (FIXER_DRY=1): it doesn't prepare fixes.");
    const job = this.store.update((d) => {
      const target = t.type === "issue" ? d.issues.find((i) => i.id === t.id) : d.quests.find((q) => q.id === t.id);
      if (!target) throw new Error(t.type === "issue" ? "That problem has gone." : "There's no such fixer quest.");
      const open = target.jobId ? d.jobs.find((j) => j.id === target.jobId && !["failed", "rejected", "done", "rolled-back", "undone", "closed"].includes(j.status)) : null;
      if (open) return open;
      const at = this.now().toISOString();
      const id = `${at.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
      const issue = t.type === "issue" ? (target as Issue) : null;
      const quest = t.type === "quest" ? (target as FixerQuest) : null;
      const kind: QuestKind = quest ? quest.kind : issue!.area === "sweep" && issue!.severity === "minor" ? "glitch" : "bug";
      const job: Job = {
        id,
        target: { type: t.type, id: t.id, title: target.title, details: issue ? `${issue.detail}\n\n(Found by the Fixer's ${issue.area} check${issue.panel ? ` on ${issue.panel}` : ""}.)` : quest!.details, kind },
        status: "queued",
        notes: [],
        attempt: 1,
        branch: `fixer/job-${id}`,
        worktrees: { na: join(this.paths.jobsDir, id, "na"), nb: join(this.paths.jobsDir, id, "nb") },
        card: null,
        error: "",
        approval: null,
        landed: { na: null, nb: null },
        deployed: "",
        restartPending: false,
        preCheck: null,
        rollback: null,
        notified: false,
        created: at,
        updated: at,
        startedAt: "",
        finishedAt: "",
      };
      d.jobs.push(job);
      target.jobId = id;
      if (quest) quest.status = "working";
      this.note(d, "job", `${actor ? actor.name : "The Fixer"} asked for a fix: ${job.target.title}`);
      return job;
    });
    void this.pump();
    return job;
  }

  // One job at a time, within the daily cap
  async pump(): Promise<void> {
    if (this.running || this.opts.dry) return;
    const data = this.store.read();
    const next = data.jobs.find((j) => j.status === "queued");
    if (!next) return;
    const day = this.today(data);
    if (day.prepared >= data.settings.dailyCap) {
      this.store.update((d) => {
        const last = d.activity[d.activity.length - 1];
        const line = `Today's limit of ${d.settings.dailyCap} prepared fixes is reached: the rest wait until tomorrow`;
        if (!last || last.text !== line) this.note(d, "job", line);
      });
      return;
    }
    this.running = next.id;
    this.store.update((d) => {
      this.today(d).prepared += 1;
    });
    try {
      await this.prepare(next);
    } finally {
      this.running = null;
    }
    await this.pump();
  }

  // The job's own worktrees and branch (a new branch from main the first time; the same ones again
  // for a tweak, so Claude Code sees what it did last time)
  private async worktrees(job: Job) {
    for (const repo of ["na", "nb"] as const) {
      const wt = job.worktrees[repo];
      const main = repo === "na" ? this.paths.naMain : this.paths.nbMain;
      if (existsSync(join(wt, ".git"))) continue;
      mkdirSync(join(this.paths.jobsDir, job.id), { recursive: true });
      const r = await this.git(main, ["worktree", "add", "-b", job.branch, wt, "main"]);
      if (r.code !== 0) throw new Error(`Couldn't make the job's ${repo === "na" ? "Nova Agent" : "Nova Bot"} copy: ${short(r.out, 300)}`);
      // Its packages: a link to the main folder's (never committed: node_modules is off limits)
      try {
        if (existsSync(join(main, "node_modules")) && !existsSync(join(wt, "node_modules"))) symlinkSync(join(main, "node_modules"), join(wt, "node_modules"));
      } catch {}
    }
  }

  private async changedFiles(job: Job): Promise<{ working: FileChange[]; branch: FileChange[] }> {
    const working: FileChange[] = [];
    const branch: FileChange[] = [];
    for (const repo of ["na", "nb"] as const) {
      const wt = job.worktrees[repo];
      const st = await this.git(wt, ["status", "--porcelain", "-uall", "--no-renames"]);
      for (const line of st.out.split("\n")) {
        const path = line.slice(3).trim().replace(/^"|"$/g, "");
        if (line.length > 3 && path && path !== "node_modules") working.push({ repo, path, added: 0, removed: 0 });
      }
      const ns = await this.git(wt, ["diff", "--numstat", "--no-renames", "main...HEAD"]);
      for (const line of ns.out.split("\n")) {
        const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
        if (m) branch.push({ repo, path: m[3], added: Number(m[1]) || 0, removed: Number(m[2]) || 0 });
      }
    }
    return { working, branch };
  }

  private async discardWorking(job: Job) {
    for (const repo of ["na", "nb"] as const) {
      await this.git(job.worktrees[repo], ["checkout", "--", "."]);
      await this.git(job.worktrees[repo], ["clean", "-fd"]);
    }
  }

  // Run the job's copy of Nova Agent (inert: FIXER_DRY, no key, a pretend Nova Bot, its own empty
  // data) and sweep it, with screenshots
  private async shoot(job: Job, prefix: "before" | "after") {
    const server = await this.deps.startServer(job.worktrees.na);
    try {
      return await this.deps.sweep(server.base, { shotsDir: join(this.paths.shotsDir, job.id), prefix });
    } finally {
      await server.stop();
    }
  }

  private async prepare(job: Job): Promise<void> {
    const settings = this.store.read().settings;
    this.saveJob(job, { status: "preparing", startedAt: this.now().toISOString(), error: "" });
    this.store.update((d) => this.note(d, "job", `Preparing a fix${job.attempt > 1 ? ` (attempt ${job.attempt})` : ""}: ${job.target.title}`));
    try {
      await this.worktrees(job);
      // Before: how the panels look (and what the sweep finds) before any change
      const beforeFile = join(this.paths.shotsDir, job.id, "before.json");
      let before: string[] = [];
      if (existsSync(beforeFile)) before = JSON.parse(readFileSync(beforeFile, "utf8"));
      else {
        const b = await this.shoot(job, "before");
        before = b.findings.map((f) => f.fingerprint);
        mkdirSync(join(this.paths.shotsDir, job.id), { recursive: true });
        writeFileSync(beforeFile, JSON.stringify(before));
      }

      // Claude Code makes the change, in the job's worktrees only
      const brief = { title: job.target.title, details: job.target.details, kind: job.target.kind, notes: job.notes, naDir: job.worktrees.na, nbDir: job.worktrees.nb };
      const ran = await this.deps.run(this.paths.claudeBin, claudeArgs(brief), { cwd: job.worktrees.na, timeoutMs: settings.timeLimitMinutes * 60_000, env: { ...testEnv(), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }, clean: true });
      if (ran.code === 124) throw new Error(`It ran out of time (${settings.timeLimitMinutes} minutes) before finishing.`);
      const answer = readAnswer(ran.out);
      if (ran.code !== 0 && !answer) throw new Error(`Claude Code stopped with a problem: ${short(ran.out.trim().split("\n").slice(-3).join(" "), 300)}`);

      // Off limits: never offered, and its edits are thrown away
      const { working } = await this.changedFiles(job);
      const off = offLimits(working);
      if (off.length) {
        await this.discardWorking(job);
        throw new Error(`It changed things the Fixer must never touch, so its changes were thrown away: ${off.join("; ")}`);
      }
      // The Fixer commits, by explicit path, on the job's own branch
      for (const repo of ["na", "nb"] as const) {
        const paths = working.filter((f) => f.repo === repo).map((f) => f.path);
        if (!paths.length) continue;
        const wt = job.worktrees[repo];
        const add = await this.git(wt, ["add", "--", ...paths]);
        if (add.code !== 0) throw new Error(`Couldn't save the change: ${short(add.out, 300)}`);
        const msg = `Fixer: ${short(job.target.title, 70)}${job.attempt > 1 ? ` (attempt ${job.attempt})` : ""}\n\n${short(answer?.summary || "", 600)}\n\nPrepared by the Fixer with Claude Code; waits for an admin's approval.\n\n${COAUTHOR}`;
        const commit = await this.git(wt, ["commit", "-q", "-m", msg]);
        if (commit.code !== 0) throw new Error(`Couldn't save the change: ${short(commit.out, 300)}`);
      }
      const { branch: files } = await this.changedFiles(job);
      if (!files.length) throw new Error(answer?.summary ? `No change was made: ${short(answer.summary, 400)}` : "No change was made.");
      const offBranch = offLimits(files);
      if (offBranch.length) throw new Error(`It changed things the Fixer must never touch: ${offBranch.join("; ")}`);

      // Checks, in the job's worktrees
      this.saveJob(job, { status: "checking" });
      const checks: Check[] = [];
      const say = (name: string, r: { code: number; out: string }) => checks.push({ name, ok: r.code === 0, detail: r.code === 0 ? "" : short(r.out.trim().split("\n").slice(-12).join("\n"), 1500) });
      say("Nova Agent's tests", await this.deps.run("npx", ["vitest", "run"], { cwd: job.worktrees.na, timeoutMs: 15 * 60_000, env: testEnv(), clean: true }));
      say("Nova Agent's typecheck", await this.deps.run("npx", ["tsc", "--noEmit"], { cwd: job.worktrees.na, timeoutMs: 5 * 60_000, clean: true }));
      if (files.some((f) => f.repo === "nb")) say("Nova Bot's tests", await this.deps.run("npx", ["vitest", "run"], { cwd: job.worktrees.nb, timeoutMs: 15 * 60_000, env: testEnv(), clean: true }));
      const after = await this.shoot(job, "after");
      const newProblems = after.findings.filter((f) => !before.includes(f.fingerprint));
      checks.push({ name: "Sweep of every panel (390 and 1280)", ok: newProblems.length === 0, detail: newProblems.map((f) => f.title).slice(0, 8).join("\n") });

      // The card
      const diffs: string[] = [];
      for (const repo of ["na", "nb"] as const) {
        if (!files.some((f) => f.repo === repo)) continue;
        const d = await this.git(job.worktrees[repo], ["diff", "--no-color", "--no-renames", "main...HEAD"]);
        diffs.push(d.out.replace(/^diff --git a\//gm, `diff --git ${repo}:a/`));
      }
      const diff = diffs.join("\n").slice(0, 150_000);
      const plainDiff = diffs.join("\n").replace(/^diff --git (na|nb):a\//gm, "diff --git a/");
      const trivial = isTrivial(files, plainDiff);
      const sensitive = sensitiveLines(plainDiff);
      const risks = [...(answer?.risks || [])];
      if (sensitive.length) risks.unshift("It mentions payments, emails, Acuity or secrets in the lines it adds.");
      const shots = new Map(after.shots.map((s) => [`${s.path}|${s.width}`, s.file]));
      const screens = affectedScreens(files).flatMap((s) =>
        [390, 1280].map((width) => {
          const name = `${s.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}-${width}.png`;
          return { name: s.name, path: s.path, width, before: existsSync(join(this.paths.shotsDir, job.id, `before-${name}`)) ? `before-${name}` : "", after: shots.get(`${s.path}|${width}`) || "" };
        }),
      );
      const card: Card = {
        summary: answer?.summary || "Claude Code made a change but didn't describe it.",
        why: answer?.why || job.target.title,
        files,
        diff,
        screens,
        consequences: answer?.consequences || "",
        assessment: answer?.assessment || "",
        risks,
        recommendation: recommend({ checks, trivial, sensitive, claudeVerdict: answer?.verdict, claudeReasons: answer?.reasons, risks }),
        trivial: trivial && !sensitive.length,
        checks,
        allPassed: checks.every((c) => c.ok),
        offLimits: [],
      };
      this.saveJob(job, { status: "ready", card, finishedAt: this.now().toISOString() });
      this.store.update((d) => this.note(d, "job", `Ready for you: ${job.target.title}${card.trivial ? " (trivial)" : ""}${card.allPassed ? "" : " (some checks didn't pass)"}`));
      if (!job.notified) {
        this.saveJob(job, { notified: true });
        await this.deps.notify("A fix is ready for you", `${short(job.target.title, 120)}${card.trivial ? " (trivial, safe to approve)" : ""}. Nothing changes until you tap Approve in the Fixer.`, `job-${job.id}`);
      }
    } catch (err) {
      this.saveJob(job, { status: "failed", error: (err as Error).message, finishedAt: this.now().toISOString() });
      this.store.update((d) => {
        this.note(d, "job", `Couldn't prepare a fix for “${job.target.title}”: ${short((err as Error).message, 300)}`);
        const q = job.target.type === "quest" ? d.quests.find((x) => x.id === job.target.id) : null;
        if (q && q.status === "working") q.status = "open";
      });
    }
  }

  // ================= The admin's taps =================
  // Approve: the only way anything goes live
  approve(id: string, actor: Actor): { job: Job; landing: Promise<Job> } {
    requireAdmin(actor);
    if (this.opts.dry) throw new Error("The Fixer is inert here (FIXER_DRY=1): it doesn't merge or deploy.");
    const job = this.job(id);
    if (job.status !== "ready" && job.status !== "blocked") throw new Error(`This fix can't be approved now (it's ${job.status}).`);
    if (!job.card || job.card.offLimits.length) throw new Error("This fix has no approval card.");
    const approval = mintApproval(job.id, actor, this.now());
    this.saveJob(job, { status: "approved", approval: { by: approval.by, via: approval.via, at: approval.at }, error: "" });
    this.store.update((d) => this.note(d, "approve", `${actor.name} approved: ${job.target.title}`));
    const landing = this.landing.then(() => this.land(job, approval));
    this.landing = landing.catch(() => {});
    return { job, landing };
  }

  reject(id: string, actor: Actor): Job {
    requireAdmin(actor);
    const job = this.job(id);
    if (job.status !== "ready" && job.status !== "failed" && job.status !== "blocked") throw new Error(`This fix can't be rejected now (it's ${job.status}).`);
    this.saveJob(job, { status: "rejected", finishedAt: this.now().toISOString() });
    this.store.update((d) => {
      this.note(d, "job", `${actor.name} rejected: ${job.target.title}`);
      const t = job.target.type === "issue" ? d.issues.find((i) => i.id === job.target.id) : d.quests.find((q) => q.id === job.target.id);
      if (t && t.jobId === job.id) t.jobId = "";
      const q = job.target.type === "quest" ? d.quests.find((x) => x.id === job.target.id) : null;
      if (q) q.status = "open";
    });
    void this.cleanUp(job);
    return job;
  }

  // Ask for a tweak: the admin's note goes with it, and it's prepared again (same worktrees)
  tweak(id: string, note: string, actor: Actor): Job {
    requireAdmin(actor);
    if (this.opts.dry) throw new Error("The Fixer is inert here (FIXER_DRY=1): it doesn't prepare fixes.");
    const job = this.job(id);
    if (job.status !== "ready" && job.status !== "failed" && job.status !== "blocked") throw new Error(`This fix can't be tweaked now (it's ${job.status}).`);
    const text = String(note || "").trim().slice(0, 2000);
    if (!text) throw new Error("Say what to change.");
    this.saveJob(job, { status: "queued", notes: [...job.notes, `${actor.name}: ${text}`], attempt: job.attempt + 1, card: null, notified: false, error: "" });
    this.store.update((d) => this.note(d, "job", `${actor.name} asked for a tweak to “${job.target.title}”: ${short(text, 200)}`));
    void this.pump();
    return job;
  }

  // Undo a fix that went live (an admin's tap)
  undo(id: string, actor: Actor): { job: Job; landing: Promise<Job> } {
    requireAdmin(actor);
    if (this.opts.dry) throw new Error("The Fixer is inert here (FIXER_DRY=1).");
    const job = this.job(id);
    if (job.status !== "done") throw new Error("Only a fix that went live can be undone.");
    this.saveJob(job, { status: "rolling-back" });
    const landing = this.landing.then(() => this.rollBack(job, `${actor.name} tapped Undo`, actor.name));
    this.landing = landing.catch(() => {});
    return { job, landing };
  }

  // ================= Going live (after Approve) =================
  private repos(job: Job): ("na" | "nb")[] {
    const files = job.card?.files || [];
    return (["na", "nb"] as const).filter((r) => files.some((f) => f.repo === r));
  }
  private needsDeploy(job: Job) {
    const files = job.card?.files || [];
    return files.some((f) => f.repo === "nb" || /^web\//.test(f.path));
  }
  private needsRestart(job: Job) {
    return (job.card?.files || []).some((f) => f.repo === "na" && /^src\//.test(f.path));
  }
  private async serious(): Promise<string[]> {
    const { findings } = await this.check("quick");
    return findings.filter((f) => f.severity === "serious").map((f) => f.fingerprint);
  }

  async land(job: Job, approval: Approval): Promise<Job> {
    // The lock: nothing is merged or deployed without an approval minted by approve() for this job
    if (!isApproval(approval, job.id) || !job.approval || job.approval.at !== approval.at) throw new Error("Not approved: nothing was merged or deployed.");
    if (this.opts.dry) throw new Error("The Fixer is inert here (FIXER_DRY=1).");
    this.saveJob(job, { status: "landing" });
    const blocked = async (why: string) => {
      await this.undoMerges(job);
      this.saveJob(job, { status: "blocked", error: why, landed: { na: null, nb: null } });
      this.store.update((d) => this.note(d, "deploy", `Couldn't put “${job.target.title}” live, so nothing changed: ${short(why, 300)}`));
      return job;
    };
    try {
      job.preCheck = await this.serious();
      this.saveJob(job);
      for (const repo of this.repos(job)) {
        const wt = job.worktrees[repo];
        const main = repo === "na" ? this.paths.naMain : this.paths.nbMain;
        const head = await this.git(main, ["symbolic-ref", "--short", "HEAD"]);
        if (head.out.trim() !== "main") return await blocked(`${repo === "na" ? "Nova Agent" : "Nova Bot"}'s main folder isn't on main.`);
        // Bring the job's own branch up to date with main (only its branch moves)
        const rebase = await this.git(wt, ["rebase", "main"]);
        if (rebase.code !== 0) {
          await this.git(wt, ["rebase", "--abort"]);
          return await blocked("main has changed in the same places since this was prepared. Ask for a tweak to prepare it again.");
        }
        const before = (await this.git(main, ["rev-parse", "HEAD"])).out.trim();
        const merge = await this.git(main, ["merge", "--ff-only", job.branch]);
        if (merge.code !== 0) return await blocked(`Couldn't merge into main (${short(merge.out.trim(), 200)}). Unsaved edits in the main folder may be in the way.`);
        const after = (await this.git(main, ["rev-parse", "HEAD"])).out.trim();
        job.landed[repo] = { before, after };
        this.saveJob(job);
      }
      this.store.update((d) => this.note(d, "deploy", `Merged into main: ${job.target.title}`));
      if (this.needsDeploy(job)) {
        const ok = await this.deploy();
        if (!ok) return await this.rollBack(job, "Deploying to Nova Bot failed three times", "the Fixer");
      }
      this.saveJob(job, { deployed: this.now().toISOString() });
      if (this.needsRestart(job)) {
        // The Fixer runs inside this service: everything is saved first, and it carries on after
        this.saveJob(job, { status: "restarting", restartPending: true });
        this.store.update((d) => this.note(d, "deploy", `Restarting Nova Agent with: ${job.target.title}`));
        await this.deps.run("systemctl", ["--user", "restart", "agent-nova.service"], { cwd: this.paths.naMain, timeoutMs: 60_000 });
        return job;
      }
      return await this.verify(job);
    } catch (err) {
      this.saveJob(job, { status: "blocked", error: (err as Error).message });
      return job;
    }
  }

  // Nova Bot's deploy, with Nova Agent's pages from the clean release copy of main (up to 3 tries)
  private async deploy(): Promise<boolean> {
    const co = await this.git(this.paths.release, ["checkout", "-q", "--detach", "main"]);
    if (co.code !== 0) return false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Wherever Nova Bot is live: vps/deploy-live.sh picks the VPS after the switch-over (a plain
      // `wrangler deploy` there would put the full Nova Bot back on Cloudflare and undo the switch)
      const live = existsSync(join(this.paths.nbMain, "vps", "deploy-live.sh"));
      const r = live
        ? await this.deps.run("bash", ["vps/deploy-live.sh"], { cwd: this.paths.nbMain, timeoutMs: 15 * 60_000, env: { NOVA_AGENT_DIR: this.paths.release } })
        : await this.deps.run("npx", ["wrangler", "deploy"], { cwd: this.paths.nbMain, timeoutMs: 10 * 60_000, env: { NOVA_AGENT_DIR: this.paths.release } });
      if (r.code === 0) {
        this.store.update((d) => this.note(d, "deploy", "Deployed to Nova Bot"));
        return true;
      }
      this.store.update((d) => this.note(d, "deploy", `Deploy attempt ${attempt} didn't work: ${short(r.out.trim().split("\n").slice(-2).join(" "), 200)}`));
      if (attempt < 3) await this.deps.sleep(20_000);
    }
    return false;
  }

  private async verify(job: Job): Promise<Job> {
    this.saveJob(job, { status: "verifying", restartPending: false });
    const after = await this.serious();
    const decision = shouldRollBack(job.preCheck, after);
    if (decision.rollBack) return this.rollBack(job, decision.reason, "the Fixer");
    this.saveJob(job, { status: "done", finishedAt: this.now().toISOString() });
    this.store.update((d) => {
      this.note(d, "deploy", `Live and checked: ${job.target.title}`);
      const q = job.target.type === "quest" ? d.quests.find((x) => x.id === job.target.id) : null;
      if (q) q.status = "done";
    });
    void this.cleanUp(job, true);
    return job;
  }

  // Merges already made for a job that couldn't finish going live (before anything was deployed)
  private async undoMerges(job: Job) {
    for (const repo of ["nb", "na"] as const) {
      const l = job.landed[repo];
      if (!l || l.before === l.after) continue;
      const main = repo === "na" ? this.paths.naMain : this.paths.nbMain;
      await this.revert(main, l, job);
    }
  }
  private async revert(main: string, l: { before: string; after: string }, job: Job): Promise<boolean> {
    const r = await this.git(main, ["revert", "--no-commit", `${l.before}..${l.after}`]);
    if (r.code !== 0) {
      await this.git(main, ["revert", "--abort"]);
      return false;
    }
    const c = await this.git(main, ["commit", "-q", "-m", `Fixer: undo “${short(job.target.title, 60)}”\n\n${COAUTHOR}`]);
    return c.code === 0;
  }

  // Undo a change that went live: revert it on main, deploy again, restart if needed. Done by
  // itself only when the post-deploy check found things worse; otherwise by an admin's Undo.
  async rollBack(job: Job, reason: string, by: string): Promise<Job> {
    const auto = by === "the Fixer";
    this.saveJob(job, { status: "rolling-back", rollback: { at: this.now().toISOString(), reason, by } });
    let ok = true;
    for (const repo of ["nb", "na"] as const) {
      const l = job.landed[repo];
      if (!l || l.before === l.after) continue;
      ok = (await this.revert(repo === "na" ? this.paths.naMain : this.paths.nbMain, l, job)) && ok;
    }
    if (ok && job.deployed && this.needsDeploy(job)) ok = (await this.deploy()) && ok;
    const final = auto ? "rolled-back" : "undone";
    const line = ok ? `${auto ? "Undid by itself" : `${by} undid`} “${job.target.title}”: ${reason}` : `Couldn't fully undo “${job.target.title}” (${reason}): it needs a person to look`;
    this.store.update((d) => this.note(d, "rollback", line));
    if (auto || !ok) await this.deps.notify(ok ? "A fix was undone" : "A fix needs you", short(line, 300), `rollback-${job.id}`);
    if (ok && this.needsRestart(job)) {
      this.saveJob(job, { status: "rolling-back", restartPending: true, error: ok ? "" : line });
      await this.deps.run("systemctl", ["--user", "restart", "agent-nova.service"], { cwd: this.paths.naMain, timeoutMs: 60_000 });
      return job;
    }
    this.saveJob(job, { status: ok ? final : "blocked", restartPending: false, finishedAt: this.now().toISOString(), error: ok ? "" : line });
    return job;
  }

  private async cleanUp(job: Job, keepBranch = false) {
    for (const repo of ["na", "nb"] as const) {
      const main = repo === "na" ? this.paths.naMain : this.paths.nbMain;
      if (existsSync(job.worktrees[repo])) await this.git(main, ["worktree", "remove", "--force", job.worktrees[repo]]);
      if (!keepBranch) await this.git(main, ["branch", "-D", job.branch]);
    }
    try {
      rmSync(join(this.paths.jobsDir, job.id), { recursive: true, force: true });
    } catch {}
  }

  // ================= After a restart =================
  // Jobs that were mid-way when Nova Agent stopped carry on: a preparation starts again, a change
  // that restarted Nova Agent is checked, an undo that restarted it is finished.
  async resume(): Promise<void> {
    const data = this.store.read();
    for (const job of data.jobs) {
      if (job.status === "preparing" || job.status === "checking") {
        this.saveJob(job, { status: "queued" });
        this.store.update((d) => this.today(d).prepared > 0 && (this.today(d).prepared -= 1));
      }
      if (job.status === "landing" || job.status === "approved") this.saveJob(job, { status: "blocked", error: "Nova Agent stopped while this was going live: check main by hand before approving again." });
    }
    for (const job of this.store.read().jobs) {
      if (job.status === "restarting" && job.restartPending) {
        if (this.opts.dry) continue;
        await this.deps.sleep(45_000);
        await this.verify(job);
      } else if (job.status === "rolling-back" && job.restartPending) {
        this.saveJob(job, { status: job.rollback?.by === "the Fixer" ? "rolled-back" : "undone", restartPending: false, finishedAt: this.now().toISOString() });
      }
    }
    void this.pump();
  }
}

function requireAdmin(actor: Actor) {
  if (!actor || actor.admin !== true) throw new Error("Only an admin can do that.");
}
function pick<T extends object>(o: T, keys: string[]) {
  return Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => keys.includes(k) && v !== undefined));
}
// Tests never reach the real Nova Bot or ring a phone
function testEnv(): Record<string, string> {
  return { NOVA_WORKER_URL: "https://worker.test", AGENT_NOVA_KEY: "", FIXER_DRY: "1", CI: "1" };
}

export { briefText, SCREENS };
