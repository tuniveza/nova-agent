// The navigation panel (22 Oct 2026, the user: "I want a complete forward, backward and so on mobile and
// desktop navigation panel", "above the nova handle"): one row of buttons, the same on a phone and a
// computer, just above the Nova dock's handle.
//   Back / Forward  through every place you've been in Nova Agent: each panel you opened and each section
//                   in it (Portal's Inbox, then Money, then Calendar…), the way a browser goes back
//   Home            Nova Agent's own page (the open panel closes)
//   Reload          the open panel again (or Nova Agent's page)
//   History         the places you've been lately, newest first; a tap goes straight there
// Keys: Alt+← and Alt+→ go back and forward, as in a browser.
// Its own history, kept for this visit (sessionStorage), so a phone's own Back gesture (phone.js) and the
// browser's history are left as they were. A place's address is read from the open panel as it changes
// (sections change the address with replaceState, which adds nothing to the browser's history).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const viewer = $("viewer");
  // (the panel's frame, looked up each time: Nova Agent gives each panel it opens a frame of its own)
  const frameNow = () => $("viewer-frame");
  const shell = document.querySelector(".shell");
  if (!viewer || !frameNow() || !shell || $("nav-panel")) return;

  const KEY = "nova-nav";
  const HOME = "/agent/";
  let list = [];
  let at = -1;
  let settleUntil = 0; // (just after going somewhere: the address it lands on takes that place, not a new one)
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.list)) { list = s.list; at = Math.min(s.at, list.length - 1); }
  } catch (err) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ list, at })); } catch (err) {} };

  // Where you are now: the open panel's own address (and what it calls itself), or Nova Agent's page
  function here() {
    if (viewer.hidden) return { href: HOME, name: "Nova Agent", sub: "" };
    const frame = frameNow();
    let href = frame.getAttribute("src") || "";
    let sub = "";
    try {
      // (the panel's own address as it changes, once the page asked for is the one loaded: while a new
      // panel is still loading, the old one's address would be filed under the new one's name)
      const w = frame.contentWindow;
      const asked = new URL(href, location.origin).pathname;
      if (w && w.location && w.location.href !== "about:blank" && w.location.pathname === asked) {
        href = w.location.pathname + w.location.search + w.location.hash;
        sub = (frame.contentDocument && frame.contentDocument.title) || "";
      }
    } catch (err) { /* (another site's page: its first address) */ }
    const name = (($("viewer-name") && $("viewer-name").textContent) || "").replace(/\s+/g, " ").trim() || "Panel";
    // (one way of writing each address: "/calendar/", never the same place twice as two)
    try { const u = new URL(href, location.origin); if (u.origin === location.origin) href = u.pathname + u.search + u.hash; } catch (err) {}
    return { href, name, sub };
  }
  const label = (e) => {
    const sub = String(e.sub || "").replace(/\s*[·|–-]\s*Nova.*$/i, "").trim();
    return sub && sub.toLowerCase() !== e.name.toLowerCase() ? `${e.name} · ${sub}` : e.name;
  };

  function note() {
    const h = here();
    if (!h.href || h.href === "about:blank") return;
    const cur = list[at];
    if (cur && cur.href === h.href) {
      if (h.sub && cur.sub !== h.sub) { cur.sub = h.sub; save(); draw(); }
      return;
    }
    if (cur && Date.now() < settleUntil) {
      Object.assign(cur, h);
    } else {
      list = list.slice(0, at + 1);
      list.push({ ...h, t: Date.now() });
      if (list.length > 50) list.shift();
      at = list.length - 1;
    }
    save();
    draw();
  }

  // Going to a place you've been
  function go(i) {
    const e = list[i];
    if (!e) return;
    at = i;
    settleUntil = Date.now() + 2500;
    save();
    if (e.href === HOME) {
      if (!viewer.hidden) $("viewer-close").click();
    } else {
      let done = false;
      try {
        // (the same panel already open: a section of it, without loading the panel again)
        const w = frameNow().contentWindow;
        const want = new URL(e.href, location.origin);
        if (!viewer.hidden && w.location.pathname === want.pathname) {
          if (w.PortalPage && w.PortalPage.go) { w.PortalPage.go(want.pathname + want.search + want.hash, { replace: true }); done = true; }
          else if (w.location.search !== want.search || w.location.hash !== want.hash) { w.location.replace(want.href); done = true; }
          else done = true;
        }
      } catch (err) {}
      if (!done) {
        if (window.NovaAgent && window.NovaAgent.open) window.NovaAgent.open(e.href);
        else frameNow().src = e.href;
      }
    }
    draw();
  }
  const back = () => at > 0 && go(at - 1);
  const forward = () => at < list.length - 1 && go(at + 1);
  const home = () => { if (!viewer.hidden) $("viewer-close").click(); setTimeout(note, 50); };
  const reload = () => {
    if (viewer.hidden) return location.reload();
    const r = $("viewer-reload");
    if (r) r.click(); else frameNow().src = frameNow().src;
  };

  // ---- The row of buttons ----
  const ICON = {
    back: '<path d="M15 5l-7 7 7 7"/>',
    forward: '<path d="M9 5l7 7-7 7"/>',
    home: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>',
    reload: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4v4.5h-4.5"/>',
    list: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  };
  const nav = document.createElement("nav");
  nav.id = "nav-panel";
  nav.setAttribute("aria-label", "Navigation");
  nav.setAttribute("data-one-row", "");
  const button = (k, words, title) => `<button type="button" class="nav-btn" data-nav="${k}" title="${title}" aria-label="${title}" data-sfx="tab"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span class="nav-words">${words}</span></button>`;
  nav.innerHTML =
    button("back", "Back", "Back (Alt+←)") +
    button("forward", "Forward", "Forward (Alt+→)") +
    button("home", "Home", "Home: Nova Agent's page") +
    // (in the dock: room in the middle for the dock's handle, which sits on its top edge)
    `<span class="nav-gap" aria-hidden="true"></span>` +
    button("reload", "Reload", "Reload what's open") +
    button("list", "History", "Where you've been lately").replace('data-nav="list"', 'data-nav="list" aria-haspopup="menu" aria-expanded="false"') +
    button("apps", "Apps", "Apps: every panel, and you").replace('data-nav="apps"', 'data-nav="apps" aria-haspopup="dialog"') +
    `<span class="nav-where" aria-live="polite"></span>`;
  const menu = document.createElement("div");
  menu.className = "nav-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Where you've been lately");
  menu.setAttribute("data-fit", ""); // (kept on screen by /shared/fit.js)
  menu.hidden = true;
  document.body.append(menu);
  const btn = (k) => nav.querySelector(`[data-nav="${k}"]`);

  function draw() {
    btn("back").disabled = at <= 0;
    btn("forward").disabled = at >= list.length - 1;
    btn("home").disabled = viewer.hidden;
    const cur = list[at];
    const where = nav.querySelector(".nav-where");
    const text = cur ? label(cur) : "";
    if (where.textContent !== text) where.textContent = text;
    where.title = text;
    if (!menu.hidden) drawMenu();
  }
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };
  function drawMenu() {
    const rows = list.map((e, i) => ({ e, i })).reverse().slice(0, 15);
    menu.innerHTML = `<h5>Where you've been</h5>` + (rows.length ? rows.map(({ e, i }) =>
      `<button type="button" role="menuitem" class="nav-item${i === at ? " here" : ""}" data-go="${i}"${i === at ? ' aria-current="page"' : ""}><span>${esc(label(e))}</span><time>${i === at ? "here" : ago(e.t || Date.now())}</time></button>`).join("") : `<p>Nowhere yet.</p>`);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function openMenu(open) {
    menu.hidden = !open;
    btn("list").setAttribute("aria-expanded", String(open));
    if (!open) return;
    drawMenu();
    const r = btn("list").getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 308, r.left + r.width / 2 - 150))}px`;
    menu.style.bottom = `${Math.max(8, innerHeight - r.top + 8)}px`;
    const first = menu.querySelector(".nav-item.here") || menu.querySelector(".nav-item");
    if (first && matchMedia("(pointer: fine)").matches) first.focus({ preventScroll: true });
  }
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (!b || b.disabled) return;
    const k = b.dataset.nav;
    if (k === "back") back();
    else if (k === "forward") forward();
    else if (k === "home") home();
    else if (k === "reload") reload();
    else if (k === "list") openMenu(menu.hidden);
    else if (k === "apps") openApps();
  });
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    openMenu(false);
    go(Number(b.dataset.go));
  });
  document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && !btn("list").contains(e.target)) openMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { openMenu(false); btn("list").focus(); return; }
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowLeft" && at > 0) { e.preventDefault(); back(); }
    else if (e.key === "ArrowRight" && at < list.length - 1) { e.preventDefault(); forward(); }
  });

  // ---- Apps: every panel as a big tile, and you (your planet and name: your card, or Sign in) ----
  // (the same links as the Panels list, #suite a.suite-app, so each opens just as it always has)
  let sheet = null;
  function openApps() {
    if (!sheet) {
      sheet = document.createElement("dialog");
      sheet.id = "apps-sheet";
      sheet.className = "apps-sheet";
      sheet.setAttribute("aria-label", "Apps");
      sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
    }
    const me = document.querySelector(".sl-me");
    const meImg = me && me.querySelector(".sl-planet img:not([hidden])");
    const meName = ((me && me.querySelector(".sl-me-name") && me.querySelector(".sl-me-name").textContent) || "").trim();
    const head = document.createElement("div");
    head.className = "apps-head";
    head.innerHTML = `<button type="button" class="apps-me" data-sfx="open">${meImg ? `<img alt="" src="${esc(meImg.src)}">` : `<span class="apps-me-ghost" aria-hidden="true"></span>`}<span>${esc(meName || "Sign in")}</span></button><b class="apps-title">Apps</b><button type="button" class="apps-x" aria-label="Close" data-sfx="close">✕</button>`;
    head.querySelector(".apps-me").addEventListener("click", () => { sheet.close(); const p = document.querySelector(".sl-me .sl-planet"); if (p) p.click(); });
    head.querySelector(".apps-x").addEventListener("click", () => sheet.close());
    const grid = document.createElement("div");
    grid.className = "apps-grid";
    const seen = new Set();
    for (const a of document.querySelectorAll("#suite a.suite-app")) {
      const label = ((a.querySelector("b") && a.querySelector("b").textContent) || a.getAttribute("aria-label") || "").trim();
      const key = label + "|" + a.getAttribute("href") + "|" + (a.dataset.pane || a.dataset.act || "");
      if (!label || seen.has(key)) continue;
      seen.add(key);
      const t = document.createElement("button");
      t.type = "button";
      t.className = "apps-tile" + (a.classList.contains("open") || (a.classList.contains("here") && viewer.hidden) ? " here" : "");
      const ico = a.querySelector(".pico");
      if (ico) t.append(ico.cloneNode(true));
      const n = document.createElement("span");
      n.textContent = label;
      t.append(n);
      t.addEventListener("click", () => { sheet.close(); a.click(); });
      grid.append(t);
    }
    sheet.replaceChildren(head, grid);
    if (!sheet.isConnected) document.body.append(sheet);
    sheet.showModal();
  }

  // Its place, by the kind of screen (html[data-room], data-form from /shared/look.js; navpanel.css):
  //   a computer: the top row of the dock itself, one panel with it (22 Oct 2026, the user: "blend the nova
  //   navigation panel … into the nova dock"), its buttons either side of the dock's handle
  //   a phone or tablet upright: under the open panel, clear of the dock's handle
  //   a short screen (a phone on its side): its arrows and History in the title panel, as small icons (the
  //   title panel's own ← and ↻ are Home and Reload there): no row of its own, the page keeps its height
  const main = $("main");
  const suite = $("suite-home");
  const root = document.documentElement;
  const short = () => root.dataset.form === "phone-side" || (root.dataset.room === "phone" && innerHeight <= 500);
  // (the Simple look, 22 Oct 2026, the user's choice for phones: "one bar + Apps sheet": a slim title row at the
  // top, and at the bottom one bar, Back, Home, Forward, History and Apps; the Nova tiles make way, agent/simple.css)
  const simple = () => root.getAttribute("data-ui") !== "rich";
  function place() {
    const room = root.dataset.room || (matchMedia("(min-width: 981px) and (min-height: 481px)").matches ? "computer" : "phone");
    const left = document.querySelector(".shell > .topbar .top-side.left");
    let where;
    if (simple() && room === "phone") { where = "bar"; if (nav.parentElement !== shell) shell.append(nav); }
    else if (short() && left) { where = "title"; if (nav.parentElement !== left) left.append(nav); }
    else if (room === "computer" && suite && getComputedStyle(suite).display !== "none") { where = "dock"; if (nav.parentElement !== suite || suite.firstElementChild !== nav) suite.prepend(nav); }
    else { where = "panel"; if (nav.parentElement !== viewer) viewer.append(nav); }
    nav.dataset.where = where;
    root.dataset.nav = where;
    fitDock();
  }
  // (in a narrow dock the buttons go to their icons, their names still their labels; back to their names
  // when the dock is wide again: on Nova Agent's own page it's the whole width, round a panel it's narrower)
  function fitDock() {
    if (nav.dataset.where !== "dock") return nav.classList.remove("icons");
    nav.classList.remove("icons");
    // (what its buttons need side by side, against the room the dock's row has)
    const cs = getComputedStyle(nav);
    const kids = [...nav.children].filter((k) => getComputedStyle(k).display !== "none");
    const need = kids.reduce((n, k) => n + k.getBoundingClientRect().width, 0) + parseFloat(cs.columnGap || "0") * Math.max(0, kids.length - 1);
    const room = nav.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (need > room - 2) nav.classList.add("icons");
  }
  if (suite && "ResizeObserver" in window) {
    let w = 0;
    new ResizeObserver(() => { const now = Math.round(suite.clientWidth); if (now !== w) { w = now; requestAnimationFrame(fitDock); } }).observe(suite);
  }
  place();
  if (window.NovaForm && window.NovaForm.on) window.NovaForm.on(place);
  new MutationObserver(() => requestAnimationFrame(place)).observe(root, { attributes: true, attributeFilter: ["data-ui", "data-room", "data-form"] });
  addEventListener("resize", () => requestAnimationFrame(place));

  // Following where you go: panels opening and closing, and the open panel's own address changing
  new MutationObserver(() => setTimeout(note, 60)).observe(viewer, { attributes: true, attributeFilter: ["hidden"] });
  viewer.addEventListener("load", (e) => { if (e.target.tagName === "IFRAME") setTimeout(note, 120); }, true);
  // (not document.hidden: Nova Agent's page counts itself hidden while a panel covers it, to rest; a tab
  // that's truly out of sight has its timers slowed by the browser anyway)
  setInterval(() => { if (!viewer.hidden) note(); }, 700);
  addEventListener("popstate", () => setTimeout(note, 60));
  note();
  draw();
  window.NovaNav = { back, forward, home, reload, go, here, note, apps: openApps, get list() { return list.slice(); }, get at() { return at; } };
})();
