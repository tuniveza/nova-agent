// The agent's flight recorder.
//
// Every step reports what it's doing by calling trace(). Each event is:
//   - printed to the console,
//   - appended to a daily log file in data/logs/,
//   - sent live to anyone listening (the visualizer).
//
// Never put passwords or cookies in an event. Say "(hidden)" instead.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { Locator, Page } from "playwright";
import { config } from "./config";

// Which part of Nova Agent's "anatomy" is speaking. The visualizer lights up
// the matching box in its diagram.
export type Part = "input" | "task" | "resolve" | "cache" | "llm" | "browser";

// How the step went, which sets the colour in the visualizer.
export type Level = "start" | "info" | "ok" | "warn" | "error";

export interface TraceEvent {
  id: number;
  time: string;
  part: Part;
  level: Level;
  message: string;
  data?: unknown; // extra detail, e.g. the exact question sent to the AI
  image?: string; // screenshot as a data: URL (only kept in memory, not in log files)
}

type Listener = (event: TraceEvent) => void;

const listeners = new Set<Listener>();
const recentEvents: TraceEvent[] = [];
const MAX_RECENT = 400;
let nextId = 1;

export function trace(part: Part, level: Level, message: string, data?: unknown): TraceEvent {
  return record({ part, level, message, data });
}

// Take a small screenshot and add it to the trace, so the visualizer can show
// what the browser is looking at. If `highlight` is given, that element gets
// a red outline in the picture (the outline is removed straight after).
export async function traceScreenshot(page: Page, message: string, highlight?: Locator) {
  try {
    if (highlight) await setOutline(highlight, "3px solid #e5484d");
    const jpeg = await page.screenshot({ type: "jpeg", quality: 55 });
    if (highlight) await setOutline(highlight, "");
    record({
      part: "browser",
      level: "info",
      message,
      image: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    });
  } catch {
    // A missing screenshot should never break a real task.
  }
}

// Save a full-size screenshot to data/screenshots/ (used when something fails).
export async function saveFailureScreenshot(page: Page, label: string): Promise<string | undefined> {
  try {
    mkdirSync(config.paths.screenshots, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9._-]+/gi, "_");
    const file = `${config.paths.screenshots}${timestampForFiles()}_${safeLabel}.png`;
    writeFileSync(file, await page.screenshot({ fullPage: true }));
    return file;
  } catch {
    return undefined;
  }
}

export function onTrace(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentEvents(): TraceEvent[] {
  return [...recentEvents];
}

// --- internals ---

function record(fields: Omit<TraceEvent, "id" | "time">): TraceEvent {
  const event: TraceEvent = { id: nextId++, time: new Date().toISOString(), ...fields };

  recentEvents.push(event);
  if (recentEvents.length > MAX_RECENT) recentEvents.shift();

  printToConsole(event);
  appendToLogFile(event);
  for (const listener of listeners) listener(event);

  return event;
}

function printToConsole(event: TraceEvent) {
  if (event.image) return; // screenshots are for the visualizer only
  const marks: Record<Level, string> = { start: "▶", info: "·", ok: "✓", warn: "!", error: "✗" };
  console.log(`${marks[event.level]} [${event.part}] ${event.message}`);
}

function appendToLogFile(event: TraceEvent) {
  if (event.image) return; // keep log files small
  try {
    const logDir = `${config.paths.dataDir}logs/`;
    mkdirSync(logDir, { recursive: true });
    const day = event.time.slice(0, 10);
    appendFileSync(`${logDir}${day}.jsonl`, JSON.stringify(event) + "\n");
  } catch {
    // Logging must never crash the agent.
  }
}

async function setOutline(locator: Locator, outline: string) {
  await locator.evaluate((element, value) => {
    (element as HTMLElement).style.outline = value;
  }, outline);
}

function timestampForFiles(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
