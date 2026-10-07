// Tests for the planet generator. Run from the np folder:  node --test planet/test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generatePlanet, renderPlanetSVG, planetToDataURI, planetName, describePlanet, validateOverrides,
  fnv1a32, mulberry32, DRAW_ORDER, novaTheme,
} from "./index.js";

// A small XML check: every tag is closed in order, attributes are quoted,
// every url(#id) points at something defined, ids are not repeated, no NaN.
function checkSVG(svg) {
  assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"), "starts and ends as an svg");
  assert.ok(!/NaN|undefined|Infinity|null/.test(svg), "no NaN, undefined, Infinity or null in the markup");
  const stack = [];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<([^>]*)>/g;
  let m, last = 0;
  while ((m = tagRe.exec(svg))) {
    const between = svg.slice(last, m.index);
    assert.ok(!/[<>]/.test(between), `stray angle bracket near: ${between.slice(0, 60)}`);
    last = tagRe.lastIndex;
    if (m[5] !== undefined) assert.fail(`badly formed tag: <${m[5].slice(0, 80)}>`);
    const [, closing, name, , selfClosing] = m;
    if (closing) assert.equal(stack.pop(), name, `</${name}> closes the right tag`);
    else if (!selfClosing) stack.push(name);
  }
  assert.equal(stack.length, 0, `all tags closed (open: ${stack.join(",")})`);
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(ids).size, ids.length, "no repeated ids");
  for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(ref), `url(#${ref}) is defined`);
  return ids;
}

const seeds = Array.from({ length: 48 }, (_, i) => `staff-${i + 1}`);

test("the random numbers match the documented reference values", () => {
  assert.equal(fnv1a32(""), 0x811c9dc5);
  assert.equal(fnv1a32("a"), 0xe40c292c);
  assert.equal(fnv1a32("staff-1"), 0x0e97795f);
  assert.equal(fnv1a32("Ünïcødé 🪐"), 0xfdc3c33f);
  const r = mulberry32(0);
  assert.equal(r(), 0.26642920868471265);
  assert.equal(r(), 0.0003297457005828619);
  assert.equal(r(), 0.2232720274478197);
  assert.equal(DRAW_ORDER.length, 45);
});

test("the same seed always gives the same planet and the same SVG", () => {
  for (const seed of seeds.slice(0, 12)) {
    const a = generatePlanet(seed, novaTheme), b = generatePlanet(seed, novaTheme);
    assert.deepEqual(a, b);
    for (const opts of [{ size: 32 }, { size: 96 }, { size: 512, animate: true, background: true }]) {
      assert.equal(renderPlanetSVG(a, opts), renderPlanetSVG(b, opts));
    }
    // A planet survives a trip through JSON (it can be cached or sent to a client)
    assert.equal(renderPlanetSVG(JSON.parse(JSON.stringify(a))), renderPlanetSVG(a));
  }
  const first = generatePlanet("staff-1", novaTheme);
  assert.equal(first.surface, "ringed");
  assert.equal(first.palette, "violet-cyan");
  assert.equal(first.description, "Ringed gas giant · violet & cyan");
});

test("different seeds give different planets", () => {
  const planets = seeds.map((s) => generatePlanet(s, novaTheme));
  const svgs = new Set(planets.map((p) => renderPlanetSVG(p, { size: 96 })));
  assert.equal(svgs.size, seeds.length, "every SVG is different");
  const looks = new Set(planets.map((p) => `${p.surface}|${p.palette}|${p.moons.length}|${Boolean(p.rings)}`));
  assert.ok(looks.size >= 30, `at least 30 of 48 differ in their main traits (got ${looks.size})`);
  assert.ok(new Set(planets.map((p) => p.palette)).size >= 7, "most palettes show up");
  assert.ok(new Set(planets.map((p) => Math.round(p.rotation))).size >= 30, "each sits at its own angle");
});

test("every kind of planet, and every feature, comes up over many seeds", () => {
  const surfaces = new Set(), renderers = new Set(), moonCounts = new Set();
  let rings = 0, aurora = 0, storm = 0;
  for (let i = 0; i < 2000; i++) {
    const p = generatePlanet(`member-${i}`, novaTheme);
    surfaces.add(p.surface);
    renderers.add(`${p.surface}/${p.renderer}`);
    moonCounts.add(p.moons.length);
    rings += p.rings ? 1 : 0;
    aurora += p.aurora ? 1 : 0;
    storm += p.storm ? 1 : 0;
  }
  assert.deepEqual([...surfaces].sort(), novaTheme.surfaces.map((s) => s.id).sort());
  assert.ok(renderers.has("ringed/bands") && renderers.has("ringed/frost"), "ringed planets are gas and ice giants");
  assert.deepEqual([...moonCounts].sort(), [0, 1, 2, 3]);
  assert.ok(rings > 100 && aurora > 100 && storm > 100);
});

