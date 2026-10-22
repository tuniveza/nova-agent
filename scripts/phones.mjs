// Nova suite on real phone emulation (22 Oct 2026, the user: "implement an iphone webpage emulation, android
// webpage emulation so I can see what it looks like on various phones for real"). Each phone opens as its
// own window on this computer, working (tap with the mouse, type, open panels), in that phone's own
// browser engine: iPhones in WebKit (Safari's engine), Androids in Chromium (Chrome's). Each has that
// phone's real screen as its browser shows it (with the browser's own bars taken off), its pixel density,
// its user agent and touch, from Playwright's device list. Your sign-in is kept per phone between runs
// (~/.local/share/nova-phones/<phone>).
//
//   node scripts/phones.mjs                    iPhone 17 and Pixel 10
//   node scripts/phones.mjs all                every phone below
//   node scripts/phones.mjs "iPhone SE" "Galaxy S24"   the ones named
//   node scripts/phones.mjs --side ...         on their sides
//   node scripts/phones.mjs --url /portal/ ... another place (default /agent/)
//   node scripts/phones.mjs --list             the phones it knows
import { devices, webkit, chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = "https://nova.novacane.co.uk";
const PHONES = [
  // iPhones (WebKit): the smallest still in use up to the biggest
  "iPhone SE (3rd gen)", "iPhone 13 Mini", "iPhone 15", "iPhone 16 Pro", "iPhone 17", "iPhone Air", "iPhone 17 Pro Max",
  // Androids (Chromium): Pixels, Samsungs, and the folding ones (open and their small cover screen)
  "Pixel 8a", "Pixel 10", "Pixel 9 Pro XL", "Galaxy S24", "Galaxy A55", "Galaxy Z Flip 7", "Galaxy Z Fold 7", "Galaxy Z Fold 7 Cover",
];
const args = process.argv.slice(2);
if (args.includes("--list")) {
  for (const n of PHONES) {
    const d = devices[n];
    console.log(`${n.padEnd(18)} ${d.viewport.width} × ${d.viewport.height}  ×${d.deviceScaleFactor}  ${d.defaultBrowserType === "webkit" ? "Safari engine" : "Chrome engine"}`);
  }
  process.exit(0);
}
const side = args.includes("--side");
const ui = args.indexOf("--url");
const path = ui >= 0 ? args[ui + 1] : "/agent/";
const named = args.filter((a, i) => !a.startsWith("--") && !(ui >= 0 && i === ui + 1));
const pick = named.includes("all") ? PHONES : named.length ? named : ["iPhone 17", "Pixel 10"];
for (const n of pick) if (!devices[n]) { console.error(`Don't know "${n}". Try --list.`); process.exit(1); }

const open = [];
let warned = false;
for (const name of pick) {
  const base = devices[side ? `${name} landscape` : name] || devices[name];
  const engine = base.defaultBrowserType === "webkit" ? webkit : chromium;
  const dir = join(homedir(), ".local/share/nova-phones", name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + (side ? "-side" : ""));
  mkdirSync(dir, { recursive: true });
  const { defaultBrowserType, ...opts } = base;
  const launch = (eng) => eng.launchPersistentContext(dir + (eng === engine ? "" : "-chrome"), {
    ...opts,
    headless: false,
    // (the window's own title names the phone, so you can tell them apart)
    args: eng === chromium ? [`--window-name=${name}${side ? " (on its side)" : ""}`] : [],
  });
  // (Safari's engine needs a few system libraries this laptop may not have; without them an iPhone runs in
  // Chrome's engine instead, with the iPhone's screen, pixel density, user agent and touch all the same)
  let ctx, used = engine;
  try { ctx = await launch(engine); }
  catch (err) {
    if (engine !== webkit) throw err;
    used = chromium;
    ctx = await launch(chromium);
    if (!warned) { warned = true; console.log("(Safari's engine isn't installed on this computer: iPhones use Chrome's engine with everything else the iPhone's)"); }
  }
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + path).catch((e) => console.error(`${name}: ${e.message.split("\n")[0]}`));
  await page.evaluate((t) => { document.title = t + " · " + document.title; }, name).catch(() => {});
  console.log(`${name}${side ? " (on its side)" : ""}: open (${base.viewport.width} × ${base.viewport.height}, ${used === webkit ? "Safari engine" : "Chrome engine"})`);
  open.push(ctx);
  ctx.on("close", () => { if (open.every((c) => c.pages().length === 0)) process.exit(0); });
}
console.log("Close the phone windows (or press Ctrl+C here) when you're done.");
