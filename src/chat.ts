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
    tools: tools(actions),
    messages,
    output_config: { effort: "low" },
    max_iterations: 12,
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
