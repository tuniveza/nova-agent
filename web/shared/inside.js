// Every panel loads this in its <head>, before the page is drawn. Inside Nova Agent (its viewer):
// <html class="embed">, so the panel fits the space it's given (a slimmer header, scrolling
// inside). Opened on its own: off to Nova Agent, with this panel open. Add ?embed=1 to the
// address to see a panel on its own anyway (for working on it). Calendar has its own copy.
(() => {
  "use strict";
  // Settings saved under Portal's old names move to their new ones, once (so nothing resets)
  try {
    const OLD = ["no", "va", "h", "ub-"].join("");
    for (const k of ["theme", "options", "seen-alert", "handsfree", "music"]) {
      const was = localStorage.getItem(OLD + k);
      if (was === null) continue;
      const name = k === "music" ? "nova-music" : "nova-" + k;
      if (localStorage.getItem(name) === null) localStorage.setItem(name, k === "music" ? (was === "1" ? "on" : "off") : was);
      localStorage.removeItem(OLD + k);
    }
  } catch (err) {}
  // Motion for every panel inside Nova Agent (cheap: only scale moves, never layout): buttons, tabs
  // and chips press in softly. A panel shows at once when it opens (no fade in: nothing to wait for).
  // Off when the device asks for less motion or Portal's Options → Animations is off.
  // (Zero-specificity rules, so a panel's own transitions always win.)
  const MOTION = `@media (prefers-reduced-motion: no-preference) {
    :where(html:not([data-motion="calm"])) :where(button, [role="button"], [role="tab"], .btn, .chip, .tab) { transition: scale .16s cubic-bezier(.2,.8,.2,1); }
    :where(html:not([data-motion="calm"])) :where(button, [role="button"], [role="tab"], .btn, .chip, .tab):not(:disabled):active { scale: .96; }
  }`;

  // The same glow as Nova Agent's (glow.css), on the things every panel has: buttons, tabs and boxes
  // light up softly when you're on them. Zero-specificity rules, so a panel's own look always wins.
  const GLOW = `:where(button, [role="button"], [role="tab"], .btn, .chip, a):focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--hi, var(--accent, #c9b6ff)) 70%, transparent), 0 0 18px -4px var(--hi, var(--accent, #c9b6ff)); }
  :where(.btn, .chip, [role="tab"], .tab, .icon-btn):hover { box-shadow: 0 0 0 1px color-mix(in srgb, var(--hi, var(--accent, #c9b6ff)) 22%, transparent), 0 10px 30px -18px var(--hi, var(--accent, #c9b6ff)); }
  :where(.tab.active, [role="tab"][aria-selected="true"], .chip.active) { box-shadow: 0 0 16px -6px var(--hi, var(--accent, #c9b6ff)); }
  :where(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select):focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--hi, var(--accent, #c9b6ff)) 18%, transparent), 0 0 24px -8px var(--hi, var(--accent, #c9b6ff)); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { border-radius: 10px; border: 3px solid transparent; background: linear-gradient(180deg, var(--hi, var(--accent, #c9b6ff)), var(--accent-2, var(--accent, #7a5cff))) padding-box; }
::-webkit-scrollbar-thumb:hover, ::-webkit-scrollbar-thumb:active { border-width: 2px; }
::-webkit-scrollbar-corner { background: transparent; }
html:root { --nebula: radial-gradient(60% 40% at 8% 0%, rgba(var(--accent-rgb, 176, 29, 104), .14), transparent 72%), radial-gradient(50% 45% at 100% 22%, rgba(var(--accent-2-rgb, 122, 31, 134), .1), transparent 72%), radial-gradient(80% 50% at 50% 110%, rgba(var(--accent-3-rgb, 37, 25, 77), .5), transparent 72%); }`;
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
    display: flex; flex-wrap: nowrap; justify-content: flex-start; gap: 6px; padding: 6px 10px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity;
    border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none;
    background: rgba(var(--deep-rgb), 0.97); backdrop-filter: none; -webkit-backdrop-filter: none;
  }
  html.embed .embed-head > .tabs::-webkit-scrollbar { display: none; }
  /* Every section on the row (no More): on a phone the row slides sideways inside itself */
  html.embed .embed-head > .tabs > .tab { flex: 0 0 auto; min-width: 64px; padding: 4px 6px 2px; } /* (room for a count on the icon's corner) */
  html.embed .embed-head > .tabs > .tab.tab-more { display: flex; }
  html.embed .embed-head > .tabs > #tab-more { display: none; }
}
/* Tablet widths: every tab stays on screen, wrapping onto a second centred row (phones keep the sliding row) */
@media (min-width: 761px) and (max-width: 980px) {
  html.embed .embed-head > .tabs { flex-wrap: wrap; justify-content: center; row-gap: 10px; column-gap: 8px; padding: 10px 14px; overflow: visible; scroll-snap-type: none; }
  html.embed .embed-head > .tabs > .tab {
    flex: 0 0 auto; flex-direction: row; gap: 6px; min-height: 36px; padding: 0 12px; overflow: visible;
    border-radius: 999px; border: 1px solid var(--line); scroll-snap-align: start;
  }
  html.embed .embed-head > .tabs > .tab svg, html.embed .embed-head > .tabs > .tab img { width: 18px; height: 18px; }
  html.embed .embed-head > .tabs > .tab > span:not(.badge) { font-size: 12.5px; }
  html.embed .embed-head > .tabs > .tab.active { border-color: var(--hi); background: radial-gradient(120% 140% at 50% 0%, rgba(var(--hi-rgb), 0.26), rgba(var(--accent-2-rgb), 0.1) 65%, transparent 100%); } /* the same soft pill as Portal's tab bar on a computer */
  html.embed .embed-head > .tabs > .tab.active::after { display: none; }
  html.embed .embed-head > .tabs .badge { position: static; margin-left: -2px; }
}
/* A phone on its side (short and wide): one row of sections that slides sideways inside itself
   (two rows would leave the section no room), and the header slimmer */
