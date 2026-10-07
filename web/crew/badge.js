// Nova Portal badge: who's signed in, on every Nova suite app.
//
//   <script src="/portal/badge.js" defer></script>        (on Nova Bot's worker and in Nova Agent)
//   <script src="https://novacane-worker.novacane-studio.workers.dev/portal/badge.js" defer></script>
//   <nova-portal-badge></nova-portal-badge>                 (compact: planet only; align="start" opens its card to the right)
// Pages can style ::part(chip) and ::part(words) (e.g. hide the words on a phone).
//
// It shows your planet (turning, with a halo in its own colour), your name and your role, and opens
// a card with the planet up close, its name, and links to your profile and your Nova Index.
// Where it is decides how it knows you:
//   Nova Bot's worker (Nova Hub, Nova Index, the admin pages)   your Nova Portal sign-in (the cookie)
//   Nova Agent (localhost:4545) and the apps it serves         who Nova Agent works for (found by itself; "Connect as me" to change)
//   Nova Notes, Nova Calendar... on their own sites            a read-only token from "Connect" in Nova Portal
// Colours come from the page's theme: --np-* if the app sets them, else Nova Hub's names (--hi,
// --accent...), else the Nova suite's magenta. Calm motion (reduced motion, or data-motion="calm") stills it.
(() => {
  "use strict";
  if (customElements.get("nova-portal-badge")) return;

  const WORKER = "https://novacane-worker.novacane-studio.workers.dev";
  const TOKEN_KEY = "nova-portal/badge-token";
  const here = location.origin;
  const onWorker = here === WORKER || /^http:\/\/(localhost|127\.0\.0\.1):87\d\d$/.test(here);
  const inAgent = /^http:\/\/(localhost|127\.0\.0\.1):454[5-9]$/.test(here);
  const mode = onWorker ? "portal" : inAgent ? "agent" : "connect";
  const api = mode === "connect" ? WORKER : "";
  const portalUrl = (mode === "portal" ? "" : WORKER) + "/portal/";

  const store = {
    get() {
      try {
        return localStorage.getItem(TOKEN_KEY) || "";
      } catch (err) {
        return "";
      }
    },
    set(v) {
      try {
        if (v) localStorage.setItem(TOKEN_KEY, v);
        else localStorage.removeItem(TOKEN_KEY);
      } catch (err) {}
    },
  };

  // Back from "Connect" in Nova Portal: the token arrives in the address's #fragment (never sent to a server)
  if (mode === "connect") {
    const m = /(?:^#|&)nova_portal=(nprof_[A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      store.set(m[1]);
      const rest = location.hash.replace(/(^#|&)nova_portal=[^&]*/, "$1").replace(/^#&?$/, "");
      history.replaceState(history.state, "", location.pathname + location.search + rest);
    }
  }
  // In Nova Agent, "Connect as me" comes back the same way: Nova Agent checks the token with
  // Nova Portal, remembers who you are, and puts the token away
  let linking = null;
  if (mode === "agent") {
    const m = /(?:^#|&)nova_portal=(nprof_[A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      const rest = location.hash.replace(/(^#|&)nova_portal=[^&]*/, "$1").replace(/^#&?$/, "");
      history.replaceState(history.state, "", location.pathname + location.search + rest);
      linking = agentLink({ token: m[1] }).then((ok) => ok && setTimeout(() => sfx("done"), 400));
    }
  }
  function agentLink(body) {
    return fetch("/auth/link", { method: "POST", headers: { "Content-Type": "application/json", "X-Nova-App": "portal-badge" }, body: JSON.stringify(body) })
      .then((r) => r.ok)
      .catch(() => false);
  }

  const POPOVER = typeof HTMLElement.prototype.showPopover === "function";
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.getAttribute("data-motion") === "calm";
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(name);
  const first = (name) => String(name || "").trim().split(/\s+/)[0] || "You";
  const since = (when) => {
    const t = Date.parse(when || "");
    return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };
  const planetSrc = (s, size, animate) =>
    `${api}/staff/${encodeURIComponent(s.id)}/planet.svg?size=${size}${animate ? "&animate=1" : ""}&v=${encodeURIComponent(String(s.planet_seed || s.id) + (s.planet_overrides ? "." + JSON.stringify(s.planet_overrides).length : ""))}`;

  // One request shared by every badge on the page
  let pending = null;
  let last = { at: 0, data: null };
  function whoAmI(force) {
    if (!force && last.data && Date.now() - last.at < 60_000) return Promise.resolve(last.data);
    if (pending) return pending;
    if (linking) {
      const wait = linking;
      linking = null;
      pending = wait.then(() => {
        pending = null;
        return whoAmI(true);
      });
      return pending;
    }
    const headers = { Accept: "application/json", "X-Nova-App": "portal-badge" };
    const token = mode === "connect" ? store.get() : "";
    if (mode === "connect" && !token) return Promise.resolve({ signedIn: false });
    if (token) headers.Authorization = `Bearer ${token}`;
    pending = fetch(`${api}/auth/me`, { headers, credentials: mode === "connect" ? "omit" : "same-origin" })
      .then(async (res) => {
        if (res.status === 401) {
          if (token) store.set("");
          return { signedIn: false };
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        return { signedIn: true, staff: data.staff, via: data.via || mode, linked: data.linked !== false, how: data.how || "" };
      })
      .catch(() => ({ signedIn: false, offline: true }))
      .then((data) => {
        pending = null;
        last = { at: Date.now(), data };
        window.dispatchEvent(new CustomEvent("novaportal", { detail: data }));
        return data;
      });
    return pending;
  }

  const CSS = `
:host {
  --c-hi: var(--np-hi, var(--hi, #FF5FA8));
  --c-accent: var(--np-accent, var(--accent, #B01D68));
  --c-accent-2: var(--np-accent-2, var(--accent-2, #7A1F86));
  --c-panel: var(--np-panel, var(--panel, #1C1129));
  --c-deep: var(--np-deep, var(--deep, #100816));
  --c-text: var(--np-text, var(--text, #EBD3E7));
  --c-muted: var(--np-muted, var(--muted, #B997B5));
  --c-bright: var(--np-bright, var(--bright, #F6ECFF));
  --c-gold: var(--np-gold, var(--gold, #F2D9A0));
  --c-on-accent: var(--np-on-accent, var(--on-accent, #fff));
  --f-d: var(--np-font-display, var(--f-display, "Archivo", "Arial Black", sans-serif));
  --f-b: var(--np-font-body, var(--f-body, "Saira", system-ui, sans-serif));
  /* The halo: your planet's own glow, blended with the app's theme */
  --halo: color-mix(in srgb, var(--planet-glow, var(--c-hi)) 45%, var(--c-hi));
  display: inline-flex; position: relative; vertical-align: middle; flex: none;
  font-family: var(--f-b); color: var(--c-text); -webkit-tap-highlight-color: transparent;
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
button, a { font: inherit; color: inherit; }

/* ---- The chip: planet, name, role ---- */
.chip {
  display: inline-flex; align-items: center; gap: 9px; height: 40px; padding: 0 12px 0 4px; margin: 0;
  border: 1px solid color-mix(in srgb, var(--halo) 38%, transparent); border-radius: 999px; cursor: pointer;
  background: linear-gradient(120deg, color-mix(in srgb, var(--c-panel) 88%, transparent), color-mix(in srgb, var(--c-accent-2) 22%, var(--c-panel)));
  box-shadow: 0 0 0 0 transparent, 0 6px 18px -10px color-mix(in srgb, var(--halo) 70%, transparent);
  transition: transform 0.25s cubic-bezier(.2,.9,.3,1.3), box-shadow 0.3s, border-color 0.3s;
  animation: chip-in 0.7s cubic-bezier(.2,.9,.3,1.15) both;
}
.chip:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--halo) 70%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--halo) 22%, transparent), 0 10px 24px -10px var(--halo); }
.chip:active { transform: scale(0.97); }
.chip:focus-visible { outline: 2px solid var(--c-hi); outline-offset: 3px; }
:host([compact]) .chip { padding: 0 4px; gap: 0; }
:host([compact]) .words { display: none; }

.orb { position: relative; width: 32px; height: 32px; flex: none; display: grid; place-items: center; }
.orb::before {
  content: ""; position: absolute; inset: -3px; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent 0 55%, var(--halo) 78%, var(--c-bright) 82%, transparent 90%);
  -webkit-mask: radial-gradient(circle, transparent 0 60%, #000 62% 70%, transparent 72%); mask: radial-gradient(circle, transparent 0 60%, #000 62% 70%, transparent 72%);
  animation: spin 6s linear infinite;
}
.orb::after { content: ""; position: absolute; inset: 2px; border-radius: 50%; box-shadow: 0 0 14px 2px color-mix(in srgb, var(--halo) 55%, transparent); animation: breathe 4s ease-in-out infinite; }
.orb img { position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%; display: block; animation: planet-in 0.9s cubic-bezier(.2,.9,.3,1.2) both 0.1s; }
.orb .ghost { width: 26px; height: 26px; border-radius: 50%; border: 1.5px dashed color-mix(in srgb, var(--c-hi) 70%, transparent); animation: spin 9s linear infinite; }
.orb .spark { position: absolute; width: 4px; height: 4px; border-radius: 50%; background: var(--c-bright); box-shadow: 0 0 6px var(--c-hi); top: 1px; left: 50%; transform-origin: 0 15px; animation: orbit 3.2s linear infinite; }

.words { display: grid; line-height: 1.05; text-align: left; min-width: 0; }
.name { font-family: var(--f-d); font-weight: 800; font-size: 13.5px; letter-spacing: 0.01em; color: var(--c-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14ch; }
.role { justify-self: start; margin-top: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--c-muted); }
.role.admin, .role.staff { position: relative; overflow: hidden; padding: 1px 6px; border-radius: 999px; color: var(--c-on-accent); background: linear-gradient(90deg, var(--c-accent), var(--c-accent-2)); }
.role.staff { background: color-mix(in srgb, var(--halo) 30%, var(--c-panel)); color: var(--c-bright); }
.role.admin::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%); transform: translateX(-120%); animation: shimmer 3.6s ease-in-out infinite 1s; }
.signin .name { font-size: 13px; }
.orb.wide { width: 96px; height: 96px; }
.orb.wide .ghost { width: 90px; height: 90px; }
.orb.wide .spark { transform-origin: 0 47px; }

/* ---- The card ---- */
.card {
  position: fixed; z-index: 2147483000; width: min(320px, calc(100vw - 24px)); padding: 14px 18px 12px; border-radius: 22px;
  color: var(--c-text); text-align: center; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin;
  background:
    radial-gradient(120% 70% at 50% 0%, color-mix(in srgb, var(--halo) 32%, transparent), transparent 65%),
    linear-gradient(180deg, color-mix(in srgb, var(--c-panel) 96%, transparent), color-mix(in srgb, var(--c-deep) 98%, transparent));
  border: 1px solid color-mix(in srgb, var(--halo) 40%, transparent);
  box-shadow: 0 24px 60px -18px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 50px -20px var(--halo);
  -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  transform-origin: var(--ox, 90%) 0; animation: card-in 0.42s cubic-bezier(.2,.9,.3,1.15) both;
}
.card[hidden] { display: none; }
.card[popover] { inset: auto; margin: 0; }
.card.out { animation: card-out 0.2s ease-in both; }
.stars { position: absolute; inset: 0; pointer-events: none; }
.stars i { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: #fff; opacity: 0.2; animation: twinkle 3s ease-in-out infinite; }
.big { position: relative; width: 112px; height: 112px; margin: 2px auto 4px; display: grid; place-items: center; }
.big img { width: 112px; height: 112px; border-radius: 50%; animation: rise 0.7s cubic-bezier(.2,.9,.3,1.2) both 0.05s, float 6s ease-in-out infinite 0.8s; filter: drop-shadow(0 0 22px color-mix(in srgb, var(--halo) 60%, transparent)); }
.big::before { content: ""; position: absolute; inset: -10px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--halo) 35%, transparent); transform: rotateX(72deg); animation: ring 8s linear infinite; }
.kicker { font-size: 10px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--c-hi); }
h3 { margin: 4px 0 2px; font-family: var(--f-d); font-weight: 900; font-size: 22px; line-height: 1.1; color: var(--c-bright); letter-spacing: 0.01em; }
.pills { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; margin: 6px 0 8px; }
.pill { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 9px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--halo) 35%, transparent); color: var(--c-text); }
.pill.role-admin { position: relative; overflow: hidden; border: 0; color: var(--c-on-accent); background: linear-gradient(90deg, var(--c-accent), var(--c-accent-2)); }
.pill.role-admin::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%); transform: translateX(-120%); animation: shimmer 3.6s ease-in-out infinite; }
.world { margin: 0 0 4px; font-size: 13px; color: var(--c-gold); font-weight: 600; }
.desc { margin: 0 0 12px; font-size: 12px; color: var(--c-muted); }
.note { margin: 0 0 12px; font-size: 12px; color: var(--c-muted); line-height: 1.4; }
.links { display: grid; gap: 7px; }
.links a, .links button {
  display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 0 14px; border-radius: 13px;
  text-decoration: none; font-size: 13.5px; font-weight: 600; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--halo) 28%, transparent); background: color-mix(in srgb, var(--c-panel) 70%, transparent);
  transition: transform 0.2s, border-color 0.2s, background 0.2s; animation: link-in 0.45s cubic-bezier(.2,.9,.3,1.1) both;
}
.links > :nth-child(2) { animation-delay: 0.05s; } .links > :nth-child(3) { animation-delay: 0.1s; } .links > :nth-child(4) { animation-delay: 0.15s; }
.links a:hover, .links button:hover { transform: translateY(-1px); border-color: var(--halo); background: color-mix(in srgb, var(--halo) 16%, var(--c-panel)); }
.links .main { border: 0; color: var(--c-on-accent); background: linear-gradient(90deg, var(--c-accent), var(--c-accent-2)); box-shadow: 0 8px 20px -10px var(--c-accent); }
.links .quiet { background: transparent; color: var(--c-muted); }
.links a:focus-visible, .links button:focus-visible { outline: 2px solid var(--c-hi); outline-offset: 2px; }
.foot { margin: 10px 0 0; font-size: 10.5px; letter-spacing: 0.08em; color: var(--c-muted); opacity: 0.8; }

@keyframes chip-in { from { opacity: 0; transform: translateY(-6px) scale(0.92); } }
@keyframes planet-in { from { opacity: 0; transform: scale(0.3) rotate(-120deg); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes orbit { to { transform: rotate(360deg); } }
@keyframes breathe { 50% { opacity: 0.45; transform: scale(0.92); } }
@keyframes shimmer { 0%, 55% { transform: translateX(-120%); } 85%, 100% { transform: translateX(120%); } }
@keyframes card-in { from { opacity: 0; transform: translateY(-8px) scale(0.86); } }
@keyframes card-out { to { opacity: 0; transform: translateY(-6px) scale(0.94); } }
@keyframes rise { from { opacity: 0; transform: translateY(18px) scale(0.6) rotate(-40deg); } }
@keyframes float { 50% { transform: translateY(-5px) rotate(-2deg); } }
@keyframes ring { to { transform: rotateX(72deg) rotateZ(360deg); } }
@keyframes twinkle { 50% { opacity: 0.9; } }
@keyframes link-in { from { opacity: 0; transform: translateY(8px); } }
:host(.calm) *, :host(.calm) *::before, :host(.calm) *::after { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

  const ICON = {
    profile: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)"/></svg>',
    index: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10"/></svg>',
    hub: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/></svg>',
    out: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  };

  class NovaPortalBadge extends HTMLElement {
    constructor() {
      super();
      this.root = this.attachShadow({ mode: "open" });
      // A constructed stylesheet: allowed by pages whose security rules forbid inline styles
      this.root.adoptedStyleSheets = [sheet()];
      this.data = null;
      this.onKey = (e) => e.key === "Escape" && this.close(true);
      this.onAway = (e) => !e.composedPath().includes(this) && this.close();
      this.onMove = () => this.place();
    }
    connectedCallback() {
      this.calm();
      this.draw({ loading: true });
      whoAmI().then((d) => this.draw(d));
      this.onData = (e) => this.draw(e.detail);
      window.addEventListener("novaportal", this.onData);
      this.onVisible = () => document.visibilityState === "visible" && whoAmI();
      document.addEventListener("visibilitychange", this.onVisible);
      this.onCalm = () => this.calm();
      window.addEventListener("novaoptionschange", this.onCalm);
    }
    disconnectedCallback() {
      window.removeEventListener("novaportal", this.onData);
      document.removeEventListener("visibilitychange", this.onVisible);
      window.removeEventListener("novaoptionschange", this.onCalm);
      this.close();
    }
    calm() {
      this.classList.toggle("calm", still());
    }

    draw(d) {
      if (this.isOpen) return;
      const same = this.data && d && JSON.stringify(this.data) === JSON.stringify(d);
      if (same && this.root.childElementCount) return;
      this.data = d;
      const s = d && d.staff;
      if (s && s.planet && s.planet.glow) this.style.setProperty("--planet-glow", s.planet.glow);
      else this.style.removeProperty("--planet-glow");
      let chip;
      if (d && d.loading) {
        chip = `<button class="chip" type="button" aria-label="Nova Portal" disabled><span class="orb"><span class="ghost"></span></span></button>`;
      } else if (s) {
        const role = mode === "agent" && !d.linked ? "" : s.role;
        chip = `<button class="chip" part="chip" type="button" aria-haspopup="dialog" aria-expanded="false" title="${esc(s.display_name)} · Nova Portal">
          <span class="orb"><img alt="" src="${planetSrc(s, 64, false)}" width="30" height="30"></span>
          <span class="words" part="words"><span class="name">${esc(first(s.display_name))}</span>${role ? `<span class="role ${role}">${role === "admin" ? "Admin" : "Staff"}</span>` : `<span class="role">Nova Agent</span>`}</span>
        </button>`;
      } else {
        chip = `<button class="chip signin" part="chip" type="button" aria-haspopup="dialog" aria-expanded="false" title="Sign in with Nova Portal">
          <span class="orb"><span class="ghost"></span><span class="spark"></span></span>
          <span class="words" part="words"><span class="name">Sign in</span><span class="role">Nova Portal</span></span>
        </button>`;
      }
      // The card opens in the browser's top layer (a popover), so a header with a blur or
      // clipping (like Nova Agent's glass bar) can't trap or cut it off
      this.root.innerHTML = `${chip}<div class="card" role="dialog" aria-label="Nova Portal" ${POPOVER ? 'popover="manual"' : "hidden"}></div>`;
      const btn = this.root.querySelector(".chip");
      btn.addEventListener("click", () => (this.isOpen ? this.close(true) : this.open()));
      this.dispatchEvent(new CustomEvent("change", { detail: d }));
    }

    open() {
      const d = this.data || {};
      const s = d.staff;
      const card = this.root.querySelector(".card");
      const back = encodeURIComponent(location.href.split("#")[0]);
      let body;
      if (s) {
        const role = s.role === "admin" ? "Admin" : "Staff";
        const unlinked = mode === "agent" && !d.linked;
        const index = (mode === "connect" ? WORKER : "") + "/app/memory/";
        // Nova Agent: "Connect as me" makes it work for you (back to its main page afterwards)
        const connectMe = `${portalUrl}?connect=${encodeURIComponent(location.origin + "/")}`;
        const agentMore =
          mode !== "agent" || d.how === "set"
            ? ""
            : d.how === "connected"
              ? `<button type="button" class="quiet" data-act="auto">${ICON.out}<span>Back to automatic</span></button>`
              : d.linked
                ? `<a class="quiet" href="${connectMe}" target="_top">${ICON.profile}<span>Not you? Connect as you</span></a>`
                : "";
        const links = [
          `<a class="main" href="${portalUrl}${mode === "portal" ? "" : unlinked ? "" : "?id=" + encodeURIComponent(s.id)}" target="${mode === "portal" ? "_self" : "_blank"}" rel="noopener">${ICON.profile}<span>${unlinked ? "Set up Nova Portal" : "Your profile"}</span></a>`,
          `<a href="${index}" target="${mode === "connect" ? "_blank" : "_self"}" rel="noopener">${ICON.index}<span>${unlinked ? "Nova Index" : "Your Nova Index"}</span></a>`,
          mode === "portal" && !location.pathname.startsWith("/app/") ? `<a href="/app/">${ICON.hub}<span>Nova Hub</span></a>` : "",
          mode === "agent" ? agentMore : `<button type="button" class="quiet" data-act="out">${ICON.out}<span>${mode === "connect" ? "Disconnect" : "Sign out everywhere"}</span></button>`,
        ].join("");
        const agentNote =
          mode !== "agent"
            ? ""
            : unlinked
              ? "Nova Portal has nobody yet (or can't be reached). Set up the first admin and Nova Agent finds them by itself."
              : d.how === "connected"
                ? "You connected Nova Agent to you in Nova Portal. Your Nova Index memory is the one it uses."
                : d.how === "set"
                  ? "Chosen by NOVA_STAFF_ID in Nova Agent's settings."
                  : "Picked automatically: the studio's first admin. Someone else using this computer? They can connect it to themselves.";
        body = `
          <div class="big"><img alt="${esc(s.display_name)}'s planet" src="${planetSrc(s, 224, !still())}" width="112" height="112"></div>
          <div class="kicker">${mode === "agent" ? "Nova Agent works for" : "Signed in with Nova Portal"}</div>
          <h3>${esc(s.display_name)}</h3>
          <div class="pills">${unlinked ? `<span class="pill">Not in Nova Portal yet</span>` : `<span class="pill role-${s.role}">${role}</span>`}${s.created_at ? `<span class="pill">Since ${esc(since(s.created_at))}</span>` : ""}</div>
          ${s.planet && s.planet.name ? `<p class="world">✦ ${esc(s.planet.name)}</p>` : ""}
          ${s.planet && s.planet.description ? `<p class="desc">${esc(s.planet.description)}</p>` : ""}
          ${agentNote ? `<p class="note">${esc(agentNote)}</p>` : ""}
          <div class="links">${links}</div>
          <p class="foot">${mode === "connect" ? "Connected: name, role and planet only" : "One sign-in for every Nova app"}</p>`;
      } else {
        const go = mode === "portal" ? `${portalUrl}?next=${encodeURIComponent(location.pathname + location.search)}` : `${portalUrl}?connect=${back}`;
        body = `
          <div class="big"><span class="orb wide"><span class="ghost"></span><span class="spark"></span></span></div>
          <div class="kicker">Nova Portal</div>
          <h3>${d.offline ? "Can't reach Nova Portal" : "Who's here?"}</h3>
          <p class="note">${
            d.offline
              ? "Check the connection; it'll try again when you come back to this page."
              : mode === "connect"
                ? "Connect this app to Nova Portal to show your name, role and planet here. It can't see or change anything else."
                : "Sign in once with Nova Portal and every Nova app knows who you are."
          }</p>
          <div class="links"><a class="main" href="${go}">${ICON.profile}<span>${mode === "connect" ? "Connect with Nova Portal" : "Sign in with Nova Portal"}</span></a></div>
          <p class="foot">One sign-in for every Nova app</p>`;
      }
      card.innerHTML = `<div class="stars">${stars()}</div>${body}`;
      if (POPOVER) card.showPopover();
      else card.hidden = false;
      card.classList.remove("out");
      this.isOpen = true;
      this.root.querySelector(".chip").setAttribute("aria-expanded", "true");
      this.place();
      sfx("open");
      const out = card.querySelector('[data-act="out"]');
      if (out) out.addEventListener("click", () => this.signOut());
      const auto = card.querySelector('[data-act="auto"]');
      if (auto)
        auto.addEventListener("click", async () => {
          await agentLink({ forget: true });
          sfx("off");
          this.close();
          whoAmI(true);
        });
      setTimeout(() => {
        document.addEventListener("pointerdown", this.onAway, true);
        document.addEventListener("keydown", this.onKey);
        window.addEventListener("resize", this.onMove);
        window.addEventListener("scroll", this.onMove, true);
      });
      const focus = card.querySelector("a, button");
      if (focus) focus.focus({ preventScroll: true });
    }
    place() {
      const card = this.root.querySelector(".card");
      const chip = this.root.querySelector(".chip");
      if (!card || !this.isOpen) return;
      const r = chip.getBoundingClientRect();
      const w = card.offsetWidth;
      const vw = document.documentElement.clientWidth;
      const start = this.getAttribute("align") === "start";
      let left = start ? r.left : r.right - w;
      left = Math.max(12, Math.min(left, vw - w - 12));
      card.style.maxHeight = "";
      let top = r.bottom + 10;
      if (top + card.offsetHeight > innerHeight - 8 && r.top - card.offsetHeight - 10 > 8) top = r.top - card.offsetHeight - 10;
      top = Math.max(8, top);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      // A short window: the card scrolls inside rather than running off the bottom
      card.style.maxHeight = `${Math.max(200, innerHeight - top - 10)}px`;
      card.style.setProperty("--ox", `${Math.round(r.left + r.width / 2 - left)}px`);
    }
    close(withSound) {
      if (!this.isOpen) return;
      this.isOpen = false;
      document.removeEventListener("pointerdown", this.onAway, true);
      document.removeEventListener("keydown", this.onKey);
      window.removeEventListener("resize", this.onMove);
      window.removeEventListener("scroll", this.onMove, true);
      const card = this.root.querySelector(".card");
      const chip = this.root.querySelector(".chip");
      if (chip) chip.setAttribute("aria-expanded", "false");
      if (withSound) sfx("close");
      if (!card) return;
      const hide = () => (POPOVER ? card.matches(":popover-open") && card.hidePopover() : (card.hidden = true));
      if (still()) hide();
      else {
        card.classList.add("out");
        setTimeout(() => this.isOpen || hide(), 190);
      }
      if (withSound && chip) chip.focus({ preventScroll: true });
    }
    async signOut() {
      const token = store.get();
      try {
        await fetch(`${api}/auth/logout`, {
          method: "POST",
          credentials: mode === "connect" ? "omit" : "same-origin",
          headers: token && mode === "connect" ? { Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" },
        });
      } catch (err) {}
      store.set("");
      sfx("off");
      this.close();
      if (mode === "portal") location.reload();
      else whoAmI(true);
    }
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function stars() {
    let out = "";
    for (let i = 0; i < 14; i++) out += "<i></i>";
    return out;
  }
  let shared = null;
  function sheet() {
    if (!shared) {
      shared = new CSSStyleSheet();
      let starCss = "";
      for (let i = 0; i < 14; i++) starCss += `.stars i:nth-child(${i + 1}) { left: ${(i * 37) % 100}%; top: ${(i * 53) % 100}%; animation-delay: ${(i % 7) * 0.4}s; }\n`;
      shared.replaceSync(CSS + starCss);
    }
    return shared;
  }

  customElements.define("nova-portal-badge", NovaPortalBadge);
  window.NovaPortal = { whoAmI, mode };
})();
