// The phone preview's Quests: made-up quests (no real people) answering the addresses Quests uses, kept in
// memory so ticks, moves, edits and deletes stay. Also a stand-in for /quests/events (window.NovaSampleQuestsPing()
// says "changed"), and Nova Agent's computer off (window.NovaSampleQuestsOff = true: Portal's last copy).
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const stamp = (mins) => { const d = new Date(now.getTime() + mins * 60000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dayAt = (offset, hm) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hm}`; };
  const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
  const base = { owner: "me", ownerName: "Alex", missionId: "", notes: "", minutes: 30, ongoing: false, every: "day", everyMinutes: 60, sessions: 0, priority: "normal", deadline: "", earliest: "", location: "", travelMinutes: 0, travelStart: "", timeOfDay: "any", fixedStart: "", status: "todo", mode: "waiting", from: "", phones: [], steps: [], tags: [], order: 0, start: "", end: "", atRisk: false, completed: "" };
  const Q = (x) => ({ ...base, ...x });
  const quests = [
    Q({ id: "q1", title: "Finish the Lowlands mix notes", status: "doing", mode: "working", start: stamp(-20), end: stamp(40), minutes: 60, priority: "high", tags: ["mix"], notes: "Keep it short: three things per song.", steps: [{ id: "s1", text: "Kick and bass", done: true }, { id: "s2", text: "Vocal rides", done: false }, { id: "s3", text: "Send to Kai", done: false }] }),
    Q({ id: "q2", title: "Call the piano tuner", mode: "soon", start: stamp(90), end: stamp(105), minutes: 15, tags: ["studio"], from: "Notes · Studio plan" }),
    Q({ id: "q3", title: "Post the Night Drive teaser", deadline: stamp(60 * 26), minutes: 30, priority: "high", tags: ["social"], atRisk: true }),
    Q({ id: "q4", title: "Order new XLR cables", status: "done", mode: "done", completed: iso(200), tags: ["studio"] }),
    Q({ id: "q5", title: "Back up the session drives", status: "done", mode: "done", completed: iso(60 * 26) }),
    Q({ id: "q6", title: "Practise scales", ongoing: true, every: "day", minutes: 20, start: dayAt(1, "08:00"), end: dayAt(1, "08:20"), sessions: 4, tags: ["practice"] }),
    Q({ id: "q7", title: "Drink some water", ongoing: true, every: "interval", everyMinutes: 2, minutes: 0.5, deadline: dayAt(0, "23:00") }),
    Q({ id: "q8", title: "Send the stems to Kai", mode: "questions", start: dayAt(-1, "15:00"), end: dayAt(-1, "15:30"), priority: "critical", tags: ["mix"] }),
    Q({ id: "q9", title: "Book the video shoot location", missionId: "m1", mode: "longer", start: dayAt(2, "10:00"), end: dayAt(2, "11:00"), minutes: 60, location: "Riverside studios", travelMinutes: 25, travelStart: dayAt(2, "09:35"), phones: ["a1b2c3d4e5f6"] }),
    Q({ id: "q10", title: "Tidy the cable drawer", priority: "low", timeOfDay: "afternoon", minutes: 45 }),
    Q({ id: "q11", title: "Reply to the venue about the launch", status: "skipped" }),
  ];
  const theirs = Q({ id: "q20", owner: "jordan", ownerName: "Jordan", title: "Restring the bass", mode: "soon", start: stamp(150), end: stamp(180), tags: ["studio"] });
  const missions = [{ id: "m1", owner: "me", ownerName: "Alex", title: "Release the Night Drive EP", summary: "Four singles, a video and a launch show by spring.", status: "active", deadline: dayAt(120, "00:00"), progress: { total: 6, done: 2, atRisk: 1, minutesLeft: 480, tracks: [], nextMilestone: null } }];
  const rhythm = { wake: "07:30", sleep: "23:30", phonePush: true, remindMinutesBefore: 10 };
  const phones = [{ id: "a1b2c3d4e5f6", name: "Alex's iPhone", staffId: "me", who: "Alex" }, { id: "0f1e2d3c4b5a", name: "Studio Android", staffId: "jordan", who: "Jordan" }];
  const open = (q) => q.status === "todo" || q.status === "doing";
  const isPulse = (q) => q.ongoing && q.every === "interval" && q.everyMinutes < 5;
  const state = (everyone) => {
    const list = everyone ? [...quests, theirs] : quests;
    const nowStamp = stamp(0);
    const doing = quests.find((q) => q.status === "doing") || null;
    return {
      now: nowStamp, rhythm, missions, quests: list, blocks: [], current: doing,
      next: quests.filter((q) => open(q) && q.start && q.start > nowStamp && !isPulse(q)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3),
      overdue: list.filter((q) => q.start && q.end < nowStamp && q.status === "todo"),
      unplanned: list.filter((q) => open(q) && !q.start && !isPulse(q)),
      pulses: list.filter((q) => open(q) && isPulse(q)),
      notices: [], person: { id: "me", name: "Alex", role: "admin" }, scope: everyone ? "everyone" : "mine", canSeeEveryone: true,
    };
  };
  const ok = (result) => ({ ok: true, result });
  const shift = (s, m) => { if (!s) return s; const d = new Date(`${s}:00`); d.setMinutes(d.getMinutes() + m); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  window.NovaSampleQuests = { quests, rhythm, sent: [] };

  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (/^\/(quests|actions\/(quests|rhythm|replan))|^\/app\/api\/(quests|push\/phones)/.test(p)) window.NovaSampleQuests.sent.push({ method, path: p + u.search, body });
    if (p === "/quests/state" && method === "GET") return window.NovaSampleQuestsOff ? { status: 503, body: { error: "The studio computer is off or offline", pcOffline: true } } : state(u.searchParams.get("who") === "everyone");
    if (p === "/app/api/quests" && method === "GET") return { at: iso(7), online: false, me: "me", scope: u.searchParams.get("who") === "everyone" ? "everyone" : "mine", canSeeEveryone: true, state: state(u.searchParams.get("who") === "everyone") };
    if (p === "/app/api/quests/action" && method === "POST") return { ok: true };
    if (p === "/app/api/push/phones" && method === "GET") return { phones, me: "me" };
    if (method !== "POST") return undefined;
    if (p === "/actions/quests") { const q = Q({ ...body, id: `q${quests.length + 30}`, status: "todo", mode: "waiting", created: new Date().toISOString() }); quests.push(q); return ok(q); }
    if (p === "/actions/quests/order") { (body.ids || []).forEach((id, i) => { const q = quests.find((x) => x.id === id); if (q) q.order = i + 1; }); return ok({ ordered: (body.ids || []).length }); }
    if (p === "/actions/rhythm") { Object.assign(rhythm, body); return ok(rhythm); }
    if (p === "/actions/replan") { for (const q of quests) if (open(q) && !q.start && !isPulse(q)) { q.start = stamp(240); q.end = stamp(240 + (q.minutes || 30)); } return ok({ atRisk: 0, unplaced: 0 }); }
    const m = p.match(/^\/actions\/quests\/([\w-]+)$/);
    if (!m) return undefined;
    const i = quests.findIndex((x) => x.id === m[1]);
    const q = quests[i];
    if (!q) return { status: 404, body: { ok: false, message: "There's no quest like that." } };
    const a = body.action;
    if (a === "done") { if (q.ongoing) { q.sessions++; q.status = "todo"; q.start = shift(q.start, q.every === "interval" ? q.everyMinutes : 1440); q.end = shift(q.end, q.every === "interval" ? q.everyMinutes : 1440); } else { q.status = "done"; q.mode = "done"; q.completed = new Date().toISOString(); } }
    else if (a === "finish") { q.status = "done"; q.mode = "done"; q.completed = new Date().toISOString(); }
    else if (a === "start") { q.status = "doing"; if (!["working", "nearly", "longer"].includes(q.mode)) q.mode = "working"; }
    else if (a === "skip") q.status = "skipped";
    else if (a === "reopen") { q.status = "todo"; q.mode = "waiting"; q.completed = ""; }
    else if (a === "snooze") { q.start = shift(q.start || stamp(0), body.minutes || 15); q.end = shift(q.end || stamp(30), body.minutes || 15); }
    else if (a === "mode") { q.mode = body.mode; q.status = body.mode === "done" ? "done" : ["working", "nearly", "longer"].includes(body.mode) ? "doing" : q.status === "doing" ? "todo" : q.status; }
    else if (a === "remove") { quests.splice(i, 1); return ok({ removed: q.id }); }
    else if (body.changes) {
      const { mode, ...rest } = body.changes;
      if ("every" in rest && !["day", "weekday", "week", "interval"].includes(rest.every)) return { ok: false, message: "How often must be one of: day, weekday, week, interval." };
      Object.assign(q, rest);
      if (mode) { q.mode = mode; if (mode === "done") q.status = "done"; }
    }
    return ok(q);
  });

  // /quests/events: a stand-in that stays open and says "changed" when asked (other feeds: the real thing)
  const Real = window.EventSource;
  class SampleFeed {
    constructor(url) { this.url = String(url); this.on = {}; this.readyState = 1; SampleFeed.open.add(this); }
    addEventListener(type, fn) { (this.on[type] = this.on[type] || []).push(fn); }
    removeEventListener(type, fn) { this.on[type] = (this.on[type] || []).filter((f) => f !== fn); }
    close() { this.readyState = 2; SampleFeed.open.delete(this); }
  }
  SampleFeed.open = new Set();
  window.EventSource = function (url, opts) { return String(url).includes("/quests/events") ? new SampleFeed(url) : new Real(url, opts); };
  window.NovaSampleQuestsFeeds = () => SampleFeed.open.size;
  window.NovaSampleQuestsPing = () => { for (const f of SampleFeed.open) for (const fn of f.on.changed || []) fn({ data: String(Date.now()) }); };
})();
