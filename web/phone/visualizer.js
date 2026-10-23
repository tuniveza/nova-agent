// Nova Phone: Nova, Nova Agent's helper for Acuity's pages (Nova Desk's Visualizer).
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

  // ---- Visualizer ----
  let stream = null;
  addEventListener("hashchange", () => { if (stream && !location.hash.startsWith("#visualizer")) { stream.close(); stream = null; } });
  N.section({
    id: "visualizer", name: "Nova", tile: "visualizer",
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
