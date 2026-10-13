// Board, clicked through in a real browser (Playwright): every card type from the Add menu, Ask Agent
// (answered by a stand-in), a card dragged, pinned (then it can't move) and unpinned, the table zoomed and
// moved, text pasted and a picture dropped, the drawer's calendar and Agent lists, and a reload with the
// browser's copy cleared (everything comes back from the studio computer in the same places).
// Against a throwaway server (see scripts/check-fit.mjs's header), on port 4811:
//   node scripts/check-board.mjs <folder for a screenshot>
import { chromium } from "playwright";
const B = "http://localhost:4811";
const out = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("page: " + e.message));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("console: " + m.text().slice(0, 160)));
await p.route("**/actions/chat", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, reply: "Here's the plan:\n\n- **Record** on Thursday\n- Mix on Friday\n\nSee https://novacane.co.uk", actions: [] }) }));
await p.goto(B + "/agent/?open=%2Fboard%2F", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const f = p.frames().find((x) => x.url().includes("/board/"));
const log = (...a) => console.log(...a);
log("frame:", f ? f.url().replace(B, "") : "none");
const count = () => f.evaluate(() => document.querySelectorAll(".card").length);
await f.click("#board-new");
await p.waitForTimeout(400);
const add = async (sel) => { await f.click("#add"); await f.click(sel); await p.waitForTimeout(300); };
await add('[data-add="question"]');
await add('[data-add="sticky"]');
await add('[data-add="text"]');
await add('[data-add="agent"]');
await add('[data-add="calendar"][data-span="week"]');
await add('[data-add="calendar"][data-span="month"]');
await add('[data-add="calendar"][data-span="year"]');
await add('[data-add="calendar"][data-span="day"]');
log("cards after add menu:", await count());
// Ask Agent
const agent = await f.$(".card.k-agent textarea");
await agent.fill("What's next for the studio?");
await f.click(".card.k-agent .ask-btn");
await p.waitForTimeout(800);
log("agent answer:", (await f.textContent(".card.k-agent .answer")).slice(0, 60));
// Type into the question card
await f.fill(".card.k-question textarea >> nth=0", "When do we release the EP?");
// Drag the sticky
const sticky = await f.$(".card.k-sticky");
const before = await sticky.boundingBox();
await p.mouse.move(before.x + 40, before.y + 12);
await p.mouse.down();
await p.mouse.move(before.x + 240, before.y + 112, { steps: 8 });
await p.mouse.up();
const after = await sticky.boundingBox();
log("sticky moved by:", Math.round(after.x - before.x), Math.round(after.y - before.y));
// Pin it, try to drag, unpin
await f.click(".card.k-sticky .pin-btn");
const sticky2 = await f.$(".card.k-sticky");
const b2 = await sticky2.boundingBox();
await p.mouse.move(b2.x + 40, b2.y + 40);
await p.mouse.down();
await p.mouse.move(b2.x + 300, b2.y + 300, { steps: 8 });
await p.mouse.up();
const b3 = await sticky2.boundingBox();
log("pinned moved by:", Math.round(b3.x - b2.x), Math.round(b3.y - b2.y), "pinned class:", await sticky2.evaluate((n) => n.classList.contains("pinned")));
await f.click(".card.k-sticky .pin-btn");
log("unpinned:", !(await f.$eval(".card.k-sticky", (n) => n.classList.contains("pinned"))));
// Pan and zoom
const tb = await f.$("#table");
const tbb = await tb.boundingBox();
const z0 = await f.textContent("#zoom-reset");
await p.mouse.move(tbb.x + 20, tbb.y + tbb.height - 20);
await p.mouse.wheel(0, -400);
await p.waitForTimeout(200);
log("zoom:", z0, "→", await f.textContent("#zoom-reset"));
const v0 = await f.evaluate(() => ({ ...window.NovaBoard.current().view }));
await p.mouse.move(tbb.x + 10, tbb.y + tbb.height - 10);
await p.mouse.down();
await p.mouse.move(tbb.x + 110, tbb.y + tbb.height - 60, { steps: 6 });
await p.mouse.up();
const v1 = await f.evaluate(() => ({ ...window.NovaBoard.current().view }));
log("panned:", Math.round(v1.x - v0.x), Math.round(v1.y - v0.y));
// Paste text, drop an image file
await f.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "A pasted thought");
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
});
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
await f.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "dot.png", { type: "image/png" }));
  const t = document.getElementById("table");
  const r = t.getBoundingClientRect();
  t.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true }));
}, png.toString("base64"));
await p.waitForTimeout(1500);
log("text card:", await f.evaluate(() => [...document.querySelectorAll(".card.k-text textarea")].map((t) => t.value)));
log("image card:", await f.evaluate(() => { const i = document.querySelector(".card.k-image img"); return i ? [i.getAttribute("src"), i.naturalWidth] : null; }));
// The drawer: calendar spans and Agent history
await f.click("#drawer-btn");
await f.click('[role="tab"][data-pane="calendar"]');
await p.waitForTimeout(300);
log("calendar spans:", await f.evaluate(() => document.querySelectorAll("#cal-list li").length));
await f.click("#cal-list li >> nth=2");
await f.click('[role="tab"][data-pane="agent"]');
await p.waitForTimeout(600);
log("agent list:", await f.evaluate(() => [...document.querySelectorAll("#agent-list li")].map((l) => l.textContent.slice(0, 40))));

await p.screenshot({ path: `${out}/board-1400-page.png` });
const n = await count();
const boardId = await f.evaluate(() => window.NovaBoard.current().id);
const saved = await f.evaluate(() => window.NovaBoard.current().cards.map((c) => [c.kind, Math.round(c.x), Math.round(c.y)]));
await p.waitForTimeout(2500);
// Reload: everything kept (from the PC, not just the browser)
await f.evaluate(() => localStorage.removeItem("nova-board-v1"));
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(4500);
const f2 = p.frames().find((x) => x.url().includes("/board/"));
log("same board after reload:", (await f2.evaluate(() => window.NovaBoard.current().id)) === boardId);
const again = await f2.evaluate(() => window.NovaBoard.current().cards.map((c) => [c.kind, Math.round(c.x), Math.round(c.y)]));
log("cards before/after reload:", n, again.length, "same places:", JSON.stringify(saved.sort()) === JSON.stringify(again.sort()));
log("errors:", errs.length ? errs : "none");
await b.close();
