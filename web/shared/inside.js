// Every panel loads this in its <head>, before the page is drawn. Inside Nova Agent (its viewer):
// <html class="embed">, so the panel fits the space it's given (a slimmer header, scrolling
// inside). Opened on its own: off to Nova Agent, with this panel open. Add ?embed=1 to the
// address to see a panel on its own anyway (for working on it). Calendar has its own copy.
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
  // Panels have no pages of their own: opened on its own, a panel opens inside Nova Agent instead
  // (Nova Agent's server does this already; this catches browsers that don't say how a page was opened)
  else location.replace("/?open=" + encodeURIComponent(location.pathname + location.search) + location.hash);
})();
