// Portal → Money: invoices to clients, the payments against them, and the studio's expenses.
//
// Everything comes from Nova Bot's /app/api/money (src/money.js there). Anyone signed in writes and
// edits invoices (they wait for an admin), records payments, asks for a reminder, and adds,
// changes, confirms or removes expenses. canDecide (from Nova Bot) says whether this person can
// Approve (which emails the client a link to their invoice's page), Reject, send themselves a
// test, void an invoice, take a payment back, approve a reminder, change the invoice settings
// (studio and bank details, VAT, payment terms) and export for the accountant: an admin signed in
// to Portal in a browser. Approve is pressed twice, saying exactly who it emails.
//
// A receipt's photo goes to the studio PC (POST /actions/receipts: Nova Agent's src/receipts.ts,
// through Nova Bot's relay when online) and the expense keeps its name.
// Money is shown in pounds, days as UK days. Nothing from the server is drawn as HTML.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp && window.PortalApp.kit;

  let data = null; // the last /app/api/money answer
  let part = "invoices"; // invoices | expenses | year
  let editingInvoice = null; // the invoice whose fields are in the form, or null for a new one
  let editingExpense = null;
  let paying = null; // the invoice whose "record a payment" box is open
  let rejecting = null;
  let voiding = null;
  let picked = null; // the ?invoice= one already pointed at
  const opened = new Set(); // invoices whose details are showing
  const details = new Map(); // id -> { updatedAt, payments, reminders, log }
  let clientPicked = null; // { id, name, email } from the client search
  const clientMatches = new Map(); // datalist label -> client

  const STATUS = {
    draft: ["pill-draft", "Draft"],
    pending_approval: ["pill-draft", "Waiting for approval"],
    approved: ["pill-replied", "Approved · sending"],
    sent: ["pill-replied", "Sent · waiting for payment"],
    part_paid: ["pill-replied", "Part paid"],
    paid: ["pill-done", "Paid"],
    failed: ["pill-failed", "Didn't send"],
    rejected: ["pill-stop", "Rejected"],
    void: ["pill-stop", "Voided"],
  };
  const EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Emailed to the client", failed: "Didn't send", payment: "Payment", payment_removed: "Payment taken back", paid: "Paid in full", reminder: "Reminder", voided: "Voided" };
  const waiting = (i) => i.status === "pending_approval" || i.status === "draft";
  const editable = (i) => waiting(i) || i.status === "rejected" || i.status === "failed";
  const open = (i) => i.status === "sent" || i.status === "part_paid";

  // ===== Money and days =====

  function money(pence) {
    const p = Math.round(Number(pence) || 0);
    const abs = Math.abs(p);
    return (p < 0 ? "-" : "") + "£" + Math.floor(abs / 100).toLocaleString("en-GB") + "." + String(abs % 100).padStart(2, "0");
  }
  // "150", "£1,200.5" -> whole pence, or null
  function pence(text) {
    const m = String(text || "").trim().replace(/^£\s*/, "").replace(/,/g, "").match(/^(\d{1,7})(?:\.(\d{0,2}))?$/);
    return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : null;
  }
  const poundsText = (p) => (Math.round(p) / 100).toFixed(2);
  const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  function addDays(day, n) {
    const d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  const day = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const monthName = (ymd) => new Date(ymd.slice(0, 7) + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  // ===== Loading =====

  async function load() {
    const k = K();
    if (!k) return;
    try {
      data = await k.api("money");
    } catch (err) {
      if (k.view === "money" && err.message !== "signed out") k.emptyState($("money-list"), "Couldn't load Money: " + err.message);
      return;
    }
    const s = data.summary;
    k.setBadge("money-badge", (data.canDecide ? s.waitingApproval : 0) + s.overdue.count);
    k.setText("t-money", s.overdue.count);
    k.syncCounts();
    if (k.view !== "money") return;
    k.setText(
      "money-hint",
      data.canDecide
        ? "Invoices, payments and expenses. Nothing is emailed to a client until you approve it."
        : "Invoices, payments and expenses. An admin approves each invoice (signed in to Portal in a browser) before it's emailed to the client."
    );
    fillChoices();
    drawSummary();
    // Pointed at one (?invoice=, from a notification or Agent): its details open
    const want = Number(new URLSearchParams(location.search).get("invoice")) || null;
    if (want && picked !== String(want)) {
      opened.add(want);
      part = "invoices";
      markParts();
    }
    await Promise.allSettled([...opened].map(detailsFor));
    if (k.view !== "money") return;
    draw();
    if (want && picked !== String(want)) {
      const node = $("money-list").querySelector('[data-key="mn-' + want + '"]');
      if (node) {
        picked = String(want);
        node.classList.add("picked");
        bringIntoView(node, true);
      }
    }
  }

  async function detailsFor(id) {
    const inv = data && data.invoices.find((i) => i.id === id);
    if (!inv) return null;
    const have = details.get(id);
    if (have && have.updatedAt === inv.updatedAt) return have;
    const d = await K().api("money/invoices/" + id);
    const got = { updatedAt: inv.updatedAt, payments: d.payments || [], reminders: d.reminders || [], log: d.log || [] };
    details.set(id, got);
    return got;
  }

  // The categories and payment methods, once
  function fillChoices() {
    const sel = $("mn-exp-category");
    if (sel.options.length || !data) return;
    for (const c of data.categories) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      sel.appendChild(o);
    }
  }

  // ===== The tiles =====

  function drawSummary() {
    const k = K();
    const s = data.summary;
    const tile = (value, label, go, warn) => {
      const b = k.el("button", "mn-tile" + (warn ? " warn" : ""));
      b.type = "button";
      b.append(k.el("b", "", value), k.el("span", "", label));
      b.addEventListener("click", () => setPart(go));
      return b;
    };
    const nodes = [
      tile(money(s.month.inPence), "In this month", "year"),
      tile(money(s.month.outPence), "Out this month", "expenses"),
      tile(money(s.owed.pence), "Owed · " + s.owed.count + (s.owed.count === 1 ? " invoice" : " invoices"), "invoices"),
      tile(money(s.overdue.pence), "Overdue · " + s.overdue.count, "invoices", s.overdue.count > 0),
    ];
    k.redraw($("money-summary"), JSON.stringify(s), nodes);
  }

  // ===== The parts: Invoices, Expenses, Tax year =====

  function markParts() {
    document.querySelectorAll("[data-mn]").forEach((c) => {
      const on = c.dataset.mn === part;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
  }
  function setPart(p) {
    part = p;
    markParts();
    if (data) draw();
  }
  document.querySelectorAll("[data-mn]").forEach((c) => c.addEventListener("click", () => setPart(c.dataset.mn)));

  function draw() {
    if (!data) return;
    const list = $("money-list");
    if (part === "expenses") return K().reconcile(list, expenseNodes());
    if (part === "year") return K().reconcile(list, yearNodes());
    return K().reconcile(list, invoiceNodes());
  }

  // ===== Invoices =====

  function invoiceNodes() {
    const k = K();
    const all = data.invoices;
    const by = (key, dir) => (a, b) => dir * String(a[key] || "").localeCompare(String(b[key] || ""));
    const nodes = [];
    const reminders = data.reminders.filter((r) => r.status === "pending_approval");
    if (reminders.length) nodes.push(k.el("h3", "group-head", "Reminders to approve"), ...reminders.map(reminderCard));
    const groups = [
      ["Waiting for approval", all.filter((i) => waiting(i) || i.status === "approved" || i.status === "failed").sort(by("createdAt", 1))],
      ["Overdue", all.filter((i) => open(i) && i.overdue).sort(by("dueDate", 1))],
      ["Waiting for payment", all.filter((i) => open(i) && !i.overdue).sort(by("dueDate", 1))],
      ["Paid", all.filter((i) => i.status === "paid").sort(by("paidAt", -1)).slice(0, 30)],
      ["Rejected and voided", all.filter((i) => i.status === "rejected" || i.status === "void").sort(by("updatedAt", -1)).slice(0, 15)],
    ];
    for (const [head, items] of groups) if (items.length) nodes.push(k.el("h3", "group-head", head), ...items.map(invoiceCard));
    if (!all.length && !reminders.length) nodes.push(k.el("p", "empty", "No invoices yet. Write one with Write an invoice, or ask Agent to."));
    return nodes;
  }

  function reminderCard(r) {
    const k = K();
    const inv = data.invoices.find((i) => i.id === r.invoiceId);
    const card = k.el("article", "card mn-card");
    card.dataset.key = "mn-r-" + r.id;
    card.dataset.sig = k.sig(r, data.canDecide, inv && inv.updatedAt);
    const top = k.el("div", "card-top");
    const title = k.el("h3", "card-title", (r.kind === "receipt" ? "Receipt · " : "Reminder · ") + (inv ? inv.number + " · " + inv.billTo.name : "invoice #" + r.invoiceId));
    title.appendChild(k.el("span", "pill-draft", "Waiting for approval"));
    top.append(title, k.el("span", "card-meta", k.ukWhen(r.createdAt)));
    card.append(top);
    if (inv) card.appendChild(k.el("p", "card-who", "To " + (inv.billTo.email || "no email") + " · " + money(inv.balancePence) + " left to pay"));
    card.appendChild(k.el("p", "mn-reminder", r.body));
    const row = k.el("div", "actions");
    if (data.canDecide) {
      button(row, "Approve", "", (b) => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "Email it to " + (inv ? inv.billTo.email : "them") + " now?";
          return;
        }
        act(card, "money/reminders/" + r.id + "/approve", {}, r.kind === "receipt" ? "Receipt sent" : "Reminder sent");
      });
      button(row, "Reject", "ghost", () => act(card, "money/reminders/" + r.id + "/reject", {}, "Reminder rejected"));
    } else card.appendChild(k.el("p", "card-foot", "An admin approves reminders, signed in to Portal in a browser. Nothing is emailed until then."));
    if (row.children.length) card.appendChild(row);
    return card;
  }

  function invoiceCard(inv) {
    const k = K();
    const canDecide = Boolean(data.canDecide);
    const showing = opened.has(inv.id);
    const d = showing ? details.get(inv.id) : null;
    const card = k.el("article", "card mn-card" + (inv.overdue ? " overdue" : "") + (waiting(inv) ? "" : " done"));
    card.dataset.key = "mn-" + inv.id;
    const reminding = data.reminders.some((r) => r.invoiceId === inv.id && r.status === "pending_approval");
    card.dataset.sig = k.sig(inv, canDecide, showing, d && [d.updatedAt, d.payments.length, d.reminders.length, d.log.length], paying === inv.id, rejecting === inv.id, voiding === inv.id, reminding);
    const top = k.el("div", "card-top");
    const title = k.el("h3", "card-title", inv.number + " · " + inv.billTo.name);
    const pill = inv.overdue ? ["pill-failed", "Overdue"] : STATUS[inv.status] || ["pill-stop", inv.status];
    title.appendChild(k.el("span", pill[0], pill[1]));
    top.append(title, k.el("span", "card-meta mn-amount", money(inv.totalPence)));
    card.appendChild(top);
    card.appendChild(k.el("p", "card-who", (inv.createdBy === "agent" ? "Written by Agent" : "Written in Portal") + " · " + k.ukWhen(inv.createdAt)));

    const facts = k.el("dl", "cp-facts");
    const fact = (label, value) => value && facts.append(k.el("dt", "", label), k.el("dd", "", value));
    fact("Goes to", inv.billTo.email || "No email yet: add one to send it");
    fact("Total", money(inv.totalPence) + (inv.vatRate ? " (incl. " + inv.vatRate + "% VAT)" : ""));
    if (open(inv) || inv.status === "paid") fact(inv.status === "paid" ? "Paid" : "Left to pay", inv.status === "paid" ? money(inv.paidPence) + (inv.paidAt ? " · " + k.ukWhen(inv.paidAt) : "") : money(inv.balancePence));
    fact("Issued", day(inv.issueDate));
    fact(inv.overdue ? "Was due" : "Due", day(inv.dueDate));
    if (inv.sentAt) fact("Sent", k.ukWhen(inv.sentAt));
    if (inv.decidedByName && !waiting(inv)) fact(inv.status === "rejected" ? "Rejected by" : "Approved by", inv.decidedByName);
    card.appendChild(facts);

    const lines = k.el("ul", "mn-lines-read");
    for (const l of inv.lines) {
      const li = k.el("li");
      li.append(k.el("span", "", l.description + (l.qty !== 1 ? " × " + l.qty : "")), k.el("span", "", money(l.totalPence)));
      lines.appendChild(li);
    }
    card.appendChild(lines);
    if (inv.notes) card.appendChild(k.el("p", "card-foot", inv.notes));
    if (inv.note) card.appendChild(k.el("p", "appr-why", "Note: " + inv.note));
    if (inv.status === "failed") card.appendChild(k.el("p", "appr-result bad", "Didn't send: " + String(inv.error || "unknown reason").replace(/\.$/, "") + ". Edit it (or save it again) to send it for approval again."));
    if (inv.status === "approved") card.appendChild(k.el("p", "appr-result", "Approved · being emailed…"));

    if (paying === inv.id) card.appendChild(paymentBox(inv));
    if (rejecting === inv.id) card.appendChild(whyBox("So whoever wrote it can fix it"));
    if (voiding === inv.id) card.appendChild(whyBox("Why it's voided (kept for the record)"));
    if (showing && d) card.appendChild(detailBox(inv, d));

    const row = k.el("div", "actions");
    if (paying === inv.id) {
      button(row, "Save the payment", "", () => recordPayment(card, inv));
      button(row, "Cancel", "ghost", () => redrawWith(() => (paying = null)));
    } else if (rejecting === inv.id) {
      button(row, "Reject it", "", () => act(card, "money/invoices/" + inv.id + "/reject", { note: why(card) }, "Rejected"));
      button(row, "Cancel", "ghost", () => redrawWith(() => (rejecting = null)));
    } else if (voiding === inv.id) {
      button(row, "Void it", "", () => act(card, "money/invoices/" + inv.id + "/void", { note: why(card) }, "Voided"));
      button(row, "Cancel", "ghost", () => redrawWith(() => (voiding = null)));
    } else {
      if (waiting(inv) && canDecide) {
        button(row, "Approve", "", (b) => {
          if (!inv.billTo.email) return problem(card, "It has no email address. Edit it and add one first.");
          if (b.dataset.sure !== "1") {
            b.dataset.sure = "1";
            b.textContent = "Email it to " + inv.billTo.email + " now?";
            return;
          }
          approve(card, inv);
        });
      }
      if (editable(inv)) button(row, "Edit", "ghost", () => openInvoiceForm(inv));
      if (waiting(inv) && canDecide) {
        button(row, "Reject", "ghost", () => redrawWith(() => (rejecting = inv.id)));
        button(row, "Send me a test", "ghost", () => act(card, "money/invoices/test-send", { id: inv.id }, null));
      }
      if (open(inv)) {
        button(row, "Record a payment", "", () => redrawWith(() => (paying = inv.id)));
        if (!reminding) button(row, "Ask for a reminder", "ghost", () => act(card, "money/invoices/" + inv.id + "/reminder", {}, canDecide ? "Reminder written: approve it above" : "Reminder written: an admin approves it"));
      }
      link(row, inv.pageUrl ? "Client's page" : "Preview", inv.pageUrl || "/app/api/money/invoices/" + inv.id + "/preview");
      if (canDecide && inv.paidPence === 0 && !["void", "approved", "paid"].includes(inv.status)) button(row, "Void", "ghost", () => redrawWith(() => (voiding = inv.id)));
      button(row, showing ? "Hide details" : "Details", "ghost", async () => {
        if (showing) opened.delete(inv.id);
        else {
          opened.add(inv.id);
          try {
            await detailsFor(inv.id);
          } catch (err) {
            return problem(card, err.message);
          }
        }
        draw();
      });
    }
    card.appendChild(row);
    if (waiting(inv) && !canDecide) card.appendChild(k.el("p", "card-foot", "An admin approves invoices, signed in to Portal in a browser. Nothing is emailed until then."));
    return card;
  }

  function detailBox(inv, d) {
    const k = K();
    const box = k.el("div");
    if (d.payments.length) {
      box.appendChild(k.el("p", "mn-sub", "PAYMENTS"));
      const ul = k.el("ul", "mn-log");
      for (const p of d.payments) {
        const li = k.el("li");
        li.appendChild(k.el("span", "", day(p.paidOn) + " · " + money(p.amountPence) + " · " + p.methodName + (p.note ? " · " + p.note : "") + (p.removed ? " · taken back" : "")));
        if (data.canDecide && !p.removed && p.method !== "stripe") {
          const b = k.el("button", "btn small ghost", "Take back");
          b.type = "button";
          b.addEventListener("click", () => {
            if (b.dataset.sure !== "1") {
              b.dataset.sure = "1";
              b.textContent = "Take back " + money(p.amountPence) + "?";
              return;
            }
            act(b.closest(".card"), "money/payments/" + p.id + "/remove", {}, "Payment taken back");
          });
          li.appendChild(b);
        }
        ul.appendChild(li);
      }
      box.appendChild(ul);
    }
    if (d.reminders.length) {
      box.appendChild(k.el("p", "mn-sub", "REMINDERS"));
      const ul = k.el("ul", "mn-log");
      for (const r of d.reminders) ul.appendChild(k.el("li", "", k.ukWhen(r.createdAt) + " · " + (r.status === "sent" ? "Sent " + k.ukWhen(r.sentAt) : r.status === "pending_approval" ? "Waiting for approval" : r.status)));
      box.appendChild(ul);
    }
    if (d.log.length) {
      box.appendChild(k.el("p", "mn-sub", "WHAT HAPPENED"));
      const ul = k.el("ul", "mn-log");
      for (const e of d.log.slice(-10)) ul.appendChild(k.el("li", "", k.ukWhen(e.at) + " · " + (EVENTS[e.event] || e.event) + (e.byName ? " · " + e.byName : "") + (e.detail ? " · " + e.detail : "")));
      box.appendChild(ul);
    }
    if (!box.children.length) box.appendChild(k.el("p", "card-foot", "Nothing else yet."));
    return box;
  }

  function paymentBox(inv) {
    const k = K();
    const box = k.el("div", "mn-inline cp-grid");
    const field = (label, input) => {
      const l = k.el("label", "cp-field");
      l.append(k.el("span", "", label), input);
      box.appendChild(l);
    };
    const amount = k.el("input");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.value = poundsText(inv.balancePence);
    amount.dataset.field = "amount";
    field("Amount (£)", amount);
    const on = k.el("input");
    on.type = "date";
    on.value = ukToday();
    on.max = ukToday();
    on.dataset.field = "paidOn";
    field("Paid on", on);
    const how = k.el("select");
    for (const m of data.methods) {
      const o = k.el("option", "", m.name);
      o.value = m.id;
      how.appendChild(o);
    }
    how.dataset.field = "method";
    field("How", how);
    const note = k.el("input");
    note.type = "text";
    note.maxLength = 300;
    note.dataset.field = "note";
    field("Note (optional)", note);
    return box;
  }

  function whyBox(placeholder) {
    const k = K();
    const l = k.el("label", "cp-field cp-reject");
    const input = k.el("input");
    input.type = "text";
    input.maxLength = 500;
    input.dataset.field = "why";
    input.placeholder = placeholder;
    l.append(k.el("span", "", "Why (optional)"), input);
    return l;
  }
  const why = (card) => (card.querySelector('[data-field="why"]') || {}).value || undefined;

  async function recordPayment(card, inv) {
    const v = (f) => card.querySelector('[data-field="' + f + '"]').value;
    if (pence(v("amount")) === null || pence(v("amount")) <= 0) return problem(card, "Not saved: the amount in pounds, like 150.00.");
    await act(card, "money/invoices/" + inv.id + "/payments", { amount: v("amount"), paidOn: v("paidOn"), method: v("method"), note: v("note").trim() || undefined }, "Payment recorded", () => (paying = null));
  }

  async function approve(card, inv) {
    busy(card);
    try {
      // Still exactly what's on screen?
      const now = (await K().api("money/invoices/" + inv.id)).invoice || {};
      if (now.updatedAt !== inv.updatedAt || now.status !== inv.status) {
        K().toast("It changed since it was shown: check it again");
        return load();
      }
    } catch (err) {
      if (err.message === "signed out") return;
      return problem(card, "Not approved: " + err.message);
    }
    await act(card, "money/invoices/" + inv.id + "/approve", {}, null, null, (res) => (res.invoice && res.invoice.status === "sent" ? "Approved and emailed to " + inv.billTo.email : res.invoice && res.invoice.status === "failed" ? "Approved, but it didn't send: see the card" : "Approved"));
  }

  // ===== Expenses =====

  function expenseNodes() {
    const k = K();
    const nodes = [];
    const list = data.expenses;
    const toConfirm = list.filter((e) => e.status === "unconfirmed");
    if (toConfirm.length) nodes.push(k.el("h3", "group-head", "To confirm (noted by Agent)"), ...toConfirm.map(expenseCard));
    const months = new Map();
    for (const e of list.filter((x) => x.status === "confirmed")) {
      const m = e.spentOn.slice(0, 7);
      if (!months.has(m)) months.set(m, []);
      months.get(m).push(e);
    }
    for (const [m, items] of months) {
      const total = items.reduce((s, e) => s + e.amountPence, 0);
      nodes.push(k.el("h3", "group-head", monthName(m) + " · " + money(total)), ...items.map(expenseCard));
    }
    if (!list.length) nodes.push(k.el("p", "empty", "No expenses yet. Add one with Add an expense: its receipt can go with it."));
    return nodes;
  }

  function expenseCard(e) {
    const k = K();
    const card = k.el("article", "card mn-card" + (e.status === "unconfirmed" ? "" : " done"));
    card.dataset.key = "mn-e-" + e.id;
    card.dataset.sig = k.sig(e);
    const top = k.el("div", "card-top");
    const title = k.el("h3", "card-title", money(e.amountPence) + " · " + e.category);
    if (e.status === "unconfirmed") title.appendChild(k.el("span", "pill-draft", "Not confirmed"));
    top.append(title, k.el("span", "card-meta", day(e.spentOn)));
    card.appendChild(top);
    const who = [e.supplier, e.note].filter(Boolean).join(" · ");
    if (who) card.appendChild(k.el("p", "card-who", who));
    if (e.receiptId) {
      const p = k.el("p", "card-foot");
      const a = k.el("a", "mn-receipt", "See the receipt");
      a.href = "/receipts/" + encodeURIComponent(e.receiptId);
      a.target = "_blank";
      a.rel = "noopener";
      p.appendChild(a);
      card.appendChild(p);
    }
    const row = k.el("div", "actions");
    if (e.status === "unconfirmed") button(row, "Confirm", "", () => act(card, "money/expenses/" + e.id + "/confirm", {}, "Confirmed"));
    button(row, "Edit", "ghost", () => openExpenseForm(e));
    button(row, "Remove", "ghost", (b) => {
      if (b.dataset.sure !== "1") {
        b.dataset.sure = "1";
        b.textContent = "Remove " + money(e.amountPence) + "?";
        return;
      }
      act(card, "money/expenses/" + e.id + "/delete", {}, "Removed");
    });
    card.appendChild(row);
    return card;
  }

  // ===== The tax year: totals, the accountant's export, invoice settings =====

  function yearNodes() {
    const k = K();
    const s = data.summary;
    const y = s.taxYear;
    const card = k.el("article", "card mn-card");
    card.dataset.key = "mn-year";
    card.dataset.sig = k.sig(y);
    card.appendChild(k.el("h3", "card-title", "Tax year " + y.name));
    card.appendChild(k.el("p", "card-who", day(y.from) + " to " + day(y.to)));
    const facts = k.el("dl", "cp-facts");
    const fact = (label, value) => facts.append(k.el("dt", "", label), k.el("dd", "", value));
    fact("In (payments)", money(y.inPence));
    fact("Out (expenses)", money(y.outPence));
    fact("Difference", money(y.inPence - y.outPence));
    fact("Owed to the studio", money(s.owed.pence));
    card.appendChild(facts);
    if (y.outByCategory.length) {
      card.appendChild(k.el("p", "mn-sub", "WHERE THE MONEY WENT"));
      const ul = k.el("ul", "mn-cats");
      const most = y.outByCategory[0].pence || 1;
      for (const c of y.outByCategory) {
        const li = k.el("li");
        const bar = k.el("span", "mn-bar");
        bar.style.width = Math.max(4, Math.round((c.pence / most) * 100)) + "%";
        li.append(k.el("span", "", c.category), k.el("span", "mn-amount", money(c.pence)), bar);
        ul.appendChild(li);
      }
      card.appendChild(ul);
    }
    if (s.unconfirmedExpenses) card.appendChild(k.el("p", "card-foot", s.unconfirmedExpenses + " expense" + (s.unconfirmedExpenses === 1 ? " isn't" : "s aren't") + " confirmed yet, so not counted."));
    const nodes = [card];

    const exp = k.el("article", "card mn-card");
    exp.dataset.key = "mn-export";
    exp.dataset.sig = k.sig(data.canDecide, y.from);
    exp.appendChild(k.el("h3", "card-title", "For the accountant"));
    if (data.canDecide) {
      exp.appendChild(k.el("p", "card-who", "Spreadsheets (CSV) for this tax year."));
      const row = k.el("div", "mn-export");
      for (const [what, label] of [["invoices", "Invoices"], ["payments", "Payments"], ["expenses", "Expenses"]]) {
        const a = k.el("a", "btn small ghost", label);
        a.href = "/app/api/money/export.csv?what=" + what + "&from=" + y.from + "&to=" + y.to;
        a.setAttribute("download", "");
        row.appendChild(a);
      }
      exp.appendChild(row);
    } else exp.appendChild(k.el("p", "card-foot", "An admin downloads these, signed in to Portal in a browser."));
    // The same, live in Google Sheets (once Google is connected: Portal → Admin → Google; google.js)
    if (window.PortalGoogle) {
      const sheet = k.el("button", "btn small", "Open in Google Sheets ↗");
      sheet.type = "button";
      sheet.addEventListener("click", () => window.PortalGoogle.openSheet());
      exp.appendChild(sheet);
    }
    nodes.push(exp);
    nodes.push(settingsCard());
    return nodes;
  }

  function settingsCard() {
    const k = K();
    const st = data.settings;
    const card = k.el("article", "card mn-card");
    card.dataset.key = "mn-settings";
    card.dataset.sig = k.sig(st, data.canDecide, data.emailReady, data.cardReady);
    card.appendChild(k.el("h3", "card-title", "Invoice settings"));
    const facts = k.el("dl", "cp-facts");
    const fact = (label, value) => facts.append(k.el("dt", "", label), k.el("dd", "", value));
    fact("Emailing invoices", data.emailReady ? "Ready" : "Not set up (Nova Bot's email key and from address)");
    fact("Pay by card", data.cardReady ? "Ready (Stripe)" : "Not set up (Stripe)");
    fact("Bank details", st.bankReady ? "On every invoice" : "Not added yet");
    fact("Pay with Monzo", st.monzoReady ? "On every invoice" : "Not added yet");
    card.appendChild(facts);
    if (!data.canDecide) {
      card.appendChild(k.el("p", "card-foot", "An admin changes these, signed in to Portal in a browser."));
      return card;
    }
    const box = k.el("div", "cp-grid mn-inline");
    const field = (label, key, value, attrs = {}) => {
      const l = k.el("label", "cp-field");
      const input = k.el("input");
      input.type = attrs.type || "text";
      input.value = value === undefined || value === null ? "" : String(value);
      input.dataset.setting = key;
      for (const [a, v] of Object.entries(attrs)) if (a !== "type") input.setAttribute(a, v);
      l.append(k.el("span", "", label), input);
      box.appendChild(l);
    };
    field("Studio name", "business.name", st.business.name, { maxlength: 120 });
    field("Studio address", "business.address", st.business.address, { maxlength: 400 });
    field("Email for replies", "business.email", st.business.email, { type: "email", maxlength: 200 });
    field("VAT number (if registered)", "business.vatNumber", st.business.vatNumber, { maxlength: 30 });
    field("Bank account name", "bank.accountName", st.bank.accountName, { maxlength: 120 });
    field("Sort code", "bank.sortCode", st.bank.sortCode, { maxlength: 20, inputmode: "numeric" });
    field("Account number", "bank.accountNumber", st.bank.accountNumber, { maxlength: 34, inputmode: "numeric" });
    field("A line under the bank details (optional)", "bank.note", st.bank.note, { maxlength: 200 });
    field("Monzo link (monzo.me/yourname, optional)", "monzo.link", st.monzo?.link, { maxlength: 300, spellcheck: "false" });
    field("VAT % on new invoices", "vatRate", st.vatRate, { type: "number", min: 0, max: 100, step: "0.01" });
    field("Days to pay", "dueDays", st.dueDays, { type: "number", min: 0, max: 120, step: 1 });
    card.appendChild(box);
    const row = k.el("div", "actions");
    button(row, "Save settings", "", () => {
      const body = { business: {}, bank: {}, monzo: {} };
      card.querySelectorAll("[data-setting]").forEach((i) => {
        const [a, b] = i.dataset.setting.split(".");
        if (b) body[a][b] = i.value.trim();
        else body[a] = Number(i.value);
      });
      act(card, "money/settings", body, "Settings saved");
    });
    card.appendChild(row);
    return card;
  }

  // ===== Writing an invoice =====

  function lineRow(line) {
    const k = K();
    const row = k.el("div", "mn-line");
    const input = (cls, type, value, attrs) => {
      const i = k.el("input", cls);
      i.type = type;
      i.value = value;
      for (const [a, v] of Object.entries(attrs)) i.setAttribute(a, v);
      i.addEventListener("input", totals);
      row.appendChild(i);
      return i;
    };
    input("mn-line-desc", "text", line.description || "", { maxlength: 300, placeholder: "e.g. Mixing, per song", "aria-label": "What it's for" });
    input("mn-line-qty", "number", line.qty === undefined ? "1" : String(line.qty), { min: "0.01", step: "0.01", inputmode: "decimal", "aria-label": "How many" });
    input("mn-line-price", "text", line.unitPence === undefined ? "" : poundsText(line.unitPence), { inputmode: "decimal", maxlength: 12, placeholder: "150.00", "aria-label": "Price of one, in pounds" });
    row.appendChild(k.el("span", "mn-line-total", ""));
    const x = k.el("button", "mn-line-remove", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Remove this line");
    x.addEventListener("click", () => {
      row.remove();
      if (!$("mn-inv-lines").children.length) $("mn-inv-lines").appendChild(lineRow({}));
      totals();
    });
    row.appendChild(x);
    return row;
  }

  function readLines() {
    return [...$("mn-inv-lines").children].map((r) => ({
      description: r.querySelector(".mn-line-desc").value.trim(),
      qty: Number(r.querySelector(".mn-line-qty").value),
      unit: r.querySelector(".mn-line-price").value.trim(),
    }));
  }

  // The totals as they're typed (the same sums as Nova Bot: whole pence, VAT once on the subtotal)
  function totals() {
    const k = K();
    let sub = 0;
    for (const r of $("mn-inv-lines").children) {
      const q = Number(r.querySelector(".mn-line-qty").value);
      const p = pence(r.querySelector(".mn-line-price").value);
      const t = q > 0 && p !== null ? Math.round(q * p) : null;
      r.querySelector(".mn-line-total").textContent = t === null ? "–" : money(t);
      if (t) sub += t;
    }
    const rate = Number($("mn-inv-vat").value) || 0;
    const vat = Math.round((sub * rate) / 100);
    const dl = $("mn-inv-totals");
    const nodes = [k.el("dt", "", "Subtotal"), k.el("dd", "", money(sub))];
    if (rate) nodes.push(k.el("dt", "", "VAT (" + rate + "%)"), k.el("dd", "", money(vat)));
    nodes.push(k.el("dt", "big", "Total"), k.el("dd", "big", money(sub + vat)));
    dl.replaceChildren(...nodes);
  }

  function openInvoiceForm(inv) {
    const k = K();
    if (!data) return;
    editingInvoice = inv ? inv.id : null;
    clientPicked = inv && inv.clientId ? { id: inv.clientId } : null;
    $("mn-inv-title").textContent = inv ? "Change " + inv.number : "Write an invoice";
    $("mn-inv-save").textContent = inv ? "Save changes for approval" : "Save for approval";
    $("mn-inv-client").value = "";
    $("mn-inv-name").value = inv ? inv.billTo.name : "";
    $("mn-inv-email").value = inv ? inv.billTo.email || "" : "";
    $("mn-inv-address").value = inv ? inv.billTo.address || "" : "";
    const today = ukToday();
    $("mn-inv-issue").value = inv ? inv.issueDate : today;
    $("mn-inv-due").value = inv ? inv.dueDate : addDays(today, data.settings.dueDays);
    $("mn-inv-vat").value = inv ? inv.vatRate : data.settings.vatRate;
    $("mn-inv-notes").value = inv ? inv.notes : "";
    $("mn-inv-billing").value = inv && inv.billing === "full" ? "full" : "deposit";
    $("mn-inv-lines").replaceChildren(...(inv ? inv.lines : [{}]).map(lineRow));
    k.setText("mn-inv-error", "");
    totals();
    showForm("money-expense-form", "money-expense-new", false);
    showForm("money-invoice-form", "money-new", true);
    $("mn-inv-name").focus({ preventScroll: true });
    bringIntoView($("money-invoice-form"));
  }

  // Scroll Portal itself (never the page around it, inside Nova Agent) so a box shows, only if it doesn't.
  // Inside Nova Agent the page doesn't scroll (frame.css): the open section's own box does.
  function bringIntoView(node, center) {
    const r = node.getBoundingClientRect();
    if (!center && r.top >= 60 && r.top < innerHeight - 120) return;
    if (document.documentElement.classList.contains("embed")) {
      node.scrollIntoView({ block: center ? "center" : "start", behavior: K().calm() ? "auto" : "smooth" });
      return;
    }
    const top = scrollY + r.top - (center ? Math.max(60, (innerHeight - r.height) / 2) : 80);
    scrollTo({ top: Math.max(0, top), behavior: K().calm() ? "auto" : "smooth" });
  }

  function showForm(id, toggle, on) {
    $(id).hidden = !on;
    $(toggle).setAttribute("aria-expanded", String(on));
  }

  $("money-new").addEventListener("click", () => ($("money-invoice-form").hidden ? openInvoiceForm(null) : showForm("money-invoice-form", "money-new", false)));
  $("mn-inv-cancel").addEventListener("click", () => showForm("money-invoice-form", "money-new", false));
  $("mn-inv-add-line").addEventListener("click", () => {
    const row = lineRow({});
    $("mn-inv-lines").appendChild(row);
    row.querySelector("input").focus();
    totals();
  });
  $("mn-inv-vat").addEventListener("input", totals);
  $("mn-inv-issue").addEventListener("change", () => {
    const issue = $("mn-inv-issue").value;
    if (issue && data && !editingInvoice) $("mn-inv-due").value = addDays(issue, data.settings.dueDays);
  });

  // The client search: their name and email fill in (the invoice stays tied to them)
  let searchTimer = 0;
  $("mn-inv-client").addEventListener("input", () => {
    const text = $("mn-inv-client").value;
    const hit = clientMatches.get(text);
    if (hit) {
      clientPicked = hit;
      $("mn-inv-name").value = hit.name;
      if (hit.email) $("mn-inv-email").value = hit.email;
      return;
    }
    clearTimeout(searchTimer);
    if (text.trim().length < 2) return;
    searchTimer = setTimeout(async () => {
      let found;
      try {
        found = await K().api("clients?" + new URLSearchParams({ filter: "all", search: text.trim() }));
      } catch (err) {
        return;
      }
      clientMatches.clear();
      const opts = (found.clients || []).slice(0, 8).map((c) => {
        const label = c.name + (c.email ? " · " + c.email : "");
        clientMatches.set(label, { id: c.id, name: c.name, email: c.email });
        const o = document.createElement("option");
        o.value = label;
        return o;
      });
      $("mn-client-list").replaceChildren(...opts);
    }, 250);
  });

  $("money-invoice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const k = K();
    const lines = readLines().filter((l) => l.description || l.unit);
    if (!$("mn-inv-name").value.trim()) return k.setText("mn-inv-error", "Not saved: who is it to?");
    if (!lines.length) return k.setText("mn-inv-error", "Not saved: add a line (what it's for and the price).");
    for (const [i, l] of lines.entries()) {
      if (!l.description) return k.setText("mn-inv-error", "Not saved: line " + (i + 1) + " needs what it's for.");
      if (pence(l.unit) === null) return k.setText("mn-inv-error", "Not saved: line " + (i + 1) + "'s price, in pounds (like 150.00).");
      if (!(l.qty > 0)) return k.setText("mn-inv-error", "Not saved: line " + (i + 1) + " needs how many.");
    }
    const body = {
      clientId: clientPicked && $("mn-inv-name").value.trim() ? clientPicked.id : null,
      billName: $("mn-inv-name").value.trim(),
      billEmail: $("mn-inv-email").value.trim(),
      billAddress: $("mn-inv-address").value.trim(),
      lines,
      vatRate: Number($("mn-inv-vat").value) || 0,
      issueDate: $("mn-inv-issue").value,
      dueDate: $("mn-inv-due").value,
      notes: $("mn-inv-notes").value.trim(),
      billing: $("mn-inv-billing").value,
    };
    const save = e.submitter || $("mn-inv-save");
    save.disabled = true;
    try {
      await k.api(editingInvoice ? "money/invoices/" + editingInvoice + "/edit" : "money/invoices", { body });
    } catch (err) {
      if (err.message !== "signed out") k.setText("mn-inv-error", "Not saved: " + err.message);
      return;
    } finally {
      save.disabled = false;
    }
    if (editingInvoice) details.delete(editingInvoice);
    showForm("money-invoice-form", "money-new", false);
    k.toast("Saved: waiting for an admin's approval");
    setPart("invoices");
    load();
  });

  // ===== Adding an expense =====

  function openExpenseForm(e) {
    const k = K();
    editingExpense = e ? e.id : null;
    $("mn-exp-amount").value = e ? poundsText(e.amountPence) : "";
    $("mn-exp-category").value = e ? e.category : "Equipment";
    $("mn-exp-supplier").value = e ? e.supplier : "";
    $("mn-exp-day").value = e ? e.spentOn : ukToday();
    $("mn-exp-day").max = ukToday();
    $("mn-exp-note").value = e ? e.note : "";
    $("mn-exp-receipt").value = "";
    k.setText("mn-exp-error", "");
    $("money-expense-form").querySelector(".card-title").textContent = e ? "Change an expense" : "Add an expense";
    showForm("money-invoice-form", "money-new", false);
    showForm("money-expense-form", "money-expense-new", true);
    $("mn-exp-amount").focus({ preventScroll: true });
    bringIntoView($("money-expense-form"));
  }
  $("money-expense-new").addEventListener("click", () => ($("money-expense-form").hidden ? openExpenseForm(null) : showForm("money-expense-form", "money-expense-new", false)));
  $("mn-exp-cancel").addEventListener("click", () => showForm("money-expense-form", "money-expense-new", false));

  const RECEIPT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" };
  // The receipt goes to the studio PC; its name comes back
  async function uploadReceipt(file) {
    const type = file.type || RECEIPT_TYPES[(file.name.split(".").pop() || "").toLowerCase()] || "";
    if (!type) throw new Error("A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF.");
    if (file.size > 20 * 1024 * 1024) throw new Error("That receipt is too big (20 MB at most).");
    let res;
    try {
      res = await fetch("/actions/receipts", { method: "POST", headers: { "Content-Type": type, "X-Nova-Visualizer": "1" }, body: file, credentials: "same-origin" });
    } catch (err) {
      throw new Error("The receipt couldn't be sent (no connection).");
    }
    let got = {};
    try {
      got = await res.json();
    } catch (err) {}
    if (res.status === 503 || got.pcOffline) throw new Error("The studio computer is off, so the receipt can't be kept just now. Save the expense without it, or try again later.");
    if (!res.ok || !got.receipt) throw new Error(got.message || got.error || "The receipt couldn't be kept (" + res.status + ").");
    return got.receipt.id;
  }

  $("money-expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const k = K();
    if (pence($("mn-exp-amount").value) === null) return k.setText("mn-exp-error", "Not saved: the amount in pounds, like 49.99.");
    const button = e.submitter || $("money-expense-form").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const body = {
        amount: $("mn-exp-amount").value.trim(),
        category: $("mn-exp-category").value,
        supplier: $("mn-exp-supplier").value.trim(),
        spentOn: $("mn-exp-day").value || ukToday(),
        note: $("mn-exp-note").value.trim(),
      };
      const file = $("mn-exp-receipt").files[0];
      if (file) body.receiptId = await uploadReceipt(file);
      await k.api(editingExpense ? "money/expenses/" + editingExpense + "/edit" : "money/expenses", { body });
    } catch (err) {
      if (err.message !== "signed out") k.setText("mn-exp-error", "Not saved: " + err.message);
      return;
    } finally {
      button.disabled = false;
    }
    showForm("money-expense-form", "money-expense-new", false);
    k.toast(editingExpense ? "Changed" : "Expense added");
    setPart("expenses");
    load();
  });

  // ===== Shared bits =====

  function button(row, text, cls, fn) {
    const b = K().el("button", "btn small" + (cls ? " " + cls : ""), text);
    b.type = "button";
    b.addEventListener("click", () => fn(b));
    row.appendChild(b);
    return b;
  }
  function link(row, text, href) {
    const a = K().el("a", "btn small ghost", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    row.appendChild(a);
    return a;
  }
  const busy = (card) => card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  // The reason something didn't work stays on the card (its buttons work again)
  function problem(card, text) {
    let p = card.querySelector(".appr-error");
    if (!p) {
      p = K().el("p", "appr-result bad appr-error");
      p.setAttribute("role", "alert");
      card.appendChild(p);
    }
    p.textContent = text;
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
  function redrawWith(change) {
    change();
    draw();
  }
  // Press a button: Nova Bot does it, the list comes back
  async function act(card, path, body, done, after, say) {
    busy(card);
    let res;
    try {
      res = await K().api(path, { body: body || {} });
    } catch (err) {
      if (err.message === "signed out") return;
      return problem(card, err.message);
    }
    if (after) after();
    paying = rejecting = voiding = null;
    const msg = say ? say(res) : done || res.message;
    if (msg) K().toast(msg);
    for (const id of [...details.keys()]) details.delete(id);
    await load();
    // (a card that didn't change is kept as it was: its buttons work again)
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }

  window.PortalMoney = { load };
})();
