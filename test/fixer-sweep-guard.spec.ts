// The Fixer's sweep only looks: a sweep's page load can't make shared notes, calendar items, quests
// or anything else (it once made 16 "Welcome to Notes" notes, shared with everyone).
//
// The real sweep (headless Chromium) opens a pretend panel whose script, on load, does what a
// panel does when it finds nothing saved: makes a shared note and saves the calendar. The server in
// front of it uses the same guard as Nova Agent's server. Nothing reaches the handlers.
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweep } from "../src/fixer/sweep";
import { SWEEP_HEADER, sweepWriteBlocked } from "../src/fixer/sweep-guard";

const PAGE = `<!doctype html><meta charset="utf-8"><title>Notes</title><p>Notes</p>
<script>
  fetch("/notes-api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Welcome to Notes" }) }).catch(() => {});
  fetch("/calendar-api/data", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: [{ title: "made by a sweep" }] }) }).catch(() => {});
  fetch("/actions/quests", { method: "POST", headers: { "Content-Type": "application/json", "X-Nova-Visualizer": "1" }, body: JSON.stringify({ title: "made by a sweep" }) }).catch(() => {});
</script>`;

describe("the sweep's browser can't change anything", () => {
  const writes: string[] = [];
  const reads: string[] = [];
  let base = "";
  let server: ReturnType<typeof serve>;
  beforeAll(async () => {
    const app = new Hono();
    app.use("*", async (c, next) => sweepWriteBlocked(c.req.raw) || next());
    app.get("/notes/", (c) => c.html(PAGE));
    app.get("/notes-api/notes", (c) => (reads.push("notes"), c.json({ notes: [] })));
    app.post("/notes-api/notes", (c) => (writes.push("shared note"), c.json({ ok: true })));
    app.put("/calendar-api/data", (c) => (writes.push("calendar"), c.json({ ok: true })));
    app.post("/actions/quests", (c) => (writes.push("quest"), c.json({ ok: true })));
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("a sweep's page load makes no shared notes, calendar items or quests", async () => {
    const { findings } = await sweep(base, { screens: [{ name: "Notes", path: "/notes/" }], widths: [390], settleMs: 800 });
    expect(writes).toEqual([]);
    // (and turning the writes away doesn't show up as a problem with the panel)
    expect(findings.filter((f) => /script error|console error/.test(f.title))).toEqual([]);
  }, 60_000);

  it("the same writes from anyone else go through", async () => {
    await fetch(`${base}/notes-api/notes`, { method: "POST", body: "{}" });
    await fetch(`${base}/calendar-api/data`, { method: "PUT", body: "{}" });
    expect(writes).toEqual(["shared note", "calendar"]);
  });

  it("the guard: writes with the sweep's mark are turned away, looking isn't", async () => {
    const req = (method: string, mark = true) => new Request("http://pc.test/notes-api/notes", { method, headers: mark ? { [SWEEP_HEADER]: "1" } : {} });
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = sweepWriteBlocked(req(m));
      expect(res?.status, m).toBe(503);
      expect(await res!.json()).toMatchObject({ fixerSweep: true });
    }
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(sweepWriteBlocked(req(m))).toBeNull();
    expect(sweepWriteBlocked(req("POST", false))).toBeNull();
  });
});
