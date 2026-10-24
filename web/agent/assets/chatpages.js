// The conversation in pages (Agent): each thing you asked, with Nova Agent's reply,
// is one page that fits the panel. Turn pages with ← and → (or Space), unless you're typing in
// the message box, by swiping sideways on a touch screen, or with the ‹ › under the conversation. A new reply opens on its own page. A
// page longer than the panel scrolls (it has a scrollbar). "All" shows the whole conversation as
// one scrolling list instead (remembered on the device).
// One page bar (24 Oct 2026, the user: "can you center the nova agent look", with two page bars stacked
// under the conversation, "‹ 1 / 2 ›" and "‹ 3 of 3 › All"): a reply too long for the panel is cut into
// pages by /shared/onescreen.js, and those pages are turned with this same bar (its own bar is kept out of
// sight). ‹ › go through the reply's pages first, then on to the next reply; the middle says both, e.g.
// "Reply 3 of 3 · page 1 of 2".
(() => {
  "use strict";
  const log = document.getElementById("log");
  const main = document.getElementById("main");
  if (!log) return;
  const KEY = "nova-chat-pages";
  let paged = (() => { try { return localStorage.getItem(KEY) !== "all"; } catch (err) { return true; } })();
  let page = -1; // -1: the last
  let pages = [];
  let started = false; // (the first drawing is onescreen.js's own, as the page loads)

  const bar = document.createElement("div");
  bar.className = "chat-pager";
  bar.hidden = true;
  bar.innerHTML = `
    <button type="button" class="cp-prev" data-sfx="tab" aria-label="Previous reply" title="Previous (←)">‹</button>
    <span class="cp-where" aria-live="polite"></span>
    <button type="button" class="cp-next" data-sfx="tab" aria-label="Next reply" title="Next (→ or Space)">›</button>
    <button type="button" class="cp-mode" data-sfx="tab" title="Pages or the whole conversation"></button>`;
  log.after(bar);
  const where = bar.querySelector(".cp-where");

  // Each page starts at something you asked (anything before the first goes on the first page)
  function group() {
    pages = [];
    for (const m of log.querySelectorAll(":scope > .msg")) {
      if (m.classList.contains("user") || !pages.length) pages.push([]);
      pages[pages.length - 1].push(m);
    }
  }
  function show() {
    group();
    const any = pages.length > 0;
    bar.hidden = !any;
    log.classList.toggle("paged", paged && any);
    bar.querySelector(".cp-mode").textContent = paged ? "All" : "Pages";
    if (!any) return;
    if (!paged) log.querySelectorAll(":scope > .msg").forEach((m) => m.classList.remove("cp-off"));
    else {
      const n = page < 0 || page >= pages.length ? pages.length - 1 : page;
      pages.forEach((list, i) => list.forEach((m) => m.classList.toggle("cp-off", i !== n)));
      log.scrollTop = 0;
    }
    // (another reply showing: onescreen.js cuts it into pages now, not when it next notices; Safari only noticed
    // late, so a long reply went unpaged and the bar still showed the last one's pages, 24 Oct 2026)
    if (window.NovaOneScreen && started) window.NovaOneScreen.now();
    say();
  }
  // The middle of the bar and its ‹ ›: the reply, and its pages when onescreen.js has cut it into pages
  // (read from onescreen's own bar, out of sight in the log, so the two always agree)
  const os = () => log.querySelector(":scope > .os-pager:not([hidden])");
  function say() {
    // (no conversation yet: the welcome, if it's in pages, keeps onescreen's own bar)
    if (!pages.length) return;
    const sub = os();
    const part = sub && window.NovaOneScreen && window.NovaOneScreen.where(log);
    const of = part && part.pages > 1 ? `page ${part.page + 1} of ${part.pages}` : "";
    const n = page < 0 || page >= pages.length ? pages.length - 1 : page;
    const text = paged
      ? [pages.length > 1 ? `Reply ${n + 1} of ${pages.length}` : "", of].filter(Boolean).join(" · ") || "1 reply"
      : [`${pages.length} ${pages.length === 1 ? "reply" : "replies"}`, of].filter(Boolean).join(" · ");
    if (where.textContent !== text) where.textContent = text;
    const subPrev = !!(sub && !sub.querySelector(".os-prev").disabled), subNext = !!(sub && !sub.querySelector(".os-next").disabled);
    const prev = !(subPrev || (paged && n > 0)), next = !(subNext || (paged && n < pages.length - 1));
    if (bar.querySelector(".cp-prev").disabled !== prev) bar.querySelector(".cp-prev").disabled = prev;
    if (bar.querySelector(".cp-next").disabled !== next) bar.querySelector(".cp-next").disabled = next;
  }
  function go(step) {
    if (!pages.length) return;
    // (the reply's own pages first)
    if (os() && window.NovaOneScreen && window.NovaOneScreen.turn(log, step)) { say(); if (window.NovaSfx) window.NovaSfx.play("tab", undefined, bar); return; }
    if (!paged) return;
    const n = page < 0 ? pages.length - 1 : page;
    const to = Math.max(0, Math.min(pages.length - 1, n + step));
    if (to === n) return;
    page = to === pages.length - 1 ? -1 : to;
    show();
    if (window.NovaSfx) window.NovaSfx.play("tab", undefined, bar);
  }
  bar.querySelector(".cp-prev").addEventListener("click", () => go(-1));
  bar.querySelector(".cp-next").addEventListener("click", () => go(1));
  bar.querySelector(".cp-mode").addEventListener("click", () => {
    paged = !paged;
    try { localStorage.setItem(KEY, paged ? "pages" : "all"); } catch (err) {}
    page = -1;
    show();
    if (!paged) log.scrollTop = log.scrollHeight;
  });

  // The keys: only for the conversation in view, and never while you're typing somewhere
  document.addEventListener("keydown", (e) => {
    if (bar.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select, [role='textbox']")))) return;
    if (main && main.classList.contains("viewing")) return;
    if (document.querySelector("dialog[open]")) return;
    if (!paged && !os()) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
  });

  // Touch: swipe left for the next page, right for the one before (a clear sideways swipe only,
  // so scrolling a long reply up and down never turns the page)
  let sx = 0, sy = 0, st = 0;
  log.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  log.addEventListener("touchend", (e) => {
    if (!paged || bar.hidden || os()) return; // (a reply in pages: onescreen.js turns them on a swipe, and the bar follows)
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - st < 700 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // New messages: show the newest page
  // (onescreen.js's bar in the log: it's drawn again each time the log is cut into pages, and changes as its
  // pages turn by a swipe or the wheel; this bar follows it)
  const isOs = (n) => n.classList && n.classList.contains("os-pager");
  const follow = new MutationObserver(() => say());
  new MutationObserver((changes) => {
    if (changes.some((c) => [...c.addedNodes].some((n) => n.classList && n.classList.contains("msg")) || [...c.removedNodes].some((n) => n.classList && n.classList.contains("msg")))) {
      page = -1;
      show();
    }
    if (changes.some((c) => [...c.addedNodes, ...c.removedNodes].some(isOs))) {
      follow.disconnect();
      const sub = log.querySelector(":scope > .os-pager");
      if (sub) follow.observe(sub, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
      say();
    }
  }).observe(log, { childList: true });
  show();
  started = true;
})();
