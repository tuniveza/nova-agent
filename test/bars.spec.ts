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
  it("Nova Agent's header and the open panel's bar both wear the one shared top bar", () => {
    expect(html).toContain('<link rel="stylesheet" href="/shared/topbar.css">');
    expect(html).toMatch(/<header class="topbar glass nv-topbar">/);
    expect(html).toMatch(/<div class="viewer-bar nv-topbar">/);
    // its look, size and corners are defined once, for both
    for (const v of ["--nv-top-h", "--nv-top-r", "--nv-mark", "--nv-word"]) expect(top).toContain(v);
    expect(rules(top)).toMatch(/\.nv-topbar \.mark, \.nv-topbar \.vn-ico \{/);
    expect(rules(top)).toMatch(/\.nv-topbar \.wordmark, \.nv-topbar \.vn-text \{/);
  });

  it("the panel's name stays exactly its name (other code reads it): the small word above it is drawn", () => {
    expect(rules(top)).toMatch(/\.vn-text::before \{ content: "Nova Agent"/);
    expect(html).not.toMatch(/vn-kicker/);
  });

  it("the panel's bar keeps Back, the name that switches panels, and Reload", () => {
    for (const id of ["viewer-close", "viewer-name", "viewer-reload", "viewer-frame", "viewer-body"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("$('viewer-name').addEventListener('click', () => $('suite').showModal());");
  });

  it("the panel sits in its own box under the bar; the status line and a phone's kept panels go in it too", () => {
    expect(statusJs).toContain('const box = $("viewer-body") || viewer;');
    expect(statusCss).toContain("#viewer-body > .status-line");
    expect(statusCss).not.toMatch(/#viewer > \.status-line/);
    expect(phoneJs).toContain("(first.parentElement || viewer).append(frame);");
  });

  it("the panel's bar is as wide as Nova Agent's header on the home, so opening a panel swaps one for the other in place", () => {
    expect(barJs).toContain('root.style.setProperty("--top-w"');
    expect(html).toContain("width: var(--top-w, var(--chat-w, 760px))");
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

  it("on the home it stays put while you type (the page doesn't shift under you)", () => {
    expect(barJs).toContain('current === "auto" ? viewing() && (!out || typing) : false');
  });

  it("keeps its three choices and its handle: Auto, Always shown, Always hidden, for the bar and the top bar", () => {
    expect(barJs).toContain('const MODES = ["auto", "shown", "hidden"];');
    for (const k of ["setMode", "setTopMode", "reveal: show", "nextTop"]) expect(barJs).toContain(k);
    expect(barJs).toContain('peek.id = "bar-peek";');
  });

  it("with less motion asked for, nothing slides", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html \.main\.viewing > \.suite-home, html \.shell > \.tabbar, html \.shell > \.topbar/);
  });

  it("in one row (a tablet, a phone on its side) each group's share follows its places and their names", () => {
    expect(phoneJs).toContain("bar.style.setProperty('--tg-cols'");
    expect(read("../web/agent/assets/glow.css")).toContain("grid-template-columns: var(--tg-cols, 5fr 2fr 2fr 2fr)");
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
