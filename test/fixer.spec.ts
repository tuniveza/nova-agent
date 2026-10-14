// The Fixer: nothing goes live without an admin's Approve.
//
// Every command it would run (git, Claude Code, the tests, wrangler, systemctl) goes to a pretend
// world that records it, so these tests never touch a real repo, run Claude Code or deploy.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type Actor, type Deps, Fixer, type Paths, SERVER_RESTART } from "../src/fixer/fixer";
import { actorFor, registerFixerRoutes } from "../src/fixer/routes";
import { groupFindings, isTrivial, looksLikeDevWork, mergeIssues, offLimits, placesText, shouldRollBack, suggestions } from "../src/fixer/rules";
import { claudeArgs } from "../src/fixer/claude";
import type { RunOptions } from "../src/fixer/runner";
import { FixerStore, normaliseFixer, type FileChange } from "../src/fixer/store";
import type { Finding } from "../src/fixer/rules";
import { relayAllowed } from "../src/relay";

const ADMIN: Actor = { name: "Ana", admin: true, via: "pc" };
const STAFF: Actor = { name: "Sam", admin: false, via: "online" };

// ---- The pretend world ----
interface Edit extends FileChange {}
interface Scenario {
  edits: Edit[];
  diff: { na?: string; nb?: string };
  answer?: Record<string, unknown> | null;
  testsFail?: boolean;
  deployFails?: boolean;
  claudeTimesOut?: boolean;
  before?: Finding[]; // what the job's sweep finds before the change
  after?: Finding[]; // and after
  liveAfter?: Finding[]; // what the live quick check finds after going live
}
const cssDiff = (file = "web/notes/css/app.css") => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,3 +1,3 @@\n .toolbar {\n-  flex-wrap: nowrap;\n+  flex-wrap: wrap;\n }\n`;
const wordingDiff = `diff --git a/web/portal/index.html b/web/portal/index.html\n--- a/web/portal/index.html\n+++ b/web/portal/index.html\n@@ -10,1 +10,1 @@\n-    <button type="button" class="btn">Sumbit</button>\n+    <button type="button" class="btn">Submit</button>\n`;
const logicDiff = `diff --git a/web/notes/js/app.js b/web/notes/js/app.js\n--- a/web/notes/js/app.js\n+++ b/web/notes/js/app.js\n@@ -5,1 +5,1 @@\n-  if (a > b) save();\n+  if (a >= b) save();\n`;
const srcDiff = `diff --git a/src/quests/plan.ts b/src/quests/plan.ts\n--- a/src/quests/plan.ts\n+++ b/src/quests/plan.ts\n@@ -5,1 +5,2 @@\n-  return x;\n+  if (!x) return null;\n+  return x;\n`;
const nbDiff = `diff --git a/src/portal/app.js b/src/portal/app.js\n--- a/src/portal/app.js\n+++ b/src/portal/app.js\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n`;

const SCENARIOS: Record<string, Scenario> = {
  "a small CSS change (trivial)": { edits: [{ repo: "na", path: "web/notes/css/app.css", added: 1, removed: 1 }], diff: { na: cssDiff() } },
  "on-screen wording only (trivial)": { edits: [{ repo: "na", path: "web/portal/index.html", added: 1, removed: 1 }], diff: { na: wordingDiff } },
  "a change to how a panel works": { edits: [{ repo: "na", path: "web/notes/js/app.js", added: 1, removed: 1 }], diff: { na: logicDiff } },
  "a change to Nova Agent's server": { edits: [{ repo: "na", path: "src/quests/plan.ts", added: 2, removed: 1 }], diff: { na: srcDiff } },
  "a change to Nova Bot": { edits: [{ repo: "nb", path: "src/portal/app.js", added: 1, removed: 1 }], diff: { nb: nbDiff } },
  "a change whose tests fail": { edits: [{ repo: "na", path: "web/notes/js/app.js", added: 1, removed: 1 }], diff: { na: logicDiff }, testsFail: true },
};

const ANSWER = { summary: "The toolbar wraps on phones now.", why: "It hung off the screen.", consequences: "Notes' toolbar fits on a phone.", assessment: "A good idea: small and safe.", risks: ["Buttons may sit on two lines."], verdict: "approve", reasons: ["Small change"], changed: true };

function world(scenario: Scenario, options: { dry?: boolean; quests?: any[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "fixer-test-"));
  const paths: Paths = { naMain: join(root, "na"), nbMain: join(root, "nb"), release: join(root, "na-release"), jobsDir: join(root, "jobs"), shotsDir: join(root, "shots"), claudeBin: "/fake/claude" };
  const log: string[] = [];
  const runs: { cmd: string; args: string[]; opts: RunOptions }[] = [];
  const notes: { title: string; message: string }[] = [];
  const trees = new Map<string, { working: Edit[]; committed: Edit[]; diff: string }>();
  const tree = (cwd: string) => {
    if (!trees.has(cwd)) trees.set(cwd, { working: [], committed: [], diff: "" });
    return trees.get(cwd)!;
  };
  let sha = 0;
  let claudeNow = 0;
  let claudeMax = 0;
  let live = false; // has anything gone live (so the quick check sees scenario.liveAfter)
  const w = {
    root,
    paths,
    log,
    runs,
    notes,
    scenario,
    get claudeMax() {
      return claudeMax;
    },
    healthFindings: [] as Finding[],
    quests: options.quests || [],
    now: new Date("2026-10-11T09:00:00Z"),
  };
  const ok = { code: 0, out: "" };
  const deps: Deps = {
    run: async (cmd, args, opts) => {
      runs.push({ cmd, args, opts });
      log.push([cmd, ...args].join(" "));
      if (cmd === "git") {
        const cwd = args[1];
        const sub = args.slice(2);
        const t = tree(cwd);
        switch (sub[0]) {
          case "worktree":
            if (sub[1] === "add") {
              mkdirSync(sub[4], { recursive: true });
              writeFileSync(join(sub[4], ".git"), "gitdir: pretend");
            }
            return ok;
          case "status":
            return { code: 0, out: t.working.map((f) => ` M ${f.path}`).join("\n") };
          case "diff":
            if (sub.includes("--numstat")) return { code: 0, out: t.committed.map((f) => `${f.added}\t${f.removed}\t${f.path}`).join("\n") };
            return { code: 0, out: t.diff };
          case "commit":
            if (cwd.startsWith(paths.jobsDir)) {
              t.committed.push(...t.working);
              t.working = [];
            }
            return ok;
          case "checkout":
            if (sub[1] === "--") t.working = [];
            return ok;
          case "symbolic-ref":
            return { code: 0, out: "main\n" };
          case "rev-parse":
            return { code: 0, out: `sha${++sha}\n` };
          case "merge":
            live = true;
            return ok;
          default:
            return ok;
        }
      }
      if (cmd === paths.claudeBin) {
        claudeNow++;
        claudeMax = Math.max(claudeMax, claudeNow);
        await new Promise((r) => setTimeout(r, 5));
        claudeNow--;
        if (scenario.claudeTimesOut) return { code: 124, out: "" };
        const na = opts.cwd;
        const nb = na.replace(/\/na$/, "/nb");
        for (const e of scenario.edits) tree(e.repo === "na" ? na : nb).working.push({ ...e });
        tree(na).diff = scenario.diff.na || "";
        tree(nb).diff = scenario.diff.nb || "";
        return { code: 0, out: JSON.stringify({ type: "result", subtype: "success", result: "done", structured_output: scenario.answer === undefined ? ANSWER : scenario.answer }) };
      }
      if (cmd === "npx" && args[0] === "vitest") return scenario.testsFail && opts.cwd.startsWith(paths.jobsDir) ? { code: 1, out: " FAIL  test/notes.spec.ts > saves\n" } : ok;
      if (cmd === "npx" && args[0] === "wrangler") return scenario.deployFails ? { code: 1, out: "Authentication error" } : ok;
      return ok;
    },
    sweep: async (_base, opts = {}) => {
      const shots = [];
      if (opts.shotsDir) {
        mkdirSync(opts.shotsDir, { recursive: true });
        for (const [path, slug] of [["/notes/", "notes"], ["/portal/", "portal"], ["/agent/", "agent"]] as const) {
          for (const width of [390, 1280]) {
            const file = `${opts.prefix}-${slug}-${width}.png`;
            writeFileSync(join(opts.shotsDir, file), "png");
            shots.push({ name: slug, path, width, file });
          }
        }
        return { findings: (opts.prefix === "before" ? scenario.before : scenario.after) || [], shots };
      }
      return { findings: live ? scenario.liveAfter || [] : [], shots };
    },
    health: async (restarts) => ({ findings: w.healthFindings, restarts }),
    notify: async (title, message) => void notes.push({ title, message }),
    quests: () => w.quests,
    startServer: async () => ({ base: "http://job.test", stop: async () => {} }),
    now: () => w.now,
    sleep: async () => {},
    log: () => {},
  };
  const store = new FixerStore(join(root, "data", "fixer.json"));
  const fixer = new Fixer(store, paths, deps, { dry: options.dry === true, pcBase: "http://pc.test" });
  return Object.assign(w, { fixer, store, deps, make: () => new Fixer(store, paths, deps, { dry: options.dry === true, pcBase: "http://pc.test" }) });
}

// Until nothing is waiting or being prepared (or only waiting for tomorrow)
async function idle(f: Fixer) {
  for (let i = 0; i < 1000; i++) {
    const s = f.state();
    if (!s.running && !s.working.some((j) => j.status === "preparing" || j.status === "checking")) {
      await new Promise((r) => setTimeout(r, 5));
      if (!f.state().running) return;
    }
    await new Promise((r) => setTimeout(r, 3));
  }
  throw new Error("The Fixer never went quiet");
}

// What going live looks like: any of these in the log means something was merged, deployed or restarted
const LIVE = /\b(merge|rebase|revert|push|wrangler|systemctl --user restart|checkout -q --detach)\b/;
const wentLive = (log: string[]) => log.filter((l) => !l.startsWith("/fake/claude") && LIVE.test(l));

describe("nothing goes live without an admin's Approve", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`${name}: prepared, waits, and only Approve merges and deploys`, async () => {
      const w = world(scenario);
      const q = w.fixer.addQuest({ title: `Quest: ${name}`, details: "details", kind: "change", start: true }, ADMIN);
      await idle(w.fixer);
      const job = w.fixer.state().needsYou[0];
      expect(job, JSON.stringify(w.fixer.state().done)).toBeTruthy();
      expect(job.status).toBe("ready");
      expect(job.target.id).toBe(q.id);
      // Claude Code, the tests and the sweep ran; nothing was merged, deployed or restarted
      expect(w.log.some((l) => l.startsWith("/fake/claude -p"))).toBe(true);
      expect(wentLive(w.log)).toEqual([]);
      // Waiting longer, more checks, a fresh Fixer (a restart): still nothing
      await w.fixer.check("full");
      await w.make().resume();
      await idle(w.fixer);
      expect(wentLive(w.log)).toEqual([]);
      expect(w.fixer.state().needsYou).toHaveLength(1);

      // A forged approval, a staff member's tap, or the right shape without approve(): refused
      const forged = { jobId: job.id, by: "Ana", via: "pc", at: new Date().toISOString() };
      await expect(w.fixer.land(w.fixer.jobDetails(job.id), forged)).rejects.toThrow(/Not approved/);
      expect(() => w.fixer.approve(job.id, STAFF)).toThrow(/admin/);
      expect(wentLive(w.log)).toEqual([]);

      // Approve: merged into main, deployed if pages or Nova Bot changed, restarted if the server changed
      const { landing } = w.fixer.approve(job.id, ADMIN);
      const done = await landing;
      const live = wentLive(w.log);
      expect(live.some((l) => l.includes("merge --ff-only fixer/job-"))).toBe(true);
      const webOrNb = scenario.edits.some((e) => e.repo === "nb" || e.path.startsWith("web/"));
      expect(live.some((l) => l.includes("wrangler deploy"))).toBe(webOrNb);
      const src = scenario.edits.some((e) => e.repo === "na" && e.path.startsWith("src/"));
      expect(live.some((l) => l.includes("systemctl --user restart agent-nova.service"))).toBe(src);
      expect(done.status).toBe(src ? "restarting" : "done");
      expect(w.fixer.jobDetails(job.id).approval?.by).toBe("Ana");
    });
  }

  it("issues found by the hourly check: prepared by themselves, never merged by themselves", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.healthFindings = [];
    // The live sweep finds a glitch
    const sweep = w.deps.sweep;
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: [{ fingerprint: "sweep:/notes/:#:sideways", area: "sweep", severity: "minor", title: "Notes at 390px: The page scrolls sideways", detail: "", panel: "/notes/" }], shots: [] });
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().issues).toHaveLength(1);
    expect(w.fixer.state().needsYou).toHaveLength(1);
    for (let hour = 0; hour < 5; hour++) await w.fixer.hourly();
    await idle(w.fixer);
    expect(w.fixer.state().needsYou).toHaveLength(1);
    expect(wentLive(w.log)).toEqual([]);
  });

  it("Reject throws it away, and Ask for a tweak prepares it again with the note: neither goes live", async () => {
    const w = world(SCENARIOS["a change to how a panel works"]);
    w.fixer.addQuest({ title: "Make saving clearer", kind: "change", start: true }, ADMIN);
    await idle(w.fixer);
    const id = w.fixer.state().needsYou[0].id;
    w.fixer.tweak(id, "Keep the old wording", ADMIN);
    await idle(w.fixer);
    const again = w.fixer.jobDetails(id);
    expect(again.status).toBe("ready");
    expect(again.attempt).toBe(2);
    const brief = w.runs.filter((r) => r.cmd === "/fake/claude").pop()!.args[1];
    expect(brief).toContain("Ana: Keep the old wording");
    w.fixer.reject(id, ADMIN);
    expect(w.fixer.jobDetails(id).status).toBe("rejected");
    expect(w.log.some((l) => l.includes("worktree remove --force"))).toBe(true);
    expect(wentLive(w.log)).toEqual([]);
  });

  it("FIXER_DRY: nothing is prepared, merged or deployed (checks still run)", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"], { dry: true });
    expect(() => w.fixer.addQuest({ title: "x", start: true }, ADMIN)).toThrow(/inert/);
    w.healthFindings = [{ fingerprint: "health:disk-low", area: "health", severity: "serious", title: "Disk", detail: "" }];
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().issues).toHaveLength(1);
    expect(w.log.some((l) => l.startsWith("/fake/claude"))).toBe(false);
    expect(wentLive(w.log)).toEqual([]);
  });

  it("it never touches what's off limits: such a change is thrown away and never offered", async () => {
    const w = world({ edits: [{ repo: "na", path: ".env", added: 1, removed: 0 }, { repo: "na", path: "web/notes/css/app.css", added: 1, removed: 1 }], diff: { na: cssDiff() } });
    w.fixer.addQuest({ title: "Change the key", start: true }, ADMIN);
    await idle(w.fixer);
    const s = w.fixer.state();
    expect(s.needsYou).toHaveLength(0);
    expect(s.done[0].status).toBe("failed");
    expect(s.done[0].error).toMatch(/must never touch.*\.env/);
    expect(w.log.some((l) => / checkout -- \.$/.test(l))).toBe(true);
    expect(w.log.some((l) => / add -- /.test(l))).toBe(false);
    expect(wentLive(w.log)).toEqual([]);
  });
});

describe("Claude Code is confined", () => {
  it("headless, restricted, only file tools and the tests, never a skip-all-permissions flag", () => {
    const args = claudeArgs({ title: "t", details: "d", kind: "bug", notes: [], naDir: "/jobs/1/na", nbDir: "/jobs/1/nb" });
    expect(args[0]).toBe("-p");
    expect(args).toContain("--restricted");
    expect(args).toContain("acceptEdits");
    expect(args.join(" ")).not.toMatch(/dangerously|bypassPermissions|skip-permissions/);
    expect(args.slice(args.indexOf("--add-dir") + 1, args.indexOf("--add-dir") + 3)).toEqual(["/jobs/1/na", "/jobs/1/nb"]);
    const allowed = args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools"));
    expect(allowed.filter((a) => a.startsWith("Bash"))).toEqual(["Bash(npx vitest run)", "Bash(npx vitest run:*)", "Bash(npx tsc --noEmit)"]);
  });

  it("runs in the job's worktree, within the time limit, without Nova Agent's keys", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.setSettings({ timeLimitMinutes: 12 }, ADMIN);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const run = w.runs.find((r) => r.cmd === "/fake/claude")!;
    expect(run.opts.cwd.startsWith(w.paths.jobsDir)).toBe(true);
    expect(run.opts.timeoutMs).toBe(12 * 60_000);
    expect(run.opts.clean).toBe(true);
    expect(run.opts.env?.AGENT_NOVA_KEY).toBe("");
  });

  it("running out of time: the job fails and says so", async () => {
    const w = world({ ...SCENARIOS["a small CSS change (trivial)"], claudeTimesOut: true });
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    expect(w.fixer.state().done[0].error).toMatch(/ran out of time \(30 minutes\)/);
  });
});

describe("after going live: undo only when things got worse", () => {
  it("the decision", () => {
    expect(shouldRollBack([], []).rollBack).toBe(false);
    expect(shouldRollBack(["sweep:a"], ["sweep:a"]).rollBack).toBe(false);
    expect(shouldRollBack(["sweep:a", "sweep:b"], ["sweep:a"]).rollBack).toBe(false);
    expect(shouldRollBack(["sweep:a"], ["sweep:a", "sweep:new"])).toMatchObject({ rollBack: true });
    expect(shouldRollBack([], ["health:pc-server"]).reason).toMatch(/Nova Agent on the PC stopped answering/);
    expect(shouldRollBack(null, ["health:nova-bot"]).reason).toMatch(/Nova Bot stopped answering/);
  });

  it("worse after going live: undone by itself, deployed again, and the admins told once", async () => {
    const w = world({ ...SCENARIOS["a change to how a panel works"], liveAfter: [{ fingerprint: "sweep:/notes/:#:pageerror:boom", area: "sweep", severity: "serious", title: "Notes: script error", detail: "" }] });
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const id = w.fixer.state().needsYou[0].id;
    const notesBefore = w.notes.length;
    const job = await w.fixer.approve(id, ADMIN).landing;
    expect(job.status).toBe("rolled-back");
    expect(job.rollback?.reason).toMatch(/new serious problem/);
    expect(w.log.some((l) => l.includes("revert --no-commit sha"))).toBe(true);
    expect(w.log.filter((l) => l.includes("wrangler deploy"))).toHaveLength(2);
    expect(w.notes.slice(notesBefore).filter((n) => /undone/.test(n.title))).toHaveLength(1);
  });

  it("deploy failing three times: undone, never a fourth try", async () => {
    const w = world({ ...SCENARIOS["a small CSS change (trivial)"], deployFails: true });
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const job = await w.fixer.approve(w.fixer.state().needsYou[0].id, ADMIN).landing;
    expect(w.log.filter((l) => l.includes("wrangler deploy"))).toHaveLength(3);
    expect(job.status).toBe("rolled-back");
  });

  it("a server change restarts Nova Agent, and after the restart it's checked and finished", async () => {
    const w = world(SCENARIOS["a change to Nova Agent's server"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const id = w.fixer.state().needsYou[0].id;
    expect((await w.fixer.approve(id, ADMIN).landing).status).toBe("restarting");
    await w.make().resume();
    expect(w.fixer.jobDetails(id).status).toBe("done");
  });

  it("Undo (an admin's tap) reverts a fix that went live", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const id = w.fixer.state().needsYou[0].id;
    await w.fixer.approve(id, ADMIN).landing;
    expect(() => w.fixer.undo(id, STAFF)).toThrow(/admin/);
    const job = await w.fixer.undo(id, ADMIN).landing;
    expect(job.status).toBe("undone");
    expect(job.rollback?.by).toBe("Ana");
  });
});

describe("the approval card", () => {
  it("trivial CSS is labelled trivial, with every check passed and a recommendation", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const job = w.fixer.jobDetails(w.fixer.state().needsYou[0].id);
    const card = job.card!;
    expect(card.trivial).toBe(true);
    expect(card.allPassed).toBe(true);
    expect(card.recommendation.verdict).toBe("approve");
    expect(card.summary).toBe(ANSWER.summary);
    expect(card.consequences).toBe(ANSWER.consequences);
    expect(card.diff).toContain("flex-wrap: wrap");
    const notes = card.screens.filter((s) => s.path === "/notes/");
    expect(notes.map((s) => [s.width, s.before, s.after])).toEqual([[390, "before-notes-390.png", "after-notes-390.png"], [1280, "before-notes-1280.png", "after-notes-1280.png"]]);
    expect(w.fixer.shotFile(job.id, "after-notes-390.png")).toBeTruthy();
    expect(w.fixer.shotFile(job.id, "../fixer.json")).toBeNull();
  });

  it("failing tests: not all passed, and the recommendation is a tweak", async () => {
    const w = world(SCENARIOS["a change whose tests fail"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const card = w.fixer.jobDetails(w.fixer.state().needsYou[0].id).card!;
    expect(card.allPassed).toBe(false);
    expect(card.trivial).toBe(false);
    expect(card.recommendation.verdict).toBe("tweak");
  });

  it("a new problem in the sweep fails the sweep check", async () => {
    const w = world({ ...SCENARIOS["a small CSS change (trivial)"], after: [{ fingerprint: "sweep:/notes/:#:sideways", area: "sweep", severity: "minor", title: "Notes sideways", detail: "" }] });
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const card = w.fixer.jobDetails(w.fixer.state().needsYou[0].id).card!;
    expect(card.checks.find((c) => c.name.startsWith("Sweep"))?.ok).toBe(false);
  });

  it("the admins are pinged once when it's ready, never again", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    await w.fixer.check("full");
    await w.fixer.check("full");
    expect(w.notes.filter((n) => /ready/.test(n.title))).toHaveLength(1);
  });
});

describe("trivial: tiny CSS or on-screen wording only", () => {
  const f = (path: string, added = 1, removed = 1): FileChange => ({ repo: "na", path, added, removed });
  it("a small CSS change", () => expect(isTrivial([f("web/notes/css/app.css")], cssDiff())).toBe(true));
  it("a button's words", () => expect(isTrivial([f("web/portal/index.html")], wordingDiff)).toBe(true));
  it("not a change to how something works", () => expect(isTrivial([f("web/notes/js/app.js")], logicDiff)).toBe(false));
  it("not a class name or an attribute", () => {
    const d = wordingDiff.replace('+    <button type="button" class="btn">Submit</button>', '+    <button type="button" class="btn primary">Sumbit</button>');
    expect(isTrivial([f("web/portal/index.html")], d)).toBe(false);
  });
  it("not the server, tests or Nova Bot's code", () => {
    expect(isTrivial([f("src/quests/plan.ts", 2, 1)], srcDiff)).toBe(false);
    expect(isTrivial([{ repo: "nb", path: "src/portal/app.js", added: 1, removed: 1 }], nbDiff)).toBe(false);
  });
  it("not a big change, even CSS", () => expect(isTrivial([f("web/notes/css/app.css", 30, 10)], cssDiff())).toBe(false));
  it("not nothing", () => expect(isTrivial([], "")).toBe(false));
  it("a sentence in a script is wording; an address or a key isn't", () => {
    const js = (from: string, to: string) => `diff --git a/web/notes/js/app.js b/web/notes/js/app.js\n@@ -1,1 +1,1 @@\n-  toast(${from});\n+  toast(${to});\n`;
    expect(isTrivial([f("web/notes/js/app.js")], js("'Saved your nte'", "'Saved your note'"))).toBe(true);
    expect(isTrivial([f("web/notes/js/app.js")], js("'/api/a'", "'/api/b'"))).toBe(false);
    expect(isTrivial([f("web/notes/js/app.js")], js("'saved'", "'stored'"))).toBe(false);
  });
});

describe("off limits", () => {
  it("secrets, migrations, data, payments, emails, Acuity, the deploy setup and the Fixer itself", () => {
    const paths = [".env", "migrations/0042_x.sql", "data/quests.json", "src/stripe.js", "src/booking-emails.js", "src/acuity-api.ts", "package.json", "wrangler.jsonc", "src/fixer/fixer.ts", "web/fixer/app.js", "vps/mail/server.mjs", "node_modules/x/index.js"];
    expect(offLimits(paths.map((path) => ({ repo: "na", path })))).toHaveLength(paths.length);
    expect(offLimits([{ repo: "na", path: "web/notes/css/app.css" }, { repo: "na", path: "src/quests/plan.ts" }])).toEqual([]);
  });
});

describe("suggestions: quests that look like Nova Agent work", () => {
  const q = (title: string, notes = "") => ({ title, notes, from: "", id: title, status: "todo", priority: "normal" });
  it.each([
    "Fix the Notes toolbar overflow on phones",
    "Nova Agent: the send button sometimes does nothing",
    "Portal alerts tab is broken",
    "Calendar: add a dark mode toggle button",
    "Make the Observatory load faster",
  ])("%s", (title) => expect(looksLikeDevWork(q(title))).toBe(true));
  it.each(["Mix the EP", "Fix the kitchen tap", "Release 31: Midnight Drive", "Write notes for the session", "Buy groceries", "Call the dentist", "Book the calendar for March"])("not: %s", (title) =>
    expect(looksLikeDevWork(q(title))).toBe(false),
  );
  it("done, skipped, adopted and dismissed quests aren't suggested", () => {
    const list = [
      { id: "a", title: "Portal: fix the broken tab", notes: "", from: "Notes · Ideas", status: "todo", priority: "high" },
      { id: "b", title: "Portal: fix the broken tab", notes: "", from: "", status: "done", priority: "high" },
      { id: "c", title: "Notes panel glitch on scroll", notes: "", from: "", status: "todo", priority: "low" },
      { id: "d", title: "Nova Agent crashes", notes: "", from: "", status: "todo", priority: "low" },
    ];
    const s = suggestions(list, ["c"], ["d"]);
    expect(s.map((x) => x.questId)).toEqual(["a"]);
    expect(s[0]).toMatchObject({ kind: "bug", from: "Notes · Ideas" });
  });
  it("an admin adopts one (never automatically)", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"], { quests: [{ id: "q1", title: "Notes toolbar glitch on phones", notes: "hangs off", from: "Notes · Ideas", status: "todo", priority: "high" }] });
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().quests).toHaveLength(0);
    expect(w.fixer.state().suggestions.map((s) => s.questId)).toEqual(["q1"]);
    expect(() => w.fixer.adopt("q1", STAFF)).toThrow(/admin/);
    const quest = w.fixer.adopt("q1", ADMIN);
    expect(quest).toMatchObject({ title: "Notes toolbar glitch on phones", kind: "glitch", priority: "high", from: "quest:q1", status: "open" });
    expect(w.fixer.state().suggestions).toHaveLength(0);
    expect(w.fixer.state().working).toHaveLength(0);
  });
});

describe("one job at a time, and the daily cap", () => {
  it("never two at once; the cap holds the rest until the next day", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.setSettings({ dailyCap: 2 }, ADMIN);
    for (const t of ["one", "two", "three"]) w.fixer.addQuest({ title: t, start: true }, ADMIN);
    await idle(w.fixer);
    expect(w.claudeMax).toBe(1);
    expect(w.fixer.state().needsYou).toHaveLength(2);
    expect(w.fixer.state().working.map((j) => j.status)).toEqual(["queued"]);
    expect(w.fixer.state().today).toEqual({ prepared: 2, cap: 2 });
    expect(w.fixer.state().activity.some((a) => /limit of 2/.test(a.text))).toBe(true);
    w.now = new Date("2026-10-12T09:00:00Z");
    await w.fixer.pump();
    await idle(w.fixer);
    expect(w.fixer.state().needsYou).toHaveLength(3);
    expect(w.claudeMax).toBe(1);
  });
});

describe("settings are respected", () => {
  it("hourly checks off: the hour passes without a check", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.setSettings({ hourlyChecks: false }, ADMIN);
    await w.fixer.hourly();
    expect(w.log).toEqual([]);
    w.fixer.setSettings({ hourlyChecks: true }, ADMIN);
    await w.fixer.hourly();
    expect(w.log.some((l) => l.includes("vitest run"))).toBe(true);
    expect(w.log.some((l) => l.includes("audio-levels"))).toBe(true);
  });

  it("preparing fixes by itself off: new problems are listed, nothing is prepared", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.setSettings({ autoPrepare: false }, ADMIN);
    const sweep = w.deps.sweep;
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: [{ fingerprint: "sweep:x", area: "sweep", severity: "serious", title: "x", detail: "" }], shots: [] });
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().issues).toHaveLength(1);
    expect(w.fixer.state().working).toHaveLength(0);
    expect(w.notes.filter((n) => /problem/.test(n.title))).toHaveLength(1);
    // An admin can still ask for one
    w.fixer.prepareIssue(w.fixer.state().issues[0].id, ADMIN);
    await idle(w.fixer);
    expect(w.fixer.state().needsYou).toHaveLength(1);
  });

  it("health problems aren't something code fixes: listed and told, not prepared", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.healthFindings = [{ fingerprint: "health:nova-bot", area: "health", severity: "serious", title: "Nova Bot isn't answering", detail: "" }];
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().working).toHaveLength(0);
    expect(w.notes).toHaveLength(1);
    // the same problem next hour: no second ping
    await w.fixer.check("full");
    expect(w.notes).toHaveLength(1);
    // gone, then back: it's new again
    w.healthFindings = [];
    await w.fixer.check("full");
    expect(w.fixer.state().issues).toHaveLength(0);
  });

  it("the scripted checks: kept with every result; server fails are told, never prepared; code fails get a fix", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    const results = [
      { group: "Server", name: "Mail queue", area: "server" as const, ok: false, detail: "60 emails waiting to go", severity: "serious" as const, ms: 3 },
      { group: "Addresses", name: "Privacy", area: "checks" as const, ok: true, detail: "200", severity: "serious" as const, ms: 5 },
    ];
    w.deps.probes = async () => results;
    w.fixer.setSettings({ autoPrepare: false }, ADMIN);
    await w.fixer.check("checks");
    await idle(w.fixer);
    let s = w.fixer.state();
    expect(s.checks!.results).toHaveLength(2);
    expect(s.issues.map((i) => [i.area, i.title])).toEqual([["server", "Server: Mail queue: 60 emails waiting to go"]]);
    expect(s.lastCheck).toBeNull(); // (only the quick checks ran)
    expect(w.notes).toHaveLength(1);
    // automatic fixes on: a server problem still isn't prepared, a code one is
    w.fixer.setSettings({ autoPrepare: true }, ADMIN);
    w.deps.probes = async () => [...results, { group: "Manual", name: "Links to Nova's pages", area: "checks" as const, ok: false, detail: "broken: /gone (404)", severity: "minor" as const, ms: 9 }];
    await w.fixer.check("checks");
    await idle(w.fixer);
    s = w.fixer.state();
    const manual = s.issues.find((i) => i.area === "checks")!;
    expect(manual.jobId).not.toBe("");
    expect(s.issues.find((i) => i.area === "server")!.jobId).toBe("");
    // passing again clears them; a quick check (sweep and health) leaves them alone
    w.deps.probes = async () => results.map((r) => ({ ...r, ok: true }));
    await w.fixer.check("quick");
    expect(w.fixer.state().issues.some((i) => i.area === "server")).toBe(true);
    await w.fixer.check("checks");
    expect(w.fixer.state().issues.filter((i) => i.area === "server" || i.area === "checks")).toHaveLength(0);
  });

  it("settings are kept within sensible limits, and only admins change them", () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    expect(w.fixer.setSettings({ dailyCap: 999, timeLimitMinutes: 1 }, ADMIN)).toMatchObject({ dailyCap: 50, timeLimitMinutes: 5 });
    expect(() => w.fixer.setSettings({ dailyCap: 3 }, STAFF)).toThrow(/admin/);
  });
});

describe("issues: one per fingerprint, cleared when gone", () => {
  it("merging", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const a: Finding = { fingerprint: "sweep:a", area: "sweep", severity: "minor", title: "A", detail: "" };
    const t: Finding = { fingerprint: "tests:na", area: "tests", severity: "serious", title: "T", detail: "" };
    const first = mergeIssues([], [a, a, t], ["sweep", "tests"], now);
    expect(first.fresh).toHaveLength(2);
    const second = mergeIssues(first.issues, [a], ["sweep", "health"], now);
    expect(second.fresh).toHaveLength(0);
    expect(second.issues.map((i) => i.fingerprint).sort()).toEqual(["sweep:a", "tests:na"]);
    expect(second.issues.find((i) => i.fingerprint === "sweep:a")!.seenCount).toBe(2);
    const third = mergeIssues(second.issues, [], ["sweep", "tests"], now);
    expect(third.issues).toHaveLength(0);
    expect(third.cleared).toHaveLength(2);
  });
});

describe("the Fixer's addresses are for admins", () => {
  function app(w: ReturnType<typeof world>) {
    const a = new Hono();
    registerFixerRoutes(a, () => w.fixer);
    return a;
  }
  const relayed = (path: string, role: string, init: RequestInit = {}) =>
    new Request(`http://online.nova-agent.invalid${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Nova-Visualizer": "1", "X-Nova-Online": "Ana", "X-Nova-Online-Role": role, ...(init.headers || {}) } });

  it("online: an admin, yes; staff, no; and the link's rules agree", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    const a = app(w);
    expect((await a.fetch(relayed("/fixer-api/state", "admin"))).status).toBe(200);
    expect((await a.fetch(relayed("/fixer-api/state", "staff"))).status).toBe(403);
    expect((await a.fetch(relayed("/fixer-api/state", ""))).status).toBe(403);
    const add = await a.fetch(relayed("/actions/fixer/quests", "staff", { method: "POST", body: JSON.stringify({ title: "x" }) }));
    expect(add.status).toBe(403);
    expect(w.fixer.state().quests).toHaveLength(0);
    const ok = await a.fetch(relayed("/actions/fixer/quests", "admin", { method: "POST", body: JSON.stringify({ title: "Notes glitch" }) }));
    expect((await ok.json()).result.by).toBe("Ana");
    // src/relay.ts's own lock: the Fixer's addresses only for admins
    expect(relayAllowed("GET", "/fixer-api/state", { id: "s", role: "staff" })).toBe(false);
    expect(relayAllowed("GET", "/fixer-api/state", { id: "a", role: "admin" })).toBe(true);
    expect(relayAllowed("POST", "/actions/fixer/jobs/j-1", { id: "s", role: "staff" })).toBe(false);
    expect(relayAllowed("POST", "/actions/fixer/jobs/j-1", { id: "a", role: "admin" })).toBe(true);
    expect(relayAllowed("GET", "/fixer-api/shots/j-1/../x.png", { id: "a", role: "admin" })).toBe(false);
  });

  it("a look-alike can't pretend to be relayed, and other websites can't tap", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    const spoof = new Request("http://localhost:4545/fixer-api/state", { headers: { host: "evil.example", "X-Nova-Online": "x", "X-Nova-Online-Role": "admin" } });
    expect(actorFor(spoof)).toBeNull();
    const pc = new Request("http://localhost:4545/fixer-api/state", { headers: { host: "localhost:4545" } });
    expect(actorFor(pc)).toMatchObject({ admin: true, via: "pc" });
    const foreign = new Request("http://localhost:4545/actions/fixer/settings", { method: "POST", headers: { host: "localhost:4545", origin: "https://evil.example" } });
    expect(actorFor(foreign)).toBeNull();
    const a = app(w);
    expect((await a.fetch(foreign)).status).toBe(403);
  });

  it("an online admin's Approve goes through the same lock", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.addQuest({ title: "x", start: true }, ADMIN);
    await idle(w.fixer);
    const id = w.fixer.state().needsYou[0].id;
    const a = app(w);
    expect((await a.fetch(relayed(`/actions/fixer/jobs/${id}`, "staff", { method: "POST", body: JSON.stringify({ action: "approve" }) }))).status).toBe(403);
    expect(wentLive(w.log)).toEqual([]);
    const res = await a.fetch(relayed(`/actions/fixer/jobs/${id}`, "admin", { method: "POST", body: JSON.stringify({ action: "approve" }) }));
    expect(res.status).toBe(200);
    for (let i = 0; i < 200 && w.fixer.jobDetails(id).status !== "done"; i++) await new Promise((r) => setTimeout(r, 5));
    expect(w.fixer.jobDetails(id).approval).toMatchObject({ by: "Ana", via: "online" });
  });
});

