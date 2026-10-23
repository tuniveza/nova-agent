// The phone preview: made-up answers for Nova Phone as a whole (shell.js, settings.js, voice.js, music.js):
// the live version, Apps and links, a voice command, Nova's answer, the charts. No real people.
(window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method) => {
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  if (u.pathname === "/app-version") return { version: "preview-1" };
  if (u.pathname === "/app/api/links") {
    return {
      checkedAt: iso(u.searchParams.get("recheck") ? 0 : 42),
      groups: [
        { title: "The apps", note: "Where everyone opens Nova.", items: [
          { name: "Nova Phone", kind: "live", url: "https://nova.example/phone/", note: "The phone version", check: { state: "up", label: "Up · 120 ms" } },
          { name: "Nova Desk", kind: "live", url: "https://nova.example/agent/", note: "The computer version (copy it to open on a computer)", check: { state: "up" } },
        ] },
        { title: "For clients", items: [
          { name: "Booking page", kind: "live", url: "https://example.com/book", check: { state: "up" } },
          { name: "Nova Bot's address for the apps", kind: "machine", url: "https://nova.example/app/api/", check: { state: "unchecked" } },
          { name: "Studio computer", kind: "local", url: "http://localhost:4545/", check: { state: "down", label: "Off" } },
        ] },
      ],
      changelog: [
        { date: new Date().toISOString().slice(0, 10), app: "Nova Phone", size: "major", title: "Settings on the phone", what: "Themes, sounds, music and more in one place.", why: "Everything Nova Desk has, made for a phone.", benefit: "One theme for both apps." },
        { date: new Date().toISOString().slice(0, 10), app: "Portal", size: "small", title: "Numbers on the tiles", what: "What's waiting shows on its tile." },
      ],
      features: [{ app: "Portal", note: "The studio's front desk", items: [{ name: "Enquiries", detail: "Reply, label, assign" }, { name: "Alerts", detail: "What reached the phones" }] }],
    };
  }
  if (u.pathname === "/app/api/voice" && method === "POST") return { text: "What's booked tomorrow?" };
  if (u.pathname === "/app/api/ask" && method === "POST") return { answer: "Tomorrow there's one booking: Mastering for the Lowlands EP, 1 to 3 pm in Studio A." };
  if (u.pathname === "/music-world") return { updated: iso(30), top: [
    { rank: 1, title: "Night Drive", artist: "The Lanterns", art: "" }, { rank: 2, title: "Lowlands", artist: "Maya Rose", art: "" }, { rank: 3, title: "Glasshouse", artist: "Kai Bennett", art: "" },
  ] };
  return undefined;
});
