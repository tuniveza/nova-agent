// Nova Phone: Inbox. Everything that comes in, in four parts (the same words and the same server as Portal's):
//   Enquiries   by state (New, Open, Waiting on them, Done, Spam), searchable; each row says who, what, where it
//               came from, who's on it and what's been sent, and its ⋯ does the rest in one sheet (email, WhatsApp,
//               call, text, a booking link, the website chat, move it, who, label, spam). Each one's page: who,
//               consent, the whole conversation, a reply by email, WhatsApp, text or a note (WhatsApp and texts
//               open ready to send, then "Did it send?" adds them), calls and how they went, Nova Agent's drafts to
//               approve, edit or discard, saved replies, don't contact, and a booking link to copy or email
//   Chats       the website's visitors talking to NovaBot: needs a person / done (from the list too), read with
//               the page each message came from and tappable links, take over, answer, hand back
//   Alerts      everything that reached the studio's phones: unseen count, the exact time, what kind, Acuity's
//               check, its latest email, open where it points, delete one or all, how long they're kept;
//               notifications on this phone (on, off, a test, the ping and banner while Nova Phone is open)
//   Approvals   booking changes Nova Agent proposed: change them first, approve, reject, and what became of them
// And while Nova Phone is open: a notification arriving pings, drops a banner and refreshes what's on screen;
// a notification tapped opens its place here (sw.js posts nova-push / nova-open); the Home Screen dot clears.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, toast, confirm, choose, form: sheetForm, busy, initials } = N;
  const A = "/app/api/";
  const STATES = [["new", "New"], ["open", "Open"], ["replied", "Waiting on them"], ["done", "Done"], ["spam", "Spam"]];
  const STATE_NAME = Object.fromEntries(STATES);
  const SORT_PLACES = [["new", "New"], ["open", "Open"], ["replied", "Waiting"], ["done", "Done"]];
  const SORT_SAID = { new: "Moved to New", open: "Open: it's being worked on", replied: "Waiting on them", done: "Marked done", spam: "Moved to Spam (nothing's deleted)" };
  const CALL_PREFIX = "Phone call: ";
  const CALL_OUTCOMES = [["spoke", "Spoke to them"], ["voicemail", "Left a voicemail"], ["no-answer", "No answer"]];
  const pressKey = () => "p-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const DOTS = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  const remember = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  // ---- Times: "Tue 6 Oct, 21:02" (Portal's), and alerts' exact "Tue 6 Oct 2026 · 21:02:40 · 3 min ago" ----
  const when = (v) => { const d = N.asDate(v); return d ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : ""; };
  function agoWords(v) {
    const d = N.asDate(v);
    if (!d) return "";
    const mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  function exactTime(v) {
    const d = N.asDate(v);
    if (!d) return "";
    const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${day} · ${time} · ${agoWords(d)}`;
  }
  // A UTC time as UK wall-clock "YYYY-MM-DDTHH:MM" (for a date-and-time box), as Portal does
  function ukLocal(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "";
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }

  // ---- Writes: the same addresses as Portal. (Our own, so a "this sign-in can't" answer (403) says why, with
  // where it can be done, instead of asking to sign in again: only 401 means signed out.) ----
  async function send(path, body) {
    let res;
    try {
      res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    } catch (e) {
      throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true });
    }
    const data = (res.headers.get("content-type") || "").includes("json") ? await res.json().catch(() => null) : null;
    if (res.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (!res.ok) throw Object.assign(new Error((data && data.error) || `Something went wrong (${res.status})`), { status: res.status, data, onlineUrl: data && data.onlineUrl });
    return data || {};
  }
  const fail = (err) => { if (err.signIn) toast("Signed out: sign in again", true); else toast(err.onlineUrl ? cantHere(err.onlineUrl).text : err.message, true); };

  // ---- Where an address goes in Nova Phone: Portal's, the Invoicer's and Nova Agent's addresses (a notification's,
  // an alert's) as #place/… here; other sites as they are ({ out }) ----
  function placeFor(raw, anyOrigin) {
    let u;
    try { u = new URL(String(raw || "/"), location.origin); } catch (e) { return "#inbox/alerts"; }
    if (u.origin !== location.origin && !anyOrigin) return { out: u.href };
    const q = u.searchParams, p = u.pathname;
    const has = (to) => (N.has(to.slice(1).split("/")[0]) ? to : "#inbox/alerts");
    if (p === "/" || p === "/agent/" || p === "/agent") {
      if (q.get("open")) return placeFor(q.get("open"), anyOrigin);
      return q.get("view") === "today" ? "#today" : has("#agent");
    }
    if (p.startsWith("/phone/")) return u.hash || "#today";
    if (/^\/(portal|app)(\/|$)/.test(p) && !p.startsWith("/app/memory")) {
      if (u.hash === "#nova") return "#inbox/alerts";
      const v = q.get("view"), id = (k) => encodeURIComponent(q.get(k) || "");
      if (v === "enquiries") return q.get("enquiry") ? `#inbox/enquiry/${id("enquiry")}` : "#inbox";
      if (v === "chats") return q.get("chat") ? `#inbox/chat/${id("chat")}` : "#inbox/chats";
      if (v === "alerts") return "#inbox/alerts";
      if (v === "approvals") return q.get("action") ? `#inbox/approvals/${id("action")}` : "#inbox/approvals";
      if (v === "campaigns") return has(q.get("outreach") ? `#outreach/one/${id("outreach")}` : q.get("campaign") ? `#outreach/campaign/${id("campaign")}` : "#outreach");
      if (v === "social") return has(q.get("post") ? `#outreach/social/${id("post")}` : q.get("comment") ? `#outreach/comment/${id("comment")}` : "#outreach/social");
      if (v === "funnel") return has("#outreach/funnel");
      if (v === "money") return has(q.get("invoice") ? `#money/invoice/${id("invoice")}` : "#money");
      if (v === "google") return has("#google");
      if (v === "manage") return has("#tests");
      if (v === "clients") return has("#clients");
      if (v === "quests") return has("#quests");
      if (v === "calendar" || v === "bookings") return has("#calendar");
      // (Portal itself, from a notification: what came in is in Alerts)
      return "#inbox/alerts";
    }
    if (p.startsWith("/invoicer/")) return has(q.get("invoice") ? `#money/invoice/${encodeURIComponent(q.get("invoice"))}` : "#money");
    const own = /^\/(calendar|quests|notes|board|fixer|computer|console|observatory|memory)\//.exec(p);
    if (own) return has(`#${own[1] === "memory" ? "index" : own[1]}`);
    if (/^\/(invoice|pay|book|booking)\//.test(p)) return { out: u.href };
    return "#inbox/alerts";
  }
  // "This sign-in can't …": where it can be (Nova Phone on the server the answer names, never Nova Desk)
  function cantHere(onlineUrl, what = "send emails") {
    let twin = "";
    try {
      const u = new URL(onlineUrl, location.origin);
      if (u.origin !== location.origin) { const to = placeFor(u.href, true); twin = `${u.origin}/phone/${typeof to === "string" ? to : ""}`; }
    } catch (e) {}
    return twin
      ? { text: `This sign-in can't ${what}: that needs Nova Phone online, in a browser, signed in.`, href: twin }
      : { text: `This sign-in can't ${what}: that needs Nova Phone open in this phone's browser (Safari or Chrome, not an app), signed in. Sign in there, then try again.`, href: "" };
  }
  const cantHtml = (h) => `<p class="small warn">${esc(h.text)}</p>${h.href ? `<a class="btn wide" href="${esc(h.href)}" target="_blank" rel="noopener">${icon("globe")} Open Nova Phone online</a>` : ""}`;

  // ---- Their number: WhatsApp and texts only for a mobile (dial: "+447700900123" from Nova Bot), calls for any ----
  const callNumber = (q) => q.dial || String(q.phone || "").replace(/[^0-9+]/g, "");
  const prettyNumber = (dial) => { const uk = /^\+44(\d{4})(\d{6})$/.exec(dial || ""); return uk ? `+44 ${uk[1]} ${uk[2]}` : dial || ""; };
  const waLink = (dial, text) => `https://api.whatsapp.com/send?phone=${String(dial).replace(/\D/g, "")}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
  const smsLink = (dial, text) => `sms:${dial}${text ? `?&body=${encodeURIComponent(text)}` : ""}`;
  const mailto = (q) => `mailto:${encodeURIComponent(q.email || "")}?subject=${encodeURIComponent(`Re: ${q.subject || "Your Novacane enquiry"}`)}`;

  // Words with their links tappable (a booking link and Google Calendar named, as Portal does)
  function linkify(text) {
    return String(text ?? "").split(/(https?:\/\/[^\s<>"']+)/).map((part, i) => {
      if (i % 2 === 0) return esc(part);
      const trail = (part.match(/[.,!?;:)]+$/) || [""])[0];
      const url = trail ? part.slice(0, -trail.length) : part;
      const name = /acuityscheduling|\/(book\?|pay\/|booking\/)/.test(url) ? "Booking link" : /calendar\.google\.com|google\.com\/calendar/.test(url) ? "Google Calendar" : url.replace(/^https?:\/\//, "");
      return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>${esc(trail)}`;
    }).join("");
  }

  // ---- The parts along the top, with what's waiting in each ----
  const PARTS = [["enquiries", "Enquiries"], ["chats", "Chats"], ["alerts", "Alerts"], ["approvals", "Approvals"]];
  const counts = { enquiries: 0, chats: 0, alerts: 0, approvals: 0 };
  let countsAt = 0;
  const partTabs = (on) => `<nav class="inbox-parts" aria-label="Inbox">${PARTS.map(([p, l]) => `<a class="seg-a" href="#inbox${p === "enquiries" ? "" : `/${p}`}" aria-selected="${p === on}">${l}<b class="inbox-n" data-n="${p}"${counts[p] && p !== on ? "" : " hidden"}>${counts[p]}</b></a>`).join("")}</nav>`;
  function showCounts() {
    for (const b of document.querySelectorAll(".inbox-n[data-n]")) {
      const n = counts[b.dataset.n] || 0, on = b.parentElement.getAttribute("aria-selected") === "true";
      b.textContent = n > 99 ? "99+" : String(n);
      b.hidden = !n || on;
    }
  }
  // (alerts not seen yet and approvals waiting: asked for after the screen's drawn, at most once a minute)
  function freshCounts() {
    if (Date.now() - countsAt < 60000) return showCounts();
    countsAt = Date.now();
    api(`${A}notifications`).then((r) => { counts.alerts = unseen(r.notifications || []); showCounts(); }, () => {});
    api(`${A}booking-actions`).then((r) => { counts.approvals = (r.actions || []).filter((x) => x.status === "pending").length; showCounts(); }, () => {});
  }
  const seenAlert = () => Number(remember.get("nova-seen-alert", 0)) || 0;
  const unseen = (all) => all.filter((n) => n.id > seenAlert()).length;

  // ---- Rows, for Today too ----
  function statePill(e) {
    return e.status === "spam" ? '<span class="pill bad">Spam</span>' : e.do_not_contact_at ? `<span class="pill bad">Don't contact</span>` : `<span class="pill${e.status === "new" ? " warn" : ""}">${esc({ new: "New", open: "Open", replied: "Replied" }[e.status] || "Done")}</span>`;
  }
  function enquiryRow(e) {
    const pills = [statePill(e), e.label ? `<span class="pill">${esc(e.label)}</span>` : "", e.drafts ? `<span class="pill warn">${e.drafts > 1 ? `${e.drafts} drafts` : "Draft"} to approve</span>` : "", e.failed ? `<span class="pill bad">Didn't send</span>` : ""].join(" ");
    const foot = [e.assigned_name ? `${e.assigned_name}'s on it` : "", e.page ? `From ${e.page}` : "", e.emailed ? "Email copy sent" : "", e.replies ? `${e.replies} ${e.replies === 1 ? "reply" : "replies"} sent` : ""].filter(Boolean).join(" · ");
    const what = [e.subject, e.details].filter(Boolean).join(": ");
    return row({
      href: `#inbox/enquiry/${e.id}`, lead: `<span class="av">${esc(initials(e.name || e.email))}</span>`, title: e.name || e.email || "Someone", text: String(what).length > 110 ? `${String(what).slice(0, 108).trim()}…` : String(what),
      html: `<span class="inbox-pills">${pills}</span>${e.status === "spam" && e.spam_reason ? `<span class="inbox-why">${esc(e.spam_reason)}</span>` : ""}${foot ? `<span class="inbox-foot">${esc(foot)}</span>` : ""}`,
      end: esc(N.ago(e.created_at)),
    });
  }
  const KIND = { booking: "Booking · Acuity", "nova-booking": "Booking · Nova", enquiry: "Enquiry", quest: "Quest", mission: "Mission", agent: "Nova Agent", health: "Acuity connection", test: "Test", other: "Alert" };
  const kindName = (n) => KIND[n.kind] || "Alert";
  // (Today maps rows with (n, index): the "seen" mark is passed only from here)
  const alertRow = (n) => alertRowSeen(n, seenAlert());
  function alertRowSeen(n, seen) {
    return row({ href: `#inbox/alert/${n.id}`, icon: "bell", title: n.title || "Alert", text: [kindName(n), String(n.body || "").slice(0, 120)].filter(Boolean).join(" · "), end: esc(N.ago(n.created_at)), cls: n.id > seen ? "inbox-unseen" : "" });
  }
  // A row with its own button beside it (⋯ or delete), the row still one tap to open
  const withButton = (html, btn) => html.replace(/^<li>/, '<li class="inbox-li">').replace(/<\/li>$/, `${btn}</li>`);

  N.section({
    id: "inbox",
    name: "Inbox",
    under: "today",
    tile: "portal",
    async draw(box, [part, a, b], ui) {
      await N.css("inbox.css");
      if (part === "enquiry") return drawThread(box, a, ui);
      if (part === "chat") return drawChat(box, a, ui);
      if (part === "alert") return drawAlert(box, a, ui);
      if (part === "saved") return drawSaved(box, ui);
      if (part === "chats") return drawChats(box, a, ui);
      if (part === "alerts") return drawAlerts(box, ui);
      if (part === "approvals") return drawApprovals(box, a, ui);
      return drawEnquiries(box, part === "box" ? a : "new", ui);
    },
  });

  // ================= Enquiries =================
  let searchFor = "", labelsCache = [], teamCache = [];
  const EMPTY = {
    new: "No new enquiries. They appear here when a customer asks NovaBot to send one.",
    open: "Nothing open. Move an enquiry to Open when you start on it.",
    replied: "Nobody to wait on: enquiries you've replied to wait here for their answer.",
    done: "Nothing done yet.",
    spam: "No spam. Likely spam lands here by itself (with the reason), and never pings anyone.",
    all: "No enquiries yet.",
  };
  async function drawEnquiries(box, which, ui) {
    which = which === "all" || STATES.some(([s]) => s === which) ? which : "new";
    const r = await api(`${A}enquiries?${which === "all" ? "show=all" : `box=${which}`}${searchFor ? `&q=${encodeURIComponent(searchFor)}` : ""}`);
    const c = r.counts || {}, rows = r.enquiries || [];
    if (r.labels) labelsCache = r.labels;
    if (r.team) teamCache = r.team;
    counts.enquiries = c.new || 0;
    N.badge("inbox", c.new || r.newCount || 0);
    ui.action({ icon: "chat", label: "Saved replies", href: "#inbox/saved" });
    box.innerHTML = `${partTabs("enquiries")}
      <div class="chips">${[["all", "All"], ...STATES].map(([s, l]) => `<a class="chip" href="#inbox/box/${s}"${s === which ? ' aria-current="page"' : ""}>${l}${c[s] ? ` <span class="n">${c[s]}</span>` : ""}</a>`).join("")}</div>
      <form class="search" data-enq-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(searchFor)}" placeholder="Search name, email, message or label" enterkeyhint="search"></label></form>
      ${searchFor ? `<button type="button" class="btn quiet" data-clear-search>Clear the search</button>` : ""}
      ${rows.length ? list(rows.map((e) => withButton(enquiryRow(e), `<button type="button" class="inbox-more" data-quick="${e.id}" aria-label="More for ${esc(e.name || "this enquiry")}">${DOTS}</button>`))) : empty({ icon: "inbox", title: searchFor ? `Nothing matches “${searchFor}”` : which === "new" ? "Nothing new. All caught up ✦" : "Nothing here", text: searchFor ? "" : EMPTY[which] })}`;
    box.querySelector("[data-clear-search]")?.addEventListener("click", () => { searchFor = ""; N.show(); });
    box.querySelectorAll("[data-quick]").forEach((btn) => btn.addEventListener("click", () => quickSheet(rows.find((e) => String(e.id) === btn.dataset.quick), () => N.show())));
    freshCounts();
  }
  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-enq-search]")) return;
    e.preventDefault();
    searchFor = e.target.elements.q.value.trim();
    e.target.elements.q.blur();
    N.show();
  });

  // Everything for one enquiry from the list, in one sheet: reach them, a booking link, the chat, move it, who, label
  async function quickSheet(e, redo) {
    if (!e) return;
    const dnc = !!e.do_not_contact_at, number = callNumber(e);
    const reach = [
      `<a class="btn" href="${esc(mailto(e))}" data-close>${icon("mail")} Email</a>`,
      !dnc && e.dial && `<a class="btn" href="${esc(waLink(e.dial))}" target="_blank" rel="noopener" data-close>${icon("chat")} WhatsApp</a>`,
      !dnc && number && `<a class="btn" href="tel:${esc(number)}" data-close>${icon("phone")} Call</a>`,
      !dnc && e.dial && `<a class="btn" href="${esc(smsLink(e.dial))}" data-close>${icon("chat")} Text</a>`,
    ].filter(Boolean);
    const html = `<h2 class="sheet-title">${esc(e.name || e.email || "Enquiry")}</h2>${e.subject ? `<p class="sheet-text">${esc(e.subject)}</p>` : ""}
      <a class="btn main wide" href="#inbox/enquiry/${e.id}" data-close>${e.drafts ? "Open · approve draft" : "Open & reply"}</a>
      <div class="btns two inbox-tight">${reach.join("")}</div>
      <div class="btns two inbox-tight"><button type="button" class="btn" data-q="link">Booking link</button>${e.chat_id ? `<a class="btn" href="#inbox/chat/${encodeURIComponent(e.chat_id)}" data-close>Read conversation</a>` : ""}</div>
      ${e.status === "spam" ? `<button type="button" class="btn wide" data-q="state:new">Not spam</button>` : `<p class="inbox-sheet-h">Move to</p><div class="chips inbox-move">${SORT_PLACES.map(([s, l]) => `<button type="button" class="chip" data-q="state:${s}" aria-pressed="${e.status === s}">${l}</button>`).join("")}</div>
      <div class="btns two inbox-tight"><button type="button" class="btn" data-q="who">Who's on it</button><button type="button" class="btn" data-q="label">Label</button></div>`}
      <div class="btns two inbox-tight">${e.status === "spam" ? "" : `<button type="button" class="btn quiet" data-q="state:spam">Move to Spam</button>`}<button type="button" class="btn quiet" data-no>Close</button></div>`;
    const v = await sheetForm(html, (el, done) => {
      el.querySelectorAll("[data-close]").forEach((a) => a.addEventListener("click", () => setTimeout(() => done(null), 0)));
      el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => done(b.dataset.q)));
      el.querySelector("[data-no]").onclick = () => done(null);
    });
    if (!v) return;
    // (the sheet's own "closed" comes a moment after: the next sheet waits for it, or it would close that one too)
    await new Promise((r) => setTimeout(r, 60));
    if (v.startsWith("state:")) { const s = v.slice(6); if (s !== e.status) await sortEnquiry(e.id, { state: s }, s === "new" && e.status === "spam" ? "Back in New" : SORT_SAID[s], redo); }
    else if (v === "who") await whoSheet(e, redo);
    else if (v === "label") await labelSheet(e, redo);
    else if (v === "link") await bookingLink(e);
  }
  async function sortEnquiry(id, changes, said, redo) {
    try { await send(`${A}inbox/sort`, { id: Number(id), ...changes }); toast(said); } catch (err) { fail(err); }
    await redo();
  }
  async function whoSheet(e, redo) {
    if (!teamCache.length) await api(`${A}enquiries?box=new`).then((r) => { teamCache = r.team || []; labelsCache = r.labels || labelsCache; }, () => {});
    const w = await choose({ title: "Who's on it", options: [["me", "Me"], ...teamCache.filter((t) => t.id).map((t) => [t.id, `${t.name || t.display_name}'s on it`]), ["", "Nobody's on it"]] });
    if (w === null) return;
    const said = w === "me" ? "You're on it" : w ? `${(teamCache.find((t) => String(t.id) === String(w)) || {}).name || "They"}'s on it` : "Nobody's on it";
    await sortEnquiry(e.id, { assignedTo: w || null }, said, redo);
  }
  async function labelSheet(e, redo) {
    if (!labelsCache.length) await api(`${A}enquiries?box=new`).then((r) => { labelsCache = r.labels || []; teamCache = r.team || teamCache; }, () => {});
    const used = labelsCache.filter((l) => l !== e.label).slice(0, 12);
    const v = await sheetForm(`<h2 class="sheet-title">Label</h2><form class="form" data-f>${field({ label: "Label", name: "label", value: e.label || "", placeholder: "e.g. Mixing, Vocals, Big job", attrs: 'maxlength="40" enterkeyhint="done" autocomplete="off"' })}
      ${used.length ? `<div><p class="inbox-sheet-h">Used before (tap one)</p><div class="chips">${used.map((l) => `<button type="button" class="chip" data-use="${esc(l)}">${esc(l)}</button>`).join("")}</div></div>` : ""}
      <div class="btns two"><button class="btn main" type="submit">Save</button>${e.label ? `<button type="button" class="btn" data-clear>Clear it</button>` : ""}<button type="button" class="btn quiet" data-no>Cancel</button></div></form>`,
    (el, done) => {
      el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.label.value.trim()); };
      el.querySelectorAll("[data-use]").forEach((b) => (b.onclick = () => done(b.dataset.use)));
      el.querySelector("[data-clear]")?.addEventListener("click", () => done(""));
      el.querySelector("[data-no]").onclick = () => done(null);
    });
    if (v === null || v === (e.label || "")) return;
    await sortEnquiry(e.id, { label: v }, v ? `Labelled “${v}”` : "Label cleared", redo);
  }

  // ================= One enquiry =================
  let threadTimer = 0, chatTimer = 0;
  addEventListener("hashchange", () => { clearTimeout(threadTimer); clearTimeout(chatTimer); });
  // What's waiting to be said after WhatsApp, Messages or a call (kept if the phone reloads the app meanwhile)
  const asks = (() => { try { return JSON.parse(sessionStorage.getItem("nova-phone-asks") || "{}"); } catch (e) { return {}; } })();
  const saveAsks = () => { try { sessionStorage.setItem("nova-phone-asks", JSON.stringify(asks)); } catch (e) {} };
  const askFor = (id) => (asks[id] = asks[id] || {});
  const modes = {}; // the reply box's kind per enquiry: reply, whatsapp, sms, note

  async function drawThread(box, id, ui) {
    clearTimeout(threadTimer);
    ui.back("#inbox");
    const r = await api(`${A}enquiries/thread?id=${encodeURIComponent(id)}`);
    const e = r.enquiry || {};
    if (r.team) teamCache = r.team;
    ui.title(e.name || "Enquiry");
    const msgs = (r.messages || []).filter((m) => m.status !== "discarded");
    const blocked = !!e.do_not_contact_at, canSend = r.canSend !== false, number = callNumber(e);
    const ask = askFor(id);
    // (what's being written stays while the conversation refreshes)
    const was = document.getElementById("reply");
    const typed = was && was.dataset.id === String(id) ? was.elements.body.value : "";
    let mode = modes[id] || "reply";
    if (blocked) mode = "note";
    if (!e.dial && (mode === "whatsapp" || mode === "sms")) mode = "reply";
    modes[id] = mode;

    const say = (m) => {
      const call = m.direction === "note" && String(m.body || "").startsWith(CALL_PREFIX);
      const by = { whatsapp: "WhatsApp", sms: "Text" }[m.channel] || "Reply";
      const who = call ? `Call · ${m.author_name || "Staff"}` : m.direction === "note" ? `Note · ${m.created_by === "customer" ? "Nova Bot" : m.author_name || "Staff"}` : m.created_by === "agent" ? "Draft by Nova Agent" : `${by} · ${m.author_name || "Staff"}`;
      const state = m.status === "sent" && m.channel === "whatsapp" ? `Sent on WhatsApp ✓ ${when(m.sent_at)}`
        : m.status === "sent" && m.channel === "sms" ? `Texted ✓ ${when(m.sent_at)}`
        : m.status === "sent" ? `Sent ✓ ${when(m.sent_at)}${m.approver_name && m.created_by === "agent" ? ` · approved by ${m.approver_name}` : ""}`
        : m.status === "approved" ? (m.stuck ? "Still sending? You can retry" : "Sending…")
        : m.status === "failed" ? `Didn't send: ${m.error || "unknown reason"}`
        : m.status === "draft" ? "Draft · waiting for approval" : "";
      const tone = m.status === "failed" ? "bad" : m.status === "sent" ? "ok" : m.status === "draft" ? "warn" : "muted";
      const cls = m.direction === "note" ? "say note" : m.status === "draft" ? "say me draft" : "say me";
      let btns = "";
      if (m.status === "draft") {
        btns = `<div class="btns two">${!blocked && canSend ? `<button type="button" class="btn main" data-draft="approve" data-id="${m.id}">${icon("send")} Approve &amp; send</button>` : ""}<button type="button" class="btn" data-draft="edit" data-id="${m.id}">${icon("edit")} Edit</button><button type="button" class="btn quiet" data-draft="discard" data-id="${m.id}">Discard</button></div>${!blocked && !canSend && r.onlineUrl ? cantHtml(cantHere(r.onlineUrl, "approve and send")) : ""}`;
      }
      if ((m.status === "failed" || m.stuck) && !blocked && canSend) btns += `<button type="button" class="btn" data-retry="${m.id}">${icon("refresh")} Retry</button>`;
      return `<li class="${cls}"><p class="say-who">${esc(who)}<span>${esc(when(m.created_at))}</span></p><p class="pre" data-body="${m.id}">${linkify(call ? m.body.slice(CALL_PREFIX.length) : m.body)}</p>${state ? `<p class="small ${tone}">${esc(state)}</p>` : ""}${btns}</li>`;
    };
    const first = e.details ? `<li class="say"><p class="say-who">${esc(e.name || "Them")}<span>${esc(when(e.created_at))}</span></p><p class="pre">${linkify(e.details)}</p></li>` : "";
    const sentAsk = ask.sent ? `<li class="say me inbox-ask"><p class="say-who">${ask.sent.kind === "whatsapp" ? "WhatsApp" : "Text"} · you</p>${ask.sent.body ? `<p class="pre">${esc(ask.sent.body)}</p>` : ""}
        <p><b>Did your ${ask.sent.kind === "whatsapp" ? "WhatsApp" : "text"} to ${esc(firstName(e.name) || "them")} send?</b></p>
        ${ask.sent.body ? "" : field({ label: "What you sent", name: "ask-body", type: "textarea", rows: 2, attrs: 'maxlength="4000" data-ask-body' })}
        <div class="btns two"><button type="button" class="btn main" data-ask="sent">${icon("check")} Yes, it sent</button><button type="button" class="btn" data-ask="again">${ask.sent.kind === "whatsapp" ? "Open WhatsApp again" : "Open Messages again"}</button><button type="button" class="btn quiet" data-ask="change">${ask.sent.body ? "No, change it" : "It didn't send"}</button></div>
        ${ask.sent.error ? `<p class="small bad">${esc(ask.sent.error)}</p>` : ""}</li>` : "";
    const callAsk = ask.call ? `<li class="say note inbox-ask"><p class="say-who">Call · you</p><p><b>How did the call with ${esc(firstName(e.name) || "them")} go?</b></p>
        ${field({ label: "A note for the team (optional)", name: "call-note", value: ask.call.note || "", placeholder: "e.g. booked Tuesday 2pm", attrs: 'maxlength="1000" data-call-note' })}
        <div class="btns two">${CALL_OUTCOMES.map(([v, l], i) => `<button type="button" class="btn${i === 0 ? " main" : ""}" data-call="${v}">${l}</button>`).join("")}<button type="button" class="btn quiet" data-call="">Skip</button></div>
        ${ask.call.error ? `<p class="small bad">${esc(ask.call.error)}</p>` : ""}</li>` : "";

    const reach = [
      `<a class="btn" href="${esc(mailto(e))}">${icon("mail")} Email</a>`,
      !blocked && e.dial && `<a class="btn" href="${esc(waLink(e.dial))}" target="_blank" rel="noopener" data-reach="whatsapp">${icon("chat")} WhatsApp</a>`,
      !blocked && number && `<a class="btn" href="tel:${esc(number)}" data-reach="call">${icon("phone")} Call</a>`,
      !blocked && e.dial && `<a class="btn" href="${esc(smsLink(e.dial))}" data-reach="sms">${icon("chat")} Text</a>`,
    ].filter(Boolean);
    const facts = [["From", e.name], ["Email", e.email], ["Phone", e.dial ? prettyNumber(e.dial) : e.phone], ["Came from", e.page], ["Who's on it", e.assigned_name || (e.assigned_to ? (teamCache.find((t) => String(t.id) === String(e.assigned_to)) || {}).name : "")], ["Label", e.label], ["Spam because", e.status === "spam" ? e.spam_reason : ""]].filter(([, v]) => v);
    const phoneHint = blocked ? "" : e.dial ? "WhatsApp, Call and Text use this phone. Write a WhatsApp or text below and Nova Phone opens it ready to send, then adds it here." : e.phone ? "Their number isn't a mobile, so there's no WhatsApp or texts. Call still works." : "";
    const stopWhy = blocked ? (e.do_not_contact_by === "customer" ? `They asked to stop with the link in an email (${when(e.do_not_contact_at)}). Nothing can be sent.` : `Switched on ${when(e.do_not_contact_at)}. Nothing can be sent while it's on.`) : "Switch on if they ask the studio to stop contacting them.";
    const MODES = [["reply", "Email"], ...(e.dial && !blocked ? [["whatsapp", "WhatsApp"], ["sms", "Text"]] : []), ["note", "Note"]].filter(([v]) => !blocked || v === "note");

    box.innerHTML = `<div class="card"><p class="kicker">${esc(e.status === "spam" ? "Spam" : STATE_NAME[e.status] || "Enquiry")}${e.do_not_contact_at ? " · Don't contact" : ""}${e.drafts ? " · Draft to approve" : ""}</p>
        <h2 class="card-title">${esc(e.subject || "Enquiry")}</h2>
        <div class="facts inbox-facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        <p class="small muted inbox-gap">Asked to be contacted: ${esc(when(e.consent_at || e.created_at))}${e.consent_source ? ` · ${esc(e.consent_source)}` : ""}${e.emailed ? " · Email copy sent" : ""}</p>
        ${phoneHint ? `<p class="small muted">${esc(phoneHint)}</p>` : ""}</div>
      <div class="btns two inbox-tight">${reach.join("")}</div>
      ${e.status === "spam" ? "" : `<div class="chips inbox-move" role="group" aria-label="Move to">${SORT_PLACES.map(([s, l]) => `<button type="button" class="chip" data-move="${s}" aria-pressed="${e.status === s}">${l}</button>`).join("")}</div>`}
      <div class="btns two inbox-tight"><button type="button" class="btn" data-sort="who">Who's on it</button><button type="button" class="btn" data-sort="label">Label</button><button type="button" class="btn" data-booking-link>Booking link</button>${e.chat_id ? `<a class="btn" href="#inbox/chat/${encodeURIComponent(e.chat_id)}">Read conversation</a>` : ""}</div>
      <h3 class="h">The conversation</h3>
      <ul class="talk">${first}${msgs.map(say).join("")}${sentAsk}${callAsk}${!first && !msgs.length && !sentAsk && !callAsk ? "<li class='say note'>Nothing yet.</li>" : ""}</ul>
      <form class="form" id="reply" data-id="${esc(id)}" novalidate>
        <div class="chips inbox-modes" role="group" aria-label="Reply by email, WhatsApp or text, or a note">${MODES.map(([v, l]) => `<button type="button" class="chip" data-mode="${v}" aria-pressed="${v === mode}">${l}</button>`).join("")}</div>
        <label class="field" for="reply-body"><span id="reply-label"></span><textarea class="input" id="reply-body" name="body" rows="4" maxlength="8000">${esc(typed)}</textarea><small id="reply-hint"></small></label>
        <div id="reply-online"></div>
        <div class="btns two"><button type="button" class="btn" data-use-saved>Saved replies</button><button class="btn main" type="submit" id="reply-go">${icon("send")} <span>Send</span></button></div>
        <p class="form-said" role="status"></p></form>
      <label class="switch"><span>Don't contact</span><input type="checkbox" role="switch" data-stop${blocked ? " checked" : ""}${e.do_not_contact_by === "customer" ? " disabled" : ""}></label>
      <p class="small muted inbox-under">${esc(stopWhy)}</p>
      ${e.status === "spam" ? `<button type="button" class="btn wide" data-state-to="new">Not spam</button>` : `<button type="button" class="btn quiet wide" data-state-to="spam">Move to Spam</button>`}`;

    const redo = () => drawThread(box, id, ui).catch((err) => toast(err.message, true));
    const f = box.querySelector("#reply");
    // The reply box for its kind: who it goes to, what happens, and whether this sign-in can send
    const setMode = (m) => {
      mode = modes[id] = m;
      f.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
      const name = firstName(e.name) || "them";
      box.querySelector("#reply-label").textContent = m === "note" ? "A note for the team · Team only" : m === "whatsapp" ? `To ${prettyNumber(e.dial)} on WhatsApp` : m === "sms" ? `To ${prettyNumber(e.dial)} by text` : `Reply to ${name} · To ${e.email || "them"}`;
      f.elements.body.placeholder = m === "note" ? "A note for the team (never sent)" : m === "whatsapp" ? `Write a WhatsApp message to ${name}` : m === "sms" ? `Write a text to ${name}` : `Write a reply to ${name}`;
      box.querySelector("#reply-hint").textContent = blocked && m === "note" ? "They've asked not to be contacted, so replies can't be sent. Notes still work."
        : m === "whatsapp" ? "Opens WhatsApp with this filled in. Press send there, then come back and tap “Yes, it sent”."
        : m === "sms" ? "Opens Messages with this filled in. Press send there, then come back and tap “Yes, it sent”."
        : m === "reply" && !canSend ? "" : m === "reply" ? "Emailed from the studio. Their replies come to the studio inbox. Every email says why they're getting it and how to stop." : "";
      box.querySelector("#reply-online").innerHTML = m === "reply" && !canSend ? cantHtml(cantHere(r.onlineUrl || "")) : "";
      box.querySelector("#reply-go span").textContent = m === "note" ? "Add note" : m === "whatsapp" ? "Open WhatsApp" : m === "sms" ? "Open Messages" : "Send";
      box.querySelector("#reply-go").disabled = m === "reply" && !canSend;
    };
    setMode(mode);
    f.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const body = f.elements.body.value.trim(), said = f.querySelector(".form-said");
      said.classList.remove("bad");
      if (!body) { said.textContent = "Write something first."; return; }
      if (mode === "whatsapp" || mode === "sms") {
        if (mode === "whatsapp") window.open(waLink(e.dial, body), "_blank", "noopener"); else location.href = smsLink(e.dial, body);
        ask.sent = { kind: mode, body, key: pressKey() };
        saveAsks();
        f.elements.body.value = "";
        f.classList.remove("dirty");
        setTimeout(redo, 300);
        return;
      }
      const note = mode === "note";
      if (!note && !(await confirm({ title: `Email this to ${e.name || e.email}?`, text: "It goes straight to them from the studio.", ok: "Send" }))) return;
      await busy(f.querySelector("[type=submit]"), note ? "Adding…" : "Sending…", async () => {
        try {
          const d = await send(`${A}enquiries/${note ? "note" : "reply"}`, { id: Number(id), body, key: pressKey() });
          f.classList.remove("dirty");
          f.elements.body.value = "";
          if (!note && d.message && d.message.status === "failed") toast(`Didn't send: ${d.message.error || "unknown reason"}`, true);
          else toast(note ? "Note added" : `Sent to ${e.name || "them"}`);
          await redo();
        } catch (err) {
          if (err.signIn) return fail(err);
          said.textContent = err.onlineUrl ? cantHere(err.onlineUrl).text : `Not sent: ${err.message}`;
          said.classList.add("bad");
        }
      });
    });
    box.querySelector("[data-use-saved]").addEventListener("click", async () => {
      const s = await api(`${A}inbox/saved`).catch(() => ({ saved: [] }));
      if (!(s.saved || []).length) return toast("No saved replies yet: add them in Saved replies.");
      const pick = await choose({ title: "Start from a saved reply", options: s.saved.map((x) => [x.id, x.title || x.name]) });
      const chosen = s.saved.find((x) => String(x.id) === String(pick));
      if (!chosen) return;
      const t = f.elements.body, text = String(chosen.body || "").replace(/\{name\}/gi, firstName(e.name) || "there");
      t.value = t.value.trim() ? `${t.value.replace(/\s+$/, "")}\n\n${text}` : text;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      toast("Filled in: check it, then Send");
    });
    // Reaching them from this phone: a call asks how it went; WhatsApp or a text asks what was sent
    box.querySelectorAll("[data-reach]").forEach((a) => a.addEventListener("click", () => {
      if (a.dataset.reach === "call") ask.call = ask.call || { key: pressKey(), note: "" };
      else ask.sent = ask.sent || { kind: a.dataset.reach, body: "", key: pressKey() };
      saveAsks();
      setTimeout(redo, 400);
    }));
    box.querySelectorAll("[data-ask]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.ask, s = ask.sent;
      if (what === "again") { if (s.kind === "whatsapp") window.open(waLink(e.dial, s.body), "_blank", "noopener"); else location.href = smsLink(e.dial, s.body); return; }
      if (what === "change") { delete ask.sent; saveAsks(); if (s.body) { modes[id] = s.kind; await redo(); const t = document.getElementById("reply-body"); if (t) { t.value = s.body; t.dispatchEvent(new Event("input", { bubbles: true })); t.focus(); } } else redo(); return; }
      const body = s.body || box.querySelector("[data-ask-body]")?.value.trim() || "";
      if (!body) { s.error = "Write what you sent first."; return redo(); }
      await busy(b, "Adding…", async () => {
        try { await send(`${A}enquiries/logged`, { id: Number(id), kind: s.kind, body, key: s.key }); delete ask.sent; saveAsks(); toast("Added to the conversation"); }
        catch (err) { if (err.signIn) return fail(err); s.error = err.message; }
        await redo();
      });
    }));
    box.querySelector("[data-call-note]")?.addEventListener("input", (ev) => { ask.call.note = ev.target.value; saveAsks(); });
    box.querySelectorAll("[data-call]").forEach((b) => b.addEventListener("click", async () => {
      const outcome = b.dataset.call, c = ask.call;
      if (!outcome) { delete ask.call; saveAsks(); return redo(); }
      const note = (box.querySelector("[data-call-note]")?.value || "").trim();
      await busy(b, "Adding…", async () => {
        try {
          // (Nova Bot keeps calls for mobiles; a landline's call is kept as the same "Phone call: …" note)
          if (e.dial) await send(`${A}enquiries/logged`, { id: Number(id), kind: "call", outcome, body: note, key: c.key });
          else await send(`${A}enquiries/note`, { id: Number(id), body: `${CALL_PREFIX}${CALL_OUTCOMES.find(([v]) => v === outcome)[1]}${note ? `\n${note}` : ""}`, key: c.key });
          delete ask.call; saveAsks(); toast("Call added to the conversation");
        } catch (err) { if (err.signIn) return fail(err); c.error = err.message; }
        await redo();
      });
    }));
    box.querySelectorAll("[data-move]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.move === e.status) return;
      busy(b, "…", () => sortEnquiry(id, { state: b.dataset.move }, SORT_SAID[b.dataset.move], redo));
    }));
    box.querySelector('[data-sort="who"]').addEventListener("click", () => whoSheet(e, redo));
    box.querySelector('[data-sort="label"]').addEventListener("click", () => labelSheet(e, redo));
    box.querySelector("[data-booking-link]").addEventListener("click", () => bookingLink(e));
    box.querySelectorAll("[data-state-to]").forEach((b) => b.addEventListener("click", () => busy(b, "Moving…", () => sortEnquiry(id, { state: b.dataset.stateTo }, b.dataset.stateTo === "spam" ? SORT_SAID.spam : "Back in New", redo))));
    box.querySelector("[data-stop]").addEventListener("change", async (ev) => {
      const on = ev.target.checked;
      if (on && !(await confirm({ title: "Don't contact them?", text: "Nothing more can be sent to them from Nova while it's on. Notes still work.", ok: "Don't contact" }))) { ev.target.checked = false; return; }
      ev.target.disabled = true;
      try { await send(`${A}enquiries/contact`, { id: Number(id), doNotContact: on }); toast(on ? "They won't be contacted" : "Replies are allowed again"); }
      catch (err) { ev.target.checked = !on; fail(err); }
      await redo();
    });
    wireDrafts(box, id, e, redo);
    // (new words: looked for every 10 seconds while it's open and on screen, not while writing)
    threadTimer = setTimeout(function again() {
      if (location.hash !== `#inbox/enquiry/${id}` || !box.isConnected) return;
      if (document.hidden || box.querySelector("#reply.dirty, input:focus, textarea:focus") || document.querySelector(".sheet[open]")) { threadTimer = setTimeout(again, 10000); return; }
      redo();
    }, 10000);
  }
  function wireDrafts(box, id, e, redo) {
    box.querySelectorAll("[data-draft]").forEach((b) => b.addEventListener("click", async () => {
      const mid = Number(b.dataset.id), what = b.dataset.draft;
      const text = box.querySelector(`[data-body="${mid}"]`)?.textContent || "";
      if (what === "edit") {
        const v = await sheetForm(`<h2 class="sheet-title">Edit the draft</h2><form class="form" data-f>${field({ label: "The reply", name: "body", type: "textarea", rows: 8, value: text, attrs: 'maxlength="8000"' })}<div class="btns"><button class="btn main wide" type="submit" value="approve">${icon("send")} Approve &amp; send</button><button class="btn wide" type="submit" value="save">Save the draft</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
          (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ how: ev.submitter?.value || "save", body: ev.target.elements.body.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
        if (!v) return;
        try {
          const d = await send(`${A}enquiries/draft/${v.how === "approve" ? "approve" : "edit"}`, { messageId: mid, body: v.body });
          if (v.how === "approve" && d.message && d.message.status === "failed") toast(`Didn't send: ${d.message.error || "unknown reason"}`, true);
          else toast(v.how === "approve" ? `Sent to ${e.name || "them"}` : "Draft saved");
        } catch (err) { fail(err); }
        return redo();
      }
      if (what === "approve" && !(await confirm({ title: "Send this reply?", text: "It's emailed to them straight away.", ok: "Approve & send" }))) return;
      if (what === "discard" && !(await confirm({ title: "Discard the draft?", ok: "Discard", danger: true }))) return;
      await busy(b, what === "approve" ? "Sending…" : "…", async () => {
        try {
          const d = await send(`${A}enquiries/draft/${what}`, what === "approve" ? { messageId: mid, body: text } : { messageId: mid });
          if (what === "approve" && d.message && d.message.status === "failed") toast(`Didn't send: ${d.message.error || "unknown reason"}`, true);
          else toast(what === "approve" ? `Sent to ${e.name || "them"}` : "Draft discarded");
        } catch (err) { fail(err); }
        await redo();
      });
    }));
    box.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => busy(b, "Trying again…", async () => {
      try { const d = await send(`${A}enquiries/retry`, { messageId: Number(b.dataset.retry) }); toast(d.message && d.message.status === "sent" ? "Sent ✓" : `Didn't send: ${(d.message && d.message.error) || "unknown reason"}`, !(d.message && d.message.status === "sent")); } catch (err) { fail(err); }
      await redo();
    })));
  }

  // A link for them to book a session: make it, then copy it, email it to them, or share it
  async function bookingLink(e) {
    const s = await api(`${A}sessions`).catch((err) => ({ error: err.message }));
    const sessions = s.sessions || [];
    if (!sessions.length) return toast(s.error || "No sessions to book", true);
    await sheetForm(`<h2 class="sheet-title">Booking link</h2><p class="sheet-text">For ${esc(e.name || "them")}${e.email ? ` (${esc(e.email)})` : ""}</p>
      <form class="form" data-f>${field({ label: "Which session", name: "type", type: "select", options: sessions.map((x) => [x.id, `${x.name}${x.price ? ` (${x.price})` : ""}`]) })}
        <button class="btn main wide" type="submit">Make link</button><p class="form-said" role="alert"></p></form>
      <div data-result hidden></div><button type="button" class="btn quiet wide" data-no>Close</button>`,
    (el, done) => {
      el.querySelector("[data-no]").onclick = () => done(null);
      const f = el.querySelector("[data-f]");
      f.onsubmit = async (ev) => {
        ev.preventDefault();
        const said = f.querySelector(".form-said");
        said.textContent = "";
        await busy(f.querySelector("[type=submit]"), "Making…", async () => {
          try {
            const r = await send(`${A}booking-link`, { enquiryId: Number(e.id), typeId: Number(f.elements.type.value) });
            const body = `Hi ${firstName(e.name)},\n\nThanks for your enquiry. You can book your session here: pick a time on the calendar and pay the deposit to confirm.\n\n${r.session || ""}\n${r.url}\n\nNovacane Studios`;
            const out = el.querySelector("[data-result]");
            out.hidden = false;
            out.innerHTML = `${field({ label: "The link", name: "link", value: r.url, attrs: 'readonly data-link' })}
              <div class="btns two inbox-gap"><button type="button" class="btn" data-copy>Copy</button>${e.email ? `<a class="btn main" href="${esc(`mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent("Booking your session at Novacane")}&body=${encodeURIComponent(body)}`)}">${icon("mail")} Email it to them</a>` : ""}${navigator.share ? `<button type="button" class="btn" data-share>${icon("share")} Share</button>` : ""}</div>`;
            out.querySelector("[data-copy]").onclick = async () => { try { await navigator.clipboard.writeText(r.url); toast("Link copied"); } catch (err) { out.querySelector("[data-link]").select(); toast("Select the link and copy it"); } };
            out.querySelector("[data-share]")?.addEventListener("click", () => navigator.share({ title: "Booking link", text: `Hi ${firstName(e.name)}, here's the link to book your ${r.session || "session"}: ${r.url}` }).catch(() => {}));
          } catch (err) { said.textContent = err.message; said.classList.add("bad"); }
        });
      };
    });
  }

  // ================= Saved replies =================
  async function drawSaved(box, ui) {
    ui.back("#inbox");
    ui.title("Saved replies");
    const r = await api(`${A}inbox/saved`);
    const saved = r.saved || [];
    ui.action({ icon: "plus", label: "New saved reply", run: () => editSaved(null) });
    box.innerHTML = `<p class="muted small">The team's answers to routine questions. Picking one in an enquiry fills the reply box ({name} becomes their first name); it still only goes when someone presses Send.</p>${saved.length ? list(saved.map((x) => row({ button: `data-saved="${esc(x.id)}"`, icon: "chat", title: x.title || x.name || "Saved reply", text: String(x.body || "").slice(0, 140) }))) : empty({ icon: "chat", title: "No saved replies yet", text: "Add the answers you give most often.", action: `<button type="button" class="btn" data-new-saved>${icon("plus")} Add one</button>` })}`;
    box.querySelector("[data-new-saved]")?.addEventListener("click", () => editSaved(null));
    box.querySelectorAll("[data-saved]").forEach((b) => b.addEventListener("click", () => editSaved(saved.find((x) => String(x.id) === b.dataset.saved))));
    async function editSaved(x) {
      const v = await sheetForm(`<h2 class="sheet-title">${x ? "Change the saved reply" : "New saved reply"}</h2><form class="form" data-f>${field({ label: "Name", name: "title", value: x?.title || x?.name || "", placeholder: "e.g. Prices", required: true, attrs: 'maxlength="80"' })}${field({ label: "The reply", name: "body", type: "textarea", rows: 6, value: x?.body || "", required: true, attrs: 'maxlength="4000"' })}
        <div class="btns"><button class="btn main wide" type="submit" value="save">${x ? "Save changes" : "Add saved reply"}</button>${x ? `<button type="submit" class="btn danger wide" value="remove">Remove</button>` : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ how: ev.submitter?.value || "save", title: ev.target.elements.title.value.trim(), body: ev.target.elements.body.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      try {
        if (v.how === "remove") { if (!(await confirm({ title: "Remove this saved reply?", ok: "Remove", danger: true }))) return; await send(`${A}inbox/saved/remove`, { id: x.id }); toast("Removed"); }
        else { if (!v.title || !v.body.trim()) return toast("Give it a name and the reply", true); await send(`${A}inbox/saved`, { ...(x ? { id: x.id } : {}), title: v.title, body: v.body }); toast(x ? "Saved" : "Added"); }
        N.show();
      } catch (err) { fail(err); }
    }
  }

  // ================= Website chats =================
  let chatFilter = "all";
  async function drawChats(box, filter, ui) {
    chatFilter = ["needs-person", "done"].includes(filter) ? filter : "all";
    const r = await api(`${A}conversations`);
    const all = r.conversations || [];
    counts.chats = r.needsPerson || 0;
    const shown = all.filter((c) => chatFilter === "all" || c.ticket === chatFilter);
    const item = (c) => {
      const pills = [c.live === "staff" ? `<span class="pill ok">Live${c.live_name ? ` · ${esc(c.live_name)}` : ""}</span>` : "", c.ticket === "needs-person" ? '<span class="pill warn">Needs a person</span>' : "", c.ticket === "done" ? '<span class="pill">Done</span>' : "", c.enquiries ? '<span class="pill">Enquiry</span>' : ""].filter(Boolean).join(" ");
      const foot = [`${c.messages} ${c.messages === 1 ? "message" : "messages"}`, c.assigned_name ? `${c.assigned_name}'s on it` : ""].filter(Boolean).join(" · ");
      return withButton(row({ href: `#inbox/chat/${encodeURIComponent(c.chat_id)}`, icon: "chat", title: String(c.first_question || "(no question)").slice(0, 160), html: `${pills ? `<span class="inbox-pills">${pills}</span>` : ""}<span class="inbox-foot">${esc(foot)}</span>`, end: esc(N.ago(c.last || c.started)), cls: c.ticket === "done" ? "done-row" : "" }),
        `<button type="button" class="inbox-more" data-mark-chat="${esc(c.chat_id)}" aria-label="Mark this chat">${DOTS}</button>`);
    };
    box.innerHTML = `${partTabs("chats")}<p class="muted small">What customers asked NovaBot. Kept for 90 days.</p>
      <div class="chips">${[["all", "All"], ["needs-person", "Needs a person"], ["done", "Done"]].map(([f, l]) => `<a class="chip" href="#inbox/chats/${f}"${f === chatFilter ? ' aria-current="page"' : ""}>${l}${f === "needs-person" && r.needsPerson ? ` <span class="n">${r.needsPerson}</span>` : ""}</a>`).join("")}</div>
      ${shown.length ? list(shown.map(item)) : empty({ icon: "chat", title: chatFilter === "needs-person" ? "No chats waiting for a person" : chatFilter === "done" ? "No chats marked done yet" : "No conversations yet" })}`;
    box.querySelectorAll("[data-mark-chat]").forEach((b) => b.addEventListener("click", () => {
      const c = all.find((x) => String(x.chat_id) === b.dataset.markChat);
      markSheet(c.chat_id, c.ticket, () => N.show());
    }));
    freshCounts();
  }
  // A chat's mark: Needs a person (you're on it) or Done; the one it has can be cleared
  async function markSheet(chatId, ticket, redo) {
    const options = [["needs-person", "Needs a person"], ["done", "Done"]].filter(([s]) => s !== ticket);
    if (ticket) options.push(["clear", "Clear the mark"]);
    const v = await choose({ title: "Mark this chat", options });
    if (v) await markChat(chatId, v === "clear" ? null : v, redo);
  }
  async function markChat(chatId, state, redo) {
    try {
      await send(`${A}inbox/chat`, { chatId, state, ...(state === "needs-person" ? { assignedTo: "me" } : {}) });
      toast(state === "needs-person" ? "Marked: needs a person (you're on it)" : state === "done" ? "Marked done" : "Mark cleared");
    } catch (err) { fail(err); }
    await redo();
  }
  async function drawChat(box, chatId, ui) {
    clearTimeout(chatTimer);
    ui.back("#inbox/chats");
    ui.title("Website chat");
    const r = await api(`${A}conversations?chat=${encodeURIComponent(chatId)}`);
    const msgs = r.messages || [], live = r.live || { mode: "bot" }, t = r.ticket || null;
    const ticket = t && t.state, mine = live.mode === "staff";
    const was = document.getElementById("chat-body");
    const typed = was && was.dataset.chat === String(chatId) ? was.value : "";
    const lines = msgs.map((m) => (m.role === "note" ? `<li class="say note">${linkify(m.content)} · ${esc(when(m.created_at))}</li>`
      : `<li class="${m.role === "user" ? "say" : "say me"}"><p class="say-who">${m.role === "user" ? "Customer" : m.role === "staff" ? `${esc(m.sender || "Someone")} (studio)` : "NovaBot"}<span>${esc(when(m.created_at))}</span></p>${m.page ? `<p class="small muted inbox-page">${esc(m.page)}</p>` : ""}<p class="pre">${linkify(m.content)}</p></li>`)).join("");
    const redo = () => drawChat(box, chatId, ui).catch((err) => toast(err.message, true));
    if (!msgs.length) { box.innerHTML = empty({ icon: "chat", title: "This conversation has been deleted", text: "Conversations are kept for 90 days." }); return; }
    box.innerHTML = `<div class="card"><p class="small">${ticket === "needs-person" ? `<b>Needs a person</b>${t.assigned_name ? `: ${esc(t.assigned_name)}'s on it` : ""}` : ticket === "done" ? "<b>Done</b>" : "Does this chat need someone from the studio to follow it up?"}</p>
        <div class="chips">${[["needs-person", "Needs a person"], ["done", "Done"]].map(([s, l]) => `<button type="button" class="chip" data-mark="${s}" aria-pressed="${ticket === s}">${l}</button>`).join("")}</div></div>
      <div class="card"><p class="small">${mine ? `${esc(live.staffName || "Someone")} from the studio has this chat. NovaBot is paused.` : "NovaBot is answering this chat. Reply below (or Take over) to answer the visitor yourself."}</p>
        <button type="button" class="btn wide" data-live="${mine ? "handback" : "takeover"}">${mine ? "Hand back to NovaBot" : "Take over"}</button></div>
      <ul class="talk">${lines}</ul>
      <p class="small muted">The visitor sees your first name. Replies here go straight to them (no approval needed: they started the chat).</p>
      <form class="composer" id="chat-reply"><label class="sr" for="chat-body">Write to the visitor</label><textarea class="input" id="chat-body" data-chat="${esc(chatId)}" rows="1" maxlength="1500" placeholder="${mine ? "Write to the visitor" : "Write to the visitor (takes the chat over)"}">${esc(typed)}</textarea><button class="btn main" type="submit" aria-label="Send">${icon("send")}</button></form>`;
    const liveDo = (action, extra = {}) => send(`${A}conversations/live`, { chatId, action, ...extra });
    box.querySelector("#chat-reply").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const ta = box.querySelector("#chat-body"), text = ta.value.trim(), btn = ev.target.querySelector("[type=submit]");
      if (!text || btn.disabled) return;
      btn.disabled = true;
      try { await liveDo("reply", { text }); ta.value = ""; ev.target.classList.remove("dirty"); await redo(); } catch (err) { fail(err); btn.disabled = false; }
    });
    box.querySelector("[data-live]").addEventListener("click", (ev) => busy(ev.currentTarget, "…", async () => {
      try { await liveDo(mine ? "handback" : "takeover"); toast(mine ? "NovaBot has the chat again" : "You have the chat. The visitor sees you joined."); } catch (err) { fail(err); }
      await redo();
    }));
    box.querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", () => busy(b, "…", () => markChat(chatId, ticket === b.dataset.mark ? null : b.dataset.mark, redo))));
    const page = document.getElementById("page");
    requestAnimationFrame(() => (page.scrollTop = page.scrollHeight));
    // (the visitor's new messages, by themselves: every few seconds while someone has it, else every 10)
    chatTimer = setTimeout(function again() {
      if (!box.isConnected || !location.hash.startsWith("#inbox/chat/")) return;
      if (document.hidden || document.activeElement?.id === "chat-body" || box.querySelector("#chat-reply.dirty")) { chatTimer = setTimeout(again, 5000); return; }
      redo();
    }, mine ? 4000 : 10000);
  }

  // ================= Alerts =================
  async function drawAlerts(box, ui) {
    // (what had been seen, read before the list comes: phone.js counts them seen as soon as it arrives here)
    const before = seenAlert();
    const r = await api(`${A}notifications`);
    const all = r.notifications || [];
    const days = Number(r.autoDeleteDays) || 0;
    // (looked at: they count as seen; the ones new since last time keep their mark this once)
    if (all.length) remember.set("nova-seen-alert", String(Math.max(before, all[0].id)));
    counts.alerts = 0;
    const fresh = all.filter((n) => n.id > before).length;
    box.innerHTML = `${partTabs("alerts")}
      <a class="card inbox-phone" href="#inbox/alert/phone"><p class="kicker">This phone</p><p><b>Notifications on this phone</b></p><p class="muted small" id="push-state">Get a notification here for new enquiries and bookings.</p></a>
      ${fresh ? `<p class="small"><b>${fresh} new</b> since you last looked</p>` : ""}
      ${all.length ? `${list(all.map((n) => withButton(alertRowSeen(n, before), `<button type="button" class="inbox-more inbox-del" data-del="${n.id}" aria-label="Delete this alert: ${esc(n.title || "")}">${icon("trash")}</button>`)))}<button type="button" class="btn danger wide" data-del-all>${icon("trash")} Delete all ${all.length}</button>` : empty({ icon: "bell", title: "No alerts yet", text: "New enquiries and bookings appear here once they've reached a phone." })}
      ${field({ label: "Delete alerts automatically after", name: "auto", type: "select", value: days, options: [[0, "Never: keep them (90 days)"], ...((r.choices || [1, 3, 7, 14, 30]).map((d) => [d, `${d} day${d === 1 ? "" : "s"}`]))], attrs: "data-auto" })}`;
    pushState().then((s) => { const el = box.querySelector("#push-state"); if (el) el.textContent = s.words; });
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
      try { await send(`${A}notifications/delete`, { id: Number(b.dataset.del) }); toast("Alert deleted"); N.show(); } catch (err) { fail(err); }
    })));
    box.querySelector("[data-del-all]")?.addEventListener("click", async (ev) => {
      if (!(await confirm({ title: `Delete all ${all.length} alerts?`, text: "They're gone for everyone.", ok: "Delete all", danger: true }))) return;
      await busy(ev.target, "Deleting…", async () => { try { await send(`${A}notifications/delete`, { all: true }); toast("All alerts deleted"); N.show(); } catch (err) { fail(err); } });
    });
    box.querySelector("[data-auto]").addEventListener("change", async (ev) => {
      const d = Number(ev.target.value);
      try { await send(`${A}notifications/settings`, { days: d }); toast(d ? `Alerts delete themselves after ${d} ${d === 1 ? "day" : "days"}` : "Alerts are kept (90 days)"); N.show(); } catch (err) { fail(err); }
    });
    freshCounts();
  }
  const NOVA_SOURCES = ["Quest: ", "Mission: ", "Nova Agent: "];
  async function drawAlert(box, id, ui) {
    ui.back("#inbox/alerts");
    if (id === "phone") return drawPush(box, ui);
    ui.title("Alert");
    const r = await api(`${A}notifications`);
    const n = (r.notifications || []).find((x) => String(x.id) === String(id));
    if (!n) { box.innerHTML = empty({ icon: "bell", title: "That alert's been deleted", action: `<a class="btn" href="#inbox/alerts">All alerts</a>` }); return; }
    const c = n.contact || {};
    const btns = [];
    // (Quest, Mission and Nova Agent alerts: the card is the whole message)
    // (the enquiry itself when Nova Bot says which: enquiryId)
    const enq = n.enquiryId || n.enquiry_id;
    if (enq) btns.push(`<a class="btn main" href="#inbox/enquiry/${esc(enq)}">Open enquiry</a>`);
    else if (!NOVA_SOURCES.some((p) => String(n.title || "").startsWith(p)) && n.url) {
      const to = placeFor(n.url);
      if (typeof to === "object") btns.push(`<a class="btn main" href="${esc(to.out)}" target="_blank" rel="noopener">${/acuityscheduling/.test(to.out) ? "Open in Acuity" : /calendar\.google|google\.com\/calendar/.test(to.out) ? "Open in Google Calendar" : "Open it"}</a>`);
      else if (to.startsWith("#money")) btns.push(`<a class="btn main" href="${esc(to)}">Open in Invoicer</a>`);
      else if (to === "#inbox/alerts" && (n.kind === "enquiry" || c.email)) btns.push(`<button type="button" class="btn main" data-find="${esc(c.email || c.name || "")}">Open enquiry</button>`);
      else if (to !== "#inbox/alerts") btns.push(`<a class="btn main" href="${esc(to)}">${to.startsWith("#inbox/enquiry") || to === "#inbox" ? "Open enquiry" : to.startsWith("#inbox/approvals") ? "Open in Approvals" : to.startsWith("#inbox/chat") ? "Read conversation" : "Open it"}</a>`);
    }
    if (c.email) btns.push(`<a class="btn" href="mailto:${esc(encodeURIComponent(c.email))}">${icon("mail")} Email</a>`);
    if (c.phone) btns.push(`<a class="btn" href="tel:${esc(String(c.phone).replace(/[^0-9+]/g, ""))}">${icon("phone")} Call</a>`);
    if (n.email && n.email.gmail) btns.push(`<a class="btn" href="${esc(n.email.gmail)}" target="_blank" rel="noopener">Open in Gmail</a>`);
    const em = n.email;
    const emHead = em ? `${em.source === "booking" ? "Booking now" : em.source === "calendar" ? "From Acuity's calendar" : `From Acuity's ${{ scheduled: "booking", rescheduled: "move", canceled: "cancellation" }[em.kind] || "update"} email`}${em.at ? ` · ${when(em.at)}` : ""}` : "";
    box.innerHTML = `<div class="card"><p class="kicker">${esc(kindName(n))}</p><h2 class="card-title">${esc(n.title || "Alert")}</h2>
        <p class="muted small">${esc(exactTime(n.created_at))}</p>
        ${n.kind === "test" ? `<p class="inbox-verify unknown">A test notification: not a real booking or enquiry.</p>` : ""}
        <div id="verify"></div>
        ${n.body ? `<p class="pre">${linkify(n.body)}</p>` : ""}
        <p class="small muted">Alert #${esc(n.id)} · delivered to ${Number(n.phones) || 0} ${n.phones === 1 ? "phone" : "phones"}</p></div>
      ${em ? `<div class="card"><p class="kicker">${esc(emHead)}</p>${em.same ? `<p class="small muted">The same as above.</p>` : `<p class="pre">${esc((em.lines || []).join("\n"))}</p>`}</div>` : ""}
      ${btns.length ? `<div class="btns two">${btns.join("")}</div>` : ""}
      <button type="button" class="btn danger wide" data-del-one>${icon("trash")} Delete this alert</button>`;
    // A booking in Acuity: checked with Acuity itself, so a real booking can't be mistaken for a test or a fake
    if (n.kind === "booking" && n.appointmentId) {
      const v = box.querySelector("#verify");
      v.innerHTML = `<p class="inbox-verify checking">Checking with Acuity…</p>`;
      api(`${A}verify-booking?id=${encodeURIComponent(n.appointmentId)}`).catch((err) => ({ status: "unknown", title: err.message, lines: [] })).then((x) => {
        v.innerHTML = `<div class="inbox-verify ${esc(x.status || "unknown")}"><b>${{ real: "✓ ", cancelled: "✕ ", missing: "⚠ " }[x.status] || ""}${esc(x.title || "")}</b>${(x.lines || []).map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
      });
    }
    box.querySelector("[data-find]")?.addEventListener("click", (ev) => { searchFor = ev.currentTarget.dataset.find; location.hash = "#inbox/box/all"; });
    box.querySelector("[data-del-one]").addEventListener("click", (ev) => busy(ev.currentTarget, "Deleting…", async () => { try { await send(`${A}notifications/delete`, { id: Number(n.id) }); toast("Alert deleted"); location.hash = "#inbox/alerts"; } catch (err) { fail(err); } }));
  }

  // ---- Notifications on this phone (Portal's own: the same keys, the same list of phones) ----
  const ready = () => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("Notifications aren't available here")), 4000))]);
  // (a phone that turned them on in Portal's old app (/app/, /portal/) keeps that address: one per phone, nothing twice)
  async function pushDoorman() {
    for (const scope of ["/app/", "/portal/"]) {
      const old = await navigator.serviceWorker.getRegistration(scope).catch(() => null);
      if (old && old.scope.endsWith(scope) && (await old.pushManager.getSubscription().catch(() => null))) return old;
    }
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
    return ready();
  }
  const keyBytes = (text) => Uint8Array.from(atob((text + "===".slice((text.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  const isIPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  let renewNeeded = false;
  async function pushState() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      return { can: false, on: false, words: isIPhone ? "On an iPhone, notifications only work once Nova Phone is on the Home Screen: in Safari, tap Share, then Add to Home Screen, then open it from there." : "This browser can't show notifications." };
    }
    if (Notification.permission === "denied") return { can: false, on: false, words: isIPhone ? "Notifications are blocked for this app. Turn them on in the iPhone's Settings, then Notifications, then Nova Phone (or Portal or Nova Agent, if you added one to the Home Screen before)." : "Notifications are blocked for Nova in this phone's settings: allow them for this site in the browser's settings, then come back." };
    const reg = await pushDoorman().catch(() => null);
    const sub = reg && (await reg.pushManager.getSubscription().catch(() => null));
    return { can: !!reg, on: !!sub, sub, reg, words: sub ? "Notifications are on for this phone." : renewNeeded ? "Nova's notification keys changed. Tap Turn on notifications once to get them on this phone again." : reg ? "Get a notification here for new enquiries and bookings." : "Notifications aren't available here." };
  }
  const pingsOn = () => remember.get("nova-phone-pings", "on") !== "off";
  async function drawPush(box, ui) {
    ui.title("Notifications");
    const s = await pushState();
    box.innerHTML = `<div class="card"><p class="kicker">This phone</p><h2 class="card-title">${s.on ? "Notifications are on" : "Notifications are off"}</h2><p class="muted">${esc(s.words)}</p></div>
      ${s.can ? (s.on ? `<button type="button" class="btn wide" data-push="test">${icon("bell")} Send a test</button><button type="button" class="btn quiet wide" data-push="off">Turn off on this phone</button>` : `<button type="button" class="btn main wide" data-push="on">${icon("bell")} Turn on notifications</button>`) : ""}
      <p class="form-said" role="status" data-push-said></p>
      <h3 class="h">While Nova Phone is open</h3>
      ${toggle({ label: "A ping and a banner when one arrives", name: "pings", checked: pingsOn() })}
      <p class="small muted inbox-under">A soft bell and a banner along the top; tap the banner for Alerts. What's on screen brings itself up to date either way.</p>
      <button type="button" class="btn wide" data-push="hear">${icon("play")} Hear the ping</button>`;
    const said = box.querySelector("[data-push-said]");
    box.querySelector('[name="pings"]').addEventListener("change", (ev) => { remember.set("nova-phone-pings", ev.target.checked ? "on" : "off"); toast(ev.target.checked ? "Pings on" : "Pings off"); });
    box.querySelectorAll("[data-push]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.push === "hear") { wake(); ping("agent", true); return; }
      busy(b, "…", async () => {
        said.textContent = "";
        said.classList.remove("bad");
        try {
          if (b.dataset.push === "on") {
            // (the phone's own "Allow notifications?" first, straight from the tap: iPhones only ask then)
            const answer = await Notification.requestPermission();
            if (answer !== "granted") { N.show(); return; }
            const { publicKey } = await api(`${A}push/key`);
            if (!publicKey) throw new Error("Notifications aren't set up on the server yet.");
            const reg = await pushDoorman();
            const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
            await send(`${A}push/subscribe`, { subscription: sub.toJSON() });
            renewNeeded = false;
            toast("Notifications are on");
          } else if (b.dataset.push === "test") {
            const { delivered } = await send(`${A}push/test`, {});
            toast(delivered ? `Test sent to ${delivered} ${delivered === 1 ? "phone" : "phones"}` : "No phones got it. Try turning notifications off and on.", !delivered);
            return;
          } else {
            if (s.sub) { await send(`${A}push/unsubscribe`, { endpoint: s.sub.endpoint }).catch(() => {}); await s.sub.unsubscribe(); }
            toast("Notifications are off on this phone");
          }
          N.show();
        } catch (err) {
          if (err.signIn) return fail(err);
          said.textContent = `${b.dataset.push === "on" ? "Couldn't turn notifications on" : "That didn't work"}: ${err.message}`;
          said.classList.add("bad");
        }
      });
    }));
  }
  // When the server's notification keys change: a new address with the new key, quietly (the phone already said
  // Allow), or once, calmly, that they need turning on again
  let renewChecked = false;
  async function renewPush() {
    if (renewChecked || !("PushManager" in window) || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    renewChecked = true;
    try {
      const reg = await pushDoorman();
      const sub = await reg.pushManager.getSubscription();
      const had = sub && sub.options && sub.options.applicationServerKey;
      if (!had) return;
      const { publicKey } = await api(`${A}push/key`);
      if (!publicKey) return;
      const want = keyBytes(publicKey), old = new Uint8Array(had);
      if (old.length === want.length && old.every((x, i) => x === want[i])) return;
      await send(`${A}push/unsubscribe`, { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
      try {
        const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
        await send(`${A}push/subscribe`, { subscription: fresh.toJSON() });
      } catch (err) {
        if (err.signIn) return;
        renewNeeded = true;
        toast("Notifications need turning on again: Alerts, then Notifications on this phone");
      }
    } catch (err) {}
  }

  // ---- A notification arriving while Nova Phone is open: a soft ping, a banner, what's on screen refreshed ----
  let sound = null;
  function wake() {
    try {
      if (!sound) sound = new (window.AudioContext || window.webkitAudioContext)();
      if (sound.state === "suspended") sound.resume().catch(() => {});
      // (back to sleep soon after: a running sound maker keeps the phone's audio awake in silence)
      clearTimeout(wake.t);
      wake.t = setTimeout(() => sound && sound.state === "running" && sound.suspend().catch(() => {}), 4000);
    } catch (e) {}
  }
  // (phones only allow sound after a tap: the first tap unlocks it, once)
  document.addEventListener("pointerdown", () => pingsOn() && wake(), { once: true, passive: true });
  const PINGS = { starting: [1318.5, 1975.5], leave: [1174.7, 1568, 2093], pulse: [2093], checkin: [1760, 1760, 2349.3, 2349.3], mission: [1046.5, 1318.5, 1568, 2093, 2637], agent: [880, 1318.5] };
  function ping(kind, again) {
    if (!sound) return navigator.vibrate && navigator.vibrate([200, 100, 200]);
    if (sound.state !== "running") {
      if (again === "woken") return;
      sound.resume().then(() => ping(kind, "woken"), () => navigator.vibrate && navigator.vibrate([200, 100, 200]));
      return;
    }
    const t0 = sound.currentTime + 0.02;
    (PINGS[kind] || PINGS.starting).forEach((freq, i) => {
      const t = t0 + i * 0.16;
      [[freq, 0.09], [freq * 2, 0.018]].forEach(([f, loud]) => {
        const osc = sound.createOscillator(), gain = sound.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(loud, t + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
        osc.connect(gain).connect(sound.destination);
        osc.start(t);
        osc.stop(t + 1.3);
      });
    });
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);
    clearTimeout(wake.t);
    wake.t = setTimeout(() => sound && sound.state === "running" && sound.suspend().catch(() => {}), 2500);
  }
  function banner(d) {
    if (d.tag) document.querySelectorAll(".inbox-banner").forEach((b) => b.dataset.tag === d.tag && b.remove());
    const b = document.createElement("button");
    b.type = "button";
    b.className = "inbox-banner";
    b.dataset.tag = d.tag || "";
    const body = String(d.body || "");
    b.innerHTML = `${icon("bell")}<span><b>${esc(d.title || "Nova")}</b>${body ? `<span>${esc(body.length > 200 ? `${body.slice(0, 199)}…` : body)}</span>` : ""}<small>Tap for Alerts</small></span>`;
    b.addEventListener("click", () => { b.remove(); location.hash = "#inbox/alerts"; });
    document.body.append(b);
    setTimeout(() => b.classList.add("going"), d.urgent ? 30000 : 7000);
    setTimeout(() => b.remove(), d.urgent ? 30600 : 7600);
  }
  const here = () => { const [id, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/"); return { id: id || "today", rest }; };
  const busyWriting = () => document.querySelector("#page input:focus, #page textarea:focus, #page select:focus, #page form.dirty, .sheet[open]");
  function onPush(d) {
    countsAt = 0;
    if (pingsOn()) { ping(d.kind || d.source); banner(d); }
    // (notices.js, when it's here, already brings the screen in view up to date)
    if (document.hidden || N.notices) return;
    const { id, rest } = here();
    const quest = /^(quest|mission)$/.test(d.source || d.kind || "");
    const refresh = id === "inbox" || id === "today" || (quest && (id === "quests" || (id === "agent" && /^missions?$/.test(rest[0] || ""))));
    if (refresh && !busyWriting()) N.show();
    else if (id !== "inbox") api(`${A}enquiries?box=new`).then((r) => N.badge("inbox", (r.counts || {}).new || r.newCount || 0), () => {});
  }
  function openPlace(url) {
    const to = placeFor(url);
    if (typeof to === "object") window.open(to.out, "_blank", "noopener");
    else if (location.hash !== to) location.hash = to;
    else N.show();
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const d = event.data || {};
      if (d.type === "nova-push") onPush(d);
      // (a tap: notices.js opens a place when it's here; where it reads the address differently (a chat, one
      // approval, a Quest's #nova), this one's place replaces it, so Back still goes where it was)
      if (d.type === "nova-open") {
        if (!N.notices) openPlace(d.url);
        else setTimeout(() => { const to = placeFor(d.url); if (typeof to === "string" && location.hash !== to) location.replace(to); }, 0);
      }
    });
  }
  // Opened from a notification at /phone/?open=<address>: that place (the address tidied back to Nova Phone's own)
  {
    const q = new URLSearchParams(location.search), opening = q.get("open");
    if (opening) {
      q.delete("open");
      history.replaceState(history.state, "", `${location.pathname}${q.toString() ? `?${q}` : ""}${location.hash}`);
      // (it wins over the place Nova Phone was last left on)
      setTimeout(() => openPlace(opening), 0);
    }
  }
  // Opening Nova Phone clears the dot on its Home Screen icon (now, and every time it comes back to the front)
  const clearDot = () => { if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {}); };
  clearDot();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) clearDot(); });
  // (the keys checked once, a little after the first screen is up)
  setTimeout(() => renewPush(), 4000);

  // ================= Approvals: booking changes Nova Agent proposed =================
  const APPROVAL_KINDS = { create: "New booking", reschedule: "Move a booking", cancel: "Cancel a booking", update: "Booking details", block_add: "Block off time", block_remove: "Unblock time" };
  const APPROVAL_STATUS = { pending: ["warn", "Waiting"], approved: ["", "Approved"], executed: ["ok", "Done"], failed: ["bad", "Didn't go through"], rejected: ["bad", "Rejected"] };
  const PROPOSERS = { agent: "Nova Agent", "staff-chat": "Portal's staff chat" };
  const APPROVAL_FIELDS = {
    create: [["start", "When (UK time)", "when"], ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email", "email"], ["phone", "Phone"], ["notes", "Notes", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    reschedule: [["start", "New time (UK time)", "when"], ["notifyClient", "Acuity emails the client", "tick"]],
    cancel: [["note", "Cancel note", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    update: [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email", "email"], ["phone", "Phone"], ["notes", "Notes", "long"]],
    block_add: [["start", "From (UK time)", "when"], ["end", "Until (UK time)", "when"], ["notes", "Notes", "long"]],
    block_remove: [],
  };
  const approvalErrors = new Map();
  async function drawApprovals(box, picked, ui) {
    const r = await api(`${A}booking-actions?status=all`);
    const acts = r.actions || [];
    const waiting = acts.filter((x) => x.status === "pending").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const decided = acts.filter((x) => x.status !== "pending").sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt))).slice(0, 20);
    counts.approvals = waiting.length;
    const card = (a) => {
      const [tone, word] = APPROVAL_STATUS[a.status] || ["bad", a.status];
      const by = a.decidedByName ? ` by ${a.decidedByName}` : "";
      const result = a.status === "executed" ? `<p class="small ok">Done in Acuity · approved${esc(by)}${a.executedAt ? ` · ${esc(when(a.executedAt))}` : ""}</p>${a.result && a.result.note ? `<p class="small muted">${esc(a.result.note)}</p>` : ""}`
        : a.status === "approved" ? `<p class="small">Approved${esc(by)} · going through to Acuity…</p>`
        : a.status === "failed" ? `<p class="small bad">Didn't go through: ${esc(String(a.error || "unknown reason").replace(/\.$/, ""))}. Approved${esc(by)}; nothing else was changed.</p>`
        : a.status === "rejected" ? `<p class="small">Rejected${esc(by)}${a.decidedAt ? ` · ${esc(when(a.decidedAt))}` : ""}. Nothing was changed.</p>` : "";
      const fields = APPROVAL_FIELDS[a.kind] || [];
      const err = approvalErrors.get(String(a.id));
      return `<div class="card${String(a.id) === String(picked) ? " inbox-picked" : ""}" data-act-card="${esc(a.id)}"><p class="kicker">${esc(APPROVAL_KINDS[a.kind] || "Booking change")} <span class="pill ${tone}">${esc(word)}</span></p>
        <p class="muted small">${esc(when(a.createdAt))}</p>
        <p><b>${esc(a.summary || "")}</b></p>
        <p class="small muted">Proposed by ${esc(PROPOSERS[a.proposedBy] || a.proposedBy || "someone")}</p>
        ${a.reason ? `<p class="small">Why: ${esc(a.reason)}</p>` : ""}${result}
        ${a.status === "pending" ? (r.canDecide ? `<div class="btns two inbox-tight"><button type="button" class="btn main" data-act="approve" data-id="${esc(a.id)}">${icon("check")} Approve</button>${fields.length ? `<button type="button" class="btn" data-act="edit" data-id="${esc(a.id)}">${icon("edit")} Change first</button>` : ""}<button type="button" class="btn danger" data-act="reject" data-id="${esc(a.id)}">Reject</button></div>` : `<p class="small muted">An admin approves these.</p>`) : ""}
        ${err ? `<p class="small bad" role="alert">${esc(err)}</p>` : ""}</div>`;
    };
    box.innerHTML = `${partTabs("approvals")}<p class="muted small">${r.canDecide ? "Booking changes Nova Agent proposed. Nothing changes in Acuity until you approve it." : "Booking changes Nova Agent proposed. An admin approves these (signed in, in this phone's browser); nothing changes in Acuity until then."}</p>
      ${waiting.length ? waiting.map(card).join("") : empty({ icon: "check", title: "Nothing waiting for approval" })}
      ${decided.length ? `<h3 class="h">Decided</h3>${decided.map(card).join("")}` : ""}`;
    const redo = () => drawApprovals(box, picked, ui).catch((err) => toast(err.message, true));
    box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const how = b.dataset.act, a = acts.find((x) => String(x.id) === b.dataset.id);
      if (how === "edit") return editApproval(a, redo);
      if (!(await confirm({ title: how === "approve" ? "Approve this change?" : "Reject this change?", text: how === "approve" ? "It's made in Acuity straight away." : "Nothing is changed in Acuity.", ok: how === "approve" ? "Approve" : "Reject", danger: how === "reject" }))) return;
      await busy(b, "…", () => decide(a, how, { id: a.id }, redo));
    }));
    if (picked) requestAnimationFrame(() => box.querySelector(".inbox-picked")?.scrollIntoView({ block: "center" }));
    freshCounts();
  }
  async function decide(a, path, body, redo) {
    approvalErrors.delete(String(a.id));
    try {
      const d = await send(`${A}booking-actions/${path}`, body);
      const x = d.action || {};
      if (path === "approve") toast(x.status === "executed" ? "Done in Acuity" : x.status === "failed" ? `Didn't go through: ${x.error || "see the card"}` : "Approved", x.status === "failed");
      else toast(path === "edit" ? "Saved: still waiting for approval" : "Rejected: nothing was changed");
    } catch (err) {
      if (err.signIn) return fail(err);
      const why = err.onlineUrl ? cantHere(err.onlineUrl, "approve booking changes").text : err.message;
      approvalErrors.set(String(a.id), `${path === "approve" ? "Not approved" : path === "edit" ? "Not saved" : "Not rejected"}: ${why}`);
      toast(why, true);
    }
    await redo();
  }
  // Change a proposal before deciding: its own fields, filled from it as it is (Nova Bot checks it all again)
  async function editApproval(a, redo) {
    const fields = APPROVAL_FIELDS[a.kind] || [], p = a.payload || {};
    const v = await sheetForm(`<h2 class="sheet-title">${esc(APPROVAL_KINDS[a.kind] || "Booking change")}</h2><p class="sheet-text">${esc(a.summary || "")}</p>
      <form class="form" data-f>${fields.map(([k, label, type]) => (type === "tick" ? toggle({ label, name: k, checked: p[k] !== false })
        : field({ label, name: k, type: type === "when" ? "datetime-local" : type === "email" ? "email" : type === "long" ? "textarea" : "text", rows: 3, value: type === "when" ? ukLocal(p[k]) : p[k] || "", attrs: type === "long" ? 'maxlength="2000"' : "" }))).join("")}
        <div class="btns"><button class="btn main wide" type="submit" value="approve">${icon("check")} Approve with changes</button><button class="btn wide" type="submit" value="edit">Save changes</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => {
      el.querySelector("[data-f]").onsubmit = (ev) => {
        ev.preventDefault();
        const out = { ...p };
        for (const [k, , type] of fields) {
          const input = ev.target.elements.namedItem(k);
          if (type === "tick") out[k] = input.checked;
          else if (input.value.trim() || k in out) out[k] = input.value.trim();
        }
        done({ how: ev.submitter?.value || "edit", payload: out });
      };
      el.querySelector("[data-no]").onclick = () => done(null);
    });
    if (v) await decide(a, v.how, { id: a.id, payload: v.payload }, redo);
  }

  N.inbox = { enquiryRow, alertRow, placeFor };
})();
