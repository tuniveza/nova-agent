// Computer: the VPS at a glance, for admins (web/computer). What the Claude sessions on the VPS
// show right now (tmux, read-only), Claude Code's state and its jobs, how busy the VPS is, and how
// Nova is doing. Online, Nova Bot passes the one address on over the link, for admins only
// (src/relay.ts); here, this computer's own page counts as an admin, like the Fixer.
//
//   GET /computer-api/state      everything the page shows (no secrets: every line passes redact())
//   GET /computer-api/files|file|image|procs|disk   its read-only views of the VPS (src/computer-explore.ts)
//
// Read-only on purpose: nothing here types into a session, restarts anything or reads a key.
// On the studio PC (not the server) it only says so: the VPS's Nova Agent has the real view.

import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statfsSync } from "node:fs";
import { cpus, loadavg, uptime as osUptime } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { config } from "./config";
import { actorFor } from "./fixer/routes";
import { claudeProblem, fixerPaths } from "./fixer/service";
import { currentStrictFixer } from "./fixer/strict-service";
import { DiskSizes, listFolder, PathError, ProcSampler, readImage, readTextFile } from "./computer-explore";

// ================= Secrets never leave =================
// Values of this computer's own keys (read from its environment, never sent), then shapes that
// look like keys or tokens. Whatever matches becomes •••.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|EMAIL|CREDENTIAL)/i;
export function secretValues(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => SECRET_NAME.test(k) && typeof v === "string" && v.trim().length >= 6)
    .map(([, v]) => (v as string).trim())
    .sort((a, b) => b.length - a.length);
}
const SHAPES: [RegExp, string][] = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-•••"],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 •••"],
  [/\b([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS))\s*([=:])\s*\S+/g, "$1$2•••"],
  [/\b(api[_-]?key|token|secret|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2•••"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "•••"], // a JWT
  [/\bAKIA[0-9A-Z]{16}\b/g, "•••"],
];
// A long run that looks random (base64 keys): letters of both cases and digits, not a path
const LONG = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_=-])/g;
// (and long hex: keys and HMACs; git's short hashes are left alone)
const HEX = /\b[a-f0-9]{40,}\b/gi;
const looksRandom = (t: string) => /\d/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t) && (t.match(/\//g) || []).length < 3;
export function redact(text: string, secrets: string[] = []): string {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("•••");
  for (const [re, to] of SHAPES) out = out.replace(re, to);
  return out.replace(HEX, (t) => (/\d/.test(t) && /[a-f]/i.test(t) ? "•••" : t)).replace(LONG, (t) => (looksRandom(t) ? "•••" : t));
}

// ================= Terminal colours → HTML =================
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CUBE = [0, 95, 135, 175, 215, 255];
function colour256(n: number): string | null {
  if (n < 0 || n > 255) return null;
  if (n < 16) return null; // the 16 named ones are classes (the theme picks them)
  if (n >= 232) {
    const g = 8 + (n - 232) * 10;
    return `rgb(${g},${g},${g})`;
  }
  const i = n - 16;
  return `rgb(${CUBE[Math.floor(i / 36)]},${CUBE[Math.floor(i / 6) % 6]},${CUBE[i % 6]})`;
}
interface Pen { fg: string | null; bg: string | null; fgStyle: string | null; bgStyle: string | null; bold: boolean; dim: boolean; italic: boolean; under: boolean; inverse: boolean }
const plainPen = (): Pen => ({ fg: null, bg: null, fgStyle: null, bgStyle: null, bold: false, dim: false, italic: false, under: false, inverse: false });
function applySgr(pen: Pen, codes: number[]): void {
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) Object.assign(pen, plainPen());
    else if (c === 1) pen.bold = true;
    else if (c === 2) pen.dim = true;
    else if (c === 3) pen.italic = true;
    else if (c === 4) pen.under = true;
    else if (c === 7) pen.inverse = true;
    else if (c === 22) pen.bold = pen.dim = false;
    else if (c === 23) pen.italic = false;
    else if (c === 24) pen.under = false;
    else if (c === 27) pen.inverse = false;
    else if (c >= 30 && c <= 37) (pen.fg = `c${c - 30}`), (pen.fgStyle = null);
    else if (c >= 90 && c <= 97) (pen.fg = `c${c - 90 + 8}`), (pen.fgStyle = null);
    else if (c === 39) pen.fg = pen.fgStyle = null;
    else if (c >= 40 && c <= 47) (pen.bg = `b${c - 40}`), (pen.bgStyle = null);
    else if (c >= 100 && c <= 107) (pen.bg = `b${c - 100 + 8}`), (pen.bgStyle = null);
    else if (c === 49) pen.bg = pen.bgStyle = null;
    else if (c === 38 || c === 48) {
      const fore = c === 38;
      let named: string | null = null;
      let style: string | null = null;
      if (codes[i + 1] === 5 && codes[i + 2] !== undefined) {
        const n = codes[i + 2];
        if (n < 16) named = `${fore ? "c" : "b"}${n}`;
        else style = colour256(n);
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] !== undefined) {
        const [r, g, b] = codes.slice(i + 2, i + 5).map((v) => Math.max(0, Math.min(255, v)));
        style = `rgb(${r},${g},${b})`;
        i += 4;
      }
      if (fore) (pen.fg = named), (pen.fgStyle = style);
      else (pen.bg = named), (pen.bgStyle = style);
    }
  }
}
function openSpan(pen: Pen): string {
  const cls: string[] = [];
  const style: string[] = [];
  let fg = pen.fg, bg = pen.bg, fgS = pen.fgStyle, bgS = pen.bgStyle;
  if (pen.inverse) {
    [fg, bg] = [bg ? bg.replace(/^b/, "c") : "inv-fg", fg ? fg.replace(/^c/, "b") : "inv-bg"];
    [fgS, bgS] = [bgS, fgS];
  }
  if (fg) cls.push(fg);
  if (bg) cls.push(bg);
  if (pen.bold) cls.push("bo");
  if (pen.dim) cls.push("di");
  if (pen.italic) cls.push("it");
  if (pen.under) cls.push("un");
  if (fgS) style.push(`color:${fgS}`);
  if (bgS) style.push(`background:${bgS}`);
  if (!cls.length && !style.length) return "";
  return `<span${cls.length ? ` class="${cls.join(" ")}"` : ""}${style.length ? ` style="${style.join(";")}"` : ""}>`;
}
// Colour codes become <span>s (classes for the 16 named colours, a style for the rest); every other
// escape (cursor moves, titles, links) is dropped; the text itself is always escaped
export function ansiToHtml(text: string): string {
  const src = String(text ?? "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "") // OSC (titles, links)
    .replace(/\r(?!\n)/g, "");
  const re = /\x1b\[([0-9;:]*)([A-Za-z])/g;
  const pen = plainPen();
  let out = "";
  let open = "";
  let last = 0;
  const flush = (chunk: string) => {
    if (!chunk) return;
    const clean = chunk.replace(/\x1b[()][A-Za-z0-9]|\x1b[=>78]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
    if (clean) out += open + esc(clean) + (open ? "</span>" : "");
  };
  for (let m = re.exec(src); m; m = re.exec(src)) {
    flush(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] !== "m") continue;
    const codes = m[1] === "" ? [0] : m[1].split(/[;:]/).map((v) => (v === "" ? 0 : Number(v)));
    applySgr(pen, codes);
    open = openSpan(pen);
  }
  flush(src.slice(last));
  return out;
}

// ================= Reading the VPS =================
type Run = (cmd: string, args: string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string }>;
const runReal: Run = (cmd, args, timeoutMs = 5000) =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 << 20, env: { ...process.env, LANG: "C.UTF-8" } }, (err, stdout) =>
      resolve({ ok: !err, out: String(stdout || "") }),
    ),
  );
