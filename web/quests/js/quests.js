// Quests: every quest in one place (the same quests as Nova Agent's own Quests, Notes and Portal).
// Add one in everyday words (parse.js), tick it off, focus on one thing, see them on a board by how
// they're going or hour by hour. Its data: GET /quests/state and /quests/events, and the
// /actions/quests routes (src/visualizer/server.ts); online it all goes through Nova Bot's link.
import { dayWords, parseQuick, ukNow } from "./parse.js";
import { BOARD_MODES, columns, days, focusList, matches, sections, streak, tagsInUse, todayStamp } from "./sort.js";

const HDR = { "X-Nova-Visualizer": "1" };
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KEY = "nova-quests/";
const saved = (k, d) => {
  try {
    const v = localStorage.getItem(KEY + k);
    return v === null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const keep = (k, v) => {
  try {
    localStorage.setItem(KEY + k, JSON.stringify(v));
  } catch {}
};
const Modes = window.NovaQuestModes;
const MODE_NAME = (m) => (Modes ? Modes.name(m) : m);

let state = null; // the last /quests/state
let who = saved("who", "mine");
const START_VIEWS = ["today", "focus", "list", "board"];
let start = saved("start", "today"); // which view Quests opens in (Options → Opens in), Today unless changed
if (!START_VIEWS.includes(start)) start = "today";
const askedView = new URLSearchParams(location.search).get("view");
let view = START_VIEWS.includes(askedView) ? askedView : start;
let calm = saved("calm", false);
let celebrate = saved("celebrate", true);
let showDone = saved("showDone", true);
let query = "";
let tag = "";
let focusSkip = 0; // Focus → "Not now" moves on to the next one
const hidden = new Set(); // deleted, waiting for Undo
const pending = new Map(); // id → timer (deletes not sent yet)

// ---------- Talking to Nova Quests ----------
async function post(path, body, opts = {}) {
  try {
    const res = await fetch(path, { method: "POST", headers: { ...HDR, "Content-Type": "application/json" }, body: JSON.stringify(body || {}), keepalive: opts.keepalive });
    const data = await res.json().catch(() => ({ ok: false, message: `That didn't work (${res.status}).` }));
    if (!data.ok) throw new Error(data.message || "That didn't work.");
    return data.result;
  } catch (error) {
    toast(error.message || "That didn't work. Try again?");
    throw error;
  }
}
const act = (id, action, extra = {}) => post(`/actions/quests/${encodeURIComponent(id)}`, { action, ...extra });
const change = (id, changes) => post(`/actions/quests/${encodeURIComponent(id)}`, { changes });

let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(`/quests/state${who === "everyone" ? "?who=everyone" : ""}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? "Sign in to Nova Agent to see your quests." : res.status === 502 || res.status === 503 ? "Nova Agent can't be reached just now. Your quests are safe; this page will try again by itself." : `Quests didn't load (${res.status}).`);
      state = await res.json();
      $("offline").hidden = true;
      render();
    } catch (error) {
      $("offline").textContent = error.message;
      $("offline").hidden = false;
    } finally {
      $("loading").hidden = true;
      loading = null;
    }
  })();
  return loading;
}
// Live: Nova Quests says when anything changed (a reminder, Agent, Notes, another device)
let later = 0;
function live() {
  try {
    const es = new EventSource("/quests/events");
    es.addEventListener("changed", () => {
      clearTimeout(later);
      later = setTimeout(load, 300);
    });
    es.onerror = () => {
      es.close();
      setTimeout(live, 15000);
    };
  } catch {}
}
// Back to the page after a while: fresh again
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
  else flushDeletes();
});
window.addEventListener("pagehide", flushDeletes);

