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
  function showTab(name) {
    tab = name;
    try { sessionStorage.setItem("fixer-tab", name); } catch (e) {}
    for (const b of document.querySelectorAll(".fx-tabs [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.id !== `pane-${name}`;
  }
  for (const b of document.querySelectorAll(".fx-tabs [role=tab]")) b.addEventListener("click", () => showTab(b.dataset.tab));

  // ---- Drawing ----
  const shot = (job, file) => `/fixer-api/shots/${encodeURIComponent(job.id)}/${encodeURIComponent(file)}`;

  function compare(job) {
    const pairs = (job.card.screens || []).filter((s) => s.before || s.after);
    if (!pairs.length) return `<div class="block"><h4>Before and after</h4><p class="nt-note">No pictures for this one (it changes how things work rather than how they look).</p></div>`;
    return `<div class="block compare"><h4>Before and after</h4>${pairs
      .map((s) => {
        const key = `${job.id}|${s.path}|${s.width}`;
        const show = flips.get(key) || "after";
        const fig = (which, file) =>
          `<figure class="shot ${which}"><figcaption>${which === "before" ? "Before" : "After"}</figcaption>${file ? `<img src="${esc(shot(job, file))}" alt="${esc(`${s.name} ${which} the change, ${s.width}px wide`)}" loading="lazy" data-zoom="${esc(`${s.name} · ${s.width}px · ${which}`)}">` : `<div class="none">No picture</div>`}</figure>`;
        return `<div class="pair-shot"><span class="nt-label">${esc(s.name)} · ${s.width === 390 ? "phone" : "desktop"} (${s.width}px)</span>
          <div class="flip seg" role="tablist" aria-label="Before or after"><button type="button" role="tab" data-flip="${esc(key)}" data-show="before" aria-selected="${show === "before"}">Before</button><button type="button" role="tab" data-flip="${esc(key)}" data-show="after" aria-selected="${show === "after"}">After</button></div>
          <div class="shots" data-show="${show}">${fig("before", s.before)}${fig("after", s.after)}</div></div>`;
      })
      .join("")}</div>`;
  }

  function diffHtml(text) {
    return String(text || "")
      .split("\n")
      .map((l) => {
        const e = esc(l);
        if (l.startsWith("diff --git")) return `<span class="f">${e}</span>`;
        if (l.startsWith("@@")) return `<span class="h">${e}</span>`;
        if (l.startsWith("+") && !l.startsWith("+++")) return `<span class="a">${e}</span>`;
        if (l.startsWith("-") && !l.startsWith("---")) return `<span class="d">${e}</span>`;
        return e;
      })
      .join("\n");
  }

  function card(job) {
    const c = job.card;
    const rec = c.recommendation || { verdict: "tweak", reasons: [] };
    const failed = (c.checks || []).filter((k) => !k.ok).length;
    const files = c.files || [];
    return `<article class="nt-card approval" data-job="${esc(job.id)}">
      <div class="card-head">
        <span class="nt-kicker">${esc(job.target.type === "quest" ? "Fixer quest" : "Found by the hourly check")}${job.attempt > 1 ? ` · attempt ${job.attempt}` : ""}</span>
        <h3>${esc(job.target.title)}</h3>
        <div class="chips-row">
          <span class="nt-chip">${esc(KIND[job.target.kind] || job.target.kind)}</span>
          ${c.trivial ? `<span class="nt-chip trivial">✓ Trivial — safe to approve</span>` : ""}
          <span class="nt-chip ${c.allPassed ? "ok" : "bad"}">${c.allPassed ? "All checks passed" : `${failed} check${failed === 1 ? "" : "s"} didn't pass`}</span>
          <span class="nt-chip ${rec.verdict === "approve" ? "ok" : rec.verdict === "reject" ? "bad" : "warn"}">Recommended: ${esc(rec.verdict)}</span>
        </div>
      </div>
      <p class="summary">${esc(c.summary)}</p>
      ${c.why ? `<p class="why">Why: ${esc(c.why)}</p>` : ""}
      ${compare(job)}
      ${c.consequences ? `<div class="block"><h4>What this means for you</h4><p>${esc(c.consequences)}</p></div>` : ""}
      <div class="block"><h4>Is it a good idea?</h4>${c.assessment ? `<p>${esc(c.assessment)}</p>` : ""}${(c.risks || []).length ? `<ul>${c.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : `<p class="nt-note">No risks were named.</p>`}</div>
      <div class="block"><h4>Recommendation</h4><span class="verdict ${esc(rec.verdict)}">${esc(rec.verdict === "approve" ? "Approve" : rec.verdict === "reject" ? "Reject" : "Ask for a tweak")}</span>${(rec.reasons || []).length ? `<ul>${rec.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}</div>
      <div class="block"><h4>Checks</h4><ul class="checks">${(c.checks || [])
        .map((k) => `<li class="${k.ok ? "ok" : "no"}"><span><span class="mark">${k.ok ? "✓" : "✕"}</span> ${esc(k.name)}</span>${!k.ok && k.detail ? `<pre>${esc(k.detail)}</pre>` : ""}</li>`)
        .join("")}</ul></div>
      <div class="block"><h4>Files (${files.length})</h4><ul class="files">${files
        .map((f) => `<li>${f.repo === "nb" ? "Nova Bot" : "Nova Agent"} · ${esc(f.path)} <span class="add">+${f.added}</span> <span class="del">−${f.removed}</span></li>`)
        .join("")}</ul>
        <details class="diff-box" data-diff="${esc(job.id)}"${openDiffs.has(job.id) ? " open" : ""}><summary>Show the changes, line by line</summary><pre class="diff" id="diff-${esc(job.id)}"><span class="nt-loading">Loading…</span></pre></details>
      </div>
      <div class="actions">
        <button type="button" class="primary" data-act="approve" data-id="${esc(job.id)}">Approve</button>
        <button type="button" data-act="tweak-open" data-id="${esc(job.id)}">Ask for a tweak</button>
        <button type="button" class="danger" data-act="reject" data-id="${esc(job.id)}">Reject</button>
      </div>
      <div class="tweak-box" id="tweak-${esc(job.id)}" hidden>
        <label class="nt-label" for="tweak-text-${esc(job.id)}">What should change?</label>
        <textarea id="tweak-text-${esc(job.id)}" rows="3" maxlength="2000" placeholder="e.g. Keep the old colour, just make it fit on a phone"></textarea>
        <button type="button" class="primary" data-act="tweak" data-id="${esc(job.id)}">Prepare it again with this</button>
      </div>
    </article>`;
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

    // Needs you
    put("needs-list", s.needsYou.length
      ? s.needsYou.map(card).join("")
      : `<div class="nt-empty"><b>Nothing waits for you.</b><br>${s.dry ? "The Fixer is inert here." : "When a fix is ready, it shows here with its before and after."}</div>`);
    put("working", s.working.length ? `<h2 class="nt-h">In progress</h2>${s.working.map((j) => jobLine(j, j.status === "blocked" ? `<div class="row-btns"><button type="button" class="primary" data-act="approve" data-id="${esc(j.id)}">Try going live again</button><button type="button" data-act="tweak-open" data-id="${esc(j.id)}">Ask for a tweak</button><button type="button" class="danger" data-act="reject" data-id="${esc(j.id)}">Reject</button></div><div class="tweak-box" id="tweak-${esc(j.id)}" hidden><textarea id="tweak-text-${esc(j.id)}" rows="3" maxlength="2000" aria-label="What should change?"></textarea><button type="button" class="primary" data-act="tweak" data-id="${esc(j.id)}">Prepare it again with this</button></div>` : "")).join("")}` : "");
    for (const id of openDiffs) loadDiff(id);

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
  document.addEventListener("click", (e) => {
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
        return act(job(), { action: "approve" }, "Approved: it's going live now. This page follows along.");
      case "reject":
        if (!twice(b, "Tap again to reject")) return;
        return act(job(), { action: "reject" }, "Rejected: the prepared change was thrown away.");
      case "tweak-open": {
        const box = $(`tweak-${id}`);
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector("textarea").focus();
        return;
      }
      case "tweak": {
        const note = $(`tweak-text-${id}`).value.trim();
        if (!note) return say("Say what should change first.", true);
        return act(job(), { action: "tweak", note }, "Asked for a tweak: it's being prepared again.");
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
  $("zoom").addEventListener("click", (e) => { if (e.target === $("zoom")) $("zoom").close(); });

  const checkNow = () => act("/actions/fixer/check", {}, "Checking now: tests, typecheck, every panel and health. It takes a few minutes.");
  $("check-now").addEventListener("click", checkNow);
  $("check-now-2").addEventListener("click", checkNow);
  $("audio-now").addEventListener("click", () => act("/actions/fixer/check", { audio: true }, "Measuring the sound levels (a few minutes)."));
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
    act("/actions/fixer/settings", { hourlyChecks: $("s-hourly").checked, autoPrepare: $("s-auto").checked, dailyCap: Number($("s-cap").value), timeLimitMinutes: Number($("s-limit").value) }, "Saved.");
  for (const id of ["s-hourly", "s-auto", "s-cap", "s-limit"]) $(id).addEventListener("change", saveSettings);

  // ---- Keeping up to date ----
  function blocked(err) {
    const why = err.status === 403 ? "The Fixer is for admins." : err.status === 401 ? "Sign in with Portal first (as an admin)." : err.body?.pcOffline ? "The studio computer is off or offline: the Fixer runs there." : err.message;
    for (const id of ["needs-list", "issues", "quests", "suggested", "done"]) $(id).innerHTML = `<div class="nt-empty"><b>${esc(why)}</b></div>`;
    $("working").innerHTML = "";
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
