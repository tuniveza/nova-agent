// Quest 1: Agent and the studio's bookings through Acuity's API on Nova Bot (src/acuity-api.ts,
// the studio tools in src/chat.ts), bookings as busy time for Quests (src/quests/bookings.ts),
// music time (planMusic in src/quests/scheduler.ts), and the "bookings changed" signal that
// comes with each "any jobs?" (src/jobs.ts). Nova Bot is pretend throughout.  Run: npm test
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, shutdown } from "./harness";

const action = (over: Record<string, unknown> = {}) => ({
  id: 41,
  kind: "reschedule",
  status: "pending",
  summary: "Move Dana Hollis's Rap Package from Sat 31 Oct 17:00 to Sun 1 Nov 14:00 (Acuity emails her)",
  payload: { appointmentId: 9001, start: "2026-11-01T14:00", notifyClient: true },
  reason: "Dana asked on the phone",
  proposedBy: "agent",
  createdAt: "2026-10-10T09:00:00Z",
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  executedAt: null,
  result: null,
  error: null,
  portalUrl: "https://worker.test/portal/?view=approvals&action=41",
  ...over,
});

describe("Agent's Acuity tools (ACUITY_SOURCE=api)", () => {
  let seen: { path: string; headers: Record<string, string>; body: any }[] = [];
  const browser = { listTask: vi.fn(), checkLogin: vi.fn() };

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-acuity-"));
    process.env.ACUITY_SOURCE = "api"; // (not just deleted: a real .env may set it)
    vi.resetModules();
    seen = [];
    browser.listTask.mockReset().mockRejectedValue(new Error("the browser must not open"));
    browser.checkLogin.mockReset().mockRejectedValue(new Error("the browser must not open"));
    // The browser tasks: any use of them fails the test
    vi.doMock("../src/tasks", async (orig) => ({ ...(await orig<typeof import("../src/tasks")>()), listTask: browser.listTask, checkLogin: browser.checkLogin }));
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, headers: (init.headers || {}) as Record<string, string>, body });
      if (path === "/nova-agent/acuity/appointments")
        return Response.json({ appointments: [{ id: 9001, start: "2026-10-31T17:00:00.000Z", end: "2026-10-31T19:00:00.000Z", type: "Rap Package", typeId: 5, name: "Dana Hollis", email: "dana@example.com", phone: "", price: "60.00", paid: "no", amountPaid: "0.00", notes: "", canceled: false, calendar: "Studio A", calendarId: 1 }] });
      if (path === "/nova-agent/acuity/availability") return Response.json({ times: [{ start: "2026-11-01T14:00:00.000Z", label: "14:00" }] });
      if (path === "/nova-agent/booking-actions/propose") return Response.json({ action: action({ kind: body.kind, payload: body.payload, reason: body.reason }) });
      if (path === "/nova-agent/booking-actions") return Response.json({ actions: [action()] });
      if (path === "/nova-agent/acuity/types") return Response.json({ error: "Acuity unreachable: timed out", unreachable: true }, { status: 503 });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock("../src/tasks");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    process.env.ACUITY_SOURCE = "api"; // (not just deleted: a real .env may set it)
  });

  const tool = async (name: string, actions: any[] = []) => {
    const { studioTools } = await import("../src/chat");
    return studioTools(actions).find((t: any) => t.name === name) as any;
  };

  it("are the API tools, with the same studio_bookings name and no login check", async () => {
    const { studioTools } = await import("../src/chat");
    expect(studioTools([]).map((t: any) => t.name)).toEqual(["studio_bookings", "studio_availability", "studio_blocked_times", "studio_session_types", "studio_clients", "propose_booking_change", "booking_actions"]);
  });

  it("studio_bookings reads the worker's API with Nova Agent's key and never touches the browser", async () => {
    const said = await (await tool("studio_bookings")).run({ from: "2026-10-31", to: "2026-11-01" });
    expect(said).toContain("#9001");
    expect(said).toContain("Sat 31 Oct, 17:00"); // 17:00 UTC is 17:00 in London after the clocks go back
    expect(said).toContain("Rap Package");
    expect(seen).toEqual([{ path: "/nova-agent/acuity/appointments", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { from: "2026-10-31", to: "2026-11-01" } }]);
    expect(browser.listTask).not.toHaveBeenCalled();
    expect(browser.checkLogin).not.toHaveBeenCalled();
  });

  it("says plainly when Acuity can't be reached", async () => {
    const said = await (await tool("studio_session_types")).run({});
    expect(said).toMatch(/Couldn't reach Acuity just now: Acuity unreachable/);
  });

  it("with ACUITY_SOURCE=browser everything is as before (browser bookings and the login check)", async () => {
    process.env.ACUITY_SOURCE = "browser";
    const { studioTools } = await import("../src/chat");
    expect(studioTools([]).map((t: any) => t.name)).toEqual(["studio_bookings", "check_acuity_login"]);
  });

  it("propose_booking_change only proposes: it says an admin must approve it in Portal, and adds the card", async () => {
    const actions: any[] = [];
    const said = await (await tool("propose_booking_change", actions)).run({ kind: "reschedule", appointment_id: 9001, start: "2026-11-01T14:00", reason: "Dana asked on the phone" });
    expect(said).toContain("NOT done");
    expect(said).toContain("Portal → Approvals");
    expect(said).not.toMatch(/\b(booked|moved|rescheduled|done ✓)\b/i);
    // Only the kind, the details and why: nothing that could ask for it to be approved
    expect(seen.map((s) => s.path)).toEqual(["/nova-agent/booking-actions/propose"]);
    expect(Object.keys(seen[0].body).sort()).toEqual(["kind", "payload", "reason"]);
    expect(seen[0].body.payload).toEqual({ appointmentId: 9001, start: "2026-11-01T14:00", notifyClient: true });
    expect(actions).toEqual([{ kind: "booking", text: expect.stringContaining("waiting for an admin"), booking: expect.objectContaining({ id: 41, status: "pending", portalUrl: expect.stringContaining("view=approvals&action=41") }) }]);
  });

  it("a proposal missing what its kind needs isn't sent at all", async () => {
    const said = await (await tool("propose_booking_change")).run({ kind: "create", type_id: 5, start: "2026-11-01T14:00", reason: "New client" });
    expect(said).toMatch(/needs first_name, last_name, email/);
    expect(seen).toEqual([]);
  });

  it("has no approve path anywhere: no tool, no export, no address", async () => {
    const { studioTools, enquiryTools } = await import("../src/chat");
    const names = [...studioTools([]), ...enquiryTools([])].map((t: any) => t.name);
    expect(names.filter((n: string) => /approve|execute|decide|reject|edit/.test(n))).toEqual([]);
    const api = await import("../src/acuity-api");
    expect(Object.keys(api).filter((k) => /approve|execute|decide|reject|edit|run/i.test(k))).toEqual([]);
    // Every proposal stays pending until an admin presses Approve in Portal
    await (await tool("booking_actions")).run({ status: "all" });
    for (const s of seen) {
      expect(s.path.startsWith("/nova-agent/")).toBe(true);
      expect(s.path).not.toMatch(/approve|edit|reject|app\/api/);
    }
  });
});

