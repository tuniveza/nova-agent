// Every place in the Nova suite on every form (22 Oct 2026, the user: "THE ENTIRE NOVA-SUITE NEEDS TO HAVE
// CHANGES SO THERE UNIFIED"; ns/CLAUDE.md 2c). Opens each place as real devices see it: phones and tablets
// upright and on their side with their own user agent, pixel density and touch (Playwright's device list),
// and computer windows from full size down to narrow and short. For each it checks:
//   - the form look.js picked (html[data-form]) is the one that device should get;
//   - nothing is off the screen and nothing scrolls (the Fixer's strict rules: offscreen, onescreen);
//   - no content panel is squashed (a Nova pane or content panel under 90px tall or 150px wide);
// and saves a screenshot of each, with one contact sheet per place (place × form) to look over.
//
//   npx tsx scripts/forms.ts <out dir> [local|live] [forms] [places]
//     forms: a comma list of names below, or desktop / phone-up / phone-side / tablet-up / tablet-side (all of
//     that form); places: a comma list of names (Portal, Agent, Calendar…)
// "local" serves this tree's web/ files under the live site's headers (its CSP kept), signed in with the
// Fixer's looks session (it only looks: nothing can be sent or saved).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join } from "node:path";
import { chromium, devices, type BrowserContext, type Route } from "playwright";
import { measureStrict } from "../src/fixer/strict";

const base = "https://nova.novacane.co.uk";
const out = process.argv[2] || "forms-out";
const local = process.argv[3] !== "live";
const pickForms = process.argv[4] ? process.argv[4].split(",") : null;
const pickPlaces = process.argv[5] ? process.argv[5].split(",") : null;

type Form = { name: string; form: string; opts: Record<string, unknown> };
const dev = (name: string, form: string, side = false): Form => {
  const { defaultBrowserType, ...d } = devices[side ? `${name} landscape` : name] as any;
  return { name: name + (side ? " side" : ""), form, opts: d };
};
const win = (w: number, h: number): Form => ({ name: `Computer ${w}x${h}`, form: "desktop", opts: { viewport: { width: w, height: h } } });
const FORMS: Form[] = [
  win(1920, 1080), win(1440, 900), win(1366, 768), win(1280, 720), win(1024, 768), win(800, 700), win(700, 900), win(480, 800),
  win(1366, 400), win(977, 308), win(900, 320),
  dev("iPhone SE (3rd gen)", "phone-up"), dev("iPhone 15", "phone-up"), dev("iPhone 17 Pro Max", "phone-up"), dev("Galaxy S24", "phone-up"), dev("Pixel 8a", "phone-up"),
  dev("iPhone SE (3rd gen)", "phone-side", true), dev("iPhone 15", "phone-side", true), dev("iPhone 17 Pro Max", "phone-side", true), dev("Pixel 8a", "phone-side", true),
  dev("iPad Mini", "tablet-up"), dev("Galaxy Tab S9", "tablet-up"), dev("iPad Pro 11", "tablet-up"),
  dev("iPad Mini", "tablet-side", true), dev("Galaxy Tab S9", "tablet-side", true), dev("iPad Pro 11", "tablet-side", true),
].filter((f) => !pickForms || pickForms.includes(f.name) || pickForms.includes(f.form));
const PLACES: [string, string, string?][] = ([
  ["Agent", "/agent/"], ["Manual", "/agent/", '[data-act="manual"], #tabbar [data-tab="manual"]'],
  ["Portal", "/portal/?view=inbox"], ["Today", "/portal/?view=today"], ["Calendar", "/calendar/"], ["Notes", "/notes/"], ["Board", "/board/"], ["Index", "/app/memory/"],
  ["Quests", "/quests/"], ["Fixer", "/fixer/"], ["Computer", "/computer/"], ["Observatory", "/observatory/"], ["Console", "/console/"],
  ["Lossless", "/lossless/"], ["Invoicer", "/invoicer/"],
] as [string, string, string?][]).filter((p) => !pickPlaces || pickPlaces.includes(p[0]));

