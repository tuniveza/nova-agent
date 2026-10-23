// Nova Phone: Outreach (Nova Desk's Portal → Campaigns, One-to-one emails, Social and Funnel). Everything that
// goes out waits for an admin's approval, as on Nova Desk; nothing here sends by itself, and every Approve says
// exactly what will happen before it does it.
//   Campaigns    emails to fans, clients or everyone: the email as people will get it, write, change (also a
//                rejected one), approve (now or at a time), reject with why, test, how a sent one did, history;
//                waiting, scheduled, sent and rejected; the fan sign-up link
//   One-to-one   single emails (a business, a client, someone who wrote in): the email as it goes (footer and
//                all), find someone in Google Contacts, the same approve steps, "don't email them again"
//   Social       posts (Facebook, Instagram, YouTube): at a glance (waiting, scheduled, followers, comments),
//                write with each platform's limits counted, pictures and videos added and taken out, approve
//                (saying which go by themselves and which by hand), post by hand, where each went, results,
//                history; coming up by day; comments with replies to approve or reject; ideas (Agent), ads
//   Funnel       prospects: add (a CSV), export, write drafts (Claude), approve, hold, replied, said no or
//                reject, the warm-up, the settings (admins)
// Times are UK time, as on Nova Desk.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, form: sheetForm, busy } = N;
  const A = "/app/api/";
  const UK = "Europe/London";
  const PARTS = [["campaigns", "Campaigns"], ["one", "One-to-one"], ["social", "Social"], ["funnel", "Funnel"]];
  const partTabs = (on) => `<nav class="seg outreach-tabs" aria-label="Outreach">${PARTS.map(([p, l]) => `<a class="seg-a" href="#outreach${p === "campaigns" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</nav>`;

  N.section({
    id: "outreach",
    name: "Outreach",
    tile: "portal",
    async draw(box, [part, a], ui) {
      await N.css("outreach.css");
      box.classList.add("outreach");
      if (part === "one") return a ? drawOne(box, a, ui) : drawOnes(box, ui);
      if (part === "social") return a ? drawPost(box, a, ui) : drawSocial(box, ui);
      if (part === "comment") return drawComment(box, a, ui);
      if (part === "funnel") return a === "settings" ? drawFunnelSettings(box, ui) : a ? drawProspect(box, a, ui) : drawFunnel(box, ui);
      if (part === "campaign") return drawCampaign(box, a, ui);
      return drawCampaigns(box, ui);
    },
  });

  // ---- Shared parts ----
  const pill = (words, tone = "") => `<small class="pill${tone ? ` ${tone}` : ""}">${esc(words)}</small>`;
  const facts = (pairs) => {
    const f = pairs.filter(([, v]) => v !== undefined && v !== null && v !== "");
    return f.length ? `<div class="facts">${f.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>` : "";
  };
  const people = (n) => `${(Number(n) || 0).toLocaleString("en-GB")} ${Number(n) === 1 ? "person" : "people"}`;
  const num = (x) => (Number(x) || 0).toLocaleString("en-GB");
  const firstLine = (t) => String(t || "").split("\n").map((x) => x.trim()).find(Boolean) || "";
  const go = (hash) => (location.hash === hash ? N.show() : (location.hash = hash));
  const problemSlot = '<p class="bad small outreach-problem" data-problem role="alert" hidden></p>';
  function problem(box, text) {
    const p = box.querySelector("[data-problem]");
    if (p) { p.textContent = text || ""; p.hidden = !text; }
  }
  // A folded part that stays open (or shut) when the screen is brought up to date
  const opened = new Map();
  const det = (key, summary, inner, open = false) => `<details class="card" data-keep="${esc(key)}"${(opened.has(key) ? opened.get(key) : open) ? " open" : ""}><summary>${esc(summary)}</summary>${inner}</details>`;
  const keep = (box) => box.querySelectorAll("details[data-keep]").forEach((d) => d.addEventListener("toggle", () => opened.set(d.dataset.keep, d.open)));
  // What happened to it, oldest first (the last few)
  const logList = (log, words, n = 10) => list(log.slice(-n).map((e) => row({ icon: "clock", title: words[e.event] || e.event, text: [e.detail, ukWhen(e.at), e.byName].filter(Boolean).join(" · ") })));
  // Sizes that vary (bars, meters): set from data attributes once on the page (the page's rules allow no style="")
  function sizes(box) {
    for (const el of box.querySelectorAll("[data-w]")) el.style.setProperty("width", `${el.dataset.w}%`);
    for (const el of box.querySelectorAll("[data-h]")) el.style.setProperty("height", `${el.dataset.h}%`);
    for (const el of box.querySelectorAll("[data-at]")) el.style.setProperty("bottom", `${el.dataset.at}%`);
  }
  // Buttons on a screen: each a job; a problem stays on the screen (and in a toast) and the buttons work again
  function wireActs(box, attr, jobs) {
    box.querySelectorAll(`[${attr}]`).forEach((b) => b.addEventListener("click", async () => {
      const job = jobs[b.getAttribute(attr)];
      if (!job) return;
      problem(box, "");
      try {
        if ((await job(b)) !== false) N.show();
      } catch (err) {
        if (err.signIn) return N.show();
        toast(err.message, true);
        problem(box, `${err.prefix || ""}${err.message}`);
      }
    }));
  }
  const tag = (prefix, p) => p.catch((err) => { err.prefix = prefix; throw err; });
  // A sheet with a form: run(elements, form) does the work; a problem shows in the sheet, which stays open.
  // cancelled() runs when it's shut without saving.
  function sheetDo({ title, html, ok = "Save", working = "Saving…", run, wire, cancelled }) {
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${html}<p class="form-said bad" data-said role="alert"></p><div class="btns"><button class="btn main wide" type="submit">${esc(ok)}</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]");
        const said = f.querySelector("[data-said]");
        let finished = false;
        el.addEventListener("close", () => { if (!finished && cancelled) cancelled(); }, { once: true });
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const b = ev.submitter || f.querySelector("[type=submit]");
          said.textContent = "";
          try {
            const out = await busy(b, working, () => run(f.elements, f));
            finished = true;
            done(out === undefined ? true : out);
          } catch (err) {
            if (err.signIn) { finished = true; done(null); return N.show(); }
            said.textContent = err.message;
          }
        };
        f.querySelector("[data-no]").onclick = () => done(null);
        if (wire) wire(f);
      });
  }
  const oops = (text) => { throw new Error(text); };
  const whyField = () => field({ label: "Why (optional)", name: "note", type: "textarea", rows: 3, placeholder: "So Nova Agent (or whoever wrote it) can fix it", attrs: 'maxlength="500"' });
  // Brought up to date while it's on screen (not while something's being written, nor when the phone's away)
  let tick = 0;
  function later(ms) {
    clearTimeout(tick);
    const h = location.hash;
    tick = setTimeout(() => {
      if (location.hash !== h || document.hidden || document.getElementById("sheet")?.open || document.querySelector("#page input:focus, #page textarea:focus, #page select:focus, #page form.dirty")) return;
      N.show();
    }, ms);
  }
  addEventListener("hashchange", () => clearTimeout(tick));
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(tick); });
  // A file from the server (or one made here) saved on the phone
  function saveFile(blob, name) {
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function copyText(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); } catch (e) { toast("Couldn't copy: press and hold the words instead", true); }
  }

  // ---- UK times ----
  function ukParts(d) {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
    return p;
  }
  // "Fri 16 Oct, 18:00" (UK time; the year when it isn't this one)
  function ukWhen(v) {
    const d = N.asDate(v);
    if (!d) return "";
    return d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit", timeZone: UK }).replace(/^(\p{L}+),/u, "$1");
  }
  const ukTime = (v) => { const d = N.asDate(v); return d ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: UK }) : ""; };
  const dayName = (v) => { const d = N.asDate(v); return d ? d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: UK }) : ""; };
  // An ISO time as the UK clock "2026-10-16T18:00" (for a date-and-time box)
  const ukLocal = (v) => { const d = N.asDate(v); if (!d) return ""; const p = ukParts(d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  // The UK clock "2026-10-16T18:00" as ISO, whatever the clocks are doing
  function ukToIso(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || "");
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const offset = (t) => { const p = ukParts(new Date(t)); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
    let t = wall - offset(wall);
    t = wall - offset(t);
    return new Date(t).toISOString();
  }
  // A send or post time from its box: "" (as soon as it's approved), or a time that hasn't passed
  function readWhen(local) {
    if (!local) return "";
    const iso = ukToIso(local);
    if (!iso || Date.parse(iso) < Date.now()) oops("Pick a time that hasn't passed, or leave it empty.");
    return iso;
  }
  const nowLocal = () => ukLocal(new Date().toISOString());

  // ---- The email as people will get it: the server's HTML, drawn here safely (no scripts, links to web pages
  // only), its look kept (styles set through the page, which its rules allow) ----
  const MAIL_TAGS = new Set(["DIV", "P", "A", "B", "STRONG", "EM", "I", "U", "BR", "SPAN", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "HR", "TABLE", "TBODY", "THEAD", "TR", "TD", "TH", "IMG", "SMALL", "CENTER"]);
  const MAIL_DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "LINK", "META", "TITLE", "HEAD", "SVG", "VIDEO", "AUDIO"]);
  const MAIL_STYLE = /^(margin|padding|background|background-color|color|font|font-size|font-weight|font-family|font-style|line-height|letter-spacing|text-transform|text-align|text-decoration|border|border-radius|border-top|border-bottom|max-width|vertical-align)(-[a-z]+)?$/;
  function styleFrom(el, text) {
    for (const decl of String(text || "").split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).replace(/!important/i, "").trim();
      if (MAIL_STYLE.test(k) && !/url\(|expression|javascript:/i.test(v)) el.style.setProperty(k, v);
    }
  }
  function renderMail(target, html) {
    const doc = new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
    const copy = (from, to) => {
      for (const n of from.childNodes) {
        if (n.nodeType === 3) { to.append(n.textContent); continue; }
        if (n.nodeType !== 1 || MAIL_DROP.has(n.tagName)) continue;
        if (!MAIL_TAGS.has(n.tagName)) { copy(n, to); continue; }
        let el;
        if (n.tagName === "A") {
          const href = (n.getAttribute("href") || "").trim();
          if (/^(https?:|mailto:|tel:)/i.test(href)) el = Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener" });
          // (the unsubscribe link: each person's own, made as it goes)
          else el = Object.assign(document.createElement("button"), { type: "button", className: "outreach-mail-link" });
        } else if (n.tagName === "IMG") {
          const src = (n.getAttribute("src") || "").trim();
          if (!/^(https:|data:image\/)/i.test(src)) continue;
          el = Object.assign(document.createElement("img"), { src, alt: n.getAttribute("alt") || "", loading: "lazy" });
        } else el = document.createElement(n.tagName.toLowerCase());
        styleFrom(el, n.getAttribute("data-style"));
        copy(n, el);
        to.append(el);
      }
    };
    const wrap = Object.assign(document.createElement("div"), { className: "outreach-mail-in" });
    styleFrom(wrap, doc.body.getAttribute("data-style"));
    copy(doc.body, wrap);
    target.replaceChildren(wrap);
    target.onclick = (e) => { if (e.target.closest(".outreach-mail-link")) toast("In the real email this is each person's own unsubscribe link"); };
  }

  // ===================================================================================================
  // ---- Campaigns ----
  const C_STATUS = { draft: ["Draft", "warn"], pending_approval: ["Waiting for approval", "warn"], approved: ["Approved · sending", ""], scheduled: ["Scheduled", ""], sent: ["Sent", "ok"], failed: ["Didn't send", "bad"], rejected: ["Rejected", "bad"] };
  const cPill = (c) => (c.status === "scheduled" && c.sending ? pill("Sending") : pill(...(C_STATUS[c.status] || [c.status])));
  const AUDIENCE = { fans: "Fans", clients: "Studio clients", everyone: "Everyone (fans and clients)" };
  const WRITERS = { agent: "Nova Agent", "staff-chat": "Portal's staff chat" };
  const C_EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Sent", scheduled: "Scheduled", failed: "Didn't send", stats: "Results updated" };
  const cWaiting = (c) => c.status === "pending_approval" || c.status === "draft";
  const byKey = (key, dir) => (a, b) => dir * String(a[key] || a.updatedAt || "").localeCompare(String(b[key] || b.updatedAt || ""));

  async function drawCampaigns(box, ui) {
    const r = await api(`${A}campaigns`);
    const all = r.campaigns || [], aud = r.audiences || {};
    ui.action({ icon: "plus", label: "Write a campaign", run: () => writeCampaign(null, r) });
    const waiting = all.filter(cWaiting).sort(byKey("createdAt", 1));
    const coming = all.filter((c) => c.status === "approved" || c.status === "scheduled").sort(byKey("sendAt", 1));
    const sent = all.filter((c) => c.status === "sent" || c.status === "failed").sort(byKey("sentAt", -1)).slice(0, 20);
    const rejected = all.filter((c) => c.status === "rejected").sort(byKey("decidedAt", -1)).slice(0, 10);
    const cRow = (c) => row({
      href: `#outreach/campaign/${c.id}`, icon: "mail", title: c.subject || "(No subject)",
      text: [AUDIENCE[c.audience] || c.audience, c.status === "sent" ? `sent ${ukWhen(c.sentAt)}${c.recipients != null ? ` to ${people(c.recipients)}` : ""}` : ["approved", "scheduled"].includes(c.status) ? (c.sendAt ? `sends ${ukWhen(c.sendAt)}` : "sending now") : c.status === "rejected" ? `rejected ${ukWhen(c.decidedAt)}` : c.status === "failed" ? "nobody got it" : `written by ${WRITERS[c.createdBy] || "someone in the team"}`].filter(Boolean).join(" · "),
      html: `<span class="outreach-pills">${cPill(c)}</span>`,
    });
    box.innerHTML = `${partTabs("campaigns")}
      <p class="muted small">${r.canDecide ? "Emails to fans and clients who opted in. Nothing is sent until you approve it." : "Emails to fans and clients who opted in. An admin approves these; nothing is sent until then."}</p>
      <h3 class="h">Waiting for approval${waiting.length ? ` · ${waiting.length}` : ""}</h3>
      ${waiting.length ? list(waiting.map(cRow)) : '<p class="muted small outreach-none">Nothing waiting for approval.</p>'}
      ${coming.length ? `<h3 class="h">Scheduled</h3>${list(coming.map(cRow))}` : ""}
      ${sent.length ? `<h3 class="h">Sent</h3>${list(sent.map(cRow))}` : ""}
      ${rejected.length ? `<h3 class="h">Rejected</h3>${list(rejected.map(cRow))}` : ""}
      <button type="button" class="btn wide" data-write>${icon("plus")} Write a campaign</button>
      <div class="card"><p class="kicker">Fan sign-up link</p><p class="small">Share it on SoundCloud, Instagram and your other socials. People confirm by email before they're on the list, and can unsubscribe from any email.</p>
        ${r.signupUrl ? `<a class="outreach-link" href="${esc(r.signupUrl)}" target="_blank" rel="noopener">${esc(r.signupUrl)}</a><div class="btns two"><button type="button" class="btn" data-copy>Copy the link</button><a class="btn" href="${esc(r.signupUrl)}" target="_blank" rel="noopener">${icon("globe")} Open it</a></div>` : ""}
        <div class="sums outreach-sums">${[["fans", "Confirmed fans"], ["clients", "Clients who said yes"], ["everyone", "Everyone (each once)"]].map(([k, l]) => `<div class="sum"><b>${num(aud[k])}</b><span>${l}</span></div>`).join("")}</div>
        <p class="muted small">Only people who said yes can be emailed.</p></div>`;
    box.querySelector("[data-write]").addEventListener("click", () => writeCampaign(null, r));
    box.querySelector("[data-copy]")?.addEventListener("click", () => copyText(r.signupUrl, "Copied the sign-up link"));
    if (all.some((c) => c.status === "approved" || c.sending)) later(20000);
    else later(60000);
  }

  function writeCampaign(c, r) {
    const aud = r?.audiences || {};
    return sheetDo({
      title: c ? "Change the campaign" : "Write a campaign",
      ok: c ? "Save changes" : "Save for approval",
      html: `${field({ label: "Subject", name: "subject", value: c?.subject || "", required: true, attrs: 'maxlength="150"' })}
        ${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: c?.body || "", required: true, placeholder: "Short paragraphs with a blank line between them. **Bold** for the one thing that matters. Full links (https://…). Sign it Novacane Studios.", attrs: 'maxlength="20000"' })}
        ${field({ label: "Who it goes to", name: "audience", type: "select", value: c?.audience || "fans", options: Object.entries(AUDIENCE).map(([k, l]) => [k, `${l}${aud[k] !== undefined ? ` · ${aud[k]} opted in` : ""}`]) })}
        ${field({ label: "Send at (UK time; empty: as soon as it's approved)", name: "sendAt", type: "datetime-local", value: ukLocal(c?.sendAt), attrs: `min="${nowLocal()}"` })}
        <p class="muted small">The footer (who it's from, why they're getting it, and the unsubscribe link) is added for you.</p>`,
      async run(x) {
        const subject = x.subject.value.trim(), body = x.body.value.trim();
        if (!subject || !body) oops("It needs a subject and the email.");
        const sendAt = readWhen(x.sendAt.value);
        const out = c
          ? await post(`${A}campaigns/${c.id}/edit`, { subject, body, audience: x.audience.value, sendAt: sendAt || null })
          : await post(`${A}campaigns`, { subject, body, audience: x.audience.value, ...(sendAt ? { sendAt } : {}) });
        toast(c ? "Saved: waiting for approval" : "Saved: waiting for an admin's approval");
        const id = (out.campaign || c || {}).id;
        go(id ? `#outreach/campaign/${id}` : "#outreach");
      },
    });
  }

  async function drawCampaign(box, id, ui) {
    ui.back("#outreach");
    ui.title("Campaign");
    const [d, all] = await Promise.all([api(`${A}campaigns/${encodeURIComponent(id)}`).catch((e) => (e.status === 404 ? null : Promise.reject(e))), api(`${A}campaigns`)]);
    const c = d?.campaign;
    if (!c) { box.innerHTML = `${empty({ icon: "mail", title: "That campaign isn't there", text: "It may have been taken off." })}<a class="btn wide" href="#outreach">All the campaigns</a>`; return; }
    const can = !!all.canDecide, aud = all.audiences || {}, size = aud[c.audience], waiting = cWaiting(c), editable = waiting || c.status === "rejected";
    const s = c.stats || {}, sentN = Number(s.sent || c.recipients) || 0;
    const stats = c.status === "sent" ? `<div class="card"><p class="kicker">How it went</p><div class="sums outreach-sums">${[[String(sentN), "Sent"], [String(Number(s.unsubscribed) || 0), "Unsubscribed"], Number(s.failed) ? [String(s.failed), "Didn't go"] : null, Number(s.skipped) ? [String(s.skipped), "Unsubscribed first"] : null, Number(s.opened) ? [(Number(s.delivered) || sentN) > 0 ? `${Math.round((Number(s.opened) / (Number(s.delivered) || sentN)) * 100)}%` : "–", "Opened"] : null].filter(Boolean).map(([v, l]) => `<div class="sum"><b>${esc(v)}</b><span>${l}</span></div>`).join("")}</div>
      <p class="muted small">Sent by the studio's own mail server${s.fetchedAt ? `, finished ${esc(ukWhen(s.fetchedAt))}` : ""}. Opens and clicks aren't tracked; unsubscribes are counted as they come in.</p></div>` : "";
    const mail = `<div class="outreach-mail" data-mail></div>`;
    box.innerHTML = `<div class="card"><p class="kicker">${cPill(c)}</p><h2 class="card-title">${esc(c.subject || "(No subject)")}</h2>
        <p class="muted small">Written by ${esc(WRITERS[c.createdBy] || "someone in the team")}${c.createdAt ? ` · ${esc(ukWhen(c.createdAt))}` : ""}</p>
        ${facts([
          ["Goes to", `${AUDIENCE[c.audience] || c.audience}${size !== undefined && c.status !== "sent" ? ` · ${size} opted in` : ""}`],
          c.status === "sent" ? ["Sent", `${ukWhen(c.sentAt)}${c.recipients != null ? ` · to ${people(c.recipients)}` : ""}`] : c.status !== "failed" && c.status !== "rejected" ? [c.status === "scheduled" ? "Sends" : "Send time", c.sendAt ? `${ukWhen(c.sendAt)} (UK time)` : "As soon as it's approved"] : ["", ""],
          [c.status === "rejected" ? "Rejected by" : "Approved by", c.decidedByName && c.status !== "pending_approval" ? `${c.decidedByName}${c.decidedAt ? ` · ${ukWhen(c.decidedAt)}` : ""}` : ""],
          ["Note", c.note],
        ])}
        ${c.status === "failed" ? `<p class="bad small">Didn't send: ${esc(String(c.error || "unknown reason").replace(/\.$/, ""))}. Nobody got it.</p>` : ""}
        ${c.status === "approved" ? '<p class="small">Approved · getting ready to send…</p>' : ""}
        ${c.status === "scheduled" && c.sending ? `<p class="small">Going out now, a few a minute · ${c.sending.sent} of ${c.sending.total} sent</p>` : ""}</div>
      ${stats}
      ${waiting ? `<div class="card"><p class="kicker">The email, as people will get it</p>${mail}</div>` : det(`c-mail-${c.id}`, "The email, as people got it", mail)}
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-c="approve">${icon("send")} Approve</button><button type="button" class="btn danger" data-c="reject">Reject</button></div>` : ""}
      ${editable || (waiting && can) ? `<div class="btns two">${editable ? `<button type="button" class="btn" data-c="edit">${icon("edit")} Change it</button>` : ""}${waiting && can ? `<button type="button" class="btn" data-c="test">${icon("mail")} Send me a test</button>` : ""}</div>` : ""}
      ${waiting && !can ? '<p class="muted small">An admin approves these. Nothing is sent until then.</p>' : ""}
      ${c.status === "rejected" ? '<p class="muted small">Change it to send it for approval again.</p>' : ""}
      ${problemSlot}
      ${(d.log || []).length ? det(`c-log-${c.id}`, "What happened", logList(d.log, C_EVENTS)) : ""}`;
    const m = box.querySelector("[data-mail]");
    if (d.previewHtml) renderMail(m, d.previewHtml);
    else m.innerHTML = `<p class="pre">${esc(c.body || "")}</p>`;
    keep(box);
    wireActs(box, "data-c", {
      edit: () => (writeCampaign(c, all), false),
      async test(b) {
        await tag("Test not sent: ", busy(b, "Sending…", () => post(`${A}campaigns/test-send`, { id: c.id })));
        toast("A test is on its way to your own email (marked [TEST])");
        return false;
      },
      async approve(b) {
        if (!(await confirm({ title: c.sendAt ? `Schedule it for ${ukWhen(c.sendAt)}?` : `Send it to ${size !== undefined ? people(size) : "them"} now?`, text: "It emails real people. Nova Bot sends exactly what's shown here.", ok: c.sendAt ? "Schedule it" : "Send it" }))) return false;
        return busy(b, "Approving…", async () => {
          const now = (await tag("Not approved: ", api(`${A}campaigns/${c.id}`))).campaign || {};
          if (now.updatedAt !== c.updatedAt || now.status !== c.status) { toast("It changed since it was shown: check it again", true); return; }
          const done = (await tag("Not approved: ", post(`${A}campaigns/${c.id}/approve`, {}))).campaign || {};
          toast(done.status === "sent" ? `Sent to ${people(done.recipients)}` : done.status === "scheduled" ? `Scheduled for ${ukWhen(done.sendAt)}` : done.status === "failed" ? `Didn't send: ${done.error || "see the campaign"}` : "Approved: sending now", done.status === "failed");
        });
      },
      async reject() {
        const ok = await sheetDo({ title: "Reject the campaign", ok: "Reject it", working: "Rejecting…", html: `${whyField()}<p class="muted small">Nothing is sent. It can be changed and sent for approval again.</p>`, run: (x) => post(`${A}campaigns/${c.id}/reject`, { note: x.note.value.trim() || undefined }) });
        if (!ok) return false;
        toast("Rejected: nothing was sent");
      },
    });
    if (c.status === "approved" || c.sending) later(20000);
  }

  // ===================================================================================================
  // ---- One-to-one emails ----
  const O_STATUS = { draft: ["Draft", "warn"], pending_approval: ["Waiting for approval", "warn"], approved: ["Approved · sending", ""], sent: ["Sent", "ok"], failed: ["Didn't send", "bad"], rejected: ["Rejected", "bad"] };
  const KINDS = { business: "A business", client: "A studio client", reply: "Someone who wrote in" };
  const O_EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Sent", failed: "Didn't send" };
  const oWaiting = (o) => o.status === "pending_approval" || o.status === "draft";
  const oTo = (o) => [o.toName, o.organisation].filter(Boolean).join(", ");
  const oPill = (o) => pill(...(O_STATUS[o.status] || [o.status]));

  async function drawOnes(box, ui) {
    const r = await api(`${A}outreach`);
    const all = r.outreach || [];
    ui.action({ icon: "plus", label: "Write a one-to-one email", run: () => writeOne(null) });
    const by = (key) => (a, b) => String(b[key] || b.updatedAt || "").localeCompare(String(a[key] || a.updatedAt || ""));
    const waiting = all.filter(oWaiting).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const sent = all.filter((o) => ["sent", "failed", "approved"].includes(o.status)).sort(by("sentAt")).slice(0, 20);
    const rejected = all.filter((o) => o.status === "rejected").sort(by("decidedAt")).slice(0, 10);
    const oRow = (o) => row({ href: `#outreach/one/${o.id}`, icon: "mail", title: o.subject || "(No subject)", text: [oTo(o) ? `${oTo(o)} · ${o.toEmail}` : o.toEmail, o.status === "sent" ? `sent ${ukWhen(o.sentAt)}` : oWaiting(o) ? `by ${o.createdByName || "someone in the team"}` : ""].filter(Boolean).join(" · "), html: `<span class="outreach-pills">${oPill(o)}</span>` });
    box.innerHTML = `${partTabs("one")}
      <p class="muted small">${r.canDecide ? "A personal email to one person. Nothing is sent until you approve it." : "A personal email to one person. An admin approves these; nothing is sent until then."}</p>
      <h3 class="h">Waiting for approval${waiting.length ? ` · ${waiting.length}` : ""}</h3>
      ${waiting.length ? list(waiting.map(oRow)) : '<p class="muted small outreach-none">No one-to-one emails waiting.</p>'}
      ${sent.length ? `<h3 class="h">Sent one-to-one</h3>${list(sent.map(oRow))}` : ""}
      ${rejected.length ? `<h3 class="h">Not sent</h3>${list(rejected.map(oRow))}` : ""}
      <button type="button" class="btn wide" data-write>${icon("plus")} Write a one-to-one email</button>
      <form class="form card" data-optout autocomplete="off"><p class="kicker">Someone replied “no thanks”?</p>${field({ label: "Their email", name: "email", type: "email", required: true, attrs: 'maxlength="200"' })}<button class="btn wide" type="submit">Don't email them again</button><p class="muted small">They won't get one-to-one or funnel emails again, and anything waiting to them won't go.</p></form>`;
    box.querySelector("[data-write]").addEventListener("click", () => writeOne(null));
    const f = box.querySelector("[data-optout]");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = f.elements.email.value.trim();
      if (!email) return;
      try {
        const out = await busy(f.querySelector("[type=submit]"), "Recording…", () => post(`${A}outreach/optouts`, { email }));
        f.classList.remove("dirty");
        toast(`Recorded: ${out.email || email} won't get one-to-one emails again${out.stopped ? ` (${out.stopped} waiting stopped)` : ""}`);
        N.show();
      } catch (err) { toast(`Not recorded: ${err.message}`, true); }
    });
    later(60000);
  }

  function writeOne(o) {
    const isNew = !o;
    return sheetDo({
      title: o ? "Change the email" : "Write a one-to-one email",
      ok: o ? "Save changes" : "Save for approval",
      html: `${isNew ? `<div class="outreach-find" data-findwrap>${field({ label: "Find in Google Contacts (optional)", name: "lookup", type: "search", placeholder: "A name, email or company", attrs: 'autocomplete="off" enterkeyhint="search"' })}<div data-found role="listbox" aria-label="People found in Google Contacts"></div></div>` : ""}
        ${field({ label: "Who it's to", name: "kind", type: "select", value: o?.kind || "business", options: Object.entries(KINDS) })}
        ${field({ label: "Their email", name: "toEmail", type: "email", value: o?.toEmail || "", required: true, attrs: 'maxlength="200"' })}
        ${field({ label: "Their name (optional)", name: "toName", value: o?.toName || "", attrs: 'maxlength="100"' })}
        <div data-only="business">${field({ label: "Business or organisation", name: "organisation", value: o?.organisation || "", attrs: 'maxlength="120"' })}</div>
        <div data-only="client">${toggle({ label: "It's about their own booking (clients who haven't said yes to studio news can only get these)", name: "aboutBooking", checked: !!o?.aboutBooking })}</div>
        ${field({ label: "Subject", name: "subject", value: o?.subject || "", required: true, attrs: 'maxlength="150"' })}
        ${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: o?.body || "", required: true, placeholder: "Hi Sam, … One clear ask. Signed Novacane Studios.", attrs: 'maxlength="10000"' })}
        <p class="muted small">The footer (who it's from, why they're getting it, and a "don't email me again" link) is added for you.</p>`,
      wire(f) {
        // The business field for a business (and needed), the booking tick for a client
        const kind = () => {
          const k = f.elements.kind.value;
          for (const w of f.querySelectorAll("[data-only]")) w.hidden = w.dataset.only !== k;
          f.elements.organisation.required = k === "business";
        };
        f.elements.kind.addEventListener("change", kind);
        kind();
        const find = f.elements.lookup;
        if (!find) return;
        const found = f.querySelector("[data-found]");
        let timer = 0, asked = "";
        find.addEventListener("input", () => {
          clearTimeout(timer);
          const q = find.value.trim();
          if (q.length < 2) { found.innerHTML = ""; return; }
          timer = setTimeout(async () => {
            asked = q;
            let res;
            try { res = await api(`${A}google/contacts?q=${encodeURIComponent(q)}`); } catch (err) { found.innerHTML = `<p class="muted small">${err.signIn ? "" : "Google Contacts didn't answer just now."}</p>`; return; }
            if (asked !== q) return;
            if (res.off) { f.querySelector("[data-findwrap]").hidden = true; return; }
            const picks = (res.contacts || []).filter((c) => c.email).slice(0, 8);
            found.innerHTML = picks.length ? list(picks.map((c, i) => row({ button: `data-pick="${i}" role="option"`, icon: "user", title: c.name || c.email, text: c.name ? c.email : "" }))) : '<p class="muted small">Nobody in Google Contacts matches that.</p>';
            found.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
              const c = picks[Number(b.dataset.pick)];
              f.elements.toEmail.value = c.email || "";
              if (c.name) f.elements.toName.value = c.name;
              found.innerHTML = "";
              find.value = "";
              toast(`Filled in ${c.name || c.email}`);
            }));
          }, 300);
        });
      },
      async run(x) {
        const kind = x.kind.value;
        const body = { kind, toEmail: x.toEmail.value.trim(), toName: x.toName.value.trim(), subject: x.subject.value.trim(), body: x.body.value.trim() };
        if (!body.toEmail || !body.subject || !body.body) oops("It needs their email, a subject and the email.");
        if (o) Object.assign(body, { organisation: x.organisation.value.trim(), aboutBooking: x.aboutBooking.checked });
        else {
          if (kind === "business") body.organisation = x.organisation.value.trim();
          if (kind === "client") body.aboutBooking = x.aboutBooking.checked;
        }
        if (kind === "business" && !x.organisation.value.trim()) oops("Say which business or organisation it's to.");
        const out = await post(o ? `${A}outreach/${o.id}/edit` : `${A}outreach`, body);
        toast(o ? "Saved: waiting for approval" : "Saved: waiting for an admin's approval");
        const id = (out.outreach || o || {}).id;
        go(id ? `#outreach/one/${id}` : "#outreach/one");
      },
    });
  }

  async function drawOne(box, id, ui) {
    ui.back("#outreach/one");
    ui.title("One-to-one email");
    const [d, all] = await Promise.all([api(`${A}outreach/${encodeURIComponent(id)}`).catch((e) => (e.status === 404 ? null : Promise.reject(e))), api(`${A}outreach`)]);
    const o = d?.outreach;
    if (!o) { box.innerHTML = `${empty({ icon: "mail", title: "That email isn't there" })}<a class="btn wide" href="#outreach/one">All the one-to-one emails</a>`; return; }
    const can = !!all.canDecide, waiting = oWaiting(o), editable = waiting || o.status === "rejected";
    const mail = `<p class="pre outreach-plain">${esc(d.email || o.body || "")}</p>`;
    box.innerHTML = `<div class="card"><p class="kicker">${oPill(o)}</p><h2 class="card-title">${esc(o.subject || "(No subject)")}</h2>
        <p class="muted small">Written by ${esc(o.createdByName || "someone in the team")}${o.createdAt ? ` · ${esc(ukWhen(o.createdAt))}` : ""}</p>
        ${facts([
          ["To", `${oTo(o) ? `${oTo(o)} · ` : ""}${o.toEmail}`],
          ["Who they are", `${KINDS[o.kind] || o.kind}${o.kind === "client" ? (o.aboutBooking ? " · about their booking" : " · said yes to studio news") : ""}`],
          ["Sent", o.status === "sent" ? ukWhen(o.sentAt) : ""],
          [o.status === "rejected" ? "Rejected by" : "Approved by", o.decidedByName && o.status !== "pending_approval" ? `${o.decidedByName}${o.decidedAt ? ` · ${ukWhen(o.decidedAt)}` : ""}` : ""],
          ["Note", o.note],
        ])}
        ${o.status === "failed" ? `<p class="bad small">Didn't send: ${esc(String(o.error || "unknown reason").replace(/\.$/, ""))}.</p>` : ""}
        ${o.status === "approved" ? '<p class="small">Approved · sending…</p>' : ""}</div>
      ${waiting ? `<div class="card"><p class="kicker">The email, as it goes</p>${mail}</div>` : det(`o-mail-${o.id}`, "The email, as it went", mail)}
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-o="approve">${icon("send")} Approve</button><button type="button" class="btn danger" data-o="reject">Reject</button></div>` : ""}
      ${editable || (waiting && can) ? `<div class="btns two">${editable ? `<button type="button" class="btn" data-o="edit">${icon("edit")} Change it</button>` : ""}${waiting && can ? `<button type="button" class="btn" data-o="test">${icon("mail")} Send me a test</button>` : ""}</div>` : ""}
      ${waiting && !can ? '<p class="muted small">An admin approves these. Nothing is sent until then.</p>' : ""}
      ${problemSlot}
      ${(d.log || []).length ? det(`o-log-${o.id}`, "What happened", logList(d.log, O_EVENTS)) : ""}`;
    keep(box);
    wireActs(box, "data-o", {
      edit: () => (writeOne(o), false),
      async test(b) {
        await tag("Test not sent: ", busy(b, "Sending…", () => post(`${A}outreach/test-send`, { id: o.id })));
        toast("A test is on its way to your own email (marked [TEST])");
        return false;
      },
      async approve(b) {
        if (!(await confirm({ title: `Send it to ${o.toEmail} now?`, text: "It emails a real person. Nova Bot sends exactly what's shown here, once.", ok: "Send it" }))) return false;
        return busy(b, "Approving…", async () => {
          const now = (await tag("Not approved: ", api(`${A}outreach/${o.id}`))).outreach || {};
          if (now.updatedAt !== o.updatedAt || now.status !== o.status) { toast("It changed since it was shown: check it again", true); return; }
          const done = (await tag("Not approved: ", post(`${A}outreach/${o.id}/approve`, {}))).outreach || {};
          toast(done.status === "sent" ? `Sent to ${done.toEmail}` : done.status === "failed" ? `Didn't send: ${done.error || "see the email"}` : "Approved: sending now", done.status === "failed");
        });
      },
      async reject() {
        const ok = await sheetDo({ title: "Reject the email", ok: "Reject it", working: "Rejecting…", html: `${whyField()}<p class="muted small">Nothing is sent. It can be changed and sent for approval again.</p>`, run: (x) => post(`${A}outreach/${o.id}/reject`, { note: x.note.value.trim() || undefined }) });
        if (!ok) return false;
        toast("Rejected: nothing was sent");
      },
    });
    if (o.status === "approved") later(20000);
  }

  // ===================================================================================================
  // ---- Social ----
  const S_STATUS = { draft: ["Draft", "warn"], pending_approval: ["Waiting for approval", "warn"], approved: ["Approved · starting", ""], scheduled: ["Scheduled", ""], posting: ["Posting…", ""], manual: ["Post it by hand", "warn"], posted: ["Posted", "ok"], failed: ["Didn't post", "bad"], rejected: ["Rejected", "bad"] };
  const NAMES = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube" };
  const ALL = ["facebook", "instagram", "youtube"];
  const S_EVENTS = {
    created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", scheduled: "Scheduled",
    posting: "Posting", posted: "Posted", manual: "Waiting to be posted by hand", marked_posted: "Posted by hand", failed: "Didn't post", stats: "Results updated",
    reply_drafted: "Reply written", reply_approved: "Reply approved", reply_rejected: "Reply rejected", reply_sent: "Reply posted", reply_failed: "Reply didn't post",
  };
  const IDEAS_PROMPT = "Help me plan the studio's social posts for the next week. Look at how our recent posts did (social_context), research what's trending right now for recording studios and UK artists (sounds, formats, hashtags, what similar studios post), then suggest 3 posts: the caption, Facebook or Instagram, the picture or video to use, and the best day and time to post (UK).";
  const ADS_URL = "https://adsmanager.facebook.com/";
  const ONLINE_MAX = 25 * 1024 * 1024, IMAGE_MAX = 8 * 1024 * 1024;
  const LIMITS = { instagramCaption: 2200, instagramHashtags: 30, facebookCaption: 63206, youtubeTitle: 100, youtubeDescription: 5000, media: 10 };
  const sWaiting = (p) => p.status === "pending_approval" || p.status === "draft";
  const sPill = (p) => pill(...(S_STATUS[p.status] || [p.status]));
  const names = (ps) => ps.map((p) => NAMES[p] || p).join(ps.length === 2 ? " and " : ", ");
  const hashtags = (t) => (String(t).match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
  const postTitle = (p) => { const h = firstLine(p.caption); return (h.length > 80 ? `${h.slice(0, 78).replace(/\s+\S*$/, "")}…` : h) || ((p.media || []).length ? (p.media[0].kind === "video" ? "A video post" : "A picture post") : "A post"); };
  const mediaWords = (ms) => { const v = ms.filter((m) => m.kind === "video").length, pics = ms.length - v; return [pics ? `${pics} picture${pics > 1 ? "s" : ""}` : "", v ? `${v} video${v > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and "); };
  const SOCIAL_OFF = "Social isn't switched on yet: Nova Bot needs its update.";
  const social = () => api(`${A}social`).catch((e) => (e.status === 404 ? { off: true } : Promise.reject(e)));
  // A picture or video: a still for a list row, or the picture / a player
  const leadOf = (p) => { const m = (p.media || [])[0]; return m ? (m.kind === "video" ? `<span class="outreach-thumb-s outreach-vid">${icon("play")}</span>` : `<img class="outreach-thumb-s" src="${esc(m.url)}" alt="" loading="lazy" decoding="async">`) : icon("share"); };
  const thumb = (m) => `<figure class="outreach-thumb">${m.kind === "video" ? `<video src="${esc(m.url)}" preload="metadata" muted playsinline controls></video>` : `<img src="${esc(m.url)}" alt="${esc(m.name || "")}" loading="lazy" decoding="async">`}<figcaption>${esc(m.name || "")}</figcaption></figure>`;

  async function drawSocial(box, ui) {
    const r = await social();
    if (r.off) { box.innerHTML = `${partTabs("social")}${empty({ icon: "share", title: SOCIAL_OFF })}`; return; }
    const posts = r.posts || [], comments = r.comments || [], connected = r.connected || {};
    ui.action({ icon: "plus", label: "Write a post", run: () => writePost(null, r) });
    const on = ALL.filter((p) => connected[p]), off = ALL.filter((p) => !connected[p]);
    const hint = (r.canDecide ? "Facebook, Instagram and YouTube posts. Nothing is posted until you approve it. " : "Facebook, Instagram and YouTube posts. An admin approves these; nothing is posted until then. ")
      + (!off.length ? "Approved posts go out by themselves." : on.length ? `Approved posts go out on ${names(on)} by themselves; ${names(off)} ones wait for someone to post them by hand.` : "Nothing's connected yet, so approved posts wait here for someone to post them by hand.");
    const pRow = (p) => row({
      href: `#outreach/social/${p.id}`, lead: leadOf(p), title: postTitle(p),
      text: [names(p.platforms || []), p.status === "posted" ? `posted ${ukWhen(p.postedAt)}` : ["approved", "scheduled", "posting"].includes(p.status) ? (p.postAt ? ukTime(p.postAt) : "now") : sWaiting(p) ? (p.postAt ? `for ${ukWhen(p.postAt)}` : "posts once approved") : "", mediaWords(p.media || [])].filter(Boolean).join(" · "),
      html: `<span class="outreach-pills">${sPill(p)}</span>`,
    });
    const wait = posts.filter(sWaiting).sort(byKey("createdAt", 1));
    const hand = posts.filter((p) => p.status === "manual");
    const coming = posts.filter((p) => ["approved", "scheduled", "posting"].includes(p.status)).sort(byKey("postAt", 1));
    const posted = posts.filter((p) => p.status === "posted").sort(byKey("postedAt", -1)).slice(0, 20);
    const failed = posts.filter((p) => p.status === "failed").sort(byKey("updatedAt", -1)).slice(0, 10);
    const rejected = posts.filter((p) => p.status === "rejected").sort(byKey("decidedAt", -1)).slice(0, 10);
    // Coming up, by day (UK)
    const days = [];
    for (const p of coming) { const d = p.postAt ? dayName(p.postAt) : "Now"; if (!days.length || days[days.length - 1][0] !== d) days.push([d, []]); days[days.length - 1][1].push(p); }
    // At a glance
    const f = r.followers || {};
    const next = posts.filter((p) => p.status === "scheduled" && p.postAt).sort((a, b) => String(a.postAt).localeCompare(String(b.postAt)))[0];
    const open = comments.filter((c) => !c.handled || c.replyStatus === "pending_approval");
    const done = comments.filter((c) => !open.includes(c)).slice(0, 20);
    const tile = (v, l, sub, to) => `<${to ? `button type="button" data-go="${to}"` : "div"} class="sum outreach-sum"><b>${esc(v)}</b><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</${to ? "button" : "div"}>`;
    const glance = [tile(String(wait.length), "Waiting for approval", "", "outreach-sc-wait"), tile(String(posts.filter((p) => p.status === "scheduled").length), "Scheduled", next ? `Next: ${ukWhen(next.postAt)}` : "")];
    for (const p of ALL) {
      if (!f[p]) continue;
      const c = Number(f[p].change) || 0;
      glance.push(tile(num(f[p].followers), `${NAMES[p]} ${p === "youtube" ? "subscribers" : "followers"}`, `${c >= 0 ? "+" : "−"}${num(Math.abs(c))} ${p === "youtube" ? "since yesterday" : "in 30 days"}`));
    }
    glance.push(tile(String(open.length), "Comments to answer", "", "outreach-sc-comments"));
    const cRow = (c) => row({ href: `#outreach/comment/${c.id}`, icon: "chat", title: `${c.author || "Someone"} on ${NAMES[c.platform] || c.platform}`, text: [String(c.text || "").slice(0, 200), ukWhen(c.commentedAt)].filter(Boolean).join(" · "), html: `<span class="outreach-pills">${commentPill(c)}</span>${c.postCaption ? `<small class="outreach-on">On: ${esc(firstLine(c.postCaption))}</small>` : ""}` });
    box.innerHTML = `${partTabs("social")}
      <p class="muted small">${esc(hint)}</p>
      <div class="sums outreach-glance">${glance.join("")}</div>
      <h3 class="h" id="outreach-sc-wait">Waiting for approval${wait.length ? ` · ${wait.length}` : ""}</h3>
      ${wait.length ? list(wait.map(pRow)) : '<p class="muted small outreach-none">Nothing waiting for approval.</p>'}
      ${hand.length ? `<h3 class="h">Post these by hand</h3>${list(hand.map(pRow))}` : ""}
      ${days.length ? `<h3 class="h">Coming up</h3>${days.map(([d, ps]) => `<p class="outreach-day">${esc(d)}</p>${list(ps.map(pRow))}`).join("")}` : ""}
      ${posted.length ? `<h3 class="h">Posted</h3>${list(posted.map(pRow))}` : ""}
      ${failed.length ? `<h3 class="h">Didn't post</h3>${list(failed.map(pRow))}` : ""}
      ${rejected.length ? `<h3 class="h">Rejected</h3>${list(rejected.map(pRow))}` : ""}
      <button type="button" class="btn wide" data-write>${icon("plus")} Write a post</button>
      <h3 class="h" id="outreach-sc-comments">Comments to answer${open.length ? ` · ${open.length}` : ""}</h3>
      ${open.length ? list(open.map(cRow)) : `<p class="muted small outreach-none">${!comments.length ? (connected.facebook || connected.instagram ? "No comments on the studio's posts yet. New ones come in every hour." : "Comments on the studio's posts show here once Meta is connected.") : "Nothing to answer."}</p>`}
      ${done.length ? `<h3 class="h">Dealt with</h3>${list(done.map(cRow))}` : ""}
      <div class="card"><p class="kicker">Ideas and trends</p><p class="small">Nova Agent looks at how recent posts did and what's trending for studios and artists right now, then suggests posts with captions and times. You can change the question before sending it.</p><a class="btn wide" href="#agent?say=${esc(encodeURIComponent(IDEAS_PROMPT))}">${icon("agent")} Ask Nova Agent</a></div>
      <div class="card"><p class="kicker">Paid ads</p><p class="small">Ads are set up, paid for and checked in Meta's Ads Manager. Nova never spends money or runs ads.</p><a class="btn wide" href="${esc(r.adsUrl || ADS_URL)}" target="_blank" rel="noopener">${icon("globe")} Open Ads Manager</a></div>`;
    box.querySelector("[data-write]").addEventListener("click", () => writePost(null, r));
    // (the question waits in Agent's box, never sent by itself: through NovaPhone.agentSay when the frame has it)
    box.querySelector("a[href^='#agent?say=']").addEventListener("click", (e) => { if (N.agentSay) { e.preventDefault(); N.agentSay(IDEAS_PROMPT); } });
    box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => document.getElementById(b.dataset.go)?.scrollIntoView({ block: "start" })));
    // (posting, Instagram getting a video ready, new comments: looked at again in a minute while it's open)
    later(60000);
  }
  const commentPill = (c) => (c.replyStatus === "pending_approval" ? pill("Reply waiting", "warn") : c.replyStatus === "sent" ? pill("Answered", "ok") : c.replyStatus === "failed" ? pill("Reply didn't post", "bad") : c.replyStatus === "rejected" && !c.handled ? pill("Reply rejected", "bad") : c.handled ? pill("Dealt with", "ok") : pill("New"));

  // A picture Instagram takes: a JPEG under 8 MB (others are redrawn as one, at most 2160 pixels)
  async function asJpeg(file) {
    if (file.type === "image/jpeg" && file.size <= IMAGE_MAX) return { blob: file, name: file.name };
    if (!window.createImageBitmap) throw new Error("That picture couldn't be read here: add it as a JPEG.");
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error("That picture couldn't be read."); });
    const scale = Math.min(1, 2160 / Math.max(bitmap.width, bitmap.height));
    const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("That picture couldn't be read.");
    return { blob, name: `${file.name.replace(/\.\w+$/, "")}.jpg` };
  }
  const dropFile = (m) => fetch(`/actions/social-media/${encodeURIComponent(m.id)}/remove`, { method: "POST", headers: { "X-Nova-Visualizer": "1" }, credentials: "same-origin" }).catch(() => {});

  // Writing a post (new, or changing one): the words with each platform's limits counted, where, the pictures and
  // videos (added straight away to the studio computer, and taken out again), and when
  function writePost(p, r) {
    const limits = { ...LIMITS, ...(r?.limits || {}) };
    const state = { platforms: p ? [...(p.platforms || [])] : ["facebook", "instagram"], media: p ? (p.media || []).map((m) => ({ ...m })) : [], uploading: [] };
    let saved = false;
    return sheetDo({
      title: p ? "Change the post" : "Write a post",
      ok: p ? "Save changes" : "Save for approval",
      html: `${field({ label: "The words", name: "caption", type: "textarea", rows: 6, value: p?.caption || "", placeholder: "A strong first line. Short lines. A few hashtags at the end (#novacane #foresthill).", attrs: `maxlength="${limits.facebookCaption}"` })}
        <p class="outreach-count" data-count aria-live="polite"></p>
        <fieldset class="field"><legend>Where</legend><div class="chips">${ALL.map((k) => `<label class="chip check-chip"><input type="checkbox" name="pl" value="${k}"${state.platforms.includes(k) ? " checked" : ""}>${NAMES[k]}</label>`).join("")}</div></fieldset>
        <div class="field"><span>Pictures and videos</span><div class="outreach-media" data-media></div>
          <label class="btn wide outreach-add">${icon("plus")} Add pictures or videos<input class="sr" type="file" name="files" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime" multiple></label>
          <small data-rules></small></div>
        ${field({ label: "Post at (UK time; empty: as soon as it's approved)", name: "postAt", type: "datetime-local", value: ukLocal(p?.postAt), attrs: `min="${nowLocal()}"` })}`,
      wire(f) {
        const said = f.querySelector("[data-said]");
        const count = f.querySelector("[data-count]"), mediaBox = f.querySelector("[data-media]"), rules = f.querySelector("[data-rules]");
        const words = f.elements.caption;
        const recount = () => {
          const n = words.value.length, tags = hashtags(words.value), parts = [];
          if (state.platforms.includes("instagram")) parts.push([`Instagram ${num(n)} / ${num(limits.instagramCaption)}`, n > limits.instagramCaption], [`${tags} / ${limits.instagramHashtags} hashtags`, tags > limits.instagramHashtags]);
          if (state.platforms.includes("facebook")) parts.push([`Facebook ${num(n)} characters`, false]);
          if (state.platforms.includes("youtube")) { const first = firstLine(words.value); parts.push([`YouTube title ${first.length} / ${limits.youtubeTitle} (the first line)`, first.length > limits.youtubeTitle], [`description ${num(n)} / ${num(limits.youtubeDescription)}`, n > limits.youtubeDescription]); }
          count.innerHTML = parts.map(([t, over]) => `<span${over ? ' class="bad"' : ""}>${esc(t)}</span>`).join("");
          rules.innerHTML = [`Up to ${limits.media}. Pictures become JPEGs (what Instagram takes). Videos: MP4 or MOV, up to 25 MB from here (bigger ones from the studio computer). They're kept on the studio computer, so it has to be on when the post goes out.`,
            !state.media.length && state.platforms.includes("instagram") ? "Instagram needs at least one before it can be approved." : "",
            state.platforms.includes("youtube") ? "YouTube takes one video on its own (no pictures). Google keeps new uploads private until YouTube has checked the studio's Google project: make each one public in YouTube Studio until then." : ""].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
        };
        const drawMedia = () => {
          mediaBox.innerHTML = state.media.map((m, i) => `<div class="outreach-media-one">${thumb(m)}<button type="button" class="btn quiet outreach-x" data-x="${i}" aria-label="Take ${esc(m.name || "it")} out of this post">${icon("trash")} Take it out</button></div>`).join("") + state.uploading.map((u) => `<p class="outreach-adding small muted">${esc(u)}</p>`).join("");
          mediaBox.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", () => {
            const [m] = state.media.splice(Number(b.dataset.x), 1);
            // (a file only this post had goes from the studio computer too)
            if (m && m.fresh) dropFile(m);
            drawMedia();
          }));
          recount();
        };
        words.addEventListener("input", recount);
        f.querySelectorAll("[name=pl]").forEach((c) => c.addEventListener("change", () => { state.platforms = ALL.filter((x) => f.querySelector(`[name=pl][value=${x}]`).checked); recount(); }));
        const pick = f.elements.files;
        pick.addEventListener("change", async () => {
          const files = [...pick.files];
          pick.value = "";
          said.textContent = "";
          for (const file of files) {
            if (state.media.length + state.uploading.length >= limits.media) { said.textContent = `At most ${limits.media} pictures and videos in one post.`; break; }
            const video = /^video\//.test(file.type);
            if (!video && !/^image\//.test(file.type)) { said.textContent = `${file.name} isn't a picture or video.`; continue; }
            if (video && !/^video\/(mp4|quicktime)$/.test(file.type)) { said.textContent = `${file.name}: videos need to be MP4 or MOV.`; continue; }
            if (video && file.size > ONLINE_MAX) { said.textContent = `${file.name} is ${Math.round(file.size / 1e6)} MB: from here videos can be up to 25 MB. Add it from the studio computer instead.`; continue; }
            const label = `Adding ${file.name}…`;
            state.uploading.push(label);
            drawMedia();
            try {
              const { blob, name } = video ? { blob: file, name: file.name } : await asJpeg(file);
              const res = await fetch(`/actions/social-media?name=${encodeURIComponent(name)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type || file.type, "X-Nova-Visualizer": "1" }, body: blob });
              const got = await res.json().catch(() => ({}));
              if (!res.ok || !got.media) throw new Error(got.pcOffline || res.status === 503 ? "The studio computer is off or offline, so pictures and videos can't be added right now." : got.message || got.error || `It couldn't be added (${res.status}).`);
              if (!f.isConnected) { dropFile(got.media); continue; }
              state.media.push({ ...got.media, fresh: true });
            } catch (err) { said.textContent = `${file.name}: ${err.message}`; }
            finally { state.uploading.splice(state.uploading.indexOf(label), 1); if (f.isConnected) drawMedia(); }
          }
        });
        drawMedia();
      },
      async run(x) {
        if (state.uploading.length) oops("Wait for the files to finish adding.");
        if (!state.platforms.length) oops("Pick Facebook, Instagram and/or YouTube.");
        const body = { caption: x.caption.value.trim(), platforms: state.platforms, media: state.media.map((m) => ({ id: m.id, ext: m.ext, name: m.name, size: m.size })), postAt: readWhen(x.postAt.value) };
        const out = await post(p ? `${A}social/${p.id}/edit` : `${A}social`, body);
        saved = true;
        toast(p ? "Saved. It waits for an admin's approval again." : "Saved. It waits for an admin's approval.");
        const id = (out.post || p || {}).id;
        go(id ? `#outreach/social/${id}` : "#outreach/social");
      },
      // (shut without saving: files added only for it go again)
      cancelled: () => { if (!saved) for (const m of state.media) if (m.fresh) dropFile(m); },
    });
  }

  async function drawPost(box, id, ui) {
    ui.back("#outreach/social");
    ui.title("Post");
    const [r, one] = await Promise.all([social(), api(`${A}social/${encodeURIComponent(id)}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)))]);
    if (r.off) { box.innerHTML = empty({ icon: "share", title: SOCIAL_OFF }); return; }
    const p = one?.post || (r.posts || []).find((x) => String(x.id) === String(id));
    if (!p) { box.innerHTML = `${empty({ icon: "share", title: "That post isn't there" })}<a class="btn wide" href="#outreach/social">All the posts</a>`; return; }
    const can = !!r.canDecide, connected = r.connected || {}, waiting = sWaiting(p), media = p.media || [], targets = p.targets || {};
    const editable = waiting || ["rejected", "failed", "scheduled", "manual"].includes(p.status);
    // Where it went (or is going): each platform, by itself or by hand, with its link
    const where = (p.platforms || []).map((pl) => {
      const t = targets[pl];
      if (!t || !t.state) return "";
      const words = t.state === "posted" ? `${t.mode === "manual" ? "Posted by hand" : "Posted"}${t.postedAt ? ` · ${ukWhen(t.postedAt)}` : ""}` : t.state === "failed" ? `Didn't post${t.error ? `: ${t.error}` : ""}` : t.mode === "manual" ? "Waiting for someone to post it by hand" : t.state === "preparing" ? "Instagram is getting it ready" : t.state === "uploading" ? "Uploading to YouTube" : "Waiting";
      return `<li><div class="row"><span class="row-lead">${icon(t.state === "posted" ? "check" : t.state === "failed" ? "refresh" : "clock")}</span><span class="row-main"><b>${esc(NAMES[pl] || pl)}</b><span${t.state === "failed" ? ' class="bad"' : ""}>${esc(words)}</span></span><span class="row-end">${t.url ? `<a class="btn outreach-small-btn" href="${esc(t.url)}" target="_blank" rel="noopener">Open it</a>` : ""}</span></div></li>`;
    }).join("");
    // How it did, per platform
    const st = p.stats || null;
    const results = st ? `<div class="card"><p class="kicker">How it did</p>${ALL.filter((pl) => st[pl]).map((pl) => { const s = st[pl]; const tiles = [[s.reach, "Reached"], [s.views, "Views"], [s.likes, "Likes"], [s.comments, "Comments"], [s.shares, "Shares"], [s.saved, "Saves"], [s.clicks, "Clicks"]].filter(([v]) => v !== undefined && v !== null); return tiles.length ? `<p class="outreach-sub">${NAMES[pl]}</p><div class="sums outreach-sums">${tiles.map(([v, l]) => `<div class="sum"><b>${num(v)}</b><span>${l}</span></div>`).join("")}</div>` : ""; }).join("")}<p class="muted small">${st.fetchedAt ? `As of ${esc(ukWhen(st.fetchedAt))}. Updated every hour for 30 days.` : "Results come within the hour."}</p></div>` : "";
    // Meta isn't connected for it: the words to copy, the files to download, and "I posted it"
    const left = (p.platforms || []).filter((pl) => (targets[pl] || {}).mode === "manual" && (targets[pl] || {}).state !== "posted");
    const byHand = p.status === "manual" ? `<div class="card"><p class="kicker">Post it by hand</p><p class="small">Approved. Post it on ${esc(names(left))} yourself (Meta isn't connected to Nova for ${left.length > 1 ? "them" : "it"} yet), then say so here.</p>
        <div class="btns">${p.caption ? `<button type="button" class="btn wide" data-p="copy">Copy the words</button>` : ""}${media.map((m, i) => `<a class="btn wide" href="${esc(/^(data|blob):/.test(m.url) ? m.url : `${m.url}?download`)}" download="${esc(m.name || "")}">Download ${media.length > 1 ? `${m.kind === "video" ? "video" : "picture"} ${i + 1}` : m.kind === "video" ? "the video" : "the picture"}</a>`).join("")}</div>
        ${left.map((pl) => `<form class="form outreach-posted" data-posted="${pl}">${field({ label: `${NAMES[pl]} post's link (optional)`, name: "url", type: "url", placeholder: "https://…" })}<button class="btn main wide" type="submit">${icon("check")} I posted it on ${NAMES[pl]}</button></form>`).join("")}</div>` : "";
    const auto = (p.platforms || []).filter((x) => connected[x]), hand = (p.platforms || []).filter((x) => !connected[x]);
    box.innerHTML = `<div class="card"><p class="kicker">${sPill(p)}</p>
        <p class="muted small">Written by ${esc(WRITERS[p.createdBy] || "someone in the team")}${p.createdAt ? ` · ${esc(ukWhen(p.createdAt))}` : ""}</p>
        <div class="outreach-pills">${(p.platforms || []).map((pl) => pill(NAMES[pl] || pl)).join("")}</div>
        ${media.length ? `<div class="outreach-media">${media.map(thumb).join("")}</div>` : ""}
        ${p.caption ? `<p class="pre">${esc(p.caption)}</p>` : ""}
        ${facts([
          p.status === "posted" ? ["Posted", ukWhen(p.postedAt)] : !["failed", "rejected", "manual"].includes(p.status) ? [p.status === "scheduled" ? "Posts" : "Post time", p.postAt ? `${ukWhen(p.postAt)} (UK time)` : "As soon as it's approved"] : ["", ""],
          [p.status === "rejected" ? "Rejected by" : "Approved by", p.decidedByName && !waiting ? `${p.decidedByName}${p.decidedAt ? ` · ${ukWhen(p.decidedAt)}` : ""}` : ""],
          ["Note", p.note],
        ])}
        ${p.status === "failed" ? `<p class="bad small">Didn't post: ${esc(String(p.error || "unknown reason").replace(/\.$/, ""))}.</p>` : ""}
        ${p.status === "posting" ? '<p class="small">Approved · going out through Meta… (the studio computer needs to stay on until it\'s done)</p>' : ""}
        ${p.status === "scheduled" ? '<p class="muted small">The studio computer needs to be on at that time: the pictures and videos are on it.</p>' : ""}</div>
      ${where ? `<h3 class="h">Where it goes</h3><ul class="list">${where}</ul>` : ""}
      ${byHand}
      ${results}
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-p="approve">${icon("check")} Approve</button><button type="button" class="btn danger" data-p="reject">Reject</button></div>` : ""}
      ${editable ? `<button type="button" class="btn wide" data-p="edit">${icon("edit")} Change it</button>` : ""}
      ${waiting && !can ? '<p class="muted small">An admin approves these. Nothing is posted until then.</p>' : ""}
      ${problemSlot}
      ${(one?.log || []).length ? det(`s-log-${p.id}`, "History", logList(one.log, S_EVENTS)) : ""}`;
    keep(box);
    wireActs(box, "data-p", {
      edit: () => (writePost(p, r), false),
      copy: () => (copyText(p.caption || "", "Copied"), false),
      async approve(b) {
        const byHandToo = hand.length ? ` (${names(hand)} by hand)` : "";
        const title = p.postAt ? `Schedule it for ${ukWhen(p.postAt)}${byHandToo}?` : auto.length ? `Post it on ${names(auto)} now${byHandToo}?` : "Approve it to post by hand?";
        if (!(await confirm({ title, text: auto.length ? "It goes on the studio's pages." : "It waits here for someone to post it.", ok: "Approve" }))) return false;
        const got = await tag("Not approved: ", busy(b, "Approving…", () => post(`${A}social/${p.id}/approve`, {})));
        toast(got.post && got.post.status === "failed" ? "It didn't post: the post says why." : "Approved", got.post && got.post.status === "failed");
      },
      async reject() {
        const ok = await sheetDo({ title: "Reject the post", ok: "Reject it", working: "Rejecting…", html: whyField(), run: (x) => post(`${A}social/${p.id}/reject`, { note: x.note.value.trim() || undefined }) });
        if (!ok) return false;
        toast("Rejected: nothing was posted");
      },
    });
    box.querySelectorAll("[data-posted]").forEach((f) => f.addEventListener("submit", async (e) => {
      e.preventDefault();
      problem(box, "");
      try {
        await busy(f.querySelector("[type=submit]"), "Saving…", () => post(`${A}social/${p.id}/posted`, { platform: f.dataset.posted, url: f.elements.url.value.trim() }));
        f.classList.remove("dirty");
        toast(`Marked as posted on ${NAMES[f.dataset.posted]}`);
        N.show();
      } catch (err) { toast(err.message, true); problem(box, err.message); }
    }));
    if (["approved", "posting"].includes(p.status) || Object.values(targets).some((t) => ["preparing", "uploading"].includes(t.state))) later(30000);
  }

  async function drawComment(box, id, ui) {
    ui.back("#outreach/social");
    ui.title("Comment");
    const r = await social();
    if (r.off) { box.innerHTML = empty({ icon: "share", title: SOCIAL_OFF }); return; }
    const c = (r.comments || []).find((x) => String(x.id) === String(id));
    if (!c) { box.innerHTML = `${empty({ icon: "chat", title: "That comment isn't there" })}<a class="btn wide" href="#outreach/social">Social</a>`; return; }
    const can = !!r.canDecide, connected = r.connected || {};
    const canReply = c.replyStatus !== "sent" && c.replyStatus !== "approved";
    box.innerHTML = `<div class="card"><p class="kicker">${esc(c.author || "Someone")} on ${esc(NAMES[c.platform] || c.platform)} · ${esc(ukWhen(c.commentedAt))}</p><div class="outreach-pills">${commentPill(c)}</div><p class="pre">${esc(c.text || "")}</p>${c.postCaption ? `<p class="muted small">On: ${esc(firstLine(c.postCaption))}</p>` : ""}</div>
      ${c.reply && c.replyStatus !== "sent" ? `<div class="card"><p class="kicker">${c.replyStatus === "pending_approval" ? "The reply, waiting for approval" : c.replyStatus === "approved" ? "The reply, being posted" : "The reply"}</p><p class="pre">${esc(c.reply)}</p>${c.replyStatus === "failed" && c.replyError ? `<p class="bad small">${esc(c.replyError)}</p>` : ""}${c.replyStatus === "rejected" && c.note ? `<p class="small">Reply rejected: ${esc(c.note)}</p>` : ""}</div>` : ""}
      ${c.replyStatus === "sent" ? `<div class="card"><p class="kicker">Answered${c.replySentAt ? ` · ${esc(ukWhen(c.replySentAt))}` : ""}</p><p class="pre">${esc(c.reply || "")}</p></div>` : ""}
      ${c.replyStatus === "pending_approval" && can ? `<div class="btns two"><button type="button" class="btn main" data-cm="approve">${icon("check")} ${connected[c.platform] ? "Approve the reply" : "Approve (post it by hand)"}</button><button type="button" class="btn danger" data-cm="reject">Reject</button></div>` : ""}
      ${c.replyStatus === "pending_approval" && !can ? '<p class="muted small">An admin approves the reply before it\'s posted.</p>' : ""}
      ${canReply ? `<form class="form" data-reply>${field({ label: c.replyStatus === "pending_approval" ? "A new reply (instead of the one waiting)" : "Your reply", name: "text", type: "textarea", rows: 4, placeholder: "Write a reply (it's posted after an admin approves it)", attrs: 'maxlength="1000"' })}<button class="btn main wide" type="submit">${c.replyStatus === "pending_approval" ? "Save the new reply" : "Save reply for approval"}</button></form>` : ""}
      <button type="button" class="btn wide" data-cm="handled">${icon(c.handled ? "refresh" : "check")} ${c.handled ? "Not dealt with" : "Dealt with"}</button>
      ${problemSlot}`;
    wireActs(box, "data-cm", {
      async approve(b) { await busy(b, "Approving…", () => post(`${A}social/comments/${c.id}/approve`, {})); toast("Reply approved"); },
      async reject() {
        const ok = await sheetDo({ title: "Reject the reply", ok: "Reject the reply", working: "Rejecting…", html: whyField(), run: (x) => post(`${A}social/comments/${c.id}/reject`, { note: x.note.value.trim() || undefined }) });
        if (!ok) return false;
        toast("Reply rejected");
      },
      async handled(b) { await busy(b, "Saving…", () => post(`${A}social/comments/${c.id}/handled`, { handled: !c.handled })); toast(c.handled ? "Back to answer" : "Dealt with"); },
    });
    const f = box.querySelector("[data-reply]");
    f?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = f.elements.text.value.trim();
      if (!text) return problem(box, "Write the reply first.");
      try { await busy(f.querySelector("[type=submit]"), "Saving…", () => post(`${A}social/comments/${c.id}/reply`, { text })); f.classList.remove("dirty"); toast("Saved: it waits for an admin's approval"); N.show(); } catch (err) { toast(err.message, true); problem(box, err.message); }
    });
  }

  // ===================================================================================================
  // ---- Funnel ----
  const F_STATUS = { pending: ["Pending", "warn"], warming: ["Warming", ""], sent: ["Sent", ""], replied: ["Replied", "ok"], bounced: ["Bounced", "bad"] };
  const STOPPED = { bounced: ["Bounced", "bad"], opted_out: ["Opted out", "bad"], rejected: ["Rejected", "bad"] };
  const F_STEPS = { write: "To write", approve: "To approve", blocked: "Can't email" };
  const FILTERS = [["approve", "To approve"], ["write", "To write"], ["blocked", "Can't email"], ["warming", "Warming"], ["sent", "Sent"], ["replied", "Replied"], ["bounced", "Bounced"], ["all", "Everyone"]];
  const F_EVENTS = { added: "Added", read: "Read", written: "Written", edited: "Changed", approved: "Approved", held: "Held", sent: "Sent", bounced: "Bounced", opted_out: "Opted out", rejected: "Rejected", replied: "Replied", failed: "Problem" };
  const METRICS = { deliverability: "Deliverability", open: "Open appeal", reply: "Reply incentive" };
  const PAGE = 40;
  const EMPTY = {
    approve: (ps) => (ps.some((p) => p.step === "write") ? "Nothing to approve yet: press Write drafts." : "Nothing to approve. Add prospects to start."),
    write: () => "Everyone who can be emailed has an email written.", blocked: () => "Nobody on the list is blocked.", warming: () => "Nobody in the warm-up queue. Approve some to fill it.",
    sent: () => "Nobody waiting on a reply.", replied: () => "No replies yet.", bounced: () => "Nothing bounced or stopped.", all: () => "The list is empty. Add prospects (a CSV) to start.",
  };
  const FUNNEL_OFF = "The funnel isn't switched on yet: Nova Bot needs its update.";
  let filter = null, shown = PAGE, importNote = null, writing = false;
  const fPill = (p) => pill(...(p.status === "bounced" ? STOPPED[p.stopReason] || F_STATUS.bounced : p.status === "pending" ? [F_STEPS[p.step] || "Pending", "warn"] : p.status === "warming" && p.sending ? ["Sending", ""] : F_STATUS[p.status] || [p.status]));
  const matches = (p, f) => f === "all" || p.status === f || (p.status === "pending" && p.step === f);
  const mins = (s) => (s % 60 ? `${Math.round(s / 6) / 10} min` : `${s / 60} min`);
  const limitFor = (s, day) => Math.min(s.cap, s.rampStart + s.rampStep * Math.floor((Math.max(1, day) - 1) / s.rampEvery));
  const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: UK });
  const funnel = () => api(`${A}funnel`).catch((e) => (e.status === 404 ? { off: true } : Promise.reject(e)));
  const draftWords = (out) => out.message || `Wrote ${out.written}${out.failed ? ` · ${out.failed} didn't come back${out.problem ? ` (${out.problem})` : ""}` : ""}${out.left ? ` · ${out.left} still to write` : ""}`;
  const approveWords = (out, paused) => `${out.approved} in the warm-up queue${(out.refused || []).length ? ` · ${out.refused.length} not: ${out.refused[0].why}` : ""}${paused ? " · sending is paused" : ""}`;

  async function drawFunnel(box, ui) {
    const r = await funnel();
    if (r.off) { box.innerHTML = `${partTabs("funnel")}${empty({ icon: "globe", title: FUNNEL_OFF })}`; return; }
    const ps = r.prospects || [], c = r.counts || {}, s = r.settings || {}, t = r.today || {}, ready = r.ready || {}, can = !!r.canDecide;
    ui.action({ icon: "plus", label: "Add prospects", run: () => addProspects() });
    // The first time: start on whatever needs doing
    if (!filter) { const n = (f) => ps.filter((p) => p.step === f || p.status === f).length; filter = n("approve") && can ? "approve" : n("write") ? "write" : n("warming") ? "warming" : ps.length ? "all" : "approve"; }
    const toWrite = ps.filter((p) => p.step === "write").length;
    const ready2 = ps.filter((p) => p.step === "approve");
    const all = ps.filter((p) => matches(p, filter));
    // Sending or paused, and anything that stops it working
    const lines = [];
    if (s.paused) lines.push(["off", `Sending is paused${s.pausedWhy ? `: ${s.pausedWhy.replace(/\.$/, "")}` : ""}.`]);
    else lines.push(["on", `Sending: ${t.inHours ? "within today's sending hours" : `waiting for the sending hours (${String(s.fromHour).padStart(2, "0")}:00 to ${String(s.toHour).padStart(2, "0")}:00 UK${s.weekdaysOnly ? ", Monday to Friday" : ""})`}.`]);
    if (!ready.gmail) lines.push(["bad", "The studio's Gmail isn't connected for sending: Portal → Admin → Google, with \"Send approved emails from Gmail\" on. The funnel only sends from Gmail."]);
    else lines.push(["muted", `From ${ready.account}${ready.replies ? ". Replies and bounces are read from its threads every 10 minutes." : ". Replies aren't being read: switch on \"Customers' replies into Enquiries\" in Portal → Admin → Google."}`]);
    if (!ready.claude) lines.push(["muted", "Claude isn't connected here, so drafts come from the studio's templates (roles from keywords)."]);
    // At a glance: each tile shows its list
    const tile = (label, value, note, f) => `<button type="button" class="sum outreach-sum" data-filter="${f}" aria-pressed="${filter === f}"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></button>`;
    const count = (f) => (f === "all" ? ps.length : ps.filter((p) => matches(p, f)).length);
    box.innerHTML = `${partTabs("funnel")}
      <p class="muted small">First emails to artists, producers, engineers, managers, labels and podcasters, sent slowly from the studio's Gmail. Nothing goes until an admin approves it, and anyone can pause it.</p>
      ${importNote && Date.now() - importNote.at < 60000 ? `<div class="card"><p class="kicker">Added</p><p class="small">${esc(importNote.text)}</p></div>` : ""}
      <div class="card outreach-status" aria-live="polite">${lines.map(([cls, text]) => `<p class="outreach-line ${cls}">${esc(text)}</p>`).join("")}</div>
      <div class="btns two outreach-fbtns">
        <button type="button" class="btn" data-fn="import">${icon("plus")} Add prospects</button>
        <button type="button" class="btn" data-fn="draft"${writing ? " disabled" : ""}>${icon("edit")} ${writing ? "Writing…" : toWrite > 5 ? "Write next 5" : "Write drafts"}</button>
        ${s.paused && !can ? "" : `<button type="button" class="btn${s.paused ? " main" : ""}" data-fn="run">${icon(s.paused ? "play" : "clock")} ${s.paused ? "Start sending" : "Pause sending"}</button>`}
        <button type="button" class="btn" data-fn="export">${icon("pdf")} Export CSV</button>
        <a class="btn" href="#outreach/funnel/settings">${icon("cog")} Settings</a>
      </div>
      <div class="sums outreach-glance">
        ${tile("Pending", num(c.pending), c.written ? `${num(c.written)} written` : "on the list", c.written ? "approve" : "write")}
        ${tile("Warming", num(c.warming), "in the queue", "warming")}
        ${tile("Sent", num(c.sent), "no reply yet", "sent")}
        ${tile("Bounced", num(c.bounced), c.optedOut ? `or rejected · ${num(c.optedOut)} said no` : "or rejected", "bounced")}
        ${tile("Replied", num(c.replied), "sequence stopped", "replied")}
        ${tile("Reply rate", c.replyRate === null || c.replyRate === undefined ? "–" : `${c.replyRate}%`, "of everyone emailed", "replied")}
      </div>
      ${warmup(r)}
      <div class="chips" role="group" aria-label="Show">${FILTERS.map(([f, l]) => `<button type="button" class="chip" data-filter="${f}" aria-pressed="${filter === f}">${l} <span class="n">${count(f)}</span></button>`).join("")}</div>
      ${can && filter === "approve" && ready2.length ? `<button type="button" class="btn main wide" data-fn="approveall">${icon("check")} Approve all ${ready2.length}</button>` : ""}
      ${filter === "approve" && ready2.length && !can ? '<p class="muted small">An admin approves these. Nothing is sent until then.</p>' : ""}
      ${all.length ? list(all.slice(0, shown).map((p) => row({ href: `#outreach/funnel/${p.id}`, icon: "user", title: p.name || p.email, text: [[p.company, p.roleName].filter(Boolean).join(" · ") || "Company or project not given", ukWhen(p.sentAt || p.queuedAt || p.draftedAt || p.createdAt)].filter(Boolean).join(" · "), html: `<span class="outreach-pills">${fPill(p)}</span>` }))) : empty({ icon: "globe", title: EMPTY[filter](ps) })}
      ${all.length > shown ? `<button type="button" class="btn wide" data-fn="more">Show ${Math.min(PAGE, all.length - shown)} more</button>` : ""}
      ${problemSlot}`;
    sizes(box);
    keep(box);
    box.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; shown = PAGE; N.show(); }));
    wireActs(box, "data-fn", {
      import: () => (addProspects(), false),
      more: () => { shown += PAGE; },
      async draft(b) {
        if (writing) return false;
        writing = true;
        try {
          const out = await busy(b, "Writing…", () => post(`${A}funnel/draft`, {}));
          toast(draftWords(out));
          if (out.written) { filter = "approve"; shown = PAGE; }
        } finally { writing = false; }
      },
      async run(b) {
        const start = s.paused;
        if (start && !(await confirm({ title: "Start sending?", text: "The warm-up sends the approved queue from the studio's Gmail, a few minutes apart, within the sending hours.", ok: "Start sending" }))) return false;
        await busy(b, start ? "Starting…" : "Pausing…", () => post(`${A}funnel/pause`, { paused: !start }));
        toast(start ? "Sending started: the warm-up sends the queue a few minutes apart." : "Sending paused.");
      },
      async export(b) {
        await busy(b, "Getting it…", async () => {
          const res = await fetch(`${A}funnel/export.csv`, { credentials: "same-origin" });
          if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Sign in first"), { signIn: true });
          if (!res.ok) throw new Error(`It didn't come (${res.status})`);
          let blob = await res.blob();
          // (the preview answers in JSON: its words are the file)
          if (/json/.test(res.headers.get("content-type") || "")) { const v = JSON.parse(await blob.text()); blob = new Blob([typeof v === "string" ? v : JSON.stringify(v)], { type: "text/csv" }); }
          saveFile(blob, `prospects-${N.today()}.csv`);
        });
        toast("Saved the prospects as a CSV");
        return false;
      },
      async approveall(b) {
        if (!(await confirm({ title: `Queue all ${ready2.length}?`, text: "They go into the warm-up queue and out a few a day from the studio's Gmail, as the warm-up allows.", ok: "Approve all" }))) return false;
        const out = await tag("Not approved: ", busy(b, "Approving…", () => post(`${A}funnel/approve`, { items: ready2.map((p) => ({ id: p.id, updatedAt: p.updatedAt })) })));
        toast(approveWords(out, s.paused), (out.refused || []).length > 0);
      },
    });
    // (the sender, replies and bounces change things by themselves: looked at again in a minute while it's open)
    later(60000);
  }

  // The warm-up: today's numbers, then the last sending days and the next few (each day's limit marked)
  function warmup(r) {
    const s = r.settings || {}, t = r.today || {};
    if (!t.day || !s.cap) return "";
    const days = (t.days || []).slice();
    const todayDay = new Date().toLocaleDateString("en-CA", { timeZone: UK });
    const at = days.findIndex((d) => d.day === todayDay);
    const before = at >= 0 ? at : days.length;
    const bars = days.map((d, i) => ({ label: shortDay(d.day), sent: d.sent, limit: limitFor(s, t.day - (before - i)), today: d.day === todayDay }));
    if (at < 0) bars.push({ label: "Today", sent: 0, limit: t.limit, today: true });
    for (let i = 1; bars.length < 20 && i <= 6; i++) bars.push({ label: `Day ${t.day + i}`, sent: null, limit: limitFor(s, t.day + i), future: true });
    const top = Math.max(s.cap, ...bars.map((b) => b.sent || 0)) || 1;
    const words = (b) => (b.future ? `${b.label}: up to ${b.limit}` : `${b.label}: ${b.sent} sent (limit ${b.limit})`);
    return `<div class="card"><p class="kicker">The warm-up</p><h2 class="card-title">Warm-up day ${t.day}</h2>
      ${facts([["Today", `${t.sent} of ${t.limit} sent`], ["Next email", s.paused ? "Paused" : t.nextAt ? `After ${ukTime(t.nextAt)}` : (r.counts || {}).warming ? "Within a minute or two" : "Nothing in the queue"], ["Gaps", `${mins(s.gapMin)} to ${mins(s.gapMax)}, random`], ["Steps", `${s.rampStart} a day, +${s.rampStep} every ${s.rampEvery} sending days, up to ${s.cap}`]])}
      <div class="outreach-bars" role="img" aria-label="${esc(`Emails sent per sending day, with each day's limit: ${bars.map(words).join("; ")}`)}">${bars.map((b) => `<span class="outreach-bar${b.today ? " today" : ""}${b.future ? " future" : ""}"><i class="outreach-fill" data-h="${Math.round(((b.sent || 0) / top) * 100)}"></i><i class="outreach-cap" data-at="${Math.round((b.limit / top) * 100)}"></i></span>`).join("")}</div>
      <p class="muted small">Bars: sent each sending day · line: that day's limit · dashed: the days coming up</p>
      ${det("f-days", "Each day", `<ul class="outreach-days">${bars.map((b) => `<li${b.today ? ' class="today"' : ""}>${esc(words(b))}</li>`).join("")}</ul>`)}</div>`;
  }

  // Add prospects: a CSV file, or the rows pasted
  function addProspects() {
    return sheetDo({
      title: "Add prospects",
      ok: "Add them",
      working: "Adding…",
      html: `<p class="small">A CSV with the headings Name, Company/Project, Bio/Notes and Email (Role, Status, Last_Sent and Message_Id are read too, so people an old sheet says were emailed or replied are never emailed again). Each address goes on once. Personal mailboxes (Gmail, iCloud…) stay on the list but can't be emailed this way: under UK law they have to opt in first.</p>
        <label class="field"><span>CSV file</span><input class="input outreach-file" type="file" name="file" accept=".csv,text/csv,text/plain"></label>
        ${field({ label: "Or paste the rows (with the heading row)", name: "paste", type: "textarea", rows: 4, placeholder: "Name,Company/Project,Bio/Notes,Email", attrs: 'maxlength="1000000"' })}
        <button type="button" class="btn wide" data-sample>${icon("pdf")} Sample file</button>`,
      wire(f) {
        f.querySelector("[data-sample]").addEventListener("click", () => {
          saveFile(new Blob(["Name,Company/Project,Bio/Notes,Email\r\nSam Example,Example Records,\"A&R at an indie label, looking for new rock acts\",sam@example-records.co.uk\r\n"], { type: "text/csv" }), "prospects-sample.csv");
          toast("Saved prospects-sample.csv");
        });
      },
      async run(x) {
        const file = x.file.files[0], pasted = x.paste.value.trim();
        if (!file && !pasted) oops("Choose a CSV file, or paste the rows.");
        const out = await post(`${A}funnel/import`, { csv: file ? await file.text() : pasted });
        const bits = [`Added ${num(out.added)}`];
        if (out.duplicates) bits.push(`${num(out.duplicates)} already on the list`);
        if (out.invalid) bits.push(`${num(out.invalid)} without a good address`);
        if (out.optedOut) bits.push(`${num(out.optedOut)} said no before (kept as Opted out)`);
        if (out.already) bits.push(`${num(out.already)} already emailed or replied (kept that way)`);
        if (out.more) bits.push(`${num(out.more)} more than 2,000 left out: add them in a second file`);
        importNote = { text: `${bits.join(" · ")}.`, at: Date.now() };
        toast(bits[0]);
        filter = "write";
        shown = PAGE;
        go("#outreach/funnel");
      },
    });
  }

  async function drawProspect(box, id, ui) {
    ui.back("#outreach/funnel");
    const [d, r] = await Promise.all([api(`${A}funnel/${encodeURIComponent(id)}`).catch((e) => (e.status === 404 ? null : Promise.reject(e))), funnel()]);
    const p = d?.prospect;
    if (!p) { ui.title("Prospect"); box.innerHTML = `${empty({ icon: "user", title: "That person isn't on the list" })}<a class="btn wide" href="#outreach/funnel">The funnel</a>`; return; }
    ui.title(p.name || "Prospect");
    const can = !!r.canDecide, pass = r.pass || 7, ready = r.ready || {}, roles = r.roles || {}, live = p.status === "pending" || p.status === "warming";
    const tips = p.scores && p.scores.tips ? p.scores.tips.filter((t) => p.scores[t.metric] < pass) : [];
    const b = (k, words, cls = "") => `<button type="button" class="btn${cls ? ` ${cls}` : ""}" data-pp="${k}">${words}</button>`;
    // Only the buttons that apply to where they are
    const buttons = [
      p.step === "approve" && can ? b("approve", `${icon("check")} Approve`, "main") : "",
      live ? b("edit", `${icon("edit")} Change`) : "",
      p.status === "pending" && p.step !== "blocked" ? b("draft", `${icon("edit")} ${p.subject ? "Rewrite" : "Write it"}`) : "",
      p.status === "warming" ? b("hold", `${icon("clock")} Hold`) : "",
      p.status === "sent" || p.status === "warming" ? b("replied", `${icon("chat")} They replied`) : "",
      p.threadId && ready.account ? `<a class="btn" href="https://mail.google.com/mail/?authuser=${esc(encodeURIComponent(ready.account))}#all/${esc(encodeURIComponent(p.threadId))}" target="_blank" rel="noopener">${icon("mail")} Open in Gmail</a>` : "",
      live || p.status === "sent" ? b("said-no", "Said no", "danger") : "",
      live ? b("reject", "Reject", "danger") : "",
      p.status === "pending" && !p.sentAt ? b("remove", `${icon("trash")} Remove`, "danger") : "",
    ].filter(Boolean);
    box.innerHTML = `<div class="card"><p class="kicker">${fPill(p)}</p><h2 class="card-title">${esc(p.name || p.email)}</h2>
        <p class="muted small">${esc([p.company, p.roleName].filter(Boolean).join(" · ") || "Company or project not given")}</p>
        ${facts([["Email", p.email], ["Role", p.roleName ? `${p.roleName}${p.roleWhy ? ` (${p.roleWhy.replace(/\.$/, "")})` : ""}` : ""], ["In the queue", p.approvedAt && p.status === "warming" ? `Since ${ukWhen(p.queuedAt)}` : ""], ["Sent", ukWhen(p.sentAt)], ["Replied", ukWhen(p.repliedAt)], ["Message ID", p.messageId], ["Bio and notes", p.bio]])}
        ${p.why ? `<p class="bad small">${esc(p.why)}</p>` : ""}${p.error ? `<p class="bad small">${esc(p.error)}</p>` : ""}</div>
      ${p.scores ? `<div class="card"><p class="kicker">The coach's scores</p>${Object.entries(METRICS).map(([k, l]) => { const v = Number(p.scores[k]) || 0; return `<div class="meter${v < pass ? " outreach-low" : ""}"><div class="meter-top"><span>${l}</span><b>${v}/10</b></div><span class="outreach-track"><span class="bar" data-w="${v * 10}"></span></span></div>`; }).join("")}
        ${tips.length && live ? `<ul class="outreach-tips">${tips.map((t) => `<li>${esc(`${METRICS[t.metric] || t.metric}: ${t.tip}`)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      ${(p.swaps || []).length ? `<p class="small">Risky words rewritten: ${esc(p.swaps.map((s) => `${s.from} → ${s.to}`).join(", "))}</p>` : ""}
      ${p.subject ? `<div class="card"><p class="kicker">The email, as it goes</p><p class="outreach-subject">Subject: ${esc(p.subject)}</p><p class="pre outreach-plain">${esc(d.email || p.body || "")}</p></div>` : ""}
      ${buttons.length ? `<div class="btns two">${buttons.join("")}</div>` : ""}
      ${p.step === "approve" && !can ? '<p class="muted small">An admin approves these. Nothing is sent until then.</p>' : ""}
      ${problemSlot}
      ${(d.log || []).length ? det(`f-log-${p.id}`, "History", logList(d.log, F_EVENTS)) : ""}`;
    sizes(box);
    keep(box);
    const sure = (title, ok, text = "") => confirm({ title, text, ok, danger: true });
    wireActs(box, "data-pp", {
      async approve(btn) {
        if (!(await confirm({ title: "Queue it?", text: "It goes into the warm-up queue and out from the studio's Gmail as the warm-up allows.", ok: "Approve" }))) return false;
        const out = await tag("Not approved: ", busy(btn, "Approving…", () => post(`${A}funnel/approve`, { items: [{ id: p.id, updatedAt: p.updatedAt }] })));
        toast(approveWords(out, r.settings?.paused), (out.refused || []).length > 0);
      },
      async draft(btn) { const out = await busy(btn, "Writing…", () => post(`${A}funnel/draft`, { ids: [p.id] })); toast(draftWords(out)); },
      async hold(btn) { await busy(btn, "Holding…", () => post(`${A}funnel/${p.id}/hold`, {})); toast("Out of the queue: it waits for approval again."); },
      async replied(btn) { if (!(await confirm({ title: "They replied?", text: "Nothing more goes to them by itself.", ok: "They replied" }))) return false; await busy(btn, "Saving…", () => post(`${A}funnel/${p.id}/replied`, {})); toast("Marked as replied: nothing more goes to them by itself."); },
      async "said-no"(btn) { if (!(await sure("Never email them?", "Never email them", "They said no: recorded so they're never emailed this way again."))) return false; await busy(btn, "Saving…", () => post(`${A}funnel/${p.id}/stop`, { why: "opted_out" })); toast("Recorded: they won't be emailed this way again."); },
      async reject(btn) { if (!(await sure("Reject them?", "Reject", "They won't be emailed."))) return false; await busy(btn, "Saving…", () => post(`${A}funnel/${p.id}/stop`, { why: "rejected" })); toast("Rejected: they won't be emailed."); },
      async remove(btn) { if (!(await sure("Take off the list?", "Take them off"))) return false; await busy(btn, "Removing…", () => post(`${A}funnel/${p.id}/remove`, {})); toast("Taken off the list."); go("#outreach/funnel"); return false; },
      async edit() {
        const ok = await sheetDo({
          title: "Change",
          html: `${field({ label: "Name", name: "name", value: p.name || "", attrs: 'maxlength="100"' })}
            ${field({ label: "Company or project", name: "company", value: p.company || "", attrs: 'maxlength="120"' })}
            ${field({ label: "Role", name: "role", type: "select", value: p.role || "", options: [["", "Not decided"], ...Object.entries(roles)] })}
            ${field({ label: "Subject", name: "subject", value: p.subject || "", attrs: 'maxlength="120"' })}
            ${field({ label: "Email (the footer and opt-out link are added underneath)", name: "body", type: "textarea", rows: 9, value: p.body || "", attrs: 'maxlength="3000"' })}
            ${field({ label: "Bio and notes", name: "bio", type: "textarea", rows: 3, value: p.bio || "", attrs: 'maxlength="2000"' })}`,
          run: (x) => post(`${A}funnel/${p.id}/edit`, { name: x.name.value, company: x.company.value, role: x.role.value, subject: x.subject.value, body: x.body.value, bio: x.bio.value }),
        });
        if (!ok) return false;
        toast(p.status === "warming" ? "Saved. It's out of the queue until it's approved again." : "Saved.");
      },
    });
  }

  // The settings: the daily cap, the warm-up, the gaps and hours, the sign-off and what's offered (admins change them)
  async function drawFunnelSettings(box, ui) {
    ui.back("#outreach/funnel");
    ui.title("Funnel settings");
    const r = await funnel();
    if (r.off) { box.innerHTML = empty({ icon: "globe", title: FUNNEL_OFF }); return; }
    const s = r.settings || {}, can = !!r.canDecide, off = can ? "" : " disabled";
    const n = (key, label, lo, hi) => field({ label, name: key, type: "number", value: s[key] ?? "", attrs: `min="${lo}" max="${hi}" step="1"${off}` });
    box.innerHTML = `<form class="form" data-settings>
        <div class="card form"><p class="kicker">How many, and when</p>
          <div class="two-up outreach-two">${n("cap", "Daily cap (most a day, ever)", 1, 40)}${n("rampStart", "Day 1 to start", 1, 40)}${n("rampStep", "Then add", 0, 20)}${n("rampEvery", "Every … sending days", 1, 14)}${n("gapMin", "Shortest gap (seconds)", 120, 3600)}${n("gapMax", "Longest gap (seconds)", 120, 7200)}${n("fromHour", "Send from (hour, UK)", 0, 23)}${n("toHour", "Until (hour, UK)", 1, 24)}</div>
          ${toggle({ label: "Monday to Friday only", name: "weekdaysOnly", checked: !!s.weekdaysOnly })}
          ${field({ label: "Sign off as", name: "signoff", value: s.signoff || "", attrs: `maxlength="80"${off}` })}</div>
        <div class="card form"><p class="kicker">What the studio offers each of them</p><p class="muted small">Claude only offers what's here.</p>
          ${Object.entries(r.roles || {}).map(([k, name]) => field({ label: name, name: `pitch-${k}`, type: "textarea", rows: 2, value: (s.pitch || {})[k] || "", attrs: `maxlength="400" data-pitch="${esc(k)}"${off}` })).join("")}</div>
        ${det("f-risky", `Risky words, rewritten before anything is queued (${(r.risky || []).length})`, `<ul class="outreach-tips">${(r.risky || []).map((x) => `<li>${esc(`${x.words} → ${x.to}`)}</li>`).join("")}</ul>`)}
        ${can ? `<button class="btn main wide" type="submit">${icon("check")} Save settings</button>` : '<p class="muted small">An admin changes these.</p>'}
        ${problemSlot}</form>`;
    keep(box);
    const f = box.querySelector("[data-settings]");
    if (!can) f.elements.weekdaysOnly.disabled = true;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = { pitch: {} };
      for (const k of ["cap", "rampStart", "rampStep", "rampEvery", "gapMin", "gapMax", "fromHour", "toHour"]) body[k] = Number(f.elements[k].value);
      body.weekdaysOnly = f.elements.weekdaysOnly.checked;
      body.signoff = f.elements.signoff.value;
      f.querySelectorAll("[data-pitch]").forEach((a) => (body.pitch[a.dataset.pitch] = a.value));
      problem(box, "");
      try {
        await busy(f.querySelector("[type=submit]"), "Saving…", () => post(`${A}funnel/settings`, body));
        f.classList.remove("dirty");
        toast("Settings saved.");
        N.show();
      } catch (err) { toast(err.message, true); problem(box, `Not saved: ${err.message}`); }
    });
  }
})();
