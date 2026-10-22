// The right-click menu (22 Oct 2026, the user: "right click opens up a popup … with create note card,
// remove note card, view note card list also create day card, remove day card and view day card list;
// etc."). A right-click anywhere on the calendar (a day, a time in Week or Day view, a card, the list),
// or a long press on a phone, opens it for that day:
//   - on a card: open it, or delete it;
//   - Note cards: create one (at the time pressed, in Week or Day view), delete one of the day's, see them all;
//   - Day cards: create (or change) the day's, delete it, see them all;
//   - and Day view, Today.
// "See them all" opens a list that fits the screen in pages (no scrolling), each card with Open and Delete.
// What it does is cal.js's own (window.NovaCalendar): the same windows, the same Undo.
(function () {
  "use strict";
  const C = () => window.NovaCalendar;
  const view = document.getElementById("view");
  if (!view) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sfx = (n) => window.NovaSfx && window.NovaSfx.play && window.NovaSfx.play(n);
  let menu = null;
  let back = null; // what had focus before, to go back to

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
    return { date, time, card: card ? { type: card.dataset.type, id: card.dataset.id, date: card.dataset.date || date } : null };
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
    `<button type="button" role="menuitem" class="cm-item${opts.danger ? " danger" : ""}" data-act="${act}"${opts.data ? ` data-arg="${esc(opts.data)}"` : ""}${opts.off ? ' aria-disabled="true" tabindex="-1"' : ""}>${esc(label)}${opts.note ? `<small>${esc(opts.note)}</small>` : ""}</button>`;

  function open(x, y, place) {
    const cal = C();
    if (!cal || !place.date) return;
    close();
    back = document.activeElement;
    const d = place.date;
    const on = cal.entriesOn(d);
    const notes = on.filter((e) => e.type === "event" && !e.ro);
    const dayCard = cal.dayCardOn(d);
    const card = place.card && place.card.type !== "booking" ? cal.get(place.card.id) : null;
    let html = `<p class="cm-head">${esc(cal.dayLabel(d))}${place.time ? ` · ${place.time}` : ""}</p>`;
    if (place.card) {
      const e = on.find((x) => x.item.id === place.card.id) || null;
      const name = e ? cal.titleOf(e) : card ? card.title || "" : "";
      const word = place.card.type === "day" ? "day card" : place.card.type === "booking" ? "booking" : cal.isAgent(place.card.id) ? "quest" : "note card";
      html += `<div class="cm-group" role="group" aria-label="This ${word}">`;
      html += item("open", `Open this ${word}`, { note: name });
      if (card && !cal.isAgent(card.id)) html += item("delete-this", `Delete this ${word}`, { danger: true });
      html += `</div>`;
    }
    html += `<div class="cm-group" role="group" aria-label="Note cards"><p class="cm-title">Note cards</p>`;
    html += item("new-note", "Create note card", { note: place.time ? `at ${place.time}` : "" });
    html += item("remove-note", "Remove note card", notes.length ? { note: notes.length === 1 ? cal.titleOf(notes[0]) : `${notes.length} on this day: pick one` } : { off: true, note: "none on this day" });
    html += `<div class="cm-pick" hidden>${notes.map((e) => item("delete-note", `Delete “${cal.titleOf(e)}”`, { danger: true, data: `${e.item.id}|${e.date}` })).join("")}</div>`;
    html += item("list-note", "View note card list");
    html += `</div><div class="cm-group" role="group" aria-label="Day cards"><p class="cm-title">Day cards</p>`;
    html += dayCard ? item("edit-day", "Change the day card", { note: cal.titleOf({ type: "day", item: dayCard }) }) : item("new-day", "Create day card");
    html += item("remove-day", "Remove day card", dayCard ? { danger: true, note: cal.titleOf({ type: "day", item: dayCard }) } : { off: true, note: "none on this day" });
    html += item("list-day", "View day card list");
    html += `</div><div class="cm-group" role="group" aria-label="Go to">`;
    html += item("day-view", "Open in Day view");
    if (d !== cal.today()) html += item("today", "Go to today");
    html += `</div>`;

    menu = document.createElement("div");
    menu.className = "cm";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `${cal.dayLabel(d)}: note cards and day cards`);
    menu.innerHTML = html;
    document.body.append(menu);
    place.dayCard = dayCard;
    place.notes = notes;
    menu.addEventListener("click", (e) => act(e, place));
    menu.addEventListener("keydown", keys);
    fit(x, y);
    sfx("open");
    first()?.focus({ preventScroll: true });
  }
  // On screen, next to where it was pressed: never off an edge (a short window: two columns)
  function fit(x, y) {
    menu.classList.remove("cm-wide");
    const room = innerHeight - 16;
    if (menu.offsetHeight > room) menu.classList.add("cm-wide");
    const w = menu.offsetWidth, h = menu.offsetHeight;
    const left = Math.max(8, Math.min(x, innerWidth - w - 8));
    const top = Math.max(8, Math.min(y, innerHeight - h - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  const enabled = () => [...menu.querySelectorAll(".cm-item:not([aria-disabled])")].filter((b) => b.offsetParent);
  const first = () => enabled()[0];
  function keys(e) {
    const list = enabled();
    const i = list.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus(); }
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
      fit(parseFloat(menu.style.left), parseFloat(menu.style.top));
      if (!pick.hidden) pick.querySelector(".cm-item")?.focus();
      return;
    }
    close();
    if (a === "open") return cal.openExisting(place.card.type, place.card.id, place.card.date);
    if (a === "delete-this") { const it = cal.get(place.card.id); return it && cal.removeCard(it, place.card.date); }
    if (a === "new-note") return cal.openNew({ date: d, time: place.time || undefined });
    if (a === "remove-note") { const e1 = place.notes[0]; return e1 && cal.removeCard(e1.item, e1.date); }
    if (a === "delete-note") { const [id, date] = b.dataset.arg.split("|"); const it = cal.get(id); return it && cal.removeCard(it, date); }
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
      if (!press) return;
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
  // (the tap that ends a long press doesn't also open the day)
  view.addEventListener("click", (e) => { if (Date.now() - pressed < 700) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Away: a press outside, the window changing
  document.addEventListener("pointerdown", (e) => { if (menu && !menu.contains(e.target)) close(); }, true);
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
