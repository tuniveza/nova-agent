// The status line: one line of small text along the bottom of the navigation bar, inside its frame, with
//   Nova Agent's version and build,
//   what changed lately, in a few still words, for the part of the bar you're on (Apps, Plans,
//     Tools, Helpers, or the panel that's open),
//   when you came on and when you were last off (remembered on this device),
//   what you've been doing lately (tap for the list), the date and a 12-hour clock.
// It stays there with a panel open (an app, a plan, a tool or a helper), showing that panel's news.
// The words come from web/shared/status-data.js (made by scripts/build-status.mjs).
// Also here: the look settings in the Panels window (theme for everything, planet colours, top bar).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const shell = $("shell");
  const DATA = window.NOVA_STATUS || { version: "", build: "", panels: {}, areas: {}, everything: [] };
  const PHONE = matchMedia("(max-width: 980px), (max-height: 480px)");
  if (!shell) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // Times and days are written the British way, in London time, whatever the browser's language
  const UK = { timeZone: "Europe/London" };
  const time12 = (d) => d.toLocaleTimeString("en-GB", { ...UK, hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([AP]M)$/i, (m, x) => " " + x.toLowerCase()).replace(/\s/g, " ");
  const weekday = (d, form = "short") => d.toLocaleDateString("en-GB", { ...UK, weekday: form });
  const sameDay = (a, b) => a.toLocaleDateString("en-GB", UK) === b.toLocaleDateString("en-GB", UK);
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (err) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) {} };

  // ---- On and off: each visit's start and end, remembered on this device ----
  const SESS = "nova-sessions";
  const sessions = load(SESS, []).slice(-30);
  const me = { on: Date.now(), off: Date.now() };
  sessions.push(me);
  const saveSessions = () => { me.off = Date.now(); store(SESS, sessions.slice(-30)); };
  saveSessions();
  setInterval(saveSessions, 30000);
  addEventListener("pagehide", saveSessions);
  document.addEventListener("visibilitychange", () => document.hidden && saveSessions());
  const lastOff = () => { const before = sessions[sessions.length - 2]; return before ? before.off : null; };

  // ---- What you've been doing (newest first), remembered on this device ----
  const ACT = "nova-activity";
  let activity = load(ACT, []).slice(0, 40);
  function did(text) {
    if (activity[0] && activity[0].text === text && Date.now() - activity[0].t < 60000) return;
    activity.unshift({ t: Date.now(), text });
    activity = activity.slice(0, 40);
    store(ACT, activity);
    drawActivity();
  }
  window.NovaActivity = { add: did, list: () => activity.slice() };

  // ---- The line itself ----
  const line = document.createElement("footer");
  line.className = "status-line";
  line.id = "status-line";
  line.setAttribute("aria-label", "Status");
  // Small line icons, one for each part
  const ICON = {
    ver: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    news: '<path d="M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    here: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>',
    left: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    act: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    date: '<rect x="4" y="5.5" width="16" height="14" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  };
  const ico = (k) => `<svg class="sl-ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  line.innerHTML = `
    <span class="sl-item sl-ver" title="Nova Agent v${esc(DATA.version)}, build ${esc(DATA.build)}${DATA.date ? ` (${esc(DATA.date)})` : ""}">${ico("ver")}v${esc(DATA.version)}</span>
    <span class="sl-item sl-news" title="What's new">${ico("news")}<span class="sl-area"></span><span class="sl-track"><span class="sl-words"></span></span></span>
    <span class="sl-item sl-sess" title="When you came on, and when you last left (on this device)">${ico("here")}<span class="sl-on"></span></span>
    <span class="sl-item sl-left">${ico("left")}<span class="sl-off"></span></span>
    <button type="button" class="sl-item sl-act" data-sfx="open" aria-haspopup="true" aria-expanded="false" title="What you've been doing (tap for the list)">${ico("act")}<span class="sl-act-text"></span></button>
    <span class="sl-item sl-date" title="Today's date">${ico("date")}<time class="sl-day"></time></span>
    <span class="sl-item sl-time">${ico("clock")}<time class="sl-clock"></time></span>`;
  const list = document.createElement("div");
  list.className = "sl-list";
  list.setAttribute("data-fit", ""); // (kept on screen by /shared/fit.js)
  list.hidden = true;
  list.setAttribute("role", "dialog");
  list.setAttribute("aria-label", "What you've been doing");
  document.body.append(list);

  // Where it goes: always the bottom row of the navigation bar, inside its frame (one joined unit,
  // the same on the home and with any panel open): the panels strip on a computer, the bar along
  // the bottom on a phone. Only the line moves (moving a panel's frame would reload it).
  const viewer = $("viewer");
  const inPanel = () => Boolean(viewer && !viewer.hidden && $("main") && $("main").classList.contains("viewing"));
  function place() {
    const box = PHONE.matches ? $("tabbar") : $("suite-home");
    line.classList.toggle("sl-in-panel", inPanel());
    if (box && line.parentElement !== box) box.append(line);
    else if (!box && line.parentElement !== shell) shell.append(line);
  }
  place();
  PHONE.addEventListener("change", place);
  // A panel opens or closes: follow it
  if ($("main")) new MutationObserver(place).observe($("main"), { attributes: true, attributeFilter: ["class"] });
  if (viewer) new MutationObserver(place).observe(viewer, { attributes: true, attributeFilter: ["hidden"] });
  // The phone's bar redraws itself now and then: keep the line in it (when no panel is open)
  const barNow = $("tabbar");
  if (barNow) new MutationObserver(() => PHONE.matches && !barNow.contains(line) && barNow.append(line)).observe(barNow, { childList: true });


  // The date ("Mon 12 Oct") and the clock ("5:45 pm"); with the date switched off, the clock keeps
  // the day ("Mon 5:45 pm") as before
  const clock = line.querySelector(".sl-clock");
  const day = line.querySelector(".sl-day");
  function tick() {
    const d = new Date();
    const noDate = (line.dataset.hide || "").split(" ").includes("date");
    day.textContent = d.toLocaleDateString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short" });
    day.dateTime = d.toLocaleDateString("en-CA", UK);
    clock.textContent = noDate ? `${weekday(d)} ${time12(d)}` : time12(d);
    clock.dateTime = d.toISOString();
    clock.title = day.title = d.toLocaleDateString("en-GB", { ...UK, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  tick();
  // (the date switched on or off in the settings)
  new MutationObserver(tick).observe(line, { attributes: true, attributeFilter: ["data-hide"] });
  setTimeout(() => { tick(); setInterval(tick, 60000); }, (60 - new Date().getSeconds()) * 1000);

  // On / off
  const onEl = line.querySelector(".sl-on");
  const offEl = line.querySelector(".sl-off");
  const leftItem = line.querySelector(".sl-left");
  const when = (t) => { const d = new Date(t); return sameDay(d, new Date()) ? time12(d) : `${weekday(d)} ${time12(d)}`; };
  function drawSession() {
    const off = lastOff();
    onEl.textContent = `Here since ${time12(new Date(me.on))}`;
    leftItem.hidden = !off;
    if (off) offEl.textContent = `Last left ${when(off)}`;
  }
  drawSession();

  // ---- One line, never cut short, never onto a second row (the Fixer's rules, 16 Oct 2026) ----
  // What's new and what you've been doing keep their widths (pointing along the bar never moves
  // anything): their words fit inside, smaller (What's new) or fewer (at least one word). If the
  // whole line is still wider than its place, its least needed parts step aside: the version first,
  // then Last left, Here since, the date, what you've been doing, What's new; the clock never.
  const firstWords = (t) => { const w = t.split(" "); return w.slice(1).map((_, i) => w.slice(0, w.length - 1 - i).join(" ")); };
  const lastWords = (t) => { const w = t.split(" "); return w.slice(1).map((_, i) => w.slice(i + 1).join(" ")); };
  function fitWords(el, box, variants, shrink) {
    const over = () => box.scrollWidth > box.clientWidth + 0.5;
    for (const v of variants) {
      el.textContent = v;
      el.style.fontSize = "";
      if (!box.offsetParent) return;
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (shrink && over() && size > 8) el.style.fontSize = `${(size -= 0.5)}px`;
      if (!over()) return;
    }
  }
  const SQUEEZE = [".sl-ver", ".sl-left", ".sl-sess", ".sl-date", ".sl-act", ".sl-news"];
  function squeeze() {
    for (const s of SQUEEZE) line.querySelector(s).classList.remove("sl-squeezed");
    for (const s of SQUEEZE) {
      if (line.scrollWidth <= line.clientWidth + 1) break;
      line.querySelector(s).classList.add("sl-squeezed");
    }
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(() => squeeze()).observe(line);
  addEventListener("resize", () => { const k = shownKey; shownKey = null; news(k); drawActivity(); squeeze(); });

  // Activity: the latest two in the line, the list on a tap
  const actBtn = line.querySelector(".sl-act");
  const actText = line.querySelector(".sl-act-text");
  function drawActivity() {
    const a = activity[0];
    const full = a ? `${a.text} · ${ago(a.t) === "now" ? "just now" : ago(a.t) + " ago"}` : "Nothing yet";
    actText.title = full;
    // (in its own width: the whole, then without when, then its last words, at least one)
    fitWords(actText, actText, a ? [full, a.text, ...lastWords(a.text)] : [full], false);
    if (!list.hidden) drawList();
  }
  function drawList() {
    list.innerHTML = `<h5>Lately</h5>` + (activity.length ? `<ol>${activity.slice(0, 14).map((a) => `<li><span>${esc(a.text)}</span><time>${time12(new Date(a.t))}</time></li>`).join("")}</ol>` : `<p>Nothing yet.</p>`) +
      `<h5>On and off</h5><ol>${sessions.slice(-6).reverse().map((x) => `<li><span>${weekday(new Date(x.on))} ${time12(new Date(x.on))}</span><time>${x === me ? "now" : time12(new Date(x.off))}</time></li>`).join("")}</ol>`;
  }
  actBtn.addEventListener("click", () => {
    list.hidden = !list.hidden;
    actBtn.setAttribute("aria-expanded", String(!list.hidden));
    if (!list.hidden) {
      drawList();
      const r = actBtn.getBoundingClientRect();
      list.style.left = `${Math.max(8, Math.min(innerWidth - 300, r.left))}px`;
      list.style.bottom = `${innerHeight - r.top + 8}px`;
    }
  });
  document.addEventListener("click", (e) => { if (!list.hidden && !list.contains(e.target) && !actBtn.contains(e.target)) { list.hidden = true; actBtn.setAttribute("aria-expanded", "false"); } });
  drawActivity();
  setInterval(drawActivity, 60000);

  // ---- What's new, for the part of the bar you're on ----
  const AREA_NAMES = { apps: "Apps", tasks: "Plans", tools: "Tools", helpers: "Helpers" };
  // An area's news names the panel it's about (the simple words come after)
  const PANEL_NAMES = { chat: "Nova Agent", portal: "Portal", calendar: "Calendar", notes: "Notes", index: "Index", quests: "Quests", missions: "Missions", lossless: "Lossless", visualizer: "Nova", observatory: "Observatory", manual: "Manual", look: "Look & sound" };
  const areaLabel = line.querySelector(".sl-area");
  const wordsEl = line.querySelector(".sl-words");
  let shownKey = null;
  function news(key) {
    if (key === shownKey) return;
    shownKey = key;
    let label = "New", items = DATA.everything || [];
    if (AREA_NAMES[key]) { const list = DATA.areas[key] || []; label = list[0] ? PANEL_NAMES[list[0].panel] : AREA_NAMES[key]; items = list.map((x) => x.words); }
    else if (PANEL_NAMES[key]) { label = PANEL_NAMES[key]; items = DATA.panels[key] || []; }
    areaLabel.textContent = label === "New" ? "New:" : `${label}:`;
    // Still, and as simple as it gets: the latest change in a few words
    const words = items.length ? simple(items[0]) : "All up to date";
    fitWords(wordsEl, wordsEl.parentElement, [words, ...firstWords(words)], true);
    wordsEl.title = items.join(" · ");
  }
  function simple(text) {
    let t = String(text).replace(/^[A-Z][a-z]+: /, "").replace(/[…,.;:!].*$/, "").replace(/^(the|a|an)\s+/i, "");
    const w = t.split(/\s+/).filter(Boolean).slice(0, 4);
    while (w.length > 1 && /^(and|or|the|a|an|of|to|in|on|for|with|at|by|from|itself|is|are)$/i.test(w[w.length - 1])) w.pop();
    t = w.join(" ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const keyOf = (path) => {
    const p = String(path || "");
    if (/quests/.test(p)) return "quests";
    if (/missions/.test(p)) return "missions";
    if (/pane:chat|^\/agent\/?$/.test(p)) return "chat";
    for (const k of ["portal", "calendar", "notes", "board", "console", "lossless", "visualizer", "observatory", "manual"]) if (p.includes(k)) return k;
    if (/memory|index/.test(p)) return "index";
    return "";
  };
  function home() {
    const open = document.querySelector("#suite-home .suite-app.open, #tabbar [data-tab][aria-current='page']");
    const viewing = $("main") && $("main").classList.contains("viewing");
    const key = viewing && open ? keyOf(open.dataset.tab || open.dataset.inside || open.getAttribute("href")) || "" : "";
    news(key);
    // The sky behind takes on the open app's colour (glow.css); the home: Quests or Missions when
    // they're the pane in view on a phone, Nova Agent's own otherwise
    const pane = $("main") && $("main").dataset.pane;
    document.documentElement.dataset.scene = key || (PHONE.matches && (pane === "quests" || pane === "missions") ? pane : "chat");
  }
  // Pointing at a group or a panel on the bar shows its news
  let back = null;
  document.addEventListener("pointerover", (e) => {
    const t = e.target.closest && e.target.closest("#suite-home .suite-group, #tabbar .tgroup, #suite-home .suite-app, #tabbar [data-tab]");
    if (!t) return;
    clearTimeout(back);
    const item = t.matches(".suite-app, [data-tab]") ? t : null;
    const k = item ? keyOf(item.dataset.tab || item.dataset.inside || (item.dataset.pane ? "pane:" + item.dataset.pane : "") || (item.dataset.act === "manual" ? "manual" : "") || item.getAttribute("href")) : "";
    const group = t.closest(".suite-group, .tgroup");
    const g = group ? (group.dataset.group || [...group.classList].find((c) => AREA_NAMES[c] && c !== "tools") || (group.classList.contains("tools") && !group.classList.contains("tasks") && !group.classList.contains("helpers") ? "tools" : "")) : "";
    news(k || g || "");
  });
  document.addEventListener("pointerout", (e) => {
    if (e.target.closest && e.target.closest("#suite-home, #tabbar")) { clearTimeout(back); back = setTimeout(home, 1500); }
  });
  home();

  // ---- Things worth remembering in "what you've been doing" ----
  const viewerName = $("viewer-name");
  if (viewerName) new MutationObserver(() => {
    if ($("main").classList.contains("viewing") && viewerName.textContent.trim()) did(`Opened ${viewerName.textContent.trim()}`);
    home();
  }).observe(viewerName, { childList: true, characterData: true, subtree: true });
  if ($("main")) new MutationObserver(home).observe($("main"), { attributes: true, attributeFilter: ["class", "data-pane"] });
  const form = document.querySelector(".composer");
  if (form) form.addEventListener("submit", () => did("Sent a message"), true);
  addEventListener("novalookchange", (e) => did(e.detail.planet ? "Planet colours" : e.detail.theme ? `Theme: ${(window.NovaLook.palette(e.detail.theme) || {}).name || e.detail.theme}` : "Each panel's own theme"));
  addEventListener("novasfxchange", (e) => e.detail && "extra" in e.detail ? did(`Quiet extras ${e.detail.extra ? "on" : "off"}`) : did(`Sounds ${e.detail.on ? "on" : "off"}`));
  addEventListener("novaambientchange", (e) => did(`Music ${e.detail.on ? "on" : "off"}`));
  try {
    // Someone signed in or out (the planet's channel): ask which
    new BroadcastChannel("nova-portal").addEventListener("message", () => fetch("/auth/me", { credentials: "same-origin", cache: "no-store" }).then((r) => did(r.ok ? "Signed in" : "Signed out")).catch(() => {}));
  } catch (err) {}

  // ---- The look, in the Panels window ----
  const look = $("look-settings");
  if (look && window.NovaLook) {
    const swatches = look.querySelector(".look-themes");
    swatches.innerHTML = `<button type="button" class="chip look-own" data-look-theme="" role="radio">Each panel's own</button>`;
    if (window.NovaSpectrum) {
      // The spectrum (spectrum.js): every theme in rainbow order, then Custom with its sliders.
      // Taps on a swatch are caught by the click handler below (they carry data-look-theme).
      window.NovaSpectrum.draw(swatches, {
        items: window.NovaLook.themes.map((t) => ({ id: t.id, name: t.name, tag: t.tag, palette: t })),
        attr: "lookTheme",
        role: "radio",
        onCustom: () => { window.NovaLook.setTheme("custom"); showLook(); },
      });
    } else {
      swatches.innerHTML += window.NovaLook.themes.map((t) => `<button type="button" class="look-swatch" role="radio" data-look-theme="${t.id}" title="${esc(t.name)}: ${esc(t.tag)}" style="--a:${t.accent};--b:${t.hi};--c:${t.accent3}"><i aria-hidden="true"></i><span>${esc(t.name)}</span></button>`).join("");
    }
    const planet = look.querySelector("#look-planet");
    function showLook() {
      const v = window.NovaLook.get();
      look.querySelectorAll("[data-look-theme]").forEach((b) => {
        const on = (b.dataset.lookTheme || null) === v.theme;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      planet.checked = v.planet;
      if (centerBox) centerBox.checked = v.center;
    }
    look.addEventListener("click", (e) => {
      const b = e.target.closest("[data-look-theme]");
      if (b) { window.NovaLook.setTheme(b.dataset.lookTheme || null); showLook(); }
    });
    planet.addEventListener("change", () => { window.NovaLook.setPlanet(planet.checked); showLook(); });
    const centerBox = look.querySelector("#look-center");
    if (centerBox) centerBox.addEventListener("change", () => { window.NovaLook.setCenter(centerBox.checked); showLook(); });
    addEventListener("novalookchange", showLook);
    // Chosen inside a panel (Portal's or Index's Options): show it here too
    addEventListener("storage", (e) => e.key === "nova-look" && showLook());
    showLook();
    // Keep the planet's colours fresh (a new planet in Portal shows up here)
    if (window.NovaLook.get().planet) window.NovaLook.refreshPlanet();
  }
})();

