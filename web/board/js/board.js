// Board: a table to lay things out on, moved around with the mouse (or a finger).
//
// Cards: a note from Notes (with its times), a day, week, month or year of the calendar, a
// question for Agent and its answer, a question card, a sticky note, some text, a link, or a
// picture or file dropped from the desktop or another tab. Drag a card to move it, its corner to
// size it; the pin keeps it where it is. Drag empty table to move around; the wheel (or a pinch)
// zooms. Everything is saved on the studio computer (src/board.ts), each person's own boards, and
// kept in this browser too, so it opens straight away and saves when the computer's back.

import { occurrences, addDays } from "/calendar/js/recur.js";

const $ = (id) => document.getElementById(id);
const HDR = { "X-Nova-Visualizer": "1" };
const CACHE = "nova-board-v1";
const BIN = "nova-board-bin-v1";
const CURRENT = "nova-board-current"; // the board that was open last (on this device)
const STILL = matchMedia("(prefers-reduced-motion: reduce)");
const UK = { timeZone: "Europe/London" };
const sfx = (name) => { try { window.NovaSfx && window.NovaSfx.play(name); } catch (err) {} };

const table = $("table");
const world = $("world");

// ===== State =====
let boards = []; // every board of theirs: { ...board, serverUpdated }
let current = null; // the board on the table
let removed = []; // the bin: { card, boardId, at }
const cardEls = new Map(); // card id -> element
let me = null;

const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (err) { return fallback; } };
const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) {} };
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const nowIso = () => new Date().toISOString();
const board = () => boards.find((b) => b.id === current);

// ===== Times, the British way =====
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { ...UK, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const todayUk = () => new Date().toLocaleDateString("en-CA", UK);
const dayLabel = (date, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

// ===== Saving =====
const saveTimers = new Map();
function cache() {
  keep(CURRENT, current);
  keep(CACHE, { current, boards: boards.map((b) => ({ ...b })), dirty: boards.filter((b) => b.dirty).map((b) => b.id) });
}
function changed(b = board(), soon = 700) {
  if (!b) return;
  b.dirty = true;
  b.updated = nowIso();
  cache();
  clearTimeout(saveTimers.get(b.id));
  saveTimers.set(b.id, setTimeout(() => push(b), soon));
}
let offline = false;
// One save at a time for each board: a change made while one is on its way goes up right after
const sending = new Set();
const again = new Set();
async function push(b) {
  if (!b || !b.dirty) return;
  if (sending.has(b.id)) {
    again.add(b.id);
    return;
  }
  sending.add(b.id);
  try {
    await pushNow(b);
  } finally {
    sending.delete(b.id);
    if (again.delete(b.id)) push(b);
  }
}
async function pushNow(b) {
  const snapshot = JSON.parse(JSON.stringify({ id: b.id, name: b.name, created: b.created, view: b.view, cards: b.cards }));
  let res;
  try {
    res = await fetch(`/board-api/boards/${b.id}`, { method: "PUT", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ board: snapshot, base: b.serverUpdated || undefined }) });
  } catch (err) {
    return away();
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 409 && data.board) {
    Object.assign(b, data.board, { serverUpdated: data.board.updated, dirty: false });
    cache();
    if (b.id === current) drawBoard();
    toast("This board changed somewhere else, so here's the newest.");
    return;
  }
  if (!res.ok || !data.ok) {
    if (res.status === 401) return status("Sign in with Portal to keep your boards.");
    return away();
  }
  // Saved: only clear the flag if nothing changed while it was on its way
  if (JSON.stringify({ name: b.name, view: b.view, cards: b.cards }) === JSON.stringify({ name: snapshot.name, view: snapshot.view, cards: snapshot.cards })) b.dirty = false;
  b.serverUpdated = data.board.updated;
  cache();
  if (offline) {
    offline = false;
    status("");
  }
}
function away() {
  offline = true;
  status("Saved on this device. It goes to the studio computer when that's back.");
  setTimeout(() => boards.filter((b) => b.dirty).forEach(push), 20000);
}
addEventListener("online", () => boards.filter((b) => b.dirty).forEach(push));
addEventListener("pagehide", () => boards.filter((b) => b.dirty).forEach(push));

let statusTimer = 0;
function status(text, ms = 0) {
  const el = $("status");
  el.textContent = text;
  el.hidden = !text;
  clearTimeout(statusTimer);
  if (text && ms) statusTimer = setTimeout(() => (el.hidden = true), ms);
}

// ===== Loading =====
async function start() {
  const saved = load(CACHE, null);
  if (saved && Array.isArray(saved.boards) && saved.boards.length) {
    boards = saved.boards;
    current = saved.current && boards.some((b) => b.id === saved.current) ? saved.current : boards[0].id;
    removed = load(BIN, []).filter((r) => Date.now() - r.at < 7 * 86400000);
    drawPicker();
    drawBoard();
  }
  try {
    const res = await fetch("/board-api/boards", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || String(res.status));
    me = data.me;
    const local = new Map(boards.map((b) => [b.id, b]));
    const fresh = data.boards.map((sb) => {
      const mine = local.get(sb.id);
      // Changed here since and not saved yet: keep ours (it goes up next)
      if (mine && mine.dirty) return { ...mine, serverUpdated: sb.updated };
      return { ...sb, serverUpdated: sb.updated };
    });
    // Boards made here while the computer was away
    for (const b of boards) if (b.dirty && !fresh.some((f) => f.id === b.id)) fresh.push(b);
    boards = fresh;
    const wanted = current || load(CURRENT, null);
    current = boards.some((b) => b.id === wanted) ? wanted : boards[0] && boards[0].id;
    // The Welcome board, the first time: opened, with everything in view
    const welcome = boards.find((b) => b.welcome);
    if (welcome && !load(WELCOME_SHOWN, []).includes(welcome.id)) {
      current = welcome.id;
      keep(WELCOME_SHOWN, [...load(WELCOME_SHOWN, []), welcome.id].slice(-20));
      requestAnimationFrame(() => requestAnimationFrame(fitAll));
    }
    cache();
    drawPicker();
    drawBoard();
    boards.filter((b) => b.dirty).forEach(push);
  } catch (err) {
    if (!boards.length) {
      const now = nowIso();
      boards = [{ id: rid(), name: "My board", created: now, updated: now, view: { x: 0, y: 0, zoom: 1 }, cards: [], dirty: true }];
      current = boards[0].id;
      drawPicker();
      drawBoard();
    }
    away();
  }
}

