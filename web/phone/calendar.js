// Nova Phone: Calendar. The same calendar as the computer version (web/calendar/), made for the phone:
//   Day (one day: its sentences, moon, special days, day cards, cards, free times and the time now), Week (seven
//   days, each with its cards), Month (the month with each day's card titles in words, "This month" above it and
//   the chosen day under it) and List (60 days from any date, Earlier and Later, and a search a year either way).
//   What shows: note cards, day cards, the moon and special days, Nova Agent's plan and bookings, each switchable
//   (kept on this phone). A card opens on its own screen with its artwork; note cards and day cards are added,
//   changed, moved (the computer's drag becomes taps: 15 minutes earlier or later, longer, shorter, another day),
//   duplicated and deleted here, each with Undo, a repeating one "just this one, this and the ones after, or every
//   one", as on the computer. A copy is kept on the phone: it opens straight away and works offline, changes made
//   offline waiting in a queue (the same words as the computer's status line) and going when it's back online.
//   Its rules are the computer's own (lib/recur.js, lib/edits.js, lib/quickadd.js, lib/sky.js, lib/presets.js,
//   lib/themes.js; the painter lib/cosmos.js loads when a picture is first needed).
import { occurrences, addDays, weekday, addMinutes, minutesBetween, cleanRepeat, endSeriesBefore, describeRepeat } from "./lib/recur.js";
import { stamped, queued, whichTimes, ruleChanged } from "./lib/edits.js";
import { parseQuick } from "./lib/quickadd.js";
import "./lib/sky.js";
import "./lib/themes.js";
import "./lib/presets.js";

