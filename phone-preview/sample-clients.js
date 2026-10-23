// The phone preview: made-up clients (no real people), with every Clients address: the list and its filters,
// one client, adding (a duplicate refused), changes, consent, sync, Acuity's spreadsheet and Google Contacts.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const clients = [
    { id: 1, name: "Maya Rose", email: "maya@example.com", phone: "07700 900123", consent: { yes: true, source: "Ticked on the booking form", at: day(-40) }, lastBooked: `${day(-12)}T11:00:00Z`, nextBooked: `${day(0)}T10:00:00Z`, sessionCount: 4, outstanding: "0.00", depositsPaid: "120.00", invoiced: "480.00", notes: "Prefers mornings.", source: "booking", createdAt: iso(90000), updatedAt: iso(30) },
    { id: 2, name: "Night Drive", email: "nd@example.com", phone: "", consent: { yes: false }, lastBooked: `${day(-3)}T15:30:00Z`, nextBooked: null, sessionCount: 7, outstanding: "600.00", depositsPaid: "0.00", invoiced: "1600.00", notes: "", source: "import", createdAt: iso(200000), updatedAt: iso(300) },
    { id: 3, name: "Kai Bennett", email: "kai@example.com", phone: "07700 900456", consent: { yes: false }, lastBooked: null, nextBooked: null, sessionCount: 0, outstanding: "120.00", depositsPaid: "0.00", invoiced: "120.00", notes: "", source: "enquiry", createdAt: iso(5000), updatedAt: iso(900) },
  ];
  const sessions = { 1: [{ id: 1, session: "Vocal session", start: `${day(0)}T10:00:00Z`, price: "120", status: "booked", source: "feed" }, { id: 2, session: "Vocal session", start: `${day(-12)}T10:00:00Z`, price: "80", status: "booked", source: "webhook" }, { id: 3, session: "Mixing session", start: `${day(-40)}T13:00:00Z`, price: "£80.00", status: "cancelled", source: "import" }] };
  const logs = { 1: [{ consent: 1, at: day(-40), source: "Ticked on the booking form", by: "customer", recorded_at: `${day(-40)}T09:00:00Z` }, { consent: 0, at: day(-90), source: "Started at no", by: "import", recorded_at: `${day(-90)}T09:00:00Z` }] };
  window.NovaSampleClients = { clients, sent: [] };
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (!p.startsWith("/app/api/clients") && p !== "/app/api/google/contacts/phone") return undefined;
    if (method !== "GET") window.NovaSampleClients.sent.push({ method, path: p, body });
    if (p === "/app/api/google/contacts/phone") {
      if (window.NovaSampleContactsOff) return { contacts: [], off: true };
      const want = String(u.searchParams.get("phone") || "").replace(/\D/g, "").slice(-9);
      return { contacts: want === "700900789" ? [{ name: "Rowan Hale", emails: ["rowan@example.com"], phones: ["+44 7700 900789", "020 7946 0000"], addresses: ["1 Example Street, London, E1 6AN"], organisation: "Hale Sound, producer", birthday: "14/03", notes: "Met at the open day." }] : [] };
    }
    if (p === "/app/api/clients" && method === "GET") {
      const f = u.searchParams.get("filter") || "all", q = (u.searchParams.get("search") || "").toLowerCase();
      let list = clients.filter((c) => !q || [c.name, c.email, c.phone].join(" ").toLowerCase().includes(q));
      if (f === "owing") list = list.filter((c) => Number(c.outstanding) > 0);
      if (f === "lapsed") list = list.filter((c) => c.lastBooked && c.lastBooked.slice(0, 10) < (u.searchParams.get("since") || "") && !c.nextBooked);
      if (f === "enquiry") list = list.filter((c) => c.source === "enquiry" && !c.sessionCount);
      return { clients: list, total: list.length };
    }
    if (p === "/app/api/clients" && method === "POST") {
      const was = clients.find((c) => (body.email && c.email === body.email) || (body.name && c.name.toLowerCase() === String(body.name).toLowerCase()));
      if (was) return { status: 409, body: { error: `${was.name} is already a client`, id: was.id } };
      const c = { id: clients.length + 1, consent: { yes: false }, sessionCount: 0, outstanding: "0.00", depositsPaid: "0.00", invoiced: "0.00", source: "staff", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body };
      clients.push(c);
      return { client: c };
    }
    if (p === "/app/api/clients/sync") return { clients: { added: 2, updated: 5 }, sessions: { added: 3, updated: 1 } };
    if (p === "/app/api/clients/import") return /appointment|start time/i.test(body.csv || "") ? { kind: "appointments", clients: { added: 1, updated: 2 }, sessions: { added: 4, updated: 0 }, skipped: 1, problems: [{ line: 3, problem: "No start time" }] } : { kind: "clients", clients: { added: 3, updated: 0 }, sessions: {}, skipped: 0, problems: [] };
    const m = p.match(/^\/app\/api\/clients\/(\d+)$/);
    if (!m) return undefined;
    const c = clients.find((x) => x.id === Number(m[1]));
    if (!c) return { status: 404, body: { error: "There's no client like that" } };
    if (method === "GET") return { client: c, sessions: sessions[c.id] || [], consentLog: logs[c.id] || [] };
    if (body.consent) {
      c.consent = body.consent.yes ? { yes: true, source: body.consent.source, at: body.consent.at } : { yes: false };
      (logs[c.id] ||= []).unshift({ consent: body.consent.yes ? 1 : 0, at: body.consent.at || day(0), source: body.consent.source, byName: "Jordan Lee", recorded_at: new Date().toISOString() });
    } else Object.assign(c, body);
    c.updatedAt = new Date().toISOString();
    return { client: c };
  });
})();
