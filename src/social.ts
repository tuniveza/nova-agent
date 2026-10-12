// Social posts (Facebook and Instagram, posted by Nova Bot after an admin approves them), for Agent.
//
// The posts live on Nova Bot's worker. Agent reads them and writes DRAFTS there with Nova Agent's
// key (AGENT_NOVA_KEY), at:
//   POST /nova-agent/social/context          {}                              -> connected, recent, followers, openComments, today
//   POST /nova-agent/social/draft            { caption, platforms, postAt? } -> a new draft, waiting for approval
//   POST /nova-agent/social/:id/edit         { caption?, platforms?, postAt? } -> back to waiting for approval
//   POST /nova-agent/social                  { status? }                     -> the posts
//   POST /nova-agent/social/:id              {}                              -> one post and its log
//   POST /nova-agent/social/comments         { open? }                       -> comments on the studio's posts
//   POST /nova-agent/social/comments/:id/reply { text }                     -> a reply, waiting for approval
//
// That's all the key can do. There is deliberately no approve or post here: a post (or a reply)
// goes out only when a signed-in admin presses Approve in Portal → Social, with their own Portal
// sign-in in a browser, never this key. Nova Bot enforces the same thing on its side (it keeps a
// hash of exactly what was approved and won't post anything that changed since). Pictures and
// videos are added in Portal by a person. Times come and go as UTC ISO; they're shown in UK time.
// The trace only gets ids and counts, never the words or anyone's names.

import { config } from "./config";
import { ukWhen } from "./campaigns";