const N = window.NovaPhone;
const { esc, icon, row, list, field, toggle, empty, toast, choose, busy, today, localStamp } = N;
const NT = window.NT;
const SKY = NT.sky, THEMES = NT.themes, PRESETS = NT.presets;
const API = "/app/api/calendar/items";
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The note cards' colours: the computer's nine (an older card's magenta or indigo shows as the nearest of them)
const COLORS = ["violet", "rose", "blue", "teal", "green", "amber", "orange", "red", "grey"];
const NEAREST = { magenta: "rose", indigo: "violet", lilac: "violet", gold: "amber" };
const REMINDERS = [[0, "At start"], [10, "10 min"], [30, "30 min"], [60, "1 hour"], [1440, "1 day"]];
const SUBJECTS = ["planet", "galaxy", "nebula", "binary", "comet", "blackhole", "constellation", "eclipse", "supernova", "orbit", "aurora", "crescent"];
const isAgent = (id) => /^(quest|block|mile|music)-/.test(String(id || ""));
const pad = (n) => String(n).padStart(2, "0");
const enc = encodeURIComponent;
const mondayOf = (d) => addDays(d, -((weekday(d) + 6) % 7));
const yearOf = (d) => (d.slice(0, 4) !== today().slice(0, 4) ? ` ${d.slice(0, 4)}` : "");
const dayName = (d) => `${WD[weekday(d)]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${yearOf(d)}`;
const dayLabel = (d) => `${WD[weekday(d)].slice(0, 3)} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}`;
const shortDate = (d) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}${yearOf(d)}`;
const time = (s) => s.slice(11, 16);
const hm = (s) => (s.endsWith("T24:00") ? "midnight" : time(s));
const nowStamp = () => localStamp(new Date());
const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fromFeed = (s) => (/^\d{8}T\d{6}Z$/.test(s || "") ? localStamp(new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`)) : null);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
function nextHalfHour() {
  const n = nowStamp();
  const mins = Number(n.slice(11, 13)) * 60 + Number(n.slice(14, 16));
  const next = Math.min(23 * 60, Math.ceil((mins + 1) / 30) * 30);
  return `${pad(Math.floor(next / 60))}:${pad(next % 60)}`;
}
// (a steady number from a string, FNV-1a: a note card without saved art gets the same picture everywhere)
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const LAYERS_KEY = "nova-phone/calendar-show";
const LAYERS = { events: true, days: true, sky: true, quests: true, bookings: true };
const layers = (() => { try { return { ...LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}") }; } catch (e) { return { ...LAYERS }; } })();

// ---- The cards: a copy on this phone, brought up to date from Nova Bot; changes wait in a queue until they've gone ----
const CACHE = "nova-phone/calendar-v1";
const state = { items: new Map(), rev: 0, queue: [], online: true, signedIn: true, loaded: false, cached: false };
try {
  const c = JSON.parse(localStorage.getItem(CACHE) || "null");
  if (c && Array.isArray(c.items)) {
    state.items = new Map(c.items.map((i) => [i.id, i]));
    state.rev = Number(c.rev) || 0;
    state.queue = Array.isArray(c.queue) ? c.queue : [];
    state.cached = true;
  }
} catch (e) {}
function writeCache() {
  try { localStorage.setItem(CACHE, JSON.stringify({ rev: state.rev, items: [...state.items.values()], queue: state.queue })); } catch (e) {}
}
const adopt = (cur) => { if (!cur) return; if (cur.deleted) state.items.delete(cur.id); else state.items.set(cur.id, cur); };
// (as the computer's data.js: 401 is signed out, any other 4xx turned away for good, no answer is offline)
async function send(method, path, body) {
  let res;
  try {
    res = await fetch(path, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw Object.assign(new Error("You're offline"), { offline: true }); }
  if (res.status === 401) throw Object.assign(new Error("Sign in first"), { signIn: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status})`), { status: res.status });
  return data;
}
let flushing = null;
function flush() {
  if (flushing) return flushing;
  let changed = false;
  flushing = (async () => {
    while (state.queue.length) {
      const op = state.queue[0];
      try {
        const r = op.op === "put" ? await send("PUT", `${API}/${enc(op.item.id)}`, op.item) : await send("DELETE", `${API}/${enc(op.id)}?updated=${enc(op.updated)}`);
        state.online = true;
        // (another device's later change: it's kept, shown, and said)
        if (r && r.ok === false && r.current) { adopt(r.current); changed = true; toast(`“${r.current.title || "An item"}” was changed on another device: showing that.`); }
        state.queue.shift();
        writeCache();
      } catch (err) {
        if (err.signIn) { state.signedIn = false; break; }
        if (err.status >= 400 && err.status < 500) {
          // (turned away for good: dropped, said why, and the server's copy fetched again in full)
          state.queue.shift();
          if (op.op === "put" && !op.item.base) state.items.delete(op.item.id);
          state.rev = 0;
          writeCache();
          changed = true;
          toast(`Not saved: ${err.message}`, true);
          continue;
        }
        state.online = false;
        break;
      }
    }
  })().finally(() => { flushing = null; status(); if (changed) redraw(); });
  return flushing;
}
let syncing = null, syncedAt = 0;
// Brings the copy up to date (what's waiting goes first). Resolves to how many cards changed.
function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    await flush();
    let changed = 0;
    try {
      if (state.queue.length && !state.online) throw Object.assign(new Error("You're offline"), { offline: true });
      const r = await send("GET", `${API}?since=${state.rev}`);
      state.online = true;
      state.signedIn = true;
      // (a card changed here and not sent yet stays as it is here)
      const waiting = new Set(state.queue.map((q) => (q.op === "put" ? q.item.id : q.id)));
      for (const it of r.items || []) {
        if (waiting.has(it.id)) continue;
        const had = state.items.get(it.id);
        if (it.deleted ? had : JSON.stringify(had) !== JSON.stringify(it)) changed++;
        adopt(it);
      }
      state.rev = Math.max(state.rev, Number(r.rev) || 0);
      state.loaded = true;
      syncedAt = Date.now();
      writeCache();
    } catch (err) {
      if (err.signIn) { state.signedIn = false; throw err; }
      state.online = false;
      if (!state.loaded && !state.cached) throw Object.assign(err, { offline: true });
    } finally { status(); }
    return changed;
  })().finally(() => (syncing = null));
  return syncing;
}
// Save a note card or day card (new or changed): kept here at once, sent when it can be
function save(item) {
  const { out, sent } = stamped(item, (id) => state.items.get(id), new Date().toISOString(), uid);
  state.items.set(out.id, out);
  state.queue = queued(state.queue, { op: "put", item: sent });
  writeCache();
  status();
  void flush();
  return out;
}
function remove(id) {
  const it = state.items.get(id);
  state.items.delete(id);
  state.queue = queued(state.queue, { op: "del", id, updated: new Date().toISOString() });
  writeCache();
  status();
  void flush();
  return it;
}
// Studio bookings (read-only), every 5 minutes at most
let bookings = [], bookingsAt = 0, bookingsLoading = null;
function loadBookings(force = false) {
  if (!force && bookingsAt && Date.now() - bookingsAt < 5 * 60000) return Promise.resolve(false);
  return (bookingsLoading ||= N.api("/app/api/calendar").then((b) => {
    const next = Array.isArray(b && b.bookings) ? b.bookings : [];
    const changed = JSON.stringify(next) !== JSON.stringify(bookings);
    bookings = next;
    bookingsAt = Date.now();
    return changed;
  }, (e) => { if (e.signIn) throw e; bookingsAt = Date.now(); return false; }).finally(() => (bookingsLoading = null)));
}
// Ready to draw: from the copy on this phone at once (brought up to date behind it), or, on a first visit, fetched
async function load(force = false) {
  void N.css("calendar.css");
  startPoll();
  if (!state.signedIn) throw Object.assign(new Error("Sign in first"), { signIn: true });
  const stale = force || Date.now() - syncedAt > 20000;
  if (state.loaded || state.cached) {
    if (stale) sync().then((n) => n && redraw(), (e) => { if (e.signIn) redraw(); });
    const b = loadBookings();
    if (!bookingsAt) await b.catch(() => {}); else b.then((c) => c && redraw(), () => {});
    return;
  }
  await Promise.all([sync(), loadBookings()]);
}

// The status line: the computer's words
function statusText() {
  const n = state.queue.length;
  if (!state.online) return n ? `Offline: ${plural(n, "change")} will save when you're back online.` : "Offline: showing the last copy on this device.";
  return n ? `Saving ${plural(n, "change")}…` : "";
}
function status() {
  const t = statusText();
  for (const el of document.querySelectorAll("[data-cal-status]")) { el.textContent = t; el.hidden = !t; }
}
const statusHtml = () => { const t = statusText(); return `<p class="cal-status" data-cal-status role="status"${t ? "" : " hidden"}>${esc(t)}</p>`; };

// ---- Kept up to date: every 30 s while the Calendar or Today is in sight, on coming back, online again, signed in ----
const placeId = () => window.NovaPhone.hash().split("/")[0] || "today";
const here = () => ["calendar", "today"].includes(placeId());
function editing() {
  const sheet = document.getElementById("sheet");
  if (sheet && sheet.open) return true;
  const page = document.getElementById("page");
  if (page && page.querySelector("form.dirty, input:focus, textarea:focus, select:focus")) return true;
  const [id, what] = window.NovaPhone.hash().split("/");
  return id === "calendar" && ["new", "newday", "edit", "dup"].includes(what);
}
let drawnAt = 0;
function redraw() { if (here() && !editing()) N.show(); }
let poll = 0;
function startPoll() { if (!poll) poll = setInterval(tick, 30000); }
function tick() {
  if (!here() && !state.queue.length) { clearInterval(poll); poll = 0; return; }
  if (document.hidden) return;
  sync().then((n) => {
    // (and once a minute where today is in sight: the time now and "Next: … in N minutes" move on)
    if (n || (here() && Date.now() - drawnAt > 55000 && document.querySelector("#page [data-cal-today]"))) redraw();
  }, () => {});
  loadBookings().then((c) => c && redraw(), () => {});
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && (here() || state.queue.length) && Date.now() - syncedAt > 30000) sync().then((n) => n && redraw(), () => {}); });
addEventListener("online", () => sync().then((n) => n && redraw(), () => {}));
try { new BroadcastChannel("nova-portal").onmessage = () => setTimeout(() => { state.signedIn = true; sync().then(() => redraw(), () => {}); }, 400); } catch (e) {}

// ---- What's on: everything between two dates ----
function entries(from, to) {
  const out = [];
  for (const it of state.items.values()) {
    if (it.kind === "day") {
      if (!layers.days || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "")) continue;
      const as = { start: `${it.date}T00:00`, end: `${it.date}T23:59`, repeat: it.repeat === "yearly" ? { freq: "yearly" } : null };
      for (const o of occurrences(as, from, to)) out.push({ type: "day", item: it, date: o.date, start: o.start, end: o.end, allDay: true, ro: false, color: "gold" });
      continue;
    }
    const agent = isAgent(it.id);
    if (agent ? !layers.quests : !layers.events) continue;
    for (const o of occurrences(it, from, to)) out.push({ type: "event", item: it, date: o.date, start: o.start, end: o.end, allDay: !!it.allDay, ro: agent, color: agent ? "indigo" : NEAREST[it.color] || it.color || "violet" });
  }
  if (layers.bookings) bookings.forEach((b, i) => {
    const start = fromFeed(b.start), end = fromFeed(b.end) || start;
    if (!start || start.slice(0, 10) > to || end.slice(0, 10) < from) return;
    out.push({ type: "booking", item: b, key: `booking-${b.id != null ? b.id : i}`, date: start.slice(0, 10), start, end, allDay: false, ro: true, color: "gold" });
  });
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}
const onDay = (l, d) => l.filter((e) => e.start.slice(0, 10) <= d && e.end.slice(0, 10) >= d && !(e.end.slice(0, 10) === d && e.end.slice(11) === "00:00" && e.start.slice(0, 10) < d));
const titleOf = (e) => (e.type === "booking" ? [e.item.session, e.item.name].filter(Boolean).join(" · ") || "Booking" : e.item.title || (e.type === "day" ? PRESETS.get(e.item.preset).label : "(No title)"));
const keyOf = (e) => (e.type === "booking" ? e.key : e.item.id);
const typeWord = (e) => (e.type === "booking" ? "Studio booking" : e.type === "day" ? "Day card" : e.ro ? "Nova Agent's plan" : "Note card");
// (a part of a card on one day: from midnight, or to midnight, when it runs over)
const clip = (e, d, edge) => (edge === "start" ? (e.start.slice(0, 10) < d ? `${d}T00:00` : e.start) : e.end.slice(0, 10) > d ? `${d}T24:00` : e.end);
function dayCardOn(date) {
  for (const it of state.items.values()) if (it.kind === "day" && (it.date === date || (it.repeat === "yearly" && String(it.date).slice(5) === date.slice(5) && it.date <= date))) return it;
  return null;
}
// Seasonal and cosmic days (Easter, Bonfire Night, solstices, meteor showers…), unless a day card already is that day
function skyDays(d) {
  if (!layers.sky) return [];
  const card = dayCardOn(d);
  return SKY.seasonalOn(d).map((x, i) => ({ ...x, i })).filter((x) => !(card && (card.preset === x.preset || card.title === x.title)));
}
const moonLine = (m) => (m.principal ? `${m.principal}${m.fullName ? ` · ${m.fullName}` : ""}` : `${m.name} · ${Math.round(m.illumination * 100)}% lit`);
const moonMark = (d) => { if (!layers.sky) return ""; const m = SKY.moon(d); return m.principal ? `<span class="cal-moonmark${m.fullName ? " full" : ""}" role="img" aria-label="${esc(m.fullName || m.principal)}">${SKY.moonSVG(m.fraction, 14)}</span>` : ""; };

// What a card is about, from its words (the computer's symbols, here as a word): "Recording", "Meeting"…
const SYMBOLS = [
  [/birthday|bday/i, "cake"], [/\bdate\b|love|anniversary|valentine/i, "heart"],
  [/record|recording|vocal|\bsing(s|ing|er)?\b|\bmic\b|podcast|voice|studio/i, "mic"], [/mix|master|beat|song|track|music|ep\b|album|release|gig|concert|rehears/i, "note"],
  [/lesson|class|course|study|learn|tutor|school|exam/i, "cap"], [/listen|playlist|headphone|audio/i, "headphones"],
  [/meet|meeting|call with|team|crew|band|session with|catch.?up/i, "people"], [/gym|workout|run|walk|yoga|train|exercise|steps/i, "dumbbell"],
  [/lunch|dinner|breakfast|eat|food|cook|meal/i, "plate"], [/flight|fly|travel|trip|holiday|airport/i, "plane"],
  [/phone|call\b|ring/i, "phone"], [/write|lyrics|note|journal|draft|edit\b|script/i, "pen"], [/video|film|reel|shoot|camera|youtube|tiktok/i, "film"],
  [/read|book/i, "book"], [/email|mail|reply|send/i, "mail"],
];
const SYMBOL_WORDS = { booking: "Studio booking", quest: "Quest", card: "Note card", mic: "Recording", note: "Music", cap: "Lesson", headphones: "Listening", people: "Meeting", dumbbell: "Exercise", plate: "Food", plane: "Travel", phone: "Call", pen: "Writing", film: "Video", book: "Reading", mail: "Email", cake: "Birthday", heart: "Someone special" };
// (each kind's colour, as the computer's cosmos.css --kind-*: a day's tint is its cards' kinds, by how many of each)
const KIND_RGB = { card: [190, 24, 113], mic: [200, 30, 90], note: [109, 40, 217], cap: [170, 110, 20], headphones: [8, 120, 160], people: [29, 78, 216], dumbbell: [13, 128, 128], plate: [205, 70, 60], plane: [8, 120, 160], phone: [13, 128, 128], pen: [134, 25, 143], film: [190, 18, 60], book: [170, 110, 20], mail: [71, 85, 140], cake: [190, 24, 93], heart: [200, 30, 90], booking: [170, 110, 20], quest: [91, 33, 182] };
function symbolOf(e) {
  if (e.type === "booking") return "booking";
  const text = `${titleOf(e)} ${(e.item && (e.item.notes || e.item.location)) || ""}`;
  for (const [re, s] of SYMBOLS) if (re.test(text)) return s;
  return e.ro ? "quest" : "card";
}
const kindWord = (e) => (e.type === "booking" ? "Booking" : e.type === "day" ? PRESETS.get(e.item.preset).label : SYMBOL_WORDS[symbolOf(e)] || "Note card");
function tintOf(l) {
  const es = l.filter((e) => e.type !== "day");
  if (!es.length) return "";
  const sum = [0, 0, 0];
  for (const e of es) KIND_RGB[symbolOf(e)].forEach((v, i) => (sum[i] += v));
  return sum.map((v) => Math.round(v / es.length)).join(", ");
}
// What a card is for, in a line: its notes' first line
const notesLine = (e) => String(e.item.notes || e.item.body || e.item.info || "").replace(/<[^>]*>/g, " ").split(/\n/)[0].trim().slice(0, 90);
function subLine(e) {
  const it = e.item;
  return [
    kindWord(e) !== titleOf(e) ? kindWord(e) : "",
    e.type === "event" && it.repeat ? describeRepeat(it.repeat) : "",
    e.ro && e.type === "event" ? "Nova Agent's plan" : "",
    e.type === "booking" ? it.phone || it.email || "" : it.location || "",
    e.type === "event" && !e.ro && it.author ? `by ${it.author}` : "",
  ].filter(Boolean).join(" · ");
}

// ---- Themes and artwork ----
// A day card can wear its own theme; "App theme" is Nova Phone's own. The painter takes the computer's twin of it.
const TWINS = { cosmic: "novacane", ember: "solar", ocean: "pulsar", gold: "eclipse" };
function appTheme() {
  const id = window.NovaThemes && window.NovaThemes.current ? window.NovaThemes.current() : "";
  if (TWINS[id]) return TWINS[id];
  return THEMES.list().some((x) => x.id === id) ? id : "novacane";
}
const dayTheme = (day) => (!day.theme || day.theme === "app" ? appTheme() : day.theme);
const noteTheme = (date) => { const day = date && dayCardOn(date); return day ? dayTheme(day) : appTheme(); };
const wearAttr = (theme) => (theme && theme !== "app" ? ` data-wear="${esc(theme)}"` : "");
const VARS = { void: "--void", deep: "--deep", panel: "--panel", panel2: "--panel-2", text: "--text", muted: "--muted", accent: "--accent", accent2: "--accent-2", accent3: "--accent-3", hi: "--hi", soft: "--soft", gold: "--gold", lilac: "--lilac", onAccent: "--on-accent" };
const rgbOf = (hex) => { const n = parseInt(String(hex).slice(1), 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };
function wear(el, id) {
  const t = THEMES.get(id);
  for (const [k, v] of Object.entries(VARS)) { el.style.setProperty(v, t[k]); el.style.setProperty(`${v}-rgb`, rgbOf(t[k])); }
  el.style.setProperty("--bright", t.soft);
  el.style.setProperty("--accent-mid", t.accent2);
}
// The painter (lib/cosmos.js) comes when a picture is first needed; painted pictures are kept, so drawing again is instant
let cosmosLoad = null;
const needCosmos = () => (cosmosLoad ||= import("./lib/cosmos.js").then(() => NT.cosmos));
const artKept = new Map();
function noteArt(it, date, w, h, type) {
  const art = it.art || { seed: hash32(String(it.id || "")), subject: "auto" };
  return NT.cosmos.render({ seed: art.seed >>> 0, subject: art.subject || "auto", theme: noteTheme(date), w, h, type });
}
function dayArt(day, w, h, type) {
  const c = NT.cosmos;
  return c.render({ seed: c.hash(`${day.id}|${day.artSalt || ""}`), subject: c.aestheticSubject(day.aesthetic || "nebula"), theme: dayTheme(day), w, h, type });
}
function artKey(el) {
  const it = state.items.get(el.dataset.artNote || el.dataset.artDay);
  if (!it) return "";
  return `${el.dataset.artNote ? "n" : "d"}|${it.id}|${JSON.stringify(it.art || "")}|${it.artSalt || ""}|${it.aesthetic || ""}|${el.dataset.artNote ? noteTheme(el.dataset.date) : dayTheme(it)}|${el.dataset.w}x${el.dataset.h}`;
}
function paintOne(el) {
  el.dataset.painted = "1";
  const it = state.items.get(el.dataset.artNote || el.dataset.artDay);
  if (!it) return;
  const key = artKey(el);
  let url = artKept.get(key);
  if (!url) {
    url = el.dataset.artNote ? noteArt(it, el.dataset.date, Number(el.dataset.w), Number(el.dataset.h)) : dayArt(it, Number(el.dataset.w), Number(el.dataset.h));
    artKept.set(key, url);
    if (artKept.size > 200) artKept.delete(artKept.keys().next().value);
  }
  el.style.setProperty("--art", `url("${url}")`);
  el.classList.add("cal-painted");
}
// (one picture at a time, each in its own moment, only for what's on the page: nothing ever freezes)
let painting = 0;
function paintSoon(delay = 30) {
  clearTimeout(painting);
  painting = setTimeout(async () => {
    const page = document.getElementById("page");
    if (!page || document.hidden || !page.querySelector("[data-art-note]:not([data-painted]), [data-art-day]:not([data-painted])")) return;
    await needCosmos().catch(() => null);
    if (!NT.cosmos) return;
    const next = () => {
      const el = page.querySelector("[data-art-note]:not([data-painted]), [data-art-day]:not([data-painted])");
      if (!el) return;
      paintOne(el);
      painting = setTimeout(next, 16);
    };
    next();
  }, delay);
}
// After a screen is drawn (off screen): its themes, tints and any pictures already painted
function decorate(root) {
  for (const el of root.querySelectorAll("[data-wear]")) wear(el, el.dataset.wear);
  for (const el of root.querySelectorAll("[data-tint]")) el.style.setProperty("--tint", el.dataset.tint);
  for (const el of root.querySelectorAll("[data-art-note], [data-art-day]")) {
    const url = artKept.get(artKey(el));
    if (url) { el.style.setProperty("--art", `url("${url}")`); el.classList.add("cal-painted"); el.dataset.painted = "1"; }
  }
  if (root.querySelector(".dc-title")) needFonts();
  paintSoon();
}
// The day cards' title styles' fonts (Celestial, Constellation), only once one is shown
let fontsAsked = false;
function needFonts() {
  if (fontsAsked) return;
  fontsAsked = true;
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,600&family=Source+Code+Pro:wght@600&display=swap" }));
}
// A picture saved big (a note card 1920×1080, a day card's header 1920×640), as a PNG file
function savePicture(url, name) {
  const bin = atob(url.split(",")[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  download(new Blob([bytes], { type: "image/png" }), `${name}.png`);
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const fileName = (t, fallback) => String(t || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";

// ---- Undo: a word with an Undo button, for 6 seconds ----
let undoEl = null, undoTimer = 0;
function undoToast(text, undo) {
  if (!undoEl) {
    undoEl = document.createElement("div");
    undoEl.className = "cal-undo";
    undoEl.setAttribute("role", "status");
    undoEl.hidden = true;
    document.body.append(undoEl);
    undoEl.addEventListener("click", (e) => {
      if (!e.target.closest("[data-undo]") || !undoEl.undo) return;
      const fn = undoEl.undo;
      undoEl.undo = null;
      undoEl.hidden = true;
      fn();
      N.show();
      toast("Undone");
    });
  }
  undoEl.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" class="cal-undo-btn" data-undo>Undo</button>' : ""}`;
  undoEl.undo = undo || null;
  // (just above the tiles, wherever they end up)
  const tabs = document.getElementById("tabs");
  const gap = tabs ? Math.max(12, innerHeight - tabs.getBoundingClientRect().top + 10) : 24;
  undoEl.style.setProperty("--cal-undo-b", `${Math.round(gap)}px`);
  undoEl.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoEl.hidden = true; undoEl.undo = null; }, undo ? 6000 : 2600);
}

// ---- The screens ----
const VIEW_KEY = "nova-phone/calendar-view";
const VIEWS = ["day", "week", "month", "list"];
let view = (() => { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS.includes(v) ? v : "week"; } catch (e) { return "week"; } })();
let cursor = today();
let showOpen = false;
N.section({
  id: "calendar",
  name: "Calendar",
  tile: "calendar",
  async draw(box, path, ui) {
    await N.css("calendar.css");
    let [what, a, b, c, d] = path;
    if (what === "ahead") what = "list";
    await load(!what || VIEWS.includes(what));
    drawnAt = Date.now();
    if (what === "card") return drawCard(box, a, b, ui);
    if (what === "new") return drawForm(box, null, valid(a) || cursor, ui, { time: /^\d\d:\d\d$/.test(b || "") ? b : "" });
    if (what === "newday") return drawDayForm(box, null, valid(a) || cursor, ui, { special: b === "special" ? SKY.seasonalOn(valid(a) || cursor)[Number(c)] : null });
    if (what === "edit" || what === "dup") {
      const it = state.items.get(a);
      if (!it) return gone(box, ui, b);
      const opts = what === "dup" ? { copy: it } : {};
      return it.kind === "day" ? drawDayForm(box, what === "dup" ? null : it, valid(b) || it.date, ui, opts) : drawForm(box, what === "dup" ? null : it, valid(b) || it.start.slice(0, 10), ui, opts);
    }
    if (what === "notes" || what === "days") return drawCardList(box, what, ui);
    if (what === "backup") return drawBackup(box, ui);
    if (VIEWS.includes(what)) { view = what; try { localStorage.setItem(VIEW_KEY, view); } catch (e) {} }
    if (valid(a)) cursor = a;
    ui.action({ icon: "plus", label: "New note card", href: `#calendar/new/${cursor}` });
    const tabs = `<div class="seg" role="tablist" aria-label="View">${[["day", "Day"], ["week", "Week"], ["month", "Month"], ["list", "List"]].map(([v, l]) => `<a role="tab" class="seg-a" href="#calendar/${v}/${cursor}" aria-selected="${v === view}">${l}</a>`).join("")}</div>`;
    const body = view === "day" ? dayView() : view === "month" ? monthView() : view === "list" ? listView() : weekView();
    box.innerHTML = `${tabs}${statusHtml()}<div class="cal-view" data-cal-view>${body}</div>${footerHtml()}`;
    decorate(box);
  },
});
// (to a screen in place of this one: drawn again when it's this very address)
function goTo(hash) { if (location.hash === hash) N.show(); else location.replace(hash); }
const valid = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "");
function gone(box, ui, date) {
  ui.back(`#calendar/${view}/${valid(date) || cursor}`);
  box.innerHTML = empty({ icon: "calendar", title: "That card isn't there any more", action: `<a class="btn" href="#calendar/${view}/${valid(date) || today()}">Back to the calendar</a>` });
}

// The bar over each view: before, the title (a tap picks any date), after, and Today when it's not in sight
function stepper(prev, label, next, withToday) {
  return `<div class="cal-stepper${withToday ? " with-today" : ""}" data-cal-stepper>
    <a class="icon-btn" href="${prev}" data-step="prev" aria-label="Before">${icon("back")}</a>
    <label class="cal-jump"><span class="cal-jump-t">${esc(label)}</span><span class="cal-caret" aria-hidden="true">▾</span><input type="date" class="cal-jump-in" value="${cursor}" aria-label="Jump to a date" data-cal-jump></label>
    <a class="icon-btn" href="${next}" data-step="next" aria-label="After">${icon("next")}</a>
    ${withToday ? `<a class="chip cal-today" href="#calendar/${view}/${today()}">Today</a>` : ""}
  </div>`;
}
function footerHtml() {
  let notes = 0, days = 0;
  for (const it of state.items.values()) { if (it.kind === "day") days++; else if (!isAgent(it.id)) notes++; }
  const chips = [["events", "Note cards"], ["days", "Day cards"], ["sky", "Moon and special days"], ["quests", "Nova Agent's plan"], ["bookings", "Studio bookings"]];
  return `<details class="card show-what" data-cal-show${showOpen ? " open" : ""}><summary>What to show</summary><div class="chips">${chips.map(([k, l]) => `<button type="button" class="chip" data-layer="${k}" aria-pressed="${!!layers[k]}">${l}</button>`).join("")}</div></details>
    ${list([
      row({ href: "#calendar/notes", icon: "calendar", title: "Note card list", text: `${plural(notes, "note card")}: coming up and earlier` }),
      row({ href: "#calendar/days", icon: "star", title: "Day card list", text: `${plural(days, "day card")}: birthdays, holidays, release days…` }),
      row({ href: "#calendar/backup", icon: "book", title: "Backup", text: "Download a backup, or bring one back" }),
    ])}`;
}

// A card as a row: its times (on a note card's own picture), its title, what it is, its notes' first line
function entryRow(e, { onNow = false, day } = {}) {
  const d = day || e.date;
  const it = e.item;
  const art = e.type === "event" && !e.ro;
  const times = e.allDay ? "All<br>day" : `${hm(clip(e, d, "start"))}<br><small>${hm(clip(e, d, "end"))}</small>`;
  const notes = e.type === "booking" ? "" : notesLine(e);
  paintSoon(60);
  return row({
    href: `#calendar/card/${enc(keyOf(e))}/${e.date}`, color: e.color,
    lead: `<span class="cal-lead${art ? " art" : ""}"${art ? ` data-art-note="${esc(it.id)}" data-date="${e.date}" data-w="160" data-h="160"` : ""}>${times}</span>`,
    title: titleOf(e), text: subLine(e),
    html: notes && notes !== it.location ? `<span class="cal-what">${esc(notes)}</span>` : "",
    end: onNow ? '<span class="pill ok">On now</span>' : "",
  });
}
// A day card as a banner: its kind, "every year", its title in its own style and colours, its first line, its header art
function bannerHtml(e, big = false) {
  const it = e.item, p = PRESETS.get(it.preset);
  const tag = big ? "div" : "a";
  return `<${tag} class="cal-banner${big ? " big" : ""} aes-${esc(it.aesthetic || "nebula")}"${big ? "" : ` href="#calendar/card/${enc(it.id)}/${e.date}"`}${wearAttr(it.theme)} data-art-day="${esc(it.id)}" data-w="${big ? 960 : 720}" data-h="${big ? 320 : 240}"><span class="cal-banner-kicker">${esc(p.label)}${it.repeat === "yearly" ? " · every year" : ""}</span><b class="dc-title">${esc(titleOf(e))}</b>${it.info ? `<small>${esc(String(it.info).split("\n")[0])}</small>` : ""}</${tag}>`;
}

// The chosen day in a few plain sentences (the computer's daySummary): how it starts and ends, when it's free,
// and today what's on now and what's next, how soon. Also for Today (N.cal.summary).
function summarize(d, all) {
  const now = nowStamp();
  const timed = all.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start));
  const allDay = all.filter((e) => e.allDay);
  const past = d < today();
  const res = { date: d, empty: !all.length, onNow: null, next: null, gaps: [], allDay: allDay.map(titleOf), sentences: [] };
  const say = (html) => res.sentences.push({ html, text: html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[k]) });
  if (!all.length) { say(past ? "Nothing was on." : d === today() ? "Nothing on today: the day is yours." : "Nothing on yet: a free day."); return res; }
  const b = (e) => `<b>${esc(titleOf(e))}</b>`;
  if (timed.length) {
    const first = timed[0];
    const last = timed.reduce((x, y) => (clip(y, d, "end") > clip(x, d, "end") ? y : x));
    say(timed.length === 1 ? `${b(first)}, ${hm(clip(first, d, "start"))} to ${hm(clip(first, d, "end"))}.` : `${past ? "Started" : "Starts"} with ${b(first)} at ${hm(clip(first, d, "start"))}; ${past ? "finished" : "finishes"} with ${b(last)} at ${hm(clip(last, d, "end"))}.`);
    let end = clip(first, d, "end");
    for (const e of timed.slice(1)) {
      const s0 = clip(e, d, "start");
      if (s0 > end && minutesBetween(end, s0) >= 30) res.gaps.push({ from: hm(end), to: hm(s0), start: end, end: s0 });
      if (clip(e, d, "end") > end) end = clip(e, d, "end");
    }
    if (timed.length > 1) say(res.gaps.length ? `Free ${and(res.gaps.map((g) => `${g.from}–${g.to}`))}.` : "Back to back, no gaps.");
  }
  if (allDay.length) say(`All day: ${esc(and(allDay.map(titleOf)))}.`);
  if (d === today() && timed.length) {
    const on = timed.find((e) => e.start <= now && clip(e, d, "end") > now);
    const next = timed.find((e) => e.start > now);
    if (on) { res.onNow = { title: titleOf(on), until: hm(clip(on, d, "end")), entry: on }; say(`On now: ${b(on)}, until ${res.onNow.until}.`); }
    if (next) {
      const m = minutesBetween(now, next.start);
      const soon = m < 60 ? `in ${plural(m, "minute")}` : m < 120 ? `in an hour${m % 60 >= 10 ? ` and ${m % 60} minutes` : ""}` : `in about ${Math.round(m / 60)} hours`;
      res.next = { title: titleOf(next), at: time(next.start), minutes: m, soon, entry: next };
      say(`Next: ${b(next)} ${soon}.`);
    } else if (!on) say("That's everything for today.");
  }
  return res;
}
// A day's cards, with the time now between them, "On now" on the one that is, and the free times to add a card in
function dayRows(d, rest) {
  if (!rest.length) return `<a class="add-line" href="#calendar/new/${d}">${icon("plus")} Add a note card</a>`;
  const isToday = d === today(), now = nowStamp(), out = [];
  let nowPlaced = !isToday, lastEnd = "";
  const nowRow = () => `<li class="cal-now" aria-label="The time now"><span>Now · ${time(now)}</span></li>`;
  for (const e of rest) {
    if (!e.allDay) {
      const s = clip(e, d, "start"), en = clip(e, d, "end");
      if (lastEnd && d >= today() && s > lastEnd) {
        let from = lastEnd;
        if (isToday && from < now) { const q = Math.ceil((Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))) / 15) * 15; from = `${d}T${pad(Math.floor(q / 60))}:${pad(q % 60)}`; }
        if (from < s && minutesBetween(from, s) >= 30) {
          if (!nowPlaced && from > now) { out.push(nowRow()); nowPlaced = true; }
          out.push(row({ href: `#calendar/new/${d}/${time(from)}`, cls: "cal-gap", lead: "Free", title: `${hm(from)}–${hm(s)}`, text: `Tap to add a note card at ${hm(from)}` }));
        }
      }
      if (!nowPlaced && s > now) { out.push(nowRow()); nowPlaced = true; }
      if (!lastEnd || en > lastEnd) lastEnd = en;
    }
    out.push(entryRow(e, { day: d, onNow: isToday && !e.allDay && e.start <= now && clip(e, d, "end") > now }));
  }
  if (!nowPlaced && rest.some((e) => !e.allDay)) out.push(nowRow());
  return list(out);
}
// One day in full: Day view, and under the month
function planHtml(d) {
  const all = onDay(entries(d, d), d);
  const days = all.filter((e) => e.type === "day");
  const rest = all.filter((e) => e.type !== "day");
  const card = days[0] && days[0].item;
  let moon = "";
  if (layers.sky) { const m = SKY.moon(d); moon = `<p class="cal-moon${m.fullName ? " full" : ""}">${SKY.moonSVG(m.fraction, 22)}<span>${esc(moonLine(m))}</span></p>`; }
  const specials = skyDays(d).map((x) => `<div class="cal-sky-row"><span>${esc(x.title)}</span><a class="btn cal-sm" href="#calendar/newday/${d}/special/${x.i}">Make it a day card</a></div>`).join("");
  return `<section class="cal-plan"${d === today() ? " data-cal-today" : ""} aria-label="${esc(dayName(d))}">
    <div class="cal-dhead"><p class="kicker">${d === today() ? "Today" : WD[weekday(d)]}</p><h2 class="cal-dname">${esc(dayLabel(d))}${yearOf(d)}</h2>${moon}</div>
    ${days.map(bannerHtml).join("")}${specials}
    <div class="cal-sum">${summarize(d, all).sentences.map((s) => `<p>${s.html}</p>`).join("")}</div>
    ${dayRows(d, rest)}
    <div class="btns two"><a class="btn" href="#calendar/new/${d}">${icon("plus")} Note card</a>${card ? `<a class="btn" href="#calendar/edit/${enc(card.id)}/${d}">${icon("edit")} Day card</a>` : `<a class="btn" href="#calendar/newday/${d}">${icon("plus")} Day card</a>`}</div>
    <button type="button" class="btn wide quiet" data-cal-dayacts="${d}">More for this day</button>
  </section>`;
}
function dayView() {
  const d = cursor;
  return `${stepper(`#calendar/day/${addDays(d, -1)}`, d === today() ? "Today" : dayLabel(d), `#calendar/day/${addDays(d, 1)}`, d !== today())}${planHtml(d)}`;
}
function weekView() {
  const from = mondayOf(cursor), to = addDays(from, 6), t = today();
  const all = entries(from, to);
  const ma = MONTHS[Number(from.slice(5, 7)) - 1].slice(0, 3), mb = MONTHS[Number(to.slice(5, 7)) - 1].slice(0, 3);
  const label = from <= t && t <= to ? "This week" : ma === mb ? `${Number(from.slice(8))}–${Number(to.slice(8))} ${mb}${yearOf(to)}` : `${Number(from.slice(8))} ${ma} – ${Number(to.slice(8))} ${mb}`;
  const blocks = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i);
    const here_ = onDay(all, d);
    const days = here_.filter((e) => e.type === "day"), rest = here_.filter((e) => e.type !== "day");
    const tint = tintOf(rest);
    const chips = [
      ...days.map((e) => `<a class="cal-dchip" href="#calendar/card/${enc(e.item.id)}/${d}"${wearAttr(e.item.theme)}>${esc(titleOf(e))}</a>`),
      ...skyDays(d).map((x) => `<a class="cal-skychip" href="#calendar/day/${d}">${esc(x.title)}</a>`),
      ...(layers.sky && SKY.moon(d).fullName ? [`<a class="cal-skychip" href="#calendar/day/${d}">${esc(SKY.moon(d).fullName)}</a>`] : []),
    ];
    return `<section class="cal-wday${d === t ? " now" : ""}"${d === t ? " data-cal-today" : ""}${tint ? ` data-tint="${tint}"` : ""}>
      <a class="cal-whead" href="#calendar/day/${d}"><span>${d === t ? "Today · " : ""}${esc(dayName(d))}</span>${moonMark(d)}</a>
      ${chips.length ? `<div class="cal-chiprow">${chips.join("")}</div>` : ""}
      ${dayRows(d, rest)}</section>`;
  }).join("");
  return `${stepper(`#calendar/week/${addDays(from, -7)}`, label, `#calendar/week/${addDays(from, 7)}`, !(from <= t && t <= to))}<div class="cal-week">${blocks}</div>`;
}
function monthView() {
  const first = `${cursor.slice(0, 7)}-01`;
  const next = `${addDays(first, 32).slice(0, 7)}-01`;
  const last = addDays(next, -1);
  const prev = `${addDays(first, -1).slice(0, 7)}-01`;
  const start = mondayOf(first), t = today();
  const weeks = Math.ceil((minutesBetween(`${start}T00:00`, `${last}T00:00`) / 1440 + 1) / 7);
  const all = entries(start, addDays(start, weeks * 7 - 1));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const on = onDay(all, d);
    const days = on.filter((e) => e.type === "day"), rest = on.filter((e) => e.type !== "day");
    const m = layers.sky ? SKY.moon(d) : null;
    const sky = days.length ? "" : (skyDays(d)[0] || {}).title || (m && m.fullName) || "";
    const room = 3 - (days.length || sky ? 1 : 0);
    const shown = rest.length > room ? rest.slice(0, room - 1) : rest;
    const tint = tintOf(rest);
    cells.push(`<a class="cal-mday${d.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${d === t ? " today" : ""}${d === cursor ? " picked" : ""}" href="#calendar/month/${d}"${tint ? ` data-tint="${tint}"` : ""} aria-label="${esc(dayLabel(d))}${on.length ? `: ${esc(on.map(titleOf).join(", "))}` : ""}">
      <span class="cal-mnum">${Number(d.slice(8))}${m && m.principal ? `<span class="cal-moonmark${m.fullName ? " full" : ""}">${SKY.moonSVG(m.fraction, 11)}</span>` : ""}</span>
      ${days.length ? `<span class="cal-mcard"${wearAttr(days[0].item.theme)}>${esc(titleOf(days[0]))}</span>` : sky ? `<span class="cal-msky">${esc(sky)}</span>` : ""}
      ${shown.map((e) => `<span class="cal-mt" data-c="${esc(e.color)}">${esc(titleOf(e).replace(/^quest:\s*/i, ""))}</span>`).join("")}${shown.length < rest.length ? '<span class="cal-mmore">More</span>' : ""}</a>`);
  }
  return `${stepper(`#calendar/month/${prev}`, `${MONTHS[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`, `#calendar/month/${next}`, t.slice(0, 7) !== first.slice(0, 7))}
    ${stripHtml(first, last)}
    <div class="cal-month"><div class="cal-mhead" aria-hidden="true">${["M", "T", "W", "T", "F", "S", "S"].map((x) => `<span>${x}</span>`).join("")}</div><div class="cal-mgrid">${cells.join("")}</div></div>
    ${planHtml(cursor)}`;
}
// This month at a glance: day cards, named full moons and special days, each a tap away
function stripHtml(first, last) {
  const out = [];
  for (const e of entries(first, last)) if (e.type === "day") out.push({ d: e.date, html: `<a class="cal-strip-item day" href="#calendar/month/${e.date}"${wearAttr(e.item.theme)}><b>${WD[weekday(e.date)].slice(0, 3)} ${Number(e.date.slice(8))}</b> ${esc(titleOf(e))}</a>` });
  if (layers.sky) for (let d = first; d <= last; d = addDays(d, 1)) {
    const m = SKY.moon(d);
    if (m.fullName) out.push({ d, html: `<a class="cal-strip-item moon" href="#calendar/month/${d}"><b>${WD[weekday(d)].slice(0, 3)} ${Number(d.slice(8))}</b> ${esc(m.fullName)}</a>` });
    for (const x of skyDays(d)) out.push({ d, html: `<a class="cal-strip-item sky" href="#calendar/month/${d}"><b>${WD[weekday(d)].slice(0, 3)} ${Number(d.slice(8))}</b> ${esc(x.title)}</a>` });
  }
  if (!out.length) return "";
  return `<div class="cal-strip" aria-label="This month">${out.sort((a, b) => a.d.localeCompare(b.d)).map((x) => x.html).join("")}</div>`;
}
// The list: 60 days from any date (Earlier and Later), or a search a year back and a year ahead
let query = "";
function listView() {
  const prev = `#calendar/list/${addDays(cursor, -60)}`, next = `#calendar/list/${addDays(cursor, 60)}`;
  return `${stepper(prev, `From ${shortDate(cursor)}`, next, cursor !== today())}
    <form class="search" role="search" data-cal-search><label class="field"><span class="sr">Search note cards and day cards</span><input class="input" type="search" name="q" value="${esc(query)}" placeholder="Search note cards and day cards" autocomplete="off" enterkeyhint="search"></label></form>
    <div class="cal-results" data-cal-results>${listBody()}</div>`;
}
function listBody() {
  if (query) {
    const q = query.toLowerCase(), t = today();
    const hits = entries(addDays(t, -365), addDays(t, 365)).filter((e) => [titleOf(e), e.item.location, e.item.body, e.item.info, e.item.name].some((v) => v && String(v).toLowerCase().includes(q)));
    // (each card once: its next time, or its last if it's all in the past)
    const seen = new Map();
    for (const e of hits) {
      const k = `${e.type}:${keyOf(e)}`, had = seen.get(k);
      if (!had || (had.date < t && e.date >= t) || (e.date >= t && e.date < had.date)) seen.set(k, e);
    }
    const found = [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
    if (!found.length) return empty({ icon: "search", title: `Nothing matches “${query}”`, text: "A year back and a year ahead were searched." });
    return `<p class="muted small cal-found">${found.length} found</p>${groups(found.map((e) => [e.date, e]))}`;
  }
  const end = addDays(cursor, 59);
  const rows = entries(cursor, end).map((e) => [e.date < cursor ? cursor : e.date, e]).sort((a, b) => a[0].localeCompare(b[0]));
  const nav = `<div class="btns two"><a class="btn" href="#calendar/list/${addDays(cursor, -60)}">${icon("back")} Earlier</a><a class="btn" href="#calendar/list/${addDays(cursor, 60)}">Later ${icon("next")}</a></div>`;
  if (!rows.length) return `${empty({ icon: "calendar", title: `Nothing from ${dayLabel(cursor)} to ${dayLabel(end)}`, action: `<a class="btn" href="#calendar/new/${cursor}">${icon("plus")} Add a note card</a>` })}${nav}`;
  return `${groups(rows)}${nav}`;
}
function groups(rows) {
  const by = new Map();
  for (const [d, e] of rows) { if (!by.has(d)) by.set(d, []); by.get(d).push(e); }
  return [...by.entries()].map(([d, es]) => `<h3 class="h${d === today() ? " now" : ""}">${d === today() ? "Today · " : ""}${esc(dayName(d))}</h3>${list(es.map((e) => entryRow(e, { day: d })))}`).join("");
}

// ---- Taps on the views ----
document.addEventListener("click", async (e) => {
  const l = e.target.closest("[data-layer]");
  if (l) { layers[l.dataset.layer] = !layers[l.dataset.layer]; try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch (err) {} N.show(); return; }
  const acts = e.target.closest("[data-cal-dayacts]");
  if (acts) return dayActions(acts.dataset.calDayacts);
  const jump = e.target.closest("[data-cal-jump]");
  if (jump) { try { jump.showPicker(); } catch (err) {} }
});
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-cal-jump]") && valid(e.target.value)) location.hash = `#calendar/${view}/${e.target.value}`;
});
document.addEventListener("toggle", (e) => { if (e.target.matches && e.target.matches("[data-cal-show]")) showOpen = e.target.open; }, true);
// The search, live as it's typed (only the results change, so the box keeps its place)
let searchTimer = 0;
document.addEventListener("input", (e) => {
  if (!e.target.closest("[data-cal-search]")) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = e.target.value.trim();
    const box = document.querySelector("[data-cal-results]");
    if (box) { box.innerHTML = listBody(); decorate(box); }
  }, 160);
});
document.addEventListener("submit", (e) => {
  if (!e.target.matches("[data-cal-search]")) return;
  e.preventDefault();
  e.target.elements.q.blur();
});
// A swipe left or right moves on or back, as on the computer
let swipe = null;
document.addEventListener("touchstart", (e) => {
  const v = e.target.closest("[data-cal-view]");
  swipe = v && e.touches.length === 1 && !e.target.closest("input, textarea, select") ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), v } : null;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!swipe) return;
  const s = swipe;
  swipe = null;
  const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - s.t < 600) {
    const a = s.v.querySelector(`[data-step="${dx < 0 ? "next" : "prev"}"]`);
    if (a) location.hash = a.getAttribute("href");
  }
}, { passive: true });

