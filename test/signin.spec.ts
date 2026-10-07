// Signing in to Nova Bot from Nova Agent (src/signin.ts), against a pretend Nova Bot.  Run: npm test
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let seen: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
let answer: (url: string, body: any) => Response;

beforeEach(() => {
  process.env.NOVA_DATA_DIR = mkdtempSync(join(tmpdir(), "nova-signin-"));
  vi.resetModules();
  seen = [];
  answer = (url, body) =>
    url.endsWith("/auth/login") && body?.password === "right"
      ? Response.json({ ok: true, token: "nsess_secret", staff: { id: "dominic", display_name: "Dominic", role: "admin" } })
      : url.endsWith("/auth/login")
        ? Response.json({ error: "Wrong email or password" }, { status: 401 })
        : Response.json({ ok: true, path: new URL(url).pathname });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body as ArrayBuffer)) : "";
    seen.push({ url, method: init.method || "GET", headers: (init.headers || {}) as Record<string, string>, body });
    return answer(url, body ? JSON.parse(body) : null);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const load = () => import("../src/signin");
const page = (path: string, init: RequestInit & { origin?: string; host?: string } = {}) =>
  new Request(`http://localhost:4545${path}`, { ...init, headers: { host: init.host ?? "localhost:4545", ...(init.origin !== undefined ? { origin: init.origin } : {}), "content-type": "application/json" } });

describe("signing in on the Crew panel", () => {
  it("logs in to Nova Bot as an app, keeps the token on this computer only, and never gives it to the page", async () => {
    const s = await load();
    const res = await s.signIn({ email: "d@novacane.co.uk", password: "right" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).not.toContain("nsess_");
    expect(JSON.parse(seen[0].body)).toMatchObject({ client: "app" });
    const file = `${process.env.NOVA_DATA_DIR}/signin.json`;
    expect(readFileSync(file, "utf8")).toContain("nsess_secret");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("a wrong password signs nobody in", async () => {
    const s = await load();
    expect((await s.signIn({ email: "d@novacane.co.uk", password: "wrong" })).status).toBe(401);
    expect(s.session()).toBeNull();
  });

  it("passes requests on as that person, and drops the sign-in when Nova Bot ends it", async () => {
    const s = await load();
    await s.signIn({ email: "d@novacane.co.uk", password: "right" });
    const res = await s.passOn(page("/app/api/enquiries?show=all"));
    expect(res.status).toBe(200);
    const sent = seen.at(-1)!;
    expect(sent.url).toBe("https://worker.test/app/api/enquiries?show=all");
    expect(sent.headers.Authorization).toBe("Bearer nsess_secret");
    answer = () => Response.json({ error: "Signed out" }, { status: 401 });
    await s.passOn(page("/app/api/enquiries"));
    expect(s.session()).toBeNull();
    expect(existsSync(`${process.env.NOVA_DATA_DIR}/signin.json`)).toBe(false);
  });

  it("without a sign-in, nothing goes to Nova Bot", async () => {
    const s = await load();
    expect((await s.passOn(page("/app/api/enquiries"))).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("only Nova Agent's own pages can use it: not another website, not a look-alike address", async () => {
    const s = await load();
    expect(s.fromOurPage(page("/app/api/enquiries"))).toBe(true);
    expect(s.fromOurPage(page("/app/api/enquiries/status", { method: "POST", origin: "http://localhost:4545" }))).toBe(true);
    expect(s.fromOurPage(page("/app/api/enquiries/status", { method: "POST", origin: "https://evil.example" }))).toBe(false);
    expect(s.fromOurPage(page("/app/api/enquiries/status", { method: "POST" }))).toBe(false);
    expect(s.fromOurPage(page("/app/api/enquiries", { host: "evil.example" }))).toBe(false);
  });
});