const web = join(process.cwd(), "web");
const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const serve = async (route: Route) => {
  let file = new URL(route.request().url()).pathname.slice(1);
  if (file === "agent/" || file === "agent/index.html") file = "agent/chat.html";
  else if (file.startsWith("agent/") && !file.slice(6).includes("/") && existsSync(join(web, "agent/assets", file.slice(6)))) file = "agent/assets/" + file.slice(6);
  if (file.endsWith("/")) file += "index.html";
  const path = join(web, file);
  if (!existsSync(path)) return route.continue();
  const orig = await route.fetch().catch(() => null);
  const keep = Object.fromEntries(Object.entries(orig ? orig.headers() : {}).filter(([k]) => /^content-security-policy$/i.test(k)));
  return route.fulfill({ status: 200, body: readFileSync(path), headers: { ...keep, "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" } });
};

// (squashed: a content panel too small to show what's in it)
const squashed = () => {
  const SEL = "#main > .view:not([hidden]), .nova-pane:not([hidden]), .cpanel, [data-pane]";
  const out: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(SEL)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.display === "none" || cs.visibility === "hidden" || el.closest("[hidden], [aria-hidden='true']")) continue;
    if (el.parentElement && el.parentElement.closest(SEL)) continue;
    if (r.height < 90 || r.width < 150) out.push(`${el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + (el.classList[0] || "")}${el.dataset.pane ? `[${el.dataset.pane}]` : ""} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
};

// (off the theme: anything coloured far from every colour of the page's own theme, the biggest first; and the
// theme's highlight, so a panel in another theme from the page it's opened in shows)
const offTheme = () => {
  const root = getComputedStyle(document.documentElement);
  const parse = (c: string) => { const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const hsl = ([r, g, b]: number[]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  };
  const probe = document.createElement("i");
  document.body.append(probe);
  const toRgb = (v: string) => { probe.style.color = v; return parse(getComputedStyle(probe).color); };
  const theme = ["--hi", "--accent", "--accent-2", "--lilac", "--gold", "--soft", "--rose"].map((k) => root.getPropertyValue(k).trim()).filter(Boolean).map(toRgb).filter(Boolean).map((c) => hsl(c as number[])).filter(([, s, l]) => s > 0.25 && l > 0.12 && l < 0.92).map(([h]) => h);
  // (the status colours mean the same in every theme: done / heads-up / off; they're allowed too)
  for (const k of ["--ok", "--warn", "--bad"]) { const c = toRgb(root.getPropertyValue(k).trim() || "transparent"); if (c && c[3]) theme.push(hsl(c as number[])[0]); }
  const hiRgb = toRgb(root.getPropertyValue("--hi").trim() || "#000");
  probe.remove();
  const near = (h: number) => Math.min(...theme.map((t) => Math.min(Math.abs(t - h), 360 - Math.abs(t - h))));
  const hits = new Map<string, number>();
  if (theme.length) for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 300 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth || el.closest("[hidden], svg, canvas, img, video, [aria-hidden='true']")) continue;
    // (colours shown on purpose: theme swatches, a card's colour you chose, code and terminal colours)
    if (el.closest(".swatch, .look-swatch, [data-look-theme], .theme-swatch, .board .card, .card[class*='c-'], .term, .code, pre, code, [data-own-colour]")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || +cs.opacity < 0.3) continue;
    const cols: [string, string][] = [["fill", cs.backgroundColor], ["edge", parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : ""]];
    for (const m of cs.backgroundImage.matchAll(/rgba?\([^)]+\)/g)) cols.push(["fill", m[0]]);
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) cols.push(["text", cs.color]);
    for (const [what, c] of cols) {
      const p = c && parse(c);
      if (!p || p[3] < 0.35) continue;
      const [h, s, l] = hsl(p);
      if (s < 0.35 || l < 0.15 || l > 0.9 || near(h) <= 40) continue;
      const k = `${el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList[0] ? "." + el.classList[0] : "")} ${what} hsl(${Math.round(h)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
      hits.set(k, (hits.get(k) || 0) + r.width * r.height);
    }
  }
  return { hi: hiRgb ? Math.round(hsl(hiRgb as number[])[0]) : -1, themeHues: theme.map(Math.round), off: [...hits].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k) };
};

