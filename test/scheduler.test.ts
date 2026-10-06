// The Nova Quest planner, on known quests and busy times.  Run: npx tsx test/scheduler.test.ts
import assert from "node:assert/strict";
import { planQuests, toMin } from "../src/quests/scheduler";
import { cleanQuest, DEFAULT_RHYTHM } from "../src/quests/store";

const rhythm = { ...DEFAULT_RHYTHM, wake: "07:30", sleep: "23:30", startUpMinutes: 45, windDownMinutes: 45, bufferMinutes: 10, breakAfterMinutes: 90, breakMinutes: 20, maxQuestHoursPerDay: 6, horizonDays: 14 };
const now = toMin("2026-10-07T07:00"); // a Wednesday, before getting up
const q = (o: any) => cleanQuest({ minutes: 60, created: "2026-10-01T00:00:00Z", ...o });
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log("  ✓", name); };

check("nothing before the day starts (wake 07:30 + 45 min start-up)", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "a" })], busy: [], now });
  assert.equal(r.placed.get("a")!.start, "2026-10-07T08:15");
});

check("dependencies come first, with a buffer between", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "b", dependsOn: ["a"] }), q({ id: "a" })], busy: [], now });
  assert.equal(r.placed.get("a")!.start, "2026-10-07T08:15");
  assert.equal(r.placed.get("b")!.start, "2026-10-07T09:25");
});

check("urgent deadlines and critical quests jump the queue", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "later", created: "2026-09-01T00:00:00Z" }), q({ id: "due", deadline: "2026-10-07T12:00", priority: "critical" })], busy: [], now });
  assert.equal(r.placed.get("due")!.start, "2026-10-07T08:15");
  assert.ok(r.placed.get("later")!.start > r.placed.get("due")!.start);
});

check("calendar entries and blocked time are worked around", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "a", minutes: 90 })], busy: [{ start: "2026-10-07T08:00", end: "2026-10-07T12:00", label: "Session" }], now });
  assert.equal(r.placed.get("a")!.start, "2026-10-07T12:00");
});

check("travel comes before the quest, at the right time", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "a", location: "Camden", travelMinutes: 40 })], busy: [], now });
  const p = r.placed.get("a")!;
  assert.equal(p.travelStart, "2026-10-07T08:15");
  assert.equal(p.start, "2026-10-07T08:55");
});

check("a proper break after a long quest", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "long", minutes: 120, created: "2026-01-01T00:00:00Z" }), q({ id: "next" })], busy: [], now });
  assert.equal(r.placed.get("long")!.end, "2026-10-07T10:15");
  assert.equal(r.placed.get("next")!.start, "2026-10-07T10:35"); // 20 min break, not the 10 min buffer
});

check("preferred time of day is honoured", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "eve", timeOfDay: "evening" }), q({ id: "aft", timeOfDay: "afternoon" })], busy: [], now });
  assert.equal(r.placed.get("aft")!.start, "2026-10-07T12:00");
  assert.equal(r.placed.get("eve")!.start, "2026-10-07T17:00");
});

check("the daily cap spreads work over days", () => {
  const many = Array.from({ length: 8 }, (_, i) => q({ id: `w${i}`, minutes: 60, created: `2026-10-01T00:0${i}:00Z` }));
  const r = planQuests({ rhythm, quests: many, busy: [], now });
  const days = new Set([...r.placed.values()].map((p) => p.start.slice(0, 10)));
  assert.equal(days.size, 2); // 6 hours a day at most
});

check("nothing during sleep: late quests go to the next morning", () => {
  const late = toMin("2026-10-07T22:30");
  const r = planQuests({ rhythm, quests: [q({ id: "a" })], busy: [], now: late });
  assert.equal(r.placed.get("a")!.start, "2026-10-08T08:15");
});

check("pinned quests keep their time; others flow around them", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "pin", fixedStart: "2026-10-07T08:30" }), q({ id: "free" })], busy: [], now });
  assert.equal(r.placed.get("pin")!.start, "2026-10-07T08:30");
  assert.equal(r.placed.get("free")!.start, "2026-10-07T09:40");
});

check("a deadline that can't be met is flagged at risk, not dropped", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "a", minutes: 240, deadline: "2026-10-07T09:00" })], busy: [], now });
  assert.equal(r.placed.get("a")!.atRisk, true);
});

check("too long for any free stretch: explained", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "huge", minutes: 600 })], busy: [], now });
  assert.match(r.unplaced.get("huge")!, /split/);
});

check("finished quests are left alone", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "done", status: "done" }), q({ id: "a" })], busy: [], now });
  assert.ok(!r.placed.has("done"));
  assert.equal(r.placed.get("a")!.start, "2026-10-07T08:15");
});

console.log(`\n${passed} planner checks passed`);
