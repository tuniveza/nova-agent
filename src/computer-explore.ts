// Computer's three read-only views of the VPS (web/computer): its files, its programs (processes)
// and what fills its disk. Nova Agent's own user reads them, so whatever only root can read stays
// locked ("Only root can see this"): no sudo, no extra powers. Nothing here edits, deletes,
// uploads, downloads, stops or starts anything.
//
//   GET /computer-api/files?path=/srv          a folder: its entries (name, kind, size, changed, owner)
//   GET /computer-api/file?path=/srv/x.json    a text file's first 200 KB (redacted), or what it is
//   GET /computer-api/image?path=/srv/y.png    a picture (at most 5 MB)
//   GET /computer-api/procs                     every program running: user, CPU, memory, started, command
//   GET /computer-api/disk?path=/srv            the folders inside it by size (du, kept 10 minutes)
//
// Secrets never leave: private files (keys, .env files, credentials, ssh, shadow, anything named
// secret, token or credential...) show their name only ("Hidden: private"), and every line of text
// shown passes redact() (src/computer.ts).

import { execFile } from "node:child_process";
import { closeSync, constants, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, accessSync, type Stats } from "node:fs";
import { basename, extname, isAbsolute, join, posix } from "node:path";

export const TEXT_MAX = 200 * 1024;
export const IMAGE_MAX = 5 * 1024 * 1024;
export const LIST_MAX = 2000;

// ================= Private: name only =================
// (checked on the path asked for AND where it really leads, so a link can't open a private file)
const PRIVATE_PATHS = [
  /^\/etc\/nova-agent(\/|$)/,
  /^\/srv\/nova\/secrets\.env$/,
  /^\/etc\/(shadow|gshadow)-?$/,
  /^\/etc\/ssh\/ssh_host_[^/]*key$/,
  /^\/proc\/(\d+|self|thread-self)\/(environ|mem|auxv|pagemap|syscall|stack)$/,
  /^\/proc\/(\d+|self|thread-self)\/task\/\d+\/(environ|mem)$/,
  /^\/proc\/(kcore|kmsg|kallsyms)$/,
  /\/\.ssh(\/|$)/,
  /\/\.gnupg(\/|$)/,
  /\/\.claude\/\.credentials[^/]*$/,
  /\/\.claude\.json(\.backup)?$/,
  /\/\.config\/gh\/hosts\.yml$/,
  /\/\.aws\/credentials$/,
  /\/\.docker\/config\.json$/,
];
const PRIVATE_NAMES = [
  /\.env$/i, /^\.env(\..*)?$/i, /^\.dev\.vars$/i, /\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i, /secret/i, /token/i, /credential/i, /password/i, /private/i,
  /^\.netrc$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.git-credentials$/i, /^\.htpasswd$/i, /^authorized_keys/i, /^known_hosts/i,
  /^shadow-?$/, /^gshadow-?$/,
];
export function isPrivate(path: string): boolean {
  const p = posix.normalize(path);
  const name = basename(p);
  return PRIVATE_PATHS.some((re) => re.test(p)) || PRIVATE_NAMES.some((re) => re.test(name));
}

