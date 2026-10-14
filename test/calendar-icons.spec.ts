// Calendar's icons (web/calendar/js/presets.js): one modern line family, every day-card kind has
// its own drawing, and an icon that stands alone says what it is (aria-label + tooltip).  Run: npm test
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type Presets = { list: () => { id: string; icon: string }[]; icon: (name: string, cls?: string, label?: string) => string };
function load(): Presets {
  const window: { NT?: { presets: Presets } } = {};
  runInNewContext(readFileSync(new URL("../web/calendar/js/presets.js", import.meta.url), "utf8"), { window });
  return window.NT!.presets;
}
const drawing = (svg: string) => svg.replace(/^<svg[^>]*>(<title>[^<]*<\/title>)?/, "").replace(/<\/svg>$/, "");

describe("Calendar's icons", () => {
  const p = load();

  it("are one family: 2px strokes, round ends and joins, in the colour around them", () => {
    const svg = p.icon("mic");
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('stroke="currentColor"');
  });

  it("every day-card kind has a real drawing of its own (none fall back to the plain card)", () => {
    const card = drawing(p.icon("card"));
    for (const preset of p.list()) expect(drawing(p.icon(preset.icon)), preset.id).not.toBe(card);
  });

  it("the seasonal days look like what they are", () => {
    const icon = (id: string) => p.list().find((x) => x.id === id)!.icon;
    expect(icon("halloween")).toBe("ghost");
    expect(icon("bonfire")).toBe("flame");
    expect(icon("newyear")).toBe("party");
    expect(icon("trip")).toBe("luggage");
    expect(icon("birthday")).toBe("cake");
  });

  it("next to words it's hidden from screen readers; on its own it has a name and a tooltip", () => {
    expect(p.icon("quest")).toContain('aria-hidden="true"');
    const alone = p.icon("quest", "", "Quest");
    expect(alone).toContain('role="img"');
    expect(alone).toContain('aria-label="Quest"');
    expect(alone).toContain("<title>Quest</title>");
    expect(alone).not.toContain("aria-hidden");
  });

  it("a name can't break out of the icon", () => {
    expect(p.icon("card", "", '<b onmouseover="x">')).not.toMatch(/<b |onmouseover="/);
  });

  it("an unknown name still draws something sensible (a note card)", () => {
    expect(drawing(p.icon("no-such-icon"))).toBe(drawing(p.icon("card")));
  });
});
