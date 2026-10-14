# Fixer

Nova Agent's caretaker. It checks Nova Agent every hour, keeps a list of what it found, takes fixer quests from admins, and prepares fixes with Claude Code. **Nothing goes live until an admin taps Approve**: every change, trivial ones included, waits for a person.

## What's new

- **Needs you is one clear card at a time.** Each fix fills the part as a big card, with no long list of pictures and text. Its name is in big letters, like "Portal's sign-in cut off on phones", with chips for how serious it is, which panel it's on, and where it's up to: **Preparing…**, **Checking**, **Ready for you**, **Going live…**, **Live** or **Rejected**. Under the name are four short rows:
  - **What's wrong**
  - **Why**
  - **The fix**
  - **Where**: the screen sizes. Tap one to see that picture.

  Next to the rows is one big picture with the problem **outlined in red**. Tap **After** to see the same place, outlined in green, after the fix, and tap the picture to see it full screen. The long version (what changed, risks, the recommendation, the checks, the files and every line) is folded away under **Details**.

  **Approve** (green), **Reject** (red), **Tweak** (say what to change; it's prepared again) and **Later** (moved to the back for 3 hours) are always at the bottom, so they never scroll away. To move between fixes, use ‹ ›, the "2 of 5" counter, and the row of fix names above the card. On a computer, ← → also move between fixes, A twice approves, R twice rejects, and B / F switch between before and after.

  A fix that's still being prepared shows the problem straight away, with the looks check's own picture, and says it's being prepared. Claude Code now writes each card's short name and its three one-line answers, and older cards get theirs from what the check saw.

  The looks check now remembers where on the screen each problem is, so it can be outlined.
- The page never scrolls. Only the card's words (and Details) scroll inside the card, on a big screen, a laptop, a tablet and a phone, including a phone held sideways, where the four buttons stand in a column on the right. On a phone or short screen, the four numbers at the top step aside while Needs you is open. The tabs still show the counts, and Check now is in Health.
- **Looks**: the Fixer now checks how everything LOOKS, the way you see it. Every hour and a few minutes after each update, it opens Nova Agent and every panel inside it, signed in and signed out, at six sizes (360×740, 390×844, 1024×768, 1440×900, 1512×1500 and 2000×1130). It looks for big empty gaps, blank panels, a panel's header sitting low, the title panel or navigation panel covering a panel, more than one title panel, pages that scroll or are cut off at the bottom, buttons off the screen, cut-off text, errors and slow panels. Each problem comes with a picture and says every size it was seen at; a fix for it is looked at again at those sizes, with the before and after side by side. **Check looks now** is in Health; it can be switched off in Settings.
- The looks check only looks: it signs in as a built-in test account that Nova Bot makes for that one check and deletes after. The account has no password and Nova Bot lets it do nothing but look (no emails, posts, bookings, approvals or saves), and the check's own browser stops anything that would change something before it leaves.
- When Claude Code isn't signed in on the server, the Fixer says so at the top ("Sign Claude Code in to let me prepare fixes"); checks still run and report.
- Everything at once on a wide screen: Needs you down the left, Health, Fixer quests and Suggested along the top, Done, Activity and Settings below, each scrolling inside itself. No tabs (on a phone the parts are still one at a time, behind the tabs).
- One problem, wherever it's seen: a file that didn't load on Notes, Index and Observatory is one problem ("· on Notes, Index and Observatory at 390px") with one fix, not three.
- A fix whose problem has gone by itself (fixed another way) is closed, instead of sitting "blocked".
- No false alarms when Nova Bot blips: Nova Bot not answering, or a file failing with 502/503/504, is checked again (3 tries over about 2 minutes) before it counts, and never has a fix prepared.
- The sweep only looks: its browser can't make notes, calendar items, quests or anything else (it once made 16 "Welcome to Notes" notes).
- The Fixer joins Nova Agent: hourly checks, fixer quests, suggestions from Quests and Notes, approval cards with before and after pictures, and Undo.

## What it does

- **Hourly check** (scripted, no AI, so it costs nothing): Nova Agent's and Nova Bot's tests, Nova Agent's typecheck, a sweep of every panel at phone (390) and desktop (1280) width (script errors, console errors, files that don't load, sideways scrolling, buttons off the screen), and health: Nova Agent's server, the online link, Nova Bot, restarts, disk space and the data files. Once a day it also measures the sound levels against the calm rules.
- **Problems** are kept once each and cleared when they're gone. The same problem seen on several panels or widths is one problem that says where it was seen. Nova Bot not answering for a moment (or a file failing because of it) is checked again a few times before it counts. The admins' phones get one calm ping for a new serious problem, and one when a fix is ready to look at. Never repeated.
- **Fixer quests**: an admin adds a bug, a glitch or a change, with its details and priority.
- **Suggested**: quests (from Nova Agent and Notes) that look like work on Nova Agent itself. Tap **Adopt** to make one a fixer quest; nothing starts by itself.
- **Preparing a fix**: for a problem or a fixer quest (by itself for new problems, if that's on in Settings). One at a time, at most 10 a day, 30 minutes each. Each fix is made in its own copy of the code, then tested, typechecked and swept there, with pictures before and after.
- **Needs you**: the approval card says what changed and why, in plain English, shows the files and every line, the before and after pictures, what it means for you, whether it's a good idea (with the risks), and a recommendation. A tiny change to looks or wording is labelled **Trivial — safe to approve**. Tap **Approve**, **Reject**, or **Ask for a tweak** (your note goes with it and it's prepared again).
- **Approve** merges it, puts it live and checks again. If things got worse, the Fixer undoes it by itself and tells you: the only thing it ever does without a tap.
- **Done** lists what went live (with **Undo**), what was rejected and what couldn't be prepared. **Activity** is its diary.
- **Looks** (in Health): when the looks check last ran, how many screens it saw, and a picture of each one that didn't look right, with what was wrong. Tap a picture to see it big.
- **Settings**: hourly checks on or off, preparing fixes by itself on or off, looks checks on or off, how many a day, and how long each may take.

