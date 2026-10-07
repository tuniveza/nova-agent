/* Nova Notes — backdrop.js
   The live sky behind the app: twinkling stars and the odd shooting star, tinted by the app theme.
   Holds still when the system asks for reduced motion. */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});
  const canvas = document.getElementById('sky');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, stars = [], pal = null, shooter = null, nextShot = 0, running = false;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((W * H) / 4800);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.pow(Math.random(), 3) * 1.4 + 0.2,
      a: 0.25 + Math.random() * 0.75,
      tw: Math.random() * Math.PI * 2, sp: 0.4 + Math.random() * 1.6,
      c: Math.random()
    }));
    if (still.matches) draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (const s of stars) {
      const tw = still.matches ? 1 : 0.6 + 0.4 * Math.sin(s.tw + (t / 1000) * s.sp);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.c < 0.6 ? '#ffffff' : s.c < 0.82 ? pal.soft : pal.lilac;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (still.matches) return;

    // a shooting star every 8–20 seconds
    if (!shooter && t > nextShot) {
      const fromLeft = Math.random() < 0.5;
      shooter = {
        x: fromLeft ? Math.random() * W * 0.5 : W * 0.5 + Math.random() * W * 0.5,
        y: Math.random() * H * 0.4,
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 4), vy: 2 + Math.random() * 2.5, life: 1
      };
    }
    if (shooter) {
      const s = shooter;
      const tail = 16;
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * tail, s.y - s.vy * tail);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * s.life})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * tail, s.y - s.vy * tail);
      ctx.stroke();
      s.x += s.vx;
      s.y += s.vy;
      s.life -= 0.012;
      if (s.life <= 0 || s.x < -200 || s.x > W + 200 || s.y > H + 200) {
        shooter = null;
        nextShot = t + 8000 + Math.random() * 12000;
      }
    }
  }

  function loop(t) {
    draw(t);
    if (!still.matches) requestAnimationFrame(loop);
    else running = false;
  }

  function start() {
    if (running || still.matches) return;
    running = true;
    nextShot = performance.now() + 4000;
    requestAnimationFrame(loop);
  }

  NN.backdrop = {
    init(themeId) {
      pal = NN.themes.palette(themeId);
      resize();
      window.addEventListener('resize', resize);
      still.addEventListener('change', () => (still.matches ? draw(0) : start()));
      start();
    },
    setTheme(themeId) {
      pal = NN.themes.palette(themeId);
      if (still.matches) draw(0);
    }
  };
})();
