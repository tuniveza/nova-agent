// Nova on a phone: Quests, the same quests as Nova Agent's own (kept by Nova Agent on the studio's PC). Add one
// in everyday words ("tomorrow 3pm call Sam !high #studio 30m": Quests' own reading of them, parse.js), see
// them in Quests' own groups (now, overdue, today, upcoming, any time, done), and tick one off, start it or
// snooze it. The board, the hour-by-hour view and the options are in the computer version's Quests.
import { parseQuick } from "/quests/js/parse.js";
import { sections } from "/quests/js/sort.js";

const { section, api, esc, icon, computerLink } = window.NovaPhone;
const HDR = { "X-Nova-Visualizer": "1" };
const GROUPS = [["now", "Now"], ["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Coming up"], ["anytime", "Any time"], ["done", "Done"]];
const PRIORITY = { critical: "Critical", high: "High", low: "Low" };
let state = null, offline = "";

async function load() {
  try {
    state = await api("/quests/state");
    offline = "";
  } catch (err) {
    if (err.signIn) throw err;
    offline = /50[23]/.test(err.message) ? "Nova Agent can't be reached just now (the studio's PC looks to be off). Your quests are safe." : `Quests didn't load (${err.message}).`;
  }
}
// A quest action, the way Quests sends it ({ ok, result } or { ok: false, message })
async function post(path, body) {
  const r = await api(path, { method: "POST", headers: HDR, body: JSON.stringify(body || {}) });
  if (r && r.ok === false) throw new Error(r.message || "That didn't work.");
  return r;
}
const when = (s) => (s ? new Date(`${s.slice(0, 16)}`).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function row(q) {
  const bits = [q.start || q.fixedStart ? when(q.start || q.fixedStart) : "", q.deadline ? `by ${when(q.deadline)}` : "", PRIORITY[q.priority] || "", ...(q.tags || []).map((t) => `#${t}`)].filter(Boolean);
  const done = q.status === "done";
  return `<li class="quest-row"><button type="button" class="tick" data-quest-tick="${esc(q.id)}" data-done="${done ? 1 : 0}" aria-label="${done ? "Not done yet" : "Done"}: ${esc(q.title)}" aria-pressed="${done}">${done ? "✓" : ""}</button>
    <a class="row" href="#quests/${encodeURIComponent(q.id)}"><span class="row-main"><strong${done ? ' class="struck"' : ""}>${esc(q.title)}</strong>${bits.length ? `<small>${esc(bits.join(" · "))}</small>` : ""}</span></a></li>`;
}

section({
  id: "quests",
  name: "Quests",
  async draw(page, [id]) {
    await load();
    if (id) return drawQuest(page, id);
    const g = state ? sections(state.quests || []) : null;
    page.innerHTML = `${offline ? `<div class="card"><p>${esc(offline)}</p><button type="button" class="btn" data-again>Try again</button></div>` : ""}
      <form class="stack form" id="quick"><label>Add a quest<input name="q" autocomplete="off" placeholder="tomorrow 3pm call Sam !high #studio" ${offline ? "disabled" : ""}></label>
        <p class="muted small" id="quick-bits">Say when, how long, !high and #tags in everyday words.</p>
        <button class="btn main wide" type="submit" ${offline ? "disabled" : ""}>Add</button></form>
      ${g ? GROUPS.filter(([k]) => g[k].length).map(([k, name]) => `<h2 class="h">${name} · ${g[k].length}</h2><ul class="rows">${g[k].map(row).join("")}</ul>`).join("") || `<p class="note">No quests yet.</p>` : ""}
      <p><a class="btn wide" href="${computerLink("/quests/")}">${icon("open")} The board and hours: the computer version</a></p>`;
    const form = page.querySelector("#quick"), bits = page.querySelector("#quick-bits");
    form.elements.q.addEventListener("input", () => {
      const p = parseQuick(form.elements.q.value);
      bits.textContent = form.elements.q.value.trim() ? [p.title ? `“${p.title}”` : "", ...(p.bits || [])].filter(Boolean).join(" · ") : "Say when, how long, !high and #tags in everyday words.";
    });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const { title, fields } = parseQuick(form.elements.q.value);
      if (!title) { bits.textContent = "Say what the quest is, too."; return; }
      form.querySelector("[type=submit]").disabled = true;
      try { await post("/actions/quests", { title, ...fields }); window.NovaPhone.show(); }
      catch (err) { bits.textContent = `Not added (${err.message}).`; form.querySelector("[type=submit]").disabled = false; }
    });
  },
});

function drawQuest(page, id) {
  const q = (state?.quests || []).find((x) => x.id === id);
  if (!q) { page.innerHTML = `<p class="note">${esc(offline || "That quest isn't there any more.")}</p><p><a class="btn wide" href="#quests">Back to Quests</a></p>`; return; }
  const done = q.status === "done";
  const lines = [["Starts", when(q.start || q.fixedStart)], ["Ends", when(q.end)], ["Due", when(q.deadline)], ["How long", q.minutes ? `${q.minutes} min` : ""], ["Priority", PRIORITY[q.priority] || ""], ["Tags", (q.tags || []).map((t) => `#${t}`).join(" ")]].filter(([, v]) => v);
  page.innerHTML = `<div class="card"><p class="cal-kind">Quest${q.status === "doing" ? " · started" : done ? " · done" : ""}</p><h2 class="title">${esc(q.title)}</h2>
      ${lines.map(([k, v]) => `<p><span class="muted">${k}</span><br>${esc(v)}</p>`).join("")}${q.notes ? `<p class="pre">${esc(q.notes)}</p>` : ""}</div>
    <div class="btns">
      <button type="button" class="btn main" data-quest="${done ? "reopen" : "done"}">${done ? "Not done yet" : "Done"}</button>
      ${!done && q.status !== "doing" ? `<button type="button" class="btn" data-quest="start">Start</button>` : ""}
      ${!done ? `<button type="button" class="btn" data-quest="snooze">Snooze 15 min</button>` : ""}
    </div>
    <p class="form-said" id="quest-said" role="status"></p>
    <p><a class="btn wide" href="#quests">${icon("back")} Back to Quests</a></p>`;
  page.querySelectorAll("[data-quest]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    const action = b.dataset.quest;
    try {
      await post(`/actions/quests/${encodeURIComponent(id)}`, action === "snooze" ? { action, minutes: 15 } : { action });
      await load();
      drawQuest(page, id);
    } catch (err) { page.querySelector("#quest-said").textContent = `That didn't work (${err.message}).`; b.disabled = false; }
  }));
}

// A tick in the list: done, or not done yet
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-quest-tick]");
  if (!b) return;
  b.disabled = true;
  try { await post(`/actions/quests/${encodeURIComponent(b.dataset.questTick)}`, { action: b.dataset.done === "1" ? "reopen" : "done" }); window.NovaPhone.show(); }
  catch (err) { b.disabled = false; }
});
document.addEventListener("click", (ev) => { if (ev.target.closest("[data-again]") && location.hash.startsWith("#quests")) window.NovaPhone.show(); });
