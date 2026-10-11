// One look for all of Nova Agent: a theme chosen once (in the Panels window) colours every app,
// task, tool and helper, whatever their own theme is, and "Colour from my planet" can tint it all
// with the colours of the planet you have in Portal, and all text is centred (unless switched off). Loaded early in every panel's <head> and in
// Nova Agent's page. Saved on the device ("nova-look"); every open panel follows straight away.
// When no theme is chosen, each panel keeps its own (as before).
// The spectrum's extra themes and the Custom theme (made from one hue) come from spectrum.js,
// loaded just before this; without it there are just the seven below.
//   window.NovaLook = { themes, get(), setTheme(id | null), setPlanet(on), setCenter(on), refreshPlanet() }
// What kind of device this is, from the device itself (not just the window's size), on <html> for
// every page and panel: is-touch (a touch screen as the main pointer), is-phone, is-tablet
// (iPads included, which say they're Macs), and data-device="phone|tablet|desktop".
(() => {
  try {
    const root = document.documentElement;
    const ua = navigator.userAgent || "";
    const coarse = matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches;
    const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const uaMobile = navigator.userAgentData ? navigator.userAgentData.mobile : /Mobi|iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua);
    const tabletUA = iPad || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || /Tablet|Silk|Kindle|PlayBook/i.test(ua);
    const short = Math.min(screen.width, screen.height);
    const kind = uaMobile && !tabletUA ? "phone" : tabletUA || (coarse && short >= 600) ? "tablet" : coarse ? "phone" : "desktop";
    root.dataset.device = kind;
    root.classList.toggle("is-phone", kind === "phone");
    root.classList.toggle("is-tablet", kind === "tablet");
    root.classList.toggle("is-touch", kind !== "desktop" || coarse);
  } catch (err) {}
})();
(() => {
  "use strict";
  if (window.NovaLook) return;
  const KEY = "nova-look";
  const PLANET = "nova-look-planet"; // the planet's colours, worked out once by Nova Agent's page
  const THEMES = [
    {"id": "novacane", "name": "Novacane", "tag": "Magenta nebula", "void": "#06040D", "deep": "#100816", "panel": "#1C1129", "panel2": "#241640", "text": "#EBD3E7", "muted": "#B997B5", "accent": "#B01D68", "accent2": "#7A1F86", "accent3": "#25194D", "hi": "#FF5FA8", "soft": "#FFD1EA", "gold": "#F2D9A0", "lilac": "#C7A4FF", "onAccent": "#FFFFFF"},
    {"id": "solar", "name": "Solar Flare", "tag": "Red-orange", "void": "#0B0403", "deep": "#160805", "panel": "#24100A", "panel2": "#2F150C", "text": "#F7DDCF", "muted": "#C99C88", "accent": "#D9361E", "accent2": "#F2701D", "accent3": "#4A1408", "hi": "#FF9548", "soft": "#FFD8BE", "gold": "#FFD27A", "lilac": "#FFB38A", "onAccent": "#1A0603"},
    {"id": "pulsar", "name": "Pulsar", "tag": "Cyan", "void": "#020810", "deep": "#06111C", "panel": "#0B1C2A", "panel2": "#0F2537", "text": "#D4EEF6", "muted": "#8AB3C2", "accent": "#0A7EA4", "accent2": "#2563EB", "accent3": "#0A2342", "hi": "#3DEBFF", "soft": "#C9F6FF", "gold": "#F4F1C9", "lilac": "#8FD3FF", "onAccent": "#FFFFFF"},
    {"id": "aurora", "name": "Aurora", "tag": "Green & violet", "void": "#03090A", "deep": "#071312", "panel": "#0D1E1C", "panel2": "#122826", "text": "#D6F5EC", "muted": "#8FBAAE", "accent": "#0B8A6B", "accent2": "#6D45E8", "accent3": "#0E2A33", "hi": "#5CFFC0", "soft": "#D3FFEE", "gold": "#F3E9A1", "lilac": "#A99BFF", "onAccent": "#FFFFFF"},
    {"id": "eclipse", "name": "Eclipse", "tag": "Gold corona", "void": "#050404", "deep": "#0D0B09", "panel": "#17140F", "panel2": "#201B14", "text": "#F1E6D2", "muted": "#B5A589", "accent": "#D9A441", "accent2": "#B07A2A", "accent3": "#221A10", "hi": "#FFCF6E", "soft": "#FFEFD0", "gold": "#FFE3A3", "lilac": "#FFE3A3", "onAccent": "#140F06"},
    {"id": "quasar", "name": "Quasar", "tag": "Ultraviolet", "void": "#05030F", "deep": "#0B0719", "panel": "#151030", "panel2": "#1C1640", "text": "#E2DDFB", "muted": "#A49CCB", "accent": "#5B3DF5", "accent2": "#B23AEE", "accent3": "#141047", "hi": "#A98BFF", "soft": "#E4DAFF", "gold": "#FFE1F4", "lilac": "#C7B8FF", "onAccent": "#FFFFFF"},
    {"id": "mono", "name": "Mono", "tag": "Silver & ink", "void": "#060607", "deep": "#0E0E11", "panel": "#18181C", "panel2": "#222228", "text": "#E6E6EA", "muted": "#9C9CA6", "accent": "#6A6A74", "accent2": "#4A4A52", "accent3": "#1A1A20", "hi": "#F2F2F5", "soft": "#E6E6EA", "gold": "#E8DFC8", "lilac": "#C9C9D1", "onAccent": "#FFFFFF"}
  ];
  // The spectrum's themes join them (Crimson, Rose, Coral, Amber, Lime, Jade, Teal, Glacier,
  // Indigo, Violet, Orchid), and "custom" is worked out from the hue saved on this device
  const SPECTRUM = window.NovaSpectrum || null;
  if (SPECTRUM) THEMES.push(...SPECTRUM.themes);
  const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const known = (id) => Boolean(byId[id]) || (id === "custom" && Boolean(SPECTRUM));
  // A theme's colours by its id (Custom's are made fresh each time, from the saved hue)
  const paletteOf = (id) => (id === "custom" && SPECTRUM ? SPECTRUM.custom() : byId[id]);

  // ---- Colour arithmetic (hex in, hex out) ----
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const csv = (h) => rgb(h).join(", ");
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "{}");
      return { theme: known(v.theme) ? v.theme : null, planet: v.planet === true, center: v.center !== false };
    } catch (err) {
      return { theme: null, planet: false, center: true };
    }
  }
  function planetPalette() {
    try {
      return JSON.parse(localStorage.getItem(PLANET) || "null");
    } catch (err) {
      return null;
    }
  }

  // A planet's colours made into a whole theme: its glow is the highlight, its streaks the accent,
  // its sky the deep background
  function fromPlanet(p, base) {
    const b = base || byId.novacane;
    const hi = lum(p.glow) < 0.35 ? mix(p.glow, "#ffffff", 0.35) : p.glow;
    // The accent: the planet's streaks, but never so dark that buttons go muddy
    let accent = mix(p.streak, p.nebula0 || p.streak, 0.25);
    if (lum(accent) < 0.08) accent = mix(p.nebula0 || p.glow, p.streak, 0.25);
    if (lum(accent) < 0.08) accent = mix(p.glow, "#000000", 0.35);
    const accent3 = mix(p.sky || b.accent3, "#000000", 0.25);
    const vd = mix("#05040A", accent3, 0.25);
    return {
      id: "planet", void: vd, deep: mix(vd, accent3, 0.35), panel: mix(vd, accent3, 0.7), panel2: mix(mix(vd, accent3, 0.7), accent, 0.12),
      text: mix(p.light || "#f0eaf5", "#d8d2de", 0.4), muted: mix(p.light || "#f0eaf5", accent3, 0.45),
      accent, accent2: p.nebula0 || mix(accent, hi, 0.3), accent3, hi, soft: p.light || mix(hi, "#ffffff", 0.7), gold: b.gold,
      lilac: p.nebula2 || mix(hi, "#ffffff", 0.3), onAccent: lum(accent) > 0.55 ? "#140F06" : "#FFFFFF",
    };
  }

  // Every name the panels use for their colours (Calendar, Notes, Observatory and Nova Agent use
  // the first set; Portal and Index add the "-rgb" ones; Lossless audio and Visualizer their own)
  function vars(t) {
    const text = t.text, bright = mix(t.soft, "#ffffff", 0.5);
    const v = {
      "--void": t.void, "--deep": t.deep, "--panel": t.panel, "--panel-2": t.panel2, "--text": text, "--muted": t.muted,
      "--accent": t.accent, "--accent-2": t.accent2, "--accent-3": t.accent3, "--hi": t.hi, "--soft": t.soft,
      "--gold": t.gold, "--lilac": t.lilac, "--on-accent": t.onAccent,
      "--void-rgb": csv(t.void), "--deep-rgb": csv(t.deep), "--panel-rgb": csv(t.panel), "--panel-2-rgb": csv(t.panel2),
      "--text-rgb": csv(text), "--muted-rgb": csv(t.muted), "--accent-rgb": csv(t.accent), "--accent-2-rgb": csv(t.accent2),
      "--accent-3-rgb": csv(t.accent3), "--hi-rgb": csv(t.hi), "--soft-rgb": csv(t.soft), "--lilac-rgb": csv(t.lilac), "--gold-rgb": csv(t.gold),
      "--bright": bright, "--accent-mid": mix(t.accent, t.accent2, 0.5), "--rose": mix(t.hi, t.soft, 0.35), "--on-hi": t.deep,
      "--glow-rgb": csv(t.hi), "--glow-accent": t.accent, "--star-rgb": csv(mix(t.soft, "#ffffff", 0.6)),
      "--bg": t.void, "--card": t.panel, "--ink": text, "--accent-text": t.onAccent,
    };
    return v;
  }
  function css(t) {
    return "html:root{" + Object.entries(vars(t)).map(([k, x]) => `${k}:${x} !important`).join(";") + "}";
  }

  // Portal's and Index's own theme can be one of the spectrum's too (when "Each panel's own" is
  // chosen). Those have no block in themes.css, so their colours are put on here, the same way
  // themes.css does it: only while the page's data-theme says so, and without !important, so a
  // panel that paints its own theme (Calendar, Notes, Observatory) still wins.
  let ownSheet = null;
  function putOwn() {
    if (!SPECTRUM) return;
    try {
      if (!ownSheet) {
        ownSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [ownSheet, ...document.adoptedStyleSheets];
      }
      const all = [...SPECTRUM.themes, SPECTRUM.custom()];
      ownSheet.replaceSync(all.map((t) => `html:root[data-theme="${t.id}"]{` + Object.entries(vars(t)).map(([k, x]) => `${k}:${x}`).join(";") + "}").join("\n"));
    } catch (err) {}
  }

  // A constructed stylesheet (allowed even by panels whose security rules forbid inline styles)
  let sheet = null;
  function put(text) {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      }
      sheet.replaceSync(text);
    } catch (err) {}
  }
  // Centred text everywhere (on unless switched off): every bit of text in Nova Agent and its panels
  // sits in the middle. What you write in (a Notes document, which has its own alignment buttons)
  // and code keep their own. Titles in a row of buttons sit in the middle of it too.
  let centerSheet = null;
  const CENTER = `body, body :not(pre, code, pre *, code *, [contenteditable="true"], [contenteditable="true"] *, svg, svg *) { text-align: center !important; }
:is([class*="head"], [class*="title"], header) > :is(h1, h2, h3) { margin-inline: auto !important; }`;
  function center(on) {
    try {
      if (!centerSheet) {
        centerSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, centerSheet];
      }
      centerSheet.replaceSync(on ? CENTER : "");
    } catch (err) {}
    document.documentElement.toggleAttribute("data-centred", on);
  }
  function apply() {
    const { theme, planet, center: centred } = read();
    center(centred);
    const pal = planet ? planetPalette() : null;
    const t = pal ? fromPlanet(pal, paletteOf(theme)) : theme ? paletteOf(theme) : null;
    if (!t) {
      put("");
      document.documentElement.removeAttribute("data-look");
      return;
    }
    put(css(t));
    document.documentElement.dataset.look = t.id;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", t.void));
    // The panels' moving star skies read their theme by name: give them the chosen one
    try {
      // (started once; after that just recoloured, so dragging the Custom slider doesn't restart it)
      for (const ns of [window.NT, window.NN]) {
        const sky = ns && ns.backdrop;
        if (!theme || pal || !sky || !sky.init) continue;
        if (sky.lookStarted && sky.setTheme) sky.setTheme(theme);
        else {
          sky.init(theme);
          sky.lookStarted = true;
        }
      }
    } catch (err) {}
  }

  function save(change) {
    const next = { ...read(), ...change };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {}
    apply();
    window.dispatchEvent(new CustomEvent("novalookchange", { detail: next }));
    return next;
  }

  // Fetch the planet's colours (Nova Agent's page does this; panels just read them)
  async function refreshPlanet() {
    try {
      const me = await fetch("/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (!me.ok) return null;
      const data = await me.json();
      const s = data.staff || data.user || data;
      if (!s || !s.id) return null;
      // Nova Bot sends the planet's colours with who you are (drawn from the same generator as
      // the planet itself)
      const c = (s.planet && s.planet.colors) || null;
      if (!c || !c.glow) return null;
      const pal = { seed: s.planet_seed || s.id, glow: c.glow, streak: c.streak || c.base || c.glow, light: c.light, base: c.base, sky: c.sky, nebula0: c.nebula0, nebula2: c.nebula2 };
      localStorage.setItem(PLANET, JSON.stringify(pal));
      apply();
      return pal;
    } catch (err) {
      return null;
    }
  }

  // A theme picked inside any panel (Portal's or Index's Options, Calendar's, Notes') becomes the
  // theme for all of Nova Agent. Only a theme you pick counts (right after a tap or a key), not a
  // panel putting on its own saved theme as it opens.
  const PANEL_IDS = { cosmic: "novacane", ember: "solar", ocean: "pulsar", gold: "eclipse", aurora: "aurora", mono: "mono" };
  // (the spectrum's themes and Custom have the same id everywhere)
  let touched = 0;
  addEventListener("pointerdown", () => (touched = Date.now()), true);
  addEventListener("keydown", () => (touched = Date.now()), true);
  function picked(id) {
    const look = known(id) ? id : PANEL_IDS[id];
    if (!look || Date.now() - touched > 1500) return;
    if (read().theme !== look) save({ theme: look });
  }
  addEventListener("novathemechange", (e) => picked(e.detail && e.detail.id));
  new MutationObserver(() => picked(document.documentElement.dataset.theme)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Another panel (or tab) changed it: follow
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === PLANET) apply();
    // The Custom colour changed: recolour (if Custom is showing) as the slider moves
    if (SPECTRUM && e.key === SPECTRUM.CUSTOM_KEY) {
      putOwn();
      apply();
    }
  });
  // ...and the same when it changes on this page
  window.addEventListener("novacustomchange", () => {
    putOwn();
    apply();
  });
  putOwn();
  apply();
  // Panels' own theme code may run after this: keep ours last
  document.addEventListener("DOMContentLoaded", apply);

  window.NovaLook = {
    themes: THEMES,
    get: read,
    setTheme: (id) => save({ theme: known(id) ? id : null }),
    setCenter: (on) => save({ center: Boolean(on) }),
    setPlanet: (on) => { const next = save({ planet: Boolean(on) }); if (on) refreshPlanet(); return next; },
    refreshPlanet,
    palette: (id) => paletteOf(id),
  };
})();
