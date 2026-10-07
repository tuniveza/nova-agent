/* Nova Notes — app.js
   Everything around the page: the notes library, saving, the menus and toolbar, pop-ups, find and
   replace, import and export, Google Docs, themes, page styles and keyboard shortcuts. */
(function () {
  'use strict';
  const NN = window.NN;
  const S = NN.store;
  const $ = (id) => document.getElementById(id);
  const shell = $('shell');
  const titleInput = $('doc-title');
  const desk = $('desk');
  const toolbar = $('toolbar');
  const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.13.0/mammoth.browser.min.js';
  const narrow = matchMedia('(max-width: 880px)');
  const midWidth = matchMedia('(max-width: 1180px)');

  const scriptStart = performance.now();
  const settings = Object.assign(
    { theme: 'novacane', page: 'cosmic', pageless: false, zoom: 1, library: true, outline: true, lastId: '', googleClientId: '' },
    S.settings.read()
  );
  const saveSettings = () => S.settings.write(settings);

  let notes = [];
  let current = null;
  let saveTimer = null;
  let dirty = false;
  let lastState = null;

  // ---------- EDITOR ----------

  const editor = new NN.Editor($('editor'), {
    onChange: () => {
      scheduleSave();
      scheduleSide();
    },
    onState: (st) => updateToolbar(st),
    onImage: (img) => placeImageBar(img),
    onImageFile: (f) => insertImageFile(f),
    onFile: (f) => importFiles([f]),
    onLink: (a) => showLinkView(a),
    onReveal: (rect) => reveal(rect)
  });

  // ---------- SAVING ----------

  function setSaveState(kind) {
    const el = $('save-state');
    el.classList.toggle('saving', kind === 'saving');
    el.classList.toggle('error', kind === 'error');
    el.querySelector('span').textContent = kind === 'saving' ? 'Saving…' : kind === 'error' ? "Couldn't save" : 'Saved';
    el.title = kind === 'error' ? 'This browser refused to save (it may be out of space). Export the note to keep a copy.' : 'Saved in this browser';
  }
  // Save half a second after typing stops, and at least every 1.5 seconds while it doesn't
  let pendingSince = 0;
  function scheduleSave() {
    dirty = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    if (!pendingSince) pendingSince = Date.now();
    saveTimer = setTimeout(saveNow, Date.now() - pendingSince > 1500 ? 0 : 500);
  }
  // The note's name follows its first line until someone names it
  function autoTitle() {
    const first = [...$('editor').children].find((b) => b.textContent.trim());
    return first ? first.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : 'Untitled note';
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    pendingSince = 0;
    if (!current || !dirty) return;
    dirty = false;
    current.html = editor.html();
    if (!current.named) {
      current.title = autoTitle();
      if (document.activeElement !== titleInput) titleInput.value = current.title === 'Untitled note' ? '' : current.title;
    }
    current.updated = new Date().toISOString();
    const ok = await S.notes.put(current);
    setSaveState(ok ? 'saved' : 'error');
    document.title = `${current.title} · Nova Notes`;
    renderLibrary();
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveNow());
  window.addEventListener('pagehide', () => saveNow());

  titleInput.addEventListener('input', () => {
    if (!current) return;
    const v = titleInput.value.trim();
    current.named = Boolean(v);
    current.title = v || autoTitle();
    scheduleSave();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      editor.focus();
    }
  });

  // ---------- NOTES ----------

  const plain = (html) => {
    const t = document.createElement('template');
    // a space between blocks, so "Heading" and the next line don't run together
    t.innerHTML = html.replace(/<\/(p|h[1-6]|li|td|th|blockquote|pre)>|<br\s*\/?>/gi, ' $&');
    return t.content.textContent.replace(/\s+/g, ' ').trim();
  };
  const snippetCache = new Map();
  const snippet = (n) => {
    const key = n.id + n.updated;
    if (!snippetCache.has(key)) snippetCache.set(key, plain(n.html));
    return snippetCache.get(key);
  };
  function when(iso) {
    const d = new Date(iso);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (diff < 6 * 86400) return d.toLocaleDateString('en-GB', { weekday: 'long' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }

  function renderLibrary() {
    const list = $('lib-list');
    const q = $('lib-search').value.trim().toLowerCase();
    const shown = [...notes]
      .sort((a, b) => b.pinned - a.pinned || b.updated.localeCompare(a.updated))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || snippet(n).toLowerCase().includes(q));
    list.innerHTML = '';
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'lib-empty';
      li.textContent = q ? 'No notes match that search.' : 'No notes yet.';
      list.appendChild(li);
    }
    for (const n of shown) {
      const li = document.createElement('li');
      li.className = 'lib-item' + (n.pinned ? ' pinned' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', current && n.id === current.id ? 'true' : 'false');
      li.tabIndex = 0;
      li.dataset.id = n.id;
      const snip = snippet(n).slice(0, 140);
      li.innerHTML = `<span class="lib-name"></span><span class="lib-snip"></span><span class="lib-time"></span>
        <span class="lib-acts">
          <button type="button" class="pin" data-act="pin" aria-label="${n.pinned ? 'Unpin' : 'Pin to top'}" title="${n.pinned ? 'Unpin' : 'Pin to top'}"><svg class="ico"><use href="#i-star"/></svg></button>
          <button type="button" data-act="delete" aria-label="Delete note" title="Delete note"><svg class="ico"><use href="#i-trash"/></svg></button>
        </span>`;
      li.querySelector('.lib-name').textContent = n.title || 'Untitled note';
      li.querySelector('.lib-snip').textContent = snip.startsWith(n.title) ? snip.slice(n.title.length).trim() || '—' : snip || '—';
      li.querySelector('.lib-time').textContent = when(n.updated);
      list.appendChild(li);
    }
    $('lib-foot').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'} · kept in this browser`;
  }
  $('lib-search').addEventListener('input', renderLibrary);
  $('lib-list').addEventListener('click', (e) => {
    const li = e.target.closest('.lib-item');
    if (!li) return;
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'pin') return togglePin(li.dataset.id);
    if (act && act.dataset.act === 'delete') return deleteNote(li.dataset.id);
    openNote(li.dataset.id);
  });
  $('lib-list').addEventListener('keydown', (e) => {
    const li = e.target.closest('.lib-item');
    if (!li) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openNote(li.dataset.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
      if (next) next.focus();
    } else if (e.key === 'Delete') deleteNote(li.dataset.id);
  });

  async function openNote(id) {
    await saveNow();
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    current = n;
    editor.load(n.html);
    titleInput.value = n.named || n.title !== 'Untitled note' ? n.title : '';
    document.title = `${n.title} · Nova Notes`;
    settings.lastId = n.id;
    saveSettings();
    setSaveState('saved');
    closeFind();
    renderLibrary();
    scheduleSide(true);
    desk.scrollTop = 0;
    shell.classList.remove('show-library');
    hideBars();
  }

  async function createNote(html = '', title = 'Untitled note', named = false, open = true) {
    const now = new Date().toISOString();
    const note = S.notes.clean({ id: S.notes.newId(), title, html, named, created: now, updated: now });
    await S.notes.put(note);
    notes.push(note);
    if (open) {
      await openNote(note.id);
      editor.focus();
    } else renderLibrary();
    return note;
  }
  const newNote = () => createNote('', 'Untitled note');

  async function duplicateNote() {
    if (!current) return;
    await saveNow();
    await createNote(current.html, `${current.title} (copy)`, true);
    toast('Made a copy');
  }

  async function togglePin(id = current && current.id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    n.pinned = !n.pinned;
    await S.notes.put(n);
    renderLibrary();
  }

  async function deleteNote(id = current && current.id) {
    const n = notes.find((x) => x.id === id);
    if (!n) return;
    if (current && id === current.id) await saveNow();
    notes = notes.filter((x) => x.id !== id);
    await S.notes.remove(id);
    if (current && current.id === id) {
      const next = [...notes].sort((a, b) => b.updated.localeCompare(a.updated))[0];
      if (next) await openNote(next.id);
      else await createNote();
    } else renderLibrary();
    toast(`Deleted “${n.title}”`, 'Undo', async () => {
      await S.notes.put(n);
      notes.push(n);
      openNote(n.id);
    });
  }

  // ---------- SIDE PANELS: OUTLINE, COUNTS ----------

  let sideTimer = null;
  let sideSince = 0;
  function scheduleSide(now) {
    clearTimeout(sideTimer);
    if (!sideSince) sideSince = Date.now();
    sideTimer = setTimeout(renderSide, now || Date.now() - sideSince > 900 ? 0 : 350);
  }
  function renderSide() {
    sideSince = 0;
    const items = editor.outline();
    const ol = $('outline-list');
    ol.innerHTML = '';
    for (const h of items) {
      const li = document.createElement('li');
      li.className = `lv${h.level}`;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = h.text;
      b.title = h.text;
      b.addEventListener('click', () => {
        h.el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        editor.caretTo(h.el, true);
        shell.classList.remove('show-outline');
      });
      li.appendChild(b);
      ol.appendChild(li);
    }
    $('outline-empty').hidden = items.length > 0;
    const st = editor.stats();
    $('st-words').textContent = `${st.words.toLocaleString('en-GB')} word${st.words === 1 ? '' : 's'}`;
    $('st-chars').textContent = `${st.chars.toLocaleString('en-GB')} characters`;
  }

  // ---------- TOOLBAR ----------

  const TOGGLES = { bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strike' };
  function updateToolbar(st) {
    lastState = st;
    for (const b of toolbar.querySelectorAll('[data-cmd]')) {
      const c = b.dataset.cmd;
      let on = null;
      if (TOGGLES[c]) on = Boolean(st[TOGGLES[c]]);
      else if (c === 'align') on = st.align === b.dataset.value;
      else if (c === 'list') on = st.list === b.dataset.value;
      if (on !== null) {
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
    toolbar.querySelector('[data-cmd="undo"]').disabled = !st.canUndo;
    toolbar.querySelector('[data-cmd="redo"]').disabled = !st.canRedo;
    $('tb-style').value = st.style;
    const font = [...$('tb-font').options].find((o) => o.value && o.value.toLowerCase() === (st.font || '').toLowerCase());
    $('tb-font').value = font ? font.value : '';
    if (document.activeElement !== $('tb-size') && st.size) $('tb-size').value = st.size;
    if (st.color) $('bar-color').style.background = st.color;
    placeTableBar(st.cell);
  }

  // Toolbar buttons never take the focus away from the page
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.pop) return togglePop(b.dataset.pop, b);
    run(b.dataset.cmd, b.dataset.value);
  });
  $('tb-style').addEventListener('change', (e) => editor.exec('style', e.target.value));
  $('tb-font').addEventListener('change', (e) => editor.exec('font', e.target.value));
  $('tb-zoom').addEventListener('change', (e) => setZoom(Number(e.target.value)));
  const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72, 96];
  function setSize(pt) {
    const n = Math.max(6, Math.min(96, Math.round(Number(pt) * 2) / 2));
    if (!n) return;
    $('tb-size').value = n;
    editor.exec('size', n);
  }
  function stepSize(dir) {
    const now = Number($('tb-size').value) || (lastState && lastState.size) || 12;
    const next = dir > 0 ? SIZES.find((s) => s > now) || 96 : [...SIZES].reverse().find((s) => s < now) || 6;
    setSize(next);
  }
  $('tb-size').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setSize($('tb-size').value);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      stepSize(e.key === 'ArrowUp' ? 1 : -1);
    }
  });
  $('tb-size').addEventListener('change', () => setSize($('tb-size').value));

  // One place for every action, so the toolbar, menus and shortcuts all agree
  function run(cmd, value) {
    switch (cmd) {
      case 'undo':
        return editor.undo();
      case 'redo':
        return editor.redo();
      case 'print':
        return printNote();
      case 'sizeUp':
        return stepSize(1);
      case 'sizeDown':
        return stepSize(-1);
      case 'link':
        return openLinkPop();
      case 'image':
        return chooseImage();
      case 'imageUrl':
        return imageFromUrl();
      case 'find':
        return openFind();
      case 'symbols':
        return togglePop('symbols', toolbar.querySelector('[data-cmd="find"]'));
      case 'tablePick':
        return togglePop('table', toolbar.querySelector('[data-pop="table"]'));
      case 'date':
        return editor.exec('text', value);
      default:
        if (cmd) editor.exec(cmd, value);
    }
  }

  // ---------- POPOVERS ----------

  let openPop = null;
  let popMode = 'color';
  function place(el, rect, { gap = 8, align = 'center' } = {}) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = align === 'start' ? rect.left : rect.left + rect.width / 2 - w / 2;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = rect.bottom + gap;
    if (y + h > innerHeight - 8) y = Math.max(8, rect.top - h - gap);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }
  function showPop(pop, anchor) {
    closePops();
    pop.hidden = false;
    place(pop, anchor.getBoundingClientRect());
    openPop = pop;
  }
  function closePops() {
    for (const p of document.querySelectorAll('.pop')) p.hidden = true;
    openPop = null;
  }
  function togglePop(name, anchor) {
    const pop = $(`pop-${name === 'highlight' ? 'color' : name}`);
    if (!pop) return;
    if (openPop === pop && (name !== 'color' && name !== 'highlight' ? true : popMode === name)) return closePops();
    editor.remember();
    if (name === 'color' || name === 'highlight') {
      popMode = name;
      $('pop-color-label').textContent = name === 'color' ? 'Text colour' : 'Highlight colour';
    }
    if (name === 'table') resetGrid();
    showPop(pop, anchor);
  }
  document.addEventListener('mousedown', (e) => {
    if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop]') && !e.target.closest('.menu-pop')) closePops();
  });
  for (const p of document.querySelectorAll('.pop, .floatbar')) p.addEventListener('mousedown', (e) => {
    if (!e.target.closest('input, select, textarea, label')) e.preventDefault();
  });

  // Colours: the theme's own, then a standard set
  function buildSwatches() {
    const t = NN.themes.get(settings.theme);
    const groups = [
      ['Theme', [t.hi, t.soft, t.lilac, t.gold, t.accent, t.accent2, t.text, '#FFFFFF']],
      ['Classic', ['#000000', '#434343', '#999999', '#E06666', '#F6B26B', '#FFD966', '#93C47D', '#76A5AF', '#6FA8DC', '#8E7CC3', '#C27BA0', '#CC0000', '#E69138', '#38761D', '#1155CC', '#741B47']]
    ];
    const box = $('color-swatches');
    box.innerHTML = '';
    for (const [label, colours] of groups) {
      const l = document.createElement('span');
      l.className = 'group-label';
      l.textContent = label;
      box.appendChild(l);
      for (const c of colours) {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.background = c;
        b.style.setProperty('--sw', c);
        b.title = c.toUpperCase();
        b.setAttribute('aria-label', c);
        b.addEventListener('click', () => pickColour(c));
        box.appendChild(b);
      }
    }
  }
  function pickColour(c) {
    editor.exec(popMode, c);
    $(popMode === 'color' ? 'bar-color' : 'bar-highlight').style.background = c || '';
    closePops();
  }
  $('color-reset').addEventListener('click', () => pickColour(''));
  $('color-custom').addEventListener('change', (e) => pickColour(e.target.value));

  // Table size picker
  function resetGrid() {
    const g = $('grid-pick');
    if (!g.children.length) {
      for (let r = 1; r <= 8; r++)
        for (let c = 1; c <= 8; c++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.r = r;
          b.dataset.c = c;
          b.setAttribute('aria-label', `${r} by ${c} table`);
          g.appendChild(b);
        }
      g.addEventListener('mouseover', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        for (const x of g.children) x.classList.toggle('on', +x.dataset.r <= +b.dataset.r && +x.dataset.c <= +b.dataset.c);
        $('grid-size').textContent = `${b.dataset.c} × ${b.dataset.r}`;
      });
      g.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        closePops();
        editor.exec('table', { rows: +b.dataset.r, cols: +b.dataset.c });
      });
    }
    for (const x of g.children) x.classList.remove('on');
    $('grid-size').textContent = 'Pick a size';
  }

  // Line spacing
  $('pop-spacing').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lh]');
    if (!b) return;
    editor.exec('lineHeight', b.dataset.lh);
    closePops();
  });

  // Links
  function openLinkPop() {
    editor.remember();
    const st = editor.state();
    const r = editor.range() || editor.savedRange;
    const a = st.link;
    $('link-text').value = a ? a.textContent : r ? r.toString() : '';
    $('link-url').value = a ? a.getAttribute('href') : '';
    $('link-text').dataset.original = $('link-text').value;
    $('link-remove').hidden = !a;
    const rect = r ? r.getBoundingClientRect() : toolbar.querySelector('[data-cmd="link"]').getBoundingClientRect();
    const anchor = rect && rect.width + rect.height > 0 ? rect : toolbar.querySelector('[data-cmd="link"]').getBoundingClientRect();
    closePops();
    const pop = $('pop-link');
    pop.hidden = false;
    place(pop, anchor);
    openPop = pop;
    setTimeout(() => ($('link-url').value ? $('link-url') : $('link-url')).focus(), 0);
  }
  function applyLink() {
    const url = $('link-url').value.trim();
    const text = $('link-text').value;
    closePops();
    if (!url) return editor.focus();
    const changed = text !== $('link-text').dataset.original;
    const r = editor.savedRange;
    editor.exec('link', { url, text: changed || !r || r.collapsed ? text || url : '' });
  }
  $('link-apply').addEventListener('click', applyLink);
  for (const id of ['link-url', 'link-text']) $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    }
  });
  $('link-remove').addEventListener('click', () => {
    closePops();
    editor.exec('unlink');
  });
  function showLinkView(a) {
    const pop = $('pop-linkview');
    const href = a.getAttribute('href') || '';
    $('linkview-url').textContent = href;
    $('linkview-url').href = href;
    closePops();
    pop.hidden = false;
    place(pop, a.getBoundingClientRect(), { gap: 6 });
    openPop = pop;
  }
  $('linkview-edit').addEventListener('click', () => openLinkPop());
  $('linkview-remove').addEventListener('click', () => {
    closePops();
    editor.exec('unlink');
  });

  // Special characters
  const SYMBOLS = '✦ ★ ☆ ✧ ✩ ✪ ✺ ⋆ ☾ ☽ ☄ ⊹ ∞ ♪ ♫ ♡ → ← ↑ ↓ ⇄ • · — – … « » “ ” ‘ ’ © ® ™ ° ± × ÷ ≈ ≠ ≤ ≥ £ € $ ½ ¼ ¾ ✓ ✗ ☐ ☑ 🎙️ 🎧 🎹 🎸 🥁 🎤 🌙 ✨ 🌌 🪐 🚀 💫 🔥 💜'.split(' ');
  for (const s of SYMBOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s;
    b.setAttribute('aria-label', `Insert ${s}`);
    b.addEventListener('click', () => {
      editor.exec('text', s);
    });
    $('symbols').appendChild(b);
  }

  // ---------- PICTURES & TABLE BARS ----------

  function placeImageBar(img) {
    const bar = $('imgbar');
    if (!img) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const r = img.getBoundingClientRect();
    const w = bar.offsetWidth;
    bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    const above = r.top - bar.offsetHeight - 10;
    bar.style.top = `${above > desk.getBoundingClientRect().top ? above : Math.min(innerHeight - bar.offsetHeight - 8, r.bottom + 10)}px`;
    for (const b of bar.querySelectorAll('[data-img="width"]')) {
      const w2 = img.style.width;
      b.setAttribute('aria-pressed', (b.dataset.value ? w2 === `${b.dataset.value}%` : !w2) ? 'true' : 'false');
    }
  }
  $('imgbar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-img]');
    if (!b || !editor.selImg) return;
    if (b.dataset.img === 'alt') {
      const alt = await promptBox('Alt text', 'Describe the picture for people who can’t see it', editor.selImg.getAttribute('alt') || '');
      if (alt !== null) editor.imageOp('alt', alt.trim());
      return;
    }
    editor.imageOp(b.dataset.img, b.dataset.value);
    if (b.dataset.img === 'remove') $('imgbar').hidden = true;
  });

  function placeTableBar(cell) {
    const bar = $('tablebar');
    if (!cell || editor.selImg) {
      bar.hidden = true;
      return;
    }
    const table = cell.closest('table');
    const r = table.getBoundingClientRect();
    const d = desk.getBoundingClientRect();
    if (r.bottom < d.top || r.top > d.bottom) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    // A steady bar along the bottom of the writing area, clear of the table being edited
    const w = bar.offsetWidth;
    bar.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, d.left + d.width / 2 - w / 2))}px`;
    bar.style.top = `${d.bottom - bar.offsetHeight - 14}px`;
  }
  $('tablebar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-table]');
    if (b) editor.tableOp(b.dataset.table);
  });
  function hideBars() {
    $('imgbar').hidden = true;
    $('tablebar').hidden = true;
  }
  desk.addEventListener('scroll', () => {
    if (editor.selImg) placeImageBar(editor.selImg);
    if (lastState && lastState.cell) placeTableBar(lastState.cell);
    if (openPop && openPop.id !== 'pop-link') closePops();
  }, { passive: true });
  window.addEventListener('resize', () => {
    hideBars();
    closePops();
    closeMenus();
  });

  function chooseImage() {
    editor.remember();
    $('file-image').value = '';
    $('file-image').click();
  }
  $('file-image').addEventListener('change', (e) => {
    for (const f of e.target.files) insertImageFile(f);
  });
  async function imageFromUrl() {
    editor.remember();
    const url = await promptBox('Insert a picture', 'Picture address (https://…)', '');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) return toast('That needs to be a web address starting https://');
    editor.exec('image', { src: url.trim(), alt: '' });
  }
  // Big pictures are scaled down so notes stay quick to save
  function insertImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (file.type === 'image/svg+xml' || file.type === 'image/gif' || file.size < 400 * 1024) return editor.exec('image', { src, alt: file.name.replace(/\.[^.]+$/, '') });
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86);
        editor.exec('image', { src: out.length < src.length ? out : src, alt: file.name.replace(/\.[^.]+$/, '') });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  // ---------- MENUS ----------

  const menuPop = $('menu-pop');
  let subPop = null;
  let menuOwner = null;
  const today = () => new Date();
  const fmtDate = (opts) => today().toLocaleDateString('en-GB', opts);

  function themeItems() {
    return NN.themes.list().map((t) => ({ label: t.name, swatch: t, checked: settings.theme === t.id, run: () => setTheme(t.id) }));
  }
  function exportItems() {
    return [
      { label: 'Google Docs…', icon: 'doc', run: openGdocs },
      { sep: true },
      { label: 'Word document (.doc)', icon: 'export', sfx: 'send', run: () => exportAs('doc') },
      { label: 'Web page (.html)', icon: 'export', sfx: 'send', run: () => exportAs('html') },
      { label: 'Markdown (.md)', icon: 'export', sfx: 'send', run: () => exportAs('md') },
      { label: 'Plain text (.txt)', icon: 'export', sfx: 'send', run: () => exportAs('txt') },
      { label: 'PDF (print)', icon: 'print', sfx: 'send', run: printNote },
      { sep: true },
      { label: 'This note as a backup (.json)', icon: 'export', sfx: 'send', run: () => exportAs('json') }
    ];
  }
  const MENUS = [
    ['File', () => [
      { label: 'New note', icon: 'plus', kbd: 'Ctrl+Alt+N', run: newNote },
      { label: 'Make a copy', icon: 'copy', run: duplicateNote },
      { sep: true },
      { label: 'Import…', icon: 'import', kbd: 'Ctrl+O', run: openImport },
      { label: 'Download', icon: 'export', sub: exportItems },
      { label: 'Send to Google Docs…', icon: 'doc', run: openGdocs },
      { sep: true },
      { label: 'Back up all notes (.json)', icon: 'export', sfx: 'send', run: backupAll },
      { label: 'Restore a backup…', icon: 'import', run: openImport },
      { sep: true },
      { label: 'Rename', run: () => (titleInput.focus(), titleInput.select()) },
      { label: current && current.pinned ? 'Unpin' : 'Pin to top', icon: 'star', run: () => togglePin() },
      { label: 'Delete note', icon: 'trash', run: () => deleteNote() },
      { sep: true },
      { label: 'Print', icon: 'print', kbd: 'Ctrl+P', sfx: 'send', run: printNote }
    ]],
    ['Edit', () => [
      { label: 'Undo', icon: 'undo', kbd: 'Ctrl+Z', disabled: !editor.canUndo(), run: () => editor.undo() },
      { label: 'Redo', icon: 'redo', kbd: 'Ctrl+Y', disabled: !editor.canRedo(), run: () => editor.redo() },
      { sep: true },
      { label: 'Cut', kbd: 'Ctrl+X', run: () => (editor.focus(), document.execCommand('cut')) },
      { label: 'Copy', icon: 'copy', kbd: 'Ctrl+C', sfx: 'tap', run: () => (editor.focus(), document.execCommand('copy')) },
      { label: 'Paste', kbd: 'Ctrl+V', run: pasteFromMenu },
      { sep: true },
      { label: 'Select all', kbd: 'Ctrl+A', run: () => editor.exec('selectAll') },
      { sep: true },
      { label: 'Find and replace', icon: 'search', kbd: 'Ctrl+H', run: openFind }
    ]],
    ['View', () => [
      { label: 'Notes list', icon: 'sidebar', checked: narrow.matches ? shell.classList.contains('show-library') : settings.library, run: toggleLibrary },
      { label: 'Outline', icon: 'outline', checked: midWidth.matches ? shell.classList.contains('show-outline') : settings.outline, run: toggleOutline },
      { sep: true },
      { label: 'Page style', icon: 'page', sub: () => [
        { label: 'Cosmic (among the stars)', checked: settings.page === 'cosmic', run: () => setPage('cosmic') },
        { label: 'Paper (how it exports)', checked: settings.page === 'paper', run: () => setPage('paper') }
      ] },
      { label: 'Pageless', checked: settings.pageless, run: () => setPageless(!settings.pageless) },
      { label: 'Zoom', sub: () => [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => ({ label: `${Math.round(z * 100)}%`, checked: settings.zoom === z, run: () => setZoom(z) })) },
      { sep: true },
      { label: 'Focus mode', icon: 'focus', kbd: 'Ctrl+Shift+F', checked: shell.classList.contains('focus'), run: toggleFocus },
      { label: 'Full screen', icon: 'full', run: toggleFullscreen },
      { sep: true },
      // The soft Nova suite sounds on every press (js/sfx.js); ticked while they're on
      { label: 'Sound effects', icon: 'sound', checked: sfxOn(), sfx: 'none', run: toggleSfx }
    ]],
    ['Insert', () => [
      { label: 'Image', icon: 'image', sub: () => [
        { label: 'Upload from computer', icon: 'import', run: chooseImage },
        { label: 'By web address', icon: 'link', run: imageFromUrl }
      ] },
      { label: 'Table', icon: 'table', sub: () => [[2, 2], [3, 3], [4, 3], [5, 4], [6, 6]].map(([c, r]) => ({ label: `${c} × ${r}`, run: () => editor.exec('table', { rows: r, cols: c }) })).concat([{ sep: true }, { label: 'Pick a size…', run: () => run('tablePick') }]) },
      { label: 'Link', icon: 'link', kbd: 'Ctrl+K', run: openLinkPop },
      { sep: true },
      { label: 'Horizontal line', icon: 'rule', run: () => editor.exec('hr') },
      { label: 'Page break', icon: 'break', kbd: 'Ctrl+Enter', run: () => editor.exec('pageBreak') },
      { label: 'Checklist', icon: 'check', kbd: 'Ctrl+Shift+9', run: () => editor.exec('list', 'check') },
      { sep: true },
      { label: 'Date', icon: 'date', sub: () => [
        { label: fmtDate({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), run: () => run('date', fmtDate({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) },
        { label: fmtDate({ day: 'numeric', month: 'long', year: 'numeric' }), run: () => run('date', fmtDate({ day: 'numeric', month: 'long', year: 'numeric' })) },
        { label: fmtDate({ day: '2-digit', month: '2-digit', year: 'numeric' }), run: () => run('date', fmtDate({ day: '2-digit', month: '2-digit', year: 'numeric' })) },
        { label: `Time: ${today().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, run: () => run('date', today().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })) }
      ] },
      { label: 'Special characters…', icon: 'spark', run: () => run('symbols') }
    ]],
    ['Format', () => [
      { label: 'Text', sub: () => [
        { label: 'Bold', kbd: 'Ctrl+B', run: () => editor.exec('bold') },
        { label: 'Italic', kbd: 'Ctrl+I', run: () => editor.exec('italic') },
        { label: 'Underline', kbd: 'Ctrl+U', run: () => editor.exec('underline') },
        { label: 'Strikethrough', kbd: 'Alt+Shift+5', run: () => editor.exec('strikeThrough') },
        { label: 'Superscript', kbd: 'Ctrl+.', run: () => editor.exec('superscript') },
        { label: 'Subscript', kbd: 'Ctrl+,', run: () => editor.exec('subscript') },
        { sep: true },
        { label: 'Bigger', kbd: 'Ctrl+Shift+.', run: () => stepSize(1) },
        { label: 'Smaller', kbd: 'Ctrl+Shift+,', run: () => stepSize(-1) }
      ] },
      { label: 'Paragraph styles', sub: () => [
        ['normal', 'Normal text', 'Ctrl+Alt+0'], ['title', 'Title'], ['subtitle', 'Subtitle'], ['h1', 'Heading 1', 'Ctrl+Alt+1'], ['h2', 'Heading 2', 'Ctrl+Alt+2'], ['h3', 'Heading 3', 'Ctrl+Alt+3'], ['quote', 'Quote'], ['code', 'Code']
      ].map(([v, l, k]) => ({ label: l, kbd: k, checked: lastState && lastState.style === v, run: () => editor.exec('style', v) })) },
      { label: 'Align', sub: () => [
        ['left', 'Left', 'Ctrl+Shift+L'], ['center', 'Centre', 'Ctrl+Shift+E'], ['right', 'Right', 'Ctrl+Shift+R'], ['justify', 'Justified', 'Ctrl+Shift+J']
      ].map(([v, l, k]) => ({ label: l, kbd: k, checked: lastState && lastState.align === v, run: () => editor.exec('align', v) })) },
      { label: 'Line spacing', sub: () => [['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['', 'Default (1.7)'], ['2', 'Double']].map(([v, l]) => ({ label: l, checked: lastState && lastState.lineHeight === v, run: () => editor.exec('lineHeight', v) })) },
      { label: 'Bullets and numbering', sub: () => [
        { label: 'Checklist', kbd: 'Ctrl+Shift+9', run: () => editor.exec('list', 'check') },
        { label: 'Bulleted list', kbd: 'Ctrl+Shift+8', run: () => editor.exec('list', 'ul') },
        { label: 'Numbered list', kbd: 'Ctrl+Shift+7', run: () => editor.exec('list', 'ol') },
        { sep: true },
        { label: 'Increase indent', kbd: 'Ctrl+]', run: () => editor.exec('indent') },
        { label: 'Decrease indent', kbd: 'Ctrl+[', run: () => editor.exec('outdent') }
      ] },
      { sep: true },
      { label: 'Clear formatting', icon: 'clear', kbd: 'Ctrl+\\', sfx: 'tap', run: () => editor.exec('clear') }
    ]],
    ['Tools', () => [
      { label: 'Word count', icon: 'words', kbd: 'Ctrl+Shift+C', run: showWordCount },
      { label: 'Find and replace', icon: 'search', kbd: 'Ctrl+H', run: openFind },
      { sep: true },
      { label: 'Colour theme', icon: 'palette', sub: themeItems },
      { label: 'Google Docs set-up…', icon: 'drive', run: () => openGdocs(true) }
    ]],
    ['Help', () => [
      { label: 'Install Nova Notes as an app', icon: 'export', run: installApp },
      { label: 'Keyboard shortcuts', icon: 'keys', kbd: 'Ctrl+/', run: showKeys },
      // Every Nova suite address, live and testing (behind the admin password, on Nova Hub's admin page)
      { label: '🔒 All Nova suite links', icon: 'link', run: () => window.open('https://novacane-worker.novacane-studio.workers.dev/admin/links', '_blank', 'noopener') },
      { label: 'About Nova Notes', icon: 'info', run: () => $('dlg-about').showModal() }
    ]]
  ];

  function renderMenubar() {
    const bar = $('menubar');
    for (const [name, items] of MENUS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => (menuOwner === b ? closeMenus() : openMenu(b, items())));
      b.addEventListener('mouseenter', () => {
        if (menuOwner && menuOwner !== b && menuOwner.parentElement === bar) openMenu(b, items());
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          openMenu(b, items(), true);
        }
      });
      bar.appendChild(b);
    }
  }

  function buildMenu(el, items) {
    el.innerHTML = '';
    for (const it of items) {
      if (it.sep) {
        const s = document.createElement('div');
        s.className = 'sep';
        s.setAttribute('role', 'separator');
        el.appendChild(s);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mi';
      b.setAttribute('role', it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
      if (it.checked !== undefined) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      if (it.disabled) b.setAttribute('aria-disabled', 'true');
      // Items can pick their own sound when the guess from the label would be wrong
      if (it.sfx) b.dataset.sfx = it.sfx;
      const lead = it.swatch
        ? `<span class="menu-swatch" style="--sa:${it.swatch.accent};--sb:${it.swatch.accent3};--sc:${it.swatch.hi}"></span>`
        : it.icon
          ? `<svg class="ico"><use href="#i-${it.icon}"/></svg>`
          : `<span class="tickmark">${it.checked ? '✦' : ''}</span>`;
      b.innerHTML = `${lead}<span class="label"></span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ''}${it.sub ? '<svg class="ico sub-arrow"><use href="#i-right"/></svg>' : ''}${it.checked && (it.icon || it.swatch) ? '<span class="tickmark">✦</span>' : ''}`;
      b.querySelector('.label').textContent = it.label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      if (it.sub) {
        const open = () => openSub(b, it.sub());
        b.addEventListener('click', open);
        b.addEventListener('mouseenter', open);
      } else {
        b.addEventListener('mouseenter', () => closeSub(el));
        b.addEventListener('click', () => {
          closeMenus();
          it.run && it.run();
        });
      }
      el.appendChild(b);
    }
    el.addEventListener('keydown', menuKeys);
  }

  function openMenu(owner, items, focusFirst) {
    closeMenus(true);
    editor.remember();
    menuOwner = owner;
    owner.setAttribute('aria-expanded', 'true');
    buildMenu(menuPop, items);
    menuPop.hidden = false;
    place(menuPop, owner.getBoundingClientRect(), { gap: 6, align: 'start' });
    if (focusFirst) menuPop.querySelector('.mi:not([aria-disabled="true"])').focus();
  }
  function openSub(item, items) {
    const parent = item.parentElement;
    closeSub(parent);
    item.classList.add('open');
    subPop = document.createElement('div');
    subPop.className = 'menu-pop glass';
    subPop.setAttribute('role', 'menu');
    subPop.dataset.parent = parent.id || 'menu-pop';
    document.body.appendChild(subPop);
    buildMenu(subPop, items);
    const r = item.getBoundingClientRect();
    const w = subPop.offsetWidth;
    const h = subPop.offsetHeight;
    let x = r.right + 4;
    if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 4);
    let y = Math.min(r.top - 6, innerHeight - h - 8);
    subPop.style.left = `${x}px`;
    subPop.style.top = `${Math.max(8, y)}px`;
  }
  function closeSub(parent) {
    if (subPop) {
      subPop.remove();
      subPop = null;
    }
    (parent || menuPop).querySelectorAll('.mi.open').forEach((m) => m.classList.remove('open'));
  }
  function closeMenus(keepOwnerFocus) {
    closeSub();
    menuPop.hidden = true;
    if (menuOwner) menuOwner.setAttribute('aria-expanded', 'false');
    menuOwner = null;
  }
  function menuKeys(e) {
    const menu = e.currentTarget;
    const items = [...menu.querySelectorAll('.mi:not([aria-disabled="true"])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].focus();
    } else if (e.key === 'ArrowRight' && document.activeElement.querySelector('.sub-arrow')) {
      e.preventDefault();
      document.activeElement.click();
      if (subPop) subPop.querySelector('.mi').focus();
    } else if (e.key === 'ArrowLeft' && menu === subPop) {
      e.preventDefault();
      const opener = menuPop.querySelector('.mi.open');
      closeSub();
      if (opener) opener.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const owner = menuOwner;
      closeMenus();
      if (owner) owner.focus();
    }
  }
  document.addEventListener('mousedown', (e) => {
    if (menuOwner && !e.target.closest('.menu-pop') && e.target !== menuOwner) closeMenus();
  });

  $('btn-export').addEventListener('click', (e) => (menuOwner === e.currentTarget ? closeMenus() : openMenu(e.currentTarget, exportItems())));

  async function pasteFromMenu() {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          const html = await (await item.getType('text/html')).text();
          editor.focus();
          editor.insertClean(NN.convert.clean(html, { paste: true }));
          editor.changed();
          return;
        }
        if (item.types.includes('text/plain')) {
          editor.exec('text', await (await item.getType('text/plain')).text());
          return;
        }
      }
    } catch (err) {
      toast('Press Ctrl+V to paste');
    }
  }

  // ---------- FIND AND REPLACE ----------

  const findbar = $('findbar');
  function openFind() {
    const r = editor.range();
    const sel = r && !r.collapsed ? r.toString() : '';
    findbar.hidden = false;
    if (sel && sel.length < 80) $('find-q').value = sel;
    $('find-q').focus();
    $('find-q').select();
    doSearch();
  }
  function closeFind() {
    findbar.hidden = true;
    editor.clearFind();
  }
  function findCount(res) {
    const total = editor.find.ranges.length;
    $('find-count').textContent = total ? `${(res && res.index >= 0 ? res.index : editor.find.index) + 1} of ${total}` : $('find-q').value ? 'No matches' : '0 of 0';
  }
  function doSearch() {
    editor.search($('find-q').value, { matchCase: $('find-case').checked, wholeWord: $('find-word').checked });
    if (editor.find.ranges.length) {
      editor.find.index = -1;
      findCount(editor.findStep(1));
    } else findCount();
  }
  $('find-q').addEventListener('input', doSearch);
  $('find-case').addEventListener('change', doSearch);
  $('find-word').addEventListener('change', doSearch);
  $('find-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findCount(editor.findStep(e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      closeFind();
      editor.focus();
    }
  });
  $('find-r').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('find-one').click();
    } else if (e.key === 'Escape') closeFind();
  });
  $('find-next').addEventListener('click', () => findCount(editor.findStep(1)));
  $('find-prev').addEventListener('click', () => findCount(editor.findStep(-1)));
  $('find-close').addEventListener('click', () => {
    closeFind();
    editor.focus();
  });
  $('find-one').addEventListener('click', () => {
    if (!editor.find.ranges.length) return;
    const i = editor.find.index;
    editor.replaceCurrent($('find-r').value);
    if (editor.find.ranges.length) {
      editor.find.index = Math.min(i, editor.find.ranges.length - 1) - 1;
      findCount(editor.findStep(1));
    } else findCount();
  });
  $('find-all').addEventListener('click', () => {
    const n = editor.replaceAll($('find-r').value);
    findCount();
    toast(n ? `Replaced ${n} match${n === 1 ? '' : 'es'}` : 'Nothing to replace');
  });
  function reveal(rect) {
    const d = desk.getBoundingClientRect();
    if (rect.top < d.top + 90 || rect.bottom > d.bottom - 40) desk.scrollBy({ top: rect.top - d.top - d.height / 3, behavior: 'smooth' });
  }

  // ---------- DIALOGS ----------

  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
  }
  function confirmBox(title, msg, ok = 'OK') {
    const d = $('dlg-confirm');
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = msg;
    $('confirm-ok').textContent = ok;
    d.showModal();
    return new Promise((resolve) => {
      const done = (v) => {
        $('confirm-ok').onclick = null;
        d.onclose = null;
        resolve(v);
      };
      $('confirm-ok').onclick = () => {
        d.close();
        done(true);
      };
      d.onclose = () => done(false);
    });
  }
  function promptBox(title, label, value = '') {
    const d = $('dlg-prompt');
    $('prompt-title').textContent = title;
    $('prompt-label').textContent = label;
    $('prompt-input').value = value;
    d.returnValue = '';
    d.showModal();
    $('prompt-input').select();
    return new Promise((resolve) => {
      $('prompt-form').onsubmit = (e) => {
        e.preventDefault();
        const v = $('prompt-input').value;
        d.onclose = null;
        d.close();
        resolve(v);
      };
      d.onclose = () => resolve(null);
    });
  }

  function showWordCount() {
    const st = editor.stats();
    const rows = [
      ['Words', st.words],
      ['Characters', st.chars],
      ['Characters without spaces', st.charsNoSpaces],
      ['Paragraphs', st.paragraphs],
      ['Pages (about)', st.pages],
      ['Reading time', `${st.minutes} min`]
    ];
    if (st.selected) rows.unshift(['Selected words', st.selected.words]);
    $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === 'number' ? v.toLocaleString('en-GB') : v}</dd>`).join('');
    $('dlg-words').showModal();
  }
  $('st-words').addEventListener('click', showWordCount);

  function showKeys() {
    const groups = [
      ['Text', [['Bold', 'Ctrl B'], ['Italic', 'Ctrl I'], ['Underline', 'Ctrl U'], ['Strikethrough', 'Alt Shift 5'], ['Superscript', 'Ctrl .'], ['Subscript', 'Ctrl ,'], ['Bigger / smaller', 'Ctrl Shift . / ,'], ['Clear formatting', 'Ctrl \\'], ['Link', 'Ctrl K']]],
      ['Paragraphs', [['Normal text', 'Ctrl Alt 0'], ['Heading 1–3', 'Ctrl Alt 1–3'], ['Left / centre / right', 'Ctrl Shift L / E / R'], ['Justify', 'Ctrl Shift J'], ['Numbered list', 'Ctrl Shift 7'], ['Bulleted list', 'Ctrl Shift 8'], ['Checklist', 'Ctrl Shift 9'], ['Indent / outdent', 'Ctrl ] / ['], ['Page break', 'Ctrl Enter']]],
      ['As you type', [['Heading', '# then space'], ['Bulleted list', '- then space'], ['Numbered list', '1. then space'], ['Checklist', '[] then space'], ['Quote', '> then space'], ['Line across the page', '--- then Enter']]],
      ['Notes', [['New note', 'Ctrl Alt N'], ['Save now', 'Ctrl S'], ['Import', 'Ctrl O'], ['Print / PDF', 'Ctrl P'], ['Find and replace', 'Ctrl H'], ['Word count', 'Ctrl Shift C'], ['Focus mode', 'Ctrl Shift F'], ['Undo / redo', 'Ctrl Z / Y'], ['These shortcuts', 'Ctrl /']]]
    ];
    const keys = (s) => s.split(' ').map((k) => (/^[/–]$|then|space|Enter$/.test(k) && k !== 'Enter' ? ` ${k} ` : `<kbd>${k}</kbd>`)).join('');
    $('keys').innerHTML = groups.map(([g, rows]) => `<h3>${g}</h3>${rows.map(([what, k]) => `<div><span>${what}</span><span>${keys(k)}</span></div>`).join('')}`).join('');
    $('dlg-keys').showModal();
  }

  // ---------- GOOGLE DOCS ----------

  function openGdocs(setup) {
    const linked = current && current.gdocId;
    $('gd-client').value = settings.googleClientId || '';
    $('gd-origin').textContent = NN.google.onHttp() ? location.origin : 'http://localhost:4610';
    $('gd-file-warn').hidden = NN.google.onHttp();
    $('gd-linked').hidden = !linked;
    if (linked) $('gd-open').href = current.gdocUrl || `https://docs.google.com/document/d/${current.gdocId}/edit`;
    $('gd-unlink').hidden = !linked;
    $('gd-save-label').textContent = linked ? 'Update the Google Doc' : 'Create Google Doc';
    $('gd-setup').open = setup === true || !settings.googleClientId;
    $('gd-error').textContent = '';
    $('dlg-gdocs').showModal();
  }
  function exported() {
    return NN.convert.exportDocument(editor.html(), { title: current ? current.title : 'Nova Notes', theme: NN.themes.get(settings.theme) });
  }
  $('btn-gdocs').addEventListener('click', () => openGdocs());
  $('gd-copy').addEventListener('click', async () => {
    await saveNow();
    const { body } = exported();
    const res = await NN.google.copyAndOpen(`<meta charset="utf-8">${body}`, NN.convert.toText(editor.html()));
    $('dlg-gdocs').close();
    toast(res.copied ? 'Copied ✦ In the new Google Doc, press Ctrl+V' : "Couldn't copy automatically. Select all in the note and copy it instead.");
  });
  $('gd-client').addEventListener('change', () => {
    settings.googleClientId = $('gd-client').value.trim();
    saveSettings();
  });
  $('gd-save').addEventListener('click', async () => {
    settings.googleClientId = $('gd-client').value.trim();
    saveSettings();
    $('gd-error').textContent = '';
    if (!settings.googleClientId) {
      $('gd-setup').open = true;
      $('gd-error').textContent = 'Add your Google OAuth client ID first (one-time set-up below).';
      $('gd-client').focus();
      return;
    }
    await saveNow();
    const btn = $('gd-save');
    btn.disabled = true;
    $('gd-save-label').textContent = 'Saving to Google Drive…';
    try {
      const res = await NN.google.saveToDrive({ clientId: settings.googleClientId, title: current.title, html: exported().html, fileId: current.gdocId });
      current.gdocId = res.id;
      current.gdocUrl = res.url;
      await S.notes.put(current);
      $('dlg-gdocs').close();
      toast(res.updated ? 'Google Doc updated ✦' : 'Google Doc created ✦', 'Open', () => window.open(res.url, '_blank', 'noopener'));
    } catch (err) {
      $('gd-error').textContent = err.message || 'Something went wrong talking to Google.';
    } finally {
      btn.disabled = false;
      $('gd-save-label').textContent = current.gdocId ? 'Update the Google Doc' : 'Create Google Doc';
    }
  });
  $('gd-unlink').addEventListener('click', async () => {
    current.gdocId = '';
    current.gdocUrl = '';
    await S.notes.put(current);
    openGdocs();
  });

  // ---------- IMPORT / EXPORT ----------

  const safeName = (t) => (t || 'Nova note').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Nova note';
  function download(name, type, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function exportAs(kind) {
    await saveNow();
    const html = editor.html();
    const title = current.title;
    const theme = NN.themes.get(settings.theme);
    const name = safeName(title);
    if (kind === 'html') download(`${name}.html`, 'text/html', NN.convert.exportDocument(html, { title, theme }).html);
    else if (kind === 'doc') download(`${name}.doc`, 'application/msword', NN.convert.wordDocument(html, { title, theme }));
    else if (kind === 'md') download(`${name}.md`, 'text/markdown', NN.convert.toMarkdown(html));
    else if (kind === 'txt') download(`${name}.txt`, 'text/plain', NN.convert.toText(html));
    else if (kind === 'json') download(`${name}.nova-note.json`, 'application/json', JSON.stringify({ app: 'nova-notes', version: 1, exported: new Date().toISOString(), notes: [current] }, null, 2));
    toast(`Downloaded ${name}.${kind === 'json' ? 'nova-note.json' : kind}`);
  }
  async function backupAll() {
    await saveNow();
    const data = await S.backup();
    download(`Nova Notes backup ${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(data, null, 2));
    toast(`Backed up ${data.notes.length} note${data.notes.length === 1 ? '' : 's'}`);
  }
  async function printNote() {
    await saveNow();
    closePops();
    closeMenus();
    window.print();
  }

  function openImport() {
    $('file-import').value = '';
    $('file-import').click();
  }
  $('btn-import').addEventListener('click', openImport);
  $('file-import').addEventListener('change', (e) => importFiles([...e.target.files]));

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.mammoth) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Word import needs an internet connection the first time.'));
      document.head.appendChild(s);
    });
  }
  async function docxToHtml(file) {
    await loadScript(MAMMOTH);
    const result = await window.mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      { styleMap: ["p[style-name='Title'] => p.title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Intense Quote'] => blockquote:fresh"] }
    );
    return NN.convert.clean(result.value);
  }
  const textToHtml = (text) =>
    text
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map((p) => `<p>${NN.convert.esc(p).replace(/\n/g, '<br>')}</p>`)
      .join('');

  async function importFiles(files) {
    let made = 0;
    let restored = 0;
    let last = null;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      try {
        if (ext === 'json') {
          restored += await S.restore(JSON.parse(await f.text()));
          continue;
        }
        if (f.type.startsWith('image/')) {
          insertImageFile(f);
          continue;
        }
        let html;
        if (ext === 'html' || ext === 'htm' || f.type === 'text/html') html = NN.convert.clean(await f.text());
        else if (ext === 'md' || ext === 'markdown') html = NN.convert.clean(NN.convert.fromMarkdown(await f.text()));
        else if (ext === 'docx') html = await docxToHtml(f);
        else if (ext === 'txt' || f.type.startsWith('text/')) html = textToHtml(await f.text());
        else {
          toast(`Nova Notes can't read ${f.name} (try Word, HTML, Markdown or text)`);
          continue;
        }
        last = await createNote(html, f.name.replace(/\.[^.]+$/, ''), true, false);
        made++;
      } catch (err) {
        toast(`Couldn't import ${f.name}: ${err.message}`);
      }
    }
    if (restored) {
      notes = await S.notes.all();
      renderLibrary();
    }
    if (last) await openNote(last.id);
    if (made || restored) toast([made && `Imported ${made} note${made === 1 ? '' : 's'}`, restored && `restored ${restored} from a backup`].filter(Boolean).join(', '));
  }

  // Drop files anywhere to import them
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    if (!e.target.closest || !e.target.closest('#editor')) $('dropzone').hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    $('dropzone').hidden = Boolean(e.target.closest && e.target.closest('#editor'));
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) {
      dragDepth = 0;
      $('dropzone').hidden = true;
    }
  });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    $('dropzone').hidden = true;
    if (!hasFiles(e) || (e.target.closest && e.target.closest('#editor'))) return;
    e.preventDefault();
    importFiles([...e.dataTransfer.files]);
  });

  // ---------- THEME, PAGE, VIEW ----------

  function setTheme(id) {
    const t = NN.themes.get(id);
    settings.theme = t.id;
    saveSettings();
    NN.themes.apply(document.documentElement, t.id);
    const p = NN.convert.palette(t);
    const root = document.documentElement.style;
    const map = { ink: '--p-ink', title: '--p-title', subtitle: '--p-subtitle', h1: '--p-h1', h2: '--p-h2', h3: '--p-h3', rule: '--p-rule', link: '--p-link', quote: '--p-quote', wash: '--p-wash', line: '--p-line' };
    for (const [k, v] of Object.entries(map)) root.setProperty(v, p[k]);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', t.void);
    for (const s of $('themes').children) s.setAttribute('aria-checked', s.dataset.id === t.id ? 'true' : 'false');
    $('bar-color').style.background = t.hi;
    $('bar-highlight').style.background = t.gold;
    if (NN.backdrop && NN.backdrop.ready) NN.backdrop.setTheme(t.id);
    buildSwatches();
  }
  function renderThemes() {
    for (const t of NN.themes.list()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.id = t.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${t.name} theme (${t.tag})`);
      b.title = `${t.name} · ${t.tag}`;
      b.style.cssText = `--sa:${t.accent};--sb:${t.accent3};--sc:${t.hi}`;
      b.addEventListener('click', () => setTheme(t.id));
      $('themes').appendChild(b);
    }
  }
  function setPage(kind) {
    settings.page = kind === 'paper' ? 'paper' : 'cosmic';
    saveSettings();
    shell.classList.toggle('paper', settings.page === 'paper');
    $('st-page').textContent = settings.page === 'paper' ? 'Paper page' : 'Cosmic page';
  }
  $('st-page').addEventListener('click', () => setPage(settings.page === 'paper' ? 'cosmic' : 'paper'));
  function setPageless(on) {
    settings.pageless = on;
    saveSettings();
    shell.classList.toggle('pageless', on);
  }
  function setZoom(z) {
    settings.zoom = z;
    saveSettings();
    document.documentElement.style.setProperty('--zoom', z);
    $('tb-zoom').value = String(z);
    hideBars();
  }
  function applyPanels() {
    shell.classList.toggle('no-library', !settings.library);
    shell.classList.toggle('no-outline', !settings.outline);
  }
  function toggleLibrary() {
    if (narrow.matches) return shell.classList.toggle('show-library');
    settings.library = !settings.library;
    saveSettings();
    applyPanels();
  }
  function toggleOutline() {
    if (midWidth.matches) {
      shell.classList.remove('no-outline');
      return shell.classList.toggle('show-outline');
    }
    settings.outline = !settings.outline;
    saveSettings();
    applyPanels();
  }
  $('btn-library').addEventListener('click', toggleLibrary);
  $('st-outline').addEventListener('click', toggleOutline);
  $('workspace').addEventListener('mousedown', (e) => {
    if (shell.classList.contains('show-library') && !e.target.closest('.library')) shell.classList.remove('show-library');
    if (shell.classList.contains('show-outline') && !e.target.closest('.outline') && midWidth.matches) shell.classList.remove('show-outline');
  });

  let focusExit = null;
  function toggleFocus() {
    const on = shell.classList.toggle('focus');
    if (on) {
      focusExit = document.createElement('button');
      focusExit.type = 'button';
      focusExit.className = 'btn ghost sm focus-exit';
      focusExit.innerHTML = '<svg class="ico"><use href="#i-close"/></svg><span>Leave focus mode</span>';
      focusExit.addEventListener('click', toggleFocus);
      document.body.appendChild(focusExit);
    } else if (focusExit) {
      focusExit.remove();
      focusExit = null;
    }
    hideBars();
    editor.focus();
  }
  // Sound effects: the shared Nova suite sounds (js/sfx.js), on unless switched off on this device
  function sfxOn() {
    return Boolean(window.NovaSfx && window.NovaSfx.enabled());
  }
  function toggleSfx() {
    if (!window.NovaSfx) return toast('Sound effects aren’t available here');
    // A soft "off" chime while sounds are still on, so switching off is heard too (switching on plays its own)
    if (sfxOn()) window.NovaSfx.play('off');
    window.NovaSfx.toggle();
    toast(sfxOn() ? 'Sound effects on' : 'Sound effects off');
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Full screen isn’t available here'));
  }

  // ---------- TOAST ----------

  let toastTimer = null;
  function toast(msg, action, fn) {
    const t = $('toast');
    $('toast-text').textContent = msg;
    const a = $('toast-action');
    a.hidden = !action;
    a.textContent = action || '';
    a.onclick = action
      ? () => {
          t.classList.remove('show');
          fn();
        }
      : null;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6500 : 3200);
  }

  // ---------- KEYBOARD ----------

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const inEditor = e.target.closest && e.target.closest('#editor');
    if (e.key === 'Escape') {
      if (openPop || menuOwner) {
        closePops();
        closeMenus();
        return;
      }
      if (!findbar.hidden) return closeFind();
      if (shell.classList.contains('focus')) return toggleFocus();
      shell.classList.remove('show-library', 'show-outline');
      return;
    }
    if (!mod) return;
    const stop = (fn) => {
      e.preventDefault();
      fn();
    };
    if (!e.shiftKey && !e.altKey) {
      if (k === 's') return stop(() => saveNow().then(() => toast('Saved ✦ (Nova Notes saves as you go)')));
      if (k === 'o') return stop(openImport);
      if (k === 'p') return stop(printNote);
      if (k === 'f' || k === 'h') return stop(openFind);
      if (k === 'k') return stop(openLinkPop);
      if (k === '/') return stop(showKeys);
      if (e.key === 'Enter' && inEditor) return stop(() => editor.exec('pageBreak'));
    }
    if (e.shiftKey && !e.altKey) {
      if (k === 'c' && (inEditor || e.target === document.body)) return stop(showWordCount);
      if (k === 'f') return stop(toggleFocus);
      if (e.code === 'Period') return stop(() => stepSize(1));
      if (e.code === 'Comma') return stop(() => stepSize(-1));
    }
    if (e.altKey && !e.shiftKey && e.code === 'KeyN') return stop(newNote);
  });

  // ---------- AS AN APP ----------
  // Works offline once opened (sw.js), can be installed, and can be launched to do something:
  //   ./?new                     a fresh note (the icon's "New note" shortcut)
  //   ./?share&title=&text=&url= a note from something shared to Nova Notes on a phone
  //   opening a file with it     imports the file (desktop, once installed)

  let installPrompt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('btn-install').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('btn-install').hidden = true;
    toast('Nova Notes is installed ✦ Open it from your apps');
  });
  async function installApp() {
    if (standalone()) return toast('You’re already using the installed app ✦');
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      $('btn-install').hidden = true;
      if (outcome !== 'accepted') toast('No problem: Help → Install Nova Notes whenever you like');
      return;
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    toast(
      ios
        ? 'On iPhone or iPad: tap Share, then “Add to Home Screen”'
        : !NN.google.onHttp()
          ? 'Open Nova Notes from its web address to install it'
          : 'Use your browser’s menu: “Install Nova Notes” or “Add to Home screen”'
    );
  }
  $('btn-install').addEventListener('click', installApp);

  function registerOffline() {
    if (!('serviceWorker' in navigator) || !NN.google.onHttp()) return;
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Nova Notes: offline mode unavailable', err));
  }

  async function handleLaunch() {
    const q = new URLSearchParams(location.search);
    if (q.has('share')) {
      const title = (q.get('title') || '').trim();
      const text = (q.get('text') || '').trim();
      const url = (q.get('url') || '').trim();
      const link = url || (text.match(/https?:\/\/\S+/) || [])[0] || '';
      const body = link && text.includes(link) ? text.replace(link, '').trim() : text;
      const parts = [];
      if (title) parts.push(`<p class="title">${NN.convert.esc(title)}</p>`);
      if (body) parts.push(...body.split(/\n{2,}/).map((p) => `<p>${NN.convert.esc(p).replace(/\n/g, '<br>')}</p>`));
      if (link && /^https?:/.test(link)) parts.push(`<p><a href="${NN.convert.esc(link)}">${NN.convert.esc(link)}</a></p>`);
      if (parts.length) {
        await createNote(parts.join(''), title || (body || link).slice(0, 60) || 'Shared note', Boolean(title));
        toast('Saved what you shared as a new note ✦');
      }
    } else if (q.has('new')) {
      await newNote();
    }
    if (location.search) history.replaceState(null, '', location.pathname);
    // Files opened with the installed app
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (params) => {
        if (!params.files || !params.files.length) return;
        const files = await Promise.all(params.files.map((h) => h.getFile()));
        importFiles(files);
      });
    }
  }

  // ---------- WELCOME NOTE ----------

  const WELCOME = `<p class="title">Welcome to Nova Notes</p>
<p class="subtitle">Notes that write from the centre of the universe outwards.</p>
<h1>Start anywhere</h1>
<p>Everything you write lines up in the <b>middle of the page</b>, headings and all. Change it whenever you like with the alignment buttons, or <i>Format → Align</i>.</p>
<h2>Write the way you do in Google Docs</h2>
<ul><li>Paragraph styles: Title, Subtitle, three headings, quotes and code</li><li>Fonts, sizes, <span style="color: #ff5fa8">colours</span> and highlights</li><li>Lists, checklists, tables, pictures, links and page breaks</li><li>Find and replace, word count, an outline, and undo that remembers everything</li></ul>
<h2>Today’s quests</h2>
<ul class="nn-check"><li class="checked">Open Nova Notes</li><li>Type <code>#</code> and a space for a heading, <code>-</code> for a list or <code>[]</code> for a checklist</li><li>Pick a colour theme from the swatches at the top</li><li>Send this note to Google Docs</li></ul>
<blockquote>Every note is a small star. Together they make a constellation.</blockquote>
<h1>In and out</h1>
<p><b>Import</b> Word documents, web pages, Markdown and text files with <i>File → Import</i>, or drop them onto the window.</p>
<p><b>Export</b> to Google Docs, Word, a web page, Markdown, plain text or PDF. The <b>Google Docs</b> button copies the note across with its Novacane styling, or links to your Google Drive to make the Doc in one click.</p>
<table class="nn-table"><tbody><tr><th>Shortcut</th><th>What it does</th></tr><tr><td>Ctrl + Alt + 1, 2, 3</td><td>Heading 1, 2, 3</td></tr><tr><td>Ctrl + Shift + 8</td><td>Bulleted list</td></tr><tr><td>Ctrl + K</td><td>Add a link</td></tr><tr><td>Ctrl + H</td><td>Find and replace</td></tr><tr><td>Ctrl + /</td><td>Every shortcut</td></tr></tbody></table>
<hr>
<p><i>Your notes stay in this browser. Nothing leaves it unless you export it.</i></p>`;

  // ---------- START ----------

  async function start() {
    renderThemes();
    renderMenubar();
    setTheme(settings.theme);
    NN.backdrop.init(settings.theme);
    NN.backdrop.ready = true;
    setPage(settings.page);
    setPageless(settings.pageless);
    setZoom(settings.zoom || 1);
    applyPanels();
    notes = await S.notes.all();
    if (!notes.length) {
      await createNote(WELCOME, 'Welcome to Nova Notes', false, false);
    }
    const first = notes.find((n) => n.id === settings.lastId) || [...notes].sort((a, b) => b.updated.localeCompare(a.updated))[0];
    await openNote(first.id);
    $('btn-new').addEventListener('click', newNote);
    await handleLaunch();
    registerOffline();
    // Let the launch screen finish its moment, then fade into the app
    // (at least 0.9 s after the script started, so the N and the name are seen)
    const waited = performance.now() - scriptStart;
    const hold = matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : Math.max(0, 900 - waited);
    setTimeout(() => {
      $('splash').classList.add('gone');
      setTimeout(() => $('splash').remove(), 700);
    }, hold);
  }
  start();

  // For the README's screenshots and for checking things by hand in the console
  NN.app = { editor, run, openNote, newNote, importFiles, exportAs, setTheme, setPage, notes: () => notes };
})();
