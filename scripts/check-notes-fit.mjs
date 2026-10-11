// Notes: the page always fits the screen, and only what's written on it moves.
// Opens Notes (on its own in a full-window frame, and inside Nova Agent) at phone, tablet and
// desktop sizes with a long note (a long name, many paragraphs, a wide table, long code and a long
// link), opens the side panels, and checks: nothing hangs off the side or the bottom, the window
// never scrolls, the page itself stays put, and its writing scrolls inside it.
//
//   npm run visualizer            (or any Nova Agent server; a throwaway one is fine)
//   node scripts/check-notes-fit.mjs [http://localhost:4632]
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:4632").replace(/\/$/, "");
const SIZES = [[360, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]];
const row = (cell) => `<tr>${Array.from({ length: 9 }, (_, j) => `<${cell}>Column ${j + 1}</${cell}>`).join("")}</tr>`;
const NOTE = `<h1 class="title">A long note</h1><h2>Section</h2>`
  + `<p>https://example.com/a/really/long/link/with/no/spaces/at/all/0123456789abcdefghijklmnopqrstuvwxyz0123456789</p>`
  + `<table><tbody>${row("th")}${row("td")}${row("td")}</tbody></table>`
  + `<pre><code>const aVeryLongLineOfCode = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);</code></pre>`
  + Array.from({ length: 50 }, (_, i) => `<p>Paragraph ${i + 1}: the quick brown fox jumps over the lazy dog among the stars.</p>`).join("");
const TITLE = "A really very long note name that keeps on going well past the edge of any phone screen";
const FRAME = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style><iframe src="/notes/"></iframe>`;

// Run inside the Notes frame: what sticks out, and whether anything but the page's writing scrolls
function inspect() {
  const bad = [];
  const se = document.scrollingElement;
  if (se.scrollWidth > innerWidth + 1) bad.push(`window is ${se.scrollWidth}px wide in ${innerWidth}px`);
  if (se.scrollHeight > innerHeight + 1) bad.push(`window is ${se.scrollHeight}px tall in ${innerHeight}px`);
  scrollTo(0, 99999);
  if (scrollY) bad.push(`the window scrolled by ${scrollY}px`);
  scrollTo(0, 0);
  for (const sel of [".topbar", ".toolbar", ".workspace", ".desk", ".page", ".library", ".outline", ".statusbar"]) {
    const el = document.querySelector(sel);
    if (!el || getComputedStyle(el).display === "none" || getComputedStyle(el).visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0) continue; // the notes list, tucked away to the left until it's opened
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${sel} sticks out (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
  }
  const desk = document.getElementById("desk");
  const page = document.getElementById("editor");
  if (desk.scrollHeight > desk.clientHeight + 1 || desk.scrollWidth > desk.clientWidth + 1) bad.push("the page itself would scroll (it should stay put)");
  if (page.scrollHeight <= page.clientHeight) bad.push("the long note doesn't scroll inside the page");
  const before = page.getBoundingClientRect().top;
  page.scrollTop = 1200;
  if (!page.scrollTop) bad.push("the page's writing didn't scroll");
  if (Math.abs(page.getBoundingClientRect().top - before) > 0.5) bad.push("the page moved when its writing scrolled");
  page.scrollTop = 0;
  const box = page.getBoundingClientRect();
  for (const el of page.querySelectorAll("table, pre, img, p")) {
    const r = el.getBoundingClientRect();
    if (r.right > box.right + 1 || r.left < box.left - 1) { bad.push(`a ${el.tagName.toLowerCase()} is wider than the page`); break; }
  }
  return bad;
}

const browser = await chromium.launch();
let failures = 0;
for (const where of ["on its own", "in Nova Agent"]) {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
    const tab = await ctx.newPage();
    await tab.route(`${BASE}/__notes-fit.html`, (r) => r.fulfill({ contentType: "text/html", body: FRAME }));
    await tab.goto(where === "on its own" ? `${BASE}/__notes-fit.html` : `${BASE}/agent/?open=${encodeURIComponent("/notes/")}`);
    let notes;
    for (let i = 0; i < 50 && !(notes = tab.frames().find((f) => f.url().includes("/notes/"))); i++) await tab.waitForTimeout(200);
    if (!notes) { console.log(`✗ ${where} ${w}×${h}: Notes didn't open`); failures++; await ctx.close(); continue; }
    await notes.waitForSelector("#editor");
    await tab.waitForTimeout(800);
    await notes.fill("#doc-title", TITLE);
    await notes.evaluate((html) => { const ed = document.getElementById("editor"); ed.innerHTML = html; ed.dispatchEvent(new Event("input", { bubbles: true })); }, NOTE);
    for (const panel of ["", "show-library", "show-outline"]) {
      await notes.evaluate((p) => { const s = document.getElementById("shell"); s.classList.remove("show-library", "show-outline", "no-outline"); if (p) s.classList.add(p); }, panel);
      await tab.waitForTimeout(700);
      const bad = await notes.evaluate(inspect);
      const label = `${where} ${w}×${h}${panel ? ` (${panel.replace("show-", "")} open)` : ""}`;
      if (bad.length) { failures++; console.log(`✗ ${label}: ${bad.join("; ")}`); } else console.log(`✓ ${label}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}` : "\nNotes fits everywhere");
process.exit(failures ? 1 : 0);
