// Calendar: month, week, day and list views of the studio's note cards and day cards, with
// Nova Agent's plan (Quests), studio bookings and the real sky (moon phases, seasonal days)
// alongside. Add, change, move, repeat, remind and delete (with Undo); every note card and
// day card has its own painted artwork (cosmos.js, loaded when first needed). Everything
// saves through data.js (Nova Bot), works offline, and is the same on every device.
// (A note card is stored as kind "event".) Times are UK time.

import * as data from "./data.js";
import { addDays, addMinutes, cleanRepeat, dayNumber, describeRepeat, endSeriesBefore, minutesBetween, occurrences, weekday } from "./recur.js";
import { parseQuick } from "./quickadd.js";
import { ruleChanged as rulesDiffer, whichTimes } from "./edits.js";

const $ = (id) => document.getElementById(id);
// The look's second half (sheet, banners, title styles, menus): added now, so it never holds up the first screen
{
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "css/extras.css";
  document.head.appendChild(link);
  // …and the cosmic makeover last, so it has the final say
  const cosmos = document.querySelector('link[href="css/cosmos.css"]');
  if (cosmos) document.head.appendChild(cosmos);
}
const view = $("view");
const sfx = (n) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(n);
const presets = () => (window.NT && window.NT.presets) || { list: () => [], get: () => ({ icon: "sparkle", label: "Day" }), icon: () => "", aesthetics: () => [] };
const THEMES = () => window.NT && window.NT.themes;
const SKY = () => window.NT && window.NT.sky;
const COS = () => window.NT && window.NT.cosmos;
// A line icon from presets.js, as markup
const iconOf = (name) => (window.NT && window.NT.presets ? window.NT.presets.icon(name) : "");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COLORS = ["violet", "rose", "blue", "teal", "green", "amber", "orange", "red", "grey"];
const REMINDERS = [[0, "At start"], [10, "10 min"], [30, "30 min"], [60, "1 hour"], [1440, "1 day"]];
const PREFS = "nova-calendar/prefs";
const SUBJECTS = ["planet", "galaxy", "nebula", "binary", "comet", "blackhole", "constellation", "eclipse", "supernova", "orbit", "aurora", "crescent"];
const isAgent = (id) => /^(quest|block|mile|music)-/.test(String(id || ""));
const pad = (n) => String(n).padStart(2, "0");
const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const phone = () => matchMedia("(max-width: 719px)").matches;

// ---- UK time ----
const LONDON = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localStamp(date = new Date()) {
  const p = Object.fromEntries(LONDON.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const today = () => localStamp().slice(0, 10);
const fromFeed = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? localStamp(new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`)) : null);
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
const dayLabel = (d) => `${WD[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
const fmtTime = (s) => s.slice(11, 16);

// ---- What's shown ----
let prefs = { view: "month", layers: { events: true, days: true, quests: true, bookings: true, sky: true } };
try {
  const p = JSON.parse(localStorage.getItem(PREFS) || "null");
  if (p) prefs = { view: ["month", "week", "day", "list"].includes(p.view) ? p.view : "month", layers: { ...prefs.layers, ...(p.layers || {}) } };
} catch {}
const savePrefs = () => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {}
};
let cursor = today();
// Opened on a particular day (Quests' "Also coming up" opens /calendar/?day=2026-10-14)
try {
  const asked = new URLSearchParams(location.search).get("day") || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(asked)) cursor = asked;
} catch {}
let query = "";
let bookings = [];
let scrolledFor = "";

// ---- Themes, the sky and artwork ----
// The app theme is Nova Agent's (Options); a day card can wear its own. Nova Agent's first six
// themes have a twin here (Cosmic is Novacane, Ember is Solar Flare…); its spectrum themes and
// Custom come from look.js, so a day card on "App theme" always matches the rest of Nova Agent.
const TWINS = { cosmic: "novacane", ember: "solar", ocean: "pulsar", gold: "eclipse" };
function appTheme() {
  const id = window.NovaThemes && window.NovaThemes.current ? window.NovaThemes.current() : "";
  const t = THEMES();
  if (TWINS[id]) return TWINS[id];
  if (t && t.list().some((x) => x.id === id)) return id;
  return id && window.NovaLook && window.NovaLook.palette && window.NovaLook.palette(id) ? id : "novacane";
}
const dayTheme = (day) => (!day.theme || day.theme === "app" ? appTheme() : day.theme);
const themeStyle = (id) => (THEMES() ? THEMES().style(id) : "");
// The day card on a date (yearly ones every year), if any
function dayCardOn(date) {
  return data.items().find((it) => it.kind === "day" && (it.date === date || (it.repeat === "yearly" && it.date.slice(5) === date.slice(5) && it.date <= date)));
}
// A note card's art takes the theme of the day card on its day, else the app's
const noteTheme = (date) => {
  const day = date && dayCardOn(date);
  return day ? dayTheme(day) : appTheme();
};
// A steady number from a string (FNV-1a), so a note card without saved art still gets the same picture everywhere
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);
// The painter (28 KB) loads when there's art to show, after the first screen
let cosmosLoading = null;
function needCosmos() {
  if (COS() || cosmosLoading) return;
  cosmosLoading = new Promise((done) => {
    const go = () => {
      // Never ahead of the calendar itself: first its data and its first screen
      if (!data.status().loaded) return setTimeout(go, 300);
      const tag = document.createElement("script");
      tag.src = "js/cosmos.js";
      tag.onload = () => {
        done();
        render();
        refreshSheetArt();
      };
      tag.onerror = done;
      document.head.appendChild(tag);
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(go);
  });
}
function noteArt(it, date, w, h, type) {
  const c = COS();
  if (!c) return needCosmos(), "";
  const art = it.art || { seed: hash32(String(it.id || "")), subject: "auto" };
  return c.render({ seed: art.seed >>> 0, subject: art.subject || "auto", theme: noteTheme(date), w, h, type });
}
function dayArt(day, w, h, type) {
  const c = COS();
  if (!c) return needCosmos(), "";
  return c.render({ seed: c.hash(`${day.id}|${day.artSalt || ""}`), subject: c.aestheticSubject(day.aesthetic || "nebula"), theme: dayTheme(day), w, h, type });
}
// Pictures are painted after the screen is drawn, one at a time when the page is idle, so they
// never hold anything up (a painted one is kept, so drawing again is instant)
let painting = 0;
function paintArt() {
  if (!view.querySelector("[data-art-note]:not([data-painted]), [data-art-day]:not([data-painted])")) return;
  if (!COS()) return needCosmos();
  const run = ++painting;
  const next = () => {
    if (run !== painting) return;
    const el = view.querySelector("[data-art-note]:not([data-painted]), [data-art-day]:not([data-painted])");
    if (!el) return;
    el.dataset.painted = "1";
    if (el.dataset.artDay) {
      const day = data.get(el.dataset.artDay);
      const url = day && dayArt(day, phone() ? 640 : 960, phone() ? 214 : 320);
      if (url) el.style.setProperty("--art", `url('${url}')`);
    } else {
      const it = data.get(el.dataset.artNote);
      const url = it && noteArt(it, el.dataset.date, 192, 108);
      if (url) {
        el.style.backgroundImage = `url('${url}')`;
        el.classList.add("on");
      }
    }
    (window.requestIdleCallback || ((f) => setTimeout(f, 16)))(next);
  };
  (window.requestIdleCallback || ((f) => setTimeout(f, 16)))(next);
}

// The sky (moon, special days, the month's strip) is drawn a moment after the first screen,
// so the calendar itself shows as fast as before; its room is kept so nothing jumps
let skyDrawn = false;
const pageStart = Date.now();
function drawSkySoon() {
  if (skyDrawn || drawSkySoon.asked) return;
  drawSkySoon.asked = true;
  const go = () => {
    // After the calendar's own data (or a moment, if it's offline or signed out)
    if (!data.status().loaded && Date.now() - pageStart < 1500) return setTimeout(go, 150);
    (window.requestIdleCallback || ((f) => setTimeout(f, 50)))(() => {
      // sky.js (moon phases and special days) loads now, not with the first screen
      const done = () => {
        skyDrawn = true;
        render();
      };
      if (SKY()) return done();
      const tag = document.createElement("script");
      tag.src = "js/sky.js";
      tag.onload = done;
      tag.onerror = done;
      document.head.appendChild(tag);
    }, { timeout: 600 });
  };
  go();
}
// The moon on a day: a small mark on the four principal phases (full moons in gold)
function moonMark(d, size = 13) {
  const s = SKY();
  if (!s || !prefs.layers.sky || !skyDrawn) return "";
  const m = s.moon(d);
  if (!m.principal) return "";
  return `<span class="moonmark${m.fullName ? " full" : ""}" title="${esc(m.fullName ? `${m.principal} · ${m.fullName}` : m.principal)}">${s.moonSVG(m.fraction, size)}</span>`;
}
// Seasonal and cosmic days (Easter, Bonfire Night, solstices, meteor showers…), unless a day card already is that day
function skyDays(d) {
  const s = SKY();
  if (!s || !prefs.layers.sky || !skyDrawn) return [];
  const card = dayCardOn(d);
  return s.seasonalOn(d).filter((x) => !(card && (card.preset === x.preset || card.title === x.title)));
}

// Everything that happens between two dates, as entries to draw
function entries(from, to) {
  const out = [];
  for (const it of data.items()) {
    if (it.kind === "day") {
      if (!prefs.layers.days) continue;
      const as = { start: `${it.date}T00:00`, end: `${it.date}T23:59`, repeat: it.repeat === "yearly" ? { freq: "yearly" } : null };
      for (const o of occurrences(as, from, to)) out.push({ type: "day", item: it, date: o.date, start: o.start, end: o.end, allDay: true, color: "book" });
      continue;
    }
    const agent = isAgent(it.id);
    if (agent ? !prefs.layers.quests : !prefs.layers.events) continue;
    for (const o of occurrences(it, from, to)) {
      out.push({ type: "event", item: it, date: o.date, start: o.start, end: o.end, allDay: !!it.allDay, ro: agent, color: agent ? "quest" : it.color || "violet" });
    }
  }
  if (prefs.layers.bookings) {
    for (const b of bookings) {
      const start = fromFeed(b.start);
      const end = fromFeed(b.end) || start;
      if (!start || start.slice(0, 10) > to || end.slice(0, 10) < from) continue;
      out.push({ type: "booking", item: b, date: start.slice(0, 10), start, end, allDay: false, ro: true, color: "book" });
    }
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}
const titleOf = (e) => (e.type === "booking" ? [e.item.session, e.item.name].filter(Boolean).join(" · ") || "Booking" : e.item.title || (e.type === "day" ? presets().get(e.item.preset).label : "(No title)"));
const onDay = (list, d) => list.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && !(e.end.slice(0, 10) === d && e.end.slice(11) === "00:00" && e.start.slice(0, 10) < d));

// ---- Drawing ----
function render() {
  document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === prefs.view)));
  $("title-text").textContent = titleText();
  if (prefs.view === "month") drawMonth();
  else if (prefs.view === "list") drawList();
  else drawTimeGrid(prefs.view === "week" ? 7 : 1);
  drawStatus();
  paintArt();
  drawSkySoon();
}
function titleText() {
  const [y, m] = [cursor.slice(0, 4), Number(cursor.slice(5, 7))];
  if (prefs.view === "month") return `${MONTHS[m - 1]} ${y}`;
  if (prefs.view === "day") return `${WD_LONG[weekday(cursor)].slice(0, 3)} ${Number(cursor.slice(8))} ${MONTHS[m - 1]}`;
  if (prefs.view === "week") {
    const a = mondayOf(cursor);
    const b = addDays(a, 6);
    const ma = MONTHS[Number(a.slice(5, 7)) - 1].slice(0, 3);
    const mb = MONTHS[Number(b.slice(5, 7)) - 1].slice(0, 3);
    return ma === mb ? `${Number(a.slice(8))}–${Number(b.slice(8))} ${mb} ${b.slice(0, 4)}` : `${Number(a.slice(8))} ${ma} – ${Number(b.slice(8))} ${mb}`;
  }
  return query ? "Search" : `From ${dayLabel(cursor)}`;
}

