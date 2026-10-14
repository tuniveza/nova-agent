// Android phones and tablets: Nova Agent's home and every panel inside it, the way Chrome on
// Android shows them (its screen sizes, pixel density, touch, Android's user agent), signed in and
// signed out, and with Android's bigger text (Chrome on Android turns the system's font size into
// page zoom: 130% = the page laid out on a screen 1.3× smaller). Besides the Fixer's looks rules
// (src/fixer/looks.ts: gaps, blank panels, covered or scrolling pages, things off the screen, text
// cut off) it finds what makes a phone or tablet awkward: buttons too small for a finger, text too
// small to read, text boxes under 16px, sideways scrolling, and pull-to-refresh firing on the page.
//
//   scripts/check-android.sh                       (a throwaway Nova Agent, every device, then stops it)
//   npx tsx scripts/check-android.ts http://localhost:4721 [--devices s23,tab-p] [--zoom 1,1.3]
//     [--panels /portal/,/notes/] [--auth in|out|both] [--shots folder] [--sheet] [--json out.json]
//     [--strict]   (fail on small buttons and small text too, not only on what's broken)
// Exit 1 when something is broken (or, with --strict, awkward).
import { mkdirSync, writeFileSync } from "node:fs";
import { calendarItems } from "./check-android-seed";
import { ANDROID_DEVICES } from "./check-android-devices";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page, type Frame } from "playwright";
import { HOME, LOOKS_PANELS, NAME_SHIM, judgeContent, judgeFrame, judgeHost, measureContent, measureFrame, measureHost, type FrameMeasure, type LooksProblem } from "../src/fixer/looks";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const BASE = (args.find((a) => /^https?:\/\//.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const SHOTS = opt("shots");
const SHEET = args.includes("--sheet");
const STRICT = args.includes("--strict");

const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const ANDROID = ANDROID_DEVICES;
type DeviceId = keyof typeof ANDROID;
const DEVICES = (opt("devices") ? opt("devices").split(",") : Object.keys(ANDROID)) as DeviceId[];
const ZOOMS = opt("zoom") ? opt("zoom").split(",").map(Number) : [1, 1.3];
const AUTH = opt("auth") || "both";
const ONLY = opt("panels") ? opt("panels").split(",") : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- What's awkward on a touch screen (runs inside each page) ----
export interface TouchMeasure {
  smallTaps: string[]; // buttons and links under 40px either way (48dp is the aim; 40 is the floor)
  smallTapCount: number;
  smallText: string[]; // words under 11px
  smallTextCount: number;
  smallInputs: string[]; // text boxes under 16px (Chrome zooms in on them)
  sideways: boolean; // the page itself scrolls sideways
}
export function measureTouch(): TouchMeasure {
  const W = innerWidth, H = innerHeight;
  const shown = (el: Element) => {
    const s = getComputedStyle(el);
    return !(s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) && !el.closest("[hidden], [inert], dialog:not([open])");
  };
  const name = (el: Element) => {
    const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${label ? ` “${label}”` : ""}`;
  };
  const onScreen = (r: DOMRect) => r.width >= 2 && r.height >= 2 && r.right > 0 && r.left < W && r.bottom > 0 && r.top < H;
  const smallTaps: string[] = [];
  let smallTapCount = 0;
  const seen = new Set<Element>();
  for (const el of document.querySelectorAll("button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], summary, select, input[type=checkbox], input[type=radio]")) {
    if (!shown(el) || el.closest("[data-pan]")) continue; // (a canvas you drag and zoom: its size is the zoom's)
    // A link inside a sentence is read, not aimed at
    if (el.tagName === "A" && el.closest("p, li, td") && !el.closest("nav, [role=tablist], menu")) continue;
    // A box inside a bigger tap area (a label, a button) is that area's
    const host = el.closest("label") || el.parentElement?.closest("button, a[href], [role=button]");
    const target = host && host !== el ? host : el;
    if (seen.has(target)) continue;
    seen.add(target);
    const r = target.getBoundingClientRect();
    if (!onScreen(r)) continue;
    if (Math.min(r.width, r.height) < 40) {
      smallTapCount++;
      if (smallTaps.length < 6) smallTaps.push(`${name(target)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  const smallText: string[] = [];
  let smallTextCount = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const done = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || done.has(p) || p.closest("[data-pan]") || (n.textContent || "").trim().length < 3 || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) continue;
    done.add(p);
    if (!shown(p)) continue;
    const r = p.getBoundingClientRect();
    if (!onScreen(r)) continue;
    const cs = getComputedStyle(p);
    if (cs.clip !== "auto" || r.width <= 2) continue; // words for screen readers only
    const px = parseFloat(cs.fontSize);
    if (px < 11) {
      smallTextCount++;
      if (smallText.length < 6) smallText.push(`${name(p)} ${px}px`);
    }
  }
  const smallInputs: string[] = [];
  for (const el of document.querySelectorAll("input:not([type]), input[type=text], input[type=search], input[type=email], input[type=password], input[type=url], input[type=tel], input[type=number], input[type=date], input[type=time], input[type=datetime-local], textarea, select")) {
    if (!shown(el) || !onScreen(el.getBoundingClientRect())) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 16 && smallInputs.length < 6) smallInputs.push(`${name(el)} ${px}px`);
  }
  const se = document.scrollingElement || document.documentElement;
  const sideways = se.scrollWidth > W + 1 && !/hidden|clip/.test(getComputedStyle(document.documentElement).overflowX) && !/hidden|clip/.test(getComputedStyle(document.body).overflowX);
  return { smallTaps, smallTapCount, smallText, smallTextCount, smallInputs, sideways };
}
// Nova Agent's own page: pull-to-refresh, the keyboard and the viewport
export function measureAndroidHost() {
  const html = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
  const vp = document.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
  return {
    pullToRefresh: !/none|contain/.test(html.overscrollBehaviorY) && !/none|contain/.test(body.overscrollBehaviorY),
    keyboardResizes: /interactive-widget\s*=\s*resizes-content/.test(vp),
    themeColor: !!document.querySelector('meta[name="theme-color"]'),
  };
}
const touchProblems = (t: TouchMeasure): LooksProblem[] => {
  const out: LooksProblem[] = [];
  if (t.sideways) out.push({ kind: "offscreen", severity: "minor", text: "The page scrolls sideways" });
  if (t.smallInputs.length) out.push({ kind: "text-cut", severity: "minor", text: `Typing boxes under 16px: ${t.smallInputs.join(", ")}` });
  return out;
};

// ---- Run ----
interface Screen { device: string; size: string; zoom: number; signedIn: boolean; panel: string; broken: LooksProblem[]; touch: TouchMeasure | null; shot: string }
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "home";

async function context(dev: (typeof ANDROID)[DeviceId], zoom: number, signedIn: boolean): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: Math.round(dev.w / zoom), height: Math.round(dev.h / zoom) },
    screen: { width: Math.round(dev.w / zoom), height: Math.round(dev.h / zoom) },
    deviceScaleFactor: dev.dpr * zoom, isMobile: true, hasTouch: true, userAgent: dev.tablet ? TABLET_UA : PHONE_UA, serviceWorkers: "block",
  });
  await ctx.addInitScript({ content: NAME_SHIM });
  await ctx.routeWebSocket(/.*/, (ws) => void ws.close());
  await ctx.route(/\/app\/api\/calendar\/items/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(r.request().method() === "GET" ? calendarItems() : {}) }));
  if (signedIn) {
    const { portalMock } = (await import("./check-fit-portal-samples.mjs" as string)) as { portalMock: (p: string, m: string) => unknown };
    await ctx.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith("/app/memory")) return r.fallback();
      const body = portalMock(u.pathname + u.search, r.request().method());
      return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
    });
  }
  return ctx;
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--mute-audio"] });
const screens: Screen[] = [];
const auths = AUTH === "both" ? [false, true] : [AUTH === "in"];
for (const id of DEVICES) {
  const dev = ANDROID[id];
  if (!dev) throw new Error(`No device "${id}" (${Object.keys(ANDROID).join(", ")})`);
  // Bigger text on the phones and tablets people hold upright (sideways is already the tightest)
  for (const zoom of ZOOMS.filter((z) => z === 1 || id !== "land")) {
    for (const signedIn of auths) {
      const ctx = await context(dev, zoom, signedIn);
      const page: Page = await ctx.newPage();
      const size = `${Math.round(dev.w / zoom)}×${Math.round(dev.h / zoom)}`;
      const at = { device: dev.name, size, zoom, signedIn };
      const shoot = async (panel: string) => {
        if (!SHOTS) return "";
        const file = `${id}-${zoom === 1 ? "" : `z${Math.round(zoom * 100)}-`}${signedIn ? "in" : "out"}-${slug(panel)}.png`;
        await page.screenshot({ path: join(SHOTS, file) }).catch(() => {});
        return file;
      };
      try {
        await page.goto(`${BASE}/agent/`, { waitUntil: "load", timeout: 45_000 });
        await page.waitForTimeout(1800);
        const extra = await page.evaluate(measureAndroidHost);
        const broken: LooksProblem[] = [...judgeHost(await page.evaluate(measureHost), 0)];
        const main = await page.evaluate(measureContent, ".main").catch(() => null);
        if (main) broken.push(...judgeContent(main, "home"));
        if (extra.pullToRefresh) broken.push({ kind: "page-scrolls", severity: "minor", text: "Pulling down on Nova Agent reloads the page (pull-to-refresh is on)" });
        if (!extra.keyboardResizes) broken.push({ kind: "covered", severity: "minor", text: "The keyboard covers the page instead of making room (viewport: interactive-widget=resizes-content)" });
        const touch = await page.evaluate(measureTouch);
        broken.push(...touchProblems(touch));
        // Back (the system's gesture or button) closes a window first, then an open panel, and never leaves Nova Agent
        if (zoom === 1) {
          const backBad: string[] = [];
          const opened = await page.evaluate(() => { const d = document.querySelector("dialog#suite-dlg, dialog.suite-dlg, dialog.more-sheet") as HTMLDialogElement | null; if (!d) return false; d.showModal(); return true; });
          if (opened) {
            await page.goBack().catch(() => {});
            await page.waitForTimeout(400);
            if (await page.evaluate(() => !!document.querySelector("dialog[open]"))) backBad.push("Back didn't close the open window");
          }
          await page.evaluate(() => (window as any).NovaAgent?.open("/notes/"));
          await page.waitForTimeout(1200);
          await page.goBack().catch(() => {});
          await page.waitForTimeout(600);
          if (!new URL(page.url()).pathname.startsWith("/agent")) backBad.push(`Back left Nova Agent (${page.url()})`);
          else if (await page.evaluate(() => !!document.querySelector(".main.viewing"))) backBad.push("Back didn't close the open panel");
          if (!new URL(page.url()).pathname.startsWith("/agent")) await page.goto(`${BASE}/agent/`, { waitUntil: "load" });
          for (const b of backBad) broken.push({ kind: "open", severity: "serious", text: b });
          await page.waitForTimeout(400);
        }
        screens.push({ ...at, panel: "Home", broken, touch, shot: await shoot("home") });
        const listed: { name: string; path: string }[] = await page.evaluate(() => [...document.querySelectorAll("#suite-home a.suite-app[data-inside]")].map((a) => ({ name: (a.querySelector("b")?.textContent || "").trim(), path: a.getAttribute("data-inside") || "" }))).catch(() => []);
        const panels = (listed.filter((p) => p.name && p.path).length ? listed.filter((p) => p.name && p.path) : LOOKS_PANELS).filter((p) => !ONLY || ONLY.includes(p.path));
        for (const p of panels) {
          let problems: LooksProblem[] = [];
          let t: TouchMeasure | null = null;
          try {
            const opened = await page.evaluate((path) => !!(window as any).NovaAgent?.open(path), p.path);
            if (!opened) throw new Error("didn't open");
            const handle = await page.waitForSelector(".main.viewing .viewer iframe:not([hidden])", { timeout: 20_000 });
            const frame = (await handle.contentFrame()) as Frame;
            await frame.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
            await page.waitForTimeout(1400);
            const inside: FrameMeasure = { ...(await frame.evaluate(measureContent, null)), ...(await frame.evaluate(measureFrame)) };
            problems = [...judgeHost(await page.evaluate(measureHost), inside.titleBars), ...judgeFrame(inside)];
            t = await frame.evaluate(measureTouch);
            if (process.env.ANDROID_DEBUG && problems.some((x) => x.kind === "cut-off")) console.log("   debug:", JSON.stringify(await frame.evaluate(() => { const H = innerHeight; const b = document.body; const m = document.querySelector("main"); const out = [`H=${H} body ${b.scrollHeight}/${b.clientHeight} ${getComputedStyle(b).overflowY}`, m ? `main ${m.scrollHeight}/${m.clientHeight} ${getComputedStyle(m).overflowY}` : "no main"]; for (const el of [...b.children, ...(m ? m.children : [])]) { const r = el.getBoundingClientRect(); if (r.bottom > H + 2 && r.height > 2) out.push(`${el.tagName}.${[...el.classList].join(".")}#${el.id} ${Math.round(r.top)}+${Math.round(r.height)} sh=${el.scrollHeight} ${getComputedStyle(el).overflowY} ${getComputedStyle(el).position}`); } return out; })));
            problems.push(...touchProblems(t));
          } catch (err) {
            problems.push({ kind: "open", severity: "serious", text: `Couldn't open (${String((err as Error).message).split("\n")[0].slice(0, 120)})` });
          }
          screens.push({ ...at, panel: p.name, broken: problems, touch: t, shot: await shoot(p.name) });
        }
      } catch (err) {
        screens.push({ ...at, panel: "Home", broken: [{ kind: "open", severity: "serious", text: `Nova Agent didn't open (${String((err as Error).message).split("\n")[0]})` }], touch: null, shot: "" });
      }
      for (const s of screens.filter((s) => s.device === dev.name && s.zoom === zoom && s.signedIn === signedIn)) {
        const awkward = s.touch ? [s.touch.smallTapCount && `${s.touch.smallTapCount} small buttons`, s.touch.smallTextCount && `${s.touch.smallTextCount} bits of tiny text`].filter(Boolean) : [];
        console.log(`${s.broken.length ? "✗" : awkward.length ? "·" : "✓"} ${s.device} ${s.size}${zoom === 1 ? "" : ` text ${Math.round(zoom * 100)}%`} ${signedIn ? "in" : "out"} · ${s.panel}${s.broken.length ? ": " + s.broken.map((b) => b.text).join("; ") : ""}${awkward.length ? ` (${awkward.join(", ")})` : ""}`);
      }
      await ctx.close();
    }
  }
}

