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

  // ================= The parts: Screen · Files · Programs · Disk =================
  // Computer opens on the VPS's desktop (the chips switch to the other parts)
  let part = "desktop";
  function showPart(p) {
    part = p;
    for (const b of document.querySelectorAll("[data-part]")) b.setAttribute("aria-selected", String(b.dataset.part === p));
    for (const id of ["desktop", "screen", "files", "programs", "disk"]) $(`part-${id}`).hidden = id !== p;
    if (p === "desktop") desktop.open();
    else desktop.close();
    if (p === "files" && !files.loaded) openFolder(files.path);
    if (p === "programs") loadProcs();
    if (p === "disk") loadDisk(disk.path);
  }

  async function api(url) {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    const data = await res.json().catch(() => null);
    if (!data) throw new Error(res.status === 403 ? "Computer is for admins." : "No answer just now. Try again in a moment.");
    if (data.ok === false) throw new Error(data.message || "Couldn't read that.");
    return data;
  }
  const q = (path) => encodeURIComponent(path);
  function crumbs(el, path, attr) {
    const parts = path.split("/").filter(Boolean);
    let at = "";
    el.innerHTML = [
      `<button type="button" ${attr}="/" aria-label="The top of the VPS">/</button>`,
      ...parts.map((name) => {
        at += `/${name}`;
        return `<button type="button" ${attr}="${esc(at)}">${esc(name)}</button>`;
      }),
    ].join(`<span class="sep" aria-hidden="true">›</span>`);
  }

  // ---- Desktop: noVNC (/vps-desktop/, admins only), loaded only while this part is open ----
  const desktop = {
    control: false,
    url() {
      return `/vps-desktop/vnc.html?path=vps-desktop/websockify&autoconnect=1&reconnect=1&resize=scale&view_only=${this.control ? 0 : 1}&show_dot=1`;
    },
    open() {
      const f = $("desk-frame");
      const want = this.url();
      if (f.dataset.src === want) return;
      f.hidden = true;
      $("desk-wait").hidden = false;
      f.dataset.src = want;
      f.src = want;
    },
    close() {
      const f = $("desk-frame");
      if (!f.dataset.src) return;
      f.dataset.src = "";
      f.src = "about:blank";
      f.hidden = true;
      $("desk-wait").hidden = false;
    },
    setControl(on) {
      this.control = on;
      for (const b of document.querySelectorAll("#desk-mode [data-mode]")) b.setAttribute("aria-pressed", String((b.dataset.mode === "control") === on));
      $("desk-warn").hidden = !on;
      $("desk-box").classList.toggle("control", on);
      if (part === "desktop") this.open();
    },
  };
  $("desk-frame").addEventListener("load", () => {
    const f = $("desk-frame");
    if (!f.dataset.src) return;
    f.hidden = false;
    $("desk-wait").hidden = true;
  });
  $("desk-full").addEventListener("click", () => {
    const box = $("desk-box");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
  });

  // ---- Files ----
  const files = { path: "/srv/nova-agent", entries: [], loaded: false, sort: "name", open: null };
  try {
    const p = localStorage.getItem("nova-computer-path");
    if (p && p.startsWith("/")) files.path = p;
  } catch {}
  const ICONS = { folder: "📁", file: "📄", link: "↪", other: "◇" };
  const IMG = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp)$/i;
  async function openFolder(path) {
    const note = $("files-note");
    try {
      const d = await api(`/computer-api/files?path=${q(path)}`);
      files.path = d.path;
      files.entries = d.entries;
      files.loaded = true;
      try {
        localStorage.setItem("nova-computer-path", d.path);
      } catch {}
      crumbs($("crumbs"), d.path, "data-dir");
      note.hidden = !(d.locked || d.capped);
      note.className = `fx-note${d.locked ? " bad" : ""}`;
      note.textContent = d.locked ? "🔒 Only root can see inside this folder." : d.capped ? `Showing the first ${d.entries.length} of ${d.total}.` : "";
      $("files-filter").value = "";
      drawFiles();
    } catch (err) {
      note.hidden = false;
      note.className = "fx-note bad";
      note.textContent = `${err.message.startsWith("Only root") ? "🔒 " : ""}${err.message}`;
      if (!files.loaded && path !== "/") return openFolder("/");
    }
  }
  function drawFiles() {
    const f = $("files-filter").value.trim().toLowerCase();
    const list = files.entries.filter((e) => !f || e.name.toLowerCase().includes(f));
    const isDir = (e) => e.kind === "folder" || (e.kind === "link" && e.to === "folder");
    list.sort((a, b) => {
      if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
      if (files.sort === "size") return (b.size ?? -1) - (a.size ?? -1) || a.name.localeCompare(b.name);
      if (files.sort === "modified") return String(b.modified || "").localeCompare(String(a.modified || "")) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    $("files-list").innerHTML = list.length
      ? list
          .map((e) => {
            const ico = e.locked ? "🔒" : e.private ? "🙈" : e.kind === "file" && IMG.test(e.name) ? "🖼" : ICONS[e.kind] || "◇";
            const tag = e.locked ? `<span class="tag">Only root</span>` : e.private ? `<span class="tag">Private</span>` : "";
            const full = `${files.path.replace(/\/$/, "")}/${e.name}`;
            const meta = [e.modified ? london(e.modified, true) : "", e.owner, e.kind === "link" && e.target ? `→ ${e.target}` : ""].filter(Boolean).join(" · ");
            return `<li><button type="button" class="fx-item${e.locked ? " locked" : ""}${e.private ? " private" : ""}" data-entry="${esc(full)}" data-isdir="${isDir(e) ? "1" : ""}" aria-current="${files.open === full}"><span class="ico" aria-hidden="true">${ico}</span><span class="nm">${esc(e.name)}${tag}</span><span class="sz">${e.size == null ? "" : esc(size(e.size))}</span><span class="mt">${esc(meta)}</span></button></li>`;
          })
          .join("")
      : `<li class="fx-empty">${f ? "Nothing here matches." : "This folder is empty."}</li>`;
  }
  async function openFile(path) {
    files.open = path;
    drawFiles();
    const v = $("file-view");
    v.innerHTML = `<p class="fx-empty nt-loading">Opening…</p>`;
    const head = (extra) => `<div class="fx-head"><b>${esc(path)}</b><span>${extra}</span></div>`;
    try {
      const { file } = await api(`/computer-api/file?path=${q(path)}`);
      if (file.kind === "hidden") v.innerHTML = head("") + `<p class="fx-empty">🙈 <b>Hidden: private.</b><br>Keys, passwords and settings like this show their name only.</p>`;
      else if (file.kind === "binary") v.innerHTML = head(esc(size(file.size))) + `<p class="fx-empty">${esc(file.message)}</p>`;
      else if (file.kind === "image")
        v.innerHTML = head(`${esc(size(file.size))} · ${esc(london(file.modified, true))}`) + (file.tooBig ? `<p class="fx-empty">That picture is too big to show here (over 5 MB).</p>` : `<div class="pic"><img alt="${esc(path)}" src="/computer-api/image?path=${q(path)}"></div>`);
      else v.innerHTML = head(`${esc(size(file.size))} · ${esc(london(file.modified, true))}${file.cut ? " · the first 200 KB" : ""}`) + `<pre class="code" tabindex="0">${highlight(file.text, file.language)}</pre>`;
    } catch (err) {
      v.innerHTML = head("") + `<p class="fx-empty">${err.message.startsWith("Only root") ? "🔒 " : ""}${esc(err.message)}</p>`;
    }
  }

  // Syntax colours for the common kinds (plain rules, no library): comments, strings, numbers, keywords, keys
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
    if (!rules.length || text.length > 400000) return esc(text);
    const flags = rules.some(([re]) => re.flags.includes("i")) ? "gim" : "gm";
    const all = new RegExp(rules.map(([re]) => `(${re.source})`).join("|"), flags);
    let out = "";
    let last = 0;
    for (let m = all.exec(text); m; m = all.exec(text)) {
      if (!m[0]) {
        all.lastIndex++;
        continue;
      }
      let g = 1;
      while (g <= rules.length && m[g] === undefined) g++;
      out += esc(text.slice(last, m.index)) + `<span class="${rules[g - 1] ? rules[g - 1][1] : ""}">${esc(m[0])}</span>`;
      last = all.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  // ---- Programs ----
  const procs = { sort: "cpu", group: "", data: null };
  let busyProcs = false;
  async function loadProcs() {
    if (busyProcs) return;
    busyProcs = true;
    try {
      procs.data = await api("/computer-api/procs");
      drawProcs();
    } catch (err) {
      $("procs").innerHTML = `<tr><td colspan="7" class="fx-note bad">${esc(err.message)}</td></tr>`;
    } finally {
      busyProcs = false;
    }
  }
  const ORDER = ["Nova Bot", "Nova Agent", "Claude", "web", "system"];
  function drawProcs() {
    const d = procs.data;
    if (!d) return;
    const groups = Object.entries(d.groups || {}).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
    $("proc-groups").innerHTML = [
      `<button type="button" data-group="" aria-pressed="${!procs.group}">All<small>${d.total}</small></button>`,
      ...groups.map(([g, v]) => `<button type="button" data-group="${esc(g)}" aria-pressed="${procs.group === g}">${esc(g)}<small>${v.count} · ${Math.round(v.cpu)}%</small></button>`),
    ].join("");
    const f = $("proc-filter").value.trim().toLowerCase();
    const rows = d.procs
      .filter((p) => !procs.group || p.group === procs.group)
      .filter((p) => !f || `${p.name} ${p.user} ${p.command} ${p.pid}`.toLowerCase().includes(f))
      .sort((a, b) => (procs.sort === "memory" ? b.memory - a.memory : b.cpu - a.cpu || b.memory - a.memory))
      .slice(0, 400);
    $("procs").innerHTML = rows.length
      ? rows.map((p) => `<tr class="${p.cpu >= 50 ? "hot" : ""}"><td class="nm">${esc(p.name)}</td><td class="gp">${esc(p.group)}</td><td class="us">${esc(p.user)}</td><td class="num">${p.cpu.toFixed(1)}%</td><td class="num">${esc(size(p.memory))}</td><td class="st">${p.started ? esc(london(p.started)) : ""}</td><td class="cmd" title="${esc(p.command)}">${esc(p.command)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="fx-note">Nothing matches.</td></tr>`;
  }

  // ---- Disk ----
  const disk = { path: "/", timer: null };
  async function loadDisk(path) {
    clearTimeout(disk.timer);
    disk.path = path;
    for (const b of document.querySelectorAll("[data-root]")) b.setAttribute("aria-pressed", String(b.dataset.root === path));
    crumbs($("disk-crumbs"), path, "data-disk");
    const note = $("disk-note");
    try {
      const d = await api(`/computer-api/disk?path=${q(path)}`);
      const r = d.result;
      if (r) {
        const max = Math.max(1, ...r.folders.map((x) => x.size));
        $("disk-list").innerHTML = r.folders.length
          ? r.folders.map((x) => `<li><button type="button" class="dk-row" data-disk="${esc(x.path)}"><span class="nm">${x.private ? "🙈 " : "📁 "}${esc(x.name)}</span><span class="sz">${esc(size(x.size))}</span><span class="bar" aria-hidden="true"><i style="width:${Math.max(1, (x.size / max) * 100).toFixed(1)}%"></i></span></button></li>`).join("")
          : `<li class="fx-empty">No folders inside this one.</li>`;
      } else $("disk-list").innerHTML = `<li class="fx-empty nt-loading">Measuring this folder… (slowly, so the VPS stays quick)</li>`;
      note.className = "fx-note";
      note.textContent = r ? `${size(r.total)} in all · measured ${ago(r.at)}${d.measuring ? " · measuring again…" : ""}${r.partial ? " · some folders only root can read, so sizes may be smaller" : ""}` : "";
      if (d.measuring && part === "disk") disk.timer = setTimeout(() => loadDisk(disk.path), 3000);
    } catch (err) {
      note.className = "fx-note bad";
      note.textContent = err.message;
    }
  }

  // ================= Taps =================
  $("files-filter").addEventListener("input", drawFiles);
  $("proc-filter").addEventListener("input", drawProcs);
  document.addEventListener("click", (e) => {
    const t = e.target;
    const partBtn = t.closest("[data-part]");
    if (partBtn) return showPart(partBtn.dataset.part);
    const mode = t.closest("#desk-mode [data-mode]");
    if (mode) return desktop.setControl(mode.dataset.mode === "control");
    const crumb = t.closest("[data-dir]");
    if (crumb) return openFolder(crumb.dataset.dir);
    const entry = t.closest("[data-entry]");
    if (entry) return entry.dataset.isdir ? openFolder(entry.dataset.entry) : openFile(entry.dataset.entry);
    const fs = t.closest("#files-sort [data-sort]");
    if (fs) {
      files.sort = fs.dataset.sort;
      for (const b of document.querySelectorAll("#files-sort [data-sort]")) b.setAttribute("aria-pressed", String(b === fs));
      return drawFiles();
    }
    const ps = t.closest("#proc-sort [data-sort]");
    if (ps) {
      procs.sort = ps.dataset.sort;
      for (const b of document.querySelectorAll("#proc-sort [data-sort]")) b.setAttribute("aria-pressed", String(b === ps));
      return drawProcs();
    }
    const g = t.closest("[data-group]");
    if (g) {
      procs.group = g.dataset.group;
      return drawProcs();
    }
    const root = t.closest("[data-root]");
    if (root) return loadDisk(root.dataset.root);
    const dk = t.closest("[data-disk]");
    if (dk) return loadDisk(dk.dataset.disk);
    const b = t.closest("[data-pick]");
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
    Promise.all([load(), part === "programs" ? loadProcs() : null]).finally(() => {
      timer = setTimeout(tick, EVERY);
    });
  }
  document.addEventListener("visibilitychange", tick);
  addEventListener("resize", () => {
    if (innerWidth && innerHeight && $("live-chip").classList.contains("paused")) tick();
  });
  showPart(part);
  tick();
})();
