// The Fixer's buttons check, as its own process (the Fixer runs it every 5 minutes with low
// priority; src/fixer/buttons.ts says what it presses and how it judges).
//
//   npx tsx scripts/fixer-buttons.ts <address> [--size 1440x900] [--panels /portal/,/agent/]
//     [--from 0 --count 3] [--out results.json] [--mock-portal] [--max 40] [--budget-seconds 240] [--quiet]
//
// Signed in: the cookie comes in the environment (LOOKS_COOKIE_NAME, LOOKS_COOKIE), never on the
// command line and never printed. It only looks: every save is turned away before it leaves.
// Prints what each press did; exits 1 if any button is broken.
import { writeFileSync } from "node:fs";
import { runButtons, type ButtonsOptions } from "../src/fixer/buttons";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) {
  console.error("Which address? e.g. npx tsx scripts/fixer-buttons.ts http://localhost:4721");
  process.exit(2);
}
const value = process.env.LOOKS_COOKIE || "";
const quiet = args.includes("--quiet");
const options: ButtonsOptions = {
  base,
  size: (opt("size") || "1440x900").split("x").map(Number) as [number, number],
  panels: opt("panels") ? opt("panels").split(",") : undefined,
  from: opt("from") ? Number(opt("from")) : undefined,
  count: opt("count") ? Number(opt("count")) : undefined,
  cookie: value ? { name: process.env.LOOKS_COOKIE_NAME || "nova_session", value } : null,
  maxPerPanel: opt("max") ? Number(opt("max")) : undefined,
  budgetMs: opt("budget-seconds") ? Number(opt("budget-seconds")) * 1000 : undefined,
  log: (line) => (!quiet || !line.startsWith("  ")) && console.log(line),
};
if (args.includes("--mock-portal")) {
  const { portalMock } = await import("./check-fit-portal-samples.mjs" as string);
  options.mockPortal = portalMock;
}
const { screens, total } = await runButtons(options);
if (opt("out")) writeFileSync(opt("out"), JSON.stringify({ screens, total }, null, 1));
const bad = screens.filter((s) => s.problems.length).length;
console.log(`${screens.length} panels, ${screens.reduce((n, s) => n + s.pressed, 0)} pressed, ${bad} with something broken`);
process.exit(bad ? 1 : 0);
