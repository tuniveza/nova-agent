// Nova Phone: the Console. Everything in Nova, typed: Nova Desk's Console (web/console) made for a phone. The same
// commands, with the same words and answers (web/console/js/commands.js), drawn as phone words instead of a
// terminal's: headings, facts in two columns, tables that become stacked rows on a narrow screen.
//   - Quick commands in Desk's four groups; Desk's extra keys (Tab, Ctrl, Esc, arrows, | ~ /) and A−/A+;
//     what you typed kept on this phone (↑ ↓), Tab or a tap on a suggestion to finish a word, "did you mean".
//   - Nothing changes without Desk's own step first: approve / reject show exactly what would go, then ask for its
//     number to be typed back; backup asks for "yes".
//   - Terminals (a shell on the studio computer or the server, ssh to the VPS) open only where Nova Agent allows
//     them (at localhost, for admins: src/console.ts), drawn by lib/term.js, loaded only when one opens; their
//     output stops streaming while you're elsewhere or the phone is locked, and picks up again on return.
//   - `open <app>` and the rest open places in Nova Phone, never Nova Desk's pages.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, toast } = N;
  const HDR = { "X-Nova-Visualizer": "1" };
  const FONT_KEY = "nova-console-font", OPEN_KEY = "nova-console-open", HISTORY_KEY = "nova-console-history", GROUP_KEY = "console-quick-group";
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const session = {
    get: () => { try { return JSON.parse(sessionStorage.getItem(OPEN_KEY)) || []; } catch { return []; } },
    set: (v) => { try { sessionStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch {} },
  };

  // ---- Talking to Nova (the addresses Desk's Console uses, with its words when something's wrong) ----
  async function api(path, { method = "GET", body, headers = {} } = {}) {
    let res;
    try {
      res = await fetch(path, { method, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json", ...HDR, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw Object.assign(new Error(navigator.onLine === false ? "You're offline. Check your signal and try again." : "Couldn't reach Nova. Check your signal and try again."), { offline: true });
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || (data && data.ok === false)) {
      const message = (data && (data.message || data.error)) || (res.status === 401 ? "Sign in with Portal first." : res.status === 503 ? "The studio computer is off or offline." : res.status === 404 ? "That isn't here (it may need a newer Nova Agent)." : `Something went wrong (${res.status}).`);
      throw Object.assign(new Error(message), { status: res.status, signIn: res.status === 401 });
    }
    return data ?? {};
  }

  // ---- Reading a line: words, "quoted words", 'single quotes', and --flag value ----
  function tokenize(line) {
    const out = [];
    let cur = "", quote = "", had = false;
    for (const ch of String(line)) {
      if (quote) { if (ch === quote) quote = ""; else cur += ch; }
      else if (ch === '"' || ch === "'" || ch === "“" || ch === "”") { quote = ch === "“" ? "”" : ch; had = true; }
      else if (/\s/.test(ch)) { if (cur || had) out.push(cur); cur = ""; had = false; }
      else cur += ch;
    }
    if (quote) throw new Error("A quote isn't closed.");
    if (cur || had) out.push(cur);
    return out;
  }
  function parse(line) {
    const words = tokenize(line);
    const args = [], flags = {};
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/^[—–]/, "--"); // (a phone keyboard turns -- into a dash)
      if (/^--[a-z][\w-]*$/i.test(w)) {
        const next = words[i + 1];
        if (next !== undefined && !/^(--|[—–])/.test(next)) { flags[w.slice(2)] = next; i++; } else flags[w.slice(2)] = true;
      } else args.push(words[i]);
    }
    return { name: (args.shift() || "").toLowerCase(), args, flags };
  }

  // ---- Small helpers ----
  const UK = { timeZone: "Europe/London" };
  const ukTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const ukDay = (d) => d.toLocaleDateString("en-CA", UK);
  const short = (id) => String(id || "").slice(0, 8);
  const need = (v, what) => { if (!v) throw new Error(`Say which ${what}.`); return v; };
  const adminOnly = (ctx) => { if (ctx.me?.role !== "admin") throw new Error("That's for admins."); };
  function firstList(data) {
    if (Array.isArray(data)) return data;
    for (const v of Object.values(data || {})) if (Array.isArray(v)) return v;
    return [];
  }
  function summary(x) {
    const title = x.title || x.subject || x.name || x.caption || x.summary || x.toName || x.number || x.preview || x.lastMessage || x.firstMessage || x.question || x.message || x.text || x.description || x.id;
    return {
      id: x.id ?? "",
      title: String(title ?? "").replace(/\s+/g, " ").slice(0, 70),
      state: String(x.status || x.state || x.mark || (x.done ? "done" : "") || "").replace(/_/g, " "),
      when: ukTime(x.updatedAt || x.updated_at || x.lastAt || x.last_at || x.createdAt || x.created_at || x.start || x.when || x.at || ""),
    };
  }
  function pick(list, key, what) {
    const k = String(need(key, what)).toLowerCase();
    const hits = list.filter((x) => String(x.id).toLowerCase() === k || String(x.id).toLowerCase().startsWith(k));
    if (!hits.length) throw new Error(`No ${what} starts with "${key}". List them first.`);
    if (hits.length > 1) throw new Error(`More than one ${what} starts with "${key}": type a little more of it.`);
    return hits[0];
  }
  // A file that sets a global (the build's version), loaded the first time it's asked for
  const loadedScripts = new Map();
  function script(src, global) {
    if (!loadedScripts.has(src)) loadedScripts.set(src, new Promise((resolve) => {
      if (window[global]) return resolve(window[global]);
      const s = Object.assign(document.createElement("script"), { src });
      s.onload = () => resolve(window[global] || null);
      s.onerror = () => { loadedScripts.delete(src); s.remove(); resolve(null); };
      document.head.append(s);
    }));
    return loadedScripts.get(src);
  }

  // ---- What can be approved, and where (an admin, with the item's number typed back) ----
  const APPROVABLE = {
    campaign: { list: "campaigns", one: (id) => `campaigns/${id}`, act: (id, a) => `campaigns/${id}/${a}` },
    outreach: { list: "outreach", one: (id) => `outreach/${id}`, act: (id, a) => `outreach/${id}/${a}` },
    social: { list: "social", one: (id) => `social/${id}`, act: (id, a) => `social/${id}/${a}` },
    invoice: { list: "money", one: (id) => `money/invoices/${id}`, act: (id, a) => `money/invoices/${id}/${a}` },
    reminder: { list: "money", one: null, act: (id, a) => `money/reminders/${id}/${a}` },
    booking: { list: "booking-actions", one: null, act: (id, a) => `booking-actions/${id}/${a}` },
  };
  const PORTAL = { enquiries: "enquiries", chats: "conversations", conversations: "conversations", clients: "clients", money: "money", campaigns: "campaigns", outreach: "outreach", social: "social", approvals: "booking-actions", tests: "tidy", alerts: "notifications" };
  // Desk's apps, as Nova Phone's places (and the phone's own other places)
  const APPS = { invoicer: "money", portal: "today", calendar: "calendar", notes: "notes", board: "board", index: "index", lossless: "lossless", visualizer: "visualizer", observatory: "observatory", fixer: "fixer", console: "console", agent: "agent", quests: "quests", manual: "help" };
  const MORE_PLACES = { nova: "visualizer", today: "today", inbox: "inbox", clients: "clients", outreach: "outreach", money: "money", computer: "computer", google: "google", tests: "tests", crew: "crew", you: "you", more: "more", help: "help" };
  const P = (path) => "/app/api/" + path;

  // ---- The commands (Desk's, word for word; where Desk opens one of its pages, the phone opens its place) ----
  const COMMANDS = {
    help: {
      help: "Everything you can type, in groups",
      usage: "help [command]",
      async run(ctx, [which]) {
        if (which) {
          const name = resolveName(which.toLowerCase());
          const c = COMMANDS[name];
          if (!c) throw new Error(notFound(which));
          ctx.heading(name);
          ctx.kv([["What", c.help], ["Type", c.usage], ...(c.subs ? [["Parts", c.subs.join(" · ")]] : []), ...(EXAMPLES[name] ? [["Example", EXAMPLES[name]]] : [])]);
          return;
        }
        ctx.help(GROUPS.map(([title, names]) => ({ title, rows: names.filter((n) => COMMANDS[n]).map((n) => ({ name: n, what: COMMANDS[n].help, example: EXAMPLES[n] || "" })) })));
        ctx.dim("Tab finishes a word · ↑ ↓ go back through what you typed · help <command> for more · tap a command above to run it");
      },
    },
    clear: { help: "Clear the screen", usage: "clear", async run(ctx) { ctx.clear(); } },
    history: { help: "What you've typed", usage: "history", async run(ctx) { const h = ctx.history(); if (!h.length) return ctx.dim("Nothing typed yet."); ctx.lines(h.map((l, i) => `${String(i + 1).padStart(3)}  ${l}`)); } },
    whoami: { help: "Who's signed in", usage: "whoami", async run(ctx) { ctx.print(`${ctx.me.name} (${ctx.me.role})${ctx.me.online ? " · online" : " · on the studio computer"}`); } },

    status: {
      help: "How Nova Agent is doing",
      usage: "status",
      async run(ctx) {
        const [s, q, c] = await Promise.allSettled([ctx.api("/status"), ctx.api("/quests/state"), ctx.api("/console-api/state")]);
        const rows = [];
        if (s.status === "fulfilled") rows.push({ part: "Agent", state: s.value.live ? "live" : "trying things out (dry run)" }, { part: "Online link", state: s.value.connected ? "linked to Nova Bot" : "not linked" }, { part: "Model", state: s.value.model || "" });
        else rows.push({ part: "Nova Agent", state: "can't be reached" });
        if (q.status === "fulfilled") {
          const open = (q.value.quests || []).filter((x) => x.status === "todo" || x.status === "doing");
          rows.push({ part: "Quests", state: `${open.length} to do${q.value.current ? ` · now: ${q.value.current.title}` : ""}` });
        }
        if (c.status === "fulfilled") rows.push({ part: "Terminals", state: c.value.terminals ? "can open here" : c.value.why });
        ctx.table(rows, ["part", "state"]);
      },
    },

    now: {
      help: "What's on now and next",
      usage: "now",
      async run(ctx) {
        const s = await ctx.api("/quests/state");
        ctx.print(s.current ? `Now   ${s.current.title}` : "Now   nothing planned");
        for (const q of s.next || []) ctx.print(`Next  ${q.title}  ${ukTime(q.start)}`);
        if ((s.overdue || []).length) ctx.warn(`${s.overdue.length} overdue`);
      },
    },
    plans: { help: "Same as now", usage: "plans", async run(ctx, a, f) { return COMMANDS.now.run(ctx, a, f); } },

    quests: {
      help: "Your quests: list, add, start, done, skip, snooze",
      usage: 'quests [list | add "<title>" [--minutes 30] [--deadline YYYY-MM-DD] | start|done|skip|snooze <id> [minutes]]',
      subs: ["list", "add", "start", "done", "skip", "snooze"],
      async run(ctx, [sub = "list", key, extra], flags) {
        sub = sub.toLowerCase();
        if (sub === "list") {
          const s = await ctx.api("/quests/state");
          const open = (s.quests || []).filter((q) => flags.all || q.status === "todo" || q.status === "doing");
          if (!open.length) return ctx.dim('Nothing to do. Add one: quests add "Mix the EP"');
          ctx.table(open.map((q) => ({ id: short(q.id), title: q.title, state: q.status, when: ukTime(q.start) })), ["id", "title", "state", "when"]);
          return;
        }
        if (sub === "add") {
          const title = need(key, "quest (its title, in quotes)");
          const body = { title, minutes: Number(flags.minutes) || 30 };
          if (flags.deadline) body.deadline = String(flags.deadline);
          const r = await ctx.api("/actions/quests", { method: "POST", body });
          return ctx.ok(`Added: ${r.quest?.title || title}`);
        }
        const actions = { start: "start", done: "done", skip: "skip", snooze: "snooze" };
        if (!actions[sub]) throw new Error(`quests ${sub}? Try: ${this.subs.join(", ")}`);
        const s = await ctx.api("/quests/state");
        const q = pick(s.quests || [], key, "quest");
        const body = { action: actions[sub] };
        if (sub === "snooze") body.minutes = Number(extra) || 15;
        await ctx.api(`/actions/quests/${q.id}`, { method: "POST", body });
        ctx.ok(`${sub === "done" ? "Done" : sub === "start" ? "Started" : sub === "skip" ? "Skipped" : "Snoozed"}: ${q.title}`);
      },
    },

    calendar: {
      help: "The calendar: today, week, or add a note",
      usage: 'calendar [today | week | add "<title>" <YYYY-MM-DD> [HH:MM]]',
      subs: ["today", "week", "add"],
      async run(ctx, [sub = "today", title, date, time]) {
        sub = sub.toLowerCase();
        if (sub === "add") {
          need(title, "note (its title, in quotes)");
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Give the day as YYYY-MM-DD.");
          if (time && !/^\d{2}:\d{2}$/.test(time)) throw new Error("Give the time as HH:MM.");
          const data = await ctx.api("/calendar-api/data");
          const now = new Date().toISOString();
          const start = `${date}T${time || "09:00"}`;
          const note = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, body: "", author: ctx.me?.name || "", start, end: start, art: { seed: Math.floor(Math.random() * 1e6), subject: "" }, allDay: !time, created: now, updated: now };
          data.notes = [...(data.notes || []), note];
          await ctx.api("/calendar-api/data", { method: "PUT", body: data, headers: { "X-Nova-Rev": String(data.rev ?? "") } });
          return ctx.ok(`Added to ${date}${time ? ` at ${time}` : ""}: ${title}`);
        }
        if (sub !== "today" && sub !== "week") throw new Error(`calendar ${sub}? Try: ${this.subs.join(", ")}`);
        const from = ukDay(new Date());
        const to = ukDay(new Date(Date.now() + (sub === "week" ? 7 : 1) * 86400000));
        const data = await ctx.api("/calendar-api/data");
        const list = (data.notes || []).filter((n) => { const day = String(n.start || "").slice(0, 10); return day >= from && day < to; }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
        if (!list.length) return ctx.dim(sub === "today" ? "Nothing on the calendar today." : "Nothing on the calendar this week.");
        ctx.table(list.map((n) => ({ when: n.allDay || !String(n.start).includes("T") ? String(n.start).slice(0, 10) : String(n.start).replace("T", " "), what: n.title || "" })), ["when", "what"]);
        ctx.dim("(repeating cards show on their first day; Calendar shows every repeat)");
      },
    },

    notes: {
      help: "Notes: list, open, new",
      usage: "notes [list | open <id> | new]",
      subs: ["list", "open", "new"],
      async run(ctx, [sub = "list", key]) {
        sub = sub.toLowerCase();
        const all = async () => {
          const data = await ctx.api("/notes-api/changes?since=0").catch(() => null);
          const byId = new Map();
          for (const n of data ? firstList(data) : []) byId.set(n.id, n);
          return [...byId.values()].filter((n) => n.html !== "");
        };
        if (sub === "new") return ctx.open("notes/new");
        if (sub === "open") {
          need(key, "note");
          // (the list shows the first 8 letters of each id: those are enough)
          let id = key;
          try { id = pick(await all(), key, "note").id; } catch {}
          return ctx.open(`notes/${encodeURIComponent(id)}`);
        }
        const list = (await all()).sort((a, b) => String(b.updatedAt || b.updated_at || b.updated || "").localeCompare(String(a.updatedAt || a.updated_at || a.updated || "")));
        if (!list.length) return ctx.dim("No shared notes here (notes kept only in a browser stay in that browser).");
        ctx.table(list.slice(0, 40).map((n) => ({ id: short(n.id), title: n.title || "Untitled", changed: ukTime(n.updatedAt || n.updated_at || n.updated) })), ["id", "title", "changed"]);
      },
    },

    board: {
      help: "Boards: list, open",
      usage: "board [list | open]",
      subs: ["list", "open"],
      async run(ctx, [sub = "list"]) {
        if (sub.toLowerCase() === "open") return ctx.open("board");
        const r = await ctx.api("/board-api/boards");
        const list = r.boards || [];
        if (!list.length) return ctx.dim("No boards yet. Type: board open");
        ctx.table(list.map((b) => ({ name: b.name || b.title || "Board", cards: (b.cards || []).length, changed: ukTime(b.updated || b.updatedAt) })), ["name", "cards", "changed"]);
      },
    },

    portal: {
      help: "Portal's sections: enquiries, chats, clients, money, campaigns, outreach, social, approvals, tests, alerts",
      usage: "portal <section>",
      subs: Object.keys(PORTAL),
      async run(ctx, [section]) {
        const path = PORTAL[(section || "").toLowerCase()];
        if (!path) throw new Error(`portal <section>: ${Object.keys(PORTAL).join(", ")}`);
        const data = await ctx.api(P(path));
        const list = firstList(data);
        if (!list.length) return ctx.dim("Nothing there.");
        ctx.table(list.slice(0, 40).map(summary), ["id", "title", "state", "when"]);
        if (list.length > 40) ctx.dim(`… and ${list.length - 40} more (open portal to see them all)`);
        return data;
      },
    },

    approve: { help: "Approve something waiting (admins; you'll be asked to confirm)", usage: `approve <${Object.keys(APPROVABLE).join("|")}> <number>`, subs: Object.keys(APPROVABLE), async run(ctx, [kind, id]) { return decide(ctx, "approve", kind, id); } },
    reject: { help: "Reject something waiting (admins; you'll be asked to confirm)", usage: `reject <${Object.keys(APPROVABLE).join("|")}> <number>`, subs: Object.keys(APPROVABLE), async run(ctx, [kind, id]) { return decide(ctx, "reject", kind, id); } },

    google: {
      help: "Google: status, or sync a part now",
      usage: "google [status | sync <calendar|contacts|replies|sheets|backups|inbox|tasks|docs>]",
      subs: ["status", "sync"],
      async run(ctx, [sub = "status", part]) {
        if (sub.toLowerCase() === "sync") {
          adminOnly(ctx);
          const r = await ctx.api(P("google/sync"), { method: "POST", body: { part: need(part, "part") } });
          return ctx.ok(r.note || "Started. It carries on in the background.");
        }
        const g = await ctx.api(P("google"));
        ctx.print(g.connected ? `Connected as ${g.account}` : "Not connected (Portal → Admin → Google)");
        if ((g.missing || []).length) ctx.warn(`Needs Connect again for: ${g.missing.join(", ")}`);
        if (Array.isArray(g.parts)) ctx.table(g.parts.map((p) => ({ part: p.id, on: p.on ? "on" : "off", allowed: p.allowed === false ? "no" : "yes" })), ["part", "on", "allowed"]);
      },
    },

    fixer: {
      help: "The Fixer: status, check now, jobs (admins)",
      usage: "fixer [status | check | jobs]",
      subs: ["status", "check", "jobs"],
      async run(ctx, [sub = "status"]) {
        adminOnly(ctx);
        sub = sub.toLowerCase();
        if (sub === "check") {
          await ctx.api("/actions/fixer/check", { method: "POST", body: {} });
          return ctx.ok("Checking now. Open the Fixer to watch: open fixer");
        }
        const s = await ctx.api("/fixer-api/state");
        if (sub === "jobs") return ctx.table((s.jobs || []).map((j) => ({ id: short(j.id), what: j.target?.title || "", state: j.status })), ["id", "what", "state"]);
        ctx.table([{ part: "Problems", state: String((s.issues || []).length) }, { part: "Fixes", state: String((s.jobs || []).length) }, { part: "Last check", state: ukTime(s.lastCheck?.at) }], ["part", "state"]);
      },
    },

    lossless: {
      help: "Lossless audio: start (opens it), status",
      usage: "lossless [start | status]",
      subs: ["start", "status"],
      async run(ctx, [sub = "start"]) {
        if (sub.toLowerCase() === "status") {
          const s = await ctx.api("/status").catch(() => null);
          return ctx.print(s ? "Lossless audio is ready: lossless start opens it" : "Nova Agent can't be reached");
        }
        ctx.open("lossless");
        ctx.ok("Opened Lossless audio.");
      },
    },

    music: {
      help: "Ambient music: on, off, next, seed",
      usage: "music [on | off | next | seed [CODE]]",
      subs: ["on", "off", "next", "seed", "status"],
      async run(ctx, [sub = "seed", code]) {
        sub = sub.toLowerCase();
        if (sub === "status") sub = "seed";
        const m = await ctx.music;
        if (!m) throw new Error("The music didn't load. Check the connection and try again (Settings → Music has it too).");
        if (sub === "on") return void (await m.start(), ctx.ok("Music on"));
        if (sub === "off") return void (m.stop(), ctx.ok("Music off"));
        if (sub === "next") return void (m.newSeed && m.newSeed(), ctx.ok(`A new variation: ${m.seed && m.seed()}`));
        if (sub === "seed") {
          if (code) { m.setSeed(code); return ctx.ok(`Playing ${code}`); }
          const piece = m.piece ? m.piece() : null;
          return ctx.kv([["Music", m.isPlaying && m.isPlaying() ? "playing" : "off"], ["Seed", m.seed ? m.seed() : "?"], ["Piece", piece?.name || "—"]]);
        }
        throw new Error(`music ${sub}? Try: ${this.subs.join(", ")}`);
      },
    },

    theme: {
      help: "The look: list, or choose a colour",
      usage: "theme [list | <name> | own]",
      async run(ctx, [name = "list"]) {
        const look = await ctx.look;
        if (!look) throw new Error("The themes didn't load. Check the connection and try again.");
        if (name === "list") return ctx.print(look.themes.map((t) => t.name).join(" · ") + (look.own ? " · own" : ""));
        if (name === "own") {
          if (!look.own) throw new Error("Every place on Nova Phone wears the same look, so there's no own theme here: theme list shows them.");
          look.setTheme(null);
          return ctx.ok("Each panel's own theme");
        }
        const n = name.toLowerCase();
        const ids = [n, LOOK_NAMES[n], DESK_NAMES[n]].filter(Boolean);
        const t = look.themes.find((x) => ids.includes(String(x.id).toLowerCase()) || String(x.name).toLowerCase() === n);
        if (!t) throw new Error(`No theme called "${name}". theme list shows them.`);
        look.setTheme(t.id);
        ctx.ok(`Theme: ${t.name}`);
      },
    },

    open: {
      help: "Open an app or panel in Nova Agent",
      usage: `open <${Object.keys(APPS).join("|")}>`,
      subs: Object.keys(APPS),
      async run(ctx, [name]) {
        const n = (name || "").toLowerCase();
        const where = APPS[n] || MORE_PLACES[n] || (N.has(n) ? n : "");
        if (!where || !N.has(where.split("/")[0])) throw new Error(`open <app>: ${Object.keys(APPS).join(", ")}`);
        ctx.open(where);
        ctx.ok(`Opened ${name}`);
      },
    },

    agent: {
      help: "Ask Agent something",
      usage: 'agent "<question>"',
      async run(ctx, words) {
        const message = words.join(" ").trim();
        if (!message) throw new Error('Ask something: agent "what\'s on today?"');
        ctx.dim("Agent is thinking…");
        const r = await ctx.api("/actions/chat", { method: "POST", body: { message } });
        ctx.print(r.reply || "(no answer)");
        for (const a of r.actions || []) ctx.dim(`  · ${a.text || a.kind}`);
      },
    },

    admin: {
      help: "Admin: crew, invite, pages (admins)",
      usage: "admin [crew | invite | pages]",
      subs: ["crew", "invite", "pages"],
      async run(ctx, [sub = "crew"]) {
        adminOnly(ctx);
        sub = sub.toLowerCase();
        if (sub === "invite") return ctx.open("crew");
        if (sub === "pages") { ctx.open("more"); return ctx.ok("Opened More: Admin has the crew, Google, Computer, Test stuff and the Fixer."); }
        const r = await ctx.api("/staff");
        const list = firstList(r);
        ctx.table(list.map((p) => ({ id: p.id, name: p.display_name || p.name, role: p.role, state: p.status })), ["id", "name", "role", "state"]);
      },
    },

    index: {
      help: "Index (what Nova knows): search",
      usage: "index search <words>",
      subs: ["search"],
      async run(ctx, [sub, ...words]) {
        if ((sub || "").toLowerCase() !== "search") throw new Error("index search <words>");
        const q = need(words.join(" ").trim(), "words");
        const r = await ctx.api(P(`memory/index?q=${encodeURIComponent(q)}`));
        const list = firstList(r).filter((f) => JSON.stringify(f).toLowerCase().includes(q.toLowerCase()));
        if (!list.length) return ctx.dim("Nothing found.");
        ctx.table(list.slice(0, 30).map((f) => ({ page: f.path || f.name, about: String(f.description || "").slice(0, 60) })), ["page", "about"]);
      },
    },

    logs: {
      help: "Nova Agent's recent log (admins)",
      usage: "logs [count]",
      async run(ctx, [n = "30"]) {
        adminOnly(ctx);
        const r = await ctx.api(`/console-api/logs?n=${encodeURIComponent(n)}`);
        if (!(r.lines || []).length) return ctx.dim("(nothing)");
        ctx.log((r.lines || []).map((l) => ({ time: new Date(l.time).toLocaleTimeString("en-GB", UK), part: l.part, message: l.message, bad: l.level === "error" })));
      },
    },

    shell: { help: "A terminal on the studio computer (admins, on that computer only)", usage: "shell", async run(ctx) { adminOnly(ctx); await ctx.terminal("shell"); } },
    vps: {
      help: "The VPSdime server: connect, set its address, add this computer's key",
      usage: "vps [connect | set <address> <user> [port] | setup-key | show]",
      subs: ["connect", "set", "setup-key", "show"],
      async run(ctx, [sub = "connect", host, user, port]) {
        adminOnly(ctx);
        sub = sub.toLowerCase();
        if (sub === "set") {
          const r = await ctx.api("/console-api/vps", { method: "POST", body: { host: need(host, "address"), user: need(user, "user"), port: Number(port) || 22 } });
          return ctx.ok(`Saved: ${r.vps.user}@${r.vps.host}:${r.vps.port}. Next: vps setup-key (once), then vps`);
        }
        if (sub === "show") {
          const s = await ctx.api("/console-api/state");
          return ctx.print(s.vps ? `${s.vps.user}@${s.vps.host}:${s.vps.port}` : "Not set yet: vps set <address> <user> [port]");
        }
        if (sub === "setup-key") return ctx.terminal("vps-key");
        if (sub === "connect") return ctx.terminal("vps");
        throw new Error(`vps ${sub}? Try: ${this.subs.join(", ")}`);
      },
    },

    today: {
      help: "Your day at a glance: what's on, the calendar, what's waiting",
      usage: "today",
      async run(ctx) {
        ctx.heading(new Date().toLocaleDateString("en-GB", { ...UK, weekday: "long", day: "numeric", month: "long" }));
        const [q, cal, enq, alerts] = await Promise.allSettled([ctx.api("/quests/state"), ctx.api("/calendar-api/data"), ctx.api(P("enquiries")), ctx.api(P("notifications"))]);
        const rows = [];
        if (q.status === "fulfilled") {
          const s = q.value;
          rows.push(["Now", s.current ? s.current.title : "nothing planned"]);
          const next = (s.next || [])[0];
          if (next) rows.push(["Next", `${next.title} · ${ukTime(next.start)}`]);
          const open = (s.quests || []).filter((x) => x.status === "todo" || x.status === "doing").length;
          rows.push(["Quests", `${open} to do${(s.overdue || []).length ? ` · ${s.overdue.length} overdue` : ""}`]);
        } else rows.push(["Quests", "Nova Agent can't be reached"]);
        if (cal.status === "fulfilled") {
          const day = ukDay(new Date());
          const list = (cal.value.notes || []).filter((n) => String(n.start || "").slice(0, 10) === day);
          rows.push(["Calendar", list.length ? list.map((n) => n.title).slice(0, 4).join(" · ") : "nothing today"]);
        }
        if (enq.status === "fulfilled") {
          const fresh = firstList(enq.value).filter((e) => ["new", "open"].includes(String(e.status || e.state || "")));
          rows.push(["Enquiries", `${fresh.length} new or open`]);
        }
        // (Nova Phone's Console said how many alerts there are: kept)
        if (alerts.status === "fulfilled") rows.push(["Alerts", String(firstList(alerts.value).length)]);
        ctx.kv(rows);
      },
    },
    version: {
      help: "Which version of Nova Agent this is",
      usage: "version",
      async run(ctx) {
        const [v, s] = await Promise.all([script("/shared/status-data.js", "NOVA_STATUS"), ctx.api("/status").catch(() => null)]);
        ctx.kv([
          ["Nova Agent", v ? `v${v.version} · build ${v.build}` : "not known here"],
          ["Nova Agent", s ? s.version || s.rev || "running" : "can't be reached"],
          ["Where you are", ctx.me?.online ? "online (through Nova Bot)" : "on the studio computer"],
        ]);
      },
    },
    computer: {
      help: "The VPS: how it's doing, Nova Bot and Nova Agent on it, its jobs (admins)",
      usage: "computer",
      async run(ctx) {
        adminOnly(ctx);
        const d = await ctx.api(P("desk"));
        const h = d.here || {};
        const v = d.vps || {};
        const onServer = h.pc?.where === "server";
        const version = typeof h.version === "string" ? h.version : h.version ? `${h.version.id}${h.version.at ? ` · ${ukTime(h.version.at)}` : ""}` : "";
        ctx.heading("Live now");
        ctx.kv([
          ["Address", h.url || ""],
          ["Nova Agent", h.pc?.connected ? `${onServer ? "on the VPS" : "on the studio PC"}${h.pc.since ? ` · linked since ${ukTime(h.pc.since)}` : ""}` : "not linked"],
          ["Version", version],
          ...(h.agentSwitch ? [[onServer ? "Move Nova Agent to the PC" : "Move Nova Agent here", onServer ? h.agentSwitch.back : h.agentSwitch.to]] : []),
        ]);
        for (const w of h.warnings || []) ctx.warn(w);
        ctx.heading("VPS");
        if (!v.reachable) return ctx.kv([["Address", v.url || ""], ["State", v.reason || "can't be reached"]]);
        const gb = (n) => (n ? `${(n / 1e9).toFixed(1)} GB` : "");
        ctx.kv([
          ["Address", v.url || ""],
          ["Up for", v.uptimeSeconds ? `${Math.floor(v.uptimeSeconds / 86400)}d ${Math.floor((v.uptimeSeconds % 86400) / 3600)}h` : ""],
          ["Memory", v.memory ? `${gb(v.memory.total - v.memory.free)} of ${gb(v.memory.total)} used` : ""],
          ["Disk", v.disk ? `${gb(v.disk.free)} free of ${gb(v.disk.total)}` : ""],
          ["Services", v.services ? Object.entries(v.services).map(([k, x]) => `${k} ${x}`).join(" · ") : ""],
          ["Last data copy", v.lastSync ? ukTime(v.lastSync) : "never"],
          ["Last backup", v.lastBackup ? ukTime(v.lastBackup) : "none yet"],
        ]);
        const jobs = (h.jobs || []).slice(0, 8);
        if (jobs.length) {
          ctx.heading("Jobs");
          ctx.table(jobs.map((j) => ({ job: j.name, last: ukTime(j.at), state: j.ok ? "ok" : j.note || "problem" })), ["job", "last", "state"]);
        }
      },
    },
    deploy: {
      help: "What's live: Nova Bot's version, the VPS's, Nova Agent's",
      usage: "deploy status",
      subs: ["status"],
      async run(ctx, [sub = "status"]) {
        if (sub.toLowerCase() !== "status") throw new Error("deploy status");
        const [d, s] = await Promise.allSettled([ctx.api(P("desk")), ctx.api("/status")]);
        const desk = d.status === "fulfilled" ? d.value : null;
        const hv = desk?.here?.version;
        ctx.kv([
          ["Nova Bot", hv ? (typeof hv === "string" ? hv : `${hv.id} · ${ukTime(hv.at)}`) : d.status === "rejected" ? d.reason.message : "not known"],
          ["VPS", desk?.vps?.reachable ? desk.vps.version || "running" : desk?.vps?.reason || "not known"],
          ["Nova Agent", s.status === "fulfilled" ? s.value.version || s.value.rev || "running" : "can't be reached"],
        ]);
      },
    },
    backup: {
      help: "Back up the VPS's database now (admins; asks first)",
      usage: "backup",
      async run(ctx) {
        adminOnly(ctx);
        const typed = (await ctx.ask("Back up the VPS's database now? Type yes: ")).trim().toLowerCase();
        if (typed !== "yes") return ctx.dim("Cancelled. Nothing changed.");
        await ctx.api(P("desk/action"), { method: "POST", body: { do: "backup" } });
        ctx.ok("Backed up. computer shows when.");
      },
    },
    search: {
      help: "Look for words in quests, the calendar, boards, notes, Index and enquiries",
      usage: "search <words>",
      async run(ctx, words) {
        const q = need(words.join(" ").trim(), "words to look for").toLowerCase();
        const has = (x) => JSON.stringify(x || "").toLowerCase().includes(q);
        const found = [];
        const [qs, cal, boards, notes, index, enq] = await Promise.allSettled([
          ctx.api("/quests/state"), ctx.api("/calendar-api/data"), ctx.api("/board-api/boards"), ctx.api("/notes-api/changes?since=0"), ctx.api(P(`memory/index?q=${encodeURIComponent(q)}`)), ctx.api(P("enquiries")),
        ]);
        const val = (r) => (r.status === "fulfilled" ? r.value : null);
        for (const x of val(qs)?.quests || []) if (has([x.title, x.notes])) found.push({ where: "quest", what: x.title, id: short(x.id) });
        for (const n of val(cal)?.notes || []) if (has([n.title, n.body])) found.push({ where: "calendar", what: `${n.title} · ${String(n.start || "").slice(0, 10)}`, id: "" });
        for (const b of val(boards)?.boards || []) for (const c of b.cards || []) if (has([c.title, c.text, c.question, c.answer, c.url])) found.push({ where: `board ${b.name || ""}`.trim(), what: String(c.title || c.text || c.question || c.url || "card").slice(0, 70), id: "" });
        for (const n of firstList(val(notes) || {})) if (n.html !== "" && has([n.title, n.html])) found.push({ where: "note", what: n.title || "Untitled", id: short(n.id) });
        for (const f of firstList(val(index) || {})) if (has(f)) found.push({ where: "Index", what: f.path || f.name, id: "" });
        for (const e of firstList(val(enq) || {})) if (has([e.name, e.subject, e.details, e.email])) found.push({ where: "enquiry", what: e.subject || e.name, id: String(e.id ?? "") });
        if (!found.length) return ctx.dim(`Nothing found for "${q}".`);
        ctx.table(found.slice(0, 40), ["where", "what", "id"]);
        if (found.length > 40) ctx.dim(`… and ${found.length - 40} more`);
      },
    },
    ask: { help: "Ask Agent something (same as agent)", usage: 'ask "<question>"', async run(ctx, a, f) { return COMMANDS.agent.run(ctx, a, f); } },
    enquiries: { help: "Portal's enquiries (same as portal enquiries)", usage: "enquiries", async run(ctx) { return COMMANDS.portal.run(ctx, ["enquiries"], {}); } },
    chats: { help: "Portal's chats (same as portal chats)", usage: "chats", async run(ctx) { return COMMANDS.portal.run(ctx, ["chats"], {}); } },
    clients: { help: "Portal's clients (same as portal clients)", usage: "clients", async run(ctx) { return COMMANDS.portal.run(ctx, ["clients"], {}); } },
    money: {
      help: "Portal's money (same as portal money); everything for invoices is done in the Invoicer: open invoicer",
      usage: "money",
      async run(ctx) {
        const data = await COMMANDS.portal.run(ctx, ["money"], {});
        // (Nova Phone's Console gave the money in a line: kept, under Desk's list)
        const s = data && data.summary;
        if (s) ctx.print(`Owed ${N.money(s.owed?.pence)} on ${s.owed?.count || 0} invoices; overdue ${N.money(s.overdue?.pence)}; in this month ${N.money(s.month?.inPence)}.`);
      },
    },
    invoicer: { help: "Open the Invoicer, where everything for invoices is done (same as open invoicer)", usage: "invoicer", async run(ctx) { return COMMANDS.open.run(ctx, ["invoicer"], {}); } },
    campaigns: { help: "Portal's campaigns (same as portal campaigns)", usage: "campaigns", async run(ctx) { return COMMANDS.portal.run(ctx, ["campaigns"], {}); } },
    outreach: { help: "Portal's outreach (same as portal outreach)", usage: "outreach", async run(ctx) { return COMMANDS.portal.run(ctx, ["outreach"], {}); } },
    social: { help: "Portal's social (same as portal social)", usage: "social", async run(ctx) { return COMMANDS.portal.run(ctx, ["social"], {}); } },
    approvals: { help: "Portal's approvals waiting for an admin (same as portal approvals)", usage: "approvals", async run(ctx) { return COMMANDS.portal.run(ctx, ["approvals"], {}); } },
    alerts: { help: "Portal's alerts (same as portal alerts)", usage: "alerts", async run(ctx) { return COMMANDS.portal.run(ctx, ["alerts"], {}); } },
    tests: { help: "Portal's tests (same as portal tests)", usage: "tests", async run(ctx) { return COMMANDS.portal.run(ctx, ["tests"], {}); } },
  };
  // The first themes' two names (Nova Desk's look.js: "theme pulsar"; Nova Phone's first themes: "theme ocean")
  const LOOK_NAMES = { novacane: "cosmic", solar: "ember", pulsar: "ocean", eclipse: "gold" };
  const DESK_NAMES = { cosmic: "novacane", ember: "solar", ocean: "pulsar", gold: "eclipse" };

  // approve/reject: shows exactly what it is, then asks for its number to be typed back
  async function decide(ctx, action, kind, id) {
    adminOnly(ctx);
    // Invoices and their reminders are decided in the Invoicer (Money), at that one
    if (/^(invoice|reminder)$/i.test(kind || "")) {
      if (!/^\d{1,12}$/.test(String(id || ""))) throw new Error(`${action} ${kind} <number>`);
      let to = `money/invoice/${id}`;
      if (/^reminder$/i.test(kind)) {
        const m = await ctx.api(P("money")).catch(() => null);
        const r = (m?.reminders || []).find((x) => String(x.id) === String(id));
        to = r?.invoiceId ? `money/invoice/${r.invoiceId}` : "money";
      }
      ctx.open(to);
      return ctx.ok(`Opened ${kind} #${id} in the Invoicer: ${action} it there.`);
    }
    const k = APPROVABLE[(kind || "").toLowerCase()];
    if (!k) throw new Error(`${action} <${Object.keys(APPROVABLE).join("|")}> <number>`);
    if (!/^\d{1,12}$/.test(String(id || ""))) throw new Error("Give its number (portal campaigns, portal social… show them).");
    let item = null;
    if (k.one) item = await ctx.api(P(k.one(id))).catch(() => null);
    const it = item && (item.campaign || item.outreach || item.post || item.invoice || item.item || item);
    ctx.print(`${action === "approve" ? "About to approve" : "About to reject"} ${kind} #${id}:`);
    if (it && typeof it === "object") {
      const s = summary(it);
      ctx.print(`  ${s.title}`);
      if (it.body || it.caption || it.text) ctx.dim(`  ${String(it.body || it.caption || it.text).replace(/\s+/g, " ").slice(0, 300)}`);
      if (it.audience || it.toEmail || it.platforms) ctx.dim(`  to: ${it.audience || it.toEmail || [].concat(it.platforms).join(", ")}`);
    }
    if (action === "approve") ctx.warn("Approving lets Nova send or post it, exactly as above.");
    const typed = (await ctx.ask(`Type ${id} to ${action} (else cancel): `)).trim();
    if (typed !== String(id)) return ctx.dim("Cancelled. Nothing changed.");
    const body = action === "reject" ? { note: "Rejected in Console" } : {};
    const r = await ctx.api(P(k.act(id, action)), { method: "POST", body });
    ctx.ok(r.message || `${action === "approve" ? "Approved" : "Rejected"} ${kind} #${id}`);
  }

  // ---- help's groups, the quick buttons (Desk's), an example for each ----
  const GROUPS = [
    ["Start here", ["help", "today", "now", "status", "search", "whoami", "version"]],
    ["Plans", ["quests", "plans"]],
    ["Apps", ["calendar", "notes", "board", "agent", "ask", "index", "open"]],
    ["Studio", ["invoicer", "enquiries", "chats", "clients", "money", "campaigns", "outreach", "social", "approvals", "alerts", "tests", "portal", "approve", "reject"]],
    ["Tools", ["google", "fixer", "lossless", "music", "theme", "logs"]],
    ["Server", ["computer", "deploy", "backup", "vps", "shell"]],
    ["Admin", ["admin"]],
    ["Console", ["clear", "history"]],
  ];
  const QUICK = [
    ["Start here", [["Today", "today"], ["Now", "now"], ["Quests", "quests"], ["Search…", "search "], ["Help", "help"]]],
    ["Apps", [["Calendar", "calendar week"], ["Notes", "notes"], ["Boards", "board"], ["Ask Agent…", "ask "]]],
    ["Studio", [["Enquiries", "enquiries"], ["Clients", "clients"], ["Money", "money"], ["Social", "social"], ["Approvals", "approvals"]]],
    ["Tools", [["Google", "google"], ["Computer", "computer"], ["Clear", "clear"]]],
  ];
  const EXAMPLES = {
    help: "help quests", today: "today", now: "now", status: "status", search: "search mixing", whoami: "whoami", version: "version",
    quests: 'quests add "Mix the EP" --minutes 60', plans: "plans",
    calendar: "calendar week", notes: "notes list", board: "board list", agent: 'agent "what\'s on today?"', ask: 'ask "who booked last week?"', index: "index search pricing", open: "open board",
    enquiries: "enquiries", chats: "chats", clients: "clients", money: "money", campaigns: "campaigns", outreach: "outreach", social: "social", approvals: "approvals", alerts: "alerts", tests: "tests",
    portal: "portal enquiries", approve: "approve campaign 12", reject: "reject social 7",
    google: "google sync calendar", fixer: "fixer jobs", lossless: "lossless start", music: "music next", theme: "theme pulsar", logs: "logs 20",
    computer: "computer", deploy: "deploy status", backup: "backup", vps: "vps", shell: "shell", admin: "admin crew", clear: "clear", history: "history",
  };
  const ALIASES = { "?": "help", h: "help", q: "quests", quest: "quests", task: "quests", tasks: "quests", cal: "calendar", note: "notes", boards: "board", enquiry: "enquiries", inbox: "enquiries", chat: "chats", conversations: "chats", client: "clients", invoices: "money", campaign: "campaigns", posts: "social", server: "computer", desk: "computer", cls: "clear", ls: "help", find: "search", ver: "version", terminal: "shell", ssh: "vps" };
  const resolveName = (name) => (COMMANDS[name] ? name : ALIASES[name] && COMMANDS[ALIASES[name]] ? ALIASES[name] : name);
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function suggestions(name) {
    const n = String(name || "").toLowerCase();
    return Object.keys(COMMANDS).map((c) => [c, distance(n, c)]).filter(([c, d]) => d <= Math.max(1, Math.floor(c.length / 3)) || (n.length >= 3 && c.startsWith(n))).sort((a, b) => a[1] - b[1]).map(([c]) => c).slice(0, 3);
  }
  function notFound(name) {
    const near = suggestions(name);
    return `There's no "${name}".${near.length ? ` Did you mean ${near.join(" or ")}?` : ""} Type help for the list.`;
  }
  // Finishing a word (Tab, or a tap on one of the suggestions)
  function completions(line) {
    let words;
    try { words = tokenize(line); } catch { return []; }
    if (/\s$/.test(line)) words.push("");
    if (words.length <= 1) { const w = (words[0] || "").toLowerCase(); return Object.keys(COMMANDS).filter((c) => c.startsWith(w)); }
    const cmd = COMMANDS[resolveName(words[0].toLowerCase())];
    if (!cmd || !cmd.subs || words.length > 2) return [];
    const w = words[1].toLowerCase();
    return cmd.subs.filter((s) => s.startsWith(w));
  }
  async function run(ctx, line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;
    const parsed = parse(trimmed);
    const name = resolveName(parsed.name);
    const cmd = COMMANDS[name];
    if (!cmd) throw new Error(notFound(parsed.name));
    await cmd.run.call(cmd, ctx, parsed.args, parsed.flags);
  }

  // ===================== The screen (kept between visits: what was typed and answered, the terminals) =====================
  let root = null, started = null, state = { terminals: false, why: "" }, me = { id: "", name: "you", role: "staff", online: true };
  const $ = (sel) => root.querySelector(sel);
  const clampFont = (n) => Math.min(26, Math.max(12, Number(n) || 16));
  let fontSize = clampFont(store.get(FONT_KEY, 16));
  const history = (store.get(HISTORY_KEY, []) || []).filter((l) => typeof l === "string").slice(-200);
  let hIndex = history.length, busy = false, asking = null, ctrl = false, entry = null;
  const terms = []; // { id, token, kind, title, host, cap, term, es, connects, ended, sendQ, sending }
  let current = null; // null: the Nova tab; else one of terms
  const page = () => document.getElementById("page");
  const onConsole = () => /^#console(\/|$)/.test(location.hash);

  function build() {
    root = document.createElement("div");
    root.className = "console-root";
    const KEYS = [["tab", "Tab", "Tab"], ["ctrl", "Ctrl", "Ctrl, then a letter"], ["esc", "Esc", "Escape"], ["left", "←", "Left"], ["up", "↑", "Up: what you typed before"], ["down", "↓", "Down"], ["right", "→", "Right"], ["|", "|", "A bar"], ["~", "~", "A tilde"], ["/", "/", "A slash"], ["font-down", "A−", "Smaller text"], ["font-up", "A+", "Bigger text"]];
    root.innerHTML = `
      <div class="console-tabs" role="tablist" aria-label="Open consoles" hidden></div>
      <section class="console-nova">
        <div class="console-quick" role="group" aria-label="Quick commands">
          <div class="seg console-groups">${QUICK.map(([t], i) => `<label><input type="radio" name="console-group" value="${i}">${esc(t)}</label>`).join("")}</div>
          <div class="console-chips"></div>
        </div>
        <div class="console-log" role="log" aria-label="What you typed, and the answers"></div>
      </section>
      <section class="console-terms"></section>
      <div class="console-dock">
        <div class="console-sugg" aria-label="Finish the word" hidden></div>
        <form class="console-line" autocomplete="off">
          <label class="console-ask" for="console-input" hidden></label>
          <label class="sr console-label" for="console-input">A command</label>
          <div class="console-row">
            <input class="input console-input" id="console-input" name="line" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Type a command">
            <button type="button" class="btn quiet console-cancel" hidden>Cancel</button>
            <button class="btn main console-run" type="submit" aria-label="Run">${icon("send")}</button>
          </div>
        </form>
        <div class="console-keys" role="group" aria-label="Extra keys">${KEYS.map(([k, t, l]) => `<button type="button" data-key="${esc(k)}" aria-label="${esc(l)}"${k === "ctrl" ? ' aria-pressed="false"' : ""}>${esc(t)}</button>`).join("")}</div>
      </div>`;
    applyFont();
    // Quick commands: Desk's four groups, one at a time (the last one picked, remembered)
    const groups = $(".console-groups");
    const pickGroup = (i) => {
      i = Math.min(QUICK.length - 1, Math.max(0, Number(i) || 0));
      groups.querySelectorAll("input")[i].checked = true;
      $(".console-chips").innerHTML = QUICK[i][1].map(([label, cmd]) => {
        const what = COMMANDS[resolveName(cmd.trim().split(" ")[0])]?.help;
        return `<button type="button" class="chip" data-quick="${esc(cmd)}" aria-label="${esc(`${label}: ${what || cmd.trim()}`)}">${esc(label)}</button>`;
      }).join("");
    };
    let g0 = 0;
    try { g0 = Number(localStorage.getItem(GROUP_KEY)) || 0; } catch {}
    pickGroup(g0);
    groups.addEventListener("change", (e) => { pickGroup(e.target.value); try { localStorage.setItem(GROUP_KEY, e.target.value); } catch {} });
    root.addEventListener("click", onClick);
    // (the extra keys keep the keyboard where it is: a tap on one doesn't take the focus from the line)
    // (and Run and Cancel, so the line keeps the keyboard and its keys while you go on typing)
    const keep = (e) => { if (e.target.closest(".console-keys button, .console-sugg button, .console-run, .console-cancel") && document.activeElement && root.contains(document.activeElement)) e.preventDefault(); };
    root.addEventListener("pointerdown", keep);
    root.addEventListener("mousedown", keep);
    const form = $(".console-line"), input = $(".console-input");
    form.addEventListener("submit", (e) => { e.preventDefault(); submit(input.value); });
    input.addEventListener("keydown", onLineKey);
    input.addEventListener("beforeinput", (e) => {
      // Ctrl from the extra keys, then a letter: that letter's Ctrl key
      if (ctrl && e.inputType === "insertText" && /^[a-z]$/i.test(e.data || "")) { e.preventDefault(); setCtrl(false); ctrlKey(e.data.toLowerCase()); }
    });
    input.addEventListener("input", () => suggest());
  }
  function applyFont() {
    root.style.setProperty("--console-size", `${fontSize}px`);
    root.style.setProperty("--console-lh", `${Math.round(fontSize * 1.3)}px`);
  }
  function setFont(n) {
    fontSize = clampFont(n);
    store.set(FONT_KEY, fontSize);
    applyFont();
    for (const t of terms) t.fitted = "";
    fitSoon();
  }

  // ---- Writing answers: each command and what it answered, together ----
  function newEntry(html) {
    entry = document.createElement("div");
    entry.className = "console-entry";
    entry.innerHTML = html || "";
    const log = $(".console-log");
    log.append(entry);
    // (the last 80 commands are kept on screen)
    while (log.childElementCount > 80) log.firstElementChild.remove();
    toBottom();
    return entry;
  }
  function add(html) {
    (entry && entry.parentNode ? entry : newEntry("")).insertAdjacentHTML("beforeend", html);
    toBottom();
  }
  let bottomFrame = 0;
  function toBottom() {
    if (bottomFrame) return;
    bottomFrame = requestAnimationFrame(() => { bottomFrame = 0; const p = page(); if (p && root.isConnected && !current) p.scrollTop = p.scrollHeight; });
  }
  const say = (text, cls = "") => add(`<p class="console-p${cls ? ` ${cls}` : ""}">${esc(text)}</p>`);
  const label = (k) => esc(String(k).replace(/^./, (c) => c.toUpperCase()));
  const out = {
    print: (t) => say(t),
    ok: (t) => say(`✓ ${t}`, "ok"),
    warn: (t) => say(t, "warn"),
    error: (t) => say(`✗ ${t}`, "bad"),
    dim: (t) => say(t, "muted"),
    heading: (t) => add(`<h3 class="console-h">${esc(t)}</h3>`),
    lines: (list) => add(`<pre class="console-pre">${list.map(esc).join("\n")}</pre>`),
    // Two columns: what it is, and its value
    kv(rows) {
      const shown = rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== "");
      if (!shown.length) return say("(nothing)", "muted");
      add(`<dl class="console-kv">${shown.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`);
    },
    // A table; on a narrow screen each row stacks, every value under its column's name
    table(rows, cols, colours = {}) {
      if (!rows.length) return say("(nothing)", "muted");
      add(`<div class="console-table"><table><thead><tr>${cols.map((c) => `<th scope="col">${label(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td data-k="${label(c)}" class="console-c-${esc(c)}${colours[c] ? ` ${esc(colours[c])}` : ""}">${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    },
    // help: each group under its heading; a tap on a command or its example puts it on the line
    help(groups) {
      add(groups.filter((g) => g.rows.length).map((g) => `<h3 class="console-h">${esc(g.title)}</h3><ul class="console-help">${g.rows.map((r) => `<li><button type="button" class="console-name" data-type="${esc(r.name)} ">${esc(r.name)}</button>${r.example && r.example !== r.name ? `<button type="button" class="console-ex" data-type="${esc(r.example)}">${esc(r.example)}</button>` : ""}<span>${esc(r.what)}</span></li>`).join("")}</ul>`).join(""));
    },
    // logs: the time, the part, the message (errors in the warning colour)
    log(lines) {
      add(`<ul class="console-logs">${lines.map((l) => `<li${l.bad ? ' class="warn"' : ""}><span class="console-time">${esc(l.time)}</span><b>${esc(l.part)}</b><span>${esc(l.message)}</span></li>`).join("")}</ul>`);
    },
  };
  const echo = (text) => `<button type="button" class="console-cmd" data-type="${esc(text)}" aria-label="${esc(`Type again: ${text}`)}"><span class="console-prompt">nova ›</span> ${esc(text)}</button>`;

  // What every command is handed (Desk's ctx)
  const ctx = {
    get me() { return me; },
    api,
    ...out,
    clear: () => { $(".console-log").replaceChildren(); entry = null; },
    history: () => history.slice(),
    ask: (question) => new Promise((resolve) => { asking = { resolve, question }; paintLine(); setLine(""); focusLine(); }),
    open: (to) => { location.hash = `#${to}`; },
    terminal: (kind) => openTerminal(kind),
    get look() { return lookNow(); },
    // (the same music as Settings → Music and Nova Desk: /shared/ambient.js, loaded the first time it's asked for)
    get music() { return musicNow(); },
  };
  const amb = () => (window.NovaAmbient && typeof window.NovaAmbient.seed === "function" ? window.NovaAmbient : null);
  async function musicNow() {
    if (amb()) return amb();
    if (typeof N.script !== "function" || typeof N.asset !== "function") return null;
    return N.script(N.asset("/shared/ambient.js")).then(amb, () => null);
  }
  // Nova Phone's look: the shell's (NovaPhone.look: Nova Desk's themes, for both apps), or the themes More shows
  async function lookNow() {
    const L = N.look || window.NovaPhoneLook;
    if (L && typeof L.list === "function" && typeof L.set === "function") {
      const all = await L.list();
      return { themes: all.map((t) => ({ id: t.id, name: t.name })), setTheme: (id) => L.set(id), own: false };
    }
    const T = window.NovaThemes;
    if (T && Array.isArray(T.list)) return { themes: T.list.map((t) => ({ id: t.id, name: t.name })), setTheme: (id) => T.set(id), own: false };
    return null;
  }

  // ---- The line ----
  const input = () => $(".console-input");
  function setLine(v) { const i = input(); i.value = v; i.setSelectionRange(v.length, v.length); suggest(); }
  function focusLine() { if (!current) input().focus({ preventScroll: true }); }
  function paintLine() {
    const ask = $(".console-ask");
    ask.hidden = !asking;
    ask.textContent = asking ? asking.question.trim() : "";
    $(".console-label").hidden = !!asking;
    $(".console-cancel").hidden = !asking;
    input().placeholder = asking ? "" : "Type a command";
    $(".console-run").classList.toggle("console-busy", busy && !asking);
    $(".console-run").setAttribute("aria-label", asking ? "Answer" : busy ? "Working…" : "Run");
  }
  async function submit(text) {
    if (asking) {
      const a = asking;
      asking = null;
      add(`<p class="console-cmd console-answer"><span class="warn">${esc(a.question.trim())}</span> ${esc(text)}</p>`);
      setLine("");
      paintLine();
      return a.resolve(text);
    }
    if (!text.trim()) return;
    if (busy) return toast("Still working on the last one: it'll answer in a moment.");
    setLine("");
    newEntry(echo(text));
    if (history[history.length - 1] !== text) history.push(text);
    while (history.length > 200) history.shift();
    store.set(HISTORY_KEY, history);
    hIndex = history.length;
    busy = true;
    paintLine();
    try { await run(ctx, text); } catch (err) { out.error(err.message || String(err)); }
    busy = false;
    paintLine();
  }
  function cancel() {
    if (asking) {
      const a = asking;
      asking = null;
      add(`<p class="console-cmd console-answer"><span class="warn">${esc(a.question.trim())}</span> ${esc(input().value)}<span class="muted">^C</span></p>`);
      setLine("");
      paintLine();
      return a.resolve("");
    }
    if (busy) return say("^C (it carries on in the background)", "muted");
    if (input().value) { add(`<p class="console-cmd console-answer"><span class="console-prompt">nova ›</span> ${esc(input().value)}<span class="muted">^C</span></p>`); setLine(""); }
  }
  function moveCaret(by) {
    const i = input();
    const at = Math.max(0, Math.min(i.value.length, (by < 0 ? i.selectionStart : i.selectionEnd) + by));
    i.setSelectionRange(at, at);
  }
  function insert(text) {
    const i = input();
    i.setRangeText(text, i.selectionStart ?? i.value.length, i.selectionEnd ?? i.value.length, "end");
    suggest();
  }
  function recall(step) {
    if (asking || !history.length) return;
    hIndex = Math.max(0, Math.min(history.length, hIndex + step));
    setLine(history[hIndex] || "");
  }
  function complete() {
    if (asking) return;
    const i = input();
    const before = i.value.slice(0, i.selectionStart ?? i.value.length);
    const options = completions(before);
    if (!options.length) return;
    const partial = /\s$/.test(before) ? "" : before.split(/\s+/).pop();
    if (options.length === 1) return insert(options[0].slice(partial.length) + " ");
    let common = options[0];
    for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1);
    if (common.length > partial.length) return insert(common.slice(partial.length));
    suggest(true);
  }
  // As you type: the commands (or parts) it could be, a tap away
  function suggest(all = false) {
    const box = $(".console-sugg");
    const i = input();
    const before = i.value.slice(0, i.selectionStart ?? i.value.length);
    const partial = /\s$/.test(before) ? "" : before.split(/\s+/).pop();
    const options = asking || (!before.trim() && !all) ? [] : completions(before).filter((o) => o !== partial.toLowerCase());
    const shown = options.slice(0, all ? 8 : 6);
    box.hidden = !shown.length;
    box.innerHTML = shown.map((o) => `<button type="button" class="chip" data-finish="${esc(o.slice(partial.length))}">${esc(o)}</button>`).join("");
  }
  function ctrlKey(letter) {
    if (letter === "c") return cancel();
    if (letter === "u") return setLine("");
    if (letter === "l") return ctx.clear();
    if (letter === "a") return input().setSelectionRange(0, 0);
    if (letter === "e") { const n = input().value.length; return input().setSelectionRange(n, n); }
  }
  function onLineKey(e) {
    if (e.isComposing) return;
    if (e.key === "ArrowUp") { e.preventDefault(); recall(-1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); recall(1); }
    else if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); complete(); }
    else if (e.key === "Escape") { e.preventDefault(); asking ? cancel() : setLine(""); }
    else if (e.ctrlKey && !e.altKey && !e.metaKey && /^[cul]$/i.test(e.key) && !(e.key.toLowerCase() === "c" && input().selectionStart !== input().selectionEnd)) { e.preventDefault(); ctrlKey(e.key.toLowerCase()); }
  }
  function setCtrl(on) {
    ctrl = on;
    root.querySelector('[data-key="ctrl"]').setAttribute("aria-pressed", String(on));
  }

  // ---- Taps: quick commands, the extra keys, tabs, suggestions, anything that types for you ----
  function onClick(e) {
    const b = e.target.closest("button, a");
    if (!b || !root.contains(b)) return;
    if (b.dataset.quick != null) {
      const cmd = b.dataset.quick;
      showTab(null);
      // (anything half-typed is cleared first; a command ending in a space waits for the rest)
      const go = () => { if (cmd.endsWith(" ")) { setLine(cmd); focusLine(); } else { setLine(""); submit(cmd); } };
      // (a question waiting is answered "no" first, and its command allowed to finish)
      if (asking) { cancel(); setTimeout(go, 0); } else go();
      return;
    }
    if (b.dataset.type != null) { if (asking) return; setLine(b.dataset.type); focusLine(); return; }
    if (b.dataset.finish != null) { insert(`${b.dataset.finish} `); focusLine(); return; }
    if (b.classList.contains("console-cancel")) return cancel();
    if (b.dataset.key) return key(b.dataset.key);
    if (b.dataset.tab != null) return showTab(terms.find((t) => t.id === b.dataset.tab) || null);
    if (b.dataset.close) { const t = terms.find((x) => x.id === b.dataset.close); if (t) closeTerm(t); return; }
    if (b.dataset.newTerm) {
      openTerminal(b.dataset.newTerm).catch((err) => { showTab(null); newEntry(""); out.error(err.message); });
      return;
    }
    if (b.dataset.copy != null) {
      const text = b.dataset.copy;
      (navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Copied"), () => toast("Couldn't copy here: press and hold the command to copy it.", true));
    }
  }
  const TERM_KEYS = { tab: "\t", esc: "\x1b", left: "D", right: "C", up: "A", down: "B" };
  function key(k) {
    if (k === "font-down") return setFont(fontSize - 1);
    if (k === "font-up") return setFont(fontSize + 1);
    if (k === "ctrl") {
      setCtrl(!ctrl);
      return current ? current.cap.focus({ preventScroll: true }) : focusLine();
    }
    if (current) {
      const t = current;
      const arrow = /^[ABCD]$/.test(TERM_KEYS[k] || "") ? `\x1b${t.term?.modes.appCursor ? "O" : "["}${TERM_KEYS[k]}` : null;
      send(t, arrow || TERM_KEYS[k] || k);
      return;
    }
    // The Nova tab: Tab finishes, the arrows move and go back through what you typed, | ~ / are typed
    if (k === "tab") return complete();
    if (k === "esc") return asking ? cancel() : setLine("");
    if (k === "up") return recall(-1);
    if (k === "down") return recall(1);
    if (k === "left") return moveCaret(-1);
    if (k === "right") return moveCaret(1);
    insert(k);
  }

  // ---- Tabs: Nova and the terminals ----
  function paintTabs() {
    const bar = $(".console-tabs");
    const can = state.terminals;
    bar.hidden = !can && !terms.length;
    if (bar.hidden) return;
    bar.innerHTML = `<button type="button" class="chip" role="tab" data-tab="" aria-selected="${!current}">Nova</button>${terms.map((t) => `<span class="console-tab${t.ended ? " ended" : ""}" role="presentation"><button type="button" class="chip" role="tab" data-tab="${esc(t.id)}" aria-selected="${current === t}">${esc(t.title)}</button><button type="button" class="console-x" data-close="${esc(t.id)}" aria-label="${esc(`Close ${t.title}`)}">×</button></span>`).join("")}${can ? `<button type="button" class="chip" data-new-term="shell" aria-label="A terminal on ${esc(state.where === "server" ? "the server" : "the studio computer")}">+ Shell</button><button type="button" class="chip" data-new-term="vps" aria-label="The VPSdime server">+ VPS</button>` : ""}`;
  }
  function showTab(t) {
    current = t;
    $(".console-nova").hidden = !!t;
    $(".console-line").hidden = !!t;
    $(".console-sugg").hidden = true;
    for (const x of terms) { x.host.hidden = x !== t; x.term?.focus(false); }
    root.classList.toggle("console-on-term", !!t);
    paintTabs();
    if (t) { fitSoon(); requestAnimationFrame(() => { const p = page(); if (p) p.scrollTop = p.scrollHeight; }); }
    else { suggest(); toBottom(); }
  }

  // ---- Terminals (shell / vps / vps-key): where Nova Agent allows them ----
  let termLib = null;
  const loadTerm = () => (termLib ||= new Promise((resolve, reject) => {
    if (window.NovaTerm) return resolve(window.NovaTerm);
    const s = Object.assign(document.createElement("script"), { src: "lib/term.js" });
    s.onload = () => resolve(window.NovaTerm);
    s.onerror = () => { termLib = null; s.remove(); reject(new Error("The terminal didn't load. Check the connection and try again.")); };
    document.head.append(s);
  }));
  // A letter's size in the terminal's type, and how many fit
  function cellSize(host) {
    const m = document.createElement("span");
    m.className = "ct ct-measure";
    m.textContent = "M".repeat(40);
    host.append(m);
    const r = m.getBoundingClientRect();
    m.remove();
    return { w: r.width / 40 || fontSize * 0.6, h: Math.round(fontSize * 1.3) };
  }
  function sizeFor(host) {
    const p = page();
    const { w, h } = cellSize(host);
    const width = (host.clientWidth || root.clientWidth || 320) - 20;
    const dock = $(".console-dock").offsetHeight || 120;
    const bar = $(".console-tabs").offsetHeight || 0;
    const height = (p ? p.clientHeight : innerHeight) - dock - bar - 48;
    return { cols: Math.max(20, Math.floor(width / w)), rows: Math.max(8, Math.min(80, Math.floor(height / h))) };
  }
  async function openTerminal(kind, existing) {
    if (!state.terminals) throw new Error(state.why || "Terminals can't open here.");
    const [NovaTerm] = await Promise.all([loadTerm(), N.css("console.css")]);
    const host = document.createElement("div");
    host.className = "console-term";
    host.innerHTML = `<p class="console-hint muted">Tap the screen to type. Long-press to copy.</p><div class="console-screen"></div><textarea class="console-cap" aria-label="Type into the terminal" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" rows="1"></textarea>`;
    $(".console-terms").append(host);
    const size = sizeFor($(".console-terms"));
    let info = existing;
    if (!info) {
      try { info = await api("/console-api/term", { method: "POST", body: { kind, ...size } }); } catch (err) { host.remove(); throw err; }
    }
    const t = { id: info.id, token: info.token, kind, title: info.title || kind, host, cap: host.querySelector(".console-cap"), es: null, connects: 0, ended: false, sendQ: "", sending: Promise.resolve(), fitted: "" };
    t.term = NovaTerm(host.querySelector(".console-screen"), { ...size, reply: (d) => send(t, d) });
    t.fitted = `${size.cols}x${size.rows}`;
    wireTerm(t);
    terms.push(t);
    if (!existing) session.set([...session.get(), { id: info.id, token: info.token, title: info.title, kind }]);
    showTab(t);
    connect(t);
    if (existing) resize(t, true);
    return t;
  }
  const forget = (id) => session.set(session.get().filter((t) => t.id !== id));
  function connect(t) {
    if (t.es || t.ended || document.hidden || !onConsole()) return;
    const es = new EventSource(`/console-api/term/${encodeURIComponent(t.id)}/stream?token=${encodeURIComponent(t.token)}`);
    t.es = es;
    // (each new stream starts again with what was printed so far)
    es.addEventListener("open", () => { if (t.connects++ > 0) t.term.reset(); });
    es.addEventListener("out", (e) => { try { t.term.write(JSON.parse(e.data)); } catch {} });
    es.addEventListener("exit", () => ended(t, "it has ended: close this tab, or open a new one"));
    es.addEventListener("error", () => { if (es.readyState === EventSource.CLOSED && t.es === es) ended(t, "the connection to it closed: close this tab, or open a new one"); });
  }
  function disconnect(t) { if (t.es) { t.es.close(); t.es = null; } }
  function ended(t, why) {
    if (t.ended) return;
    t.ended = true;
    disconnect(t);
    forget(t.id);
    t.term.write(`\r\n\x1b[2m[${why}]\x1b[0m\r\n`);
    paintTabs();
  }
  function send(t, data) {
    if (t.ended || !data) return;
    if (ctrl && data.length === 1 && /[a-z@[\\\]^_]/i.test(data)) { setCtrl(false); data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31); }
    t.sendQ += data;
    t.sending = t.sending.then(async () => {
      if (!t.sendQ) return;
      const chunk = t.sendQ;
      t.sendQ = "";
      try { await api(`/console-api/term/${encodeURIComponent(t.id)}/input`, { method: "POST", body: { data: chunk }, headers: { "X-Console-Token": t.token } }); } catch (err) { t.term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`); }
    });
  }
  let resizeTimer = 0;
  function resize(t, force = false) {
    if (!t || t.ended || t.host.hidden || !root.isConnected) return;
    const s = sizeFor($(".console-terms"));
    const key = `${s.cols}x${s.rows}`;
    if (!force && key === t.fitted) return;
    t.fitted = key;
    t.term.resize(s.cols, s.rows);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => api(`/console-api/term/${encodeURIComponent(t.id)}/resize`, { method: "POST", body: { cols: s.cols, rows: s.rows }, headers: { "X-Console-Token": t.token } }).catch(() => {}), 120);
  }
  const fitSoon = () => requestAnimationFrame(() => resize(current));
  function closeTerm(t) {
    disconnect(t);
    forget(t.id);
    if (!t.ended) api(`/console-api/term/${encodeURIComponent(t.id)}/close`, { method: "POST", body: {}, headers: { "X-Console-Token": t.token } }).catch(() => {});
    t.term.dispose();
    t.host.remove();
    terms.splice(terms.indexOf(t), 1);
    showTab(current === t ? null : current);
  }
  // The phone's keyboard into a terminal: keys as a terminal sends them, words as they're finished
  function wireTerm(t) {
    const cap = t.cap;
    t.host.querySelector(".console-screen").addEventListener("click", () => { if (getSelection()?.isCollapsed !== false) cap.focus({ preventScroll: true }); });
    cap.addEventListener("focus", () => t.term.focus(true));
    cap.addEventListener("blur", () => t.term.focus(false));
    cap.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      const app = t.term.modes.appCursor;
      const k = { Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b", Delete: "\x1b[3~", Home: "\x1b[H", End: "\x1b[F", PageUp: "\x1b[5~", PageDown: "\x1b[6~", ArrowUp: `\x1b${app ? "O" : "["}A`, ArrowDown: `\x1b${app ? "O" : "["}B`, ArrowRight: `\x1b${app ? "O" : "["}C`, ArrowLeft: `\x1b${app ? "O" : "["}D` }[e.key];
      let data = k;
      if (!data && e.ctrlKey && !e.metaKey && e.key.length === 1 && /[a-z@[\\\]^_ ]/i.test(e.key)) data = String.fromCharCode(e.key.toUpperCase().charCodeAt(0) & 31);
      else if (!data && e.altKey && !e.metaKey && e.key.length === 1) data = `\x1b${e.key}`;
      if (data) { e.preventDefault(); send(t, data); }
    });
    cap.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertCompositionText") return; // (a word being written: sent when it's finished)
      e.preventDefault();
      const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
      if (e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") send(t, "\r");
      else if (e.inputType === "deleteContentBackward" || e.inputType === "deleteWordBackward") send(t, "\x7f");
      else if (e.inputType === "deleteContentForward") send(t, "\x1b[3~");
      else if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") { const p = text.replace(/\r?\n/g, "\r"); send(t, t.term.modes.bracketedPaste ? `\x1b[200~${p}\x1b[201~` : p); }
      else if (text) send(t, text);
    });
    cap.addEventListener("compositionend", (e) => { if (e.data) send(t, e.data); cap.value = ""; });
    cap.addEventListener("input", (e) => { if (!e.isComposing) cap.value = ""; });
  }

  // ---- Away, and back: streams stop while you're elsewhere or the phone is locked ----
  const sleepAll = () => terms.forEach(disconnect);
  const wakeAll = () => { if (onConsole() && !document.hidden) terms.forEach(connect); };
  addEventListener("hashchange", () => (onConsole() ? wakeAll() : sleepAll()));
  document.addEventListener("visibilitychange", () => (document.hidden ? sleepAll() : wakeAll()));
  let winTimer = 0;
  addEventListener("resize", () => { if (!current || !onConsole()) return; clearTimeout(winTimer); winTimer = setTimeout(() => resize(current), 150); });

  // ---- Start: who you are, whether terminals open here, the welcome ----
  async function start() {
    try {
      state = await api("/console-api/state");
      me = state.me || me;
    } catch (err) {
      // (Nova Agent off or out of reach: Nova Bot still knows who you are, and most commands still work)
      state = { terminals: false, why: err.message };
      const m = await N.api("/auth/me").catch((e) => { if (e.signIn) throw e; return null; });
      if (m?.staff) me = { id: m.staff.id, name: m.staff.display_name || m.staff.name || "you", role: m.staff.role || "staff", online: true };
      else if (err.signIn) throw Object.assign(new Error("Sign in first"), { signIn: true });
    }
    newEntry("");
    out.heading("Console");
    out.print("Everything in Nova Agent, typed.");
    out.dim(`Signed in as ${me.name} (${me.role})${me.online ? " · online" : " · on the studio computer"}`);
    out.dim("Type help · or tap a command above · try: today · quests · enquiries · computer");
    if (!state.terminals && state.why) {
      const server = state.where === "server";
      // (Desk links to its own Console on the computer; Nova Phone's own address there, once Nova Agent gives it)
      add(`<div class="console-note"><p class="console-p">Terminals: ${esc(state.why)}</p>${state.phoneUrl ? `<a class="btn" href="${esc(state.phoneUrl)}" target="_blank" rel="noopener">${server ? "Open Console on the server" : "Open Console on this computer"}</a>` : ""}${server && state.tunnel ? `<p class="console-p muted">First, in a terminal on your computer:</p><div class="console-copy"><code>${esc(state.tunnel)}</code>${navigator.clipboard?.writeText ? `<button type="button" class="btn" data-copy="${esc(state.tunnel)}">Copy</button>` : ""}</div>` : ""}</div>`);
    }
    entry = null;
    paintLine();
    paintTabs();
    // This browser tab's terminals from before (when Nova Agent still has them open)
    const still = new Set((state.open || []).map((t) => t.id));
    const before = session.get();
    if (before.length) setTimeout(async () => {
      for (const t of before) {
        if (still.has(t.id)) await openTerminal(t.kind, t).catch(() => forget(t.id));
        else forget(t.id);
      }
      if (terms.length) showTab(null);
    }, 0);
  }

  N.section({
    id: "console", name: "Console", tile: "console",
    async draw(box) {
      await N.css("console.css");
      if (!root) build();
      if (!started) started = start().catch((err) => { started = null; throw err; });
      await started;
      box.append(root);
      setTimeout(() => { if (!root.isConnected) return; wakeAll(); if (current) resize(current); }, 0);
    },
    bottom: () => true,
  });
  // (for checks: type a line as if typed)
  window.NovaConsole = { type: (text) => submit(text), terms, openTerminal };
})();
