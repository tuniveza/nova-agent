/* Nova Ambient: Novacane's quiet, never-ending ambient music for all of Nova Agent.
   Everything is made live with the Web Audio API: no audio files, no libraries,
   no network. Slow warm pads, a soft bass, little star-like bells, now and then a
   short soft electric-piano phrase, a faint ocean of air, all washed in a big
   reverb and kept low so it sits behind everything. Never the same twice: the chords
   wander (each next one chosen from those that follow well, the recent ones less
   likely), every few minutes the mood changes (sparser, starrier, stiller, brighter),
   and the piano's little melodies are made up fresh each time.

   One player for the whole app: it plays in Nova Agent's main page, so it carries on
   while panels open and close. Inside a panel this file just hands over to that one.
   On or off is remembered on the device ("nova-music"); when it was on, it starts
   again on the first tap (browsers only allow sound after a tap).

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
    const here = {
      start: () => main.start(),
      stop: () => main.stop(),
      toggle: () => main.toggle(),
      setVolume: (v) => main.setVolume(v),
      isPlaying: () => main.isPlaying(),
      wanted: () => main.wanted(),
      nudge: () => main.nudge(),
      onchange: null
    };
    window.addEventListener('novaambientchange', (e) => {
      if (typeof here.onchange === 'function') { try { here.onchange(e.detail.on); } catch (err) { /* listener's problem */ } }
    });
    window.NovaAmbient = here;
    return;
  }

  const KEY = 'nova-music';

  // ---- Musical material ---------------------------------------------------
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
  const recent = [];
  let chordName = ['D', 'G', 'Bm', 'A', 'Em'][Math.floor(Math.random() * 5)];
  function nextChord() {
    const options = MOVES[chordName];
    const weights = options.map((n) => 1 / (1 + 2 * recent.filter((r) => r === n).length));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r > weights[i]) r -= weights[i++];
    chordName = options[Math.min(i, options.length - 1)];
    recent.push(chordName);
    if (recent.length > 6) recent.shift();
    return CH[chordName];
  }

  // Moods: every few minutes the music changes its feel (how many stars, how often the piano
  // speaks, how bright the pads are, how long each chord lasts), never the same mood twice running
  const MOODS = {
    glow:   { stars: 1,   phrases: 1,    bright: 1,    len: [16, 24] },
    drift:  { stars: 1.7, phrases: 1.6,  bright: 0.8,  len: [20, 28] },
    starry: { stars: 0.6, phrases: 1.2,  bright: 1.12, len: [14, 22] },
    still:  { stars: 2.4, phrases: 0,    bright: 0.72, len: [24, 32] },
    tender: { stars: 1.2, phrases: 0.65, bright: 0.9,  len: [16, 22] }
  };
  let mood = MOODS.glow;
  let moodName = 'glow';
  let moodUntil = 0;
  function maybeChangeMood(now) {
    if (now < moodUntil) return;
    const names = Object.keys(MOODS).filter((n) => n !== moodName);
    moodName = names[Math.floor(Math.random() * names.length)];
    mood = MOODS[moodName];
    moodUntil = now + rand(150, 300);
  }

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

  const MAX_GAIN = 0.55;     // master level at volume 1 (quiet on purpose: it sits behind everything)
  const FADE_IN = 4;         // seconds
  const FADE_OUT = 2;        // seconds

  // ---- State ----------------------------------------------------------------
  let ctx = null;            // the AudioContext, created on the first start()
  let master, comp, padBus, starBus, reverbIn, bassBus, keysBus;
  let playing = false;
  let volume = 0.4;
  let timer = null;          // lookahead scheduler interval
  let stopTimer = null;      // pending "suspend after fade-out"
  let nextChordAt = 0;
  let nextStarAt = 0;
  let nextPhraseAt = 0;

  // ---- Small helpers --------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

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
  function disposeWhenDone(source, nodes) {
    source.onended = () => {
      for (const n of nodes) { try { n.disconnect(); } catch (e) { /* already gone */ } }
    };
  }

  // ---- Reverb: a procedural "big room" impulse response -----------------------
  // Stereo noise that decays over ~5 s and gets darker as it fades.
  function makeImpulse(seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const k = 0.9 - 0.75 * (i / len);               // brightness falls over time
        smooth += k * ((Math.random() * 2 - 1) - smooth);
        const fadeIn = Math.min(1, i / (rate * 0.01));  // no sharp start
        d[i] = smooth * Math.exp(-6.9 * t / seconds) * (1 - i / len) * fadeIn;
      }
    }
    return buf;
  }

  // ---- Build the mixing desk (once) -------------------------------------------
  function buildGraph() {
    // Master: gentle compressor, then the volume knob.
    master = gain(0);
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.05; comp.release.value = 0.6;
    // A soft top end, like an old tape, so nothing is ever sharp
    const warm = filter('lowpass', 6500, 0.3);
    comp.connect(warm).connect(master);
    master.connect(ctx.destination);

    // Reverb send/return.
    reverbIn = gain(1);
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(5.5);
    const verbOut = gain(0.9);
    reverbIn.connect(verb);
    verb.connect(verbOut);
    verbOut.connect(comp);

    // Pads: a little dry, a lot of reverb.
    padBus = gain(1);
    padBus.connect(gain(0.45)).connect(comp);
    padBus.connect(gain(0.9)).connect(reverbIn);

    // Bass goes mostly dry so it stays round and clear.
    bassBus = gain(1);
    bassBus.connect(comp);
    bassBus.connect(gain(0.2)).connect(reverbIn);

    // Stars: dry + a soft, darkened echo + reverb.
    starBus = gain(1);
    starBus.connect(gain(0.6)).connect(comp);
    starBus.connect(gain(0.6)).connect(reverbIn);
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.52;                 // roughly a dotted eighth
    const echoTone = filter('lowpass', 2200, 0.3);
    const echoOut = gain(0.5);
    starBus.connect(delay).connect(echoTone).connect(gain(0.35)).connect(delay); // feedback loop
    echoTone.connect(echoOut);
    echoOut.connect(comp);
    echoOut.connect(reverbIn);

    // Keys: the electric piano, mostly into the echo and reverb
    keysBus = gain(1);
    keysBus.connect(gain(0.5)).connect(comp);
    keysBus.connect(gain(0.7)).connect(reverbIn);
    keysBus.connect(gain(0.45)).connect(delay);

    buildAir();
  }

  // ---- Air / ocean bed: filtered noise that slowly breathes ------------------
  function buildAir() {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
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

    src.connect(hp).connect(lp).connect(level);
    level.connect(comp);
    level.connect(reverbIn);
    src.start(); swell.start(); drift.start();
  }

  // ---- Pads: one voice = two detuned saws (filtered) + a pure sine ----------
  function padVoice(midi, t, hold, pan) {
    const f = mtof(midi);
    const out = gain(0);
    const place = panner(pan);
    out.connect(place).connect(padBus);

    // Warm low-pass with its own slow wobble.
    const lp = filter('lowpass', rand(750, 1300) * mood.bright, 0.4);
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

  // ---- Bass: a quiet sine, plus its octave so phone speakers can hear it ----
  function bassNote(midi, t, hold) {
    const f = mtof(midi);
    const out = gain(0);
    out.connect(bassBus);
    const sub = osc('sine', f);
    const upper = osc('sine', f * 2);
    const upperAmt = gain(0.35);
    sub.connect(out);
    upper.connect(upperAmt).connect(out);
    const end = envelope(out, t, 0.07, 4, hold, 5);
    sub.start(t); upper.start(t);
    sub.stop(end); upper.stop(end);
    disposeWhenDone(sub, [out, sub, upper, upperAmt]);
  }

  // ---- A whole chord: pads spread across the stereo field + bass -------------
  function playChord(chord, t, length) {
    let notes = chord.notes.slice();
    // Now and then leave out an inner note so the texture breathes.
    if (Math.random() < 0.3) notes.splice(1 + Math.floor(Math.random() * (notes.length - 2)), 1);
    notes.forEach((m, i) => {
      const pan = (i / (notes.length - 1) - 0.5) * 1.1 + rand(-0.1, 0.1);
      padVoice(m, t + rand(0, 0.6), length, pan);
    });
    bassNote(chord.bass, t, length);
  }

  // ---- Stars: a soft bell (sine + quieter triangle an octave up) -------------
  function playStar(t) {
    const f = mtof(pick(STARS));
    const place = panner(rand(-0.7, 0.7));
    place.connect(starBus);

    const body = gain(0);
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(0.03, t + 0.01);
    body.gain.setTargetAtTime(0, t + 0.012, rand(0.6, 1.2));

    const shine = gain(0);
    shine.gain.setValueAtTime(0, t);
    shine.gain.linearRampToValueAtTime(0.008, t + 0.006);
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

  // ---- Keys: a soft electric piano (FM: a sine "tine" that mellows as it rings) ----
  function keyNote(midi, t, pan, level) {
    const f = mtof(midi);
    const place = panner(pan);
    place.connect(keysBus);
    const amp = gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(level, t + 0.012);
    amp.gain.setTargetAtTime(0, t + 0.02, rand(0.9, 1.5));
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

  // A new little melody each time: a few notes moving mostly by step through the scale, ending on
  // a note of the chord underneath. Now and then (rarely) one of Novacane's own phrases instead.
  const SCALE = [62, 64, 66, 68, 69, 71, 73, 74, 76, 78, 81];
  function newPhrase() {
    if (Math.random() < 0.12) return pick(PHRASES);
    const count = 3 + Math.floor(Math.random() * 3);
    let i = 2 + Math.floor(Math.random() * 6);
    const notes = [];
    for (let n = 0; n < count; n++) {
      notes.push(SCALE[i]);
      const leap = Math.random() < 0.2 ? 2 : 1;
      i = Math.max(0, Math.min(SCALE.length - 1, i + (Math.random() < 0.5 ? -leap : leap)));
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
      keyNote(m, at, -0.4 + (0.8 * i) / Math.max(1, notes.length - 1), rand(0.016, 0.024));
      at += rand(0.45, 0.9);
    });
    // Sometimes the last note gets a soft lower partner
    if (Math.random() < 0.5) keyNote(notes[notes.length - 1] - 12, at - 0.2, 0, 0.012);
  }

  // ---- Lookahead scheduler -----------------------------------------------------
  // Every 200 ms, book any chords/stars due in the next moment using the audio
  // clock (which keeps perfect time even if the timer itself is late). When the
  // page is hidden, timers get throttled, so we plan further ahead.
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const ahead = document.hidden ? 30 : 1.5;

    // If we fell far behind (e.g. after a pause), start fresh instead of piling up.
    if (nextChordAt < now - 0.5) nextChordAt = now + 0.1;
    if (nextStarAt < now - 0.5) nextStarAt = now + rand(1, 3);
    if (nextPhraseAt < now - 0.5) nextPhraseAt = now + rand(12, 25);

    maybeChangeMood(now);
    while (nextChordAt < now + ahead) {
      const length = rand(mood.len[0], mood.len[1]);
      playChord(nextChord(), nextChordAt, length);
      nextChordAt += length;
    }
    while (nextStarAt < now + ahead) {
      playStar(nextStarAt);
      // Sometimes a second star answers the first.
      if (Math.random() < 0.3) playStar(nextStarAt + rand(0.2, 0.45));
      nextStarAt += rand(2, 7) * mood.stars;
    }
    while (nextPhraseAt < now + ahead) {
      if (mood.phrases) playPhrase(nextPhraseAt);
      nextPhraseAt += rand(26, 48) * (mood.phrases || 1.5);
    }
  }

  // ---- Context setup (lazy, inside a user gesture for iOS) --------------------
  function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    // Let iOS treat this as media playback (plays with the ringer switch off).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }
    buildGraph();
    nextChordAt = ctx.currentTime + 0.1;
    nextStarAt = ctx.currentTime + 3;
    nextPhraseAt = ctx.currentTime + rand(10, 18);
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

  // If the OS interrupted us (phone call, other app), try again on the next tap.
  function wake() {
    if (playing && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('touchend', wake, { capture: true, passive: true });
  document.addEventListener('keydown', wake, true);
  // Keep playing in the background; just nudge it awake when we come back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });

  function setPlaying(value) {
    if (playing === value) return;
    playing = value;
    if (typeof api.onchange === 'function') {
      try { api.onchange(playing); } catch (e) { /* listener's problem, not ours */ }
    }
    tellEveryPage(playing);
  }

  // Tell this page and every panel inside it (they show the music switch too)
  function tellEveryPage(on) {
    (function tell(w) {
      try { w.dispatchEvent(new w.CustomEvent('novaambientchange', { detail: { on } })); } catch (e) { return; }
      for (let i = 0; i < w.frames.length; i++) tell(w.frames[i]);
    })(window);
  }

  // On or off, remembered on this device (Portal's old switch, "novahub-music", counts too)
  function wanted() {
    try {
      const v = localStorage.getItem(KEY);
      if (v) return v === 'on';
      return localStorage.getItem('novahub-music') === '1';
    } catch (e) { return false; }
  }
  function remember(on) {
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* private window */ }
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
    if (save) remember(true);
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
    if (!timer) timer = setInterval(tick, 200);
    tick();
    glide(master.gain, volume * MAX_GAIN, FADE_IN);
    starting = false;
    setPlaying(true);
  }

  function stop() {
    remember(false);
    if (!ctx || !playing) return;
    setPlaying(false);
    glide(master.gain, 0, FADE_OUT);
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
    if (ctx && playing) glide(master.gain, volume * MAX_GAIN, 0.4);
  }

  // The saved volume (Portal's Options → Ambient music volume; 40 out of 100 to begin with)
  try {
    const saved = JSON.parse(localStorage.getItem('novahub-options') || '{}').volume;
    volume = (typeof saved === 'number' ? saved : 40) / 100;
  } catch (e) { volume = 0.4; }
  window.addEventListener('storage', (e) => {
    if (e.key !== 'novahub-options') return;
    try { const v = JSON.parse(e.newValue || '{}').volume; if (typeof v === 'number') setVolume(v / 100); } catch (err) { /* ignore */ }
  });

  const api = { start: () => start(true), stop, toggle, setVolume, isPlaying: () => playing, wanted, nudge, onchange: null };
  window.NovaAmbient = api;
})();
