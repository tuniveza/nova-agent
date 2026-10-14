// Email campaigns (newsletters to fans and clients, sent by Nova Bot through the studio's own
// mail server, a few a minute), for Agent.
//
// The campaigns live on Nova Bot's worker. Agent reads them and writes DRAFTS there with Nova
// Agent's key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/campaigns/context   {}                                   -> audiences, the last 5 (with stats), today
//   POST /nova-agent/campaigns/draft     { subject, body, audience, sendAt? } -> a new draft, waiting for approval
//   POST /nova-agent/campaigns/:id/edit  { subject?, body?, audience?, sendAt? } -> back to waiting for approval
//   POST /nova-agent/campaigns           { status? }                          -> the campaigns
//   POST /nova-agent/campaigns/:id       {}                                   -> one campaign and its log
//
// That's all the key can do. There is deliberately no approve, send, schedule or test-send here:
// a campaign goes out only when a signed-in admin presses Approve in Portal → Campaigns (or on the
// campaign's card under Agent's reply), with their own Portal sign-in in a browser, never this key.
// Nova Bot enforces the same thing on its side (it keeps a hash of exactly what was approved and
// refuses to send anything that changed since). Only opted-in people get it (confirmed fans and
// clients who said yes to studio news); Nova Bot adds the footer with why they're getting it and
// the unsubscribe link. Times come and go as UTC ISO; they're shown in UK time.
// The trace only gets ids and counts, never subjects, bodies or anyone's details.

import { config } from "./config";

export const AUDIENCES = ["fans", "clients", "everyone"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const CAMPAIGN_STATUSES = ["draft", "pending_approval", "approved", "rejected", "scheduled", "sent", "failed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignStats {
  sent?: number;
  delivered?: number;
  opened?: number;
  clicked?: number;
  bounced?: number;
  unsubscribed?: number;
  complained?: number;
  failed?: number; // the mail server wouldn't take it for these addresses
  skipped?: number; // unsubscribed after it was approved, before it reached them
  fetchedAt?: string | null;
}
export interface Campaign {
  id: number;
  subject: string;
  body: string;
  audience: Audience;
  sendAt: string | null; // UTC ISO, or null: as soon as it's approved
  status: CampaignStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  recipients: number | null;
  sentAt: string | null;
  error: string | null;
  stats: CampaignStats | null;
  // Going out now: how many have gone, of how many (null otherwise)
  sending?: { sent: number; total: number } | null;
  portalUrl: string;
}
// How many opted-in people each audience has
export interface Audiences {
  fans: number;
  clients: number;
  everyone: number;
}
export interface CampaignContext {
  audiences: Audiences;
  recent: Campaign[];
  today: string;
}
// The card under Agent's reply: the campaign, and how many people its audience has (when known)
export type CampaignCard = Campaign & { audienceCount: number | null };
// What a draft can have changed (sendAt null: as soon as it's approved)
export interface CampaignChanges {
  subject?: string;
  body?: string;
  audience?: Audience;
  sendAt?: string | null;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see the email campaigns.");
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
const at = (id: number) => `/nova-agent/campaigns/${encodeURIComponent(String(id))}`;

// Who's opted in, how the last few did, and today's date (for suggesting campaigns)
export async function campaignContext(): Promise<CampaignContext> {
  const r = await call<Partial<CampaignContext>>("/nova-agent/campaigns/context", {});
  return { audiences: r.audiences ?? { fans: 0, clients: 0, everyone: 0 }, recent: r.recent ?? [], today: r.today ?? "" };
}
// Save a new draft on Nova Bot. It waits there until an admin approves it.
export async function createDraft(draft: { subject: string; body: string; audience: Audience; sendAt?: string | null }): Promise<Campaign> {
  const body: Record<string, unknown> = { subject: draft.subject, body: draft.body, audience: draft.audience };
  if (draft.sendAt) body.sendAt = draft.sendAt;
  return (await call<{ campaign: Campaign }>("/nova-agent/campaigns/draft", body)).campaign;
}
// Change a draft (it goes back to waiting for approval; any approval is cleared)
export async function editDraft(id: number, changes: CampaignChanges): Promise<Campaign> {
  return (await call<{ campaign: Campaign }>(`${at(id)}/edit`, changes)).campaign;
}
export async function listCampaigns(status?: CampaignStatus): Promise<Campaign[]> {
  return (await call<{ campaigns: Campaign[] }>("/nova-agent/campaigns", status ? { status } : {})).campaigns ?? [];
}
export async function readCampaign(id: number): Promise<{ campaign: Campaign; log: any[] }> {
  const r = await call<{ campaign: Campaign; log?: any[] }>(at(id), {});
  return { campaign: r.campaign, log: r.log ?? [] };
}

// ===== Times =====

// A UK wall-clock time ("2026-10-16T18:00") as UTC ISO, whatever the clocks are doing that day
export function ukToUtc(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The UK's offset from UTC at an instant, in ms
  const offset = (t: number) => {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))) p[x.type] = x.value;
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t).toISOString();
}

// "Fri 16 Oct 2026, 18:00" in UK time
export const ukWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: config.timezone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/^(\p{L}+),/u, "$1");

// ===== Words for Claude =====

export const AUDIENCE_NAMES: Record<Audience, string> = { fans: "fans", clients: "studio clients", everyone: "everyone (fans and studio clients)" };
const STATUS_WORDS: Record<CampaignStatus, string> = {
  draft: "draft",
  pending_approval: "waiting for an admin's approval (not sent)",
  approved: "approved, going out now",
  rejected: "rejected (not sent)",
  scheduled: "approved and scheduled",
  sent: "sent",
  failed: "didn't send",
};
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

