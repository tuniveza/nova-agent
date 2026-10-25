// Admin, on one screen (25 Oct 2026, the owner: "can you heavily simplify the nova portal - admin area and put
// everything onto one screen as much as possible", then "get rid of old links please and just keep it simple and
// optimized"). Admin had an Overview, five tabs, Invite someone and Links along the top, a second row of chips over
// the admin pages and the crew, and the admin pages' own tabs: several ways to each place. Now it's this one
// dashboard (/portal/?view=manage), a panel for each part side by side:
//   - Admin pages: each of Nova Bot's admin pages as a line, with how it is now; a line opens that very page;
//   - The crew: everyone, a line each, opening their page; Invite someone, in place;
//   - Google: connected or not, how many parts are on; Connect again; Open › for the whole of it;
//   - Test stuff: how many look like tests, the first few (each opens its card); Delete all likely (two presses);
//   - Computer: running or not, the last backup, how busy; Open Computer; Open › for the whole of it.
// It reads the same addresses the rooms do, once, when it's opened (or a panel's Check again): no timers.
(function () {
  "use strict";
  if (window.PortalAdmin) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const K = () => window.PortalApp && window.PortalApp.kit;
  const say = (t) => K() && K().toast(t);
  const page = () => window.PortalPage;
  // (a room opened from here: a new step in the history, so Back comes back to the dashboard)
  const go = (url) => page() && page().go(url);
  const adminPage = (path) => go("/portal/?view=manage&page=" + encodeURIComponent(path));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const ago = (iso) => {
    const t = Date.parse(iso);
    if (!t) return "";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " h ago";
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  };

  // ---- Reading: Nova Bot's JSON, and two of its admin pages (only read), kept for 30 s ----
  const cache = new Map();
  function once(key, make) {
    const was = cache.get(key);
    if (was && Date.now() - was.at < 30000) return was.p;
    const p = make();
    cache.set(key, { at: Date.now(), p });
    p.catch(() => cache.delete(key));
    return p;
  }
  const json = (path) => once(path, async () => {
    const r = await fetch("/app/api/" + path, { credentials: "same-origin" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Couldn't load it (" + r.status + ")");
    return data;
  });
  const html = (path) => once(path, async () => {
    const r = await fetch(path, { credentials: "same-origin" });
    if (!r.ok) throw new Error("Couldn't load " + path + " (" + r.status + ")");
    return new DOMParser().parseFromString(await r.text(), "text/html");
  });
  const text = (n) => (n ? n.textContent.trim().replace(/\s+/g, " ") : "");

  // ---- A panel: its name (with Open › when it has a room of its own), a count, lines, buttons at its foot ----
  function panel(key, name, openIt) {
    const box = el("article", "dash-tile ad-panel ad-" + key);
    box.dataset.key = "ad-" + key;
    // (whole on a page, drawn a little smaller if it must be: never its name on one page and its lines on the next;
    // in a short window it's laid out low and wide to fit, admin.css)
    box.setAttribute("data-os-keep", "");
    const head = el("div", "dash-tile-head");
    if (window.NovaPillars) head.append(window.NovaPillars.icon(name));
    const badge = el("span", "badge");
    badge.hidden = true;
    head.append(el("h3", "dash-name", name), badge);
    if (openIt) {
      const open = el("button", "dash-open", "Open ›");
      open.type = "button";
      open.setAttribute("aria-label", "Open " + name);
      open.addEventListener("click", openIt);
      head.append(open);
    }
    const top = el("p", "dash-top");
    const big = el("span", "dash-big", "…");
    const small = el("span", "dash-small", "");
    top.append(big, small);
    const rows = el("ul", "dash-rows");
    const foot = el("div", "ad-foot");
    box.append(head, top, rows, foot);
    return { box, badge, big, small, rows, foot };
  }
  // A line: its words, how it is now beside them, and what a tap on it opens
  function line(main, side, open, before) {
    const li = el("li");
    if (before) li.append(before);
    li.append(el("span", "dash-main", main), el("span", "dash-side", side || ""));
    if (open) {
      li.tabIndex = 0;
      li.setAttribute("role", "link");
      li.title = "Open: " + main;
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    return li;
  }
  function button(label, cls, onClick) {
    const b = el("button", cls, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }
  const failed = (p, err) => {
    if (err && err.message === "signed out") return;
    p.big.textContent = "–";
    p.small.textContent = "Couldn't load this just now" + (err && err.message ? ": " + err.message : "");
  };
  const badge = (p, n) => {
    p.badge.textContent = String(n);
    p.badge.hidden = !n;
  };

  // ---- Admin pages: Nova Bot's own, a line each (Enquiries and Conversations are Portal's own, in Inbox) ----
  function studio() {
    const p = panel("studio", "Admin pages");
    p.big.textContent = "Studio";
    p.small.textContent = "Nova Bot's admin pages";
    const PAGES = [
      ["Referrals", () => adminPage("/admin")],
      ["Enquiries", () => go("/portal/?view=enquiries")],
      ["Conversations", () => go("/portal/?view=chats")],
      ["Feedback", () => adminPage("/admin/feedback")],
      ["Booking system", () => adminPage("/admin/connections")],
      ["Google setup", () => adminPage("/admin/google/setup")],
      ["Links", () => adminPage("/admin/links")],
      ["Test booking", () => adminPage("/admin/test-booking")],
    ];
    const side = {};
    p.rows.replaceChildren(...PAGES.map(([name, open]) => {
      const li = line(name, "", open);
      side[name] = li.lastChild;
      return li;
    }));
    side.Feedback.textContent = "What visitors rated";
    side.Links.textContent = "Every address";
    side["Test booking"].textContent = "Nobody charged";
    // How each is now (one that doesn't load leaves its line as it is)
    json("enquiries").then((d) => {
      side.Enquiries.textContent = d.newCount ? d.newCount + " new" : "None new";
      badge(p, d.newCount || 0);
    }).catch(() => {});
    json("conversations").then((d) => (side.Conversations.textContent = plural((d.conversations || []).length, "chat"))).catch(() => {});
    html("/admin").then((d) => {
      const stat = (re) => [...d.querySelectorAll(".stats > *")].map(text).find((t) => re.test(t));
      const n = (t) => Number((t || "").match(/\d+/) || 0);
      const appts = stat(/appointment/i);
      if (appts) side.Referrals.textContent = `${plural(n(appts), "appointment")} · ${n(stat(/valid code/i))} with a code`;
    }).catch(() => {});
    html("/admin/connections").then((d) => {
      // ("Google (calendar and email)" and "Stripe (payments)": each one's Status line)
      const parts = [...d.querySelectorAll("main h2")].map((h) => ({ name: text(h).split(" (")[0], card: h.nextElementSibling })).filter((x) => x.card && /Status/.test(text(x.card)));
      const ok = (x) => /^\s*✓/.test(text(x.card).split("Status")[1] || "");
      if (parts.length) side["Booking system"].textContent = parts.map((x) => x.name + (ok(x) ? " ✓" : " ✗")).join(" · ");
      const g = parts.find((x) => x.name === "Google");
      side["Google setup"].textContent = g && ok(g) ? "All done ✓" : "The key and sign-in";
    }).catch(() => {});
    return p.box;
  }

  // ---- The crew ----
  function crew() {
    const p = panel("crew", "The crew");
    p.foot.append(button("+ Invite someone", "btn small", () => page() && page().invite()));
    const P = page();
    if (!P || !P.crew) return p.box;
    P.crew()
      .then((list) => {
        const me = P.me ? P.me() : null;
        const invited = list.filter((x) => x.status === "invited").length;
        p.big.textContent = plural(list.length, "person", "people");
        p.small.textContent = [invited ? `${invited} invited` : "", plural(list.filter((x) => x.role === "admin").length, "admin")].filter(Boolean).join(" · ");
        p.rows.replaceChildren(...list.map((x) => {
          const self = me && x.id === me.id;
          const img = el("img", "ad-planet");
          img.alt = "";
          img.width = 28;
          img.height = 28;
          img.loading = "lazy";
          img.decoding = "async";
          img.src = P.planetUrl(x, 64);
          img.addEventListener("error", () => img.style.setProperty("visibility", "hidden"));
          const seen = x.status === "invited" ? "invited, not joined yet" : x.status === "disabled" ? "switched off" : x.last_login_at ? "signed in " + ago(x.last_login_at) : "never signed in";
          return line(x.display_name + (self ? " (you)" : ""), `${x.role === "admin" ? "Admin" : "Staff"} · ${seen}`, () => go(self ? "/portal/?view=me" : "/portal/?id=" + encodeURIComponent(x.id)), img);
        }));
      })
      .catch((err) => failed(p, err));
    return p.box;
  }

  // ---- Google ----
  function google() {
    const room = () => go("/portal/?view=google");
    const p = panel("google", "Google", room);
    // (Google's own page in a small window, as in Google: opened straight from the press, as browsers only allow then)
    const connect = button("Connect again", "btn small", () => window.PortalGoogle.connect());
    p.foot.append(connect, button("Check again", "chip", () => {
      cache.delete("google");
      fill();
    }));
    const fill = () => json("google")
      .then((d) => {
        const parts = d.parts || [];
        const off = parts.filter((x) => !x.on).map((x) => x.label).filter(Boolean);
        const st = Object.values(d.status || {}).filter((x) => x && x.at);
        const last = st.map((x) => x.at).sort().pop();
        const bad = st.filter((x) => !x.ok && !x.running).length;
        p.big.textContent = d.connected ? "Connected" : "Not connected";
        p.small.textContent = d.connected ? d.account || "" : d.needsReconnect ? "Needs connecting again" : "Connect it to keep Calendar, Gmail and Drive in step";
        connect.textContent = d.connected ? "Connect again" : "Connect";
        const rows = [line("Parts on", `${parts.length - off.length} of ${parts.length}`, room)];
        if (off.length) rows.push(line("Off", off.slice(0, 2).join(", ") + (off.length > 2 ? ` +${off.length - 2}` : ""), room));
        if (last) rows.push(line("Last kept in step", ago(last), room));
        if (bad) rows.push(line("Problems", plural(bad, "part"), room));
        p.rows.replaceChildren(...rows.slice(0, 3));
      })
      .catch((err) => failed(p, err));
    fill();
    return p.box;
  }

  // ---- Test stuff ----
  function tests() {
    const p = panel("tests", "Test stuff", () => go("/portal/?view=tests"));
    let armed = 0;
    const hint = el("p", "ad-hint", "Press again to delete them all (each can be put back for 30 days).");
    hint.hidden = true;
    const all = button("Delete all likely", "btn small ghost danger", async () => {
      const s = window.PortalTests.summary();
      if (!s.deletable) return say("Nothing likely to delete.");
      // (two presses, as in Test stuff: the second says how many)
      if (armed !== s.deletable) {
        armed = s.deletable;
        all.textContent = `Yes, delete ${plural(armed, "thing")}`;
        all.classList.add("solid");
        hint.hidden = false;
        return;
      }
      armed = 0;
      all.disabled = true;
      try {
        await window.PortalTests.removeLikely();
      } finally {
        all.disabled = false;
        all.classList.remove("solid");
        hint.hidden = true;
        draw();
      }
    });
    p.foot.append(all);
    p.box.append(hint);
    function draw() {
      const s = window.PortalTests.summary();
      if (!s.ready) return;
      p.big.textContent = s.all ? `${s.likely} likely` : "All clean ✦";
      p.small.textContent = s.all ? `${s.maybe} might be` : "Nothing looks like a test";
      badge(p, s.likely);
      if (!armed) all.textContent = `Delete all likely (${s.deletable})`;
      all.hidden = !s.deletable;
      // (the first few, each opening its own card in Test stuff)
      p.rows.replaceChildren(...s.first.slice(0, 3).map((i) => line(i.title || "Untitled", i.kindName || "", () => openCard(i.key))));
      if (s.problem) p.rows.append(line(s.problem, "", null));
    }
    Promise.resolve(window.PortalTests.load()).then(draw, (err) => failed(p, err));
    return p.box;
  }
  function openCard(key) {
    go("/portal/?view=tests");
    // (once Test stuff has drawn it: turned to and focused)
    let tries = 25;
    (function wait() {
      const card = document.querySelector(`#view-tests [data-key="${CSS.escape("ts-" + key)}"]`);
      if (card && !$("view-tests").hidden) {
        if (window.NovaOneScreen) window.NovaOneScreen.reveal(card);
        const t = card.querySelector("[id^='ts-t-']");
        if (t) {
          t.tabIndex = -1;
          t.focus({ preventScroll: true });
        }
      } else if (tries-- > 0) setTimeout(wait, 120);
    })();
  }

  // ---- Computer ----
  function computer() {
    const room = () => go("/portal/?view=desk");
    const p = panel("desk", "Computer", room);
    // (Computer itself, the VPS live: Nova Agent's own panel, over the whole window as from Computer)
    const openPc = el("a", "btn small", "Open Computer →");
    openPc.href = "/agent/computer";
    openPc.target = "_top";
    p.foot.append(openPc, button("Check again", "chip", () => {
      cache.delete("desk");
      fill();
    }));
    const fill = () => json("desk")
      .then((d) => {
        const v = d.vps || {};
        // (as Computer words them, desk.js: how much of each is used)
        const used = (x) => (x && x.total ? Math.round(((x.total - x.free) / x.total) * 100) + "% used" : "");
        p.big.textContent = v.reachable ? "Running" : "Can't reach it";
        p.small.textContent = v.lastBackup ? "Last backup " + ago(v.lastBackup) : "";
        const rows = [["Memory", used(v.memory)], ["Disk", used(v.disk)], ["Processors", v.cpu && v.cpu.load ? "busy " + v.cpu.load[0] : ""]].filter((r) => r[1]).map(([a, b]) => line(a, b, room));
        if (Array.isArray(v.problems) && v.problems.length) rows.push(line("Recent problems", plural(v.problems.length, "line"), room));
        p.rows.replaceChildren(...rows.slice(0, 3));
      })
      .catch((err) => failed(p, err));
    fill();
    return p.box;
  }

  // ---- The dashboard: drawn each time it's opened, from what's kept for 30 s (fresh: read again) ----
  function show({ fresh = false } = {}) {
    const grid = $("admin-grid");
    if (!grid) return;
    if (fresh) cache.clear();
    grid.replaceChildren(studio(), crew(), google(), tests(), computer());
  }

  window.PortalAdmin = { show };
})();
