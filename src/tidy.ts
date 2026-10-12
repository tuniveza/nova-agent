// Portal → Test stuff, the studio PC's half: quests, missions, calendar notes, Fixer jobs and files
// that look like tests or copies (Nova Bot finds its own: src/tidy.js there). Portal shows both lists.
//
// Each thing comes with plain reasons (rude or joke words, "test", a copy of another quest, a
// reminder test seconds long, a Fixer fix for a problem that's gone…). One strong reason, or two
// weak ones, makes it "Likely a test"; one weak one makes it "Maybe".
//
// Deleting goes through each thing's own way of being deleted (removeQuest, removeMission, the
// calendar store, so the calendar's sync tells Nova Bot too; the Fixer's Reject; removeFile), and a
// whole copy goes in data/tidy.json's bin first, so "Recently deleted" can put it back for 30 days.
// (A Fixer job is only cleared, the Fixer's own Reject: there's nothing to put back.) "Not a test"
// is remembered there too. The log keeps ids and kinds only.
//
//   GET  /tidy-api/state                       { items, real, recent, counts }
//   POST /actions/tidy/delete                  { items: [{ key, title, together, linked }] }
//   POST /actions/tidy/restore                 { binId }
//   POST /actions/tidy/real | unreal           { key, title? }
// Admins only: this computer's own page, or an admin signed in to Portal online (relayed: src/relay.ts).

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readCalendar, removeNote, writeCalendar, type NoteCard } from "./calendar/store";
import { config } from "./config";
import { listFiles, readFileText, removeFile, saveFile, type FileEntry } from "./files";
import { removeMission, removeQuest } from "./quests/actions";
import { replan } from "./quests/plan";
import { cleanMission, cleanQuest, readQuests, writeQuests, type Mission, type Quest } from "./quests/store";
import { trace } from "./trace";
import { isTestName, jokeWordsIn, testWordsIn } from "./tidy-words";

const DAY = 86_400_000;
const BIN_DAYS = 30;

export const PC_KINDS = { quest: "Quest", mission: "Mission", calnote: "Calendar note", fixer: "Fixer job", file: "File" } as const;
export type PcKind = keyof typeof PC_KINDS;

export interface Reason {
  text: string;
  strong: boolean;
}
export interface TidyItem {
  key: string;
  kind: PcKind;
  kindName: string;
  id: string;
  title: string;
  confidence: "likely" | "maybe";
  reasons: Reason[];
  linked: { key: string; kind: string; kindName: string; label: string }[];
  side: "pc";
  where: string;
  open: string;
  created: string;
  by: string;
  note?: string;
  noRestore?: boolean;
}

// The Fixer's jobs, as much of them as this needs
export interface JobLike {
  id: string;
  status: string;
  target: { type?: string; id: string; title: string };
  created: string;
  updated: string;
}

