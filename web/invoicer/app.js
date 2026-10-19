// Invoicer: the invoices (Nova Bot's Money), each at one of its four stages, as the studio's branded
// page and the email that goes with it. The stage is worked out by Nova Bot from the payments and
// the due date (src/invoicer.js there) and can be chosen by hand; every sum comes from there.
// Sending is Money's: an invoice, and every reminder, is only emailed after an admin's Approve
// (an admin can press it here; Nova Bot checks it's an admin signed in with a browser).

const $ = (id) => document.getElementById(id);
const STAGE_NAMES = { deposit: "Deposit due", balance: "Balance due", overdue: "Overdue", paid: "Paid receipt" };
const WAITING = ["draft", "pending_approval", "approved", "rejected", "failed"];

let data = null; // the last /app/api/money answer
let catalogue = { services: [], depositPercent: 50 };
let clients = [];
let filter = "all";
let chosen = null; // { id, stage, staged (the /stage answer), detail (the /invoices/:id answer) }
let themes = []; // the invoice's looks, from the price list's answer: [{ id, name, band, accent }]
let studioTheme = "night"; // the one every invoice uses (Money's settings)
let theme = null; // the one shown here: the chosen invoice's own (it's saved on it), else this browser's last pick
let studioMode = "bright"; // every invoice's page: bright (white) or dark (the website's near-black)
let mode = null; // the one shown here
let papers = []; // the paper's styles (minerals), from the price list's answer
let studioPaper = "moonstone";
let paper = null; // the one shown here
try {
  theme = localStorage.getItem("invoicer-theme");
  paper = localStorage.getItem("invoicer-paper");
  mode = localStorage.getItem("invoicer-mode");
} catch {}

// ---- Talking to Nova Bot ----
class Problem extends Error {}
async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json", "X-Nova-App": "portal" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch("/app/api/" + path, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Problem("Can't reach Nova Bot. Check the connection and try again.");
  }
  let out = {};
  try {
    out = await res.json();
  } catch {}
  if (res.status === 401) throw new Problem("Sign in to Portal first (Apps → Portal), then come back.");
  if (!res.ok) throw new Problem(out.error || `That didn't work (${res.status}).`);
  return out;
}

