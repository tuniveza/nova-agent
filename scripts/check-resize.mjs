// Resizing: does every part of Nova Agent lay itself out again when the window changes size?
// Opens Nova Agent's home and each panel inside it, then drags the window through many sizes
// WITHOUT reloading. At each size it takes the measurements of the main parts (the bars, the
// status line, the open panel's frame, Portal's tabs, sticky offsets, sideways scrolling, scroll
// boxes, things hanging off the screen) and compares them with a fresh page opened at that same
// size. Anything that differs was left at an old size: a resize bug.
//
// Against a throwaway server (see scripts/check-fit.mjs's header):
//   FIT_DATA_DIR=$D node scripts/check-resize.mjs http://localhost:4751 [--only home,portal]
//     [--shots /some/folder] [--scale 1.25] [--verbose]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const ONLY = opt("only") ? opt("only").split(",") : null;
const SHOTS = opt("shots");
const SCALE = Number(opt("scale")) || 1;
const VERBOSE = args.includes("--verbose");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = {
  home: "",
  portal: "/portal/",
  notes: "/notes/",
  calendar: "/calendar/",
  index: "/app/memory/",
  observatory: "/observatory/",
  fixer: "/fixer/",
  lossless: "/lossless/",
};
// Dragging the window: down through the breakpoints and back up, then the height
const WIDTHS = [1920, 1700, 1366, 1180, 1024, 981, 980, 900, 761, 760, 600, 390, 600, 760, 761, 980, 981, 1180, 1700];
const HEIGHTS = [1080, 900, 700, 500, 900];
const STEPS = [...WIDTHS.map((w) => [w, 900]), ...HEIGHTS.map((h) => [1700, h])];

// Measured in each document (Nova Agent's page, and the open panel's)
function measure() {
  const vw = innerWidth, vh = innerHeight;
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden" || el.classList.contains("nebula") || (b.width === 0 && b.height === 0)) return "hidden"; return [b.left, b.top, b.width, b.height].map((v) => Math.round(v)); };
  const SEL = ["#shell", ".tabbar", "#status-line", "#viewer", "#viewer-frame", "#main", ".main", "body > header", ".top", ".app > .top", "nav.tabs", ".embed-head", "main", "#suite-home", ".topbar", "#composer"];
  const rects = {};
  for (const s of SEL) { const el = document.querySelector(s); if (el) rects[s] = r(el); }
  const root = getComputedStyle(document.documentElement);
  const vars = {};
  for (const v of ["--top-h", "--htabs-h", "--bar-h", "--status-h", "--vh", "--app-h", "--tg-inset"]) { const x = (root.getPropertyValue(v) || document.querySelector("nav.tabs")?.style.getPropertyValue(v) || "").trim(); if (x) vars[v] = x; }
  const se = document.scrollingElement || document.documentElement;
  const hscroll = se.scrollWidth > se.clientWidth + 1;
  // Boxes you can scroll up and down (a scroll inside a scroll that both show bars = a double scrollbar)
  let scrollers = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.clientHeight < 80) continue;
    if (el.scrollHeight > el.clientHeight + 2 && el.getBoundingClientRect().height > 0) scrollers++;
  }
  const pageScroll = se.scrollHeight > se.clientHeight + 2 && getComputedStyle(document.body).overflowY !== "hidden";
  // Things hanging off the right or bottom edge that aren't inside something that scrolls or clips
  let off = 0;
  const offList = [];
  for (const el of document.querySelectorAll("body *")) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    if (b.right <= vw + 1 && b.left >= -1) continue;
    if (b.right <= 0 || b.left >= vw) continue; // wholly off to one side: a drawer tucked away, not cut off
    if (el.closest(".nebula, .sky, #sky, .stars, [aria-hidden='true'].backdrop") || getComputedStyle(el).pointerEvents === "none" && getComputedStyle(el).position === "fixed") continue;
    let p = el.parentElement, clipped = false;
    while (p && p !== document.body) { const cs = getComputedStyle(p); if (cs.overflowX !== "visible" || cs.overflow !== "visible") { clipped = true; break; } p = p.parentElement; }
    const cs = getComputedStyle(el);
    if (clipped || cs.position === "fixed" && cs.visibility === "hidden") continue;
    off++;
    if (offList.length < 4) offList.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0]).slice(0, 40));
  }
  return { vw, vh, rects, vars, hscroll, scrollers, pageScroll, off, offList, data: { status: document.documentElement.dataset.status || "", bars: document.documentElement.dataset.bars || "" } };
}

