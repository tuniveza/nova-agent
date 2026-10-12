// Sample answers for Portal in scripts/check-fit.mjs (there is no Nova Bot on a throwaway server).
// Mock JSON bodies for Portal (web/portal/app.js, portal.js, suite.js, shared/badge.js),
// shaped exactly as the render code reads them, with deliberately LONG content for layout testing.
// portalMock(pathWithQuery, method) -> object | { ok: true } (POST etc.) | null (unknown)
// Accepts "enquiries?show=all" (app.js api() form), "/app/api/enquiries", "/auth/me", "/staff/<id>" ...

const LONGWORD = "Averyveryverylongwordwithoutanyspacesatall_0123456789abcdefghijklmnop";
const LONGWORD2 = "Supercalifragilisticexpialidocious_AntidisestablishmentarianismPneumonoultramicroscopic_9876543210";
const LONG_URL = "https://www.example-recording-studio-with-a-very-long-domain-name.co.uk/booking/sessions/vocal-recording-and-mixing-package/deluxe?utm_source=instagram&utm_medium=story&utm_campaign=autumn_2026_promo_" + LONGWORD;
const LONG_EMAIL = "maximilian.alexander.featherstonehaugh-montgomery.the.third@an-extremely-long-email-domain-for-testing-purposes.co.uk";
const ME_ID = "staff_7f3c2a9e1b4d4e8fa0c5d6b7e8f90123";
const ME_NAME = "Bartholomew Maximilian Featherstonehaugh-Worthington-Smythe the Third of Novacane";

const iso = (day, h, m = 0) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const feed = (day, h, m = 0) => `202610${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}00Z`;
const local = (day, h, m = 0) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const PEOPLE = [
  { name: "Alexandria Constantina Papadopoulou-Richardson-Montgomery-Vanderbilt", email: LONG_EMAIL, phone: "+44 7700 900123", dial: "+447700900123" },
  { name: "Jean-Baptiste Emmanuel Zorg de la Fontaine-Beauchamp", email: "jb.zorg@" + "verylongsubdomain.another-long-subdomain.example-company-name.com", phone: "020 7946 0018", dial: null },
  { name: LONGWORD, email: LONGWORD.toLowerCase() + "@example.com", phone: "+44 7700 900456", dial: "+447700900456" },
  { name: "Eric", email: "eric@example.com", phone: "07700 900789", dial: "+447700900789" },
  { name: "Oluwaseun Adebayo-Okonkwo-Chukwuemeka-Nwachukwu-Abiodun", email: "seun.adebayo.okonkwo.chukwuemeka@studio-bookings-international.org", phone: "+44 7700 900321", dial: "+447700900321" },
  { name: "Siobhán Ní Mhaolchatha-O'Shaughnessy-Fitzgerald-MacGillycuddy", email: "siobhan.nimhaolchatha@example.ie", phone: "", dial: null },
  { name: "Wolfgang Amadeus Hubert Blaine Wolfeschlegelsteinhausenbergerdorff Sr.", email: "wolfeschlegelsteinhausenbergerdorff@example.de", phone: "+49 30 901820", dial: null },
  { name: "Priya Lakshmi Venkataraghavan-Subramanian-Krishnamurthy", email: "priya.venkataraghavan.subramanian@a-really-long-company-name-limited.co.uk", phone: "+44 7700 900654", dial: "+447700900654" },
  { name: "Zoë Ångström-Ølstad-Ĳsselmeer-Çelik-Żółć", email: "zoe.angstrom@example.no", phone: "+47 22 00 00 00", dial: null },
  { name: "Mohammed bin Abdulrahman bin Abdulaziz Al-Hashimi Al-Qurashi", email: "m.alhashimi@example.ae", phone: "+44 7700 900987", dial: "+447700900987" },
  { name: "Tamsin Rosalind Penhaligon-Trelawney-Carthew-Boscawen-Polwhele", email: "tamsin@" + LONGWORD.toLowerCase() + ".co.uk", phone: "07700 900111", dial: "+447700900111" },
  { name: "DJ " + LONGWORD2, email: "dj.booking.enquiries.and.management.team@record-label-with-long-name.com", phone: "+44 7700 900222", dial: "+447700900222" },
];

const PARA = (n) =>
  [
    "Hi there! I've been following the studio on SoundCloud and Instagram for ages and I'm finally ready to book a proper session. I'm working on a six-track EP that blends neo-soul with drill and some ambient textures, and I'd love to record vocals, layer harmonies and get it mixed and mastered properly before the end of November.",
    "Could you tell me what packages you have, whether you can do evenings (I work until 6pm most days), and whether the deposit is refundable if I need to move the date? Also, do you provide an engineer who can help with vocal comping and tuning, or should I bring my own? Here's my reference playlist: " + LONG_URL,
    "One more thing: my artist name is " + LONGWORD + " and my manager's email is " + LONG_EMAIL + " in case you need to send the invoice there instead of to me. Thank you so much, really looking forward to hearing back!",
    "P.S. I also have a long list of questions about stems, file formats (WAV 24-bit/96kHz vs 32-bit float), whether you keep a backup of the session files after the booking and for how long, and whether I can bring two friends to sit in on the session as long as they're quiet. " + LONGWORD2,
  ]
    .slice(0, n)
    .join("\n\n");

