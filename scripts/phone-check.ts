// The phone app on one browser engine, signed in (ns CLAUDE.md 2d: every phone engine before deploying).
//   npx tsx scripts/phone-check.ts <webkit|chromium|firefox> [live|local] [out dir]
// Signs in with the Fixer's looks account (it may only look: every write is caught as it leaves the page,
// checked, and answered as Nova Bot would). For each phone profile of that engine, upright and sideways:
//   - every section in the bar, and every screen More leads to: loads, strict + usable checks 0
//   - the first row of each list opens its own screen
//   - a new note card is filled in and saved, then deleted; a message goes to Agent (both caught)
//   - no page errors, no console errors, no blocked styles or scripts (CSP)
// Exits 1 if anything failed, with the list. WebKit and Firefox need the Playwright container
// (scripts/phone-engines.sh runs all three).
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium, webkit, firefox, devices, type Route, type Page, type BrowserContext } from "playwright";
import { measureStrict } from "../src/fixer/strict";
import { measureUsable } from "./usable";

const engine = (process.argv[2] || "chromium") as "webkit" | "chromium" | "firefox";
const live = process.argv[3] === "live";
const out = process.argv[4] || join(process.cwd(), ".phone-check");
mkdirSync(out, { recursive: true });
const base = "https://nova.novacane.co.uk", web = join(process.cwd(), "web");
// The phones each engine stands for
const FIREFOX_UA = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
const PROFILES: Record<string, [string, any][]> = {
  webkit: [["iPhone SE", devices["iPhone SE (3rd gen)"]], ["iPhone 15", devices["iPhone 15"]], ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]], ["iPhone 15 sideways", devices["iPhone 15 landscape"]], ["iPad Mini", devices["iPad Mini"]]],
  chromium: [["Pixel 10", devices["Pixel 10"] || devices["Pixel 7"]], ["Galaxy S24", devices["Galaxy S24"] || devices["Galaxy S9+"]], ["Pixel 10 sideways", devices["Pixel 10 landscape"] || devices["Pixel 7 landscape"]]],
  firefox: [["Firefox Android", { viewport: { width: 412, height: 839 }, deviceScaleFactor: 2.625, hasTouch: true, userAgent: FIREFOX_UA }], ["Firefox Android sideways", { viewport: { width: 839, height: 412 }, deviceScaleFactor: 2.625, hasTouch: true, userAgent: FIREFOX_UA }]],
};
const key = (readFileSync(".env", "utf8").match(/^AGENT_NOVA_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const looks = (action: string) => fetch(`${base}/nova-agent/looks-session`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ action }) });
const problems: string[] = [];
const fail = (where: string, what: string) => { problems.push(`${where}: ${what}`); console.log(`  ✕ ${where}: ${what}`); };

const serve = async (route: Route) => {
  let file = new URL(route.request().url()).pathname.slice(1);
  if (file.endsWith("/")) file += "index.html";
  const path = join(web, file);
  if (!existsSync(path)) return route.continue();
  const orig = await route.fetch().catch(() => null);
  const keep = Object.fromEntries(Object.entries(orig ? orig.headers() : {}).filter(([k]) => /^content-security-policy$/i.test(k)));
  return route.fulfill({ status: 200, body: readFileSync(path), headers: { ...keep, "Content-Type": ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".webmanifest": "application/manifest+json" } as any)[extname(path)] || "application/octet-stream" } });
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
const signedOut = (page: Page) => page.getByText(/Sign in to carry on|Sign in to see this/).count().catch(() => 0);
async function look(page: Page, where: string) {
  const st = ((await page.evaluate(measureStrict).catch(() => [])) as any[]).filter((x) => x.rule !== "works");
  const us = (await page.evaluate(measureUsable).catch(() => [])) as any[];
  for (const x of [...st, ...us].slice(0, 5)) fail(where, `[${x.rule}] ${String(x.what).slice(0, 60)}: ${String(x.why).slice(0, 80)}`);
  if (await signedOut(page)) fail(where, "shows Sign in (the check's sign-in ended?)");
}

