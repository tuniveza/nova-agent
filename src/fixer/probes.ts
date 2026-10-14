// The scripted checks: quick, plain checks that need no AI, run with every hourly check (and on
// their own from the Fixer's Health tab: "Run the quick checks", about a minute). Each one says
// pass or fail, and why. A fail becomes a problem like any other (rules.ts mergeIssues):
//   - area "checks": something code can fix (an address that's gone, a Manual link that's broken,
//     Nova Agent's own pages and data not answering), so a fix can be prepared for it
//   - area "server": the server itself (services, timed jobs, memory, mail, the mail records,
//     the status page's parts, the database, bookings); a code change can't fix those, so the Fixer
//     only tells admins (like health problems), never prepares a fix
// A check that fails is tried once more a little later before it counts (a moment's blip isn't a
// problem). Nothing here changes anything: every request only reads, and to Nova Agent it carries
// the sweep's header (sweep-guard.ts), so it couldn't change anything even if it tried.
//
// Groups: Addresses (every address in All addresses, web/shared/addresses.js), Nova Agent (its
// pages and data), Status page (each part of /status.json), Bookings (the booking card opens and
// has free times), Server (services, timed jobs, memory, load, the mail queue), Mail records (SPF,
// DKIM, DMARC), Data (Nova Agent's database), Manual (every link to a Nova page in the Manual).

import { promises as dnsPromises } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import type { Finding } from "./rules";
import type { Run } from "./runner";
import { SWEEP_HEADER } from "./sweep-guard";

export type ProbeArea = "checks" | "server";
export interface ProbeResult {
  group: string;
  name: string;
  ok: boolean;
  detail: string; // why it failed, or what it saw
  severity: "serious" | "minor"; // (when it fails)
  area: ProbeArea;
  ms: number;
}
export interface Probe {
  group: string;
  name: string;
  area: ProbeArea;
  severity: "serious" | "minor";
  // Throws (or returns { fail }) when it fails; returns what it saw when it passes
  run: () => Promise<string | { fail: string; severity?: "serious" | "minor" }>;
}
export interface ProbeDeps {
  fetch: typeof fetch;
  run: Run;
  naDir: string; // Nova Agent's code (for the address list and the Manual)
  dataDir: string; // Nova Agent's data (for its database)
  pcBase: string; // Nova Agent here: http://127.0.0.1:4545
  onServer: boolean; // on the VPS: its services, timers and mail queue are checked too
  resolveTxt?: (name: string) => Promise<string[][]>;
  resolve4?: (name: string) => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  retryAfterMs?: number;
}

const TIMEOUT = 15_000;
// An address answers: a page or file (2xx), a redirect, a sign-in (401/403) or "only posts here" (405)
export const answers = (status: number) => (status >= 200 && status < 400) || status === 401 || status === 403 || status === 405;

// The address list, as Portal and the Manual show it
export function readAddresses(naDir: string): { base: string; items: { name: string; url: string; group: string }[] } {
  const box: { window: any } = { window: {} };
  vm.runInNewContext(readFileSync(join(naDir, "web/shared/addresses.js"), "utf8"), box);
  const a = box.window.NovaAddresses;
  return { base: a.base, items: a.list(true).flatMap((g: any) => g.items.filter((i: any) => i.url).map((i: any) => ({ name: i.name, url: i.url, group: g.title }))) };
}

// The Manual's links to Nova's own pages (other sites aren't checked: they come and go)
export function manualLinks(manualJs: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of manualJs.matchAll(/href=\\?"([^"\\]+)\\?"/g)) {
    let href = m[1].replace(/&amp;/g, "&");
    if (href.startsWith(base)) href = href.slice(base.length) || "/";
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    out.add(href.split("#")[0] || "/");
  }
  return [...out].filter((h) => h !== "/").sort();
}

// "Mail queue is empty" / "-- 12 Kbytes in 3 Requests."
export function mailQueueCount(out: string): number | null {
  if (/queue is empty/i.test(out)) return 0;
  const m = out.match(/in (\d+) Requests?/i);
  return m ? Number(m[1]) : null;
}

// systemd's "Wed 2026-10-14 01:27:00 UTC" (or "n/a" / empty)
export function systemdTime(value: string): number | null {
  const m = value.trim().match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?: (UTC))?/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? t : null;
}

const fail = (why: string, severity?: "serious" | "minor") => ({ fail: why, ...(severity ? { severity } : {}) });

