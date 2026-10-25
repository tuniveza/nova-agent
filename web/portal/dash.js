// Today, everything in one section (22 Oct 2026, the user: "rather then it being tabs you click to open an
// area it's all in one section"; first built as dashboards per Nova Tab, which wasn't what they meant). Today
// shows a live tile for every section Nova Tabs has (Bookings, Enquiries, Conversations, Alerts, Money,
// Quests, Clients, Campaigns, Social, Funnel…; Google, Computer and Test stuff for admins):
//   - its count and its latest few things, read from the same places the sections read;
//   - a tap on a line opens that very thing (an enquiry, a chat), and Open › the whole section.
// It fits the screen like every section (onescreen.js pages it if it must).
(function () {
  "use strict";
  if (window.NovaDash) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const say = (t) => (window.PortalApp && window.PortalApp.kit ? window.PortalApp.kit.toast(t) : console.log(t));

  // ---- Reading: the same addresses the sections use, kept for 30 s so the tiles share them ----
  const cache = new Map();
  function get(path) {
    const was = cache.get(path);
    if (was && Date.now() - was.at < 30000) return was.p;
    const p = fetch("/app/api/" + path, { credentials: "same-origin" }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Couldn't load it (" + r.status + ")");
      return data;
    });
    cache.set(path, { at: Date.now(), p });
    p.catch(() => cache.delete(path));
    return p;
  }

  // ---- Words ----
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
  const pounds = (p) => "£" + (Math.round(Number(p) || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const when = (v) => {
    // (the booking calendar's times come as the feed writes them, "20261027T180000Z", which Date.parse can't
    // read: read as UTC, like Booking tools does (app.js feedDate). Unread, the Bookings tile always said
    // "0 today · 0 bookings coming up" with the month full of bookings, 25 Oct 2026)
    const feed = String(v || "").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
    if (feed) return new Date(Date.UTC(+feed[1], +feed[2] - 1, +feed[3], +feed[4], +feed[5]));
    const t = typeof v === "number" ? v : Date.parse(String(v || "").replace(/^(\d{4}-\d\d-\d\d) /, "$1T"));
    return t ? new Date(t) : null;
  };
  const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const dayWord = (d) => (dayKey(d) === dayKey(new Date()) ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }));
  const bookingName = (b) => [b.session, b.name].filter(Boolean).join(" · ") || "Booking";
  // (Outreach's campaigns and posts: their status as Campaigns and Social word it, app.js / social.js)
  const OUT_WORDS = { draft: "Draft", pending_approval: "Waiting", approved: "Approved", scheduled: "Scheduled", posting: "Posting…", manual: "Post by hand", posted: "Posted", sent: "Sent", failed: "Didn't go", rejected: "Rejected" };

  // ---- What each section's tile says: { big, small, rows: [[main, side]], empty } ----
  const TILES = {
    async today() {
      const [cal, enq, chats] = await Promise.allSettled([get("calendar"), get("enquiries"), get("conversations")]);
      const today = dayKey(new Date());
      const bookings = cal.status === "fulfilled" && cal.value.setUp ? cal.value.bookings.filter((b) => { const d = when(b.start); return d && dayKey(d) === today; }) : [];
      const fresh = enq.status === "fulfilled" ? enq.value.newCount || 0 : 0;
      const talked = chats.status === "fulfilled" ? chats.value.conversations.filter((c) => c.started && dayKey(new Date(c.started)) === today).length : 0;
      return {
        big: plural(bookings.length, "booking") + " today",
        small: `${plural(fresh, "new enquiry", "new enquiries")} · ${plural(talked, "chat")} today`,
        rows: bookings.slice(0, 4).map((b) => [bookingName(b), when(b.start) ? hhmm(when(b.start)) : ""]),
        empty: "Nothing booked today.",
      };
    },
    async enquiries() {
      const d = await get("enquiries");
      const c = d.counts || {};
      return {
        big: `${d.newCount || 0} new`,
        small: `${c.open || 0} open · ${c.replied || 0} waiting on them`,
        rows: (d.enquiries || []).slice(0, 4).map((q) => [`${q.name || "Someone"}${q.subject ? " · " + q.subject : ""}`, ago(q.created_at), "/portal/?view=enquiries&enquiry=" + q.id]),
        empty: "No enquiries yet.",
      };
    },
    async chats() {
      const d = await get("conversations");
      return {
        big: plural((d.conversations || []).length, "chat"),
        small: d.needsPerson ? `${d.needsPerson} need${d.needsPerson === 1 ? "s" : ""} a person` : "Nobody waiting on a person",
        rows: (d.conversations || []).slice(0, 4).map((c) => [c.first_question || "A chat", ago(c.last || c.started), "/portal/?view=chats&chat=" + encodeURIComponent(c.chat_id)]),
        empty: "No chats in the last 90 days.",
      };
    },
    async alerts() {
      const d = await get("notifications");
      const list = d.notifications || [];
      return {
        big: plural(list.length, "alert"),
        small: d.autoDeleteDays ? `Deleted after ${plural(d.autoDeleteDays, "day")}` : "Kept until deleted",
        // (an alert kept from before Missions went: in plain words, as Portal's Alerts shows it)
        rows: list.slice(0, 4).map((n) => [String(n.title || "").replace(/^Mission: /, "Quest: ").replace(/\b([Mm])ission(s?)\b/g, (_, m, s) => (m === "M" ? "Plan" : "plan") + s), ago(n.created_at)]),
        empty: "No alerts yet.",
      };
    },
    async calendar() {
      const d = await get("calendar");
      if (!d.setUp) return { big: "Not set up", small: "Connect the booking calendar in Portal → Google", rows: [], empty: "" };
      const now = Date.now();
      const next = d.bookings.map((b) => ({ b, at: when(b.start) })).filter((x) => x.at && x.at.getTime() >= now - 3600000).sort((a, z) => a.at - z.at);
      const today = next.filter((x) => dayKey(x.at) === dayKey(new Date())).length;
      return {
        big: `${today} today`,
        small: `${plural(next.length, "booking")} coming up`,
        rows: next.slice(0, 4).map(({ b, at }) => [bookingName(b), `${dayWord(at)} ${hhmm(at)}`]),
        empty: "Nothing booked ahead.",
      };
    },
    async approvals() {
      const d = await get("booking-actions");
      const waiting = (d.actions || []).filter((a) => !a.status || a.status === "pending" || a.status === "waiting");
      return {
        big: `${waiting.length} waiting`,
        small: d.canDecide ? "Yours to approve" : "An admin approves these",
        rows: waiting.slice(0, 4).map((a) => [a.summary || a.title || a.kind || "A booking change", ago(a.createdAt || a.created_at)]),
        empty: "Nothing waiting for approval.",
      };
    },
    async clients() {
      const d = await get("clients");
      const list = (d.clients || []).slice().sort((a, z) => String(z.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      return {
        big: plural(d.total || list.length, "client"),
        small: `${list.filter((c) => c.nextBooked).length} with a session booked`,
        // (a line opens that client's page, not the whole list: 25 Oct 2026, "a tap on a row opens that very thing")
        rows: list.slice(0, 4).map((c) => [c.name || c.email || "A client", c.nextBooked ? "next " + (when(c.nextBooked) ? dayWord(when(c.nextBooked)) : "") : plural(c.sessionCount || 0, "session"), c.id ? "/portal/?view=clients&client=" + c.id : ""]),
        empty: "No clients yet.",
      };
    },
    async money() {
      const d = await get("money");
      const s = d.summary || {};
      const rows = [];
      // Each line opens what it's about (25 Oct 2026): the invoices in the Invoicer (where everything for
      // invoices is), the overdue ones picked out; money in and out on Money's tax year and expenses
      const inv = (what) => () => window.NovaInvoicer && window.NovaInvoicer.open(what);
      const part = (p) => () => {
        if (window.PortalPage) window.PortalPage.go("/portal/?view=money", { replace: true });
        if (window.PortalMoney && window.PortalMoney.show) window.PortalMoney.show(p);
      };
      if (s.owed) rows.push([`Owed: ${plural(s.owed.count || 0, "invoice")}`, pounds(s.owed.pence), inv({})]);
      if (s.overdue) rows.push([`Overdue: ${plural(s.overdue.count || 0, "invoice")}`, pounds(s.overdue.pence), inv({ filter: "overdue" })]);
      if (s.month) rows.push(["In this month", pounds(s.month.inPence), part("year")]);
      if (s.month) rows.push(["Out this month", pounds(s.month.outPence), part("expenses")]);
      const waiting = (s.waitingApproval || 0) + (s.unconfirmedExpenses || 0);
      return { big: s.owed ? pounds(s.owed.pence) : "–", small: waiting ? `owed · ${waiting} waiting for approval` : "owed", rows, empty: "" };
    },
    async campaigns() {
      const d = await get("campaigns");
      const list = d.campaigns || [];
      const a = d.audiences || {};
      return {
        big: plural(list.length, "campaign"),
        small: `${a.everyone || 0} can be emailed (${a.fans || 0} fans, ${a.clients || 0} clients)`,
        // (the status in the words Campaigns uses, never the stored code like "pending_approval", 25 Oct 2026;
        // a line opens that very campaign, ?campaign= as Agent's links do)
        rows: list.slice(0, 4).map((c) => [c.subject || "(No subject)", OUT_WORDS[c.status] || c.status || "", "/portal/?view=campaigns&campaign=" + c.id]),
        empty: "No campaigns yet.",
      };
    },
    async social() {
      const d = await get("social");
      const on = Object.entries(d.connected || {}).filter(([, v]) => v).map(([k]) => k[0].toUpperCase() + k.slice(1));
      return {
        big: plural((d.posts || []).length, "post"),
        small: on.length ? "Connected: " + on.join(", ") : "Not connected to Meta yet: posts wait to be posted by hand",
        rows: (d.posts || []).slice(0, 4).map((p) => [String(p.text || p.caption || p.body || "A post").split("\n")[0], OUT_WORDS[p.status] || p.status || "", "/portal/?view=social&post=" + p.id]),
        empty: "No posts yet.",
      };
    },
    async funnel() {
      const d = await get("funnel");
      const c = d.counts || {};
      const t = d.today || {};
      return {
        big: plural(c.emailed || c.sent || 0, "email") + " sent",
        small: `${t.sent || 0} of ${t.limit || 0} today${d.settings && d.settings.paused ? " · paused" : ""}`,
        rows: [["Waiting to be written or approved", String(c.pending || 0)], ["Warming up", String(c.warming || 0)], ["Replied", String(c.replied || 0)], ["Bounced or rejected", String(c.bounced || 0)]],
        empty: "",
      };
    },
    async quests() {
      const d = await get("quests");
      const st = d.state || {};
      const cur = st.current && (st.current.title || st.current.name);
      const next = (Array.isArray(st.next) ? st.next : []).map((q) => q.title || q.name).filter(Boolean);
      const all = Array.isArray(st.quests) ? st.quests : [];
      return {
        big: cur ? "On now" : plural(all.length, "quest"),
        small: cur || (d.online ? "Nothing on right now" : "Nova Agent's plan isn't reachable just now"),
        rows: next.slice(0, 4).map((t) => [t, "next"]),
        empty: "Nothing planned next.",
      };
    },
    async google() {
      const d = await get("google");
      const on = (d.parts || []).filter((p) => p.on).length;
      return {
        big: d.connected ? "Connected" : "Not connected",
        small: d.connected ? d.account || "" : d.needsReconnect ? "Needs connecting again" : "Connect it in Google",
        rows: [[`${on} of ${(d.parts || []).length} parts on`, ""]],
        empty: "",
      };
    },
    async desk() {
      const d = await get("desk");
      const v = d.vps || {};
      // (how much is used, as Computer works it out, desk.js: the reply has total and free, never a percentage, so
      // these lines were always left out, 25 Oct 2026)
      const used = (x) => (x && x.total ? Math.round(((x.total - x.free) / x.total) * 100) + "% used" : "");
      return {
        big: v.reachable ? "Running" : "Can't reach it",
        small: v.lastBackup ? "Last backup " + ago(v.lastBackup) : "",
        rows: [["Memory", used(v.memory)], ["Disk", used(v.disk)], ["Processors", v.cpu && v.cpu.load ? "busy " + v.cpu.load[0] : ""]].filter((r) => r[1]),
        empty: "",
      };
    },
  };
  // (sections with nothing to count: a line that says what they're for)
  const WORDS = {
    bot: "Try NovaBot as clients see it, or ask Nova about your bookings.",
    tests: "Things that look like tests or copies, to tidy away.",
    me: "Your planet, your name and your sign-in.",
  };

  // ---- Drawing ----
  let drawn = "";
  function tile(item, P) {
    const box = el("article", "dash-tile");
    box.dataset.key = "dash-" + item.at;
    const head = el("div", "dash-tile-head");
    head.append(P.icon(item.icon || item.name), el("h3", "dash-name", item.name));
    const n = P.count(item.badge);
    if (n) head.append(el("span", "badge", String(n)));
    const open = el("button", "dash-open", "Open ›");
    open.type = "button";
    open.setAttribute("aria-label", "Open " + item.name);
    open.addEventListener("click", () => run(item));
    head.append(open);
    const body = el("div", "dash-body");
    body.append(el("p", "dash-loading", "…"));
    box.append(head, body);
    const fill = TILES[item.at];
    if (!fill) {
      body.replaceChildren(el("p", "dash-small", WORDS[item.at] || "Open it for the whole section."));
      return box;
    }
    fill()
      .then((t) => {
        const parts = [];
        const top = el("p", "dash-top");
        top.append(el("span", "dash-big", t.big || ""), el("span", "dash-small", t.small || ""));
        parts.push(top);
        if (t.rows && t.rows.length) {
          const ul = el("ul", "dash-rows");
          for (const [main, side, at] of t.rows) {
            const li = el("li");
            li.append(el("span", "dash-main", main), el("span", "dash-side", side || ""));
            // (a line opens that very thing: an enquiry, a chat; otherwise its section)
            li.tabIndex = 0;
            li.title = "Open: " + main;
            // (at: an address in Portal, or what to do: Money's lines open the Invoicer or Money's part)
            const open = () => (typeof at === "function" ? at() : at && window.PortalPage ? window.PortalPage.go(at, { replace: true }) : run(item));
            li.addEventListener("click", open);
            li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
            ul.append(li);
          }
          parts.push(ul);
        } else if (t.empty) parts.push(el("p", "dash-empty", t.empty));
        body.replaceChildren(...parts);
      })
      .catch((err) => body.replaceChildren(el("p", "dash-empty", err.message === "signed out" ? "" : "Couldn't load this just now: " + err.message)));
    return box;
  }
  function run(item) {
    try {
      item.run();
    } catch (err) {
      say("That didn't open: " + (err.message || err));
    }
  }
  // The tiles: every section in Nova Tabs (in their order, each once), less Today itself and the pages
  // about you and the team
  const NOT = new Set(["today", "me", "admin"]);
  const NAMES = { calendar: "Bookings" };
  function today() {
    const P = window.NovaPillars;
    const grid = $("today-dash");
    if (!P || !grid) return;
    const seen = new Set();
    const items = [];
    for (const g of P.now()) {
      for (const it of g.items) {
        if (!it.at || NOT.has(it.at) || seen.has(it.at)) continue;
        seen.add(it.at);
        items.push({ ...it, name: NAMES[it.at] || it.name, icon: it.name, hue: P.hue(g.name) });
      }
    }
    cache.clear();
    grid.replaceChildren(...items.map((it) => {
      const t = tile(it, P);
      t.style.setProperty("--g", it.hue);
      return t;
    }));
  }

  // A Nova Tab's Overview: a tile for each of its sections
  function group() {
    const P = window.NovaPillars;
    const grid = $("dash-grid");
    if (!P || !grid) return;
    const want = new URLSearchParams(location.search).get("g") || "";
    const groups = P.now();
    const g = groups.find((x) => P.slug(x.name) === want) || groups[0];
    if (!g) return;
    $("view-group").style.setProperty("--g", P.hue(g.name));
    $("dash-title").replaceChildren(P.icon(g.name), el("span", "", g.name));
    cache.clear();
    const items = g.items.filter((i) => i.at);
    const tiles = items.map((it) => tile({ ...it, name: it.at === "calendar" ? "Bookings" : it.name }, P));
    // (a Nova Tab with one section or none (Plans & Nova, You, Look & sound): its other items too, a tile
    // for each part, so its Overview is never one lone tile or a line of words in an empty pane; the user,
    // 25 Oct 2026: "there shouldn't be any blank sections")
    if (items.length < 2) tiles.push(...partTiles(g, P));
    // (and each of them whole on a page, drawn a little smaller if it must be: in a short window a tile's name
    // was on one page and its lines on the next)
    if (items.length < 2) for (const t of tiles) t.setAttribute("data-os-keep", "");
    // (how many tiles, so the grid is no wider than they need and sits in the middle: dash.css)
    grid.style.setProperty("--n", String(Math.max(1, tiles.length)));
    grid.replaceChildren(...(tiles.length ? tiles : [el("p", "dash-empty", "Everything in " + g.name + " is along the top.")]));
  }
  // A Nova Tab's other items (pillars.js: each one's part, and how it's set now), a tile per part: a line
  // for each that does it, the same as its button along the top
  function partTiles(g, P) {
    const parts = new Map();
    for (const it of g.items.filter((i) => !i.at)) {
      const name = it.part || "Shortcuts";
      if (!parts.has(name)) parts.set(name, []);
      parts.get(name).push(it);
    }
    const nowOf = (it) => {
      try {
        return (it.now && it.now()) || "";
      } catch (err) {
        return "";
      }
    };
    return [...parts].map(([name, list]) => {
      const box = el("article", "dash-tile dash-parts");
      box.dataset.key = "dash-part-" + P.slug(name);
      const head = el("div", "dash-tile-head");
      head.append(P.icon(list[0].name), el("h3", "dash-name", name));
      const ul = el("ul", "dash-rows");
      for (const it of list) {
        const li = el("li");
        const side = el("span", "dash-side", nowOf(it));
        li.append(el("span", "dash-main", it.name), side);
        li.tabIndex = 0;
        li.title = it.name;
        // (after it's done, the line says how it's set now: Music on, Hands-free off…)
        const open = () => {
          run(it);
          setTimeout(() => (side.textContent = nowOf(it)), 900);
        };
        li.addEventListener("click", open);
        li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
        ul.append(li);
      }
      const body = el("div", "dash-body");
      body.append(ul);
      box.append(head, body);
      return box;
    });
  }

  // Inbox's dashboard (app.js showInbox): today's bookings along the top of Enquiries, each opening
  // Booking tools (the user, 22 Oct 2026: "today can be in enquiries")
  function inboxToday() {
    const box = $("inbox-today");
    if (!box) return;
    cache.delete("calendar");
    cache.delete("conversations");
    const tools = () => window.PortalPage && window.PortalPage.go("/portal/?view=calendar", { replace: true });
    TILES.today()
      .then((t) => {
        const parts = [el("span", "it-label", "Today")];
        if (!t.rows.length) parts.push(el("span", "it-none", t.empty));
        for (const [name, time] of t.rows.slice(0, 3)) {
          const b = el("button", "it-booking");
          b.type = "button";
          b.title = "Open Booking tools";
          b.append(el("b", "", time), el("span", "", name));
          b.addEventListener("click", tools);
          parts.push(b);
        }
        if (t.rows.length > 3) parts.push(el("span", "it-none", `+${t.rows.length - 3} more`));
        const talked = (t.small.split(" · ")[1] || "").trim();
        if (talked) parts.push(el("span", "it-small", talked));
        const open = el("button", "chip it-tools", "Booking tools");
        open.type = "button";
        open.addEventListener("click", tools);
        parts.push(open);
        box.replaceChildren(...parts);
      })
      .catch((err) => box.replaceChildren(el("span", "it-label", "Today"), el("span", "it-none", err.message === "signed out" ? "" : "Couldn't load today's bookings: " + err.message)));
  }

  window.NovaDash = { today, group, inboxToday };
})();
