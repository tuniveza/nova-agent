// The health part of the Fixer's check: is everything up?
//   - Nova Agent's server on this PC answers (/app-version)
//   - the online link to Nova Bot is up (when Nova Agent has its key)
//   - Nova Bot answers (/app-version)
//   - the service hasn't been restarting by itself (systemd's restart count)
//   - there's disk space left
//   - every data/*.json file can be read

import { readdirSync, readFileSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import type { Finding } from "./rules";
import type { Run } from "./runner";

export interface HealthInput {
  pcBase: string; // http://127.0.0.1:4545
  workerUrl: string;
  dataDir: string;
  linkUp: () => boolean | null; // null: there's no link to check (no key)
  run: Run;
  restartsSeen: number;
  underSystemd: boolean;
  fetch?: typeof fetch;
}

const GiB = 1024 ** 3;

async function answers(f: typeof fetch, url: string): Promise<string> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(10_000), headers: { "Cache-Control": "no-cache" } });
    return res.ok ? "" : `answered ${res.status}`;
  } catch (err) {
    return (err as Error).message || "no answer";
  }
}

export async function healthFindings(input: HealthInput): Promise<{ findings: Finding[]; restarts: number }> {
  const f = input.fetch || fetch;
  const findings: Finding[] = [];
  const add = (key: string, severity: Finding["severity"], title: string, detail = "") => findings.push({ fingerprint: `health:${key}`, area: "health", severity, title, detail });

  const pc = await answers(f, `${input.pcBase}/app-version`);
  if (pc) add("pc-server", "serious", "Nova Agent's server on the PC isn't answering", pc);

  const link = input.linkUp();
  if (link === false) add("relay", "serious", "Nova Agent's online link to Nova Bot is down", "Online, Nova Agent can't reach the PC until it reconnects (it keeps trying by itself).");

  const bot = await answers(f, `${input.workerUrl.replace(/\/$/, "")}/app-version`);
  if (bot) add("nova-bot", "serious", "Nova Bot isn't answering", bot);

  let restarts = input.restartsSeen;
  if (input.underSystemd) {
    const r = await input.run("systemctl", ["--user", "show", "agent-nova.service", "-p", "NRestarts", "--value"], { cwd: homedir(), timeoutMs: 10_000 });
    const n = Number(r.out.trim());
    if (r.code === 0 && Number.isFinite(n)) {
      if (n > input.restartsSeen) add(`restarts-${n}`, "serious", `Nova Agent's service restarted by itself ${n - input.restartsSeen} time${n - input.restartsSeen === 1 ? "" : "s"} since the last check`, "It crashed and systemd started it again. The journal says why: journalctl --user -u agent-nova");
      restarts = n;
    }
  }

  try {
    const s = statfsSync(homedir());
    const free = s.bavail * s.bsize;
    const share = s.bavail / s.blocks;
    if (free < 2 * GiB || share < 0.05) add("disk-low", "serious", `Disk space is nearly gone (${(free / GiB).toFixed(1)} GB free)`);
    else if (share < 0.1) add("disk-getting-low", "minor", `Disk space is getting low (${(free / GiB).toFixed(1)} GB free, ${Math.round(share * 100)}%)`);
  } catch {}

  try {
    for (const name of readdirSync(input.dataDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        JSON.parse(readFileSync(input.dataDir + name, "utf8"));
      } catch (err) {
        add(`json-${name}`, "serious", `data/${name} can't be read`, (err as Error).message);
      }
    }
  } catch {}

  return { findings, restarts };
}

// What a test run, typecheck or audio measurement said, as findings (one per failing test file)
export function commandFindings(area: "tests" | "typecheck" | "audio", repo: "na" | "nb", code: number, out: string): Finding[] {
  if (code === 0) return [];
  const app = repo === "nb" ? "Nova Bot" : "Nova Agent";
  const tail = out.split("\n").filter((l) => l.trim()).slice(-40).join("\n");
  if (code === 124) return [{ fingerprint: `${area}:${repo}:timeout`, area, severity: "serious", title: `${app}: the ${area === "typecheck" ? "typecheck" : area} took too long and was stopped`, detail: tail }];
  if (area === "tests") {
    const files = [...new Set([...out.matchAll(/(?:FAIL|×|✗)\s+(\S+\.(?:spec|test)\.[jt]s)/g)].map((m) => m[1]))];
    if (files.length) return files.slice(0, 10).map((file) => ({ fingerprint: `tests:${repo}:${file}`, area, severity: "serious", title: `${app}: tests fail in ${file}`, detail: tail }));
    return [{ fingerprint: `tests:${repo}`, area, severity: "serious", title: `${app}: the tests fail`, detail: tail }];
  }
  if (area === "typecheck") {
    const files = [...new Set([...out.matchAll(/^(\S+\.ts)\(\d+,\d+\): error/gm)].map((m) => m[1]))];
    return (files.length ? files.slice(0, 10) : [""]).map((file) => ({ fingerprint: `typecheck:${repo}:${file}`, area, severity: "serious" as const, title: `${app}: the typecheck fails${file ? ` in ${file}` : ""}`, detail: tail }));
  }
  return [{ fingerprint: `audio:${repo}`, area, severity: "minor", title: "Sounds or music are louder than the calm rules allow", detail: tail }];
}
