// The panels bar (along the bottom on a computer, the bar on a phone) shows and hides itself:
//   Auto (the default): always there on Nova Agent's home. With a panel open it follows what you
//     do: on a computer it comes when you rest the mouse at the bottom edge, stays while the mouse
//     is on or near it, and steps aside when you work higher up; on a phone it steps aside when you scroll down a good way and comes back
//     when you scroll up a little or tap the handle at the bottom.
//   Always shown: it stays, as before.   Always hidden: it stays out of the way everywhere (on a
//     phone the little handle at the bottom still brings it up, to get around).
// Chosen in the Panels window (the PANELS button) or the phone's gear; remembered on the device.
//   window.NovaBar = { mode(), setMode('auto'|'shown'|'hidden'), next(), name(), reveal() }
(() => {
  "use strict";
  const KEY = "nova-bar";
  const MODES = ["auto", "shown", "hidden"];
  const NAMES = { auto: "Auto", shown: "Always shown", hidden: "Always hidden" };
  const root = document.documentElement;
  const main = document.getElementById("main");
  const strip = document.getElementById("suite-home");
  const PHONE = matchMedia("(max-width: 980px), (max-height: 480px)");
  if (!main) return;

  function mode() {
    try {
      const m = localStorage.getItem(KEY);
      return MODES.includes(m) ? m : "auto";
    } catch (err) {
      return "auto";
    }
  }
  let current = mode();
  root.dataset.bar = current;
  // The top bar (Nova Agent's header) has its own: Auto, Always shown or Always hidden
  const TOP = "nova-top";
  let topMode = (() => { try { const m = localStorage.getItem(TOP); return MODES.includes(m) ? m : "auto"; } catch (err) { return "auto"; } })();
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
  let typing = false; // you're typing (Nova Agent's message box or a panel's): the bar steps aside
  // Each tile's place, so they pop in one after another (bar.css)
  // How much room the bars take while they're in view (bar.css makes the open panel give it up)
  // The brand panel (top bar) is as wide as Agent below it (glow.css reads --chat-w)
  const chatCol = document.querySelector(".main > .chat");
  if (chatCol) new ResizeObserver(() => root.style.setProperty("--chat-w", `${Math.round(chatCol.getBoundingClientRect().width)}px`)).observe(chatCol);
  function measure() {
    if (strip) root.style.setProperty("--strip-room", `${strip.offsetHeight + 16}px`);
    if (topbar) root.style.setProperty("--top-room", `${topbar.offsetHeight + 12}px`);
  }
  addEventListener("resize", measure);
  function number() {
    measure();
    document.querySelectorAll("#suite-home .suite-app").forEach((el, i) => el.style.setProperty("--i", i));
    document.querySelectorAll("#tabbar [data-tab]").forEach((el, i) => el.style.setProperty("--i", i));
    if (topbar) topbar.querySelectorAll(".top-side > *, .brand").forEach((el, i) => el.style.setProperty("--i", i));
  }
  // When the bar last came or went (the phone ignores the scrolling that this causes by itself)
  let movedAt = 0;
  function update() {
    number();
    const tuck = current === "hidden" ? !peeking : current === "auto" ? (viewing() && !out) || typing : false;
    const was = root.classList.contains("bar-tucked");
    if (tuck !== was) {
      movedAt = performance.now();
      // (no trail when an app opens: the bar is just away, bar-instant)
      if (!root.classList.contains("bar-instant")) trail(tuck ? "away" : "back");
    }
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

  // ---- The trail: as the panels bar (over an open panel) slides away or comes back, a few soft echoes of it in the
  // theme's colours follow it along its path and fade (about 0.4 s; bar.css draws them). They sit
  // above the page and under the bar, take no clicks and only move and fade (no layout). Not with
  // reduced motion. ----
  const STILL = matchMedia("(prefers-reduced-motion: reduce)");
  let lastTrail = null;
  let awake = false; // not while the page is still opening
  setTimeout(() => { awake = true; }, 400);
  function trail(dir) {
    if (!awake || STILL.matches || current === "shown") return;
    const bar = PHONE.matches ? document.getElementById("tabbar") : viewing() ? strip : null;
    if (!bar) return;
    const cs = getComputedStyle(bar);
    if (cs.display === "none") return;
    // Where the bar rests (its box, minus how far it has slid right now)
    const r = bar.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let slid = 0;
    try { slid = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform).m42; } catch (err) {}
    const top = r.top - slid;
    const travel = Math.max(24, innerHeight - top);
    if (lastTrail) lastTrail.remove();
    const t = document.createElement("div");
    t.className = `bar-trail ${dir}${PHONE.matches ? " phone" : ""}`;
    t.setAttribute("aria-hidden", "true");
    t.style.cssText = `left:${r.left}px;top:${top}px;width:${r.width}px;height:${r.height}px;--travel:${travel}px;--r:${cs.borderTopLeftRadius}`;
    t.innerHTML = "<b></b><i></i><i></i><i></i>";
    document.body.append(t);
    lastTrail = t;
    // Gone once its last echo has faded (or after a while, if it never animated)
    const done = () => { t.remove(); if (lastTrail === t) lastTrail = null; };
    t.lastElementChild.addEventListener("animationend", done);
    setTimeout(done, 5000);
  }

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

  // ---- Phone: deliberate scrolling inside the open panel ----
  let scrolled = 0; // how far down (positive) or up (negative) since the last change of direction
  let touching = 0; // until when a finger was last on the panel (only scrolling you do counts)
  const lastY = new WeakMap();
  function onScroll(e) {
    // Phones, and touch screens of any size (a tablet showing the computer layout too)
    if (!(PHONE.matches || root.classList.contains("is-touch")) || !viewing() || (current !== "auto" && topMode === "shown")) return;
    if (performance.now() > touching) return; // the page moved by itself
    const el = e.target && e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== "number") return;
    if (el.scrollHeight - el.clientHeight < 160) return; // hardly scrolls: leave the bar be
    const y = el.scrollTop;
    const was = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    // Just after the bar came or went the panel changed size, and the page may have shifted by
    // itself (at the very bottom it does): that isn't you scrolling, so it can't start a loop
    if (performance.now() - movedAt < 420) { scrolled = 0; return; }
    const dy = y - was;
    if (!dy) return; // sideways scrolling
    if (Math.sign(dy) !== Math.sign(scrolled)) scrolled = 0;
    scrolled += dy;
    if (scrolled > 70 && y > 60) { tuck(); topTuck(); }
    else if (scrolled < -24 || y <= 0) { show(); if (topMode === "auto" || y <= 0) topShow(); }
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
    const attach = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc || doc.__barWatched) return;
        doc.__barWatched = true;
        doc.addEventListener("scroll", onScroll, { capture: true, passive: true });
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
    // A panel's page is ready for this long before it has fully loaded (pictures and all): check
    // often, so the mouse counts from the start (cheap: one look at a flag)
    setInterval(attach, 400);
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
