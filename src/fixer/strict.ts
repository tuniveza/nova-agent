// The Fixer, from the ground up (16 October 2026): three strict rules, never compromised, checked on
// all of Nova Agent (its home and every app, plan, tool and helper) every 5 minutes, at phone, tablet
// and computer sizes:
//
//   1. offscreen  Nothing is ever off the screen: nothing sticks out past the screen's edges, and
//                 nothing is cut off by the box it's in (text ending in "…" included). What's inside
//                 a box that scrolls is fine: it can be scrolled to (and so is what's on a surface
//                 you drag around, marked data-pan: Board's table).
//   2. onescreen  One screen: the page itself never scrolls (only boxes inside it do).
//   3. oneline    Nothing overflows onto the next line: a button, link, name, label, heading, tab or
//                 bar item is on one line, and a row of things (a toolbar, the status line, a row of
//                 chips) never wraps onto a second row. Reading text (a paragraph, a message, a note)
//                 is left out: it's meant to wrap.
//
// It only looks: nothing that would change something leaves its browser (every request that isn't a
// GET is turned away, live connections are closed). scripts/fixer-strict.ts runs it as its own
// low-priority process; src/fixer/strict-service.ts runs that every 5 minutes and keeps the result.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { NAME_SHIM } from "./looks";
import { SWEEP_HEADER } from "./sweep-guard";

export type StrictRule = "offscreen" | "onescreen" | "oneline";
export const STRICT_RULES: { id: StrictRule; title: string; text: string }[] = [
  { id: "offscreen", title: "Never anything off the screen", text: "Nothing sticks out past the screen's edges or is cut off by its box." },
  { id: "onescreen", title: "One screen", text: "The page never scrolls; only boxes inside it do." },
  { id: "oneline", title: "Never onto the next line", text: "Buttons, names, labels, headings and rows stay on one line." },
];

export type StrictBox = { x: number; y: number; w: number; h: number };
export type StrictFound = { rule: StrictRule; what: string; why: string; box: StrictBox | null };
// fixed: how many parts the screen fixed on its own as it drew (web/shared/rules.js), before it was looked at
export type StrictScreen = { place: string; width: number; height: number; kind: StrictKind; ms: number; found: StrictFound[]; shot: string; fixed?: number; error?: string };
export type StrictKind = "phone" | "tablet" | "computer";
export type StrictRun = { startedAt: string; finishedAt: string; base: string; signedIn: boolean; screens: StrictScreen[] };

// The sizes every run looks at: phones (upright and on its side), tablets, computers
export const STRICT_SIZES: { w: number; h: number; kind: StrictKind }[] = [
  { w: 360, h: 640, kind: "phone" },
  { w: 390, h: 844, kind: "phone" },
  { w: 412, h: 915, kind: "phone" },
  { w: 844, h: 390, kind: "phone" },
  { w: 768, h: 1024, kind: "tablet" },
  { w: 1024, h: 768, kind: "tablet" },
  { w: 1366, h: 768, kind: "computer" },
  { w: 1920, h: 1080, kind: "computer" },
  // Extremely thin and extremely short windows (made that small by hand): still nothing off the screen
  { w: 280, h: 600, kind: "phone" },
  { w: 900, h: 320, kind: "computer" },
];
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const LOOKING = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_PER_SCREEN = 30;

