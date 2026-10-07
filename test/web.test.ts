// Research and looking at webpages: a plan only cites pages it really read, and
// page_look only ever opens the public internet.  Run: npx tsx test/web.test.ts
import assert from "node:assert/strict";
import { checkedFindings } from "../src/quests/planner";
import { checkPublicUrl } from "../src/web";

let passed = 0;
const check = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log("  ✓", name); };

async function main() {
  await check("findings are kept only when they cite a page that was really searched up or read", () => {
    const research = [
      { finding: "Reels can be up to 20 minutes", source_url: "https://a.com/reels/" },
      { finding: "Something made up", source_url: "https://not-looked-at.com/" },
      { finding: "  ", source_url: "https://a.com/reels" },
    ];
    const kept = checkedFindings({ research }, [{ title: "Reel lengths", url: "https://a.com/reels" }]);
    assert.deepEqual(kept, [{ text: "Reels can be up to 20 minutes", title: "Reel lengths", url: "https://a.com/reels" }]);
  });

  await check("no research, nothing kept", () => {
    assert.deepEqual(checkedFindings({ research: [] }, []), []);
  });

  for (const url of ["http://localhost:4545/", "http://127.0.0.1/", "http://[::1]/", "http://192.168.1.1/", "http://10.0.0.5/", "http://169.254.169.254/", "http://studio.local/", "file:///etc/passwd", "https://user:pw@example.com/", "not a url"]) {
    await check(`won't open ${url}`, () => assert.rejects(checkPublicUrl(url)));
  }

  await check("opens a public https page", async () => {
    assert.equal((await checkPublicUrl("https://1.1.1.1/")).hostname, "1.1.1.1");
  });

  console.log(`\n${passed} web checks passed`);
}

main();
