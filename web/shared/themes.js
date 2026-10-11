// Portal themes: puts the chosen theme on the page, remembers it on this device, and draws
// the theme picker wherever the page has a <div id="theme-list"> (or data-theme-list): with
// spectrum.js loaded first, every theme as a swatch in rainbow order plus a Custom colour with
// sliders; without it, the six original swatches.
// Loaded in the <head>, before the page is drawn, so the right colours show from the very first
// frame (the site's security rules don't allow scripts written inside the page itself).
// Other pages on the site (the /admin pages) can load it too: window.NovaThemes = { list, current(), set(id) }.
(() => {
  "use strict";

  // The themes: their name, a little gradient to preview them, and the page colour (for the phone's status bar)
  const list = [
    { id: "cosmic", name: "Cosmic", color: "#06040D", preview: "radial-gradient(120% 90% at 20% 0%, #B01D68 0%, #25194D 55%, #06040D 100%), #06040D" },
    { id: "ember", name: "Ember", color: "#0B0505", preview: "radial-gradient(120% 90% at 20% 0%, #FF4D1F 0%, #8A1C0E 45%, #0B0505 100%), #0B0505" },
    { id: "aurora", name: "Aurora", color: "#030A0C", preview: "radial-gradient(120% 90% at 20% 0%, #3DF5B8 0%, #0B7A66 30%, #0B2A3A 65%, #030A0C 100%), #030A0C" },
    { id: "ocean", name: "Ocean", color: "#030713", preview: "radial-gradient(120% 90% at 20% 0%, #4CC9FF 0%, #1B5FD9 35%, #0D1B3D 70%, #030713 100%), #030713" },
    { id: "gold", name: "Gold", color: "#070605", preview: "radial-gradient(120% 90% at 20% 0%, #F0D08A 0%, #9C7A36 40%, #2B2316 70%, #070605 100%), #070605" },
    { id: "mono", name: "Mono", color: "#060607", preview: "radial-gradient(120% 90% at 20% 0%, #F2F2F5 0%, #6A6A74 35%, #1A1A20 70%, #060607 100%), #060607" },
  ];
  // The original six's colours for the spectrum picker's swatches (the same as themes.css)
  const ORBS = {
    cosmic: { accent: "#B01D68", hi: "#FF5FA8", accent3: "#25194D", void: "#06040D" },
    ember: { accent: "#D9381A", hi: "#FF7A3D", accent3: "#3B130B", void: "#0B0505" },
    aurora: { accent: "#0B7A66", hi: "#3DF5B8", accent3: "#0B2A3A", void: "#030A0C" },
    ocean: { accent: "#1B5FD9", hi: "#4CC9FF", accent3: "#0D1B3D", void: "#030713" },
    gold: { accent: "#E2C27A", hi: "#F0D08A", accent3: "#2B2316", void: "#070605" },
    mono: { accent: "#C9C9D2", hi: "#FFFFFF", accent3: "#1A1A20", void: "#060607" },
  };
  list.forEach((t) => (t.palette = ORBS[t.id]));
  // The spectrum's themes (their colours are put on by look.js) and Custom, made from one hue
  const SPECTRUM = window.NovaSpectrum || null;
  const glowOf = (p) => `radial-gradient(120% 90% at 20% 0%, ${p.hi} 0%, ${p.accent} 40%, ${p.accent3} 70%, ${p.void} 100%), ${p.void}`;
  if (SPECTRUM) {
    SPECTRUM.themes.forEach((p) => list.push({ id: p.id, name: p.name, tag: p.tag, color: p.void, preview: glowOf(p), palette: p }));
    const c = SPECTRUM.custom();
    list.push({ id: "custom", name: "Custom", tag: "Your own colour", color: c.void, preview: glowOf(c), palette: c });
  }
  const KEY = "nova-theme";
  const root = document.documentElement;

  // Find a theme by its id (or the default, Cosmic)
  function find(id) {
    return list.find((t) => t.id === id) || list[0];
  }

  // The theme saved on this device (or Cosmic)
  function saved() {
    try {
      return find(localStorage.getItem(KEY)).id;
    } catch (err) {
      return list[0].id;
    }
  }

  // Put a theme on the page: the colours, and the phone's status bar colour
  function apply(id) {
    const theme = find(id);
    root.setAttribute("data-theme", theme.id);
    const color = theme.id === "custom" && SPECTRUM ? SPECTRUM.custom().void : theme.color;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
    return theme.id;
  }

  // The theme on the page now
  function current() {
    return find(root.getAttribute("data-theme")).id;
  }

  // Choose a theme: fade across to it, remember it, and tell anyone listening
  function set(id) {
    const theme = find(id);
    try {
      localStorage.setItem(KEY, theme.id);
    } catch (err) {}
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A smooth cross-fade where the browser can do it; otherwise it just changes
    // (the browser cuts the fade short if the window changes size or another theme is tapped
    // mid-fade; the theme still changes, so that's not an error)
    if (document.startViewTransition && !still && theme.id !== current()) {
      const fade = document.startViewTransition(() => apply(theme.id));
      fade.ready.catch(() => {});
      fade.finished.catch(() => {});
    } else apply(theme.id);
    markSwatches(theme.id);
    window.dispatchEvent(new CustomEvent("novathemechange", { detail: { id: theme.id } }));
    return theme.id;
  }

  // The theme you're looking at: the one chosen for all of Nova Agent (look.js, "nova-look"), when
  // it's one of these, or else this page's own (so the picker never lights Cosmic while all of
  // Nova Agent is Jade). look.js's names for the original four are different: mapped here.
  const LOOK_NAMES = { novacane: "cosmic", solar: "ember", pulsar: "ocean", eclipse: "gold" };
  function shown() {
    try {
      const v = JSON.parse(localStorage.getItem("nova-look") || "{}");
      const id = v && !v.planet && v.theme ? LOOK_NAMES[v.theme] || v.theme : null;
      if (id && list.some((t) => t.id === id)) return id;
    } catch (err) {}
    return current();
  }

  // Show which swatch is chosen
  function markSwatches(id) {
    document.querySelectorAll(".theme-swatch, .spectrum-swatch[data-theme-id]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeId === id)));
  }

  // Draw the swatches into every theme list on the page
  function drawPicker() {
    document.querySelectorAll("#theme-list, [data-theme-list]").forEach((box) => {
      // The spectrum: every theme in rainbow order, then Custom (moving its sliders chooses it)
      if (SPECTRUM) {
        box.replaceChildren();
        box.classList.add("has-spectrum");
        SPECTRUM.draw(box, { items: list, attr: "themeId", onPick: set, onCustom: () => set("custom") });
        return;
      }
      box.replaceChildren(
        ...list.filter((t) => ORBS[t.id]).map((t) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "theme-swatch";
          b.dataset.themeId = t.id;
          b.setAttribute("aria-label", t.name + " theme");
          const preview = document.createElement("span");
          preview.className = "theme-preview";
          preview.style.background = t.preview;
          const name = document.createElement("span");
          name.className = "theme-name";
          name.textContent = t.name;
          b.append(preview, name);
          b.addEventListener("click", () => set(t.id));
          return b;
        })
      );
    });
    markSwatches(shown());
  }

  // Right now (before the page is drawn): the saved theme
  apply(saved());
  // Once the page is there: the picker
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", drawPicker);
  else drawPicker();
  // Changed in another tab or window: follow it
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      apply(e.newValue);
      markSwatches(shown());
    }
    // The theme for all of Nova Agent changed (in the Panels window, or another panel)
    if (e.key === "nova-look") markSwatches(shown());
  });
  window.addEventListener("novalookchange", () => markSwatches(shown()));

  window.NovaThemes = { list: list.map(({ id, name, preview }) => ({ id, name, preview })), current, set };
})();

