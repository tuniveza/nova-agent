// Talking to Nova Agent.
//
// The chat page (src/visualizer/chat.html) sends the conversation here. Claude
// answers as Nova Agent, with tools to:
//   - read, add, change and remove Calendar note cards and day cards
//     (calendar/store.ts; the calendar on the page refreshes when it changes)
//   - look at the studio's bookings (Nova Bot's own booking system, through its bookings feed:
//     studio-bookings.ts), read-only
//   - look up the studio's clients (clients.ts, read-only): find one, their session history, who
//     owes money, who hasn't booked since a date
//   - email campaigns to opted-in fans and clients (campaigns.ts): suggest ideas, DRAFT and edit
//     them, read how sent ones did. It can't send, schedule or approve: an admin approves each
//     campaign (Approve, in Portal → Campaigns or on the campaign's card) before anything goes
//   - plan any goal straight into Quests (and Calendar), change them as plans change,
//     and run the quests day to day
//   - research the internet (web search and web fetch, run by Anthropic) and
//     look at any public webpage in a browser of its own (web.ts): a
//     screenshot and the page's text, so it sees the page as a person would
//   - write files for you (Markdown, text, CSV, JSON, HTML) to preview, download
//     or open in Notes, and read them back (files.ts)
//   - the studio's money (money.ts): read the totals and invoices, WRITE and edit invoices (an admin
//     approves each one in Portal → Money before it's emailed) and note expenses (unconfirmed until
//     a person confirms them). It can't send, remind, record payments, void or change settings
//   - read the studio's enquiries and DRAFT replies to them (enquiries.ts). It can't send:
//     a person approves each draft (Approve & send, in Portal or on the draft's card)
//   - say how Nova Agent itself is doing
// The SDK's tool runner does the back-and-forth with Claude.

