// Nova Lossless Audio — peer logic.
//
// input → capture worklet (Float32 frames) → header + PCM → RTCDataChannel
//   → other device → parse → playback worklet (jitter buffer) → output
//
// There is no media track, so no Opus. The only signalling is SDP and ICE,
// relayed by the LosslessRoom Durable Object over a WebSocket.
//
// Input and output can be any audio device the browser can see, including
// virtual ones like BlackHole, so a DAW can feed and record the stream.

"use strict";

// ---- Tunables -------------------------------------------------------------

const FRAME_MS = 10;                // PCM frame length
const JITTER_TARGET_FRAMES = 6;     // buffer 60 ms before playback starts
const JITTER_MAX_FRAMES = 25;       // more than 250 ms queued → drop oldest
const SEND_HIGH_WATER = 512 * 1024; // bytes queued in the data channel before we drop frames

// Unordered, and give up on a packet after 120 ms: a retransmit that late
// would miss its playback slot anyway. The receiver reorders by sequence number.
const DC_OPTIONS = { ordered: false, maxPacketLifeTime: 120 };

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // TURN plugs in here. STUN alone fails on symmetric NATs (common on mobile
  // carriers and locked-down Wi-Fi); the Path readout then never leaves
  // "connecting" and the status shows "failed". To fix, add a TURN relay, e.g.
  //   { urls: "turn:turn.example.com:3478", username: "...", credential: "..." }
  // For Cloudflare's TURN service, mint short-lived credentials in the Worker
  // (a /lossless/ice endpoint) and fetch them here before creating the
  // RTCPeerConnection, so the TURN key never ships in this file.
];

// ---- Wire format ----------------------------------------------------------
// 20-byte header, little-endian, then the PCM payload.
//   0  u8   version (2)
//   1  u8   format: 0 = float32, 1 = int16
//   2  u8   channels (1 or 2)
//   3  u8   reserved
//   4  u32  sequence number
//   8  u32  sample rate (Hz)
//  12  u32  timestamp: sender's running sample counter at the frame's first sample
//  16  u16  samples per channel
//  18  u16  reserved
// Payload is planar: all of channel 0, then all of channel 1. It uses the
// platform's byte order via typed arrays; every browser platform is little-endian.

const PROTO_VERSION = 2;
const HEADER_BYTES = 20;
const FMT_F32 = 0;
const FMT_S16 = 1;

// ---- State ----------------------------------------------------------------

const S = {
  ws: null, pc: null, dc: null, sigQueue: Promise.resolve(), pingTimer: 0,
  room: "", clientId: Math.random().toString(36).slice(2, 12), peerPresent: false, isOfferer: false,
  retryMs: 0, retryTimer: 0, wakeLock: null,
  ctx: null, micStream: null, micSource: null, captureNode: null, micSink: null, playbackNode: null,
  inputId: "", outputId: "", channels: 1, inputRate: 0,
  micOn: true, format: FMT_F32, seq: 0, samplePos: 0,
  resamplers: [], remote: null, remoteMicOn: true,
  playStats: null, rtc: null,
  counters: { sent: 0, sendDropped: 0, bytesOut: 0, received: 0, bytesIn: 0 },
  localPeak: 0, remotePeak: 0, active: false,
};

const $ = (id) => document.getElementById(id);
const ui = {
  room: $("room"), invite: $("invite"), connect: $("connect"), mic: $("mic"),
  format: $("format"), input: $("input"), output: $("output"), channels: $("channels"),
  routing: $("routing"), status: $("status"), resume: $("resume"),
  localBar: $("localBar"), localDb: $("localDb"), remoteBar: $("remoteBar"), remoteDb: $("remoteDb"),
  sPath: $("sPath"), sRtt: $("sRtt"), sOut: $("sOut"), sIn: $("sIn"), sFmt: $("sFmt"),
  sBuf: $("sBuf"), sPlayed: $("sPlayed"), sLost: $("sLost"), sUnder: $("sUnder"),
};