const SUBJECTS = [
  "Booking enquiry for a full-day vocal recording, mixing and mastering package for a six-track EP before the end of November 2026",
  "Rates?",
  LONGWORD,
  "Podcast recording — weekly, 2 hosts + 1 remote guest — need quote for 12 weeks including editing and loudness normalisation to -16 LUFS",
  "Re: Re: Re: Fwd: Re: Question about the deposit and refund policy when moving a session at short notice because of illness",
  "Choir rehearsal recording (24 voices) in the live room — is there space? Also do you have enough microphones for a spaced pair plus spot mics?",
  "Hello",
  "Mixing only: 14 stems per track × 9 tracks, delivered as " + LONGWORD2,
  "Gift voucher for my partner's birthday (she's a singer-songwriter) — can it be used any time in 2027?",
  "Drum tracking day with a full kit, overheads, room mics and re-amping guitars in the afternoon",
  "Urgent: lost my session files from 3 weeks ago, do you keep backups?",
  "Collaboration / sync licensing opportunity for a TV advert campaign — brief attached via link " + LONG_URL,
];
const STATUSES = ["new", "new", "replied", "new", "done", "new", "replied", "new", "done", "new", "replied", "new"];

const ENQUIRIES = PEOPLE.map((p, i) => ({
  id: 101 + i,
  subject: SUBJECTS[i],
  status: STATUSES[i],
  name: p.name,
  email: p.email,
  phone: p.phone,
  dial: p.dial,
  details: PARA(1 + (i % 4)),
  page: i % 3 === 0 ? LONG_URL : i % 3 === 1 ? "/booking" : "/",
  emailed: i % 2 === 0,
  replies: STATUSES[i] === "replied" ? (i % 3) + 1 : 0,
  drafts: i === 0 ? 1 : i === 3 ? 2 : 0,
  failed: i === 5 ? 1 : 0,
  chat_id: "chat_" + (9001 + i) + "_" + LONGWORD.slice(0, 20),
  created_at: iso(11 - (i % 6), 9 + i, (i * 7) % 60),
  consent_at: iso(11 - (i % 6), 9 + i, (i * 7) % 60),
  consent_source: i % 2 ? "Ticked 'Contact me about this enquiry' in NovaBot's chat on " + LONG_URL : "Asked NovaBot to send the enquiry",
  do_not_contact_at: i === 7 ? iso(10, 14) : null,
  do_not_contact_by: i === 7 ? "customer" : null,
}));

function enquiriesBody(query) {
  const all = query.get("show") === "all";
  const list = all ? ENQUIRIES : ENQUIRIES.filter((q) => q.status === "new");
  return { enquiries: list, newCount: ENQUIRIES.filter((q) => q.status === "new").length };
}

function threadBody(id) {
  const q = ENQUIRIES.find((e) => e.id === id) || ENQUIRIES[0];
  const enquiry = { ...q, details: PARA(4) };
  const staff = ME_NAME;
  const msgs = [
    { direction: "note", created_by: "customer", status: "sent", channel: "email", body: "NovaBot: the customer said they're flexible on dates but prefers weekday evenings after 18:30, and mentioned a budget of around £450–£600 for the whole EP. They also asked twice about " + LONGWORD + "." },
    { direction: "out", created_by: "staff", status: "sent", channel: "email", body: "Hi " + q.name.split(/\s+/)[0] + ",\n\nThanks so much for getting in touch, and congratulations on the EP! We'd love to help.\n\nFor six tracks with vocals, harmonies and a full mix and master, most artists book our Deluxe package (two 6-hour days plus mix and master). Evenings are no problem: we're open until 11pm, seven days a week.\n\nThe deposit is fully refundable up to 72 hours before the session, and you can move the date once for free.\n\nHere's the booking page with all the packages: " + LONG_URL + "\n\nBest wishes,\n" + staff },
    { direction: "note", created_by: "staff", status: "sent", channel: "email", body: "Phone call: Rang them at 14:05, no answer, left a voicemail about the evening slots on Thursday 22 October and the deposit policy. Will try again tomorrow morning. " + LONGWORD2 },
    { direction: "out", created_by: "staff", status: "sent", channel: "whatsapp", body: "Hi! Just following up on the voicemail 🙂 We have Thu 22 Oct 18:30–23:00 free if that suits. " + LONG_URL },
    { direction: "out", created_by: "staff", status: "sent", channel: "sms", body: "Quick reminder: the 22 Oct evening slot is held for you until Friday. Reply YES to confirm." },
    { direction: "out", created_by: "staff", status: "failed", channel: "email", error: "Resend said the address " + LONG_EMAIL + " bounced (mailbox full or doesn't exist): 550 5.1.1 " + LONGWORD, body: "Hi again, just checking you got our last message about the evening session." },
    { direction: "out", created_by: "staff", status: "approved", channel: "email", stuck: true, body: "Sending you the invoice for the deposit now (£150). " + LONGWORD },
    { direction: "note", created_by: "staff", status: "sent", channel: "email", body: "Internal note: they're the cousin of a regular client (see Clients). Offer the returning-client 10% discount if they ask.\n\nAlso flagged: they want two friends in the control room. That's fine for the Deluxe room (capacity 6) but not the vocal booth sessions." },
    { direction: "out", created_by: "agent", status: "draft", channel: "email", body: "Hi " + q.name.split(/\s+/)[0] + ",\n\nGreat news: Thursday 22 October from 18:30 to 23:00 is confirmed and pencilled in for you.\n\nTo lock it in, please pay the £150 deposit here: " + LONG_URL + "\n\nA few things to bring:\n• Your reference tracks (WAV or high-quality MP3)\n• Lyrics, printed or on your phone\n• Water and something to snack on — sessions can run long!\n\nAbout file formats: we record at 24-bit/96kHz and can deliver stems as 32-bit float WAVs if your mix engineer prefers. We keep a backup of every session for 12 months.\n\nYour two friends are welcome in the control room.\n\nSee you soon,\nNova Agent on behalf of the Novacane team\n\n" + LONGWORD2 },
    { direction: "out", created_by: "agent", status: "draft", channel: "email", body: "Short alternative draft: Thu 22 Oct 18:30–23:00 is yours. Deposit link: " + LONG_URL },
  ];
  const messages = msgs.map((m, i) => ({
    id: 5001 + i,
    author_name: m.created_by === "staff" ? (i % 2 ? staff : "Penelope Wigglesworth-Fanshawe-Cholmondeley") : null,
    approver_name: m.created_by === "agent" ? staff : null,
    created_at: iso(11, 8 + i, 15),
    updated_at: iso(11, 8 + i, 20),
    sent_at: m.status === "sent" ? iso(11, 8 + i, 16) : null,
    error: null,
    stuck: false,
    ...m,
  }));
  return { enquiry, messages, canSend: true, onlineUrl: "https://novacane.example/portal/?view=enquiries&enquiry=" + enquiry.id };
}

