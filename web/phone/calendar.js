// Nova on a phone: Calendar. The week as a list, each card under its day; a card opens on its own page; a new
// note card, or a one-off card changed or deleted, saves to the same calendar as the computer's (Calendar's
// own repeat rules and save versions, so the two never disagree). A repeating card is changed in the computer
// version's Calendar, where "this one, this and following, or all" can be chosen.
import { occurrences, addDays, weekday } from "/calendar/js/recur.js";
import { stamped } from "/calendar/js/edits.js";

const { section, api, esc, icon, computerLink, today, localStamp, signInCard } = window.NovaPhone;
const API = "/app/api/calendar/items";
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLORS = ["rose", "magenta", "violet", "indigo", "blue", "teal", "green", "amber", "orange", "red", "grey"];
const isAgent = (id) => /^(quest|block|mile)-/.test(id || "");
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
const dayLabel = (d) => `${WD[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const short = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
const time = (s) => s.slice(11, 16);
// (a booking's times come as Acuity's 20261023T140000Z)
const fromFeed = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? localStamp(new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`)) : null);

// ---- The calendar's cards, kept here and brought up to date (only what changed since last time) ----
const items = new Map();
let rev = 0, bookings = [], loadedAt = 0;
async function load(force = false) {
  if (!force && Date.now() - loadedAt < 30000) return;
  const [r, b] = await Promise.all([api(`${API}${rev ? `?since=${rev}` : ""}`), api("/app/api/calendar").catch(() => ({ bookings: [] }))]);
  for (const it of r.items || []) (it.deleted ? items.delete(it.id) : items.set(it.id, it));
  rev = r.rev || rev;
  bookings = b.bookings || [];
  loadedAt = Date.now();
}
// Everything on the days from..to, each { type, item, date, start, end, allDay, ro }
function entries(from, to) {
  const out = [];
  for (const it of items.values()) {
    if (it.kind === "day") {
      const as = { start: `${it.date}T00:00`, end: `${it.date}T23:59`, repeat: it.repeat === "yearly" ? { freq: "yearly" } : null };
      for (const o of occurrences(as, from, to)) out.push({ type: "day", item: it, date: o.date, start: o.start, end: o.end, allDay: true, ro: false });
      continue;
    }
    for (const o of occurrences(it, from, to)) out.push({ type: "event", item: it, date: o.date, start: o.start, end: o.end, allDay: !!it.allDay, ro: isAgent(it.id) });
  }
  for (const b of bookings) {
    const start = fromFeed(b.start), end = fromFeed(b.end) || start;
    if (!start || start.slice(0, 10) > to || end.slice(0, 10) < from) continue;
    out.push({ type: "booking", item: b, date: start.slice(0, 10), start, end, allDay: false, ro: true });
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}
const onDay = (list, d) => list.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && !(e.end.slice(0, 10) === d && e.end.slice(11) === "00:00" && e.start.slice(0, 10) < d));
const titleOf = (e) => (e.type === "booking" ? [e.item.session, e.item.name].filter(Boolean).join(" · ") || "Booking" : e.item.title || (e.type === "day" ? "Day card" : "(No title)"));
const kindOf = (e) => (e.type === "booking" ? "Booking" : e.type === "day" ? "Day card" : e.ro ? "Nova Agent's plan" : "Note card");
const keyOf = (e) => (e.type === "booking" ? `b${bookings.indexOf(e.item)}` : e.item.id);

// One card as a row: its time, its title, where
function rowOf(e) {
  const when = e.allDay ? "All day" : `${time(e.start)}<br>${time(e.end)}`;
  const where = e.type === "booking" ? e.item.email || e.item.phone || "" : e.item.location || "";
  return `<li><a class="row cal-row" data-color="${esc(e.type === "event" && !e.ro ? e.item.color || "violet" : e.type)}" href="#calendar/card/${encodeURIComponent(keyOf(e))}/${e.date}"><span class="row-lead">${when}</span><span class="row-main"><strong>${esc(titleOf(e))}</strong>${where ? `<small>${esc(where)}</small>` : ""}<small class="cal-kind">${kindOf(e)}</small></span></a></li>`;
}
// A day's cards, for Today
function dayRows(d) {
  return onDay(entries(d, d), d).map(rowOf).join("");
}

// ---- The pages: the week, a card, a new or changed card ----
section({
  id: "calendar",
  name: "Calendar",
  async draw(page, [what, a, b]) {
    try {
      await load(what === undefined || what === "week");
    } catch (err) {
      if (err.signIn) return signInCard(page, "calendar");
      throw err;
    }
    if (what === "card") return drawCard(page, a, b);
    if (what === "new") return drawForm(page, null, a || today());
    if (what === "edit") return drawForm(page, items.get(a), b);
    return drawWeek(page, what === "week" && /^\d{4}-\d{2}-\d{2}$/.test(a || "") ? a : today());
  },
});

