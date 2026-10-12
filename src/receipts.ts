// Receipts for the studio's expenses (Portal → Money): photos and PDFs, kept on this computer.
//
// Nova Bot keeps the expense itself (src/money.js there) with the receipt's name (receipt_id);
// the file stays here, in data/receipts/, under a name this file makes up (r-<day>-<random>.<ext>),
// so nothing a browser sends can name a place on the computer. Online, the upload and the viewing
// come through Nova Bot's relay (src/relay.ts), for signed-in staff only.
//
// Where receipts live is behind ReceiptStore, so a store on the studio's VPS can take over later
// (swap `receipts` for another ReceiptStore; the names stay the same).

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { config } from "./config";

export interface Receipt {
  id: string; // "r-20261012-3f9a1c2b7d"
  type: string; // "image/jpeg"
  size: number; // bytes
}
export interface ReceiptStore {
  save(bytes: Uint8Array, type: string): Receipt;
  read(id: string): { bytes: Buffer; type: string } | null;
  remove(id: string): boolean;
}

export const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
// What a receipt can be, and the ending it's saved with
export const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};
const TYPE_OF: Record<string, string> = Object.fromEntries(Object.entries(RECEIPT_TYPES).map(([t, e]) => [e, t]));
export const RECEIPT_ID = /^r-\d{8}-[a-f0-9]{10}$/;

// The first bytes of each kind (so a file is what it says it is)
function looksLike(bytes: Uint8Array, type: string): boolean {
  const b = (i: number) => bytes[i];
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (type === "image/jpeg") return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (type === "image/png") return b(0) === 0x89 && text(1, 4) === "PNG";
  if (type === "image/webp") return text(0, 4) === "RIFF" && text(8, 12) === "WEBP";
  if (type === "image/heic" || type === "image/heif") return text(4, 8) === "ftyp";
  if (type === "application/pdf") return text(0, 5) === "%PDF-";
  return false;
}

// On this computer's disk
export function diskStore(dir: string): ReceiptStore {
  const fileOf = (id: string) => {
    if (!RECEIPT_ID.test(id) || !existsSync(dir)) return null;
    const name = readdirSync(dir).find((f) => f.startsWith(id + "."));
    return name ? dir + name : null;
  };
  return {
    save(bytes, type) {
      const ext = RECEIPT_TYPES[type];
      if (!ext) throw new Error("A receipt is a photo (JPEG, PNG, WebP, HEIC) or a PDF.");
      if (!bytes.byteLength) throw new Error("That file is empty.");
      if (bytes.byteLength > MAX_RECEIPT_BYTES) throw new Error("That's too big for a receipt (20 MB at most).");
      if (!looksLike(bytes, type)) throw new Error("That file isn't the kind it says it is.");
      mkdirSync(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const id = `r-${day}-${randomBytes(5).toString("hex")}`;
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

export const receipts: ReceiptStore = diskStore(`${config.paths.dataDir}receipts/`);