// ---------- Small pieces ----------
const quests = () => (state?.quests || []).filter((q) => !hidden.has(q.id));
const shown = () => quests().filter((q) => matches(q, query) && (!tag || (q.tags || []).includes(tag)));
const today = () => ukNow();
function when(stamp) {
  if (!stamp) return "";
  const [d, t] = stamp.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  const day = { y, m, d: dd, dow: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() };
  return `${dayWords(day, today())}${t ? ` ${t.slice(0, 5)}` : ""}`;
}
const PRI = { critical: "Critical", high: "High", low: "Low" };
const mins = (n) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${Math.round(n % 60)} min` : ""}` : n >= 1 ? `${Math.round(n)} min` : `${Math.round(n * 60)} s`);
function repeatWords(q) {
  if (!q.ongoing) return "";
  if (q.every === "interval") return `every ${mins(q.everyMinutes)}`;
  return q.every === "day" ? "every day" : q.every === "weekday" ? "weekdays" : "every week";
}
const ICON = {
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a7 7 0 0 1 12-5l2 2M20 12a7 7 0 0 1-12 5l-2-2"/><path d="M18 4v5h-5M6 20v-5h5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  steps: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7l2 2 3-3M5 15l2 2 3-3M13 8h6M13 16h6"/></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></svg>',
  risk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

function meta(q, { short = false, noWhen = false } = {}) {
  const bits = [];
  const t = noWhen ? "" : q.start || q.fixedStart;
  if (t) bits.push(`<span class="m when">${ICON.clock}${esc(when(t))}${q.end && q.start ? `–${esc(q.end.slice(11, 16))}` : ""}</span>`);
  else if (q.timeOfDay && q.timeOfDay !== "any") bits.push(`<span class="m when">${ICON.clock}${esc(q.timeOfDay)}</span>`);
  if (q.deadline && !short) bits.push(`<span class="m due${q.deadline < todayStamp() ? " late" : ""}">${ICON.flag}by ${esc(when(q.deadline))}</span>`);
  if (q.atRisk && q.deadline) bits.push(`<span class="m risk">${ICON.risk}won't fit before its deadline</span>`);
  if (PRI[q.priority]) bits.push(`<span class="m pri p-${q.priority}">${PRI[q.priority]}</span>`);
  if (q.ongoing) bits.push(`<span class="m rep">${ICON.repeat}${esc(repeatWords(q))}</span>`);
  if (!short && q.minutes && !q.ongoing) bits.push(`<span class="m len">${esc(mins(q.minutes))}</span>`);
  if (q.steps?.length) bits.push(`<span class="m st">${ICON.steps}${q.steps.filter((s) => s.done).length}/${q.steps.length}</span>`);
  if (!short) for (const t2 of q.tags || []) bits.push(`<button type="button" class="m tag" data-tag="${esc(t2)}" aria-label="Show only #${esc(t2)}">#${esc(t2)}</button>`);
  if (who === "everyone" && q.ownerName && q.owner !== state?.person?.id) bits.push(`<span class="m who">${esc(q.ownerName)}</span>`);
  return bits.join("");
}

// One quest as a row (List, Today) or a card (Board)
function row(q, { drag = true, card = false, noWhen = false } = {}) {
  const done = q.status === "done";
  const label = `${q.title}${done ? ", done" : ""}`;
  return `<li class="q${done ? " done" : ""}${q.status === "doing" ? " doing" : ""}${card ? " card" : ""} p-${q.priority}" data-id="${esc(q.id)}" tabindex="-1"${card ? ' draggable="true"' : ""}>
    ${drag && !card ? `<button type="button" class="grip" aria-label="Move ${esc(q.title)} (or Alt+arrow keys)" title="Drag to move">${ICON.grip}</button>` : ""}
    <button type="button" class="tick" role="checkbox" aria-checked="${done}" aria-label="${esc(done ? `Not done: ${q.title}` : `Done: ${q.title}`)}" data-sfx="${done ? "uncheck" : "done"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg></button>
    <div class="q-main">
      <button type="button" class="q-open" aria-label="${esc(label)}: open the details"><span class="q-title">${esc(q.title)}</span></button>
      <span class="q-meta">${meta(q, { short: card, noWhen })}</span>
    </div>
    ${Modes && !done ? Modes.chip(q.mode || "waiting", { "data-mode": q.id }) : ""}
  </li>`;
}

// ---------- Views ----------
function render() {
  if (!state) return;
  document.body.classList.toggle("calm", calm);
  $("calm-btn").setAttribute("aria-pressed", String(calm));
  for (const b of document.querySelectorAll(".views [role=tab]")) b.setAttribute("aria-selected", String(b.dataset.view === view));
  for (const s of document.querySelectorAll(".view")) s.hidden = s.dataset.view !== view;
  $("opt-everyone").hidden = !state.canSeeEveryone;
  $("opt-everyone").setAttribute("aria-pressed", String(who === "everyone"));
  $("opt-celebrate").setAttribute("aria-pressed", String(celebrate));
  for (const b of document.querySelectorAll("[data-start]")) b.setAttribute("aria-pressed", String(b.dataset.start === start));
  $("opt-done").setAttribute("aria-pressed", String(showDone));
  $("opt-phone").setAttribute("aria-pressed", String(Boolean(state.rhythm?.phonePush)));
  renderStreak();
  renderTags();
  if (view === "focus") renderFocus();
  else if (view === "board") renderBoard();
  else if (view === "today") renderToday();
  else renderList();
}

function renderStreak() {
  const s = streak(quests());
  const el = $("streak");
  el.hidden = calm || s.days < 2;
  el.textContent = `✦ ${s.days} days in a row`;
  el.title = s.doneToday ? "Something done every day. Lovely." : "Do one today to keep it going";
}

function renderTags() {
  const tags = tagsInUse(quests());
  const box = $("filters");
  box.hidden = calm || (!tags.length && !tag) || view === "focus";
  box.innerHTML = tags.length || tag
    ? `<button type="button" class="chip${tag ? "" : " active"}" data-filter="">All</button>` + [...new Set([...(tag ? [tag] : []), ...tags])].slice(0, 12).map((t) => `<button type="button" class="chip${t === tag ? " active" : ""}" data-filter="${esc(t)}" aria-pressed="${t === tag}">#${esc(t)}</button>`).join("")
    : "";
}

const GROUPS = [
  ["now", "Now"],
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["upcoming", "Coming up"],
  ["anytime", "Any time"],
  ["done", "Done"],
];
function renderList() {
  const g = sections(shown());
  const box = $("view-list");
  const any = GROUPS.some(([k]) => g[k].length && (k !== "done" || showDone));
  if (!any) {
    box.innerHTML = empty();
    return;
  }
  const cap = calm ? 5 : 200;
  box.innerHTML = GROUPS.filter(([k]) => g[k].length && (k !== "done" || showDone))
    .map(([k, name]) => {
      const list = g[k];
      const more = list.length > cap ? list.length - cap : 0;
      const folded = k === "done" && saved("doneOpen", false) === false;
      return `<section class="group g-${k}" aria-labelledby="h-${k}">
        <h2 class="g-head" id="h-${k}">${k === "done" ? `<button type="button" class="fold" aria-expanded="${!folded}" data-fold="done">${name} <small>${list.length}</small></button>` : `${name} <small>${list.length}</small>`}</h2>
        ${folded ? "" : `<ul class="qs" data-group="${k}" aria-label="${name}">${list.slice(0, cap).map((q) => row(q, { drag: k !== "done" })).join("")}</ul>${more ? `<p class="more-note">${more} more. Turn Calm off to see them all.</p>` : ""}`}
      </section>`;
    })
    .join("");
}

function empty() {
  if (query || tag) return `<div class="empty"><p>Nothing matches${query ? ` “${esc(query)}”` : ""}${tag ? ` #${esc(tag)}` : ""}.</p><button type="button" class="btn ghost" data-clear>Show everything</button></div>`;
  return `<div class="empty"><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 8h22l6 6v26H10z"/><path d="M17 24l4 4 9-10M17 34h14"/></svg><p><b>No quests yet.</b> Write one in the box above, the way you'd say it.</p><p class="hint">Try “tomorrow 10am send invoices 30m !high”</p></div>`;
}

function renderFocus() {
  const list = focusList(shown());
  const box = $("view-focus");
  if (!list.length) {
    box.innerHTML = `<div class="empty focus-empty"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="16"/><path d="M17 24l5 5 10-11"/></svg><p><b>Nothing to do right now.</b></p><p class="hint">Enjoy it, or add something above.</p></div>`;
    return;
  }
  const i = focusSkip % list.length;
  const q = list[i];
  const after = [...list.slice(i + 1), ...list.slice(0, i)].slice(0, calm ? 1 : 3);
  const notStarted = q.status !== "doing";
  box.innerHTML = `<article class="focus-card p-${q.priority}" data-id="${esc(q.id)}" aria-labelledby="focus-title">
    <p class="focus-kicker">${q.status === "doing" ? "You're on" : i === 0 ? "Do this now" : "Or this one"}</p>
    <h2 class="focus-title" id="focus-title">${esc(q.title)}</h2>
    <p class="q-meta">${meta(q)}</p>
    ${q.steps?.length ? `<ul class="focus-steps" aria-label="Steps">${q.steps.map((s) => `<li><label><input type="checkbox" data-step="${esc(s.id)}"${s.done ? " checked" : ""}><span>${esc(s.text)}</span></label></li>`).join("")}</ul>` : ""}
    ${q.notes && !calm ? `<p class="focus-notes">${esc(q.notes)}</p>` : ""}
    <div class="focus-actions">
      <button type="button" class="btn primary big" data-focus="done" data-sfx="done"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9"/></svg>Done</button>
      ${notStarted ? `<button type="button" class="btn" data-focus="start">Start it</button>` : `<button type="button" class="btn" data-focus="snooze">15 more minutes</button>`}
      ${list.length > 1 ? `<button type="button" class="btn ghost" data-focus="next">Not now</button>` : ""}
      <button type="button" class="btn ghost" data-focus="edit">Details</button>
    </div>
  </article>
  ${after.length ? `<div class="focus-after"><h3>Then</h3><ul class="qs">${after.map((x) => row(x, { drag: false })).join("")}</ul></div>` : ""}`;
}

const BOARD_NAMES = { waiting: "Waiting", soon: "Soon", working: "Working on it", nearly: "Nearly finished", longer: "Taking longer", questions: "Questions", done: "Done" };
function renderBoard() {
  const cols = columns(shown());
  // Quiet columns stay out of the way: "Taking longer" and "Questions" only when they have something
  const keepCols = BOARD_MODES.filter((m) => cols[m].length || ["waiting", "soon", "working", "nearly", "done"].includes(m)).filter((m) => m !== "done" || showDone);
  $("view-board").innerHTML = `<div class="board">${keepCols
    .map(
      (m) => `<section class="col qm-${m}" data-mode="${m}" aria-labelledby="col-${m}">
      <h2 class="col-head" id="col-${m}"><span class="col-dot" aria-hidden="true"></span>${BOARD_NAMES[m]} <small>${cols[m].length}</small></h2>
      <ul class="qs col-list" data-col="${m}" aria-label="${BOARD_NAMES[m]}">${cols[m].map((q) => row(q, { card: true })).join("") || `<li class="col-empty" aria-hidden="true">Drop here</li>`}</ul>
    </section>`,
    )
    .join("")}</div>`;
}

function renderToday() {
  const { list, unplaced } = days(shown());
  const t = today();
  const dayName = (d) => {
    const [y, m, dd] = d.split("-").map(Number);
    const day = { y, m, d: dd, dow: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() };
    const words = dayWords(day, t);
    const long = new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    return words === "Today" || words === "Tomorrow" ? `${words} <small>${long}</small>` : long;
  };
  const now = todayStamp();
  $("view-today").innerHTML =
    list
      .slice(0, calm ? 1 : 8)
      .map(
        ({ day, quests: qs }) => `<section class="day" aria-labelledby="d-${day}">
      <h2 class="g-head" id="d-${day}">${dayName(day)}</h2>
      ${qs.length ? `<ol class="timeline">${qs
        .map((q) => {
          const s = q.start || q.fixedStart;
          const nowLine = q.start && q.start <= now && q.end > now;
          return `<li class="slot${nowLine ? " is-now" : ""}${q.status === "done" ? " done" : ""}" data-id="${esc(q.id)}"><span class="slot-time">${esc(s.slice(11, 16))}${q.end ? `<small>${esc(q.end.slice(11, 16))}</small>` : ""}</span><ul class="qs">${row(q, { drag: false, noWhen: true })}</ul></li>`;
        })
        .join("")}</ol>` : `<p class="day-free">Nothing planned.${day === list[0].day ? " A calm day so far." : ""}</p>`}
    </section>`,
      )
      .join("") +
    (unplaced.length && !calm
      ? `<section class="day" aria-labelledby="d-unplaced"><h2 class="g-head" id="d-unplaced">Not given a time yet <small>${unplaced.length}</small></h2><p class="day-free">Nova plans these into free time by itself. <button type="button" class="link-btn" data-replan>Plan them now</button></p><ul class="qs">${unplaced.map((q) => row(q, { drag: false })).join("")}</ul></section>`
      : "");
}

// ---------- Doing things ----------
const byId = (id) => state?.quests.find((q) => q.id === id);
function say(text) {
  $("say").textContent = "";
  setTimeout(() => ($("say").textContent = text), 30);
}
let toastTimer = 0;
function toast(text, undo) {
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !undo;
  $("toast-undo").onclick = () => {
    undo?.();
    $("toast").hidden = true;
  };
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 6500 : 4000);
}

