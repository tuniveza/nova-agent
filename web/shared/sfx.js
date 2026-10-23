// Nova Agent sound effects: Novacane's soft glass tones, warm under-tones and breaths of air for
// every tap, tab, switch, open, close, send, done and delete. Ambient, not beeps: everything swells
// in, chords bloom together instead of running up like a game, and taps are a low felt touch.
// Made live with the Web Audio API (no sound files), in D lydian (the same key as the ambient
// music in ambient.js, so the two always sound right together), placed across left and right and
// washed in a little room of reverb and echo. Kept quiet.
//
// Every panel has its own sounds, in keeping with what it's for (all in the same key): Notes is
// paper and pencil, Calendar soft clock ticks and chimes, Portal deep and roomy like its planet,
// Index droplets that echo, Observatory the wide night sky, Lossless audio a soft electric piano,
// Visualizer glass glints and Quests a warm kalimba. Buttons that
// open a panel sound like that panel, and each button keeps its own note, so different buttons
// sound a little different (the same one always the same). A part of a page can choose its theme
// with data-sfx-theme="notes|calendar|portal|index|observatory|lossless|visualizer|quests|agent".
//
// Sounds play by themselves: one listener works out what kind of thing was pressed (a tab, a
// switch, a tick box, a menu item, a link, a "send", a "delete"...). An element can choose its own
// sound with data-sfx="tap|tab|open|close|on|off|check|uncheck|pick|menu|nav|send|done|remove|
// error|message|welcome|none".
// Switched off and on with NovaSfx.setEnabled(false/true); remembered on the device.
// The extras (scrolling, typing, sliders, dragging, hovering) are barely there and have their own
// switch, NovaSfx.setExtraEnabled(false/true), also remembered on the device (off to begin with).
// With it on come the gentle, tactile extras too: a velvety whisper while you keep scrolling
// (or drag a scrollbar), soft fabric when the mouse arrives on a sheet, a soft brush sliding the
// way a tab moved, a felt touch under switches, a shimmer when the theme changes and a warm
// unfolding when a panel opens. Each one is varied a little every time, and they keep well apart
// (at most 24 extras a minute).
//   window.NovaSfx = { play(name), enabled(), setEnabled(on), toggle(),
//                      extraEnabled(), setExtraEnabled(on), toggleExtra() }
(() => {
  "use strict";
  if (window.NovaSfx) return;
  const KEY = "nova-sfx";
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let dry = null; // straight to the speakers
  let wet = null; // into the reverb
  let echo = null; // into the soft echo
  let last = 0;
  // Set for each sound as it plays: how loud (lower when sounds come thick and fast) and a tiny
  // pitch difference, so no two plays are exactly alike
  let level = 1;
  let jitter = 1;

  // The extra, very quiet sounds (scrolling, typing, sliders, dragging, hovering) have their
  // own switch: off unless switched on on this device (calm first), and only while sounds are on
  const EXTRA = "nova-sfx-extra";
  function extraEnabled() {
    try {
      return enabled() && localStorage.getItem(EXTRA) === "on";
    } catch (err) {
      return false;
    }
  }
  function setExtraEnabled(on) {
    try {
      localStorage.setItem(EXTRA, on ? "on" : "off");
    } catch (err) {}
    window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: enabled(), extra: Boolean(on) } }));
    if (on) play("hover", true);
    return Boolean(on);
  }

  // On unless switched off on this device
  function enabled() {
    try {
      return localStorage.getItem(KEY) !== "off";
    } catch (err) {
      return true;
    }
  }
  function setEnabled(on) {
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch (err) {}
    window.dispatchEvent(new CustomEvent("novasfxchange", { detail: { on: Boolean(on) } }));
    if (on) play("welcome");
    return Boolean(on);
  }

  // A small, dark, shimmering room: stereo noise that fades over about two seconds
  function room(seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        const k = 0.7 - 0.55 * (i / len); // darker as it fades
        smooth += k * (Math.random() * 2 - 1 - smooth);
        d[i] = smooth * Math.exp((-6.5 * i) / len) * Math.min(1, i / (rate * 0.008));
      }
    }
    return buf;
  }

  // The sound maker, made on the first press (browsers only allow sound after one)
  function ready() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      desk();
    }
    if (ctx.state === "suspended") ctx.resume();
    // (asleep 10 s after the last sound, its echoes long gone: a running sound maker keeps the phone's
    // audio awake even in silence; the next sound wakes it, 22 Oct 2026)
    clearTimeout(ready.sleep);
    if (typeof ctx.suspend === "function") ready.sleep = setTimeout(() => ctx && ctx.state === "running" && ctx.suspend().catch(() => {}), 10000);
    return ctx;
  }
  // The mixing desk on the current sound maker (the live one, or an offline one for checks)
  function desk() {
    {
      // Everything meets in a gentle limiter, then the overall volume
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -20;
      limit.knee.value = 18;
      limit.ratio.value = 5;
      // Calm and soft: well down in volume, and a warm top end so nothing is ever bright or sharp
      const master = ctx.createGain();
      master.gain.value = 0.36;
      const warm = ctx.createBiquadFilter();
      warm.type = "lowpass";
      warm.frequency.value = 2600;
      warm.Q.value = 0.4;
      limit.connect(warm).connect(master).connect(ctx.destination);
      dry = limit;
      // Reverb
      wet = ctx.createGain();
      const verb = ctx.createConvolver();
      verb.buffer = room(3.2);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.85; // more space around everything: lush, not dry
      wet.connect(verb).connect(verbOut).connect(limit);
      // A soft, darkened echo that bounces left and right
      echo = ctx.createGain();
      const left = ctx.createDelay(1), right = ctx.createDelay(1);
      left.delayTime.value = 0.19;
      right.delayTime.value = 0.29;
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 2600;
      const back = ctx.createGain();
      back.gain.value = 0.32;
      const merge = ctx.createChannelMerger(2);
      echo.connect(tone);
      tone.connect(left).connect(merge, 0, 0);
      tone.connect(right).connect(merge, 0, 1);
      left.connect(back);
      right.connect(back);
      back.connect(tone);
      const echoOut = ctx.createGain();
      echoOut.gain.value = 0.4;
      merge.connect(echoOut);
      echoOut.connect(limit);
      echoOut.connect(wet);
    }
  }

  // Where a sound sits, left (-1) to right (1); old Safari has no panner, so it stays centred
  function place(pan, { room: r = 0.35, echo: e = 0 } = {}) {
    const g = ctx.createGain();
    g.gain.value = level;
    g.parts = []; // its panner and sends, unplugged with it
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      g.pan = p.pan; // so a sound can drift across
      g.parts.push(p);
      out = p;
    }
    out.connect(dry);
    if (r) {
      const s = ctx.createGain();
      s.gain.value = r;
      out.connect(s).connect(wet);
      g.parts.push(s);
    }
    if (e) {
      const s = ctx.createGain();
      s.gain.value = e;
      out.connect(s).connect(echo);
      g.parts.push(s);
    }
    return g;
  }

  // Unplug a sound's parts once it's finished, so nothing piles up
  function tidy(source, nodes) {
    const all = nodes.flatMap((n) => [n, ...(n.parts || [])]);
    source.onended = () => all.forEach((n) => { try { n.disconnect(); } catch (err) {} });
  }

  // One glass tone: a sine with a faint, slightly out-of-tune glint (FM) that melts away fast, a
  // twin a hair sharp for a soft shimmer, and a warm sine an octave under it. It swells in (no
  // sharp strike), so it's more like a rubbed wine glass than a beep.
  function bell(freq, at, { gain = 0.05, length = 0.9, pan = 0, glint = 0.7, warmth = 0.35, attack = 0.03, room: r = 0.45, echo: e = 0 } = {}) {
    freq *= jitter;
    // Calm: always a slow swell, barely any glint, a longer, softer tail
    attack = Math.max(attack, 0.07);
    glint = Math.min(glint, 0.18);
    length *= 1.25;
    gain *= 0.75;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r, echo: e });
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    amp.connect(out);

    const body = ctx.createOscillator();
    body.frequency.value = freq;
    const twin = ctx.createOscillator();
    twin.frequency.value = freq;
    twin.detune.value = 6;
    const twinAmt = ctx.createGain();
    twinAmt.gain.value = 0.45;
    // The glint: a modulator at an inharmonic ratio, like struck glass
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(freq * glint, t);
    depth.gain.exponentialRampToValueAtTime(1, t + Math.min(0.25, length * 0.4));
    mod.connect(depth);
    depth.connect(body.frequency);
    depth.connect(twin.frequency);
    body.connect(amp);
    twin.connect(twinAmt).connect(amp);

    const nodes = [out, amp, body, twin, twinAmt, mod, depth];
    if (warmth) {
      const low = ctx.createOscillator();
      low.frequency.value = freq / 2;
      const lowAmt = ctx.createGain();
      lowAmt.gain.setValueAtTime(0.0001, t);
      lowAmt.gain.exponentialRampToValueAtTime(gain * warmth, t + 0.03);
      lowAmt.gain.exponentialRampToValueAtTime(0.0001, t + length * 1.1);
      low.connect(lowAmt).connect(out);
      low.start(t);
      low.stop(t + length * 1.1 + 0.05);
      nodes.push(low, lowAmt);
    }
    for (const o of [body, twin, mod]) {
      o.start(t);
      o.stop(t + length + 0.05);
    }
    tidy(body, nodes);
  }

  // A soft, round touch (taps): a warm sine that swells in and fades (no click, no pitch slide),
  // a quiet sine an octave under it for body, through a gentle low-pass, with room around it.
  // More like a fingertip on a felt drum than a click.
  function drop(freq, at, { gain = 0.05, length = 0.4, pan = 0 } = {}) {
    freq *= jitter;
    gain *= 0.7;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: 0.5 });
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 850;
    soft.Q.value = 0.3;
    const amp = ctx.createGain();
    // Eases in over 35 ms along an S-curve (no corner, so no click), then fades away
    ease(amp.gain, t, gain, 0.035, length);
    soft.connect(amp).connect(out);
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    const under = ctx.createOscillator();
    under.frequency.value = freq / 2;
    const underAmt = ctx.createGain();
    underAmt.gain.value = 0.5;
    o.connect(soft);
    under.connect(underAmt).connect(soft);
    for (const x of [o, under]) {
      x.start(t);
      x.stop(t + length + 0.3);
    }
    tidy(o, [o, under, underAmt, soft, amp, out]);
  }

  // A warm swell under everything (big moments): a few soft detuned saws through a closing filter
  function swell(freqs, at, { gain = 0.018, length = 1.6 } = {}) {
    freqs = freqs.map((f) => f * jitter);
    const t = ctx.currentTime + at;
    freqs.forEach((f, i) => {
      const out = place((i / Math.max(1, freqs.length - 1) - 0.5) * 1.2, { room: 0.8 });
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(2200, t + length * 0.3);
      lp.frequency.exponentialRampToValueAtTime(500, t + length);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(gain, t + length * 0.25);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
      lp.connect(amp).connect(out);
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = b.type = "sawtooth";
      a.frequency.value = b.frequency.value = f;
      a.detune.value = -7;
      b.detune.value = 7;
      a.connect(lp);
      b.connect(lp);
      a.start(t); b.start(t);
      a.stop(t + length + 0.05); b.stop(t + length + 0.05);
      tidy(a, [a, b, lp, amp, out]);
    });
  }

  // A breath of air (opening and closing things): filtered noise that sweeps up or down and
  // drifts across, left to right or back
  function air(at, { from = 500, to = 2400, gain = 0.03, length = 0.32, panFrom = -0.4, panTo = 0.4 } = {}) {
    // Calm: a softer, slower, lower breath
    gain *= 0.4;
    length *= 1.4;
    to = Math.min(to, 1600);
    from = Math.min(from, 1600);
    const t = ctx.currentTime + at;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + length);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + length * 0.4);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const out = place(panFrom, { room: 0.6 });
    if (out.pan) {
      out.pan.setValueAtTime(panFrom, t);
      out.pan.linearRampToValueAtTime(panTo, t + length);
    }
    src.connect(filter).connect(amp).connect(out);
    src.start(t);
    src.stop(t + length + 0.02);
    tidy(src, [src, filter, amp, out]);
  }

  // An S-shaped rise (gentle at the start, so nothing clicks), then a gentle fade. Made of
  // short straight ramps, which (unlike a value curve) never clash if the moment is late.
  function ease(param, t, peak, rise, fade) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak * 0.12, t + rise * 0.35);
    param.linearRampToValueAtTime(peak * 0.7, t + rise * 0.7);
    param.linearRampToValueAtTime(peak, t + rise);
    param.setTargetAtTime(0, t + rise, fade / 4);
  }
  // Soft noise, made once and reused
  let noiseBuf = null;
  function noise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    return src;
  }

  // A soft wooden knock (clock ticks, pencil taps, marimba): a round sine with the faintest
  // breath of wood around it, low-passed so it's a "tok", never a click
  function wood(freq, at, { gain = 0.03, length = 0.14, pan = 0, room: r = 0.35 } = {}) {
    freq *= jitter;
    gain *= 0.6;
    freq = Math.min(freq, 900); // a low, soft "tok"
    length *= 1.6;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r });
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(3200, freq * 3);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    ease(amp.gain, t, gain, 0.012, length);
    lp.connect(amp).connect(out);
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    o.connect(lp);
    const n = noise();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq * 2;
    bp.Q.value = 6;
    const nAmt = ctx.createGain();
    nAmt.gain.value = 0;
    ease(nAmt.gain, t, 0.15, 0.006, 0.03);
    n.connect(bp).connect(nAmt).connect(lp);
    o.start(t); n.start(t, Math.random());
    o.stop(t + length + 0.2); n.stop(t + 0.12);
    tidy(o, [o, n, bp, nAmt, lp, amp, out]);
  }

  // Paper: a soft rustle or a page turning (noise with a gentle, uneven flutter, swept in tone)
  function paper(at, { gain = 0.02, length = 0.3, from = 1400, to = 2600, pan = 0, panTo = pan, room: r = 0.4 } = {}) {
    gain *= 0.45;
    length *= 1.3;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r });
    if (out.pan) { out.pan.setValueAtTime(pan, t); out.pan.linearRampToValueAtTime(panTo, t + length); }
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + length);
    const amp = ctx.createGain();
    const steps = 24;
    const curve = new Float32Array(steps).map((_, i) => gain * Math.sin(Math.PI * (i / (steps - 1))) ** 1.5 * (0.55 + 0.45 * Math.random()));
    curve[0] = 0; curve[steps - 1] = 0;
    amp.gain.setValueCurveAtTime(curve, t, length);
    const n = noise();
    n.connect(bp).connect(amp).connect(out);
    n.start(t, Math.random());
    n.stop(t + length + 0.02);
    tidy(n, [n, bp, amp, out]);
  }

  // A kalimba / soft marimba note: a round sine with a faint, quickly fading overtone
  function pluck(freq, at, { gain = 0.03, length = 0.9, pan = 0, echo: e = 0, room: r = 0.45 } = {}) {
    freq *= jitter;
    gain *= 0.75;
    length *= 1.3;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r, echo: e });
    const amp = ctx.createGain();
    amp.gain.value = 0;
    ease(amp.gain, t, gain, 0.025, length);
    amp.connect(out);
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    o.connect(amp);
    const over = ctx.createOscillator();
    over.frequency.value = freq * 3;
    const overAmt = ctx.createGain();
    overAmt.gain.value = 0;
    ease(overAmt.gain, t, 0.05, 0.025, 0.1);
    over.connect(overAmt).connect(amp);
    o.start(t); over.start(t);
    o.stop(t + length + 0.3); over.stop(t + 0.4);
    tidy(o, [o, over, overAmt, amp, out]);
  }

  // A soft electric piano note (FM): warm, a little bell-like as it starts, then mellow
  function keys(freq, at, { gain = 0.028, length = 1.2, pan = 0, echo: e = 0.2, room: r = 0.45 } = {}) {
    freq *= jitter;
    gain *= 0.75;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r, echo: e });
    const amp = ctx.createGain();
    amp.gain.value = 0;
    ease(amp.gain, t, gain, 0.03, length);
    amp.connect(out);
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(freq * 0.45, t);
    depth.gain.setTargetAtTime(freq * 0.04, t, 0.25);
    mod.connect(depth).connect(car.frequency);
    car.connect(amp);
    car.start(t); mod.start(t);
    car.stop(t + length + 0.3); mod.stop(t + length + 0.3);
    tidy(car, [car, mod, depth, amp, out]);
  }

  // A music-box / distant clock chime: a pure tone with soft harmonics that fade first
  function chime(freq, at, { gain = 0.024, length = 1.6, pan = 0, echo: e = 0.25, room: r = 0.55 } = {}) {
    freq *= jitter;
    gain *= 0.7;
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r, echo: e });
    const parts = [out];
    let first = null;
    [[1, 1, length], [2, 0.12, length * 0.5], [4.02, 0.025, length * 0.25]].forEach(([mult, level, len]) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = 0;
      ease(g.gain, t, gain * level, 0.03, len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.3);
      parts.push(o, g);
      first = first || o;
    });
    tidy(first, parts);
  }

  // A deep, soft hum that swells and fades (planets, big moments, the night sky)
  function hum(freq, at, { gain = 0.02, length = 1.4, room: r = 0.6 } = {}) {
    freq *= jitter;
    const t = ctx.currentTime + at;
    const out = place(0, { room: r });
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + length * 0.3);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    amp.connect(out);
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.frequency.value = freq;
    b.frequency.value = freq * 2;
    b.detune.value = 4;
    const bAmt = ctx.createGain();
    bAmt.gain.value = 0.3;
    a.connect(amp);
    b.connect(bAmt).connect(amp);
    a.start(t); b.start(t);
    a.stop(t + length + 0.05); b.stop(t + length + 0.05);
    tidy(a, [a, b, bAmt, amp, out]);
  }

  // ---- The gentle extras' own textures: soft, tactile, close-up (like ASMR), never a beep ----
  // A little different every time: moved at random within a narrow range
  const vary = (x, spread) => x * (1 + (Math.random() * 2 - 1) * spread);
  function lowpass(freq, q = 0.5) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Soft fabric: a slow breath of low, filtered noise brushing past (a sheet drifting by, a tab
  // sliding across), with an optional warm under-tone
  function fabric(at, { gain = 0.01, length = 0.8, from = 300, to = 700, pan = 0, panTo = pan, under = 0, room: r = 0.5 } = {}) {
    const t = ctx.currentTime + at;
    length = vary(length, 0.12);
    const out = place(pan, { room: r });
    if (out.pan) { out.pan.setValueAtTime(pan, t); out.pan.linearRampToValueAtTime(panTo, t + length); }
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = vary(0.7, 0.2);
    bp.frequency.setValueAtTime(vary(Math.min(from, 1400), 0.1), t);
    bp.frequency.exponentialRampToValueAtTime(vary(Math.min(to, 1400), 0.1), t + length);
    const lp = lowpass(1400);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    ease(amp.gain, t, vary(gain, 0.15), length * 0.45, length * 0.55);
    const n = noise();
    n.loop = true;
    n.connect(bp).connect(lp).connect(amp).connect(out);
    n.start(t, Math.random());
    n.stop(t + length * 1.8 + 0.1);
    const nodes = [n, bp, lp, amp, out];
    if (under) {
      const o = ctx.createOscillator();
      o.frequency.value = vary(under * jitter, 0.006);
      const og = ctx.createGain();
      og.gain.value = 0;
      ease(og.gain, t, gain * 0.5, length * 0.5, length * 0.6);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + length * 1.8 + 0.1);
      nodes.push(o, og);
    }
    tidy(n, nodes);
  }

  // A felt touch (switches): a muffled, soft "thock", like pressing a felt-covered key
  function felt(at, { gain = 0.02, freq = 140, pan = 0 } = {}) {
    const t = ctx.currentTime + at;
    const out = place(pan, { room: 0.25 });
    const lp = lowpass(vary(420, 0.12));
    const amp = ctx.createGain();
    amp.gain.value = 0;
    ease(amp.gain, t, vary(gain, 0.15), 0.014, vary(0.09, 0.15));
    const n = noise();
    n.loop = true;
    n.connect(lp).connect(amp).connect(out);
    const body = ctx.createOscillator();
    body.frequency.value = vary(freq * jitter, 0.04);
    const bodyAmt = ctx.createGain();
    bodyAmt.gain.value = 0;
    ease(bodyAmt.gain, t, gain * 0.6, 0.02, 0.12);
    body.connect(bodyAmt).connect(out);
    n.start(t, Math.random());
    body.start(t);
    n.stop(t + 0.6);
    body.stop(t + 0.6);
    tidy(n, [n, lp, amp, body, bodyAmt, out]);
  }

  // A gentle shimmer (the theme changing): a few warm tones swelling in one after another, each
  // softly glimmering, over a breath of air
  let lastShimmer = -1;
  function shimmer(at, { gain = 0.007, length = 2.6 } = {}) {
    const chords = [[N.A4, N.Cs5, N.E5], [N.Fs4, N.A4, N.Cs5, N.E5], [N.D5, N.Fs5, N.A5], [N.B4, N.E5, N.Fs5], [N.E4, N.B4, N.Cs5, N.Fs5]];
    let c = Math.floor(Math.random() * chords.length);
    if (c === lastShimmer) c = (c + 1 + Math.floor(Math.random() * (chords.length - 1))) % chords.length;
    lastShimmer = c;
    const freqs = chords[c];
    let when = at;
    freqs.forEach((f, i) => {
      const t = ctx.currentTime + when;
      when += vary(0.18, 0.3);
      const out = place((i / Math.max(1, freqs.length - 1) - 0.5) * 1.0, { room: 0.75, echo: 0.15 });
      const amp = ctx.createGain();
      amp.gain.value = 0;
      ease(amp.gain, t, vary(gain, 0.15), vary(0.5, 0.25), length);
      // The glimmer: the level breathes a little (after the swell, so it dies with it)
      const glim = ctx.createGain();
      glim.gain.value = 1;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vary(5, 0.25);
      const depth = ctx.createGain();
      depth.gain.value = 0.25;
      lfo.connect(depth).connect(glim.gain);
      const o = ctx.createOscillator();
      o.frequency.value = vary(f * jitter, 0.003);
      o.connect(amp).connect(glim).connect(out);
      for (const x of [o, lfo]) { x.start(t); x.stop(t + length * 1.6 + 0.3); }
      tidy(o, [o, amp, glim, lfo, depth, out]);
    });
    fabric(at, { gain: 0.006, length: 1.4, from: 500, to: 1100, pan: -0.3, panTo: 0.3, room: 0.7 });
  }

  // The notes: D lydian (D E F# G# A B C#), mostly in the middle-high range so nothing is shrill
  const N = { A4: 440, B4: 493.88, Cs5: 554.37, D5: 587.33, E5: 659.25, Fs5: 739.99, Gs5: 830.61, A5: 880, B5: 987.77, Cs6: 1108.73, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760, D3: 146.83, E3: 164.81, A3: 220, B3: 246.94, Fs3: 185, D4: 293.66, E4: 329.63, Fs4: 369.99, Cs4: 277.18, Gs4: 415.3, D2: 73.42, A2: 110 };
  // Each button keeps its own note (v = 0, 1, 2…, worked out from what it's called), so different
  // buttons sound a little different, and the same button always sounds the same
  const at = (list, v) => list[(v || 0) % list.length];
  const wobble = () => (Math.random() - 0.5) * 0.3;

  // A chord that blooms: its notes swell in together (a hair apart, like a soft strum), never a run
  // Now and then a chord leaves out one of its inner notes, so it's voiced a little differently
  // Calm: never more than three notes at once (lowest, highest and one between, chosen afresh)
  const voiced = (freqs) => {
    let f = freqs.length > 2 && Math.random() < 0.35 ? freqs.filter((_, i) => i !== 1 + Math.floor(Math.random() * (freqs.length - 2))) : freqs;
    if (f.length > 3) f = [f[0], f[1 + Math.floor(Math.random() * (f.length - 2))], f[f.length - 1]];
    return f;
  };
  const bloom = (freqs, at0, opts) => voiced(freqs).forEach((f, i) => bell(f, at0 + i * 0.03, { pan: (i / Math.max(1, freqs.length - 1) - 0.5) * 0.9, ...opts }));
  const together = (fn, freqs, at0, opts) => voiced(freqs).forEach((f, i) => fn(f, at0 + i * 0.03, { pan: (i / Math.max(1, freqs.length - 1) - 0.5) * 0.8, ...opts }));

  // ---- Nova Agent's own sounds (Chat, and anything without a theme of its own) ----
  const SOUNDS = {
    // A light tap on anything: a soft, low, warm touch
    tap: (k, v) => drop(at([N.A4, N.Fs4, N.B4, N.E4, N.Cs5], v), 0, { gain: 0.022, pan: wobble() }),
    // Switching tabs or views: a puff of air and one glass tone
    tab: (k, v) => {
      air(0, { from: 900, to: 1700, gain: 0.014, length: 0.2, panFrom: -0.2, panTo: 0.2 });
      bell(at([N.A5, N.Fs5, N.B5, N.E5], v), 0.01, { gain: 0.03, length: 0.9, attack: 0.025 });
    },
    // Opening a sheet, dialog, menu or panel: air rising, and a chord blooming open
    open: () => {
      air(0, { from: 400, to: 2400, gain: 0.024, length: 0.45 });
      bloom([N.D5, N.Fs5, N.Cs6], 0.04, { gain: 0.022, length: 1.4, attack: 0.05 });
    },
    // Closing it again: the air falls, one warm tone settles
    close: () => {
      air(0, { from: 2000, to: 400, gain: 0.02, length: 0.32, panFrom: 0.4, panTo: -0.4 });
      bell(N.E5, 0.03, { gain: 0.026, length: 0.9, attack: 0.04, warmth: 0.5 });
    },
    // A switch turned on / off: a bright pair of tones together, or a lower, softer pair
    on: () => bloom([N.Fs5, N.Cs6], 0, { gain: 0.03, length: 1.0, attack: 0.03 }),
    off: () => bloom([N.B4, N.Fs5], 0, { gain: 0.026, length: 0.8, attack: 0.03, warmth: 0.5 }),
    // A tick box (not a switch): a little lighter than a switch
    check: () => bloom([N.A5, N.E6], 0, { gain: 0.02, length: 0.7, attack: 0.03 }),
    uncheck: () => bell(N.E5, 0, { gain: 0.02, length: 0.6, attack: 0.03, warmth: 0.5 }),
    // Choosing from a list or a menu
    pick: (k, v) => bell(at([N.Fs5, N.A5, N.B5, N.D6], v), 0, { gain: 0.022, length: 0.7, attack: 0.03, glint: 0.4 }),
    menu: (k, v) => drop(at([N.D5, N.E5, N.Fs5, N.A5], v), 0, { gain: 0.02, length: 0.35, pan: wobble() }),
    // Following a link to somewhere else: a little breath forward
    nav: () => {
      air(0, { from: 700, to: 1800, gain: 0.014, length: 0.25, panFrom: -0.3, panTo: 0.3 });
      drop(N.D5, 0.03, { gain: 0.018, length: 0.4 });
    },
    // Sending a message or saving something: a breath of air flying off to the right, two glass
    // tones following it into the echo
    send: () => {
      air(0, { from: 600, to: 3000, gain: 0.022, length: 0.4, panFrom: -0.5, panTo: 0.6 });
      bloom([N.A5, N.E6], 0.05, { gain: 0.026, length: 1.3, attack: 0.04, echo: 0.4 });
    },
    // Something finished: a warm swell with a shimmering chord opening over it
    done: () => {
      swell([N.D3, N.A3, N.Fs4, N.Cs5], 0, { gain: 0.014, length: 2.2 });
      bloom([N.D5, N.A5, N.Cs6, N.Fs6], 0.06, { gain: 0.022, length: 1.9, attack: 0.07, echo: 0.3 });
    },
    // Removing or deleting: a soft low touch, and the air sinking away
    remove: () => {
      drop(N.D4, 0, { gain: 0.04, length: 0.45 });
      air(0.02, { from: 1400, to: 300, gain: 0.016, length: 0.35, panFrom: 0.2, panTo: -0.3 });
    },
    // Something went wrong: two low, muted tones together (no glass)
    error: () => bloom([N.Cs4, N.D4], 0, { gain: 0.035, length: 0.6, glint: 0.2, warmth: 0.6, attack: 0.02, room: 0.25 }),
    // A message arrived: a high, gentle call that echoes away
    message: () => {
      bell(N.B5, 0, { gain: 0.028, length: 1.1, pan: -0.2, attack: 0.035, echo: 0.3 });
      bell(N.E6, 0.12, { gain: 0.024, length: 1.5, pan: 0.25, attack: 0.04, echo: 0.45 });
    },
    // ---- The extras: barely there ----
    // Scrolling: a breath of air, quieter the slower you go (strength 0–1)
    scroll: (k = 0.5) => air(0, { from: 500 + 500 * k, to: 900 + 900 * k, gain: 0.006 + 0.01 * k, length: 0.22, panFrom: -0.15, panTo: 0.15 }),
    // Typing: the softest touch per key, a little different each time
    key: () => drop(N.D5 * (1 + (Math.random() - 0.5) * 0.06), 0, { gain: 0.007, length: 0.09, pan: (Math.random() - 0.5) * 0.4 }),
    // A slider: a soft tone that rises and falls with it (k = 0–1 along the slider)
    slide: (k = 0.5) => {
      const steps = [N.D4, N.E4, N.Fs4, N.A4, N.B4, N.D5, N.E5, N.Fs5, N.A5, N.B5, N.D6];
      bell(steps[Math.round(k * (steps.length - 1))], 0, { gain: 0.012, length: 0.5, attack: 0.03, glint: 0.2, warmth: 0.4 });
    },
    // Dragging: picking something up (air rising, a soft tone) and putting it down (a low touch)
    lift: () => {
      air(0, { from: 500, to: 1400, gain: 0.012, length: 0.25 });
      bell(N.Fs5, 0.02, { gain: 0.016, length: 0.6, attack: 0.04, glint: 0.3 });
    },
    nudge: () => drop(N.A4, 0, { gain: 0.014, length: 0.12 }),
    place: () => {
      drop(N.D4, 0, { gain: 0.04, length: 0.4 });
      bell(N.A5, 0.04, { gain: 0.012, length: 0.8, attack: 0.05, glint: 0.3 });
    },
    // Hovering over a tile with a mouse: an extra-faint shimmer, high up
    hover: () => bell([N.Cs6, N.E6, N.Fs6, N.A6][Math.floor(Math.random() * 4)], 0, { gain: 0.006, length: 0.9, attack: 0.06, glint: 0.2, warmth: 0, pan: (Math.random() - 0.5) * 0.8 }),
    // Scrollbars: a soft touch when you take hold of one, a quiet tone that rises and falls with
    // where you are as you drag it (k = 0 top … 1 bottom), and a gentle settle when you let go
    grab: () => drop(N.D4, 0, { gain: 0.03, length: 0.35 }),
    scrub: (k = 0.5) => {
      const steps = [N.A4, N.B4, N.Cs5, N.D5, N.E5, N.Fs5, N.A5];
      drop(steps[Math.round((1 - k) * (steps.length - 1))], 0, { gain: 0.012, length: 0.16 });
    },
    release: () => bell(N.A4, 0, { gain: 0.016, length: 0.6, attack: 0.05, glint: 0.1, warmth: 0.5 }),
    // ---- The gentle extras (with the quiet extras' switch): soft, tactile, never twice the same ----
    // Arriving on a sheet, dialog or menu with the mouse: soft fabric drifting by, a warm low hum
    sheet: () => fabric(0, { gain: 0.006, length: 0.9, from: 260, to: 520, pan: wobble(), under: [N.D3, N.A2, N.E3][Math.floor(Math.random() * 3)] }),
    // Switching tabs: a soft brush that slides the way you moved (k = −1 left, 1 right)
    swish: (k) => {
      const dir = k < 0 ? -1 : 1;
      fabric(0, { gain: 0.01, length: 0.42, from: 520, to: 900, pan: -0.45 * dir, panTo: 0.45 * dir, room: 0.35 });
    },
    // A switch or tick box: a muffled felt touch under its tones (a little lower when off)
    felt: (k) => felt(0, { gain: 0.024, freq: k === 0 ? 118 : 146, pan: wobble() }),
    // The theme changing: a gentle shimmer
    shimmer: () => shimmer(0),
    // A panel opening: a warm, low unfolding and a breath of air
    unfold: (k, v) => {
      const root = at([N.D3, N.A2, N.E3, N.Fs3], v);
      hum(root, 0, { gain: 0.006, length: 1.9 });
      hum(root * 1.5, 0.12, { gain: 0.0035, length: 1.7 });
      fabric(0.02, { gain: 0.006, length: 0.9, from: 280, to: 800, pan: -0.2, panTo: 0.2, room: 0.7 });
    },
    // Hello (sound switched on): Novacane's chord, D–A–C♯–F♯, blooming over a soft swell
    welcome: () => {
      swell([N.D3, N.A3, N.Cs5], 0, { gain: 0.012, length: 2.4 });
      bloom([N.D5, N.A5, N.Cs6, N.Fs6], 0.05, { gain: 0.024, length: 2, attack: 0.08, echo: 0.35 });
    },
  };

  // ---- Each panel's own sounds, in keeping with what it's for (anything a panel leaves out
  // uses Nova Agent's own above). All in the same key, so they sit together. ----
  const THEMES = {
    // Notes: paper and pencil. Pages turn, pencils tap, a soft felt piano underneath.
    notes: {
      tap: (k, v) => wood(at([1100, 1250, 980, 1320], v), 0, { gain: 0.016, length: 0.08, pan: wobble() }),
      tab: (k, v) => { paper(0, { gain: 0.012, length: 0.18, from: 1600, to: 2400 }); pluck(at([N.A4, N.Fs4, N.B4], v), 0.03, { gain: 0.016, length: 0.6 }); },
      open: () => { paper(0, { gain: 0.02, length: 0.45, from: 1000, to: 2600, pan: -0.4, panTo: 0.4 }); together(pluck, [N.D4, N.A4, N.Fs5], 0.12, { gain: 0.016, length: 1.2 }); },
      close: () => { paper(0, { gain: 0.016, length: 0.32, from: 2400, to: 1000, pan: 0.4, panTo: -0.4 }); pluck(N.D4, 0.1, { gain: 0.02, length: 0.8 }); },
      send: () => { paper(0, { gain: 0.016, length: 0.3, from: 1200, to: 2800, pan: -0.3, panTo: 0.5 }); together(pluck, [N.A4, N.E5], 0.06, { gain: 0.018, length: 1.0, echo: 0.2 }); },
      done: () => { paper(0, { gain: 0.012, length: 0.3 }); together(pluck, [N.D4, N.Fs4, N.A4, N.Cs5, N.E5], 0.05, { gain: 0.016, length: 1.6, echo: 0.25 }); },
      remove: () => { paper(0, { gain: 0.022, length: 0.5, from: 2600, to: 600, pan: 0.2, panTo: -0.3 }); wood(320, 0.12, { gain: 0.02, length: 0.2 }); },
      check: () => { wood(1300, 0, { gain: 0.014, length: 0.06 }); paper(0.02, { gain: 0.01, length: 0.1, from: 2600, to: 3000 }); },
      uncheck: () => paper(0, { gain: 0.012, length: 0.14, from: 2800, to: 1600 }),
      pick: (k, v) => pluck(at([N.Fs5, N.A5, N.D5, N.B5], v), 0, { gain: 0.018, length: 0.6 }),
      menu: (k, v) => paper(0, { gain: 0.01, length: 0.12, from: at([1800, 2100, 2400], v), to: 2800 }),
      key: () => paper(0, { gain: 0.005, length: 0.05, from: 2600 + Math.random() * 600, to: 3200 }),
      scroll: (k = 0.5) => paper(0, { gain: 0.003 + 0.004 * k, length: 0.22, from: 1400, to: 2000 }),
      lift: () => paper(0, { gain: 0.014, length: 0.22, from: 1200, to: 2600 }),
      place: () => { paper(0, { gain: 0.012, length: 0.18, from: 2400, to: 1200 }); wood(420, 0.08, { gain: 0.02, length: 0.15 }); },
      hover: () => paper(0, { gain: 0.008, length: 0.12, from: 2400, to: 2800 }),
      message: () => together(pluck, [N.B4, N.E5], 0, { gain: 0.018, length: 1.1, echo: 0.3 }),
    },
    // Calendar: clocks and days. Soft ticks and tocks, calendar pages, a distant hour chime.
    calendar: {
      tap: (k, v) => wood(at([880, 660, 990, 740], v), 0, { gain: 0.016, length: 0.1, pan: wobble() }),
      tab: () => { wood(990, 0, { gain: 0.014, length: 0.09, pan: -0.25 }); wood(740, 0.13, { gain: 0.014, length: 0.12, pan: 0.25 }); },
      open: () => { paper(0, { gain: 0.016, length: 0.35, from: 1200, to: 2400 }); together(chime, [N.A5, N.E6], 0.1, { gain: 0.016, length: 1.4 }); },
      close: () => { wood(660, 0, { gain: 0.016, length: 0.12 }); paper(0.02, { gain: 0.01, length: 0.22, from: 2200, to: 1200 }); },
      send: () => together(chime, [N.D5, N.A5, N.E6], 0.02, { gain: 0.016, length: 1.6, echo: 0.3 }),
      done: () => { hum(N.D3, 0, { gain: 0.012, length: 2.4 }); together(chime, [N.D5, N.Fs5, N.A5, N.Cs6], 0.04, { gain: 0.016, length: 2.2, echo: 0.3 }); },
      remove: () => { paper(0, { gain: 0.02, length: 0.4, from: 2400, to: 700 }); wood(440, 0.1, { gain: 0.016, length: 0.16 }); },
      on: () => together(chime, [N.Fs5, N.Cs6], 0, { gain: 0.016, length: 1.0 }),
      off: () => wood(560, 0, { gain: 0.016, length: 0.14 }),
      check: () => wood(1180, 0, { gain: 0.014, length: 0.08 }),
      uncheck: () => wood(700, 0, { gain: 0.014, length: 0.1 }),
      pick: (k, v) => chime(at([N.A5, N.Fs5, N.B5, N.E6], v), 0, { gain: 0.014, length: 1.0 }),
      menu: (k, v) => wood(at([830, 990, 740], v), 0, { gain: 0.013, length: 0.09 }),
      nudge: () => wood(1320, 0, { gain: 0.008, length: 0.06 }),
      lift: () => { paper(0, { gain: 0.012, length: 0.2, from: 1200, to: 2400 }); wood(880, 0.02, { gain: 0.012, length: 0.08 }); },
      place: () => { wood(520, 0, { gain: 0.022, length: 0.16 }); chime(N.A5, 0.05, { gain: 0.01, length: 0.9 }); },
      scroll: (k = 0.5) => wood(1500 + 300 * k, 0, { gain: 0.003 + 0.004 * k, length: 0.05 }),
      key: () => wood(1400 + Math.random() * 200, 0, { gain: 0.005, length: 0.04 }),
      hover: () => chime([N.Cs6, N.E6, N.Fs6][Math.floor(Math.random() * 3)], 0, { gain: 0.004, length: 0.8 }),
      message: () => { chime(N.B5, 0, { gain: 0.016, length: 1.2 }); chime(N.E6, 0.14, { gain: 0.014, length: 1.4 }); },
    },
    // Portal: the studio's planet and its station. Deeper and roomier, with a soft low hum.
    portal: {
      tap: (k, v) => drop(at([N.Fs4, N.D4, N.A4, N.E4], v), 0, { gain: 0.024, length: 0.6, pan: wobble() }),
      tab: (k, v) => { hum(at([N.D3, N.A2, N.E3], v), 0, { gain: 0.008, length: 0.7 }); bell(at([N.Fs5, N.A5, N.Cs6], v), 0.02, { gain: 0.022, length: 1.2, attack: 0.04, room: 0.7 }); },
      open: () => { hum(N.D3, 0, { gain: 0.014, length: 1.4 }); air(0, { from: 300, to: 1800, gain: 0.018, length: 0.6 }); bloom([N.A4, N.E5, N.Cs6], 0.08, { gain: 0.02, length: 1.6, attack: 0.07, room: 0.7 }); },
      close: () => { air(0, { from: 1600, to: 300, gain: 0.016, length: 0.45 }); bell(N.A4, 0.05, { gain: 0.022, length: 1.0, attack: 0.05, warmth: 0.6, room: 0.7 }); },
      send: () => { air(0, { from: 500, to: 2600, gain: 0.018, length: 0.5, panFrom: -0.5, panTo: 0.6 }); bloom([N.E5, N.B5], 0.06, { gain: 0.022, length: 1.6, attack: 0.05, echo: 0.45, room: 0.7 }); },
      done: () => { hum(N.D2 * 2, 0, { gain: 0.016, length: 2.6 }); bloom([N.D5, N.A5, N.E6, N.Fs6], 0.08, { gain: 0.02, length: 2.2, attack: 0.09, echo: 0.35, room: 0.7 }); },
      message: () => { bell(N.A5, 0, { gain: 0.024, length: 1.4, attack: 0.05, echo: 0.4, room: 0.7 }); bell(N.E6, 0.16, { gain: 0.02, length: 1.8, attack: 0.05, echo: 0.5, room: 0.7 }); },
      pick: (k, v) => bell(at([N.E5, N.Fs5, N.A5], v), 0, { gain: 0.02, length: 1.0, attack: 0.04, room: 0.7 }),
      hover: () => bell([N.A5, N.Cs6, N.E6][Math.floor(Math.random() * 3)], 0, { gain: 0.005, length: 1.2, attack: 0.08, glint: 0.1, warmth: 0, room: 0.8 }),
    },
    // Index: the memory. Droplets of thought that echo away as they're recalled or stored.
    index: {
      tap: (k, v) => pluck(at([N.A5, N.Fs5, N.E5, N.B5], v), 0, { gain: 0.016, length: 0.5, echo: 0.3, pan: wobble() }),
      tab: (k, v) => pluck(at([N.Cs6, N.A5, N.E6], v), 0, { gain: 0.016, length: 0.8, echo: 0.45 }),
      open: () => { air(0, { from: 600, to: 2200, gain: 0.014, length: 0.4 }); together(pluck, [N.Fs5, N.Cs6, N.E6], 0.05, { gain: 0.014, length: 1.2, echo: 0.5 }); },
      close: () => pluck(N.Fs5, 0, { gain: 0.016, length: 0.8, echo: 0.4 }),
      send: () => { together(pluck, [N.D5, N.A5, N.E6], 0, { gain: 0.016, length: 1.4, echo: 0.55 }); hum(N.D3, 0, { gain: 0.008, length: 1.6 }); },
      done: () => { hum(N.D3, 0, { gain: 0.01, length: 2.2 }); together(pluck, [N.D5, N.Fs5, N.A5, N.Cs6, N.E6], 0.03, { gain: 0.014, length: 1.8, echo: 0.5 }); },
      remove: () => { pluck(N.A4, 0, { gain: 0.018, length: 0.6, echo: 0.3 }); air(0.05, { from: 1200, to: 300, gain: 0.012, length: 0.4 }); },
      key: () => pluck(N.E6 * (1 + (Math.random() - 0.5) * 0.04), 0, { gain: 0.004, length: 0.15 }),
      hover: () => pluck([N.Cs6, N.E6, N.Fs6][Math.floor(Math.random() * 3)], 0, { gain: 0.004, length: 0.5, echo: 0.4 }),
    },
    // Observatory: the night sky. Very wide and slow: faint stars over a deep, quiet hum.
    observatory: {
      tap: (k, v) => bell(at([N.Cs6, N.A5, N.E6, N.Fs6], v), 0, { gain: 0.014, length: 1.4, attack: 0.05, glint: 0.2, warmth: 0.2, room: 0.85, pan: wobble() * 2 }),
      tab: (k, v) => { hum(at([N.D3, N.A2], v), 0, { gain: 0.008, length: 1.2 }); bell(at([N.E6, N.Cs6, N.A5], v), 0.03, { gain: 0.016, length: 1.6, attack: 0.06, room: 0.85 }); },
      open: () => { hum(N.D2 * 2, 0, { gain: 0.014, length: 2.2 }); air(0, { from: 300, to: 1500, gain: 0.016, length: 1.0 }); bloom([N.A5, N.E6, N.Fs6], 0.15, { gain: 0.014, length: 2.0, attack: 0.12, room: 0.9 }); },
      close: () => { air(0, { from: 1500, to: 300, gain: 0.012, length: 0.7 }); bell(N.E5, 0.05, { gain: 0.016, length: 1.4, attack: 0.08, room: 0.9 }); },
      done: () => { hum(N.D2 * 2, 0, { gain: 0.014, length: 3 }); bloom([N.D5, N.A5, N.Cs6, N.Fs6, N.A6], 0.1, { gain: 0.014, length: 2.6, attack: 0.12, echo: 0.4, room: 0.9 }); },
      hover: () => bell([N.Fs6, N.A6, N.Cs6][Math.floor(Math.random() * 3)], 0, { gain: 0.004, length: 1.6, attack: 0.1, glint: 0.1, warmth: 0, room: 0.9, pan: wobble() * 3 }),
    },
    // Lossless audio: the studio. Soft electric piano, warm and analogue.
    lossless: {
      tap: (k, v) => keys(at([N.A4, N.Fs4, N.D4, N.E4], v), 0, { gain: 0.02, length: 0.5, echo: 0.1, pan: wobble() }),
      tab: (k, v) => keys(at([N.Fs5, N.A5, N.E5], v), 0, { gain: 0.018, length: 0.8 }),
      open: () => together(keys, [N.D4, N.A4, N.Cs5, N.E5], 0.02, { gain: 0.016, length: 1.4, echo: 0.25 }),
      close: () => together(keys, [N.A3, N.E4], 0, { gain: 0.016, length: 0.9 }),
      on: () => { swell([N.D3, N.A3], 0, { gain: 0.012, length: 1.0 }); keys(N.Fs5, 0.08, { gain: 0.018, length: 1.0 }); },
      off: () => keys(N.B3 * 2, 0, { gain: 0.016, length: 0.7 }),
      send: () => together(keys, [N.A4, N.E5, N.B5], 0.02, { gain: 0.016, length: 1.2, echo: 0.35 }),
      done: () => { swell([N.D3, N.A3, N.Fs4], 0, { gain: 0.012, length: 2.0 }); together(keys, [N.D5, N.Fs5, N.A5, N.Cs6], 0.05, { gain: 0.015, length: 1.8, echo: 0.3 }); },
      hover: () => keys([N.A5, N.Cs6, N.E6][Math.floor(Math.random() * 3)], 0, { gain: 0.004, length: 0.6 }),
    },
    // Visualizer: light and data. Soft glass glints that ripple across.
    visualizer: {
      tap: (k, v) => bell(at([N.E5, N.A5, N.Fs5, N.B5], v), 0, { gain: 0.016, length: 0.6, attack: 0.02, glint: 1.0, warmth: 0, echo: 0.2, pan: wobble() * 2 }),
      tab: (k, v) => { air(0, { from: 1200, to: 2400, gain: 0.01, length: 0.18 }); bell(at([N.Cs6, N.A5, N.E6], v), 0.02, { gain: 0.016, length: 0.8, glint: 1.0, warmth: 0, echo: 0.3 }); },
      open: () => bloom([N.E5, N.B5, N.Fs6], 0.02, { gain: 0.016, length: 1.3, attack: 0.04, glint: 1.0, echo: 0.35 }),
    },
    // Quests (in Nova Agent): small steps of the day. Warm kalimba, like a soft marimba.
    quests: {
      tap: (k, v) => pluck(at([N.D5, N.A4, N.Fs5, N.E5], v), 0, { gain: 0.018, length: 0.6, pan: wobble() }),
      tab: (k, v) => pluck(at([N.A5, N.Fs5, N.B5], v), 0, { gain: 0.018, length: 0.8 }),
      done: () => { together(pluck, [N.D5, N.A5, N.Fs6], 0.02, { gain: 0.018, length: 1.6, echo: 0.3 }); hum(N.D3, 0, { gain: 0.01, length: 1.8 }); },
      check: () => together(pluck, [N.A5, N.E6], 0, { gain: 0.016, length: 1.0, echo: 0.2 }),
      remove: () => pluck(N.D4, 0, { gain: 0.02, length: 0.6 }),
    },
  };

  // Which panel a page, a link or a button belongs to
  function themeFromPath(p) {
    p = String(p || "");
    if (/^pane:quests|#quests/.test(p)) return "quests";
    if (/^pane:/.test(p)) return "agent";
    if (/\/notes(\/|$)/.test(p)) return "notes";
    if (/\/calendar(\/|$)/.test(p)) return "calendar";
    if (/\/(portal|admin)(\/|$)/.test(p)) return "portal";
    if (/\/(app\/memory|index)(\/|$)/.test(p)) return "index";
    if (/\/observatory(\/|$)/.test(p)) return "observatory";
    if (/\/lossless(\/|$)/.test(p)) return "lossless";
    if (/\/visuali[sz]er|\/agent\/page/.test(p)) return "visualizer";
    return "agent";
  }
  const PAGE_THEME = themeFromPath(location.pathname);
  function themeOf(el) {
    if (!el || !el.closest) return PAGE_THEME;
    const marked = el.closest("[data-sfx-theme]");
    if (marked) return marked.dataset.sfxTheme;
    // A button that opens a panel sounds like that panel
    const opener = el.closest("a.suite-app, [data-tab], [data-open]");
    if (opener) return themeFromPath(opener.dataset.tab || opener.dataset.open || (opener.dataset.pane ? "pane:" + opener.dataset.pane : "") || opener.getAttribute("href"));
    return PAGE_THEME;
  }
  // A small number from what a button is called, so each one keeps its own note
  function variantOf(el) {
    if (!el || !el.getAttribute) return 0;
    const name = el.id || el.getAttribute("aria-label") || el.title || (el.textContent || "").trim().slice(0, 40) || String(el.className);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % 7;
  }

  const EXTRAS = new Set(["scroll", "key", "slide", "lift", "nudge", "place", "hover", "sheet", "swish", "felt", "shimmer", "unfold"]);
  // The least time between two of the same (scrubbing a scrollbar: an occasional soft tone, never a run)
  const GAPS = { scroll: 260, key: 35, slide: 70, nudge: 60, hover: 120, scrub: 1100, sheet: 4000, swish: 900, felt: 400, shimmer: 6000, unfold: 5000 };
  // The gentle extras keep apart from each other too, and there's a cap on how many play in a
  // minute (typing, sliders and nudges count a quarter each): calm, never chatty
  const SOFT = new Set(["sheet", "swish", "felt", "shimmer", "unfold"]);
  const SOFT_GAP = 350;
  const PER_MINUTE = 24;
  const extraLog = [];
  let lastSoft = 0;
  function allowExtra(name) {
    const now = performance.now();
    while (extraLog.length && now - extraLog[0].at > 60000) extraLog.shift();
    if (SOFT.has(name) && now - lastSoft < SOFT_GAP) return false;
    const w = name === "key" || name === "slide" || name === "nudge" ? 0.25 : 1;
    if (extraLog.reduce((a, e) => a + e.w, 0) + w > PER_MINUTE) return false;
    extraLog.push({ at: now, w });
    if (SOFT.has(name)) lastSoft = now;
    return true;
  }
  const lastOf = {};
  const SMALL = new Set(["tap", "tab", "menu", "pick", "check", "uncheck", "nav"]);
  let lastSmall = 0;
  const lastVariant = {};
  let busy = 0;
  let busyAt = 0;
  function play(name, arg, el, themeName) {
    if (!SOUNDS[name]) return;
    const extra = EXTRAS.has(name);
    if (extra ? !extraEnabled() : !enabled()) return;
    const now = performance.now();
    if (extra) {
      // Each extra keeps to its own pace, so it never turns into noise
      if (now - (lastOf[name] ?? -1e9) < (GAPS[name] || 45)) return;
      lastOf[name] = now;
      // Before the first real press, browsers keep sound off: don't wake it for these
      if (!ctx && name !== "lift" && name !== "place") return;
      if (!allowExtra(name)) return;
    } else {
      // Never a pile-up of sounds from one press
      if (now - last < 45) return;
      if (GAPS[name] && now - (lastOf[name] ?? -1e9) < GAPS[name]) return;
      if (GAPS[name]) lastOf[name] = now;
      // Calm, not chatty: the small sounds (taps, tabs, menus…) keep well apart, and the same
      // one doesn't come straight back
      if (SMALL.has(name)) {
        if (now - lastSmall < 380 || now - (lastOf[name] ?? -1e9) < 1100) return;
        lastSmall = now;
        lastOf[name] = now;
      }
      last = now;
    }
    try {
      if (!ready()) return;
      const theme = THEMES[themeName || themeOf(el)] || {};
      // Never the same note twice running: each play moves to another of the button's notes
      let v = variantOf(el) + Math.floor(Math.random() * 7);
      if (v % 7 === lastVariant[name]) v += 1 + Math.floor(Math.random() * 3);
      lastVariant[name] = v % 7;
      // The more sounds in quick succession, the softer they get (down to a third); a pause
      // of a couple of seconds brings them back
      busy = Math.max(0, busy - (now - busyAt) / 2000) + (extra ? 0.15 : 1);
      busyAt = now;
      level = Math.max(0.33, 1 - Math.max(0, busy - 2) * 0.12) * (0.92 + Math.random() * 0.08);
      jitter = 1 + (Math.random() - 0.5) * 0.008; // about a tenth of a semitone either way
      (theme[name] || SOUNDS[name])(typeof arg === "number" ? arg : undefined, v);
    } catch (err) {}
    level = 1;
    jitter = 1;
  }

  // Work out which sound a press should make
  const words = (el) => `${el.getAttribute("aria-label") || ""} ${el.title || ""} ${el.textContent || ""} ${el.className || ""} ${el.id || ""}`.toLowerCase();
  function soundFor(el) {
    const chosen = el.closest("[data-sfx]");
    if (chosen) return chosen.dataset.sfx;
    const ticked = el.checked || el.getAttribute("aria-checked") === "true";
    if (el.matches('[role="switch"], .switch input, .option-switch input')) return ticked ? "on" : "off";
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return ticked ? "check" : "uncheck";
    if (el.matches('[role="tab"], .tab, .seg button, .chips .chip, [role="menuitemradio"], [data-tab]')) return "tab";
    if (el.matches('[role="menuitem"], [role="option"]')) return "menu";
    if (el.matches("summary")) return el.parentElement && el.parentElement.open ? "close" : "open";
    const w = words(el);
    if (/\b(delete|remove|clear|discard|trash|unblock)\b|×|✕|card-delete/.test(w) && !/close/.test(w)) return "remove";
    if (/\bclose\b|cancel|dismiss|back\b/.test(w)) return "close";
    if (el.getAttribute("aria-haspopup") || /\bopen\b|menu|more|options|settings|suite|brand/.test(w)) return "open";
    if (/\b(done|finish|complete|✓|mark done|session done)\b/.test(w)) return "done";
    if (el.type === "submit" || /\b(send|save|add|plan|create|start|▶|sign in|book|export|copy)\b|primary|go\b/.test(w)) return "send";
    // A link to somewhere else (not a button made from a link)
    if (el.matches("a[href]") && !el.matches('[role="button"], .btn, .chip, .suite-app') && !/^#|^javascript:/.test(el.getAttribute("href"))) return "nav";
    return "tap";
  }

  // Every press, anywhere (switches make their sound when they change, so they say on or off)
  // Which way a tab moves: from the one chosen now to the one pressed (−1 left, 1 right)
  function tabDirection(el) {
    const group = el.closest('[role="tablist"], .tabs, .seg, .chips, nav, header, footer') || el.parentElement;
    if (!group) return Math.random() < 0.5 ? -1 : 1;
    const was = Array.from(group.querySelectorAll('[aria-selected="true"], [aria-pressed="true"], [aria-current="page"], [aria-current="true"], .active, .on')).find((x) => x !== el && !x.contains(el) && !el.contains(x));
    if (!was) return Math.random() < 0.5 ? -1 : 1;
    const a = was.getBoundingClientRect(), b = el.getBoundingClientRect();
    return b.left + b.width / 2 < a.left + a.width / 2 ? -1 : 1;
  }
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], summary, .chip, .tab, .theme-swatch');
      if (!el || el.disabled || el.matches('input[type="checkbox"], input[type="radio"]')) return;
      const sound = soundFor(el);
      play(sound, undefined, el);
      // The gentle extras: a soft brush that slides the way the tab moved
      if (sound === "tab" && extraEnabled()) play("swish", tabDirection(el), el);
    },
    true
  );
  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (el.matches && el.matches('input[type="checkbox"], input[type="radio"]')) {
        const sound = soundFor(el);
        play(sound, undefined, el);
        // The gentle extras: a felt touch under a switch or tick box
        if (sound !== "none" && el.type === "checkbox") play("felt", el.checked ? 1 : 0, el);
      } else if (el.matches && el.matches("select")) play("pick", undefined, el);
    },
    true
  );

  // ---- Scrollbars: taking hold of one, dragging it, letting go ----
  let grabbed = null;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target === document.documentElement ? document.scrollingElement || e.target : e.target;
      if (!el || !el.getBoundingClientRect || e.button !== 0) return;
      const r = el.getBoundingClientRect();
      // On its scrollbar: past the content's width (or height), inside the box
      const onBar = (el.scrollHeight > el.clientHeight && e.clientX > r.left + el.clientLeft + el.clientWidth && e.clientX <= r.right) ||
        (el.scrollWidth > el.clientWidth && e.clientY > r.top + el.clientTop + el.clientHeight && e.clientY <= r.bottom);
      if (!onBar) return;
      grabbed = el;
      play("grab", undefined, el);
    },
    true
  );
  const letGo = () => { if (grabbed) { play("release", undefined, grabbed); grabbed = null; } };
  addEventListener("pointerup", letGo, true);
  addEventListener("pointercancel", letGo, true);
  document.addEventListener(
    "scroll",
    (e) => {
      if (!grabbed) return;
      const el = e.target === document ? document.scrollingElement : e.target;
      if (el !== grabbed) return;
      const room = el.scrollHeight - el.clientHeight;
      play("scrub", room > 0 ? el.scrollTop / room : 0.5, el);
    },
    { capture: true, passive: true }
  );

  // ---- Scrolling: a velvety whisper that follows the scrolling ----
  // Not a sound per step: one soft, continuous texture of warm filtered noise that only comes in
  // once scrolling has gone on for a moment, swells gently with the speed, and fades away when
  // the scrolling stops. Each panel tints it (Notes papery, Portal and the night sky deeper),
  // and every run is a little different. Dragging a scrollbar's thumb makes it a touch fuller.
  const TEXTURE = { notes: [1100, 1], calendar: [650, 0.8], portal: [420, 0.7], observatory: [360, 0.7], index: [700, 0.8], lossless: [520, 0.8] };
  const VELVET = 0.016; // its level at full speed (before the overall volume): barely there
  function velvetVoice(kind, theme, t) {
    const [centre, q] = TEXTURE[theme] || [560, 0.8];
    const n = noise();
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = vary(centre * (kind === "drag" ? 0.8 : 1), 0.1);
    bp.Q.value = vary(q, 0.2);
    const lp = lowpass(1500);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const out = place((Math.random() - 0.5) * 0.4, { room: 0.35 });
    n.connect(bp).connect(lp).connect(amp).connect(out);
    n.start(t, Math.random() * 1.5);
    return { n, bp, lp, amp, out, centre: bp.frequency.value, full: kind === "drag" ? 1.25 : 1, fed: 0 };
  }
  function velvetLevel(v, k, t) {
    v.amp.gain.setTargetAtTime(k * VELVET * v.full * level, t, 0.18);
    v.bp.frequency.setTargetAtTime(v.centre * (0.92 + 0.2 * k), t, 0.35);
  }
  function velvetFade(v, t) {
    v.amp.gain.setTargetAtTime(0, t, 0.22);
    v.n.stop(t + 1.6);
    tidy(v.n, [v.n, v.bp, v.lp, v.amp, v.out]);
  }
  let velvet = null;
  let velvetSince = 0;
  let velvetLast = 0;
  let velvetIdle = null;
  function feelScroll(speed, el, kind) {
    if (!ctx || !extraEnabled()) return;
    const now = performance.now();
    if (now - velvetLast > 250) velvetSince = now; // a new run of scrolling
    velvetLast = now;
    if (now - velvetSince < 300) return; // only sustained scrolling, never a flick's first moment
    try {
      if (!velvet) {
        if (!allowExtra("scroll")) return; // one run counts as one extra sound
        ready();
        level = 1;
        velvet = velvetVoice(kind, themeOf(el), ctx.currentTime);
      }
      if (now - velvet.fed > 60) {
        velvet.fed = now;
        velvetLevel(velvet, Math.pow(Math.min(1, speed / 2.5), 0.7), ctx.currentTime);
      }
    } catch (err) {
      return;
    }
    clearTimeout(velvetIdle);
    velvetIdle = setTimeout(() => {
      if (velvet) { try { velvetFade(velvet, ctx.currentTime); } catch (err) {} velvet = null; }
    }, 160);
  }

  // ---- The extras, found by themselves ----
  // Scrolling anywhere (the page or anything inside it): the velvet texture, fuller the faster
  const scrolled = new WeakMap();
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target === document ? document.scrollingElement || document.documentElement : e.target;
      if (!el || typeof el.scrollTop !== "number") return;
      const pos = el.scrollTop + el.scrollLeft;
      const was = scrolled.get(el);
      scrolled.set(el, { pos, at: performance.now() });
      if (!was) return;
      const speed = Math.abs(pos - was.pos) / Math.max(16, performance.now() - was.at); // px per ms
      if (speed > 0.05) feelScroll(speed, el, grabbed === el ? "drag" : "scroll");
    },
    { capture: true, passive: true }
  );
  // Arriving on a sheet, dialog or menu with the mouse: soft fabric drifting by (once per sheet)
  let onSheet = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType !== "mouse" || !e.target.closest) return;
      const el = e.target.closest('[role="dialog"], dialog[open], .sheet, .modal, .drawer, [role="menu"], [data-sheet]');
      if (!el || el === onSheet) return;
      onSheet = el;
      play("sheet", undefined, el);
    },
    true
  );
  document.addEventListener("pointerout", (e) => { if (onSheet && !onSheet.contains(e.relatedTarget)) onSheet = null; }, true);
  // The theme changing: a gentle shimmer
  window.addEventListener("novathemechange", () => play("shimmer"));
  // (and when the look for all of Nova Agent changes to another theme: look.js)
  const lookOf = (d) => `${(d && d.theme) || ""}|${d && d.planet ? 1 : 0}`;
  let lookWas = null;
  try { lookWas = lookOf(JSON.parse(localStorage.getItem("nova-look") || "{}")); } catch (err) {}
  window.addEventListener("novalookchange", (e) => {
    const now = lookOf(e.detail);
    if (now !== lookWas) play("shimmer");
    lookWas = now;
  });
  // A panel opening (a panel's page loading in its frame, just after a press): a warm unfolding
  let pressedAt = -1e9;
  const pressed = () => (pressedAt = performance.now());
  document.addEventListener("pointerdown", pressed, true);
  document.addEventListener("keydown", pressed, true);
  document.addEventListener(
    "load",
    (e) => {
      const f = e.target;
      if (!f || f.tagName !== "IFRAME" || performance.now() - pressedAt > 2500 || !f.getClientRects().length) return;
      let path = "";
      try { path = new URL(f.src, location.href).pathname; } catch (err) {}
      play("unfold", undefined, f, themeFromPath(path));
    },
    true
  );
  // Typing in a box: one tiny touch per key (not for shortcuts or held keys)
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.isContentEditable || (t.matches && t.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])')));
      if (typing && (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) play("key", undefined, t);
    },
    true
  );
  // Sliders: the tone follows where it is
  document.addEventListener(
    "input",
    (e) => {
      const r = e.target;
      if (!r.matches || !r.matches('input[type="range"]')) return;
      const min = Number(r.min) || 0, max = Number(r.max) || 100;
      play("slide", (Number(r.value) - min) / (max - min || 1), r);
    },
    true
  );
  // Dragging things (anything the browser drags; Calendar's note cards call lift/nudge/place itself)
  document.addEventListener("dragstart", (e) => play("lift", undefined, e.target), true);
  document.addEventListener("drop", (e) => play("place", undefined, e.target), true);
  // Hovering with a mouse over a tile or card: one faint shimmer as you arrive on it
  let hovered = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType !== "mouse") return;
      const el = e.target.closest && e.target.closest('.suite-app, .tg-items [data-tab], .tile, .card, .stat, .note-item, [data-hover-sfx]');
      if (!el || el === hovered) return;
      hovered = el;
      play("hover", undefined, el);
    },
    true
  );
  document.addEventListener("pointerout", (e) => { if (hovered && !hovered.contains(e.relatedTarget)) hovered = null; }, true);

  // The ambient music lives in Nova Agent's main page (ambient.js). A press inside a panel
  // counts as a press there too, so music that was on last time can start again from here.
  document.addEventListener(
    "pointerdown",
    () => {
      try {
        if (window.top !== window && window.top.NovaAmbient && window.top.NovaAmbient.nudge) window.top.NovaAmbient.nudge();
      } catch (err) {} // a page from somewhere else: not ours to nudge
    },
    true
  );

  // play(name) from a panel's own code sounds like that panel; play(name, undefined, element)
  // like the element's panel (and with that element's own note)
  // ---- Offline checks (scripts/audio-levels.mjs, test/audio-levels.spec.ts) ----
  // Render one sound without a speaker and measure it: peak and loudness in dBFS. "velvet" is
  // the scrolling texture, fed a run of scroll speeds (px per ms, one every 60 ms).
  async function render(name, o = {}) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rate = o.rate || 44100;
    const seconds = o.seconds || 4;
    const octx = new OAC(2, Math.ceil(rate * seconds), rate);
    const saved = [ctx, dry, wet, echo, noiseBuf];
    ctx = octx;
    noiseBuf = null;
    try {
      desk();
      level = 1;
      jitter = 1 + (Math.random() - 0.5) * 0.008;
      if (name === "velvet") {
        const speeds = o.profile || [0.6, 1, 1.6, 2.4, 3, 3, 2.6, 2, 1.4, 1, 0.8, 0.6, 1.2, 2, 3.2, 3.6, 3, 2, 1, 0.5];
        const v = velvetVoice(o.kind || "scroll", o.theme, 0.05);
        speeds.forEach((s, i) => velvetLevel(v, Math.pow(Math.min(1, s / 2.5), 0.7), 0.05 + i * 0.06));
        velvetFade(v, 0.05 + speeds.length * 0.06 + 0.16);
      } else {
        const theme = THEMES[o.theme] || {};
        (theme[name] || SOUNDS[name])(typeof o.arg === "number" ? o.arg : undefined, o.variant || 0);
      }
    } finally {
      [ctx, dry, wet, echo, noiseBuf] = saved;
      level = 1;
      jitter = 1;
    }
    const buf = await octx.startRendering();
    let peak = 0;
    let loud = 0;
    const win = Math.floor(rate * 0.1);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0, w = 0, n = 0; i < L.length; i++) {
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      w += (L[i] * L[i] + R[i] * R[i]) / 2;
      if (++n === win) { loud = Math.max(loud, w / n); w = 0; n = 0; }
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { name, theme: o.theme || "agent", peakDb: db(peak), loudestDb: db(Math.sqrt(loud)), clipped: peak >= 1 };
  }
  const names = () => ({ sounds: Object.keys(SOUNDS), extras: Array.from(EXTRAS), soft: Array.from(SOFT), themes: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, Object.keys(v)])) });

  window.NovaSfx = { play, enabled, setEnabled, toggle: () => setEnabled(!enabled()), extraEnabled, setExtraEnabled, toggleExtra: () => setExtraEnabled(!extraEnabled()), _render: render, _names: names };
})();
