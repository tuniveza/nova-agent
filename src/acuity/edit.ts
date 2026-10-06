// Editing an appointment.
//
// Acuity splits this in two (see docs/acuity-ui-notes.md):
//   - "Edit" on the appointment page: name, phone, email, type, notes
//   - "Reschedule": date and time
// editAppointment() does whichever parts are needed. Each part ends with its
// own final click, and in dry-run mode stops before it.

import type { Page } from "playwright";
import { click, finalClick, goTo, setCheckbox, typeInto } from "../browser";
import { resolve, type Target } from "../heal/resolve";
import { TARGETS } from "./targets";
import { trace } from "../trace";
import { acuityOrigin, chooseAppointmentType, findOneAppointment, normaliseTime, openAppointmentPage, pickDateAndTime } from "./common";
import { getAppointmentDetails, listAppointments } from "./list";
import type { ActionResult, Appointment, AppointmentChanges, AppointmentMatch } from "./types";

export async function editAppointment(page: Page, match: AppointmentMatch, changes: AppointmentChanges): Promise<ActionResult> {
  const { date, time, ...detailChanges } = changes;
  const hasDetailChanges = Object.values(detailChanges).some((value) => value !== undefined);
  const hasNewTime = date !== undefined || time !== undefined;
  if (!hasDetailChanges && !hasNewTime) {
    return { ok: false, dryRun: false, message: "Nothing to change." };
  }

  const appointment = await findOneAppointment(page, match);
  trace("task", "start", `Editing ${appointment.clientName}'s appointment on ${appointment.date} at ${appointment.time}`, changes);

  const results: ActionResult[] = [];
  if (hasDetailChanges) {
    results.push(await editDetails(page, appointment, detailChanges));
  }
  if (hasNewTime) {
    results.push(await reschedule(page, appointment, date ?? appointment.date, normaliseTime(time ?? appointment.time)));
  }

  return {
    ok: results.every((result) => result.ok),
    dryRun: results.some((result) => result.dryRun),
    appointment,
    message: results.map((result) => result.message).join(" "),
  };
}

// --- name, phone, email, type, notes ---

// Which text box each change goes into.
const TEXT_FIELDS: { change: "firstName" | "lastName" | "phone" | "email" | "notes"; target: Target; label: string }[] = [
  { change: "firstName", label: "first name", target: TARGETS.editFirstName },
  { change: "lastName", label: "last name", target: TARGETS.editLastName },
  { change: "phone", label: "phone", target: TARGETS.editPhone },
  { change: "email", label: "email", target: TARGETS.editEmail },
  { change: "notes", label: "notes", target: TARGETS.editNotes },
];

async function editDetails(page: Page, appointment: Appointment, changes: AppointmentChanges): Promise<ActionResult> {
  await openAppointmentPage(page, appointment);

  const editLink = await resolve(page, TARGETS.editLink);
  await click(page, editLink, "Edit");

  for (const field of TEXT_FIELDS) {
    const newValue = changes[field.change];
    if (newValue === undefined) continue;
    await typeInto(page, await resolve(page, field.target), newValue, `the ${field.label} box`);
  }

  if (changes.type) {
    // The type dropdown has no label, so resolve() can't find it by name;
    // Acuity's own test ID is the reliable handle.
    await chooseAppointmentType(page, page.getByTestId("appointment-type-select"), changes.type);
  }

  if (changes.price !== undefined) {
    await typeInto(page, await resolve(page, TARGETS.editPrice), changes.price, "the total price box");
  }
  if (changes.paid !== undefined) {
    await setCheckbox(page, await resolve(page, TARGETS.editPaid), changes.paid, "Paid");
  }

  const saveButton = await resolve(page, TARGETS.editSave);
  const changed = Object.keys(changes).filter((key) => changes[key as keyof AppointmentChanges] !== undefined).join(", ");
  const clicked = await finalClick(page, saveButton, `save the new ${changed}`);
  if (!clicked) {
    return { ok: true, dryRun: true, message: `Dry run: would have saved the new ${changed}. Nothing was changed.` };
  }

  const after = await getAppointmentDetails(page, appointment);
  trace("task", "ok", `Saved the new ${changed}`, after);
  return { ok: true, dryRun: false, appointment: after, message: `Updated the ${changed}.` };
}

// For jobs from Novabot, which already know the appointment's ID (from
// Acuity's API) and only change what the API can't: type, price, paid.
// The client's name is still checked on the page before anything changes.
export async function editExtrasById(
  page: Page,
  appointmentId: string,
  clientName: string,
  changes: Pick<AppointmentChanges, "type" | "price" | "paid">,
): Promise<ActionResult> {
  const appointment: Appointment = { id: appointmentId, clientName, date: "", time: "", type: "" };
  trace("task", "start", `Changing ${clientName}'s appointment #${appointmentId}`, changes);
  return editDetails(page, appointment, changes);
}

// --- date and time ---

async function reschedule(page: Page, appointment: Appointment, newDate: string, newTime: string): Promise<ActionResult> {
  const described = `${appointment.clientName}'s appointment to ${newDate} at ${newTime}`;
  await goTo(page, `${acuityOrigin}/appointments.php?action=reschedule&appt=${appointment.id}`);
  await pickDateAndTime(page, newDate, newTime);

  const confirmButton = await resolve(page, TARGETS.rescheduleConfirm);
  const clicked = await finalClick(page, confirmButton, `move ${described}`);
  if (!clicked) {
    return { ok: true, dryRun: true, message: `Dry run: would have moved ${described}. Nothing was changed.` };
  }

  const moved = (await listAppointments(page, newDate, newDate)).find((a) => a.id === appointment.id && a.time === newTime);
  if (!moved) {
    trace("task", "error", `Pressed reschedule, but couldn't find the appointment at ${newDate} ${newTime}`);
    return { ok: false, dryRun: false, message: `Tried to move ${described}, but couldn't confirm it on the calendar. Please check Acuity.` };
  }
  trace("task", "ok", `Moved ${described}`);
  return { ok: true, dryRun: false, appointment: moved, message: `Moved ${described}.` };
}
