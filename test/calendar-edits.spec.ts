// Calendar's rules that keep an edit from being lost (web/calendar/js/edits.js): "Change which?"
// is asked with the editor still open (Cancel keeps the edit), a reminders-only change needs no
// question, and every save says which version it changed (so a slow clock can't lose it).
// Run: npm test
import { describe, expect, it, vi } from "vitest";
import { onlyRemindersChanged, queued, ruleChanged, stamped, whichTimes } from "../web/calendar/js/edits.js";

const gym = { id: "gym", title: "Gym", body: "", location: "Gym", color: "teal", start: "2026-10-08T09:00", end: "2026-10-08T10:00", repeat: { freq: "weekly", byDay: [4] }, reminders: [10], art: { seed: 1, subject: "auto" } };
// What the editor sends for that card, untouched (this time of it: the 15th)
const fields = (extra: Record<string, unknown> = {}) => ({ kind: "event", title: "Gym", start: "2026-10-15T09:00", end: "2026-10-15T10:00", allDay: false, location: "Gym", body: "", color: "teal", reminders: [10], phones: [], repeat: { freq: "weekly", interval: 1, byDay: [4] }, art: { seed: 1, subject: "auto" }, ...extra });
const was = "2026-10-15T09:00";

describe("changing a repeating note card", () => {
  it("only the reminders (or their phones) changed: every time, without asking", async () => {
    const f = fields({ reminders: [10, 60], phones: ["p1"] });
    expect(onlyRemindersChanged(gym, was, f)).toBe(true);
    const ask = vi.fn(async () => "one");
    expect(await whichTimes(gym, was, f, ask)).toBe("all");
    expect(ask).not.toHaveBeenCalled();
  });
  it("anything else changed: asks which times", async () => {
    for (const f of [fields({ title: "Gym (legs)" }), fields({ start: "2026-10-15T09:30", end: "2026-10-15T10:30" }), fields({ end: "2026-10-15T11:00" }), fields({ color: "rose" }), fields({ allDay: true }), fields({ art: { seed: 2, subject: "auto" } })]) {
      expect(onlyRemindersChanged(gym, was, f)).toBe(false);
      const ask = vi.fn(async () => "following");
      expect(await whichTimes(gym, was, f, ask)).toBe("following");
      expect(ask).toHaveBeenCalledOnce();
    }
  });
  it("Cancel on the question keeps the editor open (nothing saved, nothing lost)", async () => {
    expect(await whichTimes(gym, was, fields({ title: "Gym (legs)" }), async () => null)).toBeNull();
    expect(await whichTimes(gym, was, fields({ title: "Gym (legs)" }), async () => undefined)).toBeNull();
  });
  it("a card that doesn't repeat, or whose rule was changed, asks nothing", async () => {
    const ask = vi.fn(async () => "one");
    const once = { ...gym, repeat: undefined };
    expect(await whichTimes(once, was, fields({ title: "x", repeat: null }), ask)).toBeUndefined();
    const daily = fields({ repeat: { freq: "daily", interval: 1 } });
    expect(ruleChanged(gym, daily)).toBe(true);
    expect(ruleChanged(gym, fields())).toBe(false);
    expect(await whichTimes(gym, was, daily, ask)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });
  it("a card without a colour counts as violet", () => {
    const plain = { ...gym, color: undefined };
    expect(onlyRemindersChanged(plain, was, fields({ color: "violet", reminders: [] }))).toBe(true);
  });
});

describe("saving: the version a change was made to", () => {
  const known = new Map([["gym", { ...gym, updated: "2026-10-11T12:00:00.000Z" }]]);
  const current = (id: string) => known.get(id);
  it("a change to a known card carries `base` (so a device whose clock is behind still wins)", () => {
    // This device's clock says 11:00, an hour before the version it changed
    const { out, sent } = stamped({ ...gym, title: "Gym (legs)", created: "2026-10-01T00:00:00.000Z" }, current, "2026-10-11T11:00:00.000Z", () => "new");
    expect(out).toMatchObject({ id: "gym", updated: "2026-10-11T11:00:00.000Z", created: "2026-10-01T00:00:00.000Z" });
    expect(out).not.toHaveProperty("base");
    expect(sent.base).toBe("2026-10-11T12:00:00.000Z");
  });
  it("a new card gets an id and no base; an old base never sticks to the saved card", () => {
    const { out, sent } = stamped({ title: "New", base: "stale" }, current, "2026-10-11T11:00:00.000Z", () => "n1");
    expect(out).toMatchObject({ id: "n1", created: "2026-10-11T11:00:00.000Z" });
    expect(out).not.toHaveProperty("base");
    expect(sent).not.toHaveProperty("base");
  });
  it("only the latest change waits to go, still made to the first one's version", () => {
    let q: any[] = [];
    q = queued(q, { op: "put", item: { id: "gym", title: "A", base: "v1" } });
    q = queued(q, { op: "put", item: { id: "other", title: "O" } });
    q = queued(q, { op: "put", item: { id: "gym", title: "B", base: "v2-local" } });
    expect(q).toEqual([{ op: "put", item: { id: "other", title: "O" } }, { op: "put", item: { id: "gym", title: "B", base: "v1" } }]);
    q = queued(q, { op: "del", id: "gym", updated: "t" });
    expect(q).toEqual([{ op: "put", item: { id: "other", title: "O" } }, { op: "del", id: "gym", updated: "t" }]);
  });
});
