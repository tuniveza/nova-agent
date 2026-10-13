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
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { BOARD_FILE_TYPES, MAX_BOARD_FILE_BYTES, MAX_BOARD_FILE_ONLINE, TooBig, boardFiles, mb } from "./board-files";
import { copyBoardFileToDriveLater } from "./google";
import { linkPreview } from "./board-link";
import { isRelayed, personFor } from "./person";

// What a Board's file is shown with: only ever something to look at or listen to, never run
const FILE_HEADERS = {
  "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
  "X-Content-Type-Options": "nosniff",
  // A file's id never changes (a new file is a new id)
  "Cache-Control": "private, max-age=86400, immutable",
  "Accept-Ranges": "bytes",
};

// "bytes=a-b" (or "a-", or "-n": the last n) -> [start, end] inside a file of `size`, or null (all
// of it), or "bad" (not satisfiable)
export function readRange(header: string | undefined, size: number): [number, number] | null | "bad" {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || "").trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? "bad" : [start, end];
}

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

  // How big a file may be: 500 MB here on the studio computer, 95 MB online (through Nova Bot)
  app.get("/board-api/limits", (c) => {
    const max = isRelayed(c.req.raw) ? MAX_BOARD_FILE_ONLINE : MAX_BOARD_FILE_BYTES;
    return c.json({ ok: true, maxBytes: max, max: mb(max), here: !isRelayed(c.req.raw), types: Object.keys(BOARD_FILE_TYPES) }, 200, { "Cache-Control": "no-store" });
  });

  app.post("/actions/board-files", async (c) => {
    await personFor(c.req.raw);
    const type = (c.req.header("Content-Type") || "").split(";")[0].trim().toLowerCase();
    if (!BOARD_FILE_TYPES[type]) return c.json({ ok: false, message: "That kind of file can't go on a board (pictures, PDFs, text, audio and video can)." }, 415);
    const max = isRelayed(c.req.raw) ? MAX_BOARD_FILE_ONLINE : MAX_BOARD_FILE_BYTES;
    if (Number(c.req.header("Content-Length") || 0) > max) return c.json({ ok: false, message: `That's too big for a board (${mb(max)} at most${max < MAX_BOARD_FILE_BYTES ? " online; up to " + mb(MAX_BOARD_FILE_BYTES) + " on the studio computer itself" : ""}).` }, 413);
    if (!c.req.raw.body) return c.json({ ok: false, message: "That file is empty." }, 400);
    try {
      const file = await boardFiles.saveStream(c.req.raw.body, type, max);
      // A copy in Google Drive, in the background (Nova Bot shows it from there online)
      const info = boardFiles.info(file.id);
      if (info) copyBoardFileToDriveLater(file.id, c.req.header("X-Nova-Name") || file.id, file.type, info.path, info.size);
      return c.json({ ok: true, file });
    } catch (error) {
      return c.json({ ok: false, message: (error as Error).message }, error instanceof TooBig ? 413 : 400);
    }
  });

  // One of those files: all of it, or a part (Range), so videos start at once and can skip
  app.get("/board-files/:id", (c) => {
    const found = boardFiles.info(c.req.param("id"));
    if (!found) return c.text("No such file", 404);
    const range = readRange(c.req.header("Range"), found.size);
    const base = { "Content-Type": found.type, "Content-Disposition": `inline; filename="${c.req.param("id")}"`, ETag: `"${c.req.param("id")}"`, ...FILE_HEADERS };
    if (range === "bad") return c.body(null, 416, { ...base, "Content-Range": `bytes */${found.size}` });
    const [start, end] = range || [0, found.size - 1];
    const stream = Readable.toWeb(createReadStream(found.path, { start, end })) as unknown as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: range ? 206 : 200,
      headers: { ...base, "Content-Length": String(end - start + 1), ...(range ? { "Content-Range": `bytes ${start}-${end}/${found.size}` } : {}) },
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
