// Nova on a phone: Money. The invoices, by where they are (waiting, open, overdue, all), and each one's page:
// who it's to, what for, what's paid and owed, its PDF, and the Invoicer for doing anything with it (all
// invoice work happens in the Invoicer, the suite's rule: here it opens set up for that invoice).
(() => {
  "use strict";
  const { section, api, esc, icon, computerLink } = window.NovaPhone;
  const A = "/app/api/money";
  const money = (p) => `£${((p || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
  const STATUS = { draft: "Draft", pending_approval: "Waiting for approval", sent: "Sent", part_paid: "Part paid", paid: "Paid", void: "Void", rejected: "Rejected" };
  const statusOf = (i) => (i.overdue && ["sent", "part_paid"].includes(i.status) ? "Overdue" : STATUS[i.status] || i.status);
  const FILTERS = [["open", "Open"], ["overdue", "Overdue"], ["waiting", "Waiting"], ["all", "All"]];
  // The Invoicer, in the computer version, set up for the job (shared/invoicer-link.js's addresses)
  const invoicer = (what) => computerLink(`/invoicer/?${new URLSearchParams(what)}`);

  section({
    id: "money",
    name: "Money",
    async draw(page, [what, a]) {
      if (what === "invoice") return drawInvoice(page, a);
      const which = FILTERS.some(([f]) => f === what) ? what : "open";
      const r = await api(`${A}?status=${which}`);
      const s = r.summary || {};
      const list = r.invoices || [];
      page.innerHTML = `<div class="sums">
          <div class="sum"><small>Owed</small><strong>${money(s.owed?.pence)}</strong><small>${s.owed?.count || 0} invoice${s.owed?.count === 1 ? "" : "s"}</small></div>
          <div class="sum${s.overdue?.count ? " bad" : ""}"><small>Overdue</small><strong>${money(s.overdue?.pence)}</strong><small>${s.overdue?.count || 0} invoice${s.overdue?.count === 1 ? "" : "s"}</small></div>
          <div class="sum"><small>In this month</small><strong>${money(s.month?.inPence)}</strong><small>&nbsp;</small></div>
        </div>
        <div class="chips">${FILTERS.map(([f, name]) => `<a class="chip" href="#money/${f}"${f === which ? ' aria-current="page"' : ""}>${name}</a>`).join("")}</div>
        ${list.length ? `<ul class="rows">${list.map(row).join("")}</ul>` : `<p class="note">No invoices here.</p>`}
        <p><a class="btn main wide" href="${invoicer({ new: "1" })}">${icon("open")} New invoice, in the Invoicer</a></p>`;
    },
  });
  function row(i) {
    return `<li><a class="row" href="#money/invoice/${i.id}"><span class="row-lead">${esc(i.number || "")}</span><span class="row-main"><strong>${esc(i.billTo?.name || "")}</strong><small>${esc(statusOf(i))}${i.dueDate && i.status !== "paid" ? ` · due ${esc(day(i.dueDate))}` : ""}</small></span><span class="row-end">${money(i.totalPence)}</span></a></li>`;
  }

  async function drawInvoice(page, id) {
    const r = await api(`${A}/invoices/${encodeURIComponent(id)}`);
    const i = r.invoice;
    if (!i) { page.innerHTML = `<p class="note">That invoice isn't there.</p><p><a class="btn wide" href="#money">Back to Money</a></p>`; return; }
    const lines = (i.lines || []).map((l) => `<li class="line"><span>${esc(l.description)}${l.qty !== 1 ? ` <span class="muted">× ${esc(l.qty)}</span>` : ""}</span><span>${money(l.totalPence)}</span></li>`).join("");
    const paid = (r.payments || []).map((p) => `<li class="line"><span>${esc(day(p.paidOn || p.paid_on || p.createdAt))}${p.method ? ` · ${esc(p.method)}` : ""}</span><span>${money(p.amountPence ?? p.amount_pence)}</span></li>`).join("");
    page.innerHTML = `<div class="card">
        <p class="cal-kind">Invoice ${esc(i.number)} · ${esc(statusOf(i))}</p>
        <h2 class="title">${esc(i.billTo?.name || "")}</h2>
        <p class="muted">${[i.issueDate && `Issued ${day(i.issueDate)}`, i.dueDate && `due ${day(i.dueDate)}`].filter(Boolean).map(esc).join(", ")}</p>
        <ul class="lines">${lines}</ul>
        <ul class="lines totals">
          ${i.vatPence ? `<li class="line"><span>Before VAT</span><span>${money(i.subtotalPence)}</span></li><li class="line"><span>VAT</span><span>${money(i.vatPence)}</span></li>` : ""}
          <li class="line"><strong>Total</strong><strong>${money(i.totalPence)}</strong></li>
          ${i.paidPence ? `<li class="line"><span>Paid</span><span>${money(i.paidPence)}</span></li><li class="line"><strong>Still owed</strong><strong>${money(i.balancePence)}</strong></li>` : ""}
        </ul>
        ${i.notes ? `<p class="pre muted">${esc(i.notes)}</p>` : ""}
      </div>
      ${paid ? `<h2 class="h">Payments</h2><div class="card"><ul class="lines">${paid}</ul></div>` : ""}
      <div class="btns">
        <a class="btn main" href="${A}/invoices/${encodeURIComponent(i.id)}/pdf" target="_blank" rel="noopener">PDF</a>
        <a class="btn" href="${invoicer({ invoice: i.id })}">${icon("open")} Open in the Invoicer</a>
        ${["sent", "part_paid"].includes(i.status) ? `<a class="btn" href="${invoicer({ invoice: i.id, do: "pay" })}">Record a payment</a>` : ""}
        ${i.pageUrl ? `<a class="btn" href="${esc(i.pageUrl)}" target="_blank" rel="noopener">Their invoice page</a>` : ""}
      </div>
      <p><a class="btn wide" href="#money">${icon("back")} Back to Money</a></p>`;
  }
})();
