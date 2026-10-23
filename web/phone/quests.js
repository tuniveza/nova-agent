// Nova Phone: Quests, the same quests as everywhere in Nova (kept by Nova Agent on the studio's PC).
//   Today   today and the next days, by the hour, the pulses, and what still needs a time
//   Focus   the one thing to do now, then what's after it ("Not now" moves on to the next)
//   List    Now, Overdue, Today, Coming up, Any time, Done (and Skipped); Reorder moves them up and down
//   Board   by how they're going: Waiting, Soon, Working on it, Nearly finished, Taking longer, Questions, Done
// Add one in everyday words ("tomorrow 3pm call Sam !high #studio 30m", Quests' own reading: lib/parse.js) or
// with every detail; search, or tap a #tag; open one to tick its steps, change how it's going, start it, snooze
// it, pick which phones get its reminders, change or delete it (with Undo). Options: Calm, Celebrations, Phone
// reminders, Show done, Opens in, Everyone's, Re-plan from now. Live while it's on screen (/quests/events).
// Nova Agent's computer off: the last copy Portal has (/app/api/quests), and taps sent for when it's back.
import { parseQuick, dayWords, ukNow } from "./lib/parse.js";
import { BOARD_MODES, columns, days, focusList, matches, sections, streak, tagsInUse, todayStamp } from "./lib/sort.js";

const N = window.NovaPhone;
const { esc, icon, row, list, field, choices, empty, api, post, toast, choose, busy } = N;
const HDR = { "X-Nova-Visualizer": "1" };
const act = (path, body) => post(path, body, HDR).then((r) => { if (r && r.ok === false) throw new Error(r.message || "That didn't work."); return r && r.result !== undefined ? r.result : r; });
const MODES = [["waiting", "Waiting"], ["soon", "Soon"], ["working", "Working on it"], ["nearly", "Nearly finished"], ["longer", "Taking longer than expected"], ["questions", "Questions"], ["done", "Done"]];
const MODE = Object.fromEntries(MODES);
const SHORT_MODE = { ...MODE, longer: "Taking longer" };
const PRIORITY = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["critical", "Critical"]];
const PRI = { critical: "Critical", high: "High", low: "Low" };
const GROUPS = [["now", "Now"], ["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Coming up"], ["anytime", "Any time"], ["done", "Done"]];
const VIEWS = [["today", "Today"], ["focus", "Focus"], ["list", "List"], ["board", "Board"]];
const LENGTHS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240];
const LENGTH_WORDS = { 60: "1 hour", 90: "1½ hours", 120: "2 hours", 180: "3 hours", 240: "4 hours" };
const OFFLINE_OK = ["done", "finish", "start", "skip", "reopen", "snooze", "mode"]; // what Portal's copy can pass on
const UP = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
const DOWN = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

// ---- What's kept on this phone ----
const KEY = "nova-phone/quests";
const DEFAULTS = { start: "today", who: "mine", showDone: true, calm: false, celebrate: true, doneOpen: false };
const prefs = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { return { ...DEFAULTS }; } })();
if (!VIEWS.some(([v]) => v === prefs.start)) prefs.start = "today";
const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };

// ---- The quests: from Nova Agent, or (its computer off) Portal's last copy ----
let state = null, offline = false, copyAt = 0, loadedAt = 0;
async function load() {
  const who = prefs.who === "everyone" ? "?who=everyone" : "";
  try {
    state = await api(`/quests/state${who}`);
    offline = false;
    loadedAt = Date.now();
  } catch (err) {
    if (err.signIn) throw err;
    if (!(err.status === 503 || err.status === 502 || err.data?.pcOffline)) throw err;
    offline = true;
    try {
      const c = await api(`/app/api/quests${who}`);
      state = c && c.state ? { ...c.state, canSeeEveryone: c.canSeeEveryone, scope: c.scope, person: { id: c.me } } : null;
      copyAt = c && c.at ? Date.parse(c.at) : 0;
    } catch (e) { if (e.signIn) throw e; state = null; }
  }
  if (state) N.badge("quests", (state.quests || []).filter((q) => (q.status === "todo" || q.status === "doing") && String(q.start || "").startsWith(todayStamp().slice(0, 10))).length);
}
// A tap: to Nova Agent, or (its computer off) to Portal, which hands it over when it's back
async function send(q, action, extra = {}) {
  if (offline) {
    if (!OFFLINE_OK.includes(action)) throw new Error("That waits until Nova Agent's computer is back on.");
    await post("/app/api/quests/action", { id: q.id, action, kind: "quest", ...extra, ...(action === "done" && q.ongoing && q.start ? { session: q.start } : {}) });
    toast("Sent: Nova Agent will do it when it's back online");
    return null;
  }
  return act(`/actions/quests/${encodeURIComponent(q.id)}`, { action, ...extra });
}
const change = (q, changes) => act(`/actions/quests/${encodeURIComponent(q.id)}`, { changes });

// ---- Where we are on the screen ----
let view = prefs.start, lastView = "", focusSkip = 0, query = "", tag = "", searchOpen = false, reorder = false, cur = null;
const hidden = new Set(); // deleted, waiting for Undo
const pending = new Map(); // id → timer (deletes not sent yet)
const quests = () => (state?.quests || []).filter((q) => q.status !== "removed" && !hidden.has(q.id));
const shown = () => quests().filter((q) => matches(q, query) && (!tag || (q.tags || []).includes(tag)));
const byId = (id) => (state?.quests || []).find((q) => q.id === id) || (state?.pulses || []).find((q) => q.id === id);
const modeOf = (q) => (q.status === "done" ? "done" : BOARD_MODES.includes(q.mode) ? q.mode : q.status === "doing" ? "working" : "waiting");
const isOpen = (q) => q.status === "todo" || q.status === "doing";

// ---- Words ----
function when(stamp) {
  if (!stamp) return "";
  const [d, t] = stamp.split("T");
  const [y, m, dd] = d.split("-").map(Number);
  return `${dayWords({ y, m, d: dd, dow: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() }, ukNow())}${t ? ` ${t.slice(0, 5)}` : ""}`;
}
const hm = (s) => (s ? s.slice(11, 16) : "");
const mins = (n) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${Math.round(n % 60)} min` : ""}` : n >= 1 ? `${Math.round(n)} min` : `${Math.round(n * 60)} s`);
const lengthWords = (n) => LENGTH_WORDS[n] || mins(n);
function repeatWords(q) {
  if (!q.ongoing) return "";
  if (q.every === "interval") return `every ${mins(q.everyMinutes)}`;
  return q.every === "day" ? "every day" : q.every === "weekday" ? "weekdays" : "every week";
}
const cap = (s) => String(s || "").replace(/^./, (c) => c.toUpperCase());
const missionOf = (q) => (q.missionId ? (state?.missions || []).find((m) => m.id === q.missionId) : null);
const whose = (q) => (state?.scope === "everyone" && q.ownerName && q.owner !== state?.person?.id ? q.ownerName : "");
const leave = (q) => (q.location && q.travelMinutes && q.travelStart ? ` (leave ${hm(q.travelStart)})` : "");
const dayName = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  const words = dayWords({ y, m, d: dd, dow: new Date(Date.UTC(y, m - 1, dd)).getUTCDay() }, ukNow());
  const long = new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return words === "Today" || words === "Tomorrow" ? `${words} · ${long}` : long;
};
function sinceWords(at) {
  if (!at) return "";
  const n = Math.round((Date.now() - at) / 60000);
  return n < 1 ? "just now" : n < 60 ? `${n} min ago` : n < 1440 ? `${Math.round(n / 60)} h ago` : N.ago(at);
}

