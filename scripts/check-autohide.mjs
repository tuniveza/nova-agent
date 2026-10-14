// Auto show and hide of the title panel and the navigation panel (web/agent/assets/bar.js), in a
// browser: at each size, on the home and with a panel open,
//   · the mouse away for 1.5 s sends both away, and the content then fills the room: its box is
//     as tall as the window minus the bars still showing (and the page's own edges),
//   · the mouse at the top or bottom edge brings that bar back, and it's fully in within one
//     frame plus 120 ms (and the content takes the room back at once, not during the slide),
//   · a bar with the keyboard in it never goes,
//   · Always shown never moves; Always hidden starts away,
//   · no long task (over 50 ms) on Nova Agent's page while the bars move.
// On a phone size the bars go after scrolling down in the panel and come back scrolling up.
//   node scripts/check-autohide.mjs http://localhost:4721 [--sizes 1440x900,390x844] [--panel /notes/]
import { chromium } from "playwright";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const SIZES = (opt("sizes") || "2000x1130,1440x900,1024x768,390x844").split(",").map((s) => s.split("x").map(Number));
const PANEL = opt("panel") || "/notes/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { console.log(`  ✗ ${m}`); problems++; };

// (the GPU, as on a real computer: without it the page draws at about 10 frames a second and no
// timing means anything)
const browser = await chromium.launch({ args: ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl-egl"] });
for (const [w, h] of SIZES) {
  const phone = w <= 980 || h <= 480;
  console.log(`\n${w}×${h}${phone ? " (phone)" : ""}`);
  let ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone && w < 600 });
  let tab = await ctx.newPage();
  await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
    const u = new URL(r.request().url());
    const body = portalMock(u.pathname + u.search, r.request().method());
    return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
  });
  await tab.goto(`${BASE}/agent/`, { waitUntil: "domcontentloaded" });
  await tab.waitForFunction(() => window.NovaBar && window.NovaBar.state);
  await sleep(1200);
  // Long tasks on Nova Agent's page from here on
  await tab.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: "longtask" }); });

  // The room the content has, against the window minus the bars that show
  const geometry = () => tab.evaluate(() => {
    const rect = (el) => (el ? el.getBoundingClientRect() : null);
    const shown = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.display !== "none" && cs.position !== "fixed" && +cs.opacity > 0.5; };
    const homeBox = document.querySelector(".main > .chat");
    const top = document.querySelector(".shell > .topbar");
    const phone = matchMedia("(max-width: 980px), (max-height: 480px)").matches;
    const nav = phone ? document.getElementById("tabbar") : document.getElementById("suite-home");
    const main = document.getElementById("main");
    const viewing = main.classList.contains("viewing");
    const box = viewing ? document.getElementById("viewer-body") : homeBox;
    const shell = getComputedStyle(document.getElementById("shell"));
    const pad = parseFloat(shell.paddingTop) + parseFloat(shell.paddingBottom);
    const gap = parseFloat(shell.rowGap) || 0;
    const tb = rect(top), nb = rect(nav), bb = rect(box);
    const topIn = shown(top), navIn = shown(nav);
    // The content's box: from the bottom of the title panel (or the window's top edge) to the top of
    // the navigation panel (or the window's bottom edge)
    const from = topIn ? tb.bottom : 0, to = navIn ? nb.top : innerHeight;
    return { topIn, navIn, boxTop: bb.top, boxBottom: bb.bottom, boxH: bb.height, from, to, room: to - from, pad, gap, state: window.NovaBar.state() };
  });
  // The content fills the room (allowing the page's own edge and the gaps between rows: 32px)
  const fills = (g) => g.boxH >= g.room - 40 && g.boxTop >= g.from - 1 && g.boxBottom <= g.to + 1;

  for (const where of ["home", "panel"]) {
    if (where === "panel") { await tab.evaluate((p) => window.NovaAgent.open(p), PANEL); await sleep(2500); }
    const at = where === "home" ? "home" : `panel ${PANEL}`;
    await tab.evaluate(() => { window.NovaBar.setMode("auto"); window.NovaBar.setTopMode("auto"); window.NovaBar.reveal(); });
    await sleep(300);
    const before = await geometry();
    (before.topIn && before.navIn && fills(before) ? ok : fail)(`${at}: both bars in, the content fills between them (${Math.round(before.boxH)}px of ${Math.round(before.room)}px)`);

    // Away
    if (phone) {
      // as after a finger scrolled down a good way inside the panel (the emulated mouse out of the
      // way first: resting on the top edge, it would bring the title panel straight back)
      await tab.mouse.move(w / 2, h / 2);
      await tab.evaluate(() => window.NovaBar.tuck());
    } else {
      await tab.mouse.move(w / 2, h / 2);
      await tab.mouse.move(w / 2 + 3, h / 2 + 3);
      await sleep(1500 + 400);
    }
    await sleep(250);
    const away = await geometry();
    (!away.topIn && !away.navIn ? ok : fail)(`${at}: ${phone ? "sent away" : "the mouse away 1.5 s"}: both bars away (${JSON.stringify(away.state)})`);
    (fills(away) && away.boxH > before.boxH + 40 ? ok : fail)(`${at}: the content grows into the room (${Math.round(before.boxH)} → ${Math.round(away.boxH)}px, room ${Math.round(away.room)}px)`);

    // Back: the edge (mouse) or the edge strip (tap); fully in within a frame + 120 ms
    for (const side of ["top", "bottom"]) {
      await sleep(400); // (each on its own: the one before has taken its row back)
      const t = await tab.evaluate(async (side) => {
        const el = side === "top" ? document.querySelector(".shell > .topbar") : (matchMedia("(max-width: 980px), (max-height: 480px)").matches ? document.getElementById("tabbar") : document.getElementById("suite-home"));
        const t0 = performance.now();
        const boxH0 = document.getElementById(document.getElementById("main").classList.contains("viewing") ? "viewer-body" : "main").getBoundingClientRect().height;
        document.getElementById(side === "top" ? "top-peek" : "bar-peek").click();
        // Watch each frame until it's fully in (opacity 1, no transform)
        // Every frame until it's fully in: the content's size while the bar is still moving (it
        // must not change then), and the slow frames (over 50 ms) in that time
        const moving = [];
        const slow = [];
        const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.startTime + e.duration >= t0) slow.push(Math.round(e.duration)); });
        try { po.observe({ type: "long-animation-frame" }); } catch (err) {}
        const boxOf = () => document.getElementById(document.getElementById("main").classList.contains("viewing") ? "viewer-body" : "main").getBoundingClientRect().height;
        return await new Promise((done) => {
          // (when its slide ended, by the browser's own clock: a later frame can be slow for other reasons)
          let ended = 0;
          el.addEventListener("transitionend", (e) => { if (e.target === el && e.propertyName === "transform" && !ended) ended = e.timeStamp; });
          const finish = (ms) => { po.disconnect(); done({ ms: ended ? Math.round(ended - t0) : ms, sizes: [...new Set(moving)], boxH0: Math.round(boxH0), slow }); };
          const tick = () => {
            const cs = getComputedStyle(el);
            const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
            if (+cs.opacity >= 0.999 && Math.abs(m.m42) < 0.5) return finish(Math.round(performance.now() - t0));
            moving.push(Math.round(boxOf()));
            if (performance.now() - t0 > 1000) return finish(9999);
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }, side);
      (t.ms <= 17 + 120 + 20 ? ok : fail)(`${at}: the ${side === "top" ? "title" : "navigation"} panel is back in ${t.ms} ms (within a frame + 120 ms)`);
      // The content changed size once (at the start), not during the slide
      (t.sizes.length <= 1 ? ok : fail)(`${at}: the content kept still while it slid in, then resized once (sizes while sliding: ${t.sizes.join(", ") || "-"}; before ${t.boxH0})`);
      (!t.slow.length ? ok : fail)(`${at}: no slow frame (over 50 ms) while it slid in${t.slow.length ? ` (${t.slow.join(", ")} ms)` : ""}`);
    }
    await sleep(250); // (the last one takes its row back as its slide ends)
    const back = await geometry();
    (back.topIn && back.navIn && fills(back) ? ok : fail)(`${at}: both back, the content fills between them again (${Math.round(back.boxH)}px of ${Math.round(back.room)}px; ${JSON.stringify(back.state)})`);

    if (!phone) {
      // The keyboard in the title panel: it stays
      await tab.evaluate(() => { window.NovaBar.reveal(); const b = [...document.querySelectorAll(".shell > .topbar button")].find((x) => x.getBoundingClientRect().width > 0); b && b.focus(); });
      await tab.mouse.move(w / 2, h / 2);
      await tab.mouse.move(w / 2 + 4, h / 2 + 4);
      await sleep(1900);
      const s = await tab.evaluate(() => window.NovaBar.state());
      (s.top === "in" ? ok : fail)(`${at}: with the keyboard in the title panel it stays (${s.top})`);
      await tab.evaluate(() => document.activeElement && document.activeElement.blur());
      // Always shown: never moves
      await tab.evaluate(() => { window.NovaBar.setMode("shown"); window.NovaBar.setTopMode("shown"); });
      await tab.mouse.move(w / 2, h / 2 + 10);
      await sleep(1900);
      const s2 = await tab.evaluate(() => window.NovaBar.state());
      (s2.top === "in" && s2.nav === "in" ? ok : fail)(`${at}: Always shown stays (${JSON.stringify(s2)})`);
      await tab.evaluate(() => { window.NovaBar.setMode("auto"); window.NovaBar.setTopMode("auto"); });
    }
  }
  const long = await tab.evaluate(() => window.__long || []).catch(() => []);
  console.log(`  (long tasks in the whole run, the pages' own re-fitting after a resize included: ${long && long.length ? long.join(", ") + " ms" : "none"})`);
  // Always hidden: away from the start
  // (a fresh window, already set to Always hidden: leaving a page with panels open can be held up)
  await ctx.close();
  ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone && w < 600 });
  await ctx.addInitScript(() => { try { localStorage.setItem("nova-bar-2", "hidden"); localStorage.setItem("nova-top-2", "hidden"); } catch (err) {} });
  tab = await ctx.newPage();
  await tab.mouse.move(w / 2, h / 2); // (not resting on the top edge, which brings the title panel)
  await tab.goto(`${BASE}/agent/`, { waitUntil: "domcontentloaded" });
  await tab.waitForFunction(() => window.NovaBar && window.NovaBar.state);
  await sleep(800);
  const hid = await geometry();
  (!hid.topIn && !hid.navIn && fills(hid) ? ok : fail)(`Always hidden: both away from the start, the content fills the window (${Math.round(hid.boxH)}px of ${Math.round(hid.room)}px; ${JSON.stringify(hid.state)})`);
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} problem(s)` : "\nAll good");
process.exit(problems ? 1 : 0);
