// Playback: a small jitter buffer keyed by sequence number.
//
// Frames arrive from the main thread possibly out of order (the data channel
// is unordered). We hold them in a Map, wait until `targetFrames` are queued,
// then play them strictly in sequence order. Samples are copied to the output
// exactly as received, so a delivered frame is played bit-for-bit.
//
// A frame is { chans: Float32Array[], length }. Mono frames go to both
// output channels; stereo frames go L/R.
//
//   missing frame when due  → play silence for it ("lost")
//   frame arrives too late  → discard ("late")
//   buffer runs dry         → go silent and rebuffer ("underrun")
//   buffer grows too deep   → drop the oldest frame (clock drift between devices)

const STATS_INTERVAL = 0.25; // seconds
const MAX_GAP_TO_FILL = 3;   // larger holes are skipped instead of padded with silence

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.targetFrames = o.targetFrames;
    this.maxFrames = o.maxFrames;
    this.reset();
    this.stats = { played: 0, lost: 0, late: 0, underruns: 0, dropped: 0 };
    this.lastReport = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  reset() {
    this.frames = new Map(); // seq -> { chans, length }
    this.nextSeq = -1;
    this.cur = null;
    this.pos = 0;
    this.playing = false;
    this.lastLen = 128;
  }

  onMessage(m) {
    if (m.type === "reset") {
      this.reset();
      return;
    }
    if (m.type !== "frame") return;

    if (this.nextSeq >= 0 && m.seq < this.nextSeq) {
      // A huge backwards jump means the sender restarted; anything else is just late.
      if (this.nextSeq - m.seq < 1000) {
        this.stats.late++;
        return;
      }
      this.reset();
    }
    this.frames.set(m.seq, { chans: m.chans, length: m.chans[0].length });
  }

  minSeq() {
    let min = Infinity;
    for (const k of this.frames.keys()) if (k < min) min = k;
    return min;
  }

  // Load the next frame into this.cur. Returns false if we should go silent.
  advance() {
    if (!this.playing) {
      if (this.frames.size < this.targetFrames) return false;
      this.playing = true;
      this.nextSeq = this.minSeq();
    }
    if (this.frames.size === 0) {
      this.playing = false;
      this.stats.underruns++;
      return false;
    }

    // Too much queued (sender's clock is slightly fast, or a burst arrived): catch up.
    while (this.frames.size > this.maxFrames) {
      if (this.frames.delete(this.nextSeq)) this.stats.dropped++;
      else this.stats.lost++;
      this.nextSeq++;
    }

    let frame = this.frames.get(this.nextSeq);
    if (frame) {
      this.frames.delete(this.nextSeq);
      this.stats.played++;
    } else {
      const ahead = this.minSeq();
      if (ahead - this.nextSeq > MAX_GAP_TO_FILL) {
        // Big hole (e.g. network stall): jump to what we have.
        this.stats.lost += ahead - this.nextSeq;
        this.nextSeq = ahead;
        frame = this.frames.get(ahead);
        this.frames.delete(ahead);
        this.stats.played++;
      } else {
        this.stats.lost++;
        frame = { chans: [], length: this.lastLen }; // silence in place of the lost frame
      }
    }
    this.nextSeq++;
    this.lastLen = frame.length;
    this.cur = frame;
    this.pos = 0;
    return true;
  }

  process(_inputs, outputs) {
    const outs = outputs[0];
    const len = outs[0].length;
    let i = 0;
    while (i < len) {
      if (!this.cur && !this.advance()) break;
      const n = Math.min(len - i, this.cur.length - this.pos);
      const chans = this.cur.chans;
      for (let c = 0; c < outs.length; c++) {
        const src = chans[Math.min(c, chans.length - 1)];
        if (src) outs[c].set(src.subarray(this.pos, this.pos + n), i);
        else outs[c].fill(0, i, i + n);
      }
      i += n;
      this.pos += n;
      if (this.pos === this.cur.length) this.cur = null;
    }
    for (const out of outs) out.fill(0, i);

    if (currentTime - this.lastReport >= STATS_INTERVAL) {
      this.lastReport = currentTime;
      let queued = this.cur ? this.cur.length - this.pos : 0;
      for (const f of this.frames.values()) queued += f.length;
      this.port.postMessage({
        type: "stats",
        bufferedMs: (queued / sampleRate) * 1000,
        playing: this.playing,
        ...this.stats,
      });
    }
    return true;
  }
}

registerProcessor("nova-playback", PlaybackProcessor);
