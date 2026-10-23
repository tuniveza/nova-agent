// How smooth every place in the Nova suite is on each kind of device (22 Oct 2026, the user: "fix visual
// animation delay, glitching and or lag … all mobile phone profiles, laptop profiles and desktop profiles").
// Each place opens as real devices see it (Playwright's device profiles; phones with the processor slowed 4×
// and tablets 2×, as Chrome's own throttling does, so a laptop shows what a phone feels), signed in with the
// Fixer's looks session (it only looks). For each it measures:
//   - loading: long tasks (the page frozen 50 ms or more) and their total, and how far things jumped (layout
//     shift, the "glitching");
//   - sitting idle for 4 s: layouts, style recalculations and script time while nothing happens (should be
//     about none), and the frames: how many, the longest gap, how many over 33 ms;
//   - its running animations: what they move, and whether that's something the browser has to repaint every
//     frame (shadows, filters, backgrounds, sizes) instead of just moving (transform, opacity);
//   - a switch: from the Agent's tile bar to the place, the time until it shows and the long tasks on the way.
//
//   npx tsx scripts/perf.ts <out dir> [local|live] [devices] [places]
// Writes <out>/perf.json and prints a table, worst first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium, devices, type BrowserContext, type Route } from "playwright";

const base = "https://nova.novacane.co.uk";
const out = process.argv[2] || "perf-out";
const local = process.argv[3] !== "live";
const pickDev = process.argv[4] ? process.argv[4].split(",") : null;
const pickPlaces = process.argv[5] ? process.argv[5].split(",") : null;

type Dev = { name: string; form: string; cpu: number; opts: Record<string, unknown> };
const dev = (name: string, form: string, cpu: number, side = false): Dev => {
  const { defaultBrowserType, ...d } = devices[side ? `${name} landscape` : name] as any;
  return { name: name + (side ? " side" : ""), form, cpu, opts: d };
};
const DEVICES: Dev[] = [
  { name: "Desktop 1920x1080", form: "desktop", cpu: 1, opts: { viewport: { width: 1920, height: 1080 } } },
  { name: "Laptop 1366x768", form: "desktop", cpu: 2, opts: { viewport: { width: 1366, height: 768 } } },
  dev("iPhone SE (3rd gen)", "phone-up", 4), dev("Pixel 8a", "phone-up", 4), dev("iPhone 15", "phone-side", 4, true),
  dev("iPad Mini", "tablet-up", 2), dev("Galaxy Tab S9", "tablet-side", 2, true),
].filter((d) => !pickDev || pickDev.includes(d.name) || pickDev.includes(d.form));
const PLACES: [string, string][] = ([
  ["Agent", "/agent/"], ["Portal", "/portal/?view=inbox"], ["Today", "/portal/?view=today"], ["Calendar", "/calendar/"], ["Notes", "/notes/"],
  ["Board", "/board/"], ["Index", "/app/memory/"], ["Quests", "/quests/"], ["Fixer", "/fixer/"], ["Computer", "/computer/"],
  ["Observatory", "/observatory/"], ["Console", "/console/"], ["Invoicer", "/invoicer/"],
  // Nova Phone (/phone/, the mobile app): its busiest screens
  ["Phone Today", "/phone/#today"], ["Phone Inbox", "/phone/#inbox"], ["Phone Calendar", "/phone/#calendar"], ["Phone Money", "/phone/#money"], ["Phone More", "/phone/#more"], ["Phone Agent", "/phone/#agent"], ["Phone Notes", "/phone/#notes"], ["Phone Quests", "/phone/#quests"],
] as [string, string][]).filter((p) => !pickPlaces || pickPlaces.includes(p[0]));

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

// (in every frame, from the start: long tasks and layout shifts, kept on window.__perf)
const WATCH = `(() => {
  const p = (window.__perf = { long: [], shift: 0, shifts: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) p.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { p.shift += e.value; if (e.value > 0.01) p.shifts.push([Math.round(e.startTime), +e.value.toFixed(3), (e.sources || []).slice(0, 2).map((s) => s.node ? (s.node.id ? "#" + s.node.id : (s.node.className && s.node.className.baseVal === undefined ? "." + String(s.node.className).split(" ")[0] : s.node.nodeName)) : "?").join("+")]); } }).observe({ type: "layout-shift", buffered: true }); } catch (e) {}
})();`;

