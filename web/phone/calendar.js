// Nova Phone: Calendar. The same calendar as the computer version, made for the phone:
//   Day (one day's cards), Week (seven days, each with its cards), Month (the month as dots, the chosen day's
//   cards under it), and Coming up (everything ahead, with a search). What shows: note cards, day cards, Nova
//   Agent's plan and bookings, each switchable (kept on this phone). A card opens on its own screen; note cards
//   and day cards are added, changed and deleted here, a repeating one "just this one, this and the ones after,
//   or all of them", as on the computer. Its rules are lib/recur.js and lib/edits.js (the computer's own).
import { occurrences, addDays, weekday, addMinutes, minutesBetween, cleanRepeat, endSeriesBefore, describeRepeat } from "./lib/recur.js";
import { stamped } from "./lib/edits.js";

const N = window.NovaPhone;
const { esc, icon, row, list, field, toggle, empty, api, toast, confirm, choose, busy, today, localStamp } = N;
const API = "/app/api/calendar/items";
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLORS = ["rose", "magenta", "violet", "indigo", "blue", "teal", "green", "amber", "orange", "red", "grey"];
const REMINDERS = [[0, "At start"], [10, "10 min"], [30, "30 min"], [60, "1 hour"], [1440, "1 day"]];
const isAgent = (id) => /^(quest|block|mile|music)-/.test(String(id || ""));
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
const dayName = (d) => `${WD[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const shortDay = (d) => `${WD[weekday(d)].slice(0, 3)} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
const time = (s) => s.slice(11, 16);
const fromFeed = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? localStamp(new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`)) : null);
const LAYERS_KEY = "nova-phone/calendar-show";
const layers = (() => { try { return { events: true, days: true, quests: true, bookings: true, ...JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}") }; } catch (e) { return { events: true, days: true, quests: true, bookings: true }; } })();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// ---- The cards: all of them, then only what changed since ----
const items = new Map();
let rev = 0, bookings = [], loadedAt = 0;
async function load(force = false) {
  if (!force && Date.now() - loadedAt < 20000) return;
  const [r, b] = await Promise.all([api(`${API}${rev ? `?since=${rev}` : ""}`), api("/app/api/calendar").catch((e) => { if (e.signIn) throw e; return { bookings }; })]);
  for (const it of r.items || []) (it.deleted ? items.delete(it.id) : items.set(it.id, it));
  rev = r.rev || rev;
  bookings = b.bookings || [];
  loadedAt = Date.now();
}
// Everything on from..to: { type, item, date, start, end, allDay, ro, color }
function entries(from, to) {
  const out = [];
  for (const it of items.values()) {
    if (it.kind === "day") {
      if (!layers.days) continue;
      const as = { start: `${it.date}T00:00`, end: `${it.date}T23:59`, repeat: it.repeat === "yearly" ? { freq: "yearly" } : null };
      for (const o of occurrences(as, from, to)) out.push({ type: "day", item: it, date: o.date, start: o.start, end: o.end, allDay: true, ro: false, color: "gold" });
      continue;
    }
    const agent = isAgent(it.id);
    if (agent ? !layers.quests : !layers.events) continue;
    for (const o of occurrences(it, from, to)) out.push({ type: "event", item: it, date: o.date, start: o.start, end: o.end, allDay: !!it.allDay, ro: agent, color: agent ? "lilac" : it.color || "violet" });
  }
  if (layers.bookings) for (const b of bookings) {
    const start = fromFeed(b.start), end = fromFeed(b.end) || start;
    if (!start || start.slice(0, 10) > to || end.slice(0, 10) < from) continue;
    out.push({ type: "booking", item: b, date: start.slice(0, 10), start, end, allDay: false, ro: true, color: "gold" });
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}
const onDay = (list_, d) => list_.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && !(e.end.slice(0, 10) === d && e.end.slice(11) === "00:00" && e.start.slice(0, 10) < d));
const titleOf = (e) => (e.type === "booking" ? [e.item.session, e.item.name].filter(Boolean).join(" · ") || "Booking" : e.item.title || (e.type === "day" ? "Day card" : "(No title)"));
const kindOf = (e) => (e.type === "booking" ? "Booking" : e.type === "day" ? "Day card" : e.ro ? "Nova Agent's plan" : "Note card");
const keyOf = (e) => (e.type === "booking" ? `booking-${bookings.indexOf(e.item)}` : e.item.id);

function entryRow(e) {
  const where = e.type === "booking" ? e.item.email || e.item.phone || "" : e.item.location || "";
  return row({
    href: `#calendar/card/${encodeURIComponent(keyOf(e))}/${e.date}`, color: e.color,
    lead: e.allDay ? "All<br>day" : `${time(e.start)}<br><span class="muted">${time(e.end)}</span>`,
    title: titleOf(e), text: [kindOf(e), where].filter(Boolean).join(" · "),
  });
}

