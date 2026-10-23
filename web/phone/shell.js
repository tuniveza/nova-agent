// Nova Phone as a whole, once the first screen is up (phone.js loads this; nothing here is needed to draw it):
//   - the tiles' numbers (portal.md G1): what the places fetch anyway sets them (phone.js); this asks only for the
//     ones nobody has fetched for 5 minutes (15 with the battery saver on), one at a time, only while Nova Phone
//     is on screen
//   - updates (Nova Desk's update.js): which version is live (/app-version) on opening, on coming back and every
//     10 minutes while on screen; a new one: Nova Phone refreshes itself once you're not in the middle of
//     something, then "Updated ✦"
//   - who you are (your planet on the More button), kept fresh now and then
//   - when you came on and last left (Nova Desk's status line), on this device
//   - the battery saver (Nova Desk's: Auto, On or Off, "nova-options".saver)
//   - sounds and music, loaded only when they're switched on
//   window.NovaPhoneShell = { refresh(), check(), sessions(), here(), lastLeft(), saver() }
(() => {
  "use strict";
  if (window.NovaPhoneShell) return;
  const N = window.NovaPhone;
  const read = (k) => { try { return localStorage.getItem(k); } catch (err) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, v); } catch (err) {} };
  const json = (k, d) => { try { return JSON.parse(read(k)) ?? d; } catch (err) { return d; } };
  const root = document.documentElement;

  // ---- The battery saver ----
  let battery = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  function saverWanted() {
    const c = json("nova-options", {}).saver || "auto";
    if (c === "on") return true;
    if (c === "off") return false;
    return (!!battery && !battery.charging && battery.level <= 0.2) || !!(navigator.connection && navigator.connection.saveData) || reduce.matches;
  }
  function saver() {
    const on = saverWanted();
    if (on !== root.classList.contains("nova-saver")) root.classList.toggle("nova-saver", on);
    return on;
  }
  saver();
  if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; b.addEventListener("levelchange", saver); b.addEventListener("chargingchange", saver); saver(); }).catch(() => {});
  reduce.addEventListener?.("change", saver);
  addEventListener("novaoptionschange", saver);
  addEventListener("storage", (e) => e.key === "nova-options" && saver());

  // ---- On and off: each visit's start and end (a visit ends when Nova Phone is away for half an hour) ----
  const SESS = "nova-phone-sessions";
  let sessions = json(SESS, []).slice(-30);
  let mine = { on: Date.now(), off: Date.now() };
  sessions.push(mine);
  const keep = () => { mine.off = Date.now(); write(SESS, JSON.stringify(sessions.slice(-30))); };
  keep();
  let awayAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { awayAt = Date.now(); keep(); return; }
    if (awayAt && Date.now() - awayAt > 30 * 60000) { mine = { on: Date.now(), off: Date.now() }; sessions.push(mine); keep(); }
  });
  addEventListener("pagehide", keep);
  const lastLeft = () => { const i = sessions.indexOf(mine); return i > 0 ? sessions[i - 1].off : null; };

  // ---- The tiles' numbers ----
  const admin = () => (N.me() || {}).role === "admin";
  const ASK = [
    ["/app/api/notifications"], ["/app/api/booking-actions?status=all"], ["/app/api/money"], ["/quests/state"], ["/app/api/campaigns"],
    ["/app/api/outreach"], ["/app/api/social"], ["/app/api/funnel"], ["/app/api/tidy", admin],
  ];
  const off = new Set();
  let signedOut = false, asking = false;
  const every = () => (root.classList.contains("nova-saver") ? 15 : 5) * 60000;
  // (when each was last fetched, by a place or here; one that failed waits its turn like the rest)
  const tried = {};
  const stale = () => {
    const seen = N.seen(), at = (p) => Math.max(seen[p.split("?")[0]] || 0, tried[p] || 0);
    return ASK.filter(([p, only]) => !off.has(p) && (!only || only()) && Date.now() - at(p) > every()).sort((a, b) => at(a[0]) - at(b[0]));
  };
  async function ask(path) {
    tried[path] = Date.now();
    try {
      const r = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (r.status === 401) { signedOut = true; return; }
      // (not for this person, or not switched on yet: not asked again this visit)
      if (r.status === 403 || r.status === 404) { off.add(path); return; }
      if (!r.ok) return;
      const d = await r.json().catch(() => null);
      if (d) N.count(path, d);
    } catch (err) {} // offline: next time
  }
  // One at a time, the stalest first, a moment apart
  async function round(all) {
    if (asking || document.hidden || signedOut) return;
    asking = true;
    try {
      const list = stale();
      for (const [p] of all ? list : list.slice(0, 1)) {
        if (document.hidden) break;
        await ask(p);
        if (all) await new Promise((r) => setTimeout(r, 1500));
      }
    } finally { asking = false; }
  }
  let tick = 0;
  function startTicking() {
    clearInterval(tick);
    tick = 0;
    if (!document.hidden) tick = setInterval(() => round(false), 45000);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearInterval(tick); tick = 0; return; }
    signedOut = false;
    startTicking();
    setTimeout(() => round(true), 1500);
  });
  // (the first look: a few seconds after the first screen, so it never competes with it)
  setTimeout(() => { round(true); startTicking(); }, 6000);

  // ---- Who you are (for the planet on More; anything that fetches /auth/me keeps it fresh too) ----
  const me = N.me();
  if (!me || Date.now() - (me.at || 0) > 6 * 3600000) setTimeout(() => N.api("/auth/me").catch(() => {}), 1200);

  // ---- Updates (Nova Desk's update.js) ----
  let known = null, waiting = false;
  const busy = () => {
    const a = document.activeElement;
    const typing = a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) && (a.isContentEditable || (a.value || "").length > 0);
    // (a Lossless call counts as busy: reloading for an update would end it)
    return !!(typing || document.querySelector("dialog[open], form.dirty") || (window.NovaLossless && (window.NovaLossless.active || window.NovaLossless.starting)));
  };
  function update() {
    if (busy()) {
      if (waiting) return;
      waiting = true;
      const again = () => { if (!busy()) { stop(); waiting = false; update(); } };
      const stop = () => { clearInterval(t); document.removeEventListener("focusout", again, true); document.removeEventListener("close", again, true); };
      const t = setInterval(again, 4000);
      document.addEventListener("focusout", again, true);
      document.addEventListener("close", again, true);
      return;
    }
    try { sessionStorage.setItem("nova-updated", "1"); } catch (err) {}
    const sw = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? navigator.serviceWorker.getRegistration("/") : Promise.resolve(null);
    sw.then((r) => r && r.update()).catch(() => {}).finally(() => location.reload());
  }
  async function check() {
    if (document.hidden) return null;
    try {
      const r = await fetch("/app-version", { cache: "no-store", credentials: "omit" });
      if (!r.ok) return null;
      const { version } = await r.json();
      if (!version) return null;
      if (known === null) known = version;
      else if (version !== known) { update(); return "new"; }
      return version;
    } catch (err) { return null; }
  }
  check();
  let checkTimer = 0;
  const startChecks = () => { clearInterval(checkTimer); checkTimer = document.hidden ? 0 : setInterval(check, 10 * 60000); };
  startChecks();
  document.addEventListener("visibilitychange", () => { startChecks(); if (!document.hidden) check(); });
  addEventListener("pageshow", (e) => e.persisted && check());
  try {
    if (sessionStorage.getItem("nova-updated")) { sessionStorage.removeItem("nova-updated"); N.toast("Updated ✦"); N.activity("Nova Phone updated"); }
  } catch (err) {}

  // ---- The Manual's "something's new" dot on its tile (manual.js clears it with N.badge("help", 0)) ----
  setTimeout(() => N.script(N.asset("/shared/manual-news.js")).then(() => {
    const newest = Date.parse((window.NovaManualNews || {}).newest);
    const seenAt = Date.parse(read("nova-manual/seen") || "") || Number(read("nova-manual/seen")) || 0;
    if (newest && Date.now() - newest < 3 * 864e5 && newest > seenAt) N.badge("help", "•");
  }).catch(() => {}), 4000);

  // ---- Sounds and music: only when switched on ----
  if (read("nova-sfx") !== "off") N.script("sound.js").catch(() => {});
  if (read("nova-music") === "on") N.script(N.asset("/shared/ambient.js")).catch(() => {});
  addEventListener("novasfxchange", (e) => N.activity(e.detail && "extra" in e.detail ? `Quiet extras ${e.detail.extra ? "on" : "off"}` : `Sounds ${e.detail && e.detail.on ? "on" : "off"}`));
  addEventListener("novaambientchange", (e) => N.activity(`Music ${e.detail && e.detail.on ? "on" : "off"}`));

  // ---- Refresh everything (Portal's Refresh): the numbers, an update, what's on screen ----
  async function refresh() {
    N.toast("Refreshing…");
    const v = await check();
    if (v === "new") return;
    signedOut = false;
    off.clear();
    // (asked again: each answer resets its own number)
    for (const [p, only] of ASK) if (!only || only()) await ask(p);
    N.api("/auth/me").catch(() => {});
    await N.show();
    N.toast("Refreshed ✦");
  }

  window.NovaPhoneShell = { refresh, check, saver, sessions: () => sessions.slice(), here: () => mine.on, lastLeft };
})();
