// The phone preview's made-up Money (no real clients): every address Nova Phone's Money (web/phone/money.js) calls,
// answered from here and kept in memory, so every button does its thing in the preview: approving, rejecting,
// reminders and receipts, payments and taking them back, the look, notes, sharing, renumbering, the settings. The
// invoice itself, its email, its PDF and the spreadsheets are made-up stand-ins (the real ones come from Nova Bot).
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const today = day(0);
  const SITE = "https://novacane.example";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pounds = (p) => `${p < 0 ? "−" : ""}£${(Math.abs(Math.round(p)) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const long = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");

  const THEMES = [["ruby", "Ruby", "#110608", "#B62B3D"], ["amber", "Amber", "#110B06", "#A55E27"], ["gold", "Gold", "#110E06", "#886C20"], ["jade", "Jade", "#06110B", "#1E804F"], ["teal", "Teal", "#061011", "#1F7D84"], ["sapphire", "Sapphire", "#060911", "#2B54B6"], ["violet", "Violet", "#0C0611", "#752BB6"], ["night", "Night", "#11060D", "#B62B83"], ["paper", "Paper", "#F4F1EF", "#A52B88"], ["mono", "Black & white", "#111111", "#1C1618"]].map(([id, name, band, accent]) => ({ id, name, band, accent }));
  const PAPERS = [["moonstone", "Moonstone"], ["pearl", "Pearl"], ["marble", "Marble"], ["sapphire", "Sapphire"], ["ruby", "Ruby"], ["emerald", "Emerald"], ["amethyst", "Amethyst"], ["rosequartz", "Rose quartz"], ["citrine", "Citrine"], ["onyx", "Onyx"]].map(([id, name]) => ({ id, name }));
  const SERVICES = [
    { id: "s-vocal", group: "Recording", name: "Vocal session (per hour)", pricePence: 4000 }, { id: "s-day", group: "Recording", name: "Full studio day", pricePence: 28000 }, { id: "s-podcast", group: "Recording", name: "Podcast recording (2 hours)", pricePence: 9000 },
    { id: "mix", group: "Mixing", name: "Mixing, per song", pricePence: 15000 }, { id: "master-1", group: "Mastering", name: "Mastering, per song (1 or 2 songs)", pricePence: 5000 },
    { id: "master-3", group: "Mastering", name: "Mastering, per song (3 to 10 songs)", pricePence: 3000, note: "For orders of 3 to 10 songs" }, { id: "production", group: "Production", name: "Custom music production, per song", pricePence: 25000, from: true, note: "From £250: type the agreed price" },
  ];
  const settings = { vatRate: 0, dueDays: 14, business: { name: "Novacane Studios", address: "1 Example Yard\nLondon", email: "hello@example.com", phone: "", website: "novacane.example", vatNumber: "" }, bank: { accountName: "Novacane Studios", sortCode: "12-34-56", accountNumber: "12345678", note: "" }, monzo: { link: "monzo.me/example" }, invoiceTheme: "night", invoiceMode: "bright", invoicePaper: "moonstone" };
  const line = (description, qty, unitPence) => ({ description, qty, unitPence, totalPence: qty * unitPence });
  let seq = 36;
  const inv = (id, o) => ({ id, number: `NS-${pad(0)}${String(id).padStart(2, "0")}`, billTo: { name: "", email: null, address: "" }, billing: "deposit", lines: [], vatRate: 0, notes: "", look: null, status: "sent", createdBy: "s1", createdAt: iso(60 * 24 * 10), sentAt: null, decidedByName: null, error: null, token: `t${id}`, ...o });
  const invoices = [
    inv(36, { billTo: { name: "Maya Rose", email: "maya@example.com" }, lines: [line("Full studio day", 1, 28000), line("Mastering, per song (1 or 2 songs)", 2, 5000)], issueDate: day(0), dueDate: day(14), status: "pending_approval", createdBy: "agent", createdAt: iso(40), notes: "Session on the 14th, 10am" }),
    inv(35, { billTo: { name: "Riverside Choir", email: null }, billing: "full", lines: [line("Podcast recording (2 hours)", 2, 9000)], issueDate: day(-1), dueDate: day(13), status: "pending_approval", createdAt: iso(60 * 20) }),
    inv(32, { billTo: { name: "Night Drive", email: "nd@example.com" }, billing: "full", lines: [line("Mixing, per song", 4, 15000)], issueDate: day(-3), dueDate: day(11), status: "sent", sentAt: iso(60 * 70), decidedByName: "Jordan Lee" }),
    inv(31, { billTo: { name: "Kai Bennett", email: "kai@example.com" }, lines: [line("Vocal session (per hour)", 3, 4000)], issueDate: day(-20), dueDate: day(-2), status: "sent", sentAt: iso(60 * 24 * 20), decidedByName: "Jordan Lee" }),
    inv(30, { billTo: { name: "The Lanterns", email: "band@example.com" }, billing: "full", lines: [line("Rehearsal room, 3 hours", 3, 2500)], issueDate: day(-30), dueDate: day(-16), status: "paid", sentAt: iso(60 * 24 * 30), decidedByName: "Jordan Lee" }),
    inv(29, { billTo: { name: "Lowlands", email: "lowlands@example.com" }, lines: [line("Mixing, per song", 2, 15000)], issueDate: day(-9), dueDate: day(5), status: "part_paid", sentAt: iso(60 * 24 * 9), decidedByName: "Jordan Lee", look: { theme: "sapphire", mode: "dark", paper: "pearl" } }),
    inv(28, { billTo: { name: "Echo Park", email: "echo@example.com" }, lines: [line("Custom music production, per song", 1, 30000)], issueDate: day(-6), dueDate: day(8), status: "rejected", decidedByName: "Jordan Lee", note: "The price isn't agreed yet" }),
    inv(27, { billTo: { name: "Sam Test", email: "sam@example.com" }, lines: [line("Vocal session (per hour)", 1, 4000)], issueDate: day(-12), dueDate: day(2), status: "void" }),
    inv(26, { billTo: { name: "Ivy Lane", email: "ivy@example.com" }, billing: "full", lines: [line("Mastering, per song (3 to 10 songs)", 5, 3000)], issueDate: day(-40), dueDate: day(-26), status: "paid", sentAt: iso(60 * 24 * 40), decidedByName: "Sam Okoro" }),
  ];
  let nextPay = 10, nextRem = 20, nextLog = 100;
  const payments = [
    { id: 1, invoiceId: 30, amountPence: 7500, paidOn: day(-18), method: "bank", methodName: "Bank transfer", byName: "Jordan Lee", note: "", removed: false },
    { id: 2, invoiceId: 29, amountPence: 10000, paidOn: day(-4), method: "monzo", methodName: "Monzo", byName: "Sam Okoro", note: "Deposit", removed: false },
    { id: 3, invoiceId: 26, amountPence: 15000, paidOn: day(-30), method: "stripe", methodName: "Card", byName: null, note: "", removed: false },
  ];
  const reminders = [
    { id: 7, invoiceId: 31, kind: "reminder", status: "pending_approval", body: "Hi Kai,\n\nJust a friendly reminder that the deposit on invoice NS-0031 is now two days late. Could you pay it this week?\n\nThanks!", createdBy: "s2", createdAt: iso(90) },
    { id: 8, invoiceId: 30, kind: "receipt", status: "pending_approval", body: "Hi,\n\nThank you: invoice NS-0030 is paid in full. Your receipt is below.", createdBy: "system", createdAt: iso(60 * 24 * 18) },
    { id: 6, invoiceId: 26, kind: "receipt", status: "sent", body: "Thank you: NS-0026 is paid in full.", createdBy: "system", createdAt: iso(60 * 24 * 30), sentAt: iso(60 * 24 * 30 - 5), decidedByName: "Sam Okoro" },
  ];
  const logs = [];
  const log = (invoiceId, event, detail = null, byName = "Jordan Lee") => logs.push({ id: nextLog++, invoiceId, at: new Date().toISOString(), event, byName, detail });
  for (const i of invoices) {
    logs.push({ id: nextLog++, invoiceId: i.id, at: i.createdAt, event: "created", byName: i.createdBy === "agent" ? null : "Jordan Lee", detail: i.createdBy === "agent" ? "Written by Nova Agent in the Agent" : null });
    if (i.sentAt) logs.push({ id: nextLog++, invoiceId: i.id, at: i.sentAt, event: "sent", byName: i.decidedByName, detail: `To ${i.billTo.email}` });
  }
  const expenses = [{ id: 3, spentOn: day(-2), amountPence: 4999, category: "Software and subscriptions", supplier: "Plugin Boutique", note: "Vocal plugin", status: "confirmed", receiptId: null }, { id: 2, spentOn: day(-9), amountPence: 12900, category: "Equipment", supplier: "Thomann", note: "XLR cables", status: "confirmed" }, { id: 4, spentOn: day(-1), amountPence: 1250, category: "Food and hospitality", supplier: "Café", note: "Noted by Nova Agent", status: "unconfirmed" }];
  let nextExp = 10;

  // ---- The invoice, as Nova Bot shapes it ----
  const STAGES = ["deposit", "balance", "overdue", "paid"];
  const total = (i) => i.lines.reduce((t, l) => t + l.totalPence, 0) * (1 + (i.vatRate || 0) / 100);
  const paid = (i) => payments.filter((p) => p.invoiceId === i.id && !p.removed).reduce((t, p) => t + p.amountPence, 0);
  const sentish = (i) => ["sent", "part_paid", "paid", "void"].includes(i.status);
  function pub(i) {
    const t = Math.round(total(i)), p = paid(i);
    const sub = i.lines.reduce((s, l) => s + l.totalPence, 0);
    const out = { ...i, lines: i.lines.map((l) => ({ ...l })), subtotalPence: sub, vatPence: t - sub, totalPence: t, paidPence: p, balancePence: Math.max(0, t - p), overdue: ["sent", "part_paid"].includes(i.status) && i.dueDate < today, pageUrl: sentish(i) ? `${SITE}/invoice/${i.token}` : null, portalUrl: `${SITE}/invoicer/?invoice=${i.id}` };
    const due = sums(out, auto(out)).dueNowPence;
    if (settings.monzo.link && due > 0 && i.status !== "void") out.monzoUrl = `https://${settings.monzo.link.replace(/^https?:\/\//, "")}/${(due / 100).toFixed(2)}?d=${out.number}`;
    delete out.token;
    return out;
  }
  const auto = (i) => (i.paidPence >= i.totalPence || i.status === "paid" ? "paid" : ["sent", "part_paid"].includes(i.status) && i.dueDate < today ? "overdue" : i.paidPence > 0 || i.billing === "full" ? "balance" : "deposit");
  function sums(i, stage) {
    const deposit = Math.round(i.totalPence / 2);
    const base = { totalPence: i.totalPence, paidPence: i.paidPence, depositPercent: 50, depositPence: deposit };
    if (stage === "deposit") return { ...base, dueNowPence: Math.max(0, deposit - i.paidPence), dueBy: i.issueDate, laterPence: i.totalPence - Math.max(deposit, i.paidPence), laterBy: i.dueDate };
    if (stage === "paid") return { ...base, dueNowPence: 0, dueBy: null };
    return { ...base, dueNowPence: Math.max(0, i.totalPence - i.paidPence), dueBy: i.dueDate };
  }
  function email(i, s, stage) {
    const first = String(i.billTo.name || "").split(/\s+/)[0] || "there";
    const subject = { deposit: `Your deposit for ${i.number}: ${pounds(s.dueNowPence)} secures your date`, balance: `Invoice ${i.number}: ${pounds(s.dueNowPence)} due ${long(i.dueDate)}`, overdue: `A reminder: ${i.number} is past its due date`, paid: `Your receipt for ${i.number}: paid in full, thank you` }[stage];
    const words = { deposit: [`Here's your invoice ${i.number} from Novacane Studios. A ${pounds(s.dueNowPence)} deposit secures your date; the rest is due on the session day.`], balance: [`Here's your invoice ${i.number} for ${pounds(s.dueNowPence)}, due ${long(i.dueDate)}.`], overdue: [`Just a friendly reminder that ${i.number} was due ${long(i.dueDate)}, with ${pounds(s.dueNowPence)} still to pay.`], paid: [`Thank you: ${i.number} is paid in full. Your receipt is attached below.`] }[stage];
    const pay = stage === "paid" ? [] : [`See and pay it online: ${SITE}/invoice/…`, ...(settings.monzo.link ? [`Or pay with Monzo: https://${settings.monzo.link}`] : []), `Or by bank transfer to ${settings.bank.accountName}, ${settings.bank.sortCode}, ${settings.bank.accountNumber}`];
    return { subject, body: [`Hi ${first},`, ...words, pay.join("\n"), "Any questions, just reply to this email.", "Best wishes,\nThe Novacane Studios team"].filter(Boolean).join("\n\n") };
  }
  const look = (i, q) => { const t = THEMES.find((x) => x.id === (q.get("theme") || i?.look?.theme || settings.invoiceTheme)) || THEMES[7]; return { t, dark: (q.get("mode") || i?.look?.mode || settings.invoiceMode) === "dark", paper: q.get("paper") || i?.look?.paper || settings.invoicePaper }; };
  // A stand-in for the invoice's page (Nova Bot draws the real one): the same parts, in its look
  function docHtml(i, stage, q, { pay = true, preview = false } = {}) {
    const L = look(i, q), s = sums(i, stage);
    const note = q.get("note") ?? i.notes ?? "";
    const line = { deposit: `Deposit due: ${pounds(s.dueNowPence)} secures your date`, balance: `Balance due by ${long(i.dueDate)}`, overdue: `Overdue: due ${long(i.dueDate)}`, paid: "Paid in full: thank you" }[stage];
    const paper = L.dark ? "#141015" : "#FFFFFF", ink = L.dark ? "#E9E2E3" : "#2A2326";
    return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(i.number)}</title><style>
