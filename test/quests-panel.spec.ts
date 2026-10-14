// The Quests panel (web/quests/): quick add in everyday words (parse.js), how it groups, picks and
// sorts (sort.js), and what it saves on a quest (steps, tags, the person's own order).
//   Run: npm test
import { describe, expect, it, afterEach } from "vitest";
import { boot, shutdown } from "./harness";
// @ts-ignore: plain browser modules
import { parseQuick } from "../web/quests/js/parse.js";
// @ts-ignore
import { columns, days, focusList, matches, sections, streak, tagsInUse } from "../web/quests/js/sort.js";

afterEach(shutdown);

// Wednesday 14 October 2026, 11:00 in London (10:00 UTC, summer time)
const NOW = new Date("2026-10-14T10:00:00Z");
const p = (text: string) => parseQuick(text, NOW);

describe("quick add: everyday words", () => {
  it("a day, a time, a priority, a tag and a length, in any order", () => {
    expect(p("tomorrow 3pm call Sam !high #studio 30m")).toMatchObject({ title: "Call Sam", fields: { fixedStart: "2026-10-15T15:00", priority: "high", tags: ["studio"], minutes: 30 } });
    expect(p("#studio 30m call Sam !high tomorrow at 3pm").fields).toMatchObject({ fixedStart: "2026-10-15T15:00", priority: "high", minutes: 30 });
  });

  it("a time already gone today means tomorrow; one still to come means today", () => {
    expect(p("call mum 9am").fields.fixedStart).toBe("2026-10-15T09:00");
    expect(p("call mum at 2").fields.fixedStart).toBe("2026-10-14T14:00");
    expect(p("call mum 18:30").fields.fixedStart).toBe("2026-10-14T18:30");
  });

  it("a day without a time: some time that day", () => {
    expect(p("friday send invoices").fields).toMatchObject({ earliest: "2026-10-16T00:00", deadline: "2026-10-16T23:59" });
    expect(p("dec 3 gig")).toMatchObject({ title: "Gig", fields: { earliest: "2026-12-03T00:00" } });
    expect(p("14/10 dentist at 4").fields.fixedStart).toBe("2026-10-14T16:00");
    expect(p("fri 10am flow test").fields.fixedStart).toBe("2026-10-16T10:00");
    expect(p("on sat gig").fields.earliest).toBe("2026-10-17T00:00");
    // Wednesday on a Wednesday is next week's
    expect(p("wednesday gym").fields.earliest).toBe("2026-10-21T00:00");
  });

  it("deadlines, lengths, in-a-while and repeats", () => {
    expect(p("mix the EP 1h30 by friday")).toMatchObject({ title: "Mix the EP", fields: { minutes: 90, deadline: "2026-10-16T23:59" } });
    expect(p("send the mix by 5pm").fields.deadline).toBe("2026-10-14T17:00");
    expect(p("in 20 min check the oven")).toMatchObject({ title: "Check the oven", fields: { fixedStart: "2026-10-14T11:20" } });
    expect(p("in 20 min check the oven").fields.minutes).toBeUndefined();
    expect(p("drink water every 30 min").fields).toMatchObject({ ongoing: true, every: "interval", everyMinutes: 30 });
    expect(p("stretch daily morning").fields).toMatchObject({ ongoing: true, every: "day", timeOfDay: "morning" });
    expect(p("post a reel every monday #social").fields).toMatchObject({ ongoing: true, every: "week", earliest: "2026-10-19T00:00" });
  });

  it("ordinary words stay in the title (no Sunday in sun cream, no June in junk)", () => {
    expect(p("buy sun cream")).toMatchObject({ title: "Buy sun cream", fields: {} });
    expect(p("clear 2 junk drawers").title).toBe("Clear 2 junk drawers");
    expect(p("sat nav update").fields).toEqual({});
    expect(p("plain old quest")).toMatchObject({ title: "Plain old quest", fields: {}, bits: [] });
  });

  it("priorities and a readable preview", () => {
    expect(p("x !").fields.priority).toBe("high");
    expect(p("x !!!").fields.priority).toBe("critical");
    expect(p("x !urgent").fields.priority).toBe("critical");
    expect(p("x !low").fields.priority).toBe("low");
    expect(p("tomorrow 3pm call Sam !high #studio").bits).toEqual(["Tomorrow 15:00", "High", "#studio"]);
  });
});

const q = (over: Record<string, unknown>) => ({ id: String(over.title), title: "", status: "todo", mode: "waiting", priority: "normal", start: "", end: "", fixedStart: "", deadline: "", order: 0, tags: [], steps: [], created: "2026-10-01T00:00:00Z", ...over });