// ---- Small things ----
function pounds(pence) {
  const p = Math.round(Number(pence) || 0);
  return (p < 0 ? "−" : "") + "£" + (Math.abs(p) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const ukToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (day, n) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayText = (day) => (day ? new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
// The same as Nova Bot's stageOf (src/invoicer.js), for the list
function stageOf(inv, today = ukToday()) {
  if (inv.paidPence >= inv.totalPence || inv.status === "paid") return "paid";
  if (["sent", "part_paid"].includes(inv.status) && inv.dueDate < today) return "overdue";
  if (inv.paidPence > 0 || inv.billing === "full") return "balance";
  return "deposit";
}
function say(text, bad = false) {
  const m = $("message");
  m.textContent = text || "";
  m.classList.toggle("bad", bad);
  m.hidden = !text;
}
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
}
function openInNova(path) {
  try {
    if (window.top.NovaAgent && window.top.NovaAgent.open(path)) return;
  } catch {}
  window.open(path, "_blank", "noopener");
}

// ---- The list ----
async function load(keep = true) {
  try {
    data = await api("money");
    say("");
  } catch (err) {
    say(err.message, true);
    return;
  }
  drawList();
  drawBank();
  restartBtn.hidden = !data?.canDecide || !(data.invoices || []).some((i) => /^NS-/.test(i.number));
  if (keep && chosen) await choose(chosen.id, chosen.stage, true);
}

const restartBtn = $("restart-btn");
function drawList() {
  const list = $("list");
  const q = $("search").value.trim().toLowerCase();
  const today = ukToday();
  // (a reminder or receipt waiting for an admin counts as one to approve too; removed ones only under Removed)
  const reminding = new Set((data?.reminders || []).filter((r) => r.status === "pending_approval").map((r) => r.invoiceId));
  const rows = (data?.invoices || []).filter((inv) => (filter === "removed" ? inv.status === "void" : inv.status !== "void")).filter((inv) => {
    const waiting = WAITING.includes(inv.status);
    if (filter === "waiting" && !waiting && !reminding.has(inv.id)) return false;
    if (["deposit", "balance", "overdue", "paid"].includes(filter) && (waiting || stageOf(inv, today) !== filter)) return false;
    return !q || inv.number.toLowerCase().includes(q) || inv.billTo.name.toLowerCase().includes(q);
  });
  list.replaceChildren();
  if (!rows.length) {
    list.append(el("li", { class: "empty", text: data?.invoices?.length ? "None like that." : "No invoices yet: make the first with New invoice." }));
    return;
  }
  for (const inv of rows) {
    const waiting = WAITING.includes(inv.status);
    const stage = stageOf(inv, today);
    const chip = inv.status === "void" ? el("span", { class: "tag waiting", text: "Removed" }) : waiting ? el("span", { class: "tag waiting", text: inv.status === "rejected" ? "Rejected" : inv.status === "failed" ? "Didn't send" : "To approve" }) : el("span", { class: `tag s-${stage}`, text: STAGE_NAMES[stage] });
    // (a round badge with the artist's initials, in the colour of where the invoice is)
    const initials = (inv.billTo.name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
    const btn = el(
      "button",
      { type: "button", class: "inv", "aria-current": chosen && chosen.id === inv.id ? "true" : "false", "data-id": inv.id, "data-st": waiting ? "waiting" : stage },
      el("span", { class: "av", "aria-hidden": "true", text: initials }),
      el("span", { class: "who" }, el("b", { text: inv.billTo.name }), el("small", { text: `${inv.number} · ${dayText(inv.issueDate)}` }, reminding.has(inv.id) ? el("i", { class: "rem-dot", title: "A reminder or receipt is waiting for an admin" }) : null)),
      el("span", { class: "amt" }, el("b", { text: pounds(inv.totalPence) }), chip)
    );
    btn.addEventListener("click", () => {
      choose(inv.id);
      showPart("doc");
    });
    list.append(el("li", {}, btn));
  }
  // (Start numbers again sits at the end of the list, so it scrolls with it on a short screen)
  list.append(el("li", { class: "restart-li" }, restartBtn));
}

// ---- One invoice, at a stage ----
async function choose(id, stage = null, quiet = false) {
  const first = !chosen || chosen.id !== id;
  try {
    const [staged, detail] = await Promise.all([api(`money/invoices/${id}/stage${stage ? `?stage=${stage}` : ""}`), first || !chosen.detail ? api(`money/invoices/${id}`) : Promise.resolve(chosen.detail)]);
    chosen = { id, stage: staged.stage, staged, detail };
  } catch (err) {
    if (!quiet) say(err.message, true);
    return;
  }
  for (const b of document.querySelectorAll(".inv")) b.setAttribute("aria-current", String(Number(b.dataset.id) === id));
  drawStage(first);
}

// The invoice's page: its stage, the theme shown here and the words in the Notes box
function docSrc() {
  const q = new URLSearchParams({ stage: chosen.staged.stage });
  if (theme) q.set("theme", theme);
  if (mode) q.set("mode", mode);
  if (paper) q.set("paper", paper);
  const note = $("note").value.trim();
  if (note !== (chosen.staged.invoice.notes || "").trim()) q.set("note", note);
  return `/app/api/money/invoices/${chosen.id}/document?${q}`;
}
function drawStage(first = false) {
  const { staged, detail } = chosen;
  const inv = staged.invoice;
  for (const b of $("stages").querySelectorAll("button")) {
    const s = b.dataset.stage;
    b.setAttribute("aria-checked", String(s === staged.stage));
    b.classList.toggle("auto", s === staged.autoStage);
    b.title = s === staged.autoStage ? "Where this invoice is now (from its payments and due date)" : "See it at this stage";
  }
  const sums = staged.sums;
  const parts = [`${inv.number} · ${inv.billTo.name} · total ${pounds(sums.totalPence)}`];
  if (sums.paidPence) parts.push(`paid ${pounds(sums.paidPence)}`);
  parts.push(staged.stage === "paid" ? "nothing left to pay" : `due now ${pounds(sums.dueNowPence)}`);
  if (staged.stage !== staged.autoStage) parts.push(`(it's really at ${STAGE_NAMES[staged.autoStage]})`);
  $("stage-note").textContent = parts.join(" · ");
  // (a new invoice: its own note in the Notes box, and its own look)
  if (first) {
    $("note").value = inv.notes || "";
    theme = inv.look?.theme || null;
    mode = inv.look?.mode || null;
    paper = inv.look?.paper || null;
    drawThemes();
  }
  drawNoteSave();
  const src = docSrc();
  const frame = $("doc");
  if (frame.getAttribute("src") !== src) frame.src = src;
  frame.hidden = false;
  $("doc-empty").hidden = true;
  $("print-btn").disabled = false;
  // Edit: until it's paid in full or removed; Remove (admins): until money's been paid on it
  $("edit-btn").disabled = inv.status === "paid" || inv.status === "void";
  $("edit-btn").title = inv.status === "paid" ? "Paid in full: it can't change" : inv.status === "void" ? "Removed" : "Change it: its artist, lines, dates and notes";
  $("remove-btn").hidden = !data?.canDecide || inv.status === "void" || inv.paidPence > 0;
  // Payment: once it's out (sent or part paid); History: always
  $("pay-btn").disabled = !["sent", "part_paid"].includes(inv.status);
  $("pay-btn").title = $("pay-btn").disabled ? (inv.status === "paid" ? "Paid in full" : "Payments are recorded once it's been sent") : "Record a payment: by bank transfer, Monzo, cash…";
  $("history-btn").disabled = false;
  // Share: once it's approved (its page opens), or an admin approves it to share
  $("share-btn").disabled = inv.status === "void" || !(inv.pageUrl || (data?.canDecide && WAITING.includes(inv.status) && inv.status !== "rejected"));
  $("share-btn").title = inv.pageUrl ? "Send its link by WhatsApp, a message, Instagram…" : data?.canDecide ? "Approve it to share, then send its link" : "It can be shared once an admin approves it";
  $("open-btn").href = src;
  $("open-btn").removeAttribute("aria-disabled");
  // The email
  $("subject").value = staged.email.subject;
  $("body").value = staged.email.body;
  $("copy-btn").disabled = false;
  drawSend(inv, detail, staged.stage);
}

// What "Send" can do for this invoice, now
function drawSend(inv, detail, stage) {
  const btn = $("send-btn");
  const note = $("send-note");
  const chip = $("mail-chip");
  const admin = Boolean(data?.canDecide);
  const reminders = detail?.reminders || [];
  const receipt = inv.status === "paid" || stage === "paid";
  const kind = receipt ? "receipt" : "reminder";
  const waiting = reminders.find((r) => r.status === "pending_approval" && (r.kind || "reminder") === kind);
  const receiptSent = reminders.some((r) => r.kind === "receipt" && r.status === "sent");
  $("test-btn").hidden = !admin;
  // (it sends the stage shown: at Paid receipt, the receipt)
  $("test-btn").textContent = stage === "paid" ? "Send me a test receipt" : "Send me a test";
  $("test-btn").title = stage === "paid" ? "The receipt email, to your own address only" : "This email, to your own address only";
  btn.hidden = false;
  btn.disabled = false;
  chip.hidden = true;
  btn.onclick = null;
  // Reject (an admin): an invoice waiting for approval, or a reminder or receipt waiting; nothing is emailed
  const rejectBtn = $("reject-btn");
  const pendingInvoice = ["draft", "pending_approval"].includes(inv.status);
  rejectBtn.hidden = !admin || !(pendingInvoice || waiting);
  rejectBtn.textContent = pendingInvoice ? "Reject the invoice" : waiting ? `Reject the ${receipt ? "receipt" : "reminder"}` : "Reject";
  rejectBtn.onclick = () => (pendingInvoice ? askWhy(`Reject ${inv.number}`, `It isn't emailed. It can be changed with Edit and sent for approval again.`, (note) => api(`money/invoices/${inv.id}/reject`, { method: "POST", body: { note } }), `${inv.number} rejected: nothing was emailed.`) : askWhy(`Reject the ${receipt ? "receipt" : "reminder"}`, `It isn't emailed. ${inv.number} stays as it is.`, () => api(`money/reminders/${waiting.id}/reject`, { method: "POST", body: {} }), `The ${receipt ? "receipt" : "reminder"} was rejected: nothing was emailed.`));
  if (WAITING.includes(inv.status)) {
    chip.hidden = false;
    chip.textContent = "Not sent yet";
    if (admin) {
      btn.textContent = "Approve and email it";
      note.textContent = `Emails ${inv.billTo.email || "(no email address)"} the invoice itself (the Nova invoice, with a text version for email apps that can't show it) and a button to its page, where they can pay. Your Approve is the check: nothing goes without it.`;
      btn.onclick = () => doNow(btn, () => api(`money/invoices/${inv.id}/approve`, { method: "POST", body: {} }), "Approved: it's on its way.");
    } else {
      btn.textContent = "Waiting for an admin";
      btn.disabled = true;
      note.textContent = "An admin approves it here, then it's emailed. Until then you can copy the email and the PDF.";
    }
    return;
  }
  if (receipt && receiptSent && !waiting) {
    chip.hidden = false;
    chip.textContent = "Receipt sent";
    btn.hidden = true;
    note.textContent = `Its receipt went to ${inv.billTo.email || "the client"}.`;
    return;
  }
  if (waiting) {
    chip.hidden = false;
    chip.textContent = receipt ? "The receipt is waiting" : "A reminder is waiting";
    if (admin) {
      btn.textContent = receipt ? "Approve and email the receipt" : "Approve the waiting reminder";
      note.textContent = receipt ? "It was written by itself when the invoice was paid in full: the receipt (the invoice, marked paid) with a thank-you. Approving emails exactly that." : "Someone queued a reminder for this invoice. Approving emails exactly what they wrote, with the invoice under it.";
      btn.onclick = () => doNow(btn, () => api(`money/reminders/${waiting.id}/approve`, { method: "POST", body: {} }), receipt ? "Receipt sent." : "Reminder sent.");
    } else {
      btn.textContent = "Waiting for an admin";
      btn.disabled = true;
      note.textContent = `${receipt ? "The receipt" : "A reminder"} for it is already waiting for an admin's Approve.`;
    }
    return;
  }
  btn.textContent = receipt ? "Send the receipt for approval" : "Send for approval";
  note.textContent = `Queues this message for ${inv.billTo.email || "(no email address)"}, with the ${receipt ? "receipt" : "invoice"} under it. An admin approves it before it goes.`;
  btn.onclick = () =>
    doNow(btn, () => api(`money/invoices/${inv.id}/reminder`, { method: "POST", body: { body: forMoney($("body").value), kind } }), admin ? "Queued: approve it with the button above." : "Queued: an admin approves it before it goes.");
}
// Money's email adds the button to the invoice's page and a sign-off itself
// (the invoice under the message has the link, Monzo, the bank details and the studio's sign-off, so those
// lines are left out of what's queued)
function forMoney(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !/^(See and pay it online:|Or pay with Monzo:|Or by bank transfer)/.test(l))
        .join("\n")
    )
    .filter((p) => p.trim() && !/^Best wishes,?\n/i.test(p))
    .join("\n\n");
}
// A test, to the admin's own email address only: the email at this stage with this message
$("test-btn").addEventListener("click", async () => {
  if (!chosen) return;
  const b = $("test-btn");
  b.disabled = true;
  try {
    const r = await api("money/invoices/test-send", { method: "POST", body: { id: chosen.id, stage: chosen.staged.stage, body: forMoney($("body").value) } });
    say(`${chosen.staged.stage === "paid" ? "Test receipt" : "Test"} sent to ${r.to || "you"}: check your inbox.`);
  } catch (err) {
    say(err.message, true);
  } finally {
    b.disabled = false;
  }
});
// The email as the client will get it, in its own tab
// (nothing chosen yet: say what to do, instead of nothing happening)
const chooseFirst = () => say("Choose an invoice first: one on the left, or make a new one with New invoice.");
$("email-btn").addEventListener("click", () => {
  if (!chosen) return chooseFirst();
  const q = new URLSearchParams({ stage: chosen.staged.stage, body: forMoney($("body").value) });
  window.open(`/app/api/money/invoices/${chosen.id}/email?${q}`, "_blank", "noopener");
});
// Send (19 Oct 2026): one press does it (the line under the button says who it goes to); the button
// is held while it goes, so a second press can't send it twice
function doNow(btn, act, done) {
  if (btn.disabled) return;
  btn.disabled = true;
  act()
    .then(async () => {
      say(done);
      chosen.detail = null;
      await load();
      if ($("history").open) await openHistory();
    })
    .catch((err) => say(err.message, true))
    .finally(() => (btn.disabled = false));
}
// One press asks, the second does it (it goes back after a few seconds): removing, and saving notes
// on one that's gone
function confirmThen(btn, ask, act, done) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    doNow(btn, act, done);
    return;
  }
  const was = btn.textContent;
  btn.dataset.armed = "1";
  btn.textContent = ask;
  setTimeout(() => {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = was;
    }
  }, 6000);
}

