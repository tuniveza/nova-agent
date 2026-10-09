// Nova Agent sound effects: Novacane's soft glass tones, warm under-tones and breaths of air for
// every tap, tab, switch, open, close, send, done and delete. Ambient, not beeps: everything swells
// in, chords bloom together instead of running up like a game, and taps are a low felt touch.
// Made live with the Web Audio API (no sound files), in D lydian (the same key as the ambient
// music in ambient.js, so the two always sound right together), placed across left and right and
// washed in a little room of reverb and echo. Kept quiet.
//
// Sounds play by themselves: one listener works out what kind of thing was pressed (a tab, a
// switch, a "send", a "delete"...). An element can choose its own sound with
// data-sfx="tap|tab|open|close|on|off|send|done|remove|error|message|welcome|none".
// Switched off and on with NovaSfx.setEnabled(false/true); remembered on the device.
// The extras (scrolling, typing, sliders, dragging, hovering) are barely there and have their own
// switch, NovaSfx.setExtraEnabled(false/true), also remembered on the device.
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

  // The extra, very quiet sounds (scrolling, typing, sliders, dragging, hovering) have their
  // own switch: on unless switched off on this device, and only while sounds are on at all
  const EXTRA = "nova-sfx-extra";
  function extraEnabled() {
    try {
      return enabled() && localStorage.getItem(EXTRA) !== "off";
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
      // Everything meets in a gentle limiter, then the overall volume
      const limit = ctx.createDynamicsCompressor();
      limit.threshold.value = -20;
      limit.knee.value = 18;
      limit.ratio.value = 5;
      // Calm and soft: well down in volume, and a warm top end so nothing is ever bright or sharp
      const master = ctx.createGain();
      master.gain.value = 0.5;
      const warm = ctx.createBiquadFilter();
      warm.type = "lowpass";
      warm.frequency.value = 4200;
      warm.Q.value = 0.4;
      limit.connect(warm).connect(master).connect(ctx.destination);
      dry = limit;
      // Reverb
      wet = ctx.createGain();
      const verb = ctx.createConvolver();
      verb.buffer = room(2.4);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.7; // more space around everything: lush, not dry
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
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Where a sound sits, left (-1) to right (1); old Safari has no panner, so it stays centred
  function place(pan, { room: r = 0.35, echo: e = 0 } = {}) {
    const g = ctx.createGain();
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

  // A soft, round touch (taps): a warm sine whose pitch settles as it starts, like a felt
  // hammer on a low string, with a little room around it
  function drop(freq, at, { gain = 0.05, length = 0.28, pan = 0 } = {}) {
    const t = ctx.currentTime + at;
    const out = place(pan, { room: 0.4 });
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.12, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(amp).connect(out);
    o.start(t);
    o.stop(t + length + 0.05);
    tidy(o, [o, amp, out]);
  }

  // A warm swell under everything (big moments): a few soft detuned saws through a closing filter
  function swell(freqs, at, { gain = 0.018, length = 1.6 } = {}) {
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

  // The notes: D lydian (D E F# G# A B C#), mostly in the middle-high range so nothing is shrill
  const N = { A4: 440, B4: 493.88, Cs5: 554.37, D5: 587.33, E5: 659.25, Fs5: 739.99, Gs5: 830.61, A5: 880, B5: 987.77, Cs6: 1108.73, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, A6: 1760, D3: 146.83, A3: 220, Fs3: 185, D4: 293.66, Fs4: 369.99, Cs4: 277.18 };

  // A chord that blooms: its notes swell in together (a hair apart, like a soft strum), never a run
  const bloom = (freqs, at, opts) => freqs.forEach((f, i) => bell(f, at + i * 0.018, { pan: (i / Math.max(1, freqs.length - 1) - 0.5) * 0.9, ...opts }));

  const SOUNDS = {
    // A light tap on anything: a soft, low felt touch
    tap: () => drop(N.D5, 0, { gain: 0.07, pan: (Math.random() - 0.5) * 0.3 }),
    // Switching tabs or views: a puff of air and one glass tone
    tab: () => {
      air(0, { from: 900, to: 1700, gain: 0.014, length: 0.2, panFrom: -0.2, panTo: 0.2 });
      bell(N.A5, 0.01, { gain: 0.03, length: 0.9, attack: 0.025 });
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
      drop(N.D4, 0, { gain: 0.07, length: 0.45 });
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
    scroll: (k = 0.5) => air(0, { from: 500 + 500 * k, to: 900 + 900 * k, gain: 0.002 + 0.004 * k, length: 0.22, panFrom: -0.15, panTo: 0.15 }),
    // Typing: the softest touch per key, a little different each time
    key: () => drop(N.D5 * (1 + (Math.random() - 0.5) * 0.06), 0, { gain: 0.007, length: 0.09, pan: (Math.random() - 0.5) * 0.4 }),
    // A slider: a soft tone that rises and falls with it (k = 0–1 along the slider)
    slide: (k = 0.5) => {
      const steps = [N.D4, N.E5 / 2, N.Fs4, N.A4, N.B4, N.D5, N.E5, N.Fs5, N.A5, N.B5, N.D6];
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

    // Hello (sound switched on): Novacane's chord, D–A–C♯–F♯, blooming over a soft swell
    welcome: () => {
      swell([N.D3, N.A3, N.Cs5], 0, { gain: 0.012, length: 2.4 });
      bloom([N.D5, N.A5, N.Cs6, N.Fs6], 0.05, { gain: 0.024, length: 2, attack: 0.08, echo: 0.35 });
    },
  };


  const EXTRAS = new Set(["scroll", "key", "slide", "lift", "nudge", "place", "hover"]);
  const GAPS = { scroll: 260, key: 35, slide: 70, nudge: 60, hover: 120 }; // the least time between two
  const lastOf = {};
  function play(name, arg) {
    if (!SOUNDS[name]) return;
    const extra = EXTRAS.has(name);
    if (extra ? !extraEnabled() : !enabled()) return;
    const now = performance.now();
    if (extra) {
      // Each extra keeps to its own pace, so it never turns into noise
      if (now - (lastOf[name] || 0) < (GAPS[name] || 45)) return;
      lastOf[name] = now;
      // Before the first real press, browsers keep sound off: don't wake it for these
      if (!ctx && name !== "lift" && name !== "place") return;
    } else {
      // Never a pile-up of sounds from one press
      if (now - last < 45) return;
      last = now;
    }
    try {
      if (!ready()) return;
      SOUNDS[name](typeof arg === "number" ? arg : undefined);
    } catch (err) {}
  }

  // Work out which sound a press should make
  const words = (el) => `${el.getAttribute("aria-label") || ""} ${el.title || ""} ${el.textContent || ""} ${el.className || ""} ${el.id || ""}`.toLowerCase();
  function soundFor(el) {
    const chosen = el.closest("[data-sfx]");
    if (chosen) return chosen.dataset.sfx;
    if (el.matches('input[type="checkbox"], input[type="radio"], [role="switch"]')) return el.checked || el.getAttribute("aria-checked") === "true" ? "on" : "off";
    if (el.matches('[role="tab"], .tab, .seg button, .chips .chip, [role="menuitemradio"]')) return "tab";
    if (el.matches("summary")) return el.parentElement && el.parentElement.open ? "close" : "open";
    const w = words(el);
    if (/\b(delete|remove|clear|discard|trash|unblock)\b|×|✕|card-delete/.test(w) && !/close/.test(w)) return "remove";
    if (/\bclose\b|cancel|dismiss|back\b/.test(w)) return "close";
    if (el.getAttribute("aria-haspopup") || /\bopen\b|menu|more|options|settings|suite|brand/.test(w)) return "open";
    if (/\b(done|finish|complete|✓|mark done|session done)\b/.test(w)) return "done";
    if (el.type === "submit" || /\b(send|save|add|plan|create|start|▶|sign in|book|export|copy)\b|primary|go\b/.test(w)) return "send";
    return "tap";
  }

  // Every press, anywhere (switches make their sound when they change, so they say on or off)
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target.closest('button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], summary, .chip, .tab, .theme-swatch');
      if (!el || el.disabled || el.matches('input[type="checkbox"], input[type="radio"]')) return;
      play(soundFor(el));
    },
    true
  );
  document.addEventListener(
    "change",
    (e) => {
      const el = e.target;
      if (el.matches && el.matches('input[type="checkbox"], input[type="radio"]')) play(soundFor(el));
      else if (el.matches && el.matches("select")) play("tap");
    },
    true
  );

  // ---- The extras, found by themselves ----
  // Scrolling anywhere (the page or anything inside it): stronger the faster it moves
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
      if (speed > 0.05) play("scroll", Math.min(1, speed / 3));
    },
    { capture: true, passive: true }
  );
  // Typing in a box: one tiny touch per key (not for shortcuts or held keys)
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.isContentEditable || (t.matches && t.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])')));
      if (typing && (e.key.length === 1 || e.key === "Backspace" || e.key === "Enter")) play("key");
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
      play("slide", (Number(r.value) - min) / (max - min || 1));
    },
    true
  );
  // Dragging things (anything the browser drags; Calendar's note cards call lift/nudge/place itself)
  document.addEventListener("dragstart", () => play("lift"), true);
  document.addEventListener("drop", () => play("place"), true);
  // Hovering with a mouse over a tile or card: one faint shimmer as you arrive on it
  let hovered = null;
  document.addEventListener(
    "pointerover",
    (e) => {
      if (e.pointerType !== "mouse") return;
      const el = e.target.closest && e.target.closest('.suite-app, .tg-items [data-tab], .tile, .card, .stat, .note-item, [data-hover-sfx]');
      if (!el || el === hovered) return;
      hovered = el;
      play("hover");
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

  window.NovaSfx = { play, enabled, setEnabled, toggle: () => setEnabled(!enabled()), extraEnabled, setExtraEnabled, toggleExtra: () => setExtraEnabled(!extraEnabled()) };
})();
