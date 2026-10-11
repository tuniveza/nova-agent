// Quest modes: how a quest is going, the same everywhere (Notes, Nova Agent's front page, Portal).
// Nova Quests keeps them (src/quests/store.ts MODES); this draws the chips and the menu to pick one.
//   NovaQuestModes.list                    [{ id, name }]
//   NovaQuestModes.name(id)                "Working On It"
//   NovaQuestModes.chip(id, attrs?)        a <button class="qm-chip"> (HTML), or a <span> with { tag: 'span' }
//   NovaQuestModes.pick(anchor, current)   the menu by `anchor`: resolves with the mode picked (or null)
// The colours are in quest-modes.css (each mode its own hue, tinted toward the theme).
(function () {
  'use strict';
  if (window.NovaQuestModes) return;
  const LIST = [
    { id: 'waiting', name: 'Waiting' },
    { id: 'soon', name: 'Soon' },
    { id: 'working', name: 'Working On It' },
    { id: 'nearly', name: 'Nearly Finished' },
    { id: 'longer', name: 'Taking longer than expected' },
    { id: 'questions', name: 'Questions' },
    { id: 'done', name: 'Done' },
  ];
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const valid = (id) => (LIST.some((m) => m.id === id) ? id : 'waiting');
  const name = (id) => LIST.find((m) => m.id === valid(id)).name;
  function chip(id, attrs = {}) {
    const { tag = 'button', ...rest } = attrs;
    const extra = Object.entries(rest).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const m = valid(id);
    return tag === 'button'
      ? `<button type="button" class="qm-chip qm-${m}" title="How it's going: ${esc(name(m))} (tap to change)" aria-haspopup="menu"${extra}>${esc(name(m))}</button>`
      : `<span class="qm-chip qm-${m}"${extra}>${esc(name(m))}</span>`;
  }

  let menu = null;
  let settle = null;
  function close(value = null) {
    if (menu) menu.hidden = true;
    if (settle) { const s = settle; settle = null; s(value); }
  }
  // The one menu (modes, or phones), made the first time it's needed
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'qm-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    document.body.appendChild(menu);
    document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== anchorNow) close(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) close(); });
    addEventListener('resize', () => close());
    // The list under it scrolled away: the menu goes too (it never floats away from its quest)
    document.addEventListener('scroll', (e) => {
      const t = e.target;
      if (!menu.hidden && anchorNow && (t === document || (t instanceof Element && t.contains(anchorNow)))) close();
    }, true);
    menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) close(b.dataset.mode); });
    return menu;
  }
  // Beside the anchor, always fully on screen: below it, or above it, or (no room for either)
  // as low as it fits; taller than the screen, it scrolls inside (quest-modes.css)
  function place(anchor) {
    menu.hidden = false;
    menu.style.left = menu.style.top = '0px';
    const r = anchor.getBoundingClientRect();
    const W = document.documentElement.clientWidth || innerWidth, H = innerHeight;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(W - w - 8, r.left))}px`;
    const top = r.bottom + 6 + h <= H - 8 ? r.bottom + 6 : r.top - 6 - h >= 8 ? r.top - 6 - h : H - 8 - h;
    menu.style.top = `${Math.max(8, top)}px`;
  }
  function pick(anchor, current) {
    close();
    ensureMenu();
    menu.setAttribute('aria-label', "How it's going");
    anchorNow = anchor;
    menu.innerHTML = LIST.map((m) => `<button type="button" role="menuitemradio" class="qm-${m.id}" data-mode="${m.id}" aria-checked="${m.id === current}">${esc(m.name)}</button>`).join('');
    place(anchor);
    const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return new Promise((resolve) => (settle = resolve));
  }
  let anchorNow = null;

  // Which phones get a quest's reminders: the studio owner's (none picked), or the ones ticked.
  // The list comes from Nova Bot (/app/api/push/phones: the phones with notifications on).
  // Resolves with the new list of phone ids, or null if nothing changed.
  async function pickPhones(anchor, chosen = []) {
    close();
    let phones = [];
    try {
      const r = await fetch('/app/api/push/phones', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      phones = r.ok ? (await r.json()).phones || [] : [];
    } catch (err) {}
    ensureMenu();
    menu.setAttribute('aria-label', 'Which phones get its reminders');
    anchorNow = anchor;
    let picked = chosen.filter((id) => phones.some((p) => p.id === id));
    const draw = () => {
      menu.innerHTML =
        `<button type="button" role="menuitemcheckbox" class="qm-soon" data-phone="" aria-checked="${!picked.length}">Owner's phones</button>` +
        (phones.length
          ? phones.map((p) => `<button type="button" role="menuitemcheckbox" class="qm-nearly" data-phone="${esc(p.id)}" aria-checked="${picked.includes(p.id)}">${esc(p.name)}${p.who ? ` · ${esc(p.who)}` : ''}</button>`).join('')
          : '<p class="qm-note">No phones have notifications on yet (Nova Portal → Alerts → turn them on).</p>') +
        '<button type="button" class="qm-done qm-ok" data-ok="1">Done</button>';
    };
    draw();
    place(anchor);
    return new Promise((resolve) => {
      const before = JSON.stringify([...chosen].sort());
      const onClick = (e) => {
        const b = e.target.closest('[data-phone], [data-ok]');
        if (!b) return;
        e.stopImmediatePropagation();
        if (b.dataset.ok) {
          menu.removeEventListener('click', onClick, true);
          menu.hidden = true;
          settle = null;
          return resolve(JSON.stringify([...picked].sort()) === before ? null : picked);
        }
        const id = b.dataset.phone;
        picked = !id ? [] : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
        draw();
      };
      menu.addEventListener('click', onClick, true);
      // Closed another way (Escape, a tap outside): nothing changes
      settle = () => { menu.removeEventListener('click', onClick, true); resolve(null); };
    });
  }
  window.NovaQuestModes = { list: LIST, name, chip, pick, valid, pickPhones };
})();
