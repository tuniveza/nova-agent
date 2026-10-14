// The Fixer's page: what it found, the fixes waiting for an admin, and its settings.
// It talks to the PC's server (/fixer-api/…, /actions/fixer/…); online, Nova Bot passes those on to
// the PC (admins only). Nothing here can put a change live except the Approve button.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let state = null;
  let tab = "needs";
  try { tab = sessionStorage.getItem("fixer-tab") || "needs"; } catch (e) {}
  const openDiffs = new Set();
  let onlyFails = false; // (the scripted checks: only what failed)
  const flips = new Map(); // which picture a phone shows, per job and screen

  const STATUS = {
    queued: "Waiting its turn", preparing: "Preparing (Claude Code is working on it)", checking: "Checking (tests, typecheck, sweep, pictures)",
    ready: "Needs you", failed: "Couldn't be prepared", approved: "Approved: going live", landing: "Going live: merging and deploying",
    restarting: "Going live: Nova Agent is restarting", verifying: "Live: checking nothing got worse", done: "Live",
    blocked: "Approved, but couldn't go live (nothing changed)", "rolling-back": "Undoing", "rolled-back": "Undone by itself (things got worse)",
    undone: "Undone", rejected: "Rejected", closed: "Closed: the problem went away by itself",
  };
  const KIND = { bug: "Bug", glitch: "Glitch", change: "Change" };

  // ---- Talking to the server ----
  async function getJson(path) {
    const res = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.message || body.error || `The Fixer answered ${res.status}`), { status: res.status, body });
    return body;
  }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Nova-Visualizer": "1" }, body: JSON.stringify(body || {}) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.message || out.error || `The Fixer answered ${res.status}`);
    return out.result;
  }
  function say(text, bad) {
    const m = $("message");
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("bad", !!bad);
    clearTimeout(say.t);
    if (text) say.t = setTimeout(() => (m.hidden = true), 7000);
  }
  async function act(path, body, done) {
    try {
      await post(path, body);
      if (done) say(done);
      await load();
    } catch (err) {
      say(err.message, true);
    }
  }

  // ---- Times ----
  const ago = (iso) => {
    if (!iso) return "never";
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const clock = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  // ---- Tabs ----
  // On a wide screen every part shows at once (fixer.css lays them side by side) and the tabs go
  const WIDE = matchMedia("(min-width: 1100px) and (min-height: 600px)");
  function showTab(name) {
    tab = name;
    try { sessionStorage.setItem("fixer-tab", name); } catch (e) {}
    document.documentElement.classList.toggle("fx-wide", WIDE.matches);
    document.documentElement.classList.toggle("fx-needs", name === "needs");
    for (const b of document.querySelectorAll(".fx-tabs [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const p of document.querySelectorAll(".pane")) p.hidden = !WIDE.matches && p.id !== `pane-${name}`;
  }
  for (const b of document.querySelectorAll(".fx-tabs [role=tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));
  WIDE.addEventListener("change", () => showTab(tab));

  // ---- Drawing ----
  const shot = (job, file) => `/fixer-api/shots/${encodeURIComponent(job.id)}/${encodeURIComponent(file)}`;

  // ================= Needs you: one fix at a time, as a big clear card =================
  // Its status in a word or two, and a colour (prep: being prepared, ready: waits for you, live, bad)
  const CHIP = {
    queued: ["Preparing…", "prep"], preparing: ["Preparing…", "prep"], checking: ["Checking", "prep"], ready: ["Ready for you", "ready"],
    approved: ["Going live…", "live"], landing: ["Going live…", "live"], restarting: ["Going live…", "live"], verifying: ["Going live…", "live"],
    done: ["Live", "live"], blocked: ["Couldn't go live", "bad"], rejected: ["Rejected", "bad"], failed: ["Couldn't be prepared", "bad"],
    "rolling-back": ["Undoing", "bad"], "rolled-back": ["Undone", "bad"], undone: ["Undone", "bad"], closed: ["Closed", "prep"],
  };
  const PREPARING = ["queued", "preparing", "checking"];
  const GOING = ["approved", "landing", "restarting", "verifying"];
  // The looks check's kinds of problem, said plainly (a card from before Claude Code wrote headlines)
  const KIND_TITLE = {
    blank: "shows nothing", "top-gap": "big empty gap at the top", gap: "big empty gap", "header-low": "its header sits too low",
    "page-scrolls": "the whole page scrolls", "main-scrolls": "the whole page scrolls", "cut-off": "cut off at the bottom",
    offscreen: "buttons off the screen", "text-cut": "text cut off", covered: "hidden behind the bars", "title-count": "two title panels at once",
    unused: "wasted empty space", error: "a script error", slow: "slow to open", open: "won't open",
  };
  const KIND_CAUSE = {
    blank: "The page loaded but drew nothing: usually a script stopping early, or its content hidden by mistake.",
    "top-gap": "Something empty at the top pushes its content down.",
    gap: "A box between its parts takes up room with nothing in it.",
    "header-low": "Its own header is drawn after the content instead of at the top.",
    "page-scrolls": "The page is taller than the room it gets, so the whole page scrolls instead of one box inside it.",
    "main-scrolls": "Its main area scrolls as a whole, instead of the box that holds the long content.",
    "cut-off": "The page is taller than the room it gets and nothing inside it scrolls, so the bottom is hidden.",
    offscreen: "A row is wider than the screen and doesn't wrap or scroll inside itself.",
    "text-cut": "The words are longer than their box, and the box clips them without a “…”.",
    covered: "The panel's box runs under the title panel or the navigation panel.",
    "title-count": "The panel draws its own title bar as well as Nova Agent's.",
    unused: "The panel's box is smaller than the room between the bars.",
    error: "A script on the page failed while it opened.",
    slow: "It loads a lot, or waits for a slow answer, before it shows.",
    open: "Nova Agent couldn't open it, or it didn't finish loading.",
  };
  const cleanTitle = (t) => String(t || "").replace(/\s*\(and at \d+ other sizes?\)\s*$/, "").trim();
  const firstSentence = (t) => {
    const s = String(t || "").trim().replace(/\s+/g, " ");
    const m = /^(.{12,240}?[.!?])(\s|$)/.exec(s);
    return m ? m[1] : s.length > 240 ? `${s.slice(0, 237)}…` : s;
  };
  const widthOf = (w) => parseInt(String(w), 10) || 0;
  function sizeWord(where) {
    const ws = (where || []).map(widthOf).filter(Boolean);
    if (!ws.length) return "";
    if (ws.every((w) => w < 800)) return " on phones";
    if (ws.every((w) => w >= 1100)) return " on big screens";
    if (ws.every((w) => w >= 800 && w < 1100)) return " on tablets";
    return "";
  }
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  // The card's words: Claude Code's headline when it wrote one, else made from what the check saw
  function words(job) {
    const c = job.card || {};
    const a = job.about || {};
    const panel = a.panelName || (c.screens && c.screens[0] && c.screens[0].name) || "";
    const made = a.kind && KIND_TITLE[a.kind] ? `${panel ? `${panel}: ` : ""}${KIND_TITLE[a.kind]}${sizeWord(a.where)}` : "";
    const preparing = PREPARING.includes(job.status);
    const quest = job.target.type === "quest";
    const wrong = c.wrong || (a.problem ? cap(a.problem) : "") || (quest ? firstSentence(job.target.details) || cleanTitle(job.target.title) : firstSentence(c.why) || cleanTitle(job.target.title));
    const why = c.why && c.why !== job.target.title && firstSentence(c.why) !== wrong ? firstSentence(c.why) : "";
    return {
      panel,
      title: c.title || made || cleanTitle(job.target.title),
      wrong,
      cause: c.cause || (a.kind && KIND_CAUSE[a.kind]) || (quest ? "You asked for it in a fixer quest." : why) || "Not worked out yet.",
      fix: c.fix || firstSentence(c.summary) || (preparing ? "Claude Code is preparing a fix now. It shows here with before and after pictures, and waits for you." : job.error ? firstSentence(job.error) : "—"),
    };
  }
  // The pictures for a fix: each screen it was seen on, its before and after, and where the problem is.
  // A fix still being prepared shows the looks check's own picture of the problem.
  function screensOf(job) {
    const s = state;
    const out = [];
    for (const sc of (job.card && job.card.screens) || []) {
      if (!sc.before && !sc.after) continue;
      const label = sc.label || `${sc.name} · ${sc.width < 800 ? "phone" : "computer"} (${sc.width}px)`;
      out.push({ label, width: sc.width, height: sc.height || 0, before: sc.before ? shot(job, sc.before) : "", after: sc.after ? shot(job, sc.after) : "", boxes: sc.boxes || [] });
    }
    const a = job.about;
    if (!out.length && a && a.kind && s && s.looks) {
      for (const r of s.looks.results || []) {
        if (r.path !== a.panel || !r.shot) continue;
        const ps = r.problems.filter((p) => p.kind === a.kind);
        if (!ps.length) continue;
        out.push({ label: `${r.width}×${r.height}, ${r.signedIn ? "signed in" : "signed out"}`, width: r.width, height: r.height, before: `/fixer-api/shots/looks/${encodeURIComponent(r.shot)}`, after: "", boxes: ps.map((p) => p.box).filter(Boolean) });
        if (out.length >= 8) break;
      }
    }
    return out;
  }
  function art(sc, which, big) {
    const url = which === "before" ? sc.before : sc.after;
    if (!url) return `<div class="fx-nopic">${which === "before" ? "No before picture" : PREPARING.includes(deckJob()?.status) ? "The after picture comes when the fix is ready" : "No after picture"}</div>`;
    const tone = which === "before" ? "bad" : "ok";
    const label = esc(`${sc.label}, ${which}${sc.boxes.length ? (which === "before" ? ": the problem outlined in red" : ": the same place outlined in green") : ""}`);
    if (sc.width && sc.height) {
      const rects = sc.boxes
        .map((b) => `<rect class="fx-box ${tone}" x="${Math.max(0, b.x) - 3}" y="${Math.max(0, b.y) - 3}" width="${Math.max(10, b.w) + 6}" height="${Math.max(10, b.h) + 6}" rx="8"/>`)
        .join("");
      return `<svg class="fx-svg${big ? " big" : ""}" viewBox="0 0 ${sc.width} ${sc.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${label}"><image href="${esc(url)}" width="${sc.width}" height="${sc.height}"/>${rects}</svg>`;
    }
    return `<img class="fx-img" src="${esc(url)}" alt="${label}">`;
  }

  // Which fix is showing, which of its screens, before or after
  const pick = { id: "", screen: 0, pic: "before" };
  let later = {};
  try { later = JSON.parse(localStorage.getItem("fixer-later") || "{}") || {}; } catch (e) {}
  const snoozed = (id) => (later[id] || 0) > Date.now();
  function deckJobs() {
    const s = state;
    if (!s) return [];
    const all = [...s.needsYou, ...s.working.filter((j) => j.status === "blocked"), ...s.working.filter((j) => j.status !== "blocked")];
    return [...all.filter((j) => !snoozed(j.id)), ...all.filter((j) => snoozed(j.id))];
  }
  function deckJob() {
    const jobs = deckJobs();
    return jobs.find((j) => j.id === pick.id) || jobs[0] || null;
  }
  function step(by) {
    const jobs = deckJobs();
    if (!jobs.length) return;
    const i = Math.max(0, jobs.findIndex((j) => j.id === (deckJob() || {}).id));
    const next = jobs[(i + by + jobs.length) % jobs.length];
    go(next.id);
  }
  function go(id) {
    if (pick.id !== id) Object.assign(pick, { id, screen: 0, pic: "before" });
    renderDeck();
    const b = document.querySelector(`.fx-pill[data-go="${CSS.escape(id)}"]`);
    if (b) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function fixCard(job) {
    const c = job.card || {};
    const a = job.about || {};
    const w = words(job);
    const [chip, tone] = CHIP[job.status] || [job.status, "prep"];
    const sev = a.severity === "serious" ? "serious" : a.severity === "minor" ? "small" : job.target.type === "quest" ? "quest" : "none";
    const sevWord = sev === "serious" ? "Serious" : sev === "small" ? "Small" : sev === "quest" ? (KIND[job.target.kind] || "Fixer quest") : "";
    const rec = c.recommendation || null;
    const failed = (c.checks || []).filter((k) => !k.ok).length;
    const screens = screensOf(job);
    if (pick.screen >= screens.length) pick.screen = 0;
    const sc = screens[pick.screen];
    const where = screens.length
      ? screens.map((x, i) => `<button type="button" class="fx-where" data-screen="${i}" aria-pressed="${i === pick.screen}">${esc(x.label)}</button>`).join("")
      : (a.where || []).length
        ? a.where.map((x) => `<span class="fx-where">${esc(x)}</span>`).join("")
        : `<span class="fx-where">${esc(w.panel || (job.target.type === "quest" ? "Nova Agent" : "Nova Agent"))}</span>`;
    const pic = sc
      ? `<figure class="fx-pic">
          <div class="fx-flip" role="tablist" aria-label="Before or after">
            <button type="button" role="tab" data-pic="before" aria-selected="${pick.pic === "before"}">Before</button>
            <button type="button" role="tab" data-pic="after" aria-selected="${pick.pic === "after"}">After</button>
          </div>
          <div class="fx-frame" data-zoomart tabindex="0" role="button" aria-label="See the picture full screen">${art(sc, pick.pic)}</div>
          <figcaption>${sc.boxes.length ? (pick.pic === "before" ? "<b class=\"bad\">Red</b> = the problem" : "<b class=\"ok\">Green</b> = the same place after the fix") + " · " : ""}tap to see it big</figcaption>
        </figure>`
      : `<figure class="fx-pic"><div class="fx-nopic big">${PREPARING.includes(job.status) ? "Pictures come when the fix is ready." : "No pictures: this fix changes how something works, not how it looks."}</div></figure>`;
    const actions = job.status === "ready" || job.status === "blocked"
      ? `<button type="button" class="fx-approve" data-act="approve" data-id="${esc(job.id)}" aria-keyshortcuts="A">✓ ${job.status === "blocked" ? "Try again" : "Approve"}</button>
         <button type="button" class="fx-reject" data-act="reject" data-id="${esc(job.id)}" aria-keyshortcuts="R">✕ Reject</button>
         <button type="button" class="fx-tweak-btn" data-act="tweak-open" data-id="${esc(job.id)}">✎ Tweak</button>
         <button type="button" class="fx-later" data-act="later" data-id="${esc(job.id)}">Later</button>`
      : `<p class="fx-wait">${PREPARING.includes(job.status) ? "Being prepared: nothing to do yet. It waits for you when it's ready." : GOING.includes(job.status) ? "Going live now: this follows along." : esc(chip)}</p>
         <button type="button" class="fx-later" data-act="later" data-id="${esc(job.id)}">Later</button>`;
    const details = `<details class="fx-more" data-diff="${esc(job.id)}"${openDiffs.has(job.id) ? " open" : ""}><summary>Details</summary><div class="fx-more-body">
        ${c.summary ? `<div class="block"><h4>What changed</h4><p>${esc(c.summary)}</p></div>` : ""}
        ${c.consequences ? `<div class="block"><h4>What this means for you</h4><p>${esc(c.consequences)}</p></div>` : ""}
        ${c.assessment || (c.risks || []).length ? `<div class="block"><h4>Is it a good idea?</h4>${c.assessment ? `<p>${esc(c.assessment)}</p>` : ""}${(c.risks || []).length ? `<ul>${c.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div>` : ""}
        ${rec ? `<div class="block"><h4>Recommendation</h4><span class="verdict ${esc(rec.verdict)}">${esc(rec.verdict === "approve" ? "Approve" : rec.verdict === "reject" ? "Reject" : "Ask for a tweak")}</span>${(rec.reasons || []).length ? `<ul>${rec.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div>` : ""}
        ${(c.checks || []).length ? `<div class="block"><h4>Checks</h4><ul class="checks">${c.checks.map((k) => `<li class="${k.ok ? "ok" : "no"}"><span><span class="mark">${k.ok ? "✓" : "✕"}</span> ${esc(k.name)}</span>${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ""}</li>`).join("")}</ul></div>` : ""}
        ${(c.files || []).length ? `<div class="block"><h4>Files (${c.files.length})</h4><ul class="files">${c.files.map((f) => `<li>${f.repo === "nb" ? "Nova Bot" : "Nova Agent"} · ${esc(f.path)} <span class="add">+${f.added}</span> <span class="del">−${f.removed}</span></li>`).join("")}</ul>
          <pre class="diff" id="diff-${esc(job.id)}"><span class="nt-loading">Loading the changes…</span></pre></div>` : ""}
        <div class="block"><h4>As found</h4><p>${esc(job.target.title)}</p>${job.target.details ? `<pre>${esc(job.target.details)}</pre>` : ""}</div>
        ${job.error ? `<div class="block"><h4>Problem</h4><p>${esc(job.error)}</p></div>` : ""}
        <p class="nt-note">${esc(job.target.type === "quest" ? "A fixer quest" : "Found by the Fixer's checks")} · ${esc(ago(job.created))}${job.attempt > 1 ? ` · attempt ${job.attempt}` : ""}</p>
      </div></details>`;
    return `<article class="fx-card sev-${sev}" data-job="${esc(job.id)}">
      <header class="fx-head">
        <div class="fx-chips">
          ${sevWord ? `<span class="fx-sev ${sev}">${esc(sevWord)}</span>` : ""}
          ${w.panel ? `<span class="fx-panel"><span class="fx-panel-ico" aria-hidden="true">${esc(w.panel.slice(0, 1))}</span>${esc(w.panel)}</span>` : ""}
          <span class="fx-status ${tone}">${esc(chip)}</span>
          ${c.checks && c.checks.length ? `<span class="nt-chip ${c.allPassed ? "ok" : "bad"}">${c.allPassed ? "✓ Checks passed" : `${failed} check${failed === 1 ? "" : "s"} failed`}</span>` : ""}
          ${rec && job.status === "ready" ? `<span class="nt-chip ${rec.verdict === "approve" ? "ok" : rec.verdict === "reject" ? "bad" : "warn"}">Suggests: ${esc(rec.verdict === "approve" ? "Approve" : rec.verdict === "reject" ? "Reject" : "Tweak")}</span>` : ""}
          ${c.trivial ? `<span class="nt-chip ok">Tiny change</span>` : ""}
          ${snoozed(job.id) ? `<span class="nt-chip">Later</span>` : ""}
        </div>
        <h3 class="fx-title">${esc(w.title)}</h3>
      </header>
      <div class="fx-body">
        <div class="fx-side">
          <dl class="fx-facts">
            <div class="fx-row fx-r-wrong"><dt>What's wrong</dt><dd>${esc(w.wrong)}</dd></div>
            <div class="fx-row fx-r-why"><dt>Why</dt><dd>${esc(w.cause)}</dd></div>
            <div class="fx-row fx-r-fix"><dt>The fix</dt><dd>${esc(w.fix)}</dd></div>
            <div class="fx-row fx-r-where"><dt>Where</dt><dd class="fx-wheres">${where}</dd></div>
          </dl>
          ${details}
        </div>
        ${pic}
      </div>
      <footer class="fx-actions${job.status === "ready" || job.status === "blocked" ? "" : " quiet"}">${actions}</footer>
      <div class="fx-tweak" id="tweak-${esc(job.id)}" hidden>
        <label class="nt-label" for="tweak-text-${esc(job.id)}">What should change?</label>
        <textarea id="tweak-text-${esc(job.id)}" rows="2" maxlength="2000" placeholder="e.g. Keep the old colour, just make it fit on a phone"></textarea>
        <div class="fx-tweak-row"><button type="button" class="primary" data-act="tweak" data-id="${esc(job.id)}">Prepare it again with this</button><button type="button" data-act="tweak-close" data-id="${esc(job.id)}">Cancel</button></div>
      </div>
    </article>`;
  }

  function renderDeck() {
    const s = state;
    if (!s) return;
    const jobs = deckJobs();
    const job = deckJob();
    if (job) pick.id = job.id;
    $("deck-nav").hidden = !jobs.length;
    if (!jobs.length) {
      put("deck-card", `<div class="nt-empty fx-empty"><b>Nothing waits for you.</b><br>${s.dry ? "The Fixer is inert here." : "When a fix is ready it shows here, one at a time, with what's wrong and a before and after picture."}</div>`);
      return;
    }
    const i = jobs.indexOf(job);
    $("deck-count").textContent = `${i + 1} of ${jobs.length}`;
    $("deck-prev").disabled = $("deck-next").disabled = jobs.length < 2;
    put("deck-strip", jobs
      .map((j) => {
        const [, tone] = CHIP[j.status] || ["", "prep"];
        const sev = j.about && j.about.severity === "serious" ? " serious" : "";
        return `<button type="button" role="tab" class="fx-pill ${tone}${sev}${snoozed(j.id) ? " later" : ""}" data-go="${esc(j.id)}" aria-selected="${j.id === job.id}" title="${esc(words(j).title)}">${esc(words(j).title)}</button>`;
      })
      .join(""));
    put("deck-card", fixCard(job));
    if (openDiffs.has(job.id)) loadDiff(job.id);
  }

  function jobLine(job, extra = "") {
    const when = job.finishedAt || job.updated;
    return `<article class="nt-card item">
      <span class="state-word">${esc(STATUS[job.status] || job.status)}</span>
      <h3>${esc(job.target.title)}</h3>
      <span class="meta">${esc(KIND[job.target.kind] || "")} · ${esc(ago(when))}${job.approval ? ` · approved by ${esc(job.approval.by)}` : ""}${job.card?.trivial ? " · trivial" : ""}</span>
      ${job.card?.summary ? `<p class="nt-note">${esc(job.card.summary)}</p>` : ""}
      ${job.error ? `<p class="nt-note warn">${esc(job.error)}</p>` : ""}
      ${job.rollback ? `<p class="nt-note warn">Undone: ${esc(job.rollback.reason)}</p>` : ""}
      ${extra}
    </article>`;
  }

  // A list is only drawn again when it changed, and never while a note is being typed in it
  const drawn = new Map();
  function put(id, html) {
    const box = $(id);
    if (drawn.get(id) === html) return;
    const typing = document.activeElement && box.contains(document.activeElement) && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName);
    if (typing) return;
    drawn.set(id, html);
    box.innerHTML = html;
  }

  function render() {
    const s = state;
    $("inert").hidden = !s.dry;
    $("claude-off").hidden = !s.claude || s.dry;
    $("claude-off").textContent = s.claude ? `Sign Claude Code in to let me prepare fixes. Checks still run and report. ${s.claude}` : "";
    const serious = s.issues.filter((i) => i.severity === "serious").length;
    $("g-check").textContent = s.checking ? "Checking now…" : s.lastCheck ? ago(s.lastCheck.at) : "Not yet";
    const gi = $("g-issues");
    gi.textContent = s.issues.length ? `${s.issues.length}${serious ? ` (${serious} serious)` : ""}` : "None";
    gi.className = serious ? "bad" : s.issues.length ? "warn" : "good";
    $("g-needs").textContent = String(s.needsYou.length);
    $("g-today").textContent = `${s.today.prepared} of ${s.today.cap}`;
    for (const b of [$("check-now"), $("check-now-2")]) {
      b.disabled = s.checking;
      b.textContent = s.checking ? "Checking…" : "Check now";
    }
    const busy = s.working.filter((j) => j.status !== "blocked");
    $("g-working").hidden = !busy.length;
    $("g-working").textContent = busy.length ? `Working on: ${busy.map((j) => `${j.target.title} (${(STATUS[j.status] || j.status).toLowerCase()})`).join(" · ")}` : "";
    $("c-needs").textContent = s.needsYou.length || "";
    $("c-health").textContent = s.issues.length || "";
    $("c-quests").textContent = s.quests.filter((q) => q.status === "open" || q.status === "working").length || "";
    $("c-suggested").textContent = s.suggestions.length || "";

    // Needs you: one fix at a time
    renderDeck();

    // Health
    $("health-summary").textContent = s.lastCheck
      ? `Last full check ${ago(s.lastCheck.at)} (${clock(s.lastCheck.at)}), took ${Math.round(s.lastCheck.took / 1000)} s. ${s.settings.hourlyChecks ? "Next one at 7 minutes past the hour." : "Hourly checks are off (Settings)."}`
      : `No full check yet. ${s.settings.hourlyChecks ? "The first runs at 7 minutes past the hour, or tap Check now." : "Hourly checks are off (Settings)."}`;
    put("issues", s.issues.length
      ? s.issues
          .map((i) => {
            const job = i.jobId ? [...s.needsYou, ...s.working, ...s.done].find((j) => j.id === i.jobId) : null;
            const open = job && !["failed", "rejected", "done", "rolled-back", "undone", "closed"].includes(job.status);
            return `<article class="nt-card item">
              <div class="chips-row"><span class="nt-chip ${i.severity === "serious" ? "bad" : "warn"}">${i.severity === "serious" ? "Serious" : "Small"}</span><span class="nt-chip">${esc(i.area)}</span></div>
              <h3>${esc(i.title)}</h3>
              <span class="meta">First seen ${esc(ago(i.firstSeen))} · seen ${i.seenCount} time${i.seenCount === 1 ? "" : "s"}</span>
              ${i.detail ? `<details><summary>Details</summary><pre>${esc(i.detail)}</pre></details>` : ""}
              <div class="row-btns">${open ? `<span class="state-word">${esc(STATUS[job.status] || job.status)}</span>` : s.dry ? "" : i.area === "server" ? `<span class="meta">The server itself: a code change can't fix this one</span>` : `<button type="button" data-act="prepare-issue" data-id="${esc(i.id)}">Prepare a fix</button>`}</div>
            </article>`;
          })
          .join("")
      : `<div class="nt-empty"><b>All clear.</b><br>No problems found${s.lastCheck ? ` at the last check (${esc(ago(s.lastCheck.at))})` : " yet"}.</div>`);

    // The looks check: when, how many screens, and a picture of each one that looked wrong
    const L = s.looks;
    const lb = $("looks-now");
    lb.disabled = s.checking;
    lb.textContent = s.checking ? "Checking…" : "Check looks now";
    if (L) {
      const bad = L.results.filter((r) => r.problems.length);
      $("looks-summary").textContent = L.error
        ? `The last looks check couldn't run (${ago(L.at)}): ${L.error}`
        : `${L.screens} screens checked ${ago(L.at)} (${clock(L.at)}), took ${Math.round(L.took / 60000) || "under a"} min. ${bad.length ? `${bad.length} didn't look right: they're below, and in the problems above.` : "Everything looked right."} ${s.settings.looksChecks ? "It runs after each hourly check and after each update." : "Looks checks are off (Settings)."}`;
      put("looks", bad.length
        ? bad
            .slice(0, 60)
            .map((r) => {
              const where = `${r.name} · ${r.width}×${r.height} · ${r.signedIn ? "signed in" : "signed out"}`;
              const img = r.shot ? `<img src="${esc(`/fixer-api/shots/looks/${encodeURIComponent(r.shot)}`)}" alt="${esc(where)}" loading="lazy" data-zoom="${esc(where)}">` : `<div class="none">No picture</div>`;
              return `<figure class="look ${r.problems.some((p) => p.severity === "serious") ? "bad" : "warn"}">${img}<figcaption><b>${esc(where)}</b>${r.problems.map((p) => `<span>${esc(p.text)}</span>`).join("")}</figcaption></figure>`;
            })
            .join("")
        : `<div class="nt-empty"><b>Everything looked right.</b></div>`);
    } else put("looks", `<div class="nt-empty">Not run yet: tap <b>Check looks now</b>, or wait for the hourly check.</div>`);

    // The scripted checks, in groups: what failed first, then what passed
    const c = s.checks;
    if (c) {
      const failed = c.results.filter((r) => !r.ok).length;
      $("checks-summary").textContent = `${c.results.length - failed} of ${c.results.length} passed, ${ago(c.at)} (${clock(c.at)}), took ${Math.round(c.took / 1000)} s.${failed ? ` ${failed} failed: they're in the problems above.` : ""}`;
      const groups = [];
      for (const r of c.results) {
        if (onlyFails && r.ok) continue;
        let g = groups.find((x) => x.name === r.group);
        if (!g) groups.push((g = { name: r.group, rows: [] }));
        g.rows.push(r);
      }
      put("checks", groups.length
        ? groups
            .map((g) => {
              const bad = g.rows.filter((r) => !r.ok).length;
              return `<section class="check-group"><h3>${esc(g.name)} <span class="nt-chip ${bad ? "bad" : "ok"}">${bad ? `${bad} failed` : "all passed"}</span></h3><ul>${g.rows
                .sort((a, b) => Number(a.ok) - Number(b.ok))
                .map((r) => `<li class="${r.ok ? "pass" : r.severity === "serious" ? "fail" : "warn"}"><span class="mark" aria-label="${r.ok ? "Passed" : "Failed"}">${r.ok ? "✓" : "✗"}</span><b>${esc(r.name)}</b><span class="why">${esc(r.detail)}</span></li>`)
                .join("")}</ul></section>`;
            })
            .join("")
        : `<div class="nt-empty"><b>Nothing failed.</b></div>`);
    } else put("checks", `<div class="nt-empty">Not run yet: tap <b>Run the quick checks</b>, or wait for the hourly check.</div>`);

    // Fixer quests
    put("quests", s.quests.length
      ? s.quests
          .map((q) => {
            const job = q.jobId ? [...s.needsYou, ...s.working, ...s.done].find((j) => j.id === q.jobId) : null;
            const busyJob = job && !["failed", "rejected", "done", "rolled-back", "undone", "closed"].includes(job.status);
            return `<article class="nt-card item">
              <div class="chips-row"><span class="nt-chip">${esc(KIND[q.kind])}</span><span class="nt-chip ${q.priority === "critical" || q.priority === "high" ? "warn" : ""}">${esc(q.priority)}</span><span class="nt-chip ${q.status === "done" ? "ok" : ""}">${esc(q.status === "working" ? "being worked on" : q.status)}</span></div>
              <h3>${esc(q.title)}</h3>
              ${q.details ? `<p class="nt-note">${esc(q.details)}</p>` : ""}
              <span class="meta">${q.from ? "Adopted from Quests" : `Added by ${esc(q.by || "an admin")}`} · ${esc(ago(q.created))}${busyJob ? ` · ${esc(STATUS[job.status] || job.status)}` : ""}</span>
              <div class="row-btns">
                ${!busyJob && q.status !== "done" && !s.dry ? `<button type="button" class="primary" data-act="prepare-quest" data-id="${esc(q.id)}">Prepare a fix</button>` : ""}
                ${q.status !== "done" ? `<button type="button" data-act="quest-done" data-id="${esc(q.id)}">Mark done</button>` : `<button type="button" data-act="quest-open" data-id="${esc(q.id)}">Open again</button>`}
                <button type="button" class="danger" data-act="quest-remove" data-id="${esc(q.id)}">Remove</button>
              </div>
            </article>`;
          })
          .join("")
      : `<div class="nt-empty"><b>No fixer quests yet.</b><br>Add one above: a bug, a glitch or a change to Nova Agent.</div>`);

    // Suggested
    put("suggested", s.suggestions.length
      ? s.suggestions
          .map((q) => `<article class="nt-card item">
              <div class="chips-row"><span class="nt-chip">${esc(KIND[q.kind])}</span>${q.from ? `<span class="nt-chip">${esc(q.from)}</span>` : ""}</div>
              <h3>${esc(q.title)}</h3>
              ${q.details ? `<p class="nt-note">${esc(q.details.slice(0, 400))}</p>` : ""}
              <div class="row-btns"><button type="button" class="primary" data-act="adopt" data-id="${esc(q.questId)}">Adopt as a fixer quest</button><button type="button" data-act="dismiss" data-id="${esc(q.questId)}">Not Nova Agent work</button></div>
            </article>`)
          .join("")
      : `<div class="nt-empty"><b>No suggestions.</b><br>Quests that mention Nova Agent's panels, bugs or glitches show up here.</div>`);

    // Done
    put("done", s.done.length
      ? s.done.map((j) => jobLine(j, j.status === "done" ? `<div class="row-btns"><button type="button" class="danger" data-act="undo" data-id="${esc(j.id)}">Undo</button></div>` : "")).join("")
      : `<div class="nt-empty">Nothing yet.</div>`);

    // Activity
    put("activity", s.activity.length
      ? s.activity.map((a) => `<li class="${esc(a.kind)}"><time datetime="${esc(a.at)}">${esc(clock(a.at))}</time><span>${esc(a.text)}</span></li>`).join("")
      : `<li><span></span><span class="nt-note">Nothing yet.</span></li>`);

    // Settings (not while one is being typed in)
    if (!document.activeElement || !document.activeElement.closest(".settings")) {
      $("s-hourly").checked = s.settings.hourlyChecks;
      $("s-auto").checked = s.settings.autoPrepare;
      $("s-looks").checked = s.settings.looksChecks !== false;
      $("s-cap").value = s.settings.dailyCap;
      $("s-limit").value = s.settings.timeLimitMinutes;
    }
  }

  async function loadDiff(id) {
    const box = document.getElementById(`diff-${id}`);
    if (!box || box.dataset.loaded) return;
    box.dataset.loaded = "1";
    try {
      const job = await getJson(`/fixer-api/jobs/${encodeURIComponent(id)}`);
      box.innerHTML = diffHtml(job.card?.diff || "No changes.");
    } catch (err) {
      box.textContent = err.message;
      delete box.dataset.loaded;
    }
  }

  // ---- Taps ----
  const armed = new Map();
  // Reject, Remove and Undo: pressed twice, so a stray tap doesn't
  function twice(btn, label) {
    const key = btn.dataset.act + btn.dataset.id;
    if (armed.get(key) > Date.now()) return true;
    armed.set(key, Date.now() + 4000);
    const was = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected) btn.textContent = was; }, 4000);
    return false;
  }
  function zoomArt() {
    const job = deckJob();
    const sc = job && screensOf(job)[pick.screen];
    if (!sc) return;
    $("zoom-img").hidden = true;
    $("zoom-art").hidden = false;
    $("zoom-art").innerHTML = art(sc, pick.pic, true);
    $("zoom-cap").textContent = `${words(job).title} · ${sc.label} · ${pick.pic === "before" ? "before" : "after"}`;
    $("zoom").showModal();
  }
  function setPic(which) {
    pick.pic = which;
    renderDeck();
  }
  document.addEventListener("click", (e) => {
    const goTo = e.target.closest("[data-go]");
    if (goTo) return go(goTo.dataset.go);
    const scr = e.target.closest("button[data-screen]");
    if (scr) {
      pick.screen = Number(scr.dataset.screen) || 0;
      return renderDeck();
    }
    const pb = e.target.closest("[data-pic]");
    if (pb) return setPic(pb.dataset.pic);
    if (e.target.closest("[data-zoomart]")) return zoomArt();
    const flip = e.target.closest("[data-flip]");
    if (flip) {
      flips.set(flip.dataset.flip, flip.dataset.show);
      const pair = flip.closest(".pair-shot");
      pair.querySelector(".shots").dataset.show = flip.dataset.show;
      for (const b of pair.querySelectorAll("[data-flip]")) b.setAttribute("aria-selected", String(b === flip));
      return;
    }
    const img = e.target.closest("img[data-zoom]");
    if (img) {
      $("zoom-img").hidden = false;
      $("zoom-art").hidden = true;
      $("zoom-img").src = img.src;
      $("zoom-img").alt = img.alt;
      $("zoom-cap").textContent = img.dataset.zoom;
      $("zoom").showModal();
      return;
    }
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const id = b.dataset.id;
    const job = (path) => `/actions/fixer/jobs/${encodeURIComponent(id)}`;
    switch (b.dataset.act) {
      case "approve":
        b.disabled = true;
        b.textContent = "Going live…";
        return act(job(), { action: "approve" }, "✓ Approved: it's going live now. This card follows along.");
      case "reject":
        if (!twice(b, "Tap again to reject")) return;
        return act(job(), { action: "reject" }, "✕ Rejected: the prepared change was thrown away.");
      case "later":
        later[id] = Date.now() + 3 * 3600_000;
        try { localStorage.setItem("fixer-later", JSON.stringify(later)); } catch (err) {}
        say("Later: moved to the back for 3 hours.");
        step(1);
        return renderDeck();
      case "tweak-close": {
        const box = $(`tweak-${id}`);
        if (box) box.hidden = true;
        return;
      }
      case "tweak-open": {
        const box = $(`tweak-${id}`);
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector("textarea").focus();
        return;
      }
      case "tweak": {
        const note = $(`tweak-text-${id}`).value.trim();
        if (!note) return say("Say what should change first.", true);
        return act(job(), { action: "tweak", note }, "✎ Asked for a tweak: it's being prepared again.");
      }
      case "undo":
        if (!twice(b, "Tap again to undo it")) return;
        return act(job(), { action: "undo" }, "Undoing it now.");
      case "prepare-issue":
        return act(`/actions/fixer/issues/${encodeURIComponent(id)}`, { action: "prepare" }, "A fix is being prepared. It will wait for your approval.");
      case "prepare-quest":
        return act(`/actions/fixer/quests/${encodeURIComponent(id)}`, { action: "prepare" }, "A fix is being prepared. It will wait for your approval.");
      case "quest-done":
        return act(`/actions/fixer/quests/${encodeURIComponent(id)}`, { action: "update", status: "done" });
      case "quest-open":
        return act(`/actions/fixer/quests/${encodeURIComponent(id)}`, { action: "update", status: "open" });
      case "quest-remove":
        if (!twice(b, "Tap again to remove")) return;
        return act(`/actions/fixer/quests/${encodeURIComponent(id)}`, { action: "remove" });
      case "adopt":
        return act(`/actions/fixer/suggestions/${encodeURIComponent(id)}`, { action: "adopt" }, "Adopted: it's in Fixer quests now.");
      case "dismiss":
        return act(`/actions/fixer/suggestions/${encodeURIComponent(id)}`, { action: "dismiss" });
    }
  });
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.matches || !d.matches("details[data-diff]")) return;
    if (d.open) {
      openDiffs.add(d.dataset.diff);
      loadDiff(d.dataset.diff);
    } else openDiffs.delete(d.dataset.diff);
  }, true);
  $("zoom-close").addEventListener("click", () => $("zoom").close());
  $("deck-prev").addEventListener("click", () => step(-1));
  $("deck-next").addEventListener("click", () => step(1));
  // On a computer: ← → between fixes, A to approve and R to reject (each pressed twice, so a stray key
  // doesn't), B / F for the before / after picture, Enter on the picture to see it big
  const keyArm = new Map();
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
    if ($("zoom").open) return;
    if (!WIDE.matches && tab !== "needs") return;
    const job = deckJob();
    if (!job) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft") return e.preventDefault(), step(-1);
    if (e.key === "ArrowRight") return e.preventDefault(), step(1);
    if (k === "b") return setPic("before");
    if (k === "f") return setPic("after");
    if ((k === "enter" || k === " ") && e.target.closest && e.target.closest("[data-zoomart]")) return e.preventDefault(), zoomArt();
    if ((k === "a" || k === "r") && (job.status === "ready" || job.status === "blocked")) {
      e.preventDefault();
      const key = k + job.id;
      if ((keyArm.get(key) || 0) < Date.now()) {
        keyArm.set(key, Date.now() + 4000);
        return say(k === "a" ? "Press A again to approve it (it goes live)." : "Press R again to reject it.");
      }
      keyArm.delete(key);
      const btn = document.querySelector(`.fx-card [data-act="${k === "a" ? "approve" : "reject"}"]`);
      if (k === "r") armed.set("reject" + job.id, Date.now() + 4000); // (the button's own tap-twice: already confirmed)
      if (btn) btn.click();
    }
  });
  $("zoom").addEventListener("click", (e) => { if (e.target === $("zoom")) $("zoom").close(); });

  const checkNow = () => act("/actions/fixer/check", {}, "Checking now: tests, typecheck, every panel and health. It takes a few minutes.");
  $("check-now").addEventListener("click", checkNow);
  $("check-now-2").addEventListener("click", checkNow);
  $("audio-now").addEventListener("click", () => act("/actions/fixer/check", { audio: true }, "Measuring the sound levels (a few minutes)."));
  $("looks-now").addEventListener("click", () => act("/actions/fixer/check", { looks: true }, "Checking how everything looks, on every size, signed in and out (about ten minutes)."));
  $("checks-now").addEventListener("click", () => act("/actions/fixer/check", { checks: true }, "Running the quick checks (about a minute)."));
  $("checks-fails").addEventListener("click", () => {
    onlyFails = !onlyFails;
    $("checks-fails").setAttribute("aria-pressed", String(onlyFails));
    $("checks-fails").textContent = onlyFails ? "Show every check" : "Only show what failed";
    if (state) render();
  });

  $("quest-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = { title: $("q-title").value.trim(), details: $("q-details").value.trim(), kind: $("q-kind").value, priority: $("q-priority").value, start: $("q-start").checked };
    if (!body.title) return;
    try {
      await post("/actions/fixer/quests", body);
      $("q-title").value = "";
      $("q-details").value = "";
      say(body.start && !state?.dry ? "Added, and a fix is being prepared. It will wait for your approval." : "Added.");
      await load();
    } catch (err) {
      say(err.message, true);
    }
  });

  const saveSettings = () =>
    act("/actions/fixer/settings", { hourlyChecks: $("s-hourly").checked, autoPrepare: $("s-auto").checked, looksChecks: $("s-looks").checked, dailyCap: Number($("s-cap").value), timeLimitMinutes: Number($("s-limit").value) }, "Saved.");
  for (const id of ["s-hourly", "s-auto", "s-looks", "s-cap", "s-limit"]) $(id).addEventListener("change", saveSettings);

  // ---- Keeping up to date ----
  function blocked(err) {
    const why = err.status === 403 ? "The Fixer is for admins." : err.status === 401 ? "Sign in with Portal first (as an admin)." : err.body?.pcOffline ? "The studio computer is off or offline: the Fixer runs there." : err.message;
    for (const id of ["deck-card", "issues", "quests", "suggested", "done"]) {
      drawn.delete(id);
      $(id).innerHTML = `<div class="nt-empty"><b>${esc(why)}</b></div>`;
    }
    $("deck-nav").hidden = true;
  }
  let timer = null;
  async function load() {
    clearTimeout(timer);
    try {
      state = await getJson("/fixer-api/state");
      render();
    } catch (err) {
      blocked(err);
    }
    const busy = state && (state.checking || state.working.some((j) => j.status !== "blocked"));
    if (document.visibilityState === "visible") timer = setTimeout(load, busy ? 4000 : 15000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
  showTab(tab);
  load();
})();
