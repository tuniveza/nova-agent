# Nova planets

Every Nova Agent member gets a planet drawn from their id. It is their identity
badge: the same planet on the web, in the Worker's server-rendered pages and in
Nova Club on Android.

- **Pure and deterministic.** The same seed and theme always give the same
  planet on any machine. There is no `Math.random` and no `Date`.
- **Themeable.** All art direction lives in a theme object. The generator only
  knows how to draw. The studio's lore will be a new theme file, with no change
  to the generator.
- **Runs anywhere.** Plain ES modules with JSDoc types and no build step. It
  works in a Cloudflare Worker, in browsers and in Node. The SVG comes back as a
  string, so it needs no DOM.

```
planet/
  generator.js     the core: random numbers, traits, SVG drawing
  themes/nova.js   the Nova placeholder theme
  index.js         re-exports everything (and the Nova theme as novaTheme)
  test.mjs         node --test planet/test.mjs
  gallery.html     local demo (serve the np folder, open /planet/gallery.html)
```

## Using it

```js
import { generatePlanet, renderPlanetSVG, planetToDataURI, describePlanet, novaTheme } from "./planet/index.js";

const planet = generatePlanet(member.id, novaTheme, member.planet_overrides); // plain JSON-safe data
const badge = renderPlanetSVG(planet, { size: 32 });                           // "<svg ...>"
const hero = renderPlanetSVG(planet, { size: 512, animate: true, background: true });
const img = `<img src="${planetToDataURI(badge)}" alt="${planet.description}">`;
```

### API

| Function | Returns |
| --- | --- |
| `generatePlanet(seed, theme, overrides?)` | a planet: plain data with every trait resolved (colours as hex). Also carries `name` and `description`. |
| `renderPlanetSVG(planet, { size = 256, background = false, animate = false, idPrefix, detail })` | SVG markup as a string. `detail` (0 to 3) is normally worked out from `size`. |
| `planetToDataURI(svg)` | `data:image/svg+xml;charset=utf-8,...` for `<img src>` or CSS |
| `planetName(planet, theme)` | the planet's proper name, e.g. `"Ioae IV"` |
| `describePlanet(planet, theme)` | a short line for alt text and captions, e.g. `"Ringed gas giant · magenta & gold · 2 moons"` |
| `validateOverrides(overrides, theme)` | `{ overrides, errors }`. Bad values are dropped and listed, never thrown. |
| `detailForSize(size)` | 0 below 40px, 1 below 64px, 2 below 160px, otherwise 3 |
| `fnv1a32(text)`, `mulberry32(seed)`, `DRAW_ORDER` | the random-number pieces, exported for tests and ports |

Rendering reads only the planet object, never the theme. So the Worker can cache
or send planet JSON, and any client can draw it.

**Ids.** Every gradient, filter and clip id starts with a prefix. By default
the prefix comes from the seed, the theme, the overrides, the size, the detail
level and the animate/background flags. Different planets, and one planet at
several sizes, can share a page. If you show the very same planet at the very
same size twice on one page, pass your own `idPrefix`.

**Animation** (`animate: true`, meant for the hero) uses SMIL only, so it also
works inside `<img>` and data URIs. Bands drift as zonal winds, clouds travel
round the planet, the glow pulses, moons orbit (passing behind the planet and
in front of it), aurora and lava flicker, and stars and sparkles twinkle. For
people who prefer reduced motion, render with `animate: false`.

**Sizes.** The `detail` level simplifies small badges. At 24 to 32px (detail 0)
the planet has fewer and bolder bands, craters and cracks, and no wave on band
edges. It also has no moons, rings pulled in and merged into two clear bands,
and no storms, aurora or sparkles. The planet fills more of the square. The
512px hero (detail 3) adds band swirls (feTurbulence), thin streaks, ring
shadows, orbit trails, highland relief, glints on big stars and every moon.

### Overrides

`planet_overrides` from the database, as an object or JSON text, can pin any of:

| Key | Value |
| --- | --- |
| `surface` | a surface id from the theme, e.g. `"ocean"` |
| `palette` (or `paletteIndex`) | a palette id or its index in `theme.palettes` |
| `rings`, `aurora`, `storm` | `true` / `false` |
| `moons` | 0 to 3 |
| `hueShift` | degrees, -180 to 180 |
| `rotation` | degrees, -90 to 90 |
| `glow` | glow intensity, 0 to 1 |
| `clouds` | cloud cover, 0 to 1 |

Pinning one trait never moves the others. Every number is drawn before any
override is applied (see the draw order below). A planet with `{ moons: 3 }`
keeps its angle, colours and storm.

## The traits