// ===== The board picker: switch, new, rename, delete =====
function drawPicker() {
  const pick = $("board-pick");
  pick.replaceChildren(...boards.map((b) => {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.name;
    return o;
  }));
  pick.value = current;
}
$("board-pick").addEventListener("change", (e) => {
  current = e.target.value;
  cache();
  drawBoard();
});
$("board-new").addEventListener("click", () => {
  const now = nowIso();
  const b = { id: rid(), name: `Board ${boards.length + 1}`, created: now, updated: now, view: { x: 0, y: 0, zoom: 1 }, cards: [] };
  boards.push(b);
  current = b.id;
  drawPicker();
  drawBoard();
  changed(b, 0);
  toast(`“${b.name}” is ready.`);
});
$("board-rename").addEventListener("click", () => {
  $("rename-form").hidden = false;
  $("rename-input").value = board().name;
  $("rename-input").focus();
  $("rename-input").select();
});
$("rename-cancel").addEventListener("click", () => ($("rename-form").hidden = true));
$("rename-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("rename-input").value.trim().slice(0, 80);
  if (name) {
    board().name = name;
    changed();
    drawPicker();
  }
  $("rename-form").hidden = true;
});
let deleteArmed = 0;
$("board-delete").addEventListener("click", async () => {
  const b = board();
  if (!b) return;
  if (Date.now() - deleteArmed > 4000) {
    deleteArmed = Date.now();
    toast(`Press delete again to delete “${b.name}” and its ${b.cards.length} card${b.cards.length === 1 ? "" : "s"}.`);
    return;
  }
  deleteArmed = 0;
  try {
    const res = await fetch(`/actions/board/${b.id}/remove`, { method: "POST", headers: HDR });
    if (!res.ok && res.status !== 404) throw new Error(String(res.status));
  } catch (err) {
    return toast("Couldn't delete it just now: the studio computer didn't answer.");
  }
  sfx("remove");
  boards = boards.filter((x) => x.id !== b.id);
  if (!boards.length) {
    const now = nowIso();
    boards.push({ id: rid(), name: "My board", created: now, updated: now, view: { x: 0, y: 0, zoom: 1 }, cards: [] });
    changed(boards[0], 0);
  }
  current = boards[0].id;
  cache();
  drawPicker();
  drawBoard();
  toast(`“${b.name}” deleted.`);
});

// ===== The view: moving around and zooming =====
function view() {
  return board().view;
}
// (16 Oct 2026, speed: the grid is its own layer that slides; its size and the zoom's label are only
// written when the zoom changes, so moving around restyles nothing)
let gridLayer = null, gridSize = "", zoomWords = "";
function applyView() {
  const v = view();
  world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
  const grid = 40 * v.zoom;
  if (!gridLayer || !gridLayer.isConnected) {
    gridLayer = document.createElement("div");
    gridLayer.className = "grid-layer";
    gridLayer.setAttribute("aria-hidden", "true");
    table.prepend(gridLayer);
  }
  if (gridSize !== `${grid}px`) { gridSize = `${grid}px`; table.style.setProperty("--grid", gridSize); }
  gridLayer.style.transform = `translate3d(${v.x % grid}px, ${v.y % grid}px, 0)`;
  const words = `${Math.round(v.zoom * 100)}%`;
  if (zoomWords !== words) { zoomWords = words; $("zoom-reset").textContent = words; }
}
const toWorld = (sx, sy) => {
  const r = table.getBoundingClientRect();
  const v = view();
  return { x: (sx - r.left - v.x) / v.zoom, y: (sy - r.top - v.y) / v.zoom };
};
function zoomAt(factor, sx, sy) {
  const v = view();
  const r = table.getBoundingClientRect();
  const px = sx === undefined ? r.width / 2 : sx - r.left;
  const py = sy === undefined ? r.height / 2 : sy - r.top;
  const z = Math.min(3, Math.max(0.2, v.zoom * factor));
  v.x = px - ((px - v.x) * z) / v.zoom;
  v.y = py - ((py - v.y) * z) / v.zoom;
  v.zoom = z;
  applyView();
  changed(board(), 1500);
}
function middle() {
  const r = table.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
$("zoom-in").addEventListener("click", () => zoomAt(1.2));
$("zoom-out").addEventListener("click", () => zoomAt(1 / 1.2));
$("zoom-reset").addEventListener("click", () => {
  const v = view();
  const r = table.getBoundingClientRect();
  Object.assign(v, { zoom: 1, x: r.width / 2, y: r.height / 2 });
  applyView();
  changed(board(), 1500);
});
$("zoom-fit").addEventListener("click", fitAll);
function fitAll() {
  const cards = board().cards;
  if (!cards.length) return $("zoom-reset").click();
  const r = table.getBoundingClientRect();
  // (the Welcome board's banner covers the bottom of the table: everything goes above it)
  const bar = $("welcome-bar");
  const below = bar && !bar.hidden ? bar.offsetHeight + 24 : 0;
  const h = r.height - below;
  const minX = Math.min(...cards.map((c) => c.x)), minY = Math.min(...cards.map((c) => c.y));
  const maxX = Math.max(...cards.map((c) => c.x + c.w)), maxY = Math.max(...cards.map((c) => c.y + c.h));
  const z = Math.min(1.5, Math.max(0.2, Math.min((r.width - 60) / (maxX - minX || 1), (h - 60) / (maxY - minY || 1))));
  const v = view();
  Object.assign(v, { zoom: z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (h - (maxY - minY) * z) / 2 - minY * z });
  applyView();
  changed(board(), 1500);
}

// Panning with the mouse or a finger on empty table; two fingers pinch to zoom
const touches = new Map();
let pan = null;
let pinch = null;
table.addEventListener("pointerdown", (e) => {
  if (e.target !== table && e.target !== world && !e.target.classList.contains("empty")) return;
  if (e.button !== 0 && e.pointerType === "mouse") return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  table.setPointerCapture(e.pointerId);
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    pan = null;
    return;
  }
  const v = view();
  pan = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y };
  table.classList.add("panning");
  closeMenus();
});
table.addEventListener("pointermove", (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAt(d / pinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinch.d = d;
    return;
  }
  if (!pan) return;
  const v = view();
  v.x = pan.x + (e.clientX - pan.sx);
  v.y = pan.y + (e.clientY - pan.sy);
  applyView();
});
const endPan = (e) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (pan && !touches.size) {
    pan = null;
    table.classList.remove("panning");
    changed(board(), 1500);
  }
};
table.addEventListener("pointerup", endPan);
table.addEventListener("pointercancel", endPan);
table.addEventListener("wheel", (e) => {
  // A card's own scrolling text scrolls itself (unless zooming with Ctrl or a pinch)
  const body = e.target.closest && e.target.closest(".card-body, textarea, .pick-list");
  if (body && !e.ctrlKey && body.scrollHeight > body.clientHeight + 1) return;
  e.preventDefault();
  if (e.shiftKey && !e.ctrlKey) {
    const v = view();
    v.x -= e.deltaY || e.deltaX;
    applyView();
    changed(board(), 1500);
    return;
  }
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(Math.exp(-dy * 0.0015), e.clientX, e.clientY);
}, { passive: false });
table.addEventListener("keydown", (e) => {
  if (e.target !== table) return;
  const v = view();
  const step = e.shiftKey ? 240 : 60;
  const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) {
    e.preventDefault();
    v.x += moves[e.key][0];
    v.y += moves[e.key][1];
    applyView();
    changed(board(), 1500);
  } else if (e.key === "+" || e.key === "=") zoomAt(1.2);
  else if (e.key === "-") zoomAt(1 / 1.2);
  else if (e.key === "0") $("zoom-reset").click();
});

