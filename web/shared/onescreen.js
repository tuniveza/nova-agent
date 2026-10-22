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
//
// Every panel (22 Oct 2026, the user: "complete page navigation across the entire nova-suite", the page bar
// everywhere): /shared/fit.js brings this into every panel. Outside Portal there are no sections, so the
// boxes are found: anything that would scroll (a list, a guide, a card's body, a chat) is paged instead,
// its height held while it's in pages. What you write in is never paged (a box that is mostly an editor or
// a big writing box is left as it is), and a box opts out with data-os-skip.
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
  // A page with room left over takes the next row too, drawn a little smaller (never under this), so
  // the box is full before the next page (22 Oct 2026, the user, on Alerts: "the area needs to be fully
  // filled up before it decides to go to the next group")
  const FILL = 0.75;
  const embed = () => document.documentElement.classList.contains("embed");
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = new WeakMap(); // box -> { page, pages, leaves, parents, pager, key }
  const touched = { key: "", el: null, at: 0 }; // what was last pressed in a box
  const asked = { el: null, at: 0 }; // what was last asked to come into view (it wins over everything for 8 s: a section may finish loading after the jump)
  const changed = new Map(); // elements whose style we changed (zoom, max-height…) -> what each property was, to put back
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
  // (put back one property at a time: the live site's security rules block rewriting a style attribute,
  // which once left zoom and padding piling up on anything with a style of its own, like a pane's colour)
  function setStyle(el, prop, value) {
    let was = changed.get(el);
    if (!was) changed.set(el, (was = new Map()));
    if (!was.has(prop)) was.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value);
  }
  function putBackStyles(within) {
    for (const [el, was] of [...changed]) {
      if (within && !within.contains(el)) continue;
      if (el.isConnected) for (const [prop, [value, priority]] of was) value ? el.style.setProperty(prop, value, priority) : el.style.removeProperty(prop);
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
    for (const b of found) if (b.isConnected && shown(b) && !list.some((x) => x.contains(b))) list.push(b);
    return list.filter((b) => !b.hasAttribute("data-os-skip"));
  }
  // ---- Outside Portal: the boxes that would scroll, found (the outermost of each; boxes inside them are
  // innerBoxes'), looked for at most once a second ----
  const portalPage = () => !!document.querySelector("#main > .view");
  const found = new Set();
  const TYPING = 'textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"], .cm-editor, .ProseMirror';
  const NOT_BOX = 'textarea, select, input, iframe, svg, canvas, [data-os-skip], [data-os-own], .os-pager';
  let lastLook = 0;
  let lookAgain = 0;
  // (new boxes only: looked for a moment after things are added, laid out only if one was found)
  let looking = 0;
  function lookSoon() {
    clearTimeout(looking);
    looking = setTimeout(() => {
      if (document.hidden) return;
      const had = new Set(found);
      lastLook = 0;
      discover();
      const added = [...found].filter((b) => !had.has(b));
      if (added.length) soon(30, "new box " + added.map(nm).join(", "));
    }, 400);
  }
  function discover() {
    for (const b of [...found]) if (!b.isConnected) found.delete(b);
    if (portalPage()) return;
    // (looked less than a second ago: look again once the second is up, so nothing drawn meanwhile is missed)
    const since = performance.now() - lastLook;
    if (since < 900) {
      // (only a look, laying out only if it finds a new box: a whole layout here hit this same wait and
      // asked again, a layout about every second for ever on every panel, 22 Oct 2026)
      clearTimeout(lookAgain);
      lookAgain = setTimeout(lookSoon, 920 - since);
      return;
    }
    lastLook = performance.now();
    for (const el of document.body.querySelectorAll("*")) {
      if (found.has(el) || el.hasAttribute(OFF) || el.hasAttribute("data-os-last") || el.closest(NOT_BOX)) continue;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY) || el.clientHeight < 48 || el.clientWidth < 120) continue;
      if (el.scrollHeight <= el.clientHeight + 2 || !shown(el)) continue;
      if ([...found].some((f) => f.contains(el) || el.contains(f))) continue;
      // (an editor or a big writing box isn't paged; a small box to type in, among other things, is fine)
      if (el.matches(TYPING) || [...el.querySelectorAll(TYPING)].some((t) => t.getBoundingClientRect().height > el.clientHeight * 0.45)) continue;
      found.add(el);
    }
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
  // The parts, in order: a part goes in whole unless it alone is taller than a page and has parts of its own.
  // In a small box (under 300px of page), a list of rows taller than a third of a page is cut between its rows
  // too, so it starts on the page it's on instead of leaving that page half empty (22 Oct 2026: a phone's
  // Inbox panes; a bigger box keeps a list whole and draws the page a little smaller to fit it instead)
  const ROWS = '.list, ul, ol, [role="list"]';
  function partsOf(container, room, pins, out, parents, depth) {
    for (const c of container.children) {
      if (pins.includes(c) || ours(c) || !shown(c) || floating(c)) continue;
      const h = c.getBoundingClientRect().height;
      if (h < 1) continue;
      const kids = [...c.children].filter((k) => shown(k) && !floating(k) && !ours(k));
      const rows = room < 300 && kids.length >= 2 && h > room / 3 && c.matches(ROWS);
      if ((h > room || rows) && depth < 8 && !c.matches(KEEP) && kids.length >= 1) {
        parents.push(c);
        partsOf(c, room, pins, out, parents, depth + 1);
      } else out.push(c);
    }
  }
  // pos: each part's place, measured once with everything showing (hidden parts measure nothing).
  // A page is [first, end, size]: size under 1 when it's drawn smaller to take the next row too.
  function pack(leaves, room, pos, fill) {
    const pages = [];
    let s = 0;
    while (s < leaves.length) {
      let e = s + 1;
      let bottom = pos[s].bottom;
      while (e < leaves.length && Math.max(bottom, pos[e].bottom) - pos[s].top <= room) bottom = Math.max(bottom, pos[e++].bottom);
      // (a heading isn't left at the foot of a page with what it heads on the next)
      if (e < leaves.length && e - s > 1 && leaves[e - 1].matches(HEADING)) {
        e--;
        bottom = Math.max(...pos.slice(s, e).map((p) => p.bottom));
      }
      // Room left over: the next part and any beside it (a row of cards), all a little smaller
      let size = 1;
      if (fill && e < leaves.length && room - (bottom - pos[s].top) > room * 0.08 && !leaves[e].matches("tr")) {
        let f = e + 1;
        let b = pos[e].bottom;
        while (f < leaves.length && Math.abs(pos[f].top - pos[e].top) < 2) b = Math.max(b, pos[f++].bottom);
        const k = Math.floor(((room - 4) / (Math.max(bottom, b) - pos[s].top)) * 1000) / 1000;
        if (k >= FILL && !(f < leaves.length && leaves[f - 1].matches(HEADING))) {
          e = f;
          size = Math.min(0.99, k);
        }
      }
      pages.push([s, e, size]);
      s = e;
    }
    return pages;
  }
  // Each part on a page drawn at the page's size (one drawn smaller for an earlier page is put back)
  function sizePage(st, n) {
    const [s, e, size = 1] = st.pages[n];
    for (let i = s; i < e; i++) {
      const leaf = st.leaves[i];
      if (size < 1) {
        setStyle(leaf, "zoom", String(size));
        leaf.setAttribute("data-os-fill", "");
      } else if (leaf.hasAttribute("data-os-fill")) {
        leaf.style.removeProperty("zoom");
        leaf.removeAttribute("data-os-fill");
      }
    }
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
    sizePage(st, n);
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
    for (const el of box.querySelectorAll("[data-os-last], [data-os-fill]")) el.removeAttribute("data-os-last"), el.removeAttribute("data-os-fill");
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
    // (a found box keeps the height it has with everything in it, so taking parts out doesn't shrink it)
    if (found.has(box)) {
      setStyle(box, "height", `${box.getBoundingClientRect().height}px`);
      setStyle(box, "box-sizing", "border-box");
    }
    box.setAttribute("data-os-paged", "");
    const st = { page: 0, pages: [], leaves: [], parents: [], end: memo.end || box.matches('[role="log"], .messages, .thread, .chat-log') };
    state.set(box, st);
    drawPager(box, st);
    // (the bar sits at the bottom of the box, with room kept for it under the page)
    if (getComputedStyle(box).position === "static") setStyle(box, "position", "relative");
    const bar = box.querySelector(":scope > .os-pager");
    // (on a short screen, a phone on its side, the bar stands at the right instead: the height is the
    // pages')
    // (a box whose bar is in its title row, like Inbox's panes, keeps no room for it under the page)
    const inHead = box.matches("#main.inbox-all > .view");
    const side = !inHead && innerHeight <= 500 && box.clientWidth >= 420;
    bar.classList.toggle("os-side", side);
    if (side) setStyle(box, "padding-right", `${parseFloat(getComputedStyle(box).paddingRight) + bar.offsetWidth + 6}px`);
    else if (!inHead) setStyle(box, "padding-bottom", `${parseFloat(getComputedStyle(box).paddingBottom) + bar.offsetHeight + 6}px`);
    const cs = getComputedStyle(box);
    // (the title row stays on every page, unless it would take more than a fifth of a small screen:
    // then it's on the first page only, and the pages have the room)
    let pins = pinsOf(box);
    let pinned = pins.reduce((h, p) => h + outer(p).bottom - outer(p).top, 0);
    // (a found box in a panel keeps its pins up to half its height: what's under them is often
    // made to fill what's left, so with them unpinned it no longer fit beside them and the first page held
    // only the pins, Observatory's header and search, 22 Oct 2026)
    if (pinned > box.clientHeight * (found.has(box) ? 0.5 : 0.22)) {
      pins = [];
      pinned = 0;
    }
    const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - pinned - 2;
    partsOf(box, room, pins, st.leaves, st.parents, 0);
    if (!st.leaves.length) return;
    st.room = room;
    st.pos = st.leaves.map(outer);
    // (sections and Admin pages are filled; a drawer or a sheet's form keeps its size)
    // (nor a box with parts that fit themselves to their size, a Calendar day's cards: drawing them smaller
    // undid that)
    st.fill = !box.matches(EXTRA) && !box.querySelector('[data-guard="off"], [data-os-skip]');
    st.pages = pack(st.leaves, room, st.pos, st.fill);
    showPage(box, st, wantedPage(box, st, memo));
    follow(box, st);
  }

  // Check the page showing really fits (paddings and gaps of the boxes around the parts, a grid's rows):
  // if not, its last part moves on to the next page; one part alone is made smaller, or scrolls
  function settle(box, st) {
    const room = st.room;
    st.lastOver = undefined;
    st.scaled = null;
    st.refilled = false;
    st.long = null;
    for (let guard = 0; guard < 60 && !fits(box); guard++) {
      const [s, e, size = 1] = st.pages[st.pages.length ? st.page : 0];
      // (a page drawn smaller to be full: a little smaller again first, then without its last row)
      if (size < 1) {
        const over = box.scrollHeight - box.clientHeight;
        const k = Math.floor(size * (1 - (over + 3) / Math.max(1, room)) * 1000) / 1000;
        if (k >= FILL - 0.03 && !st.refilled) {
          st.pages[st.page] = [s, e, k];
          st.refilled = true;
          showPage(box, st, st.page);
          continue;
        }
      }
      if (e - s > 1) {
        const rest = pack(st.leaves.slice(e - 1), room, st.pos.slice(e - 1), st.fill).map(([a, b, k]) => [a + e - 1, b + e - 1, k]);
        st.pages = [...st.pages.slice(0, st.page), [s, e - 1, 1], ...rest];
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
      // (words that wouldn't fit even at the smallest aren't made smaller at all: they keep their size and
      // is gone through a screenful at a time, below)
      const k1 = st.scaled && st.scaled.leaf === leaf ? st.scaled.k : 1;
      // (only words: a month, a form or a list of buttons is made smaller instead, as far as it takes)
      const words = leaf.matches("p, pre, blockquote, dd, .details, .cp-plain") || !leaf.querySelector("button, a, input, select, textarea, svg, img, canvas, video, table, [role=grid]");
      if (words && st.long !== leaf && h > 0 && now * k1 * ((h - over - 2) / h) < SMALLEST) {
        st.long = leaf;
        if (now !== 1 || k1 !== 1) {
          for (const prop of ["zoom", "transform", "transform-origin", "margin-bottom"]) leaf.style.removeProperty(prop);
          st.scaled = null;
          continue;
        }
      }
      const helped = st.lastOver === undefined || st.lastLeaf !== leaf || over < st.lastOver - 0.5;
      st.lastOver = over;
      st.lastLeaf = leaf;
      if (st.long !== leaf && helped && now > SMALLEST + 0.001 && h > 0) {
        setStyle(leaf, "zoom", String(Math.floor(Math.max(SMALLEST, now * Math.min(0.99, (h - over - 2) / h)) * 1000) / 1000));
        continue;
      }
      // (lengths set on a part that's already smaller are in its own smaller units: divided by its zoom)
      const k0 = st.scaled && st.scaled.leaf === leaf ? st.scaled.k : 1;
      if (st.long !== leaf && k0 > SMALLEST + 0.001 && h > 0) {
        const k = Math.max(SMALLEST, k0 * Math.min(0.995, (h - over - 2) / h));
        const full = h / k0; // its height before any scaling, on screen
        st.scaled = { leaf, k };
        setStyle(leaf, "transform-origin", "top center");
        setStyle(leaf, "transform", `scale(${Math.floor(k * 1000) / 1000})`);
        setStyle(leaf, "margin-bottom", `${-Math.ceil((full * (1 - k)) / now)}px`);
        continue;
      }
      // (still too tall, one long email's words: it shows as much as fits, in whole lines, and turning
      // the page moves on through it first; nothing scrolls)
      const cs = getComputedStyle(leaf);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 || 20;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const lines = Math.max(2, Math.floor(((h - over - 4) / now - pad) / line));
      leaf.setAttribute("data-os-last", "");
      setStyle(leaf, "max-height", `${Math.round(lines * line + pad)}px`);
      setStyle(leaf, "overflow", "hidden");
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
    const long = longPart(box);
    const more = long && long.scrollTop + long.clientHeight < long.scrollHeight - 1;
    bar.querySelector(".os-prev").disabled = st.page <= 0 && !(long && long.scrollTop > 0);
    bar.querySelector(".os-next").disabled = st.page >= total - 1 && !more;
    bar.hidden = total <= 1 && st.pages.length > 0 && !long;
  }

  // A part too long for any page on the page showing (one long email's words), or null
  const longPart = (box) => [...box.querySelectorAll("[data-os-last]")].find((el) => !el.closest(`[${OFF}]`) && el.closest("[data-os-paged]") === box) || null;
  // How far one step through it goes: what shows, in whole lines
  function stepOf(el) {
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 || 20;
    return Math.max(line, Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / line) * line);
  }
  function turn(box, by) {
    const st = state.get(box);
    if (!st || !st.pages.length) return false;
    // (a long part on this page is gone through first, a screenful of lines at a time)
    const long = longPart(box);
    if (long && (by > 0 ? long.scrollTop + long.clientHeight < long.scrollHeight - 1 : long.scrollTop > 0)) {
      long.scrollTop += by * stepOf(long);
      drawPager(box, st);
      return true;
    }
    const n = Math.max(0, Math.min(st.pages.length - 1, st.page + by));
    if (n === st.page) return false;
    // (turning on purpose: what was pressed or jumped to before doesn't pull it back)
    touched.at = 0;
    asked.at = 0;
    busy = true;
    showPage(box, st, n);
    // (inner boxes on the new page are laid out too)
    for (const inner of innerBoxes(box)) layout(inner, { fresh: true });
    // (going back into a long part starts at its end)
    const back = by < 0 && longPart(box);
    if (back) back.scrollTop = back.scrollHeight;
    drawPager(box, st);
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
  let skipped = false;
  // ---- The last line of defence: nothing cut, nothing off the screen (22 Oct 2026, the user: "I don't want it
  // cut at any size of the screen at any point"; desktops, laptops and phones of every size, either way up) ----
  // After each layout: anything that means something (a button, a link, words, a picture) cut off by the box
  // it's in, or past the edge of the screen, is found the way the Fixer finds it (src/fixer/strict.ts), and
  // the part of the smallest box around it that does fit is drawn smaller (zoom, down to half) until it all
  // shows. Put back and looked at again on every layout, so things grow back when there's room.
  const MEANS = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|IMG|SVG|VIDEO|CANVAS|IFRAME|LABEL|H[1-6]|P|LI|TD|TH|SUMMARY)$/;
  // (a part that fits itself, a Calendar day's card, says data-guard="off": two fitters on one part fight)
  const IGNORE = '[aria-hidden="true"], [inert], template, noscript, script, style, [data-os-own], [data-guard="off"]';
  const BAR_SLIDE = ".tabbar, .dock, .topbar, .status-line";
  const guarded = new Map(); // element -> its own zoom before
  const hasWords = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  // Where el is cut: { by: the box cutting it (null: the screen's edge), x, y: how far it sticks out }
  // (what a box's overflow and size are, read once per pass: every part asked about every box round it)
  let boxCache = new Map();
  const boxOf = (a) => {
    let v = boxCache.get(a);
    if (!v) {
      const cs = getComputedStyle(a);
      v = { ox: cs.overflowX, oy: cs.overflowY, r: cs.overflowX === "visible" && cs.overflowY === "visible" ? null : a.getBoundingClientRect() };
      boxCache.set(a, v);
    }
    return v;
  };
  function cutOf(el) {
    const r = el.getBoundingClientRect();
    let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const b = boxOf(a);
      const cs = { overflowX: b.ox, overflowY: b.oy };
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const ar = b.r;
      if (ar.width <= 2 && ar.height <= 2) return null; // (words for screen readers only)
      const sx = /(auto|scroll|overlay)/.test(cs.overflowX) && !a.matches(BAR_SLIDE);
      const sy = /(auto|scroll|overlay)/.test(cs.overflowY);
      if (!sx && (left < ar.left - 1 || right > ar.right + 1)) return { by: a, r };
      if (!sy && (top < ar.top - 1 || bottom > ar.bottom + 1)) return { by: a, r };
      left = Math.max(left, ar.left); right = Math.min(right, ar.right);
      top = Math.max(top, ar.top); bottom = Math.min(bottom, ar.bottom);
      if (right <= left || bottom <= top) return null; // (scrolled out of sight inside a box: it can be scrolled to)
    }
    const se = document.scrollingElement || document.documentElement;
    const pageX = se.scrollWidth > se.clientWidth + 1, pageY = se.scrollHeight > se.clientHeight + 1;
    if (left < -1 || top < -1 || (!pageX && right > innerWidth + 1) || (!pageY && bottom > innerHeight + 1)) return { by: null, r };
    return null;
  }
  // ---- Centred, or to one side: the layout too, not just the words (22 Oct 2026, the user: "make as much of
  // gui you can be centered properly including text … I don't like left sided and or right sided only; they
  // should be options"). html[data-align] is center (the default), left or right (look.js, from Options).
  // Centred or right: a row of things pushed to its start with room to spare (buttons, chips, cards on a
  // grid of fixed-width columns) moves to the middle or the end, and so does a box narrower than the space
  // it's in. What fills its row, or is spread to both ends on purpose, is left alone, as are what you
  // write in, code and terminals; data-align-off keeps a part as it is. Put back and looked at again on
  // every layout, like the guard. ----
  const ALIGN_SKIP = 'pre, code, textarea, input, select, [contenteditable=""], [contenteditable="true"], .cm-editor, .ProseMirror, .xterm, canvas, svg, [data-align-off], [data-os-own], [aria-hidden="true"]';
  const aligned = new Map(); // element -> { prop: [value, priority] }
  function unalign() {
    for (const [el, was] of aligned) if (el.isConnected) for (const [prop, [v, pr]] of Object.entries(was)) (v ? el.style.setProperty(prop, v, pr) : el.style.removeProperty(prop));
    aligned.clear();
  }
  function setAligned(el, prop, value) {
    let was = aligned.get(el);
    if (!was) aligned.set(el, (was = {}));
    if (!(prop in was)) was[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.style.setProperty(prop, value);
  }
  function align() {
    const mode = document.documentElement.getAttribute("data-align");
    if (mode !== "center" && mode !== "right") return;
    const flexEnd = mode === "center" ? "center" : "flex-end";
    const START = /^(normal|flex-start|start|left)$/;
    for (const el of document.body.querySelectorAll("*")) {
      if (el.closest(ALIGN_SKIP) || !el.firstElementChild) continue;
      const cs = getComputedStyle(el);
      const flex = cs.display === "flex" || cs.display === "inline-flex";
      const grid = cs.display === "grid" || cs.display === "inline-grid";
      if (!flex && !grid && cs.display !== "block") continue;
      if (!shown(el)) continue;
      const kids = [...el.children].filter((k) => { const s = getComputedStyle(k); return s.display !== "none" && s.position !== "absolute" && s.position !== "fixed" && !ours(k); });
      if (!kids.length) continue;
      const r = el.getBoundingClientRect();
      const inner = { left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight) };
      if (inner.right - inner.left < 40) continue;
      if (flex && !cs.flexDirection.startsWith("column")) {
        // a row: centred when what's on it starts at its start and leaves room at its end
        if (!START.test(cs.justifyContent)) continue;
        const left = Math.min(...kids.map((k) => k.getBoundingClientRect().left)), right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        if (left - inner.left > 4 || inner.right - right < 12) continue;
        setAligned(el, "justify-content", flexEnd);
      } else if (grid) {
        // columns of a fixed width that don't fill it: the columns centred
        if (!START.test(cs.justifyContent) || cs.gridTemplateColumns === "none") continue;
        const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        if (inner.right - right >= 12) { setAligned(el, "justify-content", mode === "center" ? "center" : "end"); continue; }
        // a grid that fills its width with a last row only part full (two tiles under four): that row
        // moved along to the middle, or the end (drawn there; nothing else moves)
        // (only a run of like tiles: no named areas, nothing placed by hand, every tile about the same width,
        // every row but the last full. A grid that lays out a page, a month under its weekday names, a plan
        // beside it, a week's hours, is left alone: moving one of its parts pulled it out of line, 22 Oct 2026)
        if (cs.gridTemplateAreas !== "none" || el.matches('[role="grid"], [role="table"], table, [role="row"]')) continue;
        const ws = kids.map((k) => k.getBoundingClientRect().width);
        if (Math.max(...ws) - Math.min(...ws) > 2) continue;
        if (kids.some((k) => { const ks = getComputedStyle(k); return ks.gridColumnStart !== "auto" || ks.gridRowStart !== "auto" || ks.gridColumnEnd !== "auto" || ks.gridRowEnd !== "auto"; })) continue;
        const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).length;
        const rows = new Map();
        for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top); rows.set(t, [...(rows.get(t) || []), k]); }
        if (rows.size < 2 || cols < 2) continue;
        const tops = [...rows.keys()].sort((a, b) => a - b);
        const first = rows.get(tops[0]), last = rows.get(tops[tops.length - 1]);
        if (tops.slice(0, -1).some((t) => rows.get(t).length !== cols)) continue;
        if (last.length >= first.length || last.some((k) => getComputedStyle(k).translate !== "none")) continue;
        const end = Math.max(...last.map((k) => k.getBoundingClientRect().right));
        const room = Math.max(...first.map((k) => k.getBoundingClientRect().right)) - end;
        if (room < 12) continue;
        for (const k of last) setAligned(k, "translate", `${Math.round(mode === "center" ? room / 2 : room)}px 0`);
      } else if (cs.display === "block") {
        // a box narrower than the space it's in, sat at its start: in the middle (or at the end)
        for (const k of kids) {
          const ks = getComputedStyle(k);
          if (ks.display !== "block" && ks.display !== "flex" && ks.display !== "grid" && ks.display !== "table") continue;
          if (ks.float !== "none" || ks.position !== "static" || k.closest(ALIGN_SKIP)) continue;
          const b = k.getBoundingClientRect();
          if (b.width < 24 || inner.right - b.right < 12 || b.left - inner.left > 2) continue;
          if (parseFloat(ks.marginLeft) > 0.5 || (ks.marginRight !== "0px" && ks.marginRight !== "auto")) continue;
          if (mode === "center") { setAligned(k, "margin-left", "auto"); setAligned(k, "margin-right", "auto"); }
          else setAligned(k, "margin-left", "auto");
        }
      }
    }
  }
  // (put back before anything is measured, at the start of each layout: put back only at the guard's turn,
  // the boxes were measured with last time's shrinking one time and without it the next, and the sizes
  // went back and forth for ever)
  function unguard() {
    for (const [el, [v, pr]] of guarded) if (el.isConnected) (v ? el.style.setProperty("zoom", v, pr) : el.style.removeProperty("zoom"));
    guarded.clear();
  }
  function guard() {
    boxCache = new Map();
    // (first, nothing slides sideways: a big box, or the page, whose insides are wider than it has them
    // drawn smaller to its width; a row of things meant to slide, data-pan, is left as it is)
    const tooWide = () => [document.body, ...document.body.querySelectorAll("*")].filter((el) => {
      if (el.closest(IGNORE) || el.closest("[data-pan]") || el.scrollWidth <= el.clientWidth + 1) return false;
      if (el !== document.body && (el.clientHeight < innerHeight * 0.4 || !/(auto|scroll|overlay|hidden|clip)/.test(getComputedStyle(el).overflowX))) return false;
      return shown(el);
    });
    for (let pass = 0; pass < 4; pass++) {
     const wide = tooWide();
     if (!wide.length) break;
     for (const el of wide) {
      const k = el.clientWidth / el.scrollWidth;
      const edge = el.getBoundingClientRect().left + el.clientWidth + 1;
      for (const c of el.children) {
        // (the parts that reach past it, or that are wider inside than they look)
        if (!shown(c) || ours(c) || (c.getBoundingClientRect().right <= edge && c.scrollWidth <= c.clientWidth + 1)) continue;
        const was = parseFloat(getComputedStyle(c).zoom) || 1;
        const z = Math.max(0.5, Math.floor(k * was * 1000) / 1000);
        if (z >= was - 0.001) continue;
        if (!guarded.has(c)) guarded.set(c, [c.style.getPropertyValue("zoom"), c.style.getPropertyPriority("zoom")]);
        c.style.setProperty("zoom", String(z));
      }
     }
    }
    for (let pass = 0; pass < 3; pass++) {
      boxCache = new Map(); // (each pass reads afresh: the last one may have drawn things smaller)
      let fixed = 0;
      const done = new Set();
      for (const el of document.body.querySelectorAll("*")) {
        const tag = el.tagName.toUpperCase();
        if (el.closest("svg") && tag !== "SVG") continue;
        if (!(MEANS.test(tag) || el.getAttribute("role") || hasWords(el)) || el.closest(IGNORE) || !shown(el)) continue;
        if ([...done].some((d) => d.contains(el))) continue;
        const cut = cutOf(el);
        if (!cut) continue;
        // What to draw smaller: inside a box that cuts it, everything in that box together (what's before
        // it takes the room too), by how much more there is than the box shows; past the screen's edge, the
        // smallest part around it that starts on the screen, until its far edge comes inside.
        const zoomOf = (el) => parseFloat(getComputedStyle(el).zoom) || 1;
        const shrink = (part, k) => {
          const was = zoomOf(part);
          const z = Math.max(0.5, Math.floor(k * was * 1000) / 1000);
          if (z >= was - 0.001) return false;
          if (!guarded.has(part)) guarded.set(part, [part.style.getPropertyValue("zoom"), part.style.getPropertyPriority("zoom")]);
          part.style.setProperty("zoom", String(z));
          done.add(part);
          return true;
        };
        let changed = false;
        if (cut.by) {
          const B = cut.by;
          const k = Math.min(B.clientWidth / Math.max(1, B.scrollWidth), B.clientHeight / Math.max(1, B.scrollHeight), 1);
          const kids = [...B.children].filter((c) => shown(c) && !ours(c));
          if (k < 0.999) for (const c of kids) changed = shrink(c, k) || changed;
          // (it overflows only a little, or by being too wide in itself: the part with it in, by its own reach)
          if (!changed) {
            let part = el;
            while (part.parentElement && part.parentElement !== B) part = part.parentElement;
            const b = B.getBoundingClientRect(), p = part.getBoundingClientRect();
            const kx = cut.r.right > b.right + 1 ? (b.right - p.left) / Math.max(1, Math.max(p.right, cut.r.right) - p.left) : 1;
            const ky = cut.r.bottom > b.bottom + 1 ? (b.bottom - p.top) / Math.max(1, Math.max(p.bottom, cut.r.bottom) - p.top) : 1;
            if (p.left < b.right && p.top < b.bottom) changed = shrink(part, Math.min(kx, ky, 0.97));
          }
        } else {
          let A = el.parentElement;
          while (A && A !== document.body) {
            const a = A.getBoundingClientRect();
            if (a.top >= -1 && a.left >= -1 && a.top < innerHeight - 8 && a.left < innerWidth - 8) break;
            A = A.parentElement;
          }
          if (A === document.body || !A) A = [...document.body.children].find((c) => c.contains(el));
          if (A) {
            const a = A.getBoundingClientRect();
            // (how far it reaches either way: a box centred in the screen and taller than it sticks out
            // above as much as below, and all of that has to come in)
            const near = { left: Math.min(Math.max(0, a.left), cut.r.left), top: Math.min(Math.max(0, a.top), cut.r.top) };
            const far = { right: Math.max(a.right, cut.r.right), bottom: Math.max(a.bottom, cut.r.bottom, A.scrollHeight + a.top) };
            const kx = far.right > innerWidth + 1 || near.left < -1 ? innerWidth / Math.max(1, far.right - Math.min(0, near.left) - Math.max(0, near.left)) : 1;
            const ky = far.bottom > innerHeight + 1 || near.top < -1 ? innerHeight / Math.max(1, far.bottom - Math.min(0, near.top) - Math.max(0, near.top)) : 1;
            changed = shrink(A, Math.min(kx, ky, 0.97));
          }
        }
        if (!changed) continue;
        fixed++;
      }
      if (!fixed) break;
    }
  }

  function run(opts = {}) {
    timer = 0;
    // (out of sight, Portal in the background behind another panel: cut again once it's back)
    if (document.hidden) { skipped = true; return; }
    runs++;
    busy = true;
    try {
      unguard();
      unalign();
      align();
      discover();
      const list = boxes();
      // (every box put back first, then each laid out: laid out one at a time, each was measured beside
      // the others as the last run left them, two side by side paged each other in turn for ever, Notes'
      // list and guide, ns-df measured it, 22 Oct 2026)
      for (const box of list) reset(box);
      for (const box of list) {
        layout(box, opts.fresh && opts.fresh.has(box) ? { fresh: true } : {});
        for (const inner of innerBoxes(box)) layout(inner);
        watch(box);
      }
      guard();
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
  // (why each layout was asked for, the last 30, for checking: NovaOneScreen.why)
  const why = [];
  const nm = (e) => (e && e.tagName ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList && e.classList[0] ? "." + e.classList[0] : "") : String(e));
  function soon(ms = 90, reason = "") {
    if (reason) { why.push(`${Math.round(performance.now())} ${reason}`); if (why.length > 30) why.shift(); }
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
      if (was && (was.h !== h || was.w !== w) && !busy) { if (!any) any = `size ${nm(en.target)} ${was.w}x${was.h}→${w}x${h}`; }
    }
    if (any) soon(90, any);
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
        // (outside Portal, parts added outside its boxes may be a new box that would scroll: that's only
        // looked for, and laid out if it's new; laying everything out again for it set a panel's own
        // fitting going round and round with this, the Calendar's day cards, 22 Oct 2026)
        if (!toggled && !live.some((b) => b.contains(t))) {
          if (!portalPage() && r.type === "childList" && [...r.addedNodes].some((n) => n.nodeType === 1 && !ours(n))) lookSoon();
          continue;
        }
        if (r.type === "attributes" && r.attributeName === "hidden" && r.target.matches && r.target.matches("#main > .view, .sheet") && !r.target.hidden) {
          fresh.add(r.target.matches(".sheet") ? r.target.querySelector(".sheet-card") : r.target);
        }
        if (!any) any = `${r.type} ${r.attributeName || ""} on ${nm(t)}`;
      }
      if (any) soon(90, "change " + any);
    });
    // (what's added or taken away, and parts shown or hidden; a part changing size is the size watch's)
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "open"] });
    const ro = new ResizeObserver(() => !busy && soon(60, "page resized"));
    ro.observe(document.documentElement);
    const main = document.getElementById("main");
    if (main) ro.observe(main);
    soon(200);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => soon(60));
    document.addEventListener("visibilitychange", () => { if (!document.hidden && skipped) { skipped = false; soon(30); } });
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
    get why() { return why.slice(); },
    // Where a box is: { page, pages } (pages 1 = it fits)
    where(box) { const st = state.get(box); return st ? { page: st.page, pages: Math.max(1, st.pages.length) } : null; },
    // How a box was cut (for checking): its room, each part's name and height, and each page's parts
    parts(box) {
      const st = state.get(box);
      if (!st) return null;
      const nm = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.classList[0] ? "." + e.classList[0] : "");
      return { room: st.room, pins: pinsOf(box).map(nm), leaves: st.leaves.map((l, i) => `${i}:${nm(l)}:${st.pos && st.pos[i] ? Math.round(st.pos[i].bottom - st.pos[i].top) : "?"}`), pages: st.pages.map(([a, b, k]) => `${a}-${b - 1}${k && k < 1 ? "@" + k : ""}`) };
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
