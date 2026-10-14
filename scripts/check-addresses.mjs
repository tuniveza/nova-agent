// Does every address in All addresses (web/shared/addresses.js) answer on the live site?
//   node scripts/check-addresses.mjs
// A page or file answers 200; a sign-in, a redirect or "only posts here" counts as answering too.
// Not found (404) or a server error is a fail.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const box = { window: {} };
vm.runInNewContext(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "web", "shared", "addresses.js"), "utf8"), box);
const items = box.window.NovaAddresses.list(true).flatMap((g) => g.items).filter((i) => i.url);
let bad = 0;
for (const i of items) {
  let status = 0;
  try {
    status = (await fetch(i.url, { redirect: "manual", headers: { accept: "text/html" }, signal: AbortSignal.timeout(10000) })).status;
  } catch {}
  const ok = (status >= 200 && status < 400) || status === 401 || status === 403 || status === 405;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${status || "no answer"} ${i.name}  ${i.url}`);
}
console.log(bad ? `${bad} of ${items.length} didn't answer` : `All ${items.length} answer`);
process.exit(bad ? 1 : 0);
