// The looks check: does every screen of Nova Agent LOOK right? (The hourly sweep, sweep.ts, opens
// each panel on its own; this opens them the way people see them: inside Nova Agent, with the
// title panel above and the navigation panel below, signed in and signed out, at phone, tablet,
// laptop and big-screen sizes.)
//
// For each screen it measures, then judges (judge(): plain rules, no AI):
//   - a panel showing nothing (blank)
//   - a big empty gap: the top of the panel empty with its content pushed low, or a gap between
//     its parts (the "giant empty box" in Index and Portal, 14 October 2026)
//   - the panel's own header sitting low
//   - the title panel or navigation panel covering the panel, or space left unused next to them
//   - not exactly one title panel
//   - the page (or its <main>) scrolling, or content cut off at the bottom
//   - buttons part off the screen, text cut off
//   - script and console errors, and how long each panel took to open
//
// It only looks. Its browser stops every request that would change something before it leaves
// (anything but GET, HEAD and OPTIONS answers "the Fixer's check only looks"), opens no
// WebSockets, runs no service worker, and marks Nova Agent's requests as the Fixer's
// (SWEEP_HEADER: Nova Agent's server turns writes away too). Signed in, it's the built-in looks
// account (Nova Bot's src/looks-account.js), which Nova Bot also lets only look.
//
// scripts/fixer-looks.ts runs it as its own low-priority process (the Fixer calls that, see
// service.ts); looksFindings() turns its screens into the Fixer's problems.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./rules";
import { fingerprint } from "./rules";
import { SWEEP_HEADER } from "./sweep-guard";

export const LOOKS_SIZES: readonly (readonly [number, number])[] = [
  [360, 740],
  [390, 844],
  [1024, 768],
  [1440, 900],
  [1512, 1500],
  [2000, 1130],
];
// The panels, if the page doesn't list them (it does: the navigation panel's links)
export const LOOKS_PANELS: { name: string; path: string }[] = [
  { name: "Portal", path: "/portal/" },
  { name: "Calendar", path: "/calendar/" },
  { name: "Notes", path: "/notes/" },
  { name: "Board", path: "/board/" },
  { name: "Index", path: "/app/memory/" },
  { name: "Quests", path: "/quests/" },
  { name: "Lossless", path: "/lossless/" },
  { name: "Visualizer", path: "/visualizer" },
  { name: "Fixer", path: "/fixer/" },
  { name: "Console", path: "/console/" },
  { name: "Observatory", path: "/observatory/" },
];
export const HOME = { name: "Nova Agent", path: "/agent/" };
const SLOW_MS = 6000;

export type LooksKind =
  | "blank"
  | "top-gap"
  | "gap"
  | "header-low"
  | "covered"
  | "unused"
  | "title-count"
  | "page-scrolls"
  | "cut-off"
  | "main-scrolls"
  | "offscreen"
  | "text-cut"
  | "error"
  | "slow"
  | "open";
export interface LooksProblem {
  kind: LooksKind;
  severity: "serious" | "minor";
  text: string;
}
export interface LooksScreen {
  name: string;
  path: string;
  width: number;
  height: number;
  signedIn: boolean;
  ms: number; // how long it took to open (0: not measured)
  problems: LooksProblem[];
  shot: string; // a picture of it (only taken when something's wrong), "" = none
}
export interface LooksOptions {
  base: string; // https://nova.novacane.co.uk, or a job's copy of Nova Agent
  sizes?: readonly (readonly [number, number])[];
  panels?: string[]; // only these (paths; "/agent/" = the home)
  auth?: "both" | "in" | "out";
  cookie?: { name: string; value: string } | null; // signed in as the looks account
  shotsDir?: string;
  shotPrefix?: string;
  mockPortal?: (path: string, method: string) => unknown; // a job's copy has no Nova Bot: sample answers
  shootAll?: boolean; // a picture of every screen (a fix's "after"), not only the ones with something wrong
  settleMs?: number;
  log?: (line: string) => void;
}

