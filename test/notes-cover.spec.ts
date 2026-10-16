// Notes: while a dialog is open, the page behind it is marked covered (web/notes/js/cover.js). Run: npm test
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

// A tiny stand-in page: a shell and some dialogs, with a MutationObserver that is told by hand
function page(n = 2) {
  const attrs = new Map<string, string>();
  const shell = { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) };
  const dialogs = Array.from({ length: n }, () => ({ open: false }));
  const doc = {
    getElementById: (id: string) => (id === "shell" ? shell : null),
    querySelectorAll: () => dialogs,
    querySelector: (sel: string) => (sel === "dialog[open]" ? dialogs.find((d) => d.open) || null : null),
  };
  const watchers: (() => void)[] = [];
  class MutationObserver { constructor(cb: () => void) { watchers.push(cb); } observe() {} }
  const box: any = { document: doc, MutationObserver };
  box.window = box;
  runInNewContext(read("../web/notes/js/cover.js"), box);
  const change = (i: number, open: boolean) => { dialogs[i].open = open; watchers.forEach((w) => w()); };
  return { hidden: () => attrs.get("aria-hidden") === "true", change };
}

describe("Notes: the page behind an open dialog", () => {
  it("is covered while a dialog is open, and uncovered once the last one closes", () => {
    const p = page();
    expect(p.hidden()).toBe(false);
    p.change(0, true);
    expect(p.hidden()).toBe(true);
    p.change(1, true);
    p.change(0, false);
    expect(p.hidden()).toBe(true);
    p.change(1, false);
    expect(p.hidden()).toBe(false);
  });

  it("loads before the app, after the dialogs, outside the page it covers", () => {
    const html = read("../web/notes/index.html");
    const at = (s: string) => html.indexOf(s);
    expect(at('<script src="js/cover.js">')).toBeGreaterThan(at('id="dlg-guide"'));
    expect(at('<script src="js/cover.js">')).toBeLessThan(at('<script src="js/app.js">'));
    // every dialog sits after the shell closes, so covering the shell never covers a dialog
    expect(at("<dialog")).toBeGreaterThan(at("<!-- ===== TOP BAR ===== -->"));
    expect(html.slice(at('id="shell"'), at('id="pop-color"'))).not.toContain("<dialog");
  });
});
