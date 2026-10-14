// The looks check's measuring and judging (src/fixer/looks.ts): real pages in a real browser, so the
// giant empty gap of 14 October 2026 (Index and Portal: the top of the panel empty, its header and
// numbers pushed down behind the navigation panel) is caught, and an ordinary empty state isn't.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { LOOKS_SIZES, judgeContent, judgeFrame, judgeHost, looksDevice, looksFindings, measureContent, measureFrame, measureHost, type FrameMeasure, type LooksScreen } from "../src/fixer/looks";

let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const frameOf = async (html: string): Promise<FrameMeasure> => {
  await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden;font:16px sans-serif}</style>${html}`);
  return { ...(await page.evaluate(measureContent, null)), ...(await page.evaluate(measureFrame)) };
};

describe("judging a panel", () => {
  it("the Index gap: an empty box on top, the header and numbers low: serious", async () => {
    const f = await frameOf(`
      <div style="height:660px;margin:20px;border:1px solid #444;border-radius:20px"></div>
      <div class="embed-head"><header style="height:60px;display:flex;gap:20px"><a href="#">P</a><b>I</b><button>⚙</button></header></div>
      <section style="display:flex;gap:20px"><div>1 Studio</div><div>9 Staff</div><div>2 Waiting</div></section>`);
    const kinds = judgeFrame(f).map((p) => p.kind);
    expect(kinds).toContain("top-gap");
    expect(kinds).toContain("header-low");
    expect(judgeFrame(f).find((p) => p.kind === "top-gap")!.severity).toBe("serious");
  });

  it("an ordinary empty state (header and a message at the top, room below) is fine", async () => {
    const f = await frameOf(`
      <header style="height:60px"><h1>Quests</h1></header>
      <main><p>Sign in to Nova Agent to see your quests.</p></main>`);
    expect(judgeFrame(f)).toEqual([]);
  });

  it("a blank panel", async () => {
    const f = await frameOf(`<div style="height:600px"></div>`);
    expect(judgeFrame(f).map((p) => p.kind)).toEqual(["blank"]);
  });

  it("a big gap between its parts", async () => {
    const f = await frameOf(`<header style="height:50px">Top</header><div style="height:600px"></div><footer>Bottom words here</footer>`);
    expect(judgeFrame(f).map((p) => p.kind)).toContain("gap");
  });

  it("a space marked to be filled (Console's empty terminal) isn't a gap", async () => {
    const f = await frameOf(`<header style="height:50px">Top</header><main data-looks-fill style="height:600px"></main><footer>Bottom words here</footer>`);
    expect(judgeFrame(f).map((p) => p.kind)).not.toContain("gap");
  });

  it("backdrops don't count as content; a big drawing that is the content does", async () => {
    const backdrop = await frameOf(`<canvas style="position:fixed;inset:0;width:100%;height:100%;pointer-events:none"></canvas><div style="height:700px"></div><p>Low words</p>`);
    expect(judgeFrame(backdrop).map((p) => p.kind)).toContain("top-gap");
    const drawing = await frameOf(`<canvas width="1400" height="900" style="display:block"></canvas>`);
    expect(judgeFrame(drawing)).toEqual([]);
  });

  it("a page that scrolls, and one cut off at the bottom", async () => {
    await page.setContent(`<!doctype html><style>body{margin:0}</style><p>Words</p><div style="height:3000px"></div>`);
    const scrolls: FrameMeasure = { ...(await page.evaluate(measureContent, null)), ...(await page.evaluate(measureFrame)) };
    expect(judgeFrame(scrolls).map((p) => p.kind)).toContain("page-scrolls");
    const cut = await frameOf(`<p>Words</p><div style="height:3000px"></div>`);
    expect(judgeFrame(cut).map((p) => p.kind)).toContain("cut-off");
  });

  it("text cut off without an ellipsis, and buttons part off the screen", async () => {
    const f = await frameOf(`<p>Words</p><div style="width:80px;overflow:hidden;white-space:nowrap">A very long label that does not fit</div><button style="position:absolute;left:1450px;width:200px">Off the edge</button>`);
    const kinds = judgeFrame(f).map((p) => p.kind);
    expect(kinds).toContain("text-cut");
    expect(kinds).toContain("offscreen");
  });
});

describe("judging Nova Agent around a panel", () => {
  const host = async (html: string) => {
    await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}</style>${html}`);
    return page.evaluate(measureHost);
  };
  it("the navigation panel covering the bottom of the panel, and two title panels", async () => {
    const h = await host(`
      <div class="shell"><header class="topbar" style="position:absolute;top:0;left:0;right:0;height:50px">Title</header>
      <main class="main viewing"><section class="viewer"><iframe style="position:absolute;top:60px;left:0;width:100%;height:900px;border:0"></iframe></section></main>
      <nav id="suite-home" style="position:absolute;bottom:0;left:0;right:0;height:120px">Apps</nav></div>`);
    const kinds = judgeHost(h, 1).map((p) => p.kind);
    expect(kinds).toContain("covered");
    expect(kinds).toContain("title-count");
  });
  it("bars snug around the panel: fine; an auto-hidden bar isn't missing", async () => {
    const h = await host(`
      <div class="shell"><header class="topbar" style="position:absolute;top:0;left:0;right:0;height:50px;transform:translateY(-120%)">Title</header>
      <main class="main viewing"><section class="viewer"><iframe style="position:absolute;top:0;left:0;width:100%;height:880px;border:0"></iframe></section></main>
      <nav id="suite-home" style="position:absolute;bottom:0;left:0;right:0;height:120px">Apps</nav></div>`);
    expect(judgeHost(h, 0)).toEqual([]);
  });
  it("empty space left between the panel and the navigation panel", async () => {
    const h = await host(`
      <div class="shell"><header class="topbar" style="position:absolute;top:0;left:0;right:0;height:50px">Title</header>
      <main class="main viewing"><section class="viewer"><iframe style="position:absolute;top:50px;left:0;width:100%;height:500px;border:0"></iframe></section></main>
      <nav id="suite-home" style="position:absolute;bottom:0;left:0;right:0;height:120px">Apps</nav></div>`);
    expect(judgeHost(h, 0).map((p) => p.kind)).toEqual(["unused"]);
  });
});

