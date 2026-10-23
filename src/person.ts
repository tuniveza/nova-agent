// Who's asking: every request to Nova Agent's server is from one person.
//
//   Online (through Nova Bot's relay, src/relay.ts): the signed-in Portal staff member Nova Bot
//   passed with the request ({ id, name, role }). Only the relay can say so: it marks the very
//   Request object it builds (a WeakMap here), so no header or address can pretend to be someone.
//   On the PC itself: the person Nova Agent works for (src/staff.ts, the badge).
//
// Chats, quests, blocked times and reminders belong to a person (their staff id).
// Anything with no owner (everything made before this) belongs to the person Nova Agent works
// for on the PC, so existing data keeps working without being rewritten.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { config } from "./config";
import { pcOwner, pcOwnerId, whoAmI } from "./staff";

export interface Person {
  id: string; // their staff id ("owner" while the PC doesn't know who it works for yet)
  name: string;
  role: string; // "admin" | "staff"
  online: boolean; // came through Nova Bot's relay
  pcOwner: boolean; // the person Nova Agent works for on the PC (owns everything ownerless)
  everyone: boolean; // may see everyone's quests (admins, and the PC itself)
}
export type RelayStaff = { id?: string; name?: string; role?: string } | null;

const relayed = new WeakMap<Request, RelayStaff>();
// The relay marks each request it builds with who sent it
export function markRelayed(req: Request, staff: RelayStaff): Request {
  relayed.set(req, staff);
  return req;
}
export const isRelayed = (req: Request) => relayed.has(req);

const cleanId = (v: unknown) => (typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64) : "");

// The person behind one request
export async function personFor(req: Request): Promise<Person> {
  if (relayed.has(req)) {
    const s = relayed.get(req);
    const id = cleanId(s?.id);
    if (!id) throw new Error("Relayed request without a person");
    const role = s?.role === "admin" ? "admin" : "staff";
    const person = { id, name: String(s?.name || id).slice(0, 80), role, online: true, pcOwner: id === pcOwnerId(), everyone: role === "admin" };
    remember(person);
    return person;
  }
  await whoAmI().catch(() => null);
  return localPerson();
}

// On the PC: whoever Nova Agent works for. The studio computer sees everyone's (it holds them all).
export function localPerson(): Person {
  const o = pcOwner();
  const person = { id: o.id, name: o.name, role: o.role === "admin" ? "admin" : "staff", online: false, pcOwner: true, everyone: true };
  if (o.id !== "owner") remember(person);
  return person;
}

// The owner to save on something a person makes ("" = the PC's person, while they aren't known yet)
export const ownerToSave = (p: Pick<Person, "id">) => (p.id === "owner" ? "" : p.id);
// Whose it is: its own owner, or (none) the person Nova Agent works for on the PC
export const ownerOf = (x: { owner?: string }) => x.owner || pcOwnerId();
export const isMine = (x: { owner?: string }, p: Pick<Person, "id">) => ownerOf(x) === p.id;

// Names of people seen (for "Everyone's" views): data/people.json, { id: { name, role, seen } }
type People = Record<string, { name: string; role: string; seen: string }>;
const peopleFile = () => `${config.paths.dataDir}people.json`;
let people: People | null = null;
function loadPeople(): People {
  if (people) return people;
  try {
    people = existsSync(peopleFile()) ? (JSON.parse(readFileSync(peopleFile(), "utf8")) as People) : {};
  } catch {
    people = {};
  }
  return people;
}
function remember(p: Pick<Person, "id" | "name" | "role">) {
  const all = loadPeople();
  const was = all[p.id];
  if (was && was.name === p.name && was.role === p.role && Date.now() - Date.parse(was.seen) < 864e5) return;
  all[p.id] = { name: p.name, role: p.role, seen: new Date().toISOString() };
  try {
    mkdirSync(config.paths.dataDir, { recursive: true });
    writeFileSync(`${peopleFile()}.tmp`, JSON.stringify(all, null, 2));
    renameSync(`${peopleFile()}.tmp`, peopleFile());
  } catch {}
}
export function personName(id: string): string {
  if (id === pcOwnerId()) return pcOwner().name;
  return loadPeople()[id]?.name || id;
}