// A quest's details in a line: when, by when, at risk, priority, repeats, how long, steps, where, from, mission, whose
function meta(q, { short = false, noWhen = false, pulse = false } = {}) {
  const b = [];
  if (pulse) {
    // (a pulse: how long each beat, how often, until when)
    if (q.minutes) b.push(["", mins(q.minutes)]);
    b.push(["", `∞ ${repeatWords(q)}`]);
    if (q.deadline) b.push(["", `until ${hm(q.deadline)}`]);
    return b.map(([cls, words]) => `<span class="quests-m${cls ? ` ${cls}` : ""}">${esc(words)}</span>`).join("");
  }
  const t = noWhen ? "" : q.start || q.fixedStart;
  // (Today: a late one carried over from an earlier day says from when)
  if (noWhen && isOpen(q) && (q.start || q.fixedStart) && (q.start || q.fixedStart).slice(0, 10) < todayStamp().slice(0, 10)) b.push(["late", `late, from ${when(q.start || q.fixedStart)}`]);
  if (t) b.push(["", `${when(t)}${q.end && q.start ? `–${hm(q.end)}` : ""}`]);
  else if (!noWhen && q.timeOfDay && q.timeOfDay !== "any") b.push(["", cap(q.timeOfDay)]);
  if (q.deadline && !short) b.push([isOpen(q) && q.deadline < todayStamp() ? "late" : "", `by ${when(q.deadline)}`]);
  if (q.atRisk && q.deadline && isOpen(q)) b.push(["risk", "won't fit before its deadline"]);
  if (PRI[q.priority]) b.push([`p-${q.priority}`, PRI[q.priority]]);
  if (q.ongoing) b.push(["", `∞ ${repeatWords(q)}`]);
  if (!short && q.minutes && !q.ongoing) b.push(["", mins(q.minutes)]);
  if (q.steps?.length) b.push(["", `${q.steps.filter((s) => s.done).length}/${q.steps.length} steps`]);
  if (!short && q.location) b.push(["", `at ${q.location}${leave(q)}`]);
  if (!short && q.from) b.push(["", `✎ ${q.from}`]);
  const m = !short && missionOf(q);
  if (m) b.push(["", `◆ ${m.title}`]);
  if (whose(q)) b.push(["", whose(q)]);
  return b.map(([cls, words]) => `<span class="quests-m${cls ? ` ${cls}` : ""}">${esc(words)}</span>`).join("");
}
const modeChip = (q) => `<button type="button" class="quests-chip" data-mode-of="${esc(q.id)}" data-qm="${modeOf(q)}" aria-label="How it's going: ${esc(MODE[modeOf(q)])}. Change it">${esc(SHORT_MODE[modeOf(q)])}</button>`;

// One quest as a row: its tick, its title and details (a tap opens it), how it's going and its tags under them
function qRow(q, { noWhen = false, card = false, time = "", now = false, moves = false, pulse = false } = {}) {
  const done = q.status === "done";
  const m = meta(q, { short: card, noWhen, pulse });
  const tags = card ? "" : (q.tags || []).map((t) => `<button type="button" class="quests-tag" data-tag="${esc(t)}" aria-label="Show only #${esc(t)}">#${esc(t)}</button>`).join("");
  const extras = pulse
    ? `<button type="button" class="quests-chip" data-pulse="done" data-qm="working">Session done</button><button type="button" class="quests-chip" data-pulse="finish" data-qm="longer">Stop</button>`
    : `${moves ? `<button type="button" class="quests-move" data-move="-1" aria-label="Move up: ${esc(q.title)}">${UP}</button><button type="button" class="quests-move" data-move="1" aria-label="Move down: ${esc(q.title)}">${DOWN}</button>` : ""}${!done || card ? modeChip(q) : ""}${tags}`;
  return `<li class="quests-q${time ? " timed" : ""}${done ? " done" : ""}${q.status === "doing" ? " doing" : ""}${now ? " is-now" : ""}" data-id="${esc(q.id)}" data-qm="${modeOf(q)}">
    ${time ? `<span class="quests-time">${time}${now ? `<small class="quests-nowword">now</small>` : ""}</span>` : ""}
    <button type="button" class="quests-tick" data-tick aria-pressed="${done}" aria-label="${esc(done ? `Not done yet: ${q.title}` : `${q.ongoing ? "Session done" : "Done"}: ${q.title}`)}">${icon("check")}</button>
    <a class="quests-open" href="#quests/quest/${encodeURIComponent(q.id)}"><b>${pulse ? "∞ " : ""}${esc(q.title)}</b>${m ? `<span class="quests-meta">${m}</span>` : ""}</a>
    ${extras ? `<div class="quests-extras">${extras}</div>` : ""}
  </li>`;
}

// ---- The main screen ----
N.section({
  id: "quests",
  name: "Quests",
  tile: "quests",
  async draw(box, [part, a], ui) {
    await N.css("quests.css");
    await load();
    cur = { box };
    live();
    if (part === "quest") return drawQuest(box, a, ui);
    if (part === "new") return drawForm(box, null, ui);
    if (part === "edit") {
      const q = quests().find((x) => x.id === a);
      if (q || offline) return drawForm(box, q, ui);
      ui.back("#quests");
      box.innerHTML = empty({ icon: "quests", title: "That quest isn't there any more", action: `<a class="btn" href="#quests">All quests</a>` });
      return;
    }
    view = part === "hours" ? "today" : VIEWS.some(([v]) => v === part) ? part : prefs.start;
    if (view !== lastView) { focusSkip = 0; lastView = view; }
    if (view !== "list") reorder = false;
    if (!offline) ui.action({ icon: "plus", label: "New quest", href: "#quests/new" });
    if (offline && !state) { box.innerHTML = `<div class="empty">${icon("globe")}<b>Nova Agent's computer is off</b><span>Quests live on the studio's computer. They're safe; they'll be back when it is.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`; return; }
    const s = streak(quests());
    const offCard = offline ? `<div class="card quests-off"><p class="kicker">○ Nova Agent is offline${copyAt ? ` · updated ${esc(sinceWords(copyAt))}` : ""}</p><p class="muted small">This is the last plan it sent. Ticks, starts and how it's going are sent now and done when it's back; adding and changing quests wait until then.</p><button type="button" class="btn wide" data-again>${icon("refresh")} Try again</button></div>` : "";
    const views = `<nav class="seg quests-views" aria-label="Views">${VIEWS.map(([v, l]) => `<a class="seg-a" href="#quests/${v}" aria-selected="${v === view}">${l}</a>`).join("")}</nav>`;
    const quick = offline ? "" : `<form class="quests-quick" id="quests-quick" autocomplete="off"><label class="field"><span class="sr">Add a quest</span><input class="input" name="q" enterkeyhint="go" placeholder="Add: tomorrow 3pm call Sam"></label><p class="form-said" id="quests-said" role="status"></p><div class="btns two" hidden data-quick-btns><button type="submit" class="btn main">${icon("plus")} Add</button><button type="button" class="btn" data-details>Add with details</button></div></form>`;
    const bar = `<div class="chips quests-bar"><button type="button" class="chip" data-find aria-pressed="${searchOpen}">${icon("search")} Search</button><button type="button" class="chip" data-options>${icon("cog")} Options</button>${view === "list" && !offline ? `<button type="button" class="chip" data-reorder aria-pressed="${reorder}">${reorder ? "Done moving" : "Reorder"}</button>` : ""}${state.canSeeEveryone ? `<button type="button" class="chip" data-who="mine" aria-pressed="${prefs.who === "mine"}">Mine</button><button type="button" class="chip" data-who="everyone" aria-pressed="${prefs.who === "everyone"}">Everyone's</button>` : ""}${!prefs.calm && s.days >= 2 ? `<span class="quests-streak">✦ ${s.days} days in a row${s.doneToday ? "" : " · do one today to keep it going"}</span>` : ""}</div>`;
    const find = `<label class="field quests-find"${searchOpen ? "" : " hidden"}><span class="sr">Search quests</span><input class="input" type="search" name="find" value="${esc(query)}" enterkeyhint="search" placeholder="Search: words, or #tag"></label>`;
    const sync = offline ? "" : `<p class="quests-sync">● Nova Agent is online · updated ${esc(sinceWords(loadedAt))}</p>`;
    box.innerHTML = `${offCard}${views}${quick}${bar}${find}<div class="quests-body"></div>${sync}`;
    renderBody();
    wireMain(box);
  },
});