// ---- The screens ----
const VIEW_KEY = "nova-phone/calendar-view";
let view = (() => { try { return localStorage.getItem(VIEW_KEY) || "week"; } catch (e) { return "week"; } })();
let cursor = today();
N.section({
  id: "calendar",
  name: "Calendar",
  tile: "calendar",
  async draw(box, [what, a, b], ui) {
    await load(!what || ["day", "week", "month", "ahead"].includes(what));
    if (what === "card") return drawCard(box, a, b, ui);
    if (what === "new") return drawForm(box, null, a || cursor, ui);
    if (what === "newday") return drawDayForm(box, null, a || cursor, ui);
    if (what === "edit") return items.get(a)?.kind === "day" ? drawDayForm(box, items.get(a), b, ui) : drawForm(box, items.get(a), b, ui);
    if (["day", "week", "month", "ahead"].includes(what)) { view = what; try { localStorage.setItem(VIEW_KEY, view); } catch (e) {} }
    if (/^\d{4}-\d{2}-\d{2}$/.test(a || "")) cursor = a;
    ui.action({ icon: "plus", label: "New note card", href: `#calendar/new/${cursor}` });
    const tabs = `<div class="seg" role="tablist">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["ahead", "Coming up"]].map(([v, l]) => `<a role="tab" class="seg-a" href="#calendar/${v}/${cursor}" aria-selected="${v === view}">${l}</a>`).join("")}</div>`;
    const show = `<div class="chips">${[["events", "Note cards"], ["days", "Day cards"], ["quests", "Nova Agent's plan"], ["bookings", "Bookings"]].map(([k, l]) => `<button type="button" class="chip" data-layer="${k}" aria-pressed="${layers[k]}">${l}</button>`).join("")}</div>`;
    const body = view === "day" ? dayView() : view === "month" ? monthView() : view === "ahead" ? aheadView() : weekView();
    box.innerHTML = `${tabs}${body}<details class="card show-what"><summary>What to show</summary>${show}</details>`;
  },
});
function stepper(prev, label, next, now) {
  return `<div class="stepper"><a class="icon-btn" href="${prev}" aria-label="Before">${icon("back")}</a><a class="stepper-mid" href="${now}">${esc(label)}</a><a class="icon-btn" href="${next}" aria-label="After">${icon("next")}</a></div>`;
}
function dayBlock(d, list_) {
  const rows = onDay(list_, d);
  return `<h3 class="h${d === today() ? " now" : ""}">${d === today() ? "Today · " : ""}${esc(dayName(d))}</h3>${rows.length ? list(rows.map(entryRow)) : `<a class="add-line" href="#calendar/new/${d}">${icon("plus")} Add a note card</a>`}`;
}
function dayView() {
  const d = cursor;
  return `${stepper(`#calendar/day/${addDays(d, -1)}`, d === today() ? "Today" : shortDay(d), `#calendar/day/${addDays(d, 1)}`, `#calendar/day/${today()}`)}${dayBlock(d, entries(d, d))}`;
}
function weekView() {
  const from = mondayOf(cursor), to = addDays(from, 6), t = today();
  const all = entries(from, to);
  const label = from <= t && t <= to ? "This week" : `${shortDay(from)} – ${shortDay(to)}`;
  return `${stepper(`#calendar/week/${addDays(from, -7)}`, label, `#calendar/week/${addDays(from, 7)}`, `#calendar/week/${t}`)}${Array.from({ length: 7 }, (_, i) => dayBlock(addDays(from, i), all)).join("")}`;
}
function monthView() {
  const first = `${cursor.slice(0, 7)}-01`;
  const next = addDays(first, 32).slice(0, 7) + "-01";
  const last = addDays(next, -1);
  const start = mondayOf(first), all = entries(start, addDays(start, 41)), t = today();
  const prev = addDays(first, -1).slice(0, 7) + "-01";
  const cells = [];
  for (let d = start; d <= last || weekday(d) !== 1; d = addDays(d, 1)) {
    const here = onDay(all, d);
    cells.push(`<a class="mday${d.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}${d === cursor ? " picked" : ""}" href="#calendar/month/${d}" aria-label="${esc(dayName(d))}${here.length ? `, ${here.length} card${here.length > 1 ? "s" : ""}` : ""}"><b>${Number(d.slice(8))}</b><span class="dots">${here.slice(0, 4).map((e) => `<i data-c="${esc(e.color)}"></i>`).join("")}</span></a>`);
    if (cells.length > 42) break;
  }
  return `${stepper(`#calendar/month/${prev}`, `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`, `#calendar/month/${next}`, `#calendar/month/${t}`)}
    <div class="month" role="grid"><div class="mhead">${["M", "T", "W", "T", "F", "S", "S"].map((x) => `<span>${x}</span>`).join("")}</div><div class="mgrid">${cells.join("")}</div></div>
    ${dayBlock(cursor, entries(cursor, cursor))}`;
}
let aheadDays = 30, query = "";
function aheadView() {
  const from = today(), to = addDays(from, aheadDays);
  const q = query.toLowerCase();
  const all = entries(from, to).filter((e) => !q || [titleOf(e), e.item.location, e.item.body, e.item.info].some((v) => v && String(v).toLowerCase().includes(q)));
  const days = [...new Set(all.map((e) => (e.start.slice(0, 10) < from ? from : e.start.slice(0, 10))))].sort();
  return `<form class="search" role="search" data-cal-search><label class="field"><span class="sr">Search</span><input class="input" type="search" name="q" value="${esc(query)}" placeholder="Search the next ${aheadDays} days"></label></form>
    ${days.length ? days.map((d) => `<h3 class="h">${d === from ? "Today · " : ""}${esc(dayName(d))}</h3>${list(onDay(all, d).map(entryRow))}`).join("") : empty({ icon: "calendar", title: q ? `Nothing matches “${query}”` : "Nothing coming up" })}
    <button type="button" class="btn wide" data-more-days>Show ${aheadDays + 30} days</button>`;
}
document.addEventListener("click", (e) => {
  const l = e.target.closest("[data-layer]");
  if (l) { layers[l.dataset.layer] = !layers[l.dataset.layer]; try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch (err) {} N.show(); return; }
  if (e.target.closest("[data-more-days]")) { aheadDays += 30; N.show(); }
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches("[data-cal-search]")) return;
  e.preventDefault();
  query = e.target.elements.q.value.trim();
  N.show();
});
document.addEventListener("search", (e) => { if (e.target.closest("[data-cal-search]") && !e.target.value) { query = ""; N.show(); } }, true);

// ---- One card ----
function findEntry(key, date) {
  return entries(addDays(date, -1), addDays(date, 1)).find((e) => keyOf(e) === key && e.date === date) || entries(date, date).find((e) => keyOf(e) === key) || null;
}
function drawCard(box, key, date, ui) {
  ui.back(`#calendar/${view}/${date || cursor}`);
  const e = findEntry(key, date || today());
  ui.title(e ? kindOf(e) : "Calendar");
  if (!e) { box.innerHTML = empty({ icon: "calendar", title: "That card isn't there any more", action: `<a class="btn" href="#calendar/${view}/${date || today()}">Back to the calendar</a>` }); return; }
  const it = e.item;
  const when = e.allDay ? `${dayName(e.date)} · all day` : `${dayName(e.start.slice(0, 10))} · ${time(e.start)} – ${e.end.slice(0, 10) !== e.start.slice(0, 10) ? `${shortDay(e.end.slice(0, 10))} ` : ""}${time(e.end)}`;
  const facts = [];
  if (e.type === "booking") {
    for (const [k, v] of [["Session", it.session], ["Name", it.name], ["Email", it.email], ["Phone", it.phone], ["Price", it.price]]) if (v) facts.push([k, esc(v)]);
  } else {
    if (it.location) facts.push(["Where", esc(it.location)]);
    if (e.type === "event" && it.repeat) facts.push(["Repeats", esc(describeRepeat(it.repeat))]);
    if (e.type === "day" && it.repeat === "yearly") facts.push(["Repeats", "Every year"]);
    if ((it.reminders || []).length) facts.push(["Reminders", esc(it.reminders.map((m) => (REMINDERS.find(([x]) => x === m) || [m, `${m} min`])[1]).join(", "))]);
    if (it.meetUrl) facts.push(["Google Meet", `<a href="${esc(it.meetUrl)}" target="_blank" rel="noopener">${esc(it.meetUrl.replace(/^https?:\/\//, ""))}</a>`]);
    if (it.author) facts.push(["By", esc(it.author)]);
  }
  const words = e.type === "booking" ? "" : it.body || it.info || "";
  const mine = !e.ro && e.type !== "booking";
  const contact = e.type === "booking" ? [it.phone && `<a class="btn" href="tel:${esc(it.phone)}">${icon("phone")} Call</a>`, it.email && `<a class="btn" href="mailto:${esc(it.email)}">${icon("mail")} Email</a>`].filter(Boolean) : [];
  box.innerHTML = `<div class="card edge-card" data-c="${esc(e.color)}"><p class="kicker">${esc(kindOf(e))}</p><h2 class="card-title">${esc(titleOf(e))}</h2><p class="muted">${esc(when)}</p>
      ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${v}</b></div>`).join("")}</div>` : ""}
      ${words ? `<p class="pre">${esc(words)}</p>` : ""}</div>
    ${contact.length ? `<div class="btns two">${contact.join("")}</div>` : ""}
    ${mine ? `<div class="btns two"><a class="btn main" href="#calendar/edit/${encodeURIComponent(it.id)}/${e.date}">${icon("edit")} Change</a><button type="button" class="btn danger" data-cal-del="${esc(it.id)}" data-date="${e.date}">${icon("trash")} Delete</button></div>` : ""}
    ${e.type === "booking" ? `<p class="muted small">Bookings come from the studio's booking diary.</p>` : e.ro ? `<p class="muted small">Part of Nova Agent's plan: Nova Agent moves it as the plan changes.</p>` : ""}`;
}

