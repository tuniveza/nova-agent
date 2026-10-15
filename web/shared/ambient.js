/* Nova Ambient: Novacane's never-ending late-night studio music for all of Nova Agent.
   Everything is made live with the Web Audio API: no audio files, no libraries, no network.
   Warm and calm, but always moving: a small studio band on a gentle pulse (68–86 bpm) plays
   soulful 7th and 9th chords that change every bar or two, a round bass line that walks with
   them, a melody of short motifs that come back and get answered, and (often, very quietly)
   soft swung lo-fi drums. It develops in sections: an intro, A and B, and now and then a
   breakdown. Kept low so it sits behind everything, warm (no bright highs), never the same twice.

   Pieces: seven take turns, each for a few minutes, crossfading slowly into the next (never the
   same piece twice running):
     Glow            Novacane's own: dreamy pads and Rhodes, vibraphone melody, stars and air
     Warm keys       a neo-soul Rhodes trio: syncopated chords, a melodic bass, the piano sings
     Tape beat       lo-fi: wobbly tape keys, swung boom-bap drums, a breathy flute, tape hiss
     Late night      ambient R&B: pads and Rhodes, a hummed melody, slow kick, soft rain
     Night trio      a late-night jazz trio: walking bass, brushes, vibraphone
     Whisper garage  2-step at a whisper: skippy drums, plucked stabs, a muted synth lead
     Afro glow       a warm afro groove: shaker, rolling bass, plucks, a flute melody
   All of them are in or next to D lydian (the sound effects' key), so they always fit.

   Seeds: every listen is generated from a seed (a short code like "K7M2QX"). The seed
   chooses the order of the pieces, each piece's key and mode, its tempo and swing, its
   progressions, motifs and bass lines, when the drums play, the size of the reverb and
   the echo, and its textures. A new random seed each session; a liked one can be kept (it then
   plays every time) or typed back in to hear that variation again.
     NovaAmbient.seed()            the seed playing now
     NovaAmbient.setSeed("K7M2QX") play that variation (crossfades)
     NovaAmbient.newSeed()         a fresh random variation
     NovaAmbient.keepSeed(true)    play this seed every time (false: a new one each session)
     NovaAmbient.piece()           { id, name } of the piece playing now
     window 'novaambientseed' event (every page and panel): { seed, kept, piece }

   One player for the whole app: it plays in Nova Agent's main page, so it carries on
   while panels open and close. Inside a panel this file just hands over to that one.
   On or off is remembered on the device ("nova-music"); when it was on, it starts
   again on the first tap (browsers only allow sound after a tap). It pauses (fading
   out) while the app is hidden and fades back in when it's shown again.
   The colour of the theme tints it, subtly: warm themes a touch darker, cool a touch airier.

   Usage (from a tap/click handler):
     NovaAmbient.toggle().then(playing => ...)
     NovaAmbient.setVolume(0.4)
     NovaAmbient.onchange = playing => updateButton(playing)
     window.addEventListener('novaambientchange', e => e.detail.on)  // every page, every panel
*/
(function () {
  'use strict';
  if (window.NovaAmbient) return;

  // Inside a panel: use the main page's player (same site), so there's only ever one
  let main = null;
  try { if (window.top !== window && window.top.NovaAmbient) main = window.top.NovaAmbient; } catch (e) { /* another site's page */ }
  if (main) {
    const call = (name, ...args) => (typeof main[name] === 'function' ? main[name](...args) : null);
    const here = {
      start: () => main.start(),
      stop: () => main.stop(),
      toggle: () => main.toggle(),
      setVolume: (v) => main.setVolume(v),
      isPlaying: () => main.isPlaying(),
      wanted: () => main.wanted(),
      nudge: () => main.nudge(),
      seed: () => call('seed'),
      setSeed: (s) => call('setSeed', s),
      newSeed: () => call('newSeed'),
      keepSeed: (on) => call('keepSeed', on),
      keepFor: (mode) => call('keepFor', mode),
      keepMode: () => call('keepMode'),
      volume: () => call('volume'),
      keptSeed: () => call('keptSeed'),
      piece: () => call('piece'),
      pieces: main.pieces,
      onchange: null
    };
    window.addEventListener('novaambientchange', (e) => {
      if (typeof here.onchange === 'function') { try { here.onchange(e.detail.on); } catch (err) { /* listener's problem */ } }
    });
    window.NovaAmbient = here;
    return;
  }

  const KEY = 'nova-music';
  const SEED_KEY = 'nova-music-seed';   // a kept seed (plays every time); none: a new one each session
  const LAST_KEY = 'nova-music-last';   // the seed heard most recently (so it can be found again)

  // ---- Seeds: a small, fast, repeatable random number generator ------------------
  const SEED_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function randomSeed() {
    let s = '';
    const n = new Uint32Array(6);
    try { crypto.getRandomValues(n); } catch (e) { for (let i = 0; i < 6; i++) n[i] = Math.floor(Math.random() * 4294967296); }
    for (let i = 0; i < 6; i++) s += SEED_CHARS[n[i] % SEED_CHARS.length];
    return s;
  }
  function cleanSeed(s) {
    const v = String(s == null ? '' : s).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
    return v || null;
  }
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  // mulberry32: one stream of numbers in [0, 1) from a 32-bit number
  function rngFrom(n) {
    let a = n >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Each part of the music has its own stream, so the same seed always gives the same choices
  // whatever order the scheduler happens to ask in
  const stream = (seed, label) => rngFrom(hashStr(seed + '|' + label));
  const rr = (r, a, b) => a + r() * (b - a);
  const pk = (r, list) => list[Math.floor(r() * list.length)];
  function weighted(r, items, weights) {
    let x = r() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) { if ((x -= weights[i]) <= 0) return items[i]; }
    return items[items.length - 1];
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---- Keys and chords -----------------------------------------------------------------
  // Every key is one of the three note-sets around D lydian (A major's notes; D major's, one
  // note away; E major's, one note away the other side), so the sound effects always fit.
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const MODE_DEG = { ionian: 0, dorian: 1, lydian: 3, mixolydian: 4, aeolian: 5 };
  function makeKey(r, modes) {
    const home = weighted(r, [9, 2, 4], [0.55, 0.3, 0.15]);
    const mode = pk(r, modes);
    const d = MODE_DEG[mode];
    const steps = [];
    for (let i = 0; i < 7; i++) steps.push((MAJOR[(d + i) % 7] - MAJOR[d] + 12) % 12);
    return { tonic: (home + MAJOR[d]) % 12, steps, mode };
  }
  // Semitones above the key's tonic of scale step n (any whole number, up or down)
  const semi = (key, n) => 12 * Math.floor(n / 7) + key.steps[((n % 7) + 7) % 7];
  // The MIDI note of the tonic nearest to a note
  const tonicNear = (key, near) => near + ((((key.tonic - near) % 12) + 18) % 12) - 6;
  function quality(key, d) {
    const third = semi(key, d + 2) - semi(key, d), fifth = semi(key, d + 4) - semi(key, d);
    return fifth !== 7 ? 'dim' : third === 4 ? 'maj' : 'min';
  }
  // Wandering chords on the scale's major and minor chords: moves by fourths and fifths a little
  // more likely, home a little more likely, the ones heard lately less likely
  function Harmony(key, r) {
    const ok = [0, 1, 2, 3, 4, 5, 6].filter((d) => quality(key, d) !== 'dim');
    let cur = 0;
    const recent = [0];
    return {
      next() {
        const opts = ok.filter((d) => d !== cur);
        const w = opts.map((d) => {
          const m = (((d - cur) % 7) + 7) % 7;
          let x = m === 3 || m === 4 ? 1.4 : m === 1 || m === 6 ? 1 : 0.85;
          if (d === 0) x *= 1.3;
          return x / (1 + 2 * recent.filter((q) => q === d).length);
        });
        cur = weighted(r, opts, w);
        recent.push(cur);
        if (recent.length > 5) recent.shift();
        return cur;
      },
      get cur() { return cur; }
    };
  }
  // Voicings: which chord tones (0 root, 1 third, 2 fifth, 3 seventh, 4 ninth, 5 eleventh) in which octave
  const STYLES = {
    open:   [[0, 0], [2, 0], [4, 0], [1, 1], [3, 1]],
    close:  [[1, 0], [2, 0], [3, 0], [4, 0]],
    shell:  [[0, 0], [3, 0], [1, 1], [4, 1]],
    wide:   [[0, 0], [2, 0], [1, 1], [4, 1], [2, 2]],
    eleven: [[0, 0], [2, 0], [3, 0], [4, 1], [5, 1]]
  };
  // A chord's notes in a style, placed near a centre (and near the last chord, so they move
  // smoothly), with any muddy close rubs in the low register taken out
  function voice(key, d, style, center, prev) {
    const root = semi(key, d);
    const q = quality(key, d);
    const offs = [];
    for (const [k, oct] of STYLES[style]) {
      let kk = k;
      const t = semi(key, d + 2 * k) - root;
      if (k === 4 && t % 12 === 1) kk = 2;                                  // no flat ninths
      if (k === 5 && !((q === 'min' && t % 12 === 5) || (q === 'maj' && t % 12 === 6))) kk = 2; // only lush elevenths
      offs.push(semi(key, d + 2 * kk) + 12 * oct);
    }
    const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
    const target = prev ? 0.5 * center + 0.5 * prev.reduce((a, b) => a + b, 0) / prev.length : center;
    const base = tonicNear(key, Math.round(target - mean));
    const notes = [];
    for (const n of offs.map((o) => o + base).sort((x, y) => x - y)) {
      if (notes.some((m) => n - m === 0 || (n - m <= 1 && n < 70) || (n - m <= 2 && n < 55))) continue;
      notes.push(n);
    }
    return notes;
  }
  const bassOf = (key, d, lo) => { const pc = (key.tonic + semi(key, d)) % 12; return lo + ((pc - lo) % 12 + 12) % 12; };

  // A soft curve for the very end: does nothing at all to anything quieter than −10 dBFS (the
  // music is far below that), and rounds off anything louder so it can never clip
  function safetyCurve() {
    const n = 4097, c = new Float32Array(n), T = 0.3;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
      c[i] = a <= T ? x : Math.sign(x) * (T + (1 - T) * Math.tanh((a - T) / (1 - T)));
    }
    return c;
  }
  // Tape warmth: gentle saturation
  function tapeCurve() {
    const n = 2049, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 1.2) / Math.tanh(1.2); }
    return c;
  }

  // =====================================================================================
  // The engine: one seed's music on one audio context (the live one, or an offline one for checks)
  // =====================================================================================
  const PIECE_NAMES = { glow: 'Glow', keys: 'Warm keys', tape: 'Tape beat', late: 'Late night', trio: 'Night trio', garage: 'Whisper garage', afro: 'Afro glow' };
  // How loud each piece sits, so they all match Glow (measured: scripts/audio-levels.mjs)
  const TRIM = { glow: 1, keys: 0.92, tape: 0.8, late: 0.82, trio: 0.98, garage: 0.98, afro: 0.98 };

  function Engine(ctx, dest, seed, opts) {
    opts = opts || {};
    const S = (label) => stream(seed, label);
    const prog = S('programme');
    let tone = opts.tone || 0;      // −1 warm theme … +1 cool theme
    const bright = () => 1 + 0.05 * tone;
    const held = new Set();          // long-running sources, stopped when the engine goes
    const stats = { lead: 0, bass: 0, chord: 0, drum: 0 }; // notes played, per player (for checks)

    // ---- Small helpers --------------------------------------------------------
    function gain(value) { const g = ctx.createGain(); g.gain.value = value; return g; }
    function osc(type, freq) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
    function filter(type, freq, q) {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      return f;
    }
    // Stereo placement; very old Safari has no StereoPanner, so just pass through.
    function panner(v) {
      if (!ctx.createStereoPanner) return gain(1);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, v));
      return p;
    }
    // Glide a parameter from wherever it is now to a new value (no clicks).
    function glide(param, value, seconds) {
      const now = ctx.currentTime;
      const current = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
      param.linearRampToValueAtTime(value, now + seconds);
    }
    // A soft swell: fade up, hold, then fade away. Returns when it's silent.
    function envelope(g, t, peak, attack, hold, release) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + hold);
      g.gain.setTargetAtTime(0, t + hold, release / 5);
      return t + hold + release + 0.5;
    }
    // When a sound finishes, unplug all its nodes so nothing piles up over hours.
    // (links: [from, toParam] connections from shared wobblers into this sound's params)
    function disposeWhenDone(source, nodes, links) {
      source.onended = () => {
        for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
        if (links) for (const [from, to] of links) { try { from.disconnect(to); } catch (e) { /* already gone */ } }
      };
    }

    // ---- Reverb: a procedural "big room" impulse response -----------------------
    // Stereo noise that decays over several seconds and gets darker as it fades.
    function makeImpulse(seconds, r) {
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = ctx.createBuffer(2, len, rate);
      const dark = rr(r, 0.65, 0.85);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let smooth = 0;
        for (let i = 0; i < len; i++) {
          const t = i / rate;
          const k = 0.9 - dark * (i / len);                 // brightness falls over time
          smooth += k * ((r() * 2 - 1) - smooth);
          const fadeIn = Math.min(1, i / (rate * 0.01));    // no sharp start
          d[i] = smooth * Math.exp(-6.9 * t / seconds) * (1 - i / len) * fadeIn;
        }
      }
      return buf;
    }

    // Looping noise beds (white, pink or brown), made once, seamless where they loop
    const noiseCache = {};
    function loopNoise(kind) {
      if (noiseCache[kind]) return noiseCache[kind];
      const rate = ctx.sampleRate, len = Math.floor(rate * 6), fade = Math.floor(rate * 0.5);
      const buf = ctx.createBuffer(2, len, rate);
      const r = S('noise:' + kind);
      for (let ch = 0; ch < 2; ch++) {
        const g = new Float32Array(len + fade);
        let b0 = 0, b1 = 0, b2 = 0, br = 0, peak = 1e-9;
        for (let i = 0; i < g.length; i++) {
          const x = r() * 2 - 1;
          if (kind === 'pink') {
            b0 = 0.99765 * b0 + x * 0.099046; b1 = 0.963 * b1 + x * 0.2965164; b2 = 0.57 * b2 + x * 1.0526913;
            g[i] = b0 + b1 + b2 + x * 0.1848;
          } else if (kind === 'brown') {
            br = (br + 0.02 * x) / 1.02; g[i] = br;
          } else g[i] = x;
        }
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          d[i] = i < fade ? g[i] * Math.sqrt(i / fade) + g[len + i] * Math.sqrt(1 - i / fade) : g[i];
          peak = Math.max(peak, Math.abs(d[i]));
        }
        for (let i = 0; i < len; i++) d[i] /= peak;
      }
      noiseCache[kind] = buf;
      return buf;
    }
    function noiseSource(kind, r) {
      const s = ctx.createBufferSource();
      s.buffer = loopNoise(kind);
      s.loop = true;
      s.loopStart = 0; s.loopEnd = s.buffer.duration;
      s.playbackRate.value = r ? rr(r, 0.97, 1.03) : 1;
      return s;
    }

    // ---- The mixing desk (once per engine) ---------------------------------------------
    // Master: gentle compressor, a soft top end like an old tape, then the engine's fader.
    const fader = gain(opts.instant ? 1 : 0);
    fader.connect(dest);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.05; comp.release.value = 0.6;
    // (a record's mix, not a game's: the low end lifted, a clearer top, a drier room)
    const warmBase = rr(prog, 8800, 10400);
    const warm = filter('lowpass', warmBase * (1 + 0.07 * tone), 0.3);
    // (and a trim after the compressor: the fuller mix sits as quietly as the old one did)
    const trim = gain(0.42);
    comp.connect(warm).connect(trim).connect(fader);
    const weight = ctx.createBiquadFilter();
    weight.type = 'lowshelf'; weight.frequency.value = 130; weight.gain.value = 5;
    weight.connect(comp);
    // Reverb send/return: its size is part of the seed.
    const reverbIn = gain(1);
    const verb = ctx.createConvolver();
    const roomSize = rr(prog, 4.6, 7.2);
    verb.buffer = makeImpulse(roomSize, S('room'));
    const verbOut = gain(0.55);
    reverbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(weight);
    // Two soft, darkened echoes (one for the piece playing, one for the piece coming in), each
    // piece setting its own echo time while its line is quiet.
    const lines = [0, 1].map(() => {
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.52;                 // roughly a dotted eighth
      const echoTone = filter('lowpass', 2200, 0.3);
      const back = gain(0.35);
      const echoOut = gain(0.3);
      delay.connect(echoTone).connect(back).connect(delay); // feedback loop
      echoTone.connect(echoOut);
      echoOut.connect(weight);
      echoOut.connect(reverbIn);
      return { input: delay, back, echoTone };
    });

    // ---- Pieces: each one plays for a few minutes, then crossfades into the next ----------
    let index = 0;
    let pieces = [];
    let switchAt = Infinity;
    let fadeNext = 0.05;
    let last = null;
    const order = [];
    const history = [];
    function nextName() {
      if (opts.piece) return opts.piece;
      if (!order.length) {
        const names = Object.keys(BUILD);
        for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(prog() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
        if (names[0] === last) names.push(names.shift());
        order.push(...names);
      }
      return order.shift();
    }
    const equalPower = (up, level) => {
      const c = new Float32Array(33);
      for (let i = 0; i < 33; i++) { const x = i / 32; c[i] = level * (up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2)); }
      return c;
    };
    function begin(t, fadeIn) {
      const name = nextName();
      last = name;
      const len = opts.piece ? Infinity : (opts.pieceSeconds || rr(prog, 240, 480));
      const fadeOut = opts.fadeSeconds || rr(prog, 16, 26);
      const end = t + len + fadeOut;
      const i = index++;
      const r = (label) => S('p' + i + ':' + name + ':' + label);
      const line = lines[i % 2];
      const trim = TRIM[name] || 1;
      const p = { id: name, name: PIECE_NAMES[name], i, t0: t, end, fadeAt: end - fadeOut, r, line, schedule: () => {} };
      p.ins = [gain(0), gain(0), gain(0)];
      p.ins[0].connect(weight); p.ins[1].connect(reverbIn); p.ins[2].connect(line.input);
      for (const g of p.ins) {
        g.gain.setValueCurveAtTime(equalPower(true, trim), t, Math.max(0.05, fadeIn));
        if (isFinite(end)) g.gain.setValueCurveAtTime(equalPower(false, trim), end - fadeOut, fadeOut);
      }
      // A piece's echo: its own time and feedback, set while its line is quiet
      line.input.delayTime.setValueAtTime(rr(r('echo'), 0.38, 0.7), t);
      line.back.gain.setValueAtTime(rr(r('echo'), 0.28, 0.4), t);
      // A bus into the piece's dry, reverb and echo sends
      p.layer = (dry, wet, echo) => {
        const g = gain(1);
        if (dry) g.connect(gain(dry)).connect(p.ins[0]);
        if (wet) g.connect(gain(wet)).connect(p.ins[1]);
        if (echo) g.connect(gain(echo)).connect(p.ins[2]);
        return g;
      };
      // Events may still begin a little way into the fade-out
      p.alive = (at) => at < end - fadeOut * 0.6;
      // Keep a source going for the whole piece
      p.hold = (src) => {
        held.add(src);
        src.start(t);
        if (isFinite(end)) src.stop(end + 0.5);
        src.onended = () => { held.delete(src); try { src.disconnect(); } catch (e) { /* gone */ } };
        return src;
      };
      BUILD[name](p);
      pieces.push(p);
      history.push({ id: name, at: t });
      switchAt = t + len;
      fadeNext = fadeOut;
      return p;
    }

    // ================= The band: every piece is a small studio band on a gentle pulse =================
    // Each piece is a groove (68–86 bpm, chosen by the seed) with four players:
    //   chords  rich 7th and 9th chords (a Rhodes-like piano, warm pads or soft plucks) changing every
    //           bar or two, in soulful progressions, voiced so they move smoothly
    //   bass    a warm, round bass line that follows the chords: roots, fifths, octaves, a little
    //           syncopation and a passing note leading into each next chord (never a drone)
    //   lead    a melody made of short motifs (two bars) that come back with small changes and are
    //           answered, with rests in between, in a soft voice (vibraphone, Rhodes, breathy flute,
    //           a hummed "mm", a muted synth)
    //   drums   very quiet lo-fi percussion (a soft kick, a rim, a brush, a shaker), swung, often
    //           resting; never in the breakdowns
    // The music develops in sections: a short intro, then A and B (two progressions, each with its
    // own motif) and now and then a breakdown (pads, long bass notes, a lone phrase).

    // Progressions as scale steps (0 = the key's home chord), four chords each
    const PROGS = {
      bright: [[3, 2, 5, 5], [0, 5, 1, 4], [1, 4, 0, 0], [0, 3, 5, 4], [3, 4, 2, 5], [5, 3, 0, 4], [0, 2, 3, 4], [3, 0, 1, 4]],
      dark: [[0, 3, 0, 4], [0, 6, 5, 4], [0, 5, 3, 4], [3, 4, 0, 0], [5, 6, 0, 0], [0, 2, 3, 6], [0, 3, 6, 2]]
    };
    // Melody rhythms: [beat, length in beats] across two bars (8 beats), with room to breathe
    const RHYTHMS = [
      [[0, 1], [1, 0.5], [1.5, 1.5], [4, 1], [5, 2]],
      [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 1.5], [4.5, 0.5], [5, 2.5]],
      [[0, 1.5], [1.5, 0.5], [2, 2], [4, 0.5], [4.5, 0.5], [5, 1], [6, 1.5]],
      [[1, 0.5], [1.5, 0.5], [2, 1], [3, 2], [6, 0.5], [6.5, 1]],
      [[0, 2], [2, 1], [3, 3], [6, 1.5]],
      [[0.5, 1], [1.5, 0.5], [2, 1.5], [4, 1], [5, 0.5], [5.5, 2]]
    ];
    // Which two-bar slots of a section have a phrase: c the motif (the call), c2 the motif with a new
    // ending, a the answer (turned the other way, coming home), - a rest
    const SLOTS = {
      intro: [['-', '-']],
      A: [['c', '-', 'c2', 'a'], ['c', 'a', 'c', 'a'], ['-', 'c', '-', 'a'], ['c', '-', 'a', '-'], ['c', 'c2', 'a', '-']],
      B: [['c', 'a', 'c2', 'a'], ['-', 'c', 'c2', 'a'], ['c', '-', 'c2', 'a']],
      break: [['-', 'c'], ['c', '-'], ['-', 'a']]
    };
    // Bass lines, one bar each: [beat, what, length in beats]. R root, 5 fifth, 3 third, 8 octave,
    // A a passing note into the next chord's root
    const BASS = {
      glow: [[[0, 'R', 2.5], [2.5, '5', 1], [3.5, 'A', 0.5]], [[0, 'R', 1.5], [2, '8', 1], [3, '5', 1]], [[0, 'R', 3], [3, 'A', 1]]],
      neo: [[[0, 'R', 1.5], [1.5, 'R', 0.5], [2.5, '5', 1], [3.5, 'A', 0.5]], [[0, 'R', 1], [1.5, '8', 0.5], [2, '5', 1.5], [3.5, 'A', 0.5]], [[0, 'R', 2], [2.5, '3', 0.5], [3, '5', 1]]],
      lofi: [[[0, 'R', 1], [1.5, 'R', 1], [3, '5', 0.5], [3.5, 'A', 0.5]], [[0, 'R', 1.5], [2, '5', 1], [3.5, 'A', 0.5]], [[0, 'R', 0.5], [0.5, 'R', 1], [2.5, '8', 0.5], [3, '5', 1]]],
      rnb: [[[0, 'R', 2.5], [2.75, '5', 0.75], [3.5, 'A', 0.5]], [[0, 'R', 1.75], [2, '3', 1], [3, '5', 1]], [[0, 'R', 3.25], [3.5, 'A', 0.5]]],
      walk: [[[0, 'R', 1], [1, '3', 1], [2, '5', 1], [3, 'A', 1]], [[0, 'R', 1], [1, '5', 1], [2, '8', 1], [3, 'A', 1]], [[0, 'R', 1], [1, 'R', 1], [2, '3', 1], [3, 'A', 1]]],
      garage: [[[0, 'R', 0.75], [1.5, 'R', 0.5], [2.75, '5', 0.5], [3.5, 'A', 0.5]], [[0, 'R', 1], [1.75, '8', 0.25], [2.5, '5', 0.75], [3.5, 'A', 0.5]]],
      afro: [[[0, 'R', 1], [1.5, '5', 0.5], [2, '8', 0.5], [3, 'R', 0.5], [3.5, 'A', 0.5]], [[0, 'R', 0.75], [0.75, 'R', 0.75], [2, '5', 1], [3.5, 'A', 0.5]]]
    };
    // How the chords are played in a bar: [beat, length in beats] (len 'bar': the whole chord)
    const COMP = {
      glow: [[[0, 'bar']]],
      neo: [[[0, 1.75], [2.5, 0.5], [3.5, 0.5]], [[0, 1.5], [1.5, 2]], [[0, 2.5], [3.5, 0.5]]],
      lofi: [[[0, 2], [2.5, 1]], [[0, 1], [1.5, 2.5]], [[0, 1.5], [3, 1]]],
      soft: [[[0, 'bar']], [[0, 2], [2.5, 1.5]]],
      jazz: [[[0, 1], [1.5, 1]], [[0, 0.5], [2.5, 1.5]], [[1.5, 1], [3, 1]]],
      stab: [[[0.5, 0.25], [2.75, 0.25]], [[0.75, 0.25], [1.5, 0.25], [3.25, 0.25]]],
      pluck: [[[0.5, 0.25], [1.5, 0.25], [2.75, 0.25], [3.5, 0.25]], [[0.75, 0.25], [1.75, 0.25], [2.5, 0.25], [3.25, 0.25]]]
    };
    // Drum kits, in sixteenths of a bar (0–15)
    const KITS = {
      glow: { kick: [0], rim: [12], shaker: [] },
      neo: { kick: [0, 7, 8], rim: [4, 12], shaker: [2, 6, 10, 14] },
      lofi: { kick: [0, 8, 11], rim: [4, 12], shaker: [0, 2, 4, 6, 8, 10, 12, 14] },
      rnb: { kick: [0, 9], rim: [12], shaker: [6, 14] },
      brush: { kick: [0, 8], brush: [0, 4, 8, 12], rim: [12] },
      garage: { kick: [0, 10], rim: [4, 12], shaker: [2, 6, 10, 14, 15] },
      afro: { kick: [0, 6, 8], rim: [3, 10, 14], shaker: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
    };
    // The pieces
    const BANDS = {
      glow: { modes: ['lydian', 'ionian', 'lydian'], bpm: [68, 74], swing: [0.5, 0.55], chordBars: [2], comp: 'glow', keysStyle: 'open', pad: true, bass: 'glow', lead: 'vibes', drums: 0.3, kit: 'glow', extras: ['stars', 'air'] },
      keys: { modes: ['ionian', 'dorian', 'lydian', 'mixolydian'], bpm: [72, 82], swing: [0.54, 0.6], chordBars: [1, 2], comp: 'neo', keysStyle: 'close', bass: 'neo', lead: 'rhodes', drums: 0.75, kit: 'neo' },
      tape: { modes: ['dorian', 'aeolian', 'ionian'], bpm: [70, 80], swing: [0.58, 0.64], chordBars: [1], comp: 'lofi', keysStyle: 'shell', wobble: true, bass: 'lofi', lead: 'flute', drums: 0.9, kit: 'lofi', extras: ['hiss'] },
      late: { modes: ['aeolian', 'dorian'], bpm: [68, 74], swing: [0.52, 0.58], chordBars: [2], comp: 'soft', keysStyle: 'eleven', pad: true, bass: 'rnb', lead: 'hum', drums: 0.6, kit: 'rnb', extras: ['rain'] },
      trio: { modes: ['dorian', 'ionian', 'mixolydian'], bpm: [76, 86], swing: [0.6, 0.66], chordBars: [1], comp: 'jazz', keysStyle: 'shell', bass: 'walk', lead: 'vibes', drums: 0.85, kit: 'brush' },
      garage: { modes: ['aeolian', 'dorian'], bpm: [68, 72], grid16: true, swing: [0.56, 0.62], chordBars: [2], comp: 'stab', keysStyle: 'close', pad: true, bass: 'garage', lead: 'muted', drums: 0.85, kit: 'garage' },
      afro: { modes: ['ionian', 'mixolydian', 'dorian'], bpm: [80, 86], grid16: true, swing: [0.52, 0.56], chordBars: [1, 2], comp: 'pluck', keysStyle: 'close', pad: true, bass: 'afro', lead: 'flute', drums: 0.85, kit: 'afro' }
    };

    // ---- The instruments (shared by every piece) ------------------------------------------
    // One short burst of noise, made once, for the drums and breaths (each hit starts somewhere else in it)
    let burst = null;
    function noiseBurst() {
      if (burst) return burst;
      const rate = ctx.sampleRate, len = Math.floor(rate * 2);
      burst = ctx.createBuffer(1, len, rate);
      const d = burst.getChannelData(0), r = S('burst');
      for (let i = 0; i < len; i++) d[i] = r() * 2 - 1;
      return burst;
    }
    function noiseHit(r) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBurst();
      return { src: s, offset: rr(r, 0, 1.5) };
    }

    // A soft electric piano (Rhodes-like FM: a sine tine that mellows as it rings). wobble: an old
    // tape's slow waver.
    function rhodes(bus, midi, t, len, level, pan, wobble) {
      stats.chord++;
      const f = mtof(midi);
      const place = panner(pan);
      place.connect(bus);
      const amp = gain(0);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.01);
      amp.gain.setTargetAtTime(level * 0.55, t + 0.02, 0.6);
      amp.gain.setTargetAtTime(0, t + Math.max(0.08, len), 0.18);
      amp.connect(place);
      const carrier = osc('sine', f), mod = osc('sine', f), depth = gain(0);
      depth.gain.setValueAtTime(f * 0.9, t);
      depth.gain.setTargetAtTime(f * 0.06, t, 0.3);
      mod.connect(depth).connect(carrier.frequency);
      const trem = osc('sine', 4.5), tremAmt = gain(level * 0.18);
      trem.connect(tremAmt).connect(amp.gain);
      const nodes = [carrier, mod, depth, trem, tremAmt, amp, place];
      if (wobble) {
        const w = osc('sine', 0.55), wAmt = gain(7);
        w.connect(wAmt).connect(carrier.detune);
        w.start(t); w.stop(t + len + 1.6);
        nodes.push(w, wAmt);
      }
      carrier.connect(amp);
      const end = t + Math.max(0.08, len) + 1.5;
      for (const o of [carrier, mod, trem]) { o.start(t); o.stop(end); }
      disposeWhenDone(carrier, nodes);
    }
    // A warm pad: two detuned saws, softly filtered, with a pure sine under them
    function pad(bus, midi, t, len, level, pan, r) {
      stats.chord++;
      const f = mtof(midi);
      const out = gain(0), place = panner(pan);
      out.connect(place).connect(bus);
      const lp = filter('lowpass', rr(r, 800, 1200) * bright(), 0.4);
      lp.connect(out);
      const a = osc('sawtooth', f), b = osc('sawtooth', f), s = osc('sine', f), sAmt = gain(0.8);
      a.detune.value = rr(r, -9, -5); b.detune.value = rr(r, 5, 9);
      a.connect(lp); b.connect(lp); s.connect(sAmt).connect(out);
      const end = envelope(out, t, level, rr(r, 0.8, 1.4), len, 1.6);
      for (const o of [a, b, s]) { o.start(t); o.stop(end); }
      disposeWhenDone(a, [a, b, s, sAmt, lp, out, place]);
    }
    // A soft muted pluck (like a nylon guitar played with the thumb)
    function pluck(bus, midi, t, level, pan) {
      stats.chord++;
      const f = mtof(midi);
      const place = panner(pan), amp = gain(0), lp = filter('lowpass', 1500 * bright(), 0.5);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.01, 0.12);
      const a = osc('triangle', f), b = osc('sine', f * 2), bAmt = gain(0.25);
      a.connect(lp); b.connect(bAmt).connect(lp);
      lp.connect(amp).connect(place).connect(bus);
      const end = t + 1;
      a.start(t); b.start(t); a.stop(end); b.stop(end);
      disposeWhenDone(a, [a, b, bAmt, lp, amp, place]);
    }
    // The bass: a round sine, a soft filtered triangle for body and its octave so laptop speakers
    // hear it; a gentle attack, a little sustain, and a soft let-go
    function bassNote(bus, midi, t, len, level) {
      stats.bass++;
      const f = mtof(midi);
      const amp = gain(0), lp = filter('lowpass', 640 * bright(), 0.8);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.018);
      amp.gain.setTargetAtTime(level * 0.7, t + 0.03, 0.35);
      amp.gain.setTargetAtTime(0, t + Math.max(0.1, len), 0.07);
      const sub = osc('sine', f), body = osc('sawtooth', f), bodyAmt = gain(0.32), up = osc('sine', f * 2), upAmt = gain(0.14);
      // (the weight you feel: a sine an octave down, when that's still a note and not a rumble)
      const deep = osc('sine', f >= 62 ? f / 2 : f), deepAmt = gain(f >= 62 ? 0.55 : 0.2);
      sub.connect(amp);
      deep.connect(deepAmt).connect(amp);
      body.connect(bodyAmt).connect(lp);
      up.connect(upAmt).connect(lp);
      lp.connect(amp);
      amp.connect(bus);
      const end = t + Math.max(0.1, len) + 0.6;
      for (const o of [sub, body, up, deep]) { o.start(t); o.stop(end); }
      disposeWhenDone(sub, [sub, body, bodyAmt, up, upAmt, deep, deepAmt, lp, amp]);
    }
    // The lead voices
    function lead(kind, bus, midi, t, len, level, pan, r) {
      if (kind === 'rhodes') {
        // The piano itself plays the tune (a little brighter, in the middle)
        rhodes(bus, midi, t, len, level, pan, false);
        stats.chord--; stats.lead++;
        return;
      }
      stats.lead++;
      const f = mtof(midi);
      const place = panner(pan);
      place.connect(bus);
      const amp = gain(0);
      amp.connect(place);
      const nodes = [amp, place];
      const srcs = [];
      let end;
      if (kind === 'vibes') {
        // A vibraphone: a pure bar, a quieter fourth partial that fades fast, a slow shimmer
        const a = osc('sine', f), b = osc('sine', f * 4), bAmt = gain(0);
        bAmt.gain.setValueAtTime(level * 0.12, t);
        bAmt.gain.setTargetAtTime(0, t, 0.08);
        a.connect(amp); b.connect(bAmt).connect(amp);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.006);
        amp.gain.setTargetAtTime(0, t + 0.01, Math.min(1.4, 0.45 + len * 0.4));
        const trem = osc('sine', 5.2), tremAmt = gain(level * 0.22);
        trem.connect(tremAmt).connect(amp.gain);
        end = t + 4;
        srcs.push(a, b, trem); nodes.push(bAmt, tremAmt);
      } else if (kind === 'flute') {
        // A breathy flute: a sine with a little triangle, a gentle swell, vibrato that comes in late,
        // and a soft breath of air at the start
        const a = osc('sine', f), b = osc('triangle', f), bAmt = gain(0.22), lp = filter('lowpass', 2200 * bright(), 0.4);
        a.connect(amp); b.connect(bAmt).connect(lp).connect(amp);
        const vib = osc('sine', rr(r, 4.6, 5.4)), vibAmt = gain(0);
        vibAmt.gain.setValueAtTime(0, t);
        vibAmt.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(0.8, len));
        vib.connect(vibAmt); vibAmt.connect(a.frequency); vibAmt.connect(b.frequency);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.07);
        amp.gain.setTargetAtTime(level * 0.8, t + 0.08, 0.4);
        amp.gain.setTargetAtTime(0, t + len, 0.09);
        const { src, offset } = noiseHit(r), bp = filter('bandpass', f * 2, 1.4), breath = gain(0);
        breath.gain.setValueAtTime(0, t);
        breath.gain.linearRampToValueAtTime(level * 0.35, t + 0.03);
        breath.gain.setTargetAtTime(0, t + 0.05, 0.08);
        src.connect(bp).connect(breath).connect(amp);
        src.start(t, offset, 0.6);
        end = t + len + 0.8;
        srcs.push(a, b, vib); nodes.push(bAmt, lp, vibAmt, src, bp, breath);
      } else if (kind === 'hum') {
        // A hummed "mm": a soft saw through two vowel-like bands, a slow swell and a little vibrato
        const a = osc('sawtooth', f), f1 = filter('bandpass', 380, 3), f2 = filter('bandpass', 950, 4), f2Amt = gain(0.4), lp = filter('lowpass', 1600, 0.3);
        a.connect(f1).connect(lp); a.connect(f2).connect(f2Amt).connect(lp);
        const s = osc('sine', f), sAmt = gain(0.5);
        s.connect(sAmt).connect(amp);
        lp.connect(amp);
        const vib = osc('sine', rr(r, 4.2, 5)), vibAmt = gain(f * 0.005);
        vib.connect(vibAmt); vibAmt.connect(a.frequency); vibAmt.connect(s.frequency);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.14);
        amp.gain.setTargetAtTime(0, t + len, 0.14);
        end = t + len + 1;
        srcs.push(a, s, vib); nodes.push(f1, f2, f2Amt, lp, sAmt, vibAmt);
      } else {
        // muted: a soft synth lead, rounded off, with a little glide into each note
        const a = osc('triangle', f), b = osc('sine', f), lp = filter('lowpass', 1300 * bright(), 0.6);
        a.frequency.setValueAtTime(f * 0.985, t);
        a.frequency.exponentialRampToValueAtTime(f, t + 0.06);
        a.connect(lp).connect(amp); b.connect(amp);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.025);
        amp.gain.setTargetAtTime(level * 0.6, t + 0.03, 0.3);
        amp.gain.setTargetAtTime(0, t + len, 0.1);
        end = t + len + 0.8;
        srcs.push(a, b); nodes.push(lp);
      }
      for (const o of srcs) { o.start(t); o.stop(end); }
      disposeWhenDone(srcs[0], [...srcs, ...nodes]);
    }
    // The drums: all soft, warm and low
    function kick(bus, t, level) {
      stats.drum++;
      const o = osc('sine', 125), amp = gain(0), lp = filter('lowpass', 200, 0.5);
      o.frequency.setValueAtTime(125, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.14);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.02, 0.15);
      o.connect(lp).connect(amp).connect(bus);
      // (the beater: a very short, soft click so the kick is heard on small speakers too)
      const click = osc('triangle', 1700), clickAmp = gain(0);
      clickAmp.gain.setValueAtTime(0, t);
      clickAmp.gain.linearRampToValueAtTime(level * 0.12, t + 0.001);
      clickAmp.gain.setTargetAtTime(0, t + 0.002, 0.006);
      click.connect(clickAmp).connect(bus);
      o.start(t); o.stop(t + 0.9);
      click.start(t); click.stop(t + 0.06);
      disposeWhenDone(o, [o, lp, amp, click, clickAmp]);
    }
    function noiseDrum(bus, t, level, pan, r, o) {
      stats.drum++;
      const { src, offset } = noiseHit(r);
      const f = filter(o.type, o.freq, o.q), lp = filter('lowpass', o.top || 5200, 0.3), amp = gain(0), place = panner(pan);
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(level, t + o.attack);
      amp.gain.setTargetAtTime(0, t + o.attack + 0.002, o.decay);
      src.connect(f).connect(lp).connect(amp).connect(place).connect(bus);
      src.start(t, offset, o.decay * 8 + 0.05);
      disposeWhenDone(src, [src, f, lp, amp, place]);
    }
    const rim = (bus, t, level, pan, r) => noiseDrum(bus, t, level, pan, r, { type: 'bandpass', freq: 1300, q: 1.6, attack: 0.002, decay: 0.035, top: 3200 });
    const shaker = (bus, t, level, pan, r) => noiseDrum(bus, t, level, pan, r, { type: 'highpass', freq: 2600, q: 0.5, attack: 0.008, decay: 0.035, top: 6000 });
    const brushHit = (bus, t, level, pan, r) => noiseDrum(bus, t, level, pan, r, { type: 'bandpass', freq: 1900, q: 0.6, attack: 0.03, decay: 0.12, top: 4500 });

    // ---- Textures for some pieces ---------------------------------------------------------
    function stars(p, key, bus, r) {
      // High notes of the key's pentatonic, now and then, like little stars
      const tonic = tonicNear(key, 76);
      const notes = [0, 1, 2, 4, 5, 7, 8, 9].map((n) => tonic + semi(key, n)).filter((m) => m >= 72 && m <= 90);
      let next = p.t0 + rr(r, 3, 6);
      return (now, horizon) => {
        if (next < now - 0.5) next = now + rr(r, 1, 3);
        while (next < horizon && p.alive(next)) {
          const f = mtof(pk(r, notes)), place = panner(rr(r, -0.7, 0.7)), body = gain(0);
          body.gain.setValueAtTime(0, next);
          body.gain.linearRampToValueAtTime(0.014, next + 0.01);
          body.gain.setTargetAtTime(0, next + 0.012, rr(r, 0.6, 1.1));
          const a = osc('sine', f);
          a.connect(body).connect(place).connect(bus);
          a.start(next); a.stop(next + 6);
          disposeWhenDone(a, [a, body, place]);
          next += rr(r, 5, 12);
        }
      };
    }
    function bed(p, kind, bus, r) {
      // air: a far ocean of air; hiss: an old tape's hiss; rain: soft rain on the window
      const src = noiseSource(kind === 'air' ? 'white' : 'pink', r);
      const hp = filter('highpass', kind === 'rain' ? 500 : kind === 'hiss' ? 1800 : 120, 0.3);
      const lp = filter('lowpass', kind === 'rain' ? 2600 : kind === 'hiss' ? 5200 : 550, 0.3);
      const level = gain(kind === 'rain' ? 0.009 : kind === 'hiss' ? 0.0028 : 0.01);
      const swell = osc('sine', rr(r, 0.03, 0.06)), swellAmt = gain(kind === 'hiss' ? 0.0006 : 0.004);
      swell.connect(swellAmt).connect(level.gain);
      src.connect(hp).connect(lp).connect(level).connect(bus);
      p.hold(src); p.hold(swell);
    }

    // ---- A piece: the band plays ------------------------------------------------------------
    function band(p) {
      const cfg = BANDS[p.id];
      const r = p.r('groove'), rh = p.r('harmony'), rm = p.r('melody'), rb = p.r('bass'), rd = p.r('drums'), rv = p.r('voices'), rf = p.r('form');
      const key = makeKey(rh, cfg.modes);
      const minorish = quality(key, 0) === 'min';
      const fix = (d) => (quality(key, d) === 'dim' ? (d + 2) % 7 : d);
      const bpm = rr(r, cfg.bpm[0], cfg.bpm[1]);
      const beat = 60 / bpm;
      const swing = rr(r, cfg.swing[0], cfg.swing[1]);
      // A beat position (0, 0.5, 2.75...) in a bar starting at t0, swung
      const at = (t0, pos) => {
        const whole = Math.floor(pos + 1e-9), f = pos - whole;
        let g = f;
        if (cfg.grid16) { if (Math.abs(f - 0.25) < 1e-6) g = 0.5 * swing; else if (Math.abs(f - 0.75) < 1e-6) g = 0.5 + 0.5 * swing; }
        else if (Math.abs(f - 0.5) < 1e-6) g = swing;
        return t0 + (whole + g) * beat;
      };
      const loose = () => rr(rv, -0.007, 0.007);
      // The echo follows the beat (a dotted eighth)
      if (p.line) p.line.input.delayTime.setValueAtTime(Math.min(1.9, beat * 0.75), p.t0);

      const chordBus = p.layer(0.6, 0.5, 0.12);
      const padBus = p.layer(0.4, 0.9, 0);
      const bassBus = p.layer(1, 0.08, 0);
      const leadBus = p.layer(0.55, 0.6, 0.35);
      const drumBus = p.layer(0.9, 0.12, 0);
      const fxBus = p.layer(0.6, 0.8, 0.4);
      const chordTone = filter('lowpass', rr(r, 2100, 2800) * bright(), 0.4);
      chordTone.connect(chordBus);

      // Progressions: A and B, different
      const family = minorish ? PROGS.dark : PROGS.bright;
      const progA = pk(rh, family).map(fix);
      let progB = pk(rh, family).map(fix);
      for (let i = 0; i < 6 && progB.join() === progA.join(); i++) progB = pk(rh, family).map(fix);
      const chordBars = pk(r, cfg.chordBars);

      // The form
      let section = null, sectionBar = 0;
      const kinds = [];
      const motifs = {};
      function makeMotif() {
        const rhythm = pk(rm, RHYTHMS);
        const steps = rhythm.slice(1).map(() => weighted(rm, [-2, -1, 1, 2, 0], [0.12, 0.36, 0.34, 0.1, 0.08]));
        return { rhythm, steps };
      }
      function newSection() {
        const prev = section ? section.kind : null;
        let kind;
        if (!prev) kind = 'intro';
        else if (prev === 'intro' || prev === 'break') kind = 'A';
        else {
          const breakOk = !kinds.slice(-3).includes('break');
          kind = weighted(rf, ['A', 'B', 'break'], [prev === 'A' ? 0.7 : 1.4, prev === 'B' ? 0.25 : 1.3, breakOk ? 0.6 : 0]);
        }
        kinds.push(kind);
        const part = kind === 'B' ? 'B' : 'A';
        // The motif comes back each time (so it's remembered), freshened now and then
        if (!motifs[part] || (kind !== 'break' && rm() < 0.3)) motifs[part] = makeMotif();
        section = {
          kind,
          bars: kind === 'intro' ? 4 : kind === 'break' ? 4 : 8,
          prog: kind === 'B' ? progB : progA,
          drums: (kind === 'A' || kind === 'B') && rd() < cfg.drums,
          slots: pk(rm, SLOTS[kind]),
          motif: motifs[part]
        };
        sectionBar = 0;
      }
      const chordAt = (bar) => section.prog[Math.floor(bar / chordBars) % section.prog.length];

      // Melody: scale steps from the tonic near D4, kept in a warm range
      const melBase = tonicNear(key, 62);
      const melMidi = (ix) => melBase + semi(key, ix);
      const isTone = (ix, d, withSeventh) => { const k = (((ix - d) % 7) + 7) % 7; return k === 0 || k === 2 || k === 4 || (withSeventh && k === 6); };
      function nearestTone(ix, d, withSeventh) {
        for (const o of [0, -1, 1, -2, 2, -3, 3]) if (isTone(ix + o, d, withSeventh)) return ix + o;
        return ix;
      }
      function inRange(ix) {
        while (melMidi(ix) > (cfg.top || 79)) ix -= 7;
        while (melMidi(ix) < 62) ix += 7;
        return ix;
      }
      let melIx = 4 + Math.floor(rm() * 3);
      const leadLevel = cfg.lead === 'hum' ? 0.03 : cfg.lead === 'flute' ? 0.028 : cfg.lead === 'muted' ? 0.026 : cfg.lead === 'rhodes' ? 0.024 : 0.03;
      function phrase(variant, t0, d0, d1) {
        const m = section.motif;
        let steps = m.steps.slice();
        if (variant === 'a') steps = steps.map((s) => -s);
        if (variant === 'c2' && steps.length) steps[steps.length - 1] = steps[steps.length - 1] > 0 ? -1 : 2;
        const chordFor = (pos) => (pos < 4 ? d0 : d1);
        let ix = nearestTone(melIx, chordFor(m.rhythm[0][0]), false);
        const pan = rr(rv, -0.25, 0.25);
        m.rhythm.forEach(([pos, dur], i) => {
          if (i) ix += steps[i - 1];
          const strong = Math.abs(pos - Math.round(pos)) < 1e-6 && Math.round(pos) % 2 === 0;
          const last = i === m.rhythm.length - 1;
          if (strong) ix = nearestTone(ix, chordFor(pos), true);
          if (last) ix = variant === 'a' ? nearestTone(ix, 0, false) : nearestTone(ix, chordFor(pos), false);
          ix = inRange(ix);
          const t = at(t0, pos) + loose();
          if (p.alive(t)) lead(cfg.lead, leadBus, melMidi(ix), t, dur * beat * 0.92, leadLevel * rr(rv, 0.85, 1.05), pan, rv);
        });
        melIx = ix;
      }

      // Chords, bass and drums for one bar
      let prevVoicing = null, prevDeg = null;
      let voicing = null;
      function chordsBar(t0, d, changed, barsLeft) {
        if (changed || !voicing) { voicing = voice(key, d, cfg.keysStyle, 61, prevVoicing); prevVoicing = voicing; }
        const pattern = section.kind === 'break' || section.kind === 'intro' ? [[0, 'bar']] : pk(rv, COMP[cfg.comp]);
        const comp = cfg.comp === 'stab' || cfg.comp === 'pluck' ? (section.kind === 'break' || section.kind === 'intro' ? null : 'pluck') : 'keys';
        if (comp) {
          for (const [pos, len] of pattern) {
            if (len === 'bar' && !changed) continue;
            const hold = len === 'bar' ? beat * 4 * barsLeft - 0.1 : len * beat * 0.95;
            const t = at(t0, pos) + loose();
            if (!p.alive(t)) continue;
            voicing.forEach((m, i) => {
              const pan = (i / Math.max(1, voicing.length - 1) - 0.5) * 0.8;
              const roll = comp === 'keys' && pos === 0 ? i * rr(rv, 0.008, 0.025) : 0;
              if (comp === 'pluck') pluck(chordTone, m, t + roll, 0.011, pan);
              else rhodes(chordTone, m, t + roll, hold, len === 'bar' ? 0.011 : 0.013, pan, cfg.wobble);
            });
          }
        }
        // Pads under it all, at each change (and in breakdowns, for every piece)
        if ((cfg.pad || section.kind === 'break') && changed) {
          const notes = voice(key, d, 'open', 57, null);
          notes.forEach((m, i) => pad(padBus, m, t0 + rr(rv, 0, 0.3), beat * 4 * barsLeft - 0.4, cfg.pad ? 0.0085 : 0.006, (i / Math.max(1, notes.length - 1) - 0.5) * 1, rv));
        }
      }
      function bassBar(t0, d, next) {
        if (section.kind === 'intro' && sectionBar < 2) return;
        const lo = 33;
        const root = bassOf(key, d, lo);
        const pattern = section.kind === 'break' ? [[0, 'R', 3.5]] : pk(rb, BASS[cfg.bass]);
        const interval = (k) => semi(key, d + k) - semi(key, d);
        pattern.forEach(([pos, what, len]) => {
          let m = root;
          if (what === '5') m = root + interval(4);
          else if (what === '3') m = root + interval(2);
          else if (what === '8') m = root + 12;
          else if (what === 'A') {
            let nr = bassOf(key, next, lo);
            if (Math.abs(nr - root) > 6) nr += nr > root ? -12 : 12;
            const below = semi(key, next) - semi(key, next - 1), above = semi(key, next + 1) - semi(key, next);
            m = rb() < 0.25 ? nr + (rb() < 0.5 ? -1 : 1) : rb() < 0.55 ? nr - below : nr + above;
            if (next === d) m = root + interval(4);
          }
          while (m > 52) m -= 12;
          while (m < 31) m += 12;
          // Now and then a note is left out, so the line breathes
          if (pos > 0 && rb() < 0.1) return;
          const t = at(t0, pos) + loose();
          if (p.alive(t)) bassNote(bassBus, m, t, len * beat * 0.9, 0.075 * rr(rv, 0.9, 1.05));
        });
      }
      const kit = KITS[cfg.kit];
      function drumsBar(t0) {
        // (none while the piece fades out: the next one comes in gently, without them)
        if (!section.drums || t0 > p.fadeAt - 1) return;
        const step = (s) => at(t0, s / 4) + loose();
        for (const s of kit.kick || []) if (s === 0 || rd() > 0.06) kick(drumBus, step(s), s === 0 ? 0.075 : 0.055);
        for (const s of kit.rim || []) if (rd() > 0.08) rim(drumBus, step(s), 0.011 * rr(rd, 0.8, 1.1), 0.15, rd);
        for (const s of kit.brush || []) brushHit(drumBus, step(s), 0.0065 * rr(rd, 0.7, 1.1), -0.2, rd);
        for (const s of kit.shaker || []) if (rd() > 0.15) shaker(drumBus, step(s), (s % 2 ? 0.0028 : 0.0045) * rr(rd, 0.7, 1.1), 0.35, rd);
      }

      const extras = (cfg.extras || []).map((x) => (x === 'stars' ? stars(p, key, fxBus, p.r('stars')) : (bed(p, x, fxBus, p.r(x)), null))).filter(Boolean);

      let nextBar = p.t0 + 0.15;
      newSection();
      p.schedule = (now, horizon) => {
        if (nextBar < now - 0.5) nextBar = now + 0.15;
        for (const x of extras) x(now, horizon);
        while (nextBar < horizon && p.alive(nextBar)) {
          if (sectionBar >= section.bars) newSection();
          const t0 = nextBar;
          const d = chordAt(sectionBar);
          const changed = sectionBar % chordBars === 0 || d !== prevDeg;
          const barsLeft = changed ? Math.min(chordBars, section.bars - sectionBar) : 1;
          const nextD = sectionBar + 1 < section.bars ? chordAt(sectionBar + 1) : section.prog[0];
          chordsBar(t0, d, changed, barsLeft);
          bassBar(t0, d, nextD);
          drumsBar(t0);
          if (sectionBar % 2 === 0) {
            const slot = section.slots[Math.floor(sectionBar / 2)] || '-';
            if (slot !== '-') phrase(slot, t0, d, sectionBar + 1 < section.bars ? chordAt(sectionBar + 1) : d);
          }
          prevDeg = d;
          sectionBar++;
          nextBar += beat * 4;
        }
      };
    }

    const BUILD = Object.fromEntries(Object.keys(BANDS).map((id) => [id, band]));

    // ---- Lookahead scheduling ----------------------------------------------------------
    function tick(now, ahead) {
      const horizon = now + ahead;
      if (!pieces.length && switchAt === Infinity) begin(now + 0.1, 0.05);
      while (switchAt < horizon) begin(switchAt, fadeNext);
      for (const p of pieces) if (p.t0 < horizon) p.schedule(now, horizon);
      pieces = pieces.filter((p) => {
        if (p.end < now - 10) { for (const g of p.ins) { try { g.disconnect(); } catch (e) { /* gone */ } } return false; }
        return true;
      });
    }
    function current(now) {
      let p = null;
      for (const q of pieces) if (q.t0 <= now + 0.5 && (!p || q.t0 > p.t0)) p = q;
      return p ? { id: p.id, name: p.name } : null;
    }
    return {
      seed,
      fader,
      roomSize,
      tick,
      current,
      history,
      stats,
      fadeIn(seconds) { glide(fader.gain, 1, seconds); },
      fadeOut(seconds) { glide(fader.gain, 0, seconds); },
      setTone(t) {
        tone = Math.max(-1, Math.min(1, Number(t) || 0));
        glide(warm.frequency, warmBase * (1 + 0.07 * tone), 6);
      },
      dispose() {
        for (const s of held) { try { s.stop(); } catch (e) { /* not started */ } }
        held.clear();
        try { fader.disconnect(); } catch (e) { /* gone */ }
      }
    };
  }

  // =====================================================================================
  // The live player
  // =====================================================================================
  const MAX_GAIN = 0.5;      // master level at volume 1 (quiet on purpose: it sits behind everything)
  const FADE_IN = 4;         // seconds
  const FADE_OUT = 2;        // seconds
  const SEED_FADE = 8;       // seconds, from one variation to another

  let ctx = null;            // the AudioContext, created on the first start()
  let master = null;         // the volume knob
  let engine = null;         // the variation playing now
  let playing = false;
  let paused = false;        // hidden: faded out and suspended, still "on"
  let volume = 0.4;
  let timer = null;          // lookahead scheduler interval
  let stopTimer = null;      // pending "suspend after fade-out"
  let pauseTimer = null;

  // This session's seed: the kept one, or a fresh one
  function keptSeed() { try { return cleanSeed(localStorage.getItem(SEED_KEY)); } catch (e) { return null; } }
  // How long the same music plays (the gear's "Same music for"): each visit (a new one every time,
  // the start), a day, a week, or always (the kept seed). A day or a week keeps the seed with an end
  // time ("nova-music-keep": { mode, seed, until }); after it, a fresh one starts the next stretch.
  const KEEP_KEY = 'nova-music-keep';
  const KEEP_MS = { day: 24 * 3600e3, week: 7 * 24 * 3600e3 };
  function keepRecord() { try { return JSON.parse(localStorage.getItem(KEEP_KEY) || 'null'); } catch (e) { return null; } }
  function keepMode() { return keptSeed() ? 'always' : (keepRecord() && KEEP_MS[keepRecord().mode] ? keepRecord().mode : 'visit'); }
  function startingSeed() {
    const kept = keptSeed();
    if (kept) return kept;
    const r = keepRecord();
    if (r && KEEP_MS[r.mode]) {
      if (cleanSeed(r.seed) && Date.now() < r.until) return cleanSeed(r.seed);
      const fresh = randomSeed();
      remember(KEEP_KEY, JSON.stringify({ mode: r.mode, seed: fresh, until: Date.now() + KEEP_MS[r.mode] }));
      return fresh;
    }
    return randomSeed();
  }
  let seed = startingSeed();

  // The theme's colour, as a tilt from warm (−1) to cool (+1), for a subtle tint
  function themeTone() {
    try {
      const s = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      let rgb = null;
      const hex = s.match(/^#([0-9a-f]{6})$/i);
      if (hex) rgb = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255);
      const fn = s.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
      if (fn) rgb = [fn[1], fn[2], fn[3]].map((v) => Number(v) / 255);
      if (!rgb) return 0;
      const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      if (c < 0.05) return 0;
      let h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      h = (h * 60 + 360) % 360;
      const sat = c / (1 - Math.abs(mx + mn - 1) || 1);
      return Math.max(-1, Math.min(1, Math.cos(((h - 215) * Math.PI) / 180) * Math.min(1, sat * 1.4)));
    } catch (e) { return 0; }
  }
  function retint() { setTimeout(() => { if (engine) engine.setTone(themeTone()); }, 80); }
  window.addEventListener('novathemechange', retint);
  window.addEventListener('novalookchange', retint);
  window.addEventListener('storage', (e) => { if (e.key === 'nova-theme' || e.key === 'nova-look') retint(); });

  function tick() {
    if (!ctx || ctx.state !== 'running' || !engine) return;
    // Hidden (another window or app): plan 30 s ahead, since the browser only wakes us now and
    // then, so the music carries on in the background as it always has
    engine.tick(ctx.currentTime, document.hidden ? 30 : 1.5);
  }

  // ---- Context setup (lazy, inside a user gesture for iOS) --------------------
  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Let iOS treat this as media playback (plays with the ringer switch off).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = 0;
    const safety = ctx.createWaveShaper();
    safety.curve = safetyCurve();
    master.connect(safety).connect(ctx.destination);
    engine = Engine(ctx, master, seed, { instant: true, tone: themeTone() });
    remember(LAST_KEY, seed);
    return true;
  }

  // Older iOS only unlocks audio after something actually plays in a tap.
  function unlock() {
    const s = ctx.createBufferSource();
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.onended = () => s.disconnect();
    s.start(0);
  }

  function glideMaster(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  // Hidden: fade out and rest (no sound, no work); shown: fade back in where it left off
  function pauseHidden() {
    if (!playing || !ctx || paused) return;
    paused = true;
    glideMaster(0, 0.8);
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(() => {
      if (!paused) return;
      clearInterval(timer);
      timer = null;
      ctx.suspend().catch(() => {});
    }, 1000);
  }
  function resumeShown() {
    if (!paused || !ctx) return;
    paused = false;
    clearTimeout(pauseTimer);
    ctx.resume().catch(() => {}).then(() => {
      if (!playing || paused) return;
      if (!timer) timer = setInterval(tick, 200);
      tick();
      glideMaster(volume * MAX_GAIN, 2.5);
    });
  }

  // If the OS interrupted us (phone call, other app), try again on the next tap.
  function wake() {
    if (paused && !document.hidden) return resumeShown();
    if (playing && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('touchend', wake, { capture: true, passive: true });
  document.addEventListener('keydown', wake, true);
  // The music keeps playing while Nova Agent is in the background (as before); back in view, it
  // picks up straight away if the system had paused it
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  function setPlaying(value) {
    if (playing === value) return;
    playing = value;
    if (typeof api.onchange === 'function') {
      try { api.onchange(playing); } catch (e) { /* listener's problem, not ours */ }
    }
    tellEveryPage('novaambientchange', { on: playing });
  }

  // Tell this page and every panel inside it (they show the music switch too)
  function tellEveryPage(type, detail) {
    (function tell(w) {
      try { w.dispatchEvent(new w.CustomEvent(type, { detail })); } catch (e) { return; }
      for (let i = 0; i < w.frames.length; i++) tell(w.frames[i]);
    })(window);
  }
  function tellSeed() { tellEveryPage('novaambientseed', { seed, kept: keptSeed() === seed, piece: piece() }); }

  // On or off, remembered on this device
  function wanted() {
    try {
      const v = localStorage.getItem(KEY);
      if (v) return v === 'on';
      return false;
    } catch (e) { return false; }
  }
  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private window */ }
  }

  // A tap anywhere (here or in a panel): music that was on last time starts again
  function nudge() {
    if (playing) return wake();
    if (starting || !wanted()) return;
    start(false).catch(() => {});
  }
  let starting = false;
  document.addEventListener('pointerdown', nudge, true);
  document.addEventListener('keydown', nudge, true);

  // ---- Public API ---------------------------------------------------------------
  async function start(save = true) {
    if (save) remember(KEY, 'on');
    if (!ensureContext()) return;
    starting = true;
    clearTimeout(stopTimer);
    stopTimer = null;
    unlock();
    // resume() can hang while iOS has us "interrupted", so don't wait forever.
    await Promise.race([
      ctx.resume().catch(() => {}),
      new Promise((r) => setTimeout(r, 1500))
    ]);
    paused = false;
    if (!timer) timer = setInterval(tick, 200);
    tick();
    glideMaster(volume * MAX_GAIN, FADE_IN);
    starting = false;
    setPlaying(true);
    tellSeed();
  }

  function stop() {
    remember(KEY, 'off');
    if (!ctx || !playing) return;
    setPlaying(false);
    paused = false;
    clearTimeout(pauseTimer);
    glideMaster(0, FADE_OUT);
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      stopTimer = null;
      if (playing) return;                 // started again during the fade
      clearInterval(timer);
      timer = null;
      ctx.suspend().catch(() => {});
    }, FADE_OUT * 1000 + 200);
  }

  async function toggle() {
    if (playing) stop();
    else await start();
    return playing;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (ctx && playing && !paused) glideMaster(volume * MAX_GAIN, 0.4);
  }

  // Another variation: the old one fades away as the new one fades in
  function setSeed(code) {
    const s = cleanSeed(code);
    if (!s) return seed;
    const wasKept = keptSeed() === seed;
    seed = s;
    if (wasKept) remember(SEED_KEY, s);
    const r = keepRecord();
    if (r && KEEP_MS[r.mode]) remember(KEEP_KEY, JSON.stringify({ ...r, seed: s }));
    if (ctx) {
      remember(LAST_KEY, s);
      const old = engine;
      engine = Engine(ctx, master, s, { tone: themeTone() });
      if (ctx.state === 'running') {
        tick();
        engine.fadeIn(SEED_FADE);
        if (old) { old.fadeOut(SEED_FADE); setTimeout(() => old.dispose(), SEED_FADE * 1000 + 3000); }
      } else {
        // Not playing: swap straight away
        engine.fadeIn(0.01);
        if (old) old.dispose();
      }
    }
    tellSeed();
    return seed;
  }
  function keepSeed(on) {
    try {
      if (on) localStorage.setItem(SEED_KEY, seed);
      else localStorage.removeItem(SEED_KEY);
    } catch (e) { /* private window */ }
    tellSeed();
    return Boolean(on);
  }
  function keepFor(mode) {
    if (mode === 'always') { keepSeed(true); try { localStorage.removeItem(KEEP_KEY); } catch (e) {} }
    else {
      keepSeed(false);
      if (KEEP_MS[mode]) remember(KEEP_KEY, JSON.stringify({ mode, seed, until: Date.now() + KEEP_MS[mode] }));
      else try { localStorage.removeItem(KEEP_KEY); } catch (e) {}
    }
    tellSeed();
    return keepMode();
  }
  function piece() {
    if (!engine || !ctx) return null;
    return engine.current(ctx.currentTime);
  }

  // The saved volume (Portal's Options → Ambient music volume; 40 out of 100 to begin with)
  try {
    const saved = JSON.parse(localStorage.getItem('nova-options') || '{}').volume;
    volume = (typeof saved === 'number' ? saved : 40) / 100;
  } catch (e) { volume = 0.4; }
  window.addEventListener('storage', (e) => {
    if (e.key !== 'nova-options') return;
    try { const v = JSON.parse(e.newValue || '{}').volume; if (typeof v === 'number') setVolume(v / 100); } catch (err) { /* ignore */ }
  });

  // ---- Offline checks (scripts/audio-levels.mjs, test/audio-levels.spec.ts) ---------------
  // Render a seed's music without a speaker and measure it: peak and loudness, in dBFS.
  async function render(o) {
    o = o || {};
    const rate = o.rate || 44100, seconds = o.seconds || 60;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const octx = new OAC(2, Math.ceil(rate * seconds), rate);
    const vol = octx.createGain();
    vol.gain.value = (o.volume == null ? 0.4 : o.volume) * MAX_GAIN;
    const safety = octx.createWaveShaper();
    safety.curve = safetyCurve();
    // Measure before the safety curve, so it can't hide anything
    vol.connect(octx.destination);
    const eng = Engine(octx, vol, cleanSeed(o.seed) || randomSeed(), { instant: true, piece: o.piece, pieceSeconds: o.pieceSeconds, fadeSeconds: o.fadeSeconds, tone: o.tone || 0 });
    eng.tick(0, seconds);
    const buf = await octx.startRendering();
    let peak = 0, peakAt = 0, sum = 0, loud = 0;
    const win = Math.floor(rate * 0.4);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0, w = 0, n = 0; i < L.length; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (a > peak) { peak = a; peakAt = i / rate; }
      const e = (L[i] * L[i] + R[i] * R[i]) / 2;
      sum += e; w += e; n++;
      if (n === win) { loud = Math.max(loud, w / n); w = 0; n = 0; }
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    const out = {
      seed: eng.seed,
      pieces: eng.history.map((h) => h.id),
      room: eng.roomSize,
      peakDb: db(peak),
      peakAt,
      rmsDb: db(Math.sqrt(sum / L.length)),
      loudestDb: db(Math.sqrt(loud)),   // the loudest 0.4 s, as RMS
      clipped: peak >= 1,
      notes: { ...eng.stats }           // how many notes each player played
    };
    if (o.analyse || o.wav) {
      // How much of the sound is bass (under 150 Hz, a two-pole low-pass), and the longest quiet gap
      const k = Math.exp(-2 * Math.PI * 150 / rate);
      let y1 = 0, y2 = 0, lowSum = 0, gap = 0, longest = 0, wsum = 0, wn = 0;
      const gw = Math.floor(rate * 0.1);
      for (let i = 0; i < L.length; i++) {
        const x = (L[i] + R[i]) / 2;
        y1 = (1 - k) * x + k * y1; y2 = (1 - k) * y1 + k * y2;
        lowSum += y2 * y2;
        wsum += x * x; wn++;
        if (wn === gw) { if (Math.sqrt(wsum / wn) < 3e-4) { gap += 0.1; longest = Math.max(longest, gap); } else gap = 0; wsum = 0; wn = 0; }
      }
      out.lowShare = lowSum / Math.max(1e-12, L.reduce((a, x, i) => a + ((x + R[i]) / 2) ** 2, 0));
      out.longestGap = longest;
    }
    if (o.wav) {
      // A 16-bit WAV of it, as base64 (scripts/music-previews.mjs saves these)
      const n = L.length, bytes = new Uint8Array(44 + n * 4), v = new DataView(bytes.buffer);
      const str = (at, t) => { for (let i = 0; i < t.length; i++) bytes[at + i] = t.charCodeAt(i); };
      str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
      const gainUp = o.wavGain || 1;
      for (let i = 0; i < n; i++) {
        v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * gainUp)) * 32767, true);
        v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * gainUp)) * 32767, true);
      }
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      out.wav = btoa(bin);
    }
    return out;
  }

  const api = {
    start: () => start(true), stop, toggle, setVolume, isPlaying: () => playing, wanted, nudge,
    seed: () => seed, setSeed, newSeed: () => setSeed(randomSeed()), keepSeed, keptSeed, keepFor, keepMode, volume: () => volume, piece,
    pieces: Object.keys(PIECE_NAMES).map((id) => ({ id, name: PIECE_NAMES[id] })),
    onchange: null,
    _render: render
  };
  window.NovaAmbient = api;
})();