const CAN_PICK_OUTPUT = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

function setStatus(text, tone = "") {
  ui.status.textContent = text;
  ui.status.className = tone;
}

function normalizeRoom(s) {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 64);
}

// Device and format choices are remembered per browser, so a studio setup
// doesn't have to be re-picked every session.
const PREFS_KEY = "nova-lossless-prefs";

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    S.inputId = typeof p.inputId === "string" ? p.inputId : "";
    S.outputId = typeof p.outputId === "string" ? p.outputId : "";
    S.channels = p.channels === 2 ? 2 : 1;
    S.format = p.format === FMT_S16 ? FMT_S16 : FMT_F32;
  } catch {
    // storage unavailable (private mode etc.): defaults are fine
  }
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      inputId: S.inputId, outputId: S.outputId, channels: S.channels, format: S.format,
    }));
  } catch {
    // storage unavailable
  }
}

// ---- Audio ----------------------------------------------------------------

async function buildContext(sampleRate) {
  const ctx = new AudioContext(sampleRate ? { sampleRate, latencyHint: "interactive" } : { latencyHint: "interactive" });
  // Called synchronously from the click handler on the first attempt. iOS
  // Safari only lets an AudioContext start inside a user gesture.
  const resumed = ctx.resume();
  await Promise.all([
    ctx.audioWorklet.addModule("capture-worklet.js"),
    ctx.audioWorklet.addModule("playback-worklet.js"),
  ]);
  await resumed;
  return ctx;
}

function openInput() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: S.inputId ? { exact: S.inputId } : undefined,
      channelCount: { ideal: S.channels },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

// Opens the chosen input, falling back to the default if that device has gone
// (unplugged, or BlackHole uninstalled since last time).
async function openInputOrDefault() {
  try {
    return await openInput();
  } catch (err) {
    if (!S.inputId || (err.name !== "OverconstrainedError" && err.name !== "NotFoundError")) throw err;
    console.warn("Saved input device unavailable, using default:", err);
    S.inputId = "";
    savePrefs();
    return openInput();
  }
}

// Wire an input stream into a fresh capture node, replacing any previous one.
function attachInput(stream) {
  const ctx = S.ctx;
  const source = ctx.createMediaStreamSource(stream); // may throw on Firefox rate mismatch
  const frameSize = Math.round((ctx.sampleRate * FRAME_MS) / 1000);
  const node = new AudioWorkletNode(ctx, "nova-capture", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
    channelCount: S.channels, channelCountMode: "explicit", channelInterpretation: "speakers",
    processorOptions: { frameSize, channels: S.channels },
  });
  node.port.onmessage = (e) => onLocalFrame(e.data);
  source.connect(node);
  // Some browsers only run a node that leads to the speakers. Route it there through a muted gain.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);

  detachInput();
  S.micStream = stream;
  S.micSource = source;
  S.captureNode = node;
  S.micSink = sink;
  S.inputRate = stream.getAudioTracks()[0]?.getSettings().sampleRate || 0;
}

function detachInput() {
  if (S.captureNode) S.captureNode.port.onmessage = null;
  S.micSource?.disconnect();
  S.captureNode?.disconnect();
  S.micSink?.disconnect();
  S.micStream?.getTracks().forEach((t) => t.stop());
  S.micStream = S.micSource = S.captureNode = S.micSink = null;
}

