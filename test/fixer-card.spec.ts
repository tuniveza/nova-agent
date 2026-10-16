// The Fixer's one-fix-at-a-time card: where a problem is on its picture (looks.ts boxes, outlined on
// the card), the card's short headline from Claude Code (claude.ts), and the page's one-card deck.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { judgeContent, judgeFrame, judgeHost, shiftBoxes, unionBox, type FrameMeasure } from "../src/fixer/looks";
import { CARD_SCHEMA, readAnswer } from "../src/fixer/claude";

const content = { w: 400, h: 800, rows: [] as [number, number][], text: 0, media: 0, header: null as number | null, x: 0, y: 0 };

describe("where a problem is on the picture", () => {
  it("a blank panel: the whole area", () => {
    const [p] = judgeContent({ ...content, x: 10, y: 60 }, "panel");
    expect(p.kind).toBe("blank");
    expect(p.box).toEqual({ x: 10, y: 60, w: 400, h: 800 });
  });
  it("a big gap at the top: from the top to where the content starts", () => {
    const ps = judgeContent({ ...content, rows: [[500, 780]], text: 40, media: 2 }, "panel");
    expect(ps.find((p) => p.kind === "top-gap")?.box).toEqual({ x: 0, y: 0, w: 400, h: 500 });
  });
  it("a gap between parts: the empty band", () => {
    const ps = judgeContent({ ...content, rows: [[0, 60], [500, 560]], text: 40, media: 2 }, "panel");
    expect(ps.find((p) => p.kind === "gap")?.box).toEqual({ x: 0, y: 60, w: 400, h: 440 });
  });
  it("cut off at the bottom: the bottom strip; off the screen and cut text: around those things", () => {
    const f: FrameMeasure = { ...content, rows: [[0, 790]], text: 50, media: 3, docH: 1200, docScrolls: false, mainScrolls: false, offscreen: ["button “Pin”"], textCut: [], titleBars: 0, offscreenBoxes: [{ x: 350, y: 300, w: 90, h: 40 }], textCutBoxes: [] };
    const ps = judgeFrame(f);
    expect(ps.find((p) => p.kind === "cut-off")?.box).toEqual({ x: 0, y: 728, w: 400, h: 72 });
    // (clipped to the screen: the part that's still on it)
    expect(ps.find((p) => p.kind === "offscreen")?.box).toEqual({ x: 350, y: 300, w: 50, h: 40 });
  });
  it("a panel's own boxes move to where its frame is in Nova Agent", () => {
    const ps = shiftBoxes([{ kind: "blank", severity: "serious", text: "", box: { x: 0, y: 0, w: 10, h: 10 } }, { kind: "slow", severity: "minor", text: "" }], { x: 20, y: 70 });
    expect(ps[0].box).toEqual({ x: 20, y: 70, w: 10, h: 10 });
    expect(ps[1].box).toBeUndefined();
  });
  it("the bars covering the panel: the covered strip", () => {
    const ps = judgeHost({ vw: 400, vh: 800, docH: 800, titles: [{ x: 0, y: 0, w: 400, h: 60 }], titleInDom: true, nav: { x: 0, y: 700, w: 400, h: 100 }, navInDom: true, frame: { x: 0, y: 60, w: 400, h: 700 }, offscreen: [] }, 0);
    expect(ps.find((p) => p.kind === "covered")?.box).toEqual({ x: 0, y: 700, w: 400, h: 60 });
  });
  it("unionBox: the smallest box around them all, or none", () => {
    expect(unionBox([{ x: 10, y: 10, w: 10, h: 10 }, { x: 50, y: 0, w: 5, h: 5 }, null])).toEqual({ x: 10, y: 0, w: 45, h: 20 });
    expect(unionBox([])).toBeUndefined();
  });
});

describe("the card's headline from Claude Code", () => {
  it("is asked for: a short title, what's wrong, why and the fix", () => {
    for (const k of ["title", "wrong", "cause", "fix"]) {
      expect(CARD_SCHEMA.required).toContain(k);
      expect((CARD_SCHEMA.properties as Record<string, unknown>)[k]).toBeTruthy();
    }
  });
  it("is read back, and an older answer without it still reads", () => {
    const a = readAnswer(JSON.stringify({ structured_output: { title: "Portal's sign-in cut off on phones", wrong: "The bottom is hidden.", cause: "It can't scroll.", fix: "It scrolls inside itself now.", summary: "s", why: "w", consequences: "", assessment: "", risks: [], verdict: "approve", reasons: [], changed: true } }));
    expect(a).toMatchObject({ title: "Portal's sign-in cut off on phones", wrong: "The bottom is hidden.", cause: "It can't scroll.", fix: "It scrolls inside itself now." });
    const old = readAnswer(JSON.stringify({ summary: "s", why: "w", verdict: "approve" }));
    expect(old).toMatchObject({ title: "", wrong: "", cause: "", fix: "", summary: "s" });
  });
});

// (The old Fixer page, one fix at a time, went on 16 Oct 2026 when the Fixer started again from the
// ground up: test/fixer-strict.spec.ts)

