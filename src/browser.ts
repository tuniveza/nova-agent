// Starting and stopping the browser, remembering the Acuity login between
// runs, and the few basic actions tasks use (go to, click, type).
//
// Task code should use goTo/click/typeInto below rather than calling
// Playwright directly: they add a short pause and report every
// action to the trace, so the visualizer can show it.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { config } from "./config";
import { trace, traceScreenshot } from "./trace";

export interface OpenBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

// Launch Chromium and, if we have one, load the saved login session.
// `readOnly: true` switches on the change-blocking safety net even when
// DRY_RUN is off (the daily healthcheck uses this).
export async function openBrowser(options: { readOnly?: boolean } = {}): Promise<OpenBrowser> {
  trace("browser", "start", `Starting Chromium (${config.headless ? "hidden" : "visible window"})`);
  const browser = await chromium.launch({ headless: config.headless });

  const hasSavedSession = existsSync(config.paths.session);
  const context = await browser.newContext({
    storageState: hasSavedSession ? config.paths.session : undefined,
    viewport: { width: 1366, height: 900 },
  });
  trace("browser", "info", hasSavedSession ? "Loaded saved login session" : "No saved session yet");

  if (config.dryRun || options.readOnly) await blockChangesToAcuity(context);

  const page = await context.newPage();
  return { browser, context, page };
}

// --- dry-run safety net ---
//
// The main dry-run safety is finalClick() below: it stops before the one
// click that changes something. This is a second line of defence: in dry-run
// mode the browser itself refuses to send any request that would change
// something in Acuity, even if a click slipped through.
//
// Careful: Acuity's cancel is a plain GET request, so "block everything
// except GET" is not enough. Every change-making form carries Acuity's
// __csrf_magic token, so we block anything carrying that as well.

// POST requests Acuity uses only to *fetch* data (available times etc.).
const READ_ONLY_POSTS = /[?&]action=(showCalendar|showTimes|availableTimes|getApptTypesForCalendar|getForms|autoJsonClient|checkConflict)\b/;

function looksLikeAChange(method: string, url: string, body: string): boolean {
  if (url.includes("__csrf_magic") || body.includes("__csrf_magic")) return true;
  if (/[?&]action=(cancel|insert|update\w*|delete\w*)\b/i.test(url)) return true;
  if (method === "GET" || method === "HEAD") return false;
  if (/login/i.test(url)) return false; // logging in is allowed
  return !READ_ONLY_POSTS.test(url);
}

async function blockChangesToAcuity(context: BrowserContext): Promise<void> {
  await context.route(/acuityscheduling\.com/, (route) => {
    const request = route.request();
    if (looksLikeAChange(request.method(), request.url(), request.postData() ?? "")) {
      const url = new URL(request.url());
      const action = url.searchParams.get("action");
      const what = `${request.method()} ${url.pathname}${action ? ` action=${action}` : ""}`;
      trace("browser", "warn", `Dry run: blocked a request that could change something (${what})`);
      return route.abort();
    }
    return route.continue();
  });
}

// Save cookies + local storage so the next run starts already logged in.
// The file is effectively a password, so only our own user may read it,
// and we never print its contents.
export async function saveSession(context: BrowserContext): Promise<void> {
  mkdirSync(config.paths.dataDir, { recursive: true });
  const state = await context.storageState();
  writeFileSync(config.paths.session, JSON.stringify(state, null, 2), { mode: 0o600 });
  trace("browser", "info", "Saved login session");
}

// --- basic actions ---

export async function goTo(page: Page, url: string): Promise<void> {
  trace("browser", "info", `Opening ${url}`);
  await page.goto(url, { waitUntil: "load" });
  await traceScreenshot(page, `Opened ${new URL(page.url()).pathname}`);
}

export async function click(page: Page, element: Locator, what: string): Promise<void> {
  await humanPause();
  trace("browser", "info", `Clicking ${what}`);
  await element.click();
  await page.waitForLoadState("load");
  await traceScreenshot(page, `After clicking ${what}`);
}

// `secret: true` keeps the typed text out of the trace and logs.
export async function typeInto(
  page: Page,
  element: Locator,
  text: string,
  what: string,
  options: { secret?: boolean } = {},
): Promise<void> {
  await humanPause();
  const shown = options.secret ? "(hidden)" : `"${text}"`;
  trace("browser", "info", `Typing ${shown} into ${what}`);
  await element.fill(text);
  await traceScreenshot(page, `Typed into ${what}`);
}

export async function setCheckbox(page: Page, box: Locator, checked: boolean, what: string): Promise<void> {
  await humanPause();
  trace("browser", "info", `${checked ? "Ticking" : "Unticking"} "${what}"`);
  await box.setChecked(checked);
  await traceScreenshot(page, `"${what}" ${checked ? "ticked" : "unticked"}`, box);
}

// The ONE place the agent makes a change (book / cancel / save / reschedule).
// In dry-run mode it stops here, takes a screenshot with the button
// outlined, and returns false. Returns true when the click really happened.
export async function finalClick(page: Page, button: Locator, whatItDoes: string): Promise<boolean> {
  if (!(await button.isEnabled())) {
    await traceScreenshot(page, `The final button is greyed out (${whatItDoes})`, button);
    throw new Error(`The final button is greyed out, so something required is missing (${whatItDoes})`);
  }

  if (config.dryRun) {
    await traceScreenshot(page, `DRY RUN: this is the button that would ${whatItDoes}`, button);
    trace("task", "warn", `Dry run: stopped before the final click (${whatItDoes}). Nothing was changed.`);
    return false;
  }

  await click(page, button, `the final button to ${whatItDoes}`);
  return true;
}

// A short random wait between actions (ACTION_PAUSE_MS, 150 ms at most by
// default), so pages have a moment to react without slowing bookings down.
export function humanPause(): Promise<void> {
  const ms = config.actionPauseMs * (1 + 2 * Math.random()) / 3;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
