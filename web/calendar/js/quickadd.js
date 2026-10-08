// Quick add: "Mix review Friday 2pm 1h" → an event, worked out here (no server needed).
// Understands: today, tomorrow, a weekday ("next Friday" for the week after), dates
// ("31 Oct", "Oct 31", "31/10", "2026-10-31"), times ("2pm", "2:30pm", "14:00", "at 9"),
// ranges ("2-4pm", "10:00-11:30"), lengths ("1h", "90m", "1.5 hours"), "all day",
// repeats ("every day", "every Monday", "weekly"…) and a place after "@" ("@Studio A").

import { addDays, addMinutes, weekday } from "./recur.js";

const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_SHORT = WD.map((d) => d.slice(0, 3));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");

function dayIndex(word) {
  const w = word.toLowerCase().replace(/s$/, "");
  const i = WD.indexOf(w);
  return i >= 0 ? i : WD_SHORT.indexOf(w.slice(0, 3)) >= 0 && w.length <= 4 ? WD_SHORT.indexOf(w.slice(0, 3)) : -1;
}
function monthIndex(word) {
  return MONTHS.indexOf(word.toLowerCase().slice(0, 3));
}
// "2pm" "2:30pm" "14:00" "9" (with am/pm hint) → minutes after midnight, or null
function timeOf(h, m, ap) {
  let hour = Number(h);
  const min = Number(m || 0);
  if (hour > 23 || min > 59) return null;
  if (ap) {
    if (hour > 12) return null;
    if (ap.toLowerCase().startsWith("p") && hour < 12) hour += 12;
    if (ap.toLowerCase().startsWith("a") && hour === 12) hour = 0;
  } else if (!m && hour >= 1 && hour <= 7) {
    // "at 3" means the afternoon
    hour += 12;
  }
  return hour * 60 + min;
}
const hhmm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

// today: "YYYY-MM-DD" (the studio's date)
export function parseQuick(input, today) {
  let s = ` ${String(input || "").trim()} `;
  const found = [];
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = s.replace(m[0], " ");
    return true;
  };
  let date = null;
  let start = null;
  let end = null;
  let length = null;
  let allDay = false;
  let repeat = null;
  let location = "";

  take(/\s@\s*([^@]+?)\s*$/i, (m) => {
    location = m[1].trim();
  });
  take(/\s(?:all[- ]day)\s/i, () => {
    allDay = true;
    found.push("all day");
  });
  // Repeats
  take(/\s(?:every\s+(day|week|month|year|weekday)|(daily|weekly|monthly|yearly))\s/i, (m) => {
    const w = (m[1] || m[2]).toLowerCase();
    if (w === "weekday") repeat = { freq: "weekly", byDay: [1, 2, 3, 4, 5] };
    else repeat = { freq: { day: "daily", week: "weekly", month: "monthly", year: "yearly", daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly" }[w] };
    found.push(m[0].trim().toLowerCase());
  }) ||
    take(/\severy\s+((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*(?:,|and|&)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*)\s/i, (m) => {
      const days = m[1].split(/\s*(?:,|and|&)\s*/).map(dayIndex).filter((d) => d >= 0);
      if (!days.length) return false;
      repeat = { freq: "weekly", byDay: days };
      found.push(`every ${days.map((d) => WD[d].slice(0, 3)).join(", ")}`);
      // The first one is the next of those days
      const t = weekday(today);
      const ahead = Math.min(...days.map((d) => (d - t + 7) % 7));
      date = addDays(today, ahead);
    });
  // Dates
  take(/\s(\d{4})-(\d{2})-(\d{2})\s/, (m) => {
    date = `${m[1]}-${m[2]}-${m[3]}`;
  }) ||
    take(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\s/i, (m) => {
      date = pickYear(today, monthIndex(m[2]), Number(m[1]), m[3]);
    }) ||
    take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s/i, (m) => {
      date = pickYear(today, monthIndex(m[1]), Number(m[2]), m[3]);
    }) ||
    take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) => {
      date = pickYear(today, Number(m[2]) - 1, Number(m[1]), m[3] && (m[3].length === 2 ? `20${m[3]}` : m[3]));
    }) ||
    take(/\s(today|tonight)\s/i, () => {
      date = today;
    }) ||
    take(/\s(tomorrow|tmrw|tmr)\s/i, () => {
      date = addDays(today, 1);
    }) ||
    take(/\s(next\s+)?(?:on\s+)?((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)\s/i, (m) => {
      const d = dayIndex(m[2]);
      if (d < 0) return false;
      let ahead = (d - weekday(today) + 7) % 7;
      if (m[1]) ahead += ahead === 0 ? 7 : 7;
      date = addDays(today, ahead);
    });
  // Times: a range first, then a single time
  take(/\s(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s/i, (m) => {
    const ap2 = m[6] || m[3];
    const b = timeOf(m[4], m[5], ap2);
    let a = timeOf(m[1], m[2], m[3] || (ap2 && Number(m[1]) <= Number(m[4]) ? ap2 : null));
    if (a === null || b === null) return false;
    if (a >= b && a - 720 >= 0 && a - 720 < b) a -= 720;
    start = a;
    end = b > a ? b : b + 1440;
  }) ||
    take(/\s(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\s/i, (m) => {
      start = timeOf(m[1], m[2], m[3]);
      return start !== null;
    }) ||
    take(/\s(?:at\s+)?(\d{1,2})\s*(am|pm)\s/i, (m) => {
      start = timeOf(m[1], null, m[2]);
      return start !== null;
    }) ||
    take(/\sat\s+(\d{1,2})\s/i, (m) => {
      start = timeOf(m[1], null, null);
      return start !== null;
    }) ||
    take(/\s(noon|midday)\s/i, () => {
      start = 720;
    });
  // Length
  take(/\s(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s/i, (m) => {
    length = Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1));
  }) ||
    take(/\s(?:for\s+)?(?:an?\s+)?(hour|half\s+an?\s+hour)\s/i, (m) => {
      length = /half/i.test(m[1]) ? 30 : 60;
    });

  const title = s.replace(/\s+/g, " ").replace(/\s(on|at|from|for)\s*$/i, "").trim();
  if (!date && (start !== null || repeat || length)) date = today;
  if (!date) return { title, found: false };
  if (start === null && !allDay) allDay = !length;
  const begin = allDay ? `${date}T00:00` : `${date}T${hhmm(start ?? 540)}`;
  const finish = allDay ? `${date}T23:59` : end !== null ? addMinutes(`${date}T00:00`, end) : addMinutes(begin, length || 60);
  const words = [allDay ? "all day" : `${hhmm(start ?? 540)}–${finish.slice(11)}`, ...found.filter((f) => f !== "all day"), location && `@ ${location}`].filter(Boolean);
  return { found: true, title, start: begin, end: finish, allDay, repeat, location, date, words };
}

// A date without a year: this year, or next year if it's already gone
function pickYear(today, month, day, year) {
  if (month < 0 || day < 1 || day > 31) return null;
  const y = year ? Number(year) : Number(today.slice(0, 4));
  let d = `${y}-${pad(month + 1)}-${pad(day)}`;
  if (!year && d < today) d = `${y + 1}-${pad(month + 1)}-${pad(day)}`;
  return d;
}
