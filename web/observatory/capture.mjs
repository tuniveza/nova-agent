#!/usr/bin/env node
// Nova Observatory — capture.mjs
// Makes the screenshots and demo videos shown in the Observatory, into media/<id>/.
//   capture.mode "page":   opens the project in headless Chromium (a file, a local static server, a Vite
//                          dev server, or a URL), plays a short scripted demo, takes screenshots and
//                          records the whole thing as an MP4.
//   capture.mode "images": copies existing pictures from the project and builds a slideshow MP4 with ffmpeg.
// Safety: every page runs behind a guard that blocks all requests leaving this machine (except Google
// Fonts) and every non-GET request, so a demo can never post to a live service. Projects marked
// "private" (such as a live Nova Agent) are skipped unless you pass --include-private; their script only
// looks and scrolls, it never clicks.
// Usage: node capture.mjs [project-id ...] [--include-private]

import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(HERE, 'media');
// Your own catalogue is projects.config.json (git ignores it). Without one, the example catalogue is used.
const CONFIG_FILE = ['projects.config.json', 'projects.config.example.json'].map((f) => path.join(HERE, f)).find((f) => fss.existsSync(f));
if (!CONFIG_FILE.endsWith('projects.config.json')) console.log('No projects.config.json yet, so using projects.config.example.json. Copy it to projects.config.json to make it yours.');
const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
const argv = process.argv.slice(2);
const includePrivate = argv.includes('--include-private');
const only = argv.filter((a) => !a.startsWith('--'));
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- TOOLS ----------

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const c of ['playwright', path.join(HERE, '../na/node_modules/playwright')]) {
    try { return req(c); } catch { /* try the next one */ }
  }
  throw new Error('Playwright not found. Run "npm install" in this folder.');
}
const systemChromium = () => ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => fss.existsSync(p));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json'
};

// A tiny static file server on a free local port. mounts maps URL prefixes to folders inside root,
// for apps that expect to be served from a sub-path (Nova Hub lives at /app).
function serve(root, mounts = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const mount = Object.keys(mounts).find((m) => rel === m || rel.startsWith(m + '/'));
        if (mount) rel = '/' + mounts[mount] + rel.slice(mount.length);
        let file = path.join(root, rel);
        if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
        let st = await fs.stat(file).catch(() => null);
        if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = await fs.stat(file).catch(() => null); }
        if (!st) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        fss.createReadStream(file).pipe(res);
      } catch { res.writeHead(500); res.end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// The project's own Vite, on a spare port, without opening a desktop browser
async function startVite(cwd) {
  const bin = path.join(cwd, 'node_modules', '.bin', 'vite');
  if (!fss.existsSync(bin)) throw new Error('node_modules/.bin/vite missing (run npm install in the project)');
  const port = 5300 + Math.floor(Math.random() * 600);
  const child = spawn(bin, ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd, env: { ...process.env, BROWSER: 'none' }, stdio: 'ignore', detached: true
  });
  const base = `http://127.0.0.1:${port}/`;
  for (const end = Date.now() + 40000; Date.now() < end; await sleep(400)) {
    if (await fetch(base).then((r) => r.ok).catch(() => false)) return { child, base };
  }
  killTree(child);
  throw new Error('Vite did not start within 40s');
}
function killTree(child) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ } }

// Block anything leaving this machine, and anything that isn't a plain read
async function guard(context) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (!['GET', 'HEAD'].includes(req.method())) return route.abort();
    const local = ['file:', 'data:', 'blob:'].includes(u.protocol) || ['127.0.0.1', 'localhost'].includes(u.hostname);
    const fonts = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
    return local || fonts ? route.continue() : route.abort();
  });
}

async function ffmpeg(args, timeout = 600000) {
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...args], { timeout, maxBuffer: 1 << 24 });
}

