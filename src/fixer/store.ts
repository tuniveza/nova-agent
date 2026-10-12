// The Fixer's notebook: data/fixer.json.
//
// What it keeps: its settings, the issues the hourly check found (one per fingerprint), the
// admins' fixer quests, which suggested quests were adopted or dismissed, every job (a prepared
// fix, its approval card, and what happened to it), a short activity list, and today's count of
// prepared fixes (for the daily cap).
//
// Like quests.json, a damaged file is never read as empty and then saved over: it's put aside,
// the last good copy (fixer.json.bak) is used, and that's said in the activity list. Anything
// missing or odd in an older file is filled in with the defaults (normaliseFixer), so a file
// from an earlier version always loads.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const QUEST_KINDS = ["bug", "glitch", "change"] as const;
export type QuestKind = (typeof QUEST_KINDS)[number];
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Severity = "serious" | "minor";
export type Area = "tests" | "typecheck" | "sweep" | "health" | "audio";

export interface Issue {
  id: string;
  fingerprint: string; // the same problem always has the same fingerprint (numbers taken out)
  area: Area;
  severity: Severity;
  title: string;
  detail: string;
  panel: string; // "/notes/" for a sweep problem, "" otherwise
  firstSeen: string;
  lastSeen: string;
  seenCount: number;
  notified: boolean; // admins were told about it (once, ever)
  jobId: string; // the fix being prepared or prepared for it ("" = none)
  blip: boolean; // Nova Bot or the link not answering (rules.ts isBlip): never gets a fix prepared
}

export interface FixerQuest {
  id: string;
  title: string;
  details: string;
  kind: QuestKind;
  priority: Priority;
  from: string; // "" = an admin wrote it; "quest:<id>" = adopted from Quests
  status: "open" | "working" | "done" | "closed";
  jobId: string;
  by: string;
  created: string;
  updated: string;
}

export interface Settings {
  hourlyChecks: boolean;
  autoPrepare: boolean; // prepare fixes for new issues by itself (they still wait for Approve)
  dailyCap: number; // prepared fixes a day
  timeLimitMinutes: number; // for one preparation
}
export const DEFAULT_SETTINGS: Settings = { hourlyChecks: true, autoPrepare: true, dailyCap: 10, timeLimitMinutes: 30 };

export type JobStatus =
  | "queued" // waiting its turn (one at a time, and the daily cap)
  | "preparing" // Claude Code is working in the job's own worktree
  | "checking" // tests, typecheck, sweep and screenshots in the job's worktree
  | "ready" // Needs you: waiting for an admin's Approve, Reject or Ask for a tweak
  | "failed" // couldn't prepare a fix (said why)
  | "approved" // an admin tapped Approve
  | "landing" // merging, deploying
  | "restarting" // Nova Agent restarts with the change (the job carries on after)
  | "verifying" // the post-deploy check
  | "done" // live
  | "blocked" // approved, but it couldn't be merged (main moved on, unsaved files): nothing changed
  | "rolling-back" // undoing it (it made things worse, or an admin tapped Undo)
  | "rolled-back" // undone by itself because things got worse
  | "undone" // undone by an admin
  | "rejected"
  | "closed"; // its problem went away by itself (fixed another way, or only a blip): nothing to do

export const OPEN_STATUSES: JobStatus[] = ["queued", "preparing", "checking"];

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
export interface FileChange {
  repo: "na" | "nb";
  path: string;
  added: number;
  removed: number;
}
export interface Screen {
  name: string; // "Notes"
  path: string; // "/notes/"
  width: number;
  before: string; // file name under the job's shots folder ("" = none)
  after: string;
}
export interface Card {
  summary: string;
  why: string;
  files: FileChange[];
  diff: string;
  screens: Screen[];
  consequences: string;
  assessment: string;
  risks: string[];
  recommendation: { verdict: "approve" | "reject" | "tweak"; reasons: string[] };
  trivial: boolean;
  checks: Check[];
  allPassed: boolean;
  offLimits: string[]; // things it touched that it mustn't (a card with these is never offered)
}

export interface Landing {
  before: string; // main's commit before the merge
  after: string; // main's commit after it
}
export interface Job {
  id: string;
  target: { type: "issue" | "quest"; id: string; title: string; details: string; kind: QuestKind };
  status: JobStatus;
  notes: string[]; // admins' tweak notes, oldest first
  attempt: number;
  branch: string;
  worktrees: { na: string; nb: string };
  card: Card | null;
  error: string;
  approval: { by: string; via: string; at: string } | null;
  landed: { na: Landing | null; nb: Landing | null };
  deployed: string; // when it went live ("" = not deployed)
  restartPending: boolean;
  preCheck: string[] | null; // serious problems' fingerprints just before it went live
  rollback: { at: string; reason: string; by: string } | null;
  notified: boolean; // admins were pinged that it's ready (once)
  created: string;
  updated: string;
  startedAt: string;
  finishedAt: string;
}

