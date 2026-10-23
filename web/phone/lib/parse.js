// (The phone version's own copy of quests/js/parse.js, 23 Oct 2026: the same rules as the computer version, kept here so the phone app stands on its own. Change both together.)
// Quick add: one line in everyday words becomes a quest ("tomorrow 3pm call Sam !high #studio 30m").
//   parseQuick(text, now?)  → { title, fields, bits }
//     fields: what Nova Quests' addQuest takes (fixedStart, earliest, deadline, minutes, priority,
//             tags, ongoing, every, everyMinutes, timeOfDay); only what the words said
//     bits:   short readable pieces for the preview under the box ("Tue 15:00", "High", "#studio")
// Times are UK wall-clock times, written like the rest of Nova: "2026-10-14T15:00". `now` is a
// Date (default: now); the day and time are read in Europe/London whatever the device's zone.
// What it understands (anywhere in the line, any order):
//   when      today, tonight, tomorrow (tmrw), mon…sun / monday…sunday, next friday, in 3 days,
//             in 20 min, in 2 hours, 14/10, 14 oct, oct 14, at 3, 3pm, 3:30pm, 15:00, noon, midnight,
//             morning, afternoon, evening
//   deadline  by friday, by 5pm, due tomorrow (the same "when" words after "by" or "due")
//   how long  30m, 45 min, 1h, 1.5h, 2 hours, 1h30
//   priority  !low, !high, !critical (or !urgent); ! or !! is high, !!! is critical
//   tags      #studio #mix
//   repeat    daily, every day, weekdays, every weekday, weekly, every week, every monday,
//             every 30 min, every 2 hours
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n) => String(n).padStart(2, "0");

// The UK wall-clock date and time of a moment: { y, m (1-12), d, h, min, dow (0 = Sunday) }
export function ukNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const y = +parts.year, m = +parts.month, d = +parts.day;
  return { y, m, d, h: +parts.hour % 24, min: +parts.minute, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
// A calendar day moved on by `n` days (plain dates: no clocks, so no summer-time surprises)
function addDays(day, n) {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}
const dayStamp = (day) => `${day.y}-${pad(day.m)}-${pad(day.d)}`;
const stamp = (day, h, min) => `${dayStamp(day)}T${pad(h)}:${pad(min)}`;
const sameDay = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
export function dayWords(day, today) {
  if (sameDay(day, today)) return "Today";
  if (sameDay(day, addDays(today, 1))) return "Tomorrow";
  const diff = Math.round((Date.UTC(day.y, day.m - 1, day.d) - Date.UTC(today.y, today.m - 1, today.d)) / 864e5);
  if (diff > 0 && diff < 7) return SHORT_DAYS[day.dow];
  return `${SHORT_DAYS[day.dow]} ${day.d} ${MONTHS[day.m - 1].replace(/^./, (c) => c.toUpperCase())}`;
}

// Pull every match of `re` out of the line (each found once is replaced by a space)
function take(state, re, fn) {
  state.text = state.text.replace(re, (...m) => (fn(...m) === false ? m[0] : " "));
}

// "3pm", "3:30pm", "15:00", "noon", "midnight", "at 9" → { h, min } (or null)
function readTime(word) {
  const w = word.toLowerCase().trim();
  if (w === "noon" || w === "midday") return { h: 12, min: 0 };
  if (w === "midnight") return { h: 0, min: 0 };
  let m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)$/.exec(w);
  if (m) {
    let h = +m[1] % 12;
    if (m[3] === "pm") h += 12;
    return +m[1] <= 12 && (!m[2] || +m[2] < 60) ? { h, min: +(m[2] || 0) } : null;
  }
  m = /^(\d{1,2})[:.](\d{2})$/.exec(w);
  if (m && +m[1] < 24 && +m[2] < 60) return { h: +m[1], min: +m[2] };
  return null;
}
// "at 9" with no am/pm: the next 9 that makes sense (8 to 11 and 12 are as said, 1 to 7 are pm)
const bareHour = (n) => (n >= 1 && n <= 7 ? n + 12 : n);

// A "when" phrase at the start of `s` (after "by" / "due", or on its own): { day?, time?, part?, len }
const TIME_RE = String.raw`(?:noon|midday|midnight|\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}[:.]\d{2})`;
const MONTH_RE = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
// Whole day names always, and mon, tue, wed, thu, fri; sat and sun only after on / next / this, so
// "sun cream" and "sat nav" stay titles
const FULL_DAYS = String.raw`(?:monday|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|mon|saturday|sunday)`;
const DAY_RE = String.raw`(?:today|tonight|tomorrow|tmrw|tmr|(?:(?:next|this|on)\s+)?${FULL_DAYS}|(?:next|this|on)\s+(?:mon|tue|wed|thu|fri|sat|sun)|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?\s+${MONTH_RE}|${MONTH_RE}\s+\d{1,2}(?:st|nd|rd|th)?)`;

