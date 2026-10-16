// The three rules, kept by every screen of Nova Agent as it draws: the Fixer's "Fixes on its own"
// (16 Oct 2026). The Fixer checks all of Nova Agent every 5 minutes (src/fixer/strict.ts); this
// fixes what it would find, straight away, on whatever screen it's on, with nothing to approve:
//
//   1. Nothing off the screen.
//      - Words cut short with "…": a little smaller until they fit; if they still can't, the box
//        scrolls sideways instead of cutting them (the whole words are its tooltip).
//      - A box that cuts off what's in it scrolls instead (a picture is fitted inside it).
//      - A pop-up or card past the edge is nudged back in (/shared/fit.js); something in the page
//        that sticks out past the right or the bottom makes the nearest box that fits scroll.
//   2. One screen: nothing here ever makes a page scroll (what's too big scrolls inside its box).
//   3. Nothing onto the next line.
//      - A button, link, name, label, heading or tab stays on one line, its words smaller when they
//        need to be (never under 72% of their size, never under 9px). If it still can't fit, it
//        keeps its whole name on one line and the row it's in scrolls sideways.
//      - Nova Agent's own bars (the top panel, the tiles and dock, the status line, a row an app
//        marks data-one-row) stay one row, sliding sideways inside themselves when they can't all
//        fit. Other rows, groups of choices (colours, filters, chips, toolbars), are left to wrap
//        onto more rows: every choice stays in sight (16 Oct 2026).
//   Reading text (paragraphs, messages, notes) is left to wrap, as the Fixer leaves it.
//
// Every change is a style on the part itself, and the page's own styles are kept: when the screen
// changes size, everything is put back and looked at again, so things grow back when there's room.
// Cheap: one look once the page settles and after changes stop for a moment, never mid-drag.
// Linked by /shared/fit.js, so every panel's page and Nova Agent's own have it. Off on one device
// with localStorage "nova-rules" = "off" (the Fixer's switch); a part opts out with data-rules="off".
// Tested in test/rules.spec.ts: after it's run, the Fixer's own measuring finds nothing.
(function () {
  "use strict";
  if (window.NovaRules) return;

  let off = false;
  try { off = localStorage.getItem("nova-rules") === "off"; } catch (e) { /* (storage blocked) */ }

  // The same as the Fixer's (src/fixer/strict.ts)
  const CONTROL = 'button, a, label, h1, h2, h3, h4, h5, h6, summary, legend, th, select, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"]';
  const BARS = 'header, nav, footer, [role="toolbar"], [role="tablist"], [role="menubar"], .tabbar, .topbar, .status-line';
  const READING = 'p, blockquote, pre, code, textarea, [contenteditable="true"], article, .md, .msg, .bubble, .prose, td';
  const LEAVE = '[aria-hidden="true"], [inert], template, noscript, script, style, [data-rules="off"]';
  const skip = (el) => !!el.closest(LEAVE) || (el.tagName.toUpperCase() !== "SVG" && !!el.closest("svg"));
  const MEDIA = /^(IMG|VIDEO|CANVAS|SVG|PICTURE|IFRAME)$/;
  const ONE_ROW = '#tabbar, .tabbar, #suite-home, html:not(.embed) .topbar, .status-line, [data-one-row]';
  const SMALLEST = 0.72; // words never smaller than this much of their own size
  const TINY = 9; // or than this many px

  const scrolls = (v) => v === "auto" || v === "scroll" || v === "overlay";
  const clips = (v) => v === "hidden" || v === "clip";
  const hasText = (el) => { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const shown = (el) => {
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const over = (box) => box.clientWidth > 0 && box.scrollWidth > box.clientWidth + 1;
  // A part's own width, as laid out (not as a pop-up scaling in shows it for a moment)
  const widthOf = (el) => (el.offsetWidth !== undefined ? el.offsetWidth : el.getBoundingClientRect().width);
  // The room inside a box for its words, and how wide el's words are (from the words themselves:
  // a button's scrollWidth doesn't show words spilling out of it)
  function room(box) {
    const cs = getComputedStyle(box);
    return box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  }
  function wordsWidth(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width;
  }
  const spills = (el, box) => box.clientWidth > 0 && (over(box) || wordsWidth(el) > room(box) + 1);

  // ---- Changing a style, and putting it back ----
  // el → { prop: [the page's own value, its priority, ours] }
  const before = new Map();
  const nudged = new WeakSet(); // floating things handed to /shared/fit.js
  const size0 = new WeakMap(); // el → its words' own size, before any shrinking
  let changes = 0;
  function set(el, prop, value) {
    let b = before.get(el);
    if (!b) before.set(el, (b = {}));
    if (!(prop in b)) b[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop), null];
    const was = el.style.getPropertyValue(prop), wasPriority = el.style.getPropertyPriority(prop);
    el.style.setProperty(prop, value, "important");
    b[prop][2] = el.style.getPropertyValue(prop); // (as the browser writes it: "10.80px" is "10.8px")
    if (b[prop][2] !== was || wasPriority !== "important") { changes++; chains = new Map(); }
  }
  function putBack() {
    for (const [el, b] of before) {
      for (const prop in b) {
        const [value, priority, ours] = b[prop];
        if (el.style.getPropertyValue(prop) !== ours) continue; // (the panel has set its own since)
        if (value) el.style.setProperty(prop, value, priority);
        else el.style.removeProperty(prop);
      }
    }
    before.clear();
  }

  // The boxes around a part that don't let it show past them (nearest first), each with where it is
  // and whether it scrolls or cuts off, worked out once per look for each box (and again after a fix)
  let chains = new Map();
  const NONE = [];
  function chainOf(a) {
    if (!a || a === document.body || a === document.documentElement) return NONE;
    let c = chains.get(a);
    if (c) return c;
    const up = chainOf(a.parentElement);
    const s = getComputedStyle(a);
    if (s.overflowX === "visible" && s.overflowY === "visible") c = up;
    else {
      const pan = a.hasAttribute("data-pan");
      c = [{ a, r: a.getBoundingClientRect(), sx: pan || scrolls(s.overflowX), sy: pan || scrolls(s.overflowY), cx: clips(s.overflowX), cy: clips(s.overflowY) }, ...up];
    }
    chains.set(a, c);
    return c;
  }

  // ---- Fitting words on their one line ----
  // The nearest box that isn't inline (an inline link's words are measured in what holds them)
  function boxOf(el) {
    for (let b = el; b && b !== document.body; b = b.parentElement) if (getComputedStyle(b).display !== "inline") return b;
    return null;
  }
  // A little smaller, step by step, until the words fit their box (true when they do)
  function shrink(el, box) {
    if (!spills(el, box)) return true;
    const now = parseFloat(getComputedStyle(el).fontSize) || 16;
    if (!size0.has(el)) size0.set(el, now);
    const least = Math.max(size0.get(el) * SMALLEST, TINY);
    let size = now;
    for (let i = 0; i < 6 && spills(el, box); i++) {
      const fits = Math.min(box.clientWidth / Math.max(1, box.scrollWidth), room(box) / Math.max(1, wordsWidth(el)));
      const next = Math.max(least, size * Math.max(0.8, fits * 0.98));
      if (next >= size - 0.2) break;
      size = next;
      set(el, "font-size", `${size.toFixed(2)}px`);
    }
    return !spills(el, box);
  }
  // A row that holds something too wide for it: one row that scrolls sideways (from its start, so
  // nothing is past its left edge when it's centred)
  // (a box that scrolls never makes what holds it wider: it keeps the width it had, never more; in
  // px, since a browser working out natural widths ignores a cap with a percentage in it; it all
  // goes back when the window changes size)
  function scrollRow(row) {
    if (!row || row === document.body || row === document.documentElement) return;
    const cs = getComputedStyle(row);
    if (scrolls(cs.overflowX) || row.hasAttribute("data-pan")) return;
    const w0 = widthOf(row);
    set(row, "overflow-x", "auto");
    set(row, "min-width", "0");
    set(row, "max-width", w0 > 1 ? `${Math.floor(w0)}px` : "100%");
    if (cs.overflowY === "visible") set(row, "overflow-y", "hidden");
    set(row, "scrollbar-width", "thin");
    set(row, "overscroll-behavior-x", "contain");
    if (/flex/.test(cs.display) && /^(center|end|flex-end|right|space-around|space-evenly)$/.test(cs.justifyContent)) set(row, "justify-content", "flex-start");
  }
  // The nearest box around el that's too narrow for what it holds
  function tooNarrow(el) {
    for (let a = el.parentElement, i = 0; a && a !== document.body && i < 8; a = a.parentElement, i++) {
      const cs = getComputedStyle(a);
      if (scrolls(cs.overflowX) || a.hasAttribute("data-pan")) return null; // (it already scrolls)
      if (cs.display !== "inline" && over(a)) return a;
    }
    return null;
  }

  // ---- 3. Nothing onto the next line ----
  // How many lines its words are on (the most of any one run of words in it)
  function lines(el) {
    let most = 1;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tops = [];
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        if (!tops.some((t) => Math.abs(t - r.top) < r.height / 2)) tops.push(r.top);
      }
      if (tops.length > most) most = tops.length;
    }
    return most;
  }
  // Could its words be on more than one line? (a quick look at its height first: most can't)
  function mayWrap(el) {
    const cs = getComputedStyle(el);
    if (cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre") return false;
    const fs = parseFloat(cs.fontSize) || 16;
    const lh = parseFloat(cs.lineHeight) || fs * 1.25;
    const h = el.getBoundingClientRect().height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
    return h > lh * 1.5 || cs.display === "inline" || cs.display === "contents";
  }
  // The widths of a box and the few boxes around it (to see whether a change made any of them wider)
  function widths(box) {
    const out = [];
    for (let a = box, i = 0; a && a !== document.body && i < 5; a = a.parentElement, i++) out.push([a, widthOf(a)]);
    return out;
  }
  const grew = (list) => list.some(([a, w]) => widthOf(a) > w + 1);
  function oneLine(el) {
    if (!mayWrap(el) || lines(el) < 2) return;
    const box = boxOf(el);
    if (!box) return;
    const before = widths(box);
    set(el, "white-space", "nowrap");
    // On one line it may only get smaller, never make what holds it wider: it keeps the width it had
    if (grew(before)) set(box, "max-width", `${Math.floor(before[0][1])}px`);
    if (!shrink(el, box)) {
      // Still too long at its smallest: its whole name on one line, in a box of its own that slides
      // sideways (swipe it; the whole name is its tooltip), never making what holds it wider
      const w0 = widthOf(box);
      set(box, "overflow-x", "auto");
      set(box, "text-overflow", "clip");
      set(box, "scrollbar-width", "none");
      set(box, "min-width", "0");
      if (w0 > 1) set(box, "max-width", `${Math.floor(w0)}px`);
      if (!box.title && !box.getAttribute("aria-label")) box.title = box.textContent.replace(/\s+/g, " ").trim();
    }
    const narrow = tooNarrow(box);
    if (narrow) scrollRow(narrow);
  }
  function oneRow(el, cs) {
    const kids = [];
    for (const k of el.children) {
      if (!shown(k)) continue;
      const p = getComputedStyle(k).position;
      if (p !== "absolute" && p !== "fixed") kids.push(k);
    }
    if (kids.length < 2) return;
    const rows = [];
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const row = rows.find((w) => r.top < w.bottom - 2 && r.bottom > w.top + 2);
      if (row) { row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); }
      else rows.push({ top: r.top, bottom: r.bottom });
    }
    if (rows.length < 2) return;
    // One row that scrolls inside itself (made a scrolling box first, so the row can never grow and
    // push the page wider than the screen)
    scrollRow(el);
    set(el, "flex-wrap", "nowrap");
    for (const k of kids) set(k, "flex-shrink", "0");
  }

  // ---- 1. Nothing off the screen ----
  function cutWords(el, cs) {
    if (!hasText(el) || !clips(cs.overflowX) || !over(el)) return;
    if (shrink(el, el)) return;
    // Still too long at its smallest: it scrolls sideways (swipe it), its whole words its tooltip
    set(el, "text-overflow", "clip");
    set(el, "overflow-x", "auto");
    set(el, "scrollbar-width", "none");
    if (!el.title && !el.getAttribute("aria-label")) el.title = el.textContent.replace(/\s+/g, " ").trim();
  }
  function fitMedia(el, a, cs) {
    set(el, "max-width", "100%");
    set(el, "max-height", `${a.clientHeight}px`);
    if (cs.objectFit === "fill") set(el, "object-fit", "contain");
  }
  // Cut off by a box around it that doesn't scroll, or sticking out of the screen
  function offScreen(el) {
    const r0 = el.getBoundingClientRect();
    let left = r0.left, right = r0.right, top = r0.top, bottom = r0.bottom;
    for (const { a, r: ar, sx, sy, cx, cy } of chainOf(el.parentElement)) {
      const cutX = !sx && cx && (left < ar.left - 1 || right > ar.right + 1);
      const cutY = !sy && cy && (top < ar.top - 1 || bottom > ar.bottom + 1);
      if ((cutX || cutY) && a.clientWidth > 3 && a.clientHeight > 3 && !skip(a)) {
        if (MEDIA.test(el.tagName.toUpperCase())) return fitMedia(el, a, getComputedStyle(el));
        // (a box it's cut off by that scrolls, and only along the way it's cut off)
        if (cutX) set(a, "overflow-x", "auto");
        if (cutY) set(a, "overflow-y", "auto");
        set(a, "scrollbar-width", "thin");
        set(a, "overscroll-behavior", "contain");
        return;
      }
      if (sx || cx) { left = Math.max(left, ar.left); right = Math.min(right, ar.right); }
      if (sy || cy) { top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom); }
      if (right <= left || bottom <= top) return; // (out of sight inside a box: it can be scrolled to)
    }
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const outX = left < -1 || right > vw + 1, outY = top < -1 || bottom > vh + 1;
    if (!outX && !outY) return;
    // Something that floats (a card, a pop-up, a window): nudged back in; one wholly off the screen
    // (a drawer slid away on purpose) is left alone: its panel hides it
    const away = right <= 0 || left >= vw || bottom <= 0 || top >= vh;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (away && acs.transform !== "none") return;
      const p = acs.position;
      if (p === "fixed" || p === "absolute") {
        if (away) return;
        if (window.NovaFit && !skip(a) && !nudged.has(a)) { nudged.add(a); window.NovaFit.keep(a); window.NovaFit.fit(a); changes++; }
        return;
      }
    }
    // In the page: the nearest box that fits the screen scrolls (past the right or the bottom)
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      if (outX && right > vw + 1 && ar.right <= vw + 1 && ar.left >= -1 && a.clientWidth > 3) { set(a, "overflow-x", "auto"); set(a, "scrollbar-width", "thin"); return; }
      if (outY && bottom > vh + 1 && ar.bottom <= vh + 1 && ar.top >= -1 && a.clientHeight > 3) { set(a, "overflow-y", "auto"); set(a, "scrollbar-width", "thin"); set(a, "min-height", "0"); return; }
    }
  }

  // ---- One look at the whole page ----
  let lastMs = 0;
  function look() {
    if (off || !document.body) return;
    const t0 = performance.now();
    for (const el of before.keys()) if (!el.isConnected) before.delete(el);
    chains = new Map();
    // A few rounds: one fix can show the next (a row kept on one line makes its buttons narrower)
    for (let round = 0; round < 3; round++) {
      changes = 0;
      const all = document.body.getElementsByTagName("*");
      const list = [];
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (skip(el) || !shown(el)) continue;
        list.push(el);
      }
      // Rows first, then each name, then what's cut off or off the screen
      for (const el of list) {
        const cs = getComputedStyle(el);
        if (!/flex/.test(cs.display) || cs.flexWrap === "nowrap" || /column/.test(cs.flexDirection) || el.closest(READING) || !el.matches(ONE_ROW)) continue;
        try { oneRow(el, cs); } catch (e) { /* never let fitting break a panel */ }
      }
      const said = [];
      for (const el of list) {
        const isControl = el.matches(CONTROL);
        if (!isControl && !(hasText(el) && el.closest(BARS))) continue;
        if (el.closest(READING) || el.textContent.trim().length > 60 || said.some((s) => s.contains(el))) continue;
        try { const n = changes; oneLine(el); if (changes > n) said.push(el); } catch (e) { /* (as above) */ }
      }
      for (const el of list) {
        try { cutWords(el, getComputedStyle(el)); } catch (e) { /* (as above) */ }
      }
      for (const el of list) {
        const tag = el.tagName.toUpperCase();
        if (!(/^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|SVG|VIDEO|CANVAS|IFRAME|LABEL|H[1-6]|P|LI|TD|TH|SUMMARY)$/.test(tag) || el.getAttribute("role") || hasText(el))) continue;
        try { offScreen(el); } catch (e) { /* (as above) */ }
      }
      if (!changes) break;
    }
    lastMs = performance.now() - t0;
    chains = new Map();
  }

  // ---- When to look ----
  let timer = 0;
  let fresh = false; // (the screen changed size: put everything back first)
  let held = false; // (a finger or the mouse is down: wait until it's let go)
  let mo = null;
  // Something still appearing (a window fading or scaling in, a panel sliding): how long until it's
  // done (never the endless ones: a spinner, a drifting sky), so it's looked at once it's in place
  function settling() {
    let left = 0;
    try {
      for (const a of document.getAnimations()) {
        if (a.playState !== "running" || !a.effect) continue;
        const t = a.effect.getComputedTiming();
        if (!isFinite(t.endTime)) continue;
        const rest = t.endTime - Number(a.currentTime || 0);
        if (rest > 0 && rest < 1500) left = Math.max(left, rest);
      }
    } catch (e) { /* (an older browser) */ }
    return left;
  }
  let waits = 0;
  function run() {
    timer = 0;
    if (held) return later(400);
    const left = settling();
    if (left && waits < 4) { waits++; return later(Math.ceil(left) + 30); }
    waits = 0;
    if (fresh) { fresh = false; putBack(); }
    look();
    if (mo) mo.takeRecords(); // (what it changed itself isn't a reason to look again)
  }
  // Once changes stop for a moment; a page that never stops changing (a clock, a level meter) is
  // still looked at, at least once a second or so after it was first asked
  let asked = 0;
  function later(ms) {
    if (off) return;
    const now = performance.now();
    if (timer && now - asked > 800 + ms) return; // (waited long enough: the look already on its way goes)
    if (!timer) asked = now;
    clearTimeout(timer);
    timer = setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 400 }) : requestAnimationFrame(run)), ms);
  }
  // A busy page is looked at less often (a look that took 10ms waits 250ms after changes stop)
  const calm = () => Math.min(1200, Math.max(150, lastMs * 25));

  function start() {
    if (off) return;
    // (a window or pop-up opening is fixed on the very next frame, before anyone sees it otherwise)
    const POP = 'dialog, [role="dialog"], [role="menu"], [popover], [data-fit]';
    const opened = (r) => (r.type === "attributes" ? r.attributeName === "open" && r.target.hasAttribute("open") : [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches(POP) || !!n.querySelector?.(POP))));
    // (and looked at again once it has faded or slid in: while it's still see-through it's left alone)
    mo = new MutationObserver((records) => {
      if (!records.some(opened)) return later(calm());
      later(0);
      setTimeout(() => later(0), 450);
    });
    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "open", "aria-expanded", "aria-selected", "aria-pressed"] });
    const resized = () => { fresh = true; later(180); };
    addEventListener("resize", resized);
    addEventListener("orientationchange", resized);
    addEventListener("pointerdown", () => { held = true; }, true);
    addEventListener("pointerup", () => { held = false; }, true);
    addEventListener("pointercancel", () => { held = false; }, true);
    later(60);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fresh = true; later(60); });
    addEventListener("load", () => later(300), { once: true });
  }

  window.NovaRules = {
    get on() { return !off; },
    // How long its last look took (ms)
    get ms() { return Math.round(lastMs * 10) / 10; },
    // How many parts it's changed on this page right now
    fixed() { let n = 0; for (const el of before.keys()) if (el.isConnected) n++; return n; },
    // Look now (straight away; the Fixer and the tests use this)
    check() { clearTimeout(timer); timer = 0; if (fresh) { fresh = false; putBack(); } look(); if (mo) mo.takeRecords(); return this.fixed(); },
    // Off or on for this device (the Fixer's switch); off puts every change back
    set(on) {
      off = !on;
      try { if (off) localStorage.setItem("nova-rules", "off"); else localStorage.removeItem("nova-rules"); } catch (e) { /* (storage blocked) */ }
      if (off) { clearTimeout(timer); putBack(); if (mo) mo.disconnect(); mo = null; }
      else if (!mo) start();
    },
    putBack,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