test("overrides pin traits without moving any other trait", () => {
  const base = generatePlanet("staff-9", novaTheme);
  const pinned = generatePlanet("staff-9", novaTheme, { surface: "ocean", palette: "cyan-teal", rings: true, moons: 3, hueShift: 0 });
  assert.equal(pinned.surface, "ocean");
  assert.equal(pinned.palette, "cyan-teal");
  assert.ok(pinned.rings);
  assert.equal(pinned.moons.length, 3);
  assert.equal(pinned.hueShift, 0);
  assert.equal(pinned.rotation, base.rotation, "the rotation was not pinned, so it stays");
  assert.equal(pinned.viewTilt, base.viewTilt);
  assert.deepEqual(pinned.seeds, base.seeds);
  // A palette can be pinned by index too, and JSON text from the database works
  const byIndex = generatePlanet("staff-9", novaTheme, JSON.stringify({ palette: 2, rings: false, moons: 0, aurora: true }));
  assert.equal(byIndex.palette, novaTheme.palettes[2].id);
  assert.equal(byIndex.rings, null);
  assert.equal(byIndex.moons.length, 0);
  assert.ok(byIndex.aurora);
  checkSVG(renderPlanetSVG(pinned, { size: 256 }));
});

test("overrides are checked against the theme", () => {
  const { overrides, errors } = validateOverrides({ surface: "lava-lamp", palette: 99, moons: 7, rings: "yes", hueShift: 12, wings: 2 }, novaTheme);
  assert.deepEqual(overrides, { hueShift: 12 });
  assert.equal(errors.length, 5);
  assert.deepEqual(validateOverrides("{not json", novaTheme).errors, ["overrides are not valid JSON"]);
  assert.deepEqual(validateOverrides(null, novaTheme), { overrides: {}, errors: [] });
  // Bad overrides never break a planet: they are simply ignored
  assert.deepEqual(generatePlanet("staff-3", novaTheme, { surface: "nope", moons: -1 }), generatePlanet("staff-3", novaTheme));
});

// A different world entirely: new ramps, palettes, kinds of planet and words.
// Nothing in the generator changes.
const lore = {
  ...novaTheme,
  id: "lore",
  colors: { ...novaTheme.colors, shade: "#020403", frost: "#EFFFF4", cloud: "#F4FFF6", dust: "#9FA88C", space: "#0B1A12" },
  ramps: {
    moss: ["#0B1A0D", "#1F3D1E", "#3E6B2F", "#7FAF4E", "#CDEB9A"],
    clay: ["#21110A", "#4D2716", "#8A4A26", "#C98A52", "#F0CFA0"],
    sky: ["#081826", "#12385A", "#2468A0", "#58A6D6", "#BFE4F7"],
  },
  palettes: [
    { id: "moss-clay", label: "moss & clay", weight: 1, a: "moss", b: "clay", accent: "clay.3", glow: ["moss.3"] },
    { id: "sky-moss", label: "sky & moss", weight: 1, a: "sky", b: "moss", accent: "moss.4", glow: ["sky.3"] },
  ],
  shading: { ...novaTheme.shading, hueShift: [0, 0] },
  surfaces: [
    {
      id: "jungle", weight: 1, renderer: "continents", rings: 0, storm: 0.5, aurora: 0, clouds: [0.4, 0.8],
      colors: { sea: "a1", seaDeep: "a0", shallows: "a3", land: "b2", landHigh: "b3", ice: "@frost" },
      look: { continents: [2, 4], size: [18, 30], islands: 4, islandSize: [3, 6], deeps: 2, roughness: 0.5, iceCaps: 0.3, capLatitude: [70, 78] },
    },
    {
      id: "dune", weight: 1, renderer: "craters", rings: 0.5, storm: 0, aurora: 0, clouds: [0, 0],
      colors: { base: "b2", light: "b3", dark: "b1", crater: "b0", rim: "b4" },
      look: { patches: 5, patchSize: [12, 28], craters: 10, craterSize: [2, 10] },
    },
  ],
  aurora: { ...novaTheme.aurora, colors: ["glow"] },
  moons: { ...novaTheme.moons, colors: ["@dust", "b3"] },
  rings: { ...novaTheme.rings, styles: [{ id: "dust", weight: 1, colors: ["b3", "b4"], opacity: [0.4, 0.8], bands: [3, 5], gaps: 0.2 }] },
  motifs: [{ kind: "sparkle", chance: 0.5, color: "@frost", count: [1, 2], size: [1.5, 3], distance: [1.3, 1.8] }],
  background: { colors: ["@space", "@shade"], nebula: ["a2"], nebulaOpacity: 0.25, stars: ["@frost"], starCount: [0, 8, 20, 50] },
  naming: {
    join: " / ",
    type: (p) => ({ jungle: "Jungle world", dune: "Dune world" })[p.surface],
    palette: (p, palette) => palette.label,
    moons: (n) => (n ? `${n} moon${n > 1 ? "s" : ""}` : "moonless"),
    name: (p, rand) => `Holdfast ${1 + Math.floor(rand() * 99)}`,
  },
};

