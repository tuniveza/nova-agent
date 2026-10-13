// Board (web/board/): each person's boards kept on the PC (src/board.ts), what's dropped on them
// (src/board-files.ts), link previews that only open public pages (src/board-link.ts), and the
// addresses (src/board-routes.ts), reachable online through the relay for signed-in staff.
//   Run: npm test
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, shutdown } from "./harness";

afterEach(shutdown);

// Ana is the person Nova Agent works for on the PC; Bea and Cal are staff online, Dee an admin
async function studio() {
  await boot("2026-10-13T09:00");
  writeFileSync(`${process.env.NOVA_DATA_DIR}/staff.json`, JSON.stringify({ last: "ana" }));
  const relay = await import("../src/relay");
  const { registerBoardRoutes } = await import("../src/board-routes");
  const app = new Hono();
  registerBoardRoutes(app);
  const as = (id: string, role = "staff") => ({ id, name: id[0].toUpperCase() + id.slice(1), role });
  const call = async (staff: ReturnType<typeof as>, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const raw = body === undefined ? undefined : Buffer.from(typeof body === "string" || body instanceof Uint8Array ? (body as any) : JSON.stringify(body));
    const req = relay.relayedRequest({ method, path, headers: { "content-type": "application/json", "x-nova-visualizer": "1", ...headers }, staff }, raw);
    const res = await app.fetch(req);
    return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer() };
  };
  return { relay, app, as, call };
}

describe("a person's boards", () => {
  it("each person starts with a board of their own, sees only their own, and an admin can look at everyone's", async () => {
    const { as, call } = await studio();
    const bea = await call(as("bea"), "GET", "/board-api/boards");
    expect(bea.data.boards).toHaveLength(1);
    const id = bea.data.boards[0].id;
    const saved = await call(as("bea"), "PUT", `/board-api/boards/${id}`, { board: { name: "EP plan", cards: [{ kind: "question", text: "When's the release?", x: 10, y: 20 }] } });
    expect(saved.status).toBe(200);
    expect(saved.data.board.cards[0]).toMatchObject({ kind: "question", text: "When's the release?", x: 10, y: 20, pinned: false });
    // Cal doesn't see Bea's
    const cal = await call(as("cal"), "GET", "/board-api/boards");
    expect(cal.data.boards.map((b: any) => b.name)).toEqual(["My board"]);
    // Cal saving under Bea's board's name makes Cal's own, it doesn't touch Bea's
    await call(as("cal"), "PUT", `/board-api/boards/${id}`, { board: { name: "Not yours", cards: [] } });
    expect((await call(as("bea"), "GET", "/board-api/boards")).data.boards.find((b: any) => b.id === id).name).toBe("EP plan");
    // An admin can look at everyone's (each with its owner); staff asking for everyone's get their own
    const all = (await call(as("dee", "admin"), "GET", "/board-api/boards?who=everyone")).data.boards;
    expect(all.filter((b: any) => b.owner === "bea").map((b: any) => b.name)).toContain("EP plan");
    expect((await call(as("cal"), "GET", "/board-api/boards?who=everyone")).data.boards.every((b: any) => !b.owner)).toBe(true);
  });

  it("a page that missed a newer save gets the newest instead of overwriting it; boards can be removed", async () => {
    const { as, call } = await studio();
    const id = (await call(as("bea"), "GET", "/board-api/boards")).data.boards[0].id;
    const first = await call(as("bea"), "PUT", `/board-api/boards/${id}`, { board: { name: "One", cards: [] } });
    vi.setSystemTime(new Date(Date.now() + 60_000)); // (a minute later)
    await call(as("bea"), "PUT", `/board-api/boards/${id}`, { board: { name: "Two", cards: [] }, base: first.data.board.updated });
    const stale = await call(as("bea"), "PUT", `/board-api/boards/${id}`, { board: { name: "Old page", cards: [] }, base: first.data.board.updated });
    expect(stale.status).toBe(409);
    expect(stale.data).toMatchObject({ conflict: true, board: { name: "Two" } });
    expect((await call(as("bea"), "POST", `/actions/board/${id}/remove`)).status).toBe(200);
    expect((await call(as("bea"), "POST", `/actions/board/${id}/remove`)).status).toBe(404);
  });

  it("saves only from Nova Agent's own pages", async () => {
    const { as, call } = await studio();
    const res = await call(as("bea"), "PUT", "/board-api/boards/abcdef123456", { board: {} }, { "x-nova-visualizer": "" });
    expect(res.status).toBe(403);
  });
});

