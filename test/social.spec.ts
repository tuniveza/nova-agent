// Quest 4: social posts. The pictures and videos kept on this computer (src/social-media.ts), the
// relay's lock on their addresses (src/relay.ts), and Agent's social tools (src/social.ts,
// socialTools in src/chat.ts): Agent can look, draft, edit and draft replies; it can never approve
// or post (an admin does that in Portal → Social with their own sign-in). Nova Bot is pretend.
// Run: npm test
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localStore, readRange, sniff } from "../src/social-media";
import { relayAllowed } from "../src/relay";

const jpeg = (n = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const mp4 = (n = 3000) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(n, 1)]);

describe("the pictures and videos on this computer", () => {
  it("are recognised by their first bytes, not their name", () => {
    expect(sniff(jpeg())).toBe("jpg");
    expect(sniff(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]))).toBe("png");
    expect(sniff(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(10)]))).toBe("webp");
    expect(sniff(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(10)]))).toBe("gif");
    expect(sniff(mp4())).toBe("mp4");
    expect(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from("ftypqt  "), Buffer.alloc(10)]))).toBe("mov");
    expect(sniff(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniff(Buffer.from("%PDF-1.7 a document"))).toBeNull();
  });

  it("are saved under random ids with a clean label, found again, and removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "nova-social-media-"));
    const store = localStore(dir);
    const a = store.save(jpeg(), { name: "../../etc/pass<wd>.jpg", by: "ana" });
    expect(a).toMatchObject({ ext: "jpg", kind: "image", name: "passwd.jpg", size: 2004, by: "ana" });
    expect(a.id).toMatch(/^[a-f0-9]{32}$/);
    const b = store.save(mp4(), { name: "clip.mp4" });
    expect(b.id).not.toBe(a.id);
    expect(b.kind).toBe("video");
    expect(store.find(a.id)).toMatchObject({ id: a.id, ext: "jpg" });
    expect(store.find("../" + a.id)).toBeNull();
    expect(store.find("0".repeat(32))).toBeNull();
    expect(readdirSync(dir).sort()).toEqual([`${a.id}.jpg`, `${a.id}.json`, `${b.id}.json`, `${b.id}.mp4`].sort());
    expect(() => store.save(Buffer.from("not a picture at all"), { name: "x.jpg" })).toThrow(/isn't a picture or video/);
    expect(() => store.save(jpeg(9 * 1024 * 1024), { name: "huge.jpg" })).toThrow(/too big/);
    expect(store.remove(a.id)).toBe(true);
    expect(store.find(a.id)).toBeNull();
    expect(store.remove(a.id)).toBe(false);
  });

  it("are sent in pieces when asked (for videos)", () => {
    expect(readRange(undefined, 100)).toBeNull();
    expect(readRange("bytes=0-9", 100)).toEqual([0, 9]);
    expect(readRange("bytes=90-", 100)).toEqual([90, 99]);
    expect(readRange("bytes=-10", 100)).toEqual([90, 99]);
    expect(readRange("bytes=50-500", 100)).toEqual([50, 99]);
    expect(readRange("bytes=100-", 100)).toBe("bad");
    expect(readRange("bytes=9-3", 100)).toBe("bad");
  });

  it("are reached online only through their own addresses, by someone signed in", () => {
    const id = "a".repeat(32);
    const staff = { id: "sam", role: "staff" };
    expect(relayAllowed("GET", `/social-media/${id}.jpg`, staff)).toBe(true);
    expect(relayAllowed("GET", `/social-media/${id}.mp4`, { id: "nova-bot", role: "staff" })).toBe(true);
    expect(relayAllowed("POST", "/actions/social-media?name=x.jpg", staff)).toBe(true);
    expect(relayAllowed("POST", `/actions/social-media/${id}/remove`, staff)).toBe(true);
    expect(relayAllowed("GET", `/social-media/${id}.jpg`, null)).toBe(false);
    expect(relayAllowed("GET", `/social-media/${id}.json`, staff)).toBe(false);
    expect(relayAllowed("GET", "/social-media/../quests.json", staff)).toBe(false);
    expect(relayAllowed("GET", `/social-media/${id}%2e.jpg`, staff)).toBe(false);
    expect(relayAllowed("DELETE", `/social-media/${id}.jpg`, staff)).toBe(false);
  });
});

const post = (over: Record<string, unknown> = {}) => ({
  id: 7,
  caption: "New single out Friday 🎶 #novacane",
  platforms: ["facebook", "instagram"],
  media: [],
  postAt: null,
  status: "pending_approval",
  createdBy: "agent",
  createdAt: "2026-10-12T09:00:00.000Z",
  decidedByName: null,
  note: null,
  targets: {},
  postedAt: null,
  error: null,
  stats: null,
  portalUrl: "https://worker.test/portal/?view=social&post=7",
  ...over,
});
const posted = post({
  id: 5,
  status: "posted",
  postedAt: "2026-10-10T17:00:00.000Z",
  targets: { facebook: { mode: "auto", state: "posted", url: "https://www.facebook.com/111_5", error: null, postedAt: "2026-10-10T17:00:00.000Z" } },
  stats: { facebook: { reach: 321, likes: 9, comments: 1, shares: 2 }, instagram: { reach: 900, likes: 40, saved: 3 }, fetchedAt: "2026-10-11T09:00:00.000Z" },
});