// What's under the bar: the tags, the view, its footer (drawn again by itself on search, tags, Calm, Not now)
function renderBody() {
  const body = cur?.box.querySelector(".quests-body");
  if (!body) return;
  const tags = tagsInUse(quests());
  const tagRow = prefs.calm || (!tags.length && !tag) || view === "focus" ? "" : `<div class="chips quests-tags"><button type="button" class="chip" data-filter="" aria-pressed="${!tag}">All</button>${[...new Set([...(tag ? [tag] : []), ...tags])].slice(0, 12).map((t) => `<button type="button" class="chip" data-filter="${esc(t)}" aria-pressed="${t === tag}">#${esc(t)}</button>`).join("")}</div>`;
  const html = view === "focus" ? focusView() : view === "board" ? boardView() : view === "list" ? listView() : todayView();
  body.innerHTML = `${tagRow}${html}`;
}
function nothing() {
  if (query || tag) return `<div class="empty">${icon("search")}<b>Nothing matches${query ? ` “${esc(query)}”` : ""}${tag ? ` #${esc(tag)}` : ""}</b><button type="button" class="btn" data-clear>Show everything</button></div>`;
  return empty({ icon: "quests", title: "No quests yet", text: offline ? "Nova Agent hasn't sent any." : "Write one in the box above, the way you'd say it. Try “tomorrow 10am send invoices 30m !high”." });
}
function listView() {
  const g = sections(shown());
  const cap = prefs.calm ? 5 : 200;
  const skipped = prefs.showDone ? shown().filter((q) => q.status === "skipped") : [];
  const groups = GROUPS.filter(([k]) => g[k].length && (k !== "done" || prefs.showDone));
  if (!groups.length && !skipped.length) return nothing();
  return groups.map(([k, name]) => {
    const all = g[k], more = all.length > cap ? all.length - cap : 0;
    if (k === "done") {
      const open = prefs.doneOpen;
      return `<h3 class="h quests-h"><button type="button" class="quests-fold" data-fold aria-expanded="${open}">Done · ${all.length}<span aria-hidden="true">${open ? "▴" : "▾"}</span></button></h3>${open ? `<ul class="quests-list">${all.slice(0, cap).map((q) => qRow(q)).join("")}</ul>${more ? `<p class="quests-more">${more} more. Turn Calm off to see them all.</p>` : ""}` : ""}`;
    }
    return `<h3 class="h quests-h">${name} · ${all.length}</h3><ul class="quests-list" data-group="${k}">${all.slice(0, cap).map((q) => qRow(q, { moves: reorder })).join("")}</ul>${more ? `<p class="quests-more">${more} more. Turn Calm off to see them all.</p>` : ""}`;
  }).join("")
    + (skipped.length ? `<h3 class="h quests-h">Skipped · ${skipped.length}</h3><ul class="quests-list">${skipped.slice(0, 20).map((q) => qRow(q)).join("")}</ul>` : "")
    + `<button type="button" class="btn quiet wide" data-show-done>${prefs.showDone ? "Hide done" : "Show done"}</button>`;
}
function focusView() {
  const f = focusList(shown());
  if (!f.length) return query || tag ? nothing() : empty({ icon: "check", title: "Nothing to do right now ✦", text: offline ? "" : "Enjoy it, or add something above." });
  const i = focusSkip % f.length, q = f[i];
  const after = [...f.slice(i + 1), ...f.slice(0, i)].slice(0, prefs.calm ? 1 : 3);
  const m = meta(q);
  return `<article class="card edge-card quests-focus" data-id="${esc(q.id)}" data-qm="${modeOf(q)}"><p class="kicker">${q.status === "doing" ? "You're on" : i === 0 ? "Do this now" : "Or this one"}</p><h2 class="card-title">${esc(q.title)}</h2>${m ? `<p class="quests-meta">${m}</p>` : ""}
    ${q.steps?.length ? stepsHtml(q) : ""}
    ${q.notes && !prefs.calm ? `<p class="pre quests-notes">${esc(q.notes)}</p>` : ""}
    <div class="btns two"><button type="button" class="btn main" data-focus="done">${icon("check")} ${q.ongoing ? "Session done" : "Done"}</button>${q.status !== "doing" ? `<button type="button" class="btn" data-focus="start">${icon("play")} Start it</button>` : `<button type="button" class="btn" data-focus="snooze">15 more minutes</button>`}${f.length > 1 ? `<button type="button" class="btn" data-focus="next">Not now</button>` : ""}<a class="btn" href="#quests/quest/${encodeURIComponent(q.id)}">Details</a></div></article>
    ${after.length ? `<h3 class="h quests-h">Then</h3><ul class="quests-list">${after.map((x) => qRow(x)).join("")}</ul>` : ""}`;
}
function stepsHtml(q) {
  const done = q.steps.filter((s) => s.done).length;
  return `<div class="quests-steps"><p class="quests-steps-n">${done} of ${q.steps.length} done</p>${q.steps.map((s) => `<label class="quests-step"><input type="checkbox" data-step="${esc(s.id)}" data-qid="${esc(q.id)}"${s.done ? " checked" : ""}${offline ? " disabled" : ""}><span>${esc(s.text)}</span></label>`).join("")}</div>`;
}
function boardView() {
  const cols = columns(shown());
  // (quiet columns stay out of the way: "Taking longer" and "Questions" only when they have something)
  const keep = BOARD_MODES.filter((m) => cols[m].length || ["waiting", "soon", "working", "nearly", "done"].includes(m)).filter((m) => m !== "done" || prefs.showDone);
  if (!shown().length && (query || tag)) return nothing();
  return `<p class="quests-hint">Tap a quest's chip to move it to another column.</p>` + keep.map((m) => `<h3 class="h quests-h quests-col" data-qm="${m}">${SHORT_MODE[m]} · ${cols[m].length}</h3>${cols[m].length ? `<ul class="quests-list">${cols[m].map((q) => qRow(q, { card: true })).join("")}</ul>` : `<p class="quests-free">None here yet.</p>`}`).join("");
}
function todayView() {
  const pulses = prefs.calm ? [] : (state.pulses || []).filter((q) => !hidden.has(q.id) && isOpen(q) && matches(q, query) && (!tag || (q.tags || []).includes(tag)));
  const pulseIds = new Set(pulses.map((q) => q.id));
  const { list: dayList, unplaced: all } = days(shown());
  const unplaced = all.filter((q) => !pulseIds.has(q.id));
  const now = todayStamp();
  const out = [];
  if (pulses.length) out.push(`<h3 class="h quests-h">Pulses · ${pulses.length}</h3><ul class="quests-list">${pulses.map((q) => qRow(q, { pulse: true })).join("")}</ul>`);
  for (const [n, { day, quests: qs }] of dayList.slice(0, prefs.calm ? 1 : 8).entries()) {
    out.push(`<h3 class="h quests-h">${esc(dayName(day))}</h3>`);
    out.push(qs.length ? `<ul class="quests-list">${qs.map((q) => { const s = q.start || q.fixedStart; const on = q.start && q.start <= now && q.end > now; return qRow(q, { noWhen: true, now: on, time: `${esc(s.slice(11, 16))}${q.end ? `<small>${esc(q.end.slice(11, 16))}</small>` : ""}` }); }).join("")}</ul>` : `<p class="quests-free">Nothing planned.${n === 0 ? " A calm day so far." : ""}</p>`);
  }
  if (unplaced.length && !prefs.calm) out.push(`<h3 class="h quests-h">Not given a time yet · ${unplaced.length}</h3><p class="quests-free">Nova plans these into free time by itself.</p>${offline ? "" : `<button type="button" class="btn wide" data-replan>${icon("refresh")} Plan them now</button>`}<ul class="quests-list">${unplaced.map((q) => qRow(q)).join("")}</ul>`);
  return out.join("");
}

