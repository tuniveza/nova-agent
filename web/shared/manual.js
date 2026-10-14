// Manual: how every Nova Agent panel works, how it's built, its history and what's
// changing, in one panel on every app.
//
//   <script src="/shared/manual.js" defer></script>        (on Nova Bot's worker and in Nova Agent)
//   <script src="/shared/manual.js" defer></script>         (Notes, Calendar, Observatory: a copy)
//   <nova-manual></nova-manual>                              (optional: put the button somewhere yourself;
//                                                            without one, a floating button appears)
// It opens with the button, the ? key, or #nova-manual in the address, on the page for the
// app you're in. window.NovaManual.open("notes", "built") opens any app's page from code.
// The content (manual-data.js, next to this file) is made by scripts/build-manual.mjs from
// the apps' READMEs and git history, and only loads when the manual is first opened.
// Colours come from the page's theme: --nm-* if the app sets them, else the suite's names
// (--hi, --accent...), else Nova Agent's magenta. A floating button sits --nm-bottom
// from the bottom (16px) and --nm-side from the left. Calm motion stills it.
(() => {
  "use strict";
  if (customElements.get("nova-manual")) return;

  const SCRIPT = document.currentScript;
  const DATA_SRC = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/manual(\.js)(\?.*)?$/, "manual-data$1") : "/portal/manual-data.js";
  const ADDRESSES = "@addresses"; // the All addresses page (not an app)
  const SEEN_KEY = "nova-manual/seen";
  const PLACE_KEY = "nova-manual/place";
  const POPOVER = typeof HTMLElement.prototype.showPopover === "function";
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "calm";
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(name);
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k) || "";
      } catch (err) {
        return "";
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (err) {}
    },
  };

  // The content, loaded once, the first time anyone needs it
  let loading = null;
  function data() {
    if (window.NovaManualData) return Promise.resolve(window.NovaManualData);
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = DATA_SRC;
        s.async = true;
        s.onload = () => (window.NovaManualData ? resolve(window.NovaManualData) : reject(new Error("empty")));
        s.onerror = () => reject(new Error("missing"));
        document.head.appendChild(s);
      }).catch((err) => {
        loading = null;
        throw err;
      });
    }
    return loading;
  }

  // Which app this page is
  function hereApp() {
    const h = location.hostname;
    const p = location.pathname;
    if (/nova-notes/.test(h) || p.startsWith("/notes")) return "notes";
    if (/nova-calendar/.test(h) || p.startsWith("/calendar")) return "calendar";
    if (p.startsWith("/observatory") || location.port === "4610" || (location.protocol === "file:" && /observatory|\/no\//i.test(p))) return "observatory";
    if (p.startsWith("/app/memory")) return "index";
    if (p.startsWith("/app")) return "portal";
    if (p.startsWith("/portal")) return "portal";
    if (p.startsWith("/admin")) return "bot";
    // Nova Agent itself (online and on the studio computer), and its Visualizer
    if (p.startsWith("/agent") || p.startsWith("/visualizer") || /^454\d$/.test(location.port)) return "agent";
    return "";
  }

  const TABS = [
    ["guide", "Guide"],
    ["built", "How it's built"],
    ["history", "History"],
    ["new", "What's new"],
  ];
  const tabName = (id) => (TABS.find((t) => t[0] === id) || TABS[0])[1];

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DAY = 864e5;
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  function ago(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / DAY);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
  }
  const recent = (app, days) => app.history.commits.filter((c) => Date.now() - Date.parse(c.date) < days * DAY);
  const lastChange = (app) => (app.history.commits[0] ? app.history.commits[0].date : "");

  /* How it looks. Like every Nova Agent panel: a deep sky, glass with a soft gradient edge in the
     theme's colours, the display font for headings and small mono capitals for labels. The reading
     column is kept to a comfortable width; long pages get an "On this page" list (beside the text on
     a wide screen, folded up above it on a narrow one). */
  const CSS = `
:host {
  --c-hi: var(--nm-hi, var(--hi, #FF5FA8));
  --c-accent: var(--nm-accent, var(--accent, #B01D68));
  --c-accent-2: var(--nm-accent-2, var(--accent-2, #7A1F86));
  --c-panel: var(--nm-panel, var(--panel, #1C1129));
  --c-deep: var(--nm-deep, var(--deep, #100816));
  --c-void: var(--nm-void, var(--void, #06040D));
  --c-text: var(--nm-text, var(--text, #EBD3E7));
  --c-muted: var(--nm-muted, var(--muted, #B997B5));
  --c-bright: var(--nm-bright, var(--bright, #F6ECFF));
  --c-gold: var(--nm-gold, var(--gold, #F2D9A0));
  --c-ok: var(--nm-ok, var(--ok, #5CFFC0));
  --c-on-accent: var(--nm-on-accent, var(--on-accent, #fff));
  --c-line: var(--nm-line, color-mix(in srgb, var(--c-text) 14%, transparent));
  --c-star: var(--nm-star, rgb(var(--star-rgb, 255, 255, 255)));
  --f-d: var(--nm-font-display, var(--f-display, "Archivo", "Arial Black", sans-serif));
  --f-b: var(--nm-font-body, var(--f-body, "Saira", system-ui, sans-serif));
  --f-m: var(--nm-font-mono, var(--f-mono, "Source Code Pro", ui-monospace, monospace));
  --app: var(--c-hi);
  display: inline-flex; vertical-align: middle; flex: none; font-family: var(--f-b); color: var(--c-text);
  -webkit-tap-highlight-color: transparent;
  /* The page's own text settings (a centred sign-in screen, say) stay out */
  text-align: left; line-height: normal; letter-spacing: normal; text-transform: none; font-size: 16px; font-weight: 400; white-space: normal;
}
:host([floating]) { position: fixed; z-index: 2147482000; left: calc(var(--nm-side, 16px) + env(safe-area-inset-left, 0px)); bottom: calc(var(--nm-bottom, 16px) + env(safe-area-inset-bottom, 0px)); }
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
button, a, input { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }

/* ---- The button ---- */
.open {
  position: relative; display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 15px 0 5px; margin: 0;
  border-radius: 999px; border: 1px solid color-mix(in srgb, var(--c-hi) 40%, transparent);
  background: linear-gradient(120deg, color-mix(in srgb, var(--c-panel) 90%, transparent), color-mix(in srgb, var(--c-accent-2) 26%, var(--c-panel)));
  box-shadow: 0 10px 28px -12px color-mix(in srgb, var(--c-hi) 70%, transparent), 0 0 0 1px rgba(255,255,255,0.03) inset;
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  transition: transform .25s cubic-bezier(.2,.9,.3,1.3), box-shadow .3s, border-color .3s; animation: pop-in .7s cubic-bezier(.2,.9,.3,1.15) both .3s;
}
.open:hover { transform: translateY(-2px); border-color: var(--c-hi); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-hi) 20%, transparent), 0 14px 30px -12px var(--c-hi); }
.open:active { transform: scale(.96); }
.open:focus-visible { outline: 2px solid var(--c-hi); outline-offset: 3px; }
.open .orb { position: relative; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--c-on-accent);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c-hi) 85%, #fff), var(--c-accent) 55%, var(--c-accent-2)); box-shadow: 0 0 16px -2px color-mix(in srgb, var(--c-hi) 75%, transparent); }
.open .orb::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--c-hi) 45%, transparent); transform: rotateX(70deg); animation: ring 7s linear infinite; }
.open .spark { position: absolute; width: 4px; height: 4px; border-radius: 50%; background: var(--c-bright); box-shadow: 0 0 6px var(--c-hi); top: -1px; left: 50%; transform-origin: 0 18px; animation: spin 4s linear infinite; }
.open .label { display: grid; line-height: 1.05; text-align: left; }
.open .label b { font-family: var(--f-d); font-weight: 800; font-size: 13.5px; color: var(--c-bright); letter-spacing: .01em; }
.open .label small { font-size: 9.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--c-muted); margin-top: 3px; }
.open .dot { position: absolute; top: 3px; left: 31px; width: 10px; height: 10px; border-radius: 50%; background: var(--c-ok); border: 2px solid var(--c-deep); box-shadow: 0 0 8px var(--c-ok); animation: breathe 2.4s ease-in-out infinite; }
:host([compact]) .open { height: 40px; padding: 0 3px; }
:host([compact]) .open .orb { width: 32px; height: 32px; }
:host([compact]) .open .dot { left: 27px; }
:host([compact]) .open .label { display: none; }
/* calm (an attribute): the chip stays still (no orbiting spark, turning ring or breathing dot). Portal's header uses it. */
:host([calm]) .open .orb::after, :host([calm]) .open .dot { animation: none; }
:host([calm]) .open .spark { display: none; }
@media (max-width: 560px) { :host([floating]) .open { padding: 0 5px; } :host([floating]) .open .label { display: none; } }

/* ---- The panel ---- */
.panel {
  /* Always clickable and seen, even while Nova Agent's top bar (where the button lives) is tucked
     away with clicks off: the open manual sits above everything and doesn't inherit that */
  pointer-events: auto; visibility: visible;
  position: fixed; inset: 0; margin: auto; width: min(1180px, calc(100vw - 32px)); height: min(860px, calc(100dvh - 32px)); max-width: none; max-height: none; padding: 0;
  display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border-radius: 26px; color: var(--c-text); font-family: var(--f-b);
  border: 1px solid transparent;
  background:
    radial-gradient(90% 60% at 15% -10%, color-mix(in srgb, var(--app) 22%, transparent), transparent 60%) padding-box,
    radial-gradient(70% 50% at 100% 110%, color-mix(in srgb, var(--c-accent-2) 26%, transparent), transparent 65%) padding-box,
    linear-gradient(180deg, var(--c-panel), var(--c-deep)) padding-box,
    linear-gradient(135deg, color-mix(in srgb, var(--app) 60%, transparent), color-mix(in srgb, var(--c-accent-2) 28%, transparent) 50%, color-mix(in srgb, var(--c-hi) 35%, transparent)) border-box;
  box-shadow: 0 40px 100px -30px rgba(0,0,0,.85), 0 0 80px -40px var(--app);
  animation: panel-in .45s cubic-bezier(.2,.9,.3,1.05) both;
}
.panel[hidden], .panel[popover]:not(:popover-open) { display: none; }
.panel:not([hidden]):not([popover]) { z-index: 2147483000; }
.panel::backdrop { background: color-mix(in srgb, #000 55%, transparent); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.panel.out { animation: panel-out .22s ease-in both; }
.sky { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sky i { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: var(--c-star); opacity: .16; animation: twinkle 5s ease-in-out infinite; }

/* The header: the name, search, back and forward, close */
.top { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 14px 16px 13px 20px; border-bottom: 1px solid var(--c-line); }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.book { position: relative; width: 40px; height: 40px; flex: none; border-radius: 13px; display: grid; place-items: center; color: var(--c-on-accent);
  background: linear-gradient(135deg, var(--c-accent), var(--c-accent-2)); box-shadow: 0 10px 24px -10px var(--c-accent), inset 0 1px 0 rgba(255,255,255,.2); }
.book svg { width: 21px; height: 21px; }
.kicker { font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .26em; text-transform: uppercase; color: var(--c-hi); }
h2 { margin: 2px 0 0; font-family: var(--f-d); font-stretch: 125%; font-weight: 900; font-size: 19px; line-height: 1; color: var(--c-bright); letter-spacing: .02em; text-transform: uppercase; white-space: nowrap; }
.search { flex: 1; display: flex; align-items: center; gap: 8px; max-width: 440px; margin-left: auto; height: 40px; padding: 0 12px; border-radius: 13px;
  border: 1px solid var(--c-line); background: color-mix(in srgb, var(--c-void) 55%, transparent); transition: border-color .2s, box-shadow .2s; }
.search:focus-within { border-color: var(--c-hi); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-hi) 18%, transparent); }
.search svg { flex: none; color: var(--c-muted); }
.search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font-size: 14px; color: var(--c-bright); }
.search input::placeholder { color: var(--c-muted); }
.search input::-webkit-search-cancel-button { filter: grayscale(1); }
kbd { font-family: var(--f-m); font-size: 11px; font-weight: 600; color: var(--c-bright); border: 1px solid color-mix(in srgb, var(--c-muted) 45%, transparent); border-bottom-width: 2px; border-radius: 6px; padding: 0 6px; background: color-mix(in srgb, var(--c-void) 50%, transparent); }
.search kbd { color: var(--c-muted); }
.navs { display: flex; gap: 6px; flex: none; }
.icon, .x { flex: none; width: 40px; height: 40px; padding: 0; border-radius: 13px; border: 1px solid var(--c-line); background: color-mix(in srgb, var(--c-panel) 70%, transparent); color: var(--c-text); display: grid; place-items: center; transition: border-color .2s, color .2s, background-color .2s, opacity .2s; }
.icon:hover:not(:disabled), .x:hover { border-color: color-mix(in srgb, var(--c-hi) 55%, transparent); color: var(--c-bright); background: color-mix(in srgb, var(--c-hi) 10%, var(--c-panel)); }
.icon:disabled { opacity: .35; cursor: default; }
:is(button, a, summary):focus-visible { outline: 2px solid var(--c-hi); outline-offset: 2px; }

/* The apps down the left */
.body { position: relative; display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 0; }
.rail { display: flex; flex-direction: column; gap: 3px; padding: 14px 10px 14px 14px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--c-accent-2) 70%, transparent) transparent; border-right: 1px solid var(--c-line); text-align: left; }
.rail .label { margin: 12px 10px 4px; font-family: var(--f-m); font-size: 9.5px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: var(--c-muted); }
.rail button { --c: var(--c-hi); display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 1px solid transparent; border-radius: 14px; background: none; text-align: left; transition: background-color .2s, border-color .2s; animation: rise .45s cubic-bezier(.2,.9,.3,1.1) both; }
.rail button:hover { background: color-mix(in srgb, var(--c) 10%, transparent); }
.rail button[aria-current="true"] { background: color-mix(in srgb, var(--c) 15%, var(--c-panel)); border-color: color-mix(in srgb, var(--c) 45%, transparent); box-shadow: 0 8px 22px -16px var(--c); }
.rail .planet { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; color: #fff;
  background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 50%, color-mix(in srgb, var(--c) 40%, #000)); box-shadow: 0 0 12px -3px var(--c); }
.rail .words { display: grid; min-width: 0; line-height: 1.2; }
.rail .words b { font-family: var(--f-d); font-weight: 800; font-size: 13px; color: var(--c-bright); overflow-wrap: anywhere; }
/* (whole words, wrapped onto a second line: nothing cut short with "…") */
.rail .words small { font-size: 11px; line-height: 1.3; color: var(--c-muted); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.rail .here { margin-left: auto; flex: none; font-family: var(--f-m); font-size: 8.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; color: var(--c-deep); background: var(--c); }
.rail .fresh { margin-left: auto; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c-ok); box-shadow: 0 0 8px var(--c-ok); }

/* The page: a reading column (and "On this page" beside it when there's room) */
.page { position: relative; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--c-accent-2) 70%, transparent) transparent; padding: 0 28px 48px; scroll-behavior: smooth; container: page / inline-size; }
.page:focus { outline: none; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 28px; max-width: 720px; margin: 0 auto; padding-top: 18px; }
.layout.wide { max-width: 1040px; }
.read { min-width: 0; }
.toc-side { display: none; }
@container page (min-width: 860px) {
  .layout.has-toc { max-width: 960px; grid-template-columns: minmax(0, 1fr) 210px; }
  .layout.has-toc .toc-side { display: block; }
  .layout.has-toc .toc-box { display: none; }
}
.loading, .empty { display: grid; place-items: center; gap: 12px; min-height: 50%; padding: 40px 20px; text-align: center; color: var(--c-muted); line-height: 1.6; }
.loading .ring { width: 40px; height: 40px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--c-hi) 25%, transparent); border-top-color: var(--c-hi); animation: spin 1.2s linear infinite; }
.empty b { color: var(--c-bright); }

/* Where you are: Manual › an app › a tab */
.crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 0 0 6px; font-family: var(--f-m); font-size: 10.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--c-muted); }
:host([centred]) .crumbs { justify-content: center; }
.crumbs button { padding: 3px 6px; border: 0; border-radius: 8px; background: none; color: var(--c-hi); letter-spacing: inherit; text-transform: inherit; font-size: inherit; font-weight: inherit; }
.crumbs button:hover { background: color-mix(in srgb, var(--c-hi) 12%, transparent); color: var(--c-bright); }
.crumbs .sep { opacity: .5; }
.crumbs [aria-current] { padding: 3px 0; color: var(--c-text); }

/* An app's page: its planet, name and line, then its tabs */
.hero { position: relative; display: flex; gap: 20px; align-items: center; padding: 8px 0 18px; }
.big { --c: var(--app); position: relative; flex: none; width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; font-size: 32px; color: #fff;
  background: radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--c) 65%, #fff), var(--c) 46%, color-mix(in srgb, var(--c) 35%, #000) 100%);
  box-shadow: 0 0 40px -6px color-mix(in srgb, var(--c) 70%, transparent), inset -10px -12px 24px rgba(0,0,0,.35); animation: planet .8s cubic-bezier(.2,.9,.3,1.2) both, float 9s ease-in-out infinite .8s; }
.big::before { content: ""; position: absolute; inset: -12px -20px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--c) 45%, transparent); transform: rotate(-18deg) scaleY(.32); }
.big::after { content: ""; position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--c-bright); box-shadow: 0 0 8px var(--c); top: 4px; left: 50%; transform-origin: 0 38px; animation: spin 8s linear infinite; }
.hero .who { min-width: 0; }
.hero h1 { margin: 4px 0 6px; font-family: var(--f-d); font-stretch: 125%; font-weight: 900; font-size: clamp(24px, 3.2vw, 34px); line-height: 1.04; color: var(--c-bright); letter-spacing: .01em; text-transform: uppercase; overflow-wrap: anywhere; }
.hero p { margin: 0; font-size: 15px; line-height: 1.5; color: var(--c-text); max-width: 60ch; }
.pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
:host([centred]) .pills { justify-content: center; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--app) 30%, transparent); color: var(--c-text); background: color-mix(in srgb, var(--c-void) 35%, transparent); text-decoration: none; }
.pill.go { border: 0; color: var(--c-on-accent); background: linear-gradient(120deg, var(--c-accent), var(--c-accent-2)); box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 6px 16px -8px var(--c-accent); transition: filter .2s; }
.pill.go:hover { filter: brightness(1.08); }
.pill.here { border-color: transparent; color: var(--c-deep); background: var(--app); font-family: var(--f-m); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; font-size: 10px; }

/* The tabs: choices in one glass well that stays at the top as you scroll */
.tabs { position: sticky; top: 8px; z-index: 3; display: flex; gap: 3px; width: max-content; max-width: 100%; padding: 4px; margin: 0 0 14px; border-radius: 999px; border: 1px solid var(--c-line);
  background: color-mix(in srgb, var(--c-panel) 86%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); box-shadow: 0 10px 26px -18px #000; overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
:host([centred]) .tabs { margin-inline: auto; }
.tabs button { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid transparent; background: none; font-size: 13px; font-weight: 600; color: var(--c-muted); transition: color .2s, background-color .2s, border-color .2s; }
.tabs button:hover { color: var(--c-bright); background: color-mix(in srgb, var(--c-text) 7%, transparent); }
.tabs button[aria-selected="true"] { color: var(--c-on-accent); border-color: transparent; background: linear-gradient(120deg, color-mix(in srgb, var(--app) 60%, var(--c-accent)), var(--c-accent-2)); box-shadow: inset 0 1px 0 rgba(255,255,255,.18), 0 8px 20px -12px var(--app); }
.tabs .n { font-family: var(--f-m); font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--c-void) 45%, transparent); }

/* "On this page": beside the text (wide) or folded above it (narrow) */
.toc-side { position: sticky; top: 14px; align-self: start; max-height: min(72dvh, 680px); overflow-y: auto; scrollbar-width: thin; padding: 14px 0 0; text-align: left; }
.toc-title { display: block; margin: 0 0 8px 12px; font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .22em; text-transform: uppercase; color: var(--c-muted); }
.toc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; text-align: left; }
.toc-list button { display: block; width: 100%; padding: 6px 10px 6px 12px; border: 0; border-left: 2px solid var(--c-line); border-radius: 0 10px 10px 0; background: none; color: var(--c-muted); font-size: 13px; line-height: 1.35; text-align: left; transition: color .2s, background-color .2s, border-color .2s; }
.toc-list button:hover { color: var(--c-bright); background: color-mix(in srgb, var(--app) 8%, transparent); }
.toc-list button[aria-current="location"] { color: var(--c-text); border-left-color: color-mix(in srgb, var(--app) 50%, transparent); }
.toc-list button[aria-current="true"] { color: var(--c-bright); background: color-mix(in srgb, var(--app) 12%, transparent); border-left-color: var(--app); }
.toc-list .sub button { padding-left: 24px; font-size: 12.5px; }
.toc-box { margin: 0 0 16px; border: 1px solid var(--c-line); border-radius: 16px; background: color-mix(in srgb, var(--c-void) 30%, transparent); text-align: left; }
.toc-box summary { list-style: none; display: flex; align-items: center; gap: 10px; padding: 12px 16px; cursor: pointer; border-radius: inherit; font-family: var(--f-d); font-weight: 800; font-size: 13.5px; color: var(--c-bright); }
.toc-box summary::-webkit-details-marker { display: none; }
.toc-box summary::before { content: "▸"; color: var(--app); transition: rotate .2s; }
.toc-box[open] summary::before { rotate: 90deg; }
.toc-box summary small { margin-left: auto; font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--c-muted); }
.toc-box .toc-list { max-height: 50dvh; overflow-y: auto; padding: 0 10px 12px; }

/* The writing: one chapter per card */
.chapter { position: relative; margin: 0 0 16px; padding: 22px 26px 12px; border-radius: 20px; border: 1px solid color-mix(in srgb, var(--app) 16%, var(--c-line)); background: color-mix(in srgb, var(--c-panel) 58%, transparent); box-shadow: inset 0 1px 0 rgba(255,255,255,.03); animation: rise .45s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 40ms); scroll-margin-top: 66px; }
.chapter.flash { animation: flash 1.6s ease-out; }
.chapter > h3 { margin: 0 0 12px; font-family: var(--f-d); font-weight: 900; font-size: 20px; line-height: 1.2; color: var(--c-bright); display: flex; align-items: center; gap: 10px; }
:host([centred]) .chapter > h3 { justify-content: center; }
.chapter > h3::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--app); box-shadow: 0 0 10px var(--app); flex: none; }
.intro { margin: 0 0 16px; }
.prose { font-size: 15.5px; line-height: 1.7; color: var(--c-text); overflow-wrap: break-word; }
.prose p { margin: 0 0 .9em; }
.prose h4 { margin: 1.5em 0 .5em; padding-top: 1em; border-top: 1px solid var(--c-line); font-family: var(--f-d); font-weight: 800; font-size: 16px; line-height: 1.3; color: var(--c-bright); scroll-margin-top: 66px; }
.prose > h4:first-child { margin-top: .2em; padding-top: 0; border-top: 0; }
.prose h4.flash { animation: glow 1.6s ease-out; }
.prose h5, .prose h6 { margin: 1.1em 0 .4em; font-family: var(--f-d); font-weight: 800; font-size: 14px; color: var(--c-gold); }
.prose ul, .prose ol { margin: .2em 0 .9em; padding-left: 1.3em; }
:host([centred]) .prose :is(ul, ol) { padding-left: 0; list-style-position: inside; }
.prose li { margin: .3em 0; }
.prose li.sub { margin-left: 1.2em; }
.prose li::marker { color: var(--app); }
.prose strong { color: var(--c-bright); font-weight: 650; }
.prose a { color: var(--c-gold); text-decoration-color: color-mix(in srgb, var(--c-gold) 45%, transparent); text-underline-offset: 3px; }
.prose code { font-family: var(--f-m); font-size: .84em; padding: 1px 6px; border-radius: 6px; background: color-mix(in srgb, var(--c-void) 60%, transparent); color: var(--c-bright); border: 1px solid color-mix(in srgb, var(--app) 16%, var(--c-line)); overflow-wrap: anywhere; }
.code { position: relative; margin: .4em 0 1em; }
.prose pre { margin: 0; padding: 14px 16px; border-radius: 14px; overflow-x: auto; text-align: left; background: color-mix(in srgb, var(--c-void) 78%, transparent); border: 1px solid color-mix(in srgb, var(--app) 18%, var(--c-line)); scrollbar-width: thin; }
.code pre { padding-right: 76px; }
.prose pre code { padding: 0; border: 0; background: none; font-size: 12.5px; line-height: 1.6; white-space: pre; overflow-wrap: normal; }
.copy { position: absolute; top: 8px; right: 8px; z-index: 1; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--c-line); background: color-mix(in srgb, var(--c-panel) 85%, transparent); font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--c-muted); opacity: .75; transition: opacity .2s, color .2s, border-color .2s; }
.code:hover .copy, .copy:focus-visible { opacity: 1; }
.copy:hover { color: var(--c-bright); border-color: color-mix(in srgb, var(--c-hi) 50%, transparent); }
/* All addresses: each one with its line, the address (Copy on it) and Open */
.addr-note { margin: -4px 0 10px; font-size: 13.5px; line-height: 1.5; color: var(--c-muted); }
.addr-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.addr { display: grid; gap: 6px; padding: 12px 14px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--c-hi) 16%, var(--c-line)); background: color-mix(in srgb, var(--c-panel) 60%, transparent); min-width: 0; }
.addr-words { display: grid; gap: 2px; min-width: 0; }
.addr-words b { font-family: var(--f-d); font-weight: 800; font-size: 14.5px; color: var(--c-bright); }
.addr-words span { font-size: 13.5px; line-height: 1.45; color: var(--c-text); }
.addr .code { margin: 0; }
.addr pre { margin: 0; padding: 9px 76px 9px 12px; border-radius: 10px; font-family: var(--f-m); font-size: 12.5px; line-height: 1.5; color: var(--c-bright); white-space: pre-wrap; overflow-wrap: anywhere; background: color-mix(in srgb, var(--c-void) 70%, transparent); border: 1px solid var(--c-line); user-select: all; }
.addr .copy { top: 50%; transform: translateY(-50%); opacity: 1; }
.addr-open { justify-self: start; font-size: 13px; color: var(--c-gold); text-underline-offset: 3px; }
.addr-more { display: block; width: 100%; margin: 14px 0 0; padding: 12px 16px; border-radius: 16px; text-align: left; font-size: 14px; color: var(--c-bright); border: 1px dashed color-mix(in srgb, var(--c-hi) 40%, transparent); background: color-mix(in srgb, var(--c-hi) 7%, transparent); }
.addr-more:hover { border-style: solid; }
.prose blockquote { margin: .4em 0 1em; padding: 10px 16px; border-left: 3px solid var(--app); border-radius: 0 12px 12px 0; background: color-mix(in srgb, var(--app) 8%, transparent); color: var(--c-text); }
.prose .table { overflow-x: auto; margin: .4em 0 1em; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--app) 18%, var(--c-line)); scrollbar-width: thin; }
.prose table { width: 100%; border-collapse: collapse; font-size: 13.5px; line-height: 1.5; }
.prose th { font-family: var(--f-m); font-weight: 600; font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--c-bright); background: color-mix(in srgb, var(--app) 12%, transparent); }
.prose th, .prose td { padding: 9px 12px; vertical-align: top; border-bottom: 1px solid color-mix(in srgb, var(--app) 10%, var(--c-line)); }
.prose tr:last-child td { border-bottom: 0; }
.prose tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--c-void) 18%, transparent); }

/* Next and previous app, at the end of a page */
.pager { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 22px 0 6px; }
.pager button { --c: var(--c-hi); display: grid; gap: 3px; padding: 12px 16px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--c) 28%, transparent); background: color-mix(in srgb, var(--c-panel) 55%, transparent); text-align: left; transition: border-color .2s, background-color .2s; }
.pager button:hover { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--c-panel)); }
.pager .next { grid-column: 2; text-align: right; }
.pager small { font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--c-muted); }
.pager b { font-family: var(--f-d); font-weight: 800; font-size: 15px; color: var(--c-bright); }

/* Back to the top of a long page */
.to-top { position: absolute; right: 22px; bottom: 20px; z-index: 4; width: 42px; height: 42px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--c-hi) 40%, transparent); background: color-mix(in srgb, var(--c-panel) 88%, transparent); color: var(--c-bright); display: grid; place-items: center; box-shadow: 0 10px 26px -12px #000; opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity .25s, transform .25s, border-color .2s; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.to-top.show { opacity: 1; pointer-events: auto; transform: none; }
.to-top:hover { border-color: var(--c-hi); }

/* History: a timeline */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 18px; }
.stat { padding: 14px 16px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--app) 20%, var(--c-line)); background: color-mix(in srgb, var(--c-panel) 60%, transparent); animation: rise .45s cubic-bezier(.2,.9,.3,1.1) both; min-width: 0; }
.stat b { display: block; font-family: var(--f-d); font-stretch: 125%; font-weight: 900; font-size: 22px; color: var(--c-bright); line-height: 1.1; overflow-wrap: anywhere; }
.stat span { font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .06em; line-height: 1.5; text-transform: uppercase; color: var(--c-muted); }
.day { margin: 18px 0 6px 26px; font-family: var(--f-m); font-weight: 600; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--c-gold); }
.line { position: relative; padding-left: 26px; }
.line::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; border-radius: 2px; background: linear-gradient(180deg, var(--app), color-mix(in srgb, var(--app) 10%, transparent)); }
.commit { position: relative; margin: 0 0 8px; padding: 10px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--app) 14%, var(--c-line)); background: color-mix(in srgb, var(--c-panel) 55%, transparent); animation: rise .4s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 30ms); }
.commit::before { content: ""; position: absolute; left: -23px; top: 15px; width: 10px; height: 10px; border-radius: 50%; background: var(--c-deep); border: 2px solid var(--app); box-shadow: 0 0 8px color-mix(in srgb, var(--app) 60%, transparent); }
.commit .s { font-size: 14px; font-weight: 600; color: var(--c-bright); line-height: 1.4; overflow-wrap: anywhere; }
.commit .m { margin-top: 4px; font-size: 11px; color: var(--c-muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
:host([centred]) .commit .m { justify-content: center; }
.commit .m code { font-family: var(--f-m); font-size: 10.5px; padding: 0 5px; border-radius: 5px; background: color-mix(in srgb, var(--c-void) 60%, transparent); }
.commit .m .tag { font-weight: 700; color: var(--c-deep); background: var(--c, var(--app)); padding: 0 6px; border-radius: 999px; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; }
.commit details { margin-top: 6px; }
.commit summary { cursor: pointer; font-size: 11.5px; color: var(--c-gold); list-style: none; }
.commit summary::-webkit-details-marker { display: none; }
.commit summary::before { content: "▸ "; }
.commit details[open] summary::before { content: "▾ "; }
.commit pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--f-b); font-size: 13px; line-height: 1.55; color: var(--c-text); }
.wip { margin: 0 0 16px; padding: 16px 18px; border-radius: 20px; border: 1px dashed color-mix(in srgb, var(--c-gold) 55%, transparent); background: color-mix(in srgb, var(--c-gold) 6%, transparent); }
.wip h3 { margin: 0 0 4px; font-family: var(--f-d); font-weight: 900; font-size: 17px; color: var(--c-gold); }
.wip p { margin: 0 0 10px; font-size: 13px; color: var(--c-muted); }
.files { display: flex; flex-wrap: wrap; gap: 6px; }
:host([centred]) .files { justify-content: center; }
.files span { font-family: var(--f-m); font-size: 11.5px; padding: 3px 8px; border-radius: 8px; background: color-mix(in srgb, var(--c-void) 55%, transparent); border: 1px solid color-mix(in srgb, var(--app) 14%, transparent); overflow-wrap: anywhere; }
.files span.new { border-color: color-mix(in srgb, var(--c-ok) 50%, transparent); color: var(--c-ok); }
.files span.removed { text-decoration: line-through; opacity: .7; }
.note { font-size: 13px; line-height: 1.55; color: var(--c-muted); margin: 0 0 14px; }
.note code { font-family: var(--f-m); font-size: .9em; }

/* Start here: one card for each app */
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; margin: 6px 0 22px; }
.card-app { --c: var(--c-hi); position: relative; display: grid; align-content: start; gap: 6px; padding: 16px; border-radius: 20px; text-align: left; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent); background: radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--c) 16%, transparent), transparent 60%), color-mix(in srgb, var(--c-panel) 65%, transparent);
  transition: border-color .25s, box-shadow .25s, background-color .25s; animation: rise .5s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 45ms); }
.card-app:hover { border-color: var(--c); box-shadow: 0 16px 34px -20px var(--c), 0 0 0 3px color-mix(in srgb, var(--c) 14%, transparent); }
.card-app .top-row { display: flex; align-items: center; gap: 10px; }
.card-app .planet { width: 34px; height: 34px; flex: none; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 15px; background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 50%, color-mix(in srgb, var(--c) 40%, #000)); box-shadow: 0 0 14px -3px var(--c); }
.card-app b { font-family: var(--f-d); font-weight: 900; font-size: 16px; color: var(--c-bright); }
.card-app p { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--c-text); }
.card-app small { font-family: var(--f-m); font-size: 10px; letter-spacing: .06em; color: var(--c-muted); }
.section-title { display: flex; align-items: center; gap: 12px; margin: 24px 0 12px; font-family: var(--f-m); font-weight: 600; font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: var(--c-hi); }
.section-title::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--c-line), transparent); }
:host([centred]) .section-title::before { content: ""; flex: 1; height: 1px; background: linear-gradient(270deg, var(--c-line), transparent); }
:host([centred]) .section-title::after { background: linear-gradient(90deg, var(--c-line), transparent); }

/* Search */
.hits { display: grid; gap: 8px; }
.hit { --c: var(--c-hi); display: grid; gap: 4px; width: 100%; padding: 12px 16px; border-radius: 16px; text-align: left; border: 1px solid color-mix(in srgb, var(--c) 22%, transparent); background: color-mix(in srgb, var(--c-panel) 60%, transparent); transition: border-color .2s, background-color .2s; animation: rise .3s ease both; animation-delay: calc(var(--i, 0) * 25ms); }
.hit:hover { border-color: var(--c); background: color-mix(in srgb, var(--c) 8%, var(--c-panel)); }
.hit .where { font-family: var(--f-m); font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--c); }
.hit b { font-family: var(--f-d); font-weight: 800; font-size: 15px; color: var(--c-bright); }
.hit span { font-size: 13px; line-height: 1.5; color: var(--c-muted); }
.hit mark { background: color-mix(in srgb, var(--c-gold) 30%, transparent); color: var(--c-bright); border-radius: 3px; padding: 0; box-shadow: 0 0 0 2px color-mix(in srgb, var(--c-gold) 30%, transparent); }

/* Phones (and narrow windows): the whole screen; the apps in a strip that slides sideways */
/* Centred text (Nova Agent's "Centre all text", on unless switched off): the apps down the side,
   "On this page", the search, the app cards, search results and the next and previous buttons
   centre their words too */
:host([centred]) :is(.rail, .rail .label, .rail .words, .toc-side, .toc-list, .toc-list button, .toc-box, .card-app, .hit, .pager button, .pager .next, .open .label, .search input) { text-align: center; }
:host([centred]) .rail .words { flex: 1; }
:host([centred]) :is(.card-app .top-row, .toc-box summary) { justify-content: center; }
:host([centred]) .toc-box summary small { margin-left: 0; }
@media (max-width: 760px) {
  .panel { width: 100%; height: 100%; border-radius: 0; border: 0; background-clip: padding-box; }
  .top { flex-wrap: wrap; padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px; gap: 8px 10px; }
  .book { width: 36px; height: 36px; border-radius: 12px; }
  h2 { font-size: 17px; }
  .navs { margin-left: auto; }
  .search { order: 3; flex-basis: 100%; max-width: none; margin-left: 0; }
  .search input { font-size: 16px; }
  .search kbd { display: none; }
  .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  /* Narrow screens: the apps wrap onto neat rows (none run off the edge) */
  .rail { flex-direction: row; flex-wrap: wrap; justify-content: center; overflow: visible; padding: 8px 10px; gap: 5px; border-right: 0; border-bottom: 1px solid var(--c-line); scrollbar-width: none; }
  .rail::-webkit-scrollbar { display: none; }
  .rail .label { display: none; }
  .rail button { width: auto; flex: none; gap: 7px; padding: 4px 11px 4px 4px; border-radius: 999px; }
  .rail .planet { width: 24px; height: 24px; font-size: 11px; }
  .rail .words b { font-size: 12px; white-space: nowrap; }
  .rail .words small, .rail .here, .rail .fresh { display: none; }
  .page { padding: 0 14px calc(40px + env(safe-area-inset-bottom, 0px)); }
  .layout { padding-top: 14px; }
  .hero { gap: 14px; padding-bottom: 12px; }
  .big { width: 60px; height: 60px; font-size: 22px; }
  .big::before { inset: -9px -14px; }
  .big::after { transform-origin: 0 26px; }
  .hero p { font-size: 14px; }
  .chapter { padding: 16px 16px 8px; border-radius: 16px; }
  .chapter > h3 { font-size: 18px; }
  .prose { font-size: 15px; line-height: 1.65; }
  .tabs button { padding: 0 11px; font-size: 12.5px; }
  .pager { grid-template-columns: minmax(0, 1fr); }
  .pager .next { grid-column: auto; }
  .to-top { right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
}
@media (max-width: 420px) {
  /* The four tabs as two rows of two, so none is cut off */
  .tabs { display: grid; grid-template-columns: 1fr 1fr; width: 100%; border-radius: 18px; }
  .tabs button { justify-content: center; border-radius: 14px; }
  .hero { flex-direction: column; text-align: center; }
  .hero .pills { justify-content: center; }
}

@keyframes pop-in { from { opacity: 0; transform: translateY(10px) scale(.85); } }
@keyframes panel-in { from { opacity: 0; transform: translateY(12px) scale(.97); } }
@keyframes panel-out { to { opacity: 0; transform: translateY(10px) scale(.97); } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes ring { to { transform: rotateX(70deg) rotateZ(360deg); } }
@keyframes breathe { 50% { opacity: .5; transform: scale(.85); } }
@keyframes twinkle { 50% { opacity: .7; } }
@keyframes float { 50% { transform: translateY(-4px); } }
@keyframes planet { from { opacity: 0; transform: scale(.4) rotate(-90deg); } }
@keyframes flash { 0% { box-shadow: 0 0 0 3px var(--app); } 100% { box-shadow: 0 0 0 0 transparent; } }
@keyframes glow { 0% { color: var(--app); } 100% { color: var(--c-bright); } }
:host(.calm) *, :host(.calm) *::before, :host(.calm) *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;

  const ICON = {
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z"/><path d="M12 6.5v13"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    go: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    forward: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    up: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  };

  // Per-item colours and delays are set from here, not as style="" (pages with strict
  // security rules, like Portal's, don't allow inline styles; setting them in code is fine)
  function paint(root) {
    for (const el of root.querySelectorAll("[data-v]")) {
      for (const pair of el.getAttribute("data-v").split(";")) {
        const at = pair.indexOf(":");
        if (at > 0) el.style.setProperty(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      el.removeAttribute("data-v");
    }
  }

  // Every open manual on the page (one, usually), so window.NovaManual can reach it
  const all = new Set();

  class NovaManual extends HTMLElement {
    constructor() {
      super();
      this.root = this.attachShadow({ mode: "open" });
      this.root.adoptedStyleSheets = [sheet()];
      let saved = {};
      try {
        saved = JSON.parse(store.get(PLACE_KEY) || "{}");
      } catch (err) {}
      this.here = this.getAttribute("app") || hereApp();
      this.app = this.here || saved.app || "";
      this.tab = saved.app === this.app && saved.tab ? saved.tab : "guide";
      this.query = "";
      this.isOpen = false;
      // Back and forward: where you've been in the manual since it opened, and where you came back from
      this.past = [];
      this.future = [];
      // The "On this page" list for what's showing: [{ id, title, subs: [{ id, title }] }]
      this.toc = null;
      this.onKey = (e) => this.key(e);
      this.onCalm = () => this.classList.toggle("calm", still());
      // Nova Agent's "centred text" setting (look.js puts data-centred on the page): the manual
      // follows it, and moves list bullets in beside their centred lines
      this.onCentred = () => this.toggleAttribute("centred", document.documentElement.hasAttribute("data-centred"));
      this.centredWatch = new MutationObserver(this.onCentred);
    }
    connectedCallback() {
      all.add(this);
      this.onCalm();
      this.onCentred();
      this.centredWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-centred"] });
      window.addEventListener("novaoptionschange", this.onCalm);
      this.drawButton();
      // A small green dot when something in the suite changed since you last looked. It needs the
      // whole manual (the biggest download on the page), so a phone, or a button nobody can see,
      // skips it: the manual still loads the moment it's opened.
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
      idle(() => {
        const seen = this.checkVisibility ? this.checkVisibility() : this.getClientRects().length > 0;
        if (!seen || matchMedia("(max-width: 760px)").matches) return;
        data().then((d) => this.markNew(d)).catch(() => {});
      });
    }
    disconnectedCallback() {
      all.delete(this);
      this.centredWatch.disconnect();
      window.removeEventListener("novaoptionschange", this.onCalm);
      this.close();
    }

    drawButton() {
      this.root.innerHTML = `<button class="open" part="button" type="button" aria-haspopup="dialog" aria-expanded="false" title="Manual (press ?)">
          <span class="orb">${ICON.book.replace("<svg", '<svg width="18" height="18"')}<span class="spark"></span></span>
          <span class="label"><b>Manual</b><small>Nova Agent</small></span>
        </button>
        <div class="panel" role="dialog" aria-modal="true" aria-label="Manual" ${POPOVER ? 'popover="manual"' : "hidden"}></div>`;
      this.root.querySelector(".open").addEventListener("click", () => (this.isOpen ? this.close(true) : this.open()));
    }
    markNew(d) {
      const seen = Date.parse(store.get(SEEN_KEY) || "") || 0;
      const newest = Math.max(0, ...d.apps.map((a) => Date.parse(lastChange(a)) || 0));
      const btn = this.root.querySelector(".open");
      if (!btn || this.isOpen) return;
      const dot = btn.querySelector(".dot");
      if (newest > seen && Date.now() - newest < 3 * DAY) {
        if (!dot) btn.insertAdjacentHTML("beforeend", '<span class="dot" aria-hidden="true"></span>');
        btn.title = "Manual: something's new (press ?)";
      } else if (dot) dot.remove();
    }

    open(app, tab) {
      // Already open and asked for another page (from code): Back comes here again
      if (this.isOpen && (app !== undefined || tab) && this.d) {
        this.past.push(this.snap());
        this.future.length = 0;
      }
      if (app !== undefined) this.app = app;
      if (tab) this.tab = tab;
      const panel = this.root.querySelector(".panel");
      if (!this.isOpen) {
        this.past = [];
        this.future = [];
        this.query = "";
        panel.innerHTML = `<div class="sky">${"<i></i>".repeat(18)}</div>
          <header class="top">
            <div class="brand"><span class="book">${ICON.book}</span><div><div class="kicker">Nova Agent</div><h2>Manual</h2></div></div>
            <label class="search">${ICON.search}<input type="search" placeholder="Search every app's manual" aria-label="Search the manual" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
            <span class="navs">
              <button class="icon" type="button" data-nav="back" aria-label="Back" title="Back (Alt + ←)" disabled>${ICON.back}</button>
              <button class="icon" type="button" data-nav="forward" aria-label="Forward" title="Forward (Alt + →)" disabled>${ICON.forward}</button>
            </span>
            <button class="x" type="button" aria-label="Close the manual" title="Close (Esc)">${ICON.x}</button>
          </header>
          <div class="body"><nav class="rail" aria-label="Apps"></nav><main class="page" tabindex="-1"><div class="loading"><span class="ring"></span>Opening the manual…</div></main>
            <button class="to-top" type="button" data-nav="top" aria-label="Back to the top" title="Back to the top">${ICON.up}</button></div>`;
        panel.querySelector(".x").addEventListener("click", () => this.close(true));
        const input = panel.querySelector("input");
        input.addEventListener("input", () => this.search(input.value.trim()));
        panel.addEventListener("click", (e) => this.click(e));
        // As you read: the "On this page" list follows along, and the way back to the top appears
        const page = panel.querySelector(".page");
        let ticking = false;
        page.addEventListener("scroll", () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            ticking = false;
            this.spy();
          });
        }, { passive: true });
        if (POPOVER) panel.showPopover();
        else panel.hidden = false;
        panel.classList.remove("out");
        this.isOpen = true;
        this.root.querySelector(".open").setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", this.onKey, true);
        sfx("open");
        // (straight to the search box with a keyboard; on a touch screen that would pop the keyboard up)
        // (the keyboard comes here from an open app too, so Esc and / reach the manual)
        try { window.focus(); } catch (err) {}
        if (matchMedia("(pointer: fine)").matches) setTimeout(() => input.focus({ preventScroll: true }), 60);
        else setTimeout(() => page.focus({ preventScroll: true }), 60);
      }
      data()
        .then((d) => {
          this.d = d;
          store.set(SEEN_KEY, new Date().toISOString());
          const dot = this.root.querySelector(".open .dot");
          if (dot) dot.remove();
          if (this.app && this.app !== ADDRESSES && !d.apps.some((a) => a.id === this.app)) this.app = "";
          this.drawRail();
          this.drawPage();
          this.drawNav();
        })
        .catch(() => {
          const page = this.root.querySelector(".page");
          if (page) page.innerHTML = `<div class="empty"><div><b>The manual's pages aren't here yet.</b><br>Run <code>node scripts/build-manual.mjs</code> in Portal to make them.</div></div>`;
        });
    }
    close(withSound) {
      if (!this.isOpen) return;
      this.isOpen = false;
      document.removeEventListener("keydown", this.onKey, true);
      const panel = this.root.querySelector(".panel");
      const btn = this.root.querySelector(".open");
      if (btn) btn.setAttribute("aria-expanded", "false");
      if (withSound) sfx("close");
      if (!panel) return;
      const hide = () => {
        if (POPOVER) panel.matches(":popover-open") && panel.hidePopover();
        else panel.hidden = true;
        panel.innerHTML = "";
      };
      if (still()) hide();
      else {
        panel.classList.add("out");
        setTimeout(() => this.isOpen || hide(), 200);
      }
      if (withSound && btn) btn.focus({ preventScroll: true });
    }
    key(e) {
      const input = this.root.querySelector(".search input");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (input && input.value) {
          input.value = "";
          this.search("");
        } else this.close(true);
      } else if (e.key === "/" && this.root.activeElement !== input) {
        e.preventDefault();
        input.focus();
      } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.metaKey) {
        // Alt + ← / → : back and forward in the manual (not the browser's own history)
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowLeft") this.back();
        else this.forward();
      }
    }
    remember() {
      store.set(PLACE_KEY, JSON.stringify({ app: this.app, tab: this.tab }));
    }

    // ---- Going places (and back again) ----
    pageEl() {
      return this.root.querySelector(".page");
    }
    snap() {
      const page = this.pageEl();
      return { app: this.app, tab: this.tab, query: this.query, scroll: page ? page.scrollTop : 0 };
    }
    // Show a place: { app, tab, query } (what's left out stays), at a scroll position or a heading
    show(s, scroll, goto) {
      if (s.app !== undefined) this.app = s.app;
      if (s.tab) this.tab = s.tab;
      if (s.query !== undefined) {
        this.query = s.query;
        const input = this.root.querySelector(".search input");
        if (input && input.value.trim() !== s.query) input.value = s.query;
      }
      this.remember();
      this.drawPage();
      this.drawNav();
      const page = this.pageEl();
      if (page && scroll) {
        page.style.scrollBehavior = "auto";
        page.scrollTop = scroll;
        page.style.scrollBehavior = "";
        this.spy();
      }
      if (goto) this.goTo(goto);
    }
    go(next, goto) {
      this.past.push(this.snap());
      this.future.length = 0;
      this.show(next, 0, goto);
    }
    back() {
      const s = this.past.pop();
      if (!s) return;
      this.future.push(this.snap());
      sfx("tap");
      this.show(s, s.scroll);
    }
    forward() {
      const s = this.future.pop();
      if (!s) return;
      this.past.push(this.snap());
      sfx("tap");
      this.show(s, s.scroll);
    }
    drawNav() {
      const b = this.root.querySelector('[data-nav="back"]');
      const f = this.root.querySelector('[data-nav="forward"]');
      if (b) b.disabled = !this.past.length;
      if (f) f.disabled = !this.future.length;
    }
    // Typing in the search box: the first letter keeps your place, so Back returns to it
    search(q) {
      if (q && !this.query) {
        this.past.push(this.snap());
        this.future.length = 0;
      }
      this.query = q;
      this.drawPage();
      this.drawNav();
    }

    drawRail() {
      const rail = this.root.querySelector(".rail");
      if (!rail || !this.d) return;
      const btn = (id, name, small, colour, glyph, i, extra) =>
        `<button type="button" data-app="${id}" aria-current="${this.app === id && !this.query}" data-v="--c:${colour};animation-delay:${i * 35}ms"><span class="planet" aria-hidden="true">${glyph}</span><span class="words" title="${esc(small)}"><b>${esc(name)}</b><small>${esc(small)}</small></span>${extra}</button>`;
      rail.innerHTML =
        btn("", "Start here", "The suite, and what's new", "var(--c-hi)", "✺", 0, "") +
        (this.d.addresses && this.d.addresses.length ? btn(ADDRESSES, "All addresses", "Every web address, to open or copy", "var(--c-hi)", "⌖", 1, "") : "") +
        `<div class="label">The apps</div>` +
        this.d.apps
          .map((a, i) => {
            const fresh = recent(a, 2).length;
            const extra = a.id === this.here ? `<span class="here">Here</span>` : fresh ? `<span class="fresh" title="Changed in the last two days"></span>` : "";
            return btn(a.id, a.name, a.tagline, a.colour, a.glyph, i + 1, extra);
          })
          .join("");
      paint(rail);
    }

    drawPage() {
      const page = this.pageEl();
      if (!page || !this.d) return;
      const app = this.d.apps.find((a) => a.id === this.app);
      const panel = this.root.querySelector(".panel");
      panel.style.setProperty("--app", app && !this.query ? app.colour : "var(--c-hi)");
      for (const b of this.root.querySelectorAll(".rail button")) b.setAttribute("aria-current", String(!this.query && b.dataset.app === this.app));
      // The app showing in the strip along the top (phones) stays in view
      const on = this.root.querySelector('.rail button[aria-current="true"]');
      if (on && on.scrollIntoView && matchMedia("(max-width: 760px)").matches) on.scrollIntoView({ block: "nearest", inline: "nearest" });
      this.toc = null;
      const body = this.query ? this.searchPage() : app ? this.appPage(app) : this.app === ADDRESSES ? this.addressesPage() : this.startPage();
      const wide = !app || this.query || this.tab === "history";
      const toc = this.toc && this.toc.length > 1 ? this.toc : null;
      page.innerHTML = `<div class="layout${wide && !toc ? " wide" : ""}${toc ? " has-toc" : ""}"><article class="read">${this.crumbs(app)}${body}</article>${
        toc ? `<aside class="toc-side" aria-label="On this page"><span class="toc-title">On this page</span>${this.tocList(toc)}</aside>` : ""
      }</div>`;
      paint(page);
      if (!this.query) {
        page.style.scrollBehavior = "auto";
        page.scrollTop = 0;
        page.style.scrollBehavior = "";
      }
      this.spy();
    }

    // Manual › Calendar › Guide (each step back is a link)
    crumbs(app) {
      const sep = '<span class="sep" aria-hidden="true">›</span>';
      const home = this.app || this.query ? `<button type="button" data-app="">Manual</button>` : `<span aria-current="page">Manual</span>`;
      let rest = "";
      if (this.query) rest = `${sep}<span aria-current="page">Search</span>`;
      else if (app) rest = `${sep}${this.tab === "guide" ? `<span>${esc(app.name)}</span>` : `<button type="button" data-app="${app.id}" data-tab="guide">${esc(app.name)}</button>`}${sep}<span aria-current="page">${esc(tabName(this.tab))}</span>`;
      else if (this.app === ADDRESSES) rest = `${sep}<span aria-current="page">All addresses</span>`;
      else rest = `${sep}<span>Start here</span>`;
      return `<nav class="crumbs" aria-label="Where you are">${home}${rest}</nav>`;
    }

    // The "On this page" list (beside the page, and folded up above it on a narrow screen)
    tocList(toc) {
      return `<ol class="toc-list">${toc
        .map(
          (c) =>
            `<li><button type="button" data-goto="${c.id}">${c.title}</button></li>${c.subs.length > 1 ? c.subs.map((s) => `<li class="sub"><button type="button" data-goto="${s.id}" data-parent="${c.id}">${s.title}</button></li>`).join("") : ""}`,
        )
        .join("")}</ol>`;
    }
    tocBox(toc) {
      return `<details class="toc-box"><summary>On this page<small>${toc.length} sections</small></summary>${this.tocList(toc)}</details>`;
    }
    // Which heading you're reading: lit in the list
    spy() {
      const page = this.pageEl();
      if (!page) return;
      const top = this.root.querySelector(".to-top");
      if (top) top.classList.toggle("show", page.scrollTop > 600);
      if (!this.toc) return;
      const line = page.getBoundingClientRect().top + 90;
      let cur = "";
      let parent = "";
      for (const c of this.toc) {
        const el = this.root.getElementById(c.id);
        if (!el || el.getBoundingClientRect().top > line) break;
        cur = c.id;
        parent = "";
        for (const s of c.subs) {
          const h = this.root.getElementById(s.id);
          if (!h || h.getBoundingClientRect().top > line) break;
          cur = s.id;
          parent = c.id;
        }
      }
      if (!cur && this.toc[0]) cur = this.toc[0].id;
      for (const b of this.root.querySelectorAll(".toc-list button")) {
        const v = b.dataset.goto === cur ? "true" : parent && b.dataset.goto === parent ? "location" : "false";
        if (b.getAttribute("aria-current") !== v) b.setAttribute("aria-current", v);
      }
    }

    startPage() {
      const d = this.d;
      const s = d.suite;
      // The newest changes across the suite (each project's history once)
      const repos = new Set();
      const feed = [];
      for (const a of d.apps) {
        if (repos.has(a.repo)) continue;
        repos.add(a.repo);
        for (const c of recent(a, d.recentDays)) feed.push({ c, a });
      }
      feed.sort((x, y) => y.c.date.localeCompare(x.c.date));
      const cards = d.apps
        .map((a, i) => {
          const last = lastChange(a);
          return `<button type="button" class="card-app" data-app="${a.id}" data-v="--c:${a.colour};--i:${i}"><span class="top-row"><span class="planet" aria-hidden="true">${a.glyph}</span><b>${esc(a.name)}</b></span><p>${esc(a.tagline)}</p><small>${esc(a.where)}${last ? ` · changed ${ago(last)}` : ""}</small></button>`;
        })
        .join("");
      return `
        <div class="hero"><span class="big" data-v="--c:var(--c-hi)" aria-hidden="true">✺</span><div class="who"><div class="kicker">Manual</div><h1>The Nova Agent</h1><p>${esc((s && s.tagline) || "Every part of Nova Agent: how to use it, how it's built, its story so far and what's changing.")}</p>
          <div class="pills"><span class="pill">${d.apps.length} apps</span><span class="pill">Updated ${esc(ago(d.built))}</span><span class="pill">Press <kbd>?</kbd> in any panel to open this</span></div></div></div>
        <div class="section-title">The apps</div>
        <div class="apps">${cards}</div>
        ${d.addresses && d.addresses.length ? `<button type="button" class="addr-more" data-app="${ADDRESSES}"><span aria-hidden="true">⌖</span> All addresses: every web address in the suite, to open or copy</button>` : ""}
        ${feed.length ? `<div class="section-title">This week across the suite</div>${this.timeline(feed.slice(0, 30), true)}` : ""}
        ${s && s.chapters.length ? `<div class="section-title">How it all fits together</div>${s.intro ? `<div class="prose intro">${s.intro}</div>` : ""}${s.chapters.map((c, i) => this.chapter(c, i)).join("")}` : ""}`;
    }

    // All addresses: every web address in the suite (web/shared/addresses.js, through manual-data.js)
    addressesPage() {
      const groups = this.d.addresses || [];
      return `
        <div class="hero"><span class="big" data-v="--c:var(--c-hi)" aria-hidden="true">⌖</span><div class="who"><div class="kicker">Manual</div><h1>All addresses</h1><p>Every part of Nova is online at nova.novacane.co.uk. Copy an address, or open it. (Admins see a few more in Portal → Settings → Addresses.)</p></div></div>
        ${groups
          .map(
            (g) => `<div class="section-title">${esc(g.title)}</div>${g.note ? `<p class="addr-note">${esc(g.note)}</p>` : ""}
            <ul class="addr-list">${g.items
              .map(
                (i) => `<li class="addr"><div class="addr-words"><b>${esc(i.name)}</b><span>${esc(i.what)}</span></div>
                  <div class="code"><button type="button" class="copy" aria-label="Copy ${esc(i.name)}">Copy</button><pre>${esc(i.code || i.url)}</pre></div>
                  ${i.code ? "" : `<a class="addr-open" href="${esc(i.url)}" target="_blank" rel="noopener">Open ${esc(i.name)} ↗</a>`}</li>`,
              )
              .join("")}</ul>`,
          )
          .join("")}`;
    }

    appPage(a) {
      const tabs = TABS.map(([id, label]) => {
        const n = id === "new" ? recent(a, this.d.recentDays).length + (a.history.workCount ? 1 : 0) : id === "built" ? a.built.length : 0;
        if (id === "built" && !a.built.length) return "";
        return `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.tab === id}">${label}${n && id === "new" ? `<span class="n">${n}</span>` : ""}</button>`;
      }).join("");
      if (this.tab === "built" && !a.built.length) this.tab = "guide";
      const last = lastChange(a);
      const hero = `<div class="hero"><span class="big" aria-hidden="true">${a.glyph}</span><div class="who"><div class="kicker">${esc(a.where)}</div><h1>${esc(a.name)}</h1><p>${esc(a.tagline)}</p>
        <div class="pills">${a.id === this.here ? `<span class="pill here">You're here</span>` : ""}${a.links
          .filter(() => a.id !== this.here)
          .map(([label, href]) => `<a class="pill go" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)} ${ICON.go}</a>`)
          .join("")}${last ? `<span class="pill">Changed ${esc(ago(last))}</span>` : ""}<span class="pill">${a.history.total} changes since ${esc(a.history.first ? shortDay(a.history.first) : "the start")}</span></div></div></div>`;
      let body = "";
      if (this.tab === "guide") body = this.chapters(a.guide, a.intro);
      else if (this.tab === "built") body = `<p class="note">From ${esc(a.name)}'s own write-up, in <code>${esc(a.repo)}</code>.</p>${this.chapters(a.built, "")}`;
      else if (this.tab === "history") body = this.history(a);
      else body = this.news(a);
      return `${hero}<div class="tabs" role="tablist" aria-label="${esc(a.name)}">${tabs}</div>${body}${this.pager(a)}`;
    }

    // The app before and after this one in the list
    pager(a) {
      const apps = this.d.apps;
      const i = apps.indexOf(a);
      const prev = apps[i - 1];
      const next = apps[i + 1];
      const one = (x, cls, word) => `<button type="button" class="${cls}" data-app="${x.id}" data-v="--c:${x.colour}"><small>${word}</small><b>${cls === "prev" ? "← " : ""}${esc(x.name)}${cls === "next" ? " →" : ""}</b></button>`;
      return prev || next ? `<nav class="pager" aria-label="Other apps">${prev ? one(prev, "prev", "Previous app") : ""}${next ? one(next, "next", "Next app") : ""}</nav>` : "";
    }

    chapters(list, intro) {
      if (!list.length && !intro) return `<div class="empty">Nothing written about this yet.</div>`;
      const html = list.map((c, i) => this.chapter(c, i)).join("");
      const toc = this.toc && this.toc.length > 1 ? this.tocBox(this.toc) : "";
      return `${intro ? `<div class="prose intro">${intro}</div>` : ""}${toc}${html}`;
    }
    // One chapter: its sub-headings get their own places (for the list), and code gets a Copy button
    chapter(c, i) {
      const subs = [];
      const html = c.html
        .replace(/<h4>([\s\S]*?)<\/h4>/g, (m, inner) => {
          const id = `${c.id}--${subs.length + 1}`;
          subs.push({ id, title: inner.replace(/<[^>]+>/g, "") });
          return `<h4 id="${id}">${inner}</h4>`;
        })
        .replace(/<pre>/g, '<div class="code"><button type="button" class="copy" aria-label="Copy this">Copy</button><pre>')
        .replace(/<\/pre>/g, "</pre></div>");
      if (!this.toc) this.toc = [];
      this.toc.push({ id: c.id, title: esc(c.title), subs });
      return `<section class="chapter" id="${c.id}" data-v="--i:${Math.min(i, 8)}"><h3>${esc(c.title)}</h3><div class="prose">${html}</div></section>`;
    }

    history(a) {
      const h = a.history;
      const first = h.first ? Date.parse(h.first) : 0;
      const days = first ? Math.max(1, Math.round((Date.now() - first) / DAY)) : 0;
      const busiest = {};
      for (const c of h.commits) busiest[c.date.slice(0, 10)] = (busiest[c.date.slice(0, 10)] || 0) + 1;
      const top = Object.entries(busiest).sort((x, y) => y[1] - x[1])[0];
      return `<div class="stats">
          <div class="stat"><b>${h.total}</b><span>changes saved</span></div>
          <div class="stat"><b>${first ? esc(shortDay(h.first)) : "–"}</b><span>the first one${days ? `, ${days} day${days === 1 ? "" : "s"} ago` : ""}</span></div>
          <div class="stat"><b>${top ? top[1] : 0}</b><span>on its busiest day${top ? ` (${esc(shortDay(top[0]))})` : ""}</span></div>
          <div class="stat"><b>${h.workCount}</b><span>file${h.workCount === 1 ? "" : "s"} changed, not saved yet</span></div>
        </div>
        ${a.shared ? `<p class="note">${esc(a.shared)}</p>` : ""}
        ${h.commits.length ? this.timeline(h.commits.map((c) => ({ c, a })), false) : `<div class="empty">No history yet.</div>`}
        ${h.total > h.commits.length ? `<p class="note">The latest ${h.commits.length} of ${h.total} changes.</p>` : ""}`;
    }
    timeline(items, showApp) {
      let out = "";
      let day = "";
      let i = 0;
      for (const { c, a } of items) {
        const d = c.date.slice(0, 10);
        if (d !== day) {
          if (day) out += "</div>";
          day = d;
          out += `<div class="day">${esc(dayOf(c.date))}</div><div class="line">`;
        }
        out += `<div class="commit" data-v="--i:${Math.min(i++, 12)};--app:${a.colour}"><div class="s">${esc(c.subject)}</div><div class="m">${showApp ? `<span class="tag" data-v="--c:${a.colour}">${esc(a.repo === "nb/novacane-worker" ? "Nova Bot & Portal" : a.name)}</span>` : ""}<span>${esc(timeOf(c.date))}</span><code>${esc(c.hash)}</code></div>${c.body ? `<details><summary>More about this change</summary><pre>${esc(c.body)}</pre></details>` : ""}</div>`;
      }
      return day ? out + "</div>" : out;
    }

    news(a) {
      const h = a.history;
      const fresh = recent(a, this.d.recentDays);
      const wip = h.workCount
        ? `<div class="wip"><h3>Being worked on right now</h3><p>${h.workCount} file${h.workCount === 1 ? "" : "s"} changed and not saved to its history yet${h.workStat ? ` (${esc(h.workStat)})` : ""}, as of ${esc(ago(this.d.built))}.</p><div class="files">${h.work.map((f) => `<span class="${f.state}" title="${f.state}">${esc(f.file)}</span>`).join("")}${h.workCount > h.work.length ? `<span>+${h.workCount - h.work.length} more</span>` : ""}</div></div>`
        : "";
      const notes = a.news.length ? a.news.map((c, i) => this.chapter(c, i)).join("") : "";
      const list = fresh.length ? `<div class="section-title">The last ${this.d.recentDays} days</div>${this.timeline(fresh.map((c) => ({ c, a })), false)}` : `<p class="note">Nothing new in the last ${this.d.recentDays} days${lastChange(a) ? `: the last change was ${esc(ago(lastChange(a)))}` : ""}.</p>`;
      return wip + notes + list;
    }

    searchPage() {
      const typed = this.query.toLowerCase().split(/\s+/).filter(Boolean);
      // Short words ("a", "to") don't count unless they're all there is
      const words = typed.filter((w) => w.length > 2).length ? typed.filter((w) => w.length > 2) : typed;
      const need = Math.ceil(words.length / 2);
      // How many of the words it mentions (at least half of them, to count at all)
      const score = (text) => {
        const n = words.filter((w) => text.includes(w)).length;
        return n >= need ? n : 0;
      };
      const hits = [];
      const add = (a, tab, c, text, label) => {
        const t = text.toLowerCase();
        const title = c.title.toLowerCase();
        const s = score(title + " " + t);
        if (s > 0) hits.push({ a, tab, c, text, label, rank: score(title) * 3 + s });
      };
      const d = this.d;
      if (d.suite) for (const c of d.suite.chapters) add(null, "", c, c.text, "The Nova Agent");
      const repos = new Set();
      for (const a of d.apps) {
        for (const c of a.guide) add(a, "guide", c, c.text, `${a.name} · Guide`);
        for (const c of a.built) add(a, "built", c, c.text, `${a.name} · How it's built`);
        for (const c of a.news) add(a, "new", c, c.text, `${a.name} · What's new`);
        if (!repos.has(a.repo)) {
          repos.add(a.repo);
          for (const c of a.history.commits) add(a, "history", { id: "", title: c.subject }, c.body || "", `${a.repo === "nb/novacane-worker" ? "Nova Bot & Portal" : a.name} · History · ${shortDay(c.date)}`);
        }
      }
      hits.sort((x, y) => y.rank - x.rank);
      if (!hits.length) return `<div class="empty"><div>Nothing in the manual mentions <b>${esc(this.query)}</b>.<br>Try fewer or other words.</div></div>`;
      const mark = (s) => {
        let out = esc(s);
        for (const w of words) out = out.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[&<>"']/g, (c) => esc(c))})`, "gi"), "<mark>$1</mark>");
        return out;
      };
      const snippet = (text) => {
        const t = text.toLowerCase();
        const at = Math.max(0, Math.min(...words.map((w) => (t.indexOf(w) < 0 ? Infinity : t.indexOf(w)))) - 70);
        const cut = text.slice(at, at + 220);
        return (at ? "…" : "") + cut + (at + 220 < text.length ? "…" : "");
      };
      return `<div class="section-title">${hits.length} result${hits.length === 1 ? "" : "s"} for “${esc(this.query)}”</div><div class="hits">${hits
        .slice(0, 40)
        .map(
          (h, i) =>
            `<button type="button" class="hit" data-app="${h.a ? h.a.id : ""}" data-tab="${h.tab}" data-goto="${h.c.id}" data-v="--c:${h.a ? h.a.colour : "var(--c-hi)"};--i:${Math.min(i, 12)}"><span class="where">${esc(h.label)}</span><b>${mark(h.c.title)}</b>${h.text ? `<span>${mark(snippet(h.text))}</span>` : ""}</button>`,
        )
        .join("")}</div>`;
    }

    click(e) {
      const link = e.target.closest("a.pill.go");
      if (link && this.root.contains(link)) {
        this.follow(e, link);
        return;
      }
      const el = e.target.closest("button");
      if (!el || !this.root.contains(el) || el.classList.contains("x")) return;
      const d = el.dataset;
      if (d.nav === "back") return this.back();
      if (d.nav === "forward") return this.forward();
      if (d.nav === "top") {
        this.pageEl().scrollTo({ top: 0, behavior: still() ? "auto" : "smooth" });
        return;
      }
      if (el.classList.contains("copy")) return this.copy(el);
      if (d.app !== undefined) {
        // To an app (from the list, a card, a search result, the trail or the next/previous app)
        sfx("tap");
        this.go({ app: d.app, tab: d.tab || "guide", query: "" }, d.goto);
        return;
      }
      if (d.tab) {
        sfx("tap");
        this.go({ tab: d.tab });
        return;
      }
      if (d.goto) {
        // From "On this page": on a narrow screen the list folds away again so the text shows
        const box = el.closest(".toc-box");
        if (box) box.open = false;
        this.goTo(d.goto);
      }
    }
    // "Open Calendar" (and the like): inside Nova Agent, the panel opens right here instead of in a
    // new tab (the links name the studio computer, which a phone online can't reach)
    follow(e, a) {
      let host = null;
      try {
        host = window.NovaAgent || (window.top !== window && window.top.NovaAgent) || null;
      } catch (err) {}
      if (!host || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const url = new URL(a.href, location.href);
      const path = url.pathname + url.search + url.hash;
      if (path === "/" || url.pathname.startsWith("/agent")) {
        e.preventDefault();
        this.close(true);
        if (host.agent) host.agent();
      } else if (host.open && host.open(path)) {
        e.preventDefault();
        this.close(true);
      }
    }
    copy(btn) {
      const pre = btn.nextElementSibling;
      if (!pre || !navigator.clipboard) return;
      navigator.clipboard.writeText(pre.textContent).then(
        () => {
          btn.textContent = "Copied";
          setTimeout(() => (btn.textContent = "Copy"), 1400);
        },
        () => {},
      );
    }
    goTo(id) {
      requestAnimationFrame(() => {
        const target = id && this.root.getElementById(id);
        if (!target) return;
        target.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });
        target.classList.remove("flash");
        void target.offsetWidth;
        target.classList.add("flash");
      });
    }
  }

  let shared = null;
  function sheet() {
    if (!shared) {
      shared = new CSSStyleSheet();
      let starCss = "";
      for (let i = 0; i < 18; i++) starCss += `.sky i:nth-child(${i + 1}) { left: ${(i * 37 + 11) % 100}%; top: ${(i * 53 + 7) % 100}%; animation-delay: ${(i % 7) * 0.45}s; }\n`;
      shared.replaceSync(CSS + starCss);
    }
    return shared;
  }

  customElements.define("nova-manual", NovaManual);

  // A button on every page: the page's own, or a floating one while the page's own
  // can't be seen (a header hidden behind a sign-in screen, say)
  const shown = (m) => (m.checkVisibility ? m.checkVisibility() : m.getClientRects().length > 0);
  let floater = null;
  function ensure() {
    const placed = [...document.querySelectorAll("nova-manual")].filter((m) => m !== floater);
    const visible = placed.find(shown);
    if (floater) floater.hidden = Boolean(visible) && !floater.isOpen;
    if (visible) return visible;
    if (!floater) {
      floater = document.createElement("nova-manual");
      floater.setAttribute("floating", "");
      document.body.appendChild(floater);
      setInterval(ensure, 1500);
    }
    floater.hidden = false;
    return floater;
  }
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  function start() {
    ensure();
    // ? anywhere (except while typing) opens it
    document.addEventListener("keydown", (e) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      let el = document.activeElement;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
      if (typing(el)) return;
      const m = ensure();
      if (m.isOpen) return;
      e.preventDefault();
      m.open();
    });
    if (/^#nova-manual\b/.test(location.hash)) {
      const [, app, tab] = location.hash.split(/[=/]/);
      ensure().open(app, tab);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  // Inside an app (a frame in Nova Agent), Esc closes Nova Agent's manual when it's the one open
  // (the keys go to the app, not to Nova Agent, while you're in it). First, before the app's own Esc.
  if (window.parent !== window) {
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      try {
        const up = window.parent.NovaManual;
        if (up && up.isOpen && up.isOpen()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          up.close();
        }
      } catch (err) {} // (not Nova Agent's own page above)
    }, true);
  }

  window.NovaManual = {
    open(app, tab) {
      ensure().open(app, tab);
    },
    close() {
      for (const m of all) m.close(true);
    },
    isOpen() {
      return [...all].some((m) => m.isOpen);
    },
  };
})();
