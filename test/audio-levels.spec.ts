// Calm sound, measured: renders the ambient music and the sound effects offline in headless
// Chromium (OfflineAudioContext, the real Web Audio engine) and checks the levels. The owner's
// rule: quiet (the loudest moments around −27 dBFS or lower), never clipping, and the gentle
// extras far quieter still. More seeds: node scripts/audio-levels.mjs
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-ignore: a plain JavaScript helper (scripts/audio-lab.mjs)
import { openLab } from "../scripts/audio-lab.mjs";

interface Level { seed?: string; pieces?: string[]; peakDb: number; loudestDb: number; clipped: boolean; notes?: { lead: number; bass: number; chord: number; drum: number }; lowShare?: number; longestGap?: number }
interface Lab {
  errors: string[];
  music(o: Record<string, unknown>): Promise<Level>;
  sound(name: string, o?: Record<string, unknown>): Promise<Level>;
  names(): Promise<{ pieces: string[]; sounds: string[]; soft: string[]; themes: Record<string, string[]> }>;
  close(): Promise<void>;
}

const SEEDS = ["AAAAAA", "K7M2QX", "Z3P9WD"];
const FULL = 20 * Math.log10(1 / 0.4); // default volume (40) to full volume (100)
let lab: Lab | null = null;
let names: Awaited<ReturnType<Lab["names"]>>;

beforeAll(async () => {
  lab = (await openLab()) as Lab;
  names = await lab.names();
}, 60000);
afterAll(async () => {
  if (lab) await lab.close();
});

describe("ambient music levels", () => {
  const PIECES = ["glow", "keys", "tape", "late", "trio", "garage", "afro"];
  for (const piece of PIECES) {
    it(`${piece}: quiet at the default volume and far from clipping at full volume, across seeds`, async () => {
      expect(names.pieces).toContain(piece);
      for (const seed of SEEDS) {
        const r = await lab!.music({ seed, piece, seconds: 30 });
        expect(r.clipped).toBe(false);
        expect(r.peakDb).toBeLessThanOrEqual(-26.5);
        expect(r.loudestDb).toBeLessThan(-33);
        expect(r.peakDb + FULL).toBeLessThan(-12);
        expect(r.loudestDb).toBeGreaterThan(-60); // and it does play
      }
    }, 120000);
  }

  // Not just held notes: every piece has a moving bass line, a melody and changing chords
  for (const piece of PIECES) {
    it(`${piece}: a bass line, a melody and chords that move`, async () => {
      const r = await lab!.music({ seed: "K7M2QX", piece, seconds: 45, analyse: true });
      const perMin = (n: number) => (n / 45) * 60;
      expect(perMin(r.notes!.bass)).toBeGreaterThan(20);
      expect(perMin(r.notes!.lead)).toBeGreaterThan(6);
      expect(perMin(r.notes!.chord)).toBeGreaterThan(20);
      expect(r.lowShare!).toBeGreaterThan(0.2); // the bass is there
      expect(r.longestGap!).toBeLessThan(6);    // never silent for long
    }, 120000);
  }

  it("takes turns between pieces with crossfades, never the same piece twice running", async () => {
    const r = await lab!.music({ seed: "N1GHT5", seconds: 160, pieceSeconds: 30, fadeSeconds: 12 });
    expect(r.pieces!.length).toBeGreaterThanOrEqual(5);
    r.pieces!.forEach((p, i) => i && expect(p).not.toBe(r.pieces![i - 1]));
    expect(r.peakDb).toBeLessThanOrEqual(-26.5);
  }, 300000); // 160 s of music takes about two minutes to render, longer while other tests run

  it("the same seed plays the same variation; another seed another one", async () => {
    const a = await lab!.music({ seed: "K7M2QX", seconds: 30, pieceSeconds: 12, fadeSeconds: 6 });
    const b = await lab!.music({ seed: "k7m2qx", seconds: 30, pieceSeconds: 12, fadeSeconds: 6 });
    const c = await lab!.music({ seed: "Q4RT8V", seconds: 30, pieceSeconds: 12, fadeSeconds: 6 });
    expect(b.pieces).toEqual(a.pieces);
    expect(b.peakDb).toBeCloseTo(a.peakDb, 3);
    expect(`${c.pieces!.join()} ${c.peakDb.toFixed(2)}`).not.toBe(`${a.pieces!.join()} ${a.peakDb.toFixed(2)}`);
  }, 120000);
});

describe("sound effect levels", () => {
  it("the gentle extras are faint, and never the same twice", async () => {
    for (const name of [...names.soft, "velvet"]) {
      const peaks = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const r = await lab!.sound(name, { arg: i % 2, variant: i, theme: name === "velvet" ? ["agent", "notes", "portal"][i % 3] : undefined, kind: i % 2 ? "drag" : "scroll" });
        expect(r.clipped).toBe(false);
        expect(r.peakDb, name).toBeLessThanOrEqual(-36);
        expect(r.peakDb, name).toBeGreaterThan(-75);
        peaks.add(r.peakDb.toFixed(4));
      }
      expect(peaks.size, name).toBeGreaterThan(3);
    }
  }, 120000);

  it("every sound, in every panel's own voice, stays under −27 dBFS", async () => {
    for (const name of names.sounds) {
      const r = await lab!.sound(name, { arg: 1 });
      expect(r.peakDb, name).toBeLessThanOrEqual(-27);
    }
    for (const [theme, list] of Object.entries(names.themes))
      for (const name of list) {
        const r = await lab!.sound(name, { theme, arg: 1 });
        expect(r.peakDb, `${theme}/${name}`).toBeLessThanOrEqual(-27);
      }
    expect(lab!.errors).toEqual([]);
  }, 120000);
});
