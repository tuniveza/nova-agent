// Taps from Studio ("Session done" and the rest): each counts once, for the
// session it was tapped on.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const water = { id: "water-1234", title: "Drink water", minutes: 5, ongoing: true, every: "interval", everyMinutes: 30, earliest: "2026-10-07T10:00", deadline: "2026-10-07T14:00" };

describe("Studio taps", () => {
  it("the same tap arriving twice counts once", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("6m");
    const tap = { kind: "quest" as const, id: "water-1234", action: "done", tapId: "t1", session: "2026-10-07T10:00" };
    nova.actions.applyQuestTap(tap);
    nova.actions.applyQuestTap(tap);
    expect(nova.quest("water-1234").sessions).toBe(1);
    expect(nova.quest("water-1234").start).toBe("2026-10-07T10:30");
  });

  it("a second 'done' for a session that's already done doesn't use up the next one", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("6m");
    nova.actions.applyQuestTap({ kind: "quest", id: "water-1234", action: "done", tapId: "t1", session: "2026-10-07T10:00" });
    nova.actions.applyQuestTap({ kind: "quest", id: "water-1234", action: "done", tapId: "t2", session: "2026-10-07T10:00" });
    expect(nova.quest("water-1234").sessions).toBe(1);
    await nova.run("30m");
    expect(nova.pings("water-1234", "starting").map((p) => p.at.slice(11, 16))).toEqual(["10:00", "10:30"]);
  });

  it("a 'done' near the deadline for an old session doesn't end the repeat", async () => {
    const nova = await boot("2026-10-07T13:00");
    nova.setQuests({ quests: [{ ...water, earliest: "2026-10-07T13:00" }] });
    nova.start();
    await nova.run("1m");
    nova.actions.applyQuestTap({ kind: "quest", id: "water-1234", action: "done", tapId: "t1", session: "2026-10-07T13:00" });
    await nova.run("30m"); // 13:31: the last session (13:30) is on
    nova.actions.applyQuestTap({ kind: "quest", id: "water-1234", action: "done", tapId: "t2", session: "2026-10-07T13:00" });
    expect(nova.quest("water-1234").status).toBe("todo");
    expect(nova.quest("water-1234").sessions).toBe(1);
  });

  it("taps from before this change (no session, no tap id) still work", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("6m");
    nova.actions.applyQuestTap({ kind: "quest", id: "water-1234", action: "done" });
    expect(nova.quest("water-1234").sessions).toBe(1);
  });

  it("an empty or ambiguous id doesn't pick a quest at random", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water, { ...water, id: "water-5678", title: "Stretch" }] });
    expect(() => nova.actions.applyQuestTap({ kind: "quest", id: "", action: "done" })).toThrow();
    expect(() => nova.actions.applyQuestTap({ kind: "quest", id: "water", action: "done" })).toThrow();
    // A unique start of an id still finds it (Claude often shortens ids)
    expect(nova.actions.applyQuestTap({ kind: "quest", id: "water-12", action: "skip" })).toBe("Drink water");
  });
});
