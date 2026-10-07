// P0-1: a session is never used up without its ping being delivered.  Run: npm test
import { afterEach, describe, expect, it } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

const water = { id: "water", title: "Drink water", minutes: 5, ongoing: true, every: "interval", everyMinutes: 30, earliest: "2026-10-07T10:00", deadline: "2026-10-07T14:00" };
const sessions = ["10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30"];
const times = (pings: { at: string }[]) => pings.map((p) => p.at.slice(11, 16));

describe("delivery is checked, retried and logged", () => {
  it("a ping the worker turns away (503) is tried again until it gets through", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("30m"); // 10:25: the 10:00 ping is in
    nova.worker.status = 503;
    await nova.run("10m"); // 10:35: the 10:30 ping fails
    expect(times(nova.pings("water"))).toEqual(["10:00"]);
    nova.worker.status = 200;
    await nova.run("5m");
    expect(nova.pings("water")).toHaveLength(2);
    expect(nova.deliveries.sessionDelivery("water", "2026-10-07T10:30")?.state).toBe("delivered");
  });

  it("a ping no phone received (phones: 0) doesn't count as delivered", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.worker.phones = 0;
    nova.start();
    await nova.run("6m");
    expect(nova.deliveries.sessionDelivery("water", "2026-10-07T10:00")?.state).not.toBe("delivered");
    nova.worker.phones = 1;
    await nova.run("2m");
    expect(nova.deliveries.sessionDelivery("water", "2026-10-07T10:00")?.state).toBe("delivered");
  });

  it("every attempt is logged, with what went wrong", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.worker.up = false;
    nova.start();
    await nova.run("6m");
    nova.worker.up = true;
    await nova.run("2m");
    const log = nova.deliveries.attempts("water");
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log[0]).toMatchObject({ ok: false });
    expect(log[0].error).toMatch(/fetch failed/);
    expect(log.at(-1)).toMatchObject({ ok: true, phones: 1 });
  });

  it("a worker that stays down still delivers every session once it's back, and nothing is lost silently", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("20m");
    nova.worker.status = 503; // 10:15 to 10:50
    await nova.run("35m");
    nova.worker.status = 200;
    await nova.run("3h20m");
    // The 10:30 session wasn't skipped: it arrived late, once
    expect(nova.pings("water").filter((p) => p.message.includes("10:30") || p.at.slice(11, 16) >= "10:30" && p.at.slice(11, 16) < "11:00")).toHaveLength(1);
    expect(nova.pings("water")).toHaveLength(8);
  });
});

describe("no session is used up without a delivery record", () => {
  it("Nova Agent off across a session: one late ping on the way back, then on as normal", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("25m"); // 10:20
    await nova.restart("30m"); // off from 10:20 to 10:50: the 10:30 session passes
    await nova.run("3h15m");
    const late = nova.pings("water", "missed");
    expect(late).toHaveLength(1);
    expect(late[0].message).toContain("10:30");
    expect(times(nova.pings("water", "starting"))).toEqual(sessions.filter((s) => s !== "10:30"));
  });

  it("every session the repeat moved past has a delivery record", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("1h");
    nova.worker.up = false;
    await nova.run("1h"); // two sessions while the worker is unreachable
    nova.worker.up = true;
    await nova.restart("20m"); // and a restart on top
    await nova.run("2h");
    expect(nova.quest("water").status).toBe("done");
    for (const s of sessions) {
      const record = nova.deliveries.sessionDelivery("water", `2026-10-07T${s}`);
      expect(record, `session ${s}`).toBeTruthy();
      expect(["delivered", "acknowledged", "expired"], `session ${s}`).toContain(record!.state);
    }
  });

  it("a repeat isn't finished at its deadline while its last session is still undelivered", async () => {
    const nova = await boot("2026-10-07T13:25");
    nova.setQuests({ quests: [{ ...water, earliest: "2026-10-07T13:30", deadline: "2026-10-07T13:40" }] });
    nova.worker.status = 503;
    nova.start();
    await nova.run("20m"); // 13:45: past the deadline, the 13:30 ping hasn't got through (it's worth sending until 14:00)
    expect(nova.quest("water").status).toBe("todo");
    nova.worker.status = 200;
    await nova.run("5m");
    expect(nova.pings("water")).toHaveLength(1);
    expect(nova.quest("water").status).toBe("done");
  });

  it("a ping that can't get through before it's stale is given up on visibly, not silently", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.worker.up = false;
    nova.start();
    await nova.run("45m"); // the 10:00 "starting" ping is only worth 30 minutes
    const record = nova.deliveries.sessionDelivery("water", "2026-10-07T10:00");
    expect(record?.state).toBe("expired");
    expect(nova.reminders.recentNotices().some((n) => n.kind === "undelivered" && n.questId === "water")).toBe(true);
  });

  it("marking a session done by hand counts as acknowledged", async () => {
    const nova = await boot("2026-10-07T09:55");
    nova.setQuests({ quests: [water] });
    nova.start();
    await nova.run("6m");
    nova.actions.setQuestStatus("water", "done");
    expect(nova.deliveries.sessionDelivery("water", "2026-10-07T10:00")?.state).toBe("acknowledged");
  });
});