// ---- The main screen's taps ----
function wireMain(box) {
  const f = box.querySelector("#quests-quick");
  if (f) {
    const said = f.querySelector("#quests-said"), btns = f.querySelector("[data-quick-btns]");
    f.elements.q.addEventListener("input", () => {
      const v = f.elements.q.value.trim();
      const p = v ? parseQuick(v) : { title: "", bits: [] };
      said.classList.remove("bad");
      said.textContent = v ? [p.title ? `“${p.title}”` : "…", ...(p.bits || [])].join(" · ") : "";
      btns.hidden = !v;
    });
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const v = f.elements.q.value.trim();
      if (!v) return f.elements.q.focus();
      const { title, fields } = parseQuick(v);
      if (!title) { said.textContent = "Say what the quest is, too."; said.classList.add("bad"); return; }
      await busy(f.querySelector("[type=submit]"), "Adding…", async () => {
        try { await act("/actions/quests", { title, ...fields }); f.elements.q.value = ""; said.textContent = ""; btns.hidden = true; f.classList.remove("dirty"); toast(`Added ${title}`); refresh(true); }
        catch (err) { said.textContent = `Not added: ${err.message}`; said.classList.add("bad"); }
      });
    });
    f.querySelector("[data-details]").addEventListener("click", () => {
      const v = f.elements.q.value.trim();
      const { title, fields } = v ? parseQuick(v) : { title: "", fields: {} };
      preset = { title, ...fields };
      f.classList.remove("dirty");
      location.hash = "#quests/new";
    });
  }
  const find = box.querySelector(".quests-find input");
  find.addEventListener("input", () => { query = find.value; focusSkip = 0; renderBody(); });
  box.addEventListener("click", (ev) => mainTap(ev, box));
  box.addEventListener("change", stepTick);
}
async function mainTap(ev, box) {
  const t = ev.target;
  const li = t.closest(".quests-q");
  const qOf = () => byId(li?.dataset.id || t.closest("[data-id]")?.dataset.id);
  if (t.closest("[data-tick]") && li) return toggleDone(li.dataset.id);
  const chip = t.closest("[data-mode-of]");
  if (chip) { const q = byId(chip.dataset.modeOf); const m = q && (await choose({ title: `How's “${q.title}” going?`, options: MODES.map(([v, l]) => [v, v === modeOf(q) ? `${l} ✓` : l]) })); if (m) setMode(q.id, m); return; }
  const pulse = t.closest("[data-pulse]");
  if (pulse && li) { const q = qOf(); if (q) await doAct(pulse, q, pulse.dataset.pulse); return; }
  const tg = t.closest("[data-tag]");
  if (tg) { tag = tg.dataset.tag; renderBody(); box.querySelector(".quests-body")?.scrollIntoView({ block: "start" }); return; }
  const filter = t.closest("[data-filter]");
  if (filter) { tag = filter.dataset.filter; return renderBody(); }
  if (t.closest("[data-clear]")) { query = tag = ""; const fi = box.querySelector(".quests-find input"); if (fi) fi.value = ""; return renderBody(); }
  if (t.closest("[data-fold]")) { prefs.doneOpen = !prefs.doneOpen; savePrefs(); return renderBody(); }
  if (t.closest("[data-show-done]")) { prefs.showDone = !prefs.showDone; savePrefs(); return renderBody(); }
  const rp = t.closest("[data-replan]");
  if (rp) return busy(rp, "Planning…", async () => { try { await act("/actions/replan", {}); toast("Planned ✦"); refresh(true); } catch (err) { toast(err.message, true); } });
  const mv = t.closest("[data-move]");
  if (mv && li) return move(li, Number(mv.dataset.move));
  const fb = t.closest("[data-focus]");
  if (fb) {
    const q = qOf();
    if (!q) return;
    const what = fb.dataset.focus;
    if (what === "done") return toggleDone(q.id);
    if (what === "next") { focusSkip++; return renderBody(); }
    return doAct(fb, q, what === "snooze" ? "snooze" : "start", what === "snooze" ? { minutes: 15 } : {});
  }
  const w = t.closest("[data-who]");
  if (w) { if (prefs.who !== w.dataset.who) { prefs.who = w.dataset.who; savePrefs(); refresh(true); } return; }
  if (t.closest("[data-find]")) {
    searchOpen = !searchOpen;
    const lab = box.querySelector(".quests-find");
    lab.hidden = !searchOpen;
    t.closest("[data-find]").setAttribute("aria-pressed", String(searchOpen));
    if (searchOpen) lab.querySelector("input").focus();
    else if (query) { query = ""; lab.querySelector("input").value = ""; renderBody(); }
    return;
  }
  if (t.closest("[data-reorder]")) { reorder = !reorder; const b = t.closest("[data-reorder]"); b.setAttribute("aria-pressed", String(reorder)); b.textContent = reorder ? "Done moving" : "Reorder"; if (reorder) toast("Move them with the arrows"); return renderBody(); }
  if (t.closest("[data-options]")) return options();
}
// A button that does one thing to a quest, then the plan again
async function doAct(btn, q, action, extra = {}) {
  await busy(btn, "…", async () => {
    try {
      await send(q, action, extra);
      if (action === "finish") undo(`Stopped “${q.title}”`, "Undo", () => doAct(document.createElement("button"), q, "reopen"));
      else if (action === "start") toast(`Started ${q.title}`);
      else if (action === "snooze") toast(`${q.title}: ${extra.minutes === 60 ? "an hour" : `${extra.minutes} more minutes`}`);
      else if (action === "skip") undo(`Skipped “${q.title}”`, "Undo", () => doAct(document.createElement("button"), q, "reopen"));
      else if (action === "done") cheer(q);
      refresh(true);
    } catch (err) { toast(err.message, true); }
  });
}