// What else there is to do with a day (the computer's right-click menu, as a sheet)
async function dayActions(d) {
  const on = onDay(entries(d, d), d);
  const notes = on.filter((e) => e.type === "event" && !e.ro);
  const card = dayCardOn(d);
  const options = [];
  if (notes.length) options.push(["remove-note", notes.length === 1 ? `Remove note card: ${titleOf(notes[0])}` : "Remove a note card", "danger"]);
  if (card) options.push(["edit-day", "Change the day card"], ["remove-day", `Remove day card: ${card.title || PRESETS.get(card.preset).label}`, "danger"]);
  if (view !== "day") options.push(["day-view", "Open in Day view"]);
  if (d !== today()) options.push(["today", "Go to today"]);
  options.push(["list-note", "Note card list"], ["list-day", "Day card list"]);
  const a = await choose({ title: dayName(d), options });
  if (!a) return;
  if (a === "remove-note") {
    let pick = notes[0];
    if (notes.length > 1) {
      const id = await choose({ title: "Remove which note card?", options: notes.map((n, i) => [String(i), `Delete “${titleOf(n)}”`, "danger"]) });
      if (id === null) return;
      pick = notes[Number(id)];
    }
    if (await removeCard(pick.item, pick.date)) N.show();
  } else if (a === "edit-day") location.hash = `#calendar/edit/${enc(card.id)}/${d}`;
  else if (a === "remove-day") { if (await removeCard(card, d)) N.show(); }
  else if (a === "day-view") location.hash = `#calendar/day/${d}`;
  else if (a === "today") location.hash = `#calendar/${view}/${today()}`;
  else if (a === "list-note") location.hash = "#calendar/notes";
  else if (a === "list-day") location.hash = "#calendar/days";
}

