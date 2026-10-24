// The studio's bookings (Nova Bot's own booking system, read through /nova-agent/bookings-feed):
// Agent's read-only studio_bookings tool (src/studio-bookings.ts, studioTools in src/chat.ts),
// bookings as busy time for Quests (src/quests/bookings.ts), music time (planMusic in
// src/quests/scheduler.ts), and the check-in with Nova Bot (src/jobs.ts): the "bookings changed"
// signal, and booking jobs turned down. Nova Bot is pretend throughout.  Run: npm test
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boot, shutdown } from "./harness";

describe("Agent's studio bookings (read-only)", () => {
  let seen: { path: string; headers: Record<string, string>; body: any }[] = [];
  let feed: () => Response;

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-bookings-"));
    vi.resetModules();
    seen = [];
    feed = () => Response.json({ appointments: [{ id: 9001, start: "2026-10-31T17:00:00.000Z", end: "2026-10-31T19:00:00.000Z", type: "Rap Package", name: "Dana Hollis" }] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, headers: (init.headers || {}) as Record<string, string>, body });
      if (path === "/nova-agent/bookings-feed") return feed();
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = async () => {
    const { studioTools } = await import("../src/chat");
    return (studioTools([]).find((t: any) => t.name === "studio_bookings") as any).run({ from: "2026-10-31", to: "2026-11-01" });
  };

  it("is one tool, studio_bookings: no booking, moving, cancelling, proposing or login tools", async () => {
    const { studioTools } = await import("../src/chat");
    expect(studioTools([]).map((t: any) => t.name)).toEqual(["studio_bookings"]);
  });

  it("reads /nova-agent/bookings-feed with Nova Agent's key and says who, what and when in UK time", async () => {
    const actions: any[] = [];
    const { studioTools } = await import("../src/chat");
    const said = await (studioTools(actions).find((t: any) => t.name === "studio_bookings") as any).run({ from: "2026-10-31", to: "2026-11-01" });
    expect(said).toContain("#9001");
    expect(said).toContain("Sat 31 Oct, 17:00"); // UK time (GMT after the clocks go back)
    expect(said).toContain("Rap Package");
    expect(said).toContain("Dana Hollis");
    expect(seen).toEqual([{ path: "/nova-agent/bookings-feed", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { from: "2026-10-31", to: "2026-11-01" } }]);
    expect(actions).toEqual([{ kind: "looked", text: expect.stringMatching(/^Looked at the studio's bookings, /) }]);
  });

  it("says plainly when the bookings aren't set up or can't be read", async () => {
    feed = () => Response.json({ error: "The booking calendar isn't set up." }, { status: 409 });
    expect(await run()).toMatch(/Couldn't read the studio's bookings just now: The booking calendar isn't set up/);
    feed = () => Response.json({ error: "The bookings couldn't be read: timed out", unreachable: true }, { status: 503 });
    expect(await run()).toMatch(/couldn't be read: timed out/);
  });

  it("has no way to change a booking anywhere: no tool, no export, no address", async () => {
    const { studioTools, enquiryTools } = await import("../src/chat");
    const names = [...studioTools([]), ...enquiryTools([])].map((t: any) => t.name);
    expect(names.filter((n: string) => /approve|execute|decide|reject|propose|book_|cancel|reschedule|edit/.test(n))).toEqual([]);
    const api = await import("../src/studio-bookings");
    expect(Object.keys(api).filter((k) => /approve|execute|decide|reject|propose|edit|run|book(?!ings)|cancel|move/i.test(k))).toEqual([]);
    await run();
    expect(seen.map((s) => s.path)).toEqual(["/nova-agent/bookings-feed"]);
  });

  it("tells Agent where bookings are made and changed (the /book page, Portal, Google Calendar)", async () => {
    const chat = readFileSync(join(__dirname, "../src/chat.ts"), "utf8");
    expect(chat).toContain("/book");
    expect(chat).toContain("Google Calendar");
    expect(chat).not.toMatch(/acuity/i);
  });
});

// The pretend worker for the planner tests: /next, the bookings feed, /result and notify
function pretendWorker() {
  const w = {
    appointments: [] as any[],
    changed: null as string | null,
    job: null as unknown,
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
    if (path === "/nova-agent/next") {
      const job = w.job;
      w.job = null;
      return Response.json({ job, bookingsChanged: w.changed });
    }
    if (path === "/nova-agent/result") return Response.json({ ok: true });
    if (w.down) return Response.json({ error: "The bookings couldn't be read: fetch failed", unreachable: true }, { status: 503 });
    if (path === "/nova-agent/bookings-feed") return Response.json({ appointments: w.appointments });
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  return w;
}
const booking = (id: number, start: string, end: string) => ({ id, start, end, type: "Recording", name: "Sam Client" });
// A copy of the bookings already on disk (as if Nova Agent had read them before)
const writeCopy = (appointments: any[], blocks: any[] = [], seen = "") =>
  writeFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), JSON.stringify({ fetchedAt: "2026-10-07T07:00:00.000Z", from: "2026-10-06", to: "2026-10-29", seen, appointments, blocks }));
const music = (nova: Awaited<ReturnType<typeof boot>>) => nova.calendar.readCalendar().notes.filter((n: any) => n.id.startsWith("music-"));

describe("Bookings as busy time for Quests", () => {
  afterEach(shutdown);

  it("bookings are taken time; a cancelled one (in an older copy) isn't, and an older copy's blocked time still is", async () => {
    const nova = await boot("2026-10-07T09:00"); // a Wednesday, BST
    writeCopy(
      [{ ...booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z"), canceled: false }, { ...booking(2, "2026-10-07T13:00:00.000Z", "2026-10-07T15:00:00.000Z"), canceled: true }],
      [{ id: 7, start: "2026-10-07T12:00:00.000Z", end: "2026-10-07T13:00:00.000Z" }],
    );
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    nova.plan.replan();
    // 09:00–13:00 booked, 13:00–14:00 blocked; 14:00–16:00 was cancelled, so it's free
    expect(nova.quest("mix")).toMatchObject({ start: "2026-10-07T14:00", end: "2026-10-07T15:00" });
  });

  it("a broken copy never stops the plan", async () => {
    const nova = await boot("2026-10-07T09:00");
    writeFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "{ not json");
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    expect(() => nova.plan.replan()).not.toThrow();
    expect(nova.quest("mix").start).toBe("2026-10-07T09:00");
  });

  it("a refresh reads the bookings feed, keeps no names on disk, and quests go around the bookings", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    nova.plan.replan();
    expect(nova.quest("mix").start).toBe("2026-10-07T09:00");

    const worker = pretendWorker();
    worker.appointments = [booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z")]; // 09:00–13:00 UK
    const bookings = await import("../src/quests/bookings");
    expect(await bookings.refreshBookings()).toBe(true);

    expect(worker.calls.map((c) => c.path)).toEqual(["/nova-agent/bookings-feed"]);
    expect(worker.calls[0].body).toEqual({ from: "2026-10-06", to: "2026-10-29" });
    expect(nova.quest("mix").start).toBe("2026-10-07T13:00");
    const onDisk = readFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "utf8");
    expect(JSON.parse(onDisk).appointments).toEqual([{ id: 1, start: "2026-10-07T08:00:00.000Z", end: "2026-10-07T12:00:00.000Z", type: "Recording", canceled: false }]);
    expect(JSON.parse(onDisk).blocks).toEqual([]);
    expect(onDisk).not.toMatch(/Sam Client/);
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
    writeCopy([{ ...booking(1, "2026-10-07T18:00:00.000Z", "2026-10-07T19:30:00.000Z"), canceled: false }]);
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

describe("Checking in with Nova Bot", () => {
  afterEach(shutdown);

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
    // A new booking: 09:00–13:00 and 19:00–20:30 today (UK)
    worker.appointments = [booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z"), booking(2, "2026-10-07T18:00:00.000Z", "2026-10-07T19:30:00.000Z")];
    worker.changed = "2026-10-07T08:01:00.000Z";
    await jobs.checkForJob();
    await bookings.bookingsIdle();
    await nova.run("1s");

    // "Any jobs?" said what it had seen, and that Nova Agent takes no booking jobs; then the
    // bookings were read again and everything re-planned
    expect(worker.calls[0]).toMatchObject({ path: "/nova-agent/next", body: expect.objectContaining({ bookingsSeen: "2026-10-07T07:00:00.000Z", dryRun: true }) });
    expect(worker.calls.map((c) => c.path)).toContain("/nova-agent/bookings-feed");
    expect(nova.quest("mix").start).toBe("2026-10-07T13:00");
    expect(music(nova)[0].start).toBe("2026-10-07T18:00");
    // The fresh copy keeps no client details on disk
    expect(readFileSync(join(process.env.NOVA_DATA_DIR!, "bookings.json"), "utf8")).not.toMatch(/Sam Client/);
    const musicPings = worker.pings.filter((p) => p.kind === "music");
    expect(musicPings).toHaveLength(1);
    expect(musicPings[0]).toMatchObject({ title: "Music time moved", urgent: false });
    expect(musicPings[0].message).toContain("Today 19:00 → 18:00");

    // The same signal again: nothing more is read, and "seen" has moved on
    const reads = worker.calls.filter((c) => c.path === "/nova-agent/bookings-feed").length;
    await jobs.checkForJob();
    await bookings.bookingsIdle();
    expect(worker.calls.filter((c) => c.path === "/nova-agent/bookings-feed")).toHaveLength(reads);
    expect(worker.calls.filter((c) => c.path === "/nova-agent/next").at(-1)!.body.bookingsSeen).toBe("2026-10-07T08:01:00.000Z");
    expect(worker.pings.filter((p) => p.kind === "music")).toHaveLength(1);
  });

  it("when Nova Bot can't be reached the last copy is kept, the plan still works, and the trace says so", async () => {
    const nova = await boot("2026-10-07T09:00");
    writeCopy([{ ...booking(1, "2026-10-07T08:00:00.000Z", "2026-10-07T12:00:00.000Z"), canceled: false }], [], "2026-10-07T07:00:00.000Z");
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

  it("a booking job is reported back as not done, and nothing is booked or changed", async () => {
    await boot("2026-10-07T09:00");
    const worker = pretendWorker();
    worker.job = { id: 12, kind: "book", clientName: "Jo Bloggs", details: { type: "Recording", date: "2026-10-08", time: "14:00", firstName: "Jo", lastName: "Bloggs", email: "jo@example.com" } };
    const jobs = await import("../src/jobs");
    expect(await jobs.checkForJob()).toBe("job");
    const results = worker.calls.filter((c) => c.path === "/nova-agent/result");
    expect(results).toEqual([{ path: "/nova-agent/result", body: { id: 12, ok: false, message: expect.stringMatching(/^Nothing was changed: Nova Agent doesn't make or change bookings any more/) } }]);
    expect(worker.calls.map((c) => c.path)).toEqual(["/nova-agent/next", "/nova-agent/result"]);
  });

  it("the old Acuity helper is gone: no browser tasks, no healthcheck, no Acuity code", () => {
    for (const gone of ["acuity", "acuity-api.ts", "tasks.ts", "healthcheck.ts", "browser.ts", "heal", "index.ts"]) expect(existsSync(join(__dirname, "../src", gone))).toBe(false);
  });
});
