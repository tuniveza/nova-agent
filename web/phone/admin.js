// Nova Phone: the admin places (Nova Desk's Portal → Admin, and Computer, Fixer, Visualizer). For admins;
// anyone else is told it's for admins.
//   Google       connected or not; each part on or off, sync now; Drive, Sheets, Calendar, Contacts links
//   Computer     the server: health, memory, disk, backups, jobs, problems; back up now, restart (two steps)
//   Test stuff   what looks like a test, and why: delete (with what goes with it), not a test, put back
//   Fixer        the four rules on every screen: problems by place, a check now
//   Visualizer   Nova Agent's helper for Acuity: its tasks, run one, the steps as they happen
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, choose, busy, ago } = N;
  const A = "/app/api/";
  const HDR = { "X-Nova-Visualizer": "1" };
  const adminsOnly = (err) => err && err.status === 403;
  const forAdmins = (box) => (box.innerHTML = empty({ icon: "user", title: "This is for admins", text: "Ask an admin, or sign in as one." }));
  const pcOff = (box, what) => (box.innerHTML = `<div class="empty">${icon("globe")}<b>The studio's computer is off</b><span>${esc(what)} lives on it. Try again when it's back.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`);
  const gb = (b) => `${(b / 1e9).toFixed(1)} GB`;
  const meter = (label, used, total, words) => `<div class="meter"><div class="meter-top"><span>${esc(label)}</span><b>${esc(words)}</b></div><i class="bar" data-w="${Math.round((used / Math.max(1, total)) * 100)}"></i></div>`;
  const widths = (box) => box.querySelectorAll(".bar[data-w]").forEach((b) => b.style.setProperty("width", `${b.dataset.w}%`));

  // ---- Google ----
  N.section({
    id: "google", name: "Google", tile: "portal",
    async draw(box, path, ui) {
      let g;
      try { g = await api(`${A}google`); } catch (err) { if (adminsOnly(err)) return forAdmins(box); throw err; }
      const st = g.status || {};
      box.innerHTML = `<div class="card"><p class="kicker">${g.connected ? "Connected" : "Not connected"}</p><h2 class="card-title">${g.connected ? `Connected as ${esc(g.account || "")} ✓` : g.hasKey ? "One step left: connect Google" : "Google isn't set up yet"}</h2>
          ${g.needsReconnect ? `<p class="warn small">Google needs connecting again${g.missing?.length ? ` (for ${esc(g.missing.join(", "))})` : ""}.</p>` : ""}</div>
        ${!g.connected || g.needsReconnect ? `<button type="button" class="btn main wide" data-g="connect">Connect Google</button>${!g.hasKey ? `<p class="muted small">The first set-up (Google's keys) is done once, on Nova Desk: Portal → Admin → Google.</p>` : ""}` : ""}
        ${(g.parts || []).length ? `<h3 class="h">What's kept in step</h3><div class="form">${g.parts.map((p) => `<label class="switch"><span>${esc(p.label)}<small class="muted">${esc([p.help, st[p.id]?.last ? `last ${ago(st[p.id].last)}` : "", st[p.id]?.error].filter(Boolean).join(" · "))}</small></span><input type="checkbox" role="switch" data-part="${esc(p.id)}"${p.on ? " checked" : ""}${p.allowed === false ? " disabled" : ""}></label>`).join("")}</div>
          <button type="button" class="btn wide" data-g="sync">${icon("refresh")} Sync now</button>` : ""}
        <div class="btns two">${[["Drive folder", g.folderUrl], ["Money sheet", g.sheetUrl]].filter(([, u]) => u).map(([l, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join("")}</div>
        ${g.connected ? `<button type="button" class="btn quiet wide" data-g="disconnect">Disconnect Google</button>` : ""}`;
      box.querySelectorAll("[data-part]").forEach((c) => c.addEventListener("change", async () => { try { await post(`${A}google/options`, { changes: { [c.dataset.part]: c.checked } }); toast(c.checked ? "On" : "Off"); } catch (err) { c.checked = !c.checked; toast(err.message, true); } }));
      box.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", async () => {
        const what = b.dataset.g;
        try {
          if (what === "connect") { const r = await post(`${A}google/connect-link`, { popup: false }); location.href = r.url; return; }
          if (what === "sync") { await post(`${A}google/sync`, {}); toast("Syncing: it takes a minute"); }
          if (what === "disconnect") { if (!(await confirm({ title: "Disconnect Google?", text: "Nothing more is kept in step until it's connected again.", ok: "Disconnect", danger: true }))) return; await post(`${A}google/disconnect`, {}); toast("Disconnected"); }
          N.show();
        } catch (err) { toast(err.message, true); }
      }));
    },
  });

  // ---- Computer: the server ----
  N.section({
    id: "computer", name: "Computer", tile: "computer",
    async draw(box, path, ui) {
      let d;
      try { d = await api(`${A}desk`); } catch (err) { if (adminsOnly(err)) return forAdmins(box); throw err; }
      const v = d.vps || {}, h = d.here || {}, svc = v.services || {};
      const on = (n) => /active|running|on/i.test(String(svc[n] ?? ""));
      box.innerHTML = `<div class="card"><p class="kicker">${v.reachable ? "Running" : "Can't reach it"}</p><h2 class="card-title">${esc(v.host || "The server")}</h2>
          <div class="facts">${[["Up for", v.uptimeSeconds ? `${Math.floor(v.uptimeSeconds / 86400)} days ${Math.floor((v.uptimeSeconds % 86400) / 3600)} h` : ""], ["Version", v.version || h.version], ["Nova Bot since", ago(v.novaSince)], ["Nova Agent since", ago(v.agentSince)], ["Last backup", ago(v.lastBackup)], ["Last data copy", ago(v.lastSync)], ["Why not", v.reason]].filter(([, x]) => x).map(([k, x]) => `<div class="fact"><span>${k}</span><b>${esc(x)}</b></div>`).join("")}</div></div>
        ${v.cpu || v.memory || v.disk ? `<div class="card">${v.cpu ? `<p class="small"><b>${esc(v.cpu.count)} processors</b> · busy ${esc((v.cpu.load || []).join(" · "))}</p>` : ""}${v.memory ? meter("Memory", v.memory.total - v.memory.free, v.memory.total, `${gb(v.memory.total - v.memory.free)} of ${gb(v.memory.total)}`) : ""}${v.disk ? meter("Disk", v.disk.total - v.disk.free, v.disk.total, `${gb(v.disk.free)} free of ${gb(v.disk.total)}`) : ""}</div>` : ""}
        ${Object.keys(svc).length ? `<h3 class="h">Services</h3>${list(Object.keys(svc).map((n) => row({ icon: on(n) ? "check" : "globe", title: n.replace(/\.(service|timer)$/, ""), end: `<span class="pill ${on(n) ? "ok" : "warn"}">${esc(svc[n])}</span>` })))}` : ""}
        ${(h.jobs || []).length ? `<h3 class="h">Jobs: last run</h3>${list(h.jobs.slice(0, 14).map((j) => row({ icon: "clock", title: j.name, text: `${ago(j.at)}${j.note ? ` · ${j.ok ? "" : "Problem: "}${j.note}` : ""}` })))}` : ""}
        ${(v.problems || []).length ? `<h3 class="h">Recent problems</h3><div class="card">${v.problems.slice(-8).map((p) => `<p class="small pre">${esc(p)}</p>`).join("")}</div>` : ""}
        ${d.canAct ? `<div class="btns two"><button type="button" class="btn" data-do="backup">Back up now</button><button type="button" class="btn" data-do="restart">Restart Nova Bot</button><button type="button" class="btn" data-do="restart-agent">Restart Nova Agent</button><button type="button" class="btn" data-do="restart-web">Restart the web front</button></div>` : `<p class="muted small">Backups and restarts need an admin signed in on this phone's browser.</p>`}`;
      widths(box);
      box.querySelectorAll("[data-do]").forEach((b) => b.addEventListener("click", async () => {
        const what = b.dataset.do;
        if (what !== "backup" && !(await confirm({ title: `${b.textContent}?`, text: "Nova is unreachable for a few seconds.", ok: b.textContent }))) return;
        await busy(b, "…", async () => { try { await post(`${A}desk/action`, { do: what }); toast(what === "backup" ? "Backing up" : "Restarting"); } catch (err) { toast(err.message, true); } });
      }));
    },
  });

  // ---- Test stuff ----
  N.section({
    id: "tests", name: "Test stuff", tile: "portal",
    async draw(box, path, ui) {
      let r;
      try { r = await api(`${A}tidy`); } catch (err) { if (adminsOnly(err)) return forAdmins(box); throw err; }
      const items = r.items || [];
      const likely = items.filter((x) => x.sure === "likely" || x.likely), maybe = items.filter((x) => !likely.includes(x));
      const tRow = (x) => `<div class="card"><p class="kicker">${esc(x.kind || "")} · ${likely.includes(x) ? "Likely a test" : "Maybe"}</p><p><b>${esc(x.title || "")}</b></p><p class="muted small">${esc([x.where, x.made ? `made ${ago(x.made)}` : "", x.by].filter(Boolean).join(" · "))}</p>${(x.why || x.reasons || []).length ? `<p class="small">Why: ${esc((x.why || x.reasons).join("; "))}</p>` : ""}${(x.together || []).length ? `<p class="small muted">Goes with it: ${esc(x.together.map((t) => t.title).join(", "))}</p>` : ""}
        <div class="btns two"><button type="button" class="btn danger" data-t="delete" data-key="${esc(x.key)}">${icon("trash")} Delete</button><button type="button" class="btn" data-t="real" data-key="${esc(x.key)}">Not a test</button></div></div>`;
      box.innerHTML = `${likely.length ? `<button type="button" class="btn danger wide" data-t="all">${icon("trash")} Delete all ${likely.length} likely tests</button><h3 class="h">Likely tests · ${likely.length}</h3>${likely.map(tRow).join("")}` : ""}
        ${maybe.length ? `<h3 class="h">Maybe · ${maybe.length}</h3>${maybe.map(tRow).join("")}` : ""}
        ${!items.length ? empty({ icon: "check", title: "Nothing looks like a test" }) : ""}
        ${(r.recent || []).length ? `<h3 class="h">Recently deleted</h3>${list(r.recent.map((x) => row({ icon: "trash", title: x.title, text: ago(x.at), end: `<button type="button" class="btn quiet" data-restore="${esc(x.binId)}">Put back</button>` })))}` : ""}
        ${(r.real || []).length ? `<h3 class="h">Marked as real</h3>${list(r.real.map((x) => row({ icon: "check", title: x.title, end: `<button type="button" class="btn quiet" data-unreal="${esc(x.key)}">Undo</button>` })))}` : ""}`;
      const byKey = (k) => items.find((x) => x.key === k);
      const del = async (list_) => { const res = await post(`${A}tidy/delete`, { items: list_.map((x) => ({ key: x.key, title: x.title, together: true, linked: x.together || [] })) }); toast(`Deleted ${res.done?.length ?? list_.length}${res.failed?.length ? `; ${res.failed.length} didn't` : ""}`); N.show(); };
      box.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", async () => {
        const what = b.dataset.t;
        try {
          if (what === "all") { if (await confirm({ title: `Delete ${likely.length} things?`, text: "They can be put back from Recently deleted.", ok: "Delete them", danger: true })) await del(likely); }
          if (what === "delete") { const x = byKey(b.dataset.key); if (await confirm({ title: `Delete “${x.title}”?`, ok: "Delete", danger: true })) await del([x]); }
          if (what === "real") { const x = byKey(b.dataset.key); await post(`${A}tidy/real`, { key: x.key, title: x.title }); toast("Marked as real"); N.show(); }
        } catch (err) { toast(err.message, true); }
      }));
      box.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", async () => { try { await post(`${A}tidy/restore`, { binId: b.dataset.restore }); toast("Put back"); N.show(); } catch (err) { toast(err.message, true); } }));
      box.querySelectorAll("[data-unreal]").forEach((b) => b.addEventListener("click", async () => { try { await post(`${A}tidy/unreal`, { key: b.dataset.unreal }); N.show(); } catch (err) { toast(err.message, true); } }));
    },
  });

  // ---- Fixer ----
  N.section({
    id: "fixer", name: "Fixer", tile: "fixer",
    async draw(box, [place], ui) {
      let s;
      try { s = await api("/fixer-api/state"); } catch (err) { if (adminsOnly(err)) return forAdmins(box); if (err.status === 503 || err.status === 502) return pcOff(box, "The Fixer"); throw err; }
      const ps = s.problems || [];
      box.innerHTML = `<p class="muted small">Checks all of Nova every ${esc(s.every || "30 minutes")} against four rules.${s.last ? ` Last check ${esc(ago(s.last.at))}, ${esc(s.last.screens)} screens.` : ""}${s.running ? " Checking now…" : ""}</p>
        ${list((s.rules || []).map((r) => row({ icon: r.problems ? "globe" : "check", title: r.title, text: r.text, end: `<span class="pill ${r.problems ? "bad" : "ok"}">${r.problems ? `${r.problems} problem${r.problems > 1 ? "s" : ""}` : "Kept everywhere"}</span>` })))}
        ${ps.length ? `<h3 class="h">Problems</h3>${list(ps.slice(0, 60).map((p) => row({ icon: "search", title: `${p.place}: ${p.what}`, text: `${p.why}${(p.at || []).length ? ` · ${p.at.map((a) => a.size).join(", ")}` : ""}` })))}` : empty({ icon: "check", title: "Nothing to fix ✦" })}
        <button type="button" class="btn main wide" data-check${s.running ? " disabled" : ""}>${icon("refresh")} ${s.running ? "Checking…" : "Check now"}</button>`;
      box.querySelector("[data-check]").addEventListener("click", async (e) => { try { await post("/actions/fixer/check", {}, HDR); toast("Checking: it takes a few minutes"); N.show(); } catch (err) { toast(err.message, true); } });
    },
  });

  // ---- Visualizer ----
  let stream = null;
  addEventListener("hashchange", () => { if (stream && !location.hash.startsWith("#visualizer")) { stream.close(); stream = null; } });
  N.section({
    id: "visualizer", name: "Visualizer", tile: "visualizer",
    async draw(box, path, ui) {
      let tasks;
      try { tasks = await api("/tasks"); } catch (err) { if (adminsOnly(err)) return forAdmins(box); if (err.status === 503 || err.status === 502) return pcOff(box, "The Visualizer"); throw err; }
      box.innerHTML = `<p class="muted small">Nova Agent's helper for Acuity's pages: run a task and watch each step.</p>
        <div class="btns two">${(tasks || []).map((t) => `<button type="button" class="btn" data-run="${esc(t.id)}">${icon("play")} ${esc(t.label)}</button>`).join("")}</div>
        <h3 class="h">Steps, live</h3><ul class="list" id="steps"><li><div class="row"><span class="row-lead">${icon("clock")}</span><span class="row-main"><span>Waiting for steps…</span></span></div></li></ul>`;
      box.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => busy(b, "Running…", async () => { try { const r = await post(`/actions/run/${encodeURIComponent(b.dataset.run)}`, {}, HDR); toast(r.message || "Done"); } catch (err) { toast(err.message, true); } })));
      if (stream) stream.close();
      stream = new EventSource("/events");
      const steps = box.querySelector("#steps");
      let first = true;
      stream.onmessage = (e) => {
        let ev; try { ev = JSON.parse(e.data); } catch (x) { return; }
        if (!ev || !ev.message) return;
        if (first) { steps.innerHTML = ""; first = false; }
        steps.insertAdjacentHTML("afterbegin", row({ icon: ev.level === "error" ? "globe" : "check", title: ev.message, text: [ev.part, new Date(ev.time || Date.now()).toLocaleTimeString("en-GB")].filter(Boolean).join(" · ") }));
        while (steps.children.length > 60) steps.lastElementChild.remove();
      };
    },
  });
})();