async function toggleDone(id) {
  const q = byId(id);
  if (!q) return;
  const wasDone = q.status === "done";
  // Shown straight away; put right by the reload
  q.status = wasDone ? "todo" : "done";
  if (!wasDone) q.completed = new Date().toISOString();
  render();
  try {
    await act(id, wasDone ? "reopen" : "done");
    if (!wasDone) cheer(q);
  } finally {
    load();
  }
}
// A small, quiet well done (sounds: the tick's own "done"; the words for screen readers too)
function cheer(q) {
  const doneToday = quests().filter((x) => x.status === "done" && x.completed && new Date(x.completed).toDateString() === new Date().toDateString()).length;
  const s = streak(quests());
  const words = doneToday >= 5 ? `${doneToday} done today. That's a lot. Have a breather.` : doneToday > 1 ? `Done. ${doneToday} today.` : s.days > 1 ? `Done. ${s.days} days in a row.` : "Done. Nice one.";
  say(`${q.title}: ${words}`);
  if (!celebrate) return;
  toast(`✦ ${words}`, () => toggleDone(q.id));
  const el = document.querySelector(`[data-id="${CSS.escape(q.id)}"]`);
  if (el && !calm) {
    el.classList.add("glow");
    setTimeout(() => el.classList.remove("glow"), 1200);
  }
}

