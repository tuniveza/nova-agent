/* Notes — shared.js
   Shared notes: the whole team's notes, kept by Nova Bot (/notes-api/) and synced here, next to
   this browser's own Local notes (js/store.js). Signed in with Portal (the planet), everyone on
   the team sees and edits the same shared notes, on every device; signed out, Local works as
   always and Shared asks for a sign-in.

   How it keeps up: a copy of the shared notes lives here (readable offline). Changes made here
   wait in a queue and go up a moment later (or when the connection is back); the team's changes
   come down every 15 seconds while Notes is on screen, and when it comes back into view. If two
   people change the same note at once, nobody's words are lost: Nova Bot keeps the first and
   saves the second as "… (conflicted copy)".

   Also here, around the notes list: All · Shared · Local, a badge on each note, and the button
   by "Saved" that moves the open note between Shared and Local. */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});
  const API = '/notes-api';
  const LS_CURSOR = 'nova-notes/shared-cursor';
  const LS_QUEUE = 'nova-notes/shared-queue';
  const LS_SCOPE = 'nova-notes/scope';
  const POLL_MS = 15000;
  const PUSH_MS = 2500;

  const ls = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {}
    }
  };

  // ---------- THE COPY KEPT HERE (IndexedDB) ----------

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open('nova-notes-shared', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('notes', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (err) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }
  async function idb(mode, fn) {
    const d = await db();
    if (!d) return undefined;
    return new Promise((resolve) => {
      const tx = d.transaction('notes', mode);
      const req = fn(tx.objectStore('notes'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    });
  }

  const cache = new Map(); // id → note (shared: true, with rev and by)
  const deletedRevs = new Map(); // id → rev of its "deleted" mark (so Undo can bring it back)
  let queue = new Map(Object.entries(ls.get(LS_QUEUE, {}))); // id → { type: 'put' | 'delete', base }
  let cursor = ls.get(LS_CURSOR, 0);
  let signedIn = null; // null: not asked yet (or offline); true / false once Nova Bot answered
  let me = null;

  const clean = (n) => Object.assign(NN.store.notes.clean(n), { shared: true });
  const keep = (n) => {
    cache.set(n.id, n);
    idb('readwrite', (s) => s.put(n));
  };
  const drop = (id) => {
    cache.delete(id);
    idb('readwrite', (s) => s.delete(id));
  };
  const saveQueue = () => ls.set(LS_QUEUE, Object.fromEntries(queue));

  const ready = (async () => {
    const list = (await idb('readonly', (s) => s.getAll())) || [];
    for (const n of list) cache.set(n.id, clean(n));
  })();

  // ---------- WHAT js/store.js USES ----------

  const scope = () => ls.get(LS_SCOPE, 'all');
  const shared = {
    ready,
    get signedIn() {
      return signedIn;
    },
    get me() {
      return me;
    },
    async list() {
      await ready;
      return signedIn === false ? [] : [...cache.values()].map((n) => ({ ...n }));
    },
    has: (id) => cache.has(id),
    get: (id) => (cache.has(id) ? { ...cache.get(id) } : null),
    // Offline counts as "can": the change waits here until Nova Bot can take it
    canShare: () => signedIn !== false,
    // A new note is Shared when signed in, unless you're looking at Local
    preferShared: () => signedIn !== false && scope() !== 'local',
    async put(n) {
      const before = cache.get(n.id);
      const note = clean(n);
      if (before && Number.isInteger(before.rev)) note.rev = before.rev;
      else if (deletedRevs.has(n.id)) note.rev = deletedRevs.get(n.id);
      keep(note);
      queue.set(n.id, { type: 'put' });
      saveQueue();
      schedulePush();
      return true;
    },
    // Deleted (or moved to Local): gone from the team's notes once Nova Bot hears
    async remove(id, { moved = false } = {}) {
      const n = cache.get(id);
      if (!n) return;
      drop(id);
      if (Number.isInteger(n.rev)) {
        queue.set(id, { type: 'delete', base: n.rev, moved });
        saveQueue();
        schedulePush();
      } else {
        // It never reached Nova Bot: nothing to delete there
        queue.delete(id);
        saveQueue();
      }
    },
    sync,
    pending: () => queue.size
  };
  NN.shared = shared;

  // ---------- TALKING TO NOVA BOT ----------

  async function api(path, init = {}) {
    const res = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  function signedOut() {
    if (signedIn === false) return;
    signedIn = false;
    refreshApp({ all: true });
  }

  let pushTimer = 0;
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync({ pull: false }), PUSH_MS);
    paintState();
  }

  let busy = null;
  function sync({ pull = true } = {}) {
    if (busy) return busy.then(() => (queue.size ? sync({ pull }) : undefined));
    busy = (async () => {
      try {
        await ready;
        if (navigator.onLine === false) return;
        await push();
        if (pull && signedIn !== false) await pullAll();
      } catch (err) {
        // Offline or Nova Bot busy: try again on the next round
      } finally {
        busy = null;
        paintState();
      }
    })();
    return busy;
  }

  async function push() {
    for (const [id, op] of [...queue]) {
      if (op.type === 'put') {
        const n = cache.get(id);
        if (!n) {
          queue.delete(id);
          continue;
        }
        const body = { title: n.title, html: n.html, created: n.created, updated: n.updated, pinned: n.pinned, named: n.named, gdocId: n.gdocId, gdocUrl: n.gdocUrl, gdocKeep: n.gdocKeep === true, base: Number.isInteger(n.rev) ? n.rev : null };
        const sent = JSON.stringify(n.html) + n.title + n.pinned + n.named;
        const r = await api(`/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
        if (r.status === 401) return signedOut();
        if (r.status === 413) {
          // Too big to share: it stays, as a Local note on this device
          const local = { ...n, shared: false };
          drop(id);
          queue.delete(id);
          saveQueue();
          await NN.store.notes.put(local);
          refreshApp({ changed: [local] });
          tell(r.data.error || 'That note is too big to share. It stays on this device.');
          continue;
        }
        if (r.status !== 200) throw new Error(String(r.status));
        signedIn = true;
        const now = cache.get(id);
        // Typed more while it was on its way? Keep the newer words; the next round sends them
        const changedMeanwhile = now && JSON.stringify(now.html) + now.title + now.pinned + now.named !== sent;
        if (r.data.conflict) {
          // Typed more since it went up? Those newest words become a copy of their own too
          let extra = null;
          if (changedMeanwhile) {
            extra = clean({ ...now, id: NN.store.notes.newId(), title: `${now.title} (conflicted copy)`, rev: undefined, created: new Date().toISOString() });
            delete extra.rev;
            keep(extra);
            queue.set(extra.id, { type: 'put' });
            schedulePush();
          }
          keep(clean(r.data.note));
          if (r.data.copy) keep(clean(r.data.copy));
          queue.delete(id);
          if (extra) refreshApp({ changed: [extra] });
          refreshApp({ changed: [r.data.note, r.data.copy].filter(Boolean), reload: id });
          tell(`Someone changed “${r.data.note.title}” at the same time. Your version is kept as “${r.data.copy ? r.data.copy.title : 'a copy'}”.`);
        } else if (now) {
          now.rev = r.data.note.rev;
          now.by = r.data.note.by;
          keep(now);
          if (!changedMeanwhile) queue.delete(id);
          refreshApp({ changed: [now], quiet: true });
        }
      } else if (op.type === 'delete') {
        const r = await api(`/notes/${encodeURIComponent(id)}?base=${op.base}`, { method: 'DELETE' });
        if (r.status === 401) return signedOut();
        if (r.status === 409 && r.data.note) {
          // Someone changed it meanwhile: it comes back (nothing lost)
          queue.delete(id);
          const back = clean(r.data.note);
          if (!op.moved) {
            keep(back);
            refreshApp({ changed: [back] });
            tell(`Someone changed “${back.title}” meanwhile, so it wasn't deleted.`);
          } else {
            // Moved to Local here, but changed by someone since: the team keeps theirs too
            keep(back);
            refreshApp({ changed: [back] });
            tell(`“${back.title}” was changed by someone meanwhile, so the team keeps their version too.`);
          }
        } else if (r.status === 200) {
          signedIn = true;
          queue.delete(id);
          if (r.data.note) deletedRevs.set(id, r.data.note.rev);
        } else throw new Error(String(r.status));
      }
      saveQueue();
    }
  }

  async function pullAll() {
    let more = true;
    let rounds = 0;
    const changed = [];
    const gone = [];
    while (more && rounds++ < 50) {
      const r = await api(`/changes?since=${cursor}`);
      if (r.status === 401) return signedOut();
      if (r.status !== 200) throw new Error(String(r.status));
      const wasOut = signedIn !== true;
      signedIn = true;
      me = r.data.me || me;
      if (wasOut && cache.size) refreshApp({ all: true });
      for (const raw of r.data.notes || []) {
        const waiting = queue.get(raw.id);
        if (raw.deleted) {
          deletedRevs.set(raw.id, raw.rev);
          if (waiting && waiting.type === 'put') continue; // changed here since: it goes up and lands as a copy
          if (cache.has(raw.id)) {
            drop(raw.id);
            gone.push(raw);
          }
          continue;
        }
        if (waiting) continue; // changed here too: sending ours checks for a clash first
        if (deletedRevs.get(raw.id) > raw.rev) continue;
        const n = clean(raw);
        const had = cache.get(raw.id);
        if (had && had.rev === n.rev) continue;
        keep(n);
        changed.push(n);
      }
      cursor = r.data.cursor || cursor;
      ls.set(LS_CURSOR, cursor);
      more = r.data.more === true;
    }
    if (changed.length || gone.length) refreshApp({ changed, gone });
  }

  // ---------- KEEPING THE OPEN NOTES LIST UP TO DATE ----------

  const $ = (id) => document.getElementById(id);
  const appNotes = () => (NN.app && NN.app.notes ? NN.app.notes() : null);
  const currentId = () => {
    const li = document.querySelector('#lib-list .lib-item[aria-selected="true"]');
    return li ? li.dataset.id : '';
  };
  const typing = () => {
    const s = $('save-state');
    return Boolean(s && s.classList.contains('saving'));
  };
  const rerender = () => {
    const search = $('lib-search');
    if (search) search.dispatchEvent(new Event('input'));
  };

  async function refreshApp({ changed = [], gone = [], all = false, reload = '', quiet = false } = {}) {
    const list = appNotes();
    if (!list) return;
    const open = currentId();
    if (all) {
      // Signed in or out: shared notes come and go from the list together (the notes already in
      // the list stay the same objects, so the one being edited is never swapped out)
      const want = signedIn === false ? new Map() : cache;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].shared === true && !want.has(list[i].id)) list.splice(i, 1);
      for (const n of want.values()) if (!list.some((x) => x.id === n.id)) list.push({ ...n });
      if (open && !list.some((n) => n.id === open) && list.length) NN.app.openNote([...list].sort((a, b) => b.updated.localeCompare(a.updated))[0].id);
      rerender();
      decorate();
      return;
    }
    for (const raw of gone) {
      const i = list.findIndex((n) => n.id === raw.id);
      if (i >= 0) list.splice(i, 1);
      if (raw.id === open) {
        const next = [...list].sort((a, b) => b.updated.localeCompare(a.updated))[0];
        if (next) NN.app.openNote(next.id);
        tell(`“${raw.title || 'A shared note'}” was deleted${raw.by ? ' by ' + raw.by : ''}.`);
      }
    }
    for (const raw of changed) {
      const fresh = raw.shared === false ? { ...raw } : clean(raw);
      const i = list.findIndex((n) => n.id === raw.id);
      if (i < 0) {
        list.push(fresh);
        continue;
      }
      const n = list[i];
      const words = n.html !== fresh.html || n.title !== fresh.title;
      if (quiet) {
        // Only Nova Bot's bookkeeping (rev, who) on the note being edited here
        n.rev = fresh.rev;
        n.by = fresh.by;
        continue;
      }
      if (raw.id === open && words && typing() && raw.id !== reload) continue; // never under someone's fingers; theirs lands as a copy
      Object.assign(n, fresh);
      if (raw.id === open && (words || raw.id === reload)) NN.app.openNote(raw.id);
    }
    if (NN.app.tidy) NN.app.tidy(); // untouched copies of the old Welcome note (js/app.js)
    rerender();
    decorate();
  }

  // A short message in Notes' own toast
  function tell(msg) {
    const t = $('toast');
    if (!t) return;
    $('toast-text').textContent = msg;
    $('toast-action').hidden = true;
    t.classList.add('show');
    clearTimeout(tell.timer);
    tell.timer = setTimeout(() => t.classList.remove('show'), 5200);
  }
  function tellUndo(msg, label, fn) {
    const t = $('toast');
    if (!t) return;
    $('toast-text').textContent = msg;
    const a = $('toast-action');
    a.hidden = false;
    a.textContent = label;
    a.onclick = () => {
      t.classList.remove('show');
      fn();
    };
    t.classList.add('show');
    clearTimeout(tell.timer);
    tell.timer = setTimeout(() => t.classList.remove('show'), 6500);
  }

  // ---------- AROUND THE LIST: ALL · SHARED · LOCAL, BADGES, THE SWITCH ----------

  const ICON_SHARED = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M2.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6M13.5 15.2c.9-.8 2.1-1.2 3.5-1.2 2.3 0 4.1 1.3 4.6 3.8"/></svg>';
  const ICON_LOCAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M9 20h6M12 16v4"/></svg>';

  function buildChrome() {
    const search = document.querySelector('.lib-search');
    if (search && !$('lib-scope')) {
      const bar = document.createElement('div');
      bar.className = 'lib-scope';
      bar.id = 'lib-scope';
      bar.setAttribute('role', 'tablist');
      bar.setAttribute('aria-label', 'Which notes');
      bar.innerHTML = ['all', 'shared', 'local']
        .map((k) => `<button type="button" role="tab" data-scope="${k}">${k === 'all' ? 'All' : k === 'shared' ? ICON_SHARED + 'Shared' : ICON_LOCAL + 'Local'}</button>`)
        .join('');
      search.after(bar);
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-scope]');
        if (!b) return;
        ls.set(LS_SCOPE, b.dataset.scope);
        paintScope();
        if (b.dataset.scope === 'shared') sync();
      });
    }
    const state = $('save-state');
    if (state && !$('note-kind')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'note-kind';
      btn.className = 'note-kind';
      state.after(btn);
      btn.addEventListener('click', toggleKind);
    }
    paintScope();
  }

  function paintScope() {
    const k = scope();
    for (const b of document.querySelectorAll('#lib-scope [data-scope]')) b.setAttribute('aria-selected', String(b.dataset.scope === k));
    const list = $('lib-list');
    if (list) list.dataset.scope = k;
    decorate();
  }

  // Badges on each note, the notice for Shared, the count at the foot
  let decorating = false;
  function decorate() {
    const list = $('lib-list');
    const notes = appNotes();
    if (!list || !notes || decorating) return;
    decorating = true;
    try {
      const byId = new Map(notes.map((n) => [n.id, n]));
      for (const li of list.querySelectorAll('.lib-item')) {
        const n = byId.get(li.dataset.id);
        const isShared = Boolean(n && n.shared === true);
        li.classList.toggle('is-shared', isShared);
        li.classList.toggle('is-local', !isShared);
        let badge = li.querySelector('.lib-kind');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'lib-kind';
          li.querySelector('.lib-time')?.after(badge);
        }
        const who = isShared && n.by && (!me || n.by !== me.name) ? ` · ${n.by}` : '';
        const waiting = isShared && queue.has(n.id) ? ' · syncing' : '';
        badge.textContent = (isShared ? 'Shared' : 'Local') + who + waiting;
      }
      // Shared: a word when there's nothing to show
      const k = scope();
      let note = list.querySelector('.lib-scope-note');
      const sharedCount = notes.filter((n) => n.shared === true).length;
      const localCount = notes.length - sharedCount;
      let text = '';
      if (k === 'shared' && signedIn === false) text = 'Sign in to see shared notes';
      else if (k === 'shared' && !sharedCount) text = 'No shared notes yet. Open a note and tap “Local” to share it with the team.';
      else if (k === 'local' && !localCount) text = 'No local notes. They stay only on this device.';
      if (text) {
        if (!note) {
          note = document.createElement('li');
          note.className = 'lib-scope-note';
          list.prepend(note);
        }
        note.innerHTML = '';
        note.append(document.createTextNode(text));
        if (k === 'shared' && signedIn === false) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = 'Sign in';
          b.addEventListener('click', openSignIn);
          note.append(b);
        }
      } else if (note) note.remove();
      for (const empty of list.querySelectorAll('.lib-empty')) empty.hidden = Boolean(text);
      const foot = $('lib-foot');
      if (foot) foot.textContent = `${sharedCount} shared · ${localCount} local` + (shared.pending() ? ' · syncing…' : '');
      paintKind();
    } finally {
      decorating = false;
    }
  }

  // The button by "Saved": this note is Shared or Local; one tap moves it
  function paintKind() {
    const btn = $('note-kind');
    if (!btn) return;
    const notes = appNotes() || [];
    const n = notes.find((x) => x.id === currentId());
    const isShared = Boolean(n && n.shared === true);
    btn.classList.toggle('is-shared', isShared);
    btn.innerHTML = (isShared ? ICON_SHARED : ICON_LOCAL) + `<span>${isShared ? 'Shared' : 'Local'}</span>`;
    const out = signedIn === false && !isShared;
    btn.disabled = !n;
    btn.title = isShared ? 'Shared with the team. Tap to keep it only on this device.' : out ? 'Only on this device. Sign in to share it with the team.' : 'Only on this device. Tap to share it with the team.';
    btn.setAttribute('aria-label', btn.title);
  }
  function paintState() {
    decorate();
  }

  async function toggleKind() {
    const notes = appNotes() || [];
    const n = notes.find((x) => x.id === currentId());
    if (!n) return;
    if (n.shared !== true && signedIn === false) return openSignIn();
    const toShared = n.shared !== true;
    // Save what's typed first, then move it
    await NN.app.openNote(n.id);
    n.shared = toShared;
    if (!toShared) delete n.rev;
    await NN.store.notes.put(n);
    if (NN.app.tidy) NN.app.tidy(); // untouched copies of the old Welcome note (js/app.js)
    rerender();
    decorate();
    tellUndo(toShared ? `“${n.title}” is shared with the team.` : `“${n.title}” is now only on this device (taken out of the team's notes).`, 'Undo', async () => {
      n.shared = !toShared;
      if (n.shared !== true) delete n.rev;
      await NN.store.notes.put(n);
      rerender();
      decorate();
    });
    if (toShared) sync({ pull: false });
  }

  // Sign in: the planet (Portal), in Nova Agent around this panel
  function openSignIn() {
    for (const w of [window.top, window]) {
      try {
        if (w.NovaAgent && w.NovaAgent.open) return w.NovaAgent.open('/portal/');
      } catch (err) {}
    }
    location.href = '/agent/?open=%2Fportal%2F';
  }

  // ---------- WHEN TO SYNC ----------

  let poll = 0;
  function startPolling() {
    clearInterval(poll);
    poll = setInterval(() => document.visibilityState === 'visible' && sync(), POLL_MS);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
    else if (queue.size) sync({ pull: false });
  });
  window.addEventListener('focus', () => sync());
  window.addEventListener('online', () => sync());
  // Signed in or out on the planet: shared notes follow
  window.addEventListener('novaportal', (e) => {
    const inNow = Boolean(e.detail && e.detail.signedIn);
    if (inNow && signedIn !== true) {
      signedIn = null;
      sync();
    } else if (!inNow && e.detail && !e.detail.offline) signedOut();
  });

  function boot() {
    const list = $('lib-list');
    if (!list || !NN.app) return setTimeout(boot, 120);
    buildChrome();
    // Each time Notes redraws its list, the badges go back on
    new MutationObserver(() => decorate()).observe(list, { childList: true });
    sync();
    startPolling();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