// Playwright records WebM; trim the blank lead-in and store a small H.264 MP4
const encode = (src, dst, ss) => ffmpeg(['-ss', ss.toFixed(2), '-i', src, '-vf', 'scale=1280:-2,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-movflags', '+faststart', '-an', dst]);

const captionFrom = (file) => path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// A slow Ken Burns slideshow with a different transition between each picture
async function slideshow(files, dst) {
  const D = 4, X = 0.8, fps = 30;
  const TRANS = ['fade', 'smoothleft', 'circleopen', 'fadeblack', 'radial', 'smoothup', 'dissolve'];
  const parts = files.map((_, i) => {
    const z = i % 2 === 0 ? 'min(zoom+0.0008,1.12)' : 'if(lte(on,1),1.12,max(zoom-0.0008,1))';
    return `[${i}:v]scale=2560:1440:force_original_aspect_ratio=decrease,pad=2560:1440:(ow-iw)/2:(oh-ih)/2:color=0x06040D,` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${D * fps}:s=1280x720:fps=${fps},setsar=1,format=yuv420p[v${i}]`;
  });
  let last = 'v0', offset = D - X;
  for (let i = 1; i < files.length; i++) {
    const out = i === files.length - 1 ? 'vout' : `x${i}`;
    parts.push(`[${last}][v${i}]xfade=transition=${TRANS[i % TRANS.length]}:duration=${X}:offset=${offset.toFixed(2)}[${out}]`);
    last = out;
    offset += D - X;
  }
  if (files.length === 1) parts.push('[v0]null[vout]');
  await ffmpeg([...files.flatMap((f) => ['-i', f]), '-filter_complex', parts.join(';'), '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}

// ---------- DEMO SCRIPTS ----------
// Each gets (page, shot, ctx). shot(caption) saves the current view.

async function slowScroll(page, frac = 1, step = 36) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y < h * frac; y += step) { await page.mouse.wheel(0, step); await sleep(28); }
}
async function holdKey(page, key, ms) { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); }
async function typeInto(page, selector, text, delay = 55) {
  const el = page.locator(selector);
  await el.fill('');
  await el.pressSequentially(text, { delay });
}

const SCRIPTS = {
  async look(page, shot) {
    await shot('Home');
    await slowScroll(page);
    await sleep(600);
    await shot('Further down');
  },

  // For live services: wait, look, scroll. Never clicks or types.
  async lookOnly(page, shot) {
    await sleep(2500);
    await shot('Live view');
    await slowScroll(page, 0.6, 24);
    await sleep(1500);
    await shot('Further down');
  },

  async novaCalendar(page, shot) {
    await shot('A month under the real moon');
    await page.click('[data-action="new-day"][data-preset="birthday"]');
    await sleep(500);
    await typeInto(page, '#day-form [name="title"]', "Nova's Birthday", 70);
    await typeInto(page, '#day-form [name="location"]', 'Studio A, London', 40);
    await page.click('#aes-grid input[value="supernova"] + span');
    await sleep(700);
    await page.locator('#day-preview').scrollIntoViewIfNeeded();
    await sleep(400);
    await shot('Building a day card');
    await page.click('#day-form button[value="note"]');
    await sleep(600);
    await typeInto(page, '#note-form [name="title"]', 'Cake run', 80);
    await typeInto(page, '#note-form [name="body"]', 'Pick up the galaxy cake from the bakery. Candles: 27.', 30);
    await typeInto(page, '#note-form [name="author"]', 'Nova', 80);
    await sleep(700);
    await shot('A note card paints its own picture');
    for (let i = 0; i < 3; i++) { await page.click('#note-regen'); await sleep(650); }
    await page.click('#note-form button[type="submit"]');
    await sleep(1200);
    await shot('The day card, with its note card inside');
    for (const t of ['solar', 'pulsar', 'aurora', 'eclipse', 'novacane']) {
      await page.click(`.swatch[data-theme="${t}"]`);
      await sleep(1000);
      if (t === 'solar') await shot('Solar Flare theme');
      if (t === 'pulsar') await shot('Pulsar theme');
    }
    const halloween = page.locator('#grid [data-date$="-10-31"]').first();
    if (await halloween.count()) {
      await halloween.click();
      await sleep(600);
      const chip = page.locator('[data-action="seasonal"]').first();
      if (await chip.count()) {
        await chip.click();
        await sleep(900);
        await page.click('#day-form button[value="save"]');
        await sleep(1200);
        await shot('Halloween, straight from the seasonal sky');
      }
    }
    await page.click('#next'); await sleep(800);
    await page.click('#next'); await sleep(1000);
    await shot('December: solstice, Geminids and Christmas');
  },

  async observatory(page, shot) {
    await sleep(1500);
    await shot('The Observatory');
    await slowScroll(page, 0.35);
    await sleep(800);
    await shot('Project decks');
    const deck = page.locator('.deck[data-id="nova-calendar"]');
    if (await deck.count()) {
      await deck.click();
      await sleep(1800);
      await shot('A project up close');
      await page.locator('#detail .dt-body').evaluate((el) => el.scrollBy({ top: 700, behavior: 'smooth' }));
      await sleep(1500);
      await shot('Folder tree and languages');
      await page.keyboard.press('Escape');
      await sleep(600);
    }
    const map = page.locator('#starmap');
    if (await map.count()) { await map.scrollIntoViewIfNeeded(); await sleep(1500); await shot('Star map of the folder structure'); }
  },

  async novaBot(page, shot, { server }) {
    await sleep(1500);
    await shot('Nova Bot on the studio site');
    const toggle = page.locator('#nv-chat-toggle');
    if (await toggle.count()) {
      const open = await toggle.getAttribute('aria-expanded');
      if (open === 'false') { await toggle.click(); await sleep(1300); }
      const input = page.locator('#nv-chat-panel textarea, #nv-chat-panel input[type="text"]').first();
      if (await input.count()) {
        await input.pressSequentially('Can I book a session this weekend?', { delay: 45 }); // typed, never sent
        await sleep(900);
      }
      await shot('The chat panel');
      await toggle.click();
      await sleep(1000);
      await shot('Folded away to its launcher');
    }
    if (server) {
      await page.goto(server.base + '/app/', { waitUntil: 'load' });
      await sleep(2000);
      await shot('Nova Hub, the staff app');
    }
  },

  async tideward(page, shot) {
    await sleep(1500);
    await shot('The title card');
    const start = page.getByText(/step onto the shingle/i).first();
    if (await start.count()) await start.click();
    else await page.mouse.click(W / 2, H / 2);
    await sleep(1800);
    await shot('The shore');
    for (let i = 0; i < 110; i++) {
      const a = i / 14;
      await page.mouse.move(W / 2 + Math.cos(a) * 280, H / 2 + Math.sin(a) * 170);
      await sleep(28);
    }
    await shot('Herding fish towards the rockpools');
    await holdKey(page, 'd', 1600);
    await holdKey(page, 'w', 900);
    await holdKey(page, 'a', 1300);
    await shot('Walking the shingle');
    await holdKey(page, 's', 1600);
    await holdKey(page, 'd', 1400);
    await sleep(500);
    await shot('Down to the water');
  },

  async linatrix(page, shot) {
    await sleep(1200);
    await shot('Linatrix');
    // Some controls live in collapsed panels, so type where visible and set the value directly where not
    const set = async (id, value, button) => {
      const el = page.locator('#' + id);
      if (!(await el.count())) return;
      if (await el.isVisible()) await typeInto(page, '#' + id, value, 60);
      else await el.evaluate((e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      const btn = button && page.locator('#' + button);
      if (btn && (await btn.count())) await btn.first().evaluate((b) => b.click());
      await sleep(500);
    };
    await set('ColBar', '18');
    await set('RowBar', '10');
    await set('AmountOfPixel', '180', 'SetBar');
    await sleep(600);
    await shot('An 18 × 10 matrix');
    await set('PixelColorTextArea', '#ff5fa8', 'PixelColorButton');
    await set('PixelRadiusTextArea', '50', 'PixelRadiusButton');
    await set('GapSizeTextArea', '6', 'GapButton');
    await sleep(600);
    await shot('Rounded magenta pixels');
    await set('LineColorTextArea', '#c7a4ff', 'LineColorButton');
    await set('LineSizeTextArea', '3', 'LineSizeButton');
    await set('LineStyleTextArea', 'dashed', 'LineStyleButton');
    for (const id of ['Saturation', 'Contrast']) {
      const el = page.locator('#' + id);
      if (await el.count()) await el.evaluate((e) => { e.value = 60; e.dispatchEvent(new Event('change', { bubbles: true })); });
      await sleep(400);
    }
    await shot('Lines and filters');
  },

  async tilemap(page, shot) {
    await sleep(1500);
    await shot('The editor');
    const start = page.getByText(/start\s*-\s*tilemap/i).first();
    if (await start.count()) { await start.click(); await sleep(1500); await shot('A fresh tilemap'); }
    const boxes = [];
    for (const c of await page.locator('canvas').all()) { const b = await c.boundingBox(); if (b && b.width > 40) boxes.push(b); }
    boxes.sort((a, b) => a.width * a.height - b.width * b.height);
    if (boxes.length) {
      const pick = boxes[0], grid = boxes[boxes.length - 1];
      for (let i = 0; i < 4; i++) {
        await page.mouse.click(pick.x + pick.width * (0.15 + 0.2 * i), pick.y + pick.height * 0.3);
        await sleep(300);
        await page.mouse.move(grid.x + grid.width * 0.2, grid.y + grid.height * (0.2 + i * 0.15));
        await page.mouse.down();
        for (let s = 0; s <= 20; s++) { await page.mouse.move(grid.x + grid.width * (0.2 + s * 0.03), grid.y + grid.height * (0.2 + i * 0.15)); await sleep(25); }
        await page.mouse.up();
        await sleep(300);
      }
    }
    await shot('Painting tiles onto the grid');
  },

  async walk(page, shot) {
    await sleep(2000);
    await page.mouse.click(W / 2, H / 2);
    await shot('The farm');
    for (const [k, ms] of [['ArrowRight', 1400], ['ArrowDown', 900], ['ArrowLeft', 1600], ['ArrowUp', 900], ['d', 900], ['s', 700]]) {
      await holdKey(page, k, ms);
    }
    await shot('Walking the farm');
  }
};

// ---------- CAPTURE ----------

async function capturePage(browser, p, dir) {
  const c = p.capture;
  let server = null, vite = null, url;
  if (c.url) {
    const res = await fetch(c.url).catch(() => null);
    if (!res || !res.ok) throw new Error(`${c.url} answered ${res ? 'HTTP ' + res.status : 'nothing'}`);
    url = c.url;
  } else if (c.vite) {
    vite = await startVite(p.path);
    url = vite.base;
  } else if (c.serve) {
    server = await serve(c.serve, c.mounts);
    url = `${server.base}/${c.file || ''}`;
  } else {
    url = pathToFileURL(path.join(p.path, c.file)).href;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-observatory-'));
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  await guard(context);
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const shots = [];
  const shot = async (caption) => {
    const file = `shot-${shots.length + 1}.jpg`;
    await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 84 });
    shots.push({ file, caption });
  };
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await sleep(1000);
    const lead = (Date.now() - t0) / 1000 - 0.5;
    await SCRIPTS[c.script || 'look'](page, shot, { p, server, url });
    const video = page.video();
    await context.close();
    await encode(await video.path(), path.join(dir, 'video.mp4'), Math.max(0, lead));
  } finally {
    await context.close().catch(() => {});
    if (server) server.srv.close();
    if (vite) killTree(vite.child);
    await fs.rm(tmp, { recursive: true, force: true });
  }
  return { shots, video: 'video.mp4' };
}

async function captureImages(p, dir) {
  const shots = [];
  for (const rel of p.capture.images || []) {
    const src = path.join(p.path, rel);
    if (!fss.existsSync(src)) continue;
    const file = `shot-${shots.length + 1}.jpg`;
    const alpha = /\.(png|webp)$/i.test(src);
    // transparent pictures go onto deep space instead of turning into random colours
    const vf = alpha
      ? `color=c=0x06040D:s=16x16[bg];[0:v]scale='min(1600,iw)':-2,format=rgba[fg];[bg][fg]scale2ref[bg2][fg2];[bg2][fg2]overlay=format=auto,format=yuvj444p`
      : `scale='min(1600,iw)':-2`;
    await ffmpeg(['-i', src, ...(alpha ? ['-filter_complex', vf] : ['-vf', vf]), '-q:v', '3', '-frames:v', '1', path.join(dir, file)]);
    shots.push({ file, caption: captionFrom(rel) });
  }
  if (!shots.length) return { shots, video: null };
  await slideshow(shots.map((s) => path.join(dir, s.file)), path.join(dir, 'video.mp4'));
  return { shots, video: 'video.mp4' };
}

// ---------- MAIN ----------

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: systemChromium() });
const report = [];
// The Observatory captures itself last, so its own screenshots show everyone else's
const queue = config.projects
  .filter((p) => !only.length || only.includes(p.id))
  .sort((a, b) => (a.id === 'nova-observatory') - (b.id === 'nova-observatory'));

for (const p of queue) {
  const c = p.capture || { mode: 'none' };
  if (c.mode === 'none') { report.push([p.id, 'skipped (no capture)']); continue; }
  if (c.private && !includePrivate) { report.push([p.id, 'skipped (private; pass --include-private)']); continue; }
  const dir = path.join(MEDIA, p.id);
  const stage = dir + '.new';
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });
  const t0 = Date.now();
  process.stdout.write(`  ${p.id.padEnd(20)} `);
  try {
    let result = c.mode === 'images' ? await captureImages(p, stage) : await capturePage(browser, p, stage);
    // a page capture can also carry existing pictures (e.g. a logo or store header)
    if (c.mode === 'page' && c.images) {
      const extra = await captureImages({ ...p, capture: { images: c.images } }, path.join(stage, 'extra')).catch(() => null);
      if (extra) for (const s of extra.shots) {
        const file = `shot-${result.shots.length + 1}.jpg`;
        await fs.rename(path.join(stage, 'extra', s.file), path.join(stage, file));
        result.shots.push({ file, caption: s.caption });
      }
      await fs.rm(path.join(stage, 'extra'), { recursive: true, force: true });
    }
    const manifest = { captured: new Date().toISOString(), mode: c.mode, shots: result.shots, video: result.video, poster: result.shots[0] ? result.shots[0].file : null, note: c.note || null };
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(stage, dir);
    const kb = Math.round(fss.statSync(path.join(dir, 'video.mp4'), { throwIfNoEntry: false })?.size / 1024) || 0;
    console.log(`${result.shots.length} shots, video ${kb} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    report.push([p.id, 'ok']);
  } catch (e) {
    console.log('FAILED: ' + e.message.split('\n')[0]);
    report.push([p.id, 'failed: ' + e.message.split('\n')[0]]);
    await fs.rm(stage, { recursive: true, force: true });
  }
}
await browser.close();
const failed = report.filter(([, s]) => s.startsWith('failed'));
console.log(`\nCaptured ${report.filter(([, s]) => s === 'ok').length}, skipped ${report.filter(([, s]) => s.startsWith('skipped')).length}, failed ${failed.length}`);
for (const [id, s] of report) if (s !== 'ok') console.log(`  ${id}: ${s}`);