| Trait | From |
| --- | --- |
| Surface kind | weighted pick from `theme.surfaces` |
| Drawing style | `bands` (gas giant), `craters` (rock), `continents` (ocean), `cracks` (molten), `frost` (ice). A surface can list several; `ringed` in Nova is a gas or ice giant. |
| Palette | weighted pick among the palettes that surface likes, then a small hue shift |
| Pose | rotation (axial tilt on screen) and view tilt (how far the north pole leans towards us; the rings and moon orbits use the same tilt) |
| Glow | colour (from the palette's glow list), intensity, spread |
| Rings | chance per surface; style, inner radius, width, then bands and gaps from the ring stream |
| Moons | 0 to 3 by weight; each has an angle, distance, size, colour, orbit period and inclination |
| Aurora | chance per surface; an oval round the visible pole that glows on the night side |
| Storm | chance per surface; an oval vortex on gas giants, a cloud spiral elsewhere |
| Clouds | cover range per surface; streaks along the latitudes |
| Motifs | sparkles near the planet, faint orbit trails |
| Name | the theme's `naming.name`, fed the planet's own random stream |

The 3D look is built in these layers:

1. Glow halo behind the planet.
2. Far half of the rings, with the planet's shadow falling across them.
3. Moons on the far half of their orbits.
4. The sphere, clipped to its circle. On it, in order: the surface, then clouds,
   then the rings' shadow, then limb darkening, then the terminator shadow (an
   offset radial gradient). Next come the glowing layers (lava, aurora), which
   show on the night side too. Last come the rim atmosphere, a specular
   highlight, a gloss spot on oceans and ice, and a lit rim.
5. Near half of the rings, drawn only where they cross in front of the sphere.
   This leaves no seam.
6. Near moons and sparkles.

The surface is projected onto a real sphere. Band edges and polar caps curve
with the view tilt. Continents and craters foreshorten towards the edge. Long
ice cracks follow great circles. Continents and blobs are radial shapes with a
few smooth wobbles, joined as closed Catmull-Rom curves.

## Writing a theme

Copy `themes/nova.js` and change anything. A theme can also spread another one
(`{ ...novaTheme, id: "lore", palettes, surfaces }`). The tests build a "lore"
theme like that, with its own ramps, palettes, two new kinds of planet and new
words, and the generator is unchanged.

The shape of a theme:

```js
{
  id, name,
  colors: { shade, frost, cloud, dust, ... },      // fixed colours, used as "@name"
  ramps: { magenta: [5 stops, dark → light], ... },
  palettes: [{ id, label, weight, a: "magenta", b: "gold", accent: "gold.3", glow: ["magenta.3", "gold.3"] }],
  surfaces: [{
    id, weight, renderer,                          // or renderer: ["bands", "frost"]
    palettes?: [ids], rings, storm, aurora,        // chances, 0 to 1
    clouds: [min, max], gloss?,
    colors: { role: colourRef },                   // roles per drawing style, below
    look: { ... },                                 // numbers per drawing style, below
    variants?: { frost: { colors, look } },        // overrides when that style is chosen
  }],
  shading: { light: [x, y], terminator, limb, specular, shade, specularColor, viewTilt: [min, max], rotation: [min, max], hueShift: [min, max] },
  glow: { intensity: [min, max], spread: [min, max], rim },
  blur: { surface, clouds, glow },                 // softness for a planet of radius 30
  layout: { padding, minRadius, maxRadius },       // in a 100-unit square
  clouds: { color, opacity: [min, max], count, thickness: [deg, deg], length: [deg, deg] },
  rings: { inner: [min, max], width: [min, max], shadow, styles: [{ id, weight, colors: [refs], opacity: [min, max], bands: [min, max], gaps }] },
  moons: { weights: [w0, w1, w2, w3], distance, size, colors: [refs], period: [s, s], inclination: [deg, deg] },
  aurora: { colors: [refs], latitude, width, opacity },
  storm: { latitude: [deg, deg], longitude: [deg, deg], size: [deg, deg] },
  motifs: [{ kind: "sparkle", chance, color, count, size, distance }, { kind: "orbits", chance, color, opacity }],
  background: { colors: [inner, outer], nebula: [refs], nebulaOpacity, stars: [refs], starCount: [d0, d1, d2, d3] },
  naming: { join, type(planet), palette(planet, palette), moons(count), extra?(planet), name(planet, rand) },
}
```

**Colour references.** Anywhere a theme names a colour, it can write:

| Reference | Meaning |
| --- | --- |
| `a0` … `a4`, `b0` … `b4` | stops of the palette's two ramps, dark to light |
| `accent` | the palette's accent |
| `glow` | the planet's glow colour (picked from the palette's `glow` list) |
| `gold.3` | stop 3 of the named ramp `gold` |
| `@frost` | `theme.colors.frost`: a fixed colour, never hue-shifted |
| `#AABBCC` | a literal colour, never hue-shifted |
| `a3+@white:0.4` | a mix of two references (0 = all left, 1 = all right, default 0.5) |

