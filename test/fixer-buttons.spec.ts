// The buttons check (src/fixer/buttons.ts): every button pressed, in a real browser, on a small
// Nova Agent stand-in with one panel of buttons that each do (or don't do) one thing; and its
// judging, its turns through the panels and sizes, and the window its problems are made from.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BUTTON_SIZES, buttonsPlan, buttonsProblems, isPortalUrl, judgePress, rollButtons, runButtons, slotAt, type ButtonResult, type ButtonsScreen, type PressSeen } from "../src/fixer/buttons";

const NONE: PressSeen = { changed: 0, requests: 0, blocked: 0, went: false, dialogs: 0, state: false, focus: false, calls: 0, downloads: 0, errors: [] };

describe("judging one press", () => {
  it("nothing at all: does nothing; anything at all: works", () => {
    expect(judgePress(NONE).verdict).toBe("does-nothing");
    for (const k of ["changed", "requests", "blocked", "dialogs", "calls", "downloads"] as const) expect(judgePress({ ...NONE, [k]: 1 }).verdict).toBe("works");
    for (const k of ["went", "state", "focus"] as const) expect(judgePress({ ...NONE, [k]: true }).verdict).toBe("works");
  });
  it("a script error after the press goes wrong, unless it was a save this check turned away", () => {
    expect(judgePress({ ...NONE, changed: 3, errors: ["TypeError: x is undefined"] })).toMatchObject({ verdict: "click-error", why: "TypeError: x is undefined" });
    expect(judgePress({ ...NONE, blocked: 1, errors: ["Error: The Fixer's check only looks"] }).verdict).toBe("works");
    expect(judgePress({ ...NONE, changed: 1, errors: ["Failed to fetch"] }).verdict).toBe("works");
  });
  it("asked for something and got an error, or put up a message saying it went wrong: goes wrong", () => {
    expect(judgePress({ ...NONE, requests: 1, failed: ["GET /app/api/x → 500"] })).toMatchObject({ verdict: "click-error" });
    expect(judgePress({ ...NONE, changed: 2, said: ["Couldn't load the list"] })).toMatchObject({ verdict: "click-error" });
    // (a save turned away says it couldn't save: that's this check)
    expect(judgePress({ ...NONE, blocked: 1, said: ["Couldn't save"] }).verdict).toBe("works");
  });
  it("Portal opening, when the button's words don't say so, is going to Portal instead", () => {
    expect(judgePress({ ...NONE, went: true, portal: true }, "Details").verdict).toBe("goes-to-portal");
    for (const says of ["Open in Portal", "Sign in", "Your profile", "Connect with Portal", "Open Admin → Google"]) expect(judgePress({ ...NONE, went: true, portal: true }, says).verdict).toBe("works");
    expect(isPortalUrl("https://nova.novacane.co.uk/portal/?view=money")).toBe(true);
    expect(isPortalUrl("/portal")).toBe(true);
    expect(isPortalUrl("/agent/apps/portal-ish")).toBe(false);
  });
});

describe("the problems from a panel's presses", () => {
  const r = (what: string, verdict: ButtonResult["verdict"], primary = true): ButtonResult => ({ what, label: what, primary, verdict, why: "" });
  it("one problem for each kind, naming the buttons; serious for errors, links, Portal and a button with words that does nothing", () => {
    const ps = buttonsProblems([r("button “Save”", "does-nothing"), r("button “A”", "works"), r("link “Help”", "broken-link"), r("button “Go”", "click-error"), r("button “Details”", "goes-to-portal")], "Notes");
    expect(ps.map((p) => p.kind).sort()).toEqual(["broken-link", "click-error", "does-nothing", "goes-to-portal"]);
    expect(ps.every((p) => p.severity === "serious")).toBe(true);
    expect(ps.find((p) => p.kind === "does-nothing")!.text).toBe("Does nothing when pressed in Notes: button “Save”");
  });
  it("only an icon that does nothing: small", () => {
    expect(buttonsProblems([r("button “⚙”", "does-nothing", false)], "Notes")[0].severity).toBe("minor");
  });
});

describe("its turns", () => {
  it("three panels a run, then the next size: each panel about every half hour, every size in turn", () => {
    const seen = new Map<string, number[]>();
    for (let slot = 0; slot < 18; slot++) {
      const p = buttonsPlan(slot, 15);
      expect(p.count).toBe(3);
      for (let i = p.from; i < p.from + p.count; i++) seen.set(`${i}|${p.size.join("x")}`, [...(seen.get(`${i}|${p.size.join("x")}`) || []), slot]);
    }
    // 15 panels, 3 sizes: every panel at every size within 15 runs (75 minutes)
    for (let i = 0; i < 15; i++) for (const s of BUTTON_SIZES) expect(seen.has(`${i}|${s.join("x")}`)).toBe(true);
    // (each panel comes round again within 5 runs)
    const p0 = [...Array(18).keys()].filter((slot) => buttonsPlan(slot, 15).from === 0);
    expect(Math.max(...p0.slice(1).map((s, i) => s - p0[i]))).toBeLessThanOrEqual(5);
    expect(slotAt(new Date("2026-10-15T17:05:00Z")) - slotAt(new Date("2026-10-15T17:00:00Z"))).toBe(1);
  });
  it("its problems come from every panel pressed through in the last 100 minutes, the newest of each", () => {
    const at = new Date("2026-10-15T18:00:00Z");
    const s = (path: string, mins: number, w = 1440): ButtonsScreen => ({ name: path, path, width: w, height: 900, signedIn: true, ms: 0, problems: [], shot: "", pressed: 3, at: new Date(at.getTime() - mins * 60_000).toISOString() });
    const kept = rollButtons([s("/notes/", 30), s("/board/", 120), s("/quests/", 10)], [{ ...s("/quests/", 0), at: undefined as never }], at);
    expect(kept.map((x) => x.path).sort()).toEqual(["/notes/", "/quests/"]);
    expect(kept.find((x) => x.path === "/quests/")!.at).toBe(at.toISOString());
  });
});

