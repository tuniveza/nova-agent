// Nova Agent's local web pages, on http://localhost:4545:
//
//   /             the chat: talk to Nova Agent, with Calendar beside it
//   /calendar/    Calendar (the ../../calendar folder), saving to Nova Agent
//   /visualizer   every step the agent takes, live: what it's looking for, what
//                 it remembered, what it asked the AI, what the browser saw
//
//   npm run visualizer      then open http://localhost:4545
//
// While it runs, it also:
//   - runs the daily read-only healthcheck (HEALTHCHECK_CRON, default 06:00 UK)
//   - collects jobs from Novabot every minute (jobs.ts)
// so this is the process to keep running (npm run service does the same).
//
// It only listens on this computer (127.0.0.1), because the steps include
// client names and the AI prompts. To view it from the VPS later, use an
// SSH tunnel:  ssh -L 4545:localhost:4545 your-vps

import { connectAs, forgetConnected, whoAmI } from "../staff";
import { fromOurPage, passOn, session, signIn, signOut } from "../signin";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import cron from "node-cron";
import { config } from "../config";
import { addDays, today } from "../acuity/list";
import { readCache } from "../heal/cache";
import { runHealthcheck } from "../healthcheck";
import { startCollectingJobs } from "../jobs";
import { checkLogin, describeAppointments, listTask, readOnlyTour } from "../tasks";
import { getRecentEvents, onTrace, trace } from "../trace";
import { calendarEvents, readCalendar } from "../calendar/store";
import { saveFromPage } from "../calendar/page";
import { chat, type ChatTurn } from "../chat";
import { addBlock, addQuest, questState, removeBlock, removeMission, removeQuest, setMilestone, setQuestStatus, setRhythm, snoozeQuest, tidyBlocks, updateMission, updateQuest } from "../quests/actions";
import { replan } from "../quests/plan";
import { createMission, refineMission } from "../quests/planner";
import { startHubSync } from "../quests/hubsync";
import { startPulses } from "../quests/pulses";
import { startQuestReminders } from "../quests/reminders";
import { questEvents } from "../quests/store";

// Everything Nova Agent shows lives in web/: its own page (web/agent) and each panel
const web = (path: string) => fileURLToPath(new URL(`../../web/${path}`, import.meta.url));
const pageFile = web("agent/page.html");
const chatFile = web("agent/chat.html");
const syncFile = web("agent/calendar-sync.js");
const calendarRoot = web("calendar/");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

// The tasks the page's buttons can start (the page builds a button for
// each one). All of them are read-only.
const TASKS: Record<string, { label: string; run: () => Promise<string> }> = {
  "check-login": { label: "Check login", run: checkLogin },
  "next-7-days": {
    label: "Next 7 days",
    run: async () => describeAppointments(await listTask(today(), addDays(today(), 6))),
  },
  "last-30-days": {
    label: "Last 30 days",
    run: async () => describeAppointments(await listTask(addDays(today(), -30), today())),
  },
  tour: { label: "Read-only tour", run: readOnlyTour },
  healthcheck: { label: "Health check", run: async () => (await runHealthcheck()).summary },
};

const app = new Hono();

// Buttons on the page send this header. Other websites can't add custom
// headers to requests to this server, so they can't press our buttons.
app.use("/actions/*", async (c, next) => {
  if (c.req.header("X-Nova-Visualizer") !== "1") {
    return c.json({ ok: false, message: "Missing visualizer header" }, 403);
  }
  await next();
});

// The pages. Read from disk each time, so edits show on refresh.
app.get("/", (c) => c.html(readFileSync(chatFile, "utf8")));
app.get("/visualizer", (c) => c.html(readFileSync(pageFile, "utf8")));

// ---- The installable app: manifest, service worker and icons ----
const appRoot = web("agent/assets/");
const appFile = (name: string) => (c: any) => c.body(readFileSync(appRoot + name), 200, { "Content-Type": TYPES[extname(name)], "Cache-Control": "no-cache" });
app.get("/manifest.webmanifest", appFile("manifest.webmanifest"));
app.get("/sw.js", appFile("sw.js"));
// Nova Agent's own icons (/app/ was Hub's address; Hub is part of Portal now)
app.get("/agent/:file", (c) => {
  const name = c.req.param("file");
  if (/^[\w-]+\.(png|svg|js)$/.test(name) && existsSync(appRoot + name)) return appFile(name)(c);
  return c.text("Not found", 404);
});

