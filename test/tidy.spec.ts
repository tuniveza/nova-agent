// Test stuff on the PC (src/tidy.ts, src/tidy-routes.ts): which quests, calendar notes, Fixer jobs
// and files look like tests (and which never do), deleting through each one's own way with a copy
// in the bin, putting back, "Not a test", admins only, and Agent's read-only tool.  Run: npm test
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

function quest(over: Record<string, unknown>) {
  return { id: String(over.id), owner: "", missionId: "", title: "A quest", notes: "", minutes: 30, status: "todo", created: ago(72), updated: ago(72), completed: "", from: "", ...over };
}

beforeEach(() => {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-tidy-"));
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("finding test stuff on the PC", () => {
  const find = async (over: Record<string, unknown>) => {
    const { findPcTestStuff } = await import("../src/tidy");
    return findPcTestStuff({ quests: [], missions: [], notes: [], jobs: [], issues: [], fixerQuests: [], files: [], real: [], ...over } as any);
  };

  it("catches the studio's own test quests, and leaves real ones alone", async () => {
    const items = await find({
      quests: [
        quest({ id: "fart", title: "Fart 💨", minutes: 5 / 60, status: "done", completed: ago(70) }),
        quest({ id: "wee", title: "Go for a wee", minutes: 0.5, status: "done", completed: ago(70) }),
        quest({ id: "beast", title: "You are a filthy beast 🐗", minutes: 0.5, notes: "Shower", status: "done", completed: ago(70) }),
        quest({ id: "guitar", title: "Use a guitar", minutes: 0.5, status: "done", created: ago(48), completed: new Date(Date.now() - 48 * HOUR + 2 * 60_000).toISOString() }),
        quest({ id: "fire", title: "Make fire", minutes: 5, status: "done", completed: ago(60) }),
        quest({ id: "plan", title: "Check SoundCloud plan and upload limit", minutes: 15, status: "done", created: ago(48), completed: new Date(Date.now() - 48 * HOUR + 13 * 60_000).toISOString() }),
        quest({ id: "p1", title: "Pilot: release 3 songs (part 1 of 4)", notes: "Test the release workflow first", status: "skipped" }),
        quest({ id: "p2", title: "Pilot: release 3 songs (part 2 of 4)", notes: "Test the release workflow first", status: "skipped" }),
        quest({ id: "sleep", title: "Go to sleep", minutes: 10 / 60, notes: "Phone down, lights off", status: "done", created: ago(50), completed: ago(50) }),
      ],
    });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.fart.confidence).toBe("likely");
    expect(by.wee.confidence).toBe("likely");
    expect(by.beast.reasons[0].text).toMatch(/filthy/);
    expect(by.guitar.confidence).toBe("likely");
    expect(by.fire.confidence).toBe("maybe");
    expect(by.plan).toBeUndefined();
    expect(by.p1).toBeUndefined(); // a quest's plan saying "test" isn't a test, and parts aren't copies
    expect(by.p2).toBeUndefined();
    expect(by.sleep).toBeUndefined();
  });

  it("copies of a quest: the one in progress stays", async () => {
    const items = await find({
      quests: [
        quest({ id: "keep", title: "Quest 4 – Social media manager (phase 2)", status: "doing", notes: "plan" }),
        quest({ id: "copy1", title: "Quest 4 - Social Media Manager Issues", status: "skipped", notes: "plan", created: ago(10), updated: ago(10) }),
        quest({ id: "copy2", title: "Quest 4 - Social Media Manager Issues", status: "todo", notes: "plan", created: ago(9), updated: ago(9) }),
        quest({ id: "early", title: "Quest 4", status: "skipped", created: ago(11), updated: ago(11) }),
      ],
    });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.keep).toBeUndefined();
    expect(by.copy1.reasons[0].text).toMatch(/A copy of/);
    expect(by.copy1.confidence).toBe("likely");
    expect(by.copy2.confidence).toBe("maybe"); // only "very like" the one in progress
    expect(by.early.confidence).toBe("likely");
  });

  it("calendar notes, stale Fixer jobs and copied files", async () => {
    const items = await find({
      notes: [
        { id: "n1", title: "Testing to see if this is sent to your phone?", body: "", author: "", start: "2026-10-09T14:00", end: "", created: ago(80), updated: ago(80) },
        { id: "n2", title: "Engineer Guy is Coming", body: "", author: "", start: "2026-10-14T10:00", end: "", created: ago(80), updated: ago(80) },
        { id: "quest-x", title: "✓ Fart 💨", body: "", author: "", start: "2026-10-09T14:00", end: "", created: ago(80), updated: ago(80) },
      ],
      jobs: [
        { id: "j1", status: "blocked", target: { type: "issue", id: "i-old", title: "Notes at 390px: a file didn't load: /staff/x/planet.svg (404)" }, created: ago(30), updated: ago(30) },
        { id: "j2", status: "done", target: { type: "issue", id: "i-2", title: "Index at 390px: a file didn't load: /staff/x/planet.svg (404)" }, created: ago(31), updated: ago(31) },
        { id: "j3", status: "blocked", target: { type: "issue", id: "i-live", title: "Calendar at 390px: something sticks out" }, created: ago(3), updated: ago(3) },
        { id: "j4", status: "failed", target: { type: "quest", id: "q-open", title: "QUEST: Fixing UI Issues" }, created: ago(3), updated: ago(3) },
      ],
      issues: [{ id: "i-live" }],
      fixerQuests: [{ id: "q-open", status: "open" }],
      files: [
        { entry: { id: "f1", name: "plan.md", title: "Plan", type: "md", size: 1, source: "chat", created: ago(5), updated: ago(5) }, hash: "h" },
        { entry: { id: "f2", name: "plan-2.md", title: "Plan", type: "md", size: 1, source: "chat", created: ago(1), updated: ago(1) }, hash: "h" },
      ],
    });
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by["calnote:n1"].confidence).toBe("likely");
    expect(by["calnote:n2"]).toBeUndefined();
    expect(by["calnote:quest-x"]).toBeUndefined(); // a quest's own card follows its quest
    expect(by["fixer:j1"].reasons[0].text).toBe("Fixed by another fix since");
    expect(by["fixer:j3"]).toBeUndefined();
    expect(by["fixer:j4"]).toBeUndefined(); // its Fixer quest is still open
    expect(by["file:f1"].reasons[0].text).toBe("The same as “plan-2.md”");
    expect(by["file:f2"]).toBeUndefined();
  });

  it("never shows what an admin said isn't a test", async () => {
    expect(await find({ quests: [quest({ id: "fart", title: "Fart" })], real: ["quest:fart"] })).toEqual([]);
  });
});