describe("fixer.json: old, odd or damaged files are safe", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "fixer-store-"));
  it("an older file (fields missing) loads with the defaults", () => {
    const d = normaliseFixer({ version: 1, issues: [{ fingerprint: "a", title: "A" }], jobs: [{ id: "j1", status: "ready" }] });
    expect(d.settings).toEqual({ hourlyChecks: true, autoPrepare: true, dailyCap: 10, timeLimitMinutes: 30 });
    expect(d.issues[0]).toMatchObject({ fingerprint: "a", severity: "minor", seenCount: 1, notified: false });
    expect(d.jobs[0]).toMatchObject({ id: "j1", status: "ready", attempt: 1, approval: null, landed: { na: null, nb: null } });
  });
  it("odd values are put right, unknown states don't count as approved", () => {
    const d = normaliseFixer({ settings: { dailyCap: "lots", timeLimitMinutes: 9999, hourlyChecks: "yes" }, jobs: [{ id: "../x", status: "ready" }, { id: "j2", status: "merged-by-magic", approval: "yes" }], issues: [{ title: "no fingerprint" }] });
    expect(d.settings).toMatchObject({ dailyCap: 10, timeLimitMinutes: 120, hourlyChecks: true });
    expect(d.jobs.map((j) => j.id)).toEqual(["j2"]);
    expect(d.jobs[0]).toMatchObject({ status: "failed", approval: null });
    expect(d.issues).toEqual([]);
  });
  it("a damaged file goes back to the last good copy, and the damaged one is kept", () => {
    const root = dir();
    const store = new FixerStore(join(root, "fixer.json"));
    store.update((d) => void d.quests.push({ id: "q", title: "Keep me", details: "", kind: "bug", priority: "normal", from: "", status: "open", jobId: "", by: "Ana", created: "", updated: "" }));
    writeFileSync(join(root, "fixer.json"), "{ not json");
    const back = store.read();
    expect(back.quests.map((q) => q.title)).toEqual(["Keep me"]);
    expect(back.activity.some((a) => /damaged/.test(a.text))).toBe(true);
    expect(readdirSync(root).some((f) => f.startsWith("fixer.json.damaged-"))).toBe(true);
  });
  it("damaged with no good copy: starts afresh, the damaged one still kept", () => {
    const root = dir();
    writeFileSync(join(root, "fixer.json"), "garbage");
    const d = new FixerStore(join(root, "fixer.json")).read();
    expect(d.jobs).toEqual([]);
    expect(readdirSync(root).filter((f) => f.startsWith("fixer.json.damaged-"))).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(root, "fixer.json"), "utf8")).version).toBe(1);
  });
  it("a job interrupted mid-way through going live is never carried on by itself", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.store.update((d) => {
      d.jobs.push(normaliseFixer({ jobs: [{ id: "j9", status: "landing", target: { title: "t" } }] }).jobs[0]);
    });
    await w.make().resume();
    expect(w.fixer.jobDetails("j9").status).toBe("blocked");
    expect(wentLive(w.log)).toEqual([]);
    expect(existsSync(w.paths.jobsDir)).toBe(false);
  });
});