// ---- The themes and the note ----
function drawThemes() {
  const box = $("themes");
  box.replaceChildren(
    ...themes.map((t) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(t.id === (theme || studioTheme)), title: t.id === studioTheme ? `${t.name}: every invoice's look` : `See it in ${t.name}` });
      const sw = el("span", { class: "sw", "aria-hidden": "true" });
      sw.style.setProperty("--b", t.band);
      sw.style.setProperty("--a", t.accent);
      b.title = t.id === studioTheme ? `${t.name}: every invoice's colour` : `See it in ${t.name}`;
      b.append(sw, t.name, t.id === studioTheme ? el("span", { class: "star", "aria-label": "(every invoice)", text: "★" }) : "");
      b.addEventListener("click", () => {
        theme = t.id;
        try {
          localStorage.setItem("invoicer-theme", t.id);
        } catch {}
        drawThemes();
        refreshDoc();
        saveLook();
      });
      return b;
    })
  );
  for (const b of $("modes").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.mode === (mode || studioMode)));
  // The paper menu
  const sel = $("paper");
  if (sel.options.length !== papers.length) sel.replaceChildren(...papers.map((x) => el("option", { value: x.id, text: x.name + (x.id === studioPaper ? " ★" : "") })));
  sel.value = paper || studioPaper;
  $("look-name").textContent = (mode || studioMode) === "dark" ? "Dark" : "Bright";
  // An admin can make the one shown every invoice's look
  $("theme-save").hidden = !(data?.canDecide && ((theme && theme !== studioTheme) || (mode && mode !== studioMode) || (paper && paper !== studioPaper)));
}
$("paper").addEventListener("change", () => {
  paper = $("paper").value;
  try {
    localStorage.setItem("invoicer-paper", paper);
  } catch {}
  drawThemes();
  refreshDoc();
  saveLook();
});
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  try {
    localStorage.setItem("invoicer-mode", mode);
  } catch {}
  drawThemes();
  refreshDoc();
  saveLook();
});
// The look chosen is saved on the invoice that's open: its email, its page, its PDF and its receipt
// all use it (only how it looks: no approval needed again)
let lookTimer = 0;
function saveLook() {
  if (!chosen) return;
  const inv = chosen.staged.invoice;
  if (inv.status === "void") return;
  const look = { theme: theme || studioTheme, mode: mode || studioMode, paper: paper || studioPaper };
  clearTimeout(lookTimer);
  lookTimer = setTimeout(async () => {
    try {
      const r = await api(`money/invoices/${inv.id}/look`, { method: "POST", body: { look } });
      inv.look = r.invoice?.look || look;
      const name = `${themes.find((t) => t.id === look.theme)?.name || look.theme}, ${look.mode === "dark" ? "Dark" : "Bright"}, ${papers.find((x) => x.id === look.paper)?.name || look.paper} paper`;
      const sent = ["sent", "part_paid", "paid"].includes(inv.status);
      say(`Saved on ${inv.number}: ${name}.${sent ? " Its page shows it now; emails from now on use it." : " It's sent like this."}`);
    } catch (err) {
      say(err.message, true);
    }
  }, 350);
}
function refreshDoc() {
  if (!chosen) return;
  const src = docSrc();
  $("doc").src = src;
  $("open-btn").href = src;
}
let noteTimer = 0;
$("note").addEventListener("input", () => {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(refreshDoc, 400);
  drawNoteSave();
});
// The Notes box's words saved on the invoice (not sent yet: straight in; sent: it goes for an admin's
// Approve again, then the client gets the updated invoice). Paid or removed: they're for this copy only.
function drawNoteSave() {
  const btn = $("note-save");
  const inv = chosen?.staged.invoice;
  const can = inv && !["paid", "void"].includes(inv.status);
  btn.hidden = !can || $("note").value.trim() === (inv.notes || "").trim();
  if (inv && WAITING.includes(inv.status)) btn.textContent = "Save notes";
  else btn.textContent = "Save notes (sends the updated invoice after Approve)";
}
$("note-save").addEventListener("click", () => {
  if (!chosen) return;
  const inv = chosen.staged.invoice;
  const notes = $("note").value.trim();
  const btn = $("note-save");
  if (WAITING.includes(inv.status)) {
    btn.disabled = true;
    api(`money/invoices/${inv.id}/edit`, { method: "POST", body: { notes } })
      .then(async () => {
        say(`Notes saved on ${inv.number}. It waits for an admin's Approve.`);
        chosen = null;
        await load(false);
        await choose(inv.id);
      })
      .catch((err) => say(err.message, true))
      .finally(() => (btn.disabled = false));
    return;
  }
  confirmThen(btn, "Yes, save: it goes for Approve again", () => api(`money/invoices/${inv.id}/edit`, { method: "POST", body: { notes } }), `Notes saved on ${inv.number}. Once an admin approves, the client gets the updated invoice.`);
});
$("theme-save").addEventListener("click", async () => {
  try {
    const r = await api("money/settings", { method: "POST", body: { invoiceTheme: theme || studioTheme, invoiceMode: mode || studioMode, invoicePaper: paper || studioPaper } });
    studioPaper = r.settings?.invoicePaper || paper || studioPaper;
    $("paper").replaceChildren();
    studioTheme = r.settings?.invoiceTheme || theme || studioTheme;
    studioMode = r.settings?.invoiceMode || mode || studioMode;
    say(`Every invoice now uses ${themes.find((t) => t.id === studioTheme)?.name || studioTheme}, ${studioMode}.`);
    drawThemes();
  } catch (err) {
    say(err.message, true);
  }
});