// (the animations running in a frame: what each moves; "paint" when it isn't only transform / opacity)
const animations = () => {
  const cheap = new Set(["transform", "opacity", "translate", "scale", "rotate", "offset", "composite", "computedOffset", "easing"]);
  const name = (el: Element | null) => !el ? "?" : el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList && el.classList[0] ? "." + el.classList[0] : "");
  const list: string[] = [];
  for (const a of document.getAnimations()) {
    if (a.playState !== "running") continue;
    const eff = a.effect as KeyframeEffect | null;
    const target = eff && (eff as any).target;
    const props = new Set<string>();
    try { for (const k of eff!.getKeyframes()) for (const p of Object.keys(k)) if (!cheap.has(p)) props.add(p); } catch (e) {}
    if ((a as any).transitionProperty) props.add((a as any).transitionProperty);
    const timing = eff ? eff.getTiming() : ({} as any);
    const infinite = timing.iterations === Infinity;
    const pseudo = eff && (eff as any).pseudoElement ? (eff as any).pseudoElement : "";
    const paint = [...props].filter((p) => !cheap.has(p) && !/^--/.test(p));
    list.push(`${name(target)}${pseudo} ${(a as any).animationName || (a as any).transitionProperty || "anim"}${infinite ? " ∞" : ""}${paint.length ? " PAINT:" + paint.join("/") : ""}`);
  }
  return list;
};

