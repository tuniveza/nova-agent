// Nova Phone: Agent. Talking to Nova Agent (one conversation per person, kept by Nova Agent on the
// studio's PC, the same as on the computer), and what it runs for you:
//   Plan       today: what's on now and next, start it, done, 15 more minutes, not now, skip; re-plan; your rhythm
//   Missions   big goals planned into quests: new ones, each one's plan, roadmap, quests and questions to answer
//   Files      what Nova Agent made: read, save, copy, delete
// When the studio's PC is off, Agent says so; the rest of the app still works.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const HDR = { "X-Nova-Visualizer": "1" };
  const act = (path, body) => post(path, body, HDR).then((r) => { if (r && r.ok === false) throw new Error(r.message || "That didn't work."); return r; });
  let messages = null, waiting = false, offline = false;
  const PARTS = [["chat", "Chat"], ["plan", "Plan"], ["missions", "Missions"], ["files", "Files"]];
  const partTabs = (on) => `<div class="seg">${PARTS.map(([p, l]) => `<a class="seg-a" href="#agent${p === "chat" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;
  const pcOff = () => `<div class="empty">${icon("globe")}<b>Nova Agent's computer is off</b><span>Agent, its plan, missions and files live on the studio's computer. Everything else here still works.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`;
  const isOff = (err) => err && (err.status === 503 || err.status === 502 || err.data?.pcOffline);

  // A reply's words: paragraphs, lists, **bold**, `code` and links
  function words(text) {
    const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let ul = null;
    for (const line of String(text || "").split("\n")) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (item) { (ul ||= []).push(`<li>${inline(item[1])}</li>`); continue; }
      if (ul) { out.push(`<ul>${ul.join("")}</ul>`); ul = null; }
      if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
    }
    if (ul) out.push(`<ul>${ul.join("")}</ul>`);
    return out.join("");
  }
  // What Nova Agent did, under its reply; each leads to its place in the app where there is one
  function did(a) {
    const to = a.kind === "draft" && (a.draft?.enquiryId || a.draft?.enquiry_id) ? `#inbox/enquiry/${a.draft.enquiryId || a.draft.enquiry_id}` : a.kind === "booking" ? "#inbox/approvals" : a.kind === "file" ? "#agent/files" : a.kind === "campaign" || a.kind === "outreach" ? "#outreach" : a.kind === "social" ? "#outreach/social" : a.kind === "added" || a.kind === "changed" || a.kind === "removed" ? "#calendar" : "";
    const sym = { removed: "✕", looked: "◎", file: "▤", draft: "✉", campaign: "✉", outreach: "✉", booking: "◷", social: "◈" }[a.kind] || "✦";
    return `<li>${to ? `<a href="${to}">${sym} ${esc(a.text || a.kind)}</a>` : `${sym} ${esc(a.text || a.kind)}`}</li>`;
  }
  const bubble = (m) => `<li class="say${m.role === "user" ? " me" : ""}">${m.role === "user" ? `<p class="pre">${esc(m.content)}</p>` : words(m.content)}${(m.actions || []).length ? `<ul class="acts">${m.actions.map(did).join("")}</ul>` : ""}</li>`;

  N.section({
    id: "agent",
    name: "Agent",
    tile: "chat",
    bottom: (path) => !path[0],
    async draw(box, [part, a], ui) {
      if (part === "plan") return drawPlan(box, ui);
      if (part === "rhythm") return drawRhythm(box, ui);
      if (part === "missions") return drawMissions(box, ui);
      if (part === "mission") return drawMission(box, a, ui);
      if (part === "files") return drawFiles(box, ui);
      if (part === "file") return drawFile(box, a, ui);
      if (!messages || offline) {
        try { const r = await api("/chat/history"); messages = r.messages || []; offline = false; }
        catch (err) { if (err.signIn) throw err; if (!isOff(err)) throw err; offline = true; messages = messages || []; }
      }
      if (messages.length) ui.action({ icon: "refresh", label: "Start again", run: startAgain });
      box.innerHTML = `${partTabs("chat")}${offline ? pcOff() : ""}
        <ul class="talk">${messages.map(bubble).join("") || (offline ? "" : `<li class="say"><p>Hi. Ask me anything: what's on today, to add a note card, to plan a mission, to draft a reply…</p></li>`)}${waiting ? '<li class="typing" aria-label="Nova Agent is writing"><i></i><i></i><i></i></li>' : ""}</ul>
        <form class="composer" id="ask"><label class="sr" for="ask-box">Message Nova Agent</label><textarea class="input" id="ask-box" rows="1" placeholder="Message Nova Agent"${waiting || offline ? " disabled" : ""}></textarea><button class="btn main" type="submit" aria-label="Send"${waiting || offline ? " disabled" : ""}>${icon("send")}</button></form>`;
      box.querySelector("#ask").addEventListener("submit", send);
      box.querySelector("#ask-box").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); e.target.form.requestSubmit(); } });
    },
  });
  async function send(ev) {
    ev.preventDefault();
    const box_ = ev.target.querySelector("textarea"), text = box_.value.trim();
    if (!text || waiting) return;
    messages.push({ role: "user", content: text });
    waiting = true;
    N.show();
    try {
      const r = await act("/actions/chat", { message: text });
      messages.push({ role: "assistant", content: r.reply || "", actions: r.actions || [] });
    } catch (err) {
      messages.push({ role: "assistant", content: isOff(err) ? "(The studio's computer is off, so Nova Agent couldn't answer. Your message is above: send it again once it's back.)" : `(That didn't reach Nova Agent: ${err.message}. Send it again when you're ready.)` });
    } finally {
      waiting = false;
      if (location.hash === "" || location.hash === "#agent") N.show();
    }
  }
  async function startAgain() {
    if (!(await confirm({ title: "Start the conversation again?", text: "This clears the conversation with Nova Agent, on the computer too.", ok: "Clear it", danger: true }))) return;
    try { await act("/actions/chat/clear", {}); messages = []; toast("Cleared"); N.show(); } catch (err) { toast(err.message, true); }
  }

  // ---- The plan: today ----
  let state = null;
  async function loadState() { state = await api("/quests/state"); return state; }
  const hm = (s) => (s ? s.slice(11, 16) : "");
  async function drawPlan(box, ui) {
    try { await loadState(); } catch (err) { if (err.signIn) throw err; if (isOff(err)) { box.innerHTML = partTabs("plan") + pcOff(); return; } throw err; }
    ui.action({ icon: "cog", label: "Your rhythm", href: "#agent/rhythm" });
    const r = state.rhythm || {};
    const cur = state.current, next = state.next || [], over = state.overdue || [], unplanned = state.unplanned || [];
    const quest = (q, big) => `<div class="card${big ? " edge-card" : ""}"><p class="kicker">${q.status === "doing" ? "In progress" : q.start && q.start <= state.now ? "Happening now" : "Up next"}${q.start ? ` · ${hm(q.start)}–${hm(q.end)}` : ""}</p><h2 class="card-title">${esc(q.title)}</h2>${q.location ? `<p class="muted small">${esc(q.location)}</p>` : ""}
      <div class="btns two">${q.status !== "doing" ? `<button type="button" class="btn main" data-q="start" data-id="${esc(q.id)}">${icon("play")} Start</button>` : ""}<button type="button" class="btn${q.status === "doing" ? " main" : ""}" data-q="done" data-id="${esc(q.id)}">${icon("check")} Done</button><button type="button" class="btn" data-q="snooze15" data-id="${esc(q.id)}">+15 min</button><button type="button" class="btn" data-q="snooze60" data-id="${esc(q.id)}">Not now</button><button type="button" class="btn quiet" data-q="skip" data-id="${esc(q.id)}">Skip</button></div></div>`;
    box.innerHTML = `${partTabs("plan")}<p class="muted small">Up ${esc(r.wake || "")} · sleep ${esc(r.sleep || "")}${r.paceLimits === false ? " · pace limits off" : ""}</p>
      ${cur ? quest(cur, true) : empty({ icon: "quests", title: "Nothing on right now" })}
      ${next.length ? `<h3 class="h">Next</h3>${list(next.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, lead: hm(q.start) || "–", title: q.title, text: q.location || "" })))}` : ""}
      ${over.length ? `<h3 class="h">Overdue</h3>${list(over.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "clock", title: q.title, text: q.deadline ? `Was due ${hm(q.deadline)}` : "" })))}` : ""}
      ${unplanned.length ? `<h3 class="h">Needs a slot</h3>${list(unplanned.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "quests", title: q.title, text: q.why || "" })))}` : ""}
      ${(state.blocks || []).filter((b) => b.end > state.now).length ? `<h3 class="h">Busy</h3>${list(state.blocks.filter((b) => b.end > state.now).map((b) => row({ button: `data-unblock="${esc(b.id)}"`, lead: hm(b.start), title: `Busy · ${b.reason || "blocked"}`, end: "Unblock" })))}` : ""}
      <button type="button" class="btn wide" data-replan>${icon("refresh")} Re-plan from now</button>`;
    box.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => {
      const how = b.dataset.q;
      const body = how === "snooze15" ? { action: "snooze", minutes: 15 } : how === "snooze60" ? { action: "snooze", minutes: 60 } : { action: how };
      try { await act(`/actions/quests/${encodeURIComponent(b.dataset.id)}`, body); toast({ start: "Started", done: "Done ✦", skip: "Skipped" }[how] || "Moved"); N.show(); } catch (err) { toast(err.message, true); }
    })));
    box.querySelectorAll("[data-unblock]").forEach((b) => b.addEventListener("click", async () => { if (!(await confirm({ title: "Unblock this time?", ok: "Unblock" }))) return; try { await act("/actions/blocks", { remove: true, id: b.dataset.unblock }); toast("Unblocked"); N.show(); } catch (err) { toast(err.message, true); } }));
    box.querySelector("[data-replan]").addEventListener("click", (ev) => busy(ev.target, "Re-planning…", async () => { try { const r2 = await act("/actions/replan", {}); const res = r2.result || r2; toast(`Re-planned ✦${res.atRisk ? ` · ${res.atRisk} at risk` : ""}`); N.show(); } catch (err) { toast(err.message, true); } }));
  }
  async function drawRhythm(box, ui) {
    ui.back("#agent/plan");
    ui.title("Your rhythm");
    await loadState();
    const r = state.rhythm || {};
    const n = (label, name, v, hint) => field({ label, name, type: "number", value: v ?? "", hint, attrs: 'min="0"' });
    box.innerHTML = `<form class="form" id="rhythm" novalidate><p class="muted small">How Nova Agent plans your days.</p>
      <div class="two-up">${field({ label: "Get up", name: "wake", type: "time", value: r.wake || "07:30" })}${field({ label: "Go to sleep", name: "sleep", type: "time", value: r.sleep || "23:30" })}</div>
      <div class="two-up">${n("Start-up (min)", "startUpMinutes", r.startUpMinutes)}${n("Wind-down (min)", "windDownMinutes", r.windDownMinutes)}</div>
      <div class="two-up">${n("Between quests (min)", "bufferMinutes", r.bufferMinutes)}${n("Remind before (min)", "remindMinutesBefore", r.remindMinutesBefore)}</div>
      <div class="two-up">${n("Break after (min)", "breakAfterMinutes", r.breakAfterMinutes)}${n("Break length (min)", "breakMinutes", r.breakMinutes)}</div>
      <div class="two-up">${n("Most quest hours a day", "maxQuestHoursPerDay", r.maxQuestHoursPerDay)}${n("Plan ahead (days)", "horizonDays", r.horizonDays)}</div>
      ${field({ label: "Home base", name: "homeBase", value: r.homeBase || "", hint: "Where travel times are worked out from" })}
      <fieldset class="field"><legend>Days off</legend><div class="day-picks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day-pick"><input type="checkbox" name="daysOff" value="${d}"${(r.daysOff || []).includes(d) ? " checked" : ""}><span>${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d]}</span></label>`).join("")}</div></fieldset>
      ${toggle({ label: "Check in when a quest should be done", name: "checkIns", checked: r.checkIns })}
      ${toggle({ label: "Morning plan and evening wrap-up", name: "dailyBriefing", checked: r.dailyBriefing })}
      ${toggle({ label: "Reminders on the staff phones too", name: "phonePush", checked: r.phonePush })}
      ${toggle({ label: "Pace limits (buffers and breaks)", name: "paceLimits", checked: r.paceLimits !== false })}
      <button class="btn main wide" type="submit">${icon("check")} Save and re-plan</button></form>`;
    const f = box.querySelector("#rhythm");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, out = { wake: x.wake.value, sleep: x.sleep.value, homeBase: x.homeBase.value.trim(), daysOff: [...f.querySelectorAll("[name=daysOff]:checked")].map((c) => Number(c.value)) };
      for (const k of ["startUpMinutes", "windDownMinutes", "bufferMinutes", "remindMinutesBefore", "breakAfterMinutes", "breakMinutes", "maxQuestHoursPerDay", "horizonDays"]) if (x[k].value !== "") out[k] = Number(x[k].value);
      for (const k of ["checkIns", "dailyBriefing", "phonePush", "paceLimits"]) out[k] = x[k].checked;
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => { try { await act("/actions/rhythm", out); await act("/actions/replan", {}); f.classList.remove("dirty"); toast("Saved and re-planned"); location.hash = "#agent/plan"; } catch (err) { toast(err.message, true); } });
    });
  }

  // ---- Missions ----
  const pct = (m) => Math.round(m.progress?.percent ?? m.progress ?? 0);
  async function drawMissions(box, ui) {
    try { await loadState(); } catch (err) { if (err.signIn) throw err; if (isOff(err)) { box.innerHTML = partTabs("missions") + pcOff(); return; } throw err; }
    ui.action({ icon: "plus", label: "New mission", run: newMission });
    const ms = state.missions || [];
    box.innerHTML = `${partTabs("missions")}${ms.length ? list(ms.map((m) => row({ href: `#agent/mission/${encodeURIComponent(m.id)}`, lead: `<span class="av">${pct(m)}%</span>`, title: m.title, text: [m.status === "paused" ? "Paused" : m.status === "done" ? "Mission complete" : "", m.deadline ? `Due ${m.deadline.slice(0, 10)}` : "", m.summary].filter(Boolean).join(" · ").slice(0, 160) }))) : empty({ icon: "star", title: "No missions yet", text: "A mission is a big goal Nova Agent plans into quests: a release, a tour, a new skill.", action: `<button type="button" class="btn main" data-new-mission>${icon("plus")} New mission</button>` })}`;
    box.querySelector("[data-new-mission]")?.addEventListener("click", newMission);
  }
  async function newMission() {
    const v = await sheetForm(`<h2 class="sheet-title">✦ New mission</h2><form class="form" data-f>${field({ label: "What's the mission?", name: "request", type: "textarea", rows: 4, placeholder: "Release an EP by spring, with videos and a launch show" })}${field({ label: "Deadline (optional)", name: "deadline", type: "date" })}<div class="btns"><button class="btn main wide" type="submit">Plan the mission</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ request: ev.target.elements.request.value.trim(), deadline: ev.target.elements.deadline.value }); }; el.querySelector("[data-no]").onclick = () => done(null); });
    if (!v || !v.request) return;
    toast("Planning the mission… (it can take a minute)");
    try { const r = await act("/actions/missions", v); const m = (r.result || r).mission; toast("Mission planned ✦"); location.hash = m ? `#agent/mission/${encodeURIComponent(m.id)}` : "#agent/missions"; } catch (err) { toast(err.message, true); }
  }
  async function drawMission(box, id, ui) {
    ui.back("#agent/missions");
    await loadState();
    const m = (state.missions || []).find((x) => x.id === id);
    if (!m) { box.innerHTML = empty({ icon: "star", title: "That mission isn't there any more" }); return; }
    ui.title("Mission");
    const qs = (state.quests || []).filter((q) => q.missionId === id);
    const open = qs.filter((q) => q.status !== "done"), done = qs.filter((q) => q.status === "done");
    box.innerHTML = `<div class="card"><p class="kicker">${pct(m)}% · ${m.status === "paused" ? "Paused" : m.status === "done" ? "Complete" : "Active"}${m.deadline ? ` · due ${esc(m.deadline.slice(0, 10))}` : ""}</p><h2 class="card-title">${esc(m.title)}</h2>${m.summary ? `<p>${esc(m.summary)}</p>` : ""}</div>
      ${(m.strategy || []).length ? `<details class="card"><summary>The plan</summary>${m.strategy.map((s) => `<h4>${esc(s.heading)}</h4>${words(s.body)}`).join("")}${(m.assumptions || []).length ? `<h4>What the plan assumed</h4><ul>${m.assumptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${(m.research || []).length ? `<h4>Researched on the web</h4><ul>${m.research.map((x) => `<li>${esc(x.text)} <a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || "source")}</a></li>`).join("")}</ul>` : ""}</details>` : ""}
      ${(m.milestones || []).length ? `<h3 class="h">Roadmap</h3>${list(m.milestones.map((x) => row({ button: `data-milestone="${esc(x.id)}" data-done="${x.done ? 1 : 0}"`, lead: x.done ? icon("check") : "◆", title: x.title, text: x.at ? x.at.slice(0, 10) : "", cls: x.done ? "done-row" : "" })))}` : ""}
      ${open.length ? `<h3 class="h">Quests · ${open.length}</h3>${list(open.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "quests", title: q.title, text: q.start ? q.start.slice(0, 16).replace("T", " ") : "Needs a slot" })))}` : ""}
      ${done.length ? `<details class="card"><summary>Done · ${done.length}</summary>${list(done.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "check", title: q.title, cls: "done-row" })))}</details>` : ""}
      ${(m.questions || []).length ? `<h3 class="h">${m.questions.length} question${m.questions.length > 1 ? "s" : ""} would sharpen this plan</h3>${list(m.questions.map((q, i) => row({ button: `data-refine="${i}"`, icon: "chat", title: q })))}` : ""}
      <button type="button" class="btn wide" data-refine="">✦ Add detail and re-plan</button>
      <div class="btns two"><button type="button" class="btn" data-status="${m.status === "paused" ? "active" : "paused"}">${m.status === "paused" ? "Resume" : "Pause"}</button><button type="button" class="btn danger" data-remove>Remove</button></div>`;
    box.querySelectorAll("[data-milestone]").forEach((b) => b.addEventListener("click", () => busy(b, "…", async () => { try { await act(`/actions/missions/${encodeURIComponent(id)}`, { milestone: b.dataset.milestone, done: b.dataset.done !== "1" }); N.show(); } catch (err) { toast(err.message, true); } })));
    box.querySelectorAll("[data-refine]").forEach((b) => b.addEventListener("click", async () => {
      const q = b.dataset.refine === "" ? "" : m.questions[Number(b.dataset.refine)];
      const v = await sheetForm(`<h2 class="sheet-title">${q ? esc(q) : "Add detail"}</h2><form class="form" data-f>${field({ label: q ? "Your answer" : "What should Nova Agent know?", name: "detail", type: "textarea", rows: 4 })}${field({ label: "New deadline (optional)", name: "deadline", type: "date" })}<div class="btns"><button class="btn main wide" type="submit">✦ Re-plan what's left</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done_) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done_({ detail: (q ? `${q} ${ev.target.elements.detail.value}` : ev.target.elements.detail.value).trim(), deadline: ev.target.elements.deadline.value }); }; el.querySelector("[data-no]").onclick = () => done_(null); });
      if (!v || !v.detail) return;
      toast("Re-planning… (it can take a minute)");
      try { await act(`/actions/missions/${encodeURIComponent(id)}/refine`, v); toast("Re-planned ✦"); N.show(); } catch (err) { toast(err.message, true); }
    }));
    box.querySelector("[data-status]").addEventListener("click", (ev) => busy(ev.target, "…", async () => { try { await act(`/actions/missions/${encodeURIComponent(id)}`, { status: ev.target.dataset.status }); N.show(); } catch (err) { toast(err.message, true); } }));
    box.querySelector("[data-remove]").addEventListener("click", async () => {
      if (!(await confirm({ title: `Remove “${m.title}”?`, text: "Its quests go too.", ok: "Remove", danger: true }))) return;
      try { await act(`/actions/missions/${encodeURIComponent(id)}`, { remove: true }); toast("Removed"); location.hash = "#agent/missions"; } catch (err) { toast(err.message, true); }
    });
  }

  // ---- Files Nova Agent made ----
  let files = [];
  async function drawFiles(box, ui) {
    try { files = (await api("/files/list")).files || []; } catch (err) { if (err.signIn) throw err; if (isOff(err)) { box.innerHTML = partTabs("files") + pcOff(); return; } throw err; }
    box.innerHTML = `${partTabs("files")}${files.length ? list(files.map((f) => row({ href: `#agent/file/${encodeURIComponent(f.id)}`, icon: "notes", title: f.title || f.name, text: [f.type, f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ""].filter(Boolean).join(" · "), end: esc(ago(f.updated)) }))) : empty({ icon: "notes", title: "No files yet", text: "Ask Nova Agent to write something up and it lands here." })}`;
  }
  async function drawFile(box, id, ui) {
    ui.back("#agent/files");
    if (!files.length) files = (await api("/files/list")).files || [];
    const f = files.find((x) => x.id === id);
    if (!f) { box.innerHTML = empty({ icon: "notes", title: "That file isn't there any more" }); return; }
    ui.title(f.title || f.name);
    const text = /^(md|markdown|txt|text|csv|json)$/i.test(f.type || "") || /\.(md|txt|csv|json)$/i.test(f.name || "");
    let body = "";
    if (text) { try { const r = await fetch(f.url, { credentials: "same-origin" }); body = await r.text(); } catch (e) { body = ""; } }
    box.innerHTML = `<div class="card"><p class="kicker">${esc(f.type || "File")}</p><h2 class="card-title">${esc(f.title || f.name)}</h2><p class="muted small">${esc(f.name || "")} · ${esc(ago(f.updated))}</p></div>
      ${text ? `<div class="card prose">${/md|markdown/i.test(f.type || f.name) ? words(body) : `<p class="pre">${esc(body.slice(0, 20000))}</p>`}</div>` : ""}
      <div class="btns two"><a class="btn main" href="${esc(f.url)}?download">Save to phone</a><a class="btn" href="${esc(f.url)}" target="_blank" rel="noopener">Open</a>${text ? `<button type="button" class="btn" data-copy>Copy</button>` : ""}<button type="button" class="btn danger" data-del>${icon("trash")} Delete</button></div>`;
    box.querySelector("[data-copy]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(body); toast("Copied"); } catch (e) { toast("Couldn't copy", true); } });
    box.querySelector("[data-del]").addEventListener("click", async () => {
      if (!(await confirm({ title: `Delete “${f.title || f.name}”?`, ok: "Delete", danger: true }))) return;
      try { await act(`/actions/files/${encodeURIComponent(f.id)}/remove`, {}); files = files.filter((x) => x.id !== f.id); toast("Deleted"); location.hash = "#agent/files"; } catch (err) { toast(err.message, true); }
    });
  }
})();
