// Nova Phone: Computer, the VPS Nova runs on (admins). Nova Desk has it twice: the Computer panel (the VPS's own
// Nova Agent: /computer-api/*, live every 4 s) and Portal → Admin → Computer (Nova Bot's /app/api/desk, every
// 30 s, with the restarts and the backup). Here they're one place, its parts one tap apart:
//   #computer                   Overview: live now, how busy, every service, Nova, Claude Code, versions, problems, buttons
//   #computer/terminal          the VPS's terminal (ttyd at /vps-terminal/), opened full screen:
//   #computer/terminal/view     ... watching (read-only)   #computer/terminal/control  ... typing into it for real
//   #computer/screen            the Claude sessions (tmux), live and coloured, and the jobs the VPS ran
//   #computer/files/<path>      the VPS's folders     #computer/file/<path>  one text file or picture
//   #computer/programs          everything running    #computer/disk/<path>  what fills the disk
// Everything but the buttons and Control is read-only. Live parts refresh only while they're on screen and the
// phone is awake (ns CLAUDE.md 2e). Times are the UK's.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, choices, empty, post, toast, confirm, busy } = N;
  const EVERY = 4000;

  // ---- Little drawings of our own (the frame's set has no folder or lock) ----
  const SVG = {
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    file: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    hidden: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a15.6 15.6 0 0 1-3 3.4M6.6 7.6A15.4 15.4 0 0 0 2.5 12c1 1.5 4.5 6 9.5 6a9.4 9.4 0 0 0 4-.9"/>',
    other: '<path d="M12 3 21 12 12 21 3 12z"/>',
  };
  const ico = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${SVG[n] || SVG.other}</svg>`;

  // ---- Words for times and sizes (as Nova Desk says them) ----
  const london = (iso, withDay) => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return "";
    const opts = { timeZone: "Europe/London", hour: "numeric", minute: "2-digit" };
    const sameDay = d.toLocaleDateString("en-GB", { timeZone: "Europe/London" }) === new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" });
    if (withDay || !sameDay) Object.assign(opts, { weekday: "short", day: "numeric", month: "short" });
    return d.toLocaleString("en-GB", opts).replace(",", "");
  };
  const ago = (iso) => {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(s)) return String(iso);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 172800) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const length = (secs) => {
    const s = Math.max(0, Math.round(secs || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };
  const dur = (s) => {
    if (s == null) return "?";
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d} days ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const size = (b) => {
    if (!Number.isFinite(b)) return "–";
    const g = b / 1024 ** 3;
    return g >= 10 ? `${Math.round(g)} GB` : g >= 1 ? `${g.toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`;
  };
  const gb = (n) => (n == null ? "?" : `${(n / 1024 ** 3).toFixed(1)} GB`);
  const pct = (used, total) => (total ? Math.round((used / total) * 100) : NaN);
  const tone = (p) => (p >= 90 ? "bad" : p >= 75 ? "warn" : "");

  // ---- The server: Nova Desk's own addresses. 401: the sign-in card; 403: for admins only ----
  async function get(path) {
    let res;
    try {
      res = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    } catch (e) {
      throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true });
    }
    const data = await res.json().catch(() => null);
    if (res.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (res.status === 403) throw Object.assign(new Error((data && (data.message || data.error)) || "Computer is for admins."), { admins: true, status: 403 });
    if (!res.ok || !data || data.ok === false) throw Object.assign(new Error((data && (data.message || data.error)) || `No answer just now (${res.status}). Try again in a moment.`), { status: res.status, data });
    return data;
  }
  const forAdmins = (box) => (box.innerHTML = empty({ icon: "user", title: "Computer is for admins", text: "Sign in as an admin to see the VPS." }));
  const enc = (path) => path.split("/").map(encodeURIComponent).join("/");
  const at = (where, path) => `#computer/${where}${path === "/" ? "" : enc(path)}`;
  const joinPath = (parts) => `/${parts.filter(Boolean).join("/")}`;

  // ---- Live: one refresh at a time, only while this place is on screen and the phone is awake ----
  const live = { timer: 0, fn: null, ms: 0, token: 0 };
  function every(ms, fn) {
    stop();
    Object.assign(live, { fn, ms });
    const t = live.token;
    const step = async () => {
      live.timer = 0;
      if (t !== live.token) return;
      if (document.hidden) return chip(false);
      chip(true);
      try { await fn(); } catch (e) { /* (said on the page by fn) */ }
      if (t === live.token && !document.hidden) live.timer = setTimeout(step, live.ms);
    };
    live.step = step;
    live.timer = setTimeout(step, ms);
  }
  function stop() { live.token++; clearTimeout(live.timer); live.timer = 0; live.fn = null; live.step = null; }
  function chip(on) { for (const c of document.querySelectorAll("[data-live]")) { c.textContent = on ? "Live" : "Paused"; c.className = `pill ${on ? "ok" : ""}`; } }
  document.addEventListener("visibilitychange", () => {
    if (!live.fn) return;
    if (document.hidden) { clearTimeout(live.timer); live.timer = 0; chip(false); }
    else if (!live.timer && live.step) live.step();
  });
  addEventListener("hashchange", () => {
    if (!/^#computer(\/|$)/.test(location.hash)) stop();
    if (!/^#computer\/terminal\/(view|control)$/.test(location.hash)) closeTerminal();
  });
  // (a part's HTML put in only when it changed: nothing rewritten for nothing, a box left open stays open)
  function put(el, html) {
    if (!el || el.dataset.was === html) return;
    const open = [...el.querySelectorAll("details[data-keep][open]")].map((d) => d.dataset.keep);
    el.dataset.was = html;
    el.innerHTML = html;
    for (const k of open) el.querySelector(`details[data-keep="${k}"]`)?.setAttribute("open", "");
    bars(el);
  }
  const bars = (root) => root.querySelectorAll("[data-w]").forEach((b) => b.style.setProperty("width", `${Math.max(1, Math.min(100, Number(b.dataset.w) || 0))}%`));

  // ---- The parts, one tap apart ----
  const PARTS = [["", "Overview"], ["terminal", "Terminal"], ["screen", "Screen"], ["files", "Files"], ["programs", "Programs"], ["disk", "Disk"]];
  const tabs = (on) => `<nav class="comp-tabs" aria-label="What to look at">${PARTS.map(([p, l]) => `<a class="seg-a" href="#computer${p ? `/${p}` : ""}" aria-selected="${p === on}">${l}</a>`).join("")}</nav>`;
  const liveChip = `<span class="pill ok" data-live>Live</span>`;

  N.section({
    id: "computer", name: "Computer", tile: "computer",
    async draw(box, path, ui) {
      await N.css("computer.css");
      stop();
      const [part = "", ...rest] = path;
      if (part === "terminal") return drawTerminal(box, rest[0], ui);
      if (part === "screen") return drawScreen(box);
      if (part === "files") return drawFiles(box, rest, ui);
      if (part === "file") return drawFile(box, rest, ui);
      if (part === "programs") return drawProgs(box);
      if (part === "disk") return drawDisk(box, rest, ui);
      return drawOverview(box);
    },
  });

  // ================= Overview =================
  // Both views of the VPS: the VPS's own Nova Agent (live) and Nova Bot's (Portal's: versions, jobs, restarts)
  let deskData = null, deskAt = 0;
  async function drawOverview(box) {
    const [st, dk] = await Promise.allSettled([get("/computer-api/state"), get("/app/api/desk")]);
    const errs = [st, dk].filter((r) => r.status === "rejected").map((r) => r.reason);
    if (errs.length === 2 && errs.some((e) => e.signIn)) throw errs.find((e) => e.signIn);
    if (errs.length === 2 && errs.every((e) => e.admins)) return forAdmins(box);
    if (dk.status === "fulfilled") { deskData = dk.value; deskAt = Date.now(); }
    const view = { state: st.status === "fulfilled" ? st.value : null, stateErr: st.status === "rejected" ? st.reason : null, desk: dk.status === "fulfilled" ? dk.value : null, deskErr: dk.status === "rejected" ? dk.reason : null };
    box.innerHTML = `${tabs("")}
      <div class="comp-head"><p class="muted small">What the VPS is doing right now: its Claude sessions, Claude Code, how busy it is, and Nova.</p>${liveChip}</div>
      <div data-part="here"></div><div data-part="gauges"></div><div data-part="services"></div><div data-part="nova"></div>
      <div data-part="claude"></div><div data-part="bot"></div><div data-part="vps"></div><div data-part="acts"></div>`;
    paintOverview(box, view);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]");
      if (b) act(b, box, view);
    });
    every(EVERY, async () => {
      if (!box.isConnected) return stop();
      const want = [get("/computer-api/state")];
      // (Portal's view every 30 seconds, as on Nova Desk)
      if (Date.now() - deskAt > 30000) want.push(get("/app/api/desk"));
      const [a, b] = await Promise.allSettled(want);
      if (a.status === "fulfilled") { view.state = a.value; view.stateErr = null; } else view.stateErr = a.reason;
      if (b) { deskAt = Date.now(); if (b.status === "fulfilled") { view.desk = deskData = b.value; view.deskErr = null; } else view.deskErr = b.reason; }
      paintOverview(box, view);
    });
  }

  const agentWhere = (pc) => (pc && pc.connected ? (pc.where === "server" ? "On the VPS" : "On the studio PC") : "Not linked");
  const fact = (k, v, cls = "", note = "") => (v === "" || v == null ? "" : `<div class="fact"><span>${esc(k)}</span><b${cls ? ` class="${cls}"` : ""}>${esc(v)}</b>${note ? `<small class="comp-note">${esc(note)}</small>` : ""}</div>`);
  const NICE = { active: "Running", inactive: "Stopped", failed: "Failed", activating: "Starting", reloading: "Reloading", deactivating: "Stopping", unknown: "Not known" };
  const stateTone = (s) => (s === "active" || s === "ok" || s === "up" ? "ok" : s === "failed" || s === "bad" || s === "down" ? "bad" : s === "activating" || s === "reloading" || s === "warn" ? "warn" : "");
  const dotRow = (name, s, text, words) => `<li><div class="row"><span class="row-lead"><i class="comp-dot ${stateTone(s)}" aria-hidden="true"></i></span><span class="row-main"><b>${esc(name)}</b>${text ? `<span>${esc(text)}</span>` : ""}</span><span class="row-end"><span class="pill ${stateTone(s)}">${esc(words || NICE[s] || s || "?")}</span></span></div></li>`;

  function paintOverview(box, { state, stateErr, desk, deskErr }) {
    const slot = (n) => box.querySelector(`[data-part="${n}"]`);
    const h = desk?.here || {}, v = desk?.vps || {}, svc = v.services || {};
    const cv = state?.vps || null;

    // Live now (Portal): Nova's address, where Nova Agent runs and since when, how to move it, warnings
    put(slot("here"), desk ? (() => {
      const sw = h.agentSwitch, onServer = h.pc && h.pc.where === "server";
      return `<div class="card"><div class="comp-card-head"><p class="kicker">Live now</p><span class="pill ok">Your VPS</span></div>
        <div class="facts">${fact("Nova's address", h.url || "?")}${fact("Nova Agent runs", agentWhere(h.pc), h.pc?.connected ? "ok" : "warn", h.pc && h.pc.connected && h.pc.since ? `linked since ${ago(h.pc.since)}` : "")}
        ${sw ? `<div class="fact"><span>${onServer ? "Move Nova Agent to the studio PC" : "Move Nova Agent to the VPS"}</span><code class="comp-cmd">${esc(onServer ? sw.back : sw.to)}</code><small class="comp-note">Run on ${esc(sw.from)}; it asks before doing anything.</small></div>` : ""}</div>
        ${(h.warnings || []).map((w) => `<p class="comp-warn">⚠ ${esc(w)}</p>`).join("")}</div>`;
    })() : `<div class="card"><p class="kicker">Live now</p><p class="muted">Portal's view of the VPS didn't load: ${esc(deskErr?.message || "")} It tries again every 30 seconds.</p></div>`);

    // How busy: CPU, memory, disk, up for (the VPS's Nova live; Portal's numbers when that's not answering)
    let gauges;
    if (cv) {
      const mem = cv.memory, disk = cv.disk;
      const days = Math.floor((cv.uptimeSeconds || 0) / 86400), hours = Math.floor(((cv.uptimeSeconds || 0) % 86400) / 3600);
      gauges = [
        ["CPU", cv.cpu == null ? "–" : `${cv.cpu}%`, `load ${(cv.load || [])[0] ?? "–"} · ${cv.cpus || "?"} cores`, cv.cpu],
        ["Memory", mem ? `${pct(mem.used, mem.total)}%` : "–", mem ? `${size(mem.used)} of ${size(mem.total)}` : "", mem ? pct(mem.used, mem.total) : NaN],
        ["Disk", disk ? `${pct(disk.total - disk.free, disk.total)}%` : "–", disk ? `${size(disk.free)} free` : "", disk ? pct(disk.total - disk.free, disk.total) : NaN],
        ["Up for", days ? `${days}d ${hours}h` : `${hours}h`, "since its last restart", NaN],
      ];
    } else if (v.reachable) {
      gauges = [
        ["Memory", v.memory ? `${pct(v.memory.total - v.memory.free, v.memory.total)}%` : "–", v.memory ? `${gb(v.memory.total - v.memory.free)} of ${gb(v.memory.total)}` : "", v.memory ? pct(v.memory.total - v.memory.free, v.memory.total) : NaN],
        ["Disk", v.disk ? `${pct(v.disk.total - v.disk.free, v.disk.total)}%` : "–", v.disk ? `${gb(v.disk.free)} free of ${gb(v.disk.total)}` : "", v.disk ? pct(v.disk.total - v.disk.free, v.disk.total) : NaN],
        ["Up for", dur(v.uptimeSeconds), "since its last restart", NaN],
      ];
    }
    const load = v.cpu && v.cpu.load ? `<p class="small muted comp-load">${esc(v.cpu.count)} processors · busy ${esc(v.cpu.load.join(" · "))} <span>(1, 5, 15 min)</span></p>` : "";
    const hist = cv?.history || [];
    put(slot("gauges"), `${gauges ? `<h3 class="h">The VPS</h3><div class="comp-gauges">${gauges.map(([l, big, small, p]) => `<div class="comp-gauge"><span>${esc(l)}</span><b class="${tone(p)}">${esc(big)}</b><small>${esc(small)}</small>${Number.isFinite(p) ? `<i class="comp-meter" aria-hidden="true"><i class="${tone(p)}" data-w="${Math.max(2, p)}"></i></i>` : ""}</div>`).join("")}</div>` : ""}
      ${load}${cv ? `<div class="comp-sparks">${spark("cpu", "CPU", hist, "cpu")}${spark("mem", "Memory", hist, "mem")}</div>` : ""}
      ${stateErr ? `<p class="comp-warn">${esc(stateErr.data?.onServer === false || state?.onServer === false ? "Nova Agent is running on the studio PC just now, so the VPS's own live view (its sessions, files, programs) isn't here. Portal's view is below." : stateErr.admins ? stateErr.message : stateErr.data?.pcOffline || stateErr.status === 503 || stateErr.status === 502 ? "Nova Agent on the VPS isn't answering right now. It tries again by itself." : `Couldn't read the VPS just now (${stateErr.message}). Trying again…`)}</p>` : ""}
      ${state && state.onServer === false ? `<p class="comp-warn">Nova Agent is running on the studio PC just now, so the VPS's own live view (its sessions, files, programs) isn't here. Portal's view is below.</p>` : ""}`);

    // Every service: live from the VPS's Nova where it has one, with Portal's notes (since when, hints)
    const liveSvc = Object.fromEntries((cv?.services || []).map((s) => [s.id, s.state]));
    const s = (id) => liveSvc[id] || svc[id] || "";
    const rows = [];
    if (desk && v.reachable || cv) {
      rows.push(dotRow("Nova Bot", s("nova"), v.novaSince ? `since ${v.novaSince}` : ""));
      if (s("nova-agent")) rows.push(dotRow("Nova Agent", s("nova-agent") === "active" ? "active" : "", s("nova-agent") === "active" ? (v.agentSince ? `since ${v.agentSince}` : "") : "It runs on the studio PC", s("nova-agent") === "active" ? "Running" : "Not running here"));
      rows.push(dotRow("Web front (HTTPS)", s("caddy"), "Caddy"));
      if (desk && v.reachable) {
        const m = v.mail;
        if (m) rows.push(dotRow("Mail sender", s("nova-mail"), [m.queue != null ? `${m.queue} waiting` : "", `last sent ${ago(m.lastSent)}`, m.troubleToday ? `${m.troubleToday} delayed or bounced today` : ""].filter(Boolean).join(" · ")));
        if (s("postfix")) rows.push(dotRow("Mail (Postfix)", s("postfix"), "Sends the mail sender's emails out"));
        rows.push(dotRow("Every-minute jobs", v.jobsOn ? "active" : "warn", v.jobsOn ? "" : "Timed jobs are off: on the VPS, systemctl enable --now nova-cron.timer", v.jobsOn ? "On" : "Off"));
        rows.push(dotRow("Nightly backup", svc["nova-backup.timer"] === "active" ? "active" : "warn", `last ${ago(v.lastBackup)}${v.backups && v.backups.length ? ` · ${v.backups.length} kept here` : ""}`, svc["nova-backup.timer"] === "active" ? "On" : "Off"));
        rows.push(dotRow("Last data copy", v.lastSync ? "active" : "", v.lastSync ? london(v.lastSync, true) : "", v.lastSync ? ago(v.lastSync) : "Not yet"));
      } else {
        for (const x of (cv?.services || []).filter((x) => !["nova", "nova-agent", "caddy"].includes(x.id))) rows.push(dotRow(x.name, x.state, ""));
      }
    }
    put(slot("services"), rows.length ? `<h3 class="h">Services</h3><ul class="list">${rows.join("")}</ul>` : "");

    // Nova: the status page, every part, the latest updates, the Fixer, the backups
    const n = state?.suite;
    put(slot("nova"), n ? `<h3 class="h">Nova</h3><div class="card">
        <p class="comp-overall ${n.ok === true ? "ok" : n.ok === false ? "bad" : ""}">${esc(n.overall || (n.ok == null ? "The status page didn't answer just now." : ""))}</p>
        ${(n.parts || []).length ? `<ul class="comp-dots">${n.parts.map((p) => `<li><i class="comp-dot ${stateTone(p.state)}" aria-hidden="true"></i><span><b>${esc(p.name)}</b>${p.text ? `<small>${esc(p.text)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}
        <p class="kicker comp-gap">Latest updates</p>
        ${(n.deploys || []).length ? `<ul class="comp-deploys">${n.deploys.map((d) => `<li><span class="pill">${esc(d.repo)}</span><b>${esc(d.subject)}</b><small>${esc(london(d.at))}${d.hash ? ` · ${esc(d.hash)}` : ""}</small></li>`).join("")}</ul>` : `<p class="muted small">No updates found.</p>`}
        ${n.fixer && n.fixer.off ? `<div class="comp-fixer"><p><b>Fixer</b> · switched off for now</p></div>` /* (Fixer off, 24 Oct 2026: nothing to open; FIXER_ON=1 brings the rest back) */ : `<div class="comp-fixer"><p><b>Fixer</b> · ${n.fixer ? (!n.fixer.lastCheck ? "hasn't checked yet" : n.fixer.looksFailed ? `<strong class="bad">${n.fixer.looksFailed} problem${n.fixer.looksFailed === 1 ? "" : "s"}</strong> with the four rules` : "the four rules all kept") : "not running here"}${n.fixer ? `<br><small class="muted">Checks every 30 minutes · last ${n.fixer.lastCheck ? esc(ago(n.fixer.lastCheck)) : "–"}</small>` : ""}</p><a class="btn" href="#fixer">Open the Fixer</a></div>`}
        <p class="small">${n.backup ? `Last backup: <b>${esc(london(n.backup.last, true))}</b> (${esc(ago(n.backup.last))})` : "Last backup: not known from here."}</p></div>` : "");

    // Claude Code on the VPS, and what it's working on
    const c = state?.claude;
    put(slot("claude"), c ? `<h3 class="h">Claude Code</h3><div class="card"><div class="facts comp-facts2">${fact("Version", c.version || "–")}${fact("Signed in", c.signedIn ? "Yes" : "No", c.signedIn ? "ok" : "bad")}${fact("Nova-VPS", c.remote ? "Connected" : "Not connected", c.remote ? "ok" : "warn")}${fact("Jobs working", String(c.running ?? 0), c.running ? "warn" : "")}${fact("Finished today", String(c.finishedToday ?? 0))}</div>
        ${c.problem ? `<p class="comp-warn">${esc(c.problem)}</p>` : ""}
        <p class="small muted comp-gap">On your phone: <b>Claude app → Code → Nova-VPS</b>.</p>
        ${c.handoff ? `<details class="comp-handoff" data-keep="handoff"><summary><span class="kicker">What it's working on (HANDOFF.md)</span><b>${esc(c.handoff.heading)}</b></summary><p class="pre small">${esc(c.handoff.text)}</p></details>` : ""}</div>` : "");

    // Nova Bot and Nova Agent (Portal): Nova Bot's version, the link, each job's last run
    put(slot("bot"), desk ? `<h3 class="h">Nova Bot and Nova Agent</h3><div class="card"><div class="facts">${fact("Address", h.url || "?")}${h.version ? fact("Nova Bot version", h.version.id || "?", "", h.version.at ? `deployed ${ago(h.version.at)}` : "") : ""}${fact("Nova Agent", agentWhere(h.pc), "", h.pc && h.pc.connected && h.pc.since ? `linked since ${ago(h.pc.since)}` : "")}</div></div>
        ${(h.jobs || []).length ? `<h3 class="h">Jobs: last run</h3>${list(h.jobs.slice(0, 14).map((j) => row({ icon: j.ok ? "check" : "clock", title: j.name, text: `${ago(j.at)}${j.note ? ` · ${j.ok ? j.note : `Problem: ${j.note}`}` : ""}`, end: j.ok ? "" : `<span class="pill bad">Problem</span>` })))}` : ""}` : "");

    // The VPS (Portal): the server, its version, recent problems
    put(slot("vps"), desk ? (v.reachable ? `<h3 class="h">The server</h3><div class="card"><div class="facts">${fact("Address", v.url || "?")}${fact("Server", v.host || "?", "", `up ${dur(v.uptimeSeconds)}`)}${v.version ? fact("Version", String(v.version).split(" ")[0], "", String(v.version).split(" ")[1] ? `sent ${ago(String(v.version).split(" ")[1])}` : "") : ""}${v.node ? fact("Node", v.node) : ""}</div>
        <p class="kicker comp-gap">Recent problems (last day)</p>${(v.problems || []).length ? `<ul class="comp-problems">${v.problems.slice(-8).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="small ok">None ✓</p>`}</div>`
      : `<h3 class="h">The server</h3><div class="card"><p class="kicker bad">Can't be reached</p><div class="facts">${fact("Address", v.url || "?")}</div><p class="small">${esc(v.reason || "No answer.")}</p></div>`) : "");

    // The buttons (Portal: an admin signed in in this browser). Restart Nova Agent only when it runs on the VPS.
    put(slot("acts"), desk ? (desk.canAct && v.reachable ? `<div class="btns two"><button type="button" class="btn" data-do="backup" data-label="Back up now">Back up now</button><button type="button" class="btn" data-do="restart" data-label="Restart Nova Bot">Restart Nova Bot</button>${svc["nova-agent"] === "active" ? `<button type="button" class="btn" data-do="restart-agent" data-label="Restart Nova Agent">Restart Nova Agent</button>` : ""}<button type="button" class="btn" data-do="restart-web" data-label="Restart web front">Restart web front</button></div><button type="button" class="btn quiet wide" data-do="refresh" data-label="Refresh">${icon("refresh")} Refresh now</button>`
      : desk.canAct ? "" : `<p class="muted small">Restarting and backing up need Portal open in a browser, signed in as an admin.</p>`) : "");
  }

  function spark(kind, label, points, key) {
    const vals = points.map((p) => p[key]);
    const n = vals.length, now = n ? vals[n - 1] : null;
    let path = "";
    if (n >= 2) {
      const xy = vals.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(40 - (Math.max(0, Math.min(100, v)) / 100) * 38).toFixed(2)}`);
      path = `<path class="area" d="M0,40 L${xy.join(" L")} L100,40 Z"/><polyline class="line" points="${xy.join(" ")}"/>`;
    }
    return `<div class="comp-spark ${kind}"><p><span>${esc(label)} · 30 min</span><b>${now == null ? "–" : `${now}%`}</b></p>${path ? `<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(label)} over the last half hour">${path}</svg>` : `<p class="muted small comp-gather">Gathering… (a point every 30 seconds)</p>`}</div>`;
  }

  async function act(b, box, view) {
    const what = b.dataset.do, label = b.dataset.label;
    if (what === "refresh") return busy(b, "Refreshing…", async () => { deskAt = 0; if (live.step) { clearTimeout(live.timer); live.timer = 0; await live.step(); } });
    if (what !== "backup" && !(await confirm({ title: `${label}?`, text: what === "restart-web" ? "Nova's address doesn't answer for a few seconds while the web front restarts." : "It's away for a few seconds while it starts again. Everything carries on after.", ok: label }))) return;
    await busy(b, "Asking the VPS…", async () => {
      try {
        await post("/app/api/desk/action", { do: what });
        toast(`${label}: done ✓`);
        setTimeout(() => { deskAt = 0; }, 2500);
      } catch (err) { toast(err.message, true); }
    });
  }

  // ================= Terminal (ttyd, /vps-terminal/: admins only, asked of Nova Bot first) =================
  // One tmux session, Dashboard and Shell, that carries on when it's closed. View only (/vps-terminal/view/) can't
  // type; Control types into the VPS for real, so it asks first and says so the whole time it's open.
  let term = null;
  function closeTerminal() {
    if (!term) return;
    term.el.querySelector("iframe").src = "about:blank";
    term.el.remove();
    document.documentElement.classList.remove("comp-term-on");
    term = null;
  }
  async function drawTerminal(box, mode, ui) {
    box.innerHTML = `${tabs("terminal")}
      <div class="card"><p class="kicker">The VPS's terminal</p><h2 class="card-title">Dashboard and Shell</h2>
        <p>One session on the VPS that carries on when you close it. <b>Watch</b> shows it without typing; <b>Control</b> types into the VPS for real.</p>
        <p class="small muted">It opens full screen. Back, top left, brings you here.</p></div>
      <div class="btns"><button type="button" class="btn main wide" data-open="view">${icon("play")} Watch (view only)</button><button type="button" class="btn danger wide" data-open="control">${icon("edit")} Control the VPS</button></div>
      <a class="btn quiet wide" href="#computer/screen">Sessions and jobs: Screen ${icon("next")}</a>`;
    box.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.open === "control" && !(await sureControl())) return;
      fromTab = true;
      location.hash = `#computer/terminal/${b.dataset.open}`;
    }));
    if (mode === "view" || mode === "control") openTerminal(mode);
  }
  let fromTab = false;
  const sureControl = () => confirm({ title: "Control the VPS?", text: "What you type runs on the VPS for real: commands, restarts, deleting. Watch is enough to look.", ok: "Control it", danger: true });
  function openTerminal(mode) {
    if (term && term.mode === mode) return;
    closeTerminal();
    const el = document.createElement("div");
    el.className = `comp-term${mode === "control" ? " control" : ""}`;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "The VPS's terminal");
    el.innerHTML = `<div class="comp-term-bar"><button type="button" class="btn comp-term-back" data-back>${icon("back")} Back</button><b class="comp-term-mode">${mode === "control" ? "Control" : "View only"}</b><button type="button" class="btn quiet" data-switch>${mode === "control" ? "View only" : "Control"}</button></div>
      ${mode === "control" ? `<p class="comp-term-warn" role="status">You're controlling the VPS: changes are real</p>` : ""}
      <div class="comp-term-box"><p class="comp-term-wait" data-wait>Opening the VPS's terminal…</p><iframe title="The VPS's terminal" allow="clipboard-read; clipboard-write" hidden></iframe></div>`;
    document.body.append(el);
    document.documentElement.classList.add("comp-term-on");
    term = { el, mode };
    const frame = el.querySelector("iframe"), wait = el.querySelector("[data-wait]");
    frame.addEventListener("load", () => {
      if (!frame.src || frame.src === "about:blank") return;
      // (the same site, so it can be looked at: Nova Bot's "admins only" answer, or no terminal there, is said in words)
      let bad = "";
      try {
        const d = frame.contentDocument;
        const text = (d?.body?.innerText || "").trim().slice(0, 300);
        if (d && /json/.test(d.contentType || "")) bad = /admin/i.test(text) ? "The terminal is for admins: sign in as one on this phone's browser." : /sign in/i.test(text) ? "Sign in first (Portal, as an admin), then open it again." : "The terminal said no.";
        else if (d && /not found|error response|^404|bad gateway|502/i.test(`${d.title} ${text.slice(0, 60)}`)) bad = "The VPS's terminal isn't answering just now. Try again in a moment.";
      } catch (e) { /* (another site's page: shown as it is) */ }
      if (bad) { wait.innerHTML = `<b>${esc(bad)}</b><button type="button" class="btn" data-again-term>${icon("refresh")} Try again</button>`; wait.hidden = false; frame.hidden = true; return; }
      wait.hidden = true;
      frame.hidden = false;
    });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-back]")) {
        if (fromTab) { fromTab = false; history.back(); } else location.hash = "#computer/terminal";
      } else if (e.target.closest("[data-switch]")) {
        const to = mode === "control" ? "view" : "control";
        if (to === "control" && !(await sureControl())) return;
        location.replace(`#computer/terminal/${to}`);
      } else if (e.target.closest("[data-again-term]")) {
        wait.textContent = "Opening the VPS's terminal…";
        frame.src = "about:blank";
        setTimeout(() => (frame.src = mode === "control" ? "/vps-terminal/" : "/vps-terminal/view/"), 50);
      }
    });
    frame.src = mode === "control" ? "/vps-terminal/" : "/vps-terminal/view/";
    el.querySelector("[data-back]").focus();
  }

  // ================= Screen: the Claude sessions, live, and the jobs =================
  let picked = null; // "screen:<id>" or "job:<id>"
  async function drawScreen(box) {
    let state;
    try { state = await get("/computer-api/state"); } catch (err) { if (err.admins) return forAdmins(box); return stateTrouble(box, "screen", err); }
    if (state.onServer === false) return stateTrouble(box, "screen", { data: { onServer: false } });
    box.innerHTML = `${tabs("screen")}<div class="comp-head"><p class="muted small">The VPS's Claude sessions, live and read-only, and the jobs it ran.</p>${liveChip}</div>
      <div data-part="picks"></div><div data-part="term"></div><div data-part="jobs"></div>`;
    const paint = () => {
      const screens = state.screens || [], jobs = state.jobs || [];
      if (!picked || (picked.startsWith("screen:") && !screens.some((s) => `screen:${s.id}` === picked)) || (picked.startsWith("job:") && !jobs.some((j) => `job:${j.id}` === picked)))
        picked = screens.length ? `screen:${(screens.find((s) => s.session === "nova-vps") || screens[0]).id}` : jobs[0] ? `job:${jobs[0].id}` : null;
      put(box.querySelector('[data-part="picks"]'), screens.length ? `<div class="chips" role="tablist" aria-label="Sessions on the VPS">${screens.map((s) => `<button type="button" class="chip" role="tab" data-pick="screen:${esc(s.id)}" aria-pressed="${picked === `screen:${s.id}`}"><i class="comp-dot ok" aria-hidden="true"></i>${esc(s.title)}</button>`).join("")}</div>`
        : `<p class="muted small">${state.claude?.tmux ? "No sessions open on the VPS right now." : "The VPS's sessions can't be seen from here."}</p>`);
      let head = "", html = "";
      if (picked?.startsWith("screen:")) {
        const s = screens.find((x) => `screen:${x.id}` === picked);
        if (s) { head = `${s.title}${s.name && !s.title.includes(s.name) ? ` · ${s.name}` : ""}`; html = s.html ? ansi(s.html) : `<span class="muted">This session's screen is empty.</span>`; }
      } else if (picked?.startsWith("job:")) {
        const j = jobs.find((x) => `job:${x.id}` === picked);
        if (j) { head = `Job · ${j.name}`; html = j.tail ? esc(j.tail) : `<span class="muted">${j.running ? "Working… its words show here when it finishes a step." : "This job didn't write anything."}</span>`; }
      }
      const termEl = box.querySelector('[data-part="term"]');
      put(termEl, `<div class="comp-screen">${head ? `<p class="comp-screen-head">${esc(head)}</p>` : ""}<pre class="comp-pre comp-ansi" aria-label="What this shows">${html || `<span class="muted">Nothing to show yet.</span>`}</pre></div>`);
      styles(termEl);
      put(box.querySelector('[data-part="jobs"]'), `<h3 class="h">Jobs on the VPS</h3>${jobs.length ? `<ul class="list">${jobs.map((j) => {
        const pill = j.running ? `<span class="pill warn">Working</span>` : j.exit === 0 ? `<span class="pill ok">Done</span>` : `<span class="pill bad">Stopped</span>`;
        const when = j.running ? `${length(j.seconds)} so far` : `${london(j.finished || j.started)} · ${length(j.seconds)}`;
        return `<li><button type="button" class="row${picked === `job:${j.id}` ? " comp-picked" : ""}" data-pick="job:${esc(j.id)}" aria-pressed="${picked === `job:${j.id}`}"><span class="row-lead">${pill}</span><span class="row-main"><b>${esc(j.name)}</b><span>${esc(when)}</span>${j.task ? `<span class="comp-task">${esc(j.task.split("\n")[0])}</span>` : ""}</span><span class="row-end"></span></button></li>`;
      }).join("")}</ul>` : empty({ icon: "clock", title: "No jobs yet", text: "Jobs handed to the VPS show here." })}`);
    };
    paint();
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]");
      if (!b) return;
      picked = b.dataset.pick;
      paint();
      if (picked.startsWith("job:")) box.querySelector(".comp-screen")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    every(EVERY, async () => {
      if (!box.isConnected) return stop();
      try { state = await get("/computer-api/state"); paint(); } catch (err) { /* (the last screen stays; tried again in 4 s) */ }
    });
  }
  // (the screen's colours come as classes for the 16 named ones and a style for the rest: the page's rules don't
  // let a style be written in, so it's carried as data and set from here)
  const ansi = (html) => String(html).replace(/ style="([^"]*)"/g, (m, s) => ` data-ansi="${s}"`);
  function styles(root) {
    for (const el of root.querySelectorAll("[data-ansi]")) {
      for (const part of el.dataset.ansi.split(";")) {
        const [k, val] = part.split(":").map((x) => (x || "").trim());
        if ((k === "color" || k === "background") && /^[#\w(),.%\s]+$/.test(val || "")) el.style.setProperty(k, val);
      }
      el.removeAttribute("data-ansi");
    }
  }
  function stateTrouble(box, part, err) {
    if (err.signIn) throw err;
    const words = err.data?.onServer === false ? "Nova Agent is running on the studio PC just now, so the VPS's own views aren't here. Portal's view of the VPS is on the Overview."
      : err.data?.pcOffline || err.status === 503 || err.status === 502 ? "Nova Agent on the VPS isn't answering right now. Try again in a moment."
      : err.message;
    box.innerHTML = `${tabs(part)}${err.offline ? N.oops(err, true) : `<div class="empty">${icon("globe")}<b>Not here just now</b><span>${esc(words)}</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`}`;
  }

  // ================= Files: browse the VPS's folders (read-only; private files show their name only) =================
  const START = "/srv/nova-agent";
  const files = { sort: "name", filter: "", show: 100 };
  const IMG = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i;
  const crumbs = (path, where) => {
    const parts = path.split("/").filter(Boolean);
    let to = "";
    return `<nav class="comp-crumbs" aria-label="Where you are"><a class="chip" href="#computer/${where}" aria-label="The top of the VPS">/</a>${parts.map((name, i) => { to += `/${name}`; return `<span aria-hidden="true">›</span><a class="chip" href="${at(where, to)}"${i === parts.length - 1 ? ' aria-current="page"' : ""}>${esc(name)}</a>`; }).join("")}</nav>`;
  };
  async function drawFiles(box, rest, ui) {
    let path = joinPath(rest);
    if (!rest.length) { try { const p = localStorage.getItem("nova-computer-path"); path = p && p.startsWith("/") ? p : START; } catch (e) { path = START; } }
    let d;
    try { d = await get(`/computer-api/files?path=${encodeURIComponent(path)}`); } catch (err) {
      if (err.admins) return forAdmins(box);
      if (err.signIn || err.offline || err.data?.onServer === false || err.data?.pcOffline || err.status >= 500) return stateTrouble(box, "files", err);
      // (a folder it can't open: said, with the way up)
      box.innerHTML = `${tabs("files")}${crumbs(path, "files")}<p class="comp-warn">${err.message.startsWith("Only root") ? "🔒 " : ""}${esc(err.message)}</p>${path !== "/" ? `<a class="btn wide" href="${at("files", path.replace(/\/[^/]*$/, "") || "/")}">${icon("back")} Up a folder</a>` : ""}`;
      return;
    }
    if (d.onServer === false) return stateTrouble(box, "files", { data: { onServer: false } });
    path = d.path;
    try { localStorage.setItem("nova-computer-path", path); } catch (e) {}
    if (path !== "/") ui.back(at("files", path.replace(/\/[^/]*$/, "") || "/"));
    if (box.dataset.path !== path) files.show = 100;
    box.dataset.path = path;
    box.innerHTML = `${tabs("files")}${crumbs(path, "files")}
      ${d.locked ? `<p class="comp-warn">🔒 Only root can see inside this folder.</p>` : ""}
      ${d.capped ? `<p class="muted small">Showing the first ${d.entries.length} of ${d.total}.</p>` : ""}
      <div class="comp-tools">${field({ label: "Filter this folder", name: "filter", type: "search", value: files.filter, attrs: 'autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="search"' })}
      ${choices({ label: "Sort by", name: "sort", value: files.sort, options: [["name", "Name"], ["size", "Size"], ["modified", "Changed"]] })}</div>
      <div data-part="list"></div><p class="muted small">Only reading: nothing can be changed here.</p>`;
    const paint = () => {
      const f = files.filter.trim().toLowerCase();
      const isDir = (e) => e.kind === "folder" || (e.kind === "link" && e.to === "folder");
      const all = d.entries.filter((e) => !f || e.name.toLowerCase().includes(f)).sort((a, b) => {
        if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
        if (files.sort === "size") return (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name);
        if (files.sort === "modified") return String(b.modified || "").localeCompare(String(a.modified || "")) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
      const shown = all.slice(0, files.show);
      put(box.querySelector('[data-part="list"]'), all.length ? `${list(shown.map((e) => {
        const full = `${path.replace(/\/$/, "")}/${e.name}`;
        const kind = e.locked ? "lock" : e.private ? "hidden" : isDir(e) ? "folder" : e.kind === "link" ? "link" : e.kind === "file" && IMG.test(e.name) ? "image" : e.kind === "file" ? "file" : "other";
        const meta = [e.modified ? london(e.modified, true) : "", e.owner, e.kind === "link" && e.target ? `→ ${e.target}` : ""].filter(Boolean).join(" · ");
        const tag = e.locked ? `<span class="pill warn">Only root</span>` : e.private ? `<span class="pill">Private</span>` : "";
        return row({ href: at(isDir(e) ? "files" : "file", full), lead: ico(kind), title: e.name, text: meta, end: `${e.size == null || isDir(e) ? "" : `<span>${esc(size(e.size))}</span>`}${tag}`, cls: `comp-entry${e.locked ? " comp-locked" : ""}` });
      }))}${all.length > shown.length ? `<button type="button" class="btn wide" data-more>Show ${Math.min(100, all.length - shown.length)} more (${all.length - shown.length} left)</button>` : ""}`
        : empty({ icon: "search", title: f ? "Nothing here matches" : "This folder is empty" }));
    };
    paint();
    const filterEl = box.querySelector("[name=filter]");
    filterEl.addEventListener("input", () => { files.filter = filterEl.value; files.show = 100; paint(); });
    box.querySelectorAll("[name=sort]").forEach((r) => r.addEventListener("change", () => { files.sort = r.value; paint(); }));
    box.addEventListener("click", (e) => { if (e.target.closest("[data-more]")) { files.show += 100; paint(); } });
  }

  // One file: text with its colours, a picture, or why it isn't shown
  async function drawFile(box, rest, ui) {
    const path = joinPath(rest);
    const dir = path.replace(/\/[^/]*$/, "") || "/";
    ui.back(at("files", dir));
    ui.title(path.split("/").pop() || "File");
    const head = (extra) => `<div class="card comp-file-head"><p class="kicker">On the VPS</p><code class="comp-path">${esc(path)}</code>${extra ? `<p class="small muted">${extra}</p>` : ""}</div>`;
    let file;
    try { ({ file } = await get(`/computer-api/file?path=${encodeURIComponent(path)}`)); } catch (err) {
      if (err.admins) return forAdmins(box);
      if (err.signIn || err.offline || err.data?.onServer === false || err.data?.pcOffline || err.status >= 500) return stateTrouble(box, "files", err);
      box.innerHTML = head("") + `<p class="comp-warn">${err.message.startsWith("Only root") ? "🔒 " : err.message.startsWith("Hidden") ? "🙈 " : ""}${esc(err.message)}</p><a class="btn wide" href="${at("files", dir)}">${icon("back")} Back to the folder</a>`;
      return;
    }
    if (file.kind === "hidden") box.innerHTML = head("") + empty({ icon: "user", title: "Hidden: private", text: "Keys, passwords and settings like this show their name only." });
    else if (file.kind === "binary") box.innerHTML = head(esc(size(file.size))) + empty({ icon: "pdf", title: "Not shown", text: file.message || "A binary file (not text), so it isn't shown." });
    else if (file.kind === "image") {
      box.innerHTML = head(`${esc(size(file.size))} · ${esc(london(file.modified, true))}`) + (file.tooBig ? empty({ icon: "star", title: "Too big to show here", text: "That picture is over 5 MB." }) : `<figure class="comp-pic"><img alt="${esc(path)}" data-src="/computer-api/image?path=${encodeURIComponent(path)}"><figcaption class="muted small" hidden>The picture didn't load. Try again in a moment.</figcaption></figure>`);
      const img = box.querySelector("img[data-src]");
      if (img) { img.addEventListener("error", () => { img.hidden = true; img.nextElementSibling.hidden = false; }); img.src = img.dataset.src; }
    } else {
      // (colours for the first 80 KB only, so a big file never holds the phone up; the rest plain)
      const text = String(file.text || "");
      const cut = text.length > 80000;
      box.innerHTML = head(`${esc(size(file.size))} · ${esc(london(file.modified, true))}${file.cut ? " · the first 200 KB" : ""}`) + `<pre class="comp-pre comp-code" tabindex="0">${highlight(cut ? text.slice(0, 80000) : text, file.language)}${cut ? esc(text.slice(80000)) : ""}</pre>${text ? "" : `<p class="muted small">This file is empty.</p>`}`;
    }
  }

  // Syntax colours for the common kinds (plain rules, no library), as on Nova Desk
  const KW = {
    js: "const|let|var|function|return|if|else|for|while|import|export|from|class|new|await|async|try|catch|finally|throw|of|in|typeof|interface|type|extends|default|switch|case|break|continue|true|false|null|undefined",
    py: "def|return|if|elif|else|for|while|import|from|class|try|except|finally|raise|with|as|in|not|and|or|None|True|False|lambda|yield",
    sh: "if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|export|local|set|echo|sudo|cd",
    sql: "SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|ALTER|DROP|JOIN|LEFT|ON|AND|OR|NOT|NULL|PRIMARY|KEY|ORDER|BY|GROUP|LIMIT",
  };
  function rulesFor(lang) {
    const str = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/;
    const num = /\b\d+(?:\.\d+)?\b/;
    const kw = (w, flags = "") => new RegExp(`\\b(?:${w})\\b`, flags);
    switch (lang) {
      case "js": return [[/\/\/[^\n]*|\/\*[\s\S]*?\*\//, "c"], [/`(?:[^`\\]|\\.)*`/, "s"], [str, "s"], [num, "n"], [kw(KW.js), "k"]];
      case "json": return [[/"(?:[^"\\\n]|\\.)*"(?=\s*:)/, "a"], [str, "s"], [num, "n"], [/\b(?:true|false|null)\b/, "k"]];
      case "css": return [[/\/\*[\s\S]*?\*\//, "c"], [str, "s"], [/@[\w-]+/, "h"], [/[\w-]+(?=\s*:)/, "a"], [num, "n"]];
      case "html": return [[/<!--[\s\S]*?-->/, "c"], [/<\/?[A-Za-z][\w:-]*/, "t"], [str, "s"], [/[\w:-]+(?==)/, "a"]];
      case "md": return [[/^#{1,6} [^\n]*/m, "h"], [/`[^`\n]+`/, "s"], [/\*\*[^*\n]+\*\*/, "k"], [/\[[^\]\n]+\]\([^)\n]+\)/, "a"]];
      case "yaml": return [[/#[^\n]*/, "c"], [/^[ \t-]*[\w.-]+(?=:)/m, "a"], [str, "s"], [num, "n"], [/\b(?:true|false|null|yes|no)\b/, "k"]];
      case "conf": return [[/(?:^|[ \t])[#;][^\n]*/m, "c"], [/^\[[^\]\n]+\]/m, "h"], [/^[ \t]*[\w.-]+(?=[ \t]*[=:])/m, "a"], [str, "s"], [num, "n"]];
      case "sh": return [[/(?:^|[ \t])#[^\n]*/m, "c"], [str, "s"], [/\$\{?[\w@#?*!-]+\}?/, "a"], [kw(KW.sh), "k"], [num, "n"]];
      case "py": return [[/#[^\n]*/, "c"], [/"""[\s\S]*?"""|'''[\s\S]*?'''/, "s"], [str, "s"], [num, "n"], [kw(KW.py), "k"]];
      case "sql": return [[/--[^\n]*/, "c"], [str, "s"], [num, "n"], [kw(KW.sql, "i"), "k"]];
      case "log": return [[/\b\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?\b/, "n"], [/\b(?:ERROR|Error|error|FAIL|Failed|failed|fatal|panic)\b/, "t"], [/\b(?:WARN|Warning|warning)\b/, "k"], [str, "s"]];
      default: return [];
    }
  }
  function highlight(text, lang) {
    const rules = rulesFor(lang);
    if (!rules.length) return esc(text);
    const flags = rules.some(([re]) => re.flags.includes("i")) ? "gim" : "gm";
    const all = new RegExp(rules.map(([re]) => `(${re.source})`).join("|"), flags);
    let out = "", last = 0;
    for (let m = all.exec(text); m; m = all.exec(text)) {
      if (!m[0]) { all.lastIndex++; continue; }
      let g = 1;
      while (g <= rules.length && m[g] === undefined) g++;
      out += esc(text.slice(last, m.index)) + `<span class="hl-${rules[g - 1] ? rules[g - 1][1] : ""}">${esc(m[0])}</span>`;
      last = all.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  // ================= Programs: everything running on the VPS (view only), live =================
  const ORDER = ["Nova Bot", "Nova Agent", "Claude", "web", "system"];
  const procs = { sort: "cpu", group: "", filter: "", show: 50 };
  async function drawProgs(box) {
    let d;
    try { d = await get("/computer-api/procs"); } catch (err) { if (err.admins) return forAdmins(box); return stateTrouble(box, "programs", err); }
    if (d.onServer === false) return stateTrouble(box, "programs", { data: { onServer: false } });
    box.innerHTML = `${tabs("programs")}<div class="comp-head"><p class="muted small">Everything running on the VPS. Only looking: nothing here stops a program.</p>${liveChip}</div>
      <div data-part="groups"></div>
      <div class="comp-tools">${field({ label: "Filter programs", name: "filter", type: "search", value: procs.filter, attrs: 'autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="search"' })}
      ${choices({ label: "Sort by", name: "sort", value: procs.sort, options: [["cpu", "CPU"], ["memory", "Memory"]] })}</div>
      <div data-part="list"></div>`;
    const paint = () => {
      const groups = Object.entries(d.groups || {}).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
      put(box.querySelector('[data-part="groups"]'), `<div class="chips" aria-label="Show">${[`<button type="button" class="chip" data-group="" aria-pressed="${!procs.group}">All <span class="n">${d.total}</span></button>`, ...groups.map(([g, v]) => `<button type="button" class="chip" data-group="${esc(g)}" aria-pressed="${procs.group === g}">${esc(g)} <span class="n">${v.count} · ${Math.round(v.cpu)}%</span></button>`)].join("")}</div>`);
      const f = procs.filter.trim().toLowerCase();
      const rows = d.procs.filter((p) => !procs.group || p.group === procs.group).filter((p) => !f || `${p.name} ${p.user} ${p.command} ${p.pid}`.toLowerCase().includes(f))
        .sort((a, b) => (procs.sort === "memory" ? b.memory - a.memory : b.cpu - a.cpu || b.memory - a.memory));
      const shown = rows.slice(0, procs.show);
      put(box.querySelector('[data-part="list"]'), rows.length ? `${list(shown.map((p) => row({
        lead: `<span class="comp-cpu ${p.cpu >= 50 ? "bad" : ""}">${p.cpu.toFixed(1)}%</span>`, title: p.name,
        text: [p.group, p.user, p.started ? `started ${london(p.started)}` : "", `#${p.pid}`].filter(Boolean).join(" · "),
        html: `<code class="comp-cmd">${esc(p.command)}</code>`, end: `<span>${esc(size(p.memory))}</span>`, cls: p.cpu >= 50 ? "comp-hot" : "",
      })))}${rows.length > shown.length ? `<button type="button" class="btn wide" data-more>Show ${Math.min(50, rows.length - shown.length)} more (${rows.length - shown.length} left)</button>` : ""}` : empty({ icon: "search", title: "Nothing matches" }));
    };
    paint();
    const filterEl = box.querySelector("[name=filter]");
    filterEl.addEventListener("input", () => { procs.filter = filterEl.value; procs.show = 50; paint(); });
    box.querySelectorAll("[name=sort]").forEach((r) => r.addEventListener("change", () => { procs.sort = r.value; paint(); }));
    box.addEventListener("click", (e) => {
      const g = e.target.closest("[data-group]");
      if (g) { procs.group = g.dataset.group; procs.show = 50; paint(); }
      if (e.target.closest("[data-more]")) { procs.show += 50; paint(); }
    });
    every(EVERY, async () => {
      if (!box.isConnected) return stop();
      try { d = await get("/computer-api/procs"); paint(); } catch (err) { /* (tried again in 4 s) */ }
    });
  }

  // ================= Disk: which folders fill it (measured slowly in the background, kept 10 minutes) =================
  const ROOTS = ["/", "/srv", "/var", "/home"];
  async function drawDisk(box, rest, ui) {
    const path = joinPath(rest);
    if (path !== "/") ui.back(at("disk", path.replace(/\/[^/]*$/, "") || "/"));
    let d;
    try { d = await get(`/computer-api/disk?path=${encodeURIComponent(path)}`); } catch (err) {
      if (err.admins) return forAdmins(box);
      if (err.signIn || err.offline || err.data?.onServer === false || err.data?.pcOffline || err.status >= 500) return stateTrouble(box, "disk", err);
      box.innerHTML = `${tabs("disk")}${crumbs(path, "disk")}<p class="comp-warn">${esc(err.message)}</p>`;
      return;
    }
    if (d.onServer === false) return stateTrouble(box, "disk", { data: { onServer: false } });
    box.innerHTML = `${tabs("disk")}<p class="muted small">Which folders fill the VPS's disk. Start from:</p>
      <div class="chips">${ROOTS.map((r) => `<a class="chip" href="${at("disk", r)}"${r === path ? ' aria-current="page"' : ""}>${esc(r)}</a>`).join("")}</div>
      ${crumbs(path, "disk")}<div data-part="note"></div><div data-part="list"></div>`;
    const paint = () => {
      const r = d.result;
      put(box.querySelector('[data-part="note"]'), r ? `<p class="small"><b>${esc(size(r.total))}</b> in all · measured ${esc(ago(r.at))}${d.measuring ? " · measuring again…" : ""}${r.partial ? `<br><span class="muted">Some folders only root can read, so sizes may be smaller.</span>` : ""}</p>` : "");
      const max = r ? Math.max(1, ...r.folders.map((x) => x.size)) : 1;
      put(box.querySelector('[data-part="list"]'), r ? (r.folders.length ? list(r.folders.map((x) => row({ href: at("disk", x.path), lead: ico(x.private ? "hidden" : "folder"), title: x.name, end: `<b class="comp-size">${esc(size(x.size))}</b>`, html: `<i class="comp-meter" aria-hidden="true"><i data-w="${((x.size / max) * 100).toFixed(1)}"></i></i>` }))) : empty({ icon: "check", title: "No folders inside this one" }))
        : `<div class="empty">${icon("clock")}<b>Measuring this folder…</b><span>Slowly, so the VPS stays quick. It shows here by itself.</span></div>`);
    };
    paint();
    // (while it measures: asked again every 3 seconds, as on Nova Desk)
    if (d.measuring || !d.result) every(3000, async () => {
      if (!box.isConnected) return stop();
      try { d = await get(`/computer-api/disk?path=${encodeURIComponent(path)}`); paint(); if (!d.measuring && d.result) stop(); } catch (err) { /* (tried again) */ }
    });
  }
})();
