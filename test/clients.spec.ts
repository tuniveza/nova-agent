// Quest 2: Agent's read-only client tools (src/clients.ts, clientTools in src/chat.ts). (The
// studio's bookings are in bookings.spec.ts.) Nova Bot is pretend throughout.  Run: npm test
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const summary = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: "Dana Hollis",
  email: "dana@example.com",
  phone: "07700 900123",
  consent: { yes: false, at: null, source: null },
  lastBooked: "2026-06-20T13:00:00.000Z",
  nextBooked: null,
  sessionCount: 3,
  outstanding: "0.00",
  depositsPaid: "0.00",
  invoiced: "0.00",
  notes: "",
  source: "booking",
  createdAt: "2026-01-01T10:00:00.000Z",
  updatedAt: "2026-06-20T13:00:00.000Z",
  ...over,
});

describe("Agent's client tools (read-only)", () => {
  let seen: { path: string; headers: Record<string, string>; body: any }[] = [];

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-clients-"));
    vi.resetModules();
    seen = [];
    // Sunday 11 October 2026 in London
    vi.useFakeTimers({ now: new Date("2026-10-11T10:00:00.000Z"), toFake: ["Date"] });
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, headers: (init.headers || {}) as Record<string, string>, body });
      if (path === "/nova-agent/clients/find") return Response.json({ clients: [summary({ nextBooked: "2026-10-31T17:00:00.000Z", consent: { yes: true, at: "2026-03-02T12:00:00.000Z", source: "Ticked on the booking form" } })] });
      if (path === "/nova-agent/clients/history")
        return Response.json({
          client: summary(),
          sessions: [
            { id: 1, acuityId: 9001, session: "Rap Package", start: "2026-06-20T13:00:00.000Z", end: "2026-06-20T15:00:00.000Z", price: "60.00", status: "booked", source: "feed" },
            { id: 2, acuityId: 9002, session: "Mixing", start: "2026-06-27T13:00:00.000Z", end: null, price: "40.00", status: "cancelled", source: "webhook" },
          ],
        });
      if (path === "/nova-agent/clients/owing") return Response.json({ clients: [summary({ id: 3, name: "Ali Smalls", outstanding: "45.5" }), summary({ id: 4, name: "Bo Big", outstanding: "120.00" })] });
      if (path === "/nova-agent/clients/lapsed") return Response.json({ clients: [summary(), summary({ id: 9, name: "Cy Old", lastBooked: "2026-02-14T19:30:00.000Z", sessionCount: 1 })] });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tool = async (name: string, actions: any[] = []) => {
    const { clientTools } = await import("../src/chat");
    return clientTools(actions).find((t: any) => t.name === name) as any;
  };

  it("are the four read-only tools", async () => {
    const { clientTools } = await import("../src/chat");
    expect(clientTools([]).map((t: any) => t.name)).toEqual(["client_find", "client_history", "clients_owing", "clients_not_booked_since"]);
  });

  it("client_find asks Nova Bot with the key and says last/next booked in UK time and the consent", async () => {
    const said = await (await tool("client_find")).run({ search: "dana" });
    expect(seen).toEqual([{ path: "/nova-agent/clients/find", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { search: "dana" } }]);
    expect(said).toContain("#7 · Dana Hollis · dana@example.com");
    expect(said).toContain("last booked Sat 20 Jun 2026, 14:00"); // 13:00 UTC is 14:00 BST
    expect(said).toContain("next booked Sat 31 Oct 2026, 17:00"); // GMT by then
    expect(said).toContain("marketing: yes (Ticked on the booking form, Mon 2 Mar 2026)");
  });

  it("client_history lists the sessions newest first, with prices in pounds and cancelled ones marked", async () => {
    const actions: any[] = [];
    const said = await (await tool("client_history", actions)).run({ id: 7 });
    expect(seen.map((s) => [s.path, s.body])).toEqual([["/nova-agent/clients/history", { id: 7 }]]);
    const lines = said.split("\n");
    expect(lines[2]).toBe("Sat 27 Jun 2026, 14:00 · Mixing · £40.00 · CANCELLED");
    expect(lines[3]).toBe("Sat 20 Jun 2026, 14:00 · Rap Package · £60.00");
    // The action line says the id, not the person
    expect(actions[0].text).not.toMatch(/Dana/);
  });

  it("clients_owing says who owes what in pounds, biggest first, with the total", async () => {
    const said = await (await tool("clients_owing")).run({});
    expect(seen.map((s) => [s.path, s.body])).toEqual([["/nova-agent/clients/owing", {}]]);
    const lines = said.split("\n");
    expect(lines[0]).toMatch(/^2 clients owe £165\.50 in all/);
    expect(lines[1]).toMatch(/^Bo Big \(#4\) owes £120\.00/);
    expect(lines[2]).toMatch(/^Ali Smalls \(#3\) owes £45\.50/);
  });

  it("clients_not_booked_since: “since July” in October 2026 means since 1 July 2026", async () => {
    const said = await (await tool("clients_not_booked_since")).run({ month: "July" });
    expect(seen.map((s) => [s.path, s.body])).toEqual([["/nova-agent/clients/lapsed", { since: "2026-07-01" }]]);
    expect(said).toContain("2 clients haven't booked since Wednesday 1 July 2026");
    // Longest gone first
    expect(said.split("\n")[1]).toMatch(/^Cy Old \(#9\) · last booked Sat 14 Feb 2026, 19:30/);
    expect(said.split("\n")[2]).toMatch(/^Dana Hollis \(#7\) · last booked Sat 20 Jun 2026, 14:00/);
  });

  it("works out the since day from a month, months back or a date", async () => {
    const { sinceDate } = await import("../src/clients");
    expect(sinceDate({ month: "July" }, "2026-10-11")).toBe("2026-07-01");
    expect(sinceDate({ month: "october" }, "2026-10-11")).toBe("2026-10-01"); // this month counts
    expect(sinceDate({ month: "November" }, "2026-10-11")).toBe("2025-11-01"); // not yet this year
    expect(sinceDate({ month: "July" }, "2027-03-02")).toBe("2026-07-01");
    expect(sinceDate({ months_back: 3 }, "2026-10-11")).toBe("2026-07-11");
    expect(sinceDate({ months_back: 1 }, "2026-03-31")).toBe("2026-02-28");
    expect(sinceDate({ months_back: 12 }, "2026-01-15")).toBe("2025-01-15");
    expect(sinceDate({ since: "2026-05-04" }, "2026-10-11")).toBe("2026-05-04");
    expect(sinceDate({}, "2026-10-11")).toBeNull();
    // Months back through the tool: today in London is 11 October 2026
    await (await tool("clients_not_booked_since")).run({ months_back: 3 });
    expect(seen.at(-1)!.body).toEqual({ since: "2026-07-11" });
  });

  it("can't change anything: every call is a read on /nova-agent/clients/", async () => {
    for (const [name, input] of [["client_find", { search: "dana" }], ["client_history", { id: 7 }], ["clients_owing", {}], ["clients_not_booked_since", { since: "2026-07-01" }]] as const) await (await tool(name)).run(input);
    expect(seen.every((s) => /^\/nova-agent\/clients\/(find|history|owing|lapsed)$/.test(s.path))).toBe(true);
    const api = await import("../src/clients");
    expect(Object.keys(api).filter((k) => /save|update|edit|set|import|sync|consent|delete|add/i.test(k))).toEqual([]);
  });

  it("says plainly when Nova Bot can't answer", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "Nova Bot is busy" }, { status: 503 }));
    expect(await (await tool("clients_owing")).run({})).toBe("Couldn't read the client list just now: Nova Bot is busy");
  });
});
