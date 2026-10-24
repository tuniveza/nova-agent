// Nova Phone: Nova, every step Nova Agent takes, live (Nova Desk's Visualizer, web/agent/page.html): each step in
// time order (London time, which part spoke, details, what was sent to the AI and what came back), the counters,
// and the anatomy lighting up as each part works. SSE /events (it sends its recent history first on every
// connect, so the list starts afresh each time). Admins only. The stream is open only while this place is on
// screen and the phone is awake.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, empty } = N;
  const LABELS = { input: "input", task: "task", llm: "AI", browser: "browser" };
  const PARTS = [
    ["input", "Input", "A request arrives: a chat message, a tap in Quests, a check-in with Nova Bot."],
    ["task", "Task", "Nova Agent's own work: planning quests, reminders, the studio's bookings, Google."],
    ["llm", "AI · Claude", "Nova Agent's thinking: replies, plans and drafts."],
    ["browser", "Browser", "Opens a public webpage when Agent needs to look at one."],
  ];
  const MAX_ROWS = 250;
  const london = (t) => new Date(t || Date.now()).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // ---- The live stream: open while on screen, closed when away or asleep, and back (afresh) on return ----
  let stream = null, retry = 0, retryIn = 4000, view = null;
  function close() { if (stream) { stream.close(); stream = null; } clearTimeout(retry); retry = 0; }
  addEventListener("hashchange", () => { if (!/^#visualizer(\/|$)/.test(location.hash)) { close(); view = null; } });
  document.addEventListener("visibilitychange", () => {
    if (!view) return;
    if (document.hidden) { close(); status("Paused while the phone is away", ""); } else if (!stream) connect();
  });
  function status(words, cls) { const s = view?.box.querySelector("[data-status]"); if (s) { s.textContent = words; s.className = `pill ${cls}`; } }
  function connect() {
    close();
    if (!view || !view.box.isConnected) return;
    status("connecting…", "");
    const es = new EventSource("/events");
    stream = es;
    es.onopen = () => { retryIn = 4000; status("live", "ok"); reset(); };
    es.onerror = () => {
      status("disconnected, retrying…", "warn");
      // (an answer that isn't a stream, like "sign in" or "admins only", closes it for good: tried again here)
      if (es.readyState === 2 && stream === es) { stream = null; retry = setTimeout(() => { if (view && !document.hidden) connect(); }, retryIn); retryIn = Math.min(30000, retryIn * 2); }
    };
    es.onmessage = (m) => { let ev; try { ev = JSON.parse(m.data); } catch (e) { return; } if (ev && ev.message) showEvent(ev); };
  }

  N.section({
    id: "visualizer", name: "Nova", tile: "visualizer",
    async draw(box) {
      await N.css("visualizer.css");
      close();
      const me = N.me();
      if (me && me.role !== "admin") return void (box.innerHTML = empty({ icon: "user", title: "This is for admins", text: "Sign in as an admin to watch Nova work." }));
      box.innerHTML = `<div class="vz-head"><p class="muted small">Every step Nova Agent takes, live.</p><span class="pill" data-status>connecting…</span></div>
        <div class="btns vz-acts"><button type="button" class="btn quiet wide" data-clear>Clear steps</button></div>
        <p class="muted small vz-note">Clear steps only clears this list.</p>
        <div class="sums vz-counts"><div class="sum"><b data-n="steps">0</b><span>steps</span></div><div class="sum"><b data-n="llm">0</b><span>AI calls</span></div><div class="sum"><b data-n="errors">0</b><span>failures</span></div></div>
        <h3 class="h">Steps, live</h3>
        <ol class="vz-steps" data-steps aria-live="off"><li class="vz-empty">Nothing yet. Steps show here as Nova Agent works.</li></ol>
        <h3 class="h">Anatomy</h3>
        <div class="vz-anatomy">${PARTS.map(([id, title, text], i) => `${i ? `<p class="vz-arrow" aria-hidden="true">↓</p>` : ""}<div class="vz-node" data-part="${id}"><p class="vz-node-title">${esc(title)} <b class="vz-count" data-count></b></p><p class="small muted">${esc(text)}</p></div>`).join("")}</div>`;
      view = { box, counts: { steps: 0, llm: 0, errors: 0 }, perPart: {}, timers: {} };
      box.addEventListener("click", (e) => {
        if (e.target.closest("[data-clear]")) { reset(); box.querySelector("[data-steps]").innerHTML = `<li class="vz-empty">Cleared.</li>`; return; }
        const more = e.target.closest("[data-more]");
        if (more) { const pre = more.nextElementSibling; pre.hidden = !pre.hidden; more.setAttribute("aria-expanded", String(!pre.hidden)); }
      });
      // (the stream starts once this is on screen: the box is drawn off screen first)
      requestAnimationFrame(() => requestAnimationFrame(() => { if (view && view.box === box && !document.hidden) connect(); }));
    },
  });

  function reset() {
    if (!view) return;
    const steps = view.box.querySelector("[data-steps]");
    steps.innerHTML = "";
    for (const k of Object.keys(view.counts)) view.counts[k] = 0;
    view.perPart = {};
    view.box.querySelectorAll("[data-count]").forEach((c) => (c.textContent = ""));
    counters();
  }
  function counters() { for (const [k, v] of Object.entries(view.counts)) { const el = view.box.querySelector(`[data-n="${k}"]`); if (el && el.textContent !== String(v)) el.textContent = v; } }

  function showEvent(ev) {
    if (!view) return;
    const box = view.box, steps = box.querySelector("[data-steps]");
    steps.querySelector(".vz-empty")?.remove();
    const page = document.getElementById("page");
    const last = steps.lastElementChild;
    // (kept in view as steps come only when the newest was in view: never pulled away from what's being read)
    const follow = last && page ? last.getBoundingClientRect().top < page.getBoundingClientRect().bottom && last.getBoundingClientRect().bottom > page.getBoundingClientRect().top : false;
    const li = document.createElement("li");
    li.className = `vz-step lv-${ev.level || "info"}${ev.part === "task" && ev.level === "start" && /^Task:/.test(ev.message) ? " vz-task" : ""}`;
    const data = ev.data !== undefined ? (ev.data && typeof ev.data === "object" && "prompt" in ev.data ? `SYSTEM PROMPT\n${ev.data.system}\n\nQUESTION\n${ev.data.prompt}` : JSON.stringify(ev.data, null, 2)) : "";
    li.innerHTML = `<p class="vz-line"><time>${esc(london(ev.time))}</time><span class="vz-chip" data-p="${esc(ev.part)}">${esc(LABELS[ev.part] || ev.part)}</span></p>
      <p class="vz-msg">${esc(ev.message)}</p>
      ${data ? `<button type="button" class="btn quiet vz-link" data-more aria-expanded="false">${ev.part === "llm" ? "Show what was sent / received" : "Details"}</button><pre class="vz-data" hidden>${esc(data)}</pre>` : ""}`;
    steps.append(li);
    while (steps.children.length > MAX_ROWS) steps.firstElementChild.remove();
    if (follow) li.scrollIntoView({ block: "nearest" });
    light(ev);
    view.counts.steps++;
    if (ev.part === "llm" && ev.level === "start") view.counts.llm++;
    if (ev.level === "error") view.counts.errors++;
    counters();
  }
  // (the part that's working lights up for a moment, and counts)
  function light(ev) {
    const node = view.box.querySelector(`.vz-node[data-part="${ev.part}"]`);
    if (node) {
      node.classList.add("on");
      node.classList.toggle("bad", ev.level === "error");
      clearTimeout(view.timers[ev.part]);
      view.timers[ev.part] = setTimeout(() => node.classList.remove("on", "bad"), 1600);
    }
    view.perPart[ev.part] = (view.perPart[ev.part] || 0) + 1;
    const c = view.box.querySelector(`.vz-node[data-part="${ev.part}"] [data-count]`);
    if (c) c.textContent = view.perPart[ev.part];
  }
})();
