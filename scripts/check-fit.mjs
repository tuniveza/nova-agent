// Everything fits: nothing hangs off the screen, and what doesn't fit scrolls inside its own box.
// Opens every panel (on its own in a full-window frame, and inside Nova Agent) and Nova Agent's own
// home, at phone, tablet and computer sizes, with long sample content; opens each sheet, dialog,
// menu and the Manual; and reports every element whose box sticks out past the screen or past the
// box that clips it (where it can't be scrolled to), every bit of text that does, and any sideways
// scrolling of the page itself. Generalises scripts/check-notes-fit.mjs (Notes' own check).
//
// Against a throwaway server (its own data folder, so the sample missions, quests and files can be
// written there):
//   D=$(mktemp -d)/; NOVA_DATA_DIR=$D VISUALIZER_PORT=4721 NOVA_LOCAL_UI=1 AGENT_NOVA_KEY= \
//     NOVA_WORKER_URL=https://worker.test npx tsx src/visualizer/server.ts &
//   FIT_DATA_DIR=$D node scripts/check-fit.mjs http://localhost:4721 [--only portal,calendar]
//     [--sizes 360x640,1280x800] [--shots /some/folder] [--where own|agent] [--manual] [--verbose]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const SIZES = opt("sizes") ? opt("sizes").split(",").map((s) => s.split("x").map(Number)) : [[360, 640], [390, 844], [390, 450], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]; // (390×450: a phone with its keyboard up)
const ONLY = opt("only") ? opt("only").split(",") : null;
const WHERE = opt("where") ? [opt("where")] : ["own", "agent"];
const SHOTS = opt("shots");
const VERBOSE = args.includes("--verbose");
const MANUAL = args.includes("--manual"); // the Manual too (it has its own fixes, so it's left out unless asked)
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- Long sample content ----
const LONG = "A really very long name that keeps on going well past the edge of any phone screen, and then some more";
const WORD = "Averyveryverylongwordwithoutanyspacesatall_0123456789abcdefghijklmnopqrstuvwxyz";
const LINK = "https://example.com/a/really/long/link/with/no/spaces/at/all/0123456789abcdefghijklmnopqrstuvwxyz0123456789";
const today = new Date();
const day = (n, hh = "10:00") => { const d = new Date(today); d.setDate(d.getDate() + n); return `${d.toISOString().slice(0, 10)}T${hh}`; };

function seedData(dir) {
  const now = new Date().toISOString();
  const missions = [0, 1, 2].map((i) => ({
    id: `m${i}`, title: `${LONG} (mission ${i + 1})`, request: `${LONG} ${WORD}`, summary: `${LONG}. ${LINK}`, deadline: day(40 + i).slice(0, 10), status: i === 2 ? "paused" : "active",
    strategy: Array.from({ length: 4 }, (_, j) => ({ heading: `${LONG} ${j}`, body: `${LINK}\n\n| ${Array.from({ length: 9 }, (_, k) => `Column ${k + 1}`).join(" | ")} |\n|${" --- |".repeat(9)}\n| ${Array.from({ length: 9 }, () => "cell").join(" | ")} |\n\n\`\`\`\nconst aVeryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);\n\`\`\`\n\n${"The quick brown fox jumps over the lazy dog. ".repeat(12)}` })),
    tracks: ["Music and the rest of the long track name", "Content", "Release", "Gear", "Promotion"].map((name) => ({ name, colour: "#8a7dff" })),
    milestones: Array.from({ length: 8 }, (_, j) => ({ id: `ms${i}${j}`, title: `${LONG} milestone ${j}`, at: day(3 * j + 2, "18:00"), track: "Content", done: j < 2 })),
    assumptions: [LONG, WORD], questions: [`${LONG}?`, `${WORD}?`], refinements: [{ at: now, text: LONG }], research: [{ text: LONG, title: LONG, url: LINK }], researched: now,
    created: now, updated: now,
  }));
  const quests = Array.from({ length: 24 }, (_, i) => ({
    id: `q${i}`, missionId: i % 3 === 0 ? "" : `m${i % 2}`, track: "Content", title: i % 4 === 0 ? `${WORD} ${i}` : `${LONG} (quest ${i + 1})`, notes: `${LONG} ${LINK}`,
    minutes: 45, priority: ["low", "normal", "high", "urgent"][i % 4] || "normal", deadline: day(5 + i).slice(0, 10), location: i % 5 === 0 ? `${LONG} street` : "",
    status: i < 2 ? "done" : "todo", start: day(Math.floor(i / 6), `${String(9 + (i % 6) * 2).padStart(2, "0")}:00`), end: day(Math.floor(i / 6), `${String(9 + (i % 6) * 2).padStart(2, "0")}:45`),
    from: i % 2 ? `Notes · ${LONG}` : "", created: now, updated: now,
  }));
  writeFileSync(`${dir}/quests.json`, JSON.stringify({ version: 1, missions, quests, blocks: [{ id: "b1", start: day(1, "12:00"), end: day(1, "13:00"), reason: LONG }] }, null, 2));
  mkdirSync(`${dir}/files`, { recursive: true });
  const files = [
    { id: "f1", name: `${WORD}.md`, title: LONG, type: "md", body: `# ${LONG}\n\n${LINK}\n\n| ${Array.from({ length: 12 }, (_, k) => `Column ${k + 1}`).join(" | ")} |\n|${" --- |".repeat(12)}\n\n\`\`\`\n${"const aVeryLongLineOfCode = someFunction(argumentNumberOne);".repeat(3)}\n\`\`\`\n\n${"Paragraph text. ".repeat(400)}` },
    { id: "f2", name: "table.csv", title: `A wide table: ${LONG}`, type: "csv", body: Array.from({ length: 40 }, (_, r) => Array.from({ length: 14 }, (_, c) => (r ? `${WORD.slice(0, 20)}${c}` : `Heading ${c}`)).join(",")).join("\n") },
    { id: "f3", name: "data.json", title: "Some data", type: "json", body: JSON.stringify({ long: WORD.repeat(4), list: Array.from({ length: 80 }, (_, i) => ({ i, LONG })) }) },
  ];
  writeFileSync(`${dir}/files/index.json`, JSON.stringify(files.map(({ body, ...f }) => ({ ...f, size: body.length, source: "chat", created: now, updated: now }))));
  for (const f of files) writeFileSync(`${dir}/files/${f.id}.${f.type}`, f.body);
}
if (process.env.FIT_DATA_DIR) seedData(process.env.FIT_DATA_DIR.replace(/\/$/, ""));

