// Money (invoices, payments and expenses, kept by Nova Bot: Portal → Money), for Agent.
//
// Agent reads the money and writes on Nova Bot with Nova Agent's key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/money/context            {}  -> this month and tax year, owed, overdue, VAT, terms, the last 10 invoices
//   POST /nova-agent/money/invoices           { status? } -> the invoices
//   POST /nova-agent/money/invoices/:id       {}  -> one invoice and its payments
//   POST /nova-agent/money/invoices/draft     { clientId?, billName, billEmail, lines, … } -> a new invoice, waiting for approval
//   POST /nova-agent/money/invoices/:id/edit  { … } -> back to waiting for approval
//   POST /nova-agent/money/expenses           { spentOn, amount, category, supplier, note } -> an UNCONFIRMED expense
//
// That's all the key can do. There's deliberately no approve, send, remind, void, record-payment
// or settings call: an invoice is emailed to a client only when a signed-in admin presses Approve
// in Portal → Money; payments are recorded by people in Portal (or come from Stripe); and an
// expense the AI logs counts in no total until someone in the team confirms it.
// The trace only gets ids and counts, never names, amounts or anyone's details.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "./config";
import { trace } from "./trace";

export const INVOICE_STATUSES = ["draft", "pending_approval", "approved", "rejected", "failed", "sent", "part_paid", "paid", "void"] as const;
export const EXPENSE_CATEGORIES = [
  "Equipment",
  "Software and subscriptions",
  "Studio rent and bills",
  "Marketing and ads",
  "Musicians and freelancers",
  "Travel",
  "Repairs and upkeep",
  "Food and hospitality",
  "Bank and payment fees",
  "Other",
] as const;

export interface InvoiceLine {
  description: string;
  qty: number;
  unitPence: number;
  totalPence: number;
}
export interface Invoice {
  id: number;
  number: string;
  clientId: number | null;
  billTo: { name: string; email: string | null; address: string };
  lines: InvoiceLine[];
  vatRate: number;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  paidPence: number;
  balancePence: number;
  issueDate: string;
  dueDate: string;
  notes: string;
  status: (typeof INVOICE_STATUSES)[number];
  overdue: boolean;
  createdBy: string;
  createdAt: string;
  sentAt: string | null;
  paidAt: string | null;
  note: string | null;
  error: string | null;
  portalUrl: string;
}
interface Period {
  from: string;
  to: string;
  inPence: number;
  outPence: number;
}
export interface MoneyContext {
  summary: {
    today: string;
    month: Period;
    taxYear: Period & { name: string; outByCategory: { category: string; pence: number }[] };
    owed: { count: number; pence: number };
    overdue: { count: number; pence: number };
    invoicesWaiting: number;
    remindersWaiting: number;
    unconfirmedExpenses: number;
  };
  vatRate: number;
  dueDays: number;
  recentInvoices: { id: number; number: string; to: string; totalPence: number; balancePence: number; status: string; overdue: boolean; dueDate: string }[];
  today: string;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see the money.");
  let response: Response;
  try {
    response = await fetch(`${config.workerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Couldn't reach Nova Bot: ${(error as Error).message}`);
  }
  let data: any = {};
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) throw new Error(data.error || `Nova Bot said no (${response.status}).`);
  return data as T;
}

export const moneyContext = () => call<MoneyContext>("/nova-agent/money/context");
export const listInvoices = async (status?: string) => (await call<{ invoices: Invoice[] }>("/nova-agent/money/invoices", status ? { status } : {})).invoices ?? [];
export const readInvoice = (id: number) => call<{ invoice: Invoice; payments: any[] }>(`/nova-agent/money/invoices/${id}`);
export const draftInvoice = async (fields: Record<string, unknown>) => (await call<{ invoice: Invoice }>("/nova-agent/money/invoices/draft", fields)).invoice;
export const editInvoice = async (id: number, fields: Record<string, unknown>) => (await call<{ invoice: Invoice }>(`/nova-agent/money/invoices/${id}/edit`, fields)).invoice;
export const logExpense = async (fields: Record<string, unknown>) => (await call<{ expense: { id: number; status: string } }>("/nova-agent/money/expenses", fields)).expense;

// ===== Words =====

// "£1,234.50"
export function money(pence: number): string {
  const p = Math.round(Number(pence) || 0);
  const abs = Math.abs(p);
  return `${p < 0 ? "-" : ""}£${Math.floor(abs / 100).toLocaleString("en-GB")}.${String(abs % 100).padStart(2, "0")}`;
}
const day = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : ymd || "");
const STATUS_WORDS: Record<string, string> = {
  draft: "draft",
  pending_approval: "waiting for an admin's approval",
  approved: "approved, sending",
  rejected: "rejected",
  failed: "didn't send",
  sent: "sent, unpaid",
  part_paid: "part paid",
  paid: "paid",
  void: "voided",
};

