// Shown inside another app (Nova Agent's viewer or its Calendar tab): fit the calendar to
// the space it's given, so nothing needs scrolling. Loaded in the <head>, before the page
// is drawn. Opened on its own, it goes to Nova Agent with Calendar open. Add ?embed=1 to the
// address to see it on its own anyway (for working on it).
(() => {
  "use strict";
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
      sheet.replaceSync("nova-portal-badge, nova-manual { display: none !important; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (err) {}
  }
  // Calendar has no page of its own: opened on its own, it opens inside Nova Agent instead
  else location.replace("/agent/?open=" + encodeURIComponent(location.pathname + location.search) + location.hash);
})();
