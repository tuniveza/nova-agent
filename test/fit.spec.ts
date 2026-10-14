// Fit on screen (web/shared/fit.js): a menu, pop-up or card past an edge is nudged back in just
// far enough, one bigger than the screen is capped (and scrolls inside), and a nudge is undone
// when it's no longer needed. The whole suite on real screens: scripts/check-fit-all.sh.
// Run: npm test
import { beforeAll, describe, expect, it } from "vitest";

let F: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window = g;
  // (still loading: the page watcher waits for DOMContentLoaded, which never comes here)
  g.document ??= { readyState: "loading", addEventListener: () => {} };
  await import("../web/shared/fit.js");
  F = g.NovaFit;
});

// A 360×640 phone, 8px in from each edge
const screen = { left: 8, top: 8, right: 352, bottom: 632 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("fitBox", () => {
  it("leaves a box that's on screen alone", () => {
    expect(F.fitBox(box(20, 40, 200, 300), screen)).toEqual({ dx: 0, dy: 0, maxW: 0, maxH: 0 });
  });

  it("nudges one past the right and bottom edges back in, just far enough", () => {
    expect(F.fitBox(box(300, 600, 200, 100), screen)).toEqual({ dx: -148, dy: -68, maxW: 0, maxH: 0 });
  });

  it("nudges one past the left and top edges back in", () => {
    expect(F.fitBox(box(-40, -10, 100, 100), screen)).toEqual({ dx: 48, dy: 18, maxW: 0, maxH: 0 });
  });

  it("caps one bigger than the screen and lines it up with the edge", () => {
    expect(F.fitBox(box(-20, 0, 500, 900), screen)).toEqual({ dx: 28, dy: 8, maxW: 344, maxH: 624 });
  });

  it("works out the nudge from where the box would be without the one it already has", () => {
    // Nudged 100px left before; the window grew, so where it was placed now fits: the nudge goes
    const wide = { left: 8, top: 8, right: 1432, bottom: 892 };
    expect(F.fitBox(box(200, 40, 200, 100), wide, { x: -100, y: 0 })).toEqual({ dx: 0, dy: 0, maxW: 0, maxH: 0 });
    // Still too far right on the phone: the same nudge stays
    expect(F.fitBox(box(152, 40, 200, 100), screen, { x: -148, y: 0 })).toEqual({ dx: -148, dy: 0, maxW: 0, maxH: 0 });
  });

  it("never gives a negative cap on a tiny screen", () => {
    const out = F.fitBox(box(0, 0, 50, 50), { left: 8, top: 8, right: 4, bottom: 4 });
    expect(out.maxW).toBe(0);
    expect(out.maxH).toBe(0);
  });
});