// ================= Measuring (runs inside the page) =================
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Content {
  w: number;
  h: number; // the area measured (the panel's frame, or the home's main area)
  rows: [number, number][]; // where content is, top to bottom (merged, in px from the area's top)
  text: number; // characters of visible text
  media: number; // pictures, drawings, inputs
  header: number | null; // the panel's own header's top (px from the area's top), or null
}
export interface FrameMeasure extends Content {
  docH: number; // the page's own height (scrollHeight)
  docScrolls: boolean; // the page can be scrolled (not hidden)
  mainScrolls: boolean;
  offscreen: string[];
  textCut: string[];
  titleBars: number; // title panels drawn inside the panel itself
}
export interface HostMeasure {
  vw: number;
  vh: number;
  docH: number;
  titles: Box[]; // visible title panels
  titleInDom: boolean;
  nav: Box | null;
  navInDom: boolean;
  frame: Box | null;
  offscreen: string[];
}

// Where the content is in an area (the whole page of a panel, or the home's main area). Content:
// visible text (measured by its own lines, not its box), pictures, drawings, inputs and buttons.
// Backdrops (fixed, not clickable, or hidden from screen readers) don't count.
export function measureContent(selector: string | null): Content {
  const root = selector ? document.querySelector(selector) : null;
  const rb = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const W = rb.width, H = rb.height, X = rb.left, Y = rb.top;
  const spans: [number, number][] = [];
  let text = 0, media = 0;
  const shown = (el: Element) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    // (aria-hidden pictures and words are still on the screen: a logo, an icon)
    return !el.closest("[hidden], [inert], dialog:not([open])");
  };
  const add = (r: DOMRect) => {
    if (r.width < 2 || r.height < 2) return false;
    const top = Math.max(r.top, Y), bottom = Math.min(r.bottom, Y + H);
    if (bottom - top < 1 || r.right < X || r.left > X + W) return false;
    spans.push([top - Y, bottom - Y]);
    return true;
  };
  const scope = root || document.body;
  if (!scope) return { w: W, h: H, rows: [], text: 0, media: 0, header: null };
  // Text, line by line
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.textContent || "").trim();
    if (!t || !n.parentElement || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE)$/.test(n.parentElement.tagName)) continue;
    if (!shown(n.parentElement)) continue;
    const cs = getComputedStyle(n.parentElement);
    if (cs.color === "rgba(0, 0, 0, 0)" && !/text/.test(cs.backgroundClip)) continue;
    range.selectNodeContents(n);
    let any = false;
    for (const r of range.getClientRects()) any = add(r) || any;
    if (any) text += t.length;
  }
  // Pictures, drawings, inputs, buttons, the panels' own frames
  for (const el of scope.querySelectorAll("img, svg, canvas, video, input, textarea, select, button, iframe, [role=img], [style*=background-image]")) {
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.position === "fixed" && (cs.pointerEvents === "none" || r.width * r.height > 0.6 * innerWidth * innerHeight)) continue;
    if ((el as HTMLInputElement).type === "hidden") continue;
    if (add(r)) media++;
  }
  spans.sort((a, b) => a[0] - b[0]);
  const rows: [number, number][] = [];
  for (const s of spans) {
    const last = rows[rows.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else rows.push([Math.round(s[0]), Math.round(s[1])]);
  }
  for (const r of rows) r[1] = Math.round(r[1]);
  // The panel's own header (Nova Agent moves it into .embed-head): the first one shown
  let header: number | null = null;
  for (const el of scope.querySelectorAll(".embed-head, header")) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) continue;
    header = Math.round(r.top - Y);
    break;
  }
  return { w: Math.round(W), h: Math.round(H), rows, text, media, header };
}