// ===== Drawing the board =====
function drawBoard() {
  const b = board();
  if (!b) return;
  if (!b.view || !Number.isFinite(b.view.zoom)) b.view = { x: 0, y: 0, zoom: 1 };
  // A board that has never been looked at starts with its middle in the middle
  if (b.view.x === 0 && b.view.y === 0 && !b.cards.length) {
    const r = table.getBoundingClientRect();
    b.view.x = r.width / 2;
    b.view.y = r.height / 2;
  }
  world.replaceChildren();
  cardEls.clear();
  // A question that was still being asked when the page closed: ask again from the card
  for (const c of b.cards) if (c.asking) delete c.asking;
  for (const c of b.cards) world.append(buildCard(c));
  applyView();
  refreshEmpty();
  drawBin();
}
function refreshEmpty() {
  $("empty").hidden = board().cards.length > 0;
  $("welcome-bar").hidden = !board().welcome;
}

// ===== The Welcome board: what to do with it (once) =====
const WELCOME_SHOWN = "board-welcome-shown";
function welcomeDone(b, said) {
  delete b.welcome;
  b.updated = nowIso();
  changed(b, 0);
  $("welcome-bar").hidden = true;
  toast(said);
}
$("welcome-clear").addEventListener("click", () => {
  const b = board();
  b.cards = [];
  b.name = "My board";
  drawPicker();
  drawBoard();
  welcomeDone(b, "All clear: the table is yours.");
});
$("welcome-new").addEventListener("click", () => {
  const b = board();
  welcomeDone(b, "“Welcome” is kept in your boards.");
  $("board-new").click();
});
$("welcome-keep").addEventListener("click", () => welcomeDone(board(), "Kept as it is. Add your own cards any time with +."));

