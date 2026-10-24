// Nova Phone: Clients, everyone who's booked or enquired (Nova Desk's Portal → Clients). The list, searchable by
// name, email or phone, with Owes money, Not booked since and Enquiries only; each client's page: when they last
// and next booked, every session (its time and where it came from), money, their details to change (only what
// changed is sent), marketing (UK GDPR: no until a yes is recorded with where it came from and when; every change
// kept with who and when), call, text, email, a new invoice with their name and email in, their invoices; add a
// client by hand (from this phone's contacts where the phone allows it); Import from contacts: a phone number
// looked up in the studio's Google Contacts, people chosen from this phone's contacts (Android's Chrome; iPhones
// don't offer it), or contact cards (.vcf, how an iPhone shares a contact), each shown to check before Add;
// admins sync now (the studio's bookings and enquiries) and import a spreadsheet (CSV).
// Addresses: #clients, #clients/<id>, #clients/new, #clients/contacts, #clients/import.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, form: sheetForm, busy, initials } = N;
  const A = "/app/api/clients";
  const CLIENT_SOURCES = { booking: "Booked a session", acuity: "Booked a session", nova: "Booked a session", enquiry: "Sent an enquiry", import: "Imported", staff: "Added by hand" };
  const SESSION_SOURCES = { feed: "from the booking calendar", webhook: "from a booking", nova: "from a booking", import: "imported" };
  // "Sat 1 Aug 2026" (and ", 14:00" with the time), UK time, as on Nova Desk
  function ukDay(iso, withTime) {
    if (!iso) return "";
    const d = new Date(/^\d{4}-\d\d-\d\d$/.test(String(iso)) ? `${iso}T12:00:00Z` : iso);
    if (isNaN(d)) return "";
    const o = { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" };
    if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("en-GB", o).replace(/^(\p{L}+),/u, "$1");
  }
  const ukToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const gbp = (v) => `£${(Number(v) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const owes = (c) => Number(c.outstanding) > 0;
  // Pounds as typed ("£1,200", "45.5", "") → "1200.00", or null when it isn't an amount
  function readPounds(text) {
    const t = String(text).replace(/[£,\s]/g, "");
    if (t === "") return "0.00";
    return /^\d{1,7}(\.\d{1,2})?$/.test(t) ? Number(t).toFixed(2) : null;
  }
  const lastNine = (v) => String(v || "").replace(/\D/g, "").slice(-9);
  const picker = () => ("contacts" in navigator && navigator.contacts && typeof navigator.contacts.select === "function" ? navigator.contacts : null);
  const isAdmin = () => me?.staff?.role === "admin";
  const FILTERS = [["all", "All"], ["owing", "Owes money"], ["lapsed", "Not booked since"], ["enquiry", "Enquiries only"]];
  let filter = "all", search = "", since = "", me = null;

  N.section({
    id: "clients",
    name: "Clients",
    tile: "portal",
    async draw(box, [id], ui) {
      const [m] = await Promise.all([me ? me : api("/auth/me").catch((e) => { if (e.signIn) throw e; return null; }), N.css("clients.css")]);
      me = m;
      if (id === "new") return drawNew(box, ui);
      if (id === "contacts") return drawContacts(box, ui);
      if (id === "import") return drawImport(box, ui);
      if (id) return drawClient(box, id, ui);
      ui.action({ icon: "plus", label: "Add a client", href: "#clients/new" });
      if (filter === "lapsed" && !since) { const d = new Date(); d.setMonth(d.getMonth() - 3); since = N.localStamp(d).slice(0, 10); }
      const r = await api(`${A}?filter=${filter}${search ? `&search=${encodeURIComponent(search)}` : ""}${filter === "lapsed" ? `&since=${since}` : ""}`);
      const cs = r.clients || [];
      const total = Number(r.total) || cs.length;
      box.innerHTML = `<form class="search" data-client-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search name, email or phone" enterkeyhint="search"></label></form>
        <div class="chips">${FILTERS.map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${l}</button>`).join("")}</div>
        ${filter === "lapsed" ? field({ label: "Not booked since", name: "since", type: "date", value: since, attrs: `max="${ukToday()}"` }) : ""}
        <p class="muted small" role="status">${esc(countWords(cs, total))}</p>
        ${cs.length ? list(cs.map(clientRow)) : empty({ icon: "user", title: emptyWords() })}
        <div class="btns two clients-tools"><a class="btn" href="#clients/contacts">${icon("user")} Import from contacts</a>${isAdmin() ? `<button type="button" class="btn" data-sync>${icon("refresh")} Sync now</button><a class="btn" href="#clients/import">${icon("book")} Import a spreadsheet</a>` : ""}</div>`;
      box.querySelector("[data-client-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
      box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; N.show(); }));
      box.querySelector("[name=since]")?.addEventListener("change", (e) => { if (e.target.value) { since = e.target.value; N.show(); } });
      box.querySelector("[data-sync]")?.addEventListener("click", (e) => busy(e.currentTarget, "Syncing…", async () => {
        try {
          const x = await post(`${A}/sync`, {});
          const c = x.clients || {}, s = x.sessions || {};
          toast(c.added || c.updated || s.added || s.updated ? `Synced: ${c.added || 0} new clients, ${s.added || 0} new sessions` : "Synced: already up to date");
          N.show();
        } catch (err) { toast(`Couldn't sync: ${err.message}`, true); }
      }));
    },
  });
  // The count, in Nova Desk's words
  function countWords(cs, total) {
    const more = cs.length < total ? ` (the first ${cs.length} shown: search to narrow it down)` : "";
    if (filter === "owing") {
      const sum = cs.reduce((n, c) => n + Math.round((Number(c.outstanding) || 0) * 100), 0) / 100;
      return `${total}${total === 1 ? " client owes " : " clients owe "}${gbp(sum)}${more ? ` between them${more}` : " in all"}`;
    }
    if (filter === "lapsed") return `${total}${total === 1 ? " client hasn't" : " clients haven't"} booked since ${ukDay(since)}${more}`;
    return `${total}${total === 1 ? " client" : " clients"}${more}`;
  }
  function emptyWords() {
    if (search) return `No clients match “${search}”.`;
    if (filter === "owing") return "Nobody owes anything.";
    if (filter === "lapsed") return "Everyone who booked before then has booked again since.";
    if (filter === "enquiry") return "No clients from enquiries only.";
    return isAdmin() ? "No clients yet. Sync now, or import a spreadsheet." : "No clients yet. They appear here as people book and send enquiries.";
  }
  function clientRow(c) {
    const booked = [c.lastBooked ? `Last booked ${ukDay(c.lastBooked)}` : "Not booked yet", c.nextBooked ? `Next ${ukDay(c.nextBooked, true)}` : "", c.sessionCount ? `${c.sessionCount} session${c.sessionCount === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    const pills = [c.consent?.yes ? `<span class="pill ok">Marketing: yes</span>` : `<span class="pill">No marketing</span>`, owes(c) ? `<span class="pill bad">Owes ${esc(gbp(c.outstanding))}</span>` : "", c.source === "enquiry" && !c.sessionCount ? `<span class="pill warn">Enquiry</span>` : ""].join(" ");
    return row({ href: `#clients/${c.id}`, lead: `<span class="av">${esc(initials(c.name || c.email))}</span>`, title: c.name || c.email || "Someone", text: [c.email, c.phone].filter(Boolean).join(" · "), html: `<span>${esc(booked)}</span><span class="clients-pills">${pills}</span>` });
  }

  // ---- One client ----
  async function drawClient(box, id, ui) {
    ui.back("#clients");
    const r = await api(`${A}/${encodeURIComponent(id)}`);
    const c = r.client;
    if (!c) { box.innerHTML = empty({ icon: "user", title: "That client isn't there", action: `<a class="btn" href="#clients">All clients</a>` }); return; }
    ui.title(c.name || "Client");
    const sessions = [...(r.sessions || [])].sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const log = [...(r.consentLog || [])].sort((a, b) => String(b.recorded_at || b.at).localeCompare(String(a.recorded_at || a.at)));
    const now = new Date().toISOString();
    const yes = Boolean(c.consent && c.consent.yes);
    const facts = [["Email", c.email], ["Phone", c.phone], ["Last booked", c.lastBooked ? ukDay(c.lastBooked, true) : "Not yet"], ["Next booked", c.nextBooked ? ukDay(c.nextBooked, true) : "Nothing booked"], ["Sessions", String(c.sessionCount || 0)], ["Owes", gbp(c.outstanding)], ["Deposits paid", gbp(c.depositsPaid)], ["Invoiced", gbp(c.invoiced)]].filter(([, v]) => v);
    const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    box.innerHTML = `<div class="card"><p class="kicker">${esc([CLIENT_SOURCES[c.source] || c.source || "Client", c.createdAt ? `On the list since ${ukDay(c.createdAt)}` : ""].filter(Boolean).join(" · "))}</p><h2 class="card-title">${esc(c.name || "")}</h2>
        <p class="clients-pills">${yes ? `<span class="pill ok">Marketing: yes</span>` : `<span class="pill">No marketing</span>`}${owes(c) ? ` <span class="pill bad">Owes ${esc(gbp(c.outstanding))}</span>` : ""}</p>
        ${c.email || c.phone ? "" : `<p class="muted">No email or phone yet</p>`}
        <div class="facts clients-facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${c.notes ? `<p class="pre muted clients-notes">${esc(c.notes)}</p>` : ""}</div>
      <div class="btns two">${c.phone ? `<a class="btn" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">${icon("phone")} Call</a><a class="btn" href="sms:${esc(String(c.phone).replace(/[^\d+]/g, ""))}">${icon("chat")} Text</a>` : ""}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon("mail")} Email</a>` : ""}
        <a class="btn main" href="#money/new?${q({ name: c.name, email: c.email })}">${icon("plus")} New invoice</a><a class="btn" href="#money/?${q({ q: c.name })}">${icon("money")} Their invoices</a></div>
      <h3 class="h">Marketing</h3>
      <div class="card clients-consent">
        <label class="switch"><span>They've said yes to marketing</span><input type="checkbox" role="switch" data-consent${yes ? " checked" : ""}></label>
        <p class="muted small">${yes ? esc(`Yes since ${ukDay(c.consent.at)}${c.consent.source ? ` · ${c.consent.source}` : ""}`) : "No. Everyone starts at no: it's only yes once you record where their yes came from, and when. A reply to an enquiry doesn't count."}</p>
        ${log.length ? `<p class="kicker clients-sub">History</p><ul class="clients-log">${log.map((e) => { const by = e.byName || e.by_name || (e.by === "customer" ? "the customer" : e.by === "import" ? "an import" : e.by || ""); return `<li>${esc([Number(e.consent) ? "Yes" : "No", e.at ? ukDay(e.at) : "", e.source || "", by ? `recorded by ${by}` : "", e.recorded_at && ukDay(e.recorded_at) !== ukDay(e.at) ? `on ${ukDay(e.recorded_at)}` : ""].filter(Boolean).join(" · "))}</li>`; }).join("")}</ul>` : ""}
      </div>
      <h3 class="h">${sessions.length ? `Sessions (${sessions.length})` : "Sessions"}</h3>
      ${sessions.length ? list(sessions.map((s) => row({ icon: "calendar", title: s.session || "Session", text: [ukDay(s.start, true), s.price ? (isNaN(Number(s.price)) ? s.price : gbp(s.price)) : "", SESSION_SOURCES[s.source] || ""].filter(Boolean).join(" · "), end: s.status === "cancelled" ? `<span class="pill bad">Cancelled</span>` : String(s.start) > now ? `<span class="pill ok">Coming up</span>` : "" }))) : `<p class="muted small">No sessions on record yet.</p>`}
      <button type="button" class="btn wide" data-edit>${icon("edit")} Change their details</button>`;
    box.querySelector("[data-consent]").addEventListener("change", (e) => consent(e.target, c));
    box.querySelector("[data-edit]").addEventListener("click", () => edit(c));
  }
  // Marketing: on asks where the yes came from and when (today unless changed); off is straight away
  async function consent(sw, c) {
    const yes = sw.checked;
    let body = { yes: false, source: "Switched off on Nova Phone" };
    if (yes) {
      const mine = me?.staff?.display_name || "me";
      const ideas = ["Ticked on the booking form", `Said yes in person, recorded by ${mine}`, "Fan sign-up"];
      const v = await sheetForm(`<h2 class="sheet-title">Where did their yes come from?</h2><form class="form" data-f novalidate>${field({ label: "Where their yes came from", name: "source", placeholder: "e.g. Ticked on the booking form", attrs: 'maxlength="300"' })}
          <p class="muted small clients-sub">Or tap one:</p>${list(ideas.map((t) => row({ button: `data-idea="${esc(t)}"`, icon: "check", title: t, cls: "clients-idea" })))}
          ${field({ label: "When they said yes", name: "at", type: "date", value: ukToday(), attrs: `max="${ukToday()}"` })}<p class="form-said" data-said role="alert"></p>
          <div class="btns"><button class="btn main wide" type="submit">Save their yes</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => {
          const f = el.querySelector("[data-f]"), said = el.querySelector("[data-said]");
          el.querySelectorAll("[data-idea]").forEach((b) => (b.onclick = () => { f.elements.source.value = b.dataset.idea; said.textContent = ""; }));
          f.onsubmit = (ev) => {
            ev.preventDefault();
            const source = f.elements.source.value.trim(), at = f.elements.at.value;
            if (!source) { said.textContent = "Say where their yes came from first."; said.classList.add("bad"); return f.elements.source.focus(); }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(at) || at > ukToday()) { said.textContent = "Pick the day they said yes (today or before)."; said.classList.add("bad"); return f.elements.at.focus(); }
            done({ yes: true, source, at });
          };
          el.querySelector("[data-no]").onclick = () => done(null);
        });
      if (!v) { sw.checked = false; return; }
      body = v;
    }
    sw.disabled = true;
    try { await post(`${A}/${c.id}`, { consent: body }); toast(yes ? "Marketing: yes, recorded" : "Marketing: off, recorded"); N.show(); }
    catch (err) { sw.checked = !yes; sw.disabled = false; toast(`Not saved: ${err.message}`, true); }
  }
  // Contact, notes and money (pounds): only what changed is sent
  async function edit(c) {
    const money = (k) => (Number(c[k]) ? Number(c[k]).toFixed(2) : "");
    await sheetForm(`<h2 class="sheet-title">${esc(c.name || "Client")}</h2><form class="form" data-f novalidate>
        ${field({ label: "Name", name: "name", value: c.name || "", required: true, attrs: 'maxlength="200" autocomplete="off"' })}${field({ label: "Email", name: "email", type: "email", value: c.email || "", attrs: 'maxlength="200"' })}${field({ label: "Phone", name: "phone", type: "tel", value: c.phone || "", attrs: 'maxlength="40"' })}${field({ label: "Notes", name: "notes", type: "textarea", rows: 3, value: c.notes || "", attrs: 'maxlength="4000"' })}
        <div class="two-up">${field({ label: "Deposits paid (£)", name: "depositsPaid", value: money("depositsPaid"), placeholder: "0.00", attrs: 'inputmode="decimal"' })}${field({ label: "Invoiced (£)", name: "invoiced", value: money("invoiced"), placeholder: "0.00", attrs: 'inputmode="decimal"' })}</div>
        ${field({ label: "Owes (£)", name: "outstanding", value: money("outstanding"), placeholder: "0.00", attrs: 'inputmode="decimal"', hint: "Money is typed in by hand for now, in pounds." })}
        <p class="form-said" data-said role="alert"></p>
        <div class="btns"><button class="btn main wide" type="submit">Save</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]"), said = el.querySelector("[data-said]");
        const bad = (t, input) => { said.textContent = t; said.classList.add("bad"); input.focus(); };
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const body = {};
          for (const key of ["name", "email", "phone", "notes", "depositsPaid", "invoiced", "outstanding"]) {
            const input = f.elements[key];
            const isMoney = ["depositsPaid", "invoiced", "outstanding"].includes(key);
            const value = isMoney ? readPounds(input.value) : input.value.trim();
            if (value === null) return bad("That isn't an amount in pounds (like 120 or 45.50).", input);
            if (key === "name" && !value) return bad("They need a name.", input);
            const was = isMoney ? Number(c[key] || 0).toFixed(2) : String(c[key] || "");
            if (value !== was) body[key] = value;
          }
          if (!Object.keys(body).length) { done(null); toast("Nothing changed"); return; }
          await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
            try { await post(`${A}/${c.id}`, body); done(true); toast("Saved"); N.show(); } catch (err) { said.textContent = `Not saved: ${err.message}`; said.classList.add("bad"); }
          });
        };
        el.querySelector("[data-no]").onclick = () => done(null);
      });
  }

  // ---- Add a client by hand (Nova Bot refuses a duplicate and says which: that one opens) ----
  function drawNew(box, ui) {
    ui.back("#clients");
    ui.title("Add a client");
    box.innerHTML = `${picker() ? `<button type="button" class="btn wide" data-pick>${icon("user")} Choose from this phone's contacts</button>` : ""}
      <form class="form" id="cf" novalidate>${field({ label: "Name", name: "name", required: true, attrs: 'autocomplete="name" maxlength="200"' })}${field({ label: "Email", name: "email", type: "email", attrs: 'maxlength="200"' })}${field({ label: "Phone", name: "phone", type: "tel", attrs: 'autocomplete="tel" maxlength="40"' })}${field({ label: "Notes (optional)", name: "notes", type: "textarea", rows: 3, attrs: 'maxlength="4000"' })}
      <p class="form-said" id="cf-said" role="status">Marketing consent starts as no. Turn it on from their page once they've said yes.</p><button class="btn main wide" type="submit">${icon("check")} Add the client</button></form>
      <a class="btn quiet wide" href="#clients/contacts">Import from contacts instead</a>`;
    const f = box.querySelector("#cf");
    box.querySelector("[data-pick]")?.addEventListener("click", async () => {
      try { const [p] = await picker().select(["name", "email", "tel"], { multiple: false }); if (p) { f.elements.name.value = p.name?.[0] || ""; f.elements.email.value = p.email?.[0] || ""; f.elements.phone.value = p.tel?.[0] || ""; } } catch (e) { /* (closed without choosing) */ }
    });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, said = box.querySelector("#cf-said");
      if (!x.name.value.trim()) { said.textContent = "What's their name?"; said.classList.add("bad"); x.name.focus(); return; }
      await busy(f.querySelector("[type=submit]"), "Adding…", async () => {
        try { const r = await post(A, { name: x.name.value.trim(), email: x.email.value.trim(), phone: x.phone.value.trim(), notes: x.notes.value.trim() }); f.classList.remove("dirty"); toast(`Added ${x.name.value.trim()}`); location.hash = r.client?.id || r.id ? `#clients/${r.client?.id || r.id}` : "#clients"; }
        catch (err) { const d = err.data || {}; const was = d.id || d.existingId || d.client?.id; if (was) { toast("They're already on the list"); location.hash = `#clients/${was}`; } else { said.textContent = `Not added: ${err.message}`; said.classList.add("bad"); } }
      });
    });
  }

  // ---- Import from contacts: a number, this phone's contacts, or contact cards; nothing added until Add ----
  // A contact card (.vcf: one or more vCards, 2.1 to 4.0) → [{ name, emails, phones, addresses, organisation, birthday, notes }]
  function readVcards(text) {
    const unfolded = String(text || "").replace(/\r\n/g, "\n").replace(/=\n/g, "").replace(/\n[ \t]/g, "");
    const cards = [];
    let card = null;
    const unescape = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
    const qp = (v) => { try { return decodeURIComponent(v.replace(/%/g, "%25").replace(/=([0-9A-F]{2})/gi, "%$1")); } catch (err) { return v; } };
    for (const line of unfolded.split("\n")) {
      const m = line.match(/^(?:[\w-]+\.)?([A-Za-z-]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      const value = /ENCODING=QUOTED-PRINTABLE/i.test(m[2]) ? qp(m[3]) : m[3];
      if (key === "BEGIN" && /vcard/i.test(value)) card = { name: "", n: "", emails: [], phones: [], addresses: [], organisation: "", birthday: "", notes: "" };
      else if (!card) continue;
      else if (key === "END") { card.name = card.name || card.n; delete card.n; if (card.name || card.phones.length || card.emails.length) cards.push(card); card = null; }
      else if (key === "FN") card.name = unescape(value);
      else if (key === "N") card.n = value.split(";").slice(0, 2).reverse().map(unescape).filter(Boolean).join(" ");
      else if (key === "TEL") card.phones.push(unescape(value.replace(/^tel:/i, "")));
      else if (key === "EMAIL") card.emails.push(unescape(value).toLowerCase());
      else if (key === "ADR") card.addresses.push(value.split(";").map(unescape).filter(Boolean).join(", "));
      else if (key === "ORG") card.organisation = value.split(";").map(unescape).filter(Boolean).join(", ");
      else if (key === "TITLE") card.organisation = [card.organisation, unescape(value)].filter(Boolean).join(", ");
      else if (key === "BDAY") card.birthday = unescape(value).replace(/^--/, "");
      else if (key === "NOTE") card.notes = unescape(value).slice(0, 1000);
    }
    return cards;
  }
  let found = null; // { list, from } kept while the screen is open
  function drawContacts(box, ui) {
    ui.back("#clients");
    ui.title("Import from contacts");
    box.innerHTML = `<form class="form card clients-find" data-find novalidate>
        ${field({ label: "Their phone number", name: "phone", type: "tel", placeholder: "07700 900123", attrs: 'inputmode="tel" maxlength="40" autocomplete="off"' })}
        <button class="btn main wide" type="submit">${icon("search")} Find this number</button>
        ${picker() ? `<button type="button" class="btn wide" data-pick>${icon("user")} Choose from this phone's contacts</button>` : ""}
        <label class="btn wide clients-file">${icon("book")} Open a contact card<input class="sr" type="file" accept=".vcf,text/vcard,text/x-vcard" multiple data-file></label>
        <p class="muted small">${picker() ? "Find this number looks in the studio's Google Contacts. Choose from this phone's contacts opens your contact book." : "Find this number looks in the studio's Google Contacts. On an iPhone: Contacts → the person → Share Contact → Save to Files, then Open a contact card here."}</p>
      </form>
      <div class="clients-result" data-result aria-live="polite"></div>`;
    const f = box.querySelector("[data-find]"), out = box.querySelector("[data-result]");
    const say = (html) => (out.innerHTML = html);
    const want = () => lastNine(f.elements.phone.value);
    const show = (list_, from) => {
      found = { list: list_, from };
      const w = want();
      const has = (c) => w.length === 9 && c.phones.some((p) => lastNine(p) === w);
      const sorted = w.length === 9 && list_.some(has) ? [...list_.filter(has), ...list_.filter((c) => !has(c))] : list_;
      if (!sorted.length) return say(`<p class="muted">No one found${w ? " with that number" : ""} in ${esc(from)}.</p>`);
      say(`<p class="muted small">${sorted.length === 1 ? `Found in ${esc(from)}:` : `${sorted.length} found in ${esc(from)}:`}</p>${sorted.map((c, i) => `<article class="card clients-found">
          <h3 class="card-title">${esc(c.name || c.phones[0] || c.emails[0] || "No name")}</h3>${has(c) ? `<p class="ok small">Has that number</p>` : ""}
          <div class="facts">${[["Phone", c.phones.join("\n")], ["Email", c.emails.join("\n")], ["Address", c.addresses.join("\n")], ["Work", c.organisation], ["Birthday", c.birthday], ["Notes", c.notes]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b class="pre">${esc(v)}</b></div>`).join("")}</div>
          <button type="button" class="btn main wide" data-add="${i}">${icon("plus")} Add as a client</button></article>`).join("")}`);
      out.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => (b.dataset.open ? (location.hash = `#clients/${b.dataset.open}`) : add(sorted[Number(b.dataset.add)], from, b))));
    };
    const add = async (c, from, b) => {
      const w = want();
      const phone = c.phones.find((p) => w.length === 9 && lastNine(p) === w) || c.phones[0] || "";
      const extra = [`From ${from} (${new Date().toLocaleDateString("en-GB")}).`, c.phones.length > 1 ? `Other numbers: ${c.phones.filter((p) => p !== phone).join(", ")}` : "", c.emails.length > 1 ? `Other emails: ${c.emails.slice(1).join(", ")}` : "", c.addresses.length ? `Address: ${c.addresses.join(" / ").replace(/\n/g, ", ")}` : "", c.organisation ? `Work: ${c.organisation}` : "", c.birthday ? `Birthday: ${c.birthday}` : "", c.notes].filter(Boolean);
      const body = { name: (c.name || phone || c.emails[0] || "").slice(0, 200), email: c.emails[0] || "", phone, notes: extra.join("\n").slice(0, 4000) };
      if (!body.name) return toast("That contact has no name or number to add.", true);
      b.disabled = true;
      try {
        const r = await post(A, body);
        toast(`Added ${body.name}`);
        const id = r.client && r.client.id;
        b.disabled = !id;
        b.textContent = id ? "Added: open them" : "Added";
        if (id) b.dataset.open = String(id);
      } catch (err) {
        b.disabled = false;
        const d = err.data || {};
        const was = d.id || d.existingId || d.client?.id;
        if (was) { toast("They're already on the list"); b.textContent = "Already a client: open them"; b.dataset.open = String(was); }
        else toast(err.message, true);
      }
    };
    if (found) show(found.list, found.from);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (lastNine(f.elements.phone.value).length < 9) { say(`<p class="bad">Type their whole phone number first.</p>`); return f.elements.phone.focus(); }
      await busy(f.querySelector("[type=submit]"), "Looking…", async () => {
        try {
          const r = await api(`/app/api/google/contacts/phone?phone=${encodeURIComponent(f.elements.phone.value.trim())}`);
          if (r.off) return say(`<p class="muted">Google Contacts isn't connected yet (Google, in More).${picker() ? " Choose from this phone's contacts instead." : " Open a contact card instead."}</p>${isAdmin() ? `<a class="btn" href="#google">Open Google</a>` : ""}`);
          show(r.contacts || [], "the studio's Google Contacts");
          if (!(r.contacts || []).length && picker()) out.insertAdjacentHTML("beforeend", `<p class="muted small">Not there? Choose from this phone's contacts.</p>`);
        } catch (err) { say(`<p class="bad">${esc(err.signIn ? "Sign in again first." : err.message)}</p>`); }
      });
    });
    box.querySelector("[data-pick]")?.addEventListener("click", async () => {
      const book = picker();
      try {
        const can = typeof book.getProperties === "function" ? await book.getProperties() : ["name", "email", "tel"];
        const props = ["name", "email", "tel", "address"].filter((p) => can.includes(p));
        const picked = await book.select(props, { multiple: true });
        if (!picked || !picked.length) return;
        const tidy = (a) => [...new Set((a || []).map((v) => String(v || "").trim()).filter(Boolean))];
        show(picked.map((c) => ({ name: tidy(c.name)[0] || "", emails: tidy(c.email).map((x) => x.toLowerCase()), phones: tidy(c.tel), addresses: (c.address || []).map((a) => [...(a.addressLine || []), a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", ")).filter(Boolean), organisation: "", birthday: "", notes: "" })), "this phone's contacts");
      } catch (err) { say(`<p class="bad">The phone's contacts didn't open: ${esc(err.message || err)}. Open a contact card instead.</p>`); }
    });
    box.querySelector("[data-file]").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (!files.length) return;
      if (files.some((x) => x.size > 5 * 1024 * 1024)) return say(`<p class="bad">That contact card is too big (over 5 MB).</p>`);
      try { show((await Promise.all(files.map((x) => x.text()))).flatMap(readVcards), files.length === 1 ? files[0].name : "the contact cards"); }
      catch (err) { say(`<p class="bad">Couldn't read that contact card.</p>`); }
    });
  }
  addEventListener("hashchange", () => { if (!location.hash.startsWith("#clients/contacts")) found = null; });

  // ---- Import a spreadsheet (admins): a clients or appointments CSV, chosen or pasted ----
  function drawImport(box, ui) {
    ui.back("#clients");
    ui.title("Import a spreadsheet");
    if (!isAdmin()) { box.innerHTML = empty({ icon: "user", title: "Importing is for admins", text: "Ask an admin to import the spreadsheet.", action: `<a class="btn" href="#clients">All clients</a>` }); return; }
    let chosen = "";
    box.innerHTML = `<div class="card"><ol class="clients-steps">
        <li>A clients spreadsheet (CSV): a Name (or First Name and Last Name) column, and Email or Phone.</li>
        <li>Or an appointments spreadsheet (CSV): a Start Time column, and a name or Email.</li>
        <li>Choose a file below (or paste what's in it) and press Import. One file at a time; importing the same file again changes nothing.</li></ol></div>
      <form class="form" data-imp novalidate>
        <label class="btn wide clients-file">${icon("book")} Choose the CSV file<input class="sr" type="file" accept=".csv,text/csv,text/plain" data-file></label>
        <p class="muted small" data-chosen></p>
        ${field({ label: "Or paste it here", name: "csv", type: "textarea", rows: 4, placeholder: "Start Time,End Time,First Name,Last Name,…", attrs: 'spellcheck="false"' })}
        <p class="muted small">Importing never turns marketing consent on, and never overwrites contact details someone has already filled in.</p>
        <button class="btn main wide" type="submit">Import</button>
      </form>
      <div class="clients-result" data-result aria-live="polite"></div>`;
    const f = box.querySelector("[data-imp]"), out = box.querySelector("[data-result]"), note = box.querySelector("[data-chosen]");
    box.querySelector("[data-file]").addEventListener("change", (e) => {
      const file = e.target.files[0];
      chosen = "";
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { note.textContent = "That file is too big (over 20 MB). Split it into smaller files."; note.classList.add("bad"); return; }
      file.text().then((t) => { chosen = t; note.classList.remove("bad"); note.textContent = `Chosen: ${file.name} (${Math.max(0, t.split(/\r?\n/).filter((l) => l.trim()).length - 1)} lines). Press Import.`; }, () => { note.textContent = "Couldn't read that file."; note.classList.add("bad"); });
    });
    f.elements.csv.addEventListener("input", () => { if (chosen) { chosen = ""; note.textContent = ""; } });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const csv = chosen || f.elements.csv.value;
      if (!csv.trim()) { out.innerHTML = `<p class="bad">Choose the CSV file, or paste it, first.</p>`; return; }
      out.innerHTML = "";
      await busy(f.querySelector("[type=submit]"), "Importing…", async () => {
        try {
          const r = await post(`${A}/import`, { csv });
          const c = r.clients || {}, s = r.sessions || {};
          const problems = (r.problems || []).map((p) => (typeof p === "string" ? p : `${p.line ? `Line ${p.line}: ` : ""}${p.problem || p.error || p.message || JSON.stringify(p)}`));
          out.innerHTML = `<div class="card"><p class="ok"><b>${r.kind === "clients" ? "The client list" : "The appointments"} imported.</b></p>
            <p>Clients: ${c.added || 0} new, ${c.updated || 0} updated.${r.kind === "clients" ? "" : ` Sessions: ${s.added || 0} new, ${s.updated || 0} updated.`}</p>
            ${r.skipped ? `<p class="muted small">${r.skipped}${r.skipped === 1 ? " line was" : " lines were"} skipped.</p>` : ""}
            ${problems.length ? `<ul class="clients-log">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
            <a class="btn wide" href="#clients">See the clients</a></div>`;
          chosen = ""; note.textContent = ""; f.elements.csv.value = ""; f.classList.remove("dirty");
          toast("Imported");
        } catch (err) { out.innerHTML = `<p class="bad">Not imported: ${esc(err.signIn ? "sign in again first." : err.message)}</p>`; }
      });
    });
  }
})();
