// The phone preview: the Website bot's two helpers, answering made-up things.
(() => {
  "use strict";
  window.NovaSampleBot = { sent: [] };
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    if (method !== "POST") return undefined;
    if (u.pathname === "/app/api/ask") { window.NovaSampleBot.sent.push({ path: u.pathname, body }); return window.NovaSampleBotDown ? { status: 500, body: { error: "Nova is resting" } } : { answer: `This is the preview, so I can't look for real, but here's where my answer to “${String(body.question).slice(0, 60)}” appears. You have **3 bookings today**; Maya Rose's vocal session starts at 11:00.` }; }
    if (u.pathname === "/app/api/chat") { window.NovaSampleBot.sent.push({ path: u.pathname, body }); return { reply: "Here's a booking link for a 2-hour vocal session: https://nova.novacane.co.uk/book?session=vocal-2h. Shall I send it?" }; }
    return undefined;
  });
})();