import { todayCalendar } from "./calendar/today";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addDay, addNote, AESTHETICS, listRange, PRESETS, readCalendar, removeDay, removeNote, THEMES, updateDay, updateNote } from "./calendar/store";
import { EVENT_EXTRAS, extrasInWords, extrasToNote } from "./calendar/chatFields";
import { config } from "./config";
import { getClient } from "./llm";
import { learnFrom, memoryFor } from "./memory";
import { getRecentEvents, trace } from "./trace";
import { lookAt, lookResult, webTools } from "./web";
import { fileCard, FILE_TYPES, findFile, listFiles, readFileText, removeFile, saveFile, sizeText } from "./files";
import { draftReply, listEnquiries, readEnquiry, savedReplies, sortEnquiry, threadText, type DraftCard } from "./enquiries";
import { bookingsText, listStudioBookings } from "./studio-bookings";
import { commentLine, contextText as socialContextText, createSocialDraft, draftCommentReply, editSocialDraft, listSocialComments, listSocialPosts, PLATFORMS, postLine, postStatsText, POST_STATUSES, readSocialPost, socialContext } from "./social";
import { AUDIENCES, campaignContext, campaignLine, CAMPAIGN_STATUSES, contextText, createDraft, editDraft, listCampaigns, readCampaign, resultsText, ukToUtc, type Audiences, type CampaignCard, type CampaignChanges } from "./campaigns";
import { draftOutreach, editOutreach, listOutreach, outreachLine, OUTREACH_STATUSES, type Outreach, type OutreachFields } from "./outreach";
import { MONEY_PROMPT, moneyTools } from "./money";
import { tidyTools } from "./tidy-agent";
import { GOOGLE_PROMPT, googleTools } from "./google-agent";
import { clientHistory, clientsLapsed, clientsOwing, clientsText, findClients as findStudioClients, historyText, lapsedText, MONTH_NAMES, owingText, sinceDate } from "./clients";
import { addBlock, addQuest, questState, removeBlock, removeQuest, setQuestStatus, setRhythm, snoozeQuest, updateQuest } from "./quests/actions";
import { replan } from "./quests/plan";
import { describeLength } from "./quests/lengths";
import { isPulse } from "./quests/pulses";
import { EVERY, MODES, MODE_NAMES, PRIORITIES, readQuests, rhythmFor, TIMES_OF_DAY, WEEKDAYS, type Quest } from "./quests/store";
import { mayChange } from "./quests/actions";
import { localPerson, ownerOf, ownerToSave, personName, type Person } from "./person";
import { pcOwnerId } from "./staff";
import { currentMusic } from "./quests/plan";

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_HISTORY = 40;
const MAX_CONTINUATIONS = 5;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
export interface ChatAction {
  kind: "added" | "changed" | "removed" | "looked" | "file" | "draft" | "booking" | "campaign" | "outreach" | "social";
  text: string;
  file?: ReturnType<typeof fileCard>; // for "file": the card to preview and download it
  draft?: DraftCard; // for "draft": a reply to an enquiry, waiting for a person's Approve & send
  booking?: Record<string, unknown>; // for "booking": a booking change proposed in an older chat (Agent no longer proposes them)
  campaign?: CampaignCard; // for "campaign": an email campaign draft, waiting for an admin's Approve
  outreach?: Outreach; // for "outreach": a one-to-one email, waiting for an admin's Approve
  url?: string; // for "social": where it is in Portal → Social
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

// Who you're talking to, for the system prompt
export function personPrompt(person: Person): string {
  const role = person.role === "admin" ? "an admin" : "a member of staff";
  const where = person.online ? "signed in to Portal, using Nova Agent online" : "on the studio computer (Nova Agent works for them here)";
  return `You're talking to ${person.name} (${role} at the studio, staff id ${person.id}), ${where}. Address them by name now and then, and act as them: quests, blocked times, the rhythm and reminders you set up are theirs (reminders go to their phones), and "my", "me" and "I" mean ${person.name}. Your quest tools show their own${person.everyone ? "; they can also see everyone's (pass everyone: true to quests_list), but change someone else's only when they clearly ask to" : ""}. This conversation is theirs alone: other people have their own.`;
}

export function systemPrompt(person: Person = localPerson()): string {
  const now = nowInUk();
  return `You are Nova Agent, the one app for Novacane Studios (a recording studio in Forest Hill, London). You run on the studio computer. People from the studio chat with you here.

${personPrompt(person)}

You help with anything they want to get done: inside Nova Agent and the studio, and just as much outside it, in their music careers, releases, content and socials, business, health, study and everyday life. Think and advise like an expert in whatever they bring you, and turn it into a plan they can follow.

It is ${now.words}, ${now.time} (UK time). Today's date is ${now.date}.

You also run Quests, a smart planner for the people you talk to:
- A big goal is planned straight into Quests, by you. For any goal with several parts, or anything that asks for a schedule, a strategy or a plan (e.g. "release the EP by 1 December", "catch up on my 52-release challenge by the end of the year"), work out the steps and add each one with quest_add straight away: concrete tasks with realistic lengths, priorities and deadlines worked back from theirs (repeated work, like the same steps for every song, written out exactly, one quest each), with locations and travel where it matters. Work out the deadline from what they said ("the end of the year" is 31 December; "two months" is from today). The quests are scheduled around everything else by themselves and show in Calendar; something at a set time (a session, a gig) gets fixed_start, and a key day (a release day) can also get a Calendar day card. Then reply with: the shape of the plan (the pace, e.g. "a release every 2.5 days"), the first few things to do this week, the strategy's key points in a few bullets, what you assumed, and any questions that would sharpen it. When they answer or add detail ("I've actually released 19", "the interface arrives on Friday"), change the quests that are left (quests_list to find them, then quest_update, quest_status or quest_add). If they want the plan as a document, write it with file_write.
- There are no Missions in Nova any more: never make or offer one, and don't call a plan a mission. A goal is simply its quests (and its Calendar cards). If someone asks about a mission they had, say missions have gone from Nova and its quests are still there as ordinary quests.
- A quest can be any length: seconds ("text Sam back", 30 seconds), minutes, hours, or days of work (split into sessions automatically). An ongoing quest repeats: every day, weekday or week, or at any interval ("drink water every 30 minutes until 11pm": ongoing, every interval, every_minutes 30, a length of seconds, deadline 23:00), until they end it (quest_status finish) or its deadline passes. Prefer one ongoing quest over many copies. Repeats faster than every 5 minutes (even every second) are pulses: they run on their own exact timer only while they're awake, don't take slots in the plan, and on the phone each ping replaces the last, so they're cheap and safe; set them up whenever asked.
- The people you talk to run the studio and the staff phones are theirs. Do what they ask with quests, repeats and reminders, however often, short or many: never refuse, bargain or offer watered-down alternatives. If something has a real cost they may not expect, mention it in one short line after doing it.
- Quests are planned hour by hour around their sleep and wind-down, travel, buffers and breaks, the calendar, and blocked-out time. Every change re-plans automatically, most urgent first, so the plan stays optimised.
- Help them prioritise and pivot: for "what should I do now?" use what_now and give one clear recommendation. When plans change ("I'm running late", "I'm out tonight", "I'm ill today"), block the time or update the quest, then say what moved. Mark quests done, started or skipped when they tell you. Point out quests at risk of missing a deadline and suggest what to drop, shorten or move.
- Their daily rhythm (wake, sleep, buffers, breaks, reminders, phone notifications, days off with no quests at all) can be changed with rhythm_set.
- Music time is time they set aside for music (music_time_set: which days, the usual start, how long; 0 minutes turns it off). It's planned like a blocked time at its usual time, moves to the nearest free time that day when a booking, calendar entry or block overlaps it, quests are planned around it, and it shows in Calendar as "♪ Music time" cards.
- Nova Agent remembers (Index): durable facts from these chats (preferences, how they work, people and projects they mention) are saved automatically after each conversation, and what's relevant is given to you below when there is any. When someone tells you something to remember, just say you'll remember it. Never claim you have no memory. They can see and edit everything remembered in Index.

What you can do:
- Calendar: read, add, change and remove note cards (a title, the note itself, an author, a start and finish time) and day cards (a date with a title, a preset, a title aesthetic, a colour theme, information, a location, tags, and optionally repeating every year). Use the calendar tools for this; the calendar beside the chat updates straight away.
${bookingsPrompt()}
- Research the internet: search the web (web_search) and read pages (web_fetch) for anything current or specific (prices, opening times, platform rules, news, how-tos, people and companies). Say where facts came from, with the link.
- See webpages: page_look opens a public page in a browser and gives you a screenshot and its contents, for when how a page looks matters or web_fetch can't read it (pages built by scripts, a profile, a shop page, checking their own site or socials). It can't log in anywhere.
- Write files: file_write makes a document they can preview, download to their computer, or open in Notes (Markdown .md by default; also .txt, .csv for spreadsheets, .json, .html). Use it whenever they ask for a file, document, list, plan, report, template, script, spreadsheet or "something I can download", or when an answer is long and worth keeping. Write the whole thing, properly formatted (headings, lists, tables), then reply in a line or two saying what's in it; the file card with Preview and Download appears under your reply, so don't paste the file into the chat too. To change a file, read it (file_read), then file_write with its id. file_list shows what's there.
- Enquiries: read the studio's enquiries from customers (enquiry_list, enquiry_read), sort them in the inbox (enquiry_set_state: new, open, waiting, done, or spam for junk; it only sorts, never sends), read the team's saved replies to routine questions (saved_replies_list: use their facts and wording for prices, opening times, how to book), and draft a reply to one (enquiry_draft_reply). You can only ever draft: you can't send, approve or email anyone, and nothing goes to a customer until a person from the studio reads your draft and presses Approve & send (on the card under your reply, or in Portal). Say that plainly when you draft ("Here's a draft for you to check; it goes when you approve it"), never that you've replied or sent anything. Read the enquiry and its conversation first, write the whole email in a warm, plain UK English voice signed "Novacane Studios" (the footer about why they're getting it and how to stop is added automatically), and only promise what the studio has said it can do. Never draft for someone marked do-not-contact.
- The studio's clients (read-only): client_find (by name, email or phone), client_history (one client's sessions), clients_owing (who owes money, biggest first), clients_not_booked_since (who hasn't booked since a date: for "since July" pass month "July", which means 1 July of the most recent July; for "in the last 3 months" pass months_back 3). Say money in pounds (£120.00) and dates in UK time, as the tools give them. These are the list in Portal → Clients, where staff edit contact details, notes, money and marketing consent; you can't change anything there. Marketing consent is "no" unless it's been recorded with a date and a source: never suggest sending marketing to someone marked "marketing: no".
- Email campaigns (newsletters to the studio's fans and clients, sent by the studio's own mail server): suggest_campaign (who's opted in, how recent ones did; then you suggest 1–3 ideas, and nothing is saved), create_campaign_draft, edit_campaign_draft, campaign_results (how a sent one did: opened and clicked as percentages), list_campaigns. You can only draft and edit: you can't send, schedule or approve a campaign, and nobody can through you. Nothing is sent to anyone until an admin presses Approve in Portal → Campaigns (or on the card under your reply). Say that plainly every time you draft or change one ("It's saved as a draft: nothing is sent until an admin approves it in Portal → Campaigns"), and never say a campaign is sent or scheduled unless campaign_results or list_campaigns shows it. Only people who opted in get campaigns (confirmed fans, and clients who said yes to studio news); Nova Bot adds the footer saying who it's from, why they're getting it and how to unsubscribe, so don't write one. Write in warm, plain UK English: a short subject line, short paragraphs separated by blank lines, **bold** for the one thing that matters, full links (https://…), signed "Novacane Studios". Give a send time (UK) when one is asked for or matters; otherwise it goes as soon as it's approved.
- One-to-one emails (a personal email to one person: a venue, label, brand, promoter, journalist or other business; a studio client; or someone who wrote to the studio): draft_outreach_email, edit_outreach_email, list_outreach_emails. Personalise it: look them up first when it helps (client_find and client_history for a client; web_search, web_fetch or page_look for a business, to get the right person, address and something specific to say). You can only draft and edit: nothing is sent until an admin presses Approve in Portal → Campaigns (One-to-one emails); say that plainly every time ("It's a draft: nothing goes until an admin approves it"). Who can be emailed is checked by Nova Bot (UK law): a business only at a work address (not Gmail, Hotmail and the like), a client only about their own booking unless they said yes to studio news, a reply only to someone who wrote in, and never anyone who said no. If it refuses, tell them why in a line. Nova Bot adds the footer (who it's from, why, and how to stop these emails), so don't write one. Short, warm, plain UK English, one clear ask, signed "Novacane Studios".
- Social posts (Facebook, Instagram and YouTube, posted by Nova Bot): social_context (what's connected, followers, how recent posts did, comments waiting; then suggest 1–3 ideas, nothing is saved), create_social_draft, edit_social_draft, list_social_posts, social_results (how a posted one did), list_social_comments and draft_comment_reply (a reply to a comment on the studio's posts). You can only draft and edit: you can't post, schedule or approve anything, and nobody can through you. Nothing goes on Facebook, Instagram or YouTube until an admin presses Approve in Portal → Social; say that plainly every time ("It's saved as a draft: nothing is posted until an admin approves it in Portal → Social"), and never say a post is up unless list_social_posts or social_results shows it posted. You can't add pictures or videos: say which picture or video would suit it, and that someone adds it in Portal → Social (Instagram posts need one before they can be approved; a YouTube post is exactly one video, its first line the video's title, and "#Shorts" in the words makes it a Short). Write in the studio's voice: warm, plain UK English, a strong first line, a few relevant hashtags at the end (Instagram allows 30 at most and 2,200 characters), no hashtag walls. For trends, hashtags and what other studios do, research with web_search first and say where it came from. Paid ads stay in Meta's Ads Manager (the link is in Portal → Social): never offer to run or pay for ads.
${MONEY_PROMPT}
${GOOGLE_PROMPT}
- Test stuff: test_stuff_list shows what looks like tests or copies, and why (read only). Deleting is for an admin in Portal → Test stuff.
- Say how you're doing (agent_status).

How to work:
- Work out dates from what people say ("next Friday", "tomorrow at 2", "Halloween") using today's date above, and say the exact date you used.
- When asked to add or change something, just do it with the tool, then confirm in one short line with the day and date. If something important is missing (like the time for a note card), make a sensible choice and say what you chose; only ask if you really can't tell.
- Before removing anything, make sure you have the right one (look it up first). Removing is fine when someone asks.
- Note cards are for things at a time; day cards are for a whole day (birthdays, release days, seasonal days, trips).
- Day card presets: ${PRESETS.join(", ")}. Aesthetics: ${AESTHETICS.join(", ")}. Themes: ${THEMES.join(", ")} ("app" follows the calendar's own theme).
- Keep replies short and warm, in UK English. Use simple Markdown (bold, short lists) when it helps. Never invent bookings or calendar entries: only report what the tools return.`;
}

// What Agent can do with the studio's bookings, for the system prompt
function bookingsPrompt(): string {
  return "- The studio's bookings (Nova Bot's own booking system: customers book and pay a deposit on the /book page, and each booking is on the studio's Google Calendar): what's booked between two dates (studio_bookings: time, session type and client). Bookings also count as busy time in the quest plan. This is read-only: you can't book, move or cancel a booking from this chat. If someone wants to book, give them the booking page (/book on Nova Bot's site). To change or cancel one, staff do it in Portal (Portal → Calendar shows every booking, and NovaBot in Portal's chat can find a booking and check a change), or in the studio's Google Calendar.";
}

// The studio's bookings, read-only (studio-bookings.ts: Nova Bot's bookings feed). Nothing here
// can book, change, cancel or approve anything.
export function studioTools(actions: ChatAction[]) {
  const did = (kind: ChatAction["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${text}`);
  };
  return [
    betaZodTool({
      name: "studio_bookings",
      description: "Read the studio's bookings between two UK dates (inclusive, up to 62 days): time (UK), session type and client. Read-only.",
      inputSchema: z.object({ from: DATE, to: DATE }),
      run: async ({ from, to }) => {
        did("looked", `Looked at the studio's bookings, ${longDate(from)} – ${longDate(to)}`);
        try {
          return bookingsText(await listStudioBookings(from, to));
        } catch (error) {
          return `Couldn't read the studio's bookings just now: ${(error as Error).message}`;
        }
      },
    }),
  ];
}

function tools(actions: ChatAction[], person: Person = localPerson()) {
  const did = (kind: ChatAction["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${text}`);
  };
  return [
    betaZodTool({
      name: "calendar_list",
      description: "List the note cards and day cards in Calendar between two dates (inclusive). Use it to answer \"what's on\" questions and to find an item's id before changing or removing it.",
      inputSchema: z.object({ from: DATE, to: DATE }),
      run: async ({ from, to }) => {
        const { notes, days } = listRange(from, to);
        if (!notes.length && !days.length) return `Nothing in the calendar from ${from} to ${to}.`;
        return JSON.stringify({
          day_cards: days.map((d) => ({ id: d.id, date: d.date, title: d.title, preset: d.preset, repeats_yearly: d.repeat === "yearly", info: d.info, location: d.location, tags: d.tags })),
          note_cards: notes.map((n) => ({ id: n.id, title: n.title, note: n.body, author: n.author, start: n.start, end: n.end, details: extrasInWords(n) || undefined })),
        });
      },
    }),
    betaZodTool({
      name: "calendar_add_note",
      description: "Add a note card to Calendar.",
      inputSchema: z.object({
        title: z.string().min(1).max(120),
        note: z.string().max(5000).optional().describe("The note itself"),
        start: STAMP,
        end: STAMP.optional().describe("When it finishes (defaults to one hour after the start)"),
        author: z.string().max(60).optional().describe("Who it's from (defaults to the person you're talking to)"),
        ...EVENT_EXTRAS,
      }),
      run: async ({ title, note, start, end, author = person.name.slice(0, 60), ...extras }) => {
        const finish = end ?? (() => {
          const d = new Date(`${start}:00Z`);
          d.setUTCHours(d.getUTCHours() + 1);
          return d.toISOString().slice(0, 16);
        })();
        const card = addNote({ title, body: note, start, end: finish, author, ...extrasToNote(extras) });
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
        ...EVENT_EXTRAS,
      }),
      run: async ({ id, note, location, all_day, color, repeat, remind_minutes_before, ...rest }) => {
        const card = updateNote(id, { ...rest, body: note, ...extrasToNote({ location, all_day, color, repeat, remind_minutes_before }) });
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
      description: "Add a day card to Calendar (one per date; adding to a date that already has one updates it).",
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
    // The studio's bookings (read-only)
    ...studioTools(actions),
    betaZodTool({
      name: "page_look",
      description: "Open a public webpage in a browser and see it: returns a screenshot of the top of the page and the page's contents (headings, links, buttons, text). Use it when how a page looks matters, or web_fetch can't read a page. Can't log in or open local addresses.",
      inputSchema: z.object({ url: z.string().url().describe("The full address, https://…") }),
      run: async ({ url }) => {
        try {
          const look = await lookAt(url);
          did("looked", `Looked at ${look.title || look.url}`);
          return lookResult(look);
        } catch (error) {
          return `Couldn't open that page: ${(error as Error).message}`;
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
          mode: "live",
          connected_to_nova_bot: Boolean(config.agentNovaKey),
          model: config.novaModel || DEFAULT_MODEL,
          calendar: { note_cards: cal.notes.length, day_cards: cal.days.length },
          recent_activity: recent,
        });
      },
    }),
  ];
}

const hm = (stamp: string) => (stamp.length > 16 ? stamp.slice(11, 19) : stamp.slice(11, 16));
// "Saturday 10 October 2026 19:00–21:00 (moved from 18:00)"
const musicLine = (m: ReturnType<typeof currentMusic>[number]) => `${longDate(m.day)} ${hm(m.start)}–${hm(m.end)}${m.moved ? ` (moved from ${hm(m.usual)})` : ""}`;
const questLine = (q: Quest) =>
  `${q.id.slice(0, 8)} · ${q.title}${q.track ? ` [${q.track}]` : ""} · ${q.start ? `${longDate(q.start.slice(0, 10))} ${hm(q.start)}–${hm(q.end)}` : isPulse(q) ? `pulse (own timer${q.deadline ? `, until ${hm(q.deadline)}` : ""})` : "not scheduled"} · ${describeLength(q)}${q.ongoing ? ` · ${q.sessions} sessions done` : ""} · ${q.priority}${q.deadline ? ` · due ${q.deadline.replace("T", " ")}` : ""}${q.location ? ` · at ${q.location} (+${q.travelMinutes} min travel)` : ""} · ${q.status} · ${MODE_NAMES[q.mode] ?? q.mode}${q.from ? ` · from ${q.from}` : ""}${q.atRisk ? " · AT RISK" : ""}`;

function fileTools(actions: ChatAction[]) {
  const made = (f: ReturnType<typeof saveFile>, verb: string) => {
    actions.push({ kind: "file", text: `${verb} ${f.name}`, file: fileCard(f) });
    trace("input", "ok", `Chat: ${verb} file ${f.name} (${sizeText(f.size)})`);
  };
  return [
    betaZodTool({
      name: "file_write",
      description: `Write a file they can preview and download: a new one, or replace one by id (read it first with file_read). Types: ${FILE_TYPES.join(", ")} (from the name's ending; Markdown if none).`,
      inputSchema: z.object({
        name: z.string().min(1).max(100).describe('A short file name with its ending, e.g. "release-plan.md", "content-calendar.csv"'),
        title: z.string().max(140).optional().describe("What it is, in a few words (shown on the file card)"),
        content: z.string().min(1).describe("The whole file"),
        id: z.string().optional().describe("Only to replace an existing file: its id"),
      }),
      run: async ({ name, title, content, id }) => {
        try {
          const f = saveFile({ name, title, content, id });
          made(f, id ? "Updated" : "Wrote");
          return `Saved ${f.name} (${sizeText(f.size)}), id ${f.id.slice(0, 8)}. They can preview, download it or open it in Notes from the card under your reply.`;
        } catch (error) {
          return `Couldn't save it: ${(error as Error).message}`;
        }
      },
    }),
    betaZodTool({
      name: "file_read",
      description: "Read one of the files you've written (by id or name), to answer from it or change it.",
      inputSchema: z.object({ id: z.string().describe("Its id (the first 8 characters are enough) or its name") }),
      run: async ({ id }) => {
        const f = findFile(id);
        if (!f) return `No file called ${id}. Use file_list to see them.`;
        const text = readFileText(f);
        return `${f.name} · “${f.title}” · id ${f.id.slice(0, 8)} · ${sizeText(f.size)} · updated ${f.updated.slice(0, 16).replace("T", " ")}\n\n${text.length > 60000 ? `${text.slice(0, 60000)}\n…(the rest is cut off here)` : text}`;
      },
    }),
    betaZodTool({
      name: "file_list",
      description: "The files you've written for them, newest first.",
      inputSchema: z.object({}),
      run: async () => {
        const list = listFiles();
        return list.length ? list.slice(0, 60).map((f) => `${f.id.slice(0, 8)} · ${f.name} · “${f.title}” · ${sizeText(f.size)} · ${f.updated.slice(0, 10)}`).join("\n") : "No files yet.";
      },
    }),
    betaZodTool({
      name: "file_delete",
      description: "Delete one of the files you've written (when they ask).",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        try {
          const f = removeFile(id);
          actions.push({ kind: "removed", text: `Deleted ${f.name}` });
          return `Deleted ${f.name}.`;
        } catch (error) {
          return (error as Error).message;
        }
      },
    }),
  ];
}

// Enquiries: read them and DRAFT replies. There is no send tool, on purpose: a person approves
// every draft before it goes (Nova Bot only lets a signed-in person's press send anything).
export function enquiryTools(actions: ChatAction[]) {
  return [
    betaZodTool({
      name: "enquiry_list",
      description: "List the studio's enquiries from customers (newest first): id, who, subject, state (new, open, replied = waiting on them, closed, spam, do-not-contact), label, the start of their message, and how many drafts are waiting.",
      inputSchema: z.object({ show: z.enum(["open", "new", "all", "spam"]).optional().describe("open = new, open or waiting on them (default); new = not looked at yet; all = everything but Spam; spam = the Spam folder") }),
      run: async ({ show }) => {
        const list = await listEnquiries(show ?? "open");
        if (!list.length) return "No enquiries there.";
        noteAction(actions, "looked", `Looked at ${list.length} enquir${list.length === 1 ? "y" : "ies"}`);
        return JSON.stringify(list);
      },
    }),
    betaZodTool({
      name: "enquiry_read",
      description: "Read one enquiry in full: their details, their message, and the conversation since (replies sent, drafts waiting, team notes). Do this before drafting a reply.",
      inputSchema: z.object({ id: z.number().int().positive() }),
      run: async ({ id }) => {
        const t = await readEnquiry(id);
        noteAction(actions, "looked", `Read ${t.enquiry.name}'s enquiry`);
        return threadText(t);
      },
    }),
    betaZodTool({
      name: "enquiry_draft_reply",
      description: "Draft an email reply to an enquiry. It is NOT sent: it's saved as a draft for a person at the studio to check, edit and approve (Approve & send). Write the whole email body, greeting to sign-off.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The enquiry's id"),
        body: z.string().min(1).max(8000).describe("The email body, as it should read"),
      }),
      run: async ({ id, body }) => {
        const draft = await draftReply(id, body);
        actions.push({ kind: "draft", text: `Drafted a reply to ${draft.name}, waiting for approval`, draft });
        trace("input", "ok", `Chat: drafted a reply to enquiry #${id} (waiting for approval)`);
        return `Draft ${draft.id} saved for ${draft.name}. It has NOT been sent: it waits for someone at the studio to approve it (the card under your reply, or Portal).`;
      },
    }),
    betaZodTool({
      name: "enquiry_set_state",
      description:
        "Sort an enquiry in the studio's inbox: new, open (being worked on), waiting (replied, waiting on them), done, or spam (the Spam folder; nothing is deleted, and 'new' takes it back out). Optionally give it a short label. This only sorts: it never sends anything to anyone.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The enquiry's id"),
        state: z.enum(["new", "open", "waiting", "done", "spam"]),
        label: z.string().max(40).optional().describe("A short label, e.g. 'Mixing' or 'Price question' (empty clears it)"),
      }),
      run: async ({ id, state, label }) => {
        const e = await sortEnquiry(id, state, label);
        noteAction(actions, "changed", `Moved enquiry #${id} to ${state}`);
        trace("input", "ok", `Chat: sorted enquiry #${id} (${state})`);
        return `Enquiry #${e.id} is now ${e.status === "replied" ? "waiting on them" : e.status}${e.label ? `, labelled "${e.label}"` : ""}. Nothing was sent.`;
      },
    }),
    betaZodTool({
      name: "saved_replies_list",
      description: "The team's saved replies to routine questions (prices, opening times, how to book...). Use them as the facts and wording when drafting a reply to a routine question.",
      inputSchema: z.object({}),
      run: async () => {
        const saved = await savedReplies();
        noteAction(actions, "looked", `Looked at ${saved.length} saved repl${saved.length === 1 ? "y" : "ies"}`);
        return saved.length ? JSON.stringify(saved) : "There are no saved replies yet (staff add them in Portal → Enquiries → Saved replies).";
      },
    }),
  ];
}
// The studio's clients (Portal → Clients on Nova Bot), read-only: nothing here can change a client.
// The trace only gets ids and counts, never names or contact details.
export function clientTools(actions: ChatAction[]) {
  const failed = (error: unknown) => `Couldn't read the client list just now: ${(error as Error).message}`;
  return [
    betaZodTool({
      name: "client_find",
      description:
        "Find the studio's clients (Portal → Clients) by name, email or phone (up to 20). Each comes with their id, contact details, when they last booked and next booked (UK time), how many sessions, what they owe (in pounds), and whether they've agreed to marketing.",
      inputSchema: z.object({ search: z.string().min(2).max(100).describe("Part of a name, an email or a phone number") }),
      run: async ({ search }) => {
        try {
          const list = await findStudioClients(search);
          noteAction(actions, "looked", `Looked up clients (${list.length} found)`);
          return list.length ? clientsText(list) : `No clients matching “${search}”.`;
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "client_history",
      description: "One client's details and their whole session history (newest first, UK time, with session type, price and cancelled ones marked). Find their id with client_find first.",
      inputSchema: z.object({ id: z.number().int().positive().describe("The client's id (from client_find)") }),
      run: async ({ id }) => {
        try {
          const h = await clientHistory(id);
          noteAction(actions, "looked", `Looked at client #${id}'s sessions`);
          return historyText(h);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "clients_owing",
      description: "Who owes the studio money: every client with an outstanding amount, biggest first, in pounds, with the total. Use it for “who owes money?”, “who hasn't paid?”, “what's outstanding?”. Amounts are what staff recorded in Portal → Clients.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const list = await clientsOwing();
          noteAction(actions, "looked", `Looked at who owes money (${list.length})`);
          return owingText(list);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "clients_not_booked_since",
      description:
        "Clients who haven't booked since a day: their last session was before it, and nothing is booked on or after it. Use it for “who hasn't booked since July?” (month: July, meaning 1 July of the most recent July), “who hasn't been in for 3 months?” (months_back: 3) or a date (since). Give exactly one of since, month or months_back. Say the date it used.",
      inputSchema: z.object({
        since: DATE.optional(),
        month: z.enum(MONTH_NAMES).optional().describe("A month name: the 1st of the most recent such month (this month counts)"),
        months_back: z.number().int().min(0).max(120).optional().describe("So many months before today"),
      }),
      run: async (i) => {
        const since = sinceDate(i);
        if (!since) return "Say since when: a date (since), a month (month) or how many months back (months_back).";
        try {
          const list = await clientsLapsed(since);
          noteAction(actions, "looked", `Looked at who hasn't booked since ${since} (${list.length})`);
          return lapsedText(list, since);
        } catch (error) {
          return failed(error);
        }
      },
    }),
  ];
}

// Email campaigns (Portal → Campaigns on Nova Bot): suggest, DRAFT, edit and read results. There is no
// send, schedule, approve or test-send tool, on purpose: an admin approves every campaign with their
// own Portal sign-in before anything goes (Nova Bot only lets a signed-in admin's press send it).
// The trace only gets ids and counts, never subjects, bodies or anyone's details.
export function campaignTools(actions: ChatAction[]) {
  const failed = (error: unknown) => `Couldn't reach the email campaigns just now: ${(error as Error).message}`;
  const notSent = "Nothing has been sent: it goes to nobody until an admin approves it in Portal → Campaigns or on the card under your reply. Tell them that plainly.";
  const SUBJECT = z.string().min(1).max(150).describe("The subject line: short and specific");
  const BODY = z
    .string()
    .min(1)
    .max(20000)
    .describe("The email as it should read: plain text, paragraphs separated by a blank line, **bold** for emphasis, full links (https://…), signed Novacane Studios. No unsubscribe footer: Nova Bot adds who it's from, why they're getting it and the unsubscribe link.");
  const AUDIENCE = z.enum(AUDIENCES).describe("fans = confirmed fans who signed up; clients = studio clients who said yes to studio news; everyone = both (each person once)");
  const SEND_AT = STAMP.describe("When to send it, UK wall-clock YYYY-MM-DDTHH:MM (leave out to send as soon as it's approved)");
  // The send time as UTC ISO (or a reason it can't be used)
  const sendTime = (local: string): string | { error: string } => {
    const iso = ukToUtc(local);
    if (!iso) return { error: "That send time isn't a UK date and time (YYYY-MM-DDTHH:MM)." };
    if (Date.parse(iso) < Date.now() + 5 * 60_000) return { error: "That send time has passed (or is too close: an admin still has to approve it). Pick a later time, or leave it out to send as soon as it's approved." };
    return iso;
  };
  // The card under the reply, with how many people its audience has when that's known
  const card = async (campaign: Awaited<ReturnType<typeof createDraft>>, audiences?: Audiences | null): Promise<CampaignCard> => {
    let a = audiences ?? null;
    if (!a) a = await campaignContext().then((c) => c.audiences).catch(() => null);
    return { ...campaign, audienceCount: a ? (a[campaign.audience] ?? null) : null };
  };
  return [
    betaZodTool({
      name: "suggest_campaign",
      description:
        "Before suggesting an email campaign: how many people are opted in (confirmed fans, clients who said yes to studio news, everyone), how the last few campaigns did, and today's date. It saves nothing. Then suggest 1–3 ideas in your reply; write one with create_campaign_draft once they pick it.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const ctx = await campaignContext();
          noteAction(actions, "looked", `Looked at who's opted in for email (${ctx.audiences.everyone}) and ${ctx.recent.length} recent campaign${ctx.recent.length === 1 ? "" : "s"}`);
          return contextText(ctx);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "create_campaign_draft",
      description:
        "Write an email campaign to the studio's opted-in fans and/or clients. It is NOT sent: it's saved as a draft waiting for an admin, who reads it and presses Approve in Portal → Campaigns (or on the card under your reply) before anything is sent or scheduled. Write the whole email.",
      inputSchema: z.object({ subject: SUBJECT, body: BODY, audience: AUDIENCE, send_at: SEND_AT.optional() }),
      run: async ({ subject, body, audience, send_at }) => {
        let sendAt: string | null = null;
        if (send_at) {
          const t = sendTime(send_at);
          if (typeof t !== "string") return `${t.error} Nothing was saved.`;
          sendAt = t;
        }
        let campaign;
        try {
          campaign = await createDraft({ subject, body, audience, sendAt });
        } catch (error) {
          return `Couldn't save the draft: ${(error as Error).message} Nothing was saved or sent.`;
        }
        const c = await card(campaign);
        actions.push({ kind: "campaign", text: `Drafted an email campaign, waiting for an admin's approval`, campaign: c });
        trace("input", "ok", `Chat: drafted email campaign #${campaign.id} (waiting for approval)`);
        return `Campaign #${campaign.id} saved as a draft, NOT sent: ${campaignLine(campaign, null)}${c.audienceCount !== null ? ` · ${c.audienceCount} opted in now` : ""}. ${notSent}${c.audienceCount === 0 ? " Nobody in that audience has opted in yet, so it would reach no one." : ""}`;
      },
    }),
    betaZodTool({
      name: "edit_campaign_draft",
      description:
        "Change a campaign that hasn't gone yet (its subject, the email, who it's for, or when it sends). It goes back to waiting for an admin's approval (any approval is cleared), and it is NOT sent. Read it first with list_campaigns or campaign_results.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The campaign's id"),
        subject: SUBJECT.optional(),
        body: BODY.optional(),
        audience: AUDIENCE.optional(),
        send_at: SEND_AT.optional(),
        send_when_approved: z.boolean().optional().describe("true: drop the send time, so it goes as soon as it's approved"),
      }),
      run: async ({ id, subject, body, audience, send_at, send_when_approved }) => {
        const changes: CampaignChanges = {};
        if (subject !== undefined) changes.subject = subject;
        if (body !== undefined) changes.body = body;
        if (audience !== undefined) changes.audience = audience;
        if (send_at) {
          const t = sendTime(send_at);
          if (typeof t !== "string") return `${t.error} Nothing was changed.`;
          changes.sendAt = t;
        } else if (send_when_approved) changes.sendAt = null;
        if (!Object.keys(changes).length) return "Say what to change: the subject, the email, the audience or the send time.";
        let campaign;
        try {
          campaign = await editDraft(id, changes);
        } catch (error) {
          return `Couldn't change campaign #${id}: ${(error as Error).message} Nothing was changed or sent.`;
        }
        const c = await card(campaign);
        actions.push({ kind: "campaign", text: `Changed an email campaign, waiting for an admin's approval`, campaign: c });
        trace("input", "ok", `Chat: edited email campaign #${id} (waiting for approval)`);
        return `Campaign #${id} changed and back to waiting for approval: ${campaignLine(campaign, null)}. ${notSent}`;
      },
    }),
    betaZodTool({
      name: "campaign_results",
      description: "How a sent email campaign did, in plain words: how many it went to, delivered, opened and clicked (as percentages), unsubscribed and bounced. The latest sent one, or one by id. Read-only.",
      inputSchema: z.object({ id: z.number().int().positive().optional().describe("The campaign's id (leave out for the latest sent one)") }),
      run: async ({ id }) => {
        try {
          if (id) {
            const { campaign } = await readCampaign(id);
            noteAction(actions, "looked", `Looked at email campaign #${id}'s results`);
            return resultsText(campaign);
          }
          const sent = (await listCampaigns("sent")).filter((c) => c.status === "sent").sort((a, b) => String(b.sentAt ?? "").localeCompare(String(a.sentAt ?? "")));
          if (!sent.length) return "No campaign has been sent yet, so there are no results.";
          noteAction(actions, "looked", `Looked at email campaign #${sent[0].id}'s results`);
          return resultsText(sent[0]);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "list_campaigns",
      description: "The studio's email campaigns, newest first: subject, status (waiting for approval, scheduled, sent, rejected, didn't send), who it's for, and when it sends or was sent (UK time). Read-only.",
      inputSchema: z.object({ status: z.enum(CAMPAIGN_STATUSES).optional().describe("Only those with this status (leave out for all)") }),
      run: async ({ status }) => {
        try {
          const list = (await listCampaigns(status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          noteAction(actions, "looked", `Looked at ${list.length} email campaign${list.length === 1 ? "" : "s"}`);
          return list.length ? list.map((c) => campaignLine(c)).join("\n") : status ? "No campaigns with that status." : "No campaigns yet.";
        } catch (error) {
          return failed(error);
        }
      },
    }),
  ];
}

// One-to-one emails (Portal → Campaigns → One-to-one emails on Nova Bot): DRAFT, edit and list. There is
// no send, approve or test-send tool, on purpose: an admin approves every email with their own Portal
// sign-in before it goes, and Nova Bot checks the person may be emailed at all. The trace only gets
// ids and counts, never addresses, subjects or bodies.
export function outreachTools(actions: ChatAction[]) {
  const notSent = "Nothing has been sent: it goes to nobody until an admin approves it in Portal → Campaigns (One-to-one emails). Tell them that plainly.";
  const FIELDS = {
    to_email: z.string().min(3).max(200).describe("Their email address (for a business: a work address at that organisation)"),
    to_name: z.string().max(100).optional().describe("Their name, if known (used in the To line)"),
    organisation: z.string().max(120).optional().describe("The business or organisation (needed for kind business)"),
    kind: z.enum(["business", "client", "reply"]).describe("business = a work address at an organisation (B2B); client = a studio client (from client_find); reply = someone who sent the studio an enquiry"),
    client_id: z.number().int().positive().optional().describe("For kind client: their id from client_find"),
    about_booking: z.boolean().optional().describe("For kind client: true when it's about their own booking (a service email). Studio news to a client needs their marketing consent."),
    subject: z.string().min(1).max(150).describe("A short, specific subject line"),
    body: z.string().min(10).max(10000).describe("The whole email: greeting, short paragraphs separated by a blank line, one clear ask, signed Novacane Studios. No footer: Nova Bot adds who it's from and how to stop these emails."),
  };
  const toFields = (i: { to_email?: string; to_name?: string; organisation?: string; kind?: OutreachFields["kind"]; client_id?: number; about_booking?: boolean; subject?: string; body?: string }): OutreachFields => {
    const f: OutreachFields = {};
    if (i.kind !== undefined) f.kind = i.kind;
    if (i.to_email !== undefined) f.toEmail = i.to_email;
    if (i.to_name !== undefined) f.toName = i.to_name;
    if (i.organisation !== undefined) f.organisation = i.organisation;
    if (i.client_id !== undefined) f.clientId = i.client_id;
    if (i.about_booking !== undefined) f.aboutBooking = i.about_booking;
    if (i.subject !== undefined) f.subject = i.subject;
    if (i.body !== undefined) f.body = i.body;
    return f;
  };
  return [
    betaZodTool({
      name: "draft_outreach_email",
      description:
        "Write a personal email to one person (a business, a studio client, or someone who wrote in). It is NOT sent: it's saved waiting for an admin, who reads it and presses Approve in Portal → Campaigns (One-to-one emails). Nova Bot refuses people the studio may not email, with the reason. Write the whole email.",
      inputSchema: z.object(FIELDS),
      run: async (i) => {
        let o: Outreach;
        try {
          o = await draftOutreach(toFields(i));
        } catch (error) {
          return `Not saved: ${(error as Error).message} Nothing was sent.`;
        }
        actions.push({ kind: "outreach", text: `Drafted an email to ${o.toName || o.organisation || "one person"}, waiting for an admin's approval`, outreach: o });
        trace("input", "ok", `Chat: drafted one-to-one email #${o.id} (waiting for approval)`);
        return `Email #${o.id} saved as a draft, NOT sent: ${outreachLine(o)}. ${notSent}`;
      },
    }),
    betaZodTool({
      name: "edit_outreach_email",
      description: "Change a one-to-one email that hasn't gone yet (who it's to, the subject, the email). It goes back to waiting for an admin's approval (any approval is cleared) and is NOT sent. Find it with list_outreach_emails first.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The email's id"),
        to_email: FIELDS.to_email.optional(),
        to_name: FIELDS.to_name,
        organisation: FIELDS.organisation,
        kind: FIELDS.kind.optional(),
        client_id: FIELDS.client_id,
        about_booking: FIELDS.about_booking,
        subject: FIELDS.subject.optional(),
        body: FIELDS.body.optional(),
      }),
      run: async ({ id, ...rest }) => {
        const changes = toFields(rest);
        if (!Object.keys(changes).length) return "Say what to change: who it's to, the subject or the email.";
        let o: Outreach;
        try {
          o = await editOutreach(id, changes);
        } catch (error) {
          return `Couldn't change email #${id}: ${(error as Error).message} Nothing was changed or sent.`;
        }
        actions.push({ kind: "outreach", text: `Changed an email to ${o.toName || o.organisation || "one person"}, waiting for an admin's approval`, outreach: o });
        trace("input", "ok", `Chat: edited one-to-one email #${id} (waiting for approval)`);
        return `Email #${id} changed and back to waiting for approval: ${outreachLine(o)}. ${notSent}`;
      },
    }),
    betaZodTool({
      name: "list_outreach_emails",
      description: "The studio's one-to-one emails, newest first (waiting ones first): who to, subject, status (waiting for approval, sent, rejected, didn't send) and when (UK time). Read-only. Use it before writing to someone again.",
      inputSchema: z.object({ status: z.enum(OUTREACH_STATUSES).optional().describe("Only those with this status (leave out for all)") }),
      run: async ({ status }) => {
        try {
          const list = await listOutreach(status);
          noteAction(actions, "looked", `Looked at ${list.length} one-to-one email${list.length === 1 ? "" : "s"}`);
          return list.length ? list.map(outreachLine).join("\n") : status ? "None with that status." : "No one-to-one emails yet.";
        } catch (error) {
          return `Couldn't reach the one-to-one emails just now: ${(error as Error).message}`;
        }
      },
    }),
  ];
}

// Social posts (Portal → Social on Nova Bot): look, DRAFT, edit, read results and comments, and draft
// replies to comments. There is no approve or post tool, on purpose: an admin approves every post and
// reply with their own Portal sign-in before anything goes on Facebook or Instagram. The trace only
// gets ids and counts, never the words or anyone's names.
export function socialTools(actions: ChatAction[]) {
  const failed = (error: unknown) => `Couldn't reach the social posts just now: ${(error as Error).message}`;
  const notPosted = "Nothing has been posted: it goes nowhere until an admin approves it in Portal → Social. Tell them that plainly.";
  const CAPTION = z.string().min(1).max(2200).describe("The post's words as they'll appear: a strong first line, short lines, emoji only if it suits, a few relevant hashtags at the end (Instagram: 30 at most, 2,200 characters)");
  const PLATFORM_LIST = z.array(z.enum(PLATFORMS)).min(1).max(3).describe("facebook, instagram and/or youtube (YouTube: one video, no pictures)");
  const POST_AT = STAMP.describe("When to post it, UK wall-clock YYYY-MM-DDTHH:MM (leave out to post as soon as it's approved)");
  const postTime = (local: string): string | { error: string } => {
    const iso = ukToUtc(local);
    if (!iso) return { error: "That time isn't a UK date and time (YYYY-MM-DDTHH:MM)." };
    if (Date.parse(iso) < Date.now() + 5 * 60_000) return { error: "That time has passed (or is too close: an admin still has to approve it). Pick a later time, or leave it out to post as soon as it's approved." };
    return iso;
  };
  const did = (text: string, url?: string) => {
    actions.push({ kind: "social", text, url });
    trace("input", "ok", `Chat: ${text}`);
  };
  return [
    betaZodTool({
      name: "social_context",
      description:
        "Before suggesting social posts: whether Facebook, Instagram and YouTube are connected, followers and how they changed, how the last few posts did, how many comments are waiting, and today's date. It saves nothing. Then suggest 1–3 ideas; write one with create_social_draft once they pick it.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const ctx = await socialContext();
          noteAction(actions, "looked", `Looked at the social posts (${ctx.recent.length} recent)`);
          return socialContextText(ctx);
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "create_social_draft",
      description:
        "Write a Facebook, Instagram and/or YouTube post. It is NOT posted: it's saved as a draft waiting for an admin, who checks it and presses Approve in Portal → Social. You can't attach pictures or videos: say which would suit, and someone adds it in Portal → Social (Instagram needs one; YouTube needs one video, and the first line becomes its title).",
      inputSchema: z.object({ caption: CAPTION, platforms: PLATFORM_LIST, post_at: POST_AT.optional() }),
      run: async ({ caption, platforms, post_at }) => {
        let postAt: string | null = null;
        if (post_at) {
          const t = postTime(post_at);
          if (typeof t !== "string") return `${t.error} Nothing was saved.`;
          postAt = t;
        }
        let post;
        try {
          post = await createSocialDraft({ caption, platforms, postAt });
        } catch (error) {
          return `Couldn't save the draft: ${(error as Error).message} Nothing was saved or posted.`;
        }
        did(`Drafted social post #${post.id}, waiting for an admin's approval`, post.portalUrl);
        const needsPicture = platforms.includes("instagram") ? " Instagram needs a picture or video: someone adds it in Portal → Social before it can be approved." : "";
        return `Post #${post.id} saved as a draft, NOT posted: ${postLine(post)}. ${notPosted}${needsPicture}`;
      },
    }),
    betaZodTool({
      name: "edit_social_draft",
      description:
        "Change a post that hasn't gone yet (its words, platforms or time). It goes back to waiting for an admin's approval (any approval is cleared), and it is NOT posted. Read it first with list_social_posts.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("The post's id"),
        caption: CAPTION.optional(),
        platforms: PLATFORM_LIST.optional(),
        post_at: POST_AT.optional(),
        post_when_approved: z.boolean().optional().describe("true: drop the time, so it posts as soon as it's approved"),
      }),
      run: async ({ id, caption, platforms, post_at, post_when_approved }) => {
        const changes: { caption?: string; platforms?: ("facebook" | "instagram" | "youtube")[]; postAt?: string | null } = {};
        if (caption !== undefined) changes.caption = caption;
        if (platforms !== undefined) changes.platforms = platforms;
        if (post_at) {
          const t = postTime(post_at);
          if (typeof t !== "string") return `${t.error} Nothing was changed.`;
          changes.postAt = t;
        } else if (post_when_approved) changes.postAt = null;
        if (!Object.keys(changes).length) return "Say what to change: the words, the platforms or the time.";
        let post;
        try {
          post = await editSocialDraft(id, changes);
        } catch (error) {
          return `Couldn't change post #${id}: ${(error as Error).message} Nothing was changed or posted.`;
        }
        did(`Changed social post #${id}, waiting for an admin's approval`, post.portalUrl);
        return `Post #${id} changed and back to waiting for approval: ${postLine(post)}. ${notPosted}`;
      },
    }),
    betaZodTool({
      name: "list_social_posts",
      description: "The studio's Facebook, Instagram and YouTube posts, newest first: the words, status (waiting for approval, scheduled, posted, waiting to be posted by hand, rejected, didn't post), platforms, time (UK) and links. Read-only.",
      inputSchema: z.object({ status: z.enum(POST_STATUSES).optional().describe("Only those with this status (leave out for all)") }),
      run: async ({ status }) => {
        try {
          const list = await listSocialPosts(status);
          noteAction(actions, "looked", `Looked at ${list.length} social post${list.length === 1 ? "" : "s"}`);
          return list.length ? list.map(postLine).join("\n") : status ? "No posts with that status." : "No posts yet.";
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "social_results",
      description: "How a posted Facebook/Instagram post did: reach, likes, comments, shares, saves, clicks. The latest posted one, or one by id. Read-only.",
      inputSchema: z.object({ id: z.number().int().positive().optional().describe("The post's id (leave out for the latest posted one)") }),
      run: async ({ id }) => {
        try {
          let post;
          if (id) post = await readSocialPost(id);
          else {
            const posted = (await listSocialPosts("posted")).sort((a, b) => String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")));
            if (!posted.length) return "Nothing has been posted yet, so there are no results.";
            post = posted[0];
          }
          noteAction(actions, "looked", `Looked at social post #${post.id}'s results`);
          return `${postLine(post)}. ${postStatsText(post) || "No results for it."}`;
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "list_social_comments",
      description: "Comments on the studio's Facebook and Instagram posts (read from Meta every hour): who, what they said, which post, and whether they've been answered. Waiting ones by default. Read-only.",
      inputSchema: z.object({ all: z.boolean().optional().describe("true: answered ones too") }),
      run: async ({ all }) => {
        try {
          const list = await listSocialComments(!all);
          noteAction(actions, "looked", `Looked at ${list.length} comment${list.length === 1 ? "" : "s"} on the studio's posts`);
          return list.length ? list.map(commentLine).join("\n") : all ? "No comments yet." : "No comments waiting for an answer.";
        } catch (error) {
          return failed(error);
        }
      },
    }),
    betaZodTool({
      name: "draft_comment_reply",
      description:
        "Write a reply to a comment on one of the studio's posts. It is NOT posted: it waits for an admin's Approve in Portal → Social. Keep it short, warm and specific; only promise what the studio has said it can do; never share anyone's details.",
      inputSchema: z.object({ id: z.number().int().positive().describe("The comment's id"), text: z.string().min(1).max(1000).describe("The reply") }),
      run: async ({ id, text }) => {
        try {
          const c = await draftCommentReply(id, text);
          did(`Drafted a reply to comment #${c.id}, waiting for an admin's approval`);
          return `Reply to comment #${c.id} saved, NOT posted. It goes on ${c.platform === "instagram" ? "Instagram" : "Facebook"} only when an admin approves it in Portal → Social. Tell them that plainly.`;
        } catch (error) {
          return `Couldn't save the reply: ${(error as Error).message} Nothing was posted.`;
        }
      },
    }),
  ];
}

const noteAction = (actions: ChatAction[], kind: ChatAction["kind"], text: string) => {
  actions.push({ kind, text });
  trace("input", "ok", `Chat: ${text}`);
};

// Quests for one person: what they make is theirs, and they see their own (an admin, or the
// studio computer, can look at everyone's)
export function questTools(actions: ChatAction[], person: Person = localPerson()) {
  const did = (kind: ChatAction["kind"], text: string) => {
    actions.push({ kind, text });
    trace("input", "ok", `Chat: ${person.online ? `${person.name}: ` : ""}${text}`);
  };
  const owner = ownerToSave(person);
  const mine = { id: person.id };
  // Theirs to change? (anyone's for an admin or the PC; staff: their own and quests tied to a note)
  // (Not found: the action itself says so, with the detail)
  const check = <T extends { owner?: string; title: string; link?: string }>(x: T | undefined, what: string): T | undefined => {
    if (x && !mayChange(x, person)) throw new Error(`“${x.title}” is ${personName(ownerOf(x))}'s ${what}, not yours to change.`);
    return x;
  };
  const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id) ?? (list.filter((x) => x.id.startsWith(id)).length === 1 ? list.find((x) => x.id.startsWith(id)) : undefined);
  const questById = (id: string) => byId(readQuests().quests, id);
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
      name: "what_now",
      description: "The quest happening now, the next few, anything overdue or unplanned (quests at risk say AT RISK), music time today and tomorrow, and today's calendar (including Google Calendar's events, which quests are planned around). Use it for 'what should I do now?' and before giving advice on priorities.",
      inputSchema: z.object({}),
      run: async () => {
        const st = questState(mine);
        return JSON.stringify({
          now: st.now,
          current: st.current ? questLine(st.current) : null,
          next: st.next.map(questLine),
          overdue: st.overdue.map(questLine),
          unplanned: st.unplanned.map(questLine),
          music_time: currentMusic(person.id).slice(0, 2).map(musicLine),
          // Today's events (the studio's own and Google Calendar's): quests are planned around them
          calendar_today: todayCalendar(),
        });
      },
    }),
    betaZodTool({
      name: "quests_list",
      description: `Quests scheduled between two dates (or all of them): the person's own${person.everyone ? " (everyone: true for everyone's, each with whose it is)" : ""}. Use it to find a quest's id.`,
      inputSchema: z.object({ from: DATE.optional(), to: DATE.optional(), everyone: z.boolean().optional().describe("Everyone's quests, not just theirs (admins only)") }),
      run: async ({ from, to, everyone }) => {
        const all = everyone && person.everyone;
        const qs = questState({ ...mine, everyone: all }).quests.filter((q) => (from ? q.start.slice(0, 10) >= from : true) && (to ? q.start && q.start.slice(0, 10) <= to : true));
        return qs.length ? qs.sort((a, b) => (a.start || "z").localeCompare(b.start || "z")).map((q) => `${questLine(q)}${all ? ` · ${q.ownerName}'s` : ""}`).join("\n") : everyone && !person.everyone ? "Only admins can see everyone's quests. No quests of theirs found." : "No quests found.";
      },
    }),
    betaZodTool({
      name: "quest_add",
      description: "Add a Quest. It's scheduled automatically unless fixed_start pins it. For a big goal, add each of its steps as a quest of its own.",
      inputSchema: z.object({
        title: z.string().min(1),
        ...LENGTH,
        priority: z.enum(PRIORITIES).optional(),
        deadline: STAMP_OR_EMPTY.optional(),
        fixed_start: STAMP_OR_EMPTY.optional(),
        location: z.string().optional(),
        travel_minutes: z.number().int().min(0).max(300).optional(),
        time_of_day: z.enum(TIMES_OF_DAY).optional(),
        notes: z.string().optional(),
      }),
      run: async (i) => {
        const q = addQuest({ title: i.title, minutes: totalMinutes(i) ?? 60, ongoing: i.ongoing, every: i.every, everyMinutes: i.every_minutes, priority: i.priority, deadline: i.deadline, fixedStart: i.fixed_start, location: i.location, travelMinutes: i.travel_minutes, timeOfDay: i.time_of_day, notes: i.notes }, owner);
        did("added", `Quest “${q.title}”${q.start ? `: ${longDate(q.start.slice(0, 10))} ${hm(q.start)}` : ""}`);
        return `Added: ${questLine(q)}`;
      },
    }),
    betaZodTool({
      name: "quest_update",
      description: "Change a quest: its length, priority, deadline, location/travel, preferred time of day, notes, its mode (how it's going: waiting, soon, working = Working On It, nearly = Nearly Finished, longer = Taking longer than expected, questions, done), or pin it to a time with fixed_start (\"\" unpins it so the planner chooses). Everything re-plans.",
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
        mode: z.enum(MODES).optional(),
        phones: z.array(z.string().regex(/^[0-9a-f]{12}$/)).max(10).optional().describe("Which phones get this quest's reminders (phone ids; [] = its owner's own phones)"),
      }),
      run: async ({ id, fixed_start, travel_minutes, time_of_day, seconds, minutes, hours, days, every_minutes, ...rest }) => {
        check(questById(id), "quest");
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
        check(questById(id), "quest");
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
        check(questById(id), "quest");
        const q = snoozeQuest(id, minutes);
        did("changed", `Snoozed “${q.title}”${q.start ? ` to ${hm(q.start)}` : ""}`);
        return `Snoozed: ${questLine(q)}`;
      },
    }),
    betaZodTool({
      name: "block_time",
      description: "Block out time that's taken (plans changed, out for the evening, ill, appointment): quests (and music time, within its day) move out of the way. Or remove a block by id.",
      inputSchema: z.object({ start: STAMP.optional(), end: STAMP.optional(), reason: z.string().optional(), remove_id: z.string().optional() }),
      run: async ({ start, end, reason, remove_id }) => {
        if (remove_id) {
          check(byId(readQuests().blocks.map((x) => ({ ...x, title: x.reason })), remove_id), "blocked time");
          const b = removeBlock(remove_id);
          did("removed", `Unblocked ${b.reason}`);
          return `Removed the block “${b.reason}”.`;
        }
        if (!start || !end) return "Give a start and end time.";
        const b = addBlock(start, end, reason || "Busy", owner);
        did("added", `Blocked ${longDate(start.slice(0, 10))} ${hm(start)}–${hm(end)}: ${b.reason}`);
        return `Blocked ${b.start}–${b.end} (${b.reason}), id ${b.id.slice(0, 8)}. Quests have moved around it.`;
      },
    }),
    betaZodTool({
      name: "rhythm_set",
      description: "Change the daily rhythm the planner works to. Only send what changes. (Music time has its own tool: music_time_set.)",
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
        phone_push: z.boolean().optional().describe("Also send reminders to the staff phones"),
        pace_limits: z.boolean().optional().describe("The pace safety switch: true = quests start a few minutes ahead, on 5-minute marks, with buffers and breaks; false = right away, to the second, back to back"),
        days_off: z.array(z.enum(WEEKDAYS)).optional().describe("The whole set of days of the week with no quests at all (replaces the current set; [] for none)"),
      }),
      run: async (i) => {
        const r = setRhythm({ wake: i.wake, sleep: i.sleep, windDownMinutes: i.wind_down_minutes, startUpMinutes: i.start_up_minutes, bufferMinutes: i.buffer_minutes, breakAfterMinutes: i.break_after_minutes, breakMinutes: i.break_minutes, maxQuestHoursPerDay: i.max_quest_hours_per_day, homeBase: i.home_base, remindMinutesBefore: i.remind_minutes_before, checkIns: i.check_ins, dailyBriefing: i.daily_briefing, phonePush: i.phone_push, paceLimits: i.pace_limits, daysOff: i.days_off?.map((d) => WEEKDAYS.indexOf(d)) }, owner);
        did("changed", `Rhythm: up ${r.wake}, sleep ${r.sleep}`);
        return `Rhythm now: ${JSON.stringify(r)}. Everything has been re-planned.`;
      },
    }),
    betaZodTool({
      name: "music_time_set",
      description: "Set music time: time the person sets aside for music, on chosen days of the week, at a usual start time, for a length. It's planned like a blocked time and quests go around it; if a studio booking, calendar entry or block overlaps it, it moves to the nearest free time that day (they get one calm notice if a booking moves today's or tomorrow's). Shown in Calendar as \"♪ Music time\" cards. minutes 0 turns it off. Only send what changes.",
      inputSchema: z.object({
        days: z.array(z.enum(WEEKDAYS)).optional().describe("The whole set of days with music time (replaces the current set)"),
        start: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('Its usual start, "HH:MM" (UK time)'),
        minutes: z.number().int().min(0).max(720).optional().describe("How long; 0 turns music time off"),
      }),
      run: async ({ days, start, minutes }) => {
        const was = rhythmFor(readQuests(), person.id, pcOwnerId()).music;
        const music = { days: days ? days.map((d) => WEEKDAYS.indexOf(d)) : was.days, start: start ?? was.start, minutes: minutes ?? was.minutes };
        if (music.minutes > 0 && !music.days.length) return "Which days should music time be on? Nothing was changed.";
        const r = setRhythm({ music }, owner);
        if (!r.music.minutes) {
          did("changed", "Music time: off");
          return "Music time is off. Everything has been re-planned.";
        }
        const names = r.music.days.map((d) => WEEKDAYS[d][0].toUpperCase() + WEEKDAYS[d].slice(1, 3)).join(", ");
        did("changed", `Music time: ${names}, ${r.music.start}, ${r.music.minutes} min`);
        const next = currentMusic(person.id).slice(0, 5);
        return `Music time set: ${names} at ${r.music.start} for ${r.music.minutes} minutes. Quests have been re-planned around it.${next.length ? ` Next: ${next.map(musicLine).join("; ")}` : ""}`;
      },
    }),
    betaZodTool({
      name: "replan",
      description: "Re-plan everything from now (after big changes, or when asked to optimise the schedule): music time first, then quests around it, the calendar, blocks and studio bookings.",
      inputSchema: z.object({}),
      run: async () => {
        const r = replan();
        did("changed", "Re-planned every quest");
        return `Re-planned. ${r.atRisk} quest(s) at risk.${r.unplaced.length ? ` Couldn't place: ${r.unplaced.map((u) => `${u.title} (${u.why})`).join("; ")}` : ""}`;
      },
    }),
  ];
}

