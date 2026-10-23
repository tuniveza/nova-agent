// Nova Phone: Notes, the studio's shared notes (the same ones as Nova Desk's Notes; a note kept only in one
// computer's browser stays there). The list, pinned first and newest next, searchable; a note to read and
// write in, with a formatting bar (headings, bold, italic, underline, lists, checklists, links); pin it,
// delete it; send it to Google Docs, keep it in step with its Doc, or bring a Google Doc in. If someone changed
// a note at the same time, theirs is kept and these words are saved as a copy (Nova Bot does that).
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, post, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const API = "/notes-api";
  const notes = new Map();
  let cursor = "", loadedAt = 0, search = "", google = null;
  async function load(force = false) {
    if (!force && Date.now() - loadedAt < 15000) return;
    for (let round = 0; round < 20; round++) {
      const r = await api(`${API}/changes${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`);
      for (const n of r.notes || []) (n.deleted ? notes.delete(n.id) : notes.set(n.id, n));
      cursor = r.cursor || cursor;
      if (!r.more) break;
    }
    loadedAt = Date.now();
  }
  // Read as a page of its own, with style attributes and blocks renamed first: Chrome holds a parsed page to Nova
  // Phone's CSP and reports every style="…" in it as blocked (the styles are dropped below anyway)
  const parse = (html) => new DOMParser().parseFromString(String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[a-z][^>]*>/gi, (t) => t.replace(/\sstyle\s*=/gi, " data-style=")), "text/html");
  const textOf = (html) => parse(html).body.textContent.replace(/\s+/g, " ").trim();
  // A note's words, safe to show and to write in: no scripts, frames or handlers; links to web pages only
  function clean(html) {
    const doc = parse(html);
    for (const el of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, form, button, select, textarea")) el.remove();
    for (const el of doc.body.querySelectorAll("*")) {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (n === "href" && /^(https?:|mailto:|tel:)/i.test(a.value.trim())) || (n === "src" && /^(https?:|data:image\/)/i.test(a.value.trim())) || (el.tagName === "INPUT" && (n === "type" || n === "checked")) || n === "alt" || n === "colspan" || n === "rowspan";
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === "INPUT" && el.getAttribute("type") !== "checkbox") el.remove();
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    }
    return doc.body.innerHTML;
  }
  const sorted = () => [...notes.values()].sort((a, b) => (!!b.pinned === !!a.pinned ? String(b.updated).localeCompare(String(a.updated)) : b.pinned ? 1 : -1));

  N.section({
    id: "notes",
    name: "Notes",
    tile: "notes",
    async draw(box, [id], ui) {
      await load(!id);
      if (id === "new") return drawNote(box, null, ui);
      if (id) return drawNote(box, notes.get(id), ui, id);
      ui.action({ icon: "plus", label: "New note", href: "#notes/new" });
      const q = search.toLowerCase();
      const shown = sorted().filter((n) => !q || `${n.title} ${textOf(n.html)}`.toLowerCase().includes(q));
      box.innerHTML = `<form class="search" data-note-search><label class="field"><span class="sr">Search notes</span><input class="input" type="search" name="q" value="${esc(search)}" placeholder="Search notes"></label></form>
        ${shown.length ? list(shown.map((n) => row({ href: `#notes/${encodeURIComponent(n.id)}`, lead: window.NovaTile ? window.NovaTile("notes") : icon("notes"), title: `${n.pinned ? "📌 " : ""}${n.title || "Untitled note"}`, text: textOf(n.html).slice(0, 120) || "Empty", end: esc(ago(n.updated)) }))) : empty({ icon: "notes", title: search ? `No notes match “${search}”` : "No shared notes yet", action: `<a class="btn main" href="#notes/new">${icon("plus")} Write one</a>` })}
        <button type="button" class="btn wide" data-gdoc-import>Bring in a Google Doc</button>`;
      box.querySelector("[data-note-search]").addEventListener("submit", (e) => { e.preventDefault(); search = e.target.elements.q.value.trim(); N.show(); });
      box.querySelector("[data-gdoc-import]").addEventListener("click", importDoc);
    },
  });

  // The formatting bar: each button a command on what's selected
  const TOOLS = [["h", "Heading", "H"], ["bold", "Bold", "<b>B</b>"], ["italic", "Italic", "<i>I</i>"], ["underline", "Underline", "<u>U</u>"], ["ul", "Bulleted list", "•"], ["ol", "Numbered list", "1."], ["check", "Checklist", "☐"], ["link", "Link", "🔗"], ["clear", "Plain text", "T̸"]];
  function drawNote(box, n, ui, id) {
    ui.back("#notes");
    if (id && !n) { box.innerHTML = empty({ icon: "notes", title: "That note isn't there any more" }); return; }
    ui.title(n ? n.title || "Note" : "New note");
    ui.action({ icon: "more", label: "More for this note", run: () => noteMenu(n) });
    box.innerHTML = `<form class="form" id="note-form" novalidate>
        <label class="field"><span class="sr">Title</span><input class="input note-title" name="title" placeholder="Title" maxlength="200" value="${esc(n && (n.named || n.title !== "Untitled note") ? n.title : "")}"></label>
        <div class="format-bar" role="toolbar" aria-label="Formatting">${TOOLS.map(([c, l, g]) => `<button type="button" class="fmt" data-fmt="${c}" aria-label="${l}">${g}</button>`).join("")}</div>
        <div class="note-body" id="note-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="The note"${n ? "" : " data-autofocus"}>${clean(n ? n.html : "")}</div>
        <p class="form-said" id="note-said" role="status">${n ? `${n.by ? `Last changed by ${esc(n.by)}, ` : ""}${esc(ago(n.updated))}${n.gdocUrl ? ` · <a href="${esc(n.gdocUrl)}" target="_blank" rel="noopener">its Google Doc</a>` : ""}` : "Shared with the studio once it's saved."}</p>
        <button class="btn main wide" type="submit">${icon("check")} Save</button>
      </form>`;
    const f = box.querySelector("#note-form"), body = box.querySelector("#note-body"), said = box.querySelector("#note-said");
    body.addEventListener("input", () => f.classList.add("dirty"));
    box.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("pointerdown", (e) => e.preventDefault()));
    box.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("click", async () => {
      body.focus();
      const c = b.dataset.fmt;
      if (c === "h") document.execCommand("formatBlock", false, document.queryCommandValue("formatBlock") === "h2" ? "p" : "h2");
      else if (c === "ul") document.execCommand("insertUnorderedList");
      else if (c === "ol") document.execCommand("insertOrderedList");
      else if (c === "check") document.execCommand("insertHTML", false, '<ul class="checklist"><li><input type="checkbox"> </li></ul>');
      else if (c === "link") { const sel = getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null; const url = await askLink(); if (url) { body.focus(); if (range) { sel.removeAllRanges(); sel.addRange(range); } if (range && !range.collapsed) document.execCommand("createLink", false, url); else document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(url)}</a>`); } }
      else if (c === "clear") { document.execCommand("removeFormat"); document.execCommand("formatBlock", false, "p"); }
      else document.execCommand(c);
      f.classList.add("dirty");
    }));
    // (a ticked box in a checklist stays ticked when saved)
    body.addEventListener("change", (e) => { if (e.target.matches("input[type=checkbox]")) { e.target.toggleAttribute("checked", e.target.checked); f.classList.add("dirty"); } });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const now = new Date().toISOString(), typed = f.elements.title.value.trim(), html = clean(body.innerHTML);
      const noteId = n ? n.id : crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      const out = { title: typed || textOf(html).slice(0, 60) || "Untitled note", html, created: n?.created || now, updated: now, pinned: !!n?.pinned, named: !!typed, gdocId: n?.gdocId || null, gdocUrl: n?.gdocUrl || null, gdocKeep: n?.gdocKeep === true, base: Number.isInteger(n?.rev) ? n.rev : null };
      await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
        try {
          const r = await api(`${API}/notes/${encodeURIComponent(noteId)}`, { method: "PUT", body: JSON.stringify(out) });
          if (r.note) notes.set(r.note.id, r.note);
          if (r.copy) notes.set(r.copy.id, r.copy);
          f.classList.remove("dirty");
          if (r.conflict) { said.textContent = `Someone changed this note at the same time. Theirs is kept here; yours is saved as “${r.copy ? r.copy.title : "a copy"}”.`; said.classList.add("bad"); return; }
          toast("Saved");
          if (!n) location.hash = `#notes/${encodeURIComponent(noteId)}`;
          else { n = r.note || n; said.textContent = "Saved just now"; }
        } catch (err) { said.textContent = err.status === 413 ? "Too big to share: make it shorter." : `Not saved: ${err.message}`; said.classList.add("bad"); }
      });
    });
  }
  const askLink = () => sheetForm(`<h2 class="sheet-title">Add a link</h2><form class="form" data-f>${field({ label: "Web address", name: "url", type: "url", placeholder: "https://" })}<div class="btns"><button class="btn main wide" type="submit">Add</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const v = ev.target.elements.url.value.trim(); done(/^https?:\/\//i.test(v) ? v : v ? `https://${v}` : null); }; el.querySelector("[data-no]").onclick = () => done(null); });
  // This note: pin, Google Docs, delete
  async function noteMenu(n) {
    if (!n) return toast("Save the note first");
    const how = await choose({ title: n.title || "This note", options: [["pin", n.pinned ? "Unpin" : "Pin to the top"], ["gdoc", n.gdocUrl ? "Open its Google Doc" : "Send to Google Docs"], ...(n.gdocUrl ? [["keep", n.gdocKeep ? "Stop keeping it in step with its Doc" : "Keep it in step with its Doc"]] : []), ["copy", "Copy the words"], ["delete", "Delete the note", "danger"]] });
    if (!how) return;
    try {
      if (how === "pin") { const r = await api(`${API}/notes/${encodeURIComponent(n.id)}`, { method: "PUT", body: JSON.stringify({ ...pick(n), pinned: !n.pinned, updated: new Date().toISOString(), base: n.rev }) }); if (r.note) notes.set(r.note.id, r.note); toast(n.pinned ? "Unpinned" : "Pinned"); N.show(); }
      if (how === "gdoc") { if (n.gdocUrl) { location.href = n.gdocUrl; return; } const r = await post("/app/api/google/docs", { title: n.title, html: n.html }); if (r.url) { window.open(r.url, "_blank"); toast("Sent to Google Docs"); } }
      if (how === "keep") { await post("/app/api/google/docs/keep", { noteId: n.id, on: !n.gdocKeep }); toast(n.gdocKeep ? "No longer kept in step" : "Kept in step with its Doc"); await load(true); N.show(); }
      if (how === "copy") { await navigator.clipboard.writeText(textOf(n.html)); toast("Copied"); }
      if (how === "delete") {
        if (!(await confirm({ title: `Delete “${n.title || "this note"}”?`, text: "It's deleted for the whole studio.", ok: "Delete", danger: true }))) return;
        await api(`${API}/notes/${encodeURIComponent(n.id)}?base=${n.rev ?? ""}`, { method: "DELETE" });
        notes.delete(n.id); toast("Deleted"); location.hash = "#notes";
      }
    } catch (err) { toast(err.status === 400 || err.status === 503 ? `${err.message} (Google may not be set up: an admin sets it up in Google)` : err.message, true); }
  }
  const pick = (n) => ({ title: n.title, html: n.html, created: n.created, pinned: n.pinned, named: n.named, gdocId: n.gdocId, gdocUrl: n.gdocUrl, gdocKeep: n.gdocKeep === true });
  async function importDoc() {
    const url = await sheetForm(`<h2 class="sheet-title">Bring in a Google Doc</h2><form class="form" data-f>${field({ label: "The Doc's address", name: "url", type: "url", placeholder: "https://docs.google.com/document/d/…" })}<div class="btns"><button class="btn main wide" type="submit">Bring it in</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
      (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.url.value.trim()); }; el.querySelector("[data-no]").onclick = () => done(null); });
    if (!url) return;
    try { const r = await post("/app/api/google/docs/import", { url }); await load(true); toast("Brought in"); location.hash = `#notes/${encodeURIComponent(r.noteId)}`; } catch (err) { toast(err.message, true); }
  }
})();
