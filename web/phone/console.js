// Nova Phone: the Console, Nova's commands typed, the answers in words.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, empty, api, post, toast, ago, today } = N;
  // A file of data that sets a global (the Manual's, the Observatory's), loaded once when it's first needed
  const loaded = new Map();
  const loadData = (src, global) => loaded.get(src) || loaded.set(src, new Promise((resolve, reject) => {
    if (window[global]) return resolve(window[global]);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => (window[global] ? resolve(window[global]) : reject(new Error("It didn't load")));
    s.onerror = () => { loaded.delete(src); reject(new Error("It didn't load")); };
    document.head.append(s);
  })).get(src);
  // Read as a page of its own, with style attributes and blocks renamed first: Chrome holds a parsed page to Nova
  // Phone's CSP and reports every style="…" in it as blocked (the styles are dropped below anyway)
  const parse = (html) => new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
  const textOf = (html) => parse(html).body.textContent.replace(/\s+/g, " ").trim();
  // A guide's words, safe to show: no scripts, frames, styles or handlers; web links only
  function clean(html) {
    const doc = parse(html);
    for (const el of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button")) el.remove();
    for (const el of doc.body.querySelectorAll("*")) for (const a of [...el.attributes]) if (!(a.name === "href" && /^(https?:|\/)/.test(a.value)) && !(a.name === "src" && /^(https?:|\/|data:image\/)/.test(a.value)) && a.name !== "alt") el.removeAttribute(a.name);
    for (const a of doc.body.querySelectorAll("a")) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
    return doc.body.innerHTML;
  }

  // ---- Console: Nova's commands, in words ----
  const said = [];
  const COMMANDS = {
    help: [async () => `Commands: ${Object.keys(COMMANDS).join(", ")}. Try “today”, “quests”, “enquiries”, “money”, “search mix”, “ask what's on friday”.`, "What you can type"],
    today: [async () => { const [e, n] = await Promise.all([api("/app/api/enquiries?box=new"), api("/app/api/notifications")]); const cards = N.cal ? (await N.cal.load(), N.cal.day(today())) : []; return [`${cards.length} on the calendar today${cards.length ? `: ${cards.map((x) => x.item.title || x.item.session).join("; ")}` : ""}`, `${(e.enquiries || []).length} new enquiries`, `${(n.notifications || []).length} alerts`].join("\n"); }, "The day in a few lines"],
    now: [async () => { const s = await api("/quests/state"); return s.current ? `On now: ${s.current.title}` : `Nothing on now.${(s.next || [])[0] ? ` Next: ${s.next[0].title}` : ""}`; }, "What's on right now"],
    quests: [async () => { const s = await api("/quests/state"); const open = (s.quests || []).filter((q) => q.status !== "done"); return open.length ? open.slice(0, 15).map((q) => `· ${q.title}`).join("\n") : "No quests to do."; }, "The quests still to do"],
    enquiries: [async () => { const r = await api("/app/api/enquiries?box=new"); return (r.enquiries || []).map((e) => `· ${e.name || e.email}: ${e.subject || ""}`).join("\n") || "No new enquiries."; }, "New enquiries"],
    money: [async () => { const r = await api("/app/api/money?status=open"); const s = r.summary || {}; return `Owed ${N.money(s.owed?.pence)} on ${s.owed?.count || 0} invoices; overdue ${N.money(s.overdue?.pence)}; in this month ${N.money(s.month?.inPence)}.`; }, "Money in a line"],
    approvals: [async () => { const r = await api("/app/api/booking-actions"); return (r.actions || []).map((a) => `· ${a.summary}`).join("\n") || "Nothing waiting."; }, "Booking changes waiting"],
    alerts: [async () => { const r = await api("/app/api/notifications"); return (r.notifications || []).slice(0, 10).map((n) => `· ${n.title}`).join("\n") || "No alerts."; }, "The latest alerts"],
    search: [async (w) => { const r = await api(`/app/api/memory/index?q=${encodeURIComponent(w)}`, { headers: { "X-Nova-App": "index" } }); return (r.files || []).slice(0, 10).map((f) => `· ${f.name || f.path}: ${f.description || ""}`).join("\n") || `Nothing about “${w}”.`; }, "Search Index: search <words>"],
    ask: [async (w) => { const r = await post("/actions/chat", { message: w }, { "X-Nova-Visualizer": "1" }); return r.reply || "(no answer)"; }, "Ask Nova Agent: ask <question>"],
    status: [async () => { const s = await api("/status"); return `Nova Agent is ${s.live ? "live" : "rehearsing"}${s.model ? ` (${s.model})` : ""}${s.connected ? ", connected" : ""}.`; }, "Is Nova Agent up?"],
    whoami: [async () => { const m = (await api("/auth/me")).staff; return `${m.display_name} · ${m.role}`; }, "Who you're signed in as"],
    open: [async (w) => { const to = w.toLowerCase().trim(); location.hash = `#${to}`; return `Opening ${to}…`; }, "Open a place: open calendar"],
    clear: [async () => { said.length = 0; return ""; }, "Clear the screen"],
  };
  N.section({
    id: "console", name: "Console", tile: "console",
    draw(box) {
      box.innerHTML = `<div class="console" id="console-out">${said.map(([cmd, out]) => `<p class="cmd">› ${esc(cmd)}</p>${out ? `<p class="pre out">${esc(out)}</p>` : ""}`).join("") || `<p class="out muted">Type a command, or tap one below. “help” lists them all.</p>`}</div>
        <div class="chips">${["today", "now", "quests", "enquiries", "money", "help"].map((c) => `<button type="button" class="chip" data-cmd="${c}">${c}</button>`).join("")}</div>
        <form class="composer" id="cmd"><label class="sr" for="cmd-box">A command</label><input class="input mono" id="cmd-box" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="help"><button class="btn main" type="submit" aria-label="Run">${icon("send")}</button></form>`;
      const run = async (line) => {
        const [word, ...rest] = line.trim().split(/\s+/);
        const c = COMMANDS[(word || "").toLowerCase()];
        let out;
        try { out = c ? await c[0](rest.join(" ")) : `Not a command: “${word}”. Type help.`; } catch (err) { out = err.message; }
        if (word?.toLowerCase() !== "clear") said.push([line, out]);
        while (said.length > 40) said.shift();
        if (location.hash.startsWith("#console")) N.show();
      };
      box.querySelector("#cmd").addEventListener("submit", (e) => { e.preventDefault(); const v = box.querySelector("#cmd-box").value; if (v.trim()) run(v); });
      box.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("click", () => run(b.dataset.cmd)));
    },
    bottom: () => true,
  });
})();