function drawWeek(page, d) {
  const from = mondayOf(d), to = addDays(from, 6);
  const list = entries(from, to);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const t = today();
  page.innerHTML = `<div class="pager">
      <a class="btn" href="#calendar/week/${addDays(from, -7)}" aria-label="The week before">${icon("back")}</a>
      <a class="btn grow" href="#calendar/week/${t}">${from <= t && t <= to ? "This week" : `${short(from)} – ${short(to)}`}</a>
      <a class="btn" href="#calendar/week/${addDays(from, 7)}" aria-label="The week after">${icon("next")}</a>
    </div>
    <p><a class="btn main wide" href="#calendar/new/${from <= t && t <= to ? t : from}">+ New note card</a></p>
    ${days.map((day) => {
      const rows = onDay(list, day).map(rowOf).join("");
      return `<h2 class="h${day === t ? " now" : ""}">${day === t ? "Today · " : ""}${dayLabel(day)}</h2>${rows ? `<ul class="rows">${rows}</ul>` : `<p class="empty-day"><a href="#calendar/new/${day}">Nothing yet · add a note card</a></p>`}`;
    }).join("")}`;
}

function findEntry(key, date) {
  return entries(date, date).find((e) => keyOf(e) === key) || null;
}
function drawCard(page, key, date) {
  const e = findEntry(key, date);
  if (!e) {
    page.innerHTML = `<p class="note">That card isn't there any more.</p><p><a class="btn wide" href="#calendar/week/${date || today()}">Back to the week</a></p>`;
    return;
  }
  const it = e.item;
  const when = e.allDay ? `${dayLabel(e.date)}, all day` : `${dayLabel(e.start.slice(0, 10))}, ${time(e.start)} to ${e.end.slice(0, 10) !== e.start.slice(0, 10) ? `${dayLabel(e.end.slice(0, 10))}, ` : ""}${time(e.end)}`;
  const lines = [];
  if (e.type === "booking") {
    for (const [k, v] of [["Session", it.session], ["Name", it.name], ["Email", it.email], ["Phone", it.phone], ["Price", it.price]]) if (v) lines.push(`<p><span class="muted">${k}</span><br>${k === "Email" ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : k === "Phone" ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : esc(v)}</p>`);
  } else {
    if (it.location) lines.push(`<p><span class="muted">Where</span><br>${esc(it.location)}</p>`);
    if (it.body || it.info) lines.push(`<p class="pre">${esc(it.body || it.info)}</p>`);
    if (it.repeat) lines.push(`<p class="muted">Repeats${typeof it.repeat === "string" ? ` ${esc(it.repeat)}` : it.repeat.freq ? ` ${esc(it.repeat.freq)}` : ""}</p>`);
    if (it.author) lines.push(`<p class="muted">By ${esc(it.author)}</p>`);
  }
  // What can be done with it here: a one-off note card is changed or deleted here; anything else in the
  // computer version's Calendar (a repeating card, a day card), or not at all (a booking, Nova Agent's plan)
  const mine = e.type === "event" && !e.ro;
  const here = mine && !it.repeat;
  page.innerHTML = `<div class="card"><p class="cal-kind">${kindOf(e)}</p><h2 class="title">${esc(titleOf(e))}</h2><p>${esc(when)}</p>${lines.join("")}</div>
    <div class="btns">
      ${here ? `<a class="btn main" href="#calendar/edit/${encodeURIComponent(it.id)}/${e.date}">Change</a><button type="button" class="btn" data-del="${esc(it.id)}" data-date="${e.date}">Delete</button>` : ""}
      ${mine && !here || e.type === "day" ? `<a class="btn" href="${computerLink("/calendar/")}">${icon("open")} Change it in the computer version</a>` : ""}
      ${e.type === "booking" ? `<p class="muted">Bookings come from the studio's booking diary; they're changed there.</p>` : ""}
      ${e.ro && e.type === "event" ? `<p class="muted">Part of Nova Agent's plan: it's changed by Nova Agent, in Agent.</p>` : ""}
    </div>
    <p><a class="btn wide" href="#calendar/week/${e.date}">${icon("back")} Back to the week</a></p>`;
}

