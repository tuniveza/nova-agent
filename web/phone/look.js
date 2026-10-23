// Nova Phone's look: one theme for Nova Phone and Nova Desk (the user, 23 Oct 2026: "all of Desk's themes"),
// saved the way Nova Desk saves it ("nova-look": { theme, planet, align, center }, look.js), so both apps agree
// on a device. Loaded in the <head>, before the page is drawn: the colours come from what was worked out last
// time ("nova-phone-look", kept with what it was made from), so the first frame is right and nothing heavy runs.
// The spectrum's eleven colours and Custom (one hue) need /shared/spectrum.js: fetched only when one of them is
// in use and not worked out yet, or when Settings shows them. Colour from my planet uses the planet's colours
// Nova Desk keeps ("nova-look-planet"), fetched again from /auth/me when it's switched on.
// Nova Phone's own Cosmic is themes.css's (Novacane in Nova Desk's names): with it, nothing is put on the page.
//   window.NovaPhoneLook = { get(), set(id), setPlanet(on), setCustom({hue, vivid}), list(), ready(), apply(), name(id) }
(() => {
  "use strict";
  if (window.NovaPhoneLook) return;
  const root = document.documentElement;
  const KEY = "nova-look", CUSTOM = "nova-look-custom", PLANET = "nova-look-planet", CACHE = "nova-phone-look";
  const read = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (err) {} };
  // Nova Desk's seven (look.js THEMES): the first six are the originals, Quasar its own
  const BASE = [
    { id: "novacane", name: "Novacane", tag: "Magenta nebula", void: "#06040D", deep: "#100816", panel: "#1C1129", panel2: "#241640", text: "#EBD3E7", muted: "#B997B5", accent: "#B01D68", accent2: "#7A1F86", accent3: "#25194D", hi: "#FF5FA8", soft: "#FFD1EA", gold: "#F2D9A0", lilac: "#C7A4FF", onAccent: "#FFFFFF" },
    { id: "solar", name: "Solar Flare", tag: "Red-orange", void: "#0B0403", deep: "#160805", panel: "#24100A", panel2: "#2F150C", text: "#F7DDCF", muted: "#C99C88", accent: "#D9361E", accent2: "#F2701D", accent3: "#4A1408", hi: "#FF9548", soft: "#FFD8BE", gold: "#FFD27A", lilac: "#FFB38A", onAccent: "#1A0603" },
    { id: "pulsar", name: "Pulsar", tag: "Cyan", void: "#020810", deep: "#06111C", panel: "#0B1C2A", panel2: "#0F2537", text: "#D4EEF6", muted: "#8AB3C2", accent: "#0A7EA4", accent2: "#2563EB", accent3: "#0A2342", hi: "#3DEBFF", soft: "#C9F6FF", gold: "#F4F1C9", lilac: "#8FD3FF", onAccent: "#FFFFFF" },
    { id: "aurora", name: "Aurora", tag: "Green & violet", void: "#03090A", deep: "#071312", panel: "#0D1E1C", panel2: "#122826", text: "#D6F5EC", muted: "#8FBAAE", accent: "#0B8A6B", accent2: "#6D45E8", accent3: "#0E2A33", hi: "#5CFFC0", soft: "#D3FFEE", gold: "#F3E9A1", lilac: "#A99BFF", onAccent: "#FFFFFF" },
    { id: "eclipse", name: "Eclipse", tag: "Gold corona", void: "#050404", deep: "#0D0B09", panel: "#17140F", panel2: "#201B14", text: "#F1E6D2", muted: "#B5A589", accent: "#D9A441", accent2: "#B07A2A", accent3: "#221A10", hi: "#FFCF6E", soft: "#FFEFD0", gold: "#FFE3A3", lilac: "#FFE3A3", onAccent: "#140F06" },
    { id: "quasar", name: "Quasar", tag: "Ultraviolet", void: "#05030F", deep: "#0B0719", panel: "#151030", panel2: "#1C1640", text: "#E2DDFB", muted: "#A49CCB", accent: "#5B3DF5", accent2: "#B23AEE", accent3: "#141047", hi: "#A98BFF", soft: "#E4DAFF", gold: "#FFE1F4", lilac: "#C7B8FF", onAccent: "#FFFFFF" },
    { id: "mono", name: "Mono", tag: "Silver & ink", void: "#060607", deep: "#0E0E11", panel: "#18181C", panel2: "#222228", text: "#E6E6EA", muted: "#9C9CA6", accent: "#6A6A74", accent2: "#4A4A52", accent3: "#1A1A20", hi: "#F2F2F5", soft: "#E6E6EA", gold: "#E8DFC8", lilac: "#C9C9D1", onAccent: "#FFFFFF" },
  ];
  // The spectrum's names, so a saved one is known before spectrum.js is here (it brings their colours)
  const SPECTRUM_IDS = ["crimson", "rose", "coral", "amber", "lime", "jade", "teal", "glacier", "indigo", "violet", "orchid"];
  // Nova Phone's own themes (themes.css) that are the same as one of Nova Desk's: picked here, both are saved
  const PHONE_ID = { novacane: "cosmic", solar: "ember", pulsar: "ocean", aurora: "aurora", eclipse: "gold", mono: "mono" };
  const DESK_ID = { cosmic: "novacane", ember: "solar", ocean: "pulsar", aurora: "aurora", gold: "eclipse", mono: "mono" };
  const byId = Object.fromEntries(BASE.map((t) => [t.id, t]));
  const S = () => window.NovaSpectrum || null;
  const known = (id) => !!byId[id] || SPECTRUM_IDS.includes(id) || id === "custom";

  // ---- Colour arithmetic (the same as Nova Desk's look.js) ----
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const csv = (h) => rgb(h).join(", ");
  const lum = (h) => { const [r, g, b] = rgb(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  function fromPlanet(p, base) {
    const b = base || byId.novacane;
    const hi = lum(p.glow) < 0.35 ? mix(p.glow, "#ffffff", 0.35) : p.glow;
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
  function tinted(t, p) {
    const base = fromPlanet(p, t);
    const accent = mix(t.accent, base.accent, 0.2);
    return {
      ...base, id: t.id,
      void: mix(base.void, t.void, 0.3), deep: mix(base.deep, t.deep, 0.35), panel: mix(base.panel, t.panel, 0.4), panel2: mix(base.panel2, t.panel2, 0.4),
      accent, accent2: mix(t.accent2, base.accent2, 0.25), accent3: mix(base.accent3, t.accent3, 0.5),
      hi: mix(t.hi, base.hi, 0.2), lilac: mix(base.lilac, t.lilac, 0.45), soft: mix(base.soft, t.soft, 0.3),
      onAccent: lum(accent) > 0.55 ? "#140F06" : "#FFFFFF",
    };
  }
  // Every name Nova Phone's styles use for a colour (themes.css's names)
  function vars(t) {
    const bright = mix(t.soft, "#ffffff", 0.5);
    return {
      "--void": t.void, "--deep": t.deep, "--panel": t.panel, "--panel-2": t.panel2, "--text": t.text, "--muted": t.muted,
      "--accent": t.accent, "--accent-2": t.accent2, "--accent-3": t.accent3, "--hi": t.hi, "--soft": t.soft, "--gold": t.gold, "--lilac": t.lilac, "--on-accent": t.onAccent,
      "--void-rgb": csv(t.void), "--deep-rgb": csv(t.deep), "--panel-rgb": csv(t.panel), "--panel-2-rgb": csv(t.panel2), "--text-rgb": csv(t.text), "--muted-rgb": csv(t.muted),
      "--accent-rgb": csv(t.accent), "--accent-2-rgb": csv(t.accent2), "--accent-3-rgb": csv(t.accent3), "--hi-rgb": csv(t.hi), "--soft-rgb": csv(t.soft), "--lilac-rgb": csv(t.lilac), "--gold-rgb": csv(t.gold),
      "--bright": bright, "--accent-mid": mix(t.accent, t.accent2, 0.5), "--rose": mix(t.hi, t.soft, 0.35), "--on-hi": t.deep,
      "--glow-rgb": csv(t.hi), "--glow-accent": t.accent, "--star-rgb": csv(mix(t.soft, "#ffffff", 0.6)),
    };
  }

  // What's chosen: Nova Desk's reading of "nova-look" (never chosen: Novacane, Nova Phone's Cosmic)
  function get() {
    try {
      const v = JSON.parse(read(KEY) || "{}");
      return { theme: v.theme === "own" ? null : known(v.theme) ? v.theme : "novacane", planet: v.planet === true };
    } catch (err) { return { theme: "novacane", planet: false }; }
  }
  const planetColours = () => { try { return JSON.parse(read(PLANET) || "null"); } catch (err) { return null; } };
  const sig = () => [read(KEY), read(CUSTOM), read(PLANET)].join("|");
  // A theme's colours (null: spectrum.js isn't here yet)
  function palette(id) {
    if (byId[id]) return byId[id];
    const s = S();
    if (!s) return null;
    return id === "custom" ? s.custom() : s.themes.find((t) => t.id === id) || null;
  }
  const name = (id) => (palette(id) || {}).name || (id === "custom" ? "Custom" : id ? id[0].toUpperCase() + id.slice(1) : "Nova Phone's own");

  let applied = [];
  function put(v, id, color) {
    for (const k of applied) if (!(k in v)) root.style.removeProperty(k);
    for (const [k, x] of Object.entries(v)) root.style.setProperty(k, x);
    applied = Object.keys(v);
    if (id) root.dataset.look = id; else root.removeAttribute("data-look");
    if (color) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
  }
  // Put the chosen look on the page (false: it needs spectrum.js first)
  function apply() {
    const { theme, planet } = get();
    const p = planet ? planetColours() : null;
    // Cosmic as Nova Phone draws it (themes.css); nothing chosen for both apps yet, or "Each panel's own": the
    // phone's own theme (themes.js, "nova-theme") stays as it is
    if (!p && (theme === "novacane" || !theme)) {
      put({}, "");
      if (theme === "novacane" && read(KEY) !== null && root.dataset.theme !== "cosmic") {
        root.setAttribute("data-theme", "cosmic");
        document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", "#06040D"));
      }
      write(CACHE, JSON.stringify({ sig: sig(), vars: {}, id: "" }));
      return true;
    }
    const t0 = theme ? palette(theme) : null;
    if (theme && !t0) return false;
    const t = p ? (t0 ? tinted(t0, p) : fromPlanet(p, null)) : t0;
    const v = vars(t);
    put(v, t.id, t.void);
    write(CACHE, JSON.stringify({ sig: sig(), vars: v, id: t.id, color: t.void }));
    return true;
  }
  // spectrum.js, fetched once when it's needed (from this site; the preview has it beside the page)
  let spectrum = null;
  function ready() {
    if (S()) return Promise.resolve(S());
    if (!spectrum) spectrum = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = document.querySelector('script[src="/phone/look.js"]') ? "/shared/spectrum.js" : "spectrum.js";
      s.onload = () => resolve(S());
      s.onerror = () => { spectrum = null; resolve(null); };
      document.head.append(s);
    });
    return spectrum;
  }
  function save(change) {
    let was = {};
    try { was = JSON.parse(read(KEY) || "{}") || {}; } catch (err) {}
    const next = { ...was, ...change };
    if (!next.align) { next.align = "center"; next.center = true; }
    write(KEY, JSON.stringify({ ...next, theme: next.theme || "own" }));
    if (!apply()) ready().then(apply);
    window.dispatchEvent(new CustomEvent("novalookchange", { detail: get() }));
    return get();
  }
  // Choose a theme for both apps (Nova Phone's own name too, for the originals, so Portal agrees)
  function set(id) {
    const look = DESK_ID[id] || id;
    if (!known(look)) return get();
    if (PHONE_ID[look]) write("nova-theme", PHONE_ID[look]);
    return save({ theme: look });
  }
  // Fetch the planet's colours (with who you are), as Nova Desk's look.js does
  async function refreshPlanet() {
    try {
      const r = await fetch("/auth/me", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) return null;
      const d = await r.json();
      const s = d.staff || d.user || d;
      const c = s && s.planet && s.planet.colors;
      if (!c || !c.glow) return null;
      const pal = { seed: s.planet_seed || s.id, glow: c.glow, streak: c.streak || c.base || c.glow, light: c.light, base: c.base, sky: c.sky, nebula0: c.nebula0, nebula2: c.nebula2 };
      write(PLANET, JSON.stringify(pal));
      if (!apply()) ready().then(apply);
      return pal;
    } catch (err) { return null; }
  }
  function setPlanet(on) {
    const next = save({ planet: !!on });
    if (on) refreshPlanet();
    return next;
  }
  async function setCustom(v) {
    const s = await ready();
    if (!s) return null;
    const c = s.setCustom(v);
    if (get().theme === "custom") apply();
    return c;
  }
  // Every theme, in Nova Desk's order: the seven, then the spectrum's in rainbow order, then Custom
  async function list() {
    const s = await ready();
    const all = BASE.map((t) => ({ id: t.id, name: t.name, tag: t.tag, palette: t }));
    if (s) {
      all.push(...s.order(s.themes.map((t) => ({ ...t }))).map((t) => ({ id: t.id, name: t.name, tag: t.tag, palette: t })));
      all.push({ id: "custom", name: "Custom", tag: "Your own colour", palette: s.custom() });
    }
    return all;
  }

  // Now, before the page is drawn: what was worked out last time, when nothing has changed since
  let cached = null;
  try { cached = JSON.parse(read(CACHE) || "null"); } catch (err) {}
  if (cached && cached.sig === sig() && cached.vars && Object.keys(cached.vars).length) put(cached.vars, cached.id, cached.color);
  // (Cosmic, one of the seven, changed in Nova Desk on this device, or the first time: worked out now, or once
  // spectrum.js is here)
  else if (!apply()) addEventListener("load", () => ready().then(apply), { once: true });
  // Changed in another tab or window (Nova Desk open alongside): follow it
  addEventListener("storage", (e) => { if ([KEY, CUSTOM, PLANET].includes(e.key) && !apply()) ready().then(apply); });

  window.NovaPhoneLook = { get, set, setPlanet, setCustom, refreshPlanet, list, ready, apply, name, palette, base: BASE.map((t) => ({ id: t.id, name: t.name, tag: t.tag, palette: t })), phoneId: (id) => PHONE_ID[id] || null };
})();