async function startAudio() {
  // iOS 16.4+: make sure playback and the mic can run together.
  if (navigator.audioSession) navigator.audioSession.type = "play-and-record";

  const ctxPromise = buildContext(48000); // before any await: keeps the gesture
  let stream;
  try {
    stream = await openInputOrDefault();
  } catch (err) {
    ctxPromise.then((ctx) => ctx.close(), () => {});
    throw err;
  }
  S.ctx = await ctxPromise;

  try {
    attachInput(stream);
  } catch (err) {
    // Firefox refuses to connect an input to a context running at a different
    // rate from the hardware. Fall back to the native rate; the receiver
    // handles the mismatch.
    console.warn("48 kHz context rejected the input, using native rate:", err);
    await S.ctx.close();
    S.ctx = await buildContext(0);
    attachInput(stream);
  }

  const ctx = S.ctx;
  S.playbackNode = new AudioWorkletNode(ctx, "nova-playback", {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: { targetFrames: JITTER_TARGET_FRAMES, maxFrames: JITTER_MAX_FRAMES },
  });
  S.playbackNode.port.onmessage = (e) => {
    if (e.data.type === "stats") S.playStats = e.data;
  };
  S.playbackNode.connect(ctx.destination);
  await applyOutput();

  ctx.onstatechange = () => {
    ui.resume.style.display = S.active && ctx.state !== "running" && ctx.state !== "closed" ? "block" : "none";
  };
}

async function stopAudio() {
  detachInput();
  if (S.ctx && S.ctx.state !== "closed") await S.ctx.close().catch(() => {});
  S.ctx = S.playbackNode = null;
  S.inputRate = 0;
}

// Switch input device or channel count mid-session.
async function restartInput() {
  if (!S.active || !S.ctx) return;
  try {
    attachInput(await openInputOrDefault());
  } catch (err) {
    console.error(err);
    setStatus("Couldn't switch input: " + err.message, "bad");
  }
  await refreshDevices();
}

async function applyOutput() {
  if (!S.ctx || !CAN_PICK_OUTPUT) return;
  try {
    await S.ctx.setSinkId(S.outputId);
  } catch (err) {
    console.warn("Saved output device unavailable, using default:", err);
    S.outputId = "";
    savePrefs();
    await S.ctx.setSinkId("").catch(() => {});
    renderDevices();
  }
}

// ---- Devices --------------------------------------------------------------

let deviceList = [];

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    deviceList = await navigator.mediaDevices.enumerateDevices();
  } catch {
    deviceList = [];
  }
  renderDevices();
}

function fillSelect(select, kind, current, defaultLabel) {
  // Skip Chrome's "default"/"communications" aliases; our first entry is the default.
  const list = deviceList.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
  select.replaceChildren(new Option(defaultLabel, ""));
  list.forEach((d, i) => select.add(new Option(d.label || `${kind === "audioinput" ? "Input" : "Output"} ${i + 1}`, d.deviceId)));
  select.value = list.some((d) => d.deviceId === current) ? current : "";
}

function labelOf(kind, id) {
  if (!id) return "";
  return deviceList.find((d) => d.kind === kind && d.deviceId === id)?.label || "";
}

function renderDevices() {
  fillSelect(ui.input, "audioinput", S.inputId, "Default microphone");
  if (CAN_PICK_OUTPUT) {
    fillSelect(ui.output, "audiooutput", S.outputId, "Default output");
  } else {
    ui.output.replaceChildren(new Option("System output (this browser can't choose; use Chrome or Edge)", ""));
    ui.output.disabled = true;
  }
  ui.channels.value = String(S.channels);
  ui.format.value = String(S.format);
  renderRoutingWarnings();
}

function renderRoutingWarnings() {
  const notes = [];
  const inLabel = labelOf("audioinput", S.inputId);
  const outLabel = labelOf("audiooutput", S.outputId);
  const norm = (s) => s.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();

  if (inLabel && outLabel && norm(inLabel) === norm(outLabel)) {
    notes.push(`Input and output are both "${inLabel}". What you receive will be sent straight back, so they'll hear themselves. Use two different devices (e.g. BlackHole 2ch out, BlackHole 16ch in).`);
  }
  // Only for a deliberately chosen device: a phone's built-in mic can't be changed, so don't nag.
  if (S.inputId && S.ctx && S.inputRate && S.inputRate !== S.ctx.sampleRate) {
    notes.push(`This input is running at ${(S.inputRate / 1000).toFixed(1)} kHz, so the browser converts it to ${(S.ctx.sampleRate / 1000).toFixed(1)} kHz before sending. For bit-exact audio, set the device to ${S.ctx.sampleRate} Hz (on a Mac: Audio MIDI Setup).`);
  }
  if (/blackhole/i.test(inLabel) && S.channels === 1) {
    notes.push("BlackHole input in mono: a stereo mix from your DAW will be folded to mono. Switch Channels to Stereo.");
  }
  ui.routing.hidden = notes.length === 0;
  ui.routing.textContent = notes.join(" ");
}

