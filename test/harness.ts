// The simulated clock for Nova Quests: a fake clock (Vitest's fake timers move
// Date, setTimeout and setInterval together), a pretend Nova Bot worker that
// records every /hub/notify, and a fresh data folder for every test.
//
//   const nova = await boot("2026-10-07T09:00");      // UK wall-clock time
//   nova.setQuests({ quests: [...] });
//   nova.start();                                      // as the service does
//   await nova.run("4h");
//   expect(nova.pings("water")).toHaveLength(8);

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

export interface Ping {
  at: string; // UK wall-clock time it was sent
  title: string;
  message: string;
  kind: string;
  tag: string;
  keep: boolean;
}

// The UTC moment for a UK wall-clock time ("2026-10-07T09:00")
export function london(stamp: string): Date {
  const wall = Date.parse(`${stamp.length === 16 ? `${stamp}:00` : stamp}Z`);
  // Try GMT, then BST; the first that reads back as the same wall time wins
  for (const offset of [0, 60]) {
    const at = new Date(wall - offset * 60000);
    if (wallClock(at) === new Date(wall).toISOString().slice(0, 19)) return at;
  }
  // A time that doesn't exist (the hour skipped in March): the moment after
  return new Date(wall - 0);
}
export function wallClock(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

const span = (s: string | number) => {
  if (typeof s === "number") return s;
  // "4h10m", "90s", "1h"
  const parts = [...s.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)];
  if (!parts.length || parts.map((p) => p[0]).join("") !== s) throw new Error(`Not a length: ${s}`);
  return parts.reduce((n, p) => n + Number(p[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[p[2] as "ms"], 0);
};

export async function boot(at: string) {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-agent-test-"));
  vi.useFakeTimers({ now: london(at), toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.resetModules();

  // The pretend worker: answers as the real one does ({ ok, phones }) unless told otherwise
  const sent: Ping[] = [];
  const worker = {
    up: true,
    status: 200,
    phones: 1,
    calls: 0,
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith("/hub/notify")) return new Response("{}", { status: 404 });
    worker.calls++;
    if (!worker.up) throw new TypeError("fetch failed");
    if (worker.status !== 200) return new Response("Service Unavailable", { status: worker.status });
    const body = JSON.parse(String(init?.body));
    sent.push({ at: wallClock(new Date()), title: body.title, message: body.message, kind: body.kind, tag: body.tag, keep: body.keep });
    return Response.json({ ok: true, phones: worker.phones });
  });
  // Quiet: the trace prints every notice
  vi.spyOn(console, "log").mockImplementation(() => {});

  const load = async () => ({
    store: await import("../src/quests/store"),
    plan: await import("../src/quests/plan"),
    reminders: await import("../src/quests/reminders"),
    pulses: await import("../src/quests/pulses"),
    actions: await import("../src/quests/actions"),
    deliveries: await import("../src/quests/deliveries"),
    calendar: await import("../src/calendar/store"),
    calendarPage: await import("../src/calendar/page"),
  });
  let m = await load();

  return {
    get store() {
      return m.store;
    },
    get plan() {
      return m.plan;
    },
    get reminders() {
      return m.reminders;
    },
    get actions() {
      return m.actions;
    },
    get deliveries() {
      return m.deliveries;
    },
    get calendar() {
      return m.calendar;
    },
    get calendarPage() {
      return m.calendarPage;
    },
    worker,
    sent,
    // Pings that reached the phones for one quest (or all), optionally of one kind
    pings: (questId?: string, kind?: string) => sent.filter((p) => (!questId || p.tag === questId) && (!kind || p.kind === kind)),
    quest: (id: string) => m.store.readQuests().quests.find((q) => q.id === id)!,
    setQuests(data: { rhythm?: Partial<import("../src/quests/store").Rhythm>; quests: any[] }) {
      const rhythm = { ...m.store.DEFAULT_RHYTHM, wake: "07:00", sleep: "23:30", remindMinutesBefore: 0, dailyBriefing: false, paceLimits: false, phonePush: true, ...data.rhythm };
      m.store.writeQuests(m.store.normaliseQuests({ rhythm, quests: data.quests.map((q) => ({ created: "2026-10-01T00:00:00Z", ...q })) }));
    },
    // Start up the way the service does (server.ts): plan, then reminders and pulses
    start() {
      m.plan.replan();
      m.reminders.startQuestReminders();
      m.pulses.startPulses();
    },
    // Nova Agent stops (the PC sleeps, the service restarts) and comes back
    // `after` later, with the same data folder
    async restart(after: string | number) {
      const back = Date.now() + span(after);
      // (clearAllTimers also winds the fake clock back to where it started, hence `back`)
      vi.clearAllTimers();
      m.deliveries.closeDeliveries();
      vi.setSystemTime(back);
      vi.resetModules();
      m = await load();
      this.start();
    },
    // Let time pass, running every timer (and the promises they start) on the way
    async run(length: string | number) {
      await vi.advanceTimersByTimeAsync(span(length));
    },
    now: () => wallClock(new Date()),
  };
}

export function shutdown(): void {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
