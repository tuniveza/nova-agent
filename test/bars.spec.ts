// Nova Agent's bars (web/agent): one top bar look for Nova Agent's header and every open panel's
// bar (/shared/topbar.css), and a panels bar along the bottom that floats over an open panel and
// only slides, quickly, so the panel never jumps. Every older control is still there.  Run: npm test
// (How it looks and moves in a browser, measured: scripts/check-bars.mjs.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../web/agent/chat.html");
const top = read("../web/shared/topbar.css");
const barCss = read("../web/agent/assets/bar.css");
const barJs = read("../web/agent/assets/bar.js");
const phoneJs = read("../web/agent/assets/phone.js");
const statusJs = read("../web/agent/assets/status.js");
const statusCss = read("../web/agent/assets/status.css");
// The rules only (no comments), so words in an explanation don't count
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the top bars", () => {
  it("one top bar: Nova Agent's header, which becomes the open panel's slim title panel (never two bars)", () => {
    expect(html).toContain('<link rel="stylesheet" href="/shared/topbar.css">');
    expect(html).toMatch(/<header class="topbar glass nv-topbar">/);
    expect(html).not.toMatch(/class="viewer-bar/);
    expect(rules(top)).toContain(".shell:has(> .main.viewing) > .topbar > .brand { display: none; }");
    expect(rules(top)).toMatch(/\.shell:has\(> \.main\.viewing\) > \.topbar \{\s*--nv-top-h: 48px;/);
    // its look, size and corners are defined once, for both
    for (const v of ["--nv-top-h", "--nv-top-r", "--nv-mark", "--nv-word"]) expect(top).toContain(v);
    expect(rules(top)).toMatch(/\.nv-topbar \.mark, \.nv-topbar \.vn-ico \{/);
    expect(rules(top)).toMatch(/\.nv-topbar \.wordmark, \.nv-topbar \.vn-text \{/);
  });

  it("one title panel everywhere: the home's header and every panel's are the same height and width, with big targets and one Install", () => {
    const r = rules(top);
    const both = ".shell:is(:has(> .main.viewing), :not(:has(> .main.viewing))) > .topbar.nv-topbar";
    // one size for both (computer 52px with 40px targets; phone 52px with 48px targets, 48dp)
    expect(r).toMatch(/:root \{ --tp-h: 52px; --tp-btn: 40px;/);
    expect(r).toMatch(/:root \{ --tp-h: 52px; --tp-btn: 48px;/);
    expect(r).toContain(`${both} {\n  --nv-top-h: var(--tp-h);`);
    expect(r).toMatch(/height: var\(--tp-h\); min-height: var\(--tp-h\);/);
    expect(r).toContain(`${both} .icon-btn {\n  flex: none; width: var(--tp-btn); height: var(--tp-btn);`);
    // full width on both (no narrower bar on one of them)
    expect(r).toContain("justify-self: stretch; width: auto;");
    // readable: the Live word plain 13px; no small spaced-out word above the name
    expect(r).toMatch(/font-size: 13px; font-weight: 600; letter-spacing: normal; text-transform: none;/);
    expect(r).toContain(`${both} .kicker { display: none !important; }`);
    // one Install control in the bar (the chip); the old button stays for the phone's gear menu
    expect(r).toContain(".shell > .topbar.nv-topbar #install { display: none !important; }");
    expect(html).toContain('id="install"');
  });
  it("the panel's name stays exactly its name (other code reads it): the small word above it is drawn", () => {
    expect(rules(top)).toMatch(/\.vn-text::before \{ content: "Nova Agent"/);
    expect(html).not.toMatch(/vn-kicker/);
  });

  it("the title panel keeps Back, the name that switches panels, and Reload, with Nova Agent's own controls beside them", () => {
    for (const id of ["viewer-close", "viewer-name", "viewer-reload", "viewer-frame", "viewer-body"]) expect(html).toContain(`id="${id}"`);
    const header = html.slice(html.indexOf('<header class="topbar'), html.indexOf("</header>"));
    for (const id of ["viewer-close", "viewer-name", "viewer-reload", "sfx-btn", "music-btn", "status", "install", "suite-btn"]) expect(header).toContain(`id="${id}"`);
    expect(header).toContain("<nova-portal-badge>");
    expect(html).toContain("$('viewer-name').addEventListener('click', () => $('suite').showModal());");
  });

  it("the status line is the bottom row of the navigation bar, on the home and with a panel open; a phone's kept panels go in the panel's box", () => {
    expect(statusJs).toContain('const box = PHONE.matches ? $("tabbar") : $("suite-home");');
    expect(statusCss).toContain("#suite-home > .status-line, .tabbar > .status-line {");
    expect(statusCss).not.toMatch(/#viewer-body > \.status-line/);
    // always in the panel's box, even after the first frame has been let go (the big-gap bug, 2026-10-14)
    expect(phoneJs).toContain("($('viewer-body') || first.parentElement || viewer).append(frame);");
  });

  it("the title panel is as wide as Nova Agent's header on the home, so the panel below starts in the same place", () => {
    expect(barJs).toContain('root.style.setProperty("--top-w"');
    expect(top).toContain("width: var(--top-w, fit-content)");
  });
});

describe("the panels bar along the bottom", () => {
  const css = rules(barCss);
  it("gives the room back to the content once per move, never during a slide (no room animated)", () => {
    expect(css).not.toMatch(/--strip-room|--top-room|--bar-room-delay|--top-room-delay/);
    expect(barJs).not.toMatch(/--strip-room|--top-room/);
    // away: out of the rows only once its slide has ended; back: slides in first, then takes its row
    expect(css).toMatch(/html\.top-away \.shell \{ grid-template-rows: minmax\(0, 1fr\); \}/);
    expect(css).toMatch(/html\.nav-away \.main \{ grid-template-rows: minmax\(0, 1fr\); \}/);
    expect(barJs).toContain('if (b.state === "going") { b.state = "away"; root.classList.add(`${b.cls}-away`); }');
    expect(barJs).toContain('if (b.state === "in") root.classList.remove(`${b.cls}-away`);');
  });

  it("only slides (transform and opacity), and fast: in 0.1 s, away in 0.09 s, no wait before it starts", () => {
    expect(css).toMatch(/--bar-in: \.1s;/);
    expect(css).toMatch(/--bar-out: \.09s;/);
    expect(css).toMatch(/\.shell > \.topbar, \.main > \.suite-home, \.shell > \.tabbar \{\s*transition: transform var\(--bar-in\) var\(--bar-in-ease\), opacity var\(--bar-in\) ease; \}/);
    const own = css.slice(0, css.indexOf(".bar-edge {"));
    const secs = [...own.matchAll(/--bar-(?:in|out): (\d*\.\d+)s/g)].map((m) => Number(m[1]));
    expect(Math.max(...secs)).toBeLessThanOrEqual(0.12);
    expect(own).not.toMatch(/transition-delay/);
  });

  it("has no trail of echoes and no tile-by-tile ripple (the bar moves as one piece)", () => {
    expect(css).not.toMatch(/bar-trail|trail-echo|trail-halo/);
    expect(barJs).not.toMatch(/function trail|bar-trail/);
    expect(css).not.toMatch(/var\(--i/);
    expect(barJs).not.toMatch(/setProperty\("--i"/);
  });

  it("doesn't measure anything while the mouse moves (the bars' heights are kept as they change)", () => {
    const pointer = barJs.slice(barJs.indexOf("function pointerAt(y)"), barJs.indexOf('document.addEventListener("pointermove"'));
    expect(pointer).not.toMatch(/offsetHeight|getBoundingClientRect|getComputedStyle|setProperty/);
    expect(barJs).toContain("new ResizeObserver((entries) => {");
  });

  it("stops looking for a panel's page once it has it (no checking forever)", () => {
    expect(barJs).not.toMatch(/setInterval\(attach, 400\)/);
    expect(barJs).toMatch(/if \(\+\+tries > 30\) \{ clearInterval\(timer\)/);
  });

  it("away while you work by default for both bars (new keys, so it's on for every device), with always shown, Auto and hidden", () => {
    expect(barJs).toContain('const MODES = ["work", "shown", "auto", "hidden"];');
    expect(barJs).toContain('const pick = (m) => (MODES.includes(m) ? m : "work");');
    expect(barJs).toContain('const KEYS = { nav: "nova-bar-5", top: "nova-top-5" };');
    for (const m of ["work", "shown", "auto", "hidden"]) {
      expect(html).toContain(`data-bar-mode="${m}"`);
      expect(html).toContain(`data-top-mode="${m}"`);
    }
    for (const k of ["setMode", "setTopMode", "reveal:", "nextTop", "next:"]) expect(barJs).toContain(k);
  });

  it("the Nova tiles / Nova dock hide with their own slim line on their top edge, and the same line at the bottom brings them back", () => {
    expect(barJs).toContain('h.className = "dock-handle";');
    // (a finger's drag stays with the handle: no button's touch rule may hand it to the page as scrolling)
    expect(read("../web/agent/assets/bar.css")).toContain("html body .dock-handle, html body .dock-handle *, html body .bar-edge.bottom, html body .bar-edge.bottom * { touch-action: none !important; }");
    // (a drawer's handle, 16 Oct 2026: dragged down past a third of the way, or flicked, it closes; a tap
    // or click closes it; the edge it leaves at the bottom is pulled up (or tapped) to bring it back)
    expect(barJs).toContain('if (e.type === "pointerup" && (dy > box.offsetHeight / 3 || (dy > 12 && g.v > 0.5))) close();');
    // (closed, it's pulled up and the tiles come up with the finger: past a third, or a flick, they open)
    expect(barJs).toContain("if (e.type === \"pointerup\" && d && (up > (d.offsetHeight + 16) / 3 || (up > 12 && p.v > 0.5))) open();");
    expect(barJs).toContain('setFor(bars.nav, "hidden", dockName())');
    expect(barJs).toContain('(b.mode === "hidden" ? setFor(b, "shown", dockName()) : show(b))');
    expect(barJs).toContain('const dockName = () => (PHONE.matches ? "Nova tiles" : "Nova dock");');
  });

  it("while you work (the default, and Auto): away while typing or doing something hands-on anywhere in Nova Agent, back when you stop", () => {
    expect(barJs).toContain("watchWork(document);");
    expect(barJs).toContain("watchWork(doc);");
    // (only a person's own typing: never a page filling in or focusing a box by itself as it loads,
    // which turning a phone round or a slow load could otherwise mistake for typing)
    expect(barJs).toContain('doc.addEventListener("input", (e) => { if (e.isTrusted && editable(e.target) && !inBars(e.target) && !stays()) work(true); }, true);');
    expect(barJs).toContain("performance.now() - tapped < 800");
    expect(barJs).toContain("let tapped = -Infinity, drag = null, touched = false;");
    expect(barJs).toContain("Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12");
    expect(barJs).toContain('if (b.mode === "work") continue; // (away only while you work: below)');
    expect(barJs).toContain('if (b.timer || b.state !== "in" || b.mode !== "auto") return;');
    expect(barJs).toContain('if (b.mode === "work" || b.mode === "auto") (on ? hide(b, hands) : show(b));');
    // (a drag sends them away over the content, keeping their rows: the panel is never resized mid-drag)
    expect(barJs).toContain("drag.on = true; work(true, 0, true);");
    expect(barJs).toContain('if (keepRow) return;');
  });

  it("calm (17 Oct 2026): on a computer only typing sends them away, they come back once you've stopped, and the Invoicer keeps them put", () => {
    // (clicking into a box counts only on a touch screen, where the keyboard comes up)
    expect(barJs).toContain("touched = e.pointerType === \"touch\" || e.pointerType === \"pen\";");
    expect(barJs).toMatch(/focusin", \(e\) => \{ if \(editable\(e\.target\) && !inBars\(e\.target\) && touched &&/);
    // (back CALM_MS after leaving a box, not the moment a button is clicked between two boxes; into
    // another box in the meantime: they stay away)
    expect(barJs).toContain("CALM_MS = 2500");
    expect(barJs).toContain("work(false, CALM_MS, false, inBox)");
    expect(barJs).toContain("if (!(still && still())) work(false);");
    // (a page can keep them put: the Invoicer, a form you fill in while watching the invoice)
    expect(barJs).toContain('doc.documentElement.hasAttribute("data-bars-stay")');
    expect(read("../web/invoicer/index.html")).toContain('<html lang="en-GB" data-bars-stay>');
  });


  it("comes back at once: the mouse at the edge, a tap or swipe at the edge, Tab into it, scrolling up", () => {
    expect(barJs).toContain("const HIDE_AFTER = 1500, EDGE = 12, NEAR = 60, CALM_MS = 2500;");
    expect(barJs).toContain("if (fromEdge <= EDGE) { show(b); continue; }");
    expect(barJs).toContain('el.id = side === "bottom" ? "bar-peek" : "top-peek";');
    expect(barJs).toContain('document.addEventListener("focusin", (e) => {');
    expect(barJs).toMatch(/if \(scrolled < -24 \|\| y <= 0\)/);
    expect(barJs).toMatch(/function touchMove\(y\)/);
    // showing never waits for a timer: the slide starts first
    const show = barJs.slice(barJs.indexOf("function show(b)"), barJs.indexOf("function hide(b)"));
    expect(show.indexOf("setTimeout")).toBeGreaterThan(show.indexOf('root.classList.remove(`${b.cls}-going`);'));
    // panels tell it about their mouse, scrolling and swipes
    expect(barJs).toContain('doc.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") pointerAt(top + e.clientY); }');
  });

  it("never goes while it's in use: the mouse on it, the keyboard in it, a window, menu or the sign-in card open", () => {
    const busy = barJs.slice(barJs.indexOf("function busy(b)"), barJs.indexOf("// ---- Moving a bar ----"));
    expect(busy).toContain('document.querySelector("dialog[open]")');
    expect(busy).toContain('el.matches(":hover")');
    expect(busy).toContain("el.contains(a)");
    expect(busy).toContain('[aria-expanded="true"]');
    expect(busy).toContain(".sl-list:not([hidden])");
    expect(barJs).toContain("if (busy(b)) return later(b);");
  });

  it("with less motion asked for, nothing slides (it's just there or not)", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html \.main > \.suite-home, html \.shell > \.tabbar, html \.shell > \.topbar/);
    expect(barJs).toContain('const STILL = matchMedia("(prefers-reduced-motion: reduce)");');
  });

  it("in one row (a tablet, a short window, a phone on its side) every place is the same width and each group as wide as its places", () => {
    expect(phoneJs).toContain("bar.style.setProperty('--tab-n'");
    const phoneCss = rules(read("../web/agent/assets/phone.css"));
    expect(phoneCss).toMatch(/\.tabbar \.tgroup \{ flex: 0 0 auto;/);
    expect(phoneCss).toMatch(/grid-template-columns: repeat\(var\(--k, 2\), var\(--tab-w\)\)/);
    expect(phoneCss).toMatch(/text-overflow: ellipsis/);
    expect(phoneCss + rules(read("../web/agent/assets/glow.css"))).not.toMatch(/5fr 2fr 2fr 2fr/);
  });
});

describe("Plans", () => {
  it("is Quests and Missions: today's plan isn't a place of its own any more (Quests opens on Today)", () => {
    expect(phoneJs).toContain("['tasks', 'Plans', ['/quests/', 'pane:missions']],");
    expect(phoneJs).not.toMatch(/'pane:quests': \(\) =>/);
    expect(phoneJs).not.toMatch(/MORE_ORDER = \['pane:quests'/);
    expect(html).not.toContain("Today's plan");
  });

  it("old ways to today's plan (a link, a phone that was on it) open Quests instead", () => {
    expect(phoneJs).toContain("if (t === 'pane:quests') { open('/quests/'); return; }");
    expect(phoneJs).toContain("if (pane === 'quests') { open('/quests/'); return; }");
    expect(phoneJs).toContain("if (toQuests && PHONE.matches && viewer.hidden) open('/quests/');");
  });
});
