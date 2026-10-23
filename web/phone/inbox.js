// Nova Phone: Inbox. Everything that comes in, in four parts:
//   Enquiries   by state (New, Open, Waiting on them, Done, Spam), searchable; each one's page: who, the whole
//               conversation, a reply (an email from the studio, a person pressing Send, as in Portal), noting a
//               WhatsApp, text or call, Nova Agent's drafts to approve, edit or discard, who's on it, a label, the
//               state, spam, "don't contact", a booking link, and saved replies to start from
//   Chats       the website's visitors talking to NovaBot: read, take over, answer, hand back, mark
//   Alerts      everything that reached the studio's phones: clear one or all, how long they're kept, and
//               notifications on this phone
//   Approvals   booking changes Nova Agent proposed, for an admin to approve, change or reject
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago, initials } = N;
  const A = "/app/api/";
  const STATES = [["new", "New"], ["open", "Open"], ["replied", "Waiting on them"], ["done", "Done"], ["spam", "Spam"]];
  const STATE_NAME = Object.fromEntries(STATES);
  const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "";
  const PARTS = [["enquiries", "Enquiries"], ["chats", "Chats"], ["alerts", "Alerts"], ["approvals", "Approvals"]];
  const partTabs = (on) => `<div class="seg">${PARTS.map(([p, l]) => `<a class="seg-a" href="#inbox/${p}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;

  // ---- Rows, for Today too ----
  function enquiryRow(e) {
    const what = e.subject || e.details || "";
    const tags = [e.drafts ? `<span class="pill warn">${e.drafts > 1 ? `${e.drafts} drafts` : "Draft"} to approve</span>` : "", e.failed ? `<span class="pill bad">Didn't send</span>` : "", e.label ? `<span class="pill">${esc(e.label)}</span>` : ""].join(" ");
    return row({ href: `#inbox/enquiry/${e.id}`, lead: `<span class="av">${esc(initials(e.name || e.email))}</span>`, title: e.name || e.email || "Someone", text: String(what).slice(0, 140), html: tags.trim() ? `<span>${tags}</span>` : "", end: esc(ago(e.last_activity || e.created_at)) });
  }
  const KIND = { booking: "Booking", "booking-nova": "Booking", enquiry: "Enquiry", quest: "Quest", mission: "Mission", agent: "Nova Agent", acuity: "Acuity connection", test: "Test" };
  function alertRow(n) {
    return row({ href: `#inbox/alert/${n.id}`, icon: "bell", title: n.title || "Alert", text: [KIND[n.kind] || "", String(n.body || "").slice(0, 120)].filter(Boolean).join(" · "), end: esc(ago(n.created_at)) });
  }

  N.section({
    id: "inbox",
    name: "Inbox",
    under: "today",
    tile: "portal",
    async draw(box, [part, a, b], ui) {
      if (part === "enquiry") return drawThread(box, a, ui);
      if (part === "chat") return drawChat(box, a, ui);
      if (part === "alert") return drawAlert(box, a, ui);
      if (part === "saved") return drawSaved(box, ui);
      if (part === "chats") return drawChats(box, a, ui);
      if (part === "alerts") return drawAlerts(box, ui);
      if (part === "approvals") return drawApprovals(box, ui);
      return drawEnquiries(box, part === "box" ? a : "new", part === "box" ? b : "", ui);
    },
  });

  // ---- Enquiries ----
  let searchFor = "";
  async function drawEnquiries(box, which, _, ui) {
    const show = which === "all" ? "show=all" : `box=${STATES.some(([s]) => s === which) ? which : "new"}`;
    const r = await api(`${A}enquiries?${show}${searchFor ? `&q=${encodeURIComponent(searchFor)}` : ""}`);
    const counts = r.counts || {}, list_ = r.enquiries || [];
    N.badge("inbox", counts.new || r.newCount || 0);
    ui.action({ icon: "chat", label: "Saved replies", href: "#inbox/saved" });
    box.innerHTML = `${partTabs("enquiries")}
      <div class="chips">${[["all", "All"], ...STATES].map(([s, l]) => `<a class="chip" href="#inbox/box/${s}"${s === which ? ' aria-current="page"' : ""}>${l}${counts[s] ? ` <span class="n">${counts[s]}</span>` : ""}</a>`).join("")}</div>
      <form class="search" data-enq-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(searchFor)}" placeholder="Search name, email, message or label"></label></form>
      ${list_.length ? list(list_.map(enquiryRow)) : empty({ icon: "inbox", title: searchFor ? `Nothing matches “${searchFor}”` : which === "new" ? "Nothing new. All caught up ✦" : "Nothing here" })}`;
  }
  document.addEventListener("submit", (e) => {
    if (!e.target.matches("[data-enq-search]")) return;
    e.preventDefault();
    searchFor = e.target.elements.q.value.trim();
    N.show();
  });

  // ---- One enquiry ----
  let threadTimer = 0;
  addEventListener("hashchange", () => { clearTimeout(threadTimer); clearTimeout(chatTimer); });
  async function drawThread(box, id, ui) {
    clearTimeout(threadTimer);
    ui.back("#inbox");
    const r = await api(`${A}enquiries/thread?id=${encodeURIComponent(id)}`);
    const e = r.enquiry || {};
    ui.title(e.name || "Enquiry");
    const msgs = (r.messages || []).filter((m) => m.status !== "discarded");
    const phone = e.mobile || e.phone || "";
    const stopped = !!(e.do_not_contact_at || e.doNotContact);
    const team = r.team || [];
    const typed = box.isConnected ? box.querySelector("#reply-body")?.value || "" : "";
    const say = (m) => {
      const who = m.first ? "Their enquiry" : m.direction === "in" ? firstName(e.name) || "Them" : m.status === "draft" ? "Draft by Nova Agent" : `${{ note: "Note", whatsapp: "WhatsApp", sms: "Text", call: "Call" }[m.channel] || "Reply"} · ${m.author_name || "Studio"}`;
      const state = m.first || m.direction === "in" ? "" : m.status === "draft" ? "Waiting for approval" : m.status === "failed" ? `Didn't send${m.error ? `: ${m.error}` : ""}` : m.stuck ? "Still sending?" : m.status === "sending" || m.status === "approved" ? "Sending…" : m.channel === "note" ? "" : "Sent ✓";
      const cls = m.first || m.direction === "in" ? "say" : m.channel === "note" || m.channel === "call" ? "say note" : m.status === "draft" ? "say me draft" : "say me";
      const draftBtns = m.status === "draft" ? `<div class="btns two">${r.canSend !== false ? `<button type="button" class="btn main" data-draft="approve" data-id="${m.id}">${icon("send")} Approve &amp; send</button>` : ""}<button type="button" class="btn" data-draft="edit" data-id="${m.id}">${icon("edit")} Edit</button><button type="button" class="btn quiet" data-draft="discard" data-id="${m.id}">Discard</button></div>` : "";
      const retry = m.status === "failed" || m.stuck ? `<button type="button" class="btn" data-retry="${m.id}">${icon("refresh")} Try again</button>` : "";
      return `<li class="${cls}"><p class="say-who">${esc(who)}<span>${esc(ago(m.sent_at || m.created_at))}</span></p><p class="pre" data-body="${m.id || ""}">${esc(m.body || "")}</p>${state ? `<p class="small muted">${esc(state)}</p>` : ""}${draftBtns}${retry}</li>`;
    };
    const first = e.details ? [{ direction: "in", body: e.details, created_at: e.created_at, first: true }] : [];
    const contact = stopped ? "" : [
      e.email && `<a class="btn" href="mailto:${esc(e.email)}">${icon("mail")} Email</a>`,
      phone && `<a class="btn" href="tel:${esc(phone)}" data-log="call">${icon("phone")} Call</a>`,
      phone && e.mobile !== false && `<a class="btn" href="sms:${esc(phone)}" data-log="sms">${icon("chat")} Text</a>`,
      phone && `<a class="btn" href="https://wa.me/${esc(String(phone).replace(/[^\d]/g, "").replace(/^0/, "44"))}" target="_blank" rel="noopener" data-log="whatsapp">${icon("chat")} WhatsApp</a>`,
    ].filter(Boolean);
    box.innerHTML = `<div class="card"><p class="kicker">${esc(STATE_NAME[e.status] || e.status || "Enquiry")}${e.assigned_name ? ` · ${esc(e.assigned_name)}'s on it` : ""}</p>
        <h2 class="card-title">${esc(e.subject || e.name || "Enquiry")}</h2>
        <div class="facts">${[["From", e.name], ["Email", e.email], ["Phone", phone], ["Came from", e.page], ["Label", e.label], ["Spam because", e.spam_reason]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${stopped ? `<p class="warn small">They've asked not to be contacted.</p>` : ""}</div>
      ${contact.length ? `<div class="btns two">${contact.join("")}</div>` : ""}
      <div class="btns two"><button type="button" class="btn" data-sort="state">${icon("check")} Move to…</button><button type="button" class="btn" data-sort="who">${icon("user")} Who's on it</button><button type="button" class="btn" data-sort="label">Label</button><button type="button" class="btn" data-booking-link>${icon("calendar")} Booking link</button></div>
      <h3 class="h">The conversation</h3>
      <ul class="talk">${[...first, ...msgs].map(say).join("") || "<li class='say note'>Nothing yet.</li>"}</ul>
      ${stopped ? "" : `<form class="form" id="reply" novalidate>
        <div class="seg" role="radiogroup" aria-label="How">${[["reply", "Email"], ["note", "Note"]].map(([v, l], i) => `<label><input type="radio" name="how" value="${v}"${i === 0 ? " checked" : ""}>${l}</label>`).join("")}</div>
        <label class="field"><span id="reply-label">Reply to ${esc(firstName(e.name) || "them")} (emailed from the studio)</span><textarea class="input" id="reply-body" name="body" rows="4" placeholder="Write your reply">${esc(typed)}</textarea></label>
        <div class="btns two"><button type="button" class="btn" data-use-saved>Saved replies</button><button class="btn main" type="submit">${icon("send")} <span id="reply-go">Send</span></button></div>
        <p class="form-said" role="status"></p></form>`}
      ${toggleRow("Don't contact them", stopped)}
      ${e.status === "spam" ? `<button type="button" class="btn wide" data-state-to="new">Not spam</button>` : `<button type="button" class="btn quiet wide" data-state-to="spam">Move to Spam</button>`}`;
    // (wiring: the reply, its kind, the sort sheets, the log of calls and messages)
    const f = box.querySelector("#reply");
    if (f) {
      f.addEventListener("change", () => {
        const note = f.elements.how.value === "note";
        box.querySelector("#reply-label").textContent = note ? "A note for the team (they won't see it)" : `Reply to ${firstName(e.name) || "them"} (emailed from the studio)`;
        box.querySelector("#reply-go").textContent = note ? "Add note" : "Send";
      });
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const body = f.elements.body.value.trim(), said = f.querySelector(".form-said");
        if (!body) { said.textContent = "Write something first."; return; }
        const note = f.elements.how.value === "note";
        if (!note && !(await confirm({ title: `Email this to ${e.name || e.email}?`, text: "It goes straight to them from the studio.", ok: "Send" }))) return;
        await busy(f.querySelector("[type=submit]"), note ? "Adding…" : "Sending…", async () => {
          try { await post(`${A}enquiries/${note ? "note" : "reply"}`, { id: Number(id), body, key: key() }); f.classList.remove("dirty"); f.elements.body.value = ""; toast(note ? "Note added" : "Sent"); await drawThread(box, id, ui); }
          catch (err) { said.textContent = err.status === 403 ? "Sending needs Nova Agent signed in in this phone's browser (not just the app): sign in again." : `Not sent: ${err.message}`; said.classList.add("bad"); }
        });
      });
    }
    box.querySelector("[data-use-saved]")?.addEventListener("click", async () => {
      const s = await api(`${A}inbox/saved`).catch(() => ({ saved: [] }));
      if (!(s.saved || []).length) return toast("No saved replies yet: add them in Saved replies.");
      const pick = await choose({ title: "Start from a saved reply", options: s.saved.map((x) => [x.id, x.title || x.name]) });
      const chosen = s.saved.find((x) => String(x.id) === String(pick));
      if (chosen) { const t = box.querySelector("#reply-body"); t.value = String(chosen.body || "").replace(/\{name\}/g, firstName(e.name)); t.dispatchEvent(new Event("input", { bubbles: true })); toast("Filled in: check it, then Send"); }
    });
    box.querySelector("[data-booking-link]").addEventListener("click", () => bookingLink(e));
    box.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => sortSheet(b.dataset.sort, e, team, id, box, ui)));
    box.querySelectorAll("[data-state-to]").forEach((b) => b.addEventListener("click", () => busy(b, "Moving…", async () => { await post(`${A}inbox/sort`, { id: Number(id), state: b.dataset.stateTo }); toast(b.dataset.stateTo === "spam" ? "Moved to Spam" : "Not spam"); await drawThread(box, id, ui); })));
    box.querySelector("[data-toggle]")?.addEventListener("change", async (ev) => {
      const on = ev.target.checked;
      if (on && !(await confirm({ title: "Don't contact them?", text: "Nothing more is sent to them from Nova.", ok: "Don't contact" }))) { ev.target.checked = false; return; }
      try { await post(`${A}enquiries/contact`, { id: Number(id), doNotContact: on }); toast(on ? "They won't be contacted" : "They can be contacted again"); await drawThread(box, id, ui); }
      catch (err) { ev.target.checked = !on; toast(err.message, true); }
    });
    box.querySelectorAll("[data-log]").forEach((a) => a.addEventListener("click", () => setTimeout(() => logSheet(a.dataset.log, e, id, box, ui), 1500)));
    wireDrafts(box, id, ui);
    // (new words: looked for every 10 seconds while it's open, not while writing)
    threadTimer = setTimeout(function again() {
      if (location.hash !== `#inbox/enquiry/${id}`) return;
      if (document.hidden || box.querySelector("#reply.dirty")) { threadTimer = setTimeout(again, 10000); return; }
      drawThread(box, id, ui).catch(() => {});
    }, 10000);
  }
  const toggleRow = (label, on) => `<label class="switch"><span>${esc(label)}</span><input type="checkbox" role="switch" data-toggle${on ? " checked" : ""}></label>`;
  async function sortSheet(what, e, team, id, box, ui) {
    let body = null;
    if (what === "state") { const s = await choose({ title: "Move to", options: STATES.filter(([s]) => s !== e.status).map(([s, l]) => [s, l]) }); if (s) body = { state: s }; }
    if (what === "who") { const w = await choose({ title: "Who's on it", options: [["me", "Me"], ...team.filter((t) => t.id).map((t) => [t.id, t.display_name || t.name]), ["", "Nobody"]] }); if (w !== null) body = { assignedTo: w || null }; }
    if (what === "label") {
      const v = await sheetForm(`<h2 class="sheet-title">Label</h2><form class="form" data-f>${field({ label: "Label", name: "label", value: e.label || "", placeholder: "e.g. Mixing, Vocals, Big job" })}<div class="btns two"><button class="btn main" type="submit">Save</button><button type="button" class="btn quiet" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.label.value.trim()); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (v !== null) body = { label: v };
    }
    if (!body) return;
    try { await post(`${A}inbox/sort`, { id: Number(id), ...body }); toast("Done"); await drawThread(box, id, ui); } catch (err) { toast(err.message, true); }
  }
  // After a call, a WhatsApp or a text from this phone: what happened, kept with the enquiry
  async function logSheet(kind, e, id, box, ui) {
    if (document.hidden) { addEventListener("focus", () => logSheet(kind, e, id, box, ui), { once: true }); return; }
    const call = kind === "call";
    const outcome = await sheetForm(`<h2 class="sheet-title">${call ? `How did the call with ${esc(firstName(e.name) || "them")} go?` : `Did your ${kind === "sms" ? "text" : "WhatsApp"} send?`}</h2>
      <form class="form" data-f>${field({ label: call ? "A note (optional)" : "What you said (optional)", name: "body", type: "textarea", rows: 3 })}
      <div class="btns">${(call ? [["spoke", "Spoke to them"], ["voicemail", "Left a voicemail"], ["no-answer", "No answer"]] : [["sent", "Yes, it sent"]]).map(([v, l]) => `<button type="submit" class="btn wide" value="${v}">${l}</button>`).join("")}<button type="button" class="btn quiet wide" data-no>Skip</button></div></form>`,
      (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ outcome: ev.submitter?.value, body: ev.target.elements.body.value.trim() }); }; el.querySelector("[data-no]").onclick = () => done(null); });
    if (!outcome) return;
    try { await post(`${A}enquiries/logged`, { id: Number(id), kind, body: outcome.body, outcome: outcome.outcome, key: key() }); toast("Kept with the enquiry"); await drawThread(box, id, ui); } catch (err) { toast(err.message, true); }
  }
  function wireDrafts(box, id, ui) {
    box.querySelectorAll("[data-draft]").forEach((b) => b.addEventListener("click", async () => {
      const mid = Number(b.dataset.id), what = b.dataset.draft;
      const text = box.querySelector(`[data-body="${mid}"]`)?.textContent || "";
      if (what === "edit") {
        const v = await sheetForm(`<h2 class="sheet-title">Edit the draft</h2><form class="form" data-f>${field({ label: "The reply", name: "body", type: "textarea", rows: 8, value: text })}<div class="btns"><button class="btn main wide" type="submit" value="approve">${icon("send")} Approve &amp; send</button><button class="btn wide" type="submit" value="save">Save the draft</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
          (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ how: ev.submitter?.value, body: ev.target.elements.body.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
        if (!v) return;
        try { await post(`${A}enquiries/draft/${v.how === "approve" ? "approve" : "edit"}`, { messageId: mid, body: v.body }); toast(v.how === "approve" ? "Sent" : "Draft saved"); await drawThread(box, id, ui); } catch (err) { toast(err.message, true); }
        return;
      }
      if (what === "approve" && !(await confirm({ title: "Send this reply?", text: "It's emailed to them straight away.", ok: "Approve & send" }))) return;
      if (what === "discard" && !(await confirm({ title: "Discard the draft?", ok: "Discard", danger: true }))) return;
      await busy(b, what === "approve" ? "Sending…" : "…", async () => {
        try { await post(`${A}enquiries/draft/${what}`, what === "approve" ? { messageId: mid, body: text } : { messageId: mid }); toast(what === "approve" ? "Sent" : "Discarded"); await drawThread(box, id, ui); }
        catch (err) { toast(err.message, true); }
      });
    }));
    box.querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => busy(b, "Trying again…", async () => {
      try { await post(`${A}enquiries/retry`, { messageId: Number(b.dataset.retry) }); toast("Trying again"); await drawThread(box, id, ui); } catch (err) { toast(err.message, true); }
    })));
  }
  // A link for them to book a session
  async function bookingLink(e) {
    const s = await api(`${A}sessions`).catch((err) => ({ error: err.message }));
    const sessions = s.sessions || [];
    if (!sessions.length) return toast(s.error || "No sessions to book", true);
    const typeId = await choose({ title: `A booking link for ${e.name || "them"}`, options: sessions.map((x) => [x.id, `${x.name}${x.price ? ` · ${x.price}` : ""}`]) });
    if (!typeId) return;
    try {
      const r = await post(`${A}booking-link`, { enquiryId: Number(e.id), typeId });
      const text = `Hi ${firstName(e.name)}, here's the link to book your ${r.session || "session"}: ${r.url}`;
      if (navigator.share) await navigator.share({ title: "Booking link", text }).catch(() => {});
      else { await navigator.clipboard.writeText(r.url); toast("Booking link copied"); }
    } catch (err) { toast(err.message, true); }
  }

  // ---- Saved replies ----
  async function drawSaved(box, ui) {
    ui.back("#inbox");
    ui.title("Saved replies");
    const r = await api(`${A}inbox/saved`);
    const saved = r.saved || [];
    ui.action({ icon: "plus", label: "New saved reply", run: () => editSaved(null) });
    box.innerHTML = `<p class="muted small">Replies to start from. {name} becomes their first name.</p>${saved.length ? list(saved.map((x) => row({ button: `data-saved="${esc(x.id)}"`, icon: "chat", title: x.title || x.name || "Saved reply", text: String(x.body || "").slice(0, 120) }))) : empty({ icon: "chat", title: "No saved replies yet", action: `<button type="button" class="btn" data-new-saved>${icon("plus")} Add one</button>` })}`;
    box.querySelector("[data-new-saved]")?.addEventListener("click", () => editSaved(null));
    box.querySelectorAll("[data-saved]").forEach((b) => b.addEventListener("click", () => editSaved(saved.find((x) => String(x.id) === b.dataset.saved))));
    async function editSaved(x) {
      const v = await sheetForm(`<h2 class="sheet-title">${x ? "Change the saved reply" : "New saved reply"}</h2><form class="form" data-f>${field({ label: "Name", name: "title", value: x?.title || x?.name || "", placeholder: "e.g. Prices" })}${field({ label: "The reply", name: "body", type: "textarea", rows: 6, value: x?.body || "" })}
        <div class="btns"><button class="btn main wide" type="submit" value="save">Save</button>${x ? `<button type="submit" class="btn danger wide" value="remove">Remove</button>` : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ how: ev.submitter?.value, title: ev.target.elements.title.value.trim(), body: ev.target.elements.body.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      try {
        if (v.how === "remove") { if (!(await confirm({ title: "Remove this saved reply?", ok: "Remove", danger: true }))) return; await post(`${A}inbox/saved/remove`, { id: x.id }); toast("Removed"); }
        else { await post(`${A}inbox/saved`, { ...(x ? { id: x.id } : {}), title: v.title, body: v.body }); toast("Saved"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }
  }

  // ---- Website chats ----
  let chatTimer = 0, chatFilter = "all";
  async function drawChats(box, filter, ui) {
    chatFilter = ["needs-person", "done"].includes(filter) ? filter : "all";
    const r = await api(`${A}conversations`);
    const all = r.conversations || [];
    const shown = all.filter((c) => chatFilter === "all" || (c.ticket && (c.ticket.state || c.ticket) === chatFilter) || (chatFilter === "needs-person" && c.ticket === "needs-person"));
    box.innerHTML = `${partTabs("chats")}<p class="muted small">What visitors asked NovaBot on the website. Kept for 90 days.</p>
      <div class="chips">${[["all", "All"], ["needs-person", "Needs a person"], ["done", "Done"]].map(([f, l]) => `<a class="chip" href="#inbox/chats/${f}"${f === chatFilter ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</div>
      ${shown.length ? list(shown.map((c) => row({ href: `#inbox/chat/${encodeURIComponent(c.chat_id)}`, icon: "chat", title: c.first_question || "A visitor", text: [c.messages && `${c.messages} message${c.messages > 1 ? "s" : ""}`, c.live ? `Live · ${c.live_name || "someone"}` : "", c.assigned_name ? `${c.assigned_name}'s on it` : "", c.enquiries ? "Left an enquiry" : ""].filter(Boolean).join(" · "), end: esc(ago(c.last || c.started)) }))) : empty({ icon: "chat", title: chatFilter === "needs-person" ? "No chats waiting for a person" : chatFilter === "done" ? "No chats marked done yet" : "No conversations yet" })}`;
  }
  async function drawChat(box, chatId, ui) {
    clearTimeout(chatTimer);
    ui.back("#inbox/chats");
    ui.title("Website chat");
    const r = await api(`${A}conversations?chat=${encodeURIComponent(chatId)}`);
    const msgs = r.messages || [], live = r.live || {}, ticket = r.ticket || {};
    const mine = live.mode === "staff";
    const typed = box.querySelector("#chat-body")?.value || "";
    const lines = msgs.map((m) => (m.role === "note" ? `<li class="say note">${esc(m.content)} · ${esc(ago(m.created_at))}</li>`
      : `<li class="${m.role === "user" ? "say" : "say me"}"><p class="say-who">${m.role === "user" ? "Visitor" : m.role === "staff" ? `${esc(m.sender || "Someone")} (studio)` : "NovaBot"}<span>${esc(ago(m.created_at))}</span></p><p class="pre">${esc(m.content)}</p></li>`)).join("");
    box.innerHTML = msgs.length ? `<div class="card"><p class="small">${mine ? `${esc(live.staffName || "Someone")} from the studio has this chat. NovaBot is paused.` : "NovaBot is answering. Reply below, or take it over, to answer the visitor yourself."}</p>
        <div class="btns two"><button type="button" class="btn" data-live="${mine ? "handback" : "takeover"}">${mine ? "Hand back to NovaBot" : "Take over"}</button>
        <button type="button" class="btn" data-mark="${(ticket.state || ticket) === "needs-person" ? "" : "needs-person"}">${(ticket.state || ticket) === "needs-person" ? "Doesn't need a person" : "Needs a person"}</button>
        <button type="button" class="btn" data-mark="${(ticket.state || ticket) === "done" ? "" : "done"}">${(ticket.state || ticket) === "done" ? "Not done" : "Done"}</button></div></div>
      <ul class="talk">${lines}</ul>
      <form class="composer" id="chat-reply"><label class="sr" for="chat-body">Write to the visitor</label><textarea class="input" id="chat-body" rows="1" maxlength="1500" placeholder="${mine ? "Write to the visitor" : "Write to the visitor (takes the chat over)"}">${esc(typed)}</textarea><button class="btn main" type="submit" aria-label="Send">${icon("send")}</button></form>`
      : empty({ icon: "chat", title: "This conversation has been deleted", text: "Conversations are kept for 90 days." });
    const live_ = (action, extra = {}) => post(`${A}conversations/live`, { chatId, action, ...extra });
    box.querySelector("#chat-reply")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const t = box.querySelector("#chat-body"), text = t.value.trim();
      if (!text) return;
      try { await live_("reply", { text }); t.value = ""; ev.target.classList.remove("dirty"); await drawChat(box, chatId, ui); } catch (err) { toast(err.message, true); }
    });
    box.querySelector("[data-live]")?.addEventListener("click", (ev) => busy(ev.currentTarget, "…", async () => { try { await live_(ev.currentTarget.dataset.live); await drawChat(box, chatId, ui); } catch (err) { toast(err.message, true); } }));
    box.querySelectorAll("[data-mark]").forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => { try { await post(`${A}inbox/chat`, { chatId, state: b.dataset.mark || null, assignedTo: b.dataset.mark ? "me" : undefined }); await drawChat(box, chatId, ui); } catch (err) { toast(err.message, true); } })));
    const page = document.getElementById("page");
    requestAnimationFrame(() => (page.scrollTop = page.scrollHeight));
    chatTimer = setTimeout(function again() {
      if (location.hash !== `#inbox/chat/${encodeURIComponent(chatId)}` && location.hash !== `#inbox/chat/${chatId}`) return;
      if (document.hidden || document.activeElement?.id === "chat-body") { chatTimer = setTimeout(again, 5000); return; }
      drawChat(box, chatId, ui).catch(() => {});
    }, mine ? 4000 : 10000);
  }

  // ---- Alerts ----
  async function drawAlerts(box, ui) {
    const r = await api(`${A}notifications`);
    const all = r.notifications || [];
    const days = r.autoDeleteDays || 0;
    box.innerHTML = `${partTabs("alerts")}
      <a class="card phone-alerts" href="#inbox/alert/phone"><p class="kicker">This phone</p><p><b>Notifications on this phone</b></p><p class="muted small" id="push-state">Enquiries, bookings and reminders as they happen.</p></a>
      ${all.length ? `${list(all.map(alertRow))}<button type="button" class="btn danger wide" data-del-all>${icon("trash")} Delete all ${all.length}</button>` : empty({ icon: "bell", title: "No alerts yet", text: "New enquiries and bookings appear here once they've reached a phone." })}
      <label class="field"><span>Delete alerts after</span><select class="input" data-auto>${[[0, "Keep until deleted"], ...((r.choices || [1, 3, 7, 14, 30]).map((d) => [d, `${d} day${d > 1 ? "s" : ""}`]))].map(([v, l]) => `<option value="${v}"${Number(v) === Number(days) ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
    pushState().then((s) => { const el = box.querySelector("#push-state"); if (el) el.textContent = s.words; });
    box.querySelector("[data-del-all]")?.addEventListener("click", async (ev) => {
      if (!(await confirm({ title: `Delete all ${all.length} alerts?`, text: "They're gone for everyone.", ok: "Delete all", danger: true }))) return;
      await busy(ev.target, "Deleting…", async () => { try { await post(`${A}notifications/delete`, { all: true }); toast("Deleted"); N.show(); } catch (err) { toast(err.message, true); } });
    });
    box.querySelector("[data-auto]").addEventListener("change", async (ev) => { try { await post(`${A}notifications/settings`, { days: Number(ev.target.value) }); toast("Saved"); } catch (err) { toast(err.message, true); } });
  }
  async function drawAlert(box, id, ui) {
    ui.back("#inbox/alerts");
    if (id === "phone") return drawPush(box, ui);
    ui.title("Alert");
    const r = await api(`${A}notifications`);
    const n = (r.notifications || []).find((x) => String(x.id) === String(id));
    if (!n) { box.innerHTML = empty({ icon: "bell", title: "That alert's been deleted" }); return; }
    const c = n.contact || {};
    const when = N.asDate(n.created_at);
    const btns = [
      n.enquiry_id && `<a class="btn main" href="#inbox/enquiry/${n.enquiry_id}">Open the enquiry</a>`,
      (c.email || n.email) && `<a class="btn" href="mailto:${esc(c.email || n.email)}">${icon("mail")} Email</a>`,
      (c.phone || n.phone) && `<a class="btn" href="tel:${esc(c.phone || n.phone)}">${icon("phone")} Call</a>`,
      n.email?.gmail && `<a class="btn" href="${esc(n.email.gmail)}" target="_blank" rel="noopener">Open in Gmail</a>`,
      /invoice/i.test(n.url || "") && /[?&]invoice=(\d+)/.test(n.url) && `<a class="btn" href="#money/invoice/${n.url.match(/[?&]invoice=(\d+)/)[1]}">Open the invoice</a>`,
    ].filter(Boolean);
    box.innerHTML = `<div class="card"><p class="kicker">${esc(KIND[n.kind] || "Alert")}</p><h2 class="card-title">${esc(n.title || "Alert")}</h2>
        <p class="muted small">${when ? esc(when.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })) : ""}${n.phones !== undefined ? ` · reached ${n.phones} phone${n.phones === 1 ? "" : "s"}` : ""}</p>
        ${n.body ? `<p class="pre">${esc(n.body)}</p>` : ""}
        ${n.email?.lines?.length ? `<div class="facts">${n.email.lines.map((l) => `<div class="fact"><b>${esc(l)}</b></div>`).join("")}</div>` : ""}
        <div id="verify"></div></div>
      ${btns.length ? `<div class="btns two">${btns.join("")}</div>` : ""}
      <button type="button" class="btn danger wide" data-del-one>${icon("trash")} Delete this alert</button>`;
    if (n.appointmentId || n.appointment_id) {
      const v = box.querySelector("#verify");
      v.innerHTML = `<p class="muted small">Checking with Acuity…</p>`;
      api(`${A}verify-booking?id=${encodeURIComponent(n.appointmentId || n.appointment_id)}`).then((x) => { v.innerHTML = `<p class="${x.status === "ok" ? "ok" : x.status === "gone" ? "bad" : "warn"}"><b>${esc(x.title || "")}</b></p>${(x.lines || []).map((l) => `<p class="small">${esc(l)}</p>`).join("")}`; }, () => { v.innerHTML = ""; });
    }
    box.querySelector("[data-del-one]").addEventListener("click", (ev) => busy(ev.target, "Deleting…", async () => { try { await post(`${A}notifications/delete`, { id: n.id }); toast("Deleted"); location.hash = "#inbox/alerts"; } catch (err) { toast(err.message, true); } }));
  }
  // Notifications on this phone (Portal's own: the same keys, the same phones list)
  async function pushState() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { can: false, on: false, words: /iPhone|iPad/.test(navigator.userAgent) ? "On an iPhone, add Nova Agent to the Home Screen first (Share → Add to Home Screen), then open it from there." : "This browser can't show notifications." };
    if (Notification.permission === "denied") return { can: false, on: false, words: "Notifications are blocked for Nova in this phone's settings." };
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    const sub = reg && (await reg.pushManager.getSubscription().catch(() => null));
    return { can: true, on: !!sub, sub, reg, words: sub ? "Notifications are on for this phone." : "Notifications are off on this phone." };
  }
  async function drawPush(box, ui) {
    ui.title("Notifications");
    const s = await pushState();
    box.innerHTML = `<div class="card"><p class="kicker">This phone</p><h2 class="card-title">${s.on ? "Notifications are on" : "Notifications are off"}</h2><p class="muted">${esc(s.words)}</p></div>
      ${s.can ? (s.on ? `<button type="button" class="btn wide" data-push="test">Send a test</button><button type="button" class="btn quiet wide" data-push="off">Turn off on this phone</button>` : `<button type="button" class="btn main wide" data-push="on">${icon("bell")} Turn on notifications</button>`) : ""}`;
    box.querySelectorAll("[data-push]").forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
      try {
        if (b.dataset.push === "on") {
          const k = await api(`${A}push/key`);
          const bytes = Uint8Array.from(atob((k.publicKey + "===".slice((k.publicKey.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
          const sub = await s.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
          await post(`${A}push/subscribe`, { subscription: sub.toJSON() });
          toast("Notifications are on");
        } else if (b.dataset.push === "test") { const r = await post(`${A}push/test`, {}); toast(r.delivered ? "Sent: it should arrive in a moment" : "Sent"); }
        else { await post(`${A}push/unsubscribe`, { endpoint: s.sub.endpoint }); await s.sub.unsubscribe(); toast("Off on this phone"); }
        N.show();
      } catch (err) { toast(err.message || "That didn't work", true); }
    })));
  }

  // ---- Approvals: booking changes Nova Agent proposed ----
  const ACTION_KIND = { book: "New booking", reschedule: "Move a booking", cancel: "Cancel a booking", update: "Booking details", block: "Block off time", unblock: "Unblock time" };
  async function drawApprovals(box, ui) {
    const r = await api(`${A}booking-actions?status=all`);
    const acts = r.actions || [];
    const waiting = acts.filter((x) => x.status === "pending" || x.status === "waiting"), decided = acts.filter((x) => !waiting.includes(x)).slice(0, 20);
    const card = (x) => `<div class="card"><p class="kicker">${esc(ACTION_KIND[x.kind] || x.kind || "Booking change")} · ${esc({ pending: "Waiting", waiting: "Waiting", approved: "Approved", done: "Done", failed: "Didn't go through", rejected: "Rejected" }[x.status] || x.status)}</p>
      <p><b>${esc(x.summary || x.title || "")}</b></p>${x.reason ? `<p class="muted small">Why: ${esc(x.reason)}</p>` : ""}${x.outcome || x.error ? `<p class="small">${esc(x.outcome || x.error)}</p>` : ""}
      ${waiting.includes(x) && r.canDecide ? `<div class="btns two"><button type="button" class="btn main" data-act="approve" data-id="${x.id}">${icon("check")} Approve</button><button type="button" class="btn danger" data-act="reject" data-id="${x.id}">Reject</button></div>` : ""}</div>`;
    box.innerHTML = `${partTabs("approvals")}${r.canDecide ? "" : `<p class="muted small">An admin approves these.</p>`}
      ${waiting.length ? waiting.map(card).join("") : empty({ icon: "check", title: "Nothing waiting" })}
      ${decided.length ? `<h3 class="h">Decided</h3>${decided.map(card).join("")}` : ""}`;
    box.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const how = b.dataset.act;
      if (!(await confirm({ title: how === "approve" ? "Approve this change?" : "Reject this change?", text: how === "approve" ? "It's made in the booking diary straight away." : "", ok: how === "approve" ? "Approve" : "Reject", danger: how === "reject" }))) return;
      await busy(b, "…", async () => { try { await post(`${A}booking-actions/${how}`, { id: b.dataset.id }); toast(how === "approve" ? "Approved" : "Rejected"); N.show(); } catch (err) { toast(err.message, true); } });
    }));
  }

  N.inbox = { enquiryRow, alertRow };
})();
