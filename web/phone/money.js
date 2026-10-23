// Nova Phone: Money, everything Nova Desk's Invoicer and Portal → Money do, made for the phone.
//   Invoices   owed (on how many), overdue and this month; the list by where each invoice is (deposit, balance,
//              overdue, paid, to approve, removed), searched as you type, a dot where a reminder or receipt waits;
//              a new invoice from the studio's services, with a live preview as you type
//   An invoice the invoice itself, drawn as the client gets it (its card and Monzo buttons at every stage), at the
//              stage chosen, with where it really is now and what's due now; its PDF (in its look, with the note);
//              its page on its own; its email (subject and words to change, seen as the client gets it, copied, a
//              test to yourself) and what Send does now (approve and email, queue a reminder or the receipt,
//              approve the waiting one, reject); its notes and look (saved on it); record a payment; change it;
//              share it yourself (the message to change first); remove it; its history
//   Expenses   by month, with receipt photos; noted by Nova Agent ones to confirm
//   Tax year   in, out, by category; the accountant's files and Google Sheets; the invoice settings (admins)
// Approving, rejecting, removing and the settings are for an admin signed in on this phone (as on Nova Desk).
//
// Its addresses (the same jobs as Nova Desk's /invoicer/?… addresses, so anywhere in Nova Phone can link here):
//   #money                              the list            ?filter=deposit|balance|overdue|paid|waiting|removed  ?q=words
//   #money/new                          a new invoice       ?name=  &email=  &billing=deposit|full
//   #money/invoice/<id>                 that invoice        ?stage=deposit|balance|overdue|paid
//   #money/invoice/<id>/<job>           …and the place to do: pay | history | share | pdf | email | edit | send | approve
//                                                            | remind | reject | test | remove (never done by itself)
//   #money/number/NS-0022(/<job>)       the same, by its number
//   #money/reminder/<id>                a reminder's invoice, with its history
//   #money/accounts                     money at a glance and the accountant's files
//   #money/settings  #money/expenses  #money/expense/<id|new>  #money/tax
//   #money/?invoice=32&do=send …        Nova Desk's own /invoicer/?… words after #money/ work too (and after #money
//                                        once phone.js reads ?… off the place's name)
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, form: sheetForm, busy, money, initials } = N;
  const A = "/app/api/money";
  // (the studio's days are UK days, as Nova Bot's)
  const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const when = (v) => { const d = N.asDate(v); return d ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : ""; };
  const pounds = (p) => ((Number(p) || 0) / 100).toFixed(2);
  const toPence = (t) => { const s = String(t ?? "").replace(/[£,\s]/g, ""); const n = Number(s); return s !== "" && Number.isFinite(n) ? Math.round(n * 100) : NaN; };
  const STATUS = { draft: "Draft", pending_approval: "To approve", approved: "Approved", rejected: "Rejected", failed: "Didn't send", sent: "Sent", part_paid: "Part paid", paid: "Paid", void: "Removed" };
  const WAITING = ["draft", "pending_approval", "approved", "rejected", "failed"];
  const STAGES = [["deposit", "Deposit"], ["balance", "Balance"], ["overdue", "Overdue"], ["paid", "Paid"]];
  const STAGE_NAMES = { deposit: "Deposit due", balance: "Balance due", overdue: "Overdue", paid: "Paid receipt" };
  const EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Emailed to the client", failed: "Didn't send", payment: "Payment", payment_removed: "Payment taken back", paid: "Paid in full", reminder: "Reminder", voided: "Removed", renumbered: "Renumbered" };
  // The same as Nova Bot's stageOf (src/invoicer.js), for the list
  const stageOf = (i) => (i.paidPence >= i.totalPence || i.status === "paid" ? "paid" : ["sent", "part_paid"].includes(i.status) && i.dueDate < ukToday() ? "overdue" : i.paidPence > 0 || i.billing === "full" ? "balance" : "deposit");
  const FILTERS = [["all", "All"], ["deposit", "Deposit"], ["balance", "Balance"], ["overdue", "Overdue"], ["paid", "Paid"], ["waiting", "To approve"], ["removed", "Removed"]];
  const ALIAS = { approve: "waiting", void: "removed" };
  const JOBS = ["pay", "history", "share", "pdf", "email", "edit", "send", "approve", "remind", "reject", "test", "remove"];
  // (the look last chosen, kept in this browser as Nova Desk keeps it: a new invoice is made in it)
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* (private window) */ } return null; };

  let data = null, catalogue = null, clients = null, filter = "all", search = "", lastHash = "", lastPlace = "";
  async function load() { data = await api(`${A}?status=all`); return data; }
  const CAT0 = { services: [], themes: [], papers: [], modes: ["bright", "dark"], depositPercent: 50, theme: "night", mode: "bright", paper: "moonstone" };
  async function cat() { if (!catalogue) catalogue = await api(`${A}/catalogue`).catch(() => null); return catalogue || CAT0; }
  // What's kept for each invoice while the app is open: the stage shown, the email's words, the note, the look
  const kept = new Map();
  const keepOf = (id) => { if (!kept.has(String(id))) kept.set(String(id), { inited: false }); return kept.get(String(id)); };

  // ---- The address ----
  function where() {
    const h = location.hash.slice(1);
    const qi = h.indexOf("?");
    const ask = new URLSearchParams(qi < 0 ? "" : h.slice(qi + 1));
    const parts = (qi < 0 ? h : h.slice(0, qi)).split("/").map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
    parts.shift();
    while (parts.length && parts[parts.length - 1] === "") parts.pop();
    return { parts, ask };
  }
  const hashOf = (parts, q) => { const s = q ? String(q) : ""; return `#money${parts.length ? `/${parts.map(encodeURIComponent).join("/")}` : s ? "/" : ""}${s ? `?${s}` : ""}`; };
  const pick = (ask, keys) => { const q = new URLSearchParams(); for (const k of keys) if (ask.get(k)) q.set(k, ask.get(k)); return q; };
  // Nova Desk's own words (?invoice=32&do=send, ?new=1&name=, ?reminder=4, ?settings=1, ?accounts=1) → this place's
  function fromDesk(ask) {
    const job = JOBS.includes(ask.get("do")) ? [ask.get("do")] : [];
    if (ask.get("accounts")) return hashOf(["accounts"]);
    if (ask.get("settings")) return hashOf(["settings"]);
    if (ask.get("new")) return hashOf(["new"], pick(ask, ["name", "email", "billing"]));
    if (Number(ask.get("invoice"))) return hashOf(["invoice", String(Number(ask.get("invoice"))), ...job], pick(ask, ["stage"]));
    if (ask.get("number")) return hashOf(["number", ask.get("number").slice(0, 30), ...job], pick(ask, ["stage"]));
    if (Number(ask.get("reminder"))) return hashOf(["reminder", String(Number(ask.get("reminder")))]);
    return null;
  }
  const swap = (h) => { history.replaceState(history.state, "", h); lastHash = location.hash; };
  const listHash = () => hashOf([], new URLSearchParams([...(filter !== "all" ? [["filter", filter]] : []), ...(search ? [["q", search]] : [])]));

  N.section({
    id: "money",
    name: "Money",
    tile: "invoicer",
    async draw(box, _path, ui) {
      await N.css("money.css");
      let { parts, ask } = where();
      const fresh = location.hash !== lastHash;
      lastHash = location.hash;
      if (!parts.length) { const to = fromDesk(ask); if (to) { swap(to); ({ parts, ask } = where()); } }
      await load();
      let [part, a, b] = parts;
      // (by its number, or a reminder's invoice: shown at the invoice's own address)
      if (part === "number") {
        const inv = (data.invoices || []).find((i) => i.number.toLowerCase() === String(a || "").toLowerCase());
        if (!inv) return missing(box, ui, `There's no invoice ${a || ""}`.trim());
        swap(hashOf(["invoice", String(inv.id), ...(JOBS.includes(b) ? [b] : [])], pick(ask, ["stage"])));
        [part, a, b] = ["invoice", String(inv.id), b];
      }
      if (part === "reminder") {
        const r = (data.reminders || []).find((x) => String(x.id) === String(a));
        if (!r) return missing(box, ui, "That reminder isn't here any more", "It may have been sent or rejected a while ago: its invoice's history has it.");
        swap(hashOf(["invoice", String(r.invoiceId), "history"]));
        [part, a, b] = ["invoice", String(r.invoiceId), "history"];
      }
      if (part !== "settings") lastPlace = location.hash;
      if (part === "invoice" && b === "history") return drawHistory(box, a, ui);
      if (part === "invoice" && b === "email") return drawEmail(box, a, ui);
      if ((part === "invoice" && b === "edit") || part === "edit") {
        const inv = (data.invoices || []).find((i) => String(i.id) === String(a));
        if (!inv) return missing(box, ui, "That invoice isn't there");
        if (["paid", "void"].includes(inv.status)) { swap(hashOf(["invoice", String(inv.id)])); toast(inv.status === "paid" ? "Paid in full: it can't change" : "Removed: it can't change", true); return drawInvoice(box, a, ui, null, ask, fresh); }
        return drawForm(box, inv, ui, ask);
      }
      if (part === "invoice") return drawInvoice(box, a, ui, fresh && JOBS.includes(b) ? b : null, ask, fresh);
      if (part === "new") return drawForm(box, null, ui, ask);
      if (part === "expenses") return drawExpenses(box, ui);
      if (part === "expense") return drawExpenseForm(box, a, ui);
      if (part === "tax") return drawTax(box, ui);
      if (part === "settings") return drawSettings(box, ui);
      if (part === "accounts") return drawAccounts(box, ui);
      return drawList(box, ui, ask, fresh);
    },
  });
  function missing(box, ui, title, text = "") {
    ui.back("#money");
    box.innerHTML = empty({ icon: "money", title, text, action: `<a class="btn" href="#money">${icon("back")} All the invoices</a>` });
  }

  const PARTS = [["invoices", "Invoices"], ["expenses", "Expenses"], ["tax", "Tax year"]];
  const partTabs = (on) => `<div class="seg">${PARTS.map(([p, l]) => `<a class="seg-a" href="#money${p === "invoices" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;
  // How clients pay: the bank details, Monzo and card, on every invoice (an admin adds them)
  function payWays() { const st = data.settings || {}; return [st.bankReady && "Bank transfer", st.monzoReady && "Monzo", data.cardReady && "Card"].filter(Boolean); }
  function payRow() {
    const w = payWays(), admin = !!data.canDecide;
    return list([row({ ...(admin ? { href: "#money/settings" } : {}), icon: "money", title: "How clients pay", text: w.length ? `${w.join(" and ")} ✓` : admin ? "Add bank details" : "Not set up yet (an admin adds it)", cls: w.length ? "" : "money-missing" })]);
  }

  // ---- The invoices ----
  const tag = (i) => {
    if (i.status === "void") return `<span class="pill">Removed</span>`;
    if (WAITING.includes(i.status)) return `<span class="pill ${["rejected", "failed"].includes(i.status) ? "bad" : "warn"}">${i.status === "rejected" ? "Rejected" : i.status === "failed" ? "Didn't send" : "To approve"}</span>`;
    const s = stageOf(i);
    return `<span class="pill ${s === "overdue" ? "bad" : s === "paid" ? "ok" : ""}">${STAGE_NAMES[s]}</span>`;
  };
  function shown() {
    const q = search.toLowerCase();
    const reminding = new Set((data.reminders || []).filter((r) => r.status === "pending_approval").map((r) => r.invoiceId));
    const rows = (data.invoices || []).filter((i) => (filter === "removed" ? i.status === "void" : i.status !== "void")).filter((i) => {
      const waiting = WAITING.includes(i.status);
      if (filter === "waiting" && !waiting && !reminding.has(i.id)) return false;
      if (["deposit", "balance", "overdue", "paid"].includes(filter) && (waiting || stageOf(i) !== filter)) return false;
      return !q || i.number.toLowerCase().includes(q) || String(i.billTo?.name || "").toLowerCase().includes(q);
    });
    return { rows, reminding };
  }
  const invRow = (i, reminding) => row({
    href: `#money/invoice/${i.id}`, lead: `<span class="av">${esc(initials(i.billTo?.name))}</span>`, title: i.billTo?.name || "", text: `${i.number} · ${day(i.issueDate)}`,
    html: reminding.has(i.id) ? `<span class="money-waits"><i class="money-dot" aria-hidden="true"></i>A reminder or receipt is waiting for an admin</span>` : "",
    end: `<b>${money(i.totalPence)}</b>${tag(i)}`,
  });
  function drawList(box, ui, ask, fresh) {
    ui.action({ icon: "plus", label: "New invoice", href: "#money/new" });
    if (fresh) {
      const f = ALIAS[ask.get("filter")] || ask.get("filter");
      filter = f && FILTERS.some(([x]) => x === f) ? f : "all";
      search = (ask.get("q") || "").slice(0, 80);
    }
    const s = data.summary || {}, admin = !!data.canDecide;
    const owed = s.owed?.count || 0;
    box.innerHTML = `${partTabs("invoices")}
      <div class="sums">
        <button type="button" class="sum" data-f="all" aria-label="Owed: ${money(s.owed?.pence)} on ${owed} invoice${owed === 1 ? "" : "s"}"><b>${money(s.owed?.pence)}</b><span>Owed · ${owed}</span></button>
        <button type="button" class="sum${s.overdue?.count ? " bad" : ""}" data-f="overdue" aria-label="Overdue: ${money(s.overdue?.pence)} on ${s.overdue?.count || 0}"><b>${money(s.overdue?.pence)}</b><span>Overdue · ${s.overdue?.count || 0}</span></button>
        <button type="button" class="sum" data-f="paid"><b>${money(s.month?.inPence)}</b><span>In this month</span></button>
      </div>
      ${payWays().length ? "" : payRow()}
      <div class="chips" data-chips>${FILTERS.map(([f, l]) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${f === filter}">${l}</button>`).join("")}</div>
      <form class="search" data-money-search role="search"><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search artist or number" autocomplete="off" enterkeyhint="search"></label></form>
      <div class="money-rows" data-rows></div>
      ${list([row({ href: "#money/accounts", icon: "money", title: "Money at a glance", text: "Owed and overdue, the tax year, and the accountant's spreadsheets" })])}
      ${admin && (data.invoices || []).some((i) => /^NS-/.test(i.number)) ? `<button type="button" class="btn quiet wide money-small" data-restart>Start numbers again at NS-0001</button>` : ""}`;
    const paint = () => {
      const { rows, reminding } = shown();
      box.querySelector("[data-rows]").innerHTML = rows.length ? list(rows.map((i) => invRow(i, reminding)))
        : empty({ icon: "money", title: (data.invoices || []).length ? "None like that" : "No invoices yet", text: (data.invoices || []).length ? "" : "Make the first with New invoice.", action: (data.invoices || []).length ? "" : `<a class="btn main" href="#money/new">${icon("plus")} New invoice</a>` });
      box.querySelectorAll("[data-chips] [data-f]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.f === filter)));
      if (location.hash.startsWith("#money") && !/^#money\/[a-z]/.test(location.hash)) swap(listHash());
    };
    box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; paint(); }));
    const form = box.querySelector("[data-money-search]");
    form.elements.q.addEventListener("input", (e) => { search = e.target.value.trim().slice(0, 80); paint(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); e.target.elements.q.blur(); });
    box.querySelector("[data-restart]")?.addEventListener("click", (e) => restart(e.currentTarget));
    paint();
  }
  // Start the numbers again (admins, while testing): sure first, as every button that can't be undone here
  async function restart(btn) {
    if (!(await confirm({ title: "Start the numbers again?", text: "While testing: every invoice so far becomes a TEST invoice (TEST-0001…, nothing is deleted) and the next one is NS-0001.", ok: "Yes, start again", danger: true }))) return;
    await busy(btn, "Renumbering…", async () => {
      try {
        const r = await post(`${A}/invoices/renumber`, { confirm: "start again" });
        kept.clear();
        toast(`${r.renumbered} invoice${r.renumbered === 1 ? " is" : "s are"} now TEST invoices (kept, nothing deleted). The next one is NS-0001.`);
        await N.show();
      } catch (err) { toast(err.message, true); }
    });
  }

  // ---- Money at a glance and the accountant's spreadsheets ----
  function drawAccounts(box, ui) {
    ui.back("#money");
    ui.title("Money at a glance");
    const s = data.summary || {}, t = s.taxYear, admin = !!data.canDecide;
    const facts = [["Owed", `${money(s.owed?.pence)} on ${s.owed?.count || 0} invoice${s.owed?.count === 1 ? "" : "s"}`], ["Overdue", `${money(s.overdue?.pence)} on ${s.overdue?.count || 0}`], ["In this month", money(s.month?.inPence)], ...(t ? [[`Tax year ${t.name || ""}`.trim(), `${money(t.inPence)} in`]] : [])];
    box.innerHTML = `<div class="card"><div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      <div class="btns two"><a class="btn" href="#money/?filter=overdue">Show the overdue ones</a><a class="btn" href="#money/?filter=waiting">Show the ones to approve</a></div>
      ${accountant(t, admin)}`;
    wireSheet(box);
  }
  function accountant(t, admin) {
    const csv = (what) => `${A}/export.csv?what=${what}&from=${encodeURIComponent(t?.from || "")}&to=${encodeURIComponent(t?.to || "")}`;
    return `<h3 class="h">For the accountant</h3>
      ${admin && t ? `<p class="muted small money-say">This tax year's spreadsheets.</p><div class="btns two"><a class="btn" href="${csv("invoices")}" download>Invoices (CSV)</a><a class="btn" href="${csv("payments")}" download>Payments (CSV)</a><a class="btn" href="${csv("expenses")}" download>Expenses (CSV)</a></div>` : `<p class="muted small money-say">An admin downloads these.</p>`}
      <button type="button" class="btn wide" data-sheet>${icon("globe")} Open in Google Sheets</button>
      <p class="muted small money-say">With Google connected, each sent invoice is also kept in Google Drive (Nova Agent/Invoices), up to date when it's paid.</p>`;
  }
  // The same, live in Google Sheets (once Google is connected)
  function wireSheet(box) {
    box.querySelector("[data-sheet]")?.addEventListener("click", (e) => {
      const w = window.open("about:blank", "_blank");
      busy(e.currentTarget, "Bringing it up to date…", async () => {
        try {
          const r = await post("/app/api/google/sheet", {});
          if (!r.url) throw new Error("Google didn't give a link: is Google connected (Portal → Google)?");
          if (w && !w.closed) w.location.href = r.url; else location.href = r.url;
        } catch (err) { if (w) w.close(); toast(err.message, true); }
      });
    });
  }

  // ---- One invoice ----
  async function drawInvoice(box, id, ui, job, ask, fresh) {
    ui.back(listHash());
    const k = keepOf(id);
    if (fresh && STAGE_NAMES[ask?.get("stage")]) k.stage = ask.get("stage");
    let detail, staged;
    try {
      [detail, staged] = await Promise.all([api(`${A}/invoices/${encodeURIComponent(id)}`), api(`${A}/invoices/${encodeURIComponent(id)}/stage${k.stage ? `?stage=${k.stage}` : ""}`)]);
    } catch (err) {
      if (err.status === 404) return missing(box, ui, "That invoice isn't there");
      throw err;
    }
    const c = await cat();
    const inv = staged.invoice || detail.invoice;
    ui.title(inv.number);
    // (what's kept: the note and the email as they were last typed here, until the invoice or the stage changes)
    if (!k.inited || k.baseNotes !== (inv.notes || "")) { k.note = inv.notes || ""; k.baseNotes = inv.notes || ""; }
    if (!k.inited) k.look = { theme: inv.look?.theme || null, mode: inv.look?.mode || null, paper: inv.look?.paper || null };
    if (!k.inited || k.mailStage !== staged.stage) { k.subject = staged.email?.subject || ""; k.body = staged.email?.body || ""; k.mailStage = staged.stage; }
    k.stage = staged.stage;
    k.inited = true;
    const V = { id: String(inv.id), inv, detail, staged, c, admin: !!data.canDecide, k };
    box.innerHTML = `<div class="card money-head" data-head></div>
      <fieldset class="field"><legend>See it at</legend><div class="seg money-stages" data-stages></div><small>The dot marks where it is now (from its payments and due date).</small></fieldset>
      <div class="money-tools" data-tools></div>
      <section class="card money-mail" data-mail aria-label="The email"></section>
      <div class="money-doc" data-doc><iframe title="The invoice, as the client gets it" scrolling="no"></iframe></div>
      <section class="card money-look" data-look aria-label="On the invoice"></section>
      <div class="money-tools" data-more></div>`;
    paintInvoice(box, V);
    const frame = box.querySelector("[data-doc] iframe");
    sizeFrame(frame, k);
    frame.src = docSrc(V);
    wireInvoice(box, V);
    // (once it's on screen: the place to do it, never done by itself; only when the address is new, so a redraw
    // doesn't do it again)
    if (job) setTimeout(() => runJob(box, V, job), 0);
  }
  function docSrc(V, kind = "document") {
    const q = new URLSearchParams({ stage: V.staged.stage });
    for (const x of ["theme", "mode", "paper"]) if (V.k.look[x]) q.set(x, V.k.look[x]);
    if (V.k.note.trim() !== (V.inv.notes || "").trim()) q.set("note", V.k.note.trim());
    return `${A}/invoices/${V.id}/${kind}?${q}`;
  }
  const canShare = (V) => V.inv.status !== "void" && Boolean(V.inv.pageUrl || (V.admin && WAITING.includes(V.inv.status) && V.inv.status !== "rejected"));
  const canPay = (V) => ["sent", "part_paid"].includes(V.inv.status);
  const canRemove = (V) => V.admin && V.inv.status !== "void" && !(V.inv.paidPence > 0);
  function paintInvoice(box, V) {
    const { inv, staged } = V;
    const sums = staged.sums || {};
    const auto = staged.autoStage || stageOf(inv);
    const parts = [`Total ${money(sums.totalPence ?? inv.totalPence)}`];
    if (sums.paidPence) parts.push(`paid ${money(sums.paidPence)}`);
    parts.push(staged.stage === "paid" ? "nothing left to pay" : `due now ${money(sums.dueNowPence)}`);
    const state = inv.status === "void" ? "Removed" : WAITING.includes(inv.status) ? STATUS[inv.status] : STAGE_NAMES[auto];
    box.querySelector("[data-head]").innerHTML = `<p class="kicker">${esc(inv.number)} · ${esc(state)}</p><h2 class="card-title">${esc(inv.billTo?.name || "")}</h2>
      <p class="muted small">${[inv.billTo?.email || "No email yet", `Issued ${day(inv.issueDate)}`, inv.dueDate ? `${inv.billing === "full" ? "payment due" : "balance due"} ${day(inv.dueDate)}` : ""].filter(Boolean).map(esc).join(" · ")}</p>
      <p class="money-sumline">${esc(parts.join(" · "))}</p>
      ${staged.stage !== auto ? `<p class="small warn money-real">Shown at ${esc(STAGE_NAMES[staged.stage])}: it's really at ${esc(STAGE_NAMES[auto])}.</p>` : `<p class="small muted money-real">Where this invoice is now: ${esc(STAGE_NAMES[auto])}.</p>`}
      ${inv.error ? `<p class="bad small">${esc(inv.error)}</p>` : ""}${inv.status === "rejected" && inv.note ? `<p class="small muted">Why it was rejected: ${esc(inv.note)}</p>` : ""}`;
    box.querySelector("[data-stages]").innerHTML = STAGES.map(([s, l]) => `<label${s === auto ? ' class="money-auto"' : ""}><input type="radio" name="stage" value="${s}"${s === staged.stage ? " checked" : ""}>${l}${s === auto ? '<i class="money-now" aria-hidden="true"></i><span class="sr"> (where it is now)</span>' : ""}</label>`).join("");
    const shareOff = !canShare(V);
    box.querySelector("[data-tools]").innerHTML = `<div class="btns two">
        <a class="btn main" data-pdf href="${esc(docSrc(V, "pdf"))}" target="_blank" rel="noopener">${icon("pdf")} PDF</a>
        <a class="btn" data-open href="${esc(docSrc(V))}" target="_blank" rel="noopener">${icon("globe")} Open</a>
        <button type="button" class="btn" data-do="share"${shareOff ? " disabled" : ""}>${icon("share")} Share</button>
        ${canPay(V) ? `<button type="button" class="btn" data-do="pay">${icon("money")} Payment</button>` : ""}
      </div>
      <p class="muted small money-say">PDF downloads it as it's shown here (stage, look and note). Open shows it on its own page.${shareOff ? ` ${inv.status === "void" ? "Removed: it can't be shared." : inv.status === "rejected" ? "Rejected: change it with Edit and get it approved to share it." : "It can be shared once an admin approves it."}` : ""}</p>`;
    paintMail(box, V);
    paintLook(box, V);
    const more = [];
    if (!["paid", "void"].includes(inv.status)) more.push(`<a class="btn" href="#money/invoice/${V.id}/edit">${icon("edit")} Edit</a>`);
    more.push(`<a class="btn" href="#money/invoice/${V.id}/history">${icon("clock")} History</a>`);
    if (canRemove(V)) more.push(`<button type="button" class="btn danger" data-do="remove">${icon("trash")} Remove</button>`);
    const why = [inv.status === "paid" ? "Paid in full: it can't change." : inv.status === "void" ? "Removed (kept on record)." : "", !canPay(V) && inv.status !== "void" ? (inv.status === "paid" ? "" : "Payments are recorded once it's been sent.") : ""].filter(Boolean).join(" ");
    box.querySelector("[data-more]").innerHTML = `<div class="btns two">${more.join("")}</div>${why ? `<p class="muted small money-say">${esc(why)}</p>` : ""}`;
  }

  // ---- Its email: what Send can do for this invoice, now (as Nova Desk's) ----
  function sendState(V) {
    const { inv, detail, admin } = V;
    const stage = V.staged.stage;
    const reminders = detail?.reminders || [];
    const receipt = inv.status === "paid" || stage === "paid";
    const kind = receipt ? "receipt" : "reminder";
    const waiting = reminders.find((r) => r.status === "pending_approval" && (r.kind || "reminder") === kind);
    const receiptSent = reminders.some((r) => r.kind === "receipt" && r.status === "sent");
    const pendingInvoice = ["draft", "pending_approval"].includes(inv.status);
    const to = inv.billTo?.email;
    const s = { chip: "", label: "", note: "", act: null, disabled: false, hidden: false, kind, waiting, receipt, reject: null };
    if (admin && (pendingInvoice || waiting)) s.reject = pendingInvoice ? { label: "Reject the invoice", what: "invoice" } : { label: `Reject the ${receipt ? "receipt" : "reminder"}`, what: receipt ? "receipt" : "reminder" };
    if (WAITING.includes(inv.status)) {
      s.chip = "Not sent yet";
      if (!admin) { s.label = "Waiting for an admin"; s.disabled = true; s.note = "An admin approves it here, then it's emailed. Until then you can copy the email and the PDF."; }
      else if (["draft", "pending_approval", "failed"].includes(inv.status)) {
        s.label = "Approve and email it"; s.act = "approve";
        s.note = to ? `Emails ${to} the invoice itself (the Nova invoice, with a text version for email apps that can't show it) and a button to its page, where they can pay. Your Approve is the check: nothing goes without it.` : "It has no email address: add one with Edit to approve it.";
        s.disabled = !to;
      } else if (inv.status === "rejected") { s.hidden = true; s.note = "Rejected: it wasn't emailed. Change it with Edit and it goes for approval again."; }
      else { s.hidden = true; s.note = "Approved: it's on its way."; }
      return s;
    }
    if (receipt && receiptSent && !waiting) { s.chip = "Receipt sent"; s.hidden = true; s.note = `Its receipt went to ${to || "the client"}.`; return s; }
    if (waiting) {
      s.chip = receipt ? "The receipt is waiting" : "A reminder is waiting";
      if (admin) {
        s.label = receipt ? "Approve and email the receipt" : "Approve the waiting reminder"; s.act = "approve-reminder";
        s.note = receipt ? "It was written by itself when the invoice was paid in full: the receipt (the invoice, marked paid) with a thank-you. Approving emails exactly that." : "Someone queued a reminder for this invoice. Approving emails exactly what they wrote, with the invoice under it.";
      } else { s.label = "Waiting for an admin"; s.disabled = true; s.note = `${receipt ? "The receipt" : "A reminder"} for it is already waiting for an admin's Approve.`; }
      return s;
    }
    s.label = receipt ? "Send the receipt for approval" : "Send for approval"; s.act = "queue";
    s.note = `Queues this message for ${to || "(no email address)"}, with the ${receipt ? "receipt" : "invoice"} under it. An admin approves it before it goes.`;
    return s;
  }
  // Money's email adds the button to the invoice's page and a sign-off itself (the invoice under the message has
  // the link, Monzo, the bank details and the studio's sign-off), so those lines are left out of what's queued
  const forMoney = (text) => String(text || "").split(/\n\s*\n/).map((p) => p.split("\n").filter((l) => !/^(See and pay it online:|Or pay with Monzo:|Or by bank transfer)/.test(l)).join("\n")).filter((p) => p.trim() && !/^Best wishes,?\n/i.test(p)).join("\n\n");
  function paintMail(box, V) {
    const s = sendState(V);
    V.send = s;
    const tone = /waiting/.test(s.chip) ? "warn" : s.chip === "Receipt sent" ? "ok" : "";
    box.querySelector("[data-mail]").innerHTML = `<div class="money-top"><h3 class="money-h">Email</h3>${s.chip ? `<span class="pill ${tone}">${esc(s.chip)}</span>` : ""}</div>
      ${s.waiting?.body ? `<div class="money-quote"><p class="small muted">What's waiting to go:</p><p class="pre small">${esc(s.waiting.body)}</p></div>` : ""}
      <form class="form" data-mailform>
        ${field({ label: "Subject", name: "subject", value: V.k.subject, attrs: 'autocomplete="off" maxlength="200"' })}
        ${field({ label: "Message", name: "body", type: "textarea", rows: 8, value: V.k.body, attrs: 'spellcheck="true" maxlength="4000"' })}
      </form>
      <div class="btns two">
        <button type="button" class="btn money-small" data-do="see">See the email</button>
        ${V.admin ? `<button type="button" class="btn money-small" data-test data-do="test">${V.staged.stage === "paid" ? "Send me a test receipt" : "Send me a test"}</button>` : ""}
        <button type="button" class="btn money-small" data-do="copy">Copy</button>
      </div>
      ${V.admin ? `<p class="muted small money-say">${V.staged.stage === "paid" ? "The test receipt: the receipt email, to your own address only, marked [TEST]." : "The test: this email, to your own address only, marked [TEST]."}</p>` : ""}
      ${s.hidden ? "" : `<button type="button" class="btn main wide money-fit" data-send${s.disabled ? " disabled" : ""}>${esc(s.label)}</button>`}
      <p class="small muted money-say" data-send-note>${esc(s.note)}</p>
      ${s.reject ? `<button type="button" class="btn danger wide money-fit" data-reject>${esc(s.reject.label)}</button>` : ""}`;
  }

  // ---- Its notes and look ----
  function paintLook(box, V) {
    const { c, k, inv } = V;
    const now = { theme: k.look.theme || c.theme, mode: k.look.mode || c.mode, paper: k.look.paper || c.paper };
    const differs = V.admin && ((k.look.theme && k.look.theme !== c.theme) || (k.look.mode && k.look.mode !== c.mode) || (k.look.paper && k.look.paper !== c.paper));
    const changed = k.note.trim() !== (inv.notes || "").trim();
    const fixed = ["paid", "void"].includes(inv.status);
    box.querySelector("[data-look]").innerHTML = `<h3 class="money-h">On the invoice</h3>
      ${payRow()}
      <form class="form" data-lookform>
        ${(c.themes || []).length ? `<fieldset class="field"><legend>Colour</legend><div class="money-themes">${c.themes.map((t) => `<label class="money-sw"><input type="radio" name="theme" value="${esc(t.id)}"${t.id === now.theme ? " checked" : ""}><i data-b="${esc(t.band || "")}" data-a="${esc(t.accent || "")}"></i>${esc(t.name)}${t.id === c.theme ? '<b class="money-star" aria-label="(every invoice)">★</b>' : ""}</label>`).join("")}</div><small>★ is every invoice's colour.</small></fieldset>` : ""}
        ${N.choices({ label: "Bright or dark", name: "mode", value: now.mode, options: (c.modes || ["bright", "dark"]).map((m) => [m.id || m, m === "dark" || m.id === "dark" ? "Dark" : "Bright"]) })}
        ${(c.papers || []).length ? field({ label: "Paper", name: "paper", type: "select", value: now.paper, options: c.papers.map((p) => [p.id, `${p.name}${p.id === c.paper ? " ★" : ""}`]) }) : ""}
        ${differs ? `<button type="button" class="btn wide" data-useall>Use for all invoices</button>` : ""}
        ${field({ label: "Notes on the invoice", name: "note", type: "textarea", rows: 3, value: k.note, placeholder: "A thank-you shows if empty", attrs: 'maxlength="800"' })}
        <p class="small muted money-say" data-notehint>${fixed ? `${inv.status === "paid" ? "Paid" : "Removed"}: these notes are for this copy only (what's shown here and the PDF); the invoice itself doesn't change.` : changed && !WAITING.includes(inv.status) ? "It was sent: saved notes go for an admin's Approve again, then the client gets the updated invoice." : "The invoice above is redrawn as you type."}</p>
        ${!fixed ? `<button type="button" class="btn wide" data-savenotes${changed ? "" : " hidden"}>${icon("check")} Save notes</button>` : ""}
      </form>`;
    box.querySelectorAll(".money-sw i").forEach((i) => { if (i.dataset.b) i.style.setProperty("--b", i.dataset.b); if (i.dataset.a) i.style.setProperty("--a", i.dataset.a); });
  }
  function themeWords(V, look) {
    const { c } = V;
    return `${(c.themes || []).find((t) => t.id === look.theme)?.name || look.theme}, ${look.mode === "dark" ? "Dark" : "Bright"}, ${(c.papers || []).find((x) => x.id === look.paper)?.name || look.paper} paper`;
  }
  let lookTimer = 0, noteTimer = 0;
  function wireInvoice(box, V) {
    const frame = box.querySelector("[data-doc] iframe");
    const redraw = () => { frame.src = docSrc(V); box.querySelector("[data-pdf]").href = docSrc(V, "pdf"); box.querySelector("[data-open]").href = docSrc(V); };
    // The stage: its sums and its email, and the invoice redrawn at it
    box.querySelector("[data-stages]").addEventListener("change", async (e) => {
      const s = e.target.value;
      try {
        const staged = await api(`${A}/invoices/${V.id}/stage?stage=${s}`);
        V.staged = staged; V.inv = staged.invoice || V.inv; V.k.stage = staged.stage;
        V.k.subject = staged.email?.subject || ""; V.k.body = staged.email?.body || ""; V.k.mailStage = staged.stage;
        paintInvoice(box, V);
        redraw();
      } catch (err) { toast(err.message, true); }
    });
    box.addEventListener("input", (e) => {
      const n = e.target.name;
      if (n === "subject") V.k.subject = e.target.value;
      if (n === "body") V.k.body = e.target.value;
      if (n === "note") {
        V.k.note = e.target.value;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(redraw, 400);
        const changed = V.k.note.trim() !== (V.inv.notes || "").trim();
        const save = box.querySelector("[data-savenotes]");
        if (save) save.hidden = !changed;
        if (!["paid", "void"].includes(V.inv.status)) box.querySelector("[data-notehint]").textContent = changed && !WAITING.includes(V.inv.status) ? "It was sent: saved notes go for an admin's Approve again, then the client gets the updated invoice." : "The invoice above is redrawn as you type.";
      }
    });
    // The look: shown at once, and saved on the invoice (its email, page, PDF and receipt use it; no approval again)
    box.addEventListener("change", (e) => {
      const n = e.target.name;
      if (!["theme", "mode", "paper"].includes(n)) return;
      V.k.look[n] = e.target.value;
      LS(`invoicer-${n}`, e.target.value);
      redraw();
      const differs = V.admin && ["theme", "mode", "paper"].some((x) => V.k.look[x] && V.k.look[x] !== V.c[x]);
      if (Boolean(box.querySelector("[data-useall]")) !== Boolean(differs)) { paintLook(box, V); }
      if (V.inv.status === "void") return;
      const look = { theme: V.k.look.theme || V.c.theme, mode: V.k.look.mode || V.c.mode, paper: V.k.look.paper || V.c.paper };
      clearTimeout(lookTimer);
      lookTimer = setTimeout(async () => {
        try {
          const r = await post(`${A}/invoices/${V.id}/look`, { look });
          V.inv.look = r.invoice?.look || look;
          const sent = ["sent", "part_paid", "paid"].includes(V.inv.status);
          toast(`Saved on ${V.inv.number}: ${themeWords(V, look)}.${sent ? " Its page shows it now; emails from now on use it." : " It's sent like this."}`);
        } catch (err) { toast(err.message, true); }
      }, 350);
    });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled || !box.contains(b)) return;
      if (b.matches("[data-useall]")) return useForAll(b, V, box);
      if (b.matches("[data-savenotes]")) return saveNotes(b, V);
      if (b.matches("[data-send]")) return sendNow(b, V);
      if (b.matches("[data-reject]")) return rejectNow(V);
      const what = b.dataset.do;
      if (what === "share") return share(V);
      if (what === "pay") return payment(V);
      if (what === "remove") return removeIt(b, V);
      if (what === "see") { location.hash = `#money/invoice/${V.id}/email`; return; }
      if (what === "copy") return copyText(`Subject: ${V.k.subject}\n\n${V.k.body}`, "Copied: paste it into Gmail.", box.querySelector("[name=body]"));
      if (what === "test") {
        return busy(b, "Sending…", async () => {
          try { const r = await post(`${A}/invoices/test-send`, { id: Number(V.id), stage: V.staged.stage, body: forMoney(V.k.body) }); toast(`${V.staged.stage === "paid" ? "Test receipt" : "Test"} sent to ${r.to || "you"}: check your inbox.`); } catch (err) { toast(err.message, true); }
        });
      }
    });
  }
  async function copyText(text, said, select) {
    try { await navigator.clipboard.writeText(text); toast(said); } catch (e) { if (select) { select.focus(); select.select(); } toast("Couldn't copy here: select it and copy it yourself.", true); }
  }
  // The invoice drawn at its full height inside the page (never a box scrolling inside it); wider than the page,
  // it's shown smaller to fit
  function sizeFrame(frame, k) {
    const wrap = frame.parentElement;
    if (k?.docH) wrap.style.setProperty("--h", `${k.docH}px`);
    let watch = null;
    const fit = () => {
      try {
        const d = frame.contentDocument;
        if (!d || !d.body || !frame.isConnected) return;
        d.documentElement.classList.add("still");
        const room = wrap.clientWidth;
        const wide = Math.max(room, d.documentElement.scrollWidth, d.body.scrollWidth);
        const s = frame.contentWindow.getComputedStyle(d.body);
        const h = Math.ceil(d.body.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom));
        if (h < 60) return;
        const z = wide > room + 1 ? room / wide : 1;
        if (z < 1) frame.style.setProperty("width", `${wide}px`); else frame.style.removeProperty("width");
        frame.style.setProperty("height", `${h}px`);
        wrap.style.setProperty("--z", String(z));
        wrap.style.setProperty("--h", `${Math.ceil(h * z)}px`);
        wrap.classList.toggle("money-zoomed", z < 1);
        if (k) k.docH = Math.ceil(h * z);
      } catch (e) { /* (not ours to read) */ }
    };
    // (turned sideways: drawn again at the new width)
    let was = 0;
    try { new ResizeObserver(() => { if (wrap.clientWidth !== was) { was = wrap.clientWidth; frame.style.removeProperty("width"); requestAnimationFrame(fit); } }).observe(wrap); } catch (e) { /* (an old browser) */ }
    frame.addEventListener("load", () => {
      fit();
      setTimeout(fit, 500);
      watch?.disconnect();
      try { watch = new ResizeObserver(() => requestAnimationFrame(fit)); watch.observe(frame.contentDocument.body); } catch (e) { watch = null; }
    });
    return fit;
  }
  async function sendNow(btn, V) {
    const s = V.send;
    const doIt = (fn, said) => busy(btn, "Sending…", async () => { try { await fn(); toast(said); await N.show(); } catch (err) { toast(err.message, true); } });
    if (s.act === "approve") return doIt(() => post(`${A}/invoices/${V.id}/approve`, {}), `Approved: ${V.inv.number} is on its way to ${V.inv.billTo?.email}.`);
    if (s.act === "approve-reminder") return doIt(() => post(`${A}/reminders/${s.waiting.id}/approve`, {}), s.receipt ? "Receipt sent." : "Reminder sent.");
    if (s.act === "queue") {
      if (!forMoney(V.k.body).trim()) return toast("Write the message first.", true);
      return busy(btn, "Queueing…", async () => {
        try { await post(`${A}/invoices/${V.id}/reminder`, { body: forMoney(V.k.body), kind: s.kind }); toast(V.admin ? "Queued: approve it with the button here to send it." : "Queued: an admin approves it before it goes."); await N.show(); } catch (err) { toast(err.message, true); }
      });
    }
  }
  // Reject (an admin): the invoice waiting for approval, or the reminder or receipt waiting; nothing is emailed
  function rejectNow(V) {
    const s = V.send;
    if (!s?.reject) return toast("There's nothing waiting to reject.", true);
    if (s.reject.what === "invoice") return askWhy(`Reject ${V.inv.number}`, "It isn't emailed. It can be changed with Edit and sent for approval again.", (note) => post(`${A}/invoices/${V.id}/reject`, { note }), `${V.inv.number} rejected: nothing was emailed.`);
    return askWhy(`Reject the ${s.reject.what}`, `It isn't emailed. ${V.inv.number} stays as it is.`, () => post(`${A}/reminders/${s.waiting.id}/reject`, {}), `The ${s.reject.what} was rejected: nothing was emailed.`);
  }
  function askWhy(title, note, act, said) {
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><p class="sheet-text">${esc(note)}</p><form class="form" data-f novalidate>${field({ label: "Why (optional)", name: "why", attrs: 'maxlength="500" autocomplete="off"' })}<p class="form-said" role="status"></p><div class="btns"><button class="btn danger wide" type="submit">Reject it</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        el.querySelector("[data-no]").onclick = () => done(null);
        el.querySelector("[data-f]").onsubmit = (ev) => {
          ev.preventDefault();
          const b = ev.target.querySelector("[type=submit]");
          busy(b, "Rejecting…", async () => {
            try { await act(ev.target.elements.why.value.trim() || undefined); done(true); toast(said); await N.show(); } catch (err) { const m = ev.target.querySelector(".form-said"); m.textContent = err.message; m.classList.add("bad"); }
          });
        };
      });
  }
  async function removeIt(btn, V) {
    if (!(await confirm({ title: `Remove ${V.inv.number}?`, text: "It's kept on record, marked removed. Nothing is emailed.", ok: `Yes, remove ${V.inv.number}`, danger: true }))) return;
    await busy(btn, "Removing…", async () => { try { await post(`${A}/invoices/${V.id}/void`, {}); toast(`${V.inv.number} removed (kept on record).`); await N.show(); } catch (err) { toast(err.message, true); } });
  }
  async function useForAll(btn, V, box) {
    await busy(btn, "Saving…", async () => {
      try {
        const look = { theme: V.k.look.theme || V.c.theme, mode: V.k.look.mode || V.c.mode, paper: V.k.look.paper || V.c.paper };
        const r = await post(`${A}/settings`, { invoiceTheme: look.theme, invoiceMode: look.mode, invoicePaper: look.paper });
        V.c.theme = r.settings?.invoiceTheme || look.theme; V.c.mode = r.settings?.invoiceMode || look.mode; V.c.paper = r.settings?.invoicePaper || look.paper;
        toast(`Every invoice now uses ${(V.c.themes || []).find((t) => t.id === V.c.theme)?.name || V.c.theme}, ${V.c.mode}.`);
        paintLook(box, V);
      } catch (err) { toast(err.message, true); }
    });
  }
  // The Notes box's words saved on the invoice (not sent yet: straight in; sent: it goes for an admin's Approve
  // again, then the client gets the updated invoice)
  async function saveNotes(btn, V) {
    const notes = V.k.note.trim();
    const waiting = WAITING.includes(V.inv.status);
    if (!waiting && !(await confirm({ title: "Save the notes?", text: "It was sent: saved, it goes for an admin's Approve again, then the client gets the updated invoice.", ok: "Yes, save" }))) return;
    await busy(btn, "Saving…", async () => {
      try {
        await post(`${A}/invoices/${V.id}/edit`, { notes });
        toast(waiting ? `Notes saved on ${V.inv.number}. It waits for an admin's Approve.` : `Notes saved on ${V.inv.number}. Once an admin approves, the client gets the updated invoice.`);
        await N.show();
      } catch (err) { toast(err.message, true); }
    });
  }
  // The address's job, on the invoice once it's on screen: the place to do it opened, never done by itself
  async function runJob(box, V, job) {
    const flash = (sel, say) => {
      const el = box.querySelector(sel);
      if (!el || !el.isConnected) return toast(say || "That can't be done for this invoice now.", true);
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
      el.classList.add("money-flash");
      setTimeout(() => el.classList.remove("money-flash"), 2400);
    };
    if (job === "pay") return canPay(V) ? payment(V) : toast(V.inv.status === "paid" ? `${V.inv.number} is paid in full.` : `${V.inv.number} hasn't been sent yet: payments are recorded once it's out.`, true);
    if (job === "share") return canShare(V) ? share(V) : toast(V.inv.status === "void" ? "Removed: it can't be shared." : "It can be shared once an admin approves it.", true);
    if (job === "pdf") return downloadPdf(docSrc(V, "pdf"), { name: `Novacane Studios ${V.inv.number}.pdf`, btn: box.querySelector("[data-pdf]") });
    if (job === "send" || job === "approve" || job === "remind") return flash("[data-send]", V.send?.note);
    if (job === "reject") return V.send?.reject ? rejectNow(V) : toast("There's nothing waiting to reject.", true);
    if (job === "test") return flash("[data-test]", "Tests are for an admin.");
    if (job === "remove") return flash("[data-do=remove]", V.inv.paidPence > 0 ? "Money's been paid on it, so it can't be removed." : "Only an admin removes invoices.");
  }
  // A PDF file: Nova Bot draws it and Nova Agent prints it; if that can't be done just now, its page opens ready to
  // print instead (the browser's own Save as PDF)
  async function downloadPdf(path, { method = "GET", body, name, btn } = {}) {
    const go = async () => {
      try {
        const res = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
        if (res.status === 401 || res.status === 403) throw new Error("Sign in again to download it.");
        if (!res.ok) throw new Error("The PDF couldn't be made. Try again in a moment.");
        const blob = await res.blob();
        if (blob.type !== "application/pdf") {
          if (method === "GET") { const w = window.open(path, "_blank", "noopener"); if (!w) toast("Tap PDF to open it ready to print (the PDF couldn't be made just now).", true); return; }
          throw new Error("The PDF couldn't be made just now. Try again in a moment.");
        }
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: name });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast(`${name} downloaded`);
      } catch (err) { toast(err.offline || err instanceof TypeError ? "The PDF couldn't be made. Check the connection and try again." : err.message, true); }
    };
    return btn ? busy(btn, "Making…", go) : go();
  }

  // ---- Record a payment (bank transfer, Monzo, cash…; card payments come in from Stripe by themselves) ----
  function payment(V) {
    const i = V.inv;
    return sheetForm(`<h2 class="sheet-title">Record a payment · ${esc(i.number)}</h2><p class="sheet-text">${esc(i.billTo?.name || "")}: ${money(i.balancePence)} left to pay of ${money(i.totalPence)}.</p><form class="form" data-f novalidate>
        ${field({ label: "Amount (£)", name: "amount", value: pounds(i.balancePence), attrs: 'inputmode="decimal" autocomplete="off" required' })}
        ${field({ label: "Paid on", name: "paidOn", type: "date", value: ukToday(), attrs: `max="${ukToday()}" required` })}
        ${field({ label: "How", name: "method", type: "select", value: "bank", options: (data.methods || []).map((m) => [m.id, m.name]) })}
        ${field({ label: "Note (optional)", name: "note", attrs: 'maxlength="300" autocomplete="off"' })}
        <p class="form-said" role="status"></p>
        <div class="btns"><button class="btn main wide" type="submit">Save the payment</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        el.querySelector("[data-no]").onclick = () => done(null);
        el.querySelector("[data-f]").onsubmit = (ev) => {
          ev.preventDefault();
          const x = ev.target.elements, said = ev.target.querySelector(".form-said");
          const bad = (t) => { said.textContent = t; said.classList.add("bad"); };
          if (!(toPence(x.amount.value) > 0)) return bad("The amount in pounds, like 150.00.");
          busy(ev.target.querySelector("[type=submit]"), "Saving…", async () => {
            try {
              await post(`${A}/invoices/${V.id}/payments`, { amount: x.amount.value.trim(), paidOn: x.paidOn.value, method: x.method.value, note: x.note.value.trim() || undefined });
              done(true);
              toast(`Payment of ${money(toPence(x.amount.value))} recorded on ${i.number}.`);
              await N.show();
            } catch (err) { bad(err.message); }
          });
        };
      });
  }

  // ---- Share it yourself: the invoice's page, sent on WhatsApp, Telegram, a text, email or the phone's own list ----
  function shareMessage(V) {
    const inv = V.inv, due = V.staged.sums?.dueNowPence || 0;
    const first = String(inv.billTo?.name || "").trim().split(/\s+/)[0] || "there";
    const monzo = due > 0 && inv.monzoUrl ? ` Or pay with Monzo: ${inv.monzoUrl}` : "";
    return `Hi ${first}, here's your invoice ${inv.number} from Novacane Studios (${due > 0 ? `${money(due)} due now` : "paid in full, thank you"}). See it and pay here: ${inv.pageUrl}${monzo} Download it as a PDF: ${inv.pageUrl}/pdf`;
  }
  function share(V) {
    let approved = false;
    return sheetForm(`<h2 class="sheet-title">Share ${esc(V.inv.number)}</h2><div data-share class="form"></div><button type="button" class="btn quiet wide" data-no>Close</button>`, (el, done) => {
      el.querySelector("[data-no]").onclick = () => done(null);
      const box = el.querySelector("[data-share]");
      const paint = () => {
        const inv = V.inv;
        if (!inv.pageUrl) {
          box.innerHTML = `<p class="sheet-text">${esc(inv.number)} hasn't been approved yet, so its page isn't open. Approving it here sends no email: it counts as sent, and you share its link yourself.</p>
            ${V.admin && WAITING.includes(inv.status) && inv.status !== "rejected" ? `<button type="button" class="btn main wide" data-approve>Approve it to share (no email)</button><p class="small muted money-say" data-sure></p>` : `<p class="sheet-text">It can be shared once an admin approves it.</p>`}`;
          const b = box.querySelector("[data-approve]");
          if (b) b.onclick = () => {
            if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Tap again to approve"; box.querySelector("[data-sure]").textContent = `Approves ${inv.number} with no email. Tap again to be sure.`; setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.textContent = "Approve it to share (no email)"; box.querySelector("[data-sure]").textContent = ""; } }, 5000); return; }
            busy(b, "Approving…", async () => {
              try {
                await post(`${A}/invoices/${V.id}/approve`, { byHand: true });
                approved = true;
                toast(`${inv.number} approved to share. No email was sent.`);
                const st = await api(`${A}/invoices/${V.id}/stage?stage=${V.staged.stage}`);
                V.staged = st; V.inv = st.invoice || V.inv;
                paint();
              } catch (err) { toast(err.message, true); }
            });
          };
          return;
        }
        box.innerHTML = `${field({ label: "The message", name: "text", type: "textarea", rows: 4, value: shareMessage(V), attrs: 'maxlength="1000"' })}
          <div class="btns two money-ways">
            ${navigator.share ? `<button type="button" class="btn main" data-w="device">${icon("share")} Share…</button>` : ""}
            <a class="btn" data-w="wa" target="_blank" rel="noopener">WhatsApp</a>
            <a class="btn" data-w="tg" target="_blank" rel="noopener">Telegram</a>
            <a class="btn" data-w="sms">Text message</a>
            <a class="btn" data-w="mail">${icon("mail")} Email</a>
            <button type="button" class="btn" data-w="copy">Copy message</button>
            <button type="button" class="btn" data-w="link">Copy link</button>
            ${inv.monzoUrl ? `<button type="button" class="btn" data-w="monzo">Copy Monzo link</button>` : ""}
          </div>
          <p class="small muted money-say">Share… opens your phone's own list (Instagram, Messenger, Signal, Snapchat…). Copy Monzo link: it opens Monzo with the amount and the invoice number filled in. Anyone with the link can see the invoice and pay it, so send it only to them.</p>`;
        const ta = box.querySelector("[name=text]");
        const links = () => {
          const t = ta.value.trim(), e = encodeURIComponent;
          box.querySelector("[data-w=wa]").href = `https://wa.me/?text=${e(t)}`;
          box.querySelector("[data-w=tg]").href = `https://t.me/share/url?url=${e(inv.pageUrl)}&text=${e(t.replace(inv.pageUrl, "").trim())}`;
          box.querySelector("[data-w=sms]").href = `sms:?&body=${e(t)}`;
          box.querySelector("[data-w=mail]").href = `mailto:${e(inv.billTo?.email || "")}?subject=${e(`Invoice ${inv.number} from Novacane Studios`)}&body=${e(t)}`;
        };
        ta.addEventListener("input", links);
        links();
        box.querySelectorAll("button[data-w]").forEach((b) => (b.onclick = async () => {
          const w = b.dataset.w;
          if (w === "device") { try { await navigator.share({ title: `Invoice ${inv.number}`, text: ta.value.trim().replace(inv.pageUrl, "").trim(), url: inv.pageUrl }); } catch (e) { /* (closed) */ } return; }
          if (w === "copy") return copyText(ta.value.trim(), "The message copied.", ta);
          if (w === "link") return copyText(inv.pageUrl, "The link copied.");
          if (w === "monzo") return copyText(inv.monzoUrl, "The Monzo link copied.");
        }));
      };
      paint();
    }).then(() => { if (approved) N.show(); });
  }

  // ---- Its history: its details, payments, reminders and receipts, and what happened ----
  async function drawHistory(box, id, ui) {
    ui.back(`#money/invoice/${id}`);
    let d;
    try { d = await api(`${A}/invoices/${encodeURIComponent(id)}`); } catch (err) { if (err.status === 404) return missing(box, ui, "That invoice isn't there"); throw err; }
    const inv = d.invoice, admin = !!data.canDecide;
    ui.title(`History · ${inv.number}`);
    const facts = [["Billed to", inv.billTo?.name], ["Goes to", inv.billTo?.email || "No email yet: add one with Edit to send it"], ["Total", `${money(inv.totalPence)}${inv.vatRate ? ` (incl. ${inv.vatRate}% VAT)` : ""}`],
      inv.paidPence ? ["Paid", money(inv.paidPence)] : null, ["sent", "part_paid"].includes(inv.status) ? ["Left to pay", money(inv.balancePence)] : null,
      ["Issued", day(inv.issueDate)], [inv.overdue ? "Was due" : "Due", day(inv.dueDate)], inv.sentAt ? ["Sent", when(inv.sentAt)] : null,
      inv.decidedByName ? [inv.status === "rejected" ? "Rejected by" : "Approved by", inv.decidedByName] : null, ["Written", `${inv.createdBy === "agent" ? "by Agent" : "in Nova"}${inv.createdAt ? ` · ${when(inv.createdAt)}` : ""}`]].filter((f) => f && f[1]);
    const none = (t = "None yet.") => `<p class="muted small money-say">${t}</p>`;
    const pays = d.payments || [], rems = d.reminders || [], log = d.log || [];
    box.innerHTML = `<div class="card"><p class="kicker">${esc(inv.number)} · ${esc(STATUS[inv.status] || inv.status)}</p><div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      <h3 class="h">Payments</h3>
      ${pays.length ? list(pays.map((p) => row({ icon: "money", title: `${money(p.amountPence)} · ${p.methodName || p.method}`, text: [day(p.paidOn), p.note, p.byName, p.removed ? "taken back" : ""].filter(Boolean).join(" · "), cls: p.removed ? "done-row" : "" })))
        + (admin ? pays.filter((p) => !p.removed && p.method !== "stripe").map((p) => `<button type="button" class="btn quiet wide money-small" data-takeback="${esc(p.id)}" data-amt="${esc(p.amountPence)}">Take back ${money(p.amountPence)} (${esc(day(p.paidOn))})</button>`).join("") : "") : none()}
      <h3 class="h">Reminders and receipts</h3>
      ${rems.length ? rems.map((r) => { const what = r.kind === "receipt" ? "Receipt" : "Reminder"; return `<div class="card money-rem"><p class="kicker">${what}</p><p class="small muted">${esc([`Written ${when(r.createdAt)}`, r.status === "sent" ? `sent ${when(r.sentAt)}` : r.status === "pending_approval" ? "waiting for approval" : r.status === "rejected" ? `rejected${r.decidedByName ? ` by ${r.decidedByName}` : ""}` : r.status === "failed" ? "didn't send" : r.status, r.error].filter(Boolean).join(" · "))}</p>${r.body ? `<p class="pre small">${esc(r.body)}</p>` : ""}${admin && r.status === "pending_approval" ? `<div class="btns two"><button type="button" class="btn main" data-rem="approve" data-id="${esc(r.id)}" data-what="${what}">${icon("send")} Approve and email it</button><button type="button" class="btn danger" data-rem="reject" data-id="${esc(r.id)}" data-what="${what}">Reject</button></div>` : r.status === "pending_approval" ? `<p class="small muted">An admin approves it before it goes.</p>` : ""}</div>`; }).join("") : none()}
      <h3 class="h">What happened</h3>
      ${log.length ? list(log.slice(-20).reverse().map((l) => row({ icon: "clock", title: EVENTS[l.event] || l.event, text: [when(l.at), l.byName, l.detail].filter(Boolean).join(" · ") }))) : none("Nothing yet.")}
      <a class="btn wide" href="#money/invoice/${esc(inv.id)}">${icon("back")} Back to ${esc(inv.number)}</a>`;
    box.querySelectorAll("[data-takeback]").forEach((b) => b.addEventListener("click", async () => {
      if (!(await confirm({ title: `Take back ${money(b.dataset.amt)}?`, text: "What's left to pay and the stage follow it.", ok: "Take it back", danger: true }))) return;
      busy(b, "Taking back…", async () => { try { await post(`${A}/payments/${b.dataset.takeback}/remove`, {}); toast("Payment taken back."); await N.show(); } catch (err) { toast(err.message, true); } });
    }));
    box.querySelectorAll("[data-rem]").forEach((b) => b.addEventListener("click", () => {
      const what = b.dataset.what;
      if (b.dataset.rem === "approve") return busy(b, "Sending…", async () => { try { await post(`${A}/reminders/${b.dataset.id}/approve`, {}); toast(`${what} sent.`); await N.show(); } catch (err) { toast(err.message, true); } });
      askWhy(`Reject the ${what.toLowerCase()}`, `It isn't emailed. ${inv.number} stays as it is.`, () => post(`${A}/reminders/${b.dataset.id}/reject`, {}), `The ${what.toLowerCase()} was rejected: nothing was emailed.`);
    }));
  }

  // ---- The email as the client gets it ----
  async function drawEmail(box, id, ui) {
    ui.back(`#money/invoice/${id}`);
    ui.title("The email");
    const k = keepOf(id);
    let inv = (data.invoices || []).find((i) => String(i.id) === String(id));
    if (!inv) return missing(box, ui, "That invoice isn't there");
    if (!k.inited) {
      const st = await api(`${A}/invoices/${encodeURIComponent(id)}/stage`);
      k.stage = st.stage; k.subject = st.email?.subject || ""; k.body = st.email?.body || ""; k.mailStage = st.stage;
    }
    const stage = k.stage || stageOf(inv);
    const q = new URLSearchParams({ stage, body: forMoney(k.body) });
    box.innerHTML = `<div class="card"><p class="kicker">${esc(inv.number)} · ${esc(STAGE_NAMES[stage])}</p><p class="money-sumline">${esc(k.subject)}</p><p class="small muted">As ${esc(inv.billTo?.name || "the client")} gets it, with the words from its page. Nothing is sent from here.</p></div>
      <div class="money-doc money-mailview"><iframe title="The email, as the client gets it" scrolling="no"></iframe></div>
      <a class="btn wide" href="#money/invoice/${esc(id)}">${icon("back")} Back to ${esc(inv.number)}</a>`;
    const frame = box.querySelector("iframe");
    sizeFrame(frame, null);
    frame.src = `${A}/invoices/${encodeURIComponent(id)}/email?${q}`;
  }

  // ---- A new invoice, or changing one ----
  // Mastering: £30 a song for 3 to 10 songs, £50 for 1 or 2 (the price list's rule)
  function masteringRule(lines, c) {
    const m = lines.filter((l) => l.id === "master-1" || l.id === "master-3");
    const songs = m.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    const want = songs >= 3 && songs <= 10 ? "master-3" : "master-1";
    const svc = (c.services || []).find((s) => s.id === want);
    let changed = false;
    for (const l of m) { if (l.id === want || !svc) continue; l.id = want; l.description = svc.name; l.unit = pounds(svc.pricePence); changed = true; }
    return changed;
  }
  const lineAmount = (l) => Math.round((Number(l.qty) || 0) * (toPence(l.unit) || 0));
  async function drawForm(box, inv, ui, ask) {
    ui.back(inv ? `#money/invoice/${inv.id}` : listHash());
    ui.title(inv ? `Edit ${inv.number}` : "New invoice");
    const c = await cat();
    if (!clients) clients = await api("/app/api/clients?filter=all").then((r) => (r.clients || []).filter((x) => x.name), () => null);
    const cl = clients || [];
    const sent = inv && ["sent", "part_paid"].includes(inv.status);
    const findClient = (name) => cl.find((x) => x.name.toLowerCase() === String(name || "").trim().toLowerCase());
    let lines = inv ? (inv.lines || []).map((l) => ({ description: l.description, qty: String(l.qty), unit: pounds(l.unitPence) })) : [];
    let billing = inv ? inv.billing : ask?.get("billing") === "full" ? "full" : "deposit";
    const name0 = inv ? inv.billTo?.name || "" : (ask?.get("name") || "").slice(0, 120);
    const email0 = inv ? inv.billTo?.email || "" : (ask?.get("email") || "").slice(0, 200) || findClient(name0)?.email || "";
    const issue0 = inv?.issueDate || ukToday();
    // (a new invoice is made in the look last chosen here or on Nova Desk, else the studio's)
    const look = { theme: LS("invoicer-theme") || c.theme, mode: LS("invoicer-mode") || c.mode, paper: LS("invoicer-paper") || c.paper };
    if (!(c.themes || []).some((t) => t.id === look.theme)) look.theme = c.theme;
    if (!(c.papers || []).some((p) => p.id === look.paper)) look.paper = c.paper;
    if (!["bright", "dark"].includes(look.mode)) look.mode = c.mode;
    box.innerHTML = `<form class="form" id="inv" novalidate>
        <label class="field"><span>Artist</span><input class="input" name="billName" list="money-clients" value="${esc(name0)}" autocomplete="off" required placeholder="Name" maxlength="120"><datalist id="money-clients">${cl.slice(0, 300).map((x) => `<option value="${esc(x.name)}"></option>`).join("")}</datalist></label>
        ${cl.length ? `<button type="button" class="btn quiet money-small money-pick" data-clients>${icon("user")} Choose a client</button>` : ""}
        ${field({ label: "Email", name: "billEmail", type: "email", value: email0, placeholder: "name@example.com", attrs: 'maxlength="200"' })}
        <fieldset class="field"><legend>Before or after the session</legend><div class="seg"><label><input type="radio" name="billing" value="deposit"${billing !== "full" ? " checked" : ""}>Before: a deposit</label><label><input type="radio" name="billing" value="full"${billing === "full" ? " checked" : ""}>After: in full</label></div><small data-billhint></small></fieldset>
        <h3 class="h">What it's for</h3>
        <div class="money-lines" data-lines></div>
        <div class="btns two"><button type="button" class="btn" data-add="service">${icon("plus")} A service</button><button type="button" class="btn" data-add="other">${icon("plus")} Something else</button></div>
        <p class="small muted money-say" data-hint hidden></p>
        <div class="card"><ul class="lines money-sums" data-sums></ul></div>
        <div class="two-up">${field({ label: "Issued", name: "issueDate", type: "date", value: issue0, attrs: "required" })}${field({ label: billing === "full" ? "Payment due" : "Balance due (the session day)", name: "dueDate", type: "date", value: inv?.dueDate || addDays(issue0, 14), attrs: "required" })}</div>
        ${field({ label: "Note on the invoice (optional)", name: "notes", type: "textarea", rows: 3, value: inv?.notes || "", placeholder: "Session on 21 October, 2pm", attrs: 'maxlength="800"' })}
        <p class="form-said" data-said role="status"></p>
        <button class="btn main wide" type="submit">${icon("check")} ${inv ? "Save changes" : "Make the invoice"}</button>
        <p class="small muted money-say">${sent ? "It was sent: saved, it goes to an admin's Approve again, then the client gets the updated invoice. Its link says it's being updated meanwhile." : "It waits for an admin's Approve before anything is emailed."}</p>
        <section class="money-live" aria-label="Live preview">
          <h3 class="h">Live preview</h3>
          <p class="small muted money-say" data-livestate>As it will look: drawn as you type, nothing is saved.</p>
          <div class="money-doc" data-live><iframe title="Live preview of the invoice" scrolling="no" tabindex="-1"></iframe></div>
          <button type="button" class="btn wide" data-preview>${icon("pdf")} PDF of this draft</button>
        </section>
      </form>`;
    const f = box.querySelector("#inv");
    const x = f.elements;
    const vat = Number(data.settings?.vatRate || 0);
    const depositPct = c.depositPercent || 50;
    const setBilling = (b) => {
      billing = b === "full" ? "full" : "deposit";
      f.querySelector("[name=dueDate]").closest(".field").querySelector("span").textContent = billing === "full" ? "Payment due" : "Balance due (the session day)";
      f.querySelector("[data-billhint]").textContent = billing === "full" ? "The session's done: the full amount, with a thank-you." : "A deposit secures their date; the rest is due on the session day.";
      sums();
    };
    const sums = () => {
      const sub = lines.reduce((t, l) => t + lineAmount(l), 0);
      const v = Math.round((sub * vat) / 100);
      f.querySelector("[data-sums]").innerHTML = `${vat ? `<li class="line"><span class="muted">VAT ${esc(vat)}%</span><span>${money(v)}</span></li>` : ""}<li class="line total"><span>Total</span><span>${money(sub + v)}</span></li>${billing === "deposit" ? `<li class="line"><span class="muted">Deposit (${depositPct}%)</span><span>${money(Math.round(((sub + v) * depositPct) / 100))}</span></li>` : ""}`;
      lines.forEach((l, n) => { const el = f.querySelector(`[data-amt="${n}"]`); if (el) el.textContent = money(lineAmount(l)); });
      const from = lines.find((l) => (c.services || []).find((s) => s.id === l.id && s.from));
      const hint = f.querySelector("[data-hint]");
      hint.hidden = !from;
      hint.textContent = from ? "Custom production is from £250: type the price you agreed." : "";
      live();
    };
    const drawLines = () => {
      masteringRule(lines, c);
      f.querySelector("[data-lines]").innerHTML = lines.length ? lines.map((l, n) => `<div class="card line-edit"><div class="form">
          ${field({ label: "What it's for", name: `d${n}`, value: l.description, attrs: 'required maxlength="200"' })}
          <div class="two-up">${field({ label: "How many", name: `q${n}`, type: "number", value: l.qty, attrs: 'min="1" step="1"' })}${field({ label: "Price of one (£)", name: `u${n}`, value: l.unit, attrs: 'inputmode="decimal" autocomplete="off"' })}</div>
          <p class="line money-amt"><span class="muted">Amount</span><b data-amt="${n}">${money(lineAmount(l))}</b></p>
          <button type="button" class="btn quiet" data-del-line="${n}">${icon("trash")} Remove this line</button></div></div>`).join("") : `<p class="muted add-line">Nothing yet: add a service or something else.</p>`;
      sums();
    };
    // ---- The live preview: what's typed so far, drawn by Nova Bot as the invoice will look (nothing saved) ----
    const frame = f.querySelector("[data-live] iframe");
    const fit = sizeFrame(frame, null);
    let previewTimer = 0, previewAsk = 0, frameUp = null;
    const draft = () => ({ billName: x.billName.value.trim(), billEmail: x.billEmail.value.trim(), lines: lines.map((l) => ({ description: String(l.description || "").trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })), issueDate: x.issueDate.value, dueDate: x.dueDate.value, notes: x.notes.value.trim(), billing, stage: billing === "full" ? "balance" : "deposit", theme: look.theme, mode: look.mode });
    const live = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(async () => {
        const n = ++previewAsk;
        try {
          const r = await post(`${A}/invoices/preview`, draft());
          if (n !== previewAsk || !r.html || !frame.isConnected) return;
          frameUp ||= blankFrame(frame);
          await frameUp;
          await paintHtml(frame, r.html);
          fit();
          setTimeout(fit, 300);
          f.querySelector("[data-livestate]").textContent = `${billing === "full" ? "Payment due" : "Deposit due"} · ${(c.themes || []).find((t) => t.id === look.theme)?.name || look.theme} · ${look.mode === "dark" ? "Dark" : "Bright"}: as it will look, nothing is saved.`;
        } catch (err) { if (n === previewAsk) f.querySelector("[data-livestate]").textContent = err.message; }
      }, 250);
    };
    f.addEventListener("input", (e) => {
      const m = e.target.name?.match(/^([dqu])(\d+)$/);
      if (m) { const l = lines[Number(m[2])]; if (l) { if (m[1] === "d") l.description = e.target.value; if (m[1] === "q") l.qty = e.target.value; if (m[1] === "u") l.unit = e.target.value; } sums(); return; }
      if (["billName", "billEmail", "issueDate", "dueDate", "notes"].includes(e.target.name)) live();
    });
    f.addEventListener("change", (e) => {
      const n = e.target.name;
      if (n === "billing") setBilling(e.target.value);
      if (n === "billName") { const cc = findClient(e.target.value); if (cc && cc.email && !x.billEmail.value) { x.billEmail.value = cc.email; live(); } }
      if (n === "issueDate" && (!x.dueDate.value || x.dueDate.value < x.issueDate.value)) { x.dueDate.value = addDays(x.issueDate.value, 14); live(); }
      if (/^q\d+$/.test(n || "") && masteringRule(lines, c)) drawLines();
    });
    box.addEventListener("click", async (e) => {
      const del = e.target.closest("[data-del-line]");
      if (del) { lines.splice(Number(del.dataset.delLine), 1); drawLines(); return; }
      if (e.target.closest("[data-clients]")) {
        const who = await pickFrom("Choose a client", cl.slice(0, 300).map((cc) => ({ v: cc.id, title: cc.name, text: cc.email || "" })));
        const cc = cl.find((y) => String(y.id) === String(who));
        if (cc) { x.billName.value = cc.name; if (cc.email) x.billEmail.value = cc.email; live(); }
        return;
      }
      const add = e.target.closest("[data-add]");
      if (!add) return;
      if (add.dataset.add === "other") { lines.push({ description: "", qty: "1", unit: "" }); drawLines(); f.querySelector(`[name="d${lines.length - 1}"]`)?.focus(); return; }
      const svc = c.services || [];
      if (!svc.length) return toast("The price list didn't load: add it with Something else.", true);
      const groups = [...new Set(svc.map((s) => s.group || "Services"))];
      const got = await pickFrom("Add a service", groups.flatMap((g) => [{ group: g }, ...svc.filter((s) => (s.group || "Services") === g).map((s) => ({ v: s.id, title: s.name, text: `${s.from ? "from " : ""}${money(s.pricePence)}${s.note ? ` · ${s.note}` : ""}` }))]));
      const s = svc.find((y) => String(y.id) === String(got));
      if (!s) return;
      // (the same service again: one more of it)
      const same = lines.find((l) => l.id === s.id);
      if (same && !s.from) same.qty = String((Number(same.qty) || 0) + 1);
      else lines.push({ id: s.id, description: s.name, qty: "1", unit: pounds(s.pricePence) });
      drawLines();
    });
    f.querySelector("[data-preview]").addEventListener("click", (e) => downloadPdf(`${A}/invoices/preview/pdf`, { method: "POST", body: draft(), name: `Novacane Studios draft${x.billName.value.trim() ? ` for ${x.billName.value.trim()}` : ""}.pdf`, btn: e.currentTarget }));
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const said = f.querySelector("[data-said]");
      const problem = (t) => { said.textContent = t; said.classList.add("bad"); said.scrollIntoView({ block: "center" }); };
      const name = x.billName.value.trim();
      if (!name) return problem("Who's it to?");
      if (!lines.length) return problem("Add at least one service.");
      if (lines.some((l) => !String(l.description || "").trim() || !(toPence(l.unit) >= 0))) return problem("Each line needs what it's for and a price.");
      const client = findClient(name);
      const body = { billName: name, billEmail: x.billEmail.value.trim(), lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })), issueDate: x.issueDate.value, dueDate: x.dueDate.value, notes: x.notes.value.trim(), billing, ...(client ? { clientId: client.id } : {}) };
      // (a new one keeps the look it was made in)
      if (!inv) body.look = { ...look };
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          const r = await post(inv ? `${A}/invoices/${inv.id}/edit` : `${A}/invoices`, body);
          const made = r.invoice || inv;
          f.classList.remove("dirty");
          if (inv) kept.delete(String(inv.id));
          toast(inv ? `${made.number} saved. It waits for an admin's Approve${sent ? ", then the client gets the updated invoice" : ""}.` : `${made.number} is made. It waits for an admin's Approve before it's emailed.`);
          location.hash = `#money/invoice/${made.id}`;
        } catch (err) { problem(`Not saved: ${err.message}`); }
      });
    });
    setBilling(billing);
    drawLines();
  }
  // A choice of many, in a sheet: rows, set under headings ({ group }) when there are some
  function pickFrom(title, items) {
    let html = "", open = [];
    const flush = () => { if (open.length) { html += list(open); open = []; } };
    for (const it of items) {
      if (it.group) { flush(); html += `<h3 class="h">${esc(it.group)}</h3>`; continue; }
      open.push(row({ button: `data-v="${esc(it.v)}"`, icon: "plus", title: it.title, text: it.text }));
    }
    flush();
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2>${html}<button type="button" class="btn quiet wide" data-no>Cancel</button>`, (el, done) => {
      el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v)));
      el.querySelector("[data-no]").onclick = () => done(null);
    });
  }
  // A page of Nova Bot's (the live preview) drawn in a frame of this page: the page's rules can't run its own
  // styles, so they're given to it as a style sheet made here, and its own font as a font made here
  function blankFrame(frame) {
    return new Promise((resolve) => { frame.addEventListener("load", () => resolve(), { once: true }); frame.srcdoc = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>"; });
  }
  const fonts = new Map();
  async function paintHtml(frame, html) {
    const doc = frame.contentDocument, win = frame.contentWindow;
    if (!doc || !win) return;
    // (its styles, scripts and style="" taken out of the words first: even parsed, the page's rules report them)
    let css = "";
    const clean = String(html).replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, t) => { css += `${t}\n`; return ""; }).replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi, " data-money-style=$1");
    const parsed = new DOMParser().parseFromString(clean, "text/html");
    parsed.querySelectorAll("script, link, meta, base, title").forEach((n) => n.remove());
    const faces = [];
    css = css.replace(/@font-face\s*\{[^}]*\}/g, (r) => { faces.push(r); return ""; });
    try { const sheet = new win.CSSStyleSheet(); sheet.replaceSync(css); doc.adoptedStyleSheets = [sheet]; } catch (e) { /* (an old browser: the words, unstyled) */ }
    doc.documentElement.className = `${parsed.documentElement.className || ""} still`.trim();
    doc.body.replaceWith(doc.importNode(parsed.body, true));
    doc.querySelectorAll("[data-money-style]").forEach((el) => { el.style.cssText = el.dataset.moneyStyle; el.removeAttribute("data-money-style"); });
    doc.querySelectorAll("a[href]").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
    for (const r of faces) {
      const fam = r.match(/font-family\s*:\s*["']?([^;"'}]+)/i)?.[1];
      const src = r.match(/url\(\s*["']?(data:[^)"']+)/i)?.[1];
      if (!fam || !src || !/;base64,/.test(src)) continue;
      try {
        const key = `${fam}:${src.length}:${src.slice(-40)}`;
        if (!fonts.has(key)) { const bin = atob(src.slice(src.indexOf(",") + 1)); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); fonts.set(key, buf.buffer); }
        const desc = {};
        const w = r.match(/font-weight\s*:\s*([^;}]+)/i)?.[1]; if (w) desc.weight = w.trim();
        const st = r.match(/font-stretch\s*:\s*([^;}]+)/i)?.[1]; if (st) desc.stretch = st.trim();
        const face = new win.FontFace(fam.trim(), fonts.get(key), desc);
        await face.load();
        doc.fonts.add(face);
      } catch (e) { /* (the phone's own fonts instead) */ }
    }
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
        ${field({ label: "Day", name: "spentOn", type: "date", value: e?.spentOn || N.today(), attrs: `max="${N.today()}"` })}
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
    const s = data.settings || {};
    box.innerHTML = `${partTabs("tax")}
      <p class="lead">Tax year ${esc(t.name || "")}</p>
      <div class="sums"><div class="sum"><b>${money(t.inPence)}</b><span>In</span></div><div class="sum"><b>${money(t.outPence)}</b><span>Out</span></div><div class="sum"><b>${money((t.inPence || 0) - (t.outPence || 0))}</b><span>Difference</span></div></div>
      ${cats.length ? `<h3 class="h">Where the money went</h3><div class="card bars">${cats.map((c) => `<div class="bar-row"><span>${esc(c.category)}</span><b>${money(c.pence)}</b><i class="bar" data-w="${Math.round((c.pence / most) * 100)}"></i></div>`).join("")}</div>` : ""}
      ${accountant(t.from ? t : null, can)}
      <h3 class="h">Invoice settings</h3>
      <div class="card"><div class="facts">${[["Emailing invoices", data.emailReady ? "Ready" : "Not set up"], ["Pay by card", data.cardReady ? "Ready" : "Not set up"], ["Bank details", s.bankReady ? "Added" : "Not added"], ["Pay with Monzo", s.monzoReady ? "Added" : "Not added"], ["VAT", `${s.vatRate || 0}%`], ["Days to pay", s.dueDays ?? ""]].map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      ${can ? `<a class="btn wide" href="#money/settings">${icon("cog")} Change the invoice settings</a>` : `<p class="muted small money-say">An admin changes the invoice settings.</p>`}`;
    box.querySelectorAll(".bar[data-w]").forEach((b) => b.style.setProperty("width", `${b.dataset.w}%`));
    wireSheet(box);
  }
  // ---- The invoice settings: the bank details, Monzo and the studio on every invoice (admins) ----
  function drawSettings(box, ui) {
    const back = lastPlace && lastPlace !== location.hash ? lastPlace : "#money/tax";
    ui.back(back);
    ui.title("Invoice settings");
    if (!data.canDecide) { box.innerHTML = empty({ icon: "cog", title: "An admin changes the invoice settings", text: "The bank details, Monzo, the studio's details, VAT and days to pay.", action: `<a class="btn" href="${esc(back)}">${icon("back")} Back</a>` }); return; }
    const s = data.settings || {}, b = s.business || {}, k = s.bank || {}, m = s.monzo || {};
    box.innerHTML = `<form class="form" id="set" novalidate>
        <p class="muted small money-say">Shown on every invoice, its page and its email, so clients can pay with Monzo or by bank transfer.</p>
        <h3 class="h">How clients pay</h3>
        ${field({ label: "Monzo link (optional)", name: "monzo", value: m.link || "", placeholder: "monzo.me/yourname", hint: "A \"Pay with Monzo\" button on each invoice, in its theme, with the amount and invoice number filled in.", attrs: 'maxlength="300" autocomplete="off" spellcheck="false"' })}
        ${field({ label: "Account name", name: "accountName", value: k.accountName || "", attrs: 'maxlength="120" autocomplete="off"' })}<div class="two-up">${field({ label: "Sort code", name: "sortCode", value: k.sortCode || "", placeholder: "12-34-56", attrs: 'inputmode="numeric" maxlength="20" autocomplete="off"' })}${field({ label: "Account number", name: "accountNumber", value: k.accountNumber || "", placeholder: "12345678", attrs: 'inputmode="numeric" maxlength="34" autocomplete="off"' })}</div>
        ${field({ label: "Note (optional)", name: "bankNote", value: k.note || "", placeholder: "Bank: Monzo", attrs: 'maxlength="200" autocomplete="off"' })}
        <h3 class="h">The studio on every invoice</h3>
        ${field({ label: "Studio name", name: "name", value: b.name || "", attrs: 'maxlength="120"' })}${field({ label: "Studio address", name: "address", type: "textarea", rows: 3, value: b.address || "", attrs: 'maxlength="400"' })}
        ${field({ label: "Email for replies", name: "email", type: "email", value: b.email || "", attrs: 'maxlength="200"' })}${field({ label: "VAT number (if registered)", name: "vatNumber", value: b.vatNumber || "", attrs: 'maxlength="30"' })}
        ${field({ label: "Phone", name: "phone", value: b.phone || "" })}${field({ label: "Website", name: "website", value: b.website || "" })}
        <h3 class="h">New invoices</h3>
        <div class="two-up">${field({ label: "VAT %", name: "vatRate", type: "number", value: s.vatRate ?? "", attrs: 'min="0" max="100" step="0.01"' })}${field({ label: "Days to pay", name: "dueDays", type: "number", value: s.dueDays ?? "", attrs: 'min="0" max="120" step="1"' })}</div>
        <p class="muted small money-say">Emailing invoices: ${data.emailReady ? "ready" : "not set up yet"}. Pay by card (Stripe): ${data.cardReady ? "ready" : "not set up yet"}.</p>
        <p class="form-said" id="set-said" role="status"></p>
        <button class="btn main wide" type="submit">${icon("check")} Save</button></form>`;
    const f = box.querySelector("#set");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements;
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          await post(`${A}/settings`, { bank: { accountName: x.accountName.value.trim(), sortCode: x.sortCode.value.trim(), accountNumber: x.accountNumber.value.replace(/\s/g, ""), note: x.bankNote.value.trim() }, monzo: { link: x.monzo.value.trim() }, business: { name: x.name.value.trim(), address: x.address.value.trim(), email: x.email.value.trim(), phone: x.phone.value.trim(), website: x.website.value.trim(), vatNumber: x.vatNumber.value.trim() }, ...(x.vatRate.value !== "" ? { vatRate: Number(x.vatRate.value) } : {}), ...(x.dueDays.value !== "" ? { dueDays: Number(x.dueDays.value) } : {}) });
          f.classList.remove("dirty"); toast("Saved: they're on every invoice now."); location.hash = back;
        } catch (err) { const said = box.querySelector("#set-said"); said.textContent = err.message; said.classList.add("bad"); }
      });
    });
  }
})();
