// Nova Phone: reminders and notices, always on (a small piece loaded with the page, the rest of Agent loads only
// when it's opened). What Nova Agent says while Nova Phone is open comes as a card at the top of the screen, with
// a calm chime: a quest starting or time to leave (Start, In 15 min), a check-in when one should be done (Done,
// +15 min, Move it; Session done for a repeating one), a mission planned, a quest moved, the morning plan and the
// evening wrap-up. A pulse (a quick repeat on its own timer) is one card that ticks, with its beat count, instead
// of a new one each time. The newest two show; the rest wait behind "N more notices".
//   - One live line to Nova Agent (/quests/events), only while Nova Phone is on screen: closed when it's hidden,
//     opened again on coming back (the page then catches up). When the line is down it tries again, slower each time.
//   - "changed" from the line, or a notice: window event "nova-quests-changed", so whatever shows the plan
//     (Agent → Plan, Missions) fetches it again.
//   - A notification tapped while Nova Phone is open (the service worker's "nova-open"): that place, here.
//     "nova-push": the screen in view is brought up to date.
//   - N.place(address): a Nova Desk address (/invoicer/?invoice=32, /portal/?view=campaigns&campaign=5 …) as the
//     Nova Phone place (#money/invoice/32, #outreach/campaign/5 …), or null for one that isn't a place here.
//   - N.agentSay(text) and the address #agent?say=<text>: Agent opens with the text in its box (never sent by
//     itself). N.takeSay() hands it to Agent once.
//   - N.chime(kind): Nova's calm chime (Web Audio, made on the first tap; off with the sound setting "nova-sfx").
(() => {
  "use strict";
  function start() {
    const N = window.NovaPhone;
    if (!N || N.notices) return;
    const { esc } = N;

    // ---- Nova Desk's addresses, as places in Nova Phone ----
    const DESK = /^\/(portal|invoicer|calendar|notes|quests|board|app|fixer|computer|observatory|console|visualizer|lossless|agent|phone)(\/|$)/;
    function place(address) {
      const s = String(address || "").trim();
      if (!s) return null;
      if (s.startsWith("#")) return s;
      let u;
      try { u = new URL(s, location.origin); } catch (e) { return null; }
      let p = u.pathname;
      if (!DESK.test(p)) return null;
      if (u.origin !== location.origin && !/^https?:$/.test(u.protocol)) return null;
      // (Nova Bot's own addresses, /app/…, are Portal's)
      if (p === "/app" || (p.startsWith("/app/") && !p.startsWith("/app/memory"))) p = `/portal/${p.slice(5).replace(/^\//, "")}`;
      const q = u.searchParams, id = (k) => encodeURIComponent(q.get(k) || "");
      if (p.startsWith("/phone")) return u.hash || "#today";
      // (any Invoicer address, job and all: Money reads Desk's own ?invoice=&do=… form)
      if (p.startsWith("/invoicer")) return `#money/${u.search}`;
      if (p.startsWith("/calendar")) { const d = q.get("day") || q.get("date") || ""; return /^\d{4}-\d\d-\d\d$/.test(d) ? `#calendar/day/${d}` : "#calendar"; }
      if (p.startsWith("/notes")) return q.get("note") ? `#notes/${id("note")}` : "#notes";
      if (p.startsWith("/quests")) return "#quests";
      if (p.startsWith("/board")) return "#board";
      if (p.startsWith("/app/memory")) return "#index";
      for (const k of ["fixer", "computer", "observatory", "console", "visualizer", "lossless"]) if (p.startsWith(`/${k}`)) return `#${k}`;
      if (p.startsWith("/agent")) {
        const open = q.get("open");
        if (open === "pane:missions") return "#agent/plan";
        if (open === "manual") return "#help";
        if (open && open !== "pane:chat") return place(open) || "#agent";
        return "#agent";
      }
      // Portal: its views
      const v = q.get("view") || u.hash.slice(1).split(/[/?&]/)[0] || "";
      if (v === "enquiries" || v === "inbox") return q.get("enquiry") ? `#inbox/enquiry/${id("enquiry")}` : "#inbox";
      if (u.hash === "#nova") return "#inbox/alerts";
      if (v === "conversations" || v === "chats") return q.get("chat") ? `#inbox/chat/${id("chat")}` : "#inbox/chats";
      if (v === "approvals") return q.get("action") ? `#inbox/approvals/${id("action")}` : "#inbox/approvals";
      if (v === "alerts") return "#inbox/alerts";
      if (v === "campaigns") return q.get("campaign") ? `#outreach/campaign/${id("campaign")}` : q.get("outreach") ? `#outreach/one/${id("outreach")}` : "#outreach";
      if (v === "social") return q.get("post") ? `#outreach/social/${id("post")}` : "#outreach/social";
      if (v === "funnel") return "#outreach/funnel";
      if (v === "outreach") return "#outreach";
      if (v === "clients") return q.get("client") ? `#clients/${id("client")}` : "#clients";
      if (v === "money" || v === "invoices") return q.get("invoice") ? `#money/invoice/${id("invoice")}` : "#money";
      if (v === "quests") return "#quests";
      if (v === "missions") return "#agent/plan";
      if (v === "manage" || v === "team" || v === "crew") return "#crew";
      if (v === "google") return "#google";
      if (v === "tests") return "#tests";
      if (v === "profile" || v === "you") return "#you";
      return "#today";
    }

    // ---- A message to start from, in Agent's box (#agent?say=…, N.agentSay) ----
    let pendingSay = "";
    function readSay() {
      const m = location.hash.match(/^#agent\?(?:[^#]*&)?say=([^&]*)/);
      if (!m) return false;
      try { pendingSay = decodeURIComponent(m[1].replace(/\+/g, " ")).slice(0, 4000); } catch (e) { pendingSay = m[1]; }
      history.replaceState(history.state, "", "#agent");
      return true;
    }
    function agentSay(text) {
      pendingSay = String(text || "").slice(0, 4000);
      if (location.hash === "#agent") N.show(); else location.hash = "#agent";
    }
    const takeSay = () => { readSay(); const t = pendingSay; pendingSay = ""; return t; };
    // (a link to #agent?say=… anywhere: the same, without the address ever showing the words)
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#agent?"]');
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey) return;
      const m = a.getAttribute("href").match(/[?&]say=([^&]*)/);
      if (!m) return;
      e.preventDefault();
      try { agentSay(decodeURIComponent(m[1].replace(/\+/g, " "))); } catch (err) { agentSay(m[1]); }
    }, true);
    addEventListener("hashchange", () => { if (readSay()) N.show(); });
    if (readSay()) N.show();

    // ---- The chime: calm, quiet and warm, never quite the same twice (the user: no bright, chatty sounds) ----
    // In D lydian, the key of Nova's music: soft sines that swell in and fade slowly, through a gentle low-pass,
    // the loudest moment well under −24 dB. One or two notes, spaced slowly; a chord blooms rather than runs.
    const D4 = 293.66, E4 = 329.63, FS4 = 369.99, A4 = 440, B4 = 493.88, D5 = 587.33, A3 = 220;
    const CHIMES = {
      message: [[0, A4], [0, D4, 0.5]],
      done: [[0, D4], [0, FS4, 0.8], [0.34, A4, 0.6]],
      starting: [[0, FS4], [0.4, A4, 0.8]],
      leave: [[0, E4], [0.42, A4, 0.8]],
      checkin: [[0, D4], [0.45, FS4, 0.7]],
      mission: [[0, D4], [0, A4, 0.7], [0.5, E4 * 2, 0.35]],
      moved: [[0, A4], [0.42, FS4, 0.8]],
      briefing: [[0, D4], [0.38, FS4, 0.8], [0.76, A4, 0.6]],
      wrapup: [[0, A4], [0.4, FS4, 0.75], [0.8, D4, 0.65]],
      pulse: [[0, D5, 0.45]],
      missed: [[0, B4, 0.7], [0.45, A3, 0.6]],
    };
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null, out = null, sleep = 0, lastAt = 0, lastKind = "";
    const soundOn = () => { try { return localStorage.getItem("nova-sfx") !== "off"; } catch (e) { return true; } };
    function wake() {
      if (!AC) return null;
      if (!ctx) {
        try {
          ctx = new AC();
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass"; lp.frequency.value = 1700; lp.Q.value = 0.4;
          out = ctx.createGain();
          out.gain.value = 0.04;
          out.connect(lp); lp.connect(ctx.destination);
        } catch (e) { ctx = null; return null; }
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      // (asleep again 10 s after the last sound: a running sound maker keeps the phone's audio awake in silence)
      clearTimeout(sleep);
      sleep = setTimeout(() => { if (ctx && ctx.state === "running") ctx.suspend().catch(() => {}); }, 10000);
      return ctx;
    }
    // (phones allow sound only after a tap: the sound maker is made on the first one, with the sound on)
    const unlock = () => {
      if (ctx || !soundOn()) return;
      if (wake()) {
        try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {}
        removeEventListener("pointerdown", unlock, true);
      }
    };
    addEventListener("pointerdown", unlock, { capture: true, passive: true });
    function chime(kind) {
      if (!soundOn() || document.hidden) return;
      const now = Date.now();
      // (sparse: never two within 1.5 s, and a pulse's ping at most every 4 s)
      if (now - lastAt < (kind === "pulse" && lastKind === "pulse" ? 4000 : 1500)) return;
      const c = wake();
      if (!c || c.state === "closed") return;
      lastAt = now; lastKind = kind;
      const notes = CHIMES[kind] || CHIMES.message;
      const t0 = c.currentTime + 0.05;
      const drift = 1 + (Math.random() - 0.5) * 0.004; // (a hair different each time)
      const spread = 0.9 + Math.random() * 0.25;
      for (const [at, f, loud = 1] of notes) {
        const t = t0 + at * spread;
        const o = c.createOscillator(), g = c.createGain();
        o.type = "sine";
        o.frequency.value = f * drift;
        o.connect(g); g.connect(out);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.6 * loud, t + 0.09 + Math.random() * 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.start(t); o.stop(t + 2.3);
      }
    }

    // ---- The pile of notices, at the top of the screen ----
    let pile = null, more = null, all = false;
    const styled = () => N.css("notices.css");
    function ensurePile() {
      if (pile) return pile;
      pile = document.createElement("div");
      pile.className = "nn-pile";
      pile.setAttribute("role", "region");
      pile.setAttribute("aria-label", "Reminders");
      more = document.createElement("button");
      more.type = "button";
      more.className = "nn-more";
      more.addEventListener("click", () => { all = !all; count(); });
      pile.append(more);
      document.body.append(pile);
      return pile;
    }
    function count() {
      if (!pile) return;
      const cards = [...pile.querySelectorAll(":scope > .nn-card")];
      const hiddenN = Math.max(0, cards.length - 2);
      if (!hiddenN) all = false;
      // (the newest at the top; past the newest two, only with "N more")
      cards.forEach((c, i) => c.classList.toggle("nn-off", !all && i >= 2));
      more.hidden = !hiddenN;
      more.textContent = all ? "Show fewer" : `${hiddenN} more notice${hiddenN === 1 ? "" : "s"}`;
      pile.hidden = !cards.length;
    }
    function remove(card) {
      clearTimeout(card._t);
      card.remove();
      count();
    }
    // The plan, for the buttons on a notice (a quest done already gets none; a repeating one gets Session done)
    let st = null, stAt = 0;
    async function questOf(id) {
      if (!id || id.startsWith("mission-")) return null;
      try {
        if (!st || Date.now() - stAt > 10000) { st = await N.api("/quests/state"); stAt = Date.now(); }
        return (st.quests || []).find((q) => q.id === id) || null;
      } catch (e) { return null; }
    }
    const btn = (id, action, words, minutes, main) => `<button type="button" class="nn-btn${main ? " main" : ""}" data-nq="${esc(id)}" data-na="${action}"${minutes ? ` data-nm="${minutes}"` : ""}>${words}</button>`;
    function buttonsFor(n, q) {
      const id = n.questId;
      if (!id || id.startsWith("mission-")) {
        if (n.kind === "mission") return `<a class="nn-btn" href="#agent/plan">See the plan</a>`;
        if (["briefing", "wrapup", "moved"].includes(n.kind)) return `<a class="nn-btn" href="#agent/plan">See the plan</a>`;
        return "";
      }
      if (q && (q.status === "done" || q.status === "skipped")) return "";
      if (n.kind === "checkin" && q && q.ongoing) return btn(id, "done", "✓ Session done", 0, true) + btn(id, "snooze", "+15 min", 15);
      if (n.kind === "checkin") return btn(id, "done", "✓ Done", 0, true) + btn(id, "snooze", "+15 min", 15) + btn(id, "snooze", "Move it", 60);
      if (n.kind === "starting" || n.kind === "leave") return btn(id, "start", "▶ Start", 0, true) + btn(id, "snooze", "In 15 min", 15);
      if (n.kind === "moved" || n.kind === "missed") return `<a class="nn-btn" href="#agent/plan">See the plan</a>`;
      return "";
    }
    const LONG = ["checkin", "starting", "leave"];
    async function show(n) {
      if (!n || !n.title) return;
      // (in the pile at once, in the order they came; its buttons once it's known how the quest is now)
      const card = document.createElement("div");
      card.className = `nn-card nn-${esc(n.kind || "note")}`;
      card.setAttribute("role", LONG.includes(n.kind) ? "alert" : "status");
      card.innerHTML = `<button type="button" class="nn-x" aria-label="Close">×</button><p class="nn-title">${esc(n.title)}</p>${n.message ? `<p class="nn-text">${esc(n.message)}</p>` : ""}<div class="nn-btns" hidden></div>`;
      const q = questOf(n.questId);
      await styled();
      ensurePile();
      more.after(card);
      card._t = setTimeout(() => remove(card), LONG.includes(n.kind) ? 120000 : 7000);
      count();
      chime(n.kind);
      const b = buttonsFor(n, await q);
      const row = card.querySelector(".nn-btns");
      if (b && card.isConnected) { row.innerHTML = b; row.hidden = false; }
    }
    // One card per pulse, ticking on every beat (with a count), instead of a new one each time
    const beats = {};
    async function pulse(n) {
      await styled();
      ensurePile();
      const id = String(n.questId || n.title);
      beats[id] = (beats[id] || 0) + 1;
      let card = pile.querySelector(`.nn-card[data-pulse="${CSS.escape(id)}"]`);
      if (!card) {
        card = document.createElement("div");
        card.className = "nn-card nn-pulse";
        card.dataset.pulse = id;
        card.setAttribute("role", "status");
        card.innerHTML = `<button type="button" class="nn-x" aria-label="Close">×</button><p class="nn-title"></p><p class="nn-text"></p>${n.questId ? `<div class="nn-btns">${btn(n.questId, "done", "✓ Did it", 0, true)}${btn(n.questId, "finish", "Stop")}</div>` : ""}`;
        more.after(card);
      }
      card.querySelector(".nn-title").textContent = `∞ ${n.title}`;
      card.querySelector(".nn-text").textContent = `${n.message ? `${n.message} · ` : ""}beat ${beats[id]}`;
      card.classList.remove("nn-beat");
      void card.offsetWidth;
      card.classList.add("nn-beat");
      clearTimeout(card._t);
      card._t = setTimeout(() => remove(card), 15000);
      count();
      chime("pulse");
    }
    document.addEventListener("click", async (e) => {
      const card = e.target.closest && e.target.closest(".nn-card");
      if (!card) return;
      if (e.target.closest(".nn-x") || e.target.closest("a.nn-btn")) return remove(card);
      const b = e.target.closest("[data-nq]");
      if (!b) return;
      b.disabled = true;
      try {
        const r = await N.post(`/actions/quests/${encodeURIComponent(b.dataset.nq)}`, { action: b.dataset.na, minutes: Number(b.dataset.nm) || undefined }, { "X-Nova-Visualizer": "1" });
        if (r && r.ok === false) throw new Error(r.message || "That didn't work.");
        N.toast({ done: "Done ✦", finish: "Stopped", start: "Started" }[b.dataset.na] || "Moved");
        remove(card);
        st = null;
        changed();
      } catch (err) {
        b.disabled = false;
        N.toast(err.signIn ? "Sign in first" : err.message, true);
      }
    });

    // ---- The live line to Nova Agent ----
    const changed = () => dispatchEvent(new CustomEvent("nova-quests-changed"));
    let es = null, retry = 0, retryT = 0, wait = 5000;
    function open() {
      if (es || document.hidden) return;
      clearTimeout(retryT);
      const ES = window.NovaEventSource || window.EventSource;
      if (!ES) return;
      try { es = new ES("/quests/events"); } catch (e) { es = null; return; }
      const mine = es;
      mine.addEventListener("open", () => { wait = 5000; retry = 0; changed(); });
      mine.addEventListener("changed", () => { st = null; changed(); });
      mine.addEventListener("notice", (e) => {
        let n = null;
        try { n = JSON.parse(e.data); } catch (err) { return; }
        if (n.kind === "pulse") return void pulse(n);
        void show(n);
        st = null;
        changed();
      });
      // (closed for good, as when the studio's computer is off or nobody's signed in: again in a while, slower each time)
      mine.addEventListener("error", () => {
        if (mine.readyState !== 2 || es !== mine) return;
        es = null;
        retry++;
        retryT = setTimeout(open, wait);
        wait = Math.min(120000, wait * 2);
      });
    }
    function close() {
      clearTimeout(retryT);
      if (es) { try { es.close(); } catch (e) {} es = null; }
    }
    document.addEventListener("visibilitychange", () => (document.hidden ? close() : (wait = 5000, open())));
    addEventListener("pagehide", close);
    // (once the first screen is up: nothing extra while the app opens)
    const later = () => setTimeout(open, 1200);
    if (document.readyState === "complete") later(); else addEventListener("load", later, { once: true });

    // ---- The service worker: a notification tapped, or one arriving, while Nova Phone is open ----
    const typing = () => !!document.querySelector("input:focus, textarea:focus, [contenteditable]:focus, form.dirty, dialog[open]");
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => {
      const d = e.data || {};
      if (d.type === "nova-open") { const to = place(d.url) || "#inbox/alerts"; if (location.hash !== to) location.hash = to; else N.show(); }
      else if (d.type === "nova-push") {
        if (d.source === "quest" || d.source === "mission") { st = null; changed(); }
        if (!typing()) N.show();
      }
    });

    N.place = place;
    N.agentSay = agentSay;
    N.takeSay = takeSay;
    N.chime = chime;
    N.notices = { live: () => !!(es && es.readyState === 1), show, pulse };
  }
  if (window.NovaPhone) start(); else addEventListener("DOMContentLoaded", start, { once: true });
})();
