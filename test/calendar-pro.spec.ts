// The Calendar panel's events in Nova Agent: repeating events are busy time for the
// planner, the chat sees each time one happens, and the copy here stays in step with
// Nova Bot's (src/calendar/cloud.ts).  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const ev = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, body: "", author: "", start: "2026-10-08T09:00", end: "2026-10-08T17:00", art: { seed: 1, subject: "auto" }, created: "2026-10-07T08:00:00.000Z", updated: "2026-10-07T08:00:00.000Z", ...extra });

describe("repeating events in Nova Agent", () => {
  it("keep their extras through a save", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.calendar.writeCalendar({ ...nova.calendar.readCalendar(), notes: [ev("gym", { repeat: { freq: "weekly", byDay: [4] }, location: "Gym", reminders: [10], color: "teal" })] } as any);
    expect(nova.calendar.readCalendar().notes[0]).toMatchObject({ location: "Gym", reminders: [10], color: "teal", repeat: { freq: "weekly", interval: 1, byDay: [4] }, exdates: [] });
  });

  it("show each time they happen when the chat lists the calendar", async () => {
    const nova = await boot("2026-10-07T09:00");
    nova.calendar.writeCalendar({ ...nova.calendar.readCalendar(), notes: [ev("standup", { start: "2026-10-05T09:30", end: "2026-10-05T09:45", repeat: { freq: "daily" }, exdates: ["2026-10-09"] })] } as any);
    const { notes } = nova.calendar.listRange("2026-10-07", "2026-10-11");
    expect(notes.map((n) => n.start)).toEqual(["2026-10-07T09:30", "2026-10-08T09:30", "2026-10-10T09:30", "2026-10-11T09:30"]);
  });

  it("are busy time: the planner keeps quests out of every one", async () => {
    const nova = await boot("2026-10-07T07:00");
    // Busy 07:00-23:30 every day from tomorrow, except Saturday 10th (taken out of the series)
    nova.calendar.writeCalendar({ ...nova.calendar.readCalendar(), notes: [ev("work", { start: "2026-10-08T07:00", end: "2026-10-08T23:30", repeat: { freq: "daily" }, exdates: ["2026-10-10"] })] } as any);
    nova.setQuests({ quests: [{ id: "q1", title: "Write lyrics", minutes: 60, earliest: "2026-10-08T00:00" }] });
    nova.start();
    expect(nova.quest("q1").start.slice(0, 10)).toBe("2026-10-10");
  });

  it("all-day events are markers, not busy time", async () => {
    const nova = await boot("2026-10-07T07:00");
    nova.calendar.writeCalendar({ ...nova.calendar.readCalendar(), notes: [ev("release", { start: "2026-10-08T00:00", end: "2026-10-08T23:59", allDay: true })] } as any);
    nova.setQuests({ quests: [{ id: "q1", title: "Write lyrics", minutes: 60, earliest: "2026-10-08T00:00" }] });
    nova.start();
    expect(nova.quest("q1").start.slice(0, 10)).toBe("2026-10-08");
  });
});

describe("in step with Nova Bot", () => {
  it("takes Nova Bot's changes, keeps a newer unsent one here, and drops deleted ones", async () => {
    const nova = await boot("2026-10-07T09:00");
    const cloud = await import("../src/calendar/cloud");
    const data = { ...nova.calendar.readCalendar(), notes: [ev("mine", { title: "Edited here", updated: "2026-10-07T10:00:00.000Z" }), ev("gone")] } as any;
    const state = { rev: 0, sent: {} as Record<string, string> };
    // "gone" was sent before, unchanged since
    state.sent.gone = cloud._internal.fingerprint({ ...ev("gone"), kind: "event" });
    const changed = cloud.applyRemote(
      data,
      [
        { ...ev("mine", { title: "Older edit elsewhere", updated: "2026-10-07T09:30:00.000Z" }), kind: "event" },
        { ...ev("new", { title: "Made on a phone" }), kind: "event" },
        { kind: "day", id: "xmas", date: "2026-12-25", preset: "christmas", title: "Christmas", aesthetic: "nebula", theme: "app", info: "", location: "", tags: [], repeat: "yearly", artSalt: "", created: "x", updated: "2026-10-07T08:00:00.000Z" },
        { id: "gone", kind: "event", deleted: true, updated: "2026-10-07T11:00:00.000Z" },
      ] as any,
      state
    );
    expect(changed).toBe(true);
    expect(data.notes.map((n: any) => n.title).sort()).toEqual(["Edited here", "Made on a phone"]);
    expect(data.days.map((d: any) => d.title)).toEqual(["Christmas"]);
    expect(state.sent.gone).toBeUndefined();
    expect(state.sent.new).toBeTruthy();
  });
});
