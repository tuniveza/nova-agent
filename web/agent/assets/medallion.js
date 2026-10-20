// The title panel's medallion (20 Oct 2026, the user: "the planet in the centre with the title of the
// nova app, helper and or otherwise curved around the bottom half and the username curved around the
// top half"): in the middle of the top panel on every screen of the Nova suite (Nova Agent's home and
// every panel open in it), your planet, your name round its top and the open place's name ("Nova
// Agent" on the home) round its bottom. It takes the old title's place.
//   Tapping the planet (or your name) opens your Portal card (the planet badge's own card, which stays
//   in the page unseen, right under the medallion); tapping the place's name switches panel, as tapping
//   the old title did. Signed out, the planet is a door to Portal, as the badge's is.
(() => {
  "use strict";
  const bar = document.querySelector(".shell > .topbar");
  if (!bar || bar.querySelector(".nv-medal")) return;
  const $ = (id) => document.getElementById(id);
  const badge = bar.querySelector("nova-portal-badge");
  const SVG = "http://www.w3.org/2000/svg";

  const medal = document.createElement("div");
  medal.className = "nv-medal";
  medal.innerHTML = `
    <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <defs>
        <path id="nvm-top" d="M 15 60 A 45 45 0 0 1 105 60"/>
        <path id="nvm-bottom" d="M 15 60 A 45 45 0 0 0 105 60"/>
        <clipPath id="nvm-clip"><circle cx="60" cy="60" r="29"/></clipPath>
        <linearGradient id="nvm-name-ink" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="nvm-ink-a"/><stop offset=".5" class="nvm-ink-b"/><stop offset="1" class="nvm-ink-c"/></linearGradient>
        <radialGradient id="nvm-halo" cx=".5" cy=".5" r=".5"><stop offset=".55" class="nvm-halo-a"/><stop offset="1" class="nvm-halo-b"/></radialGradient>
      </defs>
      <circle class="nvm-halo" cx="60" cy="60" r="44"/>
      <circle class="nvm-ring" cx="60" cy="60" r="45"/>
      <circle class="nvm-ring-edge" cx="60" cy="60" r="38"/>
      <circle class="nvm-ring-edge" cx="60" cy="60" r="52"/>
      <circle class="nvm-orbit" cx="60" cy="60" r="34"/>
      <circle class="nvm-back" cx="60" cy="60" r="29"/>
      <image class="nvm-planet" x="31" y="31" width="58" height="58" clip-path="url(#nvm-clip)" preserveAspectRatio="xMidYMid slice"/>
      <circle class="nvm-rim" cx="60" cy="60" r="29"/>
      <text class="nvm-name"><textPath href="#nvm-top" startOffset="50%" text-anchor="middle"></textPath></text>
      <text class="nvm-title"><textPath href="#nvm-bottom" startOffset="50%" text-anchor="middle"></textPath></text>
    </svg>
    <button type="button" class="nvm-hit nvm-hit-planet"></button>
    <button type="button" class="nvm-hit nvm-hit-title"></button>`;
  bar.append(medal);
  document.documentElement.classList.add("nv-medal-on");

  const nameText = medal.querySelector(".nvm-name textPath");
  const titleText = medal.querySelector(".nvm-title textPath");
  const planet = medal.querySelector(".nvm-planet");
  const planetBtn = medal.querySelector(".nvm-hit-planet");
  const titleBtn = medal.querySelector(".nvm-hit-title");

  // Who: from the planet badge (it knows who's signed in, and draws their planet)
  function who() {
    const d = badge && badge.data;
    const s = d && d.staff;
    const img = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".orb img");
    return {
      name: s ? String(s.display_name || "").trim().split(/\s+/)[0] || "You" : d && d.loading ? "" : "Sign in",
      src: img ? img.getAttribute("src").replace(/size=\d+/, "size=160") : "",
      glow: s && s.planet && s.planet.glow,
      signedIn: Boolean(s),
    };
  }
  // Where: the open panel's name, or Nova Agent on the home
  const viewing = () => Boolean($("main") && $("main").classList.contains("viewing"));
  function where() {
    if (!viewing()) return "Nova Agent";
    const t = $("viewer-name");
    return (t && (t.querySelector(".vn-text") || t).textContent.trim()) || "Nova Agent";
  }
  // Long words get a little smaller so they always fit their half of the circle
  const fit = (node, text, base) => {
    node.textContent = text;
    const el = node.parentNode;
    el.style.fontSize = `${Math.max(8, Math.min(base, (base * 15) / Math.max(15, text.length)))}px`;
  };
  let last = "";
  function draw() {
    const w = who();
    const here = where();
    const sig = [w.name, w.src, w.glow, here].join("|");
    if (sig === last) return;
    last = sig;
    fit(nameText, w.name.toUpperCase(), 12.5);
    fit(titleText, here.toUpperCase(), 12);
    if (w.src) planet.setAttribute("href", w.src);
    else planet.removeAttribute("href");
    medal.classList.toggle("signed-out", !w.signedIn);
    if (w.glow) medal.style.setProperty("--planet-glow", w.glow);
    planetBtn.setAttribute("aria-label", w.signedIn ? `${w.name}: your Portal card` : "Sign in with Portal");
    planetBtn.title = w.signedIn ? `${w.name} · Portal` : "Sign in with Portal";
    titleBtn.setAttribute("aria-label", viewing() ? `${here} (switch panel)` : "Nova Agent");
    titleBtn.title = viewing() ? "Switch panel" : "Nova Agent";
  }
  // The planet: the badge's own card (or its sign-in), opened from right under the medallion
  planetBtn.addEventListener("click", () => {
    const chip = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".chip");
    if (chip) chip.click();
  });
  // The place's name: switch panel, as the old title did (on the home: back to the top of Agent)
  titleBtn.addEventListener("click", () => {
    if (viewing() && $("viewer-name")) $("viewer-name").click();
    else if ($("main")) $("main").scrollTo({ top: 0, behavior: "smooth" });
  });

  draw();
  setInterval(draw, 1000);
  if ($("main")) new MutationObserver(draw).observe($("main"), { attributes: true, attributeFilter: ["class"] });
  if ($("viewer-name")) new MutationObserver(draw).observe($("viewer-name"), { childList: true, subtree: true, characterData: true });
  window.NovaMedal = { redraw: () => ((last = ""), draw()) };
})();
