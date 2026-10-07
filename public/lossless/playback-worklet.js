// Playback: a jitter buffer keyed by sequence number, in one of two modes.
//
// Frames arrive from the main thread possibly out of order (the data channel
// is unordered). We hold them in a Map and play them strictly in sequence
// order. Samples are copied to the output exactly as received, so a delivered
// frame is played bit-for-bit.
//
// A frame is { chans: Float32Array[], length }. Mono frames go to both
// output channels; stereo frames go L/R.
//
// Lossless mode (the default): every frame is played, none is skipped.
//   next frame not here yet → pause (silence) and rebuffer until it is, then go on
//                             from exactly where we stopped; each rebuffer raises the
//                             buffer target, so the delay settles at whatever the
//                             network needs
//   buffer grows too deep   → only past `losslessMaxFrames` (tens of seconds) is the
//                             oldest audio dropped; "catch-up" drops the backlog on request
//   a frame never comes     → only if the sender gave up on it (it's far behind what's
//                             arrived since) is it skipped and counted as lost
//
// Low-latency mode: keeps the delay small at the cost of gaps.
//   missing frame when due  → play silence for it ("lost")
//   frame arrives too late  → discard ("late")
//   buffer runs dry         → go silent and rebuffer ("underrun")
//   buffer grows too deep   → drop the oldest frame (clock drift between devices)

const STATS_INTERVAL = 0.25; // seconds
const MAX_GAP_TO_FILL = 3;   // low latency: larger holes are skipped instead of padded with silence

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.lossless = o.lossless !== false;
    this.baseTarget = o.targetFrames;
    this.targetFrames = o.targetFrames;
    this.maxFrames = o.maxFrames;
    this.losslessStep = o.losslessStep ?? 4;            // frames added to the target per rebuffer
    this.losslessMaxTarget = o.losslessMaxTarget ?? 300; // never wait for more than this before playing
    this.losslessMaxFrames = o.losslessMaxFrames ?? 3000;
    this.giveUpAfter = o.giveUpAfter ?? 200;             // frames arrived past a hole before it's skipped
    this.reset();
    this.stats = { played: 0, lost: 0, late: 0, underruns: 0, dropped: 0 };
    this.lastReport = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  reset() {
    this.frames = new Map(); // seq -> { chans, length }
    this.nextSeq = -1;
    this.maxSeq = -1;
    this.cur = null;
    this.pos = 0;
    this.playing = false;
    this.lastLen = 128;
    this.targetFrames = this.baseTarget;
  }

  onMessage(m) {
    if (m.type === "reset") {
      this.reset();
      return;
    }
    if (m.type === "mode") {
      this.lossless = !!m.lossless;
      this.targetFrames = this.baseTarget;
      return;
    }
    if (m.type === "catch-up") {
      // Drop everything queued except the newest `baseTarget` frames
      const keep = [...this.frames.keys()].sort((a, b) => a - b).slice(-this.baseTarget);
      for (const k of [...this.frames.keys()]) {
        if (keep.includes(k)) continue;
        this.frames.delete(k);
        this.stats.dropped++;
      }
      this.cur = null;
      this.playing = false;
      this.nextSeq = keep.length ? keep[0] : -1;
      this.targetFrames = this.baseTarget;
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
    if (m.seq > this.maxSeq) this.maxSeq = m.seq;
  }

  minSeq() {
    let min = Infinity;
    for (const k of this.frames.keys()) if (k < min) min = k;
    return min;
  }

  // How many frames are queued in a row from `from`, with no hole
  contiguous(from) {
    let n = 0;
    while (this.frames.has(from + n)) n++;
    return n;
  }

  // Load the next frame into this.cur. Returns false if we should go silent.
  advance() {
    return this.lossless ? this.advanceLossless() : this.advanceLowLatency();
  }

  advanceLossless() {
    if (this.frames.size === 0 && !this.playing) return false;
    if (this.nextSeq < 0) this.nextSeq = this.minSeq();

    // The next frame isn't here. If the sender clearly gave up on it (lots has
    // arrived since), skip the hole; otherwise wait for it.
    if (!this.frames.has(this.nextSeq)) {
      if (this.frames.size && this.maxSeq - this.nextSeq > this.giveUpAfter) {
        const ahead = this.minSeq();
        this.stats.lost += ahead - this.nextSeq;
        this.nextSeq = ahead;
      } else {
        if (this.playing) {
          this.playing = false;
          this.stats.underruns++;
          // The network needs more slack than we gave it
          this.targetFrames = Math.min(this.losslessMaxTarget, this.targetFrames + this.losslessStep);
        }
        return false;
      }
    }

    if (!this.playing) {
      if (this.contiguous(this.nextSeq) < this.targetFrames) return false;
      this.playing = true;
    }

    // Far too much queued (hours of clock drift, or a stall the size of a song): drop the oldest
    while (this.frames.size > this.losslessMaxFrames) {
      if (this.frames.delete(this.nextSeq)) this.stats.dropped++;
      else this.stats.lost++;
      this.nextSeq++;
    }
    if (!this.frames.has(this.nextSeq)) return this.advanceLossless();

    const frame = this.frames.get(this.nextSeq);
    this.frames.delete(this.nextSeq);
    this.stats.played++;
    this.nextSeq++;
    this.lastLen = frame.length;
    this.cur = frame;
    this.pos = 0;
    return true;
  }

  advanceLowLatency() {
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
        targetMs: (this.targetFrames * this.lastLen / sampleRate) * 1000,
        lossless: this.lossless,
        playing: this.playing,
        ...this.stats,
      });
    }
    return true;
  }
}

registerProcessor("nova-playback", PlaybackProcessor);
