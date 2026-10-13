// Board: a table to lay things out on (web/board/). Each person's own boards, kept on this
// computer in data/boards/<person>.json, read and saved by the Board page (online through Nova
// Bot's relay, src/relay.ts, like Calendar).
//
// A board is { id, name, created, updated, view: { x, y, zoom }, cards: [...] }. A card is where
// it lies on the table (x, y, w, h, z, a little turn), whether it's pinned (stays put), and what
// it shows: a note from Notes, a stretch of the calendar, a question for Agent and its answer, a
// question card, a sticky note, some text, a link, or a picture or file (kept in data/board-files/,
// see board-files.ts). Everything is checked and trimmed here, so a page can't save anything odd.
//
// Whose: the person asking (src/person.ts). On the studio computer that's the person Nova Agent
// works for; online, the signed-in Portal staff member. An admin can look at everyone's boards
// (read only); changing one is for its owner.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { config } from "./config";
import type { Person } from "./person";

export const CARD_KINDS = ["note", "calendar", "agent", "question", "sticky", "text", "link", "image", "file"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const SPANS = ["day", "week", "month", "year"] as const;
export const STICKY_COLOURS = ["rose", "amber", "lime", "teal", "violet", "sky"] as const;

export interface Card {
  id: string;
  kind: CardKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  turn: number; // degrees, a little either way
  pinned: boolean;
  created: string;
  updated: string;
  // What it shows (only the ones its kind uses)
  title?: string;
  text?: string;
  answer?: string;
  noteId?: string;
  noteCreated?: string;
  noteUpdated?: string;
  span?: (typeof SPANS)[number];
  start?: string; // "YYYY-MM-DD": the first day the calendar card shows
  url?: string;
  fileId?: string;
  fileType?: string;
  fileName?: string;
  colour?: (typeof STICKY_COLOURS)[number];
  asked?: string; // when an Agent question was asked
}
export interface Board {
  id: string;
  name: string;
  created: string;
  updated: string;
  view: { x: number; y: number; zoom: number };
  cards: Card[];
  owner?: string; // filled in when an admin looks at everyone's
}

export const MAX_BOARDS = 50;
export const MAX_CARDS = 400;
const LIMIT = 200_000; // the table's edge, either way

const dir = () => `${config.paths.dataDir}boards/`;
const ID = /^[a-z0-9-]{6,40}$/;
const personFile = (id: string) => `${dir()}${id.replace(/[^a-z0-9_-]/gi, "") || "owner"}.json`;
export const newId = () => randomBytes(8).toString("hex");

const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 100) / 100));
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").slice(0, max) : undefined);
const iso = (v: unknown, fallback: string) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (list.includes(v as T) ? (v as T) : undefined);

// A card as it may be saved (unknown kinds and broken cards are dropped)
export function cleanCard(raw: any, now = new Date().toISOString()): Card | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = oneOf(raw.kind, CARD_KINDS);
  if (!kind) return null;
  const card: Card = {
    id: typeof raw.id === "string" && ID.test(raw.id) ? raw.id : newId(),
    kind,
    x: num(raw.x, -LIMIT, LIMIT, 0),
    y: num(raw.y, -LIMIT, LIMIT, 0),
    w: num(raw.w, 140, 1400, 260),
    h: num(raw.h, 90, 1400, 180),
    z: num(raw.z, 0, 1e6, 1),
    turn: num(raw.turn, -6, 6, 0),
    pinned: raw.pinned === true,
    created: iso(raw.created, now),
    updated: iso(raw.updated, now),
  };
  const set = <K extends keyof Card>(key: K, value: Card[K] | undefined) => {
    if (value !== undefined && value !== "") card[key] = value;
  };
  set("title", str(raw.title, 300));
  set("text", str(raw.text, 20_000));
  if (kind === "agent" || kind === "question") set("answer", str(raw.answer, 40_000));
  if (kind === "agent") set("asked", typeof raw.asked === "string" ? iso(raw.asked, now) : undefined);
  if (kind === "note") {
    set("noteId", typeof raw.noteId === "string" && /^[\w-]{1,80}$/.test(raw.noteId) ? raw.noteId : undefined);
    set("noteCreated", typeof raw.noteCreated === "string" ? iso(raw.noteCreated, now) : undefined);
    set("noteUpdated", typeof raw.noteUpdated === "string" ? iso(raw.noteUpdated, now) : undefined);
  }
  if (kind === "calendar") {
    card.span = oneOf(raw.span, SPANS) || "week";
    set("start", day(raw.start));
  }
  if (kind === "link") {
    const url = str(raw.url, 2000);
    if (!url || !/^https?:\/\//i.test(url)) return null;
    card.url = url;
    // (its page's little icon, when the link's page says where it is)
    const icon = str(raw.fileName, 500);
    if (icon && /^https?:\/\//i.test(icon)) card.fileName = icon;
  }
  if (kind === "image" || kind === "file") {
    if (typeof raw.fileId !== "string" || !/^b-\d{8}-[a-f0-9]{12}$/.test(raw.fileId)) return null;
    card.fileId = raw.fileId;
    set("fileType", str(raw.fileType, 100));
    set("fileName", str(raw.fileName, 200));
  }
  if (kind === "sticky") card.colour = oneOf(raw.colour, STICKY_COLOURS) || "amber";
  return card;
}

export function cleanBoard(raw: any, id: string, now = new Date().toISOString()): Board {
  const cards = (Array.isArray(raw?.cards) ? raw.cards : []).slice(0, MAX_CARDS).map((c: unknown) => cleanCard(c, now)).filter(Boolean) as Card[];
  // No two cards with the same id
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.id)) c.id = newId();
    seen.add(c.id);
  }
  return {
    id,
    name: str(raw?.name, 80)?.trim() || "Board",
    created: iso(raw?.created, now),
    updated: now,
    view: { x: num(raw?.view?.x, -LIMIT, LIMIT, 0), y: num(raw?.view?.y, -LIMIT, LIMIT, 0), zoom: num(raw?.view?.zoom, 0.2, 3, 1) },
    cards,
  };
}