function peakOf(chans) {
  let p = 0;
  for (const samples of chans) {
    for (let i = 0; i < samples.length; i++) {
      const a = Math.abs(samples[i]);
      if (a > p) p = a;
    }
  }
  return p;
}

// ---- Sending --------------------------------------------------------------

function encodeFrame(seq, chans, timestamp) {
  const n = chans[0].length;
  const C = chans.length;
  const fmt = S.format;
  const buf = new ArrayBuffer(HEADER_BYTES + C * n * (fmt === FMT_F32 ? 4 : 2));
  const h = new DataView(buf);
  h.setUint8(0, PROTO_VERSION);
  h.setUint8(1, fmt);
  h.setUint8(2, C);
  h.setUint32(4, seq, true);
  h.setUint32(8, S.ctx.sampleRate, true);
  h.setUint32(12, timestamp >>> 0, true);
  h.setUint16(16, n, true);

  if (fmt === FMT_F32) {
    const out = new Float32Array(buf, HEADER_BYTES, C * n);
    for (let c = 0; c < C; c++) out.set(chans[c], c * n);
  } else {
    const out = new Int16Array(buf, HEADER_BYTES, C * n);
    for (let c = 0; c < C; c++) {
      const src = chans[c];
      const base = c * n;
      for (let i = 0; i < n; i++) {
        const s = src[i] < -1 ? -1 : src[i] > 1 ? 1 : src[i];
        out[base + i] = Math.round(s * 32767);
      }
    }
  }
  return buf;
}

function onLocalFrame(chans) {
  const timestamp = S.samplePos;
  S.samplePos += chans[0].length;
  if (!S.micOn) return;
  S.localPeak = Math.max(S.localPeak, peakOf(chans));

  const dc = S.dc;
  if (!dc || dc.readyState !== "open") return;
  const seq = S.seq++;
  // If the network can't keep up, drop rather than let latency pile up.
  if (dc.bufferedAmount > SEND_HIGH_WATER) {
    S.counters.sendDropped++;
    return;
  }
  const packet = encodeFrame(seq, chans, timestamp);
  try {
    dc.send(packet);
  } catch {
    return; // channel closing
  }
  S.counters.sent++;
  S.counters.bytesOut += packet.byteLength;
}

// ---- Receiving ------------------------------------------------------------

// Only used if the two devices end up at different sample rates (rare: both
// ask for 48 kHz). Linear interpolation, so not bit-exact; the UI says so.
class LinearResampler {
  constructor(inRate, outRate) {
    this.inRate = inRate;
    this.step = inRate / outRate;
    this.pos = 0;
    this.prev = 0;
  }
  process(input) {
    // Interpolate over [prev, ...input]; index 0 is the last sample of the previous frame.
    const out = [];
    const len = input.length;
    while (this.pos < len) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const a = i === 0 ? this.prev : input[i - 1];
      const b = input[i];
      out.push(a + (b - a) * f);
      this.pos += this.step;
    }
    this.pos -= len;
    this.prev = input[len - 1];
    return Float32Array.from(out);
  }
}

