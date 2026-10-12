// Google on the PC's side (src/google.ts, src/google-agent.ts): copies in Drive only when Google is
// connected, the nightly file backup, and Agent's read-only tools.  Run: npm test
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; body: unknown; type: string };
let calls: Call[];
let status: { connected: boolean; drive: boolean; backups: boolean };

beforeEach(() => {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-google-")) + "/";
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});
  calls = [];
  status = { connected: true, drive: true, backups: true };
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
    expect(tools.map((t) => t.name).sort()).toEqual(["gmail_search", "google_calendar_busy", "google_contacts_find"]);
    const run = (name: string, input: unknown) => (tools.find((t) => t.name === name) as any).run(input);
    expect(await run("google_calendar_busy", { from: "2026-11-01", to: "2026-11-05" })).toContain("10:00");
    expect(await run("gmail_search", { q: "from:kai@example.com" })).toContain('"Thursday": Works for me');
    expect(await run("google_contacts_find", { q: "Kai" })).toMatch(/Couldn't ask Google: Google isn't connected/);
    // No tool sends, books or changes anything
    expect(tools.some((t) => /send|create|book|delete|update/.test(t.name))).toBe(false);
  });
});
