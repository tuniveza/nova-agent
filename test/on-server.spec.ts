// Nova Agent on the server (NOVA_ON_SERVER=1; Nova Bot's vps/agent-switch.sh): only one copy runs
// (src/where.ts), + Shell is the server's shell (src/console.ts), the Fixer looks after the system
// service and Claude Code's sign-in there (src/fixer), and the watchdog has no desktop to tell.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../src/config";
import { commandFor, terminalProblem } from "../src/console";
import { claudeProblem } from "../src/fixer/service";
import { healthFindings } from "../src/fixer/health";
import { markRelayed } from "../src/person";
import { markServerHasIt, standDownReason, where } from "../src/where";

const saved = { onServer: config.onServer, key: config.agentNovaKey, marker: config.onServerMarker };
afterEach(() => {
  config.onServer = saved.onServer;
  config.agentNovaKey = saved.key;
  config.onServerMarker = saved.marker;
});
const tmp = () => mkdtempSync(join(tmpdir(), "on-server-"));

describe("only one Nova Agent runs", () => {
  it("a PC copy with the key stays off while the server has it; the server and keyless copies always run", () => {
    const dir = tmp();
    config.onServerMarker = join(dir, "nova", "agent-on-server");
    config.onServer = false;
    config.agentNovaKey = "k";
    expect(where()).toBe("pc");
    expect(standDownReason()).toBe("");
    markServerHasIt();
    expect(standDownReason()).toMatch(/runs on the server now/);
    config.agentNovaKey = "";
    expect(standDownReason()).toBe("");
    config.agentNovaKey = "k";
    config.onServer = true;
    expect(where()).toBe("server");
    expect(standDownReason()).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });

  it("the server never writes the PC's marker", () => {
    const dir = tmp();
    config.onServerMarker = join(dir, "agent-on-server");
    config.onServer = true;
    markServerHasIt();
    config.onServer = false;
    config.agentNovaKey = "k";
    expect(standDownReason()).toBe("");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Console on the server", () => {
  it("+ Shell is the server's shell; vps and vps-key aren't needed there", () => {
    expect((commandFor("shell", null, true) as any).title).toBe("Server");
    expect((commandFor("shell", null, false) as any).title).toBe("Studio PC");
    expect(commandFor("vps", { host: "vps.example.com", user: "root", port: 22 }, true)).toHaveProperty("error");
    expect(commandFor("vps-key", { host: "vps.example.com", user: "root", port: 22 }, true)).toHaveProperty("error");
    expect((commandFor("vps", { host: "vps.example.com", user: "root", port: 22 }, false) as any).file).toBe("ssh");
  });

  it("online, terminals stay refused, and the server says how to reach them (an ssh tunnel)", () => {
    config.onServer = true;
    const req = markRelayed(new Request("http://localhost:4545/console-api/term", { method: "POST", headers: { "X-Nova-Visualizer": "1" } }), { id: "ana", role: "admin" });
    expect(terminalProblem(req, { role: "admin" }, { write: true })).toMatch(/ssh -L 4545:localhost:4545/);
    expect(terminalProblem(new Request("http://nova.example:4545/console-api/state"), { role: "admin" })).toMatch(/the server itself/);
  });
});

describe("the Fixer on the server", () => {
  it("needs Claude Code installed and signed in there; the PC isn't asked", () => {
    const home = tmp();
    const bin = join(home, "claude");
    expect(claudeProblem(false, bin, home)).toBe("");
    expect(claudeProblem(true, bin, home)).toMatch(/isn't installed/);
    writeFileSync(bin, "");
    expect(claudeProblem(true, bin, home)).toMatch(/isn't signed in on the server/);
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the system service's restarts on the server, the user service's on the PC", async () => {
    const asked: string[] = [];
    const run = async (file: string, args: string[]) => {
      asked.push([file, ...args].join(" "));
      return { code: 0, out: "0" };
    };
    const ok = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const base = { pcBase: "http://pc.test", workerUrl: "https://bot.test", dataDir: tmp() + "/", linkUp: () => true, restartsSeen: 0, underSystemd: true, fetch: ok, run: run as any };
    await healthFindings({ ...base, onServer: true });
    await healthFindings({ ...base });
    expect(asked).toEqual(["systemctl show nova-agent.service -p NRestarts --value", "systemctl --user show agent-nova.service -p NRestarts --value"]);
  });
});
