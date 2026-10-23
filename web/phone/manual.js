// Nova Phone: the Manual (Nova Desk's Manual on a phone): every app's guide, how it's built, what's new, its
// history, and every web address, searchable. Its content loads only when it's opened.
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

})();
