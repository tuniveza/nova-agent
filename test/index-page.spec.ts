// Index's page (web/index): its wiring holds together, every older feature is still there,
// and Tidy up (P0-5) asks first, then sends exactly the report it showed.  Run: npm test
// (The rules themselves, who may do what and what counts as junk, are Nova Bot's and are
// tested there: test/memory-cleanup.spec.js.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../web/index/index.html");
const js = read("../web/index/memory.js");
const css = read("../web/index/memory.css");
const server = read("../src/visualizer/server.ts");

describe("Index's page", () => {
  it("every element the script looks up is on the page", () => {
    const ids = [...js.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]);
    const missing = [...new Set(ids)].filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it("keeps every feature it had: browse, live, approve, edit and delete a fact, new file, delete file, conflicts", () => {
    for (const tab of ["browse", "live", "approve"]) expect(html).toContain(`data-tab="${tab}"`);
    for (const text of ["Edit this fact", "Delete this fact", "+ Add", "Delete file", "Discard changes", "Use the latest and re-apply my edit", "Keep theirs, drop mine", "Created ", "Remembered in "]) {
      expect(js).toContain(text);
    }
    for (const id of ["new-file", "search", "scope-chips", "options", "refresh", "logout", "sfx-switch"]) expect(html).toContain(`id="${id}"`);
  });

  it("a fact is removed only after a confirm in its own line, and only people allowed see the tools", () => {
    expect(js).toContain("Remove this fact?");
    expect(js).toMatch(/confirmLine = i;/);
    expect(js).toContain("listed.editable !== false");
    expect(js).toContain("Studio-wide memory: only an admin can change it.");
  });

  it("Tidy up is for admins, shows the report first, and applies exactly that report's ids", () => {
    expect(html).toMatch(/id="tidy-group"[^>]*hidden/);
    expect(js).toContain('$("tidy-group").hidden = !state.admin');
    expect(js).toContain('API + "/cleanup/check"');
    expect(js).toMatch(/"\/cleanup\/apply", \{ method: "POST", body: \{ report_id: r\.id, ids: r\.items\.map\(\(i\) => i\.id\) \} \}/);
    // The Remove button is only drawn with a report in hand, after the check
    const remove = js.indexOf('"Remove them"');
    expect(remove).toBeGreaterThan(js.indexOf("} else if (r && r.counts.total) {"));
    expect(js).toContain("/restore");
  });

  it("stays inside a phone's width: long words wrap, no fixed widths in Tidy up", () => {
    const tidy = css.slice(css.indexOf("/* ----- Tidy up (admins) ----- */"));
    expect(tidy).toContain("overflow-wrap: anywhere");
    expect(tidy).not.toMatch(/(?:^|[^-])width:\s*\d{3,}px/);
  });

  it("on the studio PC without a Portal sign-in, the cleanup is refused (Nova Agent's key never runs it)", () => {
    expect(server).toMatch(/route === "\/cleanup" \|\| route\.startsWith\("\/cleanup\/"\)\) return c\.json\(\{ error: "Cleaning up Index is for admins, signed in to Portal" \}, 403\)/);
  });
});
