// Nova Phone: You and the crew (Nova Desk's Portal → You, The crew). Your planet (re-roll it, or back to your
// first), your name, email and password, signing out; how each part of Nova is doing, and a test email. An
// admin also sees the crew: everyone, invites (a link to send), roles, switching someone off or on again.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");
  const patch = (id, body) => api(`/staff/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
  const planet = (id, size = 240) => `<img class="planet" src="/staff/${encodeURIComponent(id)}/planet.svg?size=${size}" alt="" width="${size / 2}" height="${size / 2}">`;
  const sheet = (title, inner, read, ok = "Save") => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${inner}<div class="btns"><button class="btn main wide" type="submit">${esc(ok)}</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(read(ev.target.elements)); }; el.querySelector("[data-no]").onclick = () => done(null); });

  N.section({
    id: "you",
    name: "You",
    tile: "portal",
    async draw(box, [part], ui) {
      const me = (await api("/auth/me")).staff;
      if (part === "working") return drawWorking(box, ui);
      ui.title(me.display_name || "You");
      box.innerHTML = `<div class="card profile">${planet(me.id)}<p class="kicker">Your profile · ${me.role === "admin" ? "Admin" : "Staff"}</p><h2 class="card-title">${esc(me.display_name || "")}</h2>${me.planet?.name ? `<p class="muted">✦ ${esc(me.planet.name)}</p>` : ""}${me.planet?.description ? `<p class="small muted">${esc(me.planet.description)}</p>` : ""}
          <div class="facts">${[["Email", me.email], ["Joined", day(me.created_at)], ["Last signed in", ago(me.last_login_at)]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
        <div class="btns two"><button type="button" class="btn" data-y="reroll">✦ Re-roll my planet</button><button type="button" class="btn" data-y="reset">Back to my first planet</button><button type="button" class="btn" data-y="name">${icon("edit")} My name</button><button type="button" class="btn" data-y="email">${icon("mail")} My email</button><button type="button" class="btn" data-y="password">My password</button><a class="btn" href="#index">${icon("book")} My Index</a></div>
        ${list([row({ href: "#you/working", icon: "check", title: "How Nova is working", text: "Each part, and a test email" }), ...(me.role === "admin" ? [row({ href: "#crew", icon: "user", title: "The crew", text: "Everyone, invites, roles" })] : [])])}
        <button type="button" class="btn danger wide" data-y="out">Sign out everywhere</button>`;
      box.querySelectorAll("[data-y]").forEach((b) => b.addEventListener("click", async () => {
        const what = b.dataset.y;
        try {
          if (what === "reroll" || what === "reset") { await patch(me.id, { planet_seed: what }); toast(what === "reroll" ? "A new planet ✦" : "Your first planet's back"); }
          if (what === "name") { const v = await sheet("Your name", field({ label: "Name", name: "n", value: me.display_name || "" }), (x) => x.n.value.trim()); if (!v) return; await patch(me.id, { display_name: v }); toast("Saved"); }
          if (what === "email") { const v = await sheet("Your email", `${field({ label: "New email", name: "e", type: "email", value: me.email || "" })}${me.role === "admin" ? "" : field({ label: "Your password", name: "p", type: "password", attrs: 'autocomplete="current-password"' })}`, (x) => ({ email: x.e.value.trim(), current: x.p?.value })); if (!v) return; await patch(me.id, v); toast("Saved"); }
          if (what === "password") { const v = await sheet("A new password", `${field({ label: "Your password now", name: "c", type: "password", attrs: 'autocomplete="current-password"' })}${field({ label: "New password", name: "p", type: "password", attrs: 'autocomplete="new-password"' })}${field({ label: "New password again", name: "q", type: "password", attrs: 'autocomplete="new-password"' })}`, (x) => ({ current: x.c.value, password: x.p.value, again: x.q.value })); if (!v) return; if (v.password !== v.again) return toast("The new passwords don't match", true); await post("/auth/password", { password: v.password, current: v.current }); toast("New password saved. Use it next time you sign in."); }
          if (what === "out") { if (!(await confirm({ title: "Sign out everywhere?", text: "On this phone and every other place you're signed in.", ok: "Sign out", danger: true }))) return; await post("/auth/logout", {}); location.reload(); return; }
          N.show();
        } catch (err) { toast(err.message, true); }
      }));
    },
  });
  async function drawWorking(box, ui) {
    ui.back("#you");
    ui.title("How Nova is working");
    const r = await api("/app/api/services");
    box.innerHTML = `${list((r.services || []).map((s) => row({ icon: s.ready ? "check" : "globe", title: s.name, text: [s.tech, s.detail, s.last ? `last ${ago(s.last)}` : ""].filter(Boolean).join(" · "), end: `<span class="pill ${s.ready ? "ok" : "warn"}">${s.ready ? "Ready" : "Not set up"}</span>` })))}
      <div class="btns two"><button type="button" class="btn" data-w="test">${icon("mail")} Send me a test email</button><button type="button" class="btn" data-again>${icon("refresh")} Check again</button></div>`;
    box.querySelector("[data-w]").addEventListener("click", (e) => busy(e.currentTarget, "Sending…", async () => { try { const x = await post("/app/api/services/test-email", {}); toast(x.to ? `Sent to ${x.to}` : "Sent"); } catch (err) { toast(err.message, true); } }));
  }

  // ---- The crew (admins) ----
  N.section({
    id: "crew",
    name: "The crew",
    tile: "portal",
    async draw(box, [id], ui) {
      if (id) return drawPerson(box, id, ui);
      const r = await api("/staff");
      const staff = r.staff || r || [];
      ui.action({ icon: "plus", label: "Invite someone", run: invite });
      const on = staff.filter((s) => s.status === "active"), invited = staff.filter((s) => s.status === "invited"), off = staff.filter((s) => s.status !== "active" && s.status !== "invited");
      const pRow = (s) => row({ href: `#crew/${encodeURIComponent(s.id)}`, lead: `<img class="planet sm" src="/staff/${encodeURIComponent(s.id)}/planet.svg?size=88" alt="" width="44" height="44">`, title: s.display_name || s.email, text: [s.role === "admin" ? "Admin" : "Staff", s.last_login_at ? `signed in ${ago(s.last_login_at)}` : s.status === "invited" ? "Not joined yet" : ""].filter(Boolean).join(" · ") });
      box.innerHTML = `<p class="muted small">${on.length} ${on.length === 1 ? "person" : "people"} · ${invited.length} invited · ${off.length} switched off</p>
        ${list(on.map(pRow))}${invited.length ? `<h3 class="h">Invited</h3>${list(invited.map(pRow))}` : ""}${off.length ? `<h3 class="h">Switched off</h3>${list(off.map(pRow))}` : ""}
        <button type="button" class="btn main wide" data-invite>${icon("plus")} Invite someone</button>`;
      box.querySelector("[data-invite]").addEventListener("click", invite);
    },
  });
  async function invite() {
    const v = await sheet("Invite someone", `${field({ label: "Their email", name: "e", type: "email" })}${field({ label: "Their name", name: "n" })}${field({ label: "Role", name: "r", type: "select", value: "staff", options: [["staff", "Staff"], ["admin", "Admin"]] })}`, (x) => ({ email: x.e.value.trim(), display_name: x.n.value.trim(), role: x.r.value }), "Make an invite link");
    if (!v) return;
    try { const r = await post("/staff", v); await shareInvite(r.invite_url, v.display_name); N.show(); } catch (err) { toast(err.message, true); }
  }
  async function shareInvite(url, name) {
    const text = `Hi ${name || ""}, here's your invite to Nova: ${url}`;
    const how = await choose({ title: "Send the invite link", options: [...(navigator.share ? [["share", "Share…"]] : []), ["copy", "Copy the link"], ["email", "Email it"]] });
    if (how === "share") await navigator.share({ title: "Your invite to Nova", text }).catch(() => {});
    if (how === "copy") { try { await navigator.clipboard.writeText(url); toast("Copied"); } catch (e) { toast("Couldn't copy", true); } }
    if (how === "email") location.href = `mailto:?subject=${encodeURIComponent("Your invite to Nova")}&body=${encodeURIComponent(text)}`;
  }
  async function drawPerson(box, id, ui) {
    ui.back("#crew");
    const s = (await api(`/staff/${encodeURIComponent(id)}`)).staff;
    ui.title(s.display_name || "Crew member");
    box.innerHTML = `<div class="card profile">${planet(s.id)}<p class="kicker">${s.role === "admin" ? "Admin" : "Staff"} · ${esc(s.status)}</p><h2 class="card-title">${esc(s.display_name || "")}</h2>
        <div class="facts">${[["Email", s.email], ["Joined", day(s.created_at)], ["Last signed in", ago(s.last_login_at)]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
      <fieldset class="field"><legend>Role</legend><div class="seg"><label><input type="radio" name="role" value="staff"${s.role !== "admin" ? " checked" : ""}>Staff</label><label><input type="radio" name="role" value="admin"${s.role === "admin" ? " checked" : ""}>Admin</label></div></fieldset>
      <div class="btns two">${s.status === "invited" ? `<button type="button" class="btn" data-p="invite">New invite link</button>` : ""}<button type="button" class="btn" data-p="password">Set a new password</button>${s.status === "active" ? `<button type="button" class="btn danger" data-p="off">Switch off</button>` : `<button type="button" class="btn" data-p="on">Switch back on</button>`}</div>`;
    box.querySelectorAll("[name=role]").forEach((r) => r.addEventListener("change", async () => { try { await patch(s.id, { role: r.value }); toast(`Now ${r.value === "admin" ? "an admin" : "staff"}`); } catch (err) { toast(err.message, true); N.show(); } }));
    box.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", async () => {
      const what = b.dataset.p;
      try {
        if (what === "invite") { const r = await post(`/staff/${encodeURIComponent(s.id)}/invite`, {}); await shareInvite(r.invite_url, s.display_name); }
        if (what === "password") { const v = await sheet(`A new password for ${s.display_name}`, field({ label: "New password", name: "p", type: "password", attrs: 'autocomplete="new-password"' }), (x) => x.p.value); if (!v) return; await post(`/staff/${encodeURIComponent(s.id)}/password`, { password: v }); toast("Saved: they're signed out everywhere"); }
        if (what === "off") { if (!(await confirm({ title: `Switch ${s.display_name} off?`, text: "They're signed out and can't sign in until switched back on.", ok: "Switch off", danger: true }))) return; await patch(s.id, { status: "disabled" }); toast("Switched off"); }
        if (what === "on") { await patch(s.id, { status: "active" }); toast("Switched back on"); }
        N.show();
      } catch (err) { toast(err.message, true); }
    }));
  }
})();
