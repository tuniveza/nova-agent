/* Nova Calendar — app.js
   The calendar, the selected-day panel and the two editors (note card, day card).
   Everything renders from the store; after any change we save and re-render. */
(function () {
  'use strict';
  const NT = window.NT;
  const S = NT.store, T = NT.themes, P = NT.presets, SKY = NT.sky, COS = NT.cosmos;
  const icon = P.icon;

  // ---------- SMALL HELPERS ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const todayKey = () => keyOf(new Date());
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const stampFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtStamp = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : stampFmt.format(d); };
  const shortDate = (k) => { const d = fromKey(k); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };

  function fmtRange(n) {
    const sd = n.start.slice(0, 10), ed = n.end.slice(0, 10);
    const st = n.start.slice(11, 16), et = n.end.slice(11, 16);
    return sd === ed ? `${st} → ${et}` : `${shortDate(sd)} ${st} → ${shortDate(ed)} ${et}`;
  }
  function duration(n) {
    const mins = Math.round((new Date(n.end) - new Date(n.start)) / 60000);
    if (!(mins > 0)) return '';
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return [d && d + 'd', h && h + 'h', m && m + 'm'].filter(Boolean).join(' ');
  }

  // ---------- STATE ----------
  const data = S.load();
  const now = new Date();
  const view = { y: now.getFullYear(), m: now.getMonth(), sel: todayKey() };
  const appTheme = () => data.prefs.theme;
  const dayTheme = (day) => (!day.theme || day.theme === 'app' ? appTheme() : day.theme);
  const daySeed = (day) => COS.hash(day.id + '|' + (day.artSalt || ''));
  // Notes on a date with a day card are painted in that card's colours
  const noteTheme = (key) => { const d = S.dayOn(key); return d ? dayTheme(d) : appTheme(); };

  function persist(msg) {
    if (!S.save()) toast("Couldn't save. Your browser storage may be full or blocked.");
    else if (msg) toast(msg);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- THEME ----------
  function swatchVars(t) { return `--sa:${t.accent};--sb:${t.accent2};--sc:${t.hi}`; }

  function renderThemes() {
    $('#themes').innerHTML = T.list().map((t) =>
      `<button type="button" class="swatch" role="radio" aria-checked="${t.id === appTheme()}" data-theme="${t.id}"
        title="${esc(t.name)}: ${esc(t.tag)}" aria-label="${esc(t.name)} theme, ${esc(t.tag)}" style="${swatchVars(t)}"></button>`).join('');
  }

  function setAppTheme(id) {
    data.prefs.theme = T.get(id).id;
    T.apply(document.documentElement, data.prefs.theme);
    $('meta[name="theme-color"]').setAttribute('content', T.get(id).void);
    NT.backdrop.setTheme(data.prefs.theme);
    persist();
    renderThemes();
    renderAll();
  }

  // ---------- CALENDAR GRID ----------
  function renderMonthLabel() {
    $('#month-label').innerHTML = `${MONTHS[view.m]}<span class="y">${view.y}</span>`;
  }

  function renderGrid() {
    const hadFocus = document.activeElement && document.activeElement.closest && document.activeElement.closest('#grid');
    const first = new Date(view.y, view.m, 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const tk = todayKey();
    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(view.y, view.m, 1 - offset + i);
      const k = keyOf(d);
      const day = S.dayOn(k), notes = S.notesOn(k), seas = SKY.seasonalOn(k), moon = SKY.moon(k);
      const wd = d.getDay();
      const cls = ['cell', d.getMonth() !== view.m && 'out', k === tk && 'today', k === view.sel && 'sel', (wd === 0 || wd === 6) && 'we'].filter(Boolean).join(' ');
      const label = [
        `${DAYS[wd]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
        day && `day card: ${day.title || P.get(day.preset).label}`,
        notes.length && `${notes.length} note card${notes.length > 1 ? 's' : ''}`,
        moon.principal, ...seas.map((s) => s.title)
      ].filter(Boolean).join(', ');

      let middle = '';
      if (day) {
        const pre = P.get(day.preset);
        middle = `<span class="cell-day themed" style="${T.style(dayTheme(day))}">${icon(pre.icon)}<span class="cell-day-t">${esc(day.title || pre.label)}</span></span>`;
      } else if (seas.length) {
        middle = `<span class="cell-season">${icon(P.get(seas[0].preset).icon)}<span class="cell-season-t">${esc(seas[0].title)}</span></span>`;
      }
      const dots = notes.length
        ? `<span class="cell-dots">${notes.slice(0, 4).map(() => '<i></i>').join('')}${notes.length > 4 ? `<b>+${notes.length - 4}</b>` : ''}</span>`
        : '';
      html += `<button type="button" class="${cls}" data-date="${k}" aria-label="${esc(label)}" aria-pressed="${k === view.sel}"${k === tk ? ' aria-current="date"' : ''} tabindex="${k === view.sel ? 0 : -1}">
        <span class="cell-top"><span class="cell-num">${d.getDate()}</span>${moon.principal ? `<span class="cell-moon" title="${esc(moon.fullName || moon.principal)}">${SKY.moonSVG(moon.fraction, 14)}</span>` : ''}</span>
        ${middle}${dots}</button>`;
    }
    const grid = $('#grid');
    grid.innerHTML = html;
    if (hadFocus) { const c = grid.querySelector(`[data-date="${view.sel}"]`); if (c) c.focus(); }
  }

  // Everything noteworthy in the visible month, as a strip of chips under the grid
  function renderStrip() {
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const items = [];
    for (let d = 1; d <= days; d++) {
      const k = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
      const day = S.dayOn(k);
      if (day) {
        const pre = P.get(day.preset);
        items.push(`<button type="button" class="strip-item is-day themed" style="${T.style(dayTheme(day))}" data-date="${k}"><b>${d}</b>${icon(pre.icon)}<span>${esc(day.title || pre.label)}</span></button>`);
      }
      for (const s of SKY.seasonalOn(k)) {
        if (day && day.title === s.title) continue;
        items.push(`<button type="button" class="strip-item" data-date="${k}"><b>${d}</b>${icon(P.get(s.preset).icon)}<span>${esc(s.title)}</span></button>`);
      }
      const m = SKY.moon(k);
      if (m.fullName) items.push(`<button type="button" class="strip-item" data-date="${k}"><b>${d}</b>${SKY.moonSVG(0.5, 14)}<span>${esc(m.fullName)}</span></button>`);
    }
    $('#month-strip').innerHTML = items.join('');
  }

  // ---------- CARDS ----------
  function noteCardHTML(n, theme) {
    const subj = COS.resolveSubject(n.art.seed, n.art.subject);
    const src = COS.render({ seed: n.art.seed, subject: subj, theme, w: 640, h: 360 });
    const dur = duration(n);
    const title = n.title || 'Untitled transmission';
    return `<article class="note-card" data-action="edit-note" data-id="${esc(n.id)}" tabindex="0" role="button" aria-label="Note card: ${esc(title)}. Open to edit.">
      <div class="nc-art"><img src="${src}" alt="" decoding="async"><span class="nc-subj">${esc(COS.label(subj))}</span></div>
      <div class="nc-body">
        <div class="nc-time">${icon('clock')}${esc(fmtRange(n))}${dur ? ` <span>· ${dur}</span>` : ''}</div>
        <h4 class="nc-title">${esc(title)}</h4>
        ${n.body ? `<p class="nc-text">${esc(n.body)}</p>` : ''}
        <div class="nc-foot"><span class="nc-author">✦ ${esc(n.author || 'Anonymous')}</span><span>Logged ${esc(fmtStamp(n.created))}</span></div>
      </div>
    </article>`;
  }

  function dayCardHTML(day, k, notes, preview = false) {
    const pre = P.get(day.preset);
    const th = dayTheme(day);
    const src = COS.render({ seed: daySeed(day), subject: COS.aestheticSubject(day.aesthetic), theme: th, w: 960, h: 320 });
    const bits = [esc(pre.label)];
    if (day.repeat === 'yearly') {
      bits.push('Yearly');
      const yrs = fromKey(k).getFullYear() - fromKey(day.date).getFullYear();
      if (yrs > 0) bits.push(`${yrs} orbit${yrs === 1 ? '' : 's'} round the sun`);
    }
    const head = `<div class="dc-art"><img src="${src}" alt=""></div>
      <div class="dc-head">
        <div class="dc-kicker"><span class="dc-icon">${icon(pre.icon)}</span>${bits.join(' · ')}</div>
        <h3 class="dc-title">${esc(day.title || pre.label || 'Untitled day')}</h3>
      </div>`;
    if (preview) return `<article class="day-card themed aes-${esc(day.aesthetic)}" style="${T.style(th)}">${head}</article>`;
    const meta = (day.location || day.tags.length)
      ? `<div class="dc-meta">${day.location ? `<span class="chip">${icon('pin')}${esc(day.location)}</span>` : ''}${day.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>`
      : '';
    return `<article class="day-card themed aes-${esc(day.aesthetic)}" style="${T.style(th)}">
      ${head}
      <div class="dc-body">
        ${day.info ? `<p class="dc-info">${esc(day.info)}</p>` : ''}
        ${meta}
        <div>
          <div class="sec-head"><h3>Note cards · ${notes.length}</h3><button type="button" class="btn sm primary" data-action="new-note">${icon('plus')}Note</button></div>
          <div class="dc-notes">${notes.map((n) => noteCardHTML(n, th)).join('') || '<p class="empty-sm">No note cards in this day yet.</p>'}</div>
        </div>
        <div class="dc-actions"><button type="button" class="btn sm ghost" data-action="edit-day" data-id="${esc(day.id)}">Edit day card</button></div>
      </div>
    </article>`;
  }

  // ---------- SELECTED-DAY PANEL ----------
  let panelSeasonal = [];

  function renderPanel() {
    const k = view.sel, d = fromKey(k);
    const moon = SKY.moon(k), seas = SKY.seasonalOn(k), day = S.dayOn(k), notes = S.notesOn(k);
    panelSeasonal = seas;
    const moonLine = moon.principal
      ? `<b>${esc(moon.fullName ? `${moon.principal} · ${moon.fullName}` : moon.principal)}</b> at ${pad(moon.at.getHours())}:${pad(moon.at.getMinutes())}`
      : `<b>${esc(moon.name)}</b> · ${Math.round(moon.illumination * 100)}% lit`;
    let html = `<header>
      <div class="ph-kicker">${DAYS[d.getDay()]}${k === todayKey() ? ' · Today' : ''}</div>
      <h2 class="ph-date">${d.getDate()} ${MONTHS[d.getMonth()]} <span>${d.getFullYear()}</span></h2>
      <div class="ph-moon">${SKY.moonSVG(moon.fraction, 30)}<span>${moonLine}</span></div>
      ${seas.length ? `<div class="ph-seasonal">${seas.map((s, i) => day
        ? `<span class="chip">${icon(P.get(s.preset).icon)}${esc(s.title)}</span>`
        : `<button type="button" class="chip" data-action="seasonal" data-idx="${i}" title="Make a day card for ${esc(s.title)}">${icon(P.get(s.preset).icon)}${esc(s.title)}</button>`).join('')}</div>` : ''}
    </header>`;

    if (day) {
      html += dayCardHTML(day, k, notes);
    } else {
      const quick = ['birthday', 'anniversary', 'session', 'release', 'trip', 'custom'];
      html += `<section class="empty-day">
          <h3>No day card yet</h3>
          <p>Give this day a title, an aesthetic and a theme${seas.length ? ', or tap a seasonal day above' : ''}.</p>
          <div class="quick-presets">${quick.map((id) => { const p = P.get(id); return `<button type="button" class="chip" data-action="new-day" data-preset="${id}">${icon(p.icon)}${esc(p.label)}</button>`; }).join('')}</div>
        </section>
        <section>
          <div class="sec-head"><h3>Note cards · ${notes.length}</h3><button type="button" class="btn sm primary" data-action="new-note">${icon('plus')}Note card</button></div>
          ${notes.length ? `<div class="note-list">${notes.map((n) => noteCardHTML(n, appTheme())).join('')}</div>` : '<p class="empty-sm">Nothing logged for this day yet.</p>'}
        </section>`;
    }
    $('#panel').innerHTML = html;
  }

  function renderAll() {
    renderMonthLabel();
    renderGrid();
    renderStrip();
    renderPanel();
  }

  function select(k, focusCell) {
    view.sel = k;
    const d = fromKey(k);
    view.y = d.getFullYear();
    view.m = d.getMonth();
    renderAll();
    if (focusCell) { const c = $(`#grid [data-date="${k}"]`); if (c) c.focus(); }
  }

  function shiftMonth(n) {
    const sd = fromKey(view.sel).getDate();
    const target = new Date(view.y, view.m + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(sd, last));
    select(keyOf(target));
  }

  // ---------- CONFIRM ----------
  function confirmDelete(title, msg) {
    const dlg = $('#confirm-dlg');
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = msg;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  // ---------- NOTE EDITOR ----------
  const noteDlg = $('#note-dlg'), noteForm = $('#note-form');
  let noteDraft = null; // { id, seed, locked, created }

  function defaultTimes(k) {
    let h = 9;
    if (k === todayKey()) h = Math.min(new Date().getHours() + 1, 22);
    return { start: `${k}T${pad(h)}:00`, end: `${k}T${pad(h + 1)}:00` };
  }

  // A new note's picture follows its words until you press Regenerate; a saved note keeps its own
  function draftSeed() {
    if (noteDraft.locked) return noteDraft.seed;
    const f = noteForm.elements;
    return COS.hash(`${f.title.value}\n${f.body.value}\n${f.author.value}`);
  }

  function updateNoteArt() {
    const seed = draftSeed();
    const subj = COS.resolveSubject(seed, $('#note-subject').value);
    const start = noteForm.elements.start.value;
    const theme = start ? noteTheme(start.slice(0, 10)) : appTheme();
    $('#note-art').src = COS.render({ seed, subject: subj, theme, w: 640, h: 360 });
    $('#note-art-cap').textContent = `${COS.label(subj)} · seed ${seed.toString(16).toUpperCase().padStart(8, '0')}`;
  }
  const updateNoteArtSoon = debounce(updateNoteArt, 260);

  function openNote(id, dateKey) {
    const n = id ? S.getNote(id) : null;
    const t = defaultTimes(dateKey || view.sel);
    noteDraft = n ? { id: n.id, seed: n.art.seed, locked: true, created: n.created } : { id: null, seed: 0, locked: false, created: null };
    const f = noteForm.elements;
    f.title.value = n ? n.title : '';
    f.body.value = n ? n.body : '';
    f.author.value = n ? n.author : data.prefs.author || '';
    f.start.value = n ? n.start : t.start;
    f.end.value = n ? n.end : t.end;
    $('#note-subject').value = n ? n.art.subject : 'auto';
    $('#note-dlg-title').textContent = n ? 'Edit note card' : 'New note card';
    $('#note-delete').hidden = !n;
    $('#note-error').textContent = '';
    $('#note-stamp').textContent = n
      ? `Logged ${fmtStamp(n.created)}${n.updated && n.updated !== n.created ? ` · edited ${fmtStamp(n.updated)}` : ''}`
      : 'The log timestamp is added when you save.';
    updateNoteArt();
    noteDlg.showModal();
    f.title.focus();
  }

  function initNoteEditor() {
    $('#note-subject').innerHTML = `<option value="auto">Art: auto</option>` +
      COS.subjects().map((s) => `<option value="${s}">Art: ${esc(COS.label(s))}</option>`).join('');
    $('#note-regen').innerHTML = `${icon('dice')}Regenerate`;
    $('#note-download').innerHTML = `${icon('download')}Save image`;

    noteForm.addEventListener('input', (e) => {
      if (['title', 'body', 'author'].includes(e.target.name)) updateNoteArtSoon();
    });
    noteForm.elements.start.addEventListener('change', () => {
      const f = noteForm.elements;
      // keep the finish after the start, holding the same length where possible
      if (f.start.value && (!f.end.value || f.end.value < f.start.value)) {
        const d = new Date(f.start.value);
        d.setHours(d.getHours() + 1);
        f.end.value = `${keyOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
      updateNoteArt();
    });
    $('#note-subject').addEventListener('change', updateNoteArt);
    $('#note-regen').addEventListener('click', () => {
      noteDraft.locked = true;
      noteDraft.seed = COS.randomSeed();
      updateNoteArt();
    });
    $('#note-download').addEventListener('click', (e) => {
      const seed = draftSeed();
      const f = noteForm.elements;
      const theme = f.start.value ? noteTheme(f.start.value.slice(0, 10)) : appTheme();
      e.currentTarget.href = COS.render({ seed, subject: $('#note-subject').value, theme, w: 1920, h: 1080, type: 'image/png' });
      const slug = (f.title.value || 'nova-calendar-note').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'nova-calendar-note';
      e.currentTarget.download = `${slug}.png`;
    });

    noteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = noteForm.elements;
      const err = $('#note-error');
      if (!f.start.value || !f.end.value) { err.textContent = 'Set a start and a finish time.'; return; }
      if (f.end.value < f.start.value) { err.textContent = 'The finish has to come after the start.'; return; }
      const stamp = new Date().toISOString();
      const note = {
        id: noteDraft.id || S.uid(),
        title: f.title.value.trim(), body: f.body.value.trim(), author: f.author.value.trim(),
        start: f.start.value, end: f.end.value,
        art: { seed: draftSeed(), subject: $('#note-subject').value },
        created: noteDraft.created || stamp, updated: stamp
      };
      S.upsertNote(note);
      if (note.author) data.prefs.author = note.author;
      const wasEdit = !!noteDraft.id;
      noteDlg.close();
      persist(wasEdit ? 'Note card updated' : 'Note card added');
      select(note.start.slice(0, 10));
    });

    $('#note-delete').addEventListener('click', async () => {
      if (!noteDraft.id) return;
      const id = noteDraft.id;
      noteDlg.close();
      if (await confirmDelete('Delete this note card?', 'It and its picture will be gone for good.')) {
        S.removeNote(id);
        persist('Note card deleted');
        renderAll();
      } else {
        openNote(id);
      }
    });
  }

  // ---------- DAY EDITOR ----------
  const dayDlg = $('#day-dlg'), dayForm = $('#day-form');
  let dayDraft = null; // { id, tempId, created, artSalt, lastPreset }

  const radio = (name) => { const el = dayForm.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  const setRadio = (name, value) => {
    const el = dayForm.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
    if (el) el.checked = true;
  };

  function readDay() {
    const f = dayForm.elements;
    return {
      id: dayDraft.id || dayDraft.tempId,
      date: f.date.value,
      preset: radio('preset') || 'custom',
      title: f.title.value.trim(),
      aesthetic: radio('aesthetic') || 'nebula',
      theme: radio('theme') || 'app',
      info: f.info.value.trim(),
      location: f.location.value.trim(),
      tags: f.tags.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12),
      repeat: f.repeat.checked ? 'yearly' : 'none',
      artSalt: dayDraft.artSalt,
      created: dayDraft.created
    };
  }

  function updateDayPreview() {
    const d = readDay();
    $('#day-preview').innerHTML = dayCardHTML(d, d.date || view.sel, [], true);
  }
  const updateDayPreviewSoon = debounce(updateDayPreview, 150);

  function openDay({ id, date, preset, seasonal } = {}) {
    const k = date || view.sel;
    let day = id ? S.getDay(id) : S.dayOn(k); // one card per date: open the existing one
    const p = P.get(day ? day.preset : (seasonal && seasonal.preset) || preset || 'custom');
    dayDraft = { id: day ? day.id : null, tempId: S.uid(), created: day ? day.created : null, artSalt: day ? day.artSalt : '', lastPreset: p };
    const f = dayForm.elements;
    setRadio('preset', p.id);
    f.title.value = day ? day.title : (seasonal && seasonal.title) || p.title;
    f.date.value = day ? day.date : k;
    f.repeat.checked = day ? day.repeat === 'yearly' : !!p.repeat;
    setRadio('aesthetic', day ? day.aesthetic : (seasonal && seasonal.aesthetic) || p.aesthetic);
    setRadio('theme', day ? day.theme || 'app' : (seasonal && seasonal.theme) || p.theme);
    f.info.value = day ? day.info : p.info || '';
    f.location.value = day ? day.location : '';
    f.tags.value = day ? day.tags.join(', ') : '';
    $('#day-dlg-title').textContent = day ? 'Edit day card' : 'New day card';
    $('#day-delete').hidden = !day;
    $('#day-series-note').hidden = !(day && day.repeat === 'yearly');
    $('#day-error').textContent = '';
    updateDayPreview();
    dayDlg.showModal();
    f.title.focus();
  }

  function initDayEditor() {
    $('#preset-grid').innerHTML = P.list().map((p) =>
      `<label class="opt"><input type="radio" name="preset" value="${p.id}"><span>${icon(p.icon)}${esc(p.label)}</span></label>`).join('');
    $('#aes-grid').innerHTML = P.aesthetics().map((a) =>
      `<label class="opt" title="${esc(a.hint)}"><input type="radio" name="aesthetic" value="${a.id}"><span><span class="aes-sample aes-${a.id}"><b class="dc-title">${esc(a.label)}</b></span></span></label>`).join('');
    $('#day-theme-grid').innerHTML =
      `<label class="opt"><input type="radio" name="theme" value="app"><span><i class="sw sw-app"></i>App theme</span></label>` +
      T.list().map((t) => `<label class="opt"><input type="radio" name="theme" value="${t.id}"><span><i class="sw" style="${swatchVars(t)}"></i>${esc(t.name)}</span></label>`).join('');
    $('#day-reroll').innerHTML = `${icon('dice')}New artwork`;

    dayForm.addEventListener('change', (e) => {
      if (e.target.name === 'preset') {
        // A preset fills in its defaults, but never overwrites anything you typed yourself
        const p = P.get(e.target.value), last = dayDraft.lastPreset, f = dayForm.elements;
        if (!f.title.value.trim() || f.title.value === last.title) f.title.value = p.title;
        if (!f.info.value.trim() || f.info.value === (last.info || '')) f.info.value = p.info || '';
        setRadio('aesthetic', p.aesthetic);
        setRadio('theme', p.theme);
        f.repeat.checked = !!p.repeat;
        dayDraft.lastPreset = p;
      }
      updateDayPreview();
    });
    dayForm.addEventListener('input', updateDayPreviewSoon);
    $('#day-reroll').addEventListener('click', () => {
      dayDraft.artSalt = Math.random().toString(36).slice(2, 10);
      updateDayPreview();
    });

    dayForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = readDay();
      const err = $('#day-error');
      if (!d.date) { err.textContent = 'Pick a date for this day card.'; return; }
      const clash = data.days.find((x) => x.date === d.date && x.id !== d.id);
      if (clash) { err.textContent = `${shortDate(d.date)} already has a day card ("${clash.title || P.get(clash.preset).label}"). Edit that one instead.`; return; }
      const stamp = new Date().toISOString();
      d.created = d.created || stamp;
      d.updated = stamp;
      const wasEdit = !!dayDraft.id;
      S.upsertDay(d);
      dayDlg.close();
      persist(wasEdit ? 'Day card updated' : 'Day card created');
      select(d.date);
      if (e.submitter && e.submitter.value === 'note') openNote(null, d.date);
    });

    $('#day-delete').addEventListener('click', async () => {
      if (!dayDraft.id) return;
      const id = dayDraft.id;
      dayDlg.close();
      if (await confirmDelete('Delete this day card?', 'Note cards on this day stay where they are.')) {
        S.removeDay(id);
        persist('Day card deleted');
        renderAll();
      } else {
        openDay({ id });
      }
    });
  }

  // ---------- BACKUP ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(S.snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nova-calendar-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = S.importJSON(String(reader.result));
        persist(`Imported ${r.days} day card${r.days === 1 ? '' : 's'} and ${r.notes} note card${r.notes === 1 ? '' : 's'}`);
        renderAll();
      } catch (err) {
        toast(err.message || "That file couldn't be read.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- SOUND ----------
  // The soft Nova suite sounds on every press come from js/sfx.js (shared by every Nova app).
  // This is just their on/off button in the top bar; the choice is remembered on this device.
  const sfx = () => window.NovaSfx;
  function renderSound() {
    const b = $('#sound');
    const on = Boolean(sfx() && sfx().enabled());
    b.hidden = !sfx();
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Sound effects are on (click to switch them off)' : 'Sound effects are off (click to switch them on)';
    b.innerHTML = `${icon(on ? 'sound' : 'muted')}Sound`;
  }
  function toggleSound() {
    if (!sfx()) return;
    // A soft "off" chime while sounds are still on, so switching off is heard too (switching on plays its own)
    if (sfx().enabled()) sfx().play('off');
    sfx().toggle();
  }

  // ---------- WIRING ----------
  function bind() {
    $('#prev').innerHTML = icon('left');
    $('#next').innerHTML = icon('right');
    $('#new-note').innerHTML = `${icon('plus')}Note card`;
    $('#new-day').innerHTML = `${icon('sparkle')}Day card`;
    $('#export').innerHTML = `${icon('download')}Export`;
    $('#import').innerHTML = `${icon('upload')}Import`;
    $('#lg-moon').innerHTML = SKY.moonSVG(0.62, 12);
    document.querySelectorAll('[data-close]').forEach((b) => { b.innerHTML = b.classList.contains('icon-btn') ? icon('close') : b.innerHTML; });
    $('#weekdays').innerHTML = WEEK.map((w, i) => `<div class="wd${i > 4 ? ' we' : ''}">${w}</div>`).join('');

    $('#prev').addEventListener('click', () => shiftMonth(-1));
    $('#next').addEventListener('click', () => shiftMonth(1));
    $('#today').addEventListener('click', () => select(todayKey()));
    $('#new-note').addEventListener('click', () => openNote(null, view.sel));
    $('#new-day').addEventListener('click', () => openDay({ date: view.sel }));
    $('#export').addEventListener('click', exportData);
    $('#import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
    $('#themes').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setAppTheme(b.dataset.theme); });
    renderSound();
    $('#sound').addEventListener('click', toggleSound);
    window.addEventListener('novasfxchange', renderSound);

    $('#grid').addEventListener('click', (e) => { const c = e.target.closest('[data-date]'); if (c) select(c.dataset.date); });
    $('#month-strip').addEventListener('click', (e) => { const c = e.target.closest('[data-date]'); if (c) select(c.dataset.date); });

    $('#panel').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      if (a === 'new-note') openNote(null, view.sel);
      else if (a === 'edit-note') openNote(el.dataset.id);
      else if (a === 'new-day') openDay({ date: view.sel, preset: el.dataset.preset });
      else if (a === 'edit-day') openDay({ id: el.dataset.id });
      else if (a === 'seasonal') openDay({ date: view.sel, seasonal: panelSeasonal[Number(el.dataset.idx)] });
    });
    $('#panel').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.note-card')) { e.preventDefault(); e.target.click(); }
    });

    document.querySelectorAll('dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) dlg.close();
        else if (e.target === dlg) dlg.close(); // click on the backdrop
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      const k = e.key;
      if (k === 'n' || k === 'N') { e.preventDefault(); openNote(null, view.sel); }
      else if (k === 'd' || k === 'D') { e.preventDefault(); openDay({ date: view.sel }); }
      else if (k === 't' || k === 'T') select(todayKey(), !!e.target.closest('#grid'));
      else if (k === 'PageUp') { e.preventDefault(); shiftMonth(-1); }
      else if (k === 'PageDown') { e.preventDefault(); shiftMonth(1); }
      else if (e.target.closest('#grid') && k in { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 }) {
        e.preventDefault();
        select(addDays(view.sel, { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[k]), true);
      }
    });

    // roll over to the new day if the tab is left open past midnight
    let lastToday = todayKey();
    setInterval(() => { if (todayKey() !== lastToday) { lastToday = todayKey(); renderGrid(); } }, 60000);
  }

  // ---------- AS AN APP ----------
  // Installable from the browser, works offline once opened (sw.js), and the launcher icon's
  // shortcuts open straight into a new note card (./?new=note) or day card (./?new=day).
  let installPrompt = null;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    $('#install').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('#install').hidden = true;
    toast('Nova Calendar is installed ✦ Open it from your apps');
  });
  $('#install').addEventListener('click', async () => {
    if (standalone() || !installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('#install').hidden = true;
  });
  function handleLaunch() {
    const q = new URLSearchParams(location.search);
    const what = q.get('new');
    if (what === 'note') openNote(null, view.sel);
    else if (what === 'day') openDay({ date: view.sel });
    if (location.search) history.replaceState(null, '', location.pathname);
  }
  function registerOffline() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[Nova Calendar] offline mode unavailable', err));
    }
  }

  // ---------- START ----------
  const scriptStart = performance.now();
  T.apply(document.documentElement, appTheme());
  $('meta[name="theme-color"]').setAttribute('content', T.get(appTheme()).void);
  NT.backdrop.init(appTheme());
  renderThemes();
  initNoteEditor();
  initDayEditor();
  bind();
  renderAll();
  handleLaunch();
  registerOffline();
  // The launch screen holds for a moment so the moon and the name are seen, then fades away
  {
    const splash = document.getElementById('splash');
    const hold = matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : Math.max(0, 900 - (performance.now() - scriptStart));
    setTimeout(() => {
      splash.classList.add('gone');
      setTimeout(() => splash.remove(), 700);
    }, hold);
  }
})();
