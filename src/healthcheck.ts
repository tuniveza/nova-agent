// The daily healthcheck: a read-only walk through every page and element the
// agent relies on, so a broken login or an Acuity redesign is noticed early,
// before a real client request fails.
//
// It runs with the change-blocking safety net forced on (even when DRY_RUN is
// off) and never makes a final click. The report goes to data/health.json,
// which the API serves at GET /health. Problems raise an alert.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Page } from "playwright";
import { sendAlert } from "./alerts";
import { click, goTo } from "./browser";
import { acuityOrigin, openAppointmentPage, pickDateAndTime } from "./acuity/common";
import { addDays, listAppointments, today } from "./acuity/list";
import { TARGETS } from "./acuity/targets";
import type { Appointment } from "./acuity/types";
import { config } from "./config";
import { resolveWithOutcome, type Target } from "./heal/resolve";
import { runTask } from "./tasks";
import { trace } from "./trace";

// "cache" = found from memory, "healed" = the AI had to find it again,
// "ok" = a plain check passed, "failed", "skipped" = couldn't be checked today.
export type CheckResult = "cache" | "healed" | "ok" | "failed" | "skipped";

export interface HealthReport {
  checkedAt: string;
  ok: boolean;
  loggedIn: boolean;
  summary: string;
  checks: { name: string; result: CheckResult; detail?: string }[];
}

export async function runHealthcheck(): Promise<HealthReport> {
  const checks: HealthReport["checks"] = [];
  let loggedIn = false;

  try {
    await runTask(
      "Daily healthcheck (read-only)",
      async (page) => {
        loggedIn = true; // runTask only gets here once logged in
        const upcoming = await checkCalendar(page, checks);
        if (upcoming) {
          await checkAppointmentPage(page, upcoming, checks);
          await checkReschedulePage(page, upcoming, checks);
        } else {
          checks.push({ name: "appointment pages", result: "skipped", detail: "No upcoming appointment to look at in the next 4 weeks" });
        }
        await checkNewAppointmentForm(page, checks);
      },
      { readOnly: true },
    );
  } catch (error) {
    if (!loggedIn) checks.push({ name: "login", result: "failed", detail: (error as Error).message });
  }

  const report = buildReport(loggedIn, checks);
  saveReport(report);

  if (!report.ok) {
    await sendAlert("Nova Agent healthcheck found a problem", report.summary);
  }
  trace("task", report.ok ? "ok" : "error", `Healthcheck: ${report.summary}`, report);
  return report;
}

// --- the individual checks ---

// Can we read the calendar? Returns the first upcoming appointment (if any),
// which the next checks use as a sample.
async function checkCalendar(page: Page, checks: HealthReport["checks"]): Promise<Appointment | undefined> {
  try {
    const appointments = await listAppointments(page, today(), addDays(today(), 27));
    checks.push({ name: "calendar (week view)", result: "ok", detail: `${appointments.length} appointment(s) in the next 4 weeks` });
    return appointments[0];
  } catch (error) {
    checks.push({ name: "calendar (week view)", result: "failed", detail: (error as Error).message });
    return undefined;
  }
}

async function checkAppointmentPage(page: Page, sample: Appointment, checks: HealthReport["checks"]) {
  if (!(await attempt(checks, "appointment page", () => openAppointmentPage(page, sample)))) return;

  await check(page, checks, TARGETS.editLink);
  const cancelLink = await check(page, checks, TARGETS.cancelLink);

  // Open the "Are you sure?" pop-up (that alone changes nothing) and look
  // inside it, without pressing the final button.
  if (cancelLink) {
    await click(page, cancelLink, "Cancel (only to look inside the pop-up)");
    await check(page, checks, TARGETS.cancelEmailBox);
    await check(page, checks, TARGETS.cancelNoteBox);
    await check(page, checks, TARGETS.cancelConfirm);
  }

  // Reload to close the pop-up, then look at edit mode (edit mode alone changes nothing).
  await openAppointmentPage(page, sample);
  const editLink = await check(page, checks, TARGETS.editLink, { record: false });
  if (editLink) {
    await click(page, editLink, "Edit (only to look at the form)");
    for (const target of [TARGETS.editFirstName, TARGETS.editLastName, TARGETS.editPhone, TARGETS.editEmail, TARGETS.editNotes, TARGETS.editPrice, TARGETS.editPaid, TARGETS.editSave]) {
      await check(page, checks, target);
    }
    const hasTypeDropdown = (await page.getByTestId("appointment-type-select").count()) > 0;
    checks.push({ name: "edit: appointment type dropdown", result: hasTypeDropdown ? "ok" : "failed" });
  }
}

