// Board's addresses on the PC (src/board.ts, board-files.ts, board-link.ts). Online, Nova Bot
// passes them on over the link for signed-in staff (src/relay.ts), with who's asking; each person
// reads and saves their own boards.
//
//   GET  /board-api/boards[?who=everyone]   their boards (everyone's: admins and this computer, to look at)
//   PUT  /board-api/boards/:id               save one board whole { board, base? }
//   POST /actions/board/:id/remove           delete one of their boards
//   POST /actions/board-files                a picture or file dropped on a board (the file itself)
//   GET  /board-files/:id                    one of those, to show
//   GET  /board-api/link?url=…               a link's title, description and icon (public pages only)

import type { Hono } from "hono";
import { listBoards, removeBoard, saveBoard } from "./board";
import { BOARD_FILE_TYPES, MAX_BOARD_FILE_BYTES, boardFiles } from "./board-files";
import { linkPreview } from "./board-link";
import { personFor } from "./person";

// Changes (and the link look-up) only from Nova Agent's own pages: they send this header, which
// other websites can't add to a request here
const fromPage = (c: any) => c.req.header("X-Nova-Visualizer") === "1";

export function registerBoardRoutes(app: Hono): void {
  app.get("/board-api/boards", async (c) => {
    const person = await personFor(c.req.raw);
    const everyone = c.req.query("who") === "everyone";
    return c.json({ ok: true, me: { id: person.id, name: person.name, role: person.role }, boards: listBoards(person, everyone) }, 200, { "Cache-Control": "no-store" });
  });

  app.put("/board-api/boards/:id", async (c) => {
    if (!fromPage(c)) return c.json({ ok: false, message: "Only from Nova Agent's own pages" }, 403);
    const person = await personFor(c.req.raw);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ ok: false, message: "That isn't a board." }, 400);
    try {
      const { board, conflict } = saveBoard(person, c.req.param("id"), (body as any).board, typeof (body as any).base === "string" ? (body as any).base : undefined);
      return c.json(conflict ? { ok: false, conflict: true, board, message: "This board changed somewhere else: here's the newest." } : { ok: true, board }, conflict ? 409 : 200);
    } catch (error) {
      return c.json({ ok: false, message: (error as Error).message }, 400);
    }
  });

  app.post("/actions/board/:id/remove", async (c) => {
    const person = await personFor(c.req.raw);
    return removeBoard(person, c.req.param("id")) ? c.json({ ok: true }) : c.json({ ok: false, message: "No such board." }, 404);
  });

  app.post("/actions/board-files", async (c) => {
    await personFor(c.req.raw);
    const type = (c.req.header("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!BOARD_FILE_TYPES[type]) return c.json({ ok: false, message: "That kind of file can't go on a board (pictures, PDFs, text, audio and MP4 can)." }, 415);
    if (Number(c.req.header("Content-Length") || 0) > MAX_BOARD_FILE_BYTES) return c.json({ ok: false, message: "That's too big for a board (25 MB at most)." }, 413);
    try {
      const file = boardFiles.save(new Uint8Array(await c.req.arrayBuffer()), type);
      return c.json({ ok: true, file });
    } catch (error) {
      return c.json({ ok: false, message: (error as Error).message }, 400);
    }
  });

  app.get("/board-files/:id", (c) => {
    const found = boardFiles.read(c.req.param("id"));
    if (!found) return c.text("No such file", 404);
    return c.body(new Uint8Array(found.bytes), 200, {
      "Content-Type": found.type,
      "Content-Disposition": `inline; filename="${c.req.param("id")}"`,
      // Only ever something to look at or listen to: it can't run anything
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    });
  });

  app.get("/board-api/link", async (c) => {
    if (!fromPage(c)) return c.json({ ok: false, message: "Only from Nova Agent's own pages" }, 403);
    await personFor(c.req.raw);
    try {
      return c.json({ ok: true, link: await linkPreview(c.req.query("url") || "") });
    } catch (error) {
      return c.json({ ok: false, message: (error as Error).message }, 400);
    }
  });
}