// Calendar's events come from Nova Bot (not here): answered with long ones
const calendarItems = () => ({
  rev: 1,
  items: [
    ...Array.from({ length: 14 }, (_, i) => ({ id: `e${i}`, kind: "event", title: i % 3 ? `${LONG} ${i}` : `${WORD}${i}`, start: day(i % 7 - 2, `${String(8 + (i % 5) * 2).padStart(2, "0")}:00`), end: day(i % 7 - 2, `${String(9 + (i % 5) * 2).padStart(2, "0")}:30`), notes: `${LONG} ${LINK}`, location: LONG, color: "violet", ...(i === 1 ? { meet: true, meetUrl: "https://meet.google.com/abc-defg-hij" } : {}), updated: new Date().toISOString() })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `ea${i}`, kind: "event", title: `${LONG} all day ${i}`, start: day(i, "00:00"), end: day(i + 1, "00:00"), allDay: true, color: "teal", updated: new Date().toISOString() })),
    { id: "d1", kind: "day", title: LONG, date: day(0).slice(0, 10), notes: LONG, updated: new Date().toISOString() },
  ],
});

// ---- What sticks out (runs inside each page) ----
function inspect(skip) {
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = innerHeight;
  const out = [];
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > vw + 1) out.push(`the page scrolls sideways (${se.scrollWidth}px in ${vw}px)`);
  const cache = new Map();
  const cs = (e) => { let s = cache.get(e); if (!s) cache.set(e, (s = getComputedStyle(e))); return s; };
  // Up one level, out of a shadow root to its host when need be (the badge, the Manual)
  const up = (e) => e.parentElement || (e.parentNode && e.parentNode.host) || null;
  const docScrollsY = se.scrollHeight > vh + 1 && cs(document.documentElement).overflowY !== "hidden" && cs(document.body).overflowY !== "hidden";
  const label = (e) => {
    if (!e || e.nodeType !== 1) return "?";
    let s = e.tagName.toLowerCase();
    if (e.id) return `${s}#${e.id}`;
    if (e.classList.length) s += "." + [...e.classList].slice(0, 2).join(".");
    return s;
  };
  const where = (e) => {
    const parts = [];
    for (let x = e; x && x !== document.body && parts.length < 4; x = up(x)) { parts.unshift(label(x)); if (x.id) break; }
    return parts.join(" > ");
  };
  // Shown at all? (closed dialogs and display:none have no boxes; these are the rest)
  const opacityCache = new Map();
  function faded(e) {
    if (!e || e.nodeType !== 1) return false;
    if (opacityCache.has(e)) return opacityCache.get(e);
    const s = cs(e);
    const v = Number(s.opacity) < 0.05 || s.visibility === "hidden" || e.getAttribute("aria-hidden") === "true" || e.inert || faded(up(e));
    opacityCache.set(e, v);
    return v;
  }
  // The box that clips an element: the nearest ancestor (along its containing blocks) that doesn't let things show past it
  const makesBlockForFixed = (s) => s.transform !== "none" || s.filter !== "none" || (s.backdropFilter && s.backdropFilter !== "none") || /paint|layout|strict|content/.test(s.contain) || /transform|filter/.test(s.willChange) || (s.containerType && s.containerType !== "normal");
  function clipOf(e) {
    if (e.matches(":modal, :popover-open")) return null;
    let pos = cs(e).position;
    for (let a = up(e); a && a !== document.body && a !== document.documentElement; a = up(a)) {
      const s = cs(a);
      const contains = pos === "fixed" ? makesBlockForFixed(s) : pos === "absolute" ? s.position !== "static" || makesBlockForFixed(s) : true;
      if (contains) {
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return a;
        pos = s.position;
      }
      if (a.matches(":modal, :popover-open")) return null;
    }
    return null;
  }
  function boxOf(c) {
    if (!c) return { l: 0, t: 0, r: vw, b: vh, sx: false, sy: docScrollsY, ox: 0, oy: 0, name: "the screen" };
    const r = c.getBoundingClientRect();
    const s = cs(c);
    const l = r.left + c.clientLeft, t = r.top + c.clientTop;
    return { l, t, r: l + c.clientWidth, b: t + c.clientHeight, sx: /auto|scroll/.test(s.overflowX), sy: /auto|scroll/.test(s.overflowY), ox: c.scrollLeft, oy: c.scrollTop, name: where(c) };
  }
  const boxes = new Map();
  const clipBox = (c) => { if (!boxes.has(c)) boxes.set(c, boxOf(c)); return boxes.get(c); };
  function past(r, b) {
    const sides = [];
    // Scrollable boxes reach to their scroll origin (top/left) and as far as they scroll the other way
    if (r.left < (b.sx ? b.l - b.ox : b.l) - 1) sides.push(`left by ${Math.round((b.sx ? b.l - b.ox : b.l) - r.left)}`);
    if (!b.sx && r.right > b.r + 1) sides.push(`right by ${Math.round(r.right - b.r)}`);
    if (r.top < (b.sy ? b.t - b.oy : b.t) - 1) sides.push(`top by ${Math.round((b.sy ? b.t - b.oy : b.t) - r.top)}`);
    if (!b.sy && r.bottom > b.b + 1) sides.push(`bottom by ${Math.round(r.bottom - b.b)}`);
    return sides;
  }
  const skipSel = skip || "";
  const bad = new Set();
  const cut = [];
  const report = (e, msg) => { bad.add(e); out.push(msg); };
  const underBad = (e) => { for (let x = up(e); x; x = up(x)) if (bad.has(x)) return true; return false; };
  // Every element, inside open shadow roots too
  const all = [];
  const roots = [document.body];
  (function walk(root) { for (const e of root.querySelectorAll("*")) { all.push(e); if (e.shadowRoot) { roots.push(e.shadowRoot); walk(e.shadowRoot); } } })(document.body);
  for (const e of all) {
    if (e.closest("svg, head, script, style, template, noscript, option") && e.tagName !== "svg") continue;
    if (e.tagName === "svg" && e.parentElement.closest("svg")) continue;
    if (skipSel && e.closest(skipSel)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (faded(e)) continue;
    const s = cs(e);
    if ((s.clip && s.clip !== "auto") || /inset\(50%|inset\(100%/.test(s.clipPath)) continue; // screen-reader-only text
    // A ticker sliding along its track (it moves through on purpose)
    if (e.getAnimations && e.getAnimations().some((a) => a.playState === "running" && /translate|transform/.test(JSON.stringify(a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : "")))) { bad.add(e); continue; }
    if (underBad(e)) continue;
    const c = clipOf(e);
    if (c && faded(c)) continue;
    const b = clipBox(c);
    // Wholly outside a box that clips it: tucked away on purpose (a closed drawer), or lost
    if (b.r - b.l < 2 || b.b - b.t < 2) continue; // inside screen-reader-only text
    const sides = past(r, b);
    if (!sides.length) continue;
    // Words running into a box that ends them with …
    if (c && s.display === "inline" && cs(c).textOverflow === "ellipsis") { cut.push(`${where(e)} is cut short with … in ${b.name}`); bad.add(e); continue; }
    const away = r.right <= b.l + 1 || r.left >= b.r - 1 || r.bottom <= b.t + 1 || r.top >= b.b - 1;
    // A drawer slid off the side until it's opened (moved there, not pushed there): left alone
    if (away && (s.transform !== "none" || s.translate !== "none" || /absolute|fixed/.test(s.position))) { bad.add(e); continue; }
    // Free to lie anywhere on a surface that moves (Board's cards on its table): only what's inside it counts
    if (e.hasAttribute("data-fit-free")) continue;
    report(e, `${where(e)} sticks out of ${b.name} (${sides.join(", ")})`);
  }
  // Text that runs past its box (a long word, a long link)
  const range = document.createRange();
  const texts = [];
  for (const root of roots) { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) texts.push(n); }
  for (const n of texts) {
    if (!n.data.trim()) continue;
    const p = n.parentElement;
    if (!p || p.closest("svg, script, style, template, noscript, option, textarea, select") || faded(p) || bad.has(p) || underBad(p)) continue;
    if (skipSel && p.closest(skipSel)) continue;
    const ps = cs(p);
    if (ps.display === "none") continue;
    const pr = p.getBoundingClientRect();
    if (pr.width < 2 || pr.height < 2 || (ps.clip && ps.clip !== "auto") || /inset\(50%|inset\(100%/.test(ps.clipPath)) continue; // screen-reader-only text
    range.selectNodeContents(n);
    const rr = range.getBoundingClientRect();
    // (a glyph's box is a little taller than a tight line: only what goes further counts)
    const r = { left: rr.left, right: rr.right, top: rr.top + 3, bottom: rr.bottom - 3, width: rr.width, height: rr.height };
    if (r.width < 2 || r.height < 2) continue;
    // The nearest box (the text's own element or above) that doesn't let it show past
    let c = null;
    for (let a = p; a && a !== document.body; a = up(a)) {
      const s = cs(a);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") { c = a; break; }
      if (s.position === "fixed" || a.matches(":modal, :popover-open")) break;
    }
    const b = clipBox(c);
    if (b.r - b.l < 2 || b.b - b.t < 2) continue;
    const sides = past(r, b);
    if (!sides.length) continue;
    // Cut short on purpose, and says so: one line ending in … (sideways), or a few lines and then … (downwards).
    // A long word running out sideways of a few-lines box is just cut off, with no …
    const cc = c && cs(c);
    const clamp = cc && cc.webkitLineClamp && cc.webkitLineClamp !== "none";
    const ell = c && sides.every((x) => (cc.textOverflow === "ellipsis" && !clamp && /^(left|right)/.test(x)) || (clamp && /^(top|bottom)/.test(x)) || (cc.textOverflow === "ellipsis" && cc.whiteSpace === "nowrap"));
    const msg = `${where(p)}: text "${n.data.trim().slice(0, 40)}" ${ell ? "is cut short with …" : `runs out of ${b.name}`} (${sides.join(", ")})`;
    if (ell) cut.push(msg); else { bad.add(p); out.push(msg); }
  }
  return { bad: out, cut };
}

// ---- The panels and their states ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const openDialogs = async (f, sel) => {
  // Each closed dialog / popover in this page, one at a time: [label, opener]
  const ids = await f.evaluate((sel) => [...document.querySelectorAll(sel || "dialog")].map((d, i) => { if (!d.id) d.id = `fit-dlg-${i}`; return d.id; }), sel);
  return ids.map((id) => [`dialog #${id}`, async () => f.evaluate((id) => { const d = document.getElementById(id); try { if (d.tagName === "DIALOG") { if (!d.open) d.showModal(); } else d.showPopover(); } catch (e) {} }, id), async () => f.evaluate((id) => { const d = document.getElementById(id); try { if (d.tagName === "DIALOG") d.close(); else d.hidePopover(); } catch (e) {} }, id)]);
};
// Every menu / pop-up button on show (aria-haspopup), shadow roots included: open it, look, close it
const popups = async (f) => {
  const names = await f.evaluate(() => {
    const found = [];
    (function walk(root) { for (const e of root.querySelectorAll("*")) { if (e.matches('[aria-haspopup]:not([aria-haspopup="false"])')) found.push(e); if (e.shadowRoot) walk(e.shadowRoot); } })(document);
    window.__fitPops = found.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== "hidden"; });
    return window.__fitPops.map((e) => (e.id ? `#${e.id}` : (e.getAttribute("aria-label") || e.title || e.textContent || e.tagName).trim().replace(/\s+/g, " ").slice(0, 30)));
  }).catch(() => []);
  return names.map((name, i) => [`pop-up ${name}`, async () => f.evaluate((i) => window.__fitPops[i] && window.__fitPops[i].click(), i), async () => f.evaluate((i) => {
    const t = window.__fitPops[i];
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (t && t.getAttribute("aria-expanded") === "true") t.click();
    for (const d of document.querySelectorAll("dialog[open]")) d.close();
    for (const p of document.querySelectorAll(":popover-open")) try { p.hidePopover(); } catch (e) {}
  }, i)]);
};
const manualState = ["the Manual", async (f) => f.evaluate(() => window.NovaManual && window.NovaManual.open()), async (f) => f.evaluate(() => window.NovaManual && window.NovaManual.close())];