// Ticked or not, shown straight away (put right by the plan coming back)
async function toggleDone(id) {
  const q = byId(id);
  if (!q) return;
  const wasDone = q.status === "done";
  const before = { status: q.status, completed: q.completed };
  q.status = wasDone ? "todo" : "done";
  if (!wasDone) q.completed = new Date().toISOString();
  renderBody();
  try {
    await send(q, wasDone ? "reopen" : "done");
    if (!wasDone) cheer(q);
  } catch (err) { Object.assign(q, before); renderBody(); toast(err.message, true); }
  refresh(true);
}
// A small, quiet well done (Options → Celebrations), with Undo
function cheer(q) {
  if (!prefs.celebrate) return;
  const today = new Date().toDateString();
  const doneToday = quests().filter((x) => x.status === "done" && x.completed && new Date(x.completed).toDateString() === today).length;
  const s = streak(quests());
  const words = q.ongoing ? "Session done. The next one's lined up." : doneToday >= 5 ? `${doneToday} done today. That's a lot. Have a breather.` : doneToday > 1 ? `Done. ${doneToday} today.` : s.days > 1 ? `Done. ${s.days} days in a row.` : "Done. Nice one.";
  undo(`✦ ${words}`, q.ongoing ? "" : "Undo", () => toggleDone(q.id));
  const el = cur?.box.querySelector(`[data-id="${CSS.escape(q.id)}"]`);
  if (el && !prefs.calm) { el.classList.add("quests-glow"); setTimeout(() => el.classList.remove("quests-glow"), 1200); }
}
async function setMode(id, mode) {
  const q = byId(id);
  if (!q || !mode || (modeOf(q) === mode)) return;
  const before = { mode: q.mode, status: q.status };
  q.mode = mode;
  if (mode === "done") q.status = "done";
  renderBody();
  try {
    if (mode === "done") { await send(q, "done"); cheer(q); }
    else { if (before.status === "done") await send(q, "reopen"); await send(q, "mode", { mode }); toast(`${q.title}: ${MODE[mode]}`); }
  } catch (err) { Object.assign(q, before); renderBody(); toast(err.message, true); }
  refresh(true);
}
// Reorder (List): a quest up or down within its group, kept as the person's own order
async function move(li, by) {
  const ul = li.parentElement;
  const sib = by < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!sib) return toast(by < 0 ? "It's at the top already" : "It's at the bottom already");
  ul.insertBefore(li, by < 0 ? sib : sib.nextSibling);
  li.querySelector(`[data-move="${by}"]`)?.focus();
  const ids = [...ul.children].map((x) => x.dataset.id);
  ids.forEach((id, i) => { const q = byId(id); if (q) q.order = i + 1; });
  try { await act("/actions/quests/order", { ids }); refresh(); } catch (err) { toast(err.message, true); refresh(true); }
}
// Ticking a step saves straight away; every step done: tick the quest off?
async function stepTick(ev) {
  const s = ev.target.closest("[data-step]");
  if (!s) return;
  const q = byId(s.dataset.qid);
  if (!q) return;
  const steps = q.steps.map((x) => (x.id === s.dataset.step ? { ...x, done: s.checked } : x));
  try {
    await change(q, { steps });
    q.steps = steps;
    const n = s.closest(".quests-steps")?.querySelector(".quests-steps-n");
    if (n) n.textContent = `${steps.filter((x) => x.done).length} of ${steps.length} done`;
    if (steps.every((x) => x.done) && prefs.celebrate && q.status !== "done") undo("✦ Every step done. Tick the quest off?", "Tick it off", () => toggleDone(q.id));
    refresh();
  } catch (err) { s.checked = !s.checked; toast(err.message, true); }
}

// ---- Options: one sheet ----
function options() {
  const sw = (k, label, on, small = "") => `<label class="switch"><span>${esc(label)}${small ? `<small class="muted">${esc(small)}</small>` : ""}</span><input type="checkbox" role="switch" data-opt="${k}"${on ? " checked" : ""}></label>`;
  return N.form(`<h2 class="sheet-title">Quests options</h2><div class="form">
      ${sw("calm", "Calm", prefs.calm, "Fewer things on screen: five a group, one day")}
      ${sw("celebrate", "Celebrations", prefs.celebrate, "A little well done when you finish one")}
      ${offline ? "" : sw("phonePush", "Phone reminders", !!state?.rhythm?.phonePush, "Reminders on your phones too")}
      ${sw("showDone", "Show done", prefs.showDone)}
      ${state?.canSeeEveryone ? sw("everyone", "Everyone's quests", prefs.who === "everyone") : ""}
      ${choices({ label: "Opens in", name: "start", value: prefs.start, options: VIEWS })}
      ${offline ? "" : `<button type="button" class="btn wide" data-replan-all>${icon("refresh")} Re-plan from now</button>`}
    </div><button type="button" class="btn main wide" data-close>Done</button>`, (el, done) => {
    el.querySelector("[data-close]").onclick = () => done(true);
    el.addEventListener("change", async (e) => {
      const k = e.target.dataset.opt;
      if (e.target.name === "start") { prefs.start = e.target.value; savePrefs(); return; }
      if (!k) return;
      const on = e.target.checked;
      if (k === "phonePush") {
        e.target.disabled = true;
        try { await act("/actions/rhythm", { phonePush: on }); state.rhythm = { ...(state.rhythm || {}), phonePush: on }; toast(on ? "Reminders go to your phone too (turn on notifications in Inbox → Alerts)." : "Phone reminders off."); }
        catch (err) { e.target.checked = !on; toast(err.message, true); }
        e.target.disabled = false;
        return;
      }
      if (k === "everyone") { prefs.who = on ? "everyone" : "mine"; savePrefs(); return refresh(true); }
      prefs[k] = on;
      savePrefs();
      if (k === "calm") refresh(true); else renderBody();
    });
    const rp = el.querySelector("[data-replan-all]");
    if (rp) rp.onclick = () => busy(rp, "Planning…", async () => { try { await act("/actions/replan", {}); toast("Re-planned from now."); refresh(true); } catch (err) { toast(err.message, true); } });
  });
}

