// Missions went from Nova on 23 Oct 2026 (the owner: "missions should be gone from the entire nova
// suite"). Nothing makes, refines, exports, shows or announces one any more; a big goal is planned
// straight into quests. Missions already saved stay in quests.json untouched, and the quests that
// came from them are ordinary quests.  Run: npm test
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// A quests.json from before: a paused mission with a milestone, and two of its quests
async function withOldMission(at = "2026-10-07T09:00") {
  const nova = await boot(at);
  const file = `${process.env.NOVA_DATA_DIR}/quests.json`;
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      rhythm: { wake: "07:00", sleep: "23:30", remindMinutesBefore: 0, dailyBriefing: false, paceLimits: false, phonePush: true },
      missions: [{ id: "m1", owner: "", title: "Release the EP", status: "paused", milestones: [{ id: "ms1", title: "EP out", at: "2026-10-20T12:00" }], created: "2026-10-01T00:00:00Z", updated: "2026-10-01T00:00:00Z" }],
      quests: [
        { id: "q1", owner: "", missionId: "m1", track: "Music", title: "Mix the EP", minutes: 60, created: "2026-10-01T00:00:00Z" },
        { id: "q2", owner: "", missionId: "m1", track: "Music", title: "Master the EP", minutes: 30, created: "2026-10-01T00:00:00Z" },
      ],
      blocks: [],
    }),
  );
  return { nova, file };
}

describe("Missions are gone", () => {
  it("Agent has no mission tools, and its prompt says to plan a big goal straight into quests", async () => {
    await boot("2026-10-07T09:00");
    const { questTools, systemPrompt } = await import("../src/chat");
    const names = questTools([]).map((t: { name: string }) => t.name);
    expect(names.filter((n: string) => n.startsWith("mission"))).toEqual([]);
    expect(names).toEqual(expect.arrayContaining(["quest_add", "quest_update", "quest_status", "quests_list", "what_now"]));
    const add = questTools([]).find((t: { name: string }) => t.name === "quest_add") as any;
    expect(JSON.stringify(add.input_schema ?? add.inputSchema ?? {})).not.toContain("mission");
    const prompt = systemPrompt();
    expect(prompt).not.toMatch(/mission_(create|refine|export|details|update)/);
    expect(prompt).toContain("A big goal is planned straight into Quests");
    expect(prompt).toContain("There are no Missions in Nova any more");
    // Every tool the chat hands Claude
    const chat = read("../src/chat.ts");
    expect(chat).not.toMatch(/name: "mission_/);
  });

  it("a saved mission's quests are ordinary quests: planned (even though it was paused), tapped, finished", async () => {
    const { nova, file } = await withOldMission();
    nova.plan.replan();
    expect(nova.quest("q1").start).not.toBe("");
    expect(nova.quest("q2").start).not.toBe("");
    // The page's and Portal's state have no missions
    const st = nova.actions.questState({ id: "owner", everyone: true });
    expect(st).not.toHaveProperty("missions");
    expect(st.quests.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
    // A Portal tap works on them; one on the mission is turned away
    nova.actions.applyQuestTap({ kind: "quest", id: "q1", action: "done" });
    expect(() => nova.actions.applyQuestTap({ kind: "mission", id: "m1", action: "resume" })).toThrow();
    nova.actions.setQuestStatus("q2", "done");
    expect(nova.quest("q1").status).toBe("done");
    expect(nova.quest("q2").status).toBe("done");
    // Kept: the mission is still saved as it was (not finished, not removed), and no mission news went out
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.missions.map((m: { id: string; status: string }) => [m.id, m.status])).toEqual([["m1", "paused"]]);
    expect(saved.quests.every((q: { missionId: string }) => q.missionId === "m1")).toBe(true);
    await nova.run("1m");
    expect(nova.sent.filter((p) => p.kind === "mission" || /mission/i.test(p.title))).toEqual([]);
  });

  it("Calendar shows the quests as quests, and no mission milestones", async () => {
    const { nova } = await withOldMission();
    nova.plan.replan();
    const notes = nova.calendar.readCalendar().notes;
    expect(notes.some((n) => n.id.startsWith("mile-"))).toBe(false);
    const mix = notes.find((n) => n.id === "quest-q1")!;
    expect(mix.body.split("\n")[0]).toBe("Quest");
    expect(JSON.stringify(notes)).not.toMatch(/Mission/);
  });

  it("Portal's copy of the plan has no missions", async () => {
    const { nova } = await withOldMission();
    nova.plan.replan();
    const { snapshot } = await import("../src/quests/portalsync");
    const snap = snapshot();
    expect(snap).not.toHaveProperty("missions");
    expect(snap.quests.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });

  it("the mission addresses are gone, here and over the online link", async () => {
    const server = read("../src/visualizer/server.ts");
    expect(server).not.toContain("/actions/missions");
    expect(server).not.toMatch(/createMission|refineMission|missionMarkdown|setMilestone|updateMission|removeMission/);
    const relay = read("../src/relay.ts");
    expect(relay).not.toContain("missions");
    expect(relay).not.toContain("(refine|export)");
  });
});
