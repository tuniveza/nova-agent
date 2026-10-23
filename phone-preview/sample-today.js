// The phone preview: made-up answers for Today's tiles that sample-data.js doesn't give. No real people.
(() => {
  "use strict";
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  // (window.NovaSampleSlow = { "/app/api/money": 3000 } makes an answer late: Today's tiles fill in as they come)
  (window.NovaSampleExtra = window.NovaSampleExtra || []).unshift(async (u) => { const ms = (window.NovaSampleSlow || {})[u.pathname]; if (ms) await new Promise((r) => setTimeout(r, ms)); return undefined; });
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method) => {
    if (method !== "GET") return undefined;
    if (u.pathname === "/app/api/google/today") return { events: [{ id: "g-1", title: "Call with the label", start: "15:00", end: "15:30", allDay: false, location: "", meetUrl: "https://meet.google.com/abc-defg-hij", from: "Google Calendar" }, { id: "c1", title: "Vocal session · Maya Rose", start: "11:00", end: "14:00", allDay: false, location: "Studio A", meetUrl: "", from: "Jordan" }] };
    if (u.pathname === "/tidy-api/state") return { items: [{ key: "pc-q9", kind: "Quest", title: "test quest", confidence: "likely" }], real: [], recent: [] };
    if (u.pathname === "/app/api/conversations" && !u.searchParams.get("chat")) return { conversations: [{ chat_id: "ch2", first_question: "Can I book the live room this Saturday for a band rehearsal?", messages: 4, last: iso(12), started: iso(30), state: "needs-person" }, { chat_id: "ch1", first_question: "Hi, do you record podcasts?", messages: 2, last: iso(69), started: iso(70) }], needsPerson: 1 };
    return undefined;
  });
})();
