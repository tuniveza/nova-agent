// Nova Phone: Lossless (Nova Desk's Lossless audio, web/lossless/public/lossless/, made for the phone). Two devices,
// one room code, raw PCM over a WebRTC data channel: no media track, so no Opus, no codec. The same room server,
// wire format and worklets as Nova Desk's page, so a phone and a computer (or two phones) can be in one call.
//
// input → capture worklet (Float32 frames) → 20-byte header + PCM → RTCDataChannel "pcm"
//   → other device → parse → playback worklet (jitter buffer) → output
//
// For the phone:
//   - the AudioContext is made and resumed inside the Connect tap, before anything waits (iPhones only start
//     audio in a tap); "Tap to resume audio" when the phone pauses it (a call, the app in the background)
//   - the call lives here, not on the screen: Nova Phone can redraw or go to another place and the call goes on,
//     with a slim "In a call" bar under the title (Back to the call, Mic on/off) everywhere else
//   - the room is in the address, #lossless/<room>; links to share are https://nova.novacane.co.uk/phone/#lossless/<room>
//   - the output picker only where the browser can choose one (not on an iPhone: it uses the phone's output)
//   - the screen kept on while in a call; nothing runs when there's no call, and the meters and figures stop
//     while they're not on screen
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, field, choices, toast } = N;

  // ---- Tunables (as Nova Desk's) ----
  const FRAME_MS = 10;                // PCM frame length
  const JITTER_TARGET_FRAMES = 6;     // buffer 60 ms before playback starts
  const JITTER_MAX_FRAMES = 25;       // low latency: more than 250 ms queued → drop oldest
  // Bytes waiting in the data channel before frames are dropped: low latency short, lossless only past ~40 s
  const SEND_HIGH_WATER = { lowlatency: 512 * 1024, lossless: 8 * 1024 * 1024 };
  // Reliable but unordered: every packet arrives, one slow packet doesn't hold up the rest
  const DC_OPTIONS = { ordered: false };
  // Where the worklets are (Nova Desk's own, at /lossless/; the preview keeps copies beside it)
  const BASE = window.NovaLosslessBase || "/lossless/";
  // The address to send the other device: always the online one
  const LINK = "https://nova.novacane.co.uk/phone/#lossless/";
  // STUN until /lossless/ice answers (it adds Cloudflare's TURN relay when set up)
  const FALLBACK_ICE = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  // "?relay" in the address (/phone/?relay#lossless/my-room) forces the TURN relay
  const RELAY_ONLY = new URLSearchParams(location.search).has("relay");
  const ICE_RESTART_AFTER_MS = 3000;

  // ---- Wire format (20-byte header, little-endian, then planar PCM; see Nova Desk's app.js) ----
  const PROTO_VERSION = 2;
  const HEADER_BYTES = 20;
  const FMT_F32 = 0;
  const FMT_S16 = 1;

  const CAN_PICK_OUTPUT = typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;

  // ---- The call: one, kept here whatever the screen does ----
  const S = {
    ws: null, pc: null, dc: null, sigQueue: Promise.resolve(), pingTimer: 0,
    room: "", field: "", wanted: "", clientId: Math.random().toString(36).slice(2, 12), peerPresent: false, isOfferer: false,
    retryMs: 0, retryTimer: 0, wakeLock: null,
    ctx: null, micStream: null, micSource: null, captureNode: null, micSink: null, playbackNode: null,
    inputId: "", outputId: "", channels: 1, inputRate: 0,
    micOn: true, format: FMT_F32, mode: "lossless", seq: 0, samplePos: 0,
    ice: null, restartTimer: 0, backlogWarned: false, versionWarned: false,
    resamplers: [], remote: null, remoteMicOn: true,
    playStats: null, rtc: null,
    counters: { sent: 0, sendDropped: 0, bytesOut: 0, received: 0, bytesIn: 0 },
    localPeak: 0, remotePeak: 0, active: false, starting: false,
    status: { text: "Not connected", tone: "" },
    statsTimer: 0, turnTimer: 0, meterOn: false, allowed: false,
  };
  window.NovaLossless = S; // (for looking at from the browser's console, as Nova Desk's window.nova)

  let U = null; // the screen's parts, while it's drawn
  let deviceList = [];

  // (words changed in place, not replaced: replacing would set off Nova Phone's page watchers every frame)
  function setText(el, s) {
    if (!el) return;
    s = String(s);
    const t = el.firstChild;
    if (t && t.nodeType === 3 && !t.nextSibling) { if (t.data !== s) t.data = s; } else el.textContent = s;
  }
  function setStatus(text, tone = "") {
    S.status = { text, tone };
    if (!U) return;
    setText(U.status, text);
    U.status.dataset.tone = tone;
  }
  const normalizeRoom = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 64);
  const newRoom = () => `nova-${Math.random().toString(36).slice(2, 6)}`;

  // ---- Choices remembered on this phone (the same key as Nova Desk's: one site, one set) ----
  const PREFS_KEY = "nova-lossless-prefs";
  let prefsLoaded = false;
  function loadPrefs() {
    if (prefsLoaded) return;
    prefsLoaded = true;
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      S.inputId = typeof p.inputId === "string" ? p.inputId : "";
      S.outputId = typeof p.outputId === "string" ? p.outputId : "";
      S.channels = p.channels === 2 ? 2 : 1;
      S.format = p.format === FMT_S16 ? FMT_S16 : FMT_F32;
      S.mode = p.mode === "lowlatency" ? "lowlatency" : "lossless";
    } catch {
      // storage unavailable (private mode): the defaults are fine
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ inputId: S.inputId, outputId: S.outputId, channels: S.channels, format: S.format, mode: S.mode }));
    } catch {
      // storage unavailable
    }
  }

  // ---- Audio ----
  // Called straight from the tap, so the AudioContext is made and resumed before anything waits (iPhones)
  async function buildContext(sampleRate) {
    const ctx = new AudioContext(sampleRate ? { sampleRate, latencyHint: "interactive" } : { latencyHint: "interactive" });
    const resumed = ctx.resume();
    await Promise.all([
      ctx.audioWorklet.addModule(`${BASE}capture-worklet.js`),
      ctx.audioWorklet.addModule(`${BASE}playback-worklet.js`),
    ]);
    // (a phone that won't start the sound yet, or has nowhere to play it: the call goes on, and "Tap to resume
    // audio" shows, rather than waiting at "Starting audio…" for ever)
    await Promise.race([resumed.catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    return ctx;
  }
  function openInput() {
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: S.inputId ? { exact: S.inputId } : undefined, channelCount: { ideal: S.channels }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  }
  // The chosen input, or the default if it's gone (unplugged headset, a different phone)
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
  function attachInput(stream) {
    const ctx = S.ctx;
    const source = ctx.createMediaStreamSource(stream); // may throw on Firefox at a different rate
    const frameSize = Math.round((ctx.sampleRate * FRAME_MS) / 1000);
    const node = new AudioWorkletNode(ctx, "nova-capture", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: S.channels, channelCountMode: "explicit", channelInterpretation: "speakers",
      processorOptions: { frameSize, channels: S.channels },
    });
    node.port.onmessage = (e) => onLocalFrame(e.data);
    source.connect(node);
    // (some browsers only run a node that leads to the speakers: through a muted gain)
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
  async function startAudio(ctxPromise) {
    let stream;
    try {
      stream = await openInputOrDefault();
    } catch (err) {
      ctxPromise.then((ctx) => ctx.close(), () => {});
      throw err;
    }
    try {
      S.ctx = await ctxPromise;
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw err;
    }
    try {
      attachInput(stream);
    } catch (err) {
      // Firefox won't join an input to a context at a different rate from the hardware: the phone's own rate
      // then (the other side resamples)
      console.warn("48 kHz context rejected the input, using native rate:", err);
      await S.ctx.close();
      S.ctx = await buildContext(0);
      attachInput(stream);
    }
    const ctx = S.ctx;
    S.playbackNode = new AudioWorkletNode(ctx, "nova-playback", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { targetFrames: JITTER_TARGET_FRAMES, maxFrames: JITTER_MAX_FRAMES, lossless: S.mode === "lossless" },
    });
    S.playbackNode.port.onmessage = (e) => { if (e.data.type === "stats") S.playStats = e.data; };
    S.playbackNode.connect(ctx.destination);
    await applyOutput();
    ctx.onstatechange = renderResume;
  }
  async function stopAudio() {
    detachInput();
    if (S.ctx && S.ctx.state !== "closed") await S.ctx.close().catch(() => {});
    S.ctx = S.playbackNode = null;
    S.inputRate = 0;
    S.playStats = null;
  }
  // Another input or channel count mid-call
  async function restartInput() {
    if (!S.active || !S.ctx) return;
    try {
      attachInput(await openInputOrDefault());
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't switch input: ${err.message}`, "bad");
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

  // ---- Devices ----
  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      deviceList = await navigator.mediaDevices.enumerateDevices();
    } catch {
      deviceList = [];
    }
    // (names only show once the microphone's been allowed, now or on an earlier visit)
    S.allowed = deviceList.some((d) => d.kind === "audioinput" && d.label);
    renderDevices();
  }
  const real = (kind) => deviceList.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
  function fillSelect(select, kind, current, defaultLabel) {
    const list = real(kind);
    select.replaceChildren(new Option(defaultLabel, ""));
    list.forEach((d, i) => select.add(new Option(d.label || `${kind === "audioinput" ? "Input" : "Output"} ${i + 1}`, d.deviceId)));
    select.value = list.some((d) => d.deviceId === current) ? current : "";
  }
  const labelOf = (kind, id) => (id ? deviceList.find((d) => d.kind === kind && d.deviceId === id)?.label || "" : "");
  function renderDevices() {
    if (!U) return;
    fillSelect(U.input, "audioinput", S.inputId, "Default microphone");
    U.inputHint.hidden = S.allowed;
    // (an output to choose only where the browser can send sound to one, and there's more than the default)
    const outs = CAN_PICK_OUTPUT ? real("audiooutput") : [];
    U.outputBox.hidden = !outs.length;
    U.outputNote.hidden = !!outs.length;
    if (outs.length) fillSelect(U.output, "audiooutput", S.outputId, "Default output");
    for (const [name, v] of [["format", S.format], ["mode", S.mode], ["channels", S.channels]]) {
      const r = U.root.querySelector(`input[name="lossless-${name}"][value="${v}"]`);
      if (r) r.checked = true;
    }
    setText(U.modeHint, S.mode === "lossless" ? "Every sample arrives; the delay grows if the network needs it." : "Keeps the delay short, gaps if packets are late.");
    renderRouting();
  }
  function renderRouting() {
    if (!U) return;
    const notes = [];
    const inLabel = labelOf("audioinput", S.inputId);
    const outLabel = labelOf("audiooutput", S.outputId);
    const norm = (s) => s.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
    if (inLabel && outLabel && norm(inLabel) === norm(outLabel)) {
      notes.push(`Input and output are both "${inLabel}". What you receive will be sent straight back, so they'll hear themselves. Use two different devices (e.g. BlackHole 2ch out, BlackHole 16ch in).`);
    }
    // (only for a device chosen on purpose: a phone's own mic can't be changed, so no nagging)
    if (S.inputId && S.ctx && S.inputRate && S.inputRate !== S.ctx.sampleRate) {
      notes.push(`This input is running at ${(S.inputRate / 1000).toFixed(1)} kHz, so the browser converts it to ${(S.ctx.sampleRate / 1000).toFixed(1)} kHz before sending. For bit-exact audio, set the device to ${S.ctx.sampleRate} Hz (on a Mac: Audio MIDI Setup).`);
    }
    if (/blackhole/i.test(inLabel) && S.channels === 1) notes.push("BlackHole input in mono: a stereo mix from your DAW will be folded to mono. Switch Channels to Stereo.");
    U.routing.hidden = !notes.length;
    setText(U.routing, notes.join(" "));
  }
  function peakOf(chans) {
    let p = 0;
    for (const samples of chans) for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > p) p = a; }
    return p;
  }

  // ---- Sending ----
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
        for (let i = 0; i < n; i++) { const s = src[i] < -1 ? -1 : src[i] > 1 ? 1 : src[i]; out[base + i] = Math.round(s * 32767); }
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
    // The network can't keep up: low latency drops at once; lossless only when the connection plainly can't carry it
    if (dc.bufferedAmount > SEND_HIGH_WATER[S.mode]) {
      S.counters.sendDropped++;
      if (S.mode === "lossless" && !S.backlogWarned) {
        S.backlogWarned = true;
        setStatus("The connection can't carry this much audio, so some is being dropped. Try 16-bit or mono.", "bad");
      }
      return;
    }
    const packet = encodeFrame(seq, chans, timestamp);
    try {
      dc.send(packet);
    } catch {
      return; // (closing)
    }
    S.counters.sent++;
    S.counters.bytesOut += packet.byteLength;
  }

  // ---- Receiving ----
  // Only if the two devices end up at different rates (rare: both ask for 48 kHz). Not bit-exact; the figures say so.
  class LinearResampler {
    constructor(inRate, outRate) { this.inRate = inRate; this.step = inRate / outRate; this.pos = 0; this.prev = 0; }
    process(input) {
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
      try { const msg = JSON.parse(data); if (msg.type === "mic") S.remoteMicOn = !!msg.on; } catch {}
      return;
    }
    if (!S.ctx || !S.playbackNode || data.byteLength < HEADER_BYTES) return;
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
      if (fmt === FMT_F32) chans.push(new Float32Array(data, HEADER_BYTES + c * n * 4, n));
      else {
        const src = new Int16Array(data, HEADER_BYTES + c * n * 2, n);
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = src[i] / 32767;
        chans.push(f);
      }
    }
    if (rate !== S.ctx.sampleRate) {
      if (S.resamplers.length !== C || S.resamplers[0].inRate !== rate) S.resamplers = chans.map(() => new LinearResampler(rate, S.ctx.sampleRate));
      chans = chans.map((ch, c) => S.resamplers[c].process(ch));
    } else S.resamplers = [];
    S.remotePeak = Math.max(S.remotePeak, peakOf(chans));
    const transfer = [...new Set(chans.map((ch) => ch.buffer))];
    S.playbackNode.port.postMessage({ type: "frame", seq, chans }, transfer);
  }

  // ---- WebRTC ----
  // STUN and TURN for a call, from Nova Bot (TURN credentials last 6 hours)
  async function iceConfig() {
    if (S.ice && (!S.ice.turn || S.ice.expires - Date.now() > 30 * 60 * 1000)) return S.ice;
    try {
      const res = await fetch("/lossless/ice", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const j = await res.json();
      S.ice = { iceServers: j.iceServers, turn: !!j.turn, expires: Date.now() + (j.ttl || 0) * 1000, note: j.note || "" };
    } catch (err) {
      console.warn("Couldn't get ICE servers, using STUN only:", err);
      S.ice = { iceServers: FALLBACK_ICE, turn: false, expires: 0, note: "couldn't reach the relay setup" };
    }
    if (RELAY_ONLY && !S.ice.turn) setStatus(`?relay is on but there's no TURN relay (${S.ice.note}), so this can't connect.`, "bad");
    return S.ice;
  }
  // Long calls: fresh TURN credentials before the old ones run out (checked every 5 minutes while in a call)
  async function refreshTurn() {
    if (!S.pc || !S.ice?.turn || S.ice.expires - Date.now() > 30 * 60 * 1000) return;
    const ice = await iceConfig();
    try {
      S.pc?.setConfiguration({ ...S.pc.getConfiguration(), iceServers: ice.iceServers });
    } catch (err) {
      console.warn("Couldn't refresh TURN credentials:", err);
    }
  }
  function createPeer(isOfferer, ice) {
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: RELAY_ONLY ? "relay" : "all" });
    S.pc = pc;
    S.isOfferer = isOfferer;
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ type: "candidate", candidate: e.candidate }); };
    pc.onconnectionstatechange = () => {
      if (S.pc !== pc) return;
      const st = pc.connectionState;
      if (st === "connecting") setStatus(S.ice?.turn ? "Connecting (directly if possible, otherwise through the relay)…" : "Connecting peer to peer…", "warn");
      if (st === "connected") {
        clearTimeout(S.restartTimer);
        if (callUp()) setStatus("Connected: streaming lossless PCM", "good");
      }
      if (st === "disconnected") {
        // The network changed or hiccuped (Wi-Fi to mobile data, a tunnel): a moment, then a new route, same call
        setStatus("Connection interrupted, finding a new route…", "warn");
        clearTimeout(S.restartTimer);
        S.restartTimer = setTimeout(() => { if (S.pc === pc && pc.connectionState !== "connected" && S.isOfferer) enqueue(restartRoute); }, ICE_RESTART_AFTER_MS);
      }
      if (st === "failed") {
        if (callUp()) {
          if (S.isOfferer) return enqueue(restartRoute);
          clearTimeout(S.restartTimer);
          S.restartTimer = setTimeout(() => S.pc === pc && pc.connectionState !== "connected" && callDropped("Couldn't find a new route, reconnecting…"), 20000);
          return;
        }
        callDropped(S.ice?.turn
          ? "Couldn't connect, even through the relay. Check both devices are online, then try again."
          : "Couldn't connect directly, and the TURN relay isn't set up (see README), so different networks may not reach each other.");
      }
      renderPill();
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
      renderControls();
    };
    dc.onclose = () => { if (S.dc === dc && S.active) callDropped("Audio connection dropped, reconnecting…"); };
    dc.onmessage = (e) => onRemoteData(e.data);
  }
  const callUp = () => S.dc?.readyState === "open";
  function closePeer() {
    clearTimeout(S.restartTimer);
    S.dc?.close();
    S.pc?.close();
    S.dc = S.pc = null;
    S.rtc = null;
    S.remote = null;
    S.resamplers = [];
    S.playbackNode?.port.postMessage({ type: "reset" });
  }
  // The link died: if the other device is still in the room, the side that offered first offers again
  function callDropped(text) {
    closePeer();
    renderControls();
    if (!S.peerPresent) return setStatus(`Other device left. Waiting in "${S.room}"…`, "warn");
    setStatus(text, "warn");
    if (S.isOfferer) setTimeout(() => S.active && !S.pc && enqueue(makeOffer), 1000);
  }
  async function makeOffer() {
    const ice = await iceConfig();
    closePeer();
    const pc = createPeer(true, ice);
    await pc.setLocalDescription(await pc.createOffer());
    sendSignal({ type: "offer", sdp: pc.localDescription });
  }
  async function handleOffer(sdp, restart) {
    // A new route for the call that's up: the same connection (and its audio)
    if (restart && S.pc && !S.isOfferer && S.pc.signalingState === "stable") {
      await S.pc.setRemoteDescription(sdp);
      await S.pc.setLocalDescription(await S.pc.createAnswer());
      sendSignal({ type: "answer", sdp: S.pc.localDescription });
      return;
    }
    const ice = await iceConfig();
    closePeer();
    const pc = createPeer(false, ice);
    await pc.setRemoteDescription(sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    sendSignal({ type: "answer", sdp: pc.localDescription });
  }
  // ICE restart: the same call, a new path (fresh TURN credentials too); still nowhere after 15 s, start over
  async function restartRoute() {
    const pc = S.pc;
    if (!pc || pc.connectionState === "connected" || pc.signalingState !== "stable") return;
    const ice = await iceConfig();
    pc.setConfiguration({ ...pc.getConfiguration(), iceServers: ice.iceServers });
    await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
    sendSignal({ type: "offer", sdp: pc.localDescription, restart: true });
    clearTimeout(S.restartTimer);
    S.restartTimer = setTimeout(() => { if (S.pc === pc && pc.connectionState !== "connected") callDropped("Couldn't find a new route, reconnecting…"); }, 15000);
  }

  // ---- Signalling: the room server only introduces the two devices; once the call is up, audio doesn't need it ----
  function sendSignal(msg) { if (S.ws?.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify(msg)); }
  // (strictly in order, so ICE candidates never race their SDP)
  function enqueue(fn) { S.sigQueue = S.sigQueue.then(fn).catch((err) => console.error("signalling", err)); }
  async function onSignal(msg) {
    switch (msg.type) {
      case "welcome":
        S.peerPresent = msg.peers > 0;
        if (callUp()) break; // (back on the server mid-call)
        if (S.peerPresent) {
          setStatus("Other device found, connecting…", "warn");
          await makeOffer();
        } else setStatus(`Waiting for the other device to join "${S.room}"…`, "warn");
        break;
      case "peer-joined":
        S.peerPresent = true;
        if (callUp()) break;
        closePeer(); // (they'll offer)
        setStatus("Other device joined, connecting…", "warn");
        break;
      case "peer-left":
        S.peerPresent = false;
        if (callUp()) break; // (their server link dropped, the audio's still flowing)
        closePeer();
        setStatus(`Other device left. Waiting in "${S.room}"…`, "warn");
        break;
      case "offer":
        S.peerPresent = true;
        await handleOffer(msg.sdp, msg.restart === true);
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
    renderControls();
  }
  function openSignalling() {
    // (this site's own /lossless/ws: wss: on the live site)
    const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/lossless/ws?room=${encodeURIComponent(S.room)}&client=${S.clientId}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      setStatus(`Couldn't reach the room server: ${err.message}`, "bad");
      return;
    }
    S.ws = ws;
    ws.onopen = () => {
      S.retryMs = 0;
      clearInterval(S.pingTimer);
      S.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 15000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      enqueue(() => onSignal(msg));
    };
    ws.onclose = () => {
      if (S.ws !== ws) return;
      clearInterval(S.pingTimer);
      S.ws = null;
      if (!S.active) return;
      // Back off 1 s, 2 s, 4 s … up to 10 s
      S.retryMs = Math.min(10000, (S.retryMs || 500) * 2);
      if (!callUp()) setStatus("Lost the room server, reconnecting…", "warn");
      S.retryTimer = setTimeout(() => S.active && !S.ws && openSignalling(), S.retryMs);
    };
  }

  // Phones dim and lock after a minute, which pauses the audio: the screen kept on while in a call
  async function keepScreenOn() {
    if (!(S.active || S.starting) || S.wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!(S.active || S.starting)) return lock.release().catch(() => {});
      S.wakeLock = lock;
      lock.onrelease = () => { if (S.wakeLock === lock) S.wakeLock = null; };
    } catch {
      // not allowed now (battery saver): harmless
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !S.active) return;
    keepScreenOn();
    // Back in the app: audio and the room server alive again, the meters going
    if (S.ctx && S.ctx.state !== "running") S.ctx.resume().catch(() => {}).finally(renderResume);
    if (!S.ws) {
      clearTimeout(S.retryTimer);
      S.retryMs = 0;
      openSignalling();
    }
    startMeters();
  });

  // ---- Controls ----
  // The Connect tap: the AudioContext and the screen lock asked for at once, before anything waits (iPhones)
  function onConnectTap() {
    if (S.starting) return;
    if (S.active) return disconnect();
    const room = normalizeRoom(U?.room.value || S.field);
    if (!room) return setStatus("Enter a room code first.", "bad");
    // iPhones (Safari 16.4+): playback and the microphone together
    try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
    const ctxPromise = buildContext(48000);
    ctxPromise.catch(() => {});
    S.starting = true;
    markBusy(true);
    S.field = room;
    if (U) U.room.value = room;
    keepScreenOn();
    connect(room, ctxPromise);
  }
  async function connect(room, ctxPromise) {
    if (/^#lossless(\/|$)/.test(location.hash)) history.replaceState(null, "", `#lossless/${room}`);
    renderControls();
    setStatus("Starting audio…");
    try {
      await startAudio(ctxPromise);
    } catch (err) {
      console.error(err);
      const why = err.name === "NotAllowedError" ? "Microphone permission was denied." : err.message;
      S.starting = false;
      markBusy(false);
      setStatus(`Couldn't start audio: ${why}`, "bad");
      await stopAudio();
      releaseLock();
      renderControls();
      return;
    }
    await refreshDevices(); // (device names only show once the mic's allowed)
    S.starting = false;
    S.active = true;
    S.room = room;
    S.seq = 0;
    S.retryMs = 0;
    S.peerPresent = false;
    S.backlogWarned = false;
    Object.keys(S.counters).forEach((k) => (S.counters[k] = 0));
    last = { ...S.counters, at: performance.now() };
    renderControls();
    renderResume();
    setStatus("Joining room…", "warn");
    keepScreenOn();
    openSignalling();
    clearInterval(S.statsTimer);
    S.statsTimer = setInterval(tick, 1000);
    clearInterval(S.turnTimer);
    S.turnTimer = setInterval(() => refreshTurn().catch(() => {}), 5 * 60 * 1000);
    startMeters();
  }
  // (in a call, Nova Phone doesn't refresh itself for an update: shell.js waits while a form.dirty is on the page)
  let busyMark = null;
  function markBusy(on) {
    if (on && !busyMark) {
      busyMark = Object.assign(document.createElement("form"), { className: "dirty lossless-busy", hidden: true });
      busyMark.setAttribute("aria-hidden", "true");
      document.body.append(busyMark);
    } else if (!on && busyMark) { busyMark.remove(); busyMark = null; }
  }
  function releaseLock() {
    S.wakeLock?.release().catch(() => {});
    S.wakeLock = null;
  }
  async function disconnect(keepStatus = false) {
    S.active = false;
    S.starting = false;
    clearInterval(S.pingTimer);
    clearTimeout(S.retryTimer);
    clearInterval(S.statsTimer);
    clearInterval(S.turnTimer);
    const ws = S.ws;
    S.ws = null;
    ws?.close();
    closePeer();
    releaseLock();
    markBusy(false);
    await stopAudio();
    S.localPeak = S.remotePeak = 0;
    // (a link to another room opened during the call: that room's ready to join now)
    if (S.wanted) { S.field = S.wanted; S.wanted = ""; if (U) U.room.value = S.field; }
    renderControls();
    renderResume();
    renderRouting();
    renderStats();
    drawMeters(true);
    if (!keepStatus) setStatus("Not connected");
  }
  function toggleMic() {
    if (!S.active) return;
    S.micOn = !S.micOn;
    if (S.dc?.readyState === "open") S.dc.send(JSON.stringify({ type: "mic", on: S.micOn }));
    renderControls();
  }
  async function shareLink(how) {
    const room = normalizeRoom(U?.room.value || S.room || S.field);
    if (!room) return setStatus("Enter a room code first.", "bad");
    const link = LINK + room;
    if (how === "share") {
      try {
        await navigator.share({ title: "Lossless audio", text: `Join my Lossless call, room ${room}:`, url: link });
      } catch (err) {
        if (err.name !== "AbortError") showLink(link);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied");
    } catch {
      showLink(link);
    }
  }
  // (the phone wouldn't copy: the link to copy by hand)
  function showLink(link) {
    N.form(`<h2 class="sheet-title">The link to send</h2><p class="sheet-text">Press and hold it to copy it.</p>
      ${field({ label: "Link", name: "lossless-link", value: link, attrs: 'readonly autocapitalize="off" spellcheck="false"' })}
      <button type="button" class="btn wide main" data-done>Done</button>`, (el, done) => {
      const input = el.querySelector("input");
      input.addEventListener("focus", () => input.select());
      el.querySelector("[data-done]").onclick = () => done(true);
    });
  }

  // ---- What the screen shows ----
  function renderControls() {
    renderPill();
    if (!U) return;
    const on = S.active || S.starting;
    U.connect.className = `btn wide ${on ? "danger" : "main"}`;
    U.connect.disabled = S.starting;
    U.connect.innerHTML = S.starting ? "Starting…" : S.active ? `${icon("phone")} Disconnect` : `${icon("play")} Connect`;
    U.room.disabled = on;
    for (const el of U.calm) el.hidden = on;
    if (on) U.room.value = S.room || S.field;
    U.mic.disabled = !S.active;
    U.mic.dataset.on = S.micOn ? "1" : "0";
    U.mic.setAttribute("aria-pressed", String(S.micOn));
    setText(U.micWords, S.micOn ? "Mic on" : "Mic off");
    U.other.hidden = !(on && S.wanted && S.wanted !== S.room);
    if (!U.other.hidden) setText(U.other, `That link is for "${S.wanted}". You're in "${S.room || S.field}": disconnect first to join it.`);
  }
  function renderResume() {
    const show = S.active && S.ctx && S.ctx.state !== "running" && S.ctx.state !== "closed";
    if (U) U.resume.hidden = !show;
    if (pill) pill.dataset.paused = show ? "1" : "";
  }
  // The meters: You and Them in dBFS, about 20 times a second, only while they're on screen in a call
  let meterAt = 0;
  function startMeters() {
    if (S.meterOn || !S.active || document.hidden || !U?.root.isConnected) return;
    S.meterOn = true;
    meterAt = performance.now();
    requestAnimationFrame(meterLoop);
  }
  function meterLoop(now) {
    if (!S.active || document.hidden || !U?.root.isConnected) { S.meterOn = false; return; }
    if (now - meterAt >= 48) {
      const fall = Math.pow(0.85, (now - meterAt) / 16.7); // (as Nova Desk's, which falls by 0.85 a frame at 60 a second)
      meterAt = now;
      drawMeters();
      S.localPeak *= fall;
      S.remotePeak *= fall;
    }
    requestAnimationFrame(meterLoop);
  }
  function drawMeter(peak, bar, label) {
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const lvl = (Math.max(0, Math.min(1, (db + 60) / 60))).toFixed(3);
    if (bar.dataset.lvl !== lvl) { bar.dataset.lvl = lvl; bar.style.setProperty("--lvl", lvl); }
    setText(label, db > -90 ? `${db.toFixed(1)} dBFS` : "–");
  }
  function drawMeters(off) {
    if (!U) return;
    drawMeter(off ? 0 : S.localPeak, U.localBar, U.localDb);
    drawMeter(off ? 0 : S.remotePeak, U.remoteBar, U.remoteDb);
  }
  // The figures, once a second while in a call (the work skipped while they're not on screen)
  let last = { ...S.counters, at: 0 };
  const kbps = (bytes, secs) => `${((bytes * 8) / 1000 / secs).toFixed(0)} kbps`;
  async function pollRtcStats() {
    const pc = S.pc;
    if (!pc) return;
    const report = await pc.getStats();
    let pair = null;
    report.forEach((r) => { if (r.type === "transport" && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId); });
    if (!pair) report.forEach((r) => { if (r.type === "candidate-pair" && (r.selected || (r.nominated && r.state === "succeeded"))) pair = r; });
    if (!pair) return;
    const local = report.get(pair.localCandidateId);
    const remote = report.get(pair.remoteCandidateId);
    const kinds = { host: "direct (LAN)", srflx: "direct (via NAT)", prflx: "direct (via NAT)", relay: "relayed (TURN)" };
    const t = local?.candidateType === "relay" || remote?.candidateType === "relay" ? "relay" : local?.candidateType;
    S.rtc = { path: kinds[t] || t || "?", rtt: pair.currentRoundTripTime };
  }
  function tick() {
    const now = performance.now();
    const secs = Math.max(0.25, (now - (last.at || now - 1000)) / 1000);
    const seen = U?.root.isConnected && !document.hidden;
    if (seen) {
      pollRtcStats().catch(() => {});
      renderStats(secs);
    }
    last = { ...S.counters, at: now };
  }
  function renderStats(secs = 1) {
    if (!U) return;
    const c = S.counters;
    const p = S.playStats;
    const connected = S.dc?.readyState === "open";
    const f = U.facts;
    setText(f.path, S.active ? S.rtc?.path ?? "–" : "–");
    setText(f.rtt, S.active && S.rtc?.rtt != null ? `${(S.rtc.rtt * 1000).toFixed(0)} ms` : "–");
    // (audio waiting to go out, as time: the network's slower than the stream)
    const rate = (S.ctx?.sampleRate || 48000) * S.channels * (S.format === FMT_F32 ? 4 : 2);
    const backlogMs = connected ? (S.dc.bufferedAmount / rate) * 1000 : 0;
    setText(f.out, connected ? (S.micOn ? `${kbps(c.bytesOut - last.bytesOut, secs)} · ${c.sent} frames${backlogMs > 100 ? ` · ${(backlogMs / 1000).toFixed(1)} s waiting to send` : ""}${c.sendDropped ? ` · ${c.sendDropped} dropped` : ""}` : "muted") : "–");
    setText(f.in, connected ? (S.remoteMicOn ? `${kbps(c.bytesIn - last.bytesIn, secs)} · ${c.received} frames` : "their input is off") : "–");
    if (S.remote && S.ctx) {
      const kind = S.remote.fmt === FMT_F32 ? "32-bit float" : "16-bit PCM";
      const r = `${(S.remote.rate / 1000).toFixed(1)} kHz`;
      const layout = S.remote.channels === 2 ? "stereo" : "mono";
      setText(f.fmt, S.resamplers.length ? `${kind}, ${layout}, ${r} → resampling to ${(S.ctx.sampleRate / 1000).toFixed(1)} kHz (not bit-exact)` : `${kind}, ${layout}, ${r}`);
    } else setText(f.fmt, "–");
    U.catchup.disabled = !(connected && p && p.bufferedMs > 150);
    if (p && S.active) {
      setText(f.buf, `${p.bufferedMs.toFixed(0)} ms${p.lossless ? ` (aiming for ${p.targetMs.toFixed(0)} ms)` : ""}${p.playing ? "" : " (waiting for audio)"}`);
      setText(f.played, p.played);
      setText(f.lost, `${p.lost} / ${p.late}`);
      setText(f.under, `${p.underruns} / ${p.dropped}`);
    } else for (const k of ["buf", "played", "lost", "under"]) setText(f[k], "–");
  }

  // ---- In a call, somewhere else in Nova Phone: a slim bar under the title, back to the call or mic on/off ----
  let pill = null;
  function renderPill() {
    const away = (S.active || S.starting) && !/^#lossless(\/|$)/.test(location.hash);
    if (!away) { if (pill) pill.hidden = true; return; }
    if (!pill) {
      const top = document.querySelector(".app > .top") || document.querySelector(".top");
      if (!top) return;
      pill = document.createElement("div");
      pill.className = "lossless-pill";
      pill.setAttribute("role", "status");
      pill.innerHTML = `<a class="lossless-pill-go" data-go><i class="lossless-pill-dot" aria-hidden="true"></i><span><b>In a call</b> <span data-pill-room></span></span>${icon("next")}</a>
        <button type="button" class="lossless-pill-mic" data-pill-mic aria-pressed="true">Mic on</button>`;
      pill.querySelector("[data-pill-mic]").addEventListener("click", toggleMic);
      // (the phone paused the sound: this tap brings it back, on the way to the call)
      pill.querySelector("[data-go]").addEventListener("click", () => { if (S.ctx && S.ctx.state !== "running" && S.ctx.state !== "closed") S.ctx.resume().catch(() => {}).finally(renderResume); });
      top.append(pill);
      N.css("lossless.css");
    }
    pill.hidden = false;
    pill.dataset.tone = callUp() ? "good" : "warn";
    pill.querySelector("[data-go]").setAttribute("href", `#lossless/${S.room || S.field}`);
    setText(pill.querySelector("[data-pill-room]"), S.room || S.field);
    const mic = pill.querySelector("[data-pill-mic]");
    mic.disabled = !S.active;
    mic.dataset.on = S.micOn ? "1" : "0";
    mic.setAttribute("aria-pressed", String(S.micOn));
    setText(mic, S.micOn ? "Mic on" : "Mic off");
  }
  addEventListener("hashchange", renderPill);
  navigator.mediaDevices?.addEventListener?.("devicechange", () => { if (U?.root.isConnected || S.active) refreshDevices(); });

  // ---- The screen ----
  const fact = (label, key, wide) => `<div class="fact${wide ? " wide" : ""}"><span>${esc(label)}</span><b data-f="${key}">–</b></div>`;
  N.section({
    id: "lossless",
    name: "Lossless",
    tile: "lossless",
    async draw(box, [asked], ui) {
      await N.css("lossless.css");
      loadPrefs();
      ui.title("Lossless audio");
      const wanted = normalizeRoom(asked ? decodeURIComponent(asked) : "");
      if (S.active || S.starting) S.wanted = wanted && wanted !== S.room ? wanted : "";
      else S.field = wanted || S.field || newRoom();
      const canShare = !!navigator.share;
      box.classList.add("lossless-page");
      box.innerHTML = `<p class="muted small lossless-intro">Raw PCM between two devices over a WebRTC data channel. No Opus, no codec.</p>
        <form class="card lossless-room" data-room novalidate>
          <h2 class="card-title">Room</h2>
          ${field({ label: "Room code", name: "room", value: S.field, hint: "The same code on both devices. Letters, numbers and dashes.", attrs: 'maxlength="64" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"' })}
          <p class="lossless-other" data-other hidden></p>
          ${window.NovaLosslessNote ? `<p class="muted small" data-preview-note>${esc(window.NovaLosslessNote)}</p>` : ""}
          <button type="submit" class="btn wide main" data-connect>${icon("play")} Connect</button>
          <p class="lossless-status" data-status data-tone="" role="status" aria-live="polite">Not connected</p>
          <button type="button" class="btn wide main" data-resume hidden>${icon("play")} Tap to resume audio</button>
          <div class="btns two">${canShare ? `<button type="button" class="btn" data-share>${icon("share")} Share link</button>` : ""}<button type="button" class="btn" data-copy>${icon("send")} Copy link</button></div>
          <p class="lossless-head" data-head><b>Wear headphones on both ends.</b> Echo cancellation is off so the sound is untouched, which means a speaker feeds back into the mic.</p>
        </form>
        <section class="card lossless-live">
          <h2 class="card-title">Live</h2>
          <div class="btns two">
            <button type="button" class="btn lossless-mic" data-mic disabled aria-pressed="true" data-on="1"><span data-mic-words>Mic on</span></button>
            <button type="button" class="btn" data-catchup disabled>Catch up</button>
          </div>
          <p class="muted small">Catch up skips the audio that's built up, to bring the delay back down.</p>
          <div class="lossless-meter"><div class="meter-top"><b>You (mic)</b><span data-db="local">–</span></div><i class="lossless-bar"><i data-bar="local"></i></i></div>
          <div class="lossless-meter"><div class="meter-top"><b>Them</b><span data-db="remote">–</span></div><i class="lossless-bar"><i data-bar="remote"></i></i></div>
        </section>
        <section class="card lossless-sound">
          <h2 class="card-title">Sound</h2>
          <div class="form">
            <div>${choices({ label: "Send format", name: "lossless-format", value: S.format, options: [[FMT_F32, "32-bit float"], [FMT_S16, "16-bit"]] })}
              <p class="muted small lossless-hint">32-bit float is bit-exact. 16-bit is half the bandwidth.</p></div>
            <div>${choices({ label: "Mode", name: "lossless-mode", value: S.mode, options: [["lossless", "Lossless"], ["lowlatency", "Low latency"]] })}
              <p class="muted small lossless-hint" data-mode-hint></p></div>
            <div>${choices({ label: "Channels", name: "lossless-channels", value: S.channels, options: [[1, "Mono"], [2, "Stereo"]] })}
              <p class="muted small lossless-hint">Mono is about 1.5 Mbps as float, stereo about 3 Mbps. On mobile data, mono or 16-bit is kinder.</p></div>
            ${field({ label: "Input (what you send)", name: "lossless-input", type: "select", options: [["", "Default microphone"]] })}
            <p class="muted small lossless-hint" data-input-hint>The other microphones (a headset, a USB interface) show here once you've allowed the microphone.</p>
            <div data-output-box hidden>${field({ label: "Output (where their audio plays)", name: "lossless-output", type: "select", options: [["", "Default output"]] })}</div>
            <p class="muted small lossless-hint" data-output-note>Their audio plays through the phone's output: the speaker, or your headphones when they're in.${CAN_PICK_OUTPUT ? "" : " (This browser can't choose an output.)"}</p>
            <p class="lossless-warn" data-routing hidden></p>
          </div>
        </section>
        <section class="card">
          <h2 class="card-title">The connection</h2>
          <div class="lossless-stats">${fact("Path", "path")}${fact("Round trip", "rtt")}${fact("Sending", "out", 1)}${fact("Receiving", "in", 1)}${fact("Their format", "fmt", 1)}${fact("Delay buffer", "buf", 1)}${fact("Frames played", "played")}${fact("Lost / late", "lost")}${fact("Pauses / skipped", "under")}</div>
        </section>
        <section class="card lossless-notes">
          <h2 class="card-title">Good to know</h2>
          <p><b>Wear headphones on both ends</b> (unless you're routing through BlackHole). Echo cancellation is deliberately off so the PCM is untouched, which means speakers will feed back into the mic.</p>
          <p>Every frame is bit-exact (the data channel is checksummed and encrypted end to end). In <b>Lossless</b> mode every frame is delivered and played: if the network hiccups, playback pauses and waits rather than skipping, and the delay grows to whatever the connection needs. Use <b>Catch up</b> to bring it back down. <b>Low latency</b> mode skips late frames instead.</p>
          <p><b>Different networks, anywhere in the world:</b> if the two devices can't reach each other directly, the call goes through a relay (Path shows "relayed (TURN)"). To test the relay from one network, open Nova Phone with <code>?relay</code> before the <code>#</code>, e.g. <code>/phone/?relay#lossless/my-room</code>, on one device.</p>
          <p>The other device can be a phone or a computer: on a computer, the same room code works in Nova Desk's Lossless audio.</p>
          <p>Keep Nova Phone open during the call: the screen stays on, and if the phone pauses the sound (a phone call, another app) it asks you to tap to resume.</p>
        </section>
        <details class="card lossless-daw">
          <summary>Logic Pro or any DAW</summary>
          <p>Using this with Logic Pro (or any DAW) via BlackHole, on a Mac:</p>
          <ol>
            <li>Use <b>Chrome or Edge</b> on the Mac. Safari can't choose an output device.</li>
            <li>Install two free BlackHole drivers from <a href="https://existential.audio/blackhole/" target="_blank" rel="noopener">existential.audio</a>: <b>BlackHole 2ch</b> and <b>BlackHole 16ch</b>. You need one for each direction, otherwise their audio loops straight back to them.</li>
            <li>In <b>Audio MIDI Setup</b>, set both BlackHole devices to <b>48,000 Hz</b>, and use 48 kHz for your Logic project. Matching rates means nothing gets resampled.</li>
            <li>Still in Audio MIDI Setup, click <b>+</b> → <b>Create Multi-Output Device</b> and tick your headphones and <b>BlackHole 16ch</b>. You'll hear Logic, and so will they.</li>
            <li>On the Mac's Lossless page, set <b>Input: BlackHole 16ch</b>, <b>Output: BlackHole 2ch</b> and <b>Channels: Stereo</b>, then Connect.</li>
            <li>In Logic, go to <b>Settings → Audio → Devices</b>. Set <b>Input Device: BlackHole 2ch</b> and <b>Output Device: Multi-Output Device</b>.</li>
            <li><b>To record them:</b> make a stereo audio track with input 1–2, arm it and hit record. <b>To send to them:</b> anything Logic plays through its main output goes to them.</li>
            <li>Watch out: if you monitor their track in Logic, it plays through the main output and they'll hear themselves delayed. Turn input monitoring off on that track. You'll still hear them on the Multi-Output Device.</li>
          </ol>
        </details>`;
      const q = (s) => box.querySelector(s);
      const parts = {
        root: box, room: q('input[name="room"]'), connect: q("[data-connect]"), other: q("[data-other]"), status: q("[data-status]"), resume: q("[data-resume]"),
        mic: q("[data-mic]"), micWords: q("[data-mic-words]"), catchup: q("[data-catchup]"),
        localBar: q('[data-bar="local"]'), remoteBar: q('[data-bar="remote"]'), localDb: q('[data-db="local"]'), remoteDb: q('[data-db="remote"]'),
        input: q('select[name="lossless-input"]'), inputHint: q("[data-input-hint]"), output: q('select[name="lossless-output"]'), outputBox: q("[data-output-box]"), outputNote: q("[data-output-note]"),
        modeHint: q("[data-mode-hint]"), routing: q("[data-routing]"), calm: [q('input[name="room"]').closest("label")?.querySelector("small"), q("[data-preview-note]"), q("[data-head]")].filter(Boolean),
        facts: Object.fromEntries([...box.querySelectorAll("[data-f]")].map((el) => [el.dataset.f, el])),
      };
      parts.room.classList.add("mono");
      // Enter (Go on the keyboard) or Connect: connects; while in a call, Disconnect
      q("[data-room]").addEventListener("submit", (e) => { e.preventDefault(); onConnectTap(); });
      parts.room.addEventListener("change", () => { const r = normalizeRoom(parts.room.value); parts.room.value = r; S.field = r; });
      parts.room.addEventListener("input", () => { S.field = parts.room.value; });
      q("[data-share]")?.addEventListener("click", () => shareLink("share"));
      q("[data-copy]").addEventListener("click", () => shareLink("copy"));
      parts.resume.addEventListener("click", () => { S.ctx?.resume().catch(() => {}).finally(renderResume); });
      parts.mic.addEventListener("click", toggleMic);
      parts.catchup.addEventListener("click", () => { S.playbackNode?.port.postMessage({ type: "catch-up" }); toast("Caught up"); });
      box.addEventListener("change", (e) => {
        const t = e.target;
        if (t.name === "lossless-format") { S.format = Number(t.value) === FMT_S16 ? FMT_S16 : FMT_F32; savePrefs(); }
        if (t.name === "lossless-mode") {
          S.mode = t.value === "lowlatency" ? "lowlatency" : "lossless";
          S.backlogWarned = false;
          savePrefs();
          S.playbackNode?.port.postMessage({ type: "mode", lossless: S.mode === "lossless" });
          renderDevices();
        }
        if (t.name === "lossless-channels") { S.channels = Number(t.value) === 2 ? 2 : 1; savePrefs(); renderRouting(); restartInput(); }
        if (t.name === "lossless-input") { S.inputId = t.value; savePrefs(); renderRouting(); restartInput(); }
        if (t.name === "lossless-output") { S.outputId = t.value; savePrefs(); renderRouting(); applyOutput(); }
      });
      if (ui.token && !ui.token()) return; // (a newer draw is coming)
      U = parts;
      renderDevices();
      renderControls();
      renderResume();
      renderStats();
      drawMeters(!S.active);
      if (!window.isSecureContext) setStatus("This page must be opened over HTTPS for the microphone to work.", "bad");
      else setStatus(S.status.text, S.status.tone);
      refreshDevices();
      // (once it's on screen)
      requestAnimationFrame(() => startMeters());
    },
  });
})();