// ---- One card ----
function findEntry(key, date) {
  return entries(addDays(date, -1), addDays(date, 1)).find((e) => keyOf(e) === key && e.date === date) || entries(date, date).find((e) => keyOf(e) === key) || null;
}
const reminderWords = (rs) => rs.map((m) => (REMINDERS.find(([x]) => x === m) || [m, `${m} min`])[1]).join(", ");
const meetOk = (u) => /^https:\/\/meet\.google\.com\/[\w-]{3,60}$/.test(u || "");
function drawCard(box, key, date, ui) {
  date = valid(date) || today();
  ui.back(`#calendar/${view}/${date}`);
  // (a card not on that day any more, a repeating one changed: its own date)
  let e = findEntry(key, date);
  if (!e && state.items.get(key)) { const it = state.items.get(key); const d0 = it.kind === "day" ? it.date : String(it.start).slice(0, 10); if (valid(d0)) e = findEntry(key, d0); }
  if (!e) return gone(box, ui, date);
  ui.title(typeWord(e));
  const it = e.item, mine = !e.ro && e.type !== "booking";
  const when = e.allDay ? `${dayName(e.date)} · all day` : `${dayName(e.start.slice(0, 10))} · ${time(e.start)} – ${e.end.slice(0, 10) !== e.start.slice(0, 10) ? `${dayLabel(e.end.slice(0, 10))} ` : ""}${time(e.end)}`;
  const facts = [];
  if (e.type === "booking") {
    for (const [k, v] of [["When", it.when], ["Session", it.session], ["Name", it.name], ["Email", it.email], ["Phone", it.phone], ["Price", it.price]]) if (v) facts.push([k, esc(v)]);
    for (const x of Array.isArray(it.extra) ? it.extra : []) if (Array.isArray(x) && x[1]) facts.push([esc(x[0]), esc(x[1])]);
  } else {
    facts.push(["What it is", esc(kindWord(e))]);
    if (it.location) facts.push(["Where", esc(it.location)]);
    if (e.type === "event" && it.repeat) facts.push(["Repeats", esc(describeRepeat(it.repeat))]);
    if (e.type === "day" && it.repeat === "yearly") facts.push(["Repeats", "Every year"]);
    if ((it.reminders || []).length) facts.push(["Reminders", `${esc(reminderWords(it.reminders))}${(it.phones || []).length ? ` · to ${plural(it.phones.length, "chosen phone")}` : " · to the owner's phones"}`]);
    if (it.meet) facts.push(["Google Meet", meetOk(it.meetUrl) ? esc(it.meetUrl.replace(/^https:\/\//, "")) : "A link is made when the calendar syncs with Google."]);
    if (it.author) facts.push(["By", esc(it.author)]);
  }
  const words = e.type === "booking" ? "" : it.body || it.info || "";
  const contact = e.type === "booking" ? [it.phone && `<a class="btn" href="tel:${esc(it.phone)}">${icon("phone")} Call</a>`, it.email && `<a class="btn" href="mailto:${esc(it.email)}">${icon("mail")} Email</a>`].filter(Boolean) : [];
  const hero = e.type === "day" ? bannerHtml(e, true)
    : mine ? `<div class="cal-hero" data-art-note="${esc(it.id)}" data-date="${e.date}" data-w="640" data-h="360" role="img" aria-label="This note card's artwork"></div>` : "";
  box.innerHTML = `${statusHtml()}${hero}<div class="card edge-card" data-c="${esc(e.color)}"><p class="kicker">${esc(typeWord(e))}</p><h2 class="card-title">${esc(titleOf(e))}</h2><p class="muted">${esc(when)}</p>
      ${facts.length ? `<div class="facts">${facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${v}</b></div>`).join("")}</div>` : ""}
      ${words ? `<p class="pre cal-words">${esc(words)}</p>` : ""}</div>
    ${contact.length ? `<div class="btns two">${contact.join("")}</div>` : ""}
    ${it.meet && meetOk(it.meetUrl) ? `<a class="btn wide" href="${esc(it.meetUrl)}" target="_blank" rel="noopener">${icon("play")} Join the call</a>` : ""}
    ${mine ? `<div class="btns two"><a class="btn main" href="#calendar/edit/${enc(it.id)}/${e.date}">${icon("edit")} Change</a>${e.type === "event" ? `<button type="button" class="btn" data-cal-move>${icon("clock")} Move</button>` : ""}</div>
      <div class="btns two"><a class="btn" href="#calendar/dup/${enc(it.id)}/${e.date}">${icon("plus")} Duplicate</a><button type="button" class="btn danger" data-cal-del>${icon("trash")} Delete</button></div>` : ""}
    ${e.type === "booking" ? '<p class="muted small">A booking from the studio\'s diary. Change it in Acuity.</p>'
      : e.ro ? `<p class="muted small">Part of Nova Agent's plan. Change it in Quests, or ask Nova Agent.</p><div class="btns two"><a class="btn" href="#quests">${icon("quests")} Quests</a><a class="btn" href="#agent">${icon("agent")} Ask Nova Agent</a></div>` : ""}`;
  decorate(box);
  const del = box.querySelector("[data-cal-del]");
  if (del) del.addEventListener("click", async () => { if (await removeCard(it, e.date)) goTo(`#calendar/${view}/${e.date}`); });
  const mv = box.querySelector("[data-cal-move]");
  if (mv) mv.addEventListener("click", () => moveSheet(it, e));
}
// Moving a note card (the computer drags it): 15 minutes earlier or later, longer or shorter, or to another day
async function moveSheet(it, e) {
  const len = minutesBetween(e.start, e.end);
  const v = await N.form(`<h2 class="sheet-title">Move “${esc(titleOf(e))}”</h2><p class="sheet-text">${esc(e.allDay ? `${dayName(e.date)} · all day` : `${dayLabel(e.date)} · ${time(e.start)} – ${time(e.end)}`)}</p>
    ${e.allDay ? "" : `<div class="btns two"><button type="button" class="btn" data-v="earlier">15 min earlier</button><button type="button" class="btn" data-v="later">15 min later</button></div>
    <div class="btns two"><button type="button" class="btn" data-v="shorter"${len <= 15 ? " disabled" : ""}>15 min shorter</button><button type="button" class="btn" data-v="longer">15 min longer</button></div>`}
    ${field({ label: "Another day", name: "day", type: "date", value: e.date })}
    <button type="button" class="btn wide main" data-v="day">Move to that day</button>
    <button type="button" class="btn wide quiet" data-v="">Cancel</button>`, (el, done) => {
    el.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => done(b.dataset.v === "day" ? { day: el.querySelector("[name=day]").value } : b.dataset.v || null)));
  });
  if (!v) return;
  let start = e.start, end = e.end;
  if (v === "earlier") { start = addMinutes(start, -15); end = addMinutes(end, -15); }
  else if (v === "later") { start = addMinutes(start, 15); end = addMinutes(end, 15); }
  else if (v === "shorter") end = addMinutes(end, -15);
  else if (v === "longer") end = addMinutes(end, 15);
  else if (v.day && valid(v.day)) { const by = minutesBetween(`${e.date}T00:00`, `${v.day}T00:00`); start = addMinutes(start, by); end = addMinutes(end, by); }
  else return;
  if (start === e.start && end === e.end) return;
  const saved = await changeOccurrence(it, e.date, e.start, { start, end }, "Moved");
  if (saved) goTo(`#calendar/card/${enc(saved.id)}/${start.slice(0, 10)}`);
  else N.show();
}

// A repeating card: which times does it change?
const which = (verb) => choose({ title: `${verb} which?`, options: [["one", "Just this one"], ["following", "This and the ones after"], ["all", "Every one"]] });
// it: the note card; date: the day this time of it starts; was: its start then; changes: the new fields
async function changeOccurrence(it, date, was, changes, word = "Saved", chosen = null) {
  const before = { ...it };
  if (!it.repeat) { const s = save({ ...it, ...changes }); undoToast(word, () => save(before)); return s; }
  const how = chosen || (await which(word === "Moved" ? "Move" : "Change"));
  if (!how) return null;
  const length = minutesBetween(it.start, it.end);
  if (how === "one") {
    save({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
    const { id, created, ...rest } = it;
    const single = save({ ...rest, kind: "event", start: was, end: addMinutes(was, length), ...changes, repeat: null, exdates: [] });
    undoToast(word, () => { remove(single.id); save(before); });
    return single;
  }
  if (how === "following" && date !== it.start.slice(0, 10)) {
    save(endSeriesBefore(it, date));
    const { id, created, exdates, ...rest } = it;
    const out = { ...rest, kind: "event", start: was, end: addMinutes(was, length), repeat: cleanRepeat(it.repeat), exdates: (it.exdates || []).filter((x) => x > date), ...changes };
    // (the new series has no count of its own: the old one's count was for the old one)
    if (out.repeat) { out.repeat = cleanRepeat(out.repeat); if (out.repeat) delete out.repeat.count; }
    const next = save(out);
    undoToast(word, () => { remove(next.id); save(before); });
    return next;
  }
  // (every one: times move the whole series by the same amount; other fields change everywhere)
  const out = { ...it, ...changes };
  if (changes.start) {
    out.start = addMinutes(it.start, minutesBetween(was, changes.start));
    out.end = addMinutes(out.start, minutesBetween(changes.start, changes.end || addMinutes(changes.start, length)));
  }
  const s = save(out);
  undoToast(word, () => save(before));
  return s;
}
// Delete a note card or day card (a repeating one asks which), with Undo
async function removeCard(it, date) {
  const before = { ...it };
  if (it.kind === "event" && it.repeat) {
    const how = await which("Delete");
    if (!how) return false;
    if (how === "one") save({ ...it, exdates: [...new Set([...(it.exdates || []), date])] });
    else if (how === "following" && date !== it.start.slice(0, 10)) save(endSeriesBefore(it, date));
    else remove(it.id);
  } else remove(it.id);
  undoToast(it.kind === "day" ? "Day card deleted" : "Note card deleted", () => save(before));
  return true;
}

// ---- A note card to fill in (new, changed or a copy) ----
let phoneList = null;
async function loadPhones() {
  if (phoneList) return phoneList;
  try { const r = await N.api("/app/api/push/phones"); phoneList = (r && r.phones) || []; } catch (e) { if (e.signIn) throw e; phoneList = []; }
  return phoneList;
}
function drawForm(box, it, date, ui, { time: at = "", copy = null } = {}) {
  if (it && (isAgent(it.id) || it.kind !== "event")) return drawCard(box, it.id, date, ui);
  const src = it || copy;
  ui.title(it ? "Change note card" : copy ? "Copy of a note card" : "New note card");
  ui.back(src ? `#calendar/card/${enc(src.id)}/${date}` : `#calendar/${view}/${date}`);
  // (this time of it: for a repeating one, the one tapped)
  let start, end;
  if (src) { const len = minutesBetween(src.start, src.end); start = src.repeat && date ? `${date}${src.start.slice(10)}` : src.start; end = addMinutes(start, len); }
  else { start = `${date}T${at || (date === today() ? nextHalfHour() : "09:00")}`; end = addMinutes(start, 60); }
  const rep = cleanRepeat(src && src.repeat);
  const simple = rep && rep.interval === 1 && !rep.until && !rep.count && (rep.freq !== "weekly" || !rep.byDay || rep.byDay.length <= 1);
  const color = NEAREST[src && src.color] || (src && src.color) || "violet";
  const rem = new Set((src && src.reminders) || []);
  const phones = [...((src && src.phones) || [])];
  const art = it ? (it.art ? { seed: it.art.seed >>> 0, subject: it.art.subject || "auto" } : { seed: hash32(String(it.id)), subject: "auto" }) : { seed: randomSeed(), subject: (copy && copy.art && copy.art.subject) || "auto" };
  const tempId = it ? it.id : uid();
  box.innerHTML = `${statusHtml()}<form class="form" id="cal-form" novalidate>
      ${!it && !copy ? `${field({ label: "Type it", name: "quick", placeholder: "Mix review Friday 2pm 1h", attrs: 'autocomplete="off" enterkeyhint="done"', hint: "A day, a time, a length, “every Monday”, “@ Studio A”: the boxes below fill in as you type." })}<p class="cal-quick-hint" data-quick-hint role="status"></p>` : ""}
      <div class="cal-art-edit" data-art-edit role="img" aria-label="This note card's artwork"><b class="cal-art-title" data-art-title>${esc(copy ? `${copy.title || ""} (copy)` : (it && it.title) || "")}</b></div>
      <div class="two-up cal-art-tools">${field({ label: "Artwork", name: "subject", type: "select", value: art.subject, options: [["auto", "Surprise me"], ...SUBJECTS.map((x) => [x, x === "blackhole" ? "Black hole" : x[0].toUpperCase() + x.slice(1)])] })}<div class="field"><span>Picture</span><div class="cal-art-btns"><button type="button" class="btn" data-art-new>New artwork</button><button type="button" class="btn" data-art-save>Save image</button></div></div></div>
      ${field({ label: "Title", name: "title", value: copy ? `${copy.title || ""} (copy)` : (it && it.title) || "", placeholder: "What's happening", attrs: 'maxlength="120" autocomplete="off"' })}
      ${toggle({ label: "All day", name: "allDay", checked: !!(src && src.allDay) })}
      <div class="two-up">${field({ label: "Starts", name: "sdate", type: "date", value: start.slice(0, 10) })}${field({ label: "at", name: "stime", type: "time", value: time(start), attrs: 'step="300"' })}</div>
      <div class="two-up">${field({ label: "Ends", name: "edate", type: "date", value: end.slice(0, 10) })}${field({ label: "at", name: "etime", type: "time", value: time(end), attrs: 'step="300"' })}</div>
      ${field({ label: "Repeats", name: "repeat", type: "select", value: !rep ? "" : simple ? rep.freq : "custom", options: [["", "Doesn't repeat"], ["daily", "Every day"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"], ["custom", "Custom…"]] })}
      <div class="cal-custom form" data-custom hidden>
        <div class="two-up">${field({ label: "Every", name: "interval", type: "number", value: rep ? rep.interval : 1, attrs: 'min="1" max="99" inputmode="numeric"' })}${field({ label: "Unit", name: "freq", type: "select", value: rep ? rep.freq : "weekly", options: [["daily", "days"], ["weekly", "weeks"], ["monthly", "months"], ["yearly", "years"]] })}</div>
        <fieldset class="field" data-weekdays><legend>On these days</legend><div class="day-picks">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="day-pick"><input type="checkbox" name="byDay" value="${d}"${((rep && rep.byDay) || []).includes(d) ? " checked" : ""}><span>${WD[d].slice(0, 2)}</span></label>`).join("")}</div></fieldset>
        ${field({ label: "Ends", name: "ends", type: "select", value: rep && rep.until ? "until" : rep && rep.count ? "count" : "never", options: [["never", "Never"], ["until", "On a date"], ["count", "After a number of times"]] })}
        <div data-ends-until>${field({ label: "Last date", name: "until", type: "date", value: (rep && rep.until) || "" })}</div>
        <div data-ends-count>${field({ label: "How many times", name: "count", type: "number", value: (rep && rep.count) || 10, attrs: 'min="1" max="1000" inputmode="numeric"' })}</div>
      </div>
      <fieldset class="field"><legend>Remind me</legend><div class="chips">${REMINDERS.map(([m, l]) => `<label class="chip check-chip"><input type="checkbox" name="rem" value="${m}"${rem.has(m) ? " checked" : ""}>${l}</label>`).join("")}</div></fieldset>
      <fieldset class="field" data-phones-row hidden><legend>Send to</legend><div class="chips" data-phones></div></fieldset>
      <fieldset class="field"><legend>Colour</legend><div class="swatch-grid">${COLORS.map((c) => `<label class="swatch" data-c="${c}"><input type="radio" name="color" value="${c}"${c === color ? " checked" : ""}><i></i>${c[0].toUpperCase() + c.slice(1)}</label>`).join("")}</div></fieldset>
      ${field({ label: "Where", name: "location", value: (src && src.location) || "", placeholder: "Optional", attrs: 'maxlength="160"' })}
      ${toggle({ label: "Google Meet link", name: "meet", checked: !!(src && src.meet) })}
      ${it && meetOk(it.meetUrl) ? `<a class="btn wide" href="${esc(it.meetUrl)}" target="_blank" rel="noopener">${icon("play")} Join the call ↗</a>` : `<p class="muted small cal-meet-note" data-meet-note${src && src.meet ? "" : " hidden"}>Google makes the link when the calendar syncs (when Google is connected). It then shows here.</p>`}
      ${field({ label: "Notes", name: "body", type: "textarea", value: (src && src.body) || "", placeholder: "What's it about?", rows: 3, attrs: 'maxlength="5000"' })}
      <p class="form-said" id="cal-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${it ? "Save" : "Add note card"}</button>
      ${it ? `<div class="btns two"><a class="btn" href="#calendar/dup/${enc(it.id)}/${date}">${icon("plus")} Duplicate</a><button type="button" class="btn danger" data-cal-del>${icon("trash")} Delete</button></div>` : ""}
    </form>`;
  decorate(box);
  const f = box.querySelector("#cal-form"), x = f.elements, said = f.querySelector("#cal-said");
  const bad = (t) => { said.textContent = t; said.classList.add("bad"); };
  // The picture: painted when the painter's here, again for a new one, saved big
  const artBox = f.querySelector("[data-art-edit]");
  const paintEdit = () => needCosmos().then(() => {
    const url = noteArt({ id: tempId, art }, x.sdate.value || date, 640, 360);
    artBox.style.setProperty("--art", `url("${url}")`);
    artBox.classList.add("cal-painted");
  }, () => {});
  paintEdit();
  x.subject.addEventListener("change", () => { art.subject = x.subject.value; paintEdit(); });
  f.querySelector("[data-art-new]").addEventListener("click", () => { art.seed = randomSeed(); f.classList.add("dirty"); paintEdit(); });
  f.querySelector("[data-art-save]").addEventListener("click", (ev) => busy(ev.currentTarget, "Painting…", async () => {
    await needCosmos();
    await new Promise((r) => setTimeout(r, 30));
    savePicture(noteArt({ id: tempId, art }, x.sdate.value || date, 1920, 1080, "image/png"), fileName(x.title.value, "note card"));
  }));
  x.title.addEventListener("input", () => (f.querySelector("[data-art-title]").textContent = x.title.value));
  // The times: all day hides them; the start moving takes the end with it, the same length
  const times = () => f.querySelectorAll("[name=stime], [name=etime]").forEach((el) => (el.closest(".field").hidden = x.allDay.checked));
  x.allDay.addEventListener("change", times);
  times();
  const startStamp = () => `${x.sdate.value}T${x.allDay.checked ? "00:00" : x.stime.value || "09:00"}`;
  let lastStart = startStamp();
  const moved = () => {
    const now = startStamp();
    if (lastStart && x.edate.value && valid(x.sdate.value)) {
      const e2 = addMinutes(`${x.edate.value}T${x.etime.value || "10:00"}`, minutesBetween(lastStart, now));
      x.edate.value = e2.slice(0, 10);
      x.etime.value = e2.slice(11, 16);
    }
    lastStart = now;
  };
  x.sdate.addEventListener("change", () => { moved(); paintEdit(); });
  x.stime.addEventListener("change", moved);
  // Repeats: the custom part, its days and how it ends
  const syncRepeat = () => {
    f.querySelector("[data-custom]").hidden = x.repeat.value !== "custom";
    f.querySelector("[data-weekdays]").hidden = x.freq.value !== "weekly";
    f.querySelector("[data-ends-until]").hidden = x.ends.value !== "until";
    f.querySelector("[data-ends-count]").hidden = x.ends.value !== "count";
  };
  [x.repeat, x.freq, x.ends].forEach((el) => el.addEventListener("change", syncRepeat));
  syncRepeat();
  const readRepeat = (st) => {
    const v = x.repeat.value;
    if (!v) return null;
    if (v !== "custom") return cleanRepeat({ freq: v, byDay: v === "weekly" ? [weekday(st.slice(0, 10))] : undefined });
    const days = [...f.querySelectorAll("[name=byDay]:checked")].map((c) => Number(c.value));
    // (a weekly series kept on its own weekday, as it was saved: not a changed rule)
    const own = !days.length || (days.length === 1 && days[0] === weekday(st.slice(0, 10)));
    return cleanRepeat({
      freq: x.freq.value, interval: x.interval.value,
      byDay: x.freq.value === "weekly" ? (own && rep && rep.freq === "weekly" && !rep.byDay ? undefined : days.length ? days : [weekday(st.slice(0, 10))]) : undefined,
      until: x.ends.value === "until" ? x.until.value : undefined,
      count: x.ends.value === "count" ? x.count.value : undefined,
    });
  };
  // Which phones get the reminders: the owner's (the default), or the ones picked (a phone picked before that's gone still shows, to take off)
  const phonesRow = f.querySelector("[data-phones-row]"), phonesBox = f.querySelector("[data-phones]");
  const fillPhones = () => {
    const known = new Set((phoneList || []).map((p) => p.id));
    const all = [...(phoneList || []), ...phones.filter((id) => !known.has(id)).map((id) => ({ id, name: "A phone that's turned off", who: "" }))];
    phonesRow.hidden = !f.querySelector("[name=rem]:checked") || !all.length;
    phonesBox.innerHTML = `<label class="chip check-chip"><input type="checkbox" data-phone=""${phones.length ? "" : " checked"}>Owner's phones</label>${all.map((p) => `<label class="chip check-chip"><input type="checkbox" data-phone="${esc(p.id)}"${phones.includes(p.id) ? " checked" : ""}>${esc(p.name)}${p.who ? ` · ${esc(p.who)}` : ""}</label>`).join("")}`;
  };
  phonesBox.addEventListener("change", (ev) => {
    const id = ev.target.dataset.phone;
    if (id === undefined) return;
    if (!id) phones.length = 0;
    else if (phones.includes(id)) phones.splice(phones.indexOf(id), 1);
    else phones.push(id);
    fillPhones();
  });
  const reminders = () => { fillPhones(); if (f.querySelector("[name=rem]:checked")) loadPhones().then(fillPhones, () => {}); };
  f.querySelectorAll("[name=rem]").forEach((c) => c.addEventListener("change", reminders));
  reminders();
  x.meet.addEventListener("change", () => { const n = f.querySelector("[data-meet-note]"); if (n) n.hidden = !x.meet.checked; });
  const fillWhen = (s, e2, allDay) => {
    x.allDay.checked = !!allDay;
    x.sdate.value = s.slice(0, 10);
    x.stime.value = s.slice(11, 16);
    x.edate.value = e2.slice(0, 10);
    x.etime.value = allDay ? "10:00" : e2.slice(11, 16);
    times();
    lastStart = startStamp();
  };
  // Quick add: the boxes fill in as it's typed
  if (x.quick) {
    const hint = f.querySelector("[data-quick-hint]");
    x.quick.addEventListener("input", () => {
      const r = parseQuick(x.quick.value, today());
      if (!r.found) { hint.textContent = ""; x.title.value = r.title || ""; f.querySelector("[data-art-title]").textContent = x.title.value; return; }
      x.title.value = r.title;
      f.querySelector("[data-art-title]").textContent = r.title;
      fillWhen(r.start, r.end, r.allDay);
      if (r.location) x.location.value = r.location;
      if (r.repeat) {
        x.repeat.value = "custom";
        x.freq.value = r.repeat.freq;
        x.interval.value = 1;
        const days = r.repeat.byDay || (r.repeat.freq === "weekly" ? [weekday(r.date)] : []);
        f.querySelectorAll("[name=byDay]").forEach((c) => (c.checked = days.includes(Number(c.value))));
        x.ends.value = "never";
        syncRepeat();
      }
      hint.textContent = `${dayLabel(r.date)} · ${r.words.join(" · ")}`;
    });
    x.quick.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); f.requestSubmit(); } });
  }
  const delBtn = f.querySelector("[data-cal-del]");
  if (delBtn) delBtn.addEventListener("click", async () => { if (await removeCard(it, date)) { f.classList.remove("dirty"); goTo(`#calendar/${view}/${date}`); } });
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!valid(x.sdate.value)) return bad("Pick a date.");
    const allDay = x.allDay.checked;
    const st = allDay ? `${x.sdate.value}T00:00` : `${x.sdate.value}T${x.stime.value || "09:00"}`;
    let en = allDay ? `${x.edate.value || x.sdate.value}T23:59` : `${x.edate.value || x.sdate.value}T${x.etime.value || "10:00"}`;
    if (en < st) en = allDay ? `${st.slice(0, 10)}T23:59` : addMinutes(st, 60);
    const reminderList = [...f.querySelectorAll("[name=rem]:checked")].map((c) => Number(c.value));
    const fields = {
      kind: "event", title: x.title.value.trim() || "(No title)", start: st, end: en, allDay, location: x.location.value.trim(), body: x.body.value,
      // (Google Meet: Google makes the link when the calendar syncs; it then shows here)
      meet: x.meet.checked, ...(x.meet.checked && it && it.meetUrl ? { meetUrl: it.meetUrl } : {}),
      color: x.color.value || "violet", reminders: reminderList, phones: reminderList.length ? [...phones] : [], repeat: readRepeat(st), art: { seed: art.seed >>> 0, subject: art.subject || "auto" },
    };
    if (!fields.repeat) fields.exdates = [];
    let saved;
    if (!it) {
      saved = save(fields);
      undoToast("Note card added", () => remove(saved.id));
    } else if (it.repeat && ruleChanged(it, fields)) {
      // (a repeating one whose rule was changed: the new rule is for the whole series, no question)
      const before = { ...it };
      const shift = minutesBetween(start, st);
      saved = save({ ...it, ...fields, start: addMinutes(it.start, shift), end: addMinutes(addMinutes(it.start, shift), minutesBetween(st, en)), exdates: fields.repeat ? it.exdates || [] : [] });
      undoToast("Saved", () => save(before));
    } else {
      // (a repeating one: which times? Asked with the form still here, so Cancel loses nothing; only the reminders changed: every time)
      const how = await whichTimes(it, start, fields, () => which("Change"));
      if (it.repeat && !how) return;
      saved = await changeOccurrence(it, date, start, fields, "Saved", how || null);
      if (!saved) return;
    }
    f.classList.remove("dirty");
    goTo(`#calendar/card/${enc(saved.id)}/${saved.repeat ? st.slice(0, 10) : saved.start.slice(0, 10)}`);
  });
}