// Which of a repeating card: this one, this and the ones after, or all of them
const which = (verb) => choose({ title: `${verb} a repeating card`, options: [["one", "Just this one"], ["following", "This and the ones after"], ["all", "All of them"]] });
async function put(item) {
  const { out, sent } = stamped(item, (id) => items.get(id), new Date().toISOString(), uid);
  const r = await api(`${API}/${encodeURIComponent(out.id)}`, { method: "PUT", body: JSON.stringify(sent) });
  if (r.ok === false && r.current) { items.set(r.current.id, r.current); throw Object.assign(new Error("Someone changed this card at the same time; theirs is kept."), { kept: true }); }
  items.set(out.id, r.item || out);
  rev = r.rev || rev;
  return r.item || out;
}
async function del(id) {
  const r = await api(`${API}/${encodeURIComponent(id)}?updated=${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE" });
  if (r.current) items.set(r.current.id, r.current); else items.delete(id);
  rev = r.rev || rev;
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-cal-del]");
  if (!b) return;
  const it = items.get(b.dataset.calDel), date = b.dataset.date;
  if (!it) return;
  let how = "all";
  if (it.kind === "event" && it.repeat) { how = await which("Delete"); if (!how) return; }
  else if (!(await confirm({ title: `Delete “${it.title || "this card"}”?`, ok: "Delete", danger: true }))) return;
  await busy(b, "Deleting…", async () => {
    try {
      if (how === "one") await put({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
      else if (how === "following" && date !== it.start.slice(0, 10)) await put(endSeriesBefore(it, date));
      else await del(it.id);
      toast("Deleted");
      location.hash = `#calendar/${view}/${date}`;
    } catch (err) { toast(`Not deleted: ${err.message}`, true); }
  });
});

