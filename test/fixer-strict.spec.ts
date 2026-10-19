// The Fixer from the ground up (src/fixer/strict.ts, src/fixer/strict-service.ts): the three strict
// rules measured on real pages in a real browser, and the service that runs them every 30 minutes.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { linksOnScreen, measureStrict, strictCounts, strictProblems, type StrictRun } from "../src/fixer/strict";
import { StrictFixer, registerStrictRoutes, retireOldFixer } from "../src/fixer/strict-service";

let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 400, height: 600 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const found = async (html: string, scroll = false) => {
  await page.setContent(`<!doctype html><style>html,body{margin:0;${scroll ? "" : "height:100%;overflow:hidden;"}font:16px sans-serif}</style>${html}`);
  return page.evaluate(measureStrict);
};
const rules = (f: { rule: string }[]) => f.map((x) => x.rule);

describe("1. never anything off the screen", () => {
  it("a button past the right edge", async () => {
    const f = await found(`<button style="position:absolute;left:350px;top:10px;width:120px">Calendar</button>`);
    expect(f).toEqual([expect.objectContaining({ rule: "offscreen", what: expect.stringContaining("Button “Calendar”"), why: expect.stringContaining("70px past the right edge") })]);
  });
  it("a name cut short with “…” in its box", async () => {
    const f = await found(`<div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Observatory and more</div>`);
    expect(f[0]).toMatchObject({ rule: "offscreen", why: "its words are cut short with “…”" });
  });
  it("something cut off by a box that doesn't scroll", async () => {
    const f = await found(`<div style="height:60px;overflow:hidden"><p style="margin:0">One</p><p style="margin:0">Two</p><p style="margin:0">Three</p><p style="margin:0">Four</p></div>`);
    expect(f.some((x) => x.rule === "offscreen" && /cut off by the box/.test(x.why) && /Four/.test(x.what))).toBe(true);
  });
  it("fine: what's further down a box that scrolls (it can be scrolled to)", async () => {
    const f = await found(`<div style="height:100px;overflow-y:auto">${Array.from({ length: 30 }, (_, i) => `<p style="margin:0">Line ${i}</p>`).join("")}</div>`);
    expect(f).toEqual([]);
  });
  it("a Nova tile past the side of its bar (the bar would have to be slid along to find it, 19 Oct 2026)", async () => {
    const f = await found(`<nav class="tabbar" style="display:flex;overflow-x:auto;width:300px">${Array.from({ length: 8 }, (_, i) => `<button style="flex:none;width:60px">Tile${i}</button>`).join("")}</nav>`);
    expect(f.some((x) => x.rule === "offscreen" && /Tile6/.test(x.what) && /slide the bar/.test(x.why))).toBe(true);
    // (a row of chips sliding sideways in a panel is still fine)
    expect(await found(`<div style="display:flex;overflow-x:auto;width:300px">${Array.from({ length: 8 }, (_, i) => `<button style="flex:none;width:60px">Chip${i}</button>`).join("")}</div>`)).toEqual([]);
  });
  it("fine: what's on a surface you drag around (data-pan, Board's table)", async () => {
    const f = await found(`<main data-pan style="position:relative;height:200px;overflow:hidden"><div style="position:absolute;left:600px;top:20px">A note</div></main>`);
    expect(f).toEqual([]);
  });
  it("fine: words for screen readers only (in a 1px box that cuts them off, hidden on purpose)", async () => {
    expect(await found(`<div style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)"><h2>Panels</h2></div>`)).toEqual([]);
  });
  it("fine: hidden things, and what's marked aria-hidden", async () => {
    expect(await found(`<button style="position:absolute;left:900px" hidden>Away</button><div aria-hidden="true" style="position:absolute;left:900px">Decoration</div>`)).toEqual([]);
  });
});

describe("2. one screen", () => {
  it("a big part of the page sliding sideways is the page too wide in disguise (a row sliding sideways is fine)", async () => {
    const f = await found(`<div id="shell" style="height:500px;overflow:auto"><div style="width:900px;height:100px">Wide</div></div>`);
    expect(f).toEqual([expect.objectContaining({ rule: "onescreen", why: expect.stringContaining("scrolls sideways") })]);
    expect(await found(`<div style="display:flex;overflow-x:auto;height:40px"><span style="flex:none;width:900px">Chips</span></div>`)).toEqual([]);
  });
  it("on a computer the page scrolling is a problem; on a phone a panel scrolls up and down like any app (19 Oct 2026)", async () => {
    await page.setViewportSize({ width: 1200, height: 800 });
    try {
      const f = await found(`<div style="height:1500px">Tall</div>`, true);
      expect(f).toEqual([expect.objectContaining({ rule: "onescreen", why: expect.stringContaining("700px taller than the screen") })]);
    } finally {
      await page.setViewportSize({ width: 400, height: 600 });
    }
    expect(await found(`<div style="height:1500px">Tall</div>`, true)).toEqual([]);
    // (but never sideways)
    expect(rules(await found(`<div style="width:900px;height:20px">Wide</div>`, true))).toContain("onescreen");
  });
  it("fine: the page stays put and a box inside it scrolls", async () => {
    expect(await found(`<div style="height:100%;overflow:auto"><div style="height:1500px">Tall</div></div>`)).toEqual([]);
  });
});

