// Clients & Money, on one screen (25 Oct 2026, the owner: "can you make the rest of nova portal as much as possible
// dashboards please", after Admin: "heavily simplify … put everything onto one screen as much as possible" and "get
// rid of old links please and just keep it simple and optimized"). Clients & Money had an Overview, the Clients and
// Money tabs and seven buttons along the top, and Money its own tiles, three parts and a card about the Invoicer:
// several ways to each thing. Now it's this one dashboard (/portal/?view=money), a panel each side by side, drawn as
// Admin's are (admin.js):
//   - Clients: how many, who owes; a search, in place; the ones that matter now (owing, booked next, the newest),
//     each opening their page; the filters, each opening the whole list narrowed; Add a client, Import from
//     contacts, and for admins Import a spreadsheet and Sync now; Open › for the whole list (/portal/?view=clients);
//   - Money: owed, overdue, to approve, in and out this month; Open the Invoicer and Write an invoice;
//   - Expenses: out this month, the ones to confirm and the latest, each opening in place to change, confirm or
//     remove; Add an expense; Open › for every expense (/portal/?view=money&page=expenses);
//   - Tax year: in, out, the difference, where the money went; the accountant's spreadsheets, Google Sheets;
//   - Invoice settings: how each is set; Change them in the Invoicer.
// The forms (a client, contacts, a spreadsheet, an expense) open in place of the panels (money.css). Everything for
// invoices opens the Invoicer (NovaInvoicer.open). It reads /app/api/money and /app/api/clients once when it's
// opened (and after something's changed): no timers.
//
// Everything comes from Nova Bot (src/money.js and src/clients.js there). Anyone signed in adds clients and
// expenses and changes, confirms or removes expenses. canDecide (from Nova Bot) says whether this person approves
// invoices and changes the invoice settings (in the Invoicer) and downloads the accountant's spreadsheets: an admin
// signed in to Portal in a browser. A receipt's photo goes to the studio PC (POST /actions/receipts: Nova Agent's
// src/receipts.ts, through Nova Bot's relay when online) and the expense keeps its name.
// Money is shown in pounds, days as UK days. Nothing from the server is drawn as HTML.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp && window.PortalApp.kit;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  let data = null; // the last /app/api/money answer
  let people = null; // the last /app/api/clients answer
  let editing = null; // the expense open in the form to change, or null for a new one

  const EXPENSES = "/portal/?view=money&page=expenses";
  const inRoom = () => new URLSearchParams(location.search).get("page") === "expenses";
  // (a room opened from here: a new step in the history, so Back comes back to the dashboard)
  const go = (url) => window.PortalPage && window.PortalPage.go(url);
  const isAdmin = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());
  const invoicer = (what) => () => window.NovaInvoicer.open(what);
  const clients = () => window.PortalClients;
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
  const gbp = (v) => "£" + (Number(v) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const poundsText = (p) => (Math.round(p) / 100).toFixed(2);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const day = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const monthName = (ymd) => new Date(ymd.slice(0, 7) + "-15T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  // "Sat 1 Nov" (and ", 14:00" with the time), UK time
  function short(iso, withTime) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso + "T12:00:00Z" : iso);
    if (!iso || isNaN(d)) return "";
    const o = { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" };
    if (withTime) Object.assign(o, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("en-GB", o).replace(/^(\p{L}+),/u, "$1");
  }
  // The start of the month three months back, as Clients' "Not booked since" starts (app.js monthsAgo)
  function threeMonthsBack() {
    const [y, m] = ukToday().split("-").map(Number);
    const t = y * 12 + (m - 1) - 3;
    return Math.floor(t / 12) + "-" + String((t % 12) + 1).padStart(2, "0") + "-01";
  }

  // ===== Loading: Money's numbers (every section's badge) and, on the dashboard, the clients =====

  async function load() {
    const k = K();
    if (!k) return;
    const here = k.view === "money";
    const [m, c] = await Promise.allSettled([k.api("money"), here && !inRoom() ? k.api("clients") : Promise.resolve(people)]);
    if (m.status === "fulfilled") {
      data = m.value;
      const s = data.summary;
      k.setBadge("money-badge", (data.canDecide ? s.waitingApproval : 0) + s.overdue.count);
      k.setText("t-money", s.overdue.count);
      k.syncCounts();
    }
    // (only the dashboard asked for here: a load for the badges, from the start, can finish after the dashboard
    // is opened, without the clients)
    if (!here || k.view !== "money") return;
    if (c.status === "fulfilled") people = c.value;
    fillChoices();
    draw(m.status === "rejected" ? m.reason : null, c.status === "rejected" ? c.reason : null);
  }

  // The categories, once
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

  // The dashboard, or (page=expenses) every expense
  function draw(moneyErr, clientsErr) {
    const room = inRoom();
    $("cm-grid").hidden = room;
    // (the panels are never drawn smaller to top up a page, index.html; every expense's cards may be, so a page isn't
    // left with the title alone)
    $("view-money").toggleAttribute("data-os-nofill", !room);
    // (the strip along the top drawn again: it steps aside on the dashboard and is the way back from every expense,
    // but pillars.js only redraws when the section changes, and both are Money)
    if (window.NovaPillars) window.NovaPillars.redraw();
    for (const n of document.querySelectorAll("#view-money > .cm-room")) n.hidden = !room;
    if (room) {
      if (data) return K().reconcile($("money-list"), expenseNodes());
      if (moneyErr && moneyErr.message !== "signed out") K().emptyState($("money-list"), "Couldn't load the expenses: " + moneyErr.message);
      return;
    }
    const rest = data ? [moneyPanel(), expensesPanel(), yearPanel(), settingsPanel()] : [moneyPanel(moneyErr)];
    $("cm-grid").replaceChildren(clientsPanel(clientsErr), ...rest);
  }

  // ===== A panel (as Admin's, admin.js): its name (with Open › when it has a room), a count, lines, buttons =====

  function panel(key, name, openIt) {
    const box = el("article", "dash-tile ad-panel cm-panel cm-" + key);
    box.dataset.key = "cm-" + key;
    // (whole on a page, drawn a little smaller if it must be: never its name on one page and its lines on the next)
    box.setAttribute("data-os-keep", "");
    const head = el("div", "dash-tile-head");
    if (window.NovaPillars) head.append(window.NovaPillars.icon(name.replace(/ \d.*$/, "")));
    const badge = el("span", "badge");
    badge.hidden = true;
    head.append(el("h3", "dash-name", name), badge);
    if (openIt) {
      const open = el("button", "dash-open", "Open ›");
      open.type = "button";
      open.setAttribute("aria-label", "Open " + name);
      open.addEventListener("click", openIt);
      head.append(open);
    }
    const top = el("p", "dash-top");
    const big = el("span", "dash-big", "…");
    const small = el("span", "dash-small", "");
    top.append(big, small);
    const rows = el("ul", "dash-rows");
    const foot = el("div", "ad-foot");
    box.append(head, top, rows, foot);
    return { box, badge, big, small, top, rows, foot };
  }
  // A line: its words, how it is now beside them, and what a tap on it opens
  function line(main, side, open) {
    const li = el("li");
    li.append(el("span", "dash-main", main), el("span", "dash-side", side || ""));
    if (open) {
      li.tabIndex = 0;
      li.setAttribute("role", "link");
      li.title = "Open: " + main;
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    return li;
  }
  function button(label, cls, onClick) {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    return b;
  }
  const failed = (p, err) => {
    p.big.textContent = "–";
    p.small.textContent = err && err.message === "signed out" ? "" : "Couldn't load this just now" + (err && err.message ? ": " + err.message : "");
  };
  const badge = (p, n) => {
    p.badge.textContent = String(n);
    p.badge.hidden = !n;
  };
  const empty = (p, text) => p.rows.replaceChildren(el("li", "cm-empty", text));

  // ===== Clients =====

  // The ones that matter now: who owes (the most first), who's booked next (the soonest first), then the newest
  // or most lately booked
  function relevant(list) {
    const owing = list.filter((c) => Number(c.outstanding) > 0).sort((a, z) => Number(z.outstanding) - Number(a.outstanding));
    const next = list.filter((c) => c.nextBooked && !owing.includes(c)).sort((a, z) => String(a.nextBooked).localeCompare(String(z.nextBooked)));
    const seen = new Set([...owing, ...next]);
    const rest = list.filter((c) => !seen.has(c)).sort((a, z) => String(z.lastBooked || z.createdAt || "").localeCompare(String(a.lastBooked || a.createdAt || "")));
    return [...owing, ...next, ...rest];
  }
  const clientSide = (c) =>
    Number(c.outstanding) > 0 ? "owes " + gbp(c.outstanding) : c.nextBooked ? "next " + short(c.nextBooked, true) : c.lastBooked ? "last booked " + short(c.lastBooked) : c.createdAt ? "added " + short(c.createdAt) : "";
  const clientLine = (c, side) => line(c.name || c.email || c.phone || "A client", side, () => go("/portal/?view=clients&client=" + c.id));

  function clientsPanel(err) {
    const p = panel("clients", "Clients", () => clients().list());
    // The search (in place: the panel's lines become who matches; Enter, or All …, opens the whole list with it)
    // and the filters (each opening the whole list narrowed, the same as its chip there)
    const tools = el("div", "cm-tools");
    const search = el("input", "cm-search");
    search.type = "search";
    search.placeholder = "Search by name, email or phone";
    search.setAttribute("aria-label", "Search clients");
    search.autocomplete = "off";
    search.enterKeyHint = "search";
    const filters = el("div", "cm-filters");
    tools.append(search, filters);
    p.top.after(tools);
    p.foot.append(button("+ Add a client", "btn small", () => clients().add()), button("Import from contacts", "chip", () => clients().contacts()));
    if (isAdmin()) p.foot.append(button("Import a spreadsheet", "chip", () => clients().sheet()), syncButton());
    if (err) {
      failed(p, err);
      return p.box;
    }
    const list = (people && people.clients) || [];
    const total = Number(people && people.total) || list.length;
    const owing = list.filter((c) => Number(c.outstanding) > 0);
    const owed = owing.reduce((n, c) => n + Math.round((Number(c.outstanding) || 0) * 100), 0);
    const since = threeMonthsBack();
    const lapsed = list.filter((c) => c.lastBooked && c.lastBooked < since && !c.nextBooked).length;
    const enquiries = list.filter((c) => c.source === "enquiry" && !c.sessionCount).length;
    p.big.textContent = plural(total, "client");
    p.small.textContent = [owing.length ? `${owing.length} ${owing.length === 1 ? "owes" : "owe"} ${money(owed)}` : "Nobody owes anything", `${list.filter((c) => c.nextBooked).length} booked ahead`].join(" · ");
    const sinceName = new Date(since + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
    for (const [filter, label, n] of [["owing", "Owes money", owing.length], ["lapsed", "Not booked since " + sinceName, lapsed], ["enquiry", "Enquiries only", enquiries]]) {
      const chip = button(`${label} · ${n}`, "chip", () => clients().list({ filter }));
      chip.title = "The whole list, narrowed to these";
      filters.append(chip);
    }
    const SHOW = 8;
    const usual = () => (list.length ? p.rows.replaceChildren(...relevant(list).slice(0, SHOW).map((c) => clientLine(c, clientSide(c)))) : empty(p, "No clients yet. They come as people book and send enquiries, or add one."));
    usual();
    let asked = 0;
    let timer = 0;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const words = search.value.trim();
        const mine = ++asked;
        if (!words) return usual();
        try {
          const r = await K().api("clients?" + new URLSearchParams({ filter: "all", search: words }));
          if (mine !== asked) return;
          const found = r.clients || [];
          const n = Number(r.total) || found.length;
          if (!found.length) return empty(p, `No clients match “${words}”.`);
          const shown = found.slice(0, n > SHOW ? SHOW - 1 : SHOW).map((c) => clientLine(c, [c.email, c.phone].filter(Boolean)[0] || clientSide(c)));
          if (n > shown.length) shown.push(line(`All ${n} who match ›`, "", () => clients().list({ search: words })));
          p.rows.replaceChildren(...shown);
        } catch (e) {
          if (mine === asked && e.message !== "signed out") empty(p, "Couldn't search just now: " + e.message);
        }
      }, 250);
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !search.value.trim()) return;
      e.preventDefault();
      clients().list({ search: search.value.trim() });
    });
    return p.box;
  }
  // Admins: sync from the studio's bookings and enquiries now
  function syncButton() {
    const b = button("Sync now", "chip", async () => {
      b.disabled = true;
      b.textContent = "Syncing…";
      try {
        const r = await K().api("clients/sync", { body: {} });
        const c = r.clients || {};
        const s = r.sessions || {};
        K().toast(c.added || c.updated || s.added || s.updated ? "Synced: " + (c.added || 0) + " new clients, " + (s.added || 0) + " new sessions" : "Synced: already up to date");
        load();
      } catch (err) {
        if (err.message !== "signed out") K().toast("Couldn't sync: " + err.message);
        b.disabled = false;
        b.textContent = "Sync now";
      }
    });
    return b;
  }

  // ===== Money: owed, overdue, to approve, in and out (each opening where it's dealt with) =====

  function moneyPanel(err) {
    const p = panel("money", "Money");
    // (everything for invoices is in the Invoicer, 19 Oct 2026: these open it, set up for the job)
    p.foot.append(button("Open the Invoicer", "btn small", invoicer({})), button("Write an invoice", "chip", invoicer({ new: true })));
    if (err || !data) {
      failed(p, err);
      return p.box;
    }
    const s = data.summary;
    const waitingN = data.invoices.filter((i) => waiting(i) || i.status === "failed").length;
    const remindersN = data.reminders.filter((r) => r.status === "pending_approval").length;
    badge(p, (data.canDecide ? s.waitingApproval : 0) + s.overdue.count);
    p.big.textContent = money(s.owed.pence);
    p.small.textContent = "owed · " + plural(s.owed.count, "invoice");
    const overdue = line("Overdue", money(s.overdue.pence) + " · " + plural(s.overdue.count, "invoice"), invoicer({ filter: "overdue" }));
    overdue.classList.toggle("cm-warn", s.overdue.count > 0);
    p.rows.replaceChildren(
      overdue,
      line("To approve", plural(waitingN, "invoice") + (remindersN ? " · " + plural(remindersN, "reminder") : ""), invoicer({ filter: "waiting" })),
      line("In this month", money(s.month.inPence), invoicer({ accounts: true })),
      line("Out this month", money(s.month.outPence), () => go(EXPENSES))
    );
    if (!data.canDecide) p.top.title = "An admin approves each invoice (signed in to Portal in a browser) before it's emailed to the client.";
    return p.box;
  }

  // ===== Expenses: the ones to confirm and the latest, each opening in the form, in place =====

  const newestFirst = (a, z) => String(z.spentOn).localeCompare(String(a.spentOn)) || z.id - a.id;
  function expensesPanel() {
    const p = panel("expenses", "Expenses", () => go(EXPENSES));
    const s = data.summary;
    const list = data.expenses || [];
    const toConfirm = list.filter((e) => e.status === "unconfirmed").sort(newestFirst);
    const done = list.filter((e) => e.status === "confirmed").sort(newestFirst);
    badge(p, toConfirm.length);
    p.big.textContent = money(s.month.outPence);
    p.small.textContent = "out this month" + (toConfirm.length ? ` · ${toConfirm.length} to confirm` : "");
    const shown = [...toConfirm, ...done].slice(0, 4);
    if (shown.length) p.rows.replaceChildren(...shown.map((e) => line(money(e.amountPence) + " · " + e.category, e.status === "unconfirmed" ? "to confirm" : [e.supplier, short(e.spentOn)].filter(Boolean).join(" · "), () => openExpenseForm(e))));
    else empty(p, "No expenses yet. Add one: its receipt can go with it.");
    p.foot.append(button("+ Add an expense", "btn small", () => openExpenseForm(null)));
    return p.box;
  }

  // Every expense, by month (page=expenses): each confirmed, changed or removed where it is
  function expenseNodes() {
    const k = K();
    const nodes = [];
    const list = data.expenses;
    const toConfirm = list.filter((x) => x.status === "unconfirmed");
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
    if (e.status === "unconfirmed") row.append(button("Confirm", "btn small", () => act(card, "money/expenses/" + e.id + "/confirm", "Confirmed")));
    row.append(button("Edit", "btn small ghost", () => openExpenseForm(e)));
    row.append(
      button("Remove", "btn small ghost", (b) => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = "Remove " + money(e.amountPence) + "?";
          return;
        }
        act(card, "money/expenses/" + e.id + "/delete", "Removed");
      })
    );
    card.appendChild(row);
    return card;
  }

  // ===== The tax year: in, out, where it went; the accountant's spreadsheets =====

  function yearPanel() {
    const s = data.summary;
    const y = s.taxYear;
    const p = panel("year", "Tax year " + y.name);
    p.big.textContent = money(y.inPence - y.outPence);
    p.small.textContent = "in less out · " + day(y.from) + " to " + day(y.to);
    const rows = [line("In (payments)", money(y.inPence), invoicer({ accounts: true })), line("Out (expenses)", money(y.outPence), () => go(EXPENSES))];
    const most = y.outByCategory && y.outByCategory[0];
    if (most) rows.push(line("Most went on " + most.category, money(most.pence), () => go(EXPENSES)));
    if (s.unconfirmedExpenses) rows.push(line(plural(s.unconfirmedExpenses, "expense") + " not counted", "not confirmed yet", () => go(EXPENSES)));
    p.rows.replaceChildren(...rows.slice(0, 4));
    // For the accountant: this tax year's spreadsheets (admins), and the same live in Google Sheets (once Google is
    // connected: Portal → Admin → Google; google.js)
    if (data.canDecide) {
      for (const [what, label] of [["invoices", "Invoices"], ["payments", "Payments"], ["expenses", "Expenses"]]) {
        const a = el("a", "chip", label + " CSV");
        a.href = "/app/api/money/export.csv?what=" + what + "&from=" + y.from + "&to=" + y.to;
        a.setAttribute("download", "");
        a.title = label + " this tax year, a spreadsheet for the accountant";
        p.foot.append(a);
      }
    } else p.box.append(el("p", "ad-hint", "An admin downloads the accountant's spreadsheets, signed in to Portal in a browser."));
    if (window.PortalGoogle) p.foot.append(button("Google Sheets ↗", "chip", () => window.PortalGoogle.openSheet()));
    return p.box;
  }

  // ===== Invoice settings: how each is set (changed in the Invoicer, with everything else for invoices) =====

  function settingsPanel() {
    const st = data.settings;
    const p = panel("settings", "Invoice settings");
    const set = [data.emailReady, data.cardReady, st.bankReady, st.monzoReady].filter(Boolean).length;
    p.big.textContent = set === 4 ? "All set" : `${set} of 4 set up`;
    p.small.textContent = "how invoices go out and get paid";
    const change = data.canDecide ? invoicer({ settings: true }) : null;
    p.rows.replaceChildren(
      // (emailing and cards are Nova Bot's keys, not the Invoicer's settings: those lines open nothing)
      line("Emailing invoices", data.emailReady ? "Ready" : "Not set up (Nova Bot's email key)", null),
      line("Pay by card", data.cardReady ? "Ready (Stripe)" : "Not set up (Stripe)", null),
      line("Bank details", st.bankReady ? "On every invoice" : "Not added yet", change),
      line("Pay with Monzo", st.monzoReady ? "On every invoice" : "Not added yet", change)
    );
    if (change) p.foot.append(button("Change them in the Invoicer", "btn small", change));
    else p.box.append(el("p", "ad-hint", "An admin changes these, signed in to Portal in a browser."));
    return p.box;
  }

  // ===== Adding, changing, confirming or removing an expense: its form, in place of the panels =====

  function openExpenseForm(e) {
    const k = K();
    editing = e || null;
    $("mn-exp-amount").value = e ? poundsText(e.amountPence) : "";
    $("mn-exp-category").value = e ? e.category : "Equipment";
    $("mn-exp-supplier").value = e ? e.supplier : "";
    $("mn-exp-day").value = e ? e.spentOn : ukToday();
    $("mn-exp-day").max = ukToday();
    $("mn-exp-note").value = e ? e.note : "";
    $("mn-exp-receipt").value = "";
    k.setText("mn-exp-error", "");
    $("money-expense-form").querySelector(".card-title").textContent = e ? "Change an expense" : "Add an expense";
    $("mn-exp-save").textContent = e ? "Save" : "Add it";
    $("mn-exp-confirm").hidden = !(e && e.status === "unconfirmed");
    const remove = $("mn-exp-remove");
    remove.hidden = !e;
    remove.dataset.sure = "";
    remove.textContent = "Remove";
    // (one form at a time: a client's form left open is shut)
    for (const f of document.querySelectorAll("#view-money .cm-forms > form")) f.hidden = f.id !== "money-expense-form";
    $("mn-exp-amount").focus({ preventScroll: true });
  }
  const closeExpenseForm = () => ($("money-expense-form").hidden = true);
  $("money-expense-new").addEventListener("click", () => openExpenseForm(null));
  $("mn-exp-cancel").addEventListener("click", closeExpenseForm);

  // Confirm it (one Agent noted) and Remove (a second press says how much), from the form
  async function formAct(path, done, b) {
    const k = K();
    b.disabled = true;
    try {
      await k.api(path, { body: {} });
    } catch (err) {
      if (err.message !== "signed out") k.setText("mn-exp-error", err.message);
      return;
    } finally {
      b.disabled = false;
    }
    closeExpenseForm();
    k.toast(done);
    load();
  }
  $("mn-exp-confirm").addEventListener("click", (e) => editing && formAct("money/expenses/" + editing.id + "/confirm", "Confirmed", e.currentTarget));
  $("mn-exp-remove").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (!editing) return;
    if (b.dataset.sure !== "1") {
      b.dataset.sure = "1";
      b.textContent = "Remove " + money(editing.amountPence) + "?";
      return;
    }
    formAct("money/expenses/" + editing.id + "/delete", "Removed", b);
  });

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
    const b = e.submitter || $("mn-exp-save");
    b.disabled = true;
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
      await k.api(editing ? "money/expenses/" + editing.id + "/edit" : "money/expenses", { body });
    } catch (err) {
      if (err.message !== "signed out") k.setText("mn-exp-error", "Not saved: " + err.message);
      return;
    } finally {
      b.disabled = false;
    }
    closeExpenseForm();
    k.toast(editing ? "Changed" : "Expense added");
    load();
  });

  // ===== Shared bits =====

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
  // Press a button on an expense's card: Nova Bot does it, the list comes back
  async function act(card, path, done) {
    card.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await K().api(path, { body: {} });
    } catch (err) {
      if (err.message === "signed out") return;
      return problem(card, err.message);
    }
    K().toast(done);
    await load();
    // (a card that didn't change is kept as it was: its buttons work again)
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }

  window.PortalMoney = { load };
})();
