// Google, from the studio PC's side (Nova Bot holds the studio's Google connection: its
// src/google/; set up in Portal → Admin → Google). Through Nova Bot, with Nova Agent's key:
//
//   POST /nova-agent/google/status                       is Google connected (and Drive on)?
//   POST /nova-agent/google/drive/put?kind=&id=&name=&type=   (body: the file) a copy in Drive
//   POST /nova-agent/google/drive/drop  { kind, id }     the copy goes (to Drive's bin)
//   POST /nova-agent/google/busy        { from, to }     busy times in Google Calendar
//   POST /nova-agent/google/gmail/search { q }           who, subject, when, a snippet
//   POST /nova-agent/google/contacts/find { q }          names, emails, phones
//
// Copies in Drive: each social post picture or video and each receipt saved here gets a copy in
// the studio's Drive ("Nova Agent" folder), so Nova Bot can hand Meta a picture (and Portal can
// show a receipt) with this computer off. This computer's copy stays the main one; the copy is
// sent in the background and a failure is only noted (the next save tries again).
// Every night: this computer's files (Agent's file_write ones) are copied into Drive's Backups.
//
// There's no send, create or change tool for the AI here: the read ones only.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { config } from "./config";
import { trace } from "./trace";

interface Status {
  connected: boolean;
  drive: boolean;
  backups: boolean;
  files?: boolean; // Agent's files kept in Drive's "Files" folder as they change
  tasks?: boolean; // quests ⇄ Google Tasks
}

