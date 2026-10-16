// The Fixer's page (16 Oct 2026, from the ground up): the three strict rules, whether each is kept,
// and every problem the last check found, with the places and sizes it was seen at and a picture.
// It talks to Nova Agent's server (/fixer-api/state, /actions/fixer/check); online, Nova Bot passes
// those on (admins only).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let state = null;
  let rule = "all";
  let kind = "all";
  try { kind = sessionStorage.getItem("fixer-kind") || "all"; } catch (e) {}

  const london = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };

  async function getJson(path, init) {
    const res = await fetch(path, { headers: { Accept: "application/json", "Content-Type": "application/json" }, cache: "no-store", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(body.message || body.error || `The Fixer answered ${res.status}`);
    return body;
  }

  function drawRules() {
    $("rules").innerHTML = state.rules.map((r) => {
      const kept = state.last && !r.problems;
      const on = rule === r.id;
      return `<button type="button" class="rule ${!state.last ? "" : kept ? "kept" : "broken"}" data-rule="${r.id}" aria-pressed="${on}">
        <span class="rule-mark" aria-hidden="true">${!state.last ? "…" : kept ? "✓" : "✕"}</span>
        <span class="rule-words"><b>${esc(r.title)}</b><small>${!state.last ? "Not checked yet" : kept ? "Kept everywhere" : `${r.problems} problem${r.problems === 1 ? "" : "s"}`}</small></span>
      </button>`;
    }).join("");
  }

  // Auto-fix (/shared/rules.js): every screen of Nova Agent fixes what breaks the three rules as it
  // draws, with nothing to approve. On for everyone; turned off here on this device only (to see
  // what it fixes), and back on the same way.
  const autoOn = () => {
    try { return localStorage.getItem("nova-rules") !== "off"; } catch (e) { return true; }
  };
  function drawAuto() {
    const on = autoOn();
    $("auto").setAttribute("aria-pressed", String(on));
    $("auto").textContent = on ? "Auto-fix: On" : "Auto-fix: Off";
    $("auto").title = on ? "Every screen fixes what breaks the three rules as it draws. Tap to turn it off on this device." : "Off on this device only. Tap to turn it back on.";
  }

  function drawWhen() {
    const s = state;
    let text = s.last ? `Last check ${esc(london(s.last.at))} (${esc(ago(s.last.at))}) · ${s.last.screens} screens${s.fixed ? ` · ${s.fixed} fixed on their own` : ""}` : "Not checked yet";
    if (s.running) text = `Checking now${s.runningSince ? ` (started ${esc(ago(s.runningSince))})` : ""}…`;
    else if (s.error) text = `The last check couldn't run: ${esc(s.error)}`;
    $("when").innerHTML = text;
    $("check").disabled = !!s.running;
    $("check").textContent = s.running ? "Checking…" : "Check now";
  }

  function drawList() {
    const problems = state.problems
      .filter((p) => rule === "all" || p.rule === rule)
      .map((p) => ({ ...p, at: p.at.filter((a) => kind === "all" || a.kind === kind) }))
      .filter((p) => p.at.length);
    if (!state.last) return void ($("list").innerHTML = `<p class="nt-empty">The first check hasn't finished yet. It runs every ${state.every} minutes.</p>`);
    if (!problems.length) return void ($("list").innerHTML = `<p class="nt-empty"><b>Nothing to fix here.</b> ${rule === "all" ? "All three rules are kept" : "This rule is kept"}${kind === "all" ? "" : ` on ${kind}s`}.</p>`);
    const RULE = Object.fromEntries(state.rules.map((r) => [r.id, r.title]));
    const byPlace = new Map();
    for (const p of problems) byPlace.set(p.place, [...(byPlace.get(p.place) || []), p]);
    $("list").innerHTML = [...byPlace].map(([place, list]) => `
      <section class="place">
        <h2>${esc(place)} <span class="n">${list.length}</span></h2>
        ${list.map((p) => `
          <article class="problem" data-rule="${p.rule}">
            <p class="what"><span class="tag ${p.rule}">${esc(RULE[p.rule])}</span> ${esc(p.what)}</p>
            <p class="why">${esc(p.why.charAt(0).toUpperCase() + p.why.slice(1))}.</p>
            <div class="sizes">${p.at.map((a) => a.shot && state.last ? `<button type="button" class="size" data-shot="${esc(a.shot)}" data-title="${esc(`${place} · ${a.size}`)}">${esc(a.size)}</button>` : `<span class="size">${esc(a.size)}</span>`).join("")}</div>
          </article>`).join("")}
      </section>`).join("");
  }

  function draw() {
    if (!state) return;
    drawRules();
    drawWhen();
    drawList();
    for (const b of document.querySelectorAll("#f-kind [data-kind]")) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
  }

  async function load() {
    try {
      state = await getJson("/fixer-api/state");
      draw();
    } catch (err) {
      $("list").innerHTML = `<p class="nt-empty">${esc(err.message)}</p>`;
    }
  }

  $("rules").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rule]");
    if (!b) return;
    rule = rule === b.dataset.rule ? "all" : b.dataset.rule;
    draw();
  });
  $("f-kind").addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    kind = b.dataset.kind;
    try { sessionStorage.setItem("fixer-kind", kind); } catch (err) {}
    draw();
  });
  $("check").addEventListener("click", async () => {
    $("check").disabled = true;
    try {
      await getJson("/actions/fixer/check", { method: "POST", body: "{}" });
    } catch (err) {
      $("when").textContent = err.message;
    }
    load();
  });
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-shot]");
    if (!b || !state.last) return;
    $("shot-title").textContent = b.dataset.title;
    $("shot-img").src = `/fixer-api/shots/${encodeURIComponent(state.last.id)}/${encodeURIComponent(b.dataset.shot)}`;
    $("shot-img").alt = `${b.dataset.title}, its problems marked in red`;
    $("shot").showModal();
  });
  $("auto").addEventListener("click", () => {
    const on = !autoOn();
    // (this page and Nova Agent's own, straight away; every other screen as it opens)
    for (const w of [window, window.parent]) {
      try { if (w.NovaRules) w.NovaRules.set(on); } catch (e) { /* (not Nova Agent's page) */ }
    }
    try { if (on) localStorage.removeItem("nova-rules"); else localStorage.setItem("nova-rules", "off"); } catch (e) { /* (storage blocked) */ }
    drawAuto();
  });
  drawAuto();
  $("shot-close").addEventListener("click", () => $("shot").close());
  $("shot").addEventListener("click", (e) => { if (e.target === $("shot")) $("shot").close(); });

  load();
  // (quicker while a check is running)
  const tick = () => setTimeout(() => load().finally(tick), state && state.running ? 5000 : 30000);
  tick();
})();
