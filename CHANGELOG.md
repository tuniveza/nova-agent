# Changelog

## Unreleased

### Notices that keep out of the way, a drawer's handle, plain tiles

- Every notice (Agent's, each app's toasts, the bar's notes) keeps clear of where someone is typing,
  of a phone's keyboard and of any message box (web/shared/notices.js, linked by /shared/fit.js),
  sliding just above it and back afterwards; while something is dragged, notices fade and let the
  pointer through. Only the notice moves; nothing else on the page does.
- The Nova tiles' and dock's toggle is a drawer's handle: drag it down to close (or tap or click),
  pull up the handle left at the bottom to open.
- No Nova sparkle in the corner of each Nova tile and dock icon.

### Fixer: rows that make sense, nothing wider than the screen, the tiles never touching

- Never onto the next line now means a name's own words, and Nova Agent's own bars staying one row.
  Groups of choices (the Invoicer's colours and filters, chips, toolbars, Agent's suggestions,
  Console's commands, Observatory's filters) wrap onto more rows again instead of sliding sideways.
- One screen also counts a big part of a page sliding sideways (the page too wide in disguise).
- Auto-fix never makes what holds a fix wider (Notes in a narrow window was pushed past the edge),
  fixes a window or pop-up on the frame it opens and again once it's in, and waits for it to finish
  appearing; the Fixer waits for that too.
- The bars no longer go away on their own when a page puts the cursor in a box as it loads (turning a
  phone or tablet round, or loading, could leave them hidden).
- The Nova tiles are always at least 5px apart. Agent's notices never pile up past the top of the
  screen. Quests, Notes' guide and Console fit a very thin window.

### Fixer: Auto-fix, with nothing to approve

- Every screen of Nova Agent fixes what breaks the three rules as it draws (web/shared/rules.js,
  linked by /shared/fit.js): words a little smaller to stay on one line or uncut, a name that still
  can't fit kept whole with its row scrolling sideways, wrapping rows of chips and buttons made one
  row that scrolls inside, boxes that cut things off made to scroll, cards past the edge nudged in.
  Reading text still wraps. Only how things are drawn changes; it's all worked out again when the
  window changes size. On a local check of 96 screens: 115 problems with it off, a handful with it on.
- The Fixer's page: Auto-fix: On / Off (this device only), and how many parts were fixed on their
  own in the last check. The Notes list, slid away on a phone, is hidden too; the Invoicer keeps its
  preview on a very short window.

### Money: invoices, payments and expenses (Portal → Money, through Nova Bot)

- Portal → Money (Studio, after Clients): four tiles (in and out this month, owed, overdue), invoices
  grouped as waiting, overdue, waiting for payment, paid, and rejected or voided; expenses by month
  with the ones Agent noted to confirm; and the UK tax year with totals by category, the
  accountant's CSV and the invoice settings. Today has an "Invoices overdue" tile.
- An invoice is emailed to a client only after an admin presses Approve (twice) in a browser. The
  client gets a link to a printable page with card (Stripe) or bank transfer payment. Reminders
  wait for an Approve too. Payments, part paid and paid, and the client list's money keep in step.
- Receipts are kept on the studio PC (src/receipts.ts, `POST /actions/receipts`,
  `GET /receipts/<id>`), relayed for signed-in staff when online.
- Agent has five money tools: money_summary, list_invoices, draft_invoice, edit_invoice_draft and
  log_expense (unconfirmed). Nothing that sends, approves, reminds, voids, pays or changes settings.

### Quest 3: email campaigns with an admin's approval (through Nova Bot; since 2026-10-14 sent by the studio's own mail server)

- Agent has five campaign tools: suggest_campaign (who's opted in and how recent campaigns did;
  it saves nothing), create_campaign_draft, edit_campaign_draft, campaign_results (opened and
  clicked as percentages, in plain words) and list_campaigns. There's no send, schedule, approve
  or test tool: Agent says plainly that nothing is sent until an admin approves it.
- A campaign card under Agent's reply (subject, who it goes to and how many, when, the start of
  the email) with Approve / Edit / Reject on the person's own Portal sign-in online, or Open in
  Portal on the studio computer. Approve is pressed twice and checks the campaign hasn't changed.
