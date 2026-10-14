import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redact, registerComputerRoutes, type ExploreDeps } from "../src/computer";
import { cleanPath, DiskSizes, groupOf, isPrivate, listFolder, parseDu, PathError, ProcSampler, readImage, readTextFile } from "../src/computer-explore";

const RELAY = "http://online.nova-agent.invalid";
let root = "";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d5a2a10000000049454e44ae426082", "hex");

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "computer-explore-"));
  mkdirSync(join(root, "app/config"), { recursive: true });
  writeFileSync(join(root, "app/readme.md"), "# Hello\nANTHROPIC_API_KEY=sk-ant-api03-supersecretvalue\nthe value abc123secretvalue here\n");
  writeFileSync(join(root, "app/.env"), "AGENT_NOVA_KEY=topsecret\n");
  writeFileSync(join(root, "app/secrets.txt"), "x");
  writeFileSync(join(root, "app/my-token.json"), "{}");
  writeFileSync(join(root, "app/server.key"), "-----BEGIN PRIVATE KEY-----");
  writeFileSync(join(root, "app/pic.png"), PNG);
  writeFileSync(join(root, "app/data.bin"), Buffer.from([1, 2, 0, 3, 4]));
  writeFileSync(join(root, "app/big.log"), "x".repeat(300 * 1024));
  symlinkSync(join(root, "app/.env"), join(root, "app/innocent.txt"));
  mkdirSync(join(root, "locked"));
  writeFileSync(join(root, "locked/inside.txt"), "hidden");
  chmodSync(join(root, "locked"), 0o000);
  mkdirSync(join(root, "many"));
  for (let i = 0; i < 30; i++) writeFileSync(join(root, "many", `f${String(i).padStart(2, "0")}.txt`), "x");
});
afterAll(() => {
  chmodSync(join(root, "locked"), 0o700);
  rmSync(root, { recursive: true, force: true });
});

describe("Files: private things show their name only", () => {
  it("knows what's private", () => {
    for (const p of ["/etc/nova-agent/agent.env", "/srv/nova/secrets.env", "/x/.env", "/x/.env.local", "/x/prod.env", "/srv/nb/.dev.vars", "/srv/nova-agent/.claude/.credentials.json", "/home/a/.ssh/config", "/home/a/.ssh", "/root/id_ed25519.pub", "/etc/ssl/a.pem", "/x/server.key", "/etc/shadow", "/etc/gshadow-", "/x/client_secret.json", "/x/api-token", "/x/credentials.csv", "/proc/123/environ", "/proc/self/mem", "/proc/kcore", "/x/.netrc", "/x/.npmrc", "/x/.git-credentials"]) expect(isPrivate(p), p).toBe(true);
    for (const p of ["/srv/nova-agent/work/HANDOFF.md", "/etc/hostname", "/etc/passwd", "/srv/nova-agent/na/src/computer.ts", "/proc/123/status", "/var/log/syslog"]) expect(isPrivate(p), p).toBe(false);
  });
  it("lists them, but marked private", () => {
    const l = listFolder(join(root, "app"));
    const by = Object.fromEntries(l.entries.map((e) => [e.name, e]));
    expect(by[".env"].private).toBe(true);
    expect(by["secrets.txt"].private).toBe(true);
    expect(by["my-token.json"].private).toBe(true);
    expect(by["server.key"].private).toBe(true);
    expect(by["innocent.txt"]).toMatchObject({ kind: "link", private: true }); // it leads to .env
    expect(by["readme.md"].private).toBe(false);
  });
  it("never opens them, even through a link", () => {
    for (const name of [".env", "secrets.txt", "server.key", "innocent.txt"]) {
      const f: any = readTextFile(join(root, "app", name), [], redact);
      expect(f.kind, name).toBe("hidden");
      expect(JSON.stringify(f)).not.toMatch(/topsecret|PRIVATE KEY/);
    }
    expect(() => readImage(join(root, "app/.env"))).toThrow(PathError);
  });
  it("redacts every text file it shows", () => {
    const f: any = readTextFile(join(root, "app/readme.md"), ["abc123secretvalue"], redact);
    expect(f.kind).toBe("text");
    expect(f.language).toBe("md");
    expect(f.text).toContain("# Hello");
    expect(f.text).not.toContain("supersecretvalue");
    expect(f.text).not.toContain("abc123secretvalue");
  });
});

