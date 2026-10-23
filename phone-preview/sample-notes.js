// Nova Phone preview: made-up answers for Notes (the shared notes, Quests from a note, Google Docs). No real people.
(() => {
  const iso = (secsAgo) => new Date(Date.now() - secsAgo * 1000).toISOString();
  let rev = 20;
  const ME = { id: 1, name: "Jordan" };
  const rich = `<p class="title">Session plan</p><p class="subtitle" style="text-align: left">For the Lowlands EP</p><h1 style="text-align: left">Before we start</h1><ul class="nn-check"><li class="checked">Warm up the desk</li><li>Check the talkback</li><li>Label the stems</li></ul><h3 data-task="working" data-qid="nq1" data-qkey="k1lowl" data-qsync="working">QUEST: Finish the vocal comp</h3><p>Use takes 3 and 5 for the chorus. <span style="color: #ff5fa8">Pink</span> means keep, <span style="background-color: #f2d9a0">gold</span> means check again.</p><p style="text-align: right; line-height: 1.5"><span style="font-family: 'Georgia'; font-size: 14pt">Kick needs more weight on track 2.</span> <a href="https://example.com/reference">The reference mix</a></p><ol start="3"><li>Bounce the rough</li><li>Send it to Kai</li></ol><blockquote>Leave space for the song.</blockquote><hr class="page-break"><table class="nn-table"><tbody><tr><th>Track</th><th style="text-align: left">Notes</th></tr><tr><td>1</td><td style="text-align: left">Done</td></tr><tr><td colspan="2">Track 2: bass and kick</td></tr></tbody></table><h2 data-task="waiting">QUEST: Book the mastering</h2><p>Ask about the 14th.</p>`;
  const store = new Map([
    ["n1", { id: "n1", title: "Session plan", html: rich, updated: iso(300), created: iso(90000), pinned: true, named: true, rev: 18, by: "Sam", gdocId: "", gdocUrl: "", gdocKeep: false }],
    ["n2", { id: "n2", title: "Lowlands EP notes", html: "<p>Kick needs more weight on track 2. Vocals sit well.</p>", updated: iso(1500), created: iso(5000), pinned: false, named: true, rev: 12, by: "Jordan", gdocId: "", gdocUrl: "", gdocKeep: false }],
    ["n3", { id: "n3", title: "Gear to buy", html: "<ul><li>Pop filter</li><li>Two XLR cables</li></ul>", updated: iso(86400 * 3), created: iso(86400 * 9), pinned: false, named: false, rev: 7, by: "Sam", gdocId: "d-123", gdocUrl: "https://docs.google.com/document/d/d-123/edit", gdocKeep: true }],
  ]);
  const quests = [{ id: "nq1", title: "QUEST: Finish the vocal comp", mode: "working", link: "note:n1|k1lowl", phones: [] }];
  const out = (n) => ({ ...n });
  const deleted = new Map();
  window.NovaNotesSample = { store, quests };
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/notes-api/changes") {
      const since = Number(u.searchParams.get("since") || 0);
      const list = [...store.values()].filter((n) => n.rev > since).map(out).concat([...deleted.values()].filter((n) => n.rev > since));
      return { notes: list.sort((a, b) => a.rev - b.rev), cursor: String(rev), more: false, me: ME };
    }
    const m = p.match(/^\/notes-api\/notes\/([\w-]+)$/);
    if (m && method === "PUT") {
      const id = m[1], row = store.get(id), now = new Date().toISOString();
      const note = { id, title: body.title, html: body.html, created: body.created || now, updated: body.updated || now, pinned: !!body.pinned, named: !!body.named, gdocId: body.gdocId || "", gdocUrl: body.gdocUrl || "", gdocKeep: body.gdocKeep === true, by: ME.name };
      if (!row && (!deleted.has(id) || body.base === deleted.get(id).rev)) { deleted.delete(id); store.set(id, { ...note, rev: ++rev }); return { note: out(store.get(id)) }; }
      if (row && body.base === row.rev) { store.set(id, { ...note, rev: ++rev }); return { note: out(store.get(id)) }; }
      const copyId = `${id.slice(0, 40)}-c${Math.random().toString(36).slice(2, 10)}`;
      store.set(copyId, { ...note, id: copyId, title: `${note.title} (conflicted copy)`, rev: ++rev });
      return { note: row ? out(row) : null, copy: out(store.get(copyId)), conflict: true };
    }
    if (m && method === "DELETE") {
      const row = store.get(m[1]);
      if (!row) return { note: null };
      if (Number(u.searchParams.get("base")) !== row.rev) return { status: 409, body: { error: "Someone changed this note meanwhile, so it wasn't deleted.", note: out(row) } };
      store.delete(m[1]);
      const mark = { id: row.id, title: row.title, html: "", deleted: true, rev: ++rev, by: ME.name };
      deleted.set(row.id, mark);
      return { note: mark };
    }
    if (p === "/quests/state" && u.searchParams.get("who") === "notes") return { quests };
    if (p === "/actions/quests" && method === "POST" && body && String(body.link || "").startsWith("note:")) { const q = { id: `nq${quests.length + 1}`, title: body.title, mode: body.mode || "waiting", link: body.link, phones: [] }; quests.push(q); return { ok: true, result: q }; }
    const q = p.match(/^\/actions\/quests\/(nq\d+)$/);
    if (q && method === "POST") { const it = quests.find((x) => x.id === q[1]); if (!it) return { ok: false, message: "Not found" }; if (body.action === "mode") it.mode = body.mode; if (body.action === "remove") quests.splice(quests.indexOf(it), 1); if (body.changes) Object.assign(it, body.changes); return { ok: true, result: it }; }
    if (p === "/app/api/push/phones") return { phones: [{ id: "ph1", name: "Jordan's iPhone", who: "Jordan" }, { id: "ph2", name: "Studio Android", who: "Sam" }] };
    if (p === "/auth/google-status") return { setUp: false };
    if (p === "/app/api/google/docs" && method === "POST") return { status: 503, body: { error: "Google isn't connected in the preview" } };
    if (p === "/app/api/google/docs/keep" && method === "POST") return { kept: !!body.on, url: "https://docs.google.com/document/d/d-keep/edit" };
    if (p === "/app/api/google/docs/import" && method === "POST") { const id = `g${++rev}`; store.set(id, { id, title: "From Google Docs", html: "<p>A Doc brought in from Google.</p>", updated: new Date().toISOString(), created: new Date().toISOString(), named: true, pinned: false, rev, by: ME.name, gdocKeep: true, gdocUrl: body.url }); return { noteId: id, oneWay: true }; }
    return undefined;
  });
})();