// ---- Observatory and Notes, served from their folders next to Nova Agent ----
// So they're always on while Nova Agent is, and open inside it in any browser (as part of
// Nova Agent, a privacy-minded browser doesn't block what they save). Notes here keeps
// its own notes on this computer, separate from the web app's.
const MEDIA: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8" };
// `skip`: paths under the prefix that aren't files (the staff API under /app/api/)
function serveFolder(prefix: string, folder: string, missing: string, skip?: RegExp) {
  const root = web(folder);
  app.get(prefix, (c) => c.redirect(prefix + "/"));
  app.get(prefix + "/*", async (c, next) => {
    if (skip?.test(c.req.path)) return next();
    const rel = decodeURIComponent(c.req.path.slice(prefix.length + 1)) || "index.html";
    const file = resolve(root, rel);
    if (!file.startsWith(root.replace(/[\\/]$/, "") + sep) || !existsSync(file) || !statSync(file).isFile()) {
      if (!existsSync(root + "index.html")) return c.text(missing, 404);
      return c.text("Not found", 404);
    }
    const type = TYPES[extname(file)] || MEDIA[extname(file)] || "application/octet-stream";
    return c.body(readFileSync(file) as any, 200, { "Content-Type": type, "Cache-Control": "no-cache" });
  });
}
// Notes and Calendar keep an offline copy of themselves on their own; inside Nova Agent that
// only meant seeing the previous version after an update. Here their offline helper clears
// what it kept, steps aside and reloads the page with the current version.
const RETIRE_OFFLINE = `// Inside Nova Agent nothing is kept offline: clear the old copy, step aside, reload.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) await caches.delete(key);
  await self.registration.unregister();
  for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
})()));
`;
for (const path of ["/notes/sw.js", "/calendar/sw.js"]) {
  app.get(path, (c) => c.body(RETIRE_OFFLINE, 200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" }));
}
serveFolder("/observatory", "observatory/", "Observatory is missing from web/observatory.");
serveFolder("/notes", "notes/", "Notes is missing from web/notes.");
serveFolder("/app/memory", "index/", "Index is missing from web/index.");
// Where Index was for a day
app.get("/index/*", (c) => c.redirect("/app/memory/" + c.req.path.slice("/index/".length)));

// ---- What every panel shares: the look (themes), sounds, the Nova Agent badge and the Manual ----
// The badge asks this server who Nova Agent works for (src/staff.ts), which asks Nova Bot with
// Nova Agent's key; the planet pictures come through here too, so the panels never talk to another site.
serveFolder("/shared", "shared/", "web/shared is missing.");

// ---- Portal, as a panel (Hub is part of it now) ----
// It uses Nova Bot's staff API. Signing in on the Portal signs Nova Agent in to Nova Bot
// as that person (src/signin.ts); their requests are passed on with that sign-in.
serveFolder("/portal", "portal/", "web/portal is missing.");
// Hub's old address: its pages go to Portal (/app/#nova stays #nova; the browser keeps it).
// The API (/app/api/) and Index (/app/memory/) keep theirs, and so do the files phones that
// installed Hub still use (its push helper, manifest and icons).
const oldHubFiles = web("portal/old-app-address/");
const OLD_HUB_FILES = new Set(["sw.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]);
app.get("/app", (c) => c.redirect("/portal/" + new URL(c.req.url).search));
app.get("/app/*", async (c, next) => {
  const rest = c.req.path.slice("/app/".length);
  if (/^(api|memory)(\/|$)/.test(rest)) return next();
  if (OLD_HUB_FILES.has(rest)) {
    const type = TYPES[extname(rest)] || MEDIA[extname(rest)] || (rest.endsWith(".webmanifest") ? "application/manifest+json" : "application/octet-stream");
    return c.body(readFileSync(oldHubFiles + rest) as any, 200, { "Content-Type": type, "Cache-Control": "no-cache" });
  }
  return c.redirect("/portal/" + new URL(c.req.url).search);
});
// Where they were for a day
app.get("/studio/*", (c) => c.redirect("/portal/" + new URL(c.req.url).search));
app.get("/crew/*", (c) => c.redirect("/portal/" + c.req.path.slice("/crew/".length) + new URL(c.req.url).search));
for (const path of ["/auth/*", "/staff", "/staff/*", "/app/api/*"]) {
  app.use(path, async (c, next) => (fromOurPage(c.req.raw) ? next() : c.json({ error: "Only from Nova Agent's own pages" }, 403)));
}
app.post("/auth/login", async (c) => {
  const { status, data } = await signIn((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
  return c.json(data as any, status as any);
});
app.post("/auth/logout", async (c) => {
  await signOut();
  return c.json({ ok: true });
});
// There's no shared password any more: everyone signs in with their own account in the Portal
app.post("/app/api/login", (c) => c.json({ error: "On the studio computer, sign in with your own account in the Portal." }, 400));
app.post("/app/api/logout", async (c) => {
  await signOut();
  return c.json({ ok: true });
});

// Who's here: the person signed in in the Portal, or else who Nova Agent works for (src/staff.ts)
app.get("/auth/me", async (c) => (session() ? passOn(c.req.raw) : c.json(await whoAmI(), 200, { "Cache-Control": "no-store" })));
// "Connect as me" (back from Portal with a read-only token) and "back to automatic".
// Only from Nova Agent's own pages: the header makes other websites' requests fail.
app.post("/auth/link", async (c) => {
  if (c.req.header("X-Nova-App") !== "portal-badge") return c.json({ error: "Forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { token?: string; forget?: boolean };
  try {
    return c.json(body.forget ? await forgetConnected() : await connectAs(String(body.token || "")));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});
const planetCache = new Map<string, { at: number; body: string }>();
app.get("/staff/:id/planet.svg", async (c) => {
  const url = `${config.workerUrl}/staff/${encodeURIComponent(c.req.param("id"))}/planet.svg${new URL(c.req.url).search}`;
  let hit = planetCache.get(url);
  if (!hit || Date.now() - hit.at > 10 * 60_000) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        hit = { at: Date.now(), body: await res.text() };
        if (planetCache.size > 200) planetCache.clear();
        planetCache.set(url, hit);
      }
    } catch {}
  }
  return hit ? c.body(hit.body, 200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=300" }) : c.text("Not found", 404);
});

// ---- Index's data, through Nova Agent's own key ----
// The same addresses Index uses online (/app/api/memory/...), passed on to the
// memory engine as Nova Agent: the studio's memory and staff memory, never customers'.
// Approvals (customers' facts) need a Portal sign-in.
async function toEngine(path: string, init: RequestInit = {}) {
  const res = await fetch(`${config.workerUrl}/memory${path}`, {
    ...init,
    headers: { ...((init.headers as Record<string, string>) || {}), Authorization: `Bearer ${config.agentNovaKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
app.all("/app/api/memory/*", async (c) => {
  if (session()) return passOn(c.req.raw);
  if (!config.agentNovaKey) return c.json({ error: "Nova Agent isn't connected to Nova Bot (AGENT_NOVA_KEY)" }, 503);
  // Changes only from the page itself (the header makes other websites' requests fail)
  if (c.req.method !== "GET" && c.req.header("X-Nova-App") !== "index") return c.json({ error: "Forbidden" }, 403);
  const route = c.req.path.slice("/app/api/memory".length);
  const query = new URL(c.req.url).search;
  if (route === "/pending") return c.json({ pending: [], locked: true });
  if (route.startsWith("/pending/")) return c.json({ error: "Approvals need a Portal sign-in" }, 403);
  if (route === "/stats") {
    const { data } = await toEngine("/index");
    const by = new Map<string, { scope: string; files: number; facts: number }>();
    for (const f of (data.files || []) as { scope: string; facts: number }[]) {
      const s = by.get(f.scope) || { scope: f.scope, files: 0, facts: 0 };
      s.files += 1;
      s.facts += f.facts || 0;
      by.set(f.scope, s);
    }
    return c.json({ scopes: [...by.values()], pending: 0, locked: true });
  }
  if (route === "/index" || route === "/file") {
    const body = c.req.method === "PUT" ? await c.req.text() : undefined;
    const { status, data } = await toEngine(route + query, { method: c.req.method, body });
    return c.json(data, status as any);
  }
  return c.json({ error: "Not found" }, 404);
});

// The rest of Nova Bot's staff API (Portal), as the signed-in person
app.all("/app/api/*", (c) => passOn(c.req.raw));
app.all("/auth/*", (c) => passOn(c.req.raw));
app.all("/staff", (c) => passOn(c.req.raw));
app.all("/staff/*", (c) => passOn(c.req.raw));

// ---- Calendar, served from the calendar folder ----
// Its own offline helper isn't needed (or wanted) here: Nova Agent is the server.
app.get("/calendar-sync.js", (c) => c.body(readFileSync(syncFile, "utf8"), 200, { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache" }));
app.get("/calendar", (c) => c.redirect("/calendar/"));
app.get("/calendar/*", (c) => {
  const rel = decodeURIComponent(c.req.path.slice("/calendar/".length)) || "index.html";
  const file = resolve(calendarRoot, rel);
  if (!file.startsWith(calendarRoot.replace(/[\\/]$/, "") + sep) || !existsSync(file) || !statSync(file).isFile()) {
    if (!existsSync(calendarRoot + "index.html")) return c.text("The calendar folder is empty: run  git submodule update --init  in the Nova Agent folder.", 404);
    return c.text("Not found", 404);
  }
  let body: string | Buffer = readFileSync(file);
  if (rel === "index.html") {
    // Save to Nova Agent instead of only the browser (see calendar-sync.js)
    body = body.toString("utf8").replace('<script src="js/store.js"></script>', '<script src="/calendar-sync.js"></script>\n<script src="js/store.js"></script>');
  }
  return c.body(body as any, 200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
});

// The calendar's data: read by the calendar page and saved back from it
app.get("/calendar-api/data", (c) => c.json(readCalendar()));
// (merged with changes made elsewhere since the page loaded revision X-Nova-Rev: see calendar/page.ts)
app.put("/calendar-api/data", async (c) => {
  if (c.req.header("X-Nova-Visualizer") !== "1") return c.json({ ok: false }, 403);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, message: "That isn't calendar data" }, 400);
  }
  try {
    return c.json({ ok: true, ...saveFromPage(body, Number(c.req.header("X-Nova-Rev"))) });
  } catch (error) {
    trace("task", "error", `Calendar: a change from the page didn't save: ${(error as Error).message}`);
    return c.json({ ok: false, message: (error as Error).message }, 500);
  }
});
// Tells an open calendar page that Nova Agent changed something, so it refreshes
app.get("/calendar-api/events", (c) =>
  streamSSE(c, async (stream) => {
    const send = () => void stream.writeSSE({ event: "change", data: String(Date.now()) });
    calendarEvents.on("change", send);
    stream.onAbort(() => {
      calendarEvents.off("change", send);
    });
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

// How Nova Agent is set up (for the chat page's status pill)
app.get("/status", (c) =>
  c.json({ live: !config.dryRun, connected: Boolean(config.agentNovaKey), model: config.novaModel || "claude-opus-5-5" }),
);

// ---- Missions and Quests ----
app.get("/quests/state", (c) => c.json(questState()));
// Live: the plan changed, or a reminder / check-in is due
app.get("/quests/events", (c) =>
  streamSSE(c, async (stream) => {
    const changed = () => void stream.writeSSE({ event: "changed", data: String(Date.now()) });
    const notice = (n: unknown) => void stream.writeSSE({ event: "notice", data: JSON.stringify(n) });
    questEvents.on("changed", changed);
    questEvents.on("notice", notice);
    stream.onAbort(() => {
      questEvents.off("changed", changed);
      questEvents.off("notice", notice);
    });
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);
const questAction = async (c: any, fn: () => unknown) => {
  try {
    return c.json({ ok: true, result: await fn() });
  } catch (error) {
    return c.json({ ok: false, message: (error as Error).message }, 400);
  }
};
app.post("/actions/missions", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.request !== "string" || !body.request.trim()) return c.json({ ok: false, message: "Describe the mission first." }, 400);
  return questAction(c, () => createMission(body.request, { deadline: body.deadline }));
});
app.post("/actions/missions/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  return questAction(c, () => {
    if (body.remove) return removeMission(id);
    if (typeof body.milestone === "string") return setMilestone(id, body.milestone, body.done === true);
    return updateMission(id, { title: body.title, status: body.status, deadline: body.deadline });
  });
});
// Answers to the plan's questions, or any new detail: the work that's left is planned again
app.post("/actions/missions/:id/refine", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.detail !== "string" || !body.detail.trim()) return c.json({ ok: false, message: "Say what's new first." }, 400);
  return questAction(c, () => refineMission(c.req.param("id"), body.detail, { deadline: body.deadline }));
});
app.post("/actions/quests", async (c) => questAction(c, async () => addQuest(await c.req.json())));
app.post("/actions/quests/:id", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");
  return questAction(c, () => {
    if (body.action === "done") return setQuestStatus(id, "done");
    if (body.action === "finish") return setQuestStatus(id, "done", true);
    if (body.action === "start") return setQuestStatus(id, "doing");
    if (body.action === "skip") return setQuestStatus(id, "skipped");
    if (body.action === "reopen") return setQuestStatus(id, "todo");
    if (body.action === "snooze") return snoozeQuest(id, Number(body.minutes) || 15);
    if (body.action === "remove") return removeQuest(id);
    return updateQuest(id, body.changes || {});
  });
});
app.post("/actions/blocks", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return questAction(c, () => (body.remove ? removeBlock(body.id) : addBlock(body.start, body.end, body.reason)));
});
app.post("/actions/rhythm", async (c) => questAction(c, async () => setRhythm(await c.req.json())));
app.post("/actions/replan", (c) => questAction(c, () => {
  const r = replan();
  return { atRisk: r.atRisk, unplaced: r.unplaced };
}));

// ---- The chat ----
app.post("/actions/chat", async (c) => {
  let messages: ChatTurn[] = [];
  try {
    messages = (await c.req.json()).messages;
  } catch {
    return c.json({ ok: false, message: "Bad request" }, 400);
  }
  if (!Array.isArray(messages)) return c.json({ ok: false, message: "Bad request" }, 400);
  try {
    return c.json({ ok: true, ...(await chat(messages)) });
  } catch (error) {
    const message = (error as Error).message;
    trace("llm", "error", `Chat failed: ${message}`);
    return c.json({ ok: false, message: /api[_ ]?key|authentication|401/i.test(message) ? "Nova Agent can't reach Claude: check ANTHROPIC_API_KEY in .env." : "Nova Agent couldn't answer just now. Try again in a moment." }, 500);
  }
});

// Live event stream. Sends recent history first, then each new event.
app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    for (const event of getRecentEvents()) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
    const stopListening = onTrace((event) => {
      void stream.writeSSE({ data: JSON.stringify(event) });
    });
    stream.onAbort(stopListening);

    // Keep the connection open, with a small ping so proxies don't close it.
    while (!stream.aborted) {
      await stream.sleep(20_000);
      await stream.writeSSE({ event: "ping", data: "" });
    }
  }),
);

// What's in the selector cache (the agent's memory) right now.
app.get("/cache", (c) => c.json(readCache()));

app.get("/tasks", (c) =>
  c.json(Object.entries(TASKS).map(([id, task]) => ({ id, label: task.label }))),
);

app.post("/actions/run/:id", async (c) => {
  const task = TASKS[c.req.param("id")];
  if (!task) return c.json({ ok: false, message: "Unknown task" }, 404);

  trace("input", "start", `You asked for: ${task.label}`);
  try {
    const message = await task.run();
    trace("input", "ok", `Result: ${message}`);
    return c.json({ ok: true, message });
  } catch (error) {
    const message = (error as Error).message;
    trace("input", "error", `Result: failed (${message})`);
    return c.json({ ok: false, message }, 500);
  }
});

// Wipe the agent's memory, so you can watch it re-learn everything with the AI.
app.post("/actions/forget", (c) => {
  rmSync(config.paths.selectors, { force: true });
  trace("cache", "warn", "Memory wiped: every element will be looked up with the AI again");
  return c.json({ ok: true, message: "Memory wiped" });
});

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.visualizerPort }, () => {
  console.log(`Nova Agent: http://localhost:${config.visualizerPort}  (chat)  ·  /calendar/  ·  /visualizer`);
});

// The daily healthcheck. It waits its turn in the task queue like any task.
cron.schedule(
  config.healthcheckSchedule,
  () => {
    runHealthcheck().catch((error) => trace("task", "error", `Healthcheck crashed: ${(error as Error).message}`));
  },
  { timezone: config.timezone },
);
console.log(`Daily healthcheck scheduled: "${config.healthcheckSchedule}" (${config.timezone})`);

startCollectingJobs();

// Quests: plan on start-up, then reminders and check-ins every 30 seconds
try {
  tidyBlocks();
  replan();
} catch (error) {
  console.warn("Quests couldn't plan on start-up:", (error as Error).message);
}
startQuestReminders();
startPulses();
startHubSync();
