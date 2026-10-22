// Fit on screen, the same in every panel: nothing that floats ends up past the edge of the screen.
// Linked by every panel's page next to /shared/fit.css.
//
// What it looks after: menus, pop-ups and tooltips (role="menu" / "listbox" / "tooltip", the
// popover attribute), dialogs opened without a backdrop (dialog.show()), and anything a panel marks
// with data-fit or hands over with NovaFit.keep(el) (a card placed next to a button, a window
// being dragged). When one of them shows, changes size, or the screen changes (turned round, a
// window made smaller, a phone's keyboard coming up), it is checked again:
//   - past an edge: it's nudged back in, just far enough (a CSS translate, so the panel's own
//     left/top/right/bottom stay as they were, and the nudge is undone when it's no longer needed);
//   - bigger than the screen: it's capped at the screen's size and scrolls inside, only then.
// Things a panel slides off screen on purpose (a closed drawer) aren't looked at: they're never
// menus, pop-ups or marked. Modal dialogs are centred and capped by the browser and each panel.
// The sums are in NovaFit.fitBox (tested in test/fit.spec.ts); the whole suite is checked at
// phone, tablet and computer sizes by scripts/check-fit.mjs (scripts/check-fit-all.sh runs it).
// A panel kept in the background (so it opens again instantly) draws nothing until it's on show again
// (16 Oct 2026: on a phone, Notes' sky and Lossless's meters kept drawing behind other panels, every
// frame): its requestAnimationFrame callbacks wait, and run the moment it's shown.
(function () {
  if (window === window.parent || typeof window.requestAnimationFrame !== "function" || window.__novaFrameGate) return;
  window.__novaFrameGate = true;
  const raf = window.requestAnimationFrame.bind(window);
  const waiting = [];
  let checkedAt = -1e9, awayNow = false, watching = 0;
  const away = () => {
    const now = performance.now();
    if (now - checkedAt < 250) return awayNow;
    checkedAt = now;
    try {
      const f = window.frameElement;
      awayNow = !!f && (f.hidden || !!f.closest("[hidden]") || (typeof f.checkVisibility === "function" && !f.checkVisibility()));
    } catch (e) { awayNow = false; }
    return awayNow;
  };
  const wake = () => {
    checkedAt = -1e9;
    if (away()) return;
    clearInterval(watching);
    watching = 0;
    for (const cb of waiting.splice(0)) raf(cb);
  };
  window.requestAnimationFrame = (cb) => {
    if (away()) {
      waiting.push(cb);
      if (!watching) watching = setInterval(wake, 300);
      return 0;
    }
    return raf(cb);
  };
  // A panel kept in the background also says it's hidden (22 Oct 2026, battery): document.hidden and
  // visibilityState follow whether it's on show, and "visibilitychange" fires when that changes, so
  // every panel's "only when visible" checks (Portal's and Notes' refreshes every 15–60 s, Calendar's,
  // Quests'…) rest while another panel is in front, as they already do in a hidden browser tab
  try {
    const proto = Document.prototype;
    const hid = Object.getOwnPropertyDescriptor(proto, "hidden");
    const vis = Object.getOwnPropertyDescriptor(proto, "visibilityState");
    if (hid && hid.get && vis && vis.get) {
      Object.defineProperty(document, "hidden", { configurable: true, get() { return hid.get.call(this) || away(); } });
      Object.defineProperty(document, "visibilityState", { configurable: true, get() { const v = vis.get.call(this); return v === "visible" && away() ? "hidden" : v; } });
      let was = document.hidden;
      setInterval(() => {
        checkedAt = -1e9;
        const now = document.hidden;
        if (now !== was) { was = now; document.dispatchEvent(new Event("visibilitychange")); }
      }, 1000);
    }
  } catch (e) {}
})();