function pillHtml(e) {
  if (e.type === "day") {
    const p = presets().get(e.item.preset);
    return `<div class="daycard themed" style="${themeStyle(dayTheme(e.item))}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day">${iconOf(p.icon)}<span>${esc(titleOf(e))}</span></div>`;
  }
  // The title in full (it wraps rather than being cut short) and, under it, what it's for
  const what = whatOf(e);
  return `<div class="pill${e.ro ? " ro" : ""}${e.type === "booking" ? " book" : ""}" data-color="${esc(e.color)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}" title="${esc(titleOf(e))}${what ? ` — ${esc(what)}` : ""}"><i class="pill-sym" aria-hidden="true">${iconOf(symbolOf(e))}</i>${e.allDay ? "" : `<b>${fmtTime(e.start)}</b>`}<span>${esc(titleOf(e))}</span>${what ? `<small>${esc(what)}</small>` : ""}</div>`;
}
// A symbol for what a card is about (shown when its day is too small for words)
const SYMBOLS = [
  [/record|recording|vocal|sing|mic|podcast|voice|studio/i, "mic"], [/mix|master|beat|song|track|music|ep\b|album|release|gig|concert|rehears/i, "note"],
  [/lesson|class|course|study|learn|tutor|school|exam/i, "cap"], [/listen|playlist|headphone|audio/i, "headphones"],
  [/meet|meeting|call with|team|crew|band|session with|catch.?up/i, "people"], [/gym|workout|run|walk|yoga|train|exercise|steps/i, "dumbbell"],
  [/lunch|dinner|breakfast|eat|food|cook|meal/i, "plate"], [/flight|fly|travel|trip|holiday|airport/i, "plane"],
  [/phone|call\b|ring/i, "phone"], [/write|lyrics|note|journal|draft|edit\b|script/i, "pen"], [/video|film|reel|shoot|camera|youtube|tiktok/i, "film"],
  [/read|book/i, "book"], [/email|mail|reply|send/i, "mail"], [/birthday|bday/i, "cake"], [/date|love|anniversary/i, "heart"],
];
function symbolOf(e) {
  if (e.type === "booking") return "user";
  const text = `${titleOf(e)} ${(e.item && (e.item.notes || e.item.location)) || ""}`;
  for (const [re, ico] of SYMBOLS) if (re.test(text)) return ico;
  return e.ro ? "flag" : "sparkle";
}
// What a card is for, in a line: its notes (first line), else where it is
function whatOf(e) {
  const it = e.item || {};
  const text = String(it.notes || it.body || it.info || "").replace(/<[^>]*>/g, " ").split(/\n/)[0].trim();
  return (text || (e.type === "booking" ? "" : it.location || "")).slice(0, 90);
}
function skyChip(x) {
  return `<div class="skychip" title="${esc(x.title)}">${iconOf(presets().get(x.preset).icon)}<span>${esc(x.title)}</span></div>`;
}

