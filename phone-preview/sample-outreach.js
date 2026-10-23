// The phone preview: Outreach's sample answers (Campaigns, One-to-one emails, Social, Funnel), made up (no real
// people), kept in memory so approving, rejecting, changing and adding work as they would live.
(() => {
  "use strict";
  const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const ahead = (mins) => new Date(Date.now() + mins * 60000).toISOString();
  const ukDay = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const pic = (a, b, word) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><text x="200" y="215" font-family="sans-serif" font-size="44" font-weight="700" text-anchor="middle" fill="#fff">${word}</text></svg>`)}`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const me = "Jordan Lee";
  let nextId = 100;

  // ---- Campaigns ----
  const audiences = { fans: 214, clients: 88, everyone: 280 };
  const campaigns = [
    { id: 5, subject: "Night Drive is out Friday", body: "Hi!\n\nOur new single **Night Drive** drops this Friday at midnight. It was recorded right here in Studio A.\n\nListen first: https://example.com/night-drive\n\nNovacane Studios", audience: "fans", status: "pending_approval", createdBy: "agent", createdAt: ago(90), updatedAt: ago(90), sendAt: null },
    { id: 6, subject: "Winter session prices", body: "Hi,\n\nOur winter rates are in: half days are £150 until January.\n\nNovacane Studios", audience: "clients", status: "scheduled", createdBy: "s1", createdAt: ago(3000), updatedAt: ago(2000), sendAt: ahead(60 * 30), decidedByName: me, decidedAt: ago(2000), recipients: 88 },
    { id: 4, subject: "October at the studio", body: "Hi,\n\nA busy October: three EPs mixed and a new vocal booth.\n\nNovacane Studios", audience: "everyone", status: "sent", createdBy: "agent", createdAt: ago(21000), updatedAt: ago(20000), sentAt: ago(20000), recipients: 276, decidedByName: me, decidedAt: ago(20100), stats: { sent: 276, unsubscribed: 3, failed: 2, skipped: 4, fetchedAt: ago(19900) } },
    { id: 3, subject: "Free mastering weekend!!!", body: "FREE mastering!!! Click now!!!", audience: "fans", status: "rejected", createdBy: "staff-chat", createdAt: ago(40000), updatedAt: ago(39000), decidedByName: me, decidedAt: ago(39000), note: "Too shouty: one clear offer, no capitals." },
    { id: 2, subject: "Summer open day", body: "Come and see the studio.", audience: "fans", status: "failed", createdBy: "s1", createdAt: ago(80000), updatedAt: ago(79000), error: "The mail server didn't answer" },
  ];
  const cLog = {
    4: [{ at: ago(21000), event: "created", byName: "Nova Agent" }, { at: ago(20100), event: "approved", byName: me }, { at: ago(20000), event: "sent", detail: "To 276 people" }, { at: ago(19900), event: "stats", detail: "3 unsubscribed" }],
    3: [{ at: ago(40000), event: "created" }, { at: ago(39000), event: "rejected", byName: me, detail: "Too shouty: one clear offer, no capitals." }],
    6: [{ at: ago(3000), event: "created", byName: me }, { at: ago(2000), event: "approved", byName: me }, { at: ago(2000), event: "scheduled" }],
  };
  const paragraphs = (t) => String(t || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const inline = (p) => esc(p).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#c2337a;">$1</a>').replace(/\n/g, "<br>");
  const why = { fans: "you signed up for news from Novacane Studios", clients: "you said yes to studio news when you booked", everyone: "you asked for news from Novacane Studios" };
  const previewHtml = (c) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.subject)}</title></head><body style="margin:0;padding:0;background:#f7f5f8;"><div style="max-width:560px;margin:0 auto;padding:28px 18px;font:16px/1.6 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#1d1820;"><div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600;color:#c2337a;margin:0 4px 16px;">Novacane Studios</div><div style="background:#ffffff;border-radius:16px;padding:26px 24px;">${paragraphs(c.body).map((p) => `<p style="margin:0 0 16px;">${inline(p)}</p>`).join("")}</div><p style="font-size:13px;line-height:1.5;color:#6b6270;margin:20px 4px 0;">You're getting this because ${why[c.audience] || why.fans}. Novacane Studios, London. Unsubscribe: <a href="#unsubscribe" style="color:#6b6270;">#unsubscribe</a></p></div></body></html>`;

  // ---- One-to-one ----
  const outreach = [
    { id: 2, subject: "Studio time for your choir?", body: "Hi Ellie,\n\nWe record choirs in our big live room, and winter concerts are our favourite. Could we send you a quote for recording yours?\n\nNovacane Studios", toName: "Ellie Parker", toEmail: "ellie@example.org", organisation: "Riverside Choir", kind: "business", status: "pending_approval", createdBy: "agent", createdByName: "Nova Agent", createdAt: ago(200), updatedAt: ago(200) },
    { id: 3, subject: "Your session on Saturday", body: "Hi Kai,\n\nJust checking you have everything for Saturday: bring your stems on a USB stick.\n\nNovacane Studios", toName: "Kai Bennett", toEmail: "kai@example.com", kind: "client", aboutBooking: true, status: "pending_approval", createdBy: "s2", createdByName: "Sam Okoro", createdAt: ago(60), updatedAt: ago(60) },
    { id: 1, subject: "Thanks for writing in", body: "Hi Ana,\n\nThanks for your message about podcast recording. Yes, the booth seats four.\n\nNovacane Studios", toName: "Ana", toEmail: "ana@example.net", kind: "reply", status: "sent", createdByName: me, createdAt: ago(5000), updatedAt: ago(4900), sentAt: ago(4900), decidedByName: me, decidedAt: ago(4900) },
    { id: 4, subject: "Partnership idea", body: "Hi,\n\nWould your shop stock our merch?\n\nNovacane Studios", toName: "", toEmail: "hello@example-shop.co.uk", organisation: "Example Shop", kind: "business", status: "rejected", createdByName: "Nova Agent", createdAt: ago(9000), updatedAt: ago(8800), decidedByName: me, decidedAt: ago(8800), note: "Not a good fit for the studio right now." },
    { id: 5, subject: "Mix notes", body: "Hi Leo,\n\nHere are the mix notes.\n\nNovacane Studios", toName: "Leo", toEmail: "leo@example.com", kind: "client", aboutBooking: true, status: "failed", createdByName: me, createdAt: ago(12000), updatedAt: ago(11900), error: "Their mail server said the address doesn't exist" },
  ];
  const oLog = { 1: [{ at: ago(5000), event: "created", byName: me }, { at: ago(4900), event: "approved", byName: me }, { at: ago(4900), event: "sent" }], 4: [{ at: ago(9000), event: "created", byName: "Nova Agent" }, { at: ago(8800), event: "rejected", byName: me, detail: "Not a good fit for the studio right now." }] };
  const oWhy = { business: "we think Novacane Studios could help with your work", client: "you're booked with Novacane Studios", reply: "you wrote to Novacane Studios" };
  const oEmail = (o) => `${o.body}\n\n--\nYou're getting this one email because ${oWhy[o.kind] || oWhy.business}. Novacane Studios, Forest Hill, London. Don't want emails like this? https://example.com/no-thanks`;
  const contacts = [{ name: "Ellie Parker", email: "ellie@example.org" }, { name: "Elliot Moss", email: "elliot@example.com" }, { name: "Riverside Choir office", email: "office@example.org" }, { name: "Maya Rose", email: "maya@example.com" }, { name: "", email: "bookings@example-venue.co.uk" }];

  // ---- Social ----
  const posts = [
    { id: 7, caption: "New single Friday 🌙\nNight Drive, recorded in Studio A.\n#NightDrive #novacane #foresthill", platforms: ["instagram", "facebook"], status: "pending_approval", postAt: ahead(60 * 50), createdBy: "agent", createdAt: ago(120), updatedAt: ago(120), media: [{ id: "a1", ext: "jpg", kind: "image", name: "night-drive-cover.jpg", size: 320000, url: pic("#7a2b8f", "#ff5fa8", "NIGHT DRIVE") }], targets: {} },
    { id: 8, caption: "Studio tour, the live room in 30 seconds.", platforms: ["instagram", "youtube"], status: "manual", createdBy: "s2", createdAt: ago(900), updatedAt: ago(800), decidedByName: me, decidedAt: ago(800), media: [{ id: "a2", ext: "jpg", kind: "image", name: "live-room.jpg", size: 410000, url: pic("#1b6f8a", "#3df5b8", "LIVE ROOM") }, { id: "a3", ext: "jpg", kind: "image", name: "desk.jpg", size: 390000, url: pic("#5a3d1a", "#ffc069", "THE DESK") }], targets: { instagram: { mode: "manual", state: "waiting" }, youtube: { mode: "auto", state: "posted", url: "https://www.youtube.com/", postedAt: ago(700) } } },
    { id: 9, caption: "Mastering day for the Lowlands EP. Doors open for listening at 6.", platforms: ["facebook"], status: "scheduled", postAt: ahead(60 * 26), createdBy: "s1", createdAt: ago(1500), updatedAt: ago(1400), decidedByName: me, decidedAt: ago(1400), media: [], targets: { facebook: { mode: "auto", state: "waiting" } } },
    { id: 10, caption: "Open mic recordings are up!", platforms: ["facebook", "instagram"], status: "scheduled", postAt: ahead(60 * 75), createdBy: "agent", createdAt: ago(1600), updatedAt: ago(1500), decidedByName: me, decidedAt: ago(1500), media: [{ id: "a4", ext: "jpg", kind: "image", name: "open-mic.jpg", size: 300000, url: pic("#2d2a7a", "#8c9bff", "OPEN MIC") }], targets: { facebook: { mode: "auto", state: "waiting" }, instagram: { mode: "manual", state: "waiting" } } },
    { id: 6, caption: "Behind the scenes with The Lanterns", platforms: ["instagram", "facebook"], status: "posted", postedAt: ago(9000), createdBy: "s2", createdAt: ago(9500), updatedAt: ago(9000), decidedByName: me, decidedAt: ago(9100), media: [{ id: "a5", ext: "jpg", kind: "image", name: "lanterns.jpg", size: 280000, url: pic("#8a1b3d", "#ff9a5c", "LANTERNS") }], targets: { instagram: { mode: "manual", state: "posted", url: "https://www.instagram.com/", postedAt: ago(9000), by: "s2" }, facebook: { mode: "auto", state: "posted", url: "https://www.facebook.com/", postedAt: ago(9000) } }, stats: { facebook: { reach: 1200, likes: 96, comments: 8, shares: 5, clicks: 31 }, instagram: { views: 2310, likes: 240, comments: 12, saved: 18 }, fetchedAt: ago(40) } },
    { id: 5, caption: "Cheap studio time!!!", platforms: ["facebook"], status: "rejected", createdBy: "agent", createdAt: ago(20000), updatedAt: ago(19000), decidedByName: me, decidedAt: ago(19000), note: "Let's not say cheap.", media: [], targets: {} },
    { id: 4, caption: "Our new vocal booth.", platforms: ["facebook"], status: "failed", createdBy: "s1", createdAt: ago(30000), updatedAt: ago(29000), error: "Meta said the picture was too small", media: [], targets: { facebook: { mode: "auto", state: "failed", error: "Meta said the picture was too small" } } },
  ];
  const sLog = { 6: [{ at: ago(9500), event: "created", byName: "Sam Okoro" }, { at: ago(9100), event: "approved", byName: me }, { at: ago(9000), event: "posted", detail: "Facebook" }, { at: ago(9000), event: "marked_posted", byName: "Sam Okoro", detail: "Instagram" }, { at: ago(40), event: "stats" }] };
  const comments = [
    { id: 3, postId: 6, postCaption: "Behind the scenes with The Lanterns", platform: "instagram", author: "kai.music", text: "Can't wait!! 🔥 When's the EP out?", commentedAt: ago(400), handled: false },
    { id: 4, postId: 6, postCaption: "Behind the scenes with The Lanterns", platform: "facebook", author: "Maya R", text: "Do you have any Saturday sessions in November?", commentedAt: ago(700), handled: false, reply: "We do! Message us and we'll find you a slot.", replyStatus: "pending_approval", replyBy: "agent" },
    { id: 5, postId: 6, postCaption: "Behind the scenes with The Lanterns", platform: "facebook", author: "Leo", text: "Sounds great", commentedAt: ago(3000), handled: true, reply: "Thanks Leo!", replyStatus: "sent", replySentAt: ago(2900) },
    { id: 6, postId: 6, postCaption: "Behind the scenes with The Lanterns", platform: "instagram", author: "someone.new", text: "How much is a day?", commentedAt: ago(1000), handled: false, reply: "It's cheap!", replyStatus: "rejected", note: "Give the real price: £280 a day." },
  ];
  const followers = { facebook: { followers: 980, change: 24 }, instagram: { followers: 2140, change: -6 }, youtube: { followers: 312, change: 3 } };
  const connected = { facebook: true, instagram: false, youtube: true };
  const limits = { instagramCaption: 2200, instagramHashtags: 30, facebookCaption: 63206, youtubeTitle: 100, youtubeDescription: 5000, media: 10 };

  // ---- Funnel ----
  const ROLES = { artist: "Independent Artist / Singer-Songwriter", producer: "Music Producer", engineer: "Audio Engineer (Mix/Master)", manager: "Band Manager / Artist Management", label: "Record Label A&R / Executive", podcaster: "Podcaster / Content Creator" };
  const settings = { paused: false, pausedWhy: null, cap: 20, rampStart: 5, rampStep: 5, rampEvery: 5, gapMin: 180, gapMax: 420, fromHour: 9, toHour: 18, weekdaysOnly: true, signoff: "Novacane Studios", pitch: { artist: "full-day vocal and band sessions in Forest Hill, with mixing", producer: "a big live room to track in, by the hour", engineer: "the room and desk for your own sessions", manager: "block bookings for your artists", label: "demo days for new signings", podcaster: "a four-seat booth with video" } };
  const prospect = (o) => ({ id: ++nextId, company: "", bio: "", role: null, roleName: null, roleWhy: null, status: "pending", step: "write", why: null, stopReason: null, subject: null, body: null, scores: null, swaps: [], createdAt: ago(5000), updatedAt: ago(5000), ...o });
  const prospects = [
    prospect({ name: "Riverside Choir", email: "hello@example.org", company: "Riverside Choir", role: "artist", roleName: ROLES.artist, roleWhy: "A choir that records its concerts", step: "approve", subject: "Recording your winter concert", body: "Hi,\n\nWe record choirs in our big live room. Could we record your winter concert?\n\nNovacane Studios", scores: { deliverability: 9, open: 8, reply: 6, tips: [{ metric: "reply", tip: "End with one easy question, like a date." }] }, swaps: [{ from: "free", to: "no-cost" }], draftedAt: ago(300), updatedAt: ago(300) }),
    prospect({ name: "Tom Field", email: "tom@example-beats.co.uk", company: "Example Beats", role: "producer", roleName: ROLES.producer, roleWhy: "Makes beats for UK artists", step: "approve", subject: "A live room for your sessions", body: "Hi Tom,\n\nIf you ever need a live room for drums, ours is in Forest Hill.\n\nNovacane Studios", scores: { deliverability: 8, open: 7, reply: 8 }, draftedAt: ago(280), updatedAt: ago(280) }),
    prospect({ name: "Jess Moore", email: "jess@example-mgmt.com", company: "Moore Management", bio: "Manages three indie bands" }),
    prospect({ name: "Pat Gmail", email: "pat.music@gmail.com", step: "blocked", why: "A personal mailbox: under UK law they have to opt in first." }),
    prospect({ name: "Rae Studio", email: "rae@example-pod.com", company: "Rae Talks", role: "podcaster", roleName: ROLES.podcaster, status: "warming", step: "warming", subject: "A booth for Rae Talks", body: "Hi Rae,\n\nOur booth seats four, with video.\n\nNovacane Studios", approvedAt: ago(100), queuedAt: ago(100), scores: { deliverability: 9, open: 8, reply: 7 } }),
    prospect({ name: "Lowlands", email: "band@example-lowlands.com", company: "Lowlands", role: "artist", roleName: ROLES.artist, status: "sent", step: "sent", subject: "Your next EP", body: "Hi,\n\nWe'd love to record your next EP.\n\nNovacane Studios", sentAt: ago(2000), messageId: "<abc123@mail.example>", threadId: "18c2f0a1b2", scores: { deliverability: 9, open: 7, reply: 7 } }),
    prospect({ name: "Kofi A", email: "kofi@example-label.com", company: "Example Label", role: "label", roleName: ROLES.label, status: "replied", step: "replied", subject: "Demo days", body: "Hi Kofi,\n\nWe run demo days for new signings.\n\nNovacane Studios", sentAt: ago(6000), repliedAt: ago(5000), threadId: "18c2f0a1b3" }),
    prospect({ name: "Old Address", email: "gone@example-old.com", status: "bounced", step: "bounced", stopReason: "bounced", sentAt: ago(9000), error: "The address doesn't exist any more" }),
    prospect({ name: "No Thanks", email: "no@example-nope.com", status: "bounced", step: "bounced", stopReason: "opted_out", sentAt: ago(9500) }),
  ];
  for (let i = 0; i < 44; i++) prospects.push(prospect({ name: `Sample prospect ${i + 1}`, email: `person${i + 1}@example-music.co.uk`, company: `Example Music ${i + 1}` }));
  const fLog = (p) => [{ at: p.createdAt, event: "added", byName: me }, ...(p.draftedAt ? [{ at: p.draftedAt, event: "written", byName: "Claude" }] : []), ...(p.approvedAt ? [{ at: p.approvedAt, event: "approved", byName: me }] : []), ...(p.sentAt ? [{ at: p.sentAt, event: "sent", byName: "Nova" }] : []), ...(p.repliedAt ? [{ at: p.repliedAt, event: "replied", byName: "Nova" }] : [])];
  const fEmail = (p) => (p.body ? `${p.body}\n\n--\nNovacane Studios, Forest Hill, London. Not for you? Reply "no thanks" and we won't email again: https://example.com/no-thanks` : null);
  const sentDays = [];
  for (let i = 9; i >= 1; i--) sentDays.push({ day: ukDay(Date.now() - i * 86400000), sent: Math.min(5 + 5 * Math.floor((9 - i) / 5), 3 + ((i * 7) % 6)) });
  const counts = () => {
    const c = { pending: 0, warming: 0, sent: 0, bounced: 0, replied: 0, written: 0, optedOut: 0 };
    for (const p of prospects) { c[p.status]++; if (p.status === "pending" && p.subject) c.written++; if (p.stopReason === "opted_out") c.optedOut++; }
    const emailed = prospects.filter((p) => p.sentAt).length;
    c.emailed = emailed;
    c.replyRate = emailed ? Math.round((prospects.filter((p) => p.status === "replied").length / emailed) * 1000) / 10 : null;
    return c;
  };
  const stepOf = (p) => (p.status !== "pending" ? p.status : p.why ? "blocked" : p.subject && p.body ? "approve" : "write");

  const find = (arr, id) => arr.find((x) => String(x.id) === String(id));
  const no = (status, error) => ({ status, body: { error } });
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, b) => {
    const p = u.pathname;
    let m;
    // Campaigns
    if (p === "/app/api/campaigns") {
      if (method === "GET") return { campaigns, canDecide: true, audiences, signupUrl: "https://example.com/join" };
      const c = { id: ++nextId, subject: b.subject, body: b.body, audience: b.audience, sendAt: b.sendAt || null, status: "pending_approval", createdBy: "s1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      campaigns.unshift(c);
      return { ok: true, campaign: c };
    }
    if (p === "/app/api/campaigns/test-send") return { ok: true };
    if ((m = p.match(/^\/app\/api\/campaigns\/(\d+)$/))) { const c = find(campaigns, m[1]); return c ? { campaign: c, log: cLog[c.id] || [{ at: c.createdAt, event: "created" }], previewHtml: previewHtml(c) } : no(404, "That campaign doesn't exist."); }
    if ((m = p.match(/^\/app\/api\/campaigns\/(\d+)\/(edit|approve|reject)$/))) {
      const c = find(campaigns, m[1]);
      if (!c) return no(404, "That campaign doesn't exist.");
      const now = new Date().toISOString();
      if (m[2] === "edit") Object.assign(c, { subject: b.subject, body: b.body, audience: b.audience, sendAt: b.sendAt || null, status: "pending_approval", note: null, updatedAt: now });
      if (m[2] === "approve") Object.assign(c, c.sendAt ? { status: "scheduled", recipients: audiences[c.audience] } : { status: "sent", sentAt: now, recipients: audiences[c.audience], stats: { sent: audiences[c.audience], unsubscribed: 0, fetchedAt: now } }, { decidedByName: me, decidedAt: now, updatedAt: now });
      if (m[2] === "reject") Object.assign(c, { status: "rejected", note: b.note || null, decidedByName: me, decidedAt: now, updatedAt: now });
      (cLog[c.id] = cLog[c.id] || [{ at: c.createdAt, event: "created" }]).push({ at: now, event: m[2] === "edit" ? "edited" : m[2] === "approve" ? (c.status === "sent" ? "sent" : "scheduled") : "rejected", byName: me, detail: b.note || null });
      return { ok: true, campaign: c };
    }
    // One-to-one
    if (p === "/app/api/outreach") {
      if (method === "GET") return { outreach, canDecide: true, ready: true, optouts: 4, sentToday: 1, perDay: 20 };
      const o = { id: ++nextId, ...b, status: "pending_approval", createdByName: me, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      outreach.unshift(o);
      return { ok: true, outreach: o };
    }
    if (p === "/app/api/outreach/test-send") return { ok: true };
    if (p === "/app/api/outreach/optouts") {
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return no(400, "That email address doesn't look right.");
      let stopped = 0;
      for (const o of outreach) if (o.toEmail.toLowerCase() === email && ["draft", "pending_approval"].includes(o.status)) { o.status = "rejected"; o.note = "They asked not to get emails like this"; stopped++; }
      return { ok: true, email, stopped };
    }
    if ((m = p.match(/^\/app\/api\/outreach\/(\d+)$/))) { const o = find(outreach, m[1]); return o ? { outreach: o, log: oLog[o.id] || [{ at: o.createdAt, event: "created", byName: o.createdByName }], email: oEmail(o) } : no(404, "That email doesn't exist."); }
    if ((m = p.match(/^\/app\/api\/outreach\/(\d+)\/(edit|approve|reject)$/))) {
      const o = find(outreach, m[1]);
      if (!o) return no(404, "That email doesn't exist.");
      const now = new Date().toISOString();
      if (m[2] === "edit") Object.assign(o, b, { status: "pending_approval", note: null, updatedAt: now });
      if (m[2] === "approve") Object.assign(o, { status: "sent", sentAt: now, decidedByName: me, decidedAt: now, updatedAt: now });
      if (m[2] === "reject") Object.assign(o, { status: "rejected", note: b.note || null, decidedByName: me, decidedAt: now, updatedAt: now });
      return { ok: true, outreach: o };
    }
    if (p === "/app/api/google/contacts") { const q = (u.searchParams.get("q") || "").toLowerCase(); return { contacts: contacts.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)) }; }
    // Social
    if (p === "/app/api/social") {
      if (method === "GET") return { posts, comments, followers, connected, canDecide: true, adsUrl: "https://adsmanager.facebook.com/", limits };
      const post = { id: ++nextId, caption: b.caption, platforms: b.platforms, media: (b.media || []).map((x) => ({ ...x, kind: /mp4|mov/.test(x.ext) ? "video" : "image", url: uploaded.get(x.id) || pic("#444", "#888", "PICTURE") })), postAt: b.postAt || null, status: "pending_approval", createdBy: "s1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), targets: {} };
      posts.unshift(post);
      return { ok: true, post };
    }
    if ((m = p.match(/^\/app\/api\/social\/(\d+)$/))) { const s = find(posts, m[1]); return s ? { post: s, log: sLog[s.id] || [{ at: s.createdAt, event: "created" }] } : no(404, "That post doesn't exist."); }
    if ((m = p.match(/^\/app\/api\/social\/(\d+)\/(edit|approve|reject|posted)$/))) {
      const s = find(posts, m[1]);
      if (!s) return no(404, "That post doesn't exist.");
      const now = new Date().toISOString();
      if (m[2] === "edit") Object.assign(s, { caption: b.caption, platforms: b.platforms, media: (b.media || []).map((x) => ({ ...(s.media.find((y) => y.id === x.id) || { kind: /mp4|mov/.test(x.ext) ? "video" : "image", url: uploaded.get(x.id) }), ...x })), postAt: b.postAt || null, status: "pending_approval", note: null, updatedAt: now });
      if (m[2] === "approve") {
        const targets = {};
        for (const pl of s.platforms) targets[pl] = connected[pl] ? (s.postAt ? { mode: "auto", state: "waiting" } : { mode: "auto", state: "posted", url: "https://www.facebook.com/", postedAt: now }) : { mode: "manual", state: "waiting" };
        const handLeft = s.platforms.some((pl) => !connected[pl]);
        Object.assign(s, { targets, status: s.postAt ? "scheduled" : handLeft ? "manual" : "posted", postedAt: !s.postAt && !handLeft ? now : null, decidedByName: me, decidedAt: now, updatedAt: now });
      }
      if (m[2] === "reject") Object.assign(s, { status: "rejected", note: b.note || null, decidedByName: me, decidedAt: now, updatedAt: now });
      if (m[2] === "posted") {
        s.targets[b.platform] = { ...(s.targets[b.platform] || {}), mode: "manual", state: "posted", url: b.url || null, postedAt: now };
        if (s.platforms.every((pl) => (s.targets[pl] || {}).state === "posted")) Object.assign(s, { status: "posted", postedAt: now });
      }
      (sLog[s.id] = sLog[s.id] || [{ at: s.createdAt, event: "created" }]).push({ at: now, event: { edit: "edited", approve: "approved", reject: "rejected", posted: "marked_posted" }[m[2]], byName: me, detail: b.platform || b.note || null });
      return { ok: true, post: s };
    }
    if ((m = p.match(/^\/app\/api\/social\/comments\/(\d+)\/(reply|approve|reject|handled)$/))) {
      const c = find(comments, m[1]);
      if (!c) return no(404, "That comment doesn't exist.");
      if (m[2] === "reply") Object.assign(c, { reply: b.text, replyStatus: "pending_approval", note: null });
      if (m[2] === "approve") Object.assign(c, connected[c.platform] ? { replyStatus: "sent", replySentAt: new Date().toISOString(), handled: true } : { replyStatus: "approved" });
      if (m[2] === "reject") Object.assign(c, { replyStatus: "rejected", note: b.note || null });
      if (m[2] === "handled") c.handled = !!b.handled;
      return { ok: true, comment: c };
    }
    // (the studio computer keeps the pictures and videos: here, kept in the page)
    if (p === "/actions/social-media" && method === "POST") {
      const name = u.searchParams.get("name") || "file";
      const id = (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + "0".repeat(32)).slice(0, 32);
      const video = /^video\//.test((b && b.type) || "");
      const url = b instanceof Blob && !video ? pic("#3a2a6a", "#c7a4ff", "NEW") : pic("#3a2a6a", "#c7a4ff", video ? "VIDEO" : "NEW");
      uploaded.set(id, url);
      return { media: { id, ext: video ? "mp4" : "jpg", kind: video ? "video" : "image", name, size: (b && b.size) || 0, url } };
    }
    if (/^\/actions\/social-media\/[^/]+\/remove$/.test(p)) return { ok: true };
    // Funnel
    if (p === "/app/api/funnel") {
      for (const x of prospects) x.step = stepOf(x);
      const todaySent = prospects.filter((x) => x.sentAt && ukDay(x.sentAt) === ukDay(Date.now())).length;
      return { prospects, counts: counts(), today: { day: 10, limit: 10, sent: todaySent + 2, days: [...sentDays, { day: ukDay(Date.now()), sent: todaySent + 2 }], inHours: true, nextAt: settings.paused ? null : ahead(4) }, settings, ready: { gmail: true, account: "studio@example.com", replies: true, claude: true }, canDecide: true, roles: ROLES, risky: [{ words: "free, for free", to: "no-cost" }, { words: "guarantee", to: "aim to" }, { words: "click here", to: "(taken out)" }], pass: 7 };
    }
    if (p === "/app/api/funnel/export.csv") return ["Name,Email,Company/Project,Role,Bio,Status,Last_Sent,Message_Id,Thread_Id,Subject", ...prospects.map((x) => [x.name, x.email, x.company, x.roleName || "", x.bio, x.status, x.sentAt || "", x.messageId || "", x.threadId || "", x.subject || ""].map((v) => (/[",\n]/.test(String(v || "")) ? `"${String(v).replace(/"/g, '""')}"` : v || "")).join(","))].join("\r\n") + "\r\n";
    if ((m = p.match(/^\/app\/api\/funnel\/(\d+)$/))) { const x = find(prospects, m[1]); if (!x) return no(404, "That person isn't on the list."); x.step = stepOf(x); return { prospect: x, log: fLog(x), email: fEmail(x) }; }
    if (p === "/app/api/funnel/import") {
      const lines = String(b.csv || "").trim().split(/\r?\n/);
      if (lines.length < 2) return no(400, "The file needs a heading row (Name, Company/Project, Bio/Notes, Email) and at least one person.");
      let added = 0, duplicates = 0, invalid = 0;
      for (const line of lines.slice(1)) {
        const cells = line.split(",");
        const email = (cells.find((c) => /@/.test(c)) || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { invalid++; continue; }
        if (prospects.some((x) => x.email === email)) { duplicates++; continue; }
        prospects.push(prospect({ name: cells[0] || email, email, company: cells[1] || "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
        added++;
      }
      return { ok: true, added, duplicates, invalid };
    }
    if (p === "/app/api/funnel/draft") {
      const ids = b.ids && b.ids.length ? b.ids.map(String) : null;
      const todo = prospects.filter((x) => stepOf(x) === "write" || (ids && ids.includes(String(x.id)))).filter((x) => !ids || ids.includes(String(x.id))).slice(0, 5);
      for (const x of todo) Object.assign(x, { subject: `Recording at Novacane, ${x.name.split(" ")[0]}?`, body: `Hi ${x.name.split(" ")[0]},\n\nWe run Novacane Studios in Forest Hill, London: a big live room by the hour.\n\nWould a visit be useful?\n\n${settings.signoff}`, role: x.role || "artist", roleName: x.roleName || ROLES.artist, scores: { deliverability: 9, open: 7, reply: 6, tips: [{ metric: "reply", tip: "Ask one easy question." }] }, draftedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return { ok: true, written: todo.length, failed: 0, left: prospects.filter((x) => stepOf(x) === "write").length };
    }
    if (p === "/app/api/funnel/pause") { Object.assign(settings, b.paused ? { paused: true, pausedWhy: `Paused by ${me}` } : { paused: false, pausedWhy: null }); return { ok: true, settings }; }
    if (p === "/app/api/funnel/settings") { Object.assign(settings, b, { pitch: { ...settings.pitch, ...(b.pitch || {}) } }); return { ok: true, settings }; }
    if (p === "/app/api/funnel/approve") {
      let approved = 0;
      const refused = [];
      for (const it of b.items || []) { const x = find(prospects, it.id); if (!x || stepOf(x) !== "approve") { refused.push({ id: it.id, why: "it changed since it was shown" }); continue; } Object.assign(x, { status: "warming", approvedAt: new Date().toISOString(), queuedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); approved++; }
      return { ok: true, approved, refused };
    }
    if ((m = p.match(/^\/app\/api\/funnel\/(\d+)\/(edit|hold|stop|replied|remove)$/))) {
      const x = find(prospects, m[1]);
      if (!x) return no(404, "That person isn't on the list.");
      const now = new Date().toISOString();
      if (m[2] === "edit") Object.assign(x, { name: b.name, company: b.company, role: b.role || null, roleName: b.role ? ROLES[b.role] : null, subject: b.subject || null, body: b.body || null, bio: b.bio, updatedAt: now }, x.status === "warming" ? { status: "pending" } : {});
      if (m[2] === "hold") Object.assign(x, { status: "pending", queuedAt: null, approvedAt: null, updatedAt: now });
      if (m[2] === "stop") Object.assign(x, { status: "bounced", stopReason: b.why === "opted_out" ? "opted_out" : "rejected", updatedAt: now });
      if (m[2] === "replied") Object.assign(x, { status: "replied", repliedAt: now, updatedAt: now });
      if (m[2] === "remove") prospects.splice(prospects.indexOf(x), 1);
      x.step = stepOf(x);
      return { ok: true, prospect: x };
    }
    return undefined;
  });
  const uploaded = new Map();
})();
