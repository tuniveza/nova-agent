// The planner with quests far beyond the usual planning window, one-day quests among
// big work, and days off.  Run: npx tsx test/planner.test.ts
// (Mission plans went from Nova on 23 Oct 2026: a big goal is now planned straight into quests.)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planQuests, toMin } from "../src/quests/scheduler";
import { cleanQuest, DEFAULT_RHYTHM } from "../src/quests/store";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log("  ✓", name); };

// A plain quest, as quest_add makes one
const quest = (title: string, o: any = {}) => cleanQuest({ id: randomUUID(), title, minutes: 60, priority: "high", ...o });

check("quests due months away are planned (with a longer window), not left unplaced", () => {
  const rhythm = { ...DEFAULT_RHYTHM, horizonDays: 21 };
  const q = { minutes: 60, created: "2026-10-01T00:00:00Z", earliest: "2026-12-20T00:00", deadline: "2026-12-24T18:00" };
  const one = quest("Do X", q);
  const now = toMin("2026-10-07T07:00");
  const short = planQuests({ rhythm, quests: [one], busy: [], now });
  assert.ok(short.unplaced.has(one.id)); // the old 21-day window can't reach it
  const long = planQuests({ rhythm: { ...rhythm, horizonDays: 80 }, quests: [one], busy: [], now });
  assert.equal(long.placed.get(one.id)!.start.slice(0, 10), "2026-12-20");
});

check("a quest that can only happen on one day isn't crowded out by important work due weeks later", () => {
  const rhythm = { ...DEFAULT_RHYTHM, maxQuestHoursPerDay: 4, horizonDays: 40 };
  const now = toMin("2026-10-07T07:00");
  const big = Array.from({ length: 30 }, (_, i) => quest(`Produce B${i}`, { minutes: 120, priority: "critical", deadline: "2026-11-10T18:00", created: "2026-10-01T00:00:00Z" }));
  const reply = { ...big[0], id: "reply", title: "Reply to comments", minutes: 20, priority: "normal" as const, earliest: "2026-10-09T00:00", deadline: "2026-10-09T19:00", dependsOn: [] };
  const r = planQuests({ rhythm, quests: [...big, reply], busy: [], now });
  assert.equal(r.placed.get("reply")!.start.slice(0, 10), "2026-10-09");
  assert.equal(r.placed.get("reply")!.atRisk, false);
});

check("days off stay completely free", () => {
  const rhythm = { ...DEFAULT_RHYTHM, maxQuestHoursPerDay: 2, horizonDays: 14, daysOff: [0] };
  const now = toMin("2026-10-07T07:00"); // a Wednesday
  const qs = Array.from({ length: 12 }, (_, i) => quest(`Work on S${i}`, { minutes: 120, deadline: "", created: "2026-10-01T00:00:00Z" }));
  const r = planQuests({ rhythm, quests: qs, busy: [], now });
  const days = [...r.placed.values()].map((p) => new Date(p.start.slice(0, 10) + "T12:00:00Z").getUTCDay());
  assert.equal(days.length, 12);
  assert.ok(!days.includes(0)); // nothing on a Sunday
  assert.equal([...r.placed.values()].map((p) => p.start.slice(0, 10)).sort()[4], "2026-10-12"); // Wed–Sat, then straight to Monday
});

console.log(`\n${passed} planner checks passed`);