// One contact sheet per device: every panel side by side, so the whole suite can be seen at a glance
if (SHOTS && SHEET) {
  const page = await (await browser.newContext({ viewport: { width: 1800, height: 1000 } })).newPage();
  const groups = new Map<string, Screen[]>();
  for (const s of screens) if (s.shot) groups.set(s.shot.replace(/-[^-]+\.png$/, ""), [...(groups.get(s.shot.replace(/-[^-]+\.png$/, "")) || []), s]);
  for (const [key, list] of groups) {
    const { readFileSync } = await import("node:fs");
    const cells = list.map((s) => `<figure><img src="data:image/png;base64,${readFileSync(join(SHOTS, s.shot)).toString("base64")}"><figcaption>${s.panel}${s.broken.length ? " ✗" : ""}</figcaption></figure>`).join("");
    const tall = list[0] && !/land|tab-l/.test(key);
    await page.setContent(`<style>body{margin:0;background:#111;font:14px system-ui;color:#eee;padding:10px}h1{font-size:16px;margin:0 0 8px}.g{display:grid;grid-template-columns:repeat(${tall ? 6 : 4},1fr);gap:10px}figure{margin:0}img{width:100%;display:block;border-radius:6px}figcaption{text-align:center;padding:3px}</style><h1>${key}</h1><div class="g">${cells}</div>`);
    await page.screenshot({ path: join(SHOTS, `sheet-${key}.png`), fullPage: true });
  }
}
await browser.close();

if (opt("json")) writeFileSync(opt("json"), JSON.stringify(screens, null, 2));
const broken = screens.filter((s) => s.broken.length);
const awkward = screens.filter((s) => s.touch && (s.touch.smallTapCount || s.touch.smallTextCount));
console.log(`\n${screens.length} screens: ${broken.length} with something broken, ${awkward.length} with small buttons or tiny text`);
process.exit(broken.length || (STRICT && awkward.length) ? 1 : 0);
