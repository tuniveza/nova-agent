// Notices that keep out of the way (web/shared/notices.js): a notice over where someone is typing
// slides clear of it and comes back when they stop; one under a phone's keyboard comes up above it;
// while something is dragged, every notice fades and lets the pointer through. Nothing else moves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";

const NOTICES = readFileSync(join(__dirname, "../web/shared/notices.js"), "utf8");
let browser: Browser;
let page: Page;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});
const open = async (html: string) => {
  await page?.close();
  page = await browser.newPage({ viewport: { width: 400, height: 600 } });
  await page.setContent(`<!doctype html><style>html,body{margin:0;height:100%;font:16px sans-serif}</style>${html}`);
  await page.addScriptTag({ content: NOTICES });
};
const rect = (sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) }; }, sel);
const settle = () => page.waitForTimeout(400);

const COMPOSER = `<form class="composer" style="position:fixed;left:0;right:0;bottom:0;height:70px;display:flex;gap:6px;padding:10px"><textarea id="box" style="flex:1"></textarea><button>Send</button></form>`;
const TOAST = `<div class="toast" style="position:fixed;left:50%;bottom:20px;translate:-50% 0;width:240px;height:50px">Saved</div>`;

describe("out of the way of typing", () => {
  it("a notice over the box being typed in slides just above it, still centred; back home once nothing's in its way", async () => {
    await open(`<input id="box" style="position:fixed;left:40px;right:40px;bottom:16px;height:56px;box-sizing:border-box">` + TOAST);
    const before = await rect(".toast");
    await page.focus("#box");
    await settle();
    const moved = await rect(".toast");
    expect(moved.bottom).toBeLessThanOrEqual((await rect("#box")).top);
    expect(moved.left).toBe(before.left); // (its own centring kept)
    await page.evaluate(() => document.getElementById("box")!.remove());
    await page.evaluate(() => (window as any).NovaNotices.place());
    await settle();
    expect(await rect(".toast")).toEqual(before);
  });
  it("it goes where it covers the fewest buttons (a row of buttons along the bottom: it rises above them)", async () => {
    await open(`<div style="position:fixed;left:0;right:0;bottom:10px;display:flex;gap:4px">${"<button style='flex:1;height:60px'>Go</button>".repeat(4)}</div>` + TOAST);
    await page.evaluate(() => (window as any).NovaNotices.place());
    await settle();
    expect((await rect(".toast")).bottom).toBeLessThanOrEqual(600 - 70);
  });
  it("never over Nova Agent's tiles or top panel", async () => {
    await open(`<nav id="tabbar" style="position:fixed;left:0;right:0;bottom:0;height:120px"></nav>` + TOAST);
    await page.evaluate(() => (window as any).NovaNotices.place());
    await settle();
    expect((await rect(".toast")).bottom).toBeLessThanOrEqual(600 - 120);
  });
  it("an overlay someone is using is never moved", async () => {
    await open(COMPOSER + `<div data-overlay id="card" style="position:fixed;left:20px;right:20px;bottom:20px;height:60px"><input id="in"></div>`);
    await page.focus("#in");
    await settle();
    expect((await rect("#card")).bottom).toBe(580);
  });
  it("a message box is kept clear even before it's tapped (a notice never sits over where someone's about to type)", async () => {
    await open(COMPOSER);
    await page.evaluate((t) => document.body.insertAdjacentHTML("beforeend", t), TOAST);
    await settle();
    expect((await rect(".toast")).bottom).toBeLessThanOrEqual((await rect(".composer")).top);
  });
  it("a notice that turns up while someone's typing is put out of the way straight away", async () => {
    await open(COMPOSER);
    await page.focus("#box");
    await page.evaluate((t) => document.body.insertAdjacentHTML("beforeend", t), TOAST);
    await settle();
    expect((await rect(".toast")).bottom).toBeLessThanOrEqual((await rect(".composer")).top);
  });
  it("a notice nowhere near the box stays where it is", async () => {
    await open(`<input id="top" style="position:fixed;top:10px;left:10px">` + TOAST);
    const before = await rect(".toast");
    await page.focus("#top");
    await settle();
    expect(await rect(".toast")).toEqual(before);
  });
  it("nothing else on the page moves", async () => {
    await open(COMPOSER + TOAST);
    const form = await rect(".composer");
    await page.focus("#box");
    await settle();
    expect(await rect(".composer")).toEqual(form);
  });
});

describe("out of the way of dragging", () => {
  it("while something is dragged, notices fade right down and let the pointer through; back when it's let go", async () => {
    await open(`<div id="table" style="position:absolute;inset:0"></div>` + TOAST);
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(160, 160, { steps: 4 });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".toast")!).pointerEvents)).toBe("none");
    await page.mouse.up();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".toast")!).pointerEvents)).not.toBe("none");
  });
});