describe("Files: paths are what they look like", () => {
  it("refuses .., relative paths and NUL", () => {
    expect(() => cleanPath("/srv/../etc/shadow")).toThrow(/\.\./);
    expect(() => cleanPath("etc/passwd")).toThrow(PathError);
    expect(() => cleanPath("/etc/passwd\0.png")).toThrow(PathError);
    expect(() => cleanPath("/" + "a".repeat(5000))).toThrow(PathError);
    expect(cleanPath("/srv//nova-agent/")).toBe("/srv/nova-agent");
    expect(cleanPath("")).toBe("/");
  });
  it("says when a folder is locked, or not there", () => {
    expect(listFolder(join(root, "locked")).locked).toBe(process.getuid?.() === 0 ? false : true);
    const top = listFolder(root);
    expect(top.entries.find((e) => e.name === "locked")?.locked).toBe(process.getuid?.() === 0 ? false : true);
    expect(() => listFolder(join(root, "nope"))).toThrow(/isn't there/);
    expect(() => listFolder(join(root, "app/readme.md"))).toThrow(/a file/);
  });
  it("never reads devices or pipes", () => {
    expect(() => readTextFile("/dev/zero", [], redact)).toThrow(/ordinary file/);
  });
});

describe("Files: sizes are capped", () => {
  it("lists at most so many", () => {
    const l = listFolder(join(root, "many"), 10);
    expect(l.entries.length).toBe(10);
    expect(l.total).toBe(30);
    expect(l.capped).toBe(true);
  });
  it("reads only the start of a big text file", () => {
    const f: any = readTextFile(join(root, "app/big.log"), [], redact, 1024);
    expect(f.text.length).toBe(1024);
    expect(f.cut).toBe(true);
  });
  it("calls a binary file binary and shows a picture as a picture", () => {
    expect((readTextFile(join(root, "app/data.bin"), [], redact) as any).kind).toBe("binary");
    const p: any = readTextFile(join(root, "app/pic.png"), [], redact);
    expect(p).toMatchObject({ kind: "image", type: "image/png", tooBig: false });
    expect(readImage(join(root, "app/pic.png")).bytes.equals(PNG)).toBe(true);
    expect(() => readImage(join(root, "app/pic.png"), 10)).toThrow(/too big/);
  });
});

describe("Programs", () => {
  const files: Record<string, string> = {
    "/proc/stat": "cpu  1 2 3 4\nbtime 1760000000\n",
    "/proc/meminfo": "MemTotal: 6000000 kB\n",
    "/proc/uptime": "1000.00 900.00\n",
    "/proc/10/stat": "10 (node) S 1 10 10 0 -1 4194560 0 0 0 0 500 100 0 0 20 0 11 0 5000 0 25600 0 0",
    "/proc/10/status": "Name:\tnode\nUid:\t0\t0\t0\t0\n",
    "/proc/10/cmdline": "node\0server.js\0--key=AGENT_NOVA_KEY=hunter2hunter2\0",
    "/proc/11/stat": "11 (claude) S 1 11 11 0 -1 4194560 0 0 0 0 100 0 0 0 20 0 11 0 9000 0 5000 0 0",
    "/proc/11/status": "Name:\tclaude\nUid:\t0\n",
    "/proc/11/cmdline": "claude\0-p\0hello\0",
  };
  it("lists every program with its user, CPU, memory, start and a redacted command", () => {
    let now = 1_000_000;
    const s = new ProcSampler((f) => files[f] ?? null, () => ["10", "11", "self", "stat"], () => now);
    const first = s.snapshot(["hunter2hunter2"], redact);
    expect(first.procs.map((p) => p.pid).sort()).toEqual([10, 11]);
    const node = first.procs.find((p) => p.pid === 10)!;
    expect(node.memory).toBe(25600 * 4096);
    expect(node.command).not.toContain("hunter2hunter2");
    expect(node.started).toBe(new Date((1760000000 + 50) * 1000).toISOString());
    expect(first.procs.find((p) => p.pid === 11)!.group).toBe("Claude");
    // again 2 s later, 100 ticks more: 1 s of CPU in 2 s = 50%
    files["/proc/10/stat"] = files["/proc/10/stat"].replace(" 500 100 ", " 600 100 ");
    now += 2000;
    expect(s.snapshot([], redact).procs.find((p) => p.pid === 10)!.cpu).toBe(50);
  });
  it("puts programs in plain groups", () => {
    expect(groupOf("nova", "node", "wrangler dev")).toBe("Nova Bot");
    expect(groupOf("nova-agent", "node", "tsx src/visualizer/server.ts")).toBe("Nova Agent");
    expect(groupOf("nova-agent", "claude", "claude remote-control")).toBe("Claude");
    expect(groupOf("caddy", "caddy", "caddy run")).toBe("web");
    expect(groupOf("root", "systemd", "/sbin/init")).toBe("system");
  });
});

describe("Disk use by folder", () => {
  it("reads du's answer, biggest first", () => {
    const r = parseDu("/srv", "100\t/srv/a\n300\t/srv/b\n50\t/srv/.ssh\n450\t/srv\n", false);
    expect(r.total).toBe(450);
    expect(r.folders.map((f) => f.name)).toEqual(["b", "a", ".ssh"]);
    expect(r.folders[2].private).toBe(true);
  });
  it("never makes a request wait: measures in the background, politely, then keeps the answer", async () => {
    const calls: string[][] = [];
    let release: () => void = () => {};
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return new Promise<{ ok: boolean; out: string }>((resolve) => (release = () => resolve({ ok: true, out: `10\t${root}/app\n20\t${root}\n` })));
    };
    const d = new DiskSizes(run as any);
    const first = d.ask(root);
    expect(first).toMatchObject({ measuring: true, result: null });
    expect(calls[0].slice(0, 5)).toEqual(["nice", "-n", "19", "ionice", "-c"]);
    d.ask(root); // asked again while measuring: not run twice
    expect(calls.length).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 10));
    const done = d.ask(root);
    expect(done.measuring).toBe(false);
    expect(done.result?.total).toBe(20);
    expect(calls.length).toBe(1);
  });
});