## Inside Nova Agent

The Fixer is in the Panels window and on the bar, under Tools. It's for admins: sign in to Portal as an admin. The Fixer runs on the VPS with Nova Agent, so it keeps checking with every laptop off.

## How it works

- The sweep only looks: every request its browser makes to Nova Agent carries the `x-nova-fixer-sweep` header, and Nova Agent's server turns away anything that would change something (`src/fixer/sweep-guard.ts`).
- The looks check: `src/fixer/looks.ts` measures each screen inside the page (where the content is, top to bottom; the bars; the panel's frame) and judges it with plain rules; `scripts/fixer-looks.ts` runs it as its own process, with low priority (`nice`), one browser and one page at a time. Its browser answers every write itself ("the Fixer's check only looks"), opens no WebSockets and runs no service worker. Signed in, it uses Nova Bot's looks account (`POST /nova-agent/looks-session`, Nova Agent's key; Nova Bot's `src/looks-account.js`): no password, a 45-minute session, deleted after the check, refused for anything but looking, and left out of the team list. The token goes to the check in its environment, never on a command line or in a log. After each update: the live pages' `X-Nova-Build` changes, and a few minutes later the check runs.
- `src/fixer/fixer.ts` is the Fixer itself; `rules.ts` is its judgement (what's off limits, what's trivial, when to undo, what looks like Nova Agent work); `store.ts` keeps `data/fixer.json`; `sweep.ts` is the browser sweep; `health.ts` the health check; `claude.ts` how Claude Code is asked; `routes.ts` its addresses; `service.ts` the schedule.
- Claude Code runs headless and confined: `claude -p --restricted --tools Read,Glob,Grep,Edit,Write,Bash --allowedTools Read Glob Grep Edit Write "Bash(npx vitest run)" "Bash(npx vitest run:*)" "Bash(npx tsc --noEmit)" --permission-mode acceptEdits --permission-prompts none --add-dir <the job's copies> --strict-mcp-config`, never with a skip-all-permissions flag, never with Nova Agent's keys. It doesn't run git: the Fixer commits its edits by name on the job's own branch, after checking nothing off limits was touched (secrets, migrations, data, payments, emails, Acuity, the deploy setup, the Fixer itself).
- Going live is locked in code: only an Approve tap makes the approval that merging and deploying need.
- `FIXER_DRY=1` makes it inert (checks can run; nothing is prepared, merged or deployed). `FIXER_NA_DIR`, `FIXER_NB_DIR`, `FIXER_RELEASE_DIR`, `FIXER_JOBS_DIR` and `FIXER_CLAUDE` say where things are.

## Tests

`test/fixer-card.spec.ts`: where a problem is on its picture (each kind), the card's short headline asked of Claude Code and read back (older answers still read), and the page's one-card deck with every part of the Fixer kept. `scripts/shots-fixer.mjs <out> [pictures]`: the card with sample fixes at six sizes (no server), checking the page never scrolls and Approve stays on screen. `test/fixer.spec.ts`: one problem wherever it's seen, closing fixes whose problem has gone, Nova Bot blips, nothing merges or deploys without Approve (every kind of change, trivial included), when it undoes by itself, the trivial label, suggestions, one job at a time and the daily cap, settings, admin-only addresses, and old or damaged `fixer.json` files. `test/fixer-sweep-guard.spec.ts`: a real sweep of a page that tries to save can't make shared notes, calendar items or quests. `test/fixer-looks.spec.ts`: real pages in a browser: the Index gap of 14 October (an empty box on top, its header and numbers low) is caught, an ordinary empty state and a centred sign-in card aren't, blank panels, gaps, bars covering a panel, unused space, scrolling and cut-off pages, cut-off text; one problem per panel and kind. The looks part of `test/fixer.spec.ts`: problems with pictures, a ping, a fix looked at again where it was seen with before and after, and still nothing goes live without Approve. Nova Bot's `test/looks-account.spec.js`: only Nova Agent's key makes the account, it can only look, it isn't listed, and it's gone after.