const key = (readFileSync(".env", "utf8").match(/^AGENT_NOVA_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const looks = (action: string) => fetch(`${base}/nova-agent/looks-session`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ action }) });
let s = (await (await looks("start")).json()) as { token?: string; cookie?: string };
if (!s.token) throw new Error("no looks session");
// (the Fixer's own looks check on the VPS, every 30 minutes, starts its own session and so ends this one:
// before each device the session is checked and started again if it's gone)
async function fresh() {
  const me = await fetch(`${base}/app/api/me`, { headers: { Cookie: `${s.cookie || "nova_session"}=${s.token}` } }).catch(() => null);
  if (me && me.ok) return;
  s = (await (await looks("start")).json()) as { token?: string; cookie?: string };
  console.log("looks session started again");
}
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results: string[] = [];
const slug = (x: string) => x.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
async function one(ctx: BrowserContext, f: Form, [place, url, tap]: [string, string, string?]) {
  const page = await ctx.newPage();
  try {
    await page.goto(base + url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(5000);
    if (tap) { await page.locator(tap).first().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); }
    const path = url.split("?")[0];
    const frames = path === "/agent/" ? [page.mainFrame()] : [page.mainFrame(), ...page.frames().filter((x) => x !== page.mainFrame() && new URL(x.url()).pathname.startsWith(path))];
    const found: string[] = [];
    let pageHue = -1;
    for (const fr of frames) {
      const where = fr === page.mainFrame() ? "" : " (in panel)";
      await fr.evaluate(() => (window as any).NovaOneScreen?.now()).catch(() => {});
      await page.waitForTimeout(300);
      const got = await fr.evaluate(() => document.documentElement.dataset.form || "none").catch(() => "?");
      if (got !== f.form) found.push(`[form] got ${got}, should be ${f.form}${where}`);
      const st = ((await fr.evaluate(measureStrict).catch(() => [])) as any[]).filter((x) => x.rule === "offscreen" || x.rule === "onescreen");
      for (const x of st) found.push(`[${x.rule}] ${String(x.what).slice(0, 50)} — ${String(x.why).slice(0, 90)}${where}`);
      for (const x of (await fr.evaluate(squashed).catch(() => [])) as string[]) found.push(`[squashed] ${x}${where}`);
      const col = (await fr.evaluate(offTheme).catch(() => null)) as { hi: number; themeHues: number[]; off: string[] } | null;
      if (col) {
        if (fr === page.mainFrame()) pageHue = col.hi;
        else if (pageHue >= 0 && col.hi >= 0 && Math.min(Math.abs(pageHue - col.hi), 360 - Math.abs(pageHue - col.hi)) > 30) found.push(`[colour] the panel's theme (hue ${col.hi}) isn't the page's (hue ${pageHue})`);
        for (const x of col.off) found.push(`[colour] off the theme (hues ${col.themeHues.join("/")}): ${x}${where}`);
      }
    }
    await page.screenshot({ path: join(out, `${slug(place)}--${slug(f.name)}.png`) });
    for (const x of found.slice(0, 8)) results.push(`${place} | ${f.name} | ${x}`);
    if (found.length > 8) results.push(`${place} | ${f.name} | … and ${found.length - 8} more`);
  } catch (e) { results.push(`${place} | ${f.name} | ERROR ${String(e).slice(0, 100)}`); }
  await page.close();
}
try {
  let i = 0;
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (i < FORMS.length) {
      const f = FORMS[i++];
      await fresh();
      const ctx = await browser.newContext({ ...f.opts, serviceWorkers: "block" } as any);
      await ctx.addCookies([{ name: s.cookie || "nova_session", value: s.token!, url: base }]);
      await ctx.addInitScript({ content: "window.__name = (f) => f;" });
      if (local) for (const d of ["shared", "portal", "agent", "calendar", "notes", "board", "index", "quests", "fixer", "computer", "observatory", "console", "lossless", "invoicer"]) await ctx.route(`${base}/${d}/**`, serve);
      for (const p of PLACES) await one(ctx, f, p);
      await ctx.close();
      console.log(`done ${f.name}`);
    }
  }));
} finally { await browser.close(); await looks("end"); }
// (a contact sheet per place: every form side by side)
for (const [place] of PLACES) {
  const shots = FORMS.map((f) => join(out, `${slug(place)}--${slug(f.name)}.png`)).filter((p) => existsSync(p));
  if (shots.length) try {
    execFileSync("montage", [...shots.flatMap((p) => ["-label", p.split("--")[1].replace(/\.png$/, ""), p]), "-geometry", "360x360>+6+6", "-tile", "6x", "-background", "#111", "-fill", "#ddd", join(out, `sheet-${slug(place)}.png`)]);
  } catch (e) {}
}
console.log(results.sort().join("\n") || "Every place on every form: right form, nothing off the screen or scrolling, nothing squashed");
console.log(`${results.length} finding(s)`);
