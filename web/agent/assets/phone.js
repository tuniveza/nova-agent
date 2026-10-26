// Nova Agent on a phone (or a small window): one bar along the bottom that never goes away, with
// every place in Nova Agent on it (Invoicer, Portal, Agent, Calendar, Notes, Board, Quests, Nova;
// Fixer, Computer, Observatory, Console, Manual and Index are in the Backend: backend.js); the
// panels open between the header and the bar, and the last few stay loaded so switching back is
// instant. Settings (rhythm, sound, music, refresh, all links) are behind the gear in the header.
// Also: sizing to the visible screen (so the keyboard never hides the message box), the phone's
// back button closing an open panel, and a readable status.
// Loaded before the page's own script (chat.html), so the star sky can be skipped on a phone.
// The look is in phone.css; on a computer all of this stays out of the way.
(function () {
  'use strict';
  // (the phone room: one decision for the whole suite, look.js NovaForm, 22 Oct 2026)
  const PHONE = window.NovaForm ? window.NovaForm.room("phone") : matchMedia('(max-width: 980px), (max-height: 480px)');
  const STILL = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(id);
  const main = $('main'), shell = $('shell'), viewer = $('viewer');
  if (!main || !shell || !viewer) return;
  const root = document.documentElement;

  // ---- The tiles in the launcher say what each panel is called, where it is and its icon ----
  // (the Panels window's and the Backend's: a Backend panel opened by its address still has its name and icon)
  const tiles = () => [...document.querySelectorAll(':is(#suite, #backend) a.suite-app[data-inside]')];
  const tile = (address) => document.querySelector(`:is(#suite, #backend) a.suite-app[data-inside="${address}"]`);
  // (the bar's places: the Panels window's only, never the Backend's)
  const barTiles = () => [...document.querySelectorAll('#suite a.suite-app[data-inside]')];
  const nameOf = (a) => (a && a.querySelector('b') ? a.querySelector('b').textContent : '');
  // The panel an address belongs to (the longest address it starts with)
  function baseOf(url) {
    const u = new URL(url, location.href);
    let best = '';
    for (const a of tiles()) {
      const base = a.dataset.inside;
      const path = base.endsWith('/') ? base : base + '/';
      if ((u.pathname === base || u.pathname.startsWith(path)) && base.length > best.length) best = base;
    }
    return best || u.pathname;
  }

  // ---- The panels' frames ----
  // The last panels opened stay loaded (each in its own frame, the others hidden): three on a phone,
  // six on a computer. Going back to one is instant and it's where you left it. Switching never piles
  // up "back" steps: a frame that's already showing a page is moved on, not stacked. Lossless audio
  // (the microphone and a live call) is the exception: closed, it's really closed.
  const srcProp = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  const KEEP = PHONE.matches ? 3 : 6;
  const LIVE = /^\/lossless(\/|$)/; // closed means closed
  const pool = []; // { base, frame, shown, used }
  const first = $('viewer-frame');
  function wire(frame, entry) {
    if (!srcProp) return;
    Object.defineProperty(frame, 'src', {
      configurable: true,
      get() { return entry.shown || srcProp.get.call(frame); },
      set(value) { show(String(value), entry); },
    });
  }
  function navigate(entry, url) {
    entry.shown = url;
    try {
      const w = entry.frame.contentWindow;
      if (w && entry.frame.getAttribute('src')) { w.location.replace(url); return; }
    } catch (e) {}
    srcProp.set.call(entry.frame, url);
  }
  function activate(entry) {
    for (const e of pool) {
      e.frame.hidden = e !== entry;
      if (e !== entry && e.frame.id === 'viewer-frame') e.frame.removeAttribute('id');
    }
    entry.frame.id = 'viewer-frame';
    entry.used = Date.now();
  }
  function fresh() {
    const frame = document.createElement('iframe');
    for (const attr of ['title', 'allow']) if (first.hasAttribute(attr)) frame.setAttribute(attr, first.getAttribute(attr));
    // Always in the panel's box (#viewer-body), never beside it: the first frame goes too once more
    // than KEEP panels have been opened, and a frame put in the viewer itself sat in a second row
    // under an empty box, running on behind the navigation panel
    ($('viewer-body') || first.parentElement || viewer).append(frame);
    return frame;
  }
  function loading(frame) {
    frame.classList.add('loading');
    frame.addEventListener('load', () => frame.classList.remove('loading'), { once: true });
  }
  // What the page's own script does to "the frame" (open a panel, reload it, close it) comes here
  function show(value, entry) {
    const url = new URL(value, location.href).href;
    // Closing a panel: it stays loaded (just hidden with the viewer), except Lossless audio
    if (url === 'about:blank') {
      if (!LIVE.test(entry.base || '')) return;
      entry.shown = '';
      entry.base = '';
      srcProp.set.call(entry.frame, url);
      return;
    }
    const base = baseOf(url);
    const active = entry.frame.id === 'viewer-frame' && !viewer.hidden;
    // The panel that's showing, asked for again: reload it (the gear's "Reload this panel")
    if (active && entry.base === base && entry.shown === url) {
      loading(entry.frame);
      try { entry.frame.contentWindow.location.reload(); } catch (e) { srcProp.set.call(entry.frame, url); }
      return;
    }
    let keep = pool.find((e) => e.base === base);
    if (keep) {
      activate(keep);
      // Opened by its plain address (the bar): as it was left. Somewhere particular in it: go there.
      const plain = new URL(base, location.href).href;
      if (url !== plain && url !== keep.shown) { loading(keep.frame); navigate(keep, url); }
      return;
    }
    // Not loaded yet: the first frame if it's still empty, else a new one (the oldest goes if there are too many)
    const unused = pool.find((e) => !e.shown);
    keep = unused || { frame: fresh(), shown: '' };
    if (!unused) { wire(keep.frame, keep); pool.push(keep); }
    keep.base = base;
    activate(keep);
    loading(keep.frame);
    navigate(keep, url);
    while (pool.length > KEEP) {
      const oldest = pool.filter((e) => e !== keep).sort((a, b) => a.used - b.used)[0];
      if (!oldest) break;
      pool.splice(pool.indexOf(oldest), 1);
      oldest.frame.remove();
    }
  }
  if (first && srcProp) {
    const entry = { base: '', frame: first, shown: '', used: 0 };
    pool.push(entry);
    wire(first, entry);
  }

  // ---- Lighter on a phone: no moving star sky (backdrop.js) behind everything ----
  if (PHONE.matches && window.NT && NT.backdrop) NT.backdrop.init = () => {};

  // ---- Sized to what's visible: the keyboard shrinks it, and the bars step aside while typing ----
  const vv = window.visualViewport;
  // The keyboard is up when the visible part is well short of the tallest it's been at this width.
  // (Not innerHeight: Android's Chrome shrinks the whole page with the keyboard, so on an Android
  // phone that was always the same as the visible part and the bars never stepped aside.)
  let tallest = 0, tallestAt = 0;
  function fit() {
    if (!vv) return;
    // (only written when it changes: each write restyles the whole page)
    const vh = `${Math.round(vv.height)}px`, vt = `${Math.round(vv.offsetTop)}px`;
    if (root.style.getPropertyValue('--vv-h') !== vh) root.style.setProperty('--vv-h', vh);
    if (root.style.getPropertyValue('--vv-top') !== vt) root.style.setProperty('--vv-top', vt);
    const w = Math.round(window.innerWidth);
    if (w !== tallestAt) { tallestAt = w; tallest = 0; }
    tallest = Math.max(tallest, vv.height, window.innerHeight);
    // Typing here, or in a panel (its frame has the focus then)
    const typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT|IFRAME)$/.test(document.activeElement.tagName);
    root.classList.toggle('kb', PHONE.matches && typing && vv.height < tallest - 120);
  }
  if (vv) {
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
  }
  document.addEventListener('focusin', () => setTimeout(fit, 60));
  document.addEventListener('focusout', () => setTimeout(fit, 60));
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  fit();

  // ---- The status: a word you can read (Live, Rehearsal, PC off, Signed out), and its colour ----
  const statusText = $('status-text'), status = $('status');
  if (statusText && status) {
    const paint = () => {
      const t = statusText.textContent.trim();
      status.classList.toggle('off', t === 'PC off' || t === 'Offline');
      status.classList.toggle('out', t === 'Signed out');
    };
    new MutationObserver(paint).observe(statusText, { childList: true, characterData: true, subtree: true });
    paint();
  }

  const svg = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const tileIcon = (address, cls) => {
    const t = tile(address);
    const own = t && t.querySelector('.pico');
    if (own) return own.outerHTML.replace('class="pico"', `class="pico ${cls}"`);
    const img = t && t.querySelector('img');
    if (img) return `<img class="${cls}" src="${img.getAttribute('src')}" alt="" width="24" height="24" decoding="async">`;
    const glyph = t && t.querySelector('.suite-glyph');
    return `<span class="${cls}" aria-hidden="true">${glyph ? glyph.textContent : '✦'}</span>`;
  };
  const open = (address) => {
    if (window.NovaAgent && window.NovaAgent.open(address)) return;
    const t = tile(address);
    if (t) t.click();
  };
  const closePanel = () => { if (!viewer.hidden) $('viewer-close').click(); };
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(name);

  // ---- The home: Agent (Quests opens as its own panel) ----
  const PANE_KEY = 'nova-agent/phone-pane';
  function setPane(pane) {
    main.dataset.pane = pane;
    try { sessionStorage.setItem(PANE_KEY, pane); } catch (e) {}
    current();
  }
  let saved = 'chat';
  try { saved = sessionStorage.getItem(PANE_KEY) || 'chat'; } catch (e) {}
  // (today's plan used to be a pane here; it's Quests now, which opens on Today: a phone that was on
  // it opens Quests instead, once the page is ready)
  const toQuests = saved === 'quests';
  if (saved !== 'chat') saved = 'chat';

  // ---- The header: the gear (settings). (Its fresh-chat trash can is gone, 20 Oct 2026, the user: "get
  // rid of the trash can new conversation button") ----
  const right = document.querySelector('.topbar .top-side.right');
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'icon-btn phone-only';
  gear.id = 'phone-gear';
  gear.title = PHONE.matches ? 'Settings' : 'Look & layout: theme, bars, text';
  gear.setAttribute('aria-label', PHONE.matches ? 'Settings' : 'Look and layout');
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.innerHTML = svg('i-tune');
  if (right) right.append(gear);

  // ---- The bar along the bottom: every place in Nova Agent, always there ----
  // Apps (Portal, Agent, Calendar, Notes, Board, Quests); Invoicer on its own at the left end, Nova
  // on its own at the right end (Lossless: in the Panels window, behind the gear). Any other panel in the
  // Panels window joins Tools (none now). Fixer, Computer, Observatory, Console, Manual and Index are in the
  // Backend (23 Oct 2026), so the eight places left are bigger (phone.css). Every place stays on the bar on
  // every screen (no More menu); an empty group isn't drawn
  const SKIP = ['/admin/links', '/lossless/']; // All links and Lossless: behind the gear (the Panels window), not on the bar
  const GROUPS = [
    ['solo', '', ['/invoicer/']], // Invoicer: on its own, in no group, at the left end
    // (Quests is one of the Apps, and the Plans group went: 26 Oct 2026, the user: "make quests a part of the app section
    // on the nova dock please; plans section can be removed")
    ['apps', 'Apps', ['/portal/', 'pane:chat', '/calendar/', '/notes/', '/board/', '/quests/']], // Portal first, Agent second
    ['tools', 'Tools', []], // (any panel in the Panels window not placed elsewhere joins Tools)
    ['end', '', ['/visualizer']], // Nova: on its own, in no group, at the right end (Lossless: in the Panels window)
  ];
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.id = 'tabbar';
  bar.setAttribute('aria-label', 'Nova Agent');
  // The groups sit in a row of their own (so the status line under them is never redrawn with them).
  // On a short phone held upright the row slides sideways inside the bar (phone.css)
  const row = document.createElement('div');
  row.className = 'tg-row';
  bar.append(row);
  const item = (key, label, icon) => `<button type="button" data-tab="${key}" aria-label="${label}">${icon}<span>${label}</span></button>`;
  const glyph = (g) => `<span class="t-ico g" aria-hidden="true">${g}</span>`;
  // The panels' own icons (chat.html's .pico set: each its own colour, tinted by the theme)
  const pico = (k) => `<span class="pico t-ico" data-p="${k}" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#pi-${k}"/></svg></span>`;
  const FIXED = {
    'pane:chat': () => item('pane:chat', 'Agent', pico('chat')),
  };
  // The bar keeps its short labels: "Notes" in the launcher is "Notes" here
  const panelItem = (p) => (tile(p) ? item(p, nameOf(tile(p)).replace(/^Nova /, '').replace('Lossless audio', 'Lossless'), tileIcon(p, 't-ico')) : '');
  function fillBar() {
    const placed = new Set(GROUPS.flatMap((g) => g[2]));
    const extra = barTiles().map((a) => a.dataset.inside).filter((p) => !placed.has(p) && !SKIP.includes(p));
    row.innerHTML = GROUPS.map(([id, label, keys]) => {
      const items = (id === 'tools' ? [...keys, ...extra] : keys).map((k) => (FIXED[k] ? FIXED[k]() : panelItem(k))).join('');
      if (!items) return '';
      // (a group with no name, like Invoicer's, keeps the room a name takes so its place lines up)
      return `<div class="tgroup" data-group="${id}" role="group" aria-label="${label || (id === 'end' ? 'Nova' : 'Invoicer')}"><span class="tg-label" aria-hidden="true">${label || '&nbsp;'}</span><div class="tg-items">${items}</div></div>`;
    }).join('');
    current();
  }
  shell.append(bar);

  // The Manual (in the Backend) opens over everything, and an old Agent pane link comes back to Agent; none
  // of them leave the page
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.suite-app[data-pane], a.suite-app[data-act]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    for (const id of ['suite', 'backend']) { const dlg = $(id); if (dlg && dlg.open) dlg.close(); }
    if (a.dataset.act === 'manual') { if (window.NovaManual) window.NovaManual.open(); return; }
    if (!viewer.hidden) $('viewer-close').click();
    const pane = a.dataset.pane;
    if (pane === 'quests') { open('/quests/'); return; } // (old links to today's plan: Quests, on Today)
    if (PHONE.matches) { setPane('chat'); sfx('open'); return; }
    const box = pane === 'chat' ? $('main') : null;
    if (box) {
      box.scrollIntoView({ behavior: STILL.matches ? 'auto' : 'smooth', block: 'nearest' });
      box.animate && !STILL.matches && box.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--hi), 0 0 40px -6px var(--hi)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1100 });
    }
    sfx('open');
  }, true);
  // A place on the bar opens the same way wherever it's tapped
  function go(t) {
    if (t === 'pane:quests') { open('/quests/'); return; } // (today's plan is Quests now)
    if (t.startsWith('pane:')) { closePanel(); setPane(t.slice(5)); sfx('open'); return; }
    open(t);
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    go(b.dataset.tab);
  });
  // Each group's width follows how many places it holds; and the bar's height for whatever sits
  // above it (toasts)
  // (16 Oct 2026, speed on a phone: nothing is written or measured again when nothing has changed,
  // and the names are measured all together, once, not a half pixel at a time)
  let laidOut = '';
  function layout() {
    const shown = '[data-tab]';
    const k = {};
    const groups = [...bar.querySelectorAll('.tgroup')];
    for (const g of groups) k[g.dataset.group] = g.querySelectorAll(shown).length || 1;
    const n = groups.reduce((sum, g) => sum + g.querySelectorAll(shown).length, 0) || 14;
    const key = `${innerWidth}x${innerHeight}|${bar.clientWidth}|${JSON.stringify(k)}|${bar.querySelectorAll('[data-tab] > span:last-child').length}`;
    if (key === laidOut) return;
    laidOut = key;
    for (const g of groups) g.style.setProperty('--k', k[g.dataset.group]);
    // In one row (a tablet, a short or zoomed-in window, a phone on its side) every place is the same
    // width, whatever its group: phone.css shares the row out by how many places are showing
    bar.style.setProperty('--tab-n', n);
    // On a phone on its side the tiles sit in two staggered rows, top, bottom, top… each one place
    // along, between Invoicer at the left end and Nova at the right (phone-room.css)
    const mid = [...bar.querySelectorAll('.tgroup:not([data-group="solo"]):not([data-group="end"]) [data-tab]')];
    mid.forEach((b, i) => { b.style.setProperty('--t-col', i + 2); b.style.setProperty('--t-row', (i % 2) + 1); });
    bar.style.setProperty('--t-tracks', mid.length + 1);
    fitNames();
    const h = `${bar.offsetHeight || 126}px`;
    if (document.documentElement.style.getPropertyValue('--bar-h') !== h) document.documentElement.style.setProperty('--bar-h', h);
  }
  // Each name on one line inside its tile (never cut off with "…"). A name too wide for its tile is
  // made smaller (worked out from how much too wide it is, in one go); on an extremely thin screen,
  // if even the smallest is too wide, it keeps its first few letters, at least one (the whole name is
  // still its tooltip and what's read out)
  function fitNames() {
    const names = [...bar.querySelectorAll('[data-tab] > span:last-child')];
    for (const name of names) {
      const full = name.dataset.full || (name.dataset.full = name.textContent);
      if (name.textContent !== full) name.textContent = full;
      name.style.fontSize = '';
      const btn = name.parentElement;
      if (btn && !btn.title) btn.title = full;
    }
    // (every measurement at once, then every change at once)
    const seen = names.map((name) => {
      if (!name.offsetParent) return null;
      const cs = getComputedStyle(name);
      const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      return { name, room: name.clientWidth - pad, need: name.scrollWidth - pad, size: parseFloat(cs.fontSize) };
    });
    const tooWide = seen.filter((x) => x && x.need > x.room + 0.5);
    for (const x of tooWide) x.name.style.fontSize = `${Math.max(6, Math.floor(x.size * (x.room / x.need) * 2 - 0.2) / 2)}px`;
    const over = (name) => name.scrollWidth > name.clientWidth + 0.5;
    for (const x of tooWide) {
      const name = x.name;
      if (!over(name)) continue;
      const full = name.dataset.full;
      name.style.fontSize = '8px';
      for (let n = Math.min(4, full.length - 1); n >= 1; n--) {
        name.textContent = full.slice(0, n);
        if (!over(name)) break;
      }
      if (over(name)) name.style.fontSize = '6px';
    }
  }

  window.addEventListener('resize', layout);
  // (the names are measured again once the fonts have loaded: measured before, a name could be
  // shortened that fits)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { laidOut = ''; layout(); }).catch(() => {});
  window.addEventListener('load', () => { laidOut = ''; layout(); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(bar);

  // ---- Which place is lit: the home's pane, or the open panel (and the bar shows it) ----
  function current() {
    const openName = !viewer.hidden ? $('viewer-name').textContent : '';
    for (const b of bar.querySelectorAll('[data-tab]')) {
      const t = b.dataset.tab;
      const on = t.startsWith('pane:') ? !openName && main.dataset.pane === t.slice(5) : Boolean(openName) && nameOf(tile(t)) === openName;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    clear.hidden = Boolean(openName) || main.dataset.pane !== 'chat';
    layout();
    // On a sliding row, the lit place is brought into view (inside the row only: the page never moves)
    const lit = row.querySelector('[aria-current="page"]');
    if (lit && row.scrollWidth > row.clientWidth + 1) {
      const r = row.getBoundingClientRect(), b = lit.getBoundingClientRect();
      if (b.left < r.left || b.right > r.right) row.scrollLeft += b.left - r.left - (r.width - b.width) / 2;
    }
    if (sheet.open) fillGear();
  }

  // ---- The gear: settings, and reloading the open panel ----
  const sheet = document.createElement('dialog');
  sheet.className = 'more-sheet';
  sheet.id = 'more-sheet';
  sheet.setAttribute('aria-label', 'Settings');
  document.body.append(sheet);
  const btn = (act, label, ico) => `<button type="button" data-act="${act}">${ico}<span>${label}</span></button>`;
  const g = (x) => `<span class="g" aria-hidden="true">${x}</span>`;
  function fillGear() {
    const openName = !viewer.hidden ? $('viewer-name').textContent : '';
    const sfxOn = window.NovaSfx ? window.NovaSfx.enabled() : false;
    const musicOn = window.NovaAmbient ? window.NovaAmbient.isPlaying() : false;
    const extraOn = window.NovaSfx && window.NovaSfx.extraEnabled ? window.NovaSfx.extraEnabled() : false;
    const canInstall = $('install') && !$('install').hidden;
    sheet.innerHTML = `<div class="grab" aria-hidden="true"></div>
      <h4>Settings</h4>
      <div class="more-grid">
        ${openName ? btn('reload-panel', `Reload ${openName}`, g('↻')) : ''}
        ${window.NovaSettings && window.NovaSettings.panel() ? btn('panel-settings', `${openName} settings`, g('⚙')) : ''}
        ${btn('rhythm', 'Your rhythm', g('⚙'))}
        ${btn('sfx', sfxOn ? 'Sound: on' : 'Sound: off', g(sfxOn ? '🔊' : '🔈'))}
        ${btn('music', musicOn ? 'Music: on' : 'Music: off', g(musicOn ? '♫' : '♪'))}
        ${window.NovaBar ? btn('bar', `Bar: ${window.NovaBar.name()}`, g('▤')) : ''}
        ${window.NovaBar ? btn('top', `Top bar: ${window.NovaBar.name(window.NovaBar.topMode())}`, g('▔')) : ''}
        ${btn('look', 'Theme & look', g('◐'))}
        ${btn('app', 'Install or remove app', g('⤓'))}
        ${btn('app-help', 'App help', g('?'))}
        ${window.NovaStatus ? btn('status', `Status: ${window.NovaStatus.name()}`, g('ⓘ')) : ''}
        ${sfxOn ? btn('sfx-extra', extraOn ? 'Quiet extras: on' : 'Quiet extras: off', g(extraOn ? '≋' : '∼')) : ''}
        ${tile('/admin/links') ? btn('links', 'All links', tileIcon('/admin/links', 'g')) : ''}
        ${canInstall ? btn('install', 'Install app', g('⤓')) : btn('reload', 'Refresh app', g('⟳'))}
      </div>
      <button type="button" class="more-close" data-act="close">Close</button>`;
  }
  gear.addEventListener('click', () => {
    // A computer: the gear opens the Panels window (every panel, the theme and the bars' settings)
    if (!PHONE.matches) { const b = $('suite-btn'); if (b) b.click(); return; }
    fillGear();
    if (!sheet.open) sheet.showModal();
    sfx('open');
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return sheet.close();
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    sheet.close();
    if (act === 'reload-panel') { const r = $('viewer-reload'); if (r) r.click(); return; }
    if (act === 'panel-settings') { const p = window.NovaSettings && window.NovaSettings.panel(); if (p) p.open(); return; }
    if (act === 'rhythm') { if (window.NovaAgent) window.NovaAgent.open('/quests/?rhythm=1'); return; } // (your rhythm is in Quests: 24 Oct 2026)
    if (act === 'sfx') { const s = $('sfx-btn'); if (s) s.click(); return; }
    if (act === 'music') { const m = $('music-btn'); if (m) m.click(); return; }
    if (act === 'bar') { if (window.NovaBar) window.NovaBar.next(); return; }
    if (act === 'top') { if (window.NovaBar) window.NovaBar.nextTop(); return; }
    if (act === 'look') { const b = $('suite-btn'); if (b) b.click(); return; }
    if (act === 'app') { if (window.NovaInstall) window.NovaInstall.open(); return; }
    if (act === 'app-help') { if (window.NovaInstall) window.NovaInstall.help(); return; }
    if (act === 'status') { if (window.NovaStatus) window.NovaStatus.next(); return; }
    if (act === 'sfx-extra') { if (window.NovaSfx) window.NovaSfx.toggleExtra(); return; }
    // All links: opened itself, like its tile in the Panels window (not Portal with it inside)
    if (act === 'links') return window.NovaAgent && window.NovaAgent.open('/admin/links');
    if (act === 'install') { const i = $('install'); if (i) i.click(); return; }
    if (act === 'reload') location.reload();
  });

  // ---- The phone's back button (or swipe) closes what's open instead of leaving Nova Agent ----
  // A window or sheet first (the settings, the Backend, the Panels window...), then an open panel.
  // On phones and on tablets (any touch screen), where Back is the system's own gesture.
  const TOUCH = matchMedia('(pointer: coarse)');
  const backOn = () => PHONE.matches || TOUCH.matches;
  let byBack = false;
  let skipPop = 0; // our own history.back() (something closed by its own button): nothing more to close
  const byBackDialogs = new WeakSet();
  function panelShown() {
    if (!backOn()) return;
    if (!(history.state && history.state.novaPanel)) history.pushState({ novaPanel: true }, '', location.href);
  }
  function panelHidden() {
    if (byBack) { byBack = false; return; }
    if (history.state && history.state.novaPanel) { skipPop++; history.back(); }
  }
  const openDialogs = () => [...document.querySelectorAll('dialog[open]')];
  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop--; return; }
    const top = openDialogs().pop();
    if (top) { byBackDialogs.add(top); top.close(); return; }
    if (!viewer.hidden) { byBack = true; closePanel(); }
  });
  new MutationObserver((records) => {
    for (const r of records) {
      const d = r.target;
      if (!(d instanceof HTMLDialogElement) || d.open === (r.oldValue !== null)) continue;
      if (d.open) { if (backOn()) history.pushState({ novaDialog: true }, '', location.href); }
      else if (byBackDialogs.has(d)) byBackDialogs.delete(d);
      else if (history.state && history.state.novaDialog) { skipPop++; history.back(); }
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });
  let wasOpen = !viewer.hidden;
  new MutationObserver(() => {
    const isOpen = !viewer.hidden;
    if (isOpen !== wasOpen) { if (isOpen) panelShown(); else panelHidden(); }
    wasOpen = isOpen;
    current();
  }).observe(viewer, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(current).observe($('viewer-name'), { childList: true, characterData: true, subtree: true });

  main.dataset.pane = saved;
  document.addEventListener('DOMContentLoaded', () => {
    fillBar();
    // The page puts the cursor in the message box; on a phone that would pop the keyboard up
    if (PHONE.matches && document.activeElement === $('input')) $('input').blur();
    if (!viewer.hidden) panelShown();
    setPane(main.dataset.pane);
    fit();
    if (toQuests && PHONE.matches && viewer.hidden) open('/quests/');
  });
})();
