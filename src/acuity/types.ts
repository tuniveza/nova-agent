// What Nova Agent can do with appointments, independent of HOW it does it.
//
// The browser version (acuity/*.ts) implements this. Because the rest of the
// program only talks in these terms, it could later be swapped for Acuity's
// official API without changing anything else.

export interface Appointment {
  id: string; // Acuity's appointment ID, e.g. "1774410339"
  date: string; // "2026-10-07"
  time: string; // "15:00" (24-hour, business timezone)
  endTime?: string;
  type: string; // the appointment type / service name
  clientName: string;
  email?: string;
  phone?: string;
  notes?: string;
}

// The details needed to book a new appointment.
export interface NewAppointment {
  type: string; // e.g. "Rap Package - 2 songs" (the start of the type's name is enough if it's unique)
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  notes?: string;
}

// How to pick out one existing appointment. Date + time must match exactly;
// the client name (if given) must match exactly too, ignoring capitals. If
// more than one appointment matches, the agent refuses rather than guessing.
export interface AppointmentMatch {
  date: string;
  time: string;
  clientName?: string;
}

// Search filters. Every field is optional; give whichever you know.
export interface AppointmentSearch {
  from?: string; // first date to include
  to?: string; // last date to include
  clientName?: string;
  email?: string;
  phone?: string;
  type?: string;
}

// Anything about an existing appointment that can be changed.
// Leave a field out to keep it as it is. Changing date/time is a reschedule.
// Type, price and paid are what Acuity's API can't change, so Novabot sends
// those to Nova Agent (see jobs.ts).
export type AppointmentChanges = Partial<NewAppointment> & {
  price?: string; // total price in pounds, e.g. "80.00"
  paid?: boolean;
};

export interface CancelOptions {
  notifyClient: boolean; // tick Acuity's "Send email to client"
  note?: string; // optional note included in that email
}

// What came of a book / cancel / edit.
export interface ActionResult {
  ok: boolean; // true = done (or, in a dry run, got all the way to the final click)
  dryRun: boolean; // true = stopped before the final click; nothing changed
  message: string; // plain English, fit to pass on to a person
  appointment?: Appointment;
}
