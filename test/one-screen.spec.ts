// One screen: inside Nova Agent a panel's page (and its <main>) never scrolls; only a box inside it
// does (a section, a list, a column, a card). Where there's room, things sit side by side. Panels show
// at once when they open (no fade in). The whole suite on real screens: scripts/check-fit-all.sh,
// which fails a page or a <main> that scrolls.
// Run: npm test
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("one screen, nothing scrolling the page", () => {
  it("the fit check fails a page or a <main> that scrolls inside Nova Agent", () => {
    const fit = read("../scripts/check-fit.mjs");
    expect(fit).toContain("the page scrolls up and down");
    expect(fit).toMatch(/its <main>\$\{m\.id \? "#" \+ m\.id : ""\} scrolls/);
  });

  it("Portal: the page stays put, the open section scrolls inside itself, Today side by side", () => {
    expect(read("../web/portal/index.html")).toContain('<link rel="stylesheet" href="/portal/frame.css">');
    const css = read("../web/portal/frame.css");
    expect(css).toContain("html.embed, html.embed body { height: 100%; min-height: 0; overflow: hidden; }");
    expect(css).toMatch(/html\.embed #main > \.view:not\(\[hidden\]\) \{\s*flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto;/);
    expect(css).toContain("grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr)");
    // going to the top scrolls the open section (the window doesn't scroll inside Nova Agent)
    expect(read("../web/portal/portal.js")).toContain("window.portalTop = portalTop;");
  });

  it("Quests: its groups and days sit side by side as columns, each scrolling by itself", () => {
    const css = read("../web/quests/css/quests.css");
    expect(css).toContain(".qx { height: 100vh; height: 100dvh; min-height: 0; overflow: hidden;");
    expect(css).toMatch(/#view-list:not\(\[hidden\]\):has\(> \.group\) \{ display: grid; grid-auto-flow: column;/);
    expect(css).toMatch(/#view-today:not\(\[hidden\]\):has\(> \.day\) \{ display: grid; grid-auto-flow: column;/);
  });

  it("Lossless, the Visualizer and the Fixer: one screen, their cards or the open tab scroll inside themselves", () => {
    expect(read("../web/lossless/public/lossless/index.html")).toContain("main > .grid { grid-template-columns: repeat(4, minmax(0, 1fr));");
    expect(read("../web/agent/page.html")).toContain("body > main { overflow: hidden; display: grid; grid-template-rows: repeat(4, minmax(0, 1fr));");
    expect(read("../web/fixer/fixer.css")).toContain("main > .pane:not([hidden]) { flex: 1 1 auto; min-height: 0; overflow-y: auto;");
  });

  it("Calendar: whichever view is open scrolls inside its own box, never the calendar's page", () => {
    const css = read("../web/calendar/css/cosmos.css");
    expect(css).toContain(".view { overflow: hidden !important; display: flex; flex-direction: column; }");
    expect(css).toContain(".month > .dayplan { flex: 0 1 auto; min-height: 0; max-height: 42%;");
  });

  it("panels show at once when they open: no fade in", () => {
    for (const f of ["../web/shared/inside.js", "../web/calendar/js/embed.js"]) expect(read(f)).not.toContain("nova-panel-in");
    expect(read("../web/agent/chat.html")).toContain("  .viewer > .viewer-body { display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; border-radius: 24px; overflow: hidden; }");
    expect(read("../web/portal/app.css")).toContain(".view-enter { animation: none; }");
  });
});
