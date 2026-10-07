// Mission plans: series written out into quests, and quests far beyond the
// usual planning window.  Run: npx tsx test/planner.test.ts
import assert from "node:assert/strict";
import { expandSeries } from "../src/quests/planner";
import { planQuests, toMin } from "../src/quests/scheduler";
import { cleanMission, DEFAULT_RHYTHM } from "../src/quests/store";

let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log("  ✓", name); };

const step = (o: any) => ({ track: "", notes: "", minutes: 60, priority: "high", time_of_day: "any", days_before_due: 0, not_before_days: -1, location: "", travel_minutes: 0, ...o });
const series = {
  name: "Releases",
  track: "Release",
  items: ["Song A", "Song B", "Song C"],
  first_due: "2026-10-10T18:00",
  every_days: 2.5,
  milestone: "Release {item}",
  waits_for: [0],
  steps: [step({ title: "Finish {item}", days_before_due: 2 }), step({ title: "Edit the video for {item}", days_before_due: 1 }), step({ title: "Post {item}", minutes: 15, not_before_days: 0 })],
};

check("each item's steps become quests, chained in order, the first waiting for the series' prerequisite", () => {
  const { quests } = expandSeries(series, "m1", ["gear"]);
  assert.equal(quests.length, 9);
  assert.equal(quests[0].title, "Finish Song A");
  assert.deepEqual(quests[0].dependsOn, ["gear"]);
  assert.deepEqual(quests[1].dependsOn, [quests[0].id]);
  assert.deepEqual(quests[3].dependsOn, ["gear"]); // Song B starts its own chain
  assert.ok(quests.every((q) => q.missionId === "m1" && q.track === "Release"));
});

check("due dates are spaced exactly (every 2.5 days), and steps are due the right days before", () => {
  const { quests, milestones } = expandSeries(series, "m1", []);
  assert.deepEqual(milestones.map((m) => [m.title, m.at]), [["Release Song A", "2026-10-10T18:00"], ["Release Song B", "2026-10-13T06:00"], ["Release Song C", "2026-10-15T18:00"]]);
  assert.equal(quests[0].deadline, "2026-10-08T18:00"); // 2 days before
  assert.equal(quests[2].deadline, "2026-10-10T18:00"); // posted by the release time
  assert.equal(quests[2].earliest, "2026-10-10T00:00"); // and only on the day
  assert.equal(quests[0].earliest, ""); // finishing can start any time
});

check("a mission keeps its strategy, tracks (coloured), milestones and questions", () => {
  const m = cleanMission({ title: "52", strategy: [{ heading: "Release strategy", body: "Every 2.5 days" }, { heading: "", body: "dropped" }], tracks: [{ name: "Music" }, { name: "Content" }], milestones: [{ title: "Gear arrives", at: "2026-10-12" }], questions: ["How many are out?"] });
  assert.equal(m.strategy.length, 1);
  assert.match(m.tracks[1].colour, /^#[0-9A-F]{6}$/i);
  assert.equal(m.milestones[0].at, "2026-10-12T12:00");
  assert.deepEqual(m.questions, ["How many are out?"]);
});

check("quests due months away are planned (with a longer window), not left unplaced", () => {
  const rhythm = { ...DEFAULT_RHYTHM, horizonDays: 21 };
  const q = { minutes: 60, created: "2026-10-01T00:00:00Z", earliest: "2026-12-20T00:00", deadline: "2026-12-24T18:00" };
  const quest = { ...expandSeries({ ...series, items: ["X"], steps: [step({ title: "Do {item}" })] }, "m", []).quests[0], ...q };
  const now = toMin("2026-10-07T07:00");
  const short = planQuests({ rhythm, quests: [quest], busy: [], now });
  assert.ok(short.unplaced.has(quest.id)); // the old 21-day window can't reach it
  const long = planQuests({ rhythm: { ...rhythm, horizonDays: 80 }, quests: [quest], busy: [], now });
  assert.equal(long.placed.get(quest.id)!.start.slice(0, 10), "2026-12-20");
});

check("a quest that can only happen on one day isn't crowded out by important work due weeks later", () => {
  const rhythm = { ...DEFAULT_RHYTHM, maxQuestHoursPerDay: 4, horizonDays: 40 };
  const now = toMin("2026-10-07T07:00");
  const big = Array.from({ length: 30 }, (_, i) => ({ ...expandSeries({ ...series, items: [`B${i}`], steps: [step({ title: "Produce {item}", minutes: 120 })] }, "m", []).quests[0], priority: "critical" as const, deadline: "2026-11-10T18:00", created: "2026-10-01T00:00:00Z" }));
  const reply = { ...big[0], id: "reply", title: "Reply to comments", minutes: 20, priority: "normal" as const, earliest: "2026-10-09T00:00", deadline: "2026-10-09T19:00", dependsOn: [] };
  const r = planQuests({ rhythm, quests: [...big, reply], busy: [], now });
  assert.equal(r.placed.get("reply")!.start.slice(0, 10), "2026-10-09");
  assert.equal(r.placed.get("reply")!.atRisk, false);
});

check("days off stay completely free", () => {
  const rhythm = { ...DEFAULT_RHYTHM, maxQuestHoursPerDay: 2, horizonDays: 14, daysOff: [0] };
  const now = toMin("2026-10-07T07:00"); // a Wednesday
  const qs = Array.from({ length: 12 }, (_, i) => ({ ...expandSeries({ ...series, items: [`S${i}`], steps: [step({ title: "Work on {item}", minutes: 120 })] }, "m", []).quests[0], deadline: "", created: "2026-10-01T00:00:00Z" }));
  const r = planQuests({ rhythm, quests: qs, busy: [], now });
  const days = [...r.placed.values()].map((p) => new Date(p.start.slice(0, 10) + "T12:00:00Z").getUTCDay());
  assert.equal(days.length, 12);
  assert.ok(!days.includes(0)); // nothing on a Sunday
  assert.equal([...r.placed.values()].map((p) => p.start.slice(0, 10)).sort()[4], "2026-10-12"); // Wed–Sat, then straight to Monday
});

console.log(`\n${passed} mission plan checks passed`);
