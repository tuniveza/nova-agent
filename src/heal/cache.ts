// The selector cache: the agent's memory of where things are on Acuity's pages.
//
// Stored in data/selectors.json as { "some.key": { role, name, nth, ... } }.
// It's a small file, so we simply read it, change it and write it back.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../config";

// How to find an element: Playwright's getByRole(role, { name }), and if
// several elements share that role + name, which one (0 = first).
export interface RoleLocator {
  role: string;
  name: string;
  nth: number;
}

export interface CacheEntry extends RoleLocator {
  healedAt: string; // when the AI last (re)discovered this element
  hits: number; // how many times the cached answer worked
}

type Cache = Record<string, CacheEntry>;

export function readCache(): Cache {
  if (!existsSync(config.paths.selectors)) return {};
  try {
    return JSON.parse(readFileSync(config.paths.selectors, "utf8")) as Cache;
  } catch {
    // A broken file shouldn't stop the agent: start fresh, the AI will re-find things.
    console.warn("[cache] selectors.json was unreadable, starting with an empty cache.");
    return {};
  }
}

// Where things were when we looked at Acuity's real pages on 2026-10-05
// (see docs/acuity-ui-notes.md). Used when selectors.json has no entry yet,
// so the agent works before the AI has ever been asked. If one stops working,
// resolve() asks the AI as usual and saves the new answer to selectors.json.
const BUILT_IN: Record<string, RoleLocator> = {
  "login.email_field": { role: "textbox", name: "Username", nth: 0 },
  "login.next_button": { role: "button", name: "Next", nth: 0 },

  "appointment.cancel_link": { role: "link", name: "Cancel", nth: 0 },
  "cancel.send_email_checkbox": { role: "checkbox", name: "Send email to client", nth: 0 },
  "cancel.note_box": { role: "textbox", name: "Include note to client (optional)", nth: 0 },
  "cancel.confirm_button": { role: "button", name: "Cancel Appointment", nth: 0 },

  "appointment.edit_link": { role: "link", name: "Edit", nth: 0 },
  "edit.first_name": { role: "textbox", name: "First Name", nth: 0 },
  "edit.last_name": { role: "textbox", name: "Last Name", nth: 0 },
  "edit.phone": { role: "textbox", name: "Phone", nth: 0 },
  "edit.email": { role: "textbox", name: "Email", nth: 0 },
  "edit.notes": { role: "textbox", name: "Private notes about appointment", nth: 0 },
  "edit.price": { role: "textbox", name: "Total Price", nth: 0 },
  "edit.paid": { role: "checkbox", name: "Total Price (£) Paid(yes)", nth: 0 },
  "edit.save_button": { role: "button", name: "Save", nth: 0 },

  "reschedule.confirm_button": { role: "button", name: "Reschedule Appointment", nth: 0 },

  "book.first_name": { role: "textbox", name: "First Name *", nth: 0 },
  "book.last_name": { role: "textbox", name: "Last Name *", nth: 0 },
  "book.phone": { role: "textbox", name: "Phone", nth: 0 },
  "book.email": { role: "textbox", name: "Email", nth: 0 },
  "book.confirm_button": { role: "button", name: "Schedule Appointment", nth: 0 },
};

export function getCached(key: string): CacheEntry | undefined {
  const saved = readCache()[key];
  if (saved) return saved;
  const builtIn = BUILT_IN[key];
  return builtIn && { ...builtIn, healedAt: "2026-10-05T00:00:00.000Z", hits: 0 };
}

export function saveToCache(key: string, locator: RoleLocator): void {
  const cache = readCache();
  cache[key] = { ...locator, healedAt: new Date().toISOString(), hits: 0 };
  writeCache(cache);
}

export function countCacheHit(key: string): void {
  const cache = readCache();
  // The first time a built-in answer is used, copy it into selectors.json so
  // it shows up (and is counted) like any other remembered answer.
  const entry = cache[key] ?? getCached(key);
  if (!entry) return;
  cache[key] = entry;
  entry.hits += 1;
  writeCache(cache);
}

function writeCache(cache: Cache): void {
  mkdirSync(config.paths.dataDir, { recursive: true });
  writeFileSync(config.paths.selectors, JSON.stringify(cache, null, 2));
}