describe("3. never onto the next line", () => {
  it("a button whose name wraps", async () => {
    const f = await found(`<button style="width:70px">Open the calendar now</button>`);
    expect(rules(f)).toEqual(["oneline"]);
    expect(f[0].why).toMatch(/goes? onto [2-9] lines|go onto [2-9] lines/);
  });
  it("a heading that wraps", async () => {
    const f = await found(`<h2 style="width:120px;margin:0">Using this with Logic Pro</h2>`);
    expect(rules(f)).toEqual(["oneline"]);
  });
  it("one of Nova Agent's bars (or a row marked data-one-row) wrapping onto a second row", async () => {
    const f = await found(`<div class="status-line" style="display:flex;flex-wrap:wrap;width:200px;gap:4px">${["Today", "Week", "Month", "Year", "All"].map((t) => `<span style="padding:4px 10px">${t}</span>`).join("")}</div>`);
    expect(f.some((x) => x.rule === "oneline" && /^The row/.test(x.what) && /wraps onto 2 lines/.test(x.why))).toBe(true);
  });
  it("fine: a group of choices (colours, filters, chips) wrapping onto more rows", async () => {
    const f = await found(`<div style="display:flex;flex-wrap:wrap;width:200px;gap:4px">${["Ruby", "Amber", "Gold", "Jade", "Teal"].map((t) => `<button style="padding:4px 10px">${t}</button>`).join("")}</div>`);
    expect(f).toEqual([]);
  });
  it("the status line's words wrapping in a bar", async () => {
    const f = await found(`<footer style="width:90px"><span>Here since 3:58 am</span></footer>`);
    expect(rules(f)).toEqual(["oneline"]);
  });
  it("fine: reading text (a paragraph, a message) wraps as it should", async () => {
    expect(await found(`<p style="width:120px">A long paragraph of words that is meant to wrap onto several lines.</p>`)).toEqual([]);
  });
  it("fine: an icon above its name in a tile (two parts, each on one line)", async () => {
    expect(await found(`<button style="display:grid;width:60px"><span>★</span><span>Notes</span></button>`)).toEqual([]);
  });
});

describe("4. every button and link works", () => {
  const links = async (html: string) => {
    await page.setContent(`<!doctype html>${html}`);
    return page.evaluate(linksOnScreen);
  };
  it("a link to a place on its page that isn't there", async () => {
    expect(await links(`<a href="#bank">Pay by bank transfer</a><a href="#card">Card</a><div id="card"></div>`)).toEqual([{ what: "Link “Pay by bank transfer” (a)", url: "#bank", missing: true }]);
  });
  it("addresses to try: each once, a form that only opens a page by its button, never a form that sends, mail or scripts", async () => {
    const l = await links(`<a href="https://x.test/privacy">Privacy</a><a href="https://x.test/privacy#top">Privacy</a><form method="get" action="https://x.test/find"><button>Find</button></form><form method="post" action="https://x.test/pay"><button>Pay</button></form><a href="mailto:a@x.test">Mail</a><a href="javascript:void 0">Go</a>`);
    expect(l).toEqual([
      { what: "Link “Privacy” (a)", url: "https://x.test/privacy" },
      { what: "Button “Find” (button)", url: "https://x.test/find" },
    ]);
  });
});

const run = (screens: StrictRun["screens"]): StrictRun => ({ startedAt: "2026-10-16T10:00:00.000Z", finishedAt: "2026-10-16T10:02:00.000Z", base: "https://x.test", signedIn: true, screens });
describe("counting", () => {
  it("one thing seen at several sizes is one problem, with every size it was at", () => {
    const f = { rule: "oneline" as const, what: "Button “Today”", why: "its words go onto 2 lines", box: null };
    const r = run([
      { place: "Calendar", width: 360, height: 640, kind: "phone", ms: 1, found: [f], shot: "calendar-360x640.png" },
      { place: "Calendar", width: 390, height: 844, kind: "phone", ms: 1, found: [f], shot: "" },
      { place: "Notes", width: 360, height: 640, kind: "phone", ms: 1, found: [{ ...f, rule: "offscreen", why: "it's off the screen: 12px past the right edge" }], shot: "" },
      { place: "Notes", width: 390, height: 844, kind: "phone", ms: 1, found: [{ ...f, rule: "offscreen", why: "it's off the screen: 30px past the right edge" }], shot: "" },
    ]);
    expect(strictProblems(r).map((p) => [p.place, p.rule, p.at.map((a) => a.size)])).toEqual([
      ["Calendar", "oneline", ["360×640", "390×844"]],
      ["Notes", "offscreen", ["360×640", "390×844"]],
    ]);
    expect(strictCounts(r)).toEqual({ offscreen: 1, onescreen: 0, oneline: 1, works: 0 });
  });
});

