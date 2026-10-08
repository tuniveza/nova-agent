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
  // On a phone, Nova Agent's own bar runs along the bottom of every panel: a panel's sections (Portal,
  // Index) come up to a row under its header instead, so there's never a second bar at the bottom.
  if (inside) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`nova-portal-badge, nova-manual { display: none !important; }
html.embed .embed-head { position: sticky; top: 0; z-index: 8; }
html.embed .embed-head > .top { position: relative; top: auto; }
@media (max-width: 980px) {
  html.embed { --tabs-h: 0px !important; --tabs-gap: 0px !important; }
  html.embed .embed-head > .tabs {
    position: static; inset: auto; transform: none; width: auto; max-width: none; height: auto; margin: 0;
    display: flex; flex-wrap: nowrap; gap: 6px; padding: 6px 10px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity;
    border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none;
    background: rgba(var(--deep-rgb), 0.97); backdrop-filter: none; -webkit-backdrop-filter: none;
  }
  html.embed .embed-head > .tabs::-webkit-scrollbar { display: none; }
  html.embed .embed-head > .tabs > .tab {
    flex: 0 0 auto; flex-direction: row; gap: 6px; min-height: 36px; padding: 0 12px; overflow: visible;
    border-radius: 999px; border: 1px solid var(--line); scroll-snap-align: start;
  }
  html.embed .embed-head > .tabs > .tab.tab-more { display: flex; }
  html.embed .embed-head > .tabs > #tab-more { display: none; }
  html.embed .embed-head > .tabs > .tab svg, html.embed .embed-head > .tabs > .tab img { width: 18px; height: 18px; }
  html.embed .embed-head > .tabs > .tab > span:not(.badge) { font-size: 12.5px; }
  html.embed .embed-head > .tabs > .tab.active { border-color: var(--hi); }
  html.embed .embed-head > .tabs > .tab.active::after { display: none; }
  html.embed .embed-head > .tabs .badge { position: static; margin-left: -2px; }
}`);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (err) {}
    const lift = () => {
      const top = document.querySelector("body > header.top, header.top");
      const tabs = document.querySelector("nav.tabs");
      if (!top || !tabs || top.parentElement.classList.contains("embed-head")) return;
      const head = document.createElement("div");
      head.className = "embed-head";
      top.before(head);
      head.append(top, tabs);
      // The chosen section stays in view along the row
      const follow = () => {
        const on = tabs.querySelector(".tab.active");
        if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({ left: on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: "smooth" });
      };
      new MutationObserver(follow).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class"] });
      follow();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lift);
    else lift();
  }
  // Panels have no pages of their own: opened on its own, a panel opens inside Nova Agent instead
  // (Nova Agent's server does this already; this catches browsers that don't say how a page was opened)
  else location.replace("/agent/?open=" + encodeURIComponent(location.pathname + location.search) + location.hash);
})();
