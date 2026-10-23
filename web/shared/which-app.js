// Which Nova app this device opens (23 Oct 2026, the user: a separate web app for each platform). A phone, or a
// tablet held upright, opens Nova on a phone (/phone/); a computer, or a tablet on its side, Nova Agent (/agent/).
// Loaded first thing on Nova Agent's page, so a phone moves on before anything is drawn.
//   ?app=computer   asked for on purpose (the phone app's "computer version" links): stays, for this visit
//   localStorage "nova-app": "computer" | "phone" chooses for good on this device ("Always…" in the phone app)
// A place with no phone section yet (?open=/board/) stays in Nova Agent; one with a section opens it there.
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
    // Where it was going: the phone app's section for that place, if it has one
    const open = q.get("open") || "";
    const SECTIONS = [
      [/^\/calendar\//, "calendar"], [/^\/notes\//, "notes"], [/^\/invoicer\/.*[?&]invoice=(\d+)/, "money/invoice/$1"], [/^\/invoicer\//, "money"],
      [/^\/portal\/.*[?&]view=inbox/, "inbox"], [/^\/portal\/?(\?|$)/, "today"], [/^\/agent\/?$/, "agent"],
    ];
    let to = "";
    if (open) {
      const hit = SECTIONS.find(([re]) => re.test(open));
      if (!hit) return; // (no phone section for it yet: Nova Agent opens it)
      to = hit[1].replace("$1", open.match(hit[0])[1] || "");
    }
    location.replace(`/phone/${to ? `#${to}` : ""}`);
  } catch (e) {
    /* (no storage, an old browser: Nova Agent, as before) */
  }
})();
