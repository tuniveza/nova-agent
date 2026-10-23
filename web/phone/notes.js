// Nova on a phone: Notes. The shared notes (the ones everyone in the studio sees; a note kept only on one
// computer stays on that computer): the list, newest first and pinned at the top, each note to read and
// write in, and new ones. Saved to the same place as the computer's Notes; if someone changed a note at the
// same time, theirs is kept and this phone's words become a copy (Nova Bot does that, as for the computer).
(() => {
  "use strict";
  const { section, api, esc, icon, computerLink } = window.NovaPhone;
  const API = "/notes-api";
  const notes = new Map();
  let cursor = "", loadedAt = 0;
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
  const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
  const textOf = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
  // A note's words, safe to show and to write in: no scripts, frames, styles or handlers, links to web pages only
  function clean(html) {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    for (const el of doc.body.querySelectorAll("script, style, iframe, object, embed, link, meta, form, input, button, textarea, select")) el.remove();
    for (const el of doc.body.querySelectorAll("*")) {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n.startsWith("on") || n === "style" || n === "class" || n === "id" || ((n === "href" || n === "src") && !/^(https?:|mailto:|tel:|data:image\/)/i.test(a.value.trim()))) el.removeAttribute(a.name);
      }
      if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    }
    return doc.body.innerHTML;
  }

  section({
    id: "notes",
    name: "Notes",
    async draw(page, [id]) {
      await load(!id);
      if (id === "new") return drawNote(page, null);
      if (id) return drawNote(page, notes.get(id) || null, id);
      const list = [...notes.values()].sort((a, b) => (b.pinned === a.pinned ? String(b.updated).localeCompare(String(a.updated)) : b.pinned ? 1 : -1));
      page.innerHTML = `<p><a class="btn main wide" href="#notes/new">+ New note</a></p>
        ${list.length ? `<ul class="rows">${list.map((n) => `<li><a class="row" href="#notes/${encodeURIComponent(n.id)}"><span class="row-lead">${icon("notes")}</span><span class="row-main"><strong>${n.pinned ? "📌 " : ""}${esc(n.title || "Untitled note")}</strong><small>${esc(textOf(n.html).slice(0, 120))}</small></span><span class="row-end">${esc(when(n.updated))}</span></a></li>`).join("")}</ul>` : `<p class="note">No shared notes yet.</p>`}
        <p class="muted small">Shared notes only: a note kept on one computer stays there.</p>
        <p><a class="btn wide" href="${computerLink("/notes/")}">${icon("open")} Notes in the computer version</a></p>`;
    },
  });

  function drawNote(page, n, id) {
    if (id && !n) {
      page.innerHTML = `<p class="note">That note isn't there any more.</p><p><a class="btn wide" href="#notes">Back to Notes</a></p>`;
      return;
    }
    page.innerHTML = `<form class="stack form note-edit" id="note-form">
        <input name="title" class="note-title" placeholder="Title" maxlength="200" value="${esc(n && (n.named || n.title !== "Untitled note") ? n.title : "")}" aria-label="Title">
        <div class="note-body" id="note-body"${n ? "" : " data-autofocus"} contenteditable="true" role="textbox" aria-multiline="true" aria-label="The note">${clean(n ? n.html : "")}</div>
        <p class="form-said" id="note-said" role="status">${n ? `${n.by ? `Last changed by ${esc(n.by)}, ` : ""}${esc(when(n.updated))}` : ""}</p>
        <div class="btns"><button class="btn main" type="submit">Save</button><a class="btn" href="#notes">${n ? "Back" : "Cancel"}</a></div>
      </form>`;
    const form = page.querySelector("#note-form"), body = page.querySelector("#note-body"), said = page.querySelector("#note-said");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const now = new Date().toISOString();
      const typed = form.elements.title.value.trim();
      const html = clean(body.innerHTML);
      const first = textOf(html).slice(0, 60);
      const noteId = n ? n.id : crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      const out = {
        title: typed || first || "Untitled note", html, created: n?.created || now, updated: now, pinned: !!n?.pinned, named: !!typed,
        gdocId: n?.gdocId || null, gdocUrl: n?.gdocUrl || null, gdocKeep: n?.gdocKeep === true, base: Number.isInteger(n?.rev) ? n.rev : null,
      };
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      said.textContent = "Saving…";
      try {
        const r = await api(`${API}/notes/${encodeURIComponent(noteId)}`, { method: "PUT", body: JSON.stringify(out) });
        if (r.note) notes.set(r.note.id, r.note);
        if (r.copy) notes.set(r.copy.id, r.copy);
        if (r.conflict) {
          said.textContent = `Someone changed this note at the same time. Theirs is kept here; yours is saved as “${r.copy ? r.copy.title : "a copy"}”.`;
          btn.disabled = false;
          return;
        }
        said.textContent = "Saved.";
        btn.disabled = false;
        if (!n) location.hash = `#notes/${encodeURIComponent(noteId)}`;
        else n = r.note || n;
      } catch (err) {
        said.textContent = /413/.test(err.message) ? "Too big to share from a phone: make it shorter, or use the computer version." : `Not saved (${err.message}).`;
        btn.disabled = false;
      }
    });
  }
})();