// ----- Conversations (NovaBot website chats) -----
const CONVERSATIONS = ENQUIRIES.slice(0, 12).map((q, i) => ({
  chat_id: q.chat_id,
  first_question: i === 2 ? LONGWORD + " " + LONGWORD2 : PARA(1).slice(0, 60 + i * 15) + (i % 2 ? " " + LONGWORD : ""),
  enquiries: i % 3 === 0 ? 1 : 0,
  started: iso(11 - (i % 4), 8 + i, 5),
  messages: 2 + i * 3,
}));
function conversationBody(chatId) {
  const msgs = [];
  for (let i = 0; i < 14; i++) {
    const user = i % 2 === 0;
    msgs.push({
      role: user ? "user" : "assistant",
      created_at: iso(11, 9, i * 3),
      page: i % 4 === 0 ? LONG_URL : i % 4 === 2 ? "/booking" : "",
      content: user
        ? [PARA(1), "What are your prices for " + LONGWORD + "?", PARA(2), "ok", "Can I book Thursday 22 October at 18:30?", PARA(3), "Thanks! " + LONGWORD2][i / 2]
        : [
            "Hi! I'm NovaBot, the studio's assistant. Happy to help with bookings, prices and anything else about Novacane.",
            "Our Deluxe package is £540 for two 6-hour days including mix and master. You can see everything here: " + LONG_URL + ". Hourly sessions start at £45/hour.",
            "We're open 10am to 11pm, seven days a week, so evening sessions are no problem at all.\n\nThe deposit is refundable up to 72 hours before your session.",
            "No worries! Is there anything else I can help with?",
            "Thursday 22 October at 18:30 looks free. Book here: https://novacane.as.me/schedule.php?appointmentType=12345678&date=2026-10-22&time=18:30 — or I can send your details to the team as an enquiry.",
            "I've sent your enquiry to the team. Someone will get back to you by email at " + LONG_EMAIL + " within a day.",
            "You're welcome! Have a lovely day ✦ " + LONGWORD,
          ][(i - 1) / 2],
    });
  }
  return { messages: msgs, chat: chatId };
}

// ----- Calendar (Acuity feed) -----
const SESSIONS_NAMES = [
  "Deluxe Vocal Recording, Comping, Tuning, Mixing and Mastering Package (two 6-hour days)",
  "Hourly studio hire",
  "Podcast recording + edit",
  LONGWORD,
  "Mix & master (per track)",
  "Drum tracking day",
];
const BOOKINGS = [];
for (let i = 0; i < 26; i++) {
  const day = 3 + (i % 22) - (i > 21 ? 0 : 0);
  const p = PEOPLE[i % PEOPLE.length];
  const h = 10 + ((i * 3) % 11);
  // several on today (11th), including a clash and a tight changeover
  const d = i < 5 ? 11 : day;
  const startH = i < 5 ? [10, 12, 12, 15, 18][i] : h;
  const startM = i < 5 ? [0, 0, 30, 0, 30][i] : (i * 15) % 60;
  const lenH = i < 5 ? [2, 2, 1, 3, 4][i] : 1 + (i % 4);
  BOOKINGS.push({
    start: feed(d, startH - 1, startM), // feed is UTC; UK is BST (+1) in October
    end: feed(d, Math.min(startH - 1 + lenH, 22), startM),
    name: p.name,
    session: SESSIONS_NAMES[i % SESSIONS_NAMES.length],
    price: ["£540.00", "£45.00", "£120.00", "£1,250.00", "£80.00", "£360.00"][i % 6],
    phone: p.phone,
    email: p.email,
    extra: [
      ["Artist name", i % 2 ? LONGWORD : "The Extraordinarily Long-Named Collective of Midnight Saxophonists"],
      ["What are you recording?", PARA(1)],
      ["Reference link", LONG_URL],
      ["Deposit", i % 3 ? "Paid" : "Not yet"],
    ].slice(0, 1 + (i % 4)),
    link: i % 4 === 0 ? "https://calendar.google.com/calendar/event?eid=" + LONGWORD : "",
  });
}

