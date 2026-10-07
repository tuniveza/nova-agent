// The playback worklet, run outside the browser with a tiny stand-in for the
// AudioWorklet globals.  Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const SRC = readFileSync(new URL("../public/lossless/playback-worklet.js", import.meta.url), "utf8");
const FRAME = 480; // 10 ms at 48 kHz
const QUANTUM = 128;

function player(options = {}) {
  let Processor;
  const posted = [];
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => posted.push(m), onmessage: null };
      }
    },
    registerProcessor: (_name, cls) => (Processor = cls),
  };
  vm.runInNewContext(SRC, ctx);
  const p = new Processor({ processorOptions: { targetFrames: 6, maxFrames: 25, ...options } });
  const out = [];
  return {
    p,
    stats: () => p.stats,
    // Frame `seq` holds the value seq + 1 in every sample, so silence (0) stands out
    send: (seq) => p.port.onmessage({ data: { type: "frame", seq, chans: [new Float32Array(FRAME).fill(seq + 1)] } }),
    msg: (data) => p.port.onmessage({ data }),
    // Run the audio thread for `quanta` render quanta, keeping what it played
    run(quanta) {
      for (let q = 0; q < quanta; q++) {
        const outputs = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
        p.process([], outputs);
        out.push(...outputs[0][0]);
        ctx.currentTime += QUANTUM / 48000;
      }
    },
    // What was heard, as a list of frame numbers (one per sample run), silence left out
    heard: () => out.filter((v) => v !== 0).map((v) => v - 1),
    silences: () => out.filter((v) => v === 0).length,
  };
}
const framesIn = (heard) => {
  const seqs = [];
  for (let i = 0; i < heard.length; i += FRAME) seqs.push(heard[i]);
  return seqs;
};
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

test("lossless: frames out of order, and one very late, are all played, in order, bit for bit", () => {
  const t = player();
  for (const s of [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13]) t.send(s); // 10 is late
  t.run(60);
  t.send(10);
  for (const s of range(14, 40)) t.send(s);
  t.run(400);
  const heard = t.heard();
  assert.equal(heard.length, 40 * FRAME, "every sample of every frame");
  assert.deepEqual(framesIn(heard), range(0, 40));
  assert.equal(t.stats().lost, 0);
  assert.equal(t.stats().late, 0);
});

test("lossless: a stall raises the buffer target, so the next one is ridden out", () => {
  const t = player({ losslessStep: 4 });
  for (const s of range(0, 8)) t.send(s);
  t.run(40); // plays 8 frames, then runs dry
  assert.equal(t.stats().underruns, 1);
  assert.equal(t.p.targetFrames, 10);
});

test("lossless: a frame the sender gave up on is skipped only once lots has arrived past it", () => {
  const t = player({ giveUpAfter: 50 });
  for (const s of range(0, 20)) if (s !== 8) t.send(s);
  t.run(200);
  assert.deepEqual(framesIn(t.heard()), range(0, 8), "waits at the hole");
  for (const s of range(20, 60)) t.send(s);
  t.run(400);
  assert.deepEqual(framesIn(t.heard()), range(0, 60).filter((s) => s !== 8));
  assert.equal(t.stats().lost, 1);
});

test("lossless: catch-up drops the backlog and goes on from the newest audio", () => {
  const t = player();
  for (const s of range(0, 100)) t.send(s);
  t.msg({ type: "catch-up" });
  t.run(100);
  assert.deepEqual(framesIn(t.heard()), range(94, 100));
  assert.equal(t.stats().dropped, 94);
});

test("low latency: a missing frame becomes silence and is counted lost", () => {
  const t = player({ lossless: false });
  for (const s of range(0, 12)) if (s !== 7) t.send(s);
  t.run(45);
  assert.deepEqual(framesIn(t.heard()), range(0, 12).filter((s) => s !== 7));
  assert.equal(t.stats().lost, 1);
});