async function checkReschedulePage(page: Page, sample: Appointment, checks: HealthReport["checks"]) {
  await goTo(page, `${acuityOrigin}/appointments.php?action=reschedule&appt=${sample.id}`);
  const hasDatePicker = await page.locator("td.scheduleday").first().waitFor({ state: "attached", timeout: 15_000 }).then(() => true, () => false);
  checks.push({ name: "reschedule: date picker", result: hasDatePicker ? "ok" : "failed" });
  // The confirm button is greyed out until a time is picked, but it should be there.
  await check(page, checks, TARGETS.rescheduleConfirm);
}

async function checkNewAppointmentForm(page: Page, checks: HealthReport["checks"]) {
  await goTo(page, `${acuityOrigin}/appointments.php?action=new`);

  // Pick the first appointment type, the first bookable day and its first
  // time, just so the client fields appear. Nothing is typed or booked.
  const ready = await attempt(checks, "new appointment: type, date and time pickers", async () => {
    const typeDropdown = page.locator("select").filter({ hasText: "Choose appointment type" });
    await typeDropdown.selectOption({ index: 1 });
    const firstDay = page.locator("td.scheduleday.activeday:not(.pastday)").first();
    await firstDay.waitFor({ state: "attached", timeout: 15_000 });
    const day = (await firstDay.getAttribute("day")) ?? "";
    await click(page, firstDay, `the first bookable day (${day})`);
    const firstTime = page.getByRole("radio").filter({ visible: true }).first();
    await firstTime.waitFor({ state: "visible", timeout: 10_000 });
    const time = (await firstTime.getAttribute("value")) ?? "";
    await pickDateAndTime(page, day, time);
  });
  if (!ready) return;

  for (const target of [TARGETS.bookFirstName, TARGETS.bookLastName, TARGETS.bookEmail, TARGETS.bookPhone, TARGETS.bookConfirm]) {
    await check(page, checks, target);
  }
}

// --- helpers ---

// Look for one element and record how it went. Never throws.
async function check(page: Page, checks: HealthReport["checks"], target: Target, options = { record: true }) {
  try {
    const { locator, outcome } = await resolveWithOutcome(page, target);
    if (options.record) checks.push({ name: target.key, result: outcome });
    return locator;
  } catch (error) {
    if (options.record) checks.push({ name: target.key, result: "failed", detail: (error as Error).message });
    return undefined;
  }
}

// Run a step and record it as "ok" or "failed". Returns whether it worked.
async function attempt(checks: HealthReport["checks"], name: string, step: () => Promise<void>): Promise<boolean> {
  try {
    await step();
    checks.push({ name, result: "ok" });
    return true;
  } catch (error) {
    checks.push({ name, result: "failed", detail: (error as Error).message });
    return false;
  }
}

function buildReport(loggedIn: boolean, checks: HealthReport["checks"]): HealthReport {
  const count = (result: CheckResult) => checks.filter((c) => c.result === result).length;
  const failed = checks.filter((c) => c.result === "failed");
  const ok = loggedIn && failed.length === 0;

  let summary = !loggedIn
    ? "Couldn't log in to Acuity."
    : `${count("cache") + count("ok")} fine, ${count("healed")} re-found by the AI, ${failed.length} failed, ${count("skipped")} skipped.`;
  if (failed.length > 0) summary += ` Failed: ${failed.map((c) => c.name).join(", ")}.`;

  return { checkedAt: new Date().toISOString(), ok, loggedIn, summary, checks };
}

function saveReport(report: HealthReport) {
  mkdirSync(config.paths.dataDir, { recursive: true });
  writeFileSync(config.paths.health, JSON.stringify(report, null, 2));
}

export function readLastHealthReport(): HealthReport | undefined {
  if (!existsSync(config.paths.health)) return undefined;
  try {
    return JSON.parse(readFileSync(config.paths.health, "utf8")) as HealthReport;
  } catch {
    return undefined;
  }
}
