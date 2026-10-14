// The Fixer's addresses on the PC's server. Online, Nova Bot passes them on over the link
// (src/relay.ts; admins only, on both sides). Every one of them is for admins: on the PC, Nova
// Agent's own page counts as an admin (it's the studio computer); online, the person signed in
// to Portal must be an admin.
//
//   GET  /fixer-api/state                      everything the Fixer app shows
//   GET  /fixer-api/jobs/:id                   one prepared fix, with its whole diff
//   GET  /fixer-api/shots/:id/:file.png        a before/after picture
//   POST /actions/fixer/check                  { audio?, checks? }  check now (checks: only the scripted ones)
//   POST /actions/fixer/settings               { hourlyChecks?, autoPrepare?, dailyCap?, timeLimitMinutes? }
//   POST /actions/fixer/quests                 { title, details, kind, priority, start? }
//   POST /actions/fixer/quests/:id             { action: "update" | "remove" | "prepare", ... }
//   POST /actions/fixer/suggestions/:id        { action: "adopt" | "dismiss" }
//   POST /actions/fixer/issues/:id             { action: "prepare" }
//   POST /actions/fixer/jobs/:id               { action: "approve" | "reject" | "tweak" | "undo", note? }

import { readFileSync } from "node:fs";
import type { Hono } from "hono";
import { fromOurPage } from "../signin";
import type { Actor, Fixer } from "./fixer";

// A relayed request (src/relay.ts) has no Host header and the made-up online address
const RELAY_HOST = "online.nova-agent.invalid";

export function actorFor(req: Request): Actor | null {
  if (fromOurPage(req)) return { name: "the studio PC", admin: true, via: "pc" };
  const relayed = !req.headers.get("host") && new URL(req.url).hostname === RELAY_HOST;
  const name = req.headers.get("x-nova-online");
  if (relayed && name && req.headers.get("x-nova-online-role") === "admin") return { name: name.slice(0, 80), admin: true, via: "online" };
  return null;
}

export function registerFixerRoutes(app: Hono, fixer: () => Fixer | null): void {
  const guard = (c: any): { actor: Actor; fixer: Fixer } | Response => {
    const actor = actorFor(c.req.raw);
    if (!actor) return c.json({ ok: false, message: "The Fixer is for admins." }, 403);
    const f = fixer();
    if (!f) return c.json({ ok: false, message: "The Fixer isn't running." }, 503);
    return { actor, fixer: f };
  };
  const act = async (c: any, fn: (g: { actor: Actor; fixer: Fixer }, body: any) => unknown) => {
    const g = guard(c);
    if (g instanceof Response) return g;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json({ ok: true, result: (await fn(g, body || {})) ?? null }, 200, { "Cache-Control": "no-store" });
    } catch (err) {
      return c.json({ ok: false, message: (err as Error).message }, 400);
    }
  };

  app.get("/fixer-api/state", (c) => {
    const g = guard(c);
    return g instanceof Response ? g : c.json({ ...g.fixer.state(), you: g.actor }, 200, { "Cache-Control": "no-store" });
  });
  app.get("/fixer-api/jobs/:id", (c) => {
    const g = guard(c);
    if (g instanceof Response) return g;
    try {
      return c.json(g.fixer.jobDetails(c.req.param("id")), 200, { "Cache-Control": "no-store" });
    } catch (err) {
      return c.json({ ok: false, message: (err as Error).message }, 404);
    }
  });
  app.get("/fixer-api/shots/:id/:file", (c) => {
    const g = guard(c);
    if (g instanceof Response) return g;
    const file = g.fixer.shotFile(c.req.param("id"), c.req.param("file"));
    if (!file) return c.text("Not found", 404);
    return c.body(readFileSync(file) as any, 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" });
  });

  app.post("/actions/fixer/check", (c) =>
    act(c, ({ fixer }, body) => {
      if (body.audio === true) void fixer.check("audio").catch(() => {});
      else if (body.checks === true) void fixer.check("checks").catch(() => {});
      else void fixer.check("full").catch(() => {});
      return { started: true };
    }),
  );
  app.post("/actions/fixer/settings", (c) => act(c, ({ fixer, actor }, body) => fixer.setSettings(body, actor)));
  app.post("/actions/fixer/quests", (c) => act(c, ({ fixer, actor }, body) => fixer.addQuest(body, actor)));
  app.post("/actions/fixer/quests/:id", (c) =>
    act(c, ({ fixer, actor }, body) => {
      const id = c.req.param("id");
      if (body.action === "remove") return fixer.removeQuest(id, actor);
      if (body.action === "prepare") return fixer.prepareQuest(id, actor);
      return fixer.updateQuest(id, body, actor);
    }),
  );
  app.post("/actions/fixer/suggestions/:id", (c) =>
    act(c, ({ fixer, actor }, body) => {
      if (body.action === "adopt") return fixer.adopt(c.req.param("id"), actor);
      if (body.action === "dismiss") return fixer.dismiss(c.req.param("id"), actor);
      throw new Error("Adopt or dismiss?");
    }),
  );
  app.post("/actions/fixer/issues/:id", (c) =>
    act(c, ({ fixer, actor }, body) => {
      if (body.action === "prepare") return fixer.prepareIssue(c.req.param("id"), actor);
      throw new Error("Unknown action");
    }),
  );
  app.post("/actions/fixer/jobs/:id", (c) =>
    act(c, ({ fixer, actor }, body) => {
      const id = c.req.param("id");
      // Approve and Undo answer straight away; going live carries on (the page watches the state)
      if (body.action === "approve" || body.action === "undo") {
        const run = body.action === "approve" ? fixer.approve(id, actor) : fixer.undo(id, actor);
        run.landing.catch(() => {});
        return run.job;
      }
      if (body.action === "reject") return fixer.reject(id, actor);
      if (body.action === "tweak") return fixer.tweak(id, String(body.note || ""), actor);
      throw new Error("Unknown action");
    }),
  );
}
