// The phone preview: Inbox's sample answers (made-up people, no real clients), the same shapes Nova Bot sends
// (src/enquiry-replies.js, src/inbox.js, src/push.js, src/booking-actions.js, app-page.js). Saves kept in memory.
(() => {
  "use strict";
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const ahead = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const team = [{ id: "s1", name: "Jordan" }, { id: "s2", name: "Ava" }];
  const me = { id: "s1", name: "Jordan" };
  const nameOf = (id) => (team.find((t) => t.id === id) || {}).name || null;
  let labels = ["Rehearsals", "Mixing", "Vocals"];
  const enquiries = [
    { id: 41, name: "Maya Rose", email: "maya@example.com", phone: "07700 900123", dial: "+447700900123", subject: "Booking a vocal day", details: "Hi! I'd love to book a full vocal day next month for three songs. Do you have weekends free?", page: "/vocals", chat_id: "chat-maya", emailed: 1, status: "new", consent_at: iso(42), consent_source: "Ticked on NovaBot's enquiry form", created_at: iso(42), assigned_to: null, label: null },
    { id: 40, name: "Kai Bennett", email: "kai@example.com", phone: "0161 496 0000", dial: null, subject: "Mixing an EP", details: "Looking for mixing on a 5-track EP, stems ready. What would it cost?", page: "/mixing", emailed: 1, status: "new", consent_at: iso(300), consent_source: "Ticked on NovaBot's enquiry form", created_at: iso(300), assigned_to: null, label: "Mixing" },
    { id: 39, name: "The Lanterns", email: "band@example.com", phone: "07700 900456", dial: "+447700900456", subject: "Rehearsal room", details: "Can we rent the live room for a rehearsal on Friday evenings?", page: "/rooms", status: "replied", consent_at: iso(1600), created_at: iso(1600), assigned_to: "s1", label: "Rehearsals" },
    { id: 38, name: "Sam Ortiz", email: "sam@example.com", phone: "07700 900789", dial: "+447700900789", subject: "Podcast setup", details: "Do you record podcasts with video?", status: "done", consent_at: iso(5000), created_at: iso(5000), do_not_contact_at: iso(3000), do_not_contact_by: "customer", assigned_to: "s2" },
    { id: 37, name: "Free Followers", email: "promo@example.com", subject: "Grow your plays", details: "Buy 10,000 plays now! http://spam.example/offer", status: "spam", spam_reason: "Looks like an advert (a link and selling words)", created_at: iso(800) },
    { id: 44, name: "Riley Chen", email: "riley@example.com", phone: "07700 900321", dial: "+447700900321", subject: "Voiceover session", details: "Need a two hour voiceover booking for an advert.", status: "open", consent_at: iso(200), consent_source: "Asked on the phone", created_at: iso(200), assigned_to: "s2" },
  ];
  let mid = 600;
  const threads = {
    41: [
      { id: 501, direction: "note", channel: "email", body: "Asked NovaBot about weekend availability first.", status: null, created_by: "customer", created_at: iso(41) },
      { id: 502, direction: "out", channel: "email", status: "draft", created_by: "agent", body: "Hi Maya, thanks for getting in touch! We have Saturday the 14th and Sunday the 22nd free for a full vocal day. Shall I hold one for you? Book here: https://novacane.example/book?type=1", created_at: iso(30) },
    ],
    39: [
      { id: 480, direction: "out", channel: "email", status: "sent", created_by: "staff", author_name: "Jordan", body: "Hi! Friday evenings are free from 6pm. £25 an hour, with the backline included.", created_at: iso(1000), sent_at: iso(1000) },
      { id: 481, direction: "out", channel: "whatsapp", status: "sent", created_by: "staff", author_name: "Jordan", body: "See you Friday at 6!", created_at: iso(950), sent_at: iso(950) },
      { id: 482, direction: "note", channel: "email", status: null, created_by: "staff", author_name: "Ava", body: "Phone call: Spoke to them\nThey'll bring their own drums.", created_at: iso(900) },
      { id: 483, direction: "out", channel: "email", status: "failed", created_by: "staff", author_name: "Jordan", error: "The mail server said the address bounced", body: "Here's the invoice for Friday.", created_at: iso(880) },
    ],
    44: [{ id: 520, direction: "out", channel: "email", status: "draft", created_by: "agent", body: "Hi Riley, a two hour voiceover is £80. Tuesday or Thursday work?", created_at: iso(150) }],
  };
  const counted = () => {
    const c = { new: 0, open: 0, replied: 0, done: 0, spam: 0 };
    for (const e of enquiries) c[e.status] = (c[e.status] || 0) + 1;
    return c;
  };
  const listed = (e) => {
    const t = threads[e.id] || [];
    return { ...e, assigned_name: nameOf(e.assigned_to), drafts: t.filter((m) => m.status === "draft").length, replies: t.filter((m) => m.status === "sent").length, failed: t.filter((m) => m.status === "failed").length, last_activity: t.length ? t[t.length - 1].created_at : e.created_at };
  };
  const saved = [{ id: 1, title: "Prices", body: "Hi {name}, our rates are £40 an hour, or £280 for a full day." }, { id: 2, title: "Directions", body: "Hi {name}, we're at the back of the arches: ring the bell marked Studio." }];
  const chats = {
    "chat-maya": { messages: [{ role: "user", content: "Hi, do you do vocal days at weekends?", created_at: iso(70), page: "/vocals" }, { role: "assistant", content: "We do! You can see free days at https://novacane.example/book?type=1 or I can pass an enquiry to the team.", created_at: iso(69) }, { role: "user", content: "Please pass it on, thanks", created_at: iso(68), page: "/vocals" }, { role: "note", content: "Maya left an enquiry", created_at: iso(67) }], live: { mode: "bot" }, ticket: null },
    "chat-pod": { messages: [{ role: "user", content: "Can I hire the booth for a podcast tomorrow?", created_at: iso(20), page: "/podcasts" }, { role: "assistant", content: "Let me get someone from the studio to help with that.", created_at: iso(19) }], live: { mode: "bot" }, ticket: { state: "needs-person", assigned_to: "s2", assigned_name: "Ava" } },
  };
  const convoList = () => Object.entries(chats).map(([id, c]) => ({ chat_id: id, started: c.messages[0].created_at, last: c.messages[c.messages.length - 1].created_at, messages: Math.ceil(c.messages.length / 2), first_question: (c.messages.find((m) => m.role === "user") || {}).content, enquiries: enquiries.filter((e) => e.chat_id === id).length, ticket: c.ticket ? c.ticket.state : null, assigned_name: c.ticket ? c.ticket.assigned_name : null, live: c.live.mode, live_name: c.live.mode === "staff" ? c.live.staffName : null }));
  let alerts = [
    { id: 15, kind: "test", title: "Test notification", body: "If you can read this, notifications work.", url: "/portal/", phones: 2, created_at: iso(5), contact: {}, email: null, appointmentId: null },
    { id: 14, kind: "enquiry", title: "New enquiry from Maya Rose", body: "Booking a vocal day\nHi! I'd love to book a full vocal day next month.", url: "/portal/", phones: 2, created_at: iso(42), contact: { name: "Maya Rose", email: "maya@example.com", phone: "07700 900123" }, email: null, appointmentId: null },
    { id: 13, kind: "booking", title: "New booking: Kai Bennett", body: "Mixing session\nThu 2pm–5pm\nkai@example.com", url: "https://secure.acuityscheduling.com/appointments.php?id=9001", phones: 2, created_at: iso(120), contact: { name: "Kai Bennett", email: "kai@example.com", phone: "0161 496 0000" }, email: { source: "email", kind: "rescheduled", at: iso(100), lines: ["Mixing session", "Fri 11am–2pm", "kai@example.com"], same: false, gmail: "https://mail.google.com/mail/u/0/#inbox/abc" }, appointmentId: 9001 },
    { id: 12, kind: "nova-booking", title: "NovaBot booked: Riley Chen", body: "Voiceover · Tue 10:00", url: "https://calendar.google.com/calendar/event?eid=abc", phones: 1, created_at: iso(400), contact: { name: "Riley Chen", email: "riley@example.com" }, email: { source: "booking", at: iso(390), lines: ["Voiceover · Tue 10:00"], same: true }, appointmentId: "n77" },
    { id: 11, kind: "quest", title: "Quest: Finish the Lowlands mix notes", body: "Starting in 10 minutes", url: "/portal/#nova", phones: 1, created_at: iso(600), contact: {}, email: null, appointmentId: null },
    { id: 10, kind: "other", title: "Invoice NS-0031 to approve", body: "Kai Bennett · £120.00", url: "/invoicer/?invoice=31", phones: 2, created_at: iso(900), contact: {}, email: null, appointmentId: null },
    { id: 9, kind: "health", title: "Nova Bot can't reach Acuity", body: "Bookings may not show for a while.", url: "/portal/", phones: 2, created_at: iso(3000), contact: {}, email: null, appointmentId: null },
  ];
  let autoDays = 7;
  const actions = [
    { id: 7, kind: "reschedule", status: "pending", summary: "Move Kai Bennett's mixing session from Thu 14:00 to Fri 11:00 (Acuity emails them)", payload: { appointmentId: 9001, start: ahead(2, 11), notifyClient: true }, reason: "Kai asked to move it in their reply", proposedBy: "agent", createdAt: iso(60) },
    { id: 8, kind: "create", status: "pending", summary: "Book Maya Rose (maya@example.com) for Vocal day on Sat 14 Nov 10:00 (Acuity emails the client)", payload: { start: ahead(9, 10), firstName: "Maya", lastName: "Rose", email: "maya@example.com", phone: "07700 900123", notes: "Three songs", notifyClient: true }, reason: "", proposedBy: "staff-chat", createdAt: iso(30) },
    { id: 9, kind: "block_add", status: "pending", summary: "Block off Mon 09:00–13:00 in Studio A (\"Piano tuning\")", payload: { start: ahead(5, 9), end: ahead(5, 13), notes: "Piano tuning" }, reason: "", proposedBy: "agent", createdAt: iso(20) },
    { id: 5, kind: "cancel", status: "executed", summary: "Cancel Sam Ortiz's podcast on Wed 15:00", payload: {}, proposedBy: "agent", createdAt: iso(3000), decidedByName: "Jordan", decidedAt: iso(2900), executedAt: iso(2899), result: { note: "Queued for Nova Agent: it makes the change on Acuity's pages within a few minutes." } },
    { id: 4, kind: "update", status: "failed", summary: "Change Riley Chen's phone number", payload: {}, proposedBy: "agent", createdAt: iso(4000), decidedByName: "Ava", decidedAt: iso(3990), error: "Acuity said the booking is locked." },
    { id: 3, kind: "block_remove", status: "rejected", summary: "Remove the blocked-off time Sat 10:00–12:00", payload: {}, proposedBy: "agent", createdAt: iso(5000), decidedByName: "Jordan", decidedAt: iso(4990) },
  ];
  const find = (id) => enquiries.find((e) => e.id === Number(id));
  const add = (id, m) => { (threads[id] = threads[id] || []).push({ id: ++mid, created_at: iso(0), author_name: me.name, created_by: "staff", ...m }); return threads[id][threads[id].length - 1]; };

  // (first in the list: Inbox's answers for its own addresses win over the base and other samples)
  (window.NovaSampleExtra = window.NovaSampleExtra || []).unshift((u, method, body) => {
    const p = u.pathname;
    if (!p.startsWith("/app/api/")) return undefined;
    const r = p.slice(9);
    if (method === "GET") {
      if (r === "enquiries") {
        const box = u.searchParams.get("box"), all = u.searchParams.get("show") === "all", q = (u.searchParams.get("q") || "").toLowerCase();
        let rows = enquiries.filter((e) => (all ? e.status !== "spam" || box === "spam" : e.status === (box || "new")));
        if (q) rows = enquiries.filter((e) => [e.name, e.email, e.details, e.subject, e.label].join(" ").toLowerCase().includes(q));
        const c = counted();
        return { enquiries: rows.sort((a, b) => b.id - a.id).map(listed), newCount: c.new + c.open, counts: c, team, labels };
      }
      if (r === "enquiries/thread") {
        const e = find(u.searchParams.get("id"));
        if (!e) return { status: 404, body: { error: "That enquiry doesn't exist." } };
        // (Riley's is opened by an app's sign-in in the preview, to show "this sign-in can't send")
        const app = e.id === 44;
        return { enquiry: { ...e, mobile: e.dial, assigned_name: nameOf(e.assigned_to) }, messages: (threads[e.id] || []).filter((m) => m.status !== "discarded"), team, canSend: !app, onlineUrl: `https://novacane.example/portal/?view=enquiries&enquiry=${e.id}` };
      }
      if (r === "inbox/saved") return { saved };
      if (r === "sessions") return { sessions: [{ id: 1, name: "Vocal session", price: "£40/h" }, { id: 2, name: "Mixing, per song", price: "£150" }, { id: 3, name: "Rehearsal room", price: "£25/h" }] };
      if (r === "conversations") {
        const id = u.searchParams.get("chat");
        if (id) { const c = chats[id]; return c ? { messages: c.messages, live: c.live, ticket: c.ticket } : { messages: [], live: { mode: "bot" }, ticket: null }; }
        const all = convoList();
        return { conversations: all, needsPerson: all.filter((c) => c.ticket === "needs-person").length };
      }
      if (r === "notifications") return { notifications: alerts, autoDeleteDays: autoDays, choices: [1, 3, 7, 14, 30] };
      if (r === "verify-booking") return { status: "real", title: "Real booking: confirmed in Acuity", lines: [`Acuity #${u.searchParams.get("id")} · Studio A`, "Kai Bennett · kai@example.com", "Mixing session · Fri 6 Nov, 11:00", "Booked Mon 2 Nov, 20:14", "Deposit £40.00 of £150.00 paid"] };
      if (r === "booking-actions") return { actions: u.searchParams.get("status") === "all" ? actions : actions.filter((a) => a.status === "pending"), canDecide: true };
      if (r === "push/key") return { publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" };
      return undefined;
    }
    const b = body || {};
    const e = b.id !== undefined ? find(b.id) : null;
    if (r === "enquiries/reply") { if (!b.body) return { status: 400, body: { error: "Write something first." } }; const m = add(b.id, { direction: "out", channel: "email", status: "sent", body: b.body, sent_at: iso(0) }); if (e && ["new", "open"].includes(e.status)) e.status = "replied"; return { ok: true, message: m }; }
    if (r === "enquiries/note") return { ok: true, message: add(b.id, { direction: "note", channel: "email", status: null, body: b.body }) };
    if (r === "enquiries/logged") {
      if (!e || !e.dial) return { status: 409, body: { error: "This enquiry has no mobile number." } };
      if (b.kind === "call") return { ok: true, message: add(b.id, { direction: "note", channel: "email", status: null, body: `Phone call: ${{ spoke: "Spoke to them", voicemail: "Left a voicemail", "no-answer": "No answer" }[b.outcome]}${b.body ? `\n${b.body}` : ""}` }) };
      if (!b.body) return { status: 400, body: { error: "What did you send?" } };
      if (["new", "open"].includes(e.status)) e.status = "replied";
      return { ok: true, message: add(b.id, { direction: "out", channel: b.kind, status: "sent", body: b.body, sent_at: iso(0) }) };
    }
    const msg = b.messageId !== undefined ? Object.values(threads).flat().find((m) => m.id === Number(b.messageId)) : null;
    if (r === "enquiries/draft/edit") { msg.body = b.body; return { ok: true, message: msg }; }
    if (r === "enquiries/draft/approve") { if (!msg) return { status: 404, body: { error: "That draft doesn't exist." } }; Object.assign(msg, { body: b.body, status: "sent", sent_at: iso(0), approver_name: me.name }); return { ok: true, message: msg }; }
    if (r === "enquiries/draft/discard") { msg.status = "discarded"; return { ok: true }; }
    if (r === "enquiries/retry") { Object.assign(msg, { status: "sent", sent_at: iso(0), error: null }); return { ok: true, message: msg }; }
    if (r === "enquiries/contact") { if (e.do_not_contact_by === "customer") return { status: 409, body: { error: "They asked to stop themselves: that can't be undone here." } }; e.do_not_contact_at = b.doNotContact ? iso(0) : null; e.do_not_contact_by = b.doNotContact ? me.id : null; return { ok: true }; }
    if (r === "inbox/sort") {
      if (b.state) { e.status = b.state; e.spam_reason = b.state === "spam" ? e.spam_reason : null; }
      if (b.assignedTo !== undefined) e.assigned_to = b.assignedTo === "me" ? me.id : b.assignedTo || null;
      if (b.label !== undefined) { e.label = b.label || null; if (b.label && !labels.includes(b.label)) labels = [b.label, ...labels]; }
      return { ok: true, enquiry: { id: e.id, status: e.status, assigned_to: e.assigned_to, label: e.label } };
    }
    if (r === "inbox/chat") { const c = chats[b.chatId]; c.ticket = b.state ? { state: b.state, assigned_to: b.assignedTo === "me" ? me.id : c.ticket?.assigned_to || null, assigned_name: b.assignedTo === "me" ? me.name : c.ticket?.assigned_name || null } : null; return { ok: true, ticket: c.ticket }; }
    if (r === "inbox/saved") { if (b.id) Object.assign(saved.find((x) => x.id === b.id), { title: b.title, body: b.body }); else saved.push({ id: saved.length + 10, title: b.title, body: b.body }); return { ok: true, saved }; }
    if (r === "inbox/saved/remove") { saved.splice(saved.findIndex((x) => x.id === b.id), 1); return { ok: true, saved }; }
    if (r === "booking-link") return { url: `https://novacane.example/book?type=${b.typeId}&for=${b.enquiryId}`, session: ["", "Vocal session", "Mixing, per song", "Rehearsal room"][b.typeId] || "Session" };
    if (r === "conversations/live") {
      const c = chats[b.chatId];
      if (b.action === "takeover") c.live = { mode: "staff", staffName: me.name };
      if (b.action === "handback") { c.live = { mode: "bot" }; c.messages.push({ role: "note", content: "Jordan handed the chat back to NovaBot", created_at: iso(0) }); }
      if (b.action === "reply") { c.live = { mode: "staff", staffName: me.name }; c.messages.push({ role: "staff", sender: me.name, content: b.text, created_at: iso(0) }); }
      return { ok: true, live: c.live };
    }
    if (r === "notifications/delete") { alerts = b.all === true ? [] : alerts.filter((n) => n.id !== b.id); return { ok: true }; }
    if (r === "notifications/settings") { if (b.days !== 0 && ![1, 3, 7, 14, 30].includes(b.days)) return { status: 400, body: { error: "Bad request" } }; autoDays = b.days; return { ok: true, autoDeleteDays: autoDays }; }
    if (r === "push/test") return { ok: true, delivered: 2 };
    if (r === "push/subscribe" || r === "push/unsubscribe") return { ok: true };
    const act = b.id !== undefined ? actions.find((a) => String(a.id) === String(b.id)) : null;
    if (r === "booking-actions/edit") { act.payload = b.payload; return { ok: true, action: act }; }
    if (r === "booking-actions/approve") {
      if (b.payload) act.payload = b.payload;
      // (the block-off time "fails" in the preview, to show what a refusal looks like)
      Object.assign(act, act.kind === "block_add" ? { status: "failed", error: "Acuity says that time overlaps a booking." } : { status: "executed", executedAt: iso(0) }, { decidedByName: me.name, decidedAt: iso(0) });
      return { ok: true, action: act };
    }
    if (r === "booking-actions/reject") { Object.assign(act, { status: "rejected", decidedByName: me.name, decidedAt: iso(0) }); return { ok: true, action: act }; }
    return undefined;
  });
})();