function remove(id) {
  const q = byId(id);
  if (!q) return;
  hidden.add(id);
  render();
  say(`Deleted ${q.title}`);
  const timer = setTimeout(() => sendDelete(id), 6500);
  pending.set(id, timer);
  toast(`Deleted “${q.title}”`, () => {
    clearTimeout(pending.get(id));
    pending.delete(id);
    hidden.delete(id);
    render();
    say(`${q.title} is back`);
  });
}
async function sendDelete(id, keepalive = false) {
  pending.delete(id);
  try {
    await post(`/actions/quests/${encodeURIComponent(id)}`, { action: "remove" }, { keepalive });
  } catch {
    hidden.delete(id);
  }
  if (!keepalive) load();
}
function flushDeletes() {
  for (const [id, timer] of pending) {
    clearTimeout(timer);
    sendDelete(id, true);
  }
}

async function quickAdd(text) {
  const { title, fields } = parseQuick(text);
  if (!title) {
    toast("Say what the quest is, too.");
    return false;
  }
  await post("/actions/quests", { title, ...fields });
  say(`Added ${title}`);
  load();
  return true;
}

// Drag to reorder (List): the grip, by mouse, finger or pen; Alt+arrows from the keyboard
async function saveOrder(list) {
  const ids = [...list.querySelectorAll(":scope > li.q")].map((li) => li.dataset.id);
  for (const [i, id] of ids.entries()) {
    const q = byId(id);
    if (q) q.order = i + 1;
  }
  try {
    await post("/actions/quests/order", { ids });
  } finally {
    load();
  }
}
function startDrag(e, li) {
  const list = li.parentElement;
  li.classList.add("dragging");
  li.setPointerCapture?.(e.pointerId);
  const move = (ev) => {
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("li.q");
    if (!over || over === li || over.parentElement !== list) return;
    const r = over.getBoundingClientRect();
    list.insertBefore(li, ev.clientY < r.top + r.height / 2 ? over : over.nextSibling);
  };
  const up = () => {
    li.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    saveOrder(list);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// Board: drag a card to another column (or use its mode chip)
let dragId = "";
document.addEventListener("dragstart", (e) => {
  const li = e.target.closest?.("#view-board li.q");
  if (!li) return;
  dragId = li.dataset.id;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
  li.classList.add("dragging");
});
document.addEventListener("dragend", (e) => e.target.closest?.("li.q")?.classList.remove("dragging"));
document.addEventListener("dragover", (e) => {
  const col = e.target.closest?.("#view-board .col");
  if (!col || !dragId) return;
  e.preventDefault();
  for (const c of document.querySelectorAll("#view-board .col.over")) if (c !== col) c.classList.remove("over");
  col.classList.add("over");
});
document.addEventListener("drop", async (e) => {
  const col = e.target.closest?.("#view-board .col");
  if (!col || !dragId) return;
  e.preventDefault();
  col.classList.remove("over");
  const id = dragId;
  dragId = "";
  await setMode(id, col.dataset.mode);
});
async function setMode(id, mode) {
  const q = byId(id);
  if (!q || !mode || (q.mode === mode && (mode !== "done") === (q.status !== "done"))) return;
  q.mode = mode;
  if (mode === "done") q.status = "done";
  render();
  try {
    if (mode === "done") {
      await act(id, "done");
      cheer(q);
    } else {
      if (q.status === "done") await act(id, "reopen");
      await act(id, "mode", { mode });
    }
    say(`${q.title}: ${MODE_NAME(mode)}`);
  } finally {
    load();
  }
}

// ---------- The details sheet ----------
let editing = null; // the quest being edited, or { new: true }
let steps = [];
const toLocal = (stamp) => (stamp ? stamp.slice(0, 16) : "");
function openEditor(q, preset = {}) {
  editing = q || { new: true };
  const base = q || { title: preset.title || "", minutes: preset.minutes || 30, priority: preset.priority || "normal", fixedStart: preset.fixedStart || "", deadline: preset.deadline || "", tags: preset.tags || [], steps: [], notes: "", location: "", ongoing: Boolean(preset.ongoing), every: preset.every || "day", everyMinutes: preset.everyMinutes || 30 };
  $("ed-title-label").textContent = q ? "Quest" : "New quest";
  $("ed-title").value = base.title;
  $("ed-start").value = toLocal(base.fixedStart || "");
  $("ed-deadline").value = toLocal(base.deadline);
  const m = $("ed-minutes");
  const minutes = Math.round(base.minutes || 30);
  if (![...m.options].some((o) => +o.value === minutes)) m.add(new Option(mins(minutes), String(minutes)));
  m.value = String(minutes);
  $("ed-repeat").value = base.ongoing ? base.every : "";
  $("ed-every").value = base.everyMinutes || 30;
  $("ed-every-wrap").hidden = $("ed-repeat").value !== "interval";
  for (const r of document.querySelectorAll('input[name="pri"]')) r.checked = r.value === (base.priority || "normal");
  steps = (base.steps || []).map((s) => ({ ...s }));
  drawSteps();
  $("ed-tags").value = (base.tags || []).join(", ");
  $("ed-notes").value = base.notes || "";
  $("ed-location").value = base.location || "";
  $("ed-delete").hidden = !q;
  $("ed-mode-wrap").hidden = !q;
  $("ed-mode").value = q ? (q.status === "done" ? "done" : q.mode || "waiting") : "waiting";
  const info = [];
  if (q?.start) info.push(`Planned for ${when(q.start)}–${q.end.slice(11, 16)}.`);
  if (q?.from) info.push(`From ${q.from}.`);
  if (state?.rhythm) info.push(state.rhythm.phonePush ? `A reminder comes ${state.rhythm.remindMinutesBefore} min before, on your phone too.` : `A reminder comes ${state.rhythm.remindMinutesBefore} min before (phone reminders are off: Options).`);
  $("ed-info").textContent = info.join(" ");
  $("editor").showModal();
  setTimeout(() => $("ed-title").focus(), 30);
}
function drawSteps() {
  $("ed-steps").innerHTML = steps
    .map((s, i) => `<li><label><input type="checkbox" data-i="${i}"${s.done ? " checked" : ""}><span class="sr">Done: </span></label><input class="step-text" data-i="${i}" value="${esc(s.text)}" maxlength="200" aria-label="Step ${i + 1}"><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove step ${i + 1}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`)
    .join("");
  $("ed-steps-count").textContent = steps.length ? `${steps.filter((s) => s.done).length} of ${steps.length} done` : "";
}
function addStep() {
  const text = $("ed-step-new").value.trim();
  if (!text) return;
  if (steps.length >= 30) return toast("That's plenty of steps (30 at most).");
  steps.push({ id: Math.random().toString(36).slice(2, 10), text, done: false });
  $("ed-step-new").value = "";
  drawSteps();
}
const stampOf = (v) => (v ? v.slice(0, 16) : "");
async function saveEditor() {
  const title = $("ed-title").value.trim();
  if (!title) {
    $("ed-title").focus();
    return toast("Give it a name first.");
  }
  const repeat = $("ed-repeat").value;
  const out = {
    title,
    fixedStart: stampOf($("ed-start").value),
    deadline: stampOf($("ed-deadline").value),
    minutes: Number($("ed-minutes").value),
    ongoing: Boolean(repeat),
    priority: document.querySelector('input[name="pri"]:checked')?.value || "normal",
    steps: steps.filter((s) => s.text.trim()),
    tags: $("ed-tags").value.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean).slice(0, 10),
    notes: $("ed-notes").value,
    location: $("ed-location").value,
  };
  if (repeat) out.every = repeat;
  if (repeat === "interval") out.everyMinutes = Math.max(1, Number($("ed-every").value) || 30);
  if (editing.new) {
    await post("/actions/quests", out);
    say(`Added ${title}`);
  } else {
    // Only what changed (the server refuses nothing it doesn't need to)
    const q = editing;
    const changes = {};
    for (const [k, v] of Object.entries(out)) {
      const was = k === "fixedStart" || k === "deadline" ? toLocal(q[k]) : q[k];
      if (JSON.stringify(was ?? (Array.isArray(v) ? [] : "")) !== JSON.stringify(v)) changes[k] = v;
    }
    const mode = $("ed-mode").value;
    if (mode !== (q.status === "done" ? "done" : q.mode || "waiting")) changes.mode = mode;
    if (Object.keys(changes).length) await change(q.id, changes);
    if (changes.mode === "done") cheer(q);
    say(`Saved ${title}`);
  }
  $("editor").close();
  load();
}

// ---------- Wiring ----------
function setView(v) {
  view = v;
  focusSkip = 0;
  render();
}
for (const b of document.querySelectorAll(".views [role=tab]")) b.addEventListener("click", () => setView(b.dataset.view));
$("calm-btn").addEventListener("click", () => {
  calm = !calm;
  keep("calm", calm);
  document.documentElement.toggleAttribute("data-quests-calm", calm);
  render();
  say(calm ? "Calm on: fewer things on screen" : "Calm off");
});

// Quick add, with a live preview of what was understood
const input = $("add-input");
input.addEventListener("input", () => {
  const v = input.value.trim();
  const { title, bits } = v ? parseQuick(v) : { title: "", bits: [] };
  $("add-preview").innerHTML = v ? `<span class="pv-title">${esc(title || "…")}</span>${bits.map((b) => `<span class="pv">${esc(b)}</span>`).join("")}` : "";
});
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return input.focus();
  input.disabled = true;
  try {
    if (await quickAdd(v)) {
      input.value = "";
      $("add-preview").innerHTML = "";
    }
  } catch {
  } finally {
    input.disabled = false;
    input.focus();
  }
});
$("add-more").addEventListener("click", () => {
  const v = input.value.trim();
  const { title, fields } = v ? parseQuick(v) : { title: "", fields: {} };
  openEditor(null, { title, ...fields });
});

