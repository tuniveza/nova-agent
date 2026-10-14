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

// Computer's views: a long folder, a long text file, many programs, many folders by size
export function computerView(pathname, search) {
  const p = new URLSearchParams(search).get("path") || "/";
  const iso = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  if (pathname.endsWith("/files")) {
    const names = ["na", "nb", "work", "data", ".claude", "fixer-jobs", "a-very-long-folder-name-that-goes-on-and-on-past-the-edge-of-a-phone", ".env", "secrets.txt", "notes.md", "pic.png", "big.log"];
    return { ok: true, path: p, real: p, locked: false, total: 240, capped: false, entries: Array.from({ length: 60 }, (_, i) => {
      const name = i < names.length ? names[i] : `file-${i}.json`;
      const folder = i < 7;
      return { name, kind: folder ? "folder" : "file", size: folder ? null : 1234 * (i + 1), modified: iso(i), owner: i % 5 ? "nova-agent" : "root", locked: i === 4, private: name === ".env" || name === "secrets.txt" };
    }) };
  }
  if (pathname.endsWith("/file")) return { ok: true, file: { path: p, kind: "text", size: 54321, modified: iso(1), cut: false, language: "js", text: Array.from({ length: 200 }, (_, i) => `const line${i} = "a long string that runs past the edge of a phone screen and keeps going"; // comment ${i}`).join("\n") } };
  if (pathname.endsWith("/procs")) {
    const groups = ["Nova Bot", "Nova Agent", "Claude", "web", "system"];
    const procs = Array.from({ length: 180 }, (_, i) => ({ pid: 100 + i, name: i % 7 ? `worker-${i}` : "a-very-long-program-name", user: i % 3 ? "nova-agent" : "root", group: groups[i % 5], cpu: Math.round(((180 - i) / 3) * 10) / 10, memory: (180 - i) * 1_000_000, started: iso(i / 10), command: `/usr/bin/node /srv/nova-agent/na/node_modules/.bin/tsx src/visualizer/server.ts --a-long-flag=${"x".repeat(60)}` }));
    return { ok: true, at: iso(0), total: procs.length, memoryTotal: 6442450944, groups: Object.fromEntries(groups.map((g) => [g, { count: 36, cpu: 120.5, memory: 1e9 }])), procs };
  }
  if (pathname.endsWith("/disk")) return { ok: true, path: p, measuring: false, result: { path: p, at: iso(0.1), total: 9e9, partial: true, folders: Array.from({ length: 40 }, (_, i) => ({ name: i === 0 ? "a-very-long-folder-name-that-goes-on-and-on-past-the-edge" : `folder-${i}`, path: `${p.replace(/\/$/, "")}/folder-${i}`, size: Math.round(9e9 / (i + 1)), private: i === 3 })) } };
  return null;
}
