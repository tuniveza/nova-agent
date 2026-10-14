// Calendar inside Nova Agent (web/agent/calendar-sync.js) reloads when Nova Agent's calendar changes,
// but not for its own save: Nova Agent's copy is looked at first, and the same revision (or the same
// calendar) leaves the page as it is, so it doesn't blink after every save.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../web/agent/calendar-sync.js", import.meta.url), "utf8");

function page(onServer: () => string) {
  const store = new Map<string, string>();
  class FakeStorage {
    getItem(k: string) { return store.has(k) ? store.get(k)! : null; }
    setItem(k: string, v: string) { store.set(k, String(v)); }
    removeItem(k: string) { store.delete(k); }
  }
  const localStorage = new FakeStorage();
  let changed: (() => void) | null = null;
  let reloads = 0;
  const first = JSON.stringify({ rev: 7, events: [{ id: "a" }] });
  class XMLHttpRequest {
    status = 200; responseText = "";
    open() {} setRequestHeader() {}
    send() { this.responseText = first; }
  }
  const ctx: any = {
    Storage: FakeStorage, localStorage, XMLHttpRequest, JSON, Array, console, setTimeout, clearTimeout, setInterval: () => 0,
    document: { querySelectorAll: () => [], addEventListener() {}, createElement: () => ({ style: {}, dataset: {} }), body: { appendChild() {} } },
    location: { reload: () => reloads++ },
    EventSource: class { addEventListener(_: string, f: () => void) { changed = f; } },
    fetch: async () => ({ ok: true, text: async () => onServer() }),
    window: {},
  };
  vm.runInNewContext(SRC, ctx);
  return { change: async () => { changed!(); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); }, reloads: () => reloads };
}

describe("Calendar inside Nova Agent: refreshing for a change", () => {
  it("its own revision: no reload", async () => {
    const p = page(() => JSON.stringify({ rev: 7, events: [{ id: "a" }] }));
    await p.change();
    expect(p.reloads()).toBe(0);
  });
  it("a newer revision of the same calendar: no reload (it just takes the number)", async () => {
    const p = page(() => JSON.stringify({ rev: 8, events: [{ id: "a" }] }));
    await p.change();
    expect(p.reloads()).toBe(0);
  });
  it("a real change from elsewhere: it reloads to show it", async () => {
    const p = page(() => JSON.stringify({ rev: 9, events: [{ id: "a" }, { id: "b" }] }));
    await p.change();
    expect(p.reloads()).toBe(1);
  });
});
