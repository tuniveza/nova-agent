// Nova Phone: Quests, the same quests as everywhere in Nova (kept by Nova Agent on the studio's PC).
//   Focus   the one thing to do now, then what's after it
//   List    Now, Overdue, Today, Coming up, Any time, Done
//   Board   by how they're going: Waiting, Soon, Working on it, Nearly finished, Taking longer, Questions, Done
//   Hours   today and the next days, hour by hour, and what still needs a time
// Add one in everyday words ("tomorrow 3pm call Sam !high #studio 30m", Quests' own reading: lib/parse.js) or
// with every detail; open one to tick its steps, change how it's going, start it, snooze it, change or delete it.
import { parseQuick, dayWords, ukNow } from "./lib/parse.js";
import { sections, focusList } from "./lib/sort.js";

const N = window.NovaPhone;
const { esc, icon, row, list, field, toggle, empty, api, post, toast, confirm, choose, busy } = N;
const HDR = { "X-Nova-Visualizer": "1" };
const act = (path, body) => post(path, body, HDR).then((r) => { if (r && r.ok === false) throw new Error(r.message || "That didn't work."); return r && r.result !== undefined ? r.result : r; });
const MODES = [["waiting", "Waiting"], ["soon", "Soon"], ["working", "Working on it"], ["nearly", "Nearly finished"], ["longer", "Taking longer"], ["questions", "Questions"], ["done", "Done"]];
const MODE = Object.fromEntries(MODES);
const PRIORITY = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["critical", "Critical"]];
const GROUPS = [["now", "Now"], ["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Coming up"], ["anytime", "Any time"], ["done", "Done"]];
const KEY = "nova-phone/quests";
const prefs = (() => { try { return { view: "list", who: "mine", showDone: true, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { return { view: "list", who: "mine", showDone: true }; } })();
const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} };
let state = null, offline = false;
async function load() {
  try { state = await api(`/quests/state${prefs.who === "everyone" ? "?who=everyone" : ""}`); offline = false; }
  catch (err) { if (err.signIn) throw err; if (err.status === 503 || err.status === 502 || err.data?.pcOffline) { offline = true; return; } throw err; }
}
const quests = () => (state?.quests || []).filter((q) => q.status !== "removed");
const hm = (s) => (s ? s.slice(11, 16) : "");
const today = () => N.today();
const whenWords = (s) => { if (!s) return ""; const d = s.slice(0, 10); return `${d === today() ? "Today" : dayWords({ y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10), dow: new Date(`${d}T12:00`).getDay() }, ukNow())} ${hm(s)}`.trim(); };
function questRow(q) {
  const bits = [q.start || q.fixedStart ? whenWords(q.start || q.fixedStart) : "", q.deadline ? `by ${whenWords(q.deadline)}` : "", q.priority && q.priority !== "normal" ? (PRIORITY.find(([p]) => p === q.priority) || [, q.priority])[1] : "", q.minutes ? `${q.minutes < 60 ? `${Math.round(q.minutes)} min` : `${Math.round(q.minutes / 6) / 10} h`}` : "", (q.steps || []).length ? `${q.steps.filter((s) => s.done).length}/${q.steps.length} steps` : "", ...(q.tags || []).map((t) => `#${t}`), state?.scope === "everyone" && q.ownerName ? q.ownerName : ""].filter(Boolean);
  const done = q.status === "done";
  return `<li class="quest-row"><button type="button" class="tick" data-tick="${esc(q.id)}" data-done="${done ? 1 : 0}" aria-pressed="${done}" aria-label="${done ? "Not done yet" : "Done"}: ${esc(q.title)}">${done ? icon("check") : ""}</button>${row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, lead: undefined, icon: undefined, title: q.title, text: bits.join(" · "), cls: done ? "done-row" : "" }).replace(/^<li>|<\/li>$/g, "").replace(/<span class="row-lead">[\s\S]*?<\/span>/, "")}</li>`;
}

