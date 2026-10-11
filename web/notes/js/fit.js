/* Notes — fit.js: the page always fits the screen, and only what's written on it moves.
   The whole Notes window is as tall as the part of the screen you can actually see: when a phone's
   keyboard comes up (over Notes, or over Nova Agent around it), Notes shrinks to the space above
   it, so the bars stay on top and the line you're typing on stays in view inside the page.
   Nothing else ever scrolls: if the browser nudges the window itself (it does that to show a
   field), it's put straight back. */
(() => {
  'use strict';
  const root = document.documentElement;
  const page = document.getElementById('editor');
  if (!page) return;

  // How much of this window is on screen, top to bottom
  function visible() {
    let h = innerHeight;
    const own = window.visualViewport;
    if (own && own.height > 0) h = Math.min(h, own.height);
    try {
      // Inside Nova Agent's frame: the keyboard covers Nova Agent's window, not ours
      const frame = window.frameElement;
      const top = window.parent && window.parent.visualViewport;
      if (frame && top && window.parent === window.top) {
        const r = frame.getBoundingClientRect();
        const bottom = Math.min(r.bottom, top.offsetTop + top.height);
        h = Math.min(h, bottom - r.top - (frame.clientTop || 0));
      }
    } catch (err) {} // another site's frame: our own size is all we can know
    return Math.round(h);
  }

  let last = 0;
  let pageH = page.clientHeight;
  function fit() {
    const h = visible();
    const short = h > 160 && h < innerHeight - 2;
    if (short) {
      if (h !== last) root.style.setProperty('--fit-h', `${h}px`);
    } else if (last) root.style.removeProperty('--fit-h');
    last = short ? h : 0;
    settle();
    // The page got shorter (a keyboard came up, or the window shrank): keep the caret in sight
    const now = page.clientHeight;
    if (now < pageH - 1) keepCaret();
    pageH = now;
  }

  // The line being written stays in view inside the page (no smooth scroll: it just stays put)
  function keepCaret() {
    if (!page.contains(document.activeElement) && document.activeElement !== page) return;
    const sel = getSelection();
    if (!sel || !sel.rangeCount || !page.contains(sel.anchorNode)) return;
    requestAnimationFrame(() => {
      let r = sel.getRangeAt(0).getBoundingClientRect();
      if (!r || (!r.top && !r.bottom)) {
        const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        if (!n) return;
        r = n.getBoundingClientRect();
      }
      const box = page.getBoundingClientRect();
      const room = Math.min(48, box.height / 4);
      if (r.bottom > box.bottom - room) page.scrollTop += r.bottom - box.bottom + room;
      else if (r.top < box.top + room) page.scrollTop -= box.top + room - r.top;
    });
  }

  // Nothing but the page's writing (and the side panels' lists) scrolls: put the window back
  function settle() {
    const se = document.scrollingElement || root;
    if (se.scrollTop || se.scrollLeft) se.scrollTop = se.scrollLeft = 0;
    if (document.body.scrollTop) document.body.scrollTop = 0;
    for (const id of ['shell', 'workspace', 'desk', 'page-wrap']) {
      const el = document.getElementById(id);
      if (el && (el.scrollTop || el.scrollLeft)) el.scrollTop = el.scrollLeft = 0;
    }
    if (page.scrollLeft) page.scrollLeft = 0; // the page's writing only scrolls up and down
  }

  let queued = false;
  const soon = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fit(); });
  };
  addEventListener('resize', soon, { passive: true });
  addEventListener('scroll', settle, { passive: true });
  page.addEventListener('scroll', () => { if (page.scrollLeft) page.scrollLeft = 0; }, { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', soon, { passive: true });
    visualViewport.addEventListener('scroll', soon, { passive: true });
  }
  try {
    if (window.frameElement && window.parent.visualViewport) {
      window.parent.visualViewport.addEventListener('resize', soon, { passive: true });
      window.parent.visualViewport.addEventListener('scroll', soon, { passive: true });
    }
  } catch (err) {}
  // Focusing the note or a field can make the browser scroll things that shouldn't move
  document.addEventListener('focusin', () => requestAnimationFrame(settle));
  fit();
})();
