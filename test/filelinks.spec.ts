// The file cards' safety net (web/agent/assets/filelinks.js): a reply's file whose card can't be
// drawn still gets a working download link, or a way to the files list.  Run: npm test
import { beforeAll, describe, expect, it } from "vitest";

let FL: any;
beforeAll(async () => {
  await import("../web/agent/assets/filelinks.js");
  FL = (globalThis as any).NovaFileLinks;
});

const plan = { id: "f1", name: "release-plan.md", title: "Release plan", url: "/files/f1/release-plan.md" };

describe("a file card's fallback link", () => {
  it("uses the file's own details when they came with the reply", () => {
    const act = { kind: "file", text: "Wrote release-plan.md", file: plan };
    expect(FL.needsList(act)).toBe(false);
    expect(FL.linkFor(FL.fileOf(act, null))).toEqual({ href: "/files/f1/release-plan.md?download", download: "release-plan.md", text: "⤓ Download release-plan.md", files: false });
  });
  it("finds the file by the name in the reply (or its title) in the list of files", () => {
    for (const text of ["Wrote release-plan.md", "Updated release-plan.md", "exported Release plan"]) {
      const act = { kind: "file", text };
      expect(FL.needsList(act)).toBe(true);
      expect(FL.fileOf(act, [{ id: "x", name: "other.md", url: "/files/x/other.md" }, plan])).toBe(plan);
    }
    expect(FL.nameIn({ text: "Wrote  notes.txt " })).toBe("notes.txt");
  });
  it("a file card without an address still looks in the list", () => {
    expect(FL.needsList({ kind: "file", text: "Wrote release-plan.md", file: { name: "release-plan.md" } })).toBe(true);
  });
  it("offers the files list when the file can't be found", () => {
    const act = { kind: "file", text: "Wrote missing.md" };
    expect(FL.fileOf(act, [plan])).toBeNull();
    expect(FL.fileOf(act, undefined)).toBeNull();
    expect(FL.linkFor(null)).toEqual({ href: "#", download: null, text: "▤ Open your files", files: true });
  });
});