describe("grouping, focus and the board", () => {
  const now = "2026-10-14T11:00";
  const list = [
    q({ title: "Late", start: "2026-10-14T08:00", end: "2026-10-14T09:00" }),
    q({ title: "On now", start: "2026-10-14T10:30", end: "2026-10-14T11:30" }),
    q({ title: "Later today", start: "2026-10-14T15:00", end: "2026-10-14T15:30" }),
    q({ title: "Friday", start: "2026-10-16T10:00", end: "2026-10-16T11:00" }),
    q({ title: "Whenever", priority: "low" }),
    q({ title: "Urgent whenever", priority: "critical", mode: "questions" }),
    q({ title: "Finished", status: "done", mode: "done", completed: "2026-10-14T09:00:00Z" }),
  ];

  it("the list groups are plain: now, overdue, today, coming up, any time, done", () => {
    const g = sections(list, now);
    expect(g.now.map((x: any) => x.title)).toEqual(["On now"]);
    expect(g.overdue.map((x: any) => x.title)).toEqual(["Late"]);
    expect(g.today.map((x: any) => x.title)).toEqual(["Later today"]);
    expect(g.upcoming.map((x: any) => x.title)).toEqual(["Friday"]);
    expect(g.anytime.map((x: any) => x.title)).toEqual(["Urgent whenever", "Whenever"]);
    expect(g.done.map((x: any) => x.title)).toEqual(["Finished"]);
  });

  it("a dragged order wins over time and priority", () => {
    const g = sections([q({ title: "A", priority: "critical" }), q({ title: "B", order: 1 }), q({ title: "C", order: 2 })], now);
    expect(g.anytime.map((x: any) => x.title)).toEqual(["B", "C", "A"]);
  });

  it("Focus puts what's on now first, then overdue, then the rest", () => {
    expect(focusList(list, now).slice(0, 3).map((x: any) => x.title)).toEqual(["On now", "Late", "Later today"]);
  });

  it("the board has a column per mode; done quests go in Done", () => {
    const c = columns(list);
    expect(c.questions.map((x: any) => x.title)).toEqual(["Urgent whenever"]);
    expect(c.done.map((x: any) => x.title)).toEqual(["Finished"]);
    expect(c.waiting.length).toBe(5);
  });

  it("Today: each day's quests by time, late ones on today, the rest not placed yet", () => {
    const d = days(list, now);
    expect(d.list[0].day).toBe("2026-10-14");
    expect(d.list[0].quests.map((x: any) => x.title)).toEqual(["Late", "On now", "Later today"]);
    expect(d.list[1]).toMatchObject({ day: "2026-10-16" });
    expect(d.unplaced.map((x: any) => x.title)).toEqual(["Urgent whenever", "Whenever"]);
  });

  it("search reads titles, notes, steps and tags (#tag for a tag only)", () => {
    const x = q({ title: "Mix", notes: "use the new reverb", tags: ["studio"], steps: [{ id: "1", text: "bounce stems", done: false }] });
    expect(matches(x, "reverb")).toBe(true);
    expect(matches(x, "stems")).toBe(true);
    expect(matches(x, "#studio")).toBe(true);
    expect(matches(x, "#mix")).toBe(false);
    expect(matches(x, "mix studio")).toBe(true);
  });

  it("a streak counts days in a row with something done; today not done yet doesn't break it", () => {
    const done = (iso: string) => q({ title: iso, status: "done", completed: iso });
    expect(streak([done("2026-10-13T12:00:00Z"), done("2026-10-12T12:00:00Z")], NOW)).toEqual({ days: 2, doneToday: false });
    expect(streak([done("2026-10-14T09:00:00Z"), done("2026-10-13T12:00:00Z")], NOW)).toEqual({ days: 2, doneToday: true });
    expect(streak([done("2026-10-11T12:00:00Z")], NOW).days).toBe(0);
  });

  it("tags in use, most used first", () => {
    expect(tagsInUse([q({ title: "a", tags: ["mix", "studio"] }), q({ title: "b", tags: ["studio"] })])).toEqual(["studio", "mix"]);
  });
});

describe("what a quest keeps for the panel", () => {
  it("steps, tags and order are saved, checked and tidied", async () => {
    const nova = await boot("2026-10-14T09:00");
    nova.setQuests({ quests: [{ id: "mix", title: "Mix the EP", minutes: 60 }] });
    nova.actions.updateQuest("mix", { steps: [{ text: " Bounce stems ", done: false }, { text: "Send", done: true }], tags: ["#Studio", "studio", "big mix"] } as any);
    const m = nova.quest("mix");
    expect(m.steps.map((s: any) => [s.text, s.done])).toEqual([["Bounce stems", false], ["Send", true]]);
    expect(m.steps.every((s: any) => s.id)).toBe(true);
    expect(m.tags).toEqual(["studio", "big-mix"]);
    expect(() => nova.actions.updateQuest("mix", { tags: "studio" } as any)).toThrow(/Tags/);
    expect(() => nova.actions.updateQuest("mix", { steps: Array.from({ length: 31 }, (_, i) => ({ text: `s${i}` })) } as any)).toThrow(/Steps/);
    expect(() => nova.actions.updateQuest("mix", { order: -1 } as any)).toThrow(/order/);
  });

  it("a new quest from quick add keeps its tags and steps", async () => {
    const nova = await boot("2026-10-14T09:00");
    const made = nova.actions.addQuest({ title: "Call Sam", tags: ["studio"], steps: [{ text: "Find the number" }], minutes: 15 } as any);
    expect(made.tags).toEqual(["studio"]);
    expect(made.steps[0].text).toBe("Find the number");
  });

  it("dragging saves the order, only for quests that person may move", async () => {
    const nova = await boot("2026-10-14T09:00");
    nova.setQuests({ quests: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C", owner: "bea" }] });
    nova.actions.orderQuests(["b", "a"]);
    expect([nova.quest("b").order, nova.quest("a").order]).toEqual([1, 2]);
    expect(() => nova.actions.orderQuests(["c", "a"], (x: any) => x.owner !== "bea")).toThrow(/isn't yours/);
    expect(nova.quest("c").order).toBe(0);
    expect(() => nova.actions.orderQuests(["nope"])).toThrow(/no quest/);
    expect(() => nova.actions.orderQuests("a" as any)).toThrow(/which quests/);
  });

  it("the order reaches Nova Agent online (the link lets it through)", async () => {
    await boot("2026-10-14T09:00");
    const relay = await import("../src/relay");
    expect(relay.relayAllowed("POST", "/actions/quests/order", { id: "bea", name: "Bea", role: "staff" } as any)).toBe(true);
  });
});
