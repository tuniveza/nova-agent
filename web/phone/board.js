// Nova Phone: Board, the same boards as Nova Desk's Board (kept by Nova Agent on the studio's PC). On a computer a
// board is a table of cards moved about with the mouse; on the phone, the same cards as a list that says what the
// table says:
//   - the order is where they sit (top to bottom, left to right); cards lying together on the table are a group;
//     a bigger card is a bigger tile; a card lying over another says so; a pinned card stays where it is
//   - "The table from above": a small map of the table, its numbers the tiles' numbers
//   - drags become taps that write the same x, y, w, h and z as Nova Desk, so its table stays tidy: Move up and
//     Move down (swap places with the card before or after), Bigger and Smaller, Bring to front, Pin
//   - every card kind: sticky notes (Nova Desk's six colours), text, labels, question cards, Agent's questions and
//     answers, links, pictures, videos, sounds and files, notes from Notes, a day, week, month or year of the
//     calendar with what's on
//   - removed cards: Undo, and the bin (the last 40, for 7 days, kept on this phone like Nova Desk's)
//   - the studio computer off: the boards kept on this phone, changes kept here and sent when it's back
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, field, empty, toast } = N;
  // One sheet after another: the last one's "closed" comes a moment after its answer and would answer the next
  // one too (phone.js openSheet's onclose), so each waits for it
  const sheetEl = document.getElementById("sheet");
  let closing = null;
  const settled = (fn) => async (...a) => {
    if (closing) await closing;
    const v = await fn(...a);
    closing = new Promise((r) => { const end = () => { clearTimeout(t); closing = null; r(); }; const t = setTimeout(end, 150); sheetEl?.addEventListener("close", () => setTimeout(end, 0), { once: true }); });
    return v;
  };
  const confirm = settled(N.confirm), choose = settled(N.choose), sheetForm = settled(N.form);
  const HDR = { "X-Nova-Visualizer": "1" };
  const UK = { timeZone: "Europe/London" };
  const CACHE = "nova-phone-board-v1";
  const BIN = "nova-board-bin-v1"; // (the same bin as Nova Desk's Board, in this browser)
  const BASE = (document.currentScript && document.currentScript.src) || location.href;
  // Nova Desk's sticky colours (board.js:601): a sticky's colour is its own, the same in every theme
  const STICKY = { rose: "#ff8fbd", amber: "#ffc94a", lime: "#a8e05f", teal: "#5fd8bd", violet: "#b994ff", sky: "#7cc4ff" };
  const KIND_NAMES = { note: "Note", calendar: "Calendar", agent: "Agent", question: "Question", sticky: "Sticky note", text: "Text", link: "Link", image: "Picture", file: "File" };
  const SIZES = { note: [280, 190], calendar: [320, 300], agent: [340, 260], question: [300, 230], sticky: [220, 200], text: [280, 160], link: [320, 140], image: [320, 240], file: [280, 150] };
  const EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
  const AWAY = "Saved on this phone. It goes to the studio computer when that's back.";

  // ---- Little helpers ----
  const keepGet = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } };
  const keepSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* (private mode: kept for this visit only) */ } };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const nowIso = () => new Date().toISOString();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const when = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString("en-GB", { ...UK, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
  const todayUk = () => new Date().toLocaleDateString("en-CA", UK);
  const dayLabel = (date, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url || ""; } };
  const fileUrl = (c) => c.asset || `/board-files/${encodeURIComponent(c.fileId || "")}`;
  const textOf = (html) => { try { return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.replace(/\s+/g, " ").trim(); } catch (e) { return ""; } };
  // (a snippet of Agent's answer in plain words: its marks taken off)
  const plain = (s) => String(s || "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "$1").replace(/^\s*([-*•]|\d+\.)\s+/gm, "").replace(/\*\*|__|^#+\s*/gm, "");
  const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); if (s.length <= n) return s; const cut = s.slice(0, n); return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 20))}…`; };
  const href = (b, c) => `#board/${encodeURIComponent(b.id)}${c ? `/${encodeURIComponent(c.id)}` : ""}`;
  const showing = () => location.hash.startsWith("#board");

  // A file card says what it is (board.js:516)
  function kindName(c) {
    const t = c.fileType || "";
    if (c.kind === "file") return t.startsWith("video/") ? "Video" : t.startsWith("audio/") ? "Sound" : t === "application/pdf" ? "PDF" : "File";
    if (c.kind === "text" && c.hint) return "Label";
    return KIND_NAMES[c.kind] || "Card";
  }
  function cardTitle(c) {
    if (c.kind === "calendar") return calendarTitle(c);
    if (c.kind === "link") return c.title || hostOf(c.url);
    return String(c.title || c.text || c.fileName || c.url || KIND_NAMES[c.kind] || "Card").split("\n")[0].slice(0, 80);
  }

  // ---- The boards: from the studio computer, kept on this phone too ----
  let boards = null, loadedAt = 0, offline = false, statusText = "";
  const sending = new Set(), again = new Set();
  function cache() { if (boards) keepSet(CACHE, { boards }); }
  async function load(force) {
    if (boards && !force && !offline && Date.now() - loadedAt < 20000) return;
    try {
      const data = await N.api("/board-api/boards", { cache: "no-store" });
      const local = new Map((boards || keepGet(CACHE, {}).boards || []).map((b) => [b.id, b]));
      const fresh = (data.boards || []).map((sb) => {
        const mine = local.get(sb.id);
        // (changed here and not sent yet: ours, sent next)
        return mine && mine.dirty ? { ...mine, serverUpdated: sb.updated } : { ...sb, serverUpdated: sb.updated };
      });
      for (const b of local.values()) if (b.dirty && !fresh.some((f) => f.id === b.id)) fresh.push(b);
      boards = fresh;
      loadedAt = Date.now();
      if (offline) { offline = false; status(""); }
      cache();
      pushDirty();
    } catch (err) {
      if (err.signIn) throw err;
      boards = boards || keepGet(CACHE, {}).boards || null;
      if (!boards) throw Object.assign(err, { away: true });
      offline = true;
      status("The studio computer isn't answering: these are the boards kept on this phone. Changes are kept here and sent when it's back.");
    }
  }
  // A change: kept on this phone at once, sent to the studio computer (one save at a time for each board)
  function changed(b) {
    b.dirty = true;
    b.updated = nowIso();
    cache();
    return push(b);
  }
  async function push(b) {
    if (sending.has(b.id)) { again.add(b.id); return; }
    sending.add(b.id);
    try { await pushNow(b); } finally { sending.delete(b.id); if (again.delete(b.id)) await push(b); }
  }
  async function pushNow(b) {
    const snapshot = JSON.parse(JSON.stringify({ id: b.id, name: b.name, created: b.created, view: b.view || { x: 0, y: 0, zoom: 1 }, cards: b.cards, ...(b.welcome ? { welcome: true } : {}) }));
    let res;
    try {
      res = await fetch(`/board-api/boards/${encodeURIComponent(b.id)}`, { method: "PUT", credentials: "same-origin", headers: { ...HDR, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ board: snapshot, base: b.serverUpdated || undefined }) });
    } catch (e) { return away(); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.board) {
      Object.assign(b, data.board, { serverUpdated: data.board.updated, dirty: false });
      cache();
      toast("This board changed somewhere else, so here's the newest.", true);
      if (showing()) N.show();
      return;
    }
    if (res.status === 401) { status("Sign in with Portal to keep your boards. They're kept on this phone meanwhile."); return; }
    if (res.status >= 500 || (!res.ok && !data.message)) return away();
    if (!res.ok || !data.ok) {
      // (refused: the studio computer's copy is the one that counts)
      b.dirty = false; loadedAt = 0; cache();
      toast(data.message || `Not saved (${res.status})`, true);
      return;
    }
    const same = JSON.stringify({ name: b.name, view: b.view, cards: b.cards }) === JSON.stringify({ name: snapshot.name, view: snapshot.view, cards: snapshot.cards });
    // (the cards on screen stay the same objects: only the flag and the time the computer saved it change)
    if (same) b.dirty = false;
    b.serverUpdated = data.board?.updated || b.serverUpdated;
    cache();
    if (offline || statusText) { offline = false; status(""); }
  }
  let retryTimer = 0, retryWaiting = false;
  function away() {
    offline = true;
    status(AWAY);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retry, 20000);
  }
  // (tried again in 20 s, but only while Board is on screen; otherwise when it's next opened, or the signal's back)
  function retry() {
    if (document.hidden || !showing()) { retryWaiting = true; return; }
    retryWaiting = false;
    pushDirty();
  }
  const pushDirty = () => (boards || []).filter((b) => b.dirty).forEach((b) => push(b));
  addEventListener("online", pushDirty);
  addEventListener("hashchange", () => { if (retryWaiting && showing()) retry(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && retryWaiting && showing()) retry(); });
  addEventListener("pagehide", pushDirty);
  function status(text) {
    statusText = text;
    const el = document.getElementById("board-status");
    if (el) { el.textContent = text; el.hidden = !text; }
  }
  const statusHtml = () => `<p class="card board-status small" id="board-status" role="status"${statusText ? "" : " hidden"}>${esc(statusText)}</p>`;

  // ---- The table, read as a list ----
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // Top to bottom, left to right: cards whose tops are within half a card of each other are one row
  function readingOrder(cards) {
    const rows = [];
    for (const c of [...cards].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const r = rows[rows.length - 1];
      if (r && c.y < r.top + Math.min(r.h, c.h) * 0.5) { r.cards.push(c); r.h = Math.min(r.h, c.h); } else rows.push({ top: c.y, h: c.h, cards: [c] });
    }
    return rows.flatMap((r) => r.cards.sort((a, b) => a.x - b.x));
  }
  // Groups: cards lying within 60 of each other on the table (Nova Desk places new cards 18 apart)
  function groups(cards) {
    const near = (a, b) => a.x < b.x + b.w + 60 && a.x + a.w + 60 > b.x && a.y < b.y + b.h + 60 && a.y + a.h + 60 > b.y;
    const parent = cards.map((_, i) => i);
    const top = (i) => (parent[i] === i ? i : (parent[i] = top(parent[i])));
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (near(cards[i], cards[j])) parent[top(i)] = top(j);
    const by = new Map();
    cards.forEach((c, i) => { const k = top(i); if (!by.has(k)) by.set(k, []); by.get(k).push(c); });
    const gs = [...by.values()].map((g) => readingOrder(g));
    // (the groups themselves in reading order, by their first card)
    const firsts = readingOrder(gs.map((g) => ({ ...g.reduce((m, c) => ({ x: Math.min(m.x, c.x), y: Math.min(m.y, c.y), w: 1, h: Math.min(m.h, c.h) }), { x: Infinity, y: Infinity, h: Infinity }), g })));
    return firsts.map((f) => f.g);
  }
  // Where each card sits: its number, its group, what it lies on or under
  function layout(b) {
    const gs = groups(b.cards);
    const order = gs.flat();
    const info = new Map();
    order.forEach((c, i) => {
      const touching = b.cards.filter((x) => x !== c && overlap(x, c));
      info.set(c.id, { n: i + 1, group: gs.find((g) => g.includes(c)), under: touching.filter((x) => (x.z || 0) > (c.z || 0)).length, over: touching.filter((x) => (x.z || 0) <= (c.z || 0)).length });
    });
    return { gs, order, info };
  }
  // How big it is next to its kind's usual size (a bigger card on the table is a bigger tile here)
  function sizeOf(c) {
    const [w, h] = SIZES[c.kind] || [260, 180];
    const r = (c.w * c.h) / (w * h);
    return r >= 1.5 ? "big" : r <= 0.62 ? "small" : "";
  }

  N.section({
    id: "board", name: "Board", tile: "board",
    async draw(box, [bid, cid], ui) {
      await N.css("board.css");
      try { await load(!bid); } catch (err) {
        if (err.signIn) throw err;
        box.innerHTML = `<div class="empty">${icon("globe")}<b>The studio's computer is off</b><span>Boards live on it. They're safe; they'll be back when it is.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`;
        return;
      }
      if (bid && cid) return drawCard(box, bid, cid, ui);
      if (bid) return drawBoard(box, bid, ui);
      ui.action({ icon: "plus", label: "New board", run: newBoard });
      box.innerHTML = `${statusHtml()}${boards.length ? N.list(boards.map((b) => N.row({ href: href(b), lead: window.NovaTile ? window.NovaTile("board") : icon("board"), title: b.name || "Board", text: [plural(b.cards.length, "card"), b.welcome ? "Welcome: what Board can do" : "", b.dirty ? "Not sent to the studio computer yet" : ""].filter(Boolean).join(" · "), end: esc(N.ago(b.updated)) }))) : empty({ icon: "board", title: "No boards yet", action: `<button type="button" class="btn main" data-new-board>${icon("plus")} New board</button>` })}`;
      box.querySelector("[data-new-board]")?.addEventListener("click", newBoard);
    },
  });

  const ask = (title, label, value, type = "text", attrs = "") => sheetForm(`<h2 class="sheet-title">${esc(title)}</h2><form class="form" data-f>${field({ label, name: "v", type, rows: 5, value, attrs })}<div class="btns"><button class="btn main wide" type="submit">OK</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
    (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done(ev.target.elements.v.value.trim()); }; el.querySelector("[data-no]").onclick = () => done(null); });
  const blank = (name) => { const now = nowIso(); return { id: rid(), name, created: now, updated: now, view: { x: 0, y: 0, zoom: 1 }, cards: [] }; };
  async function newBoard() {
    const name = await ask("New board", "Name", `Board ${(boards || []).length + 1}`, "text", 'maxlength="80"');
    if (name === null) return;
    const b = blank(name.slice(0, 80) || `Board ${boards.length + 1}`);
    boards.push(b);
    await changed(b);
    toast(`“${b.name}” is ready.`);
    location.hash = href(b);
  }

  // ---- A board ----
  let removedNow = null; // { entry, until }: the card just removed, for Undo
  function drawBoard(box, bid, ui) {
    ui.back("#board");
    const b = boards.find((x) => x.id === bid);
    if (!b) { box.innerHTML = empty({ icon: "board", title: "That board isn't there any more", action: `<a class="btn" href="#board">Your boards</a>` }); return; }
    ui.title(b.name || "Board");
    ui.action({ icon: "plus", label: "Add a card", run: () => addMenu(b) });
    const { gs, info } = layout(b);
    const bin = binFor(b);
    const undo = removedNow && removedNow.entry.boardId === b.id && Date.now() < removedNow.until;
    let html = statusHtml();
    if (undo) html += `<div class="card board-undo" role="status"><span>Card removed.</span><button type="button" class="btn" data-undo>Undo</button></div>`;
    if (b.welcome) html += `<section class="card board-welcome"><p class="kicker">Welcome to Board ✦</p><p>This board shows what Board can do: play the video, press play on the sound, pin and unpin cards, move them about. On the computer it's a table to lay things out on; here, the same cards in the order they lie. When you're ready:</p><div class="btns"><button type="button" class="btn main wide" data-w="clear">Clear it and start</button><button type="button" class="btn wide" data-w="new">Keep it, start a new board</button><button type="button" class="btn quiet wide" data-w="keep">Keep as is</button></div></section>`;
    if (b.cards.length > 1) html += mapHtml(b, info);
    if (!b.cards.length) html += empty({ icon: "board", title: "Your table is clear", text: "Add a sticky note, a question, a link, a picture, a note, a stretch of the calendar or something you asked Agent.", action: `<button type="button" class="btn main" data-add>${icon("plus")} Add a card</button>` });
    // (cards that lie together on the table, together here; cards on their own, one after another)
    let alone = [];
    const flush = () => { if (alone.length) { html += `<div class="board-tiles">${alone.join("")}</div>`; alone = []; } };
    for (const g of gs) {
      if (g.length === 1) { alone.push(tile(b, g[0], info.get(g[0].id))); continue; }
      flush();
      html += `<section class="board-group" aria-label="${g.length} cards together"><p class="board-group-head">${g.length} cards together</p><div class="board-tiles">${g.map((c) => tile(b, c, info.get(c.id))).join("")}</div></section>`;
    }
    flush();
    html += `<div class="btns two">${bin.length ? `<button type="button" class="btn" data-b="bin">${icon("trash")} Removed cards (${bin.length})</button>` : ""}<button type="button" class="btn" data-b="rename">${icon("edit")} Rename</button><button type="button" class="btn danger" data-b="delete">${icon("trash")} Delete this board</button></div>`;
    box.innerHTML = html;
    wireMedia(box);
    box.querySelector("[data-add]")?.addEventListener("click", () => addMenu(b));
    box.querySelector("[data-undo]")?.addEventListener("click", () => { const e = removedNow.entry; removedNow = null; restore(e); });
    if (undo) setTimeout(() => { if (removedNow && Date.now() >= removedNow.until) box.querySelector(".board-undo")?.remove(); }, removedNow.until - Date.now() + 50);
    box.querySelectorAll("[data-w]").forEach((x) => x.addEventListener("click", () => welcome(b, x.dataset.w)));
    box.querySelectorAll("[data-b]").forEach((x) => x.addEventListener("click", async () => {
      if (x.dataset.b === "bin") return openBin(b);
      if (x.dataset.b === "rename") { const n = await ask("Rename the board", "Name", b.name, "text", 'maxlength="80"'); if (!n) return; b.name = n.slice(0, 80); await changed(b); toast("Renamed"); N.show(); return; }
      deleteBoard(b);
    }));
    // (pasted while the board's open, not into a box: a picture, a link or some text becomes a card, as on the computer)
    pasteTo = b;
  }
  // A card in the list: its number, what kind, what it says, and where it lies
  function tile(b, c, at) {
    const s = sizeOf(c);
    const n = s === "big" ? 300 : s === "small" ? 90 : 160;
    const badges = [c.pinned ? `<span class="pill">Pinned</span>` : "", at.under ? `<span class="pill warn">Under ${at.under === 1 ? "a card" : `${at.under} cards`}</span>` : at.over ? `<span class="pill">On top</span>` : ""].join("");
    let body = "";
    if (c.kind === "sticky") body = `<p class="pre">${esc(clip(c.text, n) || "An empty sticky note")}</p>`;
    else if (c.kind === "text") body = `<p class="pre">${esc(clip(c.text, n) || "Some text…")}</p>`;
    else if (c.kind === "question") body = `<b>${esc(c.text || "What's the question?")}</b><span>${esc(c.answer ? clip(c.answer, n) : "No answer yet")}</span>`;
    else if (c.kind === "agent") body = c.title ? `<b>${esc(c.title)}</b><span>${esc(c.asking ? "Agent is thinking…" : c.answer ? clip(plain(c.answer), n) : "Not answered yet")}</span>` : `<b>Ask Agent</b><span>Not asked yet: open it to ask.</span>`;
    else if (c.kind === "note") body = `<b>${esc(c.title || "Untitled note")}</b>${c.text ? `<span>${esc(clip(c.text, n))}</span>` : ""}<small>${esc(noteTimes(c))}</small>`;
    else if (c.kind === "calendar") body = `<b>${esc(calendarTitle(c))}</b><span>${esc(`A ${c.span || "week"} of the calendar`)}</span>`;
    else if (c.kind === "link") body = `<span class="board-link">${favicon(c)}<b>${esc(c.title || hostOf(c.url))}</b></span>${c.text ? `<span>${esc(clip(c.text, n))}</span>` : ""}<small>${esc(hostOf(c.url))}</small>`;
    else if (c.kind === "image") body = `${media("img", c, true)}${c.title && c.title !== c.fileName ? `<span>${esc(c.title)}</span>` : ""}`;
    else if (c.kind === "file") body = `<b>${esc(c.title || c.fileName || "A file")}</b>${c.fileName && c.title && c.fileName !== c.title ? `<span>${esc(c.fileName)}</span>` : ""}`;
    const colour = c.kind === "sticky" ? ` data-c="${STICKY[c.colour] || STICKY.amber}"` : "";
    return `<a class="board-tile k-${esc(c.kind)}${s ? ` ${s}` : ""}" href="${href(b, c)}" data-cid="${esc(c.id)}"${colour} aria-label="Card ${at.n}: ${esc(kindName(c))}, ${esc(cardTitle(c))}${c.pinned ? ", pinned" : ""}"><span class="board-tile-top"><span class="board-n">${at.n}</span><span class="board-kind">${esc(kindName(c))}</span>${badges}</span><span class="board-tile-body">${body}</span></a>`;
  }
  const noteTimes = (c) => [c.noteCreated && `Made ${when(c.noteCreated)}`, c.noteUpdated && `Changed ${when(c.noteUpdated)}`].filter(Boolean).join(" · ");
  // A link's little icon (its page's, or the site's own); hidden if it doesn't come
  function favicon(c) {
    let src = "";
    try { src = c.fileName && /^https?:/.test(c.fileName) ? c.fileName : `${new URL(c.url).origin}/favicon.ico`; } catch (e) { /* (no icon) */ }
    return src ? `<img class="board-fav" src="${esc(src)}" alt="" referrerpolicy="no-referrer" loading="lazy" data-fav>` : "";
  }
  // A picture, video or sound: a calm placeholder until it's there; if it doesn't come, "Try again" (board.js:691)
  function media(tag, c, inTile) {
    const m = tag === "img" ? `<img src="${esc(fileUrl(c))}" alt="${esc(c.fileName || "A picture")}" loading="lazy" decoding="async">`
      : tag === "video" ? `<video controls playsinline preload="metadata" src="${esc(fileUrl(c))}"></video>`
      : `<audio controls preload="metadata" src="${esc(fileUrl(c))}"></audio>`;
    return `<span class="board-media m-${tag} is-loading" data-media>${m}<span class="board-wait small muted">${tag === "img" ? "Bringing the picture…" : "Getting it ready…"}</span>${inTile ? `<span class="board-failed small">Couldn't load it · open it to try again</span>` : `<button type="button" class="btn board-retry">${icon("refresh")} Couldn't load it · Try again</button>`}</span>`;
  }
  function wireMedia(root) {
    root.querySelectorAll("[data-fav]").forEach((i) => i.addEventListener("error", () => i.remove()));
    root.querySelectorAll("[data-media]").forEach((box) => {
      const m = box.querySelector("img, video, audio");
      const ok = () => box.classList.remove("is-loading", "is-failed");
      m.addEventListener(m.tagName === "IMG" ? "load" : "loadedmetadata", ok);
      m.addEventListener("error", () => { box.classList.remove("is-loading"); box.classList.add("is-failed"); });
      if (m.tagName === "IMG" && m.complete && m.naturalWidth) ok();
      box.querySelector(".board-retry")?.addEventListener("click", () => {
        box.classList.remove("is-failed"); box.classList.add("is-loading");
        const src = m.getAttribute("src").replace(/[?&]again=\d+$/, "");
        m.src = `${src}${src.includes("?") ? "&" : "?"}again=${Date.now()}`;
        if (m.load && m.tagName !== "IMG") m.load();
      });
    });
  }
  // The table from above: every card where it lies, the size it is, the one on top drawn last
  function mapHtml(b, info) {
    const cs = b.cards;
    const minX = Math.min(...cs.map((c) => c.x)), minY = Math.min(...cs.map((c) => c.y));
    const maxX = Math.max(...cs.map((c) => c.x + c.w)), maxY = Math.max(...cs.map((c) => c.y + c.h));
    const pad = 30, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    // (the numbers drawn about 13px tall, however big the table)
    const scale = Math.min((Math.min(innerWidth, 760) - 64) / w, 190 / h);
    const fs = Math.round(13 / scale), r = Math.max(1, Math.round(4 / scale));
    const rects = [...cs].sort((a, c) => (a.z || 0) - (c.z || 0)).map((c) => {
      const fill = c.kind === "sticky" ? ` fill="${STICKY[c.colour] || STICKY.amber}"` : "";
      const n = info.get(c.id).n;
      return `<g class="bm k-${esc(c.kind)}${c.pinned ? " pinned" : ""}"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${r}"${fill}/>${Math.min(c.w, c.h) * scale >= 16 ? `<text x="${c.x + c.w / 2}" y="${c.y + c.h / 2}" font-size="${fs}" dominant-baseline="central" text-anchor="middle">${n}</text>` : ""}${c.pinned ? `<circle cx="${c.x + r * 1.8}" cy="${c.y + r * 1.8}" r="${r}"/>` : ""}</g>`;
    }).join("");
    return `<figure class="card board-map"><figcaption class="kicker">The table from above</figcaption><svg viewBox="${minX - pad} ${minY - pad} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${rects}</svg><p class="muted small">The numbers are the cards below, in the order they lie: top to bottom, left to right. A dot is a pinned card.</p></figure>`;
  }

  // ---- The Welcome board: what to do with it (once) ----
  async function welcome(b, how) {
    delete b.welcome;
    if (how === "clear") { b.cards = []; b.name = "My board"; }
    await changed(b);
    if (how === "clear") toast("All clear: the table is yours.");
    if (how === "keep") toast("Kept as it is. Add your own cards any time with +.");
    if (how === "new") { toast("“Welcome” is kept in your boards."); return newBoard(); }
    N.show();
  }

  async function deleteBoard(b) {
    if (!(await confirm({ title: `Delete “${b.name}”?`, text: `Its ${plural(b.cards.length, "card")} go too.`, ok: "Delete", danger: true }))) return;
    try {
      const res = await fetch(`/actions/board/${encodeURIComponent(b.id)}/remove`, { method: "POST", credentials: "same-origin", headers: { ...HDR, "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
    } catch (e) { return toast("Couldn't delete it just now: the studio computer didn't answer.", true); }
    boards = boards.filter((x) => x.id !== b.id);
    // (there's always one board)
    if (!boards.length) { const m = blank("My board"); boards.push(m); await changed(m); }
    cache();
    toast(`“${b.name}” deleted.`);
    location.hash = "#board";
  }

  // ---- Adding cards ----
  // Round and round from the middle of the computer's view, a little further each time, until a card that size
  // fits (board.js:857): a new card never lands on top of others, and shows where Nova Desk is looking
  function freeSpot(b, w, h) {
    const v = b.view && Number.isFinite(b.view.zoom) ? b.view : { x: 0, y: 0, zoom: 1 };
    const centre = { x: (640 - v.x) / v.zoom, y: (360 - v.y) / v.zoom };
    const gap = 18;
    const clear = (x, y) => !b.cards.some((c) => x < c.x + c.w + gap && x + w + gap > c.x && y < c.y + c.h + gap && y + h + gap > c.y);
    const x0 = centre.x - w / 2, y0 = centre.y - h / 2;
    if (clear(x0, y0)) return { x: x0, y: y0 };
    for (let ring = 1; ring < 40; ring++) {
      const r = ring * 60, steps = 8 + ring * 4;
      for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; const x = x0 + Math.cos(a) * r * 1.4, y = y0 + Math.sin(a) * r; if (clear(x, y)) return { x, y }; }
    }
    return { x: x0, y: y0 };
  }
  function makeCard(b, spec, i = 0) {
    const [w, h] = SIZES[spec.kind] || [260, 180];
    const spot = freeSpot(b, w, h);
    const now = nowIso();
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const c = { id: rid(), w, h, turn: still ? 0 : Math.round((Math.random() * 3 - 1.5) * 10) / 10, pinned: false, created: now, updated: now, ...spec, x: Math.round(spot.x + i * 30), y: Math.round(spot.y + i * 30), z: Math.max(0, ...b.cards.map((x) => x.z || 0)) + 1 };
    b.cards.push(c);
    return c;
  }
  let fresh = "";
  async function added(b, c, open) {
    await changed(b);
    toast("Card added");
    fresh = c.id;
    if (open) location.hash = href(b, c);
    else N.show();
  }
  async function addMenu(b) {
    const kind = await choose({ title: "Add a card", options: [["sticky", "Sticky note"], ["question", "Question card"], ["agent", "Ask Agent"], ["text", "Text"], ["link", "Link…"], ["file", "Pictures or files…"], ["paste", "Paste a link or some text…"], ["note", "A note from Notes…"], ["calendar", "The calendar: a day, week, month or year…"], ["asked", "Something you asked Agent…"]] });
    if (!kind) return;
    if (kind === "sticky") {
      const v = await sheetForm(`<h2 class="sheet-title">Sticky note</h2><form class="form" data-f>${field({ label: "What it says", name: "text", type: "textarea", rows: 4, placeholder: "Write anything…" })}<fieldset class="field"><legend>Its colour</legend><div class="board-swatches">${Object.entries(STICKY).map(([k, hex], i) => `<label class="board-swatch" data-c="${hex}"><input type="radio" name="colour" value="${k}"${i === 1 ? " checked" : ""} aria-label="${k[0].toUpperCase()}${k.slice(1)}"></label>`).join("")}</div></fieldset><div class="btns"><button class="btn main wide" type="submit">Add it</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); const x = ev.target.elements; done({ text: x.text.value.trim(), colour: [...el.querySelectorAll("[name=colour]")].find((r) => r.checked)?.value || "amber" }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      return added(b, makeCard(b, { kind, text: v.text, colour: v.colour }));
    }
    if (kind === "text") { const t = await ask("Text", "Some text…", "", "textarea"); if (!t) return; return added(b, makeCard(b, { kind, text: t.slice(0, 20000) })); }
    if (kind === "question") {
      const v = await sheetForm(`<h2 class="sheet-title">Question card</h2><form class="form" data-f>${field({ label: "Question", name: "q", type: "textarea", rows: 2, placeholder: "What's the question?" })}${field({ label: "Answer", name: "a", type: "textarea", rows: 3, placeholder: "The answer, notes, next steps…" })}<div class="btns"><button class="btn main wide" type="submit">Add it</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div></form>`,
        (el, done) => { el.querySelector("[data-f]").onsubmit = (ev) => { ev.preventDefault(); done({ q: ev.target.elements.q.value.trim(), a: ev.target.elements.a.value.trim() }); }; el.querySelector("[data-no]").onclick = () => done(null); });
      if (!v) return;
      return added(b, makeCard(b, { kind, text: v.q, answer: v.a }));
    }
    if (kind === "agent") {
      const q = await ask("Ask Agent", "Ask Agent anything…", "", "textarea"); if (q === null) return;
      const c = makeCard(b, { kind });
      await added(b, c, true);
      if (q) askAgent(b, c, q);
      return;
    }
    if (kind === "link") { const u = await ask("Paste or type a link", "Web address", "", "text", 'placeholder="https://…" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false"'); if (u) addLink(b, u); return; }
    if (kind === "paste") return pasteSheet(b);
    if (kind === "file") return pickFiles(b);
    if (kind === "note") return pickNote(b);
    if (kind === "calendar") return pickSpan(b);
    if (kind === "asked") return pickAsked(b);
  }
  const looksLikeUrl = (t) => /^https?:\/\/\S+$/i.test(String(t).trim());
  async function addLink(b, url) {
    url = url.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const c = makeCard(b, { kind: "link", url, title: hostOf(url) });
    try {
      const d = await N.api(`/board-api/link?url=${encodeURIComponent(url)}`, { headers: HDR });
      if (d.ok && d.link) { c.title = d.link.title || c.title; c.text = d.link.description || ""; c.fileName = d.link.icon || ""; c.url = d.link.url || url; }
    } catch (e) { /* (no preview: just the link) */ }
    return added(b, c);
  }
  async function pasteSheet(b) {
    let clip = "";
    try { if (navigator.clipboard && navigator.clipboard.readText) clip = (await navigator.clipboard.readText()) || ""; } catch (e) { /* (the phone said no: typed or pasted by hand) */ }
    const t = await ask("Paste a link or some text", "A link becomes a link card; anything else a text card", clip, "textarea");
    if (!t) return;
    if (looksLikeUrl(t)) return addLink(b, t);
    return added(b, makeCard(b, { kind: "text", text: t.slice(0, 20000) }));
  }
  // Pasted onto the open board (not into a box): as on the computer
  let pasteTo = null;
  document.addEventListener("paste", (e) => {
    if (!pasteTo || !location.hash.startsWith(href(pasteTo)) || location.hash.split("/").length > 2) return;
    if (e.target.closest && e.target.closest("textarea, input, [contenteditable]")) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...dt.files];
    if (files.length) { e.preventDefault(); return uploadAll(pasteTo, files.map((f) => (f.name ? f : new File([f], `pasted.${f.type.split("/")[1] || "png"}`, { type: f.type })))); }
    const text = dt.getData("text/plain");
    if (!text || !text.trim()) return;
    e.preventDefault();
    if (looksLikeUrl(text)) addLink(pasteTo, text);
    else added(pasteTo, makeCard(pasteTo, { kind: "text", text: text.slice(0, 20000) }));
  });

  // Pictures and files: how big one may be is asked first (board.js:998), several at once, a big one with its %
  let limits = null;
  function pickFiles(b) {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = true;
    i.accept = "image/*,video/*,audio/*,application/pdf,.txt,.md,.csv,.mp3,.wav,.m4a,.ogg,.mp4,.webm,.mov";
    i.onchange = () => { const fs = [...i.files]; if (fs.length) uploadAll(b, fs); };
    i.click();
  }
  async function uploadAll(b, files) {
    if (!limits) limits = await N.api("/board-api/limits", { cache: "no-store" }).then((d) => (d && d.maxBytes ? d : null)).catch(() => null);
    const lim = limits || { maxBytes: 95 * 1024 * 1024, max: "95 MB" };
    let n = 0;
    for (const file of files) {
      const type = (file.type || EXT_TYPES[(file.name.split(".").pop() || "").toLowerCase()] || "").toLowerCase();
      if (!type || !Object.values(EXT_TYPES).includes(type)) { toast(`“${file.name}” can't go on a board (pictures, PDFs, text, audio and video can).`, true); continue; }
      if (file.size > lim.maxBytes) { toast(`“${file.name}” is too big (${lim.max} at most${lim.here ? "" : " online; up to 500 MB on the studio computer itself"}).`, true); continue; }
      status(`Putting “${file.name}” on the table…`);
      try {
        const d = await sendFile(file, type);
        makeCard(b, { kind: type.startsWith("image/") ? "image" : "file", fileId: d.file.id, fileType: type, fileName: file.name.slice(0, 200), title: file.name.slice(0, 200) }, n++);
      } catch (err) { toast(`Couldn't keep “${file.name}”: ${err.message}`, true); }
      status(offline ? AWAY : "");
    }
    if (n) { await changed(b); toast(n === 1 ? "Card added" : `${n} cards added`); N.show(); }
  }
  function sendFile(file, type) {
    const url = `/actions/board-files?name=${encodeURIComponent(file.name.slice(0, 200))}`;
    const fail = (status, d) => new Error(d.message || d.error || (status === 503 ? "The studio computer is off, so files can't be kept just now." : `error ${status}`));
    // (a big one with a progress line, since a video takes a while; a small one simply sent)
    if (file.size <= 2e6) {
      return fetch(url, { method: "POST", credentials: "same-origin", headers: { ...HDR, "Content-Type": type }, body: file })
        .catch(() => { throw new Error("the connection dropped"); })
        .then(async (res) => { const d = await res.json().catch(() => ({})); if (res.ok && d.ok && d.file) return d; throw fail(res.status, d); });
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.setRequestHeader("X-Nova-Visualizer", "1");
      xhr.setRequestHeader("Content-Type", type);
      xhr.upload.onprogress = (e) => e.lengthComputable && status(`Putting “${file.name}” on the table… ${Math.round((e.loaded / e.total) * 100)}%`);
      xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) { /* (not JSON) */ } if (xhr.status >= 200 && xhr.status < 300 && d.ok && d.file) resolve(d); else reject(fail(xhr.status, d)); };
      xhr.onerror = () => reject(new Error("the connection dropped"));
      xhr.send(file);
    });
  }

  // A list to pick from, in a sheet: a search box when there are many
  function pickSheet(title, items, empty, hint) {
    return sheetForm(`<h2 class="sheet-title">${esc(title)}</h2>${hint ? `<p class="sheet-text small">${esc(hint)}</p>` : ""}${items.length > 6 ? field({ label: "Find one", name: "q", type: "search", attrs: 'autocomplete="off" data-q' }) : ""}<ul class="list board-pick" data-list></ul><p class="muted small" data-none hidden></p><button type="button" class="btn quiet wide" data-no>Cancel</button>`, (el, done) => {
      const ul = el.querySelector("[data-list]"), none = el.querySelector("[data-none]");
      const draw = (q = "") => {
        const shown = items.filter((x) => !q || `${x.title} ${x.text} ${x.find || ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
        ul.innerHTML = shown.map((x) => N.row({ button: `data-i="${items.indexOf(x)}"`, icon: x.icon || "plus", title: x.title, text: x.text })).join("");
        ul.hidden = !shown.length;
        none.hidden = !!shown.length;
        none.textContent = items.length ? "Nothing matches that." : empty;
        ul.querySelectorAll("[data-i]").forEach((r) => (r.onclick = () => done(items[Number(r.dataset.i)])));
      };
      draw();
      el.querySelector("[data-q]")?.addEventListener("input", (e) => draw(e.target.value.trim()));
      el.querySelector("[data-no]").onclick = () => done(null);
    });
  }
  async function pickNote(b) {
    toast("Looking for your notes…");
    const found = new Map();
    try {
      let since = 0;
      for (let round = 0; round < 10; round++) {
        const d = await N.api(`/notes-api/changes?since=${since}`, { cache: "no-store" });
        for (const n of d.notes || []) { if (n.deleted || !n.html) found.delete(n.id); else found.set(n.id, n); }
        since = d.cursor || since;
        if (!d.more) break;
      }
    } catch (err) { if (err.signIn) return toast("Sign in first", true); return toast("Notes didn't load. Check the connection and try again.", true); }
    const notes = [...found.values()].sort((a, c) => String(c.updated || "").localeCompare(String(a.updated || ""))).slice(0, 200);
    const items = notes.map((n) => { const text = textOf(n.html); return { icon: "notes", title: n.title || "Untitled note", text: `Changed ${when(n.updated)} · Shared`, find: text, spec: { kind: "note", noteId: n.id, title: (n.title || "Untitled note").slice(0, 300), text: text.slice(0, 600), noteCreated: n.created, noteUpdated: n.updated } }; });
    const pick = await pickSheet("A note from Notes", items, "No notes yet. Write one in Notes.", "It goes on the board with its times; open it from the card.");
    if (pick) added(b, makeCard(b, pick.spec));
  }
  async function pickSpan(b) {
    const t = todayUk();
    const items = [["day", t, "Today"], ["day", addDays(t, 1), "Tomorrow"], ["week", spanStart("week", t), "This week"], ["week", spanStart("week", addDays(t, 7)), "Next week"], ["month", spanStart("month", t), "This month"], ["month", shiftSpan("month", spanStart("month", t), 1), "Next month"], ["year", spanStart("year", t), "This year"]]
      .map(([span, start, name]) => ({ icon: "calendar", title: name, text: calendarTitle({ span, start }), spec: { kind: "calendar", span, start } }));
    const pick = await pickSheet("The calendar", items, "", "A day, week, month or year, with what's on. Step it on from the card.");
    if (pick) added(b, makeCard(b, pick.spec));
  }
  async function pickAsked(b) {
    let messages = [];
    try { messages = (await N.api("/chat/history", { cache: "no-store" })).messages || []; } catch (err) { return toast("Agent's history is on the studio computer, which isn't answering just now.", true); }
    const pairs = [];
    messages.forEach((m, i) => {
      if (m.role !== "user" || typeof m.content !== "string" || !m.content.trim()) return;
      const reply = messages.slice(i + 1).find((x) => x.role === "assistant");
      pairs.push({ q: m.content.trim(), a: reply && typeof reply.content === "string" ? reply.content : "", at: m.at || m.time || "" });
    });
    const items = pairs.reverse().slice(0, 60).map((p) => ({ icon: "agent", title: p.q.slice(0, 120), text: p.a ? clip(plain(p.a), 90) : "No answer", spec: { kind: "agent", title: p.q.slice(0, 300), answer: p.a.slice(0, 40000), ...(p.at ? { asked: p.at } : {}) } }));
    const pick = await pickSheet("Something you asked Agent", items, "Nothing asked yet. Add an “Ask Agent” card to ask something.", "The question and Agent's answer, on a card.");
    if (pick) added(b, makeCard(b, pick.spec));
  }

  // ---- Agent: a question, and its answer on the card ----
  async function askAgent(b, c, question) {
    question = String(question || "").trim();
    if (!question) return;
    c.title = question.slice(0, 300);
    c.text = "";
    c.asking = true;
    c.asked = nowIso();
    if (showing()) N.show();
    let answer;
    try {
      const res = await fetch("/actions/chat", { method: "POST", credentials: "same-origin", headers: { ...HDR, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ message: question }) });
      const data = await res.json().catch(() => ({}));
      answer = data.ok ? data.reply : `Agent couldn't answer: ${data.message || data.error || (res.status === 503 ? "the studio computer is off" : `error ${res.status}`)}`;
    } catch (e) { answer = "Agent couldn't be reached just now. Try again in a moment."; }
    // (the board may have come again from the studio computer meanwhile: the card as it is now)
    const nb = (boards || []).find((x) => x.id === b.id);
    const nc = nb && nb.cards.find((x) => x.id === c.id);
    delete c.asking;
    if (!nc) return;
    Object.assign(nc, { title: c.title, text: "", asked: c.asked, answer: String(answer || "").slice(0, 40000), updated: nowIso() });
    delete nc.asking;
    if (nc.h < 300) nc.h = 320;
    await changed(nb);
    if (location.hash === href(nb, nc)) N.show();
  }
  // A few simple marks in Agent's answers (paragraphs, lists, **bold**, links), built safely (board.js:1157)
  function answerHtml(text) {
    const inline = (line) => {
      let out = "", last = 0;
      for (const m of line.matchAll(/(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?]))/g)) {
        out += esc(line.slice(last, m.index));
        out += m[2] ? `<strong>${esc(m[2])}</strong>` : `<a href="${esc(m[4] || m[5])}" target="_blank" rel="noopener noreferrer">${esc(m[3] || m[5])}</a>`;
        last = m.index + m[0].length;
      }
      return out + esc(line.slice(last));
    };
    return String(text || "").split(/\n{2,}/).map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>`).join("")}</ul>`;
      return `<p>${lines.map((l) => inline(l.replace(/^#+\s*/, ""))).join("<br>")}</p>`;
    }).join("");
  }

  // ---- The calendar: a day, week, month or year (board.js:1196) ----
  function spanStart(span, date) {
    const d = new Date(`${date}T12:00:00Z`);
    if (span === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    if (span === "month") d.setUTCDate(1);
    if (span === "year") d.setUTCMonth(0, 1);
    return d.toISOString().slice(0, 10);
  }
  function spanEnd(span, start) {
    const d = new Date(`${start}T12:00:00Z`);
    if (span === "day") return start;
    if (span === "week") return addDays(start, 6);
    if (span === "month") { d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); }
    d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  function shiftSpan(span, start, by) {
    const d = new Date(`${start}T12:00:00Z`);
    if (span === "day") return addDays(start, by);
    if (span === "week") return addDays(start, 7 * by);
    if (span === "month") d.setUTCMonth(d.getUTCMonth() + by, 1);
    else d.setUTCFullYear(d.getUTCFullYear() + by, 0, 1);
    return d.toISOString().slice(0, 10);
  }
  function calendarTitle(c) {
    const span = c.span || "week";
    const start = c.start || spanStart(span, todayUk());
    if (span === "day") return dayLabel(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (span === "month") return dayLabel(start, { month: "long", year: "numeric" });
    if (span === "year") return start.slice(0, 4);
    return `${dayLabel(start, { day: "numeric", month: "short" })} – ${dayLabel(spanEnd(span, start), { day: "numeric", month: "short", year: "numeric" })}`;
  }
  let calData = null, calAt = 0, recur = null;
  async function calendarData() {
    if (calData && Date.now() - calAt < 60000) return calData;
    try { calData = await N.api("/calendar-api/data", { cache: "no-store" }); calAt = Date.now(); } catch (err) { if (!calData) calData = { notes: [], days: [], offline: true }; }
    return calData;
  }
  async function calendarHtml(c) {
    const span = c.span || "week";
    const [data, R] = await Promise.all([calendarData(), recur || (recur = import(new URL("lib/recur.js", BASE).href))]);
    if (data.offline && !(data.notes || []).length) return `<p class="muted">The calendar's on the studio computer, which isn't answering just now.</p>`;
    const from = c.start, to = spanEnd(span, from);
    const byDay = new Map();
    const put = (d, ev) => { if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(ev); };
    for (const ev of data.notes || []) for (const o of R.occurrences(ev, from, to)) put(o.date, { time: ev.allDay ? "" : o.start.slice(11, 16), title: ev.title || "Untitled" });
    for (const d of data.days || []) { const date = d.date || (typeof d.start === "string" ? d.start.slice(0, 10) : ""); if (date && date >= from && date <= to) put(date, { time: "", title: d.title || d.text || "Day card" }); }
    for (const evs of byDay.values()) evs.sort((a, b) => a.time.localeCompare(b.time));
    const today = todayUk();
    if (span === "year") {
      return `<ul class="list">${Array.from({ length: 12 }, (_, m) => { const ms = `${from.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`; const n = [...byDay.entries()].filter(([d]) => d.startsWith(ms)).reduce((t, [, evs]) => t + evs.length, 0); return N.row({ lead: "", title: dayLabel(`${ms}-01`, { month: "long" }), end: esc(n ? plural(n, "thing") : "Nothing yet") }); }).join("")}</ul>`;
    }
    let html = "", shown = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const evs = byDay.get(d) || [];
      if (span === "month" && !evs.length) continue;
      shown++;
      html += `<h3 class="h${d === today ? " now" : ""}">${d === today ? "Today · " : ""}${esc(dayLabel(d))}</h3>${evs.length ? `<ul class="list">${evs.map((ev) => N.row({ lead: `<span class="board-time">${esc(ev.time || "all day")}</span>`, title: ev.title })).join("")}</ul>` : `<p class="muted board-free">Free</p>`}`;
    }
    return shown ? html : `<p class="muted">Nothing on the calendar this month.</p>`;
  }

  // ---- The bin: removed cards, the last 40 for 7 days, on this phone ----
  const binAll = () => keepGet(BIN, []).filter((r) => r && r.card && Date.now() - r.at < 7 * 864e5);
  const binFor = (b) => binAll().filter((r) => r.boardId === b.id);
  async function removeCard(b, c) {
    b.cards = b.cards.filter((x) => x.id !== c.id);
    const entry = { card: c, boardId: b.id, at: Date.now() };
    keepSet(BIN, [entry, ...binAll()].slice(0, 40));
    removedNow = { entry, until: Date.now() + 8000 };
    location.hash = href(b);
    await changed(b);
  }
  async function restore(entry) {
    keepSet(BIN, binAll().filter((r) => !(r.card.id === entry.card.id && r.at === entry.at)));
    const b = boards.find((x) => x.id === entry.boardId);
    if (!b) return toast("Its board isn't there any more.", true);
    if (!b.cards.some((x) => x.id === entry.card.id)) b.cards.push(entry.card);
    await changed(b);
    toast("Put back");
    N.show();
  }
  async function openBin(b) {
    const items = binFor(b).map((r) => ({ icon: "refresh", title: `${KIND_NAMES[r.card.kind] || "Card"}: ${cardTitle(r.card)}`, text: `Removed ${N.ago(r.at)} · Put back`, entry: r }));
    const pick = await pickSheet("Removed cards", items, "Nothing removed.", "Kept on this phone for 7 days. Tap one to put it back.");
    if (pick) restore(pick.entry);
  }

  // ---- A card ----
  function drawCard(box, bid, cid, ui) {
    const b = boards.find((x) => x.id === bid);
    const c = b?.cards.find((x) => x.id === cid);
    ui.back(b ? href(b) : "#board");
    if (!c) { box.innerHTML = empty({ icon: "board", title: "That card isn't there any more", action: b ? `<a class="btn" href="${href(b)}">Back to the board</a>` : "" }); return; }
    ui.title(kindName(c));
    pasteTo = null;
    const { order, info } = layout(b);
    const at = info.get(c.id);
    const swatches = c.kind === "sticky" ? `<div class="board-swatches" role="group" aria-label="Its colour">${Object.entries(STICKY).map(([k, hex]) => `<button type="button" class="board-swatch" data-colour="${k}" data-c="${hex}" aria-label="Make it ${k}" aria-pressed="${(c.colour || "amber") === k}"></button>`).join("")}</div>` : "";
    let body;
    if (c.kind === "sticky") body = `<div class="board-sticky pre" data-c="${STICKY[c.colour] || STICKY.amber}">${esc(c.text || "An empty sticky note")}</div>${swatches}<form class="card form" data-edit>${field({ label: "What it says", name: "text", type: "textarea", rows: 4, value: c.text || "", placeholder: "Write anything…" })}<button class="btn main wide" type="submit" hidden>${icon("check")} Save</button></form>`;
    else if (c.kind === "text" && c.hint) body = `<div class="card"><p class="pre">${esc(c.text || "")}</p><p class="muted small">A label on the table: it says what's around it.</p></div>`;
    else if (c.kind === "text") body = `<form class="card form" data-edit>${field({ label: "Text", name: "text", type: "textarea", rows: 5, value: c.text || "", placeholder: "Some text…" })}<button class="btn main wide" type="submit" hidden>${icon("check")} Save</button></form>`;
    else if (c.kind === "question") body = `<form class="card form" data-edit>${field({ label: "Question", name: "text", type: "textarea", rows: 2, value: c.text || "", placeholder: "What's the question?" })}${field({ label: "Answer", name: "answer", type: "textarea", rows: 4, value: c.answer || "", placeholder: "The answer, notes, next steps…" })}<button class="btn main wide" type="submit" hidden>${icon("check")} Save</button></form>`;
    else if (c.kind === "agent") {
      body = c.title && (c.answer || c.asking)
        ? `<div class="card"><p class="kicker">Asked Agent</p><h2 class="card-title">${esc(c.title)}</h2>${c.asking ? `<p class="muted board-thinking">Agent is thinking…</p>` : `<div class="prose board-answer">${answerHtml(c.answer)}</div><p class="muted small">${c.asked ? `Asked ${esc(when(c.asked))}` : ""}</p>`}</div>${c.asking ? "" : `<button type="button" class="btn wide" data-again-ask>${icon("chat")} Ask something else</button>`}`
        : `<form class="card form" data-ask>${field({ label: "Ask Agent", name: "q", type: "textarea", rows: 2, value: c.text || c.title || "", placeholder: "Ask Agent anything…" })}<button class="btn main wide" type="submit">${icon("send")} Ask</button><p class="muted small">The answer appears here, and in your Agent conversation.</p></form>`;
    } else if (c.kind === "note") body = `<div class="card"><p class="kicker">A note</p><h2 class="card-title">${esc(c.title || "Untitled note")}</h2>${c.text ? `<p class="pre">${esc(c.text)}</p>` : ""}<p class="muted small">${esc(noteTimes(c))}</p>${c.noteId ? `<a class="btn wide" href="#notes/${encodeURIComponent(c.noteId)}">${icon("notes")} Open in Notes</a>` : ""}</div>`;
    else if (c.kind === "calendar") {
      const view = c.span === "month" || c.span === "year" ? "month" : c.span === "day" ? "day" : "week";
      body = `<div class="card"><p class="kicker">Calendar · a ${esc(c.span || "week")}</p><div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="Previous ${esc(c.span || "week")}">${icon("back")}</button><b class="stepper-mid">${esc(calendarTitle(c))}</b><button type="button" class="icon-btn" data-step="1" aria-label="Next ${esc(c.span || "week")}">${icon("next")}</button></div></div><div class="board-cal" data-cal>${N.skeleton(2)}</div><a class="btn wide" href="#calendar/${view}/${esc(c.start || todayUk())}">${icon("calendar")} Open the calendar there</a>`;
    } else if (c.kind === "link") body = `<div class="card"><p class="kicker board-link">${favicon(c)}${esc(hostOf(c.url))}</p><h2 class="card-title">${esc(c.title || hostOf(c.url))}</h2>${c.text ? `<p class="muted">${esc(c.text)}</p>` : ""}<p class="small board-url">${esc(String(c.url || "").replace(/^https?:\/\/(www\.)?/, ""))}</p><a class="btn wide" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${icon("globe")} Open the link</a></div>`;
    else if (c.kind === "image") body = `<div class="card">${media("img", c)}<p class="muted small">${esc(c.title || c.fileName || "")}</p><a class="btn wide" href="${esc(fileUrl(c))}" target="_blank" rel="noopener">${icon("pdf")} Open it full size</a></div>`;
    else {
      const t = c.fileType || "";
      body = `<div class="card"><p class="kicker">${esc(kindName(c))}</p><h2 class="card-title">${esc(c.title || c.fileName || "A file")}</h2>${t.startsWith("video/") ? media("video", c) : t.startsWith("audio/") ? media("audio", c) : ""}<a class="btn wide" href="${esc(fileUrl(c))}" target="_blank" rel="noopener">${icon("pdf")} Open it</a></div>`;
    }
    // Where it sits on the table, and the taps that move it there
    const g = at.group.length > 1 ? `in a group of ${at.group.length}` : "on its own";
    const lies = at.under ? `under ${at.under === 1 ? "another card" : `${at.under} cards`}` : at.over ? `on top of ${at.over === 1 ? "another card" : `${at.over} cards`}` : "";
    const size = sizeOf(c) === "big" ? "Bigger than usual" : sizeOf(c) === "small" ? "Smaller than usual" : "The usual size";
    const i = order.indexOf(c);
    const prev = order.slice(0, i).reverse().find((x) => !x.pinned), next = order.slice(i + 1).find((x) => !x.pinned);
    const lock = c.pinned ? " disabled" : "";
    box.innerHTML = `${statusHtml()}${body}
      <section class="card board-where"><p class="kicker">Where it sits</p><p>Card ${at.n} of ${b.cards.length}, ${g}${lies ? `, ${lies}` : ""}. ${size}.</p>
        ${c.pinned ? `<p class="muted small">Pinned: it stays where it is. Unpin it to move it.</p>` : ""}
        <div class="btns two"><button type="button" class="btn" data-m="up"${lock || (prev ? "" : " disabled")}>Move up</button><button type="button" class="btn" data-m="down"${lock || (next ? "" : " disabled")}>Move down</button>
        <button type="button" class="btn" data-m="bigger"${lock || (c.w >= 1400 && c.h >= 1400 ? " disabled" : "")}>Bigger</button><button type="button" class="btn" data-m="smaller"${lock || (c.w <= 140 && c.h <= 90 ? " disabled" : "")}>Smaller</button>
        ${at.under ? `<button type="button" class="btn" data-m="front">Bring to front</button>` : ""}<button type="button" class="btn${c.pinned ? " main" : ""}" data-m="pin" aria-pressed="${!!c.pinned}">${c.pinned ? "Unpin (let it move)" : "Pin (keep it here)"}</button></div>
        <p class="muted small">Moves swap places with the card before or after; the computer's table changes the same way.</p></section>
      <button type="button" class="btn danger wide" data-m="remove">${icon("trash")} Remove this card</button>
      <p class="muted small">Added ${esc(when(c.created))}${c.updated && c.updated !== c.created ? ` · changed ${esc(when(c.updated))}` : ""}</p>`;
    wireMedia(box);
    // Typing: Save appears once something's changed
    const edit = box.querySelector("[data-edit]");
    if (edit) {
      const save = edit.querySelector("[type=submit]");
      edit.addEventListener("input", () => (save.hidden = false));
      edit.addEventListener("submit", async (e) => {
        e.preventDefault();
        const x = edit.elements;
        c.text = x.text.value.slice(0, 20000);
        if (x.answer) c.answer = x.answer.value.slice(0, 40000);
        c.updated = nowIso();
        edit.classList.remove("dirty");
        await changed(b);
        toast("Saved");
        N.show();
      });
    }
    box.querySelectorAll("[data-colour]").forEach((s) => s.addEventListener("click", async () => {
      const t = box.querySelector("[data-edit] textarea");
      if (t) c.text = t.value;
      c.colour = s.dataset.colour; c.updated = nowIso();
      await changed(b);
      N.show();
    }));
    box.querySelector("[data-ask]")?.addEventListener("submit", (e) => { e.preventDefault(); askAgent(b, c, e.target.elements.q.value); });
    box.querySelector("[data-again-ask]")?.addEventListener("click", async () => { c.title = ""; c.answer = ""; await changed(b); N.show(); });
    box.querySelectorAll("[data-step]").forEach((s) => s.addEventListener("click", async () => {
      c.start = shiftSpan(c.span || "week", c.start || spanStart(c.span || "week", todayUk()), Number(s.dataset.step));
      c.updated = nowIso();
      await changed(b);
      N.show();
    }));
    const cal = box.querySelector("[data-cal]");
    if (cal) { if (!c.start) c.start = spanStart(c.span || "week", todayUk()); calendarHtml(c).then((h) => { cal.innerHTML = h; }).catch((err) => { cal.innerHTML = `<p class="bad">${esc(err.message)}</p>`; }); }
    box.querySelectorAll("[data-m]").forEach((x) => x.addEventListener("click", () => arrange(b, c, x.dataset.m, prev, next)));
  }
  async function arrange(b, c, how, prev, next) {
    if (how === "remove") return removeCard(b, c);
    if (how === "pin") { c.pinned = !c.pinned; toast(c.pinned ? "Pinned: it stays where it is." : "Unpinned: it can move again."); }
    else if (how === "front") c.z = Math.max(0, ...b.cards.map((x) => x.z || 0)) + 1;
    else if (c.pinned) return toast("It's pinned: unpin it to move it.");
    else if (how === "up" || how === "down") {
      const o = how === "up" ? prev : next;
      if (!o) return;
      [c.x, c.y, o.x, o.y] = [o.x, o.y, c.x, c.y];
      o.updated = nowIso();
      toast(how === "up" ? "Moved up" : "Moved down");
    } else {
      const f = how === "bigger" ? 1.2 : 1 / 1.2;
      c.w = Math.round(Math.min(1400, Math.max(140, c.w * f)));
      c.h = Math.round(Math.min(1400, Math.max(90, c.h * f)));
    }
    c.updated = nowIso();
    await changed(b);
    N.show();
  }

  // (the card just added, lit for a moment and brought into view)
  new MutationObserver(() => {
    if (!fresh) return;
    const t = document.querySelector(`.board-tile[data-cid="${CSS.escape(fresh)}"]`);
    if (!t || !t.isConnected || !document.getElementById("page")?.contains(t)) return;
    fresh = "";
    t.classList.add("is-new");
    t.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => t.classList.remove("is-new"), 1600);
  }).observe(document.getElementById("page") || document.body, { childList: true });
})();
