// Console (web/console/): the Nova commands (web/console/js/commands.js: reading a line, finishing
// words, permissions, approvals that ask for the number to be typed back) and the PC side
// (src/console.ts): terminals only for admins on the studio computer itself, never online, the
// VPS's address checked, each terminal's token.
//   Run: npm test
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, shutdown } from "./harness";
import * as Nova from "../web/console/js/commands.js";

afterEach(shutdown);

// A stand-in for the page: records what was asked of Nova Agent and what was printed
function fakeCtx({ role = "admin", answers = {} as Record<string, unknown>, typed = "" } = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const printed: string[] = [];
  const ctx: any = {
    me: { id: "ana", name: "Ana", role, online: false },
    api: async (path: string, opts: { method?: string; body?: unknown } = {}) => {
      calls.push({ path, method: opts.method || "GET", body: opts.body });
      const hit = Object.entries(answers).find(([k]) => path.startsWith(k));
      if (!hit) {
        const e: any = new Error("not here");
        e.status = 404;
        throw e;
      }
      return typeof hit[1] === "function" ? (hit[1] as any)(path, opts) : hit[1];
    },
    print: (t: string) => printed.push(t),
    ok: (t: string) => printed.push("ok: " + t),
    warn: (t: string) => printed.push("warn: " + t),
    error: (t: string) => printed.push("error: " + t),
    dim: (t: string) => printed.push("dim: " + t),
    table: (rows: unknown[]) => printed.push("table:" + JSON.stringify(rows)),
    heading: (t: string) => printed.push("heading: " + t),
    kv: (rows: unknown[]) => printed.push("kv:" + JSON.stringify(rows)),
    help: (groups: { title: string; rows: unknown[] }[]) => printed.push("help:" + groups.map((g) => `${g.title}(${g.rows.length})`).join(",")),
    ask: async (q: string) => {
      printed.push("ask: " + q);
      return typed;
    },
    open: (p: string) => printed.push("open: " + p),
    terminal: async (k: string) => printed.push("terminal: " + k),
    clear: () => {},
    history: () => [],
  };
  return { ctx, calls, printed };
}