// ---- A note card to fill in ----
function readRepeat(f, start) {
  const freq = f.freq.value;
  if (!freq) return null;
  const r = { freq, interval: Math.max(1, Number(f.interval.value) || 1) };
  if (freq === "weekly") { const days = [...f.querySelectorAll("[name=byDay]:checked")].map((x) => Number(x.value)); r.byDay = days.length ? days : [weekday(start.slice(0, 10))]; }
  if (f.until.value) r.until = f.until.value;
  return cleanRepeat(r);
}
function drawForm(box, it, date, ui) {
  if (it && (isAgent(it.id) || it.kind !== "event")) return drawCard(box, it.id, date, ui);
  ui.title(it ? "Change note card" : "New note card");
  ui.back(it ? `#calendar/card/${encodeURIComponent(it.id)}/${date}` : `#calendar/${view}/${date}`);
  // (a repeating card's times: this occurrence's)
  const occ = it ? (occurrences(it, date, date)[0] || { start: it.start, end: it.end }) : null;
  const sd = occ ? occ.start.slice(0, 10) : date, st = occ ? time(occ.start) : "10:00";
  const ed = occ ? occ.end.slice(0, 10) : date, et = occ ? time(occ.end) : "11:00";
  const rep = cleanRepeat(it?.repeat) || {};
  const color = it?.color || "violet", rem = new Set(it?.reminders || []);
  box.innerHTML = `<form class="form" id="cal-form" novalidate>
      ${field({ label: "Title", name: "title", value: it?.title || "", required: true, placeholder: "What's happening", attrs: 'maxlength="200" autocomplete="off"' })}
      ${toggle({ label: "All day", name: "allDay", checked: !!it?.allDay })}
      <div class="two-up">${field({ label: "Starts", name: "sdate", type: "date", value: sd })}${field({ label: "at", name: "stime", type: "time", value: st })}</div>
      <div class="two-up">${field({ label: "Ends", name: "edate", type: "date", value: ed })}${field({ label: "at", name: "etime", type: "time", value: et })}</div>
      ${field({ label: "Where", name: "location", value: it?.location || "", placeholder: "Optional", attrs: 'maxlength="300"' })}
      ${field({ label: "Notes", name: "body", type: "textarea", value: it?.body || "", placeholder: "Optional", rows: 3 })}
      ${field({ label: "Repeats", name: "freq", type: "select", value: rep.freq || "", options: [["", "Doesn't repeat"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"]] })}
      <div class="repeat-more" ${rep.freq ? "" : "hidden"}>
        <div class="two-up">${field({ label: "Every how many", name: "interval", type: "number", value: rep.interval || 1, attrs: 'min="1" max="99"' })}${field({ label: "Until (optional)", name: "until", type: "date", value: rep.until || "" })}</div>
        <fieldset class="field weekdays" ${rep.freq === "weekly" ? "" : "hidden"}><legend>On</legend><div class="day-picks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day-pick"><input type="checkbox" name="byDay" value="${d}"${(rep.byDay || [weekday(sd)]).includes(d) ? " checked" : ""}><span>${WD[d].slice(0, 2)}</span></label>`).join("")}</div></fieldset>
      </div>
      <fieldset class="field"><legend>Remind me</legend><div class="chips">${REMINDERS.map(([m, l]) => `<label class="chip check-chip"><input type="checkbox" name="rem" value="${m}"${rem.has(m) ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset>
      <fieldset class="field"><legend>Colour</legend><div class="swatch-grid">${COLORS.map((c) => `<label class="swatch" data-c="${c}"><input type="radio" name="color" value="${c}"${c === color ? " checked" : ""}><i></i>${c[0].toUpperCase() + c.slice(1)}</label>`).join("")}</div></fieldset>
      <p class="form-said" id="cal-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${it ? "Save" : "Add note card"}</button>
    </form>`;
  const f = box.querySelector("#cal-form");
  const times = () => f.querySelectorAll("[name=stime], [name=etime]").forEach((x) => (x.closest(".field").hidden = f.elements.allDay.checked));
  const repeats = () => { f.querySelector(".repeat-more").hidden = !f.elements.freq.value; f.querySelector(".weekdays").hidden = f.elements.freq.value !== "weekly"; };
  f.elements.allDay.addEventListener("change", times);
  f.elements.freq.addEventListener("change", repeats);
  f.elements.sdate.addEventListener("change", () => { if (!f.elements.edate.value || f.elements.edate.value < f.elements.sdate.value) f.elements.edate.value = f.elements.sdate.value; });
  times();
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const x = f.elements, said = f.querySelector("#cal-said");
    if (!x.title.value.trim()) { said.textContent = "Give it a title."; said.classList.add("bad"); x.title.focus(); return; }
    if (!x.sdate.value) { said.textContent = "Pick a day."; said.classList.add("bad"); return; }
    const allDay = x.allDay.checked;
    const start = `${x.sdate.value}T${allDay ? "00:00" : x.stime.value || "09:00"}`;
    let end = allDay ? `${x.edate.value || x.sdate.value}T23:59` : `${x.edate.value || x.sdate.value}T${x.etime.value || "10:00"}`;
    if (end < start) end = allDay ? `${start.slice(0, 10)}T23:59` : addMinutes(start, 60);
    const reminders = [...f.querySelectorAll("[name=rem]:checked")].map((c) => Number(c.value));
    const changes = { kind: "event", title: x.title.value.trim(), start, end, allDay, location: x.location.value.trim(), body: x.body.value, color: x.color.value, reminders, phones: reminders.length ? it?.phones || [] : [], repeat: readRepeat(f, start) };
    if (!changes.repeat) changes.exdates = [];
    const btn = f.querySelector("[type=submit]");
    await busy(btn, "Saving…", async () => {
      try {
        let saved;
        if (!it) saved = await put({ ...changes, art: { seed: (Math.random() * 2 ** 32) >>> 0, subject: "auto" } });
        else if (!it.repeat) saved = await put({ ...it, ...changes });
        else {
          const how = await which("Change");
          if (!how) return;
          const was = occ.start;
          if (how === "one") {
            await put({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
            const { id, created, ...rest } = it;
            saved = await put({ ...rest, ...changes, repeat: null, exdates: [] });
          } else if (how === "following" && date !== it.start.slice(0, 10)) {
            await put(endSeriesBefore(it, date));
            const { id, created, exdates, ...rest } = it;
            const r = cleanRepeat(changes.repeat || it.repeat);
            if (r && r.count) delete r.count;
            saved = await put({ ...rest, ...changes, repeat: r, exdates: (it.exdates || []).filter((d) => d > date) });
          } else {
            // (all of them: the times move the whole series by the same amount)
            const shift = minutesBetween(was, changes.start);
            const out = { ...it, ...changes, start: addMinutes(it.start, shift) };
            out.end = addMinutes(out.start, minutesBetween(changes.start, changes.end));
            saved = await put(out);
          }
        }
        f.classList.remove("dirty");
        toast(it ? "Saved" : "Note card added");
        location.hash = `#calendar/card/${encodeURIComponent(saved.id)}/${saved.start.slice(0, 10) === start.slice(0, 10) ? start.slice(0, 10) : date}`;
      } catch (err) {
        said.textContent = err.kept ? err.message : `Not saved: ${err.message}`;
        said.classList.add("bad");
      }
    });
  });
}

// ---- A day card: a special day (a birthday, a holiday, a release day) ----
function drawDayForm(box, it, date, ui) {
  ui.title(it ? "Change day card" : "New day card");
  ui.back(it ? `#calendar/card/${encodeURIComponent(it.id)}/${date}` : `#calendar/${view}/${date}`);
  box.innerHTML = `<form class="form" id="day-form" novalidate>
      ${field({ label: "Title", name: "title", value: it?.title || "", required: true, placeholder: "Birthday, release day, holiday…", attrs: 'maxlength="200" autocomplete="off"' })}
      ${field({ label: "Day", name: "date", type: "date", value: it?.date || date })}
      ${toggle({ label: "Every year", name: "yearly", checked: it ? it.repeat === "yearly" : false })}
      ${field({ label: "Where", name: "location", value: it?.location || "", placeholder: "Optional" })}
      ${field({ label: "About it", name: "info", type: "textarea", value: it?.info || "", placeholder: "Optional", rows: 3 })}
      <p class="form-said" id="day-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${it ? "Save" : "Add day card"}</button>
    </form>`;
  const f = box.querySelector("#day-form");
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const x = f.elements, said = f.querySelector("#day-said");
    if (!x.title.value.trim() || !x.date.value) { said.textContent = "Give it a title and a day."; said.classList.add("bad"); return; }
    await busy(f.querySelector("[type=submit]"), "Saving…", async () => {
      try {
        const saved = await put({ preset: "custom", theme: "app", aesthetic: "nebula", ...(it || {}), kind: "day", title: x.title.value.trim(), date: x.date.value, repeat: x.yearly.checked ? "yearly" : "none", location: x.location.value.trim(), info: x.info.value });
        f.classList.remove("dirty");
        toast(it ? "Saved" : "Day card added");
        location.hash = `#calendar/card/${encodeURIComponent(saved.id)}/${saved.date}`;
      } catch (err) { said.textContent = `Not saved: ${err.message}`; said.classList.add("bad"); }
    });
  });
}

// For Today: today's cards, as rows
N.cal = { load, day: (d) => onDay(entries(d, d), d), row: entryRow };
