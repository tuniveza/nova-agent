// The studio's bookings, for Agent and the quest planner (read-only).
//
// Bookings are Nova Bot's own: customers book on its /book page (with a Stripe deposit), each
// booking is kept in Nova Bot's database and put on the studio's Google Calendar. Nova Agent never
// changes a booking. It asks Nova Bot, with Nova Agent's own key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/bookings-feed   { from, to }   -> { appointments: [{ id, start, end, type, name }] }
//        the bookings on those UK days (inclusive, up to 62), times in UTC ISO. Not set up -> 409;
//        couldn't be read -> 503 { unreachable: true }
//
// That's all the key does here: there's no booking, moving, cancelling or approving through it.

import { config } from "./config";

// One booking: who, what and when (times in UTC ISO)
export interface StudioBooking {
  id: number | string;
  start: string;
  end: string;
  type: string;
  name: string;
}

// Nova Bot couldn't be reached (or couldn't read the bookings just now): it says so, and so do we
export class BookingsUnreachable extends Error {}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't read the studio's bookings.");
  let response: Response;
  try {
    response = await fetch(`${config.workerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new BookingsUnreachable(`Couldn't reach Nova Bot: ${(error as Error).message}`);
  }
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // An empty or broken answer: the status says what happened
  }
  if (!response.ok) {
    const message = data.error || `Nova Bot said no (${response.status}).`;
    if (data.unreachable || data.rateLimited || response.status >= 500 || response.status === 429) throw new BookingsUnreachable(message);
    throw new Error(message);
  }
  return data as T;
}

// The bookings between two UK dates (inclusive; up to 62 days)
export async function listStudioBookings(from: string, to: string): Promise<StudioBooking[]> {
  return (await call<{ appointments: StudioBooking[] }>("/nova-agent/bookings-feed", { from, to })).appointments ?? [];
}

// "Sat 31 Oct, 17:00" in UK time
export const ukWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ukTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

// The bookings as text for Claude (UK times)
export function bookingsText(list: StudioBooking[]): string {
  if (!list.length) return "No bookings in that range.";
  return [...list]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => [`#${a.id}`, `${ukWhen(a.start)}${a.end ? `–${ukTime(a.end)}` : ""}`, a.type, a.name].filter(Boolean).join(" · "))
    .join("\n");
}