export function invoiceLine(i: Invoice): string {
  const state = i.overdue ? `OVERDUE (was due ${day(i.dueDate)})` : STATUS_WORDS[i.status] || i.status;
  const left = ["sent", "part_paid"].includes(i.status) ? `, ${money(i.balancePence)} left to pay` : "";
  return `#${i.id} ${i.number} · ${i.billTo.name} · ${money(i.totalPence)}${left} · ${state} · due ${day(i.dueDate)}`;
}

export function summaryText(c: MoneyContext): string {
  const s = c.summary;
  const cats = s.taxYear.outByCategory.slice(0, 5).map((x) => `${x.category} ${money(x.pence)}`).join(", ");
  return [
    `Today is ${c.today} (UK).`,
    `This month (${day(s.month.from)} to ${day(s.month.to)}): ${money(s.month.inPence)} in from paid invoices, ${money(s.month.outPence)} out in confirmed expenses.`,
    `Tax year ${s.taxYear.name} (${day(s.taxYear.from)} to ${day(s.taxYear.to)}): ${money(s.taxYear.inPence)} in, ${money(s.taxYear.outPence)} out${cats ? ` (biggest: ${cats})` : ""}.`,
    `Owed to the studio: ${money(s.owed.pence)} on ${s.owed.count} invoice${s.owed.count === 1 ? "" : "s"}; overdue: ${money(s.overdue.pence)} on ${s.overdue.count}.`,
    `Waiting for an admin in Portal → Money: ${s.invoicesWaiting} invoice${s.invoicesWaiting === 1 ? "" : "s"} and ${s.remindersWaiting} reminder${s.remindersWaiting === 1 ? "" : "s"}. Unconfirmed expenses: ${s.unconfirmedExpenses}.`,
    `Invoices default to ${c.vatRate}% VAT and payment within ${c.dueDays} days.`,
    c.recentInvoices.length ? "Latest invoices:\n" + c.recentInvoices.map((i) => `#${i.id} ${i.number} · ${i.to} · ${money(i.totalPence)} · ${i.overdue ? "OVERDUE" : STATUS_WORDS[i.status] || i.status}`).join("\n") : "No invoices yet.",
  ].join("\n");
}

// ===== Agent's tools =====

// (the same kinds as chat.ts's ChatAction: a line under Agent's reply)
type Action = { kind: "added" | "changed" | "looked"; text: string };

