// Computer: the VPS at a glance (src/computer.ts gives everything in one go: /computer-api/state).
// Every 4 seconds while it's on screen; paused while hidden. Read-only: it never types into a
// session, restarts or changes anything. Times are shown in the UK's time.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const EVERY = 4000;
  const london = (iso, withDay) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const opts = { timeZone: "Europe/London", hour: "numeric", minute: "2-digit" };
    const sameDay = d.toLocaleDateString("en-GB", { timeZone: "Europe/London" }) === new Date().toLocaleDateString("en-GB", { timeZone: "Europe/London" });
    if (withDay || !sameDay) Object.assign(opts, { weekday: "short", day: "numeric", month: "short" });
    return d.toLocaleString("en-GB", opts).replace(",", "");
  };
  const ago = (iso) => {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(s)) return "";
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };
  const length = (secs) => {
    const s = Math.max(0, Math.round(secs || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };
  const size = (b) => {
    if (!Number.isFinite(b)) return "–";
    const g = b / 1024 ** 3;
    return g >= 10 ? `${Math.round(g)} GB` : g >= 1 ? `${g.toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
  };

  let state = null;
  let picked = null; // "screen:<id>" or "job:<id>"
  let timer = null;
  let busy = false;
  let stickToBottom = true;

  const term = $("term");
  term.addEventListener("scroll", () => {
    stickToBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 24;
  });

  function say(text, bad) {
    const m = $("message");
    m.textContent = text;
    m.classList.toggle("bad", !!bad);
    m.hidden = !text;
  }

  async function load() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch("/computer-api/state", { cache: "no-store", credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (res.status === 403) {
        $("board").hidden = true;
        say("Computer is for admins. Sign in as an admin with Portal (the planet, top right).", true);
        return;
      }
      if (!res.ok || !data || data.ok === false) {
        say(data?.pcOffline || data?.error ? "Nova Agent on the VPS isn't answering right now. It tries again by itself." : data?.message || "Couldn't read the VPS just now. Trying again…", true);
        return;
      }
      if (data.onServer === false) {
        $("board").hidden = true;
        say(data.message || "Open this on the VPS's Nova.");
        return;
      }
      say("");
      state = data;
      $("board").hidden = false;
      draw();
    } catch {
      say("No connection right now. Trying again…", true);
    } finally {
      busy = false;
    }
  }

  // ================= Drawing =================
  function draw() {
    drawTabs();
    drawTerm();
    drawJobs();
    drawClaude();
    drawVps();
    drawNova();
  }

  function drawTabs() {
    const screens = state.screens || [];
    if (!picked || (picked.startsWith("screen:") && !screens.some((s) => `screen:${s.id}` === picked) && !(state.jobs || []).length)) {
      picked = screens.length ? `screen:${(screens.find((s) => s.session === "nova-vps") || screens[0]).id}` : (state.jobs || [])[0] ? `job:${state.jobs[0].id}` : null;
    }
    if (picked && picked.startsWith("screen:") && !screens.some((s) => `screen:${s.id}` === picked)) picked = screens[0] ? `screen:${screens[0].id}` : null;
    const tabs = $("screen-tabs");
    tabs.innerHTML = screens.length
      ? screens.map((s) => `<button type="button" role="tab" data-pick="screen:${esc(s.id)}" aria-selected="${picked === `screen:${s.id}`}"><span class="tab-dot on" aria-hidden="true"></span>${esc(s.title)}</button>`).join("")
      : `<span class="jobs-empty">${state.claude?.tmux ? "No sessions open on the VPS right now." : "The VPS's sessions can't be seen from here."}</span>`;
  }

  function drawTerm() {
    let html = "";
    if (picked && picked.startsWith("screen:")) {
      const s = (state.screens || []).find((x) => `screen:${x.id}` === picked);
      html = s ? s.html || `<span class="empty">This session's screen is empty.</span>` : "";
    } else if (picked && picked.startsWith("job:")) {
      const j = (state.jobs || []).find((x) => `job:${x.id}` === picked);
      html = j ? (j.tail ? esc(j.tail) : `<span class="empty">${j.running ? "Working… its words show here when it finishes a step." : "This job didn't write anything."}</span>`) : "";
    }
    if (!html) html = `<span class="empty">Nothing to show yet.</span>`;
    if (term.innerHTML !== html) {
      term.innerHTML = html;
      if (stickToBottom) term.scrollTop = term.scrollHeight;
    }
  }

  function drawJobs() {
    const jobs = state.jobs || [];
    $("jobs").innerHTML = jobs.length
      ? jobs
          .map((j) => {
            const chip = j.running ? `<span class="nt-chip warn">Working</span>` : j.exit === 0 ? `<span class="nt-chip ok">Done</span>` : `<span class="nt-chip bad">Stopped</span>`;
            const when = j.running ? `${length(j.seconds)} so far` : `${london(j.finished || j.started)} · ${length(j.seconds)}`;
            return `<li><button type="button" class="job" data-pick="job:${esc(j.id)}" aria-pressed="${picked === `job:${j.id}`}">${chip}<span class="job-name">${esc(j.name)}</span><span class="job-time">${esc(when)}</span><span class="job-task" title="${esc(j.task)}">${esc(j.task.split("\n")[0])}</span></button></li>`;
          })
          .join("")
      : `<li class="jobs-empty">No jobs yet. Jobs handed to the VPS show here.</li>`;
  }

  function fact(label, value, cls) {
    return `<dt>${esc(label)}</dt><dd${cls ? ` class="${cls}"` : ""}>${esc(value)}</dd>`;
  }
  function drawClaude() {
    const c = state.claude || {};
    $("claude-facts").innerHTML = [
      fact("Version", c.version || "–"),
      fact("Signed in", c.signedIn ? "Yes" : "No", c.signedIn ? "ok" : "bad"),
      fact("Nova-VPS", c.remote ? "Connected" : "Not connected", c.remote ? "ok" : "warn"),
      fact("Jobs working", String(c.running ?? 0), c.running ? "warn" : ""),
      fact("Finished today", String(c.finishedToday ?? 0)),
    ].join("");
    const h = c.handoff;
    $("handoff").hidden = !h;
    if (h) {
      $("handoff-h").textContent = h.heading;
      $("handoff-text").textContent = h.text;
    }
  }

  function gauge(label, big, small, pct) {
    const cls = pct >= 90 ? "bad" : pct >= 75 ? "warn" : "";
    return `<div class="gauge"><span class="nt-label">${esc(label)}</span><b class="${cls}">${esc(big)}</b><small>${esc(small)}</small>${Number.isFinite(pct) ? `<span class="bar" aria-hidden="true"><i style="width:${Math.max(2, Math.min(100, pct))}%"></i></span>` : ""}</div>`;
  }
  function spark(kind, label, points, key) {
    const vals = points.map((p) => p[key]);
    const n = vals.length;
    const now = n ? vals[n - 1] : null;
    let path = "";
    if (n >= 2) {
      const xy = vals.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(40 - (Math.max(0, Math.min(100, v)) / 100) * 38).toFixed(2)}`);
      path = `<path class="area" d="M0,40 L${xy.join(" L")} L100,40 Z"/><polyline class="line" points="${xy.join(" ")}"/>`;
    }
    return `<div class="spark ${kind}"><span class="nt-label"><span>${esc(label)} · 30 min</span><span>${now == null ? "–" : `${now}%`}</span></span><svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(label)} over the last half hour">${path || `<text x="50" y="24" text-anchor="middle" font-size="9" fill="currentColor" opacity=".5">Gathering…</text>`}</svg></div>`;
  }
  function drawVps() {
    const v = state.vps || {};
    const mem = v.memory;
    const disk = v.disk;
    const memPct = mem ? Math.round((mem.used / mem.total) * 100) : NaN;
    const diskPct = disk ? Math.round(((disk.total - disk.free) / disk.total) * 100) : NaN;
    const days = Math.floor((v.uptimeSeconds || 0) / 86400);
    const hours = Math.floor(((v.uptimeSeconds || 0) % 86400) / 3600);
    $("gauges").innerHTML = [
      gauge("CPU", v.cpu == null ? "–" : `${v.cpu}%`, `load ${(v.load || [])[0] ?? "–"} · ${v.cpus || "?"} cores`, v.cpu),
      gauge("Memory", Number.isFinite(memPct) ? `${memPct}%` : "–", mem ? `${size(mem.used)} of ${size(mem.total)}` : "", memPct),
      gauge("Disk", Number.isFinite(diskPct) ? `${diskPct}%` : "–", disk ? `${size(disk.free)} free` : "", diskPct),
      gauge("Up for", days ? `${days}d ${hours}h` : `${hours}h`, "since its last restart", NaN),
    ].join("");
    const hist = v.history || [];
    $("sparks").innerHTML = spark("cpu", "CPU", hist, "cpu") + spark("mem", "Memory", hist, "mem");
    const NICE = { active: "Running", inactive: "Stopped", failed: "Failed", activating: "Starting", reloading: "Reloading" };
    $("services").innerHTML = (v.services || []).map((s) => `<li><span class="dot ${esc(s.state)}" aria-hidden="true"></span><span class="what"><b>${esc(s.name)}</b><small>${esc(NICE[s.state] || s.state)}</small></span></li>`).join("");
  }

  function drawNova() {
    const n = state.suite || {};
    const o = $("overall");
    o.textContent = n.overall || (n.ok == null ? "The status page didn't answer just now." : "");
    o.className = `overall${n.ok === true ? " ok" : n.ok === false ? " bad" : ""}`;
    $("parts").innerHTML = (n.parts || []).map((p) => `<li><span class="dot ${esc(p.state)}" aria-hidden="true"></span><span class="what"><b>${esc(p.name)}</b><small>${esc(p.text)}</small></span></li>`).join("");
    $("deploys").innerHTML = (n.deploys || []).length
      ? n.deploys.map((d) => `<li><span class="repo">${esc(d.repo)}</span><span class="subj" title="${esc(d.subject)}">${esc(d.subject)}</span><time datetime="${esc(d.at)}">${esc(london(d.at))}</time></li>`).join("")
      : `<li class="jobs-empty">No updates found.</li>`;
    const f = n.fixer;
    $("fixer").innerHTML = f
      ? `<span class="grow"><b>Fixer</b> · ${f.needsYou ? `<strong>${f.needsYou} waiting for you</strong>` : "nothing waiting for you"}<br><small class="nt-note">Last check ${f.lastCheck ? esc(ago(f.lastCheck)) : "–"} · looks check ${f.looksAt ? `${esc(ago(f.looksAt))}${f.looksFailed ? `, ${f.looksFailed} problem${f.looksFailed === 1 ? "" : "s"}` : ", all fine"}` : "–"}</small></span><a class="btn primary" href="/agent/fixer" target="_top">Open the Fixer</a>`
      : `<span class="grow"><b>Fixer</b> · not running here</span>`;
    $("backup").innerHTML = n.backup ? `Last backup: <strong>${esc(london(n.backup.last, true))}</strong> (${esc(ago(n.backup.last))})` : "Last backup: not known from here.";
  }

  // ================= Taps =================
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (!b) return;
    picked = b.dataset.pick;
    stickToBottom = true;
    if (state) {
      drawTabs();
      drawJobs();
      drawTerm();
    }
  });

  // ================= Live while it's on screen =================
  function tick() {
    clearTimeout(timer);
    // (hidden, or a kept-loaded panel that isn't the one showing: its frame has no size)
    if (document.visibilityState !== "visible" || !innerWidth || !innerHeight) {
      $("live-chip").textContent = "Paused";
      $("live-chip").classList.add("paused");
      return;
    }
    $("live-chip").textContent = "Live";
    $("live-chip").classList.remove("paused");
    load().finally(() => {
      timer = setTimeout(tick, EVERY);
    });
  }
  document.addEventListener("visibilitychange", tick);
  addEventListener("resize", () => {
    if (innerWidth && innerHeight && $("live-chip").classList.contains("paused")) tick();
  });
  tick();
})();
