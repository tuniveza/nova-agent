// Agent's Google tools: read only, on purpose. It can see when the studio's Google Calendar is
// busy, search the studio's Gmail (who, subject, when and a snippet, never whole emails) and look
// people up in Google Contacts. It has no tool that sends, books, creates or changes anything in
// Google: sending goes through the approval flows (Portal), and syncing is Nova Bot's (src/google/).

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { contactsFind, gmailSearch, googleBusy } from "./google";
import { trace } from "./trace";

type Action = { kind: "looked"; text: string };

export const GOOGLE_PROMPT = `- Google (the studio's account, connected in Portal → Admin → Google): google_calendar_busy (when the studio's Google Calendar is busy), gmail_search (find emails: who, subject, when and a snippet; Gmail search words work, e.g. "from:kai@example.com", "subject:invoice newer_than:30d") and google_contacts_find (names, emails, phones). Read-only: you can't send, book or change anything in Google. Events, clients and approved emails reach Google by themselves.`;

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
