// Turning a Nova Mission request into a plan, with Claude.
//
// Any goal, in the Nova suite or nothing to do with it ("release the EP by
// 1 December", "catch up on my 52-release challenge by New Year", "get fit for
// the summer") becomes:
//   - a short written strategy (release, content, filming and editing... as the
//     goal needs), workstreams (tracks) and dated milestones
//   - Nova Quests: concrete tasks, each with a realistic length, a priority, a
//     deadline worked back from the mission's, what it waits for, where it
//     happens and the travel to get there
//   - series: the same steps repeated for many items (each song in a release
//     schedule), described once and expanded here, so the dates add up exactly
//   - the assumptions the plan made and the questions that would sharpen it
//   - research: what it looked up on the web to plan well (current platform
//     advice, prices, opening times, deadlines), each finding with the page it
//     came from; only pages it really searched up or read are kept
// scheduler.ts then decides when each quest happens. Answering the questions
// (or adding any detail) re-plans the work that's left: refineMission.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readCalendar } from "../calendar/store";
import { askWithResearch } from "../llm";
import type { Source } from "../web";
import { memoryFor } from "../memory";
import { splitLong } from "./lengths";
import { notifyMission } from "./reminders";
import { fromMin, toMin } from "./scheduler";
import { nowMinutes, replan } from "./plan";
import { cleanMission, cleanQuest, EVERY, PRIORITIES, readQuests, TIMES_OF_DAY, WEEKDAYS, type Finding, type Milestone, type Mission, type Quest, type QuestData } from "./store";

const DateOrStamp = z.string().describe('"YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (UK time), or "" for none');
const MAX_ITEMS = 60;
const MAX_STEPS = 10;
const MAX_QUESTS = 500;
// How much of the web one plan may use
const RESEARCH = { search: 6, fetch: 4 };

const QuestSchema = z.object({
  title: z.string().describe("Starts with a verb, specific: 'Record lead vocals for track 2'"),
  notes: z.string().describe("What done looks like, and any useful detail (how to do it fastest). Can be empty."),
  track: z.string().describe("The name of the track (workstream) it belongs to, exactly as in tracks"),
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
});

const StepSchema = z.object({
  title: z.string().describe("Starts with a verb and uses {item} where the item's name goes: 'Finish the arrangement of {item}'"),
  track: z.string().describe("The track this step belongs to, exactly as in tracks (e.g. editing and posting are Content even in a release series); empty = the series' track"),
  notes: z.string().describe("What done looks like and how to do it fastest. Can be empty."),
  minutes: z.number().describe("Realistic working time for this step, per item"),
  priority: z.enum(PRIORITIES),
  time_of_day: z.enum(TIMES_OF_DAY),
  days_before_due: z.number().describe("Must be finished this many days before the item is due (0 = by the due time itself; negative = after it, e.g. -1 to reply to comments the day after a release)"),
  not_before_days: z.number().describe("Can't start until this many days before the item is due (0 = only on the due day, e.g. posting the release; -1 = no limit, as early as possible)"),
  location: z.string().describe("Only if it has to happen somewhere specific, otherwise empty"),
  travel_minutes: z.number().int().describe("Travel to the location from the home base; 0 if no location"),
});

const SeriesSchema = z.object({
  name: z.string().describe("What repeats, e.g. 'Weekly releases'"),
  track: z.string().describe("The track it belongs to, exactly as in tracks"),
  items: z.array(z.string()).describe(`One name per repeat, in order (song titles if known, otherwise 'Release 20', 'Release 21'...). At most ${MAX_ITEMS}.`),
  first_due: z.string().describe('When the first item is due, "YYYY-MM-DDTHH:MM" (e.g. its release time)'),
  every_days: z.number().describe("Days between one item's due time and the next (fractions allowed: 2.5 for every two and a half days, 7 for weekly)"),
  milestone: z.string().describe("A milestone for each item, using {item} (e.g. 'Release {item}'), or empty for none"),
  waits_for: z.array(z.number().int()).describe("Indexes of quests (in quests) the whole series can't start without; usually empty"),
  steps: z.array(StepSchema).describe(`The steps every item goes through, in order (at most ${MAX_STEPS})`),
});

