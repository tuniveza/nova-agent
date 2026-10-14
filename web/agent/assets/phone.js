// Nova Agent on a phone (or a small window): one bar along the bottom that never goes away, with
// every place in Nova Agent on it (Portal, Agent, Calendar, Notes, Quests, Missions, Index,
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
  // A phone held upright: the bar keeps the everyday places and the rest go behind More (phone.css)
  const NARROW = matchMedia('(max-width: 600px)');
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
    (first.parentElement || viewer).append(frame); // beside the first, in the panel's box
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

  // ---- The home: Agent, Quests or Missions, one at a time (picked on the bar) ----
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
  if (!['chat', 'missions'].includes(saved)) saved = 'chat';

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
  // Apps (Portal, Agent, Calendar, Notes, Index) · Plans (Quests, Today, Missions) · Tools (Lossless,
  // Visualizer, Console) · Helpers (Observatory, Manual). Any other panel joins Tools.
  // On a narrow phone only Portal, Agent, Calendar, Notes and Quests stay on the bar, with a More
  // button for the rest (a sheet with the same icons; they open just the same)
  const SKIP = ['/admin/links']; // All links: behind the gear
  const GROUPS = [
    ['apps', 'Apps', ['/portal/', 'pane:chat', '/calendar/', '/notes/', '/board/', '/app/memory/']], // Portal first, Agent second
    ['tasks', 'Plans', ['/quests/', 'pane:missions']],
    ['tools', 'Tools', ['/lossless/', '/visualizer', '/console/']],
    ['helpers', 'Helpers', ['/observatory/', 'manual']],
  ];
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.id = 'tabbar';
  bar.setAttribute('aria-label', 'Nova Agent');
  const STAYS = ['/portal/', 'pane:chat', '/calendar/', '/notes/', '/quests/']; // on the narrow bar; the rest are behind More
  const item = (key, label, icon) => `<button type="button" data-tab="${key}"${STAYS.includes(key) ? '' : ' class="in-more"'}>${icon}<span>${label}</span></button>`;
  const glyph = (g) => `<span class="t-ico g" aria-hidden="true">${g}</span>`;
  // The panels' own icons (chat.html's .pico set: each its own colour, tinted by the theme)
  const pico = (k) => `<span class="pico t-ico" data-p="${k}" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#pi-${k}"/></svg></span>`;
  const FIXED = {
    'pane:chat': () => item('pane:chat', 'Agent', pico('chat')),
    'pane:missions': () => item('pane:missions', 'Missions', pico('missions')),
    manual: () => item('manual', 'Manual', pico('manual')),
  };
  // The bar keeps its short labels: "Notes" in the launcher is "Notes" here
  const panelItem = (p) => (tile(p) ? item(p, nameOf(tile(p)).replace(/^Nova /, '').replace('Lossless audio', 'Lossless'), tileIcon(p, 't-ico')) : '');
  const MORE_ORDER = ['pane:missions', '/board/', '/app/memory/', '/lossless/', '/visualizer', '/observatory/', 'manual'];
  let moreKeys = [];
  function fillBar() {
    const placed = new Set(GROUPS.flatMap((g) => g[2]));
    const extra = tiles().map((a) => a.dataset.inside).filter((p) => !placed.has(p) && !SKIP.includes(p));
    bar.innerHTML = GROUPS.map(([id, label, keys]) => {
      const items = (id === 'tools' ? [...keys, ...extra] : keys).map((k) => (FIXED[k] ? FIXED[k]() : panelItem(k))).join('');
      return `<div class="tgroup" data-group="${id}" role="group" aria-label="${label}"><span class="tg-label" aria-hidden="true">${label}</span><div class="tg-items">${items}</div></div>`;
    }).join('') +
      `<div class="tgroup" data-group="more" role="group" aria-label="More"><span class="tg-label" aria-hidden="true">&nbsp;</span><div class="tg-items"><button type="button" class="tb-more" data-more aria-haspopup="dialog" aria-controls="places-sheet"><span class="t-ico g" aria-hidden="true">⋯</span><span>More</span></button></div></div>`;
    // Behind More: Missions, Index, Lossless, Visualizer, Observatory, Manual (and any other panel)
    moreKeys = [...MORE_ORDER, ...extra].filter((k) => bar.querySelector(`[data-tab="${k}"]`));
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
    if (pane === 'quests') { open('/quests/'); return; } // (old links to today's plan: Quests, on Today)
    if (PHONE.matches) { setPane(pane); sfx('open'); return; }
    const box = $(pane === 'quests' ? 'quests-panel' : 'missions-panel');
    if (box) {
      box.scrollIntoView({ behavior: STILL.matches ? 'auto' : 'smooth', block: 'nearest' });
      box.animate && !STILL.matches && box.animate([{ boxShadow: '0 0 0 0 transparent' }, { boxShadow: '0 0 0 3px var(--hi), 0 0 40px -6px var(--hi)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1100 });
    }
    sfx('open');
  }, true);
  // A place on the bar (or in More) opens the same way wherever it's tapped
  function go(t) {
    if (t === 'pane:quests') { open('/quests/'); return; } // (today's plan is Quests now)
    if (t.startsWith('pane:')) { closePanel(); setPane(t.slice(5)); sfx('open'); return; }
    if (t === 'manual') { if (window.NovaManual) window.NovaManual.open(); return; }
    open(t);
  }
  bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { openMore(); return; }
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    go(b.dataset.tab);
  });
  // Each group's width follows how many places it holds (on a narrow phone, the ones still on the
  // bar); and the bar's height for whatever sits above it (toasts)
  function layout() {
    const shown = NARROW.matches ? '[data-tab]:not(.in-more), [data-more]' : '[data-tab]';
    for (const g of bar.querySelectorAll('.tgroup')) g.style.setProperty('--k', g.querySelectorAll(shown).length || 1);
    // In one row (a tablet, a short or zoomed-in window, a phone on its side) every place is the same
    // width, whatever its group: phone.css shares the row out by how many places are showing
    bar.style.setProperty('--tab-n', [...bar.querySelectorAll('.tgroup:not([data-group="more"])')].reduce((n, g) => n + g.querySelectorAll(shown).length, 0) || 14);
    document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight || 126}px`);
  }
  window.addEventListener('resize', layout);
  NARROW.addEventListener('change', () => { if (!NARROW.matches && places.open) places.close(); current(); });

  // ---- More (a narrow phone): the places that aren't on the bar, in a calm sheet ----
  // Same icons and the same opening as on the bar; Escape, Close or a tap outside put it away
  const places = document.createElement('dialog');
  places.className = 'more-sheet places-sheet';
  places.id = 'places-sheet';
  places.setAttribute('aria-label', 'More places');
  document.body.append(places);
  function fillMore() {
    const buttons = moreKeys.map((k) => bar.querySelector(`[data-tab="${k}"]`).outerHTML.replace(' class="in-more"', '')).join('');
    places.innerHTML = `<div class="grab" aria-hidden="true"></div><h4>More</h4><div class="more-grid">${buttons}</div><button type="button" class="more-close" data-close>Close</button>`;
    current();
  }
  function openMore() {
    fillMore();
    if (!places.open) places.showModal();
    const here = places.querySelector('[aria-current="page"]') || places.querySelector('[data-tab]');
    if (here) here.focus();
    sfx('open');
  }
  places.addEventListener('click', (e) => {
    if (e.target === places || e.target.closest('[data-close]')) { places.close(); return; }
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    places.close();
    go(b.dataset.tab);
  });
  places.addEventListener('close', () => { const m = bar.querySelector('[data-more]'); if (m && NARROW.matches) m.focus({ preventScroll: true }); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(layout).observe(bar);

  // ---- Which place is lit: the home's pane, or the open panel (and the bar shows it) ----
  function current() {
    const openName = !viewer.hidden ? $('viewer-name').textContent : '';
    for (const b of [...bar.querySelectorAll('[data-tab]'), ...places.querySelectorAll('[data-tab]')]) {
      const t = b.dataset.tab;
      const on = t.startsWith('pane:') ? !openName && main.dataset.pane === t.slice(5) : Boolean(openName) && nameOf(tile(t)) === openName;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
    // On a narrow phone, a place behind More that's open lights More up
    const more = bar.querySelector('[data-more]');
    if (more) {
      if (NARROW.matches && bar.querySelector('.in-more[aria-current="page"]')) more.setAttribute('aria-current', 'page');
      else more.removeAttribute('aria-current');
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
        ${window.NovaSettings && window.NovaSettings.panel() ? btn('panel-settings', `${openName} settings`, g('⚙')) : ''}
        ${btn('rhythm', 'Your rhythm', g('⚙'))}
        ${btn('new-mission', 'New mission', g('+'))}
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
    if (act === 'rhythm') { const r = $('btn-rhythm'); if (r) r.click(); return; }
    if (act === 'new-mission') { closePanel(); setPane('missions'); const n = $('new-mission-btn'); if (n) n.click(); return; }
    if (act === 'sfx') { const s = $('sfx-btn'); if (s) s.click(); return; }
    if (act === 'music') { const m = $('music-btn'); if (m) m.click(); return; }
    if (act === 'bar') { if (window.NovaBar) window.NovaBar.next(); return; }
    if (act === 'top') { if (window.NovaBar) window.NovaBar.nextTop(); return; }
    if (act === 'look') { const b = $('suite-btn'); if (b) b.click(); return; }
    if (act === 'app') { if (window.NovaInstall) window.NovaInstall.open(); return; }
    if (act === 'app-help') { if (window.NovaInstall) window.NovaInstall.help(); return; }
    if (act === 'status') { if (window.NovaStatus) window.NovaStatus.next(); return; }
    if (act === 'sfx-extra') { if (window.NovaSfx) window.NovaSfx.toggleExtra(); return; }
    // Admin things live in Portal → Admin
    if (act === 'links') return window.NovaAgent && window.NovaAgent.open('/portal/?view=manage&page=' + encodeURIComponent('/admin/links'));
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
    if (toQuests && PHONE.matches && viewer.hidden) open('/quests/');
  });
})();
