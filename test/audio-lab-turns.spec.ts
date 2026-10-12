// The audio check shares its renders between a few browsers (scripts/audio-lab.mjs inTurns):
// never more at once than asked, each worker on one item at a time, results in the items' order.
import { describe, expect, it } from "vitest";
// @ts-ignore: a plain JavaScript helper (scripts/audio-lab.mjs)
import { inTurns } from "../scripts/audio-lab.mjs";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("inTurns", () => {
  it("runs every item, at most `workers` at once, one per worker, results in order", async () => {
    let running = 0, most = 0;
    const busy = new Set<number>();
    const items = [30, 5, 20, 1, 15, 8, 2, 12, 4];
    const out = await inTurns(items, 3, async (ms: number, w: number) => {
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThan(3);
      expect(busy.has(w)).toBe(false);
      busy.add(w); running++; most = Math.max(most, running);
      await wait(ms);
      busy.delete(w); running--;
      return ms * 2;
    });
    expect(out).toEqual(items.map((x) => x * 2));
    expect(most).toBe(3);
  });

  it("copes with fewer items than workers, no items, and a single worker", async () => {
    const used = new Set<number>();
    expect(await inTurns([1, 2], 4, async (x: number, w: number) => (used.add(w), x))).toEqual([1, 2]);
    expect(used.size).toBe(2);
    expect(await inTurns([], 4, async () => 1)).toEqual([]);
    expect(await inTurns(["a", "b", "c"], 1, async (x: string, w: number) => `${x}${w}`)).toEqual(["a0", "b0", "c0"]);
  });

  it("passes a failure on", async () => {
    await expect(inTurns([1, 2, 3], 2, async (x: number) => { if (x === 2) throw new Error("boom"); return x; })).rejects.toThrow("boom");
  });
});