// A note card's page to fill in: new, or changing a one-off one
function drawForm(page, it, date) {
  if (it && (it.repeat || isAgent(it.id) || it.kind !== "event")) return drawCard(page, it.id, date || it.start.slice(0, 10));
  const d = it ? it.start.slice(0, 10) : date;
  const allDay = it ? !!it.allDay : false;
  const st = it ? time(it.start) : "10:00", en = it ? time(it.end) : "11:00";
  const color = it?.color || "violet";
  page.innerHTML = `<form class="stack form" id="cal-form">
      <label>Title<input name="title" required maxlength="200" value="${esc(it?.title || "")}" autocomplete="off"></label>
      <label>Day<input name="date" type="date" required value="${d}"></label>
      <label class="check"><input name="allDay" type="checkbox"${allDay ? " checked" : ""}> All day</label>
      <div class="two"><label>Starts<input name="start" type="time" value="${st}"></label><label>Ends<input name="end" type="time" value="${en}"></label></div>
      <label>Where<input name="location" maxlength="300" value="${esc(it?.location || "")}"></label>
      <label>Notes<textarea name="body" rows="5">${esc(it?.body || "")}</textarea></label>
      <fieldset class="colors"><legend>Colour</legend>${COLORS.map((c) => `<label class="color" data-color="${c}"><input type="radio" name="color" value="${c}"${c === color ? " checked" : ""}><span>${c[0].toUpperCase() + c.slice(1)}</span></label>`).join("")}</fieldset>
      <p class="form-said" id="cal-said" role="status"></p>
      <div class="btns"><button class="btn main" type="submit">${it ? "Save" : "Add"}</button><a class="btn" href="${it ? `#calendar/card/${encodeURIComponent(it.id)}/${d}` : `#calendar/week/${d}`}">Cancel</a></div>
    </form>`;
  const form = page.querySelector("#cal-form");
  const times = () => form.querySelector(".two").toggleAttribute("hidden", form.elements.allDay.checked);
  form.elements.allDay.addEventListener("change", times);
  times();
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    // (each box by its name in the form's own list: form.title would be the form's tooltip, not the Title box)
    const f = form.elements;
    const day = f.date.value;
    let start = `${day}T${f.allDay.checked ? "00:00" : f.start.value || "00:00"}`;
    let end = f.allDay.checked ? `${addDays(day, 1)}T00:00` : `${day}T${f.end.value || f.start.value || "00:00"}`;
    if (end <= start && !f.allDay.checked) end = `${addDays(day, 1)}T${f.end.value || "00:00"}`;
    const card = { ...(it || {}), kind: "event", title: f.title.value.trim(), start, end, allDay: f.allDay.checked, location: f.location.value.trim(), body: f.body.value, color: f.color.value };
    const { out, sent } = stamped(card, (id) => items.get(id), new Date().toISOString(), () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));
    const said = form.querySelector("#cal-said");
    form.querySelector("[type=submit]").disabled = true;
    said.textContent = "Saving…";
    try {
      const r = await api(`${API}/${encodeURIComponent(out.id)}`, { method: "PUT", body: JSON.stringify(sent) });
      if (r.ok === false && r.current) {
        items.set(r.current.id, r.current);
        said.textContent = "Someone changed this card meanwhile; theirs is kept. Showing it now.";
        setTimeout(() => (location.hash = `#calendar/card/${encodeURIComponent(r.current.id)}/${r.current.start.slice(0, 10)}`), 1600);
        return;
      }
      items.set(out.id, r.item || out);
      rev = r.rev || rev;
      location.hash = `#calendar/card/${encodeURIComponent(out.id)}/${day}`;
    } catch (err) {
      said.textContent = err.signIn ? "Signed out: sign in, then save again." : `Not saved (${err.message}). Try again.`;
      form.querySelector("[type=submit]").disabled = false;
    }
  });
}

// Delete: a second tap to be sure (no pop-up), then gone
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-del]");
  if (!b) return;
  if (!b.dataset.sure) {
    b.dataset.sure = "1";
    b.textContent = "Tap again to delete";
    b.classList.add("danger");
    setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = "Delete"; b.classList.remove("danger"); } }, 4000);
    return;
  }
  const id = b.dataset.del;
  b.disabled = true;
  try {
    const r = await api(`${API}/${encodeURIComponent(id)}?updated=${encodeURIComponent(new Date().toISOString())}`, { method: "DELETE" });
    if (r.current) items.set(r.current.id, r.current);
    else items.delete(id);
    rev = r.rev || rev;
    location.hash = `#calendar/week/${b.dataset.date}`;
  } catch (err) {
    b.disabled = false;
    b.textContent = `Not deleted (${err.message})`;
  }
});

window.NovaPhone.cal = { load, dayRows };
