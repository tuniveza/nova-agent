<div align="center">

<img src="../../../web/calendar/assets/icon.svg" width="96" alt="The Calendar icon: a glowing crescent-moon C with three stars">

# Calendar

> **A Nova Agent panel.** Its code is in `web/calendar/` in Nova Agent's repo, and it opens inside Nova Agent at `/agent/calendar`.

**The studio's calendar: events, day cards, Nova Agent's plan and the studio's bookings, in one place.**

</div>

---

## What you can do

- **See it your way:** Month, Week, Day or List. Arrows (or a swipe) move on, **Today** comes back, and tapping the month's name jumps to any date. A pink line shows the time now.
- **Add:** the **+** button, a tap on an empty time (Week and Day), or a double-click on a day (Month, on a computer). Typing is quickest: `Mix review Friday 2pm 1h @Studio A` fills everything in.
- **Change:** tap an event to edit it. On a computer, drag it to move it and drag its bottom edge to make it longer; on a phone, hold it for a moment, then drag.
- **Repeat:** every day, week, month or year, or a custom rule (every 2 weeks on Mon and Wed, until a date or a number of times). Changing or deleting one of them asks: just this one, this and the ones after, or every one.
- **Reminders:** at the start, 10 or 30 minutes, an hour or a day before. They arrive on phones as alerts, even when the studio PC is off.
- **Delete** with **Undo** (a few seconds to change your mind), **duplicate**, pick a **colour**, add **where** and **notes**.
- **Day cards:** birthdays, release days, holidays and more, shown across the top of the day (every year if you like).
- **What to show** (the layers button): your events, day cards, Quests (Nova Agent's plan: read-only here, change them in Quests) and studio bookings (read-only, from the diary).
- **Search** every event by title, place or notes.

## Works with Nova Agent

- Ask in Chat: "Add a mix review Friday at 2 for an hour at Studio A", "Move it to 4", "Make the standup repeat every weekday", "Remind me 10 minutes before", "Delete it".
- Nova Agent's planner keeps Quests out of your events (every time a repeating one happens). All-day events are markers, like day cards, not busy time.

## Where it's kept

The calendar lives on Nova Bot (its D1 database, `calendar_items`), so it's the same on every phone and computer and keeps working when the studio PC is off. Each browser keeps a copy so it opens instantly and works offline; changes made offline save when you're back. The latest change wins; if another device changed something later, Calendar shows that and says so.

Nova Agent on the studio PC keeps its own copy (`data/calendar.json`, read by its chat and planner) in step with Nova Bot every few seconds (`src/calendar/cloud.ts` ⇄ `POST /nova-agent/calendar`).

Anything an earlier version of Calendar saved in a browser is brought in the first time it opens there (once, never twice).

## For developers

| File | What it is |
|---|---|
| `web/calendar/js/cal.js` | The views, the editor, drag, keys |
| `web/calendar/js/data.js` | Saving to Nova Bot, the offline copy and queue, bringing in old data |
| `web/calendar/js/recur.js` | Repeat rules (shared with Nova Agent's planner and Nova Bot's reminders) |
| `web/calendar/js/quickadd.js` | "Mix review Friday 2pm 1h" → an event |
| Nova Bot `src/calendar/items.js` | `GET/PUT/DELETE /app/api/calendar/items`, Nova Agent's sync |
| Nova Bot `src/calendar/reminders.js` | Reminders on phones (every minute) |

Keys: ← → move, **T** today, **N** new, **M W D L** views, **Esc** closes.