function onRemoteData(data) {
  if (typeof data === "string") {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "mic") S.remoteMicOn = !!msg.on;
    } catch {}
    return;
  }
  if (data.byteLength < HEADER_BYTES) return;
  const h = new DataView(data);
  if (h.getUint8(0) !== PROTO_VERSION) {
    if (!S.versionWarned) setStatus("The other device has an older version of this page open. Refresh the page on both devices.", "bad");
    S.versionWarned = true;
    return;
  }
  const fmt = h.getUint8(1);
  const C = h.getUint8(2);
  const seq = h.getUint32(4, true);
  const rate = h.getUint32(8, true);
  const n = h.getUint16(16, true);
  const bytesPer = fmt === FMT_F32 ? 4 : fmt === FMT_S16 ? 2 : 0;
  if (!bytesPer || C < 1 || C > 2 || n === 0 || data.byteLength !== HEADER_BYTES + C * n * bytesPer) return;

  S.counters.received++;
  S.counters.bytesIn += data.byteLength;
  S.remote = { fmt, rate, channels: C };

  let chans = [];
  for (let c = 0; c < C; c++) {
    if (fmt === FMT_F32) {
      chans.push(new Float32Array(data, HEADER_BYTES + c * n * 4, n)); // zero-copy view of the received bytes
    } else {
      const src = new Int16Array(data, HEADER_BYTES + c * n * 2, n);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = src[i] / 32767;
      chans.push(f);
    }
  }

  if (rate !== S.ctx.sampleRate) {
    if (S.resamplers.length !== C || S.resamplers[0].inRate !== rate) {
      S.resamplers = chans.map(() => new LinearResampler(rate, S.ctx.sampleRate));
    }
    chans = chans.map((ch, c) => S.resamplers[c].process(ch));
  } else {
    S.resamplers = [];
  }

  S.remotePeak = Math.max(S.remotePeak, peakOf(chans));
  const transfer = [...new Set(chans.map((ch) => ch.buffer))];
  S.playbackNode.port.postMessage({ type: "frame", seq, chans }, transfer);
}

// ---- WebRTC ---------------------------------------------------------------

function createPeer(isOfferer) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  S.pc = pc;
  S.isOfferer = isOfferer;
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal({ type: "candidate", candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (S.pc !== pc) return;
    const st = pc.connectionState;
    if (st === "connecting") setStatus("Connecting peer to peer…", "warn");
    if (st === "disconnected") setStatus("Connection interrupted, trying to recover…", "warn");
    if (st === "failed") callDropped("Peer connection failed. If this keeps happening, the network may need a TURN relay (see README).");
  };
  if (isOfferer) setupDataChannel(pc.createDataChannel("pcm", DC_OPTIONS));
  else pc.ondatachannel = (e) => setupDataChannel(e.channel);
  return pc;
}

function setupDataChannel(dc) {
  S.dc = dc;
  dc.binaryType = "arraybuffer";
  dc.onopen = () => {
    if (S.dc !== dc) return;
    S.playbackNode?.port.postMessage({ type: "reset" });
    S.remoteMicOn = true;
    S.versionWarned = false;
    dc.send(JSON.stringify({ type: "mic", on: S.micOn }));
    setStatus("Connected: streaming lossless PCM", "good");
  };
  dc.onclose = () => {
    if (S.dc === dc && S.active) callDropped("Audio connection dropped, reconnecting…");
  };
  dc.onmessage = (e) => onRemoteData(e.data);
}

function callUp() {
  return S.dc?.readyState === "open";
}

function closePeer() {
  S.dc?.close();
  S.pc?.close();
  S.dc = S.pc = null;
  S.rtc = null;
  S.remote = null;
  S.resamplers = [];
  S.playbackNode?.port.postMessage({ type: "reset" });
}

// The peer-to-peer link died. If the other device is still in the room, the
// side that made the original offer makes a fresh one; the other side waits for it.
function callDropped(text) {
  closePeer();
  if (!S.peerPresent) {
    setStatus(`Other device left. Waiting in "${ui.room.value}"…`, "warn");
    return;
  }
  setStatus(text, "warn");
  if (S.isOfferer) setTimeout(() => S.active && !S.pc && enqueue(makeOffer), 1000);
}

