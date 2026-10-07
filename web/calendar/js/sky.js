/* Nova Calendar — sky.js
   The real sky behind the calendar: moon phases, solstices and equinoxes, plus the dates of
   seasonal days (Easter, Mothering Sunday, Bonfire Night…) and meteor-shower peaks.
   Moon phases and seasons use Jean Meeus' "Astronomical Algorithms" (ch. 27 and 49), which is
   accurate to a few minutes. That is plenty for deciding which calendar day a phase falls on. */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});
  const DEG = Math.PI / 180;
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymd = (y, m, d) => keyOf(new Date(y, m - 1, d));
  const jdToMs = (jd) => (jd - 2440587.5) * 86400000;

  // ---------- MOON ----------

  // Time of one principal phase. k counts lunations from Jan 2000; .0 new, .25 first quarter, .5 full, .75 last quarter.
  function phaseJDE(k) {
    const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * DEG;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * DEG;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * DEG;
    const q = ((k % 1) + 1) % 1;
    const s = Math.sin;
    let c;
    if (q < 0.01) {
      c = -0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F)
        + 0.00739 * E * s(Mp - M) - 0.00514 * E * s(Mp + M) + 0.00208 * E * E * s(2 * M);
    } else if (Math.abs(q - 0.5) < 0.01) {
      c = -0.40614 * s(Mp) + 0.17302 * E * s(M) + 0.01614 * s(2 * Mp) + 0.01043 * s(2 * F)
        + 0.00734 * E * s(Mp - M) - 0.00515 * E * s(Mp + M) + 0.00209 * E * E * s(2 * M);
    } else {
      c = -0.62801 * s(Mp) + 0.17172 * E * s(M) - 0.01183 * E * s(Mp + M) + 0.00862 * s(2 * Mp)
        + 0.00804 * s(2 * F) + 0.00454 * E * s(Mp - M) + 0.00204 * E * E * s(2 * M);
      const cos = Math.cos;
      const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M)
        + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
      c += q < 0.5 ? W : -W;
    }
    return jde + c - 0.0008; // TT → UT, near enough
  }

  const PRINCIPAL = ['New moon', 'First quarter', 'Full moon', 'Last quarter'];
  // Traditional full-moon names, by the month the full moon falls in
  const FULL_NAMES = ['Wolf Moon', 'Snow Moon', 'Worm Moon', 'Pink Moon', 'Flower Moon', 'Strawberry Moon',
    'Buck Moon', 'Sturgeon Moon', 'Harvest Moon', "Hunter's Moon", 'Beaver Moon', 'Cold Moon'];

  // Every principal phase that touches a year (plus a margin either side), oldest first
  const phaseCache = new Map();
  function phasesAround(year) {
    if (phaseCache.has(year)) return phaseCache.get(year);
    const k0 = Math.floor((year - 2000) * 12.3685) - 2;
    const list = [];
    for (let k = k0; k < k0 + 17; k++) {
      for (let i = 0; i < 4; i++) {
        const ms = jdToMs(phaseJDE(k + i / 4));
        list.push({ ms, q: i / 4, name: PRINCIPAL[i] });
      }
    }
    list.sort((a, b) => a.ms - b.ms);
    phaseCache.set(year, list);
    return list;
  }

  // Phase on a calendar day: fraction (0 new → .5 full → 1 new), light, name, and whether a principal phase happens that day
  function moon(key) {
    const [y, m, d] = key.split('-').map(Number);
    const start = new Date(y, m - 1, d).getTime();
    const end = new Date(y, m - 1, d + 1).getTime();
    const noon = new Date(y, m - 1, d, 12).getTime();
    const list = phasesAround(y);
    let principal = null;
    let prev = list[0], next = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.ms >= start && p.ms < end) principal = p;
      if (p.ms <= noon) prev = p;
      if (p.ms > noon) { next = p; break; }
    }
    // Fraction is interpolated between the real phases either side, so the icon agrees with the label
    let span = next.q - prev.q;
    if (span <= 0) span += 1;
    let fraction = prev.q + span * ((noon - prev.ms) / (next.ms - prev.ms || 1));
    fraction = ((fraction % 1) + 1) % 1;
    if (principal) fraction = principal.q;
    const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
    let name;
    if (principal) name = principal.name;
    else if (fraction < 0.25) name = 'Waxing crescent';
    else if (fraction < 0.5) name = 'Waxing gibbous';
    else if (fraction < 0.75) name = 'Waning gibbous';
    else name = 'Waning crescent';
    const fullName = principal && principal.q === 0.5 ? FULL_NAMES[m - 1] : null;
    return { fraction, illumination, name, principal: principal ? principal.name : null, fullName,
      at: principal ? new Date(principal.ms) : null };
  }

  // Moon drawn as an SVG: dark disc plus the lit part, terminator as a half-ellipse
  function moonSVG(f, size = 16) {
    const r = 10, cx = 12, cy = 12;
    const rx = Math.abs(Math.cos(2 * Math.PI * f)) * r;
    let d;
    if (f < 0.5) {
      // waxing: lit on the right
      d = `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx.toFixed(2)} ${r} 0 0 ${f < 0.25 ? 0 : 1} ${cx} ${cy - r}Z`;
    } else {
      // waning: lit on the left
      d = `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}A${rx.toFixed(2)} ${r} 0 0 ${f < 0.75 ? 0 : 1} ${cx} ${cy - r}Z`;
    }
    return `<svg class="moon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><circle cx="12" cy="12" r="10" class="moon-dark"/><path d="${d}" class="moon-lit"/></svg>`;
  }

  // ---------- SEASONS ----------

  // Mean equinox/solstice (Meeus table 27.B, good for 1000–3000 within minutes). 0 March, 1 June, 2 Sept, 3 Dec
  function seasonKey(year, which) {
    const Y = (year - 2000) / 1000;
    const t = [
      [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
      [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
      [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
      [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032]
    ][which];
    const jde = t[0] + t[1] * Y + t[2] * Y * Y + t[3] * Y ** 3 + t[4] * Y ** 4;
    return keyOf(new Date(jdToMs(jde)));
  }

  // Easter Sunday (anonymous Gregorian algorithm)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }

  // nth weekday of a month, e.g. third Sunday of June. weekday 0 = Sunday
  function nthWeekday(y, month, weekday, n) {
    const first = new Date(y, month - 1, 1);
    const day = 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7;
    return ymd(y, month, day);
  }

  // Seasonal and cosmic days for a year. UK-flavoured, like Novacane.
  const seasonalCache = new Map();
  function seasonal(year) {
    if (seasonalCache.has(year)) return seasonalCache.get(year);
    const e = easter(year);
    const fromEaster = (n) => keyOf(new Date(e.getFullYear(), e.getMonth(), e.getDate() + n));
    const list = [
      [ymd(year, 1, 1), 'newyear', "New Year's Day"],
      [ymd(year, 1, 3), 'meteor', 'Quadrantids peak'],
      [ymd(year, 2, 14), 'valentines', "Valentine's Day"],
      [fromEaster(-47), 'pancake', 'Pancake Day'],
      [ymd(year, 3, 17), 'stpatricks', "St Patrick's Day"],
      [fromEaster(-21), 'mothers', 'Mothering Sunday'],
      [seasonKey(year, 0), 'equinox', 'March Equinox', { theme: 'aurora' }],
      [fromEaster(0), 'easter', 'Easter Sunday'],
      [ymd(year, 4, 22), 'meteor', 'Lyrids peak'],
      [nthWeekday(year, 6, 0, 3), 'fathers', "Father's Day"],
      [seasonKey(year, 1), 'solstice', 'June Solstice', { theme: 'solar', aesthetic: 'supernova' }],
      [ymd(year, 8, 12), 'meteor', 'Perseids peak'],
      [seasonKey(year, 2), 'equinox', 'September Equinox', { theme: 'quasar' }],
      [ymd(year, 10, 21), 'meteor', 'Orionids peak'],
      [ymd(year, 10, 31), 'halloween', 'Halloween'],
      [ymd(year, 11, 5), 'bonfire', 'Bonfire Night'],
      [ymd(year, 11, 17), 'meteor', 'Leonids peak'],
      [ymd(year, 12, 14), 'meteor', 'Geminids peak'],
      [seasonKey(year, 3), 'solstice', 'December Solstice', { theme: 'pulsar', aesthetic: 'celestial' }],
      [ymd(year, 12, 24), 'christmas', 'Christmas Eve'],
      [ymd(year, 12, 25), 'christmas', 'Christmas Day'],
      [ymd(year, 12, 26), 'christmas', 'Boxing Day'],
      [ymd(year, 12, 31), 'newyear', "New Year's Eve"]
    ];
    const map = new Map();
    for (const [date, preset, title, extra] of list) {
      if (!map.has(date)) map.set(date, []);
      map.get(date).push({ date, preset, title, ...(extra || {}) });
    }
    seasonalCache.set(year, map);
    return map;
  }

  const seasonalOn = (key) => seasonal(Number(key.slice(0, 4))).get(key) || [];

  NT.sky = { moon, moonSVG, seasonalOn, easter };
})();
