// Nova Agent's service worker keeps Nova's own files on the device (web/agent/assets/sw.js, "Nova's
// files on the device"): a file on the deploy's list (/nova-build.json) is fetched once and then used
// from the device while its fingerprint stays the same; a changed or removed one is fetched again or
// dropped; pages, data and files not on the list always go to Nova.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SW = readFileSync(new URL("../web/agent/assets/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://nova.example";

function boot(served: Record<string, () => Response>) {
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: any) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        async match(r: any) { const hit = m.get(key(r)); return hit ? hit.clone() : undefined; },
        async put(r: any, res: Response) { m.set(key(r), res); },
        async delete(r: any) { return m.delete(key(r)); },
        async keys() { return [...m.keys()].map((u) => new Request(u)); },
      };
    },
  };
  const fetched: string[] = [];
  const fetch = async (r: any) => {
    const u = new URL(typeof r === "string" ? r : r.url, ORIGIN);
    fetched.push(u.pathname);
    const make = served[u.pathname];
    if (!make) return new Response("missing", { status: 404 });
    const res = make();
    Object.defineProperty(res, "type", { value: "basic" });
    return res;
  };
  const self: any = { addEventListener: (t: string, f: any) => (handlers[t] = f), skipWaiting() {}, clients: { claim() {} }, registration: {}, navigator: {} };
  vm.runInNewContext(SW, { self, caches, fetch, location: { origin: ORIGIN }, URL, Request, Response, Headers, setTimeout, Promise, JSON, Date, Set, Object });
  async function event(path: string, mode = "no-cors") {
    let answer: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    const request = { url: ORIGIN + path, method: "GET", mode, headers: new Headers() };
    handlers.fetch({ request, respondWith: (p: Promise<Response>) => (answer = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    return { answer, waits };
  }
  return { event, fetched, stores };
}
const list = (build: string, files: Record<string, string>) => () =>
  new Response(JSON.stringify({ build, files: Object.fromEntries(Object.entries(files).map(([p, f]) => [p, [f, 10]])) }), { headers: { "Content-Type": "application/json" } });

describe("Nova's files on the device", () => {
  it("a listed file is fetched once, then used from the device", async () => {
    const served: Record<string, () => Response> = { "/nova-build.json": list("b1", { "/shared/fit.js": "aaa" }), "/shared/fit.js": () => new Response("one") };
    const sw = boot(served);
    await Promise.all((await sw.event("/calendar/", "navigate")).waits);
    const first = await (await sw.event("/shared/fit.js")).answer!;
    expect(await first.text()).toBe("one");
    const again = await (await sw.event("/shared/fit.js")).answer!;
    expect(await again.text()).toBe("one");
    expect(sw.fetched.filter((p) => p === "/shared/fit.js")).toHaveLength(1);
  });

  it("after a deploy only the changed file is fetched again; a file no longer listed is dropped", async () => {
    const served: Record<string, () => Response> = {
      "/nova-build.json": list("b1", { "/a.js": "1", "/b.css": "1", "/c.svg": "1" }),
      "/a.js": () => new Response("a1"), "/b.css": () => new Response("b1"), "/c.svg": () => new Response("c1"),
    };
    const sw = boot(served);
    await Promise.all((await sw.event("/agent/", "navigate")).waits.slice(0, 1));
    for (const p of ["/a.js", "/b.css", "/c.svg"]) await (await sw.event(p)).answer;
    served["/nova-build.json"] = list("b2", { "/a.js": "2", "/b.css": "1" });
    served["/a.js"] = () => new Response("a2");
    await new Promise((r) => setTimeout(r, 5100)); // the list is asked for again (at most every 5 s)
    await Promise.all((await sw.event("/calendar/", "navigate")).waits);
    expect(await (await (await sw.event("/a.js")).answer!).text()).toBe("a2");
    expect(await (await (await sw.event("/b.css")).answer!).text()).toBe("b1");
    expect(sw.fetched.filter((p) => p === "/b.css")).toHaveLength(1);
    const kept = [...sw.stores.get("nova-files")!.keys()].map((u) => new URL(u).pathname);
    expect(kept).not.toContain("/c.svg");
  }, 10_000);

  it("pages, data and files that aren't on the list are left to Nova", async () => {
    const served: Record<string, () => Response> = { "/nova-build.json": list("b1", { "/shared/fit.js": "aaa" }), "/status.json": () => new Response("{}"), "/observatory/data/projects.js": () => new Response("x") };
    const sw = boot(served);
    const page = await (await sw.event("/agent/", "navigate")).answer!; // pages: Nova's own answer, passed on
    expect(page.status).toBe(404); // (this test's Nova has no page there)
    expect((await sw.event("/quests/state")).answer).toBeNull(); // data
    expect((await sw.event("/status.json")).answer).toBeNull();
    const notListed = await (await sw.event("/observatory/data/projects.js")).answer!;
    expect(await notListed.text()).toBe("x");
    expect(sw.stores.get("nova-files")?.has(ORIGIN + "/observatory/data/projects.js")).toBeFalsy();
  });

  it("a page from the deploy whose list is kept: the files are used at once, no list asked for", async () => {
    const page = (build: string) => () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html", "X-Nova-Build": build } });
    const served: Record<string, () => Response> = { "/nova-build.json": list("b1", { "/a.js": "1" }), "/agent/": page("b1"), "/calendar/": page("b1"), "/a.js": () => new Response("a1") };
    const sw = boot(served);
    await Promise.all((await sw.event("/agent/", "navigate")).waits.slice(0, 1));
    await (await sw.event("/a.js")).answer;
    const asked = sw.fetched.filter((p) => p === "/nova-build.json").length;
    await Promise.all((await sw.event("/calendar/", "navigate")).waits);
    expect(await (await (await sw.event("/a.js")).answer!).text()).toBe("a1");
    expect(sw.fetched.filter((p) => p === "/nova-build.json").length).toBe(asked); // not asked again
    // a page from a newer deploy: the new list first, and the changed file fetched
    served["/nova-build.json"] = list("b2", { "/a.js": "2" });
    served["/a.js"] = () => new Response("a2");
    served["/calendar/"] = page("b2");
    await Promise.all((await sw.event("/calendar/", "navigate")).waits);
    expect(await (await (await sw.event("/a.js")).answer!).text()).toBe("a2");
  });

  it("with no list (the studio PC), nothing is kept", async () => {
    const sw = boot({ "/shared/fit.js": () => new Response("one") });
    await Promise.all((await sw.event("/agent/", "navigate")).waits.slice(0, 1));
    await (await sw.event("/shared/fit.js")).answer;
    await (await sw.event("/shared/fit.js")).answer;
    expect(sw.fetched.filter((p) => p === "/shared/fit.js")).toHaveLength(2);
  });
});
