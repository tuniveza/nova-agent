// How fast Nova feels, measured on the live site: Nova Agent's page cold (empty cache) and warm
// (the second visit), then each panel opened from it, first time and again, as a signed-in admin
// made just for this run (a 15-minute session written into Nova Bot's database on the VPS over ssh,
// removed at the end). Run on the studio PC:   node scripts/perf-live.mjs [--json out.json]
//   PERF_URL=https://nova.novacane.co.uk  PERF_VPS=root@185.185.126.195
// Prints one table: time to first byte, first paint, largest paint, page ready, requests and bytes
// for the page; for each panel: open (the frame's load plus its first data) and open again.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const URL_ = process.env.PERF_URL || "https://nova.novacane.co.uk";
const VPS = process.env.PERF_VPS || "root@185.185.126.195";
const HOST = new URL(URL_).hostname;
const ID = "perf-test";
const PANELS = process.env.PERF_PANELS ? process.env.PERF_PANELS.split(",") : ["/portal/", "/calendar/", "/notes/", "/board/", "/quests/", "/app/memory/", "/console/", "/fixer/", "/observatory/", "/lossless/", "/visualizer"];

const token = randomBytes(32).toString("base64url");
const sid = createHash("sha256").update(token).digest("base64url");
const D1 = "/srv/nova/state/v3/d1/miniflare-D1DatabaseObject";
const remoteSql = (q) =>
  execFileSync("ssh", [VPS, `db=$(ls ${D1}/*.sqlite | grep -v metadata | head -1); sqlite3 -cmd '.timeout 8000' "$db" "${q.replace(/"/g, '\\"')}"`], { encoding: "utf8" });
function signIn() {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 15 * 60_000).toISOString();
  remoteSql(
    `INSERT OR REPLACE INTO staff (id, email, password_hash, display_name, role, status, created_at, planet_seed, index_partition) VALUES ('${ID}', '${ID}@nova.invalid', NULL, 'Speed test', 'admin', 'active', '${now}', '${ID}', 'staff:${ID}');` +
      `INSERT INTO sessions (id, staff_id, kind, created_at, expires_at, last_seen_at, user_agent) VALUES ('${sid}', '${ID}', 'cookie', '${now}', '${later}', '${now}', 'speed test');`,
  );
}
function signOut() {
  try {
    remoteSql(`DELETE FROM sessions WHERE staff_id = '${ID}'; DELETE FROM staff WHERE id = '${ID}';`);
  } catch {}
  try {
    execFileSync("ssh", [VPS, `rm -f /srv/nova-agent/data/chats/${ID}.json /srv/nova-agent/data/boards/${ID}.json`]);
  } catch {}
}

const ms = (n) => (n == null ? "-" : `${Math.round(n)}`);
const kb = (n) => `${Math.round(n / 1024)}`;

async function pageLoad(context, label) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  let bytes = 0, requests = 0;
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; requests++; });
  await page.goto(URL_ + "/agent/", { waitUntil: "load", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  // (Nova Agent reloads itself when the studio computer's link comes back: measure the page that stays)
  const measure = () => page.evaluate(() => new Promise((done) => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    let lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => done({ ttfb: nav.responseStart - nav.startTime, fcp: fcp?.startTime, lcp, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd }), 300);
  }));
  let t;
  for (let i = 0; i < 3 && !t; i++) t = await measure().catch(async () => { await page.waitForLoadState("load").catch(() => {}); return null; });
  return { page, cdp, label, ...t, bytes, requests };
}