async function call<T>(path: string, body: unknown = {}, raw?: { bytes: Uint8Array; type: string }): Promise<T> {
  if (!config.agentNovaKey) throw new Error("Nova Agent isn't connected to Nova Bot (no AGENT_NOVA_KEY).");
  const response = await fetch(`${config.workerUrl}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.agentNovaKey}`, "Content-Type": raw ? raw.type : "application/json" },
    body: raw ? new Blob([new Uint8Array(raw.bytes)], { type: raw.type }) : JSON.stringify(body),
    signal: AbortSignal.timeout(raw ? 180_000 : 20_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Nova Bot answered ${response.status}`);
  return data;
}

// Is Google connected? (asked at most every 10 minutes)
let known: { at: number; status: Status } | null = null;
export async function googleStatus(): Promise<Status> {
  if (known && Date.now() - known.at < 10 * 60_000) return known.status;
  try {
    const status = await call<Status>("/nova-agent/google/status");
    known = { at: Date.now(), status };
    return status;
  } catch {
    return { connected: false, drive: false, backups: false, files: false, tasks: false };
  }
}
export const forgetGoogleStatus = () => void (known = null);

// ---- Copies in Drive ----

export type DriveKind = "media" | "receipt" | "backup" | "file";

export async function copyToDrive(kind: DriveKind, id: string, name: string, type: string, bytes: Uint8Array): Promise<boolean> {
  const status = await googleStatus();
  if (!status.connected || !(kind === "backup" ? status.backups : kind === "file" ? status.files : status.drive)) return false;
  const q = new URLSearchParams({ kind, id, name, type });
  const result = await call<{ ok?: boolean; skipped?: boolean }>(`/nova-agent/google/drive/put?${q}`, {}, { bytes, type });
  return Boolean(result.ok);
}

// In the background: never holds up the save, never throws
export function copyToDriveLater(kind: DriveKind, id: string, name: string, type: string, bytes: Uint8Array): void {
  void copyToDrive(kind, id, name, type, bytes)
    .then((done) => done && trace("task", "ok", `Google Drive: a copy of a ${kind === "media" ? "social post's file" : kind} is kept there`))
    .catch((error) => trace("task", "warn", `Google Drive didn't take a copy: ${(error as Error).message}`));
}

export function dropFromDriveLater(kind: DriveKind, id: string): void {
  void googleStatus()
    .then((s) => (s.connected ? call("/nova-agent/google/drive/drop", { kind, id }) : null))
    .catch(() => {});
}

// Every night: this computer's files into Drive's Backups (one copy each, kept up to date)
export async function backupFilesToDrive(): Promise<number> {
  const status = await googleStatus();
  if (!status.connected || !status.backups) return 0;
  const dir = `${config.paths.dataDir}files/`;
  if (!existsSync(dir)) return 0;
  let sent = 0;
  let names: Record<string, string> = {};
  try {
    const index = JSON.parse(readFileSync(`${dir}index.json`, "utf8")) as { id: string; name: string }[];
    names = Object.fromEntries(index.map((f) => [f.id, f.name]));
  } catch {}
  for (const file of readdirSync(dir)) {
    const m = /^([\w-]+)\.(md|txt|csv|json|html)$/.exec(file);
    if (!m) continue;
    const name = file === "index.json" ? "files-index.json" : names[m[1]] || file;
    const type = { md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html" }[m[2]] as string;
    try {
      if (await copyToDrive("backup", `files/${file}`, name, type, new Uint8Array(readFileSync(`${dir}${file}`)))) sent++;
    } catch (error) {
      trace("task", "warn", `Backup to Google Drive stopped: ${(error as Error).message}`);
      break;
    }
  }
  return sent;
}

// Agent's files (file_write): a copy in Drive's "Nova Agent/Files" each time one's saved, kept up to
// date in place (Portal → Admin → Google → "Files and invoices in Drive")
const FILE_TYPES: Record<string, string> = { md: "text/markdown", txt: "text/plain", csv: "text/csv", json: "application/json", html: "text/html" };
export function mirrorFileLater(file: string, name: string, content: string): void {
  const ext = (/\.(\w+)$/.exec(file) || [])[1] || "txt";
  copyToDriveLater("file", `files/${file}`, name, FILE_TYPES[ext] || "text/plain", new TextEncoder().encode(content));
}

// ---- Quests ⇄ Google Tasks ----
// Every 10 minutes: this PC's person's quests to Nova Bot, which keeps a "Nova quests" list in
// Google Tasks in step (src/google/tasks.js there). Quests ticked off in Google come back here as
// done. Repeating quests stay out (a task list can't hold "every day").

export interface TaskQuest {
  id: string;
  title: string;
  notes: string;
  due: string | null;
  done: boolean;
}
export async function syncTasks(quests: TaskQuest[]): Promise<{ completed: string[]; note?: string; skipped?: boolean } | null> {
  const status = await googleStatus();
  if (!status.connected || !status.tasks) return null;
  return call("/nova-agent/google/tasks/sync", { quests });
}

// ---- For Agent (read-only) ----

export interface BusyTime {
  start: string;
  end: string;
}
export async function googleBusy(fromIso: string, toIso: string): Promise<BusyTime[]> {
  return (await call<{ busy: BusyTime[] }>("/nova-agent/google/busy", { from: fromIso, to: toIso })).busy ?? [];
}
export interface MailHit {
  from: string;
  subject: string;
  date: string;
  snippet: string;
}
export async function gmailSearch(q: string): Promise<MailHit[]> {
  return (await call<{ messages: MailHit[] }>("/nova-agent/google/gmail/search", { q })).messages ?? [];
}
export interface ContactHit {
  name: string;
  email: string | null;
  phone: string | null;
}
export async function contactsFind(q: string): Promise<ContactHit[]> {
  return (await call<{ contacts: ContactHit[] }>("/nova-agent/google/contacts/find", { q })).contacts ?? [];
}

export interface TaskHit {
  list: string;
  title: string;
  due: string | null;
  notes: string;
}
export async function tasksList(): Promise<TaskHit[]> {
  return (await call<{ tasks: TaskHit[] }>("/nova-agent/google/tasks/list", {})).tasks ?? [];
}
export interface DriveHit {
  id: string;
  name: string;
  kind: string;
  modified: string;
  url: string;
}
export async function driveSearch(q: string): Promise<DriveHit[]> {
  return (await call<{ files: DriveHit[] }>("/nova-agent/google/drive/search", { q })).files ?? [];
}
export async function docRead(id: string): Promise<{ name: string; url: string; text: string; cut: boolean }> {
  return call("/nova-agent/google/doc/read", { id });
}
export interface YouTubeSummary {
  channel: { title?: string; subscribers: number | null; views: number; videos: number; before?: { subscribers: number | null; day: string } | null } | null;
  videos: { title: string; url: string; published: string | null; views?: number; likes?: number; comments?: number }[];
}
export async function youtubeStats(): Promise<YouTubeSummary> {
  return call("/nova-agent/google/youtube/stats", {});
}
