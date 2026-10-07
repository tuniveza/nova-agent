// Nova Manual: how every Nova suite app works, how it's built, its history and what's
// changing, in one panel on every app.
//
//   <script src="/portal/manual.js" defer></script>        (on Nova Bot's worker and in Nova Agent)
//   <script src="js/nova-manual.js" defer></script>         (Nova Notes, Calendar, Observatory: a copy)
//   <nova-manual></nova-manual>                              (optional: put the button somewhere yourself;
//                                                            without one, a floating button appears)
// It opens with the button, the ? key, or #nova-manual in the address, on the page for the
// app you're in. window.NovaManual.open("notes", "built") opens any app's page from code.
// The content (manual-data.js, next to this file) is made by scripts/build-manual.mjs from
// the apps' READMEs and git history, and only loads when the manual is first opened.
// Colours come from the page's theme: --nm-* if the app sets them, else the suite's names
// (--hi, --accent...), else the Nova suite's magenta. A floating button sits --nm-bottom
// from the bottom (16px) and --nm-side from the left. Calm motion stills it.
(() => {
  "use strict";
  if (customElements.get("nova-manual")) return;

  const SCRIPT = document.currentScript;
  const DATA_SRC = SCRIPT && SCRIPT.src ? SCRIPT.src.replace(/manual(\.js)(\?.*)?$/, "manual-data$1") : "/portal/manual-data.js";
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
    if (p.startsWith("/app")) return "hub";
    if (p.startsWith("/portal")) return "portal";
    if (p.startsWith("/admin")) return "bot";
    if (/^454\d$/.test(location.port)) return "agent";
    return "";
  }

  const TABS = [
    ["guide", "Guide"],
    ["built", "How it's built"],
    ["history", "History"],
    ["new", "What's new"],
  ];

  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DAY = 864e5;
  const dayOf = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  function ago(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / DAY);
    return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
  }
  const recent = (app, days) => app.history.commits.filter((c) => Date.now() - Date.parse(c.date) < days * DAY);
  const lastChange = (app) => (app.history.commits[0] ? app.history.commits[0].date : "");

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
@media (max-width: 560px) { :host([floating]) .open { padding: 0 5px; } :host([floating]) .open .label { display: none; } }

