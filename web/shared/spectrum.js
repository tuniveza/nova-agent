// The colour spectrum: more themes for all of Nova Agent, a Custom theme made from one colour,
// and the picker that shows them all in rainbow order. Loaded in the <head> before themes.js and
// look.js, which use it (look.js puts the chosen theme on every panel; themes.js is Portal's and
// Index's own theme). Nothing here changes the page by itself.
//   window.NovaSpectrum = { themes, custom(), getCustom(), setCustom(v), fromHue(hue, vivid),
//                           hueOf(hex), order(list), draw(box, options) }
(() => {
  "use strict";
  if (window.NovaSpectrum) return;
  const CUSTOM_KEY = "nova-look-custom"; // the Custom theme's colour on this device: { hue, vivid }
  const CUSTOM_DEFAULT = { hue: 200, vivid: 70 };

  // ---- Colour arithmetic ----
  // OKLCH is a way of describing colours where the same lightness looks equally light whatever the
  // hue, so one recipe gives every hue the same calm balance (and white text stays readable on it).
  const toLinear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const toGamma = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  function oklchToRgb(L, C, h) {
    const r = (h * Math.PI) / 180, a = C * Math.cos(r), b = C * Math.sin(r);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  // A colour as "#RRGGBB" (if it's too vivid for a screen, the vividness comes down until it fits)
  function oklch(L, C, h) {
    const fits = (c) => c.every((v) => v >= -0.0005 && v <= 1.0005);
    let rgb = oklchToRgb(L, C, h);
    if (!fits(rgb)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (fits(oklchToRgb(L, mid, h))) lo = mid;
        else hi = mid;
      }
      rgb = oklchToRgb(L, lo, h);
    }
    return "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(1, toGamma(Math.max(0, v)))) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // How light a colour looks, 0 (black) to 1 (white), as the accessibility rules (WCAG) measure it
  function luminance(hex) {
    const [r, g, b] = channels(hex).map(toLinear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // The contrast between two colours (WCAG): 4.5 or more is readable for normal text
  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  // A colour's hue (0 to 360, in OKLCH) and how colourful it is (0 is grey)
  function hueOf(hex) {
    const [r, g, b] = channels(hex).map(toLinear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(A, B) };
  }

  // ---- The spectrum's hand-tuned themes (the same fields as look.js's themes) ----
  // Each is a deep, nearly black sky tinted with its hue, a luminous accent for buttons, a bright
  // highlight, a pale tint and a neighbouring second hue. Every text colour reads at WCAG AA or
  // better on its panels, and the button text (onAccent) on both ends of the button gradient.
  const THEMES = [
    { id: "crimson", name: "Crimson", tag: "Deep red",
      void: "#0D0305", deep: "#18050A", panel: "#270C12", panel2: "#380F1A", text: "#FCD7D5", muted: "#CE9C9A",
      accent: "#B3152F", accent2: "#8C0057", accent3: "#440429", hi: "#FF8987", soft: "#FFDBD8", gold: "#F2D8A2", lilac: "#F298D5", onAccent: "#FFFFFF" },
    { id: "rose", name: "Rose", tag: "Dusky pink",
      void: "#0A0406", deep: "#14080E", panel: "#211017", panel2: "#2F1621", text: "#F3DADE", muted: "#C3A1A6",
      accent: "#A03C55", accent2: "#733063", accent3: "#38162F", hi: "#F58DA2", soft: "#FFDADF", gold: "#F2D8A2", lilac: "#D7A8D8", onAccent: "#FFFFFF" },
    { id: "coral", name: "Coral", tag: "Warm salmon",
      void: "#0D0303", deep: "#170706", panel: "#260E0C", panel2: "#361311", text: "#F8DAD0", muted: "#C9A093",
      accent: "#B8423A", accent2: "#8D1334", accent3: "#440B18", hi: "#FF9A80", soft: "#FFDCD1", gold: "#F2D8A2", lilac: "#F7A3B8", onAccent: "#FFFFFF" },
    { id: "amber", name: "Amber", tag: "Honey glow",
      void: "#0D0401", deep: "#180701", panel: "#260F01", panel2: "#351500", text: "#F4DDC5", muted: "#C5A482",
      accent: "#FFA838", accent2: "#E37545", accent3: "#421200", hi: "#FFC98E", soft: "#FFDEBC", gold: "#F2D8A2", lilac: "#FF9C87", onAccent: "#180D02" },
    { id: "lime", name: "Lime", tag: "Spring green",
      void: "#020802", deep: "#041004", panel: "#0A1B07", panel2: "#0C2607", text: "#DBE6CA", muted: "#A2B28A",
      accent: "#A6CF4F", accent2: "#3CB170", accent3: "#002D15", hi: "#B8E948", soft: "#DAEDBD", gold: "#F2D8A2", lilac: "#5DD4AA", onAccent: "#0D1204" },
    { id: "jade", name: "Jade", tag: "Emerald",
      void: "#000805", deep: "#00110B", panel: "#001C13", panel2: "#00271C", text: "#CEE9D8", muted: "#8EB69E",
      accent: "#007748", accent2: "#005A51", accent3: "#002B26", hi: "#00D284", soft: "#C2F2D5", gold: "#F2D8A2", lilac: "#45D2CF", onAccent: "#FFFFFF" },
    { id: "teal", name: "Teal", tag: "Lagoon",
      void: "#00080A", deep: "#001013", panel: "#001A1E", panel2: "#002529", text: "#C7E9E7", muted: "#84B6B3",
      accent: "#007270", accent2: "#00566B", accent3: "#002935", hi: "#00CBC6", soft: "#B6F2EF", gold: "#F2D8A2", lilac: "#6BC6F7", onAccent: "#FFFFFF" },
    { id: "glacier", name: "Glacier", tag: "Ice blue",
      void: "#03060B", deep: "#060D14", panel: "#0C1721", panel2: "#10212F", text: "#D3E4EF", muted: "#96AFBE",
      accent: "#006C97", accent2: "#264E80", accent3: "#10253E", hi: "#69BCEA", soft: "#CCEAFC", gold: "#F2D8A2", lilac: "#A3BBE8", onAccent: "#FFFFFF" },
    { id: "indigo", name: "Indigo", tag: "Night blue",
      void: "#05050F", deep: "#0A0A1B", panel: "#12132B", panel2: "#1A1A3D", text: "#D5E1FE", muted: "#9AAAD2",
      accent: "#3250D8", accent2: "#552BA3", accent3: "#28154F", hi: "#90AEFF", soft: "#DAE4FF", gold: "#F2D8A2", lilac: "#CBA5FF", onAccent: "#FFFFFF" },
    { id: "violet", name: "Violet", tag: "Twilight purple",
      void: "#09040C", deep: "#120717", panel: "#1D0F25", panel2: "#2A1435", text: "#E4DCFA", muted: "#AFA3CC",
      accent: "#7637C8", accent2: "#7B1380", accent3: "#3B0B3D", hi: "#BC9CFF", soft: "#E8DFFF", gold: "#F2D8A2", lilac: "#F099D9", onAccent: "#FFFFFF" },
    { id: "orchid", name: "Orchid", tag: "Pink and purple",
      void: "#08040C", deep: "#100817", panel: "#1D1024", panel2: "#291533", text: "#F0D9EE", muted: "#BF9FBD",
      accent: "#982B98", accent2: "#5A2F98", accent3: "#2A1649", hi: "#ED83EA", soft: "#FDD6FB", gold: "#F2D8A2", lilac: "#B4B0FF", onAccent: "#FFFFFF" },
  ];

  // ---- Custom: a whole theme from one hue (0 to 359) and a vividness (0 grey to 100 full colour) ----
  // The same recipe the themes above were tuned from: lightness is fixed for each part (so every hue
  // is as readable as every other), the second colour is a neighbouring hue, and yellows and greens
  // (which go muddy when dark) get a light accent with dark button text instead.
  function fromHue(hue, vivid) {
    const H = ((Number(hue) % 360) + 360) % 360;
    const v = Math.max(0, Math.min(100, Number(vivid))) / 100;
    const bright = H >= 75 && H <= 135;
    const sh = H >= 75 && H < 300 ? 28 : -30; // which way the second hue leans
    const t = {
      id: "custom", name: "Custom", tag: "Your own colour",
      void: oklch(0.12, 0.022 * v + 0.004, H + sh * 0.6),
      deep: oklch(0.155, 0.032 * v + 0.004, H + sh * 0.6),
      panel: oklch(0.2, 0.042 * v + 0.005, H + sh * 0.5),
      panel2: oklch(0.24, 0.06 * v + 0.006, H + sh * 0.5),
      text: oklch(0.91, 0.035 * v + 0.006, H),
      muted: oklch(0.74, 0.05 * v + 0.01, H),
      accent: bright ? oklch(0.8, 0.17 * v + 0.01, H) : oklch(0.5, 0.2 * v + 0.01, H),
      accent2: bright ? oklch(0.68, 0.15 * v + 0.01, H + sh) : oklch(0.42, 0.17 * v + 0.01, H + sh),
      accent3: oklch(0.26, 0.09 * v + 0.01, H + sh),
      hi: oklch(bright ? 0.87 : 0.76, 0.19 * v + 0.01, H),
      soft: oklch(0.92, 0.06 * v + 0.01, H),
      lilac: oklch(0.79, 0.12 * v + 0.01, H + sh * 1.4),
      gold: oklch(0.89, 0.075, 85),
    };
    // Button text: white, unless white wouldn't be readable on both ends of the button gradient
    t.onAccent = Math.min(contrast("#FFFFFF", t.accent), contrast("#FFFFFF", t.accent2)) >= 4.5 ? "#FFFFFF" : oklch(0.17, 0.03 * v, H);
    return t;
  }

  // The Custom colour saved on this device (or the default, a calm blue-green)
  function getCustom() {
    try {
      const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null");
      if (v && Number.isFinite(v.hue) && Number.isFinite(v.vivid)) return { hue: Math.round(v.hue) % 360, vivid: Math.max(0, Math.min(100, Math.round(v.vivid))) };
    } catch (err) {}
    return { ...CUSTOM_DEFAULT };
  }
  // Remember a new Custom colour and tell this page (other pages and panels hear it as a storage event)
  function setCustom(v) {
    const next = { hue: Math.round(Number(v.hue)) % 360, vivid: Math.max(0, Math.min(100, Math.round(Number(v.vivid)))) };
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    } catch (err) {}
    window.dispatchEvent(new CustomEvent("novacustomchange", { detail: next }));
    return next;
  }
  const custom = (v) => {
    const c = v || getCustom();
    return fromHue(c.hue, c.vivid);
  };

  // Rainbow order, starting just before Cosmic's magenta so the default comes first; greys go last
  function order(list) {
    const key = (t) => {
      if (!t.accent) return 999;
      const { hue, chroma } = hueOf(t.accent);
      return chroma < 0.03 ? 900 : (hue - 340 + 360) % 360;
    };
    return list.map((t, i) => ({ t, k: key(t), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.t);
  }

  // ---- The picker ----
  // draw(box, {
  //   items: [{ id, name, tag, palette }],  the themes to show (put in rainbow order here)
  //   attr: "themeId",                      the data- attribute each swatch carries its id in
  //   role: "radio" | null,                 radios (aria-checked) or toggle buttons (aria-pressed)
  //   onPick(id),                           called when a swatch is tapped (leave out if the page
  //                                         already listens for clicks on [data-<attr>])
  //   onCustom(v)                           called as the Custom sliders move: { hue, vivid }
  // })
  // Swatches are round "orbs" in the theme's colours with the name underneath; the Custom row has
  // its own orb and two sliders. Colours are set through the style object (allowed by the panels'
  // security rules, unlike style="" attributes).
  function orb(el, p) {
    el.style.setProperty("--orb-a", p.accent);
    el.style.setProperty("--orb-b", p.hi);
    el.style.setProperty("--orb-c", p.accent3);
    el.style.setProperty("--orb-d", p.void);
  }
  function swatch(item, opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "spectrum-swatch";
    b.dataset[opts.attr] = item.id;
    if (opts.role === "radio") {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
    } else b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", item.name + " theme" + (item.tag ? ": " + item.tag : ""));
    b.title = item.name + (item.tag ? ": " + item.tag : "");
    const o = document.createElement("span");
    o.className = "spectrum-orb";
    o.setAttribute("aria-hidden", "true");
    orb(o, item.palette);
    const n = document.createElement("span");
    n.className = "spectrum-name";
    n.textContent = item.name;
    b.append(o, n);
    if (opts.onPick) b.addEventListener("click", () => opts.onPick(item.id));
    return b;
  }
  function slider(label, min, max, value) {
    const wrap = document.createElement("label");
    wrap.className = "spectrum-slider";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.value = String(value);
    input.setAttribute("data-sfx", "none");
    wrap.append(name, input);
    return { wrap, input };
  }
  function draw(box, opts) {
    if (!box) return null;
    const all = document.createElement("div");
    all.className = "spectrum";
    const grid = document.createElement("div");
    grid.className = "spectrum-grid";
    order(opts.items.filter((i) => i.id !== "custom").map((i) => ({ ...i.palette, ...i }))).forEach((item) => grid.append(swatch(item, opts)));

    // The Custom row: its orb (choosing it), a hue slider over a rainbow, and a vividness slider
    const row = document.createElement("div");
    row.className = "spectrum-custom";
    const c = getCustom();
    const own = swatch({ id: "custom", name: "Custom", tag: "Your own colour", palette: custom(c) }, opts);
    own.classList.add("is-custom");
    const hue = slider("Hue", 0, 359, c.hue);
    const vivid = slider("Vividness", 0, 100, c.vivid);
    hue.input.setAttribute("aria-label", "Custom theme: hue");
    vivid.input.setAttribute("aria-label", "Custom theme: vividness");
    const sliders = document.createElement("div");
    sliders.className = "spectrum-sliders";
    sliders.append(hue.wrap, vivid.wrap);
    row.append(own, sliders);
    all.append(grid, row);
    box.append(all);

    // The sliders' tracks show what they'll do: the whole rainbow, and grey to full colour
    function paint(v) {
      const stops = [];
      for (let h = 0; h <= 360; h += 30) stops.push(fromHue(h, Math.max(v.vivid, 35)).accent);
      hue.input.style.setProperty("--track", `linear-gradient(90deg, ${stops.join(", ")})`);
      vivid.input.style.setProperty("--track", `linear-gradient(90deg, ${fromHue(v.hue, 0).accent}, ${fromHue(v.hue, 100).accent})`);
      orb(own.querySelector(".spectrum-orb"), custom(v));
      hue.input.setAttribute("aria-valuetext", `${v.hue} degrees`);
      vivid.input.setAttribute("aria-valuetext", `${v.vivid} percent`);
    }
    paint(c);
    // Moving a slider: once per frame at most, save it, colour the page and choose Custom
    let frame = 0;
    function moved() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const v = setCustom({ hue: hue.input.value, vivid: vivid.input.value });
        paint(v);
        if (opts.onCustom) opts.onCustom(v);
      });
    }
    hue.input.addEventListener("input", moved);
    vivid.input.addEventListener("input", moved);
    // Changed somewhere else (another picker on this page, or another panel): follow it
    function follow(v) {
      if (!all.isConnected) return;
      if (document.activeElement !== hue.input) hue.input.value = String(v.hue);
      if (document.activeElement !== vivid.input) vivid.input.value = String(v.vivid);
      paint(v);
    }
    window.addEventListener("novacustomchange", (e) => follow(e.detail));
    window.addEventListener("storage", (e) => e.key === CUSTOM_KEY && follow(getCustom()));
    return all;
  }

  window.NovaSpectrum = { themes: THEMES, custom, getCustom, setCustom, fromHue, hueOf, contrast, order, draw, CUSTOM_KEY };
})();