// ---- The buttons ----
$("stages").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-stage]");
  if (b && !chosen) return chooseFirst();
  if (b && chosen) choose(chosen.id, b.dataset.stage);
});
$("filters").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-filter]");
  if (!b) return;
  filter = b.dataset.filter;
  for (const x of $("filters").querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
  drawList();
});
$("search").addEventListener("input", drawList);
// ---- PDF: any invoice as a PDF file (19 Oct 2026), before it's sent and after, as it's shown here ----
// Nova Bot draws it and Nova Agent prints it (na src/pdf.ts); if that can't be done just now, the
// invoice opens ready to print instead, with the browser's own Save as PDF
async function downloadPdf(path, { method = "GET", body } = {}, name, button = null) {
  const was = button?.textContent;
  if (button) {
    button.setAttribute("aria-busy", "true");
    button.textContent = "Making…";
  }
  try {
    const res = await fetch(path, { method, credentials: "same-origin", headers: body === undefined ? {} : { "Content-Type": "application/json", "X-Nova-App": "portal" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Problem(res.status === 401 ? "Sign in again to download it." : "The PDF couldn't be made. Try again in a moment.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (blob.type === "application/pdf") {
      const a = el("a", { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
    } else window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    say(err instanceof Problem ? err.message : "The PDF couldn't be made. Check the connection and try again.", true);
  } finally {
    if (button) {
      button.removeAttribute("aria-busy");
      button.textContent = was;
    }
  }
}
$("print-btn").addEventListener("click", () => downloadPdf(docSrc().replace("/document?", "/pdf?"), {}, `Novacane Studios ${chosen.staged.invoice.number}.pdf`, $("print-btn")));
$("np-pdf").addEventListener("click", () => downloadPdf("/app/api/money/invoices/preview/pdf", { method: "POST", body: draft() }, `Novacane Studios draft${$("n-name")?.value ? ` for ${$("n-name").value.trim()}` : ""}.pdf`, $("np-pdf")));
$("copy-btn").addEventListener("click", async () => {
  const text = `Subject: ${$("subject").value}\n\n${$("body").value}`;
  try {
    await navigator.clipboard.writeText(text);
    say("Copied: paste it into Gmail.");
  } catch {
    $("body").select();
    say("Press Ctrl+C to copy the message.");
  }
});

// ---- A phone: one part at a time ----
function showPart(part) {
  const was = document.body.dataset.part;
  document.body.dataset.part = part;
  for (const b of $("parts").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.part === part));
  // (the page scrolls on a phone: a new part starts at its top, under the pinned parts)
  if (was && was !== part && PHONE.matches) window.scrollTo(0, 0);
  if (part === "doc") requestAnimationFrame(fitDoc);
}
// A phone (19 Oct 2026): the page scrolls, so the invoice is shown at its full height (its own height,
// measured from its page; never a box scrolling inside the page). On a computer it fills its column.
const PHONE = matchMedia("(max-width: 820px), (max-height: 500px)");
function fitDoc() {
  const frame = $("doc");
  const box = frame.parentElement;
  if (!PHONE.matches) return box.style.removeProperty("--doc-h");
  try {
    const body = frame.contentDocument?.body;
    if (!body || !frame.clientWidth) return;
    const s = frame.contentWindow.getComputedStyle(body);
    const h = Math.ceil(body.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom));
    if (h > 100) box.style.setProperty("--doc-h", `${h}px`);
  } catch {}
}
let docWatch = null;
$("doc").addEventListener("load", () => {
  fitDoc();
  setTimeout(fitDoc, 500); // (once its fonts are in)
  docWatch?.disconnect();
  try {
    docWatch = new ResizeObserver(fitDoc);
    docWatch.observe($("doc").contentDocument.body);
  } catch {}
});
PHONE.addEventListener("change", fitDoc);
// (a narrow screen: the search box's hint in fewer words, so it's never cut off beside New invoice)
const fitHint = () => ($("search").placeholder = innerWidth < 440 ? "Artist or number" : "Search artist or number");
fitHint();
addEventListener("resize", () => (fitDoc(), fitHint()));
$("parts").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-part]");
  if (b) showPart(b.dataset.part);
});
showPart("list");

