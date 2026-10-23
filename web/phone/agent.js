// Nova Phone: Agent. Talking to Nova Agent (one conversation per person, kept by Nova Agent on the
// studio's PC, the same as on the computer), and what it runs for you:
//   Chat       the conversation, one question and its answer a page (or All); as you type, what the message will
//              become (a Quest, Blocked time…) and the details picked out; under each reply what Nova
//              Agent did, each opening its place here, and cards to act on: files it wrote, a reply it drafted
//              (Approve & send), a booking change (Approve, Edit, Reject), an email campaign or a one-to-one email
//   Plan       today: the header, the quest on now (or next) with its progress, the day's timeline (quests,
//              blocked time, Calendar's note cards), Done, Coming up, Pulses, Needs a slot; how each is going
//              and which phones get its reminders; Also coming up from Calendar; re-plan; your rhythm
//   Files      what Nova Agent wrote: read it here (Markdown, tables, JSON, web pages), save, copy, open in Notes
// Live: the plan follows changes as they happen (notices.js keeps the one line to Nova Agent).
// When the studio's PC is off, Agent says so and looks again every 20 s; the rest of the app still works.
// Other places start a message here with #agent?say=<text> or NovaPhone.agentSay(text) (never sent by itself).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const HDR = { "X-Nova-Visualizer": "1" };
  const act = (path, body) => post(path, body, HDR).then((r) => { if (r && r.ok === false) throw Object.assign(new Error(r.message || "That didn't work."), { data: r }); return r; });
  const isOff = (err) => err && (err.status === 503 || err.status === 502 || err.data?.pcOffline);
  const typing = () => !!document.querySelector("#page input:focus, #page textarea:focus, #page form.dirty, dialog[open]");
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const PARTS = [["chat", "Chat"], ["plan", "Plan"], ["files", "Files"]];
  const partTabs = (on) => `<div class="seg agent-tabs">${PARTS.map(([p, l]) => `<a class="seg-a" href="#agent${p === "chat" ? "" : `/${p}`}" aria-selected="${p === on}">${l}</a>`).join("")}</div>`;
  const pcOff = () => `<div class="empty">${icon("globe")}<b>Nova Agent's computer is off</b><span>Agent, its plan and files live on the studio's computer. Everything else here still works. This looks again every 20 seconds and comes back by itself.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`;
  const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // (a reply: Nova Phone's own sounds when they're loaded, sound.js; else the calm chime, notices.js)
  const chime = (k) => (N.sound ? N.sound(k) : N.chime && N.chime(k));

  // The always-on piece (reminders, the live line, Nova Desk's addresses as places): loaded with the page, or now
  const noticesReady = N.notices ? Promise.resolve() : new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "notices.js";
    s.onload = s.onerror = () => resolve();
    document.head.append(s);
  });
  const place = (u) => (N.place ? N.place(u) : null);
  const say = (text) => (N.agentSay ? N.agentSay(text) : ((pendingSay = String(text || "")), location.hash === "#agent" ? N.show() : (location.hash = "#agent")));
  let pendingSay = "";

  // ---- Words ----
  // A reply: paragraphs, numbered and bulleted lists, headings, **bold**, *italics*, `code` and links
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  function md(text) {
    const out = [];
    let open = null;
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trimEnd();
      const m = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
      if (m) {
        const tag = m[1] ? "ol" : "ul";
        if (open !== tag) { if (open) out.push(`</${open}>`); open = tag; out.push(`<${tag}>`); }
        out.push(`<li>${inline(m[2])}</li>`);
        continue;
      }
      if (open) { out.push(`</${open}>`); open = null; }
      const h = line.match(/^\s*#{1,4}\s+(.*)$/);
      if (h) { out.push(`<h4 class="agent-h">${inline(h[1])}</h4>`); continue; }
      if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    }
    if (open) out.push(`</${open}>`);
    return out.join("");
  }
  // A table that fits a phone: up to three columns as a table, more as one small card per row
  function table(head, rows, real = false) {
    if (real || head.length <= 3) return `<table class="agent-tbl"><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, i) => `<td>${r[i] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return `<div class="agent-cards">${rows.map((r) => `<dl class="agent-rowcard">${head.map((h, i) => (r[i] ? `<div><dt>${h}</dt><dd>${r[i]}</dd></div>` : "")).join("")}</dl>`).join("")}</div>`;
  }
  // A file's Markdown, fuller than a reply's: headings, tables, code, quotes, checklists, links
  function mdDoc(text, forNotes = false) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const il = (s) => inline(s).replace(/~~(.+?)~~/g, "<s>$1</s>");
    const out = [];
    let lst = null, para = [];
    const flushP = () => { if (para.length) out.push(`<p>${para.map(il).join("<br>")}</p>`); para = []; };
    const flushL = () => { if (lst) out.push(`</${lst}>`); lst = null; };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flushP(); flushL();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre class="agent-pre"><code>${esc(code.join("\n"))}</code></pre>`);
        continue;
      }
      if (!line.trim()) { flushP(); if (lst && !/^\s*([-*+]|\d+[.)])\s/.test(lines[i + 1] || "")) flushL(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushP(); flushL(); const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${il(h[2])}</h${n}>`); continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushP(); flushL(); out.push("<hr>"); continue; }
      if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
        flushP(); flushL();
        const cells = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => il(c.trim().replace(/\\\|/g, "|")));
        const head = cells(line); i++;
        const rows = [];
        while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1])) rows.push(cells(lines[++i]));
        out.push(table(head, rows, forNotes));
        continue;
      }
      const q = line.match(/^\s*>\s?(.*)$/);
      if (q) { flushP(); flushL(); out.push(`<blockquote>${il(q[1])}</blockquote>`); continue; }
      const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
      if (li) {
        flushP();
        const tag = li[2] ? "ol" : "ul";
        if (lst !== tag) { flushL(); lst = tag; out.push(`<${tag}>`); }
        const task = li[3].match(/^\[( |x|X)\]\s+(.*)$/);
        out.push(task ? `<li class="agent-task${task[1] !== " " ? " done" : ""}">${il(task[2])}</li>` : `<li>${il(li[3])}</li>`);
        continue;
      }
      flushL();
      para.push(line.trim());
    }
    flushP(); flushL();
    return out.join("");
  }
  function csvRows(text) {
    const rows = []; let r = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === ",") { r.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; r.push(cell); rows.push(r); r = []; cell = ""; }
      else cell += ch;
    }
    if (cell || r.length) { r.push(cell); rows.push(r); }
    return rows.filter((x) => x.some((c) => c.trim()));
  }
  // A web page Nova Agent wrote, as words only (nothing in it can run: no scripts, styles, frames or forms)
  function safeHtml(html) {
    // (style attributes and blocks renamed before it's read: a parsed page is held to Nova Phone's rules, which block them)
    const doc = new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
    doc.querySelectorAll("script, style, link, meta, iframe, frame, object, embed, template, svg, math, form, input, button, select, textarea, noscript, img, picture, video, audio, canvas, base").forEach((el) => el.remove());
    const OK = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "B", "STRONG", "I", "EM", "U", "S", "A", "BR", "HR", "BLOCKQUOTE", "PRE", "CODE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SMALL", "SUP", "SUB", "MARK", "DL", "DT", "DD"]);
    for (const el of [...doc.body.querySelectorAll("*")]) {
      if (!OK.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) if (!(el.tagName === "A" && a.name === "href" && /^https?:/i.test(a.value))) el.removeAttribute(a.name);
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    }
    return doc.body.innerHTML;
  }

  // ---- The type cue: what a message will become, worked out as it's typed (no AI, so it's instant) ----
  const KINDS = {
    quest: { icon: "✦", label: "Quest", hint: "One task, fitted into your day", send: "Add quest" },
    repeat: { icon: "∞", label: "Repeating quest", hint: "Comes back each time it’s due, until you end it", send: "Set it up" },
    pulse: { icon: "⚡", label: "Pulse", hint: "A quick repeat on its own exact timer", send: "Start it" },
    block: { icon: "⛔", label: "Blocked time", hint: "Quests move out of the way", send: "Block it" },
    update: { icon: "✓", label: "Quest update", hint: "Marks a quest done, started, skipped or moved", send: "Update" },
    calendar: { icon: "▦", label: "Calendar card", hint: "A note card or day card in Calendar", send: "Add it" },
    studio: { icon: "♫", label: "Studio bookings", hint: "Looks at Acuity (read-only)", send: "Check" },
    ask: { icon: "?", label: "Question", hint: "Nova Agent answers, using your plan", send: "Ask" },
    chat: { icon: "✦", label: "Nova Agent", hint: "Just talking to Nova Agent", send: "Send" },
  };
  const DAYS = "(?:mon|tues|wednes|thurs|fri|satur|sun)day";
  const RX = {
    pulse: /\bevery\s+(?:(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)\b|second\b|minute\b|([1-4](?:\.\d+)?)\s*(?:m|mins?|minutes?)\b)/,
    repeat: new RegExp(`\\b(?:every|each)\\s+(?:other\\s+)?(?:day|morning|afternoon|evening|night|week|weekday|weekend|month|${DAYS}|\\d+\\s*(?:mins?|minutes?|hours?|hrs?|h|days?))\\b|\\b(?:daily|weekly|nightly|habit|routine)\\b`),
    block: /\b(?:i'?m|i am|we'?re|i'?ll be)\s+(?:out|away|busy|off|ill|sick|at a|at the|travell?ing|on holiday)\b|\bblock(?:ing)?\s+(?:out|off)\b|\bcan'?t\s+(?:do|make)\b|\brunning late\b|\boff sick\b|\bday off\b|\bunavailable\b/,
    update: /^(?:done|finished|completed|started|starting|skip|skipped|snooze)\b|\bi(?:'ve| have)?\s+(?:just\s+)?(?:done|finished|completed|started)\s+(?:the|my|it|that)\b|\bmark\b.*\b(?:done|complete|finished)\b|\bnot now\b|\bpush (?:it|that) back\b/,
    calendar: /\b(?:note card|day card|calendar|birthday|anniversary)\b/,
    studio: /\b(?:acuity|bookings?|booked|appointments?|who'?s in)\b/,
    goal: /\b(?:schedule|strategy|strategies|plan(?:ned|ning)? out|roadmap|campaign|challenge|launch|release|releases|goal|mission|project|deadline|catch up|fallen behind|behind on|by (?:the )?end of|months?|content|following|grow|course|exam|marathon|business|album|ep|tour)\b/g,
    ask: /^(?:what|when|where|why|how|should|can|could|would|is|are|do|does|did|which|who|any)\b/,
    quest: /\b(?:remind me to|i need to|i have to|i'?ve got to|i must|add (?:a )?(?:quest|task)|to-?do|task)\b|^(?:call|text|email|ring|buy|book|send|write|record|mix|master|finish|clean|go|pick up|collect|pay|post|film|edit|practi[cs]e|upload|bounce|tidy|cook|read|study|revise|train|run)\b/,
  };
  function classify(text) {
    const t = String(text || "").trim().toLowerCase();
    if (t.length < 3) return null;
    const words = t.split(/\s+/).length;
    const goals = (t.match(RX.goal) || []).length;
    const sentences = t.split(/[.!?;\n]+/).filter((x) => x.trim().length > 3).length;
    const big = (words >= 25 && goals >= 2) || goals >= 4 || (sentences >= 3 && goals >= 2) || (/\b(?:plan|schedule|strategy)\b.*\b(?:for|to|so)\b/.test(t) && words >= 10);
    let kind = "chat";
    if (RX.pulse.test(t)) kind = "pulse";
    else if (RX.repeat.test(t)) kind = "repeat";
    else if (RX.block.test(t)) kind = "block";
    else if (RX.update.test(t)) kind = "update";
    else if (RX.calendar.test(t)) kind = "calendar";
    else if (RX.studio.test(t)) kind = "studio";
    else if (/\?\s*$/.test(t) || RX.ask.test(t)) kind = "ask";
    else if (RX.quest.test(t) || words <= 12) kind = "quest";
    return { kind, ...KINDS[kind], bits: pickOut(t) };
  }
  // The details worth showing: when, how long, how often, how many, where it's going
  function pickOut(t) {
    const bits = [];
    const add = (ic, m) => { if (m) bits.push(`${ic} ${m.replace(/\s+/g, " ").trim()}`); };
    add("⏳", (t.match(new RegExp(`\\b(?:by|before|until)\\s+(?:the\\s+)?(?:end of (?:the )?(?:year|month|week|day)|tomorrow|tonight|${DAYS}|christmas|new year(?:'?s)?|\\d{1,2}(?:st|nd|rd|th)?\\s+[a-z]{3,9}|[a-z]{3,9}\\s+\\d{1,2}(?:st|nd|rd|th)?)`)) || [])[0]
      || (t.match(/\b(?:\d+|one|two|three|four|five|six|a few|a couple of)\s+(?:months?|weeks?|days?)\s+(?:until|left|to go|to (?:finish|complete|do))\b/) || [])[0]);
    add("🕑", (t.match(new RegExp(`\\b(?:today|tonight|tomorrow(?: morning| afternoon| evening| night)?|this (?:morning|afternoon|evening|weekend)|next ${DAYS}|next week|on ${DAYS}|at \\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?|from \\d{1,2}(?::\\d{2})?\\s*(?:am|pm)? to \\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)\\b`)) || [])[0]);
    const every = t.match(RX.pulse) || t.match(RX.repeat);
    add("∞", every && every[0]);
    if (!every) add("⏱", (t.match(/\b(?:\d+(?:\.\d+)?|an?|half an?)\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/) || [])[0]);
    const count = t.match(/\b(\d+)[- ](release|week|day|song|post|video)s? (schedule|challenge|plan)\b/);
    add("#", count ? `${count[1]}-${count[2]} ${count[3]}` : (t.match(/\b\d+[- ]?(?:releases?|songs?|tracks?|posts?|videos?|episodes?|reels?|tiktoks?|beats?)\b/) || [])[0]);
    const PLACES = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", spotify: "Spotify", soundcloud: "SoundCloud", twitter: "Twitter", facebook: "Facebook", bandcamp: "Bandcamp", twitch: "Twitch" };
    const places = Object.keys(PLACES).filter((p) => t.includes(p));
    if (places.length) bits.push(`📱 ${places.map((p) => PLACES[p]).join(" · ")}`);
    const parts = [["release", "release"], ["content", "content"], ["film", "filming"], ["edit", "editing"], ["gear|hardware|interface|mic\\b", "gear"], ["mix|master", "mixing"], ["promo|market", "promo"]].filter(([rx]) => new RegExp(`\\b(?:${rx})`).test(t)).map(([, n]) => n);
    if (parts.length >= 2) bits.push(`🧭 ${parts.join(" · ")}`);
    add("📍", (t.match(/\b(?:at|to) the (?:gym|studio|shop|shops|park|office|venue|station|airport|bank|doctor'?s|dentist|post office|library)\b/) || [])[0]);
    return bits.slice(0, 6);
  }
  function cueHtml(text, fixed) {
    const c = classify(text);
    if (!c) return "";
    const k = fixed ? { ...c, ...KINDS[fixed], kind: fixed } : c;
    return `<span class="agent-cue-type" data-kind="${k.kind}"><i>${k.icon}</i>${esc(k.label)}</span><span class="agent-cue-hint">${esc(k.hint)}</span>${k.bits.length ? `<span class="agent-cue-bits">${k.bits.map((b) => `<span>${esc(b)}</span>`).join("")}</span>` : ""}`;
  }

  // ---- Is Nova Agent there: Live, Rehearsal (DRY_RUN), PC off, Signed out, Offline, and its model ----
  let status = null, statusAt = 0, offline = false;
  async function getStatus(fresh = false) {
    if (!fresh && status && Date.now() - statusAt < 20000) return status;
    try { const s = await api("/status"); status = { mode: s.live ? "live" : "rehearsal", model: s.model || "", connected: !!s.connected }; }
    catch (err) { status = { mode: err.signIn ? "out" : isOff(err) ? "off" : err.offline ? "offline" : "unknown" }; }
    statusAt = Date.now();
    return status;
  }
  const STATUS_WORDS = { live: "Live", rehearsal: "Rehearsal: DRY_RUN is on, nothing real is sent", off: "PC off", out: "Signed out", offline: "Offline", unknown: "Not answering" };
  const statusLine = (s) => (s ? `<p class="agent-status" data-mode="${s.mode}"><i aria-hidden="true"></i><span>${esc(STATUS_WORDS[s.mode])}${s.model ? ` · ${esc(s.model)}` : ""}${s.mode === "live" || s.mode === "rehearsal" ? (s.connected ? "" : " · not connected to Nova Bot") : ""}</span></p>` : "");
  // (the PC off: look again every 20 s while Agent is on screen; back, and the screen comes back)
  let pcT = 0;
  function watchPc() {
    if (pcT) return;
    pcT = setInterval(async () => {
      if (!location.hash.startsWith("#agent") && location.hash !== "#agent") { clearInterval(pcT); pcT = 0; return; }
      if (document.hidden) return;
      const s = await getStatus(true);
      if (s.mode === "live" || s.mode === "rehearsal") {
        clearInterval(pcT); pcT = 0; offline = false; stateAt = 0;
        if (!typing()) N.show(); else toast("The studio's computer is back");
      }
    }, 20000);
  }

  // ---- The conversation ----
  let messages = null, histAt = 0, waiting = false, waitKind = "", typed = "", paged = store.get("nova-phone/chat-pages", "pages") !== "all", pageAt = -1;
  const acts = new Map(); // "message:action" → the action, for its card
  const known = new Map(); // file id → file card
  const SUGGEST = ["What should I do now?", "What's left to do today?", "I'm out tonight from 7 to 11", "What's on this week?", "Add a note card for Friday at 2pm: mix review", "Make 31 October a Halloween day card", "What's booked in Acuity tomorrow?", "How are you doing?"];
  const welcome = () => `<li class="agent-welcome card"><p class="kicker">✦ Nova Agent</p><h2 class="card-title">Hey, I'm Nova Agent</h2><p>Tell me what needs doing and I'll plan your days hour by hour, and keep you on track. I can also run Calendar and check the studio's Acuity bookings.</p>${list(SUGGEST.map((t) => row({ button: `data-say="${esc(t)}"`, icon: "send", title: t })))}</li>`;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const pad = (n) => String(n).padStart(2, "0");
  // "Friday 9 October 2026" in a reply → 2026-10-09
  const dateIn = (text) => { const m = String(text || "").match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/); return m ? `${m[3]}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(m[1])}` : ""; };
  // Where each thing Nova Agent did is, here
  function placeOf(a) {
    const t = String(a.text || "");
    const at = typeof a.url === "string" && a.url ? place(a.url) : null;
    if (at) return at;
    if (a.kind === "draft") { const id = a.draft?.enquiryId || a.draft?.enquiry_id; return id ? `#inbox/enquiry/${encodeURIComponent(id)}` : "#inbox"; }
    if (a.kind === "booking") return "#inbox/approvals";
    if (a.kind === "file" || a.file) return a.file?.id ? `#agent/file/${encodeURIComponent(a.file.id)}` : "#agent/files";
    if (a.kind === "campaign") return a.campaign?.id ? `#outreach/campaign/${encodeURIComponent(a.campaign.id)}` : "#outreach";
    if (a.kind === "outreach") return a.outreach?.id ? `#outreach/one/${encodeURIComponent(a.outreach.id)}` : "#outreach/one";
    if (a.kind === "social") return "#outreach/social";
    if (/\b(?:note card|day card)\b/i.test(t)) { const d = dateIn(t); return d ? `#calendar/day/${d}` : "#calendar"; }
    if (/^Looked at (?:Acuity bookings|free times|blocked times)/.test(t)) { const d = dateIn(t); return d ? `#calendar/day/${d}` : "#calendar"; }
    if (/\binvoice\b/i.test(t)) return "#money";
    if (/\bexpense\b/i.test(t)) return "#money/expenses";
    if (/^(?:Mission “|Re-planned “|Removed mission)/.test(t)) return "#agent/plan";
    if (/^(?:Quest “|Removed quest|Snoozed|Session done|Done|Started|Skipped|Ended|Blocked|Unblocked|Rhythm|Re-planned every|Music time)/.test(t)) return "#agent/plan";
    return "";
  }
  const SYM = { removed: "✕", looked: "◎", file: "▤", draft: "✉", campaign: "✉", outreach: "✉", booking: "◷", social: "◈" };
  function chip(a) {
    const to = placeOf(a), words = `${SYM[a.kind] || "✦"} ${esc(a.text || a.kind)}`;
    return `<li>${to ? `<a href="${esc(to)}">${words}</a>` : words}</li>`;
  }
  function bubble(m, i) {
    if (m.role === "user") return `<li class="say me" data-i="${i}"><p class="pre">${esc(m.content)}</p></li>`;
    const as = m.actions || [];
    const cards = [];
    as.forEach((a, j) => {
      const k = `${i}:${j}`;
      acts.set(k, a);
      if (a.kind === "file" || a.file) cards.push(`<div class="agent-card" data-card="${a.file && a.file.url ? "file" : "filelink"}" data-k="${k}"></div>`);
      if (a.kind === "draft" && a.draft && a.draft.id) cards.push(`<div class="agent-card" data-card="draft" data-k="${k}"></div>`);
      if (a.kind === "booking" && a.booking && a.booking.id) cards.push(`<div class="agent-card" data-card="booking" data-k="${k}"></div>`);
      if (a.kind === "campaign" && a.campaign && a.campaign.id) cards.push(`<div class="agent-card" data-card="campaign" data-k="${k}"></div>`);
      if (a.kind === "outreach" && a.outreach && a.outreach.id) cards.push(`<div class="agent-card" data-card="outreach" data-k="${k}"></div>`);
    });
    return `<li class="say${cards.length ? " agent-wide" : ""}${m.error ? " agent-err" : ""}" data-i="${i}">${m.error ? `<p>${esc(m.content)}</p>` : md(m.content)}${as.length ? `<ul class="acts">${as.map(chip).join("")}</ul>` : ""}${cards.join("")}</li>`;
  }
  // Pages: each thing you asked, with its answer (anything before the first goes on the first page)
  function pagesOf() {
    const pages = [];
    messages.forEach((m, i) => { if (m.role === "user" || !pages.length) pages.push([]); pages[pages.length - 1].push(i); });
    return pages;
  }
  async function loadHistory(force) {
    if (!force && messages && !offline && (waiting || Date.now() - histAt < 15000)) return;
    try { const r = await api("/chat/history"); messages = (r.messages || []).filter((m) => m && m.content != null); offline = false; histAt = Date.now(); }
    catch (err) { if (err.signIn) throw err; if (!isOff(err)) throw err; offline = true; messages = messages || []; }
  }
  async function drawChat(box, ui) {
    await noticesReady;
    const asked = (N.takeSay ? N.takeSay() : "") || pendingSay;
    pendingSay = "";
    if (asked && !typed.trim()) typed = asked;
    const [, s] = await Promise.all([loadHistory(false), getStatus(offline)]);
    if (offline || s.mode === "off") { offline = true; watchPc(); }
    if (messages.length) ui.action({ icon: "refresh", label: "Start a new conversation", run: startAgain });
    acts.clear();
    const pages = pagesOf();
    const n = pageAt < 0 || pageAt >= pages.length ? pages.length - 1 : pageAt;
    const on = new Set(paged && pages.length ? pages[n] : messages.map((_, i) => i));
    const k = classify(typed);
    const planning = "";
    box.innerHTML = `${partTabs("chat")}${statusLine(s)}${offline ? pcOff() : ""}
      <ul class="talk agent-talk" id="agent-talk">${messages.length ? messages.map((m, i) => bubble(m, i).replace(/^<li class="/, `<li class="${on.has(i) ? "" : "agent-off "}`)).join("") : offline ? "" : welcome()}${waiting ? `<li class="agent-typing"><span class="typing" aria-label="Nova Agent is writing"><i></i><i></i><i></i></span>${planning ? `<small>${esc(planning)}</small>` : ""}</li>` : ""}</ul>
      ${pages.length > 1 || (pages.length && !paged) ? `<div class="agent-pager">${paged ? `<button type="button" class="icon-btn" data-page="-1" aria-label="The one before"${n === 0 ? " disabled" : ""}>${icon("back")}</button><span aria-live="polite">${n + 1} of ${pages.length}</span><button type="button" class="icon-btn" data-page="1" aria-label="The next one"${n === pages.length - 1 ? " disabled" : ""}>${icon("next")}</button>` : `<span>${pages.length} ${pages.length === 1 ? "reply" : "replies"}</span>`}<button type="button" class="chip" data-paged>${paged ? "All" : "Pages"}</button></div>` : ""}
      <form class="composer agent-composer" id="ask"><div class="agent-cue" id="agent-cue"${k ? "" : " hidden"}>${k ? cueHtml(typed) : ""}</div><label class="sr" for="ask-box">Message Nova Agent</label><textarea class="input" id="ask-box" rows="1" maxlength="4000" placeholder="Message Nova Agent"${offline ? " disabled" : ""}>${esc(typed)}</textarea><button class="btn main agent-send" type="submit" aria-label="${esc(k ? k.send : "Send")}"${waiting || offline ? " disabled" : ""}>${icon("send")}<span${k ? "" : " hidden"}>${esc(k ? k.send : "Send")}</span></button></form>`;
    wireChat(box);
    wireCards(box);
  }
  function wireChat(box) {
    const f = box.querySelector("#ask"), ta = box.querySelector("#ask-box"), cue = box.querySelector("#agent-cue"), sendBtn = f.querySelector(".agent-send");
    f.addEventListener("submit", (ev) => { ev.preventDefault(); send(ta.value); });
    ta.addEventListener("input", () => {
      typed = ta.value;
      const k = classify(typed);
      cue.hidden = !k;
      cue.innerHTML = k ? cueHtml(typed) : "";
      const word = sendBtn.querySelector("span");
      word.hidden = !k;
      word.textContent = k ? k.send : "Send";
      sendBtn.setAttribute("aria-label", k ? k.send : "Send");
    });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); f.requestSubmit(); } });
    // (opened with a message to start from: the box is ready for more)
    if (typed && document.activeElement !== ta) setTimeout(() => { if (ta.isConnected) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 150);
    box.addEventListener("click", (e) => {
      const s = e.target.closest("[data-say]");
      if (s) return send(s.dataset.say);
      const p = e.target.closest("[data-page]");
      if (p) return turn(Number(p.dataset.page));
      if (e.target.closest("[data-paged]")) { paged = !paged; store.set("nova-phone/chat-pages", paged ? "pages" : "all"); pageAt = -1; N.show(); if (!paged) requestAnimationFrame(() => { const pg = document.getElementById("page"); pg.scrollTop = pg.scrollHeight; }); }
    });
    // A clear sideways swipe turns the page (scrolling a long reply up and down never does)
    const talk = box.querySelector("#agent-talk");
    let sx = 0, sy = 0, st0 = 0;
    talk.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st0 = Date.now(); }, { passive: true });
    talk.addEventListener("touchend", (e) => {
      if (!paged) return;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st0 < 700 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) turn(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
  function turn(step) {
    const pages = pagesOf();
    const n = pageAt < 0 ? pages.length - 1 : pageAt;
    const to = Math.max(0, Math.min(pages.length - 1, n + step));
    if (to === n) return;
    pageAt = to === pages.length - 1 ? -1 : to;
    N.show();
    requestAnimationFrame(() => { document.getElementById("page").scrollTop = 0; });
  }
  async function send(text) {
    text = String(text || "").trim();
    const ta = document.getElementById("ask-box");
    if (!text) {
      // (nothing typed: the box is pointed out, instead of nothing happening)
      if (ta) { const was = ta.placeholder; ta.placeholder = "Type your message here first…"; ta.focus(); setTimeout(() => { if (ta.isConnected) ta.placeholder = was; }, 2500); }
      return;
    }
    if (waiting || offline) return;
    messages.push({ role: "user", content: text });
    waitKind = (classify(text) || {}).kind || "";
    waiting = true;
    typed = "";
    pageAt = -1;
    N.show();
    try {
      const r = await act("/actions/chat", { message: text });
      messages.push({ role: "assistant", content: r.reply || "", actions: r.actions || [] });
      histAt = Date.now();
      chime(r.actions && r.actions.length ? "done" : "message");
      if (r.actions && r.actions.length) { stateAt = 0; filesAt = 0; }
    } catch (err) {
      // (it didn't get there: the message goes back in the box to send again)
      messages.pop();
      if (!typed) typed = text;
      messages.push({ role: "assistant", error: true, local: true, content: isOff(err) ? "The studio's computer is off, so Nova Agent couldn't answer. Your message is back in the box: send it again once it's on." : err.signIn ? "You're signed out, so that didn't reach Nova Agent. Sign in, then send it again (it's back in the box)." : `That didn't reach Nova Agent: ${err.message} Your message is back in the box to send again.` });
      if (isOff(err)) { offline = true; watchPc(); }
    } finally {
      waiting = false;
      waitKind = "";
      if (location.hash === "" || location.hash === "#agent") N.show();
    }
  }
  async function startAgain() {
    if (!(await confirm({ title: "Start a new conversation?", text: "This clears the conversation with Nova Agent, on the computer too.", ok: "Clear it", danger: true }))) return;
    try { await act("/actions/chat/clear", {}); messages = []; pageAt = -1; toast("Cleared"); N.show(); } catch (err) { toast(err.message, true); }
  }

  // ---- The cards under a reply: drawn when their page shows, each checking where it's up to now ----
  const peeks = new Map();
  function peek(path, ttl = 15000) {
    const c = peeks.get(path);
    if (c && Date.now() - c.at < ttl) return c.p;
    const p = api(path, { cache: "no-store" });
    peeks.set(path, { at: Date.now(), p });
    p.catch(() => peeks.delete(path));
    return p;
  }
  const forget = (prefix) => { for (const k of [...peeks.keys()]) if (k.startsWith(prefix)) peeks.delete(k); };
  function wireCards(root) {
    for (const el of root.querySelectorAll(".agent-card[data-card]")) {
      if (el.closest(".agent-off") || el.dataset.drawn) continue;
      el.dataset.drawn = "1";
      const a = acts.get(el.dataset.k);
      if (!a) continue;
      try { CARDS[el.dataset.card](el, a); } catch (err) { console.warn("Nova Phone: a card", err); el.remove(); }
    }
  }
  const stateLine = (el, text, cls = "") => { const s = el.querySelector(".agent-state"); s.textContent = text; s.dataset.tone = cls; };
  const fsize = (b) => { b = Number(b) || 0; return b < 1000 ? `${b} B` : b < 1e6 ? `${(b / 1000).toFixed(1)} KB` : `${(b / 1e6).toFixed(1)} MB`; };
  const fwhen = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  const toNotesOk = (f) => ["md", "txt", "html"].includes(String(f.type || "").toLowerCase());
  function fileButtons(f, viewer = false) {
    known.set(f.id, f);
    return `${viewer ? "" : `<a class="agent-mini main" href="#agent/file/${encodeURIComponent(f.id)}">◎ Preview</a>`}<a class="agent-mini" href="${esc(f.url)}?download" download="${esc(f.name || "")}">⤓ Download</a>${toNotesOk(f) ? `<button type="button" class="agent-mini" data-fnotes="${esc(f.id)}">✎ Open in Notes</button>` : ""}<button type="button" class="agent-mini" data-fcopy="${esc(f.id)}">⧉ Copy</button>`;
  }
  const fileHead = (f) => `<div class="agent-file"><span class="agent-ftype" aria-hidden="true">${esc(f.type || "file")}</span><span class="agent-fwords"><b>${esc(f.title || f.name)}</b><span>${esc(f.name || "")}${f.size ? ` · ${fsize(f.size)}` : ""}${f.updated ? ` · ${esc(fwhen(f.updated))}` : ""}</span></span></div>`;
  const CARDS = {
    file(el, a) { el.innerHTML = `${fileHead(a.file)}<div class="agent-btns">${fileButtons(a.file)}</div>`; },
    // The safety net: a file named in the reply whose card couldn't be drawn: found in the list by its name
    async filelink(el, a) {
      const name = String(a.text || "").replace(/^(Wrote|Updated|Exported)\s+/i, "").trim();
      el.innerHTML = `<a class="agent-mini" href="#agent/files">▤ Open your files</a>`;
      try {
        const fl = (await peek("/files/list", 20000)).files || [];
        const f = fl.find((x) => x && (x.name === name || x.title === name));
        if (f) { known.set(f.id, f); el.innerHTML = `<a class="agent-mini" href="${esc(f.url)}?download" download="${esc(f.name)}">⤓ Download ${esc(f.name)}</a>`; }
      } catch (err) {}
    },
    // A reply Nova Agent drafted to an enquiry: nothing goes until a person presses Approve & send
    draft(el, a) {
      const d = a.draft;
      el.innerHTML = `<p class="agent-tag">Draft reply · waiting for approval</p><p class="agent-to">To ${esc(d.name || "")}${d.email ? ` &lt;${esc(d.email)}&gt;` : ""}</p><p class="agent-subj">${esc(`Re: ${d.subject || "your enquiry to Novacane Studios"}`)}</p><p class="agent-body pre">${esc(d.body || "")}</p><p class="agent-state">Checking…</p><div class="agent-btns"><button type="button" class="agent-mini main" data-ok hidden>✓ Approve &amp; send</button><a class="agent-mini" href="#inbox/enquiry/${encodeURIComponent(d.enquiryId)}">Open in Inbox</a></div>`;
      const ok = el.querySelector("[data-ok]");
      const path = `/app/api/enquiries/thread?id=${encodeURIComponent(d.enquiryId)}`;
      async function check() {
        let t;
        try { t = await peek(path); } catch (err) { ok.hidden = true; return stateLine(el, err.signIn ? "Approve it in Portal → Inbox (signed in). Nothing is sent until someone does." : err.message || "Open it in Inbox to approve it."); }
        const m = (t.messages || []).find((x) => x.id === d.id);
        ok.hidden = true;
        if (!m) return stateLine(el, "Discarded in Portal.");
        el.querySelector(".agent-body").textContent = m.body;
        d.body = m.body;
        if (m.status === "sent") return stateLine(el, `Sent ✓${m.approver_name ? ` · approved by ${m.approver_name}` : ""}`, "ok");
        if (m.status === "approved") return stateLine(el, "Sending…");
        if (m.status === "failed") return stateLine(el, `Didn’t send: ${String(m.error || "unknown reason").replace(/\.$/, "")}. Retry it in Inbox.`, "bad");
        if (t.enquiry && t.enquiry.state === "do-not-contact") return stateLine(el, "They’ve asked not to be contacted, so this can’t be sent.");
        if (!t.canSend) return stateLine(el, "Approve it in Portal → Inbox (sending needs a sign-in that can send).");
        ok.hidden = false;
        stateLine(el, `Not sent. Read it, then approve it to email ${d.name || "them"}.`);
      }
      ok.addEventListener("click", () => busy(ok, "Sending…", async () => {
        stateLine(el, "Sending…");
        try { await post("/app/api/enquiries/draft/approve", { messageId: d.id, body: d.body }); toast("Approved: it's on its way"); }
        catch (err) { stateLine(el, err.offline ? "Couldn’t reach Portal. Try again." : err.message || "Couldn’t send it.", "bad"); return; }
        forget(path);
        await check();
      }));
      check();
    },
    // A booking change Nova Agent proposed: it happens in Acuity when an admin presses Approve
    booking(el, a0) {
      const a = { ...a0.booking };
      el.innerHTML = `<p class="agent-tag">Booking change · waiting for an admin</p><p class="agent-subj">${esc(a.summary || "")}</p>${a.reason ? `<p class="agent-to">Why: ${esc(a.reason)}</p>` : ""}<p class="agent-state">Checking…</p><div class="agent-btns"><button type="button" class="agent-mini main" data-ok hidden>✓ Approve</button><button type="button" class="agent-mini" data-edit hidden>✎ Edit</button><button type="button" class="agent-mini danger" data-no hidden>✕ Reject</button><a class="agent-mini" href="#inbox/approvals">Open in Approvals</a></div>`;
      const [ok, ed, no] = ["[data-ok]", "[data-edit]", "[data-no]"].map((s) => el.querySelector(s));
      const path = "/app/api/booking-actions?status=all";
      let canDecide = false;
      const buttons = (on) => { ok.hidden = no.hidden = !on; ed.hidden = !on || !(BOOKING_FIELDS[a.kind] || []).length; };
      async function check() {
        let t;
        try { t = await peek(path); } catch (err) { buttons(false); return stateLine(el, err.signIn ? "An admin approves this in Portal → Approvals. Nothing changes in Acuity until then." : err.message || "Open it in Approvals to approve it."); }
        const now = (t.actions || []).find((x) => x.id === a.id);
        buttons(false);
        if (!now) return stateLine(el, "Open it in Approvals to see where it’s up to.");
        Object.assign(a, now);
        canDecide = !!t.canDecide;
        el.querySelector(".agent-subj").textContent = a.summary || "";
        const tag = el.querySelector(".agent-tag");
        if (a.status === "executed") { tag.textContent = "Booking change · done"; return stateLine(el, `Done in Acuity ✓${a.decidedByName ? ` · approved by ${a.decidedByName}` : ""}`, "ok"); }
        if (a.status === "approved") return stateLine(el, "Approved · going through to Acuity…");
        if (a.status === "failed") { tag.textContent = "Booking change · didn’t go through"; return stateLine(el, `Didn’t go through: ${String(a.error || "unknown reason").replace(/\.$/, "")}. Nothing else was changed.`, "bad"); }
        if (a.status === "rejected") { tag.textContent = "Booking change · rejected"; return stateLine(el, `Rejected${a.decidedByName ? ` by ${a.decidedByName}` : ""}. Nothing was changed.`); }
        if (!canDecide) return stateLine(el, "Waiting for an admin to approve it in Portal → Approvals. Nothing changes in Acuity until then.");
        buttons(true);
        stateLine(el, "Not done yet. Check it, then approve it to make the change in Acuity.");
      }
      async function decide(how, body, doing, btn) {
        await busy(btn, doing, async () => {
          try { const r = await post(`/app/api/booking-actions/${how}`, body); if (r && r.action) Object.assign(a, r.action); toast({ approve: "Approved", edit: "Saved", reject: "Rejected" }[how]); }
          catch (err) { stateLine(el, err.offline ? "Couldn’t reach Portal. Try again." : err.message || "That didn’t work.", "bad"); return; }
          forget("/app/api/booking-actions");
          await check();
        });
      }
      ok.addEventListener("click", () => decide("approve", { id: a.id }, "Approving…", ok));
      no.addEventListener("click", async () => { if (await confirm({ title: "Reject this booking change?", text: "Nothing changes in Acuity.", ok: "Reject it", danger: true })) decide("reject", { id: a.id }, "Rejecting…", no); });
      ed.addEventListener("click", async () => {
        const v = await editBooking(a, canDecide);
        if (v) decide(v.how, { id: a.id, payload: v.payload }, v.how === "approve" ? "Approving…" : "Saving…", v.how === "approve" ? ok : ed);
      });
      check();
    },
    // An email campaign Nova Agent drafted: it goes to people when an admin presses Approve
    campaign(el, a0) {
      const c = { ...a0.campaign };
      let count = c.audienceCount === undefined ? null : c.audienceCount, counts = null, canDecide = false;
      el.innerHTML = `<p class="agent-tag">Email campaign · waiting for an admin</p><p class="agent-subj"></p><p class="agent-to"></p><p class="agent-body pre"></p><p class="agent-state">Checking…</p><div class="agent-btns"><button type="button" class="agent-mini main" data-ok hidden>✓ Approve</button><button type="button" class="agent-mini" data-edit hidden>✎ Edit</button><button type="button" class="agent-mini danger" data-no hidden>✕ Reject</button><a class="agent-mini" href="#outreach/campaign/${encodeURIComponent(c.id)}">Open in Outreach</a></div>`;
      const [ok, ed, no] = ["[data-ok]", "[data-edit]", "[data-no]"].map((s) => el.querySelector(s));
      const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;
      function draw() {
        el.querySelector(".agent-subj").textContent = c.subject || "";
        const sent = c.status === "sent";
        el.querySelector(".agent-to").textContent = `To ${AUDIENCES[c.audience] || c.audience || ""}${sent && c.recipients != null ? ` · sent to ${people(c.recipients)}` : count != null ? ` · ${count} opted in` : ""} · ${sent && c.sentAt ? `sent ${ukWhen(c.sentAt)}` : c.sendAt ? `sends ${ukWhen(c.sendAt)} (UK time)` : "sends as soon as it’s approved"}`;
        el.querySelector(".agent-body").textContent = shortPreview(c.body);
      }
      async function check() {
        let t;
        try { t = await peek("/app/api/campaigns"); } catch (err) { ok.hidden = no.hidden = ed.hidden = true; return stateLine(el, err.signIn ? "An admin approves this in Portal → Campaigns. Nothing is sent until then." : err.message || "Open it in Outreach to approve it. Nothing is sent until an admin does."); }
        const now = (t.campaigns || []).find((x) => x.id === c.id);
        if (!now) { ok.hidden = no.hidden = ed.hidden = true; return stateLine(el, "Open it in Outreach to see where it’s up to."); }
        Object.assign(c, now);
        counts = t.audiences || null;
        if (counts && counts[c.audience] != null) count = counts[c.audience];
        canDecide = !!t.canDecide;
        draw();
        const waiting_ = c.status === "pending_approval" || c.status === "draft";
        ok.hidden = no.hidden = true;
        ed.hidden = !(waiting_ || c.status === "rejected");
        el.querySelector(".agent-tag").textContent = `Email campaign · ${waiting_ ? "waiting for an admin" : c.status === "sent" ? "sent" : c.status === "scheduled" ? "scheduled" : c.status === "rejected" ? "rejected" : c.status === "failed" ? "didn’t send" : "approved"}`;
        if (c.status === "sent") { const s = c.stats || {}; const base = Number(s.delivered) || Number(s.sent || c.recipients) || 0; return stateLine(el, `Sent ✓${c.decidedByName ? ` · approved by ${c.decidedByName}` : ""}${base && s.fetchedAt ? ` · ${Math.round(((Number(s.opened) || 0) / base) * 100)}% opened, ${Math.round(((Number(s.clicked) || 0) / base) * 100)}% clicked` : ""}`, "ok"); }
        if (c.status === "scheduled") return stateLine(el, `Approved${c.decidedByName ? ` by ${c.decidedByName}` : ""} · goes out ${ukWhen(c.sendAt)} (UK time)`, "ok");
        if (c.status === "approved") return stateLine(el, "Approved · going out now…");
        if (c.status === "failed") return stateLine(el, `Didn’t send: ${String(c.error || "unknown reason").replace(/\.$/, "")}. Nobody got it.`, "bad");
        if (c.status === "rejected") return stateLine(el, `Rejected${c.decidedByName ? ` by ${c.decidedByName}` : ""}${c.note ? `: “${c.note}”` : ""}. Nothing was sent; an edit sends it back for approval.`);
        if (!canDecide) return stateLine(el, "Waiting for an admin to approve it in Portal → Campaigns. Nothing is sent until then.");
        ok.hidden = no.hidden = false;
        stateLine(el, `Not sent. Read it (Open shows the whole email), then approve it to ${c.sendAt ? "schedule it." : "send it now."}`);
      }
      async function send_(path, body, doing, btn, done) {
        await busy(btn, doing, async () => {
          try { const r = await post(`/app/api/campaigns/${path}`, body); if (r && r.campaign) Object.assign(c, r.campaign); toast(done); }
          catch (err) { stateLine(el, err.offline ? "Couldn’t reach Portal. Try again." : err.message || "That didn’t work.", "bad"); return; }
          forget("/app/api/campaigns");
          await check();
        });
      }
      // Approve: sure first (it emails real people), after checking it's still what's on the card
      ok.addEventListener("click", async () => {
        if (!(await confirm({ title: c.sendAt ? "Schedule it?" : `Send it to ${count != null ? people(count) : "them"}?`, text: c.sendAt ? `It goes out ${ukWhen(c.sendAt)} (UK time).` : "It goes out now.", ok: c.sendAt ? "Schedule it" : "Send it" }))) return;
        const seen = c.updatedAt, was = c.status;
        let now = null;
        try { now = (await api(`/app/api/campaigns/${encodeURIComponent(c.id)}`, { cache: "no-store" })).campaign; } catch (err) {}
        if (!now || now.updatedAt !== seen || now.status !== was) { forget("/app/api/campaigns"); await check(); return stateLine(el, "It changed since the card was drawn: read it again, then approve.", "bad"); }
        send_(`${encodeURIComponent(c.id)}/approve`, {}, c.sendAt ? "Scheduling…" : "Sending…", ok, c.sendAt ? "Approved and scheduled" : "Approved and sending");
      });
      no.addEventListener("click", async () => { if (await confirm({ title: "Reject this campaign?", text: "Nothing is sent. An edit sends it back for approval.", ok: "Reject it", danger: true })) send_(`${encodeURIComponent(c.id)}/reject`, {}, "Rejecting…", no, "Rejected"); });
      ed.addEventListener("click", async () => { const v = await editCampaign(c, counts); if (v) send_(`${encodeURIComponent(c.id)}/edit`, v, "Saving…", ed, "Saved: it waits for approval again"); });
      draw();
      check();
    },
    // A one-to-one email Nova Agent drafted: checked and approved in Outreach, where it shows in full
    outreach(el, a) {
      const o = a.outreach;
      const waiting_ = o.status === "pending_approval" || o.status === "draft";
      const to = [o.toName, o.organisation].filter(Boolean).join(", ");
      el.innerHTML = `<p class="agent-tag">One-to-one email${waiting_ ? " · waiting for an admin" : ""}</p><p class="agent-subj">${esc(o.subject || "")}</p><p class="agent-to">${esc(`To ${to ? `${to} · ` : ""}${o.toEmail || ""}${o.kind === "client" && o.aboutBooking ? " · about their booking" : ""}`)}</p><p class="agent-body pre">${esc(shortPreview(o.body))}</p><p class="agent-state">${esc(waiting_ ? "Not sent: an admin approves it first" : o.status === "sent" ? "Sent" : o.status === "rejected" ? "Rejected" : o.status === "failed" ? "Didn’t send" : "Approved")}</p><div class="agent-btns"><a class="agent-mini${waiting_ ? " main" : ""}" href="#outreach/one/${encodeURIComponent(o.id)}">${waiting_ ? "Check &amp; approve in Outreach" : "Open in Outreach"}</a></div>`;
    },
  };
  const AUDIENCES = { fans: "Fans", clients: "Studio clients", everyone: "Everyone (fans and clients)" };
  const shortPreview = (body) => { const t = String(body || "").replace(/\*\*(.+?)\*\*/g, "$1").trim(); return t.length > 420 ? `${t.slice(0, 420).replace(/\s+\S*$/, "")}…` : t; };
  const ukWhen = (iso) => { const d = new Date(iso); return !iso || isNaN(d) ? "" : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).replace(/^(\p{L}+),/u, "$1"); };
  // A UTC time as UK wall-clock "YYYY-MM-DDTHH:MM" (for a date-and-time box), and back
  const ukParts = (t) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const ukLocal = (iso) => { const d = new Date(iso); if (!iso || isNaN(d)) return /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(iso || "") ? iso : ""; const p = ukParts(d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  const ukToIso = (local) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || "");
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    const offset = (t) => { const p = ukParts(t); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t; };
    let t = wall - offset(wall);
    t = wall - offset(t);
    return new Date(t).toISOString();
  };
  // The simple fields each kind of booking change can have changed before it's approved
  const BOOKING_FIELDS = {
    create: [["start", "When (UK)", "when"], ["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["notes", "Notes", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    reschedule: [["start", "New time (UK)", "when"], ["notifyClient", "Acuity emails the client", "tick"]],
    cancel: [["note", "Cancel note", "long"], ["notifyClient", "Acuity emails the client", "tick"]],
    update: [["firstName", "First name"], ["lastName", "Last name"], ["email", "Email"], ["phone", "Phone"], ["notes", "Notes", "long"]],
    block_add: [["start", "From (UK)", "when"], ["end", "Until (UK)", "when"], ["notes", "Notes", "long"]],
    block_remove: [],
  };
  function editBooking(a, canDecide) {
    const p = a.payload || {};
    const fields = (BOOKING_FIELDS[a.kind] || []).map(([key, label, type]) => {
      if (type === "tick") return `<label class="switch"><span>${esc(label)}</span><input type="checkbox" role="switch" name="${key}"${p[key] !== false ? " checked" : ""}></label>`;
      if (type === "long") return field({ label, name: key, type: "textarea", rows: 3, value: p[key] || "", attrs: 'maxlength="2000"' });
      return field({ label, name: key, type: type === "when" ? "datetime-local" : key === "email" ? "email" : key === "phone" ? "tel" : "text", value: type === "when" ? ukLocal(p[key]) : p[key] || "" });
    }).join("");
    return sheetForm(`<h2 class="sheet-title">Change the booking change</h2><p class="sheet-text">${esc(a.summary || "")}</p><form class="form" data-f>${fields}<div class="btns">${canDecide ? `<button class="btn main wide" type="submit" data-how="approve">✓ Approve with these changes</button>` : ""}<button class="btn wide${canDecide ? "" : " main"}" type="submit" data-how="edit">Save changes</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]");
        let how = "edit";
        f.querySelectorAll("[data-how]").forEach((b) => b.addEventListener("click", () => (how = b.dataset.how)));
        f.onsubmit = (ev) => {
          ev.preventDefault();
          const out = { ...p };
          for (const [key, , type] of BOOKING_FIELDS[a.kind] || []) {
            const input = f.elements[key];
            if (type === "tick") out[key] = input.checked;
            else if (input.value.trim() || key in out) out[key] = input.value.trim();
          }
          done({ how, payload: out });
        };
        el.querySelector("[data-no]").onclick = () => done(null);
      });
  }
  function editCampaign(c, counts) {
    return sheetForm(`<h2 class="sheet-title">Change the campaign</h2><form class="form" data-f>${field({ label: "Subject", name: "subject", value: c.subject || "", attrs: 'maxlength="150"' })}${field({ label: "The email", name: "body", type: "textarea", rows: 8, value: c.body || "", attrs: 'maxlength="20000"' })}${field({ label: "Who it goes to", name: "audience", type: "select", value: c.audience, options: Object.entries(AUDIENCES).map(([k, l]) => [k, `${l}${counts && counts[k] != null ? ` · ${counts[k]} opted in` : ""}`]) })}${field({ label: "Send at (UK time)", name: "sendAt", type: "datetime-local", value: c.sendAt ? ukLocal(c.sendAt) : "", hint: "Empty: as soon as it’s approved" })}<p class="form-said" data-said></p><div class="btns"><button class="btn main wide" type="submit">Save changes</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const f = el.querySelector("[data-f]"), said = el.querySelector("[data-said]");
        f.onsubmit = (ev) => {
          ev.preventDefault();
          const x = f.elements, local = x.sendAt.value, sendAt = local ? ukToIso(local) : null;
          said.classList.add("bad");
          if (local && (!sendAt || Date.parse(sendAt) < Date.now())) { said.textContent = "Pick a send time that hasn’t passed, or leave it empty."; return; }
          if (!x.subject.value.trim() || !x.body.value.trim()) { said.textContent = "It needs a subject and the email."; return; }
          done({ subject: x.subject.value.trim(), body: x.body.value.trim(), audience: x.audience.value, sendAt });
        };
        el.querySelector("[data-no]").onclick = () => done(null);
      });
  }
  // Copy a file's words, or open it in Notes as a new note (Markdown, text and web pages)
  async function fileText(f) {
    const r = await fetch(f.url, { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) throw new Error(r.status === 404 ? "That file has been deleted." : `Couldn't open it (${r.status}).`);
    return r.text();
  }
  async function toNotes(f, btn) {
    await busy(btn, "Opening…", async () => {
      try {
        const text = await fileText(f);
        const type = String(f.type || "").toLowerCase();
        const html = type === "md" ? mdDoc(text, true) : type === "html" ? safeHtml(text) : text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
        const id = uid(), now = new Date().toISOString();
        const r = await api(`/notes-api/notes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ title: f.title || f.name || "From Nova Agent", html, created: now, updated: now, pinned: false, named: true, gdocId: null, gdocUrl: null, gdocKeep: false, base: null }) });
        toast("In Notes now ✦");
        location.hash = `#notes/${encodeURIComponent((r && r.note && r.note.id) || id)}`;
      } catch (err) { toast(err.signIn ? "Sign in first" : `Couldn't open it in Notes: ${err.message}`, true); }
    });
  }
  async function copyFile(f, btn) {
    try { await navigator.clipboard.writeText(await fileText(f)); const was = btn.textContent; btn.textContent = "✓ Copied"; setTimeout(() => { if (btn.isConnected) btn.textContent = was; }, 1600); }
    catch (err) { toast(err.message && /deleted|open it/.test(err.message) ? err.message : "Couldn't copy", true); }
  }
  // (the file buttons, wherever they are on the page)
  document.getElementById("page").addEventListener("click", (e) => {
    const n = e.target.closest("[data-fnotes]"), c = e.target.closest("[data-fcopy]");
    const f = known.get((n || c || {}).dataset?.fnotes || (c || {}).dataset?.fcopy);
    if (!f) return;
    if (n) toNotes(f, n); else copyFile(f, c);
  });

  N.section({
    id: "agent",
    name: "Agent",
    tile: "chat",
    bottom: (path) => !path[0] && !paged,
    async draw(box, [part, a, b, c], ui) {
      await N.css("agent.css");
      if (part === "plan") return drawPlan(box, a || "ahead", ui);
      if (part === "rhythm") return drawRhythm(box, ui);
      // (Missions are gone from Nova, 23 Oct 2026: old links open the plan)
      if (part === "missions" || part === "mission") { history.replaceState(null, "", "#agent/plan"); return drawPlan(box, "ahead", ui); }
      if (part === "files") return drawFiles(box, ui);
      if (part === "file") return drawFile(box, a, ui);
      return drawChat(box, ui);
    },
  });

  // ---- Quests: the plan, kept up to date ----
  let state = null, stateAt = 0, stateWho = "", who = store.get("nova-phone/agent-who", "mine") === "everyone" ? "everyone" : "mine";
  async function loadState(maxAge = 0) {
    if (state && stateWho === who && Date.now() - stateAt < maxAge) return state;
    state = await api(`/quests/state${who === "everyone" ? "?who=everyone" : ""}`);
    stateAt = Date.now();
    stateWho = who;
    return state;
  }
  // Calendar's note cards (not Nova Agent's own copies of the plan), and its repeat rules (lib/recur.js)
  let cal = null, calAt = 0, recur = null;
  async function loadCal() {
    if (cal && Date.now() - calAt < 60000) return cal;
    try {
      const [r] = await Promise.all([api("/app/api/calendar/items"), recur ? null : import("./lib/recur.js").then((m) => (recur = m)).catch(() => null)]);
      cal = (r.items || []).filter((it) => it && !it.deleted && it.kind !== "day" && typeof it.start === "string" && !/^(quest|block|mile|music)-/.test(String(it.id || "")));
      calAt = Date.now();
    } catch (err) { cal = cal || []; }
    return cal;
  }
  const times = (n, from, to) => (recur ? recur.occurrences(n, from, to) : n.repeat ? [] : [{ start: n.start, end: n.end || n.start, date: n.start.slice(0, 10) }]);
  const onLive = () => /^#agent\/plan/.test(location.hash);
  let liveT = 0, refreshT = 0;
  const keyOf = (s) => (s ? JSON.stringify([{ ...s, now: String(s.now).slice(0, 16), notices: undefined }, (cal || []).length]) : "");
  function refreshLive(wait = 250) {
    clearTimeout(refreshT);
    refreshT = setTimeout(async () => {
      if (!onLive() || document.hidden) return;
      // (never while something is being typed, or a sheet is open: it waits for them)
      if (typing()) return refreshLive(2000);
      const before = keyOf(state);
      try { await loadState(0); } catch (err) { return; }
      if (keyOf(state) !== before && onLive() && !typing()) N.show();
    }, wait);
  }
  function liveOn() {
    if (liveT) return;
    // (every 10 s without the live line; with it, once a minute: the now-line and progress move)
    liveT = setInterval(() => {
      if (document.hidden) return;
      if (!onLive()) { clearInterval(liveT); liveT = 0; return; }
      const streaming = N.notices && N.notices.live();
      if (!streaming || Date.now() - stateAt > 55000) refreshLive(0);
    }, 10000);
  }
  addEventListener("nova-quests-changed", () => { if (onLive()) refreshLive(250); else stateAt = 0; });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && onLive()) refreshLive(0); });
  addEventListener("hashchange", () => { if (!onLive() && liveT) { clearInterval(liveT); liveT = 0; } });

  // ---- How a quest reads ----
  const hm = (s) => (s ? s.slice(11, 16) : "");
  const mins = (s) => { const [d, t = "00:00"] = String(s).split("T"); const [y, mo, da] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number); return Date.UTC(y, mo - 1, da, h, mi) / 60000; };
  const dayLong = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const shortDay = (s) => new Date(`${String(s).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  // "30 s", "2 min 30 s", "1 h 30 min", "3 days 4 h"; ongoing: "∞ · 30 min a day"
  function dur(q) {
    const secs = Math.round((Number(q.minutes) || 0) * 60);
    let t;
    if (secs < 60) t = `${secs} s`;
    else {
      const m = Math.floor(secs / 60), sr = secs % 60;
      if (m < 60) t = sr ? `${m} min ${sr} s` : `${m} min`;
      else { const h = Math.floor(m / 60), mm = m % 60; if (h < 48) t = mm ? `${h} h ${mm} min` : `${h} h`; else { const d = Math.floor(h / 24), hh = h % 24; t = hh ? `${d} days ${hh} h` : `${d} days`; } }
    }
    if (!q.ongoing) return t;
    const every = q.every === "interval" ? `every ${dur({ minutes: q.everyMinutes })}` : q.every === "week" ? "a week" : q.every === "weekday" ? "each weekday" : "a day";
    return `∞ · ${t} ${every}${q.sessions ? ` · ${q.sessions} done` : ""}${q.deadline ? ` · until ${q.deadline.slice(11, 16)}` : ""}`;
  }
  const MODES = [["waiting", "Waiting"], ["soon", "Soon"], ["working", "Working on it"], ["nearly", "Nearly finished"], ["longer", "Taking longer"], ["questions", "Questions"], ["done", "Done"]];
  const MODE = Object.fromEntries(MODES);
  const modeOf = (q) => (MODE[q.mode] ? q.mode : q.status === "done" ? "done" : q.status === "doing" ? "working" : "waiting");
  const modeChip = (q) => `<button type="button" class="agent-qm" data-mode="${modeOf(q)}" data-qmode="${esc(q.id)}" aria-label="How it's going: ${esc(MODE[modeOf(q)])} (tap to change)">${esc(MODE[modeOf(q)])}</button>`;
  // (no track tags: they belonged to missions, gone from Nova since 23 Oct 2026)
  const trackTag = () => "";
  const whose = (x) => (state && state.person && x && x.owner && x.owner !== state.person.id ? `${x.ownerName || x.owner}’s` : "");
  // Where a quest came from: where it was made ✎ ("Notes · Studio plan"), or ✧ Nova Agent
  const SRC = { notes: "✎", from: "✎", agent: "✧", person: "◎" };
  function sources(q) {
    const out = [];
    if (q.from) out.push({ kind: /^Notes\b/.test(q.from) ? "notes" : "from", label: String(q.from) });
    if (!out.length) out.push({ kind: "agent", label: "Nova Agent" });
    if (whose(q)) out.push({ kind: "person", label: whose(q) });
    return out;
  }
  const sourceTags = (q) => sources(q).map((s) => `<span class="agent-tag-s">${SRC[s.kind]} ${esc(s.label)}</span>`).join("");
  const sourceText = (q) => sources(q).map((s) => s.label).join(" · ");
  function questButtons(q) {
    const b = [], id = esc(q.id);
    const btn = (a, words, extra = "", main = false) => b.push(`<button type="button" class="agent-mini${main ? " main" : ""}" data-q="${id}" data-a="${a}"${extra}>${words}</button>`);
    if (q.status === "todo") btn("start", "▶ Start", "", true);
    if (q.status !== "done" && q.status !== "skipped") btn("done", `✓ ${q.ongoing ? "Session done" : "Done"}`, "", q.status === "doing");
    if (q.ongoing && q.status !== "done") btn("finish", "End quest");
    if (q.status === "doing" || q.status === "todo") btn("snooze", "+15 min", ' data-m="15"');
    if (q.status === "todo") { btn("snooze", "Not now", ' data-m="60"'); btn("skip", "Skip"); }
    if (q.status === "done" || q.status === "skipped") btn("reopen", "Undo");
    if (q.status !== "done" && q.status !== "skipped") b.push(`<button type="button" class="agent-mini" data-qphones="${id}" data-chosen="${esc((q.phones || []).join(","))}">📱 ${q.phones && q.phones.length ? `${q.phones.length} phone${q.phones.length === 1 ? "" : "s"}` : "Owner's phones"}</button>`);
    return `<div class="agent-btns">${b.join("")}</div>`;
  }
  const questMeta = (q) => [`<span class="agent-prio" data-p="${esc(q.priority || "normal")}">${esc(q.priority || "normal")}</span>`, esc(dur(q)), q.location ? `at ${esc(q.location)}` : "", q.travelMinutes && q.travelStart ? `leave ${hm(q.travelStart)} (${q.travelMinutes} min travel)` : "", q.deadline && !q.ongoing ? `due ${esc(q.deadline.replace("T", " "))}` : ""].filter(Boolean).join(" · ");
  const paintBars = (root) => { for (const el of root.querySelectorAll("[data-pct]")) el.style.setProperty("--p", el.dataset.pct); for (const el of root.querySelectorAll("[data-w]")) el.style.setProperty("--w", `${el.dataset.w}%`); };
  const offCard = async (box, tab, err) => { if (err.signIn) throw err; if (!isOff(err)) throw err; offline = true; watchPc(); box.innerHTML = partTabs(tab) + pcOff(); };
  const whoChips = () => (state && state.canSeeEveryone ? `<div class="chips" role="group" aria-label="Whose"><button type="button" class="chip" data-who="mine" aria-pressed="${state.scope !== "everyone"}">Mine</button><button type="button" class="chip" data-who="everyone" aria-pressed="${state.scope === "everyone"}">Everyone’s</button></div>` : "");

  // ---- The plan: today ----
  const openRows = new Set();
  async function drawPlan(box, tab, ui) {
    try { await Promise.all([loadState(4000), loadCal()]); } catch (err) { return offCard(box, "plan", err); }
    liveOn();
    ui.action({ icon: "cog", label: "Your rhythm", href: "#agent/rhythm" });
    const s = state, r = s.rhythm || {}, today = String(s.now).slice(0, 10), nowM = mins(s.now);
    const qs = (s.quests || []).filter((q) => q.status !== "removed");
    const items = [];
    for (const q of qs) if (q.start && q.start.startsWith(today) && q.status !== "skipped") items.push({ kind: "quest", start: q.start, end: q.end || q.start, q });
    for (const b of s.blocks || []) if (b.start.slice(0, 10) <= today && b.end.slice(0, 10) >= today) items.push({ kind: "block", start: b.start, end: b.end, b });
    for (const n of cal || []) for (const o of times(n, today, today)) items.push({ kind: "busy", start: o.start, end: o.end || o.start, n, date: o.date });
    items.sort((x, y) => x.start.localeCompare(y.start));
    const todays = items.filter((i) => i.kind === "quest");
    const plannedMin = todays.reduce((n, i) => n + (Number(i.q.minutes) || 0), 0);
    const doneN = todays.filter((i) => i.q.status === "done").length;
    const atRisk = qs.filter((q) => q.atRisk && q.status !== "done" && q.status !== "skipped").length;
    const cur = s.current, nxt = (s.next || [])[0];
    const nowId = cur ? cur.id : nxt ? nxt.id : "";
    let html = `${partTabs("plan")}${whoChips()}<div class="card agent-day"><p class="kicker">Today · up ${esc(r.wake || "")} · sleep ${esc(r.sleep || "")}${r.paceLimits === false ? ' · <span class="agent-warn">⚡ pace limits off</span>' : ""}</p><h2 class="card-title">${esc(dayLong(today))}</h2>
      <div class="sums"><div class="sum"><b>${todays.length}</b><span>quests</span></div><div class="sum"><b>${(plannedMin / 60).toFixed(1)}h</b><span>planned</span></div><div class="sum"><b>${doneN}</b><span>done</span></div>${atRisk ? `<div class="sum bad"><b>${atRisk}</b><span>at risk</span></div>` : ""}</div></div>`;
    // The quest on the big card: on now, or up next
    const from = (q) => (q.from ? `<p class="agent-tags"><span class="agent-tag-s">✎ ${esc(q.from)}</span></p>` : `<p class="agent-tags">${sourceTags(q)}</p>`);
    if (cur) {
      const pct = cur.start && cur.end ? Math.max(0, Math.min(100, ((nowM - mins(cur.start)) / Math.max(1, mins(cur.end) - mins(cur.start))) * 100)) : 0;
      html += `<div class="card agent-now" data-mode="${modeOf(cur)}"><div class="agent-now-top"><p class="kicker">✦ Quest · ${cur.status === "doing" ? "In progress" : "Happening now"}</p>${modeChip(cur)}</div><h2 class="card-title">${esc(cur.title)}</h2>
        <p class="muted small">${cur.start ? `${hm(cur.start)}–${hm(cur.end)} · ` : ""}${esc(dur(cur))}${cur.location ? ` · at ${esc(cur.location)}` : ""}</p>${from(cur)}
        <div class="agent-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct.toFixed(0)}" aria-label="How far through"><i data-w="${pct.toFixed(0)}"></i></div>${questButtons(cur)}</div>`;
    } else if (nxt) {
      html += `<div class="card agent-now" data-mode="${modeOf(nxt)}"><div class="agent-now-top"><p class="kicker">✦ Quest · Up next</p>${modeChip(nxt)}</div><h2 class="card-title">${esc(nxt.title)}</h2>
        <p class="muted small">${nxt.start.startsWith(today) ? "" : `${esc(dayLong(nxt.start.slice(0, 10)))} · `}${hm(nxt.travelStart && nxt.travelMinutes ? nxt.travelStart : nxt.start)}${nxt.travelMinutes ? ` (leave) · starts ${hm(nxt.start)}` : ""} · ${esc(dur(nxt))}${nxt.location ? ` · at ${esc(nxt.location)}` : ""}</p>${from(nxt)}${questButtons(nxt)}</div>`;
    } else html += empty({ icon: "quests", title: "Nothing on right now", text: "Say what you need to get done and Nova Agent fits it into your day." });

    // One timeline row: a quest, blocked time or a Calendar note card. Folded rows show the time and title, so the
    // whole day fits; tap one for its details and buttons
    const tl = (it, open, label = "") => {
      const past = mins(it.end) <= nowM;
      const key = `${it.kind}:${(it.q || it.b || it.n || {}).id || it.start}`;
      const isOpen = open || openRows.has(key);
      const time = `<span class="agent-tl-time"><b>${hm(it.start)}</b><small>${hm(it.end)}</small></span>`;
      if (it.kind === "quest") {
        const q = it.q;
        return `<li class="agent-tl${past ? " past" : ""}${q.id === nowId ? " is-now" : ""}">${time}<details class="agent-tl-card${q.atRisk ? " risk" : ""}${q.status === "done" ? " done" : ""}" data-mode="${modeOf(q)}" data-row="${esc(key)}"${isOpen ? " open" : ""}><summary>${label ? `<span class="agent-tl-label">${esc(label)}</span>` : ""}<b>${esc(q.title)}</b><span class="agent-tags"><span class="agent-tag-s">${q.ongoing ? "∞ Quest · repeat" : "✦ Quest"}</span>${modeChip(q)}${trackTag(q)}${q.atRisk ? '<span class="agent-risk">⚠ At risk</span>' : ""}</span></summary>
          <p class="agent-tags">${sourceTags(q)}</p><p class="agent-meta">${questMeta(q)}</p>${questButtons(q)}<a class="agent-link" href="#quests/quest/${encodeURIComponent(q.id)}">Open in Quests</a></details></li>`;
      }
      if (it.kind === "block") return `<li class="agent-tl${past ? " past" : ""}">${time}<div class="agent-tl-card block"><b>Busy · ${esc(it.b.reason || "blocked")}</b><p class="agent-meta">Blocked out · Agent</p><div class="agent-btns"><button type="button" class="agent-mini" data-unblock="${esc(it.b.id)}">Unblock</button></div></div></li>`;
      return `<li class="agent-tl${past ? " past" : ""}">${time}<a class="agent-tl-card busy" href="#calendar/day/${esc(it.date || today)}"><b>${esc(it.n.title || "Note card")}</b><span class="agent-meta">From Calendar${it.n.location ? ` · ${esc(it.n.location)}` : ""}</span></a></li>`;
    };
    const isDone = (it) => (it.kind === "quest" ? it.q.status === "done" : mins(it.end) <= nowM);
    const ahead = items.filter((it) => !isDone(it)), finished = items.filter(isDone);
    // The next few days
    const days = {};
    for (const q of qs) { if (!q.start || q.start.slice(0, 10) <= today || q.status === "skipped") continue; (days[q.start.slice(0, 10)] ||= []).push(q); }
    const dayKeys = Object.keys(days).sort().slice(0, 6);
    const laterBlocks = (s.blocks || []).filter((b) => b.start.slice(0, 10) > today);
    const pulses = s.pulses || [], unplanned = s.unplanned || [], over = s.overdue || [];
    const tabs = [["ahead", "Ahead", ahead.length + over.length], ["done", "Done", finished.length], ["coming", "Coming up", dayKeys.reduce((n, k) => n + days[k].length, 0) + laterBlocks.length], ["pulses", "Pulses", pulses.length], ["unplanned", "Needs a slot", unplanned.length]].filter(([id, , n]) => n || id === "ahead");
    if (!tabs.some(([id]) => id === tab)) tab = "ahead";
    html += `<div class="chips agent-subtabs" role="tablist">${tabs.map(([id, l, n]) => `<a class="chip" role="tab" href="#agent/plan/${id}" aria-current="${id === tab ? "page" : "false"}">${l}<span class="n">${n}</span></a>`).join("")}</div>`;
    // (a quest's row: its words open it in Quests; how it's going under them, so a narrow phone keeps the words wide)
    const qRow = (q, extra = "", chips = "") => `<li class="agent-line"><div class="agent-line-main"><a href="#quests/quest/${encodeURIComponent(q.id)}">${extra}<b>${q.atRisk ? "⚠ " : ""}${esc(q.title)}</b><span>${esc([dur(q), sourceText(q)].filter(Boolean).join(" · "))}</span></a>${chips ? `<span class="agent-tags">${chips}</span>` : ""}</div>`;
    if (tab === "ahead") {
      if (over.length) html += `<h3 class="h">Overdue</h3><ul class="list">${over.map((q) => `${qRow(q, `<small>Was due ${hm(q.end || q.deadline)}</small>`)}<span class="agent-line-end"><button type="button" class="agent-mini" data-q="${esc(q.id)}" data-a="done">✓ Done</button></span></li>`).join("")}</ul>`;
      if (!ahead.length) html += empty({ icon: "quests", title: items.length ? "All done for today ✦" : "Nothing planned today", text: items.length ? "" : "Say what you need to get done and Nova Agent fits it into your day." });
      else {
        const first = Math.max(0, ahead.findIndex((it) => !(it.kind === "quest" && it.q.id === nowId)));
        html += `<ul class="agent-timeline">${ahead.map((it, i) => (i === 0 && mins(it.start) > nowM ? `<li class="agent-nowline"><span>Now · ${hm(s.now)}</span></li>` : "") + tl(it, i === first, i === first && cur && i > 0 && it.kind === "quest" ? "Up next" : "")).join("")}</ul>`;
      }
    } else if (tab === "done") {
      html += `<ul class="agent-timeline">${finished.map((it) => tl(it, false)).join("")}</ul>`;
    } else if (tab === "coming") {
      html += dayKeys.map((k) => `<h3 class="h">${esc(dayLong(k))}</h3><ul class="list">${days[k].sort((x, y) => x.start.localeCompare(y.start)).map((q) => `${qRow(q, `<small>${hm(q.start)}</small>`, modeChip(q) + trackTag(q))}</li>`).join("")}</ul>`).join("");
      if (laterBlocks.length) html += `<h3 class="h">Blocked time</h3>${list(laterBlocks.map((b) => row({ button: `data-unblock="${esc(b.id)}"`, lead: `${esc(shortDay(b.start))}<br>${hm(b.start)}`, title: `Busy · ${b.reason || "blocked"}`, text: `Until ${b.end.slice(0, 10) === b.start.slice(0, 10) ? hm(b.end) : `${shortDay(b.end)} ${hm(b.end)}`}`, end: "Unblock" })))}`;
    } else if (tab === "pulses") {
      html += `<ul class="list">${pulses.map((q) => `<li class="agent-line"><span class="agent-line-main"><b>∞ ${esc(q.title)}</b><span>${esc([dur(q), sourceText(q)].join(" · "))}</span></span><span class="agent-line-end"><button type="button" class="agent-mini" data-q="${esc(q.id)}" data-a="finish">Stop</button></span></li>`).join("")}</ul>`;
    } else if (tab === "unplanned") {
      html += `<p class="muted small">These couldn't be fitted in yet: Nova Agent tries again each time the plan changes.</p><ul class="list">${unplanned.map((q) => `${qRow(q, "", modeChip(q) + trackTag(q))}</li>`).join("")}</ul>`;
    }
    html += alsoComingUp(s.now) + remindersCard() + `<button type="button" class="btn wide" data-replan>${icon("refresh")} Re-plan from now</button>`;
    box.innerHTML = html;
    paintBars(box);
    wirePlan(box);
  }
  // Also coming up: Calendar's note cards with reminders in the next 7 days; tap one: Calendar on that day
  const remindWords = (m) => { m = Number(m) || 0; if (m <= 0) return "At the start"; if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"} before`; if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"} before`; return `${m} min before`; };
  function later(stamp, minutes) { const x = new Date(mins(stamp) * 60000 + minutes * 60000); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}T${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; }
  function alsoComingUp(now) {
    const fromS = String(now).slice(0, 16), until = later(fromS, 7 * 1440), out = [];
    for (const n of cal || []) {
      const rem = Array.isArray(n.reminders) ? n.reminders.map(Number).filter((m) => Number.isFinite(m) && m >= 0) : [];
      if (!rem.length) continue;
      for (const o of times(n, fromS.slice(0, 10), until.slice(0, 10))) {
        const starts = n.allDay ? `${o.date}T23:59` : o.start.slice(0, 16);
        if (starts < fromS || o.start.slice(0, 16) >= until) continue;
        out.push({ title: n.title || "Note card", start: o.start, date: o.date, allDay: !!n.allDay, location: n.location || "", reminders: [...new Set(rem)].sort((x, y) => x - y) });
      }
    }
    out.sort((x, y) => x.start.localeCompare(y.start) || x.title.localeCompare(y.title));
    if (!out.length) return "";
    const shown = out.slice(0, 8), more = out.length - shown.length;
    return `<h3 class="h">Also coming up</h3>${list(shown.map((e) => row({ href: `#calendar/day/${e.date}`, lead: `${esc(shortDay(e.date))}<br>${e.allDay ? "All day" : hm(e.start)}`, title: e.title, text: `▦ Calendar · ⏰ ${remindWords(e.reminders[0])}${e.reminders.length > 1 ? ` +${e.reminders.length - 1}` : ""}${e.location ? ` · ${e.location}` : ""}` })))}${more ? `<a class="btn quiet wide" href="#calendar/day/${shown[shown.length - 1].date}">${more} more in Calendar</a>` : ""}`;
  }
  // Reminders on this phone: pop-ups here while Nova Phone is open, notifications when it isn't
  function remindersCard() {
    const p = "Notification" in window ? Notification.permission : "none";
    const words = p === "granted" ? "Notifications are allowed on this phone: reminders come even with Nova Phone closed." : p === "denied" ? "Notifications are blocked for Nova in this phone's settings. Reminders still pop up here while Nova Phone is open." : "Reminders pop up here while Nova Phone is open. Turn on notifications to get them with it closed too.";
    return `<a class="card agent-bell" href="#inbox/alert/phone"><p class="kicker">${icon("bell")} Pop-up reminders</p><p class="muted small">${esc(words)}</p></a>`;
  }
  function wirePlan(box) {
    box.addEventListener("toggle", (e) => { const d = e.target; if (d.matches && d.matches("details[data-row]")) (d.open ? openRows.add(d.dataset.row) : openRows.delete(d.dataset.row)); }, true);
    box.addEventListener("click", questClicks);
    box.querySelector("[data-replan]")?.addEventListener("click", (ev) => busy(ev.currentTarget, "Re-planning…", async () => {
      try { const r = await act("/actions/replan", {}); const res = r.result || r; toast(`Re-planned ✦ · ${res.atRisk || 0} quest${res.atRisk === 1 ? "" : "s"} at risk`); stateAt = 0; N.show(); } catch (err) { toast(err.message, true); }
    }));
  }
  // The buttons on quests, anywhere in Agent: how it's going, which phones, start / done / snooze / undo, unblock, whose
  async function questClicks(e) {
    const w = e.target.closest("[data-who]");
    if (w) { who = w.dataset.who; store.set("nova-phone/agent-who", who); stateAt = 0; return N.show(); }
    const mc = e.target.closest("[data-qmode]");
    if (mc) {
      e.preventDefault();
      e.stopPropagation();
      const m = await choose({ title: "How's it going?", options: MODES.map(([v, l]) => [v, mc.dataset.mode === v ? `${l} ✓` : l]) });
      if (!m) return;
      try { await act(`/actions/quests/${encodeURIComponent(mc.dataset.qmode)}`, { action: "mode", mode: m }); toast(MODE[m]); stateAt = 0; N.show(); } catch (err) { toast(err.message, true); }
      return;
    }
    const pb = e.target.closest("[data-qphones]");
    if (pb) {
      const phones = await pickPhones(pb.dataset.chosen ? pb.dataset.chosen.split(",") : []);
      if (!phones) return;
      try { await act(`/actions/quests/${encodeURIComponent(pb.dataset.qphones)}`, { changes: { phones } }); toast(phones.length ? `Reminders to ${phones.length} phone${phones.length === 1 ? "" : "s"}` : "Reminders to the owner's phones"); stateAt = 0; N.show(); } catch (err) { toast(err.message, true); }
      return;
    }
    const qb = e.target.closest("[data-q][data-a]");
    if (qb) {
      const how = qb.dataset.a;
      return busy(qb, "…", async () => {
        try { await act(`/actions/quests/${encodeURIComponent(qb.dataset.q)}`, { action: how, minutes: Number(qb.dataset.m) || undefined }); toast({ start: "Started", done: "Done ✦", finish: "Ended", skip: "Skipped", reopen: "Undone" }[how] || "Moved"); stateAt = 0; N.show(); } catch (err) { toast(err.message, true); }
      });
    }
    const ub = e.target.closest("[data-unblock]");
    if (ub) {
      if (!(await confirm({ title: "Unblock this time?", text: "Quests can be planned in it again.", ok: "Unblock" }))) return;
      try { await act("/actions/blocks", { remove: true, id: ub.dataset.unblock }); toast("Unblocked"); stateAt = 0; N.show(); } catch (err) { toast(err.message, true); }
    }
  }
  // Which phones get a quest's reminders: the owner's (none picked), or the ones ticked
  async function pickPhones(chosen) {
    let phones = [];
    try { phones = (await api("/app/api/push/phones")).phones || []; } catch (err) { if (err.signIn) { toast("Sign in first", true); return null; } }
    const before = JSON.stringify([...chosen].sort());
    return sheetForm(`<h2 class="sheet-title">Which phones get its reminders</h2><form class="form" data-f>
      <label class="switch"><span>The owner's phones</span><input type="checkbox" role="switch" name="owner"${chosen.some((id) => phones.some((p) => p.id === id)) ? "" : " checked"}></label>
      ${phones.length ? phones.map((p) => `<label class="switch"><span>${esc(p.name || "A phone")}${p.who ? ` · ${esc(p.who)}` : ""}</span><input type="checkbox" role="switch" name="phone" value="${esc(p.id)}"${chosen.includes(p.id) ? " checked" : ""}></label>`).join("") : `<p class="muted">No phones have notifications on yet. <a href="#inbox/alert/phone">Turn them on for this phone</a>.</p>`}
      <div class="btns"><button class="btn main wide" type="submit">Done</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => {
      const f = el.querySelector("[data-f]");
      f.addEventListener("change", (e) => {
        if (e.target.name === "owner" && e.target.checked) f.querySelectorAll("[name=phone]").forEach((c) => (c.checked = false));
        if (e.target.name === "phone") f.elements.owner.checked = !f.querySelector("[name=phone]:checked");
      });
      el.querySelector("[data-no]").onclick = () => done(null);
      el.querySelector('a[href^="#"]')?.addEventListener("click", () => done(null));
      f.onsubmit = (ev) => { ev.preventDefault(); const picked = [...f.querySelectorAll("[name=phone]:checked")].map((c) => c.value); done(JSON.stringify([...picked].sort()) === before ? null : picked); };
    });
  }
  async function drawRhythm(box, ui) {
    ui.back("#agent/plan");
    ui.title("Your rhythm");
    await loadState(4000);
    const r = state.rhythm || {};
    const n = (label, name, v, min, max) => field({ label, name, type: "number", value: v ?? "", attrs: `min="${min}" max="${max}"` });
    box.innerHTML = `<form class="form" id="rhythm" novalidate><p class="muted small">The planner fits quests around these, and re-plans the moment you save.</p>
      <div class="two-up">${field({ label: "Get up", name: "wake", type: "time", value: r.wake || "07:30" })}${field({ label: "Go to sleep", name: "sleep", type: "time", value: r.sleep || "23:30" })}</div>
      <div class="two-up">${n("Start-up (min)", "startUpMinutes", r.startUpMinutes, 0, 240)}${n("Wind-down (min)", "windDownMinutes", r.windDownMinutes, 0, 240)}</div>
      <div class="two-up">${n("Between quests (min)", "bufferMinutes", r.bufferMinutes, 0, 60)}${n("Remind before (min)", "remindMinutesBefore", r.remindMinutesBefore, 0, 120)}</div>
      <div class="two-up">${n("Break after (min)", "breakAfterMinutes", r.breakAfterMinutes, 30, 480)}${n("Break length (min)", "breakMinutes", r.breakMinutes, 0, 120)}</div>
      <div class="two-up">${n("Most quest hours a day", "maxQuestHoursPerDay", r.maxQuestHoursPerDay, 1, 18)}${n("Plan ahead (days)", "horizonDays", r.horizonDays, 3, 90)}</div>
      ${field({ label: "Home base", name: "homeBase", value: r.homeBase || "", hint: "Where travel times are worked out from" })}
      <fieldset class="field"><legend>Days off (no quests at all)</legend><div class="day-picks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day-pick"><input type="checkbox" name="daysOff" value="${d}"${(r.daysOff || []).includes(d) ? " checked" : ""}><span>${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d]}</span></label>`).join("")}</div></fieldset>
      ${N.toggle({ label: "Check in when a quest should be done", name: "checkIns", checked: r.checkIns })}
      ${N.toggle({ label: "Morning plan and evening wrap-up", name: "dailyBriefing", checked: r.dailyBriefing })}
      ${N.toggle({ label: "Reminders on the staff phones too", name: "phonePush", checked: r.phonePush })}
      ${N.toggle({ label: "Pace limits (buffers and breaks)", name: "paceLimits", checked: r.paceLimits !== false })}
      <p class="muted small">Pace limits (safety): quests start a few minutes ahead, on 5-minute marks, with buffers and breaks. Off: right away, to the second, back to back.</p>
      <button class="btn main wide" type="submit">${icon("check")} Save and re-plan</button></form>`;
    const f = box.querySelector("#rhythm");
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, out = { wake: x.wake.value, sleep: x.sleep.value, homeBase: x.homeBase.value.trim(), daysOff: [...f.querySelectorAll("[name=daysOff]:checked")].map((c) => Number(c.value)) };
      for (const k of ["startUpMinutes", "windDownMinutes", "bufferMinutes", "remindMinutesBefore", "breakAfterMinutes", "breakMinutes", "maxQuestHoursPerDay", "horizonDays"]) if (x[k].value !== "") out[k] = Number(x[k].value);
      for (const k of ["checkIns", "dailyBriefing", "phonePush", "paceLimits"]) out[k] = x[k].checked;
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => { try { await act("/actions/rhythm", out); f.classList.remove("dirty"); toast("Rhythm saved ✦ Everything has been re-planned around it"); stateAt = 0; location.hash = "#agent/plan"; } catch (err) { toast(err.message, true); } });
    });
  }

  // ---- Files Nova Agent wrote ----
  let files = [], filesAt = 0;
  async function loadFiles(maxAge = 0) {
    if (filesAt && Date.now() - filesAt < maxAge) return files;
    files = (await api("/files/list", { cache: "no-store" })).files || [];
    filesAt = Date.now();
    for (const f of files) known.set(f.id, f);
    return files;
  }
  async function drawFiles(box) {
    try { await loadFiles(0); } catch (err) { return offCard(box, "files", err); }
    box.innerHTML = `${partTabs("files")}<p class="muted small">Everything Nova Agent has written for you: read it, save it to this phone, or open it in Notes. Ask Nova Agent for any document, list, plan or spreadsheet.</p>${files.length ? list(files.map((f) => row({ href: `#agent/file/${encodeURIComponent(f.id)}`, lead: `<span class="agent-ftype small">${esc(f.type || "file")}</span>`, title: f.title || f.name, text: [f.name, f.size ? fsize(f.size) : ""].filter(Boolean).join(" · "), end: esc(ago(f.updated)) }))) : empty({ icon: "notes", title: "No files yet", text: "Try “write me a release checklist as a file” in Nova Agent." , action: `<button type="button" class="btn" data-say-file>${icon("chat")} Ask for one</button>` })}`;
    box.querySelector("[data-say-file]")?.addEventListener("click", () => say("Write me a release checklist as a file"));
  }
  async function drawFile(box, id, ui) {
    ui.back("#agent/files");
    let f = known.get(id);
    if (!f) { try { await loadFiles(20000); } catch (err) { return offCard(box, "files", err); } f = known.get(id); }
    if (!f) { box.innerHTML = empty({ icon: "notes", title: "That file isn't there any more", action: '<a class="btn" href="#agent/files">Your files</a>' }); return; }
    ui.title(f.title || f.name || "File");
    const type = String(f.type || (f.name || "").split(".").pop() || "").toLowerCase();
    let body = "";
    try {
      const text = await fileText(f);
      if (type === "md" || type === "markdown") body = `<div class="card prose agent-doc">${mdDoc(text)}</div>`;
      else if (type === "csv") { const rows = csvRows(text); body = rows.length ? `<div class="card agent-doc">${table(rows[0].map(esc), rows.slice(1).map((r) => r.map(esc)))}<p class="muted small">${rows.length - 1} rows · opens in Excel, Numbers or Google Sheets</p></div>` : `<p class="muted">Empty.</p>`; }
      else if (type === "json") { let t = text; try { t = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {} body = `<pre class="card agent-pre">${esc(t)}</pre>`; }
      else if (type === "html" || type === "htm") body = `<div class="card prose agent-doc">${safeHtml(text)}</div><p class="muted small">A web page, shown as its words only. Download it to see it as it was made.</p>`;
      else body = `<pre class="card agent-pre">${esc(text.slice(0, 100000))}</pre>`;
    } catch (err) { body = `<p class="muted">${esc(err.message)}</p>`; }
    box.innerHTML = `<div class="card"><div class="agent-file">${`<span class="agent-ftype" aria-hidden="true">${esc(f.type || "file")}</span>`}<span class="agent-fwords"><b>${esc(f.title || f.name)}</b><span>${esc(f.name || "")}${f.size ? ` · ${fsize(f.size)}` : ""}${f.updated ? ` · ${esc(fwhen(f.updated))}` : ""}</span></span></div><div class="agent-btns">${fileButtons(f, true)}<a class="agent-mini" href="${esc(f.url)}" target="_blank" rel="noopener">↗ Open</a><button type="button" class="agent-mini danger" data-del>${icon("trash")} Delete</button></div></div>${body}`;
    box.querySelector("[data-del]").addEventListener("click", async () => {
      if (!(await confirm({ title: `Delete “${f.title || f.name}”?`, ok: "Delete", danger: true }))) return;
      try { await act(`/actions/files/${encodeURIComponent(f.id)}/remove`, {}); files = files.filter((x) => x.id !== f.id); known.delete(f.id); filesAt = 0; toast("Deleted"); location.hash = "#agent/files"; } catch (err) { toast(err.message, true); }
    });
  }
})();