// Inside a panel, besides where its content is (measureContent): the page or its <main> scrolling,
// things off the screen, text cut off. (Each runs in the page on its own, so they're two.)
export type FrameExtras = Omit<FrameMeasure, keyof Content>;
export function measureFrame(): FrameExtras {
  const se = document.scrollingElement || document.documentElement;
  const H = innerHeight, W = innerWidth;
  const hidden = (el: Element | null) => !!el && /hidden|clip/.test(getComputedStyle(el).overflowY);
  const docScrolls = se.scrollHeight > H + 2 && !hidden(document.documentElement) && !hidden(document.body);
  const main = document.querySelector("main");
  const mainScrolls = !!main && main.scrollHeight > main.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(main).overflowY) && main.getBoundingClientRect().height > 0.6 * H;
  const name = (el: Element) => {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${label ? ` “${label}”` : ""}`;
  };
  const scrollsInside = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return true;
    }
    return false;
  };
  const shown = (el: Element) => {
    const s = getComputedStyle(el);
    return !(s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) && !el.closest("[hidden], [aria-hidden=true], [inert], dialog:not([open])");
  };
  const offscreen: string[] = [];
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab]")) {
    if (offscreen.length >= 3) break;
    if (!shown(el)) continue;
    // (On a canvas you drag around, like Board's table, things past the edge are reached by moving it)
    if (el.closest("[data-pan]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= 0 || r.left >= W || r.top >= H || r.bottom <= 0) continue; // wholly away: a drawer tucked away
    if ((r.left < -2 || r.right > W + 2 || r.bottom > H + 2) && !scrollsInside(el)) offscreen.push(name(el));
  }
  const textCut: string[] = [];
  for (const el of document.querySelectorAll("body *")) {
    if (textCut.length >= 3) break;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 2);
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflowX) || cs.textOverflow === "ellipsis") continue;
    // (Words kept for screen readers only, a 1px box or clipped away, aren't cut off: they're hidden on purpose)
    if (el.clientWidth <= 4 || el.clientHeight <= 4 || cs.clip !== "auto" || cs.clipPath !== "none") continue;
    if (el.scrollWidth > el.clientWidth + 2 && shown(el)) textCut.push(name(el));
  }
  const titleBars = [...document.querySelectorAll(".nv-topbar")].filter((el) => shown(el) && el.getBoundingClientRect().height > 8).length;
  // (Content cut off by a box that doesn't scroll: the page's, the body's or <main>'s own height)
  const clipped = (el: Element | null) => (el && /hidden|clip/.test(getComputedStyle(el).overflowY) ? el.scrollHeight - el.clientHeight : 0);
  const docH = Math.max(se.scrollHeight, H + Math.max(clipped(document.body), clipped(main)));
  return { docH, docScrolls, mainScrolls, offscreen, textCut, titleBars };
}

// Nova Agent's own page: its title panels, the navigation panel, the open panel's frame
export function measureHost(): HostMeasure {
  const box = (el: Element | null): Box | null => {
    if (!el) return null;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return null;
    const r = el.getBoundingClientRect();
    // (moved out of sight: an auto-hidden bar is away, not missing)
    if (r.width < 2 || r.height < 2 || r.bottom <= 1 || r.top >= innerHeight - 1 || r.right <= 1 || r.left >= innerWidth - 1) return null;
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const tops = [...new Set(document.querySelectorAll(".shell > .topbar, .nv-topbar"))];
  const outer = tops.filter((el) => !tops.some((o) => o !== el && o.contains(el)));
  const titles = outer.map(box).filter((b): b is Box => !!b);
  const navs = [document.getElementById("suite-home"), document.getElementById("tabbar")];
  const nav = navs.map(box).find((b) => !!b) || null;
  const frames = [...document.querySelectorAll(".viewer iframe")].filter((f) => !(f as HTMLIFrameElement).hidden);
  const viewing = document.querySelector(".main.viewing");
  const frame = viewing ? frames.map(box).find((b) => !!b) || null : null;
  const offscreen: string[] = [];
  for (const [label, b] of [["the title panel", titles[0]], ["the navigation panel", nav]] as const) {
    if (b && (b.x < -2 || b.x + b.w > innerWidth + 2)) offscreen.push(label);
  }
  const se = document.scrollingElement || document.documentElement;
  return { vw: innerWidth, vh: innerHeight, docH: se.scrollHeight, titles, titleInDom: outer.length > 0, nav, navInDom: navs.some(Boolean), frame, offscreen };
}

// ================= Judging (plain rules) =================
const pct = (n: number) => `${Math.round(n * 100)}%`;
export function judgeContent(c: Content, where: "panel" | "home"): LooksProblem[] {
  const out: LooksProblem[] = [];
  if (c.h < 40) return out;
  if (!c.rows.length || (c.text < 3 && c.media === 0)) {
    out.push({ kind: "blank", severity: "serious", text: `The ${where} shows nothing (blank)` });
    return out;
  }
  const first = c.rows[0][0];
  const below = c.h - c.rows[c.rows.length - 1][1];
  if (first > 0.4 * c.h && below < 0.6 * first) out.push({ kind: "top-gap", severity: "serious", text: `The top ${pct(first / c.h)} of the ${where} is empty: its content sits low, with a big empty gap above it` });
  let gap = 0, at = 0;
  for (let i = 1; i < c.rows.length; i++) {
    const g = c.rows[i][0] - c.rows[i - 1][1];
    if (g > gap) (gap = g), (at = c.rows[i - 1][1]);
  }
  if (gap > 0.45 * c.h) out.push({ kind: "gap", severity: "serious", text: `A big empty gap (${pct(gap / c.h)} of the ${where}, ${Math.round(gap)}px) between its parts, ${Math.round(at)}px down` });
  if (c.header != null && c.header > 0.45 * c.h) out.push({ kind: "header-low", severity: "serious", text: `The ${where}'s own header sits ${pct(c.header / c.h)} of the way down instead of at the top` });
  return out;
}

