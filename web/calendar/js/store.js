/* Nova Calendar — store.js
   Saves everything in this browser (localStorage) and handles JSON backup / restore.
   Shapes:
     note: { id, title, body, author, start, end, art: { seed, subject }, created, updated }
           start/end are local "YYYY-MM-DDTHH:MM" strings, straight from the datetime inputs.
     day:  { id, date, preset, title, aesthetic, theme, info, location, tags[], repeat, artSalt, created, updated }
           theme 'app' means "use the app theme". repeat 'yearly' makes it show every year from date on. */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});
  const KEY = 'nova-calendar/v1';
  // Before it was renamed, Nova Calendar was called Nova Task and saved here; it's read if there's nothing new yet
  const OLD_KEY = 'nova-task/v1';

  const uid = () =>
    (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isStamp = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  const nowISO = () => new Date().toISOString();

  // Check and tidy anything that comes from storage or an imported file
  function cleanNote(n) {
    if (!n || typeof n !== 'object' || !isStamp(n.start)) return null;
    const start = n.start.slice(0, 16);
    const end = isStamp(n.end) && n.end.slice(0, 16) >= start ? n.end.slice(0, 16) : start;
    return {
      id: str(n.id, 64) || uid(),
      title: str(n.title, 120), body: str(n.body, 5000), author: str(n.author, 60),
      start, end,
      art: { seed: Number(n.art && n.art.seed) >>> 0, subject: str(n.art && n.art.subject, 30) || 'auto' },
      created: str(n.created, 40) || nowISO(), updated: str(n.updated, 40) || str(n.created, 40) || nowISO()
    };
  }

  function cleanDay(d) {
    if (!d || typeof d !== 'object' || !isDate(d.date)) return null;
    return {
      id: str(d.id, 64) || uid(), date: d.date,
      preset: str(d.preset, 40) || 'custom', title: str(d.title, 80),
      aesthetic: str(d.aesthetic, 30) || 'nebula', theme: str(d.theme, 30) || 'app',
      info: str(d.info, 4000), location: str(d.location, 120),
      tags: Array.isArray(d.tags) ? d.tags.map((t) => str(t, 30)).filter(Boolean).slice(0, 12) : [],
      repeat: d.repeat === 'yearly' ? 'yearly' : 'none', artSalt: str(d.artSalt, 40),
      created: str(d.created, 40) || nowISO(), updated: str(d.updated, 40) || nowISO()
    };
  }

  function normalise(s) {
    return {
      notes: (Array.isArray(s && s.notes) ? s.notes : []).map(cleanNote).filter(Boolean),
      days: (Array.isArray(s && s.days) ? s.days : []).map(cleanDay).filter(Boolean),
      prefs: {
        theme: str(s && s.prefs && s.prefs.theme, 30) || 'novacane',
        author: str(s && s.prefs && s.prefs.author, 60)
      }
    };
  }

  // One object for the whole session; imports merge into it rather than replacing it
  const data = { version: 1, notes: [], days: [], prefs: { theme: 'novacane', author: '' } };

  function load() {
    try {
      const raw = localStorage.getItem(KEY) || localStorage.getItem(OLD_KEY);
      if (raw) Object.assign(data, normalise(JSON.parse(raw)));
    } catch (e) {
      console.warn('[Nova Calendar] could not read saved data', e);
    }
    return data;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[Nova Calendar] could not save', e);
      return false;
    }
  }

  const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  // Notes that touch a date (a note running over several days shows on each of them)
  const notesOn = (key) => data.notes.filter((n) => n.start.slice(0, 10) <= key && n.end.slice(0, 10) >= key).sort(byStart);

  // The day card for a date: an exact one wins, else a yearly one from an earlier year
  const dayOn = (key) =>
    data.days.find((d) => d.date === key) ||
    data.days.find((d) => d.repeat === 'yearly' && d.date < key && d.date.slice(5) === key.slice(5)) ||
    null;

  function upsert(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
  }

  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || (!Array.isArray(parsed.notes) && !Array.isArray(parsed.days))) {
      throw new Error('That file is not a Nova Calendar backup.');
    }
    const inc = normalise(parsed);
    inc.notes.forEach((n) => upsert(data.notes, n));
    inc.days.forEach((d) => upsert(data.days, d));
    return { notes: inc.notes.length, days: inc.days.length };
  }

  NT.store = {
    load, save, uid, notesOn, dayOn, importJSON,
    upsertNote: (n) => upsert(data.notes, cleanNote(n)),
    upsertDay: (d) => upsert(data.days, cleanDay(d)),
    removeNote: (id) => { data.notes = data.notes.filter((n) => n.id !== id); },
    removeDay: (id) => { data.days = data.days.filter((d) => d.id !== id); },
    getNote: (id) => data.notes.find((n) => n.id === id) || null,
    getDay: (id) => data.days.find((d) => d.id === id) || null,
    snapshot: () => ({ app: 'Nova Calendar', exported: nowISO(), ...data })
  };
})();