describe("what a card may hold", () => {
  it("keeps the kinds it knows, trims what's too big and drops what's broken", async () => {
    await boot("2026-10-13T09:00");
    const { cleanBoard, MAX_CARDS } = await import("../src/board");
    const b = cleanBoard(
      {
        name: "x".repeat(200),
        view: { x: 1e9, y: -5, zoom: 99 },
        cards: [
          { kind: "sticky", colour: "blue", text: "hi", x: 1e9, w: 5, h: 99999, turn: 45, pinned: "yes" },
          { kind: "script", text: "<script>" },
          { kind: "link", url: "javascript:alert(1)" },
          { kind: "link", url: "https://example.com", fileName: "javascript:x" },
          { kind: "image", fileId: "../../etc/passwd" },
          { kind: "image", fileId: "b-20261013-0123456789ab", fileType: "image/png" },
          { kind: "calendar", span: "decade", start: "not a day" },
          { kind: "note", noteId: "n1", noteCreated: "2026-10-01T10:00:00Z", title: "A note" },
        ],
      },
      "abcdef123456",
    );
    expect(b.name).toHaveLength(80);
    expect(b.view).toEqual({ x: 200000, y: -5, zoom: 3 });
    expect(b.cards.map((c) => c.kind)).toEqual(["sticky", "link", "image", "calendar", "note"]);
    expect(b.cards[0]).toMatchObject({ colour: "amber", x: 200000, w: 140, h: 1400, turn: 6, pinned: false });
    expect(b.cards[1].fileName).toBeUndefined();
    expect(b.cards[3]).toMatchObject({ span: "week" });
    expect(b.cards[3].start).toBeUndefined();
    expect(cleanBoard({ cards: Array.from({ length: MAX_CARDS + 50 }, () => ({ kind: "text" })) }, "abcdef123456").cards).toHaveLength(MAX_CARDS);
  });
});

describe("pictures and files on a board", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it("saves what it says it is under a name it makes up, and refuses anything else", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nova-board-files-")) + "/";
    const { diskBoardStore, BOARD_FILE_ID } = await import("../src/board-files");
    const store = diskBoardStore(dir);
    const a = store.save(PNG, "image/png");
    expect(a.id).toMatch(BOARD_FILE_ID);
    expect(store.read(a.id)).toEqual({ bytes: Buffer.from(PNG), type: "image/png" });
    expect(store.save(new TextEncoder().encode("GIF89a…"), "image/gif").type).toBe("image/gif");
    expect(store.save(new TextEncoder().encode("Some notes\nfor the session"), "text/plain").type).toBe("text/plain");
    expect(() => store.save(Uint8Array.from([0, 1, 2]), "text/plain")).toThrow(/isn't the kind/);
    expect(() => store.save(PNG, "text/html")).toThrow(/can't go on a board/);
    expect(() => store.save(new Uint8Array(), "image/png")).toThrow(/empty/);
    for (const id of ["../secret", "b-20261013-../../x", a.id + "/..", "index"]) expect(store.read(id)).toBeNull();
    expect(store.remove(a.id)).toBe(true);
    expect(store.read(a.id)).toBeNull();
  });

  it("an upload through the routes, and the file back", async () => {
    const { as, call } = await studio();
    const up = await call(as("bea"), "POST", "/actions/board-files", PNG, { "content-type": "image/png" });
    expect(up.status).toBe(200);
    const back = await call(as("bea"), "GET", `/board-files/${up.data.file.id}`);
    expect(new Uint8Array(back.data as ArrayBuffer)).toEqual(PNG);
    expect((await call(as("bea"), "POST", "/actions/board-files", "<html>", { "content-type": "text/html" })).status).toBe(415);
  });
});

describe("links", () => {
  it("only ever opens public web pages", async () => {
    const { privateAddress, linkPreview } = await import("../src/board-link");
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "172.20.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(privateAddress(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "2606:4700::6810:85e5"]) expect(privateAddress(ip)).toBe(false);
    for (const url of ["http://localhost:4545/", "http://127.0.0.1/", "http://10.1.2.3/", "file:///etc/passwd", "https://example.com:8443/", "http://user:pw@example.com/", "http://[::1]/", "http://studio.local/"]) {
      await expect(linkPreview(url)).rejects.toThrow();
    }
  });
});