describe("the service", () => {
  const setup = (out: (args: string[]) => StrictRun | null) => {
    const dir = mkdtempSync(join(tmpdir(), "strict-"));
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    const f = new StrictFixer(join(dir, "fixer-strict.json"), join(dir, "shots"), {
      run: async (_cmd, args, opts) => {
        calls.push({ args, env: opts.env });
        const r = out(args);
        if (r) writeFileSync(args[args.indexOf("--out") + 1], JSON.stringify(r));
        return { code: r ? 1 : 2, out: r ? "" : "boom" };
      },
      base: () => "https://nova.test",
      session: async (a) => (a === "start" ? { token: "secret-token", cookie: "nova_session" } : null),
      now: () => new Date("2026-10-16T10:00:00Z"),
      cwd: dir,
      log: () => {},
    });
    return { f, dir, calls };
  };
  it("a run: low priority, signed in through the environment (never the command line), kept with its problems", async () => {
    const r = run([{ place: "Agent", width: 360, height: 640, kind: "phone", ms: 1, found: [{ rule: "onescreen", what: "The page", why: "scrolls", box: null }], shot: "" }]);
    const { f, calls } = setup(() => r);
    expect(await f.check()).toBe(true);
    expect(calls[0].args.slice(0, 2)).toEqual(["-n", "10"]);
    expect(calls[0].args).toContain("scripts/fixer-strict.ts");
    expect(calls[0].args.join(" ")).not.toContain("secret-token");
    expect(calls[0].env).toEqual({ LOOKS_COOKIE: "secret-token", LOOKS_COOKIE_NAME: "nova_session" });
    const s = f.state();
    expect(s.rules.map((x) => [x.id, x.problems])).toEqual([["offscreen", 0], ["onescreen", 1], ["oneline", 0], ["works", 0]]);
    expect(s.problems).toHaveLength(1);
    expect(s.history).toHaveLength(1);
    expect(s.last?.id).toBe("20261016-100000");
  });
  it("says how many parts the screens fixed on their own (Missions and the Manual are Agent's page again: not counted twice)", async () => {
    const at = (place: string, fixed: number) => ({ place, width: 360, height: 640, kind: "phone" as const, ms: 1, found: [], shot: "", fixed });
    const { f } = setup(() => run([at("Agent", 7), at("Quests", 20), at("Missions", 7), at("Manual", 7), at("Fixer", 0)]));
    await f.check();
    expect(f.state().fixed).toBe(27);
  });
  it("a run still going: the next one is skipped", async () => {
    let release = () => {};
    let started = () => {};
    const running = new Promise<void>((r) => (started = r));
    const { f, dir } = setup(() => null);
    (f as any).deps.run = () => new Promise((r) => { release = () => r({ code: 0, out: "" }); started(); });
    const first = f.check();
    expect(await f.check()).toBe(false);
    await running;
    release();
    await first;
    expect(existsSync(join(dir, "fixer-strict.json"))).toBe(true);
  });
  it("a run that couldn't finish says so", async () => {
    const { f } = setup(() => null);
    expect(await f.check()).toBe(false);
    expect(f.state().error).toMatch(/The check stopped/);
  });
  it("the old Fixer's data is put aside, never deleted", () => {
    const dir = mkdtempSync(join(tmpdir(), "strict-old-"));
    writeFileSync(join(dir, "fixer.json"), '{"quests":[1]}');
    const to = retireOldFixer(dir, new Date("2026-10-16T12:00:00Z"));
    expect(to).toBe(join(dir, "fixer-before-2026-10-16.json"));
    expect(existsSync(join(dir, "fixer.json"))).toBe(false);
    expect(readFileSync(to!, "utf8")).toBe('{"quests":[1]}');
    expect(retireOldFixer(dir)).toBeNull();
  });
  it("its addresses are for admins; pictures only from a run's own folder", async () => {
    const { f, dir } = setup(() => null);
    mkdirSync(join(dir, "shots", "20261016-100000"), { recursive: true });
    writeFileSync(join(dir, "shots", "20261016-100000", "agent-360x640.png"), "png");
    const app = new Hono();
    registerStrictRoutes(app, () => f);
    expect((await app.request("http://x/fixer-api/state")).status).toBe(403);
    const admin = { "x-nova-online": "Ada", "x-nova-online-role": "admin" };
    const relayed = (path: string, init: RequestInit = {}) => app.fetch(new Request(`http://online.nova-agent.invalid${path}`, { ...init, headers: { ...admin, ...(init.headers || {}) } }));
    expect((await relayed("/fixer-api/state")).status).toBe(200);
    expect((await relayed("/fixer-api/shots/20261016-100000/agent-360x640.png")).status).toBe(200);
    expect((await relayed("/fixer-api/shots/..%2F..%2Fsecrets/agent-360x640.png")).status).toBe(404);
    expect((await app.fetch(new Request("http://online.nova-agent.invalid/fixer-api/state", { headers: { "x-nova-online": "Bo", "x-nova-online-role": "staff" } }))).status).toBe(403);
  });
});
