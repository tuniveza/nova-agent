// The Nova Quest planner, on known quests and busy times.  Run: npx tsx test/scheduler.test.ts
import assert from "node:assert/strict";
import { describeLength, nextSession, splitLong } from "../src/quests/lengths";
import { fromMin, planQuests, toMin } from "../src/quests/scheduler";
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

check("times keep their seconds, and drop them on the minute", () => {
  assert.equal(fromMin(toMin("2026-10-07T08:15:30")), "2026-10-07T08:15:30");
  assert.equal(fromMin(toMin("2026-10-07T08:15")), "2026-10-07T08:15");
  assert.equal(toMin("2026-10-07T08:15:30") - toMin("2026-10-07T08:15"), 0.5);
});

check("a 1-second quest is kept to the second", () => {
  const one = q({ id: "s", minutes: 1 / 60 });
  assert.equal(one.minutes, 1 / 60);
  const r = planQuests({ rhythm, quests: [one], busy: [], now });
  assert.equal(r.placed.get("s")!.start, "2026-10-07T08:15");
  assert.equal(r.placed.get("s")!.end, "2026-10-07T08:15:01");
});

check("quick quests go back to back, to the minute (no buffer)", () => {
  const r = planQuests({ rhythm, quests: [q({ id: "a", minutes: 0.5 }), q({ id: "b", minutes: 2, dependsOn: ["a"] })], busy: [], now });
  assert.equal(r.placed.get("a")!.end, "2026-10-07T08:15:30");
  assert.equal(r.placed.get("b")!.start, "2026-10-07T08:16");
});

check("long quests become sessions, in order, all placed", () => {
  const big = q({ id: "album", title: "Mix the album", minutes: 20 * 60, deadline: "2026-10-20T18:00" });
  const parts = splitLong(big, rhythm);
  assert.equal(parts.length, 7); // 20 h in sessions of at most 3 h
  assert.equal(parts.at(-1)!.id, "album"); // anything waiting for the quest waits for all of it
  assert.equal(parts[1].dependsOn[0], parts[0].id);
  assert.match(parts[0].title, /part 1 of 7/);
  assert.equal(Math.round(parts.reduce((n, p) => n + p.minutes, 0)), 20 * 60);
  const r = planQuests({ rhythm, quests: parts, busy: [], now });
  assert.equal(r.unplaced.size, 0);
  const starts = parts.map((p) => r.placed.get(p.id)!.start);
  assert.deepEqual([...starts].sort(), starts);
  assert.ok(parts.every((p) => !r.placed.get(p.id)!.atRisk));
});

check("an ongoing quest is never split, and its next session follows its rhythm", () => {
  assert.equal(splitLong(q({ id: "o", ongoing: true, minutes: 300 }), rhythm).length, 1);
  assert.equal(nextSession("day", "2026-10-07T09:00"), "2026-10-08T00:00");
  assert.equal(nextSession("weekday", "2026-10-09T09:00"), "2026-10-12T00:00"); // Friday -> Monday
  assert.equal(nextSession("week", "2026-10-07T09:00"), "2026-10-14T00:00");
});

check("lengths read naturally, from seconds to forever", () => {
  assert.equal(describeLength(q({ minutes: 0.5 })), "30 s");
  assert.equal(describeLength(q({ minutes: 2.5 })), "2 min 30 s");
  assert.equal(describeLength(q({ minutes: 90 })), "1 h 30 min");
  assert.equal(describeLength(q({ minutes: 3 * 1440 + 240 })), "3 days 4 h");
  assert.equal(describeLength(q({ minutes: 30, ongoing: true })), "∞ · 30 min a day");
});

check("a daily ongoing quest gets its session today, ahead of big work with no deadline", () => {
  const parts = splitLong(q({ id: "album", minutes: 20 * 60 }), rhythm);
  const r = planQuests({ rhythm, quests: [...parts, q({ id: "warm", minutes: 20, ongoing: true, timeOfDay: "morning" })], busy: [], now });
  assert.equal(r.placed.get("warm")!.start, "2026-10-07T08:15");
});

check("a repeat every 30 seconds keeps exact times, right from now", () => {
  const at = toMin("2026-10-07T10:00:10");
  const r = planQuests({ rhythm, quests: [q({ id: "w", minutes: 1 / 60, ongoing: true, every: "interval", everyMinutes: 0.5, earliest: "2026-10-07T10:00:30" })], busy: [], now: at });
  assert.equal(r.placed.get("w")!.start, "2026-10-07T10:00:30");
  assert.equal(nextSession("interval", "2026-10-07T10:00:30", 0.5), "2026-10-07T10:01");
  // Fell behind: it skips to the next slot from now, in step
  assert.equal(nextSession("interval", "2026-10-07T10:00", 30, toMin("2026-10-07T11:10")), "2026-10-07T11:30");
  assert.equal(describeLength(q({ minutes: 0.5, ongoing: true, every: "interval", everyMinutes: 30 })), "∞ · 30 s every 30 min");
});

check("pace limits off: right away, to the second, back to back", () => {
  const fast = { ...rhythm, paceLimits: false };
  const at = toMin("2026-10-07T10:00:07");
  const r = planQuests({ rhythm: fast, quests: [q({ id: "a", minutes: 45 }), q({ id: "b", minutes: 120, dependsOn: ["a"] })], busy: [], now: at });
  assert.equal(r.placed.get("a")!.start, "2026-10-07T10:00:07");
  assert.equal(r.placed.get("b")!.start, r.placed.get("a")!.end); // no buffer, no break
  // and with them on (the default), the same quest waits for the next 5-minute mark after a few minutes' lead
  assert.equal(planQuests({ rhythm, quests: [q({ id: "a", minutes: 45 })], busy: [], now: at }).placed.get("a")!.start, "2026-10-07T10:10");
});

console.log(`\n${passed} planner checks passed`);
