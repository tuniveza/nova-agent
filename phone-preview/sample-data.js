// The phone preview's stand-in for Nova's server: made-up studio data (no real clients), answering the same
// addresses the phone app calls, so the real app's code draws real-looking screens. Saves are kept in memory.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const T = day(0);
  const items = [
    { id: "c1", kind: "event", title: "Vocal session · Maya Rose", start: `${T}T11:00`, end: `${T}T14:00`, location: "Studio A", color: "magenta", author: "Jordan", body: "Two lead takes, then harmonies." },
    { id: "c2", kind: "event", title: "Mix review · Night Drive", start: `${T}T16:30`, end: `${T}T17:30`, location: "Studio B", color: "teal", reminders: [30] },
    { id: "c3", kind: "event", title: "Weekly planning", start: `${day(-((new Date().getDay() + 6) % 7))}T09:30`, end: `${day(-((new Date().getDay() + 6) % 7))}T10:00`, color: "violet", repeat: { freq: "weekly", interval: 1, byDay: [1] } },
    { id: "c4", kind: "event", title: "Mastering · Lowlands EP", start: `${day(1)}T13:00`, end: `${day(1)}T15:00`, location: "Studio A", color: "amber" },
    { id: "c5", kind: "event", title: "Podcast recording", start: `${day(2)}T18:00`, end: `${day(2)}T20:00`, location: "Booth", color: "blue" },
    { id: "d1", kind: "day", title: "Release day: Night Drive", date: day(3), repeat: "none", info: "Singles out at midnight." },
    { id: "quest-q1", kind: "event", title: "Finish the Lowlands mix notes", start: `${T}T09:00`, end: `${T}T10:00`, color: "violet" },
  ];
  const enquiries = [
    { id: 41, name: "Maya Rose", email: "maya@example.com", phone: "07700 900123", subject: "Booking a vocal day", details: "Hi! I'd love to book a full vocal day next month for three songs. Do you have weekends free?", status: "new", created_at: iso(42), last_activity: iso(42), drafts: 1 },
    { id: 40, name: "Kai Bennett", email: "kai@example.com", subject: "Mixing an EP", details: "Looking for mixing on a 5-track EP, stems ready. What would it cost?", status: "new", created_at: iso(300), last_activity: iso(300) },
    { id: 39, name: "The Lanterns", email: "band@example.com", subject: "Rehearsal room", details: "Can we rent the live room for a rehearsal on Friday evenings?", status: "open", created_at: iso(1600), last_activity: iso(900), assigned_name: "Jordan", label: "Rehearsals" },
  ];
  const threads = {
    41: [{ id: 501, direction: "out", channel: "email", status: "draft", body: "Hi Maya, thanks for getting in touch! We have Saturday the 14th and Sunday the 22nd free for a full vocal day. Shall I hold one for you?", created_at: iso(30) }],
    39: [{ id: 480, direction: "out", channel: "email", status: "sent", body: "Hi! Friday evenings are free from 6pm. £25 an hour, with the backline included.", author_name: "Jordan", created_at: iso(1000), sent_at: iso(1000) }, { id: 481, direction: "in", status: "received", body: "Perfect, can we start this Friday?", created_at: iso(900) }],
  };
  const alerts = [
    { id: 9, kind: "booking", title: "New booking: Mix review", body: "Night Drive · Today 16:30", created_at: iso(120), phones: 2 },
    { id: 8, kind: "enquiry", title: "New enquiry from Maya Rose", body: "Booking a vocal day", created_at: iso(42), enquiry_id: 41, phones: 2 },
  ];
  const now = new Date();
  const stamp = (mins) => { const d = new Date(now.getTime() + mins * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const quests = [
    { id: "q1", title: "Finish the Lowlands mix notes", status: "doing", mode: "working", start: stamp(-20), end: stamp(40), minutes: 60, priority: "high", tags: ["mix"], steps: [{ id: "s1", text: "Kick and bass", done: true }, { id: "s2", text: "Vocal rides", done: false }, { id: "s3", text: "Send to Kai", done: false }] },
    { id: "q2", title: "Call the piano tuner", status: "todo", mode: "soon", start: stamp(90), end: stamp(105), minutes: 15, priority: "normal", tags: ["studio"] },
    { id: "q3", title: "Post the Night Drive teaser", status: "todo", mode: "waiting", deadline: stamp(60 * 26), minutes: 30, priority: "high", tags: ["social"] },
    { id: "q4", title: "Order new XLR cables", status: "done", mode: "done", completed: iso(200) },
  ];
  const missions = [{ id: "m1", title: "Release the Night Drive EP", summary: "Four singles, a video and a launch show by spring.", status: "active", deadline: day(120), progress: { percent: 35 }, strategy: [{ heading: "Release strategy", body: "- One single a month\n- Teaser clips a week before each" }], milestones: [{ id: "ms1", title: "Single 1 out", at: `${day(3)}T00:00`, done: false }, { id: "ms2", title: "Video shoot", at: `${day(40)}T10:00`, done: false }], questions: ["Who's filming the video?"], assumptions: ["The mixes are finished by next week"], research: [] }];
  const invoices = [
    { id: 32, number: "NS-0032", billTo: { name: "Night Drive", email: "nd@example.com" }, billing: "full", lines: [{ description: "Mixing, 4 songs", qty: 4, unitPence: 15000, totalPence: 60000 }], subtotalPence: 60000, vatPence: 0, totalPence: 60000, paidPence: 0, balancePence: 60000, issueDate: day(-3), dueDate: day(11), status: "sent", overdue: false },
    { id: 31, number: "NS-0031", billTo: { name: "Kai Bennett", email: "kai@example.com" }, billing: "deposit", lines: [{ description: "Vocal day deposit", qty: 1, unitPence: 12000, totalPence: 12000 }], subtotalPence: 12000, vatPence: 0, totalPence: 12000, paidPence: 0, balancePence: 12000, issueDate: day(-20), dueDate: day(-2), status: "sent", overdue: true },
    { id: 30, number: "NS-0030", billTo: { name: "The Lanterns" }, billing: "full", lines: [{ description: "Rehearsal room, 3 hours", qty: 3, unitPence: 2500, totalPence: 7500 }], subtotalPence: 7500, vatPence: 0, totalPence: 7500, paidPence: 7500, balancePence: 0, issueDate: day(-30), dueDate: day(-16), status: "paid" },
  ];
  const money = {
    summary: { owed: { count: 2, pence: 72000 }, overdue: { count: 1, pence: 12000 }, month: { inPence: 48500, outPence: 9900 }, waitingApproval: 0, taxYear: { name: "2026–27", from: "2026-04-06", to: "2027-04-05", inPence: 1284000, outPence: 312500, outByCategory: [{ category: "Equipment", pence: 189000 }, { category: "Software and subscriptions", pence: 64500 }, { category: "Marketing and ads", pence: 41000 }, { category: "Travel", pence: 18000 }] } },
    invoices, reminders: [], canDecide: true, emailReady: true, cardReady: true,
    expenses: [{ id: 3, spentOn: day(-2), amountPence: 4999, category: "Software and subscriptions", supplier: "Plugin Boutique", note: "Vocal plugin", status: "confirmed", receiptId: "r1" }, { id: 2, spentOn: day(-9), amountPence: 12900, category: "Equipment", supplier: "Thomann", note: "XLR cables", status: "confirmed" }, { id: 4, spentOn: day(-1), amountPence: 1250, category: "Food and hospitality", supplier: "Café", note: "Noted by Nova Agent", status: "unconfirmed" }],
    settings: { vatRate: 0, dueDays: 14, bankReady: true, monzoReady: true, business: { name: "Novacane Studios", email: "hello@example.com" }, bank: { accountName: "Novacane Studios", sortCode: "12-34-56", accountNumber: "12345678" }, monzo: { link: "monzo.me/example" } },
    categories: ["Equipment", "Software and subscriptions", "Studio rent and bills", "Marketing and ads", "Musicians and freelancers", "Travel", "Repairs and upkeep", "Food and hospitality", "Bank and payment fees", "Other"],
    methods: [{ id: "bank", name: "Bank transfer" }, { id: "monzo", name: "Monzo" }, { id: "card", name: "Card" }, { id: "cash", name: "Cash" }, { id: "other", name: "Other" }],
  };
  let chat = [{ role: "user", content: "What's on today?" }, { role: "assistant", content: "You've got **Maya Rose's vocal session** at 11:00 in Studio A, then the **Night Drive mix review** at 16:30.\n- Maya's enquiry has a draft reply waiting for you\n- Kai's invoice is 2 days overdue", actions: [{ kind: "looked", text: "Looked at today's calendar" }, { kind: "draft", text: "Drafted a reply to Maya Rose", draft: { enquiryId: 41 } }] }];
  const routes = [
    [/^\/auth\/me/, () => ({ staff: { id: "s1", display_name: "Jordan Lee", role: "admin" } })],
    [/^\/app\/api\/enquiries\/thread/, (u) => { const id = Number(u.searchParams.get("id")); return { enquiry: { ...enquiries.find((e) => e.id === id) }, messages: threads[id] || [], team: [{ id: "s1", display_name: "Jordan Lee" }, { id: "s2", display_name: "Sam Okoro" }], canSend: true }; }],
    [/^\/app\/api\/enquiries/, (u) => { const box = u.searchParams.get("box"); const list = box ? enquiries.filter((e) => e.status === box) : enquiries; return { enquiries: list, newCount: 2, counts: { new: 2, open: 1, replied: 0, done: 4, spam: 1 }, team: [] }; }],
    [/^\/app\/api\/notifications/, () => ({ notifications: alerts, autoDeleteDays: 7, choices: [1, 3, 7, 14, 30] })],
    [/^\/app\/api\/money\/invoices\/(\d+)\/stage/, (u, m) => { const i = invoices.find((x) => String(x.id) === m[1]); return { stage: u.searchParams.get("stage") || (i.status === "paid" ? "paid" : i.overdue ? "overdue" : "balance"), email: { subject: `Invoice ${i.number}`, body: `Hi ${i.billTo.name.split(" ")[0]},\n\nJust a reminder that invoice ${i.number} is due. You can pay by bank transfer or card from the link.\n\nThanks,\nNovacane Studios` } }; }],
    [/^\/app\/api\/money\/invoices\/(\d+)/, (u, m) => ({ invoice: invoices.find((i) => String(i.id) === m[1]), payments: m[1] === "30" ? [{ id: 1, amountPence: 7500, paidOn: day(-18), method: "bank", methodName: "Bank transfer", byName: "Jordan" }] : [], reminders: [], log: [{ at: iso(3000), event: "created", detail: "Written by Jordan", byName: "Jordan" }, { at: iso(2900), event: "approved", detail: "Approved and emailed", byName: "Jordan" }] })],
    [/^\/app\/api\/money\/catalogue/, () => ({ services: [{ id: 1, group: "Recording", name: "Vocal session (per hour)", pricePence: 4000 }, { id: 2, group: "Recording", name: "Full studio day", pricePence: 28000 }, { id: 3, group: "Post", name: "Mixing (per song)", pricePence: 15000, from: true }, { id: 4, group: "Post", name: "Mastering (per song)", pricePence: 5000 }], depositPercent: 50, themes: [{ id: "night", name: "Night" }, { id: "ruby", name: "Ruby" }, { id: "paper", name: "Paper" }], modes: ["dark", "bright"], papers: [{ id: "moonstone", name: "Moonstone" }, { id: "pearl", name: "Pearl" }], theme: "night", mode: "dark", paper: "moonstone" })],
    [/^\/app\/api\/clients/, () => ({ clients: [{ id: 1, name: "Maya Rose", email: "maya@example.com" }, { id: 2, name: "Night Drive", email: "nd@example.com" }, { id: 3, name: "Kai Bennett", email: "kai@example.com" }] })],
    [/^\/app\/api\/money/, () => money],
    [/^\/app\/api\/calendar\/items/, () => ({ items, rev: 1 })],
    [/^\/app\/api\/calendar/, () => ({ bookings: [], setUp: true })],
    [/^\/app\/api\/conversations/, (u) => (u.searchParams.get("chat") ? { messages: [{ role: "user", content: "Hi, do you record podcasts?", created_at: iso(70) }, { role: "assistant", content: "We do! The booth seats four, with video if you'd like it. Shall I send prices?", created_at: iso(69) }], live: {}, ticket: {} } : { conversations: [{ chat_id: "ch1", first_question: "Hi, do you record podcasts?", messages: 2, last: iso(69), started: iso(70) }], needsPerson: 0 })],
    [/^\/app\/api\/booking-actions/, () => ({ actions: [{ id: 7, kind: "reschedule", status: "pending", summary: "Move Kai Bennett's vocal session from Fri 14:00 to Sat 11:00 (they'll be emailed)", reason: "Kai asked by email to move it" }], canDecide: true })],
    [/^\/app\/api\/inbox\/saved/, () => ({ saved: [{ id: 1, title: "Prices", body: "Hi {name}, our rates are £40 an hour, or £280 for a full day." }] })],
    [/^\/app\/api\/sessions/, () => ({ sessions: [{ id: 1, name: "Vocal session", price: "£40/h" }] })],
    [/^\/quests\/state/, () => ({ now: stamp(0), quests, missions, blocks: [], current: quests[0], next: [quests[1]], overdue: [], unplanned: [], rhythm: { wake: "07:30", sleep: "23:30" }, canSeeEveryone: true, scope: "mine" })],
    [/^\/chat\/history/, () => ({ messages: chat })],
    [/^\/files\/list/, () => ({ files: [{ id: "f1", title: "Night Drive release plan", name: "release-plan.md", type: "md", size: 4200, url: "#", updated: iso(2000) }] })],
  ];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const real = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url, "https://nova.example");
    if (u.origin !== "https://nova.example" && !String(input).startsWith("/")) return real(input, opts);
    const method = (opts.method || "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, 250));
    if (method !== "GET") {
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (u.pathname === "/actions/chat") { chat.push({ role: "user", content: body.message }); const reply = { role: "assistant", content: "This is the preview, so I can't really answer, but this is where my reply appears.", actions: [] }; chat.push(reply); return json({ ok: true, reply: reply.content, actions: [] }); }
      if (u.pathname.startsWith("/app/api/calendar/items/") && method === "PUT") { const i = items.findIndex((x) => x.id === body.id); delete body.base; if (i >= 0) items[i] = body; else items.push(body); return json({ ok: true, item: body, rev: 2 }); }
      if (u.pathname.startsWith("/app/api/calendar/items/") && method === "DELETE") { const id = decodeURIComponent(u.pathname.split("/").pop()); const i = items.findIndex((x) => x.id === id); if (i >= 0) items.splice(i, 1); return json({ ok: true, rev: 3 }); }
      if (u.pathname === "/actions/quests") { quests.push({ id: `q${quests.length + 9}`, status: "todo", mode: "waiting", ...body }); return json({ ok: true, result: {} }); }
      const q = u.pathname.match(/^\/actions\/quests\/(.+)$/);
      if (q) { const it = quests.find((x) => x.id === decodeURIComponent(q[1])); if (it && body.action === "done") { it.status = "done"; it.mode = "done"; } if (it && body.action === "reopen") { it.status = "todo"; it.mode = "waiting"; } if (it && body.action === "start") it.status = "doing"; if (it && body.changes) Object.assign(it, body.changes); return json({ ok: true, result: it }); }
      return json({ ok: true });
    }
    for (const [re, fn] of routes) { const m = u.pathname.match(re); if (m) return json(fn(u, m)); }
    return json({ error: "Not in the preview" }, 404);
  };
})();
