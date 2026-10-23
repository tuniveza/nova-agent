// Nova Phone's sounds (the user: calm, relaxing, therapeutic; quiet, slow to swell, warm, sparse, never the same
// twice running). Nova Desk's sound effects (shared/sfx.js) sound every tap; on a phone that's too much, so these
// are only for the moments that matter: something saved, sent, deleted, gone wrong, a message, a switch, a new
// theme. Made live with Web Audio (no files), in D lydian like Nova Desk's (and its music), soft glass tones over a
// warm under-tone in a little room of reverb. Each place has its own colour (Calendar a clear chime, Notes soft
// wood, Quests a kalimba pluck, Portal deeper and roomy), in the same key.
// On or off is Nova Desk's own setting ("nova-sfx", on unless switched off), so both apps agree; the quiet extras
// (a sheet opening and closing, a switch) are "nova-sfx-extra", off unless switched on.
// Loaded once the first screen is up (phone.js); NovaPhone.sound(kind) plays one:
//   tap, open, close, on, off, pick, send, done, remove, error, message, welcome, theme
// Quiet by design: the loudest moment stays near -27 dB; at most one sound every 0.9 s and 20 a minute.
// Still when idle: the sound engine sleeps 20 s after the last sound and while Nova Phone is hidden.
(() => {
  "use strict";
  if (window.NovaPhoneSound) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  const read = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const enabled = () => read("nova-sfx") !== "off";
  const extraOn = () => enabled() && read("nova-sfx-extra") === "on";
  // D lydian: D E F# G# A B C#
  const f = (semi) => 293.66 * 2 ** (semi / 12); // from D4
  const N = { D3: f(-12), A3: f(-5), Cs4: f(-1), D4: f(0), E4: f(2), Fs4: f(4), A4: f(7), B4: f(9), Cs5: f(11), D5: f(12), E5: f(14), Fs5: f(16), Gs5: f(18), A5: f(19), B5: f(21), Cs6: f(23), E6: f(26) };
  let ctx = null, dry = null, wet = null, sleepTimer = 0;

  function engine() {
    if (!AC || !enabled()) return null;
    if (!ctx) {
      try { ctx = new AC({ latencyHint: "interactive" }); } catch (err) { return null; }
      const master = ctx.createGain();
      master.gain.value = 0.9;
      // (a gentle limiter, so nothing ever jumps out)
      const calm = ctx.createDynamicsCompressor();
      calm.threshold.value = -24; calm.knee.value = 12; calm.ratio.value = 4; calm.attack.value = 0.01; calm.release.value = 0.3;
      master.connect(calm).connect(ctx.destination);
      dry = ctx.createGain(); dry.gain.value = 1; dry.connect(master);
      // The room: a soft tail of noise, made once
      const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
      const verb = ctx.createConvolver(); verb.buffer = ir;
      const dark = ctx.createBiquadFilter(); dark.type = "lowpass"; dark.frequency.value = 2600;
      wet = ctx.createGain(); wet.gain.value = 0.5;
      wet.connect(dark).connect(verb).connect(master);
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(sleep, 20000);
    return ctx;
  }
  function sleep() { if (ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }
  // (a tap wakes it, so the sound after it plays straight away; iPhones only allow sound after a tap)
  addEventListener("pointerdown", () => { if (enabled() && ctx && ctx.state !== "running") engine(); }, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clearTimeout(sleepTimer); sleep(); } });

  const out = (node, pan, room) => {
    let n = node;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); n.connect(p); n = p; }
    n.connect(dry);
    if (room > 0) { const s = ctx.createGain(); s.gain.value = room; n.connect(s).connect(wet); }
  };
  const env = (g, t, peak, attack, length) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + length);
  };
  // A glass tone: the note, a quiet glint above, a warm low-pass
  function bell(freq, at, { gain = 0.024, length = 1.1, pan = 0, attack = 0.04, glint = 0.5, room = 0.5, wave = "sine" } = {}) {
    const t = ctx.currentTime + at, g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = Math.min(5200, freq * 3.2); lp.Q.value = 0.3;
    const o = ctx.createOscillator(); o.type = wave; o.frequency.value = freq * jitter();
    o.connect(g);
    if (glint > 0) {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = "sine"; o2.frequency.value = freq * 2.003 * jitter();
      env(g2, t, gain * 0.22 * glint, attack, length * 0.5);
      o2.connect(g2).connect(lp);
      o2.start(t); o2.stop(t + attack + length);
    }
    env(g, t, gain, attack, length);
    g.connect(lp);
    out(lp, pan, room);
    o.start(t); o.stop(t + attack + length + 0.05);
  }
  // A warm under-tone that swells in and out
  function swell(freqs, at, { gain = 0.012, length = 2 } = {}) {
    const t = ctx.currentTime + at;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = fr * jitter();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(gain, t + length * 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + length);
      o.connect(g); out(g, (i / Math.max(1, freqs.length - 1) - 0.5) * 0.6, 0.6);
      o.start(t); o.stop(t + length + 0.05);
    });
  }
  // A breath of air: soft noise through a moving band
  let noise = null;
  function air(at, { from = 500, to = 2200, gain = 0.012, length = 0.4 } = {}) {
    if (!noise) { const n = ctx.sampleRate; noise = ctx.createBuffer(1, n, n); const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; }
    const t = ctx.currentTime + at, s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + length);
    env(g, t, gain, length * 0.4, length * 0.6);
    s.connect(bp).connect(g); out(g, 0, 0.4);
    s.start(t); s.stop(t + length + 0.05);
  }
  let jit = 1;
  const jitter = () => jit * (1 + (Math.random() - 0.5) * 0.004);
  const voiced = (list) => (list.length > 2 && Math.random() < 0.5 ? [list[0], list[list.length - 1]] : list);
  const bloom = (freqs, at, o) => voiced(freqs).forEach((fr, i, a) => bell(fr, at + i * 0.035, { pan: (i / Math.max(1, a.length - 1) - 0.5) * 0.8, ...o }));

  // Each place's colour, in the same key: an octave, a wave, how long it rings
  const COLOURS = {
    calendar: { up: 1, wave: "sine", ring: 1.25, glint: 0.9 },
    notes: { up: 1, wave: "triangle", ring: 0.6, glint: 0.2 },
    quests: { up: 1, wave: "triangle", ring: 0.55, glint: 0.6 },
    today: { up: 0.5, wave: "sine", ring: 1.3, glint: 0.4 }, inbox: { up: 0.5, wave: "sine", ring: 1.3, glint: 0.4 },
    money: { up: 1, wave: "sine", ring: 0.9, glint: 0.3 },
    board: { up: 1, wave: "triangle", ring: 0.8, glint: 0.4 },
    index: { up: 1, wave: "sine", ring: 1.5, glint: 0.7 },
    observatory: { up: 0.5, wave: "sine", ring: 1.8, glint: 0.8 },
  };
  const colour = () => COLOURS[(location.hash.slice(1).split("/")[0] || "today")] || { up: 1, wave: "sine", ring: 1, glint: 0.5 };

  const SOUNDS = {
    tap: (c) => bell(pick([N.A4, N.Fs4, N.B4, N.E4]) * c.up, 0, { gain: 0.016, length: 0.35 * c.ring, wave: c.wave, glint: 0, room: 0.25 }),
    pick: (c) => bell(pick([N.Fs5, N.A5, N.B5]) * c.up, 0, { gain: 0.018, length: 0.7 * c.ring, wave: c.wave, glint: c.glint }),
    open: (c) => { air(0, { from: 400, to: 2000, gain: 0.01, length: 0.45 }); bloom([N.D5, N.Fs5, N.Cs6].map((x) => x * c.up), 0.04, { gain: 0.016, length: 1.2 * c.ring, attack: 0.06, wave: c.wave, glint: c.glint }); },
    close: (c) => { air(0, { from: 1800, to: 400, gain: 0.009, length: 0.32 }); bell(N.E5 * c.up, 0.03, { gain: 0.017, length: 0.8 * c.ring, attack: 0.05, wave: c.wave, glint: 0.2 }); },
    on: (c) => bloom([N.Fs5, N.Cs6].map((x) => x * c.up), 0, { gain: 0.02, length: 0.9 * c.ring, wave: c.wave, glint: c.glint }),
    off: (c) => bloom([N.B4, N.Fs5].map((x) => x * c.up), 0, { gain: 0.018, length: 0.7 * c.ring, wave: c.wave, glint: 0.2 }),
    send: (c) => { air(0, { from: 600, to: 2600, gain: 0.011, length: 0.4 }); bloom([N.A5, N.E6].map((x) => x * c.up), 0.05, { gain: 0.018, length: 1.2 * c.ring, attack: 0.05, wave: c.wave, glint: c.glint }); },
    done: (c) => { swell([N.D3, N.A3, N.Fs4], 0, { gain: 0.009, length: 2 }); bloom(pick([[N.D5, N.A5, N.Cs6], [N.A4, N.E5, N.Fs5], [N.D5, N.Fs5, N.B5]]).map((x) => x * c.up), 0.06, { gain: 0.017, length: 1.6 * c.ring, attack: 0.08, wave: c.wave, glint: c.glint }); },
    remove: () => { bell(N.D4, 0, { gain: 0.024, length: 0.5, glint: 0, room: 0.3 }); air(0.02, { from: 1400, to: 300, gain: 0.008, length: 0.35 }); },
    error: () => bloom([N.Cs4, N.D4], 0, { gain: 0.022, length: 0.6, glint: 0.1, attack: 0.03, room: 0.25 }),
    message: (c) => { bell(N.B5 * c.up, 0, { gain: 0.018, length: 1.1, pan: -0.2, attack: 0.04 }); bell(N.E6 * c.up, 0.14, { gain: 0.015, length: 1.4, pan: 0.25, attack: 0.05 }); },
    welcome: () => { swell([N.D3, N.A3], 0, { gain: 0.009, length: 2.2 }); bloom([N.D5, N.Fs5, N.A5, N.Cs6], 0.1, { gain: 0.014, length: 1.8, attack: 0.1 }); },
    theme: () => { [N.Fs5, N.A5, N.Cs6, N.E6].forEach((x, i) => bell(x, i * 0.12, { gain: 0.009, length: 1.6, pan: (i - 1.5) * 0.3, attack: 0.15, glint: 0.8 })); },
  };
  const EXTRA = new Set(["open", "close", "tap"]);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // How often: never two at once, never a run of them
  let last = 0, lastKind = "", times = [];
  function play(kind) {
    const fn = SOUNDS[kind];
    if (!fn || !enabled() || (EXTRA.has(kind) && !extraOn()) || document.hidden) return false;
    const now = Date.now();
    times = times.filter((t) => now - t < 60000);
    if (now - last < 900 || times.length >= (EXTRA.has(kind) ? 12 : 20)) return false;
    if (!engine()) return false;
    last = now; times.push(now);
    // (the same sound twice running is pitched a little apart and a touch quieter, so it's never quite the same)
    jit = kind === lastKind ? pick([0.997, 1.003, 0.995]) : 1;
    lastKind = kind;
    try { fn(colour()); } catch (err) {}
    return true;
  }
  // Switched on in Settings: a quiet hello (the tap that switched it on lets it play)
  function setEnabled(on) {
    try { localStorage.setItem("nova-sfx", on ? "on" : "off"); } catch (err) {}
    if (on) { last = 0; play("welcome"); } else sleep();
    window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: !!on } }));
  }
  function setExtra(on) {
    try { localStorage.setItem("nova-sfx-extra", on ? "on" : "off"); } catch (err) {}
    if (on) { last = 0; play("open"); }
    window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: enabled(), extra: !!on } }));
  }
  // The quiet extras, by themselves: a switch flipped anywhere in Nova Phone, a sheet opening and closing
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[role="switch"]') && extraOn() && !t.closest("[data-sfx='none']")) { last = 0; play(t.checked ? "on" : "off"); }
  });

  window.NovaPhoneSound = { play, enabled, extra: extraOn, setEnabled, setExtra, kinds: Object.keys(SOUNDS) };
})();
