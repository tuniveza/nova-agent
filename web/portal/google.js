// Portal → Admin → Google (admins): connect the studio's Google account, one step at a time, and
// choose what's kept in step (Nova Bot's src/google/: GET /app/api/google says it all).
//
// Not connected: the steps, one at a time: a sentence, a button that opens the right Google page,
// Copy buttons for exactly what to paste, the key's two boxes, then "Connect Google" (Google's
// page opens in a small window; this page notices when it's done).
// Connected: who as, then each part with a switch, how it last went (in words) and "Sync now";
// links to the Nova Agent folder in Drive and the Money sheet; "Connect again" when a permission
// is missing; Disconnect (two presses).
// Everything is plain buttons and text (nothing from the server is drawn as HTML), big tap
// targets, keyboard, and words not colours.

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp && window.PortalApp.kit;
  const isAdmin = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());

  let data = null;
  let step = null; // the step showing (null: the first one not done)
  let showSteps = false; // connected, but the steps opened again
  let disarm = 0;
  const busy = new Set();
  const SYNCABLE = { calendar: "calendar", replies: "replies", contacts: "contacts", sheets: "sheets", backups: "backups", inbox: "inbox", docs: "docs", files: "files" };

  const el = (tag, cls, text) => K().el(tag, cls, text);
  function button(text, cls, onClick, extra = {}) {
    const b = el("button", cls || "btn", text);
    b.type = "button";
    Object.assign(b, extra);
    b.addEventListener("click", onClick);
    return b;
  }
  const ago = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} h ago` : K().when(iso);
  };

  async function load() {
    if (!K() || !K().running || !isAdmin()) return;
    const box = $("google-body");
    try {
      data = await K().api("google");
    } catch (err) {
      if (err.message !== "signed out" && box) K().emptyState(box, err.status === 404 ? "Google isn't switched on yet: Nova Bot needs its update." : "Couldn't load Google: " + err.message);
      return;
    }
    draw();
  }

  // ===== Drawing =====

  function draw() {
    const box = $("google-body");
    if (!box || !data) return;
    box.replaceChildren();
    box.append(statusCard());
    if (!data.connected || showSteps) box.append(stepsCard());
    if (data.connected) box.append(partsCard(), linksCard());
  }

  function statusCard() {
    const card = el("div", "card gg-status");
    const line = el("p", "gg-big");
    line.id = "google-status";
    line.tabIndex = -1;
    if (data.sandbox) line.textContent = "Test copy of Nova Bot: Google is stood in for here.";
    else if (data.connected) line.textContent = `Connected as ${data.account} ✓`;
    else if (data.hasKey) line.textContent = "Key saved ✓ · One step left: Connect Google.";
    else line.textContent = "Not set up yet. It takes about 5 minutes, one step at a time.";
    card.append(line);
    // Google turned the saved connection down: nothing syncs until someone connects again
    if (data.connected && data.needsReconnect) {
      const warn = el("p", "gg-missing gg-problem", "Google stopped Nova Agent's connection, so nothing is syncing. Press Connect again (about a minute).");
      warn.setAttribute("role", "status");
      card.append(warn, button("Connect again", "btn big", connect));
    }
    if (data.connected && data.missing.length) {
      const miss = el("p", "gg-missing", `Connect again to switch on: ${data.missing.join(", ")}.`);
      card.append(miss, button("Connect again", "btn", connect));
    }
    if (data.connected) {
      const row = el("div", "gg-row");
      // (shown: the steps come into sight, their title focused, so a page turns to them if they're on the next
      // one; before, the press only changed this button's words, 25 Oct 2026)
      row.append(button(showSteps ? "Hide the setup steps" : "Show the setup steps", "chip", () => { showSteps = !showSteps; draw(); if (showSteps) focusStep(); }));
      const off = button(disarm ? "Press again to disconnect" : "Disconnect", disarm ? "btn danger" : "btn ghost", disconnect);
      off.setAttribute("aria-live", "polite");
      row.append(off);
      card.append(row);
    }
    return card;
  }

  // ---- The steps ----

  function firstUndone() {
    if (!data.hasKey) return 0;
    return data.steps.length - 1;
  }

  function stepsCard() {
    const steps = data.steps;
    if (step === null || step >= steps.length) step = firstUndone();
    const s = steps[step];
    const card = el("div", "card gg-steps");
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "Setting up Google");
    const progress = el("p", "kicker", `Step ${step + 1} of ${steps.length}`);
    const title = el("h3", "gg-step-title", s.title);
    title.tabIndex = -1;
    title.id = "google-step-title";
    card.append(progress, title, el("p", "gg-text", s.text));
    if (s.open) {
      const a = el("a", "btn", `${s.open.label} ↗`);
      a.href = s.open.href;
      a.target = "_blank";
      a.rel = "noopener";
      card.append(a);
    }
    for (const value of s.copy || []) card.append(copyRow(value));
    if (s.key) card.append(data.hasKey ? keySaved() : keyForm());
    if (s.connect) {
      const p = el("p", "gg-text", data.connected ? `Connected as ${data.account} ✓` : "");
      if (p.textContent) card.append(p);
      // No key saved yet: Connect can't work, so the key's boxes come here too (not a dead button)
      if (!data.hasKey && !s.key) card.append(el("p", "gg-text gg-need", "First paste the key from Google (Client ID and Client secret) and press Save. Then Connect Google lights up."), keyForm());
      card.append(button(data.connected ? "Connect again" : "Connect Google", "btn big", connect, { disabled: !data.hasKey }));
    }
    const nav = el("div", "gg-nav");
    nav.append(
      button("Back", "btn ghost", () => { step = Math.max(0, step - 1); draw(); focusStep(); }, { disabled: step === 0 }),
      button("Next", "btn", () => { step = Math.min(steps.length - 1, step + 1); draw(); focusStep(); }, { hidden: step === steps.length - 1 })
    );
    card.append(nav);
    return card;
  }
  const focusStep = () => requestAnimationFrame(() => $("google-step-title") && $("google-step-title").focus({ preventScroll: true }));

  function copyRow(value) {
    const row = el("div", "gg-copy");
    const code = el("code", "", value);
    const b = button("Copy", "btn ghost small", async () => {
      try {
        await navigator.clipboard.writeText(value);
        b.textContent = "Copied ✓";
      } catch (err) {
        b.textContent = "Select and copy";
      }
      setTimeout(() => (b.textContent = "Copy"), 1600);
    });
    b.setAttribute("aria-label", `Copy ${value}`);
    row.append(code, b);
    return row;
  }

  function keySaved() {
    const wrap = el("div", "gg-row");
    wrap.append(el("p", "gg-text", `Key saved ✓ (${data.keyShort}${data.keyFrom === "secrets" ? ", from Nova Bot's secrets" : ""})`));
    if (data.keyFrom === "app") {
      let armed = false;
      const b = button("Remove the key", "btn ghost small", async () => {
        if (!armed) {
          armed = true;
          b.textContent = "Press again to remove it";
          setTimeout(() => { armed = false; b.textContent = "Remove the key"; }, 4000);
          return;
        }
        await act("google/key/remove", {}, "The key is removed.");
      });
      wrap.append(b);
    }
    return wrap;
  }

  function keyForm() {
    const form = el("form", "gg-key");
    form.autocomplete = "off";
    const field = (label, name, type, placeholder) => {
      const l = el("label", "", label);
      const i = el("input");
      i.name = name;
      i.type = type;
      i.required = true;
      i.spellcheck = false;
      i.placeholder = placeholder;
      i.autocomplete = "off";
      l.append(i);
      return l;
    };
    const save = el("button", "btn", "Save");
    save.type = "submit";
    form.append(field("Client ID", "clientId", "text", "….apps.googleusercontent.com"), field("Client secret", "clientSecret", "password", "GOCSPX-…"), save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      save.disabled = true;
      await act("google/key", { clientId: String(f.get("clientId") || "").trim(), clientSecret: String(f.get("clientSecret") || "").trim() }, "Saved ✓ Now press Connect Google.");
      save.disabled = false;
      step = data && data.hasKey ? data.steps.length - 1 : step;
      draw();
    });
    return form;
  }

  // ---- What's kept in step ----

  function partsCard() {
    const card = el("div", "card gg-parts");
    card.append(el("h3", "gg-h", "What's kept in step"));
    const list = el("ul", "gg-list");
    for (const p of data.parts) {
      const li = el("li", "gg-part");
      const label = el("label", "gg-switch");
      const box = el("input");
      box.type = "checkbox";
      box.setAttribute("role", "switch");
      box.checked = p.on;
      box.disabled = !p.allowed;
      box.addEventListener("change", () => act("google/options", { changes: { [p.id]: box.checked } }, `${p.label}: ${box.checked ? "on" : "off"}`));
      label.append(box, el("span", "gg-label", p.label));
      li.append(label, el("p", "gg-help", p.allowed ? p.help : `${p.help} (Needs Connect again: Google hasn't given this permission.)`));
      const st = data.status[SYNCABLE[p.id]] || (p.id === "bookings" || p.id === "calendarPlan" ? null : data.status[p.id]);
      if (st && p.on) {
        const text = st.running ? "Syncing now…" : st.ok ? `${st.note} · ${ago(st.at)}` : `Last try ${ago(st.at)}: ${st.note}`;
        const note = el("p", st.ok || st.running ? "gg-note" : "gg-note gg-problem", text);
        if (st.running) note.setAttribute("aria-live", "polite");
        li.append(note);
      }
      if (SYNCABLE[p.id] && p.on && p.allowed) {
        const key = SYNCABLE[p.id];
        const b = button(busy.has(key) ? "Working…" : "Sync now", "chip", () => syncNow(key, b), { disabled: busy.has(key) });
        b.setAttribute("aria-label", `Sync ${p.label} now`);
        li.append(b);
      }
      list.append(li);
    }
    card.append(list);
    return card;
  }

  function linksCard() {
    const card = el("div", "card gg-links");
    const add = (href, text) => {
      if (!href) return;
      const a = el("a", "btn ghost", `${text} ↗`);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      card.append(a);
    };
    add(data.folderUrl, "The Nova Agent folder in Drive");
    add(data.sheetUrl, "The Money sheet");
    add("https://calendar.google.com/", "Google Calendar");
    add("https://contacts.google.com/", "Google Contacts");
    add("https://tasks.google.com/", "Google Tasks");
    add("https://studio.youtube.com/", "YouTube Studio");
    // Reviews (Google Business Profile) need Google's own say-so for its API first
    card.append(el("p", "gg-help gg-later", "Google reviews (Business Profile) can come later: Google first has to approve the studio for its Business Profile API (search \"Business Profile API access request\", fill in Google's form with project nova-agent). Then Nova can show and answer reviews here."));
    return card;
  }

  // ===== Doing =====

  async function act(path, body, done) {
    try {
      const res = await K().api(path, { body });
      K().toast(res.message || done);
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
    }
    await load();
  }

  // Sync now: Nova Bot starts it and answers straight away; this page then looks every few seconds
  // until the part says how it went (a minute at most)
  async function syncNow(key, b) {
    busy.add(key);
    b.disabled = true;
    b.textContent = "Working…";
    try {
      const res = await K().api("google/sync", { body: { part: key } });
      if (res.started) {
        await load();
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!K().running) break;
          await load();
          const st = data && data.status && data.status[key];
          if (st && !st.running) {
            K().toast(st.ok ? `Done: ${st.note}` : st.note);
            break;
          }
        }
      } else K().toast(res.note ? `Done: ${res.note}` : "Done");
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
    }
    busy.delete(key);
    await load();
  }

  async function disconnect() {
    if (!disarm) {
      disarm = setTimeout(() => { disarm = 0; draw(); }, 5000);
      draw();
      return;
    }
    clearTimeout(disarm);
    disarm = 0;
    await act("google/disconnect", {}, "Google disconnected. Nothing in Google was deleted.");
  }

  // Google's page can't open inside Nova Agent: its own small window (or, in the installed app,
  // the whole window), then back here. Nova Bot first gives a one-time pass (10 minutes), so
  // connecting works however you're signed in (the window to Google may not carry the sign-in).
  async function connect() {
    if (!data) return;
    const standalone = matchMedia("(display-mode: standalone)").matches;
    // Opened straight away (browsers only allow a new window right after the press), filled in below
    const w = standalone ? null : window.open("about:blank", "nova-google", "width=520,height=720");
    let link;
    try {
      link = await K().api("google/connect-link", { body: { popup: !standalone } });
    } catch (err) {
      if (w) w.close();
      if (err.message !== "signed out") K().toast(err.message);
      return;
    }
    // (no address back: say so, rather than sending the window to a page that isn't there)
    if (!link || !link.url) {
      if (w) w.close();
      K().toast(link && link.message ? link.message : "Google's page didn't open: Nova Bot gave no address. Press Check again, then try once more.");
      return;
    }
    if (standalone) {
      window.top.location.href = link.url;
      return;
    }
    if (w && !w.closed) {
      w.location.href = link.url;
      // When the window closes, look again (its "connected" message may not reach this page)
      const watch = setInterval(() => { if (w.closed) { clearInterval(watch); load(); } }, 1000);
      return;
    }
    // The browser blocked the window: a plain link to press instead
    K().toast("Your browser blocked the window. Use the Open Google link below.");
    const a = el("a", "btn big", "Open Google ↗");
    a.href = link.url;
    a.target = "_blank";
    a.rel = "opener";
    const box = document.querySelector(".gg-steps") || $("google-body");
    if (box) box.append(a);
  }
  addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "nova-google") {
      K() && K().toast(ev.data.ok ? "Google connected ✓" : "Google wasn't connected. Try again.");
      showSteps = false;
      load().then(() => $("google-status") && $("google-status").focus({ preventScroll: true }));
    }
  });
  const refresh = $("google-refresh");
  if (refresh) refresh.addEventListener("click", load);

  // ===== For Money and Notes: open the sheet, make a doc =====

  async function openSheet() {
    const w = window.open("about:blank", "_blank");
    try {
      const res = await K().api("google/sheet", { body: {} });
      if (w) w.location.href = res.url;
      else window.open(res.url, "_blank", "noopener");
    } catch (err) {
      if (w) w.close();
      if (err.message !== "signed out") K().toast(err.message);
    }
  }

  // ===== For Today: today's calendar (Nova's events and Google Calendar's) =====

  async function today() {
    const box = $("today-calendar");
    const wrap = $("today-calendar-wrap");
    if (!box || !wrap || !K()) return;
    let events = [];
    try {
      events = (await K().api("google/today")).events || [];
    } catch (err) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = !events.length;
    box.replaceChildren(
      ...events.map((e) => {
        const row = el("div", "card today-ev");
        row.append(el("span", "today-ev-time", e.allDay ? "All day" : `${e.start}–${e.end}`), el("span", "today-ev-title", e.title));
        const sub = [e.from === "Google Calendar" ? "Google Calendar" : "", e.location].filter(Boolean).join(" · ");
        if (sub) row.append(el("span", "today-ev-sub", sub));
        if (e.meetUrl) {
          const a = el("a", "chip", "Join on Meet ↗");
          a.href = e.meetUrl;
          a.target = "_blank";
          a.rel = "noopener";
          row.append(a);
        }
        return row;
      })
    );
  }

  // ===== Find someone in Google Contacts (Campaigns' one-to-one email form) =====
  // A search box at the top of the form: type a name, email or company, pick someone, and their
  // name and email are filled in. Hidden when Google Contacts isn't switched on.
  function contactPicker(form, fill) {
    if (!form || form.querySelector(".gg-find")) return;
    const wrap = el("div", "gg-find");
    const label = el("label", "cp-field");
    const input = el("input");
    input.type = "search";
    input.placeholder = "A name, email or company";
    input.autocomplete = "off";
    label.append(el("span", "", "Find in Google Contacts (optional)"), input);
    const list = el("div", "gg-find-list");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "People found in Google Contacts");
    wrap.append(label, list);
    form.querySelector(".card-title")?.after(wrap);
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) return list.replaceChildren();
      timer = setTimeout(async () => {
        let res;
        try {
          res = await K().api("google/contacts?q=" + encodeURIComponent(q));
        } catch (err) {
          return list.replaceChildren(el("p", "gg-help", err.message === "signed out" ? "" : "Google Contacts didn't answer just now."));
        }
        if (res.off) {
          wrap.hidden = true;
          return;
        }
        const found = (res.contacts || []).filter((c) => c.email);
        list.replaceChildren(
          ...(found.length
            ? found.map((c) => {
                const b = el("button", "chip gg-find-pick", c.name ? `${c.name} · ${c.email}` : c.email);
                b.type = "button";
                b.setAttribute("role", "option");
                b.addEventListener("click", () => {
                  fill(c);
                  list.replaceChildren();
                  input.value = "";
                  K().toast(`Filled in ${c.name || c.email}`);
                });
                return b;
              })
            : [el("p", "gg-help", "Nobody in Google Contacts matches that.")])
        );
      }, 300);
    });
  }
  const outreachForm = $("outreach-form");
  if (outreachForm) {
    contactPicker(outreachForm, (c) => {
      $("or-new-email").value = c.email || "";
      if (c.name) $("or-new-name").value = c.name;
    });
  }

  window.PortalGoogle = { load, openSheet, today, contactPicker };
})();