async function makeOffer() {
  closePeer();
  const pc = createPeer(true);
  await pc.setLocalDescription(await pc.createOffer());
  sendSignal({ type: "offer", sdp: pc.localDescription });
}

async function handleOffer(sdp) {
  closePeer();
  const pc = createPeer(false);
  await pc.setRemoteDescription(sdp);
  await pc.setLocalDescription(await pc.createAnswer());
  sendSignal({ type: "answer", sdp: pc.localDescription });
}

// ---- Signalling -----------------------------------------------------------
// The room server only introduces the two devices. Once the call is up, audio
// keeps flowing even if either device's link to the server drops; the socket
// reconnects in the background and only re-pairs if the call itself is down.

function sendSignal(msg) {
  if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg));
}

// Handle signalling strictly in order, so ICE candidates never race their SDP.
function enqueue(fn) {
  S.sigQueue = S.sigQueue.then(fn).catch((err) => console.error("signalling", err));
}

async function onSignal(msg) {
  switch (msg.type) {
    case "welcome":
      S.peerPresent = msg.peers > 0;
      if (callUp()) break; // we just reconnected to the server mid-call
      if (S.peerPresent) {
        setStatus("Other device found, connecting…", "warn");
        await makeOffer();
      } else {
        setStatus(`Waiting for the other device to join "${ui.room.value}"…`, "warn");
      }
      break;
    case "peer-joined":
      S.peerPresent = true;
      if (callUp()) break; // they reconnected to the server; the call is fine
      // They will send an offer; drop any half-built connection meanwhile.
      closePeer();
      setStatus("Other device joined, connecting…", "warn");
      break;
    case "peer-left":
      S.peerPresent = false;
      if (callUp()) break; // their server link dropped, but audio is still flowing
      closePeer();
      setStatus(`Other device left. Waiting in "${ui.room.value}"…`, "warn");
      break;
    case "offer":
      S.peerPresent = true;
      await handleOffer(msg.sdp);
      break;
    case "answer":
      await S.pc?.setRemoteDescription(msg.sdp);
      break;
    case "candidate":
      if (S.pc) await S.pc.addIceCandidate(msg.candidate).catch((e) => console.warn("ICE candidate rejected", e));
      break;
    case "full":
      setStatus("That room already has two devices. Pick another code.", "bad");
      await disconnect(true);
      break;
  }
}

function openSignalling() {
  const url = new URL("ws", location.href); // /lossless/ws next to this page
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.search = `?room=${encodeURIComponent(S.room)}&client=${S.clientId}`;

  const ws = new WebSocket(url);
  S.ws = ws;
  ws.onopen = () => {
    S.retryMs = 0;
    clearInterval(S.pingTimer);
    S.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 15000);
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    enqueue(() => onSignal(msg));
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    clearInterval(S.pingTimer);
    S.ws = null;
    if (!S.active) return;
    // Back off 1 s, 2 s, 4 s … up to 10 s between attempts.
    S.retryMs = Math.min(10000, (S.retryMs || 500) * 2);
    if (!callUp()) setStatus("Lost the room server, reconnecting…", "warn");
    S.retryTimer = setTimeout(() => S.active && !S.ws && openSignalling(), S.retryMs);
  };
}

// Phones dim and lock the screen after a minute or so, which pauses the page's
// audio. Ask the browser to keep the screen on while connected.
async function keepScreenOn() {
  if (!S.active || S.wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;
  try {
    S.wakeLock = await navigator.wakeLock.request("screen");
    S.wakeLock.onrelease = () => (S.wakeLock = null);
  } catch {
    // not allowed right now (e.g. battery saver); harmless
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.active) return;
  keepScreenOn();
  // Coming back to the page: make sure audio and the room server are alive.
  if (S.ctx && S.ctx.state !== "running") S.ctx.resume().catch(() => {});
  if (!S.ws) {
    clearTimeout(S.retryTimer);
    S.retryMs = 0;
    openSignalling();
  }
});

