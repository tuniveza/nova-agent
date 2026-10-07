/* Nova Observatory — observatory.js
   Renders window.OBSERVATORY (written by scan.mjs) as project decks, a detail view with screenshots and
   video, and a star map of the folder tree. Nothing here touches the disk; run "npm run build" to refresh. */
(function () {
  'use strict';
  const NO = window.NO;
  const D = window.OBSERVATORY;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- FORMATTING ----------
  const nf = new Intl.NumberFormat('en-GB');
  const num = (n) => nf.format(Math.round(n || 0));
  function bytes(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  const rtfShort = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto', style: 'short' });
  function ago(iso, short = false) {
    if (!iso) return 'never';
    const f = short ? rtfShort : rtf;
    const s = (new Date(iso) - Date.now()) / 1000;
    const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'], [Infinity, 'year']];
    const div = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
    for (const [lim, unit] of steps) if (Math.abs(s) < lim) return f.format(Math.round(s / div[unit]), unit);
    return '';
  }
  const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const when = (iso) => (iso ? dateFmt.format(new Date(iso)) : '—');
  const home = (p) => String(p || '').replace(/^\/home\/[^/]+/, '~');

  // Familiar language colours (GitHub's), so the bars read at a glance
  const LANG_COLOURS = {
    JavaScript: '#F1E05A', TypeScript: '#3178C6', HTML: '#E34C26', CSS: '#663399', Kotlin: '#A97BFF', Java: '#B07219',
    C: '#7D8A9C', 'C++': '#F34B7D', 'C#': '#178600', Python: '#3572A5', Ruby: '#CC342D', Lua: '#5468F0', GDScript: '#4FB3D9',
    Haxe: '#DF7900', Crystal: '#C8C8D0', Odin: '#60AFFE', Assembly: '#6E4C13', GML: '#71B417', Shaders: '#FF5FA8',
    Shell: '#89E051', SQL: '#E38C00', Go: '#00ADD8', Rust: '#DEA584', Zig: '#EC915C', Gleam: '#FFAFF3'
  };
  const langColour = (n) => LANG_COLOURS[n] || '#9C8FD0';

  const ICON = {
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>'
  };

  // A speaker with sound coming out, and the same speaker switched off (the sound effects button)
  ICON.sound = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.3 6.2a8.5 8.5 0 0 1 0 11.6"/></svg>';
  ICON.muted = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>';

  const STATUS = { live: 'Live', active: 'Active', released: 'Released', skeleton: 'Skeleton', empty: 'Awaiting launch', building: 'Building' };

  // ---------- THEME (remembered per browser) ----------
  const THEME_KEY = 'nova-observatory/theme';
  let theme = 'quasar';
  try { theme = localStorage.getItem(THEME_KEY) || theme; } catch { /* storage blocked: use default */ }

  function renderThemes() {
    $('#themes').innerHTML = NO.themes.list().map((t) =>
      `<button type="button" class="swatch" role="radio" aria-checked="${t.id === theme}" data-theme="${t.id}" title="${esc(t.name)}: ${esc(t.tag)}"
        aria-label="${esc(t.name)} theme" style="--sa:${t.accent};--sb:${t.accent2};--sc:${t.hi}"></button>`).join('');
  }
  function setTheme(id) {
    theme = NO.themes.get(id).id;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* fine */ }
    NO.themes.apply(document.documentElement, theme);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', NO.themes.get(theme).void);
    NO.backdrop.setTheme(theme);
    renderThemes();
    renderStarmap();
  }

  // ---------- SOUND ----------
  // The soft Nova suite sounds on every press come from js/sfx.js (shared by every Nova app).
  // This is just their on/off button in the header; the choice is remembered on this device.
  const sfx = () => window.NovaSfx;
  function renderSound() {
    const b = $('#sound');
    const on = Boolean(sfx() && sfx().enabled());
    b.hidden = !sfx();
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Sound effects are on (click to switch them off)' : 'Sound effects are off (click to switch them on)';
    b.innerHTML = `${on ? ICON.sound : ICON.muted}<span>Sound ${on ? 'on' : 'off'}</span>`;
  }
  function bindSound() {
    renderSound();
    $('#sound').addEventListener('click', () => {
      if (!sfx()) return;
      // A soft "off" chime while sounds are still on, so switching off is heard too (switching on plays its own)
      if (sfx().enabled()) sfx().play('off');
      sfx().toggle();
    });
    window.addEventListener('novasfxchange', renderSound);
  }

  // ---------- TOAST / COPY ----------
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      ta.remove();
    }
    toast('Path copied');
  }

  // ---------- MEDIA ----------
  const mediaUrl = (p, file) => `media/${encodeURIComponent(p.id)}/${encodeURIComponent(file)}`;
  const COVER_SUBJECT = { 'Nova suite': 'nebula', Games: 'planet', Tools: 'constellation', Experiments: 'galaxy' };
  function cover(p, w = 800, h = 450) {
    return NO.cosmos.render({ seed: NO.cosmos.hash(p.id), subject: p.status === 'empty' ? 'eclipse' : COVER_SUBJECT[p.category] || 'nebula', theme: p.theme || theme, w, h });
  }
  const poster = (p) => (p.media && p.media.poster ? mediaUrl(p, p.media.poster) : null);

  // ---------- HEADER ----------
  function renderHeader() {
    const t = D.totals;
    const decks = D.projects.length;
    const inner = D.projects.reduce((s, p) => s + (p.group ? p.members.length : 1), 0);
    $('#lede').innerHTML = `<b>${decks}</b> decks covering <b>${inner}</b> projects under <span class="mono">${esc(home(D.root))}</span>. Last scan ${esc(ago(D.generatedAt))}; latest change anywhere ${esc(ago(t.newest))}.`;
    const stats = [
      [num(t.lines), 'Lines of code', true], [bytes(t.bytes), 'Project files'], [bytes(t.disk), 'On disk'],
      [num(t.files), 'Files'], [String(t.langs.length), 'Languages'], [ago(t.newest, true), 'Last activity']
    ];
    $('#stats').innerHTML = stats.map(([v, l, lead]) => `<div class="stat${lead ? ' lead' : ''}"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
    $('#spectrum').innerHTML = langBar(t.langs, 9);
  }

  function langBar(langs, keyCount = 5) {
    const list = langs.filter((l) => l.lines > 0);
    const total = list.reduce((s, l) => s + l.lines, 0) || 1;
    const bar = list.map((l) => `<i style="width:${(l.lines / total) * 100}%;background:${langColour(l.name)}" title="${esc(l.name)}: ${num(l.lines)} lines"></i>`).join('');
    const key = list.slice(0, keyCount).map((l) => `<span><i style="background:${langColour(l.name)}"></i>${esc(l.name)} <b>${Math.round((l.lines / total) * 100)}%</b></span>`).join('');
    return `<div class="lang-bar" role="img" aria-label="${esc(list.slice(0, 5).map((l) => `${l.name} ${Math.round((l.lines / total) * 100)}%`).join(', '))}">${bar}</div>${keyCount ? `<div class="lang-key">${key}</div>` : ''}`;
  }

  // ---------- DECKS ----------
  const state = { q: '', cat: 'All', sort: 'recent' };
  const CATS = ['All', 'Nova suite', 'Games', 'Tools', 'Experiments'];

  function renderFilters() {
    $('#filters').innerHTML = CATS.map((c) => {
      const n = c === 'All' ? D.projects.length : D.projects.filter((p) => p.category === c).length;
      return `<button type="button" class="filter" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${esc(c)}<small>${n}</small></button>`;
    }).join('');
  }

  function haystack(p) {
    return [p.name, p.tagline, p.goal, p.vision, p.kind, p.category, p.path, ...(p.stack || []), ...(p.features || []),
      ...((p.members || []).map((m) => m.name + ' ' + m.path)), ...((p.stats && p.stats.langs) || []).map((l) => l.name)].join(' ').toLowerCase();
  }

  function visible() {
    const q = state.q.trim().toLowerCase();
    const list = D.projects.filter((p) => (state.cat === 'All' || p.category === state.cat) && (!q || q.split(/\s+/).every((w) => haystack(p).includes(w))));
    const key = {
      recent: (p) => -(p.stats && p.stats.newest ? new Date(p.stats.newest).getTime() : 0),
      lines: (p) => -((p.stats && p.stats.lines) || 0),
      disk: (p) => -((p.stats && p.stats.disk) || 0),
      name: (p) => p.name.toLowerCase()
    }[state.sort];
    return list.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }

  function deckHTML(p) {
    const s = p.stats || {};
    const img = poster(p);
    const hasVideo = p.media && p.media.video;
    const media = img
      ? `<img src="${img}" alt="" loading="lazy" decoding="async">${hasVideo ? `<video muted loop playsinline preload="none" data-src="${mediaUrl(p, p.media.video)}"></video><span class="play-hint">${ICON.play}</span>` : ''}`
      : `<img src="${cover(p)}" alt="" decoding="async"><span class="cover-title">${esc(p.name)}</span>`;
    const stack = (p.stack || []).slice(0, 5).map((t) => `<span class="chip">${esc(t)}</span>`).join('') + ((p.stack || []).length > 5 ? `<span class="chip">+${p.stack.length - 5}</span>` : '');
    const git = p.git ? ` · <b>${num(p.git.commits)}</b> commits` : '';
    return `<article class="deck themed" style="${NO.themes.style(p.theme || theme)}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}: open details">
      <div class="deck-media">
        <div class="pills"><span class="pill s-${esc(p.status)}"><i></i>${esc(STATUS[p.status] || p.status)}</span><span class="pill">${esc(p.category)}</span></div>
        ${media}
      </div>
      <div class="deck-body">
        <h3 class="deck-name">${esc(p.name)}</h3>
        <p class="deck-tag">${esc(p.tagline)}</p>
        <p class="deck-goal">${esc(p.goal)}</p>
        ${stack ? `<div class="chips">${stack}</div>` : ''}
        <div class="path" title="${esc(p.path)}">${ICON.folder}<span>${esc(home(p.path))}</span><button type="button" class="copy" data-copy="${esc(p.path)}" aria-label="Copy path">${ICON.copy}</button></div>
        <div class="figures">
          <div class="fig"><b>${num(s.lines)}</b><span>Lines</span></div>
          <div class="fig"><b>${bytes(s.bytes)}</b><span>Size</span></div>
          <div class="fig"><b>${bytes(s.disk)}</b><span>On disk</span></div>
          <div class="fig"><b>${num(s.files)}</b><span>Files</span></div>
        </div>
        ${s.langs && s.langs.some((l) => l.lines) ? langBar(s.langs, 0) : ''}
        <div class="deck-foot"><span>Changed <b>${esc(ago(s.newest))}</b>${git}</span><span>${esc(p.kind)}</span></div>
      </div>
    </article>`;
  }

  function renderDecks() {
    const list = visible();
    $('#decks').innerHTML = list.map(deckHTML).join('');
    $('#none').hidden = list.length > 0;
  }

  // Hovering a deck plays its demo video
  function bindDeckVideo() {
    const decks = $('#decks');
    decks.addEventListener('pointerover', (e) => {
      const deck = e.target.closest('.deck');
      if (!deck || deck.classList.contains('playing') || reduceMotion || e.pointerType === 'touch') return;
      const v = deck.querySelector('video');
      if (!v) return;
      if (!v.src) v.src = v.dataset.src;
      v.play().then(() => deck.classList.add('playing')).catch(() => {});
    });
    decks.addEventListener('pointerout', (e) => {
      const deck = e.target.closest('.deck');
      if (!deck || deck.contains(e.relatedTarget)) return;
      const v = deck.querySelector('video');
      deck.classList.remove('playing');
      if (v) { v.pause(); v.currentTime = 0; }
    });
  }

  // ---------- DETAIL ----------
  const dlg = $('#detail');

  function crumbs(p) {
    const rel = p.path.startsWith(D.root) ? p.path.slice(D.root.length) : p.path;
    const parts = rel.split('/').filter(Boolean);
    return `<div class="crumbs"><b>${esc(home(D.root))}</b>${parts.map((s) => `<span>/</span><b>${esc(s)}</b>`).join('')}</div>`;
  }

  function treeHTML(p) {
    if (!p.tree || !p.tree.length) return '<p class="media-note">No files yet.</p>';
    const max = Math.max(...p.tree.map((n) => n.bytes), 1);
    const row = (n, m, cls = 'leaf') => `<div class="${cls}"><span class="bar" style="width:${Math.max(2, (n.bytes / m) * 100)}%"></span><span class="nm">${esc(n.path.split('/').pop())}${n.dir ? '/' : ''}</span><span class="sz">${bytes(n.bytes)} · ${num(n.files)}</span></div>`;
    const items = p.tree.map((n) => {
      if (!n.dir || !n.children.length) return row(n, max);
      const cmax = Math.max(...n.children.map((c) => c.bytes), 1);
      return `<details><summary><span class="bar" style="width:${Math.max(2, (n.bytes / max) * 100)}%"></span><span class="nm">${esc(n.path)}/</span><span class="sz">${bytes(n.bytes)} · ${num(n.files)}</span></summary>
        <div class="kids">${n.children.map((c) => row(c, cmax)).join('')}</div></details>`;
    }).join('');
    const ign = (p.ignored || []).length
      ? `<div class="ignored">${p.ignored.map((i) => `<span class="chip" title="${i.kind === 'vendored' ? 'Third-party code, not counted as source' : 'Dependencies or build output, not counted as source'}">${esc(i.path)}/ · ${bytes(i.bytes)} · ${i.kind}</span>`).join('')}</div>`
      : '';
    return `<div class="tree">${items}</div>${ign}`;
  }

  function langTable(langs) {
    const list = langs.filter((l) => l.lines > 0);
    if (!list.length) return '';
    const total = list.reduce((s, l) => s + l.lines, 0);
    return `${langBar(list, 0)}<div class="lang-table">${list.slice(0, 8).map((l) =>
      `<div class="lang-row"><i style="background:${langColour(l.name)}"></i><span>${esc(l.name)}</span><span class="n">${num(l.lines)} lines</span><span class="n">${Math.round((l.lines / total) * 100)}%</span></div>`).join('')}</div>`;
  }

  function viewerItems(p) {
    const items = [];
    if (p.media && p.media.video) items.push({ type: 'video', src: mediaUrl(p, p.media.video), poster: poster(p), caption: 'Demo' });
    for (const s of (p.media && p.media.shots) || []) items.push({ type: 'image', src: mediaUrl(p, s.file), caption: s.caption });
    if (!items.length) items.push({ type: 'image', src: cover(p, 1280, 720), caption: 'Generated cover' });
    return items;
  }

  function showItem(items, i) {
    const it = items[i];
    const viewer = $('#viewer');
    viewer.innerHTML = it.type === 'video'
      ? `<video src="${it.src}" poster="${it.poster || ''}" controls muted loop playsinline ${reduceMotion ? '' : 'autoplay'}></video>`
      : `<img src="${it.src}" alt="${esc(it.caption)}"><span class="cap">${esc(it.caption)}</span>`;
    document.querySelectorAll('#thumbs .thumb').forEach((t, j) => t.setAttribute('aria-current', String(j === i)));
  }

  function openDetail(id, push = true) {
    const p = D.projects.find((x) => x.id === id);
    if (!p) return;
    const s = p.stats || {};
    const items = viewerItems(p);
    const g = p.git;
    const facts = [
      ['Location', `${crumbs(p)}<div style="margin-top:6px"><button type="button" class="btn" data-copy="${esc(p.path)}">${ICON.copy}Copy path</button></div>`],
      ['Kind', esc(p.kind)],
      ['On disk', `${bytes(s.disk)} <span class="mono" style="color:var(--muted)">· everything, including dependencies and builds</span>`],
      ['Project files', `${bytes(s.bytes)} in ${num(s.files)} files · <b>${num(s.lines)}</b> lines of code <span class="mono" style="color:var(--muted)">· not counting dependencies, builds or vendored code</span>`],
      ['Last change', s.newest ? `${esc(ago(s.newest))} <span class="mono" style="color:var(--muted)">· ${esc(when(s.newest))}${s.newestFile ? ` · ${esc(s.newestFile)}` : ''}</span>` : '—'],
      g ? ['Git', `<span class="mono">${esc(g.branch || '')}</span> · ${num(g.commits)} commits${g.dirty ? ` · ${g.dirty} uncommitted` : ''}${g.last ? `<br><span class="mono" style="color:var(--muted)">${esc(g.last.hash)}</span> ${esc(g.last.subject)} <span style="color:var(--muted)">(${esc(ago(g.last.date))})</span>` : ''}${g.remote ? `<br><a href="${esc(g.remote)}" target="_blank" rel="noopener">${esc(g.remote.replace(/^https?:\/\//, ''))}</a>` : ''}`] : null,
      p.run ? ['Run it', `<span class="mono">${esc(p.run)}</span>`] : null,
      p.media ? ['Captured', `${esc(when(p.media.captured))} · ${p.media.mode === 'images' ? 'slideshow of existing pictures' : 'recorded in headless Chromium'}`] : null
    ].filter(Boolean);

    const members = p.group ? `<div class="block"><h3>Members · ${p.members.length}</h3><table class="members"><thead><tr><th>Project</th><th class="num">Lines</th><th class="num hide-sm">Size</th><th class="num">Changed</th></tr></thead><tbody>${
      p.members.map((m) => `<tr><td>${esc(m.name)}<small>${esc(home(m.path))}</small></td><td class="num">${num(m.lines)}</td><td class="num hide-sm">${bytes(m.bytes)}</td><td class="num">${esc(ago(m.newest))}</td></tr>`).join('')}</tbody></table></div>` : '';
    const related = (p.related || []).length ? `<div class="block"><h3>Related</h3><div class="related">${p.related.map((r) =>
      `<div class="path" title="${esc(r.path)}">${ICON.folder}<span>${esc(r.label)} · ${esc(home(r.path))}${r.disk ? ` · ${bytes(r.disk)}` : ''}</span><button type="button" class="copy" data-copy="${esc(r.path)}" aria-label="Copy path">${ICON.copy}</button></div>`).join('')}</div></div>` : '';
    const note = (p.media && p.media.note) || (p.capture && p.capture.note) || (!p.media && p.status !== 'empty' && !p.group ? 'No screenshots captured yet for this one.' : '');

    $('#dt-inner').className = 'dt-inner themed';
    $('#dt-inner').setAttribute('style', NO.themes.style(p.theme || theme));
    $('#dt-inner').innerHTML = `<button type="button" class="dt-close" data-close aria-label="Close">${ICON.close}</button>
      <div class="dt-body"><div class="dt-grid">
        <div class="dt-stage">
          <div class="viewer" id="viewer"></div>
          ${items.length > 1 ? `<div class="thumbs" id="thumbs">${items.map((it, i) =>
            `<button type="button" class="thumb${it.type === 'video' ? ' vid' : ''}" data-i="${i}" aria-label="${esc(it.caption)}"><img src="${it.type === 'video' ? it.poster || '' : it.src}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
          ${note ? `<p class="media-note">${esc(note)}</p>` : ''}
          <div class="block"><h3>Folder tree</h3>${p.group ? '<p class="media-note">See the members list.</p>' : treeHTML(p)}</div>
          ${s.langs && s.langs.some((l) => l.lines) ? `<div class="block"><h3>Languages</h3>${langTable(s.langs)}</div>` : ''}
        </div>
        <div class="dt-info">
          <div class="dt-kicker"><span class="pill s-${esc(p.status)}"><i></i>${esc(STATUS[p.status] || p.status)}</span><span class="pill">${esc(p.category)}</span></div>
          <h2 class="dt-name" id="dt-name">${esc(p.name)}</h2>
          <p class="dt-tag">${esc(p.tagline)}</p>
          <div class="block"><h3>Goal</h3><p>${esc(p.goal)}</p></div>
          ${p.vision ? `<div class="block"><h3>Vision</h3><p class="vision">${esc(p.vision)}</p></div>` : ''}
          ${(p.features || []).length ? `<div class="block"><h3>What it does</h3><ul class="features">${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
          ${(p.stack || []).length ? `<div class="block"><h3>Stack</h3><div class="chips">${p.stack.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div></div>` : ''}
          <div class="block"><h3>Facts</h3><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl></div>
          ${members}${related}
        </div>
      </div></div>`;

    showItem(items, 0);
    const thumbs = $('#thumbs');
    if (thumbs) thumbs.addEventListener('click', (e) => { const t = e.target.closest('.thumb'); if (t) showItem(items, Number(t.dataset.i)); });
    if (!dlg.open) dlg.showModal();
    $('#dt-inner .dt-body').scrollTop = 0;
    if (push) history.replaceState(null, '', '#' + p.id);
  }

  function closeDetail() {
    const v = dlg.querySelector('video');
    if (v) v.pause();
    if (dlg.open) dlg.close();
  }

  // ---------- STAR MAP ----------
  function renderStarmap() {
    const stars = [];
    for (const p of D.projects) {
      if (p.group) p.members.forEach((m) => stars.push({ path: m.path, p, member: m, lines: m.lines }));
      else stars.push({ path: p.path, p, lines: (p.stats && p.stats.lines) || 0 });
    }
    // Build the folder tree from the root down to every star
    const root = { name: home(D.root), kids: new Map(), stars: [] };
    for (const s of stars) {
      const rel = s.path.startsWith(D.root) ? s.path.slice(D.root.length) : s.path;
      let n = root;
      for (const seg of rel.split('/').filter(Boolean)) {
        if (!n.kids.has(seg)) n.kids.set(seg, { name: seg, kids: new Map(), stars: [] });
        n = n.kids.get(seg);
      }
      n.stars.push(s);
    }
    // Fold chains of single folders (co/mo/ap/AndroidStudioProjects) into one hop
    const fold = (n) => {
      for (const [k, c] of [...n.kids]) {
        let cur = c;
        while (!cur.stars.length && cur.kids.size === 1) {
          const only = [...cur.kids.values()][0];
          cur = { ...only, name: cur.name + '/' + only.name };
        }
        n.kids.set(k, cur);
        fold(cur);
      }
    };
    fold(root);
    const weight = (n) => (n.w = n.stars.length + [...n.kids.values()].reduce((s, c) => s + weight(c), 0) || 1);
    weight(root);
    let maxDepth = 0;
    const place = (n, a0, a1, depth) => {
      n.a = (a0 + a1) / 2; n.depth = depth; maxDepth = Math.max(maxDepth, depth);
      let a = a0;
      const span = a1 - a0;
      const own = n.stars.length;
      a += (span * own) / n.w / 2; // leave a slice for stars sitting on this folder
      let i = 0;
      for (const c of n.kids.values()) {
        const share = (span * c.w) / n.w;
        c.stagger = n.kids.size > 3 && i++ % 2 ? 0.28 : 0; // alternate depth so neighbouring labels don't collide
        place(c, a, a + share, depth + 1);
        a += share;
      }
    };
    place(root, -Math.PI, Math.PI, 0);
    const R = 400 / Math.max(1, maxDepth);
    const xy = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];

    const edges = [], dirs = [], starEls = [];
    const walk = (n, parent) => {
      const r = (n.depth + (n.stars.length ? n.stagger || 0 : 0)) * R;
      const [x, y] = xy(n.a, r);
      if (parent) {
        const pr = (parent.depth + (parent.stars.length ? parent.stagger || 0 : 0)) * R;
        const [px, py] = xy(parent.a, pr);
        const [cx, cy] = xy(n.a, pr);
        edges.push(`<path class="sm-edge" d="M${px.toFixed(1)} ${py.toFixed(1)}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}"/>`);
      }
      if (n !== root) {
        const right = Math.cos(n.a) >= 0;
        const label = n.stars.length ? '' : `<text x="${(x + (right ? 7 : -7)).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(n.name)}</text>`;
        dirs.push(`<g class="sm-dir"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2"/>${label}</g>`);
      }
      n.stars.forEach((s, i) => {
        const off = n.stars.length > 1 ? (i - (n.stars.length - 1) / 2) * 16 : 0;
        const sx = x + Math.cos(n.a + Math.PI / 2) * off, sy = y + Math.sin(n.a + Math.PI / 2) * off;
        const size = s.member ? 2.6 + Math.log10(s.lines + 10) * 0.9 : 4 + Math.log10(s.lines + 10) * 2.1;
        const t = NO.themes.get(s.p.theme || theme);
        const right = Math.cos(n.a) >= 0;
        const name = s.member ? s.member.name.split(' · ')[0] : s.p.name;
        starEls.push(`<g class="sm-star${s.member ? ' sm-member' : ''}" data-id="${esc(s.p.id)}" tabindex="0" role="button" aria-label="${esc(name)}, ${num(s.lines)} lines, at ${esc(home(s.path))}">
          <title>${esc(name)} · ${num(s.lines)} lines · ${esc(home(s.path))}</title>
          <circle class="halo" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${(size * 3.4).toFixed(1)}" fill="url(#g-${t.id})"/>
          <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${size.toFixed(1)}" fill="${s.member ? t.gold : '#fff'}"/>
          ${s.member ? `<text class="sm-lang" x="${(sx + (right ? size + 4 : -size - 4)).toFixed(1)}" y="${(sy + 3).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(name)}</text>` : `<text x="${(sx + (right ? size + 6 : -size - 6)).toFixed(1)}" y="${(sy + 4).toFixed(1)}" text-anchor="${right ? 'start' : 'end'}">${esc(name)}</text>`}
        </g>`);
      });
      for (const c of n.kids.values()) walk(c, n);
    };
    walk(root, null);
    const rings = Array.from({ length: maxDepth }, (_, i) => `<circle class="sm-ring" r="${((i + 1) * R).toFixed(1)}"/>`).join('');
    const grads = NO.themes.list().map((t) => `<radialGradient id="g-${t.id}"><stop offset="0" stop-color="${t.hi}" stop-opacity=".9"/><stop offset=".35" stop-color="${t.accent}" stop-opacity=".35"/><stop offset="1" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>`).join('');
    $('#starmap').innerHTML = `<svg viewBox="-600 -480 1200 960" role="img" aria-label="Star map of the folder tree under ${esc(home(D.root))}">
      <defs>${grads}</defs>${rings}${edges.join('')}${dirs.join('')}
      <g class="sm-root"><circle r="6" fill="var(--soft)"/><text y="-14" text-anchor="middle">${esc(home(D.root))}</text></g>
      ${starEls.join('')}</svg>`;
  }

  // ---------- WIRING ----------
  function bind() {
    $('#themes').addEventListener('click', (e) => { const b = e.target.closest('[data-theme]'); if (b) setTheme(b.dataset.theme); });
    $('#filters').addEventListener('click', (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat; renderFilters(); renderDecks(); });
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderDecks(); });
    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderDecks(); });

    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) { e.stopPropagation(); copy(c.dataset.copy); return; }
      if (e.target.closest('[data-close]')) { closeDetail(); return; }
      const open = e.target.closest('.deck[data-id], .sm-star[data-id]');
      if (open) openDetail(open.dataset.id);
    });
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.deck[data-id], .sm-star[data-id]')) { e.preventDefault(); openDetail(e.target.dataset.id); }
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) closeDetail(); });
    dlg.addEventListener('close', () => {
      const v = dlg.querySelector('video');
      if (v) v.pause();
      history.replaceState(null, '', location.pathname + location.search);
    });
    window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id) openDetail(id, false); });
    bindDeckVideo();
  }

  // ---------- START ----------
  NO.themes.apply(document.documentElement, theme);
  NO.backdrop.init(theme);
  renderThemes();
  bindSound();
  if (!D || !Array.isArray(D.projects)) {
    $('#decks').innerHTML = '<div class="empty-data"><p>No scan data yet.</p><p>Run <code>npm run scan</code> in this folder (or <code>npm run build</code> for screenshots and video too), then reload.</p></div>';
    return;
  }
  renderHeader();
  renderFilters();
  renderDecks();
  renderStarmap();
  bind();
  $('#foot').innerHTML = `Nova Observatory · part of the Nova suite · Novacane Studios<br>Scanned ${esc(when(D.generatedAt))} · refresh with <code>npm run build</code> (or <code>npm run scan</code> for numbers only)`;
  if (location.hash.length > 1) openDetail(location.hash.slice(1), false);
})();
