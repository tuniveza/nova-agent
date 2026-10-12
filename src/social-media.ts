// Social posts' pictures and videos (Portal → Social), kept on this computer until the VPS takes
// over.
//
// Portal uploads a file here (online, through Nova Bot's link: src/relay.ts), gets back its id, and
// the post on Nova Bot keeps only that id. Meta fetches the file when an approved post goes out:
// Nova Bot asks this computer for it over the same link (so this computer must be on then).
//
// A file is saved under a random id and never changes (a different picture is a new id), so the
// approval Nova Bot keeps (a hash with the ids in it) always means exactly these files. Only
// pictures and videos Meta takes are kept, checked by their first bytes, not their name.
//
// Moving to the VPS: write another MediaStore (the same four functions, keeping files on the VPS)
// and pick it in `mediaStore` below; on Nova Bot set SOCIAL_MEDIA_BASE (the VPS's address for the
// files) and SOCIAL_MEDIA_KEY, and Nova Bot fetches them from there instead of this computer.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { config } from "./config";

export const MEDIA_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime" } as const;
export type MediaExt = keyof typeof MEDIA_TYPES;
export type MediaKind = "image" | "video";
export interface MediaEntry {
  id: string; // 32 hex characters
  ext: MediaExt;
  kind: MediaKind;
  name: string; // the name it had when it was added (only a label)
  size: number; // bytes
  by: string; // who added it
  added: string; // UTC
}

// Instagram takes pictures up to 8 MB; videos are kept up to 100 MB here (online, Nova Bot's link
// carries 25 MB at most)
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MEDIA_ID = /^[a-f0-9]{32}$/;

export interface MediaStore {
  save(bytes: Buffer, info: { name?: string; by?: string }): MediaEntry;
  find(id: string): MediaEntry | null;
  path(entry: MediaEntry): string;
  remove(id: string): boolean;
}

const kindOf = (ext: MediaExt): MediaKind => (ext === "mp4" || ext === "mov" ? "video" : "image");

// What a file really is, from its first bytes (null: not a picture or video Meta takes)
export function sniff(bytes: Buffer): MediaExt | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (/^GIF8[79]a$/.test(bytes.toString("latin1", 0, 6))) return "gif";
  // MP4 and QuickTime: an "ftyp" box first, with its brand
  if (bytes.toString("latin1", 4, 8) === "ftyp") {
    const brand = bytes.toString("latin1", 8, 12);
    if (brand === "qt  ") return "mov";
    if (/^(isom|iso\d|mp4\d|mp41|mp42|avc1|M4V |dash|MSNV|3gp\d)$/.test(brand)) return "mp4";
  }
  return null;
}

const cleanLabel = (name: unknown) =>
  String(name || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "")
    .trim()
    .slice(0, 120);

// Files in a folder on this computer: <id>.<ext>, with <id>.json beside it
export function localStore(dir: string): MediaStore {
  const folder = dir.replace(/\/?$/, "/");
  const infoFile = (id: string) => `${folder}${id}.json`;
  const store: MediaStore = {
    save(bytes, info) {
      const ext = sniff(bytes);
      if (!ext) throw new Error("That isn't a picture or video Facebook and Instagram take (JPEG, PNG, WebP, GIF, MP4 or MOV).");
      const kind = kindOf(ext);
      const max = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
      if (bytes.length > max) throw new Error(`That ${kind === "image" ? "picture" : "video"} is too big (${Math.round(bytes.length / 1_000_000)} MB; up to ${Math.round(max / 1_000_000)} MB).`);
      const entry: MediaEntry = {
        id: randomBytes(16).toString("hex"),
        ext,
        kind,
        name: cleanLabel(info.name) || `${kind}.${ext}`,
        size: bytes.length,
        by: String(info.by || "").slice(0, 80),
        added: new Date().toISOString(),
      };
      mkdirSync(folder, { recursive: true });
      const file = store.path(entry);
      writeFileSync(`${file}.tmp`, bytes);
      renameSync(`${file}.tmp`, file);
      writeFileSync(infoFile(entry.id), JSON.stringify(entry, null, 2));
      return entry;
    },
    find(id) {
      if (!MEDIA_ID.test(id) || !existsSync(infoFile(id))) return null;
      try {
        const entry = JSON.parse(readFileSync(infoFile(id), "utf8")) as MediaEntry;
        if (entry.id !== id || !(entry.ext in MEDIA_TYPES) || !existsSync(store.path(entry))) return null;
        return { ...entry, size: statSync(store.path(entry)).size };
      } catch {
        return null;
      }
    },
    path: (entry) => `${folder}${entry.id}.${entry.ext}`,
    remove(id) {
      const entry = store.find(id);
      if (!entry) return false;
      unlinkSync(store.path(entry));
      unlinkSync(infoFile(id));
      return true;
    },
  };
  return store;
}

export const mediaStore: MediaStore = localStore(`${config.paths.dataDir}social-media/`);

// What Portal gets back
export const mediaCard = (e: MediaEntry) => ({ id: e.id, ext: e.ext, kind: e.kind, name: e.name, size: e.size, url: `/social-media/${e.id}.${e.ext}` });

// A byte range asked for ("bytes=0-1023", "bytes=500-") -> [start, end] (inclusive), or null for
// the whole file, or "bad" when it can't be met
export function readRange(header: string | undefined, size: number): [number, number] | null | "bad" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return "bad";
  return [start, end];
}
