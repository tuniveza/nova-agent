// Console's click-through check: help, status, quests list, a confirm-required command (cancelled),
// and (on localhost, as an admin) a shell tab running `echo hi`.
//   node scripts/check-console.mjs http://localhost:4831 [out-dir]
import { chromium } from "playwright";
const BASE = (process.argv[2] || "http://localhost:4831").replace(/\/$/, "");
const OUT = process.argv[3] || "";
const b = await chromium.launch();
const results = [];
const ok = (name, pass, extra = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
for (const [w, h] of [[1280, 820], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/agent/?open=%2Fconsole%2F", { waitUntil: "domcontentloaded" });
  let f = null;
  for (let i = 0; i < 40 && !f; i++) {
    f = p.frames().find((x) => x.url().includes("/console/"));
    if (!f) await p.waitForTimeout(250);
  }
  await f.waitForSelector(".xterm", { timeout: 20000 });
  await f.waitForFunction(() => window.NovaConsole && window.NovaConsole.tabs.length, null, { timeout: 20000 });
  // (everything printed so far, not just what's on screen: help is longer than the screen now)
  const text = () => f.evaluate(() => { const t = (window.NovaConsole.tabs.find((x) => !x.screen.hidden) || window.NovaConsole.tabs[0]).term; const buf = t.buffer.active; const o = []; for (let i = 0; i <= buf.baseY + buf.cursorY; i++) o.push(buf.getLine(i).translateToString(true)); return o.join("\n"); });
  const type = async (line, wait = 900) => {
    await f.evaluate((l) => window.NovaConsole.type(l), line);
    await p.waitForTimeout(wait);
  };
  await type("help\r");
  ok(`${w} help lists commands`, /quests/.test(await text()) && /portal/.test(await text()));
  await type("status\r", 1500);
  ok(`${w} status`, /Agent|Studio PC/.test(await text()));
  await type("quests add \"Console check quest\" --minutes 15\r", 1500);
  await type("quests list\r", 1200);
  ok(`${w} quests add + list`, /Console check quest/.test(await text()));
  await type("approve campaign 12\r", 1500);
  const asked = /Type 12 to approve/.test(await text()) || /admins/.test(await text());
  await type("no\r", 1000);
  ok(`${w} approve asks first, then cancels`, asked && /Cancelled|admins|Sign in|isn't here|offline|went wrong/i.test(await text()));
  await type("nonsense\r", 600);
  ok(`${w} unknown command explained`, /There's no "nonsense"/.test(await text()));
  if (w === 1280) {
    const state = await f.evaluate(() => fetch("/console-api/state", { headers: { "X-Nova-Visualizer": "1" } }).then((r) => r.json()));
    if (state.terminals) {
      await f.evaluate(() => window.NovaConsole.openTerminal("shell"));
      await p.waitForTimeout(1500);
      await f.evaluate(() => window.NovaConsole.tabs.at(-1).input("echo hi-from-console\r"));
      await p.waitForTimeout(1500);
      ok("shell tab runs echo", /hi-from-console\s*\n/.test(await text()) || (await text()).split("hi-from-console").length > 2);
    } else ok("shell tab (terminals not allowed here: " + state.why + ")", false);
  }
  if (OUT) await p.screenshot({ path: `${OUT}/console-${w}.png` });
  ok(`${w} no page errors`, !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
