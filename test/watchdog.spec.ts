// The watchdog (src/watchdog.ts): reads Nova Bot's status page, tells someone after 2 misses in a
// row (once), and says when it's working again.
import { describe, expect, it } from "vitest";
import { checkStatus, makeWatchdog } from "../src/watchdog";

const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const down = (async () => {
  throw new Error("offline");
}) as unknown as typeof fetch;

describe("watchdog", () => {
  it("reads the status page", async () => {
    expect(await checkStatus("https://x/status.json", answer(200, { ok: true, overall: "Everything's working" }))).toEqual({ ok: true, why: "Everything's working" });
    expect(await checkStatus("https://x/status.json", answer(503, { ok: false, parts: [{ name: "Emails", state: "red" }] }))).toEqual({ ok: false, why: "needs attention: Emails" });
    expect((await checkStatus("https://x/status.json", down)).why).toBe("couldn't be reached");
  });

  it("tells someone after 2 misses in a row, once, and again when it's back", async () => {
    const told: string[] = [];
    let fetcher = down;
    const tick = makeWatchdog("https://x/status.json", { fetch: (...a) => fetcher(...a), notify: (t) => void told.push(t) });
    await tick();
    expect(told).toEqual([]);
    await tick();
    expect(told).toEqual(["Nova needs a look"]);
    await tick();
    expect(told).toEqual(["Nova needs a look"]);
    fetcher = answer(200, { ok: true });
    await tick();
    expect(told).toEqual(["Nova needs a look", "Nova is working again"]);
    await tick();
    expect(told.length).toBe(2);
  });

  it("a single miss doesn't alert", async () => {
    const told: string[] = [];
    let fetcher = down;
    const tick = makeWatchdog("https://x/status.json", { fetch: (...a) => fetcher(...a), notify: (t) => void told.push(t) });
    await tick();
    fetcher = answer(200, { ok: true });
    await tick();
    fetcher = down;
    await tick();
    expect(told).toEqual([]);
  });
});
