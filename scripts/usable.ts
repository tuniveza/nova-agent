// Usable on every screen (22 Oct 2026, with the Simple design): what the Fixer's off-screen check doesn't see.
// Run inside a page (page.evaluate(measureUsable)). Finds:
//   overlap  words or a control drawn over another's words or control (the Nova Tabs' names under their
//            neighbours' icons on a phone); the smaller of the two at least a quarter covered
//   tap      something to tap smaller than 32px either way on a touch screen
//   tiny     words smaller than 9px
// Each finding: { rule, what, why }.
export function measureUsable() {
  const out: { rule: string; what: string; why: string }[] = [];
  const touch = matchMedia("(pointer: coarse)").matches;
  const CONTROL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="link"], [role="menuitem"]';
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || +cs.opacity < 0.05) return false;
    for (let a: Element | null = el; a; a = a.parentElement) if (a.hasAttribute("data-os-off") || a.getAttribute("aria-hidden") === "true" || a.hasAttribute("inert")) return false;
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const name = (el: Element) => {
    const t = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList[0] ? "." + el.classList[0] : ""}${t ? ` “${t}”` : ""}`;
  };
  const hasWords = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim());
  // the things that must stay clear of each other: controls, and leaves with words
  const parts = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) => {
    if (el.closest("svg") || el.closest("[data-usable-off]")) return false;
    return (el.matches(CONTROL) || (hasWords(el) && !el.querySelector(CONTROL))) && shown(el);
  });
  // overlap: between parts that aren't inside one another, and only where both draw in the same layer
  // (a sticky bar over a scrolled list is fine: the list's own box clips it)
  // (each part as much of it as shows: cut to every box around it that clips, so a row scrolled out of its
  // list under a bar isn't counted as under the bar, 23 Oct 2026, the phone app's scrolling pages)
  const seen = (el: Element) => {
    const b = el.getBoundingClientRect();
    let { left, top, right, bottom } = b;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const c = a.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const rects = parts.map((el) => ({ el, r: seen(el), full: el.getBoundingClientRect() })).filter(({ r }) => r.width >= 1 && r.height >= 1);
  let found = 0;
  for (let i = 0; i < rects.length && found < 30; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 2 || h <= 2) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (w * h < small * 0.25) continue;
      // (only what's really on top there: the point in the middle of the overlap is one of the two)
      const x = Math.max(a.r.left, b.r.left) + w / 2, y = Math.max(a.r.top, b.r.top) + h / 2;
      const top = document.elementFromPoint(x, y);
      if (!top || !(a.el.contains(top) || b.el.contains(top) || top.contains(a.el) || top.contains(b.el))) continue;
      out.push({ rule: "overlap", what: name(a.el), why: `drawn over ${name(b.el)} (${Math.round(w)}×${Math.round(h)}px)` });
      found++;
      break;
    }
  }
  for (const { el, full: r } of rects) {
    if (touch && el.matches(CONTROL) && !el.matches("input[type=checkbox], input[type=radio], a:not([class])") && (r.width < 32 || r.height < 32)) {
      // (a small one inside a bigger tappable parent counts as the parent)
      if (!(el.parentElement && el.parentElement.closest(CONTROL))) out.push({ rule: "tap", what: name(el), why: `${Math.round(r.width)}×${Math.round(r.height)}px, under 32px to tap` });
    }
    if (hasWords(el)) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      // (zoom counts: what you see is the size times any zoom on the way up)
      let z = 1;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) z *= parseFloat(getComputedStyle(a).zoom || "1") || 1;
      if (fs * z < 9) out.push({ rule: "tiny", what: name(el), why: `words ${(fs * z).toFixed(1)}px` });
    }
  }
  return out.slice(0, 60);
}