// ================= Paths =================
export class PathError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
// An absolute path, tidied: no NUL, no "..", at most 4096 long. Then where it really leads.
export function cleanPath(raw: unknown): string {
  const s = String(raw ?? "/").trim() || "/";
  if (s.length > 4096 || s.includes("\0")) throw new PathError("That isn't a path.");
  if (!isAbsolute(s)) throw new PathError("Paths start at / (the top of the VPS).");
  if (s.split("/").includes("..")) throw new PathError("“..” isn't allowed: open the folder above instead.");
  return posix.normalize(s).replace(/(.)\/+$/, "$1");
}
function realOf(path: string): string {
  try {
    return realpathSync(path);
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") throw new PathError("That isn't there (any more).", 404);
    if (err?.code === "EACCES" || err?.code === "EPERM") throw new PathError("Only root can see this.", 403);
    throw new PathError("Couldn't open that.", 400);
  }
}
const canRead = (path: string, folder: boolean): boolean => {
  try {
    accessSync(path, folder ? constants.R_OK | constants.X_OK : constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

// ---- Owners: user names from /etc/passwd ----
let users: Map<number, string> | null = null;
let usersAt = 0;
function owner(uid: number): string {
  if (!users || Date.now() - usersAt > 10 * 60_000) {
    users = new Map();
    usersAt = Date.now();
    try {
      for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
        const [name, , id] = line.split(":");
        if (name && id && /^\d+$/.test(id)) users.set(Number(id), name);
      }
    } catch {}
  }
  return users.get(uid) || String(uid);
}

// ================= A folder =================
export interface Entry { name: string; kind: "folder" | "file" | "link" | "other"; size: number | null; modified: string | null; owner: string; locked: boolean; private: boolean; target?: string; to?: "folder" | "file" | "other" }
export function listFolder(raw: unknown, max = LIST_MAX) {
  const path = cleanPath(raw);
  const real = realOf(path);
  let st: Stats;
  try {
    st = statSync(real);
  } catch {
    throw new PathError("Only root can see this.", 403);
  }
  if (!st.isDirectory()) throw new PathError("That's a file, not a folder.", 400);
  if (!canRead(real, true)) return { path, real, locked: true, entries: [] as Entry[], total: 0, capped: false };
  let names: string[];
  try {
    names = readdirSync(real);
  } catch {
    return { path, real, locked: true, entries: [] as Entry[], total: 0, capped: false };
  }
  const total = names.length;
  names.sort((a, b) => a.localeCompare(b));
  const entries: Entry[] = [];
  for (const name of names.slice(0, max)) {
    const full = join(real, name);
    let l: Stats;
    try {
      l = lstatSync(full);
    } catch {
      entries.push({ name, kind: "other", size: null, modified: null, owner: "", locked: true, private: isPrivate(full) });
      continue;
    }
    const e: Entry = {
      name,
      kind: l.isDirectory() ? "folder" : l.isFile() ? "file" : l.isSymbolicLink() ? "link" : "other",
      size: l.isFile() ? l.size : null,
      modified: Number.isFinite(l.mtimeMs) ? new Date(l.mtimeMs).toISOString() : null,
      owner: owner(l.uid),
      locked: false,
      private: isPrivate(full),
    };
    if (e.kind === "link") {
      try {
        const to = realpathSync(full);
        const t = statSync(to);
        e.to = t.isDirectory() ? "folder" : t.isFile() ? "file" : "other";
        e.target = to;
        e.private = e.private || isPrivate(to);
        e.locked = !canRead(to, e.to === "folder");
      } catch {
        e.to = "other";
        e.locked = true;
      }
    } else if (e.kind === "folder") e.locked = !canRead(full, true);
    else if (e.kind === "file") e.locked = !canRead(full, false);
    entries.push(e);
  }
  return { path, real, locked: false, entries, total, capped: total > max };
}

// ================= A file =================
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif", ".bmp": "image/bmp" };
export function imageType(path: string): string | null {
  return IMAGE_TYPES[extname(path).toLowerCase()] || null;
}
// Its first bytes only (never more than asked), so a huge file or a /proc file can't hold things up
function readStart(path: string, max: number): { bytes: Buffer; more: boolean } {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const buf = Buffer.alloc(max + 1);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, null);
      if (n <= 0) break;
      got += n;
    }
    return { bytes: buf.subarray(0, Math.min(got, max)), more: got > max };
  } finally {
    closeSync(fd);
  }
}
function fileFor(raw: unknown) {
  const path = cleanPath(raw);
  if (isPrivate(path)) return { path, real: path, hidden: true as const };
  const real = realOf(path);
  if (isPrivate(real)) return { path, real, hidden: true as const };
  let st: Stats;
  try {
    st = statSync(real);
  } catch {
    throw new PathError("Only root can see this.", 403);
  }
  if (st.isDirectory()) throw new PathError("That's a folder.", 400);
  // (devices, pipes and sockets are never read: one could wait forever)
  if (!st.isFile()) throw new PathError("That isn't an ordinary file, so it isn't opened.", 400);
  if (!canRead(real, false)) throw new PathError("Only root can see this.", 403);
  return { path, real, hidden: false as const, st };
}
export function readTextFile(raw: unknown, secrets: string[], redactFn: (t: string, s: string[]) => string, max = TEXT_MAX) {
  const f = fileFor(raw);
  if (f.hidden) return { path: f.path, kind: "hidden" as const, message: "Hidden: private. Only its name is shown." };
  const image = imageType(f.real);
  if (image) return { path: f.path, kind: "image" as const, type: image, size: f.st.size, tooBig: f.st.size > IMAGE_MAX, modified: new Date(f.st.mtimeMs).toISOString() };
  const { bytes, more } = readStart(f.real, max);
  if (bytes.subarray(0, 8192).includes(0)) return { path: f.path, kind: "binary" as const, size: f.st.size, modified: new Date(f.st.mtimeMs).toISOString(), message: "A binary file (not text), so it isn't shown." };
  return {
    path: f.path,
    kind: "text" as const,
    size: f.st.size,
    modified: new Date(f.st.mtimeMs).toISOString(),
    cut: more || f.st.size > max,
    language: languageOf(f.real),
    text: redactFn(bytes.toString("utf8"), secrets),
  };
}
export function readImage(raw: unknown, max = IMAGE_MAX): { type: string; bytes: Buffer } {
  const f = fileFor(raw);
  if (f.hidden) throw new PathError("Hidden: private.", 403);
  const type = imageType(f.real);
  if (!type) throw new PathError("That isn't a picture.", 400);
  if (f.st.size > max) throw new PathError("That picture is too big to show here (over 5 MB).", 413);
  return { type, bytes: readStart(f.real, max).bytes };
}
const LANGS: [RegExp, string][] = [
  [/\.(m?[jt]sx?|cjs|mjs)$/i, "js"], [/\.json(c|5)?$|\.webmanifest$/i, "json"], [/\.(sh|bash|zsh)$|(^|\/)\.(bashrc|profile|zshrc)$/i, "sh"],
  [/\.(md|markdown)$/i, "md"], [/\.css$/i, "css"], [/\.(html?|svg|xml)$/i, "html"], [/\.(ya?ml)$/i, "yaml"],
  [/\.(ini|conf|cfg|toml|service|timer|socket|target|mount|network)$|Caddyfile$|(^|\/)(passwd|group|hosts|fstab|crontab)$/i, "conf"],
  [/\.(py)$/i, "py"], [/\.(log|out)$/i, "log"], [/\.(sql)$/i, "sql"],
];
export function languageOf(path: string): string {
  return (LANGS.find(([re]) => re.test(path)) || [, "text"])[1] as string;
}

