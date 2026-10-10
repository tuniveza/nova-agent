// Quest modes: how a quest is going (the same in Notes, Nova Agent and Portal), and the status each means.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const mix = { id: "mix", title: "Mix the EP", minutes: 60 };

describe("quest modes", () => {
  it("a quest has a mode from its status, even one saved before modes", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix, { id: "old", title: "Old one", minutes: 10, status: "done" }] });
    expect(nova.quest("mix").mode).toBe("waiting");
    expect(nova.quest("old").mode).toBe("done");
  });

  it("each mode sets the status it means, and back", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    nova.actions.setQuestMode("mix", "soon");
    expect(nova.quest("mix")).toMatchObject({ mode: "soon", status: "todo" });
    nova.actions.setQuestMode("mix", "nearly");
    expect(nova.quest("mix")).toMatchObject({ mode: "nearly", status: "doing" });
    nova.actions.setQuestMode("mix", "longer");
    expect(nova.quest("mix")).toMatchObject({ mode: "longer", status: "doing" });
    nova.actions.setQuestMode("mix", "done");
    expect(nova.quest("mix")).toMatchObject({ mode: "done", status: "done" });
    nova.actions.setQuestMode("mix", "questions");
    expect(nova.quest("mix")).toMatchObject({ mode: "questions", status: "todo" });
    expect(() => nova.actions.setQuestMode("mix", "wait")).toThrow(/mode must be one of/);
  });

  it("marking it done or started elsewhere moves the mode too", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    nova.actions.setQuestStatus("mix", "doing");
    expect(nova.quest("mix").mode).toBe("working");
    nova.actions.setQuestStatus("mix", "done");
    expect(nova.quest("mix").mode).toBe("done");
    nova.actions.setQuestStatus("mix", "todo");
    expect(nova.quest("mix").mode).toBe("waiting");
  });

  it("a quest from Notes keeps where it came from and what it's tied to; its mode changes through an edit", async () => {
    const nova = await boot("2026-10-07T09:00");
    const q = nova.actions.addQuest({ title: "QUEST: book the mastering", from: "Notes · EP plan", link: "note:n1|h1", mode: "soon" } as any);
    expect(q).toMatchObject({ from: "Notes · EP plan", link: "note:n1|h1", mode: "soon", status: "todo" });
    nova.actions.updateQuest(q.id, { mode: "working", title: "QUEST: book mastering" } as any);
    expect(nova.quest(q.id)).toMatchObject({ mode: "working", status: "doing", title: "QUEST: book mastering" });
  });
});