const readText = (f: string): string | null => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};

export interface ComputerDeps {
  onServer: boolean;
  run: Run;
  read: (f: string) => string | null;
  list: (dir: string) => string[];
  now: () => number;
  workDir: string;
  repos: { name: string; dir: string }[];
  fetchJson: (url: string, headers?: Record<string, string>) => Promise<any>;
  statusUrl: string;
  deskUrl: string;
  deskToken: string;
  secrets: () => string[];
  fixer: () => { needsYou: number; lastCheck: string | null; looksAt: string | null; looksFailed: number; claude: string } | null;
  claudeProblem: () => string;
  sampler: Sampler;
}

// ---- CPU and memory, every 30 s, for half an hour (kept here, in memory) ----
export interface Sample { at: number; cpu: number; mem: number }
export class Sampler {
  points: Sample[] = [];
  private prev: { idle: number; total: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private read: (f: string) => string | null = readText, private now: () => number = Date.now) {}
  cpuTimes(): { idle: number; total: number } | null {
    const line = (this.read("/proc/stat") || "").split("\n").find((l) => l.startsWith("cpu "));
    if (!line) return null;
    const n = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (n[3] || 0) + (n[4] || 0);
    return { idle, total: n.reduce((a, b) => a + (b || 0), 0) };
  }
  memory(): { total: number; available: number } | null {
    const text = this.read("/proc/meminfo");
    if (!text) return null;
    const get = (k: string) => Number((text.match(new RegExp(`^${k}:\\s+(\\d+)`, "m")) || [])[1] || 0) * 1024;
    const total = get("MemTotal");
    return total ? { total, available: get("MemAvailable") } : null;
  }
  // The share of CPU busy since the last look (0..100)
  take(): Sample | null {
    const t = this.cpuTimes();
    const m = this.memory();
    if (!t || !m) return null;
    let cpu = 0;
    if (this.prev && t.total > this.prev.total) cpu = Math.round((1 - (t.idle - this.prev.idle) / (t.total - this.prev.total)) * 100);
    this.prev = t;
    const s = { at: this.now(), cpu: Math.max(0, Math.min(100, cpu)), mem: Math.round(((m.total - m.available) / m.total) * 100) };
    this.points.push(s);
    const since = this.now() - 30 * 60_000;
    while (this.points.length && this.points[0].at < since) this.points.shift();
    return s;
  }
  start(): void {
    if (this.timer) return;
    this.take();
    this.timer = setInterval(() => this.take(), 30_000);
    this.timer.unref?.();
  }
}

