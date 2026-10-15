// The looks check: does every screen of Nova Agent LOOK right? (The hourly sweep, sweep.ts, opens
// each panel on its own; this opens them the way people see them: inside Nova Agent, with the
// title panel above and the navigation panel below, signed in and signed out, at phone, tablet,
// laptop and big-screen sizes. Phones (upright and on their side) and Android tablets are opened
// the way Chrome on Android opens them: touch, Android's user agent and pixel density; see
// looksDevice().)
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
//   - the text itself (measureText(), in the panel and on Nova Agent's own bars): words running into
//     other words (the navigation panel's labels at 1024 wide, 15 October 2026), text too small to
//     read, and text too faint against what's behind it
//   - after the window is made smaller with the panel open (no reload): the same text checks again,
//     so a layout that only breaks when it's resized is caught (Console's off-centre welcome)
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
  [780, 360], // a phone held sideways
  [800, 1280], // an Android tablet upright (Galaxy Tab S9)
  [1024, 768],
  [1280, 800], // an Android tablet on its side, and a small laptop
  [1366, 768], // the commonest laptop screen
  [1440, 900],
  [1512, 1500],
  [2000, 1130],
];
// How a size is opened: phones (narrower than 800, or held sideways: no taller than 500) and the
// Android tablets' sizes as Chrome on Android (touch, its user agent and pixel density, the page's
// viewport tag obeyed), everything else as a computer
export const ANDROID_TABLET_SIZES: readonly string[] = ["800x1280", "1280x800", "600x960"];
const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
export interface LooksDevice { kind: "phone" | "tablet" | "computer"; touch: boolean; dpr: number; userAgent?: string }
export function looksDevice(width: number, height: number): LooksDevice {
  if (width < 800 || (width > height && height <= 500)) return { kind: "phone", touch: true, dpr: 2, userAgent: PHONE_UA };
  if (ANDROID_TABLET_SIZES.includes(`${width}x${height}`)) return { kind: "tablet", touch: true, dpr: 2, userAgent: TABLET_UA };
  return { kind: "computer", touch: false, dpr: 1 };
}
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
  | "text-overlap"
  | "text-crammed"
  | "text-small"
  | "text-faint"
  | "error"
  | "slow"
  | "open";
export interface LooksProblem {
  kind: LooksKind;
  severity: "serious" | "minor";
  text: string;
  box?: Box; // where on the screen's picture (px), for the Fixer's card to outline it
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
  // After the panels at the biggest computer size: each opened again and the window made smaller
  // while it's open (these sizes), the text checked again (default: 1280×800 and 1024×768; [] = none)
  resizeTo?: readonly (readonly [number, number])[];
  log?: (line: string) => void;
}