const KIND_NAMES = { note: "Note", calendar: "Calendar", agent: "Agent", question: "Question", sticky: "Sticky note", text: "Text", link: "Link", image: "Picture", file: "File" };
const ICON = {
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
function iconButton(svg, label, cls = "card-btn") {
  const b = el("button", cls);
  b.type = "button";
  b.innerHTML = svg; // (our own fixed icons only)
  b.setAttribute("aria-label", label);
  b.title = label;
  return b;
}
function place(c, node = cardEls.get(c.id)) {
  if (!node) return;
  node.style.left = `${c.x}px`;
  node.style.top = `${c.y}px`;
  node.style.width = `${c.w}px`;
  node.style.height = `${c.h}px`;
  node.style.zIndex = String(c.z || 1);
  node.style.rotate = STILL.matches ? "0deg" : `${c.turn || 0}deg`;
  node.classList.toggle("pinned", Boolean(c.pinned));
}
function front(c) {
  const top = Math.max(0, ...board().cards.map((x) => x.z || 0));
  if ((c.z || 0) < top) {
    c.z = top + 1;
    place(c);
  }
}
// A file card says what it is: a video, a sound, a PDF…
function kindName(c) {
  const t = c.fileType || "";
  if (c.kind === "file") return t.startsWith("video/") ? "Video" : t.startsWith("audio/") ? "Sound" : t === "application/pdf" ? "PDF" : "File";
  if (c.kind === "text" && c.hint) return "Label";
  return KIND_NAMES[c.kind];
}
function cardTitle(c) {
  if (c.kind === "calendar") return calendarTitle(c);
  return (c.title || c.text || c.fileName || c.url || KIND_NAMES[c.kind]).split("\n")[0].slice(0, 80);
}

function buildCard(c) {
  const node = el("div", `card k-${c.kind}${c.kind === "sticky" ? ` c-${c.colour || "amber"}` : ""}`);
  node.tabIndex = 0;
  node.dataset.id = c.id;
  node.setAttribute("data-fit-free", ""); // (it may lie anywhere on the table: scripts/check-fit.mjs)
  node.setAttribute("role", "group");
  node.setAttribute("aria-label", `${kindName(c)}: ${cardTitle(c)}. Arrow keys move it, P pins it, Delete removes it.`);
  const head = el("div", "card-head");
  const kind = el("span", "card-kind", kindName(c));
  const pinB = iconButton(ICON.pin, c.pinned ? "Unpin (let it move)" : "Pin (keep it here)", "card-btn pin-btn");
  pinB.setAttribute("aria-pressed", String(Boolean(c.pinned)));
  pinB.addEventListener("click", () => togglePin(c));
  const closeB = iconButton(ICON.close, "Remove this card");
  closeB.dataset.sfx = "remove";
  closeB.addEventListener("click", () => removeCard(c));
  head.append(kind);
  if (c.kind === "note" && c.noteId) {
    const openB = iconButton(ICON.open, "Open in Notes");
    openB.addEventListener("click", () => openNote(c.noteId));
    head.append(openB);
  }
  if (c.kind === "link" && c.url) {
    const openB = iconButton(ICON.open, "Open the link");
    openB.addEventListener("click", () => window.open(c.url, "_blank", "noopener"));
    head.append(openB);
  }
  head.append(pinB, closeB);
  const body = el("div", "card-body");
  fillBody(c, body);
  const mark = el("span", "pin-mark");
  mark.setAttribute("aria-hidden", "true");
  const handle = el("span", "resize");
  handle.setAttribute("aria-hidden", "true");
  node.append(mark, head, body, handle);
  cardEls.set(c.id, node);
  place(c, node);
  wireCard(c, node, handle);
  return node;
}
function redraw(c) {
  const old = cardEls.get(c.id);
  if (!old) return;
  const had = document.activeElement === old;
  const fresh = buildCard(c);
  old.replaceWith(fresh);
  if (had) fresh.focus({ preventScroll: true });
}

// Text boxes: typing saves (a moment after the last key)
function box(c, field, placeholder, cls = "grow") {
  const t = el("textarea", cls);
  t.value = c[field] || "";
  t.placeholder = placeholder;
  t.setAttribute("aria-label", placeholder);
  t.addEventListener("input", () => {
    c[field] = t.value;
    c.updated = nowIso();
    changed();
  });
  return t;
}

function fillBody(c, body) {
  if (c.kind === "question") {
    const f = el("div", "fill");
    f.append(el("span", "lbl", "Question"), box(c, "text", "What's the question?", ""), el("span", "lbl", "Answer"), box(c, "answer", "The answer, notes, next steps…"));
    f.children[1].rows = 2;
    body.append(f);
  } else if (c.kind === "sticky") {
    const sw = el("div", "swatches");
    for (const colour of ["rose", "amber", "lime", "teal", "violet", "sky"]) {
      const b = el("button");
      b.type = "button";
      b.className = "";
      b.style.background = { rose: "#ff8fbd", amber: "#ffc94a", lime: "#a8e05f", teal: "#5fd8bd", violet: "#b994ff", sky: "#7cc4ff" }[colour];
      b.setAttribute("aria-label", `Make it ${colour}`);
      b.addEventListener("click", () => {
        c.colour = colour;
        changed();
        redraw(c);
      });
      sw.append(b);
    }
    const f = el("div", "fill");
    f.append(sw, box(c, "text", "Write anything…"));
    body.append(f);
  } else if (c.kind === "text" && c.hint) {
    body.append(el("p", "hint-text", c.text || ""));
  } else if (c.kind === "text") {
    const f = el("div", "fill");
    f.append(box(c, "text", "Some text…"));
    body.append(f);
  } else if (c.kind === "note") {
    body.append(el("p", "card-title", c.title || "Untitled note"));
    if (c.text) body.append(el("p", "snippet", c.text));
    const t = el("div", "card-time");
    t.textContent = [c.noteCreated && `Made ${when(c.noteCreated)}`, c.noteUpdated && `Changed ${when(c.noteUpdated)}`].filter(Boolean).join(" · ");
    body.append(t);
  } else if (c.kind === "agent") {
    agentBody(c, body);
  } else if (c.kind === "calendar") {
    calendarBody(c, body);
  } else if (c.kind === "link") {
    const row = el("div", "link-row");
    const icon = el("img", "favicon");
    icon.alt = "";
    icon.referrerPolicy = "no-referrer";
    try {
      icon.src = c.fileName && /^https?:/.test(c.fileName) ? c.fileName : new URL(c.url).origin + "/favicon.ico";
    } catch (err) {}
    icon.addEventListener("error", () => (icon.style.visibility = "hidden"));
    const words = el("div");
    words.append(el("p", "card-title", c.title || hostOf(c.url)));
    if (c.text) words.append(el("p", "", c.text));
    const a = el("a", "link-url", hostOf(c.url));
    a.href = c.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    words.append(el("span", "site"), a);
    row.append(icon, words);
    body.append(row);
  } else if (c.kind === "image") {
    body.append(media("img", c, (img) => {
      img.alt = c.fileName || "A picture";
      img.draggable = false;
      img.decoding = "async";
    }));
  } else if (c.kind === "file") {
    const type = c.fileType || "";
    if (type.startsWith("video/")) {
      // A video plays right on the card (the Welcome board's loops quietly by itself)
      body.append(media("video", c, (v) => {
        v.controls = true;
        v.playsInline = true;
        v.preload = "metadata";
        if (c.asset) Object.assign(v, { muted: true, loop: true, autoplay: true });
      }));
      return;
    }
    const row = el("div", "file-row");
    const ext = (c.fileName || "").split(".").pop() || "file";
    row.append(el("span", "file-ico", type.startsWith("audio/") ? "♪" : ext.slice(0, 4)));
    const words = el("div");
    words.append(el("p", "card-title", c.title || c.fileName || "A file"));
    const a = el("a", "link-url", "Open");
    a.href = fileUrl(c);
    a.target = "_blank";
    a.rel = "noopener";
    words.append(a);
    row.append(words);
    body.append(row);
    if (type.startsWith("audio/")) body.append(media("audio", c, (au) => {
      au.controls = true;
      au.preload = "metadata";
    }));
  }
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (err) { return url || ""; } };

// Where a card's picture, video or sound comes from: Board's own (the Welcome board's) or one
// dropped on a board (kept on the studio computer, and online from its copy in Google Drive)
const fileUrl = (c) => c.asset || `/board-files/${c.fileId}`;
// A picture, video or sound: a calm shimmer until it's there; if it doesn't come, a "Try again"
// (never an empty box). Big files online can take a moment the first time.
function media(tag, c, setup) {
  const box = el("div", `media media-${tag} is-loading`);
  const m = el(tag);
  const wait = el("span", "media-wait", tag === "img" ? "Bringing the picture…" : "Getting it ready…");
  const retry = el("button", "media-retry", "Couldn't load it · Try again");
  retry.type = "button";
  const ok = () => box.classList.remove("is-loading", "is-failed");
  const fail = () => {
    box.classList.remove("is-loading");
    box.classList.add("is-failed");
  };
  m.addEventListener(tag === "img" ? "load" : "loadedmetadata", ok);
  m.addEventListener("error", fail);
  retry.addEventListener("click", (e) => {
    e.stopPropagation();
    box.classList.remove("is-failed");
    box.classList.add("is-loading");
    m.src = `${fileUrl(c)}${fileUrl(c).includes("?") ? "&" : "?"}again=${Date.now()}`;
    if (tag !== "img") m.load();
  });
  setup(m);
  m.src = fileUrl(c);
  // (already there, from the browser's copy)
  if (tag === "img" && m.complete && m.naturalWidth) ok();
  box.append(m, wait, retry);
  return box;
}

// ===== Moving, sizing, pinning and removing cards =====
const INTERACTIVE = "textarea, input, select, button, a, audio, video, .resize, .answer";
function wireCard(c, node, handle) {
  let drag = null;
  node.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    front(c);
    if (e.target.closest(INTERACTIVE) || c.pinned) return;
    e.preventDefault();
    node.focus({ preventScroll: true });
    drag = { sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, moved: false };
    node.setPointerCapture(e.pointerId);
    node.classList.add("lifted");
  });
  node.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const z = view().zoom;
    c.x = Math.round(drag.x + (e.clientX - drag.sx) / z);
    c.y = Math.round(drag.y + (e.clientY - drag.sy) / z);
    drag.moved = true;
    place(c, node);
  });
  const drop = () => {
    if (!drag) return;
    node.classList.remove("lifted");
    if (drag.moved) {
      c.updated = nowIso();
      changed();
    } else changed(board(), 1500); // brought to the front
    drag = null;
  };
  node.addEventListener("pointerup", drop);
  node.addEventListener("pointercancel", drop);
  // The corner: its size
  let size = null;
  handle.addEventListener("pointerdown", (e) => {
    if (c.pinned) return;
    e.preventDefault();
    e.stopPropagation();
    size = { sx: e.clientX, sy: e.clientY, w: c.w, h: c.h };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!size) return;
    const z = view().zoom;
    c.w = Math.round(Math.min(1400, Math.max(140, size.w + (e.clientX - size.sx) / z)));
    c.h = Math.round(Math.min(1400, Math.max(90, size.h + (e.clientY - size.sy) / z)));
    place(c, node);
  });
  const sized = () => {
    if (!size) return;
    size = null;
    changed();
  };
  handle.addEventListener("pointerup", sized);
  handle.addEventListener("pointercancel", sized);
  // Double-click a note: open it in Notes
  if (c.kind === "note" && c.noteId) node.addEventListener("dblclick", (e) => !e.target.closest(INTERACTIVE) && openNote(c.noteId));
  // The keyboard: arrows move it, P pins it, Delete removes it
  node.addEventListener("keydown", (e) => {
    if (e.target !== node) return;
    const step = e.shiftKey ? 50 : 10;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      if (c.pinned) return toast("It's pinned: unpin it to move it.");
      c.x += moves[e.key][0];
      c.y += moves[e.key][1];
      place(c, node);
      changed();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      togglePin(c);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeCard(c);
    } else if (e.key === "Enter") {
      const field = node.querySelector("textarea, input");
      if (field) {
        e.preventDefault();
        field.focus();
      }
    }
  });
}
function togglePin(c) {
  c.pinned = !c.pinned;
  c.updated = nowIso();
  sfx(c.pinned ? "on" : "off");
  changed();
  redraw(c);
  toast(c.pinned ? "Pinned: it stays where it is." : "Unpinned: it can move again.");
}
function removeCard(c) {
  const b = board();
  b.cards = b.cards.filter((x) => x.id !== c.id);
  const node = cardEls.get(c.id);
  if (node) node.remove();
  cardEls.delete(c.id);
  removed.unshift({ card: c, boardId: b.id, at: Date.now() });
  removed = removed.slice(0, 40);
  keep(BIN, removed);
  changed();
  refreshEmpty();
  drawBin();
  sfx("remove");
  toast("Card removed.", () => restore(removed.find((r) => r.card.id === c.id)));
  table.focus({ preventScroll: true });
}
function restore(entry) {
  if (!entry) return;
  removed = removed.filter((r) => r !== entry);
  keep(BIN, removed);
  const b = boards.find((x) => x.id === entry.boardId) || board();
  if (!b.cards.some((x) => x.id === entry.card.id)) b.cards.push(entry.card);
  changed(b);
  if (b.id === current) {
    world.append(buildCard(entry.card));
    refreshEmpty();
  }
  drawBin();
}