const key = (readFileSync(".env", "utf8").match(/^AGENT_NOVA_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const looks = (action: string) => fetch(`${base}/nova-agent/looks-session`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ action }) });
let s = (await (await looks("start")).json()) as { token?: string; cookie?: string };
if (!s.token) throw new Error("no looks session");
async function fresh() {
  const me = await fetch(`${base}/app/api/me`, { headers: { Cookie: `${s.cookie || "nova_session"}=${s.token}` } }).catch(() => null);
  if (me && me.ok) return;
  s = (await (await looks("start")).json()) as { token?: string; cookie?: string };
  console.log("looks session started again");
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const rows: any[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function measure(ctx: BrowserContext, d: Dev, [place, url]: [string, string]) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  if (d.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
  const row: any = { place, device: d.name, form: d.form };
  try {
    const t0 = Date.now();
    await page.goto(base + url, { waitUntil: "load", timeout: 60000 });
    row.load = Date.now() - t0;
    await sleep(6000);
    const frames = () => [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame() && f.url().startsWith(base))];
    // loading: long tasks and shifts in every frame
    let longs: number[][] = [], shift = 0, shifts: any[] = [];
    for (const f of frames()) {
      const p = (await f.evaluate(() => (window as any).__perf).catch(() => null)) as any;
      if (!p) continue;
      longs = longs.concat(p.long);
      shift += p.shift;
      shifts = shifts.concat(p.shifts.map((x: any) => [...x, f === page.mainFrame() ? "" : "panel"]));
    }
    row.longTasks = longs.length;
    row.blocking = longs.reduce((a, [, dur]) => a + Math.max(0, dur - 50), 0);
    row.longest = longs.reduce((a, [, dur]) => Math.max(a, dur), 0);
    row.shift = +shift.toFixed(3);
    row.shifts = shifts.sort((a, b) => b[1] - a[1]).slice(0, 4);
    // idle 4 s: what the browser does while nothing happens
    const m = async () => Object.fromEntries(((await cdp.send("Performance.getMetrics")) as any).metrics.map((x: any) => [x.name, x.value]));
    const a = await m();
    const fr = page.evaluate(() => new Promise<number[]>((res) => {
      const gaps: number[] = []; let last = performance.now(); const end = last + 4000;
      const step = (t: number) => { gaps.push(t - last); last = t; t < end ? requestAnimationFrame(step) : res(gaps); };
      requestAnimationFrame(step);
    }));
    await sleep(4000);
    const gaps = await fr;
    const b = await m();
    row.idleLayouts = b.LayoutCount - a.LayoutCount;
    row.idleStyles = b.RecalcStyleCount - a.RecalcStyleCount;
    row.idleScriptMs = Math.round((b.ScriptDuration - a.ScriptDuration) * 1000);
    row.idleLayoutMs = Math.round((b.LayoutDuration - a.LayoutDuration) * 1000);
    row.idleStyleMs = Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000);
    row.idleTaskMs = Math.round((b.TaskDuration - a.TaskDuration) * 1000);
    row.frames = gaps.length;
    row.maxGap = Math.round(Math.max(...gaps));
    row.slowFrames = gaps.filter((g) => g > 33).length;
    // animations running now, in every frame
    let anims: string[] = [];
    for (const f of frames()) anims = anims.concat(((await f.evaluate(animations).catch(() => [])) as string[]).map((x) => (f === page.mainFrame() ? "" : "[panel] ") + x));
    row.anims = anims.length;
    row.paintAnims = anims.filter((x) => x.includes("PAINT")).length;
    row.animList = [...new Set(anims)].slice(0, 12);
    await page.screenshot({ path: join(out, `${place}--${d.name.replace(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => {});
  } catch (e) { row.error = String(e).slice(0, 120); }
  await page.close();
  return row;
}

// (a switch from the Agent to a place by its tile: the time until the place's panel has drawn)
async function switchTo(ctx: BrowserContext, d: Dev, place: string, url: string) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (d.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: d.cpu });
  try {
    await page.goto(base + "/agent/", { waitUntil: "load", timeout: 60000 });
    await sleep(5000);
    const path = url.split("?")[0];
    // (the tile you'd tap: each place has one in the dock and one in the phone's tile bar, only one showing)
    const tile = page.locator(`[data-tab="${path}"]:visible, a.suite-app[data-inside="${path}"]:visible`).first();
    if (!(await tile.count())) return null;
    await tile.scrollIntoViewIfNeeded().catch(() => {});
    const t0 = Date.now();
    await tile.click({ timeout: 5000, force: true }).catch(() => {});
    // shown: the panel's frame is there, loaded and visible, and has drawn something
    const ok = await page.waitForFunction((p) => {
      const f = [...document.querySelectorAll("iframe")].find((x) => (x as HTMLIFrameElement).src.includes(p) && !x.classList.contains("loading") && (x as HTMLElement).offsetParent && getComputedStyle(x).opacity === "1");
      try { return !!(f && (f as HTMLIFrameElement).contentDocument && (f as HTMLIFrameElement).contentDocument!.readyState === "complete" && (f as HTMLIFrameElement).contentDocument!.body.children.length); } catch (e) { return false; }
    }, path, { timeout: 20000 }).then(() => true).catch(() => false);
    return ok ? Date.now() - t0 : -1;
  } catch (e) { return -2; } finally { await page.close(); }
}

try {
  let i = 0;
  const jobs = DEVICES;
  await Promise.all([0, 1].map(async () => {
    while (i < jobs.length) {
      const d = jobs[i++];
      await fresh();
      const ctx = await browser.newContext({ ...d.opts, serviceWorkers: "block" } as any);
      await ctx.addCookies([{ name: s.cookie || "nova_session", value: s.token!, url: base }]);
      await ctx.addInitScript({ content: "window.__name = (f) => f;" + WATCH });
      if (local) for (const dir of ["shared", "portal", "agent", "calendar", "notes", "board", "index", "quests", "fixer", "computer", "observatory", "console", "invoicer", "phone"]) await ctx.route(`${base}/${dir}/**`, serve);
      for (const p of PLACES) {
        const row = await measure(ctx, d, p);
        if (p[0] !== "Agent") row.switchMs = await switchTo(ctx, d, p[0], p[1]);
        rows.push(row);
      }
      await ctx.close();
      console.log(`done ${d.name}`);
    }
  }));
} finally { await browser.close(); await looks("end"); }
writeFileSync(join(out, "perf.json"), JSON.stringify(rows, null, 1));
const score = (r: any) => (r.blocking || 0) + (r.shift || 0) * 2000 + (r.idleLayouts || 0) * 20 + (r.idleScriptMs || 0) * 2 + (r.slowFrames || 0) * 30 + (r.paintAnims || 0) * 40 + Math.max(0, (r.switchMs || 0) - 1500) / 4;
rows.sort((a, b) => score(b) - score(a));
for (const r of rows) console.log(`${r.place.padEnd(11)} ${r.device.padEnd(22)} block ${String(r.blocking).padStart(5)}ms (${r.longTasks} long, max ${r.longest}) shift ${r.shift} | idle: ${r.idleLayouts} layouts ${r.idleStyles} styles ${r.idleScriptMs}ms js ${r.idleTaskMs}ms busy, frames ${r.frames} slow ${r.slowFrames} maxgap ${r.maxGap} | anims ${r.anims} (${r.paintAnims} paint) | switch ${r.switchMs ?? "-"}ms${r.error ? " ERR " + r.error : ""}`);
