// P0-2: re-planning a mission doesn't throw away quests changed by hand.  Run: npm test
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, shutdown } from "./harness";

// Claude's plans, made up: the first plan, then the re-plan
const prompts: string[] = [];
let next: any;
vi.mock("../src/llm", () => ({
  askWithResearch: vi.fn(async (o: { prompt: string }) => {
    prompts.push(o.prompt);
    return { answer: next, sources: [] };
  }),
  askForJson: vi.fn(),
}));

const quest = (title: string, extra: any = {}) => ({ title, notes: "", track: "Music", minutes: 60, ongoing: false, every: "day", every_minutes: 0, priority: "normal", deadline: "", earliest: "", depends_on: [], location: "", travel_minutes: 0, time_of_day: "any", fixed_start: "", ...extra });
const plan = (quests: any[]) => ({ title: "Finish the single", summary: "", deadline: "2026-10-30", tracks: ["Music"], strategy: [], milestones: [], assumptions: [], questions: [], research: [], days_off: [], series: [], quests });

afterEach(shutdown);

describe("re-planning a mission", () => {
  it("keeps the quests changed by hand, tells Claude about them, and replaces the rest", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [] });
    next = plan([quest("Record vocals"), quest("Mix the single")]);
    const { mission, quests } = await (await import("../src/quests/planner")).createMission("Finish my single by the end of the month");
    const mix = quests.find((q) => q.title === "Mix the single")!;
    const vocals = quests.find((q) => q.title === "Record vocals")!;
    nova.actions.updateQuest(mix.id, { notes: "Use the new reverb", fixedStart: "2026-10-10T14:00" });

    next = plan([quest("Record vocals and doubles"), quest("Master the single")]);
    await (await import("../src/quests/planner")).refineMission(mission.id, "I want doubles on the vocals, and it needs mastering");

    const now = nova.store.readQuests().quests.filter((q) => q.missionId === mission.id);
    expect(now.map((q) => q.title).sort()).toEqual(["Master the single", "Mix the single", "Record vocals and doubles"]);
    expect(now.find((q) => q.id === mix.id)).toMatchObject({ notes: "Use the new reverb", fixedStart: "2026-10-10T14:00" });
    expect(now.some((q) => q.id === vocals.id)).toBe(false);
    expect(prompts.at(-1)).toContain("Mix the single");
  });
});
