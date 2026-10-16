// The Fixer's "Fixes on its own" (web/shared/rules.js): every screen of Nova Agent keeps the three
// rules as it draws. Real pages in a real browser: after it has looked, the Fixer's own measuring
// (src/fixer/strict.ts) finds nothing, reading text is left alone, and it all goes back when the
// screen changes size or it's switched off.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { measureStrict } from "../src/fixer/strict";

const FIT = readFileSync(join(__dirname, "../web/shared/fit.js"), "utf8");
const RULES = readFileSync(join(__dirname, "../web/shared/rules.js"), "utf8");
let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

// The page, before and after rules.js has looked at it
const fixed = async (html: string) => {
  // (a page of its own each time: setContent keeps the window, and with it the last page's rules.js)
  await page?.close();
  page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden;font:16px sans-serif}</style>${html}`);
  const before = await page.evaluate(measureStrict);
  await page.addScriptTag({ content: RULES });
  await page.addScriptTag({ content: FIT });
  const changed = await page.evaluate(() => (window as any).NovaRules.check());
  const after = await page.evaluate(measureStrict);
  return { before, after, changed };
};
const style = (sel: string) => page.evaluate((s) => document.querySelector<HTMLElement>(s)!.getAttribute("style") || "", sel);

describe("3. nothing onto the next line, fixed as it draws", () => {
  it("a button whose words wrap: on one line, a little smaller", async () => {
    const r = await fixed(`<div style="width:110px"><button id="b" style="width:110px;font-size:15px">Booking tools today</button></div>`);
    expect(r.before.map((f) => f.rule)).toContain("oneline");
    expect(r.after).toEqual([]);
    expect(await style("#b")).toMatch(/white-space: nowrap !important/);
    expect(await style("#b")).toMatch(/font-size: 1[0-4]\.\d+px !important/);
  });
  it("a name too long even at its smallest: whole, on one line, sliding sideways in its own box (never widening what holds it)", async () => {
    const r = await fixed(`<div id="row" style="display:flex;width:200px;gap:6px"><button style="width:90px;flex:none">One</button><button id="b" style="width:90px">Very long name for a little button</button></div>`);
    expect(r.after).toEqual([]);
    expect(await style("#b")).toMatch(/overflow-x: auto !important/);
    expect(await page.evaluate(() => document.getElementById("row")!.scrollWidth)).toBeLessThanOrEqual(201);
    expect(await page.getAttribute("#b", "title")).toBe("Very long name for a little button");
  });
  it("a row kept on one line never makes what holds it wider (a list beside a column of times: the narrow window's Quests)", async () => {
    const chips = Array.from({ length: 6 }, (_, i) => `<span style="padding:2px 8px;border:1px solid">Chip ${i + 1}</span>`).join("");
    await fixed(`<div id="grid" style="display:grid;grid-template-columns:60px auto;width:300px"><b>9:00</b><div id="li"><div data-one-row style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div></div></div>`);
    expect(await page.evaluate(() => document.getElementById("grid")!.scrollWidth)).toBeLessThanOrEqual(301);
    expect(await page.evaluate(() => document.getElementById("li")!.getBoundingClientRect().right)).toBeLessThanOrEqual(301);
  });
  it("a group of choices (chips, colours) is left to wrap onto more rows: every one stays in sight", async () => {
    const chips = Array.from({ length: 8 }, (_, i) => `<span style="padding:4px 10px;border:1px solid">Chip ${i + 1}</span>`).join("");
    const r = await fixed(`<div id="row" style="display:flex;flex-wrap:wrap;gap:6px;width:300px">${chips}</div>`);
    expect(r.after).toEqual([]);
    expect(await style("#row")).toBe("display:flex;flex-wrap:wrap;gap:6px;width:300px");
  });
  it("a row that must stay one row (marked data-one-row, like Nova Agent's bars): one row that slides inside itself", async () => {
    const chips = Array.from({ length: 8 }, (_, i) => `<span style="padding:4px 10px;border:1px solid">Tile ${i + 1}</span>`).join("");
    const r = await fixed(`<div id="row" data-one-row style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;width:300px">${chips}</div>`);
    expect(r.before.some((f) => f.rule === "oneline" && /wraps onto/.test(f.why))).toBe(true);
    expect(r.after).toEqual([]);
    expect(await style("#row")).toMatch(/flex-wrap: nowrap !important/);
    expect(await style("#row")).toMatch(/overflow-x: auto !important/);
    expect(await style("#row")).toMatch(/justify-content: flex-start !important/);
  });
  it("a button with a part inside it that asks to wrap (a title in a card): on one line too", async () => {
    const r = await fixed(`<button id="b" style="width:120px;display:grid"><b>11:00</b><span id="t" style="white-space:normal">sharna eleven to two</span></button>`);
    expect(r.before.map((f) => f.rule)).toContain("oneline");
    expect(r.after).toEqual([]);
    expect(await style("#t")).toMatch(/white-space: nowrap !important/);
  });
  it("reading text is left to wrap", async () => {
    const r = await fixed(`<p id="p" style="width:150px">A long paragraph of reading text that is meant to wrap onto several lines.</p>`);
    expect(r.changed).toBe(0);
    expect(await style("#p")).toBe("width:150px");
  });
});

