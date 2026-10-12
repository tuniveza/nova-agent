// Google on the PC's side (src/google.ts, src/google-agent.ts): copies in Drive only when Google is
// connected, the nightly file backup, and Agent's read-only tools.  Run: npm test
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; body: unknown; type: string };
let calls: Call[];
let status: { connected: boolean; drive: boolean; backups: boolean; files?: boolean; tasks?: boolean };
let tasksAnswer: unknown = { ok: true, completed: [] };

beforeEach(() => {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-google-")) + "/";
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  calls = [];
  status = { connected: true, drive: true, backups: true, files: true, tasks: true };
  tasksAnswer = { ok: true, completed: [] };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const type = String((init.headers as Record<string, string>)["Content-Type"] || "");
    const body = typeof init.body === "string" ? JSON.parse(init.body || "{}") : init.body;
    calls.push({ url, body, type });
    const path = new URL(url).pathname;
    const answer = (data: unknown, s = 200) => new Response(JSON.stringify(data), { status: s, headers: { "Content-Type": "application/json" } });
    if (path === "/nova-agent/google/status") return answer(status);
    if (path === "/nova-agent/google/drive/put") return answer({ ok: true, fileId: "f1" });
    if (path === "/nova-agent/google/busy") return answer({ busy: [{ start: "2026-11-02T10:00:00Z", end: "2026-11-02T11:00:00Z" }] });
    if (path === "/nova-agent/google/gmail/search") return answer({ messages: [{ from: "Kai <kai@example.com>", subject: "Thursday", date: "2026-10-12T09:00:00Z", snippet: "Works for me" }] });
    if (path === "/nova-agent/google/contacts/find") return answer({ error: "Google isn't connected for that yet (Portal → Admin → Google)." }, 409);
    if (path === "/nova-agent/google/tasks/sync") return answer(tasksAnswer);
    if (path === "/nova-agent/google/tasks/list") return answer({ tasks: [{ list: "Nova quests", title: "Mix the EP", due: "2026-11-01", notes: "Planned Sat" }] });
    if (path === "/nova-agent/google/drive/search") return answer({ files: [{ id: "d1", name: "Rider", kind: "Google Doc", modified: "2026-10-10T10:00:00Z", url: "https://docs.google.com/document/d/d1" }] });
    if (path === "/nova-agent/google/doc/read") return answer({ name: "Rider", url: "https://docs.google.com/document/d/d1", text: "Two vocal mics", cut: false });
    if (path === "/nova-agent/google/youtube/stats") return answer({ channel: { title: "Novacane Studios", subscribers: 321, views: 9000, videos: 14, before: { subscribers: 300, day: "2026-10-11" } }, videos: [{ title: "Night Drive", url: "https://youtu.be/v1", published: "2026-10-01T00:00:00Z", views: 120, likes: 9, comments: 2 }] });
    return answer({ error: "nope" }, 404);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("copies in Google Drive", () => {
  it("sends a picture's copy when Google and Drive are on, and nothing when they're not", async () => {
    const { copyToDrive, forgetGoogleStatus } = await import("../src/google");
    expect(await copyToDrive("media", "a".repeat(32), "cover.jpg", "image/jpeg", new Uint8Array([1, 2, 3]))).toBe(true);
    const put = calls.find((c) => c.url.includes("/drive/put"))!;
    expect(put.url).toContain("kind=media");
    expect(put.type).toBe("image/jpeg");
    forgetGoogleStatus();
    status = { connected: false, drive: false, backups: false };
    calls = [];
    expect(await copyToDrive("receipt", "r-20261012-0123456789", "r", "image/png", new Uint8Array([1]))).toBe(false);
    expect(calls.some((c) => c.url.includes("/drive/put"))).toBe(false);
  });

  it("backs up this computer's files by name every night", async () => {
    const dir = `${process.env.NOVA_DATA_DIR}files/`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}abc.md`, "# Plan");
    writeFileSync(`${dir}index.json`, JSON.stringify([{ id: "abc", name: "release-plan.md" }]));
    writeFileSync(`${dir}notes.exe`, "no");
    const { backupFilesToDrive } = await import("../src/google");
    expect(await backupFilesToDrive()).toBe(2);
    const names = calls.filter((c) => c.url.includes("/drive/put")).map((c) => new URL(c.url).searchParams.get("name")).sort();
    expect(names).toEqual(["files-index.json", "release-plan.md"]);
  });
});

describe("Agent's Google tools: read only", () => {
  it("shows busy times in UK time, emails as snippets, and says plainly when Google isn't connected", async () => {
    const { googleTools } = await import("../src/google-agent");
    const actions: { kind: string; text: string }[] = [];
    const tools = googleTools({ push: (a) => actions.push(a) });
    expect(tools.map((t) => t.name).sort()).toEqual(["gmail_search", "google_calendar_busy", "google_contacts_find", "google_doc_read", "google_drive_search", "google_tasks_list", "youtube_stats"]);
    const run = (name: string, input: unknown) => (tools.find((t) => t.name === name) as any).run(input);
    expect(await run("google_calendar_busy", { from: "2026-11-01", to: "2026-11-05" })).toContain("10:00");
    expect(await run("gmail_search", { q: "from:kai@example.com" })).toContain('"Thursday": Works for me');
    expect(await run("google_contacts_find", { q: "Kai" })).toMatch(/Couldn't ask Google: Google isn't connected/);
    expect(await run("google_drive_search", { q: "Rider" })).toContain("Rider (Google Doc");
    expect(await run("google_doc_read", { id: "https://docs.google.com/document/d/d1" })).toContain("Two vocal mics");
    expect(await run("google_tasks_list", {})).toContain("[Nova quests] Mix the EP · due 2026-11-01");
    expect(await run("youtube_stats", {})).toMatch(/321 subscribers \(\+21 since 2026-10-11\).*\n- "Night Drive".*120 views/);
    // No tool sends, books or changes anything
    expect(tools.some((t) => /send|create|book|delete|update/.test(t.name))).toBe(false);
  });
});

describe("Quests ⇄ Google Tasks (the PC's side)", () => {
  it("sends its person's open and recently done quests (not repeating ones), and marks done what was ticked off in Google", async () => {
    const { addQuest, setQuestStatus } = await import("../src/quests/actions");
    const a = addQuest({ title: "Mix the EP", minutes: 60, deadline: "2026-11-01T18:00" });
    const b = addQuest({ title: "Vocal warm-ups", minutes: 15, ongoing: true, every: "day" } as any);
    const c = addQuest({ title: "Order the mic", minutes: 10 });
    setQuestStatus(c.id, "done", true);
    const { questsForTasks, tasksOnce } = await import("../src/quests/googletasks");
    const sent = questsForTasks();
    expect(sent.map((q) => [q.title, q.done])).toEqual([["Mix the EP", false], ["Order the mic", true]]);
    expect(sent.find((q) => q.id === a.id)!.due).toBe("2026-11-01");
    expect(sent.some((q) => q.id === b.id)).toBe(false);
    tasksAnswer = { ok: true, completed: [a.id] };
    expect(await tasksOnce()).toBe(1);
    const { readQuests } = await import("../src/quests/store");
    expect(readQuests().quests.find((q) => q.id === a.id)!.status).toBe("done");
  });

  it("does nothing when Google Tasks isn't switched on", async () => {
    status = { connected: true, drive: true, backups: true, files: true, tasks: false };
    const { tasksOnce } = await import("../src/quests/googletasks");
    expect(await tasksOnce()).toBe(0);
    expect(calls.some((c) => c.url.includes("/tasks/sync"))).toBe(false);
  });

  it("keeps Agent's files in Drive's Files folder as they're saved", async () => {
    const { saveFile } = await import("../src/files");
    saveFile({ name: "release-plan.md", content: "# Plan" });
    await new Promise((r) => setTimeout(r, 50));
    const put = calls.find((c) => c.url.includes("/drive/put") && c.url.includes("kind=file"));
    expect(put).toBeTruthy();
    expect(new URL(put!.url).searchParams.get("name")).toBe("release-plan.md");
  });
});