// ================= Measuring (runs inside the page) =================
export interface Box {
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
  x?: number; // where the area is in its page (px), so a problem's box can be drawn on the picture
  y?: number;
}
export interface FrameMeasure extends Content {
  docH: number; // the page's own height (scrollHeight)
  docScrolls: boolean; // the page can be scrolled (not hidden)
  mainScrolls: boolean;
  offscreen: string[];
  textCut: string[];
  titleBars: number; // title panels drawn inside the panel itself
  offscreenBoxes?: Box[]; // where those are (px in the panel's page)
  textCutBoxes?: Box[];
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
  if (!scope) return { w: W, h: H, rows: [], text: 0, media: 0, header: null, x: Math.round(X), y: Math.round(Y) };
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
  // Pictures, drawings, inputs, buttons, the panels' own frames, and a space that's there to be
  // filled (data-looks-fill: Console's terminal, empty until you type, is room in use, not a gap)
  for (const el of scope.querySelectorAll("img, svg, canvas, video, input, textarea, select, button, iframe, [role=img], [style*=background-image], [data-looks-fill]")) {
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
  return { w: Math.round(W), h: Math.round(H), rows, text, media, header, x: Math.round(X), y: Math.round(Y) };
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
  const offscreenBoxes: Box[] = [];
  const boxOf = (r: DOMRect): Box => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab]")) {
    if (offscreen.length >= 3) break;
    if (!shown(el)) continue;
    // (On a canvas you drag around, like Board's table, things past the edge are reached by moving it)
    if (el.closest("[data-pan]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.right <= 0 || r.left >= W || r.top >= H || r.bottom <= 0) continue; // wholly away: a drawer tucked away
    if ((r.left < -2 || r.right > W + 2 || r.bottom > H + 2) && !scrollsInside(el)) {
      offscreen.push(name(el));
      offscreenBoxes.push(boxOf(r));
    }
  }
  const textCut: string[] = [];
  const textCutBoxes: Box[] = [];
  for (const el of document.querySelectorAll("body *")) {
    if (textCut.length >= 3) break;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim().length > 2);
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflowX) || cs.textOverflow === "ellipsis") continue;
    // (Words kept for screen readers only, a 1px box or clipped away, aren't cut off: they're hidden on purpose)
    if (el.clientWidth <= 4 || el.clientHeight <= 4 || cs.clip !== "auto" || cs.clipPath !== "none") continue;
    if (el.scrollWidth > el.clientWidth + 2 && shown(el)) {
      textCut.push(name(el));
      textCutBoxes.push(boxOf(el.getBoundingClientRect()));
    }
  }
  const titleBars = [...document.querySelectorAll(".nv-topbar")].filter((el) => shown(el) && el.getBoundingClientRect().height > 8).length;
  // (Content cut off by a box that doesn't scroll: the page's, the body's or <main>'s own height)
  const clipped = (el: Element | null) => (el && /hidden|clip/.test(getComputedStyle(el).overflowY) ? el.scrollHeight - el.clientHeight : 0);
  const docH = Math.max(se.scrollHeight, H + Math.max(clipped(document.body), clipped(main)));
  return { docH, docScrolls, mainScrolls, offscreen, textCut, titleBars, offscreenBoxes, textCutBoxes };
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

