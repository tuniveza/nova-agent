// Enquiries, for Agent: read the studio's enquiries and DRAFT replies to them.
//
// The enquiries live on Nova Bot's worker. Agent reads them and posts drafts there with
// Nova Agent's key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/enquiries             { show }  -> the list
//   POST /nova-agent/enquiries/:id         {}        -> one enquiry and its conversation
//   POST /nova-agent/enquiries/:id/drafts  { body }  -> a draft reply
//   POST /nova-agent/inbox/sort            { id, state, label? } -> sort one (or move it to Spam)
//   POST /nova-agent/inbox/saved           {}        -> the team's saved replies
//
// That's all the key can do. There is deliberately no send or approve here: a draft only
// goes to the customer when a signed-in person presses Approve & send (in Portal, or on the
// draft's card under Agent's reply), which uses their own Portal sign-in, never this key.
// Nova Bot enforces the same thing on its side (src/enquiry-replies.js in Nova Bot).

import { config } from "./config";

export interface EnquirySummary {
  id: number;
  created_at: string;
  name: string;
  email: string;
  subject: string | null;
  state: string;
  label?: string | null;
  spam_reason?: string;
  details: string;
  drafts_waiting: number;
  replies_sent: number;
}

export interface DraftCard {
  id: number;
  enquiryId: number;
  name: string;
  email: string;
  subject: string | null;
  body: string;
  portalUrl: string;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see enquiries.");
  const response = await fetch(`${config.workerUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // An empty or broken answer: the status says what happened
  }
  if (!response.ok) throw new Error(data.error || `Nova Bot said no (${response.status}).`);
  return data as T;
}

// The enquiries: "open" (new, open or replied, still fine to contact), "new", "all" (but Spam) or "spam"
export async function listEnquiries(show: "open" | "new" | "all" | "spam" = "open"): Promise<EnquirySummary[]> {
  return (await call<{ enquiries: EnquirySummary[] }>("/nova-agent/enquiries", { show })).enquiries;
}

// One enquiry with its conversation (the customer's message, replies, notes and drafts)
export async function readEnquiry(id: number): Promise<{ enquiry: any; messages: any[] }> {
  return call(`/nova-agent/enquiries/${encodeURIComponent(String(id))}`);
}

// Save a draft reply on Nova Bot. It waits there until a person approves it.
export async function draftReply(id: number, body: string): Promise<DraftCard> {
  const r = await call<{ draft: { id: number; enquiryId: number; body: string }; enquiry: { name: string; email: string; subject: string | null }; portalUrl: string }>(
    `/nova-agent/enquiries/${encodeURIComponent(String(id))}/drafts`,
    { body }
  );
  return { id: r.draft.id, enquiryId: r.draft.enquiryId, name: r.enquiry.name, email: r.enquiry.email, subject: r.enquiry.subject, body: r.draft.body, portalUrl: r.portalUrl };
}

// The conversation as text for Claude (dates in UK time)
export function threadText(t: { enquiry: any; messages: any[] }): string {
  const uk = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const e = t.enquiry;
  const lines = [
    `Enquiry #${e.id} (${e.state}) from ${e.name} <${e.email}>${e.phone ? `, mobile ${e.phone}` : ""}, sent ${uk(e.created_at)}${e.page ? ` from ${e.page}` : ""}`,
    `Subject: ${e.subject || "(none)"}`,
    e.state === "do-not-contact" ? "THEY ASKED NOT TO BE CONTACTED: don't draft anything." : "",
    "",
    "Their message:",
    e.details,
  ];
  for (const m of t.messages) {
    const who = m.direction === "note" ? `Note by ${m.author_name || (m.created_by === "customer" ? "the system" : "staff")}` : m.created_by === "agent" ? "Reply drafted by Nova Agent" : `Reply by ${m.author_name || "staff"}`;
    lines.push("", `${who}, ${uk(m.created_at)}${m.direction === "out" ? ` [${m.status === "approved" ? "sending" : m.status}]` : ""}:`, m.body);
  }
  return lines.filter((l, i) => l !== "" || i > 0).join("\n");
}

// Sort an enquiry into the inbox's places (new, open, waiting, done, spam), optionally with a
// label. Only sorting: nothing is sent, and who's on it is for people to choose.
export async function sortEnquiry(id: number, state: string, label?: string): Promise<{ id: number; status: string; label: string | null }> {
  const r = await call<{ enquiry: { id: number; status: string; label: string | null } }>("/nova-agent/inbox/sort", { id, state, ...(label !== undefined ? { label } : {}) });
  return r.enquiry;
}

export interface SavedReply {
  id: number;
  title: string;
  body: string;
}

// The team's saved replies to routine questions (prices, opening times, how to book)
export async function savedReplies(): Promise<SavedReply[]> {
  return (await call<{ saved: SavedReply[] }>("/nova-agent/inbox/saved")).saved;
}
