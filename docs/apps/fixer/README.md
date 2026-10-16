# Fixer

Nova Agent's caretaker, started again from the ground up on 16 October 2026. It checks all of Nova Agent against **three strict rules that are never compromised**, every 5 minutes, and shows what breaks them.

## What's new

- **From the ground up.** Everything the Fixer did before is off: no hourly checks, no looks, edges or buttons checks, no fixer quests, no fixes prepared by Claude Code, nothing waiting for Approve. What it had saved is kept aside on the server (`data/fixer-before-2026-10-16.json`), never deleted.
- **Three rules, every 5 minutes.** On the server, every 5 minutes, it opens Nova Agent and every app, plan, tool and helper at phone, tablet and computer sizes, and checks them against the three rules below.
- **Extremely thin or short windows too.** It also checks a 280px-wide window and a 320px-tall one. On a window that small, the navigation panel becomes one row of tiles that scrolls sideways inside itself. Each name shrinks to fit, and if it still can't fit it keeps its first few letters, at least one. The whole name stays the tile's tooltip.

## The three rules

1. **Never anything off the screen.** Nothing sticks out past the screen's edges, and nothing is cut off by the box it's in, including words cut short with "…". What's further down a box that scrolls is fine, because it can be scrolled to, and so is what's on a surface you drag around (Board's table).
2. **One screen.** The page itself never scrolls. Only boxes inside it do.
3. **Never onto the next line.** Buttons, links, names, labels, headings, tabs and the bars' words stay on one line, and a row of things (a toolbar, the status line, a row of chips) never wraps onto a second row. Reading text, like a paragraph, a message or a note, is left out because it's meant to wrap.

## What it does

- **Checks every 5 minutes**, on the live site as everyone sees it. It signs in as the looks account, which can only look, and it never changes anything: every save is turned away before it leaves its browser.
- **Looks at every place:** Agent, Portal, Calendar, Notes, Board, Index, Quests, Missions, Fixer, Computer, Lossless, Observatory, Console, the Manual, the Invoicer and Nova. It looks at each one at 10 sizes:
  - phones: 360×640, 390×844, 412×915, and 844×390 on its side;
  - tablets: 768×1024 and 1024×768;
  - computers: 1366×768 and 1920×1080;
  - extremely thin and short windows: 280×600 and 900×320.
- **Shows each problem once**, with every size it was seen at. Tap a size to see that screen with the problem outlined in red.

## Inside Nova Agent

The Fixer is a tool (Tools → Fixer, or `/agent/tools/fixer`), for admins only. The page is one screen:

- **The three rules** sit at the top, each one ✓ kept or ✕ with how many problems. Tap a rule to show only its problems.
- **When it last checked**, and a **Check now** button.
- **Phones, Tablets, Computers** filter the list.
- **The list of problems**, by place, is the only part that scrolls.

Computer shows the Fixer's line too: how many problems there are, and when it last checked.

## How it works

- `src/fixer/strict.ts` holds the three rules and the measuring. The measuring runs inside each page and inside each panel's own page, and leaves out what's hidden.
- `scripts/fixer-strict.ts` runs it as its own process, with low priority.
- `src/fixer/strict-service.ts` runs that every 5 minutes on the server. If a run is still going, the next one is skipped. It keeps the last run and a day of runs in `data/fixer-strict.json`, the pictures of the last few runs in `data/fixer-shots/strict/`, and answers `/fixer-api/state`, `/fixer-api/shots/…` and `/actions/fixer/check`. All of these are for admins only, and online Nova Bot passes them on.
- The old Fixer's code (`src/fixer/fixer.ts` and the rest) is still in the repo, but it isn't started.

## Tests

`test/fixer-strict.spec.ts` checks the rules on real pages in a real browser:

- a button past the edge, words cut short with "…", and something cut off by its box;
- the page scrolling;
- a button, heading, status-line word or row wrapping onto a second line;
- and what's fine: a box that scrolls, Board's table, hidden things, reading text, and an icon above its name.

It also checks the service:

- each run is low priority and signed in through the environment, never the command line;
- a run that's still going means the next one is skipped;
- the old data is kept aside;
- the addresses are for admins only.
