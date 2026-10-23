// The Backend (23 Oct 2026, the owner: "put fixer, computer, observatory, console, manual and index into it backend
// area that can be accessed by a little trick motion of the nova agent as it won't be needed for the main nova suite").
// The six live in chat.html's <dialog id="backend">, off the dock, the tiles and the Panels window. It opens by:
//   - pressing and holding Nova Agent's mark in the top bar for about a second (it pulses while held, and a phone
//     that can gives one short, soft buzz when it opens);
//   - clicking the mark three times with a mouse.
// A normal tap or click on the mark still does what it always did (Nova Agent's own page). With a mouse that one
// click waits a moment (under half a second) in case it's the start of three. Esc, the ✕, a tap outside it or a
// phone's Back closes it (phone.js closes any open window on Back). window.NovaBackend = { open, close }.
(() => {
  "use strict";
  const dlg = document.getElementById("backend");
  const brand = document.querySelector(".shell > .topbar .brand");
  if (!dlg || !brand) return;

  const HOLD_MS = 900; // (about a second, with the pulse)
  const CLICKS_MS = 450; // (between the clicks of a triple-click)
  const MOVE_PX = 12; // (a finger that slides further is scrolling or dragging, not holding)
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(name);
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function open() {
    if (dlg.open) return;
    const suite = document.getElementById("suite");
    if (suite && suite.open) suite.close();
    dlg.showModal();
    sfx("open");
  }
  function close() { if (dlg.open) dlg.close(); }
  const closeBtn = document.getElementById("backend-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });

  // ---- Press and hold ----
  let hold = null; // { id, x, y, timer, type }
  let fired = false; // (the click after a hold that opened the Backend does nothing else)
  let lastType = "mouse";
  const stop = () => {
    if (!hold) return;
    clearTimeout(hold.timer);
    hold = null;
    brand.classList.remove("bk-holding");
  };
  brand.addEventListener("pointerdown", (e) => {
    lastType = e.pointerType || "mouse";
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    stop();
    fired = false;
    brand.classList.add("bk-holding");
    hold = {
      id: e.pointerId, x: e.clientX, y: e.clientY, type: lastType,
      timer: setTimeout(() => {
        stop();
        fired = true;
        // (a short, calm buzz where the phone allows it: Android's browsers; iPhones have none for pages)
        try { if (navigator.vibrate && !calm()) navigator.vibrate(12); } catch (err) {}
        cancelClicks();
        open();
        swallowClick();
      }, HOLD_MS),
    };
  });
  brand.addEventListener("pointermove", (e) => {
    if (hold && e.pointerId === hold.id && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_PX) stop();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) brand.addEventListener(type, stop);
  // (a long press on a link would otherwise bring up the phone's link menu, or start dragging the link)
  brand.addEventListener("contextmenu", (e) => { if (fired || hold) e.preventDefault(); });
  brand.addEventListener("dragstart", (e) => e.preventDefault());

  // (the finger or button let go after a hold makes a click, and on a touch screen that click lands on the window that
  // just opened, outside its box, which would close it again: that one click, straight after letting go, does nothing;
  // a tap after that is a tap)
  function swallowClick() {
    let upAt = 0;
    const up = () => { upAt = Date.now(); };
    const eat = (e) => { if (upAt && Date.now() - upAt < 400) { e.preventDefault(); e.stopImmediatePropagation(); } done(); };
    const done = () => { removeEventListener("pointerup", up, true); removeEventListener("click", eat, true); clearTimeout(t); };
    const t = setTimeout(done, 15000);
    addEventListener("pointerup", up, true);
    addEventListener("click", eat, true);
  }

  // ---- Three clicks (a mouse); one click still goes where it always went ----
  let clicks = 0, clickTimer = null, lastClick = 0;
  const cancelClicks = () => { clearTimeout(clickTimer); clickTimer = null; clicks = 0; };
  brand.addEventListener("click", (e) => {
    if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; return; }
    // (opening it in a new tab, a keyboard's Enter, a finger or a pen: as it always was, straight away)
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0 || e.detail === 0 || lastType !== "mouse") return;
    e.preventDefault();
    const now = Date.now();
    clicks = now - lastClick < CLICKS_MS + 150 ? clicks + 1 : 1;
    lastClick = now;
    clearTimeout(clickTimer);
    if (clicks >= 3) { cancelClicks(); open(); return; }
    const href = brand.href;
    clickTimer = setTimeout(() => { cancelClicks(); location.assign(href); }, CLICKS_MS);
  }, true);

  window.NovaBackend = { open, close };
})();
