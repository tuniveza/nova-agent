// Turning a Nova Mission request into Nova Quests, with Claude.
//
// "Release the EP by 1 December" becomes a set of concrete quests: each with a
// realistic length, a priority, a deadline worked back from the mission's, what
// it waits for, where it happens and the travel to get there. scheduler.ts then
// decides when each one happens.

import { z } from "zod";
import { readCalendar } from "../calendar/store";
import { askForJson } from "../llm";
import { memoryFor } from "../memory";
import { splitLong } from "./lengths";
import { notifyMission } from "./reminders";
import { fromMin, toMin } from "./scheduler";
import { nowMinutes, replan } from "./plan";
import { cleanMission, cleanQuest, EVERY, PRIORITIES, readQuests, TIMES_OF_DAY, type Mission, type Quest } from "./store";

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
        minutes: z.number().describe("Realistic working time in minutes, any length: fractions for seconds (0.5 = 30 seconds), or many hours for big work (it's split into sessions automatically). For an ongoing quest, the length of each session."),
        ongoing: z.boolean().describe("true only for open-ended work that never finishes (a daily practice, a habit, upkeep): it gets a session every day, weekday or week"),
        every: z.enum(EVERY).describe('How often an ongoing quest has a session: day, weekday, week, or interval (every every_minutes); "day" if not ongoing'),
        every_minutes: z.number().describe("For interval repeats: minutes between session starts (fractions for seconds); 0 otherwise"),
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

  // What the Nova suite remembers about this person and the work (Nova Index)
  const memory = await memoryFor(request);
  const plan = await askForJson({
    purpose: "plan a Nova Mission",
    schema: PlanSchema,
    system: `You plan Nova Missions for Novacane Studios (a recording studio in Forest Hill, London): you turn a goal into Nova Quests, concrete tasks that a scheduler will fit into the person's days hour by hour.

Make the plan genuinely good:
- Cover everything needed to reach the goal, including preparation, the work itself, reviews, buffers for feedback, and the final delivery. Leave out padding and busywork.
- Quests can be any length, realistically estimated (add ~15% for things that usually overrun): seconds for a quick action (send a text: 0.5), minutes, or many hours for big work, which the planner splits into sessions by itself. Still make separate quests for genuinely separate steps.
- Use an ongoing quest (ongoing: true, minutes per session, every day/weekday/week) for open-ended things that keep going, like daily vocal warm-ups or posting on socials; never for work that has an end.
- For something repeated at short intervals ("drink water every 30 minutes until bed"), make ONE ongoing quest with every "interval", every_minutes 30, a realistic length (a glass of water: 0.5), and its deadline when it should stop. Never write out each repeat as its own quest.
- Set dependencies so nothing is scheduled before what it needs. Work deadlines backwards from the mission's deadline, leaving slack before it.
- Priority: critical = the mission fails without it on time; high = important; normal = should happen; low = nice to have.
- time_of_day: deep creative or focused work suits mornings; admin and calls suit afternoons; use "any" when it doesn't matter.
- Only give a location and travel time when the work has to happen somewhere specific (a venue, a shop, someone's place). Estimate travel from the home base by public transport or car as most sensible for London, allowing for rush hour.
- Use fixed_start only for times the person stated exactly.
- Dates are UK dates. Never schedule anything in the past.`,
    prompt: `Today is ${dayName(now)}, ${fromMin(now).slice(11)} (UK time).
Home base: ${r.homeBase}. They're up from ${r.wake} and sleep at ${r.sleep}.
${hints.deadline ? `The mission's deadline: ${hints.deadline}\n` : ""}${active ? `Other missions already in progress:\n${active}\n` : ""}${taken ? `Already in the calendar:\n${taken}\n` : ""}
${memory ? memory + "\n\n" : ""}The mission, in their words:
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
      ongoing: q.ongoing,
      every: q.every,
      everyMinutes: q.every_minutes,
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
  data.quests.push(...quests.flatMap((q) => splitLong(q, data.rhythm)));
  const result = replan(data);
  const saved = result.data.quests.filter((q) => q.missionId === mission.id);
  const first = saved.filter((q) => q.start).sort((a, b) => a.start.localeCompare(b.start))[0];
  const risky = saved.filter((q) => q.atRisk).length;
  notifyMission(
    "planned",
    `Mission planned ✦ ${mission.title}`,
    `${saved.length} quest${saved.length === 1 ? "" : "s"}${first ? ` · first: ${first.title}, ${dayName(toMin(first.start)).replace(/ \d{4}$/, "")} at ${first.start.slice(11, 16)}` : ""}${risky ? ` · ${risky} at risk` : ""}`,
    mission.id,
  );
  return { mission, quests: saved, atRisk: saved.filter((q) => q.atRisk).length, unplaced: result.unplaced.filter((u) => saved.some((q) => q.id === u.id)).map((u) => `${u.title}: ${u.why}`) };
}