// ---- Measuring, inside the page (one document: Nova Agent's own, or a panel's) ----
// Self-contained: it runs in the browser (page.evaluate), so it uses nothing from outside itself.
export function measureStrict(): StrictFound[] {
  const out: StrictFound[] = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const vh = doc.clientHeight;
  const box = (r: DOMRect) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const short = (s: string, n = 40) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };
  const KIND: Record<string, string> = { BUTTON: "Button", A: "Link", LABEL: "Label", SELECT: "Menu", INPUT: "Box", TEXTAREA: "Box", IMG: "Picture", SVG: "Icon", H1: "Heading", H2: "Heading", H3: "Heading", H4: "Heading", H5: "Heading", H6: "Heading", SUMMARY: "Heading", TH: "Column name", LI: "Item", P: "Text", IFRAME: "Panel", VIDEO: "Video", CANVAS: "Picture" };
  const name = (el: Element) => {
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || el.getAttribute("alt") || "";
    const kind = KIND[el.tagName.toUpperCase()] || (el.getAttribute("role") ? el.getAttribute("role")!.replace(/^./, (c) => c.toUpperCase()) : "");
    const where = el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : el.tagName.toLowerCase();
    const said = short(label);
    return `${kind || "Part"}${said ? ` “${said}”` : ""} (${where})`;
  };
  const shown = (el: Element) => {
    const anyEl = el as any;
    if (typeof anyEl.checkVisibility === "function" && !anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const ignored = (el: Element) => !!el.closest('[aria-hidden="true"], [inert], template, noscript, script, style, head');
  const scrolls = (v: string) => v === "auto" || v === "scroll" || v === "overlay";
  const clips = (v: string) => v === "hidden" || v === "clip";

  // ---- 2. One screen: the page itself never scrolls ----
  // (a page set never to scroll, overflow hidden, doesn't: what sticks out of it is rule 1's)
  const se = (document.scrollingElement || doc) as HTMLElement;
  const rootCs = getComputedStyle(doc);
  const bodyCs = getComputedStyle(document.body);
  const pageX = rootCs.overflowX !== "visible" ? rootCs.overflowX : bodyCs.overflowX;
  const pageY = rootCs.overflowY !== "visible" ? rootCs.overflowY : bodyCs.overflowY;
  const extraY = clips(pageY) ? 0 : se.scrollHeight - se.clientHeight;
  const extraX = clips(pageX) ? 0 : se.scrollWidth - se.clientWidth;
  if (extraY > 1) out.push({ rule: "onescreen", what: "The page", why: `scrolls: it's ${extraY}px taller than the screen`, box: null });
  if (extraX > 1) out.push({ rule: "onescreen", what: "The page", why: `scrolls sideways: it's ${extraX}px wider than the screen`, box: null });

  // ---- 1. Never anything off the screen ----
  const all = [...document.body.querySelectorAll("*")];
  const MEANING = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|SVG|VIDEO|CANVAS|IFRAME|LABEL|H[1-6]|P|LI|TD|TH|SUMMARY)$/;
  const hasText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
  const reported: Element[] = [];
  const inReported = (el: Element) => reported.some((r) => r.contains(el));
  let offCount = 0;
  for (const el of all) {
    if (offCount >= 40) break;
    const tag = el.tagName.toUpperCase();
    if (el.closest("svg") && tag !== "SVG") continue;
    if (!(MEANING.test(tag) || el.getAttribute("role") || hasText(el))) continue;
    if (ignored(el) || inReported(el) || !shown(el)) continue;
    const r0 = el.getBoundingClientRect();
    let left = r0.left, right = r0.right, top = r0.top, bottom = r0.bottom;
    let why = "";
    // Text cut short in its own box ("…", or just clipped)
    const cs = getComputedStyle(el);
    if (hasText(el) && clips(cs.overflowX) && (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1) why = cs.textOverflow === "ellipsis" ? "its words are cut short with “…”" : "its words are cut off at its edge";
    // Each box it's in: one that scrolls can be scrolled to it (only what shows of that box counts
    // from then on); one that doesn't cuts off what sticks out. (Words in a 1px box that cuts them
    // off are for screen readers only, hidden on purpose: never on the screen to begin with.)
    let forReaders = false;
    for (let a = el.parentElement; a && a !== document.body && !why; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (ar.width <= 2 && ar.height <= 2 && clips(s.overflowX) && clips(s.overflowY)) { forReaders = true; break; }
      const pan = a.hasAttribute("data-pan");
      const sx = pan || scrolls(s.overflowX), sy = pan || scrolls(s.overflowY);
      if (!sx && clips(s.overflowX) && (left < ar.left - 1 || right > ar.right + 1)) why = `it's cut off by the box it's in (${name(a)})`;
      else if (!sy && clips(s.overflowY) && (top < ar.top - 1 || bottom > ar.bottom + 1)) why = `it's cut off by the box it's in (${name(a)})`;
      if (sx || clips(s.overflowX)) { left = Math.max(left, ar.left); right = Math.min(right, ar.right); }
      if (sy || clips(s.overflowY)) { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
      if (right <= left || bottom <= top) break; // (scrolled out of sight inside a box: it can be scrolled to)
    }
    if (forReaders) continue;
    if (!why && right > left && bottom > top) {
      const past: string[] = [];
      if (left < -1) past.push(`${Math.round(-left)}px past the left edge`);
      // (past the bottom or the right of a page that scrolls: that's rule 2, said once)
      if (right > vw + 1 && extraX <= 1) past.push(`${Math.round(right - vw)}px past the right edge`);
      if (top < -1) past.push(`${Math.round(-top)}px above the top`);
      if (bottom > vh + 1 && extraY <= 1) past.push(`${Math.round(bottom - vh)}px below the bottom`);
      if (past.length) why = `it's off the screen: ${past.join(", ")}`;
    }
    if (!why) continue;
    reported.push(el);
    offCount++;
    out.push({ rule: "offscreen", what: name(el), why, box: box(r0) });
  }

  // ---- 3. Never onto the next line ----
  const CONTROL = 'button, a, label, h1, h2, h3, h4, h5, h6, summary, legend, th, select, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"]';
  const BARS = 'header, nav, footer, [role="toolbar"], [role="tablist"], [role="menubar"], .tabbar, .topbar, .status-line';
  const READING = 'p, blockquote, pre, code, textarea, [contenteditable="true"], article, .md, .msg, .bubble, .prose, td';
  const lines = (el: Element) => {
    let most = 1;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent || "").trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tops: number[] = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2)) tops.push(r.top);
      }
      most = Math.max(most, tops.length);
    }
    return most;
  };
  let lineCount = 0;
  const said = new Set<Element>();
  for (const el of all) {
    if (lineCount >= 40) break;
    const isControl = el.matches(CONTROL);
    const inBar = !isControl && hasText(el) && !!el.closest(BARS);
    if (!isControl && !inBar) continue;
    if (ignored(el) || el.closest(READING) || !shown(el)) continue;
    if (((el as HTMLElement).innerText || "").trim().length > 60) continue; // (that's reading text)
    if ([...said].some((s) => s.contains(el))) continue;
    const n = lines(el);
    if (n < 2) continue;
    said.add(el);
    lineCount++;
    out.push({ rule: "oneline", what: name(el), why: `its words go onto ${n} lines`, box: box(el.getBoundingClientRect()) });
  }
  // Rows of things (flex rows that may wrap): all on one row
  for (const el of all) {
    if (lineCount >= 40) break;
    const s = getComputedStyle(el);
    if (!/flex/.test(s.display) || s.flexWrap === "nowrap" || /column/.test(s.flexDirection)) continue;
    if (ignored(el) || el.closest(READING) || !shown(el)) continue;
    const kids = [...el.children].filter((k) => shown(k) && getComputedStyle(k).position !== "absolute" && getComputedStyle(k).position !== "fixed");
    if (kids.length < 2) continue;
    const rows: { top: number; bottom: number }[] = [];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const row = rows.find((w) => r.top < w.bottom - 2 && r.bottom > w.top + 2);
      if (row) { row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ top: r.top, bottom: r.bottom });
    }
    if (rows.length < 2) continue;
    lineCount++;
    out.push({ rule: "oneline", what: `The row ${name(el)}`, why: `wraps onto ${rows.length} lines`, box: box(el.getBoundingClientRect()) });
  }
  return out;
}