// ---- Controls -------------------------------------------------------------

async function connect() {
  const room = normalizeRoom(ui.room.value);
  if (!room) {
    setStatus("Enter a room code first.", "bad");
    return;
  }
  ui.room.value = room;
  history.replaceState(null, "", "#" + room);
  ui.connect.disabled = true;
  setStatus("Starting audio…");

  try {
    await startAudio();
  } catch (err) {
    console.error(err);
    const why = err.name === "NotAllowedError" ? "Microphone permission was denied." : err.message;
    setStatus("Couldn't start audio: " + why, "bad");
    await stopAudio();
    ui.connect.disabled = false;
    return;
  }
  await refreshDevices(); // device names only become visible after permission is granted

  S.active = true;
  S.room = room;
  S.seq = 0;
  S.retryMs = 0;
  S.peerPresent = false;
  Object.keys(S.counters).forEach((k) => (S.counters[k] = 0));
  ui.connect.textContent = "Disconnect";
  ui.connect.classList.remove("primary");
  ui.connect.disabled = false;
  ui.mic.disabled = false;
  ui.room.disabled = true;
  renderMic();
  setStatus("Joining room…", "warn");
  keepScreenOn();
  openSignalling();
}

async function disconnect(keepStatus = false) {
  S.active = false;
  clearInterval(S.pingTimer);
  clearTimeout(S.retryTimer);
  const ws = S.ws;
  S.ws = null;
  ws?.close();
  closePeer();
  S.wakeLock?.release().catch(() => {});
  S.wakeLock = null;
  await stopAudio();
  ui.connect.textContent = "Connect";
  ui.connect.classList.add("primary");
  ui.connect.disabled = false;
  ui.mic.disabled = true;
  ui.room.disabled = false;
  ui.resume.style.display = "none";
  renderRoutingWarnings();
  if (!keepStatus) setStatus("Not connected");
}

function renderMic() {
  ui.mic.textContent = S.micOn ? "Mic on" : "Mic off";
  ui.mic.className = S.micOn ? "on" : "off";
}

ui.connect.onclick = () => (S.active ? disconnect() : connect());

ui.mic.onclick = () => {
  S.micOn = !S.micOn;
  renderMic();
  if (S.dc?.readyState === "open") S.dc.send(JSON.stringify({ type: "mic", on: S.micOn }));
};

ui.format.onchange = () => {
  S.format = Number(ui.format.value);
  savePrefs();
};

ui.input.onchange = () => {
  S.inputId = ui.input.value;
  savePrefs();
  renderRoutingWarnings();
  restartInput();
};

ui.channels.onchange = () => {
  S.channels = Number(ui.channels.value) === 2 ? 2 : 1;
  savePrefs();
  renderRoutingWarnings();
  restartInput();
};

ui.output.onchange = () => {
  S.outputId = ui.output.value;
  savePrefs();
  renderRoutingWarnings();
  applyOutput();
};

ui.resume.onclick = () => S.ctx?.resume();

ui.invite.onclick = async () => {
  const room = normalizeRoom(ui.room.value);
  if (!room) return;
  const link = location.origin + location.pathname + "#" + room;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ url: link });
    else await navigator.clipboard.writeText(link);
    ui.invite.textContent = "Copied";
  } catch {
    ui.invite.textContent = "Copy failed";
  }
  setTimeout(() => (ui.invite.textContent = "Copy link"), 1500);
};

ui.room.onkeydown = (e) => {
  if (e.key === "Enter" && !S.active) connect();
};

navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);

// ---- Readouts -------------------------------------------------------------

function fmtKbps(bytes, secs) {
  return ((bytes * 8) / 1000 / secs).toFixed(0) + " kbps";
}

function drawMeter(peak, bar, label) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100;
  bar.style.width = pct.toFixed(1) + "%";
  label.textContent = db > -90 ? db.toFixed(1) + " dBFS" : "–";
}

