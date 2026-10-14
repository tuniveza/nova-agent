// The sweep: every panel, at phone width (390) and desktop width (1280), in headless Chromium,
// against a running Nova Agent server. Each panel opens the way it does inside Nova Agent (in a
// frame filling the window), and the sweep notes:
//   - script errors on the page
//   - console errors (except the expected 401s and 404s of signed-out API calls)
//   - the panel's own files (scripts, styles, images, fonts) that didn't load
//   - the page scrolling sideways
//   - buttons, links and boxes partly off the screen
// It can also take a screenshot of each one (the Fixer's before/after pictures).
//
// The same problem in several places (a file that didn't load on three panels, the same script
// error at both widths) comes back as ONE finding saying where it was seen (rules.ts groupFindings).
// A file that failed because the server behind it didn't answer (502/503/504, a dropped connection)
// is marked as a blip: the Fixer checks it again before it counts.
// The sweep only looks: every request to Nova Agent carries SWEEP_HEADER, and the server turns away
// anything that would change something (sweep-guard.ts), so a sweep can't make notes, calendar
// items, quests or anything else.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "./rules";
import { blipError, blipStatus, fingerprint, groupFindings, SCREENS } from "./rules";
import { SWEEP_HEADER } from "./sweep-guard";

export const WIDTHS = [390, 1280] as const;
const HEIGHT: Record<number, number> = { 390: 844, 1280: 800 };
const FRAME = (src: string) =>
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#05030c}iframe{border:0;width:100%;height:100%;display:block}</style><iframe src="${src.replace(/"/g, "&quot;")}"></iframe>`;
const ASSETS = new Set(["script", "stylesheet", "image", "font", "media"]);

export interface Shot {
  name: string;
  path: string;
  width: number;
  file: string; // the file name in the shots folder
}
export interface SweepOptions {
  screens?: { name: string; path: string }[];
  widths?: readonly number[];
  shotsDir?: string; // take screenshots into here
  prefix?: string; // "before" / "after"
  settleMs?: number;
}
export type Sweep = (base: string, opts?: SweepOptions) => Promise<{ findings: Finding[]; shots: Shot[] }>;

