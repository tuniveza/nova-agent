// Portal's sections as a tab bar across the top (a computer or a tablet; portal.css draws it).
// When the tabs don't all fit, the bar scrolls sideways:
//   - soft fades at the edge that has more tabs past it (the .more-left / .more-right classes),
//   - the mouse wheel scrolls it sideways (up and down turn into left and right),
//   - the chosen tab is kept in view.
// From the keyboard: Left and Right (or Up and Down) move between the tabs, Home and End go to the
// first and last; Tab still goes through them in order, and Enter or Space opens one.
// On a phone the bar is the one along the bottom, with More, and none of this gets in its way.
(() => {
  "use strict";
  const bar = document.querySelector("nav.tabs");
  if (!bar) return;
  const WIDE = matchMedia("(min-width: 761px)");
  // The tab bar is on (not the side menu: Options → Menu)
  const topTabs = () => WIDE.matches && document.documentElement.getAttribute("data-menu") !== "side";
  const STILL = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const top = document.querySelector(".app > .top");

  // The header's height, so the bar sits just under it (inside Nova Agent there's no header)
  function measure() {
    const h = top && getComputedStyle(top).display !== "none" ? top.offsetHeight : 0;
    root.style.setProperty("--top-h", `${h}px`);
    root.style.setProperty("--htabs-h", `${topTabs() ? bar.offsetHeight : 0}px`);
  }

  // The fades: only on a side that has more tabs to scroll to
  function edges() {
    const room = bar.scrollWidth - bar.clientWidth;
    const on = topTabs() && room > 2;
    bar.classList.toggle("more-left", on && bar.scrollLeft > 2);
    bar.classList.toggle("more-right", on && bar.scrollLeft < room - 2);
  }

  // The tabs you can see and use right now (not hidden, not the phone's More)
  const usable = () => [...bar.querySelectorAll(".tab")].filter((t) => !t.hidden && t.offsetParent !== null && getComputedStyle(t).display !== "none");

  // Bring a tab into view, without moving the page up or down
  function reveal(tab, smooth = true) {
    if (!tab || !topTabs()) return;
    const left = tab.offsetLeft - 32;
    const right = tab.offsetLeft + tab.offsetWidth + 32 - bar.clientWidth;
    const to = bar.scrollLeft > left ? left : bar.scrollLeft < right ? right : null;
    if (to !== null) bar.scrollTo({ left: Math.max(0, to), behavior: smooth && !STILL.matches ? "smooth" : "auto" });
  }

  // The wheel: up and down scroll the bar sideways (a sideways swipe on a trackpad just works)
  bar.addEventListener("wheel", (e) => {
    if (!topTabs() || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const room = bar.scrollWidth - bar.clientWidth;
    if (room <= 2) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    const next = Math.max(0, Math.min(room, bar.scrollLeft + dy));
    if (next === bar.scrollLeft) return; // at the end already: let the page scroll
    e.preventDefault();
    bar.scrollLeft = next;
  }, { passive: false });

  // The keyboard: arrows, Home and End between the tabs
  bar.addEventListener("keydown", (e) => {
    if (!topTabs() || e.altKey || e.ctrlKey || e.metaKey) return;
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last" };
    if (!(e.key in keys) || !e.target.closest(".tab")) return;
    const tabs = usable();
    const at = tabs.indexOf(e.target.closest(".tab"));
    if (at < 0 || !tabs.length) return;
    const k = keys[e.key];
    const next = k === "first" ? tabs[0] : k === "last" ? tabs[tabs.length - 1] : tabs[(at + k + tabs.length) % tabs.length];
    e.preventDefault();
    next.focus({ preventScroll: true });
    reveal(next);
  });
  bar.addEventListener("focusin", (e) => { if (e.target.closest(".tab")) reveal(e.target.closest(".tab")); });

  // The chosen tab changes (app.js and portal.js mark it .active): keep it in view
  let shown = null;
  new MutationObserver(() => {
    const now = bar.querySelector(".tab.active");
    if (now && now !== shown) { shown = now; reveal(now); }
    edges();
  }).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });

  // ---- Two tidy rows (tabs on top): the groups, then that group's tabs ----
  // Row 1 has a pill for each group (Today, Studio, Plans, You, Admin) with the total of its
  // counts; row 2 shows the tabs of the group you're in, and tapping another group's pill shows
  // its tabs (a group with one tab just opens it). The settings icons sit at the end of row 1.
  // Only for the tab bar on a computer or tablet: the side menu and the phone's bar are as before.
  const groups = []; // { key, name, label (the .tab-group), tabs: [] }
  {
    let current = null;
    for (const el of [...bar.children]) {
      if (el.classList.contains("tab-group")) {
        const key = el.dataset.group || "";
        current = { key, name: key === "today" ? "Today" : el.textContent.trim(), label: el, tabs: [] };
        groups.push(current);
      } else if (el.classList.contains("tab") && current) current.tabs.push(el);
    }
  }
  const pillGroups = groups.filter((g) => g.key !== "settings");
  const row = document.createElement("div");
  row.className = "tg-row";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Sections");
  bar.prepend(row);
  // The settings icons sit at the end of row 1 (CSS order); this line break then starts row 2
  const brk = document.createElement("div");
  brk.className = "tg-break";
  brk.setAttribute("aria-hidden", "true");
  bar.append(brk);
  for (const g of groups) if (g.key === "settings") for (const t of g.tabs) t.classList.add("tg-set");
  let showing = null; // the group whose tabs row 2 shows (null: the chosen tab's group)
  const groupOf = (tab) => groups.find((g) => g.tabs.includes(tab));
  const shownTabs = (g) => g.tabs.filter((t) => !t.hidden);
  function drawGroups() {
    if (!topTabs()) {
      for (const g of groups) for (const t of g.tabs) t.classList.toggle("tg-hide", false); // toggle: no write (and no observer loop) when already off
      bar.classList.toggle("tg-solo", false);
      return;
    }
    const active = bar.querySelector(".tab.active");
    const activeGroup = active ? groupOf(active) : null;
    const open = showing || activeGroup || pillGroups[0];
    const pills = pillGroups.filter((g) => shownTabs(g).length).map((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tg-pill" + (g === activeGroup ? " active" : "") + (g === open && g !== activeGroup ? " open" : "");
      b.dataset.group = g.key;
      // its first tab's icon, then the name
      const icon = shownTabs(g)[0].querySelector("svg, img.tab-planet");
      if (icon) b.append(icon.cloneNode(true));
      const name = document.createElement("span");
      name.textContent = g.name;
      b.append(name);
      const count = shownTabs(g).reduce((n, t) => { const badge = t.querySelector(".badge:not([hidden])"); return n + (badge ? Number(badge.textContent) || 0 : 0); }, 0);
      if (count) {
        const c = document.createElement("span");
        c.className = "tg-count";
        c.textContent = String(count);
        b.append(c);
      }
      b.setAttribute("aria-pressed", String(g === open));
      return b;
    });
    const sig = pills.map((p) => p.className + p.textContent).join("|");
    if (row.dataset.sig !== sig) { row.replaceChildren(...pills); row.dataset.sig = sig; }
    for (const g of groups) for (const t of g.tabs) t.classList.toggle("tg-hide", g.key !== "settings" && g !== open);
    // A group with one tab (Today, You, Admin): its pill says it all, so no second row
    bar.classList.toggle("tg-solo", shownTabs(open).length <= 1);
  }
  row.addEventListener("click", (e) => {
    const pill = e.target.closest(".tg-pill");
    if (!pill) return;
    const g = groups.find((x) => x.key === pill.dataset.group);
    const tabs = g ? shownTabs(g) : [];
    if (!g || !tabs.length) return;
    // One tab (Today, You, Admin): straight there; more: show them
    if (tabs.length === 1) { showing = null; tabs[0].click(); }
    else { showing = g; drawGroups(); measure(); }
  });
  // The chosen tab moved (or counts changed): row 2 follows the chosen tab's group
  let lastActive = bar.querySelector(".tab.active");
  new MutationObserver(() => {
    const now = bar.querySelector(".tab.active");
    if (now !== lastActive) { lastActive = now; showing = null; }
    drawGroups();
  }).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], childList: true, characterData: true });

  bar.addEventListener("scroll", edges, { passive: true });
  const again = () => { drawGroups(); measure(); edges(); reveal(bar.querySelector(".tab.active"), false); };
  addEventListener("resize", again);
  WIDE.addEventListener("change", again);
  // Options → Menu changed (tabs on top or the side menu)
  addEventListener("novaoptionschange", again);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => { measure(); edges(); });
    ro.observe(bar);
    if (top) ro.observe(top);
  }
  again();
})();