// ---- A day card: a special day (a birthday, a holiday, a release day) with its own look ----
function drawDayForm(box, it, date, ui, { special = null, copy = null } = {}) {
  const src = it || copy;
  ui.title(it ? "Change day card" : "New day card");
  ui.back(src ? `#calendar/card/${enc(src.id)}/${date}` : `#calendar/${view}/${date}`);
  const start = special ? PRESETS.get(special.preset) : null;
  const picked = {
    preset: start ? start.id : (src && src.preset) || "custom",
    aesthetic: special ? special.aesthetic || start.aesthetic || "nebula" : (src && src.aesthetic) || "nebula",
    theme: special ? special.theme || start.theme || "app" : (src && src.theme) || "app",
    salt: it ? it.artSalt || "" : Math.random().toString(36).slice(2, 10),
  };
  const tempId = it ? it.id : uid();
  const title = special ? special.title : copy ? `${copy.title || ""} (copy)` : (it && it.title) || "";
  const info = special ? start.info || "" : (src && src.info) || "";
  const yearly = special ? !!start.repeat : src ? src.repeat === "yearly" : false;
  const groupsOf = [...new Set(PRESETS.list().map((p) => p.group))];
  const themeOpt = (id, name) => `<label class="cal-theme"><input type="radio" name="theme" value="${id}"${picked.theme === id ? " checked" : ""}><i${wearAttr(id)}></i>${esc(name)}</label>`;
  box.innerHTML = `${statusHtml()}<form class="form" id="day-form" novalidate>
      <div class="cal-banner big cal-banner-edit aes-${esc(picked.aesthetic)}" data-day-head${wearAttr(picked.theme)}><span class="cal-banner-kicker" data-head-kind>${esc(PRESETS.get(picked.preset).label)}</span><b class="dc-title" data-head-title>${esc(title || PRESETS.get(picked.preset).label)}</b></div>
      <div class="btns two"><button type="button" class="btn" data-art-new>New artwork</button><button type="button" class="btn" data-art-save>Save image</button></div>
      <label class="field"><span>Kind of day</span><select class="input" name="preset">${groupsOf.map((g) => `<optgroup label="${esc(g)}">${PRESETS.list().filter((p) => p.group === g).map((p) => `<option value="${p.id}"${p.id === picked.preset ? " selected" : ""}>${esc(p.label)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      ${field({ label: "Title", name: "title", value: title, placeholder: "Birthday, release day, holiday…", attrs: 'maxlength="120" autocomplete="off"' })}
      ${field({ label: "Day", name: "date", type: "date", value: date })}
      ${toggle({ label: "Every year", name: "yearly", checked: yearly })}
      <fieldset class="field"><legend>Title style</legend><div class="cal-aes-grid">${PRESETS.aesthetics().map((a) => `<label class="cal-aes aes-${a.id}"><input type="radio" name="aesthetic" value="${a.id}"${a.id === picked.aesthetic ? " checked" : ""}><b class="dc-title">${esc(a.label)}</b><small>${esc(a.hint)}</small></label>`).join("")}</div></fieldset>
      <fieldset class="field"><legend>Theme</legend><div class="cal-theme-grid">${themeOpt("app", "App theme")}${THEMES.list().map((t) => themeOpt(t.id, t.name)).join("")}</div></fieldset>
      ${field({ label: "Where", name: "location", value: (src && src.location) || "", placeholder: "Optional", attrs: 'maxlength="120"' })}
      ${field({ label: "About it", name: "info", type: "textarea", value: info, placeholder: "About this day", rows: 3, attrs: 'maxlength="5000"' })}
      <p class="form-said" id="day-said" role="status"></p>
      <button class="btn main wide" type="submit">${icon("check")} ${it ? "Save" : "Add day card"}</button>
      ${it ? `<div class="btns two"><a class="btn" href="#calendar/dup/${enc(it.id)}/${date}">${icon("plus")} Duplicate</a><button type="button" class="btn danger" data-cal-del>${icon("trash")} Delete</button></div>` : ""}
    </form>`;
  decorate(box);
  const f = box.querySelector("#day-form"), x = f.elements, said = f.querySelector("#day-said");
  const head = f.querySelector("[data-day-head]");
  const sheetDay = () => ({ id: tempId, artSalt: picked.salt, aesthetic: picked.aesthetic, theme: picked.theme });
  const refresh = () => {
    head.className = `cal-banner big cal-banner-edit aes-${picked.aesthetic}`;
    if (picked.theme === "app") for (const v of Object.values(VARS)) { head.style.removeProperty(v); head.style.removeProperty(`${v}-rgb`); }
    else wear(head, picked.theme);
    f.querySelector("[data-head-kind]").textContent = PRESETS.get(x.preset.value).label;
    f.querySelector("[data-head-title]").textContent = x.title.value || PRESETS.get(x.preset.value).label;
    needCosmos().then(() => { head.style.setProperty("--art", `url("${dayArt(sheetDay(), 720, 240)}")`); head.classList.add("cal-painted"); }, () => {});
  };
  refresh();
  x.title.addEventListener("input", refresh);
  // A kind fills in its title, every year, look, theme and words (all still changeable)
  x.preset.addEventListener("change", () => {
    const p = PRESETS.get(x.preset.value);
    if (!x.title.value && p.title) x.title.value = p.title;
    if (p.repeat !== undefined) x.yearly.checked = !!p.repeat;
    if (p.aesthetic) picked.aesthetic = p.aesthetic;
    if (p.theme) picked.theme = p.theme;
    if (p.info && !x.info.value) x.info.value = p.info;
    f.querySelectorAll("[name=aesthetic]").forEach((r) => (r.checked = r.value === picked.aesthetic));
    f.querySelectorAll("[name=theme]").forEach((r) => (r.checked = r.value === picked.theme));
    refresh();
  });
  f.addEventListener("change", (ev) => {
    if (ev.target.name === "aesthetic") { picked.aesthetic = ev.target.value; refresh(); }
    if (ev.target.name === "theme") { picked.theme = ev.target.value; refresh(); }
  });
  f.querySelector("[data-art-new]").addEventListener("click", () => { picked.salt = Math.random().toString(36).slice(2, 10); f.classList.add("dirty"); refresh(); });
  f.querySelector("[data-art-save]").addEventListener("click", (ev) => busy(ev.currentTarget, "Painting…", async () => {
    await needCosmos();
    await new Promise((r) => setTimeout(r, 30));
    savePicture(dayArt(sheetDay(), 1920, 640, "image/png"), fileName(x.title.value, "day card"));
  }));
  const delBtn = f.querySelector("[data-cal-del]");
  if (delBtn) delBtn.addEventListener("click", async () => { if (await removeCard(it, date)) { f.classList.remove("dirty"); goTo(`#calendar/${view}/${date}`); } });
  f.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const d = x.date.value;
    if (!valid(d)) { said.textContent = "Pick a date."; said.classList.add("bad"); return; }
    const p = PRESETS.get(x.preset.value);
    const base = it || { kind: "day", aesthetic: "nebula", theme: "app", tags: [] };
    // (a yearly one keeps the year it began, the day and month as chosen)
    const dateKept = it && it.repeat === "yearly" && x.yearly.checked ? `${it.date.slice(0, 4)}${d.slice(4)}` : d;
    const before = it ? { ...it } : null;
    const saved = save({ ...base, kind: "day", title: x.title.value.trim() || p.title || p.label, date: dateKept, preset: x.preset.value, repeat: x.yearly.checked ? "yearly" : "none", info: x.info.value, location: x.location.value.trim(), aesthetic: picked.aesthetic, theme: picked.theme, artSalt: picked.salt });
    undoToast(before ? "Saved" : "Day card added", () => (before ? save(before) : remove(saved.id)));
    f.classList.remove("dirty");
    goTo(`#calendar/card/${enc(saved.id)}/${d}`);
  });
}