// ---- Running it: every size, Nova Agent's home and every place in it ----
export type StrictOptions = {
  base: string;
  cookie?: { name: string; value: string } | null;
  shotsDir?: string;
  sizes?: { w: number; h: number; kind: StrictKind }[];
  places?: string[]; // (only these, by name: for a quick look)
  settleMs?: number;
  parallel?: number;
  log?: (line: string) => void;
  rulesOff?: boolean; // (look with the screens' own fixing off: what they'd break without it)
};

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

export async function runStrict(opts: StrictOptions): Promise<StrictRun> {
  const { chromium } = await import("playwright");
  const base = opts.base.replace(/\/$/, "");
  const origin = new URL(base).origin;
  const sizes = opts.sizes || STRICT_SIZES;
  const settle = opts.settleMs ?? 1200;
  const log = opts.log || (() => {});
  const startedAt = new Date().toISOString();
  if (opts.shotsDir) mkdirSync(opts.shotsDir, { recursive: true });
  let shots = 0;
  const screens: StrictScreen[] = [];
  const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
  const one = async (size: { w: number; h: number; kind: StrictKind }) => {
    const touch = size.kind !== "computer";
    const ctx = await browser.newContext({
      viewport: { width: size.w, height: size.h }, screen: { width: size.w, height: size.h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1, serviceWorkers: "block",
      ...(size.kind === "phone" ? { userAgent: PHONE_UA } : size.kind === "tablet" ? { userAgent: TABLET_UA } : {}),
    });
    try {
      if (opts.cookie) await ctx.addCookies([{ name: opts.cookie.name, value: opts.cookie.value, domain: new URL(origin).hostname, path: "/", secure: origin.startsWith("https:"), httpOnly: true, sameSite: "Lax" }]);
      await ctx.route("**/*", async (route) => {
        const req = route.request();
        if (!LOOKING.has(req.method().toUpperCase())) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The Fixer only looks: it never changes anything", fixerSweep: true }) });
        if (!req.url().startsWith(origin)) return route.continue();
        return route.continue({ headers: { ...req.headers(), [SWEEP_HEADER]: "1" } });
      });
      await ctx.routeWebSocket(/.*/, (ws) => void ws.close());
      // (the bars shown, as most people see them; the measuring function carries tsx's __name helper)
      await ctx.addInitScript({ content: `${NAME_SHIM} try { localStorage.setItem("nova-bar-5", "shown"); localStorage.setItem("nova-top-5", "shown"); ${opts.rulesOff ? 'localStorage.setItem("nova-rules", "off");' : 'localStorage.removeItem("nova-rules");'} } catch (e) {}` });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${base}/agent/`, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(settle + 600);
      const barsSaid = new Set<string>();
      // Nova Agent's own page (its bars, and whatever's open in it); what was said about its bars once
      // per size isn't said again with each panel
      // Each screen as a person sees it a moment later: after its auto-fix (web/shared/rules.js) has
      // had its look at what just opened (it looks within about a second anyway; here, straight away)
      const fixNow = (where: { evaluate: (fn: () => void) => Promise<void> }) => where.evaluate(() => void (window as any).NovaRules?.check?.()).catch(() => {});
      const host = async () => {
        await fixNow(page);
        return (await page.evaluate(measureStrict).catch(() => [] as StrictFound[])).filter((f) => !barsSaid.has(f.rule + f.what + f.why) && barsSaid.add(f.rule + f.what + f.why));
      };
      // How many parts a page fixed on its own as it drew (web/shared/rules.js)
      const fixedIn = (where: { evaluate: (fn: () => number) => Promise<number> }) => where.evaluate(() => Number((window as any).NovaRules?.fixed?.() || 0)).catch(() => 0);
      const shoot = async (place: string, found: StrictFound[]) => {
        if (!opts.shotsDir || !found.length || shots >= 40) return "";
        shots++;
        const file = `${slug(place)}-${size.w}x${size.h}.png`;
        const boxes = found.map((f) => f.box).filter(Boolean) as StrictBox[];
        await page.evaluate((bs) => {
          const layer = document.createElement("div");
          layer.id = "fixer-strict-marks";
          layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
          for (const b of bs) {
            const d = document.createElement("div");
            d.style.cssText = `position:fixed;left:${b.x - 2}px;top:${b.y - 2}px;width:${b.w + 4}px;height:${b.h + 4}px;border:2px solid #ff3b5c;border-radius:4px;box-shadow:0 0 0 2px rgba(0,0,0,.6)`;
            layer.appendChild(d);
          }
          document.body.appendChild(layer);
        }, boxes).catch(() => {});
        await page.screenshot({ path: join(opts.shotsDir, file) }).catch(() => {});
        await page.evaluate(() => document.getElementById("fixer-strict-marks")?.remove()).catch(() => {});
        return file;
      };
      const record = async (place: string, ms: number, found: StrictFound[], error?: string, fixed = 0) => {
        const list = found.slice(0, MAX_PER_SCREEN);
        const shot = await shoot(place, list);
        screens.push({ place, width: size.w, height: size.h, kind: size.kind, ms, found: list, shot, fixed, ...(error ? { error } : {}) });
        log(`${place} ${size.w}×${size.h}: ${error || (list.length ? `${list.length} problem${list.length === 1 ? "" : "s"}` : "fine")}`);
      };
      const want = (place: string) => !opts.places || opts.places.includes(place);
      // The home: Agent
      if (want("Agent")) await record("Agent", Date.now() - t0, await host(), undefined, await fixedIn(page));
      // Every panel Nova Agent lists (apps, plans, tools, helpers, Invoicer, Nova)
      const panels: { name: string; path: string }[] = await page
        .evaluate(() => [...document.querySelectorAll("#suite a.suite-app[data-inside]")].map((a) => ({ name: (a.querySelector("b")?.textContent || "").trim(), path: a.getAttribute("data-inside") || "" })))
        .catch(() => []);
      const seen = new Set<string>();
      for (const p of panels) {
        if (!p.name || !p.path || seen.has(p.path) || !want(p.name)) continue;
        seen.add(p.path);
        const t = Date.now();
        try {
          if (!(await page.evaluate((path) => !!(window as any).NovaAgent?.open(path), p.path))) throw new Error("it didn't open");
          const handle = await page.waitForSelector(".main.viewing .viewer iframe:not([hidden])", { timeout: 20_000 });
          const frame = await handle.contentFrame();
          if (!frame) throw new Error("its page didn't load");
          await frame.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
          await page.waitForTimeout(settle);
          const at = await handle.boundingBox();
          await fixNow(frame);
          const inside = (await frame.evaluate(measureStrict).catch(() => [] as StrictFound[])).map((f) => ({ ...f, box: f.box && at ? { ...f.box, x: f.box.x + Math.round(at.x), y: f.box.y + Math.round(at.y) } : f.box }));
          await record(p.name, Date.now() - t, [...(await host()), ...inside], undefined, await fixedIn(frame));
        } catch (err) {
          await record(p.name, Date.now() - t, [], `couldn't be looked at (${String((err as Error).message).split("\n")[0].slice(0, 120)})`);
        }
      }
      // Missions and the Manual: opened from the navigation panel, like a person would
      for (const [place, sel] of [["Missions", '#tabbar [data-tab="pane:missions"], [data-pane="missions"]'], ["Manual", '#tabbar [data-tab="manual"], [data-act="manual"]']] as const) {
        if (!want(place)) continue;
        const t = Date.now();
        const opened = await page
          .evaluate((s) => {
            const el = [...document.querySelectorAll<HTMLElement>(s)].find((e) => e.offsetParent);
            if (!el) return false;
            el.click();
            return true;
          }, sel)
          .catch(() => false);
        if (!opened) continue;
        await page.waitForTimeout(settle);
        await record(place, Date.now() - t, await host(), undefined, await fixedIn(page));
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(300);
      }
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  try {
    const queue = [...sizes];
    const workers = Array.from({ length: Math.max(1, opts.parallel || 2) }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          await one(s);
        } catch (err) {
          screens.push({ place: "Agent", width: s.w, height: s.h, kind: s.kind, ms: 0, found: [], shot: "", error: `couldn't be opened (${String((err as Error).message).split("\n")[0].slice(0, 120)})` });
        }
      }
    });
    await Promise.all(workers);
  } finally {
    await browser.close().catch(() => {});
  }
  const order = (s: StrictScreen) => sizes.findIndex((z) => z.w === s.width && z.h === s.height);
  screens.sort((a, b) => order(a) - order(b));
  return { startedAt, finishedAt: new Date().toISOString(), base, signedIn: !!opts.cookie, screens };
}

