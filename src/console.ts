// Console's side on the PC (web/console): real terminals, the VPS's address, and the recent log.
//
// Nova commands (status, quests, portal, google…) need nothing here: Console's page calls the
// same addresses every other panel uses, as the signed-in person, so they work online too.
//
// Real terminals are another matter: a shell on the studio PC, or ssh to the VPSdime server,
// is full control of a computer. So they only open when ALL of these hold:
//   - the request came straight to this computer, not through Nova Bot's relay (src/person.ts
//     marks relayed requests; online they're refused, and Nova Bot doesn't pass these addresses
//     on in the first place: they aren't in src/relay.ts's list),
//   - the address is this computer's own (localhost, 127.0.0.1 or ::1), and so is the page that
//     sent it (Origin), with Nova Agent's own page header (X-Nova-Visualizer), which other
//     websites can't add,
//   - the person is an admin.
// Each terminal gets a random token at birth; its output stream and its keys need it.
//
//   GET  /console-api/state               who's asking, whether terminals can open here, the VPS's address, open terminals
//   POST /console-api/vps                 { host, user, port } the VPS's address (data/console.json; never a password)
//   POST /console-api/term                { kind: "shell" | "vps" | "vps-key", cols, rows } → { id, token }
//   GET  /console-api/term/:id/stream?token=…   its output (server-sent events: "out", "exit")
//   POST /console-api/term/:id/input      { data } keys typed      (header X-Console-Token)
//   POST /console-api/term/:id/resize     { cols, rows }           (header X-Console-Token)
//   POST /console-api/term/:id/close                               (header X-Console-Token)
//   GET  /console-api/logs?n=…            the recent trace lines (admins)

import type { Hono } from "hono";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { config } from "./config";
import { isRelayed, personFor, type Person } from "./person";
import { getRecentEvents, trace } from "./trace";

// ===== The VPS's address =====

export interface VpsSettings {
  host: string;
  user: string;
  port: number;
}
const settingsFile = () => `${config.paths.dataDir}console.json`;

// The studio's VPSdime server (Computer), until another is set with `vps set`
export const DEFAULT_VPS: VpsSettings = { host: "185.185.126.195", user: "root", port: 22 };

export function readVps(): VpsSettings | null {
  try {
    if (!existsSync(settingsFile())) return DEFAULT_VPS;
    const v = JSON.parse(readFileSync(settingsFile(), "utf8"))?.vps;
    if (!v) return DEFAULT_VPS;
    const clean = cleanVps(v);
    return "error" in clean ? DEFAULT_VPS : clean;
  } catch {
    return DEFAULT_VPS;
  }
}

// A host name or IP address, a Unix user name and a port; nothing that could become an ssh option
export function cleanVps(input: unknown): VpsSettings | { error: string } {
  const v = (input || {}) as Record<string, unknown>;
  const host = String(v.host ?? "").trim();
  const user = String(v.user ?? "").trim();
  const port = Number(v.port ?? 22);
  const hostOk = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host) || /^\[?[0-9a-fA-F:]{2,39}\]?$/.test(host);
  if (!hostOk) return { error: "The VPS's address should be a name like vps.example.com or an IP address like 203.0.113.7." };
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user)) return { error: "The user should be a plain name, like root or tuniveza." };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "The port should be a number from 1 to 65535 (usually 22)." };
  return { host: host.replace(/^\[|\]$/g, ""), user, port };
}

export function saveVps(v: VpsSettings): void {
  let all: Record<string, unknown> = {};
  try {
    if (existsSync(settingsFile())) all = JSON.parse(readFileSync(settingsFile(), "utf8")) || {};
  } catch {}
  writeFileSync(settingsFile(), JSON.stringify({ ...all, vps: v }, null, 2) + "\n", { mode: 0o600 });
}

// ===== Who may open a real terminal =====

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Why a terminal can't open for this request ("" = it can)
export function terminalProblem(req: Request, person: Pick<Person, "role">, { write = false }: { write?: boolean } = {}): string {
  if (isRelayed(req)) return "Terminals only open on the studio computer itself, not online. Nova commands work everywhere.";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "Terminals only open on the studio computer itself.";
  }
  if (!LOCAL_HOSTS.has(url.hostname)) return "Terminals only open on the studio computer itself (at localhost).";
  const origin = req.headers.get("Origin");
  if (origin) {
    try {
      const o = new URL(origin);
      if (!LOCAL_HOSTS.has(o.hostname) || o.port !== url.port) return "Only Console's own page can open a terminal.";
    } catch {
      return "Only Console's own page can open a terminal.";
    }
  }
  if (write && req.headers.get("X-Nova-Visualizer") !== "1") return "Only Console's own page can open a terminal.";
  if (person.role !== "admin") return "Terminals are for admins.";
  return "";
}

