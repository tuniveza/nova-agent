// The conversation in pages (Talk to Nova Agent): each thing you asked, with Nova Agent's reply,
// is one page that fits the panel. Turn pages with ← and → (or Space), unless you're typing in
// the message box, or with the ‹ › under the conversation. A new reply opens on its own page. A
// page longer than the panel scrolls (it has a scrollbar). "All" shows the whole conversation as
// one scrolling list instead (remembered on the device).
(() => {
  "use strict";
  const log = document.getElementById("log");
  const main = document.getElementById("main");
  if (!log) return;
  const KEY = "nova-chat-pages";
  let paged = (() => { try { return localStorage.getItem(KEY) !== "all"; } catch (err) { return true; } })();
  let page = -1; // -1: the last
  let pages = [];

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
    if (!paged) {
      log.querySelectorAll(":scope > .msg").forEach((m) => m.classList.remove("cp-off"));
      where.textContent = `${pages.length} ${pages.length === 1 ? "reply" : "replies"}`;
      bar.querySelector(".cp-prev").disabled = bar.querySelector(".cp-next").disabled = true;
      return;
    }
    const n = page < 0 || page >= pages.length ? pages.length - 1 : page;
    pages.forEach((list, i) => list.forEach((m) => m.classList.toggle("cp-off", i !== n)));
    where.textContent = `${n + 1} of ${pages.length}`;
    bar.querySelector(".cp-prev").disabled = n === 0;
    bar.querySelector(".cp-next").disabled = n === pages.length - 1;
    log.scrollTop = 0;
  }
  function go(step) {
    if (!paged || !pages.length) return;
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
    if (!paged || bar.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select, [role='textbox']")))) return;
    if (main && main.classList.contains("viewing")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(1); }
  });

  // New messages: show the newest page
  new MutationObserver((changes) => {
    if (changes.some((c) => [...c.addedNodes].some((n) => n.classList && n.classList.contains("msg")) || [...c.removedNodes].some((n) => n.classList && n.classList.contains("msg")))) {
      page = -1;
      show();
    }
  }).observe(log, { childList: true });
  show();
})();
