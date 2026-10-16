// A panel kept in the background draws nothing (web/shared/fit.js, 16 Oct 2026): its
// requestAnimationFrame callbacks wait while its frame is hidden, and run again once it's shown.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";

const FIT = readFileSync(join(__dirname, "../web/shared/fit.js"), "utf8").replace(/<\/script>/g, "<\\/script>");
let browser: Browser;
beforeAll(async () => {
  const { chromium } = await import("playwright");
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

describe("a panel in the background draws nothing", () => {
  it("its frames stop while it's hidden and start again when it's shown", async () => {
    const page = await browser.newPage();
    const inner = `<script>${FIT}<\/script><script>window.n = 0; (function loop() { window.n++; requestAnimationFrame(loop); })();<\/script>`;
    await page.setContent(`<iframe id="f" style="width:300px;height:200px"></iframe>`);
    await page.evaluate((html) => { (document.getElementById("f") as HTMLIFrameElement).srcdoc = html; }, inner);
    await page.waitForTimeout(600);
    const count = () => page.evaluate(() => ((document.getElementById("f") as HTMLIFrameElement).contentWindow as any).n as number);
    const a = await count();
    await page.waitForTimeout(400);
    expect(await count()).toBeGreaterThan(a + 5); // (drawing while it's on show)
    await page.evaluate(() => { document.getElementById("f")!.hidden = true; });
    await page.waitForTimeout(400);
    const b = await count();
    await page.waitForTimeout(800);
    expect(await count()).toBeLessThanOrEqual(b + 1); // (nothing while it's hidden)
    await page.evaluate(() => { document.getElementById("f")!.hidden = false; });
    await page.waitForTimeout(900);
    expect(await count()).toBeGreaterThan(b + 5); // (and again once it's shown)
    await page.close();
  });
});
