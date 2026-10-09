// Nova Agent on a phone (or a small window): one bar along the bottom that never goes away, with
// every place in Nova Agent on it (Chat, Portal, Calendar, Notes, Quests, Missions, Index,
// Observatory, Lossless audio, Admin, Visualizer, Manual: swipe it sideways for the rest); the
// panels open between the header and the bar, and the last few stay loaded so switching back is
// instant. Settings (rhythm, sound, music, refresh, all links) are behind the gear in the header.
// Also: sizing to the visible screen (so the keyboard never hides the message box), the phone's
// back button closing an open panel, and a readable status.
// Loaded before the page's own script (chat.html), so the star sky can be skipped on a phone.
// The look is in phone.css; on a computer all of this stays out of the way.
(function () {
  'use strict';
  const PHONE = matchMedia('(max-width: 980px), (max-height: 480px)');
  const STILL = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (id) => document.getElementById(id);
  const main = $('main'), shell = $('shell'), viewer = $('viewer');
  if (!main || !shell || !viewer) return;
  const root = document.documentElement;

  // ---- The tiles in the launcher say what each panel is called, where it is and its icon ----
  const tiles = () => [...document.querySelectorAll('#suite a.suite-app[data-inside]')];
  const tile = (address) => document.querySelector(`#suite a.suite-app[data-inside="${address}"]`);
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
  // On a phone the last three panels stay loaded (each in its own frame, the others hidden), so
  // going back to one is instant and it's where you left it. Switching never piles up "back" steps:
  // a frame that's already showing a page is moved on, not stacked. On a computer: one frame.
  const srcProp = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  const KEEP = 3;
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
    viewer.append(frame);
    return frame;
  }
  function loading(frame) {
    frame.classList.add('loading');
    frame.addEventListener('load', () => frame.classList.remove('loading'), { once: true });
  }
  // What the page's own script does to "the frame" (open a panel, reload it, close it) comes here
  function show(value, entry) {
    const url = new URL(value, location.href).href;
    // Closing a panel: on a phone it stays loaded (just hidden with the viewer); on a computer it's emptied
    if (url === 'about:blank') {
      if (PHONE.matches) return;
      entry.shown = '';
      srcProp.set.call(entry.frame, url);
      return;
    }
    if (!PHONE.matches) {
      // A computer: the one frame, moved on (or reloaded)
      if (entry.shown === url) { try { entry.frame.contentWindow.location.reload(); return; } catch (e) {} }
      return navigate(entry, url);
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
  function fit() {
    if (!vv) return;
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    // Typing here, or in a panel (its frame has the focus then)
    const typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT|IFRAME)$/.test(document.activeElement.tagName);
    root.classList.toggle('kb', PHONE.matches && typing && vv.height < window.innerHeight - 120);
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

  // ---- The home: Chat, Quests or Missions, one at a time (picked on the bar) ----
  const PANE_KEY = 'nova-agent/phone-pane';
  function setPane(pane) {
    main.dataset.pane = pane;
    try { sessionStorage.setItem(PANE_KEY, pane); } catch (e) {}
    current();
  }
  let saved = 'chat';
  try { saved = sessionStorage.getItem(PANE_KEY) || 'chat'; } catch (e) {}
  if (!['chat', 'quests', 'missions'].includes(saved)) saved = 'chat';

  // ---- The header: a fresh-chat button (on the chat) and the gear (settings) ----
  const left = document.querySelector('.topbar .top-side.left');
  const right = document.querySelector('.topbar .top-side.right');
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'icon-btn phone-only';
  clear.id = 'phone-clear';
  clear.title = 'Start a new conversation';
  clear.setAttribute('aria-label', 'Start a new conversation');
  clear.innerHTML = svg('i-clear');
  clear.addEventListener('click', () => { const c = $('clear'); if (c) c.click(); });
  if (left) left.append(clear);
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'icon-btn phone-only';
  gear.id = 'phone-gear';
  gear.title = PHONE.matches ? 'Settings' : 'Look & layout: theme, bars, text';
  gear.setAttribute('aria-label', PHONE.matches ? 'Settings' : 'Look and layout');
  gear.setAttribute('aria-haspopup', 'dialog');
  gear.innerHTML = svg('i-tune');
  if (right) right.append(gear);

  // ---- The bar along the bottom: every place in Nova Agent, always there, in four groups ----
  // Apps (Chat, Portal, Calendar, Notes, Index) · Tasks (Quests, Missions) · Tools (Lossless,
  // Visualizer) · Helpers (Observatory, Manual). Any other panel joins Tools.
  const SKIP = ['/admin/links']; // All links: behind the gear
  const GROUPS = [
    ['apps', 'Apps', ['pane:chat', '/calendar/', '/portal/', '/notes/', '/app/memory/']], // Portal in the middle
    ['tasks', 'Tasks', ['pane:quests', 'pane:missions']],
    ['tools', 'Tools', ['/lossless/', '/visualizer']],
    ['helpers', 'Helpers', ['/observatory/', 'manual']],
  ];
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.id = 'tabbar';
  bar.setAttribute('aria-label', 'Nova Agent');
  const item = (key, label, icon) => `<button type="button" data-tab="${key}">${icon}<span>${label}</span></button>`;
  const glyph = (g) => `<span class="t-ico g" aria-hidden="true">${g}</span>`;
  // The panels' own icons (chat.html's .pico set: each its own colour, tinted by the theme)
  const pico = (k) => `<span class="pico t-ico" data-p="${k}" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#pi-${k}"/></svg></span>`;
  const FIXED = {
    'pane:chat': () => item('pane:chat', 'Agent', pico('chat')),
    'pane:quests': () => item('pane:quests', 'Quests', pico('quests')),
    'pane:missions': () => item('pane:missions', 'Missions', pico('missions')),
    manual: () => item('manual', 'Manual', pico('manual')),
  };
  const panelItem = (p) => (tile(p) ? item(p, nameOf(tile(p)).replace('Lossless audio', 'Lossless'), tileIcon(p, 't-ico')) : '');
  function fillBar() {
    const placed = new Set(GROUPS.flatMap((g) => g[2]));
    const extra = tiles().map((a) => a.dataset.inside).filter((p) => !placed.has(p) && !SKIP.includes(p));
    bar.innerHTML = GROUPS.map(([id, label, keys]) => {
      const items = (id === 'tools' ? [...keys, ...extra] : keys).map((k) => (FIXED[k] ? FIXED[k]() : panelItem(k))).join('');
      return `<div class="tgroup" data-group="${id}" role="group" aria-label="${label}"><span class="tg-label" aria-hidden="true">${label}</span><div class="tg-items">${items}</div></div>`;
    }).join('');
    current();
  }
  shell.append(bar);

  // Tasks and Helpers in the panels list (computer and phone): Quests and Missions are Nova Agent's own
  // panes, the Manual opens over everything; none of them leave the page
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a.suite-app[data-pane], a.suite-app[data-act]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const dlg = $('suite');
    if (dlg && dlg.open) dlg.close();
    if (a.dataset.act === 'manual') { if (window.NovaManual) window.NovaManual.open(); return; }
    if (!viewer.hidden) $('viewer-close').click();
    const pane = a.dataset.pane;
    if (PHONE.matches) { setPane(pane); sfx('open'); return; }
    const box = $(pane === 'quests' ? 'quests-panel' : 'missions-panel');
    if (box) {
      box.scrollIntoView({ behavior: STILL.matches ? 'auto' : 'smooth', block: 'nearest' });
      box.animate && !STILL.matches && box.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--hi), 0 0 40px -6px var(--hi)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1100 });
    }
    sfx('open');
  }, true);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const t = b.dataset.tab;
    if (t.startsWith('pane:')) { closePanel(); setPane(t.slice(5)); sfx('open'); return; }
    if (t === 'manual') { if (window.NovaManual) window.NovaManual.open(); return; }
    open(t);
  });
  // Each group's width follows how many places it holds; and the bar's height for whatever sits above it (toasts)
  function layout() {
    for (const g of bar.querySelectorAll('.tgroup')) g.style.setProperty('--k', g.querySelectorAll('[data-tab]').length || 1);
    document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight || 126}px`);
  }
  window.addEventListener('resize', layout);
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
        ${btn('rhythm', 'Your rhythm', g('⚙'))}
        ${btn('new-mission', 'New mission', g('+'))}
        ${btn('sfx', sfxOn ? 'Sound: on' : 'Sound: off', g(sfxOn ? '🔊' : '🔈'))}
        ${btn('music', musicOn ? 'Music: on' : 'Music: off', g(musicOn ? '♫' : '♪'))}
        ${window.NovaBar ? btn('bar', `Bar: ${window.NovaBar.name()}`, g('▤')) : ''}
        ${window.NovaBar ? btn('top', `Top bar: ${window.NovaBar.name(window.NovaBar.topMode())}`, g('▔')) : ''}
        ${btn('look', 'Theme & look', g('◐'))}
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
    if (act === 'rhythm') { const r = $('btn-rhythm'); if (r) r.click(); return; }
    if (act === 'new-mission') { closePanel(); setPane('missions'); const n = $('new-mission-btn'); if (n) n.click(); return; }
    if (act === 'sfx') { const s = $('sfx-btn'); if (s) s.click(); return; }
    if (act === 'music') { const m = $('music-btn'); if (m) m.click(); return; }
    if (act === 'bar') { if (window.NovaBar) window.NovaBar.next(); return; }
    if (act === 'top') { if (window.NovaBar) window.NovaBar.nextTop(); return; }
    if (act === 'look') { const b = $('suite-btn'); if (b) b.click(); return; }
    if (act === 'status') { if (window.NovaStatus) window.NovaStatus.next(); return; }
    if (act === 'sfx-extra') { if (window.NovaSfx) window.NovaSfx.toggleExtra(); return; }
    if (act === 'links') return open('/admin/links');
    if (act === 'install') { const i = $('install'); if (i) i.click(); return; }
    if (act === 'reload') location.reload();
  });

  // ---- The phone's back button (or swipe) closes an open panel instead of leaving Nova Agent ----
  let byBack = false;
  function panelShown() {
    if (!PHONE.matches) return;
    if (!(history.state && history.state.novaPanel)) history.pushState({ novaPanel: true }, '', location.href);
  }
  function panelHidden() {
    if (byBack) { byBack = false; return; }
    if (history.state && history.state.novaPanel) history.back();
  }
  window.addEventListener('popstate', () => {
    if (!viewer.hidden) { byBack = true; closePanel(); }
  });
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
  });
})();