// The pretend worker for the planner tests: /next, the bookings, blocks and notify
function pretendWorker() {
  const w = {
    appointments: [] as any[],
    blocks: [] as any[],
    changed: null as string | null,
    down: false,
    calls: [] as { path: string; body: any }[],
    pings: [] as any[],
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    w.calls.push({ path, body });
    if (path === "/nova-agent/notify") {
      w.pings.push(body);
      return Response.json({ ok: true, phones: 1 });
    }
    if (path === "/nova-agent/next") return Response.json({ job: null, bookingsChanged: w.changed });
    if (w.down) return Response.json({ error: "Acuity unreachable: fetch failed", unreachable: true }, { status: 503 });
    if (path === "/nova-agent/acuity/appointments") return Response.json({ appointments: w.appointments });
    if (path === "/nova-agent/acuity/blocks") return Response.json({ blocks: w.blocks });
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  return w;
}
const booking = (id: number, start: string, end: string, canceled = false) => ({ id, start, end, type: "Recording", typeId: 5, name: "Sam Client", email: "sam@example.com", phone: "07700900000", canceled });
// A copy of the bookings already on disk (as if Nova Agent had read Acuity before)
const writeCopy = (appointments: any[], blocks: any[] = [], seen = "") =>
  writeFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), JSON.stringify({ fetchedAt: "2026-10-07T07:00:00.000Z", from: "2026-10-06", to: "2026-10-29", seen, appointments, blocks }));
