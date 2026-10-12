// Agent's Google tools: read only, on purpose. It can see when the studio's Google Calendar is
// busy, search the studio's Gmail (who, subject, when and a snippet, never whole emails) and look
// people up in Google Contacts. It has no tool that sends, books, creates or changes anything in
// Google: sending goes through the approval flows (Portal), and syncing is Nova Bot's (src/google/).

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { contactsFind, docRead, driveSearch, gmailSearch, googleBusy, tasksList, youtubeStats } from "./google";
import { trace } from "./trace";

type Action = { kind: "looked"; text: string };

export const GOOGLE_PROMPT = `- Google (the studio's account, connected in Portal → Admin → Google): google_calendar_busy (when the studio's Google Calendar is busy), gmail_search (find emails: who, subject, when and a snippet; Gmail search words work, e.g. "from:kai@example.com", "subject:invoice newer_than:30d"), google_contacts_find (names, emails, phones), google_drive_search (find files in the studio's Google Drive by name or words) and google_doc_read (a Google Doc's text, by its link or id), google_tasks_list (what's in Google Tasks, including the "Nova quests" list that mirrors their quests) and youtube_stats (the channel's subscribers and the latest videos' views, likes and comments). Read-only: you can't send, book, post, upload or change anything in Google. Events, clients, quests, approved emails and approved YouTube videos reach Google by themselves; for a YouTube video, draft a Social post with youtube in its platforms (create_social_draft): it goes up only after an admin approves it.`;

const uk = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const notConnected = (error: unknown) => `Couldn't ask Google: ${(error as Error).message}`;

export function googleTools(actions: { push(action: Action): number }) {
  const looked = (text: string) => {
    actions.push({ kind: "looked", text });
    trace("input", "ok", `Chat: ${text}`);
  };
  return [
    betaZodTool({
      name: "google_calendar_busy",
      description: "When the studio's Google Calendar (and the Novacane Studio calendar) is busy between two days: start and end times in UK time. Read-only.",
      inputSchema: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("First day, YYYY-MM-DD (UK)"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Last day, YYYY-MM-DD (UK), up to 60 days after the first"),
      }),
      run: async ({ from, to }) => {
        try {
          const busy = await googleBusy(new Date(`${from}T00:00:00Z`).toISOString(), new Date(Date.parse(`${to}T00:00:00Z`) + 86400000).toISOString());
          looked(`Looked at Google Calendar (${busy.length} busy time${busy.length === 1 ? "" : "s"})`);
          return busy.length ? busy.map((b) => `- ${uk(b.start)} – ${uk(b.end)}`).join("\n") : "Nothing busy in Google Calendar then.";
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "gmail_search",
      description: "Search the studio's Gmail. Gives who it's from, the subject, when, and a short snippet for up to 8 emails (never whole emails). Read-only: nothing is sent or changed.",
      inputSchema: z.object({ q: z.string().min(1).max(200).describe('Gmail search words, e.g. "from:kai@example.com" or "subject:session newer_than:14d"') }),
      run: async ({ q }) => {
        try {
          const hits = await gmailSearch(q);
          looked(`Searched Gmail (${hits.length} found)`);
          return hits.length ? hits.map((m) => `- ${uk(m.date)} · ${m.from} · "${m.subject}": ${m.snippet}`).join("\n") : "No emails match that.";
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "google_drive_search",
      description: "Find files in the studio's Google Drive by name or the words in them: name, kind (Google Doc, Sheet, PDF…), when it changed, and its link. Read-only.",
      inputSchema: z.object({ q: z.string().min(1).max(100).describe("Words in the file's name or text") }),
      run: async ({ q }) => {
        try {
          const files = await driveSearch(q);
          looked(`Searched Google Drive (${files.length} found)`);
          return files.length ? files.map((f) => `- ${f.name} (${f.kind}, changed ${uk(f.modified)}) · ${f.url} · id ${f.id}`).join("\n") : "Nothing in Google Drive matches that.";
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "google_doc_read",
      description: "Read a Google Doc's text (the first 20,000 characters), by its link or id (from google_drive_search). Read-only.",
      inputSchema: z.object({ id: z.string().min(10).max(300).describe("The Doc's link (docs.google.com/document/d/…) or id") }),
      run: async ({ id }) => {
        try {
          const doc = await docRead(id);
          looked(`Read a Google Doc ("${doc.name.slice(0, 40)}")`);
          return `"${doc.name}" (${doc.url})\n\n${doc.text}${doc.cut ? "\n\n(The Doc goes on; this is its first 20,000 characters.)" : ""}`;
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "google_tasks_list",
      description: "What's open in the studio's Google Tasks (its lists, including \"Nova quests\", which mirrors their quests): title, due day and notes. Read-only.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const tasks = await tasksList();
          looked(`Looked at Google Tasks (${tasks.length} open)`);
          return tasks.length ? tasks.map((t) => `- [${t.list}] ${t.title}${t.due ? ` · due ${t.due}` : ""}${t.notes ? ` · ${t.notes.split("\n")[0]}` : ""}`).join("\n") : "Nothing open in Google Tasks.";
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "youtube_stats",
      description: "The studio's YouTube channel: subscribers, total views and videos, and the latest videos' views, likes and comments. Read-only.",
      inputSchema: z.object({}),
      run: async () => {
        try {
          const yt = await youtubeStats();
          looked("Looked at YouTube's numbers");
          const c = yt.channel;
          const head = c ? `${c.title || "The channel"}: ${c.subscribers ?? "hidden"} subscribers${c.before?.subscribers != null && c.subscribers != null ? ` (${c.subscribers - c.before.subscribers >= 0 ? "+" : ""}${c.subscribers - c.before.subscribers} since ${c.before.day})` : ""}, ${c.views} views, ${c.videos} videos.` : "No channel found for the studio's Google account.";
          const list = yt.videos.map((v) => `- "${v.title}"${v.published ? ` (${v.published.slice(0, 10)})` : ""}: ${v.views ?? 0} views, ${v.likes ?? 0} likes, ${v.comments ?? 0} comments · ${v.url}`).join("\n");
          return list ? `${head}\n${list}` : head;
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
    betaZodTool({
      name: "google_contacts_find",
      description: "Find people in the studio's Google Contacts by name, email or phone: their name, email and phone. Read-only.",
      inputSchema: z.object({ q: z.string().min(1).max(100).describe("A name, email or phone number (or part of one)") }),
      run: async ({ q }) => {
        try {
          const found = await contactsFind(q);
          looked(`Looked in Google Contacts (${found.length} found)`);
          return found.length ? found.map((c) => `- ${c.name || "(no name)"}${c.email ? ` · ${c.email}` : ""}${c.phone ? ` · ${c.phone}` : ""}`).join("\n") : "Nobody in Google Contacts matches that.";
        } catch (error) {
          return notConnected(error);
        }
      },
    }),
  ];
}
