// Bookings, on one screen (25 Oct 2026, the owner: "can you make the rest of nova portal as much as possible
// dashboards please", after Admin's "heavily simplify … put everything onto one screen as much as possible" and
// "get rid of old links please and just keep it simple and optimized"). Bookings had an Overview, Booking tools
// and Approvals along the top, then Calendar, Ask about this week, Booking link and Test booking: several ways to
// each place, and Booking link only sent you to Enquiries to find it. Now it's one dashboard (/portal/?view=calendar,
// index.html #view-calendar): the week's numbers along the top, the month, the day picked in it (its free hours,
// what to show, Ask Nova, its bookings), drawn by app.js as before; and these two panels beside them:
//   - Approvals: how many booking changes are waiting, the first few (each opens that one in Approvals, the one
//     room left, to decide it); Open › for all of them;
//   - Booking link: the newest enquiries, a line each; a tap makes that person's link in place (the Booking link
//     sheet); Open › for every enquiry; Test booking for admins.
// Each is read once when the dashboard is opened: no timers. (panel() and line() are Admin's, admin.js, copied so
// either can change without the other.)
(function () {
  "use strict";
  if (window.PortalBookings) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const page = () => window.PortalPage;
  // (a room opened from here: a new step in the history, so Back comes back to the dashboard)
  const go = (url) => page() && page().go(url);
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

  // ---- Reading: Nova Bot's JSON, once a visit (opened again within 10 s: what was read then) ----
  const cache = new Map();
  const json = (path) => {
    const was = cache.get(path);
    if (was && Date.now() - was.at < 10000) return was.p;
    const p = fetch("/app/api/" + path, { credentials: "same-origin" }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Couldn't load it (" + r.status + ")");
      return data;
    });
    cache.set(path, { at: Date.now(), p });
    p.catch(() => cache.delete(path));
    return p;
  };

  // ---- A panel: its name (with Open › when it has a room), a count, lines, buttons at its foot (admin.js) ----
  function panel(key, name, openIt, openName) {
    const box = el("article", "dash-tile bk-panel bk-" + key);
    box.dataset.key = "bk-" + key;
    box.setAttribute("data-os-keep", "");
    const head = el("div", "dash-tile-head");
    if (window.NovaPillars) head.append(window.NovaPillars.icon(name));
    const badge = el("span", "badge");
    badge.hidden = true;
    head.append(el("h3", "dash-name", name), badge);
    if (openIt) {
      const open = el("button", "dash-open", "Open ›");
      open.type = "button";
      open.setAttribute("aria-label", "Open " + (openName || name));
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
  function line(main, side, open) {
    const li = el("li");
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
  const failed = (p, err) => {
    if (err && err.message === "signed out") return;
    p.big.textContent = "–";
    p.small.textContent = "Couldn't load this just now" + (err && err.message ? ": " + err.message : "");
  };
  // (lines drawn again only when they've changed: opened again, nothing moves under the pointer)
  const rows = (p, list) => {
    const sig = JSON.stringify(list.map((x) => [x[0], x[1], x[3]]));
    if (p.rows.dataset.sig === sig) return;
    p.rows.dataset.sig = sig;
    p.rows.replaceChildren(...list.map(([main, side, open, title]) => {
      const li = line(main, side, open);
      if (title) li.title = "Open: " + title;
      return li;
    }));
  };

  // ---- Approvals: booking changes waiting for an admin (as Approvals words them, app.js) ----
  const KINDS = { create: "New booking", reschedule: "Move a booking", cancel: "Cancel a booking", update: "Booking details", block_add: "Block off time", block_remove: "Unblock time" };
  const DONE = { approved: "Approved", executed: "Done", failed: "Didn't go through", rejected: "Rejected" };
  let appr = null;
  function approvals() {
    if (!appr) appr = panel("approvals", "Approvals", () => go("/portal/?view=approvals"));
    const p = appr;
    json("booking-actions?status=all")
      .then((d) => {
        const all = d.actions || [];
        const waiting = all.filter((a) => a.status === "pending").sort((a, z) => String(a.createdAt).localeCompare(String(z.createdAt)));
        p.badge.textContent = String(waiting.length);
        p.badge.hidden = !waiting.length;
        p.big.textContent = waiting.length ? plural(waiting.length, "change") + " waiting" : "Nothing waiting";
        p.small.textContent = d.canDecide ? "Nothing changes until you approve it" : "An admin approves these";
        // (the waiting ones, each opening that very one to decide; none waiting: the last two decided, what became of them)
        const decided = all.filter((a) => a.status !== "pending").sort((a, z) => String(z.decidedAt || z.createdAt).localeCompare(String(a.decidedAt || a.createdAt)));
        const shown = waiting.length ? waiting.slice(0, 5) : decided.slice(0, 5);
        const open = (a) => () => go("/portal/?view=approvals&action=" + encodeURIComponent(a.id));
        // (each on one line, its kind; what it changes is its title, and the whole of it a tap away)
        rows(p, shown.length ? shown.map((a) => [KINDS[a.kind] || "A booking change", a.status === "pending" ? ago(a.createdAt) : DONE[a.status] || a.status, open(a), a.summary]) : [["Nova Agent's booking changes wait here", ""]]);
      })
      .catch((err) => failed(p, err));
    return p.box;
  }

  // ---- Booking link: for whom, from the newest enquiries; the link made in place (app.js's Booking link sheet) ----
  let link = null;
  function bookingLink() {
    if (!link) {
      link = panel("link", "Booking link", () => go("/portal/?view=enquiries"), "Enquiries");
      link.big.textContent = "Who's it for?";
      link.small.textContent = "They pick a time and pay the deposit";
      // (the booking flow tried, nobody charged: the Admin page's own address, admins only)
      const test = el("button", "btn small ghost", "Test booking ›");
      test.type = "button";
      test.addEventListener("click", () => go("/portal/?view=manage&page=%2Fadmin%2Ftest-booking"));
      link.test = test;
      link.foot.append(test);
    }
    const p = link;
    p.test.hidden = !(page() && page().isAdmin && page().isAdmin());
    json("enquiries")
      .then((d) => {
        const list = (d.enquiries || []).filter((q) => q.email).slice(0, 5);
        const make = (q) => () => window.PortalApp && window.PortalApp.bookingLink ? window.PortalApp.bookingLink(q) : go("/portal/?view=enquiries&enquiry=" + q.id);
        rows(p, list.length ? list.map((q) => [q.name || q.email, ago(q.created_at), make(q)]) : [["No enquiries yet", ""]]);
      })
      .catch((err) => failed(p, err));
    return p.box;
  }

  // ---- The dashboard: the two panels beside app.js's, filled each time it's opened ----
  function show() {
    const side = $("bk-side");
    if (!side) return;
    // (the week's and the day's icons, as each panel's: Nova Tabs' own, pillars.js)
    for (const s of document.querySelectorAll("#view-calendar .bk-ico[data-icon]")) {
      if (!window.NovaPillars) break;
      s.replaceWith(window.NovaPillars.icon(s.dataset.icon));
    }
    const a = approvals();
    const b = bookingLink();
    if (side.firstChild !== a || side.lastChild !== b) side.replaceChildren(a, b);
  }

  window.PortalBookings = { show };
})();