// The pictures of one run in their own folder; older runs' folders go (the last few are kept)
export function freshShotsDir(root: string, id: string, keep = 3): string {
  mkdirSync(root, { recursive: true });
  const dirs = readdirSync(root).filter((d) => /^\d{8}-\d{6}$/.test(d)).sort();
  for (const d of dirs.slice(0, Math.max(0, dirs.length - (keep - 1)))) rmSync(join(root, d), { recursive: true, force: true });
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The problems, each thing once (with every place and size it was seen at), and how many under each rule
export type StrictProblem = { rule: StrictRule; place: string; what: string; why: string; at: { size: string; kind: StrictKind; shot: string }[] };
export function strictProblems(run: StrictRun | null): StrictProblem[] {
  const map = new Map<string, StrictProblem>();
  for (const s of run?.screens || []) {
    for (const f of s.found) {
      // (the same thing says slightly different numbers at each size: the words before them decide)
      const key = `${f.rule}|${s.place}|${f.what}|${f.why.replace(/\d+px/g, "#")}`;
      const p = map.get(key) || { rule: f.rule, place: s.place, what: f.what, why: f.why, at: [] };
      p.at.push({ size: `${s.width}×${s.height}`, kind: s.kind, shot: s.shot });
      map.set(key, p);
    }
  }
  return [...map.values()];
}
export function strictCounts(run: StrictRun | null): Record<StrictRule, number> {
  const counts: Record<StrictRule, number> = { offscreen: 0, onescreen: 0, oneline: 0 };
  for (const p of strictProblems(run)) counts[p.rule]++;
  return counts;
}
