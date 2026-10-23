// Nova Tabs (named so 20 Oct 2026; they began as the Nova Pillars, 19 Oct): Portal's sections in place of
// the tab panel under the top panel. One tab per group: Inbox, Bookings, Clients & Money, Outreach,
// Plans & Nova, You, Look & sound, and Admin (admins only), each its icon and name; the group you're in
// is lit. Tapping one slides a panel out of it with all its items, over the page (it closes on the tab
// again, a tap outside, Escape, or an item). Each item does one real thing: a tab, a button pressed on
// its page, the Invoicer, a sheet; nothing does a job by itself that its page would ask about first.
// The old tab panel stays in the page, hidden: the items press its buttons and read its counts.
// "Hide all" (a crossed-out eye, at the end of the tabs) leaves only the page: Nova Agent's top panel and
// its tiles, tablets or dock go too; "Show all" (an eye, top right) brings them back; remembered here.
// In Nova Agent's theme; calm. (Code names: pillars.js/.css, .pillars, .mini-pillar.)
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
      // (on another page of its section: turned to first, onescreen.js)
      if (el && window.NovaOneScreen) window.NovaOneScreen.reveal(el);
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

  // ---- The pillars and their buttons (8 or so each; admin: only for admins) ----
  // glyph: a small mark for each; badge: the tab's count shown on it; at: the tab it lights up for
  const GROUPS = [
    // (Inbox is one dashboard, 22 Oct 2026, the user: "no need for overview… today can be in enquiries…
    // all of it on one dashboard instead of having to click around": Enquiries with today's bookings,
    // Conversations and Alerts side by side, app.js showInbox; Today itself is still Portal's start page)
    { name: "Inbox", glyph: "✉", dash: "inbox", badges: ["new-badge", "alert-badge"], items: [
      { name: "Enquiries", glyph: "✉", badge: "new-badge", at: "enquiries", inDash: true, run: tab("enquiries") },
      { name: "Conversations", glyph: "❝", at: "chats", inDash: true, run: tab("chats") },
      { name: "Alerts", glyph: "◔", badge: "alert-badge", at: "alerts", inDash: true, run: tab("alerts") },
      { name: "Website bot", glyph: "✦", at: "bot", run: tab("bot") },
      { name: "Saved replies", glyph: "❏", run: press("enquiries", "#saved-open") },
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
      // (a phone number given, its contact found: the phone's contacts, Google Contacts or a contact card)
      { name: "Import from contacts", glyph: "☎", run: () => {
        tab("clients")();
        when("#clients-contacts-open", (b) => ($("clients-contacts").hidden ? b.click() : $("contacts-phone").focus()));
      } },
      { name: "Money", glyph: "£", badge: "money-badge", at: "money", run: tab("money") },
      { name: "Write an invoice", glyph: "✎", run: invoicer({ new: true }) },
      { name: "Add an expense", glyph: "−", run: press("money", "#money-expense-new") },
      { name: "Invoicer", glyph: "£", run: invoicer({}) },
    ] },
    { name: "Outreach", glyph: "➶", badges: ["campaigns-badge", "social-badge", "funnel-badge"], items: [
      { name: "Campaigns", glyph: "✉", badge: "campaigns-badge", at: "campaigns", run: tab("campaigns") },
      { name: "Write a campaign", glyph: "✎", run: press("campaigns", "#campaigns-new") },
      { name: "One-to-one email", glyph: "➝", run: press("campaigns", "#outreach-new") },
      { name: "Don't email again", glyph: "⊘", run: show("campaigns", "#outreach-optout", "#or-optout-email") },
      { name: "Social", glyph: "◈", badge: "social-badge", at: "social", run: tab("social") },
      { name: "Write a post", glyph: "✎", run: press("social", "#social-new") },
      { name: "Fan sign-up link", glyph: "⛓", run: show("campaigns", "#campaigns-signup") },
      { name: "Ads Manager", glyph: "↗", run: () => window.open("https://adsmanager.facebook.com/", "_blank", "noopener") },
      // The outreach funnel (funnel.js): its dashboard, and adding a list of prospects
      { name: "Funnel", glyph: "⏷", badge: "funnel-badge", at: "funnel", run: tab("funnel") },
      { name: "Add prospects", glyph: "⇣", run: () => { tab("funnel")(); when("#funnel-import-open", (b) => ($("funnel-import").hidden ? b.click() : $("funnel-file").focus())); } },
    ] },
    { name: "Plans & Nova", glyph: "✧", badges: ["quest-badge"], items: [
      { name: "Quests", glyph: "✧", badge: "quest-badge", at: "quests", run: tab("quests") },
      { name: "Everyone's quests", glyph: "☷", admin: true, run: press("quests", '#quests-who [data-quests-who="everyone"]') },
      { name: "Nova Agent", glyph: "✦", run: tab("agent") },
      { name: "Ask Nova", glyph: "?", run: () => { tab("bot")(); when('#view-bot [data-mode="nova"]', (el) => { if (!el.classList.contains("active")) el.click(); if ($("bot-input")) $("bot-input").focus(); }); } },
      { name: "Voice", glyph: "◎", run: () => ($("voice") && !$("voice").hidden ? $("voice").click() : say("Voice isn't available here.")) },
      { name: "Hands-free", glyph: "◌", run: () => { $("voice-sheet").hidden = false; if ($("handsfree-switch")) $("handsfree-switch").focus(); } },
      // (My Index and the Manual are in Nova Agent's Backend now, 23 Oct 2026: hold Nova Agent's mark to open it)
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
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
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
    funnel: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5Z"/>',
  };
  const ICON_OF = {
    Inbox: "inbox", Today: "home", Enquiries: "mail", Conversations: "chat", Alerts: "bell", "Saved replies": "note", "Website bot": "spark", Notifications: "ring",
    Bookings: "calendar", Calendar: "calendar", "Booking tools": "tools", Approvals: "check", "Ask about this week": "spark", "Booking link": "link", "Test booking": "flag",
    "Clients & Money": "pound", Clients: "users", "Add a client": "userplus", "Sync with Acuity": "sync", "Import clients": "import", "Import from contacts": "phone", Money: "pound", "Write an invoice": "pen", "Add an expense": "receipt", "Overdue invoices": "alert", Invoicer: "receipt",
    Outreach: "megaphone", Campaigns: "megaphone", "Write a campaign": "pen", "One-to-one email": "send", "Don't email again": "block", Social: "camera", "Write a post": "pen", "Fan sign-up link": "link", "Ads Manager": "out", Funnel: "funnel", "Add prospects": "import",
    "Plans & Nova": "star", Quests: "star", "Everyone's quests": "team", "Nova Agent": "agent", "Ask Nova": "ask", Voice: "mic", "Hands-free": "ear",
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
  // Each Nova Tab is its own tabbed dashboard, in Portal's backdrop (22 Oct 2026, the user: "turn the nova
  // tab panels into tabbed dashboards that are integrated into the portal backdrop so each nova tab in the
  // nova tabs it's own tabbed dashboard"): a tap on a tab opens /portal/?view=group&g=<group> (its
  // Overview, dash.js), and a strip of its tabs runs along the top of the backdrop: Overview, each of its
  // sections, then its other items as buttons. The strip stays while you're in any of the group's sections.
  const slug = (name) => String(name).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // (a group with a dashboard of its own, like Inbox's, opens that instead of an Overview)
  const dashOf = () => {
    const p = new URLSearchParams(location.search);
    const own = GROUPS.find((g) => g.dash && (g.dash === p.get("view") || g.items.some((i) => i.inDash && i.at === p.get("view"))));
    return own ? slug(own.name) : p.get("view") === "group" ? p.get("g") || "" : "";
  };
  const dashUrl = (g) => (g.dash ? "/portal/?view=" + g.dash : "/portal/?view=group&g=" + slug(g.name));
  const groupsNow = () => GROUPS.filter((g) => !g.admin || admin()).filter((g) => g.items.some((i) => !i.admin || admin()));
  const itemsOf = (g) => g.items.filter((i) => !i.admin || admin());
  const homeOf = (where) => groupsNow().find((g) => g.dash === where || itemsOf(g).some((i) => i.at === where));

  let row = null; // the pillars, where the tab panel was
  let openName = null; // the pillar that's open (risen)
  let chosenByHand = false; // (a panel someone opened)
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
    t.setAttribute("aria-label", hidden ? "Show all: the top panel, the Nova Tabs and the Nova tiles" : "Hide all: the top panel, the Nova Tabs and the Nova tiles");
    t.title = hidden ? "Show all" : "Hide all: the top panel, the Nova Tabs and the Nova tiles";
    t.innerHTML = (hidden ? EYE : EYE_OFF) + `<span>${hidden ? "Show all" : "Hide all"}</span>`;
    // (shown: a small round overlay button on the open pillar's capital, the crossed-out eye; 19 Oct 2026)
    if (!hidden) t.classList.add("in-row");
    t.addEventListener("click", () => setHidden(!hidden));
    return t;
  }
  // Hide all (the user, 19 Oct 2026): everything but the page goes. On a phone upright: Nova Agent's
  // top panel, the Nova Tabs and the Nova tiles; on its side: the top panel, the pillars and the
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

  // The group pillars (20 Oct 2026): just the groups, in rows, each with its icon and name; the group
  // you're in is lit. Tapping one slides its panel out of it (the user: "when you click a group … it will
  // open a sliding panel that comes out of it with all the items on it"), over the page, so the page
  // keeps all its room. Tapping it again, outside the panel, Escape, or choosing an item closes it.
  // Each group's own colour (20 Oct 2026: "more aesthetic"), like each Nova tile has its own
  // Each group's colour, drawn from the theme's own (22 Oct 2026, the user: colours "consistent as well
  // including theming there shouldn't be drastically discolored"): still one per group, never outside the
  // theme's palette, and they follow a change of theme
  const HUE = {
    Inbox: "var(--hi)", Bookings: "var(--lilac)", "Clients & Money": "var(--gold)", Outreach: "color-mix(in oklab, var(--hi) 55%, var(--gold))",
    "Plans & Nova": "color-mix(in oklab, var(--lilac) 60%, var(--hi))", You: "var(--soft)", "Look & sound": "var(--rose, var(--hi))", Admin: "color-mix(in oklab, var(--accent) 45%, var(--gold))",
  };
  // Each group its own sky (20 Oct 2026: "make each group different from the next… vary the dots"): its
  // stars, nebula and orbit ring placed by its own name, so no two tabs look alike, and the same every time
  function sky(node, name) {
    let x = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 2166136261);
    const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
    const at = (lo = 4, hi = 96) => `${Math.round(lo + rnd() * (hi - lo))}% ${Math.round(6 + rnd() * 88)}%`;
    for (let i = 1; i <= 8; i++) node.style.setProperty(`--s${i}`, at());
    for (let i = 1; i <= 8; i++) node.style.setProperty(`--z${i}`, `${(0.35 + rnd() * 0.75).toFixed(2)}px`);
    node.style.setProperty("--n1", at(0, 40));
    node.style.setProperty("--n2", at(60, 100));
    node.style.setProperty("--ring", `${Math.round(rnd() * 100)}% ${rnd() < 0.5 ? -8 - Math.round(rnd() * 8) : 104 + Math.round(rnd() * 8)}%`);
    node.style.setProperty("--ringw", `${Math.round(55 + rnd() * 35)}%`);
    node.style.setProperty("--ringh", `${Math.round(28 + rnd() * 22)}%`);
  }
  // Your planet, the badge's own (the planet alone: no glow ring round it)
  let planetSrc = "";
  const COMPUTER = "(min-width: 761px) and (min-height: 481px), (min-width: 761px) and (pointer: fine)";
  let theBadge = null;
  const badgeEl = () => theBadge || (theBadge = document.getElementById("portal-badge") || document.querySelector("nova-portal-badge"));
  function findPlanet() {
    const b = badgeEl();
    const pic = b && b.shadowRoot && b.shadowRoot.querySelector(".orb img");
    const src = pic && pic.getAttribute("src") ? pic.getAttribute("src").replace(/size=\d+/, "size=96").replace(/&(animate|halo|spin)=\d/g, "") + "&halo=0" : "";
    if (src !== planetSrc) {
      planetSrc = src;
      for (const img of document.querySelectorAll(".tabs-planet img")) { img.src = src; img.hidden = !src; }
    }
    const s = b && b.data && b.data.staff;
    for (const btn of document.querySelectorAll(".tabs-planet")) {
      const t = s ? `${String(s.display_name || "You").trim().split(/\s+/)[0]}: your Portal card` : "Your Portal card";
      if (btn.title !== t) { btn.title = t; btn.setAttribute("aria-label", t); }
    }
  }
  function planetTab() {
    const btn = el("button", "tabs-planet");
    btn.type = "button";
    btn.innerHTML = '<img alt="" width="44" height="44" hidden><span class="tabs-planet-ghost" aria-hidden="true"></span>';
    const img = btn.querySelector("img");
    if (planetSrc) { img.src = planetSrc; img.hidden = false; }
    // (the badge itself, unseen, under the planet: inside Nova Agent its own place, Portal's header, is
    // hidden, so its card opens from here)
    const b0 = badgeEl();
    if (b0 && matchMedia(COMPUTER).matches) btn.append(b0);
    btn.addEventListener("click", (e) => {
      const b = badgeEl();
      if (b && (e.target === b || b.contains(e.target))) return; // (the badge's own click, passed on below)
      const chip = b && b.shadowRoot && b.shadowRoot.querySelector(".chip");
      if (chip) chip.click();
      else openPillar("You", true);
    });
    return btn;
  }
  // (these checks rest while Portal is out of sight: a hidden tab, or behind another panel; 22 Oct 2026)
  setInterval(() => !document.hidden && findPlanet(), 1500);
  setTimeout(findPlanet, 300);

  // A panel of their own, matching Nova Agent's top panel (20 Oct 2026, the user: "seperate the nova tabs
  // and smooth the edges from the top panel"): on a computer, inside Nova Agent, the tabs are a separate
  // rounded panel under the top panel in its own solid colour and edge (read from it, medallion.css)
  function joinTop() {
    const root = document.documentElement;
    let top = null;
    try { top = window.parent !== window ? window.parent.document.querySelector(".shell > .topbar") : null; } catch (err) {}
    const on = !!(top && row && row.querySelector(".pillar-caps") && matchMedia(COMPUTER).matches);
    root.classList.toggle("tabs-matched", on);
    if (!on) return;
    const cs = window.parent.getComputedStyle(top);
    root.style.setProperty("--tp-solid", cs.backgroundColor);
    root.style.setProperty("--tp-img", cs.backgroundImage);
    root.style.setProperty("--tp-edge", cs.borderLeftColor);
  }
  let joining = 0;
  const join = () => { if (!joining) joining = requestAnimationFrame(() => { joining = 0; joinTop(); }); };
  setInterval(() => !document.hidden && join(), 1500);
  addEventListener("resize", join);

  function drawCompact(groups, where) {
    const caps = el("div", "pillar-caps");
    caps.setAttribute("role", "group");
    caps.setAttribute("aria-label", "Groups");
    for (const g of groups) {
      const items = itemsOf(g);
      const open = g.name === openName;
      const lit = dashOf() ? dashOf() === slug(g.name) : items.some((i) => i.at === where);
      const total = (g.badges || []).reduce((n, id) => n + count(id), 0);
      const mini = el("button", "mini-pillar" + (open ? " open" : "") + (lit ? " here" : ""));
      mini.type = "button";
      mini.dataset.group = g.name;
      mini.style.setProperty("--g", HUE[g.name] || "var(--hi)");
      sky(mini, g.name);
      if (lit) mini.setAttribute("aria-current", "true");
      mini.setAttribute("aria-label", `${g.name}${total ? `, ${total} new` : ""}`);
      mini.title = g.name; // (its name on hover, where Simple shows only its icon)
      const cap = el("span", "mini-cap");
      cap.append(icon(g.name), el("span", "pillar-name", g.name));
      const b = badge(total);
      if (b) cap.append(b);
      mini.append(cap);
      mini.addEventListener("click", () => openGroup(g));
      caps.append(mini);
      // (a computer, 20 Oct 2026, the user: "put the planet in the center of that tab panel"): your
      // planet in the middle of the tabs, four groups either side; it opens your Portal card
      if (caps.children.length === Math.ceil(groups.length / 2)) caps.append(planetTab());
    }
    // (Hide all: a tab of its own at the end, with its title, in the same look as the groups)
    const hideTab = el("button", "mini-pillar hide-tab");
    hideTab.type = "button";
    hideTab.setAttribute("aria-label", "Hide all: the top panel, the Nova Tabs and the Nova tiles");
    hideTab.title = "Hide all: the top panel, the Nova Tabs and the Nova tiles";
    hideTab.style.setProperty("--g", "color-mix(in oklab, var(--lilac) 55%, var(--muted))");
    sky(hideTab, "Hide all");
    const hideCap = el("span", "mini-cap");
    const eye = el("span", "pillar-ico");
    eye.setAttribute("aria-hidden", "true");
    eye.innerHTML = EYE_OFF;
    hideCap.append(eye, el("span", "pillar-name", "Hide all"));
    hideTab.append(hideCap);
    hideTab.addEventListener("click", () => setHidden(true));
    caps.append(hideTab);
    row.replaceChildren(caps);
    row.classList.add("compact");
    drawDrawer(groups, where);
    drawStrip(where);
    drawnSig = sig();
    join();
  }

  // ---- A group's tabbed dashboard: its strip of tabs along the top of Portal's backdrop ----
  function openGroup(g) {
    closeDrawer(false);
    go(dashUrl(g))();
    setTimeout(draw, 300);
  }
  let strip = null;
  let moreOpen = false;
  function groupNow(where) {
    const d = dashOf();
    return (d && groupsNow().find((g) => slug(g.name) === d)) || homeOf(where) || null;
  }
  function stripButton(cls, label, iconName, n, onClick) {
    const b = el("button", cls);
    b.type = "button";
    b.append(icon(iconName), el("span", "gs-label", label));
    const nb = badge(n);
    if (nb) b.append(nb);
    b.addEventListener("click", () => {
      try {
        onClick();
      } catch (err) {
        say("That didn't open: " + (err.message || err));
      }
      setTimeout(draw, 350);
    });
    return b;
  }
  function drawStrip(where) {
    const main = $("main");
    const g = !hidden && main ? groupNow(where) : null;
    if (!g) {
      if (strip) strip.hidden = true;
      return;
    }
    if (!strip || !strip.isConnected) {
      strip = el("nav", "group-strip");
      main.prepend(strip);
    }
    strip.hidden = false;
    strip.setAttribute("aria-label", g.name);
    strip.style.setProperty("--g", HUE[g.name] || "var(--hi)");
    const items = itemsOf(g);
    const onDash = dashOf() === slug(g.name);
    const tabs = el("div", "gs-tabs");
    // (its dashboard first: the Overview, or for a group with its own, like Inbox, its name, lit while
    // it's showing, so the way back from its other sections is one tap)
    const over = stripButton("gs-tab" + (onDash ? " here" : ""), g.dash ? g.name : "Overview", g.name, 0, () => go(dashUrl(g))());
    if (onDash) over.setAttribute("aria-current", "page");
    tabs.append(over);
    for (const it of items.filter((i) => i.at && !i.inDash)) {
      const here = !onDash && it.at === where;
      const b = stripButton("gs-tab" + (here ? " here" : ""), it.name, it.name, count(it.badge), () => it.run());
      if (here) b.setAttribute("aria-current", "page");
      tabs.append(b);
    }
    const acts = items.filter((i) => !i.at);
    const parts = [tabs];
    if (acts.length) {
      const box = el("div", "gs-acts" + (moreOpen ? " open" : ""));
      // (a phone: the group's other items behind More, so the strip stays short)
      const more = el("button", "gs-more", moreOpen ? "Less ▴" : "More ▾");
      more.type = "button";
      more.setAttribute("aria-expanded", String(moreOpen));
      more.addEventListener("click", () => { moreOpen = !moreOpen; drawStrip(here()); });
      box.append(more, ...acts.map((it) => stripButton("gs-act", it.name, it.name, count(it.badge), () => it.run())));
      parts.push(box);
    }
    strip.replaceChildren(...parts);
  }

  // ---- The panel that slides out of a group ----
  let drawer = null;
  function drawDrawer(groups, where) {
    const g = openName && groups.find((x) => x.name === openName);
    const cap = g && row.querySelector(`.mini-pillar[data-group="${CSS.escape(g.name)}"]`);
    if (!g || !cap) return closeDrawer(false);
    if (!drawer) {
      drawer = el("div", "pillar-drawer");
      drawer.setAttribute("role", "menu");
      drawer.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDrawer(true);
      });
      document.body.append(drawer);
    }
    drawer.setAttribute("aria-label", g.name);
    drawer.style.setProperty("--g", HUE[g.name] || "var(--hi)");
    const items = itemsOf(g);
    drawer.replaceChildren(
      ...items.map((it) => {
        const btn = el("button", "pillar-btn" + (it.at && it.at === where ? " here" : ""));
        btn.type = "button";
        btn.setAttribute("role", "menuitem");
        if (it.at && it.at === where) btn.setAttribute("aria-current", "page");
        btn.append(icon(it.name), el("span", "pillar-label", it.name));
        const nb = badge(count(it.badge));
        if (nb) btn.append(nb);
        btn.addEventListener("click", () => {
          closeDrawer(false);
          try {
            it.run();
          } catch (err) {
            say("That didn't open: " + (err.message || err));
          }
          setTimeout(draw, 350);
        });
        return btn;
      })
    );
    placeDrawer(cap);
    if (drawer.hidden || !drawer.classList.contains("out")) {
      drawer.hidden = false;
      requestAnimationFrame(() => drawer && drawer.classList.add("out"));
    }
  }
  // Under the tabs, with a little point at its tab, never past the screen's edges
  function placeDrawer(cap) {
    if (!drawer || !cap) return;
    const r = cap.getBoundingClientRect();
    const W = document.documentElement.clientWidth;
    const width = Math.min(W - 12, W < 640 ? W : 620);
    const left = Math.max(6, Math.min(W - width - 6, r.left + r.width / 2 - width / 2));
    // (below all the tabs, never over the other groups (20 Oct 2026); its point at the tab it came from)
    drawer.style.top = `${Math.round(Math.max(r.bottom, row.getBoundingClientRect().bottom) + 7)}px`;
    drawer.style.left = `${Math.round(left)}px`;
    drawer.style.width = `${Math.round(width)}px`;
    drawer.style.setProperty("--point", `${Math.round(r.left + r.width / 2 - left)}px`);
  }
  function closeDrawer(focusBack) {
    const was = openName;
    openName = null;
    if (drawer && !drawer.hidden) {
      drawer.classList.remove("out");
      const d = drawer;
      setTimeout(() => {
        if (!openName) d.hidden = true;
      }, calm() ? 0 : 160);
    }
    for (const m of row.querySelectorAll(".mini-pillar.open")) {
      m.classList.remove("open");
      m.setAttribute("aria-expanded", "false");
    }
    if (focusBack && was) row.querySelector(`.mini-pillar[data-group="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
  }

  // ---- Nova panes (22 Oct 2026, the user: "for all panes in the nova portal can we contain them in a nova
  // pane for easier identification"): every section is framed in its Nova Tab's colour, with its icon
  // beside its title, and named (data-pane: "Inbox · Enquiries") so it can be pointed at ----
  const PANE_OF = { today: ["", "Today"], me: ["You", "Your profile"], profile: ["You", "Your profile"], admin: ["Admin", "Admin pages"], crew: ["Admin", "The crew"] };
  // (a pane too small for its words, a phone's Inbox or anything on a phone on its side, turns into plain
  // text, terminal style: the user, 22 Oct 2026, "can the ui become more tui if it get so small that
  // area's are collapsing and can't see text"; dash.css [data-tui])
  // (switched off, 22 Oct 2026, the user: "okay turn off the tui it doesn't work"; TUI_ON brings it back,
  // its look is still in dash.css [data-tui])
  const TUI_ON = false;
  const TUI_H = 230, TUI_W = 280;
  // (all or none: the panes on screen together are all terminal style or all not, never one of each; the
  // user, 22 Oct 2026: "won't allow one side to be tui and one to be gui at the same time")
  const tuiWatch = TUI_ON && "ResizeObserver" in window ? new ResizeObserver(() => {
    const shown = [...document.querySelectorAll("#main > .view:not([hidden])")].filter((v) => v.clientWidth && v.clientHeight);
    const on = document.documentElement.classList.contains("embed") && shown.some((v) => v.clientHeight < TUI_H || v.clientWidth < TUI_W);
    let changed = false;
    for (const v of shown) {
      if (v.hasAttribute("data-tui") === on) continue;
      v.toggleAttribute("data-tui", on);
      changed = true;
    }
    if (changed && window.NovaOneScreen) window.NovaOneScreen.now();
  }) : null;
  function paneUp() {
    for (const v of document.querySelectorAll("#main > .view")) {
      if (tuiWatch && !v.dataset.tuiWatch) {
        v.dataset.tuiWatch = "1";
        tuiWatch.observe(v);
      }
      const key = v.id.replace(/^view-/, "");
      let group = "", name = "";
      if (key === "group") {
        const g = groupsNow().find((x) => slug(x.name) === dashOf());
        group = g ? g.name : "";
        name = "Overview";
      } else if (PANE_OF[key]) [group, name] = PANE_OF[key];
      else {
        const g = GROUPS.find((x) => x.items.some((i) => i.at === key));
        const it = g && g.items.find((i) => i.at === key);
        if (g) [group, name] = [g.name, it.name];
      }
      v.classList.add("nova-pane");
      v.dataset.pane = [group, name].filter(Boolean).join(" · ");
      v.style.setProperty("--g", HUE[group] || "var(--hi)");
      const head = v.querySelector(":scope > .view-head");
      // (the icon sits beside the title, not in it: some titles are rewritten as you go)
      if (head && key !== "group" && name && !head.querySelector(":scope > .pane-ico")) {
        const ico = icon(name);
        ico.classList.add("pane-ico");
        head.prepend(ico);
      }
    }
  }

  function draw() {
    if (!row) return;
    paneUp();
    row.classList.toggle("all-hidden", hidden);
    if (hidden) {
      // (only the round Show all button, top right)
      closeDrawer(false);
      if (strip) strip.hidden = true;
      row.replaceChildren(toggleButton());
      drawnSig = sig();
      return;
    }
    return drawCompact(groupsNow(), here());
  }
  function openPillar(name, byHand) {
    // (the same group again closes its panel)
    if (openName === name) return closeDrawer(true);
    openName = name;
    chosenByHand = Boolean(byHand);
    draw();
    const first = drawer && drawer.querySelector(".pillar-btn");
    if (first && byHand && matchMedia("(pointer: fine)").matches) first.focus({ preventScroll: true });
  }
  const sig = () => [hidden, here(), dashOf(), admin(), openName, ...["new-badge", "alert-badge", "approvals-badge", "money-badge", "campaigns-badge", "social-badge", "quest-badge", "tests-badge"].map(count)].join("|");

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
    row.setAttribute("aria-label", "Nova Tabs: Portal's sections");
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
    setInterval(() => !document.hidden && refresh(), 1000);
    addEventListener("popstate", () => setTimeout(refresh, 200));
    document.addEventListener("click", (e) => {
      if (!row.contains(e.target)) setTimeout(refresh, 300);
    });
    document.addEventListener("pointerdown", (e) => {
      if (openName && drawer && !drawer.contains(e.target) && !row.contains(e.target)) closeDrawer(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openName) closeDrawer(true);
    });
    const follow = () => openName && placeDrawer(row.querySelector(".mini-pillar.open"));
    addEventListener("resize", follow);
    addEventListener("scroll", follow, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.NovaPillars = { groups: GROUPS, open: (name) => { const g = groupsNow().find((x) => x.name === name); return g ? openGroup(g) : openPillar(name, true); }, redraw: draw, hide: () => setHidden(true), show: () => setHidden(false),
    // (for Today's dashboard, dash.js: every section, its icon, its count and its group's colour)
    now: () => groupsNow().map((g) => ({ ...g, items: itemsOf(g) })), icon, count, slug, hue: (name) => HUE[name] || "var(--hi)" };
})();
