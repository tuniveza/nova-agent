// Capture: slices the input signal into fixed-size Float32 frames (one array
// per channel) and hands each one to the main thread untouched. The audio
// thread delivers 128-sample render quanta; we accumulate them into frames of
// `frameSize` samples (10 ms).
//
// The node is created with channelCountMode "explicit", so the input always
// has exactly `channels` channels: a mono source feeding a stereo node is
// copied to both sides, and a stereo source feeding a mono node is averaged.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.frameSize = o.frameSize;
    this.channels = o.channels;
    this.bufs = this.alloc();
    this.fill = 0;
  }

  alloc() {
    return Array.from({ length: this.channels }, () => new Float32Array(this.frameSize));
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const len = input[0].length;
    let i = 0;
    while (i < len) {
      const n = Math.min(len - i, this.frameSize - this.fill);
      for (let c = 0; c < this.channels; c++) {
        const src = input[c] || input[0];
        this.bufs[c].set(src.subarray(i, i + n), this.fill);
      }
      this.fill += n;
      i += n;
      if (this.fill === this.frameSize) {
        // Transfer (not copy) the buffers to the main thread.
        this.port.postMessage(this.bufs, this.bufs.map((b) => b.buffer));
        this.bufs = this.alloc();
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor("nova-capture", CaptureProcessor);
