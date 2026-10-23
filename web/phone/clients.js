// Nova Phone: Clients, everyone who's booked or enquired (Nova Desk's Portal → Clients). The list, searchable by
// name, email or phone, with Owes money, Not booked since and Enquiries only; each client's page: when they last
// and next booked, sessions, money, their details to change, marketing (UK GDPR: no until a yes is recorded with
// where it came from), call, text, email, a new invoice, their invoices; add a client (from this phone's
// contacts where the phone allows it: Android's Chrome does, iPhones don't, so typing it in always works);
// an admin syncs with Acuity.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, form: sheetForm, busy, ago, initials, today } = N;
  const A = "/app/api/clients";
  const day = (d) => (d ? new Date(String(d).length > 10 ? d : `${d}T12:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
  const FILTERS = [["all", "All"], ["owing", "Owes money"], ["lapsed", "Not booked since…"], ["enquiry", "Enquiries only"]];
  let filter = "all", search = "", since = "", me = null;
  N.section({
    id: "clients",
    name: "Clients",
    tile: "portal",
    async draw(box, [id], ui) {
      me ||= await api("/auth/me").catch(() => null);
      if (id === "new") return drawNew(box, ui);
      if (id) return drawClient(box, id, ui);
      ui.action({ icon: "plus", label: "Add a client", href: "#clients/new" });
      if (filter === "lapsed" && !since) { const d = new Date(); d.setMonth(d.getMonth() - 3); since = N.localStamp(d).slice(0, 10); }
      const r = await api(`${A}?filter=${filter}${search ? `&search=${encodeURIComponent(search)}` : ""}${filter === "lapsed" ? `&since=${since}` : ""}`);
      const cs = r.clients || [];
      const owes = cs.reduce((t, c) => t + (Number(c.outstanding) || 0), 0);
      box.innerHTML = `<form class="search" data-client-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search name, email or phone"></label></form>
        <div class="chips">${FILTERS.map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${l}</button>`).join("")}</div>
        ${filter === "lapsed" ? field({ label: "Not booked since", name: "since", type: "date", value: since }) : ""}
        <p class="muted small">${r.total ?? cs.length} client${(r.total ?? cs.length) === 1 ? "" : "s"}${filter === "owing" && owes ? ` owe £${owes.toLocaleString("en-GB", { minimumFractionDigits: 2 })} in all` : ""}</p>
        ${cs.length ? list(cs.map((c) => row({ href: `#clients/${c.id}`, lead: `<span class="av">${esc(initials(c.name))}</span>`, title: c.name || c.email || "Someone", text: [c.email, c.phone, c.lastBooked ? `last booked ${day(c.lastBooked)}` : "", c.nextBooked ? `next ${day(c.nextBooked)}` : ""].filter(Boolean).join(" · "), end: [Number(c.outstanding) > 0 ? `<span class="pill bad">Owes £${esc(c.outstanding)}</span>` : "", c.consent?.yes ? `<span class="pill ok">Marketing: yes</span>` : "", c.source === "enquiry" && !c.sessionCount ? `<span class="pill">Enquiry</span>` : ""].join("") }))) : empty({ icon: "user", title: search ? `No one matches “${search}”` : "No clients like that" })}
        ${me?.staff?.role === "admin" ? `<button type="button" class="btn wide" data-sync>${icon("refresh")} Sync with Acuity now</button>` : ""}`;
      box.querySelector("[data-client-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
      box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; N.show(); }));
      box.querySelector("[name=since]")?.addEventListener("change", (e) => { since = e.target.value; N.show(); });
      box.querySelector("[data-sync]")?.addEventListener("click", (e) => busy(e.currentTarget, "Syncing…", async () => { try { const x = await post(`${A}/sync`, {}); toast(x.message || "Synced with Acuity"); N.show(); } catch (err) { toast(err.message, true); } }));
    },
  });

  async function drawClient(box, id, ui) {
    ui.back("#clients");
    const r = await api(`${A}/${encodeURIComponent(id)}`);
    const c = r.client;
    if (!c) { box.innerHTML = empty({ icon: "user", title: "That client isn't there" }); return; }
    ui.title(c.name || "Client");
    const sessions = r.sessions || [];
    const now = new Date().toISOString();
    box.innerHTML = `<div class="card"><p class="kicker">${esc(c.source === "enquiry" ? "From an enquiry" : c.source || "Client")} · since ${esc(day(c.createdAt))}</p><h2 class="card-title">${esc(c.name || "")}</h2>
        <div class="facts">${[["Email", c.email], ["Phone", c.phone], ["Last booked", day(c.lastBooked)], ["Next booked", day(c.nextBooked)], ["Sessions", c.sessionCount], ["Owes", Number(c.outstanding) ? `£${c.outstanding}` : ""], ["Deposits paid", Number(c.depositsPaid) ? `£${c.depositsPaid}` : ""], ["Invoiced", Number(c.invoiced) ? `£${c.invoiced}` : ""]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
        ${c.notes ? `<p class="pre muted">${esc(c.notes)}</p>` : ""}</div>
      <div class="btns two">${c.phone ? `<a class="btn" href="tel:${esc(c.phone)}">${icon("phone")} Call</a><a class="btn" href="sms:${esc(c.phone)}">${icon("chat")} Text</a>` : ""}${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon("mail")} Email</a>` : ""}<a class="btn main" href="#money/new">${icon("plus")} New invoice</a></div>
      <label class="switch"><span>They've said yes to marketing</span><input type="checkbox" role="switch" data-consent${c.consent?.yes ? " checked" : ""}></label>
      ${c.consent?.yes ? `<p class="muted small">Yes from ${esc(c.consent.source || "")}${c.consent.at ? `, ${esc(day(c.consent.at))}` : ""}.</p>` : `<p class="muted small">No until they say yes: nothing marketing goes to them.</p>`}
      ${sessions.length ? `<h3 class="h">Sessions</h3>${list(sessions.slice(0, 30).map((s) => row({ icon: "calendar", title: s.session || "Session", text: [day(s.start), s.price ? `£${s.price}` : ""].filter(Boolean).join(" · "), end: s.status === "cancelled" ? `<span class="pill bad">Cancelled</span>` : s.start > now ? `<span class="pill ok">Coming up</span>` : "" })))}` : ""}
      ${(r.consentLog || []).length ? `<details class="card"><summary>Marketing history</summary>${list(r.consentLog.map((l) => row({ icon: "check", title: l.consent ? "Said yes" : "Said no", text: [l.source, day(l.at), l.byName].filter(Boolean).join(" · ") })))}</details>` : ""}
      <button type="button" class="btn wide" data-edit>${icon("edit")} Change their details</button>`;
    box.querySelector("[data-consent]").addEventListener("change", async (e) => {
      const yes = e.target.checked;
      let body = { yes, source: "Changed on Nova Phone" };
      if (yes) {
        const v = await sheetForm(`<h2 class="sheet-title">Where did their yes come from?</h2><form class="form" data-f>${field({ label: "Where", name: "source", placeholder: "Said yes in person, ticked on the booking form…" })}${field({ label: "When", name: "at", type: "date", value: today(), attrs: `max="${today()}"` })}<div class="btns"><button class="btn main wide" type="submit">Save their yes</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
          (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ yes: true, source: ev.target.elements.source.value.trim(), at: ev.target.elements.at.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
        if (!v || !v.source) { e.target.checked = false; if (v) toast("Say where their yes came from", true); return; }
        body = v;
      }
      try { await post(`${A}/${c.id}`, { consent: body }); toast(yes ? "Their yes is saved" : "Marketing is off for them"); N.show(); } catch (err) { e.target.checked = !yes; toast(err.message, true); }
    });
    box.querySelector("[data-edit]").addEventListener("click", async () => {
      const v = await sheetForm(`<h2 class="sheet-title">${esc(c.name || "Client")}</h2><form class="form" data-f>
          ${field({ label: "Name", name: "name", value: c.name || "" })}${field({ label: "Email", name: "email", type: "email", value: c.email || "" })}${field({ label: "Phone", name: "phone", type: "tel", value: c.phone || "" })}${field({ label: "Notes", name: "notes", type: "textarea", rows: 3, value: c.notes || "" })}
          <div class="two-up">${field({ label: "Deposits paid (£)", name: "depositsPaid", type: "number", value: c.depositsPaid || 0, attrs: 'step="0.01" min="0"' })}${field({ label: "Invoiced (£)", name: "invoiced", type: "number", value: c.invoiced || 0, attrs: 'step="0.01" min="0"' })}</div>
          ${field({ label: "Owes (£)", name: "outstanding", type: "number", value: c.outstanding || 0, attrs: 'step="0.01" min="0"' })}
          <div class="btns"><button class="btn main wide" type="submit">Save</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const x = ev.target.elements; done({ name: x.name.value.trim(), email: x.email.value.trim(), phone: x.phone.value.trim(), notes: x.notes.value, depositsPaid: x.depositsPaid.value, invoiced: x.invoiced.value, outstanding: x.outstanding.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      try { await post(`${A}/${c.id}`, v); toast("Saved"); N.show(); } catch (err) { toast(err.message, true); }
    });
  }

  function drawNew(box, ui) {
    ui.back("#clients");
    ui.title("Add a client");
    const picker = "contacts" in navigator && "select" in navigator.contacts;
    box.innerHTML = `${picker ? `<button type="button" class="btn wide" data-pick>${icon("user")} Choose from this phone's contacts</button>` : ""}
      <form class="form" id="cf" novalidate>${field({ label: "Name", name: "name", required: true, attrs: 'autocomplete="name"' })}${field({ label: "Email", name: "email", type: "email" })}${field({ label: "Phone", name: "phone", type: "tel", attrs: 'autocomplete="tel"' })}${field({ label: "Notes (optional)", name: "notes", type: "textarea", rows: 3 })}
      <p class="form-said" id="cf-said" role="status">Marketing stays off until they say yes.</p><button class="btn main wide" type="submit">${icon("check")} Add the client</button></form>`;
    const f = box.querySelector("#cf");
    box.querySelector("[data-pick]")?.addEventListener("click", async () => {
      try { const [p] = await navigator.contacts.select(["name", "email", "tel"], { multiple: false }); if (p) { f.elements.name.value = p.name?.[0] || ""; f.elements.email.value = p.email?.[0] || ""; f.elements.phone.value = p.tel?.[0] || ""; } } catch (e) { /* (closed without choosing) */ }
    });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, said = box.querySelector("#cf-said");
      if (!x.name.value.trim()) { said.textContent = "What's their name?"; said.classList.add("bad"); return; }
      await busy(f.querySelector("[type=submit]"), "Adding…", async () => {
        try { const r = await post(A, { name: x.name.value.trim(), email: x.email.value.trim(), phone: x.phone.value.trim(), notes: x.notes.value }); f.classList.remove("dirty"); toast("Client added"); location.hash = `#clients/${r.client?.id || r.id}`; }
        catch (err) { if (err.data?.id) { toast("They're already a client"); location.hash = `#clients/${err.data.id}`; } else { said.textContent = `Not added: ${err.message}`; said.classList.add("bad"); } }
      });
    });
  }
})();
