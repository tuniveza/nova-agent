// Console: run every command (Nova Bot's answers stood in for by the Portal samples) and report
// each one's output, so nothing can quietly break.
//   node scripts/check-console-commands.mjs http://localhost:4841 [--only name,name]
import { chromium } from "playwright";
import { portalMock } from "./check-fit-portal-samples.mjs";
const BASE = (process.argv.find((a) => /^https?:/.test(a)) || "http://localhost:4841").replace(/\/$/, "");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
export const LINES = [
  "help", "help quests", "status", "now", "plans", "today", "whoami", "version", "history",
  "quests", "quests list", "quests list --all", "missions", "missions list",
  "calendar today", "calendar week", "notes", "notes list", "board", "board list",
  "portal enquiries", "portal chats", "portal clients", "portal money", "portal campaigns", "portal outreach", "portal social", "portal approvals", "portal tests", "portal alerts",
  "enquiries", "clients", "money", "campaigns", "social", "approvals",
  "google", "google status", "fixer", "fixer jobs", "lossless status", "computer", "desk", "deploy status",
  "music", "theme list", "index search studio", "search studio", "logs 5", "admin crew", "vps show",
  "nonsense", "quets list",
];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.route(/\/(app\/api|auth|staff)\b/, (r) => {
  const u = new URL(r.request().url());
  const body = portalMock(u.pathname + u.search, r.request().method());
  return body ? r.fulfill({ contentType: "application/json", body: JSON.stringify(body) }) : r.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Not in the samples"}' });
});
await p.goto(BASE + "/agent/?open=%2Fconsole%2F", { waitUntil: "domcontentloaded" });
let f = null;
for (let i = 0; i < 60 && !f; i++) { f = p.frames().find((x) => x.url().includes("/console/")); if (!f) await p.waitForTimeout(250); }
await f.waitForFunction(() => window.NovaConsole && window.NovaConsole.tabs.length, null, { timeout: 20000 });
const dump = () => f.evaluate(() => { const t = window.NovaConsole.tabs.find((x) => x.kind === "nova").term; const buf = t.buffer.active; const out = []; for (let i = 0; i <= buf.baseY + buf.cursorY; i++) out.push(buf.getLine(i).translateToString(true)); return out; });
let seen = (await dump()).length;
const results = [];
for (const line of only.length ? LINES.filter((l) => only.includes(l.split(" ")[0])) : LINES) {
  const before = (await dump()).length;
  await f.evaluate((l) => window.NovaConsole.type(l + "\r"), line);
  // wait until a new prompt appears after the output
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(150); const d = await dump(); const tail = d.slice(before).join("\n"); if (/nova ›\s*$/.test(d.filter((x) => x.trim()).pop() || "") && d.length > before) break; }
  const d = await dump();
  const out = d.slice(Math.max(0, before - 1)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const bad = /went wrong|isn't here|is not a function|undefined|null|NaN|\[object Object\]|TypeError|Cannot read/i.test(out) && !/^nonsense|^quets/.test(line);
  results.push({ line, bad, out: out.split("\n").slice(0, 14).join("\n") });
}
for (const r of results) console.log(`\n===== ${r.bad ? "FAIL" : "ok  "} ${r.line}\n${r.out}`);
console.log(`\n${results.filter((r) => r.bad).length} looked wrong of ${results.length}; page errors: ${errs.length ? errs.join(" | ") : "none"}`);
await b.close();