// The day in words, with smaller forms for smaller days (the CSS shows the one that fits), always
// written the British way whatever the browser's language: "Nineteenth Day October", "19 Oct",
// "19/10", "19"
const ORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth", "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth", "Twenty-first", "Twenty-second", "Twenty-third", "Twenty-fourth", "Twenty-fifth", "Twenty-sixth", "Twenty-seventh", "Twenty-eighth", "Twenty-ninth", "Thirtieth", "Thirty-first"];
function dayWords(d) {
  const day = Number(d.slice(8)), mon = Number(d.slice(5, 7));
  return `<span class="n-long">${ORD[day]} Day ${MONTHS[mon - 1]}</span><span class="n-mid">${day} ${MONTHS[mon - 1].slice(0, 3)}</span><span class="n-short">${day}/${mon}</span><span class="n-min">${day}</span>`;
}
function drawMonth() {
  const first = `${cursor.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const nextMonth = Number(cursor.slice(5, 7)) === 12 ? `${Number(cursor.slice(0, 4)) + 1}-01-01` : `${cursor.slice(0, 4)}-${pad(Number(cursor.slice(5, 7)) + 1)}-01`;
  const end = addDays(nextMonth, -1);
  const weeks = Math.ceil((dayNumber(end) - dayNumber(start) + 1) / 7);
  const gridEnd = addDays(start, weeks * 7 - 1);
  const all = entries(start, gridEnd);
  const t = today();
  const max = phone() ? 4 : 3;
  let cells = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const list = onDay(all, d);
    const days = list.filter((e) => e.type === "day");
    const rest = list.filter((e) => e.type !== "day");
    const shown = rest.slice(0, max);
    const sky = days.length ? [] : skyDays(d).slice(0, 1);
    const room = Math.max(1, max - sky.length);
    const fits = rest.slice(0, room);
    cells += `<button type="button" class="cell${d.slice(0, 7) !== cursor.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}${d === cursor ? " sel" : ""}${days.length ? " has-day" : ""}" data-date="${d}"${days.length ? ` style="${themeStyle(dayTheme(days[0].item))}"` : ""} aria-label="${dayLabel(d)}${list.length ? `, ${list.length} item${list.length > 1 ? "s" : ""}` : ""}">
      <span class="num">${dayWords(d)}</span>${moonMark(d)}${days.slice(0, 1).map(pillHtml).join("")}${sky.map(skyChip).join("")}${fits.map(pillHtml).join("")}${rest.length - fits.length + Math.max(0, days.length - 1) > 0 ? `<span class="more" data-n="${rest.length - fits.length + Math.max(0, days.length - 1)}">+${rest.length - fits.length + Math.max(0, days.length - 1)} more</span>` : ""}</button>`;
  }
  const heads = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => `<span>${phone() ? w[0] : w}</span>`).join("");
  view.innerHTML = `<div class="month">${stripHtml()}<div class="wk-head">${heads}</div><div class="grid">${cells}</div>${dayPlanHtml(cursor)}</div>`;
  fitMonth();
}
// Nothing cut off. Each day steps down only as far as it needs: the small line goes, then titles
// take one line, then the times go (symbol and title), then its cards become just their symbols.
// If a day still can't fit, every day's number goes short (and days that then have room get their
// words back), and a day that still can't hold all its cards shows the rest as "+N" (all of them
// are in its list). When the chosen day sits below the month, the month keeps the screen's height.
const STEPS = ["fit-1", "fit-2", "fit-3", "sym"];
function fitMonth() {
  const grid = view.querySelector(".month .grid");
  if (!grid) return;
  const cells = [...grid.children];
  const over = (c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1;
  grid.classList.remove("fit-4");
  grid.style.height = grid.style.flex = "";
  for (const c of cells) {
    c.classList.remove(...STEPS);
    for (const p of c.querySelectorAll(".fit-hide")) p.classList.remove("fit-hide");
    const extra = c.querySelector(":scope > .more:not([data-n])");
    if (extra) extra.remove();
  }
  const plan = view.querySelector(".month > .dayplan");
  if (!phone() && plan && plan.getBoundingClientRect().top >= grid.getBoundingClientRect().bottom - 1) {
    const top = grid.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;
    grid.style.height = `${Math.max((cells.length / 7) * 56, view.clientHeight - top)}px`;
    grid.style.flex = "none";
  }
  for (const c of cells) for (const step of STEPS) if (over(c)) c.classList.add(step);
  if (cells.some(over)) {
    // Short numbers make room: a day that then fits its words again gets them back
    grid.classList.add("fit-4");
    for (const c of cells.filter((x) => x.classList.contains("sym"))) {
      c.classList.remove("sym");
      if (over(c)) c.classList.add("sym");
    }
  }
  const symbols = cells[0] && getComputedStyle(cells[0]).getPropertyValue("--sym").trim() === "1";
  for (const c of cells) {
    let more = c.querySelector(":scope > .more");
    let hidden = 0;
    const label = () => {
      const n = Number(more.dataset.n || 0) + hidden;
      more.textContent = symbols || c.classList.contains("sym") ? `+${n}` : `+${n} more`;
    };
    if (more) label();
    const pills = [...c.querySelectorAll(":scope > .pill")];
    while (over(c) && pills.length) {
      pills.pop().classList.add("fit-hide");
      hidden++;
      if (!more) {
        more = document.createElement("span");
        more.className = "more";
        c.appendChild(more);
      }
      label();
    }
  }
}
// This month at a glance: day cards, full moons and special days, each a tap away
function stripHtml() {
  if (!skyDrawn) return prefs.layers.sky || prefs.layers.days ? `<div class="strip" aria-hidden="true"></div>` : "";
  const first = `${cursor.slice(0, 7)}-01`;
  const last = addDays(Number(cursor.slice(5, 7)) === 12 ? `${Number(cursor.slice(0, 4)) + 1}-01-01` : `${cursor.slice(0, 4)}-${pad(Number(cursor.slice(5, 7)) + 1)}-01`, -1);
  const items = [];
  for (const e of entries(first, last)) if (e.type === "day") items.push({ d: e.date, html: `<button type="button" class="strip-item themed" style="${themeStyle(dayTheme(e.item))}" data-pick="${e.date}"><b>${Number(e.date.slice(8))}</b>${iconOf(presets().get(e.item.preset).icon)}<span>${esc(titleOf(e))}</span></button>` });
  if (SKY() && prefs.layers.sky) {
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const m = SKY().moon(d);
      if (m.fullName) items.push({ d, html: `<button type="button" class="strip-item moon" data-pick="${d}"><b>${Number(d.slice(8))}</b>${SKY().moonSVG(0.5, 14)}<span>${esc(m.fullName)}</span></button>` });
      for (const x of skyDays(d)) items.push({ d, html: `<button type="button" class="strip-item sky" data-pick="${d}"><b>${Number(d.slice(8))}</b>${iconOf(presets().get(x.preset).icon)}<span>${esc(x.title)}</span></button>` });
    }
  }
  if (!items.length) return "";
  return `<div class="strip" aria-label="This month">${items.sort((a, b) => a.d.localeCompare(b.d)).map((x) => x.html).join("")}</div>`;
}

function rowHtml(e) {
  const where = e.type === "booking" ? e.item.phone || e.item.email || "" : e.item.location || "";
  const sub = [
    e.type === "event" && e.item.repeat ? describeRepeat(e.item.repeat) : "",
    e.ro && e.type === "event" ? "Nova Agent's plan" : "",
    e.type === "booking" ? "Studio booking" : "",
    // (its kind, unless the title already says it: "Studio Session" once, not twice)
    e.type === "day" && presets().get(e.item.preset).label !== titleOf(e) ? presets().get(e.item.preset).label : "",
    where,
    e.type === "event" && !e.ro && e.item.author ? `by ${e.item.author}` : "",
  ].filter(Boolean).join(" · ");
  if (e.type === "day") {
    const p = presets().get(e.item.preset);
    return `<li><button type="button" class="row-item day themed" style="${themeStyle(dayTheme(e.item))}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day"><time class="ico-time">${iconOf(p.icon)}</time><span><strong>${esc(titleOf(e))}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button></li>`;
  }
  const when = e.allDay ? "All day" : `${fmtTime(e.start)}<br>${fmtTime(e.end)}`;
  const art = e.type === "event" && !e.ro;
  // Quests and bookings have no picture: their symbol sits in its place, so every row's times line up
  const lead = art ? `<span class="art" data-art-note="${esc(e.item.id)}" data-date="${e.date}"></span>` : `<span class="row-sym" aria-hidden="true">${iconOf(symbolOf(e))}</span>`;
  return `<li><button type="button" class="row-item note has-art${e.ro ? " ro" : ""}" data-color="${esc(e.color)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}">${lead}<time>${when}</time><span><strong>${esc(titleOf(e))}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button></li>`;
}
function dayPlanHtml(d) {
  // On a phone the chosen day sits below the month: it's drawn with the sky, a moment after the month
  if (!skyDrawn && phone()) return `<section class="dayplan" aria-label="${dayLabel(d)}"></section>`;
  const list = onDay(entries(d, d), d);
  const days = list.filter((e) => e.type === "day");
  const rest = list.filter((e) => e.type !== "day");
  const sky = skyDays(d);
  let moon = "";
  if (SKY() && prefs.layers.sky && skyDrawn) {
    const m = SKY().moon(d);
    const line = m.principal ? `${m.principal}${m.fullName ? ` · ${m.fullName}` : ""}` : `${m.name} · ${Math.round(m.illumination * 100)}% lit`;
    moon = `<p class="dp-moon">${SKY().moonSVG(m.fraction, 22)}<span>${esc(line)}</span></p>`;
  }
  const banners = days
    .map((e) => {
      const p = presets().get(e.item.preset);
      return `<button type="button" class="dc-banner themed aes-${esc(e.item.aesthetic || "nebula")}" style="${themeStyle(dayTheme(e.item))}" data-art-day="${esc(e.item.id)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day"><span class="dc-kicker">${iconOf(p.icon)}${esc(p.label)}${e.item.repeat === "yearly" ? " · every year" : ""}</span><b class="dc-title">${esc(titleOf(e))}</b>${e.item.info ? `<small>${esc(e.item.info.split("\n")[0])}</small>` : ""}</button>`;
    })
    .join("");
  const specials = sky
    .map((x) => `<div class="sky-row">${iconOf(presets().get(x.preset).icon)}<span>${esc(x.title)}</span><button type="button" data-make-day="${esc(JSON.stringify({ date: d, ...x }))}">Make it a day card</button></div>`)
    .join("");
  return `<section class="dayplan" aria-label="${dayLabel(d)}">
    <div class="dp-head"><div><span class="dp-kicker">${d === today() ? "Today" : WD_LONG[weekday(d)]}</span><h3>${dayLabel(d)}</h3>${moon}</div>
      <div class="dp-add"><button type="button" data-add="${d}">+ Note card</button><button type="button" data-add-day="${d}">+ Day card</button></div></div>
    ${banners}${specials}${
      rest.length ? `<ul class="rows">${rest.map(rowHtml).join("")}</ul>` : `<p class="empty">No note cards. Tap + Note card, or a time in Day view.</p>`
    }</section>`;
}

function drawList() {
  let html = "";
  if (query) {
    const q = query.toLowerCase();
    const hits = entries(addDays(today(), -365), addDays(today(), 365)).filter((e) => [titleOf(e), e.item.location, e.item.body, e.item.info, e.item.name].some((v) => v && String(v).toLowerCase().includes(q)));
    // Each item once: its next time (or its last, if it's all in the past)
    const seen = new Map();
    for (const e of hits) {
      const k = `${e.type}:${e.item.id}`;
      const had = seen.get(k);
      if (!had || (had.date < today() && e.date >= today()) || (e.date >= today() && e.date < had.date)) seen.set(k, e);
    }
    const list = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
    html = list.length ? groupRows(list) : `<p class="empty">Nothing matches “${esc(query)}”.</p>`;
  } else {
    const list = entries(cursor, addDays(cursor, 59));
    html = list.length ? groupRows(list.filter((e) => e.date >= cursor || e.end.slice(0, 10) >= cursor)) : `<p class="empty">Nothing in the next 60 days. Tap + to add a note card.</p>`;
  }
  view.innerHTML = `<div class="list">${html}</div>`;
}
function groupRows(list) {
  const by = new Map();
  for (const e of list) {
    const d = e.date < cursor && !query ? cursor : e.date;
    if (!by.has(d)) by.set(d, []);
    by.get(d).push(e);
  }
  return [...by.entries()].map(([d, es]) => `<h4>${d === today() ? "Today · " : ""}${dayLabel(d)}${d.slice(0, 4) !== today().slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}</h4><ul class="rows">${es.map(rowHtml).join("")}</ul>`).join("");
}

// Week and day: a column per day, events placed by time
function hourHeight() {
  return phone() ? 44 : 52;
}
function layoutColumn(evs) {
  // Events that overlap share the width; each group of overlapping ones is laid out together
  const placed = [];
  let group = [];
  let groupEnd = "";
  const flush = () => {
    const cols = [];
    for (const e of group) {
      let c = cols.findIndex((end) => end <= e.start);
      if (c < 0) c = cols.length;
      cols[c] = e.end;
      e.col = c;
    }
    for (const e of group) e.cols = cols.length;
    placed.push(...group);
    group = [];
    groupEnd = "";
  };
  for (const e of evs.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end))) {
    if (group.length && e.start >= groupEnd) flush();
    group.push(e);
    if (e.end > groupEnd) groupEnd = e.end;
  }
  flush();
  return placed;
}
function drawTimeGrid(n) {
  const first = n === 7 ? mondayOf(cursor) : cursor;
  const days = Array.from({ length: n }, (_, i) => addDays(first, i));
  const all = entries(addDays(first, -1), addDays(first, n));
  const hh = hourHeight();
  const t = today();
  const now = localStamp();
  const head = days
    .map((d) => `<button type="button" class="tg-day${d === t ? " today" : ""}" data-goto="${d}"><small>${WD[weekday(d)]}</small><b>${Number(d.slice(8))}</b>${moonMark(d, 12)}</button>`)
    .join("");
  const alldayCols = days.map((d) => `<div>${onDay(all, d).filter((e) => e.allDay).map(pillHtml).join("")}</div>`).join("");
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="hour">${h ? `${pad(h)}:00` : ""}</div>`).join("");
  const cols = days
    .map((d) => {
      // The part of each timed event on this day
      const evs = all
        .filter((e) => !e.allDay && e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && e.end > `${d}T00:00`)
        .map((e) => ({ ...e, s: e.start < `${d}T00:00` ? `${d}T00:00` : e.start, en: e.end > `${d}T23:59` ? `${d}T24:00` : e.end }));
      const placed = layoutColumn(evs.map((e) => ({ ...e, start: e.s, end: e.en, orig: e })));
      const blocks = placed
        .map((p) => {
          const top = (minutesBetween(`${d}T00:00`, p.start) / 60) * hh;
          const height = Math.max(18, (Math.max(15, minutesBetween(p.start, p.end)) / 60) * hh - 2);
          const w = 100 / p.cols;
          const e = p.orig;
          return `<div class="ev${e.ro ? " ro" : ""}" data-color="${esc(e.color)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}" data-start="${e.start}" data-end="${e.end}" style="top:${top}px;height:${height}px;left:calc(${p.col * w}% + 2px);width:calc(${w}% - 4px)" tabindex="0" role="button" aria-label="${esc(titleOf(e))}, ${fmtTime(e.start)} to ${fmtTime(e.end)}"><strong>${esc(titleOf(e))}</strong><small>${fmtTime(e.start)}–${fmtTime(e.end)}${e.item.location ? ` · ${esc(e.item.location)}` : ""}</small>${whatOf(e) && whatOf(e) !== e.item.location ? `<em class="ev-what">${esc(whatOf(e))}</em>` : ""}${e.ro ? "" : '<span class="grip" data-grip="1"></span>'}</div>`;
        })
        .join("");
      const line = d === t ? `<div class="now-line" style="top:${(minutesBetween(`${d}T00:00`, now) / 60) * hh}px"></div>` : "";
      return `<div class="col${d === t ? " today" : ""}" data-date="${d}" style="height:${24 * hh}px">${blocks}${line}</div>`;
    })
    .join("");
  view.innerHTML = `<div class="tg" style="--cols:${n};--hh:${hh}px">
    <div class="tg-head" style="grid-column:1/-1;display:grid;grid-template-columns:inherit"><span></span>${head}<div class="allday">${alldayCols}</div></div>
    <div class="hours">${hours}</div>${cols}</div>`;
  // Cards squeezed narrow (several at once, or a phone's week) show just their title, wrapped,
  // so it can still be read; too thin even for that, just their colour (tap one to read it)
  for (const el of view.querySelectorAll(".col .ev")) {
    el.classList.toggle("slim", el.offsetWidth < 76);
    el.classList.toggle("thin", el.offsetWidth < 30);
  }
  // Open at the working day (or just before now, today)
  const key = `${prefs.view}:${first}`;
  if (scrolledFor !== key) {
    scrolledFor = key;
    const at = days.includes(t) ? Math.max(0, Number(now.slice(11, 13)) - 1) : 7;
    view.scrollTop = at * hh;
  }
}