const music = (nova: Awaited<ReturnType<typeof boot>>) => nova.calendar.readCalendar().notes.filter((n: any) => n.id.startsWith("music-"));

describe("Bookings as busy time for Quests", () => {
  afterEach(() => {
    shutdown();
    process.env.ACUITY_SOURCE = "api"; // (not just deleted: a real .env may set it)
  });

  it("bookings and Acuity's blocked times are taken time; cancelled bookings aren't", async () => {
    const nova = await boot("2026-10-07T09:00"); // a Wednesday, BST
    writeCopy(
      [booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z"), booking(2, "2026-10-07T13:00:00.000Z", "2026-10-07T15:00:00.000Z", true)],
      [{ id: 7, start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T13:00:00.000Z" }],
    );
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    nova.plan.replan();
    // 09:00–13:00 booked, 13:00–14:00 blocked in Acuity; 14:00–16:00 was cancelled, so it's free
    expect(nova.quest("mix")).toMatchObject({ start: "2026-10-07T14:00", end: "2026-10-07T15:00" });
  });

  it("a broken copy never stops the plan", async () => {
    const nova = await boot("2026-10-07T09:00");
    writeFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "{ not json");
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    expect(() => nova.plan.replan()).not.toThrow();
    expect(nova.quest("mix").start).toBe("2026-10-07T09:00");
  });
});

describe("Music time", () => {
  afterEach(shutdown);
  const rhythm = { music: { days: [3], start: "19:00", minutes: 60 } }; // Wednesdays, 19:00 for an hour

  it("is off by default", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [] });
    expect(nova.store.readQuests().rhythm.music).toEqual({ days: [], start: "19:00", minutes: 0 });
    nova.plan.replan();
    expect(music(nova)).toEqual([]);
  });

  it("is planned at its usual time on its days (21 days ahead), shows in Calendar, and quests go around it", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ rhythm, quests: [{ id: "write", title: "Write lyrics", minutes: 60, earliest: "2026-10-07T19:00" }] });
    const r = nova.plan.replan();
    expect(r.music.map((m: any) => m.start)).toEqual(["2026-10-07T19:00", "2026-10-14T19:00", "2026-10-21T19:00"]);
    expect(music(nova).map((n: any) => [n.id, n.title, n.start, n.end])).toEqual([
      ["music-2026-10-07", "♪ Music time", "2026-10-07T19:00", "2026-10-07T20:00"],
      ["music-2026-10-14", "♪ Music time", "2026-10-14T19:00", "2026-10-14T20:00"],
      ["music-2026-10-21", "♪ Music time", "2026-10-21T19:00", "2026-10-21T20:00"],
    ]);
    // It's taken time for quests
    expect(nova.quest("write").start).toBe("2026-10-07T20:00");
    // Its own cards don't count as calendar entries (re-planning doesn't push it around)
    nova.plan.replan();
    expect(music(nova)[0].start).toBe("2026-10-07T19:00");
  });

  it("moves to the nearest free time that day when something overlaps it", async () => {
    const nova = await boot("2026-10-07T09:00");
    // A booking 19:00–20:30 UK (18:00–19:30 UTC): before it (18:00) is nearer than after (20:30)
    writeCopy([booking(1, "2026-10-07T18:00:00.000Z", "2026-10-07T19:30:00.000Z")]);
    nova.setQuests({ rhythm, quests: [] });
    nova.plan.replan();
    expect(music(nova)[0]).toMatchObject({ title: "♪ Music time (moved)", start: "2026-10-07T18:00", end: "2026-10-07T19:00" });
    expect(music(nova)[0].body).toContain("Moved from 19:00");
    // A calendar entry 17:00–18:30 as well: now after the booking is nearest
    nova.calendar.addNote({ title: "Dinner", start: "2026-10-07T17:00", end: "2026-10-07T18:30" });
    nova.plan.replan();
    expect(music(nova)[0]).toMatchObject({ start: "2026-10-07T20:30", end: "2026-10-07T21:30" });
    // And with no room that day, there's none that day (the next week is untouched)
    nova.actions.addBlock("2026-10-07T07:00", "2026-10-07T23:30", "Away");
    expect(music(nova).map((n: any) => n.start)).toEqual(["2026-10-14T19:00", "2026-10-21T19:00"]);
  });
});