// Read the money, write and edit invoices (they wait for an admin), log expenses as unconfirmed.
// There's no tool that approves, emails, reminds, voids, records a payment or changes settings.
export function moneyTools(actions: { push(action: Action): number }) {
  const did = (kind: Action["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${text}`);
  };
  const failed = (error: unknown) => `Couldn't reach the studio's money just now: ${(error as Error).message}`;
  const notSent = "Nothing has been emailed: it goes to the client only when an admin approves it in Portal → Money. Tell them that plainly.";
  const LINES = z
    .array(
      z.object({
        description: z.string().min(1).max(300).describe("What it's for, e.g. \"Mixing, per song\""),
        qty: z.number().positive().max(10000).describe("How many (hours, songs, sessions); up to two decimal places"),
        unit: z.string().min(1).max(20).describe('The price of one in pounds, like "150" or "49.99"'),
      })
    )
    .min(1)
    .max(30);
  const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  return [
    betaZodTool({
      name: "money_summary",
      description:
        "The studio's money at a glance: in (paid invoices) and out (confirmed expenses) this month and this UK tax year, what clients owe and what's overdue, what's waiting for an admin, the default VAT and payment terms, and the latest invoices. Read-only.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const c = await moneyContext();
          did("looked", "Looked at the studio's money");
          return summaryText(c);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "list_invoices",
      description: "The studio's invoices, newest first (number, who to, total, what's left to pay, status, due date). Filter by status, or \"open\" (sent, not fully paid) or \"overdue\". Read-only.",
      inputSchema: z.object({ status: z.enum([...INVOICE_STATUSES, "open", "overdue", "waiting"]).optional() }),
      run: async ({ status }) => {
        try {
          const list = await listInvoices(status);
          did("looked", `Looked at ${list.length} invoice${list.length === 1 ? "" : "s"}`);
          return list.length ? list.map(invoiceLine).join("\n") : "No invoices like that.";
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "draft_invoice",
      description:
        "Write an invoice to a client. It is NOT sent: it's saved waiting for an admin, who checks it and presses Approve in Portal → Money; only then is it emailed to the client with a link to see, print and pay it. Use client_find first to get the client's id (their name and email are then filled in), or give billName and billEmail. Prices are in pounds.",
      inputSchema: z.object({
        client_id: z.number().int().positive().optional().describe("The client's id from client_find (fills in their name and email)"),
        bill_name: z.string().max(120).optional().describe("Who it's to (needed without client_id)"),
        bill_email: z.string().max(200).optional().describe("Where it's emailed (needed to send it)"),
        bill_address: z.string().max(400).optional(),
        lines: LINES,
        vat_rate: z.number().min(0).max(100).optional().describe("VAT percent (leave out for the studio's default)"),
        issue_date: DAY.optional().describe("YYYY-MM-DD (leave out for today)"),
        due_date: DAY.optional().describe("YYYY-MM-DD (leave out for the studio's usual terms)"),
        notes: z.string().max(2000).optional().describe("A line for the client on the invoice, e.g. what the sessions were"),
      }),
      run: async (i) => {
        try {
          const invoice = await draftInvoice({
            clientId: i.client_id,
            billName: i.bill_name,
            billEmail: i.bill_email,
            billAddress: i.bill_address,
            lines: i.lines,
            vatRate: i.vat_rate,
            issueDate: i.issue_date,
            dueDate: i.due_date,
            notes: i.notes,
          });
          did("added", `Wrote invoice ${invoice.number}, waiting for an admin's approval`);
          return `Invoice ${invoice.number} (#${invoice.id}) saved, NOT sent: ${invoiceLine(invoice)}.${invoice.billTo.email ? "" : " It has no email address yet, so it can't be sent until one is added."} ${notSent}`;
        } catch (error) {
          return `Couldn't save the invoice: ${(error as Error).message} Nothing was saved or sent.`;
        }
      },
    }),
    betaZodTool({
      name: "edit_invoice_draft",
      description: "Change an invoice that hasn't been sent (who it's to, the lines, VAT, dates, notes). It goes back to waiting for an admin's approval and is NOT sent. Sent invoices can't change: an admin voids one and a new one is written.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The invoice's id (#id from list_invoices)"),
        client_id: z.number().int().positive().optional(),
        bill_name: z.string().max(120).optional(),
        bill_email: z.string().max(200).optional(),
        bill_address: z.string().max(400).optional(),
        lines: LINES.optional().describe("All the lines, as they should be (replaces them)"),
        vat_rate: z.number().min(0).max(100).optional(),
        issue_date: DAY.optional(),
        due_date: DAY.optional(),
        notes: z.string().max(2000).optional(),
      }),
      run: async ({ id, ...i }) => {
        const changes: Record<string, unknown> = {};
        const map: Record<string, string> = { client_id: "clientId", bill_name: "billName", bill_email: "billEmail", bill_address: "billAddress", lines: "lines", vat_rate: "vatRate", issue_date: "issueDate", due_date: "dueDate", notes: "notes" };
        for (const [k, v] of Object.entries(i)) if (v !== undefined) changes[map[k]] = v;
        if (!Object.keys(changes).length) return "Say what to change.";
        try {
          const invoice = await editInvoice(id, changes);
          did("changed", `Changed invoice ${invoice.number}, waiting for an admin's approval`);
          return `Invoice ${invoice.number} changed and waiting for approval again: ${invoiceLine(invoice)}. ${notSent}`;
        } catch (error) {
          return `Couldn't change invoice #${id}: ${(error as Error).message} Nothing was changed or sent.`;
        }
      },
    }),
    betaZodTool({
      name: "log_expense",
      description:
        "Note a studio expense (something bought or paid for). It's saved UNCONFIRMED: it counts in no total until someone in the team checks it and presses Confirm in Portal → Money (they can add the receipt there). Say so.",
      inputSchema: z.object({
        amount: z.string().min(1).max(20).describe('How much in pounds, like "49.99"'),
        category: z.enum(EXPENSE_CATEGORIES),
        supplier: z.string().max(120).optional().describe("Who it was paid to"),
        spent_on: DAY.optional().describe("YYYY-MM-DD (leave out for today)"),
        note: z.string().max(500).optional(),
      }),
      run: async (i) => {
        try {
          const e = await logExpense({ amount: i.amount, category: i.category, supplier: i.supplier, spentOn: i.spent_on, note: i.note });
          did("added", `Noted an expense (unconfirmed)`);
          return `Expense #${e.id} noted as UNCONFIRMED: it doesn't count in any total until someone confirms it in Portal → Money.`;
        } catch (error) {
          return `Couldn't note the expense: ${(error as Error).message} Nothing was saved.`;
        }
      },
    }),
  ];
}

export const MONEY_PROMPT = `- Money (invoices, payments and expenses, in Portal → Money): money_summary (in and out this month and this UK tax year, what's owed and overdue, what's waiting), list_invoices, draft_invoice, edit_invoice_draft, log_expense. You can only write and change invoices that haven't gone, and note expenses: you can't send, approve or remind about an invoice, record or remove a payment, void anything or change the bank details, and nobody can through you. An invoice is emailed to the client only when an admin presses Approve in Portal → Money: say that plainly every time ("It's saved: nothing goes to the client until an admin approves it in Portal → Money"), and never say an invoice was sent or paid unless list_invoices shows it. Expenses you note are unconfirmed until someone in the team confirms them. Find the client first with client_find (their id fills in the name and email). Prices are in pounds; say amounts as £120.00 and dates as UK dates.`;
