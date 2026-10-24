// The quick look before a deploy (ns CLAUDE.md 2g.1, 24 Oct 2026, the user: "make intelligent decisions"): each
// place the change touches, on its own app's screens (2c.6), live and the new files side by side, in Blink. For each:
// nothing blank, no new console errors, nothing new from the strict rules, and a screenshot to look at. A few minutes.
//   WEB_ROOT=<tree> npx tsx scripts/quick-look.ts <out dir> <desk paths,…> [phone screens,…]
//   e.g. … /tmp/ql "/agent/,/fixer/,/calendar/" "#more,#fixer"
// Desk paths open on Nova Desk at 1440×900 and 1366×400; phone screens open in /phone/ on an iPhone 15, upright
// and sideways. WEB_ROOT: the new files (default: this folder's web/). Exits 1 when something new is wrong.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, type Page } from "playwright";
import { deskContext, base } from "../.desk-kit";
import { measureStrict } from "../src/fixer/strict";

const out = process.argv[2] || "quick-look";
const desk = (process.argv[3] || "").split(",").filter(Boolean);
const phone = (process.argv[4] || "").split(",").filter(Boolean);
mkdirSync(out, { recursive: true });
const PROFILES: [string, Record<string, unknown>, "desk" | "phone"][] = [
  ["1440x900", { viewport: { width: 1440, height: 900 } }, "desk"],
  ["1366x400", { viewport: { width: 1366, height: 400 } }, "desk"],
  ["iPhone 15", (({ defaultBrowserType, ...d }: any) => d)(devices["iPhone 15"]), "phone"],
  ["iPhone 15 side", (({ defaultBrowserType, ...d }: any) => d)(devices["iPhone 15 landscape"]), "phone"],
];
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "home";

async function look(page: Page, url: string) {
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().replace(/\s+/g, " ").slice(0, 120)); });
  page.on("pageerror", (e) => errs.push("PAGE " + String(e).slice(0, 120)));
  await page.goto(base + url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const frames = [page.mainFrame(), ...(await Promise.all((await page.$$("#viewer-frame")).map((h) => h.contentFrame()))).filter(Boolean)] as any[];
  let strict: string[] = [], text = 0;
  for (const fr of frames) {
    await fr.evaluate(() => (window as any).NovaOneScreen?.now()).catch(() => {});
    text += await fr.evaluate(() => (document.body?.innerText || "").trim().length).catch(() => 0);
    strict.push(...((await fr.evaluate(measureStrict).catch(() => [])) as any[]).map((x) => `[${x.rule}] ${String(x.what).slice(0, 60)}`));
  }
  return { errs: [...new Set(errs)], strict: [...new Set(strict)], text };
}

const browser = await chromium.launch();
const bad: string[] = [];
const lines: string[] = [];
await Promise.all(PROFILES.map(async ([name, opts, app]) => {
  const urls = app === "desk" ? desk : phone.map((s) => "/phone/" + s);
  if (!urls.length) return;
  const live = await deskContext(browser, opts, false);
  const mine = await deskContext(browser, opts, true);
  for (const url of urls) {
    const [a, b] = await Promise.all([live.newPage(), mine.newPage()]);
    try {
      const [L, N] = await Promise.all([look(a, url), look(b, url)]);
      await b.screenshot({ path: join(out, `${slug(name)}--${slug(url)}.png`) });
      const newErr = N.errs.filter((e) => !L.errs.includes(e));
      const newStrict = N.strict.filter((x) => !L.strict.includes(x));
      const blank = N.text < 20;
      const ok = !blank && !newErr.length && !newStrict.length;
      lines.push(`${ok ? "ok  " : "NEW "} ${name.padEnd(15)} ${url.padEnd(22)} strict ${L.strict.length}→${N.strict.length}  errors ${L.errs.length}→${N.errs.length}${blank ? "  BLANK" : ""}`);
      for (const x of [...newStrict, ...newErr.map((e) => "error: " + e)]) lines.push(`       ${x}`);
      if (!ok) bad.push(`${name} ${url}`);
    } catch (e) { lines.push(`ERR  ${name} ${url} ${String(e).slice(0, 100)}`); bad.push(`${name} ${url}`); }
    await Promise.all([a.close(), b.close()]);
  }
  await Promise.all([live.close(), mine.close()]);
}));
await browser.close();
console.log(lines.join("\n"));
console.log(bad.length ? `SOMETHING NEW: ${bad.join(", ")}` : `QUICK LOOK OK (screenshots in ${out})`);
process.exit(bad.length ? 1 : 0);
