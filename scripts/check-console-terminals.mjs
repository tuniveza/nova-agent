// Console's terminals: opened on the studio computer itself (/console/?here=1), + Shell runs a
// command and + VPS reaches the VPSdime server; and online (any other address) the terminals stay
// shut with an "Open Console on this computer" button instead.
//   node scripts/check-console-terminals.mjs http://localhost:4841 [--no-vps]
import { chromium } from "playwright";
const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "http://localhost:4841").replace(/\/$/, "");
const vps = !process.argv.includes("--no-vps");
const results = [];
const ok = (name, pass, extra = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
const b = await chromium.launch();
const textOf = (f, kindIndex) => f.evaluate((i) => { const t = window.NovaConsole.tabs[i].term; const buf = t.buffer.active; const o = []; for (let k = 0; k <= buf.baseY + buf.cursorY; k++) o.push(buf.getLine(k).translateToString(true)); return o.join("\n"); }, kindIndex);
// 1. On this computer
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/console/?here=1", { waitUntil: "domcontentloaded" });
  ok("stays on this computer (no move into Nova Agent online)", new URL(p.url()).pathname === "/console/", p.url());
  await p.waitForFunction(() => window.NovaConsole && window.NovaConsole.tabs.length, null, { timeout: 20000 });
  const enabled = await p.evaluate(() => !document.getElementById("new-shell").disabled && !document.getElementById("new-vps").disabled);
  ok("+ Shell and + VPS can be pressed", enabled);
  await p.click("#new-shell");
  await p.waitForFunction(() => window.NovaConsole.tabs.length >= 2, null, { timeout: 10000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.NovaConsole.tabs[1].input("echo console-shell-ok\r"));
  await p.waitForTimeout(1500);
  ok("+ Shell runs a command", /console-shell-ok\s*$/m.test(await textOf(p, 1)) || /\nconsole-shell-ok/.test(await textOf(p, 1)));
  if (vps) {
    await p.click("#new-vps");
    await p.waitForFunction(() => window.NovaConsole.tabs.length >= 3, null, { timeout: 10000 });
    let host = "";
    for (let i = 0; i < 30 && !/odysi/.test(host); i++) {
      await p.waitForTimeout(700);
      if (i === 6) await p.evaluate(() => window.NovaConsole.tabs[2].input("hostname\r"));
      host = await textOf(p, 2);
    }
    ok("+ VPS reaches the VPSdime server (hostname odysi)", /odysi/.test(host));
    await p.evaluate(() => window.NovaConsole.tabs[2].input("exit\r"));
    await p.waitForTimeout(1200);
  }
  await p.evaluate(() => window.NovaConsole.tabs[1].input("exit\r"));
  await p.waitForTimeout(800);
  ok("no page errors (here)", !errs.length, errs.join(" | "));
  await p.close();
}
// 2. "Online": the same page under another address (as from Nova Bot): terminals shut, a button instead
{
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("http://nova.test/**", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/__wrap") return r.fulfill({ contentType: "text/html", body: '<!doctype html><body style="margin:0"><iframe src="/console/" style="border:0;width:100vw;height:100vh"></iframe>' });
    if (u.pathname === "/console-api/state") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, me: { id: "ana", name: "Ana", role: "admin", online: true }, terminals: false, why: "Terminals only open on the studio computer itself, not online. Nova commands work everywhere.", localUrl: "http://localhost:4545/console/?here=1", open: [] }) });
    const res = await r.fetch({ url: BASE + u.pathname + u.search });
    return r.fulfill({ response: res });
  });
  // (online, Console is a panel inside Nova Agent: a frame)
  await p.goto("http://nova.test/__wrap", { waitUntil: "domcontentloaded" });
  let f = null;
  for (let i = 0; i < 60 && !f; i++) { f = p.frames().find((x) => x.url().includes("/console/")); if (!f) await p.waitForTimeout(250); }
  await f.waitForFunction(() => window.NovaConsole && window.NovaConsole.tabs.length, null, { timeout: 20000 });
  const banner = await f.evaluate(() => { const a = document.querySelector("#note .here"); return a ? [a.textContent, a.href] : null; });
  ok("online: a clear Open Console on this computer button", !!banner && /Open Console on this computer/.test(banner[0]) && /localhost:4545\/console\/\?here=1/.test(banner[1]), banner ? banner.join(" → ") : "none");
  ok("online: + Shell and + VPS shut", await f.evaluate(() => document.getElementById("new-shell").disabled && document.getElementById("new-vps").disabled));
  ok("no page errors (online)", !errs.length, errs.join(" | "));
  await p.close();
}
await b.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
