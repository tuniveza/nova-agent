/* Notes — store.js
   Where the notes live: this browser's IndexedDB (room for long notes with pictures), or
   localStorage if IndexedDB isn't available (e.g. some private windows). Settings are small, so they
   always go in localStorage.
   A note: { id, title, html, created, updated, pinned, named, gdocId, gdocUrl, gdocKeep, shared }
   Two kinds of note: Local (only here, in this browser) and Shared (the whole team's, kept by
   Nova Bot and synced by js/shared.js, which keeps its own copy here for speed and offline).
   Everything below works on both: a note with shared: true goes to the team, any other stays here. */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});

  const DB_NAME = 'nova-notes';
  const STORE = 'notes';
  const LS_NOTES = 'nova-notes/notes-v1';
  const LS_SETTINGS = 'nova-notes/settings-v1';

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
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

  // One IndexedDB request, as a promise
  async function run(mode, fn) {
    const d = await db();
    if (!d) return undefined;
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // localStorage fallback
  const lsRead = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_NOTES)) || {};
    } catch (err) {
      return {};
    }
  };
  const lsWrite = (all) => {
    try {
      localStorage.setItem(LS_NOTES, JSON.stringify(all));
      return true;
    } catch (err) {
      return false;
    }
  };

  const id = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // Keep only the fields a note is allowed to have
  function clean(n) {
    const now = new Date().toISOString();
    return {
      id: typeof n.id === 'string' && n.id ? n.id.slice(0, 64) : id(),
      title: typeof n.title === 'string' ? n.title.slice(0, 200) : 'Untitled note',
      html: typeof n.html === 'string' ? n.html : '',
      created: typeof n.created === 'string' ? n.created : now,
      updated: typeof n.updated === 'string' ? n.updated : now,
      pinned: n.pinned === true,
      // true once someone has typed a name; until then the name follows the note's first line
      named: n.named === true,
      gdocId: typeof n.gdocId === 'string' ? n.gdocId : '',
      gdocUrl: typeof n.gdocUrl === 'string' && n.gdocUrl.startsWith('https://') ? n.gdocUrl : '',
      gdocKeep: n.gdocKeep === true,
      // Shared or Local (not decided yet for a brand-new note: js/shared.js picks)
      shared: n.shared === true ? true : n.shared === false ? false : undefined,
      // Shared notes only: the version the team last had, and who changed it last
      rev: Number.isInteger(n.rev) ? n.rev : undefined,
      by: typeof n.by === 'string' ? n.by.slice(0, 80) : ''
    };
  }
  const local = (n) => Object.assign(clean(n), { shared: false });
  const sh = () => NN.shared;

  const notes = {
    async all() {
      const d = await db();
      const list = d ? await run('readonly', (s) => s.getAll()) : Object.values(lsRead());
      const shared = sh() ? await sh().list() : [];
      const ids = new Set(shared.map((n) => n.id));
      return [...(list || []).filter((n) => !ids.has(n.id)).map(local), ...shared];
    },
    async get(noteId) {
      if (sh() && sh().has(noteId)) return sh().get(noteId);
      const d = await db();
      const n = d ? await run('readonly', (s) => s.get(noteId)) : lsRead()[noteId];
      return n ? local(n) : null;
    },
    // Save a note; returns false if the browser refused (e.g. out of space)
    async put(n) {
      const S = sh();
      // A brand-new note: Shared or Local, as js/shared.js says (Shared when signed in)
      if (n.shared === undefined) n.shared = Boolean(S && !S.has(n.id) && !(await localHas(n.id)) && S.preferShared());
      if (n.shared === true && S && S.canShare()) {
        const ok = await S.put(clean(n));
        if (ok && (await localHas(n.id))) await localRemove(n.id); // moved here from Local
        return ok;
      }
      n.shared = false;
      const ok = await localPut(n);
      if (ok && S && S.has(n.id)) await S.remove(n.id, { moved: true }); // moved to Local
      return ok;
    },
    async remove(noteId) {
      if (sh() && sh().has(noteId)) return sh().remove(noteId);
      return localRemove(noteId);
    },
    newId: id,
    clean
  };

  // This browser's own notes (Local)
  async function localHas(noteId) {
    const d = await db();
    return Boolean(d ? await run('readonly', (s) => s.count(noteId)) : lsRead()[noteId]);
  }
  async function localRemove(noteId) {
    const d = await db();
    if (d) return run('readwrite', (s) => s.delete(noteId));
    const all = lsRead();
    delete all[noteId];
    lsWrite(all);
  }
  async function localPut(n) {
    const note = local(n);
    delete note.rev;
    try {
      const d = await db();
      if (d) {
        await run('readwrite', (s) => s.put(note));
        return true;
      }
      const all = lsRead();
      all[note.id] = note;
      return lsWrite(all);
    } catch (err) {
      console.warn('Notes: could not save', err);
      return false;
    }
  }

  const settings = {
    read() {
      try {
        return JSON.parse(localStorage.getItem(LS_SETTINGS)) || {};
      } catch (err) {
        return {};
      }
    },
    write(values) {
      try {
        localStorage.setItem(LS_SETTINGS, JSON.stringify({ ...settings.read(), ...values }));
      } catch (err) {
        // Not saved; the app still works for this visit
      }
    }
  };

  // A backup of every note, and reading one back in
  async function backup() {
    return { app: 'nova-notes', version: 1, exported: new Date().toISOString(), notes: await notes.all() };
  }
  async function restore(data) {
    const list = Array.isArray(data) ? data : Array.isArray(data && data.notes) ? data.notes : null;
    if (!list) throw new Error("That file isn't a Notes backup.");
    let count = 0;
    for (const n of list) {
      if (n && typeof n === 'object' && typeof n.html === 'string') {
        // Old backups have no "shared": those notes come back Local
        await notes.put({ ...n, shared: n.shared === true });
        count++;
      }
    }
    return count;
  }

  NN.store = { notes, settings, backup, restore };
})();
