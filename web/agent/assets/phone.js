// Nova Agent on a phone (or a small window): the bar along the bottom, the More sheet, the home's
// Chat · Quests · Missions switch, sizing to the visible screen (so the keyboard never hides the
// message box), the phone's back button closing an open panel, and a readable status.
// Loaded before the page's own script (chat.html), so the star sky can be skipped on a phone.
// The look is in phone.css; on a computer all of this stays out of the way.
(function () {
  'use strict';
  const PHONE = matchMedia('(max-width: 980px), (max-height: 600px)');
  const $ = (id) => document.getElementById(id);
  const main = $('main'), shell = $('shell'), viewer = $('viewer');
  if (!main || !shell || !viewer) return;
  const root = document.documentElement;

  // ---- Switching panels doesn't pile up "back" steps: the panel's frame is replaced, not stacked ----
  // (So the phone's back button closes the panel, below, instead of stepping through old panels.)
  const frame = $('viewer-frame');
  const srcProp = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  if (frame && srcProp) {
    let shown = '';
    Object.defineProperty(frame, 'src', {
      configurable: true,
      get() { return shown || srcProp.get.call(frame); },
      set(value) {
        const url = new URL(String(value), location.href).href;
        shown = url;
        try {
          const w = frame.contentWindow;
          if (w && frame.getAttribute('src')) { w.location.replace(url); return; }
        } catch (e) {}
        srcProp.set.call(frame, value);
      },
    });
  }

  // ---- Lighter on a phone: no moving star sky (backdrop.js) behind everything ----
  if (PHONE.matches && window.NT && NT.backdrop) NT.backdrop.init = () => {};

  // ---- Sized to what's visible: the keyboard shrinks it, and the bars step aside while typing ----
  const vv = window.visualViewport;
  function fit() {
    if (!vv) return;
    root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    const typing = document.activeElement && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName);
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

  const icon = {
    chat: '<svg class="t-ico" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-mark"/></svg>',
    more: '<span class="t-ico dots" aria-hidden="true"><i></i><i></i><i></i></span>',
    trash: '<svg class="ico" aria-hidden="true"><use href="#i-clear"/></svg>',
  };
  const tile = (address) => document.querySelector(`#suite a.suite-app[data-inside="${address}"]`);
  const tileIcon = (address, cls) => {
    const t = tile(address);
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

  // ---- The home: Chat · Quests · Missions, one at a time ----
  const seg = document.createElement('div');
  seg.className = 'home-seg';
  seg.id = 'home-seg';
  seg.innerHTML = `<div class="seg" role="tablist" aria-label="Nova Agent">
      <button type="button" role="tab" data-pane="chat">Chat</button>
      <button type="button" role="tab" data-pane="quests">Quests</button>
      <button type="button" role="tab" data-pane="missions">Missions</button>
    </div>
    <button type="button" class="icon-btn" id="phone-clear" title="Start a new chat" aria-label="Start a new chat">${icon.trash}</button>`;
  viewer.after(seg);
  const PANE_KEY = 'nova-agent/phone-pane';
  function setPane(pane) {
    main.dataset.pane = pane;
    for (const b of seg.querySelectorAll('[data-pane]')) b.setAttribute('aria-selected', String(b.dataset.pane === pane));
    $('phone-clear').hidden = pane !== 'chat';
    try { sessionStorage.setItem(PANE_KEY, pane); } catch (e) {}
    current();
  }
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pane]');
    if (b) setPane(b.dataset.pane);
  });
  $('phone-clear').addEventListener('click', () => { const c = $('clear'); if (c) c.click(); });
  let saved = 'chat';
  try { saved = sessionStorage.getItem(PANE_KEY) || 'chat'; } catch (e) {}
  if (!['chat', 'quests', 'missions'].includes(saved)) saved = 'chat';

  // ---- The bar along the bottom: Chat · Portal · Calendar · Notes · More ----
  const bar = document.createElement('nav');
  bar.className = 'tabbar';
  bar.id = 'tabbar';
  bar.setAttribute('aria-label', 'Nova Agent');
  bar.innerHTML = `
    <button type="button" data-tab="chat">${icon.chat}<span>Chat</span></button>
    <button type="button" data-tab="/portal/">${tileIcon('/portal/', 't-ico')}<span>Portal</span></button>
    <button type="button" data-tab="/calendar/">${tileIcon('/calendar/', 't-ico')}<span>Calendar</span></button>
    <button type="button" data-tab="/notes/">${tileIcon('/notes/', 't-ico')}<span>Notes</span></button>
    <button type="button" data-tab="more">${icon.more}<span>More</span></button>`;
  shell.append(bar);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const t = b.dataset.tab;
    if (t === 'more') return showMore();
    if (t === 'chat') { closePanel(); setPane('chat'); return; }
    open(t);
  });

  // ---- More: everything, one tap away ----
  const sheet = document.createElement('dialog');
  sheet.className = 'more-sheet';
  sheet.id = 'more-sheet';
  sheet.setAttribute('aria-label', 'Everything in Nova Agent');
  document.body.append(sheet);
  const btn = (act, label, ico, extra = '') => `<button type="button" data-act="${act}" ${extra}>${ico}<span>${label}</span></button>`;
  const glyph = (g) => `<span class="g" aria-hidden="true">${g}</span>`;
  function fillMore() {
    const panels = [...document.querySelectorAll('#suite .suite-group:not(.tools) a.suite-app[data-inside]')];
    const tools = [...document.querySelectorAll('#suite .suite-group.tools a.suite-app[data-inside]')];
    const openName = !viewer.hidden ? $('viewer-name').textContent : '';
    const here = (name) => (name === openName ? 'aria-current="page"' : '');
    const sfxOn = window.NovaSfx ? window.NovaSfx.enabled() : false;
    const canInstall = $('install') && !$('install').hidden;
    sheet.innerHTML = `<div class="grab" aria-hidden="true"></div>
      <h4>Nova Agent</h4>
      <div class="more-grid">
        ${btn('pane:chat', 'Chat', glyph('✦'), !openName && main.dataset.pane === 'chat' ? 'aria-current="page"' : '')}
        ${btn('pane:quests', 'Quests', glyph('☰'), !openName && main.dataset.pane === 'quests' ? 'aria-current="page"' : '')}
        ${btn('pane:missions', 'Missions', glyph('◆'), !openName && main.dataset.pane === 'missions' ? 'aria-current="page"' : '')}
        ${btn('new-mission', 'New mission', glyph('+'))}
      </div>
      <h4>Panels</h4>
      <div class="more-grid">
        ${panels.map((a) => { const name = a.querySelector('b').textContent; return btn('open:' + a.dataset.inside, name, tileIcon(a.dataset.inside, 'g'), here(name)); }).join('')}
      </div>
      <h4>Services and admin</h4>
      <div class="more-grid">
        ${tools.map((a) => { const name = a.querySelector('b').textContent.replace('All links and services', 'All links'); return btn('open:' + a.dataset.inside, name, tileIcon(a.dataset.inside, 'g'), here(a.querySelector('b').textContent)); }).join('')}
      </div>
      <h4>This app</h4>
      <div class="more-grid">
        ${btn('manual', 'Manual', glyph('📖'))}
        ${btn('rhythm', 'Your rhythm', glyph('⚙'))}
        ${btn('sfx', sfxOn ? 'Sound: on' : 'Sound: off', glyph(sfxOn ? '🔊' : '🔈'))}
        ${canInstall ? btn('install', 'Install app', glyph('⤓')) : btn('reload', 'Refresh', glyph('↻'))}
      </div>
      <button type="button" class="more-close" data-act="close">Close</button>`;
  }
  function showMore() {
    fillMore();
    if (!sheet.open) sheet.showModal();
    window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play('open');
  }
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return sheet.close();
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    sheet.close();
    if (act.startsWith('pane:')) { closePanel(); setPane(act.slice(5)); return; }
    if (act.startsWith('open:')) return open(act.slice(5));
    if (act === 'new-mission') { closePanel(); setPane('missions'); const n = $('new-mission-btn'); if (n) n.click(); return; }
    if (act === 'rhythm') { const r = $('btn-rhythm'); if (r) r.click(); return; }
    if (act === 'manual') { if (window.NovaManual) window.NovaManual.open(); return; }
    if (act === 'sfx') { const s = $('sfx-btn'); if (s) s.click(); return; }
    if (act === 'install') { const i = $('install'); if (i) i.click(); return; }
    if (act === 'reload') location.reload();
  });

  // On a phone the open panel's name (above it) opens More to switch, instead of the big launcher
  document.addEventListener('click', (e) => {
    if (!PHONE.matches || !e.target.closest('#viewer-name')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showMore();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!PHONE.matches || !e.target.closest || !e.target.closest('#viewer-name') || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    showMore();
  }, true);

  // ---- Which tab is lit: Chat on the home, or the open panel's ----
  function current() {
    const openName = !viewer.hidden ? $('viewer-name').textContent : '';
    for (const b of bar.querySelectorAll('[data-tab]')) {
      const t = b.dataset.tab;
      const on = t === 'chat' ? !openName : t !== 'more' && openName && (tile(t) || {}).textContent && tile(t).querySelector('b').textContent === openName;
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

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
    if (sheet.open) fillMore();
  }).observe(viewer, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(current).observe($('viewer-name'), { childList: true, characterData: true, subtree: true });

  setPane(saved);
  document.addEventListener('DOMContentLoaded', () => {
    // The page puts the cursor in the message box; on a phone that would pop the keyboard up
    if (PHONE.matches && document.activeElement === $('input')) $('input').blur();
    if (!viewer.hidden) panelShown();
    current();
    fit();
  });
})();
