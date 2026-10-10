// Nova Agent's files: documents it writes for you (Markdown, text, CSV, JSON, HTML),
// to preview, download, or open in Notes.
//
// Each file is kept in data/files/ under its own id (the name you see is only a label,
// so a name can never point anywhere else on the computer), with data/files/index.json
// listing them. The chat writes and reads them (chat.ts: file_write, file_read...);
// the page lists, previews and downloads them (server.ts: /files/...).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { config } from "./config";

export const FILE_TYPES = ["md", "txt", "csv", "json", "html"] as const;
export type FileType = (typeof FILE_TYPES)[number];

export interface FileEntry {
  id: string;
  name: string; // "release-plan.md"
  title: string; // "Release plan: 33 songs by New Year"
  type: FileType;
  size: number; // bytes
  source: string; // "chat", or "mission:<id>" for a mission's export
  created: string;
  updated: string;
}

export const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES = 500;
const dir = `${config.paths.dataDir}files/`;
const indexFile = `${dir}index.json`;

export const CONTENT_TYPES: Record<FileType, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
};

const isType = (t: string): t is FileType => (FILE_TYPES as readonly string[]).includes(t);

// A safe, readable file name: words and dashes, with the right ending
export function cleanName(raw: string, type?: FileType): { name: string; type: FileType } {
  const trimmed = String(raw || "").trim().split(/[\\/]/).pop() || "";
  const dot = trimmed.lastIndexOf(".");
  const ext = dot > 0 ? trimmed.slice(dot + 1).toLowerCase() : "";
  const t: FileType = type ?? (ext === "markdown" ? "md" : isType(ext) ? ext : "md");
  const base = (dot > 0 && (isType(ext) || ext === "markdown") ? trimmed.slice(0, dot) : trimmed)
    .normalize("NFKD")
    .replace(/[^\w\s.-]+/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return { name: `${base || "nova-file"}.${t}`, type: t };
}

function readIndex(): FileEntry[] {
  if (!existsSync(indexFile)) return [];
  try {
    const raw = JSON.parse(readFileSync(indexFile, "utf8"));
    return Array.isArray(raw) ? raw.filter((f) => f && typeof f.id === "string" && isType(f.type)) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: FileEntry[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${indexFile}.tmp`, JSON.stringify(list, null, 2));
  renameSync(`${indexFile}.tmp`, indexFile);
}

const pathOf = (f: Pick<FileEntry, "id" | "type">) => `${dir}${f.id}.${f.type}`;

export function listFiles(): FileEntry[] {
  return readIndex().sort((a, b) => b.updated.localeCompare(a.updated));
}

export function findFile(idOrName: string): FileEntry | undefined {
  const key = String(idOrName || "").trim();
  if (!key) return undefined;
  const list = readIndex();
  return list.find((f) => f.id === key) ?? list.find((f) => key.length >= 6 && f.id.startsWith(key)) ?? list.find((f) => f.name.toLowerCase() === key.toLowerCase());
}

export function readFileText(f: FileEntry): string {
  return readFileSync(pathOf(f), "utf8");
}

// Write a new file, or replace one (by id)
export function saveFile(input: { name: string; content: string; title?: string; id?: string; source?: string }): FileEntry {
  const content = String(input.content ?? "");
  const size = Buffer.byteLength(content, "utf8");
  if (!content.trim()) throw new Error("The file would be empty.");
  if (size > MAX_FILE_BYTES) throw new Error(`That's too big for one file (${Math.round(size / 1000)} KB; up to ${MAX_FILE_BYTES / 1_000_000} MB).`);
  const list = readIndex();
  const now = new Date().toISOString();
  const old = input.id ? list.find((f) => f.id === input.id || (input.id!.length >= 6 && f.id.startsWith(input.id!))) : undefined;
  if (input.id && !old) throw new Error(`No file with id ${input.id}.`);
  const { name, type } = cleanName(input.name || old?.name || "", undefined);
  const entry: FileEntry = {
    id: old?.id ?? randomUUID(),
    name,
    title: String(input.title || old?.title || name.replace(/\.\w+$/, "").replace(/-/g, " ")).slice(0, 140),
    type,
    size,
    source: String(input.source || old?.source || "chat").slice(0, 80),
    created: old?.created ?? now,
    updated: now,
  };
  mkdirSync(dir, { recursive: true });
  if (old && old.type !== entry.type && existsSync(pathOf(old))) unlinkSync(pathOf(old));
  writeFileSync(`${pathOf(entry)}.tmp`, content);
  renameSync(`${pathOf(entry)}.tmp`, pathOf(entry));
  const rest = list.filter((f) => f.id !== entry.id);
  // Oldest out first, if there are ever too many
  const kept = [entry, ...rest.sort((a, b) => b.updated.localeCompare(a.updated))].slice(0, MAX_FILES);
  for (const gone of rest.filter((f) => !kept.includes(f))) if (existsSync(pathOf(gone))) unlinkSync(pathOf(gone));
  writeIndex(kept);
  return entry;
}

export function removeFile(idOrName: string): FileEntry {
  const f = findFile(idOrName);
  if (!f) throw new Error(`No file called ${idOrName}.`);
  if (existsSync(pathOf(f))) unlinkSync(pathOf(f));
  writeIndex(readIndex().filter((x) => x.id !== f.id));
  return f;
}

// Where the page opens it (the name is only there to make the address readable)
export const fileUrl = (f: FileEntry) => `/files/${f.id}/${encodeURIComponent(f.name)}`;

// What the chat page needs to show a file card
export const fileCard = (f: FileEntry) => ({ id: f.id, name: f.name, title: f.title, type: f.type, size: f.size, url: fileUrl(f), updated: f.updated });

export const sizeText = (bytes: number) => (bytes < 1000 ? `${bytes} B` : bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`);