*{box-sizing:border-box}html{background:${L.dark ? "#07050a" : "#efe9ee"}}body{margin:0;padding:28px 12px;font:300 15px/1.6 Futura,"Century Gothic","Avenir Next",system-ui,sans-serif;color:${ink}}
.sheet{max-width:820px;margin:0 auto;background:${paper};box-shadow:0 18px 50px rgb(0 0 0 / .2)}
.band{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 28px;background:${L.t.band};color:${L.t.id === "paper" ? "#1C1618" : "#fff"};border-bottom:3px solid ${L.t.accent}}
.band b{letter-spacing:.3em;font-weight:500}.band small{display:block;letter-spacing:.4em;font-size:10px;opacity:.8}.in{padding:24px 28px 30px}
.stage{color:${L.t.accent};margin:0 0 18px}.to{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:14px}
table{width:100%;border-collapse:collapse;margin:18px 0;font-size:14px}td,th{padding:8px 4px;border-bottom:1px solid rgb(128 128 128 / .2);text-align:left}.n{text-align:right;white-space:nowrap}
.sums{margin-left:auto;max-width:300px}.r{display:flex;justify-content:space-between;padding:4px 0}.r.big{font-weight:600;border-top:1px solid ${L.t.accent};margin-top:6px;padding-top:8px}
.note{margin-top:22px;padding:12px 14px;border-left:3px solid ${L.t.accent};white-space:pre-wrap}.paper{font-size:11px;opacity:.6;margin-top:18px}
.pay{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.pay a{flex:1 1 180px;text-align:center;padding:12px;border-radius:10px;color:#fff;text-decoration:none;font-weight:500;background:${L.t.accent}}.pay a.mz{background:#14233C}
.said{display:none;margin-top:10px;font-size:13px}.said:target{display:block}.cancel{color:#A3233A}
@media (max-width:640px){.band{padding:18px}.in{padding:18px}.pay a{flex-basis:100%}}
</style></head><body><main class="sheet"><div class="band"><div><b>NOVACANE</b><small>STUDIOS</small></div><span>${stage === "paid" ? "RECEIPT" : "INVOICE"}</span></div><div class="in">
<p class="stage">${i.status === "void" ? '<span class="cancel">This invoice was cancelled: there\'s nothing to pay</span>' : esc(line)}</p>
<div class="to"><div><small>Billed to</small><br><b>${esc(i.billTo.name || "Artist name")}</b>${i.billTo.email ? `<br>${esc(i.billTo.email)}` : ""}</div><div>${esc(i.number)}<br>Issued ${esc(long(i.issueDate))}<br>Due ${esc(long(i.dueDate))}</div></div>
<table><tr><th>What</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr>${i.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${esc(l.qty)}</td><td class="n">${pounds(l.unitPence)}</td><td class="n">${pounds(l.totalPence)}</td></tr>`).join("")}</table>
<div class="sums"><div class="r"><span>Total</span><b>${pounds(i.totalPence)}</b></div>${payments.filter((p) => p.invoiceId === i.id && !p.removed).map((p) => `<div class="r"><span>Paid ${esc(long(p.paidOn))}</span><span>${pounds(-p.amountPence)}</span></div>`).join("")}<div class="r big"><span>${stage === "paid" ? "Left to pay" : "Due now"}</span><b>${pounds(s.dueNowPence)}</b></div></div>
${pay && stage !== "paid" && i.status !== "void" && s.dueNowPence > 0 ? `<div class="pay"><a href="#card-said">Pay ${pounds(s.dueNowPence)} by card</a>${settings.monzo.link ? `<a class="mz" href="#monzo-said">Pay with Monzo</a>` : ""}</div><p class="said" id="card-said">In Nova this opens Stripe's checkout for ${pounds(s.dueNowPence)} in a new tab (this is the preview, so no card page opens).</p><p class="said" id="monzo-said">In Nova this opens Monzo with ${pounds(s.dueNowPence)} and ${esc(i.number)} filled in (the preview's Monzo link is made up).</p>` : ""}
<div class="note">${esc(String(note).trim() || "Thank you for working with Novacane Studios.")}</div><p class="paper">${esc(PAPERS.find((p) => p.id === L.paper)?.name || L.paper)} paper · ${L.dark ? "Dark" : "Bright"} · ${esc(L.t.name)}${preview ? " · a sample in the preview" : " · a stand-in drawn by the preview (Nova Bot draws the real one)"}</p>
</div></main></body></html>`;
  }
  function mailHtml(i, stage, body) {
    const L = look(i, new URLSearchParams());
    const paras = String(body || email(i, sums(i, stage), stage).body).split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px;background:#f3f0f2;font:15px/1.6 system-ui,sans-serif;color:#2A2326}.m{max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden}.h{padding:16px 20px;background:${L.t.band};color:#fff;letter-spacing:.3em}.b{padding:8px 20px 20px}.btn{display:inline-block;margin:6px 0 14px;padding:12px 18px;border-radius:8px;background:${L.t.accent};color:#fff;text-decoration:none}.f{padding:0 20px 18px;font-size:12px;color:#777}</style></head><body><div class="m"><div class="h">NOVACANE STUDIOS</div><div class="b">${paras}<a class="btn" href="#">See and pay ${esc(i.number)} online</a><p>Best wishes,<br>The Novacane Studios team</p></div><div class="f">The invoice itself comes under this message, as the client gets it. (A stand-in drawn by the preview.)</div></div></body></html>`;
  }
  const PDF = (title) => { const t = String(title).replace(/[()\\]/g, ""); const stream = `BT /F1 22 Tf 60 760 Td (${t}) Tj 0 -34 Td /F1 12 Tf (A sample PDF from the Nova Phone preview: Nova Bot draws the real one.) Tj ET`; return `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`; };
  const byId = (id) => invoices.find((x) => String(x.id) === String(id));
  const stageAsked = (i, q) => (STAGES.includes(q.get("stage")) ? q.get("stage") : auto(pub(i)));

  // ---- The documents (iframes, links, the PDF): stand-ins, since the preview has no Nova Bot ----
  const realFetch = window.fetch;
  window.fetch = async (input, opts = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url, location.href);
    const pdf = u.pathname.match(/^\/app\/api\/money\/invoices\/(\d+|preview)\/pdf$/);
    if (pdf) {
      await new Promise((r) => setTimeout(r, 300));
      const i = pdf[1] === "preview" ? null : byId(pdf[1]);
      return new Response(new Blob([PDF(i ? `Novacane Studios ${i.number}` : "Novacane Studios draft")], { type: "application/pdf" }), { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    return realFetch(input, opts);
  };
  if (!window.NovaMoneyRealFrames) {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src");
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true, enumerable: true, get() { return desc.get.call(this); },
      set(v) {
        const u = new URL(String(v), location.href);
        const m = u.pathname.match(/^\/app\/api\/money\/invoices\/(\d+)\/(document|email)$/);
        const i = m && byId(m[1]);
        if (!i) return desc.set.call(this, v);
        const p = pub(i);
        this.srcdoc = m[2] === "document" ? docHtml(p, stageAsked(i, u.searchParams), u.searchParams) : mailHtml(p, stageAsked(i, u.searchParams), u.searchParams.get("body"));
      },
    });
    // (a link to one opens the stand-in: the invoice on its own page, its PDF, the accountant's spreadsheets)
    document.addEventListener("click", async (e) => {
      const a = e.target.closest && e.target.closest('a[href^="/app/api/money/"]');
      if (!a) return;
      e.preventDefault();
      const u = new URL(a.getAttribute("href"), location.href);
      const doc = u.pathname.match(/^\/app\/api\/money\/invoices\/(\d+)\/(document|pdf)$/);
      const save = (blob, name) => { const url = URL.createObjectURL(blob); const x = Object.assign(document.createElement("a"), { href: url, download: name }); document.body.append(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
      if (doc && doc[2] === "document") { const i = byId(doc[1]); const w = window.open(URL.createObjectURL(new Blob([docHtml(pub(i), stageAsked(i, u.searchParams), u.searchParams)], { type: "text/html" })), "_blank"); if (!w) window.NovaPhone?.toast("The preview couldn't open a new tab here."); return; }
      if (doc && doc[2] === "pdf") { const i = byId(doc[1]); save(new Blob([PDF(`Novacane Studios ${i.number}`)], { type: "application/pdf" }), `Novacane Studios ${i.number}.pdf`); window.NovaPhone?.toast(`Novacane Studios ${i.number}.pdf downloaded (a sample)`); return; }
      if (u.pathname === "/app/api/money/export.csv") { const what = u.searchParams.get("what"); const rows = what === "payments" ? payments.map((p) => [p.paidOn, byId(p.invoiceId)?.number, p.amountPence / 100, p.methodName]) : what === "expenses" ? expenses.map((x) => [x.spentOn, x.category, x.supplier, x.amountPence / 100]) : invoices.map((i) => [i.number, i.billTo.name, i.issueDate, pub(i).totalPence / 100, i.status]); save(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }), `${what}-sample.csv`); window.NovaPhone?.toast("A sample spreadsheet downloaded"); }
    }, true);
  }

  // ---- The answers ----
  function summary() {
    const open = invoices.map(pub).filter((i) => ["sent", "part_paid"].includes(i.status));
    const over = open.filter((i) => i.overdue);
    const month = today.slice(0, 7);
    return { owed: { count: open.length, pence: open.reduce((t, i) => t + i.balancePence, 0) }, overdue: { count: over.length, pence: over.reduce((t, i) => t + i.balancePence, 0) }, month: { inPence: payments.filter((p) => !p.removed && p.paidOn.startsWith(month)).reduce((t, p) => t + p.amountPence, 0), outPence: expenses.filter((x) => x.spentOn.startsWith(month)).reduce((t, x) => t + x.amountPence, 0) }, waitingApproval: invoices.filter((i) => ["draft", "pending_approval"].includes(i.status)).length + reminders.filter((r) => r.status === "pending_approval").length, taxYear: { name: "2026–27", from: "2026-04-06", to: "2027-04-05", inPence: 1284000, outPence: 312500, outByCategory: [{ category: "Equipment", pence: 189000 }, { category: "Software and subscriptions", pence: 64500 }, { category: "Marketing and ads", pence: 41000 }, { category: "Travel", pence: 18000 }] } };
  }
  const settingsOut = () => ({ business: settings.business, bank: settings.bank, monzo: settings.monzo, vatRate: settings.vatRate, dueDays: settings.dueDays, bankReady: Boolean(settings.bank.accountName && settings.bank.sortCode && settings.bank.accountNumber), monzoReady: Boolean(settings.monzo.link) });
  const fail = (status, error) => ({ status, body: { error } });
  const setPaid = (i) => {
    const p = pub(i);
    if (p.paidPence >= p.totalPence && i.status !== "paid") { i.status = "paid"; log(i.id, "paid", null, null); reminders.push({ id: nextRem++, invoiceId: i.id, kind: "receipt", status: "pending_approval", body: `Hi ${String(i.billTo.name).split(" ")[0]},\n\nThank you: ${p.number} is paid in full. Your receipt is below.`, createdBy: "system", createdAt: new Date().toISOString() }); }
    else if (p.paidPence < p.totalPence && ["paid", "part_paid", "sent"].includes(i.status)) i.status = p.paidPence > 0 ? "part_paid" : "sent";
  };
  const linesFrom = (raw) => (raw || []).map((l) => { const unit = Math.round(Number(String(l.unit).replace(/[£,\s]/g, "")) * 100) || 0; const qty = Number(l.qty) || 1; return line(String(l.description || "Something else").slice(0, 200), qty, unit); });
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/app/api/google/sheet" && method === "POST") return { url: "https://docs.google.com/spreadsheets/" };
    if (!p.startsWith("/app/api/money")) return undefined;
    const q = u.searchParams;
    body = body || {};
    if (method === "GET") {
      if (p === "/app/api/money") return { summary: summary(), invoices: invoices.map(pub).sort((a, b) => b.id - a.id), expenses, reminders: reminders.filter((r) => r.status === "pending_approval" || r.status === "failed" || (r.sentAt || r.createdAt) > iso(60 * 24 * 30)), settings: settingsOut(), categories: ["Equipment", "Software and subscriptions", "Studio rent and bills", "Marketing and ads", "Musicians and freelancers", "Travel", "Repairs and upkeep", "Food and hospitality", "Bank and payment fees", "Other"], methods: [["bank", "Bank transfer"], ["monzo", "Monzo"], ["card", "Card (in person)"], ["cash", "Cash"], ["other", "Other"]].map(([id, name]) => ({ id, name })), canDecide: true, emailReady: true, cardReady: true };
      if (p === "/app/api/money/catalogue") return { services: SERVICES, depositPercent: 50, themes: THEMES, modes: ["bright", "dark"], papers: PAPERS, theme: settings.invoiceTheme, mode: settings.invoiceMode, paper: settings.invoicePaper };
      const st = p.match(/^\/app\/api\/money\/invoices\/(\d+)\/stage$/);
      if (st) { const i = byId(st[1]); if (!i) return fail(404, "That invoice doesn't exist."); const x = pub(i), autoStage = auto(x), stage = STAGES.includes(q.get("stage")) ? q.get("stage") : autoStage, s = sums(x, stage); return { stage, autoStage, sums: s, email: email(x, s, stage), invoice: x, payments: payments.filter((y) => y.invoiceId === i.id) }; }
      const one = p.match(/^\/app\/api\/money\/invoices\/(\d+)$/);
      if (one) { const i = byId(one[1]); if (!i) return fail(404, "That invoice doesn't exist."); return { invoice: pub(i), payments: payments.filter((y) => y.invoiceId === i.id), reminders: reminders.filter((r) => r.invoiceId === i.id).sort((a, b) => a.id - b.id), log: logs.filter((l) => l.invoiceId === i.id) }; }
      return undefined;
    }
    if (p === "/app/api/money/invoices") {
      if (!String(body.billName || "").trim()) return fail(400, "Who's it to?");
      const i = inv(++seq, { billTo: { name: body.billName, email: body.billEmail || null }, billing: body.billing === "full" ? "full" : "deposit", lines: linesFrom(body.lines), issueDate: body.issueDate || today, dueDate: body.dueDate || day(14), notes: body.notes || "", status: "pending_approval", look: body.look || null, createdAt: new Date().toISOString() });
      invoices.push(i); log(i.id, "created"); return { ok: true, invoice: pub(i) };
    }
    if (p === "/app/api/money/invoices/preview") return { html: docHtml({ id: 0, number: "Draft", status: "draft", billTo: { name: body.billName || "Artist name", email: body.billEmail || null }, billing: body.billing, lines: linesFrom(body.lines), issueDate: body.issueDate || today, dueDate: body.dueDate || day(14), notes: body.notes || "", look: { theme: body.theme, mode: body.mode }, totalPence: linesFrom(body.lines).reduce((t, l) => t + l.totalPence, 0), paidPence: 0 }, body.billing === "full" ? "balance" : "deposit", new URLSearchParams(), { pay: false, preview: true }) };
    if (p === "/app/api/money/invoices/test-send") return { ok: true, to: "jordan@example.com" };
    if (p === "/app/api/money/invoices/renumber") { if (body.confirm !== "start again") return fail(400, 'Say confirm: "start again".'); let n = 0; for (const i of invoices) if (/^NS-/.test(i.number)) { i.number = `TEST-${String(++n).padStart(4, "0")}`; } seq = 0; return { ok: true, renumbered: n }; }
    if (p === "/app/api/money/settings") { const b = body; if (b.business) Object.assign(settings.business, b.business); if (b.bank) Object.assign(settings.bank, b.bank); if (b.monzo) Object.assign(settings.monzo, b.monzo); for (const k of ["vatRate", "dueDays", "invoiceTheme", "invoiceMode", "invoicePaper"]) if (b[k] !== undefined) settings[k] = b[k]; return { ok: true, settings: { ...settingsOut(), invoiceTheme: settings.invoiceTheme, invoiceMode: settings.invoiceMode, invoicePaper: settings.invoicePaper } }; }
    const m = p.match(/^\/app\/api\/money\/invoices\/(\d+)\/(edit|look|payments|reminder|approve|reject|void)$/);
    if (m) {
      const i = byId(m[1]);
      if (!i) return fail(404, "That invoice doesn't exist.");
      const what = m[2];
      if (what === "edit") {
        if (["paid", "void"].includes(i.status)) return fail(400, "It's paid in full or removed: it can't change.");
        if (body.billName !== undefined) i.billTo = { ...i.billTo, name: body.billName, email: body.billEmail || null };
        if (body.lines) i.lines = linesFrom(body.lines);
        for (const k of ["billing", "issueDate", "dueDate", "notes"]) if (body[k] !== undefined) i[k] = body[k];
        if (!WAITINGS.includes(i.status) || i.status === "rejected") i.status = "pending_approval";
        log(i.id, "edited", body.lines ? null : "The notes"); return { ok: true, invoice: pub(i) };
      }
      if (what === "look") { i.look = body.look; return { ok: true, invoice: pub(i) }; }
      if (what === "payments") { const amt = Math.round(Number(String(body.amount).replace(/[£,\s]/g, "")) * 100); if (!(amt > 0)) return fail(400, "The amount in pounds, like 150.00."); payments.push({ id: nextPay++, invoiceId: i.id, amountPence: amt, paidOn: body.paidOn || today, method: body.method, methodName: { bank: "Bank transfer", monzo: "Monzo", card: "Card (in person)", cash: "Cash" }[body.method] || "Other", byName: "Jordan Lee", note: body.note || "", removed: false }); log(i.id, "payment", `${pounds(amt)} by ${body.method}`); setPaid(i); return { ok: true, invoice: pub(i) }; }
      if (what === "reminder") { reminders.push({ id: nextRem++, invoiceId: i.id, kind: body.kind === "receipt" ? "receipt" : "reminder", status: "pending_approval", body: body.body, createdBy: "s1", createdAt: new Date().toISOString() }); log(i.id, "reminder", "Queued for approval"); return { ok: true }; }
      if (what === "approve") { if (!body.byHand && !i.billTo.email) return fail(400, "It has no email address: add one with Edit to approve it."); i.status = "sent"; i.sentAt = new Date().toISOString(); i.decidedByName = "Jordan Lee"; log(i.id, "approved", body.byHand ? "To share by hand (no email)" : null); if (!body.byHand) log(i.id, "sent", `To ${i.billTo.email}`); return { ok: true, invoice: pub(i) }; }
      if (what === "reject") { i.status = "rejected"; i.decidedByName = "Jordan Lee"; i.note = body.note || null; log(i.id, "rejected", body.note || null); return { ok: true }; }
      if (what === "void") { if (paid(i) > 0) return fail(400, "Money's been paid on it, so it can't be removed."); i.status = "void"; log(i.id, "voided"); return { ok: true }; }
    }
    const r = p.match(/^\/app\/api\/money\/reminders\/(\d+)\/(approve|reject)$/);
    if (r) { const x = reminders.find((y) => String(y.id) === r[1]); if (!x) return fail(404, "That reminder doesn't exist."); x.status = r[2] === "approve" ? "sent" : "rejected"; x.decidedByName = "Jordan Lee"; if (x.status === "sent") x.sentAt = new Date().toISOString(); log(x.invoiceId, r[2] === "approve" ? "sent" : "rejected", `The ${x.kind}`); return { ok: true }; }
    const tb = p.match(/^\/app\/api\/money\/payments\/(\d+)\/remove$/);
    if (tb) { const x = payments.find((y) => String(y.id) === tb[1]); if (!x) return fail(404, "That payment doesn't exist."); x.removed = true; const i = byId(x.invoiceId); log(i.id, "payment_removed", pounds(x.amountPence)); if (i.status === "paid") i.status = "part_paid"; setPaid(i); return { ok: true }; }
    if (p === "/app/api/money/expenses") { expenses.unshift({ id: nextExp++, spentOn: body.spentOn || today, amountPence: Math.round(Number(body.amount) * 100) || 0, category: body.category || "Other", supplier: body.supplier || "", note: body.note || "", status: "confirmed", receiptId: body.receiptId || null }); return { ok: true }; }
    const ex = p.match(/^\/app\/api\/money\/expenses\/(\d+)\/(edit|confirm|delete)$/);
    if (ex) { const k = expenses.findIndex((y) => String(y.id) === ex[1]); if (k < 0) return fail(404, "That expense doesn't exist."); if (ex[2] === "delete") expenses.splice(k, 1); else if (ex[2] === "confirm") expenses[k].status = "confirmed"; else Object.assign(expenses[k], { spentOn: body.spentOn, amountPence: Math.round(Number(body.amount) * 100) || expenses[k].amountPence, category: body.category, supplier: body.supplier, note: body.note }); return { ok: true }; }
    return undefined;
  });
  const WAITINGS = ["draft", "pending_approval", "approved", "rejected", "failed"];
})();