/* ---- The panel ---- */
.panel {
  position: fixed; inset: 0; margin: auto; width: min(1120px, calc(100vw - 32px)); height: min(820px, calc(100dvh - 32px)); max-width: none; max-height: none; padding: 0;
  display: grid; grid-template-rows: auto 1fr; overflow: hidden; border-radius: 26px; color: var(--c-text); font-family: var(--f-b);
  background:
    radial-gradient(90% 60% at 15% -10%, color-mix(in srgb, var(--app) 26%, transparent), transparent 60%),
    radial-gradient(70% 50% at 100% 110%, color-mix(in srgb, var(--c-accent-2) 30%, transparent), transparent 65%),
    linear-gradient(180deg, color-mix(in srgb, var(--c-panel) 97%, transparent), color-mix(in srgb, var(--c-deep) 99%, transparent));
  border: 1px solid color-mix(in srgb, var(--app) 35%, transparent);
  box-shadow: 0 40px 100px -30px rgba(0,0,0,.85), 0 0 0 1px rgba(255,255,255,.04) inset, 0 0 80px -40px var(--app);
  animation: panel-in .5s cubic-bezier(.2,.9,.3,1.1) both; transition: border-color .4s;
}
.panel[hidden], .panel[popover]:not(:popover-open) { display: none; }
.panel:not([hidden]):not([popover]) { z-index: 2147483000; }
.panel::backdrop { background: color-mix(in srgb, #000 55%, transparent); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.panel.out { animation: panel-out .22s ease-in both; }
.sky { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sky i { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #fff; opacity: .18; animation: twinkle 3.4s ease-in-out infinite; }

.top { position: relative; display: flex; align-items: center; gap: 14px; padding: 16px 18px 14px 22px; border-bottom: 1px solid color-mix(in srgb, var(--c-hi) 16%, transparent); }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.book { position: relative; width: 42px; height: 42px; flex: none; border-radius: 14px; display: grid; place-items: center; color: var(--c-on-accent);
  background: linear-gradient(135deg, var(--c-accent), var(--c-accent-2)); box-shadow: 0 10px 24px -10px var(--c-accent); }
.book svg { width: 22px; height: 22px; }
.kicker { font-size: 10px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; color: var(--c-hi); }
h2 { margin: 2px 0 0; font-family: var(--f-d); font-weight: 900; font-size: 21px; line-height: 1; color: var(--c-bright); letter-spacing: .01em; white-space: nowrap; }
.search { flex: 1; display: flex; align-items: center; gap: 8px; max-width: 460px; margin-left: auto; height: 40px; padding: 0 12px; border-radius: 13px;
  border: 1px solid color-mix(in srgb, var(--c-hi) 22%, transparent); background: color-mix(in srgb, var(--c-void) 55%, transparent); transition: border-color .2s, box-shadow .2s; }
.search:focus-within { border-color: var(--c-hi); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c-hi) 18%, transparent); }
.search svg { flex: none; color: var(--c-muted); }
.search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; font-size: 14px; color: var(--c-bright); }
.search input::placeholder { color: var(--c-muted); }
.search kbd { font-family: var(--f-m); font-size: 11px; color: var(--c-muted); border: 1px solid color-mix(in srgb, var(--c-muted) 40%, transparent); border-radius: 6px; padding: 1px 6px; }
.x { flex: none; width: 40px; height: 40px; border-radius: 13px; border: 1px solid color-mix(in srgb, var(--c-hi) 22%, transparent); background: color-mix(in srgb, var(--c-panel) 70%, transparent); display: grid; place-items: center; transition: transform .2s, border-color .2s; }
.x:hover { transform: rotate(90deg); border-color: var(--c-hi); }
.x:focus-visible, .rail button:focus-visible, .tabs button:focus-visible, .toc button:focus-visible, .page a:focus-visible, .card-app:focus-visible, .hit:focus-visible { outline: 2px solid var(--c-hi); outline-offset: 2px; }

.body { position: relative; display: grid; grid-template-columns: 236px 1fr; min-height: 0; }
.rail { display: flex; flex-direction: column; gap: 4px; padding: 14px 10px 14px 14px; overflow-y: auto; scrollbar-width: thin; border-right: 1px solid color-mix(in srgb, var(--c-hi) 12%, transparent); }
.rail .label { margin: 10px 8px 4px; font-size: 9.5px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; color: var(--c-muted); }
.rail button { --c: var(--c-hi); display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 1px solid transparent; border-radius: 14px; background: none; text-align: left; transition: background .2s, border-color .2s, transform .2s; animation: rise .45s cubic-bezier(.2,.9,.3,1.1) both; }
.rail button:hover { background: color-mix(in srgb, var(--c) 10%, transparent); transform: translateX(2px); }
.rail button[aria-current="true"] { background: color-mix(in srgb, var(--c) 16%, var(--c-panel)); border-color: color-mix(in srgb, var(--c) 45%, transparent); }
.rail .planet { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; color: #fff;
  background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 50%, color-mix(in srgb, var(--c) 40%, #000)); box-shadow: 0 0 12px -3px var(--c); }
.rail .words { display: grid; min-width: 0; line-height: 1.15; }
.rail .words b { font-family: var(--f-d); font-weight: 800; font-size: 13px; color: var(--c-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail .words small { font-size: 11px; color: var(--c-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail .here { margin-left: auto; flex: none; font-size: 8.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; color: var(--c-deep); background: var(--c); }
.rail .fresh { margin-left: auto; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--c-ok); box-shadow: 0 0 8px var(--c-ok); }

.page { position: relative; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; padding: 22px 28px 40px; scroll-behavior: smooth; }
.loading, .empty { display: grid; place-items: center; gap: 10px; min-height: 60%; text-align: center; color: var(--c-muted); }
.loading .ring { width: 46px; height: 46px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--c-hi) 25%, transparent); border-top-color: var(--c-hi); animation: spin 1s linear infinite; }

/* An app's page */
.hero { position: relative; display: flex; gap: 20px; align-items: center; padding: 6px 0 18px; }
.big { --c: var(--app); position: relative; flex: none; width: 92px; height: 92px; border-radius: 50%; display: grid; place-items: center; font-size: 34px; color: #fff;
  background: radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--c) 65%, #fff), var(--c) 46%, color-mix(in srgb, var(--c) 35%, #000) 100%);
  box-shadow: 0 0 40px -6px color-mix(in srgb, var(--c) 70%, transparent), inset -10px -12px 24px rgba(0,0,0,.35); animation: planet .8s cubic-bezier(.2,.9,.3,1.2) both, float 7s ease-in-out infinite .8s; }
.big::before { content: ""; position: absolute; inset: -14px -22px; border-radius: 50%; border: 1.5px solid color-mix(in srgb, var(--c) 45%, transparent); transform: rotate(-18deg) scaleY(.32); }
.big::after { content: ""; position: absolute; width: 6px; height: 6px; border-radius: 50%; background: var(--c-bright); box-shadow: 0 0 8px var(--c); top: 4px; left: 50%; transform-origin: 0 42px; animation: spin 5s linear infinite; }
.hero .who { min-width: 0; }
.hero h1 { margin: 4px 0 6px; font-family: var(--f-d); font-weight: 900; font-size: clamp(26px, 3.4vw, 38px); line-height: 1.02; color: var(--c-bright); letter-spacing: .005em; }
.hero p { margin: 0; font-size: 15px; line-height: 1.45; color: var(--c-text); max-width: 64ch; }
.pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--app) 35%, transparent); color: var(--c-text); background: color-mix(in srgb, var(--c-void) 35%, transparent); text-decoration: none; }
.pill.go { border: 0; color: var(--c-on-accent); background: linear-gradient(90deg, var(--c-accent), var(--c-accent-2)); box-shadow: 0 6px 16px -8px var(--c-accent); transition: transform .2s; }
.pill.go:hover { transform: translateY(-1px); }
.pill.here { border-color: transparent; color: var(--c-deep); background: var(--app); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 10px; }