// ---- The Claude sessions: tmux windows (Remote Control "Nova-VPS", and one per job) ----
export interface Screen { id: string; session: string; window: number; name: string; active: boolean; title: string; html: string }
const TITLES: Record<string, string> = { "nova-vps": "Nova-VPS (Remote Control)", "nova-jobs": "Job" };
export async function readScreens(d: Pick<ComputerDeps, "run" | "secrets">, lines = 60): Promise<{ screens: Screen[]; remote: boolean; tmux: boolean }> {
  const ls = await d.run("tmux", ["list-windows", "-a", "-F", "#{session_name}\t#{window_index}\t#{window_name}\t#{window_active}"]);
  if (!ls.ok) return { screens: [], remote: false, tmux: false };
  const secrets = d.secrets();
  const rows = ls.out.split("\n").filter(Boolean).map((l) => l.split("\t")).filter((r) => r.length >= 4 && /^[\w.-]+$/.test(r[0]) && /^\d+$/.test(r[1]));
  const screens: Screen[] = [];
  let remote = false;
  for (const [session, idx, name, active] of rows.slice(0, 16)) {
    if (session === "nova-jobs" && name === "idle") continue;
    const cap = await d.run("tmux", ["capture-pane", "-p", "-e", "-J", "-S", `-${lines}`, "-t", `${session}:${idx}`]);
    const raw = (cap.ok ? cap.out : "").replace(/\n+$/, "").split("\n").slice(-lines).join("\n");
    const clean = redact(raw, secrets);
    if (session === "nova-vps" && /Connected/.test(clean.replace(/\x1b\[[0-9;]*m/g, ""))) remote = true;
    screens.push({
      id: `${session}:${idx}`,
      session,
      window: Number(idx),
      name: redact(name, secrets).slice(0, 60),
      active: active === "1",
      title: session === "nova-jobs" ? `Job · ${name}` : TITLES[session] || session,
      html: ansiToHtml(clean),
    });
  }
  return { screens, remote, tmux: true };
}

// ---- The jobs run-job.sh started: <work>/logs/<stamp>-<name>.log (+ .task) ----
export interface JobView { id: string; name: string; task: string; started: string; finished: string | null; running: boolean; exit: number | null; seconds: number; tail: string }
export function readJobs(d: Pick<ComputerDeps, "list" | "read" | "now" | "secrets" | "workDir">, limit = 12): JobView[] {
  const dir = join(d.workDir, "logs");
  const secrets = d.secrets();
  return d
    .list(dir)
    .filter((f) => /^\d{8}-\d{4,6}-[\w.-]+\.log$/.test(f))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      const [, ymd, hms, name] = f.match(/^(\d{8})-(\d{4,6})-([\w.-]+)\.log$/) as RegExpMatchArray;
      const t = hms.padEnd(6, "0");
      const started = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
      const log = d.read(join(dir, f)) || "";
      const done = log.match(/=== DONE (\S+) exit (\d+)/);
      const finished = done ? done[1] : null;
      const startMs = Date.parse(started);
      const endMs = finished ? Date.parse(finished) : d.now();
      const tail = log.replace(/\n?=== DONE .*$/m, "").trimEnd().split("\n").slice(-30).join("\n");
      return {
        id: f.replace(/\.log$/, ""),
        name,
        task: redact((d.read(join(dir, `${f}.task`)) || "").trim(), secrets).slice(0, 700),
        started,
        finished,
        running: !done,
        exit: done ? Number(done[2]) : null,
        seconds: Number.isFinite(startMs) ? Math.max(0, Math.round(((Number.isFinite(endMs) ? endMs : d.now()) - startMs) / 1000)) : 0,
        tail: redact(tail, secrets).slice(-6000),
      };
    });
}

