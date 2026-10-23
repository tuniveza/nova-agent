// Nova Phone: Board, the same boards as Nova Desk's Board (kept by Nova Agent on the studio's PC). On a computer a
// board is a table of cards; on the phone, the same cards in a list, in the order they sit on the table (top
// to bottom, left to right): stickies, words, questions and answers, Agent's answers, links, pictures and files,
// notes and calendar spans. Add a card, change it, pin it, remove it; new boards, rename, delete. A new card is
// placed under the others on the table, so the computer's table stays tidy.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, field, empty, api, toast, confirm, choose, form: sheetForm, busy, ago } = N;
  const HDR = { "X-Nova-Visualizer": "1" };
  const COLOURS = [["rose", "#FF8CC6"], ["amber", "#FFC069"], ["lime", "#B6E36B"], ["teal", "#3DF5B8"], ["violet", "#C7A4FF"], ["sky", "#7FD3FF"]];
  const KIND = { sticky: "Sticky note", text: "Words", question: "Question", agent: "Asked Agent", link: "Link", image: "Picture", file: "File", note: "Note", calendar: "Calendar" };
  let boards = null, offline = false;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  async function load() {
    try { boards = (await api("/board-api/boards")).boards || []; offline = false; }
    catch (err) { if (err.signIn) throw err; if (err.status === 503 || err.status === 502) { offline = true; boards = boards || []; return; } throw err; }
  }
  async function save(b) {
    const res = await fetch(`/board-api/boards/${encodeURIComponent(b.id)}`, { method: "PUT", credentials: "same-origin", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ board: b, base: b.updated || undefined }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.board) { Object.assign(b, data.board); throw new Error("It was changed somewhere else meanwhile: showing the latest. Make your change again."); }
    if (!res.ok) throw new Error(data.message || data.error || `Not saved (${res.status})`);
    if (data.board) Object.assign(b, data.board);
  }
  const order = (cards) => [...cards].sort((a, b) => (b.pinned - a.pinned) || (Math.round(a.y / 120) - Math.round(b.y / 120)) || a.x - b.x);
  const cardRow = (b, c) => {
    const title = c.title || (c.kind === "question" ? c.text : "") || (c.kind === "image" || c.kind === "file" ? c.fileName : "") || (c.url ? c.url.replace(/^https?:\/\//, "") : "") || (c.text || "").slice(0, 80) || KIND[c.kind];
    const sub = [KIND[c.kind] || c.kind, c.kind === "question" || c.kind === "agent" ? (c.answer ? "Answered" : "No answer yet") : "", c.span ? `${c.span} from ${c.start || ""}` : "", c.pinned ? "Pinned" : ""].filter(Boolean).join(" · ");
    return row({ href: `#board/${encodeURIComponent(b.id)}/${encodeURIComponent(c.id)}`, lead: c.kind === "sticky" ? `<span class="sticky-dot" data-c="${esc((COLOURS.find(([k]) => k === c.colour) || COLOURS[1])[1])}"></span>` : icon({ link: "globe", image: "board", file: "pdf", note: "notes", calendar: "calendar", agent: "agent", question: "chat" }[c.kind] || "board"), title, text: sub });
  };
  N.section({
    id: "board", name: "Board", tile: "board",
    async draw(box, [bid, cid], ui) {
      await load();
      if (offline) { box.innerHTML = `<div class="empty">${icon("globe")}<b>The studio's computer is off</b><span>Boards live on it. They're safe; they'll be back when it is.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`; return; }
      if (bid && cid) return drawCard(box, bid, cid, ui);
      if (bid) return drawBoard(box, bid, ui);
      ui.action({ icon: "plus", label: "New board", run: newBoard });
      box.innerHTML = boards.length ? list(boards.map((b) => row({ href: `#board/${encodeURIComponent(b.id)}`, lead: window.NovaTile ? window.NovaTile("board") : icon("board"), title: b.name || "Board", text: `${b.cards.length} card${b.cards.length === 1 ? "" : "s"}`, end: esc(ago(b.updated)) }))) : empty({ icon: "board", title: "No boards yet", action: `<button type="button" class="btn main" data-new-board>${icon("plus")} New board</button>` });
      box.querySelector("[data-new-board]")?.addEventListener("click", newBoard);
    },
  });
  async function newBoard() {
    const name = await ask("New board", "Name", "");
    if (name === null) return;
    const now = new Date().toISOString();
    const b = { id: uid(), name: name || "Board", created: now, updated: "", view: { x: 0, y: 0, zoom: 1 }, cards: [] };
    try { await save(b); toast("Board made"); location.hash = `#board/${encodeURIComponent(b.id)}`; } catch (err) { toast(err.message, true); }
  }
  const ask = (title, label, value, type = "text") => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${field({ label, name: "v", type, rows: 5, value })}<div class="btns"><button class="btn main wide" type="submit">OK</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.v.value.trim()); }; el.querySelector("[data-no]").onclick = () => done(null); });

  function drawBoard(box, bid, ui) {
    ui.back("#board");
    const b = boards.find((x) => x.id === bid);
    if (!b) { box.innerHTML = empty({ icon: "board", title: "That board isn't there any more" }); return; }
    ui.title(b.name || "Board");
    ui.action({ icon: "plus", label: "Add a card", run: () => addCard(b) });
    box.innerHTML = `${b.cards.length ? list(order(b.cards).map((c) => cardRow(b, c))) : empty({ icon: "board", title: "Your table is clear", action: `<button type="button" class="btn main" data-add>${icon("plus")} Add a card</button>` })}
      <div class="btns two"><button type="button" class="btn" data-b="rename">${icon("edit")} Rename</button><button type="button" class="btn danger" data-b="delete">${icon("trash")} Delete this board</button></div>`;
    box.querySelector("[data-add]")?.addEventListener("click", () => addCard(b));
    box.querySelectorAll(".sticky-dot[data-c]").forEach((d) => d.style.setProperty("background", d.dataset.c));
    box.querySelectorAll("[data-b]").forEach((x) => x.addEventListener("click", async () => {
      try {
        if (x.dataset.b === "rename") { const n = await ask("Rename the board", "Name", b.name); if (n === null) return; b.name = n || b.name; await save(b); toast("Renamed"); N.show(); }
        else { if (!(await confirm({ title: `Delete “${b.name}”?`, text: `Its ${b.cards.length} card${b.cards.length === 1 ? "" : "s"} go too.`, ok: "Delete", danger: true }))) return; await api(`/actions/board/${encodeURIComponent(b.id)}/remove`, { method: "POST", headers: HDR, body: "{}" }); toast("Deleted"); location.hash = "#board"; }
      } catch (err) { toast(err.message, true); }
    }));
  }
  async function addCard(b) {
    const kind = await choose({ title: "Add a card", options: [["sticky", "Sticky note"], ["text", "Words"], ["question", "Question card"], ["agent", "Ask Agent"], ["link", "Link"], ["file", "Picture or file"]] });
    if (!kind) return;
    const now = new Date().toISOString();
    const bottom = b.cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
    const c = { id: uid(), kind, x: 40, y: bottom + 40, w: kind === "sticky" ? 220 : 300, h: kind === "sticky" ? 220 : 200, z: b.cards.reduce((m, x) => Math.max(m, x.z), 0) + 1, turn: kind === "sticky" ? Math.round(Math.random() * 4 - 2) : 0, pinned: false, created: now, updated: now };
    try {
      if (kind === "sticky") { const t = await ask("Sticky note", "What it says", "", "textarea"); if (t === null) return; c.text = t; c.colour = (await choose({ title: "Colour", options: COLOURS.map(([k]) => [k, k[0].toUpperCase() + k.slice(1)]) })) || "amber"; }
      if (kind === "text") { const t = await ask("Words", "What it says", "", "textarea"); if (t === null) return; c.text = t; }
      if (kind === "question") { const t = await ask("Question card", "The question", ""); if (t === null) return; c.text = t; c.answer = ""; }
      if (kind === "link") { const u = await ask("Link", "Web address", "", "url"); if (!u) return; c.url = /^https?:\/\//.test(u) ? u : `https://${u}`; try { const l = await api(`/board-api/link?url=${encodeURIComponent(c.url)}`); c.title = l.link?.title || ""; c.text = l.link?.description || ""; } catch (e) { /* (no preview: just the link) */ } }
      if (kind === "agent") {
        const q = await ask("Ask Agent", "Your question", ""); if (!q) return;
        c.title = q; c.asked = now; toast("Asking Agent…");
        const r = await api("/actions/chat", { method: "POST", headers: HDR, body: JSON.stringify({ message: q }) }).catch((e) => ({ reply: `(${e.message})` }));
        c.answer = r.reply || "";
      }
      if (kind === "file") {
        const file = await pickFile(); if (!file) return;
        toast(`Uploading ${file.name}…`);
        const res = await fetch(`/actions/board-files?name=${encodeURIComponent(file.name)}`, { method: "POST", credentials: "same-origin", headers: { ...HDR, "Content-Type": file.type || "application/octet-stream" }, body: file });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.file) throw new Error(res.status === 413 ? "That file's too big for Board." : res.status === 415 ? "Board can't keep that kind of file." : d.message || "It didn't upload");
        c.kind = /^image\//.test(d.file.type || file.type) ? "image" : "file"; c.fileId = d.file.id; c.fileType = d.file.type || file.type; c.fileName = file.name;
      }
      b.cards.push(c);
      await save(b);
      toast("Card added");
      N.show();
    } catch (err) { b.cards = b.cards.filter((x) => x.id !== c.id); toast(err.message, true); }
  }
  const pickFile = () => new Promise((resolve) => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*,video/*,audio/*,application/pdf,.txt,.md,.csv"; i.onchange = () => resolve(i.files[0] || null); i.click(); });

  function drawCard(box, bid, cid, ui) {
    const b = boards.find((x) => x.id === bid);
    const c = b?.cards.find((x) => x.id === cid);
    ui.back(`#board/${encodeURIComponent(bid)}`);
    if (!c) { box.innerHTML = empty({ icon: "board", title: "That card isn't there any more" }); return; }
    ui.title(KIND[c.kind] || "Card");
    const body = {
      sticky: `<div class="sticky" data-c="${esc((COLOURS.find(([k]) => k === c.colour) || COLOURS[1])[1])}"><p class="pre">${esc(c.text || "")}</p></div>`,
      text: `<div class="card"><p class="pre">${esc(c.text || "")}</p></div>`,
      question: `<div class="card"><p class="kicker">Question</p><p><b>${esc(c.text || "")}</b></p>${c.answer ? `<p class="kicker">Answer</p><p class="pre">${esc(c.answer)}</p>` : `<p class="muted">No answer yet.</p>`}</div>`,
      agent: `<div class="card"><p class="kicker">Asked ${esc(ago(c.asked))}</p><p><b>${esc(c.title || "")}</b></p><p class="pre">${esc(c.answer || "")}</p></div>`,
      link: `<div class="card"><p class="kicker">${esc((c.url || "").replace(/^https?:\/\//, "").split("/")[0])}</p><p><b>${esc(c.title || c.url || "")}</b></p>${c.text ? `<p class="muted">${esc(c.text)}</p>` : ""}<a class="btn wide" href="${esc(c.url)}" target="_blank" rel="noopener">${icon("globe")} Open the link</a></div>`,
      image: `<div class="card"><img class="board-img" src="/board-files/${encodeURIComponent(c.fileId || "")}" alt="${esc(c.fileName || "")}"><p class="muted small">${esc(c.fileName || "")}</p></div>`,
      file: `<div class="card"><p><b>${esc(c.fileName || "File")}</b></p><a class="btn wide" href="/board-files/${encodeURIComponent(c.fileId || "")}" target="_blank" rel="noopener">${icon("pdf")} Open it</a></div>`,
      note: `<div class="card"><p class="kicker">A note</p><p><b>${esc(c.title || "Note")}</b></p>${c.noteId ? `<a class="btn wide" href="#notes/${encodeURIComponent(c.noteId)}">${icon("notes")} Open the note</a>` : ""}</div>`,
      calendar: `<div class="card"><p class="kicker">Calendar · a ${esc(c.span || "week")}</p><p><b>From ${esc(c.start || "")}</b></p><a class="btn wide" href="#calendar/${c.span === "month" || c.span === "year" ? "month" : c.span === "day" ? "day" : "week"}/${esc(c.start || "")}">${icon("calendar")} Open the calendar there</a></div>`,
    }[c.kind] || `<div class="card"><p class="pre">${esc(c.text || c.title || "")}</p></div>`;
    const editable = ["sticky", "text", "question"].includes(c.kind);
    box.innerHTML = `${body}<p class="muted small">Added ${esc(ago(c.created))}${c.updated !== c.created ? ` · changed ${esc(ago(c.updated))}` : ""}</p>
      <div class="btns two">${editable ? `<button type="button" class="btn main" data-c="edit">${icon("edit")} ${c.kind === "question" ? "Answer or change" : "Change it"}</button>` : ""}<button type="button" class="btn" data-c="pin">${c.pinned ? "Unpin" : "Pin it"}</button><button type="button" class="btn danger" data-c="remove">${icon("trash")} Remove</button></div>`;
    box.querySelectorAll(".sticky[data-c]").forEach((d) => d.style.setProperty("--c", d.dataset.c));
    box.querySelectorAll("[data-c]").forEach((x) => x.addEventListener("click", async () => {
      const what = x.dataset.c;
      try {
        if (what === "edit") {
          if (c.kind === "question") { const v = await sheetForm(`<h2 class="sheet-title">Question card</h2><form class="form" data-f>${field({ label: "The question", name: "q", value: c.text || "" })}${field({ label: "The answer", name: "a", type: "textarea", rows: 5, value: c.answer || "" })}<div class="btns"><button class="btn main wide" type="submit">Save</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`, (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ q: ev.target.elements.q.value, a: ev.target.elements.a.value }); }; el.querySelector("[data-no]").onclick = () => done(null); }); if (!v) return; c.text = v.q; c.answer = v.a; }
          else { const t = await ask(KIND[c.kind], "What it says", c.text || "", "textarea"); if (t === null) return; c.text = t; }
        }
        if (what === "pin") c.pinned = !c.pinned;
        if (what === "remove") { if (!(await confirm({ title: "Remove this card?", ok: "Remove", danger: true }))) return; b.cards = b.cards.filter((x) => x.id !== c.id); }
        c.updated = new Date().toISOString();
        await save(b);
        toast(what === "remove" ? "Removed" : "Saved");
        if (what === "remove") location.hash = `#board/${encodeURIComponent(bid)}`; else N.show();
      } catch (err) { toast(err.message, true); N.show(); }
    }));
  }
})();