export interface PcData {
  quests: Quest[];
  missions: Mission[];
  notes: NoteCard[];
  jobs: JobLike[];
  issues: { id: string }[];
  fixerQuests: { id: string; status: string }[];
  files: { entry: FileEntry; hash: string }[];
  real: string[];
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const short = (s: unknown, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const verdict = (reasons: Reason[]) => (reasons.some((r) => r.strong) || reasons.filter((r) => !r.strong).length >= 2 ? "likely" : reasons.length ? "maybe" : null);
const PART = /\(part \d+ of \d+\)/i;

function wordReasons(title: string, body = ""): Reason[] {
  const out: Reason[] = [];
  if (isTestName(title)) out.push({ text: "A name used in the studio's own tests", strong: true });
  const joke = jokeWordsIn(`${title}\n${body}`);
  if (joke.length) out.push({ text: `Rude or joke words: ${joke.slice(0, 3).map((w) => `“${w}”`).join(", ")}`, strong: true });
  const t = testWordsIn(title);
  if (t.length) out.push({ text: `Says “${t[0]}”`, strong: true });
  else {
    const b = testWordsIn(body);
    if (b.length) out.push({ text: `Mentions “${b[0]}”`, strong: false });
  }
  return out;
}

// How alive a quest is: the one to keep of a set of copies
const ALIVE: Record<string, number> = { doing: 0, todo: 1, done: 2, skipped: 3 };
const words = (s: string) => new Set(norm(s).split(" ").filter(Boolean));
function alike(a: string, b: string): boolean {
  if (PART.test(a) && PART.test(b)) return false;
  const x = words(a);
  const y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / new Set([...x, ...y]).size >= 0.6;
}

// data -> the things that look like tests, likely first
export function findPcTestStuff(d: PcData, now = Date.now()): TidyItem[] {
  const real = new Set(d.real);
  const items: TidyItem[] = [];
  const put = (kind: PcKind, id: string, title: string, extra: Partial<TidyItem>, reasons: Reason[]) => {
    const key = `${kind}:${id}`;
    const confidence = verdict(reasons);
    if (real.has(key) || !confidence) return null;
    const item: TidyItem = { key, kind, kindName: PC_KINDS[kind], id, title: short(title) || `${PC_KINDS[kind]} ${id}`, confidence, reasons, linked: [], side: "pc", where: "", open: "", created: "", by: "", ...extra };
    items.push(item);
    return item;
  };

  // --- Quests
  const keep = new Map<string, Quest>(); // title -> the one to keep
  for (const q of d.quests) {
    const k = norm(q.title);
    const was = keep.get(k);
    if (!was || (ALIVE[q.status] ?? 9) < (ALIVE[was.status] ?? 9) || ((ALIVE[q.status] ?? 9) === (ALIVE[was.status] ?? 9) && q.updated > was.updated)) keep.set(k, q);
  }
  for (const q of d.quests) {
    // (only the title: a quest's notes are plans, and plans talk about testing)
    const reasons = wordReasons(q.title);
    const kept = keep.get(norm(q.title))!;
    if (kept.id !== q.id) reasons.push({ text: `A copy of “${short(kept.title, 40)}” (${kept.status === "doing" ? "in progress" : kept.status === "todo" ? "still to do" : kept.status})`, strong: true });
    else {
      const longer = d.quests.find((o) => o.id !== q.id && norm(o.title).startsWith(norm(q.title) + " ") && words(q.title).size >= 2 && !PART.test(o.title));
      const near = d.quests.find((o) => o.id !== q.id && keep.get(norm(o.title))?.id === o.id && alike(q.title, o.title) && (ALIVE[o.status] ?? 9) <= (ALIVE[q.status] ?? 9));
      if (longer) reasons.push({ text: `Looks like an early copy of “${short(longer.title, 40)}”`, strong: false });
      else if (near) reasons.push({ text: `Very like “${short(near.title, 40)}”`, strong: false });
    }
    const noNotes = !String(q.notes || "").trim();
    if (noNotes && q.minutes <= 1) reasons.push({ text: `Only ${Math.max(1, Math.round(q.minutes * 60))} seconds long, with no notes (a reminder test?)`, strong: false });
    if (noNotes && q.minutes <= 5 && q.completed && q.created && Date.parse(q.completed) - Date.parse(q.created) <= 15 * 60_000) reasons.push({ text: "Made and finished within minutes", strong: false });
    if (noNotes && !reasons.length && (q.status === "done" || q.status === "skipped") && !q.missionId && !q.from && words(q.title).size <= 3 && now - Date.parse(q.created) > DAY)
      reasons.push({ text: "Short, with no notes, and finished", strong: false });
    if (reasons.length && q.status === "skipped") reasons.push({ text: "Skipped", strong: false });
    put("quest", q.id, q.title, { where: "Quests", open: "/portal/?view=quests", created: q.created, by: q.from || (q.owner ? q.owner : "") }, reasons);
  }

  // --- Missions (deleting one takes its quests with it)
  const mKeep = new Map<string, Mission>();
  for (const m of d.missions) {
    const was = mKeep.get(norm(m.title));
    if (!was || m.updated > was.updated) mKeep.set(norm(m.title), m);
  }
  for (const m of d.missions) {
    const reasons = wordReasons(m.title);
    if (mKeep.get(norm(m.title))!.id !== m.id) reasons.push({ text: "A copy of a newer mission with the same name", strong: true });
    const item = put("mission", m.id, m.title, { where: "Missions", open: "/agent/", created: m.created, by: "" }, reasons);
    if (item) {
      const n = d.quests.filter((q) => q.missionId === m.id).length;
      if (n) item.note = `Its ${n} quest${n === 1 ? "" : "s"} go${n === 1 ? "es" : ""} with it.`;
    }
  }

  // --- Calendar notes (a quest's own card, quest-…, follows its quest)
  const notes = d.notes.filter((n) => !n.id.startsWith("quest-"));
  for (const n of notes) {
    const reasons = wordReasons(n.title, n.body);
    const twin = notes.find((o) => o !== n && norm(o.title) === norm(n.title) && o.start === n.start && o.updated > n.updated);
    if (twin) reasons.push({ text: "A copy of another note at the same time", strong: true });
    put("calnote", n.id, n.title, { where: "Calendar", open: "/agent/?open=%2Fcalendar%2F", created: n.created, by: n.author || "" }, reasons);
  }

  // --- Fixer jobs left blocked or failed for a problem that's gone or fixed since
  const issues = new Set(d.issues.map((i) => i.id));
  const quests = new Set(d.fixerQuests.filter((q) => q.status !== "done").map((q) => q.id));
  for (const j of d.jobs) {
    if (j.status !== "blocked" && j.status !== "failed") continue;
    const reasons: Reason[] = [];
    // ("Notes at 390px: a file didn't load: …" and "Index at 390px: a file didn't load: …" are the same problem)
    const problem = (title: string) => norm(title.split(": ").slice(1).join(": ") || title);
    const fixed = d.jobs.find((o) => o !== j && o.status === "done" && problem(o.target.title) === problem(j.target.title));
    if (fixed) reasons.push({ text: "Fixed by another fix since", strong: true });
    else if (j.target.type === "quest" ? !quests.has(j.target.id) : !issues.has(j.target.id)) reasons.push({ text: j.target.type === "quest" ? "Its Fixer quest is gone" : "The problem is gone now", strong: true });
    if (now - Date.parse(j.updated) > 2 * DAY) reasons.push({ text: `Stuck as “${j.status}” for days`, strong: false });
    put("fixer", j.id, j.target.title, { where: "The Fixer", open: "/agent/?open=%2Ffixer%2F", created: j.created, by: "The Fixer", noRestore: true, note: "Clearing it rejects the old fix (nothing on the site changes)." }, reasons);
  }

  // --- Files: the same words twice (the newest stays), or test words in the name
  for (const f of d.files) {
    const reasons = wordReasons(`${f.entry.title || ""} ${f.entry.name}`);
    const twin = d.files.find((o) => o !== f && o.hash === f.hash && o.entry.updated > f.entry.updated);
    if (twin) reasons.push({ text: `The same as “${twin.entry.name}”`, strong: true });
    put("file", f.entry.id, f.entry.title || f.entry.name, { where: "Agent's files", open: "/agent/", created: f.entry.created, by: f.entry.source === "chat" ? "Agent" : f.entry.source }, reasons);
  }

  const rank = { likely: 0, maybe: 1 };
  return items.sort((a, b) => rank[a.confidence] - rank[b.confidence] || String(b.created).localeCompare(String(a.created)));
}

// ===== THE BIN, "NOT A TEST" AND THE LOG (data/tidy.json) =====

interface BinEntry {
  binId: string;
  key: string;
  kind: PcKind;
  title: string;
  data: any;
  deletedBy: string;
  deletedAt: string;
  restoredBy?: string;
  restoredAt?: string;
  noRestore?: boolean;
}
interface TidyFile {
  version: 1;
  real: { key: string; kind: string; title: string; markedBy: string; markedAt: string }[];
  bin: BinEntry[];
  log: { at: string; action: string; key: string; by: string }[];
}

const file = () => `${config.paths.dataDir}tidy.json`;
function readTidy(): TidyFile {
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), "utf8"));
      return { version: 1, real: Array.isArray(raw.real) ? raw.real : [], bin: Array.isArray(raw.bin) ? raw.bin : [], log: Array.isArray(raw.log) ? raw.log : [] };
    }
  } catch (error) {
    trace("task", "warn", `Test stuff: tidy.json couldn't be read (${(error as Error).message}); starting a new one`);
  }
  return { version: 1, real: [], bin: [], log: [] };
}
function writeTidy(t: TidyFile): void {
  const cut = new Date(Date.now() - BIN_DAYS * DAY).toISOString();
  t.bin = t.bin.filter((b) => b.deletedAt >= cut);
  t.log = t.log.slice(-500);
  writeFileSync(`${file()}.tmp`, JSON.stringify(t, null, 2));
  renameSync(`${file()}.tmp`, file());
}

