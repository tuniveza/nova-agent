// Copies the Nova Portal badge and the Nova Manual (app/badge.js, app/manual.js and
// app/manual-data.js, the only real copies) into the suite apps that live on their own
// sites, as js/portal-badge.js, js/nova-manual.js and js/nova-manual-data.js. Nova Bot's
// worker and Nova Agent serve them straight from here (/portal/...), so they don't need a copy.
//   node scripts/share-badge.mjs        (build-manual.mjs runs it after making the manual)
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const files = { "badge.js": "portal-badge.js", "manual.js": "nova-manual.js", "manual-data.js": "nova-manual-data.js" };
const apps = { "Nova Notes": "../../nn/js", "Nova Calendar": "../../na/calendar/js", "Nova Observatory": "../../no/js" };
for (const [name, dir] of Object.entries(apps)) {
  const to = join(here, dir);
  if (!existsSync(to)) {
    console.log(`skip ${name}: ${to} isn't there`);
    continue;
  }
  const shared = [];
  for (const [from, as] of Object.entries(files)) {
    const source = join(here, "..", "app", from);
    if (!existsSync(source)) continue;
    copyFileSync(source, join(to, as));
    shared.push(`js/${as}`);
  }
  console.log(`${name}: ${shared.join(", ")}`);
}
