// Calendar's data: the studio's events and day cards, kept by Nova Bot
// (/app/api/calendar/items), so they're the same on every phone and computer and with the
// studio PC off. A copy is kept in this browser so the calendar opens instantly and works
// offline; changes made offline wait in a queue and go when the connection is back.
// The latest change wins everywhere; when another device's change was later, it's shown.

import { queued, stamped } from "./edits.js";

const API = "/app/api/calendar/items";
const CACHE = "nova-calendar/cloud-v1";
const MIGRATED = "nova-calendar/migrated-v2";
// Where earlier versions of Calendar kept things in this browser
const OLD_KEYS = ["nova-calendar/v1", "nova-task/v1", "nova-calendar/before-nova-agent"];

const listeners = new Set();
const state = { items: new Map(), rev: 0, queue: [], signedIn: true, online: true, loaded: false, error: "" };

const nowIso = () => new Date().toISOString();
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (c && Array.isArray(c.items)) {
      state.items = new Map(c.items.map((i) => [i.id, i]));
      state.rev = Number(c.rev) || 0;
      state.queue = Array.isArray(c.queue) ? c.queue : [];
    }
  } catch {}
}
function writeCache() {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ rev: state.rev, items: [...state.items.values()], queue: state.queue }));
  } catch {}
}
function emit(reason) {
  for (const fn of listeners) fn(reason);
}
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const items = () => [...state.items.values()];
export const get = (id) => state.items.get(id);
export const status = () => ({ signedIn: state.signedIn, online: state.online, waiting: state.queue.length, loaded: state.loaded, error: state.error });

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    state.signedIn = false;
    throw Object.assign(new Error("Sign in first"), { signin: true });
  }
  state.signedIn = true;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

// Another device's later change: show it, and say so
let onConflict = () => {};
export function setConflictHandler(fn) {
  onConflict = fn;
}
function adopt(current) {
  if (!current) return;
  if (current.deleted) state.items.delete(current.id);
  else state.items.set(current.id, current);
}

// Send what's waiting, in order
let flushing = null;
function flush() {
  if (flushing) return flushing;
  // (cleared once it's done, after it's been stored: never stuck "busy")
  flushing = sendWaiting().finally(() => {
    flushing = null;
    emit("status");
  });
  return flushing;
}
async function sendWaiting() {
  {
    while (state.queue.length) {
      const op = state.queue[0];
      try {
        const r =
          op.op === "put"
            ? await request("PUT", `${API}/${encodeURIComponent(op.item.id)}`, op.item)
            : await request("DELETE", `${API}/${encodeURIComponent(op.id)}?updated=${encodeURIComponent(op.updated)}`);
        state.online = true;
        if (r && r.ok === false && r.current) {
          adopt(r.current);
          onConflict(r.current);
        }
        state.queue.shift();
        writeCache();
      } catch (err) {
        if (err.status && err.status >= 400 && err.status < 500 && !err.signin) {
          // Turned away for good (bad data, or Nova Agent's own entry): drop it, say why
          state.queue.shift();
          state.error = err.message;
          writeCache();
          emit("error");
          continue;
        }
        state.online = !!err.signin;
        break;
      }
    }
  }
}

// Bring this copy up to date (send waiting changes first)
let syncing = null;
export function sync() {
  if (syncing) return syncing;
  syncing = fetchChanges().finally(() => (syncing = null));
  return syncing;
}
async function fetchChanges() {
  {
    try {
      await flush();
      if (state.queue.length && !state.online) throw new Error("offline");
      const r = await request("GET", `${API}?since=${state.rev}`);
      state.online = true;
      const waiting = new Set(state.queue.map((op) => op.id || op.item.id));
      for (const item of r.items || []) {
        // Something changed here and not sent yet stays as it is here
        if (waiting.has(item.id)) continue;
        adopt(item);
      }
      state.rev = Math.max(state.rev, Number(r.rev) || 0);
      state.loaded = true;
      writeCache();
      emit("sync");
      if (!localStorage.getItem(MIGRATED)) await migrate();
    } catch (err) {
      if (!err.signin) state.online = false;
      emit("status");
    }
  }
}

function enqueue(op) {
  const id = op.op === "put" ? op.item.id : op.id;
  // Only the latest change to each item needs to go (made to the version the first one was: edits.js)
  state.queue = queued(state.queue, op);
  writeCache();
  emit("change");
  void flush();
}

// Save an event or day card (new or changed)
export function save(item) {
  // The version this change was made to goes with it (`base`): if this device's clock is behind,
  // Nova Bot still knows it's the newest change and keeps it (edits.js)
  const { out, sent } = stamped(item, (id) => state.items.get(id), nowIso(), uid);
  state.items.set(out.id, out);
  enqueue({ op: "put", item: sent });
  return out;
}
// Delete one; returns the item (for Undo)
export function remove(id) {
  const item = state.items.get(id);
  state.items.delete(id);
  enqueue({ op: "del", id, updated: nowIso() });
  return item;
}

// Calendar's earlier homes in this browser: brought in once, never twice (same ids)
async function migrate() {
  const found = [];
  for (const key of OLD_KEYS) {
    try {
      const old = JSON.parse(localStorage.getItem(key) || "null");
      if (!old) continue;
      for (const n of Array.isArray(old.notes) ? old.notes : []) if (n && n.id && n.start) found.push({ ...n, kind: "event" });
      for (const d of Array.isArray(old.days) ? old.days : []) if (d && d.id && d.date) found.push({ ...d, kind: "day" });
    } catch {}
  }
  let brought = 0;
  for (const item of found) {
    if (state.items.has(item.id)) continue;
    const kept = { ...item, updated: item.updated || nowIso(), created: item.created || nowIso() };
    state.items.set(kept.id, kept);
    state.queue.push({ op: "put", item: kept });
    brought++;
  }
  localStorage.setItem(MIGRATED, nowIso());
  if (brought) {
    writeCache();
    emit("change");
    void flush();
  }
}

// Studio bookings (read-only): Nova Bot's own bookings
export async function bookings() {
  try {
    const r = await request("GET", "/app/api/calendar");
    return Array.isArray(r.bookings) ? r.bookings : [];
  } catch {
    return [];
  }
}

export function start() {
  readCache();
  emit("sync");
  void sync();
  setInterval(() => document.visibilityState === "visible" && void sync(), 30000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void sync());
  addEventListener("online", () => void sync());
  // Signing in or out (the planet at the top) changes what can be seen
  try {
    const ch = new BroadcastChannel("nova-portal");
    ch.onmessage = () => setTimeout(() => void sync(), 400);
  } catch {}
}