describe("1. nothing off the screen, fixed as it draws", () => {
  it("words cut short with “…”: smaller until they fit", async () => {
    const r = await fixed(`<div id="t" style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Observatory and more</div>`);
    expect(r.before[0]).toMatchObject({ rule: "offscreen", why: "its words are cut short with “…”" });
    expect(r.after).toEqual([]);
    expect(await style("#t")).toMatch(/font-size/);
  });
  it("words that can't fit even at their smallest: scroll sideways, never cut, the whole words its tooltip", async () => {
    const r = await fixed(`<div id="t" style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">The studio's one app, for everyone</div>`);
    expect(r.after).toEqual([]);
    expect(await style("#t")).toMatch(/overflow-x: auto !important/);
    expect(await page.getAttribute("#t", "title")).toBe("The studio's one app, for everyone");
  });
  it("a box that cuts off what's in it: scrolls instead", async () => {
    const r = await fixed(`<div id="box" style="height:60px;overflow:hidden"><p style="margin:0">One</p><p style="margin:0">Two</p><p style="margin:0">Three</p><p style="margin:0">Four</p></div>`);
    expect(r.before.some((f) => /cut off by the box/.test(f.why))).toBe(true);
    expect(r.after).toEqual([]);
    expect(await style("#box")).toMatch(/overflow-y: auto !important/);
  });
  it("a card past the edge of the screen: nudged back in", async () => {
    const r = await fixed(`<div id="card" style="position:absolute;left:350px;top:10px;width:150px"><button>Calendar</button></div>`);
    expect(r.before.some((f) => /past the right edge/.test(f.why))).toBe(true);
    await page.waitForTimeout(100); // (fit.js nudges on the next frame)
    expect(await page.evaluate(measureStrict)).toEqual([]);
  });
  it("in the page, sticking out past the right: the nearest box that fits scrolls", async () => {
    const r = await fixed(`<section id="s" style="width:380px"><div style="width:700px"><button>Far along</button> <span style="margin-left:500px">End</span></div></section>`);
    expect(r.before.some((f) => /past the right edge/.test(f.why))).toBe(true);
    expect(r.after).toEqual([]);
    expect(await style("#s")).toMatch(/overflow-x: auto !important/);
  });
  it("a drawer slid away on purpose is left alone", async () => {
    const r = await fixed(`<aside id="d" style="position:absolute;left:0;top:0;width:200px;transform:translateX(-110%)"><button>Library</button></aside>`);
    expect(r.changed).toBe(0);
  });
});

describe("it never fights the panel", () => {
  it("everything goes back when the screen changes size, and comes back only where it's needed", async () => {
    await fixed(`<button id="b" style="max-width:100%;font-size:15px">Booking tools for this week</button>`);
    await page.setViewportSize({ width: 120, height: 600 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(50);
    await page.evaluate(() => (window as any).NovaRules.check());
    expect(await style("#b")).toMatch(/white-space: nowrap/);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(50);
    await page.evaluate(() => (window as any).NovaRules.check());
    expect((await style("#b")).replace(/\s/g, "")).toBe("max-width:100%;font-size:15px;");
  });
  it("a part marked data-rules=\"off\" is left as it is", async () => {
    const r = await fixed(`<div data-rules="off"><div style="width:80px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">The studio's one app</div></div>`);
    expect(r.changed).toBe(0);
  });
  it("switched off on this device: every change is put back", async () => {
    expect((await fixed(`<div id="t" style="width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">Observatory and more</div>`)).changed).toBe(1);
    await page.evaluate(() => (window as any).NovaRules.set(false));
    expect((await style("#t")).replace(/\s/g, "")).toMatch(/^width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;?$/);
    expect(await page.evaluate(() => (window as any).NovaRules.on)).toBe(false);
  });
  it("is linked by /shared/fit.js, so every page that keeps things on screen keeps the rules too", () => {
    expect(FIT).toContain('[["rules.js", "NovaRules"], ["notices.js", "NovaNotices"]]');
  });
});
