// The colour spectrum (web/shared/spectrum.js): every hand-tuned theme, and the Custom theme at any
// hue and vividness, keeps its text readable (WCAG AA, 4.5 or more) and comes in rainbow order.
// Run: npm test
import { beforeAll, describe, expect, it } from "vitest";

let S: any;
const saved = new Map<string, string>();
beforeAll(async () => {
  const g = globalThis as any;
  g.window = g;
  g.localStorage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, String(v)) };
  g.CustomEvent ??= class extends Event {
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      super(type);
      this.detail = init?.detail;
    }
  };
  g.dispatchEvent ??= () => true;
  await import("../web/shared/spectrum.js");
  S = g.NovaSpectrum;
});

// The pairs that must read: text and dim text on the panels, button text on both ends of the
// button gradient, and the bright highlight (used for links and labels) on the panels
function failures(t: any) {
  const pairs: [string, string, string][] = [
    ["text on panel", t.text, t.panel],
    ["text on panel-2", t.text, t.panel2],
    ["muted on panel-2", t.muted, t.panel2],
    ["button text on accent", t.onAccent, t.accent],
    ["button text on accent-2", t.onAccent, t.accent2],
    ["highlight on panel-2", t.hi, t.panel2],
  ];
  return pairs.filter(([, a, b]) => S.contrast(a, b) < 4.5).map(([name, a, b]) => `${name} ${a}/${b} ${S.contrast(a, b).toFixed(2)}`);
}

describe("the spectrum's themes", () => {
  it("has eleven, each complete, with ids nothing else uses", () => {
    expect(S.themes.map((t: any) => t.id)).toEqual(["crimson", "rose", "coral", "amber", "lime", "jade", "teal", "glacier", "indigo", "violet", "orchid"]);
    const fields = ["void", "deep", "panel", "panel2", "text", "muted", "accent", "accent2", "accent3", "hi", "soft", "gold", "lilac", "onAccent"];
    for (const t of S.themes) for (const f of fields) expect(t[f], `${t.id}.${f}`).toMatch(/^#[0-9A-F]{6}$/);
    for (const old of ["cosmic", "ember", "aurora", "ocean", "gold", "mono", "novacane", "solar", "pulsar", "eclipse", "quasar", "custom"]) {
      expect(S.themes.some((t: any) => t.id === old)).toBe(false);
    }
  });
  it("keeps every theme's text readable", () => {
    for (const t of S.themes) expect(failures(t), t.id).toEqual([]);
  });
  it("puts themes in rainbow order, Cosmic's magenta first and greys last", () => {
    const list = [
      { id: "mono", accent: "#6A6A74" },
      { id: "teal", accent: "#007270" },
      { id: "cosmic", accent: "#B01D68" },
      { id: "amber", accent: "#FFA838" },
      { id: "indigo", accent: "#3250D8" },
    ];
    expect(S.order(list).map((t: any) => t.id)).toEqual(["cosmic", "amber", "teal", "indigo", "mono"]);
  });
});

describe("the Custom theme", () => {
  it("is readable at every hue and vividness", () => {
    for (let hue = 0; hue < 360; hue += 5) {
      for (const vivid of [0, 25, 50, 75, 100]) expect(failures(S.fromHue(hue, vivid)), `hue ${hue}, vividness ${vivid}`).toEqual([]);
    }
  });
  it("is remembered on this device, and starts as a calm blue-green", () => {
    saved.clear();
    expect(S.getCustom()).toEqual({ hue: 200, vivid: 70 });
    S.setCustom({ hue: 412, vivid: 130 });
    expect(JSON.parse(saved.get("nova-look-custom")!)).toEqual({ hue: 52, vivid: 100 });
    expect(S.getCustom()).toEqual({ hue: 52, vivid: 100 });
    expect(S.custom().accent).toBe(S.fromHue(52, 100).accent);
  });
  it("falls back to the default when what's saved is broken", () => {
    saved.set("nova-look-custom", "{not json");
    expect(S.getCustom()).toEqual({ hue: 200, vivid: 70 });
  });
});