// ----- Approvals (booking-actions) -----
const KINDS = ["create", "reschedule", "cancel", "update", "block_add", "block_remove"];
const A_STATUS = ["pending", "pending", "pending", "pending", "pending", "pending", "executed", "failed", "rejected", "approved", "executed", "rejected"];
const ACTIONS = A_STATUS.map((status, i) => {
  const p = PEOPLE[i % PEOPLE.length];
  const kind = KINDS[i % KINDS.length];
  const first = p.name.split(/\s+/)[0];
  const last = p.name.split(/\s+/).slice(1).join(" ");
  return {
    id: "act_" + (7001 + i) + "_" + LONGWORD.slice(0, 12),
    kind,
    status,
    summary:
      {
        create: "New booking: " + p.name + "\n" + SESSIONS_NAMES[0] + "\nThursday, 22 October 2026, 18:30–23:00\nEmail: " + p.email + "\nPhone: " + (p.phone || "none") + "\nNotes: " + PARA(1),
        reschedule: "Move " + p.name + "'s Hourly studio hire\nWas: Tuesday, 13 October 2026, 14:00–16:00\nNow: Wednesday, 14 October 2026, 19:00–21:00",
        cancel: "Cancel " + p.name + "'s " + SESSIONS_NAMES[3] + "\nFriday, 16 October 2026, 10:00–12:00\nNote: " + LONGWORD2,
        update: "New details for " + p.name + "\nEmail: " + LONG_EMAIL + "\nPhone: +44 7700 900999\nNotes: Prefers the big live room; allergic to the studio cat " + LONGWORD,
        block_add: "Block off time: Saturday, 17 October 2026, 10:00–23:00\nNotes: Annual deep clean of the live room, acoustic panel replacement and re-cabling the patchbay (all 96 points). " + LONG_URL,
        block_remove: "Unblock time: Sunday, 18 October 2026, 12:00–18:00\nNotes: Maintenance finished early",
      }[kind],
    payload: {
      create: { start: iso(22, 17, 30), firstName: first, lastName: last, email: p.email, phone: p.phone, notes: PARA(2), notifyClient: true, typeId: 12345678 },
      reschedule: { id: 900001 + i, start: iso(14, 18), notifyClient: false },
      cancel: { id: 900001 + i, note: "Client asked to cancel because of illness. " + LONGWORD2, notifyClient: true },
      update: { id: 900001 + i, firstName: first, lastName: last, email: LONG_EMAIL, phone: "+44 7700 900999", notes: PARA(3) },
      block_add: { start: iso(17, 9), end: iso(17, 22), notes: "Annual deep clean " + LONGWORD },
      block_remove: { id: 880001 + i },
    }[kind],
    reason: i % 2 ? "The customer asked in the website chat (" + LONG_URL + ") and confirmed twice. " + PARA(1) : "Asked by " + ME_NAME + " in Nova Agent.",
    proposedBy: i % 3 === 0 ? "agent" : i % 3 === 1 ? "staff-chat" : "someone-with-a-very-long-unknown-proposer-identifier-" + LONGWORD,
    createdAt: iso(10 + (i % 2), 8 + i, 0),
    decidedAt: status === "pending" ? null : iso(11, 9 + i, 30),
    decidedByName: status === "pending" ? null : ME_NAME,
    executedAt: status === "executed" ? iso(11, 9 + i, 31) : null,
    error: status === "failed" ? "Acuity said the time is no longer available because another booking (" + LONGWORD + ") took it at the same moment." : null,
  };
});

// ----- Campaigns -----
const CAMPAIGN_BODY =
  "Hi {{first_name}},\n\nAutumn is here, and the studio has had a glow-up! ✦\n\nOver the summer we rebuilt the live room from the floor up: new acoustic treatment, a restored 1970s console, and a vocal booth so quiet you can hear your own heartbeat. We'd love for you to come and hear it.\n\nTo celebrate, every session booked before Sunday 1 November is 20% off, including our Deluxe Vocal Recording, Comping, Tuning, Mixing and Mastering Package. Use the code " +
  LONGWORD +
  " at checkout, or book straight from here: " +
  LONG_URL +
  "\n\nWhat's new:\n• Evening sessions now run until 11pm, seven days a week\n• Podcast packages with editing and loudness normalisation\n• Free reference-track listening session for first-timers\n\nWe also wanted to say a huge thank you to everyone who came to the open day in September. Seeing so many of you in the live room, singing along to the playback of " +
  LONGWORD2 +
  ", was the highlight of our year.\n\nSee you in the studio,\nThe Novacane team\n\nYou're getting this because you signed up as a fan or said yes to studio news. Unsubscribe any time with the link below.";
const C_STATUS = ["pending_approval", "draft", "pending_approval", "scheduled", "approved", "sent", "sent", "failed", "rejected", "sent", "rejected", "scheduled"];
const CAMPAIGNS = C_STATUS.map((status, i) => ({
  id: 301 + i,
  subject:
    i === 0
      ? "🍂 Autumn at Novacane: the brand-new live room, 20% off every session booked before 1 November, evening slots until 11pm, and a very special thank-you to everyone who came to the open day"
      : i === 2
        ? LONGWORD + LONGWORD2
        : ["Studio news", "", "", "October newsletter: new console, new booth, new you", "Last call for Halloween sessions 🎃", "September recap and photos from the open day", "Hi", "Black Friday early access for fans only — read this before Friday 27 November", "Gift vouchers are back for Christmas", "Podcast packages", "Re-engagement test " + LONGWORD][i - 1] || "Campaign " + i,
  body: i % 2 === 0 ? CAMPAIGN_BODY : CAMPAIGN_BODY.slice(0, 400),
  status,
  audience: ["fans", "clients", "everyone"][i % 3],
  createdBy: i % 2 ? "agent" : "staff-chat",
  createdAt: iso(1 + i, 10, 0),
  updatedAt: iso(5 + (i % 6), 12, i),
  sendAt: status === "scheduled" || i === 0 ? iso(16 + (i % 5), 17, 0) : null,
  sentAt: status === "sent" || status === "failed" ? iso(2 + i % 8, 18, 0) : null,
  recipients: status === "sent" ? 1234 + i * 111 : null,
  decidedByName: status === "pending_approval" || status === "draft" ? null : ME_NAME,
  decidedAt: status === "pending_approval" || status === "draft" ? null : iso(4 + (i % 6), 9, 0),
  note: status === "rejected" ? "Too long and the discount code doesn't exist. Please shorten the intro, fix " + LONGWORD + " and resend. " + PARA(1) : i === 0 ? "Drafted from Nova Agent's plan: " + LONG_URL : null,
  error: status === "failed" ? "Resend rejected the batch: domain " + LONGWORD + ".co.uk is not verified (403 validation_error)" : null,
  stats: status === "sent" ? { sent: 1234 + i * 111, delivered: 1200 + i * 100, opened: 640 + i * 10, clicked: 88 + i, unsubscribed: 3 + i, bounced: i % 2 ? 7 : 0, fetchedAt: iso(11, 8, 0) } : null,
}));
function campaignDetailBody(id) {
  const c = CAMPAIGNS.find((x) => x.id === id) || CAMPAIGNS[0];
  const log = ["created", "edited", "submitted", "approved", "scheduled", "sent", "stats", "edited", "rejected", "failed"].map((event, i) => ({
    at: iso(1 + i, 10 + i, 0),
    event,
    detail: i % 3 === 0 ? "by " + ME_NAME + " · " + LONGWORD : i % 3 === 1 ? "Subject and body changed" : "",
  }));
  // Even ids get an HTML preview (iframe to /app/api/campaigns/<id>/preview); odd ids fall back to the plain body
  const previewHtml = c.id % 2 === 0 ? "<!doctype html><html><body style='font-family:sans-serif'><h1>" + c.subject + "</h1><p>" + c.body.replace(/\n/g, "<br>") + "</p></body></html>" : "";
  return { campaign: c, previewHtml, log };
}