// ---- One quest ----
function drawQuest(box, id, ui) {
  ui.back("#quests");
  const q = byId(id);
  if (!q || hidden.has(id)) { box.innerHTML = empty({ icon: "quests", title: "That quest isn't there any more", action: `<a class="btn" href="#quests">All quests</a>` }); return; }
  ui.title("Quest");
  if (!offline) ui.action({ icon: "edit", label: "Change it", href: `#quests/edit/${encodeURIComponent(id)}` });
  const done = q.status === "done", skipped = q.status === "skipped", m = missionOf(q);
  const kicker = [q.ongoing ? "∞ Quest · repeat" : "✦ Quest", done ? "Done" : skipped ? "Skipped" : MODE[modeOf(q)]].join(" · ");
  const facts = [
    ["Planned for", q.start ? `${when(q.start)}–${hm(q.end)}` : isOpen(q) && !q.fixedStart ? "Not given a time yet" : ""],
    ["Pinned to", q.fixedStart && q.fixedStart !== q.start ? when(q.fixedStart) : ""],
    ["Time of day", q.timeOfDay && q.timeOfDay !== "any" ? cap(q.timeOfDay) : ""],
    ["Finish by", q.deadline ? `${when(q.deadline)}${isOpen(q) && q.deadline < todayStamp() ? " (late)" : ""}` : ""],
    ["How long", q.minutes ? `${mins(q.minutes)}${q.ongoing ? " each time" : ""}` : ""],
    ["Repeats", q.ongoing ? `${cap(repeatWords(q))}${q.sessions ? ` · ${q.sessions} session${q.sessions === 1 ? "" : "s"} done` : ""}` : ""],
    ["Priority", (PRIORITY.find(([p]) => p === q.priority) || [])[1] || ""],
    ["Where", q.location ? `${q.location}${q.travelMinutes ? ` · ${q.travelMinutes} min to get there${q.travelStart ? `, leave at ${hm(q.travelStart)}` : ""}` : ""}` : ""],
    ["From", q.from || ""],
    ["Part of a mission", m ? m.title : q.missionId ? "Yes" : ""],
    ["Whose", whose(q) || (state?.scope === "everyone" ? q.ownerName : "")],
    ["Reminders", state?.rhythm && isOpen(q) ? (state.rhythm.phonePush ? `${state.rhythm.remindMinutesBefore ?? 10} min before, on your phone too` : `${state.rhythm.remindMinutesBefore ?? 10} min before (phone reminders are off: Quests → Options)`) : ""],
  ].filter(([, v]) => v);
  const tags = (q.tags || []).length ? `<div class="quests-extras quests-qtags">${q.tags.map((t) => `<a class="quests-tag" href="#quests/list" data-tag-go="${esc(t)}">#${esc(t)}</a>`).join("")}</div>` : "";
  const b = (a, words, cls = "", extra = "") => `<button type="button" class="btn${cls}" data-qa="${a}"${extra}>${words}</button>`;
  let btns;
  if (done || skipped) btns = b("reopen", "Not done yet", " main");
  else btns = [
    q.status !== "doing" ? b("start", `${icon("play")} Start`, " main") : "",
    b("done", `${icon("check")} ${q.ongoing ? "Session done" : "Done"}`, q.status === "doing" ? " main" : ""),
    b("snooze", "+15 min", "", ' data-min="15"'),
    q.status === "todo" && !q.ongoing ? b("snooze", "In an hour", "", ' data-min="60"') : "",
    q.status === "todo" && !q.ongoing ? b("skip", "Skip it") : "",
    q.ongoing ? b("finish", "Stop repeating") : "",
  ].join("");
  const phones = (q.phones || []).length;
  box.innerHTML = `<article class="card edge-card quests-detail" data-id="${esc(q.id)}" data-qm="${modeOf(q)}"><p class="kicker">${esc(kicker)}</p><h2 class="card-title">${esc(q.title)}</h2>
      ${q.atRisk && isOpen(q) ? `<p class="quests-risk">⚠ Won't fit before its deadline</p>` : ""}
      ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>` : ""}${tags}
      ${q.notes ? `<p class="pre quests-notes">${esc(q.notes)}</p>` : ""}</article>
    ${q.steps?.length ? `<h3 class="h quests-h">Steps</h3><div class="card">${stepsHtml(q)}</div>` : ""}
    <div class="btns two">${btns}</div>
    ${done || skipped ? "" : `<button type="button" class="btn wide quests-modebtn" data-qmode data-qm="${modeOf(q)}">How it's going: ${esc(SHORT_MODE[modeOf(q)])}</button>`}
    ${done || skipped || offline ? "" : list([row({ button: "data-phones", icon: "phone", title: "Which phones get its reminders", text: phones ? `${phones} phone${phones === 1 ? "" : "s"} picked` : "The owner's phones" })])}
    ${offline ? "" : `<button type="button" class="btn danger wide" data-del>${icon("trash")} Delete</button>`}`;
  box.addEventListener("change", stepTick);
  box.addEventListener("click", async (ev) => {
    const t = ev.target;
    const tg = t.closest("[data-tag-go]");
    if (tg) { tag = tg.dataset.tagGo; query = ""; return; }
    const a = t.closest("[data-qa]");
    if (a) return doAct(a, q, a.dataset.qa, a.dataset.qa === "snooze" ? { minutes: Number(a.dataset.min) || 15 } : {});
    if (t.closest("[data-qmode]")) { const md = await choose({ title: "How's it going?", options: MODES.map(([v, l]) => [v, v === modeOf(q) ? `${l} ✓` : l]) }); if (md) setMode(q.id, md); return; }
    if (t.closest("[data-phones]")) return pickPhones(q);
    if (t.closest("[data-del]")) { location.hash = "#quests"; remove(q.id); }
  });
}

// Which phones get a quest's reminders: the owner's (none picked), or the ones ticked (Nova Bot's phones with
// notifications on)
async function pickPhones(q) {
  let phones = [];
  try { phones = (await api("/app/api/push/phones")).phones || []; } catch (err) { if (err.signIn) return N.show(); toast(`The phones didn't load: ${err.message}`, true); return; }
  let picked = (q.phones || []).filter((id) => phones.some((p) => p.id === id));
  const before = JSON.stringify([...(q.phones || [])].sort());
  const draw = (el) => {
    el.querySelector("[data-list]").innerHTML = `<label class="switch"><span>Owner's phones<small class="muted">Whoever the quest is for</small></span><input type="checkbox" role="switch" data-ph=""${picked.length ? "" : " checked"}></label>`
      + phones.map((p) => `<label class="switch"><span>${esc(p.name)}${p.who ? `<small class="muted">${esc(p.who)}</small>` : ""}</span><input type="checkbox" role="switch" data-ph="${esc(p.id)}"${picked.includes(p.id) ? " checked" : ""}></label>`).join("");
  };
  const out = await N.form(`<h2 class="sheet-title">Which phones get its reminders</h2><p class="sheet-text">${esc(q.title)}</p><div class="form" data-list></div>
    ${phones.length ? "" : `<p class="sheet-text">No phones have notifications on yet.</p><a class="btn wide" href="#inbox/alert/phone" data-go>${icon("bell")} Turn them on for this phone</a>`}
    <div class="btns"><button type="button" class="btn main wide" data-ok>Done</button><button type="button" class="btn quiet wide" data-no>Cancel</button></div>`, (el, done) => {
    draw(el);
    el.addEventListener("change", (e) => {
      const id = e.target.dataset.ph;
      if (id === undefined) return;
      picked = !id ? [] : picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
      draw(el);
    });
    el.querySelector("[data-ok]").onclick = () => done(picked);
    el.querySelector("[data-no]").onclick = () => done(null);
    const go = el.querySelector("[data-go]");
    if (go) go.onclick = () => done(null);
  });
  if (!out || JSON.stringify([...out].sort()) === before) return;
  try { await change(q, { phones: out }); toast(out.length ? `Its reminders go to ${out.length} phone${out.length === 1 ? "" : "s"}` : "Its reminders go to the owner's phones"); refresh(true); } catch (err) { toast(err.message, true); }
}

