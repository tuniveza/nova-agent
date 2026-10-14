// Console's Nova commands: one plain command language for the whole of Nova Agent.
//
// Every command calls the same addresses the panels use, as the person signed in, so it can do
// exactly what they could do with the mouse, no more. Nothing here sends, posts, approves or books
// by itself: `approve` (admins) shows exactly what would go, then asks for the item's number to
// be typed back before it does anything. Console is a page a person types into; Agent has no way
// to use it.
//
// This file has no page or network of its own: console.js hands each command a `ctx`:
//   ctx.api(path, { method, body })  → JSON (throws Error with .status and the server's message)
//   ctx.print(text) / ctx.table(rows, columns) / ctx.ok(text) / ctx.warn(text) / ctx.dim(text)
//   ctx.heading(text)  ctx.kv(rows: [label, value][])   (a title, and two lined-up columns)
//   ctx.help(groups)   (help's grouped list: [{ title, rows: [{ name, args, what, example }] }])
//   ctx.ask(question) → Promise<string>   (one line typed by the person)
//   ctx.open(path)                        (opens a panel in Nova Agent)
//   ctx.terminal(kind)                    (opens a shell / vps / vps-key tab; the PC refuses where it must)
//   ctx.me  { id, name, role, online }    ctx.look / ctx.music  (Nova Agent's look and music, if here)
//   ctx.clear() / ctx.history()

// ---- Reading a line: words, "quoted words", 'single quotes', and --flag value ----
export function tokenize(line) {
  const out = [];
  let cur = "";
  let quote = "";
  let had = false;
  for (const ch of String(line)) {
    if (quote) {
      if (ch === quote) quote = "";
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      had = true;
    } else if (/\s/.test(ch)) {
      if (cur || had) out.push(cur);
      cur = "";
      had = false;
    } else cur += ch;
  }
  if (quote) throw new Error("A quote isn't closed.");
  if (cur || had) out.push(cur);
  return out;
}

export function parse(line) {
  const words = tokenize(line);
  const args = [];
  const flags = {};
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^--[a-z][\w-]*$/i.test(w)) {
      const next = words[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[w.slice(2)] = next;
        i++;
      } else flags[w.slice(2)] = true;
    } else args.push(w);
  }
  return { name: (args.shift() || "").toLowerCase(), args, flags };
}