function drawStatus() {
  const s = data.status();
  const el = $("status");
  let text = "";
  if (!s.signedIn) text = "Sign in with the planet at the top to see and change the studio's calendar.";
  else if (!s.online) text = s.waiting ? `Offline: ${s.waiting} change${s.waiting > 1 ? "s" : ""} will save when you're back online.` : "Offline: showing the last copy on this device.";
  else if (s.waiting) text = `Saving ${s.waiting} change${s.waiting > 1 ? "s" : ""}…`;
  el.textContent = text;
  el.hidden = !text;
}

// ---- Moving around ----
// Moving on slides the new view in from that side; switching views fades (calm motion: neither)
function animate(how) {
  view.dataset.anim = how;
  clearTimeout(animate.t);
  animate.t = setTimeout(() => delete view.dataset.anim, 320);
}
function step(dir) {
  animate(dir > 0 ? "next" : "prev");
  if (prefs.view === "month") {
    let y = Number(cursor.slice(0, 4));
    let m = Number(cursor.slice(5, 7)) + dir;
    if (m < 1) (m = 12), y--;
    if (m > 12) (m = 1), y++;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    cursor = `${y}-${pad(m)}-${pad(Math.min(Number(cursor.slice(8)), last))}`;
  } else cursor = addDays(cursor, dir * (prefs.view === "day" ? 1 : 7));
  render();
}
function setView(v) {
  if (prefs.view !== v) animate("fade");
  prefs.view = v;
  savePrefs();
  render();
}
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("today").addEventListener("click", () => {
  if (cursor.slice(0, 7) !== today().slice(0, 7)) animate(cursor < today() ? "next" : "prev");
  cursor = today();
  scrolledFor = "";
  render();
});
document.querySelector(".views").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (b) setView(b.dataset.view);
});
$("title").addEventListener("click", () => {
  const j = $("jump");
  j.value = cursor;
  try {
    j.showPicker();
  } catch {
    j.focus();
    j.click();
  }
});
$("jump").addEventListener("change", () => {
  if ($("jump").value) {
    cursor = $("jump").value;
    scrolledFor = "";
    render();
  }
});
// Swipe left and right to move (month and list)
let swipe = null;
view.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1 && (prefs.view === "month" || prefs.view === "day")) swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
view.addEventListener("touchend", (e) => {
  if (!swipe || drag) return (swipe = null);
  const dx = e.changedTouches[0].clientX - swipe.x;
  const dy = e.changedTouches[0].clientY - swipe.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - swipe.t < 600) step(dx < 0 ? 1 : -1);
  swipe = null;
}, { passive: true });

// Search
$("search-btn").addEventListener("click", () => {
  $("search").hidden = false;
  $("search-input").focus();
  if (prefs.view !== "list") setView("list");
});
$("search-input").addEventListener("input", () => {
  query = $("search-input").value.trim();
  render();
});
$("search-close").addEventListener("click", () => {
  $("search").hidden = true;
  $("search-input").value = query = "";
  render();
});

