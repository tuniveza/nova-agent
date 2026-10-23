// Nova Phone: Computer, the server Nova runs on (admins).
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

})();
