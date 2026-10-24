// The phone preview's made-up answers for Computer, the Fixer and Nova (the Visualizer): a pretend VPS, a pretend
// check and pretend live steps (no real servers, people or keys). Buttons answer as the real server does.
(() => {
  "use strict";
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const GB = 1024 ** 3, MB = 1024 ** 2;
  let checking = 0; // (when a pretend check started)

  // ---- Computer ----
  const history = Array.from({ length: 60 }, (_, i) => ({ at: Date.now() - (60 - i) * 30000, cpu: Math.round(12 + 10 * Math.sin(i / 5) + (i % 7)), mem: Math.round(46 + 4 * Math.sin(i / 9)) }));
  const screenHtml = [
    '<span class="c6 bo">╭─ Nova-VPS (Remote Control) ─────────────╮</span>',
    '<span class="c2">✓</span> Connected as <span class="bo">Nova-VPS</span> · waiting for a task from the Claude app',
    '<span class="c8">  Last task: tidy the invoice preview build (finished 14:02)</span>',
    '<span class="c3">⚠</span> 1 job still working: <span style="color:#9FB4FF">fix-calendar-fit</span>',
    '<span class="c6 bo">╰──────────────────────────────────────────╯</span>',
    '$ git log --oneline -3',
    '<span class="c3">8a7e65f3</span> Portal: one sign-in for every panel',
    '<span class="c3">2cdd9595</span> Hub merged into Portal',
    '<span class="c3">a91b2c04</span> Invoicer: PDF on every invoice view',
  ].join("\n");
  const computerState = () => ({
    ok: true, onServer: true, at: new Date().toISOString(),
    screens: [
      { id: "nova-vps:0", session: "nova-vps", window: 0, name: "claude", active: true, title: "Nova-VPS (Remote Control)", html: screenHtml },
      { id: "nova-jobs:1", session: "nova-jobs", window: 1, name: "fix-calendar-fit", active: false, title: "Job · fix-calendar-fit", html: '<span class="c2">●</span> Reading web/calendar/fit.js…\n<span class="c8">  The week view measures itself twice on load; trying one pass.</span>' },
    ],
    claude: { version: "2.4.1 (Claude Code)", signedIn: true, problem: "", remote: true, tmux: true, running: 1, finishedToday: 3, handoff: { heading: "Calendar: one fit pass on load", text: "The week view measured itself twice on load, so it jumped.\n\nDone so far:\n- one measure, after fonts are in\n- kept the page bar\n\nNext: check the 16 Fixer sizes." } },
    jobs: [
      { id: "20261023-1402-fix-calendar-fit", name: "fix-calendar-fit", task: "Fix the Calendar's jump on load\nMeasure once, after the fonts are in.", started: iso(18), finished: null, running: true, exit: null, seconds: 1080, tail: "Reading web/calendar/fit.js…\nThe week view measures itself twice on load." },
      { id: "20261023-1210-invoice-preview", name: "invoice-preview", task: "Rebuild the invoice preview", started: iso(140), finished: iso(126), running: false, exit: 0, seconds: 840, tail: "built: 14 files in share/\n=== all good" },
      { id: "20261022-2230-tidy-logs", name: "tidy-logs", task: "Tidy old logs", started: iso(1000), finished: iso(998), running: false, exit: 1, seconds: 95, tail: "rm: cannot remove 'logs/old': Permission denied" },
    ],
    vps: {
      cpus: 4, load: [0.42, 0.51, 0.6], cpu: history[history.length - 1].cpu, uptimeSeconds: 1250000,
      memory: { total: 8 * GB, used: 3.9 * GB }, disk: { total: 160 * GB, free: 96 * GB },
      services: [{ id: "nova", name: "Nova Bot", state: "active" }, { id: "nova-agent", name: "Nova Agent", state: "active" }, { id: "caddy", name: "Web (Caddy)", state: "active" }, { id: "nova-mail", name: "Mail sender", state: "active" }, { id: "postfix", name: "Mail (Postfix)", state: "reloading" }],
      history,
    },
    suite: {
      overall: "Everything's working", ok: true,
      parts: [{ name: "Website", state: "ok", text: "Answering in 120 ms" }, { name: "Portal", state: "ok", text: "Signed-in pages fine" }, { name: "Nova Agent", state: "ok", text: "Linked to Nova Bot" }, { name: "Email", state: "warn", text: "2 delayed today" }],
      deploys: [{ repo: "Nova Agent", hash: "8a7e65f", at: iso(50), subject: "Nova Phone: Computer, Fixer and Nova natively for phones" }, { repo: "Nova Bot", hash: "2cdd959", at: iso(300), subject: "Portal: one sign-in for every panel" }],
      fixer: { needsYou: 0, lastCheck: iso(12), looksAt: iso(12), looksFailed: 2, claude: "" },
      backup: { last: iso(400), count: 5 },
    },
  });
  const tree = {
    "/": [["srv", "folder"], ["var", "folder"], ["home", "folder"], ["root", "folder", { locked: true }], ["etc", "folder"]],
    "/srv": [["nova", "folder"], ["nova-agent", "folder"]],
    "/srv/nova-agent": [["web", "folder"], ["src", "folder"], ["logs", "folder"], [".env", "file", { private: true, size: 2100 }], ["README.md", "file", { size: 5400 }], ["package.json", "file", { size: 1800 }], ["planet.png", "file", { size: 182000 }], ["current", "link", { target: "/srv/nova-agent/releases/42", to: "folder" }], ["nova.db", "file", { size: 48 * MB }]],
    "/srv/nova-agent/web": [["phone", "folder"], ["agent", "folder"], ["index.html", "file", { size: 3200 }]],
  };
  const entries = (path) => (tree[path] || []).map(([name, kind, x = {}]) => ({ name, kind, size: kind === "folder" ? null : x.size ?? 1000, modified: iso(name.length * 60), owner: x.locked ? "root" : "nova-agent", locked: !!x.locked, private: !!x.private, ...(x.target ? { target: x.target, to: x.to } : {}) }));
  const files = {
    "/srv/nova-agent/README.md": { kind: "text", language: "md", text: "# Nova Agent\n\nThe studio's helper: it plans Quests around the studio's bookings, keeps the Calendar, and answers in the **Agent**.\n\n## Running it\n\n`npm run dev` on the studio PC, or `systemctl restart nova-agent` on the VPS.\n" },
    "/srv/nova-agent/package.json": { kind: "text", language: "json", text: '{\n  "name": "nova-agent",\n  "version": "1.42.0",\n  "private": true,\n  "scripts": { "dev": "tsx src/index.ts", "test": "vitest" }\n}\n' },
    "/srv/nova-agent/.env": { kind: "hidden", message: "Hidden: private. Only its name is shown." },
    "/srv/nova-agent/nova.db": { kind: "binary", size: 48 * MB, message: "A binary file (not text), so it isn't shown." },
    "/srv/nova-agent/planet.png": { kind: "image", type: "image/png", size: 182000, tooBig: false },
  };
  const procs = () => {
    const list = [
      ["workerd", "Nova Bot", "nova", 23.4, 620 * MB, "workerd serve config.capnp --experimental"],
      ["node", "Nova Agent", "nova-agent", 61.2, 410 * MB, "node --import tsx src/index.ts"],
      ["claude", "Claude", "nova-agent", 8.1, 290 * MB, "claude --remote-control Nova-VPS"],
      ["caddy", "web", "caddy", 0.6, 48 * MB, "caddy run --config /etc/caddy/Caddyfile"],
      ["postfix", "system", "root", 0.1, 12 * MB, "/usr/lib/postfix/sbin/master -w"],
      ["sshd", "system", "root", 0, 9 * MB, "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups"],
      ["ttyd", "web", "nova-agent", 0.2, 14 * MB, "ttyd --interface 127.0.0.1 --port 7681 --base-path /vps-terminal --writable"],
    ].map(([name, group, user, cpu, memory, command], i) => ({ pid: 1200 + i * 37, name, group, user, cpu: Math.max(0, Math.round((cpu + (Math.random() * 4 - 2)) * 10) / 10), memory, started: iso(600 + i * 90), command }));
    const groups = {};
    for (const p of list) { const g = (groups[p.group] ||= { count: 0, cpu: 0, memory: 0 }); g.count++; g.cpu = Math.round((g.cpu + p.cpu) * 10) / 10; g.memory += p.memory; }
    return { ok: true, at: new Date().toISOString(), total: list.length, memoryTotal: 8 * GB, groups, procs: list };
  };
  const diskAsked = {};
  const disk = (path) => {
    // (the first time a folder's asked for it "measures" for a few seconds, as the real one does)
    diskAsked[path] ||= Date.now();
    const ready = Date.now() - diskAsked[path] > 4000 || path === "/";
    const kids = { "/": [["srv", 38], ["var", 9.5], ["home", 2.1], ["usr", 6.4]], "/srv": [["nova", 21], ["nova-agent", 17]], "/var": [["log", 6], ["lib", 3.5]], "/home": [["nova-agent", 2.1]] }[path] || [["cache", 1.2], ["data", 0.8]];
    const folders = kids.map(([n, g]) => ({ name: n, path: `${path === "/" ? "" : path}/${n}`, size: g * GB, private: false }));
    return { ok: true, path, measuring: !ready, result: ready ? { path, at: iso(2), total: folders.reduce((t, f) => t + f.size, 0) + 0.3 * GB, folders, partial: path === "/" } : null };
  };

  // ---- Portal → Admin → Computer ----
  const desk = () => ({
    canAct: true,
    here: { url: "https://nova.example", version: { id: "8a7e65f3", at: iso(300) }, pc: { connected: true, where: "server", since: iso(2000) }, agentSwitch: { to: "vps/agent-switch.sh", back: "vps/agent-switch-back.sh", from: "the studio PC, in nb/novacane-worker" }, warnings: [], jobs: [{ name: "Email campaigns (hourly check)", at: iso(20), ok: true, note: "" }, { name: "Google: calendar", at: iso(35), ok: false, note: "The token needs signing in again" }, { name: "Clients from the calendar", at: iso(65), ok: true, note: "" }] },
    vps: { reachable: true, url: "https://vps.example", host: "nova-vps", at: new Date().toISOString(), uptimeSeconds: 1250000, novaSince: "Mon 2026-10-20 09:14:02 UTC", agentSince: "Tue 2026-10-21 18:40:11 UTC", cpu: { count: 4, load: [0.42, 0.51, 0.6] }, memory: { total: 8 * GB, free: 3.1 * GB }, disk: { total: 160 * GB, free: 96 * GB }, services: { nova: "active", "nova-agent": "active", caddy: "active", "nova-cron.timer": "active", "nova-backup.timer": "active", "desk-status": "active", "nova-mail": "active", postfix: "active" }, jobsOn: true, mail: { sender: "active", postfix: "active", queue: 0, lastSent: iso(44), troubleToday: 2 }, lastSync: iso(90), lastBackup: iso(400), backups: [{ name: "nova-1.tar.gz" }, { name: "nova-2.tar.gz" }, { name: "nova-3.tar.gz" }], version: `8a7e65f3 ${iso(300)}`, node: "v22.11.0", problems: ["2026-10-23T09:12:44+0100 nova-vps nova[812]: warning: a slow answer from Google Calendar (4.2 s)"] },
  });

  // ---- The Fixer ----
  const RULES = [
    { id: "offscreen", title: "Never anything off the screen", text: "Nothing sticks out past the screen's edges or is cut off by its box." },
    { id: "onescreen", title: "One screen", text: "The page never scrolls sideways; on a computer it never scrolls at all (only boxes inside it do); on a phone a panel scrolls up and down like any app." },
    { id: "oneline", title: "Never onto the next line", text: "Buttons, names, labels and headings keep their words on one line; Nova Agent's bars stay one row." },
    { id: "works", title: "Every button and link works", text: "No button or link leads to a page that isn't there (Not found) or is broken." },
  ];
  const problems = [
    { rule: "oneline", place: "Portal", what: "A chip “Owes money”", why: "its words go onto 2 lines", at: [{ size: "320×568", kind: "phone", shot: "portal-320x568.png" }, { size: "360×640", kind: "phone", shot: "portal-360x640.png" }] },
    { rule: "offscreen", place: "Calendar", what: "The week's last column", why: "it sticks out 14px past the right edge", at: [{ size: "800×700", kind: "computer", shot: "calendar-800x700.png" }, { size: "768×1024", kind: "tablet", shot: "calendar-768x1024.png" }] },
  ];
  const fixer = () => {
    const running = checking && Date.now() - checking < 12000;
    if (checking && !running) checking = 0;
    const counts = { offscreen: 0, onescreen: 0, oneline: 0, works: 0 };
    for (const p of problems) counts[p.rule]++;
    return { rules: RULES.map((r) => ({ ...r, problems: counts[r.id] })), every: 30, sizes: [], running: !!running, runningSince: running ? new Date(checking).toISOString() : null, last: { id: "20261023-140000", at: iso(running ? 30 : 12), base: "https://nova.example", signedIn: true, screens: 240, places: ["Portal", "Calendar"], errors: [{ place: "Board", size: "360×298", error: "It didn't finish drawing within 20 seconds" }] }, problems, fixed: 7, history: [], error: null };
  };

  // ---- Nova (the Visualizer) ----
  const pic = (label) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#140c22"/><rect x="40" y="40" width="560" height="60" rx="10" fill="#2a1d40"/><rect x="40" y="130" width="260" height="200" rx="10" fill="#22183a"/><rect x="330" y="130" width="270" height="90" rx="10" fill="none" stroke="#e5484d" stroke-width="4"/><text x="320" y="380" fill="#c7a4ff" font-family="sans-serif" font-size="20" text-anchor="middle">${label} (made-up picture)</text></svg>`)}`;
  let nextId = 1;
  const ev = (part, level, message, extra = {}) => ({ id: nextId++, time: new Date().toISOString(), part, level, message, ...extra });
  const recent = [ev("input", "start", "Chat: What's booked tomorrow?"), ev("llm", "start", "Asking Claude", { data: { system: "You are Nova Agent (made-up).", prompt: "What's booked tomorrow?" } }), ev("input", "ok", "Chat: Looked at the studio's bookings, Fri 6 Nov – Fri 6 Nov"), ev("task", "info", "Studio bookings refreshed (the regular refresh): 3 booking(s). Re-planning."), ev("browser", "start", "Looking at https://example.com/"), ev("browser", "ok", "Looked at Example Domain")];
  const listeners = new Set();
  const RealES = window.EventSource;
  class SampleES {
    constructor(url) {
      this.url = url; this.readyState = 0; this.onopen = this.onmessage = this.onerror = null;
      this.fn = (e) => this.readyState === 1 && this.onmessage && this.onmessage({ data: JSON.stringify(e) });
      setTimeout(() => {
        if (this.readyState === 2) return;
        this.readyState = 1;
        this.onopen && this.onopen({});
        for (const e of recent) this.fn(e);
        listeners.add(this.fn);
      }, 300);
    }
    close() { this.readyState = 2; listeners.delete(this.fn); }
    addEventListener() {}
  }
  window.EventSource = function (url, opts) { return new URL(url, location.href).pathname === "/events" ? new SampleES(url) : new RealES(url, opts); };

  // (the pictures the real server sends: made-up ones here)
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    get() { return src.get.call(this); },
    set(v) { const s = String(v); src.set.call(this, s.startsWith("/fixer-api/shots/") ? pic(`Fixer: ${decodeURIComponent(s.split("/").pop())}`) : s.startsWith("/computer-api/image") ? pic(decodeURIComponent(s.split("path=").pop())) : s); },
    configurable: true,
  });

  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/computer-api/state") return computerState();
    if (p === "/computer-api/files") {
      const path = u.searchParams.get("path") || "/";
      if (path === "/root") return { status: 403, body: { ok: false, message: "Only root can see inside this folder." } };
      if (!tree[path] && !/^\/(srv|var|home|etc)/.test(path)) return { status: 404, body: { ok: false, message: "That folder isn't there." } };
      const list = entries(path);
      return { ok: true, path, real: path, locked: false, entries: list, total: list.length, capped: false };
    }
    if (p === "/computer-api/file") {
      const path = u.searchParams.get("path"), f = files[path];
      if (!f) return { ok: true, file: { path, kind: "text", size: 120, modified: iso(30), cut: false, language: "conf", text: `# ${path}\n# (a made-up file in the preview)\nkey = value\n` } };
      return { ok: true, file: { path, size: f.size ?? f.text?.length ?? 0, modified: iso(80), cut: false, ...f } };
    }
    if (p === "/computer-api/procs") return procs();
    if (p === "/computer-api/disk") return disk(u.searchParams.get("path") || "/");
    if (p === "/app/api/desk") return desk();
    if (p === "/app/api/desk/action" && method === "POST") return ["restart", "restart-agent", "restart-web", "backup"].includes(body?.do) ? { ok: true, done: body.do } : { status: 400, body: { error: "Which? restart, restart-agent, restart-web or backup." } };
    if (p === "/fixer-api/state") return fixer();
    if (p === "/actions/fixer/check" && method === "POST") { if (checking) return { ok: true, result: { started: false, running: true } }; checking = Date.now(); return { ok: true, result: { started: true } }; }
    return undefined;
  });
})();
