// Your planet in the status bar (20 Oct 2026, the user: "make the planet like a circular button … at
// the very central bottom of the status bar … get rid of the title of the app … put the user name in
// the bottom status bar"): a round planet button in the middle of the status bar (status.js), on every
// screen of the Nova suite, with your name beside it. It replaced the top panel's medallion (your
// planet with your name and the place's name curved round it), which replaced the old title.
//   The planet alone, no rings round it, its surface turning slowly with a drifting glow (20 Oct 2026).
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
  document.documentElement.classList.add("nv-medal-on");
  // Your name on the top panel too (20 Oct 2026, the user: "the username … on the top panel only on
  // desktop and laptop screen sizes"): on a computer it's there, beside the panel's title, and not in the
  // status bar; on a phone it stays in the status bar, beside the planet (medallion.css shows one)
  const topMe = document.createElement("button");
  topMe.type = "button";
  topMe.className = "nv-top-me";
  topMe.innerHTML = '<span class="nv-top-me-star" aria-hidden="true">✦</span><span class="nv-top-me-name"></span>';
  const rightSide = bar.querySelector(".top-side.right");
  if (rightSide) rightSide.prepend(topMe);

  const img = me.querySelector("img");
  const planetBtn = me.querySelector(".sl-planet");
  const nameBtn = me.querySelector(".sl-me-name");
  const STILL = matchMedia("(prefers-reduced-motion: reduce)");

  function who() {
    const d = badge && badge.data;
    const s = d && d.staff;
    const pic = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".orb img");
    return {
      name: s ? String(s.display_name || "").trim().split(/\s+/)[0] || "You" : d && d.loading ? "" : "Sign in",
      // (the planet alone, no glow ring round it, its surface turning slowly unless less motion is asked for)
      src: pic ? pic.getAttribute("src").replace(/size=\d+/, "size=96").replace(/&(animate|halo|spin)=\d/g, "") + "&halo=0" + (STILL.matches ? "" : "&spin=1") : "",
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
    topMe.querySelector(".nv-top-me-name").textContent = w.name;
    topMe.classList.toggle("signed-out", !w.signedIn);
    topMe.hidden = !w.name;
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
    topMe.setAttribute("aria-label", label);
    topMe.title = planetBtn.title;
  }
  const open = () => {
    const chip = badge && badge.shadowRoot && badge.shadowRoot.querySelector(".chip");
    if (chip) chip.click();
  };
  planetBtn.addEventListener("click", open);
  nameBtn.addEventListener("click", open);
  topMe.addEventListener("click", open);

  // Each side fits its half: the least needed parts step aside first (on the left the version, when you
  // came on, when you left, then what's new; on the right the date), never cut off at an edge
  const ORDER = [[left, [".sl-ver", ".sl-sess", ".sl-left", ".sl-news", ".sl-act"]], [right, [".sl-date", ".sl-time"]]];
  const shown = (el) => getComputedStyle(el).display !== "none";
  const need = (side) => [...side.children].filter(shown).reduce((w, el) => w + el.getBoundingClientRect().width, 0);
  function tuck() {
    for (const [side, order] of ORDER) {
      for (const el of side.querySelectorAll(".sl-tucked")) el.classList.remove("sl-tucked");
      for (const sel of order) {
        if (need(side) <= side.clientWidth + 1) break;
        const el = side.querySelector(sel);
        if (el && shown(el)) el.classList.add("sl-tucked");
      }
    }
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(tuck).observe(line);
  setInterval(tuck, 2000);
  tuck();

  draw();
  setInterval(draw, 1000);
  window.NovaMedal = { redraw: () => ((last = ""), draw()) };
})();
