// Money: Agent's tools (src/money.ts, moneyTools in src/chat.ts) and receipts on the PC
// (src/receipts.ts). Agent can read the money, write and edit invoices and note expenses; it can
// never approve, send, remind, void, record a payment or change settings (an admin does those in
// Portal → Money). Nova Bot is pretend throughout.  Run: npm test
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 3,
  number: "NS-0003",
  clientId: 7,
  billTo: { name: "Ada Client", email: "ada@example.com", address: "" },
  lines: [{ description: "Mixing", qty: 2, unitPence: 15000, totalPence: 30000 }],
  vatRate: 0,
  subtotalPence: 30000,
  vatPence: 0,
  totalPence: 30000,
  paidPence: 0,
  balancePence: 30000,
  issueDate: "2026-10-12",
  dueDate: "2026-10-26",
  notes: "",
  status: "pending_approval",
  overdue: false,
  createdBy: "agent",
  createdAt: "2026-10-12T09:00:00.000Z",
  sentAt: null,
  paidAt: null,
  note: null,
  error: null,
  portalUrl: "https://worker.test/portal/?view=money&invoice=3",
  ...over,
});

describe("Agent's money tools", () => {
  let seen: { path: string; body: any; headers: Record<string, string> }[] = [];

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-money-"));
    vi.resetModules();
    seen = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, body, headers: (init.headers || {}) as Record<string, string> });
      if (path === "/nova-agent/money/context")
        return Response.json({
          summary: {
            today: "2026-10-12",
            month: { from: "2026-10-01", to: "2026-10-31", inPence: 120000, outPence: 4999 },
            taxYear: { from: "2026-04-06", to: "2027-04-05", name: "2026–27", inPence: 980000, outPence: 50000, outByCategory: [{ category: "Equipment", pence: 50000 }] },
            owed: { count: 2, pence: 60000 },
            overdue: { count: 1, pence: 30000 },
            invoicesWaiting: 1,
            remindersWaiting: 0,
            unconfirmedExpenses: 1,
          },
          vatRate: 0,
          dueDays: 14,
          recentInvoices: [{ id: 3, number: "NS-0003", to: "Ada Client", totalPence: 30000, balancePence: 30000, status: "sent", overdue: true, dueDate: "2026-10-05" }],
          today: "2026-10-12",
        });
      if (path === "/nova-agent/money/invoices/draft") return Response.json({ invoice: invoice() });
      if (path === "/nova-agent/money/invoices/3/edit") return Response.json({ invoice: invoice({ notes: body.notes }) });
      if (path === "/nova-agent/money/invoices") return Response.json({ invoices: [invoice({ status: "sent", overdue: true, dueDate: "2026-10-05" })] });
      if (path === "/nova-agent/money/expenses") return Response.json({ expense: { id: 5, status: "unconfirmed" } });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tool = async (name: string, actions: any[] = []) => {
    const { moneyTools } = await import("../src/money");
    return moneyTools(actions).find((t: any) => t.name === name) as any;
  };

  it("are summary, list, draft, edit and note an expense: nothing that approves, sends, reminds, voids or pays", async () => {
    const { moneyTools } = await import("../src/money");
    const names = moneyTools([]).map((t: any) => t.name);
    expect(names).toEqual(["money_summary", "list_invoices", "draft_invoice", "edit_invoice_draft", "log_expense"]);
    expect(names.filter((n: string) => /approve|send|remind|void|pay|refund|settings|bank/.test(n))).toEqual([]);
    const api = await import("../src/money");
    expect(Object.keys(api).filter((k) => /approve|send|remind|void|record|payment|settings/i.test(k))).toEqual([]);
    for (const t of moneyTools([]).filter((t: any) => /invoice/.test(t.name) && t.name !== "list_invoices") as any[]) expect(t.description).toMatch(/admin/);
  });

  it("money_summary reads with Nova Agent's key and says it in pounds", async () => {
    const said = await (await tool("money_summary")).run({});
    expect(seen).toEqual([{ path: "/nova-agent/money/context", body: {}, headers: expect.objectContaining({ Authorization: "Bearer test-key" }) }]);
    expect(said).toContain("£1,200.00 in");
    expect(said).toContain("overdue: £300.00 on 1");
    expect(said).toContain("Tax year 2026–27");
  });

  it("draft_invoice posts the fields only and says plainly nothing is sent", async () => {
    const actions: any[] = [];
    const said = await (await tool("draft_invoice", actions)).run({ client_id: 7, lines: [{ description: "Mixing", qty: 2, unit: "150" }], notes: "Thanks" });
    expect(seen[0].path).toBe("/nova-agent/money/invoices/draft");
    expect(seen[0].body).toEqual({ clientId: 7, lines: [{ description: "Mixing", qty: 2, unit: "150" }], notes: "Thanks" });
    expect(said).toContain("NOT sent");
    expect(said).toMatch(/only when an admin approves it in Portal → Money/);
    expect(actions).toEqual([{ kind: "added", text: expect.stringContaining("waiting for an admin") }]);
  });

  it("edit_invoice_draft posts only the changes; list_invoices says what's overdue", async () => {
    const said = await (await tool("edit_invoice_draft")).run({ id: 3, notes: "EP sessions" });
    expect(seen[0]).toMatchObject({ path: "/nova-agent/money/invoices/3/edit", body: { notes: "EP sessions" } });
    expect(said).toMatch(/waiting for approval again/);
    const list = await (await tool("list_invoices")).run({ status: "overdue" });
    expect(seen[1]).toMatchObject({ path: "/nova-agent/money/invoices", body: { status: "overdue" } });
    expect(list).toContain("OVERDUE");
    expect(list).toContain("£300.00 left to pay");
  });

  it("log_expense notes it as unconfirmed", async () => {
    const said = await (await tool("log_expense")).run({ amount: "49.99", category: "Equipment", supplier: "Thomann" });
    expect(seen[0]).toMatchObject({ path: "/nova-agent/money/expenses", body: { amount: "49.99", category: "Equipment", supplier: "Thomann" } });
    expect(said).toMatch(/UNCONFIRMED/);
  });
});

