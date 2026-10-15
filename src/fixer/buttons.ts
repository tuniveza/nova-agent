// The buttons check: does every button DO something? (Every 5 minutes, service.ts; a few panels each
// time, so every panel is pressed through about every half hour.) Each panel is opened inside Nova
// Agent the way a tap opens it, and every button, tab, toggle and link people can see is pressed, one
// at a time, the way a finger presses it (a real click). A press works when anything happens:
//   - the page changes (something shows, hides, opens, switches, is added or taken away)
//   - it asks Nova Bot or Nova Agent for something, or tries to save (this browser turns every save
//     away, "the Fixer's check only looks", but it tried: that's working)
//   - it goes somewhere (another page, a new tab), or opens a dialog
//   - its own state changes (pressed, open, chosen, ticked), or something else gets the focus
//   - it prints, shares, copies, plays a sound, or remembers a choice (this browser's own storage)
// It's broken when (judgeButton):
//   - nothing at all happens, even pressed again and given longer ("does nothing")
//   - a script error comes right after the press ("goes wrong when pressed"), unless it was a save
//     this check turned away
//   - a link inside Nova Agent leads to a page that isn't there ("leads nowhere": checked by asking
//     for the page, not by following it)
//   - it takes you to Portal instead of doing what it says ("goes to Portal"): Portal opens (in Nova
//     Agent, a new page or tab, or a link there) when the button's own words don't say Portal, sign in,
//     profile or connect. People want the thing done where they pressed it.
// After each press it tidies up (Escape, any dialog it opened closed), and opens the panel afresh
// every few presses or when the press went somewhere else.
//
// It only looks, like the looks check (looks.ts): every request that would change something is
// answered "the Fixer's check only looks" before it leaves this browser, no WebSockets, no service
// worker, and Nova Agent's own requests are marked as the Fixer's (SWEEP_HEADER). Printing, sharing,
// copying, new windows and alert/confirm/prompt are stood in for (counted, so nothing waits).
// Links to other sites, email, phone and messaging links are not pressed. Anything marked
// [data-check-skip] is left alone.

import { looksDevice, HOME, LOOKS_PANELS, NAME_SHIM, type LooksProblem, type LooksScreen } from "./looks";
import { SWEEP_HEADER } from "./sweep-guard";

// The sizes it uses, one per run in turn: a computer, a phone, a tablet
export const BUTTON_SIZES: readonly [number, number][] = [
  [1440, 900],
  [390, 844],
  [800, 1280],
];
export const BUTTONS_PER_PANEL = 40; // pressed at most, per panel
export const PANELS_PER_RUN = 3;
export const BUTTONS_WINDOW_MS = 100 * 60_000; // the screens its problems are made from

// Which panels and size a run looks at: run n (one every 5 minutes) takes the next three panels;
// when they've all been looked at, the next size. So each panel is pressed through about every half
// hour, at each size every hour and a half.
export function buttonsPlan(slot: number, panels: number, sizes = BUTTON_SIZES): { size: [number, number]; from: number; count: number } {
  const groups = Math.max(1, Math.ceil(Math.max(1, panels) / PANELS_PER_RUN));
  const s = ((slot % (groups * sizes.length)) + groups * sizes.length) % (groups * sizes.length);
  return { size: [...sizes[Math.floor(s / groups)]] as [number, number], from: (s % groups) * PANELS_PER_RUN, count: PANELS_PER_RUN };
}
export const slotAt = (at: Date) => Math.floor(at.getTime() / (5 * 60_000));

