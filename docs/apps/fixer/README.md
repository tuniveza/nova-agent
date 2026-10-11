# Fixer

Nova Agent's caretaker. It checks Nova Agent every hour, keeps a list of what it found, takes fixer quests from admins, and prepares fixes with Claude Code. **Nothing goes live until an admin taps Approve**: every change, trivial ones included, waits for a person.

## What's new

- The Fixer joins Nova Agent: hourly checks, fixer quests, suggestions from Quests and Notes, approval cards with before and after pictures, and Undo.

## What it does

- **Hourly check** (scripted, no AI, so it costs nothing): Nova Agent's and Nova Bot's tests, Nova Agent's typecheck, a sweep of every panel at phone (390) and desktop (1280) width (script errors, console errors, files that don't load, sideways scrolling, buttons off the screen), and health: Nova Agent's server, the online link, Nova Bot, restarts, disk space and the data files. Once a day it also measures the sound levels against the calm rules.
- **Problems** are kept once each and cleared when they're gone. The admins' phones get one calm ping for a new serious problem, and one when a fix is ready to look at. Never repeated.
- **Fixer quests**: an admin adds a bug, a glitch or a change, with its details and priority.
- **Suggested**: quests (from Nova Agent and Notes) that look like work on Nova Agent itself. Tap **Adopt** to make one a fixer quest; nothing starts by itself.
- **Preparing a fix**: for a problem or a fixer quest (by itself for new problems, if that's on in Settings). One at a time, at most 10 a day, 30 minutes each. Each fix is made in its own copy of the code, then tested, typechecked and swept there, with pictures before and after.
- **Needs you**: the approval card says what changed and why, in plain English, shows the files and every line, the before and after pictures, what it means for you, whether it's a good idea (with the risks), and a recommendation. A tiny change to looks or wording is labelled **Trivial — safe to approve**. Tap **Approve**, **Reject**, or **Ask for a tweak** (your note goes with it and it's prepared again).
- **Approve** merges it, puts it live and checks again. If things got worse, the Fixer undoes it by itself and tells you: the only thing it ever does without a tap.
- **Done** lists what went live (with **Undo**), what was rejected and what couldn't be prepared. **Activity** is its diary.
- **Settings**: hourly checks on or off, preparing fixes by itself on or off, how many a day, and how long each may take.

## Inside Nova Agent

The Fixer is in the Panels window and on the bar, under Tools. It's for admins: on the studio PC its page counts as an admin; online, sign in to Portal as an admin (the PC must be on: the Fixer runs there).

## How it works

- `src/fixer/fixer.ts` is the Fixer itself; `rules.ts` is its judgement (what's off limits, what's trivial, when to undo, what looks like Nova Agent work); `store.ts` keeps `data/fixer.json`; `sweep.ts` is the browser sweep; `health.ts` the health check; `claude.ts` how Claude Code is asked; `routes.ts` its addresses; `service.ts` the schedule.
- Claude Code runs headless and confined: `claude -p --restricted --tools Read,Glob,Grep,Edit,Write,Bash --allowedTools Read Glob Grep Edit Write "Bash(npx vitest run)" "Bash(npx vitest run:*)" "Bash(npx tsc --noEmit)" --permission-mode acceptEdits --permission-prompts none --add-dir <the job's copies> --strict-mcp-config`, never with a skip-all-permissions flag, never with Nova Agent's keys. It doesn't run git: the Fixer commits its edits by name on the job's own branch, after checking nothing off limits was touched (secrets, migrations, data, payments, emails, Acuity, the deploy setup, the Fixer itself).
- Going live is locked in code: only an Approve tap makes the approval that merging and deploying need.
- `FIXER_DRY=1` makes it inert (checks can run; nothing is prepared, merged or deployed). `FIXER_NA_DIR`, `FIXER_NB_DIR`, `FIXER_RELEASE_DIR`, `FIXER_JOBS_DIR` and `FIXER_CLAUDE` say where things are.

## Tests

`test/fixer.spec.ts`: nothing merges or deploys without Approve (every kind of change, trivial included), when it undoes by itself, the trivial label, suggestions, one job at a time and the daily cap, settings, admin-only addresses, and old or damaged `fixer.json` files.