// ===== Adding cards =====
// Round and round from the middle, a little further each time, until a card that size fits
function freeSpot(b, centre, w, h) {
  const gap = 18;
  const clear = (x, y) => !b.cards.some((c) => x < c.x + c.w + gap && x + w + gap > c.x && y < c.y + c.h + gap && y + h + gap > c.y);
  const x0 = centre.x - w / 2;
  const y0 = centre.y - h / 2;
  if (clear(x0, y0)) return { x: x0, y: y0 };
  for (let ring = 1; ring < 40; ring++) {
    const r = ring * 60;
    const steps = 8 + ring * 4;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = x0 + Math.cos(a) * r * 1.4;
      const y = y0 + Math.sin(a) * r;
      if (clear(x, y)) return { x, y };
    }
  }
  return { x: x0, y: y0 };
}
function addCard(spec, at) {
  const b = board();
  const centre = at || middle();
  const size = { note: [280, 190], calendar: [320, 300], agent: [340, 260], question: [300, 230], sticky: [220, 200], text: [280, 160], link: [320, 140], image: [320, 240], file: [280, 150] }[spec.kind] || [260, 180];
  // Dropped somewhere: there. Added from a menu: the free spot nearest the middle, so new cards
  // never land on top of others
  const spot = at ? { x: centre.x - size[0] / 2, y: centre.y - size[1] / 2 } : freeSpot(b, centre, size[0], size[1]);
  const now = nowIso();
  const c = {
    id: rid(),
    w: size[0],
    h: size[1],
    turn: STILL.matches ? 0 : Math.round((Math.random() * 3 - 1.5) * 10) / 10,
    pinned: false,
    created: now,
    updated: now,
    ...spec,
    x: Math.round(spot.x),
    y: Math.round(spot.y),
    z: Math.max(0, ...b.cards.map((x) => x.z || 0)) + 1,
  };
  b.cards.push(c);
  const node = buildCard(c);
  world.append(node);
  refreshEmpty();
  changed(b, 300);
  sfx("pick");
  node.focus({ preventScroll: true });
  return c;
}

// The Add menu
const addBtn = $("add");
const addMenu = $("add-menu");
function closeMenus() {
  addMenu.hidden = true;
  addBtn.setAttribute("aria-expanded", "false");
}
addBtn.addEventListener("click", () => {
  const open = addMenu.hidden;
  addMenu.hidden = !open;
  addBtn.setAttribute("aria-expanded", String(open));
  if (open) addMenu.querySelector("button").focus();
});
addMenu.addEventListener("keydown", (e) => {
  const items = [...addMenu.querySelectorAll("button")];
  const at = items.indexOf(document.activeElement);
  if (e.key === "Escape") {
    closeMenus();
    addBtn.focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".add-wrap")) closeMenus();
});
addMenu.addEventListener("click", (e) => {
  const b = e.target.closest("[data-add]");
  if (!b) return;
  closeMenus();
  const kind = b.dataset.add;
  if (kind === "calendar") return addCard({ kind, span: b.dataset.span, start: spanStart(b.dataset.span, todayUk()) });
  if (kind === "link") return askFor("Paste or type a link", "https://…", (v) => addLink(v));
  if (kind === "file") return $("file-input").click();
  if (kind === "sticky") return addCard({ kind, colour: ["amber", "rose", "lime", "teal", "violet", "sky"][Math.floor(Math.random() * 6)] });
  addCard({ kind });
});
$("file-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  files.forEach((f, i) => upload(f, offsetPoint(middle(), i)));
});
const offsetPoint = (p, i) => ({ x: p.x + i * 30, y: p.y + i * 30 });

// A small box in the middle for a link (no browser pop-ups)
function askFor(label, placeholder, then) {
  document.querySelector(".ask-box")?.remove();
  const f = el("form", "ask-box");
  const l = el("label", "", label);
  const input = el("input");
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  const row = el("div", "row");
  const ok = el("button", "chip", "Add");
  ok.type = "submit";
  const cancel = el("button", "chip", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => f.remove());
  row.append(cancel, ok);
  f.append(l, input, row);
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value.trim();
    f.remove();
    if (v) then(v);
  });
  f.addEventListener("keydown", (e) => e.key === "Escape" && f.remove());
  $("app").append(f);
  input.focus();
}

