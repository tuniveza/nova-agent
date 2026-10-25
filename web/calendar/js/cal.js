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
  // (a copy added at the end, the first taken away once the copy is in: moved, it was gone until it came back from
  // the network, and the page jumped as the bar and the days lost its sizes for a moment, 24 Oct 2026)
  const cosmos = document.querySelector('link[href="css/cosmos.css"]');
  if (cosmos) {
    const last = cosmos.cloneNode();
    last.onload = last.onerror = () => cosmos.remove();
    document.head.appendChild(last);
  }
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
// The moon's phase in words, for a computer's month ("Full moon", "New moon"): a text pill, like the
// special days, in place of the little moon in the corner
function moonWords(d) {
  const s = SKY();
  if (!s || !prefs.layers.sky || !skyDrawn) return "";
  const m = s.moon(d);
  if (!m.principal) return "";
  return `<div class="skychip moonchip" title="${esc(m.fullName ? `${m.principal} · ${m.fullName}` : m.principal)}"><span>${esc(m.fullName || m.principal)}</span></div>`;
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

// (Simple look, a very short Calendar: its views as lists of cards, drawAgenda. On a computer under 430px tall
// too: there the hours squeezed every card to a sliver and the month's days to "More in Day view", 24 Oct 2026.
// html.cal-short, set as each view is drawn, gives simple.css the same answer)
const short = () => document.documentElement.dataset.ui !== "rich" && matchMedia(document.documentElement.dataset.form === "desktop" ? "(max-height: 429px)" : "(max-height: 360px)").matches;

// ---- Drawing ----
function render() {
  document.documentElement.classList.toggle("cal-short", short());
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

// (opts.pane: with its icon pane, the week's all-day row; an options object, not a flag, as the month passes
// pillHtml straight to map(), whose second argument is the index)
function pillHtml(e, opts) {
  const pane = !!(opts && opts.pane === true);
  if (e.type === "day") {
    return `<div class="daycard themed${pane ? " has-pane" : ""}" style="${themeStyle(dayTheme(e.item))}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day">${pane ? iconPane(e) : ""}<span>${esc(titleOf(e))}</span></div>`;
  }
  // The title on one line (a day too small for it shows the symbol; the title is its tooltip) and, under it, what it's for
  const what = whatOf(e);
  return `<div class="pill${e.ro ? " ro" : ""}${e.type === "booking" ? " book" : ""}${pane ? " has-pane" : ""}" data-color="${esc(e.color)}" data-kind="${symbolOf(e)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}" title="${esc(titleOf(e))}${what ? ` — ${esc(what)}` : ""}">${pane ? iconPane(e) : phone() ? `<i class="pill-sym" aria-hidden="true">${symbolIcon(e)}</i>` : ""}${e.allDay ? "" : `<b>${fmtTime(e.start)}</b>`}<span>${esc(titleOf(e))}</span>${what ? `<small>${esc(what)}</small>` : ""}</div>`;
}
// A symbol for what a card is about: its icon pane, its colours (data-kind) and, in the smallest days, the
// card itself. The first match wins, so the more particular come first; whole words where a part of one
// would match the wrong thing ("ep" in "deep", "eat" in "create", "ring" in "during"). (25 Oct 2026, the
// user: "a pane with icons that intelligently match up with what each event, quest and whatever is")
const SYMBOLS = [
  [/birthday|\bbday\b/i, "cake"], [/\bdate\b|\blove\b|anniversary|valentine|girlfriend|boyfriend/i, "heart"],
  [/doctor|dentist|\bgp\b|hospital|clinic|therap|physio|pharmac|vaccin|check.?up|optician|\bmeds?\b/i, "health"],
  [/\bhair|barber|\bnails?\b|salon|\bwax/i, "scissors"], [/^(text|message|whatsapp|dm|ring|call)\b/i, "phone"],
  [/\bfix|repair|\bbugs?\b|debug|maintenance|mechanic|plumber|electrician|\bui issue/i, "wrench"],
  [/record|vocal|\bsing(s|ing|er)?\b|\bmic\b|podcast|voice.?over|studio|\bsession\b(?! with)/i, "mic"],
  [/\bmix|\bmaster(ing)?\b|\bbeats?\b|\bsong|\btrack|music|\bep\b|album|release|\bgig\b|concert|rehears|\bdj\b|produc|guitar|piano|\bbass\b|drums?\b|synth|instrument/i, "note"],
  [/lesson|\bclass|course|study|learn|tutor|school|\bexam|\buni\b|lecture/i, "cap"], [/listen|playlist|headphone|\baudio\b/i, "headphones"],
  [/\bcod(e|ing)\b|deploy|website|\bapps?\b|develop|programm|\bserver|\bdev\b|computer|deep work|\bfocus/i, "laptop"],
  [/invoice|\bpay\b|payment|\bbills?\b|\bbank|\brent\b|\btax\b|budget|money|salary|refund|£/i, "coin"],
  [/\bshop|grocer|\bbuy\b|\border\b|amazon|pick.?up|\bcollect/i, "cart"],
  [/\bmeet|call with|\bteam\b|\bcrew\b|\bband\b|session with|catch.?up|interview|viewing|\bguests?\b/i, "people"],
  [/\bphone|\bcalls?\b|\bring\b|facetime|\bzoom\b/i, "phone"],
  [/\bgym\b|workout|\brun\b|running|\bwalk|yoga|\btrain(ing)?\b|exercise|\bsteps\b|\bswim|cycl|football/i, "dumbbell"],
  [/coffee|brunch|\bcaf[eé]|\btea\b/i, "coffee"],
  [/lunch|dinner|breakfast|\beat(ing)?\b|\bfood|\bcook|\bmeal|\bbread\b|\beggs?\b|restaurant|\bbake/i, "plate"],
  [/\bdriv(e|ing)\b|\bcar\b|\btaxi\b|\buber\b|petrol|\bmot\b/i, "car"],
  [/flight|\bfly\b|travel|\btrip\b|holiday|airport|hotel/i, "plane"],
  [/clean|\btidy|laundry|\bwash|hoover|chores|\bhouse\b|\bhome\b|carpet|\bmoving\b/i, "home"],
  [/\bgifts?\b|\bpresents?\b|christmas|\bparty\b|celebrat/i, "gift"],
  [/\bsleep|\bnap\b|\brest\b|\bbed\b|\bwake/i, "bed"],
  [/\bpaint|\bdraw|\bart\b|design|artwork|\bphotos?\b/i, "brush"],
  [/\bwrit(e|ing)|lyrics|journal|draft|\bedit\b|script|\bnotes?\b/i, "pen"], [/video|\bfilm|\breels?\b|\bshoot|camera|youtube|tiktok|\bstream/i, "film"],
  [/\bread(ing)?\b|\bbooks?\b|library/i, "book"], [/e-?mail|\bmail\b|\breply\b|\bsend\b|newsletter/i, "mail"],
  [/^✓|\btodo\b|to-do|\btasks?\b|remember|\bdone\b|\breview\b|\bplan(ning)?\b/i, "tick"],
];
// (what Nova Agent puts on the calendar, by its kind, when its words say nothing more)
const AGENT_SYMBOL = { quest: "quest", block: "laptop", mile: "flag", music: "note" };
function symbolOf(e) {
  if (e.type === "booking") return "booking";
  const it = e.item || {};
  // (its title first: a card's notes or place only decide when its title says nothing)
  for (const text of [titleOf(e), `${it.notes || ""} ${it.location || ""}`]) for (const [re, ico] of SYMBOLS) if (re.test(text)) return ico;
  return e.ro ? AGENT_SYMBOL[String(it.id || "").split("-")[0]] || "quest" : "card";
}
// What each symbol means, in words (its tooltip)
const SYMBOL_WORDS = { booking: "Studio booking", quest: "Quest", card: "Note card", mic: "Recording", note: "Music", cap: "Lesson", headphones: "Listening", people: "Meeting", dumbbell: "Exercise", plate: "Food", plane: "Travel", phone: "Call", pen: "Writing", film: "Video", book: "Reading", mail: "Email", cake: "Birthday", heart: "Someone special", health: "Health", scissors: "Hair and beauty", wrench: "Fixing", laptop: "Computer work", coin: "Money", cart: "Shopping", coffee: "Coffee", car: "Driving", home: "Home", gift: "Celebration", bed: "Rest", brush: "Art and design", tick: "To do", flag: "Milestone" };
const symbolIcon = (e) => { const s = symbolOf(e); return window.NT && window.NT.presets ? window.NT.presets.icon(s, "", SYMBOL_WORDS[s] || "") : ""; };
// A card's icon pane: the icon for what it's about, in a strip of its own at the card's start (every view's
// cards use this one, so a card shows the same icon everywhere). A day card shows its kind of day's icon.
// (decorative: the card's own title and tooltip say what it is)
function iconPane(e) {
  const kind = e.type === "day" ? "" : symbolOf(e);
  const svg = window.NT && window.NT.presets ? window.NT.presets.icon(e.type === "day" ? presets().get(e.item.preset).icon : kind) : "";
  return `<i class="ico-pane"${kind ? ` data-pane="${kind}"` : ""} aria-hidden="true">${svg}</i>`;
}
// What a card is for, in a line: its notes (first line), else where it is
function whatOf(e) {
  const it = e.item || {};
  const text = String(it.notes || it.body || it.info || "").replace(/<[^>]*>/g, " ").split(/\n/)[0].trim();
  return (text || (e.type === "booking" ? "" : it.location || "")).slice(0, 90);
}
function skyChip(x) {
  return `<div class="skychip" title="${esc(x.title)}"><span>${esc(x.title)}</span></div>`;
}

// The day in words, with smaller forms for smaller days (the CSS shows the one that fits), always
// written the British way whatever the browser's language: "Nineteenth Day October", "19 Oct",
// "19/10", "19"; and, between the longest and "19 Oct", the day in a word: "Nineteenth"
const ORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth", "Thirteenth", "Fourteenth", "Fifteenth", "Sixteenth", "Seventeenth", "Eighteenth", "Nineteenth", "Twentieth", "Twenty-first", "Twenty-second", "Twenty-third", "Twenty-fourth", "Twenty-fifth", "Twenty-sixth", "Twenty-seventh", "Twenty-eighth", "Twenty-ninth", "Thirtieth", "Thirty-first"];
function dayWords(d) {
  const day = Number(d.slice(8)), mon = Number(d.slice(5, 7));
  return `<span class="n-long">${ORD[day]} Day ${MONTHS[mon - 1]}</span><span class="n-word">${ORD[day]}</span><span class="n-mid">${day} ${MONTHS[mon - 1].slice(0, 3)}</span><span class="n-short">${day}/${mon}</span><span class="n-min">${day}</span>`;
}
// The month's cards as a list, a page at a time, as the week's and the day's on a very short Calendar: where
// there's no room for its days, and where even one week alone can't hold its busiest day's cards (fitDays):
// every card still shows, never one hidden behind "More" (25 Oct 2026, the user: "there shouldn't be hiding
// under element note cards")
function drawMonthList() {
  // (a list made for the room: the short Calendar's slimmer rows, simple.css html.cal-short; render() sets it
  // afresh each time, so a taller window gets its days back)
  document.documentElement.classList.add("cal-short");
  const from = `${cursor.slice(0, 7)}-01`;
  const days = Array.from({ length: 31 }, (_, i) => addDays(from, i)).filter((d) => d.slice(0, 7) === from.slice(0, 7));
  return drawAgenda(days, `in ${MONTHS[Number(from.slice(5, 7)) - 1]}`);
}
// A day card in the month, with its kind of day's icon in a pane at its start, as the note cards have
const monthDayCard = (e) => pillHtml(e).replace('data-type="day"><span>', `data-type="day">${iconPane(e)}<span>`);
function drawMonth() {
  // (Simple look on a very short Calendar: no room for six weeks of days, so the month's cards as a list, as
  // the week's and the day's)
  if (short()) return drawMonthList();
  const first = `${cursor.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const nextMonth = Number(cursor.slice(5, 7)) === 12 ? `${Number(cursor.slice(0, 4)) + 1}-01-01` : `${cursor.slice(0, 4)}-${pad(Number(cursor.slice(5, 7)) + 1)}-01`;
  const end = addDays(nextMonth, -1);
  const weeks = Math.ceil((dayNumber(end) - dayNumber(start) + 1) / 7);
  const gridEnd = addDays(start, weeks * 7 - 1);
  const all = entries(start, gridEnd);
  const t = today();
  const max = phone() ? 4 : 3;
  // On a computer each day says what's on in words: one card listing its note cards, bookings and
  // quests (time and title), no symbols and no "+2" (20 Oct 2026, the user: "remove the stupid number
  // counters and replace them with information textual card relevant to its perticular day like whats on
  // the calender for that day" / "get rid of those awful small boxed icons"). A phone's days too, in
  // words with no symbols (20 Oct 2026, the user: "get rid of … all these horribly tiny icons and replace
  // them with text"); there the chosen day's list stays under the month
  const textual = true;
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
    if (textual) {
      const sky1 = days.length ? [] : skyDays(d).slice(0, 1);
      const what = [...days.slice(1), ...rest];
      const style = [days.length ? themeStyle(dayTheme(days[0].item)) : "", what.length ? `--mix: ${kindTint(what)}` : ""].filter(Boolean).join("; ");
      cells += `<button type="button" class="cell${d.slice(0, 7) !== cursor.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}${d === cursor ? " sel" : ""}${days.length ? " has-day" : ""}" data-date="${d}"${style ? ` style="${style}"` : ""} aria-label="${dayLabel(d)}${list.length ? `: ${esc(list.map(titleOf).join(", "))}` : ""}">
      <span class="num"${phone() ? "" : ` data-goto="${d}" title="Open ${dayLabel(d)} in Day view"`}>${dayWords(d)}</span>${days.slice(0, 1).map(monthDayCard).join("")}${sky1.map(skyChip).join("")}${moonWords(d)}${what.length ? `<p class="dayinfo" data-guard="off">${what.map(infoLine).join("")}</p>` : ""}</button>`;
      continue;
    }
    cells += `<button type="button" class="cell${d.slice(0, 7) !== cursor.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}${d === cursor ? " sel" : ""}${days.length ? " has-day" : ""}" data-date="${d}"${days.length ? ` style="${themeStyle(dayTheme(days[0].item))}"` : ""} aria-label="${dayLabel(d)}${list.length ? `, ${list.length} item${list.length > 1 ? "s" : ""}` : ""}">
      <span class="num">${dayWords(d)}</span>${moonMark(d)}${days.slice(0, 1).map(pillHtml).join("")}${sky.map(skyChip).join("")}${fits.map(pillHtml).join("")}${rest.length - fits.length + Math.max(0, days.length - 1) > 0 ? `<span class="more" data-n="${rest.length - fits.length + Math.max(0, days.length - 1)}">+${rest.length - fits.length + Math.max(0, days.length - 1)} more</span>` : ""}</button>`;
  }
  const heads = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => `<span>${phone() ? w[0] : w}</span>`).join("");
  // (on a computer the strip of this month's special days goes: each is written in its own day now,
  // and the strip ran off the side)
  // (the month fits its own words, fitMonth: Nova's shared fitting, rules.js, is told to leave its days
  // alone, or it holds a phone's titles on one line, where they're meant to go onto two, and cuts them off)
  // (data-align-off: the month places its own days; onescreen.js's centring would slide a part-full last
  // row, or the week grid itself, off its weekdays)
  view.innerHTML = `<div class="month" data-align-off>${phone() ? stripHtml() : ""}<div class="wk-head">${heads}</div><div class="grid${textual ? " textual" : ""}" data-rules="off" data-os-skip>${cells}</div>${phone() ? dayPlanHtml(cursor) : ""}</div>`;
  fitMonth();
  // (and again once the panel has settled: drawn while its panel is still opening, the month was fitted to
  // a moment that then changed in ways its size didn't show, and cards were left cut, 22 Oct 2026)
  for (const t of lateFits) clearTimeout(t);
  const drawn = view.querySelector(".month .grid");
  // (no room for even one week of it: the month went to its list, drawMonthList)
  if (!drawn) return;
  // (these always fit: what they're for changes nothing the skip below can see)
  lateFits = [700, 2500].map((ms) => setTimeout(() => { if (drawn.isConnected) fitMonth(true); }, ms));
  // (the days' size changing without the window's, a scroll bar coming or going: they fit again)
  if (typeof ResizeObserver === "function") {
    const grid = view.querySelector(".month .grid");
    const sizeOf = (g) => `${g.clientWidth}x${g.clientHeight}`;
    grid.dataset.size = sizeOf(grid);
    (monthSize ||= new ResizeObserver(() => {
      const g = view.querySelector(".month .grid");
      if (g && sizeOf(g) !== g.dataset.size) { g.dataset.size = sizeOf(g); fitMonth(); }
    })).disconnect();
    monthSize.observe(grid);
    // (a day's card losing room to what comes in after the month is drawn, its moon or a special day:
    // the month fits again if a day is now cut (its weeks share the height, so it's the whole month); at most
    // a few times, so two changes can't chase each other, 22 Oct 2026, the user: "I don't want it cut at any
    // size of the screen at any point")
    (cardSize ||= new ResizeObserver((list) => {
      for (const { target: card } of list) {
        const now = `${card.clientWidth}x${card.clientHeight}`;
        if (card.dataset.size === now) continue;
        card.dataset.size = now;
        resized.add(card);
      }
      // (once the sizes stop changing, a tenth of a second later: the month settles in a few steps as its
      // panel opens, and only the last one counts; never more than 30 rounds a minute, so nothing can run away)
      clearTimeout(refitSoon);
      if (resized.size) refitSoon = setTimeout(() => {
        const now = Date.now();
        if (now - refitWindow > 60000) { refitWindow = now; refitCount = 0; }
        if (refitCount++ < 30 && [...resized].some((card) => card.isConnected)) fitMonth(true);
        resized.clear();
      }, 100);
    })).disconnect();
    // (each card's size as it was fitted: the month is often fitted while its panel is still opening, at
    // another size, and the first size seen after must count as a change)
    // (and each little card in them: its words growing inside a card of the same size, a font arriving late, leave
    // the card's size alone, so they're watched too, 25 Oct 2026)
    for (const card of grid.querySelectorAll(":scope > .cell > .dayinfo, :scope > .cell > .dayinfo > .di")) {
      card.dataset.size = `${card.clientWidth}x${card.clientHeight}`;
      cardSize.observe(card);
    }
  }
}
let monthSize = null;
let cardSize = null;
let lateFits = [];
const resized = new Set();
let refitSoon = 0, refitWindow = 0, refitCount = 0;
// (fonts arriving after the month is drawn change the words' sizes, not the days': fit again then, or cards
// fitted to the stand-in font stick out of their day, 22 Oct 2026)
if (document.fonts && document.fonts.addEventListener) {
  let refit = 0;
  document.fonts.addEventListener("loadingdone", () => { cancelAnimationFrame(refit); refit = requestAnimationFrame(() => view.querySelector(".month .grid") && fitMonth()); });
  document.fonts.ready.then(() => view.querySelector(".month .grid") && fitMonth());
}
// A day's own tint: its cards' kind colours (cosmos.css --kind-*) blended by how many of each, so a day
// of three meetings and a lunch is three parts blue to one part coral (22 Oct 2026, the user: "the overall
// color tint is determined by the quantity precentage of note card type")
function kindTint(list) {
  const counts = {};
  for (const e of list) counts[symbolOf(e)] = (counts[symbolOf(e)] || 0) + 1;
  let mix = "", total = 0;
  for (const [kind, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    total += n;
    mix = mix ? `color-mix(in oklab, rgb(var(--kind-${kind})) ${Math.round((n / total) * 1000) / 10}%, ${mix})` : `rgb(var(--kind-${kind}))`;
  }
  return mix;
}
// Each item in a day, as a little note card: its icon pane, its time (not for all-day ones) and its title (a tap
// opens it). (20 Oct 2026, the user: "on every item in a calender day can we fit every single note card
// minification … onto the entire calender day square"; and with "the gigantic today panel" gone, the month has the
// whole width: a tap on a day's empty space starts a note card on it, a tap on its name opens Day view)
// (data-content-card: its title is what's on it, not a button's words, so it wraps rather than hides, ns/CLAUDE.md
// 2.3; the icon pane at its start, iconPane, a strip down its left edge: 25 Oct 2026, the user: "a pane with icons
// that intelligently match up with what each event, quest and whatever is in a note card")
function infoLine(e) {
  // (a quest's striped card already says it's a quest: no "QUEST:" in front of its title here)
  const title = titleOf(e).replace(/^quest:\s*/i, "");
  // (on a phone just the title: its time is in the chosen day's list under the month)
  return `<span class="di${e.ro ? " ro" : ""}" data-content-card data-color="${esc(e.color)}" data-kind="${symbolOf(e)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}" title="${esc(SYMBOL_WORDS[symbolOf(e)] || "")}: ${esc(titleOf(e))}${e.allDay ? "" : `, ${fmtTime(e.start)}–${fmtTime(e.end)}`}">${iconPane(e)}<span class="di-in">${e.allDay || phone() ? "" : `<b>${fmtTime(e.start)}</b> `}<span class="di-t">${esc(title)}</span></span></span>`;
}
// (data-guard="off": this fits itself; /shared/onescreen.js's last-resort shrinking leaves it alone, as the
// two fought over it, 22 Oct 2026)
// Every card in a day shows in that day, whole (25 Oct 2026, the user: "fix the visibility issues on the calender;
// there shouldn't be hiding under element note cards". Before, what didn't fit stepped out of the day behind
// "Also …", "More in Day view" or "More", and a card whose title was too long for one line went first, so a
// quiet day with one long title showed no card at all). Now, in turn:
//   1. a card's title wraps onto more lines rather than hide;
//   2. a busy day's words step down a size at a time, then its cards go slimmer, to 9px at the least on a
//      computer; last of all a title longer than two lines ends with … (all of it in its tooltip and a tap away);
//   3. a week whose busiest day still needs more room gets a taller row, the quieter weeks giving up theirs
//      (never lower than --wk-min, so an empty day still has room to tap);
//   4. when the weeks still don't all fit, they go in pages of whole weeks, the page bar under them (pageWeeks);
//   5. when even one week alone can't hold its busiest day, the month shows as a list of its cards, a page at a
//      time (drawMonthList). Nothing is cut and nothing hidden.
// (22 Oct 2026, the user: "fix visual animation delay, glitching and or lag": every day is measured together,
// one layout a step for the whole month, never a layout per day)
// (each step: its words' size, whether its cards are slim, their lines closer, and whether a title longer than two
// lines ends with … (its whole title in its tooltip, and a tap opens it). 9px only on the busiest days; the two-line
// titles only as the very last step, where its week can't have the room even on a page of its own with others:
// otherwise a narrow window had a page for each week. A phone's days are tiny, so smaller)
const DI_STEPS = { desk: [[12], [11.5], [11], [10.5], [10], [10, true], [9.5, true], [9, true], [9, true, true]], phone: [[10], [9.5], [9], [8.5], [8.5, true], [8, true], [7.5, true], [7.5, true, true]] };
const diSteps = () => (phone() ? DI_STEPS.phone : DI_STEPS.desk);
const WK_MIN = 58; // (a week's lowest, when the grid doesn't say: cosmos.css --wk-min)
function setStep(c, k) {
  const [fs, slim, clamp] = diSteps()[k];
  c.dataset.step = String(k);
  c.style.setProperty("--di-fs", `${fs}px`);
  const card = c.querySelector(":scope > .dayinfo");
  if (card) { card.classList.toggle("slim", !!slim); card.classList.toggle("clamp", !!clamp); }
}
// How tall each day is at each step: the weeks only as tall as what's in them and every day from its top
// (.wk-measure, cosmos.css), so each day's own height is what its cards need; one layout a step, every day at once
function measureDays(grid, cells) {
  const n = diSteps().length;
  const h = cells.map(() => []);
  grid.classList.add("wk-measure");
  for (let k = 0; k < n; k++) {
    for (const c of cells) setStep(c, k);
    cells.forEach((c, i) => { h[i][k] = Math.ceil(c.getBoundingClientRect().height); });
  }
  grid.classList.remove("wk-measure");
  return h;
}
// (a day's card running over: what the last look checks)
function cardCut(c, card) {
  if (c.scrollHeight > c.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1) return true;
  if ([...card.querySelectorAll(":scope > *, .di-in")].some((k) => k.offsetParent && k.scrollWidth > k.clientWidth + 1)) return true;
  const r = card.getBoundingClientRect();
  return [...card.children].some((k) => { const b = k.getBoundingClientRect(); return b.height > 0 && (b.bottom > r.bottom + 0.5 || b.right > r.right + 0.5); });
}
// The month's days fitted (steps 1 to 5 above). False when even one week can't hold its busiest day.
function fitDays(grid, cells) {
  const last = diSteps().length - 1;
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.rowGap) || 0;
  const room = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const min = parseFloat(cs.getPropertyValue("--wk-min")) || (phone() ? 48 : WK_MIN);
  const h = measureDays(grid, cells);
  // (what each week needs: its busiest day at its smallest step)
  const need = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) => Math.max(min, ...h.slice(w * 7, w * 7 + 7).map((x) => x[last])));
  const shown = pageWeeks(grid, cells, need, room, gap);
  if (!shown) return false;
  // (each week shown at least as tall as it needs; the room left shared out between them)
  grid.style.gridTemplateRows = shown.map((w) => `minmax(${need[w]}px, 1fr)`).join(" ");
  // (each day the biggest words that fit the height its week ended up with)
  const vis = cells.filter((c) => !c.classList.contains("wk-off"));
  const at = new Map(cells.map((c, i) => [c, i]));
  const tall = vis.map((c) => c.getBoundingClientRect().height);
  vis.forEach((c, j) => {
    const k = h[at.get(c)].findIndex((x) => x <= tall[j] + 0.5);
    setStep(c, k < 0 ? last : k);
  });
  // (then one look: a day still running over by a rounding takes the next step down)
  for (let round = 0; round < last; round++) {
    const cut = vis.filter((c) => { const card = c.querySelector(":scope > .dayinfo"); return card && Number(c.dataset.step) < last && cardCut(c, card); });
    if (!cut.length) break;
    for (const c of cut) setStep(c, Number(c.dataset.step) + 1);
  }
  // (each card's size as fitted, so its own fitting never reads as a change that fits it again: that ran on and on,
  // 30 rounds a minute, keeping a tablet busy while nothing happened)
  for (const card of grid.querySelectorAll(":scope > .cell > .dayinfo, :scope > .cell > .dayinfo > .di")) card.dataset.size = `${card.clientWidth}x${card.clientHeight}`;
  return true;
}
// A phone's day and sky names, each on its one line in its tiny day: a little smaller at a time and,
// when even the smallest is too long, its last words step out (the whole name is its tooltip)
function fitChips(c) {
  for (const chip of c.querySelectorAll(":scope > .skychip, :scope > .daycard")) {
    const span = chip.querySelector(":scope > span");
    if (!span) continue;
    const full = (span.dataset.full ||= span.textContent);
    span.textContent = full;
    if (!chip.title) chip.title = full;
    const over = () => chip.scrollWidth > chip.clientWidth;
    let fits = false;
    for (const fs of [8, 7.5, 7, 6.5]) {
      chip.style.setProperty("--chip-fs", `${fs}px`);
      if ((fits = !over())) break;
    }
    const words = full.split(/\s+/);
    while (!fits && words.length > 1) {
      words.pop();
      span.textContent = words.join(" ");
      fits = !over();
    }
  }
}
// Nothing cut off. Each day steps down only as far as it needs: the small line goes, then titles
// take one line, then the times go (symbol and title), then its cards become just their symbols.
// If a day still can't fit, every day's number goes short (and days that then have room get their
// words back), and a day that still can't hold all its cards shows the rest as "+N" (all of them
// are in its list). When the chosen day sits below the month, the month keeps the screen's height.
const STEPS = ["fit-1", "fit-2", "fit-3", "sym"];
// Whole weeks a few at a time when they don't all fit (22 Oct 2026, the one device model; ns/CLAUDE.md 2c): the
// month shows as many whole weeks as fit, each as tall as its busiest day needs (fitDays), with the page bar (the
// same as everywhere: ‹ 1 / 3 ›) to turn to the others, the weekday names staying above. Pages are as even as
// they can be (5 weeks as 3 and 2, not 4 and 1). It opens on the chosen day's week and keeps its page while the
// month stays the same. (The general page bar took the grid's days one by one, not by the week.) Hands back the
// weeks shown, or null when even one week alone is taller than the room (the month then goes to its list).
let weekAt = 0, weekAtOf = "", weekPages = [];
function pageWeeks(grid, cells, need, room, gap) {
  let bar = grid.querySelector(":scope > .wk-pager");
  const weeks = need.length;
  const all = [...Array(weeks).keys()];
  const tall = (ws) => ws.reduce((a, w) => a + need[w], 0) + gap * Math.max(0, ws.length - 1);
  grid.classList.remove("wk-tiny");
  if (tall(all) <= room) {
    grid.classList.remove("wk-paged");
    if (bar) bar.remove();
    for (const c of cells) c.classList.remove("wk-off");
    weekPages = [all];
    return all;
  }
  // (the room under the weeks kept for the bar, cosmos.css .wk-paged, comes off each page's)
  const padWas = parseFloat(getComputedStyle(grid).paddingBottom) || 0;
  grid.classList.add("wk-paged");
  const per = room - ((parseFloat(getComputedStyle(grid).paddingBottom) || 0) - padWas);
  if (Math.max(...need) > per) {
    grid.classList.remove("wk-paged");
    return null;
  }
  // (as many weeks on each page as fit, in order; then, if the same number of pages can be even, even)
  const greedy = [];
  for (let w = 0; w < weeks; ) {
    const page = [w++];
    while (w < weeks && tall([...page, w]) <= per) page.push(w++);
    greedy.push(page);
  }
  const size = Math.ceil(weeks / greedy.length);
  const even = [];
  for (let w = 0; w < weeks; w += size) even.push(all.slice(w, w + size));
  const pages = (weekPages = even.length === greedy.length && even.every((p) => tall(p) <= per) ? even : greedy);
  // (a new month opens on the chosen day's week, or its first; turning keeps to whole pages)
  const first = cells[0] && cells[0].dataset.date;
  if (first !== weekAtOf) {
    weekAtOf = first;
    const at = cells.findIndex((c) => c.dataset.date === cursor);
    weekAt = at >= 0 ? Math.floor(at / 7) : 0;
  }
  const page = Math.max(0, pages.findIndex((p) => p.includes(Math.min(weekAt, weeks - 1))));
  cells.forEach((c, i) => c.classList.toggle("wk-off", !pages[page].includes(Math.floor(i / 7))));
  if (!bar) {
    bar = document.createElement("nav");
    bar.className = "os-pager wk-pager";
    bar.setAttribute("aria-label", "Weeks");
    bar.innerHTML = '<button type="button" class="os-prev" aria-label="Earlier weeks">‹</button><span class="os-count" aria-live="polite"></span><button type="button" class="os-next" aria-label="Later weeks">›</button>';
    const turn = (by) => {
      const to = weekPages[Number(bar.dataset.page) + by];
      if (!to) return;
      weekAt = to[0];
      fitMonth();
    };
    bar.querySelector(".os-prev").addEventListener("click", () => turn(-1));
    bar.querySelector(".os-next").addEventListener("click", () => turn(1));
    grid.append(bar);
  }
  bar.dataset.page = String(page);
  bar.querySelector(".os-count").textContent = `${page + 1} / ${pages.length}`;
  bar.querySelector(".os-prev").disabled = page <= 0;
  bar.querySelector(".os-next").disabled = page >= pages.length - 1;
  return pages[page];
}
// (what the month was last fitted to: the same drawing at the same size with the same fonts and week page
// needs nothing done, and the late fits, the fonts' and the sizes' calls come often; each fit is a dozen or
// so layouts of the whole month, 22 Oct 2026)
let fitted = null, fontGen = 0;
document.fonts?.addEventListener?.("loadingdone", () => fontGen++);
function fitMonth(always = false) {
  const grid = view.querySelector(".month .grid");
  if (!grid) return;
  const key = `${grid.clientWidth}x${grid.clientHeight}|${fontGen}|${weekAt}`;
  if (fitted && fitted.grid === grid && fitted.key === key) {
    if (!always) return;
    // (a late fit: one look first, and the steps only if a day is cut: one layout instead of a dozen)
    if (grid.classList.contains("textual") && ![...grid.querySelectorAll(":scope > .cell > .dayinfo:not(.fit-hide)")].some((card) => cardCut(card.parentElement, card))) return;
  }
  // (no room for even one week's busiest day: its cards as a list instead, never hidden)
  if (fitMonthNow(grid) === false) {
    fitted = null;
    return drawMonthList();
  }
  // (the size as it ended up: a fit can change it, the week bar coming or going)
  fitted = { grid, key: `${grid.clientWidth}x${grid.clientHeight}|${fontGen}|${weekAt}` };
}
function fitMonthNow(grid) {
  const cells = [...grid.children].filter((c) => !c.classList.contains("wk-pager"));
  // (every week in sight and of its own height while the month is measured; fitDays then pages them)
  for (const c of cells) c.classList.remove("wk-off");
  grid.classList.remove("wk-paged", "wk-tiny");
  grid.style.removeProperty("grid-template-rows");
  // (a title that doesn't fit its one line counts as not fitting too)
  const cutTitle = (c) => [...c.querySelectorAll(".pill:not(.fit-hide) > span, .daycard > span")].some((s) => s.offsetParent && s.scrollWidth > s.clientWidth + 1);
  const over = (c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1 || cutTitle(c);
  grid.classList.remove("fit-4");
  // The day's name: the longest form that fits on its one line, every day alike
  delete grid.dataset.num;
  const nums = cells.map((c) => c.querySelector(".num")).filter(Boolean);
  const numCut = () => nums.some((n) => n.offsetParent && n.scrollWidth > n.clientWidth + 1);
  if (nums.length && numCut()) {
    const shown = [...nums[0].children].findIndex((s) => getComputedStyle(s).display !== "none");
    for (let k = Math.max(1, shown + 1); k <= 4 && numCut(); k++) grid.dataset.num = String(k);
  }
  grid.style.height = grid.style.flex = "";
  for (const c of cells) {
    c.classList.remove(...STEPS);
    for (const p of c.querySelectorAll(".fit-hide")) p.classList.remove("fit-hide");
    const extra = c.querySelector(":scope > .more:not([data-n])");
    if (extra) extra.remove();
  }
  // (the month's height is never set here any more: its weeks share the room it has, with the chosen day's
  // plan under it or beside it (cosmos.css). Setting at least 56px a week, from when the page scrolled down
  // to the plan, pushed the last weeks off the bottom of a short screen; 22 Oct 2026)
  if (grid.classList.contains("textual")) {
    if (phone()) for (const c of cells) fitChips(c);
    return fitDays(grid, cells);
  }
  {
    const cs = getComputedStyle(grid);
    const min = parseFloat(cs.getPropertyValue("--wk-min")) || WK_MIN;
    pageWeeks(grid, cells, Array(Math.ceil(cells.length / 7)).fill(min), grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), parseFloat(cs.rowGap) || 0);
  }
  // (each step for every day at once: all the measuring, then all the changes, one layout a step)
  for (const step of STEPS) { const overs = cells.filter(over); for (const c of overs) c.classList.add(step); }
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
    // A day too small even for its number and its "+N" one under the other: the "+N" sits in its
    // corner instead, inside the day, never cut off
    c.classList.toggle("tight", !!more && over(c));
  }
}
// This month at a glance: day cards, full moons and special days, each a tap away (each with its day
// in words, "Wed 21", and no icons, 20 Oct 2026)
const stripDay = (d) => `${WD[weekday(d)]} ${Number(d.slice(8))}`;
function stripHtml() {
  if (!skyDrawn) return prefs.layers.sky || prefs.layers.days ? `<div class="strip" aria-hidden="true"></div>` : "";
  const first = `${cursor.slice(0, 7)}-01`;
  const last = addDays(Number(cursor.slice(5, 7)) === 12 ? `${Number(cursor.slice(0, 4)) + 1}-01-01` : `${cursor.slice(0, 4)}-${pad(Number(cursor.slice(5, 7)) + 1)}-01`, -1);
  const items = [];
  for (const e of entries(first, last)) if (e.type === "day") items.push({ d: e.date, html: `<button type="button" class="strip-item themed" style="${themeStyle(dayTheme(e.item))}" data-pick="${e.date}"><b>${stripDay(e.date)}</b><span>${esc(titleOf(e))}</span></button>` });
  if (SKY() && prefs.layers.sky) {
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const m = SKY().moon(d);
      if (m.fullName) items.push({ d, html: `<button type="button" class="strip-item moon" data-pick="${d}"><b>${stripDay(d)}</b><span>${esc(m.fullName)}</span></button>` });
      for (const x of skyDays(d)) items.push({ d, html: `<button type="button" class="strip-item sky" data-pick="${d}"><b>${stripDay(d)}</b><span>${esc(x.title)}</span></button>` });
    }
  }
  if (!items.length) return "";
  return `<div class="strip" aria-label="This month">${items.sort((a, b) => a.d.localeCompare(b.d)).map((x) => x.html).join("")}</div>`;
}

// (data-content-card: a card's title is what's on it, not a button's name: it may wrap, the Fixer reads it as
// text, src/fixer/strict.ts, the user, 23 Oct 2026; it's still a button to press and to the keyboard)
// (data-rules="off": so /shared/rules.js doesn't take it for a button's name either and squeeze it onto one line at
// 10.8px: a row with its icon pane, "Calendar event · Maylea", had its title wrap and was shrunk, 25 Oct 2026)
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
    return `<li><button type="button" class="row-item day themed has-pane" data-content-card data-rules="off" style="${themeStyle(dayTheme(e.item))}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day">${iconPane(e)}<time class="ico-time"><span class="kind-pill">${esc(p.label)}</span></time><span><strong>${esc(titleOf(e))}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button></li>`;
  }
  const when = e.allDay ? "All day" : `${fmtTime(e.start)}<br>${fmtTime(e.end)}`;
  const art = e.type === "event" && !e.ro;
  // Quests and bookings have no picture: their symbol sits in its place, so every row's times line up
  // (and what it is, in a word in a pill, where a boxed symbol was: "Quest", "Booking", "Recording")
  const lead = art ? `<span class="art" data-art-note="${esc(e.item.id)}" data-date="${e.date}"></span>` : `<span class="row-sym"><span class="kind-pill">${esc(kindWord(e))}</span></span>`;
  // (its icon pane first, a strip down its left edge, cosmos.css: the same icon as the card in Week and Day)
  return `<li><button type="button" class="row-item note has-art has-pane${e.ro ? " ro" : ""}" data-content-card data-rules="off" data-color="${esc(e.color)}" data-kind="${symbolOf(e)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}">${iconPane(e)}${lead}<time>${when}</time><span><strong>${esc(titleOf(e))}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button></li>`;
}
// What a card is, in a word ("Quest", "Studio booking", "Recording", "Note card")
const kindWord = (e) => (e.type === "booking" ? "Booking" : SYMBOL_WORDS[symbolOf(e)] || "Note card");

// The chosen day in a few plain sentences: how it starts and ends, when it's free, and (today) what's
// next and how soon. Shown at the top of the day's list.
function daySummary(d, list) {
  const now = localStamp();
  const timed = list.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
  const allDay = list.filter((e) => e.allDay);
  const past = d < today();
  if (!list.length) return `<div class="dp-info"><p>${past ? "Nothing was on." : d === today() ? "Nothing on today: the day is yours." : "Nothing on yet: a free day."}</p></div>`;
  const out = [];
  const clip = (e, edge) => (edge === "start" ? (e.start.slice(0, 10) < d ? `${d}T00:00` : e.start) : e.end.slice(0, 10) > d ? `${d}T24:00` : e.end);
  const hm = (stamp) => (stamp.endsWith("T24:00") ? "midnight" : fmtTime(stamp));
  const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (timed.length) {
    const first = timed[0];
    const last = timed.reduce((a, b) => (clip(b, "end") > clip(a, "end") ? b : a));
    out.push(timed.length === 1
      ? `<b>${esc(titleOf(first))}</b>, ${hm(clip(first, "start"))} to ${hm(clip(first, "end"))}.`
      : `${past ? "Started" : "Starts"} with <b>${esc(titleOf(first))}</b> at ${hm(clip(first, "start"))}; ${past ? "finished" : "finishes"} with <b>${esc(titleOf(last))}</b> at ${hm(clip(last, "end"))}.`);
    // The gaps of half an hour or more between the first start and the last finish
    const gaps = [];
    let end = clip(first, "end");
    for (const e of timed.slice(1)) {
      const s0 = clip(e, "start");
      if (s0 > end && minutesBetween(end, s0) >= 30) gaps.push(`${hm(end)}–${hm(s0)}`);
      if (clip(e, "end") > end) end = clip(e, "end");
    }
    if (timed.length > 1) out.push(gaps.length ? `Free ${and(gaps)}.` : "Back to back, no gaps.");
  }
  if (allDay.length) out.push(`All day: ${esc(and(allDay.map(titleOf)))}.`);
  if (d === today() && timed.length) {
    const on = timed.find((e) => e.start <= now && clip(e, "end") > now);
    const next = timed.find((e) => e.start > now);
    if (on) out.push(`On now: <b>${esc(titleOf(on))}</b>, until ${hm(clip(on, "end"))}.`);
    if (next) {
      const m = minutesBetween(now, next.start);
      const soon = m < 60 ? `in ${m} minute${m === 1 ? "" : "s"}` : m < 120 ? `in an hour${m % 60 >= 10 ? ` and ${m % 60} minutes` : ""}` : `in about ${Math.round(m / 60)} hours`;
      out.push(`Next: <b>${esc(titleOf(next))}</b> ${soon}.`);
    } else if (!on) out.push("That's everything for today.");
  }
  return `<div class="dp-info">${out.map((x) => `<p>${x}</p>`).join("")}</div>`;
}
// (withRows false: without its list of cards, for beside Day view, whose grid shows them)
// (data-os-skip: the page bar leaves the chosen day's list alone, it scrolls in itself on a phone: paged,
// its height changed under the month as pages turned, the days grew and shrank with it and their cards were
// left fitted to the other size, cut, 22 Oct 2026)
// (side: beside Day view on a computer, where its cards are paged by the page bar, /shared/onescreen.js, when
// they don't all fit: it had a scroll bar and its last card cut off at the bottom, 23 Oct 2026; the day's
// name, moon and + buttons stay on every page)
function dayPlanHtml(d, withRows = true, side = false) {
  // On a phone the chosen day sits below the month: it's drawn with the sky, a moment after the month
  if (!skyDrawn && phone()) return `<section class="dayplan" data-os-skip aria-label="${dayLabel(d)}"></section>`;
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
      return `<button type="button" class="dc-banner themed aes-${esc(e.item.aesthetic || "nebula")}" style="${themeStyle(dayTheme(e.item))}" data-art-day="${esc(e.item.id)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="day"><span class="dc-kicker">${esc(p.label)}${e.item.repeat === "yearly" ? " · every year" : ""}</span><b class="dc-title">${esc(titleOf(e))}</b>${e.item.info ? `<small>${esc(e.item.info.split("\n")[0])}</small>` : ""}</button>`;
    })
    .join("");
  const specials = sky
    .map((x) => `<div class="sky-row"><span>${esc(x.title)}</span><button type="button" data-make-day="${esc(JSON.stringify({ date: d, ...x }))}">Make it a day card</button></div>`)
    .join("");
  return `<section class="dayplan" ${side ? "data-os-nofill" : "data-os-skip"} aria-label="${dayLabel(d)}">
    <div class="dp-head"${side ? " data-os-pin" : ""}><div><span class="dp-kicker">${d === today() ? "Today" : WD_LONG[weekday(d)]}</span><h3>${dayLabel(d)}</h3>${moon}</div>
      <div class="dp-add"><button type="button" data-add="${d}">+ Note card</button><button type="button" data-add-day="${d}">+ Day card</button></div></div>
    ${daySummary(d, list)}${banners}${specials}${
      !withRows ? "" : rest.length ? (side ? rest.map((e) => `<ul class="rows">${rowHtml(e)}</ul>`).join("") : `<ul class="rows">${rest.map(rowHtml).join("")}</ul>`) : `<p class="empty">No note cards. Tap + Note card, or a time in Day view.</p>`
    }</section>`;
}