export function buildProbes(d: ProbeDeps): Probe[] {
  const probes: Probe[] = [];
  const get = async (url: string, init: RequestInit = {}) => d.fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT), ...init });
  let base = "https://nova.novacane.co.uk";

  // ---- Addresses ----
  let addresses: ReturnType<typeof readAddresses> | null = null;
  try {
    addresses = readAddresses(d.naDir);
    base = addresses.base;
  } catch (err) {
    probes.push({ group: "Addresses", name: "The address list", area: "checks", severity: "minor", run: async () => fail(`web/shared/addresses.js can't be read: ${(err as Error).message}`) });
  }
  for (const a of addresses?.items || []) {
    probes.push({
      group: "Addresses",
      name: a.name,
      area: "checks",
      severity: "serious",
      run: async () => {
        const res = await get(a.url, { headers: { accept: "text/html" } });
        return answers(res.status) ? `${res.status}` : fail(`${a.url} answered ${res.status}`);
      },
    });
  }

  // ---- Nova Agent: its pages and data, here ----
  const local: [string, string, boolean][] = [
    ["Version", "/app-version", true],
    ["Status", "/status", true],
    ["Quests", "/quests/state", true],
    ["Calendar's data", "/calendar-api/data", true],
    ["Boards", "/board-api/boards", true],
    ["Nova Agent page", "/agent/", false],
    ["Portal page", "/portal/", false],
    ["Calendar page", "/calendar/", false],
    ["Notes page", "/notes/", false],
    ["Board page", "/board/", false],
    ["Console page", "/console/", false],
    ["Index page", "/app/memory/", false],
    ["Observatory page", "/observatory/", false],
    ["Fixer page", "/fixer/", false],
  ];
  for (const [name, path, json] of local) {
    probes.push({
      group: "Nova Agent",
      name,
      area: "checks",
      severity: "serious",
      run: async () => {
        const res = await get(d.pcBase + path, { headers: { [SWEEP_HEADER]: "1", accept: json ? "application/json" : "text/html" } });
        if (!res.ok) return fail(`${path} answered ${res.status}`);
        const body = await res.text();
        if (json) {
          try {
            JSON.parse(body);
          } catch {
            return fail(`${path} didn't answer with data`);
          }
        } else if (!/<html|<!doctype/i.test(body)) return fail(`${path} isn't a page`);
        return `${res.status}, ${Math.round(body.length / 1024)} KB`;
      },
    });
  }

  // ---- The status page: each part ----
  probes.push({
    group: "Status page",
    name: "Every part",
    area: "server",
    severity: "minor",
    run: async () => {
      const res = await get(`${base}/status.json`, { headers: { accept: "application/json", "cache-control": "no-cache" } });
      if (!res.ok) return fail(`/status.json answered ${res.status}`, "serious");
      const s = (await res.json()) as { parts?: { id: string; name: string; state: string; text: string }[] };
      const bad = (s.parts || []).filter((p) => p.state !== "green");
      if (!bad.length) return `${(s.parts || []).length} parts green`;
      return fail(bad.map((p) => `${p.name} (${p.state}): ${p.text}`).join("\n"), bad.some((p) => p.state === "red") ? "serious" : "minor");
    },
  });

  // ---- Bookings: the website's booking card opens and has free times ----
  probes.push({
    group: "Bookings",
    name: "Booking card and free times",
    area: "server",
    severity: "serious",
    run: async () => {
      const post = async (path: string, body: unknown) => {
        const res = await get(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://novacane.co.uk" }, body: JSON.stringify(body) });
        return (await res.json().catch(() => ({}))) as any;
      };
      const open = await post("/booking-form/open", {});
      if (!open?.form) return fail("the booking card didn't open");
      const types = open.form.sessions || open.form.types || open.form.sessionTypes || [];
      if (!types.length) return fail("the booking card has no session types", "minor");
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + 2 * 864e5));
      const times = await post("/booking-form/times", { session_type_id: types[0].id, date });
      if (!Array.isArray(times?.times) || /couldn't check/i.test(times?.message || "")) return fail(times?.message || "no free times answer");
      return `${types.length} session types; ${times.times.length} free times on ${date}`;
    },
  });

  // ---- The server: services, timed jobs, memory, load, the mail queue ----
  if (d.onServer) {
    const units = ["nova", "nova-agent", "nova-cron.timer", "nova-backup.timer", "nova-mail", "postfix", "opendkim", "caddy", "desk-status"];
    probes.push({
      group: "Server",
      name: "Services running",
      area: "server",
      severity: "serious",
      run: async () => {
        const r = await d.run("systemctl", ["is-active", ...units], { cwd: "/", timeoutMs: TIMEOUT });
        const states = r.out.trim().split("\n");
        const down = units.map((u, i) => `${u} (${states[i] || "?"})`).filter((_, i) => states[i] !== "active");
        return down.length ? fail(`not running: ${down.join(", ")}`) : `${units.length} running`;
      },
    });
    probes.push({
      group: "Server",
      name: "Every-minute jobs",
      area: "server",
      severity: "serious",
      run: async () => {
        const r = await d.run("systemctl", ["show", "nova-cron.timer", "nova-cron.service", "-p", "LastTriggerUSec", "-p", "Result"], { cwd: "/", timeoutMs: TIMEOUT });
        const last = systemdTime(r.out.match(/LastTriggerUSec=(.*)/)?.[1] || "");
        const results = [...r.out.matchAll(/Result=(\S+)/g)].map((m) => m[1]);
        if (!last) return fail("they haven't run");
        const mins = Math.round((Date.now() - last) / 60_000);
        if (mins > 5) return fail(`last ran ${mins} minutes ago`);
        if (results.some((x) => x !== "success")) return fail(`the last run didn't finish well (${results.join(", ")})`, "minor");
        return `last ran ${mins < 1 ? "just now" : `${mins} min ago`}`;
      },
    });
    probes.push({
      group: "Server",
      name: "Nightly backup",
      area: "server",
      severity: "serious",
      run: async () => {
        const r = await d.run("systemctl", ["show", "nova-backup.service", "-p", "Result", "-p", "ExecMainExitTimestamp"], { cwd: "/", timeoutMs: TIMEOUT });
        const result = r.out.match(/Result=(\S+)/)?.[1] || "";
        const at = systemdTime(r.out.match(/ExecMainExitTimestamp=(.*)/)?.[1] || "");
        if (result && result !== "success") return fail(`the last backup didn't finish (${result})`);
        if (at && Date.now() - at > 26 * 3600_000) return fail(`the last backup was ${Math.round((Date.now() - at) / 3600_000)} hours ago`);
        return at ? `last one ${Math.round((Date.now() - at) / 3600_000)} h ago` : "fine (the status page has its time)";
      },
    });
    probes.push({
      group: "Server",
      name: "Mail queue",
      area: "server",
      severity: "minor",
      run: async () => {
        const r = await d.run("mailq", [], { cwd: "/", timeoutMs: TIMEOUT });
        const n = mailQueueCount(r.out);
        if (n === null) return fail(`couldn't read the mail queue (${r.out.trim().split("\n").pop() || r.code})`);
        if (n >= 50) return fail(`${n} emails waiting to go`, "serious");
        if (n >= 10) return fail(`${n} emails waiting to go`);
        return n ? `${n} waiting` : "empty";
      },
    });
  }
  probes.push({
    group: "Server",
    name: "Memory",
    area: "server",
    severity: "minor",
    run: async () => {
      let avail = freemem();
      try {
        const kb = Number(readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/)?.[1]);
        if (kb) avail = kb * 1024;
      } catch {}
      const share = avail / totalmem();
      const gb = (avail / 1024 ** 3).toFixed(1);
      if (share < 0.05) return fail(`only ${gb} GB memory free`, "serious");
      if (share < 0.1) return fail(`memory is getting low (${gb} GB free)`);
      return `${gb} GB free`;
    },
  });
  probes.push({
    group: "Server",
    name: "Load",
    area: "server",
    severity: "minor",
    run: async () => {
      const n = Math.max(1, cpus().length);
      const l = loadavg()[2];
      return l > n * 2 ? fail(`busy for a while (load ${l.toFixed(1)} on ${n} processors)`) : `load ${l.toFixed(1)} on ${n} processors`;
    },
  });

  // ---- The mail records: so emails from the studio's own mail server are trusted ----
  const txt = d.resolveTxt || ((n: string) => dnsPromises.resolveTxt(n));
  const a4 = d.resolve4 || ((n: string) => dnsPromises.resolve4(n));
  const host = new URL(base).hostname; // nova.novacane.co.uk
  const domain = host.split(".").slice(1).join("."); // novacane.co.uk
  const joined = async (name: string) => (await txt(name)).map((parts) => parts.join(""));
  probes.push({
    group: "Mail records",
    name: "SPF (who may send)",
    area: "server",
    severity: "serious",
    run: async () => {
      const [ip] = await a4(host);
      const spf = (await joined(domain)).find((r) => r.startsWith("v=spf1"));
      if (!spf) return fail(`${domain} has no SPF record`);
      return spf.includes(`ip4:${ip}`) ? `includes the server (${ip})` : fail(`SPF doesn't include the server's address (${ip})`);
    },
  });
  probes.push({
    group: "Mail records",
    name: "DKIM (the signature)",
    area: "server",
    severity: "serious",
    run: async () => ((await joined(`nova._domainkey.${domain}`)).some((r) => /p=[A-Za-z0-9+/]{40,}/.test(r)) ? "the key is there" : fail(`nova._domainkey.${domain} has no key`)),
  });
  probes.push({
    group: "Mail records",
    name: "DMARC",
    area: "server",
    severity: "minor",
    run: async () => ((await joined(`_dmarc.${domain}`)).some((r) => r.startsWith("v=DMARC1")) ? "there" : fail(`_dmarc.${domain} has no DMARC record`)),
  });

  // ---- Data: Nova Agent's database ----
  const db = join(d.dataDir, "nova.db");
  if (existsSync(db)) {
    probes.push({
      group: "Data",
      name: "Nova Agent's database",
      area: "server",
      severity: "serious",
      run: async () => {
        const { DatabaseSync } = await import("node:sqlite");
        const conn = new DatabaseSync(db, { readOnly: true });
        try {
          const rows = conn.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
          const said = rows.map((r) => r.quick_check);
          return said.length === 1 && said[0] === "ok" ? "intact" : fail(said.slice(0, 5).join("\n"));
        } finally {
          conn.close();
        }
      },
    });
  }

  // ---- The Manual: its links to Nova's own pages ----
  let links: string[] = [];
  try {
    links = manualLinks(readFileSync(join(d.naDir, "web/shared/manual-data.js"), "utf8"), base);
  } catch {}
  if (links.length) {
    probes.push({
      group: "Manual",
      name: "Links to Nova's pages",
      area: "checks",
      severity: "minor",
      run: async () => {
        const broken: string[] = [];
        for (const path of links.slice(0, 80)) {
          const res = await get(base + path, { headers: { accept: "text/html" } }).catch(() => null);
          if (!res || !answers(res.status)) broken.push(`${path} (${res ? res.status : "no answer"})`);
        }
        return broken.length ? fail(`broken: ${broken.join(", ")}`) : `${Math.min(links.length, 80)} links answer`;
      },
    });
  }
  return probes;
}

