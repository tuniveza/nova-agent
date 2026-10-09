// The status line: one line of small text under the panels bar (inside the bar on a phone), with
//   Nova Agent's version and build,
//   what changed lately, in a few still words, for the part of the bar you're on (Apps, Tasks,
//     Tools, Helpers, or the panel that's open),
//   when you came on and when you were last off (remembered on this device),
//   what you've been doing lately (tap for the list), and a 12-hour clock.
// The words come from web/shared/status-data.js (made by scripts/build-status.mjs).
// Also here: the look settings in the Panels window (theme for everything, planet colours, top bar).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const shell = $("shell");
  const DATA = window.NOVA_STATUS || { version: "", build: "", panels: {}, areas: {}, everything: [] };
  const PHONE = matchMedia("(max-width: 980px), (max-height: 600px)");
  if (!shell) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const time12 = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([AP]M)$/i, (m, x) => " " + x.toLowerCase());
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
  line.innerHTML = `
    <span class="sl-ver" title="Nova Agent's version and build${DATA.date ? ` (${esc(DATA.date)})` : ""}">v${esc(DATA.version)} · ${esc(DATA.build)}</span>
    <span class="sl-news" aria-live="off"><span class="sl-area"></span><span class="sl-track"><span class="sl-words"></span></span></span>
    <span class="sl-sess" title="When you came on, and when you were last off (on this device)"></span>
    <button type="button" class="sl-act" data-sfx="open" aria-haspopup="true" aria-expanded="false" title="What you've been doing"></button>
    <time class="sl-clock"></time>`;
  const list = document.createElement("div");
  list.className = "sl-list";
  list.hidden = true;
  list.setAttribute("role", "dialog");
  list.setAttribute("aria-label", "What you've been doing");
  document.body.append(list);

  // Where it goes: under the panels strip (computer), inside the phone's bar (so they move together)
  function place() {
    const bar = $("tabbar");
    if (PHONE.matches && bar) { if (line.parentElement !== bar) bar.append(line); }
    else if (line.parentElement !== shell) shell.append(line);
  }
  place();
  PHONE.addEventListener("change", place);
  // The phone's bar redraws itself now and then: keep the line in it
  const barNow = $("tabbar");
  if (barNow) new MutationObserver(() => PHONE.matches && !barNow.contains(line) && barNow.append(line)).observe(barNow, { childList: true });


  // The clock
  const clock = line.querySelector(".sl-clock");
  function tick() {
    const d = new Date();
    clock.textContent = time12(d);
    clock.dateTime = d.toISOString();
    clock.title = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60000); }, (60 - new Date().getSeconds()) * 1000);

  // On / off
  const sess = line.querySelector(".sl-sess");
  function drawSession() {
    const off = lastOff();
    sess.textContent = `On ${time12(new Date(me.on))}${off ? ` · off ${time12(new Date(off))}` : ""}`;
  }
  drawSession();

  // Activity: the latest two in the line, the list on a tap
  const actBtn = line.querySelector(".sl-act");
  function drawActivity() {
    actBtn.textContent = activity.length ? activity.slice(0, 2).map((a) => `${a.text} ${ago(a.t)}`).join(" · ") : "No activity yet";
    if (!list.hidden) drawList();
  }
  function drawList() {
    list.innerHTML = `<h5>Lately</h5>` + (activity.length ? `<ol>${activity.slice(0, 14).map((a) => `<li><span>${esc(a.text)}</span><time>${time12(new Date(a.t))}</time></li>`).join("")}</ol>` : `<p>Nothing yet.</p>`) +
      `<h5>On and off</h5><ol>${sessions.slice(-6).reverse().map((x) => `<li><span>${new Date(x.on).toLocaleDateString([], { weekday: "short" })} ${time12(new Date(x.on))}</span><time>${x === me ? "now" : time12(new Date(x.off))}</time></li>`).join("")}</ol>`;
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
  const AREA_NAMES = { apps: "Apps", tasks: "Tasks", tools: "Tools", helpers: "Helpers" };
  const PANEL_NAMES = { chat: "Chat", portal: "Portal", calendar: "Calendar", notes: "Notes", index: "Index", quests: "Quests", missions: "Missions", lossless: "Lossless", visualizer: "Visualizer", observatory: "Observatory", manual: "Manual", look: "Look & sound" };
  const areaLabel = line.querySelector(".sl-area");
  const wordsEl = line.querySelector(".sl-words");
  let shownKey = null;
  function news(key) {
    if (key === shownKey) return;
    shownKey = key;
    let label = "New", items = DATA.everything || [];
    if (AREA_NAMES[key]) { label = AREA_NAMES[key]; items = (DATA.areas[key] || []).map((x) => `${PANEL_NAMES[x.panel]}: ${x.words}`); }
    else if (PANEL_NAMES[key]) { label = PANEL_NAMES[key]; items = DATA.panels[key] || []; }
    areaLabel.textContent = label;
    // Still, and as simple as it gets: the latest change in a few words
    wordsEl.textContent = items.length ? simple(items[0]) : "All up to date";
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
    for (const k of ["portal", "calendar", "notes", "lossless", "visualizer", "observatory", "manual"]) if (p.includes(k)) return k;
    if (/memory|index/.test(p)) return "index";
    return "";
  };
  function home() {
    const open = document.querySelector("#suite-home .suite-app.open, #tabbar [data-tab][aria-current='page']");
    const viewing = $("main") && $("main").classList.contains("viewing");
    news(viewing && open ? keyOf(open.dataset.tab || open.dataset.inside || open.getAttribute("href")) || "" : "");
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
    swatches.innerHTML = `<button type="button" class="chip look-own" data-look-theme="" role="radio">Each panel's own</button>` +
      window.NovaLook.themes.map((t) => `<button type="button" class="look-swatch" role="radio" data-look-theme="${t.id}" title="${esc(t.name)}: ${esc(t.tag)}" style="--a:${t.accent};--b:${t.hi};--c:${t.accent3}"><i aria-hidden="true"></i><span>${esc(t.name)}</span></button>`).join("");
    const planet = look.querySelector("#look-planet");
    function showLook() {
      const v = window.NovaLook.get();
      look.querySelectorAll("[data-look-theme]").forEach((b) => {
        const on = (b.dataset.lookTheme || null) === v.theme;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", String(on));
      });
      planet.checked = v.planet;
    }
    look.addEventListener("click", (e) => {
      const b = e.target.closest("[data-look-theme]");
      if (b) { window.NovaLook.setTheme(b.dataset.lookTheme || null); showLook(); }
    });
    planet.addEventListener("change", () => { window.NovaLook.setPlanet(planet.checked); showLook(); });
    addEventListener("novalookchange", showLook);
    showLook();
    // Keep the planet's colours fresh (a new planet in Portal shows up here)
    if (window.NovaLook.get().planet) window.NovaLook.refreshPlanet();
  }
})();
