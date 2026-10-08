// The chat's extra calendar details (chat.ts's calendar tools): where, all day, colour,
// repeats and phone reminders. Kept here so chat.ts only spreads them in.

import { z } from "zod";
import { describeRepeat } from "./store";
import type { NoteCard } from "./store";

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

export const EVENT_EXTRAS = {
  location: z.string().max(160).optional().describe("Where it happens"),
  all_day: z.boolean().optional().describe("True for an all-day event (no times)"),
  color: z.enum(["rose", "violet", "blue", "teal", "green", "amber", "orange", "red", "grey"]).optional(),
  repeat: z
    .object({
      every: z.enum(["day", "week", "month", "year"]),
      interval: z.number().int().min(1).max(99).optional().describe("Every N days/weeks/… (default 1)"),
      on_days: z.array(z.enum(WEEKDAY_NAMES)).optional().describe("For weekly repeats: which days"),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last date (YYYY-MM-DD)"),
      times: z.number().int().min(1).max(1000).optional().describe("How many times in all"),
    })
    .nullable()
    .optional()
    .describe("Repeat the event (null to stop repeating)"),
  remind_minutes_before: z.array(z.number().int().min(0).max(40320)).max(5).optional().describe("Phone reminders, minutes before (e.g. [10, 60, 1440])"),
};

type Extras = { location?: string; all_day?: boolean; color?: string; repeat?: { every: string; interval?: number; on_days?: string[]; until?: string; times?: number } | null; remind_minutes_before?: number[] };

// The tool's words → the note card's fields (only what was given)
export function extrasToNote(x: Extras): Partial<NoteCard> {
  const out: Partial<NoteCard> = {};
  if (x.location !== undefined) out.location = x.location;
  if (x.all_day !== undefined) out.allDay = x.all_day;
  if (x.color !== undefined) out.color = x.color;
  if (x.remind_minutes_before !== undefined) out.reminders = x.remind_minutes_before;
  // null (not undefined, which "only the fields that change" skips) takes the repeat away
  if (x.repeat === null) out.repeat = null as unknown as undefined;
  else if (x.repeat) {
    const freq = ({ day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const)[x.repeat.every as "day"];
    out.repeat = {
      freq,
      interval: x.repeat.interval || 1,
      ...(x.repeat.on_days?.length ? { byDay: x.repeat.on_days.map((d) => WEEKDAY_NAMES.indexOf(d as (typeof WEEKDAY_NAMES)[number])) } : {}),
      ...(x.repeat.until ? { until: x.repeat.until } : x.repeat.times ? { count: x.repeat.times } : {}),
    };
  }
  return out;
}

// A note card's extras in words, for the chat's replies and lists
export function extrasInWords(n: NoteCard): string {
  return [n.allDay ? "all day" : "", n.location ? `at ${n.location}` : "", n.repeat ? describeRepeat(n.repeat).toLowerCase() : "", n.reminders?.length ? `reminders ${n.reminders.join(", ")} min before` : ""]
    .filter(Boolean)
    .join(", ");
}
