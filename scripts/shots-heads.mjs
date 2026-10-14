// Every panel inside Nova Agent, live, signed in as a temporary admin (removed at the end): a picture
// at each size, and a list of anything that looks like the panel's own header inside it (a brand or
// logo row, a second planet or gear). Nova Agent's title panel is the only header there should be.
//   node scripts/shots-heads.mjs [out-dir]        (HEADS_SIZES=1440x900,412x915 to choose sizes)
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const URL_ = process.env.HEADS_URL || "https://nova.novacane.co.uk";
const VPS = process.env.HEADS_VPS || "root@185.185.126.195";
const HOST = new URL(URL_).hostname;
const OUT = process.argv[2] || "/tmp/heads";
const ID = "heads-test";
const PANELS = (process.env.HEADS_PANELS || "portal,calendar,notes,board,index,quests,missions,lossless,visualizer,fixer,computer,console,observatory,manual").split(",");
const SIZES = (process.env.HEADS_SIZES || "1440x900,2000x1130,800x1280,412x915").split(",").map((s) => s.split("x").map(Number));

const token = randomBytes(32).toString("base64url");
const sid = createHash("sha256").update(token).digest("base64url");
const D1 = "/srv/nova/state/v3/d1/miniflare-D1DatabaseObject";
const remoteSql = (q) => execFileSync("ssh", [VPS, `db=$(ls ${D1}/*.sqlite | grep -v metadata | head -1); sqlite3 -cmd '.timeout 8000' "$db" "${q.replace(/"/g, '\\"')}"`], { encoding: "utf8" });
function signIn() {
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 30 * 60_000).toISOString();
  remoteSql(`INSERT OR REPLACE INTO staff (id, email, password_hash, display_name, role, status, created_at, planet_seed, index_partition) VALUES ('${ID}', '${ID}@nova.invalid', NULL, 'Header check', 'admin', 'active', '${now}', '${ID}', 'staff:${ID}');` +
    `INSERT INTO sessions (id, staff_id, kind, created_at, expires_at, last_seen_at, user_agent) VALUES ('${sid}', '${ID}', 'cookie', '${now}', '${later}', '${now}', 'header check');`);
}
function signOut() {
  try { remoteSql(`DELETE FROM sessions WHERE staff_id = '${ID}'; DELETE FROM staff WHERE id = '${ID}';`); } catch {}
  try { execFileSync("ssh", [VPS, `rm -f /srv/nova-agent/data/chats/${ID}.json /srv/nova-agent/data/boards/${ID}.json`]); } catch {}
}

// Inside a panel's frame: its own header row, brand marks, planet badges and gears that are showing
const LOOK = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 && r.bottom > 0 && r.top < innerHeight; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className.trim() ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const out = [];
  for (const e of document.querySelectorAll("header.top, header.app-head, header.topbar, .app-header, .site-head, .brand, #brand, .brand-mark, .wordmark, nova-portal-badge, .portal-badge, .planet-btn, [aria-label='Options'], [title='Options'], #options, .settings-btn")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    out.push(`${name(e)} @${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  signIn();
  const report = {};
  const browser = await chromium.launch();
  try {
    for (const [w, h] of SIZES) {
      const touch = w < 900;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: "nova_session", value: token, domain: HOST, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
      for (const p of PANELS) {
        const page = await ctx.newPage();
        try {
          await page.goto(`${URL_}/agent/${p === "index" ? "index" : p}`, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(3500);
          const frame = page.frames().find((f) => f !== page.mainFrame() && f.url() && !f.url().startsWith("about:") && page.mainFrame().childFrames().includes(f) && f.url().includes(HOST));
          let found = [];
          if (frame) { try { found = await frame.evaluate(LOOK); } catch (e) { found = ["(frame not readable: " + e.message.slice(0, 60) + ")"]; } }
          report[`${p} ${w}x${h}`] = found;
          await page.screenshot({ path: `${OUT}/${p}-${w}x${h}.png` });
        } catch (e) {
          report[`${p} ${w}x${h}`] = ["ERROR " + e.message.slice(0, 80)];
        } finally {
          await page.close();
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    signOut();
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(report)) if (v.length) console.log(k, "→", v.join(" | "));
  console.log("pictures in", OUT);
}
main().catch((e) => { signOut(); console.error(e); process.exit(1); });
