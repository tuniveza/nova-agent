import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { ansiToHtml, computerState, forgetKept, handoffTop, readJobs, redact, registerComputerRoutes, Sampler, secretValues, type ComputerDeps } from "../src/computer";

const RELAY = "http://online.nova-agent.invalid";

function deps(over: Partial<ComputerDeps> = {}): ComputerDeps {
  const files: Record<string, string> = {
    "/w/logs/20261014-145538-android-pass.log": "step one\nANTHROPIC_API_KEY=abc123secretvalue\nall good\n=== DONE 2026-10-14T16:00:00Z exit 0\n",
    "/w/logs/20261014-145538-android-pass.log.task": "Carry on with the Android pass",
    "/w/logs/20261014-170000-fixer-cards.log": "",
    "/w/logs/20261014-170000-fixer-cards.log.task": "Redesign the Fixer cards",
    "/w/HANDOFF.md": "# Handoff\n\n## 2026-10-14 (from the VPS)\nAndroid pass: half done.\nKey sk-ant-abcdefghijklmnop seen.\n\n## Older\nold stuff\n",
    "/proc/stat": "cpu  100 0 100 800 0 0 0 0 0 0\n",
    "/proc/meminfo": "MemTotal:       6000000 kB\nMemAvailable:   4000000 kB\n",
  };
  const run: ComputerDeps["run"] = async (cmd, args) => {
    if (cmd === "tmux" && args[0] === "list-windows") return { ok: true, out: "nova-vps\t0\tclaude\t1\nnova-jobs\t0\tidle\t0\nnova-jobs\t1\tfixer-cards\t1\n" };
    if (cmd === "tmux" && args[0] === "capture-pane") {
      const t = args[args.indexOf("-t") + 1];
      return { ok: true, out: t === "nova-vps:0" ? "\x1b[32m·✔︎· Connected\x1b[0m · work\nBearer abcdefghijklmnopqrstuv\n" : "working on cards\n" };
    }
    if (cmd === "claude") return { ok: true, out: "2.1.299 (Claude Code)\n" };
    if (cmd === "systemctl") return { ok: true, out: "active\nactive\nactive\nactive\nfailed\n" };
    if (cmd === "git") return { ok: true, out: args[1] === "/na" ? "abc1234\t2026-10-14T16:10:00+01:00\tNova Agent change\n" : "def5678\t2026-10-14T16:20:00+01:00\tNova Bot change\n" };
    return { ok: false, out: "" };
  };
  return {
    onServer: true,
    run,
    read: (f) => files[f] ?? null,
    list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir + "/")).map((f) => f.slice(dir.length + 1)),
    now: () => Date.parse("2026-10-14T16:30:00Z"),
    workDir: "/w",
    repos: [
      { name: "Nova Agent", dir: "/na" },
      { name: "Nova Bot", dir: "/nb" },
    ],
    fetchJson: async (url) => (url.includes("status") ? { ok: true, overall: "Everything's working", parts: [{ id: "chat", name: "Website chat", state: "green", text: "Answering" }] } : { lastBackup: "2026-10-14T03:30:07Z", backups: [{}, {}] }),
    statusUrl: "https://nova.example/status.json",
    deskUrl: "http://127.0.0.1:8788/desk",
    deskToken: "t",
    secrets: () => ["abc123secretvalue"],
    fixer: () => ({ needsYou: 2, lastCheck: "2026-10-14T16:00:00Z", looksAt: "2026-10-14T15:00:00Z", looksFailed: 3, claude: "" }),
    claudeProblem: () => "",
    sampler: new Sampler((f) => files[f] ?? null, () => Date.parse("2026-10-14T16:30:00Z")),
    ...over,
  };
}

describe("Computer: secrets never leave", () => {
  it("hides the computer's own key values and things shaped like keys", () => {
    const out = redact("key=abc123secretvalue sk-ant-api03-xyzxyzxyz Bearer abcdefghijkl AGENT_NOVA_KEY=zzzz token: 1234567 " + "aB3".repeat(16) + " " + "f0".repeat(20), ["abc123secretvalue"]);
    expect(out).not.toContain("abc123secretvalue");
    expect(out).not.toContain("xyzxyzxyz");
    expect(out).not.toContain("abcdefghijkl");
    expect(out).not.toContain("zzzz");
    expect(out).not.toContain("1234567");
    expect(out).not.toContain("aB3".repeat(16));
    expect(out).not.toContain("f0".repeat(20));
    expect(out).toContain("•••");
  });
  it("leaves ordinary words, short git hashes and paths alone", () => {
    const text = "Committed 4ddd402 to main in /srv/nova-agent/work/logs/20261014-145538-android-pass-and-more.log — 474 tests passed";
    expect(redact(text)).toBe(text);
  });
  it("finds secret values only under secret-looking names", () => {
    expect(secretValues({ ANTHROPIC_API_KEY: "sk-123456", NOVA_MODEL: "claude-opus", ACUITY_PASSWORD: "hunter22", SHORT_KEY: "abc" })).toEqual(["sk-123456", "hunter22"]);
  });
});

