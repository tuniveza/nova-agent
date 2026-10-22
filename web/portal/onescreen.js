// One screen (21 Oct 2026, the user: "all on one screen regardless if it's laptop, desktop, mobile phone,
// tablet… avoid as much as possible scrollbars", for every section the Nova Tabs open): nothing in Portal
// scrolls. Whatever has more than fits its box is shown in pages that do fit, with a page bar at the
// bottom (‹ 2 / 5 ›). Pages are turned with the bar, a swipe, the mouse wheel or the arrow keys.
//
// The boxes: the open section (inside Nova Agent its height is set, frame.css), an open sheet (Options,
// Apps and links…), a Nova Tab's drawer, and any box inside a section that has its own height (Today's
// lists on a computer). In each box:
//   - its title row (.view-head, or anything marked data-os-pin) stays on every page;
//   - the rest is cut into pages between whole parts: cards, rows, fields, never through one, going
//     inside a part only when that one part is taller than a page (a long list, a long form);
//   - a part that can't be split (a month, a picture, one long email) is made smaller to fit (down to
//     55%); only if it's still too tall does that one part scroll, the last resort;
//   - a box of plain text that scrolls inside itself (an email's text) is opened out to its full
//     height and paged with the rest.
// What's on screen stays on screen: when a section redraws (new data, a card opened), the page that
// has what you last touched (or the first thing you were looking at) stays; anything the page jumps
// to (a Nova Tabs item, a form opening, scrollIntoView, focus) turns to its page first.
// Parts on other pages are display:none (data-os-off), so nothing is cut off or scrolls; the Fixer
// (src/fixer/strict.ts) and the auto-fix (/shared/rules.js) see only what's showing.
// A part opts out of being split with data-os-keep; a box opts out altogether with data-os-skip.
(function () {
  "use strict";
  if (window.NovaOneScreen) return;
  const OFF = "data-os-off";
  // Parts that are never split (they're one thing, or splitting them breaks their layout)
  const KEEP = 'button, a, input, select, textarea, label, svg, img, canvas, video, iframe, picture, p, h1, h2, h3, h4, h5, h6, li, dt, dd, pre, blockquote, summary, tr, .chip, .btn, .card-top, .badge, .tab, .cal, #cal-grid, [data-os-keep], [role="tablist"]';
  const HEADING = 'h1, h2, h3, h4, .group-head, .kicker, .cp-subhead, .card-title, legend';
  // Boxes that aren't sections or set-height boxes inside them
  const EXTRA = ".sheet:not([hidden]) > .sheet-card, .pillar-drawer";
  const SMALLEST = 0.55;
  const embed = () => document.documentElement.classList.contains("embed");
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = new WeakMap(); // box -> { page, pages, leaves, parents, pager, key }
  const touched = { key: "", el: null, at: 0 }; // what was last pressed in a box
  const asked = { el: null, at: 0 }; // what was last asked to come into view (it wins over everything for 8 s: a section may finish loading after the jump)
  const changed = new Set(); // elements whose style we changed (zoom, max-height…), to put back
  let busy = false; // (while laying out: our own changes aren't a reason to lay out again)

  const shown = (el) => el.isConnected && !el.hidden && getComputedStyle(el).display !== "none";
  const outer = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: r.top - parseFloat(cs.marginTop || 0), bottom: r.bottom + parseFloat(cs.marginBottom || 0), h: r.height };
  };
  const ours = (el) => el.hasAttribute && (el.hasAttribute("data-os-own") || !!el.closest?.("[data-os-own]"));
  const floating = (el) => /^(absolute|fixed)$/.test(getComputedStyle(el).position);
  const keyOf = (el) => {
    const k = el && el.closest && el.closest("[data-key], [id]");
    return k ? (k.dataset.key ? "k:" + k.dataset.key : "#" + k.id) : "";
  };
  const byKey = (box, key) => {
    if (!key) return null;
    if (key.startsWith("#")) return box.querySelector(key.replace(/([^\w#-])/g, "\\$1")) || (box.id === key.slice(1) ? box : null);
    return box.querySelector(`[data-key="${CSS.escape(key.slice(2))}"]`);
  };
  function setStyle(el, prop, value) {
    if (!el.dataset.osStyle) el.dataset.osStyle = el.getAttribute("style") || "";
    el.style.setProperty(prop, value);
    changed.add(el);
  }
  function putBackStyles(within) {
    for (const el of [...changed]) {
      if (within && !within.contains(el)) continue;
      if (el.isConnected) {
        if (el.dataset.osStyle) el.setAttribute("style", el.dataset.osStyle);
        else el.removeAttribute("style");
        delete el.dataset.osStyle;
      }
      changed.delete(el);
    }
  }

  // ---- The boxes on screen now ----
  const adopted = new Set(); // boxes a page hands over itself (an Admin page inside its frame)
  function boxes() {
    const list = [];
    for (const b of adopted) if (b.isConnected && shown(b)) list.push(b);
    if (embed()) for (const v of document.querySelectorAll("#main > .view:not([hidden])")) list.push(v);
    for (const b of document.querySelectorAll(EXTRA)) if (shown(b)) list.push(b);
    return list.filter((b) => !b.hasAttribute("data-os-skip"));
  }
  // A box inside one with its own height that scrolls (found after its outer box is laid out)
  function innerBoxes(box) {
    const found = [];
    for (const el of box.querySelectorAll("*")) {
      // (a part this has made smaller or let scroll as the last resort isn't a box of its own)
      if (/^(TEXTAREA|SELECT|INPUT|IFRAME|svg)$/i.test(el.tagName) || el.closest("[data-os-skip]") || el.hasAttribute(OFF) || ours(el) || el.hasAttribute("data-os-last")) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY) || el.clientHeight < 60) continue;
      if (el.scrollHeight > el.clientHeight + 2 && shown(el) && ![...found].some((f) => f.contains(el))) found.push(el);
    }
    return found;
  }
  // Plain text in a box of its own that scrolls (an email's words): opened out, paged with the rest
  function openOut(box) {
    for (const el of box.querySelectorAll("*")) {
      if (/^(TEXTAREA|SELECT|INPUT|IFRAME)$/.test(el.tagName) || el.closest("[data-os-skip]")) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 2) continue;
      if ([...el.children].filter(shown).length >= 2) continue;
      setStyle(el, "max-height", "none");
      setStyle(el, "overflow-y", "visible");
    }
  }

  // ---- Cutting a box into pages ----
  function pinsOf(box) {
    return [...box.children].filter((c) => (c.matches(".view-head, [data-os-pin]") || (box.matches(".sheet-card") && c.matches(".sheet-head, header, .sheet-top"))) && shown(c));
  }
  // The parts, in order: a part goes in whole unless it alone is taller than a page and has parts of its own
  function partsOf(container, room, pins, out, parents, depth) {
    for (const c of container.children) {
      if (pins.includes(c) || ours(c) || !shown(c) || floating(c)) continue;
      const h = c.getBoundingClientRect().height;
      if (h < 1) continue;
      const kids = [...c.children].filter((k) => shown(k) && !floating(k) && !ours(k));
      if (h > room && depth < 8 && !c.matches(KEEP) && kids.length >= 1) {
        parents.push(c);
        partsOf(c, room, pins, out, parents, depth + 1);
      } else out.push(c);
    }
  }
  // pos: each part's place, measured once with everything showing (hidden parts measure nothing)
  function pack(leaves, room, pos) {
    const pages = [];
    let s = 0;
    while (s < leaves.length) {
      let e = s + 1;
      let bottom = pos[s].bottom;
      while (e < leaves.length && Math.max(bottom, pos[e].bottom) - pos[s].top <= room) bottom = Math.max(bottom, pos[e++].bottom);
      // (a heading isn't left at the foot of a page with what it heads on the next)
      if (e < leaves.length && e - s > 1 && leaves[e - 1].matches(HEADING)) e--;
      pages.push([s, e]);
      s = e;
    }
    return pages;
  }
  function showPage(box, st, n) {
    const [s, e] = st.pages[n];
    // (only the parts that change are touched: a long table has hundreds of rows)
    const was = st.showing;
    if (!was) st.leaves.forEach((leaf, i) => leaf.toggleAttribute(OFF, i < s || i >= e));
    else {
      for (let i = was[0]; i < was[1]; i++) if (i < s || i >= e) st.leaves[i].setAttribute(OFF, "");
      for (let i = s; i < e; i++) st.leaves[i].removeAttribute(OFF);
    }
    st.showing = [s, e];
    const on = new Set();
    for (let i = s; i < e; i++) for (let a = st.leaves[i].parentElement; a && a !== box && !on.has(a); a = a.parentElement) on.add(a);
    for (const p of st.parents) p.toggleAttribute(OFF, !on.has(p));
    st.page = n;
    drawPager(box, st);
    if (!st.settling && st.room) {
      st.settling = true;
      try { settle(box, st); } finally { st.settling = false; }
      drawPager(box, st);
    }
  }
  const fits = (box) => box.scrollHeight <= box.clientHeight + 1;

  function reset(box) {
    for (const el of box.querySelectorAll(`[${OFF}]`)) el.removeAttribute(OFF);
    for (const el of box.querySelectorAll("[data-os-last]")) el.removeAttribute("data-os-last");
    putBackStyles(box);
    box.querySelector(":scope > .os-pager")?.remove();
    box.removeAttribute("data-os-paged");
    box.scrollTop = 0;
  }

  // Which page to show after a redraw: what was last pressed, what has focus, or what was first on screen
  function wantedPage(box, st, prev) {
    const find = (el) => {
      if (!el || el === box || !box.contains(el) || ours(el)) return -1;
      // (the part it's in, or the first part inside it)
      let i = st.leaves.findIndex((l) => l === el || l.contains(el));
      if (i < 0) i = st.leaves.findIndex((l) => el.contains(l));
      return i < 0 ? -1 : st.pages.findIndex(([s, e]) => i >= s && i < e);
    };
    if (asked.el && Date.now() - asked.at < 8000) {
      const p = find(asked.el);
      if (p >= 0) return p;
    }
    if (touched.at && Date.now() - touched.at < 8000) {
      const el = touched.el && touched.el.isConnected ? touched.el : byKey(box, touched.key);
      const p = find(el);
      if (p >= 0) return p;
    }
    const p = find(document.activeElement);
    if (p >= 0 && document.activeElement !== document.body) return p;
    if (prev && prev.firstKey) {
      const q = find(byKey(box, prev.firstKey));
      if (q >= 0) return q;
    }
    if (prev && prev.end) return st.pages.length - 1;
    return prev ? Math.min(prev.page || 0, st.pages.length - 1) : 0;
  }

  function layout(box, opts = {}) {
    const prev = state.get(box);
    // (what was first on screen, by its own key: a card's data-key or id, or one inside it; never the
    // box's own, which would always be the first page)
    const firstLeaf = prev && prev.leaves && prev.pages && prev.pages[prev.page] ? prev.leaves[prev.pages[prev.page][0]] : null;
    const own = firstLeaf && (firstLeaf.matches("[data-key], [id]") ? firstLeaf : firstLeaf.querySelector("[data-key], [id]"));
    const memo = prev ? { page: prev.page, firstKey: own ? keyOf(own) : "", end: prev.end, reveal: opts.reveal || null } : { page: 0, reveal: opts.reveal || null, end: opts.end };
    if (opts.fresh) Object.assign(memo, { page: 0, firstKey: "" });
    reset(box);
    if (box.matches("#main > .view")) openOut(box);
    if (fits(box)) {
      state.set(box, { page: 0, pages: [[0, 0]], leaves: [], parents: [], end: memo.end });
      return;
    }
    box.setAttribute("data-os-paged", "");
    const st = { page: 0, pages: [], leaves: [], parents: [], end: memo.end || box.matches('[role="log"], .messages, .thread, .chat-log') };
    state.set(box, st);
    drawPager(box, st);
    // (the bar sits at the bottom of the box, with room kept for it under the page)
    if (getComputedStyle(box).position === "static") setStyle(box, "position", "relative");
    const bar = box.querySelector(":scope > .os-pager");
    setStyle(box, "padding-bottom", `${parseFloat(getComputedStyle(box).paddingBottom) + bar.offsetHeight + 6}px`);
    const cs = getComputedStyle(box);
    // (the title row stays on every page, unless it would take more than a fifth of a small screen:
    // then it's on the first page only, and the pages have the room)
    let pins = pinsOf(box);
    let pinned = pins.reduce((h, p) => h + outer(p).bottom - outer(p).top, 0);
    if (pinned > box.clientHeight * 0.22) {
      pins = [];
      pinned = 0;
    }
    const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - pinned - 2;
    partsOf(box, room, pins, st.leaves, st.parents, 0);
    if (!st.leaves.length) return;
    st.room = room;
    st.pos = st.leaves.map(outer);
    st.pages = pack(st.leaves, room, st.pos);
    showPage(box, st, wantedPage(box, st, memo));
    follow(box, st);
  }

  // Check the page showing really fits (paddings and gaps of the boxes around the parts, a grid's rows):
  // if not, its last part moves on to the next page; one part alone is made smaller, or scrolls
  function settle(box, st) {
    const room = st.room;
    st.lastOver = undefined;
    st.scaled = null;
    for (let guard = 0; guard < 60 && !fits(box); guard++) {
      const [s, e] = st.pages[st.pages.length ? st.page : 0];
      if (e - s > 1) {
        const rest = pack(st.leaves.slice(e - 1), room, st.pos.slice(e - 1)).map(([a, b]) => [a + e - 1, b + e - 1]);
        st.pages = [...st.pages.slice(0, st.page), [s, e - 1], ...rest];
        showPage(box, st, st.page);
        continue;
      }
      // One part, still too tall: smaller (never under SMALLEST), else it alone scrolls
      const leaf = st.leaves[s];
      if (leaf.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) break;
      const over = box.scrollHeight - box.clientHeight;
      const h = leaf.getBoundingClientRect().height;
      // (in steps: its margins and the boxes round it shrink with it, so it's looked at again each time;
      // when a step doesn't help, it's drawn smaller instead, keeping its shape)
      const now = parseFloat(leaf.style.zoom) || 1;
      const helped = st.lastOver === undefined || st.lastLeaf !== leaf || over < st.lastOver - 0.5;
      st.lastOver = over;
      st.lastLeaf = leaf;
      if (helped && now > SMALLEST + 0.001 && h > 0) {
        setStyle(leaf, "zoom", String(Math.floor(Math.max(SMALLEST, now * Math.min(0.99, (h - over - 2) / h)) * 1000) / 1000));
        continue;
      }
      // (lengths set on a part that's already smaller are in its own smaller units: divided by its zoom)
      const k0 = st.scaled && st.scaled.leaf === leaf ? st.scaled.k : 1;
      if (k0 > SMALLEST + 0.001 && h > 0) {
        const k = Math.max(SMALLEST, k0 * Math.min(0.995, (h - over - 2) / h));
        const full = h / k0; // its height before any scaling, on screen
        st.scaled = { leaf, k };
        setStyle(leaf, "transform-origin", "top center");
        setStyle(leaf, "transform", `scale(${Math.floor(k * 1000) / 1000})`);
        setStyle(leaf, "margin-bottom", `${-Math.ceil((full * (1 - k)) / now)}px`);
        continue;
      }
      leaf.setAttribute("data-os-last", "");
      setStyle(leaf, "max-height", `${Math.max(60, (h - over - 4) / now)}px`);
      setStyle(leaf, "overflow-y", "auto");
      break;
    }
  }

  // ---- The page bar ----
  function drawPager(box, st) {
    let bar = box.querySelector(":scope > .os-pager");
    if (!bar) {
      bar = document.createElement("nav");
      bar.className = "os-pager";
      bar.setAttribute("data-os-own", "");
      bar.setAttribute("aria-label", "Pages");
      bar.innerHTML = '<button type="button" class="os-prev" aria-label="Previous page">‹</button><span class="os-count" aria-live="polite"></span><button type="button" class="os-next" aria-label="Next page">›</button>';
      bar.querySelector(".os-prev").addEventListener("click", () => turn(box, -1));
      bar.querySelector(".os-next").addEventListener("click", () => turn(box, 1));
      box.append(bar);
    }
    const total = Math.max(1, st.pages.length);
    bar.querySelector(".os-count").textContent = `${st.page + 1} / ${total}`;
    bar.querySelector(".os-prev").disabled = st.page <= 0;
    bar.querySelector(".os-next").disabled = st.page >= total - 1;
    bar.hidden = total <= 1 && st.pages.length > 0;
  }

  function turn(box, by) {
    const st = state.get(box);
    if (!st || !st.pages.length) return false;
    const n = Math.max(0, Math.min(st.pages.length - 1, st.page + by));
    if (n === st.page) return false;
    // (turning on purpose: what was pressed or jumped to before doesn't pull it back)
    touched.at = 0;
    asked.at = 0;
    busy = true;
    showPage(box, st, n);
    // (inner boxes on the new page are laid out too)
    for (const inner of innerBoxes(box)) layout(inner, { fresh: true });
    watch(box);
    if (mo) mo.takeRecords();
    busy = false;
    if (!calm()) {
      box.removeAttribute("data-os-turn");
      void box.offsetWidth;
      box.setAttribute("data-os-turn", by > 0 ? "next" : "prev");
    }
    return true;
  }

  // The page el is on (the part it's in, or the first part inside it), or -1
  function pageOf(st, el) {
    let i = st.leaves.findIndex((l) => l === el || l.contains(el));
    if (i < 0) i = st.leaves.findIndex((l) => el.contains(l));
    return i < 0 ? -1 : st.pages.findIndex(([s, e]) => i >= s && i < e);
  }
  // Fitting a page can move its last part on to the next: if that was what was asked for, follow it
  function follow(box, st) {
    const el = asked.el && Date.now() - asked.at < 8000 && box.contains(asked.el) ? asked.el : null;
    for (let i = 0; el && i < 3 && (el.hasAttribute(OFF) || el.closest(`[${OFF}]`)); i++) {
      const p = pageOf(st, el);
      if (p < 0 || p === st.page) break;
      showPage(box, st, p);
    }
  }

  // ---- Laying out everything on screen (after changes settle) ----
  let timer = 0;
  let lastRun = 0;
  let runs = 0;
  function run(opts = {}) {
    timer = 0;
    runs++;
    busy = true;
    try {
      for (const box of boxes()) {
        layout(box, opts.fresh && opts.fresh.has(box) ? { fresh: true } : {});
        for (const inner of innerBoxes(box)) layout(inner);
        watch(box);
      }
    } catch (err) {
      console.warn("One screen:", err);
    } finally {
      if (mo) mo.takeRecords();
      busy = false;
      lastRun = performance.now();
    }
  }
  const fresh = new Set();
  // (a section that keeps changing, a clock or a timer in it, is cut again at most twice a second)
  function soon(ms = 90) {
    clearTimeout(timer);
    const wait = fresh.size ? ms : Math.max(ms, 500 - (performance.now() - lastRun));
    timer = setTimeout(() => requestAnimationFrame(() => {
      const f = new Set(fresh);
      fresh.clear();
      run({ fresh: f });
    }), wait);
  }

  // What's showing changes size (a card opens, words come in): cut the box again. Each part on screen
  // is watched; its first report after it's watched is only remembered (our own changes don't count).
  const sizes = new WeakMap();
  const watched = new Set();
  const sizeWatch = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
    let any = false;
    for (const en of entries) {
      const h = Math.round(en.contentRect.height), w = Math.round(en.contentRect.width);
      const was = sizes.get(en.target);
      sizes.set(en.target, { h, w });
      if (was && (was.h !== h || was.w !== w) && !busy) any = true;
    }
    if (any) soon();
  }) : null;
  function watch(box) {
    if (!sizeWatch) return;
    for (const el of watched) if (!el.isConnected || box.contains(el)) { sizeWatch.unobserve(el); watched.delete(el); sizes.delete(el); }
    const st = state.get(box);
    const list = st && st.leaves.length ? st.leaves.filter((l) => !l.hasAttribute(OFF)) : [...box.children].filter((c) => !ours(c));
    for (const el of [...list, ...pinsOf(box)]) { sizeWatch.observe(el); watched.add(el); }
  }

  // Turn to the page with this on it (and in any box inside); true if it's now on screen
  function reveal(el) {
    if (!el || !el.closest) return false;
    Object.assign(asked, { el, at: Date.now() });
    let moved = false;
    for (let box = el.closest("[data-os-paged]"); box; box = box.parentElement && box.parentElement.closest("[data-os-paged]")) {
      const st = state.get(box);
      if (!st || !st.leaves.length) continue;
      let i = st.leaves.findIndex((l) => l === el || l.contains(el));
      if (i < 0) i = st.leaves.findIndex((l) => el.contains(l));
      const p = i < 0 ? -1 : st.pages.findIndex(([s, e]) => i >= s && i < e);
      if (p >= 0 && p !== st.page) {
        busy = true;
        showPage(box, st, p);
        follow(box, st);
        watch(box);
        if (mo) mo.takeRecords();
        busy = false;
        moved = true;
      }
    }
    if (mo) mo.takeRecords();
    return moved || !el.closest(`[${OFF}]`);
  }

  // Anything asked to come into view, or to take focus, turns to its page first
  const scrollIntoView = Element.prototype.scrollIntoView;
  // (remembered too, so the page it's on is the one shown when its section is cut into pages again)
  const inBox = (el) => el.closest && el.closest(`#main > .view, ${EXTRA}`);
  Element.prototype.scrollIntoView = function (...args) {
    if (this.closest && this.closest(`[${OFF}]`)) reveal(this);
    else if (inBox(this)) Object.assign(asked, { el: this, at: Date.now() });
    return scrollIntoView.apply(this, args);
  };
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (this.closest && this.closest(`[${OFF}]`)) reveal(this);
    else if (inBox(this) && this !== document.activeElement) Object.assign(asked, { el: this, at: Date.now() });
    return focus.apply(this, args);
  };

  // ---- Turning pages: the wheel, a swipe, the keys ----
  const typing = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  const boxAt = (t) => {
    for (let b = t && t.closest && t.closest("[data-os-paged]"); b; b = b.parentElement && b.parentElement.closest("[data-os-paged]")) {
      const st = state.get(b);
      if (st && st.pages.length > 1) return b;
    }
    return null;
  };
  let wheelAt = 0;
  let wheelSum = 0;
  addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey || typing(e.target)) return;
      const box = boxAt(e.target);
      if (!box) return;
      // (something inside that still scrolls by itself has the wheel first)
      for (let a = e.target; a && a !== box; a = a.parentElement) if (a.scrollHeight > a.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(a).overflowY)) return;
      const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      wheelSum += dy;
      const now = Date.now();
      if (now - wheelAt < 380 || Math.abs(wheelSum) < 40) return;
      wheelAt = now;
      turn(box, wheelSum > 0 ? 1 : -1);
      wheelSum = 0;
    },
    { passive: true }
  );
  // A swipe: with touch events (a pointer can be taken over by the browser part-way and never lifted)
  let swipe = null;
  addEventListener("pointerdown", (e) => {
    const box = e.target.closest && e.target.closest("[data-os-paged]");
    // (what was pressed, not the page bar itself)
    if (box && !ours(e.target)) {
      const k = e.target.closest("[data-key], [id]");
      Object.assign(touched, { el: e.target, key: k && k !== box && box.contains(k) ? keyOf(k) : "", at: Date.now() });
    }
  }, true);
  addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    swipe = e.touches.length === 1 && !typing(e.target) && boxAt(e.target) ? { x: t.clientX, y: t.clientY, t: Date.now(), box: boxAt(e.target) } : null;
  }, { passive: true, capture: true });
  addEventListener("touchend", (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const { box, x, y, t: at } = swipe;
    swipe = null;
    if (!t || Date.now() - at > 1500) return;
    const dx = t.clientX - x, dy = t.clientY - y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) turn(box, dx < 0 ? 1 : -1);
    else if (Math.abs(dy) > 70 && Math.abs(dy) > Math.abs(dx) * 1.4) turn(box, dy < 0 ? 1 : -1);
  }, { passive: true, capture: true });
  addEventListener("touchcancel", () => { swipe = null; }, { passive: true, capture: true });
  addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    if (!/^(PageDown|PageUp|ArrowRight|ArrowLeft)$/.test(e.key)) return;
    // (arrows that move between tabs or chips are theirs)
    if (/Arrow/.test(e.key) && e.target.closest && e.target.closest('[role="tablist"], [role="radiogroup"], [role="toolbar"], .chips, .pillars')) return;
    const box = boxAt(e.target !== document.body ? e.target : null) || boxes().map((b) => (state.get(b)?.pages.length > 1 ? b : null)).find(Boolean);
    if (box && turn(box, /PageDown|ArrowRight/.test(e.key) ? 1 : -1)) e.preventDefault();
  });

  // ---- Watching for changes ----
  let mo = null;
  function start() {
    mo = new MutationObserver((records) => {
      if (busy) return;
      let any = false;
      // (only changes in what's on screen count: a section redrawing out of sight doesn't)
      const live = boxes();
      for (const r of records) {
        if (ours(r.target)) continue;
        const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const toggled = r.type === "attributes" && r.attributeName === "hidden" && t && t.matches && t.matches("#main > .view, .sheet, .pillar-drawer");
        if (!toggled && !live.some((b) => b.contains(t))) continue;
        if (r.type === "attributes" && r.attributeName === "hidden" && r.target.matches && r.target.matches("#main > .view, .sheet") && !r.target.hidden) {
          fresh.add(r.target.matches(".sheet") ? r.target.querySelector(".sheet-card") : r.target);
        }
        any = true;
      }
      if (any) soon();
    });
    // (what's added or taken away, and parts shown or hidden; a part changing size is the size watch's)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open"] });
    const ro = new ResizeObserver(() => !busy && soon(60));
    ro.observe(document.documentElement);
    const main = document.getElementById("main");
    if (main) ro.observe(main);
    soon(200);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => soon(60));
  }

  window.NovaOneScreen = {
    // Lay out now (tests and the Fixer use this)
    now() { clearTimeout(timer); run(); return this; },
    reveal,
    turn,
    // Lay out this box too (a page that isn't a Portal section: an Admin page inside its frame)
    adopt(el) { if (el) { adopted.add(el); soon(30); } return this; },
    // What it was last asked to show and last saw pressed (for checking)
    get last() { return { asked: asked.el, askedAt: asked.at, touched: touched.el, touchedAt: touched.at }; },
    // How many times it has laid out (to check it's quiet when nothing changes)
    get runs() { return runs; },
    // Where a box is: { page, pages } (pages 1 = it fits)
    where(box) { const st = state.get(box); return st ? { page: st.page, pages: Math.max(1, st.pages.length) } : null; },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
