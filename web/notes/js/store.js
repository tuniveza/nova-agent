/* Nova Notes — store.js
   Where the notes live: this browser's IndexedDB (room for long notes with pictures), or
   localStorage if IndexedDB isn't available (e.g. some private windows). Settings are small, so they
   always go in localStorage.
   A note: { id, title, html, created, updated, pinned, named, gdocId, gdocUrl } */
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
      gdocUrl: typeof n.gdocUrl === 'string' && n.gdocUrl.startsWith('https://') ? n.gdocUrl : ''
    };
  }

  const notes = {
    async all() {
      const d = await db();
      const list = d ? await run('readonly', (s) => s.getAll()) : Object.values(lsRead());
      return (list || []).map(clean);
    },
    async get(noteId) {
      const d = await db();
      const n = d ? await run('readonly', (s) => s.get(noteId)) : lsRead()[noteId];
      return n ? clean(n) : null;
    },
    // Save a note; returns false if the browser refused (e.g. out of space)
    async put(n) {
      const note = clean(n);
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
        console.warn('Nova Notes: could not save', err);
        return false;
      }
    },
    async remove(noteId) {
      const d = await db();
      if (d) return run('readwrite', (s) => s.delete(noteId));
      const all = lsRead();
      delete all[noteId];
      lsWrite(all);
    },
    newId: id,
    clean
  };

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
    if (!list) throw new Error("That file isn't a Nova Notes backup.");
    let count = 0;
    for (const n of list) {
      if (n && typeof n === 'object' && typeof n.html === 'string') {
        await notes.put(n);
        count++;
      }
    }
    return count;
  }

  NN.store = { notes, settings, backup, restore };
})();