// ----- One-to-one emails (under Campaigns) -----
const O_STATUS = ["pending_approval", "pending_approval", "draft", "sent", "failed", "rejected", "approved"];
const OUTREACH = O_STATUS.map((status, i) => ({
  id: 501 + i,
  toName: i === 1 ? LONGWORD : "Sam " + ["Okafor", "Lee", "Patel", "Nguyen", "Brown", "Jones", "Smith"][i],
  toEmail: i === 0 ? "bookings." + LONGWORD.toLowerCase() + "@the-venue-with-a-very-long-name.co.uk" : "hello" + i + "@venue.co.uk",
  organisation: i === 2 ? LONGWORD2 : "The Windmill, Brixton",
  kind: ["business", "business", "client", "reply", "business", "client", "business"][i],
  clientId: i === 2 || i === 5 ? 11 : null,
  aboutBooking: i === 2,
  subject: i === 0 ? "A live session at The Windmill with three of our artists, plus a short film of the night for both of our socials and a write-up" : i === 1 ? LONGWORD + LONGWORD2 : "Live session idea " + i,
  body: "Hi Sam,\n\n" + PARA(2) + "\n\n" + LONG_URL + "\n\nNovacane Studios",
  status,
  createdBy: i % 2 ? "agent" : "tuniveza",
  createdByName: i % 2 ? "Nova Agent" : ME_NAME,
  createdAt: iso(2 + i, 9 + i, 0),
  updatedAt: iso(2 + i, 10 + i, 0),
  decidedByName: ["sent", "failed", "rejected", "approved"].includes(status) ? ME_NAME : null,
  decidedAt: ["sent", "failed", "rejected", "approved"].includes(status) ? iso(3 + i, 11, 0) : null,
  note: status === "rejected" ? "Not the right venue for this: " + LONGWORD : null,
  sentAt: status === "sent" ? iso(4 + i, 12, 0) : null,
  error: status === "failed" ? "Resend didn't send it: domain " + LONGWORD + ".co.uk is not verified" : null,
  portalUrl: "https://novacane.example/portal/?view=campaigns&outreach=" + (501 + i),
}));
function outreachDetailBody(id) {
  const o = OUTREACH.find((x) => x.id === id) || OUTREACH[0];
  const log = ["created", "submitted", "edited", "approved", "sent", "rejected", "failed"].map((event, i) => ({ at: iso(1 + i, 10 + i, 0), event, detail: i % 2 ? "Changed: subject, body · " + LONGWORD : "" }));
  return { outreach: o, log, email: o.body + "\n\n—\nNovacane Studios, Forest Hill, London\nWe're writing to " + o.organisation + " because we think it's relevant to your work.\nDon't want emails like this? Reply \"no thanks\", or use this link and we won't email you again: https://novacane.example/no-thanks?t=0123456789abcdef0123456789abcdef" };
}

// ----- Clients -----
const CLIENTS = PEOPLE.map((p, i) => ({
  id: 401 + i,
  name: p.name,
  email: p.email,
  phone: p.phone,
  source: ["booking", "enquiry", "import", "staff"][i % 4],
  consent: i % 3 === 0 ? { yes: true, at: iso(1 + i, 12), source: "Ticked on the booking form at " + LONG_URL } : { yes: false },
  outstanding: i % 4 === 1 ? (125.5 * (i + 1)).toFixed(2) : "0.00",
  depositsPaid: (50 * i).toFixed(2),
  invoiced: (300 + 75 * i).toFixed(2),
  sessionCount: i % 4 === 1 ? 0 : i * 2 + 1,
  lastBooked: i % 4 === 1 ? null : iso(1 + (i % 9), 14),
  nextBooked: i % 2 ? null : iso(22 + (i % 6), 17, 30),
  createdAt: "2025-0" + (1 + (i % 9)) + "-15T12:00:00.000Z",
  notes:
    i % 2
      ? "Prefers the big live room and evening sessions. Brings their own Neumann U87 and insists on it.\n\nAllergic to the studio cat (keep Biscuit out of the control room).\n\nOwes for the last two sessions — chased by email on 3 Oct and by phone on 9 Oct. " + LONGWORD
      : PARA(3),
}));
function clientsBody(query) {
  const filter = query.get("filter") || "all";
  const search = (query.get("search") || "").toLowerCase();
  let list = CLIENTS;
  if (filter === "owing") list = list.filter((c) => Number(c.outstanding) > 0);
  if (filter === "enquiry") list = list.filter((c) => c.source === "enquiry");
  if (filter === "lapsed") list = list.filter((c) => !c.nextBooked);
  if (search) list = list.filter((c) => (c.name + c.email + c.phone).toLowerCase().includes(search));
  return { clients: list, total: list.length + (filter === "all" && !search ? 237 : 0) };
}
function clientBody(id) {
  const client = CLIENTS.find((c) => c.id === id) || CLIENTS[0];
  const sessions = Array.from({ length: 12 }, (_, i) => ({
    start: i < 3 ? iso(20 + i * 3, 17, 30) : "2026-0" + (1 + (i % 9)) + "-1" + (i % 9) + "T13:00:00.000Z",
    session: SESSIONS_NAMES[i % SESSIONS_NAMES.length],
    price: i % 5 === 4 ? "Free (" + LONGWORD + ")" : (45 * (i + 1)).toFixed(2),
    source: ["feed", "webhook", "import"][i % 3],
    status: i % 4 === 3 ? "cancelled" : "booked",
  }));
  const consentLog = Array.from({ length: 8 }, (_, i) => ({
    consent: i % 2 ? 0 : 1,
    at: "2026-0" + (1 + i) + "-0" + (1 + i) + "T12:00:00.000Z",
    recorded_at: "2026-0" + (1 + i) + "-0" + (2 + i) + "T12:00:00.000Z",
    source: i % 2 ? "Switched off in Portal" : "Said yes in person, recorded by " + ME_NAME + " after a long chat about " + LONGWORD,
    byName: i % 3 === 2 ? null : ME_NAME,
    by: i % 3 === 2 ? (i % 2 ? "customer" : "import") : ME_ID,
  }));
  return { client, sessions, consentLog };
}