// Layers
$("layers-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const pop = $("layers");
  pop.hidden = !pop.hidden;
  pop.querySelectorAll("input").forEach((i) => (i.checked = !!prefs.layers[i.dataset.layer]));
});
$("layers").addEventListener("change", (e) => {
  const i = e.target.closest("input[data-layer]");
  if (!i) return;
  prefs.layers[i.dataset.layer] = i.checked;
  savePrefs();
  render();
});
document.addEventListener("click", (e) => {
  if (!$("layers").hidden && !e.target.closest("#layers, #layers-btn")) $("layers").hidden = true;
});

// ---- Taps on the calendar ----
view.addEventListener("click", (e) => {
  if (justDragged) return;
  const add = e.target.closest("[data-add]");
  if (add) return openNew({ date: add.dataset.add });
  const addDay = e.target.closest("[data-add-day]");
  if (addDay) return openNew({ date: addDay.dataset.addDay, kind: "day" });
  const make = e.target.closest("[data-make-day]");
  if (make) {
    const x = JSON.parse(make.dataset.makeDay);
    return openNew({ date: x.date, kind: "day", special: x });
  }
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    cursor = pick.dataset.pick;
    return render();
  }
  const go = e.target.closest("[data-goto]");
  if (go) {
    cursor = go.dataset.goto;
    return setView("day");
  }
  // On a phone the month's events are little bars: a tap picks the day (its list shows below)
  const tapped = e.target.closest(".cell");
  if (tapped && phone()) {
    cursor = tapped.dataset.date;
    return render();
  }
  const item = e.target.closest("[data-id]");
  if (item) {
    e.stopPropagation();
    return openExisting(item.dataset.type, item.dataset.id, item.dataset.date);
  }
  const cell = e.target.closest(".cell");
  if (cell) {
    if (cell.dataset.date === cursor && !phone()) return openNew({ date: cursor });
    cursor = cell.dataset.date;
    return render();
  }
  const col = e.target.closest(".col");
  if (col) {
    const rect = col.getBoundingClientRect();
    const mins = Math.floor((((e.clientY - rect.top) / hourHeight()) * 60) / 30) * 30;
    openNew({ date: col.dataset.date, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` });
  }
});
view.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".ev[data-id]")) {
    e.preventDefault();
    openExisting(e.target.dataset.type, e.target.dataset.id, e.target.dataset.date);
  }
});

// ---- Drag to move and resize (week and day) ----
let drag = null;
let justDragged = false;
function startDrag(el, x, y, resize) {
  drag = { el, x, y, resize, start: el.dataset.start, end: el.dataset.end, dMin: 0, dDay: 0, moved: false, colW: el.parentElement.getBoundingClientRect().width };
  el.classList.add("dragging");
  if (navigator.vibrate) navigator.vibrate(12);
  sfx("lift");
}
function moveDrag(x, y) {
  if (!drag) return;
  const hh = hourHeight();
  const dMin = Math.round(((y - drag.y) / hh) * 4) * 15;
  const dDay = drag.resize || prefs.view !== "week" ? 0 : Math.round((x - drag.x) / drag.colW);
  if (dMin === drag.dMin && dDay === drag.dDay) return;
  sfx("nudge");
  drag.dMin = dMin;
  drag.dDay = dDay;
  drag.moved = true;
  if (drag.resize) {
    const len = Math.max(15, minutesBetween(drag.start, drag.end) + dMin);
    drag.el.style.height = `${(len / 60) * hh - 2}px`;
  } else drag.el.style.transform = `translate(${dDay * drag.colW}px, ${(dMin / 60) * hh}px)`;
}
function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.el.classList.remove("dragging");
  if (d.moved) sfx("place");
  if (!d.moved || (!d.dMin && !d.dDay)) {
    d.el.style.transform = "";
    if (!d.moved) openExisting(d.el.dataset.type, d.el.dataset.id, d.el.dataset.date);
    justDragged = true;
    setTimeout(() => (justDragged = false), 50);
    return;
  }
  justDragged = true;
  setTimeout(() => (justDragged = false), 50);
  const it = data.get(d.el.dataset.id);
  if (!it) return render();
  const start = d.resize ? d.start : addMinutes(d.start, d.dMin + d.dDay * 1440);
  const end = d.resize ? addMinutes(d.end, d.dMin) : addMinutes(d.end, d.dMin + d.dDay * 1440);
  if (end <= start) return render();
  changeOccurrence(it, d.el.dataset.date, d.start, { start, end }, "Moved");
}
let press = null;
view.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".ev[data-id]:not(.ro)");
  if (!el || e.button > 0) return;
  const resize = !!e.target.closest("[data-grip]");
  if (e.pointerType === "mouse") {
    press = { el, x: e.clientX, y: e.clientY, resize, mouse: true };
  } else {
    // Touch: hold for a moment to pick it up (so scrolling still works)
    press = { el, x: e.clientX, y: e.clientY, resize, timer: setTimeout(() => press && startDrag(press.el, press.x, press.y, press.resize), 350) };
  }
});
addEventListener("pointermove", (e) => {
  if (drag) return moveDrag(e.clientX, e.clientY);
  if (press && press.mouse && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) startDrag(press.el, press.x, press.y, press.resize);
  else if (press && !press.mouse && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
    clearTimeout(press.timer);
    press = null;
  }
});
addEventListener("pointerup", () => {
  if (press) clearTimeout(press.timer);
  press = null;
  endDrag();
});
addEventListener("pointercancel", () => {
  if (press) clearTimeout(press.timer);
  press = null;
  if (drag) {
    drag.el.style.transform = "";
    drag.el.classList.remove("dragging");
    drag = null;
  }
});
// While something's picked up by touch, the page doesn't scroll
document.addEventListener("touchmove", (e) => {
  if (drag) {
    e.preventDefault();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });
document.addEventListener("touchend", () => drag && endDrag());

// ---- Changing one time of a repeating event ----
function askWhich(title = "Change which?") {
  return new Promise((resolve) => {
    $("which-title").textContent = title;
    $("which").hidden = false;
    $("scrim").hidden = false;
    const done = (v) => {
      $("which").hidden = true;
      if ($("sheet").hidden) $("scrim").hidden = true;
      $("which").removeEventListener("click", pick);
      resolve(v);
    };
    const pick = (e) => {
      const b = e.target.closest("button[data-which]");
      if (b) done(b.dataset.which || null);
    };
    $("which").addEventListener("click", pick);
  });
}
// it: the event; date: the day this time of it starts; was: its start then; changes: new fields
// chosen (optional): "one", "following" or "all", already asked
async function changeOccurrence(it, date, was, changes, word = "Saved", chosen = null) {
  const before = { ...it };
  if (!it.repeat) {
    data.save({ ...it, ...changes });
    toast(word, () => data.save(before));
    return render();
  }
  const which = chosen || (await askWhich());
  if (!which) return render();
  if (which === "one") {
    data.save({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
    const { id, created, ...rest } = it;
    const single = data.save({ ...rest, kind: "event", start: was, end: addMinutes(was, minutesBetween(it.start, it.end)), ...changes, repeat: null, exdates: [] });
    toast(word, () => {
      data.remove(single.id);
      data.save(before);
    });
  } else if (which === "following") {
    if (date === it.start.slice(0, 10)) return changeAll();
    data.save(endSeriesBefore(it, date));
    const { id, created, exdates, ...rest } = it;
    const repeat = cleanRepeat(it.repeat);
    if (repeat && repeat.count) delete repeat.count;
    const next = data.save({ ...rest, kind: "event", start: was, end: addMinutes(was, minutesBetween(it.start, it.end)), repeat, exdates: (it.exdates || []).filter((x) => x > date), ...changes });
    toast(word, () => {
      data.remove(next.id);
      data.save(before);
    });
  } else changeAll();
  render();
  function changeAll() {
    // Times move the whole series by the same amount; other fields change everywhere
    const out = { ...it, ...changes };
    if (changes.start) {
      const shift = minutesBetween(was, changes.start);
      out.start = addMinutes(it.start, shift);
      out.end = addMinutes(out.start, minutesBetween(changes.start, changes.end || addMinutes(changes.start, minutesBetween(it.start, it.end))));
    }
    data.save(out);
    toast(word, () => data.save(before));
  }
}

// ---- The editor ----
const form = $("form");
let editing = null; // { mode: "new" | "edit", kind, item?, date?, was?, ro? }
let picked = { reminders: [], color: "violet", days: [], aesthetic: "nebula", theme: "app" };
// The artwork being edited: a note card's seed and subject, a day card's salt
let art = { seed: 0, subject: "auto", salt: "", tempId: "" };

function fillChips() {
  $("f-reminders").innerHTML = REMINDERS.map(([m, l]) => `<button type="button" data-min="${m}" aria-pressed="${picked.reminders.includes(m)}">${l}</button>`).join("");
  fillPhones();
  $("f-colors").innerHTML = COLORS.map((c) => `<button type="button" data-color="${c}" data-pick="${c}" aria-pressed="${picked.color === c}" aria-label="${c}"></button>`).join("");
  $("f-days").innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<button type="button" data-day="${d}" aria-pressed="${picked.days.includes(d)}">${WD[d].slice(0, 2)}</button>`).join("");
  $("aes-grid").innerHTML = presets()
    .aesthetics()
    .map((a) => `<button type="button" class="aes-opt aes-${a.id}" data-aes="${a.id}" aria-pressed="${picked.aesthetic === a.id}" title="${esc(a.hint)}"><b class="dc-title">${esc(a.label)}</b></button>`)
    .join("");
  const themes = THEMES() ? THEMES().list() : [];
  $("theme-grid").innerHTML =
    `<button type="button" class="theme-opt" data-theme-pick="app" aria-pressed="${picked.theme === "app"}"><i style="${themeStyle(appTheme())}"></i>App theme</button>` +
    themes.map((t) => `<button type="button" class="theme-opt" data-theme-pick="${t.id}" aria-pressed="${picked.theme === t.id}" title="${esc(t.tag)}"><i style="${themeStyle(t.id)}"></i>${esc(t.name)}</button>`).join("");
}
$("aes-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-aes]");
  if (!b) return;
  picked.aesthetic = b.dataset.aes;
  fillChips();
  refreshSheetArt();
});
$("theme-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme-pick]");
  if (!b) return;
  picked.theme = b.dataset.themePick;
  fillChips();
  refreshSheetArt();
});
// The artwork at the top of the sheet: a note card's picture, or a day card's header
function sheetDay() {
  return { id: (editing && editing.item && editing.item.id) || art.tempId, artSalt: art.salt, aesthetic: picked.aesthetic, theme: picked.theme };
}
function refreshSheetArt() {
  if (!editing) return;
  const head = $("art-head");
  const show = !editing.ro || (editing.item && editing.item.kind === "day");
  head.hidden = !show;
  if (!show) return;
  const isDay = editing.kind === "day";
  $("note-subject").hidden = isDay;
  $("note-subject").value = art.subject;
  const src = isDay ? dayArt(sheetDay(), 960, 320) : noteArt({ id: art.tempId, art: { seed: art.seed, subject: art.subject } }, $("f-sdate").value || cursor, 640, 360);
  // A day card's header wears its theme and title style; a note card's picture just shows
  head.setAttribute("style", `${isDay ? `${themeStyle(dayTheme(sheetDay()))};` : ""}--art:${src ? `url('${src}')` : "none"}`);
  head.className = `art-head${isDay ? ` is-day aes-${picked.aesthetic}` : ""}${src ? "" : " loading"}`;
  $("art-title").textContent = $("f-title").value || (isDay ? presets().get($("d-preset").value).label : "");
}
$("note-subject").innerHTML = `<option value="auto">Art: surprise me</option>${SUBJECTS.map((x) => `<option value="${x}">Art: ${x === "blackhole" ? "Black hole" : x[0].toUpperCase() + x.slice(1)}</option>`).join("")}`;
$("note-subject").addEventListener("change", () => {
  art.subject = $("note-subject").value;
  refreshSheetArt();
});
$("art-new").addEventListener("click", () => {
  if (editing && editing.kind === "day") art.salt = Math.random().toString(36).slice(2, 10);
  else art.seed = randomSeed();
  sfx("tap");
  refreshSheetArt();
});
// Save the picture big (a note card 1920×1080, a day card's header 1920×640)
$("art-save").addEventListener("click", (e) => {
  const c = COS();
  if (!c || !editing) {
    e.preventDefault();
    return needCosmos();
  }
  const isDay = editing.kind === "day";
  const name = ($("f-title").value || (isDay ? "day card" : "note card")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
  e.currentTarget.download = `${name}.png`;
  e.currentTarget.href = isDay ? dayArt(sheetDay(), 1920, 640, "image/png") : noteArt({ id: art.tempId, art: { seed: art.seed, subject: art.subject } }, $("f-sdate").value || cursor, 1920, 1080, "image/png");
});
$("f-title").addEventListener("input", () => {
  $("art-title").textContent = $("f-title").value || (editing && editing.kind === "day" ? presets().get($("d-preset").value).label : "");
});
$("f-sdate").addEventListener("change", () => refreshSheetArt());
// Which phones get the reminders: the owner's (the default), or the ones picked here.
// The list comes from Nova Bot (the phones with notifications on, and whose they are).
let phoneList = null;
async function loadPhones() {
  if (phoneList) return phoneList;
  try {
    const r = await fetch("/app/api/push/phones", { credentials: "same-origin", headers: { Accept: "application/json" } });
    phoneList = r.ok ? (await r.json()).phones || [] : [];
  } catch {
    phoneList = [];
  }
  fillPhones();
  return phoneList;
}
function fillPhones() {
  const chosen = picked.phones || [];
  const list = phoneList || [];
  // Phones picked before that are gone now still show, so they can be taken off
  const known = new Set(list.map((p) => p.id));
  const gone = chosen.filter((id) => !known.has(id)).map((id) => ({ id, name: "A phone that's turned off", who: "" }));
  $("f-phones-row").hidden = !picked.reminders.length || (!list.length && !gone.length);
  $("f-phones").innerHTML =
    `<button type="button" data-phone="" aria-pressed="${!chosen.length}" title="The studio owner's phones">Owner's phones</button>` +
    [...list, ...gone].map((p) => `<button type="button" data-phone="${esc(p.id)}" aria-pressed="${chosen.includes(p.id)}">${esc(p.name)}${p.who ? ` · ${esc(p.who)}` : ""}</button>`).join("");
}
$("f-phones").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-phone]");
  if (!b) return;
  const id = b.dataset.phone;
  const chosen = picked.phones || [];
  picked.phones = !id ? [] : chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
  fillPhones();
});
$("f-reminders").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-min]");
  if (!b) return;
  const m = Number(b.dataset.min);
  picked.reminders = picked.reminders.includes(m) ? picked.reminders.filter((x) => x !== m) : [...picked.reminders, m];
  fillChips();
  if (picked.reminders.length) void loadPhones();
});
$("f-colors").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-pick]");
  if (b) (picked.color = b.dataset.pick), fillChips();
});
$("f-days").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-day]");
  if (!b) return;
  const d = Number(b.dataset.day);
  picked.days = picked.days.includes(d) ? picked.days.filter((x) => x !== d) : [...picked.days, d];
  fillChips();
});
$("f-allday").addEventListener("change", () => {
  $("f-stime").hidden = $("f-etime").hidden = $("f-allday").checked;
});
$("f-repeat").addEventListener("change", () => {
  $("custom").hidden = $("f-repeat").value !== "custom";
  syncCustom();
});
$("f-freq").addEventListener("change", syncCustom);
$("f-ends").addEventListener("change", syncCustom);
function syncCustom() {
  $("f-days").hidden = $("f-freq").value !== "weekly";
  $("f-until").hidden = $("f-ends").value !== "until";
  $("f-count").hidden = $("f-ends").value !== "count";
}
// Start moves, end follows (keeping the length)
let lastStart = "";
function startStamp() {
  return `${$("f-sdate").value}T${$("f-allday").checked ? "00:00" : $("f-stime").value || "09:00"}`;
}
["f-sdate", "f-stime"].forEach((id) =>
  $(id).addEventListener("change", () => {
    const now = startStamp();
    if (lastStart && $("f-edate").value) {
      const end = addMinutes(`${$("f-edate").value}T${$("f-etime").value || "10:00"}`, minutesBetween(lastStart, now));
      $("f-edate").value = end.slice(0, 10);
      $("f-etime").value = end.slice(11, 16);
    }
    lastStart = now;
  })
);

