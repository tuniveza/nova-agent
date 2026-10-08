// Portal: the studio's staff app, one sign-in for every Nova app, and everyone's planet.
//
// This runs the page: who's signed in, which tab shows, and Portal's own parts. The work tabs
// (Enquiries, Chats, Calendar, Quests, Alerts, NovaBot: what was Hub) are app.js, started here
// with window.NovaHub once someone's signed in.
// Each member of the studio gets a profile, drawn as a planet grown from their own seed (the
// server draws it: /staff/<id>/planet.svg).
//   Setup     the very first time: the first admin, proven with the studio's current password
//   Sign in   email and password; signs in Index and the admin pages too
//   Invite    ?invite=<token>: someone joining picks their name and password
//   Work tabs ?view=enquiries|chats|calendar|quests|alerts|bot (no ?view: the starting tab from Options)
//   You       ?view=me: their planet, big and turning; re-roll it, rename, open their Index, sign out
//   Crew      ?view=crew (admins): everyone as planets; invite people, change roles, switch accounts off
// Which one shows depends on the address (?invite=, ?view=, ?id=<someone>, ?next=) and on who's
// signed in (/auth/me) or whether anyone exists yet (/auth/status).
// The site's security rules allow no scripts or styles written inside the page, so it's all here.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || root.getAttribute("data-motion") === "calm";
  const sfx = (name) => window.NovaSfx && window.NovaSfx.play(name);
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const MIN_PASSWORD = 10;
  const SESSION_CHECK_EVERY = 45_000;

  // What the page knows
  const state = {
    screen: "boot", // boot | auth | app
    me: null, // who's signed in
    person: null, // whose profile is showing
    crew: null, // everyone (admins only)
    inviteToken: "",
    inviteRole: "staff",
    next: "", // where to go after signing in (a same-site path), if anywhere
    rolling: false,
    checkTimer: 0,
    lastEmail: "",
  };
  const isAdmin = () => Boolean(state.me && state.me.role === "admin");
  // The work tabs (app.js)
  const hub = () => window.NovaHub;
  const WORK = ["enquiries", "chats", "calendar", "quests", "alerts", "bot"];
  // Tell the top-right badge (and other panels) that who's signed in has changed
  const changed = () => window.NovaPortal && window.NovaPortal.changed && window.NovaPortal.changed();

  // ===== Little helpers =====

  // Make an element: el("p", "class", "text") or el("div", "class", [children])
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (Array.isArray(content)) node.append(...content.filter((c) => c !== null && c !== undefined && c !== false));
    else if (content !== undefined && content !== null && content !== "") node.textContent = String(content);
    return node;
  }
  function button(className, text, onClick, extra = {}) {
    const b = el("button", className, text);
    b.type = "button";
    for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }
  // Start a CSS animation again from the beginning (by taking its class off and putting it back)
  function replay(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Their";
  const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

  // Times come as ISO dates ("2026-10-07T…") or as milliseconds; this makes either into milliseconds
  function toMs(when) {
    if (when === null || when === undefined || when === "") return 0;
    const n = Number(when);
    if (Number.isFinite(n) && String(when).trim() !== "") return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(when);
    return Number.isNaN(t) ? 0 : t;
  }
  // "just now", "4 min ago", "3 h ago", "2 days ago", "6 Oct"
  function ago(when) {
    const ms = toMs(when);
    if (!ms) return "";
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 7 * 86400) return plural(Math.round(s / 86400), "day") + " ago";
    return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: s > 300 * 86400 ? "numeric" : undefined });
  }
  const monthYear = (when) => (toMs(when) ? new Date(toMs(when)).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "");
  const longDate = (when) => (toMs(when) ? new Date(toMs(when)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
  const fullDate = (when) => (toMs(when) ? new Date(toMs(when)).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

  // Where to go after signing in: only a path on this site ("/admin"), never another website
  // ("//evil.example", "https://…", "/\evil") or anything odd. Portal itself (or Hub's old
  // address, which is Portal now) means staying here.
  function safeNext(raw) {
    const v = String(raw || "");
    if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\u0000-\u001f\\]/.test(v)) return "";
    try {
      const url = new URL(v, location.origin);
      if (url.origin !== location.origin) return "";
      if (/^\/(portal|app)(\/|$)/.test(url.pathname) && !url.pathname.startsWith("/app/memory")) return "";
      return url.pathname + url.search + url.hash;
    } catch (err) {
      return "";
    }
  }

  // A friendly name for where "next" goes
  function nextName(path) {
    if (path.startsWith("/app/memory")) return "Index";
    if (path.startsWith("/admin")) return "the admin pages";
    return "";
  }

  // A planet picture's address. The seed is in it, so a re-rolled planet is a new picture
  // (the server lets browsers keep a planet for 5 minutes).
  function planetUrl(person, size, animate) {
    const p = new URLSearchParams({ size: String(size) });
    if (animate) p.set("animate", "1");
    p.set("v", String(person.planet_seed || person.id) + (person.planet_overrides ? "." + JSON.stringify(person.planet_overrides).length : ""));
    return `/staff/${encodeURIComponent(person.id)}/planet.svg?${p}`;
  }
  // Fetch a picture before showing it, so it can swap in all at once
  function preload(url) {
    return new Promise((done) => {
      const img = new Image();
      const finish = () => done(img);
      const timer = setTimeout(finish, 8000);
      img.onload = img.onerror = () => {
        clearTimeout(timer);
        finish();
      };
      img.src = url;
    });
  }

  // A short message at the bottom of the screen
  let toastTimer = 0;
  function toast(message, bad = false) {
    const t = $("toast");
    t.textContent = message;
    t.classList.toggle("bad", bad);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), bad ? 4600 : 3000);
    if (bad) sfx("error");
  }

  // ===== Talking to the server =====

  class Problem extends Error {}

  // Every request: same site, JSON. Returns { status, ok, data } (never throws for an error reply).
  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json", "X-Nova-App": "portal" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(path, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (err) {
      throw new Problem("Can't reach Portal. Check the connection and try again.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch (err) {}
    return { status: res.status, ok: res.ok, data: data || {} };
  }
  // The same, for signed-in pages: a 401 means the session has ended; anything else that
  // isn't success becomes a friendly error
  async function must(path, options) {
    const r = await api(path, options);
    if (r.status === 401 && state.screen === "app") {
      signedOut("You've been signed out. Sign in again to carry on.");
      throw new Problem("Please sign in again.");
    }
    if (!r.ok) throw new Problem(r.data.error || `That didn't work (error ${r.status}). Try again.`);
    return r.data;
  }

  // ===== Screens: loading, signing in, the app =====

  function showScreen(name) {
    state.screen = name;
    $("boot").hidden = name !== "boot";
    $("auth").hidden = name !== "auth";
    $("app").hidden = name !== "app";
    document.body.classList.toggle("signed-in", name === "app");
    document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
  }

  // One card on the sign-in screen: setup, sign in, invite, or a spent invite
  function showAuthCard(id, sub) {
    const first = state.screen !== "auth";
    showScreen("auth");
    for (const card of ["setup-form", "login-form", "invite-form", "invite-gone"]) $(card).hidden = card !== id;
    $("auth-sub").textContent = sub;
    replay($(id), "screen-in");
    if (first) replay($("auth"), "screen-in");
    document.title = "Portal";
    stopChecks();
  }
  function focusSoon(node) {
    setTimeout(() => node && node.focus({ preventScroll: true }), 60);
  }
  function setError(id, message, card) {
    $(id).textContent = message || "";
    if (message && card && !still()) replay(card, "shake");
  }

  // "At least 10 characters" lights up once it's long enough
  for (const check of document.querySelectorAll(".len-check")) {
    const input = $(check.dataset.for);
    input.addEventListener("input", () => check.classList.toggle("good", input.value.length >= MIN_PASSWORD));
  }

  // Wait for a button's request: it can't be pressed twice, and says what's happening
  async function busy(btn, label, work) {
    const was = btn.textContent;
    btn.disabled = true;
    btn.classList.add("busy");
    if (label) btn.textContent = label;
    try {
      return await work();
    } finally {
      btn.disabled = false;
      btn.classList.remove("busy");
      if (label) btn.textContent = was;
    }
  }

  // ----- 1. Setup (no one here yet) -----
  function showSetup() {
    showAuthCard("setup-form", "One sign-in for every Nova app");
    focusSoon($("setup-name"));
  }
  $("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("setup-form");
    const name = $("setup-name").value.trim();
    const email = $("setup-email").value.trim();
    const password = $("setup-password").value;
    const studio = $("setup-studio").value;
    // Say what's missing before asking the server
    if (!name) return setError("setup-error", "What's your name?", form), $("setup-name").focus();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("setup-error", "Enter your email address.", form), $("setup-email").focus();
    if (password.length < MIN_PASSWORD) return setError("setup-error", `Your new password needs at least ${MIN_PASSWORD} characters.`, form), $("setup-password").focus();
    if (password !== $("setup-confirm").value) return setError("setup-error", "The two new passwords don't match.", form), $("setup-confirm").focus();
    if (!studio) return setError("setup-error", "Enter the studio's shared password (from before Portal).", form), $("setup-studio").focus();
    setError("setup-error", "");
    const go = form.querySelector('button[type="submit"]');
    try {
      const r = await busy(go, "Setting up…", () => api("/auth/setup", { method: "POST", body: { studio_password: studio, email, password, display_name: name } }));
      if (r.ok && r.data.staff) {
        sfx("done");
        form.reset();
        return signedIn(r.data.staff, `Portal is ready. Welcome, ${firstName(r.data.staff.display_name)}!`, true);
      }
      if (r.status === 409) {
        showLogin("Portal is already set up. Sign in instead.");
        return;
      }
      setError("setup-error", r.data.error || `That didn't work (error ${r.status}). Try again.`, form);
      sfx("error");
      if (r.status === 401) {
        $("setup-studio").select();
        $("setup-studio").focus();
      }
    } catch (err) {
      setError("setup-error", err.message, form);
      sfx("error");
    }
  });

  // ----- 2. Signing in -----
  function showLogin(sub) {
    const where = nextName(state.next);
    showAuthCard("login-form", sub || (where ? `Sign in to carry on to ${where}` : "One sign-in for every Nova app"));
    setError("login-error", "");
    $("login-password").value = "";
    if (state.lastEmail && !$("login-email").value) $("login-email").value = state.lastEmail;
    focusSoon($("login-email").value ? $("login-password") : $("login-email"));
  }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("login-form");
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email) return setError("login-error", "Enter your email address.", form), $("login-email").focus();
    if (!password) return setError("login-error", "Enter your password.", form), $("login-password").focus();
    setError("login-error", "");
    const go = form.querySelector('button[type="submit"]');
    try {
      const r = await busy(go, "Signing in…", () => api("/auth/login", { method: "POST", body: { email, password } }));
      if (r.ok && r.data.staff) {
        sfx("done");
        $("login-password").value = "";
        return signedIn(r.data.staff, `Signed in to every Nova app. Hi, ${firstName(r.data.staff.display_name)}!`);
      }
      setError("login-error", r.data.error || `That didn't work (error ${r.status}). Try again.`, form);
      sfx("error");
      if (r.status === 401) {
        $("login-password").value = "";
        $("login-password").focus();
      }
    } catch (err) {
      setError("login-error", err.message, form);
      sfx("error");
    }
  });

  // ----- 3. Joining with an invite -----
  async function showInvite(token) {
    state.inviteToken = token;
    const r = await api("/auth/invite?token=" + encodeURIComponent(token));
    if (!r.ok) {
      $("invite-gone-why").textContent = r.data.error || "This invite link has expired or was already used. Ask an admin for a new one.";
      showAuthCard("invite-gone", "Your invite to Nova Agent");
      return;
    }
    const who = r.data;
    $("invite-title").textContent = who.display_name ? `Welcome aboard, ${firstName(who.display_name)}` : "Welcome aboard";
    $("invite-for").textContent = `You're joining Novacane's Nova Agent as ${who.role === "admin" ? "an admin" : "a member of staff"}, with ${who.email}. Choose a password and your planet will be waiting.`;
    $("invite-name").value = who.display_name || "";
    $("invite-email").value = who.email || "";
    state.lastEmail = who.email || "";
    showAuthCard("invite-form", "Your invite to Nova Agent");
    focusSoon($("invite-name").value ? $("invite-password") : $("invite-name"));
  }
  $("invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("invite-form");
    const name = $("invite-name").value.trim();
    const password = $("invite-password").value;
    if (!name) return setError("invite-error", "What should the crew call you?", form), $("invite-name").focus();
    if (password.length < MIN_PASSWORD) return setError("invite-error", `Your password needs at least ${MIN_PASSWORD} characters.`, form), $("invite-password").focus();
    if (password !== $("invite-confirm").value) return setError("invite-error", "The two passwords don't match.", form), $("invite-confirm").focus();
    setError("invite-error", "");
    const go = form.querySelector('button[type="submit"]');
    try {
      const r = await busy(go, "Joining…", () => api("/auth/invite/accept", { method: "POST", body: { token: state.inviteToken, password, display_name: name } }));
      if (r.ok && r.data.staff) {
        sfx("done");
        form.reset();
        state.inviteToken = "";
        return signedIn(r.data.staff, `Welcome to the crew, ${firstName(r.data.staff.display_name)}. This planet is yours.`, true);
      }
      if (r.status === 404) {
        $("invite-gone-why").textContent = r.data.error || "This invite link has expired or was already used. Ask an admin for a new one.";
        showAuthCard("invite-gone", "Your invite to Nova Agent");
        sfx("error");
        return;
      }
      setError("invite-error", r.data.error || `That didn't work (error ${r.status}). Try again.`, form);
      sfx("error");
    } catch (err) {
      setError("invite-error", err.message, form);
      sfx("error");
    }
  });
  $("invite-gone-signin").addEventListener("click", () => {
    history.replaceState(null, "", "/portal/");
    showLogin();
  });

  // ----- Signed in (from any of the three) -----
  function signedIn(staff, message, fresh = false) {
    // (the reply is read just before this sign-in is recorded, so "last signed in" is now)
    state.me = { ...staff, last_login_at: staff.last_login_at || new Date().toISOString() };
    state.lastEmail = staff.email || state.lastEmail;
    changed();
    // Came from another Nova app? Back there now.
    if (state.next) {
      location.assign(state.next);
      return;
    }
    // Stay on the tab the address asked for; someone new lands on their planet
    history.replaceState(null, "", fresh ? "/portal/?view=me" : "/portal/" + keptSearch() + location.hash);
    enterApp({ message, fresh });
  }
  // The address's ?view= / ?id= (not the sign-in ones: invite, next; connect is from before)
  function keptSearch() {
    const p = new URLSearchParams(location.search);
    for (const k of ["invite", "next", "connect"]) p.delete(k);
    const q = p.toString();
    return q ? "?" + q : "";
  }

  // Signed out (by choice, by an admin, or the session ran out): back to the sign-in card
  function signedOut(message) {
    if (state.screen !== "app") return;
    if (hub()) hub().stop();
    changed();
    state.lastEmail = (state.me && state.me.email) || state.lastEmail;
    state.me = null;
    state.person = null;
    state.crew = null;
    $("planet").removeAttribute("src");
    delete $("planet").dataset.src;
    history.replaceState(null, "", "/portal/");
    showLogin("Signed out. Sign in again to carry on.");
    if (message) toast(message);
  }

  // ===== The app (signed in) =====

  function enterApp({ message, fresh } = {}) {
    showScreen("app");
    window.scrollTo(0, 0); // (a long sign-in form may have been scrolled)
    replay($("app"), "screen-in");
    drawNav();
    if (hub()) hub().start();
    renderRoute({ fresh });
    startChecks();
    if (message) setTimeout(() => toast(message), fresh ? 900 : 200);
  }

  // The tab bar: my own planet as the You tab; the crew and the admin pages (admins) are on it
  function drawNav() {
    const me = state.me;
    const badge = $("nav-me-planet");
    const url = planetUrl(me, 64, false);
    if (badge.getAttribute("src") !== url) badge.src = url;
    $("open-crew").hidden = !isAdmin();
    $("open-admin").hidden = !isAdmin();
  }
  // The You tab lights up for my profile, the crew and someone's profile
  function markNav() {
    for (const tab of document.querySelectorAll(".tabs .tab")) {
      const on = tab.dataset.view === "you";
      tab.classList.toggle("active", on);
      if (on) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
  }

  // Which screen the address asks for
  function currentRoute() {
    const p = new URLSearchParams(location.search);
    const view = p.get("view") || "";
    if (view === "crew") return { view: "crew" };
    const id = p.get("id");
    if (id && (!state.me || id !== state.me.id)) return { view: "person", id };
    if (view === "me" || view === "you" || id) return { view: "me" };
    if (WORK.includes(view)) return { view: "work", tab: view };
    // Nothing asked for: Alerts from a Nova Agent notification, else the starting tab (Options)
    if (location.hash === "#nova") return { view: "work", tab: "alerts" };
    const start = window.NovaOptions ? window.NovaOptions.get().startTab : "";
    if (start === "you") return { view: "me" };
    return { view: "work", tab: WORK.includes(start) ? start : "enquiries" };
  }
  // Move to another screen inside the app (the address changes, so back and forward work;
  // switching work tabs replaces it instead, so Back leaves the page rather than stepping through tabs)
  function go(url, { replace = false } = {}) {
    if (url === "/portal/?view=you") url = "/portal/?view=me";
    if (url !== location.pathname + location.search) history[replace ? "replaceState" : "pushState"](null, "", url);
    if (state.screen !== "app") return;
    renderRoute();
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  window.addEventListener("popstate", () => {
    if (state.screen === "app") renderRoute();
    else start();
  });
  // Links to my profile, the crew, and someone's profile stay inside the page
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-nav]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (state.screen !== "app") return;
    e.preventDefault();
    sfx("tab");
    go(a.getAttribute("href"));
  });

  async function renderRoute({ fresh } = {}) {
    const route = currentRoute();
    closeNameForm();
    if (route.view === "work") {
      document.title = "Portal";
      return hub() && hub().show(route.tab);
    }
    markNav();
    if (route.view === "crew") {
      if (!isAdmin()) {
        history.replaceState(null, "", "/portal/");
        toast("The crew page is for admins.", true);
        return renderRoute();
      }
      showView("view-crew");
      document.title = "The crew · Portal";
      return loadCrew();
    }
    if (route.view === "me") {
      showView("view-profile");
      return renderProfile(state.me, { fresh });
    }
    // Someone else's profile (fetched first, so the last profile doesn't flash up meanwhile)
    try {
      const data = await must(`/staff/${encodeURIComponent(route.id)}`);
      if (currentRoute().id !== route.id) return; // moved on meanwhile
      showView("view-profile");
      renderProfile(data.staff);
    } catch (err) {
      if (state.screen !== "app") return;
      toast(err.message, true);
      history.replaceState(null, "", isAdmin() ? "/portal/?view=crew" : "/portal/");
      renderRoute();
    }
  }
  // One view at a time (the work tabs' views too)
  function showView(id) {
    for (const v of document.querySelectorAll("#main > .view")) {
      const on = v.id === id;
      if (v.hidden === !on) continue;
      v.hidden = !on;
      if (on) replay(v, "view-in");
    }
  }

  // ===== A profile =====

  function renderProfile(person, { fresh = false } = {}) {
    const self = person.id === state.me.id;
    const changedPerson = !state.person || state.person.id !== person.id;
    state.person = person;
    document.title = self ? "Portal" : `${person.display_name} · Portal`;

    $("back-to-crew").hidden = self || !isAdmin();
    $("p-kicker").textContent = self ? "Your profile" : "Crew member";
    $("p-name").textContent = person.display_name;
    $("p-name").hidden = false;
    const pills = [el("span", "pill " + (person.role === "admin" ? "admin" : "staff"), person.role === "admin" ? "Admin" : "Staff")];
    if (person.status !== "active") pills.push(statusPill(person.status));
    $("p-pills").replaceChildren(...pills);
    $("p-since").textContent = person.status === "invited" ? `Invited ${monthYear(person.created_at)}` : `Member since ${monthYear(person.created_at)}`;

    // The planet: blooms in when it's someone new (or the first time), otherwise stays put
    setPlanet(person, changedPerson || fresh);

    // What I can do: everything on my own; an admin can open someone's Index
    $("self-actions").hidden = !(self || isAdmin());
    document.querySelector(".action-grid").hidden = !self;
    $("open-index").href = `/app/memory/?scope=staff&owner=${encodeURIComponent(person.id)}`;
    $("open-index-label").textContent = self ? "Open my Index" : `Open ${possessive(firstName(person.display_name))} Index`;
    $("reset-planet").hidden = !self || !person.planet_seed || person.planet_seed === person.id;
    evenActions();

    $("admin-card").hidden = self || !isAdmin();
    if (!self && isAdmin()) renderAdmin(person);

    renderDetails(person, self);

    $("google-card").hidden = !self;
    if (self) loadGoogle();

    // Their memory (only for themselves and admins)
    const canSeeMemory = self || isAdmin();
    $("memory-card").hidden = !canSeeMemory;
    if (canSeeMemory) loadMemory(person, self);
  }

  // Google, for the studio: Notes' Google Docs, and Calendar and Gmail for bookings. You sign
  // in with Portal; Google is only connected (once, by an admin, in Admin → Google).
  async function loadGoogle() {
    const say = (text) => ($("google-status").textContent = text);
    let r;
    try {
      r = await api("/auth/google-status");
    } catch (err) {
      return say("Can't check Google just now.");
    }
    const d = r.ok ? r.data : {};
    const admin = isAdmin();
    say(
      d.account
        ? `Connected as ${d.account} ✓`
        : d.setUp
          ? admin ? "Almost there: one step left." : "Not connected yet. Ask an admin to connect Google."
          : admin ? "Not set up yet. It takes about 5 minutes, one step at a time." : "Not connected. Ask an admin to connect Google."
    );
    const button = $("google-setup");
    button.hidden = !admin;
    button.textContent = d.account ? "Google settings" : d.setUp ? "Connect Google" : "Set up Google";
  }
  $("google-setup").addEventListener("click", () => {
    // Inside Nova Agent: Admin → Google in its viewer. On its own: the admin page itself.
    for (const w of [window.top, window]) {
      try {
        if (w.NovaAgent && w.NovaAgent.open) return w.NovaAgent.open("/admin/google/setup");
      } catch (err) {}
    }
    location.href = "/admin/google/setup";
  });

  // Two buttons a row: when there's an odd one out, the last (Sign out) takes the whole row
  function evenActions() {
    const shown = [...document.querySelectorAll(".action-grid .btn")].filter((b) => !b.hidden);
    shown.forEach((b, i) => b.classList.toggle("span", shown.length % 2 === 1 && i === shown.length - 1));
  }

  function statusPill(status) {
    if (status === "invited") return el("span", "pill invited", "Invited");
    if (status === "disabled") return el("span", "pill disabled", "Switched off");
    return el("span", "pill active", "Active");
  }

  // Put a planet on the stage (and find out what it's like for the caption)
  async function setPlanet(person, bloom) {
    const img = $("planet");
    const url = planetUrl(person, 512, true);
    img.alt = `${possessive(person.display_name)} planet`;
    if (img.dataset.src === url && !bloom) return;
    img.dataset.src = url;
    loadCaption(person);
    if (still()) {
      img.src = url;
      return;
    }
    img.classList.remove("going", "coming");
    img.classList.add("loading");
    await preload(url);
    if (img.dataset.src !== url) return; // another planet was asked for meanwhile
    img.src = url;
    img.classList.remove("loading");
    replay(img, "coming");
    replay($("stage"), "warp");
  }

  // The caption: what the planet generator says this world is like (it's the picture's <title>)
  async function loadCaption(person) {
    const cap = $("planet-caption");
    cap.classList.add("fade");
    let text = "";
    try {
      // The same picture the stage shows (so it's already cached)
      const res = await fetch(planetUrl(person, 512, true), { credentials: "same-origin" });
      const svg = await res.text();
      const m = svg.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) {
        const box = document.createElement("textarea"); // decodes &amp; and friends, safely
        box.innerHTML = m[1];
        text = box.value.replace(/\s+/g, " ").trim();
      }
    } catch (err) {}
    if (!state.person || state.person.id !== person.id) return;
    const prefix = person.display_name + " · ";
    if (text.startsWith(prefix)) text = text.slice(prefix.length);
    if (!text || text === person.display_name) text = `A world of its own, grown from ${possessive(firstName(person.display_name))} seed.`;
    // The generator names each world: "Solvene: Ice world · violet & cyan · 1 moon"
    const named = text.match(/^([^:·]{1,40}):\s*(.+)$/);
    if (named) cap.replaceChildren(el("span", "world-name", named[1].trim()), el("span", "world-desc", named[2]));
    else cap.replaceChildren(el("span", "world-desc", text.charAt(0).toUpperCase() + text.slice(1)));
    cap.title = text;
    cap.classList.remove("fade");
  }

  // ----- Re-rolling: a new world (or back to the first one) -----
  async function reroll(kind) {
    if (state.rolling || !state.me) return;
    state.rolling = true;
    const img = $("planet");
    const stage = $("stage");
    const buttons = [$("reroll"), $("reset-planet")];
    buttons.forEach((b) => (b.disabled = true));
    stage.classList.add("rolling");
    // The old planet starts collapsing straight away, while the server picks the new seed
    let collapsed = Promise.resolve();
    if (!still()) {
      img.classList.remove("coming");
      replay(img, "going");
      collapsed = wait(480);
    }
    $("planet-caption").classList.add("fade");
    try {
      const data = await must(`/staff/${encodeURIComponent(state.me.id)}`, { method: "PATCH", body: { planet_seed: kind } });
      state.me = { ...state.me, ...data.staff };
      state.person = state.me;
      const url = planetUrl(state.me, 512, true);
      await Promise.all([collapsed, preload(url)]);
      img.dataset.src = url;
      img.src = url;
      img.classList.remove("going");
      if (!still()) {
        replay(stage, "warp");
        replay(img, "coming");
      }
      sfx("done");
      loadCaption(state.me);
      drawNav();
      renderDetails(state.me, true);
      $("reset-planet").hidden = state.me.planet_seed === state.me.id;
      evenActions();
      toast(kind === "reset" ? "Back to your original planet." : "A brand new world. Re-roll again any time.");
    } catch (err) {
      img.classList.remove("going");
      $("planet-caption").classList.remove("fade");
      if (state.screen === "app") toast(err.message, true);
    } finally {
      stage.classList.remove("rolling");
      buttons.forEach((b) => (b.disabled = false));
      state.rolling = false;
    }
  }
  $("reroll").addEventListener("click", () => reroll("reroll"));
  $("reset-planet").addEventListener("click", () => reroll("reset"));

  // ----- Renaming myself -----
  function openNameForm() {
    $("name-input").value = state.me.display_name;
    $("name-error").textContent = "";
    $("p-name").hidden = true;
    $("name-form").hidden = false;
    $("name-input").focus();
    $("name-input").select();
  }
  function closeNameForm() {
    $("name-form").hidden = true;
    $("p-name").hidden = false;
  }
  $("edit-name").addEventListener("click", openNameForm);
  $("name-cancel").addEventListener("click", closeNameForm);
  $("name-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name-input").value.trim();
    if (!name) return ($("name-error").textContent = "A name is needed.");
    if (name === state.me.display_name) return closeNameForm();
    const go = $("name-form").querySelector('button[type="submit"]');
    try {
      const data = await busy(go, "Saving…", () => must(`/staff/${encodeURIComponent(state.me.id)}`, { method: "PATCH", body: { display_name: name } }));
      state.me = { ...state.me, ...data.staff };
      closeNameForm();
      renderProfile(state.me);
      sfx("done");
      toast("Name saved. The whole suite will use it.");
    } catch (err) {
      $("name-error").textContent = err.message;
      sfx("error");
    }
  });

  // ----- Signing out (everywhere: Portal, Index, the admin pages) -----
  async function signOut() {
    $("options-sheet").hidden = true;
    try {
      await api("/auth/logout", { method: "POST", body: {} });
    } catch (err) {}
    signedOut("Signed out of every Nova app.");
  }
  $("sign-out").addEventListener("click", signOut);

  // ----- Details -----
  function renderDetails(person, self) {
    const rows = [];
    const row = (label, value, mono) => {
      if (!value) return;
      const dd = el("dd", mono ? "mono" : "", value);
      rows.push(el("div", "", [el("dt", "", label), dd]));
    };
    row("Email", person.email);
    row("Role", person.role === "admin" ? "Admin: can invite people and run the admin pages" : "Staff");
    if (person.status !== "active") row("Account", person.status === "invited" ? "Invited, not joined yet" : "Switched off");
    row("Joined", fullDate(person.created_at));
    if (person.last_login_at !== undefined) row("Last sign-in", person.last_login_at ? ago(person.last_login_at) : "Never yet");
    row("Planet seed", person.planet_seed === person.id ? `${person.planet_seed} (the original)` : person.planet_seed, true);
    if (self || isAdmin()) row("Index partition", person.index_partition, true);
    $("details-title").textContent = self ? "About you" : `About ${firstName(person.display_name)}`;
    $("details").replaceChildren(...rows);
  }

  // ----- Their Index: their own files, and what the studio shares with everyone -----
  async function loadMemory(person, self) {
    const list = $("memory-list");
    $("memory-title").textContent = self ? "Your memory" : `${possessive(firstName(person.display_name))} memory`;
    $("memory-hint").textContent = self
      ? "What the Nova apps remember about you, and what the whole studio knows."
      : `What the Nova apps remember about ${firstName(person.display_name)}, and what the whole studio knows.`;
    list.replaceChildren(el("p", "loading-line", "Looking in Index…"));
    let data;
    try {
      data = await must(`/staff/${encodeURIComponent(person.id)}/index`);
    } catch (err) {
      if (!state.person || state.person.id !== person.id) return;
      list.replaceChildren(el("p", "empty", err.message));
      return;
    }
    if (!state.person || state.person.id !== person.id) return;
    const files = Array.isArray(data.files) ? data.files : [];
    const mine = files.filter((f) => f.scope === "staff");
    const studio = files.filter((f) => f.scope === "studio");
    const ownerLink = `/app/memory/?scope=staff&owner=${encodeURIComponent(person.id)}`;
    let i = 0;

    const own = el("div", "mem-group", [el("p", "mem-head", self ? "Yours" : firstName(person.display_name))]);
    if (mine.length) own.append(...mine.map((f) => memFile(f, ownerLink, i++)));
    else {
      const empty = el("p", "empty", [
        el("strong", "", "Nothing yet"),
        self ? "As you use the Nova apps, what they learn about you shows up here." : "Nothing has been remembered about them yet.",
      ]);
      own.append(empty);
    }

    const shared = el("div", "mem-group", [el("p", "mem-head", "The studio · shared")]);
    const SHOW = 4;
    if (studio.length) {
      shared.append(...studio.slice(0, SHOW).map((f) => memFile(f, "/app/memory/?scope=studio", i++)));
      if (studio.length > SHOW) {
        const more = button("btn small ghost mem-more", `Show all ${studio.length}`, () => {
          more.replaceWith(...studio.slice(SHOW).map((f, j) => memFile(f, "/app/memory/?scope=studio", j)));
        }, { "data-sfx": "open" });
        shared.append(more);
      }
    } else shared.append(el("p", "empty", "The studio hasn't shared anything yet."));
    list.replaceChildren(own, shared);
  }
  function memFile(f, href, i) {
    const a = el("a", "mem-file card-in", [
      el("span", "mem-path", f.path),
      f.name && f.name !== f.path ? el("p", "mem-name", f.name) : null,
      f.description ? el("p", "mem-desc", f.description) : null,
      el("span", "mem-meta", [
        el("span", "mem-facts", plural(Number(f.facts) || 0, "fact")),
        f.updated_at ? el("span", "", "updated " + ago(f.updated_at)) : null,
        f.source_app ? el("span", "", "from " + f.source_app) : null,
      ]),
    ]);
    a.href = href;
    a.style.setProperty("--i", String(Math.min(i, 12)));
    return a;
  }

  // ----- Admin: someone else's account -----
  function renderAdmin(person) {
    $("admin-title").textContent = `${possessive(firstName(person.display_name))} account`;
    $("admin-error").textContent = "";
    for (const chip of $("role-chips").querySelectorAll(".chip")) {
      const on = chip.dataset.role === person.role;
      chip.classList.toggle("active", on);
      chip.setAttribute("aria-pressed", String(on));
    }
    const line = {
      active: `Active. ${person.last_login_at ? "Last signed in " + ago(person.last_login_at) + "." : "Hasn't signed in yet."}`,
      invited: "Invited, hasn't joined yet.",
      disabled: "Switched off. They can't sign in to any Nova app.",
    }[person.status] || person.status;
    $("status-line").textContent = line;
    drawStatusActions(person);
    $("admin-invite").replaceChildren();
  }
  function drawStatusActions(person) {
    const box = $("status-actions");
    const items = [];
    if (person.status === "disabled") {
      // Back on: someone who never joined goes back to "invited" (so they can be sent a new link)
      items.push(button("btn small ok", "Switch back on", () => patchPerson(person, { status: person.last_login_at ? "active" : "invited" }, "Switched back on."), { "data-sfx": "on" }));
    } else {
      items.push(button("btn small danger", "Switch off", () => confirmOff(person), { "data-sfx": "open" }));
    }
    if (person.status === "invited") items.push(button("btn small ghost", "New invite link", (e) => newInvite(person, e.currentTarget), { "data-sfx": "send" }));
    box.replaceChildren(...items);
  }
  function confirmOff(person) {
    const box = $("status-actions");
    const name = firstName(person.display_name);
    box.replaceChildren(
      el("div", "confirm", [
        el("p", "", `Switch ${name} off? They'll be signed out of every Nova app straight away.`),
        el("div", "actions", [
          button("btn small danger solid", "Switch off", () => patchPerson(person, { status: "disabled" }, `${name} is switched off and signed out everywhere.`), { "data-sfx": "remove" }),
          button("btn small ghost", "Keep them on", () => drawStatusActions(person), { "data-sfx": "close" }),
        ]),
      ])
    );
  }
  async function patchPerson(person, changes, message) {
    $("admin-error").textContent = "";
    const controls = $("admin-card").querySelectorAll("button");
    controls.forEach((b) => (b.disabled = true));
    try {
      const data = await must(`/staff/${encodeURIComponent(person.id)}`, { method: "PATCH", body: changes });
      if (state.crew) state.crew = state.crew.map((p) => (p.id === person.id ? { ...p, ...data.staff } : p));
      if (state.person && state.person.id === person.id) renderProfile({ ...person, ...data.staff });
      sfx("done");
      toast(message);
    } catch (err) {
      if (state.screen !== "app") return;
      $("admin-error").textContent = err.message;
      sfx("error");
      renderAdmin(person);
    } finally {
      controls.forEach((b) => (b.disabled = false));
    }
  }
  $("role-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    const person = state.person;
    if (!chip || !person || chip.dataset.role === person.role) return;
    patchPerson(person, { role: chip.dataset.role }, chip.dataset.role === "admin" ? `${firstName(person.display_name)} is now an admin.` : `${firstName(person.display_name)} is now staff.`);
  });
  async function newInvite(person, btn) {
    try {
      const data = await busy(btn, "Making a link…", () => must(`/staff/${encodeURIComponent(person.id)}/invite`, { method: "POST", body: {} }));
      $("admin-invite").replaceChildren(inviteBox(person, data.invite_url, data.invite_expires));
      sfx("done");
    } catch (err) {
      $("admin-error").textContent = err.message;
      sfx("error");
    }
  }

  // An invite link, ready to copy or send by email
  function inviteBox(person, link, expires, onDone) {
    const name = firstName(person.display_name);
    const input = el("input");
    input.type = "url";
    input.readOnly = true;
    input.value = link;
    input.setAttribute("aria-label", "Invite link");
    input.addEventListener("focus", () => input.select());
    const copy = button("btn small", "Copy link", async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(link);
        ok = true;
      } catch (err) {
        input.select();
        try {
          ok = document.execCommand("copy");
        } catch (e) {}
      }
      if (ok) {
        copy.textContent = "Copied ✓";
        sfx("done");
        setTimeout(() => (copy.textContent = "Copy link"), 2200);
      } else toast("Couldn't copy. Select the link and copy it.", true);
    }, { "data-sfx": "none" });
    const until = longDate(expires);
    const subject = "Your Portal invite";
    const body = [
      `Hi ${name},`,
      "",
      "You're invited to Portal: the staff app and one sign-in for every Nova app at Novacane Studios.",
      "",
      "Open this link to choose your password and meet your very own planet:",
      link,
      "",
      `The link works once, for 7 days${until ? ` (until ${until})` : ""}.`,
      "",
      "See you in orbit!",
      state.me ? state.me.display_name : "",
    ].join("\n");
    const send = el("a", "btn small ghost", "Send it");
    send.href = `mailto:${encodeURIComponent(person.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    send.setAttribute("data-sfx", "send");
    const actions = el("div", "actions", [send]);
    if (onDone) actions.append(button("btn small ghost", "Done", onDone, { "data-sfx": "close" }));
    return el("div", "invite-box", [
      el("span", "kicker", "Invite link"),
      el("p", "invite-box-title", `Ready for ${person.display_name}`),
      el("p", "hint", `Send it to ${person.email || name}. It works once, for 7 days${until ? `, until ${until}` : ""}.`),
      el("div", "link-row", [input, copy]),
      actions,
    ]);
  }

  // ===== The crew (admins) =====

  async function loadCrew() {
    const grid = $("crew-grid");
    if (!state.crew) grid.replaceChildren(el("p", "loading-line", "Gathering the crew…"));
    try {
      const data = await must("/staff");
      state.crew = data.staff || [];
      drawCrew();
    } catch (err) {
      if (state.screen !== "app") return;
      grid.replaceChildren(el("p", "empty", err.message));
    }
  }
  function drawCrew(newId) {
    const crew = state.crew || [];
    const invited = crew.filter((p) => p.status === "invited").length;
    const off = crew.filter((p) => p.status === "disabled").length;
    $("crew-count").textContent = [plural(crew.length, "person", "people"), invited ? `${invited} invited` : "", off ? `${off} switched off` : ""].filter(Boolean).join(" · ");
    $("crew-grid").replaceChildren(...crew.map((p, i) => crewCard(p, i, p.id === newId)));
  }
  function crewCard(p, i, isNew) {
    const self = state.me && p.id === state.me.id;
    const a = el("a", `crew-card card-in ${p.status}`);
    a.href = self ? "/portal/?view=me" : `/portal/?id=${encodeURIComponent(p.id)}`;
    a.dataset.nav = self ? "me" : "person";
    a.style.setProperty("--i", String(Math.min(i, 16)));
    const badge = el("img", "crew-planet");
    badge.src = planetUrl(p, 96, false);
    badge.alt = "";
    badge.width = 96;
    badge.height = 96;
    badge.loading = "lazy";
    badge.decoding = "async";
    const pills = [el("span", "pill " + (p.role === "admin" ? "admin" : "staff"), p.role === "admin" ? "Admin" : "Staff"), statusPill(p.status)];
    if (self) pills.unshift(el("span", "pill you", "You"));
    a.append(
      el("span", "badge-wrap", [badge]),
      el("p", "crew-name", p.display_name),
      el("span", "crew-pills", pills),
      el("p", "crew-seen", p.status === "invited" ? "Not joined yet" : p.last_login_at ? "Signed in " + ago(p.last_login_at) : "Never signed in")
    );
    a.setAttribute("aria-label", `${p.display_name}, ${p.role}, ${p.status}`);
    if (isNew && !still()) a.classList.add("fresh");
    return a;
  }

  // Inviting someone
  function setInviteRole(role) {
    state.inviteRole = role;
    for (const chip of $("inv-role").querySelectorAll(".chip")) {
      chip.classList.toggle("active", chip.dataset.role === role);
      chip.setAttribute("aria-pressed", String(chip.dataset.role === role));
    }
  }
  function openInviteForm() {
    const form = $("invite-form-card");
    form.hidden = false;
    $("invite-toggle").setAttribute("aria-expanded", "true");
    $("inv-error").textContent = "";
    $("invite-result").replaceChildren();
    replay(form, "invite-new");
    focusSoon($("inv-email"));
  }
  function closeInviteForm() {
    $("invite-form-card").hidden = true;
    $("invite-toggle").setAttribute("aria-expanded", "false");
  }
  $("invite-toggle").addEventListener("click", () => ($("invite-form-card").hidden ? openInviteForm() : closeInviteForm()));
  $("inv-cancel").addEventListener("click", closeInviteForm);
  $("inv-role").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) setInviteRole(chip.dataset.role);
  });
  $("invite-form-card").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = $("invite-form-card");
    const email = $("inv-email").value.trim();
    const name = $("inv-name").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("inv-error", "Enter their email address.", form), $("inv-email").focus();
    setError("inv-error", "");
    const go = form.querySelector('button[type="submit"]');
    try {
      const data = await busy(go, "Making the link…", () => must("/staff", { method: "POST", body: { email, display_name: name, role: state.inviteRole } }));
      sfx("done");
      form.reset();
      setInviteRole("staff");
      closeInviteForm();
      const result = $("invite-result");
      result.replaceChildren(inviteBox(data.staff, data.invite_url, data.invite_expires, () => result.replaceChildren()));
      state.crew = [...(state.crew || []).filter((p) => p.id !== data.staff.id), { ...data.staff, invite_pending: true }];
      drawCrew(data.staff.id);
      result.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
    } catch (err) {
      if (state.screen !== "app") return;
      setError("inv-error", err.message, form);
      sfx("error");
    }
  });

  $("back-to-crew").addEventListener("click", () => go("/portal/?view=crew"));

  // ===== Keeping an eye on the session (an admin may switch someone off; signing out elsewhere ends it) =====
  async function checkSession() {
    if (state.screen !== "app" || document.hidden) return;
    let r;
    try {
      r = await api("/auth/me");
    } catch (err) {
      return; // offline for a moment: try again later
    }
    if (state.screen !== "app") return;
    if (r.status === 401) return signedOut("You've been signed out. Sign in again to carry on.");
    if (r.ok && r.data.staff) {
      const was = state.me;
      state.me = { ...state.me, ...r.data.staff };
      // Made an admin (or not) meanwhile: the bar changes, and the crew page follows
      if (was.role !== state.me.role) {
        drawNav();
        renderRoute();
      }
    }
  }
  function startChecks() {
    stopChecks();
    state.checkTimer = setInterval(checkSession, SESSION_CHECK_EVERY);
  }
  function stopChecks() {
    clearInterval(state.checkTimer);
    state.checkTimer = 0;
  }
  document.addEventListener("visibilitychange", () => !document.hidden && checkSession());
  window.addEventListener("focus", checkSession);

  // (Options, the sound switch and the button ripples are app.js and options.js, for the whole page)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("name-form").hidden) closeNameForm();
  });

  // The orbit's moon is a little SVG animation, which CSS can't pause: stop it for calm motion
  function settleMotion() {
    for (const svg of document.querySelectorAll(".orbit")) {
      if (!svg.pauseAnimations) continue;
      if (still()) svg.pauseAnimations();
      else svg.unpauseAnimations();
    }
  }
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", settleMotion);
  window.addEventListener("novaoptionschange", settleMotion);

  // ===== What app.js uses: moving between tabs, signing out, a session that ended =====
  window.PortalPage = {
    go,
    signOut,
    signedOut,
    refresh: () => state.screen === "app" && renderRoute(),
  };

  // ===== Start: who's here? =====
  async function start() {
    const params = new URLSearchParams(location.search);
    state.next = safeNext(params.get("next"));
    settleMotion();
    try {
      // An invite link wins: whoever's signed in on this device, the link is for someone joining
      const token = params.get("invite");
      if (token) return await showInvite(token);
      const me = await api("/auth/me");
      if (me.ok && me.data.staff) {
        state.me = me.data.staff;
        // Sent here by another Nova app, but already signed in: straight back
        if (state.next) {
          location.replace(state.next);
          return;
        }
        return enterApp();
      }
      const status = await api("/auth/status");
      if (status.ok && status.data.setupNeeded) return showSetup();
      showLogin();
    } catch (err) {
      showLogin();
      toast(err.message, true);
    }
  }
  start();
})();