export function audienceLine(a: Audiences): string {
  return `Opted in now: ${people(a.fans)} as confirmed fans (signed up and confirmed by email); ${people(a.clients)} as studio clients who said yes to studio news; ${people(a.everyone)} in all (each person once).`;
}
const audienceSize = (audience: Audience, a: Audiences | null) => (a ? a[audience] : null);

// A whole number as a percentage of another, in plain words ("44%"); nothing when there's nothing to divide by
export const percent = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : null);

// How a sent campaign did, in plain words
export function statsText(c: Campaign): string {
  const s = c.stats || {};
  const sent = Number(s.sent ?? c.recipients ?? 0) || 0;
  const delivered = Number(s.delivered ?? 0) || 0;
  const base = delivered || sent;
  const baseWords = delivered ? "of those it reached" : "of those it went to";
  const opened = Number(s.opened ?? 0) || 0;
  const clicked = Number(s.clicked ?? 0) || 0;
  const parts = [
    `went to ${people(sent)}`,
    delivered ? `${delivered} delivered` : "",
    `${opened} opened it${percent(opened, base) ? ` (${percent(opened, base)} ${baseWords})` : ""}`,
    `${clicked} clicked a link${percent(clicked, base) ? ` (${percent(clicked, base)})` : ""}`,
    `${Number(s.unsubscribed ?? 0) || 0} unsubscribed`,
    Number(s.failed) ? `${s.failed} didn't go (the address was refused)` : "",
    Number(s.skipped) ? `${s.skipped} unsubscribed before it reached them` : "",
    Number(s.bounced) ? `${s.bounced} bounced` : "",
    Number(s.complained) ? `${s.complained} marked it as spam` : "",
  ].filter((p) => p && !(p.startsWith("0 opened") || p.startsWith("0 clicked")));
  return `It ${parts.join(", ")}. (The studio's own mail server sent it; opens and clicks aren't tracked, unsubscribes are counted.)`;
}

// One campaign in a line
export function campaignLine(c: Campaign, a: Audiences | null = null): string {
  const size = audienceSize(c.audience, a);
  return [
    `#${c.id} “${c.subject}”`,
    STATUS_WORDS[c.status] || c.status,
    `to ${AUDIENCE_NAMES[c.audience] || c.audience}${size !== null ? ` (${people(size)} opted in now)` : ""}`,
    c.status === "sent" && c.sentAt ? `sent ${ukWhen(c.sentAt)}${c.recipients !== null ? ` to ${people(c.recipients)}` : ""}` : c.sendAt ? `sends ${ukWhen(c.sendAt)} (UK time)` : c.status === "pending_approval" || c.status === "draft" ? "sends as soon as it's approved" : "",
    c.decidedByName && c.status !== "pending_approval" ? `${c.status === "rejected" ? "rejected" : "approved"} by ${c.decidedByName}` : "",
    c.note ? `note: ${c.note}` : "",
    c.status === "failed" && c.error ? `why: ${c.error}` : "",
    c.portalUrl ? c.portalUrl : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// A campaign's results (or where it's up to, if it hasn't gone yet)
export function resultsText(c: Campaign): string {
  const head = `“${c.subject}” (#${c.id}, to ${AUDIENCE_NAMES[c.audience] || c.audience})`;
  if (c.status === "sent") return `${head} was sent ${c.sentAt ? ukWhen(c.sentAt) : ""}. ${statsText(c)}`.replace(" . ", ". ");
  if (c.status === "scheduled" && c.sending) return `${head} is going out now, a few a minute: ${c.sending.sent} of ${c.sending.total} sent so far.`;
  if (c.status === "scheduled") return `${head} is approved and scheduled for ${c.sendAt ? ukWhen(c.sendAt) : "later"} (UK time), so there are no results yet.`;
  if (c.status === "failed") return `${head} didn't send${c.error ? `: ${c.error}` : ""}. There are no results.`;
  if (c.status === "rejected") return `${head} was rejected${c.decidedByName ? ` by ${c.decidedByName}` : ""}${c.note ? ` (“${c.note}”)` : ""}, so it wasn't sent.`;
  return `${head} hasn't been sent: it's ${STATUS_WORDS[c.status] || c.status}. Nothing is sent until an admin approves it in Portal → Campaigns.`;
}

// What suggest_campaign gives Claude: who's opted in, how the recent ones did, and what to do next
export function contextText(ctx: CampaignContext): string {
  const lines = [`Today is ${ctx.today || "unknown"} (UK).`, audienceLine(ctx.audiences)];
  if (ctx.recent.length) {
    lines.push("", `The last ${ctx.recent.length} campaign${ctx.recent.length === 1 ? "" : "s"}:`);
    for (const c of ctx.recent) lines.push(`- ${campaignLine(c, ctx.audiences)}${c.status === "sent" ? `. ${statsText(c)}` : ""}`);
  } else lines.push("", "No campaigns yet: this would be the first.");
  lines.push(
    "",
    "Nothing has been saved. Suggest 1–3 campaign ideas in your reply (for each: a subject line, who it's for and how many that is, when to send it in UK time, and why now), drawing on the dates, the studio's news and what did well before. When they pick one, write it with create_campaign_draft; it then waits for an admin to approve it in Portal → Campaigns before anything is sent."
  );
  if (!ctx.audiences.everyone) lines.push("Nobody has opted in yet, so a campaign would reach no one: suggest sharing the fan sign-up link (in Portal → Campaigns) first.");
  return lines.join("\n");
}
