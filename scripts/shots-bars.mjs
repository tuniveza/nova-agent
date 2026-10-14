// Screenshots of Nova Agent's home and each panel opened inside it, at a computer and a phone size,
// to compare the panels' top bars and the panels bar along the bottom by eye.
//   node scripts/shots-bars.mjs http://localhost:4721 /some/folder [--only portal,notes] [--sizes 1440x900,390x844]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { portalMock } from "./check-fit-portal-samples.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : ""; };
const BASE = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4721").replace(/\/$/, "");
const OUT = args.find((a) => a.startsWith("/")) || "/tmp/bars-shots";
const ONLY = opt("only") ? opt("only").split(",") : null;
const SIZES = (opt("sizes") || "1440x900,390x844").split(",").map((s) => s.split("x").map(Number));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PANELS = {
  home: "", portal: "/portal/", calendar: "/calendar/", notes: "/notes/", quests: "/quests/", board: "/board/", console: "/console/",
  index: "/app/memory/", observatory: "/observatory/", fixer: "/fixer/", lossless: "/lossless/", visualizer: "/visualizer",
};
const browser = await chromium.launch();
for (const [w, h] of SIZES) {
  for (const [name, path] of Object.entries(PANELS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const tab = await ctx.newPage();
    await tab.route(/\/(app\/api|auth|staff|tidy-api)\b/, (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith("/app/memory")) return r.fallback();
      const body = portalMock(u.pathname + u.search, r.request().method());
      return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fallback();
    });
    await tab.goto(`${BASE}/agent/${path ? "?open=" + encodeURIComponent(path) : ""}`, { waitUntil: "domcontentloaded" });
    await sleep(path ? 3500 : 2500);
    await tab.screenshot({ path: `${OUT}/${name}-${w}x${h}.png` });
    await ctx.close();
  }
}
await browser.close();
console.log(`shots in ${OUT}`);
