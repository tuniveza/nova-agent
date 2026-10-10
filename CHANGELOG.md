# Changelog

## Unreleased

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
