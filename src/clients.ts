// The studio's client list, for Agent (read-only).
//
// The list lives on Nova Bot's worker (its clients table: everyone who booked through Acuity, sent
// an enquiry, was imported from Acuity's spreadsheets or added by hand in Portal → Clients). Agent
// reads it with Nova Agent's key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/clients/find     { search }  -> clients matching a name, email or phone (max 20)
//   POST /nova-agent/clients/history  { id }      -> one client and their sessions
//   POST /nova-agent/clients/owing    {}          -> clients who owe money (biggest first)
//   POST /nova-agent/clients/lapsed   { since }   -> clients who haven't booked since that UK date
//
// That's all the key can do: nothing here changes a client. Staff edit clients (contact details,
// notes, money, marketing consent) in Portal → Clients with their own sign-in.
// Money comes as pounds in strings ("120.00"); times as UTC ISO, shown here in UK time.
// Client details are only ever passed to Claude, never written to the trace (ids and counts only).

import { config } from "./config";

export interface ClientSummary {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  consent: { yes: boolean; at: string | null; source: string | null };
  lastBooked: string | null;
  nextBooked: string | null;
  sessionCount: number;
  outstanding: string;
  depositsPaid: string;
  invoiced: string;
  notes: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface ClientSession {
  id: number;
  acuityId: number | null;
  session: string | null;
  start: string;
  end: string | null;
  price: string | null;
  status: "booked" | "cancelled";
  source: string | null;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see the client list.");
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
  } catch {
    // An empty or broken answer: the status says what happened
  }
  if (!response.ok) throw new Error(data.error || `Nova Bot said no (${response.status}).`);
  return data as T;
}

export async function findClients(search: string): Promise<ClientSummary[]> {
  return (await call<{ clients: ClientSummary[] }>("/nova-agent/clients/find", { search })).clients ?? [];
}
export async function clientHistory(id: number): Promise<{ client: ClientSummary; sessions: ClientSession[] }> {
  const r = await call<{ client: ClientSummary; sessions?: ClientSession[] }>("/nova-agent/clients/history", { id });
  return { client: r.client, sessions: r.sessions ?? [] };
}
export async function clientsOwing(): Promise<ClientSummary[]> {
  return (await call<{ clients: ClientSummary[] }>("/nova-agent/clients/owing", {})).clients ?? [];
}
// Who hasn't booked since a UK date (YYYY-MM-DD)
export async function clientsLapsed(since: string): Promise<ClientSummary[]> {
  return (await call<{ clients: ClientSummary[] }>("/nova-agent/clients/lapsed", { since })).clients ?? [];
}

// ===== Words for Claude =====

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const MONTH_NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1)) as [string, ...string[]];

// Today's date in the UK, YYYY-MM-DD
export function ukToday(now = new Date()): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// The day "since …" means: a date as given, the 1st of the most recent of that month ("since
// July" in October 2026 is 2026-07-01; in July 2026 it's also 2026-07-01, the start of this month;
// in March 2027 it's 2026-07-01 again), or so many months back from today (same day of the month,
// or the month's last day when it's shorter).
export function sinceDate(i: { since?: string; month?: string; months_back?: number }, today = ukToday()): string | null {
  if (i.since && /^\d{4}-\d{2}-\d{2}$/.test(i.since)) return i.since;
  const [y, m, d] = today.split("-").map(Number);
  if (i.month) {
    const want = MONTHS.indexOf(i.month.trim().toLowerCase()) + 1;
    if (want < 1) return null;
    const year = want <= m ? y : y - 1;
    return `${year}-${String(want).padStart(2, "0")}-01`;
  }
  if (i.months_back !== undefined && Number.isFinite(i.months_back) && i.months_back >= 0) {
    const total = y * 12 + (m - 1) - Math.round(i.months_back);
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }
  return null;
}

// "Sat 1 Aug 2026, 14:00" in UK time (with the year: a client's history goes back years)
const noWeekdayComma = (text: string) => text.replace(/^(\p{L}+),/u, "$1");
export const ukDateTime = (iso: string) =>
  noWeekdayComma(new Date(iso).toLocaleString("en-GB", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }));
