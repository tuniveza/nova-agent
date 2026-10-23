// Nova Phone: Money, everything Nova Desk's Invoicer and Portal → Money do, made for the phone.
//   Invoices   owed, overdue and this month; the list by where each invoice is (deposit, balance, overdue, paid,
//              to approve, removed), searchable; a new invoice from the studio's services
//   An invoice its stage (deposit due, balance due, overdue, paid receipt) with its PDF and email; approve and
//              email it, or approve to share it yourself; send a reminder or receipt for approval; record or take
//              back a payment; its look; change it; remove it; a test email to yourself; its history
//   Expenses   by month, with receipt photos; noted by Nova Agent ones to confirm
//   Tax year   in, out, by category; the accountant's files; the invoice settings (admins)
// Approving, rejecting, removing and the settings are for an admin signed in on this phone (as on Nova Desk).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, choose, form: sheetForm, busy, money, ago, initials, today } = N;
  const A = "/app/api/money";
  const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
  const STATUS = { draft: "Draft", pending_approval: "To approve", approved: "Approved", rejected: "Rejected", failed: "Didn't send", sent: "Sent", part_paid: "Part paid", paid: "Paid", void: "Removed" };
  const WAITING = ["draft", "pending_approval", "approved", "rejected", "failed"];
  const STAGES = [["deposit", "Deposit due"], ["balance", "Balance due"], ["overdue", "Overdue"], ["paid", "Paid receipt"]];
  const stageOf = (i) => (i.paidPence >= i.totalPence || i.status === "paid" ? "paid" : ["sent", "part_paid"].includes(i.status) && i.dueDate < today() ? "overdue" : i.paidPence > 0 || i.billing === "full" ? "balance" : "deposit");
  const FILTERS = [["all", "All"], ["deposit", "Deposit"], ["balance", "Balance"], ["overdue", "Overdue"], ["paid", "Paid"], ["approve", "To approve"], ["void", "Removed"]];
  const pounds = (p) => ((Number(p) || 0) / 100).toFixed(2);
  let data = null, catalogue = null, filter = "all", search = "";
  async function load() { data = await api(`${A}?status=all`); return data; }
  const chip = (i) => (i.status === "void" ? `<span class="pill">Removed</span>` : WAITING.includes(i.status) ? `<span class="pill ${i.status === "failed" || i.status === "rejected" ? "bad" : "warn"}">${STATUS[i.status]}</span>` : `<span class="pill ${stageOf(i) === "overdue" ? "bad" : stageOf(i) === "paid" ? "ok" : ""}">${(STAGES.find(([s]) => s === stageOf(i)) || [, ""])[1]}</span>`);
  const invRow = (i) => row({ href: `#money/invoice/${i.id}`, lead: `<span class="av">${esc(initials(i.billTo?.name))}</span>`, title: i.billTo?.name || "", text: `${i.number} · ${day(i.issueDate)}`, end: `<b>${money(i.totalPence)}</b>${chip(i)}` });
  const PARTS = [["invoices", "Invoices"], ["expenses", "Expenses"], ["tax", "Tax year"]];
  const partTabs = (on) => `<div class="seg">${PARTS.map(([p, l]) => `<a class="seg-a" href="#money${p === "invoices" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;

  N.section({
    id: "money",
    name: "Money",
    tile: "invoicer",
    async draw(box, [part, a, b], ui) {
      await load();
      if (part === "invoice") return drawInvoice(box, a, ui);
      if (part === "new") return drawForm(box, null, ui);
      if (part === "edit") return drawForm(box, data.invoices.find((i) => String(i.id) === a), ui);
      if (part === "expenses") return drawExpenses(box, ui);
      if (part === "expense") return drawExpenseForm(box, a, ui);
      if (part === "tax") return drawTax(box, ui);
      if (part === "settings") return drawSettings(box, ui);
      return drawList(box, ui);
    },
  });

  // ---- The invoices ----
  function drawList(box, ui) {
    ui.action({ icon: "plus", label: "New invoice", href: "#money/new" });
    const s = data.summary || {};
    const q = search.toLowerCase();
    const shown = (data.invoices || []).filter((i) => {
      if (q && !`${i.number} ${i.billTo?.name}`.toLowerCase().includes(q)) return false;
      if (filter === "void") return i.status === "void";
      if (i.status === "void") return false;
      if (filter === "approve") return WAITING.includes(i.status) || (data.reminders || []).some((r) => r.invoiceId === i.id && r.status === "pending");
      if (["deposit", "balance", "overdue", "paid"].includes(filter)) return !WAITING.includes(i.status) && stageOf(i) === filter;
      return true;
    });
    box.innerHTML = `${partTabs("invoices")}
      <div class="sums"><button type="button" class="sum" data-f="all"><b>${money(s.owed?.pence)}</b><span>Owed</span></button><button type="button" class="sum${s.overdue?.count ? " bad" : ""}" data-f="overdue"><b>${money(s.overdue?.pence)}</b><span>Overdue · ${s.overdue?.count || 0}</span></button><button type="button" class="sum" data-f="paid"><b>${money(s.month?.inPence)}</b><span>In this month</span></button></div>
      <div class="chips">${FILTERS.map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${l}</button>`).join("")}</div>
      <form class="search" data-money-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search artist or number"></label></form>
      ${shown.length ? list(shown.map(invRow)) : empty({ icon: "money", title: (data.invoices || []).length ? "None like that" : "No invoices yet", action: `<a class="btn main" href="#money/new">${icon("plus")} Write the first one</a>` })}`;
    box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; N.show(); }));
    box.querySelector("[data-money-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
  }

  // ---- One invoice ----
  async function drawInvoice(box, id, ui) {
    ui.back("#money");
    const [r, st] = await Promise.all([api(`${A}/invoices/${encodeURIComponent(id)}`), api(`${A}/invoices/${encodeURIComponent(id)}/stage`).catch(() => null)]);
    const i = r.invoice;
    if (!i) { box.innerHTML = empty({ icon: "money", title: "That invoice isn't there" }); return; }
    ui.title(i.number);
    const stage = st?.stage || stageOf(i);
    const can = !!data.canDecide;
    const pendingRem = (r.reminders || []).filter((x) => x.status === "pending");
    const waiting = WAITING.includes(i.status);
    const pdf = (s) => `${A}/invoices/${encodeURIComponent(i.id)}/pdf?stage=${s}`;
    box.innerHTML = `<div class="card"><p class="kicker">${esc(i.number)} · ${esc(STATUS[i.status] || i.status)}${i.overdue && !waiting ? " · overdue" : ""}</p><h2 class="card-title">${esc(i.billTo?.name || "")}</h2>
        <p class="muted small">${[i.billTo?.email, `Issued ${day(i.issueDate)}`, i.dueDate ? `${i.billing === "full" ? "due" : "balance due"} ${day(i.dueDate)}` : ""].filter(Boolean).map(esc).join(" · ")}</p>
        <ul class="lines">${(i.lines || []).map((l) => `<li class="line"><span>${esc(l.description)}${l.qty !== 1 ? ` <span class="muted">× ${esc(l.qty)}</span>` : ""}</span><span>${money(l.totalPence)}</span></li>`).join("")}
          ${i.vatPence ? `<li class="line"><span class="muted">VAT ${esc(i.vatRate)}%</span><span>${money(i.vatPence)}</span></li>` : ""}
          <li class="line total"><span>Total</span><span>${money(i.totalPence)}</span></li>
          ${i.paidPence ? `<li class="line"><span>Paid</span><span>${money(i.paidPence)}</span></li><li class="line total"><span>Left to pay</span><span>${money(i.balancePence)}</span></li>` : ""}</ul>
        ${i.notes ? `<p class="pre muted small">${esc(i.notes)}</p>` : ""}${i.error ? `<p class="bad small">${esc(i.error)}</p>` : ""}</div>
      <fieldset class="field"><legend>Show it as</legend><div class="seg">${STAGES.map(([s, l]) => `<label><input type="radio" name="stage" value="${s}"${s === stage ? " checked" : ""}>${l.replace(" due", "").replace(" receipt", "")}</label>`).join("")}</div></fieldset>
      <div class="btns two"><a class="btn main" id="pdf" href="${pdf(stage)}" target="_blank" rel="noopener">${icon("pdf")} PDF</a><button type="button" class="btn" data-do="share"${i.status === "void" ? " disabled" : ""}>${icon("share")} Share</button></div>
      ${waiting && can ? `<div class="btns two"><button type="button" class="btn main" data-do="approve">${icon("send")} Approve &amp; email</button><button type="button" class="btn danger" data-do="reject">Reject</button></div>` : waiting ? `<p class="muted small">Waiting for an admin to approve it.</p>` : ""}
      ${pendingRem.map((x) => `<div class="card"><p class="kicker">${x.kind === "receipt" ? "Receipt" : "Reminder"} waiting for approval</p><p class="pre small">${esc(x.body)}</p>${can ? `<div class="btns two"><button type="button" class="btn main" data-rem="approve" data-id="${x.id}">Approve &amp; email</button><button type="button" class="btn danger" data-rem="reject" data-id="${x.id}">Reject</button></div>` : `<p class="muted small">An admin approves it.</p>`}</div>`).join("")}
      <div class="btns two">
        ${["sent", "part_paid"].includes(i.status) ? `<button type="button" class="btn" data-do="pay">${icon("money")} Record a payment</button>` : ""}
        ${!waiting && i.status !== "void" && !pendingRem.length ? `<button type="button" class="btn" data-do="remind">${icon("mail")} ${stage === "paid" ? "Send the receipt" : "Send a reminder"}</button>` : ""}
        ${!["paid", "void"].includes(i.status) ? `<a class="btn" href="#money/edit/${i.id}">${icon("edit")} Change it</a>` : ""}
        <button type="button" class="btn" data-do="look">The look</button>
        <button type="button" class="btn" data-do="history">${icon("clock")} History</button>
        ${can ? `<button type="button" class="btn" data-do="test">Send me a test</button>` : ""}
      </div>
      ${can && i.status !== "void" && !i.paidPence ? `<button type="button" class="btn danger wide" data-do="void">${icon("trash")} Remove this invoice</button>` : ""}`;
    box.querySelectorAll("[name=stage]").forEach((r_) => r_.addEventListener("change", () => (box.querySelector("#pdf").href = pdf(r_.value))));
    const chosen = () => box.querySelector("[name=stage]:checked")?.value || stage;
    const done = async (word) => { toast(word); await load(); await drawInvoice(box, id, ui); };
    const go = async (fn, word) => { try { await fn(); await done(word); } catch (err) { toast(err.message, true); } };
    box.querySelectorAll("[data-do]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.do;
      if (what === "approve") { if (!i.billTo?.email) return toast("Add their email first (Change it), so it can be emailed.", true); if (await confirm({ title: `Email ${i.number} to ${i.billTo.name}?`, text: i.billTo.email, ok: "Approve & email" })) await busy(b, "Sending…", () => go(() => post(`${A}/invoices/${i.id}/approve`, {}), "Approved and emailed")); }
      if (what === "reject") { const note = await ask("Reject it", "Why (optional)", ""); if (note !== null) await go(() => post(`${A}/invoices/${i.id}/reject`, { note }), "Rejected"); }
      if (what === "void") { if (await confirm({ title: `Remove ${i.number}?`, text: "It stays in the records as removed.", ok: "Remove", danger: true })) await go(() => post(`${A}/invoices/${i.id}/void`, {}), "Removed"); }
      if (what === "pay") await payment(i, done);
      if (what === "remind") await reminder(i, chosen(), done);
      if (what === "look") await look(i, done);
      if (what === "history") history(i, r, can, done);
      if (what === "share") await share(i, can, done);
      if (what === "test") { const s2 = await api(`${A}/invoices/${i.id}/stage?stage=${chosen()}`).catch(() => null); await busy(b, "Sending…", async () => { try { const x = await post(`${A}/invoices/test-send`, { id: i.id, stage: chosen(), body: s2?.email?.body || "" }); toast(`Test sent to ${x.to || "you"}`); } catch (err) { toast(err.message, true); } }); }
    }));
    box.querySelectorAll("[data-rem]").forEach((b) => b.addEventListener("click", async () => {
      const how = b.dataset.rem;
      if (!(await confirm({ title: how === "approve" ? "Email it to them?" : "Reject it?", ok: how === "approve" ? "Approve & email" : "Reject", danger: how === "reject" }))) return;
      await go(() => post(`${A}/reminders/${b.dataset.id}/${how}`, {}), how === "approve" ? "Emailed" : "Rejected");
    }));
  }
  // A question in a sheet: one box of words
  const ask = (title, label, value, rows = 3) => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${field({ label, name: "v", type: "textarea", rows, value })}<div class="btns"><button class="btn main wide" type="submit">OK</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.v.value); }; el.querySelector("[data-no]").onclick = () => done(null); });
  async function payment(i, done) {
    const v = await sheetForm(`<h2 class="sheet-title">Record a payment</h2><form class="form" data-f>
        ${field({ label: "Amount (£)", name: "amount", type: "number", value: pounds(i.balancePence), attrs: 'step="0.01" min="0.01"' })}
        ${field({ label: "Paid on", name: "paidOn", type: "date", value: today(), attrs: `max="${today()}"` })}
        ${field({ label: "How", name: "method", type: "select", value: "bank", options: (data.methods || []).map((m) => [m.id, m.name]) })}
        ${field({ label: "Note (optional)", name: "note" })}
        <div class="btns"><button class="btn main wide" type="submit">Record it</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, d) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const x = ev.target.elements; d({ amount: x.amount.value, paidOn: x.paidOn.value, method: x.method.value, note: x.note.value.trim() }); }; el.querySelector("[data-no]").onclick = () => d(null); });
    if (!v) return;
    try { await post(`${A}/invoices/${i.id}/payments`, v); await done("Payment recorded"); } catch (err) { toast(err.message, true); }
  }
  async function reminder(i, stage, done) {
    const s = await api(`${A}/invoices/${i.id}/stage?stage=${stage}`).catch(() => null);
    const kind = stage === "paid" ? "receipt" : "reminder";
    const body = await ask(kind === "receipt" ? "The receipt email" : "The reminder email", "What it says (an admin approves it before it goes)", s?.email?.body || "", 10);
    if (body === null) return;
    try { await post(`${A}/invoices/${i.id}/reminder`, { body, kind }); await done("Sent for approval"); } catch (err) { toast(err.message, true); }
  }
  async function look(i, done) {
    catalogue ||= await api(`${A}/catalogue`);
    const cur = { theme: i.look?.theme || catalogue.theme, mode: i.look?.mode || catalogue.mode, paper: i.look?.paper || catalogue.paper };
    const v = await sheetForm(`<h2 class="sheet-title">The look</h2><form class="form" data-f>
        ${field({ label: "Colour", name: "theme", type: "select", value: cur.theme, options: (catalogue.themes || []).map((t) => [t.id, t.name]) })}
        ${field({ label: "Light or dark", name: "mode", type: "select", value: cur.mode, options: (catalogue.modes || ["bright", "dark"]).map((m) => [m.id || m, (m.name || m).replace(/^./, (c) => c.toUpperCase())]) })}
        ${field({ label: "Paper", name: "paper", type: "select", value: cur.paper, options: (catalogue.papers || []).map((p) => [p.id, p.name]) })}
        <div class="btns"><button class="btn main wide" type="submit" value="one">Use for this invoice</button>${data.canDecide ? `<button class="btn wide" type="submit" value="all">Use for all invoices</button>` : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, d) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const x = ev.target.elements; d({ how: ev.submitter?.value, theme: x.theme.value, mode: x.mode.value, paper: x.paper.value }); }; el.querySelector("[data-no]").onclick = () => d(null); });
    if (!v) return;
    try {
      if (v.how === "all") await post(`${A}/settings`, { invoiceTheme: v.theme, invoiceMode: v.mode, invoicePaper: v.paper });
      await post(`${A}/invoices/${i.id}/look`, { look: { theme: v.theme, mode: v.mode, paper: v.paper } });
      await done("Saved");
    } catch (err) { toast(err.message, true); }
  }
  function history(i, r, can, done) {
    const facts = [["Billed to", i.billTo?.name], ["Goes to", i.billTo?.email], ["Total", money(i.totalPence)], ["Paid", money(i.paidPence)], ["Left to pay", money(i.balancePence)], ["Issued", day(i.issueDate)], ["Due", day(i.dueDate)], ["Sent", i.sentAt ? day(i.sentAt) : ""], [i.status === "rejected" ? "Rejected by" : "Approved by", i.decidedByName]].filter(([, v]) => v);
    sheetForm(`<h2 class="sheet-title">${esc(i.number)}'s history</h2>
      <div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      ${(r.payments || []).length ? `<h3 class="h">Payments</h3>${list(r.payments.map((p) => row({ icon: "money", title: `${money(p.amountPence)} · ${p.methodName || p.method}`, text: [day(p.paidOn), p.note, p.byName, p.removed ? "Taken back" : ""].filter(Boolean).join(" · "), end: can && !p.removed && p.method !== "stripe" ? `<button type="button" class="btn quiet" data-takeback="${p.id}">Take back</button>` : "" })))}` : ""}
      ${(r.reminders || []).length ? `<h3 class="h">Reminders and receipts</h3>${list(r.reminders.map((x) => row({ icon: "mail", title: `${x.kind === "receipt" ? "Receipt" : "Reminder"} · ${x.status}`, text: [ago(x.createdAt), x.decidedByName, x.error].filter(Boolean).join(" · ") })))}` : ""}
      ${(r.log || []).length ? `<h3 class="h">What happened</h3>${list(r.log.slice(0, 20).map((l) => row({ icon: "clock", title: l.detail || l.event, text: [ago(l.at), l.byName].filter(Boolean).join(" · ") })))}` : ""}
      <button type="button" class="btn quiet wide" data-no>Close</button>`,
      (el, d) => {
        el.querySelector("[data-no]").onclick = () => d(null);
        el.querySelectorAll("[data-takeback]").forEach((b) => (b.onclick = async () => { d(null); if (await confirm({ title: "Take this payment back?", ok: "Take it back", danger: true })) { try { await post(`${A}/payments/${b.dataset.takeback}/remove`, {}); await done("Taken back"); } catch (err) { toast(err.message, true); } } }));
      });
  }
  // Share it yourself: on WhatsApp, a text, an email, or anything the phone's share sheet offers
  async function share(i, can, done) {
    if (!i.pageUrl) {
      if (!can) return toast("An admin approves it first.", true);
      if (!(await confirm({ title: "Approve it to share yourself?", text: "Nothing is emailed: you send it.", ok: "Approve to share" }))) return;
      try { await post(`${A}/invoices/${i.id}/approve`, { byHand: true }); await load(); i = data.invoices.find((x) => x.id === i.id) || i; } catch (err) { return toast(err.message, true); }
    }
    const first = String(i.billTo?.name || "").split(/\s+/)[0];
    const text = `Hi ${first}, here's your invoice ${i.number} for ${money(i.balancePence || i.totalPence)}: ${i.pageUrl}${i.monzoUrl ? `\nPay with Monzo: ${i.monzoUrl}` : ""}`;
    const how = await choose({ title: `Share ${i.number}`, options: [...(navigator.share ? [["sheet", "Share…"]] : []), ["whatsapp", "WhatsApp"], ["sms", "Text message"], ["email", "Email"], ["copy", "Copy the message"], ["link", "Copy the link"]] });
    if (!how) return;
    const enc = encodeURIComponent(text);
    if (how === "sheet") await navigator.share({ title: `Invoice ${i.number}`, text }).catch(() => {});
    if (how === "whatsapp") location.href = `https://wa.me/?text=${enc}`;
    if (how === "sms") location.href = `sms:?&body=${enc}`;
    if (how === "email") location.href = `mailto:${encodeURIComponent(i.billTo?.email || "")}?subject=${encodeURIComponent(`Invoice ${i.number}`)}&body=${enc}`;
    if (how === "copy" || how === "link") { try { await navigator.clipboard.writeText(how === "copy" ? text : i.pageUrl); toast("Copied"); } catch (e) { toast("Couldn't copy", true); } }
    if (!can) return;
    await done("Ready to share");
  }

  // ---- A new invoice, or changing one ----
  async function drawForm(box, inv, ui) {
    ui.back(inv ? `#money/invoice/${inv.id}` : "#money");
    ui.title(inv ? `Change ${inv.number}` : "New invoice");
    catalogue ||= await api(`${A}/catalogue`).catch(() => ({ services: [] }));
    const clients = await api("/app/api/clients?filter=all").then((r) => r.clients || [], () => []);
    let lines = (inv?.lines || []).map((l) => ({ description: l.description, qty: l.qty, unit: pounds(l.unitPence) }));
    const due = (b) => { const d = new Date(); d.setDate(d.getDate() + (b === "full" ? Number(data.settings?.dueDays ?? 14) : 0)); return N.localStamp(d).slice(0, 10); };
    box.innerHTML = `<form class="form" id="inv" novalidate>
        <label class="field"><span>Artist</span><input class="input" name="billName" list="clients" value="${esc(inv?.billTo?.name || "")}" autocomplete="off" required placeholder="Who it's to"><datalist id="clients">${clients.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist></label>
        ${field({ label: "Their email", name: "billEmail", type: "email", value: inv?.billTo?.email || "" })}
        <fieldset class="field"><legend>When it's paid</legend><div class="seg"><label><input type="radio" name="billing" value="deposit"${inv?.billing !== "full" ? " checked" : ""}>Before: a deposit</label><label><input type="radio" name="billing" value="full"${inv?.billing === "full" ? " checked" : ""}>After: in full</label></div></fieldset>
        <h3 class="h">What it's for</h3><div id="lines"></div>
        <div class="btns two"><button type="button" class="btn" data-add="service">${icon("plus")} A service</button><button type="button" class="btn" data-add="other">${icon("plus")} Something else</button></div>
        <div class="card"><ul class="lines" id="sums"></ul></div>
        <div class="two-up">${field({ label: "Issued", name: "issueDate", type: "date", value: inv?.issueDate || today() })}${field({ label: "Due", name: "dueDate", type: "date", value: inv?.dueDate || due(inv?.billing) })}</div>
        ${field({ label: "Note (optional)", name: "notes", type: "textarea", rows: 3, value: inv?.notes || "", attrs: 'maxlength="800"' })}
        <p class="form-said" id="inv-said" role="status"></p>
        <div class="btns"><button class="btn main wide" type="submit">${icon("check")} ${inv ? "Save changes" : "Make the invoice"}</button><button type="button" class="btn wide" data-preview>${icon("pdf")} See the PDF first</button></div>
        ${inv && !WAITING.includes(inv.status) ? `<p class="muted small">Changing a sent invoice sends it back for approval.</p>` : ""}
      </form>`;
    const f = box.querySelector("#inv");
    const vat = Number(data.settings?.vatRate || 0);
    const draw = () => {
      box.querySelector("#lines").innerHTML = lines.length ? lines.map((l, n) => `<div class="card line-edit"><div class="form">${field({ label: "What", name: `d${n}`, value: l.description })}<div class="two-up">${field({ label: "How many", name: `q${n}`, type: "number", value: l.qty, attrs: 'min="1" step="1"' })}${field({ label: "Price of one (£)", name: `u${n}`, type: "number", value: l.unit, attrs: 'min="0" step="0.01"' })}</div><button type="button" class="btn quiet" data-del-line="${n}">${icon("trash")} Remove this line</button></div></div>`).join("") : `<p class="muted add-line">No lines yet: add a service or something else.</p>`;
      sums();
    };
    const sums = () => {
      const sub = lines.reduce((t, l) => t + Math.round((Number(l.unit) || 0) * 100) * (Number(l.qty) || 0), 0);
      const v = Math.round((sub * vat) / 100);
      const billing = f.querySelector("[name=billing]:checked")?.value;
      box.querySelector("#sums").innerHTML = `${vat ? `<li class="line"><span class="muted">VAT ${vat}%</span><span>${money(v)}</span></li>` : ""}<li class="line total"><span>Total</span><span>${money(sub + v)}</span></li>${billing === "deposit" ? `<li class="line"><span class="muted">Deposit (${catalogue.depositPercent || 50}%)</span><span>${money(Math.round(((sub + v) * (catalogue.depositPercent || 50)) / 100))}</span></li>` : ""}`;
    };
    f.addEventListener("input", (e) => {
      const m = e.target.name?.match(/^([dqu])(\d+)$/);
      if (m) { const l = lines[Number(m[2])]; if (m[1] === "d") l.description = e.target.value; if (m[1] === "q") l.qty = e.target.value; if (m[1] === "u") l.unit = e.target.value; sums(); }
      if (e.target.name === "billName") { const c = clients.find((x) => x.name === e.target.value); if (c && c.email && !f.elements.billEmail.value) f.elements.billEmail.value = c.email; }
    });
    f.addEventListener("change", (e) => { if (e.target.name === "billing") { f.elements.dueDate.value = due(e.target.value); sums(); } });
    box.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del-line]");
      if (del) { lines.splice(Number(del.dataset.delLine), 1); draw(); return; }
      const add = e.target.closest("[data-add]");
      if (!add) return;
      if (add.dataset.add === "other") { lines.push({ description: "", qty: 1, unit: "" }); draw(); return; }
      const svc = catalogue.services || [];
      const pick = await choose({ title: "Add a service", options: svc.map((s) => [s.id, `${s.name} · ${s.from ? "from " : ""}${money(s.pricePence)}`]) });
      const s = svc.find((x) => String(x.id) === String(pick));
      if (s) { lines.push({ description: s.name, qty: 1, unit: pounds(s.pricePence) }); draw(); }
    });
    const body = () => { const x = f.elements; return { billName: x.billName.value.trim(), billEmail: x.billEmail.value.trim(), billing: f.querySelector("[name=billing]:checked").value, lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })), issueDate: x.issueDate.value, dueDate: x.dueDate.value, notes: x.notes.value, ...(clients.find((c) => c.name === x.billName.value) ? { clientId: clients.find((c) => c.name === x.billName.value).id } : {}) }; };
    box.querySelector("[data-preview]").addEventListener("click", (e) => busy(e.currentTarget, "Making the PDF…", async () => {
      try {
        const res = await fetch(`${A}/invoices/preview/pdf`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `It didn't make (${res.status})`);
        const url = URL.createObjectURL(await res.blob());
        window.open(url, "_blank") || (location.href = url);
      } catch (err) { toast(err.message, true); }
    }));
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const said = box.querySelector("#inv-said"), b = body();
      if (!b.billName) { said.textContent = "Who's it to?"; said.classList.add("bad"); return; }
      if (!b.lines.length || b.lines.some((l) => !l.description || l.unit === "")) { said.textContent = "Every line needs what it's for and a price."; said.classList.add("bad"); return; }
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          const r = await post(inv ? `${A}/invoices/${inv.id}/edit` : `${A}/invoices`, b);
          f.classList.remove("dirty");
          toast(inv ? "Saved: it goes for approval again" : "Invoice made: an admin approves it before it's sent");
          location.hash = `#money/invoice/${(r.invoice || inv).id}`;
        } catch (err) { said.textContent = `Not saved: ${err.message}`; said.classList.add("bad"); }
      });
    });
    draw();
  }

  // ---- Expenses ----
  function drawExpenses(box, ui) {
    ui.action({ icon: "plus", label: "Add an expense", href: "#money/expense/new" });
    const ex = data.expenses || [];
    const toConfirm = ex.filter((e) => e.status === "unconfirmed" || e.status === "pending");
    const rest = ex.filter((e) => !toConfirm.includes(e));
    const months = [...new Set(rest.map((e) => e.spentOn.slice(0, 7)))];
    const exRow = (e) => row({ href: `#money/expense/${e.id}`, icon: "money", title: `${money(e.amountPence)} · ${e.category}`, text: [day(e.spentOn), e.supplier, e.note].filter(Boolean).join(" · "), end: e.receiptId ? `<span class="pill">Receipt</span>` : "" });
    box.innerHTML = `${partTabs("expenses")}
      ${toConfirm.length ? `<h3 class="h">To confirm (noted by Nova Agent)</h3>${list(toConfirm.map(exRow))}` : ""}
      ${months.length ? months.map((m) => { const these = rest.filter((e) => e.spentOn.startsWith(m)); return `<h3 class="h">${esc(new Date(`${m}-15`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }))} · ${money(these.reduce((t, e) => t + e.amountPence, 0))}</h3>${list(these.map(exRow))}`; }).join("") : empty({ icon: "money", title: "No expenses yet", action: `<a class="btn main" href="#money/expense/new">${icon("plus")} Add one</a>` })}`;
  }
  function drawExpenseForm(box, id, ui) {
    ui.back("#money/expenses");
    const e = id === "new" ? null : (data.expenses || []).find((x) => String(x.id) === id);
    ui.title(e ? "Expense" : "Add an expense");
    box.innerHTML = `<form class="form" id="exf" novalidate>
        ${field({ label: "Amount (£)", name: "amount", type: "number", value: e ? pounds(e.amountPence) : "", attrs: 'step="0.01" min="0.01"', required: true })}
        ${field({ label: "What for", name: "category", type: "select", value: e?.category || "Other", options: (data.categories || ["Other"]).map((c) => [c, c]) })}
        ${field({ label: "Paid to", name: "supplier", value: e?.supplier || "" })}
        ${field({ label: "Day", name: "spentOn", type: "date", value: e?.spentOn || today(), attrs: `max="${today()}"` })}
        ${field({ label: "Note (optional)", name: "note", value: e?.note || "" })}
        <label class="field"><span>Receipt (a photo or PDF)</span><input class="input file" type="file" name="receipt" accept="image/*,application/pdf"></label>
        ${e?.receiptId ? `<a class="btn" href="/receipts/${esc(e.receiptId)}" target="_blank" rel="noopener">See the receipt</a>` : ""}
        <p class="form-said" id="ex-said" role="status"></p>
        <button class="btn main wide" type="submit">${icon("check")} ${e ? "Save" : "Add it"}</button>
        ${e && (e.status === "unconfirmed" || e.status === "pending") ? `<button type="button" class="btn wide" data-ex="confirm">${icon("check")} Confirm it</button>` : ""}
        ${e ? `<button type="button" class="btn danger wide" data-ex="delete">${icon("trash")} Remove</button>` : ""}
      </form>`;
    const f = box.querySelector("#exf");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, said = box.querySelector("#ex-said");
      if (!x.amount.value) { said.textContent = "How much was it?"; said.classList.add("bad"); return; }
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          let receiptId;
          const file = x.receipt.files?.[0];
          if (file) {
            const res = await fetch("/actions/receipts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": file.type || "application/octet-stream", "X-Nova-Visualizer": "1" }, body: file });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.receipt) throw new Error(res.status === 503 ? "The receipt couldn't be kept: the studio's computer is off. Add it without the receipt, or try later." : d.message || d.error || "The receipt didn't upload");
            receiptId = d.receipt.id;
          }
          const body = { amount: x.amount.value, category: x.category.value, supplier: x.supplier.value.trim(), spentOn: x.spentOn.value, note: x.note.value.trim(), ...(receiptId ? { receiptId } : {}) };
          await post(e ? `${A}/expenses/${e.id}/edit` : `${A}/expenses`, body);
          f.classList.remove("dirty");
          toast(e ? "Saved" : "Expense added");
          location.hash = "#money/expenses";
        } catch (err) { said.textContent = `Not saved: ${err.message}`; said.classList.add("bad"); }
      });
    });
    box.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.ex;
      if (what === "delete" && !(await confirm({ title: `Remove this ${money(e.amountPence)} expense?`, ok: "Remove", danger: true }))) return;
      try { await post(`${A}/expenses/${e.id}/${what}`, {}); toast(what === "delete" ? "Removed" : "Confirmed"); location.hash = "#money/expenses"; } catch (err) { toast(err.message, true); }
    }));
  }

  // ---- The tax year ----
  function drawTax(box, ui) {
    const t = data.summary?.taxYear || {};
    const cats = t.outByCategory || [];
    const most = Math.max(1, ...cats.map((c) => c.pence));
    const can = !!data.canDecide;
    const csv = (what) => `${A}/export.csv?what=${what}&from=${t.from || ""}&to=${t.to || ""}`;
    const s = data.settings || {};
    box.innerHTML = `${partTabs("tax")}
      <p class="lead">Tax year ${esc(t.name || "")}</p>
      <div class="sums"><div class="sum"><b>${money(t.inPence)}</b><span>In</span></div><div class="sum"><b>${money(t.outPence)}</b><span>Out</span></div><div class="sum"><b>${money((t.inPence || 0) - (t.outPence || 0))}</b><span>Difference</span></div></div>
      ${cats.length ? `<h3 class="h">Where the money went</h3><div class="card bars">${cats.map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><b>${money(c.pence)}</b><i class="bar" data-w="${Math.round((c.pence / most) * 100)}"></i></div>`).join("")}</div>` : ""}
      ${can ? `<h3 class="h">For the accountant</h3><div class="btns two"><a class="btn" href="${csv("invoices")}">Invoices (CSV)</a><a class="btn" href="${csv("payments")}">Payments (CSV)</a><a class="btn" href="${csv("expenses")}">Expenses (CSV)</a></div>` : ""}
      <h3 class="h">Invoice settings</h3>
      <div class="card"><div class="facts">${[["Emailing invoices", data.emailReady ? "Ready" : "Not set up"], ["Pay by card", data.cardReady ? "Ready" : "Not set up"], ["Bank details", s.bankReady ? "Added" : "Not added"], ["Pay with Monzo", s.monzoReady ? "Added" : "Not added"], ["VAT", `${s.vatRate || 0}%`], ["Days to pay", s.dueDays ?? ""]].map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      ${can ? `<a class="btn wide" href="#money/settings">${icon("cog")} Change the invoice settings</a>` : ""}`;
    box.querySelectorAll(".bar[data-w]").forEach((b) => b.style.setProperty("width", `${b.dataset.w}%`));
  }
  function drawSettings(box, ui) {
    ui.back("#money/tax");
    ui.title("Invoice settings");
    const s = data.settings || {}, b = s.business || {}, k = s.bank || {}, m = s.monzo || {};
    box.innerHTML = `<form class="form" id="set" novalidate>
        <h3 class="h">The studio</h3>
        ${field({ label: "Studio name", name: "name", value: b.name || "" })}${field({ label: "Address", name: "address", type: "textarea", rows: 3, value: b.address || "" })}
        ${field({ label: "Email for replies", name: "email", type: "email", value: b.email || "" })}${field({ label: "Phone", name: "phone", value: b.phone || "" })}${field({ label: "Website", name: "website", value: b.website || "" })}
        <h3 class="h">How clients pay</h3>
        ${field({ label: "Account name", name: "accountName", value: k.accountName || "" })}<div class="two-up">${field({ label: "Sort code", name: "sortCode", value: k.sortCode || "", attrs: 'inputmode="numeric"' })}${field({ label: "Account number", name: "accountNumber", value: k.accountNumber || "", attrs: 'inputmode="numeric"' })}</div>
        ${field({ label: "Bank note (optional)", name: "bankNote", value: k.note || "" })}${field({ label: "Monzo link", name: "monzo", value: m.link || "", placeholder: "monzo.me/novacane" })}
        <h3 class="h">Tax and terms</h3>
        <div class="two-up">${field({ label: "VAT %", name: "vatRate", type: "number", value: s.vatRate ?? 0, attrs: 'min="0" max="100" step="0.01"' })}${field({ label: "Days to pay", name: "dueDays", type: "number", value: s.dueDays ?? 14, attrs: 'min="0" max="120"' })}</div>
        ${field({ label: "VAT number (optional)", name: "vatNumber", value: b.vatNumber || "" })}
        <p class="form-said" id="set-said" role="status"></p>
        <button class="btn main wide" type="submit">${icon("check")} Save</button></form>`;
    const f = box.querySelector("#set");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements;
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          await post(`${A}/settings`, { business: { name: x.name.value, address: x.address.value, email: x.email.value, phone: x.phone.value, website: x.website.value, vatNumber: x.vatNumber.value }, bank: { accountName: x.accountName.value, sortCode: x.sortCode.value, accountNumber: x.accountNumber.value, note: x.bankNote.value }, monzo: { link: x.monzo.value }, vatRate: x.vatRate.value, dueDays: Number(x.dueDays.value) });
          f.classList.remove("dirty"); toast("Saved"); location.hash = "#money/tax";
        } catch (err) { const said = box.querySelector("#set-said"); said.textContent = err.message; said.classList.add("bad"); }
      });
    });
  }
})();
