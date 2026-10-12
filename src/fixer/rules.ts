// The Fixer's judgement, as plain functions (no files, no commands), so each is easy to test:
//   - which files a prepared fix may never touch (offLimits)
//   - whether a change is "Trivial: safe to approve" (tiny CSS or on-screen wording only)
//   - whether things got worse after going live (shouldRollBack)
//   - the recommendation on the approval card
//   - which quests look like Nova Agent development work (suggestions)
//   - fingerprints, and merging a check's findings into the known issues

import { randomUUID } from "node:crypto";
import type { Card, Check, FileChange, Issue, QuestKind } from "./store";

// ---- Off limits ----
// Secrets and settings, database migrations, customer data, payments, emails, Acuity, Resend,
// Stripe, the deploy setup, dependencies, and the Fixer itself (it never changes its own rules).
const OFF_LIMIT_PATHS: [RegExp, string][] = [
  [/(^|\/)\.env(\.|$)|(^|\/)\.dev\.vars/i, "secrets (.env)"],
  [/(^|\/)(secrets?|credentials?)(\/|\.|$)/i, "secrets"],
  [/(^|\/)migrations\//i, "database migrations"],
  [/(^|\/)data\//i, "saved data"],
  [/(^|\/)node_modules(\/|$)/i, "node_modules"],
  [/(^|\/)\.git(\/|$)/i, "git's own files"],
  [/(^|\/)(package(-lock)?\.json|wrangler\.jsonc?|tsconfig\.json|vitest\.config\.\w+)$/i, "the build and deploy setup"],
  [/(^|\/)deploy\//i, "the service setup"],
  [/stripe|payment|(^|[/_-])pay([/_.-]|$)|refund|invoice/i, "payments"],
  [/e-?mails?|resend|mailerlite|campaign/i, "emails"],
  [/acuity/i, "Acuity"],
  [/(^|\/)(clients|enquir|booking|referral|fans|feedback|manage-bookings|book-session)/i, "customer data"],
  [/(^|\/)src\/fixer\/|(^|\/)test\/fixer|(^|\/)web\/fixer\//i, "the Fixer itself"],
];

export function offLimits(files: { repo: string; path: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const hit = OFF_LIMIT_PATHS.find(([re]) => re.test(f.path));
    if (hit) out.push(`${f.repo === "nb" ? "Nova Bot" : "Nova Agent"}: ${f.path} (${hit[1]})`);
  }
  return out;
}

// Added lines that mention these get a clear warning on the card (and a "reject" recommendation)
const SENSITIVE_WORDS = /\b(stripe|acuity|resend|mailerlite|payment|refund|password|api[_-]?key|secret|token|AGENT_NOVA_KEY|ANTHROPIC_API_KEY)\b/i;
export function sensitiveLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++") && SENSITIVE_WORDS.test(l))
    .map((l) => l.slice(1).trim().slice(0, 160))
    .slice(0, 5);
}

// ---- Trivial: tiny CSS or on-screen wording only ----
const TRIVIAL_MAX_LINES = 24;
// A line with its words taken out (the skeleton) and the words themselves. In a page (.html): the
// text between tags, and the attributes people read (title, aria-label, placeholder, alt…); in a
// script: what's in quotes. Anything else that changed (a class, a condition, a number) isn't wording.
const READ_ATTRS = /(\b(?:title|aria-label|placeholder|alt|value|content|label|data-tip)=)(["'])(.*?)\2/g;
function wordsOf(file: string, line: string): { skeleton: string; words: string[] } {
  const words: string[] = [];
  let sk = line;
  if (/\.html$/.test(file)) {
    if (!/[<>]/.test(sk) && !/[;(){}=]/.test(sk)) return { skeleton: "", words: [sk.trim()] };
    sk = sk
      .replace(READ_ATTRS, (_m, p: string, q: string, w: string) => (words.push(w), p + q + q))
      .replace(/>([^<>]*)</g, (_m, w: string) => (words.push(w), "><"))
      .replace(/^([^<>]*)</, (_m, w: string) => (words.push(w), "<"))
      .replace(/>([^<>]*)$/, (_m, w: string) => (words.push(w), ">"));
  } else {
    sk = sk.replace(/(["'`])((?:\\.|(?!\1).)*)\1/g, (_m, q: string, w: string) => (words.push(w), q + q));
  }
  return { skeleton: sk.trim(), words };
}
// Words people read: letters, and either a space or a capital first letter; no code characters
const prose = (w: string) => !/[<>{}$=;\\]/.test(w) && /[A-Za-z]/.test(w) && (/\s/.test(w.trim()) || /^[A-Z]/.test(w.trim()));
function wordingOnly(file: string, before: string, after: string): boolean {
  const a = wordsOf(file, before);
  const b = wordsOf(file, after);
  if (a.skeleton !== b.skeleton || a.words.length !== b.words.length) return false;
  for (let i = 0; i < a.words.length; i++) {
    if (a.words[i] === b.words[i]) continue;
    // In a script, only sentences people read count as wording (not keys, classes or addresses)
    if (!/\.html$/.test(file) && !(prose(a.words[i]) && prose(b.words[i]))) return false;
  }
  return true;
}

// Each file's changed lines, from a unified diff: { file, removed: [...], added: [...] } per hunk
function hunks(diff: string): { file: string; removed: string[]; added: string[] }[] {
  const out: { file: string; removed: string[]; added: string[] }[] = [];
  let file = "";
  let cur: { file: string; removed: string[]; added: string[] } | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      cur = null;
      file = (/ b\/(.+)$/.exec(line) || [])[1] || "";
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ") || /^(new|deleted) file mode|^similarity|^rename /.test(line)) continue;
    if (line.startsWith("@@")) {
      cur = { file, removed: [], added: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("-")) cur.removed.push(line.slice(1));
    else if (line.startsWith("+")) cur.added.push(line.slice(1));
  }
  return out;
}

export function isTrivial(files: FileChange[], diff: string): boolean {
  if (!files.length) return false;
  const lines = files.reduce((n, f) => n + f.added + f.removed, 0);
  if (lines > TRIVIAL_MAX_LINES) return false;
  // Only page files (no server code, no tests needed)
  if (files.some((f) => !/^web\//.test(f.path) && !(f.repo === "nb" && /^public\//.test(f.path)))) return false;
  if (files.some((f) => !/\.(css|html|js|mjs)$/.test(f.path))) return false;
  for (const h of hunks(diff)) {
    if (/\.css$/.test(h.file)) continue; // any small CSS change is trivial
    // Wording only: the same lines with only the words in quotes or between tags changed
    if (h.removed.length !== h.added.length || !h.removed.length) return false;
    for (let i = 0; i < h.removed.length; i++) if (!wordingOnly(h.file, h.removed[i], h.added[i])) return false;
  }
  return true;
}

// ---- Did going live make things worse? ----
// before/after: the serious problems' fingerprints (from the quick check). Worse means a serious
// problem that wasn't there before, or Nova Agent or Nova Bot not answering at all.
export const DOWN = ["health:pc-server", "health:nova-bot"];
export function shouldRollBack(before: string[] | null, after: string[]): { rollBack: boolean; reason: string } {
  const was = new Set(before || []);
  const fresh = after.filter((f) => !was.has(f));
  const down = fresh.filter((f) => DOWN.some((d) => f.startsWith(d)));
  if (down.length) return { rollBack: true, reason: `${down.map((d) => (d.startsWith("health:pc-server") ? "Nova Agent on the PC" : "Nova Bot")).join(" and ")} stopped answering` };
  if (fresh.length) return { rollBack: true, reason: `${fresh.length} new serious problem${fresh.length === 1 ? "" : "s"} after it went live (${fresh.slice(0, 3).join("; ")})` };
  return { rollBack: false, reason: "" };
}

// ---- The recommendation on the card ----
export function recommend(input: { checks: Check[]; trivial: boolean; sensitive: string[]; claudeVerdict?: string; claudeReasons?: string[]; risks: string[] }): Card["recommendation"] {
  const failed = input.checks.filter((c) => !c.ok);
  if (input.sensitive.length) return { verdict: "reject", reasons: ["It adds lines about payments, emails, Acuity or secrets, which the Fixer must never touch.", ...input.sensitive.map((s) => `“${s}”`)] };
  if (failed.length) return { verdict: "tweak", reasons: failed.map((c) => `${c.name} didn't pass${c.detail ? `: ${c.detail.split("\n")[0].slice(0, 160)}` : ""}`).concat("Ask for a tweak to have it fixed, or reject it.") };
  const verdict = input.claudeVerdict === "reject" || input.claudeVerdict === "tweak" ? input.claudeVerdict : "approve";
  const reasons = [...(input.claudeReasons || []).filter(Boolean).slice(0, 4)];
  if (verdict === "approve") reasons.unshift(input.trivial ? "A tiny change to looks or wording, and every check passed." : "Every check passed.");
  return { verdict, reasons };
}

// ---- Suggestions: quests that look like Nova Agent development work ----
const APP_WORDS = /\b(nova\s*agent|nova\s*bot|novabot|fixer|portal|observatory|visuali[sz]er|lossless|the manual|panels?|the app|apps?)\b/i;
const PANEL_NAMES = /\b(calendar|notes|index|quests|missions|admin)\b/i;
const DEV_WORDS = /\b(bugs?|glitch(es|y)?|crash(es|ing)?|broken|breaks?|error|errors|fix(es|ing)?|button|buttons|tab|tabs|toolbar|screen|page|layout|overflow|scroll(s|ing|bar)?|sideways|off-?screen|css|theme|themes|dark mode|font|icon|icons|ui|ux|feature|deploy|worker|relay|api|endpoint|typecheck|tests?|redesign|dropdown|menu|modal|dialog|slider|sound effects?|sfx|animation|loads?|loading|sync(s|ing)?|notifications?|phone width|mobile)\b/i;
const NOT_DEV = /\b(mix|master|mastering|release|single|ep|album|gym|run|shop|buy|call mum|dentist|invoice|rent|groceries|laundry|kitchen|car)\b/i;

export function suggestionKind(text: string): QuestKind {
  if (/\b(glitch|flicker|overflow|sideways|off-?screen|misalign|overlap|jumps?|wobbl)/i.test(text)) return "glitch";
  if (/\b(bug|broken|crash|error|fails?|doesn'?t work|won'?t|not working|stuck)/i.test(text)) return "bug";
  return "change";
}

export function looksLikeDevWork(q: { title: string; notes?: string; from?: string }): boolean {
  const text = `${q.title}\n${q.notes || ""}`;
  const app = APP_WORDS.test(text);
  const panel = PANEL_NAMES.test(text);
  const dev = DEV_WORDS.test(text);
  if (!dev) return false;
  if (app) return true;
  // A panel's name is also an everyday word ("notes", "calendar"): it needs a clear UI or code word too,
  // and nothing that says it's music or life admin
  if (panel && !NOT_DEV.test(q.title)) return /\b(bug|glitch|crash|broken|button|tab|toolbar|layout|overflow|scroll|css|theme|icon|ui|ux|feature|dropdown|menu|modal|dialog|slider|phone width|mobile|loads?|loading|sync)/i.test(text);
  // No app or panel named: only clear code words count
  return /\b(css|ui|ux|typecheck|endpoint|deploy|relay|api)\b/i.test(text) && !NOT_DEV.test(q.title);
}

export interface Suggestion {
  questId: string;
  title: string;
  details: string;
  from: string;
  kind: QuestKind;
  priority: string;
}
export function suggestions(quests: { id: string; title: string; notes: string; from: string; status: string; priority: string }[], adopted: string[], dismissed: string[]): Suggestion[] {
  const skip = new Set([...adopted, ...dismissed]);
  return quests
    .filter((q) => q.status !== "done" && q.status !== "skipped" && !skip.has(q.id) && looksLikeDevWork(q))
    .map((q) => ({ questId: q.id, title: q.title, details: q.notes, from: q.from, kind: suggestionKind(`${q.title} ${q.notes}`), priority: q.priority }));
}

// ---- Fingerprints and issues ----
// The same problem gives the same fingerprint: numbers, ids and addresses' query strings taken out
export function fingerprint(...parts: string[]): string {
  return parts
    .map((p) =>
      String(p)
        .toLowerCase()
        .replace(/\?[^\s)'"]*/g, "")
        .replace(/[0-9a-f]{8,}/g, "#")
        .replace(/\d+(\.\d+)?/g, "#")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    )
    .join(":");
}

export interface Finding {
  fingerprint: string;
  area: Issue["area"];
  severity: Issue["severity"];
  title: string;
  detail: string;
  panel?: string;
  // A sweep problem: where it was seen ("Notes at 390px"), the problem without the place, every
  // panel it was seen on, and the fingerprints it had when each place was its own problem
  place?: string;
  problem?: string;
  panels?: string[];
  aliases?: string[];
  // Probably Nova Bot (or the link to it) answering slowly for a moment, not the code: a 502/503/504,
  // a dropped connection, "fetch failed". Checked again before it counts (see isBlip).
  blip?: boolean;
}

// ---- Nova Bot blips ----
// Nova Bot not answering, the online link down, or a file that failed because the server behind it
// didn't answer: seen once, it's checked again (a few tries over a couple of minutes) before it
// becomes a problem, and it never has a fix prepared (it's not something code changes fix).
export const BLIP_PRINTS = ["health:nova-bot", "health:relay"];
export function isBlip(f: Pick<Finding, "fingerprint" | "blip">): boolean {
  return f.blip === true || BLIP_PRINTS.includes(f.fingerprint);
}
// A status or a browser error that means "the server didn't answer", not "the file is missing"
export const blipStatus = (status: number) => status === 502 || status === 503 || status === 504;
export const blipError = (text: string) => /ERR_(CONNECTION_\w+|EMPTY_RESPONSE|TIMED_OUT|NETWORK_\w+|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED)|fetch failed|Failed to fetch|NetworkError|Load failed/i.test(text);

// ---- The same problem in several places: one problem ----
// A sweep finds a file that didn't load on Notes, Index and Observatory, at 390px and 1280px: that's
// one problem (one fingerprint, the place left out), so it gets one issue and one fix. Its title
// says where it was seen ("a file didn't load: /x.svg (404) · on Notes, Index and Observatory at 390px").
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
export function placesText(places: string[]): string {
  // "Notes at 390px", "Index at 390px", "Notes at 1280px" -> "Notes and Index at 390px; Notes at 1280px"
  const byWidth = new Map<string, string[]>();
  const other: string[] = [];
  for (const p of places) {
    const m = /^(.*) at (\d+px)$/.exec(p);
    if (!m) {
      other.push(p);
      continue;
    }
    const names = byWidth.get(m[2]) || [];
    if (!names.includes(m[1])) names.push(m[1]);
    byWidth.set(m[2], names);
  }
  return [...[...byWidth].map(([w, names]) => `${listOf(names)} at ${w}`), ...other].join("; ");
}
export function groupFindings(findings: Finding[]): Finding[] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const g = groups.get(f.fingerprint);
    if (g) g.push(f);
    else groups.set(f.fingerprint, [f]);
  }
  const out: Finding[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    const places = [...new Set(g.map((f) => f.place).filter((x): x is string => !!x))];
    if (g.length === 1 || !first.problem || places.length <= 1) {
      out.push(first);
      continue;
    }
    const panels = [...new Set(g.flatMap((f) => f.panels || (f.panel ? [f.panel] : [])))];
    out.push({
      ...first,
      title: `${first.problem} · on ${placesText(places)}`,
      detail: [`Seen on: ${placesText(places)}.`, ...new Set(g.map((f) => f.detail).filter(Boolean))].join("\n\n").slice(0, 4000),
      severity: g.some((f) => f.severity === "serious") ? "serious" : "minor",
      panel: panels[0] || first.panel,
      panels,
      aliases: [...new Set(g.flatMap((f) => f.aliases || []))],
      blip: g.every((f) => f.blip === true),
    });
  }
  return out;
}

// Merge a check's findings into the known issues. Each problem is kept once (by fingerprint) and
// cleared when it's gone; `areas` says which kinds of problem this check looked at (a quick check
// that only looked at health and the sweep doesn't clear test failures). Returns what's new.
export function mergeIssues(issues: Issue[], findings: Finding[], areas: Issue["area"][], now: Date): { issues: Issue[]; fresh: Issue[]; cleared: Issue[] } {
  const at = now.toISOString();
  const byPrint = new Map<string, Finding>();
  for (const f of findings) if (!byPrint.has(f.fingerprint)) byPrint.set(f.fingerprint, f);
  const kept: Issue[] = [];
  const cleared: Issue[] = [];
  // A problem that used to be one issue per place (an older fingerprint) carries on as the grouped
  // one: same id, same fix, already told about
  const byAlias = new Map<string, Finding>();
  for (const f of byPrint.values()) for (const a of f.aliases || []) if (!byAlias.has(a)) byAlias.set(a, f);
  for (const issue of issues) {
    const exact = byPrint.get(issue.fingerprint);
    const f = exact || (byAlias.has(issue.fingerprint) && byPrint.has(byAlias.get(issue.fingerprint)!.fingerprint) ? byAlias.get(issue.fingerprint) : undefined);
    if (f) {
      kept.push({ ...issue, fingerprint: f.fingerprint, lastSeen: at, seenCount: issue.seenCount + 1, detail: f.detail || issue.detail, severity: f.severity, title: f.title.slice(0, 300), panel: f.panel || issue.panel, blip: isBlip(f) });
      byPrint.delete(f.fingerprint);
    } else if (areas.includes(issue.area)) cleared.push(issue);
    else kept.push(issue);
  }
  const fresh: Issue[] = [...byPrint.values()].map((f) => ({
    id: randomUUID(),
    fingerprint: f.fingerprint,
    area: f.area,
    severity: f.severity,
    title: f.title.slice(0, 300),
    detail: f.detail.slice(0, 4000),
    panel: f.panel || "",
    firstSeen: at,
    lastSeen: at,
    seenCount: 1,
    notified: false,
    jobId: "",
    blip: isBlip(f),
  }));
  return { issues: [...kept, ...fresh], fresh, cleared };
}

// ---- Which screens a change affects ----
export const SCREENS: { name: string; path: string; folders: RegExp }[] = [
  { name: "Nova Agent", path: "/agent/", folders: /^web\/agent\// },
  { name: "Portal", path: "/portal/", folders: /^web\/portal\// },
  { name: "Calendar", path: "/calendar/", folders: /^web\/calendar\// },
  { name: "Notes", path: "/notes/", folders: /^web\/notes\// },
  { name: "Index", path: "/app/memory/", folders: /^web\/index\// },
  { name: "Observatory", path: "/observatory/", folders: /^web\/observatory\// },
  { name: "Lossless", path: "/lossless/", folders: /^web\/lossless\// },
  { name: "Visualizer", path: "/visualizer", folders: /^web\/agent\/page\.html$/ },
  { name: "Fixer", path: "/fixer/", folders: /^web\/fixer\// },
];
export function affectedScreens(files: FileChange[]): typeof SCREENS {
  const na = files.filter((f) => f.repo === "na");
  // The shared look touches every panel; anything else: the panels whose folders changed
  if (na.some((f) => /^web\/shared\//.test(f.path))) return SCREENS;
  const hit = SCREENS.filter((s) => na.some((f) => s.folders.test(f.path)));
  return hit.length ? hit : SCREENS.slice(0, 1);
}