function setKind(kind) {
  editing.kind = kind;
  document.querySelectorAll("#kinds button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
  document.querySelectorAll(".group").forEach((g) => (g.hidden = g.dataset.for !== kind));
  $("quick").hidden = !(editing.mode === "new" && kind === "event");
  $("f-notes").placeholder = kind === "day" ? "About this day" : "What's it about?";
  $("sheet-title").textContent = `${editing.mode === "new" ? "New" : editing.ro ? "" : "Change"} ${kind === "day" ? "day card" : "note card"}`.trim().replace(/^./, (c) => c.toUpperCase());
  refreshSheetArt();
}
$("kinds").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-kind]");
  if (b && editing && editing.mode === "new") setKind(b.dataset.kind);
});
// Presets for day cards
$("d-preset").innerHTML = presets()
  .list()
  .map((p) => `<option value="${p.id}">${esc(p.label)}</option>`)
  .join("");
$("d-preset").addEventListener("change", () => {
  const p = presets().get($("d-preset").value);
  if (!$("f-title").value && p.title) $("f-title").value = p.title;
  if (p.repeat !== undefined) $("d-yearly").checked = !!p.repeat;
  if (p.aesthetic) picked.aesthetic = p.aesthetic;
  if (p.theme) picked.theme = p.theme;
  if (p.info && !$("f-notes").value) $("f-notes").value = p.info;
  fillChips();
  refreshSheetArt();
});

