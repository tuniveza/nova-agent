// Looking at webpages: page_look only ever opens the public internet.  Run: npx tsx test/web.test.ts
import assert from "node:assert/strict";
import { checkPublicUrl } from "../src/web";

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log("  ✓", name); };

async function main() {
  for (const url of ["http://localhost:4545/", "http://127.0.0.1/", "http://[::1]/", "http://192.168.1.1/", "http://10.0.0.5/", "http://169.254.169.254/", "http://studio.local/", "file:///etc/passwd", "https://user:pw@example.com/", "not a url"]) {
    await check(`won't open ${url}`, () => assert.rejects(checkPublicUrl(url)));
  }

  await check("opens a public https page", async () => {
    assert.equal((await checkPublicUrl("https://1.1.1.1/")).hostname, "1.1.1.1");
  });

  console.log(`\n${passed} web checks passed`);
}

main();