export function judgeFrame(f: FrameMeasure): LooksProblem[] {
  const out = judgeContent(f, "panel");
  if (f.docScrolls) out.push({ kind: "page-scrolls", severity: "minor", text: `The panel's page scrolls (${f.docH}px tall on a ${f.h}px screen): only boxes inside it should` });
  else if (f.docH > f.h + 24) out.push({ kind: "cut-off", severity: "minor", text: `The panel's page is ${f.docH}px tall on a ${f.h}px screen and can't scroll: the bottom is cut off` });
  if (f.mainScrolls) out.push({ kind: "main-scrolls", severity: "minor", text: "The panel's whole main area scrolls: only boxes inside it should" });
  if (f.offscreen.length) out.push({ kind: "offscreen", severity: "minor", text: `Partly off the screen: ${f.offscreen.join(", ")}` });
  if (f.textCut.length) out.push({ kind: "text-cut", severity: "minor", text: `Text cut off: ${f.textCut.join(", ")}` });
  return out;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) * (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 40 ? 1 : 0);
export function judgeHost(h: HostMeasure, insideTitles: number): LooksProblem[] {
  const out: LooksProblem[] = [];
  const titles = h.titles.length + insideTitles;
  if (titles > 1) out.push({ kind: "title-count", severity: "serious", text: `${titles} title panels at once (there should be one)` });
  else if (!h.titleInDom) out.push({ kind: "title-count", severity: "serious", text: "No title panel" });
  if (h.docH > h.vh + 2) out.push({ kind: "page-scrolls", severity: "minor", text: `Nova Agent's page is taller than the screen (${h.docH}px on ${h.vh}px)` });
  if (h.offscreen.length) out.push({ kind: "offscreen", severity: "minor", text: `Partly off the screen: ${h.offscreen.join(", ")}` });
  if (h.frame) {
    const t = h.titles[0];
    const covT = t ? overlap(t, h.frame) : 0;
    const covN = h.nav ? overlap(h.nav, h.frame) : 0;
    if (covT > 4) out.push({ kind: "covered", severity: "serious", text: `The title panel covers the top ${covT}px of the panel` });
    if (covN > 4) out.push({ kind: "covered", severity: "serious", text: `The navigation panel covers the bottom ${covN}px of the panel` });
    const above = t ? h.frame.y - (t.y + t.h) : 0;
    const below = h.nav ? h.nav.y - (h.frame.y + h.frame.h) : 0;
    if (above > 40) out.push({ kind: "unused", severity: "minor", text: `${above}px of empty space between the title panel and the panel` });
    if (below > 40) out.push({ kind: "unused", severity: "minor", text: `${below}px of empty space between the panel and the navigation panel` });
  }
  return out;
}

// ================= Running it (Playwright) =================
const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
export const shotName = (prefix: string, path: string, w: number, h: number, signedIn: boolean) => `${prefix}${slug(path)}-${w}x${h}-${signedIn ? "in" : "out"}.png`;
const LOOKING = new Set(["GET", "HEAD", "OPTIONS"]);
export const NAME_SHIM = "self.__name = self.__name || ((f) => f);";