// ---- A new invoice ----
let lines = []; // { key, description, qty, unit (pounds, text), id? }
let nextKey = 1;
function fillCatalogue() {
  const sel = $("n-service");
  sel.replaceChildren();
  const groups = new Map();
  for (const s of catalogue.services) {
    if (!groups.has(s.group)) groups.set(s.group, el("optgroup", { label: s.group }));
    groups.get(s.group).append(el("option", { value: s.id, text: `${s.name} · ${s.from ? "from " : ""}${pounds(s.pricePence)}` }));
  }
  sel.append(...groups.values());
  $("n-deposit-label").textContent = `Deposit (${catalogue.depositPercent}%)`;
}
const toPence = (text) => {
  const n = Number(String(text).replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
// Mastering: £30 a song for 3 to 10 songs, £50 for 1 or 2 (the price list's rule)
function masteringRule() {
  const m = lines.filter((l) => l.id === "master-1" || l.id === "master-3");
  const songs = m.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const want = songs >= 3 && songs <= 10 ? "master-3" : "master-1";
  const svc = catalogue.services.find((s) => s.id === want);
  for (const l of m) {
    if (l.id === want || !svc) continue;
    l.id = want;
    l.description = svc.name;
    l.unit = (svc.pricePence / 100).toFixed(2);
  }
}
function drawLines() {
  masteringRule();
  const body = $("n-lines");
  body.replaceChildren();
  let total = 0;
  for (const l of lines) {
    const amount = Math.round((Number(l.qty) || 0) * (toPence(l.unit) || 0));
    total += amount;
    const desc = el("input", { class: "field", value: l.description, "aria-label": "What it's for", required: true });
    desc.addEventListener("input", () => (l.description = desc.value));
    const qty = el("input", { class: "field qty", type: "number", min: "1", step: "1", value: l.qty, "aria-label": "How many" });
    qty.addEventListener("change", () => {
      l.qty = qty.value;
      drawLines();
    });
    const unit = el("input", { class: "field price", inputmode: "decimal", value: l.unit, "aria-label": "Price of one, in pounds" });
    unit.addEventListener("change", () => {
      l.unit = unit.value;
      drawLines();
    });
    const rm = el("button", { type: "button", class: "ghost", "aria-label": `Remove ${l.description || "this line"}`, text: "✕" });
    rm.addEventListener("click", () => {
      lines = lines.filter((x) => x !== l);
      drawLines();
    });
    body.append(el("tr", {}, el("td", {}, desc), el("td", {}, qty), el("td", {}, unit), el("td", { class: "n", text: pounds(amount) }), el("td", {}, rm)));
  }
  if (!lines.length) body.append(el("tr", {}, el("td", { colspan: "5", class: "muted", text: "Nothing yet: pick a service above and press Add." })));
  livePreview();
  $("n-total").textContent = pounds(total);
  $("n-deposit").textContent = pounds(Math.round((total * catalogue.depositPercent) / 100));
  const from = lines.find((l) => catalogue.services.find((s) => s.id === l.id && s.from));
  $("n-hint").textContent = from ? "Custom production is from £250: type the price you agreed." : "";
}
// ---- The live preview: what's typed so far, drawn by Nova Bot as the invoice will look (nothing saved) ----
let previewTimer = 0;
let previewAsk = 0;
// Before the session (a deposit secures the date, the rest is due on the day) or after it (the full
// amount, with a thank-you): its emails follow it
let billing = "deposit";
function setBilling(b) {
  billing = b === "full" ? "full" : "deposit";
  for (const btn of $("n-billing").querySelectorAll("button")) btn.setAttribute("aria-checked", String(btn.dataset.billing === billing));
  $("n-due-label").textContent = billing === "full" ? "Payment due" : "Balance due (the session day)";
  $("n-deposit-row").hidden = billing === "full";
  livePreview();
}
$("n-billing").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-billing]");
  if (b) setBilling(b.dataset.billing);
});
function draft() {
  return {
    billName: $("n-name").value.trim(),
    billEmail: $("n-email").value.trim(),
    lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })),
    issueDate: $("n-issue").value,
    dueDate: $("n-due").value,
    notes: $("n-notes").value.trim(),
    billing,
    stage: billing === "full" ? "balance" : "deposit",
    theme: theme || studioTheme,
    mode: mode || studioMode,
  };
}
function livePreview() {
  if (!$("new").open) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const ask = ++previewAsk;
    try {
      const r = await api("money/invoices/preview", { method: "POST", body: draft() });
      if (ask !== previewAsk || !r.html) return; // (a newer one is on its way)
      $("n-preview").srcdoc = r.html;
      $("np-state").textContent = `${billing === "full" ? "Payment due" : "Deposit due"} · ${themes.find((t) => t.id === (theme || studioTheme))?.name || ""} · ${(mode || studioMode) === "dark" ? "Dark" : "Bright"}`;
    } catch (err) {
      $("np-state").textContent = err.message;
    }
  }, 250);
}
// The invoice shrinks to the preview's width, and the box scrolls down it
function fitPreview() {
  const box = $("np-frame");
  const k = Math.max(0.25, Math.min(1, (box.clientWidth - 2) / 860));
  box.style.setProperty("--k", k.toFixed(4));
  const doc = $("n-preview").contentDocument;
  const h = doc && doc.documentElement ? doc.documentElement.scrollHeight : 1180;
  $("n-preview").style.setProperty("--h", `${h}px`);
  $("n-preview").style.marginBottom = `${-(1 - k) * h}px`;
}
$("n-preview").addEventListener("load", fitPreview);
new ResizeObserver(fitPreview).observe($("np-frame"));
for (const id of ["n-name", "n-email", "n-issue", "n-due", "n-notes"]) $(id).addEventListener("input", livePreview);
$("n-lines").addEventListener("input", livePreview);

$("n-add").addEventListener("click", () => {
  const svc = catalogue.services.find((s) => s.id === $("n-service").value);
  if (!svc) return;
  const same = lines.find((l) => l.id === svc.id);
  if (same && !svc.from) same.qty = String((Number(same.qty) || 0) + 1);
  else lines.push({ key: nextKey++, id: svc.id, description: svc.name, qty: "1", unit: (svc.pricePence / 100).toFixed(2) });
  drawLines();
});
$("n-custom").addEventListener("click", () => {
  lines.push({ key: nextKey++, description: "", qty: "1", unit: "" });
  drawLines();
  $("n-lines").querySelector("tr:last-child input")?.focus();
});
$("n-issue").addEventListener("change", () => {
  if (!$("n-due").value || $("n-due").value < $("n-issue").value) $("n-due").value = addDays($("n-issue").value, 14);
});
function closeNew() {
  $("new").close();
}
$("new-close").addEventListener("click", closeNew);
$("n-cancel").addEventListener("click", closeNew);
// The form is for a new invoice, or for changing one (editing: { id, number, sent })
let editing = null;
function formFor(inv) {
  editing = inv ? { id: inv.id, number: inv.number, sent: ["sent", "part_paid"].includes(inv.status) } : null;
  $("new-title").textContent = inv ? `Edit ${inv.number}` : "New invoice";
  $("n-save").textContent = inv ? "Save changes" : "Make the invoice";
  $("n-foot").textContent = inv && editing.sent
    ? "It was sent: saved, it goes to an admin's Approve again, then the client gets the updated invoice. Its link says it's being updated meanwhile."
    : "It waits for an admin's Approve (here, with Send) before anything is emailed.";
}
$("edit-btn").addEventListener("click", () => {
  if (!chosen) return;
  const inv = chosen.staged.invoice;
  formFor(inv);
  lines = inv.lines.map((l) => ({ key: nextKey++, description: l.description, qty: String(l.qty), unit: (l.unitPence / 100).toFixed(2) }));
  $("n-error").hidden = true;
  $("n-name").value = inv.billTo.name || "";
  $("n-email").value = inv.billTo.email || "";
  $("n-issue").value = inv.issueDate;
  $("n-due").value = inv.dueDate;
  $("n-notes").value = inv.notes || "";
  $("new").showModal();
  setBilling(inv.billing);
  drawLines();
  $("n-name").focus();
});
$("remove-btn").addEventListener("click", () => {
  if (!chosen) return;
  const inv = chosen.staged.invoice;
  confirmThen($("remove-btn"), `Yes, remove ${inv.number}`, () => api(`money/invoices/${inv.id}/void`, { method: "POST", body: {} }), `${inv.number} removed (kept on record).`);
});
$("new-btn").addEventListener("click", async () => {
  formFor(null);
  lines = [];
  $("new-form").reset();
  $("n-error").hidden = true;
  $("n-issue").value = ukToday();
  $("n-due").value = addDays(ukToday(), 14);
  $("new").showModal();
  setBilling("deposit");
  drawLines();
  $("n-name").focus();
});
$("n-name").addEventListener("change", () => {
  const c = clients.find((x) => x.name.toLowerCase() === $("n-name").value.trim().toLowerCase());
  if (c && c.email && !$("n-email").value) $("n-email").value = c.email;
});
$("new-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("n-error");
  err.hidden = true;
  const problem = (t) => {
    err.textContent = t;
    err.hidden = false;
  };
  if (!lines.length) return problem("Add at least one service.");
  if (lines.some((l) => !l.description.trim() || !(toPence(l.unit) >= 0))) return problem("Each line needs what it's for and a price.");
  const name = $("n-name").value.trim();
  const client = clients.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const body = {
    billName: name,
    billEmail: $("n-email").value.trim(),
    lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })),
    issueDate: $("n-issue").value,
    dueDate: $("n-due").value,
    notes: $("n-notes").value.trim(),
    billing,
  };
  if (client) body.clientId = client.id;
  // (a new one keeps the look it was made in)
  if (!editing) body.look = { theme: theme || studioTheme, mode: mode || studioMode, paper: paper || studioPaper };
  $("n-save").disabled = true;
  try {
    const made = editing ? await api(`money/invoices/${editing.id}/edit`, { method: "POST", body }) : await api("money/invoices", { method: "POST", body });
    closeNew();
    say(editing ? `${made.invoice.number} saved. It waits for an admin's Approve${editing.sent ? ", then the client gets the updated invoice" : ""}.` : `${made.invoice.number} is made. It waits for an admin's Approve before it's emailed.`);
    if (editing) chosen = null;
    await load(false);
    await choose(made.invoice.id);
    showPart("doc");
  } catch (e2) {
    problem(e2.message);
  } finally {
    $("n-save").disabled = false;
  }
});