export const PLATFORMS = ["facebook", "instagram"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const POST_STATUSES = ["draft", "pending_approval", "approved", "scheduled", "posting", "manual", "posted", "failed", "rejected"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export interface PlatformStats {
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  saved?: number;
  views?: number;
}
export interface SocialPost {
  id: number;
  caption: string;
  platforms: Platform[];
  media: { id: string; ext: string; kind: "image" | "video"; name: string }[];
  postAt: string | null;
  status: PostStatus;
  createdBy: string;
  createdAt: string;
  decidedByName: string | null;
  note: string | null;
  targets: Partial<Record<Platform, { mode: "auto" | "manual" | null; state: string | null; url: string | null; error: string | null; postedAt: string | null }>>;
  postedAt: string | null;
  error: string | null;
  stats: (Partial<Record<Platform, PlatformStats>> & { fetchedAt?: string }) | null;
  portalUrl: string;
}
export interface SocialComment {
  id: number;
  postId: number | null;
  postCaption: string | null;
  platform: Platform;
  author: string | null;
  text: string;
  commentedAt: string;
  handled: boolean;
  reply: string | null;
  replyStatus: string | null;
}
export interface SocialContext {
  connected: Record<Platform, boolean>;
  recent: SocialPost[];
  followers: Partial<Record<Platform, { followers: number; day: string; change: number }>>;
  openComments: number;
  today: string;
}

async function call<T>(path: string, body: unknown = {}): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY), so it can't see the social posts.");
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

export async function socialContext(): Promise<SocialContext> {
  const r = await call<Partial<SocialContext>>("/nova-agent/social/context", {});
  return { connected: r.connected ?? { facebook: false, instagram: false }, recent: r.recent ?? [], followers: r.followers ?? {}, openComments: r.openComments ?? 0, today: r.today ?? "" };
}
export async function createSocialDraft(draft: { caption: string; platforms: Platform[]; postAt?: string | null }): Promise<SocialPost> {
  const body: Record<string, unknown> = { caption: draft.caption, platforms: draft.platforms };
  if (draft.postAt) body.postAt = draft.postAt;
  return (await call<{ post: SocialPost }>("/nova-agent/social/draft", body)).post;
}
export async function editSocialDraft(id: number, changes: { caption?: string; platforms?: Platform[]; postAt?: string | null }): Promise<SocialPost> {
  return (await call<{ post: SocialPost }>(`/nova-agent/social/${encodeURIComponent(String(id))}/edit`, changes)).post;
}
export async function listSocialPosts(status?: PostStatus): Promise<SocialPost[]> {
  return (await call<{ posts: SocialPost[] }>("/nova-agent/social", status ? { status } : {})).posts ?? [];
}
export async function readSocialPost(id: number): Promise<SocialPost> {
  return (await call<{ post: SocialPost }>(`/nova-agent/social/${encodeURIComponent(String(id))}`, {})).post;
}
export async function listSocialComments(open = true): Promise<SocialComment[]> {
  return (await call<{ comments: SocialComment[] }>("/nova-agent/social/comments", { open })).comments ?? [];
}
export async function draftCommentReply(id: number, text: string): Promise<SocialComment> {
  return (await call<{ comment: SocialComment }>(`/nova-agent/social/comments/${encodeURIComponent(String(id))}/reply`, { text })).comment;
}

// ===== Words for Claude =====

export const PLATFORM_NAMES: Record<Platform, string> = { facebook: "Facebook", instagram: "Instagram" };
const on = (ps: readonly Platform[]) => ps.map((p) => PLATFORM_NAMES[p] || p).join(" and ");
const STATUS_WORDS: Record<PostStatus, string> = {
  draft: "draft",
  pending_approval: "waiting for an admin's approval (not posted)",
  approved: "approved, going out now",
  scheduled: "approved and scheduled",
  posting: "being posted now",
  manual: "approved, waiting for someone to post it by hand (Meta isn't connected)",
  posted: "posted",
  failed: "didn't post",
  rejected: "rejected (not posted)",
};

// How a posted one did, in plain words
export function postStatsText(p: SocialPost): string {
  const s = p.stats;
  if (!s) return p.status === "posted" ? "No results yet (they come from Meta every hour for 30 days, once Meta is connected)." : "";
  const parts: string[] = [];
  for (const pl of PLATFORMS) {
    const x = s[pl];
    if (!x) continue;
    const bits = [
      x.reach !== undefined ? `reached ${x.reach}` : "",
      x.views !== undefined ? `${x.views} views` : "",
      x.likes !== undefined ? `${x.likes} likes` : "",
      x.comments !== undefined ? `${x.comments} comments` : "",
      x.shares !== undefined ? `${x.shares} shares` : "",
      x.saved !== undefined ? `${x.saved} saves` : "",
      x.clicks !== undefined ? `${x.clicks} clicks` : "",
    ].filter(Boolean);
    if (bits.length) parts.push(`${PLATFORM_NAMES[pl]}: ${bits.join(", ")}`);
  }
  return parts.length ? `${parts.join("; ")}${s.fetchedAt ? ` (from Meta, ${ukWhen(s.fetchedAt)})` : ""}.` : "";
}

// One post in a line
export function postLine(p: SocialPost): string {
  const first = p.caption ? `“${p.caption.replace(/\s+/g, " ").slice(0, 80)}${p.caption.length > 80 ? "…" : ""}”` : "(no words)";
  const links = PLATFORMS.map((pl) => p.targets?.[pl]?.url).filter(Boolean);
  return [
    `#${p.id} ${first}`,
    STATUS_WORDS[p.status] || p.status,
    `on ${on(p.platforms)}`,
    p.media?.length ? `${p.media.length} picture${p.media.length === 1 ? "" : "s"}/video${p.media.length === 1 ? "" : "s"}` : "no pictures yet",
    p.status === "posted" && p.postedAt ? `posted ${ukWhen(p.postedAt)}` : p.postAt ? `posts ${ukWhen(p.postAt)} (UK time)` : p.status === "pending_approval" ? "posts as soon as it's approved" : "",
    p.note ? `note: ${p.note}` : "",
    p.status === "failed" && p.error ? `why: ${p.error}` : "",
    links.length ? links.join(" ") : "",
    p.portalUrl,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function contextText(ctx: SocialContext): string {
  const lines = [`Today is ${ctx.today || "unknown"} (UK).`];
  const connected = PLATFORMS.filter((p) => ctx.connected[p]);
  lines.push(
    connected.length === 2
      ? "Facebook and Instagram are connected: approved posts go out by themselves."
      : connected.length
        ? `${PLATFORM_NAMES[connected[0]]} is connected; posts for the other one wait for someone to post them by hand after approval.`
        : "Meta isn't connected yet: approved posts wait in Portal → Social for someone to post them by hand."
  );
  for (const p of PLATFORMS) {
    const f = ctx.followers[p];
    if (f) lines.push(`${PLATFORM_NAMES[p]}: ${f.followers} followers (${f.change >= 0 ? "+" : ""}${f.change} in about 30 days).`);
  }
  if (ctx.recent.length) {
    lines.push("", `The last ${ctx.recent.length} post${ctx.recent.length === 1 ? "" : "s"}:`);
    for (const p of ctx.recent) lines.push(`- ${postLine(p)}${p.status === "posted" ? `. ${postStatsText(p)}` : ""}`);
  } else lines.push("", "No posts yet: this would be the first.");
  if (ctx.openComments) lines.push("", `${ctx.openComments} comment${ctx.openComments === 1 ? "" : "s"} waiting for an answer (list_social_comments).`);
  lines.push(
    "",
    "Nothing has been saved. Suggest 1–3 post ideas (for each: the platforms, the caption, what picture or video to use, when to post in UK time, and why), drawing on what did well, the studio's news and what's trending (research it with web_search). When they pick one, write it with create_social_draft; someone adds the picture or video in Portal → Social, and an admin approves it there before anything is posted."
  );
  return lines.join("\n");
}

export function commentLine(c: SocialComment): string {
  return [
    `#${c.id} on ${PLATFORM_NAMES[c.platform] || c.platform}`,
    c.author ? `from ${c.author}` : "",
    `“${c.text.replace(/\s+/g, " ").slice(0, 300)}”`,
    c.postCaption ? `(on the post “${c.postCaption.slice(0, 60)}”)` : "",
    ukWhen(c.commentedAt),
    c.replyStatus === "pending_approval" ? `a reply is waiting for approval: “${(c.reply || "").slice(0, 120)}”` : c.replyStatus === "sent" ? "answered" : c.handled ? "dealt with" : "not answered yet",
  ]
    .filter(Boolean)
    .join(" · ");
}