**Colour roles and look settings per drawing style.** A missing one fails with
a clear message naming the surface and the setting.

| Style | Colour roles | Look |
| --- | --- | --- |
| `bands` | `base`, `zones` (list), `belts` (list), `storm`, `stormEye` | `bands: [min, max]`, `wave: [deg, deg]`, `blend`, `streaks`, `turbulence`, `drift: [s, s]` |
| `craters` | `base`, `light`, `dark`, `crater`, `rim` | `patches`, `patchSize: [deg, deg]`, `craters`, `craterSize: [deg, deg]` |
| `continents` | `sea`, `seaDeep`, `shallows`, `land`, `landHigh`, `ice` | `continents: [min, max]`, `size`, `islands`, `islandSize`, `deeps`, `roughness`, `iceCaps` (chance), `capLatitude` |
| `cracks` | `base`, `plate`, `crack`, `core`, `lava` | `plates`, `pools`, `poolSize`, `cracks`, `step` (deg), `crackWidth` |
| `frost` | `base`, `light`, `streak`, `crack` | `streaks`, `lineae`, `cracks`, `step`, `iceCaps`, `capLatitude` |

Every style also uses `cloud`, `shade`, `specular` and `glow`, from the shared
settings.

**Naming.** `naming.type(planet)` names the kind ("Ringed gas giant").
`naming.palette(planet, palette)` names the colours. `naming.moons(n)` gives the
moons part; an empty string drops it. `naming.name(planet, rand)` makes a
proper name. `rand` is the planet's own seeded stream, so use it rather than
`Math.random`. `describePlanet` joins the non-empty parts with `naming.join`.

## The random numbers (exact, for ports)

**Seed hash: FNV-1a, 32 bit, over the UTF-8 bytes of the seed text.**

```
h = 0x811c9dc5
for each byte b:  h = (h XOR b) * 0x01000193   (mod 2^32)
```

**Stream: mulberry32** (the standard one), seeded with that hash:

```
a = (a + 0x6D2B79F5) | 0
t = imul(a XOR (a >>> 15), a | 1)
t = t XOR (t + imul(t XOR (t >>> 7), t | 61))
return ((t XOR (t >>> 14)) >>> 0) / 4294967296
```

Reference values, checked by the tests:

- `fnv1a32("") = 0x811c9dc5`
- `fnv1a32("a") = 0xe40c292c`
- `fnv1a32("staff-1") = 0x0e97795f`
- `fnv1a32("Ünïcødé 🪐") = 0xfdc3c33f`
- `mulberry32(0)` gives `0.26642920868471265`, then `0.0003297457005828619`, then `0.2232720274478197`
- `"staff-1"` with the Nova theme is a "Ringed gas giant · violet & cyan" named "Ioae IV"

**Helpers.**

- `range([lo, hi], r) = lo + r * (hi - lo)`.
- `pickIndex(r, n) = min(n - 1, floor(r * n))`.
- Weighted pick: `t = r * sum(weights)`. Subtract each weight in turn and take
  the first index where `t < 0`.
- A sub-stream seed is `floor(r * 2^32)`. This is exact, because `r` is a
  32-bit value divided by 2^32.

### Draw order: the main stream (45 numbers, always all of them)

```
 0 surface        1 renderer      2 palette        3 hueShift      4 rotation
 5 viewTilt       6 glowColor     7 glowIntensity  8 glowSpread    9 rings (roll)
10 ringStyle     11 ringInner    12 ringWidth     13 moonCount    14 aurora (roll)
15 auroraColor   16 storm (roll) 17 stormLat      18 stormLon     19 stormSize
20 clouds (cover)
21-38 three moon slots, 6 each: angle, distance, size, color, period, inclination
39 detailSeed    40 cloudSeed    41 ringSeed      42 starSeed     43 motifSeed    44 nameSeed
```

All 45 are taken first, then turned into traits:

- **Surface.** A weighted pick, unless pinned.
- **Palette.** A weighted pick among the surface's `palettes`. It uses all
  palettes when there is no list.
- **Booleans.** A boolean is on when its roll is below the surface's chance.
- **Moon count.** A weighted index into `moons.weights`, capped at 3. Moon `i`
  uses slot `i`.

### Sub-streams

Each sub-stream is `mulberry32(seed)`. Each always draws its full list, and
smaller detail levels just draw fewer of the results. So a badge is a simpler
view of the very same planet.