// Start the numbers again (admins, while testing): pressed twice, like every button that can't be undone here
restartBtn.addEventListener("click", async () => {
  const btn = restartBtn;
  if (!btn.dataset.armed) {
    btn.dataset.armed = "1";
    btn.textContent = "Yes: make them all TEST invoices, next is NS-0001";
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = "Start numbers again at NS-0001";
    }, 5000);
    return;
  }
  delete btn.dataset.armed;
  btn.disabled = true;
  try {
    const r = await api("money/invoices/renumber", { method: "POST", body: { confirm: "start again" } });
    say(`${r.renumbered} invoice${r.renumbered === 1 ? " is" : "s are"} now TEST invoices (kept, nothing deleted). The next one is NS-0001.`);
    chosen = null;
    await load(false);
  } catch (err) {
    say(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Start numbers again at NS-0001";
  }
});

// ---- Share: the invoice's page, sent by you (WhatsApp, Telegram, a text, email, the device's own list) ----
function shareMessage(inv) {
  const sums = chosen.staged.sums;
  const first = (inv.billTo.name || "").trim().split(/\s+/)[0] || "there";
  const due = sums.dueNowPence > 0 ? `${pounds(sums.dueNowPence)} due now` : "paid in full, thank you";
  // (with Monzo set up: its link too, the amount and the invoice number filled in)
  const monzo = sums.dueNowPence > 0 && inv.monzoUrl ? ` Or pay with Monzo: ${inv.monzoUrl}` : "";
  return `Hi ${first}, here's your invoice ${inv.number} from Novacane Studios (${due}). See it and pay here: ${inv.pageUrl}${monzo} Download it as a PDF: ${inv.pageUrl}/pdf`;
}
function drawShare() {
  const inv = chosen.staged.invoice;
  $("share-ready").hidden = !inv.pageUrl;
  $("share-wait").hidden = Boolean(inv.pageUrl);
  if (!inv.pageUrl) {
    $("share-wait-note").textContent = `${inv.number} hasn't been approved yet, so its page isn't open. Approving it here sends no email: it counts as sent, and you share its link yourself.`;
    return;
  }
  const text = shareMessage(inv);
  $("share-text").value = text;
  drawShareLinks();
  $("share-device").hidden = !navigator.share;
  $("share-monzo").hidden = !inv.monzoUrl;
}
function drawShareLinks() {
  const inv = chosen.staged.invoice;
  const text = $("share-text").value.trim();
  const e = encodeURIComponent;
  $("share-wa").href = `https://wa.me/?text=${e(text)}`;
  $("share-tg").href = `https://t.me/share/url?url=${e(inv.pageUrl)}&text=${e(text.replace(inv.pageUrl, "").trim())}`;
  $("share-sms").href = `sms:?&body=${e(text)}`;
  $("share-mail").href = `mailto:${e(inv.billTo.email || "")}?subject=${e(`Invoice ${inv.number} from Novacane Studios`)}&body=${e(text)}`;
}
$("share-text").addEventListener("input", drawShareLinks);
$("share-btn").addEventListener("click", () => {
  if (!chosen) return;
  drawShare();
  $("share").showModal();
});
$("share-close").addEventListener("click", () => $("share").close());
$("share-approve").addEventListener("click", async () => {
  const inv = chosen.staged.invoice;
  const btn = $("share-approve");
  if (!btn.dataset.armed) {
    btn.dataset.armed = "1";
    btn.textContent = `Yes, approve ${inv.number} (no email)`;
    setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = "Approve it to share (no email)";
    }, 5000);
    return;
  }
  delete btn.dataset.armed;
  btn.disabled = true;
  try {
    await api(`money/invoices/${inv.id}/approve`, { method: "POST", body: { byHand: true } });
    say(`${inv.number} approved to share. No email was sent.`);
    chosen.detail = null;
    await load();
    drawShare();
  } catch (err) {
    say(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Approve it to share (no email)";
  }
});
$("share-device").addEventListener("click", async () => {
  const inv = chosen.staged.invoice;
  try {
    await navigator.share({ title: `Invoice ${inv.number}`, text: $("share-text").value.trim().replace(inv.pageUrl, "").trim(), url: inv.pageUrl });
  } catch {}
});
async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    say(`${what} copied.`);
  } catch {
    say("Couldn't copy here: select it and copy it yourself.", true);
  }
}
$("share-copy").addEventListener("click", () => copyText($("share-text").value.trim(), "The message"));
$("share-link").addEventListener("click", () => copyText(chosen.staged.invoice.pageUrl, "The link"));
$("share-monzo").addEventListener("click", () => copyText(chosen.staged.invoice.monzoUrl, "The Monzo link"));

