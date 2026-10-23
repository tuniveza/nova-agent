// Nova Phone: Nova, Nova Agent's helper for Acuity's pages (Nova Desk's Visualizer, web/agent/page.html). Run a
// task and watch it: every step live in time order (London time, which part spoke, details, what was sent to the
// AI and what came back), the counters, the anatomy lighting up as each part works, what the browser sees, and
// the memory of where things are on Acuity's pages. SSE /events (it sends its recent history first on every
// connect, so the list starts afresh each time), GET /tasks, POST /actions/run/<id>, POST /actions/forget,
// GET /cache. Admins only. The stream is open only while this place is on screen and the phone is awake.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, empty, post, toast, confirm } = N;
  const HDR = { "X-Nova-Visualizer": "1" };
  const LABELS = { input: "input", task: "task", resolve: "finder", cache: "memory", llm: "AI", browser: "browser" };
  const PARTS = [
    ["input", "Input", "A request arrives: from these buttons now, from Nova Bot over HTTP later."],
    ["task", "Task", "Plain step-by-step code: “open the calendar, find the 3pm booking”. It says what it wants, never how to find it."],
    ["resolve", "Finder · resolve()", "Turns a description into one real element on the page.", "“where is the … ?”"],
    ["cache", "Memory", "selectors.json: where things were last time. Instant and free.", "1st"],
    ["llm", "AI · Claude", "Reads the page's structure and points at the element. Its answer is checked, then remembered.", "if memory fails"],
    ["browser", "Browser · Playwright", "A real Chromium that opens pages, clicks and types at a human pace, and takes the screenshots below."],
    ["acuity", "Acuity Scheduling", "The real website, logged in with your saved session."],
  ];
  const MAX_ROWS = 250;
  const london = (t, withDay) => new Date(t || Date.now()).toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", ...(withDay ? { day: "numeric", month: "short" } : {}) }).replace(",", "");

  async function get(path) {
    let res;
    try { res = await fetch(path, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }); }
    catch (e) { throw Object.assign(new Error(navigator.onLine === false ? "You're offline" : "Couldn't reach Nova"), { offline: true }); }
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
    if (res.status === 403) throw Object.assign(new Error("This is for admins."), { admins: true });
    if (!res.ok) throw Object.assign(new Error((body && (body.message || body.error)) || `Nova Agent answered ${res.status}`), { status: res.status, data: body });
    return body;
  }

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
      let tasks = [], why = "";
      try { const t = await get("/tasks"); tasks = Array.isArray(t) ? t : []; } catch (err) {
        if (err.signIn) throw err;
        if (err.admins) return void (box.innerHTML = empty({ icon: "user", title: "This is for admins", text: "Sign in as an admin to watch Nova work." }));
        if (err.offline) throw err;
        why = err.status === 502 || err.status === 503 || err.data?.pcOffline ? "Nova Agent isn't answering just now, so there are no tasks to run. The steps below come back when it does." : err.message;
      }
      box.innerHTML = `<div class="vz-head"><p class="muted small">Nova Agent's helper for Acuity's pages: run a task and watch each step.</p><span class="pill" data-status>connecting…</span></div>
        ${why ? `<p class="vz-warn">${esc(why)}</p>` : ""}
        <div class="btns two vz-acts">${tasks.map((t, i) => `<button type="button" class="btn${i === 0 ? " main" : ""}" data-run="${esc(t.id)}">${icon("play")} ${esc(t.label)}</button>`).join("")}
          <button type="button" class="btn" data-forget>${icon("trash")} Wipe memory</button><button type="button" class="btn quiet" data-clear>Clear steps</button></div>
        <p class="muted small vz-note">Wipe memory makes it find every element with the AI again. Clear steps only clears this list.</p>
        <div class="sums vz-counts"><div class="sum"><b data-n="hits">0</b><span>found from memory</span></div><div class="sum"><b data-n="llm">0</b><span>AI calls</span></div><div class="sum"><b data-n="heals">0</b><span>healed</span></div><div class="sum"><b data-n="errors">0</b><span>failures</span></div></div>
        <h3 class="h">What the browser sees</h3>
        <figure class="card vz-shot"><img alt="" hidden data-shot><figcaption class="muted small" data-caption>Screenshots appear here as the agent works. Elements it finds get a red outline.</figcaption></figure>
        <h3 class="h">Steps, live</h3>
        <ol class="vz-steps" data-steps aria-live="off"><li class="vz-empty">Nothing yet. Press <b>${esc(tasks[0]?.label || "a task")}</b> to watch the agent work.</li></ol>
        <h3 class="h">Anatomy</h3>
        <div class="vz-anatomy">${PARTS.map(([id, title, text, arrow], i) => `${i ? `<p class="vz-arrow" aria-hidden="true">↓${arrow ? ` ${esc(arrow)}` : ""}</p>` : ""}<div class="vz-node" data-part="${id}"><p class="vz-node-title">${esc(title)} <b class="vz-count" data-count></b></p><p class="small muted">${esc(text)}</p></div>`).join("")}</div>
        <h3 class="h">Memory (selector cache)</h3><div data-memory>${N.skeleton(2)}</div>`;
      view = { box, counts: { hits: 0, llm: 0, heals: 0, errors: 0 }, perPart: {}, timers: {}, memTimer: 0 };
      box.addEventListener("click", async (e) => {
        const run = e.target.closest("[data-run]");
        if (run) return act(box, run, `/actions/run/${encodeURIComponent(run.dataset.run)}`, "Running…");
        const f = e.target.closest("[data-forget]");
        if (f) { if (await confirm({ title: "Wipe the agent's memory?", text: "It will use the AI to find every element again next time.", ok: "Wipe memory", danger: true })) { await act(box, f, "/actions/forget", "Wiping…"); loadMemory(); } return; }
        if (e.target.closest("[data-clear]")) { reset(); box.querySelector("[data-steps]").innerHTML = `<li class="vz-empty">Cleared.</li>`; return; }
        const more = e.target.closest("[data-more]");
        if (more) { const pre = more.nextElementSibling; pre.hidden = !pre.hidden; more.setAttribute("aria-expanded", String(!pre.hidden)); return; }
        const shot = e.target.closest("[data-show]");
        if (shot) { const ev = view?.shots.get(shot.dataset.show); if (ev) { showShot(ev); box.querySelector(".vz-shot").scrollIntoView({ block: "start", behavior: "smooth" }); } }
      });
      view.shots = new Map();
      loadMemory();
      // (the stream starts once this is on screen: the box is drawn off screen first)
      requestAnimationFrame(() => requestAnimationFrame(() => { if (view && view.box === box && !document.hidden) connect(); }));
    },
  });

  // A task or Wipe: every task button and Wipe off while it works (one thing at a time, as on Nova Desk)
  async function act(box, btn, path, words) {
    const all = [...box.querySelectorAll("[data-run], [data-forget]")];
    const was = btn.innerHTML;
    all.forEach((b) => (b.disabled = true));
    btn.textContent = words;
    try { const r = await post(path, {}, HDR); toast(r && r.message ? String(r.message).slice(0, 140) : "Done"); }
    catch (err) { toast(err.message, true); }
    finally { all.forEach((b) => (b.disabled = false)); btn.innerHTML = was; }
  }

  function reset() {
    if (!view) return;
    const steps = view.box.querySelector("[data-steps]");
    steps.innerHTML = "";
    for (const k of Object.keys(view.counts)) view.counts[k] = 0;
    view.perPart = {};
    view.shots.clear();
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
    const key = String(ev.id ?? `${ev.time}-${Math.random()}`);
    const data = ev.data !== undefined ? (ev.data && typeof ev.data === "object" && "prompt" in ev.data ? `SYSTEM PROMPT\n${ev.data.system}\n\nQUESTION\n${ev.data.prompt}` : JSON.stringify(ev.data, null, 2)) : "";
    li.innerHTML = `<p class="vz-line"><time>${esc(london(ev.time))}</time><span class="vz-chip" data-p="${esc(ev.part)}">${esc(LABELS[ev.part] || ev.part)}</span></p>
      <p class="vz-msg">${ev.image ? "📷 " : ""}${esc(ev.message)}</p>
      ${ev.image ? `<button type="button" class="btn quiet vz-link" data-show="${esc(key)}">Show what it saw</button>` : ""}
      ${data ? `<button type="button" class="btn quiet vz-link" data-more aria-expanded="false">${ev.part === "llm" ? "Show what was sent / received" : "Details"}</button><pre class="vz-data" hidden>${esc(data)}</pre>` : ""}`;
    steps.append(li);
    while (steps.children.length > MAX_ROWS) steps.firstElementChild.remove();
    if (ev.image) { view.shots.set(key, ev); if (view.shots.size > 30) view.shots.delete(view.shots.keys().next().value); showShot(ev); }
    if (follow) li.scrollIntoView({ block: "nearest" });
    light(ev);
    if (ev.part === "cache" && ev.level === "ok") view.counts.hits++;
    if (ev.part === "llm" && ev.level === "start") view.counts.llm++;
    if (ev.part === "resolve" && ev.level === "ok") view.counts.heals++;
    if (ev.level === "error") view.counts.errors++;
    counters();
    if (ev.part === "cache" || (ev.part === "resolve" && ev.level === "ok") || ev.part === "input") {
      // (once for a burst: the history on connect brings many at once)
      clearTimeout(view.memTimer);
      view.memTimer = setTimeout(loadMemory, 600);
    }
  }
  function showShot(ev) {
    const img = view.box.querySelector("[data-shot]");
    img.src = ev.image;
    img.alt = ev.message;
    img.hidden = false;
    view.box.querySelector("[data-caption]").textContent = `${london(ev.time)} · ${ev.message}`;
  }
  // (the part that's working lights up for a moment, and counts)
  function light(ev) {
    for (const part of ev.part === "browser" ? ["browser", "acuity"] : [ev.part]) {
      const node = view.box.querySelector(`.vz-node[data-part="${part}"]`);
      if (!node) continue;
      node.classList.add("on");
      node.classList.toggle("bad", ev.level === "error");
      clearTimeout(view.timers[part]);
      view.timers[part] = setTimeout(() => node.classList.remove("on", "bad"), 1600);
    }
    view.perPart[ev.part] = (view.perPart[ev.part] || 0) + 1;
    const c = view.box.querySelector(`.vz-node[data-part="${ev.part}"] [data-count]`);
    if (c) c.textContent = view.perPart[ev.part];
  }

  // The memory: where things were found on Acuity's pages, and how often each was used
  async function loadMemory() {
    const v = view;
    if (!v) return;
    const box = v.box.querySelector("[data-memory]");
    let cache = {};
    try { const a = await get("/cache"); cache = a && typeof a === "object" && !Array.isArray(a) ? a : {}; } catch (e) { cache = {}; }
    if (v !== view) return;
    const keys = Object.keys(cache).filter((k) => cache[k] && typeof cache[k] === "object" && (cache[k].role || cache[k].name)).sort();
    box.innerHTML = keys.length ? `<ul class="list">${keys.map((k) => {
      const e = cache[k];
      const when = e.healedAt ? new Date(e.healedAt) : null;
      return `<li><div class="row vz-mem"><span class="row-main"><code class="vz-key">${esc(k)}</code><span><code>${esc(`${e.role || "element"}${e.name ? ` "${e.name}"` : ""}${e.nth ? ` #${e.nth}` : ""}`)}</code></span><span>Learned ${when && !isNaN(when.getTime()) ? esc(london(when, true)) : "—"}</span></span><span class="row-end"><b>${Number(e.hits) || 0}×</b><span>used</span></span></div></li>`;
    }).join("")}</ul>` : empty({ icon: "star", title: "Empty", text: "The AI will find elements and remember them here." });
  }
})();
