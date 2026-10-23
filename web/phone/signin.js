// Nova Phone: signing in, the very first set-up, and joining with an invite (Nova Desk's Portal sign-in card,
// made for the phone, with the same /auth/* addresses, so no Nova Desk page is needed).
//   #signin[/where/to/go]   sign in (or, when nobody's here yet, set up the first admin), then on to where you were
//   #join/<token>           someone invited picks their name and password (an invite link that's expired says so)
// And the session watch (Portal's, every 45 s while the app is open and on screen): signed out elsewhere, or switched
// off by an admin, and it says so and goes to Sign in; made an admin (or not) meanwhile, and the screen is drawn again.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, field, toast, busy } = N;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const LAST = "nova-phone-last-email";
  const first = (name) => String(name || "").trim().split(/\s+/)[0] || "";
  // (the email last used here, so it's filled in next time: a convenience only, never needed)
  const lastEmail = { get: () => { try { return localStorage.getItem(LAST) || ""; } catch (e) { return ""; } }, set: (v) => { try { if (v) localStorage.setItem(LAST, v); } catch (e) {} } };

  // The sign-in addresses answer with an error to show (a wrong password is a 401 here, not "sign in first")
  async function auth(path, body) {
    let res;
    try {
      res = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data: data || {} };
  }
  // Where to go after: a screen of Nova Phone (never Sign in itself)
  const cleanBack = (path) => { const b = path.filter(Boolean).join("/"); return /^(signin|join)(\/|$)/.test(b) ? "" : b; };

  // A form's own problem line, and the box to fix
  function sayer(form) {
    const line = form.querySelector("[data-err]");
    return (text, input) => { line.textContent = text || ""; if (text && input) input.focus(); return false; };
  }
  const head = (kicker, title, text) => `<div class="card signin-head"><p class="kicker">${esc(kicker)}</p><h2 class="card-title">${esc(title)}</h2>${text ? `<p class="muted">${esc(text)}</p>` : ""}</div>`;
  const pw = (label, name, auto) => field({ label, name, type: "password", attrs: `autocomplete="${auto}"` });
  const formEnd = (ok) => `<p class="form-said bad" data-err role="alert"></p><button class="btn main wide" type="submit">${esc(ok)}</button>`;

  // Signed in (from any of the three): on to where you were; someone new meets their planet
  function signedIn(staff, message, back, fresh = false) {
    lastEmail.set(staff.email);
    watch.was = true;
    watch.role = staff.role || "";
    location.hash = `#${fresh ? "you" : back || "today"}`;
    toast(message);
  }

  // ---- 1. Signing in ----
  function drawLogin(box, ui, back, sub) {
    ui.title("Sign in");
    const email = lastEmail.get();
    box.innerHTML = `${head("Nova Agent · Novacane", "Sign in", sub || (back ? "Sign in to carry on." : "One sign-in for all of Nova Agent."))}
      <form class="form" data-login novalidate>
        ${field({ label: "Email", name: "email", type: "email", value: email, attrs: 'autocomplete="username" inputmode="email" spellcheck="false" autocapitalize="off"' })}
        ${pw("Password", "password", "current-password")}
        ${formEnd("Sign in")}
      </form>
      <p class="muted small signin-note">Signed in to all of Nova Agent on this phone: Nova Phone, Portal, Index and the admin pages.</p>
      <p class="muted small signin-note">New to the crew? Open the invite link an admin sent you. Forgotten your password? An admin can give you a new one (The crew → your name → Set a new password).</p>`;
    const form = box.querySelector("[data-login]");
    const say = sayer(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      const em = f.email.value.trim();
      if (!em) return say("Enter your email address.", f.email);
      if (!f.password.value) return say("Enter your password.", f.password);
      say("");
      try {
        const r = await busy(form.querySelector("[type=submit]"), "Signing in…", () => auth("/auth/login", { email: em, password: f.password.value }));
        if (r.ok && r.data.staff) return signedIn(r.data.staff, `Signed in to all of Nova Agent. Hi, ${first(r.data.staff.display_name)}!`, back);
        say(r.data.error || `That didn't work (error ${r.status}). Try again.`);
        if (r.status === 401) { f.password.value = ""; f.password.focus(); }
      } catch (err) { say(err.message); }
    });
  }

  // ---- 2. Setting up (nobody here yet): the first admin, proven with the studio's shared password ----
  function drawSetup(box, ui, back) {
    ui.title("Set up Portal");
    box.innerHTML = `${head("First time here", "Set up Portal", "You'll be the first admin. Everyone else joins with an invite link from you.")}
      <form class="form" data-setup novalidate>
        ${field({ label: "Your name", name: "name", placeholder: "e.g. Dominic", attrs: 'autocomplete="name" maxlength="60"' })}
        ${field({ label: "Email", name: "email", type: "email", placeholder: "you@novacane.studio", attrs: 'inputmode="email" spellcheck="false" autocapitalize="off"' })}
        ${pw("New password", "password", "new-password")}
        ${pw("Type it again", "again", "new-password")}
        ${field({ label: "The studio's current password", name: "studio", type: "password", hint: "The studio's shared password (from before Portal), to prove it's you.", attrs: 'autocomplete="off"' })}
        ${formEnd("Set up and sign in")}
      </form>`;
    const form = box.querySelector("[data-setup]");
    const say = sayer(form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = form.elements;
      const name = f.name.value.trim(), email = f.email.value.trim();
      if (!name) return say("What's your name?", f.name);
      if (!EMAIL.test(email)) return say("Enter your email address.", f.email);
      if (!f.password.value) return say("Type a password.", f.password);
      if (f.password.value !== f.again.value) return say("The two new passwords don't match.", f.again);
      if (!f.studio.value) return say("Enter the studio's shared password (from before Portal).", f.studio);
      say("");
      try {
        const r = await busy(form.querySelector("[type=submit]"), "Setting up…", () => auth("/auth/setup", { studio_password: f.studio.value, email, password: f.password.value, display_name: name }));
        if (r.ok && r.data.staff) return signedIn(r.data.staff, `Portal is ready. Welcome, ${first(r.data.staff.display_name)}!`, back, true);
        if (r.status === 409) return drawLogin(box, ui, back, "Portal is already set up. Sign in instead.");
        say(r.data.error || `That didn't work (error ${r.status}). Try again.`);
        if (r.status === 401) { f.studio.select(); f.studio.focus(); }
      } catch (err) { say(err.message); }
    });
  }

  N.section({
    id: "signin",
    name: "Sign in",
    tile: "portal",
    async draw(box, path, ui) {
      await N.css("you.css");
      const back = cleanBack(path);
      const st = await auth("/auth/status");
      // (already signed in on this phone: straight on)
      if (st.ok && st.data.signedIn) {
        box.innerHTML = N.skeleton(2);
        queueMicrotask(() => location.replace(`#${back || "today"}`));
        return;
      }
      if (st.ok && st.data.setupNeeded) return drawSetup(box, ui, back);
      drawLogin(box, ui, back, path[0] === "out" ? "Signed out. Sign in again to carry on." : "");
    },
  });

  // ---- 3. Joining with an invite link ----
  function gone(box, why) {
    box.innerHTML = `${head("Invite link", "This link has drifted off", why)}<a class="btn main wide" href="#signin">Sign in instead</a>
      <p class="muted small signin-note">Already joined? Sign in with your email and password. Otherwise ask an admin for a new invite link.</p>`;
  }
  N.section({
    id: "join",
    name: "Your invite",
    tile: "portal",
    async draw(box, [token], ui) {
      await N.css("you.css");
      ui.title("Your invite");
      const GONE = "This invite link has expired or was already used. Ask an admin for a new one.";
      if (!token) return gone(box, GONE);
      const r = await auth(`/auth/invite?token=${encodeURIComponent(token)}`);
      if (!r.ok) return gone(box, r.data.error || GONE);
      const who = r.data;
      box.innerHTML = `${head("You're invited", who.display_name ? `Welcome aboard, ${first(who.display_name)}` : "Welcome aboard", `You're joining Novacane's Nova Agent as ${who.role === "admin" ? "an admin" : "a member of staff"}, with ${who.email}. Choose a password and your planet will be waiting.`)}
        <form class="form" data-join novalidate>
          ${field({ label: "Your name, as the crew will see it", name: "name", value: who.display_name || "", attrs: 'autocomplete="name" maxlength="60"' })}
          <input class="signin-user" type="email" name="user" value="${esc(who.email || "")}" autocomplete="username" tabindex="-1" aria-hidden="true">
          ${pw("Choose a password", "password", "new-password")}
          ${pw("Type it again", "again", "new-password")}
          ${formEnd("Join and meet my planet")}
        </form>`;
      const form = box.querySelector("[data-join]");
      const say = sayer(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = form.elements;
        const name = f.name.value.trim();
        if (!name) return say("What should the crew call you?", f.name);
        if (!f.password.value) return say("Type a password.", f.password);
        if (f.password.value !== f.again.value) return say("The two passwords don't match.", f.again);
        say("");
        try {
          const res = await busy(form.querySelector("[type=submit]"), "Joining…", () => auth("/auth/invite/accept", { token, password: f.password.value, display_name: name }));
          if (res.ok && res.data.staff) return signedIn(res.data.staff, `Welcome to the crew, ${first(res.data.staff.display_name)}. This planet is yours.`, "", true);
          if (res.status === 404) return gone(box, res.data.error || GONE);
          say(res.data.error || `That didn't work (error ${res.status}). Try again.`);
        } catch (err) { say(err.message); }
      });
    },
  });

  // ---- The session watch (Portal's): an admin may switch someone off; signing out elsewhere ends it ----
  const EVERY = 45000;
  const watch = { timer: 0, was: false, role: "" };
  const here = () => decodeURIComponent(location.hash.slice(1));
  async function check() {
    if (document.hidden || /^(signin|join)(\/|$)/.test(here())) return;
    let res;
    try { res = await fetch("/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } }); } catch (e) { return; } // (offline for a moment: next time)
    if (res.status === 401) {
      // (only someone who was signed in is told: a phone that never was already shows Sign in)
      if (watch.was) {
        watch.was = false;
        toast("You've been signed out. Sign in again to carry on.");
        location.hash = `#signin/${here()}`;
      }
      return;
    }
    if (!res.ok) return;
    const role = (await res.json().catch(() => null))?.staff?.role || "";
    // (made an admin, or not, meanwhile: the screen follows)
    const changed = watch.was && watch.role && role && role !== watch.role;
    watch.was = true;
    watch.role = role;
    if (changed) N.show();
  }
  function start() {
    clearInterval(watch.timer);
    watch.timer = document.hidden ? 0 : setInterval(check, EVERY);
  }
  // (nothing while the app is hidden; back on screen, a look straight away)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); start(); });
  check();
  start();
  N.session = { check };
})();