describe("The bookings-changed signal", () => {
  afterEach(() => {
    shutdown();
    process.env.ACUITY_SOURCE = "api"; // (not just deleted: a real .env may set it)
  });

  it("a newer bookingsChanged refreshes the bookings and re-plans, with one calm music notice", async () => {
    const nova = await boot("2026-10-07T09:00");
    writeCopy([], [], "2026-10-07T07:00:00.000Z");
    nova.setQuests({ rhythm: { music: { days: [3], start: "19:00", minutes: 60 } }, quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    nova.plan.replan();
    expect(nova.quest("mix").start).toBe("2026-10-07T09:00");
    expect(music(nova)[0].start).toBe("2026-10-07T19:00");

    const worker = pretendWorker();
    const jobs = await import("../src/jobs");
    const bookings = await import("../src/quests/bookings");
    // A booking made in Acuity: 09:00–13:00 and 19:00–20:30 today (UK)
    worker.appointments = [booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z"), booking(2, "2026-10-07T18:00:00.000Z", "2026-10-07T19:30:00.000Z")];
    worker.changed = "2026-10-07T08:01:00.000Z";
    await jobs.checkForJob();
    await bookings.bookingsIdle();
    await nova.run("1s");

    // "Any jobs?" said what it had seen; then the bookings were read again and everything re-planned
    expect(worker.calls[0]).toMatchObject({ path: "/nova-agent/next", body: expect.objectContaining({ bookingsSeen: "2026-10-07T07:00:00.000Z" }) });
    expect(worker.calls.map((c) => c.path)).toContain("/nova-agent/acuity/appointments");
    expect(nova.quest("mix").start).toBe("2026-10-07T13:00");
    expect(music(nova)[0].start).toBe("2026-10-07T18:00");
    // The fresh copy keeps no client details on disk
    expect(readFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "utf8")).not.toMatch(/Sam Client|sam@example|07700/);
    const musicPings = worker.pings.filter((p) => p.kind === "music");
    expect(musicPings).toHaveLength(1);
    expect(musicPings[0]).toMatchObject({ title: "Music time moved", urgent: false });
    expect(musicPings[0].message).toContain("Today 19:00 → 18:00");

    // The same signal again: nothing more is read, and "seen" has moved on
    const reads = worker.calls.filter((c) => c.path === "/nova-agent/acuity/appointments").length;
    await jobs.checkForJob();
    await bookings.bookingsIdle();
    expect(worker.calls.filter((c) => c.path === "/nova-agent/acuity/appointments")).toHaveLength(reads);
    expect(worker.calls.filter((c) => c.path === "/nova-agent/next").at(-1)!.body.bookingsSeen).toBe("2026-10-07T08:01:00.000Z");
    expect(worker.pings.filter((p) => p.kind === "music")).toHaveLength(1);
  });

  it("when Acuity can't be reached the last copy is kept, the plan still works, and the trace says so", async () => {
    const nova = await boot("2026-10-07T09:00");
    writeCopy([booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z")], [], "2026-10-07T07:00:00.000Z");
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    const worker = pretendWorker();
    worker.down = true;
    const bookings = await import("../src/quests/bookings");
    const trace = await import("../src/trace");
    expect(await bookings.refreshBookings()).toBe(false);
    expect(JSON.parse(readFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "utf8")).appointments).toHaveLength(1);
    expect(trace.getRecentEvents().some((e: any) => /Couldn't refresh the studio's bookings.*keep planning around the copy from/.test(e.message))).toBe(true);
    nova.plan.replan();
    expect(nova.quest("mix").start).toBe("2026-10-07T13:00");
  });

  it("with ACUITY_SOURCE=browser the signal is noted but nothing is read from the API", async () => {
    process.env.ACUITY_SOURCE = "browser";
    await boot("2026-10-07T09:00");
    const worker = pretendWorker();
    const bookings = await import("../src/quests/bookings");
    expect(bookings.bookingsChanged("2026-10-07T08:01:00.000Z")).toBeNull();
    expect(bookings.bookingsSeen()).toBe("2026-10-07T08:01:00.000Z");
    expect(worker.calls).toEqual([]);
  });
});
