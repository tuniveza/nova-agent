// Quests' plain rules (web/agent/assets/plans.js): where each quest came from, and Calendar's
// note cards with reminders in Quests' "Also coming up".  Run: npm test
import { beforeAll, describe, expect, it } from "vitest";
import { occurrences } from "../web/calendar/js/recur.js";

let P: any;
beforeAll(async () => {
  await import("../web/agent/assets/plans.js");
  P = (globalThis as any).NovaPlans;
});

const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, start: "2026-10-12T14:00", end: "2026-10-12T15:00", reminders: [15], ...extra });

describe("where a quest came from", () => {
  it("names where it was made, or Nova Agent (never a mission: Missions are gone, 23 Oct 2026)", () => {
    expect(P.sources({ from: "" })).toEqual([{ kind: "agent", label: "Nova Agent" }]);
    expect(P.sources({ from: "Notes · Studio plan" })).toEqual([{ kind: "notes", label: "Notes · Studio plan" }]);
    expect(P.sources({ from: "Notes · Plan", missionId: "m1" }).map((s: any) => s.kind)).toEqual(["notes"]);
    expect(P.sources({ missionId: "m1" })).toEqual([{ kind: "agent", label: "Nova Agent" }]);
  });
});

describe("Also coming up", () => {
  const now = "2026-10-11T10:00";
  it("lists note cards with reminders in the next 7 days, soonest first", () => {
    const list = P.comingUp([card("later", { start: "2026-10-17T09:00", end: "2026-10-17T10:00" }), card("soon"), card("no-reminder", { reminders: [] }), card("too-far", { start: "2026-10-18T10:30", end: "2026-10-18T11:00" }), card("gone", { start: "2026-10-11T09:00" })], now, occurrences);
    expect(list.map((e: any) => [e.title, e.start, e.date])).toEqual([["soon", "2026-10-12T14:00", "2026-10-12"], ["later", "2026-10-17T09:00", "2026-10-17"]]);
  });
  it("leaves out Nova Agent's own copies (its plan, blocked time, milestones, music)", () => {
    expect(P.comingUp([card("quest-1"), card("block-1"), card("mile-1"), card("music-1"), card("mine")], now, occurrences).map((e: any) => e.id)).toEqual(["mine"]);
  });
  it("shows each time a repeating one happens, without the dates taken out", () => {
    const daily = card("standup", { start: "2026-10-01T09:30", end: "2026-10-01T09:45", repeat: { freq: "daily" }, exdates: ["2026-10-13"] });
    const dates = P.comingUp([daily], now, occurrences).map((e: any) => e.date);
    expect(dates).toEqual(["2026-10-12", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });
  it("keeps an all-day one for the whole of its day", () => {
    const allDay = card("trip", { start: "2026-10-11T00:00", end: "2026-10-11T23:59", allDay: true });
    expect(P.comingUp([allDay], now, occurrences)).toHaveLength(1);
  });
  it("without Calendar's repeat rules, still lists the one-off cards", () => {
    expect(P.comingUp([card("one"), card("rep", { repeat: { freq: "daily" } })], now, null).map((e: any) => e.id)).toEqual(["one"]);
  });
  it("says the reminders in words, and opens Calendar on the day", () => {
    expect([0, 10, 60, 120, 1440, 2880].map(P.remindWords)).toEqual(["At the start", "10 min before", "1 hour before", "2 hours before", "1 day before", "2 days before"]);
    expect(P.calendarDay("2026-10-12")).toBe("/calendar/?day=2026-10-12");
    expect(P.later("2026-10-31T23:30", 60)).toBe("2026-11-01T00:30");
  });
});
