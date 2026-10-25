// Portal → Money: invoices to clients, the payments against them, and the studio's expenses.
//
// Everything comes from Nova Bot's /app/api/money (src/money.js there). Anyone signed in writes and
// edits invoices (they wait for an admin), records payments, asks for a reminder, and adds,
// changes, confirms or removes expenses. canDecide (from Nova Bot) says whether this person can
// Approve (which emails the client a link to their invoice's page), Reject, send themselves a
// test, void an invoice, take a payment back, approve a reminder, change the invoice settings
// (studio and bank details, VAT, payment terms) and export for the accountant: an admin signed in
// to Portal in a browser. Approve is one press (the card says who it emails).
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
  let editingExpense = null;
  let picked = null; // the ?invoice= one already pointed at

  const waiting = (i) => i.status === "pending_approval" || i.status === "draft";

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
    // Pointed at one (?invoice=, from an older notification or link): it opens in the Invoicer, where
    // everything for invoices is (19 Oct 2026)
    const want = Number(new URLSearchParams(location.search).get("invoice")) || null;
    if (want && picked !== String(want)) {
      picked = String(want);
      window.NovaInvoicer.open({ invoice: want });
    }
    draw();
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
      b.addEventListener("click", () => (typeof go === "function" ? go() : setPart(go)));
      return b;
    };
    const nodes = [
      tile(money(s.month.inPence), "In this month", "year"),
      tile(money(s.month.outPence), "Out this month", "expenses"),
      // (the invoice tiles open the Invoicer: everything for invoices is there, 19 Oct 2026)
      tile(money(s.owed.pence), "Owed · " + s.owed.count + (s.owed.count === 1 ? " invoice" : " invoices"), () => window.NovaInvoicer.open({})),
      tile(money(s.overdue.pence), "Overdue · " + s.overdue.count, () => window.NovaInvoicer.open({ filter: "overdue" }), s.overdue.count > 0),
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

  // Invoices are done in the Invoicer, directly (the user, 19 Oct 2026: "anything to do with invoicing …
  // put it into the Nova Invoicer directly"): here, what's waiting and the ways into it
  function invoiceNodes() {
    const k = K();
    const all = data.invoices;
    const s = data.summary;
    const waitingN = all.filter((i) => waiting(i) || i.status === "failed").length;
    const remindersN = data.reminders.filter((r) => r.status === "pending_approval").length;
    const card = k.el("article", "card mn-card mn-invoicer");
    card.dataset.key = "mn-invoicer";
    card.dataset.sig = k.sig(s, waitingN, remindersN, all.length, data.canDecide);
    card.appendChild(k.el("h3", "card-title", "Invoices are in the Invoicer"));
    card.appendChild(k.el("p", "card-who", "Writing, approving, payments, reminders, receipts, PDFs, sharing and the invoice settings: all in the Invoicer."));
    const facts = k.el("dl", "cp-facts");
    const fact = (label, value) => facts.append(k.el("dt", "", label), k.el("dd", "", value));
    fact("Owed", money(s.owed.pence) + " · " + s.owed.count + (s.owed.count === 1 ? " invoice" : " invoices"));
    fact("Overdue", money(s.overdue.pence) + " · " + s.overdue.count);
    fact("To approve", waitingN + (waitingN === 1 ? " invoice" : " invoices") + (remindersN ? " and " + remindersN + (remindersN === 1 ? " reminder" : " reminders") : ""));
    card.appendChild(facts);
    const row = k.el("div", "actions");
    button(row, "Open the Invoicer", "", () => window.NovaInvoicer.open({}));
    button(row, "Write an invoice", "ghost", () => window.NovaInvoicer.open({ new: true }));
    if (waitingN || remindersN) button(row, "To approve", "ghost", () => window.NovaInvoicer.open({ filter: "waiting" }));
    if (s.overdue.count) button(row, "Overdue", "ghost", () => window.NovaInvoicer.open({ filter: "overdue" }));
    card.appendChild(row);
    return [card];
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
    // (changed in the Invoicer, with everything else for invoices: 19 Oct 2026)
    const go = k.el("div", "actions");
    button(go, "Change them in the Invoicer", "", () => window.NovaInvoicer.open({ settings: true }));
    card.appendChild(go);
    return card;
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

  // Writing an invoice happens in the Invoicer (19 Oct 2026): it opens with a new one ready to fill in
  $("money-new").addEventListener("click", () => window.NovaInvoicer.open({ new: true }));

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
    if (pence($("mn-exp-amount").value) === null) {
      k.setText("mn-exp-error", "Not saved: the amount in pounds, like 49.99.");
      return $("mn-exp-amount").focus();
    }
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
    const msg = say ? say(res) : done || res.message;
    if (msg) K().toast(msg);
    await load();
    // (a card that didn't change is kept as it was: its buttons work again)
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }

  // show(part): Money opened at Invoices, Expenses or the tax year (the Overview's lines, dash.js)
  window.PortalMoney = { load, show: setPart };
})();