// One chat turn: the conversation so far in, Nova Agent's reply (and what it did) out. `person`:
// who's talking (src/person.ts; none = the person Nova Agent works for on the PC). Their name and
// role are in the system prompt, and what the tools make is theirs.
export async function chat(history: ChatTurn[], person: Person = localPerson()): Promise<{ reply: string; actions: ChatAction[] }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  // The conversation must start with the person, and end with them
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("Nothing to answer.");

  const actions: ChatAction[] = [];
  const model = config.novaModel || DEFAULT_MODEL;
  // What Nova Agent remembers that matters for this message (Index)
  const asked = String(messages[messages.length - 1].content);
  const memory = await memoryFor(asked, person.id);
  trace("llm", "start", `Chat: asking ${model}`);
  const runner = getClient().beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    system: memory ? `${systemPrompt(person)}\n\n${memory}` : systemPrompt(person),
    tools: [...tools(actions, person), ...questTools(actions, person), ...fileTools(actions), ...enquiryTools(actions), ...clientTools(actions), ...campaignTools(actions), ...outreachTools(actions), ...socialTools(actions), ...moneyTools(actions), ...tidyTools(actions), ...googleTools(actions), ...webTools({ search: 5, fetch: 5 })],
    messages,
    output_config: { effort: "low" },
    max_iterations: 16 + MAX_CONTINUATIONS,
    // If this model declines a request, the API retries it on a suitable fallback model inside the same call
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  // Web research can pause part-way (the server's own step limit): carry on where it stopped
  let continued = 0;
  for await (const message of runner) {
    if (message.stop_reason === "pause_turn" && continued++ < MAX_CONTINUATIONS) runner.pushMessages({ role: "assistant", content: message.content });
  }
  const final = await runner.done();

  if (final.stop_reason === "refusal") {
    return { reply: "Sorry, I can't help with that one.", actions };
  }
  const reply = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  trace("llm", "ok", `Chat: answered (${final.usage.output_tokens} tokens)`);
  // The suite keeps learning from what's said here (in the background, on Nova Bot's worker)
  learnFrom([...messages.map((m) => ({ role: m.role, content: String(m.content) })), { role: "assistant", content: reply }], "", person.id);
  return { reply: reply || (actions.length ? "Done ✦" : "I'm not sure what to say to that."), actions };
}
