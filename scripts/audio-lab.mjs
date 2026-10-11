// The audio lab: renders Nova Agent's music (web/shared/ambient.js) and sound effects
// (web/shared/sfx.js) offline in headless Chromium (OfflineAudioContext: the real Web Audio
// engine, no speakers) and measures them. Used by scripts/audio-levels.mjs and
// test/audio-levels.spec.ts.
//   const lab = await openLab();
//   await lab.music({ seed: "K7M2QX", piece: "keys", seconds: 60 })  // { peakDb, loudestDb, ... }
//   await lab.sound("shimmer", { theme: "notes" })                   // the same for one sound
//   await lab.close();
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
