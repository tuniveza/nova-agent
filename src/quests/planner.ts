// Turning a Nova Mission request into Nova Quests, with Claude.
//
// "Release the EP by 1 December" becomes a set of concrete quests: each with a
// realistic length, a priority, a deadline worked back from the mission's, what
// it waits for, where it happens and the travel to get there. scheduler.ts then
// decides when each one happens.

import { z } from "zod";
import { readCalendar } from "../calendar/store";
import { askForJson } from "../llm";
import { fromMin, toMin } from "./scheduler";
import { nowMinutes, replan } from "./plan";
import { cleanMission, cleanQuest, PRIORITIES, readQuests, TIMES_OF_DAY, type Mission, type Quest } from "./store";

const DateOrStamp = z.string().describe('"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (UK time), or "" for none');

const PlanSchema = z.object({
  title: z.string().describe("A short, motivating name for the mission"),
  summary: z.string().describe("One or two sentences: what success looks like and the approach"),
  deadline: DateOrStamp,
  quests: z
    .array(
      z.object({
        title: z.string().describe("Starts with a verb, specific: 'Record lead vocals for track 2'"),
        notes: z.string().describe("What done looks like, and any useful detail. Can be empty."),
        minutes: z.number().int().describe("Realistic working time, 15 to 180; split anything longer into several quests"),
        priority: z.enum(PRIORITIES),
        deadline: DateOrStamp,
        earliest: DateOrStamp.describe("Not before this (e.g. waiting for a delivery), or empty"),
        depends_on: z.array(z.number().int()).describe("Indexes (0-based) of earlier quests in this list that must be finished first"),
        location: z.string().describe("Only if it has to happen somewhere specific, otherwise empty"),
        travel_minutes: z.number().int().describe("Door-to-door travel to the location from the home base, allowing for London traffic at that time of day; 0 if no location"),
        time_of_day: z.enum(TIMES_OF_DAY),
        fixed_start: z.string().describe('"YYYY-MM-DDTHH:MM" only if the person gave an exact time for it, otherwise empty'),
      }),
    )
    .describe("In a sensible order"),
});

const dayName = (m: number) => new Date(m * 60000).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function createMission(request: string, hints: { deadline?: string } = {}): Promise<{ mission: Mission; quests: Quest[]; atRisk: number; unplaced: string[] }> {
  const data = readQuests();
  const now = nowMinutes();
  const horizonEnd = fromMin(now + data.rhythm.horizonDays * 1440).slice(0, 10);
  const taken = readCalendar()
    .notes.filter((n) => n.start.slice(0, 10) <= horizonEnd && n.end >= fromMin(now))
    .slice(0, 60)
    .map((n) => `- ${n.start.replace("T", " ")} to ${n.end.slice(11)}: ${n.title}`)
    .join("\n");
  const active = data.missions.filter((m) => m.status === "active").map((m) => `- ${m.title}${m.deadline ? ` (due ${m.deadline})` : ""}`).join("\n");
  const r = data.rhythm;

  const plan = await askForJson({
    purpose: "plan a Nova Mission",
    schema: PlanSchema,
    system: `You plan Nova Missions for Novacane Studios (a recording studio in Forest Hill, London): you turn a goal into Nova Quests, concrete tasks that a scheduler will fit into the person's days hour by hour.

Make the plan genuinely good:
- Cover everything needed to reach the goal, including preparation, the work itself, reviews, buffers for feedback, and the final delivery. Leave out padding and busywork.
- Each quest is one sitting of focused work: 15 to 180 minutes, realistically estimated (add ~15% for things that usually overrun). Split bigger work into several quests.
- Set dependencies so nothing is scheduled before what it needs. Work deadlines backwards from the mission's deadline, leaving slack before it.
- Priority: critical = the mission fails without it on time; high = important; normal = should happen; low = nice to have.
- time_of_day: deep creative or focused work suits mornings; admin and calls suit afternoons; use "any" when it doesn't matter.
- Only give a location and travel time when the work has to happen somewhere specific (a venue, a shop, someone's place). Estimate travel from the home base by public transport or car as most sensible for London, allowing for rush hour.
- Use fixed_start only for times the person stated exactly.
- Dates are UK dates. Never schedule anything in the past.`,
    prompt: `Today is ${dayName(now)}, ${fromMin(now).slice(11)} (UK time).
Home base: ${r.homeBase}. They're up from ${r.wake} and sleep at ${r.sleep}.
${hints.deadline ? `The mission's deadline: ${hints.deadline}\n` : ""}${active ? `Other missions already in progress:\n${active}\n` : ""}${taken ? `Already in the calendar:\n${taken}\n` : ""}
The mission, in their words:
"""${request.slice(0, 4000)}"""`,
  });

  // Save the mission and its quests (dependency indexes become quest ids)
  const mission = cleanMission({ title: plan.title, summary: plan.summary, request, deadline: hints.deadline || plan.deadline });
  const ids: string[] = plan.quests.map(() => crypto.randomUUID());
  const quests = plan.quests.map((q, i) =>
    cleanQuest({
      id: ids[i],
      missionId: mission.id,
      title: q.title,
      notes: q.notes,
      minutes: q.minutes,
      priority: q.priority,
      deadline: q.deadline || (mission.deadline ? mission.deadline : ""),
      earliest: q.earliest,
      dependsOn: q.depends_on.filter((d) => d >= 0 && d < i).map((d) => ids[d]),
      location: q.location,
      travelMinutes: q.location ? q.travel_minutes : 0,
      timeOfDay: q.time_of_day,
      fixedStart: q.fixed_start && toMin(q.fixed_start) > now ? q.fixed_start : "",
    }),
  );
  data.missions.push(mission);
  data.quests.push(...quests);
  const result = replan(data);
  const saved = result.data.quests.filter((q) => q.missionId === mission.id);
  return { mission, quests: saved, atRisk: saved.filter((q) => q.atRisk).length, unplaced: result.unplaced.filter((u) => ids.includes(u.id)).map((u) => `${u.title}: ${u.why}`) };
}
