// Music previews: renders every ambient piece offline (headless Chromium, the real Web Audio
// engine) and saves each as a WAV to listen to, with its measurements: peak and loudness (dBFS),
// how much of it is bass (under 150 Hz), how many notes each player played (and the melody's
// notes per minute), and the longest quiet gap.
//   node scripts/music-previews.mjs [out folder] [--seed K7M2QX] [--seconds 60] [--only keys,afro]
// The WAVs are at the default volume, raised by 18 dB so they're easy to hear (the measurements
// are of the real level).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openLab } from "./audio-lab.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = args.find((a, i) => !a.startsWith("--") && !(i && args[i - 1].startsWith("--"))) || join(homedir(), "an/pj/ns/music-previews");
const seed = flag("--seed", "K7M2QX");
const seconds = Number(flag("--seconds", 60));
const only = flag("--only", "");
const LIFT = Math.pow(10, 18 / 20);

mkdirSync(out, { recursive: true });
const lab = await openLab();
const { pieces } = await lab.names();
const f = (x) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const runs = pieces.filter((p) => !only || only.split(",").includes(p)).map((p) => ({ name: p, o: { seed, piece: p, seconds } }));
if (!only) runs.push({ name: "mix-3min", o: { seed, seconds: 180, pieceSeconds: 50, fadeSeconds: 12 } });
for (const { name, o } of runs) {
  const r = await lab.music({ ...o, wav: true, wavGain: LIFT });
  writeFileSync(join(out, `${name}.wav`), Buffer.from(r.wav, "base64"));
  const mins = o.seconds / 60;
  console.log(
    `${name.padEnd(9)} peak ${f(r.peakDb)} dB · loudest ${f(r.loudestDb)} · rms ${f(r.rmsDb)} · bass ${(r.lowShare * 100).toFixed(0)}% · ` +
      `melody ${(r.notes.lead / mins).toFixed(0)}/min · bass ${(r.notes.bass / mins).toFixed(0)}/min · chords ${(r.notes.chord / mins).toFixed(0)}/min · drums ${(r.notes.drum / mins).toFixed(0)}/min · ` +
      `gap ${r.longestGap.toFixed(1)} s${r.clipped ? " · CLIPPED" : ""}${name === "mix-3min" ? ` · ${r.pieces.join(" → ")}` : ""}`
  );
}
if (lab.errors.length) console.log("errors:", lab.errors);
await lab.close();
console.log(`WAVs in ${out}`);
