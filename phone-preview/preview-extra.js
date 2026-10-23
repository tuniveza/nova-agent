// The phone preview: sample content for the places whose data comes as a file (Help, Observatory).
window.NovaManualData = { apps: [
  { id: "portal", name: "Portal", tagline: "The studio's front desk", intro: "<p>Enquiries, conversations, bookings, alerts, clients, money and outreach.</p>", guide: [{ id: "g1", title: "Answering an enquiry", html: "<p>Open it from the Inbox, write your reply and press Send. It's emailed from the studio.</p>" }], built: [], news: [{ subject: "Nova Phone: the phone version", date: new Date().toISOString() }], history: { total: 1, commits: [] } },
  { id: "calendar", name: "Calendar", tagline: "Note cards and day cards", intro: "<p>The studio's calendar.</p>", guide: [{ id: "g2", title: "Repeating cards", html: "<p>Change just one, this and the ones after, or all of them.</p>" }], built: [], news: [], history: { total: 0, commits: [] } },
], addresses: [{ title: "The apps", items: [{ name: "Nova Phone", path: "/phone/", what: "The phone version" }, { name: "Nova Desk", path: "/agent/", what: "The computer version" }] }] };
window.OBSERVATORY = { totals: { projects: 2, lines: 184000, bytes: 9.2e6 }, projects: [
  { id: "nova", name: "Nova Suite", tagline: "The studio's own apps", category: "Nova Agent", status: "Live", stats: { lines: 160000, bytes: 8e6, files: 900, newest: new Date().toISOString() }, stack: ["JavaScript", "TypeScript"], goal: "Run the studio from one place.", features: ["Nova Phone", "Nova Desk", "Nova Bot"] },
  { id: "game", name: "Night Drive game", tagline: "A small racing game", category: "Games", stats: { lines: 24000, bytes: 1.2e6, files: 120, newest: new Date(Date.now() - 8e8).toISOString() }, stack: ["Canvas"] },
] };
