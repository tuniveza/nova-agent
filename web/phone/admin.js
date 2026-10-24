// Nova Phone: the admin places (Nova Desk's Portal → Admin). For admins; anyone else is told it's for admins.
//   #google               connect the studio's Google, one step at a time (what to open, what to copy, the key);
//                         connected: who as, each part on or off with how it last went and Sync now, Connect again
//                         for a missing permission, the Drive folder, the Money sheet and Google's own pages
//   #tests                Test stuff: what looks like a test, from Nova Bot and the studio computer, with why,
//                         where it lives, what goes with it; Delete (Put back for 30 days), Not a test, filters
//   #admin                the admin pages: Referrals (#admin/referrals), Links (#admin/links), Test booking
//                         (#admin/test-booking), with The crew, Google and Test stuff
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, choices, empty, api, post, toast, confirm, form: sheetForm, busy } = N;
  const A = "/app/api/";
  const HDR = { "X-Nova-Visualizer": "1" };
  const UK = "Europe/London";
  const forAdmins = (box) => (box.innerHTML = empty({ icon: "user", title: "This is for admins", text: "Ask an admin, or sign in as one." }));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const ms = (v) => N.asDate(v)?.getTime() || 0;
  const ukWhen = (v) => (ms(v) ? new Date(ms(v)).toLocaleString("en-GB", { timeZone: UK, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  function since(v) {
    const t = ms(v);
    if (!t) return "";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} h ago` : ukWhen(v);
  }
  // Admins only: who's asking, alongside what they asked for (one wait, not two)
  async function asAdmin(box, ...asks) {
    const [me, ...rest] = await Promise.all([api("/auth/me"), ...asks.map((p) => p.catch((e) => e))]);
    if (me.staff?.role !== "admin") { forAdmins(box); return null; }
    for (const r of rest) if (r instanceof Error && r.signIn) throw r;
    return { me: me.staff, rest };
  }
  // A window opened on the tap itself (phones only allow that), its address filled in once it's known
  function openLater() {
    const w = window.open("about:blank", "_blank");
    return { go: (url) => { if (w && !w.closed) w.location.href = url; else location.href = url; }, close: () => w && w.close() };
  }
  const copyBtn = (value, label = "Copy") => `<button type="button" class="btn admin-copy-btn" data-copy="${esc(value)}" aria-label="Copy ${esc(value)}">${esc(label)}</button>`;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b || !b.closest(".admin-place")) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copied ✓"; } catch (err) { b.textContent = "Select and copy"; }
    setTimeout(() => b.isConnected && (b.textContent = "Copy"), 1600);
  });
  // (a place's live box, to draw again in place: a step forward, a sync's progress)
  const live = { google: null, tests: null, booking: null };
  const onScreen = (id) => window.NovaPhone.hash().split("/")[0] === id;
  // A pause that waits while the app is hidden (no timers working in the background)
  const wait = (t) => new Promise((resolve) => { const go = () => (document.hidden ? document.addEventListener("visibilitychange", go, { once: true }) : setTimeout(resolve, t)); go(); });

  // ===================== Google =====================
  const SYNCABLE = { calendar: "calendar", replies: "replies", contacts: "contacts", sheets: "sheets", backups: "backups", inbox: "inbox", docs: "docs", files: "files" };
  const gs = { step: null, showSteps: false, syncing: new Set(), connecting: false };
  N.section({
    id: "google", name: "Google", tile: "portal",
    async draw(box, path, ui) {
      await N.css("admin.css");
      const r = await asAdmin(box, api(`${A}google`));
      if (!r) return;
      const [g] = r.rest;
      if (g instanceof Error) {
        if (g.status === 404) { box.innerHTML = empty({ icon: "globe", title: "Google isn't switched on yet", text: "Nova Bot needs its update." }); return; }
        throw g;
      }
      ui.back("#admin");
      ui.action({ icon: "refresh", label: "Check again", run: () => N.show() });
      live.google = { box, g };
      drawGoogle();
    },
  });
  function drawGoogle() {
    const { box, g } = live.google;
    const status = g.status || {};
    const steps = g.steps || [];
    // (the heading short, one line, as a heading's words are; the rest of what it says under it. the user (24 Oct 2026): "can shared/rules.js just be smartly integrated back into the base code for all of this")
    const [top, under] = g.sandbox ? ["Test copy", "Test copy of Nova Bot: Google is stood in for here."] : g.connected ? ["Connected ✓", `As ${g.account}`] : g.hasKey ? ["Key saved ✓", "One step left: Connect Google."] : ["Not set up yet", "It takes about 5 minutes, one step at a time."];
    let html = `<div class="card"><p class="kicker">Google</p><h2 class="card-title admin-big">${esc(top)}</h2><p class="admin-under">${esc(under)}</p>
      ${g.connected && g.needsReconnect ? `<p class="warn">Google stopped Nova Agent's connection, so nothing is syncing. Press Connect again (about a minute).</p><button type="button" class="btn main wide" data-g="connect">Connect again</button>` : ""}
      ${g.connected && (g.missing || []).length ? `<p class="warn small">Connect again to switch on: ${esc(g.missing.join(", "))}.</p>${g.needsReconnect ? "" : '<button type="button" class="btn wide" data-g="connect">Connect again</button>'}` : ""}
      ${g.connected ? `<div class="btns two"><button type="button" class="btn" data-g="steps">${gs.showSteps ? "Hide the setup steps" : "Show the setup steps"}</button><button type="button" class="btn quiet" data-g="disconnect">Disconnect</button></div>` : ""}</div>`;
    if ((!g.connected || gs.showSteps) && steps.length) {
      if (gs.step === null || gs.step >= steps.length) gs.step = g.hasKey ? steps.length - 1 : 0;
      const s = steps[gs.step];
      html += `<div class="card admin-step" role="group" aria-label="Setting up Google"><p class="kicker">Step ${gs.step + 1} of ${steps.length}</p><h3 class="card-title">${esc(s.title)}</h3><p>${esc(s.text)}</p>
        ${s.open ? `<a class="btn wide" href="${esc(s.open.href)}" target="_blank" rel="noopener">${esc(s.open.label)} ↗</a>` : ""}
        ${(s.copy || []).map((v) => `<div class="admin-copy"><code>${esc(v)}</code>${copyBtn(v)}</div>`).join("")}
        ${s.key ? (g.hasKey ? keySaved(g) : keyForm()) : ""}
        ${s.connect ? `${g.connected ? `<p>Connected as ${esc(g.account)} ✓</p>` : ""}${!g.hasKey && !s.key ? `<p class="warn small">First paste the key from Google (Client ID and Client secret) and press Save. Then Connect Google lights up.</p>${keyForm()}` : ""}<button type="button" class="btn main wide" data-g="connect"${g.hasKey ? "" : " disabled"}>${g.connected ? "Connect again" : "Connect Google"}</button>` : ""}
        <div class="btns two"><button type="button" class="btn" data-g="prev"${gs.step === 0 ? " disabled" : ""}>${icon("back")} Back</button>${gs.step < steps.length - 1 ? `<button type="button" class="btn main" data-g="next">Next ${icon("next")}</button>` : ""}</div></div>`;
    }
    if (g.connected) {
      html += `<h3 class="h">What's kept in step</h3><div class="card admin-parts">${(g.parts || []).map((p) => {
        const st = status[SYNCABLE[p.id]] || (p.id === "bookings" || p.id === "calendarPlan" ? null : status[p.id]);
        const note = st && p.on ? (st.running ? "Syncing now…" : st.ok ? `${st.note || "Done"} · ${since(st.at)}` : `Last try ${since(st.at)}: ${st.note || "it didn't work"}`) : "";
        const key = SYNCABLE[p.id];
        return `<div class="admin-part"><label class="switch"><span>${esc(p.label)}</span><input type="checkbox" role="switch" data-part="${esc(p.id)}"${p.on ? " checked" : ""}${p.allowed ? "" : " disabled"}></label>
          <p class="small muted">${esc(p.allowed ? p.help || "" : `${p.help ? `${p.help} ` : ""}(Needs Connect again: Google hasn't given this permission.)`)}</p>
          ${note ? `<p class="small ${st.ok || st.running ? "admin-note" : "bad"}"${st.running ? ' aria-live="polite"' : ""}>${esc(note)}</p>` : ""}
          ${key && p.on && p.allowed ? `<button type="button" class="chip" data-sync="${esc(key)}"${gs.syncing.has(key) ? " disabled" : ""} aria-label="Sync ${esc(p.label)} now">${gs.syncing.has(key) ? "Working…" : `${icon("refresh")} Sync now`}</button>` : ""}</div>`;
      }).join("")}</div>
      <h3 class="h">Open in Google</h3><div class="btns">${g.folderUrl ? `<a class="btn wide" href="${esc(g.folderUrl)}" target="_blank" rel="noopener">The Nova Agent folder in Drive ↗</a>` : ""}<button type="button" class="btn wide" data-g="sheet">The Money sheet ↗</button>
        ${[["https://calendar.google.com/", "Google Calendar"], ["https://contacts.google.com/", "Google Contacts"], ["https://tasks.google.com/", "Google Tasks"], ["https://studio.youtube.com/", "YouTube Studio"]].map(([u, l]) => `<a class="btn wide" href="${u}" target="_blank" rel="noopener">${l} ↗</a>`).join("")}</div>
      <p class="muted small admin-hint">Google reviews (Business Profile) can come later: Google first has to approve the studio for its Business Profile API (search "Business Profile API access request", fill in Google's form with project nova-agent). Then Nova can show and answer reviews here.</p>`;
    }
    box.innerHTML = `<div class="admin-place page-in">${html}</div>`;
    wireGoogle(box, g);
  }
  const keySaved = (g) => `<p>Key saved ✓ (${esc(g.keyShort || "")}${g.keyFrom === "secrets" ? ", from Nova Bot's secrets" : ""})</p>${g.keyFrom === "app" ? '<button type="button" class="btn quiet wide" data-g="unkey">Remove the key</button>' : ""}`;
  const keyForm = () => `<form class="form admin-key" data-key novalidate autocomplete="off">${field({ label: "Client ID", name: "clientId", placeholder: "….apps.googleusercontent.com", attrs: 'spellcheck="false" autocapitalize="off" autocomplete="off"' })}${field({ label: "Client secret", name: "clientSecret", type: "password", placeholder: "GOCSPX-…", attrs: 'autocomplete="off"' })}<p class="form-said bad" data-err role="alert"></p><button class="btn main wide" type="submit">Save</button></form>`;
  function wireGoogle(box, g) {
    box.querySelectorAll("[data-part]").forEach((c) => c.addEventListener("change", async () => {
      const p = (g.parts || []).find((x) => x.id === c.dataset.part);
      try { await post(`${A}google/options`, { changes: { [c.dataset.part]: c.checked } }); toast(`${p?.label || "That"}: ${c.checked ? "on" : "off"}`); N.show(); } catch (err) { c.checked = !c.checked; toast(err.message, true); }
    }));
    box.querySelectorAll("[data-sync]").forEach((b) => b.addEventListener("click", () => syncNow(b.dataset.sync)));
    const form = box.querySelector("[data-key]");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements, err = form.querySelector("[data-err]");
      const clientId = f.clientId.value.trim(), clientSecret = f.clientSecret.value.trim();
      if (!clientId) { err.textContent = "Paste the Client ID."; return f.clientId.focus(); }
      if (!clientSecret) { err.textContent = "Paste the Client secret."; return f.clientSecret.focus(); }
      err.textContent = "";
      try {
        const res = await busy(form.querySelector("[type=submit]"), "Saving…", () => post(`${A}google/key`, { clientId, clientSecret }));
        toast(res.message || "Saved ✓ Now press Connect Google.");
        gs.step = null;
        N.show();
      } catch (x) { err.textContent = x.message; }
    });
    box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.g;
      try {
        if (what === "prev" || what === "next") { gs.step = Math.max(0, gs.step + (what === "next" ? 1 : -1)); drawGoogle(); return box.querySelector(".admin-step .card-title")?.scrollIntoView({ block: "nearest" }); }
        if (what === "steps") { gs.showSteps = !gs.showSteps; gs.step = null; return drawGoogle(); }
        if (what === "connect") return connect(b);
        if (what === "sheet") {
          const w = openLater();
          try { const res = await busy(b, "Bringing it up to date…", () => post(`${A}google/sheet`, {})); w.go(res.url); } catch (err) { w.close(); toast(err.message, true); }
          return;
        }
        if (what === "unkey") {
          if (!(await confirm({ title: "Remove the key?", text: "Google can't be connected again until a new key is pasted.", ok: "Remove it", danger: true }))) return;
          await post(`${A}google/key/remove`, {});
          toast("The key is removed.");
        }
        if (what === "disconnect") {
          if (!(await confirm({ title: "Disconnect Google?", text: "Nothing more is kept in step until it's connected again. Nothing in Google is deleted.", ok: "Disconnect", danger: true }))) return;
          await post(`${A}google/disconnect`, {});
          gs.step = null;
          toast("Google disconnected. Nothing in Google was deleted.");
        }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }
  // Connect Google: Google's page in its own window (it can't open inside Nova), with a one-time pass from Nova Bot
  // (10 minutes), so it works however the phone is signed in. Back here, the page looks again.
  async function connect(b) {
    const w = window.open("about:blank", "nova-google");
    let link;
    try { link = await busy(b, "Opening Google…", () => post(`${A}google/connect-link`, { popup: true })); } catch (err) { if (w) w.close(); return toast(err.message, true); }
    gs.connecting = true;
    if (w && !w.closed) { w.location.href = link.url; return; }
    // (the phone blocked the window: a button to press instead)
    toast("Your phone blocked the window. Use Open Google below.");
    b.insertAdjacentHTML("afterend", `<a class="btn main wide" href="${esc(link.url)}" target="_blank" rel="opener">Open Google ↗</a>`);
  }
  addEventListener("message", (ev) => {
    if (ev.origin !== location.origin || !ev.data || ev.data.type !== "nova-google") return;
    gs.connecting = false;
    gs.showSteps = false;
    toast(ev.data.ok ? "Google connected ✓" : "Google wasn't connected. Try again.", !ev.data.ok);
    if (onScreen("google")) N.show();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && gs.connecting && onScreen("google")) { gs.connecting = false; N.show(); }
  });
  // Sync now: Nova Bot starts it and answers straight away; this looks every few seconds until the part says how
  // it went (a minute at most; never while the app is hidden, and not once you've gone elsewhere)
  async function syncNow(key) {
    gs.syncing.add(key);
    drawGoogle();
    try {
      const res = await post(`${A}google/sync`, { part: key });
      if (res.started) {
        for (let i = 0; i < 20; i++) {
          await wait(3000);
          if (!onScreen("google")) break;
          const g = await api(`${A}google`);
          if (live.google) { live.google.g = g; if (live.google.box.isConnected) drawGoogle(); }
          const st = g.status && g.status[key];
          if (st && !st.running) { toast(st.ok ? `Done: ${st.note}` : st.note || "It didn't work", !st.ok); break; }
        }
      } else toast(res.note ? `Done: ${res.note}` : "Done");
    } catch (err) { toast(err.message, true); }
    gs.syncing.delete(key);
    if (onScreen("google")) N.show();
  }

  // ===================== Test stuff =====================
  // Two lists shown as one: Nova Bot's (/app/api/tidy) and the studio computer's (/tidy-api/state, when it's on)
  async function pcCall(path, body) {
    let res;
    try { res = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json", ...HDR } : {}) }, body: body ? JSON.stringify(body) : undefined }); } catch (e) { throw Object.assign(new Error("The studio computer couldn't be reached"), { pcOffline: true }); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw Object.assign(new Error(data.pcOffline ? "The studio computer is off" : data.message || data.error || `The studio computer couldn't answer (${res.status})`), { pcOffline: Boolean(data.pcOffline) || res.status === 503 });
    return data;
  }
  const call = (side, action, body) => (side === "pc" ? pcCall(`/actions/tidy/${action}`, body) : post(`${A}tidy/${action}`, body));
  const ts = { filter: "all", apart: new Set(), undo: null, said: "" };
  // Where each thing lives, in Nova Phone
  function openHref(i) {
    const id = encodeURIComponent(i.id || "");
    const to = { quest: `quests/quest/${id}`, mission: "quests", calnote: "calendar", fixer: "fixer", file: `agent/file/${id}`, booking: i.open && i.open.includes("view=chats") ? "inbox/chats" : "bot", enquiry: `inbox/enquiry/${id}`, chat: `inbox/chat/${id}`, client: `clients/${id}`, index: "index", note: `notes/${id}`, social: `outreach/social/${id}`, outreach: `outreach/one/${id}`, invoice: `money/invoice/${id}`, expense: `money/expense/${id}` }[i.kind];
    return to && N.has(to.split("/")[0]) ? `#${to}` : "";
  }
  N.section({
    id: "tests", name: "Test stuff", tile: "portal",
    async draw(box, path, ui) {
      await N.css("admin.css");
      const r = await asAdmin(box, api(`${A}tidy`), pcCall("/tidy-api/state"));
      if (!r) return;
      ui.back("#admin");
      ui.action({ icon: "refresh", label: "Check again", run: () => N.show() });
      const [b, p] = r.rest;
      live.tests = { box, bot: b instanceof Error ? null : b, pc: p instanceof Error ? null : p, botProblem: b instanceof Error ? b.message : "", pcProblem: p instanceof Error ? (p.pcOffline ? "The studio computer is off, so its quests, calendar notes, Fixer jobs and files aren't checked right now." : `The studio computer's list couldn't load: ${p.message}`) : "" };
      if (!live.tests.bot && !live.tests.pc) throw b;
      drawTests();
    },
  });
  function drawTests() {
    const { box, bot, pc, botProblem, pcProblem } = live.tests;
    const all = [...((bot && bot.items) || []).map((i) => ({ ...i, side: i.side || "bot" })), ...((pc && pc.items) || []).map((i) => ({ ...i, side: "pc" }))];
    const recent = [...((bot && bot.recent) || []).map((x) => ({ ...x, side: "bot" })), ...((pc && pc.recent) || []).map((x) => ({ ...x, side: "pc" }))].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    const real = [...((bot && bot.real) || []).map((x) => ({ ...x, side: "bot" })), ...((pc && pc.real) || []).map((x) => ({ ...x, side: "pc" }))];
    const likely = all.filter((i) => i.confidence === "likely"), maybe = all.filter((i) => i.confidence !== "likely");
    const kinds = [...new Set(all.map((i) => i.kindName).filter(Boolean))].sort();
    if (!["all", "likely", "maybe", ...kinds].includes(ts.filter)) ts.filter = "all";
    const shown = (i) => ts.filter === "all" || ts.filter === (i.confidence === "likely" ? "likely" : "maybe") || ts.filter === i.kindName;
    const deletable = likely.filter((i) => !i.locked);
    // (the heading short, one line; the rest under it. the user (24 Oct 2026): "can shared/rules.js just be smartly integrated back into the base code for all of this")
    const [summary, summaryMore] = !all.length ? ["All clean ✦", "Nothing looks like a test."] : [`${plural(likely.length, "looks like a test", "look like a test")}`, `And ${maybe.length} might.`];
    const problems = [botProblem && !bot ? `Nova Bot's list couldn't load: ${botProblem}` : "", pcProblem].filter(Boolean);
    const chip = (v, l, n) => `<button type="button" class="chip" data-filter="${esc(v)}" aria-pressed="${ts.filter === v}">${esc(l)} <span class="n">${n}</span></button>`;
    const card = (i) => {
      const href = openHref(i);
      const together = !ts.apart.has(i.key);
      const meta = [i.where ? `In ${i.where}` : "", i.created ? `Made ${ukWhen(i.created)}` : "", i.by ? `By ${i.by}` : "", i.side === "pc" ? "On the studio computer" : ""].filter(Boolean).join(" · ");
      const linked = i.linked || [];
      return `<article class="card admin-ts" data-conf="${i.confidence === "likely" ? "likely" : "maybe"}">
        <p class="admin-ts-top"><span class="pill${i.confidence === "likely" ? " warn" : ""}">${i.confidence === "likely" ? "Likely a test" : "Maybe a test"}</span><span class="muted small">${esc(i.kindName || i.kind || "")}</span></p>
        <h4 class="admin-ts-title">${esc(i.title || "")}</h4>${meta ? `<p class="muted small">${esc(meta)}</p>` : ""}
        ${(i.reasons || []).length ? `<div class="admin-why"><b>Why:</b><ul>${i.reasons.map((x) => `<li${x.strong ? ' class="strong"' : ""}>${esc(typeof x === "string" ? x : x.text)}</li>`).join("")}</ul></div>` : ""}
        ${i.note ? `<p class="small muted">${esc(i.note)}</p>` : ""}
        ${linked.length ? `<div class="admin-linked"><p class="small">Goes with it (${linked.length}):</p><ul>${linked.map((l) => `<li>${esc(`${l.kindName || l.kind || ""}: ${l.label || l.key}`)}</li>`).join("")}</ul><label class="switch"><span>${linked.length === 1 ? "Delete it too" : "Delete these too"}</span><input type="checkbox" role="switch" data-together="${esc(i.key)}"${together ? " checked" : ""}></label></div>` : ""}
        ${i.locked ? '<p class="small warn">Locked: it can\'t be deleted from here. Open it and check first.</p>' : ""}
        <div class="btns two">${i.locked ? "" : `<button type="button" class="btn danger" data-del="${esc(i.key)}">${icon("trash")} Delete</button>`}<button type="button" class="btn" data-real="${esc(i.key)}">Not a test</button>${href ? `<a class="btn" href="${esc(href)}">Open</a>` : ""}</div></article>`;
    };
    const line = (title, text, end) => `<li class="admin-line"><div><b>${esc(title)}</b><span>${esc(text)}</span></div>${end}</li>`;
    const lShown = likely.filter(shown), mShown = maybe.filter(shown);
    box.innerHTML = `<div class="admin-place page-in">
      <div class="card"><p class="kicker">Test stuff</p><h2 class="card-title admin-big">${esc(summary)}</h2><p class="admin-under">${esc(summaryMore)}</p>${problems.map((t) => `<p class="small warn">${esc(t)}</p>`).join("")}
        <p class="muted small">Things that look like tests or copies, and why. Deleting keeps a copy for 30 days: Put back brings it back.</p></div>
      ${ts.undo && Date.now() - ts.undo.at < 600000 ? `<div class="card admin-undo" role="status"><p>${esc(ts.undo.text)}</p>${ts.undo.list.length ? '<button type="button" class="btn" data-undo>Put back</button>' : ""}</div>` : ""}
      ${all.length ? `<div class="chips">${chip("all", "All", all.length)}${chip("likely", "Likely", likely.length)}${chip("maybe", "Maybe", maybe.length)}${kinds.map((k) => chip(k, k, all.filter((i) => i.kindName === k).length)).join("")}</div>` : ""}
      ${deletable.length ? `<button type="button" class="btn danger wide" data-all>${icon("trash")} Delete all likely (${deletable.length})</button>` : ""}
      ${lShown.length ? `<h3 class="h">Likely tests · ${lShown.length}</h3>${lShown.map(card).join("")}` : ""}
      ${mShown.length ? `<h3 class="h">Maybe · ${mShown.length}</h3>${mShown.map(card).join("")}` : ""}
      ${!all.length ? empty({ icon: "check", title: "All clean ✦", text: "Nothing looks like a test." }) : !lShown.length && !mShown.length ? empty({ icon: "search", title: "Nothing here with that filter" }) : ""}
      ${recent.length ? `<h3 class="h">Recently deleted · ${recent.length}</h3><ul class="list admin-lines">${recent.map((x, n) => line(`${x.kindName || x.kind || ""}: ${x.title}`, x.restoredAt ? `Put back ${ukWhen(x.restoredAt)}${x.restoredBy ? ` by ${x.restoredBy}` : ""}` : `Deleted ${ukWhen(x.deletedAt)}${x.deletedBy ? ` by ${x.deletedBy}` : ""}`, x.noRestore ? '<span class="small muted">Cleared (can\'t come back)</span>' : x.restoredAt ? "" : `<button type="button" class="btn" data-restore="${n}">Put back</button>`)).join("")}</ul>` : ""}
      ${real.length ? `<h3 class="h">Marked as real · ${real.length}</h3><ul class="list admin-lines">${real.map((x, n) => line(`${x.kindName || x.kind || ""}: ${x.title}`, `Marked ${ukWhen(x.markedAt)}${x.markedBy ? ` by ${x.markedBy}` : ""}`, `<button type="button" class="btn" data-unreal="${n}">Undo</button>`)).join("")}</ul>` : ""}
    </div>`;
    const byKey = (k) => all.find((i) => i.key === k);
    box.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { ts.filter = b.dataset.filter; drawTests(); }));
    box.querySelectorAll("[data-together]").forEach((c) => c.addEventListener("change", () => (c.checked ? ts.apart.delete(c.dataset.together) : ts.apart.add(c.dataset.together))));
    box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => busy(b, "Deleting…", () => remove([byKey(b.dataset.del)]))));
    box.querySelector("[data-all]")?.addEventListener("click", async (e) => {
      if (!(await confirm({ title: `Delete ${plural(deletable.length, "thing", "things")}?`, text: "Everything likely to be a test (not the locked ones). Each can be put back for 30 days from Recently deleted.", ok: `Yes, delete ${plural(deletable.length, "thing", "things")}`, danger: true }))) return;
      busy(e.target.closest("button"), "Deleting…", () => remove(deletable));
    });
    box.querySelectorAll("[data-real]").forEach((b) => b.addEventListener("click", () => busy(b, "Keeping it…", async () => {
      const i = byKey(b.dataset.real);
      try { await call(i.side, "real", { key: i.key, title: i.title }); ts.undo = { at: Date.now(), text: `Kept “${i.title}”. It won't be shown here again (Undo is under Marked as real).`, list: [] }; } catch (err) { toast(`Couldn't mark that: ${err.message}`, true); }
      N.show();
    })));
    box.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => busy(b, "Putting back…", async () => {
      const x = recent[Number(b.dataset.restore)];
      try { await call(x.side, "restore", { binId: x.binId }); ts.undo = null; toast(`Put back “${x.title}”.`); } catch (err) { toast(`Couldn't put it back: ${err.message}`, true); }
      N.show();
    })));
    box.querySelectorAll("[data-unreal]").forEach((b) => b.addEventListener("click", () => busy(b, "Undoing…", async () => {
      const x = real[Number(b.dataset.unreal)];
      try { await call(x.side, "unreal", { key: x.key }); toast(`“${x.title}” will be checked again.`); } catch (err) { toast(`Couldn't undo that: ${err.message}`, true); }
      N.show();
    })));
    box.querySelector("[data-undo]")?.addEventListener("click", (e) => busy(e.target.closest("button"), "Putting back…", async () => {
      const u = ts.undo;
      let back = 0;
      for (const x of u.list) { try { await call(x.side, "restore", { binId: x.binId }); back++; } catch (err) {} }
      ts.undo = { at: Date.now(), text: back === 1 ? "Put back." : `${back} things put back.`, list: [] };
      N.show();
    }));
  }
  // Delete: each side gets its own list; what goes with each thing too, unless its switch was turned off
  async function remove(items) {
    const todo = items.filter((i) => i && !i.locked);
    if (!todo.length) return;
    const sides = { bot: [], pc: [] };
    for (const i of todo) sides[i.side === "pc" ? "pc" : "bot"].push({ key: i.key, title: i.title, together: !ts.apart.has(i.key), linked: (i.linked || []).map((l) => l.key) });
    const undo = [], failed = [];
    for (const side of ["bot", "pc"]) {
      if (!sides[side].length) continue;
      try {
        const res = await call(side, "delete", { items: sides[side] });
        for (const d of res.done || []) undo.push({ side, binId: d.binId });
        for (const f of res.failed || []) failed.push(f.error);
      } catch (err) { failed.push(err.message); }
    }
    const n = undo.length;
    ts.undo = { at: Date.now(), list: undo, text: n && !failed.length ? (n === 1 ? `Deleted “${todo[0].title}”.` : `Deleted ${n} things.`) : n ? `Deleted ${n}; ${failed.length} couldn't be: ${failed[0]}` : `Nothing was deleted: ${failed[0] || "it's gone already."}` };
    N.show();
  }

  // ===================== The admin pages =====================
  N.section({
    id: "admin", name: "Admin", tile: "portal",
    async draw(box, [part], ui) {
      await N.css("admin.css");
      if (part === "referrals") return drawReferrals(box, ui);
      if (part === "links") return drawLinks(box, ui);
      if (part === "test-booking") return drawBooking(box, ui);
      const r = await asAdmin(box);
      if (!r) return;
      ui.title("Admin");
      box.innerHTML = `<p class="muted small admin-hint">Invite people, change roles, and run the admin pages.</p>${list([
        row({ href: "#crew", icon: "user", title: "The crew", text: "Everyone, invites, roles, switching someone off" }),
        row({ href: "#google", icon: "globe", title: "Google", text: "Connect the studio's Google, and what's kept in step" }),
        row({ href: "#tests", icon: "trash", title: "Test stuff", text: "What looks like a test, and why" }),
        row({ href: "#admin/referrals", icon: "star", title: "Referrals", text: "Appointments, who was referred, codes, the spreadsheet" }),
        row({ href: "#admin/links", icon: "share", title: "Links", text: "Every Nova address, checked now; edit the list" }),
        row({ href: "#admin/test-booking", icon: "calendar", title: "Test booking", text: "Try the booking flow, no real money, nobody emailed" }),
      ])}`;
    },
  });

  // ---- Referrals (Studio admin): the appointments and their referrals, from the spreadsheet Nova Bot makes ----
  function parseCsv(text) {
    const rows = [];
    let rowNow = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true;
      else if (c === ",") { rowNow.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; rowNow.push(cell); rows.push(rowNow); rowNow = []; cell = ""; }
      else cell += c;
    }
    if (cell || rowNow.length) { rowNow.push(cell); rows.push(rowNow); }
    const [headRow, ...body] = rows.filter((r) => r.length > 1);
    // (a value starting "=" was given a ' so spreadsheets don't run it: taken off again here)
    return (body || []).map((r) => Object.fromEntries((headRow || []).map((h, n) => [h, String(r[n] ?? "").replace(/^'(?=[=+\-@])/, "")])));
  }
  const ref = { show: "all", count: 30 };
  async function drawReferrals(box, ui) {
    ui.back("#admin");
    ui.title("Referrals");
    const r = await asAdmin(box, fetch("/admin/report.csv", { credentials: "same-origin" }).then(async (res) => {
      if (!res.ok || !/csv/.test(res.headers.get("content-type") || "")) throw Object.assign(new Error(`The spreadsheet didn't come (${res.status})`), { status: res.status });
      return res.text();
    }));
    if (!r) return;
    const [csv] = r.rest;
    if (csv instanceof Error) throw csv;
    const all = parseCsv(csv);
    const counted = all.filter((a) => a.Status !== "canceled");
    const totals = [[counted.length, "Appointments"], [counted.filter((a) => a["Referred?"] === "yes").length, "Say they were referred"], [counted.filter((a) => a["Referral code"]).length, "With a valid code"], [counted.filter((a) => a["Invalid code typed"] && !a["Referral code"]).length, "Invalid code typed"]];
    const codes = new Map();
    for (const a of counted) if (a["Referral code"]) { const c = codes.get(a["Referral code"]) || { who: a["Code belongs to"], n: 0 }; c.n++; codes.set(a["Referral code"], c); }
    const shown = ref.show === "referred" ? all.filter((a) => a["Referred?"] === "yes") : all;
    const when = (v) => { const d = N.asDate(v); return d ? d.toLocaleString("en-GB", { timeZone: UK, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : v; };
    const appt = (a) => {
      const refd = a["Referral code"] ? `Code ${a["Referral code"]}${a["Code belongs to"] ? ` (${a["Code belongs to"]})` : ""}` : a["Invalid code typed"] ? `Invalid code: ${a["Invalid code typed"]}` : "";
      const answer = a["Referred?"] === "yes" ? "Referred: yes" : a["Referred?"] === "no" ? "Referred: no" : "Referred: not answered";
      return row({ lead: undefined, icon: a.Status === "canceled" ? "trash" : "calendar", title: [a["First name"], a["Last name"]].filter(Boolean).join(" ") || a.Email || "Someone", text: [when(a["Appointment date"]), a.Session, a.Status === "canceled" ? "Cancelled" : "Booked"].filter(Boolean).join(" · "), html: `<span>${esc([answer, refd, a["Referred by (typed)"] ? `Referred by ${a["Referred by (typed)"]}` : "", a["Referral source"]].filter(Boolean).join(" · "))}</span>${a.Email ? `<span>${esc(a.Email)}</span>` : ""}` });
    };
    box.innerHTML = `<div class="admin-place page-in">
      <div class="sums admin-sums">${totals.map(([n, l]) => `<div class="sum"><b>${n}</b><span>${esc(l)}</span></div>`).join("")}</div>
      <p class="muted small admin-hint">Counts leave out cancelled appointments.</p>
      <div class="btns two"><button type="button" class="btn main" data-code>${icon("plus")} Add a code</button><a class="btn" href="/admin/report.csv" download>${icon("pdf")} Download CSV</a></div>
      <h3 class="h">Codes used · ${codes.size}</h3>${codes.size ? list([...codes].sort((a, b) => b[1].n - a[1].n).map(([c, x]) => row({ icon: "star", title: c, text: x.who || "", end: esc(plural(x.n, "booking")) }))) : empty({ icon: "star", title: "No codes used yet", text: "Codes show here once someone books with one." })}
      <h3 class="h">Appointments</h3>
      <div class="seg" role="tablist"><button type="button" role="tab" class="seg-a" data-show="all" aria-selected="${ref.show === "all"}">All · ${all.length}</button><button type="button" role="tab" class="seg-a" data-show="referred" aria-selected="${ref.show === "referred"}">Referred only · ${all.filter((a) => a["Referred?"] === "yes").length}</button></div>
      ${shown.length ? list(shown.slice(0, ref.count).map(appt)) : empty({ icon: "calendar", title: "No appointments yet", text: "They appear here as bookings come in." })}
      ${shown.length > ref.count ? `<button type="button" class="btn wide" data-more>Show ${Math.min(30, shown.length - ref.count)} more (${shown.length - ref.count} left)</button>` : ""}
    </div>`;
    box.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { ref.show = b.dataset.show; ref.count = 30; N.show(); }));
    box.querySelector("[data-more]")?.addEventListener("click", () => { ref.count += 30; N.show(); });
    box.querySelector("[data-code]").addEventListener("click", addCode);
  }
  // A form sent the way Nova Bot's admin page sends it; Nova Bot says how it went in the address it answers with
  async function adminForm(path, values) {
    let res;
    try { res = await fetch(path, { method: "POST", credentials: "same-origin", body: new URLSearchParams(values) }); } catch (e) { throw new Error("Couldn't reach Nova"); }
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error("Sign in as an admin first"), { status: res.status });
    if (!res.ok) throw new Error(`That didn't work (error ${res.status})`);
    try { return new URL(res.url).searchParams.get("msg") || ""; } catch (e) { return ""; }
  }
  async function addCode() {
    const said = await sheetForm(`<h2 class="sheet-title">Add a referral code</h2><form class="form" data-f novalidate>
        ${field({ label: "Code", name: "code", placeholder: "e.g. JAMES10", hint: "3 to 32 letters, numbers or dashes.", attrs: 'maxlength="32" autocapitalize="characters" spellcheck="false" autocomplete="off"' })}
        ${field({ label: "Belongs to", name: "referrer", placeholder: "e.g. James Smith", attrs: 'maxlength="100" autocomplete="off"' })}
        ${field({ label: "Note (optional)", name: "note", attrs: 'maxlength="200" autocomplete="off"' })}
        <p class="form-said bad" data-err role="alert"></p><div class="btns"><button class="btn main wide" type="submit">Add code</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]"), err = el.querySelector("[data-err]");
        el.querySelector("[data-no]").onclick = () => done(null);
        f.onsubmit = async (e) => {
          e.preventDefault();
          const x = f.elements, code = x.code.value.trim().toUpperCase();
          if (!/^[A-Z0-9-]{3,32}$/.test(code)) { err.textContent = "Codes need 3 to 32 letters, numbers or dashes."; return x.code.focus(); }
          if (!x.referrer.value.trim()) { err.textContent = "Add who the code belongs to."; return x.referrer.focus(); }
          err.textContent = "";
          try {
            const msg = await busy(f.querySelector("[type=submit]"), "Adding…", () => adminForm("/admin/codes", { code, referrer: x.referrer.value.trim(), note: x.note.value.trim() }));
            if (msg && !/^Added /.test(msg)) { err.textContent = msg; return; }
            done(msg || `Added ${code}.`);
          } catch (x2) { err.textContent = x2.message; }
        };
      });
    if (said) toast(`${said} Customers can use it when they book.`);
  }

  // ---- Links: every Nova address, what kind it is, and whether it answers right now; admins edit the list ----
  const KIND = { live: "Live", machine: "Used by the apps", testing: "Testing", local: "Studio computer", planned: "Not set up yet" };
  let linksData = null;
  async function drawLinks(box, ui) {
    ui.back("#admin");
    ui.title("Links");
    const r = await asAdmin(box, api(`${A}links`));
    if (!r) return;
    const [d] = r.rest;
    if (d instanceof Error) throw d;
    linksData = d;
    ui.action({ icon: "refresh", label: "Check every address again", run: () => N.show() });
    const groups = d.groups || [];
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const down = groups.reduce((n, g) => n + g.items.filter((i) => i.check?.state === "down").length, 0);
    const mark = (s) => (s === "up" ? "● " : s === "down" ? "✕ " : "○ ");
    box.innerHTML = `<div class="admin-place page-in">
      <div class="card"><p class="kicker">Checked ${esc(ukWhen(d.checkedAt) || "just now")}</p><h2 class="card-title admin-big">${total} addresses, ${down ? `<span class="bad">${down} not answering</span>` : "all answering"}</h2>
        <p class="muted small">Every Nova Agent address in one place: what's live, what the apps use behind the scenes, what's for testing, and what only works on the studio computer.</p></div>
      ${groups.map((g, gi) => `<h3 class="h">${esc(g.title)}</h3>${g.note ? `<p class="muted small admin-hint">${esc(g.note)}</p>` : ""}
        <ul class="list">${g.items.map((i, ii) => `<li class="admin-link" data-s="${esc(i.check?.state || "unchecked")}"><div class="admin-link-main"><b>${esc(i.name)}</b>${i.note ? `<span class="muted small">${esc(i.note)}</span>` : ""}
            ${/^https?:/.test(i.url) && i.kind !== "machine" ? `<a class="admin-url" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.url)}</a>` : `<code class="admin-url">${esc(i.url)}</code>`}
            <span class="small"><span class="pill">${esc(KIND[i.kind] || i.kind)}</span> <span class="admin-state">${mark(i.check?.state)}${esc(i.check?.label || "")}</span></span></div>
            <button type="button" class="btn quiet admin-edit" data-edit="${gi}.${ii}" aria-label="Change ${esc(i.name)}">${icon("edit")}</button></li>`).join("")}</ul>
        <div class="btns two"><button type="button" class="btn" data-add="${gi}">${icon("plus")} Add a link</button><button type="button" class="btn quiet" data-group="${gi}">${icon("edit")} The group</button></div>`).join("")}
      ${!groups.length ? empty({ icon: "share", title: "The list is empty" }) : ""}
      <button type="button" class="btn wide" data-group="new">${icon("plus")} A new group</button>
      <p class="muted small admin-hint">The list is kept in the database, not in the code (the code is public). Saving keeps everything else in it (the features and What's changed) as it is.</p>
    </div>`;
    box.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => { const [gi, ii] = b.dataset.edit.split(".").map(Number); editLink(gi, ii); }));
    box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => editLink(Number(b.dataset.add), -1)));
    box.querySelectorAll("[data-group]").forEach((b) => b.addEventListener("click", () => editGroup(b.dataset.group === "new" ? -1 : Number(b.dataset.group))));
  }
  // The whole list as Nova Bot keeps it (without the checks), changed by `change`, and saved
  async function saveLinks(change, words) {
    const raw = { groups: (linksData.groups || []).map((g) => ({ title: g.title, note: g.note || "", items: g.items.map((i) => ({ name: i.name, url: i.url, kind: i.kind, note: i.note || "" })) })), features: linksData.features || [], changelog: linksData.changelog || [] };
    change(raw);
    const msg = await adminForm("/admin/links", { json: JSON.stringify(raw) });
    if (msg && !/^Saved/.test(msg)) throw new Error(msg);
    toast(words || msg || "Saved");
    N.show();
  }
  const linkSheet = (title, inner, ok, onDelete, run) => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f novalidate>${inner}<p class="form-said bad" data-err role="alert"></p><div class="btns"><button class="btn main wide" type="submit">${esc(ok)}</button>${onDelete ? `<button type="button" class="btn danger wide" data-del>${icon("trash")} ${esc(onDelete)}</button>` : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => {
      const f = el.querySelector("[data-f]"), err = el.querySelector("[data-err]");
      el.querySelector("[data-no]").onclick = () => done(null);
      const go = async (btn, del) => { err.textContent = ""; try { await busy(btn, "Saving…", () => run(f.elements, del, (t, input) => { throw Object.assign(new Error(t), { input }); })); done(true); } catch (x) { err.textContent = x.message; x.input?.focus(); } };
      f.onsubmit = (e) => { e.preventDefault(); go(f.querySelector("[type=submit]"), false); };
      el.querySelector("[data-del]")?.addEventListener("click", (e) => go(e.currentTarget, true));
    });
  function editLink(gi, ii) {
    const g = linksData.groups[gi], it = ii >= 0 ? g.items[ii] : { name: "", url: "https://", kind: "live", note: "" };
    return linkSheet(ii >= 0 ? `Change “${it.name}”` : `A new link in ${g.title}`, `${field({ label: "What it is", name: "name", value: it.name, attrs: 'maxlength="120" autocomplete="off"' })}
      ${field({ label: "Address", name: "url", value: it.url, hint: "A web address (https://…), or a command (wrangler, npm, npx).", attrs: 'maxlength="600" inputmode="url" spellcheck="false" autocapitalize="off" autocomplete="off"' })}
      ${field({ label: "Kind", name: "kind", type: "select", value: it.kind, options: Object.entries(KIND) })}
      ${field({ label: "Note (optional)", name: "note", value: it.note, attrs: 'maxlength="300" autocomplete="off"' })}`, ii >= 0 ? "Save" : "Add it", ii >= 0 ? "Remove this link" : "", async (x, del, stop) => {
      if (del) return saveLinks((raw) => raw.groups[gi].items.splice(ii, 1), `Removed “${it.name}”.`);
      const name = x.name.value.trim(), url = x.url.value.trim();
      if (!name) stop("Say what it is.", x.name);
      if (!/^(https?:\/\/\S+|wrangler |npm |npx )/.test(url)) stop("A web address (https://…) or a wrangler, npm or npx command.", x.url);
      const item = { name, url, kind: x.kind.value, note: x.note.value.trim() };
      return saveLinks((raw) => (ii >= 0 ? (raw.groups[gi].items[ii] = item) : raw.groups[gi].items.push(item)), ii >= 0 ? "Saved" : `Added “${name}”.`);
    });
  }
  function editGroup(gi) {
    const g = gi >= 0 ? linksData.groups[gi] : { title: "", note: "", items: [] };
    return linkSheet(gi >= 0 ? `The group “${g.title}”` : "A new group", `${field({ label: "Title", name: "title", value: g.title, attrs: 'maxlength="80" autocomplete="off"' })}${field({ label: "Note (optional)", name: "note", value: g.note, attrs: 'maxlength="300" autocomplete="off"' })}`, gi >= 0 ? "Save" : "Add the group", gi >= 0 ? `Remove the group and its ${plural(g.items.length, "link")}` : "", async (x, del, stop) => {
      // (the button itself says the links go too: no second sheet over this one)
      if (del) return saveLinks((raw) => raw.groups.splice(gi, 1), `Removed “${g.title}” and its ${plural(g.items.length, "link")}.`);
      const title = x.title.value.trim();
      if (!title) stop("A title, please.", x.title);
      return saveLinks((raw) => (gi >= 0 ? Object.assign(raw.groups[gi], { title, note: x.note.value.trim() }) : raw.groups.push({ title, note: x.note.value.trim(), items: [] })), "Saved");
    });
  }

  // ---- Test booking: a pretend booking through Acuity (what customers use today) or Nova's own system ----
  const TB = "/admin/test-booking/";
  const STEPS = [["slot", "Slot found"], ["booking", "Booking created"], ["payment", "Payment"], ["email", "Confirmation email"], ["calendar", "Calendar event"], ["alerts", "Alerts"]];
  const MARK = { pass: "✓", fail: "✗", skip: "–", waiting: "…" };
  const MARK_WORD = { pass: "passed", fail: "failed", skip: "skipped", waiting: "waiting" };
  const tb = { tab: "", nova: null, acuity: null, aProblem: "", nResult: null, aTest: null, aTimer: 0, nForm: {}, aForm: {}, removeMsg: "" };
  async function drawBooking(box, ui) {
    ui.back("#admin");
    ui.title("Test booking");
    const r = await asAdmin(box, api(`${TB}state`), api(`${TB}acuity/state`));
    if (!r) return;
    const [n, a] = r.rest;
    tb.me = r.me;
    tb.nova = n instanceof Error ? { problem: n.message } : n;
    tb.acuity = a instanceof Error ? null : a;
    tb.aProblem = a instanceof Error ? (/powerhouse|refused|\b40[13]\b/i.test(a.message) ? "This needs Acuity's Powerhouse plan (it includes Acuity's API), which this account doesn't have. Until then, to check real bookings work: book the cheapest session on the website yourself, check the phone alert and Portal's Calendar, then cancel and refund it in Acuity." : a.message) : "";
    const system = tb.nova?.facts?.system || tb.acuity?.system || "acuity";
    if (!tb.tab) tb.tab = system === "nova" ? "nova" : "acuity";
    // (a quiet slot about four weeks ahead, picked for you)
    if (tb.nova?.quiet && !tb.nForm.date) Object.assign(tb.nForm, { date: tb.nova.quiet.date, time: tb.nova.quiet.time });
    if (tb.acuity?.quiet && !tb.aForm.date) Object.assign(tb.aForm, { date: tb.acuity.quiet.date, time: tb.acuity.quiet.time });
    tb.nForm.session = tb.nForm.session || tb.nova?.session;
    tb.aForm.session = tb.aForm.session || tb.acuity?.session;
    live.booking = { box };
    const running = (tb.acuity?.tests || []).find((t) => !t.done);
    if (running) tb.aTest = running;
    await Promise.all([novaTimes(), acuityTimes()]);
    drawTb(true);
    if (tb.aTest && !tb.aTest.done) watchAcuity();
  }
  async function novaTimes() {
    const f = tb.nForm, ready = Boolean(tb.nova?.facts && (tb.nova.facts.sandbox || tb.nova.facts.google));
    tb.nTimes = { list: [], said: "" };
    if (!f.date || !ready) { tb.nTimes.said = ready ? "Pick a day" : "Google isn't connected"; return; }
    try {
      const d = await api(`${TB}times?session=${encodeURIComponent(f.session || "")}&date=${encodeURIComponent(f.date)}`);
      tb.nTimes.list = d.times || [];
      if (d.problem || !tb.nTimes.list.length) tb.nTimes.said = d.problem || "Nothing free that day";
      if (!tb.nTimes.list.includes(f.time)) f.time = tb.nTimes.list[tb.nTimes.list.length - 1] || "";
    } catch (err) { tb.nTimes.said = err.message; }
  }
  async function acuityTimes() {
    const f = tb.aForm;
    tb.aTimes = { list: [], said: "" };
    if (!tb.acuity || !f.date || !f.session) { tb.aTimes.said = "Pick a day"; return; }
    try {
      const d = await api(`${TB}acuity/times?session=${encodeURIComponent(f.session)}&date=${encodeURIComponent(f.date)}`);
      tb.aTimes.list = d.times || [];
      if (!tb.aTimes.list.length) tb.aTimes.said = "Nothing free that day";
      if (!tb.aTimes.list.some((t) => t.value === f.time)) f.time = tb.aTimes.list[tb.aTimes.list.length - 1]?.value || "";
    } catch (err) { tb.aTimes.said = err.message; }
  }
  const stepsHtml = (steps) => `<ol class="admin-steps">${steps.map((s) => `<li data-s="${esc(s.status)}"><span class="admin-mark" role="img" aria-label="${MARK_WORD[s.status] || "waiting"}">${MARK[s.status] || "…"}</span><b>${esc(s.label)}</b>${s.detail ? `<span>${esc(s.detail)}</span>` : ""}</li>`).join("")}</ol>`;
  const sessionField = (name, sessions, value) => field({ label: "Session", name, type: "select", value, options: (sessions || []).map((t) => [t.id, `${t.name} (${t.price})`]) });
  const timeField = (name, times, value, said) => field({ label: "Start (UK time)", name, type: "select", value, options: times.length ? times.map((t) => (typeof t === "string" ? [t, t] : [t.value, t.label])) : [["", said || "…"]] });
  // (first drawn off screen, inside the place's draw; after that only while it's on screen)
  function drawTb(first = false) {
    if (!live.booking || (!first && !live.booking.box.isConnected)) return;
    const { box } = live.booking;
    const nf = tb.nova?.facts || {}, system = nf.system || tb.acuity?.system || "acuity";
    const novaReady = Boolean(nf.sandbox || nf.google);
    const tab = (id, label) => `<button type="button" role="tab" class="seg-a" data-tab="${id}" aria-selected="${tb.tab === id}">${label}${system === id ? " · LIVE" : ""}</button>`;
    let html = `<div class="seg" role="tablist">${tab("acuity", "Acuity")}${tab("nova", "Nova's own")}</div>`;
    if (tb.tab === "acuity") {
      const a = tb.acuity, t = tb.aTest;
      html += `<div class="card"><p class="kicker">Acuity · what customers book with</p><p class="small">Makes a real booking in Acuity as staff, named “Nova TEST booking”: no payment, and Acuity emails nobody. Then it checks Nova Bot hears about it, the staff alert and Portal's Calendar, and cancels it in Acuity by itself (15 minutes at most). One at a time.</p>
        <p class="small${a ? "" : " warn"}">${esc(a ? (a.system === "nova" ? "Customers book with Nova's own system now, so Acuity isn't live." : `Customers book with Acuity now. Payment isn't part of this test: Acuity takes it on its own page.${a.feed ? "" : " (Acuity's calendar feed isn't set up, so the Calendar check is skipped.)"}`) : tb.aProblem || "Checking Acuity…")}</p></div>`;
      if (a) {
        html += `<form class="form" data-aform novalidate>${sessionField("session", a.sessions, tb.aForm.session)}<div class="two-up">${field({ label: "Day", name: "date", type: "date", value: tb.aForm.date || "" })}${timeField("time", tb.aTimes.list, tb.aForm.time, tb.aTimes.said)}</div>
          <p class="muted small">${a.quiet ? "A quiet time about four weeks ahead is picked for you; change it if you like." : "Couldn't find a free time in the next few weeks: pick a day."}</p>
          <label class="switch"><span>Send the alert to my own phones <small class="muted">(nobody else's)</small></span><input type="checkbox" role="switch" name="alert"${tb.aForm.alert ? " checked" : ""}></label>
          <p class="muted small">While it runs, that time is taken in Acuity, so a customer can't book it for those few minutes. If Acuity is set to email the studio about new bookings, that email still comes.</p>
          <p class="form-said bad" data-err role="alert"></p><button class="btn main wide" type="submit"${t && !t.done ? " disabled" : ""}>Run Acuity test booking</button></form>`;
        if (t) html += `<h3 class="h">Result · ${t.done ? (t.ok ? '<span class="ok">passed</span>' : '<span class="bad">something needs a look</span>') : "running…"}</h3>${stepsHtml(t.steps || [])}${!t.cancelled && !t.done ? '<button type="button" class="btn wide" data-acancel>Cancel it now</button>' : ""}${t.alert ? `<div class="card"><p class="kicker">Alert (preview)</p><p class="pre small"><b>${esc(t.alert.title)}</b>\n\n${esc(t.alert.body)}</p></div>` : ""}`;
        const past = (a.tests || []).filter((x) => x.done && x.id !== t?.id);
        if (past.length) html += `<h3 class="h">Earlier Acuity tests today</h3>${list(past.map((x) => row({ icon: x.ok ? "check" : "refresh", title: `#${x.id} · ${x.session}`, text: [x.when, x.ok ? "passed" : "needed a look", x.cancelled ? "cancelled" : ""].filter(Boolean).join(" · ") })))}`;
      }
    } else {
      const n = tb.nova, res = tb.nResult;
      const fake = nf.stripe === "test" ? "Stripe's test mode and test card: no real money" : nf.stripe === "live-only" ? "Only a live Stripe key is set, so Stripe won't be contacted: the payment is simulated" : "No Stripe test key, so Stripe won't be contacted: the payment is simulated";
      html += `<div class="card"><p class="kicker">Nova's own booking system · Google Calendar, Gmail and Stripe</p><p class="small">Check the booking flow still works, end to end, without anyone paying. A test booking is marked TEST everywhere, uses made-up details, never emails or alerts a client or other staff, isn't counted, doesn't block customers' times unless you choose, and removes itself after 24 hours.</p>
        <p class="small${n.problem || !novaReady ? " warn" : ""}">${esc(n.problem || `${nf.system === "nova" ? "This is the live booking system. " : "Not live yet: customers book with Acuity (test that under Acuity). "}${nf.sandbox ? "Sandbox: Google and email work offline. " : nf.google ? "" : "Google isn't connected, so this test can't run yet (Admin → Google). "}Up to ${nf.max ?? "a few"} test bookings at once.`)}</p></div>`;
      if (!n.problem) {
        html += `<form class="form" data-nform novalidate>${sessionField("session", n.sessions, tb.nForm.session)}<div class="two-up">${field({ label: "Day", name: "date", type: "date", value: tb.nForm.date || "" })}${timeField("time", tb.nTimes.list, tb.nForm.time, tb.nTimes.said)}</div>
          <p class="muted small">${n.quiet ? "A quiet slot about four weeks ahead is picked for you; change it if you like." : novaReady ? "Couldn't find a quiet slot: pick a day." : ""}</p>
          ${choices({ label: "Payment", name: "payment", value: tb.nForm.payment || "skip", options: [["skip", "Skip payment"], ["fake", "Fake a payment"]] })}
          <p class="muted small">${(tb.nForm.payment || "skip") === "skip" ? "Recorded as “payment bypassed: test”; Stripe isn't contacted." : esc(fake)}</p>
          <label class="switch"><span>Email the confirmation to me too <small class="muted">(only to you: ${esc(tb.me?.email || "")})</small></span><input type="checkbox" role="switch" name="email"${tb.nForm.email ? " checked" : ""}></label>
          <label class="switch"><span>Send the alert to my own phones <small class="muted">(nobody else's)</small></span><input type="checkbox" role="switch" name="alert"${tb.nForm.alert ? " checked" : ""}></label>
          <label class="switch"><span>Let it block the time for customers <small class="muted">(off: customers can still book it)</small></span><input type="checkbox" role="switch" name="block"${tb.nForm.block ? " checked" : ""}></label>
          <button class="btn main wide" type="submit"${novaReady ? "" : " disabled"}>Run test booking</button>${novaReady ? "" : '<p class="small warn">Connect Google first (Admin → Google).</p>'}</form>`;
        if (res) html += `<h3 class="h">Result · ${res.running ? "running…" : res.ok ? '<span class="ok">passed</span>' : '<span class="bad">failed</span>'}</h3>${stepsHtml(res.steps)}
          ${res.email ? `<div class="card"><p class="kicker">Confirmation email (preview)</p><p><b>${esc(res.email.subject || "")}</b></p><p class="muted small">${esc(res.email.to ? `Sent to ${res.email.to} only` : "Not sent")}</p><button type="button" class="btn wide" data-email>Read the email</button></div>` : ""}
          ${res.alert ? `<div class="card"><p class="kicker">Alert (preview)</p><p class="pre small"><b>${esc(res.alert.title)}</b>\n\n${esc(res.alert.body)}</p></div>` : ""}`;
        const bookings = res?.bookings || n.bookings || [];
        html += `<h3 class="h">Test bookings · ${bookings.length}</h3>${bookings.length ? list(bookings.map((b) => row({ icon: "calendar", title: `TEST #${b.id}${b.status && b.status !== "booked" ? ` (${b.status})` : ""} · ${b.when}`, text: [b.session, `Paid: ${b.paid}`, b.blocks ? "Blocks customers" : "Doesn't block customers", b.created_uk ? `Made ${b.created_uk}` : ""].filter(Boolean).join(" · ") }))) : empty({ icon: "calendar", title: "None", text: "Test bookings you run show here, and remove themselves after 24 hours." })}
          ${bookings.length ? '<button type="button" class="btn danger wide" data-remove>Remove all test bookings</button><p class="muted small">Removes each one, its calendar event, its payment record, its emails and its alerts.</p>' : ""}${tb.removeMsg ? `<p class="small" role="status">${esc(tb.removeMsg)}</p>` : ""}`;
      }
    }
    box.innerHTML = `<div class="admin-place page-in">${html}</div>`;
    wireTb(box);
  }
  function wireTb(box) {
    box.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { tb.tab = b.dataset.tab; drawTb(); }));
    const af = box.querySelector("[data-aform]"), nf = box.querySelector("[data-nform]");
    const keep = (form, into) => { const x = form.elements; into.session = x.session.value; into.date = x.date.value; into.time = x.time.value; if (x.alert) into.alert = x.alert.checked; if (x.email) into.email = x.email.checked; if (x.block) into.block = x.block.checked; if (x.payment) into.payment = x.payment.value || "skip"; };
    af?.addEventListener("change", async (e) => {
      const was = { ...tb.aForm };
      keep(af, tb.aForm);
      if (e.target.name === "session" || e.target.name === "date") {
        if (e.target.name === "session") { try { tb.acuity = await api(`${TB}acuity/state?session=${encodeURIComponent(tb.aForm.session)}`); if (tb.acuity.quiet) Object.assign(tb.aForm, { date: tb.acuity.quiet.date, time: tb.acuity.quiet.time }); } catch (err) { toast(err.message, true); } }
        if (was.date !== tb.aForm.date || was.session !== tb.aForm.session) { await acuityTimes(); drawTb(); }
      }
    });
    nf?.addEventListener("change", async (e) => {
      keep(nf, tb.nForm);
      if (e.target.name === "session") { try { tb.nova = await api(`${TB}state?session=${encodeURIComponent(tb.nForm.session)}`); if (tb.nova.quiet) Object.assign(tb.nForm, { date: tb.nova.quiet.date, time: tb.nova.quiet.time }); } catch (err) { toast(err.message, true); } }
      if (e.target.name === "session" || e.target.name === "date") await novaTimes();
      if (["session", "date", "payment"].includes(e.target.name)) drawTb();
    });
    af?.addEventListener("submit", async (e) => {
      e.preventDefault();
      keep(af, tb.aForm);
      const err = af.querySelector("[data-err]");
      if (!tb.aForm.time) { err.textContent = "Pick a start time first."; return; }
      err.textContent = "";
      tb.aTest = { steps: [{ label: "Booking in Acuity and waiting for it to tell Nova Bot (up to half a minute)…", status: "waiting" }] };
      await busy(af.querySelector("[type=submit]"), "Booking in Acuity…", async () => {
        try { tb.aTest = (await post(`${TB}acuity/run`, { session: Number(tb.aForm.session), datetime: tb.aForm.time, alertMe: Boolean(tb.aForm.alert) })).test; } catch (x) { tb.aTest = x.data?.test || { done: true, ok: false, steps: [{ label: "Couldn't run it", status: "fail", detail: x.message }] }; }
      });
      drawTb();
      if (!tb.aTest.done) watchAcuity();
    });
    box.querySelector("[data-acancel]")?.addEventListener("click", (e) => busy(e.currentTarget, "Cancelling…", async () => {
      try { tb.aTest = (await post(`${TB}acuity/cancel`, { id: tb.aTest.id })).test; } catch (err) { toast(err.message, true); }
      drawTb();
    }));
    nf?.addEventListener("submit", async (e) => {
      e.preventDefault();
      keep(nf, tb.nForm);
      tb.nResult = { running: true, steps: STEPS.map(([key, label]) => ({ key, label, status: "waiting" })) };
      drawTb();
      const f = tb.nForm;
      try { tb.nResult = await post(`${TB}run`, { session: Number(f.session), date: f.date, time: f.time, payment: f.payment === "fake" ? "fake" : "skip", emailMe: Boolean(f.email), alertMe: Boolean(f.alert), blockSlot: Boolean(f.block) }); if (tb.nResult.bookings) tb.nova.bookings = tb.nResult.bookings; } catch (x) { tb.nResult = { ok: false, steps: [{ key: "error", label: "Couldn't run it", status: "fail", detail: x.message }] }; }
      await novaTimes();
      drawTb();
    });
    box.querySelector("[data-email]")?.addEventListener("click", () => {
      const m = tb.nResult?.email;
      if (!m) return;
      // (the email's words, read safely: drawn as text, never as the email's own page)
      const text = new DOMParser().parseFromString(m.html || "", "text/html").body.innerText || new DOMParser().parseFromString(m.html || "", "text/html").body.textContent || "";
      sheetForm(`<p class="kicker">Confirmation email (preview)</p><h2 class="sheet-title">${esc(m.subject || "")}</h2><p class="muted small">${esc(m.to ? `Sent to ${m.to} only` : "Not sent")}</p><p class="pre small admin-mail">${esc(text.replace(/\n{3,}/g, "\n\n").trim())}</p><div class="btns"><button type="button" class="btn quiet wide" data-no>Close</button></div>`, (el, done) => { el.querySelector("[data-no]").onclick = () => done(null); });
    });
    box.querySelector("[data-remove]")?.addEventListener("click", async (e) => {
      if (!(await confirm({ title: "Remove every test booking?", text: "With their calendar events. Real bookings aren't touched.", ok: "Remove them", danger: true }))) return;
      await busy(e.target.closest("button"), "Removing…", async () => {
        try {
          const out = await post(`${TB}remove`, {});
          tb.removeMsg = `${out.removed === 1 ? "Removed 1 test booking." : `Removed ${out.removed} test bookings.`}${(out.kept || []).length ? ` Couldn't remove ${out.kept.map((k) => `#${k.id}: ${k.why}`).join("; ")}. Try again in a minute.` : ""}`;
          tb.nova.bookings = out.bookings || [];
          if (tb.nResult) tb.nResult.bookings = tb.nova.bookings;
        } catch (err) { tb.removeMsg = err.message; }
      });
      await novaTimes();
      drawTb();
    });
  }
  // A running Acuity test: looked at every few seconds while it's on screen (Nova Bot finishes it either way)
  async function watchAcuity() {
    if (tb.watching) return;
    tb.watching = true;
    while (tb.aTest && !tb.aTest.done && tb.aTest.id) {
      await wait(4000);
      if (!onScreen("admin") || !live.booking?.box.isConnected) break;
      try { tb.aTest = (await post(`${TB}acuity/check`, { id: tb.aTest.id })).test; } catch (err) { await wait(8000); }
      drawTb();
    }
    tb.watching = false;
    if (tb.aTest?.done && live.booking?.box.isConnected) { await acuityTimes(); drawTb(); }
  }
})();
