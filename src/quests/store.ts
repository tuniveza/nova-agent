// Nova Missions and Nova Quests: what they are, and where they're kept.
//
//   Nova Mission  an end goal ("Release the EP by 1 December"), turned into quests
//   Nova Quest    one actionable task: how long it takes (anything from a second
//                 up; long ones are split into sessions, and an ongoing quest
//                 never ends: it gets a session every day, weekday or week),
//                 how much it matters, when it's due, what it waits for, where
//   Block         time that's taken ("out tonight 7-11", "off sick today")
//   Rhythm        how the days work: wake, sleep, wind-down, buffers, breaks,
//                 reminders
//
// Everything lives in data/quests.json. Times are local UK wall-clock times,
// written like the calendar's: "2026-10-09T14:00" (with seconds when a quest
// needs them: "2026-10-09T14:00:30").

import { EventEmitter } from "node:events";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { config } from "../config";

export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const TIMES_OF_DAY = ["any", "morning", "afternoon", "evening"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export type QuestStatus = "todo" | "doing" | "done" | "skipped";
export const EVERY = ["day", "weekday", "week", "interval"] as const; // interval: every `everyMinutes`
export type Every = (typeof EVERY)[number];

// The shortest quest is a second; the longest single session the planner places
export const MIN_MINUTES = 1 / 60;
export const MAX_SESSION_MINUTES = 180;

export interface Mission {
  id: string;
  title: string;
  request: string; // what the person asked for, in their words
  summary: string;
  deadline: string; // "2026-12-01" or "2026-12-01T18:00", or ""
  status: "active" | "paused" | "done";
  created: string;
  updated: string;
}

export interface Quest {
  id: string;
  missionId: string; // "" for a quest on its own
  title: string;
  notes: string;
  minutes: number; // how long the work takes (can be a fraction: 0.5 = 30 seconds); for an ongoing quest, each session
  ongoing: boolean; // never finishes: a session every `every` until it's ended
  every: Every;
  everyMinutes: number; // for every = "interval": the gap from one session's start to the next (a second up)
  sessions: number; // sessions done so far (ongoing quests)
  // An ongoing quest with a deadline stops by itself then ("every 30 minutes until 23:00")
  priority: Priority;
  deadline: string; // must be finished by ("" = none)
  earliest: string; // not before ("" = any time)
  dependsOn: string[]; // quest ids that must be done first
  location: string; // where it happens ("" = wherever you are)
  travelMinutes: number; // getting there
  timeOfDay: TimeOfDay; // when it suits best
  fixedStart: string; // pinned to this time ("" = the planner chooses)
  status: QuestStatus;
  // Set by the planner
  start: string;
  end: string;
  travelStart: string;
  atRisk: boolean; // can't be fitted in before its deadline
  // Reminders and history
  remindedFor: string; // the start time a reminder was sent for
  checkedFor: string; // the end time a check-in was sent for
  missed: number;
  completed: string;
  created: string;
  updated: string;
}

export interface Block {
  id: string;
  start: string;
  end: string;
  reason: string;
}

export interface Rhythm {
  wake: string; // "07:30"
  sleep: string; // "23:30" (after midnight is fine: "00:30")
  windDownMinutes: number; // no quests this long before sleep
  startUpMinutes: number; // or this long after waking
  bufferMinutes: number; // between quests
  breakAfterMinutes: number; // a longer break after work this long
  breakMinutes: number;
  maxQuestHoursPerDay: number;
  horizonDays: number; // how far ahead to plan
  homeBase: string; // where travel is worked out from
  remindMinutesBefore: number;
  checkIns: boolean; // ask "did you finish it?" when a quest should be done
  dailyBriefing: boolean; // the morning plan and the evening wrap-up
  phonePush: boolean; // also send reminders to the Nova Hub phones
  // The safety switch for pace: on, quests start a few minutes from now, on
  // 5-minute marks, with buffers and breaks between them; off, they can start
  // right now, to the second, back to back
  paceLimits: boolean;
}

export interface QuestData {
  version: 1;
  rhythm: Rhythm;
  missions: Mission[];
  quests: Quest[];
  blocks: Block[];
  lastBriefing: string; // the date the morning plan was last sent
  lastWrapUp: string;
}

export const DEFAULT_RHYTHM: Rhythm = {
  wake: "07:30",
  sleep: "23:30",
  windDownMinutes: 45,
  startUpMinutes: 45,
  bufferMinutes: 10,
  breakAfterMinutes: 90,
  breakMinutes: 20,
  maxQuestHoursPerDay: 8,
  horizonDays: 21,
  homeBase: "Novacane Studios, Forest Hill, London",
  remindMinutesBefore: 10,
  checkIns: true,
  dailyBriefing: true,
  phonePush: true,
  paceLimits: true,
};

const file = `${config.paths.dataDir}quests.json`;
const now = () => new Date().toISOString();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const isStamp = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isHm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
// A length in minutes, kept to the nearest second (a second up to about two years)
const length = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(1_000_000, Math.max(MIN_MINUTES, Math.round(n * 60) / 60)) : fallback;
};
const stampOrEmpty = (v: unknown) => (isStamp(v) ? v : isDay(v) ? `${v}T23:59` : "");

// Tells the open Nova Agent page that the plan changed
export const questEvents = new EventEmitter();