// Quick add: fill the form as you type
$("quick-input").addEventListener("input", () => {
  const r = parseQuick($("quick-input").value, today());
  if (!r.found) {
    $("quick-hint").textContent = "";
    $("f-title").value = r.title || "";
    return;
  }
  $("f-title").value = r.title;
  fillWhen(r.start, r.end, r.allDay);
  if (r.location) $("f-location").value = r.location;
  if (r.repeat) {
    $("f-repeat").value = "custom";
    $("f-freq").value = r.repeat.freq;
    $("f-interval").value = 1;
    picked.days = r.repeat.byDay || (r.repeat.freq === "weekly" ? [weekday(r.date)] : []);
    $("f-ends").value = "never";
    $("custom").hidden = false;
    syncCustom();
    fillChips();
  }
  $("quick-hint").textContent = `${dayLabel(r.date)} · ${r.words.join(" · ")}`;
});
$("quick-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    form.requestSubmit();
  }
});

function fillWhen(start, end, allDay) {
  $("f-allday").checked = !!allDay;
  $("f-sdate").value = start.slice(0, 10);
  $("f-stime").value = start.slice(11, 16);
  $("f-edate").value = end.slice(0, 10);
  $("f-etime").value = allDay ? "10:00" : end.slice(11, 16);
  $("f-stime").hidden = $("f-etime").hidden = !!allDay;
  lastStart = startStamp();
}
function fillRepeat(r) {
  const repeat = cleanRepeat(r);
  $("f-interval").value = repeat ? repeat.interval : 1;
  $("f-freq").value = repeat ? repeat.freq : "weekly";
  picked.days = repeat && repeat.byDay ? repeat.byDay : [];
  $("f-ends").value = repeat && repeat.until ? "until" : repeat && repeat.count ? "count" : "never";
  $("f-until").value = (repeat && repeat.until) || "";
  $("f-count").value = (repeat && repeat.count) || 10;
  const simple = repeat && repeat.interval === 1 && !repeat.until && !repeat.count && (repeat.freq !== "weekly" || !repeat.byDay || repeat.byDay.length <= 1);
  $("f-repeat").value = !repeat ? "" : simple ? repeat.freq : "custom";
  $("custom").hidden = $("f-repeat").value !== "custom";
  syncCustom();
}
function readRepeat(start) {
  const v = $("f-repeat").value;
  if (!v) return null;
  if (v !== "custom") return cleanRepeat({ freq: v, byDay: v === "weekly" ? [weekday(start.slice(0, 10))] : undefined });
  return cleanRepeat({
    freq: $("f-freq").value,
    interval: $("f-interval").value,
    byDay: $("f-freq").value === "weekly" ? (picked.days.length ? picked.days : [weekday(start.slice(0, 10))]) : undefined,
    until: $("f-ends").value === "until" ? $("f-until").value : undefined,
    count: $("f-ends").value === "count" ? $("f-count").value : undefined,
  });
}

function showSheet() {
  $("scrim").hidden = false;
  $("sheet").hidden = false;
  sfx("open");
}
function closeSheet() {
  $("sheet").hidden = true;
  $("scrim").hidden = true;
  editing = null;
}
$("sheet-close").addEventListener("click", closeSheet);
$("scrim").addEventListener("click", () => {
  if ($("which").hidden) closeSheet();
});

function resetForm() {
  form.reset();
  $("quick-hint").textContent = "";
  $("readonly").hidden = true;
  form.querySelectorAll("input, select, textarea, .chips button, .colors button, .wd button").forEach((el) => (el.disabled = false));
  $("save").hidden = false;
  $("actions").hidden = false;
  $("kinds").hidden = false;
}

function openNew({ date = cursor, time, kind = "event", special } = {}) {
  resetForm();
  editing = { mode: "new", kind };
  picked = { reminders: [], color: "violet", days: [], aesthetic: "nebula", theme: "app" };
  art = { seed: randomSeed(), subject: "auto", salt: Math.random().toString(36).slice(2, 10), tempId: data.uid() };
  const start = `${date}T${time || (date === today() ? nextHalfHour() : "09:00")}`;
  fillWhen(start, addMinutes(start, 60), false);
  fillRepeat(null);
  $("d-date").value = date;
  $("d-preset").value = "custom";
  $("d-yearly").checked = false;
  if (special) {
    // A seasonal or cosmic day made into a day card: its kind, name, look and theme
    const p = presets().get(special.preset);
    $("d-preset").value = p.id;
    $("f-title").value = special.title;
    $("d-yearly").checked = !!p.repeat;
    picked.aesthetic = special.aesthetic || p.aesthetic || "nebula";
    picked.theme = special.theme || p.theme || "app";
    if (p.info) $("f-notes").value = p.info;
  }
  fillChips();
  $("actions").hidden = true;
  setKind(kind);
  showSheet();
  setTimeout(() => (kind === "event" && !time ? $("quick-input") : $("f-title")).focus(), 60);
}
function nextHalfHour() {
  const n = localStamp();
  const mins = Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16));
  const next = Math.min(23 * 60, Math.ceil((mins + 1) / 30) * 30);
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}

function openExisting(type, id, date) {
  if (type === "booking") return openBooking(id);
  const it = data.get(id);
  if (!it) return;
  resetForm();
  const ro = isAgent(id);
  editing = { mode: "edit", kind: it.kind === "day" ? "day" : "event", item: it, date, ro };
  picked = { reminders: [...(it.reminders || [])], phones: [...(it.phones || [])], color: it.color || "violet", days: [], aesthetic: it.aesthetic || "nebula", theme: it.theme || "app" };
  if (picked.reminders.length) void loadPhones();
  art = it.art ? { seed: it.art.seed >>> 0, subject: it.art.subject || "auto", salt: it.artSalt || "", tempId: it.id } : { seed: hash32(String(it.id)), subject: "auto", salt: it.artSalt || "", tempId: it.id };
  $("f-title").value = it.title || "";
  $("f-notes").value = it.kind === "day" ? it.info || "" : it.body || "";
  if (it.kind === "day") {
    $("d-date").value = date && it.repeat === "yearly" ? date : it.date;
    $("d-preset").value = it.preset || "custom";
    $("d-yearly").checked = it.repeat === "yearly";
    $("d-location").value = it.location || "";
  } else {
    // This time of it (for a repeating one, the one tapped)
    const length = minutesBetween(it.start, it.end);
    const start = it.repeat && date ? `${date}${it.start.slice(10)}` : it.start;
    editing.was = start;
    fillWhen(start, addMinutes(start, length), it.allDay);
    fillRepeat(it.repeat);
    $("f-location").value = it.location || "";
  }
  fillChips();
  $("kinds").hidden = true;
  setKind(editing.kind);
  if (ro) {
    form.querySelectorAll("input, select, textarea, .chips button, .colors button, .wd button").forEach((el) => (el.disabled = true));
    $("readonly").textContent = "Part of Nova Agent's plan. Change it in Quests, or ask Nova Agent.";
    $("readonly").hidden = false;
    $("save").hidden = true;
    $("actions").hidden = true;
  }
  showSheet();
}
function openBooking(id) {
  const b = bookings.find((x) => String(x.id) === String(id));
  if (!b) return;
  resetForm();
  editing = { mode: "edit", kind: "event", ro: true, booking: true };
  picked = { reminders: [], color: "violet", days: [], aesthetic: "nebula", theme: "app" };
  $("f-title").value = [b.session, b.name].filter(Boolean).join(" · ");
  const s = fromFeed(b.start);
  const e = fromFeed(b.end) || s;
  if (s) fillWhen(s, e, false);
  fillRepeat(null);
  $("f-notes").value = [b.when, b.phone, b.email, b.price && `Price: ${b.price}`, ...(b.extra || []).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join("\n");
  fillChips();
  $("kinds").hidden = true;
  setKind("event");
  $("sheet-title").textContent = "Studio booking";
  form.querySelectorAll("input, select, textarea, .chips button, .colors button, .wd button").forEach((el) => (el.disabled = true));
  $("readonly").textContent = "A booking from the studio's diary. Change it in Acuity (or Portal → Calendar).";
  $("readonly").hidden = false;
  $("save").hidden = true;
  $("actions").hidden = true;
  showSheet();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!editing || editing.ro) return;
  const title = $("f-title").value.trim();
  if (editing.kind === "day") {
    const date = $("d-date").value;
    if (!date) return toast("Pick a date");
    const base = editing.item || { kind: "day", aesthetic: "nebula", theme: "app", tags: [], artSalt: Math.random().toString(36).slice(2, 10) };
    const p = presets().get($("d-preset").value);
    const dateKept = editing.item && editing.item.repeat === "yearly" && $("d-yearly").checked ? `${editing.item.date.slice(0, 4)}${date.slice(4)}` : date;
    const before = editing.item ? { ...editing.item } : null;
    const saved = data.save({ ...base, kind: "day", title: title || p.title || p.label, date: dateKept, preset: $("d-preset").value, repeat: $("d-yearly").checked ? "yearly" : "none", info: $("f-notes").value, location: $("d-location").value.trim(), aesthetic: picked.aesthetic, theme: picked.theme, artSalt: art.salt });
    closeSheet();
    sfx("done");
    toast(before ? "Saved" : "Day card added", () => (before ? data.save(before) : data.remove(saved.id)));
    cursor = date;
    return render();
  }
  const allDay = $("f-allday").checked;
  const start = allDay ? `${$("f-sdate").value}T00:00` : `${$("f-sdate").value}T${$("f-stime").value || "09:00"}`;
  let end = allDay ? `${$("f-edate").value || $("f-sdate").value}T23:59` : `${$("f-edate").value || $("f-sdate").value}T${$("f-etime").value || "10:00"}`;
  if (!$("f-sdate").value) return toast("Pick a date");
  if (end < start) end = allDay ? `${start.slice(0, 10)}T23:59` : addMinutes(start, 60);
  const fields = {
    kind: "event",
    title: title || "(No title)",
    start,
    end,
    allDay,
    location: $("f-location").value.trim(),
    body: $("f-notes").value,
    color: picked.color,
    reminders: picked.reminders,
    phones: picked.reminders.length ? picked.phones || [] : [],
    repeat: readRepeat(start),
    art: { seed: art.seed >>> 0, subject: art.subject || "auto" },
  };
  if (!fields.repeat) fields.exdates = [];
  if (editing.mode === "new") {
    const saved = data.save(fields);
    closeSheet();
    sfx("done");
    toast("Note card added", () => data.remove(saved.id));
    cursor = start.slice(0, 10);
    return render();
  }
  const it = editing.item;
  const was = editing.was;
  const date = editing.date;
  const ruleChanged = rulesDiffer(it, fields);
  // A repeating one: which times does this change? Asked with the editor still open, so
  // Cancel goes back to it with nothing lost. Only reminders changed: every time, no question.
  // (The rules: edits.js)
  const which = (await whichTimes(it, was || it.start, fields, () => askWhich())) ?? null;
  if (it.repeat && !ruleChanged && !which) return;
  closeSheet();
  sfx("done");
  // A repeating one whose rule was changed: the new rule is for the whole series
  if (ruleChanged) {
    const before = { ...it };
    const shift = minutesBetween(was, start);
    data.save({ ...it, ...fields, start: addMinutes(it.start, shift), end: addMinutes(addMinutes(it.start, shift), minutesBetween(start, end)), exdates: fields.repeat ? it.exdates || [] : [] });
    toast("Saved", () => data.save(before));
    return render();
  }
  changeOccurrence(it, date || it.start.slice(0, 10), was || it.start, fields, "Saved", which);
});
// (Nothing but the reminders changed: onlyRemindersChanged, in edits.js)