N.section({
  id: "quests",
  name: "Quests",
  tile: "quests",
  async draw(box, [part, a], ui) {
    await load();
    if (part === "quest") return drawQuest(box, a, ui);
    if (part === "new") return drawForm(box, null, ui);
    if (part === "edit") return drawForm(box, quests().find((q) => q.id === a), ui);
    if (["focus", "list", "board", "hours"].includes(part)) { prefs.view = part; savePrefs(); }
    ui.action({ icon: "plus", label: "New quest", href: "#quests/new" });
    if (offline) { box.innerHTML = `<div class="empty">${icon("globe")}<b>Nova Agent's computer is off</b><span>Quests live on the studio's computer. They're safe; they'll be back when it is.</span><button type="button" class="btn" data-again>${icon("refresh")} Try again</button></div>`; return; }
    const views = `<div class="seg">${[["focus", "Focus"], ["list", "List"], ["board", "Board"], ["hours", "Hours"]].map(([v, l]) => `<a class="seg-a" href="#quests/${v}" aria-selected="${v === prefs.view}">${l}</a>`).join("")}</div>`;
    const quick = `<form class="form" id="quick"><label class="field"><span class="sr">Add a quest</span><input class="input" name="q" autocomplete="off" placeholder="Add: tomorrow 3pm call Sam !high #studio"></label><p class="form-said" id="quick-bits"></p></form>`;
    const who = state?.canSeeEveryone ? `<div class="chips"><button type="button" class="chip" data-who="mine" aria-pressed="${prefs.who === "mine"}">Mine</button><button type="button" class="chip" data-who="everyone" aria-pressed="${prefs.who === "everyone"}">Everyone's</button></div>` : "";
    const body = prefs.view === "focus" ? focusView() : prefs.view === "board" ? boardView() : prefs.view === "hours" ? hoursView() : listView();
    box.innerHTML = `${views}${quick}${who}${body}`;
    wireQuick(box);
  },
});
function listView() {
  const g = sections(quests(), state.now);
  const shown = GROUPS.filter(([k]) => g[k].length && (k !== "done" || prefs.showDone));
  return shown.length ? shown.map(([k, name]) => `<h3 class="h">${name} · ${g[k].length}</h3><ul class="list">${g[k].map(questRow).join("")}</ul>`).join("") + `<button type="button" class="btn quiet wide" data-show-done>${prefs.showDone ? "Hide done" : "Show done"}</button>` : empty({ icon: "quests", title: "No quests yet", text: "Add one above, in your own words." });
}
function focusView() {
  const f = focusList(quests(), state.now);
  if (!f.length) return empty({ icon: "check", title: "Nothing to do right now ✦" });
  const [q, ...then] = f;
  return `<div class="card edge-card"><p class="kicker">${q.status === "doing" ? "You're on" : "Do this now"}</p><h2 class="card-title">${esc(q.title)}</h2>${q.start ? `<p class="muted">${esc(whenWords(q.start))}–${hm(q.end)}</p>` : ""}
    ${(q.steps || []).length ? `<div class="form">${q.steps.map((s, i) => `<label class="switch"><span>${esc(s.text || s.title || s)}</span><input type="checkbox" role="switch" data-step="${i}" data-id="${esc(q.id)}"${s.done ? " checked" : ""}></label>`).join("")}</div>` : ""}
    <div class="btns two">${q.status !== "doing" ? `<button type="button" class="btn main" data-a="start" data-id="${esc(q.id)}">${icon("play")} Start it</button>` : ""}<button type="button" class="btn${q.status === "doing" ? " main" : ""}" data-a="done" data-id="${esc(q.id)}">${icon("check")} Done</button><button type="button" class="btn" data-a="snooze" data-id="${esc(q.id)}">15 more minutes</button><a class="btn" href="#quests/quest/${encodeURIComponent(q.id)}">Details</a></div></div>
    ${then.length ? `<h3 class="h">Then</h3><ul class="list">${then.slice(0, 5).map(questRow).join("")}</ul>` : ""}`;
}
function boardView() {
  const by = new Map(MODES.map(([m]) => [m, []]));
  for (const q of quests()) by.get(q.mode || (q.status === "done" ? "done" : q.status === "doing" ? "working" : "waiting"))?.push(q);
  return MODES.filter(([m]) => by.get(m).length || ["waiting", "soon", "working", "nearly"].includes(m)).filter(([m]) => m !== "done" || prefs.showDone).map(([m, name]) => `<h3 class="h">${name} · ${by.get(m).length}</h3>${by.get(m).length ? `<ul class="list">${by.get(m).map(questRow).join("")}</ul>` : `<p class="muted small add-line">None</p>`}`).join("");
}
function hoursView() {
  const placed = quests().filter((q) => q.status !== "done" && q.start).sort((a, b) => a.start.localeCompare(b.start));
  const days = [...new Set(placed.map((q) => q.start.slice(0, 10)))].slice(0, 8);
  const unplaced = state.unplanned || [];
  return `${days.length ? days.map((d) => `<h3 class="h">${esc(d === today() ? "Today" : whenWords(`${d}T`).trim())}</h3>${list(placed.filter((q) => q.start.slice(0, 10) === d).map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, lead: `${hm(q.start)}<br><span class="muted">${hm(q.end)}</span>`, title: q.title, text: q.location || "" })))}`).join("") : empty({ icon: "clock", title: "Nothing planned" })}
    ${unplaced.length ? `<h3 class="h">Not given a time yet</h3>${list(unplaced.map((q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "quests", title: q.title, text: q.why || "" })))}<button type="button" class="btn wide" data-replan>${icon("refresh")} Plan them now</button>` : ""}`;
}
function wireQuick(box) {
  const f = box.querySelector("#quick");
  if (!f) return;
  const bits = box.querySelector("#quick-bits");
  f.elements.q.addEventListener("input", () => { const v = f.elements.q.value.trim(); const p = parseQuick(v); bits.textContent = v ? [p.title ? `“${p.title}”` : "", ...(p.bits || [])].filter(Boolean).join(" · ") : ""; });
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const { title, fields } = parseQuick(f.elements.q.value);
    if (!title) { bits.textContent = "Say what the quest is, too."; return; }
    try { await act("/actions/quests", { title, ...fields }); f.elements.q.value = ""; f.classList.remove("dirty"); toast(`Added ${title}`); N.show(); } catch (err) { toast(err.message, true); }
  });
}
document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-tick]");
  if (t) { t.disabled = true; try { await act(`/actions/quests/${encodeURIComponent(t.dataset.tick)}`, { action: t.dataset.done === "1" ? "reopen" : "done" }); if (t.dataset.done !== "1") toast("✦ Done. Nice one."); N.show(); } catch (err) { t.disabled = false; toast(err.message, true); } return; }
  const a = ev.target.closest("[data-a]");
  if (a && location.hash.startsWith("#quests")) { await busy(a, "…", async () => { try { await act(`/actions/quests/${encodeURIComponent(a.dataset.id)}`, a.dataset.a === "snooze" ? { action: "snooze", minutes: 15 } : { action: a.dataset.a }); N.show(); } catch (err) { toast(err.message, true); } }); return; }
  const w = ev.target.closest("[data-who]");
  if (w) { prefs.who = w.dataset.who; savePrefs(); N.show(); return; }
  if (ev.target.closest("[data-show-done]")) { prefs.showDone = !prefs.showDone; savePrefs(); N.show(); return; }
  if (ev.target.closest("[data-replan]") && location.hash.startsWith("#quests")) { try { await act("/actions/replan", {}); toast("Planned ✦"); N.show(); } catch (err) { toast(err.message, true); } }
});
document.addEventListener("change", async (ev) => {
  const s = ev.target.closest("[data-step]");
  if (!s) return;
  const q = quests().find((x) => x.id === s.dataset.id);
  if (!q) return;
  const steps = q.steps.map((x, i) => (i === Number(s.dataset.step) ? { ...x, done: s.checked } : x));
  try { await act(`/actions/quests/${encodeURIComponent(q.id)}`, { changes: { steps } }); q.steps = steps; } catch (err) { s.checked = !s.checked; toast(err.message, true); }
});

