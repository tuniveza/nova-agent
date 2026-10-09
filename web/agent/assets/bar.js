// The panels bar (along the bottom on a computer, the bar on a phone) shows and hides itself:
//   Auto (the default): always there on Nova Agent's home. With a panel open it shows for a moment,
//     then steps aside so the panel has the room. It comes back when you move the mouse to the
//     bottom edge (computer), scroll back up in the panel or tap the little handle (phone).
//   Always shown: it stays, as before.   Always hidden: it stays out of the way everywhere (on a
//     phone the little handle at the bottom still brings it up for a moment, to get around).
// Chosen in the Panels window (the PANELS button) or the phone's gear; remembered on the device.
//   window.NovaBar = { mode(), setMode('auto'|'shown'|'hidden'), reveal(ms) }
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

  // Tucked away or in view
  let revealed = false; // shown on purpose for a moment (Auto, or the handle when hidden)
  let hovering = false;
  let timer = null;
  const viewing = () => main.classList.contains("viewing");
  function update() {
    const tuck = current === "hidden" ? !revealed : current === "auto" ? viewing() && !revealed && !hovering : false;
    root.classList.toggle("bar-tucked", tuck);
  }
  // Show it now; with ms, step aside again after that long (unless the pointer is on it)
  function reveal(ms) {
    revealed = true;
    clearTimeout(timer);
    if (ms) timer = setTimeout(() => { revealed = false; update(); }, ms);
    update();
  }
  function hide() {
    revealed = false;
    clearTimeout(timer);
    update();
  }

  function setMode(m) {
    if (!MODES.includes(m)) return current;
    current = m;
    try {
      localStorage.setItem(KEY, m);
    } catch (err) {}
    root.dataset.bar = m;
    revealed = false;
    clearTimeout(timer);
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

  // A panel opens: the bar stays a moment (to switch again), then steps aside. Back home: it's there.
  let wasViewing = viewing();
  new MutationObserver(() => {
    const now = viewing();
    if (now !== wasViewing) {
      wasViewing = now;
      if (now && current === "auto") reveal(2400);
      else update();
    }
  }).observe(main, { attributes: true, attributeFilter: ["class"] });

  // Computer: the pointer on the strip keeps it; leaving it lets it go a moment later
  if (strip) {
    strip.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "mouse") return;
      hovering = true;
      update();
    });
    strip.addEventListener("pointerleave", (e) => {
      if (e.pointerType !== "mouse") return;
      hovering = false;
      if (current === "auto" && viewing()) reveal(900);
      else update();
    });
  }
  // Choosing on the bar: it stays a moment while the new panel opens
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("#tabbar [data-tab], #suite-home .suite-app") && current !== "shown") reveal(2400);
  }, true);

  // The way to bring it back: an invisible edge along the bottom (computer, Auto) or a small
  // handle (phone, Auto or hidden)
  const peek = document.createElement("button");
  peek.type = "button";
  peek.id = "bar-peek";
  peek.className = "bar-peek";
  peek.dataset.sfx = "open";
  peek.setAttribute("aria-label", "Show the panels bar");
  peek.title = "Show the panels";
  peek.innerHTML = '<span aria-hidden="true"></span>';
  document.body.append(peek);
  peek.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" && !PHONE.matches && current === "auto") reveal(1600);
  });
  peek.addEventListener("click", () => reveal(PHONE.matches ? 4500 : 2400));

  // Phone (and computer): scrolling down inside a panel tucks it away, scrolling back up brings it
  const lastY = new WeakMap();
  function onScroll(e) {
    if (current !== "auto" || !viewing()) return;
    const el = e.target && e.target.nodeType === 9 ? e.target.scrollingElement : e.target;
    if (!el || typeof el.scrollTop !== "number") return;
    const y = el.scrollTop;
    const was = lastY.has(el) ? lastY.get(el) : y;
    lastY.set(el, y);
    if (y - was > 6) hide();
    else if (was - y > 10 || y <= 0) reveal(3000);
  }
  function watchFrame(frame) {
    if (frame.dataset.barWatch) return;
    frame.dataset.barWatch = "1";
    const attach = () => {
      try {
        frame.contentDocument.addEventListener("scroll", onScroll, { capture: true, passive: true });
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
    reveal,
  };
})();
