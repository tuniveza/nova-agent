# Fixer

Nova Agent's caretaker, started again from the ground up on 16 October 2026. It checks all of Nova Agent against **three strict rules that are never compromised**, every 5 minutes, and shows what breaks them.

## What's new

- **From the ground up.** Everything the Fixer did before is off: no hourly checks, no looks, edges or buttons checks, no fixer quests, no fixes prepared by Claude Code, nothing waiting for Approve. What it had saved is kept aside on the server (`data/fixer-before-2026-10-16.json`), never deleted.
- **Three rules, every 5 minutes.** On the server, every 5 minutes, it opens Nova Agent and every app, plan, tool and helper at phone, tablet and computer sizes, and checks them against the three rules below.
- **Extremely thin or short windows too.** It also checks a 280px-wide window and a 320px-tall one. On a window that small, the navigation panel becomes one row of tiles that scrolls sideways inside itself. Each name shrinks to fit, and if it still can't fit it keeps its first few letters, at least one. The whole name stays the tile's tooltip.

- **Auto-fix, with nothing to approve.** Every screen of Nova Agent now fixes what breaks the three rules as it draws (`web/shared/rules.js`): words that would be cut short or go onto a second line get a little smaller (never under 72% of their size or 9px), a name that still can't fit stays whole on one line in a box of its own that slides sideways, one of Nova Agent's bars that would wrap becomes one row that slides inside itself, a box that cuts off what's in it scrolls instead, and a card past the edge is nudged back in. Nothing it does ever makes what holds it wider. A window or pop-up that opens is fixed on the next frame, and again once it has finished appearing. Reading text is left to wrap. It changes only how things are drawn, never any code or data, and everything goes back and is worked out again when the window changes size. It's on for everyone. **Auto-fix: On** on the Fixer's page turns it off on that device only (to see what it fixes), and back on.

## The three rules

1. **Never anything off the screen.** Nothing sticks out past the screen's edges, and nothing is cut off by the box it's in, including words cut short with "…". What's further down a box that scrolls is fine, because it can be scrolled to, and so is what's on a surface you drag around (Board's table).
2. **One screen.** The page itself never scrolls. Only boxes inside it do.
3. **Never onto the next line.** Buttons, links, names, labels, headings, tabs and the bars' words keep their words on one line, and Nova Agent's own bars (the Nova top panel, the Nova tiles and dock, the status line, or a row an app marks `data-one-row`) stay one row. Groups of choices (colours, filters, chips, toolbars) may wrap onto more rows, so every choice stays in sight instead of sliding off to the side (changed 16 October 2026). Reading text, like a paragraph, a message or a note, is left out because it's meant to wrap. A big part of a page that slides sideways counts against rule 2: it's the page being too wide.

## What it does

- **Checks every 5 minutes**, on the live site as everyone sees it. It signs in as the looks account, which can only look, and it never changes anything: every save is turned away before it leaves its browser.
- **Looks at every place:** Agent, Portal, Calendar, Notes, Board, Index, Quests, Fixer, Computer, Lossless, Observatory, Console, the Manual, the Invoicer and Nova. It looks at each one at 11 sizes:
  - phones: 360×640, 390×844, 412×915, and 844×390 on its side;
  - tablets: 768×1024 and 1024×768;
  - computers: 800×700 (a smaller or zoomed-in window), 1366×768 and 1920×1080;
  - extremely thin and short windows: 280×600 and 900×320.
- **Shows each problem once**, with every size it was seen at. Tap a size to see that screen with the problem outlined in red.

## Inside Nova Agent

The Fixer is a tool (Tools → Fixer, or `/agent/tools/fixer`), for admins only. The page is one screen:

- **The three rules** sit at the top, each one ✓ kept or ✕ with how many problems. Tap a rule to show only its problems.
- **When it last checked**, how many parts the screens fixed on their own in that check, **Auto-fix: On / Off** (this device) and a **Check now** button.
- **Phones, Tablets, Computers** filter the list.
- **The list of problems**, by place, is the only part that scrolls.

Computer shows the Fixer's line too: how many problems there are, and when it last checked.

## How it works

- `src/fixer/strict.ts` holds the three rules and the measuring. The measuring runs inside each page and inside each panel's own page, and leaves out what's hidden.
- `scripts/fixer-strict.ts` runs it as its own process, with low priority.
- `src/fixer/strict-service.ts` runs that every 5 minutes on the server. If a run is still going, the next one is skipped. It keeps the last run and a day of runs in `data/fixer-strict.json`, the pictures of the last few runs in `data/fixer-shots/strict/`, and answers `/fixer-api/state`, `/fixer-api/shots/…` and `/actions/fixer/check`. All of these are for admins only, and online Nova Bot passes them on.
- `web/shared/rules.js` is the auto-fix. `/shared/fit.js` links it, so every panel's page and Nova Agent's own have it. It looks once the page settles and again after changes stop for a moment (a page that never stops changing is still looked at about once a second), never mid-drag, and a busy page is looked at less often. A part can opt out with `data-rules="off"`. The check records how many parts each screen fixed (`fixed`), and `scripts/fixer-strict.ts --rules-off` checks with it off.
- The old Fixer's code (`src/fixer/fixer.ts` and the rest) is still in the repo, but it isn't started.

## Tests

`test/fixer-strict.spec.ts` checks the rules on real pages in a real browser:

- a button past the edge, words cut short with "…", and something cut off by its box;
- the page scrolling;
- a button, heading, status-line word or row wrapping onto a second line;
- and what's fine: a box that scrolls, Board's table, hidden things, reading text, and an icon above its name.

`test/rules.spec.ts` checks the auto-fix on real pages: after it has looked, the Fixer's own measuring finds nothing (a wrapping button, a name too long even when smaller, a wrapping row of chips, words cut short, a box that cuts off, a card past the edge, something past the right of the page), and it leaves reading text, a slid-away drawer and `data-rules="off"` alone, puts everything back when the window changes size, and when switched off.

It also checks the service:

- each run is low priority and signed in through the environment, never the command line;
- a run that's still going means the next one is skipped;
- the old data is kept aside;
- the addresses are for admins only.
