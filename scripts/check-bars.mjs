// The bars, measured: is the title panel over an open panel exactly Nova Agent's own header (the
// same height, width, corners and look, one bar only), is every control in it a big enough target,
// and are the bars' slides set short (at most 120 ms, no wait)? (How they come and go, and the
// content filling the room they leave: scripts/check-autohide.mjs.)
//
// Against a throwaway server (see scripts/check-fit.mjs's header):
//   node scripts/check-bars.mjs http://localhost:4721 [--sizes 1440x900,390x844] [--panel /portal/]
// Exits 1 when the two top bars don't match, a control is too small, or a move is set too long.
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

  // How the bars come and go (Auto, the default): measured in scripts/check-autohide.mjs (the
  // timing, the content filling the room, never resizing during a slide). Here: each move's
  // length as set, coming and going, at most 120 ms with no wait before it starts
  const set = await tab.evaluate(() => {
    const out = [];
    const root = document.documentElement;
    const was = root.className;
    for (const going of [false, true]) {
      root.classList.toggle("top-going", going);
      root.classList.toggle("nav-going", going);
      for (const el of [document.getElementById("suite-home"), document.getElementById("tabbar"), document.querySelector(".shell > .topbar")]) {
        if (!el || getComputedStyle(el).display === "none") continue;
        const cs = getComputedStyle(el), names = cs.transitionProperty.split(", "), durs = cs.transitionDuration.split(", "), dels = cs.transitionDelay.split(", ");
        const i = names.findIndex((n) => n === "transform" || n === "all");
        if (i >= 0) out.push({ ms: Math.round(parseFloat(durs[i % durs.length]) * 1000), wait: Math.round(parseFloat(dels[i % dels.length]) * 1000) });
      }
    }
    root.className = was;
    return out;
  });
  if (set.length) (Math.max(...set.map((x) => x.ms)) <= 120 && set.every((x) => x.wait === 0) ? ok : fail)(`bar moves are set to ${[...new Set(set.map((x) => x.ms))].join(", ")} ms, no wait`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad} problem(s)` : "\nAll good");
process.exit(bad ? 1 : 0);