describe("Agent's social tools", () => {
  let seen: { path: string; headers: Record<string, string>; body: any }[] = [];

  beforeEach(() => {
    process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-social-"));
    vi.resetModules();
    seen = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(String(init.body)) : null;
      seen.push({ path, headers: (init.headers || {}) as Record<string, string>, body });
      if (path === "/nova-agent/social/context") return Response.json({ connected: { facebook: true, instagram: false }, recent: [posted], followers: { facebook: { followers: 500, day: "2026-10-12", change: 20 } }, openComments: 2, today: "2026-10-12" });
      if (path === "/nova-agent/social/draft") return Response.json({ post: post({ caption: body.caption, platforms: body.platforms, postAt: body.postAt ?? null }) });
      if (path === "/nova-agent/social/7/edit") return Response.json({ post: post({ ...body }) });
      if (path === "/nova-agent/social/5") return Response.json({ post: posted, log: [] });
      if (path === "/nova-agent/social") return Response.json({ posts: body?.status === "posted" ? [posted] : [post(), posted] });
      if (path === "/nova-agent/social/comments") return Response.json({ comments: [{ id: 31, postId: 5, postCaption: "New single", platform: "facebook", author: "Sam Fan", text: "When's the open mic?", commentedAt: "2026-10-12T10:00:00.000Z", handled: false, reply: null, replyStatus: null }] });
      if (path === "/nova-agent/social/comments/31/reply") return Response.json({ comment: { id: 31, platform: "facebook", replyStatus: "pending_approval", reply: body.text } });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tool = async (name: string, actions: any[] = []) => {
    const { socialTools } = await import("../src/chat");
    return socialTools(actions).find((t: any) => t.name === name) as any;
  };

  it("look, draft, edit, list, results, comments and reply drafts: nothing that approves or posts", async () => {
    const { socialTools } = await import("../src/chat");
    const names = socialTools([]).map((t: any) => t.name);
    expect(names).toEqual(["social_context", "create_social_draft", "edit_social_draft", "list_social_posts", "social_results", "list_social_comments", "draft_comment_reply"]);
    expect(names.filter((n: string) => /approve|publish|schedule|decide|reject|send|post_now|mark/.test(n))).toEqual([]);
    const api = await import("../src/social");
    expect(Object.keys(api).filter((k) => /approve|publish|decide|reject|markPosted|send/i.test(k))).toEqual([]);
    for (const t of socialTools([]).filter((t: any) => /draft|reply/.test(t.name)) as any[]) expect(t.description).toMatch(/admin/);
  });

  it("social_context reads with Nova Agent's key and saves nothing", async () => {
    const actions: any[] = [];
    const said = await (await tool("social_context", actions)).run({});
    expect(seen).toEqual([{ path: "/nova-agent/social/context", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: {} }]);
    expect(said).toContain("Facebook is connected");
    expect(said).toContain("Facebook: 500 followers (+20");
    expect(said).toContain("Nothing has been saved");
    expect(said).toContain("2 comments waiting");
    expect(said).toMatch(/Facebook: reached 321, 9 likes/);
    expect(actions.every((a) => a.kind === "looked")).toBe(true);
  });

  it("create_social_draft saves a draft only and says plainly nothing is posted", async () => {
    const actions: any[] = [];
    const said = await (await tool("create_social_draft", actions)).run({ caption: "Open late this week", platforms: ["instagram"] });
    expect(seen[0]).toEqual({ path: "/nova-agent/social/draft", headers: expect.objectContaining({ Authorization: "Bearer test-key" }), body: { caption: "Open late this week", platforms: ["instagram"] } });
    expect(said).toContain("NOT posted");
    expect(said).toMatch(/nothing has been posted|Nothing has been posted/);
    expect(said).toMatch(/Instagram needs a picture or video/);
    expect(actions).toEqual([{ kind: "social", text: expect.stringContaining("waiting for an admin"), url: expect.stringContaining("view=social&post=7") }]);
  });

  it("a post time is UK wall-clock turned into UTC; a time that's gone isn't sent at all", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
    try {
      await (await tool("create_social_draft")).run({ caption: "S", platforms: ["facebook"], post_at: "2026-11-06T18:00" });
      expect(seen[0].body.postAt).toBe("2026-11-06T18:00:00.000Z");
      seen = [];
      await (await tool("create_social_draft")).run({ caption: "S", platforms: ["facebook"], post_at: "2026-10-16T18:00" });
      expect(seen[0].body.postAt).toBe("2026-10-16T17:00:00.000Z");
      seen = [];
      const said = await (await tool("create_social_draft")).run({ caption: "S", platforms: ["facebook"], post_at: "2026-10-01T18:00" });
      expect(seen).toEqual([]);
      expect(said).toMatch(/Nothing was saved/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("edit, results, comments and a reply draft go to the right addresses", async () => {
    const edited = await (await tool("edit_social_draft")).run({ id: 7, caption: "Changed", post_when_approved: true });
    expect(seen[0]).toMatchObject({ path: "/nova-agent/social/7/edit", body: { caption: "Changed", postAt: null } });
    expect(edited).toMatch(/back to waiting for approval/);
    seen = [];
    const results = await (await tool("social_results")).run({});
    expect(seen[0]).toMatchObject({ path: "/nova-agent/social", body: { status: "posted" } });
    expect(results).toMatch(/Instagram: reached 900, 40 likes, 3 saves/);
    seen = [];
    const list = await (await tool("list_social_comments")).run({});
    expect(list).toContain("from Sam Fan");
    expect(list).toContain("not answered yet");
    const replied = await (await tool("draft_comment_reply")).run({ id: 31, text: "Every Thursday from 7pm!" });
    expect(seen.at(-1)).toMatchObject({ path: "/nova-agent/social/comments/31/reply", body: { text: "Every Thursday from 7pm!" } });
    expect(replied).toMatch(/NOT posted/);
  });
});