// Delete, with Undo for a few seconds before it's sent (sent at once if the app is put away)
function remove(id) {
  const q = byId(id);
  if (!q) return;
  hidden.add(id);
  renderBody();
  pending.set(id, setTimeout(() => sendDelete(id), 6500));
  undo(`Deleted “${q.title}”`, "Undo", () => { clearTimeout(pending.get(id)); pending.delete(id); hidden.delete(id); renderBody(); refresh(true); });
}
async function sendDelete(id, keepalive = false) {
  pending.delete(id);
  try {
    const res = await fetch(`/actions/quests/${encodeURIComponent(id)}`, { method: "POST", credentials: "same-origin", keepalive, headers: { ...HDR, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove" }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `It wasn't deleted (${res.status}).`);
  } catch (err) { hidden.delete(id); if (!keepalive) toast(err.message || "It wasn't deleted.", true); }
  if (!keepalive) refresh(true);
}
function flushDeletes() { for (const [id, timer] of pending) { clearTimeout(timer); sendDelete(id, true); } }
addEventListener("pagehide", flushDeletes);

// A word at the bottom with one button (Undo, Tick it off), for a few seconds
let undoEl = null, undoTimer = 0, undoFn = null;
function undo(text, label, fn, ms = 6500) {
  if (!undoEl) {
    undoEl = Object.assign(document.createElement("div"), { className: "quests-undo", hidden: true });
    undoEl.setAttribute("role", "status");
    undoEl.innerHTML = `<span></span><button type="button" class="quests-undo-btn"></button>`;
    undoEl.querySelector("button").addEventListener("click", () => { const f = undoFn; hideUndo(); if (f) f(); });
    document.body.append(undoEl);
  }
  const t = document.getElementById("toast");
  if (t) t.hidden = true;
  undoEl.querySelector("span").textContent = text;
  const b = undoEl.querySelector("button");
  b.textContent = label || "";
  b.hidden = !label;
  undoEl.classList.toggle("bare", !label);
  undoFn = fn;
  undoEl.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, label ? ms : 3500);
}
function hideUndo() { clearTimeout(undoTimer); undoFn = null; if (undoEl) undoEl.hidden = true; }

// ---- A quest with every detail: new, or changing one ----
let preset = null; // "Add with details": what was typed, read
const stampOf = (v) => (v ? v.slice(0, 16) : "");
function drawForm(box, q, ui) {
  ui.back(q ? `#quests/quest/${encodeURIComponent(q.id)}` : "#quests");
  ui.title(q ? "Change quest" : "New quest");
  if (offline) { box.innerHTML = empty({ icon: "globe", title: "Nova Agent's computer is off", text: "Adding and changing quests waits until it's back on.", action: `<a class="btn" href="#quests">All quests</a>` }); return; }
  const p = q ? null : preset || {};
  preset = null;
  const base = q || { title: p.title || "", minutes: p.minutes || 30, priority: p.priority || "normal", fixedStart: p.fixedStart || "", deadline: p.deadline || "", tags: p.tags || [], steps: [], notes: "", location: "", ongoing: Boolean(p.ongoing), every: p.every || "day", everyMinutes: p.everyMinutes || 30 };
  const minutes = Math.round(base.minutes || 30);
  const lengths = [...new Set([...LENGTHS, minutes])].sort((x, y) => x - y).map((n) => [n, lengthWords(n)]);
  let steps = (base.steps || []).map((s) => ({ ...s }));
  const info = [];
  if (q?.start) info.push(`Planned for ${when(q.start)}–${hm(q.end)}.`);
  if (q?.from) info.push(`From ${q.from}.`);
  if (q?.missionId) info.push(missionOf(q) ? `Part of the mission “${missionOf(q).title}”.` : "Part of a mission.");
  if (state?.rhythm) info.push(state.rhythm.phonePush ? `A reminder comes ${state.rhythm.remindMinutesBefore ?? 10} min before, on your phone too.` : `A reminder comes ${state.rhythm.remindMinutesBefore ?? 10} min before (phone reminders are off: Quests → Options).`);
  box.innerHTML = `<form class="form" id="quests-form" novalidate autocomplete="off">
      ${field({ label: "What", name: "title", value: base.title, required: true, attrs: 'maxlength="140"', placeholder: "Call Sam about the mix" })}
      ${field({ label: "When (optional)", name: "fixedStart", type: "datetime-local", value: stampOf(base.fixedStart), attrs: 'step="60"' })}
      ${field({ label: "Finish by (optional)", name: "deadline", type: "datetime-local", value: stampOf(base.deadline), attrs: 'step="60"' })}
      ${field({ label: "How long", name: "minutes", type: "select", value: minutes, options: lengths })}
      ${field({ label: "Repeats", name: "repeat", type: "select", value: base.ongoing ? base.every : "", options: [["", "No"], ["day", "Every day"], ["weekday", "Weekdays"], ["week", "Every week"], ["interval", "Every few minutes…"]] })}
      <div data-every-wrap${base.ongoing && base.every === "interval" ? "" : " hidden"}>${field({ label: "Every how many minutes", name: "everyMinutes", type: "number", value: base.everyMinutes || 30, attrs: 'min="1" max="1440" step="1"', hint: "Under 5 minutes it's a pulse: it rings by itself while you're awake" })}</div>
      ${q ? field({ label: "How it's going", name: "mode", type: "select", value: modeOf(q), options: MODES }) : ""}
      ${choices({ label: "Priority", name: "priority", value: base.priority || "normal", options: PRIORITY })}
      <fieldset class="field quests-editsteps"><legend>Steps <small data-steps-n></small></legend><ul class="quests-elist" data-steps></ul>
        <div class="quests-addstep"><label class="field"><span class="sr">Add a step</span><input class="input" name="newStep" maxlength="200" enterkeyhint="enter" placeholder="Add a step"></label><button type="button" class="btn" data-add-step>${icon("plus")} Add</button></div></fieldset>
      ${field({ label: "Tags (optional)", name: "tags", value: (base.tags || []).join(", "), placeholder: "studio, mix", hint: "Separate them with spaces or commas" })}
      ${field({ label: "Notes (optional)", name: "notes", type: "textarea", rows: 3, value: base.notes || "", attrs: 'maxlength="2000"' })}
      ${field({ label: "Where (optional)", name: "location", value: base.location || "", placeholder: "Anywhere", attrs: 'maxlength="160"' })}
      ${info.length ? `<p class="quests-info">${esc(info.join(" "))}</p>` : ""}
      <p class="form-said" id="quests-form-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${q ? "Save" : "Add quest"}</button>
      ${q ? `<button class="btn danger wide" type="button" data-del>${icon("trash")} Delete</button>` : ""}</form>`;
  const f = box.querySelector("#quests-form"), x = f.elements, said = f.querySelector("#quests-form-said");
  const stepsEl = f.querySelector("[data-steps]"), stepsN = f.querySelector("[data-steps-n]");
  const count = () => (stepsN.textContent = steps.length ? `${steps.filter((s) => s.done).length} of ${steps.length} done` : "");
  const drawSteps = () => {
    stepsEl.innerHTML = steps.map((s, i) => `<li class="quests-estep"><label class="quests-step quests-stepbox"><input type="checkbox" data-i="${i}"${s.done ? " checked" : ""}><span class="sr">Done: step ${i + 1}</span></label><input class="input" data-text="${i}" value="${esc(s.text)}" maxlength="200" aria-label="Step ${i + 1}"><button type="button" class="quests-move" data-rm="${i}" aria-label="Remove step ${i + 1}">${icon("trash")}</button></li>`).join("");
    count();
  };
  drawSteps();
  const addStep = () => {
    const text = x.newStep.value.trim();
    if (!text) return x.newStep.focus();
    if (steps.length >= 30) return toast("That's plenty of steps (30 at most).", true);
    steps.push({ id: Math.random().toString(36).slice(2, 10), text, done: false });
    x.newStep.value = "";
    drawSteps();
    x.newStep.focus();
  };
  f.querySelector("[data-add-step]").addEventListener("click", addStep);
  x.newStep.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } });
  stepsEl.addEventListener("input", (e) => { if (e.target.dataset.text !== undefined) steps[Number(e.target.dataset.text)].text = e.target.value; });
  stepsEl.addEventListener("change", (e) => { if (e.target.type === "checkbox") { steps[Number(e.target.dataset.i)].done = e.target.checked; count(); } });
  stepsEl.addEventListener("click", (e) => { const rm = e.target.closest("[data-rm]"); if (rm) { steps.splice(Number(rm.dataset.rm), 1); drawSteps(); } });
  x.repeat.addEventListener("change", () => (f.querySelector("[data-every-wrap]").hidden = x.repeat.value !== "interval"));
  f.querySelector("[data-del]")?.addEventListener("click", () => { f.classList.remove("dirty"); location.hash = "#quests"; remove(q.id); });
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    said.classList.add("bad");
    const title = x.title.value.trim();
    if (!title) { said.textContent = "Give it a name first."; return x.title.focus(); }
    const tags = x.tags.value.split(/[,\s]+/).map((t) => t.replace(/^#+/, "").trim().toLowerCase()).filter(Boolean);
    if (tags.length > 10) { said.textContent = `Ten tags at most (there are ${tags.length}).`; return x.tags.focus(); }
    const long = tags.find((t) => t.length > 24);
    if (long) { said.textContent = `A tag can be 24 letters at most: “${long}”.`; return x.tags.focus(); }
    const repeat = x.repeat.value;
    const out = { title, fixedStart: stampOf(x.fixedStart.value), deadline: stampOf(x.deadline.value), minutes: Number(x.minutes.value), ongoing: Boolean(repeat), priority: x.priority.value || "normal", steps: steps.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() })), tags: [...new Set(tags)], notes: x.notes.value, location: x.location.value.trim() };
    if (repeat) out.every = repeat;
    if (repeat === "interval") {
      const every = Number(x.everyMinutes.value);
      if (!(every >= 1 && every <= 1440)) { said.textContent = "Every how many minutes: 1 to 1440."; return x.everyMinutes.focus(); }
      out.everyMinutes = every;
    }
    await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
      try {
        if (!q) {
          // (what was typed and the form doesn't show, kept: "tomorrow" is "not before tomorrow", "afternoon")
          await act("/actions/quests", { ...(p.earliest && { earliest: p.earliest }), ...(p.timeOfDay && { timeOfDay: p.timeOfDay }), ...out });
          f.classList.remove("dirty");
          toast(`Added ${title}`);
          location.hash = "#quests";
          return;
        }
        // Only what changed (the server refuses nothing it doesn't need to)
        const changes = {};
        for (const [k, v] of Object.entries(out)) {
          const was = k === "fixedStart" || k === "deadline" ? stampOf(q[k]) : q[k];
          if (JSON.stringify(was ?? (Array.isArray(v) ? [] : "")) !== JSON.stringify(v)) changes[k] = v;
        }
        if (x.mode.value !== modeOf(q)) changes.mode = x.mode.value;
        if (Object.keys(changes).length) await change(q, changes);
        f.classList.remove("dirty");
        if (changes.mode === "done") cheer(q); else toast(Object.keys(changes).length ? "Saved" : "Nothing changed");
        location.hash = `#quests/quest/${encodeURIComponent(q.id)}`;
      } catch (err) { said.textContent = `Not saved: ${err.message}`; }
    });
  });
}

