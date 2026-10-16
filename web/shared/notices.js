// Notices and overlays that keep out of the way (16 Oct 2026): every notification in Nova Agent
// (Agent's notices, each app's "Saved" or "Moved…" toast, the bar's notes) and every overlay that
// floats over a page without being asked for (a card marked data-overlay, a dialog opened without a
// backdrop) is placed where it's in the way least:
//   - never over where someone is typing, a message box, the Nova top panel or the Nova tiles/dock;
//   - a notice also over as few buttons, boxes and links as it can be (in this page, and in a panel's
//     page under it): it tries its own place first, then just above or below each of those, the top
//     and the bottom, and takes the one that covers least, the nearest of equals;
//   (an overlay someone is using, the cursor or the focus in it, is never moved)
//   - typing: a notice over the box being typed in (or the box's whole composer: the message box and
//     its Send button), or under a phone's keyboard, slides just above it (or just below, if there's
//     no room above), and back to its own place when the typing stops;
//   - a message box (a composer: Agent's, a chat's) is kept clear even before it's tapped, so a
//     notice never sits over the place someone's about to type;
//   - dragging or moving something by hand (Board's table, a slider, a window): every notice fades
//     right down and lets the pointer through until it's let go.
// Nothing else on the page moves: only the notice, with a translate of its own (its app's own
// position and animations are kept), so the layout is never touched. It knows the box being typed in
// inside a panel too (a panel's page from Nova Agent's own, and the other way round).
// Linked by /shared/fit.js, like rules.js, so every page has it. Tested in test/notices.spec.ts.
(function () {
  "use strict";
  if (window.NovaNotices) return;

  const SEL = '.toast, .toasts, .bar-note, [data-notice]';
  const OVERLAY = 'dialog[open]:not(:modal), [data-overlay]';
  const KEEP_CLEAR = '.composer, [data-composer], #tabbar, #suite-home, .shell > .topbar';
  const TAPPABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="link"], [contenteditable="true"]';
  const GAP = 8; // from what it keeps clear of, and from the screen's edges
  const style = document.createElement("style");
  style.textContent = `:where(${SEL}) { transition: translate .22s cubic-bezier(.2,.8,.2,1), opacity .18s ease; }
    html.notices-aside :where(${SEL}) { opacity: .12 !important; pointer-events: none !important; }`;
  (document.head || document.documentElement).append(style);

  // el → { inline: its own inline translate, own: its translate as it was, dy: how far it's been moved }
  const moved = new Map();
  const editable = (el) => !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(el.type || "")));
  const floats = (el) => { const p = getComputedStyle(el).position; return p === "fixed" || p === "absolute"; };

  // The notices on show (the outermost one: a pile of toasts, not each toast in it), and the overlays
  // nobody is using right now
  function notices() {
    const out = [];
    for (const el of document.querySelectorAll(`${SEL}, ${OVERLAY}`)) {
      if (el.parentElement && el.parentElement.closest(`${SEL}, ${OVERLAY}`)) continue;
      if (!floats(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const notice = el.matches(SEL);
      if (!notice && (el.contains(document.activeElement) || el.matches(":hover"))) continue;
      out.push({ el, notice });
    }
    return out;
  }
  // What's on the screen to tap (as boxes), here and in a panel's page under this one
  function tappables(skip) {
    const out = [];
    const take = (doc, dx, dy) => {
      for (const t of doc.querySelectorAll(TAPPABLE)) {
        if (skip.some((n) => n.contains(t)) || t.closest(SEL) || t.closest(KEEP_CLEAR)) continue;
        const r = t.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out.push({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy });
        if (out.length > 600) return;
      }
    };
    take(document, 0, 0);
    for (const f of document.querySelectorAll("iframe")) {
      const fr = f.getBoundingClientRect();
      if (fr.width < 2 || fr.height < 2) continue;
      try { if (f.contentDocument) take(f.contentDocument, fr.left, fr.top); } catch (e) { /* (not one of ours) */ }
    }
    return out;
  }

  // Where someone is typing, in this page's own terms (also in a panel's page inside this one, or
  // in Nova Agent's own page around this one): the box and what it's part of (a composer, a form)
  function typingArea() {
    const pick = (doc) => {
      const a = doc.activeElement;
      if (!editable(a)) return null;
      const box = a.closest('form, .composer, [data-composer]') || a;
      return box.getBoundingClientRect();
    };
    let r = pick(document);
    if (!r) {
      const a = document.activeElement;
      if (a && a.tagName === "IFRAME") {
        try {
          const inner = pick(a.contentDocument);
          if (inner) { const f = a.getBoundingClientRect(); r = { left: inner.left + f.left, right: inner.right + f.left, top: inner.top + f.top, bottom: inner.bottom + f.top }; }
        } catch (e) { /* (not one of ours) */ }
      }
    }
    if (!r && window.parent !== window) {
      try {
        const host = window.parent.document;
        const outer = pick(host);
        const me = window.frameElement && window.frameElement.getBoundingClientRect();
        if (outer && me) r = { left: outer.left - me.left, right: outer.right - me.left, top: outer.top - me.top, bottom: outer.bottom - me.top };
      } catch (e) { /* (not one of ours) */ }
    }
    return r ? { left: r.left - GAP, right: r.right + GAP, top: r.top - GAP, bottom: r.bottom + GAP } : null;
  }
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  function setDy(el, dy) {
    let m = moved.get(el);
    if (!dy) {
      if (m) { el.style.translate = m.inline; moved.delete(el); }
      return;
    }
    // (its own translate kept, read before it's moved: a toast centred with translate -50% stays centred)
    if (!m) { m = { inline: el.style.translate, own: (el.style.translate || getComputedStyle(el).translate || "none").trim(), dy: 0 }; moved.set(el, m); }
    if (m.dy === dy) return;
    m.dy = dy;
    const own = m.own;
    const [x = "0px", y = "0px"] = own === "none" ? [] : own.split(/\s+/);
    el.style.translate = `${x} calc(${y} + ${Math.round(dy)}px)`;
  }

  const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  function place() {
    queued = false;
    for (const el of moved.keys()) if (!el.isConnected) moved.delete(el);
    const list = notices();
    if (!list.length) return;
    const busy = typingArea();
    // (what's always kept clear: where someone's typing, a message box whether or not it's being
    // typed in yet, Nova Agent's top panel and its tiles or dock)
    const avoid = busy ? [busy] : [];
    for (const c of document.querySelectorAll(KEEP_CLEAR)) {
      if (c.closest(SEL)) continue;
      const r = c.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) avoid.push({ left: r.left - GAP, right: r.right + GAP, top: r.top - GAP, bottom: r.bottom + GAP });
    }
    const vv = window.visualViewport;
    const top = (vv ? vv.offsetTop : 0) + GAP;
    const bottom = (vv ? vv.offsetTop + vv.height : innerHeight) - GAP;
    let taps = null; // (worked out once, only if a notice needs it)
    for (const { el, notice } of list) {
      const now = el.getBoundingClientRect();
      const had = (moved.get(el) || {}).dy || 0;
      const r = { left: now.left, right: now.right, top: now.top - had, bottom: now.bottom - had };
      // Where it could go: its own place, just above or below each place to keep clear, the top, the
      // bottom (and above a phone's keyboard while typing); only where it's wholly on the screen
      const tries = [0, top - r.top, bottom - r.bottom];
      for (const a of avoid) tries.push(a.top - r.bottom, a.bottom - r.top);
      const fits = tries.filter((dy) => r.top + dy >= top - 0.5 && r.bottom + dy <= bottom + 0.5);
      if (!fits.length) fits.push(top - r.top);
      if (notice && !taps) taps = tappables(list.map((n) => n.el));
      // What each place would cover: anything kept clear counts far more than a button or a link
      let best = 0, bestScore = Infinity;
      for (const dy of fits) {
        const at = { ...r, top: r.top + dy, bottom: r.bottom + dy };
        let score = avoid.reduce((n, a) => n + (overlaps(at, a) ? 1e6 + area(at, a) : 0), 0);
        if (notice) for (const t of taps) if (overlaps(at, t)) score += 1000 + area(at, t) / 10;
        score += Math.abs(dy) / 100; // (the nearest of equals: its own place when nothing's in the way)
        if (score < bestScore) { bestScore = score; best = dy; }
      }
      setDy(el, Math.round(best));
    }
  }
  let queued = false;
  const soon = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };

  // While typing, looked at again now and then (the box grows as it's typed in, a keyboard comes up)
  let ticking = 0;
  function watchTyping() {
    soon();
    if (ticking) return;
    ticking = setInterval(() => {
      if (!typingArea()) { clearInterval(ticking); ticking = 0; }
      soon();
    }, 400);
  }

  // Dragging something by hand: the notices fade right down and let the pointer through
  let press = null;
  addEventListener("pointerdown", (e) => {
    press = e.target && e.target.closest && e.target.closest(SEL) ? null : { x: e.clientX, y: e.clientY };
  }, true);
  addEventListener("pointermove", (e) => {
    if (!press || !e.buttons) return;
    // (once: adding a class that's already there still counts as a change, and restyles the whole
    // page on every move of a drag, 16 Oct 2026)
    if (!press.aside && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { press.aside = true; document.documentElement.classList.add("notices-aside"); }
  }, { capture: true, passive: true });
  const letGo = () => {
    press = null;
    if (document.documentElement.classList.contains("notices-aside")) document.documentElement.classList.remove("notices-aside");
  };
  addEventListener("pointerup", letGo, true);
  addEventListener("pointercancel", letGo, true);

  function start() {
    document.addEventListener("focusin", watchTyping, true);
    document.addEventListener("focusout", () => setTimeout(soon, 60), true);
    document.addEventListener("input", soon, true);
    addEventListener("resize", soon);
    if (window.visualViewport) visualViewport.addEventListener("resize", soon);
    // A notice that appears while someone's typing is placed out of the way straight away
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches(SEL) || n.querySelector?.(SEL) || n.closest?.(SEL))) return watchTyping();
    }).observe(document.documentElement, { childList: true, subtree: true });
    // (and typing in a panel's page or Nova Agent's own counts too: they tell each other)
    if (window.parent !== window) {
      try { window.parent.document.addEventListener("focusin", watchTyping, true); window.parent.document.addEventListener("focusout", () => setTimeout(soon, 60), true); } catch (e) { /* (not one of ours) */ }
    }
  }

  window.NovaNotices = { place, moved: () => moved.size };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