// ----- Quests (Nova Agent's plan) -----
const MISSIONS = [
  { id: "m1", title: "Finish the EP '" + LONGWORD + "' by 1 December, including artwork, mastering and distribution", summary: PARA(1), status: "active", deadline: "2026-12-01T18:00", progress: { done: 7, total: 19, atRisk: 2, minutesLeft: 1830 } },
  { id: "m2", title: "Studio rebuild", summary: "New panels, console restore, re-cable the patchbay", status: "paused", deadline: "2026-11-15T12:00", progress: { done: 3, total: 8, atRisk: 0, minutesLeft: 600 } },
  { id: "m3", title: "Autumn marketing push for the brand-new live room and the evening-session offer", summary: LONGWORD2, status: "done", deadline: null, progress: { done: 9, total: 9, atRisk: 0, minutesLeft: 0 } },
  { id: "m4", title: "Learn " + LONGWORD, summary: "", status: "active", deadline: "2027-01-31T09:00", progress: { done: 0, total: 0, atRisk: 0, minutesLeft: 0 } },
];
const MODES = ["waiting", "soon", "working", "nearly", "longer", "questions", "done"];
const QUESTS = Array.from({ length: 15 }, (_, i) => {
  const day = 11 + Math.floor(i / 4);
  const startH = 9 + (i % 4) * 3;
  const status = i === 0 ? "doing" : i < 3 ? "done" : i === 13 ? "skipped" : "todo";
  const planned = i < 12;
  return {
    id: "q" + (i + 1),
    title: [
      "Comp the lead vocals for track 3 ('" + LONGWORD + "') and send rough mix to the artist",
      "Email the mastering engineer",
      "Call Eric about Thursday",
      "Re-cable the patchbay rows 1–48 (inputs) and label every single cable with the new colour scheme agreed in the September meeting",
      LONGWORD2,
      "Order acoustic panels",
      "Write the autumn newsletter",
      "Back up session drives to the NAS and the off-site cloud bucket at " + LONG_URL,
      "Tune the piano",
      "Invoice the podcast client for 12 weeks",
      "Practise scales",
      "Sort the mic cupboard",
      "Draft the artwork brief",
      "Skipped thing that was skipped " + LONGWORD,
      "Read the manual for the new console (all 412 pages)",
    ][i],
    status,
    mode: status === "done" ? "done" : MODES[i % MODES.length] === "done" ? "waiting" : MODES[i % MODES.length],
    missionId: MISSIONS[i % MISSIONS.length].id,
    from: i % 3 === 0 ? "Notes: 'Studio to-do list for the week of " + LONGWORD + "'" : null,
    atRisk: i % 5 === 3,
    start: planned ? local(day, startH, (i * 5) % 60) : null,
    end: planned ? local(day, startH + 2, (i * 5) % 60) : null,
    minutes: i === 10 ? 0.5 : 30 + i * 37,
    ongoing: i === 10,
    every: i === 10 ? "interval" : undefined,
    everyMinutes: i === 10 ? 2 : undefined,
    priority: ["high", "medium", "low", "urgent-and-important-" + LONGWORD.slice(0, 20)][i % 4],
    location: i % 4 === 2 ? "The Extraordinarily Long Studio Name, Unit 14B, Industrial Estate Road, " + LONGWORD : null,
    travelMinutes: i % 4 === 2 ? 35 : 0,
    travelStart: i % 4 === 2 && planned ? local(day, startH - 1, 25) : null,
    deadline: i % 3 === 1 ? local(30, 18) : null,
  };
});
function questsBody() {
  return {
    online: true,
    at: new Date(Date.now() - 3 * 60000).toISOString(),
    state: {
      now: local(11, 12),
      current: QUESTS[0],
      next: QUESTS.slice(3, 6),
      pulses: [
        { id: "p1", title: "Drink water and stretch your back " + LONGWORD, status: "todo", minutes: 0.5, ongoing: true, every: "interval", everyMinutes: 45, deadline: local(11, 22) },
        { id: "p2", title: "Check the enquiries inbox", status: "doing", minutes: 5, ongoing: true, every: "day" },
      ],
      missions: MISSIONS,
      quests: QUESTS,
      calendar: {
        notes: Array.from({ length: 8 }, (_, i) => ({ title: i === 0 ? LONGWORD : "Note card " + (i + 1) + ": soundcheck with the Extraordinarily Long-Named Collective", body: PARA(1 + (i % 3)), start: local(11 + i, 13 + (i % 5)), end: local(11 + i, 15 + (i % 5)) })),
        days: [
          { date: "2026-10-11", title: "Eric's birthday 🎂 — " + LONGWORD, info: "Get a card", location: "Studio", repeat: "yearly" },
          { date: "2026-10-23", title: "EP release day for '" + LONGWORD2 + "'", info: PARA(1), location: LONG_URL },
          { date: "2026-10-31", title: "Halloween party", info: "", location: "" },
        ],
      },
    },
  };
}

