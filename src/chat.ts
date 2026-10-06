// Talking to Nova Agent.
//
// The chat page (src/visualizer/chat.html) sends the conversation here. Claude
// answers as Nova Agent, with tools to:
//   - read, add, change and remove Nova Calendar note cards and day cards
//     (calendar/store.ts; the calendar on the page refreshes when it changes)
//   - look at the studio's Acuity bookings and check the Acuity login
//     (read-only for now, through the same browser tasks as the visualizer)
//   - say how Nova Agent itself is doing
// The SDK's tool runner does the back-and-forth with Claude.

import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addDay, addNote, AESTHETICS, listRange, PRESETS, readCalendar, removeDay, removeNote, THEMES, updateDay, updateNote } from "./calendar/store";
import { config } from "./config";
import { getClient } from "./llm";
import { checkLogin, describeAppointments, listTask } from "./tasks";
import { getRecentEvents, trace } from "./trace";
import { addBlock, addQuest, questState, removeBlock, removeMission, removeQuest, setQuestStatus, setRhythm, snoozeQuest, updateMission, updateQuest } from "./quests/actions";
import { replan } from "./quests/plan";
import { createMission } from "./quests/planner";
import { describeLength } from "./quests/lengths";
import { EVERY, PRIORITIES, readQuests, TIMES_OF_DAY, type Quest } from "./quests/store";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_HISTORY = 40;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatAction {
  kind: "added" | "changed" | "removed" | "looked";
  text: string;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("A date, YYYY-MM-DD (UK)");
const STAMP = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).describe("A local UK date and time, YYYY-MM-DDTHH:MM");

// "Friday 9 October 2026" / "Friday 9 October, 14:00"
const longDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const whenText = (start: string, end: string) => `${longDate(start.slice(0, 10))}, ${start.slice(11, 16)}${end && end !== start ? `–${end.slice(0, 10) === start.slice(0, 10) ? end.slice(11, 16) : `${longDate(end.slice(0, 10))} ${end.slice(11, 16)}`}` : ""}`;

function nowInUk() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, time: `${get("hour")}:${get("minute")}`, words: longDate(date) };
}

function systemPrompt(): string {
  const now = nowInUk();
  return `You are Nova Agent, part of the Nova suite for Novacane Studios (a recording studio in Forest Hill, London). You run on the studio computer. People from the studio chat with you here.

It is ${now.words}, ${now.time} (UK time). Today's date is ${now.date}.

You also run Nova Missions and Nova Quests, a smart planner for the people you talk to:
- A Nova Mission is an end goal (e.g. "release the EP by 1 December"). mission_create turns their request into Nova Quests (concrete tasks with time estimates, priorities, deadlines, dependencies, locations and travel) and schedules them.
- A quest can be any length: seconds ("text Sam back", 30 seconds), minutes, hours, or days of work (split into sessions automatically). An ongoing quest repeats: every day, weekday or week, or at any interval ("drink water every 30 minutes until 11pm": ongoing, every interval, every_minutes 30, a length of seconds, deadline 23:00), until they end it (quest_status finish) or its deadline passes. Prefer one ongoing quest over many copies.
- Nova Quests are planned hour by hour around their sleep and wind-down, travel, buffers and breaks, the calendar, and blocked-out time. Every change re-plans automatically, most urgent first, so the plan stays optimised.
- Help them prioritise and pivot: for "what should I do now?" use what_now and give one clear recommendation. When plans change ("I'm running late", "I'm out tonight", "I'm ill today"), block the time or update the quest, then say what moved. Mark quests done, started or skipped when they tell you. Point out quests at risk of missing a deadline and suggest what to drop, shorten or move.
- Their daily rhythm (wake, sleep, buffers, breaks, reminders, phone notifications) can be changed with rhythm_set.

What you can do:
- Nova Calendar: read, add, change and remove note cards (a title, the note itself, an author, a start and finish time) and day cards (a date with a title, a preset, a title aesthetic, a colour theme, information, a location, tags, and optionally repeating every year). Use the calendar tools for this; the calendar beside the chat updates straight away.
- The studio's Acuity bookings: look at what's booked between two dates, and check that you're still logged in to Acuity. This is read-only for now: you can't book, move or cancel Acuity appointments from this chat yet. If someone asks, say so and suggest Nova Hub or Acuity.
- Say how you're doing (agent_status).

How to work:
- Work out dates from what people say ("next Friday", "tomorrow at 2", "Halloween") using today's date above, and say the exact date you used.
- When asked to add or change something, just do it with the tool, then confirm in one short line with the day and date. If something important is missing (like the time for a note card), make a sensible choice and say what you chose; only ask if you really can't tell.
- Before removing anything, make sure you have the right one (look it up first). Removing is fine when someone asks.
- Note cards are for things at a time; day cards are for a whole day (birthdays, release days, seasonal days, trips).
- Day card presets: ${PRESETS.join(", ")}. Aesthetics: ${AESTHETICS.join(", ")}. Themes: ${THEMES.join(", ")} ("app" follows the calendar's own theme).
- Keep replies short and warm, in UK English. Use simple Markdown (bold, short lists) when it helps. Never invent bookings or calendar entries: only report what the tools return.`;
}