// The text on a page (a panel's, or Nova Agent's own bars: a frame's own text isn't in its host's
// page). Each line of visible text is a box (its text node's own lines, cut to what the boxes around
// it let show). Three things, a few of each at most:
//   overlap  two pieces of text whose lines run into each other, where both can be seen (the
//            topmost thing at the meeting point is one of them, not a dialog or a menu over both)
//   small    text under 9px
//   faint    text whose colour is too close to the solid colour behind it (contrast under 3:1;
//            over a picture, a gradient or a see-through panel it isn't judged: it can't be told)
//   crammed  text from two separate places (not words in one sentence) with under 3px between
//            them, like the navigation panel's names cut at their edges and meeting
//            ("ComputerObservatory", 15 October 2026)
//   cut      text cut off at its box's edge with no "…" (Nova Agent's bars; measureFrame has a panel's)
export interface TextMeasure {
  overlap: { a: string; b: string; box: Box }[];
  crammed: { a: string; b: string; box: Box }[];
  cut: { what: string; box: Box }[];
  small: { what: string; px: number; box: Box }[];
  faint: { what: string; ratio: number; box: Box }[];
}
export function measureText(): TextMeasure {
  const W = innerWidth, H = innerHeight;
  const boxOf = (r: { left: number; top: number; right: number; bottom: number }): Box => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.right - r.left), h: Math.round(r.bottom - r.top) });
  const seen = new Map<Element, boolean>();
  const visible = (el: Element): boolean => {
    if (seen.has(el)) return seen.get(el)!;
    let ok = !el.closest("[hidden], [aria-hidden=true], [inert], dialog:not([open]), template, noscript, script, style, .sr-only, .sr, .visually-hidden");
    let o = 1;
    for (let e: Element | null = el; ok && e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || (e === el && cs.visibility === "hidden")) ok = false;
      o *= Number(cs.opacity);
      if (o < 0.1) ok = false;
      if (cs.clip !== "auto" && cs.position === "absolute") ok = false;
    }
    seen.set(el, ok);
    return ok;
  };
  // What the boxes around an element let show of it (overflow hidden, clip, auto or scroll)
  const clips = new Map<Element, { left: number; top: number; right: number; bottom: number }>();
  const clipOf = (el: Element) => {
    if (clips.has(el)) return clips.get(el)!;
    let c = { left: 0, top: 0, right: W, bottom: H };
    // (from the element itself: a name cut short with "…" shows only its own box)
    for (let p: Element | null = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const r = p.getBoundingClientRect();
        c = { left: Math.max(c.left, r.left), top: Math.max(c.top, r.top), right: Math.min(c.right, r.right), bottom: Math.min(c.bottom, r.bottom) };
      }
      if (cs.position === "fixed") break;
    }
    clips.set(el, c);
    return c;
  };
  const name = (el: Element, text: string) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} “${text.trim().replace(/\s+/g, " ").slice(0, 30)}”`;
  type Run = { el: Element; text: string; l: number; t: number; r: number; b: number };
  const runs: Run[] = [];
  const small: TextMeasure["small"] = [];
  const faint: TextMeasure["faint"] = [];
  const judged = new Set<Element>();
  // Colours: [r, g, b, a] from "rgb(…)"/"rgba(…)"; the solid colour behind an element, or null
  const rgba = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const behind = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none" || cs.backdropFilter !== "none" && cs.backdropFilter) return null;
      const c = rgba(cs.backgroundColor);
      if (c && c[3] >= 0.95) return c;
      if (c && c[3] > 0.05) return null; // see-through: what shows through can't be told
    }
    return [255, 255, 255, 1];
  };
  const lum = (c: number[]) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n && runs.length < 1500; n = walker.nextNode()) {
    const text = n.textContent || "";
    if (text.trim().length < 2) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || el.closest("svg, canvas, .xterm, [contenteditable=true], textarea, select, option")) continue;
    const clip = clipOf(el);
    range.selectNodeContents(n);
    let any: Box | null = null;
    for (const q of range.getClientRects()) {
      const l = Math.max(q.left, clip.left), t = Math.max(q.top, clip.top), r = Math.min(q.right, clip.right), b = Math.min(q.bottom, clip.bottom);
      if (r - l < 2 || b - t < 2) continue;
      runs.push({ el, text, l, t, r, b });
      any = any || boxOf({ left: l, top: t, right: r, bottom: b });
    }
    if (!any || judged.has(el)) continue;
    judged.add(el);
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    if (px < 9 && small.length < 3) small.push({ what: name(el, text), px: Math.round(px * 10) / 10, box: any });
    if (faint.length < 3 && !/transparent/.test(cs.webkitTextFillColor || "") && cs.webkitTextFillColor !== "rgba(0, 0, 0, 0)") {
      const fg = rgba(cs.color), bg = behind(el);
      if (fg && bg) {
        let o = fg[3];
        for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        const mix = [0, 1, 2].map((i) => fg[i] * o + bg[i] * (1 - o));
        const [hi, lo] = [lum(mix), lum(bg)].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 3) faint.push({ what: name(el, text), ratio: Math.round(ratio * 10) / 10, box: any });
      }
    }
  }
  // Text running into other text, or crammed against it
  const overlap: TextMeasure["overlap"] = [];
  const crammed: TextMeasure["crammed"] = [];
  // (each piece of text's own block: words in one sentence share one, separate labels don't)
  const blocks = new Map<Element, Element>();
  const blockOf = (el: Element) => {
    if (blocks.has(el)) return blocks.get(el)!;
    let b: Element = el;
    while (b.parentElement && /^(inline|contents)$/.test(getComputedStyle(b).display)) b = b.parentElement;
    blocks.set(el, b);
    return b;
  };
  const mine = (hit: Element | null, el: Element) => !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  runs.sort((a, b) => a.l - b.l);
  for (let i = 0; i < runs.length && (overlap.length < 3 || crammed.length < 3); i++) {
    const a = runs[i];
    for (let j = i + 1; j < runs.length && runs[j].l < a.r; j++) {
      const b = runs[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.r, b.r) - Math.max(a.l, b.l), iy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (iy < 0.35 * Math.min(a.b - a.t, b.b - b.t)) continue;
      if (ix < 2) {
        // side by side on one line, under 3px apart, from separate blocks: crammed
        if (ix > -3 && crammed.length < 3 && blockOf(a.el) !== blockOf(b.el) && !blockOf(a.el).contains(blockOf(b.el)) && !blockOf(b.el).contains(blockOf(a.el)))
          crammed.push({ a: name(a.el, a.text), b: name(b.el, b.text), box: boxOf({ left: Math.min(a.l, b.l), top: Math.min(a.t, b.t), right: Math.max(a.r, b.r), bottom: Math.max(a.b, b.b) }) });
        continue;
      }
      const cx = Math.max(a.l, b.l) + ix / 2, cy = Math.max(a.t, b.t) + iy / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!mine(hit, a.el) && !mine(hit, b.el)) continue; // something else is over both (a menu, a dialog)
      if (overlap.length >= 3) continue;
      overlap.push({ a: name(a.el, a.text), b: name(b.el, b.text), box: boxOf({ left: Math.min(a.l, b.l), top: Math.min(a.t, b.t), right: Math.max(a.r, b.r), bottom: Math.max(a.b, b.b) }) });
      break;
    }
  }
  // Cut off at its box's edge, with no "…"
  const cut: TextMeasure["cut"] = [];
  for (const el of judged) {
    if (cut.length >= 3) break;
    const cs = getComputedStyle(el);
    if (!/hidden|clip/.test(cs.overflowX) || cs.textOverflow === "ellipsis" || el.clientWidth <= 4) continue;
    if (el.scrollWidth > el.clientWidth + 2) cut.push({ what: name(el, el.textContent || ""), box: boxOf(el.getBoundingClientRect()) });
  }
  return { overlap, crammed, cut, small, faint };
}

// ================= Judging (plain rules) =================
const pct = (n: number) => `${Math.round(n * 100)}%`;
// The smallest box around some boxes (what the Fixer's card outlines), or none
export function unionBox(boxes: (Box | null | undefined)[]): Box | undefined {
  const bs = boxes.filter((b): b is Box => !!b && b.w > 0 && b.h > 0);
  if (!bs.length) return undefined;
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}
// A problem's box moved by (dx, dy): a panel's own boxes are in its page, the picture is of Nova Agent's
export function shiftBoxes(problems: LooksProblem[], by: { x: number; y: number } | null): LooksProblem[] {
  if (!by) return problems;
  return problems.map((p) => (p.box ? { ...p, box: { ...p.box, x: p.box.x + by.x, y: p.box.y + by.y } } : p));
}
export function judgeContent(c: Content, where: "panel" | "home"): LooksProblem[] {
  const out: LooksProblem[] = [];
  if (c.h < 40) return out;
  const X = c.x || 0, Y = c.y || 0;
  if (!c.rows.length || (c.text < 3 && c.media === 0)) {
    out.push({ kind: "blank", severity: "serious", text: `The ${where} shows nothing (blank)`, box: { x: X, y: Y, w: c.w, h: c.h } });
    return out;
  }
  const first = c.rows[0][0];
  const below = c.h - c.rows[c.rows.length - 1][1];
  if (first > 0.4 * c.h && below < 0.6 * first) out.push({ kind: "top-gap", severity: "serious", text: `The top ${pct(first / c.h)} of the ${where} is empty: its content sits low, with a big empty gap above it`, box: { x: X, y: Y, w: c.w, h: Math.round(first) } });
  let gap = 0, at = 0;
  for (let i = 1; i < c.rows.length; i++) {
    const g = c.rows[i][0] - c.rows[i - 1][1];
    if (g > gap) (gap = g), (at = c.rows[i - 1][1]);
  }
  if (gap > 0.45 * c.h) out.push({ kind: "gap", severity: "serious", text: `A big empty gap (${pct(gap / c.h)} of the ${where}, ${Math.round(gap)}px) between its parts, ${Math.round(at)}px down`, box: { x: X, y: Y + Math.round(at), w: c.w, h: Math.round(gap) } });
  if (c.header != null && c.header > 0.45 * c.h) out.push({ kind: "header-low", severity: "serious", text: `The ${where}'s own header sits ${pct(c.header / c.h)} of the way down instead of at the top`, box: { x: X, y: Y + c.header, w: c.w, h: Math.max(24, Math.min(64, c.h - c.header)) } });
  return out;
}