function meterLoop() {
  drawMeter(S.localPeak, ui.localBar, ui.localDb);
  drawMeter(S.remotePeak, ui.remoteBar, ui.remoteDb);
  S.localPeak *= 0.85;
  S.remotePeak *= 0.85;
  requestAnimationFrame(meterLoop);
}
requestAnimationFrame(meterLoop);

let lastCounters = { ...S.counters };
const STATS_EVERY_MS = 1000;

async function pollRtcStats() {
  const pc = S.pc;
  if (!pc) return;
  const report = await pc.getStats();
  let pair = null;
  report.forEach((r) => {
    if (r.type === "transport" && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId);
  });
  if (!pair) {
    report.forEach((r) => {
      if (r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) pair = r;
    });
  }
  if (!pair) return;
  const local = report.get(pair.localCandidateId);
  const remote = report.get(pair.remoteCandidateId);
  const kinds = { host: "direct (LAN)", srflx: "direct (via NAT)", prflx: "direct (via NAT)", relay: "relayed (TURN)" };
  const t = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : local?.candidateType;
  S.rtc = { path: kinds[t] || t || "?", rtt: pair.currentRoundTripTime };
}

setInterval(() => {
  const c = S.counters;
  const secs = STATS_EVERY_MS / 1000;
  const p = S.playStats;
  const connected = S.dc?.readyState === "open";

  pollRtcStats().catch(() => {});
  ui.sPath.textContent = S.rtc?.path ?? "–";
  ui.sRtt.textContent = S.rtc?.rtt != null ? (S.rtc.rtt * 1000).toFixed(0) + " ms" : "–";

  ui.sOut.textContent = connected
    ? S.micOn
      ? `${fmtKbps(c.bytesOut - lastCounters.bytesOut, secs)} · ${c.sent} frames${c.sendDropped ? ` · ${c.sendDropped} dropped` : ""}`
      : "muted"
    : "–";
  ui.sIn.textContent = connected
    ? S.remoteMicOn
      ? `${fmtKbps(c.bytesIn - lastCounters.bytesIn, secs)} · ${c.received} frames`
      : "their input is off"
    : "–";

  if (S.remote) {
    const kind = S.remote.fmt === FMT_F32 ? "32-bit float" : "16-bit PCM";
    const rate = (S.remote.rate / 1000).toFixed(1) + " kHz";
    const layout = S.remote.channels === 2 ? "stereo" : "mono";
    ui.sFmt.textContent = S.resamplers.length
      ? `${kind}, ${layout}, ${rate} → resampling to ${(S.ctx.sampleRate / 1000).toFixed(1)} kHz (not bit-exact)`
      : `${kind}, ${layout}, ${rate}`;
  } else ui.sFmt.textContent = "–";

  if (p && S.active) {
    ui.sBuf.textContent = `${p.bufferedMs.toFixed(0)} ms${p.playing ? "" : " (buffering)"}`;
    ui.sPlayed.textContent = String(p.played);
    ui.sLost.textContent = `${p.lost} / ${p.late}`;
    ui.sUnder.textContent = `${p.underruns} / ${p.dropped}`;
  } else {
    ui.sBuf.textContent = ui.sPlayed.textContent = ui.sLost.textContent = ui.sUnder.textContent = "–";
  }

  lastCounters = { ...c };
}, STATS_EVERY_MS);

// ---- Init -----------------------------------------------------------------

ui.room.value = normalizeRoom(decodeURIComponent(location.hash.slice(1))) ||
  "nova-" + Math.random().toString(36).slice(2, 6);

loadPrefs();
renderDevices();
refreshDevices(); // names appear once mic permission has been granted (now or on a past visit)

if (!window.isSecureContext) {
  setStatus("This page must be opened over HTTPS for the microphone to work.", "bad");
}

// For poking at state from the devtools console.
window.nova = S;