describe("reading what's typed", () => {
  it("splits words, keeps quoted words together and reads --flags", () => {
    expect(Nova.tokenize(`quests add "Mix the EP" --minutes 45`)).toEqual(["quests", "add", "Mix the EP", "--minutes", "45"]);
    expect(Nova.parse(`agent 'what''s on' --x`)).toEqual({ name: "agent", args: ["whats on"], flags: { x: true } });
    expect(() => Nova.tokenize(`agent "unclosed`)).toThrow(/quote/);
  });
  it("finishes commands and their parts with Tab", () => {
    expect(Nova.complete("qu")).toEqual(["quests"]);
    expect(Nova.complete("quests s")).toEqual(["start", "skip", "snooze"]);
    expect(Nova.complete("portal en")).toEqual(["enquiries"]);
    expect(Nova.complete("open bo")).toEqual(["board"]);
  });
  it("explains a command that doesn't exist, and suggests the one meant", async () => {
    const { ctx } = fakeCtx();
    await expect(Nova.run(ctx, "qeusts")).rejects.toThrow(/There's no "qeusts". Did you mean quests\?/);
    await expect(Nova.run(ctx, "stauts")).rejects.toThrow(/Did you mean status\?/);
  });
  it("knows other words people type", async () => {
    const { ctx, calls } = fakeCtx({ answers: { "/app/api/enquiries": { enquiries: [] } } });
    await Nova.run(ctx, "inbox");
    expect(calls.some((c) => c.path === "/app/api/enquiries")).toBe(true);
    // Desk is called Computer now; the old word still works
    expect(Nova.resolveName("desk")).toBe("computer");
    expect(Nova.resolveName("server")).toBe("computer");
  });
  it("computer shows the VPS only: where Nova Agent runs, how to move it, and any warnings", async () => {
    const here = { url: "https://x", agentSwitch: { to: "vps/agent-switch.sh", back: "vps/agent-switch-back.sh" }, warnings: ["Newsletters won't send"], pc: { connected: true, where: "server" }, jobs: [] };
    const { ctx, printed } = fakeCtx({ answers: { "/app/api/desk": { here, vps: { reachable: false, url: "https://v", reason: "down" } } } });
    await Nova.run(ctx, "desk");
    const out = printed.join("\n");
    expect(out).toMatch(/Live now/);
    expect(out).toMatch(/on the VPS/);
    expect(out).toMatch(/vps\/agent-switch-back\.sh/);
    expect(out).toMatch(/Newsletters won't send/);
    expect(out).not.toMatch(/cloudflare/i);
  });
});

// Every command, with Nova Agent's answers stood in for, runs without breaking (so none can quietly
// stop working). Commands that change something are given what they need, and asked-first ones are
// answered with nothing (cancelled).
describe("every command runs", () => {
  const answers: Record<string, unknown> = {
    "/quests/state": { quests: [{ id: "abcdef12-1", title: "Mix the EP", status: "todo", start: "2026-10-14T09:00:00Z" }], current: null, next: [], overdue: [] },
    "/actions/": { ok: true },
    "/calendar-api/data": { notes: [{ id: "c1", title: "Session", start: "2026-10-14T10:00" }], rev: 3 },
    "/board-api/boards": { boards: [{ name: "Welcome", cards: [{ title: "Hello" }] }] },
    "/notes-api/changes": { notes: [{ id: "n1", title: "Plan", html: "<p>x</p>" }] },
    "/status": { live: true, connected: true, model: "claude" },
    "/console-api/state": { terminals: false, why: "online", vps: { host: "h", user: "u", port: 22 } },
    "/console-api/logs": { lines: [{ time: Date.now(), part: "task", level: "info", message: "hello" }] },
    "/console-api/vps": { vps: { host: "h", user: "u", port: 22 } },
    "/fixer-api/state": { issues: [], jobs: [], lastCheck: { at: "2026-10-13T10:00:00Z" } },
    "/staff": { staff: [{ id: "ana", display_name: "Ana", role: "admin", status: "active" }] },
    "/app/api/google": { connected: true, account: "a@b.c", missing: [], parts: [{ id: "calendar", on: true, allowed: true }] },
    "/app/api/desk": { here: { url: "https://x", version: { id: "abc", at: "2026-10-13T10:00:00Z" }, pc: { connected: true }, jobs: [] }, vps: { reachable: true, url: "https://v", uptimeSeconds: 99999, memory: { total: 6e9, free: 3e9 }, disk: { total: 3e10, free: 2e10 }, services: { nova: "active" } } },
    "/app/api/memory/index": { files: [{ path: "studio", description: "the studio" }] },
    "/app/api/": { items: [{ id: 1, title: "Thing", status: "new" }] },
  };
  const LINE: Record<string, string> = { quests: 'quests add "Mix" --minutes 20', search: "search mix", agent: 'agent "hi"', ask: 'ask "hi"', index: "index search studio", open: "open board", approve: "approve campaign 12", reject: "reject social 7", vps: "vps show", shell: "shell", theme: "theme list", music: "music", google: "google status", fixer: "fixer", lossless: "lossless status", logs: "logs 3", portal: "portal enquiries" };
  for (const name of Object.keys(Nova.COMMANDS)) {
    it(name, async () => {
      const { ctx } = fakeCtx({ answers: { ...answers, "/actions/chat": { reply: "Hello", actions: [] } } });
      ctx.music = { start: async () => {}, stop() {}, newSeed() {}, seed: () => "ABC", setSeed() {}, piece: () => ({ name: "Glow" }), isPlaying: () => false };
      ctx.look = { themes: [{ id: "pulsar", name: "Pulsar" }], setTheme() {} };
      await expect(Nova.run(ctx, LINE[name] || name)).resolves.toBeUndefined();
    });
  }
  it("help shows every command in a group", async () => {
    const grouped = new Set(Nova.GROUPS.flatMap(([, names]) => names));
    expect(Object.keys(Nova.COMMANDS).filter((c) => !grouped.has(c))).toEqual([]);
  });
});

describe("the buttons above the Nova tab", () => {
  it("are in groups, every one types a real command, and none of the old ones is gone", () => {
    const groups = Nova.QUICK.map(([title]) => title);
    expect(groups).toEqual(["Start here", "Apps", "Studio", "Tools"]);
    const labels = Nova.QUICK.flatMap(([, b]) => b.map(([label]) => label));
    for (const old of ["Today", "Now", "Quests", "Calendar", "Notes", "Boards", "Enquiries", "Clients", "Money", "Social", "Approvals", "Google", "Computer", "Search…", "Ask Agent…", "Help", "Clear"]) expect(labels).toContain(old);
    for (const [, buttons] of Nova.QUICK)
      for (const [, cmd] of buttons) expect(Nova.COMMANDS[Nova.resolveName(cmd.trim().split(" ")[0])]?.help, cmd).toBeTruthy();
  });
});

describe("the commands", () => {
  it("adds a quest with its length, and finds one by the start of its id", async () => {
    const quests = [{ id: "abcd1234-xyz", title: "Mix", status: "todo" }];
    const { ctx, calls, printed } = fakeCtx({ answers: { "/actions/quests": { ok: true, quest: { title: "Mix the EP" } }, "/quests/state": { quests } } });
    await Nova.run(ctx, `quests add "Mix the EP" --minutes 45`);
    expect(calls[0]).toEqual({ path: "/actions/quests", method: "POST", body: { title: "Mix the EP", minutes: 45 } });
    await Nova.run(ctx, "quests done abcd");
    expect(calls.at(-1)).toMatchObject({ path: "/actions/quests/abcd1234-xyz", method: "POST", body: { action: "done" } });
    expect(printed.join("\n")).toMatch(/Done: Mix/);
  });
  it("lists a Portal section from Nova Bot's answer", async () => {
    const { ctx, printed } = fakeCtx({ answers: { "/app/api/enquiries": { enquiries: [{ id: 7, name: "Sam", status: "new", created_at: "2026-10-13T09:00:00Z" }] } } });
    await Nova.run(ctx, "portal enquiries");
    expect(printed.join("\n")).toMatch(/"id":7/);
  });
  it("keeps admin commands for admins", async () => {
    const { ctx } = fakeCtx({ role: "staff" });
    await expect(Nova.run(ctx, "logs")).rejects.toThrow(/admins/);
    await expect(Nova.run(ctx, "shell")).rejects.toThrow(/admins/);
    await expect(Nova.run(ctx, "approve campaign 3")).rejects.toThrow(/admins/);
  });
  it("approves only when the number is typed back, and shows what it is first", async () => {
    const answers = { "/app/api/campaigns/3": { campaign: { id: 3, subject: "October news", body: "Hello fans", audience: "fans" } }, "/app/api/campaigns/3/approve": { ok: true } };
    const wrong = fakeCtx({ answers, typed: "yes" });
    await Nova.run(wrong.ctx, "approve campaign 3");
    expect(wrong.calls.some((c) => c.method === "POST")).toBe(false);
    expect(wrong.printed.join("\n")).toMatch(/October news[\s\S]*Cancelled/);
    const right = fakeCtx({ answers, typed: "3" });
    await Nova.run(right.ctx, "approve campaign 3");
    expect(right.calls.at(-1)).toEqual({ path: "/app/api/campaigns/3/approve", method: "POST", body: {} });
  });
  it("opens apps and terminals through the page", async () => {
    const { ctx, printed } = fakeCtx();
    await Nova.run(ctx, "open board");
    await Nova.run(ctx, "vps setup-key");
    expect(printed).toContain("open: /board/");
    expect(printed).toContain("terminal: vps-key");
  });
});

describe("terminals on the studio computer", () => {
  async function load() {
    await boot("2026-10-13T09:00");
    const con = await import("../src/console");
    const relay = await import("../src/relay");
    return { con, relay };
  }

  it("open only for admins, at localhost, from Console's own page, never through the relay", async () => {
    const { con, relay } = await load();
    const local = (headers: Record<string, string> = {}) => new Request("http://localhost:4545/console-api/term", { method: "POST", headers });
    const admin = { role: "admin" };
    expect(con.terminalProblem(local({ "X-Nova-Visualizer": "1", Origin: "http://localhost:4545" }), admin, { write: true })).toBe("");
    expect(con.terminalProblem(local({ "X-Nova-Visualizer": "1" }), { role: "staff" }, { write: true })).toMatch(/admins/);
    expect(con.terminalProblem(local(), admin, { write: true })).toMatch(/own page/);
    expect(con.terminalProblem(local({ "X-Nova-Visualizer": "1", Origin: "https://evil.example" }), admin, { write: true })).toMatch(/own page/);
    expect(con.terminalProblem(new Request("http://192.168.1.20:4545/console-api/term", { method: "POST", headers: { "X-Nova-Visualizer": "1" } }), admin, { write: true })).toMatch(/localhost/);
    const online = relay.relayedRequest({ method: "POST", path: "/console-api/term", headers: { "x-nova-visualizer": "1" }, staff: { id: "dee", name: "Dee", role: "admin" } });
    expect(con.terminalProblem(online, admin, { write: true })).toMatch(/not online/);
    // …and Nova Bot's link never carries them at all
    expect(relay.relayAllowed("POST", "/console-api/term", { id: "dee", name: "Dee", role: "admin" } as any)).toBe(false);
    expect(relay.relayAllowed("POST", "/console-api/vps", { id: "dee", name: "Dee", role: "admin" } as any)).toBe(false);
    expect(relay.relayAllowed("GET", "/console-api/state", { id: "bea", name: "Bea", role: "staff" } as any)).toBe(true);
    expect(relay.relayAllowed("GET", "/console-api/logs", { id: "bea", name: "Bea", role: "staff" } as any)).toBe(false);
  });

  it("refuses a terminal asked for online, with a clear message", async () => {
    const { con, relay } = await load();
    const app = new Hono();
    con.registerConsoleRoutes(app);
    const req = relay.relayedRequest({ method: "POST", path: "/console-api/term", headers: { "content-type": "application/json", "x-nova-visualizer": "1" }, staff: { id: "dee", name: "Dee", role: "admin" } }, Buffer.from(JSON.stringify({ kind: "shell" })));
    const res = await app.fetch(req);
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/studio computer itself/);
    const state = await (await app.fetch(relay.relayedRequest({ method: "GET", path: "/console-api/state", headers: {}, staff: { id: "dee", name: "Dee", role: "admin" } }))).json();
    expect(state).toMatchObject({ terminals: false, open: [] });
  });

  it("checks the VPS's address, and builds ssh without anything that could be an option", async () => {
    const { con } = await load();
    expect(con.cleanVps({ host: "vps.example.com", user: "root", port: 22 })).toEqual({ host: "vps.example.com", user: "root", port: 22 });
    expect(con.cleanVps({ host: "203.0.113.7", user: "nova", port: "2222" })).toEqual({ host: "203.0.113.7", user: "nova", port: 2222 });
    expect(con.cleanVps({ host: "-oProxyCommand=evil", user: "root" })).toHaveProperty("error");
    expect(con.cleanVps({ host: "vps.example.com", user: "-l root" })).toHaveProperty("error");
    expect(con.cleanVps({ host: "vps.example.com", user: "root", port: 70000 })).toHaveProperty("error");
    expect(con.commandFor("vps", null)).toHaveProperty("error");
    const ssh = con.commandFor("vps", { host: "vps.example.com", user: "root", port: 22 }) as any;
    expect(ssh.file).toBe("ssh");
    expect(ssh.args).toEqual(["-p", "22", "-o", "ServerAliveInterval=30", "root@vps.example.com"]);
    expect((con.commandFor("vps-key", { host: "vps.example.com", user: "root", port: 22 }) as any).file).toBe("ssh-copy-id");
  });

  it("each terminal needs its own token for keys, and closes when asked", async () => {
    const { con } = await load();
    const written: string[] = [];
    let killed = false;
    void con;
    // As an admin on this computer: Nova Bot says the PC's person (Ana) is an admin
    process.env.AGENT_NOVA_KEY = "test-key";
    process.env.NOVA_WORKER_URL = "http://worker.test";
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("/nova-agent/me") ? Response.json({ staff: { id: "ana", display_name: "Ana", role: "admin", status: "active" }, linked: true }) : new Response("{}", { status: 404 })
    );
    vi.resetModules();
    const con2 = await import("../src/console");
    const staff = await import("../src/staff");
    await staff.whoAmI(true);
    con2.usePty(() => ({ onData: () => {}, onExit: () => {}, write: (d: string) => void written.push(d), resize: () => {}, kill: () => void (killed = true), pid: 1 }));
    const app = new Hono();
    con2.registerConsoleRoutes(app);
    const H = { "X-Nova-Visualizer": "1", "Content-Type": "application/json", Origin: "http://localhost:4545" };
    const made = await app.fetch(new Request("http://localhost:4545/console-api/term", { method: "POST", headers: H, body: JSON.stringify({ kind: "shell", cols: 80, rows: 24 }) }));
    expect(made.status).toBe(200);
    const { id, token } = await made.json();
    const bad = await app.fetch(new Request(`http://localhost:4545/console-api/term/${id}/input`, { method: "POST", headers: { ...H, "X-Console-Token": "nope" }, body: JSON.stringify({ data: "ls\r" }) }));
    expect(bad.status).toBe(404);
    const good = await app.fetch(new Request(`http://localhost:4545/console-api/term/${id}/input`, { method: "POST", headers: { ...H, "X-Console-Token": token }, body: JSON.stringify({ data: "ls\r" }) }));
    expect(good.status).toBe(200);
    expect(written).toEqual(["ls\r"]);
    await app.fetch(new Request(`http://localhost:4545/console-api/term/${id}/close`, { method: "POST", headers: { ...H, "X-Console-Token": token }, body: "{}" }));
    expect(killed).toBe(true);
    con2.usePty(null);
    delete process.env.AGENT_NOVA_KEY;
    delete process.env.NOVA_WORKER_URL;
  });
});