export function judgeFrame(f: FrameMeasure): LooksProblem[] {
  const out = judgeContent(f, "panel");
  const bottom = { x: 0, y: Math.max(0, f.h - 72), w: f.w, h: Math.min(72, f.h) };
  if (f.docScrolls) out.push({ kind: "page-scrolls", severity: "minor", text: `The panel's page scrolls (${f.docH}px tall on a ${f.h}px screen): only boxes inside it should`, box: bottom });
  else if (f.docH > f.h + 24) out.push({ kind: "cut-off", severity: "minor", text: `The panel's page is ${f.docH}px tall on a ${f.h}px screen and can't scroll: the bottom is cut off`, box: bottom });
  if (f.mainScrolls) out.push({ kind: "main-scrolls", severity: "minor", text: "The panel's whole main area scrolls: only boxes inside it should", box: { x: 0, y: 0, w: f.w, h: f.h } });
  const clip = (b: Box | undefined) => (b ? { x: Math.max(0, b.x), y: Math.max(0, b.y), w: Math.min(f.w, b.x + b.w) - Math.max(0, b.x), h: Math.min(f.h, b.y + b.h) - Math.max(0, b.y) } : undefined);
  if (f.offscreen.length) out.push({ kind: "offscreen", severity: "minor", text: `Partly off the screen: ${f.offscreen.join(", ")}`, box: clip(unionBox(f.offscreenBoxes || [])) });
  if (f.textCut.length) out.push({ kind: "text-cut", severity: "minor", text: `Text cut off: ${f.textCut.join(", ")}`, box: clip(unionBox(f.textCutBoxes || [])) });
  return out;
}

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) * (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 40 ? 1 : 0);
export function judgeHost(h: HostMeasure, insideTitles: number): LooksProblem[] {
  const out: LooksProblem[] = [];
  const titles = h.titles.length + insideTitles;
  if (titles > 1) out.push({ kind: "title-count", severity: "serious", text: `${titles} title panels at once (there should be one)`, box: unionBox([...h.titles, h.frame ? { ...h.frame, h: Math.min(h.frame.h, 80) } : null]) });
  else if (!h.titleInDom) out.push({ kind: "title-count", severity: "serious", text: "No title panel" });
  if (h.docH > h.vh + 2) out.push({ kind: "page-scrolls", severity: "minor", text: `Nova Agent's page is taller than the screen (${h.docH}px on ${h.vh}px)`, box: { x: 0, y: Math.max(0, h.vh - 72), w: h.vw, h: Math.min(72, h.vh) } });
  if (h.offscreen.length) out.push({ kind: "offscreen", severity: "minor", text: `Partly off the screen: ${h.offscreen.join(", ")}` });
  if (h.frame) {
    const t = h.titles[0];
    const covT = t ? overlap(t, h.frame) : 0;
    const covN = h.nav ? overlap(h.nav, h.frame) : 0;
    const f = h.frame;
    if (covT > 4) out.push({ kind: "covered", severity: "serious", text: `The title panel covers the top ${covT}px of the panel`, box: { x: f.x, y: f.y, w: f.w, h: covT } });
    if (covN > 4) out.push({ kind: "covered", severity: "serious", text: `The navigation panel covers the bottom ${covN}px of the panel`, box: { x: f.x, y: f.y + f.h - covN, w: f.w, h: covN } });
    const above = t ? f.y - (t.y + t.h) : 0;
    const below = h.nav ? h.nav.y - (f.y + f.h) : 0;
    if (above > 40) out.push({ kind: "unused", severity: "minor", text: `${above}px of empty space between the title panel and the panel`, box: { x: f.x, y: t!.y + t!.h, w: f.w, h: above } });
    if (below > 40) out.push({ kind: "unused", severity: "minor", text: `${below}px of empty space between the panel and the navigation panel`, box: { x: f.x, y: f.y + f.h, w: f.w, h: below } });
  }
  return out;
}

