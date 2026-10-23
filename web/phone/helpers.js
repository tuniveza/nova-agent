// Nova Phone: the helpers. Help (Nova Desk's Manual: every app's guide, how it's built, what's new, its
// history, and every web address, searchable), Observatory (the studio's projects: what each is, its numbers,
// its pictures), Console (Nova's commands, typed, the answers in words). Their content loads only when opened.
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

  // ---- Help ----
  let helpSearch = "";
  N.section({
    id: "help", name: "Manual", tile: "manual",
    async draw(box, [app, part, gid], ui) {
      const M = await loadData("/shared/manual-data.js", "NovaManualData");
      const apps = M.apps || [];
      if (app === "addresses") return drawAddresses(box, M, ui);
      if (app) return drawApp(box, apps.find((a) => a.id === app), part, gid, ui);
      const q = helpSearch.toLowerCase();
      const hits = q ? apps.flatMap((a) => ["guide", "built"].flatMap((k) => (a[k] || []).filter((g) => `${g.title} ${g.text || textOf(g.html)}`.toLowerCase().includes(q)).map((g) => ({ a, k, g })))).slice(0, 40) : [];
      box.innerHTML = `<form class="search" data-help-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(helpSearch)}" placeholder="Search every app's manual"></label></form>
        ${q ? (hits.length ? list(hits.map(({ a, k, g }) => row({ href: `#help/${a.id}/${k}/${encodeURIComponent(g.id)}`, icon: "book", title: g.title, text: `${a.name} · ${k === "guide" ? "Guide" : "How it's built"}` }))) : empty({ icon: "search", title: `Nothing about “${helpSearch}”` })) : `<div class="tiles">${apps.map((a) => `<a class="tile" href="#help/${a.id}">${window.NovaTile ? window.NovaTile({ agent: "chat", bot: "portal", nova: "portal" }[a.id] || a.id) : ""}<span>${esc(a.name)}</span></a>`).join("")}</div>
        ${list([row({ href: "#help/addresses", icon: "globe", title: "All addresses", text: "Every web address, to open or copy" })])}`}`;
      box.querySelector("[data-help-search]").addEventListener("submit", (e) => { e.preventDefault(); helpSearch = e.target.elements.q.value.trim(); N.show(); });
    },
  });
  function drawApp(box, a, part, gid, ui) {
    ui.back(gid ? `#help/${a?.id}/${part}` : part ? `#help/${a?.id}` : "#help");
    if (!a) { box.innerHTML = empty({ icon: "book", title: "That app isn't in the manual" }); return; }
    ui.title(a.name);
    if (part === "news" || part === "history") {
      const items = part === "news" ? a.news || [] : (a.history?.commits || []).slice(0, 60);
      box.innerHTML = items.length ? list(items.map((c) => row({ icon: "clock", title: c.subject || c.title || "", text: [c.date ? new Date(c.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "", c.body ? String(c.body).slice(0, 140) : ""].filter(Boolean).join(" · ") }))) : empty({ icon: "clock", title: "Nothing here yet" });
      return;
    }
    if (part && gid) {
      const g = (a[part] || []).find((x) => x.id === decodeURIComponent(gid));
      box.innerHTML = g ? `<div class="card prose"><h2 class="card-title">${esc(g.title)}</h2>${clean(g.html)}</div>` : empty({ icon: "book", title: "That page isn't there" });
      return;
    }
    if (part) {
      box.innerHTML = list((a[part] || []).map((g) => row({ href: `#help/${a.id}/${part}/${encodeURIComponent(g.id)}`, icon: "book", title: g.title, text: (g.text || textOf(g.html)).slice(0, 110) })));
      return;
    }
    box.innerHTML = `<div class="card prose">${a.tagline ? `<p class="kicker">${esc(a.tagline)}</p>` : ""}${clean(a.intro)}</div>
      ${list([["guide", "Guide", "How to use it"], ["built", "How it's built", "What's inside"], ["news", "What's new", "The latest changes"], ["history", "History", `${a.history?.total || ""} changes so far`]].filter(([k]) => (k === "history" ? a.history?.commits?.length : (a[k] || []).length)).map(([k, t, s]) => row({ href: `#help/${a.id}/${k}`, icon: "book", title: t, text: s })))}`;
  }
  function drawAddresses(box, M, ui) {
    ui.back("#help");
    ui.title("All addresses");
    box.innerHTML = (M.addresses || []).map((grp) => `<h3 class="h">${esc(grp.title)}</h3>${grp.note ? `<p class="muted small">${esc(grp.note)}</p>` : ""}${list((grp.items || []).map((it) => row({ button: `data-copy="${esc(it.url || it.path)}"`, icon: "globe", title: it.name, text: [it.path, it.what].filter(Boolean).join(" · "), end: "Copy" })))}`).join("");
    box.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(new URL(b.dataset.copy, location.origin).href); toast("Copied"); } catch (e) { toast("Couldn't copy", true); } }));
  }

  // ---- Observatory ----
  N.section({
    id: "observatory", name: "Observatory", tile: "observatory",
    async draw(box, [id], ui) {
      let O;
      try { O = await loadData("/observatory/data/projects.js", "OBSERVATORY"); } catch (err) { if (window.OBSERVATORY_LOCKED) throw Object.assign(new Error("Sign in first"), { signIn: true }); throw err; }
      const ps = O.projects || [];
      const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n ?? ""));
      const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round((b || 0) / 1e3)} KB`);
      if (id) {
        const p = ps.find((x) => x.id === id);
        ui.back("#observatory");
        if (!p) { box.innerHTML = empty({ icon: "star", title: "That project isn't there" }); return; }
        ui.title(p.name);
        const shots = p.media?.shots || [];
        box.innerHTML = `<div class="card"><p class="kicker">${esc([p.category, p.status].filter(Boolean).join(" · "))}</p><h2 class="card-title">${esc(p.name)}</h2>${p.tagline ? `<p>${esc(p.tagline)}</p>` : ""}
            <div class="facts">${[["Lines", fmt(p.stats?.lines)], ["Size", size(p.stats?.bytes)], ["On disk", size(p.stats?.disk)], ["Files", fmt(p.stats?.files)], ["Last change", ago(p.stats?.newest)], ["Stack", (p.stack || []).join(", ")], ["Run it", p.run], ["Where", p.path]].filter(([, v]) => v).map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div></div>
          ${p.goal ? `<div class="card"><p class="kicker">Goal</p><p>${esc(p.goal)}</p></div>` : ""}${p.vision ? `<div class="card"><p class="kicker">Vision</p><p>${esc(p.vision)}</p></div>` : ""}
          ${(p.features || []).length ? `<div class="card"><p class="kicker">What it does</p><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
          ${shots.length ? `<h3 class="h">Pictures</h3>${shots.map((s) => `<figure class="card shot"><img src="/observatory/media/${encodeURIComponent(p.id)}/${encodeURIComponent(s.file)}" alt="${esc(s.caption || "")}" loading="lazy"><figcaption class="muted small">${esc(s.caption || "")}</figcaption></figure>`).join("")}` : ""}
          ${p.path ? `<button type="button" class="btn wide" data-copy="${esc(p.path)}">Copy the folder's path</button>` : ""}`;
        box.querySelector("[data-copy]")?.addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(e.currentTarget.dataset.copy); toast("Copied"); } catch (x) { toast("Couldn't copy", true); } });
        return;
      }
      const t = O.totals || {};
      box.innerHTML = `<div class="sums"><div class="sum"><b>${esc(t.projects ?? ps.length)}</b><span>Projects</span></div><div class="sum"><b>${fmt(t.lines)}</b><span>Lines</span></div><div class="sum"><b>${size(t.bytes)}</b><span>Code</span></div></div>
        ${list(ps.map((p) => row({ href: `#observatory/${encodeURIComponent(p.id)}`, lead: window.NovaTile ? window.NovaTile("observatory") : icon("star"), title: p.name, text: [p.tagline, `${fmt(p.stats?.lines)} lines`, p.stats?.newest ? `changed ${ago(p.stats.newest)}` : ""].filter(Boolean).join(" · ") })))}`;
    },
  });

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
