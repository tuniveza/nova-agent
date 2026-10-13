// Pictures and files dropped on a Board (web/board/), kept on this computer in data/board-files/
// under names made up here (b-<day>-<random>.<ext>), so nothing a browser sends can name a place
// on the computer. Online, uploads and viewing come through Nova Bot's relay (src/relay.ts).
//
// Where they live is behind BoardFileStore, so a store on the studio's VPS can take over later
// (swap `boardFiles` for another BoardFileStore; the names stay the same).

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { config } from "./config";

export interface BoardFile {
  id: string; // "b-20261013-3f9a1c2b7d4e"
  type: string;
  size: number;
}
export interface BoardFileStore {
  save(bytes: Uint8Array, type: string): BoardFile;
  read(id: string): { bytes: Buffer; type: string } | null;
  remove(id: string): boolean;
}

export const MAX_BOARD_FILE_BYTES = 25 * 1024 * 1024;
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
  "video/mp4": "mp4",
};
const TYPE_OF: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain; charset=utf-8", md: "text/markdown; charset=utf-8", csv: "text/csv; charset=utf-8", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4" };
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
  if (type === "audio/mp4" || type === "video/mp4") return text(4, 8) === "ftyp";
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
    const name = readdirSync(dir).find((f) => f.startsWith(id + "."));
    return name ? dir + name : null;
  };
  return {
    save(bytes, type) {
      const ext = BOARD_FILE_TYPES[type];
      if (!ext) throw new Error("That kind of file can't go on a board (pictures, PDFs, text, audio and MP4 can).");
      if (!bytes.byteLength) throw new Error("That file is empty.");
      if (bytes.byteLength > MAX_BOARD_FILE_BYTES) throw new Error("That's too big for a board (25 MB at most).");
      if (!looksLike(bytes, type)) throw new Error("That file isn't the kind it says it is.");
      mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const id = `b-${day}-${randomBytes(6).toString("hex")}`;
      writeFileSync(`${dir}${id}.${ext}`, bytes, { mode: 0o600 });
      return { id, type, size: bytes.byteLength };
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
