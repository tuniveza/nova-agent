// The Fixer's "Needs you" card, with sample fixes, at the sizes a panel gets inside Nova Agent:
// checks the page never scrolls and Approve / Reject stay on screen, and saves pictures.
//   node scripts/shots-fixer.mjs <out dir> [sample pictures dir]
// No server: Playwright answers the page's requests itself (web/ files, a sample /fixer-api/state,
// and the sample pictures, matched by name, e.g. portal-390x844-out.png). Nothing real is touched.
import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const OUT = process.argv[2] || "shots-fixer";
const PICS = process.argv[3] || "";
mkdirSync(OUT, { recursive: true });
const pics = PICS && existsSync(PICS) ? readdirSync(PICS) : [];
const pic = (name) => (pics.includes(name) ? name : "");

const now = new Date().toISOString();
const job = (id, status, target, card, about) => ({ id, status, target, card, about, notes: [], attempt: 1, error: "", approval: null, created: now, updated: now, finishedAt: now });
const checks = [
  { name: "Nova Agent's tests", ok: true, detail: "" },
  { name: "Nova Agent's typecheck", ok: true, detail: "" },
  { name: "Looks check where it was seen (390×844, 1024×768)", ok: true, detail: "" },
];
const STATE = {
  dry: false, settings: { hourlyChecks: true, autoPrepare: true, looksChecks: true, dailyCap: 10, timeLimitMinutes: 30 }, running: false, checking: false,
  lastCheck: { at: now, took: 182000 }, checks: null, claude: "", today: { prepared: 3, cap: 10 },
  looks: { at: now, took: 360000, screens: 144, failed: 3, results: [
    { name: "Board", path: "/board/", width: 360, height: 740, signedIn: true, ms: 900, shot: pic("board-360x740-in.png"), problems: [{ kind: "offscreen", severity: "minor", text: "Partly off the screen: button “Pin (keep it here)”", box: { x: 300, y: 610, w: 80, h: 44 } }] },
  ] },
  issues: [
    { id: "i1", area: "looks", severity: "serious", title: "Portal: cut off", panel: "/portal/", firstSeen: now, lastSeen: now, seenCount: 3 },
    { id: "i3", area: "looks", severity: "minor", title: "Board: Pin off screen", panel: "/board/", firstSeen: now, lastSeen: now, seenCount: 2 },
  ],
  quests: [], suggestions: [], done: [], activity: [{ at: now, text: "Ready for you: Portal's sign-in", kind: "job" }],
  needsYou: [
    job("j1", "ready", { type: "issue", id: "i1", title: "Portal: The panel's page is 1180px tall on a 654px screen and can't scroll: the bottom is cut off (and at 2 other sizes)", details: "", kind: "glitch" }, {
      title: "Portal's sign-in cut off on phones", wrong: "On phones the bottom of the sign-in screen is hidden, so the Sign in button can't be reached.",
      cause: "The sign-in box is taller than the room Nova gives it, and it isn't set to scroll inside itself.", fix: "The sign-in box now scrolls inside itself, so everything can be reached on any phone.",
      summary: "Portal's sign-in now scrolls inside its own box on short screens.", why: "", files: [{ repo: "na", path: "web/portal/portal.css", added: 6, removed: 1 }], diff: "",
      screens: [
        { name: "Portal", path: "/portal/", width: 390, height: 844, label: "390×844, signed out", before: pic("portal-390x844-out.png"), after: pic("portal-390x844-out.png"), boxes: [{ x: 14, y: 640, w: 362, h: 150 }] },
        { name: "Portal", path: "/portal/", width: 1024, height: 768, label: "1024×768, signed out", before: pic("portal-1024x768-out.png"), after: pic("portal-1024x768-out.png"), boxes: [{ x: 200, y: 600, w: 624, h: 120 }] },
      ],
      consequences: "Staff on phones can sign in again.", assessment: "Small and safe.", risks: [], recommendation: { verdict: "approve", reasons: ["All checks passed", "Tiny change"] },
      trivial: true, checks, allPassed: true, offLimits: [],
    }, { severity: "serious", area: "looks", panel: "/portal/", panelName: "Portal", kind: "cut-off", problem: "The panel's page is 1180px tall on a 654px screen and can't scroll: the bottom is cut off", where: ["390×844 signed out", "360×740 signed out", "1024×768 signed out"] }),
    job("j2", "ready", { type: "quest", id: "q1", title: "Notes: make the toolbar buttons bigger on a phone", details: "", kind: "change" }, {
      summary: "Notes' toolbar buttons are now 48px tall on touch screens. Nothing else changes.", why: "Asked for in a fixer quest.", files: [{ repo: "na", path: "web/notes/notes.css", added: 4, removed: 0 }], diff: "",
      screens: [], consequences: "", assessment: "", risks: ["Touches the toolbar on every page of Notes."], recommendation: { verdict: "approve", reasons: [] }, trivial: false, checks, allPassed: true, offLimits: [],
    }, null),
  ],
  working: [
    job("j3", "preparing", { type: "issue", id: "i3", title: "Board: Partly off the screen: button “Pin (keep it here)” (and at 1 other size)", details: "", kind: "glitch" }, null,
      { severity: "minor", area: "looks", panel: "/board/", panelName: "Board", kind: "offscreen", problem: "Partly off the screen: button “Pin (keep it here)”", where: ["360×740 signed in", "390×844 signed in"] }),
  ],
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };
const SIZES = [
  ["computer-2000", 1960, 950], ["laptop-1440", 1410, 720], ["tablet-800", 784, 1080], ["phone-390", 390, 654], ["phone-360", 360, 560], ["sideways-780", 780, 254],
];

