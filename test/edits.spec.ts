// P0-2: every edit persists, or says clearly why it didn't.  Run: npm test
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const water = { id: "water", title: "Drink water", minutes: 5, ongoing: true, every: "interval", everyMinutes: 30, earliest: "2026-10-07T10:00", deadline: "2026-10-07T14:00" };
const mix = { id: "mix", title: "Mix the EP", minutes: 120 };

describe("quest edits", () => {
  it("a time it can't read is refused with a clear error, and nothing changes", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    expect(() => nova.actions.updateQuest("mix", { deadline: "next Friday" })).toThrow(/time|date/i);
    expect(() => nova.actions.updateQuest("mix", { fixedStart: "17:00" })).toThrow(/time|date/i);
    expect(nova.quest("mix").deadline).toBe("");
  });

  it("common ways of writing a time are understood (UK time)", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    nova.actions.updateQuest("mix", { fixedStart: "2026-10-08 17:00" });
    expect(nova.quest("mix").fixedStart).toBe("2026-10-08T17:00");
    // A UTC time ("Z") is turned into UK time: 16:00 UTC is 17:00 BST
    nova.actions.updateQuest("mix", { deadline: "2026-10-09T16:00:00Z" });
    expect(nova.quest("mix").deadline).toBe("2026-10-09T17:00");
  });

  it("a field that can't be edited, or a value that doesn't fit, is refused rather than dropped", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    expect(() => nova.actions.updateQuest("mix", { sessions: 9 } as any)).toThrow(/can't be changed/);
    expect(() => nova.actions.updateQuest("mix", { title: "x".repeat(200) })).toThrow(/too long/);
    expect(() => nova.actions.updateQuest("mix", { priority: "urgent" } as any)).toThrow(/priority/);
    expect(nova.quest("mix").title).toBe("Mix the EP");
  });

  it("an edit to a repeat sticks through its sessions moving on", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("10m");
    nova.actions.updateQuest("water", { everyMinutes: 45, title: "Drink a glass of water" });
    await nova.run("2h");
    expect(nova.quest("water")).toMatchObject({ everyMinutes: 45, title: "Drink a glass of water" });
    expect(nova.pings("water", "starting").map((p) => p.at.slice(11, 16))).toEqual(["10:00", "10:45", "11:30"]);
  });

  it("100 rapid edits in a row all persist, with the reminders running", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water, mix] });
    nova.start();
    for (let i = 1; i <= 100; i++) {
      const q = nova.actions.updateQuest(i % 2 ? "water" : "mix", { notes: `edit ${i}`, priority: i % 3 ? "high" : "low" });
      expect(q.notes).toBe(`edit ${i}`);
      expect(nova.quest(q.id).notes).toBe(`edit ${i}`);
      await nova.run("7s"); // the 10-second tick and re-plans in between
    }
    expect(nova.quest("water").notes).toBe("edit 99");
    expect(nova.quest("mix").notes).toBe("edit 100");
    expect(nova.quest("mix").priority).toBe("high"); // the last edit: 100 % 3 is 1
  });
});

describe("the quests file", () => {
  it("a damaged quests.json isn't read as empty and saved over: the last good copy is used, and it says so", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    nova.actions.updateQuest("mix", { notes: "keep me" });
    const file = `${process.env.NOVA_DATA_DIR}/quests.json`;
    writeFileSync(file, '{"quests": [ {"id": "mix", "tit');
    const data = nova.store.readQuests();
    expect(data.quests.map((q) => q.id)).toEqual(["mix"]);
    expect(data.quests[0].notes).toBe("keep me");
    // The damaged file is kept to look at
    expect(readdirSync(process.env.NOVA_DATA_DIR!).some((f) => f.startsWith("quests.json.damaged-"))).toBe(true);
    // And saving works again, from the good copy
    nova.actions.updateQuest("mix", { notes: "still here" });
    expect(JSON.parse(readFileSync(file, "utf8")).quests[0].notes).toBe("still here");
    expect(existsSync(`${file}.bak`)).toBe(true);
  });
});
