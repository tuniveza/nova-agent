// Shown inside another app (Nova Agent's viewer or its Calendar tab): fit the calendar to
// the space it's given, so nothing needs scrolling. Loaded in the <head>, before the page
// is drawn. Opened on its own, it goes to Nova Agent with Calendar open. Add ?embed=1 to the
// address to see it on its own anyway (for working on it).
(() => {
  "use strict";
  // Motion for every panel inside Nova Agent (cheap: only scale and opacity move, never layout): the
  // panel fades in as it opens, and buttons, tabs and chips press in softly. Off when the device asks
  // for less motion or Portal's Options → Animations is off. (Zero-specificity rules, so a panel's own
  // transitions always win.)
  const MOTION = `@media (prefers-reduced-motion: no-preference) {
    :where(html.embed:not([data-motion="calm"])) body { animation: nova-panel-in .4s cubic-bezier(.2,.8,.2,1) backwards; }
    @keyframes nova-panel-in { from { opacity: 0; } }
    :where(html:not([data-motion="calm"])) :where(button, [role="button"], [role="tab"], .btn, .chip, .tab) { transition: scale .16s cubic-bezier(.2,.8,.2,1); }
    :where(html:not([data-motion="calm"])) :where(button, [role="button"], [role="tab"], .btn, .chip, .tab):not(:disabled):active { scale: .96; }
  }`;
  let inside = false;
  try {
    inside = window.self !== window.top;
  } catch (err) {
    inside = true;
  }
  if (inside || /[?&]embed=1\b/.test(location.search)) document.documentElement.classList.add("embed");
  // Inside Nova Agent its header has the planet (sign in and out) and the Manual: no second copy here.
  // (A constructed stylesheet: allowed by panels whose security rules forbid inline styles.)
  if (inside) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`nova-portal-badge, nova-manual { display: none !important; }
${MOTION}`);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (err) {}
  }
  // Calendar has no page of its own: opened on its own, it opens inside Nova Agent instead
  else location.replace("/agent/?open=" + encodeURIComponent(location.pathname + location.search) + location.hash);
})();