// ---- The note card list and the day card list: every one, coming up then earlier, each to open or delete ----
function cardRows(kind) {
  const t = today(), rows = [];
  for (const it of state.items.values()) {
    if (kind === "days" ? it.kind !== "day" : it.kind === "day" || isAgent(it.id)) continue;
    const date = kind === "days" ? it.date : String(it.start || "").slice(0, 10);
    if (!valid(date)) continue;
    let next = date;
    if (kind !== "days" && it.repeat) next = (occurrences(it, t, addDays(t, 400))[0] || {}).date || date;
    if (kind === "days" && it.repeat === "yearly") { next = `${t.slice(0, 4)}${date.slice(4)}`; if (next < t) next = `${Number(t.slice(0, 4)) + 1}${date.slice(4)}`; }
    const name = kind === "days" ? it.title || PRESETS.get(it.preset).label : it.title || "(No title)";
    const when = kind === "days" ? (it.repeat === "yearly" ? "Every year" : PRESETS.get(it.preset).label) : it.allDay ? "All day" : String(it.start || "").slice(11, 16);
    const again = kind !== "days" && it.repeat ? describeRepeat(it.repeat) : "";
    rows.push({ it, date: next, name, when, again, past: next < t });
  }
  return {
    up: rows.filter((r) => !r.past).sort((a, b) => a.date.localeCompare(b.date) || a.when.localeCompare(b.when)),
    gone: rows.filter((r) => r.past).sort((a, b) => b.date.localeCompare(a.date)),
  };
}
function drawCardList(box, kind, ui) {
  const day = kind === "days";
  ui.title(day ? "Day cards" : "Note cards");
  ui.back(`#calendar/${view}/${cursor}`);
  ui.action({ icon: "plus", label: day ? "New day card" : "New note card", href: `#calendar/${day ? "newday" : "new"}/${today()}` });
  const { up, gone: past } = cardRows(kind);
  const rowOf = (r) => `<li class="cal-lrow"><a class="row edge" href="#calendar/card/${enc(r.it.id)}/${r.date}"${day ? "" : ` data-c="${esc(NEAREST[r.it.color] || r.it.color || "violet")}"`}><span class="row-main"><b>${esc(r.name)}</b><span>${esc(dayLabel(r.date))}${yearOf(r.date)}${r.when ? ` · ${esc(r.when)}` : ""}${r.again ? ` · ${esc(r.again)}` : ""}</span></span></a><button type="button" class="icon-btn cal-ldel" data-cal-ldel="${esc(r.it.id)}" data-date="${r.date}" aria-label="Delete ${esc(r.name)}">${icon("trash")}</button></li>`;
  const total = up.length + past.length;
  box.innerHTML = `${statusHtml()}<div class="cal-lhead"><p class="muted">${total ? `${total} in all` : ""}</p><a class="btn" href="#calendar/${day ? "newday" : "new"}/${today()}">${icon("plus")} ${day ? "Day card" : "Note card"}</a></div>
    ${!total ? empty({ icon: day ? "star" : "calendar", title: `No ${day ? "day cards" : "note cards"} yet` }) : ""}
    ${up.length ? `<h3 class="h">Coming up</h3><ul class="list">${up.map(rowOf).join("")}</ul>` : ""}
    ${past.length ? `<h3 class="h">Earlier</h3><ul class="list">${past.map(rowOf).join("")}</ul>` : ""}`;
  for (const b of box.querySelectorAll("[data-cal-ldel]")) b.addEventListener("click", async () => {
    const it = state.items.get(b.dataset.calLdel);
    if (it && (await removeCard(it, b.dataset.date))) N.show();
  });
}