const PlanSchema = z.object({
  title: z.string().describe("A short, motivating name for the mission"),
  summary: z.string().describe("Two or three sentences: what success looks like and the approach"),
  deadline: DateOrStamp,
  tracks: z.array(z.string()).describe("1 to 6 workstreams, short names (e.g. Music, Content, Release, Gear)"),
  strategy: z
    .array(z.object({ heading: z.string(), body: z.string().describe("Specific and practical, in simple Markdown (short paragraphs and lists)") }))
    .describe("The written plan, as the goal needs it; empty for a small goal"),
  milestones: z
    .array(z.object({ title: z.string(), at: DateOrStamp, track: z.string() }))
    .describe("Key dated checkpoints that aren't already a series item's milestone"),
  assumptions: z.array(z.string()).describe("What you had to assume because they didn't say (0 to 6, short)"),
  questions: z.array(z.string()).describe("The 0 to 5 questions whose answers would most improve the plan (short, one line each)"),
  research: z
    .array(z.object({ finding: z.string().describe("One useful fact you found, in a sentence, as it applies to this plan"), source_url: z.string().describe("The exact URL of the page it came from, as the search or fetch returned it") }))
    .describe("What you looked up on the web and used in the plan (0 to 10); empty if you didn't search"),
  days_off: z.array(z.enum(WEEKDAYS)).describe("Whole days of the week they said they can't or won't work (e.g. sunday); empty if they didn't say. No quests are ever planned on these days."),
  series: z.array(SeriesSchema).describe("Repeated pipelines; empty if nothing repeats per item"),
  quests: z.array(QuestSchema).describe("One-off quests, in a sensible order"),
});
type Plan = z.infer<typeof PlanSchema>;

const dayName = (m: number) => new Date(m * 60000).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const stampOf = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59` : s);

const SYSTEM = `You are Nova Agent's mission planner. You turn any goal someone has into a plan that genuinely gets them there: a short written strategy, workstreams, dated milestones and Nova Quests (concrete tasks that a scheduler fits into their days hour by hour, around their sleep, calendar and travel).

The goal can be anything: their music, creative projects, content, business, studio work, health, study, life admin, inside the Nova suite or nothing to do with it. The people you plan for are at Novacane Studios (a recording studio in Forest Hill, London), often artists, producers and creators. Plan like a seasoned expert in the goal's field (an artist manager and content strategist for a release campaign, a coach for fitness, and so on).

