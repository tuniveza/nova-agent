// Getting (and staying) logged in to Acuity.
//
// Normal case: the saved session still works and nothing else happens.
// Session expired: log in automatically with ACUITY_EMAIL / ACUITY_PASSWORD.
// That also failed: stop and raise an alert asking for a manual login
// (`npm run login`).

import { createInterface } from "node:readline/promises";
import type { Locator, Page } from "playwright";
import { sendAlert } from "../alerts";
import { click, goTo, typeInto } from "../browser";
import { config } from "../config";
import { resolve } from "../heal/resolve";
import { trace } from "../trace";

// When you're logged out, Acuity does NOT redirect the admin URL to a login
// URL. It shows the login form at the same address. So we can't just look at
// the URL; we have to look for the form itself.
// (Checked against the real page on 2026-10-05.)
function loginHeading(page: Page) {
  return page.getByRole("heading", { name: "Log in to Acuity Scheduling" });
}

// A page to check the login on, and something on it that only shows when
// logged in. A task can start on the page it needs (a booking starts on the
// New Appointment form), which saves loading the heavy calendar page first.
export interface StartPage {
  url: string;
  ready: (page: Page) => Locator;
}

// Open the admin page (or the task's start page) and report whether Acuity let us in.
export async function isLoggedIn(page: Page, start?: StartPage): Promise<boolean> {
  await goTo(page, start?.url ?? config.acuityAdminUrl);

  // Wait for whichever comes first: the login form, or (on a start page) the
  // sign we're logged in. If neither shows within a few seconds, we're logged in.
  const loginForm = loginHeading(page).waitFor({ state: "visible", timeout: 5_000 }).then(() => true);
  const signs = start ? [start.ready(page).first().waitFor({ state: "visible", timeout: 5_000 }).then(() => false)] : [];
  const loginFormAppeared = await Promise.any([loginForm, ...signs]).catch(() => false);

  trace("task", loginFormAppeared ? "warn" : "ok", loginFormAppeared ? "Acuity shows the login page" : "Logged in to Acuity");
  return !loginFormAppeared;
}

// Make sure we're logged in, logging in automatically if needed.
// Returns false (after raising an alert) if that wasn't possible.
export async function ensureLoggedIn(page: Page, start?: StartPage): Promise<boolean> {
  if (await isLoggedIn(page, start)) return true;

  if (!config.acuityEmail || !config.acuityPassword) {
    alertManualLoginNeeded("ACUITY_EMAIL / ACUITY_PASSWORD aren't set in .env");
    return false;
  }

  try {
    await loginAutomatically(page);
  } catch (error) {
    alertManualLoginNeeded(`automatic login failed: ${(error as Error).message}`);
    return false;
  }

  if (await isLoggedIn(page, start)) return true;
  alertManualLoginNeeded("still on the login page after logging in (wrong password, or Acuity asked for extra verification)");
  return false;
}

// Acuity's login is two steps: email then "Next", then password.
// Every element goes through resolve(), so if Acuity redesigns this page the
// AI finds the new fields instead of the login breaking.
async function loginAutomatically(page: Page): Promise<void> {
  trace("task", "start", "Logging in automatically with the email and password from .env");
  await goTo(page, config.acuityAdminUrl);

  const emailField = await resolve(page, {
    key: "login.email_field",
    intent: "The email address / username text box on the Acuity login form",
  });
  await typeInto(page, emailField, config.acuityEmail, "the email field");

  const nextButton = await resolve(page, {
    key: "login.next_button",
    intent: "The button that continues to the password step of the login form",
  });
  await click(page, nextButton, "Next");

  const passwordField = await resolve(page, {
    key: "login.password_field",
    intent: "The password text box on the Acuity login form",
  });
  await typeInto(page, passwordField, config.acuityPassword, "the password field", { secret: true });

  const submitButton = await resolve(page, {
    key: "login.submit_button",
    intent: "The button that submits the password and logs in",
  });
  await click(page, submitButton, "Log in");
}

function alertManualLoginNeeded(why: string) {
  void sendAlert("Nova Agent can't log in to Acuity", `${why}. Run: npm run login`);
}

// Let a human log in through the visible browser window. We wait for them
// to press Enter rather than trying to guess when login has finished.
export async function loginManually(page: Page): Promise<void> {
  await goTo(page, config.acuityAdminUrl);

  console.log("");
  console.log("Please log in to Acuity in the browser window.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  await terminal.question("When you can see your Acuity calendar, press Enter here... ");
  terminal.close();
}