// ===== Links, text, pictures and files from outside =====
const looksLikeUrl = (t) => /^https?:\/\/\S+$/i.test(t.trim());
async function addLink(url, at) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  const c = addCard({ kind: "link", url, title: hostOf(url) }, at);
  try {
    const res = await fetch(`/board-api/link?url=${encodeURIComponent(url)}`, { headers: HDR });
    const data = await res.json();
    if (data.ok && data.link) {
      c.title = data.link.title || c.title;
      c.text = data.link.description || "";
      c.fileName = data.link.icon || ""; // (the link's little icon)
      c.url = data.link.url || url;
      changed();
      redraw(c);
    }
  } catch (err) {}
}
const EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
// How big a file may be here: 500 MB on the studio computer itself, 95 MB online (asked once)
let limits = { maxBytes: 95 * 1024 * 1024, max: "95 MB" };
fetch("/board-api/limits", { cache: "no-store" }).then((r) => r.json()).then((d) => d && d.maxBytes && (limits = d)).catch(() => {});
async function upload(file, at) {
  const type = (file.type || EXT_TYPES[(file.name.split(".").pop() || "").toLowerCase()] || "").toLowerCase();
  if (!type || !Object.values(EXT_TYPES).includes(type)) return toast(`“${file.name}” can't go on a board (pictures, PDFs, text, audio and video can).`);
  if (file.size > limits.maxBytes) return toast(`“${file.name}” is too big (${limits.max} at most${limits.here ? "" : " online; up to 500 MB on the studio computer itself"}).`);
  status(`Putting “${file.name}” on the table…`);
  let data;
  try {
    data = await new Promise((resolve, reject) => {
      // (with a progress line, since a big video takes a while)
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/actions/board-files?name=${encodeURIComponent(file.name.slice(0, 200))}`);
      xhr.setRequestHeader("X-Nova-Visualizer", "1");
      xhr.setRequestHeader("Content-Type", type);
      xhr.upload.onprogress = (e) => e.lengthComputable && file.size > 2e6 && status(`Putting “${file.name}” on the table… ${Math.round((e.loaded / e.total) * 100)}%`);
      xhr.onload = () => {
        let d = {};
        try { d = JSON.parse(xhr.responseText); } catch (err) {}
        if (xhr.status >= 200 && xhr.status < 300 && d.ok) resolve(d);
        else reject(new Error(d.message || d.error || (xhr.status === 503 ? "The studio computer is off, so files can't be kept just now." : `Error ${xhr.status}`)));
      };
      xhr.onerror = () => reject(new Error("the connection dropped"));
      xhr.send(file);
    });
  } catch (err) {
    status("");
    return toast(`Couldn't keep “${file.name}”: ${err.message}`);
  }
  status("");
  addCard({ kind: type.startsWith("image/") ? "image" : "file", fileId: data.file.id, fileType: type, fileName: file.name.slice(0, 200), title: file.name.slice(0, 200) }, at);
}

// Dropping on the table
let dragDepth = 0;
const accepts = (dt) => dt && [...dt.types].some((t) => ["Files", "text/uri-list", "text/plain", "application/x-nova-board"].includes(t));
table.addEventListener("dragenter", (e) => {
  if (!accepts(e.dataTransfer)) return;
  e.preventDefault();
  dragDepth++;
  table.classList.add("dropping");
  $("drop-hint").hidden = false;
});
table.addEventListener("dragover", (e) => {
  if (!accepts(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
const dragDone = () => {
  dragDepth = 0;
  table.classList.remove("dropping");
  $("drop-hint").hidden = true;
};
table.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) dragDone();
});
table.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDone();
  const at = toWorld(e.clientX, e.clientY);
  const dt = e.dataTransfer;
  const ours = dt.getData("application/x-nova-board");
  if (ours) {
    try {
      return addCard(JSON.parse(ours), at);
    } catch (err) {
      return;
    }
  }
  if (dt.files && dt.files.length) return [...dt.files].forEach((f, i) => upload(f, offsetPoint(at, i)));
  const uri = (dt.getData("text/uri-list") || "").split("\n").find((l) => l && !l.startsWith("#"));
  if (uri && looksLikeUrl(uri)) return addLink(uri, at);
  const text = dt.getData("text/plain");
  if (text && looksLikeUrl(text)) return addLink(text, at);
  if (text && text.trim()) addCard({ kind: "text", text: text.slice(0, 20000) }, at);
});
// Pasting (not into a text box): a picture, a link or text becomes a card
document.addEventListener("paste", (e) => {
  if (e.target.closest && e.target.closest("textarea, input")) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const files = [...dt.files];
  if (files.length) {
    e.preventDefault();
    return files.forEach((f, i) => upload(f.name ? f : new File([f], `pasted.${(f.type.split("/")[1] || "png")}`, { type: f.type }), offsetPoint(middle(), i)));
  }
  const text = dt.getData("text/plain");
  if (!text || !text.trim()) return;
  e.preventDefault();
  if (looksLikeUrl(text)) addLink(text);
  else addCard({ kind: "text", text: text.slice(0, 20000) });
});

// ===== Agent: a question, and its answer on the card =====
function agentBody(c, body) {
  const f = el("div", "fill");
  if (c.title && (c.answer || c.asking)) {
    f.append(el("p", "card-title", c.title));
    const ans = el("div", "answer");
    if (c.asking) ans.append(el("p", "thinking", "Agent is thinking…"));
    else renderAnswer(c.answer || "", ans);
    f.append(ans);
    const t = el("div", "card-time", c.asked ? `Asked ${when(c.asked)}` : "");
    const again = el("button", "chip", "Ask something else");
    again.type = "button";
    again.style.alignSelf = "flex-start";
    again.addEventListener("click", () => {
      c.title = "";
      c.answer = "";
      changed();
      redraw(c);
    });
    if (!c.asking) f.append(t, again);
  } else {
    f.append(el("span", "lbl", "Ask Agent"));
    const row = el("div", "ask-row");
    const q = box(c, "text", "Ask Agent anything…", "");
    q.rows = 2;
    const go = el("button", "ask-btn", "Ask");
    go.type = "button";
    go.dataset.sfx = "send";
    const ask = () => askAgent(c, q.value);
    go.addEventListener("click", ask);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ask();
      }
    });
    row.append(q, go);
    f.append(row, el("p", "card-time", "The answer appears here, and in your Agent conversation."));
  }
  body.append(f);
}
async function askAgent(c, question) {
  question = (question || "").trim();
  if (!question) return;
  c.title = question.slice(0, 300);
  c.text = "";
  c.asking = true;
  c.asked = nowIso();
  redraw(c);
  let answer;
  try {
    const res = await fetch("/actions/chat", { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify({ message: question }) });
    const data = await res.json().catch(() => ({}));
    answer = data.ok ? data.reply : `Agent couldn't answer: ${data.message || data.error || (res.status === 503 ? "the studio computer is off" : `error ${res.status}`)}`;
  } catch (err) {
    answer = "Agent couldn't be reached just now. Try again in a moment.";
  }
  delete c.asking;
  c.answer = String(answer || "").slice(0, 40000);
  c.updated = nowIso();
  if (c.h < 300) c.h = 320;
  changed();
  redraw(c);
}
// A few simple marks in Agent's answers (paragraphs, lists, **bold**, links), built safely
function renderAnswer(text, into) {
  const inline = (line, parent) => {
    const re = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?]))/g;
    let last = 0;
    for (const m of line.matchAll(re)) {
      parent.append(line.slice(last, m.index));
      if (m[2]) parent.append(el("strong", "", m[2]));
      else {
        const a = el("a", "", m[3] || m[5]);
        a.href = m[4] || m[5];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        parent.append(a);
      }
      last = m.index + m[0].length;
    }
    parent.append(line.slice(last));
  };
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
      const ul = el("ul");
      for (const l of lines) {
        const li = el("li");
        inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""), li);
        ul.append(li);
      }
      into.append(ul);
    } else {
      const p = el("p");
      lines.forEach((l, i) => {
        if (i) p.append(el("br"));
        inline(l.replace(/^#+\s*/, ""), p);
      });
      into.append(p);
    }
  }
}