// "Wednesday 1 July 2026" (a UK date, YYYY-MM-DD)
export const ukLongDate = (ymd: string) => noWeekdayComma(new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));

// Pounds: "120.00" → "£120.00" (anything that isn't money as it came)
export const pounds = (v: string | number | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? `£${n.toFixed(2)}` : `£${v ?? "0.00"}`;
};
const owes = (c: ClientSummary) => Number(c.outstanding) > 0;

// One client in a line
export function clientLine(c: ClientSummary): string {
  return [
    `#${c.id}`,
    c.name,
    c.email || "",
    c.phone || "",
    c.lastBooked ? `last booked ${ukDateTime(c.lastBooked)}` : "never booked",
    c.nextBooked ? `next booked ${ukDateTime(c.nextBooked)}` : "",
    `${c.sessionCount} session${c.sessionCount === 1 ? "" : "s"}`,
    owes(c) ? `owes ${pounds(c.outstanding)}` : "",
    Number(c.depositsPaid) > 0 ? `deposits paid ${pounds(c.depositsPaid)}` : "",
    Number(c.invoiced) > 0 ? `invoiced ${pounds(c.invoiced)}` : "",
    c.consent?.yes ? `marketing: yes (${c.consent.source || "source not recorded"}${c.consent.at ? `, ${ukDateTime(c.consent.at).replace(/, \d\d:\d\d$/, "")}` : ""})` : "marketing: no",
    c.source === "enquiry" && !c.sessionCount ? "from an enquiry" : "",
    c.notes ? `notes: ${c.notes.slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function clientsText(list: ClientSummary[]): string {
  return list.map(clientLine).join("\n");
}

// Who owes money, biggest first, with the total
export function owingText(list: ClientSummary[]): string {
  const owing = list.filter(owes).sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  if (!owing.length) return "Nobody owes the studio anything (no outstanding amounts recorded).";
  const total = owing.reduce((n, c) => n + Math.round(Number(c.outstanding) * 100), 0) / 100;
  return [`${owing.length} client${owing.length === 1 ? " owes" : "s owe"} ${pounds(total)} in all (amounts as recorded in Nova Portal → Clients):`, ...owing.map((c) => `${c.name} (#${c.id}) owes ${pounds(c.outstanding)}${c.lastBooked ? ` · last booked ${ukDateTime(c.lastBooked)}` : ""}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`)].join("\n");
}

// Who hasn't booked since a day, longest-lapsed first
export function lapsedText(list: ClientSummary[], since: string): string {
  if (!list.length) return `Everyone who has booked before has booked again since ${ukLongDate(since)}.`;
  const sorted = [...list].sort((a, b) => String(a.lastBooked ?? "").localeCompare(String(b.lastBooked ?? "")));
  return [
    `${sorted.length} client${sorted.length === 1 ? " hasn't" : "s haven't"} booked since ${ukLongDate(since)} (last session before then, nothing booked on or after it):`,
    ...sorted.map((c) => `${c.name} (#${c.id}) · last booked ${c.lastBooked ? ukDateTime(c.lastBooked) : "unknown"} · ${c.sessionCount} session${c.sessionCount === 1 ? "" : "s"}${c.consent?.yes ? " · marketing: yes" : " · marketing: no"}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`),
  ].join("\n");
}

// One client and their sessions, newest first
export function historyText(h: { client: ClientSummary; sessions: ClientSession[] }): string {
  const sessions = [...h.sessions].sort((a, b) => b.start.localeCompare(a.start));
  const lines = [clientLine(h.client)];
  if (!sessions.length) lines.push("No sessions on record.");
  else {
    lines.push(`Sessions (${sessions.length}, newest first, UK time):`);
    for (const s of sessions)
      lines.push(
        [ukDateTime(s.start), s.session || "Session", s.price ? (Number.isFinite(Number(s.price)) ? (Number(s.price) > 0 ? pounds(s.price) : "") : s.price) : "", s.status === "cancelled" ? "CANCELLED" : "", s.acuityId ? `Acuity #${s.acuityId}` : ""].filter(Boolean).join(" · "),
      );
  }
  return lines.join("\n");
}
