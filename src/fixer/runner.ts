// Running a command for the Fixer: tests, typecheck, git, Claude Code, wrangler. Every command the
// Fixer runs goes through one function (Run), so tests can stand in for all of them and see exactly
// what would have run. A command that runs past its time is stopped, with everything it started.

import { spawn } from "node:child_process";

export interface RunResult {
  code: number; // 0 = it worked; 124 = stopped for taking too long
  out: string; // what it printed (the end, if it printed a lot)
}
export interface RunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  input?: string;
  // Start from a short list of harmless variables instead of everything Nova Agent has: Claude Code
  // and the tests never see Nova Agent's keys and passwords (from .env)
  clean?: boolean;
}

const SAFE_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_\w+|TERM|TZ|TMPDIR|XDG_\w+|DBUS_SESSION_BUS_ADDRESS|DISPLAY|WAYLAND_DISPLAY|NODE_EXTRA_CA_CERTS|NVM_\w+|PLAYWRIGHT_BROWSERS_PATH)$/;
export function cleanEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(base).filter(([k, v]) => SAFE_ENV.test(k) && typeof v === "string")) as Record<string, string>;
}
export type Run = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

const KEEP = 400_000;

export const runCommand: Run = (cmd, args, opts) =>
  new Promise((resolve) => {
    let out = "";
    const add = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > KEEP * 2) out = out.slice(-KEEP);
    };
    const env = { ...(opts.clean ? cleanEnv() : process.env), ...opts.env } as Record<string, string | undefined>;
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: env as NodeJS.ProcessEnv, detached: true, stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch (err) {
      return resolve({ code: 127, out: (err as Error).message });
    }
    let timedOut = false;
    const stop = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop("SIGTERM");
          setTimeout(() => stop("SIGKILL"), 5000).unref();
        }, opts.timeoutMs)
      : null;
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, out: out + (err as Error).message });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), out: out.length > KEEP ? out.slice(-KEEP) : out });
    });
  });