// ===== READING WHAT'S THERE =====

export interface FixerLike {
  state(): { issues: { id: string }[]; quests: { id: string; status: string }[]; working: JobLike[]; done: JobLike[]; needsYou: JobLike[] };
  reject(id: string, actor: { name: string; admin: boolean; via: "pc" | "online" }): unknown;
}

export function pcData(fixer: FixerLike | null): PcData {
  const q = readQuests();
  const st = fixer ? fixer.state() : null;
  const files = listFiles().map((entry) => {
    let text = "";
    try {
      text = readFileText(entry);
    } catch {}
    return { entry, hash: createHash("sha256").update(text).digest("hex") };
  });
  return {
    quests: q.quests,
    missions: q.missions,
    notes: readCalendar().notes,
    jobs: st ? [...st.working, ...st.done, ...st.needsYou] : [],
    issues: st ? st.issues : [],
    fixerQuests: st ? st.quests : [],
    files,
    real: readTidy().real.map((r) => r.key),
  };
}

export function pcTestStuff(fixer: FixerLike | null) {
  const items = findPcTestStuff(pcData(fixer));
  const t = readTidy();
  const cut = new Date(Date.now() - BIN_DAYS * DAY).toISOString();
  return {
    items,
    real: t.real,
    recent: t.bin
      .filter((b) => b.deletedAt >= cut)
      .reverse()
      .map((b) => ({ binId: b.binId, key: b.key, kind: b.kind, kindName: PC_KINDS[b.kind] || b.kind, title: b.title, deletedBy: b.deletedBy, deletedAt: b.deletedAt, restoredBy: b.restoredBy || null, restoredAt: b.restoredAt || null, noRestore: !!b.noRestore })),
    counts: { likely: items.filter((i) => i.confidence === "likely").length, maybe: items.filter((i) => i.confidence === "maybe").length },
  };
}

