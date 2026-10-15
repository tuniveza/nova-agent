// Android phones and tablets: the rules that make Nova Agent work well under a finger, with Android's
// keyboard, Back gesture, pull-to-refresh, bigger text and a phone held sideways. Run: npm test
// (In a browser, on every Android size, signed in and out, at 100% and 130% text:
// scripts/check-android.sh.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANDROID_DEVICES } from "../scripts/check-android-devices";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const fit = rules(read("../web/shared/fit.css"));
const chat = read("../web/agent/chat.html");
const phoneCss = rules(read("../web/agent/assets/phone.css"));
const phoneJs = read("../web/agent/assets/phone.js");
const top = rules(read("../web/shared/topbar.css"));
const status = rules(read("../web/agent/assets/status.css"));

describe("Android", () => {
  it("the keyboard makes room instead of covering the page", () => {
    expect(chat).toMatch(/<meta name="viewport" content="[^"]*interactive-widget=resizes-content/);
  });

  it("pulling down never reloads Nova Agent, and a tap is a tap", () => {
    expect(fit).toContain("html, body { overscroll-behavior-y: none; }");
    expect(fit).toMatch(/@media \(pointer: coarse\) \{[\s\S]*touch-action: manipulation;/);
    expect(fit).toMatch(/-webkit-touch-callout: none;/);
  });

  it("typing boxes are 16px or more and panel buttons at least 40px on a touch screen (never on Board's table)", () => {
    expect(fit).toMatch(/textarea, select\) \{ font-size: max\(1em, 16px\) !important; \}/);
    expect(fit).toMatch(/:where\(html\.embed\) :where\(button[^{]*:not\(:where\(\[data-pan\] \*[^{]*\{ min-height: 40px; min-width: 40px; \}/);
    expect(read("../web/board/index.html")).toContain('id="world" data-pan');
  });

  it("Back closes an open window first, then the open panel, on any touch screen", () => {
    expect(phoneJs).toContain("const backOn = () => PHONE.matches || TOUCH.matches;");
    expect(phoneJs).toMatch(/const top = openDialogs\(\)\.pop\(\);\s*if \(top\) \{ byBackDialogs\.add\(top\); top\.close\(\); return; \}/);
    expect(phoneJs).toContain("if (!viewer.hidden) { byBack = true; closePanel(); }");
  });

  it("a phone on its side: a 44px title panel, one slim row of icons, no status row", () => {
    expect(top).toMatch(/@media \(max-height: 500px\) and \(orientation: landscape\) and \(pointer: coarse\) \{\s*:root \{ --tp-h: 44px; --tp-btn: 40px;/);
    const side = phoneCss.slice(phoneCss.indexOf("@media (max-height: 500px) and (orientation: landscape) and (pointer: coarse)"));
    expect(side).toMatch(/\.tabbar \{ display: flex !important; flex-wrap: nowrap;/);
    expect(side).toContain(".tabbar .tg-label { display: none; }");
    expect(side).toContain(".tabbar > .status-line { display: none !important; }");
    // (every place keeps its name for screen readers and a long press)
    expect(phoneJs).toContain('data-tab="${key}" aria-label="${label}"');
  });

  it("a phone upright: the status line wraps onto a second short row, never sliding sideways", () => {
    expect(status).toMatch(/@media \(max-width: 600px\) \{\s*\.tabbar > \.status-line \{ flex-wrap: wrap;[^}]*overflow: visible;/);
    expect(status).not.toMatch(/\.tabbar > \.status-line \{[^}]*overflow-x: auto/);
  });

  it("the check covers Android phones, a phone on its side and tablets", () => {
    const sizes = Object.values(ANDROID_DEVICES);
    expect(sizes.some((d) => !d.tablet && d.w < d.h && d.w <= 360)).toBe(true);
    expect(sizes.some((d) => !d.tablet && d.w > d.h)).toBe(true);
    expect(sizes.some((d) => d.tablet && d.w < d.h)).toBe(true);
    expect(sizes.some((d) => d.tablet && d.w > d.h)).toBe(true);
  });
});