// ================= Programs (processes) =================
type ReadText = (f: string) => string | null;
const readText: ReadText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
};
export interface Proc { pid: number; name: string; user: string; group: string; cpu: number; memory: number; started: string | null; command: string }
const TICKS = 100; // (Linux's clock ticks a second: USER_HZ)
const PAGE = 4096;
export function groupOf(user: string, name: string, command: string): string {
  const c = `${name} ${command}`.toLowerCase();
  if (/\bclaude\b|@anthropic-ai|claude-code/.test(c)) return "Claude";
  if (user === "nova" || /wrangler|workerd|miniflare|desk-status/.test(c)) return "Nova Bot";
  if (user === "nova-agent") return "Nova Agent";
  if (/caddy|postfix|opendkim|nova-mail|master|qmgr|pickup|smtpd/.test(c) || ["caddy", "postfix", "opendkim"].includes(user)) return "web";
  return "system";
}
export class ProcSampler {
  private prev = new Map<number, number>();
  private prevAt = 0;
  constructor(private read: ReadText = readText, private list: () => string[] = () => readdirSync("/proc"), private now: () => number = Date.now) {}
  snapshot(secrets: string[], redactFn: (t: string, s: string[]) => string, max = 600) {
    const stat = this.read("/proc/stat") || "";
    const btime = Number((stat.match(/^btime\s+(\d+)/m) || [])[1] || 0);
    const total = Number((this.read("/proc/meminfo") || "").match(/^MemTotal:\s+(\d+)/m)?.[1] || 0) * 1024;
    const upSecs = Number((this.read("/proc/uptime") || "0").split(" ")[0]) || 0;
    const now = this.now();
    const elapsed = this.prevAt ? (now - this.prevAt) / 1000 : 0;
    const seen = new Map<number, number>();
    const procs: Proc[] = [];
    for (const d of this.list()) {
      if (!/^\d+$/.test(d)) continue;
      const pid = Number(d);
      const s = this.read(`/proc/${pid}/stat`);
      if (!s) continue;
      const close = s.lastIndexOf(")");
      const name = s.slice(s.indexOf("(") + 1, close);
      const f = s.slice(close + 2).split(" "); // f[0] = state (field 3)
      const ticks = Number(f[11]) + Number(f[12]); // utime + stime (fields 14, 15)
      const startTicks = Number(f[19]); // field 22
      const rssPages = Number(f[21]); // field 24
      seen.set(pid, ticks);
      let cpu = 0;
      const before = this.prev.get(pid);
      if (elapsed > 0.2 && before !== undefined) cpu = ((ticks - before) / TICKS / elapsed) * 100;
      else {
        const life = upSecs - startTicks / TICKS;
        cpu = life > 1 ? (ticks / TICKS / life) * 100 : 0;
      }
      const uid = Number((this.read(`/proc/${pid}/status`) || "").match(/^Uid:\s+(\d+)/m)?.[1] ?? -1);
      const user = uid >= 0 ? owner(uid) : "?";
      const raw = (this.read(`/proc/${pid}/cmdline`) || "").replace(/\0+$/, "").replace(/\0/g, " ");
      const command = redactFn(raw || `[${name}]`, secrets).slice(0, 400);
      procs.push({
        pid,
        name: redactFn(name, secrets).slice(0, 60),
        user,
        group: groupOf(user, name, raw),
        cpu: Math.round(Math.max(0, cpu) * 10) / 10,
        memory: Math.max(0, rssPages) * PAGE,
        started: btime ? new Date((btime + startTicks / TICKS) * 1000).toISOString() : null,
        command,
      });
      if (procs.length >= max) break;
    }
    this.prev = seen;
    this.prevAt = now;
    procs.sort((a, b) => b.cpu - a.cpu || b.memory - a.memory);
    const groups: Record<string, { count: number; cpu: number; memory: number }> = {};
    for (const p of procs) {
      const g = (groups[p.group] ||= { count: 0, cpu: 0, memory: 0 });
      g.count++;
      g.cpu = Math.round((g.cpu + p.cpu) * 10) / 10;
      g.memory += p.memory;
    }
    return { at: new Date(now).toISOString(), total: procs.length, memoryTotal: total, groups, procs };
  }
}

