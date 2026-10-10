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
  function pick(anchor, current) {
    close();
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'qm-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', "How it's going");
      document.body.appendChild(menu);
      document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== anchorNow) close(); }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) close(); });
      addEventListener('resize', () => close());
      menu.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) close(b.dataset.mode); });
    }
    anchorNow = anchor;
    menu.innerHTML = LIST.map((m) => `<button type="button" role="menuitemradio" class="qm-${m.id}" data-mode="${m.id}" aria-checked="${m.id === current}">${esc(m.name)}</button>`).join('');
    menu.hidden = false;
    // Beside the chip, always fully on screen
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left));
    const below = r.bottom + 6 + h <= innerHeight - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, below ? r.bottom + 6 : r.top - 6 - h)}px`;
    const first = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return new Promise((resolve) => (settle = resolve));
  }
  let anchorNow = null;
  window.NovaQuestModes = { list: LIST, name, chip, pick, valid };
})();