// ---- How clients pay: the bank details (Money's settings), added here by an admin ----
function drawBank() {
  const st = data?.settings || {};
  const bank = st.bank || {};
  const ways = [st.bankReady && "Bank transfer", st.monzoReady && "Monzo", data?.cardReady && "Card"].filter(Boolean);
  $("bank-state").textContent = ways.length ? `${ways.join(" and ")} ✓` : data?.canDecide ? "Add bank details" : "Not set up yet (an admin adds it)";
  $("bank-btn").classList.toggle("missing", !ways.length);
  $("bank-btn").disabled = !data?.canDecide;
  $("bank-btn").title = data?.canDecide ? "The invoice settings: bank details, Monzo, the studio's details, VAT and days to pay" : "An admin adds these";
}
$("bank-btn").addEventListener("click", () => {
  const b = data?.settings?.bank || {};
  $("b-name").value = b.accountName || "";
  $("b-sort").value = b.sortCode || "";
  $("b-acc").value = b.accountNumber || "";
  $("b-note").value = b.note || "";
  $("b-monzo").value = data?.settings?.monzo?.link || "";
  const st = data?.settings || {};
  const biz = st.business || {};
  $("s-name").value = biz.name || "";
  $("s-address").value = biz.address || "";
  $("s-email").value = biz.email || "";
  $("s-vatno").value = biz.vatNumber || "";
  $("s-vat").value = st.vatRate ?? "";
  $("s-days").value = st.dueDays ?? "";
  $("s-ready").textContent = `Emailing invoices: ${data?.emailReady ? "ready" : "not set up yet"}. Pay by card (Stripe): ${data?.cardReady ? "ready" : "not set up yet"}.`;
  $("b-error").hidden = true;
  $("bank").showModal();
  $("b-name").focus();
});
for (const id of ["bank-close", "bank-cancel"]) $(id).addEventListener("click", () => $("bank").close());
$("bank-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("bank-save").disabled = true;
  try {
    await api("money/settings", { method: "POST", body: { bank: { accountName: $("b-name").value.trim(), sortCode: $("b-sort").value.trim(), accountNumber: $("b-acc").value.replace(/\s/g, ""), note: $("b-note").value.trim() }, monzo: { link: $("b-monzo").value.trim() }, business: { name: $("s-name").value.trim(), address: $("s-address").value.trim(), email: $("s-email").value.trim(), vatNumber: $("s-vatno").value.trim() }, ...($("s-vat").value !== "" ? { vatRate: Number($("s-vat").value) } : {}), ...($("s-days").value !== "" ? { dueDays: Number($("s-days").value) } : {}) } });
    $("bank").close();
    say("Saved: they're on every invoice now.");
    await load();
    if (chosen) refreshDoc();
  } catch (err) {
    $("b-error").textContent = err.message;
    $("b-error").hidden = false;
  } finally {
    $("bank-save").disabled = false;
  }
});


// ---- Everything for invoices, here (19 Oct 2026) ----
// What Portal → Money did for invoices is here too: a payment recorded by hand, the history (payments,
// with Take back for an admin; reminders and receipts, approved or rejected; everything that happened),
// rejecting, and the studio's details. Anywhere else in Nova with an invoice opens the Invoicer, set up
// for that (its address: see "Set up from the address" below).
const EVENTS = { created: "Written", edited: "Changed", submitted: "Sent for approval", approved: "Approved", rejected: "Rejected", sent: "Emailed to the client", failed: "Didn't send", payment: "Payment", payment_removed: "Payment taken back", paid: "Paid in full", reminder: "Reminder", voided: "Removed", renumbered: "Renumbered" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "");

// Reject: why, optionally (an invoice or a reminder waiting for approval)
let whyAct = null;
function askWhy(title, note, act, done) {
  $("why-title").textContent = title;
  $("why-note").textContent = note;
  $("why-text").value = "";
  $("why-error").hidden = true;
  whyAct = { act, done };
  $("why").showModal();
  $("why-text").focus();
}
for (const id of ["why-close", "why-cancel"]) $(id).addEventListener("click", () => $("why").close());
$("why-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!whyAct) return;
  $("why-save").disabled = true;
  try {
    await whyAct.act($("why-text").value.trim() || undefined);
    $("why").close();
    say(whyAct.done);
    if (chosen) chosen.detail = null;
    await load();
    if ($("history").open) drawHistory();
  } catch (err) {
    $("why-error").textContent = err.message;
    $("why-error").hidden = false;
  } finally {
    $("why-save").disabled = false;
  }
});

// Record a payment (bank transfer, Monzo, cash…; card payments come in from Stripe by themselves)
function openPay() {
  if (!chosen) return chooseFirst();
  const inv = chosen.staged.invoice;
  if (!["sent", "part_paid"].includes(inv.status)) return say(inv.status === "paid" ? `${inv.number} is paid in full.` : `${inv.number} hasn't been sent yet: payments are recorded once it's out.`, true);
  $("pay-title").textContent = `Record a payment · ${inv.number}`;
  $("pay-note").textContent = `${inv.billTo.name}: ${pounds(inv.balancePence)} left to pay of ${pounds(inv.totalPence)}.`;
  $("p-amount").value = (inv.balancePence / 100).toFixed(2);
  $("p-on").value = ukToday();
  $("p-on").max = ukToday();
  $("p-how").replaceChildren(...(data?.methods || []).map((m) => el("option", { value: m.id, text: m.name })));
  $("p-text").value = "";
  $("p-error").hidden = true;
  $("pay").showModal();
  $("p-amount").focus();
}
$("pay-btn").addEventListener("click", openPay);
for (const id of ["pay-close", "pay-cancel"]) $(id).addEventListener("click", () => $("pay").close());
$("pay-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inv = chosen.staged.invoice;
  const amount = $("p-amount").value.trim();
  if (!(toPence(amount) > 0)) {
    $("p-error").textContent = "The amount in pounds, like 150.00.";
    $("p-error").hidden = false;
    return;
  }
  $("pay-save").disabled = true;
  try {
    await api(`money/invoices/${inv.id}/payments`, { method: "POST", body: { amount, paidOn: $("p-on").value, method: $("p-how").value, note: $("p-text").value.trim() || undefined } });
    $("pay").close();
    say(`Payment of ${pounds(toPence(amount))} recorded on ${inv.number}.`);
    chosen.detail = null;
    await load();
  } catch (err) {
    $("p-error").textContent = err.message;
    $("p-error").hidden = false;
  } finally {
    $("pay-save").disabled = false;
  }
});