export interface Activity {
  at: string;
  text: string;
  kind: "check" | "issue" | "job" | "approve" | "deploy" | "rollback" | "quest" | "settings" | "note";
}

export interface FixerData {
  version: 1;
  settings: Settings;
  issues: Issue[];
  quests: FixerQuest[];
  adopted: string[]; // Quests ids turned into fixer quests
  dismissed: string[]; // Quests ids an admin said aren't Nova Agent work
  jobs: Job[];
  activity: Activity[];
  day: { date: string; prepared: number };
  lastCheck: { at: string; took: number; serious: number; minor: number } | null;
  lastAudio: string; // the UK date the audio levels were last measured
  restarts: number; // the service's restart count last seen (systemd's NRestarts)
}

const MAX_ACTIVITY = 300;
const MAX_JOBS = 200;

const text = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => ((list as readonly string[]).includes(v as string) ? (v as T) : fallback);
const strings = (v: unknown, max = 500) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, max)) : []);

export function cleanSettings(s: any): Settings {
  return {
    hourlyChecks: bool(s?.hourlyChecks, DEFAULT_SETTINGS.hourlyChecks),
    autoPrepare: bool(s?.autoPrepare, DEFAULT_SETTINGS.autoPrepare),
    dailyCap: num(s?.dailyCap, DEFAULT_SETTINGS.dailyCap, 0, 50),
    timeLimitMinutes: num(s?.timeLimitMinutes, DEFAULT_SETTINGS.timeLimitMinutes, 5, 120),
  };
}

function cleanIssue(i: any): Issue | null {
  const fingerprint = text(i?.fingerprint, 400);
  if (!fingerprint) return null;
  return {
    id: text(i?.id, 64) || randomUUID(),
    fingerprint,
    area: oneOf(i?.area, ["tests", "typecheck", "sweep", "health", "audio"] as const, "health"),
    severity: oneOf(i?.severity, ["serious", "minor"] as const, "minor"),
    title: text(i?.title, 300) || "A problem",
    detail: text(i?.detail, 4000),
    panel: text(i?.panel, 100),
    firstSeen: text(i?.firstSeen, 40),
    lastSeen: text(i?.lastSeen, 40),
    seenCount: num(i?.seenCount, 1, 1, 1e9),
    notified: bool(i?.notified, false),
    jobId: text(i?.jobId, 64),
    blip: bool(i?.blip, false),
  };
}

export function cleanQuest(q: any): FixerQuest | null {
  const title = text(q?.title, 200).trim();
  if (!title) return null;
  return {
    id: text(q?.id, 64) || randomUUID(),
    title,
    details: text(q?.details, 4000),
    kind: oneOf(q?.kind, QUEST_KINDS, "change"),
    priority: oneOf(q?.priority, PRIORITIES, "normal"),
    from: text(q?.from, 100),
    status: oneOf(q?.status, ["open", "working", "done", "closed"] as const, "open"),
    jobId: text(q?.jobId, 64),
    by: text(q?.by, 100),
    created: text(q?.created, 40),
    updated: text(q?.updated, 40),
  };
}

const STATUSES: JobStatus[] = ["queued", "preparing", "checking", "ready", "failed", "approved", "landing", "restarting", "verifying", "done", "blocked", "rolling-back", "rolled-back", "undone", "rejected", "closed"];

function cleanLanding(l: any): Landing | null {
  return l && typeof l.before === "string" && typeof l.after === "string" ? { before: l.before.slice(0, 64), after: l.after.slice(0, 64) } : null;
}
function cleanCard(c: any): Card | null {
  if (!c || typeof c !== "object") return null;
  return {
    summary: text(c.summary),
    why: text(c.why),
    files: (Array.isArray(c.files) ? c.files : []).map((f: any) => ({ repo: f?.repo === "nb" ? "nb" : "na", path: text(f?.path, 400), added: num(f?.added, 0, 0, 1e7), removed: num(f?.removed, 0, 0, 1e7) })),
    diff: text(c.diff, 200_000),
    screens: (Array.isArray(c.screens) ? c.screens : []).map((s: any) => ({ name: text(s?.name, 60), path: text(s?.path, 100), width: num(s?.width, 390, 200, 4000), before: text(s?.before, 200), after: text(s?.after, 200) })),
    consequences: text(c.consequences),
    assessment: text(c.assessment),
    risks: strings(c.risks),
    recommendation: { verdict: oneOf(c.recommendation?.verdict, ["approve", "reject", "tweak"] as const, "tweak"), reasons: strings(c.recommendation?.reasons) },
    trivial: bool(c.trivial, false),
    checks: (Array.isArray(c.checks) ? c.checks : []).map((k: any) => ({ name: text(k?.name, 100), ok: k?.ok === true, detail: text(k?.detail, 4000) })),
    allPassed: c.allPassed === true,
    offLimits: strings(c.offLimits),
  };
}

