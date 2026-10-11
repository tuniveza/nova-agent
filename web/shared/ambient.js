/* Nova Ambient: Novacane's quiet, never-ending ambient music for all of Nova Agent.
   Everything is made live with the Web Audio API: no audio files, no libraries,
   no network. Slow warm pads, a soft bass, little star-like bells, now and then a
   short soft electric-piano phrase, a faint ocean of air, all washed in a big
   reverb and kept low so it sits behind everything. Never the same twice: the chords
   wander (each next one chosen from those that follow well, the recent ones less
   likely), every few minutes the mood changes (sparser, starrier, stiller, brighter),
   and the piano's little melodies are made up fresh each time.

   Pieces: that first music ("Glow") is one of seven pieces that take turns, each for a
   few minutes, crossfading slowly into the next (never the same piece twice running):
     Glow          the original: pads, soft bass, stars, little piano phrases, air
     Warm keys     a soft electric piano (Rhodes-like), slowly rolled chords, swaying
     Slow drone    a low drone whose soft overtones breathe, with colour notes drifting in
     Tape chords   warm chords that waver a little, like an old tape, faint hiss
     Distant air   breathy, airy chords made of tuned wind, far away
     Low strings   low, lush string-like swells that open and close
     Night rain    soft rain and a distant rumble under a slow night pad
   All of them are in or next to D lydian (the sound effects' key), so they always fit.

   Seeds: every listen is generated from a seed (a short code like "K7M2QX"). The seed
   chooses the order of the pieces, each piece's key and mode, its pace, its chords and
   how they're voiced, its tone colours and filters, the size of the reverb and the echo,
   and its textures. A new random seed each session; a liked one can be kept (it then
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

  // ---- Musical material (Glow, the first piece) -----------------------------------
  // Chords in D major with a dreamy lydian tint. MIDI numbers (60 = middle C).
  // Upper notes are voiced close together so moving between chords is smooth.
  const CH = {
    D:  { bass: 38, notes: [50, 57, 61, 64, 66] }, // Dmaj9
    Bm: { bass: 35, notes: [50, 54, 57, 61, 64] }, // Bm11
    G:  { bass: 31, notes: [50, 54, 59, 61, 66] }, // Gmaj7#11
    A:  { bass: 33, notes: [52, 57, 59, 61, 64] }, // Aadd9
    Em: { bass: 40, notes: [52, 55, 59, 62, 66] }, // Em9
    Fsm: { bass: 42, notes: [52, 54, 57, 61, 64] }, // F#m11
    E:  { bass: 40, notes: [52, 56, 59, 61, 66] }  // E6/9 (the bright, lydian colour)
  };
  // Never the same tune twice: instead of a fixed round of chords, each next chord is chosen from
  // the ones that follow it well, with the ones heard lately less likely. So it wanders, slowly,
  // and the same stretch rarely comes back.
  const MOVES = {
    D: ['Bm', 'G', 'A', 'Em', 'Fsm', 'E'],
    Bm: ['G', 'Em', 'A', 'D', 'Fsm'],
    G: ['A', 'D', 'Em', 'Bm', 'E'],
    A: ['D', 'Bm', 'Fsm', 'G'],
    Em: ['G', 'A', 'D', 'Bm'],
    Fsm: ['Bm', 'G', 'D', 'E'],
    E: ['A', 'D', 'G']
  };
  // Moods: every few minutes the music changes its feel (how many stars, how often the piano
  // speaks, how bright the pads are, how long each chord lasts), never the same mood twice running
  const MOODS = {
    glow:   { stars: 1,   phrases: 1,    bright: 1,    len: [16, 24] },
    drift:  { stars: 1.7, phrases: 1.6,  bright: 0.8,  len: [20, 28] },
    starry: { stars: 0.6, phrases: 1.2,  bright: 1.12, len: [14, 22] },
    still:  { stars: 2.4, phrases: 0,    bright: 0.72, len: [24, 32] },
    tender: { stars: 1.2, phrases: 0.65, bright: 0.9,  len: [16, 22] }
  };
  // High D major pentatonic notes for the twinkling "stars".
  const STARS = [74, 76, 78, 81, 83, 86, 88, 90];
  // Novacane's little phrases for the soft electric piano (D lydian), one every half a minute or so
  const PHRASES = [
    [62, 69, 73, 78],      // D A C# F#: the same signature as the "hello" sound
    [66, 64, 61, 62],
    [69, 71, 73, 69, 66],
    [73, 71, 69, 64],
    [62, 64, 66, 68, 69],  // up through the bright G#
    [78, 76, 73, 69]
  ];
  const SCALE = [62, 64, 66, 68, 69, 71, 73, 74, 76, 78, 81];

  // ---- Keys and chords for the other pieces ------------------------------------------
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
  const PIECE_NAMES = { glow: 'Glow', keys: 'Warm keys', drone: 'Slow drone', tape: 'Tape chords', air: 'Distant air', strings: 'Low strings', rain: 'Night rain' };
  // How loud each piece sits, so they all match Glow (measured: scripts/audio-levels.mjs)
  const TRIM = { glow: 1, keys: 1.4, drone: 1.4, tape: 1.3, air: 2, strings: 4.5, rain: 2.1 };

  function Engine(ctx, dest, seed, opts) {
    opts = opts || {};
    const S = (label) => stream(seed, label);
    const prog = S('programme');
    let tone = opts.tone || 0;      // −1 warm theme … +1 cool theme
    const bright = () => 1 + 0.05 * tone;
    const held = new Set();          // long-running sources, stopped when the engine goes

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
    const warmBase = rr(prog, 5800, 6800);
    const warm = filter('lowpass', warmBase * (1 + 0.07 * tone), 0.3);
    comp.connect(warm).connect(fader);
    // Reverb send/return: its size is part of the seed.
    const reverbIn = gain(1);
    const verb = ctx.createConvolver();
    const roomSize = rr(prog, 4.6, 7.2);
    verb.buffer = makeImpulse(roomSize, S('room'));
    const verbOut = gain(0.9);
    reverbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(comp);
    // Two soft, darkened echoes (one for the piece playing, one for the piece coming in), each
    // piece setting its own echo time while its line is quiet.
    const lines = [0, 1].map(() => {
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.52;                 // roughly a dotted eighth
      const echoTone = filter('lowpass', 2200, 0.3);
      const back = gain(0.35);
      const echoOut = gain(0.5);
      delay.connect(echoTone).connect(back).connect(delay); // feedback loop
      echoTone.connect(echoOut);
      echoOut.connect(comp);
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
      const p = { id: name, name: PIECE_NAMES[name], i, t0: t, end, r, schedule: () => {} };
      p.ins = [gain(0), gain(0), gain(0)];
      p.ins[0].connect(comp); p.ins[1].connect(reverbIn); p.ins[2].connect(line.input);
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

    // ================= Glow (the first piece: Novacane's own) =================
    function glow(p) {
      const rc = p.r('chords'), rs = p.r('stars'), rp = p.r('phrases'), rm = p.r('mood'), rv = p.r('voices');
      const rand = (a, b) => rr(rv, a, b);
      const padBus = p.layer(0.45, 0.9, 0);
      const bassBus = p.layer(1, 0.2, 0);
      const starBus = p.layer(0.6, 0.6, 1);
      const keysBus = p.layer(0.5, 0.7, 0.45);
      const airBus = p.layer(1, 1, 0);

      const recent = [];
      let chordName = pk(rc, ['D', 'G', 'Bm', 'A', 'Em']);
      function nextChord() {
        const options = MOVES[chordName];
        const weights = options.map((n) => 1 / (1 + 2 * recent.filter((x) => x === n).length));
        chordName = weighted(rc, options, weights);
        recent.push(chordName);
        if (recent.length > 6) recent.shift();
        return CH[chordName];
      }
      let mood = MOODS.glow, moodName = 'glow', moodUntil = 0;
      function maybeChangeMood(now) {
        if (now < moodUntil) return;
        const names = Object.keys(MOODS).filter((n) => n !== moodName);
        moodName = pk(rm, names);
        mood = MOODS[moodName];
        moodUntil = now + rr(rm, 150, 300);
      }

      // Air / ocean bed: filtered noise that slowly breathes
      (function air() {
        const src = noiseSource('white');
        const hp = filter('highpass', 120, 0.3);
        const lp = filter('lowpass', 550, 0.3);
        const level = gain(0.012);
        // Slow swell of the volume (like distant waves) ...
        const swell = osc('sine', 0.045);
        const swellAmt = gain(0.009);
        swell.connect(swellAmt).connect(level.gain);
        // ... and an even slower drift of the tone.
        const drift = osc('sine', 0.018);
        const driftAmt = gain(220);
        drift.connect(driftAmt).connect(lp.frequency);
        src.connect(hp).connect(lp).connect(level).connect(airBus);
        p.hold(src); p.hold(swell); p.hold(drift);
      })();

      // Pads: one voice = two detuned saws (filtered) + a pure sine
      function padVoice(midi, t, hold, pan) {
        const f = mtof(midi);
        const out = gain(0);
        const place = panner(pan);
        out.connect(place).connect(padBus);
        // Warm low-pass with its own slow wobble.
        const lp = filter('lowpass', rand(750, 1300) * mood.bright * bright(), 0.4);
        lp.connect(out);
        const lfo = osc('sine', rand(0.03, 0.08));
        const lfoAmt = gain(rand(200, 400));
        lfo.connect(lfoAmt).connect(lp.frequency);
        const sawA = osc('sawtooth', f), sawB = osc('sawtooth', f);
        sawA.detune.value = rand(-9, -5);
        sawB.detune.value = rand(5, 9);
        sawA.connect(lp); sawB.connect(lp);
        const sine = osc('sine', f);
        const sineAmt = gain(0.7);
        sine.connect(sineAmt).connect(out);
        const end = envelope(out, t, 0.02, rand(4, 6), hold, rand(5, 6.5));
        for (const s of [lfo, sawA, sawB, sine]) { s.start(t); s.stop(end); }
        disposeWhenDone(sawA, [out, place, lp, lfo, lfoAmt, sawA, sawB, sine, sineAmt]);
      }
      // Bass: a quiet sine, plus its octave so phone speakers can hear it
      function bassNote(midi, t, hold) {
        const f = mtof(midi);
        const out = gain(0);
        out.connect(bassBus);
        const sub = osc('sine', f);
        const upper = osc('sine', f * 2);
        const upperAmt = gain(0.35);
        sub.connect(out);
        upper.connect(upperAmt).connect(out);
        const end = envelope(out, t, 0.056, 4, hold, 5);   // (a little lighter than at first: calmer peaks)
        sub.start(t); upper.start(t);
        sub.stop(end); upper.stop(end);
        disposeWhenDone(sub, [out, sub, upper, upperAmt]);
      }
      // A whole chord: pads spread across the stereo field + bass
      function playChord(chord, t, length) {
        const notes = chord.notes.slice();
        // Now and then leave out an inner note so the texture breathes.
        if (rv() < 0.3) notes.splice(1 + Math.floor(rv() * (notes.length - 2)), 1);
        notes.forEach((m, i) => {
          const pan = (i / (notes.length - 1) - 0.5) * 1.1 + rand(-0.1, 0.1);
          padVoice(m, t + rand(0, 0.6), length, pan);
        });
        bassNote(chord.bass, t, length);
      }
      // Stars: a soft bell (sine + quieter triangle an octave up)
      function playStar(t) {
        const f = mtof(pk(rs, STARS));
        const place = panner(rr(rs, -0.7, 0.7));
        place.connect(starBus);
        const body = gain(0);
        body.gain.setValueAtTime(0, t);
        body.gain.linearRampToValueAtTime(0.024, t + 0.01);   // (a touch softer than at first: calm)
        body.gain.setTargetAtTime(0, t + 0.012, rr(rs, 0.6, 1.2));
        const shine = gain(0);
        shine.gain.setValueAtTime(0, t);
        shine.gain.linearRampToValueAtTime(0.0065, t + 0.006);
        shine.gain.setTargetAtTime(0, t + 0.008, 0.25);
        const a = osc('sine', f);
        const b = osc('triangle', f * 2);
        a.connect(body).connect(place);
        b.connect(shine).connect(place);
        const end = t + 7;
        a.start(t); b.start(t);
        a.stop(end); b.stop(end);
        disposeWhenDone(a, [a, b, body, shine, place]);
      }
      // Keys: a soft electric piano (FM: a sine "tine" that mellows as it rings)
      function keyNote(midi, t, pan, level) {
        const f = mtof(midi);
        const place = panner(pan);
        place.connect(keysBus);
        const amp = gain(0);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.012);
        amp.gain.setTargetAtTime(0, t + 0.02, rr(rp, 0.9, 1.5));
        amp.connect(place);
        const carrier = osc('sine', f);
        const mod = osc('sine', f);
        const depth = gain(0);
        depth.gain.setValueAtTime(f * 1.1, t);
        depth.gain.setTargetAtTime(f * 0.05, t, 0.35);
        mod.connect(depth).connect(carrier.frequency);
        // A gentle wobble, like a Rhodes' tremolo
        const trem = osc('sine', 4.2);
        const tremAmt = gain(level * 0.25);
        trem.connect(tremAmt).connect(amp.gain);
        carrier.connect(amp);
        const end = t + 7;
        for (const o of [carrier, mod, trem]) { o.start(t); o.stop(end); }
        disposeWhenDone(carrier, [carrier, mod, depth, trem, tremAmt, amp, place]);
      }
      // A new little melody each time: a few notes moving mostly by step through the scale, ending
      // on a note of the chord underneath. Now and then (rarely) one of Novacane's own phrases instead.
      function newPhrase() {
        if (rp() < 0.12) return pk(rp, PHRASES);
        const count = 3 + Math.floor(rp() * 3);
        let i = 2 + Math.floor(rp() * 6);
        const notes = [];
        for (let n = 0; n < count; n++) {
          notes.push(SCALE[i]);
          const leap = rp() < 0.2 ? 2 : 1;
          i = Math.max(0, Math.min(SCALE.length - 1, i + (rp() < 0.5 ? -leap : leap)));
        }
        // End on a note of the chord (moved into the melody's range)
        const tones = CH[chordName].notes.map((m) => (m < 62 ? m + 12 : m));
        const end = notes[notes.length - 1];
        notes[notes.length - 1] = tones.reduce((a, b) => (Math.abs(b - end) < Math.abs(a - end) ? b : a));
        return notes;
      }
      function playPhrase(t) {
        const notes = newPhrase();
        let at = t;
        notes.forEach((m, i) => {
          keyNote(m, at, -0.4 + (0.8 * i) / Math.max(1, notes.length - 1), rr(rp, 0.016, 0.024));
          at += rr(rp, 0.45, 0.9);
        });
        // Sometimes the last note gets a soft lower partner
        if (rp() < 0.5) keyNote(notes[notes.length - 1] - 12, at - 0.2, 0, 0.012);
      }

      let nextChordAt = p.t0 + 0.1, nextStarAt = p.t0 + 3, nextPhraseAt = p.t0 + rr(rp, 10, 18);
      p.schedule = (now, horizon) => {
        // If we fell far behind (e.g. after a pause), start fresh instead of piling up.
        if (nextChordAt < now - 0.5) nextChordAt = now + 0.1;
        if (nextStarAt < now - 0.5) nextStarAt = now + rr(rs, 1, 3);
        if (nextPhraseAt < now - 0.5) nextPhraseAt = now + rr(rp, 12, 25);
        maybeChangeMood(Math.max(now, p.t0));
        while (nextChordAt < horizon && p.alive(nextChordAt)) {
          maybeChangeMood(nextChordAt);
          const length = rr(rc, mood.len[0], mood.len[1]);
          playChord(nextChord(), nextChordAt, length);
          nextChordAt += length;
        }
        while (nextStarAt < horizon && p.alive(nextStarAt)) {
          playStar(nextStarAt);
          // Sometimes a second star answers the first.
          if (rs() < 0.3) playStar(nextStarAt + rr(rs, 0.2, 0.45));
          nextStarAt += rr(rs, 2, 7) * mood.stars;
        }
        while (nextPhraseAt < horizon && p.alive(nextPhraseAt)) {
          if (mood.phrases) playPhrase(nextPhraseAt);
          nextPhraseAt += rr(rp, 26, 48) * (mood.phrases || 1.5);
        }
      };
    }

    // A quiet sine bass with its octave (shared by the newer pieces)
    function softBass(bus, midi, t, hold, peak, attack, release) {
      const f = mtof(midi);
      const out = gain(0);
      out.connect(bus);
      const sub = osc('sine', f);
      const upper = osc('sine', f * 2);
      const upperAmt = gain(0.3);
      sub.connect(out);
      upper.connect(upperAmt).connect(out);
      const end = envelope(out, t, peak, attack, hold, release);
      sub.start(t); upper.start(t); sub.stop(end); upper.stop(end);
      disposeWhenDone(sub, [out, sub, upper, upperAmt]);
    }
    // A chord-led piece: every chord_len seconds, the next chord, voiced and handed to play()
    function chordLoop(p, r, key, H, o, play) {
      let next = p.t0 + 0.2, prev = null;
      p.schedule = (now, horizon) => {
        if (next < now - 0.5) next = now + 0.2;
        if (o.extra) o.extra(now, horizon);
        while (next < horizon && p.alive(next)) {
          const d = H.next();
          const len = rr(r, o.len[0], o.len[1]);
          const notes = voice(key, d, o.style, o.center, prev);
          prev = notes;
          play(d, notes, next, len);
          next += len;
        }
      };
    }

    // ================= Warm keys: a soft Rhodes-like electric piano =================
    function keys(p) {
      const r = p.r('keys'), rh = p.r('harmony');
      const key = makeKey(rh, ['ionian', 'lydian', 'dorian', 'mixolydian', 'lydian']);
      const H = Harmony(key, rh);
      const pace = rr(r, 0.85, 1.3);
      const decay = rr(r, 1.6, 2.6), index = rr(r, 0.45, 0.85) * bright();
      // The bus: a warm filter, then a slow stereo sway like an old suitcase piano
      const bus = gain(1);
      const lp = filter('lowpass', rr(r, 1900, 2600) * bright(), 0.4);
      const sway = panner(0);
      bus.connect(lp).connect(sway).connect(p.layer(0.5, 0.8, rr(r, 0.25, 0.5)));
      if (sway.pan) {
        const lfo = osc('sine', rr(r, 2.8, 4.6));
        const amt = gain(rr(r, 0.25, 0.5));
        lfo.connect(amt).connect(sway.pan);
        p.hold(lfo);
      }
      const bassBus = p.layer(1, 0.25, 0);
      function ep(midi, t, level, idx) {
        const f = mtof(midi);
        const amp = gain(0);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.02);
        amp.gain.setTargetAtTime(0, t + 0.03, decay);
        const car = osc('sine', f), mod = osc('sine', f), depth = gain(0);
        depth.gain.setValueAtTime(f * idx, t);
        depth.gain.setTargetAtTime(f * 0.03, t, 0.3);
        mod.connect(depth).connect(car.frequency);
        car.connect(amp).connect(bus);
        const end = t + decay * 6 + 0.1;
        car.start(t); mod.start(t); car.stop(end); mod.stop(end);
        disposeWhenDone(car, [car, mod, depth, amp]);
      }
      const o = { len: [14 * pace, 24 * pace], style: pk(r, ['open', 'shell', 'close', 'wide']), center: rr(r, 59, 65) };
      chordLoop(p, r, key, H, o, (d, notes, t, len) => {
        const gap = rr(r, 0.07, 0.2);
        const order = r() < 0.3 ? notes.slice().reverse() : notes;
        order.forEach((m, i) => ep(m, t + i * gap + rr(r, 0, 0.03), rr(r, 0.01, 0.014), index));
        // A softer second touch later on (two of its notes)
        if (r() < 0.7 && notes.length > 2) {
          const at = t + len * rr(r, 0.45, 0.65);
          const a = notes[1 + Math.floor(r() * (notes.length - 1))], b = notes[Math.floor(r() * notes.length)];
          ep(a, at, rr(r, 0.006, 0.009), index * 0.8);
          if (b !== a) ep(b, at + gap * 1.6, rr(r, 0.005, 0.008), index * 0.8);
        }
        // Now and then two or three slow notes of melody above
        if (r() < 0.35) {
          let n = 9 + Math.floor(r() * 4), at = t + rr(r, 3, 7);
          const top = notes[notes.length - 1];
          const count = 2 + Math.floor(r() * 2);
          for (let k = 0; k < count; k++) {
            let m = tonicNear(key, 0) + semi(key, n);
            while (m < top + 2) m += 12;
            while (m > 79) m -= 12;
            ep(m, at, rr(r, 0.005, 0.008), index * 0.7);
            n += r() < 0.5 ? -1 : 1;
            at += rr(r, 0.9, 1.6);
          }
        }
        softBass(bassBus, bassOf(key, d, 31), t, len, 0.05, 3, 5);
      });
    }

    // ================= Slow drone: a low root whose soft overtones breathe =================
    function drone(p) {
      const r = p.r('drone');
      const key = makeKey(r, ['lydian', 'dorian', 'ionian', 'aeolian', 'mixolydian']);
      const minor = semi(key, 2) === 3;
      const root = tonicNear(key, Math.round(rr(r, 36, 43)));
      const f0 = mtof(root);
      const bus = p.layer(0.55, 0.8, 0);
      const lp = filter('lowpass', rr(r, 800, 1400) * bright(), 0.5);
      lp.connect(bus);
      const drift = osc('sine', rr(r, 0.006, 0.015));
      const driftAmt = gain(rr(r, 150, 300));
      drift.connect(driftAmt).connect(lp.frequency);
      p.hold(drift);
      // Each overtone with its own slow breathing
      const partials = minor ? [[1, 1], [2, 1], [3, 1], [4, 1], [6, 1], [8, 1], [1.5, 0.4], [3, 0.3]] : [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [8, 1], [1.5, 0.4]];
      const base = rr(r, 0.04, 0.05);
      partials.forEach(([n, w], k) => {
        const o = osc('sine', f0 * n);
        if (k) o.detune.value = rr(r, -4, 4);
        const a = (base * w) / Math.pow(n, 1.15);
        const g = gain(a * 0.6);
        const l = osc('sine', rr(r, 0.01, 0.05));
        const la = gain(a * 0.4);
        l.connect(la).connect(g.gain);
        o.connect(g).connect(lp);
        p.hold(o); p.hold(l);
      });
      // A slow chorus on the octave: the same note a few cents apart, gently beating
      const ch = osc('sine', f0 * 2);
      ch.detune.value = rr(r, 3, 6);
      const chAmt = gain(base * 0.25);
      ch.connect(chAmt).connect(lp);
      p.hold(ch);
      // Colour notes drifting in and out above it
      const colourBus = p.layer(0.3, 1, 0.3);
      const colours = [2, 4, 8, 9, 11];
      if (key.mode === 'lydian') colours.push(3, 10);
      if (key.mode === 'dorian') colours.push(5, 12);
      let next = p.t0 + rr(r, 4, 9), lastC = -1;
      p.schedule = (now, horizon) => {
        if (next < now - 0.5) next = now + 1;
        while (next < horizon && p.alive(next)) {
          let c = pk(r, colours);
          if (c === lastC) c = colours[(colours.indexOf(c) + 1) % colours.length];
          lastC = c;
          let m = tonicNear(key, 60) + semi(key, c);
          while (m < 62) m += 12;
          while (m > 79) m -= 12;
          const f = mtof(m);
          const out = gain(0);
          const place = panner(rr(r, -0.6, 0.6));
          out.connect(place).connect(colourBus);
          const a = osc('sine', f), b = osc('sine', f * 2), bAmt = gain(0.12);
          a.connect(out); b.connect(bAmt).connect(out);
          const end = envelope(out, next, rr(r, 0.008, 0.012), rr(r, 5, 10), rr(r, 8, 16), rr(r, 8, 14));
          a.start(next); b.start(next); a.stop(end); b.stop(end);
          disposeWhenDone(a, [a, b, bAmt, out, place]);
          next += rr(r, 10, 22);
        }
      };
    }

    // ================= Tape chords: warm chords that waver like an old tape =================
    function tape(p) {
      const r = p.r('tape'), rh = p.r('harmony');
      const key = makeKey(rh, ['ionian', 'mixolydian', 'dorian', 'lydian', 'aeolian']);
      const H = Harmony(key, rh);
      const pace = rr(r, 0.9, 1.3);
      // Wow (slow) and flutter (fast, tiny): pitch wobbles shared by every note
      const wow = osc('sine', rr(r, 0.18, 0.42)), wowAmt = gain(rr(r, 4, 9));
      const flutter = osc('sine', rr(r, 5.2, 7)), flAmt = gain(rr(r, 0.8, 1.6));
      wow.connect(wowAmt); flutter.connect(flAmt);
      p.hold(wow); p.hold(flutter);
      // Tape: driven a little into a soft curve for warmth, then a gentle top roll-off
      const bus = gain(1), pre = gain(6), sat = ctx.createWaveShaper(), post = gain(1 / 6);
      sat.curve = tapeCurve();
      const roll = filter('lowpass', rr(r, 2600, 3600) * bright(), 0.5);
      bus.connect(pre).connect(sat).connect(post).connect(roll).connect(p.layer(0.5, 0.85, rr(r, 0.1, 0.3)));
      // A whisper of hiss
      const hiss = noiseSource('pink', r);
      const hhp = filter('highpass', 500, 0.5), hlp = filter('lowpass', 2500, 0.5), hl = gain(rr(r, 0.0012, 0.002));
      hiss.connect(hhp).connect(hlp).connect(hl).connect(p.layer(1, 0.3, 0));
      p.hold(hiss);
      const bassBus = p.layer(1, 0.2, 0);
      function voiceNote(m, t, len) {
        const f = mtof(m);
        const tri = osc('triangle', f), saw = osc('sawtooth', f), sawAmt = gain(0.35);
        saw.detune.value = rr(r, 3, 7) * (r() < 0.5 ? -1 : 1);
        const lp = filter('lowpass', rr(r, 700, 1200) * bright(), 0.5);
        const amp = gain(0), place = panner(rr(r, -0.55, 0.55));
        tri.connect(lp); saw.connect(sawAmt).connect(lp);
        lp.connect(amp).connect(place).connect(bus);
        const links = [];
        for (const o of [tri, saw]) { wowAmt.connect(o.detune); flAmt.connect(o.detune); links.push([wowAmt, o.detune], [flAmt, o.detune]); }
        const end = envelope(amp, t, rr(r, 0.01, 0.014), rr(r, 2, 4), len, rr(r, 4, 7));
        tri.start(t); saw.start(t); tri.stop(end); saw.stop(end);
        disposeWhenDone(tri, [tri, saw, sawAmt, lp, amp, place], links);
      }
      function bassNote(m, t, len) {
        const o = osc('triangle', mtof(m)), lp = filter('lowpass', 260, 0.5), amp = gain(0);
        o.connect(lp).connect(amp).connect(bassBus);
        const end = envelope(amp, t, 0.05, 3, len, 5);
        o.start(t); o.stop(end);
        disposeWhenDone(o, [o, lp, amp]);
      }
      const o = { len: [12 * pace, 22 * pace], style: pk(r, ['close', 'open', 'shell']), center: rr(r, 57, 63) };
      chordLoop(p, r, key, H, o, (d, notes, t, len) => {
        // Now and then just a part of the chord, so it breathes
        const use = notes.length > 3 && r() < 0.3 ? notes.filter((_, i) => i !== 1 + Math.floor(r() * (notes.length - 2))) : notes;
        use.forEach((m) => voiceNote(m, t + rr(r, 0, 0.8), len));
        bassNote(bassOf(key, d, 33), t, len);
      });
    }

    // ================= Distant air: breathy chords made of tuned wind =================
    function airy(p) {
      const r = p.r('air'), rh = p.r('harmony');
      const key = makeKey(rh, ['lydian', 'ionian', 'dorian', 'aeolian', 'mixolydian']);
      const H = Harmony(key, rh);
      const pace = rr(r, 0.9, 1.3);
      const bus = p.layer(0.25, 1.1, rr(r, 0.1, 0.3));
      const subBus = p.layer(1, 0.3, 0);
      const q1 = rr(r, 14, 26), q2 = rr(r, 10, 18);
      function breath(m, t, len) {
        const f = mtof(m);
        const src = noiseSource('pink', r);
        const bp1 = filter('bandpass', f, q1), bp2 = filter('bandpass', f, q2);
        const amp = gain(0), place = panner(rr(r, -0.75, 0.75));
        // A faint pure tone inside the breath, so the pitch is clear
        const tone = osc('sine', f), toneAmt = gain(0.12);
        src.connect(bp1).connect(bp2).connect(amp);
        tone.connect(toneAmt).connect(amp);
        amp.connect(place).connect(bus);
        // Narrow bands of noise are quiet: make up for how narrow (measured)
        const make = 2.2 * Math.sqrt(q1 * q2 / 300) * Math.sqrt(440 / f);
        const end = envelope(amp, t, rr(r, 0.007, 0.01) * make, rr(r, 5, 9), len * 0.85, rr(r, 7, 11));
        const toneEnd = end;
        src.start(t, rr(r, 0, 5)); tone.start(t);
        src.stop(end); tone.stop(toneEnd);
        disposeWhenDone(src, [src, bp1, bp2, amp, place, tone, toneAmt]);
      }
      const o = { len: [20 * pace, 34 * pace], style: pk(r, ['wide', 'open', 'eleven']), center: rr(r, 62, 68) };
      chordLoop(p, r, key, H, o, (d, notes, t, len) => {
        notes.forEach((m) => breath(m, t + rr(r, 0, 2.5), len));
        softBass(subBus, bassOf(key, d, 33), t, len, 0.03, 6, 8);
      });
    }

    // ================= Low strings: lush, low string-like swells =================
    function strings(p) {
      const r = p.r('strings'), rh = p.r('harmony');
      const key = makeKey(rh, ['aeolian', 'dorian', 'ionian', 'lydian']);
      const H = Harmony(key, rh);
      const pace = rr(r, 0.9, 1.25);
      // Two slightly different vibratos, shared out between the players
      const vibs = [0, 1].map((k) => {
        const v = osc('sine', k ? rr(r, 5.1, 5.5) : rr(r, 4.6, 5));
        const a = gain(rr(r, 2.5, 4));
        v.connect(a); p.hold(v);
        return a;
      });
      const bus = p.layer(0.4, 0.95, 0);
      const bassBus = p.layer(0.8, 0.4, 0);
      function bowed(m, t, len, peak, top) {
        const f = mtof(m);
        const lp = filter('lowpass', 230, 0.6), amp = gain(0), place = panner(rr(r, -0.6, 0.6));
        lp.connect(amp).connect(place).connect(bus);
        const attack = rr(r, 5, 9);
        lp.frequency.setValueAtTime(rr(r, 200, 260), t);
        lp.frequency.linearRampToValueAtTime(top * bright(), t + attack);
        lp.frequency.setTargetAtTime(320, t + attack + len * 0.3, len * 0.3);
        const saws = [rr(r, -11, -7), rr(r, -2, 2), rr(r, 7, 11)].map((c, k) => {
          const s = osc('sawtooth', f);
          s.detune.value = c;
          s.connect(lp);
          return s;
        });
        const links = saws.map((s, k) => { const v = vibs[k % 2]; v.connect(s.detune); return [v, s.detune]; });
        const end = envelope(amp, t, peak, attack, len, rr(r, 6, 10));
        for (const s of saws) { s.start(t); s.stop(end); }
        disposeWhenDone(saws[0], [...saws, lp, amp, place], links);
      }
      const o = { len: [18 * pace, 30 * pace], style: pk(r, ['open', 'wide', 'shell']), center: rr(r, 50, 57) };
      chordLoop(p, r, key, H, o, (d, notes, t, len) => {
        const top = rr(r, 650, 1100);
        notes.forEach((m) => bowed(m, t + rr(r, 0, 1.5), len, rr(r, 0.0045, 0.006), top));
        bowed(bassOf(key, d, 31), t, len, 0.0055, 260);
      });
    }

    // ================= Night rain: soft rain and a distant rumble under a night pad =================
    function rain(p) {
      const r = p.r('rain'), rh = p.r('harmony');
      const key = makeKey(rh, ['aeolian', 'dorian', 'aeolian', 'lydian', 'mixolydian']);
      const H = Harmony(key, rh);
      const pace = rr(r, 0.9, 1.3);
      // The rain: pink noise, softly filtered, breathing slowly
      const wash = noiseSource('pink', r);
      const hp = filter('highpass', rr(r, 250, 400), 0.4);
      const lp = filter('lowpass', rr(r, 1300, 2000) * bright(), 0.4);
      const level = gain(rr(r, 0.012, 0.018));
      const lfo = osc('sine', rr(r, 0.01, 0.03)), lfoAmt = gain(rr(r, 150, 300));
      lfo.connect(lfoAmt).connect(lp.frequency);
      const sw = osc('sine', rr(r, 0.02, 0.05)), swAmt = gain(level.gain.value * 0.35);
      sw.connect(swAmt).connect(level.gain);
      wash.connect(hp).connect(lp).connect(level).connect(p.layer(0.9, 0.35, 0));
      p.hold(wash); p.hold(lfo); p.hold(sw);
      // A distant rumble
      const rumble = noiseSource('brown', r);
      const rlp = filter('lowpass', rr(r, 120, 180), 0.5), rl = gain(rr(r, 0.03, 0.05));
      rumble.connect(rlp).connect(rl).connect(p.layer(1, 0.1, 0));
      p.hold(rumble);
      // The night pad: sines and a soft triangle
      const padBus = p.layer(0.35, 1, 0);
      function padNote(m, t, len) {
        const f = mtof(m);
        const a = osc('sine', f), b = osc('triangle', f), bAmt = gain(0.25);
        const plp = filter('lowpass', 900 * bright(), 0.4), amp = gain(0), place = panner(rr(r, -0.6, 0.6));
        a.connect(plp); b.connect(bAmt).connect(plp);
        plp.connect(amp).connect(place).connect(padBus);
        const end = envelope(amp, t, rr(r, 0.008, 0.011), rr(r, 7, 11), len, rr(r, 8, 12));
        a.start(t); b.start(t); a.stop(end); b.stop(end);
        disposeWhenDone(a, [a, b, bAmt, plp, amp, place]);
      }
      // Now and then a far-off drop in still water (some nights have none)
      const dripBus = p.layer(0.4, 0.9, 0.6);
      const drips = r() < 0.6;
      let tones = [];
      let nextDrip = p.t0 + rr(r, 8, 16);
      function drip(t) {
        if (!tones.length) return;
        let m = pk(r, tones);
        while (m < 69) m += 12;
        while (m > 81) m -= 12;
        const o = osc('sine', mtof(m)), dl = filter('lowpass', 1500, 0.4), amp = gain(0), place = panner(rr(r, -0.8, 0.8));
        o.connect(dl).connect(amp).connect(place).connect(dripBus);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(rr(r, 0.0035, 0.0055), t + 0.04);
        amp.gain.setTargetAtTime(0, t + 0.045, rr(r, 0.35, 0.6));
        o.start(t); o.stop(t + 4);
        disposeWhenDone(o, [o, dl, amp, place]);
      }
      const o = {
        len: [24 * pace, 40 * pace], style: pk(r, ['open', 'wide']), center: rr(r, 58, 64),
        extra: (now, horizon) => {
          if (nextDrip < now - 0.5) nextDrip = now + rr(r, 4, 10);
          while (nextDrip < horizon && p.alive(nextDrip)) {
            if (drips && r() < 0.6) drip(nextDrip);
            nextDrip += rr(r, 5, 16);
          }
        }
      };
      chordLoop(p, r, key, H, o, (d, notes, t, len) => {
        tones = notes;
        notes.forEach((m) => padNote(m, t + rr(r, 0, 2), len));
      });
    }

    const BUILD = { glow, keys, drone, tape, air: airy, strings, rain };

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
  let seed = keptSeed() || randomSeed();

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
    engine.tick(ctx.currentTime, 1.5);
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseHidden(); else wake(); });

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
    if (document.hidden) pauseHidden();
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
    return {
      seed: eng.seed,
      pieces: eng.history.map((h) => h.id),
      room: eng.roomSize,
      peakDb: db(peak),
      peakAt,
      rmsDb: db(Math.sqrt(sum / L.length)),
      loudestDb: db(Math.sqrt(loud)),   // the loudest 0.4 s, as RMS
      clipped: peak >= 1
    };
  }

  const api = {
    start: () => start(true), stop, toggle, setVolume, isPlaying: () => playing, wanted, nudge,
    seed: () => seed, setSeed, newSeed: () => setSeed(randomSeed()), keepSeed, keptSeed, piece,
    pieces: Object.keys(PIECE_NAMES).map((id) => ({ id, name: PIECE_NAMES[id] })),
    onchange: null,
    _render: render
  };
  window.NovaAmbient = api;
})();
