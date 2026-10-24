// Nova Phone on one engine, one phone profile (scripts/phone-check.ts; scripts/deploy-check.ts runs it in one
// long-lived browser per engine): every screen, its first rows, a note card and a message (writes caught).
import { join } from "node:path";
import { devices, type Browser, type Page, type BrowserContext } from "playwright";
import { measureStrict } from "../../src/fixer/strict";
import { measureUsable } from "../usable";
import { base, session, cookieOf } from "./looks";
import { routeLocal } from "./serve";
import { waitReady, shot, INIT_WATCH } from "./page";
import type { Opts } from "./forms-check";
export type Fail = (where: string, what: string) => void;

// The phones (upright and sideways) and upright tablets each engine stands for (ns CLAUDE.md 2c.6: Nova Phone's screens)
const FIREFOX_TABLET_UA = "Mozilla/5.0 (Android 14; Tablet; rv:131.0) Gecko/131.0 Firefox/131.0";
const FIREFOX_UA = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
export const PROFILES: Record<string, [string, any][]> = {
  webkit: [["iPhone SE", devices["iPhone SE (3rd gen)"]], ["iPhone 15", devices["iPhone 15"]], ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]], ["iPhone 15 sideways", devices["iPhone 15 landscape"]], ["iPad Mini", devices["iPad Mini"]]],
  chromium: [["Pixel 10", devices["Pixel 10"] || devices["Pixel 7"]], ["Galaxy S24", devices["Galaxy S24"] || devices["Galaxy S9+"]], ["Pixel 10 sideways", devices["Pixel 10 landscape"] || devices["Pixel 7 landscape"]], ["Galaxy Tab S9", devices["Galaxy Tab S9"]]],
  firefox: [["Firefox Android", { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, hasTouch: true, userAgent: FIREFOX_UA }], ["Firefox Android sideways", { viewport: { width: 839, height: 412 }, deviceScaleFactor: 2.625, hasTouch: true, userAgent: FIREFOX_UA }], ["Firefox Android tablet", { viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, hasTouch: true, userAgent: FIREFOX_TABLET_UA }]],
};
// Every write: noted and answered as Nova Bot would (the looks account may only look)
async function catchWrites(ctx: BrowserContext, writes: any[]) {
  await ctx.route(() => true, async (route) => {
    const r = route.request();
    if (["GET", "HEAD", "OPTIONS"].includes(r.method())) return route.fallback();
    const u = new URL(r.url());
    let body: any = null;
    try { body = r.postData() ? JSON.parse(r.postData()!) : null; } catch (e) { body = r.postData(); }
    writes.push({ method: r.method(), path: u.pathname, body, origin: r.headers()["origin"] });
    let res: any = { ok: true };
    if (u.pathname.startsWith("/app/api/calendar/items/") && r.method() === "PUT") res = { ok: true, item: { ...body, base: undefined }, rev: 999999 };
    if (u.pathname.startsWith("/notes-api/notes/")) res = { note: { ...body, id: decodeURIComponent(u.pathname.split("/").pop()!), rev: 1, by: "check" } };
    if (u.pathname === "/actions/chat") res = { ok: true, reply: "A reply from the check (nothing was sent).", actions: [] };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
  });
}
// Answers the server is meant to give, each with its reason (ns CLAUDE.md 2f: only these, never a whole kind)
const KNOWN: [RegExp, number, string][] = [
  [/\/admin\/test-booking\/acuity\/state$/, 502, "Acuity's API refuses this account (not on its Powerhouse plan); the screen says so in words"],
];
const known = (m: any) => { const u = m.location()?.url || ""; return KNOWN.some(([re, code]) => re.test(u) && m.text().includes(`status of ${code}`)); };
const knownAnswer = (url: string, status: number) => KNOWN.some(([re, code]) => re.test(url) && status === code);
const signedOut = (page: Page) => page.getByText(/Sign in to carry on|Sign in to see this/).count().catch(() => 0);
async function look(page: Page, where: string, fail: Fail) {
  const st = ((await page.evaluate(measureStrict).catch(() => [])) as any[]).filter((x) => x.rule !== "works");
  const us = (await page.evaluate(measureUsable).catch(() => [])) as any[];
  for (const x of [...st, ...us].slice(0, 5)) fail(where, `[${x.rule}] ${String(x.what).slice(0, 60)}: ${String(x.why).slice(0, 80)}`);
  if (await signedOut(page)) fail(where, "shows Sign in (the check's sign-in ended?)");
}

