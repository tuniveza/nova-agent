import { describe, expect, it } from "vitest";
import { drawPlanet } from "../src/visualizer/planet";

describe("planet badge drawn without Nova Bot", () => {
  it("draws a planet for the id, at the size asked for", async () => {
    const svg = await drawPlanet("tuniveza", new URLSearchParams("size=64"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="64"');
  });

  it("is the same planet every time for the same person", async () => {
    const a = await drawPlanet("tuniveza", new URLSearchParams("size=96"));
    const b = await drawPlanet("tuniveza", new URLSearchParams("size=96"));
    const other = await drawPlanet("someone-else", new URLSearchParams("size=96"));
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it("keeps the size within bounds and moves only when asked", async () => {
    expect(await drawPlanet("x", new URLSearchParams("size=99999"))).toContain('width="1024"');
    expect(await drawPlanet("x", new URLSearchParams("size=224&animate=1"))).toContain("<animate");
    expect(await drawPlanet("x", new URLSearchParams("size=224"))).not.toContain("<animate");
  });
});
