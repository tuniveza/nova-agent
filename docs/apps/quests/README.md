# Quests

Every quest in one place. Write one the way you'd say it, tick it off, and choose how to see them: one thing at a time, a list, a board, or hour by hour. They're the same quests as Nova Agent's own (today's plan beside Agent), Notes and Portal: a change in one shows in all of them.

## What's new

- **Quests opens in Today** (hour by hour) unless you choose another: the options row under the bar → **Opens in** Today, Focus, List or Board. Remembered on the device. Today's plan is no longer a separate icon in Plans: it's this view.
- **Quests is a panel of its own**, in Nova Agent's Plans (and on the phone's bar): quick add in everyday words, Focus, List, Board and Today, steps, tags, drag to reorder, Calm, and keyboard shortcuts. Today's plan beside Agent is still there (**Today** on the bar).

## What it does

- **Quick add.** Type in the box at the top and press Enter: “tomorrow 3pm call Sam !high #studio 30m”. Under the box you see what was understood before you add it. It understands:
  - **when**: today, tonight, tomorrow, monday… (or mon, tue, wed, thu, fri; “on sat”, “on sun”), next friday, in 3 days, in 20 min, 14/10, 14 oct, 3pm, 15:00, at 9, noon, morning / afternoon / evening;
  - **finish by**: by friday, by 5pm, due tomorrow;
  - **how long**: 30m, 45 min, 1h, 1h30, 2 hours;
  - **priority**: !low, !high, !critical (! or !! is high, !!! critical);
  - **tags**: #studio #mix;
  - **repeats**: daily, weekdays, weekly, every monday, every 30 min, every 2 hours.
  A day with no time means some time that day; Nova plans it into free time. The button beside **Add** opens the details first.
- **Focus.** One quest, big: **Done**, **Start it** (or **15 more minutes**), **Not now** (the next one) and **Details**. Its steps tick off right there. Underneath: what's next.
- **List.** Everything in plain groups: Now, Overdue, Today, Coming up, Any time, and Done (folded). Tick the circle to finish one (tick again to undo). Drag the dots on the left to put them in your own order (or **Alt** + **↑ ↓** from the keyboard): your order stays.
- **Board.** A column for each “how it's going” (Waiting, Soon, Working on it, Nearly finished, Done; Taking longer and Questions when they have something). Drag a card to another column, or tap its chip.
- **Today.** Today and the next week, hour by hour, and what hasn't got a time yet (**Plan them now** fits them in).
- **Details.** Tap a quest: its name, when, finish by, how long, repeat, how it's going, priority, steps (tick, change, remove), tags, notes and where. **Delete** has **Undo** for a few seconds.
- **Find.** The magnifier (or **/**): words in names, notes and steps, or #tag. The tag chips under the box show only that tag.
- **Calm.** The moon (or **C**): fewer things on screen, less colour, nothing moving, at most five in a group and only today in Today. Remembered on the device.
- **Little celebrations.** A quiet word when you finish one (how many today, days in a row), and the days-in-a-row count at the top. Off in Options.
- **Options** (always on screen, in a row under the bar; it slides sideways if the screen is narrow): Everyone's quests (admins), Little celebrations, Reminders on my phone, Show what's done, **Opens in** (Today, Focus, List or Board; Today unless you change it), Re-plan from now, Keyboard shortcuts.

## Keyboard

**N** or **Ctrl+K** add · **/** find · **1 2 3 4** Focus, List, Board, Today · **C** Calm · **J K** (or ↓ ↑) move between quests · **X** or **Space** done · **E** or **Enter** details · **Alt+↑ ↓** move in the list · **Delete** delete (with Undo) · **?** all of these · **Esc** close.

## For everyone

Big buttons and tick circles, every button named for screen readers, and what changed said out loud (done, added, moved). Less motion when the device asks for it (or Calm), stronger edges when it asks for more contrast, and the system's colours in high-contrast mode.

## How it works

The page is `web/quests/` (`js/parse.js` reads quick add, `js/sort.js` groups and sorts, `js/quests.js` draws it). Its quests come from Nova Agent: `GET /quests/state` and `/quests/events` (live), and `POST /actions/quests`, `/actions/quests/<id>` and `/actions/quests/order` (drag and drop) in `src/visualizer/server.ts`; online the same addresses go through Nova Bot's link. A quest keeps `steps`, `tags` and `order` for this panel (`src/quests/store.ts`). Tests: `test/quests-panel.spec.ts`.