Make the plan genuinely good:
- Cover everything needed to reach the goal: preparation, the work itself, reviews, buffers and the final delivery. Leave out padding and busywork.
- Do the maths. If they're behind, work out exactly what's left and the time available, and pace it so it fits (e.g. 33 songs in 12 weeks is one every 2.5 days). Respect how many hours a day they can work. If it truly can't all fit, say so in the strategy and say what to cut or combine.
- Strategy: for anything bigger than a short to-do list, write the sections this goal needs, specific to them (numbers, days, times, formats, tools), 60 to 250 words each, 2 to 7 sections. For a release campaign that usually means: the release strategy (cadence, platforms, release days and times, how to catch up), the content strategy (content pillars, formats per platform such as Instagram Reels and TikTok, hooks, how many posts per song and when, repurposing one shoot into many posts, building a following), the production workflow (finishing half-done ideas fast, templates, how new gear speeds things up), the filming and editing workflow (batch filming days, shot lists, editing templates, the quickest pipeline from recording to posting), and a typical week. Leave strategy empty for a small goal.
- Tracks: 1 to 6 workstreams. Every quest and series names one.
- Series: when the same steps repeat for many items (every song in a release schedule, every episode, every weekly post), describe it once as a series: the items, when the first is due, the spacing, and the steps each item goes through (with how many days before the due date each step must be done, and when it may start: posting a release only on its day). Never write the repeats out as separate quests. Batch where it saves time: a filming day that covers several songs is a one-off quest (or its own series with fewer items), not a step per song.
- Quests: the one-off work (research and buy gear, set it up, build editing and session templates, plan the content calendar, batch filming days...).
- Quest lengths can be anything, realistically estimated (add ~15% for things that usually overrun): seconds for a quick action (send a text: 0.5), minutes, or many hours for big work, which the planner splits into sessions by itself. Still make separate quests for genuinely separate steps.
- Use an ongoing quest (ongoing: true, minutes per session, every day/weekday/week) for open-ended things that keep going, like daily vocal warm-ups or engaging with comments; never for work that has an end. For something repeated at short intervals ("drink water every 30 minutes until bed"), make ONE ongoing quest with every "interval", every_minutes 30, a realistic length and its deadline when it should stop.
- Set dependencies so nothing is scheduled before what it needs. Work deadlines backwards from the mission's deadline, leaving slack before it.
- Priority: critical = the mission fails without it on time; high = important; normal = should happen; low = nice to have.
- time_of_day: deep creative or focused work suits mornings; admin and calls suit afternoons; filming may need daylight; use "any" when it doesn't matter.
- Only give a location and travel time when the work has to happen somewhere specific (a venue, a shop, someone's place). Estimate travel from the home base by public transport or car as most sensible for London, allowing for rush hour.
- Use fixed_start only for times the person stated exactly.
- Milestones: the key dated checkpoints (gear arrives, halfway, the final release). Series items get their own milestones from the series, so don't repeat those.
- Days off: if they say they can't work certain days of the week, list them in days_off; the scheduler then keeps those days completely free. Don't plan around them any other way.
- Assumptions and questions: when something important is unknown (how many they've done so far, which day they release, when gear arrives), make the most sensible assumption, plan with it, and list it; then ask the few questions that would most improve the plan. Never hold the plan back for an answer.
- Dates are UK dates. Never schedule anything in the past.
- Research: you can search the web and read pages. Do it when current, specific facts would make the plan genuinely better: how a platform works now (best posting times, format specs, distributor lead times before a release date), prices and where to buy, opening hours and booking rules for a place, entry deadlines, a course's syllabus. Don't search for general know-how you already have, and skip it entirely for small personal goals. Put what you used in research, each with the exact URL it came from, and build it into the strategy and quests.`;

// The plan, from Claude (with the pages it looked at)
async function askForPlan(data: QuestData, parts: { request: string; deadline?: string; context?: string }): Promise<{ plan: Plan; sources: Source[] }> {
  const now = nowMinutes();
  const r = data.rhythm;
  const until = parts.deadline ? stampOf(parts.deadline).slice(0, 10) : fromMin(now + 120 * 1440).slice(0, 10);
  const taken = readCalendar()
    .notes.filter((n) => !/^(quest|block|mile)-/.test(n.id) && n.start.slice(0, 10) <= until && n.end >= fromMin(now))
    .slice(0, 80)
    .map((n) => `- ${n.start.replace("T", " ")} to ${n.end.slice(11)}: ${n.title}`)
    .join("\n");
  const active = data.missions.filter((m) => m.status === "active").map((m) => `- ${m.title}${m.deadline ? ` (due ${m.deadline})` : ""}`).join("\n");
  // What the Nova suite remembers about this person and the work (Nova Index)
  const memory = await memoryFor(parts.request);
  const { answer, sources } = await askWithResearch({
    purpose: "plan a Nova Mission",
    schema: PlanSchema,
    long: { effort: "high" },
    web: RESEARCH,
    system: SYSTEM,
    prompt: `Today is ${dayName(now)}, ${fromMin(now).slice(11, 16)} (UK time).
Home base: ${r.homeBase}. They're up from ${r.wake} and sleep at ${r.sleep}, and do up to ${r.maxQuestHoursPerDay} hours of quest work a day.${r.daysOff.length ? ` They have no quests on ${r.daysOff.map((d) => WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1) + "s").join(" or ")}.` : ""}
${parts.deadline ? `The mission's deadline: ${parts.deadline}\n` : ""}${active ? `Other missions already in progress:\n${active}\n` : ""}${taken ? `Already in the calendar:\n${taken}\n` : ""}
${memory ? memory + "\n\n" : ""}The mission, in their words:
"""${parts.request.slice(0, 6000)}"""${parts.context ? `\n\n${parts.context}` : ""}`,
  });
  return { plan: answer, sources };
}

// The plan's findings, keeping only those that cite a page it really found or read
export function checkedFindings(plan: Pick<Plan, "research">, sources: Source[]): Finding[] {
  const bare = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/$/, "");
  const byUrl = new Map(sources.map((s) => [bare(s.url), s]));
  return plan.research
    .map((r) => ({ r, s: byUrl.get(bare(r.source_url)) }))
    .filter((x): x is { r: Plan["research"][number]; s: Source } => Boolean(x.s && x.r.finding.trim()))
    .map(({ r, s }) => ({ text: r.finding.trim(), title: s.title, url: s.url }))
    .slice(0, 20);
}

// A series, written out: each item's steps as quests (chained in order), with its milestone
export function expandSeries(
  s: Plan["series"][number],
  missionId: string,
  questIds: string[],
): { quests: Quest[]; milestones: Milestone[] } {
  const quests: Quest[] = [];
  const milestones: Milestone[] = [];
  const first = toMin(stampOf(s.first_due));
  if (!Number.isFinite(first)) return { quests, milestones };
  const gap = Math.max(1 / 24, s.every_days) * 1440;
  const steps = s.steps.slice(0, MAX_STEPS);
  const waits = s.waits_for.filter((i) => i >= 0 && i < questIds.length).map((i) => questIds[i]);
  s.items.slice(0, MAX_ITEMS).forEach((item, i) => {
    const due = first + Math.round(i * gap);
    let before = waits;
    for (const step of steps) {
      const id = randomUUID();
      quests.push(
        cleanQuest({
          id,
          missionId,
          track: step.track || s.track,
          title: step.title.replaceAll("{item}", item),
          notes: step.notes.replaceAll("{item}", item),
          minutes: step.minutes,
          priority: step.priority,
          timeOfDay: step.time_of_day,
          deadline: fromMin(due - Math.round(step.days_before_due * 1440)).slice(0, 16),
          // "Not before" counts from the start of that day
          earliest: step.not_before_days >= 0 ? `${fromMin(due - Math.round(step.not_before_days * 1440)).slice(0, 10)}T00:00` : "",
          dependsOn: before,
          location: step.location,
          travelMinutes: step.location ? step.travel_minutes : 0,
        }),
      );
      before = [id];
    }
    if (s.milestone.trim()) milestones.push({ id: randomUUID(), title: s.milestone.replaceAll("{item}", item).slice(0, 140), at: fromMin(due).slice(0, 16), track: s.track, done: false });
  });
  return { quests, milestones };
}

// The plan's quests and milestones for a mission (dependency indexes become quest ids)
function materialise(plan: Plan, mission: Mission, data: QuestData): { quests: Quest[]; milestones: Milestone[] } {
  const now = nowMinutes();
  const ids = plan.quests.map(() => randomUUID());
  const oneOffs = plan.quests.map((q, i) =>
    cleanQuest({
      id: ids[i],
      missionId: mission.id,
      track: q.track,
      title: q.title,
      notes: q.notes,
      minutes: q.minutes,
      ongoing: q.ongoing,
      every: q.every,
      everyMinutes: q.every_minutes,
      priority: q.priority,
      deadline: q.deadline || mission.deadline || "",
      earliest: q.earliest,
      dependsOn: q.depends_on.filter((d) => d >= 0 && d < i).map((d) => ids[d]),
      location: q.location,
      travelMinutes: q.location ? q.travel_minutes : 0,
      timeOfDay: q.time_of_day,
      fixedStart: q.fixed_start && toMin(q.fixed_start) > now ? q.fixed_start : "",
    }),
  );
  const fromSeries = plan.series.map((s) => expandSeries(s, mission.id, ids));
  const milestones: Milestone[] = [
    ...plan.milestones.filter((m) => m.at).map((m) => ({ id: randomUUID(), title: m.title, at: stampOf(m.at).replace(/T23:59$/, "T12:00"), track: m.track, done: false })),
    ...fromSeries.flatMap((x) => x.milestones),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const quests = [...oneOffs, ...fromSeries.flatMap((x) => x.quests)].slice(0, MAX_QUESTS).flatMap((q) => splitLong(q, data.rhythm));
  return { quests, milestones };
}

// The written-up parts of a plan onto its mission (new research replaces the
// old; a re-plan that didn't look anything up keeps what was found before)
function applyPlanText(m: Mission, plan: Plan, milestones: Milestone[], findings: Finding[]): Mission {
  return cleanMission({
    ...m,
    ...(findings.length ? { research: findings, researched: new Date().toISOString() } : {}),
    summary: plan.summary,
    strategy: plan.strategy,
    tracks: plan.tracks.map((name, i) => ({ name, colour: m.tracks.find((t) => t.name === name)?.colour ?? m.tracks[i]?.colour })),
    milestones,
    assumptions: plan.assumptions,
    questions: plan.questions,
  });
}

// Days they said they can't work become days off in their rhythm (for everything, not just this mission)
function takeDaysOff(data: QuestData, plan: Plan): void {
  const days = plan.days_off.map((d) => WEEKDAYS.indexOf(d)).filter((d) => d >= 0);
  if (days.length) data.rhythm.daysOff = [...new Set([...data.rhythm.daysOff, ...days])].sort().slice(0, 6);
}

function report(mission: Mission, data: QuestData, unplacedAll: { id: string; title: string; why: string }[], verb: "planned" | "re-planned") {
  const saved = data.quests.filter((q) => q.missionId === mission.id && q.status !== "done" && q.status !== "skipped");
  const first = saved.filter((q) => q.start).sort((a, b) => a.start.localeCompare(b.start))[0];
  const risky = saved.filter((q) => q.atRisk).length;
  notifyMission(
    "planned",
    `Mission ${verb} ✦ ${mission.title}`,
    `${saved.length} quest${saved.length === 1 ? "" : "s"}${first ? ` · first: ${first.title}, ${dayName(toMin(first.start)).replace(/ \d{4}$/, "")} at ${first.start.slice(11, 16)}` : ""}${risky ? ` · ${risky} at risk` : ""}`,
    mission.id,
  );
  return {
    mission: data.missions.find((m) => m.id === mission.id) ?? mission,
    quests: saved,
    atRisk: risky,
    unplaced: unplacedAll.filter((u) => saved.some((q) => q.id === u.id)).map((u) => `${u.title}: ${u.why}`),
  };
}

export async function createMission(request: string, hints: { deadline?: string } = {}): Promise<{ mission: Mission; quests: Quest[]; atRisk: number; unplaced: string[] }> {
  const { plan, sources } = await askForPlan(readQuests(), { request, deadline: hints.deadline });
  // Read again after the (slow) planning, so nothing that changed meanwhile is lost
  const data = readQuests();
  let mission = cleanMission({ title: plan.title, request, deadline: hints.deadline || plan.deadline });
  const { quests, milestones } = materialise(plan, mission, data);
  mission = applyPlanText(mission, plan, milestones, checkedFindings(plan, sources));
  data.missions.push(mission);
  data.quests.push(...quests);
  takeDaysOff(data, plan);
  const result = replan(data);
  return report(mission, result.data, result.unplaced, "planned");
}

// Answers to the plan's questions (or any new detail): the work that's left is
// planned again with it. Finished quests, the one under way and skipped ones stay.
export async function refineMission(id: string, detail: string, hints: { deadline?: string } = {}): Promise<{ mission: Mission; quests: Quest[]; atRisk: number; unplaced: string[] }> {
  const before = readQuests();
  const m = before.missions.find((x) => x.id === id || x.id.startsWith(id));
  if (!m) throw new Error(`No mission with id ${id}.`);
  const text = detail.trim().slice(0, 4000);
  if (!text) throw new Error("Say what's new first.");
  const now = new Date().toISOString();
  const refinements = [...m.refinements, { at: now, text }];
  const mine = before.quests.filter((q) => q.missionId === m.id);
  const done = mine.filter((q) => q.status === "done").map((q) => `- ${q.title}${q.completed ? ` (done ${q.completed.slice(0, 10)})` : ""}`);
  const doing = mine.filter((q) => q.status === "doing").map((q) => `- ${q.title}`);
  const deadline = hints.deadline || m.deadline;
  const { plan, sources } = await askForPlan(before, {
    request: m.request,
    deadline,
    context: `This mission already has a plan, called "${m.title}". Plan again, from now, ONLY the work that's left, using everything below. Keep what was working; change what the new detail changes.
${m.assumptions.length ? `The last plan assumed:\n${m.assumptions.map((a) => `- ${a}`).join("\n")}\n` : ""}${m.questions.length ? `It asked:\n${m.questions.map((q) => `- ${q}`).join("\n")}\n` : ""}What they've told you since (oldest first):
${refinements.map((r) => `- ${r.text}`).join("\n")}
${m.research.length ? `Research from last time (${m.researched.slice(0, 10)}; only look again if it may be out of date or the new detail needs more):\n${m.research.map((f) => `- ${f.text} (${f.url})`).join("\n")}\n` : ""}${done.length ? `Already done (don't plan these again):\n${done.slice(-80).join("\n")}\n` : ""}${doing.length ? `Under way right now (leave out):\n${doing.join("\n")}\n` : ""}`,
  });
  const data = readQuests();
  const current = data.missions.find((x) => x.id === m.id);
  if (!current) throw new Error("That mission was removed while it was being planned.");
  // Out with the open quests, in with the new plan's
  data.quests = data.quests.filter((q) => q.missionId !== m.id || q.status !== "todo");
  const { quests, milestones } = materialise(plan, current, data);
  // Milestones already ticked off stay ticked
  const ticked = new Set(current.milestones.filter((x) => x.done).map((x) => x.title));
  const kept = current.milestones.filter((x) => x.done);
  const fresh = milestones.filter((x) => !ticked.has(x.title));
  const updated = applyPlanText({ ...current, deadline, refinements, status: current.status === "done" ? "active" : current.status }, plan, [...kept, ...fresh].sort((a, b) => a.at.localeCompare(b.at)), checkedFindings(plan, sources));
  updated.updated = now;
  data.missions[data.missions.indexOf(current)] = updated;
  data.quests.push(...quests);
  takeDaysOff(data, plan);
  const result = replan(data);
  return report(updated, result.data, result.unplaced, "re-planned");
}