// (only one looks session exists at a time: when the Fixer's own hourly check starts one, ours ends, so a screen
// that comes up signed out gets a new session and another try)
let s: any = await (await looks("start")).json();
const browser = await ({ webkit, chromium, firefox }[engine]).launch();
try {
  for (const [name, dev] of PROFILES[engine]) {
    const { defaultBrowserType, isMobile, ...d } = dev as any;
    const ctx = await browser.newContext({ ...d, ...(engine === "firefox" ? {} : { isMobile }), serviceWorkers: "block" });
    await ctx.addCookies([{ name: s.cookie, value: s.token, url: base }]);
    if (!live) for (const dd of ["phone", "shared"]) await ctx.route(`${base}/${dd}/**`, serve);
    const writes: any[] = [];
    await catchWrites(ctx, writes);
    await ctx.addInitScript({ content: "addEventListener('securitypolicyviolation', (e) => console.error('BLOCKED ' + e.violatedDirective + ' ' + (e.sourceFile || '') + ':' + e.lineNumber + ' ' + (e.sample || '').slice(0, 60)), true); addEventListener('unhandledrejection', (e) => console.error('UNHANDLED ' + (e.reason && e.reason.message || e.reason)));" });
    const page = await ctx.newPage();
    const where = (h: string) => `${engine} · ${name} · #${h}`;
    let at = "";
    page.on("pageerror", (e) => fail(where(at), `page error: ${e.message.slice(0, 120)}`));
    let shooting = false; // (WebKit: Playwright's screenshot adds a <style> of its own, which the page's CSP reports)
    page.on("console", (m) => { if (!shooting && m.type() === "error" && !/status of (401|403|404|503)|favicon|Service Worker/i.test(m.text())) fail(where(at), m.text().slice(0, 160)); });
    const go = async (h: string, wait = 3500) => {
      at = h;
      await page.goto(`${base}/phone/#${h}`, { waitUntil: "load" });
      await page.waitForTimeout(wait);
      if (!(await signedOut(page))) return;
      console.log(`  (signed in again at #${h}: the session was taken, by the Fixer's hourly check most likely)`);
      s = await (await looks("start")).json();
      await ctx.addCookies([{ name: s.cookie, value: s.token, url: base }]);
      await page.reload({ waitUntil: "load" });
      await page.waitForTimeout(wait);
    };
    console.log(`${engine} · ${name}`);
    // the bar's sections, and More's screens
    await go("today");
    const hashes = new Set<string>((await page.$$eval(".tabs a[href^='#'], .tab[href^='#'], .bar a[href^='#']", (as) => as.map((a) => a.getAttribute("href")!.slice(1)))).filter(Boolean));
    await go("more");
    for (const h of await page.$$eval("#page a[href^='#']", (as) => as.map((a) => a.getAttribute("href")!.slice(1)))) hashes.add(h);
    for (const h of hashes) { await go(h, h.startsWith("agent") ? 6000 : 3500); await look(page, where(h)); shooting = true; await page.screenshot({ path: join(out, `${engine}-${name.replace(/\W+/g, "-")}-${h.replace(/\W+/g, "-")}.png`) }); await page.waitForTimeout(400); shooting = false; }
    // the first row of each list opens its own screen
    for (const h of hashes) {
      await go(h);
      const first = page.locator("#page a.row[href^='#']").first();
      if (!(await first.count())) continue;
      const href = (await first.getAttribute("href"))!;
      await first.click();
      await page.waitForTimeout(3000);
      at = href.slice(1);
      if (decodeURIComponent(new URL(page.url()).hash) !== decodeURIComponent(href)) fail(where(h), `tapping ${href} went to ${new URL(page.url()).hash}`);
      else await look(page, where(at));
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
} finally {
  await browser.close();
  await looks("end");
}
console.log(problems.length ? `\n${engine}: ${problems.length} problem(s)` : `\n${engine}: all clear`);
process.exit(problems.length ? 1 : 0);
