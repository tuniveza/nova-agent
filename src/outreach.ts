// One-to-one emails ("outreach": a personal email to one venue, label, brand, client or someone who
// wrote in), for Agent.
//
// They live on Nova Bot's worker (src/outreach.js there). Agent reads them and writes DRAFTS there
// with Nova Agent's key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/outreach/draft     { kind, toEmail, toName?, organisation?, clientId?, aboutBooking?, subject, body }
//   POST /nova-agent/outreach/:id/edit  { …any of those }  -> back to waiting for approval
//   POST /nova-agent/outreach           { status? }        -> the emails
//   POST /nova-agent/outreach/:id       {}                 -> one, and its history
//
// That's all the key can do. There is deliberately no approve, send or test-send here: an email
// goes out only when a signed-in admin presses Approve in Portal → Campaigns (One-to-one emails)
// with their own Portal sign-in in a browser. Nova Bot also decides who may be emailed (UK GDPR /
// PECR): work addresses of businesses, clients who said yes to news (or about their own booking),
// and people who wrote in first; never anyone who said no. It adds the footer with who it's from
// and how to stop these emails. The trace only gets ids and counts, never addresses or bodies.

import { config } from "./config";
import { ukWhen } from "./campaigns";

export const OUTREACH_KINDS = ["business", "client", "reply"] as const;
export type OutreachKind = (typeof OUTREACH_KINDS)[number];
export const OUTREACH_STATUSES = ["draft", "pending_approval", "approved", "rejected", "sent", "failed"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export interface Outreach {
  id: number;
  toName: string;
  toEmail: string;
  organisation: string;
  kind: OutreachKind;
  clientId: number | null;
  aboutBooking: boolean;
  subject: string;
  body: string;
  status: OutreachStatus;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  sentAt: string | null;
  error: string | null;
  portalUrl: string;
}
export interface OutreachFields {
  kind?: OutreachKind;
  toEmail?: string;
  toName?: string;
  organisation?: string;
  clientId?: number;
  aboutBooking?: boolean;
  subject?: string;
  body?: string;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see the one-to-one emails.");
  let response: Response;
  try {
    response = await fetch(`${config.workerUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.agentNovaKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`Couldn't reach Nova Bot: ${(error as Error).message}`);
  }
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // An empty or broken answer: the status says what happened
  }
  if (!response.ok) throw new Error(data.error || `Nova Bot said no (${response.status}).`);
  return data as T;
}

export async function draftOutreach(fields: OutreachFields): Promise<Outreach> {
  return (await call<{ outreach: Outreach }>("/nova-agent/outreach/draft", fields)).outreach;
}
export async function editOutreach(id: number, changes: OutreachFields): Promise<Outreach> {
  return (await call<{ outreach: Outreach }>(`/nova-agent/outreach/${encodeURIComponent(String(id))}/edit`, changes)).outreach;
}
export async function listOutreach(status?: OutreachStatus): Promise<Outreach[]> {
  return (await call<{ outreach: Outreach[] }>("/nova-agent/outreach", status ? { status } : {})).outreach ?? [];
}

// ===== Words for Claude =====

const KIND_WORDS: Record<OutreachKind, string> = { business: "business", client: "client", reply: "reply to someone who wrote in" };
const STATUS_WORDS: Record<OutreachStatus, string> = {
  draft: "draft",
  pending_approval: "waiting for an admin's approval (not sent)",
  approved: "approved, going out now",
  rejected: "rejected (not sent)",
  sent: "sent",
  failed: "didn't send",
};

// One email in a line
export function outreachLine(o: Outreach): string {
  const to = [o.toName, o.organisation].filter(Boolean).join(", ");
  return [
    `#${o.id} “${o.subject}”`,
    `to ${to ? `${to} <${o.toEmail}>` : o.toEmail}`,
    `${KIND_WORDS[o.kind] || o.kind}${o.kind === "client" ? (o.aboutBooking ? " (about their booking)" : " (studio news; they said yes)") : ""}`,
    STATUS_WORDS[o.status] || o.status,
    o.status === "sent" && o.sentAt ? `sent ${ukWhen(o.sentAt)}` : "",
    o.decidedByName && o.status !== "pending_approval" ? `${o.status === "rejected" ? "rejected" : "approved"} by ${o.decidedByName}` : "",
    o.note ? `note: ${o.note}` : "",
    o.status === "failed" && o.error ? `why: ${o.error}` : "",
    o.portalUrl,
  ]
    .filter(Boolean)
    .join(" · ");
}