function readDay(word, today) {
  const w = word.toLowerCase().trim();
  if (w === "today" || w === "tonight") return today;
  if (/^(tomorrow|tmrw|tmr)$/.test(w)) return addDays(today, 1);
  const name = w.replace(/^(next|this|on)\s+/, "");
  const dow = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(name.slice(0, 3));
  if (dow >= 0 && /^[a-z]+$/.test(name)) {
    const ahead = (dow - today.dow + 7) % 7;
    return addDays(today, ahead === 0 ? 7 : ahead); // "friday" on a Friday: next week's
  }
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(w);
  if (m) return datedDay(+m[1], +m[2], m[3] ? +(m[3].length === 2 ? "20" + m[3] : m[3]) : 0, today);
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)$/.exec(w);
  if (m && MONTHS.indexOf(m[2].slice(0, 3)) >= 0) return datedDay(+m[1], MONTHS.indexOf(m[2].slice(0, 3)) + 1, 0, today);
  m = /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/.exec(w);
  if (m && MONTHS.indexOf(m[1].slice(0, 3)) >= 0) return datedDay(+m[2], MONTHS.indexOf(m[1].slice(0, 3)) + 1, 0, today);
  return null;
}
// A day and month (UK order); no year: the next one from today
function datedDay(d, m, y, today) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let year = y || today.y;
  const t = new Date(Date.UTC(year, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  if (!y && Date.UTC(year, m - 1, d) < Date.UTC(today.y, today.m - 1, today.d)) year += 1;
  return addDays({ y: year, m, d }, 0);
}

export function parseQuick(input, now = new Date()) {
  const today = ukNow(now);
  const state = { text: ` ${String(input || "").replace(/\s+/g, " ")} ` };
  const fields = {};
  const bits = [];

  // Tags
  const tags = [];
  take(state, /(^|\s)#([\p{L}\p{N}_-]{1,24})(?=\s)/gu, (_m, _s, tag) => void tags.push(tag.toLowerCase()));
  if (tags.length) fields.tags = [...new Set(tags)].slice(0, 10);

  // Priority
  take(state, /(^|\s)!(critical|urgent|crit|high|hi|h|low|lo|l|normal|!{0,2})(?=\s)/gi, (_m, _s, word) => {
    const w = word.toLowerCase();
    fields.priority = /^(critical|urgent|crit|!!)$/.test(w) ? "critical" : /^(high|hi|h|!)$/.test(w) || w === "" ? "high" : /^(low|lo|l)$/.test(w) ? "low" : "normal";
  });

  // Repeats
  take(state, /(^|\s)every\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)(?=\s)/gi, (_m, _s, n, unit) => {
    const minutes = /^h/i.test(unit) ? Math.round(+n * 60) : Math.round(+n);
    if (minutes < 1) return false;
    Object.assign(fields, { ongoing: true, every: "interval", everyMinutes: minutes });
  });
  take(state, /(^|\s)(daily|every\s+day|each\s+day)(?=\s)/gi, () => void Object.assign(fields, { ongoing: true, every: "day" }));
  take(state, /(^|\s)(weekdays|every\s+weekday|each\s+weekday)(?=\s)/gi, () => void Object.assign(fields, { ongoing: true, every: "weekday" }));
  take(state, /(^|\s)(weekly|every\s+week|each\s+week)(?=\s)/gi, () => void Object.assign(fields, { ongoing: true, every: "week" }));
  let repeatDay = null;
  take(state, new RegExp(String.raw`(^|\s)every\s+(${FULL_DAYS}|mon|tue|wed|thu|fri|sat|sun)(?=\s)`, "gi"), (_m, _s, d) => {
    Object.assign(fields, { ongoing: true, every: "week" });
    repeatDay = readDay(d, today);
  });

  // How long ("30m", "1h30", "2 hours"): not a time of day ("3pm"), and not after "in" ("in 20 min")
  take(state, /(^|\s)(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)\s*(\d{1,2})?\s*(?:m|min|mins)?(?=\s)/gi, (m, s, n, _u, extra) => {
    if (/\bin\s*$/i.test(state.text.slice(0, state.text.indexOf(m) + s.length))) return false;
    fields.minutes = Math.round(+n * 60 + (extra ? +extra : 0));
  });
  take(state, /(^|\s)(?:for\s+)?(\d+)\s*(m|min|mins|minutes?)(?=\s)/gi, (m, s, n) => {
    if (/\bin\s*$/i.test(state.text.slice(0, state.text.indexOf(m) + s.length))) return false;
    fields.minutes = +n;
  });

  // "in 20 min", "in 2 hours", "in 3 days"
  let at = null; // { day, h, min }
  take(state, /(^|\s)in\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|weeks?)(?=\s)/gi, (_m, _s, n, unit) => {
    const u = unit.toLowerCase();
    if (u.startsWith("d") || u.startsWith("w")) {
      at = { day: addDays(today, Math.round(+n * (u.startsWith("w") ? 7 : 1))) };
      return;
    }
    const total = today.h * 60 + today.min + Math.round(+n * (u.startsWith("h") ? 60 : 1));
    at = { day: addDays(today, Math.floor(total / 1440)), h: Math.floor((total % 1440) / 60), min: total % 60 };
  });

  // Deadlines: "by friday", "by 5pm", "due tomorrow 3pm"
  let due = null;
  take(state, new RegExp(String.raw`(^|\s)(?:by|due|before)\s+(${DAY_RE})?\s*(?:at\s+)?(${TIME_RE}|\d{1,2})?(?=\s)`, "gi"), (_m, _s, d, t) => {
    if (!d && !t) return false;
    const day = d ? readDay(d, today) : null;
    const time = t ? readTime(t) || (/^\d{1,2}$/.test(t) ? { h: bareHour(+t), min: 0 } : null) : null;
    if ((d && !day) || (t && !time)) return false;
    due = { day, time };
  });

  // When: a day, a time, or both
  let whenDay = null;
  let whenTime = null;
  let part = "";
  take(state, new RegExp(String.raw`(^|\s)(${DAY_RE})(?=\s)`, "gi"), (_m, _s, d) => {
    const day = readDay(d, today);
    if (!day || whenDay) return false;
    whenDay = day;
    if (/^tonight$/i.test(d)) part = "evening";
  });
  take(state, new RegExp(String.raw`(^|\s)(?:at\s+)?(${TIME_RE})(?=\s)`, "gi"), (_m, _s, t) => {
    const time = readTime(t);
    if (!time || whenTime) return false;
    whenTime = time;
  });
  take(state, /(^|\s)at\s+(\d{1,2})(?=\s)/gi, (_m, _s, n) => {
    if (whenTime || +n > 23) return false;
    whenTime = { h: bareHour(+n), min: 0 };
  });
  take(state, /(^|\s)(?:in\s+the\s+|this\s+)?(morning|afternoon|evening)(?=\s)/gi, (_m, _s, p) => {
    if (part && part !== p.toLowerCase()) return false;
    part = p.toLowerCase();
  });

  // Put it together
  if (at) {
    if (at.h !== undefined) {
      fields.fixedStart = stamp(at.day, at.h, at.min);
      bits.push(`${dayWords(at.day, today)} ${pad(at.h)}:${pad(at.min)}`);
    } else {
      whenDay = whenDay || at.day;
    }
  }
  if (!fields.fixedStart && (whenDay || whenTime)) {
    let day = whenDay || today;
    if (whenTime && !whenDay && whenTime.h * 60 + whenTime.min <= today.h * 60 + today.min) day = addDays(today, 1); // already gone today: tomorrow
    if (whenTime) {
      fields.fixedStart = stamp(day, whenTime.h, whenTime.min);
      bits.push(`${dayWords(day, today)} ${pad(whenTime.h)}:${pad(whenTime.min)}`);
    } else {
      // A day without a time: some time that day
      fields.earliest = `${dayStamp(day)}T00:00`;
      if (!fields.ongoing) fields.deadline = `${dayStamp(day)}T23:59`;
      bits.push(dayWords(day, today));
    }
  }
  if (repeatDay && !fields.earliest && !fields.fixedStart) fields.earliest = `${dayStamp(repeatDay)}T00:00`;
  if (part) {
    fields.timeOfDay = part;
    if (!fields.fixedStart) bits.push(part[0].toUpperCase() + part.slice(1));
  }
  if (due) {
    const day = due.day || today;
    const time = due.time || { h: 23, min: 59 };
    fields.deadline = stamp(day, time.h, time.min);
    bits.push(`by ${dayWords(day, today)}${due.time ? ` ${pad(time.h)}:${pad(time.min)}` : ""}`);
  }
  if (fields.minutes) bits.push(fields.minutes >= 60 ? `${Math.floor(fields.minutes / 60)} h${fields.minutes % 60 ? ` ${fields.minutes % 60} min` : ""}` : `${fields.minutes} min`);
  if (fields.ongoing) {
    bits.push(fields.every === "interval" ? `Every ${fields.everyMinutes >= 60 && fields.everyMinutes % 60 === 0 ? `${fields.everyMinutes / 60} h` : `${fields.everyMinutes} min`}` : fields.every === "day" ? "Every day" : fields.every === "weekday" ? "Weekdays" : repeatDay ? `Every ${DAYS[repeatDay.dow].replace(/^./, (c) => c.toUpperCase())}` : "Every week");
  }
  if (fields.priority && fields.priority !== "normal") bits.push(fields.priority === "critical" ? "Critical" : fields.priority === "high" ? "High" : "Low");
  for (const t of fields.tags || []) bits.push(`#${t}`);

  // What's left is the title (tidied: single spaces, a capital first letter, no stray "at"/"on")
  let title = state.text.replace(/\s+/g, " ").trim().replace(/\s+(at|on|by|for|in)$/i, "").replace(/^(at|on)\s+/i, "");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { title, fields, bits };
}
