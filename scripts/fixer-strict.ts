// The Fixer's check (src/fixer/strict.ts: the three strict rules), as its own process (the Fixer
// runs it with low priority every 30 minutes).
//
//   npx tsx scripts/fixer-strict.ts <address> [--out results.json] [--shots folder]
//     [--sizes 390x844,1920x1080] [--places Agent,Portal] [--parallel 2] [--rules-off]
//   (--rules-off: with the screens' own fixing, web/shared/rules.js, off: what they'd break without it)
//
// Signed in: the cookie comes in the environment (LOOKS_COOKIE_NAME, LOOKS_COOKIE), never on the
// command line and never printed. Prints one line per screen; exits 1 if any rule is broken.
import { writeFileSync } from "node:fs";
import { STRICT_SIZES, runStrict, strictCounts } from "../src/fixer/strict";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : "";
};
const base = args.find((a) => /^https?:\/\//.test(a));
if (!base) {
  console.error("Which address? e.g. npx tsx scripts/fixer-strict.ts http://localhost:4721");
  process.exit(2);
}
const value = process.env.LOOKS_COOKIE || "";
const sizes = opt("sizes")
  ? opt("sizes").split(",").map((s) => {
      const [w, h] = s.split("x").map(Number);
      return STRICT_SIZES.find((z) => z.w === w && z.h === h) || { w, h, kind: w < 600 || (w > h && h <= 500) ? ("phone" as const) : w <= 1024 ? ("tablet" as const) : ("computer" as const) };
    })
  : undefined;
const run = await runStrict({
  base,
  sizes,
  places: opt("places") ? opt("places").split(",") : undefined,
  cookie: value ? { name: process.env.LOOKS_COOKIE_NAME || "nova_session", value } : null,
  shotsDir: opt("shots") || undefined,
  parallel: Number(opt("parallel")) || 2,
  rulesOff: args.includes("--rules-off"),
  log: (line) => console.log(line),
});
if (opt("out")) writeFileSync(opt("out"), JSON.stringify(run, null, 1));
const c = strictCounts(run);
console.log(`${run.screens.length} screens: ${c.offscreen} off the screen, ${c.onescreen} not one screen, ${c.oneline} onto the next line`);
process.exit(c.offscreen + c.onescreen + c.oneline ? 1 : 0);