(function () {
  "use strict";
  if (window.NovaFit) return;

  const GAP = 8; // from the edge of the screen, at least
  const SEL = '[data-fit], [role="menu"], [role="listbox"], [role="tooltip"], dialog[open]';

  // Where a box should go so it's inside `b` (the screen less GAP and the phone's notches), given
  // where it is now and the nudge it already has. Returns the new nudge (dx, dy) and, when it's
  // bigger than the screen, the size to cap it at (maxW / maxH; 0 when it fits).
  function fitBox(rect, b, nudge) {
    const n = nudge || { x: 0, y: 0 };
    // Where it would be without our nudge
    const left = rect.left - n.x, top = rect.top - n.y;
    const roomW = Math.max(0, b.right - b.left), roomH = Math.max(0, b.bottom - b.top);
    const maxW = rect.width > roomW + 0.5 ? roomW : 0;
    const maxH = rect.height > roomH + 0.5 ? roomH : 0;
    const w = maxW || rect.width, h = maxH || rect.height;
    const along = (start, size, lo, hi) => (start < lo ? lo - start : start + size > hi ? Math.max(lo - start, hi - (start + size)) : 0);
    return { dx: Math.round(along(left, w, b.left, b.right)), dy: Math.round(along(top, h, b.top, b.bottom)), maxW: Math.floor(maxW), maxH: Math.floor(maxH) };
  }

  // The notches and rounded corners of a phone (env(safe-area-inset-*)), read once from a probe
  let insets = null;
  function safe() {
    if (insets) return insets;
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
    document.documentElement.append(p);
    const s = getComputedStyle(p);
    insets = { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
    p.remove();
    return insets;
  }
  // What can be seen: the window, less a phone's keyboard (the visual viewport), notches and GAP
  function bounds() {
    const v = window.visualViewport;
    const s = safe();
    const W = document.documentElement.clientWidth || innerWidth;
    const top = v ? Math.max(0, v.offsetTop) : 0;
    const bottom = v ? Math.min(innerHeight, v.offsetTop + v.height) : innerHeight;
    return { left: s.left + GAP, top: top + s.top + GAP, right: W - s.right - GAP, bottom: bottom - s.bottom - GAP };
  }

  const kept = new Set(); // handed over with keep() (looked after until they leave the page)
  const fitted = new WeakMap(); // el → { x, y, maxW, maxH, before: { maxWidth, maxHeight, overflow } }

  function floating(el) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    // Modal dialogs: the browser centres them in the top layer; the panel's own CSS sizes them
    if (el.tagName === "DIALOG" && el.matches(":modal")) return null;
    if (cs.position !== "fixed" && cs.position !== "absolute" && !el.matches("[popover]")) return null;
    // Something else moves it with translate (an animation of its own): left alone
    const mine = fitted.get(el);
    if (cs.translate && cs.translate !== "none" && !(mine && (mine.x || mine.y))) return null;
    return cs;
  }

  function undo(el) {
    const f = fitted.get(el);
    if (!f) return;
    el.style.translate = "";
    if (f.maxW || f.maxH) {
      el.style.maxWidth = f.before.maxWidth;
      el.style.maxHeight = f.before.maxHeight;
      el.style.overflow = f.before.overflow;
    }
    fitted.delete(el);
  }

  function fit(el) {
    if (!el.isConnected) { kept.delete(el); return; }
    const cs = floating(el);
    if (!cs) { undo(el); return; }
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return;
    const b = bounds();
    const f = fitted.get(el) || { x: 0, y: 0, maxW: 0, maxH: 0, at: "", before: { maxWidth: el.style.maxWidth, maxHeight: el.style.maxHeight, overflow: el.style.overflow } };
    const at = `${b.left},${b.top},${b.right},${b.bottom}`;
    // Capped before and the screen has changed since: measured without our cap, so it can grow back
    // (only then: every style change here is seen by the watcher, so nothing is written twice)
    let r = rect;
    if ((f.maxW || f.maxH) && f.at !== at) {
      set(el, "maxWidth", f.before.maxWidth);
      set(el, "maxHeight", f.before.maxHeight);
      set(el, "overflow", f.before.overflow);
      f.maxW = f.maxH = 0;
      r = el.getBoundingClientRect();
    }
    f.at = at;
    const out = fitBox(r, b, f);
    // Bigger than the screen: capped (keeping a cap from before), and it scrolls inside, only then
    const maxW = out.maxW || f.maxW, maxH = out.maxH || f.maxH;
    if (maxW) set(el, "maxWidth", `${maxW}px`);
    if (maxH) set(el, "maxHeight", `${maxH}px`);
    if (maxW || maxH) set(el, "overflow", "auto");
    f.maxW = maxW;
    f.maxH = maxH;
    if (out.dx !== f.x || out.dy !== f.y) set(el, "translate", out.dx || out.dy ? `${out.dx}px ${out.dy}px` : "");
    f.x = out.dx;
    f.y = out.dy;
    if (f.x || f.y || f.maxW || f.maxH) fitted.set(el, f);
    else fitted.delete(el);
  }
  function set(el, prop, value) { if (el.style[prop] !== value) el.style[prop] = value; }

  // Everything on show that it looks after, in this page and in the shadow roots it was handed
  function all() {
    const list = new Set(kept);
    for (const el of document.querySelectorAll(SEL)) list.add(el);
    try { for (const el of document.querySelectorAll(":popover-open")) list.add(el); } catch (e) { /* (an older browser) */ }
    return list;
  }

  // One look a frame at most, however many changes come in
  let queued = false;
  function soon() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      for (const el of all()) {
        try { fit(el); } catch (e) { /* never let fitting break a panel */ }
        if (el.isConnected && !sizes.has(el)) { sizes.add(el); ro && ro.observe(el); }
      }
    });
  }

  // A pop-up whose content grows after it opens (a list that loads) is checked again
  const sizes = new WeakSet();
  const ro = "ResizeObserver" in window ? new ResizeObserver(soon) : null;

  function start() {
    // (only changes to what it looks after, or that show or hide one: not every style change on the
    // page, such as each move while something is dragged on Board, 16 Oct 2026)
    const mine = (n) => n.nodeType === 1 && (kept.has(n) || n.matches(SEL) || n.matches("[popover]"));
    const relevant = (r) => {
      if (r.type === "childList") { for (const n of r.addedNodes) if (n.nodeType === 1 && (mine(n) || n.querySelector(SEL))) return true; return false; }
      const t = r.target;
      if (mine(t)) return true;
      return r.attributeName !== "style" && !!t.querySelector && !!t.querySelector(SEL);
    };
    new MutationObserver((records) => { if (records.some(relevant)) soon(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "hidden", "class", "style", "aria-expanded", "popover"] });
    addEventListener("resize", () => { insets = null; soon(); });
    addEventListener("orientationchange", () => { insets = null; soon(); });
    if (window.visualViewport) { visualViewport.addEventListener("resize", soon); visualViewport.addEventListener("scroll", soon); }
    document.addEventListener("toggle", soon, true); // (popovers and <details>)
    soon();
  }

  window.NovaFit = {
    fitBox,
    bounds,
    // Look after this one too (a card placed by hand, a window being dragged, one in a shadow root)
    keep(el) { if (el) { kept.add(el); soon(); } return el; },
    forget(el) { kept.delete(el); undo(el); },
    // Check everything now (after moving something by hand); fit(el) checks one straight away
    check: soon,
    fit(el) { if (el) fit(el); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  // The three rules, kept as each screen draws (the Fixer's "Fixes on its own"): /shared/rules.js;
  // and notices that keep out of the way of typing and dragging: /shared/notices.js; and the page bar,
  // so nothing scrolls in any panel (what's too long is shown in pages): /shared/onescreen.js. Next to
  // this file, so every page that has this has those
  const here = (document.currentScript && document.currentScript.src) || "";
  try {
    if (!document.querySelector('link[href*="/shared/onescreen.css"]')) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = new URL("onescreen.css", here || location.origin + "/shared/fit.js").href;
      (document.head || document.documentElement).append(l);
    }
  } catch (e) { /* (a page with no address of its own) */ }
  for (const [file, has] of [["rules.js", "NovaRules"], ["notices.js", "NovaNotices"], ["onescreen.js", "NovaOneScreen"]]) {
    try {
      if (!window[has] && !document.querySelector(`script[src*="/shared/${file}"]`)) {
        const s = document.createElement("script");
        s.src = new URL(file, here || location.origin + "/shared/fit.js").href;
        s.async = true;
        (document.head || document.documentElement).append(s);
      }
    } catch (e) { /* (a page with no address of its own) */ }
  }
})();