// The list: a page at a time, in as many columns as the screen has room for, so it never scrolls
// (22 Oct 2026, the user: "make the week view on the calender fit on one screen regardless of screen
// size … same for day view, list view as well"). Earlier and Later under it (and the bar's arrows, and
// a swipe) turn the pages; past the last page the list goes on from the day after, and before the
// first it shows what came before. The title says which days are on the page.
let listAt = { cursor: "", query: "", until: "", page: 0, last: false, pages: 1, end: "" };
function listEntries() {
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
    return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
  }
  return entries(cursor, listAt.end).filter((e) => e.date >= cursor || e.end.slice(0, 10) >= cursor);
}
const shortDay = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}${d.slice(0, 4) !== today().slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}`;
// One page of [day, card] rows in the box (its columns, cosmos.css .list.paged), from row `from`, each day's name
// (head) over its first card on the page, until the box is full; gives the first row left for the next page
// (the List, and the short Calendar's cards, drawAgenda)
function fillPage(box, rows, from, head, rowFor) {
  const over = () => box.scrollWidth > box.clientWidth + 1 || box.scrollHeight > box.clientHeight + 1;
  box.innerHTML = "";
  let day = "";
  let ul = null;
  for (let i = from; i < rows.length; i++) {
    const [d, e] = rows[i];
    let group = null;
    if (d !== day) {
      group = document.createElement("section");
      group.className = "lg";
      const more = i === from && i > 0 && rows[i - 1][0] === d;
      group.innerHTML = `${head ? `<h4>${head(d, more)}</h4>` : ""}<ul class="rows"></ul>`;
      box.append(group);
      ul = group.lastElementChild;
      day = d;
    }
    const tpl = document.createElement("template");
    tpl.innerHTML = rowFor(e, d);
    ul.append(tpl.content.firstElementChild);
    if (i > from && over()) {
      if (group) group.remove();
      else ul.lastElementChild.remove();
      return i;
    }
  }
  return rows.length;
}
function drawList() {
  if (listAt.cursor !== cursor || listAt.query !== query) listAt = { cursor, query, until: "", page: 0, last: false, pages: 1, end: "" };
  listAt.end = query ? "" : listAt.until || addDays(cursor, 59);
  // Each card under its day, in date order (all-day cards come first in the list, but their days
  // don't jump ahead of the first day shown)
  const by = new Map();
  for (const e of listEntries()) {
    const d = e.date < cursor && !query ? cursor : e.date;
    if (!by.has(d)) by.set(d, []);
    by.get(d).push(e);
  }
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).flatMap(([d, es]) => es.map((e) => [d, e]));
  // (the pager drawn first, so the pages are measured with it in place)
  view.innerHTML = `<div class="list paged"><div class="lp"></div><nav class="list-pager" aria-label="Pages"><button type="button" data-list-step="-1">‹ Earlier</button><span>Page 1 of 1</span><button type="button" data-list-step="1">Later ›</button></nav></div>`;
  const box = view.querySelector(".lp");
  const pager = view.querySelector(".list-pager");
  if (!rows.length) {
    box.innerHTML = `<p class="empty">${query ? `Nothing matches “${esc(query)}”.` : `Nothing from ${dayLabel(cursor)} to ${dayLabel(listAt.end)}. Tap + to add a note card.`}</p>`;
    listAt.pages = 1;
    listAt.page = 0;
    pager.innerHTML = query ? "" : `<button type="button" data-list-step="-1">‹ Earlier</button><span></span><button type="button" data-list-step="1">Later ›</button>`;
    if (!query) $("title-text").textContent = `${shortDay(cursor)} – ${shortDay(listAt.end)}`;
    return;
  }
  // A page: as many cards as fit, each day's name over its first card on the page
  // (a short Calendar: each card a line, its times side by side, "08:45–10:45", not one over the other)
  const rowFor = short() ? (e) => rowHtml(e).replace(/<time>([^<]*)<br>([^<]*)<\/time>/, '<time class="ag-when">$1–$2</time>') : rowHtml;
  const fill = (from) => fillPage(box, rows, from, (d, more) => `${d === today() ? "Today · " : ""}${dayLabel(d)}${d.slice(0, 4) !== today().slice(0, 4) ? ` ${d.slice(0, 4)}` : ""}${more ? " · continued" : ""}`, rowFor);
  const starts = [0];
  for (let next = fill(0); next < rows.length; next = fill(next)) starts.push(next);
  listAt.pages = starts.length;
  if (listAt.last) listAt.page = starts.length - 1;
  listAt.last = false;
  listAt.page = Math.min(listAt.page, starts.length - 1);
  const from = starts[listAt.page];
  const to = fill(from);
  const [a, b] = [rows[from][0], rows[to - 1][0]];
  $("title-text").textContent = query ? "Search" : a === b ? shortDay(a) : `${shortDay(a)} – ${shortDay(b)}`;
  const first = listAt.page === 0;
  const last = listAt.page === starts.length - 1;
  const words = query ? `${rows.length} found${starts.length > 1 ? ` · page ${listAt.page + 1} of ${starts.length}` : ""}` : starts.length > 1 ? `Page ${listAt.page + 1} of ${starts.length}` : "";
  // (a search's pages end where it does: no Earlier on its first, no Later on its last)
  pager.innerHTML = `${query && first ? "<i></i>" : '<button type="button" data-list-step="-1">‹ Earlier</button>'}<span>${words}</span>${query && last ? "<i></i>" : '<button type="button" data-list-step="1">Later ›</button>'}`;
}
// Earlier and Later in the list: a page, else the days before or after
function listStep(dir) {
  if (dir > 0 && listAt.page < listAt.pages - 1) listAt.page++;
  else if (dir < 0 && listAt.page > 0) listAt.page--;
  else if (query) return;
  else if (dir > 0) {
    cursor = addDays(listAt.end, 1);
    listAt = { cursor, query, until: "", page: 0, last: false, pages: 1, end: "" };
  } else {
    const until = addDays(cursor, -1);
    cursor = addDays(cursor, -60);
    listAt = { cursor, query, until, page: 0, last: true, pages: 1, end: "" };
  }
  render();
}

// Week and day: a column per day, events placed by time. Only the hours that matter are shown, and
// they share out the screen's height, so the whole day is in sight with nothing to scroll (22 Oct
// 2026, the user: "make the week view on the calender fit on one screen regardless of screen size"):
// the working day, 08:00 to 20:00, stretched to take in every card on the days shown and, today, the
// time now. drawTimeGrid sets the first hour and each hour's height once it has measured the room.
let gridH0 = 0;
let gridHh = 0;
// (Day view's hour at most: compact, the day's cards a card's size, 23 Oct 2026)
const DAY_HH = 36;
function hourHeight() {
  return gridHh || (phone() ? 44 : 52);
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
    // (each card wider into the columns to its right that are free all the while it's on: a long card beside
    // a run of short ones isn't left a quarter of the day's width)
    for (const e of group) {
      e.span = 1;
      for (let c = e.col + 1; c < cols.length && !group.some((o) => o.col === c && o.start < e.end && o.end > e.start); c++) e.span++;
    }
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
// A card's time window, plainly on the card (24 Oct 2026, the user: "make the time-window of the note card be
// more noticable on the actual note card so it doesn't look like just a blank gradient square"): a chip in the
// card's time colour on a darker patch, at the start of its title's first line, so it shows wherever the title
// does, even on a card a line tall (fitCard fits the two together). Too narrow for it on one line, it breaks
// after the dash ("11:00–" over "12:00"), never through a time.
// (a card with room for a single line of its words, too narrow for both times and its title, shows when it
// starts, "12:45": .ev-t-start, fitCard; the whole window is in its tooltip, read aloud and in it when it opens)
// A title's words with a hyphen inside them ("6-10", "11-2", "e-mail") kept whole on their line: a narrow card broke
// them after the hyphen, "6-" over "10 Aaliyah", 25 Oct 2026 (escaped already: its words are whole entities)
const keepWords = (html) => html.replace(/\S*\w-\w\S*/g, '<span class="ev-nb">$&</span>');
function timeChip(e, from = e.start) {
  return `<span class="ev-time" aria-hidden="true"><span class="ev-t0">${fmtTime(from)}</span><span class="ev-t1">–${fmtTime(e.end)}</span></span>`;
}
// (more: hours added after the last, cal.js below: a card at the grid's foot with more words than room)
function drawTimeGrid(n, more = 0) {
  // (Simple look on a very short Calendar, as simple.css: no room for hours, so the cards as a list, each with
  // its day; a card opens as anywhere. The same for the week on an upright phone, where seven columns of hours
  // left each day 20px, too thin to read or tap: its hours are in Day view, and on its side)
  if (short() || (n === 7 && document.documentElement.dataset.ui !== "rich" && document.documentElement.dataset.form === "phone-up")) {
    const from = n === 7 ? mondayOf(cursor) : cursor;
    return drawAgenda(Array.from({ length: n }, (_, i) => addDays(from, i)), n === 7 ? "this week" : `on ${dayLabel(from)}`);
  }
  const first = n === 7 ? mondayOf(cursor) : cursor;
  const days = Array.from({ length: n }, (_, i) => addDays(first, i));
  const all = entries(addDays(first, -1), addDays(first, n));
  const t = today();
  const now = localStamp();
  // The part of each timed event on each day
  const parts = days.map((d) =>
    all
      .filter((e) => !e.allDay && e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && e.end > `${d}T00:00`)
      .map((e) => ({ ...e, s: e.start < `${d}T00:00` ? `${d}T00:00` : e.start, en: e.end > `${d}T23:59` ? `${d}T24:00` : e.end })),
  );
  // Each part in minutes from its day's start (0 to 1440)
  const spans = days.map((d, i) => parts[i].map((e) => ({ e, m0: minutesBetween(`${d}T00:00`, e.s), m1: minutesBetween(`${d}T00:00`, e.en) })));
  const nowM = days.includes(t) ? minutesBetween(`${t}T00:00`, now) : -1;
  // A card is never shorter than a line of its words: one shorter in time is drawn that tall, and the cards
  // it then reaches sit beside it, as cards at the same time do (23 Oct 2026, the user's week: 22:23–22:25
  // and 22:25–22:27 were drawn one on top of the other, 18px slivers with no words). How many minutes that
  // is depends on the hours' height, which depends on the hours shown: worked out again until it settles.
  const LINE_PX = 18;
  const shortest = (hh) => Math.max(15, Math.ceil(((LINE_PX + 2) / hh) * 60));
  const fmtH = (h) => `${pad(h)}:00`;
  let minM = shortest(hourHeight());
  let h0 = 8;
  let h1 = 20;
  let H = 12;
  let shown = [];
  const place = () => {
    shown = spans.map((list) =>
      list.map((x) => {
        let v1 = Math.max(x.m1, x.m0 + minM);
        let v0 = x.m0;
        if (v1 > 1440) [v0, v1] = [Math.min(x.m0, 1440 - minM), 1440];
        return { ...x, v0, v1 };
      }),
    );
    // The hours shown: 08:00 to 20:00, and more so every card (as tall as it's drawn) and, today, the time now
    // are inside them: a card at 22:27 has its hour, 22:00 to 23:00, and the grid ends with "23:00"
    h0 = 8;
    h1 = 20;
    for (const list of shown) for (const x of list) {
      h0 = Math.min(h0, Math.floor(x.v0 / 60));
      h1 = Math.max(h1, Math.ceil(x.v1 / 60));
    }
    if (nowM >= 0) {
      h0 = Math.min(h0, Math.floor(nowM / 60));
      h1 = Math.max(h1, Math.floor(nowM / 60) + 1);
    }
    // Day view: just the day's own hours, an hour before its first card to an hour after its last (and, today,
    // the time now), at least a working day's eight; a day with nothing on, 08:00 to 18:00. Its hours are a
    // set height (DAY_HH), not stretched to the screen's (23 Oct 2026, the user: "the ui is so stretched and
    // huge sized can we make this more compact and optimized")
    if (n === 1) {
      const list = shown[0];
      if (list.length) {
        h0 = Math.floor(Math.min(...list.map((x) => x.v0)) / 60) - 1;
        h1 = Math.ceil(Math.max(...list.map((x) => x.v1)) / 60) + 1;
      } else [h0, h1] = [8, 18];
      if (nowM >= 0) {
        h0 = Math.min(h0, Math.floor(nowM / 60));
        h1 = Math.max(h1, Math.floor(nowM / 60) + 1);
      }
      h0 = Math.max(0, h0);
      h1 = Math.min(24, h1);
      // (too few: one more hour after, then one before, in turn, until there are eight)
      for (let up = true; h1 - h0 < 8; up = !up) {
        if ((up && h1 < 24) || h0 === 0) h1++;
        else h0--;
      }
    }
    h1 += more;
    h0 = Math.max(0, h0);
    h1 = Math.min(24, h1);
    H = h1 - h0;
  };
  place();
  gridH0 = h0;
  // (in hours from the top of the grid; each hour is var(--hh) tall)
  const at = (d, stamp) => (minutesBetween(`${d}T00:00`, stamp) / 60 - h0).toFixed(3);
  const head = days
    // (the day in a word on a computer, "Nineteenth", as in the month)
    .map((d) => `<button type="button" class="tg-day${d === t ? " today" : ""}" data-goto="${d}"><small>${WD[weekday(d)]}</small><b${phone() ? "" : ' class="tg-word"'}>${phone() ? Number(d.slice(8)) : ORD[Number(d.slice(8))]}</b>${moonMark(d, 12)}</button>`)
    .join("");
  const alldayCols = days.map((d) => `<div>${onDay(all, d).filter((e) => e.allDay).map((e) => pillHtml(e, { pane: true })).join("")}</div>`).join("");
  // (how many cards sit side by side at the busiest moment of each day: dayCols widens a busy day by it)
  const crowd = days.map(() => 1);
  // The hours, each named, and the hour the grid ends at named at its foot (it ended at 22:00's line with a
  // card at 22:27 under it, and looked cut off, 23 Oct 2026); the days' columns with their cards
  const body = () => {
    const hours = `<div class="hours">${Array.from({ length: H }, (_, i) => `<div class="hour"><span>${fmtH(h0 + i)}</span></div>`).join("")}<span class="hour-end" aria-hidden="true">${fmtH(h1)}</span></div>`;
    const cols = days
      .map((d, i) => {
        const evs = parts[i];
        // (laid out by the room each card takes, as drawn: cards that touch sit side by side)
        const key = (m) => String(m).padStart(4, "0");
        const placed = layoutColumn(shown[i].map((x) => ({ start: key(x.v0), end: key(x.v1), x })));
        crowd[i] = Math.max(1, ...placed.map((p) => p.cols));
        const blocks = placed
          .map((p) => {
            const { e, v0, v1, m0, m1 } = p.x;
            const top = `calc(var(--hh) * ${(v0 / 60 - h0).toFixed(3)})`;
            const height = `max(18px, calc(var(--hh) * ${((v1 - v0) / 60).toFixed(3)} - 2px))`;
            const w = 100 / p.cols;
            // (no wider than a card is easy to read, --ev-max: Day view's one column is the whole grid wide, and
            // a card stretched across it had its words floating in the middle, 23 Oct 2026, the user: "horrible
            // stretched ui elements"; cards at the same time sit side by side from the left, as in the week)
            // (--ev-gap, cosmos.css: the room round each card, from its neighbours and the column's edges; 25 Oct
            // 2026, the user: "can you center text, add padding and margin")
            const left = `calc(min(${(p.col * w).toFixed(4)}%, ${p.col} * var(--ev-max, 100vw)) + var(--ev-gap, 2px))`;
            const width = `calc(min(${(w * p.span).toFixed(4)}%, ${p.span} * var(--ev-max, 100vw)) - 2 * var(--ev-gap, 2px))`;
            // (--ev-len: how long it really is, from where it's drawn: the hour lines inside it, cosmos.css, stop at
            // its real end even when it's drawn taller for its words, so they never say it lasts longer than it does)
            const len = `calc(var(--hh) * ${((Math.max(m1, m0) - v0) / 60).toFixed(3)})`;
            const what = whatOf(e) && whatOf(e) !== e.item.location ? whatOf(e) : "";
            return `<div class="ev has-pane${e.ro ? " ro" : ""}" data-color="${esc(e.color)}" data-kind="${symbolOf(e)}" data-id="${esc(e.item.id)}" data-date="${e.date}" data-type="${e.type}" data-start="${e.start}" data-end="${e.end}" style="--ev-top:${top};--ev-len:${len};top:var(--ev-top);height:${height};left:${left};width:${width}" tabindex="0" role="button" data-content-card aria-label="${esc(titleOf(e))}, ${fmtTime(e.start)} to ${fmtTime(e.end)}">${iconPane(e)}<strong>${timeChip(e)} ${keepWords(esc(titleOf(e)))}</strong>${e.item.location ? `<small>${esc(e.item.location)}</small>` : ""}${what ? `<em class="ev-what">${esc(what)}</em>` : ""}${e.ro ? "" : '<span class="grip" data-grip="1"></span>'}</div>`;
          })
          .join("");
        const line = d === t ? `<div class="now-line" style="top:calc(var(--hh) * ${at(d, now)})"></div>` : "";
        // (each day tinted by its cards' kinds, by how many of each, as in the month)
        // (and, like the month, left to fit its own cards: a narrow card's title is meant to go onto more lines)
        return `<div class="col${d === t ? " today" : ""}${weekday(d) % 6 === 0 ? " weekend" : ""}" data-date="${d}" data-from="${h0}" data-hours="${H}" data-rules="off" style="height:calc(var(--hh) * ${H})${evs.length ? `;--mix: ${kindTint(evs)}` : ""}">${blocks}${line}</div>`;
      })
      .join("");
    return hours + cols;
  };
  const grid = `<div class="tg" style="--cols:${n};--hh:${hourHeight()}px">
    <div class="tg-head" style="grid-column:1/-1;display:grid;grid-template-columns:inherit"><span></span>${head}<div class="allday">${alldayCols}</div></div>
    ${body()}</div>`;
  // Day view: the day beside it on a wider screen (its day cards, its special days, the moon, adding a card,
  // its cards in a list, in pages when they don't all fit), above it in a line or two on a narrower one
  view.innerHTML = n === 1 ? `<div class="dayview">${dayAside(first)}${grid}</div>` : grid;
  const side = view.querySelector(".dv-side > .dayplan");
  if (side) adoptSide(side);
  // The hours share out the room left under the days' names
  const tg = view.querySelector(".tg");
  // (less the room kept clear under the phone's round + button)
  const room = () => tg.clientHeight - (parseFloat(getComputedStyle(tg).paddingBottom) || 0) - tg.querySelector(".tg-head").offsetHeight - 10;
  // (Day view: each hour DAY_HH tall at most, less when they'd not all fit; the week's share out the height)
  for (let pass = 0; ; pass++) {
    gridHh = Math.max(10, Math.min(n === 1 ? DAY_HH : Infinity, room() / H));
    tg.style.setProperty("--hh", `${gridHh}px`);
    const want = shortest(gridHh);
    if (want === minM || pass >= 3) break;
    // (the shortest card's height in minutes changed with the hours' height: placed again)
    minM = want;
    place();
    gridH0 = h0;
    for (const old of tg.querySelectorAll(":scope > .hours, :scope > .col")) old.remove();
    tg.insertAdjacentHTML("beforeend", body());
  }
  // (short hours: every other hour named, so the names never crowd each other)
  tg.classList.toggle("sparse", gridHh < 24);
  if (n > 1) dayCols(tg, crowd, spans.map((list) => list.length > 0));
  fitCards(tg);
  // A card at the foot of the grid with no room under it to grow for its words (fitCard): the grid once more with an
  // hour after its last, so its title shows whole rather than ending "…" (25 Oct 2026: "22:00–22:01 ✓ 🍞 Eat bread"
  // was "22:00–22:01 …" at the 23:00 line of a short window)
  const under = (el) => [...el.parentElement.querySelectorAll(":scope > .ev")].some((o) => o !== el && o.offsetTop >= el.offsetTop + el.offsetHeight - 1 && o.offsetLeft < el.offsetLeft + el.offsetWidth && o.offsetLeft + o.offsetWidth > el.offsetLeft);
  if (!more && h1 < 24 && [...tg.querySelectorAll(".col .ev.ev-clamp")].some((el) => !under(el))) drawTimeGrid(n, 1);
}
// A busy day a little wider than a quiet one, so cards at the same time each keep room to read (25 Oct 2026, the
// user: "on the week type of note cards can you center text, add padding and margin" and "there shouldn't be hiding
// under element note cards"): four cards at once on a Sunday had 48px each, their titles broken mid-word,
// "Calend / ar event", or cut with "…". Cards never sit over each other; the busy day takes the room from the quiet
// ones instead. Each day wants: a card's least width (EV_MIN) for each card side by side at its busiest; a day with
// one card at a time, a card's comfortable width (EV_SOLO); and always its name ("Twenty-second") whole. What's left
// over is shared to make the narrowest days wider first; when there isn't room for all of it, every day keeps its
// name's width and the rest is shared by how much more each wants. A week with no busy day stays even.
// (--day-cols, cosmos.css: the week's columns, its all-day row and its day names share it)
const EV_MIN = 96; // a card's least width that reads, with its icon pane and its room round it
const EV_SOLO = 150; // a day's one card: its time and title on a line
function dayCols(tg, crowd, busy) {
  const cols = [...tg.querySelectorAll(":scope > .col")];
  const room = cols.reduce((s, c) => s + c.getBoundingClientRect().width, 0);
  const n = cols.length;
  if (!n || !room) return;
  const even = room / n;
  tg.style.removeProperty("--day-cols");
  if (crowd.every((c) => c * EV_MIN <= even)) return;
  // (its name's width, from its words themselves (its box fills the column), with its pill's padding; never more
  // than an even share)
  const range = document.createRange();
  const wordsW = (el) => (range.selectNodeContents(el), range.getBoundingClientRect().width);
  const names = [...tg.querySelectorAll(".tg-day")].map((d) => Math.min(even, Math.max(0, ...[...d.querySelectorAll(":scope > :is(small, b)")].map(wordsW)) + 28));
  const least = cols.map((_, i) => names[i] || 0);
  const want = cols.map((_, i) => Math.max(least[i], crowd[i] > 1 ? crowd[i] * EV_MIN : busy[i] ? Math.min(even, EV_SOLO) : 0));
  const total = want.reduce((s, x) => s + x, 0);
  let widths;
  if (total <= room) {
    // (the level the narrowest days are raised to, so the widths add up to the room)
    let lo = 0;
    let hi = room;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (want.reduce((s, x) => s + Math.max(mid, x), 0) > room) hi = mid;
      else lo = mid;
    }
    widths = want.map((x) => Math.max(lo, x));
  } else {
    const more = want.map((x, i) => x - least[i]);
    const extra = more.reduce((s, x) => s + x, 0);
    const spare = room - least.reduce((s, x) => s + x, 0);
    widths = least.map((x, i) => x + (extra ? (more[i] * spare) / extra : 0));
  }
  tg.style.setProperty("--day-cols", widths.map((w) => `minmax(0, ${(w / even).toFixed(3)}fr)`).join(" "));
}
// (the grid drawn again whenever its size changes, and its cards looked over once more a moment after they're drawn
// and when the fonts are in: a card fitted before its fonts or the page had settled was left with its title on one
// line, cut through a word, "17:30–19:30 Busy · Session: M", 24 Oct 2026; never a loop: fitting a card doesn't change
// the grid's size, drawing it again gives the same size, and only a card whose title is cut is fitted again)
let gridSeen = null;
function fitCards(tg, onlyCut = false) {
  if (!tg.isConnected) return;
  if (!onlyCut) {
    gridSeen?.disconnect();
    let size = `${tg.clientWidth}x${tg.clientHeight}`;
    gridSeen = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
      const now = `${tg.clientWidth}x${tg.clientHeight}`;
      if (now === size || !tg.isConnected) return;
      size = now;
      // (its hours share out the new room too: drawn again, the new grid the same size, so no more than once)
      requestAnimationFrame(() => tg.isConnected && !drag && $("sheet").hidden && render());
    }) : null;
    gridSeen?.observe(tg);
    setTimeout(() => fitCards(tg, true), 600);
    // (fonts still coming: once more when they're in)
    if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(() => requestAnimationFrame(() => fitCards(tg, true)));
  }
  if (onlyCut) {
    if (document.documentElement.dataset.ui === "rich" || drag) return;
    // (looked over from the boxes' own sizes, no style or box reads a card: reads only, unless one is cut)
    const cards = [...tg.querySelectorAll(".col .ev")];
    const first = cards.find((el) => el.firstElementChild);
    const lh = first ? parseFloat(getComputedStyle(first.querySelector(":scope > strong") || first).lineHeight) || 13 : 13;
    for (const el of cards.filter((el) => titleCut(el, lh))) fitCard(el);
    return;
  }
  // Cards squeezed narrow (several at once, or a phone's week) show just their title, wrapped,
  // so it can still be read; too thin even for that, just their colour (tap one to read it)
  // (every card measured first, then each one set: one layout for them all, not one a card)
  const evs = [...tg.querySelectorAll(".col .ev")];
  const sizes = evs.map((el) => [el.offsetWidth, el.clientHeight]);
  const simple = document.documentElement.dataset.ui !== "rich";
  evs.forEach((el, i) => {
    const [w, h] = sizes[i];
    // Its icon pane (cosmos.css): a strip down its left side, slimmer on a narrowish card; on a narrow one a band
    // across its top, so the title keeps the card's whole width (fitCard takes it away if even so its title can't
    // show); thinner than a word, none (it shows the icon in its middle instead, fitCard .bare)
    // (Rich look: no fitCard to take the band away again, so a band only where there's height for it)
    const top = w >= 40 && w < 84 && (simple || h >= 46);
    el.classList.toggle("pane-top", top);
    el.classList.toggle("pane-slim", !top && w >= (simple ? 84 : 56) && w < 112);
    el.classList.toggle("pane-off", !top && w < (simple ? 40 : 56));
    el.classList.toggle("slim", w < 76);
    el.classList.toggle("thin", w < 30);
    // As many lines of its title as fit its height (a short card can't show six)
    if (w < 76) el.style.setProperty("--lines", String(Math.max(1, Math.floor((h - (top ? 20 : 4)) / 12.6))));
    // (a short card: its title and time on one line)
    el.classList.toggle("short", h < 34);
    // (a tall card, two hours or more: its words at its top, under the hour it starts, not floating in the middle
    // of a long block; a shorter one has them in its middle)
    el.classList.toggle("tall", h >= 80);
  });
  // (Simple look: each of a card's lines whole on one line, or not there; a card too small for even its
  // title is just its colour, its words on hover and read aloud: never cut short or broken up)
  if (document.documentElement.dataset.ui !== "rich") for (const el of tg.querySelectorAll(".col .ev")) fitCard(el);
}
// A card's title cut without its "…": wider than its line, or half a line or more under the card's foot (a letter's
// box stands a little taller than its line, so less than that is no cut)
function titleCut(el, lh = 13) {
  const t = el.querySelector(":scope > strong");
  if (!t || !t.offsetHeight || el.classList.contains("bare") || el.classList.contains("ev-clamp")) return false;
  // (its foot: the card's height less its padding, 1–3px)
  return t.scrollWidth > t.clientWidth + 1 || t.offsetTop + t.offsetHeight - (el.clientHeight - 1) > lh / 2;
}
// A short Calendar's cards (24 Oct 2026, the user, at a short Nova Desk: "can you optimize and make compact the
// short height nova desk - nova calender this looks stupid"; it was a stack of full-width bars, four to a page):
// as the List does it, in as many columns as fit, each day's name over its cards, each card a slim row with its
// time window in a chip and its title beside it; a page at a time, ‹ › beside them turning the pages and, past
// the first or the last, the week (month, day) before or after.
let agAt = { key: "", page: 0, toLast: false };
function drawAgenda(days, when) {
  const all = entries(days[0], days[days.length - 1]);
  const many = days.length > 1;
  const key = `${prefs.view}:${days[0]}:${days.length}`;
  const rows = days.flatMap((d) => onDay(all, d).map((e) => [d, e]));
  // (opened afresh: the page with today on it, when today's in it; else the first, or the last coming back)
  const fresh = agAt.key !== key;
  if (fresh) agAt = { key, page: agAt.toLast ? Infinity : 0, toLast: false };
  const aim = fresh && !Number.isFinite(agAt.page) ? -1 : fresh && days.includes(today()) ? rows.findIndex(([d]) => d >= today()) : -1;
  const rowFor = (e, d) => rowHtml(e).replace(/<time[^>]*>[\s\S]*?<\/time>/, `<time class="ag-when">${e.allDay || e.type === "day" ? "All day" : `${fmtTime(e.start > `${d}T00:00` ? e.start : `${d}T00:00`)}–${fmtTime(e.end)}`}</time>`);
  const head = many ? (d, more) => `${d === today() ? "Today · " : ""}${WD[weekday(d)]} ${shortDay(d)}${more ? " · continued" : ""}` : null;
  view.innerHTML = `<div class="list paged agenda"><div class="lp"></div><nav class="list-pager" aria-label="Pages"><button type="button" data-ag-step="-1" aria-label="Earlier">‹</button><span></span><button type="button" data-ag-step="1" aria-label="Later">›</button></nav></div>`;
  const box = view.querySelector(".lp");
  if (!rows.length) {
    box.innerHTML = `<p class="empty">Nothing ${when}. Tap + to add a note card.</p>`;
    agAt.pages = 1;
    agAt.page = 0;
    return;
  }
  const starts = [0];
  for (let next = fillPage(box, rows, 0, head, rowFor); next < rows.length; next = fillPage(box, rows, next, head, rowFor)) starts.push(next);
  agAt.pages = starts.length;
  if (aim > 0) agAt.page = starts.filter((i) => i <= aim).length - 1;
  agAt.page = Math.max(0, Math.min(agAt.page, starts.length - 1));
  fillPage(box, rows, starts[agAt.page], head, rowFor);
  view.querySelector(".list-pager > span").textContent = starts.length > 1 ? `${agAt.page + 1} / ${starts.length}` : "";
}
// ‹ and › beside the short Calendar's cards: a page, else the week (month, day) before or after
function agStep(dir) {
  if (dir > 0 && agAt.page < agAt.pages - 1) agAt.page++;
  else if (dir < 0 && agAt.page > 0) agAt.page--;
  else {
    agAt.toLast = dir < 0;
    return step(dir);
  }
  render();
}
// (the page bar comes with /shared/fit.js, a moment after the Calendar on its first opening)
function adoptSide(side, tries = 0) {
  if (!side.isConnected) return;
  if (window.NovaOneScreen) window.NovaOneScreen.adopt(side);
  else if (tries < 20) setTimeout(() => adoptSide(side, tries + 1), 250);
}
// Simple look: a card shows its title, always (23 Oct 2026, the user's week had blocks with no words in them:
// a title that didn't fit on one line was taken away). In turn, until it fits:
//   1. on one line;
//   2. a little smaller, down to 11px (no smaller: it must still read);
//   3. its words onto as many lines as the card has room for (never cut through a word unless one word is
//      wider than the card), then the card's edges and lines a little closer (.ev-tight) for one more line;
//   4. the card a little taller, into the free room under it in its column;
//   5. still no room: as many whole lines as fit, ending "…" (.ev-clamp), or for a card thinner than a word
//      its colour and the symbol of what it's about (.bare). Either opens out to its whole title while it's pointed at or has the
//      keyboard's focus (simple.css), and a tap opens it, its whole title at the top; it's read aloud whole.
// Its other lines (the time, what it's for) each show whole on one line, or not at all.
function fitCard(el) {
  // (on a touch screen a short card is at least 32px to tap, where the room under it is free)
  if (el.offsetHeight < 32 && matchMedia("(pointer: coarse)").matches) {
    const r = roomUnder(el);
    if (r > el.offsetHeight) el.style.setProperty("height", `${Math.min(32, r)}px`);
  }
  const title = el.querySelector(":scope > strong");
  const lines = [...el.querySelectorAll(":scope > :is(small, .ev-what)")];
  el.classList.remove("bare", "ev-wrap", "ev-small", "ev-tight", "ev-clamp", "ev-up", "ev-t-start");
  for (const l of [title, ...lines]) if (l) l.classList.remove("ev-off");
  if (!title) return;
  const inner = () => el.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(el).paddingBottom) || 0) + 1;
  const fits = () => title.scrollWidth <= title.clientWidth + 1 && title.getBoundingClientRect().bottom <= inner();
  // (a short card shows its title and time side by side: the title alone when it needs the room)
  if (!fits() && el.classList.contains("short")) for (const l of lines) l.classList.add("ev-off");
  if (!fits()) el.classList.add("ev-small");
  // (its words onto more lines: the title alone in the card, not side by side with the time; between words, already
  // at the smaller size, a word broken only when it's wider than the card on its own, simple.css)
  if (!fits()) el.classList.add("ev-wrap"), el.classList.remove("short");
  // (its edges and lines a little closer, so its time and title take one more line before any is cut short: a card
  // 30px tall had room for two lines of words, and showed one, 24 Oct 2026)
  if (!fits()) el.classList.add("ev-tight");
  if (!fits()) {
    const need = Math.ceil(title.getBoundingClientRect().bottom - inner()) + 2;
    const r = roomUnder(el);
    if (need > 0 && r >= el.offsetHeight + need) el.style.setProperty("height", `${el.offsetHeight + need}px`), el.classList.remove("short");
    // (not room for all of it: as many more whole lines as there's room for, so its time window and the start of its
    // title both show, 24 Oct 2026)
    else if (need > 0) {
      const lh = parseFloat(getComputedStyle(title).lineHeight) || 13;
      const more = Math.floor((r - el.offsetHeight) / lh) * lh;
      if (more >= lh) el.style.setProperty("height", `${Math.ceil(el.offsetHeight + more)}px`), el.classList.remove("short");
    }
  }
  const bare = !fits() && title.getBoundingClientRect().width < 30;
  el.classList.toggle("bare", bare);
  // (a card thinner than a word shows the symbol of what it's about, so it's never an empty sliver)
  let sym = el.querySelector(":scope > .ev-sym");
  if (bare && !sym && presets().icon(el.dataset.kind, "", "")) {
    sym = document.createElement("i");
    sym.className = "ev-sym";
    sym.setAttribute("aria-hidden", "true");
    sym.innerHTML = presets().icon(el.dataset.kind, "", "");
    el.prepend(sym);
  }
  // (still more words than room, even so: as many lines as there's room for, ending "…")
  const clamp = !bare && !fits();
  // (its icon pane a band across its top, and its title still can't show: the band gives its room to the words)
  if ((bare || clamp) && el.classList.contains("pane-top")) {
    el.classList.replace("pane-top", "pane-off");
    return fitCard(el);
  }
  el.classList.toggle("ev-clamp", clamp);
  const lineCount = Math.max(1, Math.floor((inner() - title.getBoundingClientRect().top) / (parseFloat(getComputedStyle(title).lineHeight) || 13)));
  if (clamp) el.style.setProperty("--lines", String(lineCount));
  // (one line, and its time window doesn't fit on it whole: when it starts, so the line isn't a time cut in two)
  const chip = title.querySelector(":scope > .ev-time");
  if (clamp && lineCount === 1 && chip && (chip.getClientRects().length > 1 || chip.getBoundingClientRect().right > title.getBoundingClientRect().right + 1)) el.classList.add("ev-t-start");
  if (bare || clamp) el.title = el.getAttribute("aria-label") || "";
  else el.removeAttribute("title");
  // (one in the lower half of its day opens out upwards, from its foot, so all of it stays in the grid)
  const up = (bare || clamp) && el.offsetTop + el.offsetHeight / 2 > el.parentElement.clientHeight / 2;
  el.classList.toggle("ev-up", up);
  if (up) el.style.setProperty("--ev-bottom", `${el.parentElement.clientHeight - el.offsetTop - el.offsetHeight}px`);
  const bottom = inner();
  for (const l of lines) if (!l.classList.contains("ev-off") && (l.scrollWidth > l.clientWidth + 1 || l.getBoundingClientRect().bottom > bottom)) l.classList.add("ev-off");
}
// The free room under a card in its column, to the next card beside or under it (or the column's foot)
function roomUnder(el) {
  const top = el.offsetTop, l = el.offsetLeft, r = l + el.offsetWidth;
  let room = el.parentElement.clientHeight - top;
  for (const o of el.parentElement.querySelectorAll(":scope > .ev")) if (o !== el && o.offsetTop > top && o.offsetLeft < r && o.offsetLeft + o.offsetWidth > l) room = Math.min(room, o.offsetTop - top - 2);
  // (nor under the round + button, where it floats over the hours)
  const add = $("add").getBoundingClientRect(), me = el.getBoundingClientRect();
  if (add.width && add.left < me.right && add.right > me.left && add.bottom > me.top) room = Math.min(room, add.top - me.top - 2);
  return room;
}
function dayAside(d) {
  if (matchMedia("(min-width: 900px)").matches) return `<div class="dv-side">${dayPlanHtml(d, true, true)}</div>`;
  return `<div class="dv-sum">${daySummary(d, onDay(entries(d, d), d))}</div>`;
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
  if (prefs.view === "list") return listStep(dir);
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
  listAt.cursor = ""; // (the list from its first page)
  render();
  // (today, wherever it is on screen, glows softly for a moment: so Today always shows where it is)
  for (const el of document.querySelectorAll(".cell.today, .col.today, .tg-day.today")) {
    el.classList.remove("here");
    void el.offsetWidth;
    el.classList.add("here");
    setTimeout(() => el.classList.remove("here"), 1400);
  }
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
// Swipe left and right to move (every view; in the week, not when starting on a card, which drags)
let swipe = null;
view.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1 && !(prefs.view === "week" && e.target.closest(".ev"))) swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
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
  const turn = e.target.closest("[data-list-step]");
  if (turn) return step(Number(turn.dataset.listStep));
  const page = e.target.closest("[data-ag-step]");
  if (page) return agStep(Number(page.dataset.agStep));
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
    if (cell.closest(".grid.textual")) {
      cursor = cell.dataset.date;
      return openNew({ date: cursor });
    }
    if (cell.dataset.date === cursor && !phone()) return openNew({ date: cursor });
    cursor = cell.dataset.date;
    return render();
  }
  const col = e.target.closest(".col");
  if (col) {
    const rect = col.getBoundingClientRect();
    const mins = Math.min(23 * 60 + 30, gridH0 * 60 + Math.floor((((e.clientY - rect.top) / hourHeight()) * 60) / 30) * 30);
    openNew({ date: col.dataset.date, time: `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}` });
  }
});
view.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".ev[data-id]")) {
    e.preventDefault();
    openExisting(e.target.dataset.type, e.target.dataset.id, e.target.dataset.date);
  }
});

// ---- Drag to move: every view where cards sit on days (25 Oct 2026, the user: "left click on a note card make
// it draggable") ----
// Week and Day: a card moves by 15 minutes (and, in the week, across days) and stretches by its grip, as before.
// Month (and the week's all-day strip): a card is lifted off its day, a copy of it follows the pointer, the day
// under it lights up, and dropped there it moves to that day at the same time and for as long (a repeating one
// asks which, as everywhere). A mouse picks a card up once it moves a few pixels, so a plain click still opens
// it; a finger holds still for a moment first, so scrolling and swiping still work, and a hold let go without
// moving opens the right-click menu for that card, as a long press does anywhere else. Escape puts it back.
// Bookings and Nova Agent's plan can't be moved here: trying gives a little shake and says why, once.
let drag = null;
let justDragged = false;
const settle = () => {
  justDragged = true;
  setTimeout(() => (justDragged = false), 50);
};
// (the time of a card on the day it's shown: a repeating one's own time that day)
function occurrenceOf(id, date) {
  return entries(date, date).find((e) => e.item.id === id && e.date === date) || null;
}
function startDrag(el, x, y, resize) {
  swipe = null; // (a finger's drag isn't also a swipe to the next week)
  drag = { mode: "time", el, x, y, resize, start: el.dataset.start, end: el.dataset.end, dMin: 0, dDay: 0, moved: false, colW: el.parentElement.getBoundingClientRect().width, col: el.closest(".col[data-date]") };
  el.classList.add("dragging");
  document.documentElement.classList.add("cal-dragging");
  if (navigator.vibrate) navigator.vibrate(12);
  sfx("lift");
}
// The day under the pointer: a month's day, a week's or day's column, a day's name above it, the all-day strip
function dayAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el || !view.contains(el)) return "";
  const at = el.closest(".cell[data-date], .col[data-date], .tg-day[data-goto]");
  if (at) return at.dataset.date || at.dataset.goto;
  const strip = el.closest(".allday > div");
  if (strip) return (view.querySelectorAll(".col[data-date]")[[...strip.parentElement.children].indexOf(strip)] || {}).dataset?.date || "";
  return "";
}
function startDayDrag(el, x, y) {
  const id = el.dataset.id;
  const date = el.dataset.date;
  const e = occurrenceOf(id, date);
  if (!e) return;
  swipe = null;
  // (the day it's lifted from: a card that runs over several days is on each of them)
  const from = dayAt(x, y) || date;
  const r = el.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.dataset.color = e.color;
  ghost.setAttribute("aria-hidden", "true");
  ghost.innerHTML = `<span class="dg-t">${e.allDay ? "" : `<b>${fmtTime(e.start)}</b> `}${esc(titleOf(e))}</span><span class="dg-to"></span>`;
  ghost.style.width = `${Math.max(140, Math.min(260, r.width))}px`;
  document.body.append(ghost);
  drag = { mode: "day", el, id, date, from, to: from, e, x, y, dx: Math.min(x - r.left, 40), dy: y - r.top, ghost, moved: false, lit: [] };
  el.classList.add("lifted");
  document.documentElement.classList.add("cal-dragging");
  placeGhost(x, y);
  lightDay(from);
  if (navigator.vibrate) navigator.vibrate(12);
  sfx("lift");
}
function placeGhost(x, y) {
  const g = drag.ghost;
  const left = Math.max(4, Math.min(innerWidth - g.offsetWidth - 4, x - drag.dx));
  const top = Math.max(4, Math.min(innerHeight - g.offsetHeight - 4, y - drag.dy));
  g.style.transform = `translate(${left}px, ${top}px)`;
}
// (the day it'll land on lights up, and the lifted card says which day: "→ Tue 28 Oct")
function lightDay(d) {
  for (const el of drag.lit) el.classList.remove("drop-target");
  drag.lit = d ? [...view.querySelectorAll(`.cell[data-date="${d}"], .col[data-date="${d}"], .tg-day[data-goto="${d}"]`)] : [];
  for (const el of drag.lit) el.classList.add("drop-target");
  if (drag.ghost) {
    drag.ghost.querySelector(".dg-to").textContent = !d ? "Drop on a day" : d === drag.from ? "Stays here" : `→ ${dayLabel(d)}`;
    drag.ghost.classList.toggle("nowhere", !d);
  }
}
function moveDrag(x, y) {
  if (!drag) return;
  if (drag.mode === "day") {
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
    drag.moved = true;
    placeGhost(x, y);
    const to = dayAt(x, y);
    if (to === drag.to) return;
    drag.to = to;
    lightDay(to);
    if (to) sfx("nudge");
    return;
  }
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
  // (its time chip says where it's going as it moves, and the day it's going to lights up)
  const [t0, t1] = drag.el.querySelectorAll(".ev-time > span");
  if (t0 && t1) {
    t0.textContent = fmtTime(drag.resize ? drag.start : addMinutes(drag.start, dMin + dDay * 1440));
    t1.textContent = `–${fmtTime(addMinutes(drag.end, dMin + (drag.resize ? 0 : dDay * 1440)))}`;
  }
  if (prefs.view === "week" && drag.col) {
    const cols = [...view.querySelectorAll(".col[data-date]")];
    const to = cols[cols.indexOf(drag.col) + dDay];
    for (const c of cols) c.classList.toggle("drop-target", c === to && dDay !== 0);
  }
}
// Put down (or put back: Escape, the window losing focus, the browser taking the touch over)
function clearDrag(d) {
  document.documentElement.classList.remove("cal-dragging");
  for (const el of view.querySelectorAll(".drop-target")) el.classList.remove("drop-target");
  if (d.mode === "day") {
    d.ghost.remove();
    d.el.classList.remove("lifted");
  } else d.el.classList.remove("dragging");
}
function cancelDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  clearDrag(d);
  settle();
  if (d.mode === "time" && d.moved) render(); // (its place and time chip as they were)
}
function endDrag(touch = false) {
  if (!drag) return;
  const d = drag;
  drag = null;
  clearDrag(d);
  settle();
  // (held still and let go, by touch: the right-click menu for that card, js/menu.js)
  if (!d.moved) {
    if (d.mode === "time") d.el.style.transform = "";
    if (touch) view.dispatchEvent(new CustomEvent("cal:menu", { detail: { target: d.el, x: d.x, y: d.y } }));
    else if (d.mode === "time") openExisting(d.el.dataset.type, d.el.dataset.id, d.el.dataset.date);
    return;
  }
  if (d.mode === "day") {
    const it = data.get(d.id);
    if (!it || !d.to || d.to === d.from) return;
    sfx("place");
    const days = dayNumber(d.to) - dayNumber(d.from);
    changeOccurrence(it, d.date, d.e.start, { start: addMinutes(d.e.start, days * 1440), end: addMinutes(d.e.end, days * 1440) }, `Moved to ${dayLabel(addDays(d.e.start.slice(0, 10), days))}`);
    return;
  }
  sfx("place");
  if (!d.dMin && !d.dDay) return void (d.el.style.transform = "");
  const it = data.get(d.el.dataset.id);
  if (!it) return render();
  const start = d.resize ? d.start : addMinutes(d.start, d.dMin + d.dDay * 1440);
  const end = d.resize ? addMinutes(d.end, d.dMin) : addMinutes(d.end, d.dMin + d.dDay * 1440);
  if (end <= start) return render();
  changeOccurrence(it, d.el.dataset.date, d.start, { start, end }, "Moved");
}
// Bookings and Nova Agent's plan: a little shake, and why (once each time it's tried)
let refused = false; // (and the click that ends that try doesn't open it)
function cantMove(el) {
  refused = true;
  el.classList.remove("nope");
  void el.offsetWidth;
  el.classList.add("nope");
  setTimeout(() => el.classList.remove("nope"), 450);
  toast(el.dataset.type === "booking" ? "Bookings can't be moved here: they come from the studio's bookings." : "Nova Agent's plan can't be moved here: change it in Quests.");
}
let press = null;
const pick = (p) => (p.ro ? cantMove(p.el) : p.day ? startDayDrag(p.el, p.x, p.y) : startDrag(p.el, p.x, p.y, p.resize));
view.addEventListener("pointerdown", (e) => {
  if (e.button > 0 || drag) return;
  // (a card on the hours, a card in a month's day, a card in the week's all-day strip)
  const el = e.target.closest(".ev[data-id], .cell[data-date] .di[data-id], .allday .pill[data-id]");
  if (!el || el.dataset.type === "day") return;
  const ro = el.classList.contains("ro");
  const day = !el.matches(".ev");
  // (Day view's one day: an all-day card has nowhere else to go)
  if (day && !ro && el.closest(".allday") && prefs.view !== "week") return;
  const resize = !day && !!e.target.closest("[data-grip]");
  if (e.pointerType === "mouse") press = { el, x: e.clientX, y: e.clientY, resize, day, ro, mouse: true };
  // Touch: hold for a moment to pick it up (so scrolling still works); a booking's hold is the menu's
  else if (!ro) press = { el, x: e.clientX, y: e.clientY, resize, day, timer: setTimeout(() => press && (pick(press), (press = null)), 350) };
});
addEventListener("pointermove", (e) => {
  if (drag) return moveDrag(e.clientX, e.clientY);
  if (press && press.mouse && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
    const p = press;
    press = null;
    pick(p);
    if (drag) moveDrag(e.clientX, e.clientY);
  } else if (press && !press.mouse && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) {
    clearTimeout(press.timer);
    press = null;
  }
});
addEventListener("pointerup", (e) => {
  if (press) clearTimeout(press.timer);
  press = null;
  if (refused) (refused = false), settle();
  endDrag(e.pointerType !== "mouse");
});
addEventListener("pointercancel", () => {
  if (press) clearTimeout(press.timer);
  press = null;
  cancelDrag();
});
addEventListener("blur", () => {
  press = null;
  cancelDrag();
});
// Escape puts it back where it was
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !drag) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  cancelDrag();
}, true);
// While something's picked up by touch, the page doesn't scroll
document.addEventListener("touchmove", (e) => {
  if (drag) {
    e.preventDefault();
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  }
}, { passive: false });
document.addEventListener("touchend", () => drag && endDrag(true));

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

// The "Google Meet link" tick and, once Google made one, the link
function fillMeet(it) {
  $("f-meet").checked = Boolean(it && it.meet);
  const link = $("f-meet-link");
  const url = it && /^https:\/\/meet\.google\.com\/[\w-]{3,60}$/.test(it.meetUrl || "") ? it.meetUrl : "";
  link.hidden = !url;
  if (url) link.href = url;
}

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
  fillMeet(null);
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
    fillMeet(it);
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
  $("readonly").textContent = "A booking from the studio's bookings. It's read-only here.";
  // Its Google Calendar event, where it can be looked at in full
  if (/^https:\/\//.test(String(b.link || ""))) {
    const open = document.createElement("a");
    Object.assign(open, { href: b.link, target: "_blank", rel: "noopener", textContent: "Open in Google Calendar" });
    $("readonly").append(" ", open);
  }
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
    // Google Meet: Google makes the link when the calendar syncs (it then shows here)
    meet: $("f-meet").checked,
    ...($("f-meet").checked && editing.item?.meetUrl ? { meetUrl: editing.item.meetUrl } : {}),
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

$("delete").addEventListener("click", () => {
  if (!editing || !editing.item) return;
  const it = editing.item;
  const date = editing.date;
  closeSheet();
  void removeCard(it, date);
});
// Delete a note card or day card (a repeating one asks which), with Undo (also the right-click menu's)
async function removeCard(it, date) {
  const before = { ...it };
  if (it.kind === "event" && it.repeat) {
    const which = await askWhich("Delete which?");
    if (!which) return false;
    if (which === "one") data.save({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
    else if (which === "following" && date !== it.start.slice(0, 10)) data.save(endSeriesBefore(it, date));
    else data.remove(it.id);
  } else data.remove(it.id);
  sfx("off");
  toast(it.kind === "day" ? "Day card deleted" : "Note card deleted", () => data.save(before));
  render();
  return true;
}
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
  // (a booking from Google Calendar comes with no id, and a tap on it, or the right-click menu's Open, found
  // nothing to open, 25 Oct 2026: it gets one from what it is, the same each time it's loaded)
  bookings = (await data.bookings()).map((b) => (b && (b.id == null || b.id === "") ? { ...b, id: `gb-${b.start}-${hash32(JSON.stringify([b.session, b.name, b.end]))}` } : b));
  render();
}
// The right-click menu's quick changes (25 Oct 2026, the user: "can right click bring up a useful menu"): a card
// moved a day or a week on, copied to the same day or another, given another colour. Each says what it did, with
// Undo, and a repeating one asks which times, as the editor does.
function shiftCard(it, date, days) {
  const e = occurrenceOf(it.id, date);
  if (!e || it.kind === "day") return;
  return changeOccurrence(it, date, e.start, { start: addMinutes(e.start, days * 1440), end: addMinutes(e.end, days * 1440) }, `Moved to ${dayLabel(addDays(e.start.slice(0, 10), days))}`);
}
function copyCard(it, date, toDate = date, time = "") {
  const e = occurrenceOf(it.id, date);
  const from = e ? e.start : it.start;
  const start = `${toDate}T${it.allDay ? from.slice(11, 16) : time || from.slice(11, 16)}`;
  // (a new card of its own: not part of the series, and Google makes its own Meet link for it)
  const { id, created, updated, base, meetUrl, exdates, ...rest } = it;
  const same = toDate === date && !time;
  const copy = data.save({ ...rest, kind: "event", title: same ? `${it.title || "(No title)"} (copy)` : it.title, start, end: addMinutes(start, minutesBetween(from, e ? e.end : it.end)), repeat: null, exdates: [] });
  sfx("done");
  toast(same ? "Duplicated" : `Copied to ${dayLabel(toDate)}${time ? ` at ${time}` : ""}`, () => data.remove(copy.id));
  render();
  return copy;
}
function recolour(it, date, color) {
  const e = occurrenceOf(it.id, date);
  if (!e || (it.color || "violet") === color) return;
  return changeOccurrence(it, date, e.start, { color }, "Colour changed");
}
// For the right-click menu (js/menu.js): what's on a day, and the ways to add, open and delete cards
window.NovaCalendar = {
  items: () => data.items(),
  get: (id) => data.get(id),
  onChange: (fn) => data.onChange(fn),
  dayCardOn,
  isAgent,
  titleOf,
  dayLabel,
  today,
  addDays,
  describeRepeat,
  presetLabel: (id) => presets().get(id).label,
  entriesOn: (d) => onDay(entries(d, d), d),
  // (when a repeating note card next comes round, within a year and a bit, or null)
  nextDate: (it) => (occurrences(it, today(), addDays(today(), 400))[0] || {}).date || null,
  openNew,
  openExisting,
  removeCard,
  openDay(d) { cursor = d; setView("day"); },
  goToday() { cursor = today(); render(); },
  get view() { return prefs.view; },
  // (and its quick changes, above; whether a card is being dragged)
  colours: COLORS,
  occurrence: occurrenceOf,
  moveBy: shiftCard,
  duplicate: copyCard,
  recolour,
  toast,
  get dragging() { return !!drag; },
};
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
// (and the ones that come later, the moon's and sky's italic)
document.fonts?.addEventListener?.("loadingdone", () => prefs.view === "month" && fitMonth());
// (the list's pages and the week's hours are measured too: once the fonts are in, again)
document.fonts?.ready.then(() => prefs.view !== "month" && !drag && render());
document.fonts?.addEventListener?.("loadingdone", () => prefs.view !== "month" && !drag && $("sheet").hidden && render());
