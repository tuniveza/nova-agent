// The right-click menu (22 Oct 2026, the user: "right click opens up a popup … with create note card,
// remove note card, view note card list also create day card, remove day card and view day card list;
// etc."). A right-click anywhere on the calendar (a day, a time in Week or Day view, a card, the list),
// or a long press on a phone, opens it for what was pressed.
// Made more useful on 25 Oct 2026 (the user: "on the nova calender can right click bring up a useful menu"):
//   - on a note card: Open, Duplicate, Move to the next day or the next week, its colour (the swatches are in
//     the menu), Copy title, Copy card (to paste on another day), Join Google Meet when it has a link, Delete;
//   - on a day card: Change, Copy title, Delete; on a booking or Nova Agent's plan, only what can be done with
//     it (Open, Open in Google Calendar where it has a page there, Copy title): nothing that would do nothing;
//   - on a day or a time: New note card (at the time pressed, in Week or Day view), Paste the copied card,
//     New (or change) the day card, Remove the day card or one of the day's note cards (only when there's
//     one), the note card list and the day card list, Day view, Today;
//   - from a card, "More for this day" shows the day's menu in its place.
// Every change says what it did, with Undo; a repeating card asks which times. No confirm boxes.
// "See them all" opens a list that fits the screen in pages (no scrolling), each card with Open and Delete.
// What it does is cal.js's own (window.NovaCalendar): the same windows, the same Undo.
(function () {
  "use strict";
  const C = () => window.NovaCalendar;
  const view = document.getElementById("view");
  if (!view) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sfx = (n) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(n);
  const icon = (name) => (window.NT && window.NT.presets ? window.NT.presets.icon(name, "cm-ico") : "");
  const COLOUR_NAMES = { violet: "Violet", rose: "Rose", blue: "Blue", teal: "Teal", green: "Green", amber: "Amber", orange: "Orange", red: "Red", grey: "Grey" };
  let menu = null;
  let back = null; // what had focus before, to go back to
  let copied = null; // the card Copy card keeps, to paste on another day: { id, date }

  // ---- What was pressed: the day, a time (Week and Day view), a card ----
  function placeOf(target, y) {
    const card = target.closest("[data-id][data-type]");
    const at = target.closest("[data-date]");
    let date = (card && card.dataset.date) || (at && at.dataset.date) || "";
    if (!date && C()) {
      const plan = target.closest(".dayplan [data-add]");
      date = plan ? plan.dataset.add : "";
    }
    // (a time column: the half hour pressed)
    let time = "";
    const col = target.closest(".col[data-date]");
    if (col && !card) {
      const r = col.getBoundingClientRect();
      // (the hours the column shows: data-from and data-hours, else the whole day)
      const from = Number(col.dataset.from) || 0;
      const hours = Number(col.dataset.hours) || 24 - from;
      const mins = Math.max(0, Math.min(23 * 60 + 30, from * 60 + Math.floor((((y - r.top) / r.height) * hours * 60) / 30) * 30));
      time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    }
    return { date, time, card: card ? { type: card.dataset.type, id: card.dataset.id, date: card.dataset.date || date, text: card.textContent.replace(/\s+/g, " ").trim() } : null };
  }

  // ---- The menu ----
  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
    back = null;
  }
  const item = (act, label, opts = {}) =>
    `<button type="button" role="menuitem" class="cm-item${opts.danger ? " danger" : ""}" data-act="${act}"${opts.data ? ` data-arg="${esc(opts.data)}"` : ""}${opts.title ? ` title="${esc(opts.title)}"` : ""}>${icon(opts.icon || "card")}<span class="cm-label">${esc(label)}</span>${opts.note ? `<small>${esc(opts.note)}</small>` : ""}</button>`;
  const group = (label, html) => (html ? `<div class="cm-group" role="group" aria-label="${esc(label)}">${html}</div>` : "");
  const timeOf = (e) => (!e ? "" : e.allDay ? "All day" : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`);

  // What a card's menu offers: what can be done with that kind of card, nothing that would do nothing
  function cardItems(cal, place, e) {
    const c = place.card;
    const it = c.type !== "booking" ? cal.get(c.id) : null;
    if (c.type === "booking") {
      // (a booking from Google Calendar has no id of its own here, so it can't be opened by one: its page in
      // Google Calendar shows it in full instead)
      const b = place.e && place.e.item;
      const link = b && /^https:\/\//.test(String(b.link || "")) ? b.link : "";
      const own = b && b.id != null && String(b.id) !== "";
      return group("This booking", (own ? item("open", "Open", { icon: "booking", note: "Studio booking" }) : "") + (link ? item("google", "Open in Google Calendar", { icon: "right", data: link }) : "") + item("copy-title", "Copy title", { icon: "upload" }));
    }
    if (!it) return "";
    if (cal.isAgent(it.id)) return group("Nova Agent's plan", item("open", "Open", { icon: "quest", note: "Nova Agent's plan" }) + item("copy-title", "Copy title", { icon: "upload" }));
    if (c.type === "day") return group("This day card", item("open", "Change this day card", { icon: "sparkle" }) + item("copy-title", "Copy title", { icon: "upload" }) + item("delete-this", "Delete this day card", { icon: "close", danger: true }));
    const now = it.color || "violet";
    const day = (n) => cal.dayLabel(cal.addDays((e ? e.start : it.start).slice(0, 10), n));
    let html = item("open", "Open", { icon: "pen" });
    html += item("duplicate", "Duplicate", { icon: "card", note: "same day and time" });
    html += `<div class="cm-row" role="group" aria-label="Move">${icon("right")}<span class="cm-label">Move to</span><span class="cm-chips">
      <button type="button" role="menuitem" class="cm-item cm-chip" data-act="move" data-arg="1" title="${esc(day(1))}">Next day</button>
      <button type="button" role="menuitem" class="cm-item cm-chip" data-act="move" data-arg="7" title="${esc(day(7))}">Next week</button></span></div>`;
    html += `<div class="cm-row cm-colours" role="group" aria-label="Colour">${icon("brush")}<span class="cm-chips">${cal.colours
      .map((k) => `<button type="button" role="menuitemradio" class="cm-item cm-sw" data-act="colour" data-arg="${k}" data-color="${k}" aria-checked="${k === now}" aria-label="${COLOUR_NAMES[k] || k}" title="${COLOUR_NAMES[k] || k}"></button>`)
      .join("")}</span></div>`;
    html += item("copy-title", "Copy title", { icon: "upload" });
    html += item("copy-card", "Copy card", { icon: "pin", note: "paste on any day" });
    if (/^https:\/\/meet\.google\.com\//.test(it.meetUrl || "")) html += item("meet", "Join Google Meet", { icon: "people", data: it.meetUrl });
    html += item("delete-this", "Delete", { icon: "close", danger: true });
    return group("This note card", html);
  }
  // What a day's menu offers (and a time's, in Week and Day view)
  function dayItems(cal, place) {
    const d = place.date;
    const notes = place.notes;
    const dayCard = place.dayCard;
    const src = copied && cal.get(copied.id);
    const at = place.time ? `at ${place.time}` : "";
    let make = item("new-note", "New note card", { icon: "plus", note: at });
    if (src) make += item("paste", `Paste “${src.title || "(No title)"}”`, { icon: "download", note: at || "same time" });
    make += dayCard ? item("edit-day", "Change the day card", { icon: "sparkle", note: cal.titleOf({ type: "day", item: dayCard }) }) : item("new-day", "New day card", { icon: "sparkle" });
    let take = "";
    if (dayCard) take += item("remove-day", "Remove day card", { icon: "close", danger: true, note: cal.titleOf({ type: "day", item: dayCard }) });
    if (notes.length) {
      take += item("remove-note", "Remove note card", { icon: "close", danger: true, note: notes.length === 1 ? cal.titleOf(notes[0]) : `${notes.length} on this day: pick one` });
      take += `<div class="cm-pick" hidden>${notes.map((e) => item("delete-note", `Delete “${cal.titleOf(e)}”`, { icon: "close", danger: true, data: `${e.item.id}|${e.date}`, note: e.allDay ? "" : e.start.slice(11, 16) })).join("")}</div>`;
    }
    let go = item("list-note", "Note card list", { icon: "card" }) + item("list-day", "Day card list", { icon: "star" });
    if (cal.view !== "day") go += item("day-view", "Open in Day view", { icon: "clock" });
    if (d !== cal.today()) go += item("today", "Go to today", { icon: "flag" });
    return group("New", make) + group("Remove", take) + group("See", go);
  }

  function open(x, y, place) {
    const cal = C();
    if (!cal || !place.date) return;
    close();
    back = document.activeElement;
    const d = place.date;
    place.notes = cal.entriesOn(d).filter((e) => e.type === "event" && !e.ro);
    place.dayCard = cal.dayCardOn(d);
    const e = place.card && place.card.type !== "booking" ? cal.occurrence(place.card.id, place.card.date) : null;
    // (a booking by its words as well: bookings from Google Calendar have no id)
    const on = !place.card ? null : place.card.type === "booking" ? cal.entriesOn(d).find((x) => x.type === "booking" && String(x.item.id ?? "") === place.card.id && place.card.text.includes(cal.titleOf(x).replace(/\s+/g, " ").trim())) || null : cal.entriesOn(d).find((x) => String(x.item.id) === place.card.id) || e;
    place.e = on;
    let head;
    let html;
    if (place.card) {
      head = `<p class="cm-head"><b>${esc(on ? cal.titleOf(on) : "")}</b><small>${esc(cal.dayLabel(place.card.date))}${on ? ` · ${esc(timeOf(on))}` : ""}</small></p>`;
      html = cardItems(cal, place, e) + group("This day", item("day-more", `More for ${cal.dayLabel(d)}`, { icon: "plus", note: "›" }));
    } else {
      head = `<p class="cm-head"><b>${esc(cal.dayLabel(d))}${place.time ? ` · ${place.time}` : ""}</b></p>`;
      html = dayItems(cal, place);
    }
    menu = document.createElement("div");
    menu.className = "cm";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", place.card ? `${on ? cal.titleOf(on) : "This card"}: what to do` : `${cal.dayLabel(d)}: note cards and day cards`);
    menu.innerHTML = head + html;
    document.body.append(menu);
    menu.addEventListener("click", (ev) => act(ev, place));
    menu.addEventListener("keydown", keys);
    menu.addEventListener("contextmenu", (ev) => ev.preventDefault());
    place.x = x;
    place.y = y;
    fit(x, y);
    sfx("open");
    first()?.focus({ preventScroll: true });
  }
  // On screen, next to where it was pressed: to its left or above it when there's no room to the right or below,
  // never off an edge (a short window: its items in two columns)
  function fit(x, y) {
    menu.classList.remove("cm-wide");
    menu.style.left = "8px";
    menu.style.top = "8px";
    // (scrollHeight: the shared fitting, fit.js, may already have capped its height)
    if (menu.scrollHeight > innerHeight - 16) menu.classList.add("cm-wide");
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = x + w + 8 <= innerWidth ? x : x - w >= 8 ? x - w : innerWidth - w - 8;
    const top = y + h + 8 <= innerHeight ? y : y - h >= 8 ? y - h : innerHeight - h - 8;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }
  const enabled = () => [...menu.querySelectorAll(".cm-item:not([aria-disabled])")].filter((b) => b.offsetParent);
  const first = () => enabled()[0];
  function keys(e) {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    const inRow = document.activeElement && document.activeElement.closest(".cm-chips");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown" || (inRow && e.key === "ArrowRight")) { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp" || (inRow && e.key === "ArrowLeft")) { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus(); }
  }

  // Copy words: the clipboard (Nova Desk lets its panels write to it), else the older way
  function copyText(text) {
    const cal = C();
    const done = () => cal.toast("Title copied");
    const old = () => {
      const t = document.createElement("textarea");
      t.value = text;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch {}
      t.remove();
      cal.toast(ok ? "Title copied" : "Couldn't copy here: open the card and copy its title.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, old);
    else old();
  }

  function act(e, place) {
    const b = e.target.closest(".cm-item");
    if (!b || b.getAttribute("aria-disabled")) return;
    const cal = C();
    const d = place.date;
    const a = b.dataset.act;
    // (Remove note card with several on the day: shows them, to pick one)
    if (a === "remove-note" && place.notes.length > 1) {
      const pick = menu.querySelector(".cm-pick");
      pick.hidden = !pick.hidden;
      b.setAttribute("aria-expanded", String(!pick.hidden));
      fit(place.x, place.y);
      if (!pick.hidden) pick.querySelector(".cm-item")?.focus();
      return;
    }
    // (from a card: the day's own menu, in the same place)
    if (a === "day-more") {
      const keep = back;
      open(place.x, place.y, { date: d, time: "", card: null });
      back = keep;
      return;
    }
    close();
    const c = place.card;
    const it = c && c.type !== "booking" ? cal.get(c.id) : null;
    if (a === "open") return cal.openExisting(c.type, c.id, c.date);
    if (a === "delete-this") return it && cal.removeCard(it, c.date);
    if (a === "duplicate") return it && cal.duplicate(it, c.date);
    if (a === "move") return it && cal.moveBy(it, c.date, Number(b.dataset.arg));
    if (a === "colour") return it && cal.recolour(it, c.date, b.dataset.arg);
    if (a === "copy-title") return copyText(place.e ? cal.titleOf(place.e) : (it && it.title) || "");
    if (a === "copy-card") {
      copied = { id: c.id, date: c.date };
      return cal.toast("Card copied: right-click a day and choose Paste");
    }
    if (a === "google" || a === "meet") return void window.open(b.dataset.arg, "_blank", "noopener");
    if (a === "paste") { const src = copied && cal.get(copied.id); return src && cal.duplicate(src, copied.date, d, place.time); }
    if (a === "new-note") return cal.openNew({ date: d, time: place.time || undefined });
    if (a === "remove-note") { const e1 = place.notes[0]; return e1 && cal.removeCard(e1.item, e1.date); }
    if (a === "delete-note") { const [id, date] = b.dataset.arg.split("|"); const one = cal.get(id); return one && cal.removeCard(one, date); }
    if (a === "list-note") return showList("note");
    if (a === "new-day") return cal.openNew({ date: d, kind: "day" });
    if (a === "edit-day") return cal.openExisting("day", place.dayCard.id, d);
    if (a === "remove-day") return place.dayCard && cal.removeCard(place.dayCard, d);
    if (a === "list-day") return showList("day");
    if (a === "day-view") return cal.openDay(d);
    if (a === "today") return cal.goToday();
  }

  // ---- Opening it: a right-click, the menu key, or a long press on a phone ----
  const typing = (t) => t.closest("input, textarea, select, [contenteditable]");
  document.addEventListener("contextmenu", (e) => {
    if (!C() || !view.contains(e.target) || typing(e.target)) return;
    // (a card being dragged: a phone's own long press doesn't open the menu over it; letting go does)
    if (C().dragging) return e.preventDefault();
    const place = placeOf(e.target, e.clientY);
    // (the keyboard's menu key: next to what has focus)
    let { clientX: x, clientY: y } = e;
    if (!x && !y) { const r = e.target.getBoundingClientRect(); x = r.left + 12; y = r.top + 12; }
    if (!place.date) return;
    e.preventDefault();
    press = null;
    open(x, y, place);
  });
  let press = null;
  let pressed = 0;
  view.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || typing(e.target)) return;
    const t = e.touches[0];
    const target = e.target;
    press = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
      // (a card picked up to drag: its menu comes when it's let go without moving, from cal.js)
      if (!press || C().dragging) return (press = null);
      const place = placeOf(target, press.y);
      if (!place.date) return;
      pressed = Date.now();
      open(press.x, press.y, place);
      press = null;
    }, 550) };
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (press && Math.hypot(e.touches[0].clientX - press.x, e.touches[0].clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, { passive: true });
  const stop = () => { if (press) { clearTimeout(press.timer); press = null; } };
  view.addEventListener("touchend", stop, { passive: true });
  view.addEventListener("touchcancel", stop, { passive: true });
  // (a card held by touch and let go without moving: cal.js asks for its menu)
  view.addEventListener("cal:menu", (e) => {
    stop();
    const { target, x, y } = e.detail || {};
    if (!target || !target.isConnected) return;
    const place = placeOf(target, y);
    if (!place.date) return;
    pressed = Date.now();
    open(x, y, place);
  });
  // (the tap that ends a long press doesn't also open the day)
  view.addEventListener("click", (e) => { if (Date.now() - pressed < 700) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Away: a press outside, the window changing
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (menu && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }, true);
  addEventListener("resize", close);
  addEventListener("blur", close);
  view.addEventListener("scroll", close, true);

  // ---- The note card list and the day card list: in pages that fit, nothing scrolls ----
  let list = null;
  function rowsOf(kind) {
    const cal = C();
    const t = cal.today();
    const rows = [];
    for (const it of cal.items()) {
      if (kind === "day" ? it.kind !== "day" : it.kind === "day" || cal.isAgent(it.id)) continue;
      const date = kind === "day" ? it.date : String(it.start || "").slice(0, 10);
      if (!date) continue;
      // (a repeating one: when it next comes round, from what's in the calendar)
      let next = date;
      if (kind !== "day" && it.repeat) next = cal.nextDate(it) || date;
      if (kind === "day" && it.repeat === "yearly") {
        next = `${t.slice(0, 4)}${date.slice(4)}`;
        if (next < t) next = `${Number(t.slice(0, 4)) + 1}${date.slice(4)}`;
      }
      const name = kind === "day" ? it.title || cal.presetLabel(it.preset) : it.title || "(No title)";
      const when = kind === "day" ? (it.repeat === "yearly" ? "Every year" : "") : it.allDay ? "All day" : String(it.start || "").slice(11, 16);
      const again = kind === "day" ? "" : it.repeat ? cal.describeRepeat(it.repeat) : "";
      rows.push({ it, date: next, name, when, again, past: next < t });
    }
    const up = rows.filter((r) => !r.past).sort((a, b) => a.date.localeCompare(b.date) || a.when.localeCompare(b.when));
    const gone = rows.filter((r) => r.past).sort((a, b) => b.date.localeCompare(a.date));
    return { up, gone };
  }
  function showList(kind, page = 0) {
    const cal = C();
    closeList(false);
    back = back || document.activeElement;
    const { up, gone } = rowsOf(kind);
    const all = [...up.map((r) => ({ ...r, group: "Coming up" })), ...gone.map((r) => ({ ...r, group: "Earlier" }))];
    const word = kind === "day" ? "Day cards" : "Note cards";
    list = document.createElement("div");
    list.className = "cl-wrap";
    list.innerHTML = `<div class="cl" role="dialog" aria-modal="true" aria-label="${word}">
      <div class="cl-head"><h2>${word}</h2><span class="cl-count">${all.length ? `${all.length} in all` : ""}</span>
        <button type="button" class="cl-new">${kind === "day" ? "+ Day card" : "+ Note card"}</button>
        <button type="button" class="cl-close" aria-label="Close">×</button></div>
      <div class="cl-body"></div>
      <nav class="cl-pages" aria-label="Pages" hidden><button type="button" class="cl-prev" aria-label="Previous page">‹</button><span class="cl-n" aria-live="polite"></span><button type="button" class="cl-next" aria-label="Next page">›</button></nav></div>`;
    document.body.append(list);
    const body = list.querySelector(".cl-body");
    const rowHtml = (r, i) => `<li class="cl-row${r.past ? " past" : ""}" data-i="${i}"><time>${esc(cal.dayLabel(r.date))}${r.date.slice(0, 4) !== cal.today().slice(0, 4) ? ` ${r.date.slice(0, 4)}` : ""}${r.when ? ` · ${esc(r.when)}` : ""}</time><span class="cl-name">${esc(r.name)}${r.again ? `<small>${esc(r.again)}</small>` : ""}</span><button type="button" class="cl-open" data-i="${i}">Open</button><button type="button" class="cl-del" data-i="${i}" aria-label="Delete ${esc(r.name)}">Delete</button></li>`;
    // (as many rows as fit: measured with all of them, then cut into pages)
    let pages = [[0, all.length]];
    let at = 0;
    function draw() {
      const [s, e] = pages[at] || [0, 0];
      let html = "";
      let group = "";
      for (let i = s; i < e; i++) {
        if (all[i].group !== group) { group = all[i].group; html += `${html ? "</ul>" : ""}<p class="cl-group">${group}</p><ul>`; }
        html += rowHtml(all[i], i);
      }
      body.innerHTML = all.length ? `${html}</ul>` : `<p class="cl-empty">No ${word.toLowerCase()} yet.</p>`;
      const nav = list.querySelector(".cl-pages");
      nav.hidden = pages.length < 2;
      list.querySelector(".cl-n").textContent = `${at + 1} / ${pages.length}`;
      list.querySelector(".cl-prev").disabled = at === 0;
      list.querySelector(".cl-next").disabled = at >= pages.length - 1;
    }
    draw();
    if (all.length) {
      const nav = list.querySelector(".cl-pages");
      nav.hidden = false;
      const room = body.clientHeight;
      const rows = [...body.querySelectorAll(".cl-row")];
      const top = body.getBoundingClientRect().top;
      pages = [];
      let s = 0;
      let base = 0;
      rows.forEach((row, i) => {
        const r = row.getBoundingClientRect();
        // (a group's name above its first row counts with it)
        const head = row.parentElement.previousElementSibling;
        const from = row === row.parentElement.firstElementChild && head ? head.getBoundingClientRect().top : r.top;
        if (i > s && r.bottom - top - base > room - 30) { pages.push([s, i]); s = i; base = from - top; }
      });
      pages.push([s, all.length]);
      at = Math.max(0, Math.min(page, pages.length - 1));
      draw();
    }
    list.addEventListener("click", (e) => {
      if (e.target === list || e.target.closest(".cl-close")) return closeList();
      if (e.target.closest(".cl-new")) { closeList(false); return kind === "day" ? cal.openNew({ date: cal.today(), kind: "day" }) : cal.openNew({ date: cal.today() }); }
      if (e.target.closest(".cl-prev")) { at = Math.max(0, at - 1); return draw(); }
      if (e.target.closest(".cl-next")) { at = Math.min(pages.length - 1, at + 1); return draw(); }
      const o = e.target.closest(".cl-open");
      if (o) { const r = all[o.dataset.i]; closeList(false); return cal.openExisting(kind === "day" ? "day" : "event", r.it.id, r.date); }
      const del = e.target.closest(".cl-del");
      if (del) {
        const r = all[del.dataset.i];
        const keep = at;
        // (a repeating one asks which: the list steps aside for that question, and comes back)
        closeList(false);
        Promise.resolve(cal.removeCard(r.it, r.date)).then(() => showList(kind, keep));
      }
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeList(); }
      else if (e.key === "PageDown" || (e.key === "ArrowRight" && !e.target.closest("button"))) { at = Math.min(pages.length - 1, at + 1); draw(); }
      else if (e.key === "PageUp" || (e.key === "ArrowLeft" && !e.target.closest("button"))) { at = Math.max(0, at - 1); draw(); }
    });
    // (a wheel or a swipe turns its pages)
    let wheelAt = 0;
    list.addEventListener("wheel", (e) => {
      if (Date.now() - wheelAt < 380 || Math.abs(e.deltaY) < 20) return;
      wheelAt = Date.now();
      at = Math.max(0, Math.min(pages.length - 1, at + (e.deltaY > 0 ? 1 : -1)));
      draw();
    }, { passive: true });
    let sw = null;
    list.addEventListener("touchstart", (e) => { sw = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
    list.addEventListener("touchend", (e) => {
      if (!sw) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sw.x, dy = t.clientY - sw.y;
      sw = null;
      const by = Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 1 : -1) : Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 1 : -1) : 0;
      if (by) { at = Math.max(0, Math.min(pages.length - 1, at + by)); draw(); }
    }, { passive: true });
    sfx("open");
    list.querySelector(".cl-close").focus({ preventScroll: true });
  }
  function closeList(refocus = true) {
    if (!list) return;
    list.remove();
    list = null;
    if (refocus && back && back.isConnected) back.focus({ preventScroll: true });
    if (refocus) back = null;
  }
  // (cards added or deleted elsewhere while a list is open: it shows them)
  const watchData = () => C() && C().onChange((why) => { if (list && (why === "change" || why === "sync")) { const k = list.querySelector("h2").textContent.startsWith("Day") ? "day" : "note"; const p = Number((list.querySelector(".cl-n").textContent || "1").split(" ")[0]) - 1; showList(k, p); } });
  if (C()) watchData();
  else addEventListener("load", watchData, { once: true });
})();