// Search
function toggleSearch(on = $("search-row").hidden) {
  $("search-row").hidden = !on;
  $("search-btn").setAttribute("aria-expanded", String(on));
  if (on) $("search").focus();
  else if (query) {
    query = "";
    $("search").value = "";
    render();
  }
}
$("search-btn").addEventListener("click", () => toggleSearch());
$("search").addEventListener("input", () => {
  query = $("search").value;
  render();
});
$("search").addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleSearch(false);
});

// The options (always on screen, under the bar)
$("opt-everyone").addEventListener("click", () => {
  who = who === "everyone" ? "mine" : "everyone";
  keep("who", who);
  load();
});
for (const b of document.querySelectorAll("[data-start]"))
  b.addEventListener("click", () => {
    start = b.dataset.start;
    keep("start", start);
    setView(start);
  });
$("opt-celebrate").addEventListener("click", () => {
  celebrate = !celebrate;
  keep("celebrate", celebrate);
  render();
});
$("opt-done").addEventListener("click", () => {
  showDone = !showDone;
  keep("showDone", showDone);
  render();
});
$("opt-phone").addEventListener("click", async () => {
  const on = !state?.rhythm?.phonePush;
  await post("/actions/rhythm", { phonePush: on });
  toast(on ? "Reminders go to your phone too (turn on Alerts in Nova Agent on the phone)." : "Phone reminders off.");
  load();
});
$("opt-replan").addEventListener("click", async () => {
  await post("/actions/replan", {});
  toast("Re-planned from now.");
  load();
});
$("opt-keys").addEventListener("click", () => {
  $("keys").showModal();
});
$("keys-close").addEventListener("click", () => $("keys").close());