export async function phoneProfile(browser: Browser, engine: string, [name, dev]: [string, any], o: Opts & { fail: Fail }) {
  const { fail, out } = o;
  let s = await session();
  const { defaultBrowserType, isMobile, ...d } = dev as any;
  const ctx = await browser.newContext({ ...d, ...(engine === "firefox" ? {} : { isMobile }), serviceWorkers: "block" });
  await ctx.addCookies([cookieOf(s)]);
  o.track?.(ctx);
  if (o.root !== null) await routeLocal(ctx, o.root);
  const writes: any[] = [];
  await catchWrites(ctx, writes);
  await ctx.addInitScript({ content: INIT_WATCH });
  const page = await ctx.newPage();
  const where = (h: string) => `${engine} · ${name} · #${h}`;
  let at = "";
  page.on("pageerror", (e) => fail(where(at), `page error: ${e.message.slice(0, 120)}`));
  let shooting = false; // (WebKit: Playwright's screenshot adds a <style> of its own, which the page's CSP reports)
  // (an answer of 500 or more: reported by its address, once; its console line is the same thing again)
  const bad = new Set<string>();
  const proven = new Set((process.env.NOISE_PROVEN || "").split(",")); // (scripts/noise-proof.ts)
  page.on("response", (r) => { if (r.status() >= 500 && !knownAnswer(r.url(), r.status())) { bad.add(r.url()); fail(where(at), `HTTP ${r.status()} ${r.url().split("?")[0].slice(0, 140)}`); } });
  page.on("console", (m) => {
    if (m.type() !== "error" || known(m)) return;
    if (/status of 5\d\d/.test(m.text()) && bad.has(m.location()?.url || "")) return;
    if (shooting && proven.has("screenshot-style") && (/^BLOCKED style-src/.test(m.text()) || /Refused to apply .*style/i.test(m.text()))) return;
    if (/status of (401|403|404)|favicon|Service Worker/i.test(m.text())) return;
    fail(where(at), m.text().slice(0, 160));
  });
  let mine = s.token;
  const go = async (h: string, wait = 3500) => {
    at = h;
    await page.goto(`${base}/phone/#${h}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    for (const p of await waitReady(page)) fail(where(h), p);
    await page.waitForTimeout(wait);
    if (await signedOut(page)) await signIn(h, wait);
  };
  async function signIn(h: string, wait: number) {
    (o.log || console.log)(`  (${name}: signed in again at #${h}: the session was taken, by the Fixer's hourly or after-deploy check most likely)`);
    const now = await session(mine);
    mine = now.token;
    await ctx.addCookies([cookieOf(now)]);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
    await waitReady(page);
    await page.waitForTimeout(wait);
  }
  (o.log || console.log)(`${engine} · ${name}`);
  // the bar's sections, and More's screens
  await go("today");
  const hashes = new Set<string>((await page.$$eval(".tabs a[href^='#'], .tab[href^='#'], .bar a[href^='#']", (as) => as.map((a) => a.getAttribute("href")!.slice(1)))).filter(Boolean));
  await go("more");
  for (const h of await page.$$eval("#page a[href^='#']", (as) => as.map((a) => a.getAttribute("href")!.slice(1)))) hashes.add(h);
  for (const h of hashes) { await go(h, h.startsWith("agent") ? 6000 : 3500); await look(page, where(h), fail); shooting = true; await shot(page, null, join(out, `${engine}-${name.replace(/\W+/g, "-")}-${h.replace(/\W+/g, "-")}.png`)); shooting = false; }
  // the first row of each list opens its own screen
  for (const h of hashes) {
    await go(h);
    const first = page.locator("#page a.row-go[href^='#'], #page a.row[href^='#']").first();
    if (!(await first.count())) continue;
    const href = (await first.getAttribute("href"))!;
    await first.click();
    await page.waitForTimeout(3000);
    at = href.slice(1);
    if (await signedOut(page)) await signIn(at, 3000);
    if (decodeURIComponent(new URL(page.url()).hash) !== decodeURIComponent(href)) fail(where(h), `tapping ${href} went to ${new URL(page.url()).hash}`);
    else await look(page, where(at), fail);
  }
  // a note card, saved then deleted (caught); a message to Agent (caught)
  if (name === PROFILES[engine][0][0]) {
    await go("calendar/new/2026-12-24");
    const form = page.locator("#cal-form");
    await form.waitFor({ timeout: 8000 }).catch(() => {});
    if (!(await form.count())) fail(where("calendar/new"), `no note card form (at ${new URL(page.url()).hash}, showing "${(await page.locator("#title").textContent().catch(() => "")) || ""}": ${((await page.locator("#page").innerText().catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 100)})`);
    else {
      await page.fill("#cal-form [name=title]", "Phone check card");
      await page.locator("#cal-form [type=submit]").click();
      await page.waitForTimeout(2000);
      const put = writes.find((w) => w.method === "PUT" && w.path.startsWith("/app/api/calendar/items/"));
      if (!put) fail(where("calendar/new"), "saving sent nothing");
      else if (put.origin !== base || put.body?.kind !== "event" || put.body?.title !== "Phone check card") fail(where("calendar/new"), `saving sent the wrong thing: ${JSON.stringify(put.body).slice(0, 120)}`);
      else if (!new URL(page.url()).hash.startsWith("#calendar/card/")) fail(where("calendar/new"), `after saving, at ${new URL(page.url()).hash}`);
    }
    await go("agent", 6000);
    const box = page.locator("#ask-box:not([disabled]), #ask textarea:not([disabled])").first();
    if (await box.count()) {
      await box.fill("Check");
      await page.locator("#ask [type=submit]").click();
      await page.waitForTimeout(2500);
      const chat = writes.find((w) => w.path === "/actions/chat");
      if (!chat) fail(where("agent"), "sending a message sent nothing");
      else if (!(await page.locator("text=A reply from the check").count())) fail(where("agent"), "the reply didn't show");
    }
  }
  await ctx.close();
}
