// Nova Phone: the Fixer, which checks every screen of Nova Agent against its four rules every 30 minutes (on the
// server; Check now starts one). As Nova Desk's Fixer page (web/fixer/app.js): the four rules, kept or not (a tap
// on one shows only its problems), when it last checked and what it found, by place, with the sizes each was seen
// at (a tap shows that screen's picture with its problems marked), the device filter, and Auto-fix for this
// device. GET /fixer-api/state, POST /actions/fixer/check, GET /fixer-api/shots/<check>/<picture>. Admins only.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, empty, post, toast, form } = N;
  let rule = "all";
  let kind = "all";
  try { kind = sessionStorage.getItem("fixer-kind") || "all"; } catch (e) {}
  const KINDS = [["all", "All"], ["phone", "Phones"], ["tablet", "Tablets"], ["computer", "Computers"]];

  const london = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
  const ago = (iso) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return !Number.isFinite(m) ? "" : m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  // (the server says how often in minutes: 30)
  const often = (s) => `${Number(s.every) || 30} minutes`;

  async function get(path) {
    let res;
    try { res = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }); }
    catch (e) { throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true }); }
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (res.status === 403) throw Object.assign(new Error((body && (body.message || body.error)) || "The Fixer is for admins."), { admins: true });
    if (!res.ok || !body || body.ok === false) throw Object.assign(new Error((body && (body.message || body.error)) || `The Fixer answered ${res.status}`), { status: res.status, data: body });
    return body;
  }

  // ---- Refreshed every 30 s, every 5 s while a check runs; only while it's on screen and the phone is awake ----
  let timer = 0, token = 0, again = null;
  const stop = () => { token++; clearTimeout(timer); timer = 0; again = null; };
  addEventListener("hashchange", () => { if (!/^#fixer(\/|$)/.test(location.hash)) stop(); });
  document.addEventListener("visibilitychange", () => {
    if (!again) return;
    if (document.hidden) { clearTimeout(timer); timer = 0; } else if (!timer) again();
  });

  // Auto-fix (Nova Desk's /shared/rules.js): every Nova Desk screen fixes what breaks the rules as it draws. On for
  // everyone; turned off on this device only (to see what it fixes), and back on the same way.
  const autoOn = () => { try { return localStorage.getItem("nova-rules") !== "off"; } catch (e) { return true; } };
  function setAuto(on) {
    try { if (window.NovaRules) window.NovaRules.set(on); } catch (e) {}
    try { if (on) localStorage.removeItem("nova-rules"); else localStorage.setItem("nova-rules", "off"); } catch (e) {}
  }

  // Fixer off (24 Oct 2026, the user: "you can turn the fixer off it's irrelevant at the moment and not very usable
  // … in fact just disable it entirely in all aspects for now it's a waste of time"): #fixer says it's off, with
  // Home, and keeps Auto-fix's switch (that's every screen's own tidying, not the Fixer's checks). Nothing is
  // fetched or checked. With FIXER_ON=1 on the server again, this goes back to true (and Backend, More and
  // Console get their Fixer back: the places marked "Fixer off (24 Oct 2026)").
  const FIXER_ON = false;
  function drawOff(box) {
    box.innerHTML = `${empty({ icon: "check", title: "The Fixer is switched off for now", text: "It doesn't check any screens, take pictures or sign in while it's off." })}
      <a class="btn main wide" href="#today">${icon("today")} Home</a>
      <label class="switch"><span>Auto-fix on this device<small class="fx-auto-words" data-auto-words></small></span><input type="checkbox" role="switch" data-auto${autoOn() ? " checked" : ""}></label>`;
    const words = () => (box.querySelector("[data-auto-words]").textContent = autoOn() ? "On: every Nova Desk screen in this browser tidies what would be cut off or wrap as it draws." : "Off on this device only. Nova Desk screens open here show things as they are.");
    words();
    box.querySelector("[data-auto]").addEventListener("change", (e) => { setAuto(e.target.checked); toast(e.target.checked ? "Auto-fix is on on this device" : "Auto-fix is off on this device"); words(); });
  }

  N.section({
    id: "fixer", name: "Fixer", tile: "fixer",
    async draw(box) {
      await N.css("fixer.css");
      stop();
      if (!FIXER_ON) return drawOff(box);
      let s;
      try { s = await get("/fixer-api/state"); } catch (err) {
        if (err.signIn) throw err;
        if (err.admins) return void (box.innerHTML = empty({ icon: "user", title: "The Fixer is for admins", text: "Sign in as an admin to see it." }));
        if (err.offline) throw err;
        if (err.status === 502 || err.status === 503 || err.data?.pcOffline) return void (box.innerHTML = `<div class="empty">${icon("globe")}<b>Nova Agent isn't answering just now</b><span>${esc(err.message)}. The Fixer runs with Nova Agent: try again in a moment.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`);
        throw err;
      }
      box.innerHTML = `<p class="muted small fx-sub" data-sub></p>
        <div class="fx-rules" data-rules role="group" aria-label="The four rules: tap one to see only its problems"></div>
        <p class="fx-when" data-when role="status"></p>
        <button type="button" class="btn main wide" data-check></button>
        <label class="switch"><span>Auto-fix on this device<small class="fx-auto-words" data-auto-words></small></span><input type="checkbox" role="switch" data-auto${autoOn() ? " checked" : ""}></label>
        <div class="seg fx-kinds" role="group" aria-label="Show problems seen on">${KINDS.map(([k, l]) => `<button type="button" class="seg-a" data-kind="${k}" aria-selected="${k === kind}">${l}</button>`).join("")}</div>
        <div data-list aria-live="polite"></div>`;
      const paint = () => {
        const sub = `Checks all of Nova Agent every ${often(s)} against four rules.`;
        box.querySelector("[data-sub]").textContent = sub;
        // the rules: ✓ kept, ✕ broken, … not checked yet; a tap shows only that rule's problems (again: all)
        box.querySelector("[data-rules]").innerHTML = (s.rules || []).map((r) => {
          const kept = s.last && !r.problems;
          return `<button type="button" class="fx-rule ${!s.last ? "" : kept ? "kept" : "broken"}" data-rule="${esc(r.id)}" aria-pressed="${rule === r.id}">
            <span class="fx-mark" aria-hidden="true">${!s.last ? "…" : kept ? "✓" : "✕"}</span>
            <span class="fx-words"><b>${esc(r.title)}</b><small>${!s.last ? "Not checked yet" : kept ? "Kept everywhere" : `${r.problems} problem${r.problems === 1 ? "" : "s"}`}</small>${rule === r.id && r.text ? `<span class="fx-text">${esc(r.text)}</span>` : ""}</span></button>`;
        }).join("");
        let when = s.last ? `Last check ${london(s.last.at)} (${ago(s.last.at)}) · ${s.last.screens} screens${s.fixed ? ` · ${s.fixed} fixed on their own` : ""}` : "Not checked yet";
        if (s.running) when = `Checking now${s.runningSince ? ` (started ${ago(s.runningSince)})` : ""}…`;
        else if (s.error) when = `The last check couldn't run: ${s.error}`;
        const w = box.querySelector("[data-when]");
        w.textContent = when;
        w.classList.toggle("bad", !s.running && !!s.error);
        const check = box.querySelector("[data-check]");
        check.disabled = !!s.running;
        check.innerHTML = `${icon("refresh")} ${s.running ? "Checking…" : "Check now"}`;
        box.querySelector("[data-auto-words]").textContent = autoOn() ? "On: every Nova Desk screen in this browser fixes what breaks the rules as it draws." : "Off on this device only, to see what it fixes. Nova Desk screens open here show the problems as they are.";
        for (const b of box.querySelectorAll("[data-kind]")) b.setAttribute("aria-selected", String(b.dataset.kind === kind));
        drawList(box.querySelector("[data-list]"), s);
      };
      paint();
      box.addEventListener("click", async (e) => {
        const r = e.target.closest("[data-rule]");
        if (r) { rule = rule === r.dataset.rule ? "all" : r.dataset.rule; return paint(); }
        const k = e.target.closest("[data-kind]");
        if (k) { kind = k.dataset.kind; try { sessionStorage.setItem("fixer-kind", kind); } catch (err) {} return paint(); }
        const shot = e.target.closest("[data-shot]");
        if (shot && s.last) return showShot(s.last.id, shot.dataset.shot, shot.dataset.title);
        const c = e.target.closest("[data-check]");
        if (c) {
          c.disabled = true;
          c.textContent = "Starting…";
          try { const out = await post("/actions/fixer/check", {}, { "X-Nova-Visualizer": "1" }); toast(out?.result?.running ? "A check is running already" : "Checking: it takes a few minutes"); }
          catch (err) { toast(err.message, true); }
          try { s = await get("/fixer-api/state"); } catch (err) {}
          paint();
          schedule();
        }
      });
      box.querySelector("[data-auto]").addEventListener("change", (e) => { setAuto(e.target.checked); toast(e.target.checked ? "Auto-fix is on on this device" : "Auto-fix is off on this device"); paint(); });
      const t = token;
      const schedule = () => { clearTimeout(timer); timer = document.hidden ? 0 : setTimeout(again, s.running ? 5000 : 30000); };
      again = async () => {
        timer = 0;
        if (t !== token) return;
        if (!box.isConnected) return stop();
        try {
          const next = await get("/fixer-api/state");
          if (JSON.stringify(next) !== JSON.stringify(s)) { s = next; paint(); }
        } catch (err) { /* (the last state stays; tried again) */ }
        if (t === token) schedule();
      };
      schedule();
    },
  });

  // Every problem the last check found (with the filters), by place, each with the sizes it was seen at
  function drawList(el, s) {
    const problems = (s.problems || [])
      .filter((p) => rule === "all" || p.rule === rule)
      .map((p) => ({ ...p, at: (p.at || []).filter((a) => kind === "all" || a.kind === kind) }))
      .filter((p) => p.at.length);
    let html;
    if (!s.last) html = empty({ icon: "clock", title: "The first check hasn't finished yet", text: `It runs every ${often(s)}.` });
    else if (!problems.length) html = empty({ icon: "check", title: "Nothing to fix here", text: `${rule === "all" ? "All four rules are kept" : "This rule is kept"}${kind === "all" ? "" : ` on ${kind}s`}.` });
    else {
      const RULE = Object.fromEntries((s.rules || []).map((r) => [r.id, r.title]));
      const byPlace = new Map();
      for (const p of problems) byPlace.set(p.place, [...(byPlace.get(p.place) || []), p]);
      html = `<p class="muted small fx-count">${problems.length} problem${problems.length === 1 ? "" : "s"} in ${byPlace.size} place${byPlace.size === 1 ? "" : "s"}. Tap a size to see that screen, its problems marked in red.</p>` + [...byPlace].map(([place, ps]) => `
        <section class="fx-place"><h3 class="h">${esc(place)} <span class="pill">${ps.length}</span></h3>
          ${ps.map((p) => `<article class="card fx-problem">
            <p class="fx-what"><span class="fx-tag ${esc(p.rule)}">${esc(RULE[p.rule] || p.rule)}</span> ${esc(p.what)}</p>
            <p class="fx-why">${esc(p.why.charAt(0).toUpperCase() + p.why.slice(1))}.</p>
            <div class="chips fx-sizes">${p.at.map((a) => (a.shot ? `<button type="button" class="chip" data-shot="${esc(a.shot)}" data-title="${esc(`${place} · ${a.size}`)}">${esc(a.size)}</button>` : `<span class="chip fx-noshot">${esc(a.size)}</span>`)).join("")}</div>
          </article>`).join("")}
        </section>`).join("");
    }
    const errs = (s.last && s.last.errors) || [];
    if (errs.length) html += `<details class="card fx-errs"><summary>${errs.length} screen${errs.length === 1 ? "" : "s"} couldn't be checked</summary><ul class="fx-err-list">${errs.map((x) => `<li><b>${esc(x.place)} · ${esc(x.size)}</b><span>${esc(x.error)}</span></li>`).join("")}</ul></details>`;
    if (el.dataset.was !== html) {
      const open = el.querySelector(".fx-errs[open]");
      el.dataset.was = html;
      el.innerHTML = html;
      if (open) el.querySelector(".fx-errs")?.setAttribute("open", "");
    }
  }

  // A screen's picture, its problems marked in red (kept for the latest check)
  function showShot(id, shot, title) {
    form(`<h2 class="sheet-title">${esc(title)}</h2><figure class="fx-shot"><img alt="${esc(`${title}, its problems marked in red`)}" data-src="/fixer-api/shots/${encodeURIComponent(id)}/${encodeURIComponent(shot)}"><figcaption class="muted small" data-wait>Loading the picture…</figcaption></figure><button type="button" class="btn wide quiet" data-close>Close</button>`, (el, done) => {
      const img = el.querySelector("img");
      const cap = el.querySelector("[data-wait]");
      img.addEventListener("load", () => (cap.hidden = true));
      img.addEventListener("error", () => { img.hidden = true; cap.textContent = "The picture isn't there any more: pictures are kept for the latest check only. Check now makes new ones."; });
      img.src = img.dataset.src;
      el.querySelector("[data-close]").addEventListener("click", () => done(null));
    });
  }
})();