describe("The views are for admins only", () => {
  const app = new Hono();
  const explore = (): ExploreDeps => ({ onServer: true, secrets: () => [], procs: new ProcSampler(() => null, () => []), disk: new DiskSizes(async () => ({ ok: true, out: "" })) });
  registerComputerRoutes(app, undefined, explore);
  const paths = ["/computer-api/files?path=/", "/computer-api/file?path=/etc/hostname", "/computer-api/image?path=/x.png", "/computer-api/procs", "/computer-api/disk?path=/"];
  it("refuses staff who aren't admins, and anyone unknown", async () => {
    for (const p of paths) {
      expect((await app.request(`${RELAY}${p}`, { headers: { "x-nova-online": "Sam", "x-nova-online-role": "staff" } })).status, p).toBe(403);
      expect((await app.request(`http://example.com${p}`)).status, p).toBe(403);
    }
  });
  it("answers an admin, and turns a bad path away plainly", async () => {
    const admin = { headers: { "x-nova-online": "Alex", "x-nova-online-role": "admin" } };
    const ok = await app.request(`${RELAY}/computer-api/files?path=${encodeURIComponent(join(root, "app"))}`, admin);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).entries.length).toBeGreaterThan(3);
    const bad = await app.request(`${RELAY}/computer-api/file?path=${encodeURIComponent("/srv/../etc/shadow")}`, admin);
    expect(bad.status).toBe(400);
    const hidden = await app.request(`${RELAY}/computer-api/file?path=${encodeURIComponent(join(root, "app/.env"))}`, admin);
    const body: any = await hidden.json();
    expect(body.file.kind).toBe("hidden");
    expect(JSON.stringify(body)).not.toContain("topsecret");
  });
});
