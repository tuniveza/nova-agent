// Measures Nova Agent's music and sound effects offline (headless Chromium, OfflineAudioContext)
// across many random seeds, and checks the calm rules: the loudest moments around −27 dBFS or
// lower at the default music volume, nothing near clipping even at full volume, and the gentle
// extras far quieter than that.
//   node scripts/audio-levels.mjs [seeds=12] [seconds=40]
// Exits with 1 if anything breaks the rules. The music renders run side by side in a few
// browsers (one per spare processor, up to 4), so the whole check stays well under the Fixer's
// 20-minute limit; on a slow machine, music renders not started within 15 minutes are skipped
// (and counted in the report) rather than the whole check being stopped.
import { availableParallelism } from "node:os";
import { inTurns, openLab } from "./audio-lab.mjs";

const SEEDS = Number(process.argv[2] || 12);
const SECONDS = Number(process.argv[3] || 40);
const WORKERS = Math.max(1, Math.min(4, availableParallelism() - 1));
const MUSIC_PEAK = -26.5; // dBFS at the default volume (40): "around −27 or lower"
const FULL_GAIN_DB = 20 * Math.log10(1 / 0.4); // from the default volume to full volume
const EXTRA_PEAK = -36; // dBFS: the gentle extras sit well under everything
const SOUND_PEAK = -27;
const UNTIL = Date.now() + 15 * 60 * 1000; // leaves room for the sound effects and closing

const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const seed = () => Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
const f = (x) => x.toFixed(1).padStart(6);
let bad = 0;
let skipped = 0;

const labs = await Promise.all(Array.from({ length: WORKERS }, () => openLab()));
const lab = labs[0];
const names = await lab.names();
console.log(`Music: ${SEEDS} seeds x ${SECONDS} s per piece, default volume (dBFS)`);
console.log("piece      worst peak  median peak  worst loudest-0.4s  at full volume");
for (const piece of names.pieces) {
  const peaks = [];
  let loud = -Infinity;
  const seeds = Array.from({ length: SEEDS }, seed);
  for (const r of await inTurns(seeds, WORKERS, (s, w) => labs[w].music({ seed: s, piece, seconds: SECONDS }), { until: UNTIL })) {
    if (!r) { skipped++; continue; }
    peaks.push(r.peakDb);
    loud = Math.max(loud, r.loudestDb);
    if (r.clipped || r.peakDb > MUSIC_PEAK) { bad++; console.log(`  too loud: ${piece} ${r.seed} ${r.peakDb.toFixed(1)}`); }
  }
  peaks.sort((a, b) => a - b);
  if (!peaks.length) { console.log(`${piece.padEnd(10)} (skipped: out of time)`); continue; }
  console.log(`${piece.padEnd(10)} ${f(peaks[peaks.length - 1])}      ${f(peaks[Math.floor(peaks.length / 2)])}       ${f(loud)}            ${f(peaks[peaks.length - 1] + FULL_GAIN_DB)}`);
}
// The whole programme: pieces taking turns, crossfading (five pieces in two minutes: a 200 s
// render took minutes on its own and pushed the check past the Fixer's limit)
const programmes = Array.from({ length: Math.max(2, Math.round(SEEDS / 4)) }, seed);
for (const r of await inTurns(programmes, WORKERS, (s, w) => labs[w].music({ seed: s, seconds: 120, pieceSeconds: 22, fadeSeconds: 9 }), { until: UNTIL })) {
  if (!r) { skipped++; continue; }
  const repeats = r.pieces.some((p, k) => k && p === r.pieces[k - 1]);
  if (repeats || r.peakDb > MUSIC_PEAK) bad++;
  console.log(`programme ${r.seed}: ${r.pieces.join(" > ")}  peak ${r.peakDb.toFixed(1)}  loudest ${r.loudestDb.toFixed(1)}${repeats ? "  REPEATED A PIECE" : ""}`);
}

console.log(`\nSound effects: worst of 10 renders each (dBFS)`);
const soft = new Set([...names.soft, "velvet"]);
for (const name of [...names.sounds, "velvet"]) {
  let peak = -Infinity;
  let loud = -Infinity;
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const r = await lab.sound(name, { arg: i % 2, variant: i, theme: name === "velvet" ? ["agent", "notes", "portal", "calendar"][i % 4] : undefined, kind: i % 3 ? "scroll" : "drag" });
    peak = Math.max(peak, r.peakDb);
    loud = Math.max(loud, r.loudestDb);
    seen.add(r.peakDb.toFixed(3));
  }
  const limit = soft.has(name) ? EXTRA_PEAK : SOUND_PEAK;
  const ok = peak <= limit;
  if (!ok) bad++;
  console.log(`${(soft.has(name) ? "* " : "  ") + name.padEnd(9)} peak ${f(peak)}  loudest-0.1s ${f(loud)}  ${seen.size}/10 different${ok ? "" : "  TOO LOUD"}`);
}
let worst = { peakDb: -Infinity };
for (const [theme, list] of Object.entries(names.themes))
  for (const name of list) {
    const r = await lab.sound(name, { theme, arg: 1 });
    if (r.peakDb > worst.peakDb) worst = { ...r, theme };
  }
if (worst.peakDb > SOUND_PEAK) bad++;
console.log(`  loudest panel sound: ${worst.theme}/${worst.name} ${worst.peakDb.toFixed(1)}`);
console.log("(* = the gentle extras, off unless 'Quiet extras' is on)");
const errors = labs.flatMap((l) => l.errors);
if (errors.length) { bad++; console.log("Page errors:", errors); }
await Promise.all(labs.map((l) => l.close()));
if (skipped) console.log(`\n${skipped} music render(s) skipped: out of time (try fewer seeds or seconds)`);
console.log(bad ? `\n${bad} problem(s)` : "\nAll within the calm limits.");
process.exit(bad ? 1 : 0);