test("a lore theme with its own palettes and kinds of planet needs no generator change", () => {
  const novaStops = new Set(Object.values(novaTheme.ramps).flat().map((c) => c.toUpperCase()));
  const loreIds = lore.palettes.map((p) => p.id);
  const kinds = new Set();
  for (const seed of seeds) {
    const p = generatePlanet(seed, lore);
    kinds.add(p.surface);
    assert.ok(["jungle", "dune"].includes(p.surface));
    assert.ok(loreIds.includes(p.palette));
    for (const c of Object.values(p.colors).flat()) assert.ok(!novaStops.has(c), `${c} is not a Nova colour`);
    assert.match(p.description, /^(Jungle|Dune) world \/ (moss & clay|sky & moss) \/ (moonless|\d moons?)$/);
    assert.match(planetName(p, lore), /^Holdfast \d+$/);
    checkSVG(renderPlanetSVG(p, { size: 256, background: true }));
  }
  assert.equal(kinds.size, 2);
  // The same seed is a different planet in a different theme
  assert.notEqual(describePlanet(generatePlanet("staff-1", lore), lore), generatePlanet("staff-1", novaTheme).description);
});

test("a theme missing what a style needs fails with a clear message", () => {
  const broken = { ...lore, surfaces: [{ ...lore.surfaces[0], colors: { sea: "a1" } }] };
  assert.throws(() => generatePlanet("x", broken), /needs colour "seaDeep"/);
  assert.throws(() => generatePlanet("x", { ...lore, surfaces: [{ ...lore.surfaces[1], renderer: "plasma" }] }), /unknown renderer "plasma"/);
  assert.throws(() => generatePlanet("x", {}), /needs a theme/);
});

test("the SVG is well formed at every size, still and animated", () => {
  for (const seed of seeds) {
    const p = generatePlanet(seed, novaTheme);
    for (const opts of [{ size: 24 }, { size: 32 }, { size: 48 }, { size: 96 }, { size: 512, animate: true, background: true }]) {
      const svg = renderPlanetSVG(p, opts);
      checkSVG(svg);
      assert.ok(svg.includes(`width="${opts.size}"`));
      assert.ok(svg.includes(`aria-label="${p.description.replace(/&/g, "&amp;")}"`));
    }
  }
  // Small badges are simpler than the hero
  const p = generatePlanet("staff-2", novaTheme);
  assert.ok(renderPlanetSVG(p, { size: 32 }).length < renderPlanetSVG(p, { size: 512 }).length / 2);
  assert.ok(renderPlanetSVG(p, { size: 512, animate: true }).includes("<animate"));
  assert.ok(!renderPlanetSVG(p, { size: 512 }).includes("<animate"));
});

test("ids never clash between planets on one page", () => {
  const a = generatePlanet("staff-1", novaTheme), b = generatePlanet("staff-2", novaTheme);
  const idsA = checkSVG(renderPlanetSVG(a, { size: 96 }));
  const idsB = checkSVG(renderPlanetSVG(b, { size: 96 }));
  assert.equal(idsA.filter((x) => idsB.includes(x)).length, 0);
  // The same planet as a badge and as the hero can share a page too
  const hero = checkSVG(renderPlanetSVG(a, { size: 512, animate: true }));
  assert.equal(idsA.filter((x) => hero.includes(x)).length, 0);
  // An explicit prefix wins (and is made safe)
  const custom = checkSVG(renderPlanetSVG(a, { idPrefix: "card 7" }));
  assert.ok(custom.every((x) => x.startsWith("card_7-")));
});

test("data URIs decode back to the SVG", () => {
  const svg = renderPlanetSVG(generatePlanet("staff-4", novaTheme), { size: 48 });
  const uri = planetToDataURI(svg);
  assert.ok(uri.startsWith("data:image/svg+xml;charset=utf-8,"));
  assert.equal(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)), svg);
});