// ===== The terminals =====

type Pty = {
  onData(cb: (d: string) => void): unknown;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): unknown;
  write(d: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
};
type Spawn = (file: string, args: string[], opts: Record<string, unknown>) => Pty;

let spawnPty: Spawn | null = null;
// node-pty, loaded when the first terminal opens (it has a native part; Nova Agent still runs without it)
function loadPty(): Spawn {
  if (spawnPty) return spawnPty;
  const require = createRequire(import.meta.url);
  const mod = require("node-pty") as { spawn: Spawn };
  spawnPty = mod.spawn;
  return spawnPty;
}
// (tests swap in a stand-in)
export function usePty(spawn: Spawn | null): void {
  spawnPty = spawn;
}

interface Term {
  id: string;
  token: string;
  kind: string;
  title: string;
  pty: Pty;
  backlog: string; // the last of what it printed, for a page that reconnects
  listeners: Set<(event: string, data: string) => void>;
  alone: ReturnType<typeof setTimeout> | null;
  exited: boolean;
  made: number;
}
const terms = new Map<string, Term>();
const MAX_TERMS = 8;
const BACKLOG = 200_000;
const IDLE_MS = 15 * 60_000; // a terminal nobody's watching closes after this

export function openTerminals() {
  return [...terms.values()].filter((t) => !t.exited).map((t) => ({ id: t.id, kind: t.kind, title: t.title, made: new Date(t.made).toISOString() }));
}

export function commandFor(kind: string, vps: VpsSettings | null): { file: string; args: string[]; title: string } | { error: string } {
  if (kind === "shell") {
    const shell = process.env.SHELL && /^\/[\w/.-]+$/.test(process.env.SHELL) ? process.env.SHELL : "/bin/bash";
    return { file: shell, args: ["-l"], title: "Studio PC" };
  }
  if (kind === "vps" || kind === "vps-key") {
    if (!vps) return { error: "The VPS's address isn't set yet. Type: vps set <address> <user> [port]" };
    const target = `${vps.user}@${vps.host}`;
    if (kind === "vps-key") {
      const key = `${homedir()}/.ssh/id_ed25519.pub`;
      return { file: "ssh-copy-id", args: ["-i", key, "-p", String(vps.port), target], title: "VPS key" };
    }
    return { file: "ssh", args: ["-p", String(vps.port), "-o", "ServerAliveInterval=30", target], title: `VPS ${vps.host}` };
  }
  return { error: "Which kind of terminal? shell, vps or vps-key." };
}

function startTerm(kind: string, cols: number, rows: number): { term: Term } | { error: string } {
  if (openTerminals().length >= MAX_TERMS) return { error: `There are already ${MAX_TERMS} terminals open. Close one first.` };
  const what = commandFor(kind, readVps());
  if ("error" in what) return what;
  let spawn: Spawn;
  try {
    spawn = loadPty();
  } catch {
    return { error: "Terminals need node-pty, which isn't built on this computer yet (see docs/apps/console/README.md)." };
  }
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;
  // Nova Agent's own secrets stay out of the terminal's environment
  for (const k of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k)) delete env[k];
  let pty: Pty;
  try {
    pty = spawn(what.file, what.args, { name: "xterm-256color", cols: clamp(cols, 20, 400, 100), rows: clamp(rows, 5, 200, 30), cwd: homedir(), env });
  } catch (err) {
    return { error: `Couldn't start it: ${(err as Error).message}` };
  }
  const term: Term = { id: randomBytes(6).toString("hex"), token: randomBytes(24).toString("hex"), kind, title: what.title, pty, backlog: "", listeners: new Set(), alone: null, exited: false, made: Date.now() };
  pty.onData((d) => {
    term.backlog = (term.backlog + d).slice(-BACKLOG);
    for (const l of term.listeners) l("out", d);
  });
  pty.onExit((e) => {
    term.exited = true;
    for (const l of term.listeners) l("exit", String(e.exitCode ?? 0));
    setTimeout(() => terms.delete(term.id), 60_000);
  });
  terms.set(term.id, term);
  watchAlone(term);
  trace("input", "info", `Console: opened a ${kind} terminal`);
  return { term };
}

function watchAlone(term: Term) {
  if (term.alone) clearTimeout(term.alone);
  term.alone = term.listeners.size ? null : setTimeout(() => closeTerm(term), IDLE_MS);
}

