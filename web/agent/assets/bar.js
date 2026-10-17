// The title panel (the top bar, on the home and over every panel) and the navigation panel (the
// panels bar along the bottom, with its status row): Shown (away while you work), Auto, Always shown
// or Always hidden, each remembered on this device. The default (16 Oct 2026) is shown, away only
// while you work (typing in Agent or Notes, moving around Board, setting up an invoice). Auto: while
// you work they slide away and the panel (or the home) grows into all the room they had; they're
// back the moment you want them.
//   Back at once (no wait): the mouse at the top or bottom edge of the screen, a tap or swipe at
//     the edge (the thin edge, or the little handle on a touch screen), Tab into a bar, or
//     scrolling up inside a panel.
//   Away: once the mouse has been away from a bar for 1.5 s (never while the mouse is on it, the
//     keyboard is in it, or a window, sheet, menu or the sign-in card is open), or on a phone or
//     touch screen after scrolling down a good way on purpose.
// Fast: the bars only slide (transform and opacity: in 0.1 s, away in 0.09 s; at once with less
// motion asked for). The panel changes size once per move, never during a slide: a bar going
// away gives up its row after its slide; a bar coming back takes its row first, then slides in.
// Nothing is measured while the mouse moves (the bars' heights are kept as they change).
//   window.NovaBar = { mode(), setMode(m), next(), topMode(), setTopMode(m), nextTop(), name(m), reveal() }
(() => {
  "use strict";
  // Always shown is the default (16 Oct 2026); the Nova tiles (a phone) or the Nova dock (a computer)
  // hide with their own toggle, the slim line on their top edge (and come back with the same line at
  // the bottom of the screen). Also: Auto (away while you work or when the mouse has gone, back at
  // once at the edge or when you stop), "work" (shown, away only while you work: typing in Agent or
  // Notes, moving around Board's table, setting up an invoice) and Always hidden.
  // The default (16 Oct 2026, later): "work", shown, but away while you work anywhere in Nova Agent
  // (typing, or doing something hands-on like dragging), back when you stop.
  // Calm (17 Oct 2026, the user: "not annoying, especially in the Invoicer"): on a computer only
  // typing sends them away (clicking into a box doesn't); they come back once you've stopped for
  // CALM_MS (never the moment you click a button between two boxes, so the page doesn't jump about);
  // and a page that's a form you fill while watching it (the Invoicer: <html data-bars-stay>) keeps
  // them where they are.
  const MODES = ["work", "shown", "auto", "hidden"];
  const NAMES = { work: "Shown, away while you work", shown: "Always shown", auto: "Auto", hidden: "Hidden" };
  // (new keys: the new default for everyone, also on a device that had picked another before)
  const KEYS = { nav: "nova-bar-5", top: "nova-top-5" };
  const pick = (m) => (MODES.includes(m) ? m : "work");
  const load = (k) => { try { return pick(localStorage.getItem(k)); } catch (err) { return "work"; } };
  const root = document.documentElement;
  const main = document.getElementById("main");
  if (!main) return;
  const PHONE = matchMedia("(max-width: 980px), (max-height: 480px)");
  const STILL = matchMedia("(prefers-reduced-motion: reduce)");
  const HIDE_AFTER = 1500, EDGE = 12, NEAR = 60, CALM_MS = 2500;
  const viewing = () => main.classList.contains("viewing");
  const topEl = document.querySelector(".shell > .topbar");
  const stripEl = document.getElementById("suite-home");
  const tabEl = document.getElementById("tabbar");
  const navEl = () => (PHONE.matches ? tabEl : stripEl) || stripEl || tabEl;

  // Each bar: its mode, where it is ("in" | "going" | "away"), its hide timer, its height
  const bars = {
    top: { mode: load(KEYS.top), state: "in", timer: null, h: 56, el: () => topEl, cls: "top" },
    nav: { mode: load(KEYS.nav), state: "in", timer: null, h: 110, el: navEl, cls: "nav" },
  };
  root.dataset.top = bars.top.mode;
  root.dataset.bar = bars.nav.mode;

  // The brand panel (top bar) is as wide as Agent below it (glow.css and chat.html read --chat-w);
  // while a panel is open Agent is hidden: its last width stays. And Nova Agent's header width on
  // the home (--top-w) for an open panel's title panel.
  const chatCol = document.querySelector(".main > .chat");
  if (chatCol) new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width + 2); if (w > 2) root.style.setProperty("--chat-w", `${w}px`); }).observe(chatCol);
  if (topEl) new ResizeObserver(() => { if (viewing()) return; const w = Math.round(topEl.getBoundingClientRect().width); if (w > 2) root.style.setProperty("--top-w", `${w}px`); }).observe(topEl);

  // Heights, kept up to date as the bars change (read when the mouse moves, never measured then)
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const b = e.target === topEl ? bars.top : bars.nav;
      if (e.contentRect.height > 0) b.h = e.borderBoxSize && e.borderBoxSize[0] ? e.borderBoxSize[0].blockSize : e.contentRect.height;
    }
  });
  if (topEl) ro.observe(topEl);
  if (stripEl) ro.observe(stripEl);
  if (tabEl) ro.observe(tabEl);

  // In use: never sent away then (the mouse on it, the keyboard in it, a window or menu open)
  function busy(b) {
    const el = b.el();
    if (document.querySelector("dialog[open]")) return true;
    if (b === bars.nav && document.querySelector(".sl-list:not([hidden])")) return true;
    if (!el) return false;
    if (el.matches(":hover") && !root.classList.contains("is-touch") && !PHONE.matches) return true;
    const a = document.activeElement;
    if (a && el.contains(a) && a !== document.body) return true;
    if (b === bars.top) {
      const badge = el.querySelector("nova-portal-badge");
      if (badge && badge.shadowRoot && badge.shadowRoot.querySelector('[aria-expanded="true"], dialog[open]')) return true;
    }
    return false;
  }

  // ---- Moving a bar ----
  function show(b) {
    if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    if (b.state === "in") return;
    const el = b.el();
    const wasAway = b.state === "away";
    b.state = "in";
    root.classList.remove(`${b.cls}-going`);
    if (!wasAway || STILL.matches || !el) { root.classList.remove(`${b.cls}-away`); return; }
    // It slides in at once, over the edge of the content (still out of the rows, in the same place
    // it will sit), and only then takes its row back: the content shrinks once, after the slide,
    // so the slide never waits for the panel to re-fit
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      if (b.state === "in") root.classList.remove(`${b.cls}-away`);
    };
    const onEnd = (e) => { if (e.target === el && e.propertyName === "transform") settle(); };
    el.addEventListener("transitionend", onEnd);
    setTimeout(settle, 200);
  }
  // (keepRow: it slides away over the content but keeps its row, so the panel isn't resized; used
  // while something is being dragged, where a panel resizing mid-drag costs frames, 16 Oct 2026)
  function hide(b, keepRow = false) {
    if (b.timer) { clearTimeout(b.timer); b.timer = null; }
    if (b.state !== "in" || b.mode === "shown") return;
    // (coming in and still over the content: straight back out, no row to give up)
    const over = root.classList.contains(`${b.cls}-away`);
    b.state = "going";
    if (over) { root.classList.add(`${b.cls}-going`); b.state = "away"; return; }
    const el = b.el();
    if (STILL.matches || !el) { root.classList.add(`${b.cls}-going`, `${b.cls}-away`); b.state = "away"; return; }
    root.classList.add(`${b.cls}-going`);
    if (keepRow) return; // (state stays "going": show() brings it straight back, nothing to re-fit)
    // Its slide done: give up the row (the panel grows once)
    let done = false;
    const away = () => {
      if (done) return;
      done = true;
      el.removeEventListener("transitionend", onEnd);
      if (b.state === "going") { b.state = "away"; root.classList.add(`${b.cls}-away`); }
    };
    const onEnd = (e) => { if (e.target === el && e.propertyName === "transform") away(); };
    el.addEventListener("transitionend", onEnd);
    setTimeout(away, 180); // (in case the slide never reports its end)
  }
  // Away in a moment, if it's still not wanted then
  function later(b) {
    if (b.timer || b.state !== "in" || b.mode !== "auto") return;
    b.timer = setTimeout(() => {
      b.timer = null;
      if (b.state !== "in" || b.mode === "shown") return;
      if (busy(b)) return later(b); // in use: look again in a moment
      hide(b);
    }, HIDE_AFTER);
  }
  const stay = (b) => { if (b.timer) { clearTimeout(b.timer); b.timer = null; } };

  // ---- The mouse (on Nova Agent's page and inside the open panel) ----
  // y: from the top of the window. At the very edge a bar comes at once; near a shown bar it
  // stays; anywhere else it goes after HIDE_AFTER.
  function pointerAt(y) {
    const H = innerHeight;
    for (const b of [bars.top, bars.nav]) {
      if (b.mode === "shown") continue;
      const fromEdge = b === bars.top ? y : H - y;
      if (fromEdge <= EDGE) { show(b); continue; }
      if (b.mode === "work") continue; // (away only while you work: below)
      if (b.state !== "in") continue;
      if (fromEdge < b.h + NEAR) stay(b);
      else later(b);
    }
  }
  document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointerAt(e.clientY); }, { passive: true });
  // The mouse leaving the window through the top or bottom edge brings that bar
  document.addEventListener("mouseout", (e) => {
    if (e.relatedTarget) return;
    if (e.clientY <= EDGE) show(bars.top);
    else if (e.clientY >= innerHeight - EDGE) show(bars.nav);
  });
  // The keyboard moving into a bar (Tab) brings it
  document.addEventListener("focusin", (e) => {
    if (topEl && topEl.contains(e.target)) show(bars.top);
    const nav = navEl();
    if (nav && nav.contains(e.target)) show(bars.nav);
  });

  // ---- Scrolling inside a panel ----
  // Up a little (or back to the top): both bars come back (Auto). Down a good way on purpose, on a
  // phone or touch screen: both go (with a mouse they go when it's been away a moment, above).
  let scrolled = 0, touching = 0, wheeling = 0;
  const lastY = new WeakMap();
  function onScroll(e) {
    const touch = PHONE.matches || root.classList.contains("is-touch");
    if (performance.now() > (touch ? touching : wheeling)) return; // the page moved by itself
    const el = e.target && e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== "number") return;
    if (el.scrollHeight - el.clientHeight < 160) return; // hardly scrolls: leave the bars be
    const y = el.scrollTop;
    const was = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    const dy = y - was;
    if (!dy) return;
    if (Math.sign(dy) !== Math.sign(scrolled)) scrolled = 0;
    scrolled += dy;
    if (scrolled < -24 || y <= 0) { for (const b of [bars.top, bars.nav]) if (b.mode === "auto") show(b); }
    else if (touch && scrolled > 70 && y > 60) { for (const b of [bars.top, bars.nav]) if (b.mode === "auto" && !busy(b)) hide(b); }
  }
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("wheel", () => { wheeling = performance.now() + 400; }, { capture: true, passive: true });

  // ---- Touch: a swipe in from the top or bottom edge brings that bar ----
  let swipe = null;
  function touchStart(y) { const H = innerHeight; swipe = y < 28 ? { b: bars.top, y } : y > H - 28 ? { b: bars.nav, y } : null; touching = performance.now() + 900; }
  function touchMove(y) {
    touching = performance.now() + 900;
    if (!swipe) return;
    if ((swipe.b === bars.top && y - swipe.y > 16) || (swipe.b === bars.nav && swipe.y - y > 16)) { show(swipe.b); swipe = null; }
  }
  document.addEventListener("touchstart", (e) => touchStart(e.touches[0].clientY), { capture: true, passive: true });
  document.addEventListener("touchmove", (e) => touchMove(e.touches[0].clientY), { capture: true, passive: true });
  document.addEventListener("touchend", () => { touching = performance.now() + 900; swipe = null; }, { capture: true, passive: true });

  // ---- While you work (the default, "work"; Auto too): the bars step aside, back when you stop ----
  // Anywhere in Nova Agent, its home and every panel: typing in any box (or tapping into one to
  // type), or doing something hands-on: dragging with a mouse or pen, dragging a surface made to be
  // dragged on a touch screen (Board's table, a slider), zooming Board's table with the wheel. Back
  // when the box is left (unless another takes over), 1.2 s after a drag or zoom, or at once at the
  // edge. (Scrolling a list isn't working: that's Auto's.)
  let working = false, resting = null;
  // (still: when the wait is up, is something still being worked on? then they stay away for now)
  function work(on, after = 0, hands = false, still = null) {
    if (resting) { clearTimeout(resting); resting = null; }
    if (!on && after) { resting = setTimeout(() => { resting = null; if (!(still && still())) work(false); }, after); return; }
    if (on === working) return;
    working = on;
    // (Auto too: away while you work, back when you stop, as well as when the mouse has gone)
    for (const b of [bars.top, bars.nav]) if (b.mode === "work" || b.mode === "auto") (on ? hide(b, hands) : show(b));
  }
  const editable = (el) => !!el && (el.isContentEditable || /^(TEXTAREA|SELECT)$/.test(el.tagName) || (el.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type || "")));
  const inBars = (el) => !!el && el.ownerDocument === document && !!((topEl && topEl.contains(el)) || (stripEl && stripEl.contains(el)) || (tabEl && tabEl.contains(el)));
  // A surface made to be dragged on a touch screen (its own touch handling, or marked data-pan)
  function dragSurface(el) {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 6; n = n.parentElement, i++) {
      if (n.hasAttribute("data-pan") || (n.tagName === "INPUT" && n.type === "range")) return true;
      const ta = n.ownerDocument.defaultView.getComputedStyle(n).touchAction;
      if (ta === "none" || ta === "pinch-zoom") return true;
    }
    return false;
  }
  function watchWork(doc) {
    // (never tapped yet: a box a page focuses by itself as it loads is never "tapping into it")
    let tapped = -Infinity, drag = null, touched = false;
    // (a page that asks for its bars to stay, data-bars-stay: nothing done on it sends them away)
    const stays = () => doc.documentElement.hasAttribute("data-bars-stay");
    const inBox = () => { const a = doc.activeElement; return editable(a) && !inBars(a); };
    doc.addEventListener("pointerdown", (e) => {
      tapped = performance.now();
      touched = e.pointerType === "touch" || e.pointerType === "pen";
      drag = inBars(e.target) || e.target.closest?.(".dock-handle, .bar-edge") ? null : { x: e.clientX, y: e.clientY, on: false, ok: e.pointerType !== "touch" || dragSurface(e.target) };
    }, true);
    doc.addEventListener("keydown", () => { tapped = performance.now(); }, true);
    // Typing (or tapping into a box to type: never the cursor a page puts in a box by itself)
    // (tapping into a box only counts on a touch screen, where the keyboard comes up over the page)
    doc.addEventListener("input", (e) => { if (e.isTrusted && editable(e.target) && !inBars(e.target) && !stays()) work(true); }, true);
    doc.addEventListener("focusin", (e) => { if (editable(e.target) && !inBars(e.target) && touched && performance.now() - tapped < 800 && !stays()) work(true); }, true);
    // Leaving a box: back once you've stopped for a moment (into another box first: they stay away)
    doc.addEventListener("focusout", (e) => {
      if (!editable(e.target) || !working) return;
      setTimeout(() => { if (!inBox() && !(drag && drag.on)) work(false, CALM_MS, false, inBox); }, 300);
    }, true);
    // Dragging
    doc.addEventListener("pointermove", (e) => {
      if (!drag || !drag.ok || !e.buttons) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12 && !stays()) { drag.on = true; work(true, 0, true); }
    }, { capture: true, passive: true });
    const end = () => { if (drag && drag.on) { const a = doc.activeElement; if (!editable(a)) work(false, 1200); } drag = null; };
    doc.addEventListener("pointerup", end, true);
    doc.addEventListener("pointercancel", end, true);
    // Zooming a surface you drag around (Board's table) with the wheel
    doc.addEventListener("wheel", (e) => { if (e.target.closest && e.target.closest("[data-pan]") && !stays()) { work(true, 0, true); work(false, 1200); } }, { capture: true, passive: true });
  }
  watchWork(document);
  // Leaving a panel: nothing's being worked on there any more
  new MutationObserver(() => { if (!viewing() && working) work(false); }).observe(main, { attributes: true, attributeFilter: ["class"] });

  // ---- Each panel's page (same site): its mouse, scrolling and swipes count too ----
  function watchFrame(frame) {
    if (frame.dataset.barWatch) return;
    frame.dataset.barWatch = "1";
    // A page is ready to be watched long before it has fully loaded: look for it often for a few
    // seconds after each new page starts, then stop (no checking forever)
    let tries = 0, timer = null;
    const poll = () => { tries = 0; if (!timer) timer = setInterval(() => { attach(); if (++tries > 30) { clearInterval(timer); timer = null; } }, 100); };
    // (the frame's top, kept: where it is only changes when a bar comes or goes)
    let top = 0;
    const where = () => { top = frame.getBoundingClientRect().top; };
    const attach = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.__barWatched || doc.URL === "about:blank") return;
        doc.__barWatched = true;
        if (timer) { clearInterval(timer); timer = null; }
        frame.contentWindow.addEventListener("pagehide", poll);
        frame.contentWindow.addEventListener("resize", where);
        where();
        doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
        doc.addEventListener("wheel", () => { wheeling = performance.now() + 400; }, { capture: true, passive: true });
        doc.addEventListener("touchstart", (e) => { where(); touchStart(top + e.touches[0].clientY); }, { capture: true, passive: true });
        doc.addEventListener("touchmove", (e) => touchMove(top + e.touches[0].clientY), { capture: true, passive: true });
        doc.addEventListener("touchend", () => { touching = performance.now() + 900; swipe = null; }, { capture: true, passive: true });
        doc.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointerAt(top + e.clientY); }, { passive: true });
        watchWork(doc);
      } catch (err) {} // not one of ours
    };
    frame.addEventListener("load", attach);
    attach();
    poll();
  }
  const viewer = document.getElementById("viewer");
  if (viewer) {
    viewer.querySelectorAll("iframe").forEach(watchFrame);
    new MutationObserver(() => viewer.querySelectorAll("iframe").forEach(watchFrame)).observe(viewer, { childList: true, subtree: true });
  }

  // ---- The edges: thin strips at the top and bottom of the screen while a bar is away ----
  function edge(b, side, label) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `bar-edge ${side}`;
    el.id = side === "bottom" ? "bar-peek" : "top-peek";
    el.dataset.sfx = "none";
    el.setAttribute("aria-label", label);
    el.title = label;
    el.innerHTML = '<span aria-hidden="true"></span>';
    document.body.append(el);
    // (the mouse touching it is the edge in pointerAt, above; a tap or a click here: hidden with the
    // toggle, it's shown again for good)
    const open = () => (b.mode === "hidden" ? setFor(b, "shown", dockName()) : show(b));
    el.addEventListener("click", open);
    // (the bottom one is the drawer's handle while it's closed: pull it up and the tiles or dock come
    // up with the finger, like opening a drawer; let go past a third of the way, or with a flick up,
    // and they open, else they slide back down. A tap opens them too.)
    if (side === "bottom") {
      let pull = null;
      const box = () => b.el();
      el.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        pull = { id: e.pointerId, y: e.clientY, lastY: e.clientY, lastAt: performance.now(), v: 0, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch (err) {}
      });
      el.addEventListener("pointermove", (e) => {
        if (!pull || e.pointerId !== pull.id) return;
        const up = pull.y - e.clientY;
        if (!pull.moved && up < 5) return;
        const d = box();
        if (!d) return;
        if (!pull.moved) { pull.moved = true; pull.h = d.offsetHeight + 16; root.classList.add("dock-grabbed", "nav-pulling"); d.style.transition = "none"; d.style.willChange = "transform, opacity"; }
        const now = performance.now();
        pull.v = (pull.lastY - e.clientY) / Math.max(1, now - pull.lastAt);
        pull.lastY = e.clientY;
        pull.lastAt = now;
        // (once a frame, on its own layer, as above)
        pull.up = up;
        if (pull.frame) return;
        pull.frame = requestAnimationFrame(() => {
          if (!pull) return;
          pull.frame = 0;
          const u = Math.max(0, pull.up), h = pull.h;
          d.style.transform = `translate3d(0, ${Math.max(0, h - u)}px, 0)`;
          d.style.opacity = String(Math.min(1, 0.35 + u / h));
        });
      });
      const letGo = (e) => {
        if (!pull || e.pointerId !== pull.id) return;
        const p = pull;
        pull = null;
        if (p.frame) cancelAnimationFrame(p.frame);
        if (!p.moved) return; // (a tap: the click opens them)
        el.addEventListener("click", (c) => c.stopImmediatePropagation(), { capture: true, once: true }); // (a pull isn't also a tap)
        const d = box();
        root.classList.remove("dock-grabbed", "nav-pulling");
        if (d) d.style.transition = d.style.transform = d.style.opacity = d.style.willChange = "";
        const up = p.y - e.clientY;
        if (e.type === "pointerup" && d && (up > (d.offsetHeight + 16) / 3 || (up > 12 && p.v > 0.5))) open();
      };
      el.addEventListener("pointerup", letGo);
      el.addEventListener("pointercancel", letGo);
    }
  }
  edge(bars.top, "top", "Show the title panel");
  edge(bars.nav, "bottom", "Show the navigation panel");

  // ---- The toggle on the Nova tiles / Nova dock: a slim line on its top edge (no room of its own) ----
  const dockName = () => (PHONE.matches ? "Nova tiles" : "Nova dock");
  function handleFor(box) {
    if (!box) return;
    // (not a <button>: the tiles' own look is for buttons; this is a slim line, worked the same way)
    const h = document.createElement("div");
    h.setAttribute("role", "button");
    h.tabIndex = 0;
    h.className = "dock-handle";
    h.dataset.sfx = "none";
    const say = () => { const t = `Hide the ${dockName()}`; h.setAttribute("aria-label", t); h.title = t; };
    say();
    PHONE.addEventListener("change", say);
    h.innerHTML = '<span class="grip" aria-hidden="true"><i></i><i></i></span>';
    // A drawer's handle (16 Oct 2026): grab it with a finger or the mouse and the tiles or dock follow
    // it down; let go past a third of the way (or with a flick) and they close, else they spring back.
    // A tap or a mouse click closes them too; Enter or Space from the keyboard as well.
    const close = () => setFor(bars.nav, "hidden", dockName());
    let grab = null;
    h.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.stopPropagation();
      grab = { id: e.pointerId, y: e.clientY, at: performance.now(), lastY: e.clientY, lastAt: performance.now(), v: 0, moved: false };
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
    });
    h.addEventListener("pointermove", (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      const dy = e.clientY - grab.y;
      if (!grab.moved && Math.abs(dy) < 5) return;
      if (!grab.moved) { grab.moved = true; grab.h = box.offsetHeight; root.classList.add("dock-grabbed"); box.style.transition = "none"; box.style.willChange = "transform, opacity"; }
      const now = performance.now();
      grab.v = (e.clientY - grab.lastY) / Math.max(1, now - grab.lastAt);
      grab.lastY = e.clientY;
      grab.lastAt = now;
      // (down: it follows the finger; up: only a little give, it's already open). Once a frame, on
      // its own layer (will-change): the phone moves the picture it has, nothing is drawn again
      grab.dy = dy;
      if (grab.frame) return;
      grab.frame = requestAnimationFrame(() => {
        if (!grab) return;
        grab.frame = 0;
        const d = grab.dy, pull = d > 0 ? d : d / 5;
        box.style.transform = `translate3d(0, ${pull}px, 0)`;
        box.style.opacity = String(Math.max(0.4, 1 - Math.max(0, d) / (grab.h * 1.6)));
      });
    });
    const letGo = (e) => {
      if (!grab || e.pointerId !== grab.id) return;
      const g = grab;
      grab = null;
      if (g.frame) cancelAnimationFrame(g.frame);
      root.classList.remove("dock-grabbed");
      const dy = e.clientY - g.y;
      // (back to its own slide: from wherever it was let go, either away or back into place)
      box.style.transition = box.style.transform = box.style.opacity = box.style.willChange = "";
      if (!g.moved) { if (e.type === "pointerup") close(); return; }
      if (e.type === "pointerup" && (dy > box.offsetHeight / 3 || (dy > 12 && g.v > 0.5))) close();
    };
    h.addEventListener("pointerup", letGo);
    h.addEventListener("pointercancel", letGo);
    h.addEventListener("click", (e) => { e.stopPropagation(); if (e.detail === 0) close(); }); // (keyboard: Enter or Space)
    h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); close(); } });
    box.append(h);
    // (the phone's bar redraws itself now and then: the line stays on it)
    new MutationObserver(() => { if (!box.contains(h)) box.append(h); }).observe(box, { childList: true });
  }
  handleFor(tabEl);
  handleFor(stripEl);
  const peek = document.getElementById("bar-peek");
  const peekSay = () => { if (peek) { const t = `Show the ${dockName()}`; peek.setAttribute("aria-label", t); peek.title = t; } };
  peekSay();
  PHONE.addEventListener("change", peekSay);

  // ---- The choices ----
  function apply(b) {
    root.dataset[b === bars.top ? "top" : "bar"] = b.mode;
    if (b.mode === "hidden") hide(b);
    else show(b);
  }
  function setFor(b, m, label) {
    if (!MODES.includes(m)) return b.mode;
    b.mode = m;
    try { localStorage.setItem(KEYS[b === bars.top ? "top" : "nav"], m); } catch (err) {}
    apply(b);
    window.dispatchEvent(new CustomEvent("novabarchange", { detail: b === bars.top ? { top: m } : { mode: m } }));
    say(m === "hidden" && b === bars.nav ? `${label} hidden: the line at the bottom brings it back` : `${label}: ${NAMES[m]}`);
    return m;
  }
  const setMode = (m) => setFor(bars.nav, m, dockName());
  const setTopMode = (m) => setFor(bars.top, m, "Top bar");
  // A short note in the middle of the screen when the choice changes
  let note = null;
  function say(text) {
    if (!note) {
      note = document.createElement("div");
      note.className = "bar-note";
      note.setAttribute("role", "status");
      document.body.append(note);
    }
    note.textContent = text;
    note.classList.remove("show");
    void note.offsetWidth;
    note.classList.add("show");
  }
  function showChoice() {
    document.querySelectorAll("[data-bar-mode]").forEach((el) => { const on = el.dataset.barMode === bars.nav.mode; el.classList.toggle("active", on); el.setAttribute("aria-checked", String(on)); });
    document.querySelectorAll("[data-top-mode]").forEach((el) => { const on = el.dataset.topMode === bars.top.mode; el.classList.toggle("active", on); el.setAttribute("aria-checked", String(on)); });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-bar-mode]");
    if (b) setMode(b.dataset.barMode);
    const t = e.target.closest && e.target.closest("[data-top-mode]");
    if (t) setTopMode(t.dataset.topMode);
  });
  window.addEventListener("novabarchange", showChoice);

  // Opening or closing a panel: the bars are there to begin with (Auto and Always shown), so you
  // see where you are; Always hidden keeps them away
  let wasViewing = viewing();
  new MutationObserver(() => {
    const now = viewing();
    if (now === wasViewing) return;
    wasViewing = now;
    scrolled = 0;
    for (const b of [bars.top, bars.nav]) if (b.mode !== "hidden") show(b);
  }).observe(main, { attributes: true, attributeFilter: ["class"] });
  // A different size of window (phone ↔ computer): the bar that's the navigation panel changes
  PHONE.addEventListener("change", () => { if (bars.nav.state !== "in") { bars.nav.state = "in"; root.classList.remove("nav-going", "nav-away"); hide(bars.nav); } });

  // Always hidden: away from the start (no slide to watch)
  for (const b of [bars.top, bars.nav]) if (b.mode === "hidden") { root.classList.add(`${b.cls}-going`, `${b.cls}-away`); b.state = "away"; }
  showChoice();

  window.NovaBar = {
    mode: () => bars.nav.mode,
    setMode,
    next: () => setMode(MODES[(MODES.indexOf(bars.nav.mode) + 1) % MODES.length]),
    topMode: () => bars.top.mode,
    setTopMode,
    nextTop: () => setTopMode(MODES[(MODES.indexOf(bars.top.mode) + 1) % MODES.length]),
    name: (m = bars.nav.mode) => NAMES[m],
    reveal: () => { show(bars.nav); show(bars.top); },
    // (for the checks: send both away now, as if the mouse had been away)
    tuck: () => { hide(bars.top); hide(bars.nav); },
    state: () => ({ top: bars.top.state, nav: bars.nav.state }),
  };
})();
