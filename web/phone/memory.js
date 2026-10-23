// Nova Phone: Index, what Nova remembers (Nova Desk's Index at /app/memory/). One-line facts, each tagged
// stated (someone said it), observed (Nova saw it) or inferred (Nova worked it out), kept in files by scope:
// the studio's, each staff member's, each customer's. Ask Index a question; browse and search the files; open
// one to add, change or remove facts (saved only if nobody changed it meanwhile); a new file; and, for admins,
// facts Nova noticed about customers, waiting to be approved.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const M = "/app/api/memory";
  const H = { "X-Nova-App": "index" };
  const get = (p) => api(`${M}${p}`, { headers: H });
  const TAGS = [["stated", "Stated"], ["observed", "Observed"], ["inferred", "Inferred"]];
  const SCOPES = [["studio", "Studio"], ["staff", "Staff"], ["customer", "Customers"]];
  const KINDS = { studio: ["studio", "public", "people", "topics", "areas"], staff: ["profile", "people", "topics", "areas", "studio"], customer: ["profile", "people", "topics"] };
  const KIND_HELP = { studio: "How the studio runs (only the team sees it)", public: "Studio facts customers may be told", profile: "About this person themselves", people: "Someone they work with or talk about", topics: "A subject: pricing, gear, a process", areas: "An ongoing piece of work, like an EP release" };
  const NAMED = ["people", "topics", "areas"];
  const parse = (body) => String(body || "").split("\n").map((l) => l.trim().match(/^-\s*\[(stated|observed|inferred)\]\s*(.+)$/i)).filter(Boolean).map((m) => ({ tag: m[1].toLowerCase(), fact: m[2].trim() }));
  const bodyOf = (facts) => facts.filter((f) => f.fact.trim()).map((f) => `- [${f.tag}] ${f.fact.replace(/\s+/g, " ").trim()}`).join("\n");
  const q = (f) => `scope=${encodeURIComponent(f.scope)}&owner_id=${encodeURIComponent(f.owner_id || "")}&path=${encodeURIComponent(f.path)}`;
  let scope = "studio", search = "", files = [], admin = false;

  N.section({
    id: "index", name: "Index", tile: "index",
    async draw(box, [part, a], ui) {
      if (part === "file") return drawFile(box, a, ui);
      if (part === "approve") return drawPending(box, ui);
      if (part === "new") return drawNew(box, ui);
      const [r, stats] = await Promise.all([get(`/index${search ? `?q=${encodeURIComponent(search)}` : ""}`), get("/stats").catch(() => ({}))]);
      files = r.files || [];
      admin = !!(r.admin || stats.admin);
      ui.action({ icon: "plus", label: "New file", href: "#index/new" });
      const shown = files.filter((f) => f.scope === scope).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
      box.innerHTML = `<form class="form card" id="ask"><p class="kicker">Ask Index</p><label class="field"><span class="sr">Your question</span><input class="input" name="q" placeholder="What does Maya usually book?" autocomplete="off"></label><button class="btn main wide" type="submit">${icon("search")} Ask</button><div id="answer"></div></form>
        ${admin && stats.pending ? `<a class="card" href="#index/approve"><p class="kicker">Waiting to approve</p><p><b>${stats.pending} fact${stats.pending > 1 ? "s" : ""} Nova noticed about customers</b></p></a>` : ""}
        <div class="seg">${SCOPES.map(([s, l]) => `<button type="button" class="seg-a" data-scope="${s}" aria-selected="${s === scope}">${l}</button>`).join("")}</div>
        <form class="search" data-mem-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search the files"></label></form>
        ${shown.length ? list(shown.map((f) => row({ href: `#index/file/${encodeURIComponent(JSON.stringify([f.scope, f.owner_id || "", f.path]))}`, lead: window.NovaTile ? window.NovaTile("index") : icon("book"), title: f.name || f.path, text: [f.description, `${f.facts || 0} fact${f.facts === 1 ? "" : "s"}`, f.owner_name].filter(Boolean).join(" · "), end: esc(ago(f.updated_at)) }))) : empty({ icon: "book", title: search ? `Nothing matches “${search}”` : "No files here yet" })}`;
      box.querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => { scope = b.dataset.scope; N.show(); }));
      box.querySelector("[data-mem-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
      box.querySelector("#ask").addEventListener("submit", async (e) => {
        e.preventDefault();
        const question = e.target.elements.q.value.trim(), out = box.querySelector("#answer");
        if (!question) return;
        out.innerHTML = `<p class="muted small">Looking…</p>`;
        try { const r2 = await api(`${M}/ask`, { method: "POST", headers: H, body: JSON.stringify({ q: question }) }); out.innerHTML = `<p class="pre">${esc(r2.answer || "Index doesn't know that yet.")}</p>${(r2.facts || []).length ? `<ul class="acts">${r2.facts.slice(0, 6).map((f) => `<li>${esc(f.fact || f.text || f)}</li>`).join("")}</ul>` : ""}${r2.note ? `<p class="muted small">${esc(r2.note)}</p>` : ""}`; }
        catch (err) { out.innerHTML = `<p class="bad small">${esc(err.message)}</p>`; }
      });
    },
  });

  async function drawFile(box, key, ui) {
    ui.back("#index");
    const [sc, owner, path] = JSON.parse(decodeURIComponent(key));
    const f = (await get(`/file?${q({ scope: sc, owner_id: owner, path })}`)).file;
    if (!f) { box.innerHTML = empty({ icon: "book", title: "That file isn't there any more" }); return; }
    ui.title(f.name || f.path);
    let facts = parse(f.body);
    const editable = f.editable !== false;
    const draw = () => {
      box.innerHTML = `<div class="card"><p class="kicker">${esc(SCOPES.find(([s]) => s === f.scope)?.[1] || f.scope)} · ${esc(f.path)}</p><h2 class="card-title">${esc(f.name || f.path)}</h2>${f.description ? `<p class="muted">${esc(f.description)}</p>` : ""}<p class="muted small">Changed ${esc(ago(f.updated_at))}</p></div>
        ${facts.length ? list(facts.map((x, i) => row({ button: editable ? `data-fact="${i}"` : "", lead: `<span class="pill">${esc(x.tag)}</span>`, title: x.fact }))) : empty({ icon: "book", title: "No facts yet" })}
        ${editable ? `<button type="button" class="btn wide" data-add>${icon("plus")} Add a fact</button><button type="button" class="btn main wide" data-save hidden>${icon("check")} Save the file</button><button type="button" class="btn danger wide" data-delete>${icon("trash")} Delete the file</button>` : `<p class="muted small">Only its owner or an admin changes this file.</p>`}`;
      box.querySelector("[data-add]")?.addEventListener("click", () => editFact(-1));
      box.querySelectorAll("[data-fact]").forEach((b) => b.addEventListener("click", () => editFact(Number(b.dataset.fact))));
      box.querySelector("[data-save]")?.addEventListener("click", save);
      box.querySelector("[data-delete]")?.addEventListener("click", del);
      if (changed) box.querySelector("[data-save]").hidden = false;
    };
    let changed = false;
    const editFact = async (i) => {
      const x = facts[i] || { tag: "stated", fact: "" };
      const v = await sheetForm(`<h2 class="sheet-title">${i < 0 ? "Add a fact" : "Change the fact"}</h2><form class="form" data-f>${field({ label: "The fact (one line)", name: "fact", value: x.fact })}<fieldset class="field"><legend>How Nova knows it</legend><div class="seg">${TAGS.map(([t, l]) => `<label><input type="radio" name="tag" value="${t}"${t === x.tag ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset>
        <div class="btns"><button class="btn main wide" type="submit" value="save">OK</button>${i >= 0 ? `<button class="btn danger wide" type="submit" value="remove">Remove this fact</button>` : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const e2 = ev.target.elements; done({ how: ev.submitter?.value, fact: e2.fact.value.trim(), tag: [...e2].find((r) => r.name === "tag" && r.checked)?.value || "stated" }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      if (v.how === "remove") facts.splice(i, 1);
      else if (v.fact) { if (i < 0) facts.push({ tag: v.tag, fact: v.fact }); else facts[i] = { tag: v.tag, fact: v.fact }; }
      changed = true;
      draw();
    };
    const save = async (e) => busy(e.currentTarget, "Saving…", async () => {
      try {
        const r = await api(`${M}/file`, { method: "PUT", headers: H, body: JSON.stringify({ scope: f.scope, owner_id: f.scope === "studio" ? null : f.owner_id, path: f.path, name: f.name, description: f.description || "", aliases: f.aliases || [], body: bodyOf(facts), if_version: f.version }) });
        Object.assign(f, r.file || {});
        changed = false; toast(r.dropped?.length ? `Saved (${r.dropped.length} line${r.dropped.length > 1 ? "s" : ""} weren't facts and were left out)` : "Saved"); draw();
      } catch (err) {
        if (err.status === 409) { toast("Someone changed it meanwhile: showing theirs. Make your change again.", true); N.show(); }
        else toast(err.message, true);
      }
    });
    const del = async () => {
      if (!(await confirm({ title: `Delete “${f.name || f.path}”?`, ok: "Delete", danger: true }))) return;
      try { await api(`${M}/file?${q(f)}`, { method: "DELETE", headers: H }); toast("Deleted"); location.hash = "#index"; } catch (err) { toast(err.message, true); }
    };
    draw();
  }

  async function drawPending(box, ui) {
    ui.back("#index");
    ui.title("Waiting to approve");
    const r = await get("/pending");
    const ps = r.pending || [];
    box.innerHTML = ps.length ? ps.map((p) => `<div class="card"><p class="kicker">${esc(p.tag || "")} · ${esc(p.scope || "")} · ${esc(ago(p.created_at))}</p><p><b>${esc(p.fact)}</b></p>${p.source_app ? `<p class="muted small">From ${esc(p.source_app)}</p>` : ""}
        <div class="btns two"><button type="button" class="btn main" data-pa="approve" data-id="${esc(p.id)}">${icon("check")} Approve</button><button type="button" class="btn" data-pa="edit" data-id="${esc(p.id)}">${icon("edit")} Change it</button><button type="button" class="btn danger" data-pa="reject" data-id="${esc(p.id)}">Reject</button></div></div>`).join("") : empty({ icon: "check", title: "Nothing waiting" });
    box.querySelectorAll("[data-pa]").forEach((b) => b.addEventListener("click", async () => {
      const p = ps.find((x) => String(x.id) === b.dataset.id);
      let body = { action: b.dataset.pa === "reject" ? "reject" : "approve" };
      if (b.dataset.pa === "edit") {
        const v = await sheetForm(`<h2 class="sheet-title">Change it, then approve</h2><form class="form" data-f>${field({ label: "The fact", name: "fact", value: p.fact })}<div class="btns"><button class="btn main wide" type="submit">Approve the changed fact</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
          (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.fact.value.trim()); }; el.querySelector("[data-no]").onclick = () => done(null); });
        if (!v) return;
        body = { action: "approve", fact: v };
      }
      try { await api(`${M}/pending/${encodeURIComponent(p.id)}`, { method: "POST", headers: H, body: JSON.stringify(body) }); toast(body.action === "approve" ? "Approved" : "Rejected"); N.show(); } catch (err) { toast(err.message, true); }
    }));
  }

  async function drawNew(box, ui) {
    ui.back("#index");
    ui.title("New file");
    const me = (await api("/auth/me")).staff;
    box.innerHTML = `<form class="form" id="nf" novalidate>
        ${field({ label: "Whose", name: "scope", type: "select", value: "studio", options: [["studio", "The studio's"], ["staff", "Mine"]] })}
        ${field({ label: "What kind", name: "kind", type: "select", value: "topics", options: KINDS.studio.map((k) => [k, `${k[0].toUpperCase()}${k.slice(1)}: ${KIND_HELP[k]}`]) })}
        ${field({ label: "Name", name: "name", placeholder: "Pricing, Maya Rose, Lowlands EP…" })}
        ${field({ label: "What's in it (one line)", name: "description" })}
        ${field({ label: "The first fact", name: "fact" })}
        <p class="form-said" id="nf-said" role="status"></p><button class="btn main wide" type="submit">${icon("check")} Make the file</button></form>`;
    const f = box.querySelector("#nf");
    f.elements.scope.addEventListener("change", () => { f.elements.kind.innerHTML = KINDS[f.elements.scope.value].map((k) => `<option value="${k}">${k[0].toUpperCase()}${k.slice(1)}: ${esc(KIND_HELP[k])}</option>`).join(""); });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const x = f.elements, said = box.querySelector("#nf-said"), kind = x.kind.value, name = x.name.value.trim();
      if (NAMED.includes(kind) && !name) { said.textContent = "Give it a name."; said.classList.add("bad"); return; }
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "notes";
      const path = NAMED.includes(kind) ? `${kind}/${slug}` : kind;
      await busy(f.querySelector("[type=submit]"), "Making…", async () => {
        try {
          await api(`${M}/file`, { method: "PUT", headers: H, body: JSON.stringify({ scope: x.scope.value, owner_id: x.scope.value === "studio" ? null : me.id, path, name: NAMED.includes(kind) ? name : "", description: x.description.value.trim(), aliases: [], body: x.fact.value.trim() ? `- [stated] ${x.fact.value.trim()}` : "", if_version: "new" }) });
          toast("File made"); location.hash = `#index/file/${encodeURIComponent(JSON.stringify([x.scope.value, x.scope.value === "studio" ? "" : me.id, path]))}`;
        } catch (err) { said.textContent = err.status === 409 ? "There's already a file like that." : `Not made: ${err.message}`; said.classList.add("bad"); }
      });
    });
  }
})();
