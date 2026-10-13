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
  asset?: string; // a picture/video/sound that comes with Board itself (the Welcome board's)
  hint?: boolean; // a text card that's a little label ("drag me"), not a card to write on
}
export interface Board {
  id: string;
  name: string;
  created: string;
  updated: string;
  view: { x: number; y: number; zoom: number };
  cards: Card[];
  owner?: string; // filled in when an admin looks at everyone's
  welcome?: boolean; // the first-run Welcome board, until its person chooses what to do with it
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
    if (typeof raw.asset === "string" && WELCOME_ASSET.test(raw.asset)) card.asset = raw.asset;
    else if (typeof raw.fileId === "string" && /^b-\d{8}-[a-f0-9]{12}$/.test(raw.fileId)) card.fileId = raw.fileId;
    else return null;
    set("fileType", str(raw.fileType, 100));
    set("fileName", str(raw.fileName, 200));
  }
  if (kind === "text" && raw.hint === true) card.hint = true;
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
    ...(raw?.welcome === true ? { welcome: true } : {}),
    name: str(raw?.name, 80)?.trim() || "Board",
    created: iso(raw?.created, now),
    updated: now,
    view: { x: num(raw?.view?.x, -LIMIT, LIMIT, 0), y: num(raw?.view?.y, -LIMIT, LIMIT, 0), zoom: num(raw?.view?.zoom, 0.2, 3, 1) },
    cards,
  };
}

// ---- The Welcome board: shown once to each person, the first time they open Board ----
// A calm showcase laid out on the table: a looping video, a picture and a sound (made for Board:
// web/board/assets/welcome/), a link, a pinned card, a sticky note, a question card, an Agent
// question with its answer (a sample: nothing is asked), a note and this week from the calendar,
// with little labels saying what to try. A banner on it (web/board/js/board.js) lets them clear
// it and start, keep it and start a new board, or keep it as it is; then it's an ordinary board.
export const WELCOME_ASSET = /^\/board\/assets\/welcome\/[\w-]+\.(mp4|webp|mp3)$/;
function mondayUk(now: Date): string {
  const d = new Date(now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
export function welcomeBoard(now = new Date()): Board {
  const at = now.toISOString();
  const earlier = new Date(now.getTime() - 26 * 3600_000).toISOString();
  let z = 1;
  const card = (kind: CardKind, x: number, y: number, w: number, h: number, turn: number, more: Partial<Card>): Card => ({ id: newId(), kind, x, y, w, h, z: z++, turn, pinned: false, created: at, updated: at, ...more });
  const hint = (x: number, y: number, text: string, turn = 0) => card("text", x, y, 250, 96, turn, { text, hint: true });
  return {
    id: newId(),
    name: "Welcome",
    created: at,
    updated: at,
    welcome: true,
    view: { x: 0, y: 0, zoom: 0.8 },
    cards: [
      card("text", -330, -470, 660, 120, 0, { text: "Welcome to Board ✦\nA table for everything: lay it out, move it around, pin what matters." }),
      card("file", -700, -300, 420, 290, -1.5, { asset: "/board/assets/welcome/nebula.mp4", fileType: "video/mp4", fileName: "A video", title: "A video plays right on the table" }),
      hint(-700, 4, "↖ drop your own videos, pictures and sounds"),
      card("image", -230, -300, 360, 250, 1.2, { asset: "/board/assets/welcome/nebula.webp", fileType: "image/webp", fileName: "A picture", title: "A picture" }),
      card("file", 180, -300, 300, 150, -0.8, { asset: "/board/assets/welcome/chime.mp3", fileType: "audio/mpeg", fileName: "A calm chime", title: "A sound" }),
      hint(500, -280, "← press play", 2),
      card("sticky", 180, -110, 260, 200, 2.5, { colour: "rose", text: "Drag me anywhere.\nGrab my corner to make me bigger." }),
      hint(460, -60, "drag me ↙", -3),
      card("sticky", -230, -20, 280, 200, -2, { colour: "teal", text: "I'm pinned 📌\nTap my pin to let me move.", pinned: true }),
      card("question", 80, 120, 320, 230, 0.6, { text: "What's the next song we finish?", answer: "Write the answer, notes or next steps here." }),
      card("agent", 430, 120, 360, 260, -1, { title: "What should I work on first this week?", answer: "This is an example answer. Ask Agent anything on an Ask Agent card (+ → Ask Agent) and its answer lands right here, and in your Agent conversation too.", asked: earlier }),
      card("note", -700, 110, 300, 190, 1.4, { title: "An example note", text: "Notes come onto the table from the drawer (the ☰ button), with when they were made and changed.", noteCreated: earlier, noteUpdated: at }),
      card("calendar", -380, 210, 440, 260, -0.6, { span: "week", start: mondayUk(now) }),
      card("link", 820, -300, 300, 140, 1, { url: "https://novacane.co.uk/", title: "Novacane Studios", text: "Links show their page's title and picture." }),
      hint(820, -140, "wheel or pinch to zoom, drag the table to move around"),
      hint(820, 410, "+ Add makes cards; drop or paste anything", 1.5),
    ],
  };
}

// ---- On disk: one file per person ----
interface Saved {
  version: 1;
  boards: Board[];
  welcomed?: boolean; // the Welcome board has been given to them (once, ever)
}
function load(personId: string): Saved {
  try {
    const file = personFile(personId);
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (data && Array.isArray(data.boards)) return { version: 1, boards: data.boards, ...(data.welcomed ? { welcomed: true } : {}) };
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
  // The first time they open Board: the Welcome board, first in their list (once, ever: they
  // decide what becomes of it)
  if (!saved.welcomed && saved.boards.length < MAX_BOARDS) {
    saved.boards.unshift(welcomeBoard());
    saved.welcomed = true;
    store(person.id, saved);
  }
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
