// Reading appointments from Acuity (read-only: nothing here clicks or changes anything).
//
// How: open the calendar's week view, one week at a time, and read the
// appointment blocks. Those blocks aren't buttons or links, so resolve()
// (which finds elements by role) can't see them. Instead we read Acuity's own
// test IDs (data-testid), which are made for automated testing and change far
// less often than the visual design. See docs/acuity-ui-notes.md.
//
// If those IDs ever disappear, we stop with a clear error rather than
// wrongly reporting "no appointments".

import type { Page } from "playwright";
import { goTo, humanPause } from "../browser";
import { config } from "../config";
import { saveFailureScreenshot, trace } from "../trace";
import type { Appointment, AppointmentSearch } from "./types";

const acuityOrigin = new URL(config.acuityAdminUrl).origin;

// --- listing ---

export async function listAppointments(page: Page, from: string, to: string): Promise<Appointment[]> {
  trace("task", "start", `Listing appointments from ${from} to ${to}`);
  const found = new Map<string, Appointment>(); // keyed by ID, so nothing is counted twice

  // The week view shows one Monday-to-Sunday week. Start on the Monday of
  // the first week and step 7 days at a time, so every week is covered.
  for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) {
    await goTo(page, `${acuityOrigin}/appointments.php?view=thisWeek&day=${monday}&scale=1`);
    for (const appointment of await readWeekView(page)) {
      if (appointment.date >= from && appointment.date <= to) {
        found.set(appointment.id, appointment);
      }
    }
    await humanPause();
  }

  const appointments = [...found.values()].sort((a, b) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`),
  );
  trace("task", "ok", `Found ${appointments.length} appointment(s) from ${from} to ${to}`, appointments);
  return appointments;
}

// Read every appointment block on the week view that's currently open.
async function readWeekView(page: Page): Promise<Appointment[]> {
  // Wait for the day columns. If they never appear, the layout has changed.
  const dayColumns = page.getByTestId("appointment-listing-container");
  try {
    await dayColumns.first().waitFor({ state: "attached", timeout: 10_000 });
  } catch {
    const screenshot = await saveFailureScreenshot(page, "week_view_layout_changed");
    trace("task", "error", "Couldn't find the calendar's day columns. Acuity's layout may have changed.", { screenshot });
    throw new Error("Calendar layout not recognised (no day columns found)");
  }

  const blocks = await page.getByTestId("appt-container").evaluateAll((elements) =>
    elements.map((element) => ({
      htmlId: element.id, // "appt:<appointmentId>:<calendarId>"
      date: element.closest("[date]")?.getAttribute("date") ?? "",
      start: element.getAttribute("start") ?? "",
      end: element.getAttribute("end") ?? "",
      title: element.getAttribute("title") ?? "",
    })),
  );

  return blocks.map((block) => {
    // The title looks like "Client Name:\n£Appointment Type\n16:30-18:30"
    const [nameLine = "", typeLine = ""] = block.title.split("\n").map((line) => line.trim()).filter(Boolean);
    return {
      id: block.htmlId.split(":")[1] ?? block.htmlId,
      date: block.date,
      time: block.start,
      endTime: block.end,
      clientName: nameLine.replace(/:$/, ""),
      type: typeLine.replace(/^[£$€]\s*/, ""),
    };
  });
}

// --- one appointment's details (phone, email, notes) ---

export async function getAppointmentDetails(page: Page, appointment: Appointment): Promise<Appointment> {
  await goTo(page, `${acuityOrigin}/appointments/view/${appointment.id}`);

  // Note: no helper functions inside evaluate(). This code runs inside the
  // browser, and tsx adds a hidden helper to named functions that the
  // browser doesn't have.
  const details = await page.evaluate(() => {
    const tel = document.querySelector('a[href^="tel:"]')?.getAttribute("href") ?? "";
    const mail = document.querySelector('a[href^="mailto:"]')?.getAttribute("href") ?? "";
    const notes = document.querySelector(".edit-appointment-notes")?.textContent?.trim() ?? "";
    return {
      phone: tel.replace(/^tel:/, ""),
      email: decodeURIComponent(mail.replace(/^mailto:/, "")),
      notes: notes === "No notes" ? "" : notes,
    };
  });

  const full = { ...appointment, ...withoutEmpty(details) };
  trace("task", "info", `Read details for ${appointment.clientName} on ${appointment.date} at ${appointment.time}`, full);
  return full;
}

// --- searching ---

// Search by any mix of: date range, client name, appointment type, email, phone.
// Without dates it looks from today to 60 days ahead.
// Email/phone need each appointment's own page, so they're checked last, and
// only for appointments that already match everything else.
export async function searchAppointments(page: Page, filters: AppointmentSearch): Promise<Appointment[]> {
  const from = filters.from ?? today();
  const to = filters.to ?? addDays(from, 60);
  trace("task", "start", "Searching appointments", { ...filters, from, to });

  let matches = (await listAppointments(page, from, to)).filter(
    (appointment) =>
      contains(appointment.clientName, filters.clientName) && contains(appointment.type, filters.type),
  );

  if (filters.email || filters.phone) {
    const withDetails: Appointment[] = [];
    for (const appointment of matches) {
      withDetails.push(await getAppointmentDetails(page, appointment));
      await humanPause();
    }
    matches = withDetails.filter(
      (appointment) =>
        contains(appointment.email ?? "", filters.email) && samePhone(appointment.phone ?? "", filters.phone),
    );
  }

  trace("task", "ok", `Search found ${matches.length} appointment(s)`, matches);
  return matches;
}

// --- small helpers ---

// Case-insensitive "contains". An empty search term matches everything.
function contains(text: string, searchTerm?: string): boolean {
  if (!searchTerm) return true;
  return text.toLowerCase().includes(searchTerm.trim().toLowerCase());
}

// Compare phone numbers by their last 9 digits, so "+44 7700 900321" and
// "07700900321" count as the same number.
function samePhone(phone: string, searchTerm?: string): boolean {
  if (!searchTerm) return true;
  const lastDigits = (value: string) => value.replace(/\D/g, "").slice(-9);
  return lastDigits(searchTerm).length > 0 && lastDigits(phone) === lastDigits(searchTerm);
}

function withoutEmpty<T extends Record<string, string>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "")) as Partial<T>;
}

// Today's date in the business's timezone, as "YYYY-MM-DD".
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
}

function mondayOf(date: string): string {
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dayOfWeek + 6) % 7));
}

// Add days to a "YYYY-MM-DD" date (negative to go back).
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`); // midday UTC avoids daylight-saving edge cases
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