// ================= Judging one press =================
export interface PressSeen {
  changed: number; // changes to the page (not the ones that happen by themselves: clocks, animations)
  requests: number; // asked for something (any frame)
  blocked: number; // tried to save (turned away by this check)
  went: boolean; // went somewhere (the page or the panel loaded something else, or a new tab)
  dialogs: number; // dialogs opened
  state: boolean; // its own state changed (aria-pressed/expanded/selected/checked, open, ticked)
  focus: boolean; // something else got the focus
  calls: number; // print, share, copy, a new window, alert/confirm/prompt, a sound, a choice remembered
  downloads: number;
  errors: string[]; // script errors right after
  portal?: boolean; // Portal opened (in Nova Agent, the page went there, or a new tab/window to it)
  failed?: string[]; // what it asked for and didn't get ("GET /app/api/x → 500")
  said?: string[]; // a message it put up saying something went wrong ("Couldn't load…")
}
export type Verdict = "works" | "does-nothing" | "click-error" | "goes-to-portal";
// A button whose own words say it goes to Portal (or signs in, opens a profile, connects an account)
export const SAYS_PORTAL = /portal|admin|sign ?in|log ?in|profile|connect|account/i;
export const isPortalUrl = (u: string) => /\/portal(\/|\?|#|$)/.test(u.replace(/^https?:\/\/[^/]+/, ""));
export function judgePress(s: PressSeen, says = ""): { verdict: Verdict; why: string } {
  if (s.portal && !SAYS_PORTAL.test(says)) return { verdict: "goes-to-portal", why: "opens Portal instead" };
  const did = s.changed > 0 || s.requests > 0 || s.blocked > 0 || s.went || s.dialogs > 0 || s.state || s.focus || s.calls > 0 || s.downloads > 0;
  // (a save turned away by this check can make the page's own code complain: that's this check, not a
  // fault; so can a live connection, which this check closes: the remote desktop's, a live feed's; or
  // a sign-in window, which this check doesn't open: Google's)
  const errors = s.blocked > 0 ? [] : s.errors.filter((e) => !/only looks|fixerSweep|pcOffline|\b503\b|Failed to fetch|NetworkError|AbortError|aborted|WebSocket|websock|Raw channel|popup/i.test(e));
  if (errors.length) return { verdict: "click-error", why: errors[0] };
  if (s.failed?.length) return { verdict: "click-error", why: `asked for something and got an error: ${s.failed[0]}` };
  if (s.said?.length && !s.blocked) return { verdict: "click-error", why: `says “${s.said[0]}”` };
  if (!did) return { verdict: "does-nothing", why: "" };
  const how = s.went ? "went somewhere" : s.dialogs ? "opened a dialog" : s.blocked ? "tried to save" : s.requests ? "asked for something" : s.state ? "changed its state" : s.changed ? "changed the page" : s.calls ? "printed, shared, copied or played" : s.focus ? "moved the focus" : "downloaded";
  return { verdict: "works", why: how };
}

export interface ButtonResult {
  what: string; // button “Save notes” (#note-save)
  label: string;
  primary: boolean; // it has words on it (not only an icon)
  verdict: Verdict | "broken-link";
  why: string;
}
// One screen's presses as the Fixer's problems: one problem for each kind, naming the buttons
export function buttonsProblems(results: ButtonResult[], where: string): LooksProblem[] {
  const out: LooksProblem[] = [];
  const list = (rs: ButtonResult[]) => rs.slice(0, 8).map((r) => r.what + (r.why && r.verdict !== "does-nothing" ? ` (${r.why})` : "")).join("; ") + (rs.length > 8 ? `; and ${rs.length - 8} more` : "");
  const nothing = results.filter((r) => r.verdict === "does-nothing");
  const errors = results.filter((r) => r.verdict === "click-error");
  const links = results.filter((r) => r.verdict === "broken-link");
  const portal = results.filter((r) => r.verdict === "goes-to-portal");
  if (portal.length) out.push({ kind: "goes-to-portal", severity: "serious", text: `Opens Portal instead of doing what it says in ${where}: ${list(portal)}` });
  if (nothing.length) out.push({ kind: "does-nothing", severity: nothing.some((r) => r.primary) ? "serious" : "minor", text: `Does nothing when pressed in ${where}: ${list(nothing)}` });
  if (errors.length) out.push({ kind: "click-error", severity: "serious", text: `Goes wrong when pressed in ${where}: ${list(errors)}` });
  if (links.length) out.push({ kind: "broken-link", severity: "serious", text: `Leads nowhere in ${where}: ${list(links)}` });
  return out;
}

// The screens kept for the last 100 minutes (a run presses only a few panels at one size), newest
// for each panel, size and signed in or out: the problems are made from all of them
export type ButtonsScreen = LooksScreen & { at: string; pressed: number };
export function rollButtons(kept: ButtonsScreen[], fresh: (LooksScreen & { pressed?: number })[], at: Date, windowMs = BUTTONS_WINDOW_MS): ButtonsScreen[] {
  const key = (s: LooksScreen) => `${s.path}|${s.width}x${s.height}|${s.signedIn ? 1 : 0}`;
  const now = at.toISOString();
  const seen = new Set(fresh.map(key));
  return [...kept.filter((s) => !seen.has(key(s)) && at.getTime() - Date.parse(s.at) < windowMs), ...fresh.map((s) => ({ ...s, pressed: s.pressed || 0, at: now }))];
}

// ================= In the page =================
// Put into every page and frame before its own scripts: the counters, and stand-ins for printing,
// sharing, copying, new windows and alert/confirm/prompt (counted; nothing waits for a person)
export const PRESS_SHIM = `(() => {
  if (window.__press) return;
  const P = (window.__press = { muts: 0, attrs: 0, all: 0, calls: 0, sounds: 0, stores: 0, errors: [], bad: [], opened: [], token: Math.random().toString(36).slice(2), noisy: new WeakSet(), watching: false });
  const count = () => (P.calls++, undefined);
  window.print = () => count();
  window.open = (u) => (count(), P.opened.push(String(u || "")), null);
  window.alert = () => count();
  window.confirm = () => (count(), false);
  window.prompt = () => (count(), null);
  try { if (navigator.share) navigator.share = () => (count(), Promise.resolve()); } catch (e) {}
  try { if (navigator.clipboard) { navigator.clipboard.writeText = () => (count(), Promise.resolve()); navigator.clipboard.write = () => (count(), Promise.resolve()); } } catch (e) {}
  try { const ec = document.execCommand.bind(document); document.execCommand = (c, ...a) => (/copy|cut/i.test(c) && count(), ec(c, ...a)); } catch (e) {}
  try { const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { P.sounds++; try { return play.call(this).catch(() => {}); } catch (e) { return Promise.resolve(); } }; } catch (e) {}
  try { const start = AudioScheduledSourceNode.prototype.start; AudioScheduledSourceNode.prototype.start = function (...a) { P.sounds++; return start.apply(this, a); }; } catch (e) {}
  try { if (HTMLInputElement.prototype.showPicker) HTMLInputElement.prototype.showPicker = function () { count(); }; } catch (e) {}
  try { if (window.Notification && Notification.requestPermission) { const ask = Notification.requestPermission.bind(Notification); Notification.requestPermission = (...a) => (count(), ask(...a)); } } catch (e) {}
  try { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { if (P.watching) P.stores++; return set.apply(this, a); }; } catch (e) {}
  addEventListener("error", (e) => P.errors.push(String((e && (e.message || (e.error && e.error.message))) || "error").slice(0, 200)));
  addEventListener("unhandledrejection", (e) => P.errors.push(String((e && e.reason && (e.reason.message || e.reason)) || "a promise failed").slice(0, 200)));
  const watch = () => {
    new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (m.type !== "attributes" || (m.attributeName !== "style" && !/^data-press/.test(m.attributeName || ""))) P.all++;
        if (!el || P.noisy.has(el)) continue;
        if (P.baseline) { P.noisy.add(el); continue; }
        // (only what can be seen: not style ticks of an animation, not the counters' own marks)
        if (m.type === "attributes" && (m.attributeName === "style" || /^data-press/.test(m.attributeName || ""))) continue;
        // (a class or state changed on something: kept apart, so a redraw on every press can't hide it)
        if (m.type === "attributes") P.attrs++;
        else P.muts++;
        // (a message saying it went wrong, put up just now)
        const t = m.type === "characterData" ? m.target.textContent : m.type === "childList" ? [...m.addedNodes].map((n) => n.textContent || "").join(" ") : "";
        if (t && t.length < 400 && /\\b(couldn['’]?t|could not|went wrong|failed to|isn['’]?t working|something's wrong)\\b/i.test(t) && !/only looks|fixer|not supported|not allowed|permission|popup/i.test(t)) P.bad.push(t.trim().replace(/\\s+/g, " ").slice(0, 120));
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  };
  if (document.documentElement) watch(); else addEventListener("DOMContentLoaded", watch);
})();`;

// The things to press in this document (a panel's page, or Nova Agent's own when home): what people
// can see and press, at most `max`, each with a selector to find it again after the panel's reopened
export interface Pressable {
  sel: string;
  what: string;
  label: string;
  primary: boolean;
  says: string; // its own words: label, aria-label, title
  submits: boolean; // it sends a form
  chosen: boolean; // a tab or choice that's already the one chosen (pressing it again rightly does nothing)
  link: string; // a link inside Nova Agent to check by asking for it ("" = press it)
  skip: string; // why it isn't pressed ("" = it is)
}
export function listPressables(opts: { max: number; host: boolean; inDialog?: boolean }): Pressable[] {
  const cssPath = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.id) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      const p: Element | null = e.parentElement;
      const same = p ? [...p.children].filter((c) => c.tagName === e!.tagName) : [e];
      parts.unshift(`${e.tagName.toLowerCase()}:nth-of-type(${same.indexOf(e) + 1})`);
    }
    return parts.join(" > ");
  };
  const shown = (el: Element) => {
    if (el.closest("[hidden], [inert], [aria-hidden=true], dialog:not([open]), template, [data-check-skip], [data-pan]")) return false;
    // (inside a closed fold: only its summary shows)
    const det = el.closest("details:not([open])");
    if (det && !(el.tagName === "SUMMARY" && el.parentElement === det) && !el.closest("summary")) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width >= 6 && r.height >= 6;
  };
  const out: Pressable[] = [];
  const seen = new Set<string>();
  const all = document.querySelectorAll("button, [role=button], [role=tab], [role=switch], [role=menuitem], a[href], summary, input[type=checkbox], input[type=radio]");
  for (const el of all) {
    if (out.length >= opts.max) break;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true" || el.closest("fieldset[disabled]")) continue;
    // (Nova Agent's navigation panel opens the panels: the looks check opens every one of them)
    if (opts.host && el.closest("#suite-home, .tabbar, .viewer")) continue;
    if (!shown(el)) continue;
    // (what a dialog that just opened holds: only what's in it, the rest is behind it)
    if (opts.inDialog && !el.closest("dialog[open], [role=dialog]:not([hidden]), [role=menu]:not([hidden]), [popover]")) continue;
    const words = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ");
    const label = words.slice(0, 50) || (el.id ? `#${el.id}` : el.tagName.toLowerCase());
    const tag = el.tagName.toLowerCase();
    const key = `${tag}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sel = cssPath(el);
    const what = `${tag === "a" ? "link" : tag === "input" ? (el as HTMLInputElement).type : tag === "summary" ? "fold" : el.getAttribute("role") || tag} “${label}”${el.id ? ` (#${el.id})` : ""}`;
    const primary = /[a-z]{2}/i.test((el as HTMLElement).innerText || "");
    let link = "";
    let skip = "";
    if (el instanceof HTMLAnchorElement) {
      const href = el.getAttribute("href") || "";
      if (/^(mailto|tel|sms|whatsapp|fb-messenger):/i.test(href) || /wa\.me|t\.me\//i.test(href)) skip = "a message link";
      else if (el.hasAttribute("download")) skip = "a download";
      else if (/^https?:/i.test(el.href) && new URL(el.href).origin !== location.origin) skip = "another site";
      else if (href && !href.startsWith("#") && !/^javascript:/i.test(href)) link = el.href;
    }
    const says = [words, el.getAttribute("aria-label") || "", el.getAttribute("title") || ""].join(" ");
    const role = el.getAttribute("role") || "";
    const chosen = (/^(tab|radio|option)$/.test(role) || (el instanceof HTMLInputElement && el.type === "radio")) && (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-current") === "true" || (el as HTMLInputElement).checked === true);
    const submits = !!(el as HTMLButtonElement).form && ((el as HTMLButtonElement).type === "submit" || (el instanceof HTMLInputElement && el.type === "submit"));
    out.push({ sel, what, label, primary, says, chosen, submits, link, skip });
  }
  return out;
}

// What the page is like just now (before and after a press), for one document
export interface DocState {
  token: string;
  muts: number;
  attrs: number; // classes and states changed
  all: number; // every change, the ones that happen by themselves too
  words: string; // what the page says (numbers left out: a clock's ticking isn't a change), in short
  calls: number; // printed, shared, copied, a new window, alert/confirm/prompt, asked to show pop-ups
  sounds: number;
  stores: number; // choices remembered (this browser's storage)
  errors: number;
  bad: number;
  url: string;
  dialogs: number;
  focus: string;
  el: string; // the pressed thing's own state ("" = it's gone)
  viewing: string; // Nova Agent's page: the panel open (its address); else ""
  opened: string[]; // addresses window.open was asked for
}
export function docState(sel: string | null): DocState {
  const P = (window as any).__press || { token: "", muts: 0, attrs: 0, all: 0, calls: 0, sounds: 0, stores: 0, errors: [], opened: [] };
  const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
  const a = el ? ["aria-pressed", "aria-expanded", "aria-selected", "aria-checked", "aria-current", "open", "class"].map((n) => el.getAttribute(n) ?? "").join("|") + `|${(el as HTMLInputElement).checked ?? ""}|${el.isConnected}` : "";
  const f = document.activeElement;
  // (the pressed thing taking the focus is just the press)
  const own = !!(el && f && (el === f || el.contains(f)));
  return {
    token: P.token,
    muts: P.muts,
    attrs: P.attrs || 0,
    all: P.all || 0,
    words: (() => {
      const t = ((document.body && document.body.innerText) || "").replace(/\d+/g, "#").slice(0, 40000);
      let h = 0;
      for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      return `${t.length}:${h}`;
    })(),
    calls: P.calls,
    sounds: P.sounds || 0,
    stores: P.stores || 0,
    errors: P.errors.length,
    bad: (P.bad || []).length,
    url: location.href,
    dialogs: document.querySelectorAll("dialog[open], [role=dialog]:not([hidden]), [popover]:popover-open").length,
    focus: f && f !== document.body && !own ? `${f.tagName}#${f.id}.${(f as HTMLElement).className}`.slice(0, 120) : "",
    el: a,
    viewing: (document.querySelector(".main.viewing .viewer iframe:not([hidden])") as HTMLIFrameElement | null)?.getAttribute("src") || "",
    opened: [...(P.opened || [])],
  };
}
// The page settles: what changes by itself (clocks, counters) is noted, so it doesn't count as a press working
export function settleNoise(on: boolean) {
  const P = (window as any).__press;
  if (!P) return;
  P.baseline = on;
  P.watching = !on;
}
export function errorsSince(n: number): string[] {
  const P = (window as any).__press;
  return P ? P.errors.slice(n) : [];
}
export function saidSince(n: number): string[] {
  const P = (window as any).__press;
  return P && P.bad ? P.bad.slice(n) : [];
}
// Tidy up after a press: dialogs it opened closed, folds it opened shut again, the focus let go
export function tidyUp() {
  // (Escape inside this page: a menu or a fold that closes on it does. Never on Nova Agent's own
  // page from a panel: there Escape closes the panel itself)
  const at = (document.activeElement as HTMLElement | null) || document.body;
  if (at) at.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  for (const d of document.querySelectorAll("dialog[open]")) {
    try {
      (d as HTMLDialogElement).close();
    } catch {}
  }
  try {
    for (const p of document.querySelectorAll("[popover]")) if ((p as any).matches(":popover-open")) (p as any).hidePopover();
  } catch {}
  (document.activeElement as HTMLElement | null)?.blur?.();
}

