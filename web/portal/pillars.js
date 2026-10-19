// Nova Pillars (19 Oct 2026): Portal's sections in place of the tab panel under the top panel. One
// cylindrical pillar per group: Inbox, Bookings, Clients & Money, Outreach, Plans & Nova, You, Look &
// sound, and Admin (admins only). A pillar is clickable: it rises (opens) to show its pillar buttons,
// bands round the column, each doing one real thing: a tab, a button pressed on its page, the
// Invoicer, a sheet. Nothing does a job by itself that its page would ask about first: it opens the
// place and presses the same button a person would. One pillar is open at a time (the one you're in,
// to start with); the others stand slim with the group's name as their title.
// The tab panel stays in the page, hidden: the pillar buttons press its buttons and read its counts.
// A clearly visible "Hide all" button (a crossed-out eye) folds them all away to one slim bar with
// "Show Nova Pillars"; remembered on this device.
// In Nova Agent's theme (its colours and fonts from /shared/themes.css); calm: a pillar opens with a
// short slide, and not at all with reduced motion.
(function () {
  "use strict";
  if (window.NovaPillars) return;
  const $ = (id) => document.getElementById(id);
  const admin = () => Boolean(window.PortalPage && window.PortalPage.isAdmin && window.PortalPage.isAdmin());
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "calm";

  // ---- Doing things: the same as a person would ----
  const shown = (el) => el && (typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null);
  // Wait for a part of a page to be there (a tab just opened draws its parts), then do something with it
  function when(sel, fn, ms = 4000) {
    const t0 = Date.now();
    (function look() {
      const el = typeof sel === "function" ? sel() : document.querySelector(sel);
      if (el && (shown(el) || Date.now() - t0 > 900)) return fn(el);
      if (Date.now() - t0 > ms) return say("That isn't here just now.");
      setTimeout(look, 80);
    })();
  }
  const say = (text) => (window.PortalApp && window.PortalApp.kit ? window.PortalApp.kit.toast(text) : console.log(text));
  const tab = (view) => () => {
    const t = view === "agent" ? $("nav-agent") : view === "booking" ? $("nav-booking-tools") : document.querySelector(`.tabs .tab[data-view="${view}"]`);
    if (t) t.click();
  };
  const go = (url) => () => window.PortalPage && window.PortalPage.go(url, { replace: true });
  const press = (view, sel) => () => {
    tab(view)();
    when(sel, (el) => el.click());
  };
  const show = (view, sel, focus) => () => {
    (view.startsWith("/") ? go(view) : tab(view))();
    when(sel, (el) => {
      el.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
      const f = focus ? document.querySelector(focus) : el;
      if (f && f.focus) f.focus({ preventScroll: true });
    });
  };
  const options = (heading) => () => {
    $("options-btn").click();
    when(() => [...document.querySelectorAll("#options-sheet .kicker")].find((k) => k.textContent.trim() === heading), (el) => el.scrollIntoView({ block: "start", behavior: calm() ? "auto" : "smooth" }));
  };
  const invoicer = (what) => () => window.NovaInvoicer && window.NovaInvoicer.open(what);

  // ---- The pillars and their buttons (8 or fewer each; admin: only for admins) ----
  // glyph: a small mark for each; badge: the tab's count shown on it; at: the tab it lights up for
  const GROUPS = [
    { name: "Inbox", glyph: "✉", badges: ["new-badge", "alert-badge"], items: [
      { name: "Today", glyph: "⌂", at: "today", run: tab("today") },
      { name: "Enquiries", glyph: "✉", badge: "new-badge", at: "enquiries", run: tab("enquiries") },
      { name: "Conversations", glyph: "❝", at: "chats", run: tab("chats") },
      { name: "Alerts", glyph: "◔", badge: "alert-badge", at: "alerts", run: tab("alerts") },
      { name: "Saved replies", glyph: "❏", run: press("enquiries", "#saved-open") },
      { name: "Website bot", glyph: "✦", at: "bot", run: tab("bot") },
      { name: "Notifications", glyph: "◉", run: press("alerts", "#alerts-notify") },
    ] },
    { name: "Bookings", glyph: "◷", badges: ["approvals-badge"], items: [
      { name: "Calendar", glyph: "▦", run: tab("calendar") },
      { name: "Booking tools", glyph: "◫", at: "calendar", run: tab("booking") },
      { name: "Approvals", glyph: "✓", badge: "approvals-badge", at: "approvals", run: tab("approvals") },
      { name: "Ask about this week", glyph: "✦", run: press("booking", "#view-calendar .smart-ask") },
      { name: "Booking link", glyph: "⛓", run: () => { tab("enquiries")(); say("Choose who it's for: Booking link is on their enquiry."); } },
      { name: "Test booking", glyph: "⚑", admin: true, run: go("/portal/?view=manage&page=test-booking") },
    ] },
    { name: "Clients & Money", glyph: "£", badges: ["money-badge"], items: [
      { name: "Clients", glyph: "☺", at: "clients", run: tab("clients") },
      { name: "Add a client", glyph: "+", run: press("clients", "#clients-add") },
      { name: "Sync with Acuity", glyph: "↻", admin: true, run: press("clients", "#clients-sync") },
      { name: "Import clients", glyph: "⇣", admin: true, run: press("clients", "#clients-import-open") },
      { name: "Money", glyph: "£", badge: "money-badge", at: "money", run: tab("money") },
      { name: "Write an invoice", glyph: "✎", run: invoicer({ new: true }) },
      { name: "Add an expense", glyph: "−", run: press("money", "#money-expense-new") },
      { name: "Overdue invoices", glyph: "!", run: invoicer({ filter: "overdue" }) },
    ] },
    { name: "Outreach", glyph: "➶", badges: ["campaigns-badge", "social-badge"], items: [
      { name: "Campaigns", glyph: "✉", badge: "campaigns-badge", at: "campaigns", run: tab("campaigns") },
      { name: "Write a campaign", glyph: "✎", run: press("campaigns", "#campaigns-new") },
      { name: "One-to-one email", glyph: "➝", run: press("campaigns", "#outreach-new") },
      { name: "Don't email again", glyph: "⊘", run: show("campaigns", "#outreach-optout", "#or-optout-email") },
      { name: "Social", glyph: "◈", badge: "social-badge", at: "social", run: tab("social") },
      { name: "Write a post", glyph: "✎", run: press("social", "#social-new") },
      { name: "Fan sign-up link", glyph: "⛓", run: show("campaigns", "#campaigns-signup") },
      { name: "Ads Manager", glyph: "↗", run: () => window.open("https://adsmanager.facebook.com/", "_blank", "noopener") },
    ] },
    { name: "Plans & Nova", glyph: "✧", badges: ["quest-badge"], items: [
      { name: "Quests", glyph: "✧", badge: "quest-badge", at: "quests", run: tab("quests") },
      { name: "Everyone's quests", glyph: "☷", admin: true, run: press("quests", '#quests-who [data-quests-who="everyone"]') },
      { name: "Nova Agent", glyph: "✦", run: tab("agent") },
      { name: "Ask Nova", glyph: "?", run: () => { tab("bot")(); when('#view-bot [data-mode="nova"]', (el) => { if (!el.classList.contains("active")) el.click(); if ($("bot-input")) $("bot-input").focus(); }); } },
      { name: "Voice", glyph: "◎", run: () => ($("voice") && !$("voice").hidden ? $("voice").click() : say("Voice isn't available here.")) },
      { name: "Hands-free", glyph: "◌", run: () => { $("voice-sheet").hidden = false; if ($("handsfree-switch")) $("handsfree-switch").focus(); } },
      { name: "My Index", glyph: "◍", run: show("/portal/?view=me", "#open-index") },
      { name: "Manual", glyph: "?", run: () => { const m = document.querySelector("nova-manual"); if (m && m.open) m.open(); } },
    ] },
    { name: "You", glyph: "◐", items: [
      { name: "Your profile", glyph: "◐", at: "me", run: go("/portal/?view=me") },
      { name: "Re-roll planet", glyph: "↻", run: show("/portal/?view=me", "#reroll") },
      { name: "Edit your name", glyph: "✎", run: press("you", "#edit-name") },
      { name: "Change email", glyph: "@", run: show("/portal/?view=me", "#email-card", "#email-new") },
      { name: "Change password", glyph: "⚿", run: show("/portal/?view=me", "#password-card", "#password-new") },
      { name: "All addresses", glyph: "⌘", run: show("/portal/?view=me", "#addresses-card") },
      { name: "How it works", glyph: "⚙", run: show("/portal/?view=me", "#group-tech-head") },
      { name: "Sign out", glyph: "⏻", run: show("/portal/?view=me", "#signout-card", "#sign-out") },
    ] },
    { name: "Look & sound", glyph: "◑", items: [
      { name: "Options", glyph: "⚙", run: () => $("options-btn").click() },
      { name: "Theme", glyph: "◑", run: options("Theme") },
      { name: "Text & menu", glyph: "A", run: options("Text") },
      { name: "Starting tab", glyph: "⌂", run: options("Starting tab") },
      { name: "Music on or off", glyph: "♫", run: () => $("music").click() },
      { name: "Refresh everything", glyph: "↻", run: () => { $("options-btn").click(); when("#refresh", (el) => el.focus()); } },
      { name: "Install the app", glyph: "⇩", run: () => window.NovaInstall && window.NovaInstall.open() },
      { name: "Apps and links", glyph: "⌘", run: () => $("brand").click() },
    ] },
    { name: "Admin", glyph: "♛", admin: true, badges: ["tests-badge"], items: [
      { name: "Admin pages", glyph: "♛", admin: true, at: "admin", run: go("/portal/?view=manage") },
      { name: "The crew", glyph: "☺", admin: true, at: "crew", run: go("/portal/?view=crew") },
      { name: "Invite someone", glyph: "+", admin: true, run: () => { go("/portal/?view=crew")(); when("#invite-toggle", (el) => el.click()); } },
      { name: "Google", glyph: "G", admin: true, at: "google", run: tab("google") },
      { name: "Links", glyph: "⛓", admin: true, run: go("/portal/?view=manage&page=links") },
      { name: "Test stuff", glyph: "⚑", admin: true, badge: "tests-badge", at: "tests", run: tab("tests") },
      { name: "Computer", glyph: "▣", admin: true, at: "desk", run: tab("desk") },
    ] },
  ];
  const count = (id) => {
    const b = id && $(id);
    const n = b && !b.hidden && Number(String(b.textContent).replace(/\D/g, ""));
    return n > 0 ? n : 0;
  };
  // Where you are: the tab open (or the profile, Admin, the crew)
  function here() {
    const p = new URLSearchParams(location.search);
    const v = p.get("view") || "";
    if (v === "manage" || v === "admin") return "admin";
    if (v === "crew") return "crew";
    if (v === "me" || v === "you" || p.get("id")) return "me";
    return (window.PortalApp && window.PortalApp.view) || v || "today";
  }
  const groupsNow = () => GROUPS.filter((g) => !g.admin || admin()).filter((g) => g.items.some((i) => !i.admin || admin()));
  const itemsOf = (g) => g.items.filter((i) => !i.admin || admin());
  const homeOf = (where) => groupsNow().find((g) => itemsOf(g).some((i) => i.at === where));

  let row = null; // the pillars, where the tab panel was
  let openName = null; // the pillar that's open (risen)
  let chosenByHand = false; // a pillar someone opened stays open until they open another
  let drawnSig = "";

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const badge = (n) => (n ? el("span", "pillar-badge", n > 99 ? "99+" : String(n)) : null);

  // Shown or hidden (the user, 19 Oct 2026: "show and hidable", with a clearly visible hide-all button);
  // remembered on this device
  let hidden = false;
  try {
    hidden = localStorage.getItem("nova-pillars") === "hidden";
  } catch (e) {
    /* (storage blocked: shown) */
  }
  const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function toggleButton() {
    const t = el("button", "pillars-toggle" + (hidden ? " show" : ""));
    t.type = "button";
    t.setAttribute("aria-pressed", String(hidden));
    t.setAttribute("aria-label", hidden ? "Show all: the top panel, the Nova Pillars and the Nova tiles" : "Hide all: the top panel, the Nova Pillars and the Nova tiles");
    t.title = hidden ? "Show all" : "Hide all: the top panel, the Nova Pillars and the Nova tiles";
    t.innerHTML = (hidden ? EYE : EYE_OFF) + `<span>${hidden ? "Show all" : "Hide all"}</span>`;
    t.addEventListener("click", () => setHidden(!hidden));
    return t;
  }
  // Hide all (the user, 19 Oct 2026): everything but the page goes. On a phone upright: Nova Agent's
  // top panel, the Nova Pillars and the Nova tiles; on its side: the top panel, the pillars and the
  // Nova tablets (the same bar, its sideways look); on a computer the same: the top panel, the pillars
  // and the Nova dock. Nova Agent's own bars are hidden through its NovaBar (bar.js) and put back as
  // they were on Show, and whenever Portal is left (they're only away while Portal is open). Portal on
  // its own (the phone app): its own top panel. One round button stays, top right, to Show them all.
  const novaBar = () => {
    try {
      return window.parent !== window && window.parent.NovaBar ? window.parent.NovaBar : null;
    } catch (e) {
      return null;
    }
  };
  let barsWere = null; // Nova Agent's bars as they were before Hide all
  function barsAway(away) {
    const bar = novaBar();
    document.documentElement.classList.toggle("pillars-all-hidden", away);
    if (!bar) return;
    if (away) {
      if (!barsWere) barsWere = { top: bar.topMode(), nav: bar.mode() };
      if (bar.topMode() !== "hidden") bar.setTopMode("hidden");
      if (bar.mode() !== "hidden") bar.setMode("hidden");
    } else if (barsWere) {
      bar.setTopMode(barsWere.top === "hidden" ? "work" : barsWere.top);
      bar.setMode(barsWere.nav === "hidden" ? "work" : barsWere.nav);
      barsWere = null;
    }
  }
  function setHidden(on) {
    hidden = Boolean(on);
    try {
      localStorage.setItem("nova-pillars", hidden ? "hidden" : "shown");
    } catch (e) {
      /* (kept for this visit only) */
    }
    barsAway(hidden);
    draw();
    const t = row.querySelector(".pillars-toggle");
    if (t) t.focus({ preventScroll: true });
  }

  function draw() {
    if (!row) return;
    row.classList.toggle("all-hidden", hidden);
    // (a slim line above: the pillars' name and the Hide all button, always in sight)
    const head = el("div", "pillars-head");
    head.append(el("span", "pillars-title", "Nova Pillars"), toggleButton());
    if (hidden) {
      // (only the round Show all button, top right)
      row.replaceChildren(toggleButton());
      drawnSig = sig();
      return;
    }
    const where = here();
    const groups = groupsNow();
    if (!chosenByHand || !groups.some((g) => g.name === openName)) openName = (homeOf(where) || groups[0]).name;
    const set = el("div", "pillar-set");
    row.replaceChildren(head, set);
    set.append(
      ...groups.map((g) => {
        const open = g.name === openName;
        const items = itemsOf(g);
        const lit = items.some((i) => i.at === where);
        const total = (g.badges || []).reduce((s, id) => s + count(id), 0);
        const pillar = el("section", "pillar" + (open ? " open" : "") + (lit ? " here" : ""));
        pillar.dataset.group = g.name;
        pillar.style.setProperty("--n", items.length);
        if (items.length > 4) pillar.classList.add("many");
        // The capital: the pillar's name; a slim pillar is opened by it (or anywhere on it)
        const cap = el("button", "pillar-cap");
        cap.type = "button";
        cap.setAttribute("aria-expanded", String(open));
        cap.setAttribute("aria-label", `${g.name}${total ? `, ${total} new` : ""}${open ? "" : ": open this pillar"}`);
        cap.title = g.name;
        cap.append(el("span", "pillar-glyph", g.glyph), el("span", "pillar-name", g.name));
        const b = badge(total);
        if (b) cap.append(b);
        cap.addEventListener("click", () => openPillar(g.name, true));
        const shaft = el("div", "pillar-shaft");
        if (open) {
          shaft.setAttribute("role", "group");
          shaft.setAttribute("aria-label", g.name);
          for (const it of items) {
            const btn = el("button", "pillar-btn" + (it.at && it.at === where ? " here" : ""));
            btn.type = "button";
            if (it.at && it.at === where) btn.setAttribute("aria-current", "page");
            btn.append(el("span", "pillar-glyph", it.glyph), el("span", "pillar-label", it.name));
            const nb = badge(count(it.badge));
            if (nb) btn.append(nb);
            btn.addEventListener("click", () => {
              try {
                it.run();
              } catch (err) {
                say("That didn't open: " + (err.message || err));
              }
              setTimeout(() => {
                chosenByHand = false;
                draw();
              }, 350);
            });
            shaft.append(btn);
          }
        } else {
          // (a slim pillar: its title, the group's name, on its capital; the whole of it opens it)
          pillar.addEventListener("click", (e) => {
            if (!e.target.closest(".pillar-cap")) openPillar(g.name, true);
          });
        }
        pillar.append(cap, shaft, el("span", "pillar-base"));
        return pillar;
      })
    );
    drawnSig = sig();
  }
  function openPillar(name, byHand) {
    if (openName === name) return;
    openName = name;
    chosenByHand = Boolean(byHand);
    draw();
    const first = row.querySelector(".pillar.open .pillar-btn");
    if (first && byHand) first.focus({ preventScroll: true });
  }
  const sig = () => [hidden, here(), admin(), openName, ...["new-badge", "alert-badge", "approvals-badge", "money-badge", "campaigns-badge", "social-badge", "quest-badge", "tests-badge"].map(count)].join("|");

  // ---- In place of the tab panel ----
  function place() {
    const nav = document.querySelector("nav.tabs");
    const main = $("main");
    if (!nav || !main) return;
    // (exactly where the tab panel is: inside Nova Agent it's in the header's box with the top panel)
    if (nav.parentElement && !nav.parentElement.classList.contains("app")) {
      if (nav.nextElementSibling !== row) nav.after(row);
    } else if (main.previousElementSibling !== row) main.before(row);
  }
  function start() {
    if (!$("main")) return;
    row = el("nav", "pillars");
    row.setAttribute("aria-label", "Nova Pillars: Portal's sections");
    place();
    document.documentElement.classList.add("pillars-on");
    if (hidden) barsAway(true);
    draw();
    // (leaving Portal puts Nova Agent's bars back: they're only away while Portal is open)
    addEventListener("pagehide", () => {
      if (hidden) {
        const keep = hidden;
        barsAway(false);
        hidden = keep;
      }
    });
    // Kept up to date: where you are, the counts (drawn again only when one changes)
    const refresh = () => {
      place();
      if (sig() !== drawnSig) draw();
    };
    setInterval(refresh, 1000);
    addEventListener("popstate", () => setTimeout(refresh, 200));
    document.addEventListener("click", (e) => {
      if (!row.contains(e.target)) setTimeout(refresh, 300);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.NovaPillars = { groups: GROUPS, open: (name) => openPillar(name, true), redraw: draw, hide: () => setHidden(true), show: () => setHidden(false) };
})();