// Portal options: how the app looks and behaves on this device (chosen in the Options sheet,
// options.js). Applied here too, before the page is drawn, so there's no jump when it opens.
// window.NovaOptions = { get(), set(changes), reset(), defaults }
(() => {
  "use strict";
  const KEY = "nova-options";
  const defaults = { align: "center", size: "normal", times: "both", motion: true, stars: true, pings: true, volume: 40, startTab: "today", menu: "top" };
  const root = document.documentElement;

  // The saved options, with anything missing filled in. Alignment is the same switch as Nova Agent's
  // "Centre all text" (look.js keeps it, under "nova-look"): centred unless that is switched off.
  function get() {
    let o;
    try {
      o = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch (err) {
      o = { ...defaults };
    }
    try {
      o.align = JSON.parse(localStorage.getItem("nova-look") || "{}").center === false ? "left" : "center";
    } catch (err) {}
    return o;
  }
  // Alignment chosen here goes to that one switch (so the Panels window, and every panel, follow)
  function setAlign(align) {
    const center = align !== "left";
    if (window.NovaLook) return window.NovaLook.setCenter(center);
    try {
      const look = JSON.parse(localStorage.getItem("nova-look") || "{}");
      localStorage.setItem("nova-look", JSON.stringify({ ...look, center }));
    } catch (err) {}
  }

  // Put them on the page (as attributes the styles look at)
  function apply(o) {
    root.setAttribute("data-align", o.align === "left" ? "left" : "center");
    root.setAttribute("data-size", ["small", "large"].includes(o.size) ? o.size : "normal");
    root.setAttribute("data-motion", o.motion === false ? "calm" : "full");
    root.setAttribute("data-stars", o.stars === false ? "off" : "on");
    // Portal's menu: tabs across the top (tabbar.css) or the side menu (that file switched off)
    root.setAttribute("data-menu", o.menu === "side" ? "side" : "top");
    const tabs = document.getElementById("tabbar-css");
    if (tabs) tabs.media = o.menu === "side" ? "not all" : "all";
    else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => apply(get()), { once: true });
  }

  // Change some, remember them, and tell anyone listening
  function set(changes) {
    if ("align" in changes) setAlign(changes.align);
    const o = { ...get(), ...changes };
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (err) {}
    apply(o);
    window.dispatchEvent(new CustomEvent("novaoptionschange", { detail: o }));
    return o;
  }

  function reset() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {}
    setAlign("center");
    apply(defaults);
    window.dispatchEvent(new CustomEvent("novaoptionschange", { detail: { ...defaults } }));
    return { ...defaults };
  }

  apply(get());
  // Changed in another tab or window: follow it
  window.addEventListener("storage", (e) => (e.key === KEY || e.key === "nova-look") && apply(get()));
  // "Centre all text" switched in Nova Agent's Panels window, on this page: follow it here too
  window.addEventListener("novalookchange", () => apply(get()));
  window.NovaOptions = { get, set, reset, defaults: { ...defaults } };
})();
