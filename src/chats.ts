// Each person's own conversation with Nova Agent's Agent.
//
// Kept on the PC, one file per person: data/chats/<staff id>.json. A person only ever gets their
// own (the server works out who's asking, src/person.ts; nothing a page sends can pick another
// file). Before this, the conversation lived only in the browser: the person Nova Agent works for
// on the PC can bring that one over, once, into their own file (adoptChat).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { config } from "./config";
import type { ChatAction, ChatTurn } from "./chat";
import type { Person } from "./person";

export interface SavedTurn extends ChatTurn {
  actions?: ChatAction[];
  at: string;
}
export interface SavedChat {
  staffId: string;
  messages: SavedTurn[];
  updated: string;
}

const KEEP = 80; // turns kept (the page showed the last 80 before, too)
const dir = () => `${config.paths.dataDir}chats/`;
// A plain file name for a staff id (ids are already plain; anything else is hashed)
export function chatFile(staffId: string): string {
  const plain = /^[a-z0-9_-]{1,64}$/.test(staffId) ? staffId : `id-${createHash("sha256").update(staffId).digest("hex").slice(0, 24)}`;
  return `${dir()}${plain}.json`;
}

const clean = (m: any): SavedTurn | null =>
  (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim()
    ? { role: m.role, content: m.content.slice(0, 20000), ...(Array.isArray(m.actions) && m.actions.length ? { actions: m.actions.slice(0, 40) } : {}), at: typeof m.at === "string" ? m.at.slice(0, 40) : new Date().toISOString() }
    : null;

export function readChat(staffId: string): SavedTurn[] {
  const file = chatFile(staffId);
  if (!existsSync(file)) return [];
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as SavedChat;
    // A file that isn't theirs (it can't happen by name, but never show someone else's)
    if (saved.staffId !== staffId) return [];
    return (Array.isArray(saved.messages) ? saved.messages : []).map(clean).filter(Boolean) as SavedTurn[];
  } catch {
    return [];
  }
}

function writeChat(staffId: string, messages: SavedTurn[]): void {
  mkdirSync(dir(), { recursive: true });
  const file = chatFile(staffId);
  const body: SavedChat = { staffId, messages: messages.slice(-KEEP), updated: new Date().toISOString() };
  writeFileSync(`${file}.tmp`, JSON.stringify(body, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

export function appendChat(staffId: string, turns: Omit<SavedTurn, "at">[]): SavedTurn[] {
  const at = new Date().toISOString();
  const next = [...readChat(staffId), ...(turns.map((t) => clean({ ...t, at })).filter(Boolean) as SavedTurn[])];
  writeChat(staffId, next);
  return next.slice(-KEEP);
}

export function clearChat(staffId: string): void {
  rmSync(chatFile(staffId), { force: true });
}

// The conversation the browser kept before this (the PC's person only, and only into an empty
// history): brought over once
export function adoptChat(person: Pick<Person, "id" | "pcOwner">, messages: unknown): { adopted: number } {
  if (!person.pcOwner || !Array.isArray(messages) || readChat(person.id).length) return { adopted: 0 };
  const turns = messages.map(clean).filter(Boolean) as SavedTurn[];
  if (!turns.length) return { adopted: 0 };
  writeChat(person.id, turns);
  return { adopted: Math.min(turns.length, KEEP) };
}

// One turn of the Agent for one person: their history, their new message, the answer saved to
// their history. `answer` is the Agent (chat.ts), passed in so this can be tried without Claude.
export async function chatTurn(
  person: Person,
  body: { message?: unknown; messages?: unknown },
  answer: (history: ChatTurn[], person: Person) => Promise<{ reply: string; actions: ChatAction[] }>,
): Promise<{ reply: string; actions: ChatAction[] }> {
  // The new message (a page from before this sends the whole conversation: its last message is the new one)
  let text = typeof body.message === "string" ? body.message : "";
  if (!text && Array.isArray(body.messages)) {
    const last = [...body.messages].reverse().find((m: any) => m?.role === "user" && typeof m.content === "string");
    text = last?.content ?? "";
  }
  text = text.trim().slice(0, 8000);
  if (!text) throw new Error("Nothing to answer.");
  const history = readChat(person.id).map(({ role, content }) => ({ role, content }));
  const result = await answer([...history, { role: "user", content: text }], person);
  appendChat(person.id, [
    { role: "user", content: text },
    { role: "assistant", content: result.reply, actions: result.actions },
  ]);
  return result;
}