function tools(actions: ChatAction[]) {
  const did = (kind: ChatAction["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${text}`);
  };
  return [
    betaZodTool({
      name: "calendar_list",
      description: "List the note cards and day cards in Nova Calendar between two dates (inclusive). Use it to answer \"what's on\" questions and to find an item's id before changing or removing it.",
      inputSchema: z.object({ from: DATE, to: DATE }),
      run: async ({ from, to }) => {
        const { notes, days } = listRange(from, to);
        if (!notes.length && !days.length) return `Nothing in the calendar from ${from} to ${to}.`;
        return JSON.stringify({
          day_cards: days.map((d) => ({ id: d.id, date: d.date, title: d.title, preset: d.preset, repeats_yearly: d.repeat === "yearly", info: d.info, location: d.location, tags: d.tags })),
          note_cards: notes.map((n) => ({ id: n.id, title: n.title, note: n.body, author: n.author, start: n.start, end: n.end })),
        });
      },
    }),
    betaZodTool({
      name: "calendar_add_note",
      description: "Add a note card to Nova Calendar.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        note: z.string().max(5000).optional().describe("The note itself"),
        start: STAMP,
        end: STAMP.optional().describe("When it finishes (defaults to one hour after the start)"),
        author: z.string().max(60).optional(),
      }),
      run: async ({ title, note, start, end, author }) => {
        const finish = end ?? (() => {
          const d = new Date(`${start}:00Z`);
          d.setUTCHours(d.getUTCHours() + 1);
          return d.toISOString().slice(0, 16);
        })();
        const card = addNote({ title, body: note, start, end: finish, author });
        did("added", `Added note card “${card.title}”: ${whenText(card.start, card.end)}`);
        return `Added note card ${card.id}: “${card.title}”, ${whenText(card.start, card.end)}.`;
      },
    }),
    betaZodTool({
      name: "calendar_update_note",
      description: "Change a note card (find its id with calendar_list first). Only send the fields that change.",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().max(120).optional(),
        note: z.string().max(5000).optional(),
        start: STAMP.optional(),
        end: STAMP.optional(),
        author: z.string().max(60).optional(),
      }),
      run: async ({ id, note, ...rest }) => {
        const card = updateNote(id, { ...rest, body: note });
        did("changed", `Changed note card “${card.title}”: ${whenText(card.start, card.end)}`);
        return `Updated note card “${card.title}”, now ${whenText(card.start, card.end)}.`;
      },
    }),
    betaZodTool({
      name: "calendar_delete_note",
      description: "Remove a note card (find its id with calendar_list first).",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const card = removeNote(id);
        did("removed", `Removed note card “${card.title}” (${longDate(card.start.slice(0, 10))})`);
        return `Removed note card “${card.title}”.`;
      },
    }),
    betaZodTool({
      name: "calendar_add_day",
      description: "Add a day card to Nova Calendar (one per date; adding to a date that already has one updates it).",
      inputSchema: z.object({
        date: DATE,
        title: z.string().max(80).describe("The day's name, e.g. \"Kai's Birthday\""),
        preset: z.enum(PRESETS).optional(),
        aesthetic: z.enum(AESTHETICS).optional(),
        theme: z.enum(THEMES).optional(),
        info: z.string().max(4000).optional().describe("Information about the day"),
        location: z.string().max(120).optional(),
        tags: z.array(z.string().max(30)).max(12).optional(),
        repeats_yearly: z.boolean().optional().describe("True for birthdays, anniversaries and other yearly days"),
      }),
      run: async ({ repeats_yearly, ...input }) => {
        const day = addDay({ ...input, repeat: repeats_yearly ? "yearly" : input.preset && ["birthday", "anniversary", "halloween", "bonfire", "christmas", "newyear", "valentines", "stpatricks"].includes(input.preset) ? "yearly" : "none" });
        did("added", `Day card “${day.title}”: ${longDate(day.date)}${day.repeat === "yearly" ? " (every year)" : ""}`);
        return `Saved day card ${day.id}: “${day.title}” on ${longDate(day.date)}${day.repeat === "yearly" ? ", every year" : ""}.`;
      },
    }),
    betaZodTool({
      name: "calendar_update_day",
      description: "Change a day card (find its id with calendar_list first). Only send the fields that change.",
      inputSchema: z.object({
        id: z.string(),
        date: DATE.optional(),
        title: z.string().max(80).optional(),
        preset: z.enum(PRESETS).optional(),
        aesthetic: z.enum(AESTHETICS).optional(),
        theme: z.enum(THEMES).optional(),
        info: z.string().max(4000).optional(),
        location: z.string().max(120).optional(),
        tags: z.array(z.string().max(30)).max(12).optional(),
        repeats_yearly: z.boolean().optional(),
      }),
      run: async ({ id, repeats_yearly, ...rest }) => {
        const day = updateDay(id, { ...rest, ...(repeats_yearly === undefined ? {} : { repeat: repeats_yearly ? "yearly" : "none" }) });
        did("changed", `Changed day card “${day.title}”: ${longDate(day.date)}`);
        return `Updated day card “${day.title}” on ${longDate(day.date)}.`;
      },
    }),
    betaZodTool({
      name: "calendar_delete_day",
      description: "Remove a day card (find its id with calendar_list first).",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const day = removeDay(id);
        did("removed", `Removed day card “${day.title}” (${longDate(day.date)})`);
        return `Removed day card “${day.title}”.`;
      },
    }),
    betaZodTool({
      name: "studio_bookings",
      description: "Read the studio's Acuity appointments between two dates (read-only; opens Acuity's admin pages in the background browser, so it takes a little while). Keep ranges short (up to about a month).",
      inputSchema: z.object({ from: DATE, to: DATE }),
      run: async ({ from, to }) => {
        did("looked", `Looked at Acuity bookings, ${longDate(from)} – ${longDate(to)}`);
        try {
          return describeAppointments(await listTask(from, to));
        } catch (error) {
          return `Couldn't read Acuity just now: ${(error as Error).message}`;
        }
      },
    }),
    betaZodTool({
      name: "check_acuity_login",
      description: "Check Nova Agent is still logged in to Acuity's admin pages.",
      inputSchema: z.object({}),
      run: async () => {
        did("looked", "Checked the Acuity login");
        try {
          return await checkLogin();
        } catch (error) {
          return `Login check failed: ${(error as Error).message}`;
        }
      },
    }),
    betaZodTool({
      name: "agent_status",
      description: "How Nova Agent is doing: its mode, whether it's connected to Nova Bot, and what it did recently.",
      inputSchema: z.object({}),
      run: async () => {
        const cal = readCalendar();
        const recent = getRecentEvents()
          .filter((e) => e.part === "task" || e.part === "input")
          .slice(-8)
          .map((e) => `${e.time} ${e.level}: ${e.message}`);
        return JSON.stringify({
          mode: config.dryRun ? "rehearsal (DRY_RUN on: never clicks final confirm buttons)" : "live",
          connected_to_nova_bot: Boolean(config.agentNovaKey),
          browser: config.headless ? "hidden" : "visible",
          model: config.novaModel || DEFAULT_MODEL,
          calendar: { note_cards: cal.notes.length, day_cards: cal.days.length },
          recent_activity: recent,
        });
      },
    }),
  ];
}

