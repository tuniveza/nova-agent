// Quest 3: Agent's email campaign tools (src/campaigns.ts, campaignTools in src/chat.ts). Agent can
// suggest, draft, edit and read results; it can never approve, send, schedule or test-send (an admin
// does that in Portal → Campaigns with their own sign-in). Nova Bot is pretend throughout.  Run: npm test
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const campaign = (over: Record<string, unknown> = {}) => ({
  id: 12,
  subject: "Winter sessions are open",
  body: "Hi,\n\nWinter sessions are open. **Book before 1 December** for 10% off.\n\nNovacane Studios",
  audience: "fans",
  sendAt: null,
  status: "pending_approval",
  createdBy: "agent",
  createdAt: "2026-10-11T09:00:00.000Z",
  updatedAt: "2026-10-11T09:00:00.000Z",
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  note: null,
  recipients: null,
  sentAt: null,
  error: null,
  stats: null,
  portalUrl: "https://worker.test/portal/?view=campaigns&campaign=12",
  ...over,
});
const sentOne = campaign({
  id: 9,
  subject: "New mixing packages",
  audience: "everyone",
  status: "sent",
  recipients: 50,
  sentAt: "2026-10-02T17:00:00.000Z",
  decidedByName: "Ash",
  stats: { sent: 50, delivered: 48, opened: 21, clicked: 6, bounced: 2, unsubscribed: 1, complained: 0, fetchedAt: "2026-10-03T09:00:00.000Z" },
});
const audiences = { fans: 42, clients: 18, everyone: 55 };

