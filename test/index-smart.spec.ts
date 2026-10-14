// Index's smart helpers (web/index/smart.js): forgiving search, "Did you mean …?", questions,
// related files, look-alike files, the "Changed" filter, and pinned/recent files. Run: npm test
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const box: any = {};
runInNewContext(read("../web/index/smart.js"), box);
const S = box.IndexSmart;
const html = read("../web/index/index.html");
const js = read("../web/index/memory.js");
const server = read("../src/visualizer/server.ts");

const kai = { scope: "studio", owner_id: null, path: "people/kai", name: "Kai", description: "Kai: regular artist, session prefs", aliases: ["Kai M"], updated_at: 3 };
const ep = { scope: "studio", owner_id: null, path: "areas/ep-release", name: "EP release", description: "The spring EP", updated_at: 2 };
const pricing = { scope: "studio", owner_id: null, path: "topics/pricing", name: "topics/pricing", description: "Pricing and deposits", updated_at: 1 };

describe("search that forgives", () => {
  it("finds words as typed, by stem, or a typo or two away; short words must be exact", () => {
    expect(S.fuzzyHas("prefers evening sessions", "evening")).toBe(true);
    expect(S.fuzzyHas("prefers evening sessions", "evnings")).toBe(true);
    expect(S.fuzzyHas("deposits are 25%", "depoist")).toBe(true);
    expect(S.fuzzyHas("deposits are 25%", "deposit evening")).toBe(false); // every word must be there
    expect(S.fuzzyHas("kai", "kat")).toBe(false);
    expect(S.fuzzyHas("anything", "")).toBe(true);
    expect(S.lineHit("usually books the Live Room", "liev")).toBe(true);
  });

  it("says “Did you mean …?” with the closest words Index knows", () => {
    const vocab = S.vocabulary([kai, ep, pricing], () => "");
    expect(S.suggest("pricnig", vocab)).toBe("pricing");
    expect(S.suggest("regluar artist", vocab)).toBe("regular artist");
    expect(S.suggest("kai", vocab)).toBeNull(); // already known
    expect(S.suggest("zzzzzz", vocab)).toBeNull();
  });

  it("knows a question when it sees one", () => {
    expect(S.looksLikeQuestion("when does Kai like to record?")).toBe(true);
    expect(S.looksLikeQuestion("what do we know about Kai")).toBe(true);
    expect(S.looksLikeQuestion("kai")).toBe(false);
    expect(S.looksLikeQuestion("evening sessions")).toBe(false);
  });
});

describe("files that go together", () => {
  it("related: the files that name each other or share what they're about, best first", () => {
    const bodies: Record<string, string> = { "areas/ep-release": "- [stated] Kai is singing on two tracks", "topics/pricing": "- [stated] deposits are 25%" };
    const bodyOf = (f: any) => bodies[f.path] || "";
    expect(S.related(kai, [kai, ep, pricing], bodyOf).map((f: any) => f.path)).toEqual(["areas/ep-release"]);
    expect(S.related(ep, [kai, ep, pricing], bodyOf).map((f: any) => f.path)).toEqual(["people/kai"]);
  });

  it("look-alikes: same memory, owner and kind, with names a typo apart or one inside the other", () => {
    const kaiM = { ...kai, path: "people/kai-m", name: "Kai M", aliases: [] };
    const kia = { ...kai, path: "people/kia", name: "Kia", aliases: [] };
    const danaA = { scope: "staff", owner_id: "sam", path: "people/dana", name: "Dana", aliases: [] };
    const danaB = { scope: "staff", owner_id: "lee", path: "people/dana", name: "Dana", aliases: [] };
    const pairs = S.lookAlikes([kai, kaiM, ep, pricing, danaA, danaB]).map((p: any[]) => p.map((f) => f.path).join(" + "));
    expect(pairs).toEqual(["people/kai + people/kai-m"]); // different owners are different people
    expect(S.lookAlikes([{ ...kai, path: "people/sasha", name: "Sasha", aliases: [] }, { ...kai, path: "people/sacha", name: "Sacha", aliases: [] }])).toHaveLength(1);
    expect(S.lookAlikes([kai, kia])).toHaveLength(0); // 3 letters: too short to call a typo
  });

  it("the Changed filter: today, this week, this month, or not for 6 months", () => {
    const now = new Date(2026, 9, 14, 15, 0).getTime();
    expect(S.changedWithin(now - 3_600_000, "today", now)).toBe(true);
    expect(S.changedWithin(now - 20 * 3_600_000, "today", now)).toBe(false);
    expect(S.changedWithin(now - 3 * 86_400_000, "week", now)).toBe(true);
    expect(S.changedWithin(now - 20 * 86_400_000, "month", now)).toBe(true);
    expect(S.changedWithin(now - 200 * 86_400_000, "old", now)).toBe(true);
    expect(S.changedWithin(now - 20 * 86_400_000, "old", now)).toBe(false);
    expect(S.changedWithin(0, "any", now)).toBe(true);
  });
});

describe("pinned and recent files", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("pins toggle and are kept; the most used lately come first", () => {
    const storage = memory();
    const shelf = S.shelf(storage);
    expect(shelf.toggle("a")).toBe(true);
    expect(S.shelf(storage).isPinned("a")).toBe(true); // kept
    expect(shelf.toggle("a")).toBe(false);
    const now = Date.now();
    shelf.touch("old", now - 30 * 86_400_000);
    for (let i = 0; i < 3; i++) shelf.touch("often", now - 2 * 86_400_000);
    shelf.touch("just-now", now);
    expect(shelf.top(2, now)).toEqual(["often", "just-now"]);
    shelf.forget("often");
    expect(shelf.top(5, now)).not.toContain("often");
  });

  it("works when the browser blocks storage", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const shelf = S.shelf(broken);
    expect(shelf.toggle("a")).toBe(true);
    expect(shelf.pins()).toEqual(["a"]);
  });
});

describe("the page uses them", () => {
  it("loads smart.js before memory.js, and every older search feature is still there", () => {
    expect(html.indexOf("/app/memory/smart.js")).toBeGreaterThan(0);
    expect(html.indexOf("/app/memory/smart.js")).toBeLessThan(html.indexOf("/app/memory/memory.js"));
    for (const id of ["filter-kind", "filter-when", "filter-pinned", "filter-clear", "ask-box", "shelf", "hints"]) expect(html).toContain(`id="${id}"`);
    expect(js).toContain("S.fuzzyHas(hay, q)");
    expect(js).toContain("loadBodiesForSearch"); // the server still searches inside every file
  });

  it("Ask Index only reads: it posts the question and opens the files it cites", () => {
    expect(js).toContain('API + "/ask", { method: "POST", body: { q } }');
    expect(js).toContain("Answered only from memory. Nothing is sent or saved.");
    expect(server).toMatch(/route === "\/ask" && c\.req\.method === "POST"/);
  });

  it("keys: Ctrl+K or / to search, arrows between files, Esc to clear or close", () => {
    expect(js).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && k === "k"/);
    expect(js).toContain('e.key === "ArrowDown" || e.key === "ArrowUp"');
    expect(html).toContain('aria-keyshortcuts="Control+K /"');
  });

  it("a fact from a website chat links to that chat in Portal", () => {
    expect(js).toContain('"/portal/?view=chats&chat=" + encodeURIComponent(p.source_ref)');
  });
});
