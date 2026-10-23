// The phone preview's Index: made-up memory (no real people) for every address Index uses: the files, one file,
// saving (with "changed since you opened it" when the version doesn't match), deleting, the numbers, facts
// waiting to approve, Ask Index, and Tidy up's check, apply, bin and put back. Kept in memory.
(() => {
  "use strict";
  const sec = (mins) => Math.floor((Date.now() - mins * 60000) / 1000);
  let v = 10;
  const file = (scope, owner_id, path, name, description, body, mins, source_app, more = {}) => ({ id: `f${++v}`, scope, owner_id, path, name, description, body, version: `v${v}`, updated_at: sec(mins), source_app, aliases: [], editable: true, ...more });
  const files = [
    file("studio", null, "studio", "", "How the studio runs", "- [stated] Doors open at 9:30 on weekdays\n- [stated] The live room needs booking a week ahead\n- [observed] Evening sessions fill up first", 12, "Portal"),
    file("studio", null, "public", "", "Studio facts customers may be told", "- [stated] Vocal sessions are £40 an hour\n- [stated] A full day is £280", 300, "Portal"),
    file("studio", null, "topics/pricing", "Pricing", "What things cost", "- [stated] Vocal sessions are £40 an hour\n- [stated] A full day is £280\n- [inferred] Most bands book half days\n- [stated] Mixing is £120 a song", 800, "NovaAgent", { aliases: ["prices", "rates"] }),
    file("studio", null, "areas/lowlands-ep", "Lowlands EP", "The EP release", "- [stated] Four songs, out in spring\n- [observed] Kai mixes it in the evenings", 3000, "NovaAgent"),
    file("studio", null, "people/kai", "Kai", "Kai: producer, books evening sessions", "- [stated] Producer on the Lowlands EP\n- [observed] Books evening sessions", 400000, "Portal"),
    file("studio", null, "people/kai-m", "Kai M", "Kai Morgan", "- [stated] Plays bass on Night Drive", 5000, "NovaAgent"),
    file("staff", "jordan", "profile", "", "About Jordan", "- [stated] Engineer, mostly in Studio A\n- [stated] Prefers morning sessions", 60, "NovaAgent"),
    file("staff", "jordan", "topics/mic-choices", "Mic choices", "Which mic for which voice", "- [inferred] The U87 suits Maya's voice", 1500, "NovaAgent"),
    file("customer", "maya@example.com", "profile", "", "Maya Rose, singer", "- [stated] Singer-songwriter\n- [observed] Books vocal days on Saturdays\n- [stated] Prefers evening sessions", 42, "NovaBot", { aliases: ["Maya"] }),
    file("customer", "chat:ab12cd34ef56", "profile", "", "A website visitor asking about podcasts", "- [stated] Wants to record a podcast for four people", 200, "NovaBot", { editable: false }),
  ];
  const facts = (f) => String(f.body).split("\n").filter((l) => /^- \[/.test(l)).length;
  const listed = (f) => { const { body, ...rest } = f; return { ...rest, facts: facts(f) }; };
  let pending = [
    { id: "p1", fact: "Maya prefers morning sessions now", tag: "observed", scope: "customer", owner_id: "maya@example.com", target: "profile", created_at: sec(30), source_app: "NovaBot", source_ref: "chat-7f3a9c21" },
    { id: "p2", fact: "The Lanterns want Friday evenings", tag: "stated", scope: "customer", owner_id: "band@example.com", target: "profile", created_at: sec(300), source_app: "Portal" },
  ];
  let removed = [
    { id: "r1", kind: "line", text: "- [stated] n/a", scope: "studio", owner_id: null, path: "topics/pricing", reason: "a placeholder", removed_by: "Jordan", removed_at: sec(2000) },
    { id: "r2", kind: "file", text: "people/tmp", scope: "studio", owner_id: null, path: "people/tmp", reason: "it has no facts", removed_by: "Jordan", removed_at: sec(3000), restored_at: sec(2500), restored_by: "Sam" },
  ];
  const runs = [{ applied_at: sec(2000), applied_by: "Jordan", removed: 2, skipped: 0, checked_by: "Jordan" }];
  const find = (u) => files.find((f) => f.scope === u.searchParams.get("scope") && (f.owner_id || "") === (u.searchParams.get("owner_id") || "") && f.path === u.searchParams.get("path"));
  window.NovaSampleIndex = { files };
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (!p.startsWith("/app/api/memory/")) return undefined;
    const r = p.slice("/app/api/memory".length);
    if (r === "/index") {
      const q = (u.searchParams.get("q") || "").toLowerCase();
      if (!q) return { files: files.map(listed).sort((a, b) => b.updated_at - a.updated_at), at: Date.now(), admin: true };
      return { files: files.filter((f) => f.body.toLowerCase().includes(q) || (f.name || "").toLowerCase().includes(q)).map((f) => ({ ...listed(f), matches: f.body.split("\n").filter((l) => l.toLowerCase().includes(q)) })), admin: true };
    }
    if (r === "/stats") {
      const by = {};
      for (const f of files) { by[f.scope] ||= { scope: f.scope, files: 0, facts: 0 }; by[f.scope].files++; by[f.scope].facts += facts(f); }
      return { scopes: Object.values(by), pending: pending.length, admin: true };
    }
    if (r === "/file" && method === "GET") { const f = find(u); return f ? { file: { ...f, facts: facts(f) } } : { status: 404, body: { error: "No such file" } }; }
    if (r === "/file" && method === "PUT") {
      const f = files.find((x) => x.scope === body.scope && (x.owner_id || "") === (body.owner_id || "") && x.path === body.path);
      if (body.if_version === "new") {
        if (f) return { status: 409, body: { error: "Changed since you read it", current: { ...f, facts: facts(f) } } };
        const nf = file(body.scope, body.owner_id, body.path, body.name, body.description, body.body, 0, "Index");
        files.unshift(nf);
        return { ok: true, file: { ...nf, facts: facts(nf) }, dropped: 0 };
      }
      if (!f) return { status: 409, body: { error: "Changed since you read it" } };
      if (f.version !== body.if_version) return { status: 409, body: { error: "Changed since you read it", current: { ...f, facts: facts(f) } } };
      // (lines that aren't facts, or "n/a", are left out, as on the server)
      const lines = String(body.body).split("\n").filter((l) => l.trim());
      const kept = lines.filter((l) => /^- \[(stated|observed|inferred)\] /.test(l) && !/\bn\/a\b/i.test(l));
      Object.assign(f, { description: body.description, aliases: body.aliases, body: kept.join("\n"), version: `v${++v}`, updated_at: sec(0), source_app: "Index" });
      const dropped = lines.length - kept.length;
      return { ok: true, file: { ...f, facts: facts(f) }, dropped, ...(dropped ? { note: `${dropped} line${dropped === 1 ? " was" : "s were"} left out: placeholders like “n/a” aren't facts.` } : {}) };
    }
    if (r === "/file" && method === "DELETE") { const f = find(u); if (f) files.splice(files.indexOf(f), 1); return { ok: true }; }
    if (r === "/pending" && method === "GET") return { pending: JSON.parse(JSON.stringify(pending)) };
    const pm = r.match(/^\/pending\/(.+)$/);
    if (pm && method === "POST") {
      const it = pending.find((x) => x.id === decodeURIComponent(pm[1]));
      if (!it) return { status: 404, body: { error: "Already dealt with" } };
      pending = pending.filter((x) => x !== it);
      if (body.action !== "approve") return { ok: true, rejected: true };
      const f = files.find((x) => x.scope === it.scope && x.owner_id === it.owner_id && x.path === it.target);
      if (f) { f.body += `\n- [${it.tag}] ${body.fact || it.fact}`; f.version = `v${++v}`; f.updated_at = sec(0); }
      return { ok: true, file: f ? listed(f) : null };
    }
    if (r === "/ask") {
      const q = String(body.q || "").toLowerCase();
      const fs = [];
      for (const f of files) for (const l of f.body.split("\n")) { const m = l.match(/^- \[(\w+)\] (.+)$/); if (m && q.split(/\W+/).some((w) => w.length > 3 && m[2].toLowerCase().includes(w.replace(/s$/, "")))) fs.push({ n: fs.length + 1, scope: f.scope, owner_id: f.owner_id, path: f.path, name: f.name || f.path, tag: m[1], fact: m[2] }); }
      if (!fs.length) return { answer: null, facts: [], used: [], note: "Index doesn't remember anything about that yet." };
      return { answer: `From what's remembered: ${fs[0].fact} [1]${fs[1] ? `, and ${fs[1].fact.toLowerCase()} [2]` : ""}.`, facts: fs.slice(0, 8), used: fs[1] ? [1, 2] : [1], ai: true };
    }
    if (r === "/cleanup/check") return { report: { id: "rep1", counts: { total: 2 }, keeps: "Nothing that's a real fact is touched.", items: [
      { id: "line:1", kind: "repeat-line", reason: "the same fact twice", scope: "studio", owner_id: null, path: "public", text: "- [stated] A full day is £280", kept: "- [stated] A full day is £280" },
      { id: "pending:p9", kind: "junk-pending", reason: "a cut-off sentence", scope: "customer", owner_id: "maya@example.com", path: "profile", text: "- [stated] Wants to" },
    ] } };
    if (r === "/cleanup/apply") { removed = [{ id: `r${removed.length + 3}`, kind: "line", text: "- [stated] A full day is £280", scope: "studio", owner_id: null, path: "public", reason: "the same fact twice", removed_by: "You", removed_at: sec(0) }, ...removed]; runs.unshift({ applied_at: sec(0), applied_by: "You", removed: 2, skipped: 0, checked_by: "You" }); return { ok: true, removed: 2, skipped: [], bin_days: 30 }; }
    if (r === "/cleanup/removed") return { removed: JSON.parse(JSON.stringify(removed)), runs };
    const rs = r.match(/^\/cleanup\/removed\/(.+)\/restore$/);
    if (rs) { const it = removed.find((x) => x.id === rs[1]); if (it) Object.assign(it, { restored_at: sec(0), restored_by: "You" }); return { ok: true }; }
    return undefined;
  });
})();
