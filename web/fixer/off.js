// The Fixer, switched off (24 Oct 2026, the user: "just disable it entirely in all aspects for now it's a
// waste of time"): /fixer/ says so, with a way home. Home: inside Nova Desk, it closes the panel (Desk's own
// ✕); on a phone, Nova Phone; anywhere else, Nova Desk. Auto-fix's switch for this device is the same as
// the Fixer's page had (localStorage "nova-rules" = "off"; /shared/rules.js).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const home = $("home");
  let phone = false;
  try {
    const f = window.NovaForm && window.NovaForm.get();
    phone = f ? f.device === "phone" : document.documentElement.classList.contains("is-phone");
  } catch (e) {}
  if (phone) {
    home.href = "/phone/";
    home.title = "Back to Nova Phone";
  } else home.title = "Back to Nova Desk";
  home.addEventListener("click", (e) => {
    // (inside Nova Desk's viewer: close it, as its own ✕ does, rather than loading Nova Desk again)
    try {
      const close = window.parent !== window && window.parent.document.getElementById("viewer-close");
      if (close) {
        e.preventDefault();
        close.click();
      }
    } catch (err) { /* (not Nova Desk around it: the link goes home) */ }
  });

  const autoOn = () => {
    try { return localStorage.getItem("nova-rules") !== "off"; } catch (e) { return true; }
  };
  function drawAuto() {
    const on = autoOn();
    $("auto").setAttribute("aria-pressed", String(on));
    $("auto").textContent = on ? "Auto-fix: On" : "Auto-fix: Off";
    $("auto").title = on ? "Every screen fixes what would be cut off or wrap as it draws. Tap to turn it off on this device." : "Off on this device only. Tap to turn it back on.";
  }
  $("auto").addEventListener("click", () => {
    const on = !autoOn();
    // (this page and Nova Desk's own, straight away; every other screen as it opens)
    for (const w of [window, window.parent]) {
      try { if (w.NovaRules) w.NovaRules.set(on); } catch (e) { /* (not Nova Desk's page) */ }
    }
    try { if (on) localStorage.removeItem("nova-rules"); else localStorage.setItem("nova-rules", "off"); } catch (e) { /* (storage blocked) */ }
    drawAuto();
  });
  drawAuto();
})();
