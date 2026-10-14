// The Fixer's looks check, as its own process (the Fixer runs it with low priority: nice, one
// browser, one page at a time; src/fixer/looks.ts says what it checks).
//
//   npx tsx scripts/fixer-looks.ts <address> [--out results.json] [--shots folder] [--prefix before-]
//     [--sizes 390x844,2000x1130] [--panels /portal/,/app/memory/] [--auth both|in|out] [--mock-portal] [--shoot-all]
//
// Signed in: the cookie comes in the environment (LOOKS_COOKIE_NAME, LOOKS_COOKIE), never on the
// command line and never printed. --mock-portal: sample answers for Portal (a job's copy of Nova
// Agent has no Nova Bot behind it). Prints one line per screen; exits 1 if anything's wrong.
import { writeFileSync } from "node:fs";
import { runLooks, type LooksOptions } from "../src/fixer/looks";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) {
  console.error("Which address? e.g. npx tsx scripts/fixer-looks.ts http://localhost:4721");
  process.exit(2);
}
const sizes = opt("sizes") ? opt("sizes").split(",").map((s) => s.split("x").map(Number) as [number, number]) : undefined;
const value = process.env.LOOKS_COOKIE || "";
const options: LooksOptions = {
  base,
  sizes,
  panels: opt("panels") ? opt("panels").split(",") : undefined,
  auth: (opt("auth") as LooksOptions["auth"]) || (value ? "both" : "out"),
  cookie: value ? { name: process.env.LOOKS_COOKIE_NAME || "nova_session", value } : null,
  shotsDir: opt("shots") || undefined,
  shotPrefix: opt("prefix") || "",
  shootAll: args.includes("--shoot-all"),
  log: (line) => console.log(line),
};
if (args.includes("--mock-portal")) {
  const { portalMock } = await import("./check-fit-portal-samples.mjs" as string);
  options.mockPortal = portalMock;
}
const screens = await runLooks(options);
if (opt("out")) writeFileSync(opt("out"), JSON.stringify({ screens }, null, 1));
const bad = screens.filter((s) => s.problems.length).length;
console.log(`${screens.length} screens, ${bad} with problems`);
process.exit(bad ? 1 : 0);