- **Ring stream.** First a band count `n`. Then `n` widths (each `0.35 + r`,
  then scaled to fit). Then for each band: colour pick, opacity, gap roll.
  Inner and outer bands are never gaps.
- **Motif stream.** For each motif in theme order, a roll. A sparkle motif then
  takes a count, and then `count[1]` × (angle, distance, size).
- **Cloud stream.** `clouds.count` × (lat, lon, length, thickness, wave amount,
  wave frequency, phase, opacity).
- **Star stream.** First 2 nebulae × (x, y, rx, ry factor, colour, angle). Then
  `max(starCount)` × (x, y, size, colour, brightness, twinkle).
- **Name stream.** Given to `naming.name`.
- **Detail stream.** Its draws depend on the drawing style:
  - A *blob* is 11 numbers: lat, lon, size, then 4 × (wobble amount, wobble phase).
  - A *walk* is 17 numbers: lat, lon, heading, steps, 12 turns, width.
  - `bands`: a count `n`; then `n` × (jitter, colour pick, blend, wave amount,
    wave frequency, phase, weight, speed); then `streaks` × (lat, lon, length,
    thickness, colour pick, opacity, tone).
  - `craters`: `patches` × (blob + tone); then `craters` × (lat, lon, size, tone).
  - `continents`: a count; then `continents[1]` blobs, `islands` blobs and
    `deeps` blobs; then capRoll, north cap, south cap, cap wave, cap phase.
  - `cracks`: `plates` × (blob + tone), then `pools` blobs, then `cracks` walks.
  - `frost`: `streaks` × (lat, lon, length, thickness, tone, opacity, wave);
    then `lineae` × (u, theta, t0, span, wobble, frequency, phase, width); then
    `cracks` walks; then capRoll and cap latitude.

`generator.js` is the reference: each renderer starts by taking its numbers in
exactly this order, before drawing anything.

## Porting to Kotlin (Nova Club, Jetpack Compose Canvas)

There are two ways to do it.

**1. Fetch the planet, port only the drawing.** The Worker serves
`generatePlanet(...)` as JSON, and the app draws it. This is the least work:
traits always match because one implementation makes them.

**2. Port the generator too.** Do this for offline use or for previews of
overrides. Port `fnv1a32`, `mulberry32`, the draw order and the theme. The
traits will then be identical:

```kotlin
fun fnv1a32(text: String): Int {
    var h = 0x811c9dc5.toInt()
    for (b in text.toByteArray(Charsets.UTF_8)) h = (h xor (b.toInt() and 0xFF)) * 0x01000193
    return h
}

class Mulberry32(seed: Int) {
    private var a = seed
    fun next(): Double {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (a or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
    }
}
```

Kotlin `Int` arithmetic wraps exactly like `Math.imul` and `| 0`, and `ushr` is
`>>>`. Use `Double` everywhere, as JavaScript does. For colours, `roundToInt()`
on values that are never negative matches `Math.round`. The theme's `naming`
functions are code, so port them too.

**Drawing with Compose.**

- Work in a 100 × 100 space centred on 0. Use
  `withTransform({ translate(size/2); scale(size.minDimension / 100f) })`.
- SVG paths map to `Path`:
  - `M` becomes `moveTo`.
  - `L` becomes `lineTo`.
  - `C` becomes `cubicTo`.
  - Full circles become `addOval`.
  - Limb arcs become `arcTo` on the rim circle.
- The "south of a latitude" region uses `PathFillType.EvenOdd`.
- Use `clipPath(sphere)` for everything on the planet. Use `rotate(rotation)`
  for the surface layer, and `scale(1f, sin(viewTilt))` for the rings.
- Radial gradients map to `Brush.radialGradient(colorStops, center, radius)`:
  - The terminator: the centre is shifted 0.55·R towards the light.
  - The limb, halo and atmosphere: centred.
- For blur:
  - Android 12+: use `Modifier.graphicsLayer { renderEffect = BlurEffect(...) }`
    on a layer.
  - Older versions: draw to `drawIntoCanvas` with a `Paint` that has
    `BlurMaskFilter`.
  - Scale the theme's blur numbers by `R / 30`, as the SVG does.
- Rings:
  1. Draw the whole ring behind the sphere.
  2. Draw the sphere.
  3. Draw the near half again, clipped to the sphere and to `y > 0` in ring
     space.
- For moons, draw the far ones (`sin(angle) < 0`) before the sphere and the
  near ones after.
- For animation, use `rememberInfiniteTransition`:
  - Shift band wave phases and cloud longitudes, as the SVG keyframes do.
  - Move moons along their orbit angle.
  - Pulse the halo alpha between 0.82 and 1.
- Use `detailForSize` on the dp size (24dp badge → 0, hero → 3) to match the web.
