// Which Nova app this device opens (23 Oct 2026, the user: a separate web app for each platform). A phone, or a
// tablet held upright, opens Nova on a phone (/phone/); a computer, or a tablet on its side, Nova Agent (/agent/).
// Loaded first thing on Nova Agent's page, so a phone moves on before anything is drawn.
//   ?app=computer   asked for on purpose (the phone app's "computer version" links): stays, for this visit
//   localStorage "nova-app": "computer" | "phone" chooses for good on this device ("Always…" in the phone app)
// Since 23 Oct 2026 Nova Phone has every place of Nova Desk, so every address goes there (the user: phones
// opening Nova Desk go to Nova Phone; invite links land on its invite screen). Loaded on Nova Desk's page and
// Portal's.
(() => {
  "use strict";
  try {
    if (window.top !== window) return; // (inside a frame: Nova Agent's own panels, the phones page's pictures)
    const q = new URLSearchParams(location.search);
    if (q.get("app") === "computer") { sessionStorage.setItem("nova-app", "computer"); return; }
    const chosen = localStorage.getItem("nova-app");
    if (chosen === "computer" || (sessionStorage.getItem("nova-app") === "computer" && chosen !== "phone")) return;
    // The device, as look.js decides it (shared/look.js)
    const ua = navigator.userAgent || "";
    const coarse = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const uaMobile = navigator.userAgentData ? navigator.userAgentData.mobile : /Mobi|iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua);
    const tabletUA = iPad || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || /Tablet|Silk|Kindle|PlayBook/i.test(ua);
    const short = Math.min(screen.width, screen.height);
    const kind = uaMobile && !tabletUA ? "phone" : tabletUA || (coarse && short >= 600) ? "tablet" : coarse ? "phone" : "desktop";
    const upright = screen.height >= screen.width;
    if (chosen !== "phone" && !(kind === "phone" || (kind === "tablet" && upright))) return;
    // Where it was going: Nova Desk's ?open=<address>, or this very page (Portal opened straight, an invite link
    // /portal/?invite=…); Nova Phone turns any Nova address into its own place (notices.js place())
    const here = /^\/agent\/?$/.test(location.pathname) ? q.get("open") || "" : location.pathname + location.search;
    location.replace(here ? `/phone/?open=${encodeURIComponent(here)}` : "/phone/");
  } catch (e) {
    /* (no storage, an old browser: Nova Agent, as before) */
  }
})();