// ===== DELETING AND PUTTING BACK =====

type Actor = { name: string; admin: boolean; via: "pc" | "online" };

function deleteOne(kind: PcKind, id: string, fixer: FixerLike | null, actor: Actor): { data: any; noRestore?: boolean } {
  if (kind === "quest") {
    const q = readQuests().quests.find((x) => x.id === id);
    if (!q) throw new Error("It's already gone.");
    removeQuest(id);
    return { data: q };
  }
  if (kind === "mission") {
    const data = readQuests();
    const m = data.missions.find((x) => x.id === id);
    if (!m) throw new Error("It's already gone.");
    const quests = data.quests.filter((q) => q.missionId === id);
    removeMission(id);
    return { data: { mission: m, quests } };
  }
  if (kind === "calnote") {
    const n = readCalendar().notes.find((x) => x.id === id);
    if (!n) throw new Error("It's already gone.");
    removeNote(id);
    return { data: n };
  }
  if (kind === "fixer") {
    if (!fixer) throw new Error("The Fixer isn't running.");
    fixer.reject(id, actor);
    return { data: { id }, noRestore: true };
  }
  if (kind === "file") {
    const f = listFiles().find((x) => x.id === id);
    if (!f) throw new Error("It's already gone.");
    const content = readFileText(f);
    removeFile(f.id);
    return { data: { entry: f, content } };
  }
  throw new Error("Unknown kind.");
}

