// Nova Pillars (19 Oct 2026): Portal's sections in place of the tab panel under the top panel. One
// cylindrical pillar per group: Inbox, Bookings, Clients & Money, Outreach, Plans & Nova, You, Look &
// sound, and Admin (admins only). A pillar is clickable: it rises (opens) to show its pillar buttons,
// bands round the column, each doing one real thing: a tab, a button pressed on its page, the
// Invoicer, a sheet. Nothing does a job by itself that its page would ask about first: it opens the
// place and presses the same button a person would. One pillar is open at a time (the one you're in,
// to start with); the others stand slim with the group's name as their title. On phones and tablets,
// simpler: short pillars in rows, names across them and big to tap, the open one wide underneath.
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
      { name: "Invoicer", glyph: "£", run: invoicer({}) },
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

  // ---- Icons: clean line icons in Nova Agent's style (the same stroke as its tabs), by name ----
  const P = {
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7Z"/>',
    ring: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M2 4l2 2M22 4l-2 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    tools: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3M8 17.5h6"/>',
    check: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    flag: '<path d="M4 22V4"/><path d="M4 4h13l-2 4 2 4H4"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    pound: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5a2.8 2.8 0 0 0-5 1.7V16M8.5 13h4.5M8.5 16H15"/>',
    pen: '<path d="M16 3l5 5L8 21H3v-5Z"/>',
    receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    megaphone: '<path d="M3 11v3a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>',
    send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
    block: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    camera: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
    out: '<path d="M14 3h7v7"/><path d="M21 3 11 13"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/>',
    team: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.5"/><circle cx="19" cy="10" r="2.5"/><path d="M7 21a5 5 0 0 1 10 0M1 20a4 4 0 0 1 5-3.9M23 20a4 4 0 0 0-5-3.9"/>',
    agent: '<path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4Z"/>',
    ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4 1c0 1.5-2.2 2-2.2 2M12 15.5v.5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>',
    ear: '<path d="M6 8.5a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 18 11.5 19.5 7 20 7 17"/><path d="M9 9a3 3 0 0 1 6 0"/>',
    index: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4Z"/><path d="M20 4h-6a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h7Z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    planet: '<circle cx="12" cy="12" r="6"/><path d="M3 15c-2 3 1 4 9 1.5S23 9 21 7c-1-1-3-.5-5 .3"/>',
    at: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
    map: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    exit: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.1-1-1.4-1-2.4s.8-1.6 1.8-1.6H17a4 4 0 0 0 4-4c0-4.7-4-8.4-9-8.4Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
    start: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="m10 14 2 2 3-3"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    install: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M12 7v7M9 11l3 3 3-3"/>',
    apps: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
    google: '<path d="M21 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h5.1a4.4 4.4 0 0 1-1.9 2.9v2.4h3A9 9 0 0 0 21 12.2Z"/><path d="M12 21a8.8 8.8 0 0 0 6.2-2.3l-3-2.4a5.5 5.5 0 0 1-8.2-2.9H3.9v2.4A9 9 0 0 0 12 21Z"/><path d="M7 13.4a5.4 5.4 0 0 1 0-3.4V7.6H3.9a9 9 0 0 0 0 8.2Z"/><path d="M12 6.6a4.9 4.9 0 0 1 3.5 1.4l2.6-2.6A8.8 8.8 0 0 0 12 3a9 9 0 0 0-8.1 4.6L7 10a5.4 5.4 0 0 1 5-3.4Z"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7 15h10"/>',
    monitor: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  };
  const ICON_OF = {
    Inbox: "inbox", Today: "home", Enquiries: "mail", Conversations: "chat", Alerts: "bell", "Saved replies": "note", "Website bot": "spark", Notifications: "ring",
    Bookings: "calendar", Calendar: "calendar", "Booking tools": "tools", Approvals: "check", "Ask about this week": "spark", "Booking link": "link", "Test booking": "flag",
    "Clients & Money": "pound", Clients: "users", "Add a client": "userplus", "Sync with Acuity": "sync", "Import clients": "import", Money: "pound", "Write an invoice": "pen", "Add an expense": "receipt", "Overdue invoices": "alert", Invoicer: "receipt",
    Outreach: "megaphone", Campaigns: "megaphone", "Write a campaign": "pen", "One-to-one email": "send", "Don't email again": "block", Social: "camera", "Write a post": "pen", "Fan sign-up link": "link", "Ads Manager": "out",
    "Plans & Nova": "star", Quests: "star", "Everyone's quests": "team", "Nova Agent": "agent", "Ask Nova": "ask", Voice: "mic", "Hands-free": "ear", "My Index": "index", Manual: "book",
    You: "user", "Your profile": "user", "Re-roll planet": "planet", "Edit your name": "pen", "Change email": "at", "Change password": "key", "All addresses": "map", "How it works": "gear", "Sign out": "exit",
    "Look & sound": "palette", Options: "gear", Theme: "palette", "Text & menu": "text", "Starting tab": "start", "Music on or off": "music", "Refresh everything": "refresh", "Install the app": "install", "Apps and links": "apps",
    Admin: "shield", "Admin pages": "shield", "The crew": "team", "Invite someone": "userplus", Google: "google", Links: "link", "Test stuff": "flask", Computer: "monitor",
  };
  function icon(name) {
    const span = document.createElement("span");
    span.className = "pillar-ico";
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = `<svg viewBox="0 0 24 24">${P[ICON_OF[name]] || P.agent}</svg>`;
    return span;
  }

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

  // An open pillar's buttons: bands round the column, each doing its one thing
  function fillShaft(shaft, g, items, where) {
    shaft.setAttribute("role", "group");
    shaft.setAttribute("aria-label", g.name);
    for (const it of items) {
      const btn = el("button", "pillar-btn" + (it.at && it.at === where ? " here" : ""));
      btn.type = "button";
      if (it.at && it.at === where) btn.setAttribute("aria-current", "page");
      btn.append(icon(it.name), el("span", "pillar-label", it.name));
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
  }
  // Phones and tablets (simple, 19 Oct 2026: "super simple to use"): short pillars in rows, each with its
  // name across it and big to tap; the one tapped opens wide underneath, its buttons in two columns
  const COMPACT = matchMedia("(max-width: 1099px)");
  function drawCompact(head, groups, where) {
    const caps = el("div", "pillar-caps");
    caps.setAttribute("role", "group");
    caps.setAttribute("aria-label", "Groups");
    for (const g of groups) {
      const items = itemsOf(g);
      const open = g.name === openName;
      const lit = items.some((i) => i.at === where);
      const total = (g.badges || []).reduce((n, id) => n + count(id), 0);
      const mini = el("button", "mini-pillar" + (open ? " open" : "") + (lit ? " here" : ""));
      mini.type = "button";
      mini.setAttribute("aria-expanded", String(open));
      mini.setAttribute("aria-label", `${g.name}${total ? `, ${total} new` : ""}`);
      const cap = el("span", "mini-cap");
      cap.append(icon(g.name), el("span", "pillar-name", g.name));
      const b = badge(total);
      if (b) cap.append(b);
      mini.append(cap, el("span", "mini-shaft"), el("span", "mini-base"));
      mini.addEventListener("click", () => openPillar(g.name, true));
      caps.append(mini);
    }
    const g = groups.find((x) => x.name === openName);
    const items = itemsOf(g);
    const wide = el("section", "pillar open wide" + (items.length > 2 ? " many" : ""));
    const top = el("div", "pillar-cap");
    top.append(icon(g.name), el("span", "pillar-name", g.name));
    const shaft = el("div", "pillar-shaft");
    fillShaft(shaft, g, items, where);
    wide.append(top, shaft, el("span", "pillar-base"));
    row.replaceChildren(head, caps, wide);
    row.classList.add("compact");
    drawnSig = sig();
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
    if (COMPACT.matches) return drawCompact(head, groups, where);
    row.classList.remove("compact");
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
        cap.append(icon(g.name), el("span", "pillar-name", g.name));
        const b = badge(total);
        if (b) cap.append(b);
        cap.addEventListener("click", () => openPillar(g.name, true));
        const shaft = el("div", "pillar-shaft");
        if (open) {
          fillShaft(shaft, g, items, where);
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
    // (on a phone the finger stays where it was: no jump; with a keyboard, into the buttons)
    const first = row.querySelector(".pillar.open .pillar-btn");
    if (first && byHand && !COMPACT.matches) first.focus({ preventScroll: true });
  }
  const sig = () => [hidden, COMPACT.matches, here(), admin(), openName, ...["new-badge", "alert-badge", "approvals-badge", "money-badge", "campaigns-badge", "social-badge", "quest-badge", "tests-badge"].map(count)].join("|");

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
    COMPACT.addEventListener("change", () => draw());
    addEventListener("popstate", () => setTimeout(refresh, 200));
    document.addEventListener("click", (e) => {
      if (!row.contains(e.target)) setTimeout(refresh, 300);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.NovaPillars = { groups: GROUPS, open: (name) => openPillar(name, true), redraw: draw, hide: () => setHidden(true), show: () => setHidden(false) };
})();
