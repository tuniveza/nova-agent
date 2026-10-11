// Quests' plain rules, kept apart from the page so they can be tested (test/plans.spec.ts):
//   sources(q, missionTitle): where a quest came from, as tags (its mission, "Notes · Studio
//     plan", or Agent when Nova Agent made it itself)
//   comingUp(notes, now, occurrences, days): Calendar's note cards with reminders in the next
//     few days, for Quests' "Also coming up" (times are UK time, as Calendar keeps them)
//   remindWords(minutes), calendarDay(date): the words and the Calendar address for one of them
// Loaded before the page's own script: window.NovaPlans
(function (root) {
  'use strict';
  // Nova Agent's own copies in Calendar (its plan, blocked time, milestones, music): not repeated here
  const OWN = /^(quest|block|mile|music)-/;
  const pad = (n) => String(n).padStart(2, '0');

  // A UK time ("2026-10-11T14:00") moved on by some minutes (worked out on the dates, so it's the same whatever the clocks do)
  function later(stamp, minutes) {
    const [d, t = '00:00'] = String(stamp).split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi] = t.split(':').map(Number);
    const x = new Date(Date.UTC(y, mo - 1, da, h, mi) + minutes * 60000);
    return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
  }

  // Where a quest came from: its mission and where it was made ("Notes · Studio plan" is saved;
  // it shows as "Nova Notes · Studio plan"), or Nova Agent itself
  function sources(q, missionTitle) {
    const out = [];
    if (missionTitle) out.push({ kind: 'mission', label: String(missionTitle) });
    if (q && q.from) out.push({ kind: /^Notes\b/.test(q.from) ? 'notes' : 'from', label: String(q.from).replace(/^Notes\b/, 'Nova Notes') });
    if (!out.length) out.push({ kind: 'agent', label: 'Nova Agent' });
    return out;
  }

  // Calendar's note cards with reminders, happening from now until `days` days on (a repeating
  // one: each time it happens, using Calendar's own rules when they're given), soonest first
  function comingUp(notes, now, occurrences, days = 7) {
    if (!Array.isArray(notes) || typeof now !== 'string') return [];
    const from = now.slice(0, 16);
    const until = later(from, days * 1440);
    const out = [];
    for (const n of notes) {
      if (!n || typeof n.start !== 'string' || OWN.test(String(n.id || ''))) continue;
      const reminders = Array.isArray(n.reminders) ? n.reminders.map(Number).filter((m) => Number.isFinite(m) && m >= 0) : [];
      if (!reminders.length) continue;
      const times = typeof occurrences === 'function' ? occurrences(n, from.slice(0, 10), until.slice(0, 10)) : n.repeat ? [] : [{ start: n.start, end: n.end || n.start, date: n.start.slice(0, 10) }];
      for (const o of times) {
        // An all-day one counts for its whole day; any other from its start
        const starts = n.allDay ? `${o.date}T23:59` : o.start.slice(0, 16);
        if (starts < from || o.start.slice(0, 16) >= until) continue;
        out.push({ id: n.id, title: n.title || 'Note card', start: o.start, end: o.end, date: o.date, allDay: Boolean(n.allDay), location: n.location || '', reminders: [...new Set(reminders)].sort((a, b) => a - b) });
      }
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }

  // "15 min before", "1 hour before", "1 day before", "At the start"
  function remindWords(minutes) {
    const m = Number(minutes) || 0;
    if (m <= 0) return 'At the start';
    if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`;
    if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`;
    return `${m} min before`;
  }

  // Calendar, open on that day
  const calendarDay = (date) => `/calendar/?day=${encodeURIComponent(String(date || '').slice(0, 10))}`;

  root.NovaPlans = { sources, comingUp, remindWords, calendarDay, later };
})(globalThis);
