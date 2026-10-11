// A planet badge drawn here, when Nova Bot can't be reached: the same generator Portal uses
// (web/portal/planet), seeded by the person's id, as Nova Bot draws anyone it has no saved
// planet for. Saved changes to a planet (its overrides) only come back with Nova Bot.
import { createHash } from "node:crypto";

type Planets = {
  generatePlanet: (seed: string, theme: unknown) => unknown;
  renderPlanetSVG: (planet: unknown, options: { size: number; animate: boolean; background: boolean; idPrefix: string }) => string;
  novaTheme: unknown;
};
let planets: Promise<Planets> | null = null;
const generator = () => (planets ??= import(new URL("../../web/portal/planet/index.js", import.meta.url).href) as Promise<Planets>);

export async function drawPlanet(id: string, params: URLSearchParams): Promise<string> {
  const { generatePlanet, renderPlanetSVG, novaTheme } = await generator();
  const size = Math.min(Math.max(Number(params.get("size")) || 256, 16), 1024);
  const idPrefix = `p${createHash("sha256").update(id).digest("hex").slice(0, 6)}`;
  return renderPlanetSVG(generatePlanet(id, novaTheme), {
    size,
    animate: params.get("animate") === "1",
    background: params.get("background") === "1",
    idPrefix,
  });
}