// ---- Backup: download everything, or bring a backup in (this Calendar's, or the old one's; the newer of each wins) ----
function drawBackup(box, ui) {
  ui.title("Backup");
  ui.back(`#calendar/${view}/${cursor}`);
  box.innerHTML = `${statusHtml()}<div class="card"><p class="kicker">Calendar</p><h2 class="card-title">Your note cards and day cards</h2><p class="muted">A backup is one file with every note card and day card (not Nova Agent's plan or bookings: they live elsewhere).</p></div>
    <button type="button" class="btn main wide" data-cal-export>${icon("pdf")} Export: download a backup</button>
    <label class="btn wide cal-import">${icon("refresh")} Import a backup…<input type="file" accept=".json,application/json" data-cal-import></label>
    <p class="muted small">Importing keeps whichever copy of each card is newer, here or in the file. Old Calendar backups work too.</p>`;
  box.querySelector("[data-cal-export]").addEventListener("click", () => {
    const all = [...state.items.values()];
    const notes = all.filter((it) => it.kind === "event" && !isAgent(it.id)), days = all.filter((it) => it.kind === "day");
    download(new Blob([JSON.stringify({ app: "Calendar", version: 2, exported: new Date().toISOString(), notes, days }, null, 2)], { type: "application/json" }), `calendar-backup-${today()}.json`);
    toast(`Backup saved: ${plural(notes.length, "note card")}, ${plural(days.length, "day card")}`);
  });
  const input = box.querySelector("[data-cal-import]");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch (e) { return toast("That file isn't a Calendar backup.", true); }
    const notes = Array.isArray(parsed && parsed.notes) ? parsed.notes : Array.isArray(parsed && parsed.items) ? parsed.items.filter((v) => v && v.kind !== "day") : [];
    const days = Array.isArray(parsed && parsed.days) ? parsed.days : Array.isArray(parsed && parsed.items) ? parsed.items.filter((v) => v && v.kind === "day") : [];
    if (!notes.length && !days.length) return toast("That file isn't a Calendar backup.", true);
    let n = 0, d = 0;
    for (const it of notes) {
      if (!it || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(it.start || "") || isAgent(it.id)) continue;
      const had = it.id && state.items.get(it.id);
      if (had && (had.updated || "") >= (it.updated || "")) continue;
      save({ ...it, kind: "event" });
      n++;
    }
    for (const it of days) {
      if (!it || !valid(it.date)) continue;
      const had = it.id && state.items.get(it.id);
      if (had && (had.updated || "") >= (it.updated || "")) continue;
      save({ ...it, kind: "day" });
      d++;
    }
    toast(n || d ? `Brought in ${plural(n, "note card")} and ${plural(d, "day card")}` : "Everything in that backup is already here.");
  });
}