async function newTab(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: SCALE });
  const tab = await ctx.newPage();
  await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/app/memory")) return r.fallback();
    const body = portalMock(u.pathname + u.search, r.request().method());
    return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
  });
  return { ctx, tab };
}
const url = (path) => `${BASE}/agent/${path ? "?open=" + encodeURIComponent(path) : ""}`;
async function frames(tab, path) {
  const out = [["agent", tab.mainFrame()]];
  if (path) {
    for (let i = 0; i < 40; i++) {
      const f = tab.frames().find((x) => x !== tab.mainFrame() && x.url().includes(path.replace(/\/$/, "")));
      if (f) { out.push(["panel", f]); break; }
      await sleep(150);
    }
  }
  return out;
}
async function take(tab, path) {
  const res = {};
  for (const [name, f] of await frames(tab, path)) res[name] = await f.evaluate(measure).catch((e) => ({ error: e.message.split("\n")[0] }));
  return res;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function compare(dragged, fresh) {
  const diffs = [];
  for (const doc of new Set([...Object.keys(dragged), ...Object.keys(fresh)])) {
    const d = dragged[doc] || {}, f = fresh[doc] || {};
    if (d.error || f.error) { diffs.push(`${doc}: ${d.error || f.error}`); continue; }
    for (const s of new Set([...Object.keys(d.rects || {}), ...Object.keys(f.rects || {})])) {
      const a = d.rects?.[s], b = f.rects?.[s];
      if (Array.isArray(a) && Array.isArray(b)) { if (a.some((v, i) => Math.abs(v - b[i]) > 3)) diffs.push(`${doc} ${s}: dragged ${a} vs fresh ${b}`); }
      else if (!same(a, b)) diffs.push(`${doc} ${s}: dragged ${JSON.stringify(a)} vs fresh ${JSON.stringify(b)}`);
    }
    for (const v of new Set([...Object.keys(d.vars || {}), ...Object.keys(f.vars || {})])) if (Math.abs(parseFloat(d.vars?.[v]) - parseFloat(f.vars?.[v])) > 3 || (!d.vars?.[v]) !== (!f.vars?.[v])) diffs.push(`${doc} ${v}: dragged ${d.vars?.[v]} vs fresh ${f.vars?.[v]}`);
    for (const k of ["hscroll", "pageScroll"]) if (d[k] !== f[k]) diffs.push(`${doc} ${k}: dragged ${d[k]} vs fresh ${f[k]}`);
    if (d.scrollers !== f.scrollers) diffs.push(`${doc} scroll boxes: dragged ${d.scrollers} vs fresh ${f.scrollers}`);
    if (d.off !== f.off) diffs.push(`${doc} off-screen: dragged ${d.off} (${d.offList}) vs fresh ${f.off} (${f.offList})`);
  }
  return diffs;
}
// Problems at a size whatever the history (a fresh page has them too)
function always(m) {
  const out = [];
  for (const [doc, x] of Object.entries(m)) {
    if (x.error) continue;
    if (x.hscroll) out.push(`${doc}: the page scrolls sideways`);
    if (x.off) out.push(`${doc}: ${x.off} thing(s) hang off the screen (${x.offList})`);
  }
  const a = m.agent?.rects || {};
  const fr = a["#viewer-frame"], st = a["#status-line"];
  if (Array.isArray(fr) && Array.isArray(st) && st[1] < fr[1] + fr[3] - 1 && st[1] + st[3] > fr[1] + 1 && st[0] < fr[0] + fr[2] && st[0] + st[2] > fr[0]) out.push(`agent: the status line covers the open panel (${st} over ${fr})`);
  if (Array.isArray(fr) && m.agent && fr[1] + fr[3] > m.agent.vh + 1) out.push(`agent: the panel's frame runs past the bottom (${fr}, window ${m.agent.vh})`);
  return out;
}

const browser = await chromium.launch();
const freshCache = new Map();
async function fresh(path, w, h) {
  const k = `${path}|${w}x${h}`;
  if (freshCache.has(k)) return freshCache.get(k);
  const { ctx, tab } = await newTab(w, h);
  await tab.goto(url(path), { waitUntil: "domcontentloaded" });
  await sleep(path ? 3500 : 2500);
  const m = await take(tab, path);
  await ctx.close();
  freshCache.set(k, m);
  return m;
}

let bad = 0;
const report = new Map();
const add = (msg, at) => { if (!report.has(msg)) report.set(msg, []); report.get(msg).push(at); bad++; };
for (const [name, path] of Object.entries(TARGETS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const { ctx, tab } = await newTab(STEPS[0][0], STEPS[0][1]);
  const errs = [];
  tab.on("pageerror", (e) => errs.push(e.message.split("\n")[0]));
  await tab.goto(url(path), { waitUntil: "domcontentloaded" });
  await sleep(path ? 3500 : 2500);
  for (const [w, h] of STEPS) {
    await tab.setViewportSize({ width: w, height: h });
    await sleep(700);
    const m = await take(tab, path);
    const at = `${name} ${w}×${h}`;
    for (const p of always(m)) add(`${name}: ${p}`, at);
    const f = await fresh(path, w, h);
    for (const d of compare(m, f)) add(`${name}: after resizing, ${d}`, at);
    if (SHOTS) await tab.screenshot({ path: `${SHOTS}/${name}-${w}x${h}.png` });
  }
  for (const e of new Set(errs)) add(`${name}: page error: ${e}`, name);
  await ctx.close();
}
await browser.close();
const lines = [...report.entries()].map(([msg, at]) => `${msg}\n    at ${[...new Set(at)].slice(0, VERBOSE ? 99 : 6).join(", ")}${at.length > 6 && !VERBOSE ? ` (+${at.length - 6})` : ""}`);
console.log(lines.join("\n"));
console.log(bad ? `\n${report.size} kinds of problem (${bad} in all)` : "\nEverything re-lays out when resized");
process.exit(bad ? 1 : 0);
