// Booking a new appointment.
//
// Fills Acuity's New Appointment form in order: appointment type, date and
// time, then the client's details. In dry-run mode it stops before the final
// "Schedule Appointment" button.
//
// Not done yet: the "Forms and Notes" section (intake questions). Notes can
// be added afterwards with editAppointment().

import type { Page } from "playwright";
import { finalClick, goTo, typeInto } from "../browser";
import { resolve } from "../heal/resolve";
import { trace } from "../trace";
import { acuityOrigin, chooseAppointmentType, normaliseTime, pickDateAndTime } from "./common";
import { listAppointments } from "./list";
import type { StartPage } from "./login";
import { TARGETS } from "./targets";
import type { ActionResult, NewAppointment } from "./types";

// The type dropdown has no label; it's the one whose first option is
// "Choose appointment type...".
const typeDropdownOn = (page: Page) => page.locator("select").filter({ hasText: "Choose appointment type" });

// Where a booking starts (the login is checked here too, see tasks.ts)
export const NEW_APPOINTMENT_PAGE: StartPage = { url: `${acuityOrigin}/appointments.php?action=new`, ready: typeDropdownOn };

export async function bookAppointment(page: Page, details: NewAppointment): Promise<ActionResult> {
  const time = normaliseTime(details.time);
  const clientName = `${details.firstName} ${details.lastName}`;
  const described = `${details.type} for ${clientName} on ${details.date} at ${time}`;
  trace("task", "start", `Booking ${described}`, details);

  // Usually already open from the login check
  if (!page.url().endsWith(NEW_APPOINTMENT_PAGE.url.slice(acuityOrigin.length))) await goTo(page, NEW_APPOINTMENT_PAGE.url);

  await chooseAppointmentType(page, typeDropdownOn(page), details.type);

  await pickDateAndTime(page, details.date, time);

  const fields = [
    { target: TARGETS.bookFirstName, label: "first name", value: details.firstName },
    { target: TARGETS.bookLastName, label: "last name", value: details.lastName },
    { target: TARGETS.bookEmail, label: "email", value: details.email },
    { target: TARGETS.bookPhone, label: "phone", value: details.phone },
  ];
  for (const field of fields) {
    if (!field.value) continue;
    await typeInto(page, await resolve(page, field.target), field.value, `the ${field.label} box`);
  }

  const scheduleButton = await resolve(page, TARGETS.bookConfirm);
  const clicked = await finalClick(page, scheduleButton, `book ${described}`);
  if (!clicked) {
    return { ok: true, dryRun: true, message: `Dry run: would have booked ${described}. Nothing was changed.` };
  }

  // Check it's really on the calendar.
  const booked = (await listAppointments(page, details.date, details.date)).find(
    (a) => a.time === time && a.clientName.toLowerCase() === clientName.toLowerCase(),
  );
  if (!booked) {
    trace("task", "error", `Pressed Schedule, but couldn't find ${described} on the calendar`);
    return { ok: false, dryRun: false, message: `Tried to book ${described}, but couldn't confirm it on the calendar. Please check Acuity.` };
  }
  trace("task", "ok", `Booked ${described}`, booked);
  return { ok: true, dryRun: false, appointment: booked, message: `Booked ${described}.` };
}