// ---- For Today (today.js): today's cards as rows, and the day in words, the moon and the special days ----
N.cal = {
  load,
  // today's (or a day's) cards: entries with { type, item, date, start, end, allDay, ro, color }
  day: (d = today()) => onDay(entries(d, d), d),
  row: (e) => entryRow(e),
  // { date, empty, onNow: { title, until, entry } | null, next: { title, at, minutes, soon, entry } | null,
  //   gaps: [{ from, to, start, end }], allDay: [titles], sentences: [{ html, text }] }
  summary: (d = today()) => summarize(d, onDay(entries(d, d), d)),
  // { name, principal, fullName, percent, words: "Waxing gibbous · 72% lit", svg(size) }
  moon: (d = today()) => { const m = SKY.moon(d); return { name: m.name, principal: m.principal, fullName: m.fullName, percent: Math.round(m.illumination * 100), words: moonLine(m), svg: (size = 22) => SKY.moonSVG(m.fraction, size) }; },
  // [{ kind: "day" | "sky", title, label, href }]: the day's day cards, then its seasonal and cosmic days
  special: (d = today()) => [
    ...onDay(entries(d, d), d).filter((e) => e.type === "day").map((e) => ({ kind: "day", title: titleOf(e), label: PRESETS.get(e.item.preset).label, href: `#calendar/card/${enc(e.item.id)}/${d}` })),
    ...skyDays(d).map((x) => ({ kind: "sky", title: x.title, label: "Special day", href: `#calendar/day/${d}` })),
  ],
  status: statusText,
};
// (Today can draw before this file is ready on some engines: draw it again with what this file adds)
if (!location.hash || location.hash.startsWith("#today")) N.show();
