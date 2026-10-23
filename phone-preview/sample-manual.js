// The phone preview: made-up content for the Manual and the Observatory (their data comes as a file, not from the
// server). Richer than preview-extra.js's small sample, which is kept: when it sets the same globals, its apps and
// projects are added to these instead of replacing them.
(() => {
  "use strict";
  const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const commit = (h, hash, subject, body = "") => ({ hash, date: ago(h), subject, body });
  const table = (head, rows) => `<div class="table"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  const ch = (id, title, html) => ({ id, title, html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() });
  const hist = (list, total, first, work = []) => ({ total, first, commits: list, work, workCount: work.length, workStat: work.length ? `${work.length * 14} lines added, ${work.length * 3} taken out` : "" });

  const apps = [
    { id: "agent", name: "Nova Agent", colour: "#FF5FA8", glyph: "✦", where: "Online for everyone, on the studio's server", repo: "na", shared: "",
      links: [["Open Nova Agent", "https://nova.novacane.co.uk/agent/"]], tagline: "Your planner, your Nova Agent and the studio's hands in Acuity.",
      intro: "<p>Talk to it, give it a goal, and it plans your days. Every other part of the suite is a panel inside it.</p>",
      guide: [
        ch("at-a-glance-0", "At a glance", table(["", ""], [["<strong>Agent</strong>", "Claude, with tools for quests, missions, the calendar and its own status"], ["<strong>Missions and Quests</strong>", "Goals broken into quests, planned hour by hour"], ["<strong>Panels</strong>", "Portal, Calendar, Notes, Index and the rest, inside it"]])),
        ch("asking-1", "Asking Agent", "<p>Type what you want in your own words. Agent answers, and when it can do the thing itself it asks first.</p><h4>Good things to ask</h4><ul><li>“Plan my Saturday around the vocal session.”</li><li>“What did we agree with the band about rehearsals?”</li></ul><h4>When it can't</h4><p>It says what it would need, and which panel does it by hand.</p>"),
        ch("missions-2", "Missions", "<p>A mission is a goal with a date. Agent breaks it into quests and puts them on your days.</p><blockquote>Tip: give it the deadline and how many hours a day you have.</blockquote>"),
      ],
      built: [ch("how-it-works-0", "How it works", "<pre><code>flowchart LR\n  You --> Page[Nova Agent page] --> Chat[Agent src/chat.ts] --> Claude\n  Chat --> Q[(Quests and calendar data/)]</code></pre><p>The page talks to <code>src/server.ts</code>; Agent runs in <code>src/chat.ts</code>.</p>"),
        ch("files-1", "Files", table(["File", "What it is", "Who writes it"], [["<code>src/server.ts</code>", "The web server", "Nova Agent"], ["<code>data/quests.json</code>", "Every quest", "Agent and you"]]))],
      news: [],
      history: hist([commit(3, "a1b2c3d", "Agent: a shorter answer when you ask a yes-or-no question", "It used to explain itself first.\nNow it answers, then explains if you ask."), commit(7, "b2c3d4e", "Missions plan around day cards marked busy"), commit(30, "c3d4e5f", "Quests: snooze for an hour from the reminder"), commit(80, "d4e5f6a", "The look: calmer stars on phones"), commit(200, "e5f6a7b", "Nova Agent's first phone layout")], 212, ago(24 * 20), [{ file: "src/chat.ts", state: "M" }, { file: "web/phone/manual.js", state: "M" }, { file: "web/phone/manual.css", state: "??" }]) },
    { id: "portal", name: "Portal", colour: "#FF8CC6", glyph: "◈", where: "Online, for the studio's staff", repo: "nb/novacane-worker", shared: "Portal shares its history with Nova Bot: the same code.",
      links: [["Open Portal", "https://nova.novacane.co.uk/portal/"]], tagline: "Enquiries, conversations, bookings, alerts, clients, money and outreach.",
      intro: "<p>The studio's front desk. Open <a href=\"https://nova.novacane.co.uk/portal/\">Portal</a> and everything that came in today is on one screen.</p>",
      guide: [ch("inbox-0", "The inbox", "<p>Enquiries, website chats and alerts, side by side. Tap one to open it.</p><h4>Answering</h4><p>Write your reply and press <strong>Send</strong>; it's emailed from the studio.</p><h4>Labels</h4><p>Give an enquiry a label so the team knows who has it.</p>"),
        ch("money-1", "Money", "<p>Invoices are made in the <strong>Invoicer</strong>. Portal shows what's owed and paid.</p>"),
        ch("roles-2", "Who sees what", table(["Who", "What they can see", "What they can do"], [["Admin", "Everything", "Approve, invite, settings"], ["Staff", "Their enquiries and the calendar", "Answer, book"], ["Guest", "Nothing until invited", "—"]]))],
      built: [ch("built-0", "How Portal is built", "<p>Portal is pages in Nova Bot's worker: <code>public/portal/</code>.</p>")],
      news: [ch("whats-new-0", "What's new", "<ul><li><strong>Nova Tabs</strong>: Portal's sections as tabs under the top panel.</li><li>The Inbox is one dashboard.</li></ul>")],
      history: hist([commit(5, "f1e2d3c", "Inbox: enquiries, chats and alerts side by side"), commit(28, "e2d3c4b", "Clients: one card per client, with every booking"), commit(52, "d3c4b5a", "Money: the Invoicer opens from every invoice", "Every Open button now goes to the Invoicer, set up for the job.")], 127, ago(24 * 18)) },
    { id: "calendar", name: "Calendar", colour: "#C7A4FF", glyph: "◐", where: "Online, and in Nova Agent", repo: "nc", shared: "",
      links: [["Open Calendar", "https://nova.novacane.co.uk/calendar/"]], tagline: "Note cards and day cards, with your quests on them.",
      intro: "<p>The studio's calendar: <strong>note cards</strong> for things at a time, <strong>day cards</strong> for whole days.</p>",
      guide: [ch("cards-0", "Note cards and day cards", "<p>A note card has a start and an end; a day card covers the day.</p>"), ch("repeat-1", "Repeating cards", "<p>Change just one, this and the ones after, or all of them.</p>")],
      built: [], news: [],
      history: hist([commit(26, "aa11bb2", "Week view: today's column a little wider"), commit(24 * 9, "bb22cc3", "Day cards: their own pictures")], 65, ago(24 * 25)) },
    { id: "observatory", name: "Observatory", colour: "#9C8FD0", glyph: "✧", where: "Online, for the studio's staff", repo: "na", shared: "",
      links: [["Open Observatory", "https://nova.novacane.co.uk/observatory/"]], tagline: "Every project in one sky: where each lives, how big it is, what it looks like.",
      intro: "<p>Every project the studio has made, with its numbers, languages and pictures.</p>",
      guide: [ch("decks-0", "Project decks", "<p>One card per project. Search by name, goal, stack or path; filter by category; sort by activity, size or name.</p>"), ch("detail-1", "A project in full", "<p>Tap a card: its goal, vision, features, facts, folder tree, languages and pictures.</p>")],
      built: [ch("scan-0", "The scan", "<p><code>npm run scan</code> counts the numbers; <code>npm run build</code> also takes the screenshots and video.</p>")],
      news: [], history: hist([commit(50, "0b5e7a1", "Observatory: only the categories that have projects show as filters")], 41, ago(24 * 17)) },
    { id: "invoicer", name: "Invoicer", colour: "#FF5FA8", glyph: "£", where: "In Nova Agent", repo: "na", shared: "",
      links: [["Open the Invoicer", "https://nova.novacane.co.uk/agent/invoicer"]], tagline: "Every invoice: written, sent, paid, with its PDF.",
      intro: "<p>Writing, approving, sending and chasing invoices all happen here.</p>",
      guide: [ch("writing-0", "Writing an invoice", "<p>Pick the client, add lines, and press <strong>Save</strong>. Every invoice has a PDF.</p>")],
      built: [], news: [], history: hist([], 0, "") },
  ];
  const mine = {
    built: ago(2), recentDays: 7,
    suite: { tagline: "Every part of Nova Agent: how to use it, how it's built, its story so far and what's changing.", intro: "<p>Nova Agent is the studio's one app; Nova Bot answers the website and keeps the data.</p>",
      chapters: [ch("suite-0", "Who does what", table(["Part", "What it is", "Where it runs"], [["Nova Agent", "The app for everyone", "The studio's server"], ["Nova Bot", "The website chat and the data", "Online"], ["Nova Phone", "The app on a phone", "Online"]]))] },
    apps,
    addresses: [
      { title: "The apps", note: "Nova Agent and its panels. Open Nova Agent and every panel is inside it.", items: [
        { name: "Nova Agent", path: "/agent/", what: "The app for everyone.", url: "https://nova.novacane.co.uk/agent/" },
        { name: "Calendar", path: "/calendar/", what: "Note cards and day cards.", url: "https://nova.novacane.co.uk/calendar/" },
        { name: "Observatory", path: "/observatory/", what: "Every project and its code.", url: "https://nova.novacane.co.uk/observatory/" },
        { name: "Lossless", path: "/lossless/", what: "Lossless audio rooms.", url: "https://nova.novacane.co.uk/lossless/" }] },
      { title: "For everyone", note: "Pages clients, fans and anyone else can open.", items: [{ name: "Status", path: "/status", what: "Is everything working? All green means yes.", url: "https://nova.novacane.co.uk/status" }, { name: "Book a session", path: "/book", what: "Goes to the studio's booking page.", url: "https://nova.novacane.co.uk/book" }] },
      { title: "Website chat", note: "The chat on the studio's website.", items: [{ name: "Chat script", path: "/novabot.js", what: "The chat itself.", url: "https://nova.novacane.co.uk/novabot.js" }, { name: "The two lines for the website", code: '<link rel="stylesheet" href="https://nova.novacane.co.uk/novabot.css">\n<script src="https://nova.novacane.co.uk/novabot.js" defer></script>', what: "Copy both lines into the website's footer code." }] },
    ],
  };
  // (the small sample's apps and projects join ours rather than replacing them)
  const join = (base, extra, key) => { for (const x of (extra && extra[key]) || []) if (!base[key].some((y) => y.id === x.id)) base[key].push(x); return base; };
  let manual = mine;
  Object.defineProperty(window, "NovaManualData", { configurable: true, get: () => manual, set: (v) => { manual = join(mine, v, "apps"); } });
  window.NovaManualNews = { newest: ago(3) };

  const tree = [
    { path: "web", dir: true, bytes: 4.2e6, files: 180, children: [{ path: "web/phone", dir: true, bytes: 1.1e6, files: 40 }, { path: "web/shared", dir: true, bytes: 2.4e6, files: 90 }, { path: "web/index.html", dir: false, bytes: 6000, files: 1 }] },
    { path: "src", dir: true, bytes: 1.6e6, files: 60, children: [{ path: "src/chat.ts", dir: false, bytes: 90000, files: 1 }, { path: "src/server.ts", dir: false, bytes: 70000, files: 1 }] },
    { path: "README.md", dir: false, bytes: 24000, files: 1 },
  ];
  const langs = (js, css, html, ts) => [{ name: "JavaScript", lines: js }, { name: "CSS", lines: css }, { name: "HTML", lines: html }, { name: "TypeScript", lines: ts }].filter((l) => l.lines);
  const obs = {
    generatedAt: ago(5), root: "/home/sample/an",
    totals: { projects: 5, lines: 151200, bytes: 9.6e7, disk: 1.2e9, files: 1490, langs: langs(92000, 21000, 13000, 25200), newest: ago(5) },
    projects: [
      { id: "sample-agent", name: "Nova Agent", tagline: "The studio's one app: Agent, Missions and Quests, every panel", path: "/home/sample/an/pj/ns/na", category: "Nova Agent", theme: "solar", status: "live",
        kind: "Node service + web app, online through Nova Bot", stack: ["Node 22", "TypeScript", "Hono", "Playwright", "Claude API", "Web Audio", "Service worker"],
        goal: "Nova Agent is the one app the studio works in: Agent answers, plans and acts; Missions turn a goal into a plan and Quests run the day.", vision: "One calm, cosmic workspace for the whole studio, on the computer and on every phone.",
        features: ["Agent with tools for quests, missions and the calendar", "Every panel inside it", "Nova Phone for phones"], run: "npm start, then open http://127.0.0.1:4545/agent/",
        stats: { files: 420, bytes: 4.1e7, lines: 52000, disk: 2.3e8, newest: ago(5), newestFile: "web/phone/manual.js", langs: langs(30000, 9000, 4000, 9000) }, tree,
        ignored: [{ path: "node_modules", kind: "build", bytes: 1.2e8 }, { path: "vendor", kind: "vendored", bytes: 3e6 }],
        git: { branch: "main", commits: 640, dirty: 3, remote: "https://github.com/example/nova-agent", last: { hash: "a1b2c3d", subject: "Agent: a shorter answer for yes-or-no questions", date: ago(5) } },
        media: { captured: ago(24 * 6), mode: "page", shots: [{ file: "shot-1.jpg", caption: "Live view" }, { file: "shot-2.jpg", caption: "Further down" }], video: "video.mp4", poster: "shot-1.jpg", note: null } },
      { id: "sample-bot", name: "Nova Bot", tagline: "The website chat, Portal and the studio's data", path: "/home/sample/an/pj/ns/nb/novacane-worker", category: "Nova Agent", theme: "pulsar", status: "active",
        kind: "Cloudflare Worker", stack: ["Workers", "D1", "Durable Objects", "Stripe", "Resend", "Acuity", "MailerLite"], goal: "Answer the website, keep the bookings and enquiries, and send the email.",
        stats: { files: 610, bytes: 3.6e7, lines: 64000, disk: 6.1e8, newest: ago(30), newestFile: "src/index.js", langs: langs(48000, 8000, 6000, 2000) }, tree: tree.slice(0, 2),
        git: { branch: "main", commits: 900, dirty: 0, last: { hash: "f1e2d3c", subject: "Inbox: side by side", date: ago(30) } },
        related: [{ label: "Open-source edition", path: "/home/sample/an/pj/ns/nb/novabot-public", disk: 2.9e8 }, { label: "Backup", path: "/home/sample/an/pj/ns/nb/backup-1", disk: 2.2e7 }],
        media: { captured: ago(24 * 12), mode: "page", shots: [{ file: "shot-1.jpg", caption: "The chat on the website" }], poster: "shot-1.jpg", note: null } },
      { id: "sample-lossless", name: "Nova Lossless Audio", tagline: "Two devices, one room code, raw audio", path: "/home/sample/an/pj/ns/na/web/lossless", category: "Nova Agent", theme: "aurora", status: "active",
        kind: "Worker + Durable Object", stack: ["WebRTC", "AudioWorklet", "Durable Objects"], goal: "Send audio between two devices bit-exact.", stats: { files: 14, bytes: 1.4e5, lines: 2400, disk: 3e7, newest: ago(24 * 3), langs: langs(2100, 200, 100, 0) }, tree: tree.slice(2) },
      { id: "sample-games", name: "Small games", tagline: "A shelf of little games", path: "/home/sample/an/co/games", category: "Games", theme: "eclipse", status: "building", group: true, kind: "Several projects",
        goal: "Small games made on weekends.", stack: ["Godot", "Lua"], stats: { files: 300, bytes: 1.5e7, lines: 26000, disk: 3.1e8, newest: ago(24 * 9), langs: [{ name: "GDScript", lines: 18000 }, { name: "Lua", lines: 8000 }] },
        members: [{ name: "Night Drive · racing", path: "/home/sample/an/co/games/night-drive", lines: 18000, bytes: 1e7, newest: ago(24 * 9) }, { name: "Moon Garden", path: "/home/sample/an/co/games/moon-garden", lines: 8000, bytes: 5e6, newest: ago(24 * 40) }] },
      { id: "sample-empty", name: "Next big thing", tagline: "A folder waiting for its first file", path: "/home/sample/an/co/next", category: "Experiments", status: "empty", kind: "Empty folder", goal: "To be decided.", stats: { files: 0, bytes: 0, lines: 0, disk: 4096, newest: "" } },
    ],
  };
  let observatory = obs;
  Object.defineProperty(window, "OBSERVATORY", { configurable: true, get: () => observatory, set: (v) => { observatory = join(obs, v, "projects"); } });
})();