// ===== Calendar: a day, week, month or year =====
let calData = null;
let calAt = 0;
async function calendarData() {
  if (calData && Date.now() - calAt < 60000) return calData;
  try {
    const res = await fetch("/calendar-api/data", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    calData = await res.json();
    calAt = Date.now();
  } catch (err) {
    if (!calData) calData = { notes: [], days: [], offline: true };
  }
  return calData;
}
function spanStart(span, date) {
  const d = new Date(date + "T12:00:00Z");
  if (span === "week") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (span === "month") d.setUTCDate(1);
  if (span === "year") d.setUTCMonth(0, 1);
  return d.toISOString().slice(0, 10);
}
function spanEnd(span, start) {
  const d = new Date(start + "T12:00:00Z");
  if (span === "day") return start;
  if (span === "week") return addDays(start, 6);
  if (span === "month") {
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  }
  d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 0);
  return d.toISOString().slice(0, 10);
}
function shiftSpan(span, start, by) {
  const d = new Date(start + "T12:00:00Z");
  if (span === "day") return addDays(start, by);
  if (span === "week") return addDays(start, 7 * by);
  if (span === "month") d.setUTCMonth(d.getUTCMonth() + by, 1);
  else d.setUTCFullYear(d.getUTCFullYear() + by, 0, 1);
  return d.toISOString().slice(0, 10);
}
function calendarTitle(c) {
  const start = c.start || spanStart(c.span || "week", todayUk());
  const end = spanEnd(c.span || "week", start);
  if (c.span === "day") return dayLabel(start, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (c.span === "month") return dayLabel(start, { month: "long", year: "numeric" });
  if (c.span === "year") return start.slice(0, 4);
  return `${dayLabel(start, { day: "numeric", month: "short" })} – ${dayLabel(end, { day: "numeric", month: "short", year: "numeric" })}`;
}
function calendarBody(c, body) {
  const span = c.span || "week";
  if (!c.start) c.start = spanStart(span, todayUk());
  const nav = el("div", "cal-nav");
  const prev = iconButton(ICON.left, `Previous ${span}`);
  const next = iconButton(ICON.right, `Next ${span}`);
  const title = el("b", "", calendarTitle(c));
  const move = (by) => {
    c.start = shiftSpan(span, c.start, by);
    c.updated = nowIso();
    changed();
    redraw(c);
  };
  prev.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  nav.append(prev, title, next);
  const list = el("div", span === "year" ? "cal-months" : "cal-days");
  list.append(el("p", "cal-none", "Looking at the calendar…"));
  body.append(nav, list);
  calendarData().then((data) => {
    list.replaceChildren();
    if (data.offline && !(data.notes || []).length) return list.append(el("p", "cal-none", "The calendar's on the studio computer, which isn't answering just now."));
    const from = c.start;
    const to = spanEnd(span, from);
    const byDay = new Map();
    for (const ev of data.notes || []) {
      for (const o of occurrences(ev, from, to)) {
        if (!byDay.has(o.date)) byDay.set(o.date, []);
        byDay.get(o.date).push({ time: ev.allDay ? "" : o.start.slice(11, 16), title: ev.title || "Untitled" });
      }
    }
    for (const d of data.days || []) {
      const date = d.date || (typeof d.start === "string" ? d.start.slice(0, 10) : "");
      if (date && date >= from && date <= to) {
        if (!byDay.has(date)) byDay.set(date, []);
        byDay.get(date).push({ time: "", title: d.title || d.text || "Day card" });
      }
    }
    for (const evs of byDay.values()) evs.sort((a, b) => a.time.localeCompare(b.time));
    const today = todayUk();
    if (span === "year") {
      for (let m = 0; m < 12; m++) {
        const ms = `${from.slice(0, 4)}-${String(m + 1).padStart(2, "0")}`;
        const count = [...byDay.entries()].filter(([d]) => d.startsWith(ms)).reduce((n, [, evs]) => n + evs.length, 0);
        const box = el("div", "cal-month");
        box.append(el("b", "", dayLabel(`${ms}-01`, { month: "long" })), document.createTextNode(count ? `${count} thing${count === 1 ? "" : "s"}` : "Nothing yet"));
        list.append(box);
      }
      return;
    }
    let shown = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const evs = byDay.get(d) || [];
      if (span === "month" && !evs.length) continue;
      const day = el("div", `cal-day${d === today ? " today" : ""}`);
      day.append(el("h4", "", dayLabel(d)));
      if (!evs.length) day.append(el("p", "cal-none", "Free"));
      for (const ev of evs) {
        const row = el("div", "cal-ev");
        const t = el("time", "", ev.time || "all day");
        row.append(t, el("span", "", ev.title));
        day.append(row);
      }
      list.append(day);
      shown++;
    }
    if (!shown) list.append(el("p", "cal-none", "Nothing on the calendar this month."));
  });
}

