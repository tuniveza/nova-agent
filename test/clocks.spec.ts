// The clocks changing (Europe/London): BST → GMT on the last Sunday in October,
// GMT → BST on the last Sunday in March.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const every30 = (day: string, from: string, until: string) => ({ id: "water", title: "Drink water", minutes: 5, ongoing: true, every: "interval", everyMinutes: 30, earliest: `${day}T${from}`, deadline: `${day}T${until}` });

describe("clock changes", () => {
  it("autumn (25 Oct 2026, 02:00 BST → 01:00 GMT): no session pings twice, none is lost silently", async () => {
    const nova = await boot("2026-10-25T00:00");
    nova.setQuests({ rhythm: { wake: "00:00", sleep: "23:59", startUpMinutes: 0, windDownMinutes: 0 }, quests: [every30("2026-10-25", "00:30", "03:00")] });
    nova.start();
    await nova.run("4h"); // 00:00 BST to 03:00 GMT (four real hours)
    const keys = nova.sent.filter((p) => p.tag === "water").map((p) => `${p.kind}@${p.at}`);
    expect(new Set(keys).size).toBe(keys.length);
    const starts = nova.pings("water", "starting").map((p) => p.at.slice(11, 16));
    // Each wall-clock session once, in order
    expect(starts).toEqual(["00:30", "01:00", "01:30", "02:00", "02:30"]);
    expect(nova.quest("water").status).toBe("done");
  });

  it("spring (28 Mar 2027, 01:00 GMT → 02:00 BST): the hour that never happens is told about, not skipped silently", async () => {
    const nova = await boot("2027-03-28T00:00");
    nova.setQuests({ rhythm: { wake: "00:00", sleep: "23:59", startUpMinutes: 0, windDownMinutes: 0 }, quests: [every30("2027-03-28", "00:30", "03:30")] });
    nova.start();
    await nova.run("3h"); // 00:00 GMT to 04:00 BST (three real hours)
    const starts = nova.pings("water", "starting").map((p) => p.at.slice(11, 16));
    const missed = nova.pings("water", "missed");
    // 01:00 and 01:30 don't exist: they come as one "missed" ping, the rest on time
    expect(starts).toEqual(["00:30", "02:00", "02:30", "03:00"]);
    expect(missed).toHaveLength(1);
    expect(missed[0].message).toMatch(/01:00.*01:30/);
    for (const s of ["00:30", "01:00", "01:30", "02:00", "02:30", "03:00"]) expect(nova.deliveries.sessionDelivery("water", `2027-03-28T${s}`), s).toBeTruthy();
  });
});