export function deletePcItems(list: { key: string; title?: string; together?: boolean; linked?: string[] }[], fixer: FixerLike | null, actor: Actor) {
  const t = readTidy();
  const done: { key: string; binId: string }[] = [];
  const failed: { key: string; error: string }[] = [];
  for (const it of list.slice(0, 200)) {
    const [kind, ...rest] = String(it.key || "").split(":");
    const id = rest.join(":");
    if (!(kind in PC_KINDS) || !id) {
      failed.push({ key: it.key, error: "Which thing?" });
      continue;
    }
    try {
      const res = deleteOne(kind as PcKind, id, fixer, actor);
      const binId = randomUUID();
      t.bin.push({ binId, key: it.key, kind: kind as PcKind, title: short(it.title, 120) || PC_KINDS[kind as PcKind], data: res.data, deletedBy: actor.name, deletedAt: new Date().toISOString(), ...(res.noRestore ? { noRestore: true } : {}) });
      t.log.push({ at: new Date().toISOString(), action: "delete", key: it.key, by: actor.via });
      done.push({ key: it.key, binId });
    } catch (error) {
      failed.push({ key: it.key, error: (error as Error).message });
    }
  }
  writeTidy(t);
  if (done.length) trace("task", "ok", `Test stuff: ${done.length} thing${done.length === 1 ? "" : "s"} deleted on the PC (${done.map((d) => d.key.split(":")[0]).join(", ")})`);
  return { done, failed };
}

export function restorePcItem(binId: string, actor: Actor) {
  const t = readTidy();
  const b = t.bin.find((x) => x.binId === binId);
  if (!b) throw new Error("That isn't in the bin.");
  if (b.restoredAt) throw new Error("It's already been put back.");
  if (b.noRestore) throw new Error("A cleared Fixer job can't come back (ask the Fixer to check again instead).");
  if (b.kind === "quest" || b.kind === "mission") {
    const data = readQuests();
    const quests: Quest[] = b.kind === "quest" ? [b.data] : b.data.quests;
    if (b.kind === "mission" && !data.missions.some((m) => m.id === b.data.mission.id)) data.missions.push(cleanMission(b.data.mission));
    for (const q of quests) if (!data.quests.some((x) => x.id === q.id)) data.quests.push(cleanQuest(q));
    writeQuests(data);
    replan();
  } else if (b.kind === "calnote") {
    const cal = readCalendar();
    if (!cal.notes.some((n) => n.id === b.data.id)) {
      cal.notes.push(b.data);
      writeCalendar(cal, true);
    }
  } else if (b.kind === "file") {
    saveFile({ id: b.data.entry.id, name: b.data.entry.name, title: b.data.entry.title, content: b.data.content, source: b.data.entry.source });
  }
  b.restoredAt = new Date().toISOString();
  b.restoredBy = actor.name;
  t.log.push({ at: b.restoredAt, action: "restore", key: b.key, by: actor.via });
  writeTidy(t);
  return { ok: true };
}

export function markPcReal(key: string, title: string, actor: Actor) {
  const [kind] = String(key || "").split(":");
  if (!(kind in PC_KINDS)) throw new Error("Which thing?");
  const t = readTidy();
  t.real = t.real.filter((r) => r.key !== key);
  t.real.unshift({ key, kind, title: short(title, 120), markedBy: actor.name, markedAt: new Date().toISOString() });
  t.log.push({ at: new Date().toISOString(), action: "real", key, by: actor.via });
  writeTidy(t);
  return { ok: true };
}

export function unmarkPcReal(key: string, actor: Actor) {
  const t = readTidy();
  t.real = t.real.filter((r) => r.key !== key);
  t.log.push({ at: new Date().toISOString(), action: "unreal", key: String(key || ""), by: actor.via });
  writeTidy(t);
  return { ok: true };
}