function cleanRhythm(r: any): Rhythm {
  const d = DEFAULT_RHYTHM;
  return {
    wake: isHm(r?.wake) ? r.wake : d.wake,
    sleep: isHm(r?.sleep) ? r.sleep : d.sleep,
    windDownMinutes: num(r?.windDownMinutes, 0, 240, d.windDownMinutes),
    startUpMinutes: num(r?.startUpMinutes, 0, 240, d.startUpMinutes),
    bufferMinutes: num(r?.bufferMinutes, 0, 60, d.bufferMinutes),
    breakAfterMinutes: num(r?.breakAfterMinutes, 30, 480, d.breakAfterMinutes),
    breakMinutes: num(r?.breakMinutes, 0, 120, d.breakMinutes),
    maxQuestHoursPerDay: num(r?.maxQuestHoursPerDay, 1, 18, d.maxQuestHoursPerDay),
    horizonDays: num(r?.horizonDays, 3, 90, d.horizonDays),
    homeBase: text(r?.homeBase, 160) || d.homeBase,
    remindMinutesBefore: num(r?.remindMinutesBefore, 0, 120, d.remindMinutesBefore),
    checkIns: typeof r?.checkIns === "boolean" ? r.checkIns : d.checkIns,
    dailyBriefing: typeof r?.dailyBriefing === "boolean" ? r.dailyBriefing : d.dailyBriefing,
    phonePush: typeof r?.phonePush === "boolean" ? r.phonePush : d.phonePush,
    paceLimits: typeof r?.paceLimits === "boolean" ? r.paceLimits : d.paceLimits,
  };
}

export function cleanQuest(q: any): Quest {
  return {
    id: text(q?.id, 64) || randomUUID(),
    missionId: text(q?.missionId, 64),
    title: text(q?.title, 140) || "Untitled quest",
    notes: text(q?.notes, 2000),
    minutes: length(q?.minutes, 60),
    ongoing: q?.ongoing === true,
    every: (EVERY as readonly string[]).includes(q?.every) ? q.every : "day",
    everyMinutes: length(q?.everyMinutes, 60),
    sessions: num(q?.sessions, 0, 1_000_000, 0),
    priority: (PRIORITIES as readonly string[]).includes(q?.priority) ? q.priority : "normal",
    deadline: stampOrEmpty(q?.deadline),
    earliest: isStamp(q?.earliest) ? q.earliest : isDay(q?.earliest) ? `${q.earliest}T00:00` : "",
    dependsOn: Array.isArray(q?.dependsOn) ? q.dependsOn.map((x: unknown) => text(x, 64)).filter(Boolean).slice(0, 20) : [],
    location: text(q?.location, 160),
    travelMinutes: num(q?.travelMinutes, 0, 300, 0),
    timeOfDay: (TIMES_OF_DAY as readonly string[]).includes(q?.timeOfDay) ? q.timeOfDay : "any",
    fixedStart: isStamp(q?.fixedStart) ? q.fixedStart : "",
    status: ["todo", "doing", "done", "skipped"].includes(q?.status) ? q.status : "todo",
    start: isStamp(q?.start) ? q.start : "",
    end: isStamp(q?.end) ? q.end : "",
    travelStart: isStamp(q?.travelStart) ? q.travelStart : "",
    atRisk: q?.atRisk === true,
    remindedFor: text(q?.remindedFor, 20),
    checkedFor: text(q?.checkedFor, 20),
    missed: num(q?.missed, 0, 999, 0),
    completed: text(q?.completed, 40),
    created: text(q?.created, 40) || now(),
    updated: text(q?.updated, 40) || now(),
  };
}

export function cleanMission(m: any): Mission {
  return {
    id: text(m?.id, 64) || randomUUID(),
    title: text(m?.title, 140) || "Untitled mission",
    request: text(m?.request, 4000),
    summary: text(m?.summary, 2000),
    deadline: isStamp(m?.deadline) || isDay(m?.deadline) ? m.deadline : "",
    status: ["active", "paused", "done"].includes(m?.status) ? m.status : "active",
    created: text(m?.created, 40) || now(),
    updated: text(m?.updated, 40) || now(),
  };
}

function cleanBlock(b: any): Block | null {
  if (!isStamp(b?.start) || !isStamp(b?.end) || b.end <= b.start) return null;
  return { id: text(b?.id, 64) || randomUUID(), start: b.start, end: b.end, reason: text(b?.reason, 200) || "Busy" };
}

export function normaliseQuests(raw: any): QuestData {
  return {
    version: 1,
    rhythm: cleanRhythm(raw?.rhythm),
    missions: (Array.isArray(raw?.missions) ? raw.missions : []).map(cleanMission),
    quests: (Array.isArray(raw?.quests) ? raw.quests : []).map(cleanQuest),
    blocks: (Array.isArray(raw?.blocks) ? raw.blocks : []).map(cleanBlock).filter(Boolean) as Block[],
    lastBriefing: text(raw?.lastBriefing, 20),
    lastWrapUp: text(raw?.lastWrapUp, 20),
  };
}

export function readQuests(): QuestData {
  if (!existsSync(file)) return normaliseQuests({});
  try {
    return normaliseQuests(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return normaliseQuests({});
  }
}

export function writeQuests(data: QuestData): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(normaliseQuests(data), null, 2));
  renameSync(`${file}.tmp`, file);
  questEvents.emit("changed");
}