describe("deleting, putting back and Not a test (through the PC's addresses)", () => {
  async function app() {
    const { writeQuests, readQuests } = await import("../src/quests/store");
    const { addNote, readCalendar } = await import("../src/calendar/store");
    const data = readQuests();
    data.quests.push(quest({ id: "fart", title: "Fart 💨", minutes: 5 / 60, status: "done", completed: ago(70) }) as any, quest({ id: "real", title: "Vocal warm-ups", notes: "Every morning" }) as any);
    writeQuests(data);
    const note = addNote({ title: "Testing to see if this is sent to your phone?", start: "2026-10-09T14:00" });
    const rejected: string[] = [];
    const fixer = {
      state: () => ({ issues: [], quests: [], working: [{ id: "j1", status: "blocked", target: { type: "issue", id: "gone", title: "Notes at 390px: x" }, created: ago(5), updated: ago(5) }], done: [], needsYou: [] }),
      reject: (id: string) => rejected.push(id),
    };
    const { registerTidyRoutes } = await import("../src/tidy-routes");
    const hono = new Hono();
    registerTidyRoutes(hono, () => fixer as any);
    const local = { host: "localhost:4545", origin: "http://localhost:4545" };
    const call = (path: string, body?: unknown, headers: Record<string, string> = local) =>
      hono.request(path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { call, note, rejected, readQuests, readCalendar };
  }

  it("is for admins: this computer's page, or an admin online", async () => {
    const { call } = await app();
    expect((await call("/tidy-api/state", undefined, { host: "nova.example" })).status).toBe(403);
    // A request from another website on this computer
    expect((await call("/actions/tidy/delete", { items: [] }, { host: "localhost:4545", origin: "http://evil.example" })).status).toBe(403);
    expect((await call("/tidy-api/state")).status).toBe(200);
  });

  it("deletes a quest, a calendar note and a Fixer job, and puts the quest and note back", async () => {
    const { call, note, rejected, readQuests, readCalendar } = await app();
    const state = await (await call("/tidy-api/state")).json();
    const keys = state.items.map((i: any) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["quest:fart", `calnote:${note.id}`, "fixer:j1"]));
    expect(keys).not.toContain("quest:real");

    const del = await (await call("/actions/tidy/delete", { items: state.items.map((i: any) => ({ key: i.key, title: i.title })) })).json();
    expect(del.failed).toEqual([]);
    expect(readQuests().quests.map((q) => q.id)).toEqual(["real"]);
    expect(readCalendar().notes.some((n) => n.id === note.id)).toBe(false);
    expect(rejected).toEqual(["j1"]);

    const after = await (await call("/tidy-api/state")).json();
    expect(after.recent).toHaveLength(3);
    const quest = after.recent.find((r: any) => r.key === "quest:fart");
    const cal = after.recent.find((r: any) => r.kind === "calnote");
    const job = after.recent.find((r: any) => r.kind === "fixer");
    expect(job.noRestore).toBe(true);
    expect((await (await call("/actions/tidy/restore", { binId: quest.binId })).json()).ok).toBe(true);
    expect((await (await call("/actions/tidy/restore", { binId: cal.binId })).json()).ok).toBe(true);
    expect(readQuests().quests.map((q) => q.id).sort()).toEqual(["fart", "real"]);
    expect(readCalendar().notes.some((n) => n.id === note.id)).toBe(true);
    expect((await call("/actions/tidy/restore", { binId: quest.binId })).status).toBe(400);
    expect((await call("/actions/tidy/restore", { binId: job.binId })).status).toBe(400);
  });

  it("Not a test is remembered until Undo", async () => {
    const { call } = await app();
    await call("/actions/tidy/real", { key: "quest:fart", title: "Fart" });
    let state = await (await call("/tidy-api/state")).json();
    expect(state.items.map((i: any) => i.key)).not.toContain("quest:fart");
    expect(state.real.map((r: any) => r.key)).toEqual(["quest:fart"]);
    await call("/actions/tidy/unreal", { key: "quest:fart" });
    state = await (await call("/tidy-api/state")).json();
    expect(state.items.map((i: any) => i.key)).toContain("quest:fart");
  });
});

describe("Agent's test_stuff_list", () => {
  it("reads both lists and has nothing that deletes", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(new URL(url).pathname);
      return Response.json({ counts: { likely: 1, maybe: 0 }, items: [{ kind: "Website chat", title: "“record your mum”", confidence: "likely", reasons: ["Rude or joke words"] }] });
    });
    const { writeQuests, readQuests } = await import("../src/quests/store");
    const data = readQuests();
    data.quests.push(quest({ id: "fart", title: "Fart" }) as any);
    writeQuests(data);
    const { tidyTools } = await import("../src/tidy-agent");
    const actions: any[] = [];
    const tools = tidyTools(actions);
    expect(tools.map((t: any) => t.name)).toEqual(["test_stuff_list"]);
    const text = await (tools[0] as any).run({});
    expect(text).toMatch(/record your mum/);
    expect(text).toMatch(/Quest: Fart/);
    expect(asked).toEqual(["/nova-agent/tidy"]);
  });
});
