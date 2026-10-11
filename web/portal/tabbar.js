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
  const STILL = matchMedia("(prefers-reduced-motion: reduce)");
  const root = document.documentElement;
  const top = document.querySelector(".app > .top");

  // The header's height, so the bar sits just under it (inside Nova Agent there's no header)
  function measure() {
    const h = top && getComputedStyle(top).display !== "none" ? top.offsetHeight : 0;
    root.style.setProperty("--top-h", `${h}px`);
    root.style.setProperty("--htabs-h", `${WIDE.matches ? bar.offsetHeight : 0}px`);
  }

  // The fades: only on a side that has more tabs to scroll to
  function edges() {
    const room = bar.scrollWidth - bar.clientWidth;
    const on = WIDE.matches && room > 2;
    bar.classList.toggle("more-left", on && bar.scrollLeft > 2);
    bar.classList.toggle("more-right", on && bar.scrollLeft < room - 2);
  }

  // The tabs you can see and use right now (not hidden, not the phone's More)
  const usable = () => [...bar.querySelectorAll(".tab")].filter((t) => !t.hidden && t.offsetParent !== null && getComputedStyle(t).display !== "none");

  // Bring a tab into view, without moving the page up or down
  function reveal(tab, smooth = true) {
    if (!tab || !WIDE.matches) return;
    const left = tab.offsetLeft - 32;
    const right = tab.offsetLeft + tab.offsetWidth + 32 - bar.clientWidth;
    const to = bar.scrollLeft > left ? left : bar.scrollLeft < right ? right : null;
    if (to !== null) bar.scrollTo({ left: Math.max(0, to), behavior: smooth && !STILL.matches ? "smooth" : "auto" });
  }

  // The wheel: up and down scroll the bar sideways (a sideways swipe on a trackpad just works)
  bar.addEventListener("wheel", (e) => {
    if (!WIDE.matches || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
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
    if (!WIDE.matches || e.altKey || e.ctrlKey || e.metaKey) return;
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

  bar.addEventListener("scroll", edges, { passive: true });
  const again = () => { measure(); edges(); reveal(bar.querySelector(".tab.active"), false); };
  addEventListener("resize", again);
  WIDE.addEventListener("change", again);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => { measure(); edges(); });
    ro.observe(bar);
    if (top) ro.observe(top);
  }
  again();
})();
