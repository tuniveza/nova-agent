// The audio lab: renders Nova Agent's music (web/shared/ambient.js) and sound effects
// (web/shared/sfx.js) offline in headless Chromium (OfflineAudioContext: the real Web Audio
// engine, no speakers) and measures them. Used by scripts/audio-levels.mjs and
// test/audio-levels.spec.ts.
//   const lab = await openLab();
//   await lab.music({ seed: "K7M2QX", piece: "keys", seconds: 60 })  // { peakDb, loudestDb, ... }
//   await lab.sound("shimmer", { theme: "notes" })                   // the same for one sound
//   await lab.close();
// inTurns() shares the work between several labs, so long checks run side by side.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const shared = new URL("../web/shared/", import.meta.url);

export async function openLab() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.route("http://nova.test/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><title>lab</title></head><body></body></html>" })
  );
  await page.goto("http://nova.test/");
  for (const file of ["sfx.js", "ambient.js"]) await page.addScriptTag({ content: readFileSync(new URL(file, shared), "utf8") });
  return {
    errors,
    music: (o) => page.evaluate((opts) => window.NovaAmbient._render(opts), o),
    sound: (name, o = {}) => page.evaluate(([n, opts]) => window.NovaSfx._render(n, opts), [name, o]),
    names: () => page.evaluate(() => ({ pieces: window.NovaAmbient.pieces.map((p) => p.id), ...window.NovaSfx._names() })),
    close: () => browser.close(),
  };
}

// Runs fn(item, worker) for every item with at most `workers` running at once (worker is
// 0..workers-1, each busy with one item at a time); the results come back in the items' order.
//   await inTurns(seeds, labs.length, (seed, w) => labs[w].music({ seed, piece }))
export async function inTurns(items, workers, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async (w) => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], w);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, (_, w) => worker(w)));
  return out;
}
