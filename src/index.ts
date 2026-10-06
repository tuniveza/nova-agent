// Command-line entry point.
//
//   npm start                              check we're logged in (logs in automatically if needed)
//   npm run login                          open a visible browser so you can log in by hand
//   npm run list                           appointments for the next 7 days
//   npm run list -- 2026-09-01 2026-09-30  appointments between two dates
//   npm run search -- name=Kai             search (also: type=, email=, phone=, from=, to=)
//
//   npm run book -- "type=Rap Package - 2 songs" date=2026-11-04 time=14:00 first=Jo last=Bloggs email=jo@example.com [phone=...]
//   npm run cancel -- date=2026-10-31 time=17:00 "name=Dana Hollis" [notify=no] ["note=..."]
//   npm run healthcheck                    read-only check that every page and button can still be found
//   npm run edit -- date=2026-10-31 time=17:00 "name=Dana Hollis" phone=07... [first= last= email= type= notes= newdate= newtime=]
//
// Book / cancel / edit stop before the final click while DRY_RUN=true (the default).
//
// In later phases this file will start the HTTP API and the daily
// healthcheck instead. The visualizer has its own entry point
// (src/visualizer/server.ts).

import { openBrowser, saveSession } from "./browser";
import { addDays, today } from "./acuity/list";
import { isLoggedIn, loginManually } from "./acuity/login";
import type { ActionResult } from "./acuity/types";
import { runHealthcheck } from "./healthcheck";
import { bookTask, cancelTask, checkLogin, describeAppointments, editTask, listTask, searchTask } from "./tasks";

async function manualLogin(): Promise<void> {
  const { browser, context, page } = await openBrowser();
  try {
    if (!(await isLoggedIn(page))) {
      await loginManually(page);
      if (!(await isLoggedIn(page))) {
        console.log("✗ Still seeing the login page. Nothing saved. Please try again.");
        process.exitCode = 1;
        return;
      }
    }
    await saveSession(context);
  } finally {
    await browser.close();
  }
}

async function list(args: string[]): Promise<void> {
  const from = args[0] ?? today();
  const to = args[1] ?? addDays(from, 6);
  console.log("\n" + describeAppointments(await listTask(from, to)));
}

// Turns ["name=Kai", "from=2026-09-01"] into { name: "Kai", from: "2026-09-01" }.
function readArgs(args: string[]): Record<string, string | undefined> {
  return Object.fromEntries(
    args.map((arg) => {
      const at = arg.indexOf("=");
      return at < 0 ? [arg, ""] : [arg.slice(0, at), arg.slice(at + 1)];
    }),
  );
}

function required(given: Record<string, string | undefined>, ...names: string[]): void {
  const missing = names.filter((name) => !given[name]);
  if (missing.length) throw new Error(`Missing: ${missing.map((name) => `${name}=...`).join(" ")}`);
}

function report(result: ActionResult): void {
  console.log(`\n${result.ok ? "✓" : "✗"} ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

async function book(args: string[]): Promise<void> {
  const given = readArgs(args);
  required(given, "type", "date", "time", "first", "last", "email");
  report(await bookTask({
    type: given.type!, date: given.date!, time: given.time!,
    firstName: given.first!, lastName: given.last!, email: given.email!, phone: given.phone,
  }));
}

async function cancel(args: string[]): Promise<void> {
  const given = readArgs(args);
  required(given, "date", "time");
  const notify = given.notify === undefined ? undefined : !["no", "false", "0"].includes(given.notify.toLowerCase());
  report(await cancelTask({ date: given.date!, time: given.time!, clientName: given.name }, { notifyClient: notify, note: given.note }));
}

async function edit(args: string[]): Promise<void> {
  const given = readArgs(args);
  required(given, "date", "time");
  report(await editTask(
    { date: given.date!, time: given.time!, clientName: given.name },
    {
      firstName: given.first, lastName: given.last, email: given.email, phone: given.phone,
      type: given.type, notes: given.notes, date: given.newdate, time: given.newtime,
    },
  ));
}

async function search(args: string[]): Promise<void> {
  const given = readArgs(args);
  const results = await searchTask({
    clientName: given.name,
    type: given.type,
    email: given.email,
    phone: given.phone,
    from: given.from,
    to: given.to,
  });
  console.log("\n" + describeAppointments(results));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "--manual-login") await manualLogin();
  else if (command === "list") await list(args);
  else if (command === "search") await search(args);
  else if (command === "book") await book(args);
  else if (command === "cancel") await cancel(args);
  else if (command === "edit") await edit(args);
  else if (command === "healthcheck") {
    const report = await runHealthcheck();
    for (const check of report.checks) console.log(`  ${check.result.padEnd(7)} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
    console.log(`\n${report.ok ? "✓" : "✗"} ${report.summary}`);
    if (!report.ok) process.exitCode = 1;
  }
  else await checkLogin();
}

main().catch((error) => {
  console.error("Nova Agent stopped:", (error as Error).message);
  process.exitCode = 1;
});
