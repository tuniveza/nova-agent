// Nova on a phone: Today, and the Inbox inside it. Today: today's cards, new enquiries, alerts, and money
// that's due, each a row to tap. An enquiry opens on its own page (#inbox/<id>): who it's from, the whole
// conversation, a reply to send (a person pressing Send, as in Portal), and Nova Agent's drafts to approve.
(() => {
  "use strict";
  const { section, api, esc, icon, computerLink, today, signInCard } = window.NovaPhone;
  const A = "/app/api/";
  const when = (iso) => {
    if (!iso) return "";
    const d = new Date(String(iso).includes("T") || String(iso).includes(" ") ? String(iso).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? "" : "Z") : iso);
    if (isNaN(d)) return "";
    const days = Math.floor((Date.now() - d) / 864e5);
    const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return t;
    if (days < 6) return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${t}`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const money = (p) => (Number.isFinite(p) ? `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "");
  const settle = (p) => p.then((v) => v, (e) => { if (e.signIn) throw e; return null; });

  section({
    id: "today",
    name: "Today",
    async draw(page) {
      // (all at once; one that fails leaves its part out rather than the page)
      const [cal, enq, notes, cash] = await Promise.all([
        settle(window.NovaPhone.cal ? window.NovaPhone.cal.load() : Promise.resolve()),
        settle(api(`${A}enquiries?box=new`)),
        settle(api(`${A}notifications`)),
        settle(api(`${A}money?status=open`)),
      ]);
      const parts = [];
      const d = new Date();
      parts.push(`<p class="today-date">${esc(d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}</p>`);
      // Today's cards
      const rows = window.NovaPhone.cal && cal !== null ? window.NovaPhone.cal.dayRows(today()) : "";
      parts.push(`<h2 class="h">Today's calendar</h2>${rows ? `<ul class="rows">${rows}</ul>` : `<p class="empty-day"><a href="#calendar/new/${today()}">Nothing today · add a note card</a></p>`}`);
      // New enquiries
      if (enq) {
        const list = enq.enquiries || [];
        parts.push(`<h2 class="h">New enquiries${list.length ? ` · ${list.length}` : ""}</h2>${list.length ? `<ul class="rows">${list.slice(0, 12).map(enqRow).join("")}</ul>` : `<p class="empty-day">None waiting.</p>`}
          <p><a class="btn wide" href="#inbox">All enquiries</a></p>`);
      }
      // Alerts
      if (notes) {
        const list = notes.notifications || [];
        parts.push(`<h2 class="h">Alerts${list.length ? ` · ${list.length}` : ""}</h2>${list.length ? `<ul class="rows">${list.slice(0, 8).map(alertRow).join("")}</ul>${list.length > 8 ? `<p><a class="btn wide" href="#alerts">All ${list.length} alerts</a></p>` : ""}` : `<p class="empty-day">No alerts.</p>`}`);
      }
      // Money due
      if (cash) {
        const s = cash.summary || {};
        const over = s.overdue || {}, owed = s.owed || {};
        const head = over.count ? `${over.count} overdue · ${money(over.pence)}` : s.waitingApproval ? `${s.waitingApproval} waiting for approval` : "Nothing overdue";
        const sub = [owed.count ? `${money(owed.pence)} owed on ${owed.count} invoice${owed.count > 1 ? "s" : ""}` : "", s.month ? `${money(s.month.inPence)} in this month` : ""].filter(Boolean).join(" · ");
        parts.push(`<h2 class="h">Money</h2><a class="row" href="#money"><span class="row-lead">${icon("money")}</span><span class="row-main"><strong>${esc(head)}</strong><small>${esc(sub || "Invoices and payments")}</small></span><span class="row-end">${icon("next")}</span></a>`);
      }
      page.innerHTML = parts.join("");
    },
  });

  function enqRow(e) {
    const what = e.subject || e.details || e.page || "";
    return `<li><a class="row" href="#inbox/${encodeURIComponent(e.id)}"><span class="row-lead">${icon("agent")}</span><span class="row-main"><strong>${esc(e.name || e.email || "Someone")}</strong>${what ? `<small>${esc(String(what).slice(0, 140))}</small>` : ""}</span><span class="row-end">${esc(when(e.last_activity || e.created_at))}</span></a></li>`;
  }
  function alertRow(n) {
    // (an alert that leads somewhere opens it; Nova's own addresses in the computer version)
    const to = n.enquiry_id ? `#inbox/${encodeURIComponent(n.enquiry_id)}` : n.url && n.url.startsWith("/") ? computerLink(n.url) : "";
    const inner = `<span class="row-lead">${icon("today")}</span><span class="row-main"><strong>${esc(n.title || "Alert")}</strong>${n.body ? `<small>${esc(String(n.body).slice(0, 160))}</small>` : ""}</span><span class="row-end">${esc(when(n.created_at))}</span>`;
    return `<li>${to ? `<a class="row" href="${esc(to)}">${inner}</a>` : `<div class="row still">${inner}</div>`}</li>`;
  }

  // ---- The Inbox: every enquiry by its box, and each one's page ----
  const BOXES = [["new", "New"], ["open", "Open"], ["replied", "Replied"], ["done", "Done"]];
  section({
    id: "inbox",
    name: "Inbox",
    async draw(page, [id, box]) {
      if (id && id !== "box") return drawThread(page, id);
      const which = BOXES.some(([b]) => b === box) ? box : "new";
      const r = await api(`${A}enquiries?box=${which}`);
      const list = r.enquiries || [];
      const counts = r.counts || {};
      page.innerHTML = `<div class="chips">${BOXES.map(([b, name]) => `<a class="chip" href="#inbox/box/${b}"${b === which ? ' aria-current="page"' : ""}>${name}${counts[b] ? ` · ${counts[b]}` : ""}</a>`).join("")}<a class="chip" href="#chats">Website chats</a></div>
        ${list.length ? `<ul class="rows">${list.map(enqRow).join("")}</ul>` : `<p class="note">Nothing here.</p>`}
        <p><a class="btn wide" href="${computerLink("/portal/?view=inbox")}">${icon("open")} Labels and sorting</a></p>`;
    },
  });

  async function drawThread(page, id) {
    const r = await api(`${A}enquiries/thread?id=${encodeURIComponent(id)}`);
    const e = r.enquiry || {};
    const msgs = (r.messages || []).filter((m) => m.status !== "discarded");
    const first = e.details ? [{ direction: "in", body: e.details, created_at: e.created_at, first: true }] : [];
    const contact = [e.email && `<a class="btn" href="mailto:${esc(e.email)}">Email</a>`, (e.mobile || e.phone) && `<a class="btn" href="tel:${esc(e.mobile || e.phone)}">Call</a>`].filter(Boolean).join("");
    page.innerHTML = `<div class="card"><h2 class="title">${esc(e.name || "Enquiry")}</h2>
        ${e.subject ? `<p>${esc(e.subject)}</p>` : ""}<p class="muted">${[e.email, e.mobile || e.phone].filter(Boolean).map(esc).join(" · ")}</p>
        ${contact ? `<div class="btns">${contact}</div>` : ""}</div>
      <h2 class="h">The conversation</h2>
      <ul class="talk">${[...first, ...msgs].map(talkRow).join("") || '<li class="note">No messages yet.</li>'}</ul>
      ${r.canSend === false ? `<p class="muted">Replies can't be sent from here right now (email isn't set up for enquiries).</p>` : `
      <form class="stack form" id="reply">
        <label>Reply to ${esc(e.name || "them")}<textarea name="body" rows="5" required placeholder="Write your reply"></textarea></label>
        <p class="muted">Send emails it to them straight away, from the studio.</p>
        <p class="form-said" role="status"></p>
        <button class="btn main wide" type="submit">Send</button>
      </form>`}
      <p><a class="btn wide" href="#inbox">${icon("back")} Back to the inbox</a></p>`;
    page.querySelector("#reply")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target, said = f.querySelector(".form-said"), btn = f.querySelector("[type=submit]");
      const body = f.elements.body.value.trim();
      if (!body) return;
      btn.disabled = true;
      said.textContent = "Sending…";
      try {
        await api(`${A}enquiries/reply`, { method: "POST", body: JSON.stringify({ id: Number(id) || id, body, key: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) }) });
        await drawThread(page, id);
      } catch (err) {
        said.textContent = `Not sent (${err.message}).`;
        btn.disabled = false;
      }
    });
  }
  function talkRow(m) {
    const draft = m.status === "draft";
    const who = m.first ? "Their enquiry" : m.direction === "in" ? "Them" : draft ? "Nova Agent's draft" : m.channel === "note" ? `Note${m.author_name ? ` · ${m.author_name}` : ""}` : m.author_name || "You";
    return `<li class="say ${m.direction === "in" ? "in" : "out"}${draft ? " draft" : ""}"><p class="say-who">${esc(who)} <span class="muted">${esc(when(m.sent_at || m.created_at))}${m.status && !["sent", "draft", "received"].includes(m.status) ? ` · ${esc(m.status)}` : ""}</span></p><p class="pre">${esc(m.body || "")}</p>
      ${draft ? `<div class="btns"><button type="button" class="btn main" data-approve="${m.id}">Approve &amp; send</button><button type="button" class="btn" data-discard="${m.id}">Discard</button></div>` : ""}</li>`;
  }
  // ---- Alerts: every one, each to clear (Portal's own: they clear for everyone) ----
  section({
    id: "alerts",
    name: "Alerts",
    async draw(page) {
      const r = await api(`${A}notifications`);
      const list = r.notifications || [];
      page.innerHTML = list.length ? `<ul class="rows">${list.map((n) => alertRow(n).replace("</li>", `<button type="button" class="btn clear-one" data-clear-alert="${esc(n.id)}" aria-label="Clear this alert">Clear</button></li>`)).join("")}</ul>
        ${r.autoDeleteDays ? `<p class="muted small">Alerts clear themselves after ${esc(r.autoDeleteDays)} days.</p>` : ""}` : `<p class="note">No alerts.</p>`;
    },
  });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-clear-alert]");
    if (!b) return;
    b.disabled = true;
    try { await api(`${A}notifications/delete`, { method: "POST", body: JSON.stringify({ id: Number(b.dataset.clearAlert) || b.dataset.clearAlert }) }); b.closest("li").remove(); }
    catch (err) { b.disabled = false; b.textContent = "Not cleared"; }
  });

  // ---- Website chats: the visitors talking to NovaBot on the website, and taking one over to answer yourself ----
  let chatTimer = 0;
  addEventListener("hashchange", () => { clearTimeout(chatTimer); chatTimer = 0; });
  section({
    id: "chats",
    name: "Website chats",
    async draw(page, [chatId]) {
      clearTimeout(chatTimer);
      if (chatId) return drawChat(page, chatId);
      const r = await api(`${A}conversations`);
      const list = r.conversations || [];
      page.innerHTML = `<div class="chips"><a class="chip" href="#inbox">Enquiries</a><a class="chip" href="#chats" aria-current="page">Website chats</a></div>
        ${list.length ? `<ul class="rows">${list.map((c) => `<li><a class="row" href="#chats/${encodeURIComponent(c.chat_id)}"><span class="row-lead">${icon("agent")}</span><span class="row-main"><strong>${esc(c.first_question || "A visitor")}</strong><small>${[c.messages && `${c.messages} message${c.messages > 1 ? "s" : ""}`, c.live ? `${c.live_name || "Someone"} has it` : "", c.enquiries ? "Left an enquiry" : ""].filter(Boolean).map(esc).join(" · ")}</small></span><span class="row-end">${esc(when(c.last || c.started))}</span></a></li>`).join("")}</ul>` : `<p class="note">No website chats.</p>`}`;
    },
  });
  async function drawChat(page, chatId) {
    const r = await api(`${A}conversations?chat=${encodeURIComponent(chatId)}`);
    if (location.hash !== `#chats/${encodeURIComponent(chatId)}` && location.hash !== `#chats/${chatId}`) return;
    const msgs = r.messages || [];
    const live = r.live || {};
    const mine = live.mode === "staff";
    const typed = page.querySelector("#chat-reply textarea")?.value || "";
    const lines = msgs.map((m) => m.role === "note"
      ? `<li class="note small">${esc(m.content)} · ${esc(when(m.created_at))}</li>`
      : `<li class="say ${m.role === "user" ? "in" : "out"}"><p class="say-who">${m.role === "user" ? "Visitor" : m.role === "staff" ? `${esc(m.sender || "Someone")} (studio)` : "NovaBot"} <span class="muted">${esc(when(m.created_at))}</span></p><p class="pre">${esc(m.content)}</p></li>`).join("");
    page.innerHTML = `<ul class="talk">${lines || '<li class="note">This conversation has been deleted (they\'re kept for 90 days).</li>'}</ul>
      ${msgs.length ? `<div class="card"><p>${mine ? `${esc(live.staffName || "Someone")} from the studio has this chat. NovaBot is paused.` : "NovaBot is answering this chat. Reply below, or take it over, to answer the visitor yourself."}</p>
        <div class="btns"><button type="button" class="btn" data-live="${mine ? "handback" : "takeover"}">${mine ? "Hand back to NovaBot" : "Take over"}</button></div></div>
      <form class="stack form" id="chat-reply"><label>${mine ? "Write to the visitor" : "Write to the visitor (this takes the chat over)"}<textarea rows="3" maxlength="1500" required></textarea></label>
        <p class="form-said" role="status"></p><button class="btn main wide" type="submit">Send</button></form>` : ""}
      <p><a class="btn wide" href="#chats">${icon("back")} Back to the chats</a></p>`;
    const form = page.querySelector("#chat-reply");
    if (form) {
      const box = form.querySelector("textarea");
      box.value = typed;
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const text = box.value.trim(), btn = form.querySelector("[type=submit]");
        if (!text) return;
        btn.disabled = true;
        try { await live_(chatId, "reply", { text }); box.value = ""; await drawChat(page, chatId); }
        catch (err) { form.querySelector(".form-said").textContent = `Not sent (${err.message}).`; btn.disabled = false; }
      });
    }
    page.querySelector("[data-live]")?.addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true;
      try { await live_(chatId, ev.currentTarget.dataset.live); await drawChat(page, chatId); }
      catch (err) { ev.currentTarget.textContent = `Didn't work (${err.message})`; }
    });
    // (new words from the visitor: looked for every 5 seconds while it's open, not while typing a reply)
    clearTimeout(chatTimer);
    chatTimer = setTimeout(() => { if (!document.hidden && document.activeElement?.tagName !== "TEXTAREA") drawChat(page, chatId).catch(() => {}); else chatTimer = setTimeout(() => drawChat(page, chatId).catch(() => {}), 5000); }, 5000);
  }
  const live_ = (chatId, action, extra = {}) => api(`${A}conversations/live`, { method: "POST", body: JSON.stringify({ chatId, action, ...extra }) });

  // A draft: approved and sent (a person's press), or discarded
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-approve], [data-discard]");
    if (!b) return;
    const approve = b.hasAttribute("data-approve");
    b.disabled = true;
    try {
      await api(`${A}enquiries/draft/${approve ? "approve" : "discard"}`, { method: "POST", body: JSON.stringify({ messageId: Number(b.dataset.approve || b.dataset.discard) }) });
      window.NovaPhone.show();
    } catch (err) {
      b.disabled = false;
      b.textContent = `${approve ? "Not sent" : "Not discarded"} (${err.message})`;
    }
  });
})();