// ---- A real press of each, on a stand-in Nova Agent with one panel ----
const AGENT = `<!doctype html><html><body>
<div id="suite-home"><a class="suite-app" data-inside="/fixture/" href="/fixture/"><b>Fixture</b></a></div>
<div class="main"><div class="viewer"></div></div>
<script>
  window.NovaAgent = { open(p) {
    document.querySelector(".main").classList.add("viewing");
    const v = document.querySelector(".viewer");
    for (const f of v.querySelectorAll("iframe")) f.hidden = true;
    let f = [...v.querySelectorAll("iframe")].find((x) => x.getAttribute("src") === p);
    if (!f) { f = document.createElement("iframe"); f.setAttribute("src", p); f.style.cssText = "width:1100px;height:700px;border:0"; v.append(f); }
    f.hidden = false;
    return true;
  } };
</script></body></html>`;
const PANEL = `<!doctype html><html><body style="font:16px sans-serif">
<p id="clock">0</p><div id="box">box</div><p id="msg"></p>
<button id="nothing">Nothing here</button>
<button id="toggle" onclick="document.getElementById('box').classList.toggle('on')">Toggle</button>
<button id="throws" onclick="throw new Error('boom')">Throws</button>
<button id="save" onclick="fetch('/api/save', { method: 'POST' }).catch(() => {})">Save</button>
<button id="loads" onclick="fetch('/api/broken').then((r) => r.ok || null)">Load the list</button>
<button id="sorry" onclick="document.getElementById('msg').textContent = 'Couldn\\'t load the list'">Refresh</button>
<button id="opens" onclick="document.getElementById('dlg').showModal()">Open the dialog</button>
<dialog id="dlg"><button id="inner">Inner nothing</button><button id="close" onclick="this.closest('dialog').close()">Close</button></dialog>
<a id="gone" href="/missing">A missing page</a>
<button id="off" disabled>Off</button>
<button id="details" onclick="top.NovaAgent.open('/portal/?view=money')">Details</button>
<button id="toportal" onclick="top.NovaAgent.open('/portal/')">Open Portal</button>
<script>setInterval(() => (document.getElementById('clock').textContent = Date.now()), 150);</script>
</body></html>`;

let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url || "/";
    if (url.startsWith("/agent")) return void res.writeHead(200, { "Content-Type": "text/html" }).end(AGENT);
    if (url.startsWith("/fixture")) return void res.writeHead(200, { "Content-Type": "text/html" }).end(PANEL);
    if (url.startsWith("/portal")) return void res.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><p>Portal</p>");
    if (url.startsWith("/api/broken")) return void res.writeHead(500).end("{}");
    res.writeHead(404).end("not here");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

describe("pressing every button, for real", () => {
  it("finds the button that does nothing, the ones that go wrong, the missing page and the one that goes to Portal; the rest work", async () => {
    const { screens, total } = await runButtons({ base, size: [1280, 800], panels: ["/fixture/"], budgetMs: 100_000 });
    expect(total).toBe(2); // Nova Agent's own page and the one panel
    const [s] = screens;
    const v = Object.fromEntries((s as any).results.map((r: ButtonResult) => [r.label, r.verdict]));
    if (process.env.BUTTONS_DEBUG) console.log(JSON.stringify((s as any).results, null, 1));
    expect(v["Nothing here"]).toBe("does-nothing"); // (the clock ticking by itself doesn't count)
    expect(v["Toggle"]).toBe("works");
    expect(v["Throws"]).toBe("click-error");
    expect(v["Save"]).toBe("works"); // (it tried: this check turned it away)
    expect(v["Load the list"]).toBe("click-error"); // (asked, and got a 500)
    expect(v["Refresh"]).toBe("click-error"); // (said it couldn't)
    expect(v["Open the dialog"]).toBe("works");
    expect(v["Inner nothing"]).toBe("does-nothing"); // (in the dialog it opened)
    expect(v["A missing page"]).toBe("broken-link");
    expect(v["Off"]).toBeUndefined(); // (disabled: not pressed)
    expect(v["Details"]).toBe("goes-to-portal");
    expect(v["Open Portal"]).toBe("works");
    expect(s.problems.map((p) => p.kind).sort()).toEqual(["broken-link", "click-error", "does-nothing", "goes-to-portal"]);
  }, 150_000);
});
