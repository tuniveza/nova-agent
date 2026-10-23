// The phone preview: Agent's sample answers (made-up: no real people). While Agent is on screen (#agent…) these
// answer the plan, the conversation and its cards, files and Nova Agent's status, kept in memory; on
// any other screen they pass, so each place keeps its own sample data. Also: notices.js loaded as the real page
// will load it, a stand-in for the live line (window.NovaSampleNotice({ kind, title, message, questId }) sends a
// reminder), files' words, and Download / Open working from those words.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const stamp = (mins) => local(new Date(Date.now() + mins * 60000));
  const day = (offset, hhmm = "") => { const d = new Date(); d.setDate(d.getDate() + offset); const s = local(d).slice(0, 10); return hhmm ? `${s}T${hhmm}` : s; };
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const onAgent = () => location.hash.startsWith("#agent");

  // notices.js, loaded with the page as on the real site
  document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector('script[src$="notices.js"]')) return;
    const s = document.createElement("script");
    s.src = "notices.js";
    document.head.append(s);
  });
  // A stand-in for the live line to Nova Agent
  class FakeEventSource extends EventTarget {
    constructor(url) { super(); this.url = url; this.readyState = 0; FakeEventSource.open.add(this); setTimeout(() => { if (this.readyState === 0) { this.readyState = 1; this.dispatchEvent(new Event("open")); } }, 60); }
    close() { this.readyState = 2; FakeEventSource.open.delete(this); }
  }
  FakeEventSource.open = new Set();
  window.NovaEventSource = FakeEventSource;
  window.NovaSampleNotice = (n) => { for (const es of FakeEventSource.open) es.dispatchEvent(new MessageEvent(n.kind === "changed" ? "changed" : "notice", { data: JSON.stringify(n) })); };

  // ---- The plan ----
  const me = { id: "s1", name: "Jordan Lee", role: "admin" };
  const quests = [
    { id: "aq1", owner: "s1", title: "Mix the vocals for Night Drive", status: "doing", mode: "working", start: stamp(-30), end: stamp(30), minutes: 60, priority: "high", location: "Studio A", phones: [] },
    { id: "aq2", owner: "s1", title: "Film the teaser clip", status: "todo", mode: "soon", start: stamp(70), end: stamp(115), minutes: 45, priority: "normal", location: "Riverside", travelStart: stamp(50), travelMinutes: 20, phones: ["p1"] },
    { id: "aq3", owner: "s1", title: "Call the piano tuner", status: "todo", mode: "waiting", start: stamp(150), end: stamp(165), minutes: 15, priority: "normal", from: "Notes · Studio plan", phones: [] },
    { id: "aq4", owner: "s1", title: "Order new XLR cables", status: "done", mode: "done", start: stamp(-200), end: stamp(-170), minutes: 30, priority: "low", phones: [] },
    { id: "aq5", owner: "s1", title: "Practise scales", status: "todo", mode: "waiting", ongoing: true, every: "day", sessions: 4, start: stamp(220), end: stamp(240), minutes: 20, priority: "normal", phones: [] },
    { id: "aq6", owner: "s1", title: "Send the stems to Kai", status: "todo", mode: "questions", start: stamp(-120), end: stamp(-90), minutes: 30, priority: "high", phones: [] },
    { id: "aq7", owner: "s1", title: "Post the single's artwork", status: "todo", mode: "soon", start: day(1, "11:00"), end: day(1, "11:30"), minutes: 30, priority: "normal", phones: [] },
    { id: "aq8", owner: "s1", title: "Write the press release", status: "todo", mode: "waiting", start: day(2, "10:00"), end: day(2, "11:30"), minutes: 90, priority: "high", atRisk: true, deadline: day(2, "18:00"), phones: [] },
    { id: "aq9", owner: "s1", title: "Back up the session drives", status: "todo", mode: "waiting", minutes: 90, priority: "normal", phones: [] },
    { id: "aq10", owner: "s1", title: "Book the launch venue", status: "todo", mode: "waiting", minutes: 60, priority: "high", phones: [] },
    { id: "ap1", owner: "s1", title: "Stretch", status: "doing", mode: "working", ongoing: true, every: "interval", everyMinutes: 1, minutes: 0.5, priority: "normal", phones: [] },
    { id: "aq11", owner: "s2", ownerName: "Sam Okoro", title: "Restring the house guitar", status: "todo", mode: "waiting", start: stamp(100), end: stamp(130), minutes: 30, priority: "normal", phones: [] },
    { id: "aq12", owner: "s1", title: "Sign off the mixes", status: "done", mode: "done", start: day(-3, "15:00"), end: day(-3, "16:00"), minutes: 60, phones: [] },
  ];
  const missions = []; // (Missions are gone from Nova, 23 Oct 2026)
  let blocks = [{ id: "ab1", owner: "s1", reason: "Dentist", start: stamp(300), end: stamp(360) }, { id: "ab2", owner: "s1", reason: "Away at the festival", start: day(4, "09:00"), end: day(4, "22:00") }];
  let rhythm = { wake: "07:30", sleep: "23:30", startUpMinutes: 30, windDownMinutes: 45, bufferMinutes: 10, remindMinutesBefore: 10, breakAfterMinutes: 120, breakMinutes: 15, maxQuestHoursPerDay: 8, horizonDays: 14, homeBase: "Studio", daysOff: [0], checkIns: true, dailyBriefing: true, phonePush: true, paceLimits: true };
  const isPulse = (q) => q.ongoing && q.every === "interval" && q.everyMinutes < 5;
  function progress(m) {
    const qs = quests.filter((q) => q.missionId === m.id);
    const tracks = m.tracks.map((t) => { const mine = qs.filter((q) => q.track === t.name && q.status !== "skipped"); return { ...t, done: mine.filter((q) => q.status === "done").length, total: mine.length }; });
    return { total: qs.filter((q) => q.status !== "skipped").length, done: qs.filter((q) => q.status === "done").length, atRisk: qs.filter((q) => q.atRisk && q.status !== "done").length, minutesLeft: qs.filter((q) => q.status === "todo" || q.status === "doing").reduce((n, q) => n + q.minutes, 0), tracks, nextMilestone: m.milestones.find((x) => !x.done) || null };
  }
  function questState(everyone) {
    const now = stamp(0);
    const sees = (x) => everyone || !x.owner || x.owner === me.id;
    const qs = quests.filter(sees), own = quests.filter((q) => q.owner === me.id);
    const open = qs.filter((q) => q.status === "todo" || q.status === "doing");
    const openOwn = own.filter((q) => q.status === "todo" || q.status === "doing");
    const doing = own.find((q) => q.status === "doing" && !isPulse(q)) || openOwn.find((q) => q.start && q.start <= now && q.end > now && !isPulse(q)) || null;
    return {
      now, rhythm, person: me, scope: everyone ? "everyone" : "mine", canSeeEveryone: true,
      missions: missions.filter(sees).map((m) => ({ ...m, progress: progress(m) })),
      quests: qs, blocks: blocks.filter(sees), current: doing,
      next: openOwn.filter((q) => !isPulse(q) && q.start && q.start > now && q.id !== doing?.id).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3),
      overdue: open.filter((q) => q.start && q.end < now && q.status === "todo"), unplanned: open.filter((q) => !q.start && !isPulse(q)), pulses: open.filter(isPulse), notices: [],
    };
  }
  const changed = () => setTimeout(() => window.NovaSampleNotice && window.NovaSampleNotice({ kind: "changed" }), 30);

  // ---- Files Nova Agent wrote, and their words ----
  const FILES = {
    af1: { meta: { id: "af1", title: "Night Drive release plan", name: "release-plan.md", type: "md", updated: iso(2000) }, text: "# Night Drive release plan\n\nFour singles, then the EP.\n\n## The singles\n\n| Single | Date | Video |\n|---|---|---|\n| Night Drive | 1 Nov | Yes |\n| Lowlands | 29 Nov | No |\n\n## Checklist\n\n- [x] Mixes signed off\n- [ ] Artwork for single 1\n- [ ] Press release\n\n> Release on Fridays at 6pm.\n\n```\nmaster: -14 LUFS\n```" },
    af2: { meta: { id: "af2", title: "Gear budget", name: "gear-budget.csv", type: "csv", updated: iso(5000) }, text: "Item,Shop,Price,Needed by,Notes\nAudio interface,Thomann,£399,Next week,For the live room\nXLR cables (6),Andertons,£54,Friday,Already ordered\nPop filter,Amazon,£12,Any time," },
    af3: { meta: { id: "af3", title: "Session settings", name: "session.json", type: "json", updated: iso(9000) }, text: '{"tempo":92,"key":"D lydian","tracks":["Vox","Keys","Bass"]}' },
    af4: { meta: { id: "af4", title: "Launch show flyer", name: "flyer.html", type: "html", updated: iso(12000) }, text: '<html><head><style>h1{color:red}</style><script>alert(1)</script></head><body><h1 style="color:pink">Night Drive: the launch show</h1><p>Doors at <b>7pm</b>, at <a href="https://example.com/venue">the Riverside Rooms</a>.</p><img src="x.png"><ul><li>Support: The Lanterns</li><li>Tickets £8</li></ul></body></html>' },
  };
  const fileCard = (f) => ({ ...f.meta, size: new Blob([f.text]).size, url: `/files/${f.meta.id}/${f.meta.name}` });
  const fileFor = (path) => { const m = path.match(/^\/files\/([^/]+)\/([^/?]+)/); return m && FILES[m[1]] && FILES[m[1]].meta.name === decodeURIComponent(m[2]) ? FILES[m[1]] : null; };
  const madeNotes = [];
  // (outside the sample server: a file's words come back as words, and Notes hears of a note made here)
  const inner = window.fetch;
  window.fetch = async (input, opts = {}) => {
    const u = new URL(typeof input === "string" ? input : input.url, location.href);
    const f = u.origin === location.origin && fileFor(u.pathname);
    if (f) { await new Promise((r) => setTimeout(r, 150)); return new Response(f.text, { status: 200, headers: { "Content-Type": f.meta.type === "html" ? "text/html" : "text/plain" } }); }
    if (/^\/files\/[^/]+\//.test(u.pathname)) return new Response("Not found", { status: 404 });
    if (u.pathname === "/notes-api/changes" && madeNotes.length) { const r = await inner(input, opts); const d = await r.json(); return new Response(JSON.stringify({ ...d, notes: [...(d.notes || []), ...madeNotes] }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    return inner(input, opts);
  };
  // Download and Open, from the file's words
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/files/"]');
    if (!a) return;
    const f = fileFor(new URL(a.href, location.href).pathname);
    if (!f) return;
    e.preventDefault();
    const url = URL.createObjectURL(new Blob([f.text], { type: f.meta.type === "html" ? "text/html" : "text/plain" }));
    if (a.hasAttribute("download")) { const x = Object.assign(document.createElement("a"), { href: url, download: f.meta.name }); document.body.append(x); x.click(); x.remove(); } else window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, true);

  // ---- The conversation, with a card of each kind ----
  let draftStatus = "draft";
  const booking = { id: 7, kind: "reschedule", status: "pending", summary: "Move Kai Bennett's vocal session from Fri 14:00 to Sat 11:00 (they'll be emailed)", reason: "Kai asked by email to move it", payload: { start: new Date(Date.now() + 2 * 864e5).toISOString(), notifyClient: true } };
  const campaign = { id: 5, subject: "Night Drive is out Friday", body: "Hi!\n\nOur new single **Night Drive** drops this Friday at 6pm. Here's a first listen, and a look behind the scenes at the sessions.\n\nSee you at the launch show,\nNovacane Studios", audience: "fans", status: "pending_approval", sendAt: new Date(Date.now() + 3 * 864e5).toISOString(), updatedAt: iso(60) };
  const audiences = { fans: 214, clients: 88, everyone: 280 };
  let chat = [
    { role: "user", content: "What's on today, and is anything waiting for me?" },
    { role: "assistant", content: "### Today\n1. **Mix the vocals** for Night Drive, until " + stamp(30).slice(11) + "\n2. *Film the teaser clip* at Riverside (leave at " + stamp(50).slice(11) + ")\n3. Call the piano tuner\n\n### Waiting for you\n- Maya's enquiry has a draft reply\n- Kai's booking change needs an admin\n- The Night Drive campaign is ready to approve", actions: [{ kind: "looked", text: `Looked at Acuity bookings, ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} – ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}` }, { kind: "draft", text: "Drafted a reply to Maya Rose, waiting for approval", draft: { id: 501, enquiryId: 41, name: "Maya Rose", email: "maya@example.com", subject: "Booking a vocal day", body: "Hi Maya, thanks for getting in touch! We have Saturday the 14th and Sunday the 22nd free for a full vocal day. Shall I hold one for you?" } }, { kind: "booking", text: "Proposed: Move Kai Bennett's vocal session (waiting for an admin)", booking: { ...booking } }] },
    { role: "user", content: "Write up the release plan as a file, and draft the campaign for Friday" },
    { role: "assistant", content: "Done. The plan is in your files, and the campaign is waiting for an admin's approval. I've also drafted a one-to-one email to the Riverside Choir and an invoice for Night Drive.", actions: [{ kind: "file", text: "Wrote release-plan.md", file: fileCard(FILES.af1) }, { kind: "file", text: "Wrote gear-budget.csv" }, { kind: "campaign", text: "Drafted an email campaign, waiting for an admin's approval", campaign: { ...campaign } }, { kind: "outreach", text: "Drafted an email to Ellie, waiting for an admin's approval", outreach: { id: 2, subject: "Studio time for your choir?", toName: "Ellie", toEmail: "ellie@example.com", organisation: "Riverside Choir", kind: "business", status: "pending_approval", body: "Hi Ellie, we record choirs in our live room…" } }, { kind: "added", text: "Wrote invoice NS-0033, waiting for an admin's approval", url: "/invoicer/?invoice=32" }, { kind: "social", text: "Drafted social post #7, waiting for an admin's approval", url: "https://nova.example/portal/?view=social&post=7" }, { kind: "added", text: `Added note card “Mix review”: ${new Date(Date.now() + 864e5).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, 14:00–15:00` }] },
  ];
  const reply = (text) => {
    const t = text.toLowerCase();
    if (/mission|plan .* by|release|ep\b/.test(t)) return { reply: "Planned ✦ I've made it a mission with three tracks and twelve quests. Open Missions to see the whole plan.", actions: [{ kind: "added", text: "Mission “Finish the EP”: 12 quests planned" }] };
    if (/out tonight|busy|away/.test(t)) return { reply: "Blocked out. Anything in that time has moved out of the way.", actions: [{ kind: "added", text: `Blocked ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} 19:00–23:00: Out` }] };
    return { reply: "This is the preview, so I can't really answer, but this is where my reply appears.", actions: [] };
  };

  (window.NovaSampleExtra = window.NovaSampleExtra || []).push(async (u, method, body) => {
    const p = u.pathname;
    if (!onAgent() && !(method === "POST" && /^\/actions\/quests\//.test(p) && document.querySelector(".nn-card"))) return undefined;
    if (p === "/app/api/push/phones") return { phones: [{ id: "p1", name: "Jordan's iPhone", who: "Jordan Lee" }, { id: "p2", name: "Studio Android", who: "Sam Okoro" }] };
    // (window.NovaSampleAgentOff = true: the studio's computer is off)
    if (window.NovaSampleAgentOff && /^\/(chat|status|quests|files|actions)/.test(p)) return { status: 503, body: { error: "The studio computer is off or offline", pcOffline: true } };
    if (p === "/status") return { live: true, connected: true, model: "claude-opus-5-5" };
    if (p === "/quests/state") return questState(u.searchParams.get("who") === "everyone");
    if (p === "/chat/history") return { ok: true, messages: chat, person: { id: me.id, owner: true } };
    if (p === "/files/list") return { files: Object.values(FILES).map(fileCard) };
    if (p === "/app/api/enquiries/thread") return { enquiry: { id: 41, name: "Maya Rose", email: "maya@example.com", state: "new" }, messages: [{ id: 501, status: draftStatus, body: chat[1].actions[1].draft.body, approver_name: draftStatus === "sent" ? "Jordan Lee" : null }], canSend: true };
    if (p === "/app/api/booking-actions" && method === "GET") return { actions: [{ ...booking }], canDecide: true };
    if (p === "/app/api/campaigns" && method === "GET") return { campaigns: [{ ...campaign }], canDecide: true, audiences };
    if (p === "/app/api/campaigns/5" && method === "GET") return { campaign: { ...campaign } };
    if (method === "GET") return undefined;
    // ---- writes ----
    if (p === "/actions/chat") { chat.push({ role: "user", content: body.message }); const r = reply(body.message); chat.push({ role: "assistant", content: r.reply, actions: r.actions }); await new Promise((res) => setTimeout(res, 600)); return { ok: true, ...r }; }
    if (p === "/actions/chat/clear") { chat = []; return { ok: true }; }
    if (p === "/app/api/enquiries/draft/approve") { draftStatus = "sent"; return { ok: true }; }
    const ba = p.match(/^\/app\/api\/booking-actions\/(approve|edit|reject)$/);
    if (ba) { if (ba[1] === "approve") Object.assign(booking, { status: "executed", decidedByName: "Jordan Lee" }, body.payload ? { payload: body.payload } : {}); if (ba[1] === "edit") booking.payload = body.payload; if (ba[1] === "reject") Object.assign(booking, { status: "rejected", decidedByName: "Jordan Lee" }); return { ok: true, action: { ...booking } }; }
    const ca = p.match(/^\/app\/api\/campaigns\/5\/(approve|edit|reject)$/);
    if (ca) { if (ca[1] === "approve") Object.assign(campaign, { status: campaign.sendAt ? "scheduled" : "sent", decidedByName: "Jordan Lee", sentAt: campaign.sendAt ? undefined : new Date().toISOString(), recipients: audiences[campaign.audience] }); if (ca[1] === "edit") Object.assign(campaign, body, { status: "pending_approval" }); if (ca[1] === "reject") Object.assign(campaign, { status: "rejected", decidedByName: "Jordan Lee" }); campaign.updatedAt = new Date().toISOString(); return { ok: true, campaign: { ...campaign } }; }
    const fr = p.match(/^\/actions\/files\/([^/]+)\/remove$/);
    if (fr) { delete FILES[decodeURIComponent(fr[1])]; return { ok: true }; }
    const nn = p.match(/^\/notes-api\/notes\/([^/]+)$/);
    if (nn && method === "PUT") { const note = { ...body, id: decodeURIComponent(nn[1]), rev: 1, by: "Jordan" }; delete note.base; madeNotes.push(note); return { ok: true, note }; }
    const q = p.match(/^\/actions\/quests\/([^/]+)$/);
    if (q) {
      const it = quests.find((x) => x.id === decodeURIComponent(q[1]));
      if (!it) return { status: 400, body: { ok: false, message: "No quest with that id." } };
      const a = body.action;
      if (a === "done") { if (it.ongoing && !isPulse(it)) { it.sessions = (it.sessions || 0) + 1; } else { it.status = "done"; it.mode = "done"; } }
      if (a === "finish") { it.status = "done"; it.mode = "done"; }
      if (a === "start") { it.status = "doing"; it.mode = "working"; }
      if (a === "skip") it.status = "skipped";
      if (a === "reopen") { it.status = "todo"; it.mode = "waiting"; }
      if (a === "snooze" && it.start) { const by = (Number(body.minutes) || 15) * 60000; it.start = local(new Date(new Date(it.start).getTime() + by)); it.end = local(new Date(new Date(it.end).getTime() + by)); if (it.status === "doing") it.status = "todo"; }
      if (a === "mode") it.mode = body.mode;
      if (body.changes) Object.assign(it, body.changes);
      changed();
      return { ok: true, result: it };
    }
    const mr = p.match(/^\/actions\/missions\/([^/]+)(?:\/(refine|export))?$/);
    if (mr) {
      const m = missions.find((x) => x.id === decodeURIComponent(mr[1]));
      if (!m) return { status: 400, body: { ok: false, message: "No mission with that id." } };
      if (mr[2] === "refine") { await new Promise((res) => setTimeout(res, 700)); m.refinements.push({ at: new Date().toISOString(), text: body.detail }); m.questions = m.questions.slice(1); changed(); return { ok: true, result: { mission: m, quests: quests.filter((x) => x.missionId === m.id && x.status !== "done"), atRisk: 1 } }; }
      if (mr[2] === "export") { const text = `# ${m.title}\n\n${m.summary}\n\n${m.strategy.map((s) => `## ${s.heading}\n\n${s.body}`).join("\n\n")}\n\n## Roadmap\n\n${m.milestones.map((x) => `- ${x.done ? "[x]" : "[ ]"} ${x.at.slice(0, 10)} ${x.title}`).join("\n")}`; FILES.afm = { meta: { id: "afm", title: `${m.title}: the plan`, name: "night-drive-ep-plan.md", type: "md", updated: new Date().toISOString() }, text }; return { ok: true, file: fileCard(FILES.afm) }; }
      if (body.milestone) { const x = m.milestones.find((y) => y.id === body.milestone); if (x) x.done = !!body.done; }
      if (body.status) m.status = body.status;
      if (body.remove) { missions.splice(missions.indexOf(m), 1); for (const x of quests.filter((y) => y.missionId === m.id)) x.status = "removed"; }
      changed();
      return { ok: true, result: m };
    }
    if (p === "/actions/missions") {
      await new Promise((res) => setTimeout(res, 900));
      const m = { id: `am${missions.length + 5}`, owner: "s1", title: String(body.request || "New mission").split(/[.,:]/)[0].slice(0, 60), summary: body.request, request: body.request, status: "active", deadline: body.deadline || "", created: new Date().toISOString(), tracks: [{ name: "Plan", colour: "#4CC9FF" }], milestones: [{ id: "amn1", title: "First step done", at: day(7, "18:00"), done: false }], strategy: [{ heading: "The approach", body: "- Start small\n- Keep going" }], assumptions: [], questions: ["When are you free to work on it?"], refinements: [], research: [], researched: "" };
      missions.unshift(m);
      quests.push({ id: `${m.id}-q1`, owner: "s1", title: "Make a start", status: "todo", mode: "waiting", start: day(1, "10:00"), end: day(1, "11:00"), minutes: 60, missionId: m.id, phones: [] });
      changed();
      return { ok: true, result: { mission: m, quests: quests.filter((x) => x.missionId === m.id), atRisk: 0 } };
    }
    if (p === "/actions/replan") { changed(); return { ok: true, result: { atRisk: 1 } }; }
    if (p === "/actions/blocks") { if (body.remove) blocks = blocks.filter((b) => b.id !== body.id); changed(); return { ok: true }; }
    if (p === "/actions/rhythm") { rhythm = { ...rhythm, ...body }; changed(); return { ok: true, result: rhythm }; }
    return undefined;
  });
})();