.tabs { position: sticky; top: -22px; z-index: 2; display: flex; gap: 4px; padding: 10px 0; margin: 0 0 10px; background: linear-gradient(180deg, color-mix(in srgb, var(--c-panel) 96%, transparent) 70%, transparent); overflow-x: auto; scrollbar-width: none; }
.tabs button { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--app) 22%, transparent); background: color-mix(in srgb, var(--c-panel) 60%, transparent); font-size: 13px; font-weight: 600; color: var(--c-muted); transition: color .2s, background .2s, border-color .2s; }
.tabs button:hover { color: var(--c-bright); }
.tabs button[aria-selected="true"] { color: var(--c-on-accent); border-color: transparent; background: linear-gradient(90deg, color-mix(in srgb, var(--app) 70%, var(--c-accent)), var(--c-accent-2)); box-shadow: 0 8px 20px -12px var(--app); }
.tabs .n { font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--c-void) 45%, transparent); }

.toc { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 16px; }
.toc button { font-size: 12px; padding: 5px 11px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--app) 28%, transparent); background: none; color: var(--c-text); transition: background .2s, border-color .2s; }
.toc button:hover { background: color-mix(in srgb, var(--app) 14%, transparent); border-color: var(--app); }

.chapter { position: relative; margin: 0 0 14px; padding: 18px 22px 10px; border-radius: 20px; border: 1px solid color-mix(in srgb, var(--app) 18%, transparent); background: color-mix(in srgb, var(--c-panel) 62%, transparent); animation: rise .5s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 45ms); scroll-margin-top: 64px; }
.chapter.flash { animation: flash 1.6s ease-out; }
.chapter > h3 { margin: 0 0 10px; font-family: var(--f-d); font-weight: 900; font-size: 19px; color: var(--c-bright); display: flex; align-items: center; gap: 10px; }
.chapter > h3::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--app); box-shadow: 0 0 10px var(--app); flex: none; }
.intro { margin: 0 0 16px; }
.prose { font-size: 14.5px; line-height: 1.62; }
.prose p { margin: 0 0 .75em; }
.prose h4, .prose h5, .prose h6 { margin: 1.1em 0 .4em; font-family: var(--f-d); font-weight: 800; font-size: 15px; color: var(--c-bright); }
.prose h5, .prose h6 { font-size: 13.5px; color: var(--c-gold); }
.prose ul, .prose ol { margin: .2em 0 .8em; padding-left: 1.3em; }
.prose li { margin: .25em 0; }
.prose li.sub { margin-left: 1.2em; }
.prose li::marker { color: var(--app); }
.prose strong { color: var(--c-bright); }
.prose a { color: var(--c-gold); text-decoration-color: color-mix(in srgb, var(--c-gold) 45%, transparent); text-underline-offset: 3px; }
.prose code { font-family: var(--f-m); font-size: .86em; padding: 1px 5px; border-radius: 6px; background: color-mix(in srgb, var(--c-void) 60%, transparent); color: var(--c-bright); border: 1px solid color-mix(in srgb, var(--app) 16%, transparent); }
.prose pre { margin: .4em 0 1em; padding: 12px 14px; border-radius: 14px; overflow-x: auto; background: color-mix(in srgb, var(--c-void) 75%, transparent); border: 1px solid color-mix(in srgb, var(--app) 18%, transparent); scrollbar-width: thin; }
.prose pre code { padding: 0; border: 0; background: none; font-size: 12.5px; line-height: 1.55; white-space: pre; }
.prose blockquote { margin: .4em 0 1em; padding: 8px 14px; border-left: 3px solid var(--app); border-radius: 0 12px 12px 0; background: color-mix(in srgb, var(--app) 8%, transparent); color: var(--c-text); }
.prose .table { overflow-x: auto; margin: .4em 0 1em; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--app) 18%, transparent); }
.prose table { width: 100%; border-collapse: collapse; font-size: 13px; }
.prose th { text-align: left; font-family: var(--f-d); font-weight: 800; font-size: 12px; letter-spacing: .02em; color: var(--c-bright); background: color-mix(in srgb, var(--app) 12%, transparent); }
.prose th, .prose td { padding: 8px 12px; vertical-align: top; border-bottom: 1px solid color-mix(in srgb, var(--app) 10%, transparent); }
.prose tr:last-child td { border-bottom: 0; }