// ----- Alerts (notifications) -----
const A_KINDS = ["booking", "nova-booking", "enquiry", "quest", "mission", "agent", "health", "test", "other", "booking", "enquiry", "booking", "agent", "other"];
const NOTIFICATIONS = A_KINDS.map((kind, i) => {
  const p = PEOPLE[i % PEOPLE.length];
  const title =
    kind === "quest" ? "Quest: Comp the lead vocals for track 3 ('" + LONGWORD + "') — starts in 10 minutes"
    : kind === "mission" ? "Mission: Finish the EP by 1 December is at risk (2 quests behind)"
    : kind === "agent" ? "Nova Agent: " + (i % 2 ? "I drafted a reply to " + p.name + " — approve it in Enquiries" : LONGWORD2)
    : kind === "enquiry" ? "New enquiry from " + p.name
    : kind === "health" ? "Acuity connection: the calendar feed hasn't answered for 3 hours"
    : kind === "test" ? "Test notification"
    : kind === "other" ? "Something happened: " + LONGWORD
    : "New booking: " + p.name + " — " + SESSIONS_NAMES[i % SESSIONS_NAMES.length];
  return {
    id: 900 - i,
    kind,
    title,
    created_at: iso(11 - Math.floor(i / 3), 20 - i, (i * 13) % 60),
    body: SESSIONS_NAMES[i % SESSIONS_NAMES.length] + "\nThursday, 22 October 2026, 18:30–23:00\nName: " + p.name + "\nEmail: " + p.email + "\nPhone: " + (p.phone || "none") + "\nPrice: £540.00\nNotes: " + PARA(1) + "\n" + LONGWORD,
    phones: i % 4,
    appointmentId: kind === "booking" ? 1200000 + i : null,
    url: kind === "enquiry" ? "/portal/?view=enquiries" : kind === "nova-booking" ? "https://calendar.google.com/calendar/event?eid=" + LONGWORD : "https://secure.acuityscheduling.com/appointments.php?id=" + (1200000 + i),
    contact: { email: kind === "test" ? "" : p.email, phone: p.phone },
    email:
      kind === "booking"
        ? { kind: ["scheduled", "rescheduled", "canceled"][i % 3], source: ["email", "calendar", "booking"][i % 3], at: iso(11, 9, i), same: false, lines: ["Was: Tuesday, 13 October 2026, 14:00–16:00", "Now: Thursday, 22 October 2026, 18:30–23:00", "Paid: £150.00 deposit", "Notes: " + PARA(1)], gmail: "https://mail.google.com/mail/u/0/#inbox/" + LONGWORD }
        : null,
  };
});

// ----- You, the crew, services, links -----
const ME = {
  id: ME_ID,
  display_name: ME_NAME,
  email: "bartholomew.maximilian.featherstonehaugh.worthington.smythe@novacane-studio-with-a-long-domain.co.uk",
  role: "admin",
  status: "active",
  created_at: "2025-03-14T10:00:00.000Z",
  last_login_at: iso(11, 8, 2),
  planet_seed: ME_ID,
  index_partition: "staff/" + ME_ID + "/" + LONGWORD,
  planet: { glow: "#ff5fa8", name: "Planet " + LONGWORD, description: "A rose-gold gas giant with rings of frozen sound and seventeen moons, each named after a session that ran past midnight." },
};
const CREW = [
  ME,
  ...PEOPLE.slice(0, 10).map((p, i) => ({
    id: "staff_" + (1000 + i),
    display_name: p.name,
    email: p.email,
    role: i % 3 === 0 ? "admin" : "staff",
    status: ["active", "active", "invited", "disabled"][i % 4],
    created_at: "2026-0" + (1 + (i % 9)) + "-01T10:00:00.000Z",
    last_login_at: i % 4 === 2 ? null : iso(1 + i, 12),
    planet_seed: i % 2 ? "staff_" + (1000 + i) : "reroll-" + i,
    index_partition: "staff/staff_" + (1000 + i),
  })),
];
const SERVICES = [
  { id: "email", name: "Email to customers and fans", tech: "Resend", ready: true, detail: "Sends from hello@" + LONGWORD.toLowerCase() + ".co.uk. " + PARA(1), last: iso(11, 9), test: true },
  { id: "push", name: "Phone notifications", tech: "Web Push (VAPID)", ready: true, detail: "3 phones subscribed.", last: iso(11, 10) },
  { id: "acuity", name: "Bookings", tech: "Acuity Scheduling API + calendar feed", ready: "partly", detail: "The calendar feed works; the API key is missing, so approvals can't change bookings yet." },
  { id: "google", name: "Google Calendar, Gmail and Docs", tech: "Google OAuth", ready: false, detail: "Not connected yet." },
  { id: "ai", name: "Nova Agent and NovaBot", tech: "Claude", ready: true, detail: "Answers questions and drafts replies." },
  { id: "voice", name: "Voice", tech: "Speech to text " + LONGWORD, ready: "partly", detail: "" },
  { id: "storage", name: "Files and memory", tech: "SQLite + object storage", ready: true, detail: "Index has 12,345 memories." },
  { id: "mailerlite", name: "MailerLite (old newsletter list)", tech: "MailerLite", ready: false, detail: "Retired in favour of Resend campaigns." },
];
function linksBody() {
  const items = (n, g) =>
    Array.from({ length: n }, (_, i) => ({
      name: i === 0 ? "Portal " + LONGWORD : ["Agent", "Calendar", "Notes", "Index", "Website", "Booking page", "Admin", "Health check", "Webhook endpoint for Acuity"][i % 9] + " (" + g + ")",
      kind: ["live", "machine", "testing", "local", "planned"][i % 5],
      check: { state: ["up", "down", "unchecked"][i % 3], label: i % 3 === 1 ? "Down: 502 Bad Gateway after 30 s " + LONGWORD : undefined },
      note: i % 2 ? PARA(1) : "",
      url: i % 5 === 1 ? "/app/api/webhooks/acuity/" + LONGWORD : LONG_URL + "&i=" + i,
    }));
  return {
    checkedAt: iso(11, 9, 30),
    groups: [
      { title: "Live addresses", note: "Everything customers and the team use every day.", items: items(10, "live") },
      { title: "Testing and the studio computer " + LONGWORD, note: PARA(1), items: items(8, "test") },
    ],
    changelog: Array.from({ length: 10 }, (_, i) => ({
      date: "2026-10-" + String(11 - (i % 3)).padStart(2, "0"),
      app: ["Portal", "Calendar", "Notes", "Agent"][i % 4],
      size: ["major", "big", "small"][i % 3],
      title: i === 0 ? "Approvals for booking changes " + LONGWORD : "Change " + (i + 1) + ": smoother cards and longer names that wrap properly",
      what: PARA(1),
      why: "Long names were overflowing the cards on phones. " + LONGWORD2,
      benefit: "Everything fits, everywhere.",
    })),
    features: ["Portal", "Calendar", "Notes", "Agent", "Index"].map((app, j) => ({
      app,
      note: j === 0 ? PARA(1) : "",
      items: Array.from({ length: 8 }, (_, i) => ({ name: i === 0 ? LONGWORD : "Feature " + (i + 1) + " of " + app, detail: i % 2 ? PARA(1) : "Short detail." })),
    })),
  };
}

