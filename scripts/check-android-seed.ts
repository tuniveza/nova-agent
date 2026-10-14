// Sample content for scripts/check-android.ts: a throwaway Nova Agent's missions, quests and a
// file, and Calendar's bookings (realistic, not the torture-test long names of check-fit.mjs)
import { mkdirSync, writeFileSync } from "node:fs";

export function seedAndroid(dir: string) {
  const now = new Date().toISOString();
  const day = (n: number, hh = "10:00") => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.toISOString().slice(0, 10)}T${hh}`; };
  const missions = ["Finish the EP by 1 December", "Launch the studio's winter offer", "Mix and master Hunter's single"].map((title, i) => ({
    id: `m${i}`, title, request: title, summary: `${title}: plan, record, mix, release.`, deadline: day(30 + i * 10).slice(0, 10), status: "active",
    strategy: [{ heading: "Plan", body: "Book the sessions, line up the mixes, pick the release date." }],
    tracks: ["Music", "Content", "Release"].map((name) => ({ name, colour: "#ff5fa8" })),
    milestones: Array.from({ length: 4 }, (_, j) => ({ id: `ms${i}${j}`, title: ["Demos done", "Vocals tracked", "Mixes signed off", "Out everywhere"][j], at: day(5 * j + 3, "18:00"), track: "Music", done: j === 0 })),
    assumptions: [], questions: [], refinements: [], research: [], created: now, updated: now,
  }));
  const titles = ["Call Sam about the vocal session", "Drum tracking for Hunter", "Reply to the podcast enquiry", "Post the studio reel", "Bounce rough mixes", "Order new mic cables", "Write the newsletter", "Tidy the live room", "Send the invoice to Avery", "Back up the session drive"];
  const quests = titles.map((title, i) => ({
    id: `q${i}`, missionId: i % 3 ? `m${i % 3}` : "", track: "Music", title, notes: "", minutes: 30 + (i % 3) * 15, priority: ["normal", "high", "low", "urgent"][i % 4],
    deadline: day(2 + i).slice(0, 10), location: "", status: i < 2 ? "done" : "todo",
    start: day(Math.floor(i / 4), `${String(9 + (i % 4) * 2).padStart(2, "0")}:00`), end: day(Math.floor(i / 4), `${String(9 + (i % 4) * 2).padStart(2, "0")}:45`), created: now, updated: now,
  }));
  writeFileSync(`${dir}/quests.json`, JSON.stringify({ version: 1, missions, quests, blocks: [] }, null, 2));
  mkdirSync(`${dir}/files`, { recursive: true });
  const files = [{ id: "f1", name: "session-notes.md", title: "Session notes", type: "md", body: "# Session notes\n\nVocals at 2pm. Bring the Neumann.\n\n- Warm up\n- Three takes\n- Comp" }];
  writeFileSync(`${dir}/files/index.json`, JSON.stringify(files.map(({ body, ...f }) => ({ ...f, size: body.length, source: "chat", created: now, updated: now }))));
  for (const f of files) writeFileSync(`${dir}/files/${f.id}.${f.type}`, f.body);
}
export const calendarItems = () => {
  const day = (n: number, hh: string) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.toISOString().slice(0, 10)}T${hh}`; };
  const names = ["Drum tracking day", "Mix & master: Avery", "Podcast recording", "Hourly studio hire", "Deluxe vocal session", "Band rehearsal", "Hunter's Moon release call"];
  return {
    rev: 1,
    items: names.map((title, i) => ({ id: `e${i}`, kind: "event", title, start: day((i % 7) - 2, `${String(9 + (i % 4) * 2).padStart(2, "0")}:00`), end: day((i % 7) - 2, `${String(10 + (i % 4) * 2).padStart(2, "0")}:30`), notes: "", location: "Studio A", color: "violet", updated: new Date().toISOString() })),
  };
};
