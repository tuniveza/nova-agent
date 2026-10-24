// All addresses: every web address in the Nova Agent suite, in one list, with a plain line on each.
// Shown in Portal (Settings → Addresses, and Apps and links) and in the Manual (All addresses).
//
//   <script src="/shared/addresses.js"></script>   then   window.NovaAddresses
//
// Only public addresses live here (the code is on GitHub): no keys, no accounts. Every address
// answers on the live site (scripts/check-addresses.mjs checks them). `admin: true` ones are for
// admins only: Portal shows them to admins, the Manual leaves them out.
(function () {
  const BASE = "https://nova.novacane.co.uk";
  const groups = [
    {
      title: "The apps",
      note: "Nova Agent and its panels. Open Nova Agent and every panel is inside it.",
      items: [
        { name: "Nova Agent", path: "/agent/", what: "The app for everyone: Agent, quests and every panel. Add it to your phone's home screen." },
        { name: "Portal", path: "/portal/", what: "Enquiries, bookings, clients, campaigns, money and settings." },
        { name: "Calendar", path: "/calendar/", what: "Note cards and day cards, with your quests on them." },
        { name: "Notes", path: "/notes/", what: "Notes and documents, shared with the team." },
        { name: "Quests", path: "/quests/", what: "Every quest: add one in your own words, Focus, List, Board and Today." },
        { name: "Board", path: "/board/", what: "Boards of cards for plans, files, pictures and video." },
        { name: "Index", path: "/app/memory/", what: "Nova Agent's memory: everything it knows, searchable." },
        { name: "Console", path: "/console/", what: "Nova commands, typed. (Terminals only open through a private connection.)" },
        { name: "Observatory", path: "/observatory/", what: "Every project, its code and the star map." },
        { name: "Lossless", path: "/lossless/", what: "Lossless audio rooms: listen together at full quality." },
        // (Fixer off, 24 Oct 2026, the user: "just disable it entirely in all aspects for now": its page says so)
        { name: "Fixer", path: "/fixer/", what: "Switched off for now: the page says so, with Home.", admin: true },
      ],
    },
    {
      title: "For everyone",
      note: "Pages clients, fans and anyone else can open.",
      items: [
        { name: "Status", path: "/status", what: "Is everything working? All green means yes." },
        { name: "Book a session", path: "/book", what: "Goes to the studio's booking page." },
        { name: "Studio news", path: "/join", what: "Fans sign up for the studio's news here." },
        { name: "Were you referred?", path: "/referral", what: "Clients say who sent them." },
        { name: "Privacy", path: "/privacy", what: "How Nova looks after people's details." },
      ],
    },
    {
      title: "Website chat",
      note: "The chat on novacane.co.uk. These two lines go in Squarespace: search Code Injection in the dashboard, then Footer.",
      items: [
        { name: "Chat script", path: "/novabot.js", what: "The chat itself." },
        { name: "Chat look", path: "/novabot.css", what: "How the chat looks." },
        { name: "The two lines for Squarespace", code: `<link rel="stylesheet" href="${BASE}/novabot.css">\n<script src="${BASE}/novabot.js" defer></script>`, what: "Copy both lines into Squarespace's Code Injection (Footer)." },
      ],
    },
    {
      title: "For admins",
      note: "Addresses other services use. No keys are shown here.",
      admin: true,
      items: [
        { name: "Admin pages", path: "/admin", what: "The admin pages (you sign in through Portal).", admin: true },
        { name: "Status, as data", path: "/status.json", what: "The status page for outside watchdogs, like UptimeRobot.", admin: true },
        { name: "Google's return address", path: "/admin/google/callback", what: "Google sends you back here after Connect Google. It goes under Authorised redirect URIs in Google Cloud.", admin: true },
        { name: "Stripe's payment notices", path: "/stripe/webhook", what: "Stripe tells Nova here when a booking's deposit is paid or its checkout runs out. It goes in Stripe under Developers → Webhooks.", admin: true },
      ],
    },
  ];
  const url = (i) => (i.path ? BASE + i.path : "");
  // The list for one person: admins see everything, everyone else the rest
  const list = (admin) =>
    groups
      .filter((g) => admin || !g.admin)
      .map((g) => ({ ...g, items: g.items.filter((i) => admin || !i.admin).map((i) => ({ ...i, url: url(i) })) }))
      .filter((g) => g.items.length);
  window.NovaAddresses = { base: BASE, groups, list };
})();
