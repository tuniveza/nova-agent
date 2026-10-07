// P0-2 in Calendar: a save from the calendar page never wipes out a change
// made elsewhere, and edits to a quest's card reach the quest.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const note = (id: string, title: string, start = "2026-10-08T10:00", updated = "2026-10-07T08:00:00.000Z") => ({ id, title, body: "", author: "", start, end: start, art: { seed: 1, subject: "auto" }, created: "2026-10-07T08:00:00.000Z", updated });

// What an open calendar page holds: the data and the revision it loaded
async function withNotes(...notes: ReturnType<typeof note>[]) {
  const nova = await boot("2026-10-07T09:00");
  nova.setQuests({ quests: [] });
  nova.calendar.writeCalendar({ ...nova.calendar.readCalendar(), notes });
  return nova;
}
const load = (nova: Awaited<ReturnType<typeof boot>>) => structuredClone(nova.calendar.readCalendar());
const titles = (nova: Awaited<ReturnType<typeof boot>>) => Object.fromEntries(nova.calendar.readCalendar().notes.map((n) => [n.id, n.title]));

describe("saves from the calendar page", () => {
  it("each save moves the revision on, and the page is told the new one", async () => {
    const nova = await withNotes(note("a", "Mastering"));
    const page = load(nova);
    page.notes[0].title = "Mastering (final)";
    const res = nova.calendarPage.saveFromPage(page, page.rev);
    expect(res.rev).toBe(page.rev + 1);
    expect(nova.calendar.readCalendar().rev).toBe(res.rev);
  });

  it("a tab opened before the chat added a note doesn't wipe it out", async () => {
    const nova = await withNotes(note("a", "Mastering"));
    const page = load(nova);
    nova.calendar.addNote({ title: "Studio session", start: "2026-10-09T14:00" });
    page.notes[0].title = "Mastering (final)";
    nova.calendarPage.saveFromPage(page, page.rev);
    expect(Object.values(titles(nova)).sort()).toEqual(["Mastering (final)", "Studio session"]);
  });

  it("a card deleted on the page goes; one the chat changed meanwhile stays", async () => {
    const nova = await withNotes(note("a", "Mastering"), note("b", "Vocals"));
    const page = load(nova);
    nova.calendar.updateNote("b", { title: "Vocals (moved)" });
    page.notes = []; // both deleted on the page
    nova.calendarPage.saveFromPage(page, page.rev);
    expect(titles(nova)).toEqual({ b: "Vocals (moved)" });
  });

  it("the same card changed in two places: the later change wins", async () => {
    const nova = await withNotes(note("a", "Mastering"));
    const page = load(nova);
    nova.calendar.updateNote("a", { title: "Mastering (chat)" });
    page.notes[0] = { ...page.notes[0], title: "Mastering (page)", updated: new Date(Date.now() + 1000).toISOString() };
    nova.calendarPage.saveFromPage(page, page.rev);
    expect(titles(nova).a).toBe("Mastering (page)");
  });

  it("a page whose starting point isn't known any more (Nova Agent restarted) adds and changes, but deletes nothing", async () => {
    const nova = await withNotes(note("a", "Mastering"), note("b", "Vocals"));
    const page = load(nova);
    page.notes = [{ ...page.notes[0], title: "Mastering (final)", updated: new Date(Date.now() + 1000).toISOString() }, note("c", "New idea")];
    const res = nova.calendarPage.saveFromPage(page, 999_999);
    expect(titles(nova)).toEqual({ a: "Mastering (final)", b: "Vocals", c: "New idea" });
    expect(res.messages.join(" ")).toMatch(/deleted/i);
  });

  it("100 saves from the page, mixed with 100 changes from the chat, all persist", async () => {
    const nova = await withNotes(note("p", "page 0"), note("c", "chat 0"));
    let page = load(nova);
    for (let i = 1; i <= 100; i++) {
      // Every other time the page is behind (it hasn't refreshed since the chat's change)
      if (i % 2) page = load(nova);
      page.notes = page.notes.map((n) => (n.id === "p" ? { ...n, title: `page ${i}`, updated: new Date(Date.now() + i).toISOString() } : n));
      const res = nova.calendarPage.saveFromPage(page, page.rev);
      page.rev = res.rev;
      nova.calendar.updateNote("c", { title: `chat ${i}` });
      expect(titles(nova)).toEqual({ p: `page ${i}`, c: `chat ${i}` });
    }
  });
});

describe("a quest's card in Calendar", () => {
  const mix = { id: "mix", title: "Mix the EP", minutes: 60 };
  async function withQuest() {
    const nova = await boot("2026-10-07T09:00");
    nova.setQuests({ quests: [mix] });
    nova.plan.replan(); // its card appears in the calendar
    return nova;
  }

  it("moved on the page: the quest is pinned there", async () => {
    const nova = await withQuest();
    const page = load(nova);
    const card = page.notes.find((n) => n.id === "quest-mix")!;
    card.start = "2026-10-08T15:00";
    card.end = "2026-10-08T16:00";
    nova.calendarPage.saveFromPage(page, page.rev);
    expect(nova.quest("mix").fixedStart).toBe("2026-10-08T15:00");
    expect(nova.calendar.readCalendar().notes.find((n) => n.id === "quest-mix")!.start).toBe("2026-10-08T15:00");
  });

  it("renamed on the page: the quest is renamed", async () => {
    const nova = await withQuest();
    const page = load(nova);
    const card = page.notes.find((n) => n.id === "quest-mix")!;
    card.title = "✦ Mix the EP (stems)";
    nova.calendarPage.saveFromPage(page, page.rev);
    expect(nova.quest("mix").title).toBe("Mix the EP (stems)");
  });

  it("deleted on the page: it comes back, and the page is told how to drop the quest", async () => {
    const nova = await withQuest();
    const page = load(nova);
    page.notes = page.notes.filter((n) => n.id !== "quest-mix");
    const res = nova.calendarPage.saveFromPage(page, page.rev);
    expect(nova.calendar.readCalendar().notes.some((n) => n.id === "quest-mix")).toBe(true);
    expect(res.messages.join(" ")).toMatch(/Mix the EP/);
  });
});
