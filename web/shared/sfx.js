// Nova Agent sound effects: Novacane's glass bells, warm under-tones and soft breaths of air for
// every tap, tab, switch, open, close, send, done and delete. Made live with the Web Audio API
// (no sound files), in D lydian (the same key as the ambient music in ambient.js, so the two
// always sound right together), placed across left and right and washed in a little room of
// reverb and echo. Kept quiet.
//
// Sounds play by themselves: one listener works out what kind of thing was pressed (a tab, a
// switch, a "send", a "delete"...). An element can choose its own sound with
// data-sfx="tap|tab|open|close|on|off|send|done|remove|error|message|welcome|none".
// Switched off and on with NovaSfx.setEnabled(false/true); remembered on the device.
//   window.NovaSfx = { play(name), enabled(), setEnabled(on), toggle() }
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
      const master = ctx.createGain();
      master.gain.value = 0.72;
      limit.connect(master).connect(ctx.destination);
      dry = limit;
      // Reverb
      wet = ctx.createGain();
      const verb = ctx.createConvolver();
      verb.buffer = room(2.4);
      const verbOut = ctx.createGain();
      verbOut.gain.value = 0.55;
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

  // One glass bell: a sine with a bright, slightly out-of-tune glint (FM) that melts away fast,
  // a twin a hair sharp for a soft shimmer, and a warm sine an octave under it
  function bell(freq, at, { gain = 0.05, length = 0.9, pan = 0, glint = 1.6, warmth = 0.35, room: r = 0.35, echo: e = 0 } = {}) {
    const t = ctx.currentTime + at;
    const out = place(pan, { room: r, echo: e });
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
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

  // A soft, round drop of a note (taps): a sine whose pitch settles as it starts, like a water drop
  function drop(freq, at, { gain = 0.05, length = 0.22, pan = 0 } = {}) {
    const t = ctx.currentTime + at;
    const out = place(pan, { room: 0.25 });
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.005);
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

  const SOUNDS = {
    // A light tap on anything: a soft round drop
    tap: () => drop(N.A5, 0, { gain: 0.08, pan: (Math.random() - 0.5) * 0.3 }),
    // Switching tabs or views: two glass notes stepping across
    tab: () => {
      bell(N.E5, 0, { gain: 0.035, length: 0.6, pan: -0.2, glint: 1.2 });
      bell(N.B5, 0.06, { gain: 0.032, length: 0.8, pan: 0.2, glint: 1.2 });
    },
    // Opening a sheet, dialog, menu or panel: a breath of air rising, and a chord blooming
    open: () => {
      air(0, { from: 450, to: 2600, gain: 0.026 });
      bell(N.D5, 0.02, { gain: 0.03, length: 0.9, pan: -0.35 });
      bell(N.Fs5, 0.075, { gain: 0.028, length: 1.0, pan: 0 });
      bell(N.Cs6, 0.13, { gain: 0.026, length: 1.2, pan: 0.35, echo: 0.25 });
    },
    // Closing it again: the air falls, two notes settle
    close: () => {
      air(0, { from: 2200, to: 450, gain: 0.02, length: 0.26, panFrom: 0.4, panTo: -0.4 });
      bell(N.A5, 0, { gain: 0.026, length: 0.6, pan: 0.25, glint: 1 });
      bell(N.E5, 0.06, { gain: 0.024, length: 0.8, pan: -0.25, glint: 1 });
    },
    // A switch turned on / off: up a fifth, or down
    on: () => {
      bell(N.Fs5, 0, { gain: 0.035, length: 0.5, pan: -0.15 });
      bell(N.Cs6, 0.055, { gain: 0.035, length: 0.8, pan: 0.15 });
    },
    off: () => {
      bell(N.Cs6, 0, { gain: 0.03, length: 0.4, pan: 0.15, glint: 1 });
      bell(N.Fs5, 0.055, { gain: 0.028, length: 0.6, pan: -0.15, glint: 1 });
    },
    // Sending a message or saving something: three notes flying off, with an echo
    send: () => {
      bell(N.D5, 0, { gain: 0.035, length: 0.6, pan: -0.3 });
      bell(N.A5, 0.05, { gain: 0.034, length: 0.7, pan: 0 });
      bell(N.E6, 0.1, { gain: 0.03, length: 1.1, pan: 0.35, echo: 0.45 });
    },
    // Something finished: a sparkling run up over a warm swell
    done: () => {
      swell([N.D3, N.A3, N.Fs4, N.Cs5], 0, { gain: 0.012, length: 1.8 });
      [N.D5, N.Fs5, N.A5, N.Cs6, N.E6, N.Fs6].forEach((f, i) => bell(f, i * 0.06, { gain: 0.03, length: 1.3, pan: -0.5 + i * 0.2, echo: i > 3 ? 0.3 : 0 }));
    },
    // Removing or deleting: a soft low fall
    remove: () => {
      drop(N.A4, 0, { gain: 0.05, length: 0.3, pan: 0.15 });
      drop(N.D4, 0.08, { gain: 0.05, length: 0.45, pan: -0.15 });
    },
    // Something went wrong: two low, muted notes (no glass)
    error: () => {
      bell(N.Cs4 * 1.2, 0, { gain: 0.04, length: 0.35, glint: 0.3, warmth: 0.6, room: 0.2 });
      bell(N.Cs4, 0.13, { gain: 0.04, length: 0.55, glint: 0.3, warmth: 0.6, room: 0.2 });
    },
    // A message arrived: a high, gentle call that echoes away
    message: () => {
      bell(N.B5, 0, { gain: 0.03, length: 0.9, pan: -0.2, echo: 0.3 });
      bell(N.E6, 0.09, { gain: 0.026, length: 1.3, pan: 0.25, echo: 0.45 });
    },
    // Hello (sound switched on): Novacane's little signature, D–A–C#–F#, over a soft swell
    welcome: () => {
      swell([N.D3, N.A3, N.Cs5], 0, { gain: 0.01, length: 2.2 });
      [N.D5, N.A5, N.Cs6, N.Fs6].forEach((f, i) => bell(f, i * 0.11, { gain: 0.03, length: 1.5, pan: -0.45 + i * 0.3, echo: i === 3 ? 0.5 : 0.15 }));
    },
  };

  function play(name) {
    if (!enabled() || !SOUNDS[name]) return;
    // Never a pile-up of sounds from one press
    const now = performance.now();
    if (now - last < 45) return;
    last = now;
    try {
      if (!ready()) return;
      SOUNDS[name]();
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

  window.NovaSfx = { play, enabled, setEnabled, toggle: () => setEnabled(!enabled()) };
})();
