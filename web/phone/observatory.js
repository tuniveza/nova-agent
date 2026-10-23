// Nova Phone: the Observatory, the studio's projects: what each is, its numbers, its pictures. Its data loads
// only when it's opened.
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

})();
