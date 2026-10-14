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
    // one size for both (computer 52px with 40px targets; phone 48px with 44px targets)
    expect(r).toMatch(/:root \{ --tp-h: 52px; --tp-btn: 40px;/);
    expect(r).toMatch(/:root \{ --tp-h: 48px; --tp-btn: 44px;/);
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
  it("never makes the open panel change size as it comes and goes (no room taken and given back)", () => {
    expect(css).not.toMatch(/--strip-room|--top-room|--bar-room-delay|--top-room-delay/);
    expect(css).not.toMatch(/margin-bottom: var\(--strip-room/);
    expect(barJs).not.toMatch(/--strip-room|--top-room/);
  });

  it("only slides (transform and opacity), and quickly: in 0.18 s, away in 0.15 s", () => {
    expect(css).toMatch(/--come: \.18s;/);
    expect(css).toMatch(/--away: \.15s;/);
    // nothing in the bars' own moves takes longer than 0.2 s
    const secs = [...css.matchAll(/transition:[^;]*?(\d*\.\d+)s/g)].map((m) => Number(m[1]));
    expect(Math.max(...secs)).toBeLessThanOrEqual(0.2);
  });

  it("has no trail of echoes and no tile-by-tile ripple (the bar moves as one piece)", () => {
    expect(css).not.toMatch(/bar-trail|trail-echo|trail-halo/);
    expect(barJs).not.toMatch(/function trail|bar-trail/);
    expect(css).not.toMatch(/var\(--i/);
    expect(barJs).not.toMatch(/setProperty\("--i"/);
  });

  it("doesn't measure or restyle anything each time it shows or hides", () => {
    const update = barJs.slice(barJs.indexOf("function update()"), barJs.indexOf("function show()"));
    expect(update).not.toMatch(/offsetHeight|getBoundingClientRect|setProperty|number\(\)|measure\(\)/);
  });

  it("stops looking for a panel's page once it has it (no checking forever)", () => {
    expect(barJs).not.toMatch(/setInterval\(attach, 400\)/);
    expect(barJs).toMatch(/if \(\+\+tries > 30\) \{ clearInterval\(timer\)/);
  });

  it("always shown by default: nothing hides, slides or waits (a device that had the old Auto gets Always shown)", () => {
    expect(barJs).toContain('const MODES = ["shown", "hidden"];');
    expect(barJs).toContain('const pick = (m) => (MODES.includes(m) ? m : "shown");');
    expect(html).not.toContain('data-bar-mode="auto"');
    expect(html).not.toContain('data-top-mode="auto"');
  });

  it("keeps its two choices and its handle: Always shown, Always hidden, for the bar and the top bar", () => {
    for (const k of ["setMode", "setTopMode", "reveal: show", "nextTop"]) expect(barJs).toContain(k);
    expect(barJs).toContain('peek.id = "bar-peek";');
  });

  it("with less motion asked for, nothing slides", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html \.main\.viewing > \.suite-home, html \.shell > \.tabbar, html \.shell > \.topbar/);
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
