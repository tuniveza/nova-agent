// The phone preview's Calendar: made-up note cards, day cards, bookings and phones (no real people), answering
// the Calendar's own addresses (GET/PUT/DELETE /app/api/calendar/items, GET /app/api/calendar, GET /app/api/push/phones).
// Saves are kept in memory, with a rev that goes up, as Nova Bot's do.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const feed = (offset, hh, mm) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(hh, mm, 0, 0); return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); };
  const T = day(0);
  const monday = day(-((new Date().getDay() + 6) % 7));
  const was = new Date(Date.now() - 86400000).toISOString();
  let rev = 10;
  const items = [
    { id: "c1", kind: "event", title: "Vocal session \u00b7 Maya Rose", start: `${T}T11:00`, end: `${T}T13:00`, location: "Studio A", color: "rose", author: "Jordan", body: "Two lead takes, then harmonies.\nBring the ribbon mic.", art: { seed: 1234567, subject: "nebula" }, reminders: [30], phones: [], updated: was },
    { id: "c2", kind: "event", title: "Mix review \u00b7 Night Drive", start: `${T}T16:30`, end: `${T}T17:30`, location: "Studio B", color: "teal", reminders: [10, 60], phones: ["p2"], meet: true, meetUrl: "https://meet.google.com/abc-defg-hij", art: { seed: 99887766, subject: "planet" }, updated: was },
    { id: "c3", kind: "event", title: "Weekly planning", start: `${monday}T09:30`, end: `${monday}T10:00`, color: "violet", repeat: { freq: "weekly", interval: 1, byDay: [1] }, body: "Look at the week's bookings.", updated: was },
    { id: "c4", kind: "event", title: "Mastering \u00b7 Lowlands EP", start: `${day(1)}T13:00`, end: `${day(1)}T15:00`, location: "Studio A", color: "amber", art: { seed: 424242, subject: "galaxy" }, updated: was },
    { id: "c5", kind: "event", title: "Podcast recording", start: `${day(2)}T18:00`, end: `${day(2)}T20:00`, location: "Booth", color: "blue", updated: was },
    { id: "c6", kind: "event", title: "Piano lesson", start: `${day(-3)}T17:00`, end: `${day(-3)}T18:00`, color: "green", repeat: { freq: "weekly", interval: 1, count: 6 }, body: "Six weeks, then see.", updated: was },
    { id: "c7", kind: "event", title: "Lunch with Sam", start: `${day(1)}T12:30`, end: `${day(1)}T13:00`, color: "orange", location: "The Crown", updated: was },
    { id: "c8", kind: "event", title: "Studio open day", start: `${day(9)}T00:00`, end: `${day(9)}T23:59`, allDay: true, color: "grey", updated: was },
    { id: "c9", kind: "event", title: "Gear check", start: `${day(-10)}T10:00`, end: `${day(-10)}T11:00`, color: "grey", updated: was },
    { id: "d1", kind: "day", title: "Release day: Night Drive", date: day(3), repeat: "none", preset: "release", aesthetic: "supernova", theme: "quasar", artSalt: "a1b2c3", info: "Singles out at midnight.\nPost the teaser at 9.", updated: was },
    { id: "d2", kind: "day", title: "Maya's birthday", date: `2001-${day(12).slice(5)}`, repeat: "yearly", preset: "birthday", aesthetic: "celestial", theme: "novacane", artSalt: "zz9", info: "Whose orbit: Maya\nGift ideas: a vintage mic", updated: was },
    { id: "quest-q1", kind: "event", title: "Finish the Lowlands mix notes", start: `${T}T09:00`, end: `${T}T10:00`, color: "violet", updated: was },
  ];
  const bookings = [
    { id: "b1", session: "Rehearsal room", name: "The Lanterns", email: "band@example.com", phone: "07700 900456", price: "£75", when: "Friday, 6pm – 9pm", start: feed(4, 18, 0), end: feed(4, 21, 0), extra: [["Band size", "5"], ["Backline", "Drums and amps"]] },
  ];
  const phones = [{ id: "p1", name: "Jordan's iPhone", who: "Jordan" }, { id: "p2", name: "Studio Android", who: "Alex" }];
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    if (u.pathname === "/app/api/calendar/items" && method === "GET") {
      const since = Number(u.searchParams.get("since")) || 0;
      return { items: since ? items.filter((x) => (x.rev || 0) > since) : items.filter((x) => !x.deleted), rev };
    }
    const m = u.pathname.match(/^\/app\/api\/calendar\/items\/(.+)$/);
    if (m && method === "PUT") {
      const id = decodeURIComponent(m[1]);
      const kept = { ...body };
      delete kept.base;
      kept.rev = ++rev;
      const i = items.findIndex((x) => x.id === id);
      if (i >= 0) items[i] = kept; else items.push(kept);
      return { ok: true, item: kept, rev };
    }
    if (m && method === "DELETE") {
      const id = decodeURIComponent(m[1]);
      const i = items.findIndex((x) => x.id === id);
      if (i >= 0) items[i] = { id, deleted: true, rev: ++rev, updated: new Date().toISOString() };
      return { ok: true, rev };
    }
    if (u.pathname === "/app/api/calendar" && method === "GET") return { bookings, setUp: true };
    if (u.pathname === "/app/api/push/phones" && method === "GET") return { phones };
    return undefined;
  });
})();
