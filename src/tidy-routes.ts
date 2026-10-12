// Test stuff's addresses on the PC (src/tidy.ts). Online, Nova Bot passes them on over the link
// for admins only (src/relay.ts); here, this computer's own page counts as an admin, like the Fixer.

import type { Hono } from "hono";
import { actorFor } from "./fixer/routes";
import { deletePcItems, markPcReal, pcTestStuff, restorePcItem, unmarkPcReal, type FixerLike } from "./tidy";

export function registerTidyRoutes(app: Hono, fixer: () => FixerLike | null): void {
  const who = (c: any) => {
    const actor = actorFor(c.req.raw);
    return actor && actor.admin ? actor : null;
  };
  app.get("/tidy-api/state", (c) => {
    if (!who(c)) return c.json({ ok: false, message: "Test stuff is for admins." }, 403);
    return c.json(pcTestStuff(fixer()), 200, { "Cache-Control": "no-store" });
  });
  app.post("/actions/tidy/:action", async (c) => {
    const actor = who(c);
    if (!actor) return c.json({ ok: false, message: "Test stuff is for admins." }, 403);
    const body = await c.req.json().catch(() => ({}));
    try {
      const action = c.req.param("action");
      if (action === "delete") return c.json({ ok: true, ...deletePcItems(Array.isArray(body.items) ? body.items : [], fixer(), actor) });
      if (action === "restore") return c.json(restorePcItem(String(body.binId || ""), actor));
      if (action === "real") return c.json(markPcReal(String(body.key || ""), String(body.title || ""), actor));
      if (action === "unreal") return c.json(unmarkPcReal(String(body.key || ""), actor));
      return c.json({ ok: false, message: "Unknown action" }, 404);
    } catch (error) {
      return c.json({ ok: false, message: (error as Error).message }, 400);
    }
  });
}
