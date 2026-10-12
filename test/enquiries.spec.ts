// Agent and enquiries (src/enquiries.ts, the enquiry tools in src/chat.ts), against a pretend
// Nova Bot: Agent can list, read and DRAFT, and has no way to send or approve.  Run: npm test
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let seen: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];

beforeEach(() => {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-enquiries-"));
  vi.resetModules();
  seen = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    seen.push({ url, method: init.method || "GET", headers: (init.headers || {}) as Record<string, string>, body });
    const path = new URL(url).pathname;
    if (path === "/nova-agent/enquiries") return Response.json({ enquiries: [{ id: 7, name: "Jordan Test", state: "new", details: "Mixing", drafts_waiting: 0 }] });
    if (path === "/nova-agent/enquiries/7")
      return Response.json({
        enquiry: { id: 7, name: "Jordan Test", email: "jordan@example.com", state: "new", created_at: "2026-10-09T23:30:00Z", subject: "EP mixing", details: "Mixing 4 tracks" },
        messages: [{ direction: "note", created_by: "staff", author_name: "Dom", created_at: "2026-10-10T09:00:00Z", body: "They prefer Fridays" }],
      });
    if (path === "/nova-agent/enquiries/7/drafts")
      return Response.json({ ok: true, draft: { id: 31, enquiryId: 7, body: body.body, status: "draft" }, enquiry: { name: "Jordan Test", email: "jordan@example.com", subject: "EP mixing" }, portalUrl: "https://worker.test/portal/?view=enquiries&enquiry=7" });
    if (path === "/nova-agent/enquiries/8/drafts") return Response.json({ error: "They've asked not to be contacted, so don't draft a reply." }, { status: 409 });
    if (path === "/nova-agent/inbox/sort") return Response.json({ ok: true, enquiry: { id: body.id, status: body.state === "waiting" ? "replied" : body.state, label: body.label ?? null } });
    if (path === "/nova-agent/inbox/saved") return Response.json({ saved: [{ id: 1, title: "Prices", body: "£40 an hour" }] });
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Talking to Nova Bot about enquiries", () => {
  it("lists, reads and drafts with Nova Agent's key, at the agent addresses only", async () => {
    const { listEnquiries, readEnquiry, draftReply } = await import("../src/enquiries");
    expect((await listEnquiries()).map((e) => e.id)).toEqual([7]);
    expect((await readEnquiry(7)).enquiry.name).toBe("Jordan Test");
    const card = await draftReply(7, "Hi Jordan");
    expect(card).toEqual({ id: 31, enquiryId: 7, name: "Jordan Test", email: "jordan@example.com", subject: "EP mixing", body: "Hi Jordan", portalUrl: "https://worker.test/portal/?view=enquiries&enquiry=7" });
    expect(seen.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual(["POST /nova-agent/enquiries", "POST /nova-agent/enquiries/7", "POST /nova-agent/enquiries/7/drafts"]);
    for (const s of seen) {
      expect(s.url.startsWith("https://worker.test/nova-agent/")).toBe(true);
      expect(s.headers.Authorization).toBe("Bearer test-key");
    }
    // Only the text is sent: nothing that could ask for it to be approved
    expect(seen[2].body).toEqual({ body: "Hi Jordan" });
  });

  it("passes Nova Bot's refusal on (e.g. don't contact)", async () => {
    const { draftReply } = await import("../src/enquiries");
    await expect(draftReply(8, "Hi")).rejects.toThrow("asked not to be contacted");
  });

  it("has nothing that sends or approves", async () => {
    const mod = await import("../src/enquiries");
    expect(Object.keys(mod).filter((k) => /send|approve|deliver|email/i.test(k))).toEqual([]);
  });

  it("writes the conversation out for Claude, in UK time, warning about do-not-contact", async () => {
    const { threadText } = await import("../src/enquiries");
    const text = threadText({ enquiry: { id: 7, name: "Jordan", email: "j@example.com", state: "do-not-contact", created_at: "2026-10-09T23:30:00Z", details: "Hi" }, messages: [] });
    expect(text).toContain("10 Oct 2026, 00:30"); // 23:30 UTC on the 9th is the 10th in London
    expect(text).toContain("THEY ASKED NOT TO BE CONTACTED");
  });
});

describe("Agent's enquiry tools", () => {
  it("are list, read, draft, sort and saved replies only: no tool sends or approves", async () => {
    const { enquiryTools } = await import("../src/chat");
    const names = enquiryTools([]).map((t: any) => t.name);
    expect(names).toEqual(["enquiry_list", "enquiry_read", "enquiry_draft_reply", "enquiry_set_state", "saved_replies_list"]);
    expect(names.filter((n: string) => /send|approve/.test(n))).toEqual([]);
  });

  it("drafting adds a draft card under the reply and tells Claude it isn't sent", async () => {
    const { enquiryTools } = await import("../src/chat");
    const actions: any[] = [];
    const tool: any = enquiryTools(actions).find((t: any) => t.name === "enquiry_draft_reply");
    const said = await tool.run({ id: 7, body: "Hi Jordan, Friday works." });
    expect(said).toContain("NOT been sent");
    expect(actions).toEqual([
      { kind: "draft", text: "Drafted a reply to Jordan Test, waiting for approval", draft: expect.objectContaining({ id: 31, enquiryId: 7, body: "Hi Jordan, Friday works." }) },
    ]);
    // It only ever reached the drafts address
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/nova-agent/enquiries/7/drafts"]);
  });

  it("sorting moves an enquiry (spam too) and says nothing was sent; only the state and label go to Nova Bot", async () => {
    const { enquiryTools } = await import("../src/chat");
    const actions: any[] = [];
    const tool: any = enquiryTools(actions).find((t: any) => t.name === "enquiry_set_state");
    expect(await tool.run({ id: 7, state: "waiting", label: "Mixing" })).toBe('Enquiry #7 is now waiting on them, labelled "Mixing". Nothing was sent.');
    expect(await tool.run({ id: 7, state: "spam" })).toBe("Enquiry #7 is now spam. Nothing was sent.");
    expect(seen.map((s) => [new URL(s.url).pathname, s.body])).toEqual([
      ["/nova-agent/inbox/sort", { id: 7, state: "waiting", label: "Mixing" }],
      ["/nova-agent/inbox/sort", { id: 7, state: "spam" }],
    ]);
    expect(actions.map((a) => a.text)).toEqual(["Moved enquiry #7 to waiting", "Moved enquiry #7 to spam"]);
  });

  it("reads the saved replies", async () => {
    const { enquiryTools } = await import("../src/chat");
    const tool: any = enquiryTools([]).find((t: any) => t.name === "saved_replies_list");
    expect(JSON.parse(await tool.run({}))).toEqual([{ id: 1, title: "Prices", body: "£40 an hour" }]);
  });
});
