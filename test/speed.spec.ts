// Nova feeling instant: panels stay loaded once opened (phone.js), and the Manual button's "new" dot
// needs only a tiny file (manual-news.js), not the whole manual.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("panels stay loaded", () => {
  it("on a computer as well as a phone, except Lossless audio (closed means closed)", () => {
    const phone = read("../web/agent/assets/phone.js");
    expect(phone).toContain("const KEEP = PHONE.matches ? 3 : 6;");
    expect(phone).toContain("if (!LIVE.test(entry.base || '')) return;");
    expect(phone).not.toContain("// A computer: the one frame, moved on (or reloaded)");
  });
});

describe("the Manual's \"new\" dot", () => {
  it("comes from manual-news.js: the newest change in the suite, a few bytes", () => {
    const box: any = { window: {} };
    vm.runInNewContext(read("../web/shared/manual-news.js"), box);
    expect(Date.parse(box.window.NovaManualNews.newest)).toBeGreaterThan(0);
    expect(read("../web/shared/manual-news.js").length).toBeLessThan(400);
    const manual = read("../web/shared/manual.js");
    expect(manual).toContain('news().then((n) => this.markNewAt(Date.parse(n.newest) || 0))');
    expect(manual).not.toContain("data().then((d) => this.markNew(d))");
  });
});