// ---- HANDOFF.md: its newest section (the first "## " heading and what's under it) ----
export function handoffTop(md: string | null, max = 1600): { heading: string; text: string } | null {
  if (!md) return null;
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s+/.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  if (end < 0) end = lines.length;
  const text = lines.slice(start + 1, end).join("\n").trim();
  return { heading: lines[start].replace(/^##\s+/, "").trim(), text: text.length > max ? `${text.slice(0, max).trimEnd()}…` : text };
}

// ---- Small things that don't change often are kept for a while ----
const kept = new Map<string, { at: number; value: unknown }>();
async function keep<T>(key: string, ms: number, now: number, get: () => Promise<T>): Promise<T> {
  const k = kept.get(key);
  if (k && now - k.at < ms) return k.value as T;
  const value = await get();
  kept.set(key, { at: now, value });
  return value;
}
export function forgetKept(): void {
  kept.clear();
}

const SERVICES = ["nova", "nova-agent", "caddy", "nova-mail", "postfix"];
const SERVICE_NAMES: Record<string, string> = { nova: "Nova Bot", "nova-agent": "Nova Agent", caddy: "Web (Caddy)", "nova-mail": "Mail sender", postfix: "Mail (Postfix)" };

export async function computerState(d: ComputerDeps) {
  if (!d.onServer) return { ok: true, onServer: false, message: "Open this on the VPS's Nova: https://nova.novacane.co.uk/agent/computer" };
  const now = d.now();
  d.sampler.start();
  const secrets = d.secrets();
  const [screens, version, services, status, desk, deploys] = await Promise.all([
    readScreens(d),
    keep("version", 10 * 60_000, now, async () => {
      const r = await d.run("claude", ["--version"], 10_000);
      return r.ok ? r.out.trim().split("\n")[0].slice(0, 80) : "";
    }),
    keep("services", 4_000, now, async () => {
      const r = await d.run("systemctl", ["is-active", ...SERVICES]);
      const states = r.out.trim().split("\n");
      return SERVICES.map((s, i) => ({ id: s, name: SERVICE_NAMES[s] || s, state: (states[i] || "unknown").trim() }));
    }),
    keep("status", 20_000, now, () => d.fetchJson(d.statusUrl).catch(() => null)),
    keep("desk", 60_000, now, () => (d.deskToken ? d.fetchJson(d.deskUrl, { Authorization: `Bearer ${d.deskToken}` }).catch(() => null) : Promise.resolve(null))),
    keep("deploys", 30_000, now, async () => {
      const all: { repo: string; hash: string; at: string; subject: string }[] = [];
      for (const r of d.repos) {
        const out = await d.run("git", ["-C", r.dir, "log", "-6", "--format=%h%x09%cI%x09%s", "main"]);
        if (!out.ok) continue;
        for (const l of out.out.split("\n").filter(Boolean)) {
          const [hash, at, ...rest] = l.split("\t");
          all.push({ repo: r.name, hash, at, subject: redact(rest.join("\t"), secrets).slice(0, 160) });
        }
      }
      return all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
    }),
  ]);
  const jobs = readJobs(d);
  const today = new Date(now).toISOString().slice(0, 10);
  const memInfo = d.sampler.memory();
  let disk: { total: number; free: number } | null = null;
  try {
    const s = statfsSync("/");
    disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {}
  const last = d.sampler.points[d.sampler.points.length - 1];
  const parts = Array.isArray(status?.parts) ? status.parts : [];
  return {
    ok: true,
    onServer: true,
    at: new Date(now).toISOString(),
    screens: screens.screens,
    claude: {
      version,
      signedIn: d.claudeProblem() === "",
      problem: d.claudeProblem(),
      remote: screens.remote,
      tmux: screens.tmux,
      running: jobs.filter((j) => j.running).length,
      finishedToday: jobs.filter((j) => !j.running && (j.finished || "").startsWith(today)).length,
      handoff: (() => {
        const h = handoffTop(d.read(join(d.workDir, "HANDOFF.md")));
        return h ? { heading: redact(h.heading, secrets), text: redact(h.text, secrets) } : null;
      })(),
    },
    jobs,
    vps: {
      cpus: cpus().length,
      load: loadavg().map((n) => Math.round(n * 100) / 100),
      cpu: last ? last.cpu : null,
      memory: memInfo ? { total: memInfo.total, used: memInfo.total - memInfo.available } : null,
      disk,
      uptimeSeconds: Math.round(osUptime()),
      services,
      history: d.sampler.points.map((p) => ({ at: p.at, cpu: p.cpu, mem: p.mem })),
    },
    suite: {
      overall: typeof status?.overall === "string" ? status.overall : null,
      ok: status ? status.ok === true : null,
      parts: parts.slice(0, 20).map((p: any) => ({ name: String(p?.name || p?.id || "").slice(0, 60), state: String(p?.state || "unknown").slice(0, 12), text: redact(String(p?.text || ""), secrets).slice(0, 200) })),
      deploys,
      fixer: d.fixer(),
      backup: desk && typeof desk.lastBackup === "string" ? { last: desk.lastBackup, count: Array.isArray(desk.backups) ? desk.backups.length : null } : null,
    },
  };
}

// ================= Wiring =================
const sampler = new Sampler();
export function realDeps(): ComputerDeps {
  const work = process.env.COMPUTER_WORK_DIR || "/srv/nova-agent/work";
  return {
    onServer: config.onServer,
    run: runReal,
    read: readText,
    list: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    now: Date.now,
    workDir: work,
    repos: [
      { name: "Nova Agent", dir: fixerPaths.naMain },
      { name: "Nova Bot", dir: fixerPaths.nbMain },
    ].filter((r) => existsSync(r.dir)),
    fetchJson: async (url, headers) => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    statusUrl: `${config.workerUrl.replace(/\/$/, "")}/status.json`,
    // Computer's status service on the VPS (Nova Bot's vps/desk-status): its token is made from the key Nova Agent already has
    deskUrl: "http://127.0.0.1:8788/status",
    deskToken: config.agentNovaKey ? createHmac("sha256", config.agentNovaKey).update("desk-status").digest("hex") : "",
    secrets: () => secretValues(),
    // The Fixer (the three strict rules, every 5 minutes): when it last looked, and how many problems
    fixer: () => {
      const f = currentStrictFixer();
      if (!f) return null;
      try {
        const s = f.state();
        return { needsYou: 0, lastCheck: s.last?.at || null, looksAt: s.last?.at || null, looksFailed: s.problems.length, claude: "" };
      } catch {
        return null;
      }
    },
    claudeProblem: () => claudeProblem(),
    sampler,
  };
}

// The views of the VPS (src/computer-explore.ts): one each, kept for the server's life
const procSampler = new ProcSampler();
const diskSizes = new DiskSizes();
export interface ExploreDeps { onServer: boolean; secrets: () => string[]; procs: ProcSampler; disk: DiskSizes }
const realExplore = (): ExploreDeps => ({ onServer: config.onServer, secrets: () => secretValues(), procs: procSampler, disk: diskSizes });

export function registerComputerRoutes(app: Hono, deps: () => ComputerDeps = realDeps, explore: () => ExploreDeps = realExplore): void {
  const admin = (c: any) => {
    const actor = actorFor(c.req.raw);
    return !!actor && actor.admin;
  };
  const refuse = (c: any) => c.json({ ok: false, message: "Computer is for admins." }, 403);
  const NO_STORE = { "Cache-Control": "no-store" };
  app.get("/computer-api/state", async (c) => {
    if (!admin(c)) return refuse(c);
    try {
      return c.json(await computerState(deps()), 200, NO_STORE);
    } catch (err) {
      return c.json({ ok: false, message: (err as Error).message }, 500);
    }
  });
  // The views: admins only, and only on the VPS (on the studio PC there's nothing of the VPS to show)
  const view = (fn: (c: any, e: ExploreDeps) => unknown) => async (c: any) => {
    if (!admin(c)) return refuse(c);
    const e = explore();
    if (!e.onServer) return c.json({ ok: false, onServer: false, message: "Open this on the VPS's Nova." }, 200, NO_STORE);
    try {
      const out = await fn(c, e);
      return out instanceof Response ? out : c.json({ ok: true, ...(out as object) }, 200, NO_STORE);
    } catch (err) {
      const status = err instanceof PathError ? err.status : 500;
      return c.json({ ok: false, message: err instanceof PathError ? err.message : "Couldn't read that just now." }, status, NO_STORE);
    }
  };
  app.get("/computer-api/files", view((c) => listFolder(c.req.query("path") || "/")));
  app.get("/computer-api/file", view((c, e) => ({ file: readTextFile(c.req.query("path"), e.secrets(), redact) })));
  app.get("/computer-api/image", view((c) => {
    const img = readImage(c.req.query("path"));
    // (shown in an <img> only; an SVG's scripts never run there, and this says so twice)
    return new Response(new Uint8Array(img.bytes), { status: 200, headers: { "Content-Type": img.type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  }));
  app.get("/computer-api/procs", view((_c, e) => e.procs.snapshot(e.secrets(), redact)));
  app.get("/computer-api/disk", view((c, e) => e.disk.ask(c.req.query("path") || "/")));
}