export async function runLooks(opts: LooksOptions): Promise<LooksScreen[]> {
  const { chromium } = await import("playwright");
  const base = opts.base.replace(/\/$/, "");
  const origin = new URL(base).origin;
  const sizes = opts.sizes || LOOKS_SIZES;
  const auth = opts.auth || "both";
  const states = (auth === "both" ? [false, true] : [auth === "in"]).filter((s) => !s || opts.cookie);
  const log = opts.log || (() => {});
  const settle = opts.settleMs ?? 1500;
  if (opts.shotsDir) mkdirSync(opts.shotsDir, { recursive: true });
  const out: LooksScreen[] = [];
  const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
  try {
    for (const signedIn of states) {
      for (const [width, height] of sizes) {
        const phone = width < 800;
        const ctx = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1, serviceWorkers: "block" });
        try {
          if (signedIn && opts.cookie) await ctx.addCookies([{ name: opts.cookie.name, value: opts.cookie.value, domain: new URL(origin).hostname, path: "/", secure: origin.startsWith("https:"), httpOnly: true, sameSite: "Lax" }]);
          // It only looks: nothing that would change something leaves this browser
          await ctx.route("**/*", async (route) => {
            const req = route.request();
            const url = req.url();
            if (!LOOKING.has(req.method().toUpperCase())) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The Fixer's check only looks: it never changes anything", fixerSweep: true, pcOffline: true }) });
            if (!url.startsWith(origin)) return route.continue();
            if (opts.mockPortal) {
              const u = new URL(url);
              if (/^\/(app\/api|auth|staff|tidy-api)\b/.test(u.pathname) && !u.pathname.startsWith("/app/memory")) {
                const body = opts.mockPortal(u.pathname + u.search, req.method());
                if (body) return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
              }
            }
            return route.continue({ headers: { ...req.headers(), [SWEEP_HEADER]: "1" } });
          });
          await ctx.routeWebSocket(/.*/, (ws) => void ws.close());
          // (Run with tsx, the measuring functions carry esbuild's __name helper: give every page one)
          await ctx.addInitScript({ content: NAME_SHIM });
          const page = await ctx.newPage();
          let errors: string[] = [];
          page.on("pageerror", (err) => errors.push(`script error: ${String(err.message || err).split("\n")[0].slice(0, 200)}`));
          page.on("console", (msg) => {
            if (msg.type() !== "error") return;
            const t = msg.text();
            if (/status of (40[134]|50[0-9])\b/.test(t) || /^Failed to load resource/.test(t) || /fonts\.(googleapis|gstatic)\.com/.test(t)) return;
            if (/never changes anything|fixerSweep|WebSocket|ServiceWorker|service worker/i.test(t)) return;
            errors.push(`console error: ${t.split("\n")[0].slice(0, 200)}`);
          });
          const t0 = Date.now();
          await page.goto(`${base}/agent/`, { waitUntil: "load", timeout: 45_000 });
          await page.waitForTimeout(settle + 700);
          const listed: { name: string; path: string }[] = await page
            .evaluate(() => [...document.querySelectorAll("#suite-home a.suite-app[data-inside]")].map((a) => ({ name: (a.querySelector("b")?.textContent || "").trim(), path: a.getAttribute("data-inside") || "" })))
            .catch(() => []);
          const panels = (listed.filter((p) => p.path && p.name).length ? listed.filter((p) => p.path && p.name) : LOOKS_PANELS).filter((p) => !opts.panels || opts.panels.includes(p.path));
          const screen = async (s: { name: string; path: string }, ms: number, problems: LooksProblem[]) => {
            for (const e of [...new Set(errors)].slice(0, 3)) problems.push({ kind: "error", severity: "minor", text: e });
            errors = [];
            if (ms > SLOW_MS) problems.push({ kind: "slow", severity: "minor", text: `Took ${(ms / 1000).toFixed(1)} s to open` });
            let shot = "";
            if ((problems.length || opts.shootAll) && opts.shotsDir) {
              const file = shotName(opts.shotPrefix || "", s.path, width, height, signedIn);
              await page.screenshot({ path: join(opts.shotsDir, file) }).then(() => (shot = file), () => {});
            }
            out.push({ name: s.name, path: s.path, width, height, signedIn, ms, problems, shot });
            log(`${s.name} ${width}×${height} ${signedIn ? "signed in" : "signed out"}: ${problems.length ? problems.map((p) => p.text).join("; ") : "fine"}`);
          };
          // The home
          if (!opts.panels || opts.panels.includes(HOME.path)) {
            const host = await page.evaluate(measureHost);
            const main = await page.evaluate(measureContent, ".main").catch(() => null);
            await screen(HOME, Date.now() - t0, [...judgeHost(host, 0), ...(main ? judgeContent(main, "home") : [])]);
          }
          errors = [];
          // Each panel, opened the way a tap opens it
          for (const p of panels) {
            const started = Date.now();
            let problems: LooksProblem[] = [];
            try {
              const opened = await page.evaluate((path) => !!(window as any).NovaAgent?.open(path), p.path);
              if (!opened) {
                await screen(p, 0, [{ kind: "open", severity: "serious", text: "Didn't open from the navigation panel" }]);
                continue;
              }
              const handle = await page.waitForSelector(".main.viewing .viewer iframe:not([hidden])", { timeout: 20_000 });
              const frame = await handle.contentFrame();
              if (!frame) throw new Error("no frame");
              await frame.waitForLoadState("load", { timeout: 30_000 }).catch(() => problems.push({ kind: "slow", severity: "minor", text: "Still loading after 30 seconds" }));
              const ms = Date.now() - started;
              await page.waitForTimeout(settle);
              const inside: FrameMeasure = { ...(await frame.evaluate(measureContent, null)), ...(await frame.evaluate(measureFrame)) };
              const host = await page.evaluate(measureHost);
              problems = [...problems, ...judgeHost(host, inside.titleBars), ...judgeFrame(inside)];
              await screen(p, ms, problems);
            } catch (err) {
              await screen(p, Date.now() - started, [...problems, { kind: "open", severity: "serious", text: `Couldn't be opened (${String((err as Error).message).split("\n")[0].slice(0, 160)})` }]);
            }
          }
        } catch (err) {
          out.push({ name: HOME.name, path: HOME.path, width, height, signedIn, ms: 0, problems: [{ kind: "open", severity: "serious", text: `Nova Agent didn't open (${String((err as Error).message).split("\n")[0].slice(0, 160)})` }], shot: "" });
        } finally {
          await ctx.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

// ================= The Fixer's problems =================
// One problem per panel and kind, saying every size (and signed in or out) it was seen at, so a gap
// seen at four sizes is one problem with one fix
const sizeName = (s: LooksScreen) => `${s.width}×${s.height} ${s.signedIn ? "signed in" : "signed out"}`;
export function looksFindings(screens: LooksScreen[]): Finding[] {
  const groups = new Map<string, { s: LooksScreen; p: LooksProblem }[]>();
  for (const s of screens) for (const p of s.problems) {
    const key = `${s.path}|${p.kind}`;
    const g = groups.get(key);
    if (g) g.push({ s, p });
    else groups.set(key, [{ s, p }]);
  }
  const out: Finding[] = [];
  for (const [key, g] of groups) {
    const [path, kind] = key.split("|");
    const first = g[0];
    const serious = g.some((x) => x.p.severity === "serious");
    const where = [...new Set(g.map((x) => sizeName(x.s)))];
    const lines = g.slice(0, 12).map((x) => `- ${sizeName(x.s)}: ${x.p.text}${x.s.shot ? ` (picture: ${x.s.shot})` : ""}`);
    out.push({
      fingerprint: fingerprint("looks", path, kind),
      area: "looks",
      severity: serious ? "serious" : "minor",
      title: `${first.s.name}: ${first.p.text}${where.length > 1 ? ` (and at ${where.length - 1} other size${where.length === 2 ? "" : "s"})` : ""}`,
      detail: [
        `What the Fixer's looks check saw on ${first.s.name} (${path}), opened inside Nova Agent at these screen sizes:`,
        ...lines,
        ...(g.length > 12 ? [`- and ${g.length - 12} more`] : []),
        "",
        `How to see it: open ${path === HOME.path ? "Nova Agent's home" : `${first.s.name} inside Nova Agent (/agent/, then its icon in the navigation panel)`} at ${where[0]}.`,
        `How to check a fix: npx tsx scripts/fixer-looks.ts <a running copy's address> --panels ${path} --sizes ${[...new Set(g.map((x) => `${x.s.width}x${x.s.height}`))].join(",")} --auth out --mock-portal`,
      ].join("\n"),
      panel: path,
      panels: [path],
      place: where.join(", "),
      problem: first.p.text,
    });
  }
  return out;
}

// The summary the Fixer keeps (and its Health part shows)
export interface LooksSummary {
  at: string;
  took: number;
  screens: number;
  failed: number;
  results: { name: string; path: string; width: number; height: number; signedIn: boolean; ms: number; problems: LooksProblem[]; shot: string }[];
  error: string;
}