// Clicks inside the views (one listener for all of them)
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("dialog")) return;
  const filter = t.closest("[data-filter]");
  if (filter) {
    tag = filter.dataset.filter;
    return render();
  }
  const tg = t.closest(".m.tag");
  if (tg) {
    e.stopPropagation();
    tag = tg.dataset.tag;
    return render();
  }
  if (t.closest("[data-clear]")) {
    query = tag = "";
    $("search").value = "";
    return render();
  }
  if (t.closest("[data-replan]")) {
    await post("/actions/replan", {});
    return load();
  }
  const fold = t.closest("[data-fold]");
  if (fold) {
    keep("doneOpen", fold.getAttribute("aria-expanded") !== "true");
    return render();
  }
  const modeChip = t.closest("[data-mode].qm-chip");
  if (modeChip && Modes) {
    const id = modeChip.dataset.mode;
    const picked = await Modes.pick(modeChip, byId(id)?.mode);
    if (picked) await setMode(id, picked);
    return;
  }
  const li = t.closest("li.q");
  if (li) {
    if (t.closest(".tick")) return toggleDone(li.dataset.id);
    if (t.closest(".grip")) return;
    if (t.closest(".q-main")) return openEditor(byId(li.dataset.id));
  }
  const f = t.closest("[data-focus]");
  if (f) {
    const id = t.closest(".focus-card")?.dataset.id;
    const q = byId(id);
    if (!q) return;
    const what = f.dataset.focus;
    if (what === "done") return toggleDone(id);
    if (what === "next") {
      focusSkip++;
      return render();
    }
    if (what === "edit") return openEditor(q);
    if (what === "start") {
      await act(id, "start");
      say(`Started ${q.title}`);
    }
    if (what === "snooze") {
      await act(id, "snooze", { minutes: 15 });
      say(`${q.title}: 15 more minutes`);
    }
    return load();
  }
});
// Ticking a step in Focus saves straight away
document.addEventListener("change", async (e) => {
  const box = e.target.closest?.("[data-step]");
  if (!box) return;
  const id = box.closest(".focus-card").dataset.id;
  const q = byId(id);
  if (!q) return;
  const next = q.steps.map((s) => (s.id === box.dataset.step ? { ...s, done: box.checked } : s));
  q.steps = next;
  await change(id, { steps: next });
  if (next.every((s) => s.done) && celebrate) toast("✦ Every step done. Tick the quest off?", null);
  load();
});
document.addEventListener("pointerdown", (e) => {
  const grip = e.target.closest?.(".grip");
  if (!grip || e.button > 0) return;
  e.preventDefault();
  startDrag(e, grip.closest("li.q"));
});