function drawQuest(box, id, ui) {
  ui.back("#quests");
  const q = quests().find((x) => x.id === id);
  if (!q) { box.innerHTML = offline ? empty({ icon: "globe", title: "Nova Agent's computer is off" }) : empty({ icon: "quests", title: "That quest isn't there any more" }); return; }
  ui.title("Quest");
  ui.action({ icon: "edit", label: "Change it", href: `#quests/edit/${encodeURIComponent(id)}` });
  const done = q.status === "done";
  const facts = [["When", q.start ? `${whenWords(q.start)}–${hm(q.end)}` : q.fixedStart ? whenWords(q.fixedStart) : "Not given a time yet"], ["Finish by", q.deadline ? whenWords(q.deadline) : ""], ["How long", q.minutes ? `${Math.round(q.minutes)} min` : ""], ["Priority", (PRIORITY.find(([p]) => p === q.priority) || [])[1] || ""], ["Repeats", { day: "Every day", weekday: "Weekdays", week: "Every week", interval: q.everyMinutes ? `Every ${q.everyMinutes} min` : "" }[q.every] || ""], ["Where", q.location], ["Tags", (q.tags || []).map((t) => `#${t}`).join(" ")], ["Whose", q.ownerName]].filter(([, v]) => v);
  box.innerHTML = `<div class="card edge-card"><p class="kicker">${esc(MODE[q.mode] || (done ? "Done" : q.status === "doing" ? "Working on it" : "Waiting"))}${q.atRisk ? " · won't fit before its deadline" : ""}</p><h2 class="card-title">${esc(q.title)}</h2>
      <div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>${q.notes ? `<p class="pre">${esc(q.notes)}</p>` : ""}</div>
    ${(q.steps || []).length ? `<h3 class="h">Steps</h3><div class="form">${q.steps.map((s, i) => `<label class="switch"><span>${esc(s.text || s.title || s)}</span><input type="checkbox" role="switch" data-step="${i}" data-id="${esc(q.id)}"${s.done ? " checked" : ""}></label>`).join("")}</div>` : ""}
    <div class="btns two">${done ? `<button type="button" class="btn main" data-a="reopen" data-id="${esc(q.id)}">Not done yet</button>` : `${q.status !== "doing" ? `<button type="button" class="btn main" data-a="start" data-id="${esc(q.id)}">${icon("play")} Start</button>` : ""}<button type="button" class="btn${q.status === "doing" ? " main" : ""}" data-a="done" data-id="${esc(q.id)}">${icon("check")} Done</button><button type="button" class="btn" data-a="snooze" data-id="${esc(q.id)}">+15 min</button>`}<button type="button" class="btn" data-mode>How it's going</button></div>
    <button type="button" class="btn danger wide" data-del>${icon("trash")} Delete</button>`;
  box.querySelector("[data-mode]").addEventListener("click", async () => { const m = await choose({ title: "How's it going?", options: MODES }); if (!m) return; try { await act(`/actions/quests/${encodeURIComponent(id)}`, { action: "mode", mode: m }); N.show(); } catch (err) { toast(err.message, true); } });
  box.querySelector("[data-del]").addEventListener("click", async () => { if (!(await confirm({ title: `Delete “${q.title}”?`, ok: "Delete", danger: true }))) return; try { await act(`/actions/quests/${encodeURIComponent(id)}`, { action: "remove" }); toast("Deleted"); location.hash = "#quests"; } catch (err) { toast(err.message, true); } });
}