const browser = await chromium.launch();
let bad = 0;
for (const [name, width, height] of SIZES) {
  const touch = width < 800;
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "fixer.local") return route.abort();
    const p = u.pathname;
    // (a panel only opens inside Nova Agent: a bare page that holds it in a frame stands in)
    if (p === "/host.html") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#000"><iframe src="/fixer/" style="border:0;display:block;width:100vw;height:100vh"></iframe></body></html>' });
    if (p === "/fixer-api/state") return route.fulfill({ contentType: "application/json", body: JSON.stringify(STATE) });
    if (p.startsWith("/fixer-api/jobs/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ card: { diff: "diff --git a/web/portal/portal.css\n+  overflow-y: auto;" } }) });
    if (p.startsWith("/actions/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, result: {} }) });
    if (p.startsWith("/fixer-api/shots/")) {
      const f = basename(decodeURIComponent(p)).replace(/^(before|after)-looks-/, "");
      return PICS && pics.includes(f) ? route.fulfill({ contentType: "image/png", body: readFileSync(join(PICS, f)) }) : route.fulfill({ status: 404, body: "" });
    }
    const file = join(WEB, p.endsWith("/") ? `${p}index.html` : p);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: TYPES[extname(file)] || "application/octet-stream", body: readFileSync(file) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  script error: ${e.message}`));
  await page.goto("http://fixer.local/host.html");
  await page.waitForTimeout(400);
  const frame = page.frames().find((f) => f.url().includes("/fixer/"));
  await frame.waitForSelector(".fx-card", { timeout: 15000 });
  await page.waitForTimeout(600);
  const m = await frame.evaluate(() => {
    const se = document.scrollingElement;
    const btn = document.querySelector(".fx-approve");
    const r = btn ? btn.getBoundingClientRect() : null;
    return { scrollH: se.scrollHeight, h: innerHeight, scrollW: se.scrollWidth, w: innerWidth, approve: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null };
  });
  const ok = m.scrollH <= m.h + 1 && m.scrollW <= m.w + 1 && m.approve && m.approve.bottom <= m.h && m.approve.top >= 0;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${width}×${height}: page ${m.scrollW}×${m.scrollH}, Approve ${m.approve ? `${m.approve.top}–${m.approve.bottom}px (${m.approve.h}px tall)` : "missing"}`);
  await page.screenshot({ path: join(OUT, `fixer-${name}.png`) });
  if (name === "laptop-1440") {
    await frame.click('[data-pic="after"]');
    await page.screenshot({ path: join(OUT, `fixer-${name}-after.png`) });
    await frame.click("#deck-next");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `fixer-${name}-next.png`) });
    await frame.click("#deck-next");
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT, `fixer-${name}-preparing.png`) });
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} size(s) failed` : "All sizes fit: no page scrolling, Approve on screen");
process.exit(bad ? 1 : 0);