// ---- On disk: one file per person ----
interface Saved {
  version: 1;
  boards: Board[];
}
function load(personId: string): Saved {
  try {
    const file = personFile(personId);
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (data && Array.isArray(data.boards)) return { version: 1, boards: data.boards };
    }
  } catch {}
  return { version: 1, boards: [] };
}
function store(personId: string, saved: Saved) {
  mkdirSync(dir(), { recursive: true });
  const file = personFile(personId);
  // Written whole to a new file, then swapped in, so a crash never leaves half a board
  writeFileSync(file + ".tmp", JSON.stringify(saved), { mode: 0o600 });
  renameSync(file + ".tmp", file);
}

// Their boards (a first one is made for anyone who has none). ?who=everyone: an admin (or the
// studio computer) sees everyone's, each with its owner.
export function listBoards(person: Person, everyone = false): Board[] {
  if (everyone && person.everyone) {
    if (!existsSync(dir())) return listBoards(person, false);
    const all: Board[] = [];
    for (const name of readdirSync(dir()).filter((f) => f.endsWith(".json"))) {
      const owner = name.slice(0, -5);
      for (const b of load(owner).boards) all.push({ ...b, owner });
    }
    return all;
  }
  const saved = load(person.id);
  if (!saved.boards.length) {
    const now = new Date().toISOString();
    saved.boards.push({ id: newId(), name: "My board", created: now, updated: now, view: { x: 0, y: 0, zoom: 1 }, cards: [] });
    store(person.id, saved);
  }
  return saved.boards;
}

// Save one of their own boards whole (a new id: a new board). `base`: the time of the board the
// page last had, so a page that missed a newer save is told (it then takes the newer one).
export function saveBoard(person: Person, id: string, raw: unknown, base?: string): { board: Board; conflict?: Board } {
  if (!ID.test(id)) throw new Error("That isn't a board's name.");
  const saved = load(person.id);
  const at = saved.boards.findIndex((b) => b.id === id);
  if (at < 0 && saved.boards.length >= MAX_BOARDS) throw new Error(`That's ${MAX_BOARDS} boards already: delete one first.`);
  if (at >= 0 && base && saved.boards[at].updated > base) return { board: saved.boards[at], conflict: saved.boards[at] };
  const board = cleanBoard(raw, id);
  if (at >= 0) board.created = saved.boards[at].created;
  if (at >= 0) saved.boards[at] = board;
  else saved.boards.push(board);
  store(person.id, saved);
  return { board };
}

export function removeBoard(person: Person, id: string): boolean {
  const saved = load(person.id);
  const before = saved.boards.length;
  saved.boards = saved.boards.filter((b) => b.id !== id);
  if (saved.boards.length === before) return false;
  store(person.id, saved);
  return true;
}

// The files a person's boards still show (so a removed card's file can be tidied away later)
export function filesInUse(): Set<string> {
  const used = new Set<string>();
  if (!existsSync(dir())) return used;
  for (const name of readdirSync(dir()).filter((f) => f.endsWith(".json"))) {
    for (const b of load(name.slice(0, -5)).boards) for (const c of b.cards) if (c.fileId) used.add(c.fileId);
  }
  return used;
}