function closeTerm(term: Term) {
  if (!term.exited) {
    try {
      term.pty.kill();
    } catch {}
  }
  term.exited = true;
  terms.delete(term.id);
}

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function termFor(c: any, token: string): Term | null {
  const t = terms.get(c.req.param("id"));
  return t && token && sameToken(t.token, token) ? t : null;
}

// ===== The addresses =====

export function registerConsoleRoutes(app: Hono): void {
  app.get("/console-api/state", async (c) => {
    const person = await personFor(c.req.raw);
    const why = terminalProblem(c.req.raw, person);
    return c.json(
      {
        ok: true,
        me: { id: person.id, name: person.name, role: person.role, online: person.online },
        terminals: !why,
        why,
        vps: person.role === "admin" ? readVps() : null,
        open: why ? [] : openTerminals(),
        // Where Console opens on the studio computer itself, with its terminals
        localUrl: `http://localhost:${config.visualizerPort}/console/?here=1`,
      },
      200,
      { "Cache-Control": "no-store" }
    );
  });

  app.post("/console-api/vps", async (c) => {
    const person = await personFor(c.req.raw);
    const why = terminalProblem(c.req.raw, person, { write: true });
    if (why) return c.json({ ok: false, message: why }, 403);
    const clean = cleanVps(await c.req.json().catch(() => ({})));
    if ("error" in clean) return c.json({ ok: false, message: clean.error }, 400);
    saveVps(clean);
    return c.json({ ok: true, vps: clean });
  });

  app.post("/console-api/term", async (c) => {
    const person = await personFor(c.req.raw);
    const why = terminalProblem(c.req.raw, person, { write: true });
    if (why) return c.json({ ok: false, message: why }, 403);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const made = startTerm(String(body.kind || "shell"), Number(body.cols), Number(body.rows));
    if ("error" in made) return c.json({ ok: false, message: made.error }, 400);
    return c.json({ ok: true, id: made.term.id, token: made.term.token, kind: made.term.kind, title: made.term.title });
  });

  app.get("/console-api/term/:id/stream", async (c) => {
    const person = await personFor(c.req.raw);
    if (terminalProblem(c.req.raw, person)) return c.text("Not here", 403);
    const term = termFor(c, c.req.query("token") || "");
    if (!term) return c.text("No such terminal", 404);
    const enc = new TextEncoder();
    let send: (event: string, data: string) => void = () => {};
    let beat: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream({
      start(ctrl) {
        send = (event, data) => {
          try {
            ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {}
        };
        if (term.backlog) send("out", term.backlog);
        if (term.exited) send("exit", "0");
        term.listeners.add(send);
        watchAlone(term);
        beat = setInterval(() => {
          try {
            ctrl.enqueue(enc.encode(": still here\n\n"));
          } catch {}
        }, 20_000);
      },
      cancel() {
        term.listeners.delete(send);
        if (beat) clearInterval(beat);
        watchAlone(term);
      },
    });
    c.req.raw.signal?.addEventListener?.("abort", () => {
      term.listeners.delete(send);
      if (beat) clearInterval(beat);
      watchAlone(term);
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  });

  const withTerm = (handler: (term: Term, body: Record<string, unknown>) => Response | Promise<Response>) => async (c: any) => {
    const person = await personFor(c.req.raw);
    const why = terminalProblem(c.req.raw, person, { write: true });
    if (why) return c.json({ ok: false, message: why }, 403);
    const term = termFor(c, c.req.header("X-Console-Token") || "");
    if (!term) return c.json({ ok: false, message: "That terminal has closed." }, 404);
    return handler(term, (await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  };

  app.post(
    "/console-api/term/:id/input",
    withTerm((term, body) => {
      const data = typeof body.data === "string" ? body.data.slice(0, 64_000) : "";
      if (data && !term.exited) term.pty.write(data);
      return Response.json({ ok: true });
    })
  );
  app.post(
    "/console-api/term/:id/resize",
    withTerm((term, body) => {
      if (!term.exited) term.pty.resize(clamp(body.cols, 20, 400, 100), clamp(body.rows, 5, 200, 30));
      return Response.json({ ok: true });
    })
  );
  app.post(
    "/console-api/term/:id/close",
    withTerm((term) => {
      closeTerm(term);
      return Response.json({ ok: true });
    })
  );

  app.get("/console-api/logs", async (c) => {
    const person = await personFor(c.req.raw);
    if (person.role !== "admin") return c.json({ ok: false, message: "The log is for admins." }, 403);
    const n = clamp(c.req.query("n"), 1, 400, 40);
    const lines = getRecentEvents()
      .slice(-n)
      .map((e) => ({ time: e.time, part: e.part, level: e.level, message: e.message }));
    return c.json({ ok: true, lines }, 200, { "Cache-Control": "no-store" });
  });
}