// ================= Running it (Playwright) =================
const LOOKING = new Set(["GET", "HEAD", "OPTIONS"]);
export interface ButtonsOptions {
  base: string;
  size: [number, number];
  panels?: string[]; // only these (paths; "/agent/" = Nova Agent's own page); else `from`/`count` of all
  from?: number;
  count?: number;
  cookie?: { name: string; value: string } | null;
  mockPortal?: (path: string, method: string) => unknown;
  maxPerPanel?: number;
  budgetMs?: number; // stop starting new panels after this long
  log?: (line: string) => void;
}
export type ButtonsRun = LooksScreen & { pressed: number; results: ButtonResult[] };

// -> the panels pressed through, and how many panels there are in all (with Nova Agent's own page)
export async function runButtons(opts: ButtonsOptions): Promise<{ screens: ButtonsRun[]; total: number }> {
  const { chromium } = await import("playwright");
  const base = opts.base.replace(/\/$/, "");
  const origin = new URL(base).origin;
  const [width, height] = opts.size;
  const signedIn = Boolean(opts.cookie);
  const log = opts.log || (() => {});
  const started = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  const max = opts.maxPerPanel ?? BUTTONS_PER_PANEL;
  const out: ButtonsRun[] = [];
  let total = 0;
  const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
  try {
    const dev = looksDevice(width, height);
    const ctx = await browser.newContext({
      viewport: { width, height }, screen: { width, height }, isMobile: dev.touch, hasTouch: dev.touch, deviceScaleFactor: dev.dpr, serviceWorkers: "block", acceptDownloads: false,
      ...(dev.userAgent ? { userAgent: dev.userAgent } : {}),
    });
    if (opts.cookie) await ctx.addCookies([{ name: opts.cookie.name, value: opts.cookie.value, domain: new URL(origin).hostname, path: "/", secure: origin.startsWith("https:"), httpOnly: true, sameSite: "Lax" }]);
    // Requests, each with when and what: only the ones a press makes count. Anything asked for while
    // nothing's being pressed (the page's own polling, a clock) is noted, and doesn't count after.
    const asked: { at: number; path: string; write: boolean }[] = [];
    const pressReqs = new WeakSet<object>();
    const failed: { at: number; text: string }[] = [];
    const noisy = new Set<string>();
    let pressing = false;
    const note = (url: string, type: string, write: boolean) => {
      let path = url;
      try {
        const u = new URL(url);
        path = u.origin + u.pathname;
      } catch {}
      if (!pressing) return void noisy.add(path);
      if (!write && !["fetch", "xhr", "document", "eventsource"].includes(type)) return false;
      asked.push({ at: Date.now(), path, write });
      return true;
    };
    const madeSince = (t: number, write: boolean) => asked.filter((a) => a.at >= t && a.write === write && !noisy.has(a.path)).length;
    // It only looks: nothing that would change something leaves this browser
    await ctx.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      if (note(url, req.resourceType(), !LOOKING.has(req.method().toUpperCase()))) pressReqs.add(req);
      if (!LOOKING.has(req.method().toUpperCase())) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "The Fixer's check only looks: it never changes anything", fixerSweep: true, pcOffline: true }) });
      }
      if (!url.startsWith(origin)) return route.continue().catch(() => {});
      if (opts.mockPortal) {
        const u = new URL(url);
        if (/^\/(app\/api|auth|staff|tidy-api)\b/.test(u.pathname) && !u.pathname.startsWith("/app/memory")) {
          const body = opts.mockPortal(u.pathname + u.search, req.method());
          if (body) return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        }
      }
      return route.continue({ headers: { ...req.headers(), [SWEEP_HEADER]: "1" } }).catch(() => {});
    });
    await ctx.routeWebSocket(/.*/, (ws) => void ws.close());
    await ctx.addInitScript({ content: NAME_SHIM });
    await ctx.addInitScript({ content: PRESS_SHIM });
    // (signed out, "sign in first" answers are expected: not a fault)
    ctx.on("response", (r) => {
      const req = r.request();
      if (!pressReqs.has(req) || !LOOKING.has(req.method().toUpperCase()) || r.status() < 400) return;
      if ((r.status() === 401 || r.status() === 403) && !signedIn) return;
      let path = r.url();
      try {
        path = new URL(path).pathname;
      } catch {}
      failed.push({ at: Date.now(), text: `${req.method()} ${path} → ${r.status()}` });
    });
    let popups = 0;
    let downloads = 0;
    const popupUrls: string[] = [];
    let page = await ctx.newPage();
    let making = false; // (the page being made again: not a new tab)
    ctx.on("page", (p) => {
      if (p === page || making) return;
      popups++;
      popupUrls.push(p.url());
      void p.waitForLoadState("domcontentloaded", { timeout: 3000 }).then(() => popupUrls.push(p.url())).catch(() => {}).finally(() => void p.close().catch(() => {}));
    });
    const pageErrors: string[] = [];
    // (the page the panels open in; made again if it's closed or stuck)
    const attach = (pg: import("playwright").Page) => {
      pg.on("download", (d) => {
        downloads++;
        void d.cancel().catch(() => {});
      });
      pg.on("pageerror", (err) => pageErrors.push(String(err.message || err).split("\n")[0].slice(0, 200)));
    };
    attach(page);
    const freshPage = async () => {
      await page.close().catch(() => {});
      making = true;
      try {
        page = await ctx.newPage();
      } finally {
        making = false;
      }
      attach(page);
    };

    const goHome = async () => {
      await page.goto(`${base}/agent/`, { waitUntil: "load", timeout: 45_000 });
      await page.waitForTimeout(1800);
    };
    await goHome();
    const listed: { name: string; path: string }[] = await page
      .evaluate(() => [...document.querySelectorAll("#suite-home a.suite-app[data-inside]")].map((a) => ({ name: (a.querySelector("b")?.textContent || "").trim(), path: a.getAttribute("data-inside") || "" })))
      .catch(() => []);
    const every = [HOME, ...(listed.filter((p) => p.path && p.name).length ? listed.filter((p) => p.path && p.name) : LOOKS_PANELS)];
    total = every.length;
    const panels = opts.panels ? every.filter((p) => opts.panels!.includes(p.path)) : every.slice(opts.from || 0, (opts.from || 0) + (opts.count || every.length));

    // The panel open, its page (the frame), ready to press
    // (fresh: Nova Agent loaded again first, so nothing the last panel left open is in the way)
    const openPanel = async (path: string, fresh = false) => {
      if (path === HOME.path) {
        await goHome();
        return page.mainFrame();
      }
      if (fresh || !page.url().includes("/agent")) await goHome();
      if (!(await page.evaluate((p) => !!(window as any).NovaAgent?.open(p), path).catch(() => false))) {
        await goHome();
        if (!(await page.evaluate((p) => !!(window as any).NovaAgent?.open(p), path).catch(() => false))) return null;
      }
      const handle = await page.waitForSelector(".main.viewing .viewer iframe:not([hidden])", { timeout: 20_000 }).catch(() => null);
      const frame = handle ? await handle.contentFrame() : null;
      if (!frame) return null;
      await frame.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return frame;
    };
    const state = async (f: import("playwright").Frame, sel: string | null): Promise<DocState | null> => f.evaluate(docState, sel).catch(() => null);
    // A stand-in button with nothing behind it, pressed once each time a panel opens: whatever happens
    // then (a sound on every press, a class on every tap) happens for every button, so it's taken off
    const idle = { changed: 0, attrs: 0, sounds: 0, stores: 0 };
    const measureIdle = async (f: import("playwright").Frame) => {
      const ok = await f
        .evaluate(() => {
          const b = document.createElement("button");
          b.type = "button";
          b.setAttribute("data-press-dummy", "");
          b.textContent = "·";
          b.style.cssText = "position:fixed;left:0;bottom:0;width:24px;height:24px;opacity:.02;z-index:2147483647;margin:0;padding:0;border:0";
          (document.body || document.documentElement).append(b);
          return true;
        })
        .catch(() => false);
      if (!ok) return;
      await page.waitForTimeout(150);
      const a = await state(f, null);
      const ha = f === page.mainFrame() ? null : await state(page.mainFrame(), null);
      await f.locator("[data-press-dummy]").click({ timeout: 2000, force: true }).catch(() => {});
      await page.waitForTimeout(450);
      const b = await state(f, null);
      const hb = f === page.mainFrame() ? null : await state(page.mainFrame(), null);
      idle.changed = (a && b ? b.muts - a.muts : 0) + (ha && hb ? hb.muts - ha.muts : 0);
      idle.attrs = (a && b ? b.attrs - a.attrs : 0) + (ha && hb ? hb.attrs - ha.attrs : 0);
      idle.sounds = (a && b ? b.sounds - a.sounds : 0) + (ha && hb ? hb.sounds - ha.sounds : 0);
      idle.stores = (a && b ? b.stores - a.stores : 0) + (ha && hb ? hb.stores - ha.stores : 0);
      await f.evaluate(() => document.querySelectorAll("[data-press-dummy]").forEach((x) => x.remove())).catch(() => {});
      await page.waitForTimeout(100);
    };
    let idleRate = 0; // changes a millisecond, by themselves
    const settle = async (f: import("playwright").Frame) => {
      // (a moment of the page left alone: what changes by itself then is noise)
      await Promise.all([f.evaluate(settleNoise, true).catch(() => {}), f === page.mainFrame() ? null : page.evaluate(settleNoise, true).catch(() => {})]);
      const a0 = await state(f, null);
      const t0 = Date.now();
      await page.waitForTimeout(700);
      const a1 = await state(f, null);
      idleRate = a0 && a1 ? Math.max(0, a1.all - a0.all) / Math.max(1, Date.now() - t0) : 0;
      await Promise.all([f.evaluate(settleNoise, false).catch(() => {}), f === page.mainFrame() ? null : page.evaluate(settleNoise, false).catch(() => {})]);
      await measureIdle(f);
    };

    for (const p of panels) {
      if (Date.now() - started > budget) break;
      const results: ButtonResult[] = [];
      let frame = await openPanel(p.path, true).catch(() => null);
      // (couldn't: the page made again, and tried once more)
      if (!frame) {
        await freshPage().catch(() => {});
        frame = await openPanel(p.path, true).catch(() => null);
      }
      if (!frame) {
        out.push({ name: p.name, path: p.path, width, height, signedIn, ms: 0, problems: [], shot: "", pressed: 0, results });
        log(`${p.name}: couldn't be opened (the looks check reports that)`);
        continue;
      }
      // (a welcome or guide that opens by itself on a first visit: closed, as a person would)
      await frame.evaluate(tidyUp).catch(() => {});
      await settle(frame);
      const host = p.path === HOME.path;
      const list: Pressable[] = await frame.evaluate(listPressables, { max, host }).catch((err) => (process.env.BUTTONS_DEBUG && log(`    couldn't list: ${String(err).slice(0, 200)}`), []));
      if (process.env.BUTTONS_DEBUG) log(`    ${list.length} to press (${list.filter((x) => x.skip).length} skipped, ${list.filter((x) => x.link).length} links) in ${frame.url()}`);
      // (what a press opens, a menu or a dialog: its buttons are pressed too, each by opening it first)
      const queue: (Pressable & { via?: Pressable })[] = [...list];
      const known = new Set(list.map((x) => x.sel));
      let kids = 0;
      let sinceOpen = 0;
      const retried = new Set<string>();
      for (let qi = 0; qi < queue.length; qi++) {
        const item = queue[qi];
        if (Date.now() - started > budget + 60_000) break;
        if (item.skip) continue;
        // A link inside Nova Agent: is the page there? (asked for, not followed)
        if (item.link && isPortalUrl(item.link) && !SAYS_PORTAL.test(item.says) && !isPortalUrl(p.path)) {
          results.push({ what: item.what, label: item.label, primary: item.primary, verdict: "goes-to-portal", why: "a link to Portal" });
          continue;
        }
        if (item.link) {
          const res = await ctx.request.get(item.link, { headers: { [SWEEP_HEADER]: "1" }, timeout: 15_000, maxRedirects: 5 }).catch(() => null);
          // (asking to sign in first isn't a missing page)
          if (res && (res.status() === 404 || res.status() === 410 || res.status() >= 500)) results.push({ what: item.what, label: item.label, primary: item.primary, verdict: "broken-link", why: `the page answers ${res.status()}` });
          continue;
        }
        // Fresh every 12 presses, or when the last press went somewhere
        if (sinceOpen >= 12 || frame.isDetached()) {
          frame = await openPanel(p.path).catch(() => null);
          if (!frame) break;
          await settle(frame);
          sinceOpen = 0;
        }
        const f = frame;
        // (gone from sight since the list was made, say another view was chosen: not pressed)
        if (!item.via && !(await f.locator(item.sel).first().isVisible().catch(() => false))) continue;
        const press = async (waits: number[]): Promise<PressSeen> => {
          // (inside a menu or dialog: it's opened first, the way a person gets there)
          if (item.via) {
            await f.locator(item.via.sel).first().click({ timeout: 1500 });
            await page.waitForTimeout(450);
          }
          const before = await state(f, item.sel);
          const hostBefore = f === page.mainFrame() ? null : await state(page.mainFrame(), null);
          const t0 = Date.now(), p0 = popups, d0 = downloads, e0 = pageErrors.length, pu0 = popupUrls.length;
          pressing = true;
          const frameUrl = f.isDetached() ? "" : f.url();
          await f.locator(item.sel).first().click({ timeout: 1500 }).catch((err) => {
            pressing = false;
            throw err;
          });
          let seen: PressSeen | null = null;
          for (const w of waits) {
            await page.waitForTimeout(w);
            const after = f.isDetached() ? null : await state(f, item.sel);
            const hostAfter = f === page.mainFrame() ? null : await state(page.mainFrame(), null);
            const went = !after || !before || after.token !== before.token || after.url !== before.url || (!f.isDetached() && f.url() !== frameUrl) || popups > p0 || (hostBefore && hostAfter ? hostAfter.token !== hostBefore.token || hostAfter.url !== hostBefore.url : false);
            const errs = [
              ...(after && before ? await f.evaluate(errorsSince, before.errors).catch(() => [] as string[]) : []),
              ...(hostBefore && hostAfter ? await page.evaluate(errorsSince, hostBefore.errors).catch(() => [] as string[]) : []),
              ...pageErrors.slice(e0),
            ];
            // (changes to what changed by itself while settling count too, when there are clearly more
            // of them than it makes by itself: a calendar redrawn for the next month)
            const allNow = after && before ? after.all - before.all : 0;
            const ownNow = (after && before ? after.muts - before.muts : 0) + (hostAfter && hostBefore ? hostAfter.muts - hostBefore.muts : 0);
            const attrsNow = (after && before ? after.attrs - before.attrs : 0) + (hostAfter && hostBefore ? hostAfter.attrs - hostBefore.attrs : 0);
            seen = {
              // (what the page says changed: the next month's name, a new list; counted as one change)
              changed: Math.max(0, ownNow - idle.changed) + Math.max(0, attrsNow - idle.attrs) || (allNow > Math.max(6, 4 * idleRate * (Date.now() - t0)) + idle.changed ? allNow - idle.changed : 0) || (after && before && after.words !== before.words ? 1 : 0) || (hostAfter && hostBefore && hostAfter.words !== hostBefore.words ? 1 : 0),
              requests: madeSince(t0, false),
              blocked: madeSince(t0, true),
              went: Boolean(went),
              dialogs: (after && before ? Math.max(0, after.dialogs - before.dialogs) : 0) + (hostAfter && hostBefore ? Math.max(0, hostAfter.dialogs - hostBefore.dialogs) : 0),
              state: Boolean(after && before && after.el !== before.el),
              focus: Boolean(after && before && after.focus !== before.focus && after.focus !== ""),
              // (a sound or a remembered choice counts only when a press on nothing doesn't make one too)
              calls: (["calls", ...(idle.sounds ? [] : ["sounds"]), ...(idle.stores ? [] : ["stores"])] as ("calls" | "sounds" | "stores")[]).reduce(
                (n, k) => n + (after && before ? after[k] - before[k] : 0) + (hostAfter && hostBefore ? hostAfter[k] - hostBefore[k] : 0),
                0,
              ),
              downloads: downloads - d0,
              errors: [...new Set(errs)],
              failed: failed.filter((x) => x.at >= t0).map((x) => x.text),
              said: [
                ...(after && before ? await f.evaluate(saidSince, before.bad).catch(() => [] as string[]) : []),
                ...(hostBefore && hostAfter ? await page.evaluate(saidSince, hostBefore.bad).catch(() => [] as string[]) : []),
              ],
              portal: Boolean(
                // (inside Portal itself, moving about Portal is fine)
                (hostAfter && hostBefore && hostAfter.viewing !== hostBefore.viewing && isPortalUrl(hostAfter.viewing) && !isPortalUrl(hostBefore.viewing)) ||
                  (after && before && after.url !== before.url && isPortalUrl(after.url) && !isPortalUrl(before.url)) ||
                  (f === page.mainFrame() && after && before && after.viewing !== before.viewing && isPortalUrl(after.viewing) && !isPortalUrl(before.viewing)) ||
                  (after && before ? after.opened.slice(before.opened.length) : []).concat(hostAfter && hostBefore ? hostAfter.opened.slice(hostBefore.opened.length) : []).some(isPortalUrl) ||
                  popupUrls.slice(pu0).some(isPortalUrl) ||
                  (!f.isDetached() && f.url() !== frameUrl && isPortalUrl(f.url()) && !isPortalUrl(frameUrl)),
              ),
            };
            if (judgePress(seen, item.says).verdict !== "does-nothing") break;
          }
          pressing = false;
          return seen!;
        };
        let verdict: Verdict | "broken-link" = "works";
        let why = "";
        try {
          let seen = await press([450, 900]);
          let j = judgePress(seen, item.says);
          // Nothing? Pressed once more, and given longer
          if (j.verdict === "does-nothing") {
            if (item.via) {
              await f.evaluate(tidyUp).catch(() => {});
              await page.waitForTimeout(300);
            }
            seen = await press([1500]);
            j = judgePress(seen, item.says);
          }
          // (it took Nova Agent to Portal: back to this panel for the next press)
          if (seen.portal) sinceOpen = 99;
          verdict = j.verdict;
          why = j.why;
          // (the tab or choice already chosen: nothing to do is right)
          if (verdict === "does-nothing" && item.chosen) {
            verdict = "works";
            why = "already the one chosen";
          }
          // (a form not filled in yet: the browser itself points out what's missing)
          if (verdict === "does-nothing" && item.submits && (await f.evaluate((sel) => !!(document.querySelector(sel) as HTMLButtonElement | null)?.form?.querySelector(":invalid"), item.sel).catch(() => false))) {
            verdict = "works";
            why = "the form asks for what's missing";
          }
          if (process.env.BUTTONS_DEBUG) log(`    seen ${JSON.stringify(seen)} idle ${JSON.stringify(idle)}`);
          if (seen.went) sinceOpen = 99;
          // It opened something (a menu, a dialog, a fold): what's in it is pressed next
          else if (!item.via && j.verdict === "works" && (seen.dialogs || seen.state) && kids < 20) {
            const inside: Pressable[] = await f.evaluate(listPressables, { max: 80, host, inDialog: seen.dialogs > 0 }).catch(() => []);
            const fresh = inside.filter((x) => !known.has(x.sel) && !x.skip).slice(0, 8);
            for (const x of fresh) {
              known.add(x.sel);
              if (kids++ >= 20) break;
              queue.push({ ...x, what: `${x.what} (in ${item.label})`, via: item });
            }
          }
        } catch (err) {
          const m = String((err as Error).message || err);
          // (something lies over it: a finger can't reach it either; or it's gone from the page by now)
          // (a dialog this check didn't open, a welcome on a first visit, in the way: closed, and pressed again)
          if (/<dialog[^>]*>[^\n]{0,80}\bintercepts pointer events/i.test(m) && !item.via && !retried.has(item.sel)) {
            retried.add(item.sel);
            await f.evaluate(tidyUp).catch(() => {});
            qi--;
            continue;
          }
          if (/intercepts pointer events/.test(m)) {
            verdict = "does-nothing";
            const over = (m.match(/(<[a-z][^>]{0,120}>)[^\n]{0,80}\bintercepts pointer events/i) || [])[1] || "";
            why = `something lies over it${over ? `: ${over.replace(/\s+/g, " ").slice(0, 100)}` : ""}`;
          } else {
            if (process.env.BUTTONS_DEBUG) log(`    couldn't press ${item.what}: ${m.split("\n")[0].slice(0, 160)}`);
            sinceOpen = 99;
            continue;
          }
        }
        sinceOpen++;
        results.push({ what: item.what, label: item.label, primary: item.primary, verdict, why });
        log(`  ${p.name} · ${item.what}: ${verdict}${why ? ` (${why})` : ""}`);
        // Tidy up: Escape, anything it opened closed
        if (!frame.isDetached()) {
          await frame.evaluate(tidyUp).catch(() => {});
          // (Nova Agent's own dialogs a panel's press opened: closed, without its Escape)
          if (frame !== page.mainFrame()) await page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close())).catch(() => {});
        }
      }
      const pressed = results.length;
      const problems = buttonsProblems(results, p.name);
      out.push({ name: p.name, path: p.path, width, height, signedIn, ms: 0, problems, shot: "", pressed, results });
      log(`${p.name} ${width}×${height} ${signedIn ? "signed in" : "signed out"}: ${pressed} pressed, ${problems.length ? problems.map((x) => x.text).join("; ") : "all worked"}`);
    }
    await ctx.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }
  return { screens: out, total };
}
