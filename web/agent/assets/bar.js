// The panels bar (along the bottom on a computer, the bar on a phone) and the top bar: always
//   there by default, in the page (not floating), so nothing slides, hides or waits: you can tap
//   them straight away from any panel. (The old Auto, which hid them while you scrolled or worked
//   higher up, is gone: it made Nova feel laggy. A device that had Auto now has Always shown.)
//   Always hidden is still there for anyone who picks it: the bars stay out of the way everywhere
//   (on a phone the little handle at the bottom still brings the bar up, to get around).
// Chosen in the Panels window (the PANELS button) or the phone's gear; remembered on the device.
//   window.NovaBar = { mode(), setMode('shown'|'hidden'), next(), name(), reveal() }
(() => {
  "use strict";
  const KEY = "nova-bar";
  const MODES = ["shown", "hidden"];
  const NAMES = { shown: "Always shown", hidden: "Always hidden" };
  const pick = (m) => (MODES.includes(m) ? m : "shown"); // nothing saved, or the old Auto: shown
  const root = document.documentElement;
  const main = document.getElementById("main");
  const strip = document.getElementById("suite-home");
  const PHONE = matchMedia("(max-width: 980px), (max-height: 480px)");
  if (!main) return;

  function mode() {
    try {
      return pick(localStorage.getItem(KEY));
    } catch (err) {
      return "shown";
    }
  }
  let current = mode();
  root.dataset.bar = current;
  // The top bar (Nova Agent's header) has its own: Auto, Always shown or Always hidden
  const TOP = "nova-top";
  let topMode = (() => { try { return pick(localStorage.getItem(TOP)); } catch (err) { return "shown"; } })();
  root.dataset.top = topMode;
  let topOut = true;
  const topbar = document.querySelector(".shell > .topbar");

  // Tucked away or in view. It follows what you're doing, not timers:
  //   computer: in view once the mouse rests at the bottom edge, while it's on or near the bar,
  //     away once you've been working higher up in the panel for a moment;
  //   phone: away after you scroll down a good way on purpose, back as soon as you scroll up a
  //     little (or tap the handle). Short pages that hardly scroll never hide it.
  let out = true; // in view (Auto, with a panel open)
  let peeking = false; // brought up with the handle while "Always hidden"
  const viewing = () => main.classList.contains("viewing");
  let typing = false; // you're typing in an open panel (or Nova Agent's box over one): the bar steps aside
  // The brand panel (top bar) is as wide as Agent below it, and so is an open panel's top bar
  // (glow.css and chat.html read --chat-w). While a panel is open Agent is hidden: its last width stays.
  const chatCol = document.querySelector(".main > .chat");
  if (chatCol) new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width + 2); if (w > 2) root.style.setProperty("--chat-w", `${w}px`); }).observe(chatCol);
  // An open panel's top bar takes the width Nova Agent's header has on the home (chat.html reads
  // --top-w), so opening a panel swaps one bar for the other in the same place, the same size
  if (topbar) new ResizeObserver(() => { if (viewing()) return; const w = Math.round(topbar.getBoundingClientRect().width); if (w > 2) root.style.setProperty("--top-w", `${w}px`); }).observe(topbar);
  // When the bar last came or went (scrolling just then isn't counted)
  let movedAt = 0;
  function update() {
    // Auto: only over an open panel (on the home it stays put: the page never shifts under you)
    const tuck = current === "hidden" ? !peeking : current === "auto" ? viewing() && (!out || typing) : false;
    if (tuck !== root.classList.contains("bar-tucked")) movedAt = performance.now();
    root.classList.toggle("bar-tucked", tuck);
    const topTuck = topMode === "shown" ? false : viewing() && !topOut;
    root.classList.toggle("top-tucked", topTuck);
  }
  function show() {
    clearTimeout(revealTimer); revealTimer = null;
    if (!out || typing) { out = true; typing = false; update(); }
  }
  function tuck() {
    if (out && current === "auto" && viewing() && !busy(PHONE.matches ? document.getElementById("tabbar") : strip)) { out = false; update(); }
  }
  // Never while something of the bar's is being used: a window or sheet is open (the Panels
  // window, More, the gear, the activity list), the keyboard is moving through it, or (with a
  // mouse) the pointer is on it. (A tap leaves a phone's "hover" and focus behind, so not those.)
  const busy = (bar) => !!document.querySelector("dialog[open]") || !!document.querySelector(".sl-list:not([hidden])") ||
    (!!bar && bar.matches(":focus-visible, :has(:focus-visible)")) || (!!bar && !PHONE.matches && !root.classList.contains("is-touch") && bar.matches(":hover"));

  function setMode(m) {
    if (!MODES.includes(m)) return current;
    current = m;
    try {
      localStorage.setItem(KEY, m);
    } catch (err) {}
    root.dataset.bar = m;
    out = true;
    peeking = false;
    update();
    window.dispatchEvent(new CustomEvent("novabarchange", { detail: { mode: m } }));
    say(`Panels bar: ${NAMES[m]}`);
    return m;
  }
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

  function setTopMode(m) {
    if (!MODES.includes(m)) return topMode;
    topMode = m;
    try { localStorage.setItem(TOP, m); } catch (err) {}
    root.dataset.top = m;
    topOut = m !== "hidden";
    update();
    window.dispatchEvent(new CustomEvent("novabarchange", { detail: { top: m } }));
    say(`Top bar: ${NAMES[m]}`);
    return m;
  }
  function topShow() { clearTimeout(topReveal); topReveal = null; if (!topOut) { topOut = true; update(); } }
  function topTuck() { if (topOut && topMode !== "shown" && viewing() && !busy(topbar)) { topOut = false; update(); } }

  // A panel opens: it starts full screen, with Nova Agent's bars already away (no hiding to
  // watch: they're simply not there, and come back at the edge as usual; "Always shown" keeps
  // them). A panel closes: the bars are back for Nova Agent's own page.
  let wasViewing = viewing();
  new MutationObserver(() => {
    const now = viewing();
    if (now === wasViewing) return;
    wasViewing = now;
    out = !now;
    topOut = now ? topMode === "shown" : topMode !== "hidden";
    peeking = false;
    typing = false;
    scrolled = 0;
    if (now) {
      // This one change happens without the slide (the next frame on, everything moves as normal)
      root.classList.add("bar-instant");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("bar-instant")));
    }
    update();
  }).observe(main, { attributes: true, attributeFilter: ["class"] });

  // ---- Computer: where the mouse is (on Nova Agent's page and inside the open panel) ----
  // Coming: resting the mouse at the bottom edge (EDGE px) for a blink (REVEAL ms) brings the bar,
  // so just passing through on the way to the panel's own bottom buttons doesn't. Going: only
  // once the mouse has stayed well above it (AWAY px over its top) for a calm moment (HIDE ms);
  // anywhere nearer and it stays. The gap between the two is why it never flickers.
  // The top bar works the same way at the top edge.
  const EDGE = 44, REVEAL = 120, AWAY = 100, HIDE = 600;
  let awayTimer = null, revealTimer = null;
  let topTimer = null, topReveal = null;
  const stop = (t) => { clearTimeout(t); return null; };
  function pointerAt(y) {
    if (PHONE.matches) return;
    // The top bar (Always hidden: only the very top edge brings it)
    if (topMode !== "shown" && viewing()) {
      const topH = topbar ? topbar.offsetHeight : 70;
      if (!topOut) {
        if (y < (topMode === "hidden" ? 6 : 28)) { if (!topReveal) topReveal = setTimeout(() => { topReveal = null; topShow(); }, REVEAL); }
        else topReveal = stop(topReveal);
      } else if (y < topH + AWAY) topTimer = stop(topTimer);
      else if (!topTimer) topTimer = setTimeout(() => { topTimer = null; topTuck(); }, HIDE);
    }
    if (current !== "auto") return;
    const fromBottom = innerHeight - y;
    // Typing on the home: the mouse at the bottom brings the bar back
    if (!viewing()) { if (typing && fromBottom < Math.max(90, innerHeight * 0.14)) show(); return; }
    const barH = strip ? strip.offsetHeight : 90;
    if (out && !typing) {
      if (fromBottom < barH + AWAY) awayTimer = stop(awayTimer);
      else if (!awayTimer) awayTimer = setTimeout(() => { awayTimer = null; tuck(); }, HIDE);
    } else {
      awayTimer = stop(awayTimer);
      if (fromBottom < EDGE) { if (!revealTimer) revealTimer = setTimeout(() => { revealTimer = null; show(); }, REVEAL); }
      else revealTimer = stop(revealTimer);
    }
  }
  document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointerAt(e.clientY); }, { passive: true });
  // The mouse leaving the window through the bottom edge brings the bar at once
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY > innerHeight - EDGE && current === "auto" && viewing() && !PHONE.matches) show();
  });
  // Moving into the bars with the keyboard (Tab) brings them into view
  document.addEventListener("focusin", (e) => {
    if (strip && strip.contains(e.target) && strip.matches(":has(:focus-visible)")) show();
    if (topbar && topbar.contains(e.target) && topbar.matches(":has(:focus-visible)")) topShow();
  });

  // ---- Scrolling inside the open panel ----
  // Phones and touch screens: scrolling down a good way on purpose sends the bars away, scrolling up
  // a little (or reaching the top) brings them back. With a mouse: scrolling down sends them away
  // (they come back at the edges, as above), unless the mouse is on one.
  let scrolled = 0; // how far down (positive) or up (negative) since the last change of direction
  let touching = 0; // until when a finger was last on the panel (only scrolling you do counts)
  let wheeling = 0; // until when the mouse wheel or trackpad last moved in the panel
  const lastY = new WeakMap();
  function onScroll(e) {
    if (!viewing() || (current !== "auto" && topMode === "shown")) return;
    const touch = PHONE.matches || root.classList.contains("is-touch");
    if (performance.now() > (touch ? touching : wheeling)) return; // the page moved by itself
    const el = e.target && e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== "number") return;
    if (el.scrollHeight - el.clientHeight < 160) return; // hardly scrolls: leave the bars be
    const y = el.scrollTop;
    const was = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    if (performance.now() - movedAt < 200) { scrolled = 0; return; } // a bar has only just moved
    const dy = y - was;
    if (!dy) return; // sideways scrolling
    if (Math.sign(dy) !== Math.sign(scrolled)) scrolled = 0;
    scrolled += dy;
    if (scrolled > 70 && y > 60) { tuck(); topTuck(); }
    else if (touch && (scrolled < -24 || y <= 0)) { show(); if (topMode === "auto" || y <= 0) topShow(); }
  }

  // Typing (Nova Agent's message box or any box in a panel): the bar steps aside until you're
  // done (the box loses focus) or the mouse goes to the bottom
  const editable = (t) => t && (t.isContentEditable || (t.matches && t.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])')));
  function onKey(e) {
    if (current !== "auto" || PHONE.matches || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!editable(e.target) || (e.key.length !== 1 && e.key !== "Backspace")) return;
    if (!typing) { typing = true; out = false; update(); }
  }
  function onBlur(e) {
    if (!typing || !editable(e.target)) return;
    setTimeout(() => {
      const a = document.activeElement;
      const inner = a && a.tagName === "IFRAME" ? (() => { try { return a.contentDocument.activeElement; } catch (err) { return null; } })() : a;
      if (!editable(inner)) { typing = false; if (!viewing()) out = true; update(); }
    }, 250);
  }
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("focusout", onBlur, true);

  // Each panel's page (same site): its mouse and its scrolling count too
  function watchFrame(frame) {
    if (frame.dataset.barWatch) return;
    frame.dataset.barWatch = "1";
    // A page is ready to be watched long before it has fully loaded (pictures and all): look for it
    // often for a few seconds after each new page starts, then stop (no checking forever)
    let tries = 0, timer = null;
    const poll = () => { tries = 0; if (!timer) timer = setInterval(() => { attach(); if (++tries > 30) { clearInterval(timer); timer = null; } }, 100); };
    const attach = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.__barWatched || doc.URL === "about:blank") return;
        doc.__barWatched = true;
        if (timer) { clearInterval(timer); timer = null; }
        // The next page this frame goes to: look for it again
        frame.contentWindow.addEventListener("pagehide", poll);
        doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
        doc.addEventListener("wheel", () => { wheeling = performance.now() + 400; }, { capture: true, passive: true });
        doc.addEventListener("keydown", onKey, true);
        doc.addEventListener("focusout", onBlur, true);
        const touch = () => { touching = performance.now() + 900; };
        doc.addEventListener("touchstart", touch, { capture: true, passive: true });
        doc.addEventListener("touchmove", touch, { capture: true, passive: true });
        doc.addEventListener("touchend", touch, { capture: true, passive: true });
        doc.addEventListener("pointermove", (e) => {
          if (e.pointerType !== "mouse") return;
          pointerAt(frame.getBoundingClientRect().top + e.clientY);
        }, { passive: true });
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

  // The handle (phone) and the bottom edge (computer)
  const peek = document.createElement("button");
  peek.type = "button";
  peek.id = "bar-peek";
  peek.className = "bar-peek";
  peek.dataset.sfx = "open";
  peek.setAttribute("aria-label", "Show the panels bar");
  peek.title = "Show the panels";
  peek.innerHTML = '<span aria-hidden="true"></span>';
  document.body.append(peek);
  peek.addEventListener("click", () => {
    if (current === "hidden") { peeking = true; update(); }
    else show();
  });
  // "Always hidden" on a phone: after choosing from the bar it goes away again
  document.addEventListener("click", (e) => {
    if (peeking && e.target.closest && e.target.closest("#tabbar [data-tab]")) setTimeout(() => { peeking = false; update(); }, 600);
  }, true);

  // The choice in the Panels window (chips) and the phone's gear (one button that steps through)
  function showChoice() {
    document.querySelectorAll("[data-bar-mode]").forEach((b) => {
      const on = b.dataset.barMode === current;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
    document.querySelectorAll("[data-top-mode]").forEach((b) => {
      const on = b.dataset.topMode === topMode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", String(on));
    });
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-bar-mode]");
    if (b) setMode(b.dataset.barMode);
    const t = e.target.closest && e.target.closest("[data-top-mode]");
    if (t) setTopMode(t.dataset.topMode);
  });
  window.addEventListener("novabarchange", showChoice);
  showChoice();
  update();

  window.NovaBar = {
    mode: () => current,
    setMode,
    next: () => setMode(MODES[(MODES.indexOf(current) + 1) % MODES.length]),
    topMode: () => topMode,
    setTopMode,
    nextTop: () => setTopMode(MODES[(MODES.indexOf(topMode) + 1) % MODES.length]),
    name: (m = current) => NAMES[m],
    reveal: show,
  };
})();
