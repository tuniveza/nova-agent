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
let theme = null; // the one shown here (this browser remembers it)
let studioMode = "bright"; // every invoice's page: bright (white) or dark (the website's near-black)
let mode = null; // the one shown here
try {
  theme = localStorage.getItem("invoicer-theme");
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
  if (inv.paidPence > 0) return "balance";
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
  if (keep && chosen) await choose(chosen.id, chosen.stage, true);
}

function drawList() {
  const list = $("list");
  const q = $("search").value.trim().toLowerCase();
  const today = ukToday();
  const rows = (data?.invoices || []).filter((inv) => inv.status !== "void").filter((inv) => {
    const waiting = WAITING.includes(inv.status);
    if (filter === "waiting" && !waiting) return false;
    if (["deposit", "balance", "overdue", "paid"].includes(filter) && (waiting || stageOf(inv, today) !== filter)) return false;
    return !q || inv.number.toLowerCase().includes(q) || inv.billTo.name.toLowerCase().includes(q);
  });
  list.replaceChildren();
  if (!rows.length) {
    list.append(el("li", { class: "empty", text: data?.invoices?.length ? "None like that." : "No invoices yet: make the first with + New invoice." }));
    return;
  }
  for (const inv of rows) {
    const waiting = WAITING.includes(inv.status);
    const stage = stageOf(inv, today);
    const chip = waiting ? el("span", { class: "tag waiting", text: inv.status === "rejected" ? "Rejected" : inv.status === "failed" ? "Didn't send" : "To approve" }) : el("span", { class: `tag s-${stage}`, text: STAGE_NAMES[stage] });
    const btn = el(
      "button",
      { type: "button", class: "inv", "aria-current": chosen && chosen.id === inv.id ? "true" : "false", "data-id": inv.id },
      el("span", { class: "who" }, el("b", { text: inv.billTo.name }), el("small", { text: `${inv.number} · ${dayText(inv.issueDate)}` })),
      el("span", { class: "amt" }, el("b", { text: pounds(inv.totalPence) }), chip)
    );
    btn.addEventListener("click", () => {
      choose(inv.id);
      showPart("doc");
    });
    list.append(el("li", {}, btn));
  }
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
  // (a new invoice: its own note in the Notes box)
  if (first) $("note").value = inv.notes || "";
  const src = docSrc();
  const frame = $("doc");
  if (frame.getAttribute("src") !== src) frame.src = src;
  frame.hidden = false;
  $("doc-empty").hidden = true;
  $("print-btn").disabled = false;
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
  btn.hidden = false;
  btn.disabled = false;
  chip.hidden = true;
  btn.onclick = null;
  if (WAITING.includes(inv.status)) {
    chip.hidden = false;
    chip.textContent = "Not sent yet";
    if (admin) {
      btn.textContent = "Approve and email it";
      note.textContent = `Emails ${inv.billTo.email || "(no email address)"} the invoice itself (the Nova invoice, with a text version for email apps that can't show it) and a button to its page, where they can pay. Your Approve is the check: nothing goes without it.`;
      btn.onclick = () => confirmThen(btn, `Yes, email ${inv.number} to ${inv.billTo.email || "them"}`, () => api(`money/invoices/${inv.id}/approve`, { method: "POST", body: {} }), "Approved: it's on its way.");
    } else {
      btn.textContent = "Waiting for an admin";
      btn.disabled = true;
      note.textContent = "An admin approves it in Portal → Money (or here), then it's emailed. Until then you can copy the email and the PDF.";
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
      btn.onclick = () => confirmThen(btn, `Yes, email it to ${inv.billTo.email}`, () => api(`money/reminders/${waiting.id}/approve`, { method: "POST", body: {} }), receipt ? "Receipt sent." : "Reminder sent.");
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
    confirmThen(btn, "Yes, queue it", () => api(`money/invoices/${inv.id}/reminder`, { method: "POST", body: { body: forMoney($("body").value), kind } }), admin ? "Queued: approve it with the button above." : "Queued: an admin approves it before it goes.");
}
// Money's email adds the button to the invoice's page and a sign-off itself
// (the invoice under the message has the link, the bank details and the studio's sign-off, so those
// lines are left out of what's queued)
function forMoney(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !/^(See and pay it online:|Or by bank transfer)/.test(l))
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
    say(r.message || "Test sent: check your inbox.");
  } catch (err) {
    say(err.message, true);
  } finally {
    b.disabled = false;
  }
});
// The email as the client will get it, in its own tab
$("email-btn").addEventListener("click", () => {
  if (!chosen) return;
  const q = new URLSearchParams({ stage: chosen.staged.stage, body: forMoney($("body").value) });
  window.open(`/app/api/money/invoices/${chosen.id}/email?${q}`, "_blank", "noopener");
});
// One press asks, the second does it (it goes back after a few seconds)
function confirmThen(btn, ask, act, done) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    btn.disabled = true;
    act()
      .then(async () => {
        say(done);
        chosen.detail = null;
        await load();
      })
      .catch((err) => say(err.message, true))
      .finally(() => (btn.disabled = false));
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
      b.append(sw, t.name, t.id === studioTheme ? el("span", { class: "star", "aria-label": "(every invoice)", text: "★" }) : "");
      b.addEventListener("click", () => {
        theme = t.id;
        try {
          localStorage.setItem("invoicer-theme", t.id);
        } catch {}
        drawThemes();
        refreshDoc();
      });
      return b;
    })
  );
  for (const b of $("modes").querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.mode === (mode || studioMode)));
  // An admin can make the one shown every invoice's look
  $("theme-save").hidden = !(data?.canDecide && ((theme && theme !== studioTheme) || (mode && mode !== studioMode)));
}
$("modes").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-mode]");
  if (!b) return;
  mode = b.dataset.mode;
  try {
    localStorage.setItem("invoicer-mode", mode);
  } catch {}
  drawThemes();
  refreshDoc();
});
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
});
$("theme-save").addEventListener("click", async () => {
  try {
    const r = await api("money/settings", { method: "POST", body: { invoiceTheme: theme || studioTheme, invoiceMode: mode || studioMode } });
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
$("print-btn").addEventListener("click", () => {
  try {
    $("doc").contentWindow.focus();
    $("doc").contentWindow.print();
  } catch {
    window.open($("open-btn").href, "_blank", "noopener");
  }
});
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
  document.body.dataset.part = part;
  for (const b of $("parts").querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.part === part));
}
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
function draft() {
  return {
    billName: $("n-name").value.trim(),
    billEmail: $("n-email").value.trim(),
    lines: lines.map((l) => ({ description: l.description.trim(), qty: Number(l.qty) || 1, unit: String(l.unit) })),
    issueDate: $("n-issue").value,
    dueDate: $("n-due").value,
    notes: $("n-notes").value.trim(),
    stage: "deposit",
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
      $("np-state").textContent = `Deposit due · ${themes.find((t) => t.id === (theme || studioTheme))?.name || ""} · ${(mode || studioMode) === "dark" ? "Dark" : "Bright"}`;
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
$("new-btn").addEventListener("click", async () => {
  lines = [];
  $("new-form").reset();
  $("n-error").hidden = true;
  $("n-issue").value = ukToday();
  $("n-due").value = addDays(ukToday(), 14);
  $("new").showModal();
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
  };
  if (client) body.clientId = client.id;
  $("n-save").disabled = true;
  try {
    const made = await api("money/invoices", { method: "POST", body });
    closeNew();
    say(`${made.invoice.number} is made. It waits for an admin's Approve before it's emailed.`);
    await load(false);
    await choose(made.invoice.id);
    showPart("doc");
  } catch (e2) {
    problem(e2.message);
  } finally {
    $("n-save").disabled = false;
  }
});

// ---- Start ----
(async () => {
  await load(false);
  try {
    catalogue = await api("money/catalogue");
    fillCatalogue();
    themes = catalogue.themes || [];
    studioTheme = catalogue.theme || "night";
    studioMode = catalogue.mode || "bright";
    if (mode && !(catalogue.modes || ["bright", "dark"]).includes(mode)) mode = null;
    if (theme && !themes.some((t) => t.id === theme)) theme = null;
    drawThemes();
  } catch {}
  try {
    const c = await api("clients?filter=all");
    clients = (c.clients || []).filter((x) => x.name);
    $("clients").replaceChildren(...clients.slice(0, 300).map((x) => el("option", { value: x.name })));
  } catch {}
  // ?invoice=12 opens that one
  const want = Number(new URLSearchParams(location.search).get("invoice"));
  const first = want || data?.invoices?.find((i) => i.status !== "void")?.id;
  if (first) await choose(first);
})();
