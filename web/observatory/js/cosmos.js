/* Nova Observatory — cosmos.js (shared with Nova Calendar)
   Seeded generative space art. Every note card and day card gets its own picture, painted on a canvas
   from one number (the seed) and the colours of a theme. The same seed and theme always give the
   same picture, so nothing but the seed needs saving.
   Subjects: planet, galaxy, nebula, binary, comet, blackhole, constellation, eclipse, supernova,
   orbit, aurora, crescent. */
(function () {
  'use strict';
  const NO = (window.NO = window.NO || {});
  const TAU = Math.PI * 2;

  // ---------- SEEDS AND COLOUR HELPERS ----------

  // Text → 32-bit number (cyrb53, folded)
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h1 ^ h2) >>> 0;
  }

  // Seeded random numbers in [0, 1) (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hexRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  };
  const mix = (h1, h2, t) => {
    const a = hexRgb(h1), b = hexRgb(h2);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };

  // ---------- DRAWING PRIMITIVES ----------

  function glow(ctx, x, y, rad, color, alpha) {
    if (rad <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
  }

  // A bright star with a soft halo and diffraction spikes
  function glint(ctx, x, y, s, color) {
    glow(ctx, x, y, s * 7, color, 0.5);
    glow(ctx, x, y, s * 2, '#ffffff', 0.95);
    ctx.lineWidth = Math.max(0.6, s * 0.35);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const L = s * 11;
      const g = ctx.createLinearGradient(x - dx * L, y - dy * L, x + dx * L, y + dy * L);
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.5, rgba('#ffffff', 0.85));
      g.addColorStop(1, rgba(color, 0));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - dx * L, y - dy * L);
      ctx.lineTo(x + dx * L, y + dy * L);
      ctx.stroke();
    }
  }

  // Four-pointed sparkle
  function sparkle(ctx, x, y, s, c) {
    glow(ctx, x, y, s * 2, c, 0.3);
    ctx.fillStyle = rgba(c, 0.95);
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x, y, x + s, y);
    ctx.quadraticCurveTo(x, y, x, y + s);
    ctx.quadraticCurveTo(x, y, x - s, y);
    ctx.quadraticCurveTo(x, y, x, y - s);
    ctx.fill();
  }

  // ---------- LAYERS EVERY PICTURE SHARES ----------

  function background({ ctx, w, h, r, R, pick, pal, S }) {
    const g = ctx.createLinearGradient(0, 0, w * R(0.3, 1), h);
    g.addColorStop(0, pal.void);
    g.addColorStop(1, mix(pal.void, pal.accent3, 0.6));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Nebula clouds, screened so they brighten each other
    ctx.globalCompositeOperation = 'screen';
    const cols = [pal.accent, pal.accent2, pal.accent3, pal.hi, pal.lilac];
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const x = R(-0.1, 1.1) * w, y = R(-0.1, 1.1) * h, rad = R(0.35, 0.9) * Math.max(w, h), c = pick(cols);
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rad);
      gg.addColorStop(0, rgba(c, R(0.22, 0.45)));
      gg.addColorStop(0.45, rgba(c, R(0.05, 0.14)));
      gg.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(0, 0, w, h);
    }
    // Wispy filaments: soft dots along a wandering path
    const lanes = 1 + Math.floor(r() * 3);
    for (let l = 0; l < lanes; l++) {
      const c = pick([pal.hi, pal.soft, pal.lilac, pal.accent]);
      let x = R(0, w), y = R(0, h), a = R(0, TAU);
      for (let i = 0; i < 60; i++) {
        a += R(-0.4, 0.4);
        x += Math.cos(a) * S * 0.03;
        y += Math.sin(a) * S * 0.03;
        glow(ctx, x, y, R(0.04, 0.13) * S, c, R(0.03, 0.08));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Dark dust for depth
    for (let i = 0; i < 4; i++) glow(ctx, R(0, w), R(0, h), R(0.15, 0.4) * S, pal.void, R(0.25, 0.5));
  }

  function stars({ ctx, w, h, r, R, pick, pal }) {
    const cols = ['#ffffff', pal.soft, pal.lilac, pal.gold];
    const n = Math.round((w * h) / 900);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rgba(pick(cols), R(0.25, 1));
      const s = Math.pow(r(), 3) * 1.3 + 0.25;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, s, 0, TAU);
      ctx.fill();
    }
    const b = 3 + Math.floor(r() * 5);
    for (let i = 0; i < b; i++) glint(ctx, r() * w, r() * h, R(0.8, 2), pick([pal.hi, pal.soft, pal.lilac, pal.gold]));
  }

  function vignette({ ctx, w, h, pal }) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, rgba(pal.void, 0));
    g.addColorStop(1, rgba(pal.void, 0.72));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // ---------- SUBJECTS ----------

  function planet(P, opts = {}) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const rad = S * R(0.2, 0.3) * (opts.scale || 1);
    const cx = w * R(0.32, 0.68), cy = h * R(0.38, 0.62);
    const base = pick([pal.accent, pal.accent2, pal.hi, pal.lilac, pal.gold]);
    const ringed = opts.ringed ?? r() < 0.6;
    const tilt = R(-0.45, 0.45);
    const rx = rad * R(1.75, 2.3), ry = rx * R(0.14, 0.3);
    const ringCol = pick([pal.soft, pal.gold, pal.hi, pal.lilac]);
    const rings = Array.from({ length: 16 }, (_, i) => ({ k: 0.62 + i * 0.025, a: R(0.04, 0.32), lw: R(0.8, 3) }));
    const unit = S / 360;

    // back half of the ring goes behind the planet, front half over it
    const ring = (front) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      for (const q of rings) {
        ctx.strokeStyle = rgba(ringCol, q.a);
        ctx.lineWidth = q.lw * unit;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx * q.k, ry * q.k, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
        ctx.stroke();
      }
      ctx.restore();
    };

    const orbitTilt = tilt * 0.6;
    if (opts.orbits) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(orbitTilt);
      ctx.setLineDash([2 * unit, 6 * unit]);
      ctx.lineWidth = unit;
      for (let i = 0; i < 3; i++) {
        const k = 2.6 + i * 0.9;
        ctx.strokeStyle = rgba(pal.soft, 0.3 - i * 0.06);
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * k, rad * k * 0.34, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    glow(ctx, cx, cy, rad * 1.8, base, 0.28);
    if (ringed) ring(false);

    // body, lit from the top left
    const lx = cx - rad * 0.45, ly = cy - rad * 0.5;
    const body = ctx.createRadialGradient(lx, ly, rad * 0.05, cx, cy, rad * 1.02);
    body.addColorStop(0, mix(base, '#ffffff', 0.6));
    body.addColorStop(0.4, base);
    body.addColorStop(0.85, mix(base, pal.void, 0.75));
    body.addColorStop(1, pal.void);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    const bands = 6 + Math.floor(r() * 7);
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = rgba(pick([pal.soft, pal.accent3, pal.void, pal.gold, pal.hi]), R(0.05, 0.16));
      ctx.beginPath();
      ctx.ellipse(0, R(-rad, rad), rad * 1.2, R(0.03, 0.16) * rad, 0, 0, TAU);
      ctx.fill();
    }
    ctx.rotate(-tilt);
    const sh = ctx.createLinearGradient(-rad * 0.6, -rad * 0.6, rad, rad);
    sh.addColorStop(0, rgba(pal.void, 0));
    sh.addColorStop(0.55, rgba(pal.void, 0.35));
    sh.addColorStop(1, rgba(pal.void, 0.92));
    ctx.fillStyle = sh;
    ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();

    // thin atmosphere on the lit edge
    ctx.save();
    ctx.strokeStyle = rgba(mix(base, '#ffffff', 0.4), 0.55);
    ctx.lineWidth = Math.max(1, rad * 0.025);
    ctx.shadowColor = base;
    ctx.shadowBlur = rad * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, Math.PI * 0.75, Math.PI * 1.75);
    ctx.stroke();
    ctx.restore();

    if (ringed) ring(true);

    // moons: on the orbits if drawn, else free-floating
    const moons = opts.orbits ? 3 : r() < 0.55 ? 1 : 0;
    for (let i = 0; i < moons; i++) {
      let mx, my;
      if (opts.orbits) {
        const a = R(0.15, Math.PI - 0.15), k = 2.6 + i * 0.9;
        const ox = Math.cos(a) * rad * k, oy = Math.sin(a) * rad * k * 0.34;
        mx = cx + ox * Math.cos(orbitTilt) - oy * Math.sin(orbitTilt);
        my = cy + ox * Math.sin(orbitTilt) + oy * Math.cos(orbitTilt);
      } else {
        const a = R(0, TAU), k = R(1.9, 2.8);
        mx = cx + Math.cos(a) * rad * k;
        my = cy + Math.sin(a) * rad * k * 0.7;
      }
      const mr = rad * R(0.07, 0.13);
      const mg = ctx.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, mr * 0.1, mx, my, mr);
      mg.addColorStop(0, pal.soft);
      mg.addColorStop(1, mix(pal.lilac, pal.void, 0.7));
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, TAU);
      ctx.fill();
    }
  }

  function galaxy(P) {
    const { ctx, w, h, r, R, pal, S } = P;
    const cx = w * R(0.35, 0.65), cy = h * R(0.38, 0.62);
    const R0 = S * R(0.42, 0.55);
    const arms = 2 + Math.floor(r() * 3);
    const twist = R(3, 6);
    const squash = R(0.35, 0.8);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(R(0, Math.PI));
    ctx.scale(1, squash);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 0, 0, R0 * 1.1, pal.accent2, 0.25);
    glow(ctx, 0, 0, R0 * 0.6, pal.hi, 0.18);
    const cols = [pal.hi, pal.lilac, pal.soft, pal.accent];
    for (let i = 0; i < 2600; i++) {
      const t = Math.pow(r(), 0.6);
      const arm = Math.floor(r() * arms);
      const ang = t * twist + (arm * TAU) / arms + (r() - 0.5) * (0.9 - t * 0.5);
      const d = t * R0 + (r() - 0.5) * R0 * 0.08;
      const c = t < 0.22 ? pal.gold : cols[Math.floor(r() * cols.length)];
      ctx.fillStyle = rgba(c, 0.2 + r() * 0.55 * (1 - t * 0.6));
      const s = r() * 1.4 + 0.3;
      ctx.fillRect(Math.cos(ang) * d, Math.sin(ang) * d, s, s);
    }
    glow(ctx, 0, 0, R0 * 0.25, pal.gold, 0.75);
    glow(ctx, 0, 0, R0 * 0.08, '#ffffff', 1);
    ctx.restore();
  }

  function nebula(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const cx = w * R(0.3, 0.7), cy = h * R(0.3, 0.7);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 42; i++) {
      const a = R(0, TAU), d = Math.pow(r(), 1.5) * S * 0.45;
      glow(ctx, cx + Math.cos(a) * d * 1.5, cy + Math.sin(a) * d, R(0.05, 0.2) * S,
        pick([pal.hi, pal.accent, pal.lilac, pal.soft, pal.accent2]), R(0.05, 0.14));
    }
    ctx.globalCompositeOperation = 'source-over';
    // dark pillars rising from the bottom edge
    const pillars = 2 + Math.floor(r() * 2);
    for (let p = 0; p < pillars; p++) {
      let x = R(0.1, 0.9) * w, y = h + S * 0.05;
      for (let i = 0; i < 32; i++) {
        x += (r() - 0.5) * S * 0.04;
        y -= h * 0.02;
        const rad = S * (0.12 - i * 0.003);
        glow(ctx, x, y, Math.max(rad, S * 0.02), pal.void, 0.22);
        if (i > 26) glow(ctx, x, y - rad * 0.4, rad * 0.6, pal.hi, 0.05);
      }
    }
    // young star cluster
    const n = 6 + Math.floor(r() * 7);
    for (let i = 0; i < n; i++) glint(ctx, cx + R(-0.15, 0.15) * S, cy + R(-0.12, 0.12) * S, R(0.6, 1.8), pick([pal.soft, pal.lilac, '#ffffff']));
  }

  function binary(P) {
    const { ctx, w, h, R, pal, S } = P;
    const cx = w * R(0.4, 0.6), cy = h * R(0.4, 0.6);
    const sep = S * R(0.22, 0.32), ang = R(-0.6, 0.6);
    const ax = cx - Math.cos(ang) * sep * 0.6, ay = cy - Math.sin(ang) * sep * 0.6;
    const bx = cx + Math.cos(ang) * sep * 0.4, by = cy + Math.sin(ang) * sep * 0.4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.setLineDash([3, 7]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(pal.soft, 0.28);
    ctx.beginPath();
    ctx.ellipse(0, 0, sep * 0.6, sep * 0.2, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, sep * 0.4, sep * 0.13, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    // gas streaming from one star to the other
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, rgba(pal.gold, 0.5));
    g.addColorStop(1, rgba(pal.hi, 0.6));
    ctx.strokeStyle = g;
    ctx.lineWidth = S * 0.014;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx + Math.sin(ang) * sep * 0.4, cy - Math.cos(ang) * sep * 0.4, bx, by);
    ctx.stroke();
    glow(ctx, ax, ay, S * 0.32, pal.gold, 0.45);
    glow(ctx, ax, ay, S * 0.07, '#ffffff', 0.95);
    glow(ctx, bx, by, S * 0.22, pal.hi, 0.5);
    glow(ctx, bx, by, S * 0.04, '#ffffff', 0.95);
    ctx.globalCompositeOperation = 'source-over';
    glint(ctx, ax, ay, 3, pal.gold);
    glint(ctx, bx, by, 2, pal.hi);
  }

  function comet(P) {
    const { ctx, w, h, R, pal, S } = P;
    const hx = w * R(0.58, 0.8), hy = h * R(0.3, 0.6);
    const ang = R(Math.PI * 0.85, Math.PI * 1.2);
    const L = Math.max(w, h) * R(0.55, 0.8);
    const unit = S / 360;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // broad curved dust tail
    const curve = R(0.05, 0.15), fan = R(0.18, 0.3);
    for (let i = 0; i < 36; i++) {
      const spread = (i / 35 - 0.5) * fan;
      const ex = hx + Math.cos(ang + spread) * L, ey = hy + Math.sin(ang + spread) * L;
      const mx = hx + Math.cos(ang + spread * 0.3 + curve) * L * 0.5, my = hy + Math.sin(ang + spread * 0.3 + curve) * L * 0.5;
      const g = ctx.createLinearGradient(hx, hy, ex, ey);
      g.addColorStop(0, rgba(pal.soft, 0.22));
      g.addColorStop(1, rgba(pal.gold, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = R(1, 4) * unit;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
    }
    // straight ion tail
    const ia = ang + R(-0.12, 0.12);
    for (let i = 0; i < 8; i++) {
      const s = (i / 7 - 0.5) * 0.04;
      const ex = hx + Math.cos(ia + s) * L * 1.1, ey = hy + Math.sin(ia + s) * L * 1.1;
      const g = ctx.createLinearGradient(hx, hy, ex, ey);
      g.addColorStop(0, rgba(pal.hi, 0.4));
      g.addColorStop(1, rgba(pal.hi, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.2 * unit;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    glow(ctx, hx, hy, S * 0.12, pal.gold, 0.5);
    glow(ctx, hx, hy, S * 0.03, '#ffffff', 1);
    ctx.globalCompositeOperation = 'source-over';
    glint(ctx, hx, hy, 2.2, pal.soft);
  }

  function blackhole(P) {
    const { ctx, w, h, R, pal, S } = P;
    const cx = w * R(0.4, 0.6), cy = h * R(0.42, 0.58);
    const rad = S * R(0.1, 0.13), tilt = R(-0.25, 0.25);
    const rx = rad * 3.4, flat = R(0.16, 0.26);
    const cols = ['#ffffff', pal.gold, pal.hi, pal.accent, pal.accent2];
    const disk = (front) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 70; i++) {
        const t = i / 69;
        const k = 1.25 + t * (rx / rad - 1.25);
        ctx.strokeStyle = rgba(cols[Math.min(cols.length - 1, Math.floor(t * cols.length))], (1 - t) * 0.22 + 0.03);
        ctx.lineWidth = rad * 0.06;
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * k, rad * k * flat, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
        ctx.stroke();
      }
      ctx.restore();
    };
    glow(ctx, cx, cy, rad * 4.5, pal.accent, 0.25);
    disk(false);
    // light bent round the hole
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      ctx.strokeStyle = rgba(i < 6 ? pal.gold : pal.hi, 0.25 * (1 - i / 24));
      ctx.lineWidth = rad * 0.05;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * (1.08 + i * 0.03), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = rgba('#ffffff', 0.85);
    ctx.lineWidth = Math.max(1, rad * 0.03);
    ctx.shadowColor = pal.gold;
    ctx.shadowBlur = rad * 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 1.02, 0, TAU);
    ctx.stroke();
    ctx.restore();
    disk(true);
  }

  function constellation(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const n = 5 + Math.floor(r() * 4);
    const pts = [];
    for (let tries = 0; pts.length < n && tries < 500; tries++) {
      const p = { x: R(0.12, 0.88) * w, y: R(0.15, 0.85) * h };
      if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > S * 0.16)) pts.push(p);
    }
    // star-chart rings and meridians
    ctx.strokeStyle = rgba(pal.lilac, 0.12);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, S * 0.22 * i, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();
    // join the stars nearest-first, like a drawn asterism
    const order = [pts[0]];
    const rest = pts.slice(1);
    while (rest.length) {
      const last = order[order.length - 1];
      let bi = 0, bd = Infinity;
      rest.forEach((q, i) => {
        const d = Math.hypot(q.x - last.x, q.y - last.y);
        if (d < bd) { bd = d; bi = i; }
      });
      order.push(rest.splice(bi, 1)[0]);
    }
    ctx.strokeStyle = rgba(pal.soft, 0.55);
    ctx.lineWidth = Math.max(1, S / 300);
    ctx.setLineDash([S * 0.012, S * 0.018]);
    ctx.beginPath();
    order.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (order.length > 3 && r() < 0.6) {
      const a = order[1 + Math.floor(r() * (order.length - 2))];
      const b = order[Math.floor(r() * order.length)];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    order.forEach((p) => glint(ctx, p.x, p.y, R(1, 2.4), pick([pal.hi, pal.soft, pal.gold])));
  }

  function eclipse(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const cx = w * R(0.4, 0.6), cy = h * R(0.42, 0.58);
    const rad = S * R(0.17, 0.22);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, cx, cy, rad * 2.8, pal.gold, 0.35);
    glow(ctx, cx, cy, rad * 1.8, pal.hi, 0.2);
    ctx.lineCap = 'round';
    for (let i = 0; i < 240; i++) {
      const a = R(0, TAU), L = rad * (1.15 + Math.pow(r(), 2) * 1.6);
      const g = ctx.createLinearGradient(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      const c = pick([pal.soft, pal.gold, pal.hi]);
      g.addColorStop(0, rgba(c, R(0.08, 0.2)));
      g.addColorStop(1, rgba(c, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = R(0.6, 2);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#030203';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.strokeStyle = rgba('#ffffff', 0.9);
    ctx.lineWidth = 1.4;
    ctx.shadowColor = pal.gold;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // the "diamond ring" bead of sunlight
    if (r() < 0.65) {
      const a = R(0, TAU);
      glint(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, 3.2, pal.gold);
    }
  }

  function supernova(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const cx = w * R(0.42, 0.58), cy = h * R(0.42, 0.58);
    const R0 = S * R(0.32, 0.42);
    // lumpy shell: radius wobbles with a few random harmonics
    const lobes = Array.from({ length: 4 }, () => ({ n: 2 + Math.floor(r() * 6), a: R(0.03, 0.12), p: R(0, TAU) }));
    const shape = (a) => 1 + lobes.reduce((s, l) => s + l.a * Math.sin(l.n * a + l.p), 0);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, cx, cy, R0 * 1.6, pal.accent, 0.35);
    glow(ctx, cx, cy, R0 * 1.1, pal.hi, 0.22);
    ctx.lineCap = 'round';
    for (let i = 0; i < 140; i++) {
      const a = R(0, TAU), L = R0 * R(0.4, 1.5);
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      const c = pick([pal.soft, pal.gold, pal.hi]);
      g.addColorStop(0, rgba(c, R(0.15, 0.35)));
      g.addColorStop(1, rgba(c, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = R(0.5, 2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      ctx.stroke();
    }
    const cols = [pal.hi, pal.accent, pal.lilac, pal.gold, pal.soft];
    for (let i = 0; i < 2200; i++) {
      const a = R(0, TAU);
      const d = R0 * shape(a) * (0.82 + ((r() + r() + r()) / 3) * 0.36);
      ctx.fillStyle = rgba(cols[Math.floor(r() * cols.length)], R(0.15, 0.6));
      const s = R(0.5, 1.8);
      ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, s);
    }
    glow(ctx, cx, cy, R0 * 0.35, pal.gold, 0.8);
    glow(ctx, cx, cy, R0 * 0.12, '#ffffff', 1);
    ctx.globalCompositeOperation = 'source-over';
    glint(ctx, cx, cy, 3.4, pal.soft);
  }

  function aurora(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    ctx.globalCompositeOperation = 'lighter';
    const bands = 3 + Math.floor(r() * 2);
    for (let b = 0; b < bands; b++) {
      const c = pick([pal.hi, pal.accent, pal.lilac, pal.soft]);
      const base = h * R(0.45, 0.7), amp = h * R(0.04, 0.12);
      const f1 = (R(1, 3) * TAU) / w, f2 = (R(3, 7) * TAU) / w, ph = R(0, TAU), ph2 = R(0, TAU);
      const H = h * R(0.2, 0.42), a = R(0.08, 0.18);
      for (let x = 0; x < w; x += 2) {
        const y0 = base + Math.sin(x * f1 + ph) * amp + Math.sin(x * f2 + ph2) * amp * 0.35;
        const hh = H * (0.55 + 0.45 * Math.sin(x * f2 * 0.7 + ph));
        const g = ctx.createLinearGradient(0, y0, 0, y0 - hh);
        g.addColorStop(0, rgba(c, a));
        g.addColorStop(0.25, rgba(c, a * 0.7));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x, y0 - hh, 2, hh + 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // the curve of a planet seen from orbit
    const R0 = w * 1.4, top = h * 0.8, cx = w * R(0.35, 0.65), cy = top + R0;
    ctx.save();
    ctx.shadowColor = pal.hi;
    ctx.shadowBlur = S * 0.08;
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, mix(pal.accent3, pal.void, 0.3));
    g.addColorStop(1, pal.void);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = rgba(pal.hi, 0.75);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R0, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    for (let i = 0; i < 30; i++) {
      const x = R(0, w), y = top + (h - top) * R(0.15, 0.9);
      ctx.fillStyle = rgba(pal.gold, R(0.2, 0.6));
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  function crescent(P) {
    const { ctx, w, h, r, R, pick, pal, S } = P;
    const rad = S * R(0.2, 0.28);
    const cx = w * R(0.55, 0.75), cy = h * R(0.38, 0.55);
    glow(ctx, cx, cy, rad * 2.4, pal.lilac, 0.25);
    // paint the moon on its own canvas so the shadow cut doesn't punch through the sky
    const off = document.createElement('canvas');
    off.width = off.height = Math.ceil(rad * 2 + 4);
    const o = off.getContext('2d');
    const c = rad + 2;
    const g = o.createRadialGradient(c - rad * 0.3, c - rad * 0.3, rad * 0.1, c, c, rad);
    g.addColorStop(0, mix(pal.soft, '#ffffff', 0.5));
    g.addColorStop(0.7, pal.soft);
    g.addColorStop(1, mix(pal.soft, pal.lilac, 0.6));
    o.fillStyle = g;
    o.beginPath();
    o.arc(c, c, rad, 0, TAU);
    o.fill();
    for (let i = 0; i < 9; i++) {
      o.fillStyle = rgba(pal.lilac, R(0.08, 0.22));
      o.beginPath();
      o.arc(c + R(-0.6, 0.6) * rad, c + R(-0.6, 0.6) * rad, R(0.04, 0.14) * rad, 0, TAU);
      o.fill();
    }
    o.globalCompositeOperation = 'destination-out';
    const sh = R(0.3, 0.55);
    o.beginPath();
    o.arc(c - rad * sh, c - rad * sh * 0.4, rad * 0.98, 0, TAU);
    o.fill();
    ctx.fillStyle = rgba(pal.lilac, 0.08); // earthshine on the dark side
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.fill();
    ctx.drawImage(off, cx - c, cy - c);
    const n = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) sparkle(ctx, R(0.06, 0.5) * w, R(0.12, 0.88) * h, (R(4, 12) * S) / 360, pick([pal.gold, pal.soft, pal.hi]));
  }

  const FN = {
    planet: (P) => planet(P),
    galaxy, nebula, binary, comet, blackhole, constellation, eclipse, supernova,
    orbit: (P) => planet(P, { ringed: true, orbits: true, scale: 0.8 }),
    aurora, crescent
  };
  const LABELS = {
    planet: 'Planet', galaxy: 'Spiral galaxy', nebula: 'Star nursery', binary: 'Binary stars', comet: 'Comet',
    blackhole: 'Black hole', constellation: 'Constellation', eclipse: 'Eclipse', supernova: 'Supernova',
    orbit: 'Orbital system', aurora: 'Aurora limb', crescent: 'Crescent moon'
  };
  // A note picks one of these when its art style is "auto"
  const AUTO = ['planet', 'galaxy', 'nebula', 'binary', 'comet', 'blackhole', 'constellation', 'eclipse', 'supernova', 'crescent'];
  const AESTHETIC_SUBJECT = {
    nebula: 'nebula', supernova: 'supernova', orbit: 'orbit', constellation: 'constellation',
    eclipse: 'eclipse', aurora: 'aurora', celestial: 'crescent'
  };

  function paint(ctx, w, h, seed, subject, pal) {
    const r = rng(seed);
    const P = {
      ctx, w, h, r, pal, S: Math.min(w, h),
      R: (a, b) => a + (b - a) * r(),
      pick: (arr) => arr[Math.floor(r() * arr.length)]
    };
    background(P);
    stars(P);
    (FN[subject] || FN.planet)(P);
    ctx.globalCompositeOperation = 'source-over';
    vignette(P);
  }

  function resolveSubject(seed, subject) {
    if (subject && subject !== 'auto' && FN[subject]) return subject;
    return AUTO[Math.floor(rng((seed ^ 0x9e3779b9) >>> 0)() * AUTO.length)];
  }

  // Painted pictures are cached as data URLs, keyed by everything that changes the picture
  const cache = new Map();
  function render({ seed, subject = 'auto', theme, w = 640, h = 360, type = 'image/jpeg' }) {
    const subj = resolveSubject(seed >>> 0, subject);
    const key = [seed >>> 0, subj, theme, w, h, type].join('|');
    const hit = cache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), w, h, seed >>> 0, subj, NO.themes.palette(theme));
    const url = c.toDataURL(type, 0.9);
    cache.set(key, url);
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return url;
  }

  NO.cosmos = {
    hash, render, resolveSubject,
    label: (s) => LABELS[s] || s,
    subjects: () => Object.keys(FN),
    aestheticSubject: (a) => AESTHETIC_SUBJECT[a] || 'nebula',
    randomSeed: () => (Math.random() * 4294967296) >>> 0
  };
})();
