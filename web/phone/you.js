// Nova Phone: You and the crew (Nova Desk's Portal → You, The crew).
//   #you            your planet (its name and what it's like; re-roll it, or back to your first), your name, email
//                   and password, About you (role, seed, Index partition), Google, How it works, the admin
//                   places (admins), signing out
//   #you/working    each part of Nova and the service behind it (set up, partly, not), when email last went,
//                   and a test email when email can send one
//   #crew           admins: everyone, with a You marker, invites, who's switched off; invite someone (a link to
//                   send: it works once, for 7 days)
//   #crew/<id>      one person: their planet, About them, role, switch off or back on, a new invite link, a new
//                   email or password, their Index (#crew/<id>/index)
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, choices, empty, api, post, toast, confirm, form: sheetForm, busy } = N;
  const UK = "Europe/London";
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ms = (v) => N.asDate(v)?.getTime() || 0;
  const monthYear = (v) => (ms(v) ? new Date(ms(v)).toLocaleDateString("en-GB", { timeZone: UK, month: "long", year: "numeric" }) : "");
  const fullDate = (v) => (ms(v) ? new Date(ms(v)).toLocaleDateString("en-GB", { timeZone: UK, day: "numeric", month: "long", year: "numeric" }) : "");
  const longDate = (v) => (ms(v) ? new Date(ms(v)).toLocaleDateString("en-GB", { timeZone: UK, weekday: "short", day: "numeric", month: "short" }) : "");
  // (how long ago, in words: "5 min ago", "3 h ago", then the day)
  function since(v) {
    const t = ms(v);
    if (!t) return "";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
    return new Date(t).toLocaleDateString("en-GB", { timeZone: UK, day: "numeric", month: "short", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  }
  const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Their";
  const possessive = (name) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const patch = (id, body) => api(`/staff/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  // A planet's picture. The seed is in its address, so a re-rolled planet is a new picture (the server lets
  // phones keep one for 5 minutes).
  const planetUrl = (p, size) => `/staff/${encodeURIComponent(p.id)}/planet.svg?${new URLSearchParams({ size: String(size), v: String(p.planet_seed || p.id) + (p.planet_overrides ? `.${JSON.stringify(p.planet_overrides).length}` : "") })}`;
  const planet = (p, size, cls = "planet") => `<img class="${cls}" src="${esc(planetUrl(p, size))}" alt="${esc(possessive(p.display_name || "Their"))} planet" width="${size / 2}" height="${size / 2}" decoding="async"${cls.includes("sm") ? ' loading="lazy"' : ""}>`;
  // What the planet generator says the world is like (the picture's own title): "Solvene: Ice world · 1 moon"
  async function worldOf(p) {
    let text = "";
    try {
      const svg = await (await fetch(planetUrl(p, 240), { credentials: "same-origin" })).text();
      const m = svg.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) { const t = document.createElement("textarea"); t.innerHTML = m[1]; text = t.value.replace(/\s+/g, " ").trim(); }
    } catch (e) {}
    const prefix = `${p.display_name} · `;
    if (text.startsWith(prefix)) text = text.slice(prefix.length);
    if (!text || text === p.display_name) return { desc: `A world of its own, grown from ${possessive(firstName(p.display_name))} seed.` };
    const named = text.match(/^([^:·]{1,40}):\s*(.+)$/);
    return named ? { name: named[1].trim(), desc: named[2] } : { desc: text.charAt(0).toUpperCase() + text.slice(1) };
  }
  const caption = (w) => `${w.name ? `<b class="you-world">✦ ${esc(w.name)}</b>` : ""}<span>${esc(w.desc || "")}</span>`;
  // (filled in once known, in room kept for it, so nothing jumps)
  const fillCaption = (box, p) => worldOf(p).then((w) => { const c = box.querySelector("[data-cap]"); if (c) c.innerHTML = caption(w); });

  const pills = (p, self) => `<p class="you-pills">${self ? '<span class="pill you-me">You</span>' : ""}<span class="pill">${p.role === "admin" ? "Admin" : "Staff"}</span>${p.status === "invited" ? '<span class="pill warn">Invited</span>' : p.status === "disabled" ? '<span class="pill bad">Switched off</span>' : ""}</p>`;
  const sinceLine = (p) => `<p class="muted small">${p.status === "invited" ? `Invited ${monthYear(p.created_at)}` : `Member since ${monthYear(p.created_at)}`}</p>`;
  const facts = (rows) => `<div class="facts you-facts">${rows.filter(([, v]) => v).map(([k, v, mono]) => `<div class="fact"><span>${esc(k)}</span><b${mono ? ' class="you-mono"' : ""}>${esc(v)}</b></div>`).join("")}</div>`;
  // About: who they are here (the same lines as Nova Desk's)
  const about = (p, full) => facts([
    ["Email", p.email],
    ["Role", p.role === "admin" ? "Admin: can invite people and run the admin pages" : "Staff"],
    ["Account", p.status === "invited" ? "Invited, not joined yet" : p.status === "disabled" ? "Switched off" : ""],
    ["Joined", fullDate(p.created_at)],
    ["Last sign-in", p.last_login_at !== undefined ? (p.last_login_at ? since(p.last_login_at) : "Never yet") : ""],
    ["Planet seed", p.planet_seed === p.id ? `${p.planet_seed} (the original)` : p.planet_seed, true],
    ["Index partition", full ? p.index_partition : "", true],
  ]);

  // A sheet with a form that says what's wrong inside it, and closes only once it's done
  function sheetDo(title, inner, ok, words, run) {
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f novalidate>${inner}<p class="form-said bad" data-err role="alert"></p><div class="btns"><button class="btn main wide" type="submit">${esc(ok)}</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]"), err = el.querySelector("[data-err]");
        el.querySelector("[data-no]").onclick = () => done(null);
        const stop = (text, input) => { throw Object.assign(new Error(text), { input }); };
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          err.textContent = "";
          try { done((await busy(f.querySelector("[type=submit]"), words, () => run(f.elements, stop))) ?? true); } catch (e) { err.textContent = e.message; e.input?.focus(); }
        };
      });
  }
  const pw = (label, name, auto) => field({ label, name, type: "password", attrs: `autocomplete="${auto}"` });

  // ===== You =====
  N.section({
    id: "you",
    name: "You",
    tile: "portal",
    async draw(box, [part], ui) {
      await N.css("you.css");
      if (part === "working") return drawWorking(box, ui);
      const [{ staff: me }, g] = await Promise.all([api("/auth/me"), api("/auth/google-status").catch(() => null)]);
      const admin = me.role === "admin";
      ui.title("You");
      const w = me.planet?.name || me.planet?.description ? { name: me.planet.name, desc: me.planet.description } : null;
      const gWords = !g ? "Can't check Google just now." : g.account ? `Connected as ${g.account} ✓` : g.setUp ? (admin ? "Almost there: one step left." : "Not connected yet. Ask an admin to connect Google.") : admin ? "Not set up yet. It takes about 5 minutes, one step at a time." : "Not connected. Ask an admin to connect Google.";
      box.innerHTML = `<div class="card profile you-card">${planet(me, 240)}<p class="kicker">Your profile</p><h2 class="card-title">${esc(me.display_name || "")}</h2>${pills(me, false)}${sinceLine(me)}<p class="you-cap" data-cap>${w ? caption(w) : ""}</p></div>
        <div class="btns two"><button type="button" class="btn" data-y="reroll">✦ Re-roll my planet</button>${me.planet_seed && me.planet_seed !== me.id ? '<button type="button" class="btn" data-y="reset">Back to my first planet</button>' : ""}<button type="button" class="btn" data-y="name">${icon("edit")} My name</button><button type="button" class="btn" data-y="email">${icon("mail")} My email</button><button type="button" class="btn" data-y="password">My password</button><a class="btn" href="#index">${icon("book")} My Index</a></div>
        <h3 class="h">About you</h3><div class="card">${about(me, true)}</div>
        <h3 class="h">Connections</h3><div class="card"><p class="kicker">Google</p><p>${esc(gWords)}</p><p class="muted small">Google is a connection (Docs, Calendar, Gmail), never a way to sign in.</p>${admin ? `<a class="btn wide" href="#google">${g?.account ? "Google settings" : g?.setUp ? "Connect Google" : "Set up Google"}</a>` : ""}</div>
        <h3 class="h">How it works</h3>${list([row({ href: "#you/working", icon: "check", title: "What Nova runs on", text: "Each part of Nova and the service behind it, and a test email" })])}
        ${admin ? `<h3 class="h">Admin</h3><p class="muted small you-hint">Invite people, change roles, and run the admin pages.</p>${list([
          row({ href: "#crew", icon: "user", title: "The crew", text: "Everyone, invites, roles, switching someone off" }),
          row({ href: "#google", icon: "globe", title: "Google", text: "Connect the studio's Google, and what's kept in step" }),
          row({ href: "#tests", icon: "trash", title: "Test stuff", text: "What looks like a test, and why" }),
          row({ href: "#admin/referrals", icon: "star", title: "Referrals", text: "Appointments, referral codes, the spreadsheet" }),
          row({ href: "#admin/links", icon: "share", title: "Links", text: "Every Nova address, checked now" }),
          row({ href: "#admin/test-booking", icon: "calendar", title: "Test booking", text: "Try the booking flow, no real money" }),
        ])}` : ""}
        <h3 class="h">Signed in</h3><div class="card"><p class="muted small">Signed in to all of Nova Agent on this phone: Nova Phone, Portal, Index and the admin pages.</p><button type="button" class="btn wide" data-y="out">Sign out</button></div>`;
      if (!w) fillCaption(box, me);
      box.querySelectorAll("[data-y]").forEach((b) => b.addEventListener("click", () => mine(b, b.dataset.y, me)));
    },
  });

  async function mine(b, what, me) {
    try {
      if (what === "reroll" || what === "reset") {
        await busy(b, what === "reroll" ? "Rolling…" : "Going back…", () => patch(me.id, { planet_seed: what }));
        toast(what === "reset" ? "Back to your original planet." : "A brand new world. Re-roll again any time.");
      }
      if (what === "name") {
        const ok = await sheetDo("Your name", field({ label: "Your name, as the crew sees it", name: "n", value: me.display_name || "", attrs: 'autocomplete="name" maxlength="60"' }), "Save", "Saving…", async (x, stop) => {
          const name = x.n.value.trim();
          if (!name) stop("A name is needed.", x.n);
          if (name !== me.display_name) await patch(me.id, { display_name: name });
        });
        if (!ok) return;
        toast("Name saved. The whole suite will use it.");
      }
      if (what === "email") {
        const admin = me.role === "admin";
        const email = await sheetDo("Change email", `${field({ label: "Email to sign in with", name: "e", type: "email", value: me.email || "", attrs: 'inputmode="email" spellcheck="false" autocapitalize="off"' })}${admin ? "" : pw("Your password", "p", "current-password")}`, "Save new email", "Saving…", async (x, stop) => {
          const e = x.e.value.trim().toLowerCase();
          if (!EMAIL.test(e)) stop("Type a real email address.", x.e);
          if (e === me.email) stop("That's the email already.", x.e);
          if (!admin && !x.p.value) stop("Type your password to confirm.", x.p);
          await patch(me.id, { email: e, current: x.p?.value || "" });
          return e;
        });
        if (!email) return;
        toast(`Saved. Sign in with ${email} from now on.`);
      }
      if (what === "password") {
        const admin = me.role === "admin";
        const ok = await sheetDo("Change password", `${admin ? "" : pw("Current password", "c", "current-password")}${pw("New password", "p", "new-password")}${pw("Type it again", "q", "new-password")}`, "Save new password", "Saving…", async (x, stop) => {
          if (!x.p.value) stop("Type a password.", x.p);
          if (x.p.value !== x.q.value) stop("The two don't match. Type it again.", x.q);
          await post("/auth/password", { password: x.p.value, current: x.c?.value || "" });
        });
        if (!ok) return;
        return toast("New password saved. Use it next time you sign in.");
      }
      if (what === "out") {
        await busy(b, "Signing out…", () => post("/auth/logout", {}).catch(() => {}));
        location.hash = "#signin/out";
        toast("Signed out of all of Nova Agent.");
        return;
      }
      N.show();
    } catch (err) { toast(err.message, true); }
  }

  // How it works: each part of Nova, the service behind it, set up or not (never a key: Nova Bot only says yes or no)
  async function drawWorking(box, ui) {
    ui.back("#you");
    ui.title("What Nova runs on");
    const r = await api("/app/api/services");
    const services = r.services || [];
    const mail = services.find((s) => s.id === "email");
    const LABEL = { on: "Set up", partly: "Partly set up", off: "Not set up" };
    const when = (v) => new Date(v).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: UK });
    box.innerHTML = `<p class="muted small you-hint">Each part of Nova and the service behind it. A green dot means it's set up; the words say the same.</p>
      ${services.length ? list(services.map((s) => {
        const st = s.ready === true ? "on" : s.ready === "partly" ? "partly" : "off";
        return row({ lead: `<span class="you-dot" data-s="${st}" role="img" aria-label="${LABEL[st]}"></span>`, title: s.name, text: [LABEL[st], s.tech].filter(Boolean).join(" · "), html: s.detail || s.last ? `<span>${esc([s.detail, s.last ? `Last sent ${when(s.last)}.` : ""].filter(Boolean).join(" "))}</span>` : "" });
      })) : empty({ icon: "check", title: "Nothing to show yet" })}
      <div class="btns two">${mail && mail.test ? `<button type="button" class="btn" data-test>${icon("mail")} Send me a test email</button>` : ""}<button type="button" class="btn" data-again>${icon("refresh")} Check again</button></div>
      <p class="form-said" data-said role="status"></p>`;
    const said = box.querySelector("[data-said]");
    box.querySelector("[data-test]")?.addEventListener("click", (e) => busy(e.currentTarget, "Sending…", async () => {
      said.classList.remove("bad");
      try { const x = await post("/app/api/services/test-email", {}); said.textContent = x.message || (x.to ? `Sent to ${x.to}. Check your inbox.` : "Sent. Check your inbox."); } catch (err) { said.textContent = err.message || "It didn't send."; said.classList.add("bad"); }
    }));
  }

  // ===== The crew (admins) =====
  N.section({
    id: "crew",
    name: "The crew",
    tile: "portal",
    async draw(box, [id, sub], ui) {
      await N.css("you.css");
      if (id && sub === "index") return drawIndex(box, decodeURIComponent(id), ui);
      if (id) return drawPerson(box, decodeURIComponent(id), ui);
      ui.back("#you");
      const [r, { staff: me }] = await Promise.all([api("/staff"), api("/auth/me")]);
      const crew = r.staff || [];
      ui.action({ icon: "plus", label: "Invite someone", run: () => invite(me) });
      const invited = crew.filter((s) => s.status === "invited"), off = crew.filter((s) => s.status === "disabled"), on = crew.filter((s) => s.status !== "invited" && s.status !== "disabled");
      const pRow = (s) => {
        const self = s.id === me.id;
        const seen = s.status === "invited" ? "Not joined yet" : s.last_login_at ? `Signed in ${since(s.last_login_at)}` : "Never signed in";
        return row({ href: self ? "#you" : `#crew/${encodeURIComponent(s.id)}`, lead: planet(s, 88, "planet sm"), title: s.display_name || s.email, text: [self ? "You" : "", s.role === "admin" ? "Admin" : "Staff", s.status === "disabled" ? "Switched off" : "", seen].filter(Boolean).join(" · ") });
      };
      box.innerHTML = `<p class="muted small you-hint">${esc([plural(crew.length, "person", "people"), invited.length ? `${invited.length} invited` : "", off.length ? `${off.length} switched off` : ""].filter(Boolean).join(" · "))}</p>
        <button type="button" class="btn main wide" data-invite>${icon("plus")} Invite someone</button>
        ${on.length ? list(on.map(pRow)) : ""}${invited.length ? `<h3 class="h">Invited</h3>${list(invited.map(pRow))}` : ""}${off.length ? `<h3 class="h">Switched off</h3>${list(off.map(pRow))}` : ""}
        ${!crew.length ? empty({ icon: "user", title: "Nobody here yet" }) : ""}`;
      box.querySelector("[data-invite]").addEventListener("click", () => invite(me));
    },
  });

  async function invite(me) {
    const r = await sheetDo("Invite someone", `${field({ label: "Their email", name: "e", type: "email", attrs: 'inputmode="email" spellcheck="false" autocapitalize="off"' })}${field({ label: "Their name (optional)", name: "n", attrs: 'autocomplete="off" maxlength="60"' })}${choices({ label: "Role", name: "r", value: "staff", options: [["staff", "Staff"], ["admin", "Admin"]] })}`, "Make an invite link", "Making the link…", async (x, stop) => {
      const email = x.e.value.trim();
      if (!EMAIL.test(email)) stop("Enter their email address.", x.e);
      return post("/staff", { email, display_name: x.n.value.trim(), role: x.r.value || "staff" });
    });
    if (!r) return;
    await inviteBox(r.staff || {}, r.invite_url, r.invite_expires, me);
    N.show();
  }
  // An invite link, ready to copy, share or send by email (with the words Nova Desk sends)
  function inviteBox(person, link, expires, me) {
    const name = firstName(person.display_name);
    const until = longDate(expires);
    const subject = "Your Portal invite";
    const body = [`Hi ${name},`, "", "You're invited to Portal: the staff app and one sign-in for all of Nova Agent at Novacane Studios.", "", "Open this link to choose your password and meet your very own planet:", link, "", `The link works once, for 7 days${until ? ` (until ${until})` : ""}.`, "", "See you in orbit!", me?.display_name || ""].join("\n");
    return sheetForm(`<p class="kicker">Invite link</p><h2 class="sheet-title">Ready for ${esc(person.display_name || name)}</h2>
      <p class="sheet-text">Send it to ${esc(person.email || name)}. It works once, for 7 days${until ? `, until ${esc(until)}` : ""}.</p>
      ${field({ label: "Invite link", name: "link", type: "url", value: link, attrs: "readonly" })}
      <div class="btns"><a class="btn main wide" href="mailto:${encodeURIComponent(person.email || "")}?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(body)}">${icon("mail")} Send it</a>
      ${navigator.share ? `<button type="button" class="btn wide" data-share>${icon("share")} Share…</button>` : ""}<button type="button" class="btn wide" data-copy>Copy link</button><button type="button" class="btn quiet wide" data-no>Done</button></div>`,
      (el, done) => {
        const input = el.querySelector("input[name=link]");
        input.addEventListener("focus", () => input.select());
        el.querySelector("[data-no]").onclick = () => done(true);
        el.querySelector("[data-share]")?.addEventListener("click", () => navigator.share({ title: subject, text: body }).catch(() => {}));
        const copy = el.querySelector("[data-copy]");
        copy.onclick = async () => {
          let ok = false;
          try { await navigator.clipboard.writeText(link); ok = true; } catch (e) { input.select(); try { ok = document.execCommand("copy"); } catch (x) {} }
          if (ok) { copy.textContent = "Copied ✓"; setTimeout(() => (copy.textContent = "Copy link"), 2200); } else toast("Couldn't copy. Select the link and copy it.", true);
        };
      });
  }

  async function drawPerson(box, id, ui) {
    ui.back("#crew");
    const [{ staff: s }, { staff: me }] = await Promise.all([api(`/staff/${encodeURIComponent(id)}`), api("/auth/me")]);
    if (s.id === me.id) { box.innerHTML = N.skeleton(2); queueMicrotask(() => location.replace("#you")); return; }
    const admin = me.role === "admin";
    const first = firstName(s.display_name);
    ui.title(s.display_name || "Crew member");
    const line = { active: `Active. ${s.last_login_at ? `Last signed in ${since(s.last_login_at)}.` : "Hasn't signed in yet."}`, invited: "Invited, hasn't joined yet.", disabled: "Switched off. They can't sign in to Nova Agent." }[s.status] || s.status;
    box.innerHTML = `<div class="card profile you-card">${planet(s, 240)}<p class="kicker">Crew member</p><h2 class="card-title">${esc(s.display_name || "")}</h2>${pills(s, false)}${sinceLine(s)}<p class="you-cap" data-cap></p></div>
      <h3 class="h">About ${esc(first)}</h3><div class="card">${about(s, admin)}</div>
      ${admin ? `<h3 class="h">${esc(possessive(first))} account</h3><div class="card form">
          ${choices({ label: "Role", name: "role", value: s.role === "admin" ? "admin" : "staff", options: [["staff", "Staff"], ["admin", "Admin"]] })}
          <div class="field"><span>Account</span><p class="you-status">${esc(line)}</p></div>
          <div class="btns two">${s.status === "disabled" ? '<button type="button" class="btn" data-p="on">Switch back on</button>' : '<button type="button" class="btn danger" data-p="off">Switch off</button>'}${s.status === "invited" ? '<button type="button" class="btn" data-p="invite">New invite link</button>' : ""}</div>
        </div>
        <div class="btns two"><button type="button" class="btn" data-p="email">${icon("mail")} Change ${esc(possessive(first))} email</button><button type="button" class="btn" data-p="password">New password for ${esc(first)}</button></div>` : ""}
      ${admin ? `<h3 class="h">${esc(possessive(first))} memory</h3>${list([row({ href: `#crew/${encodeURIComponent(s.id)}/index`, icon: "book", title: `Open ${possessive(first)} Index`, text: `What Nova Agent remembers about ${first}, and what the whole studio knows.` })])}` : ""}`;
    fillCaption(box, s);
    box.querySelectorAll("[name=role]").forEach((r) => r.addEventListener("change", async () => {
      try { await patch(s.id, { role: r.value }); toast(r.value === "admin" ? `${first} is now an admin.` : `${first} is now staff.`); } catch (err) { toast(err.message, true); }
      N.show();
    }));
    box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.p;
      try {
        if (what === "off") {
          if (!(await confirm({ title: `Switch ${first} off?`, text: "They'll be signed out of Nova Agent straight away.", ok: "Switch off", danger: true }))) return;
          await busy(b, "Switching off…", () => patch(s.id, { status: "disabled" }));
          toast(`${first} is switched off and signed out everywhere.`);
        }
        // (back on: someone who never joined goes back to invited, so they can be sent a new link)
        if (what === "on") { await busy(b, "Switching on…", () => patch(s.id, { status: s.last_login_at ? "active" : "invited" })); toast("Switched back on."); }
        if (what === "invite") { const r = await busy(b, "Making a link…", () => post(`/staff/${encodeURIComponent(s.id)}/invite`, {})); await inviteBox(s, r.invite_url, r.invite_expires, me); }
        if (what === "email") {
          const email = await sheetDo(`Change ${possessive(first)} email`, field({ label: "Email to sign in with", name: "e", type: "email", value: s.email || "", attrs: 'inputmode="email" spellcheck="false" autocapitalize="off"' }), "Save new email", "Saving…", async (x, stop) => {
            const e = x.e.value.trim().toLowerCase();
            if (!EMAIL.test(e)) stop("Type a real email address.", x.e);
            if (e === s.email) stop("That's the email already.", x.e);
            await patch(s.id, { email: e });
            return e;
          });
          if (!email) return;
          toast(`Saved. ${first} signs in with ${email} from now on.`);
        }
        if (what === "password") {
          const ok = await sheetDo(`New password for ${first}`, `${pw("New password", "p", "new-password")}${pw("Type it again", "q", "new-password")}`, `Save ${possessive(first)} new password`, "Saving…", async (x, stop) => {
            if (!x.p.value) stop("Type a password.", x.p);
            if (x.p.value !== x.q.value) stop("The two don't match. Type it again.", x.q);
            await post(`/staff/${encodeURIComponent(s.id)}/password`, { password: x.p.value });
          });
          if (!ok) return;
          toast(`New password saved for ${first}. They're signed out: tell them the new one.`);
        }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }

  // Their Index: their own part of Nova Agent's memory, and the studio's shared facts (each opens in Index)
  async function drawIndex(box, id, ui) {
    ui.back(`#crew/${encodeURIComponent(id)}`);
    const [{ staff: s }, r] = await Promise.all([api(`/staff/${encodeURIComponent(id)}`), api(`/staff/${encodeURIComponent(id)}/index`)]);
    const first = firstName(s.display_name);
    ui.title(`${possessive(first)} Index`);
    const files = r.files || [];
    // (the address twice encoded: the path inside has slashes of its own)
    const fRow = (f) => row({ href: `#index/file/${encodeURIComponent(encodeURIComponent(JSON.stringify([f.scope, f.owner_id || "", f.path])))}`, lead: window.NovaTile ? window.NovaTile("index") : icon("book"), title: f.name || f.path, text: [f.description, f.path].filter(Boolean).join(" · "), end: esc(N.ago(f.updated_at)) });
    const theirs = files.filter((f) => f.scope === "staff"), studio = files.filter((f) => f.scope !== "staff");
    box.innerHTML = `<p class="muted small you-hint">What Nova Agent remembers about ${esc(first)}, and what the whole studio knows. Partition: <span class="you-mono">${esc(r.partition || s.index_partition || "")}</span></p>
      <h3 class="h">About ${esc(first)} · ${theirs.length}</h3>${theirs.length ? list(theirs.map(fRow)) : empty({ icon: "book", title: `Nothing about ${first} yet`, text: "Nova Agent adds facts as it learns them." })}
      <h3 class="h">The studio · ${studio.length}</h3>${studio.length ? list(studio.map(fRow)) : empty({ icon: "book", title: "No studio files yet" })}`;
  }
})();
