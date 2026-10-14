// No big gaps: every panel, opened inside Nova Agent (Nova Bot's answers from the samples file, like
// check-fit.mjs), at computer sizes up to a big screen, is checked for
//   · every panel frame sitting in the panel's box (#viewer-body), one showing at a time,
//   · the panel's frame filling that box and stopping above the navigation panel,
//   · the panel's page not scrolled (the page itself never moves; boxes inside it do),
//   · its content starting at the top (no big empty band above its header).
// All the panels are opened one after another in the same page, twice round, so the kept-loaded
// frames fill up and the oldest (the page's first frame too) are let go, as after a long session.
//   node scripts/check-gaps.mjs http://localhost:4721 [--sizes 2048x1150,1440x900] [--only index,notes] [--shots dir]
// Against a throwaway Nova Agent (see scripts/check-fit-all.sh, which runs this too).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const SIZES = (opt("sizes") || "2048x1150,1440x900,1280x800").split(",").map((s) => s.split("x").map(Number));
const ONLY = opt("only") ? opt("only").split(",") : null;
const SHOTS = opt("shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PANELS = { portal: "/portal/", calendar: "/calendar/", notes: "/notes/", board: "/board/", index: "/app/memory/", quests: "/quests/", lossless: "/lossless/", visualizer: "/visualizer", fixer: "/fixer/", console: "/console/", observatory: "/observatory/" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function look(tab, path) {
  let f;
  for (let i = 0; i < 60 && !(f = tab.frames().find((x) => x !== tab.mainFrame() && !x.isDetached() && new URL(x.url()).pathname.startsWith(path))); i++) await sleep(200);
  if (!f) return ["didn't open"];
  await f.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(1500);
  const host = await tab.evaluate(() => {
    const box = document.getElementById("viewer-body");
    const frames = [...document.querySelectorAll("#viewer iframe")];
    const shown = frames.filter((x) => !x.hidden && x.getBoundingClientRect().height > 0);
    const outside = frames.filter((x) => x.parentElement !== box).length;
    const fr = document.getElementById("viewer-frame").getBoundingClientRect();
    const bx = box.getBoundingClientRect();
    const bars = [...document.querySelectorAll("nav, .dock, #dock")].map((el) => el.getBoundingClientRect()).filter((b) => b.height > 30 && b.width > 200 && b.top > innerHeight / 2);
    const barTop = bars.length ? Math.min(...bars.map((b) => b.top)) : innerHeight;
    return { outside, shown: shown.length, frame: [fr.top, fr.bottom, fr.height], box: [bx.top, bx.bottom, bx.height], barTop };
  });
  // (wait for the panel to draw something: up to 10 s)
  let inner;
  for (let i = 0; i < 20; i++) {
    inner = await f.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    let first = null;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      const leaf = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|svg|CANVAS|VIDEO|A|H1|H2|H3|P|LABEL)$/.test(el.tagName) || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!leaf || el.closest("[aria-hidden='true'], .sr-only, .visually-hidden")) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4 || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) continue;
      if (first == null || b.top < first) first = b.top;
    }
    return { H: innerHeight, scroll: Math.max(se.scrollTop, document.body ? document.body.scrollTop : 0), first };
    });
    if (inner.first != null) break;
    await sleep(500);
  }
  const bad = [];
  if (host.outside) bad.push(`${host.outside} panel frame(s) outside the panel's box`);
  if (host.shown !== 1) bad.push(`${host.shown} panel frames showing at once`);
  if (Math.abs(host.frame[2] - host.box[2]) > 4 || Math.abs(host.frame[0] - host.box[0]) > 4) bad.push(`the panel doesn't fill its box (frame ${Math.round(host.frame[0])}–${Math.round(host.frame[1])}, box ${Math.round(host.box[0])}–${Math.round(host.box[1])})`);
  if (host.frame[1] > host.barTop + 2) bad.push(`the panel runs on behind the navigation panel by ${Math.round(host.frame[1] - host.barTop)}px`);
  if (inner.scroll > 0) bad.push(`the panel's page is scrolled by ${Math.round(inner.scroll)}px`);
  if (inner.first == null) console.log(`  (${path}: nothing drawn yet: offline locally, not counted)`);
  else if (inner.first > Math.max(140, inner.H * 0.2)) bad.push(`an empty band at the top: the first thing drawn is ${Math.round(inner.first)}px down`);
  return bad;
}

const browser = await chromium.launch();
let problems = 0;
const list = Object.entries(PANELS).filter(([name]) => !ONLY || ONLY.includes(name));
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const tab = await ctx.newPage();
  await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
    const u = new URL(r.request().url());
    const body = portalMock(u.pathname + u.search, r.request().method());
    return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
  });
  await tab.goto(`${BASE}/agent/?open=${encodeURIComponent(list[0][1])}`, { waitUntil: "domcontentloaded" });
  await tab.waitForSelector("#viewer-frame", { state: "attached" });
  // Twice round (and enough panels to go past the six kept loaded, even with --only)
  const laps = list.length > 6 ? 2 : Math.ceil(14 / list.length);
  for (let lap = 1; lap <= laps; lap++) {
    for (const [name, path] of list) {
      if (lap > 1 || name !== list[0][0]) await tab.evaluate((p) => { document.getElementById("viewer-frame").src = new URL(p, location.href).href; }, path);
      const bad = await look(tab, path).catch((e) => [`couldn't look: ${e.message.split("\n")[0]}`]);
      const at = `${name} (round ${lap}) ${w}×${h}`;
      console.log(`${bad.length ? "✗" : "✓"} ${at}${bad.length ? ": " + bad.join("; ") : ""}`);
      if (bad.length) problems++;
      if (SHOTS && (bad.length || lap === laps)) await tab.screenshot({ path: `${SHOTS}/${name}-${lap}-${w}x${h}.png` }).catch(() => {});
    }
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} with a gap or overlap` : "\nNo big gaps anywhere");
process.exit(problems ? 1 : 0);