// ---- Small helpers ----
const UK = { timeZone: "Europe/London" };
export const ukTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { ...UK, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const ukDay = (d) => d.toLocaleDateString("en-CA", UK); // YYYY-MM-DD in London
const short = (id) => String(id || "").slice(0, 8);
const need = (v, what) => {
  if (!v) throw new Error(`Say which ${what}.`);
  return v;
};
const adminOnly = (ctx) => {
  if (ctx.me?.role !== "admin") throw new Error("That's for admins.");
};
// The first list in an answer (Portal's addresses answer with { enquiries: [...] } and the like)
export function firstList(data) {
  if (Array.isArray(data)) return data;
  for (const v of Object.values(data || {})) if (Array.isArray(v)) return v;
  return [];
}
// A short line for any item: its title or subject or name, its state and when
export function summary(x) {
  const title = x.title || x.subject || x.name || x.caption || x.summary || x.toName || x.number || x.preview || x.lastMessage || x.firstMessage || x.question || x.message || x.text || x.description || x.id;
  return {
    id: x.id ?? "",
    title: String(title ?? "").replace(/\s+/g, " ").slice(0, 70),
    state: String(x.status || x.state || x.mark || (x.done ? "done" : "") || "").replace(/_/g, " "),
    when: ukTime(x.updatedAt || x.updated_at || x.lastAt || x.last_at || x.createdAt || x.created_at || x.start || x.when || x.at || ""),
  };
}

// Find a quest/mission by its id or the start of it (8 characters is enough)
export function pick(list, key, what) {
  const k = String(need(key, what)).toLowerCase();
  const hits = list.filter((x) => String(x.id).toLowerCase() === k || String(x.id).toLowerCase().startsWith(k));
  if (!hits.length) throw new Error(`No ${what} starts with "${key}". List them first.`);
  if (hits.length > 1) throw new Error(`More than one ${what} starts with "${key}": type a little more of it.`);
  return hits[0];
}

// ---- What can be approved, and where (an admin, with the item's number typed back) ----
export const APPROVABLE = {
  campaign: { list: "campaigns", one: (id) => `campaigns/${id}`, act: (id, a) => `campaigns/${id}/${a}` },
  outreach: { list: "outreach", one: (id) => `outreach/${id}`, act: (id, a) => `outreach/${id}/${a}` },
  social: { list: "social", one: (id) => `social/${id}`, act: (id, a) => `social/${id}/${a}` },
  invoice: { list: "money", one: (id) => `money/invoices/${id}`, act: (id, a) => `money/invoices/${id}/${a}` },
  reminder: { list: "money", one: null, act: (id, a) => `money/reminders/${id}/${a}` },
  booking: { list: "booking-actions", one: null, act: (id, a) => `booking-actions/${id}/${a}` },
};

// Portal's sections (Nova Bot's /app/api/…)
export const PORTAL = {
  enquiries: "enquiries",
  chats: "conversations",
  conversations: "conversations",
  clients: "clients",
  money: "money",
  campaigns: "campaigns",
  outreach: "outreach",
  social: "social",
  approvals: "booking-actions",
  tests: "tidy",
  alerts: "notifications",
};

export const APPS = { portal: "/portal/", calendar: "/calendar/", notes: "/notes/", board: "/board/", index: "/app/memory/", lossless: "/lossless/", visualizer: "/visualizer", observatory: "/observatory/", fixer: "/fixer/", console: "/console/", agent: "pane:chat", quests: "pane:quests", missions: "pane:missions", manual: "manual" };

const P = (path) => "/app/api/" + path;

// ---- The commands ----
// Each: { help, usage, subs?, run(ctx, args, flags) }
export const COMMANDS = {
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
      ctx.help(
        GROUPS.map(([title, names]) => ({
          title,
          rows: names.filter((n) => COMMANDS[n]).map((n) => ({ name: n, args: argsOf(COMMANDS[n].usage, n), what: COMMANDS[n].help, example: EXAMPLES[n] || "" })),
        }))
      );
      ctx.dim("Tab finishes a word · ↑ ↓ go back through what you typed · help <command> for more · tap a command above to run it");
    },
  },
  clear: { help: "Clear the screen", usage: "clear", async run(ctx) { ctx.clear(); } },
  history: { help: "What you've typed", usage: "history", async run(ctx) { ctx.history().forEach((l, i) => ctx.print(`${String(i + 1).padStart(3)}  ${l}`)); } },
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
      if (sub === "list") {
        const s = await ctx.api("/quests/state");
        const open = (s.quests || []).filter((q) => flags.all || q.status === "todo" || q.status === "doing");
        if (!open.length) return ctx.dim("Nothing to do. Add one: quests add \"Mix the EP\"");
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

  missions: {
    help: "Your missions: list, new, show",
    usage: 'missions [list | new "<what you want done>" [--deadline YYYY-MM-DD] | show <id>]',
    subs: ["list", "new", "show"],
    async run(ctx, [sub = "list", key], flags) {
      const s = await ctx.api("/quests/state");
      if (sub === "list") {
        if (!(s.missions || []).length) return ctx.dim('No missions. Start one: missions new "Release the EP by December"');
        return ctx.table(s.missions.map((m) => ({ id: short(m.id), title: m.title, progress: m.progress?.percent != null ? `${m.progress.percent}%` : "", state: m.status || "" })), ["id", "title", "progress", "state"]);
      }
      if (sub === "new") {
        const body = { request: need(key, "mission (in quotes)") };
        if (flags.deadline) body.deadline = String(flags.deadline);
        ctx.dim("Planning it (this can take a little while)…");
        const r = await ctx.api("/actions/missions", { method: "POST", body });
        return ctx.ok(`Mission made${r.mission?.title ? `: ${r.mission.title}` : ""}`);
      }
      if (sub === "show") {
        const m = pick(s.missions || [], key, "mission");
        ctx.print(m.title);
        const qs = (s.quests || []).filter((q) => q.missionId === m.id);
        return ctx.table(qs.map((q) => ({ id: short(q.id), title: q.title, state: q.status, when: ukTime(q.start) })), ["id", "title", "state", "when"]);
      }
      throw new Error(`missions ${sub}? Try: ${this.subs.join(", ")}`);
    },
  },

  calendar: {
    help: "The calendar: today, week, or add a note",
    usage: 'calendar [today | week | add "<title>" <YYYY-MM-DD> [HH:MM]]',
    subs: ["today", "week", "add"],
    async run(ctx, [sub = "today", title, date, time]) {
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
      const list = (data.notes || []).filter((n) => {
        const day = String(n.start || "").slice(0, 10);
        return day >= from && day < to;
      }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
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
      if (sub === "new") return ctx.open("/notes/");
      if (sub === "open") return ctx.open(`/notes/?note=${encodeURIComponent(need(key, "note"))}`);
      const data = await ctx.api("/notes-api/changes?since=0").catch(() => null);
      const byId = new Map();
      for (const n of data ? firstList(data) : []) byId.set(n.id, n);
      const list = [...byId.values()].filter((n) => n.html !== "").sort((a, b) => String(b.updatedAt || b.updated_at || "").localeCompare(String(a.updatedAt || a.updated_at || "")));
      if (!list.length) return ctx.dim("No shared notes here (notes kept only in a browser stay in that browser).");
      ctx.table(list.slice(0, 40).map((n) => ({ id: short(n.id), title: n.title || "Untitled", changed: ukTime(n.updatedAt || n.updated_at || n.updated) })), ["id", "title", "changed"]);
    },
  },

  board: {
    help: "Boards: list, open",
    usage: "board [list | open]",
    subs: ["list", "open"],
    async run(ctx, [sub = "list"]) {
      if (sub === "open") return ctx.open("/board/");
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
    },
  },

  approve: {
    help: "Approve something waiting (admins; you'll be asked to confirm)",
    usage: `approve <${Object.keys(APPROVABLE).join("|")}> <number>`,
    subs: Object.keys(APPROVABLE),
    async run(ctx, [kind, id]) {
      return decide(ctx, "approve", kind, id);
    },
  },
  reject: {
    help: "Reject something waiting (admins; you'll be asked to confirm)",
    usage: `reject <${Object.keys(APPROVABLE).join("|")}> <number>`,
    subs: Object.keys(APPROVABLE),
    async run(ctx, [kind, id]) {
      return decide(ctx, "reject", kind, id);
    },
  },

  google: {
    help: "Google: status, or sync a part now",
    usage: "google [status | sync <calendar|contacts|replies|sheets|backups|inbox|tasks|docs>]",
    subs: ["status", "sync"],
    async run(ctx, [sub = "status", part]) {
      if (sub === "sync") {
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
      if (sub === "check") {
        await ctx.api("/actions/fixer/check", { method: "POST", body: {} });
        return ctx.ok("Checking now. Open the Fixer to watch: open fixer");
      }
      const s = await ctx.api("/fixer-api/state");
      if (sub === "jobs") return ctx.table((s.jobs || []).map((j) => ({ id: short(j.id), what: j.target?.title || "", state: j.status })), ["id", "what", "state"]);
      ctx.table(
        [
          { part: "Problems", state: String((s.issues || []).length) },
          { part: "Fixes", state: String((s.jobs || []).length) },
          { part: "Last check", state: ukTime(s.lastCheck?.at) },
        ],
        ["part", "state"]
      );
    },
  },

  lossless: {
    help: "Lossless audio: start (opens it), status",
    usage: "lossless [start | status]",
    subs: ["start", "status"],
    async run(ctx, [sub = "start"]) {
      if (sub === "status") {
        const s = await ctx.api("/status").catch(() => null);
        return ctx.print(s ? "Lossless audio is ready: lossless start opens it" : "Nova Agent can't be reached");
      }
      ctx.open("/lossless/");
      ctx.ok("Opened Lossless audio.");
    },
  },

  music: {
    help: "Ambient music: on, off, next, seed",
    usage: "music [on | off | next | seed [CODE]]",
    subs: ["on", "off", "next", "seed", "status"],
    async run(ctx, [sub = "seed", code]) {
      const m = ctx.music;
      if (sub === "status") sub = "seed";
      if (!m) throw new Error("Music plays in Nova Agent's own page; open Console inside Nova Agent.");
      if (sub === "on") return void (await m.start(), ctx.ok("Music on"));
      if (sub === "off") return void (m.stop(), ctx.ok("Music off"));
      if (sub === "next") return void (m.newSeed && m.newSeed(), ctx.ok(`A new variation: ${m.seed && m.seed()}`));
      if (sub === "seed") {
        if (code) {
          m.setSeed(code);
          return ctx.ok(`Playing ${code}`);
        }
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
      const look = ctx.look;
      if (!look) throw new Error("The look lives in Nova Agent's page; open Console inside Nova Agent.");
      if (name === "list") return ctx.print(look.themes.map((t) => t.name).join(" · ") + " · own");
      if (name === "own") {
        look.setTheme(null);
        return ctx.ok("Each panel's own theme");
      }
      const t = look.themes.find((x) => x.id === name.toLowerCase() || x.name.toLowerCase() === name.toLowerCase());
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
      const where = APPS[(name || "").toLowerCase()];
      if (!where) throw new Error(`open <app>: ${Object.keys(APPS).join(", ")}`);
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
      if (sub === "invite") return ctx.open("/portal/?view=crew");
      if (sub === "pages") return ctx.open("/portal/?view=manage");
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
      if (sub !== "search") throw new Error("index search <words>");
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
      for (const l of r.lines || []) {
        const line = `${new Date(l.time).toLocaleTimeString("en-GB", UK)}  ${l.part.padEnd(7)} ${l.message}`;
        if (l.level === "error") ctx.warn(line);
        else ctx.print(line);
      }
    },
  },

  shell: {
    help: "A terminal on the studio computer (admins, on that computer only)",
    usage: "shell",
    async run(ctx) {
      adminOnly(ctx);
      await ctx.terminal("shell");
    },
  },
  vps: {
    help: "The VPSdime server: connect, set its address, add this computer's key",
    usage: "vps [connect | set <address> <user> [port] | setup-key | show]",
    subs: ["connect", "set", "setup-key", "show"],
    async run(ctx, [sub = "connect", host, user, port]) {
      adminOnly(ctx);
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
      const [q, cal, enq] = await Promise.allSettled([ctx.api("/quests/state"), ctx.api("/calendar-api/data"), ctx.api(P("enquiries"))]);
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
        const list = firstList(enq.value);
        const fresh = list.filter((e) => ["new", "open"].includes(String(e.status || e.state || "")));
        rows.push(["Enquiries", `${fresh.length} new or open`]);
      }
      ctx.kv(rows);
    },
  },
  version: {
    help: "Which version of Nova Agent this is",
    usage: "version",
    async run(ctx) {
      let v = ctx.status || null;
      if (!v && typeof window !== "undefined") {
        try {
          v = window.top.NOVA_STATUS || window.NOVA_STATUS || null;
        } catch {
          v = window.NOVA_STATUS || null;
        }
      }
      const s = await ctx.api("/status").catch(() => null);
      ctx.kv([
        ["Nova Agent", v ? `v${v.version} · build ${v.build}` : "not known here"],
        ["Nova Agent", s ? (s.version || s.rev || "running") : "can't be reached"],
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
      ctx.heading("Live now");
      ctx.kv([
        ["Address", h.url || ""],
        ["Nova Agent", h.pc?.connected ? `${onServer ? "on the VPS" : "on the studio PC"}${h.pc.since ? ` · linked since ${ukTime(h.pc.since)}` : ""}` : "not linked"],
        ["Version", h.version ? `${h.version.id}${h.version.at ? ` · ${ukTime(h.version.at)}` : ""}` : ""],
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
      if (sub !== "status") throw new Error("deploy status");
      const [d, s] = await Promise.allSettled([ctx.api(P("desk")), ctx.api("/status")]);
      const desk = d.status === "fulfilled" ? d.value : null;
      ctx.kv([
        ["Nova Bot", desk?.here?.version ? `${desk.here.version.id} · ${ukTime(desk.here.version.at)}` : d.status === "rejected" ? d.reason.message : "not known"],
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
        ctx.api("/quests/state"),
        ctx.api("/calendar-api/data"),
        ctx.api("/board-api/boards"),
        ctx.api("/notes-api/changes?since=0"),
        ctx.api(P(`memory/index?q=${encodeURIComponent(q)}`)),
        ctx.api(P("enquiries")),
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
  money: { help: "Portal's money (same as portal money)", usage: "money", async run(ctx) { return COMMANDS.portal.run(ctx, ["money"], {}); } },
  campaigns: { help: "Portal's campaigns (same as portal campaigns)", usage: "campaigns", async run(ctx) { return COMMANDS.portal.run(ctx, ["campaigns"], {}); } },
  outreach: { help: "Portal's outreach (same as portal outreach)", usage: "outreach", async run(ctx) { return COMMANDS.portal.run(ctx, ["outreach"], {}); } },
  social: { help: "Portal's social (same as portal social)", usage: "social", async run(ctx) { return COMMANDS.portal.run(ctx, ["social"], {}); } },
  approvals: { help: "Portal's approvals waiting for an admin (same as portal approvals)", usage: "approvals", async run(ctx) { return COMMANDS.portal.run(ctx, ["approvals"], {}); } },
  alerts: { help: "Portal's alerts (same as portal alerts)", usage: "alerts", async run(ctx) { return COMMANDS.portal.run(ctx, ["alerts"], {}); } },
  tests: { help: "Portal's tests (same as portal tests)", usage: "tests", async run(ctx) { return COMMANDS.portal.run(ctx, ["tests"], {}); } },
};

// approve/reject: shows exactly what it is, then asks for its number to be typed back
async function decide(ctx, action, kind, id) {
  adminOnly(ctx);
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

// ---- help's groups and an example for each ----
export const GROUPS = [
  ["Start here", ["help", "today", "now", "status", "search", "whoami", "version"]],
  ["Plans", ["quests", "missions", "plans"]],
  ["Apps", ["calendar", "notes", "board", "agent", "ask", "index", "open"]],
  ["Studio", ["enquiries", "chats", "clients", "money", "campaigns", "outreach", "social", "approvals", "alerts", "tests", "portal", "approve", "reject"]],
  ["Tools", ["google", "fixer", "lossless", "music", "theme", "logs"]],
  ["Server", ["computer", "deploy", "backup", "vps", "shell"]],
  ["Admin", ["admin"]],
  ["Console", ["clear", "history"]],
];
export const EXAMPLES = {
  help: "help quests", today: "today", now: "now", status: "status", search: "search mixing", whoami: "whoami", version: "version",
  quests: 'quests add "Mix the EP" --minutes 60', missions: 'missions new "Release the EP by December"', plans: "plans",
  calendar: "calendar week", notes: "notes list", board: "board list", agent: 'agent "what\'s on today?"', ask: 'ask "who booked last week?"', index: "index search pricing", open: "open board",
  enquiries: "enquiries", chats: "chats", clients: "clients", money: "money", campaigns: "campaigns", outreach: "outreach", social: "social", approvals: "approvals", alerts: "alerts", tests: "tests",
  portal: "portal enquiries", approve: "approve campaign 12", reject: "reject social 7",
  google: "google sync calendar", fixer: "fixer jobs", lossless: "lossless start", music: "music next", theme: "theme pulsar", logs: "logs 20",
  computer: "computer", deploy: "deploy status", backup: "backup", vps: "vps", shell: "shell", admin: "admin crew", clear: "clear", history: "history",
};
// "quests list" → "list" (the part after the command's own name in its usage line)
function argsOf(usage, name) {
  return String(usage || "").replace(new RegExp(`^${name}\\s*`), "");
}
// A few other words people type
const ALIASES = { "?": "help", h: "help", q: "quests", quest: "quests", task: "quests", tasks: "quests", cal: "calendar", note: "notes", boards: "board", enquiry: "enquiries", inbox: "enquiries", chat: "chats", conversations: "chats", client: "clients", invoices: "money", campaign: "campaigns", posts: "social", server: "computer", desk: "computer", status_: "status", cls: "clear", ls: "help", find: "search", whoami_: "whoami", ver: "version", terminal: "shell", ssh: "vps" };
export function resolveName(name) {
  return COMMANDS[name] ? name : ALIASES[name] && COMMANDS[ALIASES[name]] ? ALIASES[name] : name;
}
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function suggestions(name) {
  const n = String(name || "").toLowerCase();
  const all = Object.keys(COMMANDS);
  const close = all.map((c) => [c, distance(n, c)]).filter(([c, d]) => d <= Math.max(1, Math.floor(c.length / 3)) || (n.length >= 3 && c.startsWith(n))).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  return close.slice(0, 3);
}
export function notFound(name) {
  const near = suggestions(name);
  return `There's no "${name}".${near.length ? ` Did you mean ${near.join(" or ")}?` : ""} Type help for the list.`;
}

// ---- Finishing a word with Tab ----
export function complete(line) {
  const ends = /\s$/.test(line);
  let words;
  try {
    words = tokenize(line);
  } catch {
    return [];
  }
  if (ends) words.push("");
  if (words.length <= 1) {
    const w = (words[0] || "").toLowerCase();
    return Object.keys(COMMANDS).filter((c) => c.startsWith(w));
  }
  const cmd = COMMANDS[resolveName(words[0].toLowerCase())];
  if (!cmd || !cmd.subs || words.length > 2) return [];
  const w = words[1].toLowerCase();
  return cmd.subs.filter((s) => s.startsWith(w));
}

// ---- Run one line ----
export async function run(ctx, line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  const parsed = parse(trimmed);
  const name = resolveName(parsed.name);
  const { args, flags } = parsed;
  const cmd = COMMANDS[name];
  if (!cmd) throw new Error(notFound(parsed.name));
  await cmd.run.call(cmd, ctx, args, flags);
}