// A quest with every detail: new, or changing one
function drawForm(box, q, ui) {
  ui.back(q ? `#quests/quest/${encodeURIComponent(q.id)}` : "#quests");
  ui.title(q ? "Change quest" : "New quest");
  const dt = (s) => (s ? s.slice(0, 16) : "");
  box.innerHTML = `<form class="form" id="qf" novalidate>
      ${field({ label: "What", name: "title", value: q?.title || "", required: true, attrs: 'maxlength="140" autocomplete="off"', placeholder: "Call Sam about the mix" })}
      ${field({ label: "When (optional)", name: "fixedStart", type: "datetime-local", value: dt(q?.fixedStart) })}
      ${field({ label: "Finish by (optional)", name: "deadline", type: "datetime-local", value: dt(q?.deadline) })}
      ${field({ label: "How long", name: "minutes", type: "select", value: q?.minutes || 30, options: [[5, "5 min"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]] })}
      ${field({ label: "Repeats", name: "every", type: "select", value: q?.every || "", options: [["", "No"], ["day", "Every day"], ["weekday", "Weekdays"], ["week", "Every week"]] })}
      ${field({ label: "Priority", name: "priority", type: "select", value: q?.priority || "normal", options: PRIORITY })}
      ${field({ label: "Tags (optional)", name: "tags", value: (q?.tags || []).join(" "), placeholder: "studio mix", hint: "Words, with spaces between" })}
      ${field({ label: "Where (optional)", name: "location", value: q?.location || "", attrs: 'maxlength="160"' })}
      ${field({ label: "Steps (optional)", name: "steps", type: "textarea", rows: 3, value: (q?.steps || []).map((s) => s.text || s.title || s).join("\n"), hint: "One a line" })}
      ${field({ label: "Notes (optional)", name: "notes", type: "textarea", rows: 3, value: q?.notes || "", attrs: 'maxlength="2000"' })}
      <p class="form-said" id="qf-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${q ? "Save" : "Add quest"}</button></form>`;
  const f = box.querySelector("#qf");
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const x = f.elements, said = f.querySelector("#qf-said");
    if (!x.title.value.trim()) { said.textContent = "Say what the quest is."; said.classList.add("bad"); return; }
    const old = new Map((q?.steps || []).map((s) => [s.text || s.title || s, s]));
    const out = { title: x.title.value.trim(), fixedStart: x.fixedStart.value || "", deadline: x.deadline.value || "", minutes: Number(x.minutes.value), every: x.every.value || "", priority: x.priority.value, tags: x.tags.value.split(/[\s,#]+/).filter(Boolean), location: x.location.value.trim(), notes: x.notes.value, steps: x.steps.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30).map((t) => ({ ...(old.get(t) || {}), text: t, done: !!old.get(t)?.done })) };
    await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
      try {
        if (q) { const changes = Object.fromEntries(Object.entries(out).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(q[k] ?? (Array.isArray(v) ? [] : "")))); await act(`/actions/quests/${encodeURIComponent(q.id)}`, { changes }); }
        else await act("/actions/quests", out);
        f.classList.remove("dirty");
        toast(q ? "Saved" : "Quest added");
        location.hash = q ? `#quests/quest/${encodeURIComponent(q.id)}` : "#quests";
      } catch (err) { said.textContent = `Not saved: ${err.message}`; said.classList.add("bad"); }
    });
  });
}

N.quests = { now: async () => { await load(); return state ? focusList(quests(), state.now).slice(0, 3) : []; }, row: (q) => row({ href: `#quests/quest/${encodeURIComponent(q.id)}`, icon: "quests", title: q.title, text: q.start ? `${hm(q.start)}–${hm(q.end)}` : "" }) };
// (Today can draw before this file is ready on some engines: draw it again with what this file adds)
if (!location.hash || location.hash.startsWith("#today")) N.show();
