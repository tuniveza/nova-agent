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
    expect(read("../web/fixer/fixer.css")).toContain(".panes > .pane:not([hidden]) { flex: 1 1 auto; min-height: 0; overflow-y: auto;");
  });

  it("Calendar: whichever view is open scrolls inside its own box, never the calendar's page", () => {
    const css = read("../web/calendar/css/cosmos.css");
    expect(css).toContain(".view { overflow: hidden !important; display: flex; flex-direction: column; }");
    expect(css).toContain(".month > .dayplan { flex: 0 1 auto; min-height: 0; max-height: 42%;");
  });

  it("Index on a wide screen: Browse, Live and Approve all at once, side by side (no tabs to go between)", () => {
    const js = read("../web/index/memory.js");
    expect(js).toContain('const WIDE = matchMedia("(min-width: 1200px) and (min-height: 560px)");');
    expect(js).toContain('$("view-live").hidden = !showing("live");');
    expect(js).toContain('if (!state.signedIn || !showing("live") || document.visibilityState !== "visible" || liveBusy) return;');
    const css = read("../web/index/memory.css");
    expect(css).toContain("html.embed.ix-wide .app > main > #view-live { grid-column: 2; grid-row: 2; }");
    expect(css).toContain("html.embed.ix-wide nav.tabs { display: none; }");
  });

  it("panels show at once when they open: no fade in", () => {
    for (const f of ["../web/shared/inside.js", "../web/calendar/js/embed.js"]) expect(read(f)).not.toContain("nova-panel-in");
    expect(read("../web/agent/chat.html")).toContain("  .viewer > .viewer-body { display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; border-radius: 24px; overflow: hidden; }");
    expect(read("../web/portal/app.css")).toContain(".view-enter { animation: none; }");
  });

  it("no menus hiding places or options: every place on the phone bar, Quests' options on screen", () => {
    const phone = read("../web/agent/assets/phone.js");
    for (const gone of ["data-more", "in-more", "places-sheet"]) expect(phone).not.toContain(gone);
    expect(read("../web/agent/assets/phone.css")).toContain("grid-template-columns: var(--row2,");
    const q = read("../web/quests/index.html");
    expect(q).not.toContain('id="more-btn"');
    expect(q).not.toContain('role="menu"');
    expect(q).toContain('<div class="opts" role="group" aria-label="Options">');
    for (const id of ["opt-celebrate", "opt-phone", "opt-done", "opt-replan", "opt-keys"]) expect(q).toContain(`id="${id}"`);
  });

  it("Fixer: on a wide screen all seven parts at once, no tabs", () => {
    const js = read("../web/fixer/app.js");
    expect(js).toContain('const WIDE = matchMedia("(min-width: 1100px) and (min-height: 600px)");');
    expect(js).toContain("p.hidden = !WIDE.matches && p.id !== `pane-${name}`;");
    const css = read("../web/fixer/fixer.css");
    expect(css).toContain("html.fx-wide .fx-tabs { display: none; }");
    expect(css).toContain("html.fx-wide #pane-needs { grid-row: 1 / span 2; }");
  });

  it("the home's welcome: sized once, kept while it still fits, never a hair too big", () => {
    const js = read("../web/agent/assets/music.js");
    expect(js).toContain("let fitting = 0, lastZ = 0;");
    expect(js).toContain("const r3 = (z) => Math.floor(z * 1000) / 1000;");
    expect(js).not.toContain("Math.round(z * 1000) / 1000");
  });

  it("Portal's lanes share lines when there's room", () => {
    const js = read("../web/portal/tabbar.js");
    expect(js).toContain("const fit = w <= room ? lines.find((l) => l.used + apart + gap + w + 8 <= room) : null;");
  });

  it("Portal on a phone inside Nova Agent: every section on its sliding row, no More", () => {
    const js = read("../web/shared/inside.js");
    const phone = js.slice(js.indexOf("@media (max-width: 980px)"), js.indexOf("@media (min-width: 761px) and (max-width: 980px)"));
    expect(phone).toContain("html.embed .embed-head > .tabs > .tab.tab-more { display: flex; }");
    expect(phone).toContain("html.embed .embed-head > .tabs > #tab-more { display: none; }");
  });
});
