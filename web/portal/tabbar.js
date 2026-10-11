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
  const usable = () => [...bar.querySelectorAll(".tab")].filter((t) => !t.hidden && t.offsetParent !== null && getComputedStyle(t).display !== "none")
    .map((t) => ({ t, r: t.getBoundingClientRect() }))
    .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 8 ? a.r.top - b.r.top : a.r.left - b.r.left)) // as they're laid out
    .map((x) => x.t);

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

  // ---- Every section at once (tabs on top): whole groups side by side, never split mid-line ----
  // Each group (Today · Studio · Plans · You · Admin · the settings icons) stays together: when the
  // next group doesn't fit on the line, it starts a new one (a .tg-br line break); groups sharing a
  // line get a thin divider between them (.tg-div). A group with one tab needs no label (its tab
  // says it). The big group (Studio) comes after the small ones, on a line of its own; when it's
  // wider than a line it splits into even halves (.tg-mid), never one tab left on its own.
  // Only for the tab bar on a computer or tablet: the side menu and the phone's bar are as before.
  const groups = []; // { key, label (the .tab-group), tabs: [], br, div }
  {
    let current = null;
    for (const el of [...bar.children]) {
      if (el.classList.contains("tab-group")) { current = { key: el.dataset.group || "", label: el, tabs: [] }; groups.push(current); }
      else if (el.classList.contains("tab") && current) current.tabs.push(el);
    }
  }
  for (const g of groups) {
    g.br = document.createElement("div");
    g.br.className = "tg-br";
    g.div = document.createElement("div");
    g.div.className = "tg-div";
    for (const el of [g.br, g.div]) el.setAttribute("aria-hidden", "true");
    g.label.before(g.br, g.div);
    g.mid = document.createElement("div");
    g.mid.className = "tg-br tg-mid";
    g.mid.setAttribute("aria-hidden", "true");
  }
  // The big group: the one with the most tabs (Studio)
  const big = groups.reduce((m, g) => (!m || g.tabs.length > m.tabs.length ? g : m), null);
  for (const g of groups) {
    g.later = g === big && g.tabs.length >= 5;
    if (g.later) for (const el of [g.br, g.div, g.label, ...g.tabs, g.mid]) el.classList.add("tg-later");
  }
  const order = [...groups.filter((g) => !g.later), ...groups.filter((g) => g.later)];
  // Only write a class when it changes (so the observer below doesn't go round and round)
  const set = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };
  const seen = (el) => !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== "none";
  function pack() {
    const on = topTabs();
    set(bar, "tg-packed", on);
    if (!on) return;
    for (const g of groups) set(g.label, "tg-quiet", g.tabs.filter((t) => !t.hidden).length <= 1);
    const cs = getComputedStyle(bar);
    const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1;
    const gap = parseFloat(cs.columnGap) || 0;
    const ds = getComputedStyle(groups[0]?.div || bar);
    const divider = 1 + (parseFloat(ds.marginLeft) || 0) + (parseFloat(ds.marginRight) || 0) + 2 * gap;
    let used = 0;
    let first = true;
    const place = (g, items, widths, w, forceNew) => {
      // Too wide for a line: break it in the middle, so its two lines are even
      let split = -1;
      if (w > room) {
        let run = 0;
        for (let i = 0; i < items.length; i++) { run += widths[i] + gap; if (run >= w / 2) { split = Math.min(Math.max(i, 1), items.length - 1); break; } }
      }
      if (split > 0 && g.mid.nextElementSibling !== items[split]) items[split].before(g.mid);
      set(g.mid, "on", split > 0);
      const newLine = !first && (forceNew || used + divider + w > room);
      set(g.br, "on", newLine);
      set(g.div, "on", !first && !newLine);
      if (split > 0) used = widths.slice(split).reduce((n, x) => n + x, 0) + gap * (items.length - split - 1);
      else used = first || newLine ? w : used + divider + w;
      if (used > room) used = room;
      first = false;
    };
    // The small groups on the first line; one that doesn't fit there goes after the big group
    // (.tg-last), so it never sits on a line of its own between the others
    const after = [];
    for (const g of order) {
      const items = [g.label, ...g.tabs].filter(seen);
      if (!items.length) { for (const el of [g.br, g.div, g.mid]) set(el, "on", false); set(g.label, "tg-last", false); continue; }
      const widths = items.map((el) => el.getBoundingClientRect().width);
      const w = widths.reduce((n, x) => n + x, 0) + gap * (items.length - 1);
      const defer = !g.later && !first && !after.length && used + divider + w > room && order.some((x) => x.later && x.tabs.some(seen));
      if (defer || (after.length && !g.later)) { after.push({ g, items, widths, w }); continue; }
      for (const el of [g.br, g.div, g.label, ...g.tabs, g.mid]) set(el, "tg-last", false);
      place(g, items, widths, w, g.later);
    }
    for (const { g, items, widths, w } of after) {
      for (const el of [g.br, g.div, g.label, ...g.tabs, g.mid]) set(el, "tg-last", true);
      place(g, items, widths, w, false);
    }
  }
  // Tabs shown or hidden (Admin after signing in), counts changing their width: pack again
  new MutationObserver(pack).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], childList: true, characterData: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { pack(); measure(); });

  bar.addEventListener("scroll", edges, { passive: true });
  const again = () => { pack(); measure(); edges(); reveal(bar.querySelector(".tab.active"), false); };
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
