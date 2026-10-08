// Types for recur.js (Nova Agent's TypeScript imports it from here)
export type Repeat = { freq: "daily" | "weekly" | "monthly" | "yearly"; interval?: number; byDay?: number[]; until?: string; count?: number };
export type Repeating = { start: string; end?: string; allDay?: boolean; repeat?: Repeat | null; exdates?: string[] };
export type Occurrence = { start: string; end: string; date: string };
export const FREQS: string[];
export function dayNumber(date: string): number;
export function dateOf(dayNum: number): string;
export function addDays(date: string, n: number): string;
export function weekday(date: string): number;
export function minutesBetween(a: string, b: string): number;
export function addMinutes(stamp: string, minutes: number): string;
export function cleanRepeat(r: unknown): Repeat | null;
export function occurrences(ev: Repeating, from: string, to: string): Occurrence[];
export function endSeriesBefore<T extends Repeating>(ev: T, date: string): T;
export function describeRepeat(r: unknown): string;
