// The studio's Acuity bookings through Acuity's API, for Agent and the quest planner.
//
// Nova Agent never holds Acuity's API key: Nova Bot's worker does, and Nova Agent asks it with
// Nova Agent's own key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/acuity/appointments   { from, to }        -> the bookings (UK dates, inclusive)
//   POST /nova-agent/acuity/availability   { typeId, date }    -> free start times that day
//   POST /nova-agent/acuity/blocks         { from, to }        -> Acuity's blocked-off times
//   POST /nova-agent/acuity/types          {}                  -> the session types
//   POST /nova-agent/acuity/clients        { search }          -> clients matching a name/email
//   POST /nova-agent/booking-actions/propose { kind, payload, reason } -> a PROPOSED change
//   POST /nova-agent/booking-actions       { status }          -> the proposals and what became of them
//   POST /nova-agent/bookings-feed         { from, to }        -> the bookings in Acuity's private
//        calendar feed (ACUITY_SOURCE=feed: for Acuity plans without the API; read-only, and
//        cancelled bookings aren't in it)
//
// That's all the key can do. There is deliberately no approve, edit or run here: a proposed
// change only happens when a signed-in admin presses Approve in Portal → Approvals (or on the
// proposal's card under Agent's reply), with their own Portal sign-in, never this key. Nova Bot
// enforces the same thing on its side. Times come back as UTC ISO.

import { config } from "./config";

export interface Appointment {
  id: number;
  start: string; // UTC ISO
  end: string;
  type: string;
  typeId: number;
  name: string;
  email: string;
  phone: string;
  price: string;
  paid: string;
  amountPaid: string;
  notes: string;
  canceled: boolean;
  calendar: string;
  calendarId: number;
}
export interface AcuityBlock {
  id: number;
  start: string;
  end: string;
  notes: string;
  calendar: string;
  calendarId: number;
}
export interface SessionType {
  id: number;
  name: string;
  price: string;
  duration: number;
  active: boolean;
  private: boolean;
}
export interface Client {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
}

export const BOOKING_KINDS = ["create", "reschedule", "cancel", "update", "block_add", "block_remove"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

// A proposed change, as Nova Bot keeps it (the summary is Nova Bot's own words, never ours)
export interface BookingAction {
  id: number;
  kind: BookingKind;
  status: "pending" | "approved" | "executed" | "failed" | "rejected";
  summary: string;
  payload: Record<string, unknown>;
  reason: string;
  proposedBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  result: unknown;
  error: string | null;
  portalUrl: string;
}

// Acuity couldn't be reached (or is busy): the worker says so, and so do we
export class AcuityUnreachable extends Error {}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't reach Acuity.");
  let response: Response;
  try {
    response = await fetch(`${config.workerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new AcuityUnreachable(`Couldn't reach Nova Bot: ${(error as Error).message}`);
  }
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // An empty or broken answer: the status says what happened
  }
  if (!response.ok) {
    const message = data.error || `Nova Bot said no (${response.status}).`;
    if (data.unreachable || data.rateLimited || response.status >= 500 || response.status === 429) throw new AcuityUnreachable(message);
    throw new Error(message);
  }
  return data as T;
}

// The bookings between two UK dates (inclusive; up to 62 days), cancelled ones too (marked)
export async function listAppointments(from: string, to: string): Promise<Appointment[]> {
  return (await call<{ appointments: Appointment[] }>("/nova-agent/acuity/appointments", { from, to })).appointments ?? [];
}

// A booking from Acuity's calendar feed: only what the feed has (times in UTC ISO)
export interface FeedBooking {
  id: number;
  start: string;
  end: string;
  type: string;
  name: string;
}

// The bookings in Acuity's calendar feed between two UK dates (inclusive; up to 62 days). The feed
// has no cancelled bookings, no blocked times and no prices: just who, what and when.
export async function listFeedBookings(from: string, to: string): Promise<FeedBooking[]> {
  return (await call<{ appointments: FeedBooking[] }>("/nova-agent/bookings-feed", { from, to })).appointments ?? [];
}

// The feed's bookings as text for Claude (UK times)
export function feedBookingsText(list: FeedBooking[]): string {
  if (!list.length) return "No bookings in that range.";
  return [...list]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => [`#${a.id}`, `${ukWhen(a.start)}${a.end ? `–${ukTime(a.end)}` : ""}`, a.type, a.name].filter(Boolean).join(" · "))
    .join("\n");
}

// Free start times for one session type on one UK date
export async function availability(typeId: number, date: string): Promise<{ start: string; label: string }[]> {
  return (await call<{ times: { start: string; label: string }[] }>("/nova-agent/acuity/availability", { typeId, date })).times ?? [];
}

// Times blocked off in Acuity between two UK dates
export async function listBlocks(from: string, to: string): Promise<AcuityBlock[]> {
  return (await call<{ blocks: AcuityBlock[] }>("/nova-agent/acuity/blocks", { from, to })).blocks ?? [];
}

export async function sessionTypes(): Promise<SessionType[]> {
  return (await call<{ types: SessionType[] }>("/nova-agent/acuity/types", {})).types ?? [];
}

export async function findClients(search: string): Promise<Client[]> {
  return (await call<{ clients: Client[] }>("/nova-agent/acuity/clients", { search })).clients ?? [];
}

// PROPOSE a change. It waits on Nova Bot (status "pending") until an admin decides in Portal.
// Only the kind, the details and why are sent: never a status, never "approved".
export async function proposeChange(kind: BookingKind, payload: Record<string, unknown>, reason: string): Promise<BookingAction> {
  return (await call<{ action: BookingAction }>("/nova-agent/booking-actions/propose", { kind, payload, reason })).action;
}

// The proposals (read-only): the ones waiting, or all of them with what became of each
export async function listActions(status: "pending" | "all" = "pending"): Promise<BookingAction[]> {
  return (await call<{ actions: BookingAction[] }>("/nova-agent/booking-actions", { status })).actions ?? [];
}

// "Sat 31 Oct, 17:00" in UK time
export const ukWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

// The bookings as text for Claude (UK times)
export function appointmentsText(list: Appointment[]): string {
  if (!list.length) return "No bookings in that range.";
  return [...list]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) =>
      [
        `#${a.id}`,
        `${ukWhen(a.start)}–${ukTime(a.end)}`,
        a.type,
        a.name,
        a.email,
        a.phone,
        a.price ? `£${a.price}${a.paid === "yes" ? " (paid)" : a.amountPaid && a.amountPaid !== "0.00" ? ` (£${a.amountPaid} paid)` : " (not paid)"}` : "",
        a.calendar ? `calendar: ${a.calendar}` : "",
        a.notes ? `notes: ${a.notes.slice(0, 300)}` : "",
        a.canceled ? "CANCELLED" : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("\n");
}

// A proposal in a line (for Claude and the trace: ids and statuses, no client details beyond the summary)
export const actionLine = (a: BookingAction) =>
  `#${a.id} · ${a.status} · ${a.kind} · ${a.summary}${a.reason ? ` · why: ${a.reason}` : ""} · proposed by ${a.proposedBy} ${a.createdAt ? ukWhen(a.createdAt) : ""}${a.decidedByName ? ` · decided by ${a.decidedByName}` : ""}${a.error ? ` · problem: ${a.error}` : ""}`;