// Run inside the panel's frame: sideways scrolling, and things hanging off the screen
function inspect() {
  const out: { kind: string; text: string }[] = [];
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > innerWidth + 2) out.push({ kind: "sideways", text: `The page scrolls sideways (${se.scrollWidth}px wide on a ${innerWidth}px screen)` });
  const name = (el: Element) => {
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${label ? ` “${label}”` : ""}`;
  };
  // Inside a box that scrolls sideways on purpose (a table, a strip of chips): not off the screen
  const scrollsInside = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const off: string[] = [];
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=tab]")) {
    if (off.length >= 3) break;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) continue;
    if ((el as HTMLElement).closest("[hidden], [aria-hidden=true], [inert], dialog:not([open])")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // Wholly off to one side: a drawer tucked away until it's opened
    if (r.right <= 0 || r.left >= innerWidth) continue;
    if ((r.left < -2 || r.right > innerWidth + 2) && !scrollsInside(el)) off.push(name(el));
  }
  if (off.length) out.push({ kind: "offscreen", text: `Partly off the screen: ${off.join(", ")}` });
  return out;
}

export const sweep: Sweep = async (base, opts = {}) => {
  const { chromium } = await import("playwright");
  const origin = new URL(base).origin;
  const screens = opts.screens || SCREENS;
  const widths = opts.widths || WIDTHS;
  const findings: Finding[] = [];
  const shots: Shot[] = [];
  if (opts.shotsDir) mkdirSync(opts.shotsDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const screen of screens) {
      for (const width of widths) {
        const where = `${screen.name} at ${width}px`;
        // Problems that aren't about this page's layout (a file, a script or console error) are the
        // same problem wherever they're seen: one fingerprint for all the places
        const SHARED = new Set(["asset", "pageerror", "console"]);
        const add = (kind: string, severity: Finding["severity"], title: string, detail = "", blip = false) => {
          const own = fingerprint("sweep", screen.path, String(width), kind, title);
          findings.push({
            fingerprint: SHARED.has(kind) ? fingerprint("sweep", kind, title) : own,
            area: "sweep",
            severity,
            title: `${where}: ${title}`,
            detail,
            panel: screen.path,
            panels: [screen.path],
            place: where,
            problem: title,
            aliases: SHARED.has(kind) ? [own] : [],
            ...(blip ? { blip: true } : {}),
          });
        };
        const ctx = await browser.newContext({ viewport: { width, height: HEIGHT[width] || 800 }, isMobile: width < 800, hasTouch: width < 800, deviceScaleFactor: 1 });
        try {
          // Every request to Nova Agent says it's the sweep (and only those: other sites never see it)
          await ctx.route(`${origin}/**`, (route) => route.continue({ headers: { ...route.request().headers(), [SWEEP_HEADER]: "1" } }));
          // (Run with tsx, inspect() carries esbuild's __name helper: without one in the page it threw,
          // and the layout checks below quietly found nothing)
          await ctx.addInitScript({ content: "self.__name = self.__name || ((f) => f);" });
          await ctx.route(`${origin}/__fixer__/frame*`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: FRAME(screen.path) }));
          const page = await ctx.newPage();
          page.on("pageerror", (err) => add("pageerror", "serious", `script error: ${String(err.message || err).split("\n")[0].slice(0, 200)}`, String(err.stack || "").slice(0, 2000), blipError(String(err.message || err))));
          page.on("console", (msg) => {
            if (msg.type() !== "error") return;
            const t = msg.text();
            // Signed-out API calls answer 401 or 404: expected. Failed files are caught below.
            if (/status of 40[14]\b/.test(t) || /^Failed to load resource/.test(t)) return;
            if (/fonts\.(googleapis|gstatic)\.com/.test(t)) return;
            // (a panel saying it couldn't save because the sweep only looks: expected)
            if (/never changes anything|fixerSweep/.test(t)) return;
            add("console", "minor", `console error: ${t.split("\n")[0].slice(0, 200)}`, "", blipError(t));
          });
          page.on("response", (res) => {
            const req = res.request();
            // (401: a signed-out picture or file, expected; a 404 or a 500 is a real problem)
            if (!res.url().startsWith(origin) || res.url().includes("/__fixer__/") || !ASSETS.has(req.resourceType()) || res.status() < 400 || res.status() === 401) return;
            add("asset", "serious", `a file didn't load: ${new URL(res.url()).pathname} (${res.status()})`, "", blipStatus(res.status()));
          });
          page.on("requestfailed", (req) => {
            if (!req.url().startsWith(origin) || !ASSETS.has(req.resourceType())) return;
            const why = req.failure()?.errorText || "";
            if (/ERR_ABORTED/.test(why)) return;
            add("asset", "serious", `a file didn't load: ${new URL(req.url()).pathname} (${why})`, "", blipError(why));
          });
          await page.goto(`${origin}/__fixer__/frame`, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const frame = page.frames().find((f) => f !== page.mainFrame());
          if (!frame) {
            add("open", "serious", "didn't open");
            continue;
          }
          await frame.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => add("open", "serious", "didn't open within 30 seconds"));
          await frame.waitForLoadState("load", { timeout: 20_000 }).catch(() => add("slow", "minor", "still loading after 20 seconds"));
          await page.waitForTimeout(opts.settleMs ?? 1500);
          for (const p of await frame.evaluate(inspect).catch(() => [] as { kind: string; text: string }[])) add(p.kind, "minor", p.text);
          if (opts.shotsDir) {
            const file = `${opts.prefix || "shot"}-${screen.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}-${width}.png`;
            await page.screenshot({ path: join(opts.shotsDir, file) }).then(
              () => shots.push({ name: screen.name, path: screen.path, width, file }),
              () => {},
            );
          }
        } catch (err) {
          add("open", "serious", `couldn't be opened (${(err as Error).message.split("\n")[0].slice(0, 160)})`);
        } finally {
          await ctx.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { findings: groupFindings(findings), shots };
};
