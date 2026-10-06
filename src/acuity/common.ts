// Helpers shared by book, cancel and edit. See docs/acuity-ui-notes.md for
// what the real pages look like.

import type { Locator, Page } from "playwright";
import { click, goTo, humanPause } from "../browser";
import { config } from "../config";
import { saveFailureScreenshot, trace, traceScreenshot } from "../trace";
import { listAppointments } from "./list";
import type { Appointment, AppointmentMatch } from "./types";

export const acuityOrigin = new URL(config.acuityAdminUrl).origin;

// --- finding exactly one appointment ---

// Date + time must match exactly, and the client name too if given (ignoring
// capitals and extra spaces). Zero or several matches = refuse, never guess.
export async function findOneAppointment(page: Page, match: AppointmentMatch): Promise<Appointment> {
  const time = normaliseTime(match.time);
  const wantedName = match.clientName ? simplify(match.clientName) : undefined;

  const candidates = (await listAppointments(page, match.date, match.date)).filter(
    (appointment) =>
      appointment.time === time && (wantedName === undefined || simplify(appointment.clientName) === wantedName),
  );

  const described = `on ${match.date} at ${time}${match.clientName ? ` for ${match.clientName}` : ""}`;
  if (candidates.length === 0) {
    throw new Error(`No appointment found ${described}.`);
  }
  if (candidates.length > 1) {
    throw new Error(`${candidates.length} appointments match ${described}. Refusing to guess: please give the client's full name.`);
  }

  trace("task", "ok", `Found the appointment: ${candidates[0].clientName}, ${match.date} at ${time}`, candidates[0]);
  return candidates[0];
}

// Open an appointment's own page and double-check it's the right one.
export async function openAppointmentPage(page: Page, appointment: Appointment): Promise<void> {
  await goTo(page, `${acuityOrigin}/appointments/view/${appointment.id}`);

  const nameOnPage = (await page.getByTestId("appt-details-client-name").first().textContent().catch(() => "")) ?? "";
  if (!simplify(nameOnPage).includes(simplify(appointment.clientName))) {
    const screenshot = await saveFailureScreenshot(page, "wrong_appointment_page");
    trace("task", "error", `Safety check failed: expected ${appointment.clientName}'s appointment page`, { nameOnPage, screenshot });
    throw new Error(`Opened the wrong appointment page (expected ${appointment.clientName}). Stopped without changing anything.`);
  }
}

// --- appointment type dropdowns ---

// Pick an appointment type by name. The options read like
// "Rap Package - 2 songs (...) (240 minutes @ £200.00)", so we accept either
// the full name or a unique beginning of it ("Rap Package - 2 songs").
export async function chooseAppointmentType(page: Page, dropdown: Locator, wanted: string): Promise<void> {
  const options = (await dropdown.locator("option").allTextContents()).map((text) => text.trim());
  const wantedLower = wanted.trim().toLowerCase();

  const matching = options
    .map((text, index) => ({ text, index }))
    .filter((option) => option.text.toLowerCase().startsWith(wantedLower));

  if (matching.length !== 1) {
    const choices = options.filter((text) => !text.startsWith("Choose")).join("\n  ");
    throw new Error(
      matching.length === 0
        ? `No appointment type called "${wanted}". The choices are:\n  ${choices}`
        : `"${wanted}" matches ${matching.length} appointment types. Please be more specific:\n  ${matching.map((m) => m.text).join("\n  ")}`,
    );
  }

  await humanPause();
  trace("browser", "info", `Choosing appointment type "${matching[0].text}"`);
  await dropdown.selectOption({ index: matching[0].index });
  await traceScreenshot(page, "Chose the appointment type", dropdown);
}

// --- date + time picker (used by Reschedule and New Appointment) ---

// The month grid's days aren't buttons, so resolve() (which finds elements by
// role) can't see them. Each available day is a cell with day="YYYY-MM-DD",
// which we use directly. Times are radio buttons named "10:00", "10:30", …
export async function pickDateAndTime(page: Page, date: string, time: string): Promise<void> {
  const wantedTime = normaliseTime(time);
  const anyDay = page.locator("td.scheduleday").first();
  const dayCell = page.locator(`td.scheduleday[day="${date}"]`);

  // The grid loads a moment after the page (or after choosing a type) and is
  // drawn row by row, so wait until a whole month is there before looking.
  await waitForFullMonth(page, "").catch(() => {
    throw new Error("The date picker didn't appear.");
  });

  // The grid shows one month; move forward until the wanted date is on it.
  const wantedMonth = date.slice(0, 7); // "2026-11"
  for (let months = 0; months < 12 && (await dayCell.count()) === 0; months++) {
    const shownMonth = ((await anyDay.getAttribute("day")) ?? "").slice(0, 7);
    if (shownMonth > wantedMonth) break; // already past it: the date isn't offered
    trace("browser", "info", `Date picker shows ${shownMonth}; looking for ${date}`);
    await click(page, page.locator('a[href*="showCalendar"]').last(), "next month");
    await waitForFullMonth(page, shownMonth).catch(() => {});
  }

  if ((await dayCell.count()) === 0) {
    throw new Error(`Couldn't find ${date} in the date picker.`);
  }
  const dayClasses = (await dayCell.getAttribute("class")) ?? "";
  if (!dayClasses.includes("activeday") || dayClasses.includes("pastday")) {
    throw new Error(`${date} can't be booked (fully booked, closed, or in the past).`);
  }
  await click(page, dayCell, `the date ${date}`);

  const slot = page.getByRole("radio", { name: wantedTime, exact: true }).filter({ visible: true }).first();
  const available = await slot.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!available) {
    const shown = await page.getByRole("radio").filter({ visible: true }).evaluateAll((radios) =>
      radios.map((radio) => radio.getAttribute("value") ?? ""),
    );
    throw new Error(`${wantedTime} isn't available on ${date}. Available times: ${[...new Set(shown)].join(", ") || "none"}`);
  }

  await humanPause();
  trace("browser", "info", `Choosing ${wantedTime}`);
  await slot.check();
  await traceScreenshot(page, `Chose ${date} at ${wantedTime}`, slot);
}

// Wait until the date picker shows a complete month (at least 28 days) that
// isn't `previousMonth` ("2026-10"; pass "" for any month).
function waitForFullMonth(page: Page, previousMonth: string) {
  return page.waitForFunction(
    (previous) => {
      const days = document.querySelectorAll("td.scheduleday");
      const firstDay = days[0]?.getAttribute("day") ?? "";
      return days.length >= 28 && (previous === "" || !firstDay.startsWith(previous));
    },
    previousMonth,
    { timeout: 15_000 },
  );
}

// --- small helpers ---

// "9:00" -> "09:00"
export function normaliseTime(time: string): string {
  const [hours = "", minutes = "00"] = time.trim().split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function simplify(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
