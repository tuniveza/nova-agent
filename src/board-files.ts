// Pictures and files dropped on a Board (web/board/), kept on this computer in data/board-files/
// under names made up here (b-<day>-<random>.<ext>), so nothing a browser sends can name a place
// on the computer. Online, uploads and viewing come through Nova Bot's relay (src/relay.ts), and
// a copy of each goes to Google Drive's "Nova Agent/Board" when Google is connected (src/google.ts),
// which Nova Bot then shows online first: quick, and Range works, so videos start straight away.
//
// How big: 500 MB on this computer itself; online 95 MB (just under what Cloudflare takes in one
// request). Files are written to disk as they arrive, never held whole in memory.
//
// Where they live is behind BoardFileStore, so a store on the studio's VPS can take over later
// (swap `boardFiles` for another BoardFileStore; the names stay the same).

import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { config } from "./config";

export interface BoardFile {
  id: string; // "b-20261013-3f9a1c2b7d4e"
  type: string;
  size: number;
}
export interface BoardFileStore {
  save(bytes: Uint8Array, type: string): BoardFile;
  // As it arrives, straight to disk (big videos): refused part-way when it's over `max`
  saveStream(body: ReadableStream<Uint8Array>, type: string, max?: number): Promise<BoardFile>;
  read(id: string): { bytes: Buffer; type: string } | null;
  // Where it is, how big and what it is (to send a part of it: Range)
  info(id: string): { path: string; size: number; type: string } | null;
  remove(id: string): boolean;
}

// On this computer itself; online (through Nova Bot) up to MAX_BOARD_FILE_ONLINE
export const MAX_BOARD_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_BOARD_FILE_ONLINE = 95 * 1024 * 1024;
export const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
export class TooBig extends Error {}
// What can go on a board, and the ending it's saved with
export const BOARD_FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const TYPE_OF: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
export const BOARD_FILE_ID = /^b-\d{8}-[a-f0-9]{12}$/;

// The first bytes of each kind, so a file is what it says it is
function looksLike(bytes: Uint8Array, type: string): boolean {
  const b = (i: number) => bytes[i];
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (type === "image/jpeg") return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (type === "image/png") return b(0) === 0x89 && text(1, 4) === "PNG";
  if (type === "image/webp") return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (type === "image/gif") return text(0, 4) === "GIF8";
  if (type === "application/pdf") return text(0, 5) === "%PDF-";
  if (type === "audio/mpeg") return text(0, 3) === "ID3" || (b(0) === 0xff && (b(1) & 0xe0) === 0xe0);
  if (type === "audio/wav" || type === "audio/x-wav") return text(0, 4) === "RIFF" && text(8, 12) === "WAVE";
  if (type === "audio/mp4" || type === "video/mp4" || type === "video/quicktime") return text(4, 8) === "ftyp" || (type === "video/quicktime" && ["moov", "mdat", "wide", "free"].includes(text(4, 8)));
  if (type === "video/webm") return b(0) === 0x1a && b(1) === 0x45 && b(2) === 0xdf && b(3) === 0xa3;
  if (type === "audio/ogg") return text(0, 4) === "OggS";
  if (type.startsWith("text/")) {
    // Plain text: no NUL bytes, and readable as UTF-8
    if (bytes.includes(0)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 65536));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function diskBoardStore(dir: string): BoardFileStore {
  const fileOf = (id: string) => {
    if (!BOARD_FILE_ID.test(id) || !existsSync(dir)) return null;
    const name = readdirSync(dir).find((f) => f.startsWith(id + ".") && !f.endsWith(".part"));
    return name ? dir + name : null;
  };
  return {
    save(bytes, type) {
      const ext = BOARD_FILE_TYPES[type];
      if (!ext) throw new Error("That kind of file can't go on a board (pictures, PDFs, text, audio and MP4 can).");
      if (!bytes.byteLength) throw new Error("That file is empty.");
      if (bytes.byteLength > MAX_BOARD_FILE_BYTES) throw new TooBig(`That's too big for a board (${mb(MAX_BOARD_FILE_BYTES)} at most).`);
      if (!looksLike(bytes, type)) throw new Error("That file isn't the kind it says it is.");
      mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const id = `b-${day}-${randomBytes(6).toString("hex")}`;
      writeFileSync(`${dir}${id}.${ext}`, bytes, { mode: 0o600 });
      return { id, type, size: bytes.byteLength };
    },
    async saveStream(body, type, max = MAX_BOARD_FILE_BYTES) {
      const ext = BOARD_FILE_TYPES[type];
      if (!ext) throw new Error("That kind of file can't go on a board (pictures, PDFs, text, audio and video can).");
      mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const id = `b-${day}-${randomBytes(6).toString("hex")}`;
      const part = `${dir}.${id}.part`;
      const out = createWriteStream(part, { mode: 0o600 });
      const done = new Promise<void>((resolve, reject) => { out.on("close", resolve); out.on("error", reject); });
      const head: Buffer[] = [];
      let headSize = 0;
      let size = 0;
      const fail = async (error: Error) => {
        out.destroy();
        await done.catch(() => {});
        try { unlinkSync(part); } catch {}
        throw error;
      };
      const reader = body.getReader();
      try {
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          size += value.byteLength;
          if (size > max) {
            reader.cancel().catch(() => {});
            return await fail(new TooBig(`That's too big for a board (${mb(max)} at most${max < MAX_BOARD_FILE_BYTES ? " online; up to " + mb(MAX_BOARD_FILE_BYTES) + " on the studio computer itself" : ""}).`));
          }
          if (headSize < 65536) {
            head.push(Buffer.from(value.subarray(0, 65536 - headSize)));
            headSize += Math.min(value.byteLength, 65536 - headSize);
          }
          if (!out.write(value)) await new Promise((r) => out.once("drain", r));
        }
      } catch (error) {
        if (error instanceof TooBig) throw error;
        return await fail(new Error("The file didn't arrive whole. Try again."));
      }
      if (!size) return await fail(new Error("That file is empty."));
      if (!looksLike(new Uint8Array(Buffer.concat(head)), type)) return await fail(new Error("That file isn't the kind it says it is."));
      out.end();
      await done;
      renameSync(part, `${dir}${id}.${ext}`);
      return { id, type, size };
    },
    info(id) {
      const file = fileOf(id);
      if (!file) return null;
      return { path: file, size: statSync(file).size, type: TYPE_OF[file.slice(file.lastIndexOf(".") + 1)] || "application/octet-stream" };
    },
    read(id) {
      const file = fileOf(id);
      if (!file) return null;
      return { bytes: readFileSync(file), type: TYPE_OF[file.slice(file.lastIndexOf(".") + 1)] || "application/octet-stream" };
    },
    remove(id) {
      const file = fileOf(id);
      if (!file) return false;
      unlinkSync(file);
      return true;
    },
  };
}

export const boardFiles: BoardFileStore = diskBoardStore(`${config.paths.dataDir}board-files/`);
