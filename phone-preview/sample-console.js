// The phone preview's sample answers for the Console (made up; no real people). Online, terminals don't open
// (Nova Agent only opens them at localhost), so the preview says why, as the real one does, with the tunnel.
(() => {
  const pad = (n) => String(n).padStart(2, "0");
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const tunnel = "ssh -L 4401:localhost:4401 root@203.0.113.7";
  const why = `Terminals only open on the server itself (through an ssh tunnel: ${tunnel}), not online. Nova commands work everywhere.`;
  let vps = { host: "203.0.113.7", user: "root", port: 22 };
  const calendar = {
    rev: 4,
    notes: [
      { id: "c1", title: "Maya Rose: vocal day", body: "Three songs", start: `${day(0)}T11:00`, end: `${day(0)}T17:00`, allDay: false },
      { id: "c2", title: "Night Drive mix review", body: "", start: `${day(2)}T15:30`, end: `${day(2)}T16:30`, allDay: false },
      { id: "c3", title: "Piano tuning", body: "", start: day(4), end: day(4), allDay: true },
    ],
  };
  const log = [
    { time: iso(42), part: "relay", level: "info", message: "Linked to Nova Bot" },
    { time: iso(30), part: "quests", level: "info", message: "Planned the day: 3 quests" },
    { time: iso(12), part: "mail", level: "error", message: "The mail server didn't answer in time (it will try again)" },
    { time: iso(3), part: "chat", level: "info", message: "Answered Jordan in Agent" },
  ];
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/console-api/state") return { ok: true, me: { id: "s1", name: "Jordan Lee", role: "admin", online: true }, terminals: false, why, vps, open: [], localUrl: "http://localhost:4401/console/?here=1", where: "server", tunnel };
    if (p === "/console-api/logs") return { ok: true, lines: log.slice(-(Number(u.searchParams.get("n")) || 40)) };
    if (p === "/console-api/vps" || p === "/console-api/term" || p.startsWith("/console-api/term/")) return { status: 403, body: { ok: false, message: why } };
    if (p === "/status") return { ok: true, live: true, connected: true, model: "claude-sonnet", version: "0.1.0 (preview)" };
    if (p === "/calendar-api/data" && method === "GET") return JSON.parse(JSON.stringify(calendar));
    if (p === "/calendar-api/data" && method === "PUT") { calendar.notes = (body && body.notes) || calendar.notes; calendar.rev++; return { ok: true, rev: calendar.rev }; }
    let m = p.match(/^\/app\/api\/campaigns\/(\d+)$/);
    if (m && method === "GET") return { campaign: { id: Number(m[1]), subject: "Night Drive is out Friday", body: "Hi! Our new single drops this Friday. Here's a first listen…", audience: "fans", status: "pending_approval", created_at: iso(600) } };
    m = p.match(/^\/app\/api\/social\/(\d+)$/);
    if (m && method === "GET") return { post: { id: Number(m[1]), caption: "New single Friday 🌙 #NightDrive", platforms: ["instagram", "facebook"], status: "pending_approval", created_at: iso(300) } };
    m = p.match(/^\/app\/api\/outreach\/(\d+)$/);
    if (m && method === "GET") return { outreach: { id: Number(m[1]), subject: "Studio time for your choir?", toName: "Ellie", toEmail: "ellie@example.com", body: "Hi Ellie, we have a live room that fits a choir of 30…", status: "pending_approval", created_at: iso(900) } };
    return undefined;
  });
})();