describe("Receipts on the PC", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const PDF = new TextEncoder().encode("%PDF-1.7\n...");

  it("saves a photo or a PDF under a name it makes up, reads it back, and refuses anything else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nova-receipts-")) + "/";
    const { diskStore, RECEIPT_ID } = await import("../src/receipts");
    const store = diskStore(dir);
    const a = store.save(PNG, "image/png");
    expect(a.id).toMatch(RECEIPT_ID);
    expect(store.read(a.id)).toEqual({ bytes: Buffer.from(PNG), type: "image/png" });
    expect(store.save(PDF, "application/pdf").type).toBe("application/pdf");
    expect(() => store.save(PDF, "image/png")).toThrow(/isn't the kind/);
    expect(() => store.save(PNG, "text/html")).toThrow(/photo/);
    expect(() => store.save(new Uint8Array(), "image/png")).toThrow(/empty/);
    // Names that aren't its own find nothing
    for (const id of ["../secret", "r-20261012-../../x", a.id + "/..", "index"]) expect(store.read(id)).toBeNull();
    expect(store.remove(a.id)).toBe(true);
    expect(store.read(a.id)).toBeNull();
  });

  it("are reachable online for signed-in staff only, through the relay's list", async () => {
    const { relayAllowed } = await import("../src/relay");
    expect(relayAllowed("POST", "/actions/receipts", { id: "sam", role: "staff" })).toBe(true);
    expect(relayAllowed("GET", "/receipts/r-20261012-0123456789", { id: "sam", role: "staff" })).toBe(true);
    expect(relayAllowed("GET", "/receipts/r-20261012-0123456789", null)).toBe(false);
    expect(relayAllowed("GET", "/receipts/../data/staff.json", { id: "sam", role: "staff" })).toBe(false);
    expect(relayAllowed("DELETE", "/receipts/r-20261012-0123456789", { id: "sam", role: "admin" })).toBe(false);
  });
});