/* History: a timeline */
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 18px; }
.stat { padding: 14px 16px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--app) 20%, transparent); background: color-mix(in srgb, var(--c-panel) 60%, transparent); animation: rise .45s cubic-bezier(.2,.9,.3,1.1) both; }
.stat b { display: block; font-family: var(--f-d); font-weight: 900; font-size: 24px; color: var(--c-bright); line-height: 1.1; }
.stat span { font-size: 11.5px; color: var(--c-muted); }
.day { margin: 18px 0 6px 26px; font-family: var(--f-d); font-weight: 800; font-size: 13px; letter-spacing: .02em; color: var(--c-gold); }
.line { position: relative; padding-left: 26px; }
.line::before { content: ""; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; border-radius: 2px; background: linear-gradient(180deg, var(--app), color-mix(in srgb, var(--app) 10%, transparent)); }
.commit { position: relative; margin: 0 0 8px; padding: 10px 14px; border-radius: 14px; border: 1px solid color-mix(in srgb, var(--app) 14%, transparent); background: color-mix(in srgb, var(--c-panel) 55%, transparent); animation: rise .4s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 30ms); }
.commit::before { content: ""; position: absolute; left: -23px; top: 15px; width: 10px; height: 10px; border-radius: 50%; background: var(--c-deep); border: 2px solid var(--app); box-shadow: 0 0 8px color-mix(in srgb, var(--app) 60%, transparent); }
.commit .s { font-size: 14px; font-weight: 600; color: var(--c-bright); line-height: 1.35; }
.commit .m { margin-top: 3px; font-size: 11px; color: var(--c-muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.commit .m code { font-family: var(--f-m); font-size: 10.5px; padding: 0 5px; border-radius: 5px; background: color-mix(in srgb, var(--c-void) 60%, transparent); }
.commit .m .tag { font-weight: 700; color: var(--c-deep); background: var(--c, var(--app)); padding: 0 6px; border-radius: 999px; font-size: 9.5px; letter-spacing: .06em; text-transform: uppercase; }
.commit details { margin-top: 6px; }
.commit summary { cursor: pointer; font-size: 11.5px; color: var(--c-gold); list-style: none; }
.commit summary::-webkit-details-marker { display: none; }
.commit summary::before { content: "▸ "; }
.commit details[open] summary::before { content: "▾ "; }
.commit pre { margin: 6px 0 0; white-space: pre-wrap; font-family: var(--f-b); font-size: 12.5px; line-height: 1.5; color: var(--c-text); }
.wip { margin: 0 0 16px; padding: 16px 18px; border-radius: 20px; border: 1px dashed color-mix(in srgb, var(--c-gold) 55%, transparent); background: color-mix(in srgb, var(--c-gold) 6%, transparent); }
.wip h3 { margin: 0 0 4px; font-family: var(--f-d); font-weight: 900; font-size: 17px; color: var(--c-gold); }
.wip p { margin: 0 0 10px; font-size: 13px; color: var(--c-muted); }
.files { display: flex; flex-wrap: wrap; gap: 6px; }
.files span { font-family: var(--f-m); font-size: 11.5px; padding: 3px 8px; border-radius: 8px; background: color-mix(in srgb, var(--c-void) 55%, transparent); border: 1px solid color-mix(in srgb, var(--app) 14%, transparent); }
.files span.new { border-color: color-mix(in srgb, var(--c-ok) 50%, transparent); color: var(--c-ok); }
.files span.removed { text-decoration: line-through; opacity: .7; }
.note { font-size: 12.5px; color: var(--c-muted); margin: 0 0 14px; }

/* Start here */
.apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; margin: 6px 0 22px; }
.card-app { --c: var(--c-hi); position: relative; display: grid; gap: 6px; padding: 16px; border-radius: 20px; text-align: left; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent); background: radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--c) 18%, transparent), transparent 60%), color-mix(in srgb, var(--c-panel) 65%, transparent);
  transition: transform .25s cubic-bezier(.2,.9,.3,1.2), border-color .25s, box-shadow .25s; animation: rise .5s cubic-bezier(.2,.9,.3,1.1) both; animation-delay: calc(var(--i, 0) * 50ms); }
