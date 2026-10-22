// Portal → Outreach → Funnel: first emails to people in music (artists, producers, engineers,
// managers, labels, podcasters), sent slowly from the studio's Gmail (Nova Bot's src/funnel.js;
// GET /app/api/funnel says it all).
// At a glance: how many are Pending, Warming (approved, in the warm-up queue), Sent, Bounced or
// rejected, and Replied, with the reply rate; the warm-up (which day, today's limit, the next send,
// the last sending days); then the list. Add prospects (a CSV), Write drafts (Claude reads who they
// are and writes each one; risky words rewritten; three scores from the coach), Approve (admins in a
// browser: into the queue), and the settings (daily cap, warm-up, gaps, hours, what the studio offers
// each kind of person). Anyone can pause the sending; starting it is for an admin.
// Plain text only from the server (nothing drawn as HTML). app.js shows this section
// (window.PortalFunnel.load) and lends its helpers (PortalApp.kit).

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const K = () => window.PortalApp.kit;
  const el = (...a) => K().el(...a);

  const STATUS = {
    pending: ["pill-draft", "Pending"],
    warming: ["pill-new", "Warming"],
    sent: ["pill-replied", "Sent"],
    replied: ["pill-done", "Replied"],
    bounced: ["pill-failed", "Bounced"],
  };
  const STOPPED = { bounced: ["pill-failed", "Bounced"], opted_out: ["pill-stop", "Opted out"], rejected: ["pill-stop", "Rejected"] };
  const STEPS = { write: "To write", approve: "To approve", blocked: "Can't email" };
  // The filter chips: a step of Pending, or a status
  const FILTERS = [
    ["approve", "To approve"],
    ["write", "To write"],
    ["blocked", "Can't email"],
    ["warming", "Warming"],
    ["sent", "Sent"],
    ["replied", "Replied"],
    ["bounced", "Bounced"],
    ["all", "Everyone"],
  ];
  const EVENTS = { added: "Added", read: "Read", written: "Written", edited: "Changed", approved: "Approved", held: "Held", sent: "Sent", bounced: "Bounced", opted_out: "Opted out", rejected: "Rejected", replied: "Replied", failed: "Problem" };
  const METRICS = { deliverability: "Deliverability", open: "Open appeal", reply: "Reply incentive" };
  const PAGE = 40;

  let data = null;
  let filter = "approve";
  let shown = PAGE;
  let editing = null; // the prospect whose fields are open
  let timer = 0;
  let busy = false;
  const open = new Set(); // cards showing their email and history
  const details = new Map(); // id -> { updatedAt, log, email }

  const n = (x) => (Number(x) || 0).toLocaleString("en-GB");
  const mins = (s) => (s % 60 ? `${Math.round(s / 6) / 10} min` : `${s / 60} min`);
  const shortDay = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const limitFor = (s, day) => Math.min(s.cap, s.rampStart + s.rampStep * Math.floor((Math.max(1, day) - 1) / s.rampEvery));
  const matches = (p) => filter === "all" || p.status === filter || (p.status === "pending" && p.step === filter);

  // ===== Loading =====

  async function load() {
    const k = K();
    if (!k.running) return;
    let got;
    try {
      got = await k.api("funnel");
    } catch (err) {
      if (window.PortalApp.view === "funnel" && err.message !== "signed out") k.emptyState($("funnel-list"), err.status === 404 ? "The funnel isn't switched on yet: Nova Bot needs its update." : "Couldn't load the funnel: " + err.message);
      return;
    }
    const first = !data;
    data = got;
    k.setBadge("funnel-badge", data.canDecide ? data.prospects.filter((p) => p.step === "approve").length : 0);
    k.syncCounts();
    if (window.PortalApp.view !== "funnel") return;
    // The first time: start on whatever needs doing
    if (first) {
      const c = (f) => data.prospects.filter((p) => p.step === f || p.status === f).length;
      filter = c("approve") && data.canDecide ? "approve" : c("write") ? "write" : c("warming") ? "warming" : data.prospects.length ? "all" : "approve";
      const wanted = new URLSearchParams(location.search).get("funnel");
      if (wanted && FILTERS.some((f) => f[0] === wanted)) filter = wanted;
    }
    if (!editing) draw();
    clearTimeout(timer);
    // While it's open: the sender, replies and bounces change things by themselves
    timer = setTimeout(() => !document.hidden && window.PortalApp.view === "funnel" && load(), 60_000);
  }

  async function act(path, body, okText) {
    try {
      const out = await K().api(path, { body: body || {} });
      if (okText) K().toast(typeof okText === "function" ? okText(out) : okText);
      await load();
      return out;
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
      return null;
    }
  }

  // ===== Drawing =====

  function draw() {
    drawHead();
    drawStatus();
    drawGlance();
    drawWarmup();
    drawFilter();
    drawList();
    drawSettings();
  }

  function drawHead() {
    const s = data.settings;
    const run = $("funnel-run");
    run.textContent = s.paused ? "Start sending" : "Pause sending";
    run.setAttribute("aria-pressed", s.paused ? "false" : "true");
    run.hidden = s.paused && !data.canDecide;
    const left = data.prospects.filter((p) => p.step === "write").length;
    $("funnel-draft").textContent = left > 5 ? "Write next 5" : "Write drafts";
    $("funnel-draft").disabled = busy;
  }

  // Sending or paused, and anything that stops it working
  function drawStatus() {
    const s = data.settings;
    const box = $("funnel-status");
    const lines = [];
    const line = (cls, text) => lines.push(el("p", "fn-line " + cls, text));
    if (s.paused) line("off", "○ Sending is paused" + (s.pausedWhy ? ": " + s.pausedWhy.replace(/\.$/, "") : "") + ".");
    else line("on", "● Sending: " + (data.today.inHours ? "within today's sending hours" : `waiting for the sending hours (${String(s.fromHour).padStart(2, "0")}:00 to ${String(s.toHour).padStart(2, "0")}:00 UK${s.weekdaysOnly ? ", Monday to Friday" : ""})`) + ".");
    if (!data.ready.gmail) line("bad", "The studio's Gmail isn't connected for sending: Portal → Admin → Google, with \"Send approved emails from Gmail\" on. The funnel only sends from Gmail.");
    else line("muted", "From " + data.ready.account + (data.ready.replies ? ". Replies and bounces are read from its threads every 10 minutes." : ". Replies aren't being read: switch on \"Customers' replies into Enquiries\" in Portal → Admin → Google."));
    if (!data.ready.claude) line("muted", "Claude isn't connected here, so drafts come from the studio's templates (roles from keywords).");
    K().reconcile(box, lines);
  }

  function tile(label, value, note, f) {
    const b = el("button", "fn-tile" + (filter === f ? " on" : ""));
    b.type = "button";
    b.dataset.key = "tile-" + label;
    b.dataset.sig = K().sig(value, note, filter === f);
    b.setAttribute("aria-pressed", filter === f ? "true" : "false");
    b.append(el("span", "", label), el("b", "", value));
    if (note) b.append(el("small", "", note));
    b.addEventListener("click", () => setFilter(f));
    return b;
  }

  function drawGlance() {
    const c = data.counts;
    K().reconcile($("funnel-glance"), [
      tile("Pending", n(c.pending), c.written ? `${n(c.written)} written` : "on the list", c.written ? "approve" : "write"),
      tile("Warming", n(c.warming), "in the queue", "warming"),
      tile("Sent", n(c.sent), "no reply yet", "sent"),
      tile("Bounced", n(c.bounced), c.optedOut ? `or rejected · ${n(c.optedOut)} said no` : "or rejected", "bounced"),
      tile("Replied", n(c.replied), "sequence stopped", "replied"),
      tile("Reply rate", c.replyRate === null ? "–" : `${c.replyRate}%`, "of everyone emailed", "replied"),
    ]);
  }

  // The warm-up: today's numbers, then the last sending days and the next few (each day's limit marked)
  function drawWarmup() {
    const s = data.settings;
    const t = data.today;
    const box = $("funnel-warmup");
    const head = el("div", "fn-warm-head");
    head.append(el("h3", "card-title", `Warm-up day ${t.day}`));
    const facts = el("dl", "fn-facts");
    const fact = (label, value) => {
      const d = el("div");
      d.append(el("dt", "", label), el("dd", "", value));
      facts.append(d);
    };
    fact("Today", `${t.sent} of ${t.limit} sent`);
    fact("Next email", s.paused ? "Paused" : t.nextAt ? "After " + new Date(t.nextAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : data.counts.warming ? "Within a minute or two" : "Nothing in the queue");
    fact("Gaps", `${mins(s.gapMin)} to ${mins(s.gapMax)}, random`);
    fact("Steps", `${s.rampStart} a day, +${s.rampStep} every ${s.rampEvery} sending days, up to ${s.cap}`);

    // Bars: sent per day, the day's limit as a line across it; dashed: what's coming
    const days = t.days.slice();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const todayAt = days.findIndex((d) => d.day === today);
    const before = todayAt >= 0 ? todayAt : days.length;
    const bars = days.map((d, i) => ({ label: shortDay(d.day), sent: d.sent, limit: limitFor(s, t.day - (before - i)), today: d.day === today }));
    if (todayAt < 0) bars.push({ label: "Today", sent: 0, limit: t.limit, today: true });
    for (let i = 1; bars.length < 20 && i <= 6; i++) bars.push({ label: `Day ${t.day + i}`, sent: null, limit: limitFor(s, t.day + i), future: true });
    const top = Math.max(s.cap, ...bars.map((b) => b.sent || 0));
    const strip = el("div", "fn-bars");
    strip.setAttribute("role", "img");
    strip.setAttribute("aria-label", "Emails sent per sending day, with each day's limit: " + bars.map((b) => `${b.label} ${b.future ? "limit " + b.limit : `${b.sent} of ${b.limit}`}`).join("; "));
    for (const b of bars) {
      const col = el("span", "fn-bar" + (b.today ? " today" : "") + (b.future ? " future" : ""));
      col.title = b.future ? `${b.label}: up to ${b.limit}` : `${b.label}: ${b.sent} sent (limit ${b.limit})`;
      const cap = el("i", "fn-cap");
      cap.style.bottom = `${(b.limit / top) * 100}%`;
      const fill = el("i", "fn-fill");
      fill.style.height = `${((b.sent || 0) / top) * 100}%`;
      col.append(fill, cap);
      strip.append(col);
    }
    const key = el("p", "fn-key", "Bars: sent each sending day · line: that day's limit · dashed: the days coming up");
    box.replaceChildren(head, facts, strip, key);
  }

  function setFilter(f) {
    filter = f;
    shown = PAGE;
    draw();
  }

  function drawFilter() {
    const row = $("funnel-filter");
    const count = (f) => (f === "all" ? data.prospects.length : data.prospects.filter((p) => p.status === f || (p.status === "pending" && p.step === f)).length);
    const chips = FILTERS.map(([f, label]) => {
      const b = el("button", "chip" + (filter === f ? " active" : ""), `${label} ${count(f)}`);
      b.type = "button";
      b.dataset.key = "f-" + f;
      b.dataset.sig = K().sig(label, count(f), filter === f);
      b.setAttribute("aria-pressed", filter === f ? "true" : "false");
      b.addEventListener("click", () => setFilter(f));
      return b;
    });
    K().reconcile(row, chips);
    // Approve all that are ready: an admin, pressed twice
    const bulk = $("funnel-bulk");
    const ready = data.prospects.filter((p) => p.step === "approve");
    const parts = [];
    if (data.canDecide && filter === "approve" && ready.length) {
      const b = el("button", "btn small", `Approve all ${ready.length}`);
      b.type = "button";
      b.dataset.key = "bulk";
      b.dataset.sig = K().sig(ready.map((p) => p.updatedAt));
      b.addEventListener("click", () => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = `Queue all ${ready.length}?`;
          return;
        }
        approve(ready);
      });
      parts.push(b);
    }
    if (filter === "approve" && ready.length && !data.canDecide) parts.push(el("p", "card-foot", "An admin approves these, signed in to Portal in a browser. Nothing is sent until then."));
    K().reconcile(bulk, parts);
  }

  function drawList() {
    const list = $("funnel-list");
    list.removeAttribute("aria-busy");
    const all = data.prospects.filter(matches);
    if (!all.length) {
      const words = {
        approve: data.prospects.some((p) => p.step === "write") ? "Nothing to approve yet: press Write drafts." : "Nothing to approve. Add prospects to start.",
        write: "Everyone who can be emailed has an email written.",
        blocked: "Nobody on the list is blocked.",
        warming: "Nobody in the warm-up queue. Approve some to fill it.",
        sent: "Nobody waiting on a reply.",
        replied: "No replies yet.",
        bounced: "Nothing bounced or stopped.",
        all: "The list is empty. Add prospects (a CSV) to start.",
      };
      K().emptyState(list, words[filter]);
      return;
    }
    const nodes = all.slice(0, shown).map(card);
    if (all.length > shown) {
      const more = el("button", "btn small ghost fn-more", `Show ${Math.min(PAGE, all.length - shown)} more`);
      more.type = "button";
      more.dataset.key = "more";
      more.dataset.sig = String(all.length - shown);
      more.addEventListener("click", () => {
        shown += PAGE;
        drawList();
      });
      nodes.push(more);
    }
    K().reconcile(list, nodes);
  }

  function pillFor(p) {
    if (p.status === "bounced") return STOPPED[p.stopReason] || STATUS.bounced;
    if (p.status === "pending") return ["pill-draft", STEPS[p.step] || "Pending"];
    if (p.status === "warming" && p.sending) return ["pill-new", "Sending"];
    return STATUS[p.status] || ["pill-stop", p.status];
  }

  function scoreRow(scores, pass) {
    const row = el("div", "fn-scores");
    for (const [key, label] of Object.entries(METRICS)) {
      const v = scores[key];
      const s = el("span", "fn-score" + (v < pass ? " low" : ""));
      s.title = `${label}: ${v} out of 10`;
      const bar = el("i");
      bar.style.width = `${v * 10}%`;
      s.append(el("small", "", label), el("b", "", `${v}/10`), el("span", "fn-meter"));
      s.lastChild.append(bar);
      row.append(s);
    }
    return row;
  }

  function card(p) {
    const editingThis = editing === p.id;
    const isOpen = open.has(p.id);
    const detail = details.get(p.id);
    const c = el("article", "card cp-card fn-card" + (p.status === "pending" || p.status === "warming" ? "" : " done"));
    c.dataset.key = "p-" + p.id;
    c.dataset.sig = K().sig(p, data.canDecide, editingThis, isOpen, detail ? [detail.updatedAt, detail.log.length] : null);
    const top = el("div", "card-top");
    const title = el("h3", "card-title", p.name || p.email);
    const pill = pillFor(p);
    title.append(el("span", pill[0], pill[1]));
    top.append(title, el("span", "card-meta", K().ukWhen(p.sentAt || p.queuedAt || p.draftedAt || p.createdAt)));
    c.append(top, el("p", "card-who", [p.company, p.roleName].filter(Boolean).join(" · ") || "Company or project not given"));

    const facts = el("dl", "fn-facts");
    const fact = (label, value) => {
      if (!value) return;
      const d = el("div");
      d.append(el("dt", "", label), el("dd", "", value));
      facts.append(d);
    };
    fact("Email", p.email);
    if (p.roleName) fact("Role", p.roleName + (p.roleWhy ? ` (${p.roleWhy.replace(/\.$/, "")})` : ""));
    if (p.approvedAt && p.status === "warming") fact("In the queue", "Since " + K().ukWhen(p.queuedAt));
    if (p.sentAt) fact("Sent", K().ukWhen(p.sentAt));
    if (p.repliedAt) fact("Replied", K().ukWhen(p.repliedAt));
    if (p.messageId) fact("Message ID", p.messageId);
    c.append(facts);

    if (p.why) c.append(el("p", "appr-result bad", p.why));
    if (p.error) c.append(el("p", "appr-result bad", p.error));
    if (p.scores) c.append(scoreRow(p.scores, data.pass));
    if (p.swaps && p.swaps.length) c.append(el("p", "appr-result", "Risky words rewritten: " + p.swaps.map((s) => `${s.from} → ${s.to}`).join(", ")));

    if (editingThis) c.append(fields(p));
    else if (!isOpen && p.subject) c.append(el("p", "fn-subject", "Subject: " + p.subject));
    else if (isOpen && p.subject) {
      c.append(el("p", "fn-subject", "Subject: " + p.subject));
      c.append(el("div", "cp-plain", detail && detail.email ? detail.email : p.body));
      const tips = p.scores && p.scores.tips ? p.scores.tips.filter((t) => p.scores[t.metric] < data.pass) : [];
      if (tips.length && (p.status === "pending" || p.status === "warming")) {
        const ul = el("ul", "cp-log fn-tips");
        for (const t of tips) ul.append(el("li", "", `${METRICS[t.metric] || t.metric}: ${t.tip}`));
        c.append(ul);
      }
      if (detail && detail.log.length) {
        const log = el("ul", "cp-log");
        for (const e of detail.log.slice(-8)) log.append(el("li", "", K().ukWhen(e.at) + " · " + (EVENTS[e.event] || e.event) + (e.byName ? " · " + e.byName : "") + (e.detail ? " · " + e.detail : "")));
        c.append(log);
      }
    }

    const row = el("div", "actions");
    const button = (text, cls, fn) => {
      const b = el("button", "btn small" + (cls ? " " + cls : ""), text);
      b.type = "button";
      b.addEventListener("click", () => fn(b));
      row.append(b);
      return b;
    };
    // Pressed twice: the first press says what it'll do
    const twice = (text, sure, cls, fn) =>
      button(text, cls, (b) => {
        if (b.dataset.sure !== "1") {
          b.dataset.sure = "1";
          b.textContent = sure;
          return;
        }
        fn(b);
      });
    if (editingThis) {
      button("Save", "", () => save(c, p));
      button("Cancel", "ghost", () => {
        editing = null;
        draw();
      });
    } else {
      if (p.step === "approve" && data.canDecide) twice("Approve", "Queue it?", "", () => approve([p]));
      if (p.status === "pending" || p.status === "warming") {
        button("Edit", "ghost", () => {
          editing = p.id;
          draw();
        });
      }
      if (p.status === "pending" && p.step !== "blocked") button(p.subject ? "Rewrite" : "Write it", "ghost", (b) => write([p.id], b));
      if (p.status === "warming") button("Hold", "ghost", () => act(`funnel/${p.id}/hold`, {}, "Out of the queue: it waits for approval again."));
      if (p.status === "sent" || p.status === "warming") twice("Replied", "They replied?", "ghost", () => act(`funnel/${p.id}/replied`, {}, "Marked as replied: nothing more goes to them by itself."));
      if (p.threadId && data.ready.account) {
        const a = el("a", "btn small ghost", "Open in Gmail");
        a.href = `https://mail.google.com/mail/?authuser=${encodeURIComponent(data.ready.account)}#all/${encodeURIComponent(p.threadId)}`;
        a.target = "_blank";
        a.rel = "noopener";
        row.append(a);
      }
      if (p.subject) button(open.has(p.id) ? "Hide email" : "Show email", "ghost", () => toggle(p));
      if (p.status === "pending" || p.status === "warming" || p.status === "sent") {
        twice("Said no", "Never email them?", "ghost", () => act(`funnel/${p.id}/stop`, { why: "opted_out" }, "Recorded: they won't be emailed this way again."));
      }
      if (p.status === "pending" || p.status === "warming") twice("Reject", "Reject them?", "ghost", () => act(`funnel/${p.id}/stop`, { why: "rejected" }, "Rejected: they won't be emailed."));
      if (p.status === "pending" && !p.sentAt) twice("Remove", "Take off the list?", "ghost", () => act(`funnel/${p.id}/remove`, {}, "Taken off the list."));
    }
    if (row.children.length) c.append(row);
    return c;
  }

  async function toggle(p) {
    if (open.has(p.id)) {
      open.delete(p.id);
      draw();
      return;
    }
    open.add(p.id);
    try {
      const got = await K().api("funnel/" + p.id);
      details.set(p.id, { updatedAt: got.prospect.updatedAt, log: got.log || [], email: got.email });
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
    }
    draw();
  }

  // The edit fields, filled from what's saved
  function fields(p) {
    const box = el("div", "appr-edit fn-edit");
    const field = (label, input, wide) => {
      const l = el("label", "cp-field" + (wide ? " fn-wide" : ""));
      l.append(el("span", "", label), input);
      box.append(l);
    };
    const input = (key, value, max) => {
      const i = el("input");
      i.type = "text";
      i.value = value || "";
      i.maxLength = max;
      i.dataset.field = key;
      return i;
    };
    const area = (key, value, max, rows) => {
      const t = el("textarea");
      t.value = value || "";
      t.maxLength = max;
      t.rows = rows;
      t.dataset.field = key;
      return t;
    };
    field("Name", input("name", p.name, 100));
    field("Company or project", input("company", p.company, 120));
    const role = el("select");
    role.dataset.field = "role";
    role.append(new Option("Not decided", ""));
    for (const [key, name] of Object.entries(data.roles)) role.append(new Option(name, key, false, p.role === key));
    field("Role", role);
    field("Subject", input("subject", p.subject, 120), true);
    field("Email (the footer and opt-out link are added underneath)", area("body", p.body, 3000, 9), true);
    field("Bio and notes", area("bio", p.bio, 2000, 3), true);
    return box;
  }

  async function save(c, p) {
    const body = {};
    c.querySelectorAll("[data-field]").forEach((f) => (body[f.dataset.field] = f.value));
    const out = await act(`funnel/${p.id}/edit`, body, p.status === "warming" ? "Saved. It's out of the queue until it's approved again." : "Saved.");
    if (out) {
      editing = null;
      details.delete(p.id);
      draw();
    }
  }

  async function approve(list) {
    const out = await act("funnel/approve", { items: list.map((p) => ({ id: p.id, updatedAt: p.updatedAt })) });
    if (!out) return;
    const refused = out.refused || [];
    K().toast(`${out.approved} in the warm-up queue` + (refused.length ? ` · ${refused.length} not: ${refused[0].why}` : "") + (data.settings.paused ? " · sending is paused" : ""));
  }

  async function write(ids, b) {
    if (busy) return;
    busy = true;
    const buttons = [$("funnel-draft"), b].filter(Boolean);
    buttons.forEach((x) => {
      x.disabled = true;
      x.dataset.was = x.textContent;
      x.textContent = "Writing…";
    });
    try {
      const out = await K().api("funnel/draft", { body: ids ? { ids } : {} });
      K().toast(out.message || `Wrote ${out.written}` + (out.failed ? ` · ${out.failed} didn't come back${out.problem ? ` (${out.problem})` : ""}` : "") + (out.left ? ` · ${out.left} still to write` : ""));
      if (!ids && out.written) setFilter("approve");
    } catch (err) {
      if (err.message !== "signed out") K().toast(err.message);
    } finally {
      busy = false;
      buttons.forEach((x) => {
        x.disabled = false;
        x.textContent = x.dataset.was;
      });
      await load();
    }
  }

  // ===== Settings =====

  function drawSettings() {
    const box = $("funnel-settings");
    if (box.contains(document.activeElement)) return;
    const s = data.settings;
    const can = data.canDecide;
    const nodes = [];
    const grid = el("div", "cp-grid");
    const num = (key, label, lo, hi) => {
      const l = el("label", "cp-field");
      const i = el("input");
      i.type = "number";
      i.min = lo;
      i.max = hi;
      i.step = 1;
      i.value = s[key];
      i.dataset.set = key;
      i.disabled = !can;
      l.append(el("span", "", label), i);
      grid.append(l);
    };
    num("cap", "Daily cap (most a day, ever)", 1, 40);
    num("rampStart", "Day 1 to start", 1, 40);
    num("rampStep", "Then add", 0, 20);
    num("rampEvery", "Every … sending days", 1, 14);
    num("gapMin", "Shortest gap (seconds)", 120, 3600);
    num("gapMax", "Longest gap (seconds)", 120, 7200);
    num("fromHour", "Send from (hour, UK)", 0, 23);
    num("toHour", "Until (hour, UK)", 1, 24);
    nodes.push(grid);
    const tick = el("label", "cp-tick");
    const t = el("input");
    t.type = "checkbox";
    t.checked = Boolean(s.weekdaysOnly);
    t.dataset.set = "weekdaysOnly";
    t.disabled = !can;
    tick.append(t, el("span", "", "Monday to Friday only"));
    nodes.push(tick);
    const sign = el("label", "cp-field");
    const si = el("input");
    si.type = "text";
    si.maxLength = 80;
    si.value = s.signoff;
    si.dataset.set = "signoff";
    si.disabled = !can;
    sign.append(el("span", "", "Sign off as"), si);
    nodes.push(sign);
    nodes.push(el("h4", "dk-sub fn-sub", "What the studio offers each of them (Claude only offers what's here)"));
    const pitch = el("div", "fn-pitch");
    for (const [key, name] of Object.entries(data.roles)) {
      const l = el("label", "cp-field");
      const a = el("textarea");
      a.rows = 2;
      a.maxLength = 400;
      a.value = s.pitch[key] || "";
      a.dataset.pitch = key;
      a.disabled = !can;
      l.append(el("span", "", name), a);
      pitch.append(l);
    }
    nodes.push(pitch);
    const risky = el("details", "fn-risky");
    risky.append(el("summary", "", `Risky words, rewritten before anything is queued (${data.risky.length})`));
    const ul = el("ul", "cp-log");
    for (const r of data.risky) ul.append(el("li", "", `${r.words} → ${r.to}`));
    risky.append(ul);
    nodes.push(risky);
    if (can) {
      const row = el("div", "actions");
      const b = el("button", "btn small", "Save settings");
      b.type = "button";
      b.addEventListener("click", saveSettings);
      row.append(b);
      nodes.push(row);
    } else nodes.push(el("p", "card-foot", "An admin changes these, signed in to Portal in a browser."));
    box.replaceChildren(...nodes);
  }

  async function saveSettings() {
    const box = $("funnel-settings");
    const body = { pitch: {} };
    box.querySelectorAll("[data-set]").forEach((i) => (body[i.dataset.set] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) : i.value));
    box.querySelectorAll("[data-pitch]").forEach((a) => (body.pitch[a.dataset.pitch] = a.value));
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    await act("funnel/settings", body, "Settings saved.");
  }

  // ===== Adding prospects =====

  async function addList(e) {
    e.preventDefault();
    const file = $("funnel-file").files[0];
    const pasted = $("funnel-paste").value.trim();
    const result = $("funnel-import-result");
    result.className = "appr-result";
    if (!file && !pasted) {
      result.textContent = "Choose a CSV file, or paste the rows.";
      result.classList.add("bad");
      return;
    }
    const csv = file ? await file.text() : pasted;
    result.textContent = "Adding…";
    try {
      const out = await K().api("funnel/import", { body: { csv } });
      const bits = [`Added ${n(out.added)}`];
      if (out.duplicates) bits.push(`${n(out.duplicates)} already on the list`);
      if (out.invalid) bits.push(`${n(out.invalid)} without a good address`);
      if (out.optedOut) bits.push(`${n(out.optedOut)} said no before (kept as Opted out)`);
      if (out.already) bits.push(`${n(out.already)} already emailed or replied (kept that way)`);
      if (out.more) bits.push(`${n(out.more)} more than 2,000 left out: add them in a second file`);
      result.textContent = bits.join(" · ") + ".";
      result.classList.add("ok");
      $("funnel-file").value = "";
      $("funnel-paste").value = "";
      filter = "write";
      await load();
    } catch (err) {
      if (err.message === "signed out") return;
      result.textContent = err.message;
      result.classList.add("bad");
    }
  }

  // ===== Wiring =====

  function wire() {
    const form = $("funnel-import");
    if (!form || form.dataset.wired) return;
    form.dataset.wired = "1";
    $("funnel-import-open").addEventListener("click", () => {
      form.hidden = !form.hidden;
      $("funnel-import-open").setAttribute("aria-expanded", String(!form.hidden));
      if (!form.hidden) $("funnel-file").focus();
    });
    $("funnel-import-cancel").addEventListener("click", () => {
      form.hidden = true;
      $("funnel-import-open").setAttribute("aria-expanded", "false");
    });
    form.addEventListener("submit", addList);
    $("funnel-draft").addEventListener("click", () => write(null));
    $("funnel-settings-open").addEventListener("click", () => {
      const wrap = $("funnel-settings-wrap");
      wrap.hidden = !wrap.hidden;
      $("funnel-settings-open").setAttribute("aria-expanded", String(!wrap.hidden));
      if (!wrap.hidden) wrap.scrollIntoView({ block: "start" });
    });
    $("funnel-run").addEventListener("click", () => {
      if (!data) return;
      const start = data.settings.paused;
      act("funnel/pause", { paused: !start }, start ? "Sending started: the warm-up sends the queue a few minutes apart." : "Sending paused.");
    });
    // A sample file with the right headings, made here (nothing to fetch)
    $("funnel-sample").addEventListener("click", () => {
      const csv = "Name,Company/Project,Bio/Notes,Email\r\nSam Example,Example Records,\"A&R at an indie label, looking for new rock acts\",sam@example-records.co.uk\r\n";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = "prospects-sample.csv";
      document.body.append(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 500);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

  window.PortalFunnel = { load, setFilter };
})();