// ---- The same problem in several places is one problem ----
describe("one problem, wherever it's seen", () => {
  const seen = (place: string, panel: string, width: number): Finding => ({
    fingerprint: "sweep:asset:a file didn't load: /staff/x/planet.svg (#)",
    area: "sweep",
    severity: "serious",
    title: `${place} at ${width}px: a file didn't load: /staff/x/planet.svg (404)`,
    detail: "",
    panel,
    panels: [panel],
    place: `${place} at ${width}px`,
    problem: "a file didn't load: /staff/x/planet.svg (404)",
    aliases: [`sweep:${panel}:${width}:asset:a file didn't load: /staff/x/planet.svg (#)`],
  });
  const three = [seen("Notes", "/notes/", 390), seen("Index", "/app/memory/", 390), seen("Observatory", "/observatory/", 390)];

  it("grouped into one finding that says where it was seen", () => {
    const g = groupFindings(three);
    expect(g).toHaveLength(1);
    expect(g[0].title).toBe("a file didn't load: /staff/x/planet.svg (404) · on Notes, Index and Observatory at 390px");
    expect(g[0].panels).toEqual(["/notes/", "/app/memory/", "/observatory/"]);
    expect(g[0].aliases).toHaveLength(3);
    expect(placesText(["Notes at 390px", "Index at 390px", "Notes at 1280px"])).toBe("Notes and Index at 390px; Notes at 1280px");
  });

  it("the hourly check makes one issue and prepares one fix for it", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    const sweep = w.deps.sweep;
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: groupFindings(three), shots: [] });
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().issues).toHaveLength(1);
    expect(w.fixer.state().needsYou).toHaveLength(1);
    expect(w.notes.filter((n) => /problem/.test(n.title))).toHaveLength(1);
  });

  it("issues saved one per place (older fingerprints) carry on as the grouped one: same id, same fix, not told again", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const before = mergeIssues([], three.map((f) => ({ ...f, fingerprint: f.aliases![0], title: f.title })), ["sweep"], now);
    before.issues.forEach((i) => (i.notified = true));
    before.issues[0].jobId = "job-1";
    const after = mergeIssues(before.issues, groupFindings(three), ["sweep"], now);
    expect(after.fresh).toHaveLength(0);
    expect(after.issues).toHaveLength(1);
    expect(after.issues[0]).toMatchObject({ id: before.issues[0].id, jobId: "job-1", notified: true });
    expect(after.cleared).toHaveLength(2);
  });

  it("a fix whose problem has gone is closed by itself, not left blocked", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.store.update((d) => {
      d.jobs.push(normaliseFixer({ jobs: [{ id: "jb", status: "blocked", target: { type: "issue", id: "gone-issue", title: "Notes at 390px: a file didn't load" }, error: "main has changed" }] }).jobs[0]);
      d.jobs.push(normaliseFixer({ jobs: [{ id: "jq", status: "ready", target: { type: "quest", id: "q1", title: "A fixer quest" } }] }).jobs[0]);
    });
    await w.fixer.check("full");
    expect(w.fixer.jobDetails("jb").status).toBe("closed");
    expect(w.fixer.state().done.some((j) => j.id === "jb")).toBe(true);
    expect(w.fixer.state().working.some((j) => j.id === "jb")).toBe(false);
    // a fixer quest's fix isn't touched (it's not about a problem the check sees)
    expect(w.fixer.jobDetails("jq").status).toBe("ready");
    expect(wentLive(w.log)).toEqual([]);
  });
});

