// The Fixer's scripted checks (src/fixer/probes.ts), in a pretend world: no real network, commands
// or DNS. The real address list and Manual are read, as the Fixer reads them.
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
// (a healthy world is a quiet machine too: the load check doesn't read the real server's load,
// which made this test fail whenever the machine running it was busy)
vi.mock("node:os", async (orig) => ({ ...(await orig<typeof import("node:os")>()), loadavg: () => [0.4, 0.4, 0.4] }));
import { answers, buildProbes, mailQueueCount, manualLinks, probeFindings, readAddresses, runProbes, systemdTime, type ProbeDeps } from "../src/fixer/probes";

const NA = join(__dirname, "..");

function world(over: Partial<ProbeDeps> & { status?: (url: string, init?: RequestInit) => number; body?: (url: string) => string; out?: (cmd: string, args: string[]) => string } = {}) {
  const asked: string[] = [];
  const deps: ProbeDeps = {
    fetch: (async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method || "GET"} ${url}`);
      const status = over.status ? over.status(url, init) : 200;
      const body = over.body ? over.body(url) : url.endsWith("/status.json") ? JSON.stringify({ parts: [{ id: "chat", name: "Website chat", state: "green", text: "ok" }] }) : url.includes("/booking-form/open") ? JSON.stringify({ form: { sessions: [{ id: 1 }] } }) : url.includes("/booking-form/times") ? JSON.stringify({ times: ["10:00"] }) : /\/(app-version|status|quests\/state|calendar-api\/data|board-api\/boards)$/.test(url) ? "{}" : "<!doctype html><html></html>";
      return new Response(body, { status });
    }) as typeof fetch,
    run: async (cmd, args) => ({ code: 0, out: over.out ? over.out(cmd, args) : cmd === "mailq" ? "Mail queue is empty" : args[0] === "is-active" ? args.slice(1).map(() => "active").join("\n") : `LastTriggerUSec=${new Date(Date.now() - 30_000).toUTCString().replace(/^\w+, (\d+) (\w+) (\d+) /, "Wed $3-10-14 ")}\nResult=success\nResult=success` }),
    naDir: NA,
    dataDir: "/nowhere/",
    pcBase: "http://pc.test",
    onServer: false,
    resolveTxt: async (name) => (name.startsWith("nova._domainkey") ? [["v=DKIM1; k=rsa; p=", "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0123456789"]] : name.startsWith("_dmarc") ? [["v=DMARC1; p=none"]] : [["v=spf1 include:_spf.google.com ip4:185.185.126.195 ~all"]]),
    resolve4: async () => ["185.185.126.195"],
    sleep: async () => {},
    retryAfterMs: 0,
    ...over,
  };
  return { deps, asked };
}

describe("the scripted checks", () => {
  it("reads every address in All addresses, and the Manual's links to Nova's pages", () => {
    const a = readAddresses(NA);
    expect(a.base).toBe("https://nova.novacane.co.uk");
    expect(a.items.map((i) => i.name)).toEqual(expect.arrayContaining(["Nova Agent", "Status", "Chat script"]));
    expect(manualLinks(`<a href=\\"https://nova.novacane.co.uk/agent/\\">x</a> <a href="/status#top">s</a> <a href="https://example.com/x">e</a> <a href="//cdn.x/y">c</a>`, a.base)).toEqual(["/agent/", "/status"]);
  });

  it("understands what answering means, the mail queue and systemd's times", () => {
    expect([200, 302, 401, 403, 405].every(answers)).toBe(true);
    expect([404, 500, 502, 0].some(answers)).toBe(false);
    expect(mailQueueCount("Mail queue is empty")).toBe(0);
    expect(mailQueueCount("-- 12 Kbytes in 3 Requests.")).toBe(3);
    expect(mailQueueCount("postqueue: fatal")).toBeNull();
    expect(systemdTime("Wed 2026-10-14 01:27:00 UTC")).toBe(Date.parse("2026-10-14T01:27:00Z"));
    expect(systemdTime("n/a")).toBeNull();
  });

  it("all pass in a healthy world, and nothing it asks could change anything", async () => {
    const w = world();
    const results = await runProbes(buildProbes(w.deps), w.deps);
    const failed = results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
    expect(new Set(results.map((r) => r.group))).toEqual(new Set(["Addresses", "Nova Agent", "Status page", "Bookings", "Server", "Mail records", "Manual"]));
    // (only reads: the two booking-card asks are the website's own, and change nothing)
    expect(w.asked.filter((a) => !a.startsWith("GET ")).every((a) => /\/booking-form\/(open|times)$/.test(a))).toBe(true);
    expect(probeFindings(results)).toEqual([]);
  });

  it("on the server it checks the services, timed jobs, backups and mail queue too", async () => {
    const w = world({ onServer: true, out: (cmd, args) => (cmd === "mailq" ? "-- 40 Kbytes in 12 Requests." : args[0] === "is-active" ? args.slice(1).map((u) => (u === "postfix" ? "failed" : "active")).join("\n") : args.includes("nova-backup.service") ? "Result=success\nExecMainExitTimestamp=Wed 2020-01-01 03:30:00 UTC" : "LastTriggerUSec=Wed 2020-01-01 00:00:00 UTC\nResult=success") });
    const results = await runProbes(buildProbes(w.deps), w.deps);
    const by = (name: string) => results.find((r) => r.name === name)!;
    expect(by("Services running")).toMatchObject({ ok: false, area: "server", severity: "serious" });
    expect(by("Services running").detail).toMatch(/postfix \(failed\)/);
    expect(by("Every-minute jobs")).toMatchObject({ ok: false });
    expect(by("Nightly backup").detail).toMatch(/hours ago/);
    expect(by("Mail queue")).toMatchObject({ ok: false, severity: "minor", detail: "12 emails waiting to go" });
  });

  it("says why when something fails: an address gone, a page that isn't a page, a status part, the mail records", async () => {
    const w = world({
      status: (url) => (url.endsWith("/privacy") ? 404 : 200),
      body: (url) => (url.endsWith("/status.json") ? JSON.stringify({ parts: [{ name: "Emails", state: "red", text: "Not sending" }, { name: "Google", state: "amber", text: "Calendar behind" }] }) : url.endsWith("/notes/") ? "Not found" : /\/(app-version|status|quests\/state|calendar-api\/data|board-api\/boards)$/.test(url) ? "{}" : url.includes("/booking-form/open") ? JSON.stringify({ form: { sessions: [{ id: 1 }] } }) : url.includes("/booking-form/times") ? JSON.stringify({ times: [] }) : "<html></html>"),
      resolveTxt: async (name) => (name.startsWith("_dmarc") ? [["v=DMARC1"]] : name.startsWith("nova._domainkey") ? [] : [["v=spf1 include:_spf.google.com ~all"]]),
    });
    const results = await runProbes(buildProbes(w.deps), w.deps);
    const fails = Object.fromEntries(results.filter((r) => !r.ok).map((r) => [`${r.group}: ${r.name}`, r]));
    expect(fails["Addresses: Privacy"].detail).toMatch(/answered 404/);
    expect(fails["Nova Agent: Notes page"].detail).toMatch(/isn't a page/);
    expect(fails["Status page: Every part"]).toMatchObject({ severity: "serious" });
    expect(fails["Status page: Every part"].detail).toMatch(/Emails \(red\): Not sending\nGoogle \(amber\)/);
    expect(fails["Mail records: SPF (who may send)"].detail).toMatch(/185\.185\.126\.195/);
    expect(fails["Mail records: DKIM (the signature)"]).toBeTruthy();
    const findings = probeFindings(results);
    expect(findings.find((f) => f.fingerprint === "checks:addresses:privacy")).toMatchObject({ area: "checks", severity: "serious" });
    expect(findings.find((f) => f.fingerprint === "server:status page:every part")!.title).toMatch(/^Status page: Every part: Emails \(red\)/);
  });

  it("a fail is tried once more before it counts (a moment's blip passes)", async () => {
    let tries = 0;
    const w = world({ status: (url) => (url.endsWith("/privacy") && tries++ === 0 ? 503 : 200) });
    const results = await runProbes(buildProbes(w.deps), w.deps);
    expect(results.find((r) => r.name === "Privacy")).toMatchObject({ ok: true });
    expect(tries).toBe(2);
  });

  it("a check that throws is a fail with its reason, not a crash", async () => {
    const results = await runProbes([{ group: "G", name: "N", area: "checks", severity: "minor", run: async () => { throw new Error("no answer\nmore"); } }], { sleep: async () => {}, retryAfterMs: 0 });
    expect(results).toEqual([expect.objectContaining({ ok: false, detail: "no answer", severity: "minor" })]);
  });
});
