// The switch-over to the VPS, the app's side: Computer's "Live now" card (web/portal/desk.js) and
// Portal's quiet new notification address when the server's key changes (web/portal/app.js).
//   node scripts/check-switch.mjs [out-dir]
// Computer is drawn in a real browser with a pretend Portal kit; the notification code is taken from
// app.js as it is and run with a pretend phone.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const OUT = process.argv[2] || "";
const results = [];
const ok = (name, pass, extra = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
const root = new URL("..", import.meta.url).pathname;

// ---- Computer (Portal → Admin): which side is live, the commands, the warnings ----
const here = (over) => ({
  where: "cloudflare",
  url: "https://novacane-worker.novacane-studio.workers.dev",
  live: "cloudflare",
  switchHelp: { to: "vps/switch.sh", back: "vps/switch-back.sh", from: "the studio PC, in nb/novacane-worker" },
  warnings: [],
  pc: { connected: true },
  jobs: [],
  ...over,
});
const vps = { reachable: true, url: "https://185-185-126-195.sslip.io", services: { nova: "active", caddy: "active" }, problems: [] };
const b = await chromium.launch();
for (const [w, h] of [[1280, 820], [390, 844]]) {
  for (const [name, data] of [
    ["cloudflare live", { here: here(), vps, canAct: true }],
    ["vps live, with a warning", { here: here({ where: "vps", live: "vps", warnings: ["Newsletters won't send: the Resend key here is from a Resend account without novacane.co.uk."] }), vps, canAct: true }],
    ["standby VPS", { here: here({ where: "vps", live: "standby" }), vps, canAct: false }],
  ]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.setContent(`<!doctype html><style>${readFileSync(root + "web/portal/desk.css", "utf8")}</style><div class="dk"><div id="desk-body"></div></div>`);
    await p.evaluate((d) => {
      const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined && text !== null) n.textContent = String(text);
        return n;
      };
      window.PortalApp = { view: "desk", kit: { el, api: async () => d, toast() {}, emptyState(box, t) { box.textContent = t; } } };
    }, data);
    await p.addScriptTag({ content: readFileSync(root + "web/portal/desk.js", "utf8") });
    await p.evaluate(() => window.PortalDesk.load());
    await p.waitForSelector(".dk-live");
    const live = await p.textContent(".dk-live");
    const label = `${w} ${name}`;
    if (name === "cloudflare live") ok(`${label}: says Cloudflare, the switch and switch-back commands`, /Live now/.test(live) && /● Cloudflare/.test(live) && /Switch to the VPS\s*vps\/switch\.sh/.test(live) && /vps\/switch-back\.sh/.test(live), live);
    if (name.startsWith("vps live")) ok(`${label}: says the VPS, the way back, the newsletter warning`, /● The VPS/.test(live) && /Go back to Cloudflare\s*vps\/switch-back\.sh/.test(live) && !/switch\.sh\b(?!-)/.test(live.replace("switch-back.sh", "")) && /⚠ Newsletters won't send/.test(live), live);
    if (name === "standby VPS") ok(`${label}: Cloudflare live, this VPS standing by`, /Cloudflare \(this VPS is standing by\)/.test(live), live);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    ok(`${label}: fits the width`, wide);
    if (OUT) await p.screenshot({ path: `${OUT}/desk-${name.split(",")[0].replace(/ /g, "-")}-${w}.png`, fullPage: true });
    ok(`${label}: no page errors`, !errs.length, errs.join(" | "));
    await p.close();
  }
}
await b.close();

// ---- Portal: a new notification address when the server's key changed ----
const app = readFileSync(root + "web/portal/app.js", "utf8");
const take = (start, end) => {
  const i = app.indexOf(start);
  const j = app.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`Can't find ${start} in app.js`);
  return app.slice(i, j);
};
const keyBytesSrc = take("  function keyBytes(text) {", "\n  }\n") + "\n  }\n";
const renewSrc = take("  let pushRenewChecked = false;", "  // ===== Voice commands =====");
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const OLD = new Uint8Array(65).fill(4);
const NEW = new Uint8Array(65).fill(7);

async function phone({ has = OLD, serverKey = NEW, subscribeFails = false, permission = "granted" } = {}) {
  const log = [];
  const address = has && { endpoint: "https://push.example/old", options: { applicationServerKey: has.buffer }, unsubscribe: async () => log.push("unsubscribe old") };
  const reg = {
    pushManager: {
      subscribe: async (o) => {
        if (subscribeFails) throw new Error("needs a tap");
        log.push(`subscribe ${b64(o.applicationServerKey)}`);
        return { toJSON: () => ({ endpoint: "https://push.example/new" }) };
      },
    },
  };
  const scope = {
    canNotify: true,
    Notification: { permission },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    currentAddress: async () => address,
    pushDoorman: async () => reg,
    api: async (path, o) => {
      log.push(`api ${path}${o?.body?.endpoint ? ` ${o.body.endpoint}` : ""}${o?.body?.subscription ? ` ${o.body.subscription.endpoint}` : ""}`);
      return path === "push/key" ? { publicKey: b64(serverKey) } : {};
    },
    toast: (t) => log.push(`toast ${t}`),
    updateNotifyPanel: () => log.push("panel"),
  };
  const run = new Function(...Object.keys(scope), `${keyBytesSrc}\n${renewSrc}\nreturn { renewPushAddress, needed: () => pushRenewNeeded };`)(...Object.values(scope));
  await run.renewPushAddress();
  await run.renewPushAddress(); // only once per opening
  return { log, needed: run.needed() };
}

{
  const { log, needed } = await phone();
  ok("key changed: old address dropped, new one made with the new key and handed over, quietly", log.join(" | ") === `api push/key | api push/unsubscribe https://push.example/old | unsubscribe old | subscribe ${b64(NEW)} | api push/subscribe https://push.example/new | panel` && !needed, log.join(" | "));
}
{
  const { log } = await phone({ serverKey: OLD });
  ok("same key: nothing changes", log.join(" | ") === "api push/key", log.join(" | "));
}
{
  const { log, needed } = await phone({ subscribeFails: true });
  ok("the phone wants a tap: one calm prompt, and the panel says why", needed && log.filter((l) => l.startsWith("toast")).length === 1 && /turning on again/.test(log.join(" ")), log.join(" | "));
}
{
  const { log } = await phone({ has: null });
  ok("no notifications on this phone: nothing asked", log.length === 0, log.join(" | "));
}
{
  const { log } = await phone({ permission: "default" });
  ok("never said Allow: nothing asked", log.length === 0, log.join(" | "));
}

console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