describe("Computer: terminal colours", () => {
  it("turns colour codes into spans and escapes the text", () => {
    const html = ansiToHtml("\x1b[1;32mok\x1b[0m <b>&\x1b[38;5;208m!\x1b[38;2;1;2;3m?\x1b[0m");
    expect(html).toContain('<span class="c2 bo">ok</span>');
    expect(html).toContain("&lt;b&gt;&amp;");
    expect(html).toContain('style="color:rgb(255,135,0)"');
    expect(html).toContain('style="color:rgb(1,2,3)"');
    expect(html).not.toContain("\x1b");
  });
  it("drops cursor moves and titles", () => {
    expect(ansiToHtml("a\x1b[2K\x1b[1Gb\x1b]0;title\x07c")).toBe("abc");
  });
  it("never lets markup through, even split across colours", () => {
    expect(ansiToHtml("<scr\x1b[31mipt>alert(1)</script>")).not.toMatch(/<script/i);
  });
});

describe("Computer: jobs and the handoff", () => {
  it("reads each job: running or done, how long, its task, its last words (redacted)", () => {
    const jobs = readJobs(deps());
    expect(jobs.map((j) => j.name)).toEqual(["fixer-cards", "android-pass"]);
    const done = jobs[1];
    expect(done.running).toBe(false);
    expect(done.exit).toBe(0);
    expect(done.seconds).toBe(3862);
    expect(done.task).toBe("Carry on with the Android pass");
    expect(done.tail).not.toContain("abc123secretvalue");
    expect(done.tail).not.toContain("=== DONE");
    expect(jobs[0].running).toBe(true);
  });
  it("takes HANDOFF.md's newest section", () => {
    expect(handoffTop("# H\n\n## New\nline 1\n\n## Old\nx")).toEqual({ heading: "New", text: "line 1" });
    expect(handoffTop(null)).toBeNull();
  });
});

describe("Computer: the whole state", () => {
  it("has the screen, Claude Code, the VPS and Nova, with no secrets", async () => {
    forgetKept();
    const s: any = await computerState(deps());
    expect(s.ok).toBe(true);
    expect(s.onServer).toBe(true);
    expect(s.screens.map((x: any) => x.id)).toEqual(["nova-vps:0", "nova-jobs:1"]);
    expect(s.screens[0].html).toContain('<span class="c2">');
    expect(s.claude).toMatchObject({ version: "2.1.299 (Claude Code)", signedIn: true, remote: true, running: 1, finishedToday: 1 });
    expect(s.claude.handoff.heading).toBe("2026-10-14 (from the VPS)");
    expect(s.vps.services.find((x: any) => x.id === "postfix").state).toBe("failed");
    expect(s.vps.memory.total).toBe(6000000 * 1024);
    expect(s.suite.parts[0]).toMatchObject({ name: "Website chat", state: "green" });
    expect(s.suite.deploys.map((d: any) => d.hash)).toEqual(["def5678", "abc1234"]);
    expect(s.suite.fixer.needsYou).toBe(2);
    expect(s.suite.backup.last).toBe("2026-10-14T03:30:07Z");
    const all = JSON.stringify(s);
    for (const secret of ["abc123secretvalue", "abcdefghijklmnopqrstuv", "sk-ant-abcdefghijklmnop"]) expect(all).not.toContain(secret);
  });
  it("on the studio PC only says to open it on the VPS's Nova", async () => {
    const s: any = await computerState(deps({ onServer: false }));
    expect(s.onServer).toBe(false);
    expect(s.message).toMatch(/VPS's Nova/);
    expect(s.screens).toBeUndefined();
  });
});

describe("Computer: admins only", () => {
  const app = new Hono();
  registerComputerRoutes(app, () => deps());
  it("refuses someone online who isn't an admin, and anyone unknown", async () => {
    const staff = await app.request(`${RELAY}/computer-api/state`, { headers: { "x-nova-online": "Sam", "x-nova-online-role": "staff" } });
    expect(staff.status).toBe(403);
    const nobody = await app.request("http://example.com/computer-api/state");
    expect(nobody.status).toBe(403);
  });
  it("answers an admin online", async () => {
    forgetKept();
    const res = await app.request(`${RELAY}/computer-api/state`, { headers: { "x-nova-online": "Alex", "x-nova-online-role": "admin" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.screens)).toBe(true);
  });
});