describe("online", () => {
  it("Board's addresses are passed on for signed-in staff only, and nothing else of the PC's", async () => {
    const { relay } = await studio();
    const sam = { id: "sam", role: "staff" };
    expect(relay.relayAllowed("GET", "/board-api/boards", sam)).toBe(true);
    expect(relay.relayAllowed("PUT", "/board-api/boards/abcdef123456", sam)).toBe(true);
    expect(relay.relayAllowed("POST", "/actions/board/abcdef123456/remove", sam)).toBe(true);
    expect(relay.relayAllowed("POST", "/actions/board-files", sam)).toBe(true);
    expect(relay.relayAllowed("GET", "/board-files/b-20261013-0123456789ab", sam)).toBe(true);
    expect(relay.relayAllowed("GET", "/board-api/link?url=https://example.com", sam)).toBe(true);
    expect(relay.relayAllowed("GET", "/board-api/boards", null)).toBe(false);
    expect(relay.relayAllowed("GET", "/board-files/../data/staff.json", sam)).toBe(false);
    expect(relay.relayAllowed("DELETE", "/board-api/boards/abcdef123456", sam)).toBe(false);
  });
});

describe("big files and parts of them", () => {
  it("a file saved as it arrives, refused part-way when it's over the limit, and read back in parts (Range)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nova-board-stream-")) + "/";
    const { diskBoardStore } = await import("../src/board-files");
    const { readRange } = await import("../src/board-routes");
    const store = diskBoardStore(dir);
    const mp4 = new Uint8Array(3 * 1024 * 1024);
    mp4.set(new TextEncoder().encode("\0\0\0\x18ftypisom"), 0);
    for (let i = 16; i < mp4.length; i++) mp4[i] = i & 255;
    const streamOf = (bytes: Uint8Array, piece = 65536) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < bytes.length; i += piece) c.enqueue(bytes.subarray(i, i + piece));
          c.close();
        },
      });
    const saved = await store.saveStream(streamOf(mp4), "video/mp4");
    expect(saved.size).toBe(mp4.length);
    expect(store.info(saved.id)?.size).toBe(mp4.length);
    expect(Buffer.compare(store.read(saved.id)!.bytes, Buffer.from(mp4))).toBe(0);
    // Over the limit: refused, and nothing half-written is left behind
    await expect(store.saveStream(streamOf(mp4), "video/mp4", 1024 * 1024)).rejects.toThrow(/too big/);
    expect(readdirSync(dir).filter((f) => f.endsWith(".part"))).toHaveLength(0);
    // Not what it says it is
    await expect(store.saveStream(streamOf(new TextEncoder().encode("<html>hi</html>")), "video/mp4")).rejects.toThrow(/isn't the kind/);
    expect(readRange("bytes=0-99", 1000)).toEqual([0, 99]);
    expect(readRange("bytes=900-", 1000)).toEqual([900, 999]);
    expect(readRange("bytes=-100", 1000)).toEqual([900, 999]);
    expect(readRange("bytes=5000-", 1000)).toBe("bad");
    expect(readRange(undefined, 1000)).toBeNull();
  });

  it("through the routes: a video comes back whole or in parts, and the limit is bigger here than online", async () => {
    const { as, call, app } = await studio();
    const mp4 = new Uint8Array(200_000);
    mp4.set(new TextEncoder().encode("\0\0\0\x18ftypisom"), 0);
    for (let i = 16; i < mp4.length; i++) mp4[i] = (i * 7) & 255;
    const up = await call(as("bea"), "POST", "/actions/board-files", mp4, { "content-type": "video/mp4" });
    expect(up.status).toBe(200);
    const part = await call(as("bea"), "GET", `/board-files/${up.data.file.id}`, undefined, { range: "bytes=1000-1999" });
    expect(part.status).toBe(206);
    expect(Buffer.compare(Buffer.from(part.data as ArrayBuffer), Buffer.from(mp4.subarray(1000, 2000)))).toBe(0);
    // Online (through Nova Bot) 95 MB; on the studio computer itself 500 MB
    expect((await call(as("bea"), "GET", "/board-api/limits")).data.maxBytes).toBe(95 * 1024 * 1024);
    const here = await (await app.fetch(new Request("http://localhost:4545/board-api/limits"))).json();
    expect(here.maxBytes).toBe(500 * 1024 * 1024);
  });
});
