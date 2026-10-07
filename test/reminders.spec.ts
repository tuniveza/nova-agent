// Quest reminders on a simulated clock.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

// "Drink water every 30 minutes from 10:00 until 14:00": 8 sessions
const water = { id: "water", title: "Drink water", minutes: 5, ongoing: true, every: "interval", everyMinutes: 30, earliest: "2026-10-07T10:00", deadline: "2026-10-07T14:00" };

describe("repeating reminders", () => {
  it("a reminder every 30 minutes for 4 hours pings exactly 8 times", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("4h10m");
    const pings = nova.pings("water", "starting");
    expect(pings.map((p) => p.at.slice(11, 16))).toEqual(["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"]);
    expect(nova.quest("water").status).toBe("done");
  });

  it("pings each session once, however often the plan is redone", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    for (let i = 0; i < 25; i++) {
      await nova.run("10m");
      nova.plan.replan();
    }
    expect(nova.pings("water", "starting")).toHaveLength(8);
  });
});

describe("pulses (repeats under 5 minutes)", () => {
  it("beat on their own timer, and each beat replaces the last on the phone", async () => {
    const nova = await boot("2026-10-07T10:00");
    nova.setQuests({ quests: [{ id: "breathe", title: "Breathe", minutes: 1 / 60, ongoing: true, every: "interval", everyMinutes: 2, earliest: "2026-10-07T10:00", deadline: "2026-10-07T10:10" }] });
    nova.start();
    await nova.run("12m");
    const beats = nova.pings("breathe", "pulse");
    expect(beats.map((p) => p.at.slice(11, 16))).toEqual(["10:00", "10:02", "10:04", "10:06", "10:08"]);
    expect(beats.every((p) => p.keep === false)).toBe(true);
    // Pulses never take slots in the plan
    expect(nova.quest("breathe").start).toBe("");
  });
});