.card-app:hover { transform: translateY(-3px); border-color: var(--c); box-shadow: 0 16px 34px -18px var(--c); }
.card-app .top-row { display: flex; align-items: center; gap: 10px; }
.card-app .planet { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 15px; background: radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--c) 70%, #fff), var(--c) 50%, color-mix(in srgb, var(--c) 40%, #000)); box-shadow: 0 0 14px -3px var(--c); }
.card-app b { font-family: var(--f-d); font-weight: 900; font-size: 16px; color: var(--c-bright); }
.card-app p { margin: 0; font-size: 13px; line-height: 1.4; color: var(--c-text); }
.card-app small { font-size: 11px; color: var(--c-muted); }
.section-title { margin: 22px 0 10px; font-family: var(--f-d); font-weight: 900; font-size: 13px; letter-spacing: .18em; text-transform: uppercase; color: var(--c-hi); }

/* Search */
.hits { display: grid; gap: 8px; }
.hit { --c: var(--c-hi); display: grid; gap: 4px; width: 100%; padding: 12px 16px; border-radius: 16px; text-align: left; border: 1px solid color-mix(in srgb, var(--c) 22%, transparent); background: color-mix(in srgb, var(--c-panel) 60%, transparent); transition: border-color .2s, transform .2s; animation: rise .3s ease both; animation-delay: calc(var(--i, 0) * 25ms); }
.hit:hover { border-color: var(--c); transform: translateX(3px); }
.hit .where { font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--c); }
.hit b { font-family: var(--f-d); font-weight: 800; font-size: 15px; color: var(--c-bright); }
.hit span { font-size: 13px; line-height: 1.45; color: var(--c-muted); }
.hit mark { background: color-mix(in srgb, var(--c-gold) 30%, transparent); color: var(--c-bright); border-radius: 4px; padding: 0 2px; }

