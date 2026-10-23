// Nova Phone: Notes, the studio's shared notes (the same ones as Nova Desk's Notes). Nova Phone keeps the shared
// notes only: a note kept only in one computer's browser (Local, on Nova Desk) stays on that computer.
//   The list    pinned first and newest next, searchable, who changed each one last; Undo after a delete;
//               import a file (Word, web page, Markdown, text, a Notes backup), bring in a Google Doc, back up all.
//   A note      written the way Nova Desk's Notes writes it (lib/notes-editor.js and lib/notes-convert.js are its
//               editor and its cleaning, made safe for Nova Phone's page rules), so everything Desk keeps is kept:
//               Title, Subtitle, headings, quotes, code, fonts, sizes, colours, highlights, alignment, line
//               spacing, indents, lists, checklists (tap the box), tables, pictures, links, lines, page breaks,
//               and each QUEST heading's tie to Quests. Saved as you write (and when you leave it), kept up to date
//               when someone else changes it (every 15 s while it's on screen), and if two people change it at once
//               nobody's words are lost (Nova Bot keeps theirs and saves these as a copy).
//   Its menu    pin, make a copy, download (Word, web page, Markdown, text, backup), print or save as PDF, Google
//               Docs (send, keep in step, copy and paste), copy the words, the page's look, focus mode, delete.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, toggle, empty, api, post, toast, busy, ago } = N;
  // A sheet opened straight after another one closed: phone.js's sheet hears the last one's "close" a moment late
  // and would take it as this one being closed, so each waits for that first
  const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const sheetForm = async (html, wire) => { await settle(); return N.form(html, wire); };
  const confirm = async (o) => { await settle(); return N.confirm(o); };
  const API = "/notes-api";
  const HDR = { "X-Nova-Visualizer": "1" };
  const notes = new Map();
  let cursor = "", loadedAt = 0, search = "", me = null, gone = null, poll = 0;
  const saving = new Set(); // ids with a save on its way

  // ---- This phone's choices for the page (Notes on a computer keeps its own) ----
  const KEY = "nova-phone/notes";
  const prefs = (() => { try { return { page: "cosmic", theme: "novacane", zoom: 1, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { return { page: "cosmic", theme: "novacane", zoom: 1 }; } })();
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };

  // ---- The writing tools: loaded the first time a note is opened (the list doesn't need them) ----
  let libs = null;
  const script = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement("script"), { src, async: false });
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error("The writing tools didn't load. Check the connection and try again.")); };
    document.head.append(s);
  });
  const loadLibs = () => (libs = libs || Promise.all([script("lib/notes-convert.js"), script("lib/notes-editor.js")]).then(() => window.NovaNotes).catch((err) => { libs = null; throw err; }));
  const C = () => window.NovaNotes.convert;
  // Fonts a note may use (Desk's: a quote's serif, code's mono), only when a note opens
  const fonts = () => N.css("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Source+Code+Pro:wght@400;600&display=swap");

  // ---- The shared notes, and what changed since last time ----
  async function load(force = false) {
    const out = { changed: new Set(), gone: [] };
    if (!force && Date.now() - loadedAt < 15000) return out;
    for (let round = 0; round < 50; round++) {
      const r = await api(`${API}/changes${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`);
      me = r.me || me;
      for (const n of r.notes || []) {
        if (n.deleted) { if (notes.has(n.id)) { notes.delete(n.id); out.gone.push(n); } }
        else { const had = notes.get(n.id); if (!had || had.rev !== n.rev) out.changed.add(n.id); notes.set(n.id, n); }
      }
      cursor = r.cursor || cursor;
      if (!r.more) break;
    }
    loadedAt = Date.now();
    return out;
  }
  // A note's words as plain text, for the list (read as a page of its own, styles renamed first: a parsed page is
  // held to Nova Phone's page rules, which refuse style="…")
  const parse = (html) => new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
  const textOf = (html) => parse(String(html || "").replace(/<\/(p|h[1-6]|li|td|th|blockquote|pre)>|<br\s*\/?>/gi, " $&")).body.textContent.replace(/\s+/g, " ").trim();
  const sorted = () => [...notes.values()].sort((a, b) => (!!b.pinned === !!a.pinned ? String(b.updated).localeCompare(String(a.updated)) : b.pinned ? 1 : -1));
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fields = (n) => ({ title: n.title, html: n.html, created: n.created, updated: n.updated, pinned: !!n.pinned, named: !!n.named, gdocId: n.gdocId || "", gdocUrl: n.gdocUrl || "", gdocKeep: n.gdocKeep === true });
  const put = (id, body) => api(`${API}/notes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) });
  // A brand-new shared note (an import, a copy, something shared to Nova Phone)
  async function createNote(html, title, named) {
    const id = newId(), now = new Date().toISOString();
    const r = await put(id, { title: (title || "").slice(0, 200) || "Untitled note", html, created: now, updated: now, pinned: false, named: !!named, gdocId: "", gdocUrl: "", gdocKeep: false, base: null });
    if (r.note) notes.set(r.note.id, r.note);
    return id;
  }

  // ---- Every 15 s while Notes is on screen: the team's changes (stops when you leave or the phone sleeps) ----
  const here = () => /^#notes(\/|$)/.test(location.hash);
  function startPoll() { if (!poll) poll = setInterval(tick, 15000); }
  function stopPoll() { clearInterval(poll); poll = 0; }
  async function tick() {
    if (!here()) return stopPoll();
    if (document.hidden) return;
    let r;
    try { r = await load(true); } catch (e) { return; }
    if (S && S.editor) await S.theirs(r);
    else if (/^#notes\/?$/.test(location.hash) && (r.changed.size || r.gone.length) && !document.querySelector("[data-note-search] input:focus")) N.show();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (S) S.flush(true); }
    else if (here()) { startPoll(); setTimeout(tick, 300); }
  });
  addEventListener("hashchange", () => {
    if (S && location.hash !== `#notes/${encodeURIComponent(S.id)}` && location.hash !== `#notes/${S.id}`) closeSession();
    if (!here()) { stopPoll(); document.documentElement.classList.remove("notes-focus"); }
  });
  addEventListener("pagehide", () => S && S.flush(true));

  N.section({
    id: "notes",
    name: "Notes",
    tile: "notes",
    async draw(box, [id, ...rest], ui) {
      await N.css("notes.css");
      startPoll();
      if (id === "share") return drawShared(box, ui);
      if (id === "open") return drawOpenFile(box, rest, ui);
      await load(!id && Date.now() - loadedAt > 3000);
      if (id === "new") return drawNote(box, null, ui);
      if (id) return drawNote(box, notes.get(id), ui, id);
      closeSession();
      drawList(box, ui);
    },
  });

  // ---- The list ----
  function drawList(box, ui) {
    ui.action({ icon: "plus", label: "New note", href: "#notes/new" });
    const q = search.toLowerCase();
    const all = sorted();
    const shown = all.filter((n) => !q || `${n.title} ${textOf(n.html)}`.toLowerCase().includes(q));
    const meta = (n) => {
      const who = n.by && (!me || n.by !== me.name) ? ` · ${esc(n.by)}` : "";
      return `<small class="notes-meta">Shared${who}${saving.has(n.id) ? " · saving…" : ""}${n.gdocKeep ? " · kept in step with Google Docs" : ""}</small>`;
    };
    const goneCard = gone && Date.now() - gone.at < 120000 ? `<div class="card notes-gone"><p>Deleted “${esc(gone.note.title || "Untitled note")}”. It's gone for the whole studio.</p><button type="button" class="btn" data-undo-delete>Undo</button></div>` : "";
    if (gone && !goneCard) gone = null;
    box.innerHTML = `<form class="search" data-note-search><label class="field"><span class="sr">Search notes</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search notes"></label></form>
      ${goneCard}
      ${shown.length ? list(shown.map((n) => row({ href: `#notes/${encodeURIComponent(n.id)}`, lead: window.NovaTile ? window.NovaTile("notes") : icon("notes"), title: `${n.pinned ? "📌 " : ""}${n.title || "Untitled note"}`, text: snippet(n) || "Empty", html: meta(n), end: esc(ago(n.updated)) }))) : empty({ icon: "notes", title: search ? `No notes match “${search}”` : "No shared notes yet", text: search ? "" : "Notes written here are shared with the studio, on every phone and computer.", action: search ? "" : `<a class="btn main" href="#notes/new">${icon("plus")} Write one</a>` })}
      <p class="notes-foot">${all.length} shared note${all.length === 1 ? "" : "s"}${saving.size ? " · saving…" : ""} · Notes kept only on one computer (Local, in Nova Desk) stay on it</p>
      <div class="btns two"><label class="btn notes-file">${icon("plus")} Import a file<input type="file" data-import accept=".html,.htm,.md,.markdown,.txt,.docx,.json,text/html,text/markdown,text/plain,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple></label><button type="button" class="btn" data-gdoc-import>Bring in a Google Doc</button></div>
      <button type="button" class="btn quiet wide" data-list-more>Back up, restore and help</button>`;
    box.querySelector("[data-note-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
    box.querySelector("[data-note-search] input").addEventListener("search", (e) => { if (!e.target.value && search) { search = ""; N.show(); } });
    box.querySelector("[data-gdoc-import]").addEventListener("click", importDoc);
    box.querySelector("[data-import]").addEventListener("change", (e) => importFiles([...e.target.files]));
    box.querySelector("[data-list-more]").addEventListener("click", listMore);
    box.querySelector("[data-undo-delete]")?.addEventListener("click", (e) => busy(e.currentTarget, "Putting it back…", undoDelete));
  }
  const snips = new Map();
  // (the words after the title, as Desk's list shows them)
  const snippet = (n) => { const k = n.id + n.rev; if (!snips.has(k)) { const t = textOf(n.html).slice(0, 140), name = n.title || ""; snips.set(k, name && t.startsWith(name) ? t.slice(name.length).trim() || "—" : t); } return snips.get(k); };
  async function undoDelete() {
    if (!gone) return;
    const { note, rev } = gone;
    try {
      const r = await put(note.id, { ...fields(note), updated: new Date().toISOString(), base: rev });
      if (r.note) notes.set(r.note.id, r.note);
      gone = null;
      toast("Put back");
      location.hash = `#notes/${encodeURIComponent(note.id)}`;
    } catch (err) { toast(err.message, true); }
  }
  async function listMore() {
    const v = await menu("Notes", [
      ["backup", "Back up all notes (.json)"],
      ["restore", "Restore a backup…", "", "file"],
      ["help", "Help: how Notes works"],
    ], (el, done) => { el.querySelector("[data-restore]")?.addEventListener("change", (e) => done({ files: [...e.target.files] })); });
    if (v === "backup") backupAll();
    if (v && v.files) importFiles(v.files);
    if (v === "help") help();
  }

  // ---- A sheet of choices: rows of buttons (or a file picker); resolves with the value tapped ----
  function menu(title, items, wire) {
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><div class="btns">${items.map(([v, l, tone, kind, href]) => kind === "file" ? `<label class="btn wide notes-file">${esc(l)}<input type="file" data-restore accept=".json,application/json"></label>` : kind === "link" ? `<a class="btn wide" href="${esc(href)}" target="_blank" rel="noopener" data-v="${esc(v)}">${esc(l)}</a>` : `<button type="button" class="btn wide${tone ? ` ${tone}` : ""}" data-v="${esc(v)}">${esc(l)}</button>`).join("")}<button type="button" class="btn wide quiet" data-no>Cancel</button></div>`,
      (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); if (wire) wire(el, done); });
  }
  // A sheet of grouped chips: [[legend, [[value, label, pressed?]]]]; resolves with the value tapped
  function chipsSheet(title, groups, extra = "", wire) {
    const body = groups.map(([legend, chips]) => `<div class="notes-group"><p class="notes-label">${esc(legend)}</p><div class="chips">${chips.map(([v, l, on]) => `<button type="button" class="chip" data-v="${esc(v)}"${on ? ' aria-pressed="true"' : ""}>${esc(l)}</button>`).join("")}</div></div>`).join("");
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2>${body}${extra}<button type="button" class="btn wide quiet" data-no>Close</button>`,
      (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); if (wire) wire(el, done); });
  }
  // One question with a box to write in: resolves with the words, or null
  const ask = (title, f, ok = "OK") => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f novalidate>${field({ name: "v", ...f })}<div class="btns"><button class="btn main wide" type="submit">${esc(ok)}</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.v.value); }; el.querySelector("[data-no]").onclick = () => done(null); });

  // ---- A note ----
  let S = null; // the note open now
  function closeSession() { if (S) { const s = S; S = null; s.close(); } }
  const SVG = (d) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const IC = {
    undo: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'), redo: SVG('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
    check: SVG('<rect x="3" y="4" width="7" height="7" rx="2"/><path d="m4.5 7.5 1.5 1.5 3-3M13 7.5h8M3 14h7v7H3zM13 17.5h8"/>'), ul: SVG('<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.3"/><circle cx="4" cy="12" r="1.3"/><circle cx="4" cy="18" r="1.3"/>'),
    link: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), dots: SVG('<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'),
  };
  const BAR = [["undo", "Undo", IC.undo], ["redo", "Redo", IC.redo], ["text", "Text: style, font, size", "Aa"], ["bold", "Bold", "<b>B</b>"], ["italic", "Italic", "<i>I</i>"], ["underline", "Underline", "<u>U</u>"],
    ["colour", "Text colour and highlight", '<span aria-hidden="true">A<i class="notes-ink"></i></span>'], ["check", "Checklist", IC.check], ["ul", "Bulleted list", IC.ul], ["link", "Link", IC.link], ["insert", "Insert: picture, table, line, date…", icon("plus")], ["more", "Paragraph and tools: align, spacing, find, outline…", IC.dots]];
  const autoTitle = (el) => { const first = [...el.children].find((b) => b.textContent.trim()); return first ? first.textContent.trim().replace(/\s+/g, " ").slice(0, 80) : "Untitled note"; };

  async function drawNote(box, n, ui, id) {
    ui.back("#notes");
    if (id && !n) { closeSession(); box.innerHTML = empty({ icon: "notes", title: "That note isn't there any more", text: "Someone may have deleted it, or it's kept only on one computer.", action: `<a class="btn" href="#notes">Back to Notes</a>` }); return; }
    const NN = await loadLibs();
    fonts();
    closeSession();
    ui.title(n ? n.title || "Note" : "New note");
    ui.action({ icon: "more", label: "More for this note", run: () => noteMenu() });
    const named = n && (n.named || n.title !== "Untitled note");
    box.innerHTML = `<form class="notes-form" id="note-form" novalidate>
        <label class="field notes-title-field"><span class="sr">Title</span><input class="input notes-title" name="title" placeholder="Title (or it's named from the first line)" maxlength="200" value="${esc(named ? n.title : "")}" autocomplete="off"></label>
        <div class="notes-head" data-head>
          <div class="notes-bar" role="toolbar" aria-label="Formatting">${BAR.map(([c, l, g]) => `<button type="button" class="notes-tb${c === "text" ? " notes-aa" : ""}" data-tb="${c}" aria-label="${esc(l)}">${g}</button>`).join("")}</div>
          <div class="notes-find" data-find hidden></div>
          <p class="sr" aria-live="polite" data-quest-status></p>
        </div>
        <article class="notes-page" id="note-page" data-placeholder="Start writing… it all lines up in the middle, among the stars." aria-label="The note"></article>
        <div class="notes-status notes-quiet"><button type="button" class="chip" data-words>0 words</button><button type="submit" class="chip notes-save" data-save>Saved</button></div>
        <p class="notes-said notes-quiet" data-said role="status"></p>
        <section class="card notes-quests notes-quiet" data-quests aria-label="Quests"></section>
        <button type="button" class="btn wide quiet" data-unfocus hidden>Leave focus mode</button>
      </form>`;
    const f = box.querySelector("#note-form"), page = box.querySelector("#note-page"), said = box.querySelector("[data-said]"), saveBtn = box.querySelector("[data-save]");
    const s = { id: id || newId(), n: n || null, fresh: !n, dirty: false, inFlight: null, again: false, timer: 0, since: 0, closed: false, f, page, said };
    S = s;
    look(page);
    // (a picture that doesn't load is drawn at its own small size: sized by the page's width, the browser lays it
    // out wrong and it spills over what's below; the class is never saved)
    page.addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.classList.add("notes-broken"); }, true);
    page.addEventListener("load", (e) => { if (e.target.tagName === "IMG") e.target.classList.remove("notes-broken"); }, true);
    const ed = new NN.Editor(page, {
      onChange: () => { s.schedule(); side(); },
      onState: (st) => paintBar(st),
      // (a tap on a picture: its tools; the editor also says so again after each change, which isn't a new tap)
      onImage: (img) => { if (img && img !== s.img) imageSheet(); s.img = img; },
      onImageFile: (file) => insertImageFile(file),
      onFile: (file) => importFiles([file]),
      onLink: (a) => linkView(a),
      onReveal: (rect) => reveal(rect),
    });
    s.editor = ed;
    ed.load(n ? n.html : "");
    if (!n) requestAnimationFrame(() => page.focus());
    const sayLast = () => { said.classList.remove("bad"); said.innerHTML = s.n ? `${s.n.by ? `Last changed by ${esc(s.n.by)}, ` : ""}${esc(ago(s.n.updated))}${s.n.gdocUrl ? ` · <a href="${esc(s.n.gdocUrl)}" target="_blank" rel="noopener">its Google Doc</a>` : ""}` : "Shared with the studio as you write."; };
    sayLast();
    const setSave = (kind) => { saveBtn.textContent = kind === "saving" ? "Saving…" : kind === "error" ? "Save again" : kind === "dirty" ? "Save now" : "Saved"; saveBtn.setAttribute("aria-label", kind === "saved" ? "Saved: Notes saves as you write" : saveBtn.textContent); };
    setSave("saved");

    // Saving: half a second after the writing stops, at least every 1.5 s while it doesn't, and on leaving
    s.schedule = () => {
      s.dirty = true; f.classList.add("dirty"); setSave("dirty");
      clearTimeout(s.timer);
      if (!s.since) s.since = Date.now();
      s.timer = setTimeout(() => s.save(), Date.now() - s.since > 1500 ? 0 : 500);
    };
    s.save = async (leaving = false) => {
      clearTimeout(s.timer); s.since = 0;
      if (!s.dirty) return s.inFlight;
      if (s.inFlight) { s.again = true; return s.inFlight; }
      const html = C().clean(ed.html()), typed = f.elements.title.value.trim();
      // (a brand-new note isn't made until something's written in it)
      if (s.fresh && !typed && !textOf(html) && !/<(img|table|hr)\b/i.test(html)) { s.dirty = false; setSave("saved"); return; }
      s.dirty = false;
      const now = new Date().toISOString(), base = s.n && Number.isInteger(s.n.rev) ? s.n.rev : null;
      const out = { title: typed || autoTitle(page) || "Untitled note", html, created: s.n?.created || now, updated: now, pinned: !!s.n?.pinned, named: !!typed, gdocId: s.n?.gdocId || "", gdocUrl: s.n?.gdocUrl || "", gdocKeep: s.n?.gdocKeep === true, base };
      setSave("saving"); saving.add(s.id);
      s.inFlight = (async () => {
        try {
          const r = await api(`${API}/notes/${encodeURIComponent(s.id)}`, { method: "PUT", body: JSON.stringify(out), keepalive: leaving && out.html.length < 60000 });
          if (r.copy) notes.set(r.copy.id, r.copy);
          if (r.conflict) {
            // Someone changed it at the same time: theirs stays here, these words are the copy (and anything typed
            // since this went is kept too, as a copy of its own)
            if (s.dirty && !s.closed) { const extra = C().clean(ed.html()); await createNote(extra, `${out.title} (conflicted copy)`, true).catch(() => {}); s.dirty = false; }
            if (r.note) { notes.set(r.note.id, r.note); s.n = r.note; }
            if (!s.closed) { ed.load(r.note ? r.note.html : ""); f.elements.title.value = r.note && (r.note.named || r.note.title !== "Untitled note") ? r.note.title : ""; }
            said.classList.add("bad");
            said.innerHTML = `Someone changed “${esc(r.note?.title || out.title)}” at the same time. Theirs is here; your version is kept as “${esc(r.copy ? r.copy.title : "a copy")}”.${r.copy ? ` <a class="chip" href="#notes/${encodeURIComponent(r.copy.id)}">Open your version</a>` : ""}`;
            toast("Saved yours as a copy");
          } else if (r.note) {
            notes.set(r.note.id, r.note); s.n = r.note;
            if (s.fresh) { s.fresh = false; if (!s.closed && location.hash === "#notes/new") history.replaceState(null, "", `#notes/${encodeURIComponent(s.id)}`); }
            if (!s.closed) { sayLast(); if (!s.dirty) f.classList.remove("dirty"); }
          }
          setSave(s.dirty ? "dirty" : "saved");
        } catch (err) {
          s.dirty = true;
          setSave("error");
          said.classList.add("bad");
          said.textContent = err.status === 413 ? `${err.message} Make it smaller (pictures take the most room): your words are still here.` : err.offline ? "Not saved yet: no connection. It saves again once you're back online." : `Not saved: ${err.message}`;
          if (!s.closed && err.status !== 413) s.timer = setTimeout(() => s.save(), err.offline ? 8000 : 5000);
        } finally {
          saving.delete(s.id);
          s.inFlight = null;
          if (s.again) { s.again = false; if (s.dirty) s.save(leaving); }
        }
      })();
      return s.inFlight;
    };
    s.flush = (leaving) => s.save(leaving);
    s.close = () => { s.closed = true; s.flush(true); ed.dispose(); clearTimeout(s.qTimer); document.documentElement.classList.remove("notes-focus"); };
    // Someone else changed it (from the 15 s round): shown at once if nothing's being written here
    s.theirs = async ({ changed, gone: away }) => {
      const del = away.find((x) => x.id === s.id);
      if (del) {
        if (!s.dirty && !s.inFlight) { toast(`“${del.title || s.n?.title || "This note"}” was deleted${del.by ? ` by ${del.by}` : ""}`); location.hash = "#notes"; return; }
        said.classList.add("bad"); said.textContent = `This note was deleted${del.by ? ` by ${del.by}` : ""}. What's written here is saved as a copy.`;
        return;
      }
      if (changed.has(s.id) && !s.dirty && !s.inFlight) {
        const cur = notes.get(s.id);
        if (!cur || (s.n && cur.rev === s.n.rev)) return;
        s.n = cur;
        const sel = ed.saveSel(), mine = document.activeElement === page;
        ed.load(cur.html);
        if (mine) ed.loadSel(sel);
        if (document.activeElement !== f.elements.title) f.elements.title.value = cur.named || cur.title !== "Untitled note" ? cur.title : "";
        said.classList.remove("bad"); said.textContent = `Changed by ${cur.by || "someone"} just now`;
        side();
      }
      if (questHeadings(ed).length) syncQuests(s);
    };

    f.elements.title.addEventListener("input", () => s.schedule());
    f.elements.title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ed.focus(); } });
    f.addEventListener("submit", (ev) => { ev.preventDefault(); s.dirty = true; busy(saveBtn, "Saving…", () => s.save()).then(() => !s.dirty && toast("Saved")); });
    box.querySelector("[data-words]").addEventListener("click", wordCount);
    box.querySelector("[data-unfocus]").addEventListener("click", () => focusMode(false));
    // The bar: never takes the writing's place (the keyboard stays up)
    const bar = box.querySelector(".notes-bar");
    for (const ev of ["pointerdown", "mousedown"]) bar.addEventListener(ev, (e) => { if (e.target.closest("button")) e.preventDefault(); });
    bar.addEventListener("click", (e) => { const b = e.target.closest("[data-tb]"); if (b && !b.disabled) tool(b.dataset.tb); });
    side(true);
    if (questHeadings(ed).length) s.qTimer = setTimeout(() => syncQuests(s), 600);
  }

  // The page's look: Cosmic or Paper (with the Notes theme's print colours), and its zoom
  function look(page) {
    page.classList.toggle("paper", prefs.page === "paper");
    page.style.setProperty("--nz", String(prefs.zoom || 1));
    const p = C().palette(window.NovaNotes.themes.get(prefs.theme));
    for (const [k, v] of Object.entries({ ink: "--p-ink", title: "--p-title", subtitle: "--p-subtitle", h1: "--p-h1", h2: "--p-h2", h3: "--p-h3", rule: "--p-rule", link: "--p-link", quote: "--p-quote", wash: "--p-wash", line: "--p-line" })) page.style.setProperty(v, p[k]);
  }

  function paintBar(st) {
    if (!S || !S.f.isConnected) return;
    const on = { bold: st.bold, italic: st.italic, underline: st.underline, check: st.list === "check", ul: st.list === "ul" };
    for (const b of S.f.querySelectorAll("[data-tb]")) {
      const c = b.dataset.tb;
      if (c in on) b.setAttribute("aria-pressed", on[c] ? "true" : "false");
      if (c === "undo") b.disabled = !st.canUndo;
      if (c === "redo") b.disabled = !st.canRedo;
    }
    const ink = S.f.querySelector(".notes-ink");
    if (ink && st.color) ink.style.setProperty("background", st.color);
    S.state = st;
  }
  let sideTimer = 0;
  function side(now) {
    clearTimeout(sideTimer);
    sideTimer = setTimeout(() => {
      if (!S || !S.f.isConnected) return;
      const st = S.editor.stats();
      S.f.querySelector("[data-words]").textContent = `${st.words.toLocaleString("en-GB")} word${st.words === 1 ? "" : "s"} · ${st.chars.toLocaleString("en-GB")} characters`;
      renderQuests(S);
    }, now ? 0 : 350);
  }
  // A find match (or a heading) brought into view, below the bar that stays at the top
  function reveal(rect) {
    const scroller = document.getElementById("page");
    const head = S && S.f.querySelector("[data-head]");
    const top = (head ? head.getBoundingClientRect().bottom : 0) + 12;
    if (rect.top < top || rect.bottom > innerHeight - 60) scroller.scrollBy({ top: rect.top - top - 60 });
  }

  // ---- The tools ----
  const ed = () => S.editor;
  // The selection when a sheet opens, put back before its choice is used: a box to write in on the sheet takes the
  // selection, and when the sheet closes some phones (WebKit) put the caret back at the very start
  function keep() { const e = ed(); e.remember(); S.kept = e.savedRange ? e.savedRange.cloneRange() : null; }
  function back() {
    const e = ed(), r = S && S.kept;
    if (!r || !e.el.contains(r.commonAncestorContainer)) return;
    e.el.focus({ preventScroll: true });
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    e.savedRange = r.cloneRange();
  }
  function tool(c) {
    const e = ed();
    if (c === "undo") return e.undo();
    if (c === "redo") return e.redo();
    if (["bold", "italic", "underline"].includes(c)) return e.exec(c);
    if (c === "check" || c === "ul") return e.exec("list", c);
    keep();
    if (c === "text") return textSheet();
    if (c === "colour") return colourSheet();
    if (c === "link") return linkSheet();
    if (c === "insert") return insertSheet();
    if (c === "more") return moreSheet();
  }
  const STYLE_NAMES = [["normal", "Normal text"], ["title", "Title"], ["subtitle", "Subtitle"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["quote", "Quote"], ["code", "Code"]];
  const FONTS = [["", "Theme font"], ["Saira", "Saira"], ["Archivo", "Archivo"], ["Cormorant Garamond", "Cormorant Garamond"], ["Source Code Pro", "Source Code Pro"], ["Georgia", "Georgia"], ["Arial", "Arial"], ["Times New Roman", "Times New Roman"], ["Courier New", "Courier New"], ["Verdana", "Verdana"]];
  const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72, 96];
  async function textSheet() {
    const st = S.state || ed().state();
    const size = st.size || 12;
    const v = await chipsSheet("Text", [
      ["Paragraph style", STYLE_NAMES.map(([k, l]) => [`style:${k}`, l, st.style === k])],
      ["Look", [["strikeThrough", "Strikethrough", st.strike], ["superscript", "Superscript", st.sup], ["subscript", "Subscript", st.sub], ["clear", "Clear formatting"]]],
      ["Font", FONTS.map(([k, l]) => [`font:${k}`, l, (st.font || "").toLowerCase() === k.toLowerCase() && !!k])],
      [`Size (now ${size} pt)`, [["size:-", "Smaller"], ["size:+", "Bigger"], ...[8, 10, 11, 12, 14, 16, 18, 24, 32, 48, 72].map((n) => [`size:${n}`, `${n}`, n === size])]],
    ], "", (el) => { for (const b of el.querySelectorAll('[data-v^="font:"]')) { const fam = b.dataset.v.slice(5); if (fam) b.style.setProperty("font-family", `'${fam}'`); } });
    if (!v) return;
    back();
    const [k, arg] = v.split(/:(.*)/s);
    if (k === "style") return ed().exec("style", arg);
    if (k === "font") return ed().exec("font", arg);
    if (k === "size") {
      const next = arg === "+" ? SIZES.find((n) => n > size) || 96 : arg === "-" ? [...SIZES].reverse().find((n) => n < size) || 6 : Number(arg);
      return ed().exec("size", next);
    }
    ed().exec(k);
  }
  async function colourSheet() {
    const t = window.NovaNotes.themes.get(prefs.theme);
    const groups = [["Theme", [t.hi, t.soft, t.lilac, t.gold, t.accent, t.accent2, t.text, "#FFFFFF"]], ["Classic", ["#000000", "#434343", "#999999", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6FA8DC", "#8E7CC3", "#C27BA0", "#CC0000", "#E69138", "#38761D", "#1155CC", "#741B47"]]];
    const sw = (kind) => groups.map(([g, cs]) => `<p class="notes-label">${g}</p><div class="notes-swatches">${cs.map((c) => `<button type="button" class="notes-sw" data-v="${kind}:${c}" data-sw="${c}" aria-label="${kind === "color" ? "Text colour" : "Highlight"} ${c}"></button>`).join("")}</div>`).join("");
    const v = await sheetForm(`<h2 class="sheet-title">Colour</h2>
      <div class="notes-group"><p class="notes-label">Text colour</p>${sw("color")}<div class="chips"><button type="button" class="chip" data-v="color:">Default</button><label class="chip notes-custom">Custom<input type="color" data-custom="color" aria-label="Custom text colour"></label></div></div>
      <div class="notes-group"><p class="notes-label">Highlight colour</p>${sw("highlight")}<div class="chips"><button type="button" class="chip" data-v="highlight:">None</button><label class="chip notes-custom">Custom<input type="color" data-custom="highlight" aria-label="Custom highlight"></label></div></div>
      <button type="button" class="btn wide quiet" data-no>Close</button>`, (el, done) => {
      for (const b of el.querySelectorAll("[data-sw]")) b.style.setProperty("--sw", b.dataset.sw);
      el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v)));
      el.querySelectorAll("[data-custom]").forEach((i) => i.addEventListener("change", () => done(`${i.dataset.custom}:${i.value}`)));
      el.querySelector("[data-no]").onclick = () => done(null);
    });
    if (!v) return;
    back();
    const [kind, c] = v.split(/:(.*)/s);
    ed().exec(kind, c);
  }
  async function linkSheet() {
    const e = ed(), st = e.state(), a = st.link, r = e.range() || e.savedRange;
    const text0 = a ? a.textContent : r ? r.toString() : "";
    const v = await sheetForm(`<h2 class="sheet-title">${a ? "Change the link" : "Add a link"}</h2><form class="form" data-f novalidate>${field({ label: "Text", name: "text", value: text0, placeholder: "Text to show" })}${field({ label: "Link", name: "url", type: "url", value: a ? a.getAttribute("href") : "", placeholder: "Paste a link, or type an email", attrs: 'autocapitalize="off" spellcheck="false"' })}
      <div class="btns"><button class="btn main wide" type="submit">Apply</button>${a ? '<button type="button" class="btn danger wide" data-unlink>Remove the link</button>' : ""}<button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ url: ev.target.elements.url.value.trim(), text: ev.target.elements.text.value }); }; el.querySelector("[data-no]").onclick = () => done(null); el.querySelector("[data-unlink]")?.addEventListener("click", () => done("unlink")); });
    if (!v) return;
    back();
    if (v === "unlink") return e.exec("unlink");
    if (!v.url) return;
    const changed = v.text !== text0, sr = e.savedRange;
    e.exec("link", { url: v.url, text: changed || !sr || sr.collapsed ? v.text || v.url : "" });
  }
  // A tap on a link: where it goes, and change or remove it
  async function linkView(a) {
    const href = a.getAttribute("href") || "";
    keep();
    const v = await menu("This link", [["open", href, "", "link", href], ["edit", "Change the link"], ["unlink", "Remove the link", "danger"]]);
    if (v === "edit") { back(); linkSheet(); }
    if (v === "unlink") { back(); ed().exec("unlink"); }
  }
  const SYMBOLS = "✦ ★ ☆ ✧ ✩ ✪ ✺ ⋆ ☾ ☽ ☄ ⊹ ∞ ♪ ♫ ♡ → ← ↑ ↓ ⇄ • · — – … « » “ ” ‘ ’ © ® ™ ° ± × ÷ ≈ ≠ ≤ ≥ £ € $ ½ ¼ ¾ ✓ ✗ ☐ ☑ 🎙️ 🎧 🎹 🎸 🥁 🎤 🌙 ✨ 🌌 🪐 🚀 💫 🔥 💜".split(" ");
  async function insertSheet() {
    const e = ed(), inCell = !!e.cell(), d = new Date();
    const fmt = (o) => d.toLocaleDateString("en-GB", o);
    const dates = [fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }), fmt({ day: "numeric", month: "long", year: "numeric" }), fmt({ day: "2-digit", month: "2-digit", year: "numeric" })];
    const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const groups = [
      ...(inCell ? [["This table", [["t:rowAbove", "+ Row above"], ["t:rowBelow", "+ Row below"], ["t:colLeft", "+ Column left"], ["t:colRight", "+ Column right"], ["t:header", "Header row"], ["t:delRow", "− Row"], ["t:delCol", "− Column"], ["t:delTable", "Delete table"]]]] : []),
      ["Picture", [["img:url", "By web address"]]],
      ["Table", [...[[2, 2], [3, 3], [4, 3], [5, 4], [6, 6]].map(([c, r]) => [`table:${r}x${c}`, `${c} × ${r}`]), ["table:pick", "Pick a size…"]]],
      ["Lines", [["hr", "Line across the page"], ["pageBreak", "Page break"], ["check", "Checklist"]]],
      ["Date and time", [...dates.map((x) => [`text:${x}`, x]), [`text:${time}`, `Time: ${time}`]]],
      ["More", [["link", "Link"], ["symbols", "Special characters…"], ["quest", "+ New quest"]]],
    ];
    const v = await chipsSheet("Insert", groups, "", (el, done) => {
      const pic = Object.assign(document.createElement("label"), { className: "chip notes-file", textContent: "From the phone" });
      const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true });
      input.setAttribute("aria-label", "A picture from the phone");
      pic.append(input);
      el.querySelector('[data-v="img:url"]').before(pic);
      input.addEventListener("change", () => done({ files: [...input.files] }));
    });
    if (!v) return;
    back();
    if (v.files) return v.files.forEach(insertImageFile);
    const [k, arg] = v.split(/:(.*)/s);
    if (k === "t") return e.tableOp(arg);
    if (k === "img") return imageFromUrl();
    if (k === "table") {
      if (arg !== "pick") { const [r, c] = arg.split("x").map(Number); return e.exec("table", { rows: r, cols: c }); }
      const size = await sheetForm(`<h2 class="sheet-title">Pick a size</h2><form class="form" data-f novalidate><div class="notes-steps">${field({ label: "Columns (1–10)", name: "cols", type: "number", value: 3, attrs: 'min="1" max="10" step="1"' })}${field({ label: "Rows (1–20)", name: "rows", type: "number", value: 3, attrs: 'min="1" max="20" step="1"' })}</div><div class="btns"><button class="btn main wide" type="submit">Insert the table</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ rows: Number(ev.target.elements.rows.value) || 3, cols: Number(ev.target.elements.cols.value) || 3 }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (size) { back(); e.exec("table", size); }
      return;
    }
    if (k === "text") return e.exec("text", arg);
    if (k === "check") return e.exec("list", "check");
    if (k === "link") return linkSheet();
    if (k === "quest") return addQuest();
    if (k === "symbols") {
      const sym = await sheetForm(`<h2 class="sheet-title">Special characters</h2><div class="notes-symbols">${SYMBOLS.map((x) => `<button type="button" data-v="${esc(x)}" aria-label="Insert ${esc(x)}">${esc(x)}</button>`).join("")}</div><button type="button" class="btn wide quiet" data-no>Close</button>`,
        (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); });
      if (sym) { back(); e.exec("text", sym); }
      return;
    }
    e.exec(k);
  }
  async function moreSheet() {
    const st = S.state || ed().state();
    const v = await chipsSheet("Paragraph and tools", [
      ["Align", [["align:left", "Left", st.align === "left"], ["align:center", "Centre", st.align === "center"], ["align:right", "Right", st.align === "right"], ["align:justify", "Justified", st.align === "justify"]]],
      ["Line spacing", [["lh:1", "Single", st.lineHeight === "1"], ["lh:1.15", "1.15", st.lineHeight === "1.15"], ["lh:1.5", "1.5", st.lineHeight === "1.5"], ["lh:", "Default (1.7)", !st.lineHeight], ["lh:2", "Double", st.lineHeight === "2"]]],
      ["Bullets and numbering", [["list:check", "Checklist", st.list === "check"], ["list:ul", "Bulleted list", st.list === "ul"], ["list:ol", "Numbered list", st.list === "ol"], ["outdent", "Decrease indent"], ["indent", "Increase indent"]]],
      ["Tools", [["find", "Find and replace"], ["outline", "Outline"], ["words", "Word count"], ["selectAll", "Select all"]]],
    ]);
    if (!v) return;
    back();
    const [k, arg] = v.split(/:(.*)/s);
    if (k === "align") return ed().exec("align", arg);
    if (k === "lh") return ed().exec("lineHeight", arg);
    if (k === "list") return ed().exec("list", arg);
    if (k === "find") return openFind();
    if (k === "outline") return outline();
    if (k === "words") return wordCount();
    ed().exec(k);
  }

  // ---- Pictures ----
  async function imageSheet() {
    const e = ed(), img = e.selImg;
    if (!img) return;
    const w = img.style.width;
    const v = await chipsSheet("This picture", [
      ["Size", [["w:25", "Small", w === "25%"], ["w:50", "Medium", w === "50%"], ["w:75", "Large", w === "75%"], ["w:", "Full", !w]]],
      ["Place it", [["a:left", "Left"], ["a:center", "Centre"], ["a:right", "Right"]]],
      ["", [["alt", "Alt text…"], ["remove", "Delete the picture"]]],
    ]);
    if (!v) return e.deselectImage();
    const [k, arg] = v.split(/:(.*)/s);
    if (k === "w") return e.imageOp("width", arg);
    if (k === "a") return e.imageOp("align", arg);
    if (k === "remove") return e.imageOp("remove");
    if (k === "alt") {
      const alt = await ask("Alt text", { label: "Describe the picture for people who can't see it", value: img.getAttribute("alt") || "" }, "Save");
      if (alt !== null && e.selImg) e.imageOp("alt", alt.trim());
    }
  }
  async function imageFromUrl() {
    const url = await ask("Insert a picture", { label: "Picture address (https://…)", type: "url", placeholder: "https://", attrs: 'autocapitalize="off" spellcheck="false"' }, "Insert");
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) return toast("That needs to be a web address starting https://", true);
    back();
    ed().exec("image", { src: url.trim(), alt: "" });
  }
  // Big pictures are made smaller, so notes stay quick to save (as Desk does)
  function insertImageFile(file) {
    if (!S || !file || !file.type.startsWith("image/")) return;
    const e = S.editor;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result, alt = file.name.replace(/\.[^.]+$/, "");
      if (file.type === "image/svg+xml" || file.type === "image/gif" || file.size < 400 * 1024) return e.exec("image", { src, alt });
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86);
        e.exec("image", { src: out.length < src.length ? out : src, alt });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  // ---- Find and replace (the bar under the tools) ----
  function openFind() {
    const box = S.f.querySelector("[data-find]"), e = ed();
    const r = e.range();
    const sel = r && !r.collapsed ? r.toString() : "";
    box.hidden = false;
    box.innerHTML = `<div class="notes-find-row"><label class="field"><span>Find in the note</span><input class="input" type="search" data-fq value="${esc(sel.length < 80 ? sel : "")}" autocomplete="off"></label><div class="notes-find-btns"><button type="button" class="notes-tb" data-fs="-1" aria-label="Previous match">↑</button><button type="button" class="notes-tb" data-fs="1" aria-label="Next match">↓</button><button type="button" class="notes-tb" data-fclose aria-label="Close find">✕</button></div></div>
      <p class="notes-find-count" data-fcount role="status">0 of 0</p>
      <div class="notes-find-row"><label class="field"><span>Replace with</span><input class="input" type="text" data-fr autocomplete="off"></label><div class="notes-find-btns"><button type="button" class="btn" data-fone>Replace</button><button type="button" class="btn" data-fall>All</button></div></div>
      <div class="chips"><button type="button" class="chip" data-fopt="case" aria-pressed="false">Match case</button><button type="button" class="chip" data-fopt="word" aria-pressed="false">Whole words</button></div>`;
    const q = box.querySelector("[data-fq]"), rep = box.querySelector("[data-fr]"), count = box.querySelector("[data-fcount]");
    const opt = (k) => box.querySelector(`[data-fopt="${k}"]`).getAttribute("aria-pressed") === "true";
    const show = (res) => { const total = e.find.ranges.length; count.textContent = total ? `${(res && res.index >= 0 ? res.index : e.find.index) + 1} of ${total}` : q.value ? "No matches" : "0 of 0"; };
    const run = () => { e.search(q.value, { matchCase: opt("case"), wholeWord: opt("word") }); if (e.find.ranges.length) { e.find.index = -1; show(e.findStep(1)); } else show(); };
    q.addEventListener("input", run);
    q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); show(e.findStep(ev.shiftKey ? -1 : 1)); } });
    box.querySelectorAll("[data-fs]").forEach((b) => b.addEventListener("click", () => show(e.findStep(Number(b.dataset.fs)))));
    box.querySelectorAll("[data-fopt]").forEach((b) => b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); run(); }));
    box.querySelector("[data-fclose]").addEventListener("click", () => { box.hidden = true; box.innerHTML = ""; e.clearFind(); });
    box.querySelector("[data-fone]").addEventListener("click", () => { if (!e.find.ranges.length) return; const i = e.find.index; e.replaceCurrent(rep.value); if (e.find.ranges.length) { e.find.index = Math.min(i, e.find.ranges.length - 1) - 1; show(e.findStep(1)); } else show(); });
    box.querySelector("[data-fall]").addEventListener("click", () => { const n = e.replaceAll(rep.value); show(); toast(n ? `Replaced ${n} match${n === 1 ? "" : "es"}` : "Nothing to replace"); });
    q.focus();
    if (q.value) run();
  }
  async function outline() {
    const items = ed().outline();
    const v = await sheetForm(`<h2 class="sheet-title">Outline</h2>${items.length ? `<ul class="list notes-outline">${items.map((h, i) => `<li class="lv${h.level}"><button type="button" class="row" data-v="${i}"><span class="row-main"><b>${esc(h.text)}</b></span></button></li>`).join("")}</ul>` : '<p class="sheet-text">Headings you add appear here, so you can jump between them.</p>'}<button type="button" class="btn wide quiet" data-no>Close</button>`,
      (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); });
    if (v === null || v === undefined) return;
    const h = items[Number(v)];
    if (h) { reveal(h.el.getBoundingClientRect()); ed().caretTo(h.el, true); }
  }
  function wordCount() {
    const st = ed().stats();
    const rows = [["Words", st.words], ["Characters", st.chars], ["Characters without spaces", st.charsNoSpaces], ["Paragraphs", st.paragraphs], ["Pages (about)", st.pages], ["Reading time", `${st.minutes} min`]];
    if (st.selected) rows.unshift(["Selected words", st.selected.words]);
    sheetForm(`<h2 class="sheet-title">Word count</h2><div class="facts notes-stats">${rows.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${typeof v === "number" ? v.toLocaleString("en-GB") : v}</b></div>`).join("")}</div><button type="button" class="btn wide quiet" data-no>Close</button>`, (el, done) => { el.querySelector("[data-no]").onclick = () => done(null); });
  }

  // ---- Quests: every heading 2 or 3 with QUEST (or TASK) in it is a quest in Quests too (Desk's tasks.js) ----
  const MODE_IDS = ["waiting", "soon", "working", "nearly", "longer", "questions", "done"];
  const MODE_NAME = { waiting: "Waiting", soon: "Soon", working: "Working On It", nearly: "Nearly Finished", longer: "Taking longer than expected", questions: "Questions", done: "Done" };
  const validMode = (id) => (MODE_IDS.includes(id) ? id : "waiting");
  const isQuest = (h) => /\b(quest|task)\b/i.test(h.textContent || "");
  const questHeadings = (e) => [...e.el.querySelectorAll(":scope > h2, :scope > h3")].filter(isQuest);
  const newKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let questQuery = "";
  function bodyOf(h) {
    const parts = [];
    for (let n = h.nextElementSibling; n && !/^(H1|H2|H3)$/.test(n.tagName) && !n.classList.contains("title"); n = n.nextElementSibling) { const t = (n.innerText || n.textContent || "").trim(); if (t) parts.push(t); }
    return parts.join("\n").slice(0, 1500);
  }
  function tint(e, hs) {
    for (const n of e.el.querySelectorAll("[data-qtint]")) n.removeAttribute("data-qtint");
    for (const n of e.el.querySelectorAll("[data-qtint-end]")) n.removeAttribute("data-qtint-end");
    for (const h of hs) {
      const mode = validMode(h.getAttribute("data-task"));
      let last = null;
      for (let n = h.nextElementSibling; n && !/^(H1|H2|H3)$/.test(n.tagName) && !n.classList.contains("title"); n = n.nextElementSibling) { n.setAttribute("data-qtint", mode); last = n; }
      if (last) last.setAttribute("data-qtint-end", "");
      h.toggleAttribute("data-qopen", Boolean(last));
    }
  }
  function renderQuests(s) {
    const box = s.f.querySelector("[data-quests]"), e = s.editor;
    const all = questHeadings(e);
    tint(e, all);
    const shown = questQuery ? all.filter((h) => h.textContent.toLowerCase().includes(questQuery)) : all;
    const done = all.filter((h) => h.getAttribute("data-task") === "done").length;
    for (const h of all) {
      if (!MODE_IDS.includes(h.getAttribute("data-task"))) h.setAttribute("data-task", "waiting");
      if (!h.getAttribute("data-qkey")) h.setAttribute("data-qkey", newKey());
    }
    const finding = box.querySelector("[data-qfind]:focus");
    if (finding) { for (const li of box.querySelectorAll("[data-qi]")) li.hidden = !shown.includes(all[Number(li.dataset.qi)]); return; }
    box.innerHTML = `<h2 class="card-title">Quests ${all.length ? `<b>${done}/${all.length}</b>` : ""}</h2>
      ${all.length >= 3 ? `<label class="field"><span class="sr">Find a quest</span><input class="input" type="search" data-qfind placeholder="Find a quest" value="${esc(questQuery)}"></label>` : ""}
      ${all.length ? `<ol class="notes-quest-list">${all.map((h, i) => { const mode = h.getAttribute("data-task"), linked = h.getAttribute("data-qid"); return `<li class="notes-quest qm-${mode}" data-qi="${i}"${shown.includes(h) ? "" : " hidden"}><button type="button" class="notes-quest-go" data-qgo="${i}">${esc(h.textContent.trim() || "Untitled quest")}</button>
        <div class="chips"><button type="button" class="chip notes-mode" data-qmode="${i}" aria-label="How it's going: ${esc(MODE_NAME[mode])}. Tap to change">${esc(MODE_NAME[mode])}</button><button type="button" class="chip" data-qchat="${i}">Talk with Agent</button>${linked ? `<button type="button" class="chip" data-qphones="${i}">Phones</button>` : ""}<button type="button" class="chip" data-qoff="${i}" aria-label="Take it off Quests (the text stays in the note)">Take off</button></div>
        <small>${linked ? "✦ In Quests" : "◌ On its way to Quests"}</small></li>`; }).join("")}</ol>` : `<p class="muted small">Write a heading with the word <b>QUEST</b> in it (or tap + New quest). It becomes a quest in Nova Agent too.</p>`}
      <button type="button" class="btn wide" data-qnew>+ New quest</button>
      <p class="notes-said bad" data-qsay${s.qSay ? "" : " hidden"}>${esc(s.qSay || "")}</p>`;
    const at = (b, k) => all[Number(b.dataset[k])];
    box.querySelector("[data-qnew]").addEventListener("click", addQuest);
    box.querySelector("[data-qfind]")?.addEventListener("input", (ev) => { questQuery = ev.target.value.trim().toLowerCase(); renderQuests(s); });
    box.querySelectorAll("[data-qgo]").forEach((b) => b.addEventListener("click", () => { const h = at(b, "qgo"); reveal(h.getBoundingClientRect()); s.editor.caretTo(h, true); h.classList.add("task-flash"); setTimeout(() => h.classList.remove("task-flash"), 1200); }));
    box.querySelectorAll("[data-qmode]").forEach((b) => b.addEventListener("click", () => pickMode(at(b, "qmode"))));
    box.querySelectorAll("[data-qchat]").forEach((b) => b.addEventListener("click", () => chatAbout(at(b, "qchat"))));
    box.querySelectorAll("[data-qphones]").forEach((b) => b.addEventListener("click", () => choosePhones(at(b, "qphones"))));
    box.querySelectorAll("[data-qoff]").forEach((b) => b.addEventListener("click", () => unQuest(at(b, "qoff"))));
  }
  function addQuest() {
    const e = ed(), h = document.createElement("h3");
    h.textContent = "QUEST: ";
    h.setAttribute("data-task", "waiting");
    e.el.appendChild(h);
    e.caretTo(h, true);
    reveal(h.getBoundingClientRect());
    e.changed();
  }
  async function pickMode(h) {
    const cur = h.getAttribute("data-task");
    const v = await chipsSheet("How it's going", [["", MODE_IDS.map((m) => [m, MODE_NAME[m], m === cur])]], "", (el) => { for (const b of el.querySelectorAll("[data-v]")) b.classList.add("notes-mode", `qm-${b.dataset.v}`); });
    if (!v || v === cur || !S) return;
    h.setAttribute("data-task", v);
    S.editor.changed();
    renderQuests(S);
    clearTimeout(S.qTimer); S.qTimer = setTimeout(() => syncQuests(S), 200);
  }
  // Hand a quest to Agent, ready to send (Desk's words)
  async function chatAbout(h) {
    const title = h.textContent.trim(), body = bodyOf(h);
    const text = `Let's talk about this quest from my note "${(S.n && S.n.title) || S.f.elements.title.value || "this note"}": ${title}\nMode: ${MODE_NAME[validMode(h.getAttribute("data-task"))]}${body ? `\n\nWhat the note says about it:\n${body}` : ""}`;
    // (Agent's box, filled and not sent: #agent?say=…)
    location.hash = `#agent?say=${encodeURIComponent(text)}`;
  }
  async function choosePhones(h) {
    const id = h.getAttribute("data-qid");
    if (!id) return;
    let chosen = [], phones = [];
    try { const st = await qapi("GET", "/quests/state?who=notes"); chosen = ((st.quests || []).find((q) => q.id === id) || {}).phones || []; } catch (e) {}
    try { phones = (await api("/app/api/push/phones")).phones || []; } catch (e) {}
    const picked = await sheetForm(`<h2 class="sheet-title">Which phones get its reminders</h2><form class="form" data-f novalidate>${toggle({ label: "Owner's phones", name: "owner", checked: !chosen.length })}${phones.length ? phones.map((p) => toggle({ label: `${p.name}${p.who ? ` · ${p.who}` : ""}`, name: `p:${p.id}`, checked: chosen.includes(p.id) })).join("") : '<p class="sheet-text">No phones have notifications on yet (Portal → Alerts → turn them on).</p>'}<div class="btns"><button class="btn main wide" type="submit">Done</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => {
        const fm = el.querySelector("[data-f]");
        fm.addEventListener("change", (ev) => { if (ev.target.name === "owner" && ev.target.checked) fm.querySelectorAll('[name^="p:"]').forEach((x) => (x.checked = false)); else if (ev.target.name.startsWith("p:") && ev.target.checked) fm.elements.owner.checked = false; });
        fm.onsubmit = (ev) => { ev.preventDefault(); done(fm.elements.owner.checked ? [] : [...fm.querySelectorAll('[name^="p:"]:checked')].map((x) => x.name.slice(2))); };
        el.querySelector("[data-no]").onclick = () => done(null);
      });
    if (!picked || JSON.stringify([...picked].sort()) === JSON.stringify([...chosen].sort())) return;
    try { await qapi("POST", `/actions/quests/${encodeURIComponent(id)}`, { changes: { phones: picked } }); toast("Phones changed"); }
    catch (e) { toast("Quests can’t be reached just now, so the phones weren’t changed. Try again in a moment.", true); }
  }
  async function unQuest(h) {
    const id = h.getAttribute("data-qid");
    for (const node of [...h.childNodes]) if (node.nodeType === 3) node.textContent = node.textContent.replace(/\s*\b(quest|task)\b\s*[:\-–—]?\s*/gi, " ");
    h.normalize();
    const first = h.firstChild;
    if (first && first.nodeType === 3) first.textContent = first.textContent.replace(/^\s+/, "");
    if (!h.textContent.trim()) h.textContent = "Untitled";
    for (const a of ["data-task", "data-qid", "data-qkey", "data-qsync"]) h.removeAttribute(a);
    S.editor.changed();
    if (id) await qapi("POST", `/actions/quests/${encodeURIComponent(id)}`, { action: "remove" }).catch(() => {});
  }
  async function qapi(method, path, body) {
    const data = method === "GET" ? await api(path, { headers: HDR }) : await post(path, body, HDR);
    if (data && data.ok === false) throw new Error(data.message || data.error || "That didn't work.");
    return data;
  }
  // Kept in step with Quests both ways: the heading's words → the quest's title; the mode, whichever side changed
  async function syncQuests(s) {
    if (s.qBusy || s.closed) return;
    const e = s.editor, headings = questHeadings(e);
    if (!headings.length) { s.qSay = ""; return; }
    s.qBusy = true;
    let changed = false;
    try {
      const state = await qapi("GET", "/quests/state?who=notes");
      const quests = Array.isArray(state.quests) ? state.quests : [];
      const byId = new Map(quests.map((q) => [q.id, q]));
      const title = ((s.n && s.n.title) || s.f.elements.title.value || "a note").slice(0, 80);
      for (const h of headings) {
        const key = h.getAttribute("data-qkey") || (h.setAttribute("data-qkey", newKey()), h.getAttribute("data-qkey"));
        const link = `note:${s.id}|${key}`;
        const text = h.textContent.trim().slice(0, 140) || "Untitled quest";
        const mode = validMode(h.getAttribute("data-task"));
        let q = byId.get(h.getAttribute("data-qid")) || quests.find((x) => x.link === link);
        if (!q) {
          q = (await qapi("POST", "/actions/quests", { title: text, notes: bodyOf(h), from: `Notes · ${title}`.slice(0, 80), link, mode: ["done", "working", "nearly", "longer"].includes(mode) ? "waiting" : mode })).result;
          if (q && mode !== q.mode) q = (await qapi("POST", `/actions/quests/${encodeURIComponent(q.id)}`, { action: "mode", mode })).result || q;
          if (q) { h.setAttribute("data-qid", q.id); h.setAttribute("data-qsync", q.mode || mode); changed = true; }
          continue;
        }
        if (h.getAttribute("data-qid") !== q.id) { h.setAttribute("data-qid", q.id); changed = true; }
        if (q.title !== text) await qapi("POST", `/actions/quests/${encodeURIComponent(q.id)}`, { changes: { title: text } });
        const agreed = h.getAttribute("data-qsync");
        if (q.mode !== mode) {
          if (agreed && q.mode !== agreed && mode === agreed) h.setAttribute("data-task", validMode(q.mode));
          else await qapi("POST", `/actions/quests/${encodeURIComponent(q.id)}`, { action: "mode", mode });
          changed = true;
        }
        if (h.getAttribute("data-qsync") !== validMode(h.getAttribute("data-task"))) { h.setAttribute("data-qsync", validMode(h.getAttribute("data-task"))); changed = true; }
      }
      s.qSay = "";
    } catch (err) {
      if (err.signIn) s.qSay = "Sign in to keep these quests in step with Quests.";
      else s.qSay = "Quests can’t be reached just now (the studio PC may be off). New quests go as soon as it’s back.";
    } finally { s.qBusy = false; }
    if (s.closed) return;
    if (changed) e.changed();
    renderQuests(s);
  }
  // (and soon after the quests in a note change)
  const syncSoon = () => { if (S) { clearTimeout(S.qTimer); S.qTimer = setTimeout(() => syncQuests(S), 1500); } };
  document.addEventListener("input", (e) => { if (S && e.target.closest && e.target.closest("#note-page") && questHeadings(S.editor).length) syncSoon(); });

  // ---- This note's menu ----
  async function noteMenu() {
    if (!S) return;
    const s = S;
    await s.flush();
    const n = s.n;
    const items = [];
    if (n) items.push(["pin", n.pinned ? "Unpin" : "Pin to the top"], ["copy", "Make a copy"]);
    items.push(["download", "Download…"], ["print", "Print or save as PDF"]);
    if (n) items.push(n.gdocUrl ? ["gdoc-open", "Open its Google Doc", "", "link", n.gdocUrl] : ["gdoc", "Send to Google Docs"], ["gdoc-more", "More for Google Docs…"]);
    items.push(["words", "Copy the words"], ["look", "The page's look"], ["focus", document.documentElement.classList.contains("notes-focus") ? "Leave focus mode" : "Focus mode"], ["help", "Help"]);
    if (n) items.push(["delete", "Delete the note", "danger"]);
    const how = await menu(n ? n.title || "This note" : "This note", items);
    if (!how || how === "gdoc-open") return;
    try {
      if (how === "pin") { const r = await put(n.id, { ...fields(n), pinned: !n.pinned, updated: new Date().toISOString(), base: n.rev }); if (r.note) { notes.set(r.note.id, r.note); s.n = r.note; } toast(n.pinned ? "Unpinned" : "Pinned"); }
      if (how === "copy") { const id = await createNote(C().clean(s.editor.html()), `${n.title} (copy)`, true); toast("Made a copy"); location.hash = `#notes/${encodeURIComponent(id)}`; }
      if (how === "download") download();
      if (how === "print") printNote();
      if (how === "gdoc") sendToDocs();
      if (how === "gdoc-more") googleSheet();
      if (how === "words") { await navigator.clipboard.writeText(C().toText(C().clean(s.editor.html()))); toast("Copied"); }
      if (how === "look") lookSheet();
      if (how === "focus") focusMode(!document.documentElement.classList.contains("notes-focus"));
      if (how === "help") help();
      if (how === "delete") deleteNote(n);
    } catch (err) { toast(err.message, true); }
  }
  async function deleteNote(n) {
    if (!(await confirm({ title: `Delete “${n.title || "this note"}”?`, text: "It's deleted for the whole studio. You can put it back straight after.", ok: "Delete", danger: true }))) return;
    try {
      const r = await api(`${API}/notes/${encodeURIComponent(n.id)}?base=${n.rev ?? ""}`, { method: "DELETE" });
      const kept = S && S.id === n.id ? { ...n, html: C().clean(S.editor.html()) } : n;
      if (S && S.id === n.id) { S.dirty = false; closeSession(); }
      notes.delete(n.id);
      gone = { note: kept, rev: r.note ? r.note.rev : null, at: Date.now() };
      toast("Deleted");
      location.hash = "#notes";
    } catch (err) {
      // Someone changed it meanwhile: it isn't deleted, and it comes back as they left it
      if (err.status === 409 && err.data && err.data.note) { notes.set(err.data.note.id, err.data.note); toast(`Someone changed “${err.data.note.title}” meanwhile, so it wasn't deleted.`, true); if (S && S.id === n.id && !S.dirty) { S.n = err.data.note; S.editor.load(err.data.note.html); } }
      else toast(err.message, true);
    }
  }
  function focusMode(on) {
    document.documentElement.classList.toggle("notes-focus", on);
    if (S) S.f.querySelector("[data-unfocus]").hidden = !on;
    if (on) toast("Focus mode: only the writing");
  }
  async function lookSheet() {
    const themes = window.NovaNotes.themes.list();
    await sheetForm(`<h2 class="sheet-title">The page</h2><form class="form" data-f novalidate>
      ${N.choices({ label: "Page", name: "page", value: prefs.page, options: [["cosmic", "Cosmic"], ["paper", "Paper"]] })}
      <fieldset class="notes-group"><legend>Colour theme (the paper page and what's exported)</legend><div class="chips">${themes.map((t) => `<label class="chip"><input class="sr" type="radio" name="theme" value="${t.id}"${prefs.theme === t.id ? " checked" : ""}>${esc(t.name)}</label>`).join("")}</div></fieldset>
      <fieldset class="notes-group"><legend>Zoom</legend><div class="chips">${[0.75, 0.9, 1, 1.25, 1.5, 2].map((z) => `<label class="chip"><input class="sr" type="radio" name="zoom" value="${z}"${Number(prefs.zoom) === z ? " checked" : ""}>${Math.round(z * 100)}%</label>`).join("")}</div></fieldset>
      <p class="sheet-text">Kept on this phone. Cosmic is the stars; Paper is how the note prints and exports.</p>
      <button type="submit" class="btn main wide">Done</button></form>`, (el, done) => {
      const fm = el.querySelector("[data-f]");
      const mark = () => fm.querySelectorAll(".chips label").forEach((l) => l.setAttribute("aria-pressed", String(l.querySelector("input").checked)));
      mark();
      fm.addEventListener("change", () => { prefs.page = fm.elements.page.value; prefs.theme = fm.elements.theme.value; prefs.zoom = Number(fm.elements.zoom.value) || 1; savePrefs(); mark(); if (S) look(S.page); });
      fm.onsubmit = (ev) => { ev.preventDefault(); done(true); };
    });
  }

  // ---- Out: downloads, printing, Google Docs ----
  const safeName = (t) => (t || "Nova note").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Nova note";
  function saveFile(name, type, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const theme = () => window.NovaNotes.themes.get(prefs.theme);
  const noteTitle = () => (S && ((S.n && S.n.title) || S.f.elements.title.value.trim() || autoTitle(S.page))) || "Nova note";
  async function download() {
    const kind = await menu("Download", [["doc", "Word document (.doc)"], ["html", "Web page (.html)"], ["md", "Markdown (.md)"], ["txt", "Plain text (.txt)"], ["pdf", "PDF (print)"], ["json", "Note backup (.json)"]]);
    if (!kind || !S) return;
    if (kind === "pdf") return printNote();
    await S.flush();
    const html = C().clean(S.editor.html()), title = noteTitle(), name = safeName(title), cv = C();
    if (kind === "html") saveFile(`${name}.html`, "text/html", cv.exportDocument(html, { title, theme: theme() }).html);
    if (kind === "doc") saveFile(`${name}.doc`, "application/msword", cv.wordDocument(html, { title, theme: theme() }));
    if (kind === "md") saveFile(`${name}.md`, "text/markdown", cv.toMarkdown(html));
    if (kind === "txt") saveFile(`${name}.txt`, "text/plain", cv.toText(html));
    if (kind === "json") saveFile(`${name}.nova-note.json`, "application/json", JSON.stringify({ app: "nova-notes", version: 1, exported: new Date().toISOString(), notes: [{ id: S.id, ...fields(S.n || { title, html }), html, shared: true }] }, null, 2));
    toast(`Downloaded ${name}.${kind === "json" ? "nova-note.json" : kind}`);
  }
  async function printNote() {
    if (!S) return;
    await S.flush();
    if (typeof window.print !== "function") return toast("This browser can't print. Download it as a web page or Word document instead.", true);
    const root = document.documentElement, page = S.page, wasPaper = page.classList.contains("paper");
    root.classList.add("notes-print");
    page.classList.add("paper");
    const done = () => { root.classList.remove("notes-print"); if (!wasPaper) page.classList.remove("paper"); removeEventListener("afterprint", done); };
    addEventListener("afterprint", done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 50);
  }
  const exported = () => C().exportDocument(C().clean(S.editor.html()), { title: noteTitle(), theme: theme() });
  // One tap: the studio's Google (an admin connects it) makes it a Google Doc in the Nova Agent folder
  async function sendToDocs() {
    // (the tab first, while the tap still counts: phones block a window opened later)
    const tab = window.open("about:blank", "_blank");
    await S.flush();
    let data = null;
    try { data = await post("/app/api/google/docs", { title: noteTitle(), html: exported().body }); } catch (err) { data = null; }
    if (!data || !data.url) { if (tab) tab.close(); return googleSheet("That didn't reach Google Docs."); }
    if (tab) tab.location.href = data.url; else window.open(data.url, "_blank", "noopener");
    toast("In Google Docs ✦ (the Nova Agent folder)");
  }
  async function googleSheet(problem = "") {
    const n = S && S.n;
    let status = null;
    try { status = await api("/auth/google-status"); } catch (e) {}
    const setUp = !!(status && status.setUp);
    const v = await sheetForm(`<h2 class="sheet-title">Google Docs</h2>${problem ? `<p class="sheet-text bad">${esc(problem)}</p>` : ""}
      <div class="card"><p class="kicker">1 · Copy and paste</p><p>No set-up. Copies the note with its Novacane styling and opens a new Google Doc: paste it there (hold, then Paste).</p><button type="button" class="btn main wide" data-v="copy">Copy and open Google Docs</button></div>
      <div class="card"><p class="kicker">2 · Straight into Google Docs</p><p>${setUp ? "The studio's Google is connected: Send makes a real Google Doc in the Nova Agent folder." : "The studio's Google isn't connected yet. Ask an admin to set it up in Google."}${n ? " Kept in step, changes go both ways every 15 minutes; the newer one wins and the other is kept as a copy." : ""}</p>
        <div class="btns"><button type="button" class="btn wide" data-v="send">Send to Google Docs</button>${n ? `<button type="button" class="btn wide" data-v="keep">${n.gdocKeep ? "Stop keeping it in step" : "Keep in step with its Doc"}</button>` : ""}${n && n.gdocUrl ? `<a class="btn wide" href="${esc(n.gdocUrl)}" target="_blank" rel="noopener">Open its Google Doc</a><button type="button" class="btn quiet wide" data-v="forget">Make a new Doc next time</button>` : ""}<a class="btn quiet wide" href="#google" data-v="setup">Google set-up</a></div>
        <p class="muted small">Saving to Drive with your own Google sign-in is on a computer (Notes in Nova Desk): Nova Phone doesn't let other sites' sign-in into its pages.</p></div>
      <button type="button" class="btn wide quiet" data-no>Close</button>`, (el, done) => { el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v))); el.querySelector("[data-no]").onclick = () => done(null); });
    if (v === "copy") return copyAndOpen();
    if (v === "send") return sendToDocs();
    if (v === "keep") return keepInDocs();
    if (v === "forget" && n) { try { const r = await put(n.id, { ...fields(n), gdocId: "", gdocUrl: "", gdocKeep: false, updated: new Date().toISOString(), base: n.rev }); if (r.note) { notes.set(r.note.id, r.note); S.n = r.note; } toast("The next Send makes a new Doc"); } catch (err) { toast(err.message, true); } }
  }
  async function copyAndOpen() {
    const { body } = exported(), text = C().toText(C().clean(S.editor.html()));
    let ok = false;
    if (navigator.clipboard && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([`<meta charset="utf-8">${body}`], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]); ok = true; } catch (e) {}
    }
    if (!ok) {
      // (the older way: a hidden copy selected and copied; its styles through the CSSOM)
      const box = document.createElement("div");
      box.contentEditable = "true";
      box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      C().setHTML(box, body);
      document.body.append(box);
      const r = document.createRange(); r.selectNodeContents(box);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { ok = document.execCommand("copy"); } catch (e) {}
      sel.removeAllRanges(); box.remove();
    }
    window.open("https://docs.new", "_blank", "noopener");
    toast(ok ? "Copied ✦ In the new Google Doc, paste it in" : "Couldn't copy by itself. Select all in the note and copy it instead.", !ok);
  }
  async function keepInDocs() {
    const n = S && S.n;
    if (!n) return;
    const on = !n.gdocKeep;
    try {
      const data = await post("/app/api/google/docs/keep", { noteId: n.id, on });
      const next = { ...fields(n), gdocKeep: data.kept === true, updated: new Date().toISOString(), base: n.rev };
      if (data.url) { next.gdocUrl = data.url; next.gdocId = (data.url.match(/\/d\/([\w-]+)/) || [])[1] || next.gdocId; }
      const r = await put(n.id, next);
      if (r.note) { notes.set(r.note.id, r.note); if (S) S.n = r.note; }
      toast(next.gdocKeep ? "Kept in Google Docs ✦ Changes go both ways every 15 minutes" : "No longer kept in Google Docs (the Doc stays in Drive)");
    } catch (err) { toast(err.message || "Google Docs didn't answer. Try again in a minute.", true); }
  }
  async function importDoc() {
    const url = await ask("Bring in a Google Doc", { label: "The Doc's address", type: "url", placeholder: "https://docs.google.com/document/d/…", attrs: 'autocapitalize="off" spellcheck="false"' }, "Bring it in");
    if (!url || !url.trim()) return;
    try {
      const r = await post("/app/api/google/docs/import", { url: url.trim() });
      await load(true);
      toast(r.oneWay ? "Opened ✦ It's kept in step from the Doc (Nova can't change a Doc it didn't make, so changes here stay in Notes)" : "Opened ✦ Kept in step with its Google Doc");
      location.hash = `#notes/${encodeURIComponent(r.noteId)}`;
    } catch (err) { toast(err.message || "That Doc couldn't be opened. Try again in a minute.", true); }
  }

  // ---- In: files (Word, web page, Markdown, text, a backup), something shared, a file Agent wrote ----
  const textToHtml = (text) => text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  async function docxToHtml(file) {
    if (!window.mammoth) await script("lib/mammoth.browser.min.js");
    const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: ["p[style-name='Title'] => p.title:fresh", "p[style-name='Subtitle'] => p.subtitle:fresh", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Intense Quote'] => blockquote:fresh"] });
    return C().clean(r.value);
  }
  async function importFiles(files) {
    if (!files.length) return;
    await loadLibs();
    let made = 0, restored = 0, last = null;
    for (const f of files) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      try {
        if (ext === "json") { restored += await restore(JSON.parse(await f.text())); continue; }
        if (f.type.startsWith("image/")) { if (S) insertImageFile(f); else toast("Open a note to put a picture in it", true); continue; }
        let html;
        if (ext === "html" || ext === "htm" || f.type === "text/html") html = C().clean(await f.text());
        else if (ext === "md" || ext === "markdown") html = C().clean(C().fromMarkdown(await f.text()));
        else if (ext === "docx") html = await docxToHtml(f);
        else if (ext === "txt" || f.type.startsWith("text/")) html = textToHtml(await f.text());
        else { toast(`Notes can't read ${f.name} (try Word, HTML, Markdown or text)`, true); continue; }
        last = await createNote(html, f.name.replace(/\.[^.]+$/, ""), true);
        made++;
      } catch (err) { toast(`Couldn't import ${f.name}: ${err.message}`, true); }
    }
    if (made || restored) toast([made && `Imported ${made} note${made === 1 ? "" : "s"}`, restored && `restored ${restored} from a backup`].filter(Boolean).join(", "));
    if (last) location.hash = `#notes/${encodeURIComponent(last)}`;
    else if (restored) N.show();
  }
  async function backupAll() {
    await load(true).catch(() => {});
    const all = sorted().map((n) => ({ id: n.id, ...fields(n), shared: true }));
    saveFile(`Notes backup ${N.today()}.json`, "application/json", JSON.stringify({ app: "nova-notes", version: 1, exported: new Date().toISOString(), notes: all }, null, 2));
    toast(`Backed up ${all.length} note${all.length === 1 ? "" : "s"}`);
  }
  // A Notes backup back in: every note in it becomes a shared note (Nova Phone keeps shared notes only); one already
  // here is replaced by the backup's words, as Notes does on a computer
  async function restore(data) {
    const items = (Array.isArray(data) ? data : Array.isArray(data && data.notes) ? data.notes : null);
    if (!items) throw new Error("That file isn't a Notes backup.");
    const good = items.filter((n) => n && typeof n === "object" && typeof n.html === "string");
    const replacing = good.filter((n) => notes.has(n.id)).length;
    if (!good.length) return 0;
    if (!(await confirm({ title: `Restore ${good.length} note${good.length === 1 ? "" : "s"}?`, text: `They become shared notes for the whole studio.${replacing ? ` ${replacing} already here ${replacing === 1 ? "is" : "are"} replaced by the backup's words.` : ""}`, ok: "Restore" }))) return 0;
    let count = 0;
    for (const n of good) {
      const id = typeof n.id === "string" && /^[\w-]{1,64}$/.test(n.id) ? n.id : newId();
      const had = notes.get(id);
      const r = await put(id, { ...fields({ ...n, html: C().clean(n.html) }), title: typeof n.title === "string" ? n.title.slice(0, 200) : "Untitled note", base: had ? had.rev : null });
      if (r.note) notes.set(r.note.id, r.note);
      if (r.copy) notes.set(r.copy.id, r.copy);
      count++;
    }
    return count;
  }
  // Something shared to Nova Phone (its share sheet): #notes/share?title=&text=&url=, a new note (Desk's way)
  async function drawShared(box, ui) {
    ui.back("#notes");
    const q = new URLSearchParams(location.search);
    const title = (q.get("title") || "").trim(), text = (q.get("text") || "").trim(), url = (q.get("url") || "").trim();
    const link = url || (text.match(/https?:\/\/\S+/) || [])[0] || "";
    const body = link && text.includes(link) ? text.replace(link, "").trim() : text;
    const parts = [];
    if (title) parts.push(`<p class="title">${esc(title)}</p>`);
    if (body) parts.push(...body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`));
    if (link && /^https?:/.test(link)) parts.push(`<p><a href="${esc(link)}">${esc(link)}</a></p>`);
    if (!parts.length) { box.innerHTML = empty({ icon: "notes", title: "Nothing came with it", text: "Share some words or a link to Nova Phone to keep them as a note.", action: `<a class="btn" href="#notes">Back to Notes</a>` }); return; }
    const id = await createNote(parts.join(""), title || (body || link).slice(0, 60) || "Shared note", Boolean(title));
    history.replaceState(null, "", `${location.pathname}#notes/${encodeURIComponent(id)}`);
    toast("Saved what you shared as a new note ✦");
    await load(true).catch(() => {});
    return drawNote(box, notes.get(id), ui, id);
  }
  // A file Nova Agent wrote: #notes/open/files/<id>/<name> (documents only, from this site's /files/)
  async function drawOpenFile(box, rest, ui) {
    ui.back("#notes");
    const [dir, id, ...name] = rest, file = name.join("/");
    if (dir !== "files" || !/^[\w-]+$/.test(id || "") || !/^[^/]+\.(md|markdown|txt|html?)$/i.test(file)) { box.innerHTML = empty({ icon: "notes", title: "That isn't a file Notes can open", text: "Notes opens Markdown, text and web-page files that Nova Agent wrote.", action: `<a class="btn" href="#notes">Back to Notes</a>` }); return; }
    await loadLibs();
    let html;
    try {
      const res = await fetch(`/files/${id}/${encodeURIComponent(file)}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "it has been deleted" : `error ${res.status}`);
      const t = await res.text();
      html = /\.html?$/i.test(file) ? C().clean(t) : /\.(md|markdown)$/i.test(file) ? C().clean(C().fromMarkdown(t)) : textToHtml(t);
    } catch (err) { box.innerHTML = empty({ icon: "notes", title: "Couldn't open that file", text: `From Nova Agent: ${err.message}.`, action: `<a class="btn" href="#notes">Back to Notes</a>` }); return; }
    const nid = await createNote(html, file.replace(/\.[^.]+$/, ""), true);
    history.replaceState(null, "", `#notes/${encodeURIComponent(nid)}`);
    toast("Opened as a new note ✦");
    return drawNote(box, notes.get(nid), ui, nid);
  }

  // ---- Help ----
  function help() {
    sheetForm(`<h2 class="sheet-title">Notes</h2><div class="notes-help">
      <h3>Start anywhere</h3><p>Everything you write lines up in the middle of the page, headings and all. Change it with Align (the ⋯ button). Notes saves as you write.</p>
      <h3>Write the way you do in Google Docs</h3><ul><li>Title, Subtitle, three headings, quotes and code (Aa)</li><li>Fonts, sizes, colours and highlights (Aa and A)</li><li>Lists, checklists, tables, pictures, links, lines and page breaks (+)</li><li>Find and replace, an outline and a word count (⋯)</li></ul>
      <h3>As you type</h3><p><kbd>#</kbd> then space for a heading (<kbd>##</kbd>, <kbd>###</kbd> smaller), <kbd>-</kbd> for a list, <kbd>1.</kbd> for a numbered list, <kbd>[]</kbd> for a checklist, <kbd>&gt;</kbd> for a quote, and <kbd>---</kbd> then Enter for a line across the page. Paste Markdown and it becomes formatting.</p>
      <h3>Quests</h3><p>A heading with the word QUEST in it is a quest in Quests too: set how it's going, talk about it with Agent, or take it off, under the note.</p>
      <h3>Shared notes</h3><p>Notes here are the studio's shared notes: everyone signed in sees and edits them, on every phone and computer. A note kept only in one computer's browser (Local, in Nova Desk) stays on that computer. If two people change a note at once, nobody's words are lost: theirs is kept and yours is saved as a copy.</p>
      <h3>In and out</h3><p>Import Word documents, web pages, Markdown and text files; download a note as Word, a web page, Markdown, text or PDF; send it to Google Docs with its styling. With a keyboard attached, the computer's shortcuts work too (Ctrl or ⌘ with B, I, U, Z, Y, K…).</p>
      <h3>Nova Phone on your home screen</h3><p>iPhone: Share, then “Add to Home Screen”. Android: the browser's menu, then “Install app”.</p>
      <p class="muted small">Notes · Nova Agent · Novacane Studios. Notes that write from the centre of the universe outwards.</p></div>
      <button type="button" class="btn wide quiet" data-no>Close</button>`, (el, done) => { el.querySelector("[data-no]").onclick = () => done(null); });
  }
})();
