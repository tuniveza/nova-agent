// Your planet in the status bar (20 Oct 2026, the user: "make the planet like a circular button … at
// the very central bottom of the status bar … get rid of the title of the app … put the user name in
// the bottom status bar"): a round planet button in the middle of the status bar (status.js), on every
// screen of the Nova suite, with your name beside it. It replaced the top panel's medallion (your
// planet with your name and the place's name curved round it), which replaced the old title.
//   The planet alone, no rings round it, with a soft glow (20 Oct 2026; held still: turning, it slowed phones).
//   Tapping the planet (or your name) opens your Portal card: the planet badge's own card, the badge
//   itself moved here unseen, right under the planet, so its card opens from it. Signed out, the planet
//   is a door to Portal, as the badge's is.
(() => {
  "use strict";
  const bar = document.querySelector(".shell > .topbar");
  const line = document.getElementById("status-line");
  if (!bar || !line || line.querySelector(".sl-me")) return;
  const badge = bar.querySelector("nova-portal-badge");

  const me = document.createElement("span");
  me.className = "sl-item sl-me";
  me.innerHTML = `<button type="button" class="sl-planet"><img alt="" width="26" height="26" hidden><span class="sl-planet-ghost" aria-hidden="true"></span></button><button type="button" class="sl-me-name"></button>`;
  // (in the middle of the line: after what you've been doing, before the date)
  const date = line.querySelector(".sl-date");
  line.insertBefore(me, date || null);
  // (dead centre: what's before it on the left, what's after it on the right, two equal sides; the
  // line's own fitting still hides the least needed parts when they don't all fit)
  const left = document.createElement("span");
  left.className = "sl-side sl-side-l";
  const right = document.createElement("span");
  right.className = "sl-side sl-side-r";
  let before = true;
  for (const kid of [...line.children]) {
    if (kid === me) before = false;
    else (before ? left : right).append(kid);
  }
  line.append(left, me, right);
  // The badge, unseen, right under the planet: its card opens from here
  if (badge) me.append(badge);
  // (unseen, so it holds still: its turning ring, orbiting spark and breathing glow kept the phone
  // drawing frames nobody could see)
  if (badge) badge.setAttribute("calm", "");
  document.documentElement.classList.add("nv-medal-on");
  // (the Manual's button on the top panel without its glow, like the panel's other buttons: the panel
  // keeps one even colour, 20 Oct 2026)
  for (const m of bar.querySelectorAll("nova-manual")) m.setAttribute("flat", "");
  // On a computer (20 Oct 2026, latest, the user: "put the planet in the center of that tab panel put the
  // username in the status bar … get rid of the handle on the top panel"): your name stays here in the
  // status bar with no planet (medallion.css); your planet is in the middle of Portal's Nova Tabs
  // (portal/pillars.js), which hang from the top panel while Portal is open
  const COMPUTER = matchMedia("(min-width: 761px) and (min-height: 481px), (min-width: 761px) and (pointer: fine)");
  const frame = document.getElementById("viewer-frame");
  const portalOpen = () => {
    let on = false;
    try { on = !!frame && !document.getElementById("viewer").hidden && /^\/(agent\/apps\/)?portal(\/|$)/.test(new URL(frame.src, location.href).pathname); } catch (err) {}
    document.documentElement.classList.toggle("nv-portal-open", on);
  };
  if (frame) new MutationObserver(portalOpen).observe(frame, { attributes: true, attributeFilter: ["src"] });
  const viewerEl = document.getElementById("viewer");
  if (viewerEl) new MutationObserver(portalOpen).observe(viewerEl, { attributes: true, attributeFilter: ["hidden"] });
  portalOpen();

  // The Manual as a floating medallion in the bottom-left corner on a laptop or desktop (20 Oct 2026, the
  // user: "move the manual button and put it in the bottom left corner like a floating medalion"); in the
  // top panel as before on a phone. It sits just above the Nova dock whenever the dock reaches that corner.
  const manual = bar.querySelector(".top-side.right > nova-manual");
  if (manual) {
    const home = manual.parentElement;
    const dock = document.getElementById("suite-home");
    const lift = () => {
      let bottom = 18;
      if (dock && manual.hasAttribute("floating")) {
        const r = dock.getBoundingClientRect();
        const there = r.height > 0 && r.top < innerHeight - 4 && getComputedStyle(dock).visibility !== "hidden";
        // (only when the dock would touch it: beside the dock it stays down in the corner)
        if (there && r.left < 16 + 58 + 2) bottom = Math.max(18, Math.round(innerHeight - r.top + 12));
      }
      manual.style.setProperty("--nm-bottom", `${bottom}px`);
    };
    // (Nova Agent's computer layout, with the dock along the bottom: narrower or shorter windows use the
    // phone layout, and there the Manual stays in the top panel)
    const WIDE = window.NovaForm ? window.NovaForm.room("computer") : matchMedia("(min-width: 981px) and (min-height: 481px)");
    const float = () => {
      const on = WIDE.matches;
      if (on && manual.parentElement !== document.body) document.body.append(manual);
      else if (!on && manual.parentElement !== home) home.prepend(manual);
      manual.toggleAttribute("floating", on);
      manual.toggleAttribute("medal", on);
      manual.toggleAttribute("flat", !on);
      lift();
    };
    WIDE.addEventListener("change", float);
    window.addEventListener("resize", lift);
    if (dock) {
      if (typeof ResizeObserver === "function") new ResizeObserver(lift).observe(dock);
      dock.addEventListener("transitionend", lift);
    }
    // (the dock going away and coming back: the page's classes change)
    new MutationObserver(() => setTimeout(lift, 280)).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setInterval(lift, 1500);
    float();
  }

  const img = me.querySelector("img");
  const planetBtn = me.querySelector(".sl-planet");
  const nameBtn = me.querySelector(".sl-me-name");

  function who() {
    const d = badge && badge.data;
    const s = d && d.staff;
    const pic = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".orb img");
    return {
      name: s ? String(s.display_name || "").trim().split(/\s+/)[0] || "You" : d && d.loading ? "" : "Sign in",
      // (the planet alone, no glow ring round it)
      // (still: its turning surface redrew the status bar every frame and slowed phones down, 20 Oct 2026)
      src: pic ? pic.getAttribute("src").replace(/size=\d+/, "size=96").replace(/&(animate|halo|spin)=\d/g, "") + "&halo=0" : "",
      glow: s && s.planet && s.planet.glow,
      signedIn: Boolean(s),
    };
  }
  let last = "";
  function draw() {
    const w = who();
    const sig = [w.name, w.src, w.glow].join("|");
    if (sig === last) return;
    last = sig;
    nameBtn.textContent = w.name;
    if (w.src) {
      img.src = w.src;
      img.hidden = false;
    } else img.hidden = true;
    me.classList.toggle("signed-out", !w.signedIn);
    if (w.glow) me.style.setProperty("--planet-glow", w.glow);
    const label = w.signedIn ? `${w.name}: your Portal card` : "Sign in with Portal";
    planetBtn.setAttribute("aria-label", label);
    planetBtn.title = w.signedIn ? `${w.name} · Portal` : "Sign in with Portal";
    nameBtn.setAttribute("aria-label", label);
  }
  const open = () => {
    const chip = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".chip");
    if (chip) chip.click();
  };
  planetBtn.addEventListener("click", open);
  nameBtn.addEventListener("click", open);

  // Each side fits its half: the least needed parts step aside first (on the left the version, when you
  // came on, when you left, then what's new; on the right the date), never cut off at an edge
  // (22 Oct 2026, the user: "I don't want it cut at any size of the screen at any point": a part counts as
  // not fitting when it reaches past its half's edge, either edge (the left half is packed to the right, so
  // what doesn't fit there runs off its left), or when its own words are cut inside it: What's new, what
  // you've been doing; adding up widths missed both. The mode light steps aside after the date.)
  const ORDER = [[left, [".sl-ver", ".sl-sess", ".sl-left", ".sl-news", ".sl-act"]], [right, [".sl-date", ".sl-mode", ".sl-time"]]];
  const shown = (el) => getComputedStyle(el).display !== "none";
  const WORDS = ".sl-track, .sl-words, .sl-act-text, .sl-area, time, .label";
  const cut = (side) => {
    const r = side.getBoundingClientRect();
    return [...side.children].some((el) => {
      if (!shown(el)) return false;
      const b = el.getBoundingClientRect();
      if (b.left < r.left - 0.5 || b.right > r.right + 0.5) return true;
      return [el, ...el.querySelectorAll(WORDS)].some((k) => k.offsetParent && k.scrollWidth > k.clientWidth + 1);
    });
  };
  function tuck() {
    for (const [side, order] of ORDER) {
      for (const el of side.querySelectorAll(".sl-tucked")) el.classList.remove("sl-tucked");
      for (const sel of order) {
        if (!cut(side)) break;
        const el = side.querySelector(sel);
        if (el && shown(el)) el.classList.add("sl-tucked");
      }
    }
  }
  const place = () => { document.documentElement.classList.toggle("nv-name-only", COMPUTER.matches); tuck(); };
  COMPUTER.addEventListener("change", place);
  place();
  if (typeof ResizeObserver === "function") new ResizeObserver(tuck).observe(line);
  setInterval(tuck, 2000);
  tuck();

  draw();
  setInterval(draw, 1000);
  window.NovaMedal = { redraw: () => ((last = ""), draw()) };
})();