@media (max-width: 760px) {
  .panel { width: 100vw; height: 100dvh; border-radius: 0; border: 0; }
  .top { flex-wrap: wrap; padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 10px; gap: 10px; }
  .search { order: 3; flex-basis: 100%; max-width: none; }
  .search kbd { display: none; }
  .x { margin-left: auto; }
  .body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .rail { flex-direction: row; overflow-x: auto; overflow-y: hidden; padding: 10px 12px; border-right: 0; border-bottom: 1px solid color-mix(in srgb, var(--c-hi) 12%, transparent); scrollbar-width: none; }
  .rail .label { display: none; }
  .rail button { width: auto; flex: none; padding: 6px 12px 6px 6px; }
  .rail .words small, .rail .here, .rail .fresh { display: none; }
  .page { padding: 16px 16px calc(36px + env(safe-area-inset-bottom, 0px)); }
  .hero { gap: 14px; }
  .big { width: 64px; height: 64px; font-size: 24px; }
  .big::after { transform-origin: 0 29px; }
  .chapter { padding: 14px 16px 6px; }
}

@keyframes pop-in { from { opacity: 0; transform: translateY(10px) scale(.85); } }
@keyframes panel-in { from { opacity: 0; transform: translateY(14px) scale(.96); } }
@keyframes panel-out { to { opacity: 0; transform: translateY(10px) scale(.97); } }
@keyframes rise { from { opacity: 0; transform: translateY(10px); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes ring { to { transform: rotateX(70deg) rotateZ(360deg); } }
@keyframes breathe { 50% { opacity: .5; transform: scale(.85); } }
@keyframes twinkle { 50% { opacity: .85; } }
@keyframes float { 50% { transform: translateY(-5px); } }
@keyframes planet { from { opacity: 0; transform: scale(.4) rotate(-90deg); } }
@keyframes flash { 0% { box-shadow: 0 0 0 3px var(--app); } 100% { box-shadow: 0 0 0 0 transparent; } }
:host(.calm) *, :host(.calm) *::before, :host(.calm) *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;

  const ICON = {
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z"/><path d="M12 6.5v13"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    go: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  };

  // Per-item colours and delays are set from here, not as style="" (pages with strict
  // security rules, like Nova Hub's, don't allow inline styles; setting them in code is fine)
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
      this.onKey = (e) => this.key(e);
      this.onCalm = () => this.classList.toggle("calm", still());
    }
    connectedCallback() {
      all.add(this);
      this.onCalm();
      window.addEventListener("novaoptionschange", this.onCalm);
      this.drawButton();
      // A small green dot when something in the suite changed since you last looked
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
      idle(() => data().then((d) => this.markNew(d)).catch(() => {}));
    }
    disconnectedCallback() {
      all.delete(this);
      window.removeEventListener("novaoptionschange", this.onCalm);
      this.close();
    }

    drawButton() {
      this.root.innerHTML = `<button class="open" part="button" type="button" aria-haspopup="dialog" aria-expanded="false" title="Nova Manual (press ?)">
          <span class="orb">${ICON.book.replace("<svg", '<svg width="18" height="18"')}<span class="spark"></span></span>
          <span class="label"><b>Manual</b><small>Nova suite</small></span>
        </button>
        <div class="panel" role="dialog" aria-modal="true" aria-label="Nova Manual" ${POPOVER ? 'popover="manual"' : "hidden"}></div>`;
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
        btn.title = "Nova Manual: something's new (press ?)";
      } else if (dot) dot.remove();
    }

    open(app, tab) {
      if (app !== undefined) this.app = app;
      if (tab) this.tab = tab;
      const panel = this.root.querySelector(".panel");
      if (!this.isOpen) {
        panel.innerHTML = `<div class="sky">${"<i></i>".repeat(18)}</div>
          <header class="top">
            <div class="brand"><span class="book">${ICON.book}</span><div><div class="kicker">Nova suite</div><h2>Nova Manual</h2></div></div>
            <label class="search">${ICON.search}<input type="search" placeholder="Search every app's manual" aria-label="Search the manual" autocomplete="off" spellcheck="false"><kbd>/</kbd></label>
            <button class="x" type="button" aria-label="Close the manual">${ICON.x}</button>
          </header>
          <div class="body"><nav class="rail" aria-label="Apps"></nav><main class="page" tabindex="-1"><div class="loading"><span class="ring"></span>Opening the manual…</div></main></div>`;
        panel.querySelector(".x").addEventListener("click", () => this.close(true));
        const input = panel.querySelector("input");
        input.addEventListener("input", () => {
          this.query = input.value.trim();
          this.drawPage();
        });
        panel.addEventListener("click", (e) => this.click(e));
        if (POPOVER) panel.showPopover();
        else panel.hidden = false;
        panel.classList.remove("out");
        this.isOpen = true;
        this.root.querySelector(".open").setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", this.onKey, true);
        sfx("open");
        setTimeout(() => input.focus({ preventScroll: true }), 60);
      }
      data()
        .then((d) => {
          this.d = d;
          store.set(SEEN_KEY, new Date().toISOString());
          const dot = this.root.querySelector(".open .dot");
          if (dot) dot.remove();
          if (this.app && !d.apps.some((a) => a.id === this.app)) this.app = "";
          this.drawRail();
          this.drawPage();
        })
        .catch(() => {
          const page = this.root.querySelector(".page");
          if (page) page.innerHTML = `<div class="empty"><div><b>The manual's pages aren't here yet.</b><br>Run <code>node scripts/build-manual.mjs</code> in Nova Portal to make them.</div></div>`;
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
      if (e.key === "Escape") {
        const input = this.root.querySelector(".search input");
        e.preventDefault();
        e.stopPropagation();
        if (input && input.value) {
          input.value = "";
          this.query = "";
          this.drawPage();
        } else this.close(true);
      } else if (e.key === "/" && this.root.activeElement !== this.root.querySelector(".search input")) {
        e.preventDefault();
        this.root.querySelector(".search input").focus();
      }
    }
    remember() {
      store.set(PLACE_KEY, JSON.stringify({ app: this.app, tab: this.tab }));
    }

    drawRail() {
      const rail = this.root.querySelector(".rail");
      if (!rail || !this.d) return;
      const btn = (id, name, small, colour, glyph, i, extra) =>
        `<button type="button" data-app="${id}" aria-current="${this.app === id && !this.query}" data-v="--c:${colour};animation-delay:${i * 35}ms"><span class="planet" aria-hidden="true">${glyph}</span><span class="words"><b>${esc(name)}</b><small>${esc(small)}</small></span>${extra}</button>`;
      rail.innerHTML =
        btn("", "Start here", "The suite, and what's new", "var(--c-hi)", "✺", 0, "") +
        `<div class="label">The apps</div>` +
        this.d.apps
          .map((a, i) => {
            const fresh = recent(a, 2).length;
            const extra = a.id === this.here ? `<span class="here">Here</span>` : fresh ? `<span class="fresh" title="Changed in the last two days"></span>` : "";
            return btn(a.id, a.name, a.where, a.colour, a.glyph, i + 1, extra);
          })
          .join("");
      paint(rail);
    }

    drawPage() {
      const page = this.root.querySelector(".page");
      if (!page || !this.d) return;
      const app = this.d.apps.find((a) => a.id === this.app);
      const panel = this.root.querySelector(".panel");
      panel.style.setProperty("--app", app && !this.query ? app.colour : "var(--c-hi)");
      for (const b of this.root.querySelectorAll(".rail button")) b.setAttribute("aria-current", String(!this.query && b.dataset.app === this.app));
      page.innerHTML = this.query ? this.searchPage() : app ? this.appPage(app) : this.startPage();
      paint(page);
      if (!this.query) page.scrollTop = 0;
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
        <div class="hero"><span class="big" data-v="--c:var(--c-hi)" aria-hidden="true">✺</span><div class="who"><div class="kicker">Nova Manual</div><h1>The Nova suite</h1><p>${esc((s && s.tagline) || "Every Nova app: how to use it, how it's built, its story so far and what's changing.")}</p>
          <div class="pills"><span class="pill">${d.apps.length} apps</span><span class="pill">Updated ${esc(ago(d.built))}</span><span class="pill">Press <b>?</b> on any Nova app to open this</span></div></div></div>
        <div class="section-title">The apps</div>
        <div class="apps">${cards}</div>
        ${feed.length ? `<div class="section-title">This week across the suite</div>${this.timeline(feed.slice(0, 30), true)}` : ""}
        ${s && s.chapters.length ? `<div class="section-title">How it all fits together</div>${s.intro ? `<div class="prose intro">${s.intro}</div>` : ""}${s.chapters.map((c, i) => this.chapter(c, i)).join("")}` : ""}`;
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
      return `${hero}<div class="tabs" role="tablist" aria-label="${esc(a.name)}">${tabs}</div>${body}`;
    }

    chapters(list, intro) {
      if (!list.length && !intro) return `<div class="empty">Nothing written about this yet.</div>`;
      const toc = list.length > 2 ? `<div class="toc">${list.map((c) => `<button type="button" data-goto="${c.id}">${esc(c.title)}</button>`).join("")}</div>` : "";
      return `${intro ? `<div class="prose intro">${intro}</div>` : ""}${toc}${list.map((c, i) => this.chapter(c, i)).join("")}`;
    }
    chapter(c, i) {
      return `<section class="chapter" id="${c.id}" data-v="--i:${Math.min(i, 8)}"><h3>${esc(c.title)}</h3><div class="prose">${c.html}</div></section>`;
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
        out += `<div class="commit" data-v="--i:${Math.min(i++, 12)};--app:${a.colour}"><div class="s">${esc(c.subject)}</div><div class="m">${showApp ? `<span class="tag" data-v="--c:${a.colour}">${esc(a.repo === "nb/novacane-worker" ? "Nova Bot & Hub" : a.name)}</span>` : ""}<span>${esc(timeOf(c.date))}</span><code>${esc(c.hash)}</code></div>${c.body ? `<details><summary>More about this change</summary><pre>${esc(c.body)}</pre></details>` : ""}</div>`;
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
      if (d.suite) for (const c of d.suite.chapters) add(null, "", c, c.text, "The Nova suite");
      const repos = new Set();
      for (const a of d.apps) {
        for (const c of a.guide) add(a, "guide", c, c.text, `${a.name} · Guide`);
        for (const c of a.built) add(a, "built", c, c.text, `${a.name} · How it's built`);
        for (const c of a.news) add(a, "new", c, c.text, `${a.name} · What's new`);
        if (!repos.has(a.repo)) {
          repos.add(a.repo);
          for (const c of a.history.commits) add(a, "history", { id: "", title: c.subject }, c.body || "", `${a.repo === "nb/novacane-worker" ? "Nova Bot & Hub" : a.name} · History · ${shortDay(c.date)}`);
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
      const el = e.target.closest("button[data-app], button[data-tab], button[data-goto]");
      if (!el || !this.root.contains(el)) return;
      const goto = el.dataset.goto;
      if (el.dataset.app !== undefined && (el.closest(".rail") || el.classList.contains("card-app") || el.classList.contains("hit"))) {
        // To an app (from the list, a card, or a search result)
        const input = this.root.querySelector(".search input");
        if (el.classList.contains("hit") || el.closest(".rail")) {
          input.value = "";
          this.query = "";
        }
        this.app = el.dataset.app;
        this.tab = (el.classList.contains("hit") && el.dataset.tab) || "guide";
        sfx("tap");
        this.remember();
        this.drawPage();
        if (goto) this.goTo(goto);
        return;
      }
      if (el.dataset.tab) {
        this.tab = el.dataset.tab;
        sfx("tap");
        this.remember();
        this.drawPage();
        return;
      }
      if (goto) this.goTo(goto);
    }
    goTo(id) {
      requestAnimationFrame(() => {
        const target = this.root.getElementById(id);
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

  window.NovaManual = {
    open(app, tab) {
      ensure().open(app, tab);
    },
    close() {
      for (const m of all) m.close(true);
    },
  };
})();
