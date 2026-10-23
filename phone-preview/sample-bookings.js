// The phone preview: made-up bookings in Acuity's diary (Booking tools, Today's tiles). No real people.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const ukKey = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  // (a UK wall time as the feed's "20261022T131500Z")
  function feed(key, hh, mm = 0) {
    const [y, m, d] = key.split("-").map(Number);
    let t = Date.UTC(y, m - 1, d, hh, mm);
    for (let i = 0; i < 2; i++) {
      const wall = new Date(t).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
      t -= ((wall[0] * 60 + wall[1]) - (hh * 60 + mm)) * 60000;
    }
    const x = new Date(t);
    return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}00Z`;
  }
  const b = (offset, from, to, name, session, price, more = {}) => ({ name, session, price, phone: more.phone || null, email: more.email || null, extra: more.extra || [], link: more.link || null, start: feed(ukKey(offset), ...from), end: feed(ukKey(offset), ...to) });
  const bookings = [
    b(0, [11, 0], [14, 0], "Maya Rose", "Vocal session (3 hours)", "£120.00", { phone: "07700 900123", email: "maya@example.com", extra: [["How many songs?", "Three"], ["Anything we should know?", "Bringing my own mic"]] }),
    b(0, [16, 30], [17, 30], "Night Drive", "Mix review", "£40.00", { email: "nd@example.com", link: "https://calendar.google.com/calendar/event?eid=example" }),
    b(0, [17, 20], [19, 0], "Kai Bennett", "Mixing session", "£80.00", { phone: "07700 900456" }),
    b(1, [13, 0], [15, 0], "The Lanterns", "Rehearsal room (2 hours)", "£50.00", { email: "band@example.com" }),
    b(1, [14, 30], [16, 0], "Ellie Park", "Vocal session", "£60.00"),
    b(2, [10, 0], [22, 30], "Riverside Choir", "Full studio day", "£280.00", { email: "hello@example.org" }),
    b(5, [18, 0], [20, 0], "Sam Ortiz", "Podcast recording", "£70.00"),
    b(9, [12, 0], [14, 0], "Maya Rose", "Vocal session", "£80.00", { phone: "07700 900123" }),
  ];
  window.NovaSampleBookings = { bookings, setUp: true };
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method) => {
    if (u.pathname === "/app/api/calendar" && method === "GET") return window.NovaSampleBookings.setUp ? { bookings, setUp: true } : { bookings: [], setUp: false };
    return undefined;
  });
})();