// The history: its details, payments, reminders and receipts, and what happened
async function openHistory() {
  if (!chosen) return chooseFirst();
  if (!chosen.detail) {
    try {
      chosen.detail = await api(`money/invoices/${chosen.id}`);
    } catch (err) {
      return say(err.message, true);
    }
  }
  drawHistory();
  if (!$("history").open) $("history").showModal();
}
function drawHistory() {
  const d = chosen?.detail;
  if (!d) return;
  const inv = d.invoice;
  const admin = Boolean(data?.canDecide);
  $("history-title").textContent = `History · ${inv.number}`;
  const box = $("hist");
  const facts = el("dl");
  const fact = (k, v) => v && facts.append(el("dt", { text: k }), el("dd", { text: v }));
  fact("Billed to", inv.billTo.name);
  fact("Goes to", inv.billTo.email || "No email yet: add one with Edit to send it");
  fact("Total", pounds(inv.totalPence) + (inv.vatRate ? ` (incl. ${inv.vatRate}% VAT)` : ""));
  if (inv.paidPence) fact("Paid", pounds(inv.paidPence));
  if (["sent", "part_paid"].includes(inv.status)) fact("Left to pay", pounds(inv.balancePence));
  fact("Issued", dayText(inv.issueDate));
  fact(inv.overdue ? "Was due" : "Due", dayText(inv.dueDate));
  if (inv.sentAt) fact("Sent", when(inv.sentAt));
  if (inv.decidedByName) fact(inv.status === "rejected" ? "Rejected by" : "Approved by", inv.decidedByName);
  fact("Written", `${inv.createdBy === "agent" ? "by Agent" : "in Nova"} · ${when(inv.createdAt)}`);
  const parts = [facts];
  // Payments (an admin can take back one recorded by hand: two presses)
  parts.push(el("h3", { text: "Payments" }));
  if (!d.payments.length) parts.push(el("p", { class: "empty-note", text: "None yet." }));
  else
    parts.push(
      el(
        "ul",
        {},
        ...d.payments.map((p) => {
          const li = el("li", {}, el("span", { text: `${dayText(p.paidOn)} · ${pounds(p.amountPence)} · ${p.methodName}${p.note ? ` · ${p.note}` : ""}${p.removed ? " · taken back" : ""}` }));
          if (admin && !p.removed && p.method !== "stripe") {
            const b = el("button", { type: "button", class: "ghost", text: "Take back" });
            b.addEventListener("click", () => confirmThen(b, `Take back ${pounds(p.amountPence)}?`, () => api(`money/payments/${p.id}/remove`, { method: "POST", body: {} }), "Payment taken back."));
            li.append(el("div", { class: "acts" }, b));
          }
          return li;
        })
      )
    );
  // Reminders and receipts (an admin approves or rejects one that's waiting)
  parts.push(el("h3", { text: "Reminders and receipts" }));
  if (!d.reminders.length) parts.push(el("p", { class: "empty-note", text: "None yet." }));
  else
    parts.push(
      el(
        "ul",
        {},
        ...d.reminders.map((r) => {
          const what = r.kind === "receipt" ? "Receipt" : "Reminder";
          const li = el("li", {}, el("span", { text: `${what} · ${when(r.createdAt)} · ${r.status === "sent" ? `sent ${when(r.sentAt)}` : r.status === "pending_approval" ? "waiting for approval" : r.status}` }));
          if (r.body) li.append(el("p", { class: "body", text: r.body }));
          if (admin && r.status === "pending_approval") {
            const ok = el("button", { type: "button", class: "primary", text: "Approve and email it" });
            ok.addEventListener("click", () => doNow(ok, () => api(`money/reminders/${r.id}/approve`, { method: "POST", body: {} }), `${what} sent.`));
            const no = el("button", { type: "button", class: "ghost", text: "Reject" });
            no.addEventListener("click", () => askWhy(`Reject the ${what.toLowerCase()}`, `It isn't emailed. ${inv.number} stays as it is.`, () => api(`money/reminders/${r.id}/reject`, { method: "POST", body: {} }), `The ${what.toLowerCase()} was rejected: nothing was emailed.`));
            li.append(el("div", { class: "acts" }, ok, no));
          }
          return li;
        })
      )
    );
  // What happened
  parts.push(el("h3", { text: "What happened" }));
  parts.push(d.log.length ? el("ul", {}, ...d.log.slice(-20).reverse().map((e) => el("li", {}, el("span", { text: `${when(e.at)} · ${EVENTS[e.event] || e.event}${e.byName ? ` · ${e.byName}` : ""}${e.detail ? ` · ${e.detail}` : ""}` })))) : el("p", { class: "empty-note", text: "Nothing yet." }));
  box.replaceChildren(...parts);
}
$("history-btn").addEventListener("click", openHistory);
$("history-close").addEventListener("click", () => $("history").close());

// ---- Set up from the address ----
// Anywhere else in Nova with an invoice opens /invoicer/ with what it's for (shared/invoicer-link.js):
//   ?new=1 (&name= &email= &billing=deposit|full)   a new invoice, ready to fill in
//   ?invoice=<id> or ?number=NS-0022 (&stage=)      that invoice, at that stage
//     &do=pay | history | share | edit | pdf | email | send | test | reject | remove   and what to do with it
//                                                    (never done by itself: it opens the place to do it)
//   ?reminder=<id>                                  the reminder's invoice, with its history open
//   ?filter=deposit|balance|overdue|paid|waiting|removed  ?q=<words>   the list, narrowed
//   ?settings=1                                     the invoice settings (bank, Monzo, the studio's details)
async function fromAddress(ask) {
  const f = ask.get("filter");
  if (f && $("filters").querySelector(`[data-filter="${CSS.escape(f)}"]`)) $("filters").querySelector(`[data-filter="${CSS.escape(f)}"]`).click();
  if (ask.get("q")) {
    $("search").value = ask.get("q").slice(0, 80);
    drawList();
  }
  if (ask.get("settings")) {
    if (data?.canDecide) $("bank-btn").click();
    else say("An admin changes the invoice settings.", true);
    return true;
  }
  if (ask.get("new")) {
    $("new-btn").click();
    if (ask.get("name")) {
      $("n-name").value = ask.get("name").slice(0, 120);
      $("n-name").dispatchEvent(new Event("change"));
    }
    if (ask.get("email")) $("n-email").value = ask.get("email").slice(0, 200);
    if (ask.get("billing") === "full") setBilling("full");
    livePreview();
    return true;
  }
  let id = Number(ask.get("invoice")) || 0;
  if (!id && ask.get("number")) id = data?.invoices?.find((i) => i.number.toLowerCase() === ask.get("number").toLowerCase())?.id || 0;
  const reminder = Number(ask.get("reminder")) || 0;
  if (!id && reminder) id = data?.reminders?.find((r) => r.id === reminder)?.invoiceId || 0;
  if (!id) return false;
  const stage = STAGE_NAMES[ask.get("stage")] ? ask.get("stage") : null;
  await choose(id, stage);
  if (!chosen || chosen.id !== id) return true;
  const act = reminder ? "history" : ask.get("do");
  if (act === "pay") openPay();
  else if (act === "history") openHistory();
  else if (act === "share" && !$("share-btn").disabled) $("share-btn").click();
  else if (act === "edit" && !$("edit-btn").disabled) $("edit-btn").click();
  else if (act === "pdf") $("print-btn").click();
  else if (act === "email") $("email-btn").click();
  else if (act === "send" || act === "approve" || act === "remind") {
    showPart("mail");
    $("send-btn").focus();
    $("send-btn").scrollIntoView({ block: "center" });
  } else if (act === "reject" && !$("reject-btn").hidden) {
    showPart("mail");
    $("reject-btn").click();
  } else if (act === "test" && !$("test-btn").hidden) {
    showPart("mail");
    $("test-btn").focus();
    $("test-btn").scrollIntoView({ block: "center" });
  } else if (act === "remove" && !$("remove-btn").hidden) {
    showPart("doc");
    $("remove-btn").focus();
  } else showPart("doc");
  return true;
}

// ---- Start ----
(async () => {
  await load(false);
  try {
    catalogue = await api("money/catalogue");
    fillCatalogue();
    themes = catalogue.themes || [];
    studioTheme = catalogue.theme || "night";
    studioMode = catalogue.mode || "bright";
    papers = catalogue.papers || [];
    studioPaper = catalogue.paper || "moonstone";
    if (paper && !papers.some((x) => x.id === paper)) paper = null;
    if (mode && !(catalogue.modes || ["bright", "dark"]).includes(mode)) mode = null;
    if (theme && !themes.some((t) => t.id === theme)) theme = null;
    drawThemes();
  } catch {}
  try {
    const c = await api("clients?filter=all");
    clients = (c.clients || []).filter((x) => x.name);
    $("clients").replaceChildren(...clients.slice(0, 300).map((x) => el("option", { value: x.name })));
  } catch {}
  // Opened for something (a new invoice, one invoice, a payment…: see fromAddress), else the newest
  if (await fromAddress(new URLSearchParams(location.search))) return;
  const first = data?.invoices?.find((i) => i.status !== "void")?.id;
  if (first) await choose(first);
})();