$("delete").addEventListener("click", async () => {
  if (!editing || !editing.item) return;
  const it = editing.item;
  const date = editing.date;
  closeSheet();
  const before = { ...it };
  if (it.kind === "event" && it.repeat) {
    const which = await askWhich("Delete which?");
    if (!which) return;
    if (which === "one") data.save({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
    else if (which === "following" && date !== it.start.slice(0, 10)) data.save(endSeriesBefore(it, date));
    else data.remove(it.id);
  } else data.remove(it.id);
  sfx("off");
  toast("Deleted", () => data.save(before));
  render();
});
$("duplicate").addEventListener("click", () => {
  if (!editing || !editing.item) return;
  const it = editing.item;
  const kind = editing.kind;
  const values = { title: $("f-title").value, notes: $("f-notes").value, start: startStamp(), end: `${$("f-edate").value}T${$("f-etime").value}`, allDay: $("f-allday").checked, location: $("f-location").value };
  openNew({ date: kind === "day" ? $("d-date").value : values.start.slice(0, 10), kind });
  $("f-title").value = `${values.title} (copy)`;
  $("f-notes").value = values.notes;
  if (kind === "event") {
    fillWhen(values.start, values.end, values.allDay);
    $("f-location").value = values.location;
    picked = { reminders: [...(it.reminders || [])], phones: [...(it.phones || [])], color: it.color || "violet", days: [] };
    fillRepeat(it.repeat);
    fillChips();
    art.subject = (it.art && it.art.subject) || "auto";
    refreshSheetArt();
  } else {
    $("d-preset").value = it.preset || "custom";
    $("d-yearly").checked = it.repeat === "yearly";
    picked.aesthetic = it.aesthetic || "nebula";
    picked.theme = it.theme || "app";
    fillChips();
    refreshSheetArt();
  }
});

// ---- Backup: download everything, or bring a backup in (this Calendar's or the old one's) ----
$("export").addEventListener("click", () => {
  const all = data.items();
  const notes = all.filter((it) => it.kind === "event" && !isAgent(it.id));
  const days = all.filter((it) => it.kind === "day");
  const blob = new Blob([JSON.stringify({ app: "Calendar", version: 2, exported: new Date().toISOString(), notes, days }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `calendar-backup-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $("layers").hidden = true;
  toast(`Backup saved: ${notes.length} note card${notes.length === 1 ? "" : "s"}, ${days.length} day card${days.length === 1 ? "" : "s"}`);
});
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast("That file isn't a Calendar backup.");
  }
  const notes = Array.isArray(parsed && parsed.notes) ? parsed.notes : Array.isArray(parsed && parsed.items) ? parsed.items.filter((x) => x && x.kind !== "day") : [];
  const days = Array.isArray(parsed && parsed.days) ? parsed.days : Array.isArray(parsed && parsed.items) ? parsed.items.filter((x) => x && x.kind === "day") : [];
  if (!notes.length && !days.length) return toast("That file isn't a Calendar backup.");
  let n = 0;
  let d = 0;
  for (const it of notes) {
    if (!it || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(it.start || "") || isAgent(it.id)) continue;
    const had = it.id && data.get(it.id);
    if (had && (had.updated || "") >= (it.updated || "")) continue;
    data.save({ ...it, kind: "event" });
    n++;
  }
  for (const it of days) {
    if (!it || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) continue;
    const had = it.id && data.get(it.id);
    if (had && (had.updated || "") >= (it.updated || "")) continue;
    data.save({ ...it, kind: "day" });
    d++;
  }
  $("layers").hidden = true;
  sfx("done");
  toast(n || d ? `Brought in ${n} note card${n === 1 ? "" : "s"} and ${d} day card${d === 1 ? "" : "s"}` : "Everything in that backup is already here.");
  render();
});

// ---- Toast (with Undo) ----
let toastTimer = 0;
function toast(text, undo) {
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !undo;
  $("toast-undo").onclick = undo
    ? () => {
        undo();
        $("toast").hidden = true;
        render();
      }
    : null;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), undo ? 6000 : 2600);
}
data.setConflictHandler((current) => toast(`“${current.title || "An item"}” was changed on another device: showing that.`));

// ---- Keys ----
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("which").hidden) return $("which").querySelector('[data-which=""]').click();
    if (!$("sheet").hidden) return closeSheet();
    if (!$("layers").hidden) return ($("layers").hidden = true);
  }
  if (e.target.closest("input, textarea, select") || !$("sheet").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft") step(-1);
  else if (k === "arrowright") step(1);
  else if (k === "t") $("today").click();
  else if (k === "n") openNew();
  else if ({ m: 1, w: 1, d: 1, l: 1 }[k]) setView({ m: "month", w: "week", d: "day", l: "list" }[k]);
});
$("add").addEventListener("click", () => openNew());

// ---- Start ----
data.onChange(() => {
  if (!drag) render();
});
async function loadBookings() {
  bookings = await data.bookings();
  render();
}
data.start();
render();
void loadBookings();
// The day cards' title styles (Celestial, Constellation, the widest Archivo) after the first screen
(window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@125,900&family=Cormorant+Garamond:ital,wght@1,600&family=Source+Code+Pro:wght@600&display=swap";
  document.head.appendChild(link);
});
setInterval(() => document.visibilityState === "visible" && void loadBookings(), 5 * 60000);
// The current-time line and "today" move on
setInterval(() => !drag && $("sheet").hidden && render(), 60000);
addEventListener("resize", () => {
  if (!drag) render();
});
// Nova Agent's theme changed: day cards on "App theme" take the new colours straight away
addEventListener("novathemechange", () => {
  if (!drag) render();
});
// The fonts change how much fits
document.fonts?.ready.then(() => fitMonth());