const APPS = {
  portal: {
    path: "/portal/",
    ready: "#app",
    async prepare(f) {
      await f.evaluate(() => { document.getElementById("auth").hidden = true; document.getElementById("app").hidden = false; });
    },
    async states(f) {
      const views = await f.evaluate(() => [...new Set([...document.querySelectorAll("[data-view]")].map((b) => b.dataset.view))]);
      const out = [];
      for (const menu of ["tabs", "side"]) {
        for (const v of views) out.push([`${menu} menu: ${v}`, async () => f.evaluate(({ v, menu }) => {
          if (menu === "side") document.documentElement.setAttribute("data-menu", "side"); else document.documentElement.removeAttribute("data-menu");
          dispatchEvent(new Event("resize"));
          // (Its Calendar tab opens the Calendar panel, checked on its own: here, Portal's booking tools)
          const b = v === "calendar" ? document.getElementById("nav-booking-tools") : [...document.querySelectorAll(`[data-view="${v}"]`)].find((x) => x.offsetParent) || document.querySelector(`[data-view="${v}"]`);
          b && b.click();
        }, { v, menu })]);
      }
      // Money's other parts, each of its forms open, and an invoice's details and payment box
      const money = (steps) => async () => f.evaluate(async (steps) => {
        document.documentElement.removeAttribute("data-menu");
        document.querySelector('.tab[data-view="money"]').click();
        await new Promise((r) => setTimeout(r, 400));
        for (const s of steps) {
          const node = document.querySelector(s);
          if (node) node.click();
          await new Promise((r) => setTimeout(r, 300));
        }
        // (how it's laid out is what's checked, not where it was scrolled to)
        scrollTo(0, 0);
      }, steps);
      out.push(["money: expenses", money(['[data-mn="expenses"]'])]);
      out.push(["money: tax year", money(['[data-mn="year"]'])]);
      out.push(["money: invoice form", money(['[data-mn="invoices"]', "#money-new", "#mn-inv-add-line"])]);
      out.push(["money: expense form", money(["#money-expense-new"])]);
      out.push(["money: details and a payment", money(['[data-mn="invoices"]', '[data-key="mn-3"] .actions .btn:last-child', '[data-key="mn-4"] .actions .btn'])]);
      // Test stuff: its bin and "marked as real" open, and "Delete all likely" asking again
      const tests = (steps) => async () => f.evaluate(async (steps) => {
        document.documentElement.removeAttribute("data-menu");
        document.querySelector('.tab[data-view="tests"]').click();
        await new Promise((r) => setTimeout(r, 500));
        for (const s of steps) {
          const node = document.querySelector(s);
          if (node && node.tagName === "DETAILS") node.open = true;
          else if (node) node.click();
          await new Promise((r) => setTimeout(r, 250));
        }
        scrollTo(0, 0);
      }, steps);
      out.push(["tests: deleted and marked as real", tests(["#tests-recent-wrap", "#tests-real-wrap"])]);
      out.push(["tests: delete all, asking again", tests(["#tests-delete-all"])]);
      // Google: the setup steps open again, at the step with the addresses to copy
      out.push(["google: the setup steps", async () => f.evaluate(async () => {
        document.documentElement.removeAttribute("data-menu");
        document.querySelector('.tab[data-view="google"]').click();
        await new Promise((r) => setTimeout(r, 500));
        const show = [...document.querySelectorAll("#google-body .chip")].find((b) => /setup steps/.test(b.textContent));
        if (show) show.click();
        await new Promise((r) => setTimeout(r, 200));
        for (let i = 0; i < 2; i++) {
          const back = [...document.querySelectorAll(".gg-nav .btn")].find((b) => b.textContent === "Back");
          if (back) back.click();
          await new Promise((r) => setTimeout(r, 150));
        }
        scrollTo(0, 0);
      })]);
      // Conversations: one chat open, with someone from the studio live in it and the reply box
      out.push(["chats: a live chat open", async () => f.evaluate(async () => {
        document.documentElement.removeAttribute("data-menu");
        document.querySelector('.tab[data-view="chats"]').click();
        await new Promise((r) => setTimeout(r, 500));
        const card = document.querySelector("#chat-list .card.tappable");
        if (card) card.click();
        await new Promise((r) => setTimeout(r, 500));
        scrollTo(0, 0);
      })]);
      return out;
    },
    dialogs: true,
  },
  calendar: {
    path: "/calendar/",
    ready: ".views",
    async states(f) {
      const out = ["month", "week", "day", "list"].map((v) => [`${v} view`, async () => f.evaluate((v) => document.querySelector(`.views [data-view="${v}"]`).click(), v)]);
      out.push(["an event open", async () => f.evaluate(() => { document.querySelector('.views [data-view="month"]').click(); const p = document.querySelector('[data-id^="e"]'); p && p.click(); }), async () => f.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })]);
      return out;
    },
    dialogs: true,
  },
  notes: {
    path: "/notes/",
    ready: "#editor",
    async prepare(f) {
      const row = (cell) => `<tr>${Array.from({ length: 9 }, (_, j) => `<${cell}>Column ${j + 1}</${cell}>`).join("")}</tr>`;
      const html = `<h1 class="title">A long note</h1><p>${LINK}</p><table><tbody>${row("th")}${row("td")}</tbody></table><pre><code>const aVeryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);</code></pre>` + Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog.</p>`).join("");
      await f.fill("#doc-title", LONG).catch(() => {});
      await f.evaluate((html) => { const ed = document.getElementById("editor"); ed.innerHTML = html; ed.dispatchEvent(new Event("input", { bubbles: true })); }, html);
    },
    async states(f) {
      return ["", "show-library", "show-outline"].map((p) => [p ? p.replace("show-", "") + " open" : "writing", async () => f.evaluate((p) => { const s = document.getElementById("shell"); s.classList.remove("show-library", "show-outline", "no-outline"); if (p) s.classList.add(p); }, p)]);
    },
    dialogs: true,
  },
  board: {
    path: "/board/",
    ready: "#table",
    async prepare(f) {
      await f.evaluate(({ LONG, LINK }) => {
        const nb = window.NovaBoard;
        if (!nb) return;
        // A fresh board each time (cards left from before may lie at a slant)
        document.getElementById("board-new").click();
        for (const kind of ["question", "sticky", "text", "agent", "note", "link"]) nb.addCard({ kind, title: LONG, text: LONG + " " + LINK, url: "https://example.com/" + "a".repeat(80), noteId: "n1", answer: LONG, turn: 0 });
        nb.addCard({ kind: "calendar", span: "week", turn: 0 });
        nb.addCard({ kind: "calendar", span: "year", turn: 0 });
        // (at 100%: the check measures boxes that are zoomed wrongly)
        document.getElementById("zoom-reset").click();
      }, { LONG, LINK });
    },
    async states(f) {
      return [
        ["the table", async () => {}],
        ["the add menu open", async () => f.evaluate(() => document.getElementById("add").click()), async () => f.evaluate(() => document.getElementById("add").click())],
        ["the drawer open", async () => f.evaluate(() => document.getElementById("drawer-btn").click()), async () => f.evaluate(() => document.getElementById("drawer-close").click())],
        ["the bin open", async () => f.evaluate(() => document.getElementById("bin-btn").click()), async () => f.evaluate(() => document.getElementById("bin-close").click())],
        ["renaming", async () => f.evaluate(() => document.getElementById("board-rename").click()), async () => f.evaluate(() => document.getElementById("rename-cancel").click())],
      ];
    },
    dialogs: true,
  },
  console: {
    path: "/console/",
    ready: ".xterm",
    async prepare(f) {
      await f.evaluate(() => window.NovaConsole && window.NovaConsole.type("help\r"));
      await new Promise((r) => setTimeout(r, 400));
    },
  },
  index: { path: "/app/memory/", ready: "body", dialogs: true },
  observatory: { path: "/observatory/", ready: "body", dialogs: true },
  lossless: { path: "/lossless/", ready: "body", dialogs: true },
  visualizer: { path: "/visualizer", ready: "body", dialogs: true },
  fixer: { path: "/fixer/", ready: "body", dialogs: true },
};

// Nova Agent itself: its home (Missions | Agent | Quests), the Panels window, its sheets and pop-ups
const SHELL = {
  async prepare(f) {
    await f.waitForSelector("#missions [data-mission]", { timeout: 8000 }).catch(() => {});
    await f.evaluate(({ LONG, WORD, LINK }) => {
      const log = document.getElementById("log");
      const welcome = document.getElementById("welcome");
      if (welcome) welcome.hidden = true;
      for (let i = 0; i < 6; i++) {
        const u = document.createElement("div");
        u.className = "msg user";
        u.innerHTML = `<div class="bubble">${LONG} ${WORD} ${LINK}</div>`;
        const a = document.createElement("div");
        a.className = "msg agent";
        // What the chat's own Markdown makes: paragraphs, headings and lists
        a.innerHTML = `<span class="who">Nova Agent</span><div class="bubble"><h5>${LONG}</h5><p>${LONG}</p><p><a href="${LINK}">${LINK}</a></p><ul><li>${WORD}</li><li>${LONG}</li></ul></div><div class="actions"><span class="action file">▤ ${WORD}</span><span class="action looked">◎ ${LONG}</span></div>`;
        log.append(u, a);
      }
    }, { LONG, WORD, LINK });
  },
  async states(f, phone) {
    const out = [["home", async () => {}]];
    if (phone) {
      // On a phone the home shows one column at a time
      for (const pane of ["chat", "quests", "missions"]) out.push([`home: ${pane}`, async () => f.evaluate((pane) => document.querySelector(`.tabbar [data-tab="pane:${pane}"]`)?.click(), pane)]);
      out.push(["More sheet", async () => f.evaluate(() => document.querySelector(".tabbar .more, .tabbar [data-tab=more], .tabbar [data-more]")?.click()), async () => f.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); })]);
    }
    const click = (sel) => async () => f.evaluate((sel) => { const b = document.querySelector(sel); b && b.click(); }, sel);
    const closeAll = async () => f.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
    out.push(["Panels window", click("#suite-btn"), closeAll]);
    out.push(["new mission", click("#new-mission-btn"), closeAll]);
    for (const tab of ["plan", "roadmap", "quests", "refine"]) {
      out.push([`mission view: ${tab}`, async () => f.evaluate((tab) => {
        if (!document.getElementById("mv").open) document.querySelector("#missions [data-mission]")?.click();
        const t = [...document.querySelectorAll("#mv-tabs button, #mv-tabs [role=tab]")].find((b) => (b.dataset.tab || b.textContent).toLowerCase().includes(tab));
        t && t.click();
      }, tab)]);
    }
    out.push(["mission view closed", closeAll]);
    out.push(["files", click("#files-btn")]);
    out.push(["file viewer: md", async () => f.evaluate(() => document.querySelector('#files-list [data-fcard="f1"] .fname, #files-list [data-fcard="f1"] button, #files-list [data-fcard="f1"]')?.click())]);
    out.push(["file viewer: csv", async () => f.evaluate(() => { document.getElementById("fv").close(); document.querySelector('#files-list [data-fcard="f2"] .fname, #files-list [data-fcard="f2"] button, #files-list [data-fcard="f2"]')?.click(); })]);
    out.push(["files closed", closeAll]);
    out.push(["rhythm", click("#btn-rhythm"), closeAll]);
    out.push(["install", async () => f.evaluate(() => window.NovaInstall && window.NovaInstall.open()), closeAll]);
    return out;
  },
};

// ---- Run ----
const FRAME = (src) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style><iframe src="${src}"></iframe>`;
const browser = await chromium.launch();
let problems = 0, checked = 0;
const found = new Map(); // problem → [where it happened]
const cutShort = new Map();
const note = (map, msg, at) => { if (!map.has(msg)) map.set(msg, []); map.get(msg).push(at); };

async function newTab(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
  const tab = await ctx.newPage();
  await tab.route(/\/__fit\.html/, (r) => r.fulfill({ contentType: "text/html", body: FRAME(new URL(r.request().url()).searchParams.get("src")) }));
  // Nova Bot's answers for Portal (signed in as an admin, with long lists), from the samples file
  await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
    const u = new URL(r.request().url());
    const body = portalMock(u.pathname + u.search, r.request().method());
    return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
  });
  await tab.route(/\/app\/api\/calendar\/items/, (r) => (r.request().method() === "GET" ? r.fulfill({ contentType: "application/json", body: JSON.stringify(calendarItems()) }) : r.fulfill({ contentType: "application/json", body: "{}" })));
  return { ctx, tab };
}
async function check(frames, at, shot, tab) {
  checked++;
  await sleep(450);
  let any = false;
  for (const [name, f] of frames) {
    const res = await f.evaluate(inspect, "").catch((e) => ({ bad: [`couldn't look: ${e.message.split("\n")[0]}`], cut: [] }));
    for (const b of res.bad) { note(found, `${name}: ${b}`, at); any = true; }
    for (const c of res.cut) note(cutShort, `${name}: ${c}`, at);
  }
  if (any) problems++;
  console.log(`${any ? "✗" : "✓"} ${at}`);
  if (SHOTS && shot) await tab.screenshot({ path: `${SHOTS}/${shot.replace(/[^\w.-]+/g, "_")}.png` }).catch(() => {});
}
async function runStates(states, frames, prefix, tab, shotPrefix, path) {
  for (const [label, open, close] of states) {
    try { await open(); } catch (e) { console.log(`  (couldn't open ${label}: ${e.message.split("\n")[0]})`); continue; }
    const gone = frames.find(([, f]) => f.isDetached());
    if (gone) { console.log(`  (${gone[0]} went away after ${label})`); break; }
    const app = frames[frames.length - 1][1];
    if (path && !new URL(app.url()).pathname.startsWith(path)) { console.log(`✗ ${prefix} · ${label}: the panel left for ${app.url()}`); note(found, `${frames[frames.length - 1][0]}: ${label} leaves the panel`, prefix); problems++; break; }
    await check(frames, `${prefix} · ${label}`, `${shotPrefix}-${label}`, tab);
    if (close) await close().catch(() => {});
  }
}

