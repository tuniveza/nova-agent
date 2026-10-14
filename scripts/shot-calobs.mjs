// Screenshots of Calendar and Observatory at phone and computer sizes, with ordinary sample cards
// (Calendar's come from Nova Bot, so they're answered here), each in a full-window frame as Nova Agent shows it. For looking at icons and layout.
//   node scripts/shot-calobs.mjs http://localhost:4731 /some/folder [--only calendar|observatory]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [BASE = "http://localhost:4731", OUT = "/tmp/shots"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
mkdirSync(OUT, { recursive: true });
const today = new Date();
const at = (n, hh) => { const d = new Date(today); d.setDate(d.getDate() + n); return `${d.toISOString().slice(0, 10)}T${hh}`; };
const now = new Date().toISOString();
const TITLES = ["Vocal recording", "Mix review", "Guitar lesson", "Team meeting", "Gym", "Lunch with Sam", "Flight to Berlin", "Call the label", "Write lyrics", "Video shoot", "Read contracts", "Email replies", "Mum's birthday", "Anniversary dinner", "Something else"];
const items = {
  rev: 1,
  items: [
    ...TITLES.map((t, i) => ({ id: `e${i}`, kind: "event", title: t, start: at((i % 9) - 3, `${String(9 + (i % 5) * 2).padStart(2, "0")}:00`), end: at((i % 9) - 3, `${String(10 + (i % 5) * 2).padStart(2, "0")}:00`), notes: "", color: ["violet", "teal", "pink", "gold"][i % 4], updated: now })),
    { id: "d1", kind: "day", title: "Release Day", preset: "release", date: at(2, "00:00").slice(0, 10), updated: now },
    { id: "d2", kind: "day", title: "Halloween", preset: "halloween", date: at(5, "00:00").slice(0, 10), updated: now },
  ],
};
const browser = await chromium.launch();
for (const [w, h] of (process.env.SIZES || "390x844,1280x800,1920x1080").split(",").map((s) => s.split("x").map(Number))) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const tab = await ctx.newPage();
  await ctx.route(/\/__shot\.html/, (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;width:100%;height:100%;display:block}</style><iframe src="${new URL(r.request().url()).searchParams.get("src")}"></iframe>` }));
  await ctx.route(/\/app\/api\/calendar\/items/, (r) => r.fulfill({ contentType: "application/json", body: r.request().method() === "GET" ? JSON.stringify(items) : "{}" }));
  const pages = [["calendar", "/calendar/", ["month", "week", "list"]], ["observatory", "/observatory/", [""]]];
  for (const [name, path, views] of pages) {
    if (only && only !== name) continue;
    for (const v of views) {
      await tab.goto(`${BASE}/__shot.html?src=${encodeURIComponent(path)}`, { waitUntil: "networkidle" }).catch(() => {});
      const f = tab.frames()[1] || tab.mainFrame();
      if (v) await f.click(`[data-view="${v}"]`).catch(() => {});
      await tab.waitForTimeout(1200).catch(() => {});
      await tab.screenshot({ path: `${OUT}/${name}${v ? "-" + v : ""}-${w}x${h}.png` });
      const scroll = await f.evaluate(() => { const s = document.scrollingElement; const d = document.querySelector('#decks'); return `${s.scrollHeight}/${innerHeight}${d ? ` · decks ${d.scrollHeight}/${d.clientHeight}` : ''}`; });
      console.log(`${name}${v ? " " + v : ""} ${w}x${h}: page height ${scroll}`);
    }
  }
  await ctx.close();
}
await browser.close();
