// Nova Phone (the mobile version; Nova Desk is the computer one): the frame and the parts every screen is made of.
//   - Screens register with NovaPhone.section({ id, name, icon, draw(box, path, ui) }); the address's #id/…
//     picks one, so Back and Forward work as on any site and anything can be linked to.
//   - A screen draws into its own box; it's shown only if it's still the newest when it's ready (a slow one
//     never covers a newer one). Meanwhile the last one stays, or a quiet placeholder on a first visit.
//   - ui.back(href) puts Back in the title bar, ui.action({ icon, label, href | run }) one button on the right.
//   - The parts: list rows, fields, switches, choices, empty and error cards, a sheet from the bottom to be sure
//     or to choose, a toast for "Saved". One way of doing each, so every screen looks and works alike.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const page = $("page"), tabs = $("tabs"), title = $("title"), left = $("top-left"), right = $("top-right"), sheet = $("sheet"), toastEl = $("toast");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (err) {} } };
  const stored = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch (err) { return d; } };

  // ---- Nova Phone's own settings on this device ("nova-phone-options"; the ones Nova Desk has too stay in its
  // own keys, so both apps agree): start: where Nova Phone opens ("last" where you left off, "today");
  // more: More as tiles or as a list that says what each place is for ----
  const OPT = "nova-phone-options";
  const OPT_DEFAULTS = { start: "last", more: "tiles" };
  const options = () => ({ ...OPT_DEFAULTS, ...stored(OPT, {}) });
  function setOption(k, v) {
    const o = { ...options(), [k]: v };
    store.set(OPT, JSON.stringify(o));
    dispatchEvent(new CustomEvent("novaphoneoptions", { detail: o }));
    return o;
  }
  // Opened again with no place in the address (from the Home Screen, after signing in): back where you left off,
  // as Nova Desk does (remember.js), unless Settings says to open on Today
  if (location.hash.length <= 1 && options().start === "last") {
    const last = store.get("nova-phone-last");
    if (last && last !== "today") history.replaceState(null, "", `#${last}`);
  }
  // (a page that lists its own files, like the preview, has Nova's shared files beside it too)
  const LIVE = !!document.querySelector('script[src="/phone/phone.js"]');
  const asset = (path) => (LIVE ? path : path.split("/").pop());
  // The browser's own offer to install (Android, computers): kept for Settings → Install
  let installOffer = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installOffer = e; dispatchEvent(new CustomEvent("novaphoneinstall")); });
  addEventListener("appinstalled", () => { installOffer = null; dispatchEvent(new CustomEvent("novaphoneinstall")); });

  // ---- Icons: 24px line drawings in the text's colour ----
  const ICONS = {
    agent: '<path d="M12 3a8 8 0 0 1 8 8c0 4.4-3.6 8-8 8H6l-3 2.5V11a8 8 0 0 1 8-8z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>',
    today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    money: '<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.5"/>',
    quests: '<path d="M4 6l2 2 4-4M4 14l2 2 4-4"/><path d="M13 7h7M13 15h7"/>',
    more: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
    back: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5 20 4"/>', check: '<path d="m5 12 5 5 9-10"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>', share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>', board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>', play: '<path d="M7 4v16l13-8z"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    // (Nova Phone as a whole: voice, music, sounds, install, links, the look)
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>', music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    sound: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>', download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1-.8-1.4-.8-2.3 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7" r="1.2"/>',
    out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>', battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2M7 10v4"/>',
  };
  const icon = (name, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.more}</svg>`;

  // ---- Screens, and the bar of five sections ----
  const sections = new Map();
  // The Nova tiles (the user: "the nova tiles should actually be like it was on nova desk"): Nova Desk's bar on
  // a phone, every place a tile in its own colours with its name inside it. Invoicer tall down the left, Nova
  // (Nova Desk's Visualizer, Nova's browser helper) tall down the right; everything else, and the look, in More
  // (the grid button at the top left of every main screen, as Nova Desk keeps its settings in its top bar); Apps along the top row; Plans, Tools and Helpers
  // below, each group set apart by a fine line. [address, name, tile drawing]
  const SIDE_L = ["money", "Invoicer", "invoicer"];
  const SIDE_R = ["visualizer", "Nova", "visualizer"];
  const ROWS = [
    [["today", "Portal", "portal"], ["agent", "Agent", "chat"], ["calendar", "Calendar", "calendar"], ["notes", "Notes", "notes"], ["board", "Board", "board"], ["index", "Index", "index"]],
    [["quests", "Quests", "quests"], ["agent/missions", "Missions", "missions"], "|", ["fixer", "Fixer", "fixer"], ["computer", "Computer", "computer"], "|", ["observatory", "Observatory", "observatory"], ["console", "Console", "console"], ["help", "Manual", "manual"]],
  ];
  const badges = {};
  function section(def) {
    sections.set(def.id, def);
    if (!tabs.firstChild) drawTiles();
    // (once the rest of its file has run: it may draw with things defined further down)
    if (current().id === def.id) queueMicrotask(show);
  }
  // (Portal's tile: everything waiting in Portal, as Nova Desk's More badge adds them up: new enquiries, unseen
  // alerts, approvals, campaigns and one-to-one emails, social posts, the funnel)
  const PORTAL_BADGES = ["inbox", "inbox/alerts", "inbox/approvals", "outreach", "outreach/social", "outreach/funnel"];
  const badgeOf = (to) => (to === "today" ? PORTAL_BADGES.reduce((a, k) => a + (badges[k] || 0), 0) : badges[to] || 0);
  function tileHtml([to, name, p], tall) {
    const art = p && window.NovaTile ? window.NovaTile(p) : `<span class="pico nova-pico" aria-hidden="true"><img src="${window.NovaMark || "/agent/icon.svg"}" alt=""></span>`;
    const n = badgeOf(to);
    return `<a class="nt${tall ? " tall" : ""}" href="#${to}" data-to="${to}" aria-label="${esc(name)}">${art}<span class="nt-name" aria-hidden="true">${esc(name)}</span>${SHORT[name] ? `<span class="nt-short" aria-hidden="true">${SHORT[name]}</span>` : ""}${n ? `<b class="tab-badge">${n > 99 ? "99+" : n}</b>` : ""}</a>`;
  }
  function drawTiles() {
    tabs.innerHTML = `${tileHtml(SIDE_L, true)}<div class="nt-rows">${ROWS.map((r) => `<div class="nt-row">${r.map((t) => (t === "|" ? '<i class="nt-sep" aria-hidden="true"></i>' : tileHtml(t))).join("")}</div>`).join("")}</div>${tileHtml(SIDE_R, true)}`;
    mark();
    fitTiles();
  }
  // A row too tight for its names, step by step, never cut: the names smaller; then the short names Nova Desk
  // shows on a phone (Comp, Obs, Cons: whole words, not chopped); then only read out (the drawings stay)
  const SHORT = { Computer: "Comp", Observatory: "Obs", Console: "Cons", Missions: "Miss" };
  function fitTiles() {
    for (const row of tabs.querySelectorAll(".nt-row")) {
      row.classList.remove("tight", "short", "tiny", "names-off");
      // (each tile is at least as wide as its name, the rest of the row shared out: a row is too tight when its
      // tiles together are wider than it)
      const over = () => row.scrollWidth > row.clientWidth + 1;
      for (const step of ["tight", "short", "tiny", "names-off"]) { if (!over()) break; row.classList.add(step); }
    }
  }
  addEventListener("resize", () => requestAnimationFrame(fitTiles));
  document.fonts?.ready.then(fitTiles);
  // (and again once the real font is in: measured with the stand-in font, the names looked too wide)
  document.fonts?.addEventListener?.("loadingdone", () => requestAnimationFrame(fitTiles));
  // (several badges arriving together redraw the tiles once)
  let tilesSoon = false;
  function badge(id, n) {
    if ((badges[id] || 0) === (n || 0)) return;
    badges[id] = n || 0;
    if (tilesSoon) return;
    tilesSoon = true;
    queueMicrotask(() => { tilesSoon = false; drawTiles(); dispatchEvent(new CustomEvent("novaphonebadges", { detail: { ...badges } })); });
  }

  // ---- Badges from what the places fetch anyway (portal.md G1): each answer below sets its tile's number as it
  // arrives, and shell.js asks only for the ones nobody has fetched for a few minutes (one at a time, only while
  // Nova Phone is on screen). The same counts as Nova Desk's Portal (app.js, social.js, funnel.js, money.js,
  // teststuff.js). [address, which answers count (none filtered away), what it sets]
  const seen = {};
  const seenAlert = () => Number(store.get("nova-seen-alert")) || 0;
  let alertTop = 0, campaignsN = 0, oneN = 0;
  const onAlerts = () => { const [id, part] = decodeURIComponent(location.hash.slice(1)).split("/"); return id === "inbox" && /^alerts?$/.test(part || ""); };
  function alertsSeen() {
    if (!alertTop) return;
    if (alertTop > seenAlert()) store.set("nova-seen-alert", String(alertTop));
    badge("inbox/alerts", 0);
  }
  const unfiltered = (u, ok = []) => { const s = u.searchParams.get("status"); return !s || ["all", ...ok].includes(s); };
  const COUNTS = [
    ["/app/api/booking-actions", (u) => unfiltered(u, ["pending"]), (d) => badge("inbox/approvals", (d.actions || []).filter((a) => a.status === "pending").length)],
    ["/app/api/campaigns", (u) => unfiltered(u, ["waiting", "pending_approval"]), (d) => { campaignsN = (d.campaigns || []).filter((c) => c.status === "pending_approval").length; badge("outreach", campaignsN + oneN); }],
    ["/app/api/outreach", (u) => unfiltered(u, ["pending_approval", "waiting"]), (d) => { oneN = (d.outreach || []).filter((o) => o.status === "pending_approval").length; badge("outreach/one", oneN); badge("outreach", campaignsN + oneN); }],
    ["/app/api/social", () => true, (d) => badge("outreach/social", (d.posts || []).filter((p) => p.status === "pending_approval" || p.status === "manual").length)],
    ["/app/api/funnel", () => true, (d) => badge("outreach/funnel", d.canDecide ? (d.prospects || []).filter((p) => p.step === "approve").length : 0)],
    ["/app/api/money", () => true, (d) => { const s = d.summary; if (s) badge("money", (d.canDecide ? s.waitingApproval || 0 : 0) + ((s.overdue && s.overdue.count) || 0)); }],
    ["/quests/state", (u) => !u.searchParams.get("who"), (d) => {
      const day = String(d.now || "").slice(0, 10);
      if (day) badge("quests", (d.quests || []).filter((q) => (q.status === "todo" || q.status === "doing") && q.start && String(q.start).startsWith(day)).length);
    }],
    ["/app/api/notifications", () => true, (d) => {
      const list = d.notifications || [];
      alertTop = list.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
      if (onAlerts()) return alertsSeen();
      badge("inbox/alerts", list.filter((n) => Number(n.id) > seenAlert()).length);
    }],
    ["/app/api/tidy", () => true, (d) => badge("tests", (d.items || []).filter((i) => i.confidence === "likely" || i.likely === true).length)],
  ];
  // Who's signed in, kept on this device for the planet in the title bar and More's card (only what's shown)
  const ME = "nova-phone-me";
  function keepMe(d) {
    const s = d && (d.staff || d.user);
    if (!s || !s.id) return;
    const me = { id: s.id, display_name: s.display_name || "", role: s.role || "staff", email: s.email || "", created_at: s.created_at || "", planet: s.planet ? { name: s.planet.name || "", description: s.planet.description || "" } : null, at: Date.now() };
    const was = stored(ME, null);
    store.set(ME, JSON.stringify(me));
    if (!was || was.id !== me.id) paintMe();
    // (Colour from my planet: the planet's colours come with who you are)
    const c = s.planet && s.planet.colors;
    if (c && c.glow) {
      const pal = { seed: s.planet_seed || s.id, glow: c.glow, streak: c.streak || c.base || c.glow, light: c.light, base: c.base, sky: c.sky, nebula0: c.nebula0, nebula2: c.nebula2 };
      if (store.get("nova-look-planet") !== JSON.stringify(pal)) { store.set("nova-look-planet", JSON.stringify(pal)); window.NovaPhoneLook?.apply(); }
    }
  }
  const me = () => stored(ME, null);
  function watch(path, method, data) {
    if (method && method !== "GET") return;
    let u;
    try { u = new URL(path, location.origin); } catch (err) { return; }
    if (u.pathname === "/auth/me") return keepMe(data);
    for (const [at, ok, fn] of COUNTS) {
      if (u.pathname !== at || !ok(u)) continue;
      seen[at] = Date.now();
      try { fn(data || {}); } catch (err) {}
    }
  }
  // The planet in the title bar's More button (your planet + name, a tap away from every main screen)
  function paintMe() {
    const m = me(), btn = left.querySelector("a.more-btn");
    if (!btn) return;
    let img = btn.querySelector(".top-me");
    if (!m) return img && img.remove();
    const src = `/staff/${encodeURIComponent(m.id)}/planet.svg?size=64`;
    if (img && img.getAttribute("src") === src) return;
    if (!img) { img = document.createElement("img"); img.className = "top-me"; img.alt = ""; img.width = 20; img.height = 20; img.decoding = "async"; btn.append(img); }
    img.src = src;
  }
  // (a planet that can't be drawn, as in the preview, isn't shown at all)
  document.addEventListener("error", (e) => { if (e.target && e.target.classList && e.target.classList.contains("top-me")) e.target.hidden = true; }, true);
  // Each place's code, run when it's first opened (ns CLAUDE.md 2e: what's needed first comes first), and the
  // rest fetched quietly once the first screen is up, so a tap on a tile is still quick. "*": a module. Today also
  // shows Inbox's rows, the Calendar and Quests.
  const FILES = {
    today: ["inbox.js", "today.js", "calendar.js*", "quests.js*"], inbox: ["inbox.js"], calendar: ["calendar.js*"], quests: ["quests.js*"],
    agent: ["agent.js"], notes: ["notes.js"], money: ["money.js"], clients: ["clients.js"], outreach: ["outreach.js"], you: ["you.js"], crew: ["you.js"],
    google: ["admin.js"], tests: ["admin.js"], computer: ["computer.js"], fixer: ["fixer.js"], visualizer: ["visualizer.js"],
    index: ["memory.js"], board: ["board.js"], help: ["manual.js"], observatory: ["observatory.js"], console: ["console.js"], more: ["more.js"],
    lossless: ["lossless.js"], bookings: ["bookings.js"], bot: ["bot.js"],
    admin: ["admin.js"], signin: ["signin.js"], join: ["signin.js"],
    // (Nova Phone as a whole: its settings, and Today in music)
    settings: ["settings.js"], music: ["music.js"],
  };
  // (its name and tile in the title bar while it comes)
  const NAMES = {
    today: "Today:portal", inbox: "Inbox:portal", calendar: "Calendar:calendar", quests: "Quests:quests", agent: "Agent:chat", notes: "Notes:notes",
    money: "Money:invoicer", clients: "Clients:portal", outreach: "Outreach:portal", you: "You:portal", crew: "The crew:portal", google: "Google:portal",
    computer: "Computer:computer", tests: "Test stuff:portal", fixer: "Fixer:fixer", visualizer: "Nova:visualizer", index: "Index:index", board: "Board:board",
    help: "Manual:manual", observatory: "Observatory:observatory", console: "Console:console", more: "More",
    lossless: "Lossless:lossless", bookings: "Booking tools:calendar", bot: "Website bot:portal",
    admin: "Admin:portal", signin: "Sign in:portal", join: "Your invite:portal",
    settings: "Settings", music: "Today in music",
  };
  const loading = new Map();
  function load(f) {
    const file = f.replace("*", "");
    // (a page that lists the files itself, like the preview, has them already)
    if (document.querySelector(`script[src="${file}"], script[src="/phone/${file}"]`) && !loading.has(file)) return Promise.resolve();
    if (!loading.has(file)) loading.set(file, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      if (f.endsWith("*")) s.type = "module";
      s.async = false; // (in the order asked for: Inbox's rows before Today)
      s.src = file;
      s.onload = resolve;
      s.onerror = () => { loading.delete(file); s.remove(); reject(new Error("It didn't load. Check the connection and try again.")); };
      document.head.append(s);
    }));
    return loading.get(file);
  }
  // A place's own stylesheet (money.css and so on), added once when the place first draws: await N.css("money.css")
  const sheets = new Map();
  function css(file) {
    if (!sheets.has(file)) sheets.set(file, new Promise((resolve) => {
      if (document.querySelector(`link[href="${file}"], link[href="/phone/${file}"]`)) return resolve();
      const l = Object.assign(document.createElement("link"), { rel: "stylesheet", href: file });
      l.onload = l.onerror = () => resolve();
      document.head.append(l);
    }));
    return sheets.get(file);
  }
  let rested = false;
  function loadRest() {
    if (rested) return;
    // (only once the page has finished loading: started before, the browser counts it as part of the page and
    // holds back everything waiting for that, the service worker included)
    if (document.readyState !== "complete") return addEventListener("load", loadRest, { once: true });
    rested = true;
    // (the session watch, signin.js, and the reminders, notices.js: run, not just fetched)
    load("signin.js").catch(() => {});
    load("notices.js").catch(() => {});
    // (and Inbox's: a push while open, key renewal, the Home Screen dot, on every screen)
    load("inbox.js").catch(() => {});
    const files = [...new Set(Object.values(FILES).flat())];
    const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 200));
    // (fetched, not run: the service worker keeps each by its fingerprint, so opening a place later runs it from the
    // phone with no wait, and nothing runs in the background meanwhile)
    const next = () => {
      const f = files.shift();
      if (!f) return;
      const file = f.replace("*", "");
      if (loading.has(file) || document.querySelector(`script[src="${file}"], script[src="/phone/${file}"]`)) return next();
      fetch(file, { priority: "low", credentials: "same-origin" }).catch(() => {}).finally(() => idle(next));
    };
    idle(next);
  }

  // Where we are: #calendar, #calendar/card/abc (the screen and what's after it)
  function current() {
    // (anything after "?" is for the place to read, e.g. #money?filter=overdue)
    const [id, ...rest] = decodeURIComponent(location.hash.slice(1).split("?")[0]).split("/");
    return sections.has(id) || FILES[id] ? { id, rest } : { id: "today", rest: [] };
  }
  // The tile that's lit: the place you're in (Portal's parts light Portal; anything else lights Nova)
  const PORTAL = ["today", "inbox", "clients", "outreach", "you", "crew", "google", "tests", "admin", "signin", "join", "bookings", "bot"];
  const OWN = ["money", "agent", "calendar", "notes", "board", "index", "quests", "fixer", "computer", "observatory", "console", "help", "visualizer"];
  function mark() {
    const { id, rest } = current();
    const to = PORTAL.includes(id) ? "today" : id === "agent" && /^missions?$/.test(rest[0] || "") ? "agent/missions" : OWN.includes(id) ? id : "";
    for (const a of tabs.querySelectorAll(".nt")) (a.dataset.to === to ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  }

  // ---- Where you've been (Nova Desk's navigation panel's History, and remember.js): the newest 20 places, and
  // the one to open again next time (a form being written isn't somewhere to come back to: its place is) ----
  const HIST = "nova-phone-history";
  function remember(key, bar) {
    const parts = key.replace(/\/+$/, "").split("/");
    const to = parts.some((p) => /^(new|edit)$/.test(p)) ? parts[0] : parts.join("/");
    store.set("nova-phone-last", to);
    const h = stored(HIST, []).filter((x) => x && x.to !== to);
    h.unshift({ to, title: String(bar.title || ""), tile: bar.tile || "", t: Date.now() });
    store.set(HIST, JSON.stringify(h.slice(0, 20)));
  }
  // ---- What you've been doing, newest first (Nova Desk's status line's "Lately"), on this device ----
  const ACT = "nova-phone-activity";
  function activity(text) {
    if (!text) return stored(ACT, []);
    const a = stored(ACT, []);
    if (a[0] && a[0].text === text && Date.now() - a[0].t < 60000) return a;
    const where = (NAMES[current().id] || "").split(":")[0];
    a.unshift({ t: Date.now(), text: String(text), where });
    store.set(ACT, JSON.stringify(a.slice(0, 40)));
    return a;
  }
  // ---- Nova Phone as a whole (shell.js), once the first screen is up: the badges' light check, updates, who
  // you are, the time you've been here, sounds and music when they're on ----
  let shellStarted = false;
  function afterFirst() {
    if (shellStarted) return;
    shellStarted = true;
    const go = () => { if (!window.NovaPhoneLook) load("look.js").catch(() => {}); load("shell.js").catch(() => { shellStarted = false; }); };
    if (document.readyState === "complete") setTimeout(go, 300);
    else addEventListener("load", () => setTimeout(go, 300), { once: true });
  }
  const sound = (kind) => (window.NovaPhoneSound ? window.NovaPhoneSound.play(kind) : false);

  let drawn = "", drawing = 0;
  async function show() {
    const { id, rest } = current();
    const s = sections.get(id);
    mark();
    if (!s) {
      // (its code isn't here yet: a placeholder while it comes, then section() shows it)
      if (drawn !== `load:${id}`) {
        drawn = `load:${id}`;
        page.replaceChildren(Object.assign(document.createElement("div"), { className: "page-in", innerHTML: skeleton() }));
        const [t, tile] = (NAMES[id] || "Nova Phone").split(":");
        head({ title: t, tile });
      }
      Promise.all(FILES[id].map(load)).catch((err) => {
        if (current().id !== id || sections.has(id)) return;
        drawn = "";
        page.replaceChildren(Object.assign(document.createElement("div"), { className: "page-in", innerHTML: oops(err, true) }));
      });
      return;
    }
    const key = `${id}/${rest.join("/")}`;
    const fresh = key !== drawn;
    drawn = key;
    const token = ++drawing;
    // (a first visit to a screen: a quiet placeholder while it loads, not the last screen's words)
    if (fresh) {
      page.replaceChildren(Object.assign(document.createElement("div"), { className: "page-in", innerHTML: skeleton() }));
      head({ title: s.title || s.name, tile: s.tile });
    }
    const box = document.createElement("div");
    box.className = "page-in";
    const bar = { title: s.title || s.name, back: "", action: null, tile: s.tile };
    const ui = { title: (t) => (bar.title = t), back: (href) => (bar.back = href), action: (a) => (bar.action = a), token: () => token === drawing };
    try {
      await s.draw(box, rest, ui);
    } catch (err) {
      if (err.signIn) signInCard(box, key);
      else {
        console.warn("Nova Phone:", err);
        box.innerHTML = oops(err, true);
      }
    }
    if (token !== drawing) return;
    page.replaceChildren(box);
    head(bar);
    remember(key, bar);
    if (onAlerts()) alertsSeen();
    loadRest();
    afterFirst();
    if (typeof s.bottom === "function" ? s.bottom(rest) : s.bottom) page.scrollTop = page.scrollHeight;
    else if (fresh) page.scrollTop = 0;
  }
  // The title bar: Back (a screen inside another), the title, one action
  function head({ title: t, back, action, tile }) {
    title.innerHTML = `${tile && window.NovaTile ? window.NovaTile(tile) : ""}${esc(t)}`;
    document.title = t === "Nova Phone" ? t : `${t} · Nova Phone`;
    // (Back on a screen inside another; on a main screen, More: every place and the look)
    left.innerHTML = back ? `<a class="icon-btn" href="${esc(back)}" aria-label="Back">${icon("back")}</a>` : `<a class="icon-btn more-btn${current().id === "more" ? " lit" : ""}" href="#more" aria-label="More: you, every place, settings and the look">${icon("more")}</a>`;
    if (!back) paintMe();
    right.innerHTML = action ? (action.href ? `<a class="icon-btn lit" href="${esc(action.href)}" aria-label="${esc(action.label)}">${icon(action.icon || "plus")}</a>` : `<button type="button" class="icon-btn lit" aria-label="${esc(action.label)}">${icon(action.icon || "plus")}</button>`) : "";
    if (action && action.run) right.querySelector("button").addEventListener("click", action.run);
  }
  addEventListener("hashchange", show);
  page.addEventListener("click", (e) => { if (e.target.closest("[data-again]")) { drawn = ""; show(); } });
  // (back to the app after a while away: what's on screen brought up to date)
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60000 && !page.querySelector("input:focus, textarea:focus, [contenteditable]:focus, form.dirty")) show();
  });

  // ---- The server: the same addresses and sign-in as the computer version ----
  async function api(path, opts = {}) {
    const { headers, ...rest } = opts;
    let res;
    try {
      res = await fetch(path, { credentials: "same-origin", ...rest, headers: { Accept: "application/json", ...(typeof rest.body === "string" ? { "Content-Type": "application/json" } : {}), ...(headers || {}) } });
    } catch (e) {
      throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true });
    }
    // (401: not signed in. 403 is "not for this sign-in": an error the place shows in its own words)
    if (res.status === 401) {
      if (String(path).startsWith("/auth/me")) { store.set(ME, ""); paintMe(); }
      throw Object.assign(new Error("Sign in first"), { signIn: true });
    }
    const data = res.headers.get("content-type")?.includes("json") ? await res.json().catch(() => null) : await res.text();
    if (!res.ok) throw Object.assign(new Error((data && (data.error || data.message)) || `Something went wrong (${res.status})`), { status: res.status, data });
    // (the tiles' numbers, and who you are, from what was fetched anyway)
    if (data && typeof data === "object") watch(path, (rest.method || "GET").toUpperCase(), data);
    return data;
  }
  const post = (path, body, headers) => api(path, { method: "POST", body: JSON.stringify(body || {}), headers });

  // ---- The parts ----
  const skeleton = (n = 4) => `<div class="skel" aria-label="Loading">${"<i></i>".repeat(n + 1)}</div>`;
  const empty = ({ icon: ic = "star", title: t, text = "", action = "" }) => `<div class="empty">${icon(ic)}<b>${esc(t)}</b>${text ? `<span>${esc(text)}</span>` : ""}${action}</div>`;
  function oops(err, again) {
    const offline = err && err.offline;
    return `<div class="empty oops">${icon(offline ? "globe" : "refresh")}<b>${offline ? "No connection" : "That didn't load"}</b><span>${esc(offline ? "Check your signal, then try again." : err?.message || "")}</span>${again ? `<button type="button" class="btn" data-again>${icon("refresh")} Try again</button>` : ""}</div>`;
  }
  // A list row: { href | button (data-* string), lead (html), title, text, end (html), edge colour, cls }
  function row(r) {
    const inner = `${r.lead !== undefined ? `<span class="row-lead${r.dot ? " dot" : ""}">${r.lead}</span>` : `<span class="row-lead">${icon(r.icon || "next")}</span>`}<span class="row-main"><b>${esc(r.title)}</b>${r.text ? `<span>${esc(r.text)}</span>` : ""}${r.html || ""}</span><span class="row-end">${r.end ?? ""}${r.href ? icon("next") : ""}</span>`;
    const style = r.color ? ` data-c="${esc(r.color)}"` : "";
    const cls = `row${r.color ? " edge" : ""}${r.cls ? ` ${r.cls}` : ""}`;
    return `<li>${r.href ? `<a class="${cls}" href="${esc(r.href)}"${style}>${inner}</a>` : r.button ? `<button type="button" class="${cls}" ${r.button}${style}>${inner}</button>` : `<div class="${cls}"${style}>${inner}</div>`}</li>`;
  }
  const list = (rows) => `<ul class="list">${rows.join("")}</ul>`;
  // (a row's colour, from data-c, set the only way the page's rules allow: in the script, not written inside)
  const COLORS = { rose: "#FF8CC6", magenta: "#FF5FA8", violet: "#C7A4FF", indigo: "#8C9BFF", blue: "#4CC9FF", teal: "#3DF5B8", green: "#7BE38A", amber: "#FFC069", orange: "#FF9A5C", red: "#FF6B81", grey: "#A9A3B5", gold: "#F2D9A0" };
  function paint(root) {
    for (const el of root.querySelectorAll("[data-c]")) el.style.setProperty("--c", COLORS[el.dataset.c] || el.dataset.c);
  }
  new MutationObserver(() => paint(document.body)).observe(document.body, { childList: true, subtree: true });
  // Fields: { label, name, type, value, required, placeholder, hint, rows, options: [[value, label]], attrs }
  function field(f) {
    const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
    const common = `id="${id}" name="${esc(f.name)}"${f.required ? " required" : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${f.attrs ? ` ${f.attrs}` : ""}`;
    const control = f.type === "textarea" ? `<textarea class="input" ${common} rows="${f.rows || 4}">${esc(f.value ?? "")}</textarea>`
      : f.type === "select" ? `<select class="input" ${common}>${(f.options || []).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`
      : `<input class="input" type="${f.type || "text"}" ${common} value="${esc(f.value ?? "")}"${f.type === "number" ? ' inputmode="decimal"' : ""}${f.type === "email" ? ' autocomplete="email"' : ""}>`;
    return `<label class="field" for="${id}"><span>${esc(f.label)}</span>${control}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`;
  }
  const toggle = (f) => `<label class="switch"><span>${esc(f.label)}</span><input type="checkbox" role="switch" name="${esc(f.name)}"${f.checked ? " checked" : ""}></label>`;
  const choices = (f) => `<fieldset class="field"><legend>${esc(f.label)}</legend><div class="seg">${f.options.map(([v, l]) => `<label><input type="radio" name="${esc(f.name)}" value="${esc(v)}"${String(v) === String(f.value) ? " checked" : ""}>${esc(l)}</label>`).join("")}</div></fieldset>`;
  // (writing boxes grow with what's written, so nothing scrolls inside them)
  function grow(el) { el.style.setProperty("height", "auto"); el.style.setProperty("height", `${Math.max(el.scrollHeight + 2, 52)}px`); }
  document.addEventListener("input", (e) => {
    if (e.target.matches("textarea.input")) grow(e.target);
    const f = e.target.closest("form");
    if (f) f.classList.add("dirty");
  });
  new MutationObserver(() => { for (const t of document.querySelectorAll("textarea.input:not([data-grown])")) { t.dataset.grown = "1"; requestAnimationFrame(() => grow(t)); } }).observe(document.body, { childList: true, subtree: true });

  // A toast: a word that comes and goes
  let toastTimer = 0;
  // toast(text, bad, { action: "Undo", run }): with a button inside it that runs fn and hides the toast (it stays
  // up about 6.5 s so there's time to press it)
  function toast(text, bad = false, extra = null) {
    // (a sound for it, when sounds are on: something done, sent, deleted or gone wrong; and it goes on the list
    // of what you've been doing)
    sound(bad ? "error" : /\b(sent|posted|emailed|shared)\b/i.test(text) ? "send" : /\b(deleted|removed)\b/i.test(text) ? "remove" : "done");
    if (!bad) activity(text);
    toastEl.textContent = text;
    toastEl.classList.toggle("bad", bad);
    const act = extra && extra.action && typeof extra.run === "function";
    toastEl.classList.toggle("has-action", !!act);
    if (act) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "toast-action";
      b.textContent = extra.action;
      b.addEventListener("click", () => { clearTimeout(toastTimer); toastEl.hidden = true; try { extra.run(); } catch (err) { console.warn("Nova Phone:", err); } });
      toastEl.append(b);
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), act ? 6500 : bad ? 4500 : 2600);
  }
  // A sheet from the bottom. confirm(): resolves true or false. choose(): the chosen value, or null.
  // (one sheet at a time: a sheet's own close never answers the next one, and a sheet opened over another
  // answers the first with nothing)
  let sheetAnswer = null;
  function openSheet(html, wire) {
    if (sheetAnswer) sheetAnswer(null);
    return new Promise((resolve) => {
      let answered = false;
      const answer = (v) => { if (answered) return; answered = true; if (sheetAnswer === answer) sheetAnswer = null; resolve(v); };
      sheetAnswer = answer;
      sheet.innerHTML = `<div class="sheet-in">${html}</div>`;
      const done = (v) => { sheet.onclose = null; if (sheet.open) sheet.close(); answer(v); };
      sheet.onclose = () => answer(null);
      sheet.onclick = (e) => { if (e.target === sheet) done(null); };
      wire(sheet, done);
      if (!sheet.open) sheet.showModal();
    });
  }
  const confirm = ({ title: t, text = "", ok = "OK", danger = false }) => openSheet(
    `<h2 class="sheet-title">${esc(t)}</h2>${text ? `<p class="sheet-text">${esc(text)}</p>` : ""}<div class="btns"><button type="button" class="btn wide ${danger ? "danger" : "main"}" data-yes>${esc(ok)}</button><button type="button" class="btn wide quiet" data-no>Cancel</button></div>`,
    (el, done) => { el.querySelector("[data-yes]").onclick = () => done(true); el.querySelector("[data-no]").onclick = () => done(false); },
  ).then((v) => v === true);
  const choose = ({ title: t, options }) => openSheet(
    `<h2 class="sheet-title">${esc(t)}</h2><div class="btns">${options.map(([v, l, tone]) => `<button type="button" class="btn wide${tone ? ` ${tone}` : ""}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}<button type="button" class="btn wide quiet" data-no>Cancel</button></div>`,
    (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); },
  );
  const form = (html, wire) => openSheet(html, wire);

  // A button doing something: off while it works, its words saying so
  async function busy(btn, words, fn) {
    const was = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = words;
    try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = was; } }
  }

  // ---- Days, times and money, the studio's way ----
  const pad = (n) => String(n).padStart(2, "0");
  const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = () => localStamp(new Date()).slice(0, 10);
  // (a date in words, "2026-10-23 09:00:00" from the database (UTC), or a number: seconds or milliseconds)
  const asDate = (v) => {
    if (!v) return null;
    if (typeof v === "number" || /^\d{9,13}$/.test(String(v))) { const n = Number(v); return new Date(n < 1e12 ? n * 1000 : n); }
    const s = String(v); const d = new Date(/^\d{4}-\d\d-\d\d \d/.test(s) ? s.replace(" ", "T") + "Z" : s); return isNaN(d) ? null : d;
  };
  function ago(v) {
    const d = asDate(v);
    if (!d) return "";
    const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) return t;
    if (Date.now() - d < 6 * 864e5 && d < new Date()) return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${t}`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  }
  const money = (p) => `£${((Number(p) || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

  // Signed out: the sign-in, which comes back here after
  function signInCard(box, back = "") {
    box.innerHTML = `<div class="card"><p class="kicker">Nova Phone</p><h2 class="card-title">Sign in to carry on</h2><p class="muted">The same sign-in as Nova Desk.</p></div>
      <a class="btn main wide" href="#signin/${esc(back)}">Sign in</a>`;
  }

  // The service worker: Nova's files kept on the phone between visits (fetched again only when they change)
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {}));

  // Opened from the Home Screen: notifications tapped later open Nova Phone (the service worker asks "nova-home")
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) caches?.open("nova-home").then((c) => c.put("/home", new Response("phone"))).catch(() => {});
  // A tapped notification that opened Nova Phone (/phone/?open=<Nova's address>): that place
  const opened = new URLSearchParams(location.search).get("open");
  if (opened) {
    history.replaceState(null, "", location.pathname + location.hash);
    load("notices.js").then(() => { location.hash = (window.NovaPhone.place && window.NovaPhone.place(opened)) || "#inbox/alerts"; }).catch(() => (location.hash = "#inbox/alerts"));
  }

  // The bar now, then the screen asked for (its code loads first)
  drawTiles();
  queueMicrotask(show);

  window.NovaPhone = {
    section, has: (id) => sections.has(id) || !!FILES[id], show, css, badge, api, post, esc, icon, row, list, field, toggle, choices, empty, oops, skeleton,
    toast, confirm, choose, form, busy, today, localStamp, asDate, ago, money, initials, signInCard, paint,
    // Nova Phone as a whole (the shell): sound(kind) plays one of Nova Phone's calm sounds when sounds are on;
    // look: the theme for Nova Phone and Nova Desk (look.js); options()/setOption(k, v): Nova Phone's own
    // settings; badges(): every tile's number; history(): the places you've been; activity(text?): what you've
    // been doing (adds one); me(): who's signed in, as last seen; refresh(): everything again; voice(): say what
    // to do; script(file): a file of Nova Phone's, run once; asset(path): one of Nova's shared files
    sound, get look() { return window.NovaPhoneLook || null; }, options, setOption, badges: () => ({ ...badges, today: badgeOf("today") }),
    history: () => stored(HIST, []), activity, me, script: load, count: (path, data) => watch(path, "GET", data), seen: () => ({ ...seen }), asset, installOffer: () => installOffer, clearInstallOffer: () => (installOffer = null),
    refresh: () => (window.NovaPhoneShell ? window.NovaPhoneShell.refresh() : ((drawn = ""), show())),
    voice: () => load("voice.js").then(() => window.NovaPhoneVoice.open()),
  };
})();
