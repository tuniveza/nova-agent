# Acuity admin UI: what the real pages look like

Notes from a read-only look around the Novacane Studios Acuity admin on
2026-10-05. Use these instead of guessing when building tasks. If Acuity
changes its layout, update this file.

Business timezone: **Europe/London**. All times on the admin pages are in it.

## Big safety finding

**Cancelling is a plain GET request** (`/appointments.php?action=cancel&apptId=…`),
the same kind of request as opening a page. So "only allow GET" is NOT a
safe way to stop accidental changes. The dry-run safety must stop *before
the final click*. Every form that changes something includes a
`__csrf_magic` token, which is a reliable sign of a change-making request.

## Addresses (stable URLs)

| What | URL |
|---|---|
| Week view (Mon to Sun containing that day) | `/appointments.php?view=thisWeek&day=YYYY-MM-DD&scale=1` |
| Day view | `/appointments.php?view=day&day=YYYY-MM-DD` |
| Month view | `/appointments.php?view=thisMonth&day=YYYY-MM-DD&scale=1` (counts only, no details) |
| One appointment | `/appointments/view/<appointmentId>` |
| Reschedule one | `/appointments.php?action=reschedule&appt=<appointmentId>` |
| New appointment form | `/appointments.php?action=new` |

Opening `/appointments.php` with no parameters shows **whatever view was last
used**, so always use the full URLs above.

## Reading appointments (calendar week view)

Appointment blocks are NOT exposed as buttons or links in the accessibility
tree, so `resolve()` (role-based) can't find them. Read them from the HTML
using Acuity's own test IDs:

- Each day column: `[data-testid="appointment-listing-container"]` with a `date="YYYY-MM-DD"` attribute.
- Each appointment: `[data-testid="appt-container"]` inside it, with
  - `id="appt:<appointmentId>:<calendarId>"`
  - `start="16:30"` and `end="18:30"`
  - `title="Client Name:\n£Appointment Type\n16:30-18:30"` (the `£` prefix appears before the type)
- "Busy / Unavailable" blocks are blocked-off time, not appointments.

## One appointment's page

Buttons/links (with test IDs): **Edit** (`edit-appt-button`), **Reschedule**
(`appointment-options-reschedule`), **Cancel** (`cancel-appointment-btn`).
Shows client name (`appt-details-client-name`), phone (`tel:` link), email
(`mailto:` link), price/payment (`payment-price-text`), appointment notes, and
client history.

**Cancel** opens an "Are you sure?" pop-up containing:
- checkbox "Mark as no-show"
- checkbox "Send email to client" (ticked by default)
- textarea "Include note to client (optional)"
- button **Cancel Appointment** (`confirm-delete-appointment-button`): the final, destructive click.

**Edit** switches the panel into edit mode, with:
- textboxes "First Name", "Last Name", "Phone", "Email", "Total Price"
- appointment type dropdown (`appointment-type-select`)
- checkbox "Paid"
- textbox "Private notes about appointment" (`notes-textarea`)
- button **Save** (`save-edit-appt`) and link **Cancel Editing** (`cancel-edit-appt`)

⚠️ "Cancel Editing" vs "Cancel" (the appointment): intents must be precise so
the AI never confuses them.

Date/time is NOT editable in Edit; that's **Reschedule**.

## Reschedule page

"Reschedule <client> From <date, time> to …", then:
- a month grid; each available date is `td.scheduleday.activeday` with `day="YYYY-MM-DD"`
- picking a date loads times as radio buttons named "10:00", "10:30", … (each appears twice; use the visible one)
- button "Custom" (pick a time outside normal availability)
- button **Reschedule Appointment** (disabled until a time is picked) plus a "Toggle Dropdown" button next to it
- link "cancel" back to the appointment

## New appointment form (`?action=new`, or Add → "Add new appointment")

Sections in order:
1. **Appointment Type** dropdown (first option "Choose appointment type...")
2. **Date & Time**: client's time zone dropdown, then the same month grid and time radios as Reschedule, plus a "Recurring" button
3. **Client Name**: textboxes "First Name *", "Last Name *", "Phone", "Email"
4. **Forms and Notes**: intake form questions and notes
5. Button **Schedule Appointment** (disabled until required fields are filled) plus a "Toggle Dropdown" (options not yet seen)

## Appointment types (as of 2026-10-05)

- Rap Package: 1 song (2h, £100), 2 songs (4h, £200), 4 songs (8h, £400)
- Singer Package: 1 song (4h, £200), 2-3 songs (8h, £400)
- Custom Music Production (3h, £250)
- Voiceover Recording with Engineer: 1h £80, 2h £140, 4h £240, 8h £400
- Studio Rental without Engineer: 2h £60, 4h £120, 8h £200

## Read-only requests that look like changes

These POSTs only *fetch* data and are safe: `schedule.php?action=showCalendar`,
`showTimes`, `availableTimes`, `getApptTypesForCalendar`, `appointments.php?action=getForms`.

## Not useful

- The calendar's Search box doesn't give a simple results list. Search by
  reading the week views for a date range and filtering in code.
- `/api/v1/...` addresses return 401 when called directly.
