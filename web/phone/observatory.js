// Nova Phone: the Observatory (Nova Desk's Observatory, made for a phone): every project in one sky. What each is,
// where it lives, how big it is, its languages, its git, its pictures and demo. Its data loads only when it's opened;
// pictures load as they come into view, and a demo video only when you tap it.
//   #observatory         the summary, search, categories, sort, and a card per project
//   #observatory/<id>    one project in full
// (Nova Desk's star map isn't here: Nova Desk hides it on phones too.)
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, list, empty, toast } = N;

  // A file of data that sets a global, loaded once when it's first needed
  const loaded = new Map();
  const loadData = (src, global) => loaded.get(src) || loaded.set(src, new Promise((resolve, reject) => {
    if (window[global]) return resolve(window[global]);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => (window[global] || window.OBSERVATORY_LOCKED ? resolve(window[global]) : reject(new Error("It didn't load")));
    s.onerror = () => { loaded.delete(src); reject(new Error("It didn't load")); };
    document.head.append(s);
  })).get(src);

  // ---- Numbers, sizes and times, as Nova Desk writes them ----
  const nf = new Intl.NumberFormat("en-GB");
  const num = (n) => nf.format(Math.round(n || 0));
  function bytes(b) {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / 1024 ** i;
    return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  }
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const rtfShort = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto", style: "short" });
  function ago(iso, short = false) {
    if (!iso) return "never";
    const s = (new Date(iso) - Date.now()) / 1000;
    if (Number.isNaN(s)) return "";
    const steps = [[60, "second", 1], [3600, "minute", 60], [86400, "hour", 3600], [604800, "day", 86400], [2629800, "week", 604800], [31557600, "month", 2629800], [Infinity, "year", 31557600]];
    for (const [lim, unit, div] of steps) if (Math.abs(s) < lim) return (short ? rtfShort : rtf).format(Math.round(s / div), unit);
    return "";
  }
  const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const when = (iso) => (iso ? dateFmt.format(new Date(iso)) : "—");
  const home = (p) => String(p || "").replace(/^\/home\/[^/]+/, "~");

  // Familiar language colours (GitHub's), so the bars read at a glance
  const LANG = { JavaScript: "#F1E05A", TypeScript: "#3178C6", HTML: "#E34C26", CSS: "#663399", Kotlin: "#A97BFF", Java: "#B07219", C: "#7D8A9C", "C++": "#F34B7D", "C#": "#178600",
    Python: "#3572A5", Ruby: "#CC342D", Lua: "#5468F0", GDScript: "#4FB3D9", Haxe: "#DF7900", Crystal: "#C8C8D0", Odin: "#60AFFE", Assembly: "#6E4C13", GML: "#71B417", Shaders: "#FF5FA8",
    Shell: "#89E051", SQL: "#E38C00", Go: "#00ADD8", Rust: "#DEA584", Zig: "#EC915C", Gleam: "#FFAFF3" };
  const langColour = (n) => LANG[n] || "#9C8FD0";
  // Each project's own colour (its Observatory theme's highlight): a small mark on its card, as Nova Desk does
  // while one theme is on for all of Nova
  const OWN = { novacane: "#FF5FA8", solar: "#FF9548", pulsar: "#3DEBFF", aurora: "#5CFFC0", eclipse: "#FFCF6E", quasar: "#A98BFF" };
  const STATUS = { live: "Live", active: "Active", released: "Released", skeleton: "Skeleton", empty: "Awaiting launch", building: "Building" };
  const TONE = { live: "ok", active: "ok", released: "ok", building: "warn", skeleton: "", empty: "" };
  const CATS = ["All", "Nova Agent", "Games", "Tools", "Experiments"];
  const SORTS = [["recent", "Recent"], ["lines", "Lines"], ["disk", "Size"], ["name", "Name"]];
  const mediaUrl = (p, file) => `/observatory/media/${encodeURIComponent(p.id)}/${encodeURIComponent(file)}`;

  // ---- A drawn cover: a small seeded picture of the project's sky in the theme's colours (no download) ----
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const SUBJECT = { "Nova Agent": "nebula", Games: "planet", Tools: "constellation", Experiments: "galaxy" };
  let covers = 0;
  function cover(p) {
    const r = rng(hash(String(p.id)));
    const id = `obs-g${++covers}`;
    const f = (n) => n.toFixed(1);
    const subject = p.status === "empty" ? "eclipse" : SUBJECT[p.category] || "nebula";
    let art = "";
    for (let i = 0; i < 22; i++) art += `<circle class="obs-st" cx="${f(r() * 100)}" cy="${f(r() * 100)}" r="${f(0.3 + r() * 0.8)}" opacity="${f(0.35 + r() * 0.6)}"/>`;
    const cx = 35 + r() * 30, cy = 35 + r() * 30;
    if (subject === "nebula") for (let i = 0; i < 3; i++) art += `<ellipse cx="${f(cx + (r() - 0.5) * 40)}" cy="${f(cy + (r() - 0.5) * 30)}" rx="${f(26 + r() * 22)}" ry="${f(14 + r() * 14)}" transform="rotate(${f(r() * 180)} ${f(cx)} ${f(cy)})" fill="url(#${id}${i % 2 ? "b" : "a"})" opacity="${f(0.55 + r() * 0.35)}"/>`;
    else if (subject === "planet") art += `<circle cx="${f(cx)}" cy="${f(cy)}" r="22" fill="url(#${id}a)"/><ellipse class="obs-ring" cx="${f(cx)}" cy="${f(cy)}" rx="36" ry="8" transform="rotate(${f(-20 + r() * 40)} ${f(cx)} ${f(cy)})"/>`;
    else if (subject === "constellation") {
      const pts = Array.from({ length: 6 }, () => [12 + r() * 76, 14 + r() * 72]);
      art += `<polyline class="obs-line" points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}"/>${pts.map(([x, y]) => `<circle class="obs-big" cx="${f(x)}" cy="${f(y)}" r="${f(1.4 + r() * 1.4)}"/>`).join("")}`;
    } else if (subject === "galaxy") {
      art += `<circle cx="${f(cx)}" cy="${f(cy)}" r="30" fill="url(#${id}b)" opacity=".7"/>`;
      for (let i = 0; i < 70; i++) { const a = i * 0.38, d = 2 + i * 0.42; art += `<circle class="obs-big" cx="${f(cx + Math.cos(a + (i % 2) * Math.PI) * d)}" cy="${f(cy + Math.sin(a + (i % 2) * Math.PI) * d * 0.6)}" r="${f(0.4 + r() * 0.6)}" opacity="${f(0.4 + r() * 0.5)}"/>`; }
    } else art += `<circle cx="${f(cx)}" cy="${f(cy)}" r="26" fill="url(#${id}a)"/><circle class="obs-moon" cx="${f(cx)}" cy="${f(cy)}" r="20"/>`;
    return `<svg class="obs-cover" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="${id}a"><stop offset="0" class="obs-s1"/><stop offset=".55" class="obs-s2"/><stop offset="1" class="obs-s0"/></radialGradient><radialGradient id="${id}b"><stop offset="0" class="obs-s3"/><stop offset="1" class="obs-s0"/></radialGradient></defs><rect class="obs-bg" width="100" height="100"/>${art}</svg>`;
  }

  // ---- Bars: languages and folder sizes (their widths and colours set in code: the page's rules allow no style="…") ----
  function langBar(langs, key = 0) {
    const ls = (langs || []).filter((l) => l.lines > 0);
    const total = ls.reduce((s, l) => s + l.lines, 0) || 1;
    if (!ls.length) return "";
    const pct = (l) => Math.round((l.lines / total) * 100);
    return `<div class="obs-lang" role="img" aria-label="${esc(ls.slice(0, 5).map((l) => `${l.name} ${pct(l)}%`).join(", "))}">${ls.map((l) => `<i data-w="${((l.lines / total) * 100).toFixed(2)}" data-c="${langColour(l.name)}"></i>`).join("")}</div>${key ? `<div class="obs-key">${ls.slice(0, key).map((l) => `<span><i data-c="${langColour(l.name)}"></i>${esc(l.name)} <b>${pct(l)}%</b></span>`).join("")}</div>` : ""}`;
  }
  function widths(root) { for (const el of root.querySelectorAll("[data-w]")) el.style.setProperty("--w", `${el.dataset.w}%`); }

  async function copy(text, said = "Path copied") {
    try { await navigator.clipboard.writeText(text); toast(said); } catch (e) { toast("Couldn't copy: press and hold the words to copy them", true); }
  }

  // ---- The list ----
  const state = { q: "", cat: "All", sort: "recent" };
  const haystack = (p) => [p.name, p.tagline, p.goal, p.vision, p.kind, p.category, p.path, ...(p.stack || []), ...(p.features || []), ...(p.members || []).map((m) => `${m.name} ${m.path}`), ...((p.stats && p.stats.langs) || []).map((l) => l.name)].join(" ").toLowerCase();
  function visible(D) {
    const q = state.q.trim().toLowerCase();
    const ps = D.projects.filter((p) => (state.cat === "All" || p.category === state.cat) && (!q || q.split(/\s+/).every((w) => haystack(p).includes(w))));
    const key = { recent: (p) => -(p.stats && p.stats.newest ? new Date(p.stats.newest).getTime() : 0), lines: (p) => -((p.stats && p.stats.lines) || 0), disk: (p) => -((p.stats && p.stats.disk) || 0), name: (p) => String(p.name).toLowerCase() }[state.sort];
    return ps.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  const pill = (p) => `<span class="pill ${TONE[p.status] || ""}">${esc(STATUS[p.status] || p.status || "")}</span>${p.category ? `<span class="pill">${esc(p.category)}</span>` : ""}`;
  function deck(p) {
    const s = p.stats || {};
    const stack = (p.stack || []).slice(0, 5).map((t) => `<span class="obs-tag">${esc(t)}</span>`).join("") + ((p.stack || []).length > 5 ? `<span class="obs-tag">+${p.stack.length - 5}</span>` : "");
    return `<article class="card obs-deck" data-c="${OWN[p.theme] || "var(--hi)"}">
      <a class="obs-open" href="#observatory/${encodeURIComponent(p.id)}" aria-label="${esc(p.name)}: open details">
        <span class="obs-face">${cover(p)}</span>
        <span class="obs-head"><span class="obs-pills">${pill(p)}</span><b class="obs-name">${esc(p.name)}</b>${p.tagline ? `<span class="obs-tagline">${esc(p.tagline)}</span>` : ""}</span>
        ${stack ? `<span class="obs-stack">${stack}</span>` : ""}
        <span class="obs-figs"><span><b>${num(s.lines)}</b>Lines</span><span><b>${bytes(s.bytes)}</b>Size</span><span><b>${bytes(s.disk)}</b>On disk</span><span><b>${num(s.files)}</b>Files</span></span>
        ${langBar(s.langs)}
        <span class="obs-foot"><span>Changed <b>${esc(ago(s.newest))}</b>${p.git ? ` · <b>${num(p.git.commits)}</b> commits` : ""}</span>${p.kind ? `<span>${esc(p.kind)}</span>` : ""}</span>
      </a>
      ${p.path ? `<div class="obs-path">${icon("notes")}<span>${esc(home(p.path))}</span><button type="button" class="btn quiet obs-copy" data-copy="${esc(p.path)}">Copy</button></div>` : ""}
    </article>`;
  }
  function drawDecks(D, box) {
    const ps = visible(D);
    const decks = box.querySelector("[data-obs-decks]");
    decks.innerHTML = ps.length ? ps.map(deck).join("") : empty({ icon: "search", title: "No project matches that search", text: state.cat !== "All" ? `Searching ${state.cat} only.` : "" });
    widths(decks);
    box.querySelector("[data-obs-count]").textContent = ps.length === D.projects.length ? `${ps.length} project deck${ps.length === 1 ? "" : "s"}` : `${ps.length} of ${D.projects.length}`;
  }
  function drawList(D, box) {
    const t = D.totals || {};
    const inner = D.projects.reduce((s, p) => s + (p.group ? (p.members || []).length : 1), 0);
    const stats = [[num(t.lines), "Lines of code"], [bytes(t.bytes), "Project files"], [bytes(t.disk), "On disk"], [num(t.files), "Files"], [String((t.langs || []).length), "Languages"], [ago(t.newest, true), "Last activity"]];
    const cats = CATS.map((c) => [c, c === "All" ? D.projects.length : D.projects.filter((p) => p.category === c).length]).filter(([, n]) => n);
    box.innerHTML = `<div class="card obs-sum"><p class="kicker">Every project in one sky</p><p><b>${D.projects.length}</b> decks covering <b>${inner}</b> projects under <code>${esc(home(D.root))}</code>. Last scan ${esc(ago(D.generatedAt))}; latest change anywhere ${esc(ago(t.newest))}.</p>
        <div class="sums obs-stats">${stats.map(([v, l]) => `<div class="sum"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>
        ${(t.langs || []).length ? `<p class="kicker obs-k2">Lines of code by language</p>${langBar(t.langs, 9)}` : ""}</div>
      <form class="obs-find" role="search" data-obs-find>${N.field({ label: "Search projects", name: "q", type: "search", value: state.q, placeholder: "Search name, goal, stack, path…", attrs: 'autocomplete="off" enterkeyhint="search"' })}
        <div class="chips" role="group" aria-label="Category">${cats.map(([c, n]) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === state.cat}">${esc(c)}<span class="n">${n}</span></button>`).join("")}</div>
        <fieldset class="field"><legend>Sort by</legend><div class="seg">${SORTS.map(([v, l]) => `<label><input type="radio" name="sort" value="${v}"${v === state.sort ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset></form>
      <h3 class="h" data-obs-count></h3><div class="page-in" data-obs-decks></div>
      <p class="muted small obs-end">Observatory · part of Nova Agent · Novacane Studios<br>Scanned ${esc(when(D.generatedAt))} · refresh with <code>npm run build</code> (or <code>npm run scan</code> for numbers only), on the computer.</p>
      ${list([`<li><a class="row" href="#help/addresses"><span class="row-lead">${icon("globe")}</span><span class="row-main"><b>All links</b><span>Every Nova address, in the Manual</span></span><span class="row-end">${icon("next")}</span></a></li>`])}`;
    widths(box);
    const form = box.querySelector("[data-obs-find]");
    let timer = 0;
    form.elements.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.q = form.elements.q.value; drawDecks(D, box); }, 140); });
    form.addEventListener("submit", (e) => { e.preventDefault(); state.q = form.elements.q.value; drawDecks(D, box); form.elements.q.blur(); });
    form.addEventListener("change", (e) => { if (e.target.name === "sort") { state.sort = e.target.value; drawDecks(D, box); } });
    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]");
      if (!b) return;
      state.cat = b.dataset.cat;
      for (const c of form.querySelectorAll("[data-cat]")) c.setAttribute("aria-pressed", String(c === b));
      drawDecks(D, box);
    });
    drawDecks(D, box);
  }

  // ---- One project ----
  function crumbsOf(D, p) {
    const root = D.root || "";
    const path = String(p.path || "");
    const rel = path.startsWith(root) ? path.slice(root.length) : path;
    return `<span class="obs-crumbs"><b>${esc(home(root))}</b>${rel.split("/").filter(Boolean).map((s) => `<span aria-hidden="true">/</span><b>${esc(s)}</b>`).join("")}</span>`;
  }
  function tree(p) {
    if (!p.tree || !p.tree.length) return '<p class="muted small">No files yet.</p>';
    const max = Math.max(...p.tree.map((n) => n.bytes), 1);
    const line = (n, m) => `<span class="obs-bar" data-w="${Math.max(2, (n.bytes / m) * 100).toFixed(1)}"></span><span class="obs-nm">${esc(String(n.path).split("/").pop())}${n.dir ? "/" : ""}</span><span class="obs-sz">${bytes(n.bytes)} · ${num(n.files)} file${n.files === 1 ? "" : "s"}</span>`;
    const items = p.tree.map((n) => {
      if (!n.dir || !(n.children || []).length) return `<div class="obs-leaf">${line(n, max)}</div>`;
      const cmax = Math.max(...n.children.map((c) => c.bytes), 1);
      return `<details class="obs-dir"><summary>${line({ ...n, path: n.path }, max)}</summary><div class="obs-kids">${n.children.map((c) => `<div class="obs-leaf">${line(c, cmax)}</div>`).join("")}</div></details>`;
    }).join("");
    const ign = (p.ignored || []).length ? `<p class="muted small obs-ign-t">Not counted as the project's own code:</p><div class="obs-ign">${p.ignored.map((i) => `<span class="obs-tag">${esc(i.path)}/ · ${bytes(i.bytes)} · ${esc(i.kind === "vendored" ? "third-party code" : "dependencies or build output")}</span>`).join("")}</div>` : "";
    return `<div class="obs-tree">${items}</div>${ign}`;
  }
  function langTable(langs) {
    const ls = (langs || []).filter((l) => l.lines > 0);
    if (!ls.length) return "";
    const total = ls.reduce((s, l) => s + l.lines, 0);
    return `${langBar(ls)}<ul class="obs-langs">${ls.slice(0, 8).map((l) => `<li><i data-c="${langColour(l.name)}"></i><span>${esc(l.name)}</span><span>${num(l.lines)} lines</span><b>${Math.round((l.lines / total) * 100)}%</b></li>`).join("")}</ul>`;
  }
  // What to look at: the demo video first (only fetched when tapped), then the screenshots, else the drawn cover
  function items(p) {
    const out = [];
    const poster = p.media && p.media.poster ? mediaUrl(p, p.media.poster) : "";
    if (p.media && p.media.video) out.push({ type: "video", src: mediaUrl(p, p.media.video), poster, caption: "Demo" });
    for (const s of (p.media && p.media.shots) || []) out.push({ type: "image", src: mediaUrl(p, s.file), caption: s.caption || "Picture" });
    return out;
  }
  function stage(p, its, i) {
    const it = its[i];
    if (!it) return `<div class="obs-view obs-drawn">${cover(p)}<span class="obs-cap">Drawn cover</span></div>`;
    if (it.type === "video") {
      // (the poster picture until you tap Play: the video itself isn't downloaded before then)
      return `<div class="obs-view">${it.poster ? `<img src="${esc(it.poster)}" alt="" loading="lazy" decoding="async" width="1280" height="720">` : cover(p)}<button type="button" class="btn main obs-play" data-obs-play>${icon("play")} Play the demo</button></div>`;
    }
    return `<div class="obs-view"><img src="${esc(it.src)}" alt="${esc(it.caption)}" loading="lazy" decoding="async" width="1280" height="720"><span class="obs-cap">${esc(it.caption)}</span></div>`;
  }
  // (a picture that isn't there shows the drawn cover instead of a broken image)
  function fallbacks(root, p) {
    for (const img of root.querySelectorAll(".obs-view img")) img.addEventListener("error", () => { const v = img.closest(".obs-view"); if (v) { img.replaceWith(document.createRange().createContextualFragment(cover(p))); v.classList.add("obs-drawn"); const cap = v.querySelector(".obs-cap"); if (cap) cap.textContent = `${cap.textContent} (not on this server: drawn cover)`; } }, { once: true });
  }
  function drawProject(D, p, box) {
    const s = p.stats || {};
    const g = p.git;
    const its = items(p);
    const facts = [
      p.path ? ["Location", `${crumbsOf(D, p)}<button type="button" class="btn obs-cp" data-copy="${esc(p.path)}">Copy path</button>`] : null,
      p.kind ? ["Kind", esc(p.kind)] : null,
      ["On disk", `${bytes(s.disk)} <small>· everything, including dependencies and builds</small>`],
      ["Project files", `${bytes(s.bytes)} in ${num(s.files)} files · <b>${num(s.lines)}</b> lines of code <small>· not counting dependencies, builds or vendored code</small>`],
      ["Last change", s.newest ? `${esc(ago(s.newest))} <small>· ${esc(when(s.newest))}${s.newestFile ? ` · ${esc(s.newestFile)}` : ""}</small>` : "—"],
      g ? ["Git", `<code>${esc(g.branch || "")}</code> · ${num(g.commits)} commits${g.dirty ? ` · ${g.dirty} uncommitted` : ""}${g.last ? `<br><code>${esc(g.last.hash)}</code> ${esc(g.last.subject)} <small>(${esc(ago(g.last.date))})</small>` : ""}${g.remote ? `<br><a href="${esc(g.remote)}" target="_blank" rel="noopener">${esc(g.remote.replace(/^https?:\/\//, ""))} ↗</a>` : ""}`] : null,
      p.run ? ["Run it", `<code>${esc(p.run)}</code>`] : null,
      p.media ? ["Captured", `${esc(when(p.media.captured))} · ${p.media.mode === "images" ? "slideshow of existing pictures" : "recorded in headless Chromium"}`] : null,
    ].filter(Boolean);
    const note = (p.media && p.media.note) || (p.capture && p.capture.note) || (!p.media && p.status !== "empty" && !p.group ? "No screenshots captured yet for this one." : "");
    box.innerHTML = `<div class="card obs-top" data-c="${OWN[p.theme] || "var(--hi)"}"><p class="obs-pills">${pill(p)}</p><h2 class="card-title">${esc(p.name)}</h2>${p.tagline ? `<p class="obs-tagline">${esc(p.tagline)}</p>` : ""}</div>
      <div data-obs-stage>${stage(p, its, 0)}</div>
      ${its.length > 1 ? `<div class="chips obs-thumbs" role="group" aria-label="Pictures">${its.map((it, i) => `<button type="button" class="chip" data-obs-i="${i}" aria-pressed="${i === 0}">${it.type === "video" ? `${icon("play")} ` : ""}${esc(it.caption)}</button>`).join("")}</div>` : ""}
      ${note ? `<p class="muted small obs-note">${esc(note)}</p>` : ""}
      ${p.goal ? `<div class="card"><p class="kicker">Goal</p><p>${esc(p.goal)}</p></div>` : ""}
      ${p.vision ? `<div class="card"><p class="kicker">Vision</p><p class="obs-vision">${esc(p.vision)}</p></div>` : ""}
      ${(p.features || []).length ? `<div class="card"><p class="kicker">What it does</p><ul class="obs-features">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
      ${(p.stack || []).length ? `<div class="card"><p class="kicker">Stack</p><div class="obs-stack">${p.stack.map((t) => `<span class="obs-tag">${esc(t)}</span>`).join("")}</div></div>` : ""}
      <div class="card"><p class="kicker">Facts</p><dl class="obs-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl></div>
      ${p.group ? `<h3 class="h">Members · ${(p.members || []).length}</h3><ul class="list">${(p.members || []).map((m) => `<li><div class="row"><span class="row-lead">${icon("star")}</span><span class="row-main"><b>${esc(m.name)}</b><span>${esc(home(m.path))}</span></span><span class="row-end"><span>${num(m.lines)} lines</span><span>${bytes(m.bytes)}</span><span>${esc(ago(m.newest))}</span></span></div></li>`).join("")}</ul>` : ""}
      <div class="card"><p class="kicker">Folder tree</p>${p.group ? '<p class="muted small">See the members list.</p>' : tree(p)}</div>
      ${s.langs && s.langs.some((l) => l.lines) ? `<div class="card"><p class="kicker">Languages</p>${langTable(s.langs)}</div>` : ""}
      ${(p.related || []).length ? `<h3 class="h">Related</h3><ul class="list">${p.related.map((r) => `<li><button type="button" class="row" data-copy="${esc(r.path)}"><span class="row-lead">${icon("notes")}</span><span class="row-main"><b>${esc(r.label)}</b><span>${esc(home(r.path))}${r.disk ? ` · ${bytes(r.disk)}` : ""}</span></span><span class="row-end">Copy</span></button></li>`).join("")}</ul>` : ""}
      <p class="muted small obs-end">Scanned ${esc(when(D.generatedAt))} · refresh with <code>npm run build</code> on the computer.</p>`;
    widths(box);
    fallbacks(box, p);
    const st = box.querySelector("[data-obs-stage]");
    const show = (i) => {
      st.innerHTML = stage(p, its, i);
      fallbacks(st, p);
      for (const c of box.querySelectorAll("[data-obs-i]")) c.setAttribute("aria-pressed", String(Number(c.dataset.obsI) === i));
    };
    box.addEventListener("click", (e) => {
      const t = e.target.closest("[data-obs-i]");
      if (t) return show(Number(t.dataset.obsI));
      if (e.target.closest("[data-obs-play]")) {
        const it = its.find((x) => x.type === "video");
        const v = document.createElement("video");
        Object.assign(v, { src: it.src, controls: true, muted: true, loop: true, playsInline: true, preload: "auto" });
        if (it.poster) v.poster = it.poster;
        v.setAttribute("playsinline", "");
        v.addEventListener("error", () => { toast("The demo video isn't on this server", true); show(0); }, { once: true });
        st.querySelector(".obs-view").replaceChildren(v);
        v.play().catch(() => {});
        // (stopped when you leave the page or the app)
        const pause = () => { if (!v.isConnected) { removeEventListener("hashchange", pause); document.removeEventListener("visibilitychange", hide); } v.pause(); };
        const hide = () => { if (document.hidden || !v.isConnected) pause(); };
        addEventListener("hashchange", pause, { once: true });
        document.addEventListener("visibilitychange", hide);
      }
    });
  }

  N.section({
    id: "observatory", name: "Observatory", tile: "observatory",
    async draw(box, [id], ui) {
      await N.css("observatory.css");
      ui.action({ icon: "book", label: "The Observatory's page in the Manual", href: "#help/for/observatory" });
      let D;
      try { D = await loadData("/observatory/data/projects.js", "OBSERVATORY"); } catch (err) { if (window.OBSERVATORY_LOCKED) throw Object.assign(new Error("Sign in first"), { signIn: true }); throw err; }
      // Online, the projects are for the studio's staff: Nova Bot sends a lock instead until you sign in
      if (window.OBSERVATORY_LOCKED && !D) throw Object.assign(new Error("Sign in first"), { signIn: true });
      if (!D || !Array.isArray(D.projects)) {
        box.innerHTML = empty({ icon: "star", title: "No scan data yet", text: "Run npm run scan in the Observatory's folder on the computer (or npm run build for screenshots and video too), then open this again." });
        return;
      }
      box.addEventListener("click", (e) => { const c = e.target.closest("[data-copy]"); if (c) { e.preventDefault(); copy(c.dataset.copy); } });
      if (id) {
        ui.back("#observatory");
        const p = D.projects.find((x) => x.id === decodeURIComponent(id));
        if (!p) { box.innerHTML = empty({ icon: "star", title: "That project isn't there", action: '<a class="btn" href="#observatory">Every project</a>' }); return; }
        ui.title(p.name);
        drawProject(D, p, box);
        return;
      }
      drawList(D, box);
    },
  });
})();