async function runOne(p: Probe): Promise<{ ok: boolean; detail: string; severity: "serious" | "minor" }> {
  try {
    const r = await p.run();
    if (typeof r === "string") return { ok: true, detail: r, severity: p.severity };
    return { ok: false, detail: r.fail, severity: r.severity || p.severity };
  } catch (err) {
    return { ok: false, detail: String((err as Error).message || err).split("\n")[0].slice(0, 300) || "it didn't answer", severity: p.severity };
  }
}

// Run every check (a few at a time); a fail is tried once more after a short wait
export async function runProbes(probes: Probe[], d: Pick<ProbeDeps, "sleep" | "retryAfterMs">): Promise<ProbeResult[]> {
  const out: ProbeResult[] = new Array(probes.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= probes.length) return;
      const p = probes[i];
      const started = Date.now();
      let r = await runOne(p);
      if (!r.ok) {
        await d.sleep(d.retryAfterMs ?? 15_000);
        r = await runOne(p);
      }
      out[i] = { group: p.group, name: p.name, area: p.area, ok: r.ok, detail: r.detail.slice(0, 1500), severity: r.severity, ms: Date.now() - started };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// The fails, as problems (one per check: the same check failing again is the same problem)
export function probeFindings(results: ProbeResult[]): Finding[] {
  return results
    .filter((r) => !r.ok)
    .map((r) => ({
      fingerprint: `${r.area}:${r.group}:${r.name}`.toLowerCase(),
      area: r.area,
      severity: r.severity,
      title: `${r.group}: ${r.name}: ${r.detail.split("\n")[0].slice(0, 200)}`,
      detail: r.detail,
    }));
}