// ---- The status line: Auto (hides with the panels bar), Always shown or Always hidden, and each of
// its parts can be switched off. Chosen in the Panels window (and the phone's gear); kept on this device.
(() => {
  "use strict";
  const root = document.documentElement;
  const line = document.getElementById("status-line");
  if (!line) return;
  const MODES = { auto: "Auto", shown: "Always shown", hidden: "Always hidden" };
  const PARTS = { ver: "Version", news: "What's new", sess: "Here since", left: "Last left", act: "Activity", date: "Date", time: "Clock" };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (err) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) {} };
  let mode = load("nova-status", "auto");
  let hidden = load("nova-status-parts-off", []);
  function apply() {
    root.dataset.status = MODES[mode] ? mode : "auto";
    line.dataset.hide = hidden.join(" ");
    document.querySelectorAll("[data-status-mode]").forEach((b) => b.classList.toggle("active", b.dataset.statusMode === mode));
    document.querySelectorAll("[data-status-part]").forEach((c) => (c.checked = !hidden.includes(c.dataset.statusPart)));
  }
  // The choices, under the bars' choices in the Panels window
  const topRow = document.querySelector("[data-top-mode]");
  if (topRow) {
    const row = document.createElement("div");
    row.className = "bar-mode";
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "Status line");
    row.innerHTML = `<span>Status line</span>` + Object.entries(MODES).map(([k, v]) => `<button type="button" class="chip" role="radio" data-status-mode="${k}" data-sfx="tab">${v}</button>`).join("");
    const parts = document.createElement("div");
    parts.className = "bar-mode status-parts";
    parts.innerHTML = `<span>Show</span>` + Object.entries(PARTS).map(([k, v]) => `<label class="look-planet"><input type="checkbox" data-status-part="${k}" data-sfx="none"> ${v}</label>`).join("");
    topRow.parentElement.after(row, parts);
    row.addEventListener("click", (e) => { const b = e.target.closest("[data-status-mode]"); if (b) { mode = b.dataset.statusMode; store("nova-status", mode); apply(); } });
    parts.addEventListener("change", (e) => {
      const c = e.target.closest("[data-status-part]");
      if (!c) return;
      hidden = c.checked ? hidden.filter((x) => x !== c.dataset.statusPart) : [...new Set([...hidden, c.dataset.statusPart])];
      store("nova-status-parts-off", hidden);
      apply();
    });
  }
  window.NovaStatus = { mode: () => mode, next: () => { const k = Object.keys(MODES); mode = k[(k.indexOf(mode) + 1) % k.length]; store("nova-status", mode); apply(); return MODES[mode]; }, name: () => MODES[mode] };
  apply();
})();

