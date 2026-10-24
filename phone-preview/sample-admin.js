// The phone preview: made-up answers for the admin places (admin.js): Google, Test stuff, Referrals, Links and
// Test booking. Nobody real. index.html?google=new starts with Google not set up yet.
(() => {
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const out = (status, error, more) => ({ status, body: { error, ...more } });
  const fresh = new URLSearchParams(location.search).get("google") === "new";
  const origin = "https://nova.example";

  // ---- Google ----
  const g = {
    sandbox: false, canManage: true, hasKey: !fresh, keyFrom: "app", keyShort: "1234-abcdefghi…", connected: !fresh, account: fresh ? null : "studio@example.com", connectedAt: iso(9000),
    missing: fresh ? [] : ["Tasks"], needsReconnect: false, folderUrl: fresh ? null : "https://drive.google.com/", sheetUrl: fresh ? null : "https://docs.google.com/spreadsheets/",
    options: {},
    parts: [
      { id: "calendar", label: "Calendar", help: "Bookings and note cards in Google Calendar, both ways", on: true, allowed: true },
      { id: "replies", label: "Replies", help: "Replies to the studio's emails come into Portal", on: true, allowed: true },
      { id: "contacts", label: "Contacts", help: "Clients kept in Google Contacts", on: true, allowed: true },
      { id: "sheets", label: "Money sheet", help: "Invoices and expenses in a Google Sheet", on: false, allowed: true },
      { id: "tasks", label: "Tasks", help: "Quests in Google Tasks", on: true, allowed: false },
      { id: "backups", label: "Backups", help: "Index backed up to Drive each night", on: true, allowed: true },
    ],
    status: { calendar: { ok: true, note: "12 events in step", at: iso(4) }, replies: { ok: false, note: "Gmail said: rate limit, trying again later", at: iso(30) }, contacts: { ok: true, note: "84 contacts", at: iso(300) }, backups: { ok: true, note: "Index backed up (212 files)", at: iso(700) } },
    held: {},
    steps: [
      { title: "Switch on Google's features", text: "Press the button, pick (or make) a project called Nova Agent, then press Next and Enable.", open: { href: "https://console.cloud.google.com/", label: "Open Google Cloud" }, copy: [] },
      { title: "Set up Google's permission screen", text: "Press Get started. App name: Nova Agent. Pick your own email for both email boxes. Audience: External. Then Create.", open: { href: "https://console.cloud.google.com/auth/overview", label: "Open the sign-in screen" }, copy: ["Nova Agent"] },
      { title: "Keep it working", text: "Press Publish app, then Confirm. (If you skip this, Google stops the connection every 7 days.)", open: { href: "https://console.cloud.google.com/auth/audience", label: "Open Audience" }, copy: [] },
      { title: "Make the key", text: "Type: Web application. Name: Nova Agent. Add the first web address under Authorised JavaScript origins and the second one under Authorised redirect URIs, then press Create.", open: { href: "https://console.cloud.google.com/auth/clients/create", label: "Make the key" }, copy: [origin, `${origin}/admin/google/callback`] },
      { title: "Paste the key here", text: "Google shows a Client ID and a Client secret. Copy each one into the boxes below.", key: true, copy: [] },
      { title: "Connect the studio's Google account", text: "Press Connect Google and pick the studio's Google account. Tick every box. If Google says the app isn't verified, press Advanced, then Go to Nova Agent: that's expected.", connect: true, copy: [] },
    ],
  };
  let syncLeft = {};

  // ---- Test stuff ----
  const bot = {
    items: [
      { key: "enquiry:41", kind: "enquiry", kindName: "Enquiry", id: "41", title: "Test Test: testing the form", confidence: "likely", side: "bot", where: "Enquiries", open: "/portal/?view=enquiries&enquiry=41", created: iso(9000), by: "From the website", reasons: [{ text: "The name is “Test Test”", strong: true }, { text: "The email ends @example.com", strong: false }], linked: [{ key: "chat:c9", kind: "chat", kindName: "Conversation", label: "“hello this is a test”" }, { key: "client:77", kind: "client", kindName: "Client", label: "Test Test" }] },
      { key: "invoice:29", kind: "invoice", kindName: "Invoice", id: "29", title: "NS-0029 to Night Drive (not sent)", confidence: "maybe", side: "bot", where: "the Invoicer", open: "/invoicer/?invoice=29", created: iso(20000), by: "Nova Agent", reasons: [{ text: "Made by Nova Agent and never sent", strong: false }], linked: [] },
      { key: "client:12", kind: "client", kindName: "Client", id: "12", title: "Kai Bennett (copy)", confidence: "maybe", side: "bot", where: "Clients", open: "/portal/?view=clients&client=12", created: iso(40000), by: "From a booking", locked: true, reasons: [{ text: "Same email as another client", strong: true }, { text: "Has real sessions, money or consent: check before deleting", strong: false }], linked: [] },
    ],
    recent: [{ binId: "b1", key: "note:n4", kind: "note", kindName: "Shared note", title: "asdf", deletedBy: "Jordan Lee", deletedAt: iso(200), restoredAt: null }],
    real: [{ key: "enquiry:12", kind: "enquiry", kindName: "Enquiry", title: "Testament Records: a showcase", markedBy: "Jordan Lee", markedAt: iso(5000) }],
  };
  const pc = {
    ok: true,
    items: [
      { key: "quest:q-test", kind: "quest", kindName: "Quest", id: "q-test", title: "test quest please ignore", confidence: "likely", side: "pc", where: "Quests", open: "/portal/?view=quests", created: iso(600), by: "Jordan", reasons: [{ text: "The title says it's a test", strong: true }], linked: [] },
      { key: "fixer:j3", kind: "fixer", kindName: "Fixer job", id: "j3", title: "Chip wraps at 320 wide", confidence: "maybe", side: "pc", where: "The Fixer", open: "/agent/?open=%2Ffixer%2F", created: iso(3000), by: "The Fixer", noRestore: true, note: "Clearing it rejects the old fix (nothing on the site changes).", reasons: [{ text: "Older than two weeks and never applied", strong: false }], linked: [] },
    ],
    recent: [{ binId: "p1", key: "calnote:x", kind: "calnote", kindName: "Calendar note", title: "TEST card", deletedBy: "Jordan Lee", deletedAt: iso(90), restoredAt: iso(60), restoredBy: "Jordan Lee" }],
    real: [],
  };
  const bin = [];
  function del(list, items) {
    const done = [];
    for (const it of items) {
      const i = list.items.findIndex((x) => x.key === it.key);
      if (i < 0) continue;
      const [x] = list.items.splice(i, 1);
      const binId = `bin-${Math.random().toString(36).slice(2, 8)}`;
      bin.push({ binId, x, list });
      list.recent.unshift({ binId, key: x.key, kind: x.kind, kindName: x.kindName, title: x.title, deletedBy: "Jordan Lee", deletedAt: new Date().toISOString(), restoredAt: null });
      done.push({ key: x.key, binId, count: 1 + (it.together ? (it.linked || []).length : 0), skipped: [] });
    }
    return { ok: true, done, failed: [] };
  }
  function restore(list, binId) {
    const b = bin.find((x) => x.binId === binId);
    const r = list.recent.find((x) => x.binId === binId);
    if (r) { r.restoredAt = new Date().toISOString(); r.restoredBy = "Jordan Lee"; }
    if (b) b.list.items.push(b.x);
    return { ok: true };
  }

  // ---- Links ----
  const links = {
    checkedAt: iso(0),
    groups: [
      { title: "The apps", note: "What people open every day.", items: [
        { name: "Nova Phone", url: "https://nova.example/phone/", kind: "live", note: "The phone version", check: { state: "up", label: "Up · 200" } },
        { name: "Nova Desk", url: "https://nova.example/agent/", kind: "live", note: "", check: { state: "up", label: "Up · 200" } },
        { name: "Booking page", url: "https://nova.example/book/", kind: "planned", note: "Nova's own booking, when it goes live", check: { state: "unchecked", label: "Not set up yet" } },
      ] },
      { title: "Behind the scenes", note: "", items: [
        { name: "Nova Bot's push key", url: "https://nova.example/app/api/push/key", kind: "machine", note: "", check: { state: "up", label: "Up · needs details (400)" } },
        { name: "Old test site", url: "https://old-test.example/", kind: "testing", note: "", check: { state: "down", label: "No answer" } },
        { name: "Deploy Nova Bot", url: "npx wrangler deploy", kind: "local", note: "Never run plainly: use deploy.sh", check: { state: "unchecked", label: "Not a web address" } },
      ] },
    ],
    features: [{ app: "Portal", note: "", items: [{ name: "Inbox", detail: "Enquiries, conversations and alerts" }] }],
    changelog: [{ date: day(0), app: "Nova Phone", size: "big", title: "Admin pages on the phone", what: "Referrals, Links and Test booking", why: "Everything on the phone", benefit: "No computer needed" }],
  };

  // ---- Referrals: the spreadsheet ----
  const csvRows = [
    ["Appointment ID", "Appointment date", "First name", "Last name", "Email", "Phone", "Session", "Status", "Booked at", "Referred?", "Referral code", "Code belongs to", "Referred by (typed)", "Invalid code typed", "Referral source", "Referral recorded at"],
    ["901", `${day(3)}T11:00:00Z`, "Maya", "Rose", "maya@example.com", "", "Vocal session (3 hours)", "booked", iso(900), "yes", "JAMES10", "James Smith", "", "", "booking form", iso(900)],
    ["900", `${day(1)}T18:00:00Z`, "Kai", "Bennett", "kai@example.com", "", "Rehearsal (2 hours)", "booked", iso(3000), "yes", "", "", "my mate Tom", "TOMM", "booking form", iso(3000)],
    ["899", `${day(-2)}T14:00:00Z`, "The", "Lanterns", "lanterns@example.com", "", "Full studio day", "canceled", iso(9000), "no", "", "", "", "", "", ""],
    ["898", `${day(-6)}T10:00:00Z`, "Night", "Drive", "nd@example.com", "", "Mixing (per song)", "booked", iso(12000), "yes", "JAMES10", "James Smith", "", "", "booking form", iso(12000)],
    ["897", `${day(-9)}T19:00:00Z`, "Sol", "Ade", "sol@example.com", "", "Vocal session (3 hours)", "booked", iso(15000), "", "", "", "", "", "", ""],
  ];
  const csv = csvRows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
  // (a spreadsheet isn't JSON: answered before the preview's JSON answers)
  const prev = window.fetch;
  window.fetch = async (input, opts) => {
    const u = new URL(typeof input === "string" ? input : input.url, origin);
    if (u.pathname === "/admin/report.csv") { await new Promise((r) => setTimeout(r, 200)); return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8" } }); }
    return prev(input, opts);
  };

  // ---- Test booking ----
  const sessions = [{ id: 1, name: "Rehearsal (2 hours)", price: "£50" }, { id: 2, name: "Vocal session (3 hours)", price: "£120" }];
  let testBookings = [{ id: 31, status: "booked", when: `${day(28)} 10:00`, session: "Rehearsal (2 hours)", paid: "payment bypassed: test", blocks: false, created_uk: "Yesterday 15:12" }];

  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/app/api/google" && method === "GET") {
      for (const k of Object.keys(syncLeft)) { if (--syncLeft[k] <= 0) { g.status[k] = { ok: true, note: "Brought up to date", at: new Date().toISOString() }; delete syncLeft[k]; } }
      return g;
    }
    if (p === "/app/api/google/options") { for (const [k, v] of Object.entries(body.changes || {})) { const x = g.parts.find((y) => y.id === k); if (x) x.on = v; } return { ok: true }; }
    if (p === "/app/api/google/sync") { g.status[body.part] = { ok: true, note: "Syncing now…", at: new Date().toISOString(), running: true }; syncLeft[body.part] = 2; return { ok: true, started: true, message: "Syncing now." }; }
    if (p === "/app/api/google/connect-link") return { ok: true, url: "https://example.com/" };
    if (p === "/app/api/google/key") { if (!/googleusercontent/.test(body.clientId || "")) return out(400, "That Client ID doesn't look right: it ends .apps.googleusercontent.com."); g.hasKey = true; g.keyShort = String(body.clientId).slice(0, 14) + "…"; return { ok: true, message: "Saved ✓ Now press Connect Google." }; }
    if (p === "/app/api/google/key/remove") { g.hasKey = false; return { ok: true }; }
    if (p === "/app/api/google/disconnect") { g.connected = false; g.account = null; return { ok: true }; }
    if (p === "/app/api/google/sheet") return { ok: true, url: "https://docs.google.com/spreadsheets/" };
    if (p === "/app/api/tidy" && method === "GET") return { ...bot, counts: {} };
    if (p === "/app/api/tidy/delete") return del(bot, body.items || []);
    if (p === "/app/api/tidy/restore") return restore(bot, body.binId);
    if (p === "/app/api/tidy/real") { const i = bot.items.findIndex((x) => x.key === body.key); const [x] = i >= 0 ? bot.items.splice(i, 1) : [{ kindName: "", title: body.title }]; bot.real.push({ key: body.key, kindName: x.kindName, title: body.title, markedBy: "Jordan Lee", markedAt: new Date().toISOString() }); return { ok: true }; }
    if (p === "/app/api/tidy/unreal") { bot.real = bot.real.filter((x) => x.key !== body.key); return { ok: true }; }
    if (p === "/tidy-api/state") return pc;
    if (p === "/actions/tidy/delete") return del(pc, body.items || []);
    if (p === "/actions/tidy/restore") return restore(pc, body.binId);
    if (p === "/actions/tidy/real" || p === "/actions/tidy/unreal") return { ok: true };
    if (p === "/app/api/links") return links;
    if (p === "/admin/links" && method === "POST") { try { const raw = JSON.parse(body.get("json")); links.groups = raw.groups.map((gr) => ({ ...gr, items: gr.items.map((i) => ({ ...i, check: { state: "unchecked", label: "Checked next time" } })) })); } catch (e) {} return {}; }
    if (p === "/admin/codes" && method === "POST") return {};
    if (p === "/admin/test-booking/state") return { facts: { system: "nova", google: true, sandbox: false, stripe: "live-only", keepHours: 24, max: 3 }, sessions, session: Number(u.searchParams.get("session")) || 1, quiet: { date: day(28), time: "10:00" }, bookings: testBookings };
    if (p === "/admin/test-booking/times") return { times: ["09:00", "10:00", "13:00", "16:00"] };
    if (p === "/admin/test-booking/run") {
      const b = { id: 32 + testBookings.length, status: "booked", when: `${body.date} ${body.time}`, session: sessions.find((s) => s.id === body.session)?.name || "", paid: body.payment === "fake" ? "£25 (simulated)" : "payment bypassed: test", blocks: body.blockSlot, created_uk: "Just now" };
      testBookings = [b, ...testBookings];
      return { ok: true, steps: [{ key: "slot", label: "Slot found", status: "pass", detail: `${body.date} ${body.time}` }, { key: "booking", label: "Booking created", status: "pass", detail: `TEST #${b.id}` }, { key: "payment", label: "Payment", status: body.payment === "fake" ? "pass" : "skip", detail: b.paid }, { key: "email", label: "Confirmation email", status: body.emailMe ? "pass" : "skip", detail: body.emailMe ? "Sent to you only" : "Not sent (you didn't ask)" }, { key: "calendar", label: "Calendar event", status: "pass", detail: "In Google Calendar, marked TEST" }, { key: "alerts", label: "Alerts", status: body.alertMe ? "pass" : "skip", detail: "" }],
        email: { subject: "TEST · Your booking at Novacane Studios", to: body.emailMe ? "jordan@example.com" : "", html: "<h1>You're booked in</h1><p>Hi TEST,</p><p>See you on the day. Bring your own headphones if you like.</p>" }, alert: body.alertMe ? { title: "TEST booking", body: "TEST Booking · Rehearsal (2 hours)\nWhen: in four weeks" } : null, bookings: testBookings };
    }
    if (p === "/admin/test-booking/remove") { const n = testBookings.length; testBookings = []; return { ok: true, removed: n, kept: [], bookings: [] }; }
    return undefined;
  });
})();
