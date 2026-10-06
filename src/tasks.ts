// Running tasks: one at a time, each in a fresh browser.
//
// The spec asks for "one browser, one task at a time", so tasks wait in a
// simple queue: each new task starts only after the previous one finished.

import type { Page } from "playwright";
import { openBrowser, saveSession } from "./browser";
import { bookAppointment, NEW_APPOINTMENT_PAGE } from "./acuity/book";
import { cancelAppointment } from "./acuity/cancel";
import { editAppointment, editExtrasById } from "./acuity/edit";
import { listAppointments, searchAppointments } from "./acuity/list";
import { ensureLoggedIn, type StartPage } from "./acuity/login";
import type {
  ActionResult,
  Appointment,
  AppointmentChanges,
  AppointmentMatch,
  AppointmentSearch,
  CancelOptions,
  NewAppointment,
} from "./acuity/types";
import { config } from "./config";
import { resolve, type Target } from "./heal/resolve";
import { saveFailureScreenshot, trace } from "./trace";

let queue: Promise<unknown> = Promise.resolve();

export function runTask<T>(
  name: string,
  work: (page: Page) => Promise<T>,
  options: { readOnly?: boolean; start?: StartPage } = {},
): Promise<T> {
  const result = queue.then(() => runNow(name, work, options));
  queue = result.catch(() => {}); // a failed task mustn't block the ones after it
  return result;
}

async function runNow<T>(name: string, work: (page: Page) => Promise<T>, options: { readOnly?: boolean; start?: StartPage }): Promise<T> {
  trace("task", "start", `Task: ${name}`);
  const { browser, context, page } = await openBrowser(options);

  try {
    if (!(await ensureLoggedIn(page, options.start))) {
      throw new Error("Not logged in to Acuity");
    }
    const result = await work(page);
    await saveSession(context); // keep any cookies Acuity refreshed
    trace("task", "ok", `Finished: ${name}`);
    return result;
  } catch (error) {
    const screenshot = await saveFailureScreenshot(page, name);
    trace("task", "error", `Failed: ${name}: ${(error as Error).message}`, { screenshot });
    throw error;
  } finally {
    await browser.close();
  }
}

// --- appointment tasks ---

export function listTask(from: string, to: string): Promise<Appointment[]> {
  return runTask(`List appointments ${from} to ${to}`, (page) => listAppointments(page, from, to));
}

export function searchTask(filters: AppointmentSearch): Promise<Appointment[]> {
  return runTask("Search appointments", (page) => searchAppointments(page, filters));
}

// Book / cancel / edit. With DRY_RUN=true (the default) these stop before
// the final click and change nothing.
const mode = () => (config.dryRun ? " (dry run)" : "");

export function bookTask(details: NewAppointment): Promise<ActionResult> {
  return runTask(`Book appointment${mode()}`, (page) => bookAppointment(page, details), { start: NEW_APPOINTMENT_PAGE });
}

export function cancelTask(match: AppointmentMatch, options: Partial<CancelOptions> = {}): Promise<ActionResult> {
  const fullOptions = { notifyClient: options.notifyClient ?? config.notifyClients, note: options.note };
  return runTask(`Cancel appointment${mode()}`, (page) => cancelAppointment(page, match, fullOptions));
}

export function editTask(match: AppointmentMatch, changes: AppointmentChanges): Promise<ActionResult> {
  return runTask(`Edit appointment${mode()}`, (page) => editAppointment(page, match, changes));
}

// A job from Novabot: change what Acuity's API can't (type, price, paid).
export function extrasTask(appointmentId: string, clientName: string, changes: Pick<AppointmentChanges, "type" | "price" | "paid">): Promise<ActionResult> {
  return runTask(`Change ${clientName}'s booking${mode()}`, (page) => editExtrasById(page, appointmentId, clientName, changes));
}

// A short human-readable summary, e.g. for the visualizer or Novabot.
export function describeAppointments(appointments: Appointment[]): string {
  if (appointments.length === 0) return "No appointments";
  const lines = appointments.map((a) => `${a.date} ${a.time}-${a.endTime ?? "?"}  ${a.clientName}  (${a.type})`);
  return `${appointments.length} appointment(s):\n${lines.join("\n")}`;
}

// --- read-only checks you can start from the visualizer ---

export async function checkLogin(): Promise<string> {
  return runTask("Check login", async () => "Logged in to Acuity");
}

// Elements every later task will need. The tour only FINDS them (and
// outlines them in the screenshots); it never clicks.
// Phase 8's daily healthcheck will grow out of this list.
const TOUR_TARGETS: Target[] = [
  { key: "calendar.next_button", intent: "The button that moves the calendar forward to the next day, week or month" },
  { key: "calendar.previous_button", intent: "The button that moves the calendar back to the previous day, week or month" },
  { key: "calendar.today_button", intent: "The button that jumps the calendar back to today" },
  { key: "appointment.new_button", intent: "The button or link that starts creating a new appointment" },
];

export async function readOnlyTour(): Promise<string> {
  return runTask("Read-only tour of the calendar page", async (page) => {
    let found = 0;
    for (const target of TOUR_TARGETS) {
      try {
        await resolve(page, target);
        found++;
      } catch {
        // resolve() already logged why; carry on with the next element.
      }
    }
    return `Found ${found} of ${TOUR_TARGETS.length} elements`;
  });
}