// Opened as the Nova Agent phone app: notifications on this phone open Nova Agent (sw.js; the
// Portal phone app says "portal" the same way, in shared/inside.js)
(() => {
  const fromHomeScreen = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (fromHomeScreen && window.caches) caches.open("nova-home").then((c) => c.put("/home", new Response("agent"))).catch(() => {});
})();

// ---- Nova Agent's icon: the classic mark or the chat bubble (Panels window), kept on this device ----
(() => {
  "use strict";
  const root = document.documentElement;
  const row = document.querySelector(".look-icon");
  const KEY = "nova-agent-icon";
  const read = () => { try { return localStorage.getItem(KEY) === "chat" ? "chat" : "classic"; } catch (err) { return "classic"; } };
  function show(v) {
    root.dataset.agentIcon = v;
    if (row) row.querySelectorAll("[data-agent-icon]").forEach((b) => { const on = b.dataset.agentIcon === v; b.classList.toggle("active", on); b.setAttribute("aria-checked", String(on)); });
  }
  if (row) row.addEventListener("click", (e) => {
    const b = e.target.closest("[data-agent-icon]");
    if (!b) return;
    try { localStorage.setItem(KEY, b.dataset.agentIcon); } catch (err) {}
    show(b.dataset.agentIcon);
  });
  addEventListener("storage", (e) => e.key === KEY && show(read()));
  show(read());
})();