// ---- Nova Bot blips ----
describe("Nova Bot not answering for a moment isn't a problem", () => {
  const down: Finding = { fingerprint: "health:nova-bot", area: "health", severity: "serious", title: "Nova Bot isn't answering", detail: "fetch failed" };
  const gateway: Finding = { fingerprint: "sweep:asset:a file didn't load: /music-world/img (#)", area: "sweep", severity: "serious", title: "Nova Agent at 1280px: a file didn't load: /music-world/img (502)", detail: "", panel: "/agent/", panels: ["/agent/"], blip: true };

  it("seen once, then answering again: no problem, no ping, no fix", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    let calls = 0;
    w.deps.health = async (restarts) => ({ findings: calls++ === 0 ? [down] : [], restarts });
    const sweep = w.deps.sweep;
    const looked: unknown[] = [];
    let sweeps = 0;
    w.deps.sweep = async (base, opts) => {
      if (opts?.shotsDir) return sweep(base, opts);
      looked.push(opts?.screens);
      return { findings: sweeps++ === 0 ? [gateway] : [], shots: [] };
    };
    const slept: number[] = [];
    w.deps.sleep = async (ms) => void slept.push(ms);
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(w.fixer.state().issues).toHaveLength(0);
    expect(w.notes).toHaveLength(0);
    expect(w.fixer.state().working).toHaveLength(0);
    // checked again after a wait, only the panel where it was seen
    expect(slept.length).toBeGreaterThanOrEqual(1);
    expect(looked[1]).toEqual([{ name: "Nova Agent", path: "/agent/" }]);
  });

  it("still down after every try: a problem (told once), but never a fix prepared", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.healthFindings = [down];
    const sweep = w.deps.sweep;
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: [gateway], shots: [] });
    let tries = 0;
    w.deps.sleep = async () => void tries++;
    await w.fixer.check("full");
    await idle(w.fixer);
    expect(tries).toBe(3);
    const issues = w.fixer.state().issues;
    expect(issues.map((i) => i.fingerprint).sort()).toEqual([gateway.fingerprint, down.fingerprint].sort());
    expect(issues.every((i) => i.blip)).toBe(true);
    expect(w.fixer.state().working).toHaveLength(0);
    expect(w.fixer.state().needsYou).toHaveLength(0);
    // and gone at the next check that passes
    w.healthFindings = [];
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: [], shots: [] });
    await w.fixer.check("full");
    expect(w.fixer.state().issues).toHaveLength(0);
  });

  it("a missing file (404) is a real problem straight away: no waiting", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    w.fixer.setSettings({ autoPrepare: false }, ADMIN);
    const sweep = w.deps.sweep;
    w.deps.sweep = async (base, opts) => (opts?.shotsDir ? sweep(base, opts) : { findings: [{ ...gateway, blip: false, title: "Nova Agent at 1280px: a file didn't load: /x.png (404)" }], shots: [] });
    let tries = 0;
    w.deps.sleep = async () => void tries++;
    await w.fixer.check("full");
    expect(tries).toBe(0);
    expect(w.fixer.state().issues).toHaveLength(1);
  });
});