- Portal → Campaigns (Studio; the badge counts the ones waiting): waiting ones first with the
  email in a sandboxed preview, Approve / Edit / Reject / Send me a test for admins, then
  scheduled, sent (delivered, opened %, clicked %, unsubscribed) and rejected ones; Write one;
  and the fan sign-up link with Copy and who's opted in.

### Quest 2: client list, and bookings from Acuity's calendar feed

- `ACUITY_SOURCE=feed` reads the studio's bookings from Acuity's private calendar feed through
  Nova Bot (`/nova-agent/bookings-feed`): for Acuity plans without the API. Agent's
  studio_bookings uses it (never the browser), and bookings are busy time for Quests and music
  time (every 10 minutes and on Nova Bot's "bookings changed" signal). The Acuity API tools and
  propose_booking_change aren't offered in feed mode. `.env.example` now suggests feed.
- Agent has four read-only client tools: client_find, client_history, clients_owing and
  clients_not_booked_since ("since July" means 1 July of the most recent July). Money in
  pounds, dates in UK time.
- Portal → Clients (Studio): search, filters (All, Owes money, Not booked since a month,
  Enquiries only), a page per client (sessions, contact, notes, money in pounds, marketing
  consent with where and when, and its history), Add a client; admins also Sync with Acuity
  now and Import from Acuity (the appointments or clients CSV, chosen or pasted).

### P0-2: edits always save, or say why

- Quest edits from the chat, the page or Nova Calendar are checked before they're saved.
  Unknown fields, times that can't be read, and values that don't fit are refused with
  the reason. Before, they were dropped or cut short without a word, and the chat still
  said "Updated". Common ways of writing a time are understood, and times with a zone
  are turned into UK time. After saving, the quest is read back from the file, and any
  change that didn't stick is reported.
- A repeat given a new interval counts its next session at the new spacing.
- `quests.json` and `calendar.json` each keep a last good copy (`.bak`). A damaged file
  is put aside and the good copy is used, with an alert. It is never read as empty and
  saved over.
- Nova Calendar saves are merged rather than written straight over the file.
  `calendar.json` has a revision number, and the page sends the revision it loaded, so a
  tab left open no longer wipes out what the chat or another tab changed. When the same
  card was changed in both places, the later change wins.
- A quest's card moved or renamed in Nova Calendar now changes the quest instead of
  snapping back. A deleted quest card comes back, with a note on how to drop the quest.
- The calendar page sends one save at a time. A save that doesn't get through (Nova
  Agent restarting) is kept in the browser and retried, with a banner until it lands,
  even across a reload. The Nova Agent page says "Not saved" when Nova Agent doesn't
  answer.
- Re-planning a mission keeps the quests you changed by hand (`edited`).

### P0-1: repeating reminders ping reliably

- Every phone ping now goes through a delivery ledger (`src/quests/deliveries.ts`,
  `data/nova.db`). Each one is keyed by quest + session + kind, so it's sent once. It is
  only counted as delivered when the worker says a phone took it (`phones > 0`). Failed
  pings are retried with backoff, and every attempt is logged with its error. A ping
  still undelivered when it's no longer useful is given up on, and the page shows it
  (`Didn't reach your phone: …`).
- A repeat only moves past a session once that session's ping is delivered, given up
  on visibly, or marked done. A session that passes with no ping (Nova Agent was off,
  or the clocks went forward) gets one late `Missed: …` ping. Slots jumped over are
  covered by that same ping.
- A repeat isn't finished at its deadline while its last ping is still on its way.
- Portal taps carry a tap id and the session they were tapped on. A tap handed over
  twice, or a late "Session done", no longer uses up the next session. This needs Nova
  Bot's worker change on branch `fix/p0-1-quest-taps`.
- Quest ids given in short form must match only one quest. An empty id matches
  nothing.
- `npm test` runs a simulated-clock harness (Vitest). It includes the BST/GMT changes
  on 25 Oct 2026 and 28 Mar 2027.

Known limitation: times are UK wall clock. On the night the clocks go back, the repeated
hour (01:00–02:00 GMT) has no sessions of its own, which leaves a 90-minute real gap.