for (const [w, h] of SIZES) {
  const phone = w < 800;
  const size = `${w}×${h}`;
  // Nova Agent's own home
  if (!ONLY || ONLY.includes("agent")) {
    const { ctx, tab } = await newTab(w, h);
    await tab.goto(`${BASE}/agent/`);
    await tab.waitForSelector("#shell");
    await sleep(800);
    await SHELL.prepare(tab.mainFrame());
    const frames = [["Nova Agent", tab.mainFrame()]];
    await runStates(await SHELL.states(tab.mainFrame(), phone), frames, `Nova Agent ${size}`, tab, `agent-${size}`);
    if (MANUAL) await runStates([manualState].map(([l, o, c]) => [l, () => o(tab.mainFrame()), () => c(tab.mainFrame())]), frames, `Nova Agent ${size}`, tab, `agent-${size}`);
    await runStates(await openDialogs(tab.mainFrame(), "dialog:not(#mv):not(#fv)"), frames, `Nova Agent ${size}`, tab, `agent-${size}`);
    await runStates(await popups(tab.mainFrame()), frames, `Nova Agent ${size}`, tab, `agent-${size}`);
    await ctx.close();
  }
  for (const [name, app] of Object.entries(APPS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    for (const where of WHERE) {
      const { ctx, tab } = await newTab(w, h);
      const at = `${name} ${where === "own" ? "on its own" : "in Nova Agent"} ${size}`;
      await tab.goto(where === "own" ? `${BASE}/__fit.html?src=${encodeURIComponent(app.path)}` : `${BASE}/agent/?open=${encodeURIComponent(app.path)}`);
      let f;
      for (let i = 0; i < 60 && !(f = tab.frames().find((x) => x !== tab.mainFrame() && new URL(x.url()).pathname.startsWith(app.path))); i++) await sleep(200);
      if (!f) { console.log(`✗ ${at}: didn't open`); note(found, `${name}: didn't open`, at); problems++; await ctx.close(); continue; }
      await f.waitForSelector(app.ready, { timeout: 10000 }).catch(() => {});
      await sleep(900);
      if (app.prepare) await app.prepare(f).catch((e) => console.log(`  (prepare: ${e.message.split("\n")[0]})`));
      const frames = where === "own" ? [[name, f]] : [["Nova Agent", tab.mainFrame()], [name, f]];
      const states = app.states ? await app.states(f) : [["as it opens", async () => {}]];
      await runStates(states, frames, at, tab, `${name}-${where}-${size}`, app.path);
      if (MANUAL) await runStates([manualState].map(([l, o, c]) => [l, () => o(f), () => c(f)]), frames, at, tab, `${name}-${where}-${size}`, app.path);
      if (app.dialogs) await runStates(await openDialogs(f), frames, at, tab, `${name}-${where}-${size}`, app.path);
      await runStates(await popups(f), frames, at, tab, `${name}-${where}-${size}`, app.path);
      await ctx.close();
    }
  }
}
await browser.close();

console.log("");
for (const [msg, at] of found) console.log(`✗ ${msg}\n    at ${at.length > 2 && !VERBOSE ? `${at.slice(0, 2).join("; ")} and ${at.length - 2} more` : at.join("; ")}`);
if (cutShort.size) {
  console.log(`\nCut short with … (fits, but not all of it shows): ${cutShort.size}`);
  if (VERBOSE) for (const [msg, at] of cutShort) console.log(`  … ${msg} (${at.length}×)`);
}
console.log(problems ? `\n${problems} of ${checked} screens have something sticking out (${found.size} different problems)` : `\nEverything fits: ${checked} screens checked`);
process.exit(problems ? 1 : 0);
