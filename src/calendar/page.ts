// Saves from the Nova Calendar page (PUT /calendar-api/data).
//
// The page sends the whole calendar, as it was when it loaded plus its own
// changes. Written straight over the file, a tab left open would wipe out what
// the chat (or another tab) changed since, and edits to a quest's card would
// just snap back at the next re-plan. Instead:
//   - the page says which revision it loaded; what it changed since then is
//     merged with what changed elsewhere (a card changed in both: the later wins)
//   - if that revision isn't known any more (Nova Agent restarted), its
//     additions and changes are kept but nothing is deleted, and it's told so
//   - a quest's card moved on the page pins the quest there; renamed, renames
//     it; deleted, it comes back (the quest is dropped from the chat or the plan)

import { updateQuest } from "../quests/actions";
import { calendarAtRev, calendarEvents, normalise, readCalendar, writeCalendar, type CalendarData, type DayCard, type NoteCard } from "./store";

// Cards Nova Agent makes from the plan: the plan is where they're changed
const DERIVED = /^(quest|block|mile)-/;
// The mark in front of a quest card's title (✦ planned, ∞ ongoing, ⚠ at risk, ✓ done)
const MARK = /^[✦∞⚠✓]\s*/;

type Card = NoteCard | DayCard;
const same = (a: Card | undefined, b: Card | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const byId = <T extends Card>(list: T[]) => new Map(list.map((x) => [x.id, x]));

// Three-way merge of one list of cards: the page's changes since `base` on top of `current`.
// With no base, nothing the page lacks is deleted.
function mergeCards<T extends Card>(base: T[] | undefined, page: T[], current: T[], dropped: string[]): T[] {
  const b = base && byId(base);
  const p = byId(page);
  const c = byId(current);
  const out: T[] = [];
  for (const id of new Set([...c.keys(), ...p.keys(), ...(b ? b.keys() : [])])) {
    if (DERIVED.test(id)) continue;
    const was = b?.get(id);
    const mine = p.get(id);
    const theirs = c.get(id);
    const pageChanged = b ? !same(was, mine) : mine !== undefined && !same(mine, theirs);
    const elsewhereChanged = b ? !same(was, theirs) : false;
    let keep: T | undefined = theirs;
    if (pageChanged && !elsewhereChanged) keep = mine;
    else if (pageChanged && elsewhereChanged) {
      // Both changed it: the later change wins; a deletion never beats an edit
      if (!mine) keep = theirs;
      else if (!theirs) keep = mine;
      else keep = mine.updated >= theirs.updated ? mine : theirs;
    } else if (!b && mine && theirs) {
      keep = mine.updated >= theirs.updated ? mine : theirs;
    }
    if (!b && !mine && theirs) dropped.push(("title" in theirs && theirs.title) || id);
    if (keep) out.push(keep);
  }
  return out;
}

export function saveFromPage(raw: unknown, baseRev: number): { rev: number; messages: string[] } {
  const page = normalise(raw);
  const base: CalendarData | undefined = Number.isInteger(baseRev) ? calendarAtRev(baseRev) : undefined;
  const current = readCalendar();
  const messages: string[] = [];
  const dropped: string[] = [];
  const derived = current.notes.filter((n) => DERIVED.test(n.id));
  const merged: CalendarData = {
    ...current,
    notes: [...mergeCards(base?.notes, page.notes, current.notes, dropped), ...derived],
    days: mergeCards(base?.days, page.days, current.days, dropped),
    prefs: page.prefs,
  };
  if (!base && dropped.length) messages.push(`This page had an older copy of the calendar, so nothing was deleted from it (${dropped.slice(0, 3).join(", ")}${dropped.length > 3 ? "…" : ""}). Delete again if you meant to.`);

  // Quest cards: what the page changed on them goes to the quests themselves
  const was = byId(base?.notes ?? current.notes);
  const mine = byId(page.notes);
  const edits: { id: string; title?: string; fixedStart?: string }[] = [];
  for (const card of derived) {
    if (!card.id.startsWith("quest-")) continue;
    const before = was.get(card.id);
    const after = mine.get(card.id);
    if (!before) continue;
    if (!after) {
      messages.push(`“${card.title.replace(MARK, "")}” is a Nova Quest, so its card stays. To drop it, skip or remove the quest in Nova Agent.`);
      continue;
    }
    const edit: (typeof edits)[number] = { id: card.id.slice("quest-".length) };
    if (after.start !== before.start) edit.fixedStart = after.start;
    if (after.title !== before.title) edit.title = after.title.replace(MARK, "").trim();
    if (edit.fixedStart || edit.title) edits.push(edit);
  }

  // Changes made elsewhere since the page loaded: the page refreshes to show them
  const tookOthers = !!base && base.rev !== current.rev;
  writeCalendar(merged, tookOthers || !base);
  for (const e of edits) {
    try {
      updateQuest(e.id, { ...(e.title && { title: e.title }), ...(e.fixedStart && { fixedStart: e.fixedStart }) });
    } catch (error) {
      messages.push(`Couldn't change that quest: ${(error as Error).message}`);
    }
  }
  // The quest changes re-drew their cards (or one came back): the page refreshes to show them
  if (edits.length || messages.length) calendarEvents.emit("change");
  return { rev: readCalendar().rev, messages };
}