// ----- Router -----
export function portalMock(pathWithQuery, method = "GET") {
  let raw = String(pathWithQuery || "");
  try {
    if (/^https?:\/\//.test(raw)) {
      const u = new URL(raw);
      raw = u.pathname + u.search;
    }
  } catch (err) {}
  const qIndex = raw.indexOf("?");
  let path = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = new URLSearchParams(qIndex >= 0 ? raw.slice(qIndex + 1) : "");
  path = path.replace(/^\/app\/api\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  const m = String(method || "GET").toUpperCase();

  if (m !== "GET" && m !== "HEAD") {
    if (path === "chat") return { ok: true, reply: "Here's what I found:\n\n" + PARA(3) };
    if (path === "ask") return { ok: true, answer: "Eric's session is on Thursday 22 October at 18:30. " + PARA(2) };
    return { ok: true };
  }

  // Auth and the crew (portal.js / badge.js use absolute paths)
  if (path === "auth/me") return { staff: ME, via: "session", offline: false };
  if (path === "auth/status") return { setupNeeded: false };
  if (path === "auth/google-status") return { setUp: true, account: "studio.bookings.and.calendar.management@" + LONGWORD.toLowerCase() + ".co.uk" };
  if (path === "staff") return { staff: CREW };
  let hit = /^staff\/([^/]+)$/.exec(path);
  if (hit) return { staff: CREW.find((p) => p.id === decodeURIComponent(hit[1])) || CREW[1] };

  if (path === "services") return { services: SERVICES };
  if (path === "links") return linksBody();

  if (path === "enquiries") return enquiriesBody(query);
  if (path === "enquiries/thread") return threadBody(Number(query.get("id")) || ENQUIRIES[0].id);
  if (path === "conversations") return query.get("chat") ? conversationBody(query.get("chat")) : { conversations: CONVERSATIONS };
  if (path === "calendar") return { setUp: true, bookings: BOOKINGS };
  if (path === "sessions") return { sessions: SESSIONS_NAMES.map((name, i) => ({ id: 12345670 + i, name, price: ["£540.00", "£45.00", "£120.00", "£1,250.00", "£80.00", "£360.00"][i] })) };
  if (path === "booking-actions") return { actions: ACTIONS, canDecide: true };
  if (path === "campaigns") return { campaigns: CAMPAIGNS, canDecide: true, audiences: { fans: 1873, clients: 412, everyone: 2201 }, signupUrl: "https://novacane.example/fans/join?ref=" + LONGWORD + "&src=instagram-bio-link-autumn-2026" };
  if (path === "outreach") return { outreach: OUTREACH, canDecide: true, ready: true, optouts: 3, sentToday: 2, perDay: 40 };
  hit = /^outreach\/(\d+)$/.exec(path);
  if (hit) return outreachDetailBody(Number(hit[1]));
  hit = /^campaigns\/(\d+)$/.exec(path);
  if (hit) return campaignDetailBody(Number(hit[1]));
  if (path === "clients") return clientsBody(query);
  hit = /^clients\/(\d+)$/.exec(path);
  if (hit) return clientBody(Number(hit[1]));
  if (path === "quests") return questsBody();
  if (path === "notifications") return { notifications: NOTIFICATIONS, autoDeleteDays: 7, choices: [1, 3, 7, 14, 30, 90] };
  if (path === "verify-booking") {
    const id = Number(query.get("id")) || 0;
    const status = ["real", "cancelled", "missing"][id % 3];
    return { status, title: status === "real" ? "Real booking in Acuity" : status === "cancelled" ? "Cancelled in Acuity" : "Not found in Acuity", lines: ["Appointment #" + id, "Thursday, 22 October 2026, 18:30–23:00", "Booked by " + PEOPLE[0].name, "Paid: £150.00 of £540.00", "Notes: " + LONGWORD] };
  }
  if (path === "push/key") return { publicKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" };
  return null;
}
