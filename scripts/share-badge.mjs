// Copies the Nova Portal badge (app/badge.js, the only real copy) into the suite apps that
// live on their own sites, as js/portal-badge.js. Nova Bot's worker and Nova Agent serve it
// straight from here (/portal/badge.js), so they don't need a copy.
//   node scripts/share-badge.mjs
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "app", "badge.js");
const apps = { "Nova Notes": "../../nn/js", "Nova Calendar": "../../na/calendar/js", "Nova Observatory": "../../no/js" };
for (const [name, dir] of Object.entries(apps)) {
  const to = join(here, dir);
  if (!existsSync(to)) {
    console.log(`skip ${name}: ${to} isn't there`);
    continue;
  }
  copyFileSync(source, join(to, "portal-badge.js"));
  console.log(`${name}: js/portal-badge.js`);
}