// The editor's own buttons
$("ed-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveEditor().catch(() => {});
});
$("ed-close").addEventListener("click", () => $("editor").close());
$("ed-cancel").addEventListener("click", () => $("editor").close());
$("ed-delete").addEventListener("click", () => {
  const id = editing?.id;
  $("editor").close();
  if (id) remove(id);
});
$("ed-repeat").addEventListener("change", () => ($("ed-every-wrap").hidden = $("ed-repeat").value !== "interval"));
$("ed-step-add").addEventListener("click", addStep);
$("ed-step-new").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addStep();
  }
});
$("ed-steps").addEventListener("input", (e) => {
  const i = Number(e.target.dataset.i);
  if (e.target.classList.contains("step-text")) steps[i].text = e.target.value;
});
$("ed-steps").addEventListener("change", (e) => {
  const i = Number(e.target.dataset.i);
  if (e.target.type === "checkbox") {
    steps[i].done = e.target.checked;
    $("ed-steps-count").textContent = `${steps.filter((s) => s.done).length} of ${steps.length} done`;
  }
});
$("ed-steps").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-rm]");
  if (!rm) return;
  steps.splice(Number(rm.dataset.rm), 1);
  drawSteps();
});

// Keyboard
const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
function rows() {
  return [...document.querySelectorAll(".view:not([hidden]) li.q")];
}
function focusRow(delta) {
  const all = rows();
  if (!all.length) return;
  const cur = document.activeElement?.closest?.("li.q");
  const i = cur ? all.indexOf(cur) : -1;
  const next = all[Math.max(0, Math.min(all.length - 1, i + delta))] || all[0];
  next.querySelector(".q-open")?.focus();
}
document.addEventListener("keydown", async (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    input.focus();
    input.select();
    return;
  }
  if (document.querySelector("dialog[open]") || typing(e.target) || e.ctrlKey || e.metaKey) return;
  const li = e.target.closest?.("li.q");
  if (li && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const sib = e.key === "ArrowUp" ? li.previousElementSibling : li.nextElementSibling;
    if (!sib || !li.closest("#view-list")) return;
    li.parentElement.insertBefore(li, e.key === "ArrowUp" ? sib : sib.nextSibling);
    li.querySelector(".q-open")?.focus();
    say(`Moved ${e.key === "ArrowUp" ? "up" : "down"}`);
    return saveOrder(li.parentElement);
  }
  if (e.altKey) return;
  const k = e.key;
  if (k === "n" || k === "N") {
    e.preventDefault();
    input.focus();
  } else if (k === "/") {
    e.preventDefault();
    toggleSearch(true);
  } else if (["1", "2", "3", "4"].includes(k)) setView(["focus", "list", "board", "today"][+k - 1]);
  else if (k === "c" || k === "C") $("calm-btn").click();
  else if (k === "?") $("keys").showModal();
  else if (k === "j" || k === "ArrowDown") {
    if (k === "ArrowDown" && !li) return;
    e.preventDefault();
    focusRow(1);
  } else if (k === "k" || k === "ArrowUp") {
    if (k === "ArrowUp" && !li) return;
    e.preventDefault();
    focusRow(-1);
  } else if (li && (k === "x" || k === " ")) {
    e.preventDefault();
    toggleDone(li.dataset.id);
  } else if (li && k === "e") openEditor(byId(li.dataset.id));
  else if (li && (k === "Delete" || k === "Backspace")) {
    e.preventDefault();
    remove(li.dataset.id);
  }
});

// The time words ("Today 15:00") move on by themselves
setInterval(() => state && !document.querySelector("dialog[open]") && !document.querySelector(".dragging") && render(), 60_000);

load().then(live);
