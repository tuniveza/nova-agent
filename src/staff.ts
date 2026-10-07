// Who Nova Agent works for: found without anyone setting anything.
//   1. NOVA_STAFF_ID in .env, if it's set (an override)
//   2. whoever pressed "Connect as me" on Nova Agent's Nova Portal badge (kept in data/staff.json)
//   3. otherwise the studio's first Nova Portal admin (Nova Bot works it out)
//   4. "owner" while Nova Portal has nobody yet, or Nova Bot can't be reached
// Nova Index's memory (src/memory.ts) and the badge both ask here, so they always agree.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config";
import { trace } from "./trace";

export type How = "set" | "connected" | "auto" | "stand-in";
export type Staff = {
  id: string;
  display_name: string;
  role: string;
  status: string;
  planet_seed: string;
  planet_overrides: unknown;
  index_partition: string;
  created_at: string | null;
  planet?: { name?: string; description?: string; glow?: string };
};
export type Who = { staff: Staff; via: "nova-agent"; linked: boolean; how: How };

type Saved = { connected?: string; last?: string };
const KEEP_MS = 5 * 60_000;
let cache: { at: number; who: Who } | null = null;
let asking: Promise<Who> | null = null;

function saved(): Saved {
  try {
    return existsSync(config.paths.staff) ? (JSON.parse(readFileSync(config.paths.staff, "utf8")) as Saved) : {};
  } catch {
    return {};
  }
}
function save(next: Saved) {
  try {
    writeFileSync(config.paths.staff, JSON.stringify(next, null, 2) + "\n");
  } catch (err) {
    trace("llm", "warn", `Couldn't save who Nova Agent works for: ${(err as Error).message}`);
  }
}

// A stand-in from an id, for when Nova Portal doesn't know them (or can't be reached)
function standIn(id: string): Who {
  const name = id === "owner" ? "Studio" : id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    staff: { id, display_name: name, role: "staff", status: "local", planet_seed: id, planet_overrides: null, index_partition: `staff:${id}`, created_at: null },
    via: "nova-agent",
    linked: false,
    how: "stand-in",
  };
}

async function ask(): Promise<Who> {
  const keep = saved();
  const chosen = config.staffId || keep.connected || "";
  const how: How = config.staffId ? "set" : keep.connected ? "connected" : "auto";
  if (!config.agentNovaKey) return standIn(chosen || keep.last || "owner");
  try {
    const res = await fetch(`${config.workerUrl}/hub/agent/me`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.agentNovaKey}`, "Content-Type": "application/json" },
      // No id: Nova Bot picks the studio's first admin
      body: JSON.stringify(chosen ? { staff_id: chosen } : {}),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nova Bot said ${res.status}`);
    const data = (await res.json()) as { staff: Staff; linked: boolean };
    const who: Who = { staff: data.staff, via: "nova-agent", linked: data.linked, how: data.linked ? how : "stand-in" };
    if (keep.last !== who.staff.id) {
      save({ ...keep, last: who.staff.id });
      if (keep.last) trace("llm", "info", `Nova Agent now works for ${who.staff.display_name} (${who.staff.id})`);
    }
    return who;
  } catch {
    // Offline: whoever it was last time
    return standIn(chosen || keep.last || "owner");
  }
}

// Who it is now (asks Nova Bot at most every 5 minutes; never throws)
export async function whoAmI(force = false): Promise<Who> {
  if (!force && cache && Date.now() - cache.at < KEEP_MS) return cache.who;
  if (asking) return asking;
  asking = ask()
    .then((who) => {
      // A stand-in from being offline isn't kept long, so the real answer shows soon
      cache = { at: who.how === "stand-in" && saved().last ? Date.now() - KEEP_MS + 30_000 : Date.now(), who };
      return who;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}

// Just the id (for Nova Index's memory)
export async function staffId(): Promise<string> {
  return (await whoAmI()).staff.id;
}

// "Connect as me": a read-only Nova Portal token proves who it is, then it's put away
export async function connectAs(token: string): Promise<Who> {
  if (!/^nprof_[\w-]+$/.test(token)) throw new Error("That isn't a Nova Portal connect token.");
  const auth = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${config.workerUrl}/auth/me`, { headers: auth, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("Nova Portal didn't recognise that sign-in. Try Connect again.");
  const { staff } = (await res.json()) as { staff: Staff };
  // Nova Agent only needed to know who; the token itself isn't kept
  fetch(`${config.workerUrl}/auth/logout`, { method: "POST", headers: auth, signal: AbortSignal.timeout(8000) }).catch(() => {});
  save({ ...saved(), connected: staff.id, last: staff.id });
  trace("llm", "info", `Nova Agent now works for ${staff.display_name} (${staff.id}), connected in Nova Portal`);
  return whoAmI(true);
}

// Back to automatic (the studio's first admin)
export async function forgetConnected(): Promise<Who> {
  const { last } = saved();
  save(last ? { last } : {});
  return whoAmI(true);
}
