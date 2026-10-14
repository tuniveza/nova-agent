// A busy VPS for Computer (web/computer) in scripts/check-fit.mjs and screenshots: long session
// lines, many jobs, a long handoff, every part, and a full Nova (no real data, no secrets)
export function computerSample(now = Date.now()) {
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const long = "A very long line from a Claude session on the VPS that goes on and on past the edge of any phone screen, with a path /srv/nova-agent/work/na/web/computer/app.js and more words after it";
  const lines = (n, tag) => Array.from({ length: n }, (_, i) => `<span class="c${i % 8}">${tag} ${i + 1}</span> ${i % 5 === 0 ? long : "working on the Android pass: checking 360×640"}`).join("\n");
  return {
    ok: true,
    onServer: true,
    at: iso(0),
    screens: [
      { id: "nova-vps:0", session: "nova-vps", window: 0, name: "claude", active: true, title: "Nova-VPS (Remote Control)", html: `<span class="c2">·✔︎· Connected</span> · work · HEAD\n` + lines(58, "nova-vps") },
      { id: "nova-jobs:1", session: "nova-jobs", window: 1, name: "android-pass", active: true, title: "Job · android-pass", html: lines(60, "job") },
      { id: "nova-jobs:2", session: "nova-jobs", window: 2, name: "fixer-cards-redesign-with-a-long-name", active: false, title: "Job · fixer-cards-redesign-with-a-long-name", html: lines(20, "job") },
    ],
    claude: {
      version: "2.1.299 (Claude Code)", signedIn: true, problem: "", remote: true, tmux: true, running: 2, finishedToday: 5,
      handoff: { heading: "2026-10-14 (from the laptop session) — a long heading that has to wrap on a phone", text: Array.from({ length: 30 }, (_, i) => `- Item ${i + 1}: ${long}`).join("\n") },
    },
    jobs: Array.from({ length: 12 }, (_, i) => ({
      id: `2026101${i % 10}-1455${String(i).padStart(2, "0")}-job-${i}`, name: i === 0 ? "android-pass-with-a-very-long-job-name-that-wraps" : `job-${i}`,
      task: `${long} (${i})`, started: iso(3600_000 * (i + 1)), finished: i < 2 ? null : iso(3000_000 * i), running: i < 2, exit: i < 2 ? null : i % 4 === 0 ? 1 : 0,
      seconds: 3862 + i * 100, tail: lines(30, "tail").replace(/<[^>]+>/g, ""),
    })),
    vps: {
      cpus: 4, load: [8.52, 6.1, 4.3], cpu: 87, memory: { total: 6442450944, used: 4230000000 }, disk: { total: 31593590784, free: 22984269824 }, uptimeSeconds: 400516,
      services: [["nova", "Nova Bot"], ["nova-agent", "Nova Agent"], ["caddy", "Web (Caddy)"], ["nova-mail", "Mail sender"], ["postfix", "Mail (Postfix)"]].map(([id, name], i) => ({ id, name, state: i === 4 ? "failed" : "active" })),
      history: Array.from({ length: 60 }, (_, i) => ({ at: now - (60 - i) * 30_000, cpu: Math.round(40 + 40 * Math.sin(i / 6)), mem: 60 + (i % 7) })),
    },
    suite: {
      overall: "Everything's working", ok: true,
      parts: Array.from({ length: 12 }, (_, i) => ({ name: ["Website chat", "Booking", "Enquiries", "Nova Agent link", "Email", "Phone alerts"][i % 6] + (i > 5 ? " (2)" : ""), state: i === 3 ? "amber" : i === 7 ? "red" : "green", text: i % 3 ? "Answering visitors (a real test chat answered in 0.7 s, 5 h ago)." : "Fine." })),
      deploys: Array.from({ length: 5 }, (_, i) => ({ repo: i % 2 ? "Nova Bot" : "Nova Agent", hash: `abc12${i}`, at: iso(i * 3600_000), subject: `${long} (${i})` })),
      fixer: { needsYou: 3, lastCheck: iso(1200_000), looksAt: iso(3600_000), looksFailed: 6, claude: "" },
      backup: { last: iso(12 * 3600_000), count: 2 },
    },
  };
}
