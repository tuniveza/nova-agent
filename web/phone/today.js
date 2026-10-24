// Nova Phone: Today, Portal's dashboard made for the phone. A greeting, the three numbers that matter (new
// enquiries, today's cards, money overdue), Portal's parts one tap each, today's calendar in words (on now, next,
// the free gaps, the moon, a special day), then a tile for every section Nova Desk's Today has (web/portal/dash.js):
// Today, Enquiries, Conversations, Alerts, Bookings, Approvals, Clients, Money, Campaigns, Social, Funnel,
// Quests, Website bot; Google, Computer and Test stuff for admins. Each tile: its count, a line under it and its
// latest few things, a tap on a line opening that very thing, the tile's name opening the whole section.
// Fast (ns CLAUDE.md 2e): every tile's data is asked for at once; what's come in a moment later is drawn, the
// rest keeps its room (nothing jumps) and fills in by itself. Read again after 30 s, or with Refresh.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, api, money, today } = N;
  const A = "/app/api/";

  // ---- Reading: the same addresses the sections use, kept for 30 s so a redraw doesn't ask again ----
  const cache = new Map();
  function get(path) {
    const was = cache.get(path);
    if (was && Date.now() - was.at < 30000) return was.p;
    const p = api(path.startsWith("/") ? path : A + path);
    cache.set(path, { at: Date.now(), p });
    p.catch(() => cache.delete(path));
    return p;
  }
  // (a promise whose outcome can be looked at straight away: done, v or e)
  const track = (p) => { const s = { done: false }; s.p = Promise.resolve(p).then((v) => { s.done = true; s.v = v; }, (e) => { s.done = true; s.e = e; }); return s; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Words (Nova Desk's) ----
  const UK = "Europe/London";
  // (formatters made once: the diary can hold thousands of bookings)
  const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit" });
  const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: UK, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const dayKey = (d) => DAY.format(d);
  const hhmm = (d) => CLOCK.format(d);
  const dayWord = (d) => (dayKey(d) === dayKey(new Date()) ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK }));
  // (the booking feed's "20261022T131500Z", or anything N.asDate reads)
  const when = (v) => { const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : N.asDate(v); };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  function since(v) {
    const d = N.asDate(v);
    if (!d) return "";
    const m = Math.round((Date.now() - d) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const days = Math.round(h / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  const bookingName = (b) => [b.session, b.name].filter(Boolean).join(" · ") || "Booking";
  const STATUS = { draft: "Draft", pending: "Waiting", pending_approval: "Waiting for approval", waiting: "Waiting", approved: "Approved", scheduled: "Scheduled", sending: "Sending", sent: "Sent", posted: "Posted", partly_posted: "Partly posted", by_hand: "To post by hand", rejected: "Rejected", failed: "Didn't go", cancelled: "Cancelled" };
  const statusWord = (s) => STATUS[s] || String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const hello = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
  const isAdmin = (me) => me?.staff?.role === "admin";

  // ---- What each tile says: { big, small, rows: [{ main, side, href, pill }], empty } ----
  // [id, name, the section it opens, rows it can have (its room is kept while it loads), admins only]
  const TILES = [
    { id: "today", name: "Today", href: "#bookings", rows: 4, async fill() {
      const [cal, enq, chats] = await Promise.allSettled([get("calendar"), get("enquiries"), get("conversations")]);
      const now = dayKey(new Date());
      const list = cal.status === "fulfilled" && cal.value.setUp ? (cal.value.bookings || []).map((b) => ({ b, at: when(b.start) })).filter((x) => x.at && dayKey(x.at) === now).sort((a, z) => a.at - z.at) : [];
      const fresh = enq.status === "fulfilled" ? enq.value.newCount || 0 : 0;
      const talked = chats.status === "fulfilled" ? (chats.value.conversations || []).filter((c) => { const d = N.asDate(c.started); return d && dayKey(d) === now; }).length : 0;
      return {
        big: `${plural(list.length, "booking")} today`,
        small: `${plural(fresh, "new enquiry", "new enquiries")} · ${plural(talked, "chat")} today`,
        rows: list.slice(0, 4).map(({ b, at }) => ({ main: bookingName(b), side: hhmm(at), href: `#bookings/${now}` })),
        more: list.length > 4 ? { text: `+${list.length - 4} more today`, href: `#bookings/${now}` } : null,
        empty: "Nothing booked today.",
        // (24 Oct 2026, the user: "can shared/rules.js just be smartly integrated back into the base code": the
        // link's words are its name, on one line; what it's for under it, outside the link, wrapping like reading.
        // The link still covers the whole line, so a tap anywhere on it opens Booking tools.)
        foot: `<div class="today-foot"><a href="#bookings" aria-describedby="today-foot-bk">${icon("calendar")}<span>Booking tools</span></a><small id="today-foot-bk">Week at a glance and free slots</small></div>`,
      };
    } },
    { id: "enquiries", name: "Enquiries", href: "#inbox", rows: 4, async fill() {
      const d = await get("enquiries");
      const c = d.counts || {};
      N.badge("inbox", d.newCount || c.new || 0);
      return {
        n: d.newCount || 0,
        big: `${d.newCount || 0} new`,
        small: `${c.open || 0} open · ${c.replied || 0} waiting on them`,
        rows: (d.enquiries || []).slice(0, 4).map((q) => ({ main: `${q.name || q.email || "Someone"}${q.subject ? ` · ${q.subject}` : ""}`, side: since(q.last_activity || q.created_at), href: `#inbox/enquiry/${q.id}`, pill: q.drafts ? "Draft to approve" : q.failed ? "Didn't send" : "" })),
        empty: "No new enquiries. All caught up ✦",
      };
    } },
    { id: "chats", name: "Conversations", href: "#inbox/chats", rows: 4, async fill() {
      const d = await get("conversations");
      const list = d.conversations || [];
      const now = dayKey(new Date());
      const talked = list.filter((c) => { const x = N.asDate(c.started); return x && dayKey(x) === now; }).length;
      return {
        big: plural(list.length, "chat"),
        small: `${d.needsPerson ? `${d.needsPerson} need${d.needsPerson === 1 ? "s" : ""} a person` : "Nobody waiting on a person"} · ${talked} today`,
        rows: list.slice(0, 4).map((c) => ({ main: c.first_question || "A chat", side: since(c.last || c.started), href: `#inbox/chat/${encodeURIComponent(c.chat_id)}`, pill: c.needsPerson || c.state === "needs-person" ? "Needs a person" : "" })),
        empty: "No chats in the last 90 days.",
      };
    } },
    { id: "alerts", name: "Alerts", href: "#inbox/alerts", rows: 4, async fill() {
      const d = await get("notifications");
      const list = d.notifications || [];
      return {
        big: plural(list.length, "alert"),
        small: d.autoDeleteDays ? `Deleted after ${plural(d.autoDeleteDays, "day")}` : "Kept until deleted",
        rows: list.slice(0, 4).map((n) => ({ main: n.title || "Alert", side: since(n.created_at), href: `#inbox/alert/${n.id}` })),
        empty: "No alerts yet.",
      };
    } },
    { id: "calendar", name: "Bookings", href: "#bookings", rows: 4, async fill() {
      const d = await get("calendar");
      if (!d.setUp) return { big: "Not set up", small: "The booking calendar isn't connected", rows: [], empty: "" };
      const now = Date.now();
      const next = (d.bookings || []).map((b) => ({ b, at: when(b.start) })).filter((x) => x.at && x.at.getTime() >= now - 3600000).sort((a, z) => a.at - z.at);
      const todayN = next.filter((x) => dayKey(x.at) === dayKey(new Date())).length;
      return {
        big: `${todayN} today`,
        small: `${plural(next.length, "booking")} coming up`,
        rows: next.slice(0, 4).map(({ b, at }) => ({ main: bookingName(b), side: `${dayWord(at)} ${hhmm(at)}`, href: `#bookings/${dayKey(at)}` })),
        empty: "Nothing booked ahead.",
      };
    } },
    { id: "approvals", name: "Approvals", href: "#inbox/approvals", rows: 4, async fill() {
      const d = await get("booking-actions");
      const waiting = (d.actions || []).filter((a) => !a.status || a.status === "pending" || a.status === "waiting");
      return {
        big: `${waiting.length} waiting`,
        small: d.canDecide ? "Yours to approve" : "An admin approves these",
        rows: waiting.slice(0, 4).map((a) => ({ main: a.summary || a.title || "A booking change", side: since(a.createdAt || a.created_at), href: "#inbox/approvals" })),
        empty: "Nothing waiting for approval.",
      };
    } },
    { id: "clients", name: "Clients", href: "#clients", rows: 4, async fill() {
      const d = await get("clients");
      const list = (d.clients || []).slice().sort((a, z) => String(z.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return {
        big: plural(d.total || list.length, "client"),
        small: `${list.filter((c) => c.nextBooked).length} with a session booked`,
        rows: list.slice(0, 4).map((c) => ({ main: c.name || c.email || "A client", side: c.nextBooked && when(c.nextBooked) ? `next ${dayWord(when(c.nextBooked))}` : plural(c.sessionCount || 0, "session"), href: `#clients/${c.id}` })),
        empty: "No clients yet.",
      };
    } },
    { id: "money", name: "Money", href: "#money", rows: 4, async fill() {
      const d = await get("money");
      const s = d.summary || {};
      const rows = [];
      if (s.owed) rows.push({ main: `Owed: ${plural(s.owed.count || 0, "invoice")}`, side: money(s.owed.pence), href: "#money" });
      if (s.overdue) rows.push({ main: `Overdue: ${plural(s.overdue.count || 0, "invoice")}`, side: money(s.overdue.pence), href: "#money?filter=overdue", pill: s.overdue.count ? "To chase" : "" });
      if (s.month) rows.push({ main: "In this month", side: money(s.month.inPence), href: "#money" });
      if (s.month) rows.push({ main: "Out this month", side: money(s.month.outPence), href: "#money" });
      const waiting = (s.waitingApproval || 0) + (s.unconfirmedExpenses || 0);
      return { over: s.overdue || {}, big: s.owed ? money(s.owed.pence) : "–", small: waiting ? `owed · ${waiting} waiting for approval` : "owed", rows, empty: "" };
    } },
    { id: "campaigns", name: "Campaigns", href: "#outreach", rows: 4, async fill() {
      const d = await get("campaigns");
      const list = d.campaigns || [];
      const a = d.audiences || {};
      return {
        big: plural(list.length, "campaign"),
        small: `${a.everyone || 0} can be emailed (${a.fans || 0} fans, ${a.clients || 0} clients)`,
        rows: list.slice(0, 4).map((c) => ({ main: c.subject || "(No subject)", side: statusWord(c.status), href: `#outreach/campaign/${c.id}` })),
        empty: "No campaigns yet.",
      };
    } },
    { id: "social", name: "Social", href: "#outreach/social", rows: 4, async fill() {
      const d = await get("social");
      const on = d.connected && typeof d.connected === "object" ? Object.entries(d.connected).filter(([, v]) => v).map(([k]) => k[0].toUpperCase() + k.slice(1)) : [];
      return {
        big: plural((d.posts || []).length, "post"),
        small: on.length ? `Connected: ${on.join(", ")}` : d.connected === true ? "Connected to Meta" : "Not connected to Meta yet: posts wait to be posted by hand",
        rows: (d.posts || []).slice(0, 4).map((p) => ({ main: String(p.text || p.caption || p.body || "A post").split("\n")[0], side: statusWord(p.status), href: `#outreach/social/${p.id}` })),
        empty: "No posts yet.",
      };
    } },
    { id: "funnel", name: "Funnel", href: "#outreach/funnel", rows: 4, async fill() {
      const d = await get("funnel");
      const c = d.counts || {};
      const t = d.today || {};
      const f = "#outreach/funnel";
      return {
        big: `${plural(c.emailed || c.sent || 0, "email")} sent`,
        small: `${t.sent || 0} of ${t.limit ?? t.cap ?? 0} today${d.settings && d.settings.paused ? " · paused" : ""}`,
        rows: [["Waiting to be written or approved", c.pending], ["Warming up", c.warming], ["Replied", c.replied], ["Bounced or rejected", c.bounced]].map(([main, n]) => ({ main, side: String(n || 0), href: f })),
        empty: "",
      };
    } },
    { id: "quests", name: "Quests", href: "#quests", rows: 4, async fill() {
      const d = await get("quests");
      const st = d.state || {};
      const cur = st.current && (st.current.title || st.current.name);
      const next = (Array.isArray(st.next) ? st.next : []).filter((q) => q && (q.title || q.name));
      const all = Array.isArray(st.quests) ? st.quests : [];
      const to = (q) => (q.id ? `#quests/quest/${encodeURIComponent(q.id)}` : "#quests");
      return {
        big: cur ? "On now" : plural(all.length, "quest"),
        small: cur || (d.online ? "Nothing on right now" : "Nova Agent's plan isn't reachable just now"),
        rows: [...(cur ? [{ main: cur, side: "now", href: to(st.current) }] : []), ...next.map((q) => ({ main: q.title || q.name, side: "next", href: to(q) }))].slice(0, 4),
        empty: "Nothing planned next.",
      };
    } },
    { id: "bot", name: "Website bot", href: "#bot", rows: 0, async fill() {
      return { big: "", small: "Try NovaBot as clients see it, or ask Nova about your bookings.", rows: [], empty: "", foot: `<div class="today-two"><a class="chip" href="#bot">Ask Nova</a><a class="chip" href="#bot/customer">NovaBot · bookings</a></div>` };
    } },
    { id: "google", name: "Google", href: "#google", rows: 1, admin: true, async fill() {
      const d = await get("google");
      const on = (d.parts || []).filter((p) => p.on).length;
      return {
        big: d.connected ? "Connected" : "Not connected",
        small: d.connected ? d.account || "" : d.needsReconnect ? "Needs connecting again" : "Connect it in Google",
        rows: [{ main: `${on} of ${(d.parts || []).length} parts on`, side: "", href: "#google" }],
        empty: "",
      };
    } },
    { id: "desk", name: "Computer", href: "#computer", rows: 3, admin: true, async fill() {
      const d = await get("desk");
      const v = d.vps || {};
      const pct = (x, used) => (x && x.usedPct != null ? `${Math.round(x.usedPct)}%` : x && x.percent != null ? `${Math.round(x.percent)}%` : used != null && isFinite(used) ? `${Math.round(used)}%` : "");
      const part = (x) => (x && x.total ? ((x.total - (x.free ?? x.available ?? x.total)) / x.total) * 100 : null);
      const cpu = v.cpu && Array.isArray(v.cpu.load) && v.cpu.count ? (v.cpu.load[0] / v.cpu.count) * 100 : null;
      return {
        big: v.reachable ? "Running" : "Can't reach it",
        small: v.lastBackup ? `Last backup ${since(v.lastBackup)}` : "",
        rows: [["Processor", pct(v.cpu, cpu)], ["Memory", pct(v.memory, part(v.memory))], ["Disk", pct(v.disk, part(v.disk))]].filter((r) => r[1]).map(([main, side]) => ({ main, side, href: "#computer" })),
        empty: "",
      };
    } },
    { id: "tests", name: "Test stuff", href: "#tests", rows: 0, admin: true, async fill() {
      const [b, p] = await Promise.allSettled([get("tidy"), get("/tidy-api/state")]);
      const n = [b, p].reduce((t, r) => t + (r.status === "fulfilled" && Array.isArray(r.value?.items) ? r.value.items.length : 0), 0);
      if (b.status === "rejected" && p.status === "rejected") throw b.reason;
      return { big: "", small: n ? `${n === 1 ? "1 thing looks like a test" : `${n} things look like tests`} · look` : "Nothing looks like a test.", rows: [], empty: "", hideWhenNone: !n };
    } },
  ];

  // ---- Drawing a tile ----
  // (a row's words are what's in it, an enquiry's first words, an alert, a booking: content, not a button's name,
  // so they wrap rather than hide, like Calendar's note cards: data-content-card. 24 Oct 2026, the user: "can
  // shared/rules.js just be smartly integrated back into the base code for all of this".)
  function rowHtml(r, t) {
    return `<li><a class="today-row" data-content-card href="${esc(r.href || t.href)}"><span class="today-main">${esc(r.main)}${r.pill ? ` <span class="pill warn">${esc(r.pill)}</span>` : ""}</span>${r.side ? `<span class="today-side">${esc(r.side)}</span>` : ""}</a></li>`;
  }
  const head = (t, n) => `<a class="today-head" href="${esc(t.href)}"><span class="today-name">${esc(t.name)}</span>${n ? `<b class="pill">${esc(n)}</b>` : ""}<span class="today-open">Open ${icon("next")}</span></a>`;
  function inner(t, s) {
    if (!s || !s.done) return `${head(t)}<div class="today-wait" aria-label="Loading"><i></i><i></i>${"<i></i>".repeat(t.rows)}</div>`;
    if (s.e) return `${head(t)}<p class="today-empty">${esc(s.e.signIn ? "Sign in again to see this." : `Couldn't load this just now: ${s.e.message || ""}`)}</p>`;
    const d = s.v;
    const top = d.big || d.small ? `<p class="today-top">${d.big ? `<b class="today-big">${esc(d.big)}</b>` : ""}${d.small ? `<span class="today-small">${esc(d.small)}</span>` : ""}</p>` : "";
    const rows = d.rows && d.rows.length ? `<ul class="today-rows">${d.rows.map((r) => rowHtml(r, t)).join("")}${d.more ? rowHtml({ main: d.more.text, href: d.more.href }, t) : ""}</ul>` : d.empty ? `<p class="today-empty">${esc(d.empty)}</p>` : "";
    return `${head(t)}${top}${rows}${d.foot || ""}`;
  }
  const tileHtml = (t, s) => `<section class="card today-tile" data-tile="${t.id}"${s && s.done ? "" : ` data-wait="${t.rows}"`} aria-label="${esc(t.name)}">${inner(t, s)}</section>`;
  // (a tile that came in late: drawn where its room was kept; while it's on screen it keeps that height, so
  // nothing under it moves)
  function fillLate(box, t, s) {
    const el = box.querySelector(`[data-tile="${t.id}"]`);
    if (!el) return;
    if (s.v === SKIP || (s.v && s.v.hideWhenNone)) { el.remove(); return; }
    const r = el.getBoundingClientRect();
    if (el.isConnected && r.top < innerHeight && r.bottom > 0) el.style.setProperty("min-height", `${Math.round(r.height)}px`);
    el.removeAttribute("data-wait");
    el.innerHTML = inner(t, s);
  }
  const SKIP = Symbol("not for you");

  // ---- Today's calendar, in words (Calendar's own sentences when calendar.js gives them) ----
  const stampDate = (s) => (s.endsWith("T24:00") ? new Date(new Date(`${s.slice(0, 10)}T00:00`).getTime() + 864e5) : new Date(s));
  const minsBetween = (a, b) => Math.round((stampDate(b) - stampDate(a)) / 60000);
  const titleOf = (e) => (e.type === "booking" ? [e.item.session, e.item.name].filter(Boolean).join(" · ") || "Booking" : e.item.title || (e.type === "day" ? "Day card" : "(No title)"));
  function sentences(d, list) {
    const now = N.localStamp(new Date());
    const timed = list.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
    const allDay = list.filter((e) => e.allDay);
    if (!list.length) return ["Nothing on today: the day is yours."];
    const out = [];
    const clip = (e, edge) => (edge === "start" ? (e.start.slice(0, 10) < d ? `${d}T00:00` : e.start) : e.end.slice(0, 10) > d ? `${d}T24:00` : e.end);
    const hm = (s) => (s.endsWith("T24:00") ? "midnight" : s.slice(11, 16));
    const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
    if (timed.length) {
      const first = timed[0];
      const last = timed.reduce((a, b) => (clip(b, "end") > clip(a, "end") ? b : a));
      out.push(timed.length === 1 ? `<b>${esc(titleOf(first))}</b>, ${hm(clip(first, "start"))} to ${hm(clip(first, "end"))}.` : `Starts with <b>${esc(titleOf(first))}</b> at ${hm(clip(first, "start"))}; finishes with <b>${esc(titleOf(last))}</b> at ${hm(clip(last, "end"))}.`);
      const gaps = [];
      let end = clip(first, "end");
      for (const e of timed.slice(1)) {
        const s0 = clip(e, "start");
        if (s0 > end && minsBetween(end, s0) >= 30) gaps.push(`${hm(end)}–${hm(s0)}`);
        if (clip(e, "end") > end) end = clip(e, "end");
      }
      if (timed.length > 1) out.push(gaps.length ? `Free ${and(gaps)}.` : "Back to back, no gaps.");
    }
    if (allDay.length) out.push(`All day: ${esc(and(allDay.map(titleOf)))}.`);
    if (timed.length) {
      const on = timed.find((e) => e.start <= now && clip(e, "end") > now);
      const next = timed.find((e) => e.start > now);
      if (on) out.push(`On now: <b>${esc(titleOf(on))}</b>, until ${hm(clip(on, "end"))}.`);
      if (next) {
        const m = minsBetween(now, next.start);
        const soon = m < 60 ? `in ${m} minute${m === 1 ? "" : "s"}` : m < 120 ? `in an hour${m % 60 >= 10 ? ` and ${m % 60} minutes` : ""}` : `in about ${Math.round(m / 60)} hours`;
        out.push(`Next: <b>${esc(titleOf(next))}</b> ${soon}.`);
      } else if (!on) out.push("That's everything for today.");
    }
    return out;
  }
  // (calendar.js gives { sentences: [{ html, text }] }; a string, a list or { html | lines } are read too)
  function theirSentences(d) {
    try {
      const s = N.cal.summary(d);
      if (!s) return null;
      if (typeof s === "string") return [s];
      if (Array.isArray(s)) return s.map(String);
      if (s.html) return [s.html];
      if (Array.isArray(s.lines)) return s.lines.map(String);
      if (Array.isArray(s.sentences)) return s.sentences.map((x) => (typeof x === "string" ? x : x.html || esc(x.text || "")));
    } catch (e) { console.warn("Nova Phone: Calendar's summary", e); }
    return null;
  }
  function moonLine(d) {
    try {
      const m = N.cal.moon?.(d);
      if (!m) return "";
      if (typeof m === "string") return esc(m);
      if (m.words || m.text || m.line) return esc(m.words || m.text || m.line);
      return esc(m.principal ? `${m.principal}${m.fullName ? ` · ${m.fullName}` : ""}` : `${m.name || "Moon"}${m.illumination != null ? ` · ${Math.round(m.illumination * 100)}% lit` : ""}`);
    } catch (e) { return ""; }
  }
  function specialLine(d) {
    try {
      const s = N.cal.special?.(d);
      const list = (Array.isArray(s) ? s : s ? [s] : []).map((x) => (typeof x === "string" ? x : x && (x.name || x.title || x.label))).filter(Boolean);
      return list.length ? esc(list.join(" · ")) : "";
    } catch (e) { return ""; }
  }
  const calHead = `<a class="today-head" href="#calendar/day/${today()}"><span class="today-name">Today's calendar</span><span class="today-open">Calendar ${icon("next")}</span></a>`;
  function calendarInner(s, google) {
    const d = today();
    if (s.done && !s.e && N.cal) {
      const list = N.cal.day(d);
      const say = theirSentences(d) || sentences(d, list);
      const moon = moonLine(d), special = specialLine(d);
      const meet = list.filter((e) => e.item && e.item.meetUrl);
      return `${calHead}<div class="today-say">${say.map((x) => (/^\s*</.test(x) ? x : `<p>${x}</p>`)).join("")}</div>
        ${special || moon ? `<p class="today-sky">${special ? `<span>${icon("star")}${special}</span>` : ""}${moon ? `<span>${icon("moon")}${moon}</span>` : ""}</p>` : ""}
        ${list.length ? N.list(list.map(N.cal.row)) : `<a class="btn wide" href="#calendar/new/${d}">${icon("plus")} Add a note card</a>`}
        ${meet.length ? `<ul class="today-rows">${meet.map((e) => `<li><a class="today-row today-meetrow" data-content-card href="${esc(e.item.meetUrl)}" target="_blank" rel="noopener"><span class="today-main">${icon("play")} Join on Meet ↗<small>${esc(e.item.title || "")}${e.allDay ? "" : ` · ${esc(e.start.slice(11, 16))}`}</small></span></a></li>`).join("")}</ul>` : ""}`;
    }
    // (Calendar's code isn't here, or its cards didn't load: Nova's and Google Calendar's events from Nova Bot)
    if (s.done && google.done && google.v) {
      const ev = google.v.events || [];
      return `${calHead}${ev.length ? `<ul class="today-rows">${ev.map((e) => `<li><div class="today-row today-ev"><span class="today-main">${esc(e.title)}<small>${esc([e.from === "Google Calendar" ? "Google Calendar" : "", e.location].filter(Boolean).join(" · "))}</small></span><span class="today-side">${esc(e.allDay ? "All day" : `${e.start}–${e.end}`)}</span></div>${e.meetUrl ? `<a class="today-row today-meetrow" href="${esc(e.meetUrl)}" target="_blank" rel="noopener"><span class="today-main">${icon("play")} Join on Meet ↗</span></a>` : ""}</li>`).join("")}</ul>` : `<p class="today-empty">Nothing on today: the day is yours.</p>`}
        <a class="btn wide" href="#calendar/new/${d}">${icon("plus")} Add a note card</a>`;
    }
    if (s.done && google.done) return `${calHead}<p class="today-empty">Today's calendar didn't load just now.</p>`;
    return `${calHead}<div class="today-wait" aria-label="Loading"><i></i><i></i><i></i><i></i></div>`;
  }

  N.section({
    id: "today",
    name: "Today",
    tile: "portal",
    async draw(box, path, ui) {
      ui.title("Today");
      ui.action({ icon: "refresh", label: "Refresh everything", run: () => { cache.clear(); N.show(); } });
      // Everything asked for at once (the admins' tiles once it's known who's here)
      const me = track(get("/auth/me"));
      const jobs = TILES.map((t) => ({ t, s: track(t.admin ? me.p.then(() => (isAdmin(me.v) ? t.fill() : SKIP)) : t.fill()) }));
      const calP = N.cal ? N.cal.load() : Promise.reject(new Error("Calendar's code isn't here"));
      const cal = track(calP);
      // (Calendar's cards didn't come: Nova's and Google Calendar's events from Nova Bot instead)
      const google = track(calP.then(() => null, (e) => (e.signIn ? null : get("google/today"))));
      const calReady = () => google.done;
      const css = N.css("today.css");
      await Promise.race([Promise.all([me.p, cal.p, google.p, ...jobs.map((j) => j.s.p)]), wait(900)]);
      await css;
      if (me.done && me.e && me.e.signIn) throw me.e;
      if (cal.done && cal.e && cal.e.signIn) throw cal.e;

      const name = me.v?.staff?.display_name ? `, ${me.v.staff.display_name.split(" ")[0]}` : "";
      const v = (id) => { const j = jobs.find((x) => x.t.id === id); return j && j.s.done && !j.s.e ? j.s.v : null; };
      box.innerHTML = `<h2 class="lead">${hello()}${esc(name)}</h2><p class="sub">${esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}</p>
        <div class="sums">
          <a class="sum" href="#inbox"><b data-sum="enq">–</b><span>New enquiries</span></a>
          <a class="sum" href="#calendar"><b data-sum="cal">–</b><span>On today</span></a>
          <a class="sum" href="#money?filter=overdue" data-sum-box="money"><b data-sum="money">–</b><span>Overdue</span></a>
        </div>
        <div class="chips portal-parts">${[["inbox", "Inbox"], ["inbox/approvals", "Approvals"], ["clients", "Clients"], ["bookings", "Booking tools"], ["outreach", "Campaigns"], ["outreach/social", "Social"], ["outreach/funnel", "Funnel"], ["inbox/alerts", "Alerts"], ["bot", "Website bot"], ["you", "You"]].map(([to, n]) => `<a class="chip" href="#${to}">${n}</a>`).join("")}</div>
        <div class="today-tiles">
          <section class="card today-tile today-cal" data-tile="cal"${calReady() ? "" : ' data-wait="4"'} aria-label="Today's calendar">${calendarInner(cal, google)}</section>
          ${jobs.map(({ t, s }) => (s.done && (s.v === SKIP || (s.v && s.v.hideWhenNone)) ? "" : tileHtml(t, s))).join("")}
        </div>`;
      // The three numbers (written in when they come: the same size whatever they say)
      const sums = () => {
        const enq = v("enquiries"), m = v("money");
        if (enq) box.querySelector('[data-sum="enq"]').textContent = String(enq.n);
        if (cal.done && !cal.e) box.querySelector('[data-sum="cal"]').textContent = String(N.cal.day(today()).length);
        else if (google.done && google.v) box.querySelector('[data-sum="cal"]').textContent = String((google.v.events || []).length);
        if (m) {
          box.querySelector('[data-sum="money"]').textContent = m.over.count ? money(m.over.pence) : "£0";
          box.querySelector('[data-sum-box="money"]').classList.toggle("bad", !!m.over.count);
        }
      };
      sums();
      // The rest, as each comes
      for (const { t, s } of jobs) if (!s.done) s.p.then(() => { fillLate(box, t, s); sums(); });
      const calLate = () => {
        const el = box.querySelector('[data-tile="cal"]');
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (el.isConnected && r.top < innerHeight && r.bottom > 0) el.style.setProperty("min-height", `${Math.round(r.height)}px`);
        el.removeAttribute("data-wait");
        el.innerHTML = calendarInner(cal, google);
        sums();
      };
      if (!calReady()) google.p.then(calLate);
    },
  });
})();
