// The panels bar (along the bottom on a computer, the bar on a phone) shows and hides itself:
//   Auto (the default): always there on Nova Agent's home. With a panel open it follows what you
//     do: on a computer it's in view while the mouse is near the bottom and steps aside when you
//     work higher up; on a phone it steps aside when you scroll down a good way and comes back
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
  const PHONE = matchMedia("(max-width: 980px), (max-height: 600px)");
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

  // Tucked away or in view. It follows what you're doing, not timers:
  //   computer: in view while the mouse is near the bottom (or on the bar), away once you're
  //     working higher up in the panel;
  //   phone: away after you scroll down a good way on purpose, back as soon as you scroll up a
  //     little (or tap the handle). Short pages that hardly scroll never hide it.
  let out = true; // in view (Auto, with a panel open)
  let peeking = false; // brought up with the handle while "Always hidden"
  const viewing = () => main.classList.contains("viewing");
  function update() {
    const tuck = current === "hidden" ? !peeking : current === "auto" ? viewing() && !out : false;
    root.classList.toggle("bar-tucked", tuck);
  }
  function show() {
    if (!out) { out = true; update(); }
  }
  function tuck() {
    if (out && current === "auto" && viewing() && !busy()) { out = false; update(); }
  }
  // Never while something of the bar's is being used (its menus, the Panels window)
  // (and while you move through the bar with the keyboard)
  const busy = () => !!document.querySelector("dialog[open]") || (strip && strip.matches(":focus-visible, :has(:focus-visible)"));

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

  // A panel opens or closes: the bar is in view to start with (it goes once you get to work)
  let wasViewing = viewing();
  new MutationObserver(() => {
    const now = viewing();
    if (now === wasViewing) return;
    wasViewing = now;
    out = true;
    peeking = false;
    scrolled = 0;
    update();
  }).observe(main, { attributes: true, attributeFilter: ["class"] });

  // ---- Computer: where the mouse is (on Nova Agent's page and inside the open panel) ----
  // Near the bottom (within the bar's height plus a margin): in view. Well above it for a
  // moment: away. A little dead band between the two, so it never flickers.
  let awayTimer = null;
  function pointerAt(y) {
    if (PHONE.matches || current !== "auto" || !viewing()) return;
    const barH = strip ? strip.offsetHeight : 90;
    const fromBottom = innerHeight - y;
    if (fromBottom < 28 || (out && fromBottom < barH + 40)) {
      clearTimeout(awayTimer);
      awayTimer = null;
      show();
    } else if (out && fromBottom > barH + 90 && !awayTimer) {
      awayTimer = setTimeout(() => { awayTimer = null; tuck(); }, 450);
    } else if (!out && awayTimer) {
      clearTimeout(awayTimer);
      awayTimer = null;
    }
  }
  document.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointerAt(e.clientY); }, { passive: true });
  // The mouse leaving the window at the bottom edge counts as "near the bottom"
  document.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && e.clientY > innerHeight - 40) pointerAt(innerHeight - 1); });

  // ---- Phone: deliberate scrolling inside the open panel ----
  let scrolled = 0; // how far down (positive) or up (negative) since the last change of direction
  let touching = 0; // until when a finger was last on the panel (only scrolling you do counts)
  const lastY = new WeakMap();
  function onScroll(e) {
    if (!PHONE.matches || current !== "auto" || !viewing()) return;
    if (performance.now() > touching) return; // the page moved by itself
    const el = e.target && e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== "number") return;
    if (el.scrollHeight - el.clientHeight < 160) return; // hardly scrolls: leave the bar be
    const y = el.scrollTop;
    const was = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    const dy = y - was;
    if (!dy) return; // sideways scrolling
    if (Math.sign(dy) !== Math.sign(scrolled)) scrolled = 0;
    scrolled += dy;
    if (scrolled > 70 && y > 60) tuck();
    else if (scrolled < -24 || y <= 0) show();
  }

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
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-bar-mode]");
    if (!b) return;
    setMode(b.dataset.barMode);
  });
  window.addEventListener("novabarchange", showChoice);
  showChoice();
  update();

  window.NovaBar = {
    mode: () => current,
    setMode,
    next: () => setMode(MODES[(MODES.indexOf(current) + 1) % MODES.length]),
    name: (m = current) => NAMES[m],
    reveal: show,
  };
})();