async function openPanel(page, path) {
  const apis = [];
  const onDone = (req) => {
    const u = new URL(req.url());
    const tm = req.timing();
    if (process.env.PERF_DEBUG && (tm.responseEnd > 800 || process.env.PERF_DEBUG === 'all')) console.log(`     slow ${req.resourceType()} ${Math.round(tm.responseEnd)}ms ${u.host}${u.pathname}`);
    if (u.hostname !== HOST || !["fetch", "xhr"].includes(req.resourceType())) return;
    apis.push({ path: u.pathname, ms: tm.responseEnd });
  };
  page.on("requestfinished", onDone);
  let inflight = 0, last = Date.now();
  // Nova Agent's own page keeps checking things (status, quests, live updates): not part of opening
  const quiet = (req) => { try { return req.frame() === page.mainFrame() || /\/events$/.test(new URL(req.url()).pathname); } catch { return true; } };
  const onReq = (req) => { if (quiet(req)) return; inflight++; last = Date.now(); if (process.env.PERF_DEBUG) req._t = Date.now(); };
  const onEnd = (req) => { if (quiet(req)) return; inflight = Math.max(0, inflight - 1); last = Date.now(); };
  page.on("request", onReq); page.on("requestfinished", onEnd); page.on("requestfailed", onEnd);
  const start = Date.now();
  await page.evaluate((p) => {
    const a = document.querySelector(`a.suite-app[data-inside="${p}"]`);
    if (a) a.click();
  }, path);
  // the panel's frame has its page loaded (the frame that's showing, at the panel's address)
  const want = path.replace(/\/$/, "");
  for (;;) {
    const ok = await page.evaluate((w) => {
      const f = document.getElementById("viewer-frame");
      try { return !!f && f.contentWindow.location.pathname.startsWith(w) && f.contentDocument.readyState === "complete"; } catch { return false; }
    }, want).catch(() => false);
    if (ok || Date.now() - start > 30_000) break;
    await page.waitForTimeout(20);
  }
  const frameLoad = Date.now() - start;
  // its first data: until no request has been going for 400 ms (max 15 s)
  while (Date.now() - start < 8_000 && (inflight > 0 || Date.now() - last < 400)) await page.waitForTimeout(50);
  const ready = last - start;
  page.off("requestfinished", onDone); page.off("request", onReq); page.off("requestfinished", onEnd); page.off("requestfailed", onEnd);
  return { frameLoad, ready: Math.max(frameLoad, ready), apis };
}
async function closePanel(page) {
  await page.evaluate(() => document.getElementById("viewer-close")?.click());
  await page.waitForTimeout(150);
}

signIn();
const out = { at: new Date().toISOString(), url: URL_ };
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: "nova_session", value: token, domain: HOST, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const cold = await pageLoad(context, "cold");
  // a returning visit: Nova's files settle on the device first (its service worker), like the next day
  await cold.page.waitForTimeout(Number(process.env.PERF_SETTLE || 15000));
  await cold.page.close();
  const warm = await pageLoad(context, "warm");
  out.page = [cold, warm].map(({ label, ttfb, fcp, lcp, dcl, load, bytes, requests }) => ({ label, ttfb, fcp, lcp, dcl, load, bytes, requests }));
  console.log("Nova Agent's page      ttfb  fcp   lcp   dcl   load  reqs  KB");
  for (const r of out.page) console.log(`  ${r.label.padEnd(20)} ${ms(r.ttfb).padStart(5)} ${ms(r.fcp).padStart(5)} ${ms(r.lcp).padStart(5)} ${ms(r.dcl).padStart(5)} ${ms(r.load).padStart(5)} ${String(r.requests).padStart(5)} ${kb(r.bytes).padStart(5)}`);
  const page = warm.page;
  out.panels = [];
  const allApis = [];
  console.log("Panel                 first  again (ms: frame load / ready)");
  for (const p of PANELS) {
    const first = await openPanel(page, p);
    await closePanel(page);
    const again = await openPanel(page, p);
    await closePanel(page);
    out.panels.push({ panel: p, first, again });
    allApis.push(...first.apis);
    console.log(`  ${p.padEnd(20)} ${`${first.frameLoad}/${first.ready}`.padStart(11)}  ${`${again.frameLoad}/${again.ready}`.padStart(11)}`);
  }
  // the slowest data calls seen while opening panels
  const byPath = new Map();
  for (const a of allApis) { const k = a.path.replace(/\/[0-9a-f-]{20,}/g, "/:id"); byPath.set(k, Math.max(byPath.get(k) || 0, a.ms)); }
  out.apis = [...byPath].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log("Slowest data calls (ms)");
  for (const [k, v] of out.apis) console.log(`  ${ms(v).padStart(6)}  ${k}`);
} finally {
  await browser.close();
  signOut();
}
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 2));