// ===== The drawer: notes, calendar spans and Agent's questions =====
const drawer = $("drawer");
$("drawer-btn").addEventListener("click", () => toggleDrawer());
$("drawer-close").addEventListener("click", () => toggleDrawer(false));
function toggleDrawer(open = drawer.hidden) {
  drawer.hidden = !open;
  $("drawer-btn").setAttribute("aria-expanded", String(open));
  if (open) showPane(drawer.querySelector('[role="tab"][aria-selected="true"]').dataset.pane);
}
drawer.querySelector(".drawer-tabs").addEventListener("click", (e) => {
  const t = e.target.closest("[data-pane]");
  if (t) showPane(t.dataset.pane);
});
function showPane(name) {
  for (const t of drawer.querySelectorAll('[role="tab"]')) t.setAttribute("aria-selected", String(t.dataset.pane === name));
  for (const p of drawer.querySelectorAll(".pane")) p.hidden = p.dataset.pane !== name;
  if (name === "notes") loadNotes();
  if (name === "calendar") drawSpans();
  if (name === "agent") loadAgent();
}
// One thing to bring over: drag it onto the table, or press it to put it in the middle
function pickItem(spec, title, small) {
  const li = el("li");
  li.tabIndex = 0;
  li.draggable = true;
  li.append(el("b", "", title));
  if (small) li.append(el("small", "", small));
  li.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-nova-board", JSON.stringify(spec));
    e.dataTransfer.setData("text/plain", title);
    e.dataTransfer.effectAllowed = "copy";
  });
  const add = () => {
    addCard(JSON.parse(JSON.stringify(spec)));
    if (matchMedia("(max-width: 640px)").matches) toggleDrawer(false);
  };
  li.addEventListener("click", add);
  li.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), add()));
  return li;
}
const textOf = (html) => {
  try {
    return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();
  } catch (err) {
    return "";
  }
};
let allNotes = null;
async function loadNotes() {
  const list = $("notes-list");
  if (!allNotes) list.replaceChildren(el("li", "none", "Looking for your notes…"));
  const found = new Map();
  // Shared notes (Nova Bot, through this site)
  try {
    let since = 0;
    for (let round = 0; round < 10; round++) {
      const res = await fetch(`/notes-api/changes?since=${since}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) break;
      const data = await res.json();
      for (const n of data.notes || []) {
        if (n.deleted || !n.html) found.delete(n.id);
        else found.set(n.id, { id: n.id, title: n.title, html: n.html, created: n.created, updated: n.updated, shared: true });
      }
      since = data.cursor || since;
      if (!data.more) break;
    }
  } catch (err) {}
  // This browser's own notes (Notes keeps them in this site's storage)
  for (const n of await localNotes()) {
    const had = found.get(n.id);
    if (!had || (n.updated || "") > (had.updated || "")) found.set(n.id, n);
  }
  allNotes = [...found.values()].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  drawNotes();
}
function localNotes() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("nova-notes", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("notes", { keyPath: "id" });
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction("notes", "readonly");
          const all = tx.objectStore("notes").getAll();
          all.onsuccess = () => resolve((all.result || []).filter((n) => n && n.id));
          all.onerror = () => resolve([]);
        } catch (err) {
          resolve([]);
        }
      };
    } catch (err) {
      resolve([]);
    }
  });
}
function drawNotes() {
  const list = $("notes-list");
  const q = $("notes-search").value.trim().toLowerCase();
  const notes = (allNotes || []).filter((n) => !q || `${n.title} ${textOf(n.html)}`.toLowerCase().includes(q));
  if (!notes.length) return list.replaceChildren(el("li", "none", allNotes && allNotes.length ? "No note matches that." : "No notes yet. Write one in Notes."));
  list.replaceChildren(...notes.slice(0, 200).map((n) => {
    const text = textOf(n.html);
    return pickItem({ kind: "note", noteId: n.id, title: (n.title || "Untitled note").slice(0, 300), text: text.slice(0, 600), noteCreated: n.created, noteUpdated: n.updated }, n.title || "Untitled note", `Changed ${when(n.updated)}${n.shared ? " · Shared" : ""}`);
  }));
}
$("notes-search").addEventListener("input", drawNotes);
function drawSpans() {
  const t = todayUk();
  const items = [
    ["day", t, "Today"],
    ["day", addDays(t, 1), "Tomorrow"],
    ["week", spanStart("week", t), "This week"],
    ["week", spanStart("week", addDays(t, 7)), "Next week"],
    ["month", spanStart("month", t), "This month"],
    ["month", shiftSpan("month", spanStart("month", t), 1), "Next month"],
    ["year", spanStart("year", t), "This year"],
  ];
  $("cal-list").replaceChildren(...items.map(([span, start, name]) => {
    const spec = { kind: "calendar", span, start };
    return pickItem(spec, name, calendarTitle(spec));
  }));
}
async function loadAgent() {
  const list = $("agent-list");
  list.replaceChildren(el("li", "none", "Looking at what you asked…"));
  let messages = [];
  try {
    const res = await fetch("/chat/history", { cache: "no-store" });
    const data = await res.json();
    messages = data.messages || [];
  } catch (err) {
    return list.replaceChildren(el("li", "none", "Agent's history is on the studio computer, which isn't answering just now."));
  }
  const pairs = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user" || typeof m.content !== "string" || !m.content.trim()) continue;
    const reply = messages.slice(i + 1).find((x) => x.role === "assistant");
    pairs.push({ q: m.content.trim(), a: reply && typeof reply.content === "string" ? reply.content : "", at: m.at || m.time || "" });
  }
  if (!pairs.length) return list.replaceChildren(el("li", "none", "Nothing asked yet. Add an “Ask Agent” card to ask something."));
  list.replaceChildren(...pairs.reverse().slice(0, 60).map((p) => pickItem({ kind: "agent", title: p.q.slice(0, 300), answer: p.a.slice(0, 40000), asked: p.at || undefined }, p.q.slice(0, 120), p.a ? p.a.replace(/\s+/g, " ").slice(0, 90) : "No answer")));
}

// Opening a note in Notes (inside Nova Agent when it's there)
function openNote(id) {
  const page = `/notes/?note=${encodeURIComponent(id)}`;
  try {
    if (window.top !== window && window.top.NovaAgent && window.top.NovaAgent.open) return window.top.NovaAgent.open(page);
  } catch (err) {}
  location.href = page;
}

// ===== The bin =====
$("bin-btn").addEventListener("click", () => {
  const bin = $("bin");
  bin.hidden = !bin.hidden;
  if (!bin.hidden) drawBin();
});
$("bin-close").addEventListener("click", () => ($("bin").hidden = true));
function drawBin() {
  const mine = removed.filter((r) => r.boardId === current);
  $("bin-count").hidden = !mine.length;
  $("bin-count").textContent = String(mine.length);
  $("bin-none").hidden = mine.length > 0;
  $("bin-list").replaceChildren(...mine.map((r) => {
    const li = el("li");
    li.append(el("span", "", `${KIND_NAMES[r.card.kind]}: ${cardTitle(r.card)}`));
    const b = el("button", "chip", "Put back");
    b.type = "button";
    b.addEventListener("click", () => restore(r));
    li.append(b);
    return li;
  }));
}

// ===== A short message, sometimes with Undo =====
let toastTimer = 0;
function toast(text, undo) {
  const t = $("toast");
  $("toast-text").textContent = text;
  const u = $("toast-undo");
  u.hidden = !undo;
  u.onclick = undo ? () => { undo(); t.hidden = true; } : null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), undo ? 6000 : 3500);
}

// The bar's height (for the drawer and the bin to sit under it)
const bar = document.querySelector(".bar");
const measure = () => document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
new ResizeObserver(measure).observe(bar);
measure();

// For tests and the Manual
window.NovaBoard = { boards: () => boards, current: () => board(), addCard, fitAll };

start();
