// Board's Welcome board and its media, on a throwaway Nova Agent (see scripts/check-fit.mjs's
// header for starting one): the first open shows the Welcome board with its banner, the video
// plays, the picture shows, the sound is ready; then each of the three choices does what it says.
// A big file dropped on the table is kept whole and a part of it can be asked for (Range).
//   BOARD_DATA=<the throwaway's data folder> node scripts/check-board-welcome.mjs [http://localhost:4821] [shots folder]
import { chromium } from "playwright";
import { rmSync, existsSync } from "node:fs";
const B = (process.argv[2] || "http://localhost:4821").replace(/\/$/, "");
const SHOTS = process.argv[3] || "";
const DATA = process.env.BOARD_DATA || "";
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed++; };
const b = await chromium.launch();

async function open(fresh = true) {
  if (fresh && DATA && existsSync(`${DATA}boards`)) rmSync(`${DATA}boards`, { recursive: true, force: true });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/agent/?open=%2Fboard%2F", { waitUntil: "domcontentloaded" });
  let f;
  for (let i = 0; i < 40 && !(f = p.frames().find((x) => x.url().includes("/board/"))); i++) await p.waitForTimeout(250);
  await f.waitForSelector(".card", { timeout: 15000 });
  await p.waitForTimeout(2500);
  return { ctx, p, f, errs };
}

{
  const { ctx, p, f, errs } = await open();
  const s = await f.evaluate(() => ({
    banner: !document.getElementById("welcome-bar").hidden,
    name: document.getElementById("board-pick").selectedOptions[0]?.textContent,
    cards: document.querySelectorAll(".card").length,
    video: (() => { const v = document.querySelector(".media-video video"); return v ? { ready: v.readyState, playing: !v.paused, w: v.videoWidth } : null; })(),
    img: (() => { const i = document.querySelector(".k-image img"); return i ? i.naturalWidth : 0; })(),
    audio: (() => { const a = document.querySelector(".media-audio audio"); return a ? a.readyState : -1; })(),
    loading: document.querySelectorAll(".media.is-loading").length,
    failedMedia: document.querySelectorAll(".media.is-failed").length,
    hints: document.querySelectorAll(".hint-text").length,
    pinned: document.querySelectorAll(".card.pinned").length,
    inView: (() => { const t = document.getElementById("table").getBoundingClientRect(); return [...document.querySelectorAll(".card")].filter((c) => { const r = c.getBoundingClientRect(); return r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom; }).length; })(),
  }));
  check(s.banner && s.name === "Welcome", "first open: the Welcome board, with its banner");
  check(s.cards >= 14, `its cards are laid out (${s.cards})`);
  check(s.video && s.video.w > 0 && s.video.ready >= 2, `the video is there and ${s.video && s.video.playing ? "playing" : "ready"}`);
  check(s.img > 0, "the picture shows");
  check(s.audio >= 1, "the sound is ready to play");
  check(s.loading === 0 && s.failedMedia === 0, "nothing is stuck loading or broken");
  check(s.hints >= 3 && s.pinned >= 1, "hint labels and a pinned card");
  check(s.inView === s.cards, `everything is in view (${s.inView} of ${s.cards})`);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/board-welcome.png` });
  // "Keep as is": the banner goes, the cards stay, and it doesn't come back
  await f.click("#welcome-keep");
  await p.waitForTimeout(1500);
  check(await f.evaluate(() => document.getElementById("welcome-bar").hidden && document.querySelectorAll(".card").length >= 14), "Keep as is: the banner goes, everything stays");
  check(errs.length === 0, `no page errors${errs.length ? ": " + errs[0] : ""}`);
  await ctx.close();
  const again = await open(false);
  check(await again.f.evaluate(() => document.getElementById("welcome-bar").hidden), "…and it isn't offered again");
  await again.ctx.close();
}
{
  const { ctx, p, f } = await open();
  await f.click("#welcome-clear");
  await p.waitForTimeout(1500);
  const s = await f.evaluate(() => ({ cards: document.querySelectorAll(".card").length, banner: !document.getElementById("welcome-bar").hidden, name: document.getElementById("board-pick").selectedOptions[0]?.textContent }));
  check(s.cards === 0 && !s.banner && s.name === "My board", "Clear it and start: an empty table called My board");
  await ctx.close();
}
{
  const { ctx, p, f } = await open();
  await f.click("#welcome-new");
  await p.waitForTimeout(1500);
  const s = await f.evaluate(() => ({ boards: [...document.getElementById("board-pick").options].map((o) => o.textContent), now: document.getElementById("board-pick").selectedOptions[0]?.textContent, cards: document.querySelectorAll(".card").length }));
  check(s.boards.includes("Welcome") && s.now !== "Welcome" && s.cards === 0, `Keep it, start a new board: on "${s.now}", with Welcome kept`);
  // A 6 MB video dropped on the table: kept whole, plays, and a part of it can be asked for
  const size = 6 * 1024 * 1024;
  const up = await f.evaluate(async (size) => {
    const bytes = new Uint8Array(size);
    bytes.set(new TextEncoder().encode("\0\0\0\x18ftypisom"), 0);
    for (let i = 16; i < size; i += 4096) bytes[i] = i & 255;
    const r = await fetch("/actions/board-files?name=big.mp4", { method: "POST", headers: { "X-Nova-Visualizer": "1", "Content-Type": "video/mp4" }, body: bytes });
    const d = await r.json();
    const whole = await (await fetch(`/board-files/${d.file.id}`)).arrayBuffer();
    const part = await fetch(`/board-files/${d.file.id}`, { headers: { Range: "bytes=4096-8191" } });
    const pb = new Uint8Array(await part.arrayBuffer());
    return { ok: d.ok, size: whole.byteLength, partStatus: part.status, partLen: pb.length, first: pb[0], range: part.headers.get("content-range") };
  }, size);
  check(up.ok && up.size === size, `a 6 MB video is kept whole (${up.size} bytes)`);
  check(up.partStatus === 206 && up.partLen === 4096 && up.first === (4096 & 255) && up.range === `bytes 4096-8191/${size}`, "and a part of it comes back on request (Range)");
  const limits = await f.evaluate(async () => (await (await fetch("/board-api/limits")).json()).max);
  check(limits === "500 MB", `on the studio computer itself, up to ${limits}`);
  await ctx.close();
}
await b.close();
console.log(failed ? `${failed} problem(s)` : "All good");
process.exit(failed ? 1 : 0);
