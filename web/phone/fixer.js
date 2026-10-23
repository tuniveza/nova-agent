// Nova Phone: the Fixer, which checks every screen of Nova against its rules every 30 minutes.
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

})();