// Nova Phone's Console with real terminals (23 Oct 2026): Nova Agent serves Nova Phone too, at
// http://localhost:<port>/phone/?here=1#console, which stays on this computer (not sent online) so its
// terminals open; /console-api/state says that address (phoneUrl), which Nova Phone's Console offers.
describe("Nova Phone's Console on this computer", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const webDir = (p: string) => fileURLToPath(new URL(`../web/${p}`, import.meta.url));

  it("?here=1 keeps Console and Nova Phone on this computer, and nothing else", async () => {
    await boot("2026-10-23T09:00");
    const { openedHere } = await import("../src/console");
    expect(openedHere("/phone/", "?here=1")).toBe(true);
    expect(openedHere("/phone", "?here=1")).toBe(true);
    expect(openedHere("/phone/index.html", "?here=1&x=2")).toBe(true);
    expect(openedHere("/console/", "?here=1")).toBe(true);
    expect(openedHere("/phone/", "")).toBe(false);
    expect(openedHere("/phone/", "?here=0")).toBe(false);
    expect(openedHere("/phonebook/", "?here=1")).toBe(false);
    expect(openedHere("/portal/", "?here=1")).toBe(false);
    expect(openedHere("/agent/", "?here=1")).toBe(false);
  });

  it("the state says Nova Phone's address with terminals (on the PC and on the server, online too)", async () => {
    await boot("2026-10-23T09:00");
    const con = await import("../src/console");
    const relay = await import("../src/relay");
    const { config } = await import("../src/config");
    const app = new Hono();
    con.registerConsoleRoutes(app);
    const ask = async () => (await app.fetch(relay.relayedRequest({ method: "GET", path: "/console-api/state", headers: {}, staff: { id: "dee", name: "Dee", role: "admin" } }))).json();
    const pc = await ask();
    expect(pc).toMatchObject({ terminals: false, where: "pc", tunnel: "", localUrl: "http://localhost:4545/console/?here=1", phoneUrl: "http://localhost:4545/phone/?here=1#console" });
    const was = config.onServer;
    config.onServer = true;
    try {
      const server = await ask();
      expect(server).toMatchObject({ terminals: false, where: "server", phoneUrl: "http://localhost:4545/phone/?here=1#console" });
      expect(server.tunnel).toBe(con.SERVER_TUNNEL);
      expect(server.tunnel).toMatch(/^ssh -L 4545:localhost:4545 root@/);
    } finally {
      config.onServer = was;
    }
    // …the field Nova Phone's Console reads, and the button it shows
    const phone = read("../web/phone/console.js");
    expect(phone).toContain("state.phoneUrl");
    expect(phone).toContain("Open Console on the server");
  });

  it("Nova Agent serves Nova Phone, and every file its page asks for is where Nova Agent serves it", () => {
    const server = read("../src/visualizer/server.ts");
    expect(server).toContain('serveFolder("/phone", "phone/"');
    expect(server).toContain('serveFolder("/shared", "shared/"');
    // (the one-address rule lets ?here=1 through for Nova Phone too; without it, Nova Phone goes online)
    expect(server).toMatch(/const consoleHere = [^\n]*openedHere\(/);
    expect(server).toMatch(/path === "\/phone" \|\| path\.startsWith\("\/phone\/"\)\) return c\.redirect\(config\.workerUrl/);
    // (not a panel: a document at /phone/ isn't turned into Nova Agent's /agent/?open=…)
    expect(server).not.toMatch(/const PANELS = \[[^\]]*"\/phone"/);
    const html = read("../web/phone/index.html");
    const local = [...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1].split(/[?#]/)[0]);
    expect(local.length).toBeGreaterThan(5);
    const where = (a: string) =>
      a.startsWith("/phone/") ? webDir("phone/" + a.slice(7)) : a.startsWith("/shared/") ? webDir("shared/" + a.slice(8)) : a.startsWith("/agent/") ? webDir("agent/assets/" + a.slice(7)) : "";
    const missing = local.filter((a) => !where(a) || !existsSync(where(a)));
    expect(missing).toEqual([]);
    // …and the places' own files it loads later (phone.js: FILES), from /phone/
    const files = [...new Set([...read("../web/phone/phone.js").matchAll(/"([a-z]+\.js)\*?"/g)].map((m) => m[1]))];
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => !existsSync(webDir("phone/" + f)))).toEqual([]);
  });
});
