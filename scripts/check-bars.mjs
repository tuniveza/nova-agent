// The bars, measured: does an open panel jump when the panels bar (bottom) or Nova Agent's top bar
// comes and goes, how long each move takes, and does the bar above an open panel look like Nova
// Agent's own top bar (same height, corners, edge and title size)?
// For each size it opens a panel inside Nova Agent, then brings the bars in and sends them away
// (the mouse at the edges on a computer, scrolling on a phone) and records, every animation frame:
// the panel frame's box, the panel page's own size (a resize inside it = its page reflowed) and
// when the bar's movement finished.
//
// Against a throwaway server (see scripts/check-fit.mjs's header):
//   node scripts/check-bars.mjs http://localhost:4721 [--sizes 1440x900,390x844] [--panel /portal/]
// Exits 1 when a panel jumps, a move is set to take longer than 200 ms, or the two top bars don't match.
import { chromium } from "playwright";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const SIZES = (opt("sizes") || "1440x900,1024x768,390x844").split(",").map((s) => s.split("x").map(Number));
const PANEL = opt("panel") || "/portal/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = (w, h) => w <= 980 || h <= 480;

const browser = await chromium.launch();
let bad = 0;
const fail = (msg) => { bad++; console.log(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

for (const [w, h] of SIZES) {
  const phone = PHONE(w, h);
  console.log(`\n${w}×${h}${phone ? " (phone)" : ""}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone && w < 600 });
  const tab = await ctx.newPage();
  await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith("/app/memory")) return r.fallback();
    const body = portalMock(u.pathname + u.search, r.request().method());
    return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
  });
  // Home first: the top bar's look
  await tab.goto(`${BASE}/agent/`, { waitUntil: "domcontentloaded" });
  await sleep(1800);
  const look = (sel) => tab.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const word = [...el.querySelectorAll(".wordmark, .vn-text")].find((x) => x.getBoundingClientRect().width > 0);
    const mark = el.querySelector("svg.mark, .mark-alt, .vn-ico");
    const markBox = mark && [...el.querySelectorAll("svg.mark, .mark-alt, .vn-ico")].map((m) => m.getBoundingClientRect()).find((b) => b.width > 0);
    return { h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top), radius: cs.borderTopLeftRadius, bg: cs.backgroundImage.slice(0, 60),
      word: word ? getComputedStyle(word).fontSize : "", mark: markBox ? Math.round(markBox.width) : 0, shown: cs.display !== "none" && r.height > 0 };
  }, sel);
  const homeTop = await look(".shell > .topbar");
  // Open the panel the way a tap does
  await tab.evaluate((p) => window.NovaAgent.open(p), PANEL);
  await sleep(2500);
  const panelTop = await look(".shell > .topbar"); // the header, now the panel's slim title panel
  if (!homeTop || !panelTop) fail(`a top bar is missing (home ${!!homeTop}, panel ${!!panelTop})`);
  else if (!panelTop.shown) fail("the open panel has no top bar");
  else {
    // One title panel: with a panel open it's exactly the home's header (the same height, width and look)
    const slim = panelTop.h === homeTop.h && panelTop.w === homeTop.w && panelTop.h <= 56 && homeTop.bg === panelTop.bg;
    (slim ? ok : fail)(`one top bar: home ${homeTop.h}px · as the panel's title panel ${panelTop.h}px, title ${panelTop.word}, mark ${panelTop.mark}px${homeTop.bg === panelTop.bg ? "" : " · different backgrounds"}`);
    const two = await tab.evaluate(() => [...document.querySelectorAll(".nv-topbar")].filter((e) => e.getBoundingClientRect().height > 0).length);
    (two === 1 ? ok : fail)(`bars at the top with a panel open: ${two}`);
    const moved = Math.abs(homeTop.top - panelTop.top), wider = Math.abs(homeTop.w - panelTop.w);
    (moved <= 12 ? ok : fail)(`the top bar stays put when a panel opens (moved ${moved}px, ${homeTop.w}px wide → ${panelTop.w}px)`);
    // Every control in the title panel is a big target: 40px on a computer, 44px on a phone
    const need = phone ? 44 : 40;
    const small = await tab.evaluate((need) => [...document.querySelectorAll(".shell > .topbar :is(button, a, .status, nova-portal-badge, nova-manual, [role=button])")]
      .map((e) => ({ e, b: e.getBoundingClientRect() })).filter(({ b }) => b.width > 0 && b.height > 0 && (b.width < need - 0.5 || b.height < need - 0.5))
      .filter(({ e }) => !e.closest("nova-portal-badge, nova-manual") || e.matches("nova-portal-badge, nova-manual"))
      .map(({ e, b }) => `${e.id || e.tagName.toLowerCase()} ${Math.round(b.width)}×${Math.round(b.height)}`), need);
    (small.length ? fail : ok)(`every title panel control at least ${need}px${small.length ? ": too small: " + small.join(", ") : ""}`);
  }

  // Watch the panel and the bars, frame by frame, while something happens
  await tab.evaluate(() => {
    const frame = document.getElementById("viewer-frame");
    const log = (window.__barLog = { boxes: new Set(), inner: new Set(), resizes: 0, ends: [], starts: [] });
    const fw = frame.contentWindow;
    fw.addEventListener("resize", () => log.resizes++);
    for (const el of [document.getElementById("suite-home"), document.getElementById("tabbar"), document.querySelector(".shell > .topbar")]) {
      if (!el) continue;
      el.addEventListener("transitionrun", (e) => { if (e.target === el && e.propertyName === "transform") log.starts.push(performance.now()); });
      el.addEventListener("transitionend", (e) => { if (e.target === el && e.propertyName === "transform") log.ends.push(performance.now()); });
    }
    const tick = () => {
      const b = frame.getBoundingClientRect();
      log.boxes.add(`${Math.round(b.top)},${Math.round(b.height)}`);
      log.inner.add(`${fw.innerWidth}x${fw.innerHeight}`);
      if (!window.__barStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const stateNow = () => tab.evaluate(() => ({ tucked: document.documentElement.classList.contains("bar-tucked"), top: document.documentElement.classList.contains("top-tucked") }));
  const before = await stateNow();
  // (the panel's frame: by its address, else the viewer's frame)
  const fr = tab.frames().find((f) => f !== tab.mainFrame() && f.url().includes(PANEL.replace(/\/$/, "")))
    || (await (await tab.$("#viewer-frame"))?.contentFrame());
  if (phone && !fr) console.log("  (the panel's frame wasn't found: scrolling not tried)");
  if (phone && fr) {
    // Scroll the panel's page down a good way, then up a little, then down again
    // (no taps: the bars no longer come and go with touches, and a tap could open something)
    const swipe = async (dy) => {
      for (let i = 0; i < 6; i++) {
        await fr.evaluate((d) => { const s = [...document.querySelectorAll("*")].find((e) => e.scrollHeight - e.clientHeight > 300 && /auto|scroll/.test(getComputedStyle(e).overflowY)) || document.scrollingElement; s.scrollBy(0, d); }, dy / 6);
        await sleep(30);
      }
      await sleep(450);
    };
    await tab.evaluate(() => window.NovaBar && window.NovaBar.reveal());
    await sleep(400);
    await swipe(500);
    const a = await stateNow();
    await swipe(-120);
    const b = await stateNow();
    await swipe(400);
    const c = await stateNow();
    console.log(`  bar after: down ${a.tucked ? "away" : "shown"} · up ${b.tucked ? "away" : "shown"} · down ${c.tucked ? "away" : "shown"}`);
  } else {
    // The mouse rests at the bottom edge (the bar comes), then works up in the panel (it goes),
    // then at the top edge (the top bar comes) and back down (it goes)
    const move = async (y, ms) => { await tab.mouse.move(w / 2, y, { steps: 4 }); await sleep(ms); };
    await move(h / 2, 900);
    await move(h - 4, 700);
    const a = await stateNow();
    await move(h / 2, 1200);
    const b = await stateNow();
    await move(3, 700);
    const c = await stateNow();
    await move(h / 2, 1200);
    const d = await stateNow();
    console.log(`  bar: edge ${a.tucked ? "away" : "shown"} → middle ${b.tucked ? "away" : "shown"} · top bar: edge ${c.top ? "away" : "shown"} → middle ${d.top ? "away" : "shown"}`);
  }
  const log = await tab.evaluate(() => { window.__barStop = true; const l = window.__barLog; return { boxes: [...l.boxes], inner: [...l.inner], resizes: l.resizes, starts: l.starts, ends: l.ends }; });
  (log.boxes.length <= 1 && log.resizes === 0 ? ok : fail)(`the panel kept still (${log.boxes.length} frame boxes: ${log.boxes.join(" | ")}; its page resized ${log.resizes}×: ${log.inner.join(" | ")})`);
  // Each move's length as set (what a real screen shows), and as seen here, from its start to the
  // matching end (a headless browser draws few frames a second, so this one runs long)
  const set = await tab.evaluate(() => {
    const out = [];
    for (const tucked of [false, true]) {
      document.documentElement.classList.toggle("bar-tucked", tucked);
      document.documentElement.classList.toggle("top-tucked", tucked);
      for (const el of [document.getElementById("suite-home"), document.getElementById("tabbar"), document.querySelector(".shell > .topbar")]) {
        if (!el || getComputedStyle(el).display === "none") continue;
        const cs = getComputedStyle(el), names = cs.transitionProperty.split(", "), durs = cs.transitionDuration.split(", "), dels = cs.transitionDelay.split(", ");
        const i = names.findIndex((n) => n === "transform" || n === "all");
        if (i >= 0) out.push(Math.round((parseFloat(durs[i % durs.length]) + parseFloat(dels[i % dels.length])) * 1000));
      }
    }
    return out;
  });
  if (set.length) (Math.max(...set) <= 200 ? ok : fail)(`bar moves are set to ${[...new Set(set)].join(", ")} ms`);
  const lens = log.starts.map((s) => { const e = log.ends.find((t) => t > s); return e ? Math.round(e - s) : null; }).filter((x) => x != null);
  console.log(lens.length ? `  (seen here: ${lens.join(", ")} ms)` : `  (no bar moves seen; before: ${JSON.stringify(before)})`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad} problem(s)` : "\nAll good");
process.exit(bad ? 1 : 0);