// ================= Disk use by folder =================
// du one level down, slowly and politely (nice, idle I/O), one at a time, kept 10 minutes. A request
// never waits for it: it says "measuring" and the page asks again.
type Run = (cmd: string, args: string[], timeoutMs: number) => Promise<{ ok: boolean; out: string }>;
const runDu: Run = (cmd, args, timeoutMs) =>
  new Promise((resolve) => execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout) => resolve({ ok: !err, out: String(stdout || "") })));
export interface DiskResult { path: string; at: string; total: number; folders: { name: string; path: string; size: number; private: boolean }[]; partial: boolean }
export class DiskSizes {
  private kept = new Map<string, { at: number; result: DiskResult }>();
  private queue: string[] = [];
  private running: string | null = null;
  constructor(private run: Run = runDu, private now: () => number = Date.now, private keepMs = 10 * 60_000) {}
  ask(raw: unknown): { path: string; result: DiskResult | null; measuring: boolean } {
    const path = cleanPath(raw);
    const real = realOf(path);
    let st: Stats;
    try {
      st = statSync(real);
    } catch {
      throw new PathError("Only root can see this.", 403);
    }
    if (!st.isDirectory()) throw new PathError("That's a file, not a folder.", 400);
    const k = this.kept.get(real);
    const fresh = k && this.now() - k.at < this.keepMs;
    if (!fresh && this.running !== real && !this.queue.includes(real)) {
      if (this.queue.length >= 6) this.queue.shift();
      this.queue.push(real);
      void this.next();
    }
    return { path, result: k ? { ...k.result, path } : null, measuring: !fresh };
  }
  private async next(): Promise<void> {
    if (this.running || !this.queue.length) return;
    const dir = this.queue.shift() as string;
    this.running = dir;
    try {
      const r = await this.run("nice", ["-n", "19", "ionice", "-c", "3", "du", "-x", "-b", "--max-depth=1", dir], 180_000);
      this.kept.set(dir, { at: this.now(), result: parseDu(dir, r.out, !r.ok, this.now()) });
    } finally {
      this.running = null;
      void this.next();
    }
  }
}
export function parseDu(dir: string, out: string, partial: boolean, now = Date.now()): DiskResult {
  let total = 0;
  const folders: DiskResult["folders"] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(\d+)\t(.+)$/);
    if (!m) continue;
    const size = Number(m[1]);
    if (m[2] === dir) total = size;
    else folders.push({ name: basename(m[2]), path: m[2], size, private: isPrivate(m[2]) });
  }
  folders.sort((a, b) => b.size - a.size);
  return { path: dir, at: new Date(now).toISOString(), total, folders: folders.slice(0, 60), partial };
}