describe("the Fixer's problems from the looks check", () => {
  const screen = (width: number, height: number, signedIn: boolean, kind: "top-gap" | "text-cut", severity: "serious" | "minor"): LooksScreen => ({
    name: "Portal", path: "/portal/", width, height, signedIn, ms: 800, problems: [{ kind, severity, text: kind === "top-gap" ? "The top 64% of the panel is empty" : "Text cut off: span" }], shot: `portal-${width}x${height}-${signedIn ? "in" : "out"}.png`,
  });
  it("one problem per panel and kind, saying every size it was seen at", () => {
    const f = looksFindings([screen(1512, 1500, true, "top-gap", "serious"), screen(2000, 1130, true, "top-gap", "serious"), screen(390, 844, false, "text-cut", "minor")]);
    expect(f).toHaveLength(2);
    const gap = f.find((x) => x.problem?.includes("empty"))!;
    expect(gap.area).toBe("looks");
    expect(gap.severity).toBe("serious");
    expect(gap.panel).toBe("/portal/");
    expect(gap.detail).toMatch(/1512×1500 signed in.*\n.*2000×1130 signed in/);
    expect(gap.detail).toMatch(/--panels \/portal\/ --sizes 1512x1500,2000x1130/);
    // The same problem next time has the same fingerprint (whatever the numbers)
    const again = looksFindings([{ ...screen(2000, 1130, true, "top-gap", "serious"), problems: [{ kind: "top-gap", severity: "serious", text: "The top 70% of the panel is empty" }] }]);
    expect(again[0].fingerprint).toBe(gap.fingerprint);
  });
  it("the judging rules on their own: content low is a gap, content high is fine", () => {
    expect(judgeContent({ w: 1000, h: 1000, rows: [[700, 760], [800, 900]], text: 40, media: 2, header: 700 }, "panel").map((p) => p.kind)).toEqual(["top-gap", "header-low"]);
    expect(judgeContent({ w: 1000, h: 1000, rows: [[0, 60], [80, 120]], text: 40, media: 2, header: 0 }, "panel")).toEqual([]);
  });
});

describe("the sizes it looks at, and how each is opened", () => {
  it("includes a phone held sideways and an Android tablet upright", () => {
    const sizes = LOOKS_SIZES.map(([w, h]) => `${w}x${h}`);
    expect(sizes).toContain("780x360");
    expect(sizes).toContain("800x1280");
  });
  it("opens phones (upright and sideways) and Android tablets as Chrome on Android, computers as computers", () => {
    for (const [w, h] of [[360, 740], [390, 844], [780, 360], [915, 412]] as const) {
      const d = looksDevice(w, h);
      expect(d.kind).toBe("phone");
      expect(d.touch).toBe(true);
      expect(d.userAgent).toMatch(/Android .* Mobile Safari/);
    }
    const tab = looksDevice(800, 1280);
    expect(tab).toMatchObject({ kind: "tablet", touch: true });
    expect(tab.userAgent).toMatch(/Android/);
    expect(tab.userAgent).not.toMatch(/Mobile/);
    for (const [w, h] of [[1024, 768], [1440, 900], [2000, 1130]] as const) expect(looksDevice(w, h)).toEqual({ kind: "computer", touch: false, dpr: 1 });
  });
});
