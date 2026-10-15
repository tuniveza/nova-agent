// The Fixer's looks check, as its own process (the Fixer runs it with low priority: nice, one
// browser, one page at a time; src/fixer/looks.ts says what it checks).
//
//   npx tsx scripts/fixer-looks.ts <address> [--out results.json] [--shots folder] [--prefix before-]
//     [--sizes 390x844,2000x1130] [--panels /portal/,/app/memory/] [--auth both|in|out] [--mock-portal] [--shoot-all]
//     [--edges] [--resize-to 1024x768,780x360] [--buttons]
//
// --buttons: the buttons check instead (scripts/fixer-buttons.ts, src/fixer/buttons.ts): every button
// in the panels pressed, at each --sizes size, signed in or out as --auth says.
//
// --edges: the edges check only (is anything out of sight: off the screen, cut off by its box, or in a
// row that scrolls sideways), on opening, with each dialog open, after clicking what opens or switches
// something, and after the window's made each --resize-to size of the same kind of device.
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
const pairs = (v: string) => v.split(",").map((s) => s.split("x").map(Number) as [number, number]);
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
  edges: args.includes("--edges"),
  ...(opt("resize-to") ? { resizeTo: pairs(opt("resize-to")) } : args.includes("--resize-to") ? { resizeTo: [] } : {}),
  log: (line) => console.log(line),
};
if (args.includes("--mock-portal")) {
  const { portalMock } = await import("./check-fit-portal-samples.mjs" as string);
  options.mockPortal = portalMock;
}
if (args.includes("--buttons")) {
  const { runButtons } = await import("../src/fixer/buttons");
  const all = [];
  for (const size of sizes || [[1440, 900]]) {
    const r = await runButtons({ base, size: [size[0], size[1]], panels: options.panels, cookie: options.auth === "out" ? null : options.cookie, mockPortal: options.mockPortal, budgetMs: 20 * 60_000, log: (line) => console.log(line) });
    all.push(...r.screens);
  }
  if (opt("out")) writeFileSync(opt("out"), JSON.stringify({ screens: all }, null, 1));
  const broken = all.filter((s) => s.problems.length).length;
  console.log(`${all.length} panels, ${all.reduce((n, s) => n + s.pressed, 0)} pressed, ${broken} with something broken`);
  process.exit(broken ? 1 : 0);
}
const screens = await runLooks(options);
if (opt("out")) writeFileSync(opt("out"), JSON.stringify({ screens }, null, 1));
const bad = screens.filter((s) => s.problems.length).length;
console.log(`${screens.length} screens, ${bad} with problems`);
process.exit(bad ? 1 : 0);