@media (max-height: 500px) and (orientation: landscape) and (max-width: 980px) {
  html.embed .embed-head > .tabs { flex-wrap: nowrap; justify-content: flex-start; row-gap: 0; padding: 4px 10px; overflow-x: auto; scroll-snap-type: x proximity; }
  html.embed .embed-head > .tabs > .tab { min-height: 40px; }
  html.embed .embed-head { position: relative; } /* (it scrolls away with the panel, rather than staying stuck over a short screen) */
  html.embed .embed-head > .top { padding-top: 2px; padding-bottom: 2px; min-height: 0; }
  html.embed .embed-head > .top :is(.brand, #brand) svg { width: 30px; height: 30px; }
  html.embed .embed-head > .top .icon-btn { width: 40px; height: 40px; }
}
${MOTION}
${GLOW}`);
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
  // …except Portal as its own phone app: opened from its home-screen icon, or from the install
  // link (/portal/?app=1), it stays Portal, full screen (the Portal phone app)
  // …and Console opened on the studio computer itself (/console/?here=1), for its terminals: those
  // only open at localhost, never through Nova Agent online
  else if (!portalApp() && !consoleHere()) location.replace("/agent/?open=" + encodeURIComponent(location.pathname + location.search) + location.hash);
  function consoleHere() {
    return location.pathname.startsWith("/console/") && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).get("here") === "1";
  }
  function portalApp() {
    if (!location.pathname.startsWith("/portal/")) return false;
    const fromHomeScreen = window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (fromHomeScreen || /[?&]app=1\b/.test(location.search)) {
      document.documentElement.classList.add("portal-app");
      // Tell the notification helper which app this phone opens (sw.js)
      if (fromHomeScreen && window.caches) caches.open("nova-home").then((c) => c.put("/home", new Response("portal"))).catch(() => {});
      return true;
    }
    return false;
  }
})();