// ================= Running it (Playwright) =================
const slug = (p: string) => p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
// The text checks' problems ("where": "the panel" or "Nova Agent's bars")
// (cut: only for Nova Agent's own bars; a panel's text cut off is judgeFrame's)
export function judgeText(t: TextMeasure, where: string, withCut = false): LooksProblem[] {
  const out: LooksProblem[] = [];
  if (t.crammed.length) out.push({ kind: "text-crammed", severity: "serious", text: `Text crammed against other text in ${where}: ${t.crammed.map((o) => `${o.a} against ${o.b}`).join("; ")}`, box: unionBox(t.crammed.map((o) => o.box)) });
  if (withCut && t.cut.length) out.push({ kind: "text-cut", severity: "minor", text: `Text cut off in ${where}: ${t.cut.map((x) => x.what).join(", ")}`, box: unionBox(t.cut.map((x) => x.box)) });
  if (t.overlap.length) out.push({ kind: "text-overlap", severity: "serious", text: `Text running into other text in ${where}: ${t.overlap.map((o) => `${o.a} into ${o.b}`).join("; ")}`, box: unionBox(t.overlap.map((o) => o.box)) });
  if (t.small.length) out.push({ kind: "text-small", severity: "minor", text: `Text too small to read in ${where}: ${t.small.map((x) => `${x.what} (${x.px}px)`).join(", ")}`, box: unionBox(t.small.map((x) => x.box)) });
  if (t.faint.length) out.push({ kind: "text-faint", severity: "minor", text: `Text too faint against its background in ${where}: ${t.faint.map((x) => `${x.what} (contrast ${x.ratio}:1)`).join(", ")}`, box: unionBox(t.faint.map((x) => x.box)) });
  return out;
}

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
        const dev = looksDevice(width, height);
        const ctx = await browser.newContext({
          viewport: { width, height }, screen: { width, height }, isMobile: dev.touch, hasTouch: dev.touch, deviceScaleFactor: dev.dpr, serviceWorkers: "block",
          ...(dev.userAgent ? { userAgent: dev.userAgent } : {}),
        });
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
            const text = await page.evaluate(measureText).catch(() => null);
            await screen(HOME, Date.now() - t0, [...judgeHost(host, 0), ...(main ? judgeContent(main, "home") : []), ...(text ? judgeText(text, "Nova Agent's page", true) : [])]);
          }
          errors = [];
          // Nova Agent's own bars' text, with each panel open: reported under the home, once per size
          const barsSeen = new Set<string>();
          const barsText = async (with_: string) => {
            const t = await page.evaluate(measureText).catch(() => null);
            if (!t) return;
            const fresh = judgeText(t, `Nova Agent's bars (with ${with_} open)`, true).filter((p) => !barsSeen.has(p.kind));
            for (const p of fresh) barsSeen.add(p.kind);
            if (fresh.length) await screen({ name: HOME.name, path: HOME.path }, 0, fresh);
          };
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
              const text = await frame.evaluate(measureText).catch(() => null);
              const host = await page.evaluate(measureHost);
              problems = [...problems, ...judgeHost(host, inside.titleBars), ...shiftBoxes(judgeFrame(inside), host.frame), ...(text ? shiftBoxes(judgeText(text, "the panel"), host.frame) : [])];
              await screen(p, ms, problems);
              await barsText(p.name);
            } catch (err) {
              await screen(p, Date.now() - started, [...problems, { kind: "open", severity: "serious", text: `Couldn't be opened (${String((err as Error).message).split("\n")[0].slice(0, 160)})` }]);
            }
          }
          // Made smaller while open (the biggest computer size only): each panel's text checked again
          const biggest = sizes.filter(([w, h]) => looksDevice(w, h).kind === "computer").sort((a, b) => b[0] * b[1] - a[0] * a[1])[0];
          const shrinkTo = opts.resizeTo ?? [[1280, 800], [1024, 768]];
          if (biggest && biggest[0] === width && biggest[1] === height && shrinkTo.length) {
            for (const p of panels) {
              try {
                await page.setViewportSize({ width, height });
                if (!(await page.evaluate((path) => !!(window as any).NovaAgent?.open(path), p.path))) continue;
                const handle = await page.waitForSelector(".main.viewing .viewer iframe:not([hidden])", { timeout: 20_000 });
                const frame = await handle.contentFrame();
                if (!frame) continue;
                await page.waitForTimeout(settle);
                for (const [w2, h2] of shrinkTo) {
                  await page.setViewportSize({ width: w2, height: h2 });
                  await page.waitForTimeout(700);
                  const t = await frame.evaluate(measureText).catch(() => null);
                  const hostT = await page.evaluate(measureText).catch(() => null);
                  const host = await page.evaluate(measureHost);
                  const found = [...(t ? shiftBoxes(judgeText(t, `the panel, after the window was made ${w2}×${h2}`), host.frame) : []), ...(hostT ? judgeText(hostT, `Nova Agent's bars, after the window was made ${w2}×${h2}`, true) : [])];
                  if (found.length) await screen({ name: `${p.name} (made smaller while open, from ${width}×${height})`, path: p.path }, 0, found);
                }
              } catch {}
            }
            await page.setViewportSize({ width, height });
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