export function cleanJob(j: any): Job | null {
  const id = text(j?.id, 64);
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const t = j?.target || {};
  return {
    id,
    target: { type: t.type === "quest" ? "quest" : "issue", id: text(t.id, 64), title: text(t.title, 300), details: text(t.details, 8000), kind: oneOf(t.kind, QUEST_KINDS, "bug") },
    status: oneOf(j?.status, STATUSES, "failed"),
    notes: strings(j?.notes, 2000),
    attempt: num(j?.attempt, 1, 1, 100),
    branch: text(j?.branch, 200),
    worktrees: { na: text(j?.worktrees?.na, 400), nb: text(j?.worktrees?.nb, 400) },
    card: cleanCard(j?.card),
    error: text(j?.error, 4000),
    approval: j?.approval && typeof j.approval.by === "string" ? { by: text(j.approval.by, 100), via: text(j.approval.via, 20), at: text(j.approval.at, 40) } : null,
    landed: { na: cleanLanding(j?.landed?.na), nb: cleanLanding(j?.landed?.nb) },
    deployed: text(j?.deployed, 40),
    restartPending: bool(j?.restartPending, false),
    preCheck: Array.isArray(j?.preCheck) ? strings(j.preCheck, 400) : null,
    rollback: j?.rollback && typeof j.rollback.at === "string" ? { at: text(j.rollback.at, 40), reason: text(j.rollback.reason, 2000), by: text(j.rollback.by, 100) } : null,
    notified: bool(j?.notified, false),
    created: text(j?.created, 40),
    updated: text(j?.updated, 40),
    startedAt: text(j?.startedAt, 40),
    finishedAt: text(j?.finishedAt, 40),
  };
}

export function normaliseFixer(raw: any): FixerData {
  return {
    version: 1,
    settings: cleanSettings(raw?.settings),
    issues: (Array.isArray(raw?.issues) ? raw.issues : []).map(cleanIssue).filter(Boolean) as Issue[],
    quests: (Array.isArray(raw?.quests) ? raw.quests : []).map(cleanQuest).filter(Boolean) as FixerQuest[],
    adopted: strings(raw?.adopted, 64),
    dismissed: strings(raw?.dismissed, 64),
    jobs: (Array.isArray(raw?.jobs) ? raw.jobs : []).map(cleanJob).filter(Boolean).slice(-MAX_JOBS) as Job[],
    activity: (Array.isArray(raw?.activity) ? raw.activity : [])
      .filter((a: any) => a && typeof a.text === "string")
      .map((a: any) => ({ at: text(a.at, 40), text: text(a.text, 1000), kind: oneOf(a.kind, ["check", "issue", "job", "approve", "deploy", "rollback", "quest", "settings", "note"] as const, "note") }))
      .slice(-MAX_ACTIVITY),
    day: { date: text(raw?.day?.date, 10), prepared: num(raw?.day?.prepared, 0, 0, 1000) },
    lastCheck: raw?.lastCheck && typeof raw.lastCheck.at === "string" ? { at: text(raw.lastCheck.at, 40), took: num(raw.lastCheck.took, 0, 0, 1e9), serious: num(raw.lastCheck.serious, 0, 0, 1e6), minor: num(raw.lastCheck.minor, 0, 0, 1e6) } : null,
    lastAudio: text(raw?.lastAudio, 10),
    restarts: num(raw?.restarts, 0, 0, 1e9),
  };
}

// One file, read and written whole (small: a few hundred kB at most)
export class FixerStore {
  constructor(readonly file: string) {}

  read(): FixerData {
    const file = this.file;
    if (!existsSync(file)) return normaliseFixer({});
    try {
      return normaliseFixer(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      const aside = `${file}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      renameSync(file, aside);
      let good: FixerData;
      try {
        good = normaliseFixer(JSON.parse(readFileSync(`${file}.bak`, "utf8")));
      } catch {
        good = normaliseFixer({});
      }
      good.activity.push({ at: new Date().toISOString(), text: `fixer.json was damaged (${(error as Error).message}); went back to the last good copy. The damaged one is kept as ${aside}.`, kind: "note" });
      this.write(good);
      return good;
    }
  }

  write(data: FixerData): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const clean = normaliseFixer(data);
    const json = JSON.stringify(clean, null, 2);
    writeFileSync(`${this.file}.tmp`, json);
    renameSync(`${this.file}.tmp`, this.file);
    writeFileSync(`${this.file}.bak.tmp`, json);
    renameSync(`${this.file}.bak.tmp`, `${this.file}.bak`);
  }

  // Read, change, write: the one way anything changes
  update<T>(fn: (data: FixerData) => T): T {
    const data = this.read();
    const out = fn(data);
    this.write(data);
    return out;
  }
}

export function addActivity(data: FixerData, at: Date, kind: Activity["kind"], line: string): void {
  data.activity.push({ at: at.toISOString(), text: line.slice(0, 1000), kind });
  if (data.activity.length > MAX_ACTIVITY) data.activity.splice(0, data.activity.length - MAX_ACTIVITY);
}