// Nova Agent on the server (vps/agent-switch.sh in Nova Bot): the system service is restarted, and
// without Claude Code signed in there a fix isn't prepared (and says why)
describe("the Fixer on the server", () => {
  it("restarts nova-agent.service (through its one sudo rule), not the PC's user service", async () => {
    const w = world(SCENARIOS["a change to Nova Agent's server"]);
    const f = new Fixer(w.store, w.fixer.paths, w.deps, { dry: false, pcBase: "http://pc.test", restart: SERVER_RESTART });
    f.addQuest({ title: "Quest: server change", details: "details", kind: "change", start: true }, ADMIN);
    await idle(f);
    const job = f.state().needsYou[0];
    expect(job.status).toBe("ready");
    const done = await f.approve(job.id, ADMIN).landing;
    expect(done.status).toBe("restarting");
    expect(w.log.some((l) => l.includes("sudo -n systemctl restart nova-agent.service"))).toBe(true);
    expect(w.log.some((l) => l.includes("systemctl --user restart"))).toBe(false);
  });

  it("says plainly when Claude Code isn't signed in on the server", async () => {
    const w = world(SCENARIOS["a small CSS change (trivial)"]);
    const f = new Fixer(w.store, w.fixer.paths, w.deps, { dry: false, pcBase: "http://pc.test", claudeProblem: () => "Claude Code isn't signed in on the server." });
    f.addQuest({ title: "Quest: needs Claude", details: "details", kind: "change", start: true }, ADMIN);
    await idle(f);
    const job = f.state().done.find((j) => j.target.title === "Quest: needs Claude") || f.state().needsYou.find((j) => j.target.title === "Quest: needs Claude");
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/isn't signed in on the server/);
    expect(w.log.some((l) => l.startsWith("/fake/claude"))).toBe(false);
  });
});