const hm = (stamp: string) => (stamp.length > 16 ? stamp.slice(11, 19) : stamp.slice(11, 16));
const questLine = (q: Quest) =>
  `${q.id.slice(0, 8)} · ${q.title} · ${q.start ? `${longDate(q.start.slice(0, 10))} ${hm(q.start)}–${hm(q.end)}` : "not scheduled"} · ${describeLength(q)}${q.ongoing ? ` · ${q.sessions} sessions done` : ""} · ${q.priority}${q.deadline ? ` · due ${q.deadline.replace("T", " ")}` : ""}${q.location ? ` · at ${q.location} (+${q.travelMinutes} min travel)` : ""} · ${q.status}${q.atRisk ? " · AT RISK" : ""}`;

function questTools(actions: ChatAction[]) {
  const did = (kind: ChatAction["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${text}`);
  };
  const STAMP_OR_EMPTY = z.string().describe('"YYYY-MM-DDTHH:MM" (UK time, ":SS" seconds allowed), or "" for none');
  // Any length, from a second up: give it in whichever units fit (they're added together)
  const LENGTH = {
    seconds: z.number().min(0).optional(),
    minutes: z.number().min(0).optional(),
    hours: z.number().min(0).optional(),
    days: z.number().min(0).optional().describe("Days of work time (24 h each); long work is split into sessions automatically"),
    ongoing: z.boolean().optional().describe("Never finishes: a session (of the length given) every day, weekday or week until it's ended"),
    every: z.enum(EVERY).optional().describe('"interval" repeats every every_minutes (e.g. drink water every 30 minutes); set deadline to stop it then'),
    every_minutes: z.number().positive().optional().describe("For every = interval: minutes between session starts (fractions for seconds)"),
  };
  const totalMinutes = (i: { seconds?: number; minutes?: number; hours?: number; days?: number }) => {
    const t = (i.seconds ?? 0) / 60 + (i.minutes ?? 0) + (i.hours ?? 0) * 60 + (i.days ?? 0) * 1440;
    return t > 0 ? t : undefined;
  };
  return [
    betaZodTool({
      name: "mission_create",
      description: "Create a Nova Mission from what the person wants to achieve: it's broken into Nova Quests and scheduled straight away. Pass their goal in their own words, with any constraints they mentioned.",
      inputSchema: z.object({ request: z.string().min(3), deadline: z.string().optional().describe('The mission deadline if they gave one: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"') }),
      run: async ({ request, deadline }) => {
        const r = await createMission(request, { deadline });
        did("added", `Nova Mission “${r.mission.title}”: ${r.quests.length} quests planned`);
        return `Created mission ${r.mission.id.slice(0, 8)} “${r.mission.title}” (${r.mission.summary}). ${r.quests.length} quests, ${r.atRisk} at risk:\n${r.quests.sort((a, b) => (a.start || "z").localeCompare(b.start || "z")).map(questLine).join("\n")}${r.unplaced.length ? `\nCouldn't place: ${r.unplaced.join("; ")}` : ""}`;
      },
    }),
    betaZodTool({
      name: "what_now",
      description: "The quest happening now, the next few, anything overdue or unplanned, and missions at risk. Use it for 'what should I do now?' and before giving advice on priorities.",
      inputSchema: z.object({}),
      run: async () => {
        const st = questState();
        return JSON.stringify({
          now: st.now,
          current: st.current ? questLine(st.current) : null,
          next: st.next.map(questLine),
          overdue: st.overdue.map(questLine),
          unplanned: st.unplanned.map(questLine),
          missions: st.missions.filter((m) => m.status === "active").map((m) => `${m.id.slice(0, 8)} · ${m.title}${m.deadline ? ` · due ${m.deadline}` : ""} · ${m.progress.done}/${m.progress.total} done · ${m.progress.atRisk} at risk · ${Math.round(m.progress.minutesLeft / 60)} h left`),
        });
      },
    }),
    betaZodTool({
      name: "quests_list",
      description: "Quests scheduled between two dates, or all quests of one mission. Use it to find a quest's id.",
      inputSchema: z.object({ from: DATE.optional(), to: DATE.optional(), mission_id: z.string().optional() }),
      run: async ({ from, to, mission_id }) => {
        const qs = readQuests().quests.filter((q) => (mission_id ? q.missionId.startsWith(mission_id) : true) && (from ? q.start.slice(0, 10) >= from : true) && (to ? q.start && q.start.slice(0, 10) <= to : true));
        return qs.length ? qs.sort((a, b) => (a.start || "z").localeCompare(b.start || "z")).map(questLine).join("\n") : "No quests found.";
      },
    }),
    betaZodTool({
      name: "quest_add",
      description: "Add a single Nova Quest (optionally to a mission). It's scheduled automatically unless fixed_start pins it.",
      inputSchema: z.object({
        title: z.string().min(1),
        ...LENGTH,
        mission_id: z.string().optional(),
        priority: z.enum(PRIORITIES).optional(),
        deadline: STAMP_OR_EMPTY.optional(),
        fixed_start: STAMP_OR_EMPTY.optional(),
        location: z.string().optional(),
        travel_minutes: z.number().int().min(0).max(300).optional(),
        time_of_day: z.enum(TIMES_OF_DAY).optional(),
        notes: z.string().optional(),
      }),
      run: async (i) => {
        const missionId = i.mission_id ? readQuests().missions.find((m) => m.id.startsWith(i.mission_id!))?.id ?? "" : "";
        const q = addQuest({ title: i.title, minutes: totalMinutes(i) ?? 60, ongoing: i.ongoing, every: i.every, everyMinutes: i.every_minutes, missionId, priority: i.priority, deadline: i.deadline, fixedStart: i.fixed_start, location: i.location, travelMinutes: i.travel_minutes, timeOfDay: i.time_of_day, notes: i.notes });
        did("added", `Quest “${q.title}”${q.start ? `: ${longDate(q.start.slice(0, 10))} ${hm(q.start)}` : ""}`);
        return `Added: ${questLine(q)}`;
      },
    }),
    betaZodTool({
      name: "quest_update",
      description: "Change a quest: its length, priority, deadline, location/travel, preferred time of day, notes, or pin it to a time with fixed_start (\"\" unpins it so the planner chooses). Everything re-plans.",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        ...LENGTH,
        priority: z.enum(PRIORITIES).optional(),
        deadline: STAMP_OR_EMPTY.optional(),
        fixed_start: STAMP_OR_EMPTY.optional(),
        location: z.string().optional(),
        travel_minutes: z.number().int().min(0).max(300).optional(),
        time_of_day: z.enum(TIMES_OF_DAY).optional(),
        notes: z.string().optional(),
      }),
      run: async ({ id, fixed_start, travel_minutes, time_of_day, seconds, minutes, hours, days, every_minutes, ...rest }) => {
        const q = updateQuest(id, { ...rest, everyMinutes: every_minutes, minutes: totalMinutes({ seconds, minutes, hours, days }), fixedStart: fixed_start, travelMinutes: travel_minutes, timeOfDay: time_of_day });
        did("changed", `Quest “${q.title}”${q.start ? `: now ${longDate(q.start.slice(0, 10))} ${hm(q.start)}` : ""}`);
        return `Updated: ${questLine(q)}`;
      },
    }),
    betaZodTool({
      name: "quest_status",
      description: "Mark a quest done, started (doing), skipped, or back to to-do; or remove it entirely. For an ongoing quest, done finishes this session and lines up the next; finish ends the ongoing quest for good.",
      inputSchema: z.object({ id: z.string(), status: z.enum(["done", "doing", "skipped", "todo", "remove", "finish"]) }),
      run: async ({ id, status }) => {
        if (status === "remove") {
          const q = removeQuest(id);
          did("removed", `Removed quest “${q.title}”`);
          return `Removed “${q.title}”.`;
        }
        const q = status === "finish" ? setQuestStatus(id, "done", true) : setQuestStatus(id, status);
        did("changed", `${status === "finish" ? "Ended" : status === "done" ? (q.ongoing ? "Session done" : "Done") : status === "doing" ? "Started" : status === "skipped" ? "Skipped" : "Reopened"}: “${q.title}”`);
        return `${q.title}: ${q.status}.`;
      },
    }),
    betaZodTool({
      name: "quest_snooze",
      description: "Not now: push a quest back by some minutes (if it's under way, gives it more time instead).",
      inputSchema: z.object({ id: z.string(), minutes: z.number().int().min(5).max(1440) }),
      run: async ({ id, minutes }) => {
        const q = snoozeQuest(id, minutes);
        did("changed", `Snoozed “${q.title}”${q.start ? ` to ${hm(q.start)}` : ""}`);
        return `Snoozed: ${questLine(q)}`;
      },
    }),
    betaZodTool({
      name: "block_time",
      description: "Block out time that's taken (plans changed, out for the evening, ill, appointment): quests move out of the way. Or remove a block by id.",
      inputSchema: z.object({ start: STAMP.optional(), end: STAMP.optional(), reason: z.string().optional(), remove_id: z.string().optional() }),
      run: async ({ start, end, reason, remove_id }) => {
        if (remove_id) {
          const b = removeBlock(remove_id);
          did("removed", `Unblocked ${b.reason}`);
          return `Removed the block “${b.reason}”.`;
        }
        if (!start || !end) return "Give a start and end time.";
        const b = addBlock(start, end, reason || "Busy");
        did("added", `Blocked ${longDate(start.slice(0, 10))} ${hm(start)}–${hm(end)}: ${b.reason}`);
        return `Blocked ${b.start}–${b.end} (${b.reason}), id ${b.id.slice(0, 8)}. Quests have moved around it.`;
      },
    }),
    betaZodTool({
      name: "mission_update",
      description: "Rename a mission, change its deadline, pause or resume it, mark it done, or remove it (with its quests).",
      inputSchema: z.object({ id: z.string(), title: z.string().optional(), deadline: z.string().optional(), status: z.enum(["active", "paused", "done"]).optional(), remove: z.boolean().optional() }),
      run: async ({ id, remove, ...changes }) => {
        if (remove) {
          const m = removeMission(id);
          did("removed", `Removed mission “${m.title}”`);
          return `Removed “${m.title}” and its quests.`;
        }
        const m = updateMission(id, changes);
        did("changed", `Mission “${m.title}”: ${m.status}`);
        return `Updated mission “${m.title}”.`;
      },
    }),
    betaZodTool({
      name: "rhythm_set",
      description: "Change the daily rhythm the planner works to. Only send what changes.",
      inputSchema: z.object({
        wake: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        sleep: z.string().regex(/^\d{2}:\d{2}$/).optional(),
        wind_down_minutes: z.number().int().optional(),
        start_up_minutes: z.number().int().optional(),
        buffer_minutes: z.number().int().optional(),
        break_after_minutes: z.number().int().optional(),
        break_minutes: z.number().int().optional(),
        max_quest_hours_per_day: z.number().int().optional(),
        home_base: z.string().optional(),
        remind_minutes_before: z.number().int().optional(),
        check_ins: z.boolean().optional(),
        daily_briefing: z.boolean().optional(),
        phone_push: z.boolean().optional().describe("Also send reminders to the Nova Hub phones"),
      }),
      run: async (i) => {
        const r = setRhythm({ wake: i.wake, sleep: i.sleep, windDownMinutes: i.wind_down_minutes, startUpMinutes: i.start_up_minutes, bufferMinutes: i.buffer_minutes, breakAfterMinutes: i.break_after_minutes, breakMinutes: i.break_minutes, maxQuestHoursPerDay: i.max_quest_hours_per_day, homeBase: i.home_base, remindMinutesBefore: i.remind_minutes_before, checkIns: i.check_ins, dailyBriefing: i.daily_briefing, phonePush: i.phone_push });
        did("changed", `Rhythm: up ${r.wake}, sleep ${r.sleep}`);
        return `Rhythm now: ${JSON.stringify(r)}. Everything has been re-planned.`;
      },
    }),
    betaZodTool({
      name: "replan",
      description: "Re-plan everything from now (after big changes, or when asked to optimise the schedule).",
      inputSchema: z.object({}),
      run: async () => {
        const r = replan();
        did("changed", "Re-planned every quest");
        return `Re-planned. ${r.atRisk} quest(s) at risk.${r.unplaced.length ? ` Couldn't place: ${r.unplaced.map((u) => `${u.title} (${u.why})`).join("; ")}` : ""}`;
      },
    }),
  ];
}

// One chat turn: the conversation so far in, Nova Agent's reply (and what it did) out
export async function chat(history: ChatTurn[]): Promise<{ reply: string; actions: ChatAction[] }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  // The conversation must start with the person, and end with them
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("Nothing to answer.");

  const actions: ChatAction[] = [];
  const model = config.novaModel || DEFAULT_MODEL;
  trace("llm", "start", `Chat: asking ${model}`);
  const final = await getClient().beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    system: systemPrompt(),
    tools: [...tools(actions), ...questTools(actions)],
    messages,
    output_config: { effort: "low" },
    max_iterations: 16,
    // If this model declines a request, the API retries it on a suitable fallback model inside the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (final.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that one.", actions };
  }
  const reply = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  trace("llm", "ok", `Chat: answered (${final.usage.output_tokens} tokens)`);
  return { reply: reply || (actions.length ? "Done ✦" : "I'm not sure what to say to that."), actions };
}