// ---- Live: Nova Agent says when anything changed (a reminder, Agent, Notes, another device), only while
// Quests is on screen and the app is in front ----
const onQuests = () => location.hash.startsWith("#quests");
let es = null, esRetry = 0, later = 0, hiddenAt = 0;
function live() {
  if (es || document.hidden || !onQuests() || offline || typeof EventSource !== "function") return;
  try {
    es = new EventSource("/quests/events");
    es.addEventListener("changed", () => refresh());
    es.onerror = () => { stopLive(); clearTimeout(esRetry); esRetry = setTimeout(live, 15000); };
  } catch (e) { es = null; }
}
function stopLive() { if (es) { es.close(); es = null; } clearTimeout(later); }
// The plan again, soon (many changes at once: once). Not while something's being written;
// `mine`: after a tap here (a search box open is fine then)
function refresh(mine = false) {
  clearTimeout(later);
  later = setTimeout(() => {
    if (!onQuests() || document.hidden) return;
    const page = document.getElementById("page");
    if (page?.querySelector("form.dirty") || /^#quests\/(new|edit)/.test(location.hash)) return;
    if (!mine && page?.querySelector("input:focus, textarea:focus")) return;
    N.show();
  }, mine ? 120 : 300);
}
addEventListener("hashchange", () => { if (!onQuests()) { stopLive(); clearTimeout(esRetry); hideUndo(); } });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); stopLive(); clearTimeout(esRetry); flushDeletes(); return; }
  if (!onQuests()) return;
  live();
  // (phone.js draws again itself after a minute away; a shorter while: the plan again here)
  if (hiddenAt && Date.now() - hiddenAt > 2000 && Date.now() - hiddenAt <= 60000) refresh();
});

// For Today: what's on now in Quests
N.quests = { now: async () => { await load(); return state ? focusList(quests()).slice(0, 3) : []; }, row: (q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "quests", title: q.title, text: q.start ? `${hm(q.start)}–${hm(q.end)}` : "" }) };
// (Today can draw before this file is ready on some engines: draw it again with what this file adds)
if (!location.hash || location.hash.startsWith("#today")) N.show();
