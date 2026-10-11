// Calendar: the rules that keep an edit from being lost, kept apart so they can be tested
// (test/calendar-edits.spec.ts). Used by cal.js (the editor) and data.js (saving).
//
//   whichTimes(it, was, fields, ask): saving a change to a repeating note card. The question
//     "Change which?" is asked with the editor still open: Cancel (null) means stay in the
//     editor with nothing lost. Only the reminders changed: every time, no question.
//   onlyRemindersChanged(it, was, fields): nothing but the reminders (or their phones) differs
//   ruleChanged(it, fields): the repeat rule itself was changed (the whole series, no question)
//   stamped(item, current, now, newId): a save, and what's sent: it carries `base`, the version
//     the change was made to, so a device whose clock is behind still has the newest change
//   queued(queue, op): only the latest change to each card waits to go, still saying the
//     version the first one was made to

import { cleanRepeat, minutesBetween } from "./recur.js";

// Nothing but the reminders (or which phones get them) differs from this time of the event
export function onlyRemindersChanged(it, was, fields) {
  const same = (a, b) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
  const length = minutesBetween(it.start, it.end);
  return (
    fields.start === was &&
    minutesBetween(fields.start, fields.end) === length &&
    ["title", "location", "body", "color", "allDay"].every((k) => same(fields[k], k === "allDay" ? Boolean(it[k]) : it[k] || (k === "color" ? "violet" : ""))) &&
    same(fields.art, it.art || fields.art)
  );
}

// The repeat rule was changed (a repeating one only)
export const ruleChanged = (it, fields) => Boolean(it.repeat) && JSON.stringify(cleanRepeat(it.repeat)) !== JSON.stringify(fields.repeat);

// Which times of a repeating note card a change is for: undefined when there's nothing to ask
// (not repeating, or its rule changed), "all" when only reminders changed, else the answer to
// ask() ("one", "following", "all", or null for Cancel: keep the editor open)
export async function whichTimes(it, was, fields, ask) {
  if (!it.repeat || ruleChanged(it, fields)) return undefined;
  if (onlyRemindersChanged(it, was, fields)) return "all";
  return (await ask()) || null;
}

// A save: the card as kept here (`out`), and as sent (`sent`, with `base` when it changes a known version)
export function stamped(item, current, now, newId) {
  const out = { ...item, id: item.id || newId(), created: item.created || now, updated: now };
  const base = current(out.id)?.updated;
  delete out.base;
  return { out, sent: base ? { ...out, base } : out };
}

// The queue with this change in it: one change per card, the newest, made to the first one's version
export function queued(queue, op) {
  const idOf = (q) => (q.op === "put" ? q.item.id : q.id);
  const id = idOf(op);
  const replaced = queue.find((q) => q.op === "put" && q.item.id === id && q.item.base);
  if (replaced && op.op === "put") op = { ...op, item: { ...op.item, base: replaced.item.base } };
  return [...queue.filter((q) => idOf(q) !== id), op];
}
