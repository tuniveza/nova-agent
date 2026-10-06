// Cancelling an appointment.
//
// Steps: find exactly one matching appointment, open its page, press
// "Cancel" (which only opens an "Are you sure?" pop-up), set the email
// option, then the final "Cancel Appointment" button. In dry-run mode the
// agent stops before that last button.

import type { Page } from "playwright";
import { click, finalClick, setCheckbox, typeInto } from "../browser";
import { resolve } from "../heal/resolve";
import { trace } from "../trace";
import { findOneAppointment, openAppointmentPage } from "./common";
import { TARGETS } from "./targets";
import { listAppointments } from "./list";
import type { ActionResult, AppointmentMatch, CancelOptions } from "./types";

export async function cancelAppointment(page: Page, match: AppointmentMatch, options: CancelOptions): Promise<ActionResult> {
  const appointment = await findOneAppointment(page, match);
  const described = `${appointment.clientName}'s appointment on ${appointment.date} at ${appointment.time}`;
  trace("task", "start", `Cancelling ${described}`, { ...options });

  await openAppointmentPage(page, appointment);

  const cancelLink = await resolve(page, TARGETS.cancelLink);
  await click(page, cancelLink, "Cancel (opens the 'Are you sure?' pop-up)");

  const emailBox = await resolve(page, TARGETS.cancelEmailBox);
  await setCheckbox(page, emailBox, options.notifyClient, "Send email to client");

  if (options.note) {
    const noteBox = await resolve(page, TARGETS.cancelNoteBox);
    await typeInto(page, noteBox, options.note, "the note to the client");
  }

  const confirmButton = await resolve(page, TARGETS.cancelConfirm);
  const clicked = await finalClick(page, confirmButton, `cancel ${described}`);
  if (!clicked) {
    return { ok: true, dryRun: true, appointment, message: `Dry run: would have cancelled ${described}. Nothing was changed.` };
  }

  // Check it's really gone from the calendar.
  const stillThere = (await listAppointments(page, appointment.date, appointment.date)).some((a) => a.id === appointment.id);
  if (stillThere) {
    trace("task", "error", `Pressed cancel, but ${described} is still on the calendar`);
    return { ok: false, dryRun: false, appointment, message: `Tried to cancel ${described}, but it's still on the calendar. Please check Acuity.` };
  }
  trace("task", "ok", `Cancelled ${described}`);
  return { ok: true, dryRun: false, appointment, message: `Cancelled ${described}.` };
}
