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
  // (a phone on its side is wide but short: its sections are one sliding row, like an upright phone)
  const WIDE = matchMedia("(min-width: 761px) and (min-height: 501px), (min-width: 981px)");
  // The tab bar is on (not the side menu: Options → Menu)
  // The side menu only fits from 1024px wide: narrower than that the tabs go on top whatever's
  // chosen (themes.js switches tabbar.css on for those widths too), never a squashed row
  const SIDE_FITS = matchMedia("(min-width: 1024px)");
  const topTabs = () => WIDE.matches && (document.documentElement.getAttribute("data-menu") !== "side" || !SIDE_FITS.matches);
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

  // ---- Every section at once (tabs on top): lanes ----
  // The groups with one tab (Today · You · Admin) share the first lane; then the groups with several
  // (Studio · Plans · the settings icons inside Nova Agent), each on the first line with room for it,
  // with a soft line between lines (.tg-br). Each group's name is a small chip; in the lanes the chips are all one
  // width, so the tabs line up. A lane wider than the bar splits into two even halves, the second
  // lined up under the first (.tg-mid, then .tg-indent). The whole block sits in the middle of the
  // bar (--tg-inset). Only for the tab bar on a computer or tablet: the side menu and the phone's
  // bar are as before.
  if (!bar.id) bar.id = "portal-tabs";
  const groups = []; // { label (the .tab-group), tabs: [], br, mid }
  {
    let current = null;
    for (const el of [...bar.children]) {
      if (el.classList.contains("tab-group")) { current = { label: el, tabs: [] }; groups.push(current); }
      else if (el.classList.contains("tab") && current) current.tabs.push(el);
    }
  }
  for (const g of groups) {
    g.br = document.createElement("div");
    g.br.className = "tg-br";
    g.mid = document.createElement("div");
    g.mid.className = "tg-br tg-mid";
    for (const el of [g.br, g.mid]) el.setAttribute("aria-hidden", "true");
    g.label.before(g.br);
  }
  // Only write a class or an order when it changes (so the observer below doesn't go round and round)
  const set = (el, cls, on) => { if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on); };
  const place = (el, n) => { const v = n === null ? "" : String(n); if (el.style.order !== v) el.style.order = v; };
  const seen = (el) => !el.hidden && el.offsetParent !== null && getComputedStyle(el).display !== "none";
  function pack() {
    const on = topTabs();
    set(bar, "tg-rows", on);
    if (!on) {
      bar.style.removeProperty("--tg-inset");
      for (const g of groups) for (const el of [g.br, g.label, ...g.tabs, g.mid]) place(el, null);
      return;
    }
    const cs = getComputedStyle(bar);
    const pad = parseFloat(cs.getPropertyValue("--tg-pad")) || 12;
    const room = bar.clientWidth - 2 * pad - 1;
    const gap = parseFloat(cs.columnGap) || 0;
    const lab = parseFloat(cs.getPropertyValue("--tg-lab")) || 0;
    const apart = parseFloat(cs.getPropertyValue("--tg-apart")) || 0;
    const shown = groups.map((g) => ({ g, tabs: g.tabs.filter(seen) })).filter((x) => x.tabs.length);
    for (const g of groups) if (!shown.some((x) => x.g === g)) { set(g.br, "on", false); set(g.mid, "on", false); }
    const singles = shown.filter((x) => x.tabs.length === 1);
    const lanes = shown.filter((x) => x.tabs.length > 1);
    let widest = 0;
    // The first lane: the one-tab groups side by side
    let w1 = 0;
    singles.forEach((x, i) => {
      for (const el of [x.g.br, x.g.label, ...x.g.tabs, x.g.mid]) place(el, 0);
      set(x.g.br, "on", false);
      set(x.g.mid, "on", false);
      set(x.g.label, "tg-apart", i > 0);
      for (const t of x.g.tabs) set(t, "tg-indent", false);
      w1 += (i ? apart : 0) + lab + gap + x.tabs[0].getBoundingClientRect().width + (i ? gap : 0);
    });
    widest = Math.min(w1, room);
    // Then the lanes, packed: a lane goes on the first line with room for it (after what's there),
    // else it starts a line of its own; so short lanes (Plans, Admin, the settings icons) share a
    // line and the block is as short as it can be. lines: { order, used } (used: the line's last row)
    const lines = singles.length ? [{ order: 0, used: w1 }] : [];
    lanes.forEach((x) => {
      const { g, tabs } = x;
      const widths = tabs.map((t) => t.getBoundingClientRect().width);
      const line = (a, b) => widths.slice(a, b).reduce((n, v) => n + v, 0) + gap * Math.max(0, b - a - 1);
      const all = line(0, tabs.length);
      const w = lab + gap + all;
      const fit = w <= room ? lines.find((l) => l.used + apart + gap + w + 8 <= room) : null;
      if (fit) {
        for (const el of [g.br, g.label, ...g.tabs, g.mid]) place(el, fit.order);
        set(g.label, "tg-apart", true);
        set(g.br, "on", false);
        set(g.mid, "on", false);
        for (const t of g.tabs) set(t, "tg-indent", false);
        fit.used += apart + gap + w + 4;
        widest = Math.max(widest, Math.min(fit.used, room));
        return;
      }
      const order = lines.length ? lines[lines.length - 1].order + 1 : 1;
      for (const el of [g.br, g.label, ...g.tabs, g.mid]) place(el, order);
      set(g.label, "tg-apart", false);
      set(g.br, "on", lines.length > 0);
      let split = -1;
      if (w > room) {
        let run = 0;
        for (let j = 0; j < tabs.length; j++) { run += widths[j] + gap; if (run >= all / 2) { split = Math.min(j + 1, tabs.length - 1); break; } }
      }
      if (split > 0 && g.mid.nextElementSibling !== tabs[split]) tabs[split].before(g.mid);
      set(g.mid, "on", split > 0);
      for (const t of g.tabs) set(t, "tg-indent", split > 0 && t === tabs[split]);
      const first = split > 0 ? lab + gap + line(0, split) : w;
      const last = split > 0 ? lab + gap + line(split, tabs.length) : w;
      lines.push({ order, used: last });
      widest = Math.max(widest, Math.min(Math.max(first, last), room));
    });
    // (a little room to spare, so a lane never wraps over a pixel or two of rounding)
    const inset = `${Math.max(0, Math.floor((room - widest) / 2) - 10)}px`;
    if (bar.style.getPropertyValue("--tg-inset") !== inset) bar.style.setProperty("--tg-inset", inset);
  }
  // Tabs shown or hidden (Admin after signing in), counts changing their width: pack again
  new MutationObserver(pack).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class", "hidden"], childList: true, characterData: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { pack(); measure(); });

  bar.addEventListener("scroll", edges, { passive: true });
  const again = () => { pack(); measure(); edges(); reveal(bar.querySelector(".tab.active"), false); };
  addEventListener("resize", again);
  WIDE.addEventListener("change", again);
  SIDE_FITS.addEventListener("change", again);
  // Options → Menu changed (tabs on top or the side menu)
  addEventListener("novaoptionschange", again);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => { measure(); edges(); });
    ro.observe(bar);
    if (top) ro.observe(top);
  }
  again();
})();