describe("Agent's email campaign tools", () => {
  let seen: { path: string; headers: Record<string, string>; body: any }[] = [];

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-campaigns-"));
    vi.resetModules();
    seen = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, headers: (init.headers || {}) as Record<string, string>, body });
      if (path === "/nova-agent/campaigns/context") return Response.json({ audiences, recent: [sentOne, campaign({ id: 11, status: "rejected", note: "Too salesy", decidedByName: "Ash" })], today: "2026-10-11" });
      if (path === "/nova-agent/campaigns/draft") return Response.json({ campaign: campaign({ subject: body.subject, body: body.body, audience: body.audience, sendAt: body.sendAt ?? null }) });
      if (path === "/nova-agent/campaigns/12/edit") return Response.json({ campaign: campaign({ ...body, updatedAt: "2026-10-11T10:00:00.000Z" }) });
      if (path === "/nova-agent/campaigns/9") return Response.json({ campaign: sentOne, log: [{ event: "sent", at: "2026-10-02T17:00:00.000Z" }] });
      if (path === "/nova-agent/campaigns/12") return Response.json({ campaign: campaign(), log: [] });
      if (path === "/nova-agent/campaigns") return Response.json({ campaigns: body?.status === "sent" ? [sentOne] : [campaign(), sentOne] });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tool = async (name: string, actions: any[] = []) => {
    const { campaignTools } = await import("../src/chat");
    return campaignTools(actions).find((t: any) => t.name === name) as any;
  };

  it("are suggest, draft, edit, results and list: nothing that approves, sends, schedules or tests", async () => {
    const { campaignTools } = await import("../src/chat");
    const names = campaignTools([]).map((t: any) => t.name);
    expect(names).toEqual(["suggest_campaign", "create_campaign_draft", "edit_campaign_draft", "campaign_results", "list_campaigns"]);
    expect(names.filter((n: string) => /approve|send|schedule|test|decide|reject|publish|broadcast/.test(n))).toEqual([]);
    // Nor anything in campaigns.ts that could
    const api = await import("../src/campaigns");
    expect(Object.keys(api).filter((k) => /approve|send(?!At)|schedule|test|decide|reject|publish|broadcast/i.test(k))).toEqual([]);
    // Every description says an admin approves before anything goes
    for (const t of campaignTools([]).filter((t: any) => /draft/.test(t.name)) as any[]) expect(t.description).toMatch(/admin/);
  });

  it("suggest_campaign reads the context with Nova Agent's key and saves nothing", async () => {
    const actions: any[] = [];
    const said = await (await tool("suggest_campaign", actions)).run({});
    expect(seen).toEqual([{ path: "/nova-agent/campaigns/context", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: {} }]);
    expect(said).toContain("42 people as confirmed fans");
    expect(said).toContain("18 people as studio clients");
    expect(said).toContain("Nothing has been saved");
    expect(said).toMatch(/Suggest 1–3 campaign ideas/);
    expect(said).toContain("44% of those it reached"); // the last one's opens, from its stats
    expect(said).toContain("Too salesy");
    // No card: there's nothing to approve
    expect(actions.every((a) => a.kind === "looked")).toBe(true);
  });

  it("create_campaign_draft posts a draft only, says plainly nothing is sent, and adds the card", async () => {
    const actions: any[] = [];
    const said = await (await tool("create_campaign_draft", actions)).run({ subject: "Winter sessions are open", body: "Hi,\n\nBook now.\n\nNovacane Studios", audience: "fans" });
    expect(seen[0]).toEqual({ path: "/nova-agent/campaigns/draft", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { subject: "Winter sessions are open", body: "Hi,\n\nBook now.\n\nNovacane Studios", audience: "fans" } });
    // (then the audience's size for the card, read-only)
    expect(seen.slice(1).map((s) => s.path)).toEqual(["/nova-agent/campaigns/context"]);
    expect(said).toContain("NOT sent");
    expect(said).toMatch(/Nothing has been sent: it goes to nobody until an admin approves it in Nova Portal → Campaigns/);
    expect(said.replace(/Nothing has been sent/g, "")).not.toMatch(/\b(has been|was|is) (sent|scheduled)\b/i);
    expect(actions).toEqual([{ kind: "campaign", text: expect.stringContaining("waiting for an admin"), campaign: expect.objectContaining({ id: 12, status: "pending_approval", audienceCount: 42, portalUrl: expect.stringContaining("view=campaigns&campaign=12") }) }]);
  });

  it("a send time is UK wall-clock turned into UTC (GMT after the clocks go back, BST before)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    try {
      await (await tool("create_campaign_draft")).run({ subject: "S", body: "B", audience: "everyone", send_at: "2026-11-06T18:00" });
      expect(seen[0].body.sendAt).toBe("2026-11-06T18:00:00.000Z");
      seen = [];
      await (await tool("create_campaign_draft")).run({ subject: "S", body: "B", audience: "everyone", send_at: "2026-10-16T18:00" });
      expect(seen[0].body.sendAt).toBe("2026-10-16T17:00:00.000Z");
      // A time that's gone isn't sent to Nova Bot at all
      seen = [];
      const said = await (await tool("create_campaign_draft")).run({ subject: "S", body: "B", audience: "everyone", send_at: "2026-10-01T18:00" });
      expect(said).toMatch(/has passed/);
      expect(seen).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("edit_campaign_draft posts only the changes to the edit route, and it's back waiting for approval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    try {
      const actions: any[] = [];
      const said = await (await tool("edit_campaign_draft", actions)).run({ id: 12, subject: "Winter sessions: 10% off", send_at: "2026-10-20T10:00" });
      expect(seen[0]).toEqual({ path: "/nova-agent/campaigns/12/edit", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { subject: "Winter sessions: 10% off", sendAt: "2026-10-20T09:00:00.000Z" } });
      expect(said).toMatch(/back to waiting for approval/);
      expect(said).toMatch(/Nothing has been sent/);
      expect(actions[0]).toMatchObject({ kind: "campaign", campaign: { id: 12, subject: "Winter sessions: 10% off" } });
      // Sending as soon as it's approved clears the time
      seen = [];
      await (await tool("edit_campaign_draft")).run({ id: 12, send_when_approved: true });
      expect(seen[0].body).toEqual({ sendAt: null });
      // Nothing to change: nothing is asked
      seen = [];
      expect(await (await tool("edit_campaign_draft")).run({ id: 12 })).toMatch(/Say what to change/);
      expect(seen).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("campaign_results says opens and clicks as percentages in plain words", async () => {
    const latest = await (await tool("campaign_results")).run({});
    expect(seen.map((s) => s.path)).toEqual(["/nova-agent/campaigns"]);
    expect(seen[0].body).toEqual({ status: "sent" });
    expect(latest).toContain("“New mixing packages” (#9, to everyone (fans and studio clients)) was sent Fri 2 Oct 2026, 18:00");
    expect(latest).toContain("went to 50 people, 48 delivered");
    expect(latest).toContain("21 opened it (44% of those it reached)");
    expect(latest).toContain("6 clicked a link (13%)");
    expect(latest).toContain("1 unsubscribed");
    expect(latest).toContain("2 bounced");
    seen = [];
    const byId = await (await tool("campaign_results")).run({ id: 9 });
    expect(seen.map((s) => s.path)).toEqual(["/nova-agent/campaigns/9"]);
    expect(byId).toContain("44%");
    // One that hasn't gone yet says so
    expect(await (await tool("campaign_results")).run({ id: 12 })).toMatch(/hasn't been sent: it's waiting for an admin's approval \(not sent\)\. Nothing is sent until an admin approves it/);
  });

  it("list_campaigns reads the list (all, or one status)", async () => {
    const all = await (await tool("list_campaigns")).run({});
    expect(seen[0]).toEqual({ path: "/nova-agent/campaigns", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: {} });
    expect(all).toContain("#12 “Winter sessions are open” · waiting for an admin's approval (not sent)");
    expect(all).toContain("#9 “New mixing packages” · sent");
    await (await tool("list_campaigns")).run({ status: "pending_approval" });
    expect(seen[1].body).toEqual({ status: "pending_approval" });
  });

  it("never calls anything but /nova-agent/campaigns routes, and never an approve, send, schedule or test-send", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
    try {
      const run = async (name: string, input: any) => (await tool(name)).run(input);
      await run("suggest_campaign", {});
      await run("create_campaign_draft", { subject: "S", body: "B", audience: "clients", send_at: "2026-10-30T12:00" });
      await run("edit_campaign_draft", { id: 12, body: "New words" });
      await run("campaign_results", {});
      await run("campaign_results", { id: 9 });
      await run("list_campaigns", {});
    } finally {
      vi.useRealTimers();
    }
    expect(seen.length).toBeGreaterThan(5);
    for (const s of seen) {
      expect(s.path).toMatch(/^\/nova-agent\/campaigns(\/|$)/);
      expect(s.path).not.toMatch(/approve|send|schedule|test|reject|app\/api/);
      expect(s.headers.Authorization).toBe("Bearer test-key");
      // A draft or an edit carries only what it says: never a status, an approval or a send
      if (/\/(draft|edit)$/.test(s.path)) for (const k of Object.keys(s.body)) expect(["subject", "body", "audience", "sendAt"]).toContain(k);
    }
  });

  it("says plainly when Nova Bot can't be reached, and saves nothing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const actions: any[] = [];
    const said = await (await tool("create_campaign_draft", actions)).run({ subject: "S", body: "B", audience: "fans" });
    expect(said).toMatch(/Couldn't save the draft: Couldn't reach Nova Bot: network down Nothing was saved or sent\./);
    expect(actions).toEqual([]);
    expect(await (await tool("suggest_campaign")).run({})).toMatch(/Couldn't reach the email campaigns just now/);
  });

  it("the system prompt tells Agent nothing is sent until an admin approves", async () => {
    const src = (await import("node:fs")).readFileSync(join(__dirname, "../src/chat.ts"), "utf8");
    expect(src).toContain("Nothing is sent to anyone until an admin presses Approve in Nova Portal → Campaigns");
    expect(src).toContain("...campaignTools(actions)");
  });
});
